require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bugtracker_dev_secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

app.use(cors());
app.use(express.json());
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

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

app.post('/api/auth/register-company', async (req, res) => {
  try {
    const { companyName, name, email, password, color = '#6366f1' } = req.body;
    if (!companyName || !name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const hash = await bcrypt.hash(password, 10);
    const avatar = name.split(' ').map((word) => word[0]).join('').toUpperCase().slice(0, 2);
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
      "INSERT INTO users (org_id,name,email,avatar,color,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6,'admin') RETURNING *",
      [org.id, name, email, avatar, color, hash]
    );

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

app.get('/api/org', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM organizations WHERE id=$1', [req.user.orgId]);
    res.json(camel(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/org', auth, adminOnly, async (req, res) => {
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

app.post('/api/members', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, role = 'developer', color = '#6366f1', password } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email required' });
    }

    const tempPassword = password || 'Welcome@123';
    const hash = await bcrypt.hash(tempPassword, 10);
    const avatar = name.split(' ').map((word) => word[0]).join('').toUpperCase().slice(0, 2);

    const exists = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const { rows } = await db.query(
      'INSERT INTO users (org_id,name,email,avatar,color,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user.orgId, name, email, avatar, color, hash, role]
    );

    res.status(201).json({ ...strip(camel(rows[0])), tempPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/members/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, role, color } = req.body;
    const { rows } = await db.query(
      'UPDATE users SET name=COALESCE($1,name),role=COALESCE($2,role),color=COALESCE($3,color) WHERE id=$4 AND org_id=$5 RETURNING *',
      [name, role, color, req.params.id, req.user.orgId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(strip(camel(rows[0])));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/members/:id', auth, adminOnly, async (req, res) => {
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

app.post('/api/members/:id/reset-password', auth, adminOnly, async (req, res) => {
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

app.post('/api/projects', auth, async (req, res) => {
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

app.delete('/api/projects/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM projects WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bugs', auth, async (req, res) => {
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

app.get('/api/bugs/:id', auth, async (req, res) => {
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

app.post('/api/bugs', auth, async (req, res) => {
  try {
    const {
      projectId,
      title,
      description = '',
      type = 'Bug',
      priority = 'Medium',
      assigneeId,
      labels = [],
    } = req.body;
    const reporterId = req.user.id;

    const sequence = await db.query(
      'UPDATE project_sequences SET next_num=next_num+1 WHERE project_id=$1 RETURNING next_num-1 AS num',
      [projectId]
    );
    const number = sequence.rows[0]?.num ?? 1;
    const project = await db.query('SELECT key FROM projects WHERE id=$1', [projectId]);

    const { rows } = await db.query(
      'INSERT INTO bugs (org_id,key,project_id,title,description,type,priority,assignee_id,reporter_id,labels) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [
        req.user.orgId,
        `${project.rows[0].key}-${number}`,
        projectId,
        title,
        description,
        type,
        priority,
        assigneeId || null,
        reporterId,
        labels,
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/bugs/:id', auth, async (req, res) => {
  try {
    const { rows: previousRows } = await db.query('SELECT * FROM bugs WHERE id=$1 AND org_id=$2', [
      req.params.id,
      req.user.orgId,
    ]);

    if (!previousRows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    const fieldMap = { assigneeId: 'assignee_id' };
    const sets = [];
    const values = [];
    let index = 1;

    for (const [key, value] of Object.entries(req.body)) {
      const column = fieldMap[key] || key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!['title', 'description', 'type', 'priority', 'status', 'assignee_id', 'labels'].includes(column)) {
        continue;
      }
      sets.push(`${column}=$${index++}`);
      values.push(value === '' ? null : value);
    }

    if (sets.length) {
      values.push(req.params.id);
      await db.query(`UPDATE bugs SET ${sets.join(',')} WHERE id=$${index}`, values);
    }

    for (const field of ['status', 'priority', 'assigneeId', 'type']) {
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

app.delete('/api/bugs/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM bugs WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bugs/:id/comments', auth, async (req, res) => {
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

app.get('/api/stats', auth, async (req, res) => {
  try {
    const { projectId } = req.query;
    const orgFilter = `org_id='${req.user.orgId}'`;
    const filter = projectId ? `${orgFilter} AND project_id='${projectId}'` : orgFilter;

    const [statusRows, priorityRows, typeRows, totals, daily] = await Promise.all([
      db.query(`SELECT status,COUNT(*)::int AS cnt FROM bugs WHERE ${filter} GROUP BY status`),
      db.query(`SELECT priority,COUNT(*)::int AS cnt FROM bugs WHERE ${filter} GROUP BY priority`),
      db.query(`SELECT type,COUNT(*)::int AS cnt FROM bugs WHERE ${filter} GROUP BY type`),
      db.query(
        `SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status!='Done')::int AS open_count,COUNT(*) FILTER (WHERE status='Done')::int AS done_count FROM bugs WHERE ${filter}`
      ),
      db.query(
        `SELECT to_char(d::date,'Mon DD') AS label,COUNT(b.id)::int AS count FROM generate_series(NOW()-INTERVAL '6 days',NOW(),INTERVAL '1 day') d LEFT JOIN bugs b ON b.created_at::date=d::date AND b.${filter} GROUP BY d ORDER BY d`
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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => {
  try {
    await db.connect();
    app.listen(PORT, () => {
      console.log(`\nBugTracker      ->  http://localhost:${PORT}`);
      console.log('Storage         ->  PostgreSQL');
      console.log('Multi-tenant    ->  enabled');
      console.log('JWT Auth        ->  enabled\n');
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();
