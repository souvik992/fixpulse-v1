require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { sendAssigneeNotification, sendPasswordResetEmail } = require('./utils/email');
const { randomUUID } = require('crypto');
const { PERMISSIONS } = require('./rbac/permissions');
const { checkPermission, assignSystemRole, getUserPermissions, LEGACY_TO_RBAC } = require('./rbac/middleware');
const { startGoogleSheetSync, getGoogleSheetSyncStatus } = require('./services/googleSheetSync');

// ── In-memory presence store ──────────────────────────────────────────────────
// Map<orgId, Map<userId, { lastSeen: Date, user: { id, name, avatar, color } }>>
const presenceStore = new Map();
const PRESENCE_TIMEOUT_MS = 45_000; // 45 s without heartbeat = offline

function getOrgPresence(orgId) {
  if (!presenceStore.has(orgId)) presenceStore.set(orgId, new Map());
  return presenceStore.get(orgId);
}

function markPresence(orgId, userId, userData) {
  const org = getOrgPresence(orgId);
  org.set(userId, { lastSeen: Date.now(), user: userData });
}

function removePresence(orgId, userId) {
  presenceStore.get(orgId)?.delete(userId);
}

function getOnlineUsers(orgId) {
  const org = getOrgPresence(orgId);
  const cutoff = Date.now() - PRESENCE_TIMEOUT_MS;
  const online = [];
  for (const [uid, entry] of org.entries()) {
    if (entry.lastSeen >= cutoff) online.push(entry.user);
    else org.delete(uid);
  }
  return online;
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bugtracker_dev_secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const camel = (row) => {
  if (!row) return null;
  const output = {};
  for (const key of Object.keys(row)) {
    output[key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())] = row[key];
  }
  return output;
};

const camels = (rows) => rows.map(camel);
const strip = (user) => {
  if (!user) return null;
  const { passwordHash, password_hash, ...safeUser } = user;
  return safeUser;
};

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

async function getBugContext(bugId, orgId) {
  const { rows } = await db.query(
    'SELECT id, project_id, assignee_id, status FROM bugs WHERE id=$1 AND org_id=$2',
    [bugId, orgId]
  );
  return rows[0] || null;
}

async function getProjectContext(projectId, orgId) {
  const { rows } = await db.query(
    'SELECT id, key, name FROM projects WHERE id=$1 AND org_id=$2',
    [projectId, orgId]
  );
  return rows[0] || null;
}

async function getScopedPermissions(req, projectId = null) {
  const perms = await getUserPermissions(req.user.id, req.user.orgId, projectId);
  req.userPermissions = perms;
  return perms;
}

async function getAssignableRole(roleId, orgId) {
  const { rows } = await db.query(
    'SELECT * FROM roles WHERE id=$1 AND (org_id=$2 OR (is_system=true AND org_id IS NULL))',
    [roleId, orgId]
  );
  return rows[0] || null;
}

async function assertUserInOrg(userId, orgId) {
  const { rows } = await db.query('SELECT id FROM users WHERE id=$1 AND org_id=$2', [userId, orgId]);
  return rows.length > 0;
}

function denyMissingPermission(res, permission) {
  return res.status(403).json({
    error: `Forbidden - ${permission} permission required`,
    required: permission,
  });
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name || 'attachment'),
      type: String(item.type || 'application/octet-stream'),
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
      dataUrl: String(item.dataUrl || ''),
    }))
    .filter((item) => item.dataUrl.startsWith('data:'));
}

async function enforceIssueWritePermissions(req, bug, changes) {
  const perms = await getScopedPermissions(req, bug.project_id);

  if (!perms.has(PERMISSIONS.MANAGE_PROJECT) && bug.assignee_id !== req.user.id) {
    return { status: 403, body: { error: 'You can only modify issues assigned to you' } };
  }

  const required = new Set();
  const editableFields = ['title', 'description', 'type', 'priority', 'labels', 'attachments', 'referenceLink', 'curlCommand'];

  if (editableFields.some((field) => changes[field] !== undefined)) {
    required.add(PERMISSIONS.EDIT_ISSUE);
  }
  if (changes.status !== undefined && String(changes.status) !== String(bug.status)) {
    required.add(PERMISSIONS.CHANGE_STATUS);
  }
  if (changes.assigneeId !== undefined || changes.assignee_id !== undefined) {
    required.add(PERMISSIONS.ASSIGN_ISSUE);
  }

  for (const permission of required) {
    if (!perms.has(permission)) {
      return {
        status: 403,
        body: {
          error: `Forbidden - ${permission} permission required`,
          required: permission,
        },
      };
    }
  }

  return { perms };
}


app.post('/api/auth/register-company', async (req, res) => {
  try {
    const { companyName, name, email, password, color = '#6366f1', avatarDataUrl } = req.body;
    if (!companyName || !name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (avatarDataUrl && !avatarDataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid avatar data URL' });

    const hash = await bcrypt.hash(password, 10);
    const avatar = avatarDataUrl || name.split(' ').map((word) => word[0]).join('').toUpperCase().slice(0, 2);
    let slug = slugify(companyName);

    const existingOrg = await db.query('SELECT id FROM organizations WHERE slug=$1', [slug]);
    if (existingOrg.rows.length) {
      slug = `${slug}-${Date.now()}`;
    }

    const emailCheck = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (emailCheck.rows.length) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const {
      rows: [org],
    } = await db.query(
      'INSERT INTO organizations (name,slug,color) VALUES ($1,$2,$3) RETURNING *',
      [companyName, slug, color]
    );

    const {
      rows: [user],
    } = await db.query(
      "INSERT INTO users (org_id,name,email,avatar,color,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6,'admin') RETURNING *", // Use avatarDataUrl if provided, else initials
      [org.id, name, email, avatar, color, hash]
    );
    await assignSystemRole(user.id, 'Admin', org.id);

    const token = jwt.sign(
      { id: user.id, orgId: org.id, email: user.email, name: user.name, role: 'admin' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({ token, user: strip(camel(user)), org: camel(org) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { rows } = await db.query(
      'SELECT u.*,o.name AS org_name,o.slug AS org_slug,o.color AS org_color FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.email=$1',
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const row = rows[0];
    if (!row.password_hash) {
      return res.status(401).json({ error: 'No password set - please ask your admin to reset it' });
    }
    if (!(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = camel(row);
    const org = { id: user.orgId, name: user.orgName, slug: user.orgSlug, color: user.orgColor };
    const token = jwt.sign(
      { id: user.id, orgId: user.orgId, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({ token, user: strip(user), org });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT u.*,o.name AS org_name,o.slug AS org_slug,o.color AS org_color FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.id=$1',
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    const user = camel(rows[0]);
    const org = { id: user.orgId, name: user.orgName, slug: user.orgSlug, color: user.orgColor };
    res.json({ user: strip(user), org });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', (_, res) => res.json({ success: true }));

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const { rows } = await db.query('SELECT id, name, email FROM users WHERE email=$1', [email]);
    // Always respond OK to prevent email enumeration
    if (!rows.length) return res.json({ success: true });

    const user  = rows[0];
    const token = randomUUID().replace(/-/g, '');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user.id]);
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, token, expires]
    );

    const appUrl  = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetUrl = `${appUrl}?reset_token=${token}`;

    await sendPasswordResetEmail({ toEmail: user.email, toName: user.name, resetUrl });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { rows } = await db.query(
      'SELECT * FROM password_reset_tokens WHERE token=$1 AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Reset link is invalid or has expired' });

    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, rows[0].user_id]);
    await db.query('DELETE FROM password_reset_tokens WHERE token=$1', [token]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/org', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM organizations WHERE id=$1', [req.user.orgId]);
    res.json(camel(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/org', auth, checkPermission(PERMISSIONS.CONFIGURE_WORKFLOW), async (req, res) => {
  try {
    const { name, color } = req.body;
    const { rows } = await db.query(
      'UPDATE organizations SET name=$1,color=$2 WHERE id=$3 RETURNING *',
      [name, color, req.user.orgId]
    );
    res.json(camel(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/members', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE org_id=$1 ORDER BY created_at ASC', [
      req.user.orgId,
    ]);
    res.json(camels(rows).map(strip));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/members', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { name, email, role = 'developer', color = '#6366f1', password, avatarDataUrl } = req.body;
    const allowedRoles = new Set(['admin', 'project_manager', 'developer', 'frontend_developer', 'backend_developer', 'tester', 'viewer', 'qa']);
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email required' });
    }
    if (!allowedRoles.has(role)) {
      return res.status(400).json({ error: 'Unsupported role' });
    }

    const tempPassword = password || 'Welcome@123';
    const hash = await bcrypt.hash(tempPassword, 10);
    const avatar = avatarDataUrl || name.split(' ').map((word) => word[0]).join('').toUpperCase().slice(0, 2);

    const exists = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const { rows } = await db.query(
      'INSERT INTO users (org_id,name,email,avatar,color,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user.orgId, name, email, avatar, color, hash, role] // Use avatarDataUrl if provided, else initials
    );

    // Sync RBAC: assign matching system role
    const rbacRole = LEGACY_TO_RBAC[role];
    if (rbacRole) await assignSystemRole(rows[0].id, rbacRole, req.user.orgId);

    res.status(201).json({ ...strip(camel(rows[0])), tempPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/members/:id', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { name, role, color, avatarDataUrl } = req.body;
    const allowedRoles = new Set(['admin', 'project_manager', 'developer', 'frontend_developer', 'backend_developer', 'tester', 'viewer', 'qa']);
    if (role && !allowedRoles.has(role)) {
      return res.status(400).json({ error: 'Unsupported role' });
    }
    if (avatarDataUrl && !avatarDataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid avatar data URL' });
    const { rows } = await db.query(
      'UPDATE users SET name=COALESCE($1,name),role=COALESCE($2,role),color=COALESCE($3,color),avatar=COALESCE($6,avatar) WHERE id=$4 AND org_id=$5 RETURNING *',
      [name, role, color, req.params.id, req.user.orgId, avatarDataUrl]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Sync RBAC: if role changed, replace global system role assignment
    if (role) {
      const rbacRole = LEGACY_TO_RBAC[role];
      if (rbacRole) {
        // Remove all existing system global roles for this user in this org
        await db.query(
          `DELETE FROM user_roles ur
           USING roles r
           WHERE ur.role_id = r.id AND ur.user_id=$1 AND ur.org_id=$2
             AND r.is_system=true AND ur.project_id IS NULL`,
          [req.params.id, req.user.orgId]
        );
        await assignSystemRole(req.params.id, rbacRole, req.user.orgId);
      }
    }

    res.json(strip(camel(rows[0])));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/members/:id', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You can't remove yourself" });
    }

    await db.query('DELETE FROM users WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/members/:id/reset-password', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const tempPassword = req.body.password || 'Welcome@123';
    const hash = await bcrypt.hash(tempPassword, 10);

    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND org_id=$3', [
      hash,
      req.params.id,
      req.user.orgId,
    ]);

    res.json({ success: true, tempPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM projects WHERE org_id=$1 ORDER BY created_at ASC', [
      req.user.orgId,
    ]);
    res.json(camels(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects', auth, checkPermission(PERMISSIONS.MANAGE_PROJECT), async (req, res) => {
  try {
    const { name, key, description = '', color = '#6366f1' } = req.body;
    const { rows } = await db.query(
      'INSERT INTO projects (org_id,name,key,description,color) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.orgId, name, key.toUpperCase(), description, color]
    );

    const project = camel(rows[0]);
    await db.query(
      'INSERT INTO project_sequences (project_id,next_num) VALUES ($1,1) ON CONFLICT DO NOTHING',
      [project.id]
    );

    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/projects/:id', auth, checkPermission(PERMISSIONS.MANAGE_PROJECT), async (req, res) => {
  try {
    await db.query('DELETE FROM projects WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bugs', auth, checkPermission(PERMISSIONS.VIEW_ISSUE), async (req, res) => {
  try {
    const { projectId, status, priority, type, assigneeId, search } = req.query;
    const conditions = ['org_id=$1'];
    const values = [req.user.orgId];
    let index = 2;

    if (projectId) {
      conditions.push(`project_id=$${index++}`);
      values.push(projectId);
    }
    if (status) {
      conditions.push(`status=$${index++}`);
      values.push(status);
    }
    if (priority) {
      conditions.push(`priority=$${index++}`);
      values.push(priority);
    }
    if (type) {
      conditions.push(`type=$${index++}`);
      values.push(type);
    }
    if (assigneeId) {
      conditions.push(`assignee_id=$${index++}`);
      values.push(assigneeId);
    }
    if (search) {
      conditions.push(`(title ILIKE $${index} OR description ILIKE $${index++})`);
      values.push(`%${search}%`);
    }

    const { rows } = await db.query(
      `SELECT * FROM bugs WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      values
    );

    res.json(camels(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bugs/:id', auth, checkPermission(PERMISSIONS.VIEW_ISSUE, {
  projectId: async (req) => {
    const bug = await getBugContext(req.params.id, req.user.orgId);
    return bug?.project_id || null;
  },
}), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM bugs WHERE id=$1 AND org_id=$2', [
      req.params.id,
      req.user.orgId,
    ]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    const bug = camel(rows[0]);
    const [comments, activity] = await Promise.all([
      db.query('SELECT * FROM comments WHERE bug_id=$1 ORDER BY created_at ASC', [req.params.id]),
      db.query('SELECT * FROM activity WHERE bug_id=$1 ORDER BY created_at ASC', [req.params.id]),
    ]);
    bug.comments = camels(comments.rows);
    bug.activity = camels(activity.rows);

    res.json(bug);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bugs', auth, checkPermission(PERMISSIONS.CREATE_ISSUE, {
  projectId: (req) => req.body.projectId,
}), async (req, res) => {
  try {
    const {
      projectId,
      title,
      description = '',
      type = 'Bug',
      priority = 'Medium',
      assigneeId,
      labels = [],
      attachments = [],
      referenceLink = '',
      curlCommand = '',
    } = req.body;
    const reporterId = req.user.id;

    const project = await getProjectContext(projectId, req.user.orgId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const perms = await getScopedPermissions(req, projectId);
    if (assigneeId && !perms.has(PERMISSIONS.ASSIGN_ISSUE)) {
      return denyMissingPermission(res, PERMISSIONS.ASSIGN_ISSUE);
    }

    const sequence = await db.query(
      'UPDATE project_sequences SET next_num=next_num+1 WHERE project_id=$1 RETURNING next_num-1 AS num',
      [projectId]
    );
    const number = sequence.rows[0]?.num ?? 1;

    const { rows } = await db.query(
      'INSERT INTO bugs (org_id,key,project_id,title,description,type,priority,assignee_id,reporter_id,labels,attachments,reference_link,curl_command) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [
        req.user.orgId,
        `${project.key}-${number}`,
        projectId,
        title,
        description,
        type,
        priority,
        assigneeId || null,
        reporterId,
        labels,
        JSON.stringify(normalizeAttachments(attachments)),
        String(referenceLink || ''),
        String(curlCommand || ''),
      ]
    );

    const bug = camel(rows[0]);
    await db.query("INSERT INTO activity (bug_id,user_id,type,note) VALUES ($1,$2,'created','Issue created')", [
      bug.id,
      reporterId,
    ]);

    bug.comments = [];
    bug.activity = [{ type: 'created', note: 'Issue created' }];
    res.status(201).json(bug);

    // Send email notification to assignee (non-blocking)
    if (assigneeId) {
      db.query('SELECT name, email FROM users WHERE id=$1', [assigneeId])
        .then(({ rows }) => {
          if (!rows.length) return;
          return sendAssigneeNotification({
            assigneeEmail: rows[0].email,
            assigneeName:  rows[0].name,
            reporterName:  req.user.name,
            bug,
            appUrl: process.env.APP_URL,
          });
        })
        .catch((err) => console.warn('Email notification failed:', err.message));
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/bugs/:id', auth, async (req, res) => {
  try {
    const bugContext = await getBugContext(req.params.id, req.user.orgId);
    if (!bugContext) {
      return res.status(404).json({ error: 'Not found' });
    }

    const permissionCheck = await enforceIssueWritePermissions(req, bugContext, req.body);
    if (permissionCheck.status) {
      return res.status(permissionCheck.status).json(permissionCheck.body);
    }

    const { rows: previousRows } = await db.query('SELECT * FROM bugs WHERE id=$1 AND org_id=$2', [
      req.params.id,
      req.user.orgId,
    ]);

    const fieldMap = { assigneeId: 'assignee_id' };
    const sets = [];
    const values = [];
    let index = 1;

    for (const [key, value] of Object.entries(req.body)) {
      const column = fieldMap[key] || key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!['title', 'description', 'type', 'priority', 'status', 'assignee_id', 'labels', 'attachments', 'reference_link', 'curl_command'].includes(column)) {
        continue;
      }
      sets.push(`${column}=$${index++}`);
      if (column === 'attachments') {
        values.push(JSON.stringify(normalizeAttachments(value)));
      } else if (column === 'reference_link' || column === 'curl_command') {
        values.push(String(value || ''));
      } else {
        values.push(value === '' ? null : value);
      }
    }

    if (sets.length) {
      values.push(req.params.id);
      await db.query(`UPDATE bugs SET ${sets.join(',')} WHERE id=$${index}`, values);
    }

    for (const field of ['status', 'priority', 'assigneeId', 'type', 'referenceLink', 'curlCommand']) {
      const column = fieldMap[field] || field.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (
        req.body[field] !== undefined &&
        String(req.body[field]) !== String(previousRows[0][column])
      ) {
        await db.query(
          "INSERT INTO activity (bug_id,user_id,type,field,from_value,to_value) VALUES ($1,$2,'changed',$3,$4,$5)",
          [req.params.id, req.user.id, field, previousRows[0][column], req.body[field]]
        );
      }
    }

    const { rows } = await db.query('SELECT * FROM bugs WHERE id=$1', [req.params.id]);
    const bug = camel(rows[0]);
    const [comments, activity] = await Promise.all([
      db.query('SELECT * FROM comments WHERE bug_id=$1 ORDER BY created_at ASC', [req.params.id]),
      db.query('SELECT * FROM activity WHERE bug_id=$1 ORDER BY created_at ASC', [req.params.id]),
    ]);
    bug.comments = camels(comments.rows);
    bug.activity = camels(activity.rows);

    res.json(bug);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/bugs/:id', auth, checkPermission(PERMISSIONS.DELETE_ISSUE, {
  projectId: async (req) => {
    const bug = await getBugContext(req.params.id, req.user.orgId);
    return bug?.project_id || null;
  },
}), async (req, res) => {
  try {
    await db.query('DELETE FROM bugs WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bugs/:id/comments', auth, checkPermission(PERMISSIONS.COMMENT, {
  projectId: async (req) => {
    const bug = await getBugContext(req.params.id, req.user.orgId);
    return bug?.project_id || null;
  },
}), async (req, res) => {
  try {
    const { text } = req.body;
    const { rows } = await db.query(
      'INSERT INTO comments (bug_id,author_id,text) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user.id, text]
    );
    res.status(201).json(camel(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/bugs/:id/comments/:cid', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM comments WHERE id=$1 AND bug_id=$2', [req.params.cid, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', auth, checkPermission(PERMISSIONS.VIEW_REPORTS), async (req, res) => {
  try {
    const { projectId } = req.query;
    const perms = await getScopedPermissions(req, projectId || null);
    if (!perms.has(PERMISSIONS.VIEW_REPORTS)) {
      return denyMissingPermission(res, PERMISSIONS.VIEW_REPORTS);
    }

    const filters = ['org_id = $1'];
    const values = [req.user.orgId];

    if (projectId) {
      filters.push(`project_id = $${values.length + 1}`);
      values.push(projectId);
    }

    const where = filters.join(' AND ');
    const dailyFilters = ['b.org_id = $1'];
    if (projectId) {
      dailyFilters.push('b.project_id = $2');
    }
    const dailyWhere = dailyFilters.join(' AND ');

    const [statusRows, priorityRows, typeRows, totals, daily] = await Promise.all([
      db.query(`SELECT status,COUNT(*)::int AS cnt FROM bugs WHERE ${where} GROUP BY status`, values),
      db.query(`SELECT priority,COUNT(*)::int AS cnt FROM bugs WHERE ${where} GROUP BY priority`, values),
      db.query(`SELECT type,COUNT(*)::int AS cnt FROM bugs WHERE ${where} GROUP BY type`, values),
      db.query(
        `SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status!='Done')::int AS open_count,COUNT(*) FILTER (WHERE status='Done')::int AS done_count FROM bugs WHERE ${where}`,
        values
      ),
      db.query(
        `SELECT to_char(d::date,'Mon DD') AS label,COUNT(b.id)::int AS count
         FROM generate_series(NOW()-INTERVAL '6 days',NOW(),INTERVAL '1 day') d
         LEFT JOIN bugs b ON b.created_at::date=d::date AND ${dailyWhere}
         GROUP BY d
         ORDER BY d`,
        values
      ),
    ]);

    const byStatus = { 'To Do': 0, 'In Progress': 0, 'In Review': 0, Done: 0 };
    const byPriority = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    const byType = { Bug: 0, Feature: 0, Task: 0, Improvement: 0 };

    statusRows.rows.forEach((row) => {
      if (row.status in byStatus) byStatus[row.status] = row.cnt;
    });
    priorityRows.rows.forEach((row) => {
      if (row.priority in byPriority) byPriority[row.priority] = row.cnt;
    });
    typeRows.rows.forEach((row) => {
      if (row.type in byType) byType[row.type] = row.cnt;
    });

    res.json({
      total: totals.rows[0].total,
      openCount: totals.rows[0].open_count,
      doneCount: totals.rows[0].done_count,
      byStatus,
      byPriority,
      byType,
      daily: daily.rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  RBAC API
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rbac/permissions — all available permission constants
app.get('/api/rbac/permissions', auth, async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM permissions ORDER BY name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rbac/roles — all roles (system + org-specific)
app.get('/api/rbac/roles', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, COALESCE(json_agg(p.name) FILTER (WHERE p.name IS NOT NULL), '[]') AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE r.org_id IS NULL OR r.org_id = $1
       GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
      [req.user.orgId]
    );
    res.json(rows.map(camel));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rbac/roles — create a custom org role (admin only)
app.post('/api/rbac/roles', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { name, description = '', color = '#6366f1', permissions: perms = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Role name required' });

    const { rows: permissionRows } = await db.query(
      'SELECT name FROM permissions WHERE name = ANY($1::text[])',
      [perms]
    );
    if (permissionRows.length !== perms.length) {
      return res.status(400).json({ error: 'One or more permissions are invalid' });
    }

    const { rows: [role] } = await db.query(
      'INSERT INTO roles (org_id,name,description,color,is_system) VALUES ($1,$2,$3,$4,false) RETURNING *',
      [req.user.orgId, name.trim(), description, color]
    );

    if (perms.length) {
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE name = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [role.id, perms]
      );
    }
    res.status(201).json(camel(role));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/rbac/roles/:id/permissions — replace permission set on a role
app.put('/api/rbac/roles/:id/permissions', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { permissions: perms = [] } = req.body;
    const role = await getAssignableRole(req.params.id, req.user.orgId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(403).json({ error: 'Cannot modify system role permissions' });

    const { rows: permissionRows } = await db.query(
      'SELECT name FROM permissions WHERE name = ANY($1::text[])',
      [perms]
    );
    if (permissionRows.length !== perms.length) {
      return res.status(400).json({ error: 'One or more permissions are invalid' });
    }

    await db.query('DELETE FROM role_permissions WHERE role_id=$1', [req.params.id]);
    if (perms.length) {
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE name = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [req.params.id, perms]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/rbac/roles/:id/permissions', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { permission } = req.body;
    if (!permission) return res.status(400).json({ error: 'permission required' });

    const role = await getAssignableRole(req.params.id, req.user.orgId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(403).json({ error: 'Cannot modify system role permissions' });

    const { rows: [permRow] } = await db.query('SELECT id FROM permissions WHERE name=$1', [permission]);
    if (!permRow) return res.status(404).json({ error: 'Permission not found' });

    await db.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, permRow.id]
    );
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/rbac/roles/:id/permissions/:permission', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const role = await getAssignableRole(req.params.id, req.user.orgId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(403).json({ error: 'Cannot modify system role permissions' });

    await db.query(
      `DELETE FROM role_permissions rp
       USING permissions p
       WHERE rp.role_id=$1 AND rp.permission_id=p.id AND p.name=$2`,
      [req.params.id, req.params.permission]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/rbac/roles/:id — delete a custom org role
app.delete('/api/rbac/roles/:id', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { rows: [role] } = await db.query('SELECT * FROM roles WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    await db.query('DELETE FROM roles WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rbac/users/:userId/roles — get roles assigned to a user
app.get('/api/rbac/users/:userId/roles', auth, async (req, res) => {
  try {
    const canManage = (await getScopedPermissions(req)).has(PERMISSIONS.MANAGE_USERS);
    if (!canManage && req.params.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden - MANAGE_USERS permission required' });
    }

    const { rows } = await db.query(
      `SELECT ur.id, ur.project_id, r.name, r.color, r.is_system,
              p.name AS project_name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN projects p ON p.id = ur.project_id
       WHERE ur.user_id=$1 AND ur.org_id=$2
       ORDER BY ur.project_id NULLS FIRST, r.name`,
      [req.params.userId, req.user.orgId]
    );
    res.json(rows.map(camel));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rbac/users/:userId/roles — assign a role to a user (global or project-level)
app.post('/api/rbac/users/:userId/roles', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { roleId, projectId = null } = req.body;
    if (!roleId) return res.status(400).json({ error: 'roleId required' });

    const userExists = await assertUserInOrg(req.params.userId, req.user.orgId);
    if (!userExists) return res.status(404).json({ error: 'User not found' });

    const role = await getAssignableRole(roleId, req.user.orgId);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    if (projectId) {
      const project = await getProjectContext(projectId, req.user.orgId);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    }

    const col = projectId
      ? 'INSERT INTO user_roles (user_id,role_id,org_id,project_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *'
      : 'INSERT INTO user_roles (user_id,role_id,org_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *';
    const vals = projectId
      ? [req.params.userId, roleId, req.user.orgId, projectId]
      : [req.params.userId, roleId, req.user.orgId];

    const { rows } = await db.query(col, vals);
    res.status(201).json(rows[0] ? camel(rows[0]) : { message: 'Already assigned' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/rbac/users/:userId/roles/:userRoleId — remove a role from a user
app.delete('/api/rbac/users/:userId/roles/:userRoleId', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    await db.query(
      'DELETE FROM user_roles WHERE id=$1 AND user_id=$2 AND org_id=$3',
      [req.params.userRoleId, req.params.userId, req.user.orgId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rbac/me/permissions — current user's effective permissions (optionally scoped to project)
app.get('/api/rbac/me/permissions', auth, async (req, res) => {
  try {
    const projectId = req.query.projectId || null;
    const perms = await getUserPermissions(req.user.id, req.user.orgId, projectId);
    res.json({ permissions: [...perms] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rbac/users/:userId/permissions', auth, async (req, res) => {
  try {
    const canManage = (await getScopedPermissions(req)).has(PERMISSIONS.MANAGE_USERS);
    if (!canManage && req.params.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden - MANAGE_USERS permission required' });
    }

    const userExists = await assertUserInOrg(req.params.userId, req.user.orgId);
    if (!userExists) return res.status(404).json({ error: 'User not found' });

    const projectId = req.query.projectId || null;
    if (projectId) {
      const project = await getProjectContext(projectId, req.user.orgId);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    }

    const perms = await getUserPermissions(req.params.userId, req.user.orgId, projectId);
    res.json({ permissions: [...perms] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Presence ────────────────────────────────────────────────────────────────
// POST /api/presence/heartbeat — client calls every 30 s to stay "online"
app.post('/api/presence/heartbeat', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, avatar, color FROM users WHERE id=$1 AND org_id=$2',
      [req.user.id, req.user.orgId]
    );
    if (!rows[0]) return res.sendStatus(204);
    const { id, name, avatar, color } = rows[0];
    markPresence(req.user.orgId, id, { id, name, avatar, color });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/presence/offline — called via sendBeacon on tab close
// Token comes in the JSON body because sendBeacon cannot set auth headers
app.post('/api/presence/offline', (req, res) => {
  try {
    const token = req.body?.token;
    if (!token) return res.sendStatus(204);
    const payload = jwt.verify(token, JWT_SECRET);
    removePresence(payload.orgId, payload.id);
  } catch { /* invalid token — ignore */ }
  res.sendStatus(204);
});

// GET /api/presence — returns online users in same org
app.get('/api/presence', auth, (req, res) => {
  res.json(getOnlineUsers(req.user.orgId));
});

app.get('/api/sheet-sync/status', auth, async (req, res) => {
  try {
    const canManage = (await getScopedPermissions(req)).has(PERMISSIONS.MANAGE_PROJECT);
    if (!canManage) {
      return res.status(403).json({ error: 'Forbidden - MANAGE_PROJECT permission required' });
    }
    res.json(getGoogleSheetSyncStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => {
  try {
    await db.connect();
    app.listen(PORT, () => {
      console.log(`\nBugTracker      ->  http://localhost:${PORT}`);
      console.log('Storage         ->  PostgreSQL');
      console.log('Multi-tenant    ->  enabled');
      console.log('JWT Auth        ->  enabled\n');
      startGoogleSheetSync();
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();
