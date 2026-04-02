require('dotenv').config();

const { Client } = require('pg');

function titleCase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function splitNames(raw) {
  return String(raw || '')
    .split(/,|\/|&|\band\b/gi)
    .map((value) => titleCase(value))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

function getMetadataValue(description, label) {
  const prefix = `${label}:`;
  const line = String(description || '')
    .split('\n')
    .find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function getFirstMetadataValue(description, labels) {
  for (const label of labels) {
    const value = getMetadataValue(description, label);
    if (value) return value;
  }
  return '';
}

function getInitials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function makeColor(seed) {
  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#38bdf8', '#ec4899', '#8b5cf6', '#14b8a6'];
  const hash = [...String(seed || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function makePlaceholderEmail(name, usedEmails) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'user';
  let suffix = 1;
  let email = `${base}@sheet-import.local`;
  while (usedEmails.has(email)) {
    suffix += 1;
    email = `${base}.${suffix}@sheet-import.local`;
  }
  usedEmails.add(email);
  return email;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const { rows: existingUsers } = await client.query('SELECT id, org_id, name, email FROM users');
    const userByOrgAndName = new Map(
      existingUsers.map((user) => [`${user.org_id}:${user.name.toLowerCase()}`, user])
    );
    const usedEmails = new Set(existingUsers.map((user) => String(user.email || '').toLowerCase()).filter(Boolean));

    const { rows: roleRows } = await client.query(
      'SELECT id FROM roles WHERE org_id IS NULL AND LOWER(name) = LOWER($1) LIMIT 1',
      ['developer']
    );
    const developerRoleId = roleRows[0]?.id || null;

    const { rows: bugs } = await client.query(`
      SELECT id, org_id, key, title, description
      FROM bugs
      WHERE assignee_id IS NULL
      ORDER BY created_at ASC
    `);

    let createdUsers = 0;
    let updatedBugs = 0;
    let skippedBugs = 0;
    const skippedSamples = [];

    await client.query('BEGIN');
    try {
      for (const bug of bugs) {
        const assigneeNames = splitNames(getFirstMetadataValue(bug.description, ['Assignee(s)', 'Assignee From Sheet']));
        const assigneeName = assigneeNames[0];

        if (!assigneeName) {
          skippedBugs += 1;
          if (skippedSamples.length < 8) {
            skippedSamples.push({
              key: bug.key || bug.id,
              title: bug.title,
              assigneeLine: String(bug.description || '')
                .split('\n')
                .find((entry) => /assignee/i.test(entry)) || null,
            });
          }
          continue;
        }

        const mapKey = `${bug.org_id}:${assigneeName.toLowerCase()}`;
        let user = userByOrgAndName.get(mapKey);

        if (!user) {
          const email = makePlaceholderEmail(assigneeName, usedEmails);
          const { rows } = await client.query(
            `INSERT INTO users (org_id, name, email, avatar, color, password_hash, role)
             VALUES ($1, $2, $3, $4, $5, NULL, 'developer')
             RETURNING id, org_id, name, email`,
            [bug.org_id, assigneeName, email, getInitials(assigneeName), makeColor(assigneeName)]
          );
          user = rows[0];
          userByOrgAndName.set(mapKey, user);
          createdUsers += 1;

          if (developerRoleId) {
            await client.query(
              `INSERT INTO user_roles (user_id, role_id, org_id, project_id)
               SELECT $1, $2, $3, NULL
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM user_roles
                 WHERE user_id = $1
                   AND role_id = $2
                   AND org_id = $3
                   AND project_id IS NULL
               )`,
              [user.id, developerRoleId, bug.org_id]
            );
          }
        }

        const result = await client.query(
          'UPDATE bugs SET assignee_id = $2 WHERE id = $1 AND assignee_id IS NULL',
          [bug.id, user.id]
        );

        if (result.rowCount > 0) {
          updatedBugs += 1;
          console.log(`Assigned ${bug.key || bug.id} -> ${assigneeName}`);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log(JSON.stringify({ updatedBugs, createdUsers, skippedBugs, skippedSamples }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
