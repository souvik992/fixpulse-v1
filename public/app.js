const { useState, useEffect, useRef, useCallback } = React;
const API = '';
const BRAND_LOGO = '/fixpulse-logo.png';

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
const formatDate   = ts => ts ? new Date(ts).toLocaleDateString('en-GB') : '—';
const formatDateTime = ts => ts ? new Date(ts).toLocaleString('en-GB') : 'Unavailable';
const isSheetImportedBug = bug => bug?.sourceKind === 'google_sheet' || Boolean(getMetadataValue(bug?.description, 'Source Tab'));
const getIssueCreatedDate = bug => isSheetImportedBug(bug) ? (bug?.sourceCreatedAt || null) : (bug?.createdAt || null);
const formatIssueCreatedDate = bug => {
  const createdAt = getIssueCreatedDate(bug);
  if (!createdAt) return 'Unavailable';
  return formatDate(createdAt);
};
const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const getInitials = name => String(name||'').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0,2).toUpperCase() || '?';
const getMetadataValue = (description, label) => {
  if (!description) return '';
  const prefix = `${label}:`;
  const line = String(description).split('\n').find(entry => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
};
const getFirstMetadataValue = (description, labels) => {
  for (const label of labels) {
    const value = getMetadataValue(description, label);
    if (value) return value;
  }
  return '';
};
const resolveIssueUser = (bug, users, idKey, metadataLabels) => {
  const user = bug?.[idKey] ? users.find(u => u.id === bug[idKey]) : null;
  if (user) return user;
  const fallbackName = getFirstMetadataValue(bug?.description, Array.isArray(metadataLabels) ? metadataLabels : [metadataLabels]);
  return fallbackName ? { name: fallbackName, avatar: '', color: '#64748b' } : null;
};
const renderCompactStatusPills = stats => Object.entries(stats.byStatus || {})
  .map(([label, count]) => `<div class="pill"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>`)
  .join('');
const renderPriorityBars = stats => {
  const entries = Object.entries(stats.byPriority || {});
  const max = Math.max(...entries.map(([, count]) => Number(count) || 0), 1);
  return entries.map(([label, count]) => `
    <div class="bar-row">
      <div class="bar-meta"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max((Number(count) || 0) / max * 100, 4)}%"></div></div>
    </div>
  `).join('');
};
const REPORT_FILTER_DEFAULTS = { projectId:'', startDate:'', endDate:'', assigneeId:'', priority:'', status:'', type:'' };
const matchesReportFilters = (bug, filters) => {
  const createdAt = getIssueCreatedDate(bug);
  if (filters.startDate || filters.endDate) {
    if (!createdAt) return false;
    const createdDate = new Date(createdAt);
    if (filters.startDate && createdDate < new Date(`${filters.startDate}T00:00:00`)) return false;
    if (filters.endDate && createdDate > new Date(`${filters.endDate}T23:59:59.999`)) return false;
  }
  if (filters.assigneeId && (bug.assigneeId || '') !== filters.assigneeId) return false;
  if (filters.priority && bug.priority !== filters.priority) return false;
  if (filters.status && bug.status !== filters.status) return false;
  if (filters.type && bug.type !== filters.type) return false;
  return true;
};
const summarizeBugs = bugs => ({
  total: bugs.length,
  openCount: bugs.filter(b => b.status !== 'Done').length,
  doneCount: bugs.filter(b => b.status === 'Done').length,
  byPriority: ['Critical','High','Medium','Low'].reduce((acc, label) => ({ ...acc, [label]: bugs.filter(b => b.priority === label).length }), {}),
  byStatus: ['To Do','In Progress','In Review','Done'].reduce((acc, label) => ({ ...acc, [label]: bugs.filter(b => b.status === label).length }), {}),
});
const buildProjectReportHtml = ({ project, stats, bugs, users, generatedAt }) => {
  const rows = bugs.map(bug => {
    const assignee = resolveIssueUser(bug, users, 'assigneeId', ['Assignee(s)', 'Assignee From Sheet']);
    const issueUrl = `${window.location.origin}/#issue/${bug.id}`;
    return `
      <tr class="issuerow">
        <td class="issuetype">${escapeHtml(bug.type || 'Bug')}</td>
        <td class="issuekey"><a class="issue-link" href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(bug.key || '')}</a></td>
        <td class="summary"><p>${escapeHtml(bug.title)}</p></td>
        <td class="created">${escapeHtml(formatIssueCreatedDate(bug))}</td>
        <td class="priority">${escapeHtml(bug.priority || 'Medium')}</td>
        <td class="assignee">${escapeHtml(assignee?.name || 'Unassigned')}</td>
        <td class="status">${escapeHtml(bug.status || 'To Do')}</td>
      </tr>
    `;
  }).join('');
  return `<!doctype html>
<html xmlns="http://www.w3.org/TR/REC-html40" lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(project.name)} - Bug Report</title>
  <meta http-equiv="Content-Type" content="application/vnd.ms-excel; charset=UTF-8">
  <style>
    table { mso-displayed-decimal-separator:"\\."; mso-displayed-thousand-separator:"\\,"; }
    body { margin:0; font-size:12px; font-family:Arial,sans-serif; color:black; background:white; }
    @page {
      mso-page-orientation:landscape;
      margin:.25in .25in .5in .25in;
      mso-header-margin:.5in;
      mso-footer-margin:.25in;
      mso-footer-data:"&R&P of &N";
      mso-horizontal-page-align:center;
      mso-vertical-page-align:center;
    }
    td.issuekey, td.issuetype, td.status { mso-style-parent:""; mso-number-format:\\@; text-align:left; }
    br { mso-data-placement:same-cell; }
    td { vertical-align:top; }
    a { color:#2a5db0; text-decoration:none; }
    .summary p { margin:0; }
    .report-link { margin: 6px 0; display:inline-block; }
  </style>
</head>
<body>
  <table border="1">
    <tr bgcolor="#205081" height="30">
      <td colspan="7" style="padding:4px 8px;">
        <img src="${escapeHtml(window.location.origin + BRAND_LOGO)}" alt="Jira" style="display:block;width:64px;height:32px;object-fit:contain;background:#fff;border-radius:4px;padding:2px;">
      </td>
    </tr>
    <tr>
      <td colspan="7">
        <a class="report-link" href="${escapeHtml(window.location.origin)}">${escapeHtml(project.name)} - Bug List</a>
      </td>
    </tr>
    <tr>
      <td colspan="7">
        Displaying <strong>${bugs.length}</strong> issues at <strong>${escapeHtml(new Date(generatedAt).toLocaleString('en-GB'))}</strong>.
      </td>
    </tr>
    <tr>
      <td><strong>Total</strong><br>${stats.total}</td>
      <td><strong>Open</strong><br>${stats.openCount}</td>
      <td><strong>Done</strong><br>${stats.doneCount}</td>
      <td><strong>Critical</strong><br>${stats.byPriority?.Critical || 0}</td>
      <td><strong>Project Key</strong><br>${escapeHtml(project.key || '-')}</td>
      <td><strong>Generated For</strong><br>${escapeHtml(project.name)}</td>
    </tr>
  </table>

  <table id="issuetable" border="1" cellpadding="3" cellspacing="1" width="100%">
    <thead>
      <tr class="rowHeader">
        <th>Issue Type</th>
        <th>Key</th>
        <th>Summary</th>
        <th>Creation Date</th>
        <th>Priority</th>
        <th>Assignee</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
};
const COLORS       = ['#6366f1','#10b981','#f59e0b','#ef4444','#38bdf8','#ec4899','#8b5cf6','#14b8a6'];
const ROLE_LABELS  = { admin:'Admin', project_manager:'Project Manager', developer:'Developer', frontend_developer:'Frontend Developer', backend_developer:'Backend Developer', tester:'QA', viewer:'Viewer', qa:'QA', 'Project Manager':'Project Manager', 'Developer':'Developer', 'Frontend Developer':'Frontend Developer', 'Backend Developer':'Backend Developer', 'Tester':'QA', 'QA':'QA', 'Viewer':'Viewer' };
const ROLE_COLORS  = { admin:'#ef4444', project_manager:'#f97316', developer:'#6366f1', frontend_developer:'#3b82f6', backend_developer:'#2563eb', tester:'#10b981', viewer:'#9ca3af', qa:'#10b981', 'Admin':'#ef4444', 'Project Manager':'#f97316', 'Developer':'#6366f1', 'Frontend Developer':'#3b82f6', 'Backend Developer':'#2563eb', 'Tester':'#10b981', 'Viewer':'#9ca3af' };
const PLAN_OPTIONS = [
  { code:'basic', name:'Basic', price:'Free', userLimit:10, blurb:'A clean starting point for small teams that need structured bug tracking without complexity.', cta:'Start Free', featured:false },
  { code:'plus', name:'Plus', price:'$32.50 / mo', userLimit:50, blurb:'A professional plan for active engineering, QA, and delivery teams that need more seats and room to grow.', cta:'Pay and Upgrade', featured:true },
  { code:'enterprise', name:'Enterprise', price:'$108.30 / mo', userLimit:null, blurb:'For larger rollouts, unlimited seats, and organizations that need unrestricted team expansion.', cta:'Pay and Upgrade', featured:false },
];
const ALL_PERMISSIONS = ['CREATE_ISSUE','EDIT_ISSUE','DELETE_ISSUE','ASSIGN_ISSUE','CHANGE_STATUS','COMMENT','VIEW_ISSUE','VIEW_REPORTS','MANAGE_PROJECT','MANAGE_USERS','CONFIGURE_WORKFLOW'];

const readFilesAsAttachments = files => Promise.all(
  [...files]
    .filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'))
    .map(file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }))
);

const readImageAsDataUrl = file => new Promise((resolve, reject) => {
  if (!file || !file.type.startsWith('image/')) {
    return resolve(null); // Or handle error appropriately, e.g., reject('Only image files are allowed');
  }
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const readFileAsDataUrl = file => new Promise((resolve, reject) => {
  if (!file) return resolve(null);
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const ensureRazorpayLoaded = () => new Promise((resolve, reject) => {
  if (window.Razorpay) return resolve(true);
  const existing = document.querySelector('script[data-razorpay-checkout]');
  if (existing) {
    existing.addEventListener('load', () => resolve(true), { once: true });
    existing.addEventListener('error', () => reject(new Error('Unable to load Razorpay checkout')), { once: true });
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.async = true;
  script.dataset.razorpayCheckout = 'true';
  script.onload = () => resolve(true);
  script.onerror = () => reject(new Error('Unable to load Razorpay checkout'));
  document.body.appendChild(script);
});

// ── Toast ──────────────────────────────────────────────────────────────────────
function useSheetSyncStatus() {
  const [syncStatus, setSyncStatus] = useState(null);

  const loadStatus = useCallback(async () => {
    try {
      const status = await api.get('/api/sheet-sync/status');
      if (!status?.error) setSyncStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const guardedLoad = async () => {
      const status = await loadStatus();
      if (!active || !status?.running) return;
      setTimeout(() => {
        if (active) guardedLoad();
      }, 5000);
    };

    guardedLoad();
    const timer = setInterval(loadStatus, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loadStatus]);

  return { syncStatus, refreshSyncStatus: loadStatus };
}

function SyncTimestamp({ toast }) {
  const { syncStatus, refreshSyncStatus } = useSheetSyncStatus();
  const [syncing, setSyncing] = useState(false);

  const runManualSync = async () => {
    if (syncing || syncStatus?.running) return;
    setSyncing(true);
    try {
      const result = await api.post('/api/sheet-sync/run', {});
      if (result?.error) {
        toast?.(result.error, 'error');
      } else {
        toast?.(result.started ? 'Manual data sync started' : 'Data sync is already running', 'info');
        setTimeout(() => { refreshSyncStatus(); }, 1500);
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{marginLeft:'auto', textAlign:'right', display:'flex', alignItems:'center', gap:10}}>
      <div>
        <div style={{fontSize:11, fontWeight:600, color:'var(--text)', textTransform:'uppercase', letterSpacing:'0.04em'}}>Last Data Sync</div>
        <div style={{fontSize:12, color:'var(--muted)'}}>{formatDateTime(syncStatus?.lastSuccessAt)}</div>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={runManualSync}
        disabled={syncing || syncStatus?.running}
        title="Sync data now"
        style={{padding:'6px 10px', minWidth:'auto'}}
      >
        {syncing || syncStatus?.running ? '↻' : '⟳'}
      </button>
    </div>
  );
}

function IssueTable({ bugs, users, projects, currentProject, onSelectBug, emptyText='No issues found.' }) {
  const showProjectColumn = !currentProject;

  if (!bugs.length) {
    return <div className="text-muted text-sm">{emptyText}</div>;
  }

  return (
    <div className="table-scroll">
      <table className="bug-table">
        <thead>
          <tr>
            <th>Date Created</th>
            <th>Issue Title</th>
            {showProjectColumn && <th>Project Name</th>}
            <th>Raised By</th>
            <th>Issue Type</th>
            <th>Assignee</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Last Updated</th>
          </tr>
        </thead>
        <tbody>
          {bugs.map(bug => {
            const assignee = resolveIssueUser(bug, users, 'assigneeId', ['Assignee(s)', 'Assignee From Sheet']);
            const reporter = resolveIssueUser(bug, users, 'reporterId', 'Raised By');
            const project = projects.find(p => p.id === bug.projectId);
            return (
              <tr key={`compact-${bug.id}`} onClick={() => onSelectBug(bug.id)}>
                <td><span className="text-muted text-sm">{formatIssueCreatedDate(bug)}</span></td>
                <td><span className="issue-title">{bug.title}</span></td>
                {showProjectColumn && <td><span className="text-muted text-sm">{project?.name || '—'}</span></td>}
                <td>{reporter ? <div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={reporter} size="xs" /><span style={{fontSize:12}}>{reporter.name}</span></div> : <span className="text-muted text-sm">Unknown</span>}</td>
                <td><TypeBadge t={bug.type} /></td>
                <td>{assignee ? <div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={assignee} size="xs" /><span style={{fontSize:12}}>{assignee.name}</span></div> : <span className="text-muted text-sm">Unassigned</span>}</td>
                <td><PriorityBadge p={bug.priority} /></td>
                <td><StatusBadge s={bug.status} /></td>
                <td><span className="text-muted text-sm">{formatDate(bug.updatedAt)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExportReportFiltersModal({ visible, onClose, currentProject, projects, users, exportFilters, setExportFilter, onReset, onExport }) {
  if (!visible) return null;

  return (
    <Modal onClose={onClose}>
      <div className="modal-header"><h2 className="modal-title">Export Report Filters</h2><button className="btn-icon" onClick={onClose}>✕</button></div>
      <div className="modal-body">
        {!currentProject && (
          <div className="form-group">
            <label className="form-label">Project</label>
            <select className="form-select" value={exportFilters.projectId} onChange={e => setExportFilter('projectId', e.target.value)}>
              <option value="">Select Project</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
        )}
        <div className="form-row">
          <div className="form-group"><label className="form-label">Starting Date</label><input className="form-input" type="date" value={exportFilters.startDate} onChange={e => setExportFilter('startDate', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Ending Date</label><input className="form-input" type="date" value={exportFilters.endDate} onChange={e => setExportFilter('endDate', e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Assignee</label><select className="form-select" value={exportFilters.assigneeId} onChange={e => setExportFilter('assigneeId', e.target.value)}><option value="">All Assignees</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <div className="form-group"><label className="form-label">Priority</label><select className="form-select" value={exportFilters.priority} onChange={e => setExportFilter('priority', e.target.value)}><option value="">All Priorities</option>{['Critical','High','Medium','Low'].map(p => <option key={p} value={p}>{p}</option>)}</select></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Status</label><select className="form-select" value={exportFilters.status} onChange={e => setExportFilter('status', e.target.value)}><option value="">All Statuses</option>{['To Do','In Progress','In Review','Done'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className="form-group"><label className="form-label">Issue Type</label><select className="form-select" value={exportFilters.type} onChange={e => setExportFilter('type', e.target.value)}><option value="">All Types</option>{['Bug','Feature','Task','Improvement'].map(t => <option key={t} value={t}>{t}</option>)}</select></div>
        </div>
      </div>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onReset}>Reset</button><button type="button" className="btn btn-primary" onClick={onExport}>Export</button></div>
    </Modal>
  );
}

function useProjectReportExport({ currentProject, projects, users, toast }) {
  const [showExportFilters, setShowExportFilters] = useState(false);
  const [exportFilters, setExportFilters] = useState(REPORT_FILTER_DEFAULTS);

  useEffect(() => {
    setExportFilters(f => ({ ...f, projectId: currentProject?.id || '' }));
  }, [currentProject]);

  const setExportFilter = (key, value) => setExportFilters(f => ({ ...f, [key]: value }));
  const openExportModal = () => setShowExportFilters(true);
  const closeExportModal = () => setShowExportFilters(false);
  const resetExportFilters = () => setExportFilters({ ...REPORT_FILTER_DEFAULTS, projectId: currentProject?.id || '' });

  const exportReport = async () => {
    const selectedProject = currentProject || projects.find(p => p.id === exportFilters.projectId);
    if (!selectedProject) {
      toast('Select a project to export its report', 'info');
      return;
    }

    const popup = window.open('', '_blank');
    if (!popup) {
      toast('Allow pop-ups to open the HTML report', 'error');
      return;
    }

    popup.document.write('<!doctype html><title>Preparing report...</title><body style="font-family:Arial,sans-serif;padding:24px">Preparing project report...</body>');

    try {
      const [reportStats, reportBugs] = await Promise.all([
        api.get(`/api/stats?projectId=${selectedProject.id}`),
        api.get(`/api/bugs?projectId=${selectedProject.id}`),
      ]);
      const filteredBugs = reportBugs.filter(bug => matchesReportFilters(bug, exportFilters));
      const html = buildProjectReportHtml({
        project: selectedProject,
        stats: { ...reportStats, ...summarizeBugs(filteredBugs) },
        bugs: filteredBugs,
        users,
        generatedAt: Date.now(),
      });
      const blob = new Blob([html], { type: 'text/html' });
      const reportUrl = URL.createObjectURL(blob);
      popup.location.href = reportUrl;
      setTimeout(() => URL.revokeObjectURL(reportUrl), 60000);
      closeExportModal();
      toast('Project report opened in a new tab', 'success');
    } catch (error) {
      popup.close();
      toast('Unable to generate project report', 'error');
    }
  };

  return {
    showExportFilters,
    exportFilters,
    setExportFilter,
    openExportModal,
    closeExportModal,
    resetExportFilters,
    exportReport,
  };
}

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
  const cls = `avatar ${size==='xs'?'avatar-xs':size==='sm'?'avatar-sm':''}`;
  if (!user) return <div className={cls} style={{background:'var(--surface2)',border:'1px solid var(--border)',color:'var(--muted)'}}>👤</div>;
  if (user.avatar && user.avatar.startsWith('data:image/')) {
    return <img src={user.avatar} alt={user.name} className={cls} style={{background:'var(--surface2)',border:'1px solid var(--border)'}} title={user.name} />;
  }
  return <div className={cls} style={{background:'var(--surface2)',border:'1px solid var(--border)',color:'var(--muted)'}} title={user.name}>👤</div>;
}

function PriorityBadge({ p }) { return <span className={`badge ${priorityBadge(p)}`}>{priorityIcon(p)} {p}</span>; }
function StatusBadge({ s })   { return <span className={`badge ${statusBadge(s)}`}>{statusIcon(s)} {s}</span>; }
function TypeBadge({ t })     { return <span className={`badge ${typeBadge(t)}`}>{typeIcon(t)} {t}</span>; }
function BrandLogo({ src=BRAND_LOGO, size=48, rounded=12, style={} }) {
  return (
    <img
      src={src}
      alt="FixPulse logo"
      style={{
        width:size,
        height:size,
        borderRadius:rounded,
        objectFit:'cover',
        display:'block',
        ...style,
      }}
    />
  );
}

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
  const initialToken = new URLSearchParams(window.location.search).get('reset_token') || '';
  const [mode, setMode]       = useState(initialToken ? 'reset-password' : 'landing'); // 'landing' | 'login' | 'register' | 'forgot-password' | 'reset-password' | 'reset-done'
  const [form, setForm]       = useState({ companyName:'', name:'', email:'', password:'', confirm:'', color:'#6366f1', resetToken: initialToken });
  const [avatarFile, setAvatarFile] = useState(null);
  const [orgLogoFile, setOrgLogoFile] = useState(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);

  const set = (k,v) => { setForm(f=>({...f,[k]:v})); setError(''); };

  const submit = async e => {
    e.preventDefault();
    setError('');

    if (mode === 'forgot-password') {
      if (!form.email) return setError('Email is required');
      setLoading(true);
      try {
        await fetch('/api/auth/forgot-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: form.email }) });
        setMode('forgot-sent');
      } catch { setError('Cannot connect to server.'); }
      setLoading(false);
      return;
    }

    if (mode === 'reset-password') {
      if (form.password.length < 6) return setError('Password must be at least 6 characters');
      if (form.password !== form.confirm) return setError('Passwords do not match');
      setLoading(true);
      try {
        const res  = await fetch('/api/auth/reset-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: form.resetToken, password: form.password }) });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'Something went wrong'); setLoading(false); return; }
        // Clear token from URL
        window.history.replaceState({}, '', '/');
        setMode('reset-done');
      } catch { setError('Cannot connect to server.'); }
      setLoading(false);
      return;
    }

    if (mode === 'register') {
      if (!form.companyName.trim()) return setError('Company name is required');
      if (!form.name.trim())        return setError('Your name is required');
      if (form.password.length < 6) return setError('Password must be at least 6 characters');
      if (form.password !== form.confirm) return setError('Passwords do not match');
    }

    setLoading(true);
    try {
      const url  = mode==='login' ? '/api/auth/login' : '/api/auth/register-company';
      const avatarDataUrl = avatarFile ? await readImageAsDataUrl(avatarFile) : null;
      const orgLogoDataUrl = orgLogoFile ? await readImageAsDataUrl(orgLogoFile) : null;
      const body = mode === 'login'
        ? { email: form.email, password: form.password }
        : { companyName: form.companyName, name: form.name, email: form.email, password: form.password, color: form.color, avatarDataUrl, orgLogoDataUrl };
      const res  = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error||'Something went wrong'); setLoading(false); return; }
      Token.set(data.token);
      onAuth(data.user, data.org);
    } catch { setError('Cannot connect to server. Make sure it is running.'); }
    setLoading(false);
  };

  const reset = m => {
    setMode(m);
    setError('');
    setAvatarFile(null);
    setOrgLogoFile(null);
    setForm({ companyName:'', name:'', email:'', password:'', confirm:'', color:'#6366f1', resetToken:'' });
  };
  
  // ── Landing ──
  if (mode === 'landing') return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:480, textAlign:'center' }}>
        <BrandLogo size={84} rounded={20} style={{ margin:'0 auto 16px' }} />
        <h1 style={{ fontSize:28, fontWeight:800, marginBottom:8 }}>FixPulse</h1>
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
          <BrandLogo size={64} rounded={16} style={{ margin:'0 auto 10px' }} />
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
                <label className="form-label">Company Photo or Logo (optional)</label>
                <input className="form-input" type="file" accept="image/*" onChange={e => setOrgLogoFile(e.target.files?.[0] || null)} />
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
              <div className="form-group"><label className="form-label">Profile Photo (optional)</label>
                <input className="form-input" type="file" accept="image/*" onChange={e => setAvatarFile(e.target.files?.[0])} /></div>
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
              <span>New to FixPulse? <span style={{ color:'var(--primary)', cursor:'pointer', fontWeight:600 }} onClick={()=>reset('register')}>Register your company →</span></span>
            ) : (
              <span>Already have a workspace? <span style={{ color:'var(--primary)', cursor:'pointer', fontWeight:600 }} onClick={()=>reset('login')}>Log in →</span></span>
            )}
          </div>
          {mode === 'login' && (
            <div style={{ textAlign:'center', marginTop:8 }}>
              <span style={{ color:'var(--primary)', fontSize:12, cursor:'pointer', fontWeight:500 }} onClick={()=>reset('forgot-password')}>Forgot your password?</span>
            </div>
          )}
          <div style={{ textAlign:'center', marginTop:8 }}>
            <span style={{ color:'var(--muted)', fontSize:12, cursor:'pointer' }} onClick={()=>reset('landing')}>← Back</span>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Forgot password ──
  if (mode === 'forgot-password') return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <BrandLogo size={64} rounded={16} style={{ margin:'0 auto 10px' }} />
          <h1 style={{ fontSize:20, fontWeight:700 }}>Forgot Password</h1>
          <p style={{ color:'var(--muted)', fontSize:13, marginTop:4 }}>Enter your email and we'll send you a reset link</p>
        </div>
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:28 }}>
          <form onSubmit={submit}>
            <div className="form-group">
              <label className="form-label">Work Email *</label>
              <input className="form-input" type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="you@company.com" required autoFocus />
            </div>
            {error && <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:'10px 14px', color:'#ef4444', fontSize:13, marginBottom:16 }}>⚠ {error}</div>}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width:'100%', justifyContent:'center', padding:'11px 0', fontSize:14 }}>
              {loading ? '⏳ Sending…' : '📧 Send Reset Link'}
            </button>
          </form>
          <div style={{ textAlign:'center', marginTop:12 }}>
            <span style={{ color:'var(--muted)', fontSize:12, cursor:'pointer' }} onClick={()=>reset('login')}>← Back to Login</span>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Forgot sent confirmation ──
  if (mode === 'forgot-sent') return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:420, textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>📧</div>
        <h1 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>Check your email</h1>
        <p style={{ color:'var(--muted)', fontSize:14, marginBottom:24 }}>If an account exists for that email, we've sent a password reset link. It expires in 1 hour.</p>
        <button className="btn btn-primary" style={{ justifyContent:'center', padding:'11px 24px' }} onClick={()=>reset('login')}>Back to Login</button>
      </div>
    </div>
  );

  // ── Reset password ──
  if (mode === 'reset-password') return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <BrandLogo size={64} rounded={16} style={{ margin:'0 auto 10px' }} />
          <h1 style={{ fontSize:20, fontWeight:700 }}>Set New Password</h1>
          <p style={{ color:'var(--muted)', fontSize:13, marginTop:4 }}>Choose a strong password for your account</p>
        </div>
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:28 }}>
          <form onSubmit={submit}>
            <div className="form-group" style={{ position:'relative' }}>
              <label className="form-label">New Password *</label>
              <input className="form-input" type={showPw?'text':'password'} value={form.password} onChange={e=>set('password',e.target.value)} placeholder="Min. 6 characters" required autoFocus style={{ paddingRight:40 }} />
              <button type="button" onClick={()=>setShowPw(v=>!v)} style={{ position:'absolute', right:10, top:30, background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:16 }}>{showPw?'🙈':'👁'}</button>
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password *</label>
              <input className="form-input" type={showPw?'text':'password'} value={form.confirm} onChange={e=>set('confirm',e.target.value)} placeholder="Repeat password" required />
            </div>
            {error && <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:'10px 14px', color:'#ef4444', fontSize:13, marginBottom:16 }}>⚠ {error}</div>}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width:'100%', justifyContent:'center', padding:'11px 0', fontSize:14 }}>
              {loading ? '⏳ Saving…' : '🔒 Set New Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  // ── Reset done ──
  if (mode === 'reset-done') return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:420, textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
        <h1 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>Password updated!</h1>
        <p style={{ color:'var(--muted)', fontSize:14, marginBottom:24 }}>Your password has been changed. You can now log in with your new password.</p>
        <button className="btn btn-primary" style={{ justifyContent:'center', padding:'11px 24px' }} onClick={()=>reset('login')}>Go to Login</button>
      </div>
    </div>
  );
}

// ── BugModal ──────────────────────────────────────────────────────────────────
function BugModal({ bug, projects, users, currentProject, onClose, onSave, toast }) {
  const editing = !!bug;
  const [form, setForm] = useState({ title:bug?.title||'', description:bug?.description||'', projectId:bug?.projectId||currentProject?.id||projects[0]?.id||'', type:bug?.type||'Bug', priority:bug?.priority||'Medium', assigneeId:bug?.assigneeId||'', labels:bug?.labels?.join(', ')||'', attachments:bug?.attachments||[], referenceLink:bug?.referenceLink||'', curlCommand:bug?.curlCommand||'' });
  const [projectPermissions, setProjectPermissions] = useState(new Set());
  const [showCurl, setShowCurl] = useState(!!bug?.curlCommand);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  useEffect(()=>{
    if (!form.projectId) { setProjectPermissions(new Set()); return; }
    api.get(`/api/rbac/me/permissions?projectId=${form.projectId}`)
      .then(res => setProjectPermissions(new Set(res.permissions || [])))
      .catch(() => setProjectPermissions(new Set()));
  },[form.projectId]);
  const handleSubmit = async e => {
    e.preventDefault(); if (!form.title.trim()) return;
    const payload={...form, labels:form.labels?form.labels.split(',').map(l=>l.trim()).filter(Boolean):[], referenceLink:(form.referenceLink||'').trim(), curlCommand:(form.curlCommand||'').trim()};
    if (!projectPermissions.has('ASSIGN_ISSUE')) {
      delete payload.assigneeId;
    }
    try {
      if (editing) {
        const u=await api.put(`/api/bugs/${bug.id}`,payload);
        if (u?.error) { toast(u.error,'error'); return; }
        toast('Issue updated','success'); onSave(u);
      }
      else {
        const c=await api.post('/api/bugs',payload);
        if (c?.error) { toast(c.error,'error'); return; }
        toast('Issue created','success'); onSave(c);
      }
    } catch { toast('Something went wrong','error'); }
  };
  const addAttachments = async files => {
    try {
      const next = await readFilesAsAttachments(files);
      set('attachments', [...form.attachments, ...next]);
    } catch {
      toast('Unable to read selected files','error');
    }
  };
  const removeAttachment = index => set('attachments', form.attachments.filter((_, i) => i !== index));
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
            <div className="form-group"><label className="form-label">Assignee</label><select className="form-select" value={form.assigneeId} onChange={e=>set('assigneeId',e.target.value)} disabled={!projectPermissions.has('ASSIGN_ISSUE')}><option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>{!projectPermissions.has('ASSIGN_ISSUE')&&<div style={{fontSize:11,color:'var(--muted)',marginTop:6}}>You do not have permission to assign issues in this project.</div>}</div>
          </div>
          <div className="form-group"><label className="form-label">Labels (comma separated)</label><input className="form-input" value={form.labels} onChange={e=>set('labels',e.target.value)} placeholder="e.g. frontend, auth, critical" /></div>
          <div className="form-group"><label className="form-label">Reference Link</label><input className="form-input" value={form.referenceLink} onChange={e=>set('referenceLink',e.target.value)} placeholder="https://example.com/ticket-or-doc" /></div>
          <div className="form-group">
            <label className="form-label">Attachments</label>
            <input className="form-input" type="file" accept="image/*,video/*" multiple onChange={e=>{ if (e.target.files?.length) addAttachments(e.target.files); e.target.value=''; }} />
            <div style={{fontSize:11,color:'var(--muted)',marginTop:6}}>You can attach multiple images or videos.</div>
            {form.attachments.length>0&&<div style={{display:'grid',gap:8,marginTop:12}}>
              {form.attachments.map((file,index)=>(
                <div key={`${file.name}-${index}`} style={{display:'flex',alignItems:'center',gap:10,padding:10,border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--surface2)'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{file.name}</div>
                    <div style={{fontSize:11,color:'var(--muted)'}}>{file.type} · {(file.size/1024/1024).toFixed(2)} MB</div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={()=>removeAttachment(index)}>Remove</button>
                </div>
              ))}
            </div>}
          </div>
          <div className="form-group">
            {!showCurl && <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setShowCurl(true)}>+ Add cURL</button>}
            {showCurl && <>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <label className="form-label" style={{marginBottom:0}}>cURL Command</label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setShowCurl(false);set('curlCommand','');}}>Hide</button>
              </div>
              <textarea className="form-textarea" value={form.curlCommand} onChange={e=>set('curlCommand',e.target.value)} placeholder="curl -X POST https://api.example.com/..." style={{minHeight:120,fontFamily:'monospace'}} />
            </>}
          </div>
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
  const [projectPermissions, setProjectPermissions] = useState(new Set());
  const [showCurl, setShowCurl] = useState(false);
  useEffect(()=>{ api.get(`/api/bugs/${bugId}`).then(setBug); },[bugId]);
  useEffect(()=>{
    if (!bug?.projectId) return;
    api.get(`/api/rbac/me/permissions?projectId=${bug.projectId}`)
      .then(res => setProjectPermissions(new Set(res.permissions || [])))
      .catch(() => setProjectPermissions(new Set()));
  },[bug?.projectId]);
  const updateField = async (field,value) => {
    const u=await api.put(`/api/bugs/${bugId}`,{[field]:value});
    if (u?.error) { toast(u.error,'error'); return; }
    setBug(u); onUpdate(u); toast('Updated','success');
  };
  const addComment = async () => {
    if (!comment.trim()) return;
    await api.post(`/api/bugs/${bugId}/comments`,{text:comment});
    setComment(''); const fresh=await api.get(`/api/bugs/${bugId}`); setBug(fresh); toast('Comment added','success');
  };
  const deleteComment = async cid => { await api.delete(`/api/bugs/${bugId}/comments/${cid}`); const fresh=await api.get(`/api/bugs/${bugId}`); setBug(fresh); };
  const project=bug?projects.find(p=>p.id===bug.projectId):null;
  const assignee=bug?resolveIssueUser(bug,users,'assigneeId',['Assignee(s)','Assignee From Sheet']):null;
  const reporter=bug?resolveIssueUser(bug,users,'reporterId','Raised By'):null;
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
            {bug.referenceLink&&<div className="detail-section"><h4>Reference Link</h4><a href={bug.referenceLink} target="_blank" rel="noreferrer" style={{color:'var(--primary)',wordBreak:'break-all'}}>{bug.referenceLink}</a></div>}
            {bug.attachments?.length>0&&<div className="detail-section"><h4>Attachments</h4><div style={{display:'grid',gap:12}}>
              {bug.attachments.map((file,index)=>(
                <div key={`${file.name}-${index}`} style={{padding:12,border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--surface2)'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:10}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{file.name}</div>
                      <div style={{fontSize:11,color:'var(--muted)'}}>{file.type} · {(Number(file.size||0)/1024/1024).toFixed(2)} MB</div>
                    </div>
                    <a className="btn btn-ghost btn-sm" href={file.dataUrl} download={file.name}>Download</a>
                  </div>
                  {file.type?.startsWith('image/')&&<img src={file.dataUrl} alt={file.name} style={{maxWidth:'100%',borderRadius:12,border:'1px solid var(--border)'}} />}
                  {file.type?.startsWith('video/')&&<video src={file.dataUrl} controls style={{width:'100%',borderRadius:12,border:'1px solid var(--border)'}} />}
                </div>
              ))}
            </div></div>}
            {(bug.curlCommand || showCurl)&&<div className="detail-section"><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}><h4 style={{margin:0}}>cURL</h4><button className="btn btn-ghost btn-sm" onClick={()=>setShowCurl(v=>!v)}>{showCurl?'Hide':'Show'}</button></div>{showCurl&&<pre style={{margin:0,padding:14,background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflowX:'auto',whiteSpace:'pre-wrap',fontFamily:'monospace',fontSize:12}}>{bug.curlCommand || 'No cURL command added.'}</pre>}</div>}
            {!bug.curlCommand&&<div className="detail-section"><button className="btn btn-ghost btn-sm" onClick={()=>setShowCurl(true)}>+ Show cURL field</button></div>}
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
              <div className="detail-field"><div className="detail-field-label">Assignee</div><select className="form-select" value={bug.assigneeId||''} onChange={e=>updateField('assigneeId',e.target.value)} disabled={!projectPermissions.has('ASSIGN_ISSUE')}><option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>{!projectPermissions.has('ASSIGN_ISSUE')&&<div style={{fontSize:11,color:'var(--muted)',marginTop:6}}>You do not have permission to reassign this issue.</div>}</div>
              <hr className="divider"/>
              <div className="detail-field"><div className="detail-field-label">Project</div><div className="detail-field-value" style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:10,height:10,borderRadius:'50%',background:project?.color}}/>{project?.name}</div></div>
              <div className="detail-field"><div className="detail-field-label">Reporter</div><div className="detail-field-value" style={{display:'flex',alignItems:'center',gap:6}}>{reporter?<><Avatar user={reporter} size="xs"/>{reporter.name}</>:'Unknown'}</div></div>
              <hr className="divider"/>
              <div className="detail-field"><div className="detail-field-label">Created</div><div className="detail-field-value text-sm text-muted">{formatIssueCreatedDate(bug)}</div></div>
              <div className="detail-field"><div className="detail-field-label">Updated</div><div className="detail-field-value text-sm text-muted">{timeAgo(bug.updatedAt)}</div></div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
function DashboardLegacy({ projects, users, currentProject, onNavigate, currentUser, toast }) {
  const [stats,setStats]=useState(null);
  const [recentBugs,setRecentBugs]=useState([]);
  const [selectedBug,setSelectedBug]=useState(null);
  const lineRef=useRef(null),doughnutRef=useRef(null),barRef=useRef(null);
  const lineChart=useRef(null),doughnutChart=useRef(null),barChart=useRef(null);
  const { showExportFilters, exportFilters, setExportFilter, openExportModal, closeExportModal, resetExportFilters, exportReport } = useProjectReportExport({ currentProject, projects, users, toast });
  useEffect(()=>{ const url=currentProject?`/api/stats?projectId=${currentProject.id}`:'/api/stats'; api.get(url).then(setStats); const bu=currentProject?`/api/bugs?projectId=${currentProject.id}`:'/api/bugs'; api.get(bu).then(b=>setRecentBugs(b.slice(0,5))); },[currentProject]);
  useEffect(()=>{
    if (!stats || stats.error || !Array.isArray(stats.daily) || !stats.byStatus || !stats.byPriority) return;
    if (lineChart.current) lineChart.current.destroy();
    lineChart.current=new Chart(lineRef.current,{type:'line',data:{labels:stats.daily.map(d=>d.label),datasets:[{label:'Issues',data:stats.daily.map(d=>d.count),borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,.15)',tension:0.4,fill:true,pointBackgroundColor:'#6366f1',pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'#334155'},ticks:{color:'#94a3b8'}},y:{grid:{color:'#334155'},ticks:{color:'#94a3b8',stepSize:1}}}}});
    if (doughnutChart.current) doughnutChart.current.destroy();
    doughnutChart.current=new Chart(doughnutRef.current,{type:'doughnut',data:{labels:Object.keys(stats.byStatus),datasets:[{data:Object.values(stats.byStatus),backgroundColor:['#475569','#6366f1','#fbbf24','#10b981'],borderWidth:0,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:'#94a3b8',boxWidth:12,font:{size:11}}}}}});
    if (barChart.current) barChart.current.destroy();
    barChart.current=new Chart(barRef.current,{type:'bar',data:{labels:Object.keys(stats.byPriority),datasets:[{label:'Issues',data:Object.values(stats.byPriority),backgroundColor:['#ef4444','#fb923c','#fbbf24','#94a3b8'],borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#94a3b8'}},y:{grid:{color:'#334155'},ticks:{color:'#94a3b8',stepSize:1}}}}});
    return()=>{if(lineChart.current)lineChart.current.destroy();if(doughnutChart.current)doughnutChart.current.destroy();if(barChart.current)barChart.current.destroy();};
  },[stats]);
  if (!stats) return <div style={{color:'var(--muted)',padding:40,textAlign:'center'}}>Loading dashboard…</div>;
  if (stats.error) return (
    <div className="empty-state">
      <div className="icon">🔒</div>
      <h3>Dashboard Unavailable</h3>
      <p>{stats.error}</p>
    </div>
  );
  return (
    <div>
      <div className="page-header"><div><h1>Dashboard</h1><p>{currentProject?currentProject.name:'All Projects'} · Overview</p></div><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="btn btn-ghost" onClick={openExportModal}>Export Report</button><button className="btn btn-primary" onClick={()=>onNavigate('list')}>View All Issues →</button></div></div>
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
      <div className="table-card" style={{padding:20}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:12,marginBottom:16}}>
          <h3 style={{fontSize:13,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em',margin:0}}>Recent Issues</h3>
          <SyncTimestamp toast={toast} />
        </div>
        {recentBugs.length===0?<div className="text-muted text-sm">No issues found.</div>:(
          <div className="table-scroll"><table className="bug-table"><thead><tr><th>Date Created</th><th>Issue Title</th>{!currentProject&&<th>Project Name</th>}<th>Raised By</th><th>Issue Type</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Last Updated</th></tr></thead>
          <tbody>{recentBugs.map(bug=>{const assignee=resolveIssueUser(bug,users,'assigneeId',['Assignee(s)','Assignee From Sheet']);const reporter=resolveIssueUser(bug,users,'reporterId','Raised By');const project=projects.find(p=>p.id===bug.projectId);return(<tr key={`compact-${bug.id}`} onClick={()=>setSelectedBug(bug.id)}><td><span className="text-muted text-sm">{formatIssueCreatedDate(bug)}</span></td><td><span className="issue-title">{bug.title}</span></td>{!currentProject&&<td><span className="text-muted text-sm">{project?.name||'—'}</span></td>}<td>{reporter?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={reporter} size="xs"/><span style={{fontSize:12}}>{reporter.name}</span></div>:<span className="text-muted">—</span>}</td><td><TypeBadge t={bug.type}/></td><td>{assignee?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={assignee} size="xs"/><span style={{fontSize:12}}>{assignee.name}</span></div>:<span className="text-muted">—</span>}</td><td><PriorityBadge p={bug.priority}/></td><td><StatusBadge s={bug.status}/></td><td><span className="text-muted text-sm">{formatDate(bug.updatedAt)}</span></td></tr>);})}</tbody></table></div>
        )}
      </div>
      {selectedBug&&<BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={()=>setSelectedBug(null)} toast={toast} onUpdate={async()=>{ const url=currentProject?`/api/stats?projectId=${currentProject.id}`:'/api/stats'; const bu=currentProject?`/api/bugs?projectId=${currentProject.id}`:'/api/bugs'; const [nextStats, nextBugs] = await Promise.all([api.get(url), api.get(bu)]); setStats(nextStats); setRecentBugs(nextBugs.slice(0,5)); }} onDelete={async(id)=>{ setRecentBugs(bs=>bs.filter(b=>b.id!==id)); const url=currentProject?`/api/stats?projectId=${currentProject.id}`:'/api/stats'; const nextStats = await api.get(url); setStats(nextStats); setSelectedBug(null); }}/>}
      {showExportFilters&&(
        <Modal onClose={()=>setShowExportFilters(false)}>
          <div className="modal-header"><h2 className="modal-title">Export Report Filters</h2><button className="btn-icon" onClick={()=>setShowExportFilters(false)}>✕</button></div>
          <div className="modal-body">
            {!currentProject&&(
              <div className="form-group">
                <label className="form-label">Project</label>
                <select className="form-select" value={exportFilters.projectId} onChange={e=>setExportFilter('projectId',e.target.value)}>
                  <option value="">Select Project</option>
                  {projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </div>
            )}
            <div className="form-row">
              <div className="form-group"><label className="form-label">Starting Date</label><input className="form-input" type="date" value={exportFilters.startDate} onChange={e=>setExportFilter('startDate',e.target.value)} /></div>
              <div className="form-group"><label className="form-label">Ending Date</label><input className="form-input" type="date" value={exportFilters.endDate} onChange={e=>setExportFilter('endDate',e.target.value)} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Assignee</label><select className="form-select" value={exportFilters.assigneeId} onChange={e=>setExportFilter('assigneeId',e.target.value)}><option value="">All Assignees</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Priority</label><select className="form-select" value={exportFilters.priority} onChange={e=>setExportFilter('priority',e.target.value)}><option value="">All Priorities</option>{['Critical','High','Medium','Low'].map(p=><option key={p} value={p}>{p}</option>)}</select></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Status</label><select className="form-select" value={exportFilters.status} onChange={e=>setExportFilter('status',e.target.value)}><option value="">All Statuses</option>{['To Do','In Progress','In Review','Done'].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Issue Type</label><select className="form-select" value={exportFilters.type} onChange={e=>setExportFilter('type',e.target.value)}><option value="">All Types</option>{['Bug','Feature','Task','Improvement'].map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            </div>
          </div>
          <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={()=>setExportFilters(REPORT_FILTER_DEFAULTS)}>Reset</button><button type="button" className="btn btn-primary" onClick={exportReport}>Export</button></div>
        </Modal>
      )}
    </div>
  );
}

// ── BugList ───────────────────────────────────────────────────────────────────
function BugListLegacy({ projects, users, currentProject, toast, currentUser }) {
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
        <div className="table-card">
          <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'16px 16px 0'}}>
            <div style={{fontSize:13,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>Recent Issues</div>
            <SyncTimestamp toast={toast} />
          </div>
          <div className="table-scroll"><table className="bug-table"><thead><tr><th>Date Created</th><th>Issue Title</th>{!currentProject&&<th>Project Name</th>}<th>Raised By</th><th>Issue Type</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Last Updated</th></tr></thead>
          <tbody>{bugs.map(bug=>{const assignee=resolveIssueUser(bug,users,'assigneeId',['Assignee(s)','Assignee From Sheet']);const reporter=resolveIssueUser(bug,users,'reporterId','Raised By');const project=projects.find(p=>p.id===bug.projectId);return(<tr key={`compact-${bug.id}`} onClick={()=>setSelectedBug(bug.id)}><td><span className="text-muted text-sm">{formatIssueCreatedDate(bug)}</span></td><td><span className="issue-title">{bug.title}</span></td>{!currentProject&&<td><span className="text-muted text-sm">{project?.name||'—'}</span></td>}<td>{reporter?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={reporter} size="xs"/><span style={{fontSize:12}}>{reporter.name}</span></div>:<span className="text-muted text-sm">Unknown</span>}</td><td><TypeBadge t={bug.type}/></td><td>{assignee?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={assignee} size="xs"/><span style={{fontSize:12}}>{assignee.name}</span></div>:<span className="text-muted text-sm">Unassigned</span>}</td><td><PriorityBadge p={bug.priority}/></td><td><StatusBadge s={bug.status}/></td><td><span className="text-muted text-sm">{formatDate(bug.updatedAt)}</span></td></tr>);})}</tbody></table></div>
          <div className="table-scroll" style={{display:'none'}}><table className="bug-table"><thead><tr><th>Key</th><th>Title</th><th>Type</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Raised By</th><th>Project</th><th>Created</th></tr></thead>
          <tbody>{bugs.map(bug=>{const assignee=resolveIssueUser(bug,users,'assigneeId',['Assignee(s)','Assignee From Sheet']);const reporter=resolveIssueUser(bug,users,'reporterId','Raised By');const project=projects.find(p=>p.id===bug.projectId);const createdAt=getIssueCreatedDate(bug);return(<tr key={bug.id} onClick={()=>setSelectedBug(bug.id)}><td><span className="issue-key">{bug.key||bug.id.slice(0,8)}</span></td><td><span className="issue-title">{bug.title}</span></td><td><TypeBadge t={bug.type}/></td><td><StatusBadge s={bug.status}/></td><td><PriorityBadge p={bug.priority}/></td><td>{assignee?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={assignee} size="xs"/><span style={{fontSize:12}}>{assignee.name}</span></div>:<span className="text-muted text-sm">Unassigned</span>}</td><td>{reporter?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={reporter} size="xs"/><span style={{fontSize:12}}>{reporter.name}</span></div>:<span className="text-muted text-sm">Unknown</span>}</td><td>{project&&<div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:8,height:8,borderRadius:'50%',background:project.color}}/><span style={{fontSize:12,color:'var(--muted)'}}>{project.name}</span></div>}</td><td><span className="text-muted text-sm">{createdAt?timeAgo(createdAt):'Unavailable'}</span></td></tr>);})}</tbody></table>
          </div>
        </div>
      )}
      {showCreate&&<BugModal projects={projects} users={users} currentProject={currentProject} onClose={()=>setShowCreate(false)} toast={toast} onSave={()=>{load();setShowCreate(false);}}/>}
      {selectedBug&&<BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={()=>setSelectedBug(null)} toast={toast} onUpdate={()=>load()} onDelete={id=>{setBugs(bs=>bs.filter(b=>b.id!==id));}}/>}
    </div>
  );
}

function Dashboard({ projects, users, currentProject, onNavigate, currentUser, toast }) {
  const [stats, setStats] = useState(null);
  const [recentBugs, setRecentBugs] = useState([]);
  const [selectedBug, setSelectedBug] = useState(null);
  const lineRef = useRef(null), doughnutRef = useRef(null), barRef = useRef(null);
  const lineChart = useRef(null), doughnutChart = useRef(null), barChart = useRef(null);
  const {
    showExportFilters,
    exportFilters,
    setExportFilter,
    openExportModal,
    closeExportModal,
    resetExportFilters,
    exportReport,
  } = useProjectReportExport({ currentProject, projects, users, toast });

  useEffect(() => {
    const statsUrl = currentProject ? `/api/stats?projectId=${currentProject.id}` : '/api/stats';
    const bugsUrl = currentProject ? `/api/bugs?projectId=${currentProject.id}` : '/api/bugs';
    api.get(statsUrl).then(setStats);
    api.get(bugsUrl).then(b => setRecentBugs(b.slice(0, 5)));
  }, [currentProject]);

  useEffect(() => {
    if (!stats || stats.error || !Array.isArray(stats.daily) || !stats.byStatus || !stats.byPriority) return;
    if (lineChart.current) lineChart.current.destroy();
    lineChart.current = new Chart(lineRef.current, { type:'line', data:{ labels:stats.daily.map(d => d.label), datasets:[{ label:'Issues', data:stats.daily.map(d => d.count), borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.15)', tension:0.4, fill:true, pointBackgroundColor:'#6366f1', pointRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8' } }, y:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8', stepSize:1 } } } } });
    if (doughnutChart.current) doughnutChart.current.destroy();
    doughnutChart.current = new Chart(doughnutRef.current, { type:'doughnut', data:{ labels:Object.keys(stats.byStatus), datasets:[{ data:Object.values(stats.byStatus), backgroundColor:['#475569','#6366f1','#fbbf24','#10b981'], borderWidth:0, hoverOffset:6 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ color:'#94a3b8', boxWidth:12, font:{ size:11 } } } } } });
    if (barChart.current) barChart.current.destroy();
    barChart.current = new Chart(barRef.current, { type:'bar', data:{ labels:Object.keys(stats.byPriority), datasets:[{ label:'Issues', data:Object.values(stats.byPriority), backgroundColor:['#ef4444','#fb923c','#fbbf24','#94a3b8'], borderRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false }, ticks:{ color:'#94a3b8' } }, y:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8', stepSize:1 } } } } });
    return () => {
      if (lineChart.current) lineChart.current.destroy();
      if (doughnutChart.current) doughnutChart.current.destroy();
      if (barChart.current) barChart.current.destroy();
    };
  }, [stats]);

  if (!stats) return <div style={{color:'var(--muted)',padding:40,textAlign:'center'}}>Loading dashboard…</div>;
  if (stats.error) {
    return (
      <div className="empty-state">
        <div className="icon">🔒</div>
        <h3>Dashboard Unavailable</h3>
        <p>{stats.error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div><h1>Dashboard</h1><p>{currentProject ? currentProject.name : 'All Projects'} · Overview</p></div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button className="btn btn-ghost" onClick={openExportModal}>Export Report</button>
          <button className="btn btn-primary" onClick={() => onNavigate('list')}>View All Issues →</button>
        </div>
      </div>
      <div className="stats-grid">
        {[{label:'Total Issues',value:stats.total,sub:'across all statuses',color:'#6366f1'},{label:'Open Issues',value:stats.openCount,sub:'need attention',color:'#f59e0b'},{label:'Completed',value:stats.doneCount,sub:'marked as done',color:'#10b981'},{label:'Critical',value:stats.byPriority.Critical,sub:'critical priority',color:'#ef4444'}].map(card => (
          <div key={card.label} className="stat-card"><div className="label">{card.label}</div><div className="value" style={{color:card.color}}>{card.value}</div><div className="sub">{card.sub}</div></div>
        ))}
      </div>
      <div className="charts-grid">
        <div className="chart-card"><h3>Issues Created (Last 7 Days)</h3><div className="chart-wrap"><canvas ref={lineRef} /></div></div>
        <div className="chart-card"><h3>By Status</h3><div className="chart-wrap"><canvas ref={doughnutRef} /></div></div>
        <div className="chart-card"><h3>By Priority</h3><div className="chart-wrap"><canvas ref={barRef} /></div></div>
      </div>
      <div className="table-card" style={{padding:20}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:12,marginBottom:16}}>
          <h3 style={{fontSize:13,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em',margin:0}}>Recent Issues</h3>
          <SyncTimestamp toast={toast} />
        </div>
        <IssueTable bugs={recentBugs} users={users} projects={projects} currentProject={currentProject} onSelectBug={setSelectedBug} />
      </div>
      {selectedBug && <BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={() => setSelectedBug(null)} toast={toast} onUpdate={async () => { const statsUrl = currentProject ? `/api/stats?projectId=${currentProject.id}` : '/api/stats'; const bugsUrl = currentProject ? `/api/bugs?projectId=${currentProject.id}` : '/api/bugs'; const [nextStats, nextBugs] = await Promise.all([api.get(statsUrl), api.get(bugsUrl)]); setStats(nextStats); setRecentBugs(nextBugs.slice(0, 5)); }} onDelete={async () => { const statsUrl = currentProject ? `/api/stats?projectId=${currentProject.id}` : '/api/stats'; const nextStats = await api.get(statsUrl); setStats(nextStats); setSelectedBug(null); }} />}
      <ExportReportFiltersModal visible={showExportFilters} onClose={closeExportModal} currentProject={currentProject} projects={projects} users={users} exportFilters={exportFilters} setExportFilter={setExportFilter} onReset={resetExportFilters} onExport={exportReport} />
    </div>
  );
}

function BugList({ projects, users, currentProject, toast, currentUser }) {
  const [bugs, setBugs] = useState([]);
  const [filters, setFilters] = useState({ status:'', priority:'', type:'', assigneeId:'', search:'' });
  const [showCreate, setShowCreate] = useState(false);
  const [selectedBug, setSelectedBug] = useState(null);
  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (currentProject) params.set('projectId', currentProject.id);
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    api.get(`/api/bugs?${params}`).then(setBugs);
  }, [currentProject, filters]);

  useEffect(() => { load(); }, [load]);
  const setFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }));

  return (
    <div>
      <div className="page-header"><div><h1>Issues</h1><p>{currentProject ? currentProject.name : 'All Projects'} · {bugs.length} issue{bugs.length!==1?'s':''}</p></div><button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Issue</button></div>
      <div className="filters-bar">
        <div style={{position:'relative'}}><span className="search-icon">🔍</span><input style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'7px 12px 7px 32px',color:'var(--text)',outline:'none',width:220}} placeholder="Search issues…" value={filters.search} onChange={e => setFilter('search', e.target.value)} /></div>
        <select className="filter-select" value={filters.status} onChange={e => setFilter('status', e.target.value)}><option value="">All Statuses</option>{['To Do','In Progress','In Review','Done'].map(s => <option key={s}>{s}</option>)}</select>
        <select className="filter-select" value={filters.priority} onChange={e => setFilter('priority', e.target.value)}><option value="">All Priorities</option>{['Critical','High','Medium','Low'].map(p => <option key={p}>{p}</option>)}</select>
        <select className="filter-select" value={filters.type} onChange={e => setFilter('type', e.target.value)}><option value="">All Types</option>{['Bug','Feature','Task','Improvement'].map(t => <option key={t}>{t}</option>)}</select>
        <select className="filter-select" value={filters.assigneeId} onChange={e => setFilter('assigneeId', e.target.value)}><option value="">All Assignees</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        {Object.values(filters).some(Boolean) && <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ status:'', priority:'', type:'', assigneeId:'', search:'' })}>Clear ✕</button>}
      </div>
      {bugs.length===0 ? <div className="empty-state"><div className="icon">🎉</div><h3>No issues found</h3><p>Try adjusting your filters or create a new issue.</p></div> : (
        <div className="table-card">
          <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'16px 16px 0'}}>
            <div style={{fontSize:13,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>Recent Issues</div>
            <SyncTimestamp toast={toast} />
          </div>
          <IssueTable bugs={bugs} users={users} projects={projects} currentProject={currentProject} onSelectBug={setSelectedBug} />
        </div>
      )}
      {showCreate && <BugModal projects={projects} users={users} currentProject={currentProject} onClose={() => setShowCreate(false)} toast={toast} onSave={() => { load(); setShowCreate(false); }} />}
      {selectedBug && <BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={() => setSelectedBug(null)} toast={toast} onUpdate={() => load()} onDelete={() => load()} />}
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
              {byStatus(col).map(bug=>{const assignee=resolveIssueUser(bug,users,'assigneeId',['Assignee(s)','Assignee From Sheet']);const reporter=resolveIssueUser(bug,users,'reporterId','Raised By');const project=projects.find(p=>p.id===bug.projectId);return(<div key={bug.id} className={`kanban-card ${dragging?.id===bug.id?'dragging':''}`} draggable onClick={()=>setSelectedBug(bug.id)} onDragStart={e=>onDragStart(e,bug)}><div className="kanban-card-title">{bug.title}</div><div style={{display:'flex',gap:4,marginBottom:8,flexWrap:'wrap'}}><TypeBadge t={bug.type}/><PriorityBadge p={bug.priority}/></div><div className="kanban-card-footer"><div style={{display:'flex',alignItems:'center',gap:5,minWidth:0}}>{project&&<><div style={{width:8,height:8,borderRadius:'50%',background:project.color,flexShrink:0}}/><span className="kanban-card-key" style={{maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{project.name}</span></>}</div><div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>{bug.comments?.length>0&&<span style={{fontSize:11,color:'var(--muted)'}}>💬 {bug.comments.length}</span>}{assignee?<><Avatar user={assignee} size="xs"/><span style={{fontSize:11,color:'var(--muted)',maxWidth:110,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{assignee.name}</span></>:<div className="avatar avatar-xs" style={{background:'#334155'}}>?</div>}</div></div><div style={{marginTop:8,fontSize:11,color:'var(--muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Raised by {reporter?.name||'Unknown'}</div></div>);})}
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
function ProjectModal({ onClose, onCreate }) {
  const [form,setForm]=useState({name:'',key:'',description:'',color:'#6366f1'});
  const create=async e=>{e.preventDefault();if(!form.name||!form.key)return;await onCreate(form);setForm({name:'',key:'',description:'',color:'#6366f1'});};
  return (
    <Modal onClose={onClose}>
      <div className="modal-header"><h2 className="modal-title">New Project</h2><button className="btn-icon" onClick={onClose}>X</button></div>
      <form onSubmit={create}>
        <div className="modal-body"><div className="form-group"><label className="form-label">Project Name *</label><input className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value,key:e.target.value.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,4)}))} required autoFocus/></div><div className="form-group"><label className="form-label">Project Key *</label><input className="form-input" value={form.key} onChange={e=>setForm(f=>({...f,key:e.target.value.toUpperCase()}))} required maxLength={6}/></div><div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div><div className="form-group"><label className="form-label">Colour</label><div className="color-swatches">{COLORS.map(c=><div key={c} className={`swatch ${form.color===c?'selected':''}`} style={{background:c}} onClick={()=>setForm(f=>({...f,color:c}))}/>)}</div></div></div>
        <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary">Create Project</button></div>
      </form>
    </Modal>
  );
}

function ProjectsPage({ projects, setProjects, toast, onProjectCreated }) {
  const [showCreate,setShowCreate]=useState(false);
  const [form,setForm]=useState({name:'',key:'',description:'',color:'#6366f1'});
  const colors=['#6366f1','#10b981','#f59e0b','#ef4444','#38bdf8','#ec4899','#8b5cf6','#14b8a6'];
  const create=async e=>{e.preventDefault();if(!form.name||!form.key)return;const p=await api.post('/api/projects',form);setProjects(ps=>[...ps,p]);setForm({name:'',key:'',description:'',color:'#6366f1'});setShowCreate(false);onProjectCreated?.(p);toast('Project created','success');};
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
function TeamPage({ users, setUsers, bugs, toast, currentUser, onCurrentUserUpdated }) {
  const isAdmin = currentUser?.role === 'admin';
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name:'', email:'', role:'developer', color:'#6366f1' }); // avatarDataUrl will be added to payload directly
  const [avatarFile, setAvatarFile] = useState(null);
  const [newCredentials, setNewCredentials] = useState(null); // { name, email, tempPassword }
  const [resetTarget, setResetTarget] = useState(null); // member to reset password for
  const [resetResult, setResetResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const loadMembers = () => api.get('/api/members').then(setUsers);

  const add = async e => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    const avatarDataUrl = avatarFile ? await readImageAsDataUrl(avatarFile) : null;
    const res = await api.post('/api/members', { ...form, avatarDataUrl });
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

  const updatePhoto = async (member, file) => {
    if (!file) return;
    const avatarDataUrl = await readImageAsDataUrl(file);
    const isSelf = member.id === currentUser?.id;
    const res = isSelf
      ? await api.put('/api/auth/me/photo', { avatarDataUrl })
      : await api.put(`/api/members/${member.id}`, { avatarDataUrl });
    if (res.error) { toast(res.error, 'error'); return; }
    setUsers(us => us.map(u => u.id === member.id ? res : u));
    if (isSelf && onCurrentUserUpdated) onCurrentUserUpdated(res);
    toast('Photo updated', 'success');
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

  const roleOrder = { admin:0, project_manager:1, developer:2, frontend_developer:3, backend_developer:4, tester:5, qa:5, viewer:6 };
  const sorted = [...users].sort((a,b) => (roleOrder[a.role]||9) - (roleOrder[b.role]||9));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Team Members</h1>
          <p>{users.length} member{users.length!==1?'s':''} · {users.filter(u=>u.role==='admin').length} admin · {users.filter(u=>u.role==='project_manager').length} project manager · {users.filter(u=>u.role==='developer').length} developer · {users.filter(u=>u.role==='frontend_developer').length} frontend · {users.filter(u=>u.role==='backend_developer').length} backend · {users.filter(u=>u.role==='tester' || u.role==='qa').length} QA · {users.filter(u=>u.role==='viewer').length} viewer</p>
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
                <Avatar user={u} />
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
                    <option value="project_manager">Project Manager</option>
                    <option value="developer">Developer</option>
                    <option value="frontend_developer">Frontend Developer</option>
                    <option value="backend_developer">Backend Developer</option>
                    <option value="tester">QA</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button className="btn btn-ghost btn-sm" style={{fontSize:11}} onClick={()=>setResetTarget(u)}>🔑 Reset PW</button>
                  <button className="btn btn-danger btn-sm" style={{fontSize:11}} onClick={()=>removeMember(u.id)}>Remove</button>
                </div>
              )}
              {(isAdmin || isSelf) && (
                <div style={{marginTop:10}}>
                  <label className="btn btn-ghost btn-sm" style={{fontSize:11,cursor:'pointer'}}>
                    Upload Photo
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e => { updatePhoto(u, e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
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
                  <option value="project_manager">Project Manager</option>
                  <option value="developer">Developer</option>
                  <option value="frontend_developer">Frontend Developer</option>
                  <option value="backend_developer">Backend Developer</option>
                  <option value="tester">QA</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Accent Colour</label>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {COLORS.map(c=><div key={c} onClick={()=>setF('color',c)} style={{width:24,height:24,borderRadius:'50%',background:c,cursor:'pointer',border:form.color===c?'3px solid #fff':'3px solid transparent',transform:form.color===c?'scale(1.2)':'none',transition:'all .15s'}}/>)}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Profile Photo (optional)</label>
                <input className="form-input" type="file" accept="image/*" onChange={e => setAvatarFile(e.target.files?.[0])} />
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
function SettingsPage({ org, setOrg, currentUser, toast, users }) {
  const [form, setForm] = useState({
    name: org?.name||'',
    color: org?.color||'#6366f1',
    dataSourceType: org?.dataSourceType || '',
    dataSourceUrl: org?.dataSourceUrl || '',
    dataSourceSyncEnabled: Boolean(org?.dataSourceSyncEnabled),
  });
  const [logoFile, setLogoFile] = useState(null);
  const [spreadsheetFile, setSpreadsheetFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [planSaving, setPlanSaving] = useState('');
  const [syncingSource, setSyncingSource] = useState(false);
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  useEffect(() => {
    setForm({
      name: org?.name||'',
      color: org?.color||'#6366f1',
      dataSourceType: org?.dataSourceType || '',
      dataSourceUrl: org?.dataSourceUrl || '',
      dataSourceSyncEnabled: Boolean(org?.dataSourceSyncEnabled),
    });
  }, [org?.name, org?.color, org?.dataSourceType, org?.dataSourceUrl, org?.dataSourceSyncEnabled]);

  const save = async e => {
    e.preventDefault();
    setSaving(true);
    const logoDataUrl = logoFile ? await readImageAsDataUrl(logoFile) : null;
    const fileDataUrl = spreadsheetFile ? await readFileAsDataUrl(spreadsheetFile) : null;
    const normalizedType = form.dataSourceType || '';
    const res = await api.put('/api/org', {
      ...form,
      logoDataUrl,
      dataSourceType: normalizedType,
      dataSourceUrl: normalizedType === 'google_sheet' ? form.dataSourceUrl : '',
      dataSourceFileName: normalizedType === 'xlsx' || normalizedType === 'csv' ? (spreadsheetFile?.name || org?.dataSourceFileName || '') : '',
      dataSourceFileData: normalizedType === 'xlsx' || normalizedType === 'csv' ? fileDataUrl : null,
      dataSourceSyncEnabled: normalizedType ? form.dataSourceSyncEnabled : false,
    });
    if (res.error) { toast(res.error,'error'); } else { setOrg(res); toast('Settings saved','success'); }
    setLogoFile(null);
    setSpreadsheetFile(null);
    setSaving(false);
  };

  if (currentUser?.role !== 'admin') return (
    <div className="empty-state"><div className="icon">🔒</div><h3>Admin Only</h3><p>Only admins can access company settings.</p></div>
  );

  const changePlan = async planCode => {
    setPlanSaving(planCode);
    const plan = PLAN_OPTIONS.find(p => p.code === planCode);
    if (!plan) {
      toast('Unsupported plan', 'error');
      setPlanSaving('');
      return;
    }
    if (plan.code === 'basic') {
      const res = await api.put('/api/org/plan', { planCode });
      if (res.error) toast(res.error, 'error');
      else { setOrg(res); toast(`${res.planName} plan activated`, 'success'); }
      setPlanSaving('');
      return;
    }
    try {
      await ensureRazorpayLoaded();
      const order = await api.post('/api/billing/create-order', { planCode });
      if (order.error) { toast(order.error, 'error'); setPlanSaving(''); return; }
      const paymentObject = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'FixPulse',
        description: `${plan.name} Plan Upgrade`,
        order_id: order.orderId,
        theme: { color: '#17a34a' },
        handler: async response => {
          const verified = await api.post('/api/billing/verify-payment', {
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });
          if (verified.error) {
            toast(verified.error, 'error');
            setPlanSaving('');
            return;
          }
          setOrg(verified);
          toast(`${verified.planName} plan activated`, 'success');
          setPlanSaving('');
        },
        modal: {
          ondismiss: () => setPlanSaving(''),
        },
      });
      paymentObject.open();
    } catch (error) {
      toast(error.message || 'Unable to start payment', 'error');
      setPlanSaving('');
    }
  };

  const currentUsers = users?.length || org?.currentUserCount || 0;
  const sourceSummary = {
    google_sheet: org?.dataSourceUrl || 'Google Sheet link saved',
    xlsx: org?.dataSourceFileName || 'Excel file uploaded',
    csv: org?.dataSourceFileName || 'CSV file uploaded',
  };

  const runSourceSync = async () => {
    if (syncingSource || !org?.dataSourceType || !org?.dataSourceSyncEnabled) return;
    setSyncingSource(true);
    const res = await api.post('/api/sheet-sync/run', { orgId: org?.id });
    if (res?.error) toast(res.error, 'error');
    else toast(res.started ? 'Data sync started for this organization' : 'A data sync is already running', 'info');
    setSyncingSource(false);
  };

  return (
    <div>
      <div className="page-header"><div><h1>Company Settings</h1><p>Manage your organisation</p></div></div>
      <div style={{maxWidth:960}}>
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:24,marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',marginBottom:18,flexWrap:'wrap'}}>
            <div>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:4}}>Plan & Billing</h3>
              <p style={{fontSize:13,color:'var(--muted)'}}>Current plan: <strong>{org?.planName || 'Enterprise'}</strong> · {org?.userLimit===null?'Unlimited users':`${currentUsers}/${org?.userLimit} users used`}</p>
            </div>
            <button className="btn btn-ghost" onClick={()=>window.open('/pricing.html','_blank')}>View Pricing Page</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:16}}>
            {PLAN_OPTIONS.map(plan => {
              const active = org?.planCode === plan.code;
              const overLimit = plan.userLimit !== null && currentUsers > plan.userLimit;
              return (
                <div key={plan.code} style={{background:plan.featured?'linear-gradient(180deg, color-mix(in srgb, var(--surface) 86%, white 14%), var(--surface))':'var(--surface2)',border:`1px solid ${active?'var(--primary)':'var(--border)'}`,borderRadius:20,padding:20,boxShadow:plan.featured?'0 16px 40px rgba(23,163,74,.12)':'none'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <strong style={{fontSize:18}}>{plan.name}</strong>
                    {active
                      ? <span style={{fontSize:11,fontWeight:700,color:'var(--primary)'}}>ACTIVE</span>
                      : plan.featured
                        ? <span style={{fontSize:11,fontWeight:700,color:'#16a34a'}}>POPULAR</span>
                        : null}
                  </div>
                  <div style={{fontSize:28,fontWeight:800,marginBottom:6,letterSpacing:'-.03em'}}>{plan.price}</div>
                  <div style={{fontSize:12,color:'var(--muted)',marginBottom:12}}>{plan.userLimit===null?'Unlimited users':`Up to ${plan.userLimit} users`}</div>
                  <p style={{fontSize:12,color:'var(--muted)',lineHeight:1.6,marginBottom:16,minHeight:58}}>{plan.blurb}</p>
                  <div style={{display:'grid',gap:8,marginBottom:16,fontSize:12,color:'var(--text)'}}>
                    <div>Unlimited projects and issues</div>
                    <div>Dashboard and report export</div>
                    <div>{plan.userLimit===null?'Best for company-wide adoption':'Role-based workflow included'}</div>
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={active || overLimit || !!planSaving} onClick={()=>changePlan(plan.code)} style={{width:'100%',justifyContent:'center'}}>
                    {active ? 'Current Plan' : overLimit ? 'Too Many Users' : planSaving===plan.code ? 'Updating…' : plan.cta}
                  </button>
                  {!active && overLimit && <div style={{fontSize:11,color:'var(--danger)',marginTop:8}}>Reduce team size before switching.</div>}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:24}}>
          <h3 style={{fontSize:14,fontWeight:600,marginBottom:20}}>Organisation Details</h3>
          <form onSubmit={save}>
            <div className="form-group">
              <label className="form-label">Company Photo or Logo</label>
              <div style={{display:'flex',alignItems:'center',gap:14}}>
                <BrandLogo src={logoFile ? URL.createObjectURL(logoFile) : (org?.logo || BRAND_LOGO)} size={56} rounded={14} />
                <input className="form-input" type="file" accept="image/*" onChange={e=>setLogoFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Company Name</label>
              <input className="form-input" value={form.name} onChange={e=>setF('name',e.target.value)} required />
            </div>
            <div style={{marginTop:28,paddingTop:24,borderTop:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',marginBottom:18,flexWrap:'wrap'}}>
                <div>
                  <h3 style={{fontSize:14,fontWeight:600,marginBottom:4}}>Issue Data Source</h3>
                  <p style={{fontSize:13,color:'var(--muted)',lineHeight:1.6,maxWidth:620}}>
                    Link a Google Sheet or upload an Excel/CSV file for this organisation. Each tab becomes a project and each matching row becomes an issue, just like the existing Twinleaves import flow.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={runSourceSync}
                  disabled={syncingSource || !org?.dataSourceType}
                >
                  {syncingSource ? 'Syncing…' : 'Sync Now'}
                </button>
              </div>

              {org?.dataSourceType && (
                <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:16,marginBottom:18}}>
                  <div style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--muted)',marginBottom:8}}>Current Source</div>
                  <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>
                    {org.dataSourceType === 'google_sheet' ? 'Google Sheet Link' : org.dataSourceType === 'xlsx' ? 'Excel Upload' : 'CSV Upload'}
                  </div>
                  <div style={{fontSize:13,color:'var(--text)',wordBreak:'break-word',marginBottom:8}}>
                    {sourceSummary[org.dataSourceType] || 'No source linked'}
                  </div>
                  <div style={{fontSize:12,color:'var(--muted)',display:'grid',gap:4}}>
                    <div>Status: {org?.dataSourceSyncEnabled ? 'Sync enabled' : 'Sync paused'}</div>
                    <div>Last synced: {formatDateTime(org?.dataSourceLastSyncedAt)}</div>
                    {org?.dataSourceLastError && <div style={{color:'var(--danger)'}}>Last error: {org.dataSourceLastError}</div>}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Source Type</label>
                <select className="form-select" value={form.dataSourceType} onChange={e=>{setF('dataSourceType', e.target.value); setSpreadsheetFile(null);}}>
                  <option value="">No linked source</option>
                  <option value="google_sheet">Google Sheet Link</option>
                  <option value="xlsx">Excel Upload (.xlsx)</option>
                  <option value="csv">CSV Upload (.csv)</option>
                </select>
              </div>

              {form.dataSourceType === 'google_sheet' && (
                <div className="form-group">
                  <label className="form-label">Google Sheet Link</label>
                  <input
                    className="form-input"
                    value={form.dataSourceUrl}
                    onChange={e=>setF('dataSourceUrl',e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />
                </div>
              )}

              {(form.dataSourceType === 'xlsx' || form.dataSourceType === 'csv') && (
                <div className="form-group">
                  <label className="form-label">{form.dataSourceType === 'xlsx' ? 'Excel File' : 'CSV File'}</label>
                  <input
                    className="form-input"
                    type="file"
                    accept={form.dataSourceType === 'xlsx' ? '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel' : '.csv,text/csv'}
                    onChange={e=>setSpreadsheetFile(e.target.files?.[0] || null)}
                  />
                  <div style={{fontSize:12,color:'var(--muted)',marginTop:8}}>
                    {spreadsheetFile?.name || org?.dataSourceFileName || 'No file uploaded yet'}
                  </div>
                </div>
              )}

              {!!form.dataSourceType && (
                <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--text)',marginTop:4}}>
                  <input
                    type="checkbox"
                    checked={form.dataSourceSyncEnabled}
                    onChange={e=>setF('dataSourceSyncEnabled', e.target.checked)}
                  />
                  Keep this source linked for automatic sync
                </label>
              )}
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
//  ROLES PAGE  (admin only – RBAC management)
// ══════════════════════════════════════════════════════════════════════════════
function ProfileSettingsModal({ user, onClose, onSave, toast }) {
  const [form, setForm] = useState({ name:user?.name||'', email:user?.email||'', mobileNumber:user?.mobileNumber||'', pin:'', confirmPin:'' });
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const submit = async e => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) { toast('Name and email are required', 'error'); return; }
    if (form.pin || form.confirmPin) {
      if (form.pin !== form.confirmPin) { toast('Login PINs do not match', 'error'); return; }
      if (!/^\d{4,10}$/.test(form.pin)) { toast('Login PIN must be 4 to 10 digits', 'error'); return; }
    }
    setSaving(true);
    const avatarDataUrl = photoFile ? await readImageAsDataUrl(photoFile) : null;
    const res = await api.put('/api/auth/me', {
      name: form.name,
      email: form.email,
      mobileNumber: form.mobileNumber,
      avatarDataUrl,
      pin: form.pin || undefined,
    });
    if (res.error) { toast(res.error, 'error'); setSaving(false); return; }
    onSave(res);
    toast('Profile updated', 'success');
    setSaving(false);
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-header"><h2 className="modal-title">Profile Settings</h2><button className="btn-icon" onClick={onClose}>✕</button></div>
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Profile Photo</label>
            <div style={{display:'flex',alignItems:'center',gap:14}}>
              <Avatar user={{ ...user, avatar: photoFile ? URL.createObjectURL(photoFile) : user?.avatar }} />
              <input className="form-input" type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <div className="form-group"><label className="form-label">Full Name</label><input className="form-input" value={form.name} onChange={e=>setF('name',e.target.value)} required /></div>
          <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e=>setF('email',e.target.value)} required /></div>
          <div className="form-group"><label className="form-label">Phone Number</label><input className="form-input" value={form.mobileNumber} onChange={e=>setF('mobileNumber',e.target.value)} placeholder="Optional" /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Login PIN</label><input className="form-input" type="password" value={form.pin} onChange={e=>setF('pin',e.target.value)} placeholder="4 to 10 digits" /></div>
            <div className="form-group"><label className="form-label">Confirm PIN</label><input className="form-input" type="password" value={form.confirmPin} onChange={e=>setF('confirmPin',e.target.value)} placeholder="Repeat PIN" /></div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving?'Saving…':'Save Changes'}</button></div>
      </form>
    </Modal>
  );
}

function RolesPage({ users, currentUser, toast }) {
  const [roles, setRoles]           = useState([]);
  const [selRole, setSelRole]       = useState(null);
  const [selUser, setSelUser]       = useState(null);
  const [userRoles, setUserRoles]   = useState([]);
  const [projects, setProjects]     = useState([]);
  const [showNew, setShowNew]       = useState(false);
  const [newRole, setNewRole]       = useState({ name:'', description:'', color:'#6366f1', permissions:[] });
  const [assignForm, setAssignForm] = useState({ userId:'', roleId:'', projectId:'' });
  const canManage = currentUser?.role === 'admin';

  const loadRoles = () => api.get('/api/rbac/roles').then(setRoles);
  const loadProjects = () => api.get('/api/projects').then(setProjects);

  useEffect(() => { loadRoles(); loadProjects(); }, []);

  const loadUserRoles = async uid => {
    const res = await api.get(`/api/rbac/users/${uid}/roles`);
    if (!res.error) setUserRoles(res);
  };

  const selectUser = u => { setSelUser(u); loadUserRoles(u.id); };

  const assignRole = async e => {
    e.preventDefault();
    if (!assignForm.userId || !assignForm.roleId) return;
    const body = { roleId: assignForm.roleId };
    if (assignForm.projectId) body.projectId = assignForm.projectId;
    const res = await api.post(`/api/rbac/users/${assignForm.userId}/roles`, body);
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Role assigned', 'success');
    if (selUser?.id === assignForm.userId) loadUserRoles(assignForm.userId);
    setAssignForm({ userId: assignForm.userId, roleId:'', projectId:'' });
  };

  const removeUserRole = async (uid, urId) => {
    await api.delete(`/api/rbac/users/${uid}/roles/${urId}`);
    toast('Role removed', 'info');
    loadUserRoles(uid);
  };

  const createRole = async e => {
    e.preventDefault();
    if (!newRole.name.trim()) return;
    const res = await api.post('/api/rbac/roles', newRole);
    if (res.error) { toast(res.error, 'error'); return; }
    toast('Role created', 'success');
    setShowNew(false);
    setNewRole({ name:'', description:'', color:'#6366f1', permissions:[] });
    loadRoles();
  };

  const deleteRole = async id => {
    if (!confirm('Delete this role?')) return;
    await api.delete(`/api/rbac/roles/${id}`);
    toast('Role deleted', 'info');
    if (selRole?.id === id) setSelRole(null);
    loadRoles();
  };

  const togglePerm = (perm, list, setter) => {
    setter(l => l.includes(perm) ? l.filter(p=>p!==perm) : [...l, perm]);
  };

  const permBadge = (perm, active, onClick) => (
    <span key={perm} onClick={onClick} style={{
      display:'inline-block', padding:'3px 10px', borderRadius:99, fontSize:11, fontWeight:600,
      cursor: onClick ? 'pointer' : 'default', margin:'3px 4px 3px 0',
      background: active ? 'var(--primary)' : 'var(--surface2)',
      color: active ? '#fff' : 'var(--muted)',
      border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
      userSelect:'none',
    }}>{perm}</span>
  );

  if (!canManage) return (
    <div className="empty-state"><div className="icon">🔒</div><h3>Admin Only</h3><p>Only admins can manage roles & permissions.</p></div>
  );

  return (
    <div>
      <div className="page-header">
        <div><h1>Roles & Permissions</h1><p>Manage RBAC roles and user assignments</p></div>
        <button className="btn btn-primary" onClick={()=>setShowNew(true)}>+ New Role</button>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:20}}>

        {/* ── Left: Role list ── */}
        <div>
          <h3 style={{fontSize:13,fontWeight:600,color:'var(--muted)',marginBottom:12,textTransform:'uppercase',letterSpacing:'.05em'}}>All Roles</h3>
          {roles.map(r => (
            <div key={r.id} onClick={()=>setSelRole(selRole?.id===r.id?null:r)}
              style={{background:'var(--surface)',border:`1px solid ${selRole?.id===r.id?'var(--primary)':'var(--border)'}`,borderRadius:'var(--radius)',padding:16,marginBottom:10,cursor:'pointer',transition:'border .15s'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                <span style={{width:10,height:10,borderRadius:'50%',background:r.color,flexShrink:0,display:'inline-block'}}/>
                <span style={{fontWeight:600,flex:1}}>{r.name}</span>
                {r.isSystem && <span style={{fontSize:10,padding:'1px 7px',borderRadius:99,background:'var(--surface2)',color:'var(--muted)',border:'1px solid var(--border)'}}>system</span>}
                {!r.isSystem && canManage && (
                  <button className="btn-icon" style={{fontSize:12,color:'var(--danger)'}} onClick={e=>{e.stopPropagation();deleteRole(r.id);}}>✕</button>
                )}
              </div>
              {r.description && <p style={{fontSize:12,color:'var(--muted)',margin:'0 0 8px'}}>{r.description}</p>}
              <div style={{display:'flex',flexWrap:'wrap'}}>
                {(r.permissions||[]).map(p => permBadge(p, true, null))}
                {(!r.permissions||r.permissions.length===0) && <span style={{fontSize:12,color:'var(--muted)'}}>No permissions</span>}
              </div>
            </div>
          ))}
        </div>

        {/* ── Right: User assignment panel ── */}
        <div>
          <h3 style={{fontSize:13,fontWeight:600,color:'var(--muted)',marginBottom:12,textTransform:'uppercase',letterSpacing:'.05em'}}>Assign Roles to Users</h3>

          {/* User picker */}
          <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:16,marginBottom:12}}>
            <label className="form-label">Select User</label>
            <select className="form-select" value={assignForm.userId} onChange={e=>{setAssignForm(f=>({...f,userId:e.target.value,roleId:'',projectId:''}));const u=users.find(u=>u.id===e.target.value);if(u)selectUser(u);}}>
              <option value="">— pick a user —</option>
              {users.map(u=><option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
          </div>

          {/* Current roles for selected user */}
              {selUser && (
            <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:16,marginBottom:12}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:10}}>
                <span style={{display:'inline-flex',verticalAlign:'middle',marginRight:8}}>
                  <Avatar user={selUser} size="xs" />
                </span>
                {selUser.name}'s Roles
              </div>
              {userRoles.length === 0 && <p style={{fontSize:12,color:'var(--muted)'}}>No roles assigned.</p>}
              {userRoles.map(ur => (
                <div key={ur.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                  <span style={{flex:1,fontSize:13}}>
                    <span style={{fontWeight:600,color: ROLE_COLORS[ur.name]||'var(--primary)'}}>{ur.name}</span>
                    {ur.projectName && <span style={{color:'var(--muted)',fontSize:12}}> · {ur.projectName}</span>}
                    {!ur.projectName && <span style={{color:'var(--muted)',fontSize:12}}> · Global</span>}
                  </span>
                  <button className="btn btn-ghost btn-sm" style={{fontSize:11,padding:'2px 8px',color:'var(--danger)'}} onClick={()=>removeUserRole(selUser.id,ur.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}

          {/* Assign form */}
          {selUser && (
            <form onSubmit={assignRole} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:16}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:12}}>Assign New Role</div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-select" value={assignForm.roleId} onChange={e=>setAssignForm(f=>({...f,roleId:e.target.value}))} required>
                  <option value="">— select role —</option>
                  {roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Project (optional — leave blank for global)</label>
                <select className="form-select" value={assignForm.projectId} onChange={e=>setAssignForm(f=>({...f,projectId:e.target.value}))}>
                  <option value="">Global (all projects)</option>
                  {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <button type="submit" className="btn btn-primary btn-sm">Assign Role</button>
            </form>
          )}
        </div>
      </div>

      {/* ── New role modal ── */}
      {showNew && (
        <Modal onClose={()=>setShowNew(false)}>
          <div className="modal-header"><h2 className="modal-title">Create Custom Role</h2><button className="btn-icon" onClick={()=>setShowNew(false)}>✕</button></div>
          <form onSubmit={createRole}>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Role Name *</label>
                <input className="form-input" value={newRole.name} onChange={e=>setNewRole(r=>({...r,name:e.target.value}))} placeholder="e.g. QA Lead" required autoFocus/>
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input className="form-input" value={newRole.description} onChange={e=>setNewRole(r=>({...r,description:e.target.value}))} placeholder="What can this role do?"/>
              </div>
              <div className="form-group">
                <label className="form-label">Color</label>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {COLORS.map(c=><div key={c} onClick={()=>setNewRole(r=>({...r,color:c}))} style={{width:24,height:24,borderRadius:'50%',background:c,cursor:'pointer',border:newRole.color===c?'3px solid #fff':'3px solid transparent',transform:newRole.color===c?'scale(1.2)':'none',transition:'all .15s'}}/>)}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Permissions</label>
                <div style={{display:'flex',flexWrap:'wrap',gap:2,marginTop:4}}>
                  {ALL_PERMISSIONS.map(p => permBadge(p, newRole.permissions.includes(p), ()=>togglePerm(p, newRole.permissions, perms=>setNewRole(r=>({...r,permissions:perms})))))}
                </div>
                <p style={{fontSize:11,color:'var(--muted)',marginTop:6}}>Click permissions to toggle them on/off</p>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={()=>setShowNew(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create Role</button>
            </div>
          </form>
        </Modal>
      )}
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
  const [showSidebarProjectCreate, setShowSidebarProjectCreate] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [toasts, setToasts]         = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [theme, setTheme]           = useState(() => localStorage.getItem('bt_theme') || 'light');

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

  // ── Presence: heartbeat + poll online users ──
  useEffect(() => {
    if (!authUser) return;

    const sendOfflineBeacon = () => {
      const token = Token.get();
      if (token) navigator.sendBeacon('/api/presence/offline', JSON.stringify({ token }));
    };

    const beat = () => { if (!document.hidden) api.post('/api/presence/heartbeat', {}); };
    const poll = () => api.get('/api/presence').then(data => { if (Array.isArray(data)) setOnlineUsers(data); });

    beat(); poll();
    const beatTimer = setInterval(beat, 30_000);
    const pollTimer = setInterval(poll, 30_000);

    // Resume heartbeat immediately when tab becomes visible again
    const onVisibility = () => { if (!document.hidden) { beat(); poll(); } };

    window.addEventListener('beforeunload', sendOfflineBeacon);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(beatTimer);
      clearInterval(pollTimer);
      window.removeEventListener('beforeunload', sendOfflineBeacon);
      document.removeEventListener('visibilitychange', onVisibility);
      sendOfflineBeacon();
    };
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
  const handleProjectCreated = project => {
    setCurrentProjectId(project.id);
    setView('projects');
  };
  const navItems = [
    { id:'dashboard', label:'Dashboard', icon:'📊' },
    { id:'board',     label:'Board',     icon:'📋' },
    { id:'list',      label:'Issues',    icon:'🐛' },
    { id:'projects',  label:'Projects',  icon:'📁' },
    { id:'team',      label:'Team',      icon:'👥' },
    ...(authUser?.role==='admin' ? [
      { id:'roles',    label:'Roles',     icon:'🔐' },
      { id:'settings', label:'Settings',  icon:'⚙️' },
    ] : []),
  ];
  const navigate = v => setView(v);

  useEffect(() => {
    const closeMenu = () => setShowProfileMenu(false);
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, []);

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
            <BrandLogo src={authOrg?.logo || BRAND_LOGO} size={44} rounded={12} />
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{authOrg?.name||'FixPulse'}</div>
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
            <button className="btn-icon" style={{marginLeft:'auto',width:24,height:24,fontSize:14}} title="Create Project" onClick={e=>{e.stopPropagation();setShowSidebarProjectCreate(true);}}>+</button>
          </div>
          {projects.map(p => (
            <div key={p.id} className={`sidebar-item ${currentProjectId===p.id?'active':''}`} onClick={()=>setCurrentProjectId(p.id)}>
              <span style={{width:10,height:10,borderRadius:'50%',background:p.color,flexShrink:0}}/><span className="label">{p.name}</span>
            </div>
          ))}
        </div>

      </aside>

      <main className="main">
        <div className="topbar">
          <span className="topbar-title">
            {navItems.find(n=>n.id===view)?.icon} {navItems.find(n=>n.id===view)?.label}
            {currentProject&&<span style={{color:'var(--muted)',fontWeight:400,marginLeft:6}}>/ {currentProject.name}</span>}
          </span>
          {onlineUsers.length > 0 && (
            <div className="online-members" title={`${onlineUsers.length} online`}>
              {onlineUsers.slice(0,5).map((u, i) => (
                <div key={u.id} className="online-member-avatar" style={{zIndex: onlineUsers.length - i}} title={u.name}>
                  {u.avatar && u.avatar.startsWith('data:image/')
                    ? <img src={u.avatar} alt={u.name} style={{width:'100%',height:'100%',borderRadius:'50%',objectFit:'cover'}} />
                    : <span>{String(u.name || '?').trim().charAt(0).toUpperCase() || '?'}</span>}
                  <span className="online-dot"/>
                </div>
              ))}
              {onlineUsers.length > 5 && (
                <div className="online-member-avatar online-member-overflow" style={{zIndex:0}}>+{onlineUsers.length - 5}</div>
              )}
            </div>
          )}
          <button className="theme-toggle" onClick={toggleTheme} title={theme==='dark'?'Switch to light mode':'Switch to dark mode'}>
            {theme==='dark' ? '☀️' : '🌙'}
          </button>
          <div style={{display:'flex',alignItems:'center',gap:10,position:'relative'}} onClick={e=>e.stopPropagation()}>
            <div style={{textAlign:'right',display:'flex',flexDirection:'column'}}>
              <span style={{fontSize:13,fontWeight:500}}>{authUser.name}</span>
              <span style={{fontSize:11,color:'var(--muted)'}}>{ROLE_LABELS[authUser.role]||authUser.role}</span>
            </div>
            <button className="btn-ghost" style={{padding:0,border:'none',background:'transparent',display:'flex',alignItems:'center',gap:8}} onClick={()=>setShowProfileMenu(v=>!v)}>
              <Avatar user={authUser} />
              <span style={{fontSize:12,color:'var(--muted)'}}>▾</span>
            </button>
            {showProfileMenu && (
              <div style={{position:'absolute',top:'calc(100% + 8px)',right:0,width:220,background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',boxShadow:'var(--shadow)',padding:8,zIndex:50}}>
                <div style={{padding:'8px 10px',borderBottom:'1px solid var(--border)',marginBottom:6}}>
                  <div style={{fontWeight:600,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{authUser.name}</div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>{ROLE_LABELS[authUser.role]||authUser.role}</div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{width:'100%',justifyContent:'flex-start',marginBottom:6}} onClick={()=>{setShowProfileMenu(false);setShowProfileSettings(true);}}>Profile Settings</button>
                <button className="btn btn-ghost btn-sm" style={{width:'100%',justifyContent:'flex-start'}} onClick={handleLogout}>Log Out</button>
              </div>
            )}
          </div>
        </div>

        <div className="content">
          {view==='dashboard' && <Dashboard projects={projects} users={users} currentProject={currentProject} onNavigate={navigate} currentUser={authUser} toast={toast}/>}
          {view==='board'     && <KanbanBoard projects={projects} users={users} currentProject={currentProject} toast={toast} currentUser={authUser}/>}
          {view==='list'      && <BugList projects={projects} users={users} currentProject={currentProject} toast={toast} currentUser={authUser}/>}
          {view==='projects'  && <ProjectsPage projects={projects} setProjects={setProjects} toast={toast} onProjectCreated={handleProjectCreated}/>}
          {view==='team'      && <TeamPage users={users} setUsers={setUsers} bugs={allBugs} toast={toast} currentUser={authUser} onCurrentUserUpdated={user=>setAuthUser(user)}/>}
          {view==='roles'     && <RolesPage users={users} currentUser={authUser} toast={toast}/>}
          {view==='settings'  && <SettingsPage org={authOrg} setOrg={setAuthOrg} currentUser={authUser} toast={toast} users={users}/>}
        </div>
      </main>

      {showSidebarProjectCreate&&<ProjectModal onClose={()=>setShowSidebarProjectCreate(false)} onCreate={async form=>{const p=await api.post('/api/projects',form);setProjects(ps=>[...ps,p]);setShowSidebarProjectCreate(false);handleProjectCreated(p);toast('Project created','success');}}/>}
      {showProfileSettings&&<ProfileSettingsModal user={authUser} onClose={()=>setShowProfileSettings(false)} onSave={user=>setAuthUser(user)} toast={toast}/>}
      <Toast toasts={toasts} dismiss={id=>setToasts(ts=>ts.filter(t=>t.id!==id))}/>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
