require('dotenv').config();

const https = require('https');
const { Client } = require('pg');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1cRAOEc9FbuyeDQ_Cqr84RJK2ExRHoYqS/export?format=csv&gid=1549363140';
const TARGET_ORG_NAME = 'Twinleaves';
const IMPORT_DOMAINS = ['@import.fixpulse.local', '@sheet-import.local'];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(value);
      value = '';
      continue;
    }

    if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows;
}

function clean(value) {
  return String(value || '').trim();
}

function canonical(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstName(value) {
  return canonical(value).split(' ')[0] || '';
}

function isImportEmail(email) {
  const lower = String(email || '').toLowerCase();
  return IMPORT_DOMAINS.some((suffix) => lower.endsWith(suffix));
}

function chooseTargetUser(users, sheetRow) {
  const targetEmail = sheetRow.email.toLowerCase();
  return (
    users.find((user) => String(user.email || '').toLowerCase() === targetEmail) ||
    users.find((user) => canonical(user.name) === canonical(sheetRow.name)) ||
    users.find((user) => !isImportEmail(user.email)) ||
    users[0]
  );
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const csvText = await fetchText(SHEET_URL);
  const sheetRows = parseCsv(csvText)
    .slice(1)
    .map((row) => ({
      name: clean(row[0]),
      email: clean(row[1]).toLowerCase(),
      mobileNumber: clean(row[2]),
      firstName: firstName(row[0]),
    }))
    .filter((row) => row.name && row.email && row.firstName);

  const sheetByFirst = new Map();
  for (const row of sheetRows) {
    if (!sheetByFirst.has(row.firstName)) sheetByFirst.set(row.firstName, []);
    sheetByFirst.get(row.firstName).push(row);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_number TEXT');

    const orgResult = await client.query('SELECT id, name FROM organizations WHERE LOWER(name)=LOWER($1) LIMIT 1', [TARGET_ORG_NAME]);
    const org = orgResult.rows[0];
    if (!org) throw new Error(`Organization "${TARGET_ORG_NAME}" not found`);

    const usersResult = await client.query(
      'SELECT id, org_id, name, email, mobile_number FROM users WHERE org_id=$1 ORDER BY created_at ASC',
      [org.id]
    );
    const allUsersResult = await client.query('SELECT id, org_id, name, email FROM users');
    const users = usersResult.rows;
    const allUsers = allUsersResult.rows;

    const usersByFirst = new Map();
    for (const user of users) {
      const key = firstName(user.name);
      if (!key) continue;
      if (!usersByFirst.has(key)) usersByFirst.set(key, []);
      usersByFirst.get(key).push(user);
    }

    const emailOwners = new Map();
    for (const user of allUsers) {
      if (user.email) emailOwners.set(user.email.toLowerCase(), user);
    }

    const mergePlans = [];
    const ambiguous = [];
    const skippedConflicts = [];

    for (const [key, group] of usersByFirst.entries()) {
      if (group.length < 2) continue;
      const sheetMatches = sheetByFirst.get(key) || [];
      if (sheetMatches.length !== 1) {
        ambiguous.push({
          firstName: key,
          sheetMatches: sheetMatches.map((row) => row.name),
          users: group.map((user) => user.name),
        });
        continue;
      }

      const sheetRow = sheetMatches[0];
      const target = chooseTargetUser(group, sheetRow);
      const sources = group.filter((user) => user.id !== target.id);
      const owner = emailOwners.get(sheetRow.email.toLowerCase());
      const allowedIds = new Set([target.id, ...sources.map((user) => user.id)]);
      if (owner && !allowedIds.has(owner.id)) {
        skippedConflicts.push({
          firstName: key,
          targetEmail: sheetRow.email,
          ownedBy: owner.name,
          users: group.map((user) => user.name),
        });
        continue;
      }

      mergePlans.push({
        firstName: key,
        sheetRow,
        target,
        sources,
      });
    }

    const merged = [];

    await client.query('BEGIN');
    try {
      for (const plan of mergePlans) {
        await client.query(
          'UPDATE users SET email=$2, mobile_number=NULLIF($3, \'\') WHERE id=$1',
          [plan.target.id, plan.sheetRow.email.toLowerCase(), plan.sheetRow.mobileNumber]
        );

        for (const source of plan.sources) {
          await client.query('UPDATE bugs SET assignee_id=$1 WHERE assignee_id=$2', [plan.target.id, source.id]);
          await client.query('UPDATE bugs SET reporter_id=$1 WHERE reporter_id=$2', [plan.target.id, source.id]);
          await client.query('UPDATE comments SET author_id=$1 WHERE author_id=$2', [plan.target.id, source.id]);
          await client.query('UPDATE activity SET user_id=$1 WHERE user_id=$2', [plan.target.id, source.id]);

          await client.query(
            `
              INSERT INTO user_roles (user_id, role_id, org_id, project_id)
              SELECT $1, role_id, org_id, project_id
              FROM user_roles
              WHERE user_id = $2
              ON CONFLICT DO NOTHING
            `,
            [plan.target.id, source.id]
          );

          await client.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [source.id]);
          await client.query('DELETE FROM users WHERE id=$1', [source.id]);
        }

        merged.push({
          firstName: plan.firstName,
          target: {
            id: plan.target.id,
            name: plan.target.name,
            email: plan.sheetRow.email.toLowerCase(),
            mobileNumber: plan.sheetRow.mobileNumber,
          },
          removed: plan.sources.map((user) => ({ id: user.id, name: user.name, email: user.email })),
        });
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log(JSON.stringify({
      org: org.name,
      mergedCount: merged.length,
      merged,
      ambiguousCount: ambiguous.length,
      ambiguous,
      skippedConflictCount: skippedConflicts.length,
      skippedConflicts,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
