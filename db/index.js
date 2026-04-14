const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool = null;
let connected = false;
let schemaEnsured = false;

function buildHostedConfig(databaseUrl) {
  const url = new URL(databaseUrl);

  // Let node-postgres use our explicit SSL object instead of libpq-style
  // URL params, which can force certificate validation on hosted databases.
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

async function ensureSchema() {
  if (!pool || schemaEnsured) return;

  const existsResult = await pool.query(
    "SELECT to_regclass('public.organizations') AS organizations_table"
  );

  if (existsResult.rows[0]?.organizations_table) {
    schemaEnsured = true;
    return;
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
  schemaEnsured = true;
  console.log('[db] PostgreSQL schema bootstrapped');
}

async function connect() {
  const base = process.env.DATABASE_URL
    ? buildHostedConfig(process.env.DATABASE_URL)
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'bugtracker',
        user: process.env.DB_USER || 'bugtracker',
        password: process.env.DB_PASSWORD || 'bugtracker_secret',
      };

  const config = {
    ...base,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };

  pool = new Pool(config);
  pool.on('error', (err) => {
    console.error('[db] Idle client error:', err.message);
  });

  try {
    await pool.query('SELECT 1');
    await ensureSchema();
    connected = true;
    console.log('[db] PostgreSQL connected');
  } catch (err) {
    await pool.end().catch(() => {});
    pool = null;
    connected = false;
    console.warn('[db] PostgreSQL unavailable - using JSON fallback:', err.message);
  }
}

function isConnected() {
  return connected;
}

function query(...args) {
  if (!pool) throw new Error('Database not connected');
  return pool.query(...args);
}

module.exports = { connect, isConnected, query, pool };
