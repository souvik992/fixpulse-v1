require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db       = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET  = process.env.JWT_SECRET  || 'bugtracker_dev_secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';
const DATA_FILE   = path.join(__dirname, 'data', 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── camelCase helpers ─────────────────────────────────────────────────────────
const camel  = r => { if (!r) return null; const o={}; for (const k of Object.keys(r)) o[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]=r[k]; return o; };
const camels = r => r.map(camel);
const strip  = u => { if (!u) return null; const {passwordHash,password_hash,...s}=u; return s; };

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(h.split(' ')[1], JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalid or expired' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── JSON fallback ─────────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DATA_FILE)) return initDB();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return initDB(); }
}
function saveDB(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
function initDB() {
  if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const d = { orgs:[], users:[], projects:[], bugs:[], nextBugNum:{} };
  saveDB(d); return d;
}
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }

// ═══════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════

// POST /api/auth/register-company  — creates org + first admin
app.post('/api/auth/register-company', async (req, res) => {
  try {
    const { companyName, name, email, password, color='#6366f1' } = req.body;
    if (!companyName||!name||!email||!password) return res.status(400).json({ error:'All fields are required' });
    if (password.length < 6) return res.status(400).json({ error:'Password must be at least 6 characters' });

    const hash   = await bcrypt.hash(password, 10);
    const avatar = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    let slug     = slugify(companyName);

    if (db.isConnected()) {
      // ensure unique slug
      const exists = await db.query('SELECT id FROM organizations WHERE slug=$1', [slug]);
      if (exists.rows.length) slug = `${slug}-${Date.now()}`;
      const emailCheck = await db.query('SELECT id FROM users WHERE email=$1',[email]);
      if (emailCheck.rows.length) return res.status(409).json({ error:'Email already registered' });
      const { rows:[org] } = await db.query('INSERT INTO organizations (name,slug,color) VALUES ($1,$2,$3) RETURNING *',[companyName,slug,color]);
      const { rows:[user] } = await db.query('INSERT INTO users (org_id,name,email,avatar,color,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6,\'admin\') RETURNING *',[org.id,name,email,avatar,color,hash]);
      const token = jwt.sign({ id:user.id, orgId:org.id, email:user.email, name:user.name, role:'admin' }, JWT_SECRET, { expiresIn:JWT_EXPIRES });
      return res.status(201).json({ token, user:strip(camel(user)), org:camel(org) });
    }

    const d = loadDB();
    if (d.orgs.find(o=>o.slug===slug)) slug=`${slug}-${Date.now()}`;
    if (d.users.find(u=>u.email===email)) return res.status(409).json({ error:'Email already registered' });
    const org  = { id:uuidv4(), name:companyName, slug, color, createdAt:new Date().toISOString() };
    const user = { id:uuidv4(), orgId:org.id, name, email, avatar, color, role:'admin', passwordHash:hash, createdAt:new Date().toISOString() };
    d.orgs.push(org); d.users.push(user); saveDB(d);
    const token = jwt.sign({ id:user.id, orgId:org.id, email:user.email, name:user.name, role:'admin' }, JWT_SECRET, { expiresIn:JWT_EXPIRES });
    res.status(201).json({ token, user:strip(user), org });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error:'Email and password required' });

    if (db.isConnected()) {
      const { rows } = await db.query('SELECT u.*,o.name AS org_name,o.slug AS org_slug,o.color AS org_color FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.email=$1',[email]);
      if (!rows.length) return res.status(401).json({ error:'Invalid email or password' });
      const row = rows[0];
      if (!row.password_hash) return res.status(401).json({ error:'No password set – please ask your admin to reset it' });
      if (!await bcrypt.compare(password, row.password_hash)) return res.status(401).json({ error:'Invalid email or password' });
      const user = camel(row);
      const org  = { id:user.orgId, name:user.orgName, slug:user.orgSlug, color:user.orgColor };
      const token = jwt.sign({ id:user.id, orgId:user.orgId, email:user.email, name:user.name, role:user.role }, JWT_SECRET, { expiresIn:JWT_EXPIRES });
      return res.json({ token, user:strip(user), org });
    }

    const d = loadDB();
    const user = d.users.find(u=>u.email===email);
    if (!user) return res.status(401).json({ error:'Invalid email or password' });
    if (!user.passwordHash) return res.status(401).json({ error:'No password set – please ask your admin' });
    if (!await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ error:'Invalid email or password' });
    const org = d.orgs.find(o=>o.id===user.orgId);
    const token = jwt.sign({ id:user.id, orgId:user.orgId, email:user.email, name:user.name, role:user.role }, JWT_SECRET, { expiresIn:JWT_EXPIRES });
    res.json({ token, user:strip(user), org });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// GET /api/auth/me
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    if (db.isConnected()) {
      const { rows } = await db.query('SELECT u.*,o.name AS org_name,o.slug AS org_slug,o.color AS org_color FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.id=$1',[req.user.id]);
      if (!rows.length) return res.status(404).json({ error:'Not found' });
      const user = camel(rows[0]);
      const org  = { id:user.orgId, name:user.orgName, slug:user.orgSlug, color:user.orgColor };
      return res.json({ user:strip(user), org });
    }
    const d = loadDB();
    const user = d.users.find(u=>u.id===req.user.id);
    if (!user) return res.status(404).json({ error:'Not found' });
    const org = d.orgs.find(o=>o.id===user.orgId);
    res.json({ user:strip(user), org });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.post('/api/auth/logout', (_,res) => res.json({ success:true }));

// ═══════════════════════════════════════════════════════════════
//  ORGANIZATION
// ═══════════════════════════════════════════════════════════════

// GET /api/org  — current org info
app.get('/api/org', auth, async (req, res) => {
  try {
    if (db.isConnected()) {
      const { rows } = await db.query('SELECT * FROM organizations WHERE id=$1',[req.user.orgId]);
      return res.json(camel(rows[0]));
    }
    res.json(loadDB().orgs.find(o=>o.id===req.user.orgId)||{});
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// PUT /api/org  — update org (admin only)
app.put('/api/org', auth, adminOnly, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (db.isConnected()) {
      const { rows } = await db.query('UPDATE organizations SET name=$1,color=$2 WHERE id=$3 RETURNING *',[name,color,req.user.orgId]);
      return res.json(camel(rows[0]));
    }
    const d=loadDB(), idx=d.orgs.findIndex(o=>o.id===req.user.orgId);
    if (idx===-1) return res.status(404).json({ error:'Not found' });
    d.orgs[idx]={...d.orgs[idx],name,color}; saveDB(d); res.json(d.orgs[idx]);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  MEMBERS  (org-scoped users)
// ═══════════════════════════════════════════════════════════════

// GET /api/members
app.get('/api/members', auth, async (req, res) => {
  try {
    if (db.isConnected()) {
      const { rows } = await db.query('SELECT * FROM users WHERE org_id=$1 ORDER BY created_at ASC',[req.user.orgId]);
      return res.json(camels(rows).map(strip));
    }
    res.json(loadDB().users.filter(u=>u.orgId===req.user.orgId).map(strip));
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// POST /api/members  — admin adds a member (sets temp password)
app.post('/api/members', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, role='developer', color='#6366f1', password } = req.body;
    if (!name||!email) return res.status(400).json({ error:'Name and email required' });
    const pwd    = password || 'Welcome@123';
    const hash   = await bcrypt.hash(pwd, 10);
    const avatar = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);

    if (db.isConnected()) {
      const exists = await db.query('SELECT id FROM users WHERE email=$1',[email]);
      if (exists.rows.length) return res.status(409).json({ error:'Email already exists' });
      const { rows } = await db.query('INSERT INTO users (org_id,name,email,avatar,color,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.user.orgId,name,email,avatar,color,hash,role]);
      return res.status(201).json({ ...strip(camel(rows[0])), tempPassword:pwd });
    }
    const d = loadDB();
    if (d.users.find(u=>u.email===email)) return res.status(409).json({ error:'Email already exists' });
    const user = { id:uuidv4(), orgId:req.user.orgId, name, email, avatar, color, role, passwordHash:hash, createdAt:new Date().toISOString() };
    d.users.push(user); saveDB(d);
    res.status(201).json({ ...strip(user), tempPassword:pwd });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// PUT /api/members/:id  — update role / name / color (admin only)
app.put('/api/members/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, role, color } = req.body;
    if (db.isConnected()) {
      const { rows } = await db.query('UPDATE users SET name=COALESCE($1,name),role=COALESCE($2,role),color=COALESCE($3,color) WHERE id=$4 AND org_id=$5 RETURNING *',[name,role,color,req.params.id,req.user.orgId]);
      if (!rows.length) return res.status(404).json({ error:'Not found' });
      return res.json(strip(camel(rows[0])));
    }
    const d=loadDB(), idx=d.users.findIndex(u=>u.id===req.params.id&&u.orgId===req.user.orgId);
    if (idx===-1) return res.status(404).json({ error:'Not found' });
    d.users[idx]={...d.users[idx],...(name&&{name}),...(role&&{role}),...(color&&{color})}; saveDB(d);
    res.json(strip(d.users[idx]));
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// DELETE /api/members/:id  — remove member (admin only, can't remove self)
app.delete('/api/members/:id', auth, adminOnly, async (req, res) => {
  try {
    if (req.params.id===req.user.id) return res.status(400).json({ error:"You can't remove yourself" });
    if (db.isConnected()) {
      await db.query('DELETE FROM users WHERE id=$1 AND org_id=$2',[req.params.id,req.user.orgId]);
      return res.json({ success:true });
    }
    const d=loadDB(); d.users=d.users.filter(u=>!(u.id===req.params.id&&u.orgId===req.user.orgId)); saveDB(d);
    res.json({ success:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// POST /api/members/:id/reset-password  — admin resets a member's password
app.post('/api/members/:id/reset-password', auth, adminOnly, async (req, res) => {
  try {
    const newPwd = req.body.password || 'Welcome@123';
    const hash   = await bcrypt.hash(newPwd, 10);
    if (db.isConnected()) {
      await db.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND org_id=$3',[hash,req.params.id,req.user.orgId]);
      return res.json({ success:true, tempPassword:newPwd });
    }
    const d=loadDB(), u=d.users.find(u=>u.id===req.params.id&&u.orgId===req.user.orgId);
    if (!u) return res.status(404).json({ error:'Not found' });
    u.passwordHash=hash; saveDB(d); res.json({ success:true, tempPassword:newPwd });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  PROJECTS  (org-scoped)
// ═══════════════════════════════════════════════════════════════
app.get('/api/projects', auth, async (req, res) => {
  try {
    if (db.isConnected()) { const {rows}=await db.query('SELECT * FROM projects WHERE org_id=$1 ORDER BY created_at ASC',[req.user.orgId]); return res.json(camels(rows)); }
    res.json(loadDB().projects.filter(p=>p.orgId===req.user.orgId));
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.post('/api/projects', auth, async (req, res) => {
  try {
    const { name, key, description='', color='#6366f1' } = req.body;
    if (db.isConnected()) {
      const {rows}=await db.query('INSERT INTO projects (org_id,name,key,description,color) VALUES ($1,$2,$3,$4,$5) RETURNING *',[req.user.orgId,name,key.toUpperCase(),description,color]);
      const p=camel(rows[0]);
      await db.query('INSERT INTO project_sequences (project_id,next_num) VALUES ($1,1) ON CONFLICT DO NOTHING',[p.id]);
      return res.status(201).json(p);
    }
    const d=loadDB();
    const p={id:uuidv4(),orgId:req.user.orgId,name,key:key.toUpperCase(),description,color,createdAt:new Date().toISOString()};
    d.projects.push(p); d.nextBugNum[p.id]=1; saveDB(d); res.status(201).json(p);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  try {
    if (db.isConnected()) { await db.query('DELETE FROM projects WHERE id=$1 AND org_id=$2',[req.params.id,req.user.orgId]); return res.json({ success:true }); }
    const d=loadDB(); d.projects=d.projects.filter(p=>!(p.id===req.params.id&&p.orgId===req.user.orgId)); d.bugs=d.bugs.filter(b=>b.projectId!==req.params.id); saveDB(d); res.json({ success:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  BUGS  (org-scoped)
// ═══════════════════════════════════════════════════════════════
app.get('/api/bugs', auth, async (req, res) => {
  try {
    const {projectId,status,priority,type,assigneeId,search}=req.query;
    if (db.isConnected()) {
      const conds=[`org_id=$1`], vals=[req.user.orgId]; let i=2;
      if (projectId)  { conds.push(`project_id=$${i++}`);  vals.push(projectId); }
      if (status)     { conds.push(`status=$${i++}`);      vals.push(status); }
      if (priority)   { conds.push(`priority=$${i++}`);    vals.push(priority); }
      if (type)       { conds.push(`type=$${i++}`);        vals.push(type); }
      if (assigneeId) { conds.push(`assignee_id=$${i++}`); vals.push(assigneeId); }
      if (search)     { conds.push(`(title ILIKE $${i} OR description ILIKE $${i++})`); vals.push(`%${search}%`); }
      const {rows}=await db.query(`SELECT * FROM bugs WHERE ${conds.join(' AND ')} ORDER BY created_at DESC`,vals);
      return res.json(camels(rows));
    }
    let bugs=loadDB().bugs.filter(b=>b.orgId===req.user.orgId);
    if (projectId)  bugs=bugs.filter(b=>b.projectId===projectId);
    if (status)     bugs=bugs.filter(b=>b.status===status);
    if (priority)   bugs=bugs.filter(b=>b.priority===priority);
    if (type)       bugs=bugs.filter(b=>b.type===type);
    if (assigneeId) bugs=bugs.filter(b=>b.assigneeId===assigneeId);
    if (search)     bugs=bugs.filter(b=>b.title.toLowerCase().includes(search.toLowerCase())||b.description.toLowerCase().includes(search.toLowerCase()));
    res.json(bugs.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/bugs/:id', auth, async (req, res) => {
  try {
    if (db.isConnected()) {
      const {rows}=await db.query('SELECT * FROM bugs WHERE id=$1 AND org_id=$2',[req.params.id,req.user.orgId]);
      if (!rows.length) return res.status(404).json({ error:'Not found' });
      const bug=camel(rows[0]);
      const [c,a]=await Promise.all([db.query('SELECT * FROM comments WHERE bug_id=$1 ORDER BY created_at ASC',[req.params.id]),db.query('SELECT * FROM activity WHERE bug_id=$1 ORDER BY created_at ASC',[req.params.id])]);
      bug.comments=camels(c.rows); bug.activity=camels(a.rows); return res.json(bug);
    }
    const bug=loadDB().bugs.find(b=>b.id===req.params.id&&b.orgId===req.user.orgId);
    if (!bug) return res.status(404).json({ error:'Not found' }); res.json(bug);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.post('/api/bugs', auth, async (req, res) => {
  try {
    const {projectId,title,description='',type='Bug',priority='Medium',assigneeId,labels=[]}=req.body;
    const rId=req.user.id;
    if (db.isConnected()) {
      const seq=await db.query('UPDATE project_sequences SET next_num=next_num+1 WHERE project_id=$1 RETURNING next_num-1 AS num',[projectId]);
      const num=seq.rows[0]?.num??1;
      const proj=await db.query('SELECT key FROM projects WHERE id=$1',[projectId]);
      const {rows}=await db.query('INSERT INTO bugs (org_id,key,project_id,title,description,type,priority,assignee_id,reporter_id,labels) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[req.user.orgId,`${proj.rows[0].key}-${num}`,projectId,title,description,type,priority,assigneeId||null,rId,labels]);
      const bug=camel(rows[0]);
      await db.query('INSERT INTO activity (bug_id,user_id,type,note) VALUES ($1,$2,\'created\',\'Issue created\')',[bug.id,rId]);
      bug.comments=[]; bug.activity=[{type:'created',note:'Issue created'}]; return res.status(201).json(bug);
    }
    const d=loadDB();
    const proj=d.projects.find(p=>p.id===projectId);
    if (!proj) return res.status(400).json({ error:'Invalid project' });
    const num=d.nextBugNum[projectId]||1; d.nextBugNum[projectId]=num+1;
    const now=new Date().toISOString();
    const bug={id:uuidv4(),orgId:req.user.orgId,key:`${proj.key}-${num}`,projectId,title,description,type,priority,status:'To Do',assigneeId:assigneeId||null,reporterId:rId,labels,createdAt:now,updatedAt:now,comments:[],activity:[{id:uuidv4(),type:'created',note:'Issue created',userId:rId,createdAt:now}]};
    d.bugs.push(bug); saveDB(d); res.status(201).json(bug);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.put('/api/bugs/:id', auth, async (req, res) => {
  try {
    if (db.isConnected()) {
      const {rows:old}=await db.query('SELECT * FROM bugs WHERE id=$1 AND org_id=$2',[req.params.id,req.user.orgId]);
      if (!old.length) return res.status(404).json({ error:'Not found' });
      const fm={assigneeId:'assignee_id'}, sets=[], vals=[]; let i=1;
      for (const [k,v] of Object.entries(req.body)) {
        const col=fm[k]||k.replace(/([A-Z])/g,'_$1').toLowerCase();
        if (!['title','description','type','priority','status','assignee_id','labels'].includes(col)) continue;
        sets.push(`${col}=$${i++}`); vals.push(v===''?null:v);
      }
      if (sets.length) { vals.push(req.params.id); await db.query(`UPDATE bugs SET ${sets.join(',')} WHERE id=$${i}`,vals); }
      for (const f of ['status','priority','assigneeId','type']) {
        const col=fm[f]||f.replace(/([A-Z])/g,'_$1').toLowerCase();
        if (req.body[f]!==undefined&&String(req.body[f])!==String(old[0][col])) await db.query('INSERT INTO activity (bug_id,user_id,type,field,from_value,to_value) VALUES ($1,$2,\'changed\',$3,$4,$5)',[req.params.id,req.user.id,f,old[0][col],req.body[f]]);
      }
      const {rows}=await db.query('SELECT * FROM bugs WHERE id=$1',[req.params.id]);
      const bug=camel(rows[0]);
      const [c,a]=await Promise.all([db.query('SELECT * FROM comments WHERE bug_id=$1 ORDER BY created_at ASC',[req.params.id]),db.query('SELECT * FROM activity WHERE bug_id=$1 ORDER BY created_at ASC',[req.params.id])]);
      bug.comments=camels(c.rows); bug.activity=camels(a.rows); return res.json(bug);
    }
    const d=loadDB(), idx=d.bugs.findIndex(b=>b.id===req.params.id&&b.orgId===req.user.orgId);
    if (idx===-1) return res.status(404).json({ error:'Not found' });
    const now=new Date().toISOString(), old=d.bugs[idx], updated={...old,...req.body,updatedAt:now};
    for (const f of ['status','priority','assigneeId','type']) if (req.body[f]!==undefined&&req.body[f]!==old[f]) updated.activity=[...(updated.activity||[]),{id:uuidv4(),type:'changed',field:f,fromValue:old[f],toValue:req.body[f],userId:req.user.id,createdAt:now}];
    d.bugs[idx]=updated; saveDB(d); res.json(updated);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.delete('/api/bugs/:id', auth, async (req, res) => {
  try {
    if (db.isConnected()) { await db.query('DELETE FROM bugs WHERE id=$1 AND org_id=$2',[req.params.id,req.user.orgId]); return res.json({ success:true }); }
    const d=loadDB(); d.bugs=d.bugs.filter(b=>!(b.id===req.params.id&&b.orgId===req.user.orgId)); saveDB(d); res.json({ success:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// ── Comments ──────────────────────────────────────────────────────────────────
app.post('/api/bugs/:id/comments', auth, async (req, res) => {
  try {
    const {text}=req.body;
    if (db.isConnected()) { const {rows}=await db.query('INSERT INTO comments (bug_id,author_id,text) VALUES ($1,$2,$3) RETURNING *',[req.params.id,req.user.id,text]); return res.status(201).json(camel(rows[0])); }
    const d=loadDB(), bug=d.bugs.find(b=>b.id===req.params.id&&b.orgId===req.user.orgId);
    if (!bug) return res.status(404).json({ error:'Not found' });
    const c={id:uuidv4(),authorId:req.user.id,text,createdAt:new Date().toISOString()};
    bug.comments.push(c); bug.updatedAt=c.createdAt; saveDB(d); res.status(201).json(c);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.delete('/api/bugs/:id/comments/:cid', auth, async (req, res) => {
  try {
    if (db.isConnected()) { await db.query('DELETE FROM comments WHERE id=$1 AND bug_id=$2',[req.params.cid,req.params.id]); return res.json({ success:true }); }
    const d=loadDB(), bug=d.bugs.find(b=>b.id===req.params.id&&b.orgId===req.user.orgId);
    if (bug) { bug.comments=bug.comments.filter(c=>c.id!==req.params.cid); saveDB(d); } res.json({ success:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, async (req, res) => {
  try {
    const {projectId}=req.query;
    const orgFilter=`org_id='${req.user.orgId}'`;
    const filter=projectId?`${orgFilter} AND project_id='${projectId}'`:orgFilter;
    if (db.isConnected()) {
      const [s,p,t,tot,daily]=await Promise.all([db.query(`SELECT status,COUNT(*)::int AS cnt FROM bugs WHERE ${filter} GROUP BY status`),db.query(`SELECT priority,COUNT(*)::int AS cnt FROM bugs WHERE ${filter} GROUP BY priority`),db.query(`SELECT type,COUNT(*)::int AS cnt FROM bugs WHERE ${filter} GROUP BY type`),db.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status!='Done')::int AS open_count,COUNT(*) FILTER (WHERE status='Done')::int AS done_count FROM bugs WHERE ${filter}`),db.query(`SELECT to_char(d::date,'Mon DD') AS label,COUNT(b.id)::int AS count FROM generate_series(NOW()-INTERVAL '6 days',NOW(),INTERVAL '1 day') d LEFT JOIN bugs b ON b.created_at::date=d::date AND b.${filter} GROUP BY d ORDER BY d`)]);
      const byStatus={'To Do':0,'In Progress':0,'In Review':0,'Done':0},byPriority={Critical:0,High:0,Medium:0,Low:0},byType={Bug:0,Feature:0,Task:0,Improvement:0};
      s.rows.forEach(r=>{if(r.status in byStatus)byStatus[r.status]=r.cnt;}); p.rows.forEach(r=>{if(r.priority in byPriority)byPriority[r.priority]=r.cnt;}); t.rows.forEach(r=>{if(r.type in byType)byType[r.type]=r.cnt;});
      return res.json({total:tot.rows[0].total,openCount:tot.rows[0].open_count,doneCount:tot.rows[0].done_count,byStatus,byPriority,byType,daily:daily.rows});
    }
    let bugs=loadDB().bugs.filter(b=>b.orgId===req.user.orgId);
    if (projectId) bugs=bugs.filter(b=>b.projectId===projectId);
    const byStatus={'To Do':0,'In Progress':0,'In Review':0,'Done':0},byPriority={Critical:0,High:0,Medium:0,Low:0},byType={Bug:0,Feature:0,Task:0,Improvement:0};
    bugs.forEach(b=>{if(b.status in byStatus)byStatus[b.status]++;if(b.priority in byPriority)byPriority[b.priority]++;if(b.type in byType)byType[b.type]++;});
    const daily=[];
    for(let i=6;i>=0;i--){const dd=new Date();dd.setDate(dd.getDate()-i);daily.push({label:dd.toLocaleDateString('en-US',{month:'short',day:'numeric'}),count:bugs.filter(b=>new Date(b.createdAt).toDateString()===dd.toDateString()).length});}
    res.json({total:bugs.length,openCount:bugs.filter(b=>b.status!=='Done').length,doneCount:bugs.filter(b=>b.status==='Done').length,byStatus,byPriority,byType,daily});
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

(async()=>{
  await db.connect();
  app.listen(PORT, ()=>{
    console.log(`\n🚀  BugTracker      →  http://localhost:${PORT}`);
    console.log(`📦  Storage         →  ${db.isConnected()?'PostgreSQL':'JSON file'}`);
    console.log(`🏢  Multi-tenant    →  enabled`);
    console.log(`🔐  JWT Auth        →  enabled\n`);
  });
})();
