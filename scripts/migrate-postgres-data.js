require('dotenv').config();
const { Client } = require('pg');

function hostedConfig(databaseUrl) {
  const url = new URL(databaseUrl);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslcert');
  url.searchParams.delete('sslkey');
  url.searchParams.delete('sslrootcert');
  url.searchParams.delete('sslcrl');
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  };
}

function q(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function getPublicTables(client) {
  const { rows } = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return rows.map((row) => row.tablename);
}

async function getTableColumns(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
        a.attnotnull AS not_null,
        pg_get_expr(ad.adbin, ad.adrelid) AS default_expr
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad
        ON ad.adrelid = a.attrelid
       AND ad.adnum = a.attnum
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `,
    [tableName]
  );
  return rows;
}

async function getPrimaryKeyColumns(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a
        ON a.attrelid = c.oid
       AND a.attnum = ANY(i.indkey)
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)
    `,
    [tableName]
  );
  return rows.map((row) => row.column_name);
}

async function getForeignKeyGraph(client) {
  const { rows } = await client.query(`
    SELECT
      child.relname AS child_table,
      parent.relname AS parent_table
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE con.contype = 'f'
      AND child_ns.nspname = 'public'
      AND parent_ns.nspname = 'public'
  `);
  return rows;
}

function topoSortTables(tables, foreignKeys) {
  const tableSet = new Set(tables);
  const incoming = new Map(tables.map((table) => [table, 0]));
  const outgoing = new Map(tables.map((table) => [table, new Set()]));

  for (const { child_table: child, parent_table: parent } of foreignKeys) {
    if (!tableSet.has(child) || !tableSet.has(parent)) continue;
    if (outgoing.get(parent).has(child)) continue;
    outgoing.get(parent).add(child);
    incoming.set(child, incoming.get(child) + 1);
  }

  const queue = tables.filter((table) => incoming.get(table) === 0).sort();
  const ordered = [];

  while (queue.length) {
    const table = queue.shift();
    ordered.push(table);
    for (const dependent of outgoing.get(table)) {
      incoming.set(dependent, incoming.get(dependent) - 1);
      if (incoming.get(dependent) === 0) {
        queue.push(dependent);
        queue.sort();
      }
    }
  }

  if (ordered.length !== tables.length) {
    const remaining = tables.filter((table) => !ordered.includes(table)).sort();
    ordered.push(...remaining);
  }

  return ordered;
}

async function ensureTargetTable(sourceClient, targetClient, tableName) {
  const columns = await getTableColumns(sourceClient, tableName);
  const pkColumns = await getPrimaryKeyColumns(sourceClient, tableName);

  const columnSql = columns.map((column) => {
    const parts = [`${q(column.column_name)} ${column.data_type}`];
    if (column.default_expr) parts.push(`DEFAULT ${column.default_expr}`);
    if (column.not_null) parts.push('NOT NULL');
    return parts.join(' ');
  });

  if (pkColumns.length) {
    columnSql.push(`PRIMARY KEY (${pkColumns.map(q).join(', ')})`);
  }

  await targetClient.query(`
    CREATE TABLE IF NOT EXISTS public.${q(tableName)} (
      ${columnSql.join(',\n      ')}
    )
  `);
}

async function getCommonColumns(sourceClient, targetClient, tableName) {
  const [sourceColumns, targetColumns] = await Promise.all([
    getTableColumns(sourceClient, tableName),
    getTableColumns(targetClient, tableName),
  ]);
  const targetSet = new Set(targetColumns.map((column) => column.column_name));
  return {
    columns: sourceColumns
      .map((column) => column.column_name)
      .filter((columnName) => targetSet.has(columnName)),
    targetColumnMap: new Map(targetColumns.map((column) => [column.column_name, column])),
  };
}

async function copyTable(sourceClient, targetClient, tableName) {
  const { columns, targetColumnMap } = await getCommonColumns(sourceClient, targetClient, tableName);
  if (!columns.length) return { inserted: 0 };

  const quotedColumns = columns.map(q);
  const sourceResult = await sourceClient.query(
    `SELECT ${quotedColumns.join(', ')} FROM public.${q(tableName)}`
  );

  await targetClient.query(`TRUNCATE TABLE public.${q(tableName)} RESTART IDENTITY CASCADE`);

  const batchSize = 250;
  for (let start = 0; start < sourceResult.rows.length; start += batchSize) {
    const batch = sourceResult.rows.slice(start, start + batchSize);
    const values = [];
    const valueGroups = batch.map((row, rowIndex) => {
      const placeholders = columns.map((columnName, columnIndex) => {
        const targetColumn = targetColumnMap.get(columnName);
        const value = row[columnName];
        if (value !== null && (targetColumn?.data_type === 'json' || targetColumn?.data_type === 'jsonb')) {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    await targetClient.query(
      `INSERT INTO public.${q(tableName)} (${quotedColumns.join(', ')}) VALUES ${valueGroups.join(', ')}`,
      values
    );
  }

  return { inserted: sourceResult.rows.length };
}

async function getCount(client, tableName) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM public.${q(tableName)}`);
  return rows[0].count;
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;

  if (!sourceUrl) {
    throw new Error('SOURCE_DATABASE_URL is required');
  }
  if (!targetUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const sourceClient = new Client(hostedConfig(sourceUrl));
  const targetClient = new Client(hostedConfig(targetUrl));

  try {
    await sourceClient.connect();
    await targetClient.connect();
    await targetClient.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    const sourceTables = await getPublicTables(sourceClient);
    const targetTables = new Set(await getPublicTables(targetClient));
    for (const tableName of sourceTables) {
      if (!targetTables.has(tableName)) {
        await ensureTargetTable(sourceClient, targetClient, tableName);
      }
    }

    const orderedTables = topoSortTables(sourceTables, await getForeignKeyGraph(sourceClient));
    const summary = [];

    for (const tableName of orderedTables) {
      const { inserted } = await copyTable(sourceClient, targetClient, tableName);
      const [sourceCount, targetCount] = await Promise.all([
        getCount(sourceClient, tableName),
        getCount(targetClient, tableName),
      ]);
      summary.push({ table: tableName, sourceCount, targetCount, inserted });
      console.log(`${tableName}: ${sourceCount} -> ${targetCount}`);
    }

    console.log('\nMigration complete');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await sourceClient.end().catch(() => {});
    await targetClient.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
