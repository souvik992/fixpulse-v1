const { useState, useEffect, useRef, useCallback } = React;
const API = '';

// ── Token storage ──────────────────────────────────────────────────────────────
const Token = {
  get:   ()  => localStorage.getItem('bt_token'),
  set:   (t) => localStorage.setItem('bt_token', t),
  clear: ()  => localStorage.removeItem('bt_token'),
};

// ── Auth-aware API helpers ────────────────────────────────────────────────────
const authHeaders = () => {
  const t = Token.get();
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};
const api = {
  get:    (url)       => fetch(API + url, { headers: authHeaders() }).then(r => r.json()),
  post:   (url, body) => fetch(API + url, { method:'POST',   headers: authHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
  put:    (url, body) => fetch(API + url, { method:'PUT',    headers: authHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
  delete: (url)       => fetch(API + url, { method:'DELETE', headers: authHeaders() }).then(r => r.json()),
};

// ── Utility helpers ────────────────────────────────────────────────────────────
const statusBadge  = s => ({ 'To Do':'badge-status-todo','In Progress':'badge-status-inprogress','In Review':'badge-status-inreview','Done':'badge-status-done' }[s]||'badge-status-todo');
const priorityBadge = p => ({ Critical:'badge-priority-critical', High:'badge-priority-high', Medium:'badge-priority-medium', Low:'badge-priority-low' }[p]||'badge-priority-medium');
const typeBadge    = t => ({ Bug:'badge-type-bug', Feature:'badge-type-feature', Task:'badge-type-task', Improvement:'badge-type-improvement' }[t]||'badge-type-task');
const priorityIcon = p => ({ Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🔵' }[p]||'');
const typeIcon     = t => ({ Bug:'🐛', Feature:'✨', Task:'📋', Improvement:'⚡' }[t]||'');
const statusIcon   = s => ({ 'To Do':'○', 'In Progress':'◑', 'In Review':'◕', 'Done':'●' }[s]||'○');
const timeAgo      = ts => { const d=Math.floor((Date.now()-new Date(ts))/1000); if(d<60)return 'just now'; if(d<3600)return `${Math.floor(d/60)}m ago`; if(d<86400)return `${Math.floor(d/3600)}h ago`; return `${Math.floor(d/86400)}d ago`; };
const COLORS       = ['#6366f1','#10b981','#f59e0b','#ef4444','#38bdf8','#ec4899','#8b5cf6','#14b8a6'];
const ROLE_LABELS  = { admin:'Admin', developer:'Developer', qa:'QA' };
const ROLE_COLORS  = { admin:'#ef4444', developer:'#6366f1', qa:'#10b981' };

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ toasts, dismiss }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => dismiss(t.id)}>
          <span>{t.type==='success'?'✓':t.type==='error'?'✗':'ℹ'}</span><span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
function Avatar({ user, size='' }) {
  if (!user) return <div className={`avatar avatar-${size||'sm'}`} style={{background:'#475569'}}>?</div>;
  return <div className={`avatar ${size==='xs'?'avatar-xs':size==='sm'?'avatar-sm':''}`} style={{background:user.color||'#6366f1'}} title={user.name}>{user.avatar}</div>;
}

function PriorityBadge({ p }) { return <span className={`badge ${priorityBadge(p)}`}>{priorityIcon(p)} {p}</span>; }
function StatusBadge({ s })   { return <span className={`badge ${statusBadge(s)}`}>{statusIcon(s)} {s}</span>; }
function TypeBadge({ t })     { return <span className={`badge ${typeBadge(t)}`}>{typeIcon(t)} {t}</span>; }

function Modal({ children, onClose, large }) {
  useEffect(() => { const esc=e=>{if(e.key==='Escape')onClose();}; document.addEventListener('keydown',esc); return ()=>document.removeEventListener('keydown',esc); },[]);
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className={`modal ${large?'modal-lg':''}`}>{children}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH PAGE  (Login / Register Company)
// ══════════════════════════════════════════════════════════════════════════════
function AuthPage({ onAuth }) {
  const [mode, setMode]       = useState('landing'); // 'landing' | 'login' | 'register'
  const [form, setForm]       = useState({ companyName:'', name:'', email:'', password:'', confirm:'', color:'#6366f1' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);

  const set = (k,v) => { setForm(f=>({...f,[k]:v})); setError(''); };

  const submit = async e => {
    e.preventDefault();
    setError('');
    if (mode === 'register') {
      if (!form.companyName.trim()) return setError('Company name is required');
      if (!form.name.trim())        return setError('Your name is required');
      if (form.password.length < 6) return setError('Password must be at least 6 characters');
      if (form.password !== form.confirm) return setError('Passwords do not match');
    }
    setLoading(true);
    try {
      const url  = mode==='login' ? '/api/auth/login' : '/api/auth/register-company';
      const body = mode==='login'
        ? { email: form.email, password: form.password }
        : { companyName: form.companyName, name: form.name, email: form.email, password: form.password, color: form.color };
      const res  = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error||'Something went wrong'); setLoading(false); return; }
      Token.set(data.token);
      onAuth(data.user, data.org);
    } catch { setError('Cannot connect to server. Make sure it is running.'); }
    setLoading(false);
  };

  const reset = m => { setMode(m); setError(''); setForm({ companyName:'', name:'', email:'', password:'', confirm:'', color:'#6366f1' }); };

  // ── Landing ──
  if (mode === 'landing') return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:480, textAlign:'center' }}>
        <div style={{ width:60, height:60, background:'var(--primary)', borderRadius:16, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:24, fontWeight:800, color:'#fff', marginBottom:16 }}>BT</div>
        <h1 style={{ fontSize:28, fontWeight:800, marginBottom:8 }}>BugTracker</h1>
        <p style={{ color:'var(--muted)', fontSize:15, marginBottom:40 }}>Professional bug &amp; issue tracking for your team</p>
        <div style={{ display:'flex', flexDirection:'column', gap:12, maxWidth:320, margin:'0 auto' }}>
          <button className="btn btn-primary" style={{ justifyContent:'center', padding:'14px 0', fontSize:15, borderRadius:10 }} onClick={()=>setMode('login')}>
            🔑 Log In to Your Company
          </button>
          <button className="btn btn-ghost" style={{ justifyContent:'center', padding:'14px 0', fontSize:15, borderRadius:10, border:'1px solid var(--border)' }} onClick={()=>setMode('register')}>
            🏢 Register a New Company
          </button>
        </div>
        <p style={{ color:'var(--muted)', fontSize:12, marginTop:32 }}>Multi-tenant · Role-based access · Real-time tracking</p>
      </div>
    </div>
  );

  // ── Login / Register ──
  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth: mode==='register' ? 480 : 420 }}>
        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ width:48, height:48, background:'var(--primary)', borderRadius:12, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:800, color:'#fff', marginBottom:10 }}>BT</div>
          <h1 style={{ fontSize:20, fontWeight:700 }}>{mode==='login' ? 'Welcome back' : 'Register your Company'}</h1>
          <p style={{ color:'var(--muted)', fontSize:13, marginTop:4 }}>{mode==='login' ? 'Log in to your company workspace' : 'Create a workspace for your team'}</p>
        </div>

        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:28 }}>
          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">🏢 Company Name *</label>
                <input className="form-input" value={form.companyName} onChange={e=>set('companyName',e.target.value)} placeholder="Acme Corp" required autoFocus />
              </div>
            )}
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">Your Full Name *</label>
                <input className="form-input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Jane Doe" required />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Work Email *</label>
              <input className="form-input" type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="you@company.com" required autoFocus={mode==='login'} />
            </div>
            <div className="form-group" style={{ position:'relative' }}>
              <label className="form-label">Password *</label>
              <input className="form-input" type={showPw?'text':'password'} value={form.password} onChange={e=>set('password',e.target.value)} placeholder={mode==='register'?'Min. 6 characters':'Your password'} required style={{ paddingRight:40 }} />
              <button type="button" onClick={()=>setShowPw(v=>!v)} style={{ position:'absolute', right:10, top:30, background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:16 }}>
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">Confirm Password *</label>
                <input className="form-input" type={showPw?'text':'password'} value={form.confirm} onChange={e=>set('confirm',e.target.value)} placeholder="Repeat password" required />
              </div>
            )}
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">Your Avatar Colour</label>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {COLORS.map(c=>(
                    <div key={c} onClick={()=>set('color',c)} style={{ width:26,height:26,borderRadius:'50%',background:c,cursor:'pointer', border: form.color===c?'3px solid #fff':'3px solid transparent', transform: form.color===c?'scale(1.2)':'none', transition:'all .15s' }} />
                  ))}
                </div>
              </div>
            )}
            {error && (
              <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:'10px 14px', color:'#ef4444', fontSize:13, marginBottom:16 }}>
                ⚠ {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width:'100%', justifyContent:'center', padding:'11px 0', fontSize:14 }}>
              {loading ? '⏳ Please wait…' : mode==='login' ? '🔑 Log In' : '🚀 Create Company Workspace'}
            </button>
          </form>

          <div style={{ textAlign:'center', marginTop:16, fontSize:12, color:'var(--muted)' }}>
            {mode==='login' ? (
              <span>New to BugTracker? <span style={{ color:'var(--primary)', cursor:'pointer', fontWeight:600 }} onClick={()=>reset('register')}>Register your company →</span></span>
            ) : (
              <span>Already have a workspace? <span style={{ color:'var(--primary)', cursor:'pointer', fontWeight:600 }} onClick={()=>reset('login')}>Log in →</span></span>
            )}
          </div>
          <div style={{ textAlign:'center', marginTop:8 }}>
            <span style={{ color:'var(--muted)', fontSize:12, cursor:'pointer' }} onClick={()=>reset('landing')}>← Back</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── BugModal ──────────────────────────────────────────────────────────────────
function BugModal({ bug, projects, users, currentProject, onClose, onSave, toast }) {
  const editing = !!bug;
  const [form, setForm] = useState({ title:bug?.title||'', description:bug?.description||'', projectId:bug?.projectId||currentProject?.id||projects[0]?.id||'', type:bug?.type||'Bug', priority:bug?.priority||'Medium', assigneeId:bug?.assigneeId||'', labels:bug?.labels?.join(', ')||'' });
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const handleSubmit = async e => {
    e.preventDefault(); if (!form.title.trim()) return;
    const payload={...form, labels:form.labels?form.labels.split(',').map(l=>l.trim()).filter(Boolean):[]};
    try {
      if (editing) { const u=await api.put(`/api/bugs/${bug.id}`,payload); toast('Issue updated','success'); onSave(u); }
      else { const c=await api.post('/api/bugs',payload); toast('Issue created','success'); onSave(c); }
    } catch { toast('Something went wrong','error'); }
  };
  return (
    <Modal onClose={onClose}>
      <div className="modal-header"><h2 className="modal-title">{editing?'Edit Issue':'Create Issue'}</h2><button className="btn-icon" onClick={onClose}>✕</button></div>
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Brief description of the issue" required autoFocus /></div>
          <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Detailed description, steps to reproduce…" /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Project</label><select className="form-select" value={form.projectId} onChange={e=>set('projectId',e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Type</label><select className="form-select" value={form.type} onChange={e=>set('type',e.target.value)}>{['Bug','Feature','Task','Improvement'].map(t=><option key={t}>{t}</option>)}</select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Priority</label><select className="form-select" value={form.priority} onChange={e=>set('priority',e.target.value)}>{['Critical','High','Medium','Low'].map(p=><option key={p}>{p}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Assignee</label><select className="form-select" value={form.assigneeId} onChange={e=>set('assigneeId',e.target.value)}><option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          </div>
          <div className="form-group"><label className="form-label">Labels (comma separated)</label><input className="form-input" value={form.labels} onChange={e=>set('labels',e.target.value)} placeholder="e.g. frontend, auth, critical" /></div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary">{editing?'Save Changes':'Create Issue'}</button></div>
      </form>
    </Modal>
  );
}

// ── BugDetail ─────────────────────────────────────────────────────────────────
function BugDetail({ bugId, projects, users, onClose, onUpdate, onDelete, toast, currentUser }) {
  const [bug,setBug]=useState(null);
  const [editing,setEditing]=useState(false);
  const [comment,setComment]=useState('');
  const [tab,setTab]=useState('comments');
  useEffect(()=>{ api.get(`/api/bugs/${bugId}`).then(setBug); },[bugId]);
  const updateField = async (field,value) => { const u=await api.put(`/api/bugs/${bugId}`,{[field]:value}); setBug(u); onUpdate(u); toast('Updated','success'); };
  const addComment = async () => {
    if (!comment.trim()) return;
    await api.post(`/api/bugs/${bugId}/comments`,{text:comment});
    setComment(''); const fresh=await api.get(`/api/bugs/${bugId}`); setBug(fresh); toast('Comment added','success');
  };
  const deleteComment = async cid => { await api.delete(`/api/bugs/${bugId}/comments/${cid}`); const fresh=await api.get(`/api/bugs/${bugId}`); setBug(fresh); };
  const project=bug?projects.find(p=>p.id===bug.projectId):null;
  const assignee=bug?users.find(u=>u.id===bug.assigneeId):null;
  const reporter=bug?users.find(u=>u.id===bug.reporterId):null;
  if (!bug) return <Modal onClose={onClose}><div className="modal-body" style={{minHeight:200,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--muted)'}}>Loading…</div></Modal>;
  if (editing) return <BugModal bug={bug} projects={projects} users={users} onClose={()=>setEditing(false)} onSave={b=>{setBug(b);onUpdate(b);setEditing(false);}} toast={toast} />;
  return (
    <Modal onClose={onClose} large>
      <div className="modal-header" style={{marginBottom:0}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span className="issue-key">{bug.key||bug.id.slice(0,8)}</span><TypeBadge t={bug.type} /><PriorityBadge p={bug.priority} /></div>
          <h2 style={{fontSize:18,fontWeight:700}}>{bug.title}</h2>
        </div>
        <div style={{display:'flex',gap:6,marginLeft:16}}>
          <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>✏ Edit</button>
          <button className="btn btn-danger btn-sm" onClick={async()=>{await api.delete(`/api/bugs/${bugId}`);onDelete(bugId);onClose();toast('Issue deleted','info');}}>🗑 Delete</button>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="modal-body">
        <div className="detail-layout">
          <div className="detail-main">
            <div className="detail-section"><h4>Description</h4>{bug.description?<div className="detail-description">{bug.description}</div>:<div className="detail-description" style={{color:'var(--muted)',fontStyle:'italic'}}>No description provided.</div>}</div>
            {bug.labels?.length>0&&<div className="detail-section"><h4>Labels</h4><div className="flex gap-1 flex-wrap">{bug.labels.map(l=><span key={l} className="label-chip">{l}</span>)}</div></div>}
            <div className="tabs">
              <button className={`tab ${tab==='comments'?'active':''}`} onClick={()=>setTab('comments')}>💬 Comments ({bug.comments?.length||0})</button>
              <button className={`tab ${tab==='activity'?'active':''}`} onClick={()=>setTab('activity')}>📜 Activity</button>
            </div>
            {tab==='comments'&&<div>
              {bug.comments?.length===0&&<div className="text-muted text-sm" style={{marginBottom:12}}>No comments yet.</div>}
              {bug.comments?.map(c=>{const author=users.find(u=>u.id===c.authorId);return(<div key={c.id} className="comment"><Avatar user={author} size="sm" /><div className="comment-body"><div className="comment-meta"><span className="comment-author">{author?.name||'Unknown'}</span><span className="comment-time">{timeAgo(c.createdAt)}</span>{author?.id===currentUser.id&&<button className="btn-icon" style={{marginLeft:'auto',fontSize:12}} onClick={()=>deleteComment(c.id)}>✕</button>}</div><div className="comment-text">{c.text}</div></div></div>);})}
              <div className="comment-input-wrap"><Avatar user={currentUser} size="sm" /><textarea placeholder="Add a comment… (Ctrl+Enter to send)" value={comment} onChange={e=>setComment(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))addComment();}} /><button className="btn btn-primary btn-sm" style={{alignSelf:'flex-end'}} onClick={addComment}>Send</button></div>
            </div>}
            {tab==='activity'&&<div>{(!bug.activity||bug.activity.length===0)?<div className="text-muted text-sm">No activity recorded.</div>:bug.activity.map((a,i)=>{const user=users.find(u=>u.id===a.userId);return(<div key={a.id||i} className="activity-item"><div className="activity-dot"/><div className="activity-text"><strong>{user?.name||'Someone'}</strong>{a.type==='created'?' created this issue':a.type==='changed'?` changed ${a.field} from "${a.fromValue}" to "${a.toValue}"`:` ${a.note}`}<span style={{marginLeft:6,fontSize:11,color:'var(--muted)'}}>{timeAgo(a.createdAt)}</span></div></div>);})}</div>}
          </div>
          <div className="detail-sidebar">
            <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:16}}>
              <div className="detail-field"><div className="detail-field-label">Status</div><select className="form-select" value={bug.status} onChange={e=>updateField('status',e.target.value)}>{['To Do','In Progress','In Review','Done'].map(s=><option key={s}>{s}</option>)}</select></div>
              <div className="detail-field"><div className="detail-field-label">Priority</div><select className="form-select" value={bug.priority} onChange={e=>updateField('priority',e.target.value)}>{['Critical','High','Medium','Low'].map(p=><option key={p}>{p}</option>)}</select></div>
              <div className="detail-field"><div className="detail-field-label">Assignee</div><select className="form-select" value={bug.assigneeId||''} onChange={e=>updateField('assigneeId',e.target.value)}><option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
              <hr className="divider"/>
              <div className="detail-field"><div className="detail-field-label">Project</div><div className="detail-field-value" style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:10,height:10,borderRadius:'50%',background:project?.color}}/>{project?.name}</div></div>
              <div className="detail-field"><div className="detail-field-label">Reporter</div><div className="detail-field-value" style={{display:'flex',alignItems:'center',gap:6}}>{reporter?<><Avatar user={reporter} size="xs"/>{reporter.name}</>:'Unknown'}</div></div>
              <hr className="divider"/>
              <div className="detail-field"><div className="detail-field-label">Created</div><div className="detail-field-value text-sm text-muted">{new Date(bug.createdAt).toLocaleDateString()}</div></div>
              <div className="detail-field"><div className="detail-field-label">Updated</div><div className="detail-field-value text-sm text-muted">{timeAgo(bug.updatedAt)}</div></div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
function Dashboard({ projects, users, currentProject, onNavigate }) {
  const [stats,setStats]=useState(null);
  const [recentBugs,setRecentBugs]=useState([]);
  const lineRef=useRef(null),doughnutRef=useRef(null),barRef=useRef(null);
  const lineChart=useRef(null),doughnutChart=useRef(null),barChart=useRef(null);
  useEffect(()=>{ const url=currentProject?`/api/stats?projectId=${currentProject.id}`:'/api/stats'; api.get(url).then(setStats); const bu=currentProject?`/api/bugs?projectId=${currentProject.id}`:'/api/bugs'; api.get(bu).then(b=>setRecentBugs(b.slice(0,5))); },[currentProject]);
  useEffect(()=>{
    if (!stats) return;
    if (lineChart.current) lineChart.current.destroy();
    lineChart.current=new Chart(lineRef.current,{type:'line',data:{labels:stats.daily.map(d=>d.label),datasets:[{label:'Issues',data:stats.daily.map(d=>d.count),borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,.15)',tension:0.4,fill:true,pointBackgroundColor:'#6366f1',pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'#334155'},ticks:{color:'#94a3b8'}},y:{grid:{color:'#334155'},ticks:{color:'#94a3b8',stepSize:1}}}}});
    if (doughnutChart.current) doughnutChart.current.destroy();
    doughnutChart.current=new Chart(doughnutRef.current,{type:'doughnut',data:{labels:Object.keys(stats.byStatus),datasets:[{data:Object.values(stats.byStatus),backgroundColor:['#475569','#6366f1','#fbbf24','#10b981'],borderWidth:0,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:'#94a3b8',boxWidth:12,font:{size:11}}}}}});
    if (barChart.current) barChart.current.destroy();
    barChart.current=new Chart(barRef.current,{type:'bar',data:{labels:Object.keys(stats.byPriority),datasets:[{label:'Issues',data:Object.values(stats.byPriority),backgroundColor:['#ef4444','#fb923c','#fbbf24','#94a3b8'],borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#94a3b8'}},y:{grid:{color:'#334155'},ticks:{color:'#94a3b8',stepSize:1}}}}});
    return()=>{if(lineChart.current)lineChart.current.destroy();if(doughnutChart.current)doughnutChart.current.destroy();if(barChart.current)barChart.current.destroy();};
  },[stats]);
  if (!stats) return <div style={{color:'var(--muted)',padding:40,textAlign:'center'}}>Loading dashboard…</div>;
  return (
    <div>
      <div className="page-header"><div><h1>Dashboard</h1><p>{currentProject?currentProject.name:'All Projects'} · Overview</p></div><button className="btn btn-primary" onClick={()=>onNavigate('list')}>View All Issues →</button></div>
      <div className="stats-grid">
        {[{label:'Total Issues',value:stats.total,sub:'across all statuses',color:'#6366f1'},{label:'Open Issues',value:stats.openCount,sub:'need attention',color:'#f59e0b'},{label:'Completed',value:stats.doneCount,sub:'marked as done',color:'#10b981'},{label:'Critical',value:stats.byPriority.Critical,sub:'critical priority',color:'#ef4444'}].map(card=>(
          <div key={card.label} className="stat-card"><div className="label">{card.label}</div><div className="value" style={{color:card.color}}>{card.value}</div><div className="sub">{card.sub}</div></div>
        ))}
      </div>
      <div className="charts-grid">
        <div className="chart-card"><h3>Issues Created (Last 7 Days)</h3><div className="chart-wrap"><canvas ref={lineRef}/></div></div>
        <div className="chart-card"><h3>By Status</h3><div className="chart-wrap"><canvas ref={doughnutRef}/></div></div>
        <div className="chart-card"><h3>By Priority</h3><div className="chart-wrap"><canvas ref={barRef}/></div></div>
      </div>
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20}}>
        <h3 style={{fontSize:13,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:16}}>Recent Issues</h3>
        {recentBugs.length===0?<div className="text-muted text-sm">No issues found.</div>:(
          <table className="bug-table"><thead><tr><th>Key</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Updated</th></tr></thead>
          <tbody>{recentBugs.map(bug=>{const assignee=users.find(u=>u.id===bug.assigneeId);return(<tr key={bug.id} onClick={()=>onNavigate('detail',bug.id)}><td><span className="issue-key">{bug.key||bug.id.slice(0,8)}</span></td><td><span className="issue-title">{bug.title}</span></td><td><StatusBadge s={bug.status}/></td><td><PriorityBadge p={bug.priority}/></td><td>{assignee?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={assignee} size="xs"/><span style={{fontSize:12}}>{assignee.name.split(' ')[0]}</span></div>:<span className="text-muted">—</span>}</td><td><span className="text-muted text-sm">{timeAgo(bug.updatedAt)}</span></td></tr>);})}</tbody></table>
        )}
      </div>
    </div>
  );
}

// ── BugList ───────────────────────────────────────────────────────────────────
function BugList({ projects, users, currentProject, toast, currentUser }) {
  const [bugs,setBugs]=useState([]);
  const [filters,setFilters]=useState({status:'',priority:'',type:'',assigneeId:'',search:''});
  const [showCreate,setShowCreate]=useState(false);
  const [selectedBug,setSelectedBug]=useState(null);
  const load=useCallback(()=>{ const p=new URLSearchParams(); if(currentProject)p.set('projectId',currentProject.id); Object.entries(filters).forEach(([k,v])=>{if(v)p.set(k,v);}); api.get(`/api/bugs?${p}`).then(setBugs); },[currentProject,filters]);
  useEffect(()=>{load();},[load]);
  const setFilter=(k,v)=>setFilters(f=>({...f,[k]:v}));
  return (
    <div>
      <div className="page-header"><div><h1>Issues</h1><p>{currentProject?currentProject.name:'All Projects'} · {bugs.length} issue{bugs.length!==1?'s':''}</p></div><button className="btn btn-primary" onClick={()=>setShowCreate(true)}>+ Create Issue</button></div>
      <div className="filters-bar">
        <div style={{position:'relative'}}><span className="search-icon">🔍</span><input style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'7px 12px 7px 32px',color:'var(--text)',outline:'none',width:220}} placeholder="Search issues…" value={filters.search} onChange={e=>setFilter('search',e.target.value)}/></div>
        <select className="filter-select" value={filters.status} onChange={e=>setFilter('status',e.target.value)}><option value="">All Statuses</option>{['To Do','In Progress','In Review','Done'].map(s=><option key={s}>{s}</option>)}</select>
        <select className="filter-select" value={filters.priority} onChange={e=>setFilter('priority',e.target.value)}><option value="">All Priorities</option>{['Critical','High','Medium','Low'].map(p=><option key={p}>{p}</option>)}</select>
        <select className="filter-select" value={filters.type} onChange={e=>setFilter('type',e.target.value)}><option value="">All Types</option>{['Bug','Feature','Task','Improvement'].map(t=><option key={t}>{t}</option>)}</select>
        <select className="filter-select" value={filters.assigneeId} onChange={e=>setFilter('assigneeId',e.target.value)}><option value="">All Assignees</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>
        {Object.values(filters).some(v=>v)&&<button className="btn btn-ghost btn-sm" onClick={()=>setFilters({status:'',priority:'',type:'',assigneeId:'',search:''})}>Clear ✕</button>}
      </div>
      {bugs.length===0?<div className="empty-state"><div className="icon">🎉</div><h3>No issues found</h3><p>Try adjusting your filters or create a new issue.</p></div>:(
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'}}>
          <table className="bug-table"><thead><tr><th>Key</th><th>Title</th><th>Type</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Project</th><th>Created</th></tr></thead>
          <tbody>{bugs.map(bug=>{const assignee=users.find(u=>u.id===bug.assigneeId);const project=projects.find(p=>p.id===bug.projectId);return(<tr key={bug.id} onClick={()=>setSelectedBug(bug.id)}><td><span className="issue-key">{bug.key||bug.id.slice(0,8)}</span></td><td><span className="issue-title">{bug.title}</span></td><td><TypeBadge t={bug.type}/></td><td><StatusBadge s={bug.status}/></td><td><PriorityBadge p={bug.priority}/></td><td>{assignee?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={assignee} size="xs"/><span style={{fontSize:12}}>{assignee.name.split(' ')[0]}</span></div>:<span className="text-muted text-sm">Unassigned</span>}</td><td>{project&&<div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:8,height:8,borderRadius:'50%',background:project.color}}/><span style={{fontSize:12,color:'var(--muted)'}}>{project.key}</span></div>}</td><td><span className="text-muted text-sm">{timeAgo(bug.createdAt)}</span></td></tr>);})}</tbody></table>
        </div>
      )}
      {showCreate&&<BugModal projects={projects} users={users} currentProject={currentProject} onClose={()=>setShowCreate(false)} toast={toast} onSave={()=>{load();setShowCreate(false);}}/>}
      {selectedBug&&<BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={()=>setSelectedBug(null)} toast={toast} onUpdate={()=>load()} onDelete={id=>{setBugs(bs=>bs.filter(b=>b.id!==id));}}/>}
    </div>
  );
}

// ── KanbanBoard ────────────────────────────────────────────────────────────────
function KanbanBoard({ projects, users, currentProject, toast, currentUser }) {
  const COLS=['To Do','In Progress','In Review','Done'];
  const [bugs,setBugs]=useState([]);
  const [showCreate,setShowCreate]=useState(false);
  const [selectedBug,setSelectedBug]=useState(null);
  const [dragging,setDragging]=useState(null);
  const [dragOver,setDragOver]=useState(null);
  const load=useCallback(()=>{ api.get(currentProject?`/api/bugs?projectId=${currentProject.id}`:'/api/bugs').then(setBugs); },[currentProject]);
  useEffect(()=>{load();},[load]);
  const byStatus=s=>bugs.filter(b=>b.status===s);
  const onDragStart=(e,bug)=>{setDragging(bug);e.dataTransfer.effectAllowed='move';};
  const onDragOver=(e,s)=>{e.preventDefault();setDragOver(s);};
  const onDrop=async(e,s)=>{e.preventDefault();if(!dragging||dragging.status===s){setDragging(null);setDragOver(null);return;}await api.put(`/api/bugs/${dragging.id}`,{status:s});setBugs(bs=>bs.map(b=>b.id===dragging.id?{...b,status:s}:b));toast(`Moved to ${s}`,'success');setDragging(null);setDragOver(null);};
  const colColors={'To Do':'#475569','In Progress':'#6366f1','In Review':'#fbbf24','Done':'#10b981'};
  return (
    <div>
      <div className="page-header"><div><h1>Board</h1><p>{currentProject?currentProject.name:'All Projects'} · Kanban view</p></div><button className="btn btn-primary" onClick={()=>setShowCreate(true)}>+ Create Issue</button></div>
      <div className="kanban">
        {COLS.map(col=>(
          <div key={col} className="kanban-col" onDragOver={e=>onDragOver(e,col)} onDrop={e=>onDrop(e,col)} onDragLeave={()=>setDragOver(null)}>
            <div className="kanban-col-header"><div style={{display:'flex',alignItems:'center',gap:8}}><div style={{width:10,height:10,borderRadius:'50%',background:colColors[col]}}/><span className="kanban-col-title">{col}</span></div><span className="kanban-count">{byStatus(col).length}</span></div>
            <div className={`kanban-cards ${dragOver===col?'drag-over':''}`}>
              {byStatus(col).length===0&&<div style={{textAlign:'center',padding:'20px 0',color:'var(--muted)',fontSize:12}}>Drop issues here</div>}
              {byStatus(col).map(bug=>{const assignee=users.find(u=>u.id===bug.assigneeId);const project=projects.find(p=>p.id===bug.projectId);return(<div key={bug.id} className={`kanban-card ${dragging?.id===bug.id?'dragging':''}`} draggable onClick={()=>setSelectedBug(bug.id)} onDragStart={e=>onDragStart(e,bug)}><div className="kanban-card-title">{bug.title}</div><div style={{display:'flex',gap:4,marginBottom:8,flexWrap:'wrap'}}><TypeBadge t={bug.type}/><PriorityBadge p={bug.priority}/></div><div className="kanban-card-footer"><div style={{display:'flex',alignItems:'center',gap:5}}>{project&&<><div style={{width:8,height:8,borderRadius:'50%',background:project.color}}/><span className="kanban-card-key">{bug.key||bug.id.slice(0,8)}</span></>}</div><div style={{display:'flex',alignItems:'center',gap:4}}>{bug.comments?.length>0&&<span style={{fontSize:11,color:'var(--muted)'}}>💬 {bug.comments.length}</span>}{assignee?<Avatar user={assignee} size="xs"/>:<div className="avatar avatar-xs" style={{background:'#334155'}}>?</div>}</div></div></div>);})}
            </div>
          </div>
        ))}
      </div>
      {showCreate&&<BugModal projects={projects} users={users} currentProject={currentProject} onClose={()=>setShowCreate(false)} toast={toast} onSave={()=>{load();setShowCreate(false);}}/>}
      {selectedBug&&<BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={()=>setSelectedBug(null)} toast={toast} onUpdate={b=>setBugs(bs=>bs.map(x=>x.id===b.id?b:x))} onDelete={id=>setBugs(bs=>bs.filter(b=>b.id!==id))}/>}
    </div>
  );
}

// ── ProjectsPage ──────────────────────────────────────────────────────────────
function ProjectsPage({ projects, setProjects, toast }) {
  const [showCreate,setShowCreate]=useState(false);
  const [form,setForm]=useState({name:'',key:'',description:'',color:'#6366f1'});
  const colors=['#6366f1','#10b981','#f59e0b','#ef4444','#38bdf8','#ec4899','#8b5cf6','#14b8a6'];
  const create=async e=>{e.preventDefault();if(!form.name||!form.key)return;const p=await api.post('/api/projects',form);setProjects(ps=>[...ps,p]);setForm({name:'',key:'',description:'',color:'#6366f1'});setShowCreate(false);toast('Project created','success');};
  const del=async id=>{await api.delete(`/api/projects/${id}`);setProjects(ps=>ps.filter(p=>p.id!==id));toast('Project deleted','info');};
  return (
    <div>
      <div className="page-header"><div><h1>Projects</h1><p>{projects.length} project{projects.length!==1?'s':''}</p></div><button className="btn btn-primary" onClick={()=>setShowCreate(true)}>+ New Project</button></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))',gap:16}}>
        {projects.map(p=>(<div key={p.id} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20,borderTop:`3px solid ${p.color}`}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}><div style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:36,height:36,borderRadius:8,background:p.color,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'#fff',fontSize:14}}>{p.key}</div><div><div style={{fontWeight:600}}>{p.name}</div><div style={{fontSize:11,color:'var(--muted)'}}>{p.key}</div></div></div><button className="btn btn-danger btn-sm" onClick={()=>del(p.id)}>Delete</button></div><div style={{fontSize:13,color:'var(--muted)',lineHeight:1.5}}>{p.description||'No description.'}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:10}}>Created {new Date(p.createdAt).toLocaleDateString()}</div></div>))}
      </div>
      {showCreate&&(<Modal onClose={()=>setShowCreate(false)}><div className="modal-header"><h2 className="modal-title">New Project</h2><button className="btn-icon" onClick={()=>setShowCreate(false)}>✕</button></div><form onSubmit={create}><div className="modal-body"><div className="form-group"><label className="form-label">Project Name *</label><input className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value,key:e.target.value.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,4)}))} required/></div><div className="form-group"><label className="form-label">Project Key *</label><input className="form-input" value={form.key} onChange={e=>setForm(f=>({...f,key:e.target.value.toUpperCase()}))} required maxLength={6}/></div><div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div><div className="form-group"><label className="form-label">Colour</label><div className="color-swatches">{colors.map(c=><div key={c} className={`swatch ${form.color===c?'selected':''}`} style={{background:c}} onClick={()=>setForm(f=>({...f,color:c}))}/>)}</div></div></div><div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={()=>setShowCreate(false)}>Cancel</button><button type="submit" className="btn btn-primary">Create Project</button></div></form></Modal>)}
    </div>
  );
}

// ── TeamPage (multi-tenant, role-aware) ───────────────────────────────────────
function TeamPage({ users, setUsers, bugs, toast, currentUser }) {
  const isAdmin = currentUser?.role === 'admin';
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name:'', email:'', role:'developer', color:'#6366f1' });
  const [newCredentials, setNewCredentials] = useState(null); // { name, email, tempPassword }
  const [resetTarget, setResetTarget] = useState(null); // member to reset password for
  const [resetResult, setResetResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const loadMembers = () => api.get('/api/members').then(setUsers);

  const add = async e => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    const res = await api.post('/api/members', form);
    if (res.error) { toast(res.error, 'error'); return; }
    // server returns { id, name, email, ..., tempPassword }
    const { tempPassword, ...member } = res;
    setUsers(us => [...us, member]);
    setForm({ name:'', email:'', role:'developer', color:'#6366f1' });
    setShowAdd(false);
    setNewCredentials({ name: member.name, email: member.email, tempPassword });
    toast('Member added', 'success');
  };

  const changeRole = async (id, role) => {
    const res = await api.put(`/api/members/${id}`, { role });
    if (res.error) { toast(res.error, 'error'); return; }
    setUsers(us => us.map(u => u.id === id ? { ...u, role } : u));
    toast('Role updated', 'success');
  };

  const removeMember = async id => {
    if (!confirm('Remove this member from the company?')) return;
    await api.delete(`/api/members/${id}`);
    setUsers(us => us.filter(u => u.id !== id));
    toast('Member removed', 'info');
  };

  const resetPassword = async id => {
    const member = users.find(u => u.id === id);
    const res = await api.post(`/api/members/${id}/reset-password`, {});
    if (res.error) { toast(res.error, 'error'); return; }
    setResetTarget(null);
    // server returns { success, tempPassword } — we grab name/email from local state
    setResetResult({ name: member?.name, email: member?.email, tempPassword: res.tempPassword });
  };

  const copyToClipboard = text => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const roleOrder = { admin:0, developer:1, qa:2 };
  const sorted = [...users].sort((a,b) => (roleOrder[a.role]||9) - (roleOrder[b.role]||9));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Team Members</h1>
          <p>{users.length} member{users.length!==1?'s':''} · {users.filter(u=>u.role==='admin').length} admin · {users.filter(u=>u.role==='developer').length} developer · {users.filter(u=>u.role==='qa').length} QA</p>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={()=>setShowAdd(true)}>+ Add Member</button>}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))',gap:16}}>
        {sorted.map(u => {
          const assigned = bugs.filter(b => b.assigneeId === u.id);
          const done = assigned.filter(b => b.status === 'Done').length;
          const isSelf = u.id === currentUser?.id;
          return (
            <div key={u.id} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20,position:'relative'}}>
              {isSelf && <div style={{position:'absolute',top:12,right:12,fontSize:10,background:'var(--primary)',color:'#fff',padding:'2px 7px',borderRadius:99,fontWeight:600}}>YOU</div>}
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
                <div className="avatar" style={{width:44,height:44,fontSize:16,background:u.color,flexShrink:0}}>{u.avatar}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.name}</div>
                  <div style={{fontSize:12,color:'var(--muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.email}</div>
                  <span style={{display:'inline-block',marginTop:4,fontSize:11,fontWeight:600,color:'#fff',background:ROLE_COLORS[u.role]||'#6366f1',padding:'1px 8px',borderRadius:99}}>
                    {ROLE_LABELS[u.role]||u.role}
                  </span>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
                <div style={{background:'var(--surface2)',borderRadius:6,padding:'8px 10px',textAlign:'center'}}>
                  <div style={{fontSize:20,fontWeight:700,color:'var(--primary)'}}>{assigned.length}</div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>Assigned</div>
                </div>
                <div style={{background:'var(--surface2)',borderRadius:6,padding:'8px 10px',textAlign:'center'}}>
                  <div style={{fontSize:20,fontWeight:700,color:'var(--success)'}}>{done}</div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>Resolved</div>
                </div>
              </div>

              {isAdmin && !isSelf && (
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <select className="form-select" style={{flex:1,fontSize:12,padding:'5px 8px'}} value={u.role} onChange={e=>changeRole(u.id,e.target.value)}>
                    <option value="admin">Admin</option>
                    <option value="developer">Developer</option>
                    <option value="qa">QA</option>
                  </select>
                  <button className="btn btn-ghost btn-sm" style={{fontSize:11}} onClick={()=>setResetTarget(u)}>🔑 Reset PW</button>
                  <button className="btn btn-danger btn-sm" style={{fontSize:11}} onClick={()=>removeMember(u.id)}>Remove</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Member Modal */}
      {showAdd && (
        <Modal onClose={()=>setShowAdd(false)}>
          <div className="modal-header"><h2 className="modal-title">Add Team Member</h2><button className="btn-icon" onClick={()=>setShowAdd(false)}>✕</button></div>
          <form onSubmit={add}>
            <div className="modal-body">
              <div className="form-group"><label className="form-label">Full Name *</label><input className="form-input" value={form.name} onChange={e=>setF('name',e.target.value)} placeholder="Jane Doe" required autoFocus/></div>
              <div className="form-group"><label className="form-label">Work Email *</label><input className="form-input" type="email" value={form.email} onChange={e=>setF('email',e.target.value)} placeholder="jane@company.com" required/></div>
              <div className="form-group">
                <label className="form-label">Role *</label>
                <select className="form-select" value={form.role} onChange={e=>setF('role',e.target.value)}>
                  <option value="developer">Developer</option>
                  <option value="qa">QA</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Avatar Colour</label>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {COLORS.map(c=><div key={c} onClick={()=>setF('color',c)} style={{width:24,height:24,borderRadius:'50%',background:c,cursor:'pointer',border:form.color===c?'3px solid #fff':'3px solid transparent',transform:form.color===c?'scale(1.2)':'none',transition:'all .15s'}}/>)}
                </div>
              </div>
              <div style={{background:'rgba(99,102,241,.08)',border:'1px solid rgba(99,102,241,.2)',borderRadius:8,padding:'10px 14px',fontSize:13,color:'var(--muted)'}}>
                💡 A temporary password will be generated. Share it with the new member so they can log in and change it later.
              </div>
            </div>
            <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={()=>setShowAdd(false)}>Cancel</button><button type="submit" className="btn btn-primary">Add Member</button></div>
          </form>
        </Modal>
      )}

      {/* New credentials display */}
      {newCredentials && (
        <Modal onClose={()=>setNewCredentials(null)}>
          <div className="modal-header"><h2 className="modal-title">✅ Member Added</h2><button className="btn-icon" onClick={()=>setNewCredentials(null)}>✕</button></div>
          <div className="modal-body">
            <p style={{color:'var(--muted)',fontSize:13,marginBottom:16}}>Share these login credentials with <strong>{newCredentials.name}</strong>. The password is temporary — they should change it after logging in.</p>
            <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,padding:16}}>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11,color:'var(--muted)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em'}}>Email</div>
                <div style={{fontWeight:600,fontSize:14}}>{newCredentials.email}</div>
              </div>
              <div>
                <div style={{fontSize:11,color:'var(--muted)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em'}}>Temporary Password</div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <code style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:6,padding:'6px 12px',fontFamily:'monospace',fontSize:14,letterSpacing:'.05em',flex:1}}>{newCredentials.tempPassword}</code>
                  <button className="btn btn-ghost btn-sm" onClick={()=>copyToClipboard(`Email: ${newCredentials.email}\nPassword: ${newCredentials.tempPassword}`)}>
                    {copied ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer"><button className="btn btn-primary" onClick={()=>setNewCredentials(null)}>Done</button></div>
        </Modal>
      )}

      {/* Reset password confirmation */}
      {resetTarget && (
        <Modal onClose={()=>setResetTarget(null)}>
          <div className="modal-header"><h2 className="modal-title">Reset Password</h2><button className="btn-icon" onClick={()=>setResetTarget(null)}>✕</button></div>
          <div className="modal-body">
            <p style={{fontSize:13,color:'var(--muted)'}}>This will generate a new temporary password for <strong>{resetTarget.name}</strong> ({resetTarget.email}). The old password will no longer work.</p>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={()=>setResetTarget(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={()=>resetPassword(resetTarget.id)}>Reset Password</button>
          </div>
        </Modal>
      )}

      {/* Reset password result */}
      {resetResult && (
        <Modal onClose={()=>setResetResult(null)}>
          <div className="modal-header"><h2 className="modal-title">🔑 Password Reset</h2><button className="btn-icon" onClick={()=>setResetResult(null)}>✕</button></div>
          <div className="modal-body">
            <p style={{color:'var(--muted)',fontSize:13,marginBottom:16}}>New temporary password for <strong>{resetResult.name}</strong>:</p>
            <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,padding:16}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <code style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:6,padding:'6px 12px',fontFamily:'monospace',fontSize:14,flex:1}}>{resetResult.tempPassword}</code>
                <button className="btn btn-ghost btn-sm" onClick={()=>copyToClipboard(resetResult.tempPassword)}>{copied ? '✓ Copied' : '📋 Copy'}</button>
              </div>
            </div>
          </div>
          <div className="modal-footer"><button className="btn btn-primary" onClick={()=>setResetResult(null)}>Done</button></div>
        </Modal>
      )}
    </div>
  );
}

// ── SettingsPage (admin only) ─────────────────────────────────────────────────
function SettingsPage({ org, setOrg, currentUser, toast }) {
  const [form, setForm] = useState({ name: org?.name||'', color: org?.color||'#6366f1' });
  const [saving, setSaving] = useState(false);
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async e => {
    e.preventDefault();
    setSaving(true);
    const res = await api.put('/api/org', form);
    if (res.error) { toast(res.error,'error'); } else { setOrg(res); toast('Settings saved','success'); }
    setSaving(false);
  };

  if (currentUser?.role !== 'admin') return (
    <div className="empty-state"><div className="icon">🔒</div><h3>Admin Only</h3><p>Only admins can access company settings.</p></div>
  );

  return (
    <div>
      <div className="page-header"><div><h1>Company Settings</h1><p>Manage your organisation</p></div></div>
      <div style={{maxWidth:480}}>
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:24}}>
          <h3 style={{fontSize:14,fontWeight:600,marginBottom:20}}>Organisation Details</h3>
          <form onSubmit={save}>
            <div className="form-group">
              <label className="form-label">Company Name</label>
              <input className="form-input" value={form.name} onChange={e=>setF('name',e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Brand Colour</label>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {COLORS.map(c=><div key={c} onClick={()=>setF('color',c)} style={{width:28,height:28,borderRadius:'50%',background:c,cursor:'pointer',border:form.color===c?'3px solid #fff':'3px solid transparent',transform:form.color===c?'scale(1.2)':'none',transition:'all .15s'}}/>)}
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{marginTop:8}}>{saving?'Saving…':'Save Changes'}</button>
          </form>
        </div>

        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:24,marginTop:16}}>
          <h3 style={{fontSize:14,fontWeight:600,marginBottom:4}}>Company Slug</h3>
          <p style={{fontSize:13,color:'var(--muted)',marginBottom:12}}>This is your unique identifier used in the system.</p>
          <code style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 14px',fontSize:13,display:'block'}}>{org?.slug}</code>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
function App() {
  const [authUser, setAuthUser]     = useState(null);
  const [authOrg, setAuthOrg]       = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView]             = useState('dashboard');
  const [projects, setProjects]     = useState([]);
  const [users, setUsers]           = useState([]);
  const [allBugs, setAllBugs]       = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [toasts, setToasts]         = useState([]);
  const [theme, setTheme]           = useState(() => localStorage.getItem('bt_theme') || 'dark');

  // Apply theme to <html> whenever it changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bt_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const toast = (message, type='info') => {
    const id = Date.now();
    setToasts(ts => [...ts, { id, message, type }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 3500);
  };

  // ── Check existing token on load ──
  useEffect(() => {
    const token = Token.get();
    if (!token) { setAuthChecked(true); return; }
    api.get('/api/auth/me')
      .then(data => {
        if (data.error) { Token.clear(); setAuthChecked(true); }
        else { setAuthUser(data.user || data); setAuthOrg(data.org || null); setAuthChecked(true); }
      })
      .catch(() => { Token.clear(); setAuthChecked(true); });
  }, []);

  // ── Load app data after login ──
  useEffect(() => {
    if (!authUser) return;
    Promise.all([api.get('/api/projects'), api.get('/api/members'), api.get('/api/bugs')])
      .then(([p, u, b]) => { setProjects(p); setUsers(u); setAllBugs(b); });
  }, [authUser]);

  const handleAuth = (user, org) => {
    setAuthUser(user);
    setAuthOrg(org || null);
  };

  const handleLogout = async () => {
    await api.post('/api/auth/logout', {});
    Token.clear();
    setAuthUser(null);
    setAuthOrg(null);
    setProjects([]); setUsers([]); setAllBugs([]);
    toast('Logged out successfully', 'info');
  };

  const currentProject = projects.find(p => p.id === currentProjectId) || null;
  const navItems = [
    { id:'dashboard', label:'Dashboard', icon:'📊' },
    { id:'board',     label:'Board',     icon:'📋' },
    { id:'list',      label:'Issues',    icon:'🐛' },
    { id:'projects',  label:'Projects',  icon:'📁' },
    { id:'team',      label:'Team',      icon:'👥' },
    ...(authUser?.role==='admin' ? [{ id:'settings', label:'Settings', icon:'⚙️' }] : []),
  ];
  const navigate = v => setView(v);

  // ── Loading splash ──
  if (!authChecked) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', color:'var(--muted)' }}>
      Loading…
    </div>
  );

  // ── Auth gate ──
  if (!authUser) return (
    <>
      <AuthPage onAuth={handleAuth}/>
      <Toast toasts={toasts} dismiss={id=>setToasts(ts=>ts.filter(t=>t.id!==id))}/>
    </>
  );

  // ── Company colour from org ──
  const orgColor = authOrg?.color || '#6366f1';

  return (
    <div className="app">
      <aside className="sidebar">
        {/* Company / Logo header */}
        <div className="sidebar-logo" style={{flexDirection:'column',alignItems:'flex-start',gap:0,paddingBottom:14}}>
          <div style={{display:'flex',alignItems:'center',gap:10,width:'100%'}}>
            <div className="logo-icon" style={{background:orgColor}}>{(authOrg?.name||'BT').slice(0,2).toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{authOrg?.name||'BugTracker'}</div>
              <div style={{fontSize:10,color:'var(--muted)',marginTop:1}}>Bug Tracker</div>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Main</div>
          {navItems.map(item => (
            <div key={item.id} className={`sidebar-item ${view===item.id?'active':''}`} onClick={()=>setView(item.id)}>
              <span className="icon">{item.icon}</span><span className="label">{item.label}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Projects</div>
          <div className={`sidebar-item ${!currentProjectId?'active':''}`} onClick={()=>setCurrentProjectId(null)}>
            <span style={{width:10,height:10,borderRadius:'50%',background:'var(--muted)',flexShrink:0}}/><span className="label">All Projects</span>
          </div>
          {projects.map(p => (
            <div key={p.id} className={`sidebar-item ${currentProjectId===p.id?'active':''}`} onClick={()=>setCurrentProjectId(p.id)}>
              <span style={{width:10,height:10,borderRadius:'50%',background:p.color,flexShrink:0}}/><span className="label">{p.name}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="user-badge" style={{marginBottom:10}}>
            <div className="avatar" style={{background:authUser.color||'#6366f1'}}>{authUser.avatar||(authUser.name?.slice(0,2)||'?').toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{authUser.name}</div>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:10,fontWeight:600,color:'#fff',background:ROLE_COLORS[authUser.role]||'#6366f1',padding:'1px 6px',borderRadius:99,textTransform:'capitalize'}}>
                  {ROLE_LABELS[authUser.role]||authUser.role}
                </span>
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{width:'100%',justifyContent:'center'}} onClick={handleLogout}>
            🚪 Log Out
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <span className="topbar-title">
            {navItems.find(n=>n.id===view)?.icon} {navItems.find(n=>n.id===view)?.label}
            {currentProject&&<span style={{color:'var(--muted)',fontWeight:400,marginLeft:6}}>/ {currentProject.name}</span>}
          </span>
          <div className="search-wrap">
            <span className="search-icon">🔍</span>
            <input type="text" placeholder="Quick search…" onFocus={()=>setView('list')}/>
          </div>
          <button className="theme-toggle" onClick={toggleTheme} title={theme==='dark'?'Switch to light mode':'Switch to dark mode'}>
            {theme==='dark' ? '☀️' : '🌙'}
          </button>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{textAlign:'right',display:'flex',flexDirection:'column'}}>
              <span style={{fontSize:13,fontWeight:500}}>{authUser.name}</span>
              <span style={{fontSize:11,color:'var(--muted)'}}>{authOrg?.name}</span>
            </div>
            <div className="avatar" style={{background:authUser.color||'#6366f1'}}>{authUser.avatar||(authUser.name?.slice(0,2)||'?').toUpperCase()}</div>
          </div>
        </div>

        <div className="content">
          {view==='dashboard' && <Dashboard projects={projects} users={users} currentProject={currentProject} onNavigate={navigate}/>}
          {view==='board'     && <KanbanBoard projects={projects} users={users} currentProject={currentProject} toast={toast} currentUser={authUser}/>}
          {view==='list'      && <BugList projects={projects} users={users} currentProject={currentProject} toast={toast} currentUser={authUser}/>}
          {view==='projects'  && <ProjectsPage projects={projects} setProjects={setProjects} toast={toast}/>}
          {view==='team'      && <TeamPage users={users} setUsers={setUsers} bugs={allBugs} toast={toast} currentUser={authUser}/>}
          {view==='settings'  && <SettingsPage org={authOrg} setOrg={setAuthOrg} currentUser={authUser} toast={toast}/>}
        </div>
      </main>

      <Toast toasts={toasts} dismiss={id=>setToasts(ts=>ts.filter(t=>t.id!==id))}/>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
