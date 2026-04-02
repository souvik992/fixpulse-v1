require('dotenv').config();

const https = require('https');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1cRAOEc9FbuyeDQ_Cqr84RJK2ExRHoYqS/export?format=csv&gid=1549363140';
const TARGET_ORG_NAME = 'Twinleaves';
const DEFAULT_PASSWORD = '111111';

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
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
      })
      .on('error', reject);
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

function compact(value) {
  return canonical(value).replace(/\s+/g, '');
}

function tokens(value) {
  return canonical(value).split(' ').filter(Boolean);
}

function buildSheetRows(csvText) {
  const rows = parseCsv(csvText);
  return rows
    .slice(1)
    .map((row) => ({
      name: clean(row[0]),
      email: clean(row[1]).toLowerCase(),
      mobileNumber: clean(row[2]),
    }))
    .filter((row) => row.name && row.email);
}

function getCandidateKeys(user, sheetRows) {
  const userCanonical = canonical(user.name);
  const userCompact = compact(user.name);
  const userTokens = tokens(user.name);
  const userFirst = userTokens[0] || '';

  return sheetRows.filter((row) => {
    const rowCanonical = canonical(row.name);
    const rowCompact = compact(row.name);
    const rowTokens = tokens(row.name);
    const rowFirst = rowTokens[0] || '';

    if (userCanonical && userCanonical === rowCanonical) return true;
    if (userCompact && userCompact === rowCompact) return true;
    if (!userFirst || userFirst !== rowFirst) return false;
    if (userCanonical === rowFirst || rowCanonical === userCanonical) return true;
    if (rowCanonical.startsWith(`${userCanonical} `) || userCanonical.startsWith(`${rowCanonical} `)) return true;
    return false;
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const csvText = await fetchText(SHEET_URL);
  const sheetRows = buildSheetRows(csvText);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_number TEXT');

    const orgResult = await client.query('SELECT id, name FROM organizations WHERE LOWER(name) = LOWER($1) LIMIT 1', [TARGET_ORG_NAME]);
    const org = orgResult.rows[0];
    if (!org) throw new Error(`Organization "${TARGET_ORG_NAME}" not found`);

    const usersResult = await client.query(
      'SELECT id, org_id, name, email, mobile_number FROM users WHERE org_id = $1 ORDER BY created_at ASC',
      [org.id]
    );
    const users = usersResult.rows;
    const allUsersResult = await client.query('SELECT id, org_id, name, email FROM users');
    const allUsers = allUsersResult.rows;

    const directSheetByCanonical = new Map(sheetRows.map((row) => [canonical(row.name), row]));
    const usedSheetNames = new Set();
    const matches = [];
    const ambiguous = [];
    const unmatchedUsers = [];

    for (const user of users) {
      const exact = directSheetByCanonical.get(canonical(user.name));
      if (exact) {
        matches.push({ user, row: exact, mode: 'exact' });
        usedSheetNames.add(canonical(exact.name));
        continue;
      }

      const candidates = getCandidateKeys(user, sheetRows).filter((row) => !usedSheetNames.has(canonical(row.name)));
      if (candidates.length === 1) {
        matches.push({ user, row: candidates[0], mode: 'alias' });
        usedSheetNames.add(canonical(candidates[0].name));
      } else if (candidates.length > 1) {
        ambiguous.push({ user: user.name, candidates: candidates.map((row) => row.name) });
      } else {
        unmatchedUsers.push(user.name);
      }
    }

    const emailOwners = new Map();
    allUsers.forEach((user) => {
      if (user.email) emailOwners.set(user.email.toLowerCase(), user);
    });

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const updatedUsers = [];
    const emailConflicts = [];

    await client.query('BEGIN');
    try {
      for (const match of matches) {
        const targetEmail = match.row.email.toLowerCase();
        const currentOwner = emailOwners.get(targetEmail);
        if (currentOwner && currentOwner.id !== match.user.id) {
          emailConflicts.push({
            user: match.user.name,
            currentEmail: match.user.email,
            targetEmail,
            matchedSheetName: match.row.name,
            ownedBy: currentOwner.name,
            ownedByOrgId: currentOwner.org_id,
          });
          continue;
        }

        await client.query(
          `
            UPDATE users
            SET email = $2,
                mobile_number = NULLIF($3, ''),
                password_hash = $4
            WHERE id = $1
          `,
          [match.user.id, targetEmail, match.row.mobileNumber, passwordHash]
        );
        emailOwners.set(targetEmail, { id: match.user.id, org_id: match.user.org_id, name: match.user.name, email: targetEmail });
        updatedUsers.push({
          name: match.user.name,
          matchedSheetName: match.row.name,
          email: targetEmail,
          mobileNumber: match.row.mobileNumber,
          mode: match.mode,
        });
      }

      await client.query(
        `
          UPDATE users
          SET password_hash = $2
          WHERE org_id = $1
            AND id <> ALL($3::uuid[])
        `,
        [org.id, passwordHash, updatedUsers.map((user) => matches.find((match) => match.user.name === user.name)?.user.id).filter(Boolean)]
      );

      if (updatedUsers.length === 0) {
        await client.query('UPDATE users SET password_hash = $2 WHERE org_id = $1', [org.id, passwordHash]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const unmatchedSheet = sheetRows
      .filter((row) => !usedSheetNames.has(canonical(row.name)))
      .map((row) => row.name);

    console.log(JSON.stringify({
      org: org.name,
      sheetRows: sheetRows.length,
      dbUsers: users.length,
      updatedCount: updatedUsers.length,
      passwordResetCount: users.length,
      ambiguousCount: ambiguous.length,
      emailConflictCount: emailConflicts.length,
      unmatchedUserCount: unmatchedUsers.length,
      unmatchedSheetCount: unmatchedSheet.length,
      updatedUsers,
      ambiguous,
      emailConflicts,
      unmatchedUsers,
      unmatchedSheet,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
