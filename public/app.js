const { useState, useEffect, useRef, useCallback } = React;
const API = '';
const BRAND_LOGO = '/fixpulse-logo-small.png';

// ── Token storage ──────────────────────────────────────────────────────────────
const Token = {
  get:   ()  => localStorage.getItem('bt_token'),
  set:   (t) => {
    localStorage.setItem('bt_token', t);
    document.cookie = `bt_has_token=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  },
  clear: ()  => {
    localStorage.removeItem('bt_token');
    document.cookie = 'bt_has_token=; path=/; max-age=0; SameSite=Lax';
  },
};
if (Token.get()) {
  document.cookie = `bt_has_token=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

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
const priorityBadge = p => ({ P0:'badge-priority-critical', P1:'badge-priority-high', P2:'badge-priority-medium', P3:'badge-priority-low' }[p]||'badge-priority-medium');
const typeBadge    = t => ({ Bug:'badge-type-bug', Feature:'badge-type-feature', Task:'badge-type-task', Improvement:'badge-type-improvement' }[t]||'badge-type-task');
const BADGE_COLORS = {
  'badge-status-todo':       { bg:'var(--bdg-todo-bg)', fg:'var(--bdg-todo-fg)' },
  'badge-status-inprogress': { bg:'var(--bdg-prog-bg)', fg:'var(--bdg-prog-fg)' },
  'badge-status-inreview':   { bg:'var(--bdg-rev-bg)',  fg:'var(--bdg-rev-fg)'  },
  'badge-status-done':       { bg:'var(--bdg-done-bg)', fg:'var(--bdg-done-fg)' },
  'badge-priority-critical': { bg:'var(--bdg-crit-bg)', fg:'var(--bdg-crit-fg)' },
  'badge-priority-high':     { bg:'var(--bdg-high-bg)', fg:'var(--bdg-high-fg)' },
  'badge-priority-medium':   { bg:'var(--bdg-med-bg)',  fg:'var(--bdg-med-fg)'  },
  'badge-priority-low':      { bg:'var(--bdg-low-bg)',  fg:'var(--bdg-low-fg)'  },
  'badge-type-bug':          { bg:'var(--bdg-bug-bg)',  fg:'var(--bdg-bug-fg)'  },
  'badge-type-feature':      { bg:'var(--bdg-feat-bg)', fg:'var(--bdg-feat-fg)' },
  'badge-type-task':         { bg:'var(--bdg-task-bg)', fg:'var(--bdg-task-fg)' },
  'badge-type-improvement':  { bg:'var(--bdg-impr-bg)', fg:'var(--bdg-impr-fg)' },
};
const priorityIcon = p => ({ P0:'🔴', P1:'🟠', P2:'🟡', P3:'🔵' }[p]||'');
const typeIcon     = t => ({ Bug:'🐛', Feature:'✨', Task:'📋', Improvement:'⚡' }[t]||'');
const statusIcon   = s => ({ 'To Do':'○', 'In Progress':'◑', 'In Review':'◕', 'Done':'●' }[s]||'○');
const timeAgo      = ts => { const d=Math.floor((Date.now()-new Date(ts))/1000); if(d<60)return 'just now'; if(d<3600)return `${Math.floor(d/60)}m ago`; if(d<86400)return `${Math.floor(d/3600)}h ago`; return `${Math.floor(d/86400)}d ago`; };
const formatDate   = ts => ts ? new Date(ts).toLocaleDateString('en-GB') : '—';
const formatDateTime = ts => ts ? new Date(ts).toLocaleString('en-GB') : 'Unavailable';
const getIssueLastStatusChangeDate = bug => bug?.lastStatusChangeAt || bug?.updatedAt || null;
const isSheetImportedBug = bug => bug?.sourceKind === 'google_sheet' || Boolean(getMetadataValue(bug?.description, 'Source Tab'));
const getIssueCreatedDate = bug => isSheetImportedBug(bug) ? (bug?.sourceCreatedAt || null) : (bug?.createdAt || null);
const formatIssueCreatedDate = bug => {
  const createdAt = getIssueCreatedDate(bug);
  if (!createdAt) return 'Unavailable';
  return formatDate(createdAt);
};
const sortBugsByCreatedDateDesc = bugs => [...(bugs || [])]
  .filter(bug => Boolean(getIssueCreatedDate(bug)))
  .sort((a, b) => new Date(getIssueCreatedDate(b)).getTime() - new Date(getIssueCreatedDate(a)).getTime());
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
const isCompactSheetProject = project => project?.sheetLayoutVersion === 'compact_v2';
const getProjectCustomFields = project => Array.isArray(project?.customIssueFields) ? project.customIssueFields : [];
const normalizeCustomFieldId = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `field_${Date.now().toString(36)}`;
const getCustomFieldValue = (bug, field) => {
  const values = bug?.customFields && typeof bug.customFields === 'object' ? bug.customFields : {};
  return values[field.id] || '';
};
const getSheetViewColumns = project => {
  const base = [
    { key:'createdAt', label:'Date Created' },
    { key:'title', label:'Issue Title' },
    { key:'reporter', label:'Raised By' },
    { key:'type', label:'Issue Type' },
    { key:'assignee', label:'Assignee' },
    { key:'priority', label:'Priority' },
    { key:'status', label:'Status' },
  ];
  return [...base, ...getProjectCustomFields(project).map(field => ({ key:`custom:${field.id}`, label:field.label, field }))];
};
const CUSTOM_FIELD_TYPES = [
  { value:'text', label:'Single line' },
  { value:'textarea', label:'Paragraph' },
  { value:'select', label:'Dropdown' },
  { value:'date', label:'Date' },
];
// ── Sheet-form field mapping ───────────────────────────────────────────────────
const LEGACY_SHEET_HEADERS_CLIENT = ['S.No','Issue Description','Status','Priority','Assignee','Issue Type','Application','OS - Operating System','Browser','Environment','Retail Type','Location Type','Module','Feature','Raised By','Date','Dev Comments','QA Comments','Sprint'];
const COMPACT_SHEET_HEADERS_CLIENT = ['Date Created','Issue Title','Raised By','Issue Type','Assignee','Priority','Status'];
const META_PREFIXES = ['Source Tab:','Source Row:','Date:','Raised By:','Application:','Issue Type:','Operating System:','Browser:','Environment:','Retail Type:','Location Type:','Module:','Feature:','Assignee(s):','Priority (Original):','Status (Original):','Sprint:','Version:','QA Check:','Release:','Slicing:','Affected Components:','Mode:','Steps To Reproduce:','Developer Comments:','QA Comments:','Assignee From Sheet:'];
const extractFreeDescription = desc => String(desc||'').split('\n').filter(l => !META_PREFIXES.some(p => l.startsWith(p))).join('\n').trim();
const buildLegacyDescription = (freeText, meta) => {
  const parts = [];
  if (freeText?.trim()) parts.push(freeText.trim());
  Object.entries(meta).forEach(([k, v]) => { if (v?.trim()) parts.push(`${k}: ${v.trim()}`); });
  return parts.join('\n');
};
// Null = auto-set (skip in form). Fields referencing same formKey share the same form state slot.
const SHEET_FORM_FIELD_MAP = {
  'S.No':null, 'Date Created':null, 'Raised By':null, 'Raised by':null, 'Date':null,
  'Issue Description': { key:'title',       type:'text',         label:'Issue Description', required:true },
  'Issue Title':       { key:'title',       type:'text',         label:'Issue Title',        required:true },
  'Issue Type':        { key:'type',        type:'badge-select', label:'Issue Type',         options:['Bug','Feature','Task','Improvement'], badgeFn:typeBadge, iconFn:typeIcon },
  'Assignee':          { key:'assigneeId',  type:'user-select',  label:'Assignee' },
  'Priority':          { key:'priority',    type:'badge-select', label:'Priority',           options:['P0','P1','P2','P3'], badgeFn:priorityBadge, iconFn:priorityIcon },
  'Status':            { key:'status',      type:'badge-select', label:'Status',             options:['To Do','In Progress','In Review','Done'], badgeFn:statusBadge, iconFn:statusIcon },
  'Application':         { key:'_application',   type:'text',     label:'Application' },
  'OS - Operating System': { key:'_os',          type:'text',     label:'OS - Operating System', metaKey:'Operating System' },
  'Browser':             { key:'_browser',       type:'select',   label:'Browser',   options:['','Chrome','Firefox','Safari','MS Edge','App'] },
  'Environment':         { key:'_environment',   type:'select',   label:'Environment', options:['','Dev','Stage','Prod','Upcoming-Stage'] },
  'Retail Type':         { key:'_retailType',    type:'select',   label:'Retail Type', options:['','Grocery','Restaurant','Grocery / Restaurant'] },
  'Location Type':       { key:'_locationType',  type:'select',   label:'Location Type',     metaKey:'Location Type', options:['','QSR','FINE DINE-IN','Grocery','Grocery / Restaurant','FINE DINE-IN / QSR'] },
  'Location':            { key:'_locationType',  type:'select',   label:'Location',          metaKey:'Location Type', options:['','QSR','FINE DINE-IN','Grocery','Grocery / Restaurant','FINE DINE-IN / QSR'] },
  'location':            { key:'_locationType',  type:'select',   label:'Location',          metaKey:'Location Type', options:['','QSR','FINE DINE-IN','Grocery','Grocery / Restaurant','FINE DINE-IN / QSR'] },
  'Module':            { key:'_module',     type:'text',         label:'Module' },
  'Feature':           { key:'_feature',    type:'text',         label:'Feature' },
  'Dev Comments':      { key:'_devComments',type:'textarea',     label:'Dev Comments',       metaKey:'Developer Comments' },
  'QA Comments':       { key:'_qaComments', type:'textarea',     label:'QA Comments',        metaKey:'QA Comments' },
  'Sprint':            { key:'_sprint',     type:'text',         label:'Sprint' },
};
// Headers that are auto-generated / don't need a form input
const AUTO_SKIP_HEADERS = new Set(['S.No','Date Created','Raised By','Date','Issue raised by','Source Tab','Source Row','#','Sr No','Sr.No','Sr. No','No.','Serial No','Serial Number']);
// Returns ordered list of form field descriptors for a project (excluding title, which is always first)
const getSheetFormFields = (project, customFieldOverride) => {
  if (isCompactSheetProject(project)) {
    const customFields = customFieldOverride || getProjectCustomFields(project);
    const storedHeaders = Array.isArray(project?.sheetHeaders) && project.sheetHeaders.length > 0 ? project.sheetHeaders : null;
    if (storedHeaders) {
      const customByLabel = Object.fromEntries(customFields.map(cf => [String(cf.label||'').trim().toLowerCase(), cf]));
      const fields = [];
      for (const h of storedHeaders) {
        if (AUTO_SKIP_HEADERS.has(h)) continue;
        const mapped = SHEET_FORM_FIELD_MAP[h];
        if (mapped === null) continue;
        if (mapped) {
          if (mapped.key !== 'title') fields.push(mapped);
        } else {
          const cf = customByLabel[h.trim().toLowerCase()];
          if (cf) {
            fields.push({ key:`custom:${cf.id}`, type:'custom', label:cf.label, field:cf });
          } else {
            const isTA = /comment|notes|remark|step|description|feedback/i.test(h);
            fields.push({ key:'_metaFields', metaKey:h, type: isTA ? 'meta-textarea' : 'meta-text', label:h });
          }
        }
      }
      return fields;
    }
    const fields = COMPACT_SHEET_HEADERS_CLIENT.map(h => SHEET_FORM_FIELD_MAP[h]).filter(f => f && f.key !== 'title');
    fields.push(...customFields.map(cf => ({ key:`custom:${cf.id}`, type:'custom', label:cf.label, field:cf })));
    return fields;
  }
  // For legacy projects: use stored per-tab headers if available, else fallback to hardcoded list
  const headers = (Array.isArray(project?.sheetHeaders) && project.sheetHeaders.length > 0)
    ? project.sheetHeaders
    : LEGACY_SHEET_HEADERS_CLIENT;
  const fields = [];
  for (const h of headers) {
    if (AUTO_SKIP_HEADERS.has(h)) continue;
    const mapped = SHEET_FORM_FIELD_MAP[h];
    if (mapped === null) continue; // explicitly auto-generated
    if (mapped) {
      if (mapped.key !== 'title') fields.push(mapped);
    } else {
      // Dynamic field for a column not in SHEET_FORM_FIELD_MAP
      const isTA = /comment|notes|remark|step|description|feedback/i.test(h);
      fields.push({ key:'_metaFields', metaKey:h, type: isTA ? 'meta-textarea' : 'meta-text', label:h });
    }
  }
  return fields;
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
  byPriority: ['P0','P1','P2','P3'].reduce((acc, label) => ({ ...acc, [label]: bugs.filter(b => b.priority === label).length }), {}),
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
        <td class="priority">${escapeHtml(bug.priority || 'P2')}</td>
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
  <title>${escapeHtml(project.name)} - Issue Report</title>
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
        <a class="report-link" href="${escapeHtml(window.location.origin)}">${escapeHtml(project.name)} - Issue Report</a>
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
      <td><strong>P0</strong><br>${stats.byPriority?.P0 || 0}</td>
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
const APPS_SCRIPT_SNIPPET = `function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const TYPE_COLORS = {'Bug':'#ea4335','Feature':'#34a853','Task':'#4285f4','Improvement':'#9c27b0','New Issue':'#34a853','Regression':'#d93025','Enhancement':'#ff9800','Defect':'#f44336'};
    const STATUS_COLORS = {'To Do':'#9e9e9e','In Progress':'#1a73e8','In Review':'#e37400','Done':'#1e8e3e'};
    const PRIORITY_COLORS = {'P0':'#d93025','P1':'#e37400','P2':'#f9ab00','P3':'#1e8e3e'};
    const TYPE_OPTIONS = ['Bug','Feature','Task','Improvement','New Issue','Regression','Enhancement','Defect'];
    const STATUS_OPTIONS = ['To Do','In Progress','In Review','Done'];
    const PRIORITY_OPTIONS = ['P0','P1','P2','P3'];
    const BROWSER_OPTIONS = ['Chrome','Firefox','Safari','MS Edge','App'];
    const ENVIRONMENT_OPTIONS = ['Dev','Stage','Prod','Upcoming-Stage'];
    const RETAIL_TYPE_OPTIONS = ['Grocery','Restaurant','Grocery / Restaurant'];
    const LOCATION_TYPE_OPTIONS = ['QSR','FINE DINE-IN','Grocery','Grocery / Restaurant','FINE DINE-IN / QSR'];
    const DEVELOPER_OPTIONS = Array.isArray(p.developerOptions) && p.developerOptions.length ? p.developerOptions : null;
    for (const t of p.sheets) {
      let sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
      const headers = t.headers || [];
      const rows = t.rows || [];
      const typeCol = headers.indexOf('Issue Type') + 1;
      const statusCol = headers.indexOf('Status') + 1;
      const priorityCol = headers.indexOf('Priority') + 1;
      const assigneeCol = headers.indexOf('Assignee') + 1;
      const raisedByCol = headers.indexOf('Raised By') + 1;
      const browserCol = headers.indexOf('Browser') + 1;
      const environmentCol = headers.indexOf('Environment') + 1;
      const retailTypeCol = headers.indexOf('Retail Type') + 1;
      const locationTypeCol = Math.max(headers.indexOf('Location Type'), headers.indexOf('Location')) + 1;
      const syncHeaders = () => {
        if (!headers.length) return;
        sh.getRange(1,1,1,Math.max(sh.getMaxColumns(), headers.length)).clearContent();
        sh.getRange(1,1,1,headers.length).setValues([headers]);
      };
      const applyDropdownsAndColors = () => {
        const lastRow = sh.getLastRow();
        if (lastRow < 2) return;
        const n = lastRow - 1;
        const setDropdown = (col, opts) => {
          if (col < 1) return;
          sh.getRange(2, col, n, 1).setDataValidation(
            SpreadsheetApp.newDataValidation().requireValueInList(opts, true).setAllowInvalid(true).build()
          );
        };
        const colorCol = (col, map) => {
          if (col < 1) return;
          const vals = sh.getRange(2, col, n, 1).getValues();
          sh.getRange(2, col, n, 1)
            .setBackgrounds(vals.map(([v]) => [map[v] || '#f1f3f4']))
            .setFontColors(vals.map(([v]) => [map[v] ? '#ffffff' : '#333333']))
            .setHorizontalAlignment('center')
            .setFontWeight('bold');
        };
        setDropdown(typeCol, TYPE_OPTIONS);
        setDropdown(statusCol, STATUS_OPTIONS);
        setDropdown(priorityCol, PRIORITY_OPTIONS);
        setDropdown(browserCol, BROWSER_OPTIONS);
        setDropdown(environmentCol, ENVIRONMENT_OPTIONS);
        setDropdown(retailTypeCol, RETAIL_TYPE_OPTIONS);
        setDropdown(locationTypeCol, LOCATION_TYPE_OPTIONS);
        if (DEVELOPER_OPTIONS) { setDropdown(assigneeCol, DEVELOPER_OPTIONS); setDropdown(raisedByCol, DEVELOPER_OPTIONS); }
        colorCol(typeCol, TYPE_COLORS);
        colorCol(statusCol, STATUS_COLORS);
        colorCol(priorityCol, PRIORITY_COLORS);
      };
      if (p.action === 'add_tab') {
        syncHeaders();
      } else if (p.action === 'append') {
        if (!headers.length) continue;
        // Read the sheet's existing column order so we never overwrite it
        const lastCol = sh.getLastColumn();
        const sheetHeaders = lastCol > 0
          ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim())
          : [];
        const hasExistingHeaders = sheetHeaders.some(Boolean);
        if (!hasExistingHeaders) {
          // New / empty tab — write headers then data
          sh.getRange(1, 1, 1, headers.length).setValues([headers]);
          if (rows.length) {
            sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
            applyDropdownsAndColors();
          }
        } else if (rows.length) {
          // Normalize header name — S.No variants all map to the same key
          const normH = h => {
            const s = String(h || '').trim().toLowerCase().replace(/\s+/g, '');
            if (/^(s\.?no\.?|sr\.?no\.?|serialno\.?|no\.|#)$/.test(s)) return '__sno__';
            return s;
          };
          // Remap each incoming row to the sheet's existing column order
          const colCount = sheetHeaders.length;
          const remappedRows = rows.map(row =>
            sheetHeaders.map(h => {
              const idx = headers.findIndex(ih => normH(ih) === normH(h));
              return idx >= 0 && row[idx] !== undefined ? row[idx] : '';
            })
          );
          const startRow = Math.max(sh.getLastRow(), 1) + 1;
          sh.getRange(startRow, 1, remappedRows.length, colCount).setValues(remappedRows);
          // Recompute col indices from the actual sheet headers for coloring
          const eTypeCol = sheetHeaders.indexOf('Issue Type') + 1;
          const eStatusCol = sheetHeaders.indexOf('Status') + 1;
          const ePriorityCol = sheetHeaders.indexOf('Priority') + 1;
          const eAssigneeCol = sheetHeaders.indexOf('Assignee') + 1;
          const eRaisedByCol = sheetHeaders.indexOf('Raised By') + 1;
          const eBrowserCol = sheetHeaders.indexOf('Browser') + 1;
          const eEnvironmentCol = sheetHeaders.indexOf('Environment') + 1;
          const eRetailTypeCol = sheetHeaders.indexOf('Retail Type') + 1;
          const eLocationTypeCol = Math.max(sheetHeaders.indexOf('Location Type'), sheetHeaders.indexOf('Location')) + 1;
          const lastRow = sh.getLastRow();
          if (lastRow >= 2) {
            const n = lastRow - 1;
            const setDropdown = (col, opts) => {
              if (col < 1) return;
              sh.getRange(2, col, n, 1).setDataValidation(
                SpreadsheetApp.newDataValidation().requireValueInList(opts, true).setAllowInvalid(true).build()
              );
            };
            const colorCol2 = (col, map) => {
              if (col < 1) return;
              const vals = sh.getRange(2, col, n, 1).getValues();
              sh.getRange(2, col, n, 1)
                .setBackgrounds(vals.map(([v]) => [map[v] || '#f1f3f4']))
                .setFontColors(vals.map(([v]) => [map[v] ? '#ffffff' : '#333333']))
                .setHorizontalAlignment('center')
                .setFontWeight('bold');
            };
            setDropdown(eTypeCol, TYPE_OPTIONS);
            setDropdown(eStatusCol, STATUS_OPTIONS);
            setDropdown(ePriorityCol, PRIORITY_OPTIONS);
            setDropdown(eBrowserCol, BROWSER_OPTIONS);
            setDropdown(eEnvironmentCol, ENVIRONMENT_OPTIONS);
            setDropdown(eRetailTypeCol, RETAIL_TYPE_OPTIONS);
            setDropdown(eLocationTypeCol, LOCATION_TYPE_OPTIONS);
            if (DEVELOPER_OPTIONS) { setDropdown(eAssigneeCol, DEVELOPER_OPTIONS); setDropdown(eRaisedByCol, DEVELOPER_OPTIONS); }
            colorCol2(eTypeCol, TYPE_COLORS);
            colorCol2(eStatusCol, STATUS_COLORS);
            colorCol2(ePriorityCol, PRIORITY_COLORS);
          }
        }
      } else {
        const allRows = rows.length ? [headers, ...rows] : [headers];
        sh.clearContents();
        sh.getRange(1,1,allRows.length,headers.length).setValues(allRows);
        applyDropdownsAndColors();
      }
      if (headers.length) {
        sh.getRange(1,1,1,headers.length)
          .setFontWeight('bold')
          .setFontFamily('Arial')
          .setFontSize(10)
          .setBackground('#F6E3CC')
          .setFontColor('#000000')
          .setHorizontalAlignment('center')
          .setVerticalAlignment('middle')
          .setWrap(true)
          .setBorder(true, true, true, true, true, true, '#D8C0A3', SpreadsheetApp.BorderStyle.SOLID);
        sh.setFrozenRows(1);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}`;

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

const ensureChartJsLoaded = () => new Promise((resolve, reject) => {
  if (window.Chart) return resolve(window.Chart);
  const existing = document.querySelector('script[data-chartjs]');
  if (existing) {
    existing.addEventListener('load', () => resolve(window.Chart), { once: true });
    existing.addEventListener('error', () => reject(new Error('Unable to load charts')), { once: true });
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
  script.async = true;
  script.dataset.chartjs = 'true';
  script.onload = () => resolve(window.Chart);
  script.onerror = () => reject(new Error('Unable to load charts'));
  document.body.appendChild(script);
});

function SearchableSelect({ value, onChange, options, placeholder, width=180 }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const selected = options.find(option => String(option.value) === String(value));
  const normalizedOptions = options.filter(option => String(option.label) !== String(placeholder));
  const filteredOptions = options.filter(option => option.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    const onDocumentClick = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  return (
    <div ref={rootRef} style={{position:'relative', minWidth:width}}>
      <button
        type="button"
        className="filter-select"
        onClick={() => setOpen(v => !v)}
        style={{width:'100%', textAlign:'left', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10}}
      >
        <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{selected?.label || placeholder}</span>
        <span style={{fontSize:10, color:'var(--muted)'}}>▼</span>
      </button>
      {open && (
        <div style={{position:'absolute', top:'calc(100% + 8px)', left:0, width:'100%', minWidth:220, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', zIndex:60, padding:10}}>
          <input
            className="form-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${placeholder.toLowerCase()}...`}
            autoFocus
            style={{marginBottom:8, border:'1px solid var(--border)', borderRadius:'var(--radius)', boxShadow:'none'}}
          />
          <div style={{maxHeight:220, overflowY:'auto', display:'grid', gap:4}}>
            <button
              type="button"
              className={`btn btn-sm searchable-opt${!value ? ' searchable-opt--selected' : ''}`}
              onClick={() => { onChange(''); setOpen(false); }}
              style={{justifyContent:'flex-start', border:'none', borderRadius:'var(--radius)'}}
            >
              {placeholder}
            </button>
            {filteredOptions.length === 0 ? (
              <div style={{padding:'8px 10px', fontSize:12, color:'var(--muted)'}}>No matching options</div>
            ) : normalizedOptions
              .filter(option => option.label.toLowerCase().includes(query.toLowerCase()))
              .map(option => (
              <button
                key={option.value}
                type="button"
                className={`btn btn-sm searchable-opt${String(option.value) === String(value) ? ' searchable-opt--selected' : ''}`}
                onClick={() => { onChange(option.value); setOpen(false); }}
                style={{justifyContent:'flex-start', border:'none', borderRadius:'var(--radius)'}}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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

function SyncTimestamp({ toast, onSyncComplete }) {
  const { syncStatus, refreshSyncStatus } = useSheetSyncStatus();
  const [syncing, setSyncing] = useState(false);
  const syncDisplay = syncStatus?.lastSuccessAt
    ? new Date(syncStatus.lastSuccessAt).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : 'Unavailable';

  const runManualSync = async () => {
    if (syncing || syncStatus?.running) return;
    setSyncing(true);
    try {
      const result = await api.post('/api/sheet-sync/run', {});
      if (result?.error) {
        toast?.(result.error, 'error');
      } else {
        toast?.(result.started ? 'Manual data sync started' : 'Data sync is already running', 'info');
        const pollUntilDone = () => {
          api.get('/api/sheet-sync/status').then(status => {
            refreshSyncStatus();
            if (status?.running) { setTimeout(pollUntilDone, 2000); }
            else { onSyncComplete?.(); }
          });
        };
        setTimeout(pollUntilDone, 1500);
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{marginLeft:'auto', textAlign:'right', display:'flex', alignItems:'center', gap:12, padding:'8px 10px', border:'none', borderRadius:12, background:'transparent'}}>
      <div>
        <div style={{fontSize:11, fontWeight:600, color:'var(--text)', textTransform:'uppercase', letterSpacing:'0.04em'}}>Last Data Sync</div>
        <div style={{fontSize:12, color:'var(--muted)', marginTop:2}}>{syncDisplay}</div>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={runManualSync}
        disabled={syncing || syncStatus?.running}
        title="Sync data now"
        style={{padding:'8px 10px', minWidth:'40px', minHeight:'40px', borderRadius:10}}
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
  const hasFilters = [exportFilters.startDate, exportFilters.endDate, exportFilters.assigneeId, exportFilters.priority, exportFilters.status, exportFilters.type, ...(!currentProject ? [exportFilters.projectId] : [])].some(Boolean);

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
          <div className="form-group"><label className="form-label">Priority</label><select className="form-select" value={exportFilters.priority} onChange={e => setExportFilter('priority', e.target.value)}><option value="">All Priorities</option>{['P0','P1','P2','P3'].map(p => <option key={p} value={p}>{p}</option>)}</select></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Status</label><select className="form-select" value={exportFilters.status} onChange={e => setExportFilter('status', e.target.value)}><option value="">All Statuses</option>{['To Do','In Progress','In Review','Done'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className="form-group"><label className="form-label">Issue Type</label><select className="form-select" value={exportFilters.type} onChange={e => setExportFilter('type', e.target.value)}><option value="">All Types</option>{['Bug','Feature','Task','Improvement'].map(t => <option key={t} value={t}>{t}</option>)}</select></div>
        </div>
      </div>
      <div className="modal-footer">{hasFilters && <button type="button" className="btn btn-ghost" onClick={onReset}>Reset</button>}<button type="button" className="btn btn-primary" onClick={onExport}>{hasFilters ? 'Export' : 'Export without filter'}</button></div>
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
function BadgeSelect({ value, onChange, options, badgeFn, iconFn }) {
  const cls = badgeFn(value);
  const { bg, fg } = BADGE_COLORS[cls] || {};
  return (
    <select
      className="form-select"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ background: bg || '', color: fg || '', fontWeight: 600, borderColor: fg ? `${fg}55` : '' }}
    >
      {options.map(opt => <option key={opt} value={opt}>{iconFn ? `${iconFn(opt)} ${opt}` : opt}</option>)}
    </select>
  );
}
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
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width:'100%', justifyContent:'center', padding:'11px 0', fontSize:14, gap:8 }}>
              {loading && <span className="btn-spinner"/>}
              {loading ? (mode==='login' ? 'Signing in…' : 'Creating workspace…') : (mode==='login' ? '🔑 Sign In' : '🚀 Create Company Workspace')}
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
function BugModal({ bug, projects, users, currentProject, currentUser, setProjects, onClose, onSave, toast }) {
  const editing = !!bug;
  const initMetaFields = (proj) => {
    if (!Array.isArray(proj?.sheetHeaders) || proj.sheetHeaders.length === 0) return {};
    return Object.fromEntries(
      proj.sheetHeaders
        .filter(h => !AUTO_SKIP_HEADERS.has(h) && !SHEET_FORM_FIELD_MAP.hasOwnProperty(h))
        .map(h => [h, getMetadataValue(bug?.description, h)])
    );
  };
  const initialProject = bug ? projects.find(p => p.id === bug.projectId) : (currentProject || projects[0]);
  const [form, setForm] = useState({ title:bug?.title||'', description:extractFreeDescription(bug?.description), projectId:bug?.projectId||currentProject?.id||projects[0]?.id||'', type:bug?.type||'Bug', priority:bug?.priority||'P2', status:bug?.status||'To Do', assigneeId:bug?.assigneeId||'', labels:bug?.labels?.join(', ')||'', attachments:bug?.attachments||[], referenceLink:bug?.referenceLink||'', curlCommand:bug?.curlCommand||'', customFields:bug?.customFields||{}, _metaFields:initMetaFields(initialProject), _application:getMetadataValue(bug?.description,'Application'), _os:getMetadataValue(bug?.description,'Operating System'), _browser:getMetadataValue(bug?.description,'Browser'), _environment:getMetadataValue(bug?.description,'Environment'), _retailType:getMetadataValue(bug?.description,'Retail Type'), _locationType:getMetadataValue(bug?.description,'Location Type'), _module:getMetadataValue(bug?.description,'Module'), _feature:getMetadataValue(bug?.description,'Feature'), _devComments:getMetadataValue(bug?.description,'Developer Comments'), _qaComments:getMetadataValue(bug?.description,'QA Comments'), _sprint:getMetadataValue(bug?.description,'Sprint') });
  const [projectPermissions, setProjectPermissions] = useState(new Set());
  const [showCurl, setShowCurl] = useState(!!bug?.curlCommand);
  const selectedProject = projects.find(project => project.id === form.projectId) || null;
  const activeCustomFields = isCompactSheetProject(selectedProject) ? getProjectCustomFields(selectedProject) : [];
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const setMeta=(k,v)=>setForm(f=>({...f,_metaFields:{...(f._metaFields||{}),[k]:v}}));
  // When project changes, re-init _metaFields for the new project's headers (create flow only)
  useEffect(() => {
    if (editing) return;
    const proj = projects.find(p => p.id === form.projectId);
    setForm(f => ({...f, _metaFields: initMetaFields(proj)}));
  }, [form.projectId]);
  useEffect(()=>{
    if (!form.projectId) { setProjectPermissions(new Set()); return; }
    api.get(`/api/rbac/me/permissions?projectId=${form.projectId}`)
      .then(res => setProjectPermissions(new Set(res.permissions || [])))
      .catch(() => setProjectPermissions(new Set()));
  },[form.projectId]);
  const handleSubmit = async e => {
    e.preventDefault(); if (!form.title.trim()) return;
    const missingRequiredField = activeCustomFields.find(field => field.required && !String(form.customFields?.[field.id] || '').trim());
    if (missingRequiredField) { toast(`${missingRequiredField.label} is required`, 'error'); return; }
    const finalDescription = !isCompactSheetProject(selectedProject)
      ? buildLegacyDescription(form.description, { 'Application':form._application, 'Operating System':form._os, 'Browser':form._browser, 'Environment':form._environment, 'Retail Type':form._retailType, 'Location Type':form._locationType, 'Module':form._module, 'Feature':form._feature, 'Developer Comments':form._devComments, 'QA Comments':form._qaComments, 'Sprint':form._sprint, ...(form._metaFields||{}) })
      : form.description;
    const payload={...form, description:finalDescription, labels:form.labels?form.labels.split(',').map(l=>l.trim()).filter(Boolean):[], referenceLink:(form.referenceLink||'').trim(), curlCommand:(form.curlCommand||'').trim()};
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
          {(() => {
            const sheetFields = getSheetFormFields(selectedProject, isCompactSheetProject(selectedProject) ? activeCustomFields : undefined);
            const renderFieldInput = field => {
              if (field.type === 'badge-select') return <BadgeSelect value={form[field.key]||''} onChange={v=>set(field.key,v)} options={field.options} badgeFn={field.badgeFn} iconFn={field.iconFn} />;
              if (field.type === 'user-select') return <><select className="form-select" value={form.assigneeId} onChange={e=>set('assigneeId',e.target.value)} disabled={!projectPermissions.has('ASSIGN_ISSUE')}><option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>{!projectPermissions.has('ASSIGN_ISSUE')&&<div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>You do not have permission to assign issues in this project.</div>}</>;
              if (field.type === 'select') return <select className="form-select" value={form[field.key]||''} onChange={e=>set(field.key,e.target.value)}>{(field.options||[]).map(o=><option key={o} value={o}>{o||`Select ${field.label}`}</option>)}</select>;
              if (field.type === 'textarea') return <textarea className="form-textarea" value={form[field.key]||''} onChange={e=>set(field.key,e.target.value)} placeholder={field.label} style={{minHeight:80}} />;
              if (field.type === 'meta-textarea') return <textarea className="form-textarea" value={form._metaFields?.[field.metaKey]||''} onChange={e=>setMeta(field.metaKey,e.target.value)} placeholder={field.label} style={{minHeight:80}} />;
              if (field.type === 'meta-text') return <input className="form-input" value={form._metaFields?.[field.metaKey]||''} onChange={e=>setMeta(field.metaKey,e.target.value)} placeholder={field.label} />;
              if (field.type === 'custom') return <CustomFieldInput field={field.field} value={form.customFields?.[field.field.id]||''} onChange={v=>set('customFields',{...(form.customFields||{}),[field.field.id]:v})} />;
              return <input className="form-input" value={form[field.key]||''} onChange={e=>set(field.key,e.target.value)} placeholder={field.label} />;
            };
            const rows = [];
            let i = 0;
            while (i < sheetFields.length) {
              const f = sheetFields[i], n = sheetFields[i+1];
              if (f.type === 'badge-select' && n?.type === 'badge-select') {
                rows.push(<div key={i} className="form-row"><div className="form-group"><label className="form-label">{f.label}</label>{renderFieldInput(f)}</div><div className="form-group"><label className="form-label">{n.label}</label>{renderFieldInput(n)}</div></div>);
                i += 2;
              } else {
                rows.push(<div key={i} className="form-group"><label className="form-label">{f.label}{f.required?' *':''}</label>{renderFieldInput(f)}</div>);
                i++;
              }
            }
            return (
              <>
                <div className="form-group"><label className="form-label">Project</label><select className="form-select" value={form.projectId} onChange={e=>set('projectId',e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div className="form-group"><label className="form-label">{isCompactSheetProject(selectedProject)?'Issue Title':'Issue Description'} *</label><input className="form-input" value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Brief description of the issue" required autoFocus /></div>
                <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Detailed description, steps to reproduce…" /></div>
                {rows}
              </>
            );
          })()}
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
  useEffect(()=>{
    let active = true;
    api.get(`/api/bugs/${bugId}`).then(data => {
      if (!active) return;
      if (data?.error || !data?.id) {
        toast(data?.error || 'Issue not found', 'error');
        onClose();
        return;
      }
      setBug(data);
    });
    return () => { active = false; };
  },[bugId]);
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
  const deleteIssue = async () => {
    const res = await api.delete(`/api/bugs/${bugId}`);
    if (res?.error) {
      toast(res.error, 'error');
      return;
    }
    onClose();
    if (onDelete) await onDelete(bugId);
    toast('Issue deleted', 'info');
  };
  const project=bug?projects.find(p=>p.id===bug.projectId):null;
  const assignee=bug?resolveIssueUser(bug,users,'assigneeId',['Assignee(s)','Assignee From Sheet']):null;
  const reporter=bug?resolveIssueUser(bug,users,'reporterId','Raised By'):null;
  if (!bug) return <Modal onClose={onClose}><div className="modal-body" style={{minHeight:200,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--muted)'}}>Loading…</div></Modal>;
  if (editing) return <BugModal bug={bug} projects={projects} users={users} currentUser={currentUser} onClose={()=>setEditing(false)} onSave={b=>{setBug(b);onUpdate(b);setEditing(false);}} toast={toast} />;
  return (
    <Modal onClose={onClose} large>
      <div className="modal-header" style={{marginBottom:0}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span className="issue-key">{bug.key||bug.id.slice(0,8)}</span><TypeBadge t={bug.type} /><PriorityBadge p={bug.priority} /></div>
          <h2 style={{fontSize:18,fontWeight:700}}>{bug.title}</h2>
        </div>
        <div style={{display:'flex',gap:6,marginLeft:16}}>
          <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>✏ Edit</button>
          <button className="btn btn-danger btn-sm" onClick={deleteIssue}>🗑 Delete</button>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="modal-body">
        <div className="detail-layout">
          <div className="detail-main">
            <div className="detail-section"><h4>Description</h4>{extractFreeDescription(bug.description)?<div className="detail-description">{extractFreeDescription(bug.description)}</div>:<div className="detail-description" style={{color:'var(--muted)',fontStyle:'italic'}}>No description provided.</div>}</div>
            {!isCompactSheetProject(project)&&(()=>{
              // Show textarea-type fields from the project's sheet headers if available
              const commentHeaders = (Array.isArray(project?.sheetHeaders) && project.sheetHeaders.length > 0)
                ? project.sheetHeaders.filter(h => /comment|notes|remark|step|feedback/i.test(h) && !AUTO_SKIP_HEADERS.has(h))
                : ['Dev Comments','QA Comments'];
              const metaKeyOf = h => { const m = SHEET_FORM_FIELD_MAP[h]; return m?.metaKey || (m?.key?.startsWith('_') ? h : h); };
              return commentHeaders.map(h => {
                const val = getMetadataValue(bug.description, metaKeyOf(h) === h ? h : metaKeyOf(h));
                return val ? <div key={h} className="detail-section"><h4>{h}</h4><div className="detail-description">{val}</div></div> : null;
              });
            })()}
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
              <div className="detail-field"><div className="detail-field-label">Issue Type</div><BadgeSelect value={bug.type||'Bug'} onChange={v=>updateField('type',v)} options={['Bug','Feature','Task','Improvement']} badgeFn={typeBadge} iconFn={typeIcon} /></div>
              <div className="detail-field"><div className="detail-field-label">Status</div><BadgeSelect value={bug.status||'To Do'} onChange={v=>updateField('status',v)} options={['To Do','In Progress','In Review','Done']} badgeFn={statusBadge} iconFn={statusIcon} /></div>
              <div className="detail-field"><div className="detail-field-label">Priority</div><BadgeSelect value={bug.priority||'P2'} onChange={v=>updateField('priority',v)} options={['P0','P1','P2','P3']} badgeFn={priorityBadge} iconFn={priorityIcon} /></div>
              <div className="detail-field"><div className="detail-field-label">Assignee</div><select className="form-select" value={bug.assigneeId||''} onChange={e=>updateField('assigneeId',e.target.value)} disabled={!projectPermissions.has('ASSIGN_ISSUE')}><option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>{!projectPermissions.has('ASSIGN_ISSUE')&&<div style={{fontSize:11,color:'var(--muted)',marginTop:6}}>You do not have permission to reassign this issue.</div>}</div>
              {!isCompactSheetProject(project)&&(()=>{
                // Use stored sheet headers if available; fall back to known fields
                const sidebarHeaders = (Array.isArray(project?.sheetHeaders) && project.sheetHeaders.length > 0)
                  ? project.sheetHeaders.filter(h => !AUTO_SKIP_HEADERS.has(h) && SHEET_FORM_FIELD_MAP[h] !== null && !['Issue Description','Issue Title','Issue Type','Status','Priority','Assignee','Dev Comments','QA Comments'].includes(h))
                  : [['Application','Application'],['OS - Operating System','Operating System'],['Browser','Browser'],['Environment','Environment'],['Retail Type','Retail Type'],['Location Type','Location Type'],['Module','Module'],['Feature','Feature'],['Sprint','Sprint']].map(([l])=>l);
                return sidebarHeaders.map(h => {
                  const mapped = SHEET_FORM_FIELD_MAP[h];
                  const metaKey = mapped?.metaKey || mapped?.key?.startsWith('_') ? (mapped.metaKey || h) : h;
                  const val = getMetadataValue(bug.description, metaKey);
                  return val ? <div key={h} className="detail-field"><div className="detail-field-label">{h}</div><div className="detail-field-value text-sm">{val}</div></div> : null;
                });
              })()}
              {isCompactSheetProject(project)&&getProjectCustomFields(project).map(field=><div key={field.id} className="detail-field"><div className="detail-field-label">{field.label}</div><div className="detail-field-value text-sm text-muted">{getCustomFieldValue(bug,field)||'—'}</div></div>)}
              <hr className="divider"/>
              <div className="detail-field"><div className="detail-field-label">Project</div><div className="detail-field-value" style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:10,height:10,borderRadius:'50%',background:project?.color}}/>{project?.name}</div></div>
              <div className="detail-field"><div className="detail-field-label">Reporter</div><div className="detail-field-value" style={{display:'flex',alignItems:'center',gap:6}}>{reporter?<><Avatar user={reporter} size="xs"/>{reporter.name}</>:'Unknown'}</div></div>
              <hr className="divider"/>
              <div className="detail-field"><div className="detail-field-label">Created</div><div className="detail-field-value text-sm text-muted">{formatIssueCreatedDate(bug)}</div></div>
              <div className="detail-field"><div className="detail-field-label">Last Status Change</div><div className="detail-field-value text-sm text-muted">{timeAgo(getIssueLastStatusChangeDate(bug))}</div></div>
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
        {[{label:'Total Issues',value:stats.total,sub:'across all statuses',color:'#6366f1'},{label:'Open Issues',value:stats.openCount,sub:'need attention',color:'#f59e0b'},{label:'Completed',value:stats.doneCount,sub:'marked as done',color:'#10b981'},{label:'P0',value:stats.byPriority.P0,sub:'critical priority',color:'#ef4444'}].map(card=>(
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
          <div className="table-scroll"><table className="bug-table"><thead><tr><th>Date Created</th><th>Issue Title</th>{!currentProject&&<th>Project Name</th>}<th>Raised By</th><th>Issue Type</th><th>Assignee</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>{recentBugs.map(bug=>{const assignee=resolveIssueUser(bug,users,'assigneeId',['Assignee(s)','Assignee From Sheet']);const reporter=resolveIssueUser(bug,users,'reporterId','Raised By');const project=projects.find(p=>p.id===bug.projectId);return(<tr key={`compact-${bug.id}`} onClick={()=>setSelectedBug(bug.id)}><td><span className="text-muted text-sm">{formatIssueCreatedDate(bug)}</span></td><td><span className="issue-title">{bug.title}</span></td>{!currentProject&&<td><span className="text-muted text-sm">{project?.name||'—'}</span></td>}<td>{reporter?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={reporter} size="xs"/><span style={{fontSize:12}}>{reporter.name}</span></div>:<span className="text-muted">—</span>}</td><td><TypeBadge t={bug.type}/></td><td>{assignee?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={assignee} size="xs"/><span style={{fontSize:12}}>{assignee.name}</span></div>:<span className="text-muted">—</span>}</td><td><PriorityBadge p={bug.priority}/></td><td><StatusBadge s={bug.status}/></td></tr>);})}</tbody></table></div>
        )}
      </div>
      {selectedBug&&<BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={()=>setSelectedBug(null)} toast={toast} onUpdate={async()=>{ const url=currentProject?`/api/stats?projectId=${currentProject.id}`:'/api/stats'; const bu=currentProject?`/api/bugs?projectId=${currentProject.id}`:'/api/bugs'; const [nextStats, nextBugs] = await Promise.all([api.get(url), api.get(bu)]); setStats(nextStats); setRecentBugs(nextBugs.slice(0,5)); }} onDelete={async(id)=>{ setRecentBugs(bs=>bs.filter(b=>b.id!==id)); setSelectedBug(null); const url=currentProject?`/api/stats?projectId=${currentProject.id}`:'/api/stats'; const bu=currentProject?`/api/bugs?projectId=${currentProject.id}`:'/api/bugs'; const [nextStats, nextBugs] = await Promise.all([api.get(url), api.get(bu)]); setStats(nextStats); setRecentBugs(nextBugs.slice(0,5)); }}/>}
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
              <div className="form-group"><label className="form-label">Priority</label><select className="form-select" value={exportFilters.priority} onChange={e=>setExportFilter('priority',e.target.value)}><option value="">All Priorities</option>{['P0','P1','P2','P3'].map(p=><option key={p} value={p}>{p}</option>)}</select></div>
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
        <select className="filter-select" value={filters.priority} onChange={e=>setFilter('priority',e.target.value)}><option value="">All Priorities</option>{['P0','P1','P2','P3'].map(p=><option key={p}>{p}</option>)}</select>
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
          <div className="table-scroll"><table className="bug-table"><thead><tr><th>Date Created</th><th>Issue Title</th>{!currentProject&&<th>Project Name</th>}<th>Raised By</th><th>Issue Type</th><th>Assignee</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>{bugs.map(bug=>{const assignee=resolveIssueUser(bug,users,'assigneeId',['Assignee(s)','Assignee From Sheet']);const reporter=resolveIssueUser(bug,users,'reporterId','Raised By');const project=projects.find(p=>p.id===bug.projectId);return(<tr key={`compact-${bug.id}`} onClick={()=>setSelectedBug(bug.id)}><td><span className="text-muted text-sm">{formatIssueCreatedDate(bug)}</span></td><td><span className="issue-title">{bug.title}</span></td>{!currentProject&&<td><span className="text-muted text-sm">{project?.name||'—'}</span></td>}<td>{reporter?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={reporter} size="xs"/><span style={{fontSize:12}}>{reporter.name}</span></div>:<span className="text-muted text-sm">Unknown</span>}</td><td><TypeBadge t={bug.type}/></td><td>{assignee?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={assignee} size="xs"/><span style={{fontSize:12}}>{assignee.name}</span></div>:<span className="text-muted text-sm">Unassigned</span>}</td><td><PriorityBadge p={bug.priority}/></td><td><StatusBadge s={bug.status}/></td></tr>);})}</tbody></table></div>
          <div className="table-scroll" style={{display:'none'}}><table className="bug-table"><thead><tr><th>Key</th><th>Title</th><th>Type</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Raised By</th><th>Project</th><th>Created</th></tr></thead>
          <tbody>{bugs.map(bug=>{const assignee=resolveIssueUser(bug,users,'assigneeId',['Assignee(s)','Assignee From Sheet']);const reporter=resolveIssueUser(bug,users,'reporterId','Raised By');const project=projects.find(p=>p.id===bug.projectId);const createdAt=getIssueCreatedDate(bug);return(<tr key={bug.id} onClick={()=>setSelectedBug(bug.id)}><td><span className="issue-key">{bug.key||bug.id.slice(0,8)}</span></td><td><span className="issue-title">{bug.title}</span></td><td><TypeBadge t={bug.type}/></td><td><StatusBadge s={bug.status}/></td><td><PriorityBadge p={bug.priority}/></td><td>{assignee?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={assignee} size="xs"/><span style={{fontSize:12}}>{assignee.name}</span></div>:<span className="text-muted text-sm">Unassigned</span>}</td><td>{reporter?<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={reporter} size="xs"/><span style={{fontSize:12}}>{reporter.name}</span></div>:<span className="text-muted text-sm">Unknown</span>}</td><td>{project&&<div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:8,height:8,borderRadius:'50%',background:project.color}}/><span style={{fontSize:12,color:'var(--muted)'}}>{project.name}</span></div>}</td><td><span className="text-muted text-sm">{createdAt?timeAgo(createdAt):'Unavailable'}</span></td></tr>);})}</tbody></table>
          </div>
        </div>
      )}
      {showCreate&&<BugModal projects={projects} users={users} currentProject={currentProject} currentUser={currentUser} onClose={()=>setShowCreate(false)} toast={toast} onSave={()=>{load();setShowCreate(false);}}/>}
      {selectedBug&&<BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={()=>setSelectedBug(null)} toast={toast} onUpdate={()=>load()} onDelete={id=>{setBugs(bs=>bs.filter(b=>b.id!==id));}}/>}
    </div>
  );
}

function Dashboard({ projects, users, currentProject, onSelectProject, currentUser, toast, onSyncComplete }) {
  const [stats, setStats] = useState(null);
  const [allBugs, setAllBugs] = useState([]);
  const [selectedBug, setSelectedBug] = useState(null);
  const [chartsReady, setChartsReady] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const projectOptions = [{ value:'', label:'All Projects' }, ...projects.map(project => ({ value: project.id, label: project.name }))];
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

  const refreshDashboardData = useCallback(async () => {
    const statsUrl = currentProject ? "/api/stats?projectId=" + currentProject.id : '/api/stats';
    const bugsUrl = currentProject ? "/api/bugs?projectId=" + currentProject.id : '/api/bugs';
    const [nextStats, nextBugs] = await Promise.all([api.get(statsUrl), api.get(bugsUrl)]);
    setStats(nextStats);
    setAllBugs(sortBugsByCreatedDateDesc(nextBugs));
    setPage(1);
  }, [currentProject]);

  useEffect(() => {
    refreshDashboardData();
  }, [refreshDashboardData]);

  useEffect(() => {
    let active = true;
    if (!stats || stats.error || !Array.isArray(stats.daily) || !stats.byStatus || !stats.byPriority) return;
    setChartsReady(false);
    ensureChartJsLoaded()
      .then((ChartLib) => {
        if (!active || !lineRef.current || !doughnutRef.current || !barRef.current) return;
        setChartsReady(true);
        if (lineChart.current) lineChart.current.destroy();
        lineChart.current = new ChartLib(lineRef.current, { type:'line', data:{ labels:stats.daily.map(d => d.label), datasets:[{ label:'Issues', data:stats.daily.map(d => d.count), borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.15)', tension:0.4, fill:true, pointBackgroundColor:'#6366f1', pointRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8' } }, y:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8', stepSize:1 } } } } });
        if (doughnutChart.current) doughnutChart.current.destroy();
        doughnutChart.current = new ChartLib(doughnutRef.current, { type:'doughnut', data:{ labels:Object.keys(stats.byStatus), datasets:[{ data:Object.values(stats.byStatus), backgroundColor:['#475569','#6366f1','#fbbf24','#10b981'], borderWidth:0, hoverOffset:6 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ color:'#94a3b8', boxWidth:12, font:{ size:11 } } } } } });
        if (barChart.current) barChart.current.destroy();
        barChart.current = new ChartLib(barRef.current, { type:'bar', data:{ labels:Object.keys(stats.byPriority), datasets:[{ label:'Issues', data:Object.values(stats.byPriority), backgroundColor:['#ef4444','#fb923c','#fbbf24','#94a3b8'], borderRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false }, ticks:{ color:'#94a3b8' } }, y:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8', stepSize:1 } } } } });
      })
      .catch(() => {
        if (active) setChartsReady(false);
      });
    return () => {
      active = false;
      if (lineChart.current) lineChart.current.destroy();
      if (doughnutChart.current) doughnutChart.current.destroy();
      if (barChart.current) barChart.current.destroy();
    };
  }, [stats]);

  if (!stats) return <div style={{color:'var(--muted)',padding:40,textAlign:'center'}}>Loading dashboard...</div>;
  if (stats.error) {
    return (
      <div className="empty-state">
        <div className="icon">??</div>
        <h3>Dashboard Unavailable</h3>
        <p>{stats.error}</p>
      </div>
    );
  }

  const homepageBugs = sortBugsByCreatedDateDesc(allBugs);
  const totalPages = Math.max(1, Math.ceil(homepageBugs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedBugs = homepageBugs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      <div className="page-header">
        <div><h1>Dashboard</h1><p>{currentProject ? currentProject.name : 'All Projects'} ? Overview</p></div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <SearchableSelect
            value={currentProject?.id || ''}
            onChange={value => onSelectProject?.(value || null)}
            options={projectOptions}
            placeholder="All Projects"
            width={220}
          />
          <button className="btn btn-ghost" onClick={openExportModal}>Export Report</button>
        </div>
      </div>
      <div className="stats-grid">
        {[{label:'Total Issues',value:stats.total,sub:'across all statuses',color:'#6366f1'},{label:'Open Issues',value:stats.openCount,sub:'need attention',color:'#f59e0b'},{label:'Completed',value:stats.doneCount,sub:'marked as done',color:'#10b981'},{label:'P0',value:stats.byPriority.P0,sub:'critical priority',color:'#ef4444'}].map(card => (
          <div key={card.label} className="stat-card"><div className="label">{card.label}</div><div className="value" style={{color:card.color}}>{card.value}</div><div className="sub">{card.sub}</div></div>
        ))}
      </div>
      <div className="charts-grid">
        <div className="chart-card"><h3>Issues Created (Last 7 Days)</h3><div className="chart-wrap">{!chartsReady && <div style={{color:'var(--muted)',fontSize:12,padding:'24px 0',textAlign:'center'}}>Loading chart...</div>}<canvas ref={lineRef} style={{display:chartsReady?'block':'none'}} /></div></div>
        <div className="chart-card"><h3>By Status</h3><div className="chart-wrap">{!chartsReady && <div style={{color:'var(--muted)',fontSize:12,padding:'24px 0',textAlign:'center'}}>Loading chart...</div>}<canvas ref={doughnutRef} style={{display:chartsReady?'block':'none'}} /></div></div>
        <div className="chart-card"><h3>By Priority</h3><div className="chart-wrap">{!chartsReady && <div style={{color:'var(--muted)',fontSize:12,padding:'24px 0',textAlign:'center'}}>Loading chart...</div>}<canvas ref={barRef} style={{display:chartsReady?'block':'none'}} /></div></div>
      </div>
      <div className="table-card" style={{padding:20}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:12,marginBottom:16}}>
          <h3 style={{fontSize:13,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em',margin:0}}>Issues</h3>
          <SyncTimestamp toast={toast} onSyncComplete={onSyncComplete} />
        </div>
        {homepageBugs.length === 0
          ? <div style={{color:'var(--muted)',fontSize:13,padding:'16px 0',textAlign:'center'}}>No issues found.</div>
          : <>
              <IssueTable bugs={paginatedBugs} users={users} projects={projects} currentProject={currentProject} onSelectBug={setSelectedBug} />
              {totalPages > 1 && (
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'16px 0 0',flexWrap:'wrap'}}>
                  <div style={{fontSize:12,color:'var(--muted)'}}>Showing {(currentPage-1)*pageSize+1}?{Math.min(currentPage*pageSize,homepageBugs.length)} of {homepageBugs.length}</div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <button className="btn btn-ghost btn-sm" disabled={currentPage===1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button>
                    <span style={{fontSize:12,color:'var(--muted)'}}>Page {currentPage} of {totalPages}</span>
                    <button className="btn btn-ghost btn-sm" disabled={currentPage===totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next</button>
                  </div>
                </div>
              )}
            </>
        }
      </div>
      {selectedBug && <BugDetail bugId={selectedBug} initialBug={homepageBugs.find(b=>b.id===selectedBug)||null} projects={projects} users={users} currentUser={currentUser} onClose={() => setSelectedBug(null)} toast={toast} onUpdate={refreshDashboardData} onDelete={async (id) => { setAllBugs(bs => bs.filter(b => b.id !== id)); setSelectedBug(null); await refreshDashboardData(); }} />}
      <ExportReportFiltersModal visible={showExportFilters} onClose={closeExportModal} currentProject={currentProject} projects={projects} users={users} exportFilters={exportFilters} setExportFilter={setExportFilter} onReset={resetExportFilters} onExport={exportReport} />
    </div>
  );
}

function SheetViewIssueTable({ bugs, users, project, onSelectBug, emptyText='No issues found.' }) {
  const columns = getSheetViewColumns(project);
  if (!bugs.length) return <div className="text-muted text-sm">{emptyText}</div>;
  return (
    <div className="table-scroll">
      <table className="bug-table">
        <thead>
          <tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {bugs.map(bug => {
            const assignee = resolveIssueUser(bug, users, 'assigneeId', ['Assignee(s)', 'Assignee From Sheet']);
            const reporter = resolveIssueUser(bug, users, 'reporterId', 'Raised By');
            return (
              <tr key={`sheet-${bug.id}`} onClick={() => onSelectBug(bug.id)}>
                {columns.map(column => {
                  if (column.key === 'createdAt') return <td key={column.key}><span className="text-muted text-sm">{formatIssueCreatedDate(bug)}</span></td>;
                  if (column.key === 'title') return <td key={column.key}><span className="issue-title">{bug.title}</span></td>;
                  if (column.key === 'reporter') return <td key={column.key}>{reporter?.name || 'Unknown'}</td>;
                  if (column.key === 'type') return <td key={column.key}><TypeBadge t={bug.type} /></td>;
                  if (column.key === 'assignee') return <td key={column.key}>{assignee?.name || 'Unassigned'}</td>;
                  if (column.key === 'priority') return <td key={column.key}><PriorityBadge p={bug.priority} /></td>;
                  if (column.key === 'status') return <td key={column.key}><StatusBadge s={bug.status} /></td>;
                  return <td key={column.key}><span className="text-muted text-sm">{getCustomFieldValue(bug, column.field) || '—'}</span></td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CustomFieldInput({ field, value, onChange }) {
  if (field.type === 'textarea') {
    return <textarea className="form-textarea" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={field.label} style={{minHeight:100}} />;
  }
  if (field.type === 'date') {
    return <input className="form-input" type="date" value={value || ''} onChange={e => onChange(e.target.value)} />;
  }
  if (field.type === 'select') {
    const opts = field.options || [];
    const selectedOpt = opts.find(o => o.label === (value || ''));
    const bg = selectedOpt?.color || '';
    const fg = bg ? '#ffffff' : '';
    return (
      <select className="form-select" value={value || ''} onChange={e => onChange(e.target.value)} style={bg ? { background:bg, color:fg, fontWeight:600, borderColor:`${bg}88` } : {}}>
        <option value="">Select {field.label}</option>
        {opts.map(option => <option key={option.id || option.label} value={option.label}>{option.label}</option>)}
      </select>
    );
  }
  return <input className="form-input" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={field.label} />;
}

function CustomFieldSchemaEditor({ fields, setFields, disabled }) {
  const addField = () => setFields(current => [...current, { id: normalizeCustomFieldId(`field_${current.length + 1}`), label:'', type:'text', required:false, options:[] }]);
  const updateField = (index, patch) => setFields(current => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  const removeField = index => setFields(current => current.filter((_, fieldIndex) => fieldIndex !== index));
  const moveField = (fromIndex, toIndex) => setFields(current => {
    if (toIndex < 0 || toIndex >= current.length) return current;
    const next = [...current];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
  });
  const updateOption = (fieldIndex, optionIndex, patch) => setFields(current => current.map((field, currentFieldIndex) => {
    if (currentFieldIndex !== fieldIndex) return field;
    const options = [...(field.options || [])];
    options[optionIndex] = { ...options[optionIndex], ...patch };
    return { ...field, options };
  }));
  const addOption = fieldIndex => setFields(current => current.map((field, currentFieldIndex) => currentFieldIndex === fieldIndex ? { ...field, options:[...(field.options || []), { id: normalizeCustomFieldId(`${field.label || 'option'}_${Date.now()}`), label:'', color:'#94a3b8' }] } : field));
  const removeOption = (fieldIndex, optionIndex) => setFields(current => current.map((field, currentFieldIndex) => currentFieldIndex === fieldIndex ? { ...field, options:(field.options || []).filter((_, currentOptionIndex) => currentOptionIndex !== optionIndex) } : field));

  return (
    <div style={{border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:14, background:'var(--surface2)', display:'grid', gap:12}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
        <div>
          <div style={{fontWeight:600, fontSize:13}}>Sheet Fields</div>
          <div style={{fontSize:12, color:'var(--muted)'}}>QA can add extra columns, set dropdown options, and reorder them for new projects.</div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={addField} disabled={disabled}>+ Add Field</button>
      </div>
      {fields.length === 0 && <div className="text-muted text-sm">No extra fields yet. Default sheet columns will still be used.</div>}
      {fields.map((field, index) => (
        <div key={field.id || index} draggable={!disabled} onDragStart={e => e.dataTransfer.setData('text/plain', String(index))} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const fromIndex = Number(e.dataTransfer.getData('text/plain')); if (Number.isFinite(fromIndex)) moveField(fromIndex, index); }} style={{border:'1px solid var(--border)', borderRadius:12, padding:12, background:'var(--surface)', display:'grid', gap:10}}>
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <span style={{fontSize:12, color:'var(--muted)', cursor:'grab'}}>Drag</span>
            <input className="form-input" value={field.label || ''} onChange={e => updateField(index, { label:e.target.value, id: field.id || normalizeCustomFieldId(e.target.value) })} placeholder="Field label" disabled={disabled} style={{flex:'1 1 240px'}} />
            <select className="form-select" value={field.type || 'text'} onChange={e => updateField(index, { type:e.target.value, options:e.target.value === 'select' ? (field.options || []) : [] })} disabled={disabled} style={{maxWidth:180}}>
              {CUSTOM_FIELD_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--muted)'}}><input type="checkbox" checked={Boolean(field.required)} onChange={e => updateField(index, { required:e.target.checked })} disabled={disabled} /> Required</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveField(index, index - 1)} disabled={disabled || index === 0}>Up</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveField(index, index + 1)} disabled={disabled || index === fields.length - 1}>Down</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeField(index)} disabled={disabled}>Remove</button>
          </div>
          {field.type === 'select' && (
            <div style={{display:'grid', gap:8}}>
              {(field.options || []).map((option, optionIndex) => (
                <div key={option.id || optionIndex} style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                  <input className="form-input" value={option.label || ''} onChange={e => updateOption(index, optionIndex, { label:e.target.value })} placeholder="Option label" disabled={disabled} style={{flex:'1 1 220px'}} />
                  <input type="color" value={option.color || '#94a3b8'} onChange={e => updateOption(index, optionIndex, { color:e.target.value })} disabled={disabled} style={{width:42, height:42, border:'1px solid var(--border)', borderRadius:10, background:'transparent'}} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeOption(index, optionIndex)} disabled={disabled}>Remove Option</button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addOption(index)} disabled={disabled}>+ Add Option</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BugList({ projects, setProjects, users, currentProject, toast, currentUser, onSyncComplete }) {
  const [bugs, setBugs] = useState([]);
  const [filters, setFilters] = useState({ status:'', priority:'', type:'', assigneeId:'', search:'' });
  const [showCreate, setShowCreate] = useState(false);
  const [selectedBug, setSelectedBug] = useState(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [metricsStats, setMetricsStats] = useState(null);
  const [metricsChartsReady, setMetricsChartsReady] = useState(false);
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState('normal');
  const statusOptions = ['To Do','In Progress','In Review','Done'].map(value => ({ value, label: value }));
  const priorityOptions = ['P0','P1','P2','P3'].map(value => ({ value, label: value }));
  const typeOptions = ['Bug','Feature','Task','Improvement'].map(value => ({ value, label: value }));
  const assigneeOptions = users.map(user => ({ value: user.id, label: user.name }));
  const pageSize = 20;
  const metricsLineRef = useRef(null), metricsDoughnutRef = useRef(null), metricsBarRef = useRef(null);
  const metricsLineChart = useRef(null), metricsDoughnutChart = useRef(null), metricsBarChart = useRef(null);
  const { showExportFilters, exportFilters, setExportFilter, openExportModal, closeExportModal, resetExportFilters, exportReport } = useProjectReportExport({ currentProject, projects, users, toast });
  useEffect(() => { if (!currentProject || !isCompactSheetProject(currentProject)) setViewMode('normal'); }, [currentProject?.id, currentProject?.sheetLayoutVersion]);
  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (currentProject) params.set('projectId', currentProject.id);
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    api.get(`/api/bugs?${params}`).then(setBugs);
  }, [currentProject, filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [currentProject, filters.status, filters.priority, filters.type, filters.assigneeId, filters.search]);
  useEffect(() => {
    if (!showMetrics) return;
    const statsUrl = currentProject ? `/api/stats?projectId=${currentProject.id}` : '/api/stats';
    api.get(statsUrl).then(setMetricsStats);
  }, [showMetrics, currentProject]);
  useEffect(() => {
    let active = true;
    if (!showMetrics || !metricsStats || metricsStats.error || !Array.isArray(metricsStats.daily) || !metricsStats.byStatus || !metricsStats.byPriority) return;
    setMetricsChartsReady(false);
    ensureChartJsLoaded()
      .then((ChartLib) => {
        if (!active || !metricsLineRef.current || !metricsDoughnutRef.current || !metricsBarRef.current) return;
        setMetricsChartsReady(true);
        if (metricsLineChart.current) metricsLineChart.current.destroy();
        metricsLineChart.current = new ChartLib(metricsLineRef.current, { type:'line', data:{ labels:metricsStats.daily.map(d => d.label), datasets:[{ label:'Issues', data:metricsStats.daily.map(d => d.count), borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.15)', tension:0.4, fill:true, pointBackgroundColor:'#6366f1', pointRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8' } }, y:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8', stepSize:1 } } } } });
        if (metricsDoughnutChart.current) metricsDoughnutChart.current.destroy();
        metricsDoughnutChart.current = new ChartLib(metricsDoughnutRef.current, { type:'doughnut', data:{ labels:Object.keys(metricsStats.byStatus), datasets:[{ data:Object.values(metricsStats.byStatus), backgroundColor:['#475569','#6366f1','#fbbf24','#10b981'], borderWidth:0, hoverOffset:6 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ color:'#94a3b8', boxWidth:12, font:{ size:11 } } } } } });
        if (metricsBarChart.current) metricsBarChart.current.destroy();
        metricsBarChart.current = new ChartLib(metricsBarRef.current, { type:'bar', data:{ labels:Object.keys(metricsStats.byPriority), datasets:[{ label:'Issues', data:Object.values(metricsStats.byPriority), backgroundColor:['#ef4444','#fb923c','#fbbf24','#94a3b8'], borderRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false }, ticks:{ color:'#94a3b8' } }, y:{ grid:{ color:'#334155' }, ticks:{ color:'#94a3b8', stepSize:1 } } } } });
      })
      .catch(() => {
        if (active) setMetricsChartsReady(false);
      });
    return () => {
      active = false;
      if (metricsLineChart.current) metricsLineChart.current.destroy();
      if (metricsDoughnutChart.current) metricsDoughnutChart.current.destroy();
      if (metricsBarChart.current) metricsBarChart.current.destroy();
    };
  }, [showMetrics, metricsStats]);
  const setFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  const totalPages = Math.max(1, Math.ceil(bugs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedBugs = bugs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      <div className="page-header"><div><h1>Issue List</h1><p>{currentProject ? currentProject.name : 'All Projects'} - {bugs.length} issue{bugs.length!==1?'s':''}</p></div><div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{currentProject && isCompactSheetProject(currentProject) && <div style={{display:'flex',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}><button className="btn btn-ghost btn-sm" style={{borderRadius:0, background:viewMode==='normal'?'var(--surface2)':'transparent'}} onClick={() => setViewMode('normal')}>Normal View</button><button className="btn btn-ghost btn-sm" style={{borderRadius:0, background:viewMode==='sheet'?'var(--surface2)':'transparent'}} onClick={() => setViewMode('sheet')}>Sheet View</button></div>}<button className="btn btn-ghost" onClick={() => setShowMetrics(v => !v)}>{showMetrics ? 'Hide Metrics' : 'Show Metrics'}</button><button className="btn btn-ghost" onClick={openExportModal}>Export Report</button><button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Issue</button></div></div>
      <div className="filters-bar">
        <div style={{position:'relative'}}><span className="search-icon">🔍</span><input style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'7px 12px 7px 32px',color:'var(--text)',outline:'none',width:220}} placeholder="Search issues…" value={filters.search} onChange={e => setFilter('search', e.target.value)} /></div>
        <SearchableSelect value={filters.status} onChange={value => setFilter('status', value)} options={statusOptions} placeholder="All Statuses" width={150} />
        <SearchableSelect value={filters.priority} onChange={value => setFilter('priority', value)} options={priorityOptions} placeholder="All Priorities" width={150} />
        <SearchableSelect value={filters.type} onChange={value => setFilter('type', value)} options={typeOptions} placeholder="All Types" width={150} />
        <SearchableSelect value={filters.assigneeId} onChange={value => setFilter('assigneeId', value)} options={assigneeOptions} placeholder="All Assignees" width={230} />
        {Object.values(filters).some(Boolean) && <button className="btn btn-ghost btn-sm" onClick={() => { setFilters({ status:'', priority:'', type:'', assigneeId:'', search:'' }); setPage(1); }}>Clear ✕</button>}
      </div>
      {showMetrics && metricsStats && !metricsStats.error && (
        <>
          <div className="stats-grid" style={{marginBottom:20}}>
            {[{label:'Total Issues',value:metricsStats.total,sub:'across all statuses',color:'#6366f1'},{label:'Open Issues',value:metricsStats.openCount,sub:'need attention',color:'#f59e0b'},{label:'Completed',value:metricsStats.doneCount,sub:'marked as done',color:'#10b981'},{label:'P0',value:metricsStats.byPriority.P0,sub:'critical priority',color:'#ef4444'}].map(card => (
              <div key={card.label} className="stat-card"><div className="label">{card.label}</div><div className="value" style={{color:card.color}}>{card.value}</div><div className="sub">{card.sub}</div></div>
            ))}
          </div>
          <div className="charts-grid" style={{marginBottom:20}}>
            <div className="chart-card"><h3>Issues Created (Last 7 Days)</h3><div className="chart-wrap">{!metricsChartsReady && <div style={{color:'var(--muted)',fontSize:12,padding:'24px 0',textAlign:'center'}}>Loading chart...</div>}<canvas ref={metricsLineRef} style={{display:metricsChartsReady?'block':'none'}} /></div></div>
            <div className="chart-card"><h3>By Status</h3><div className="chart-wrap">{!metricsChartsReady && <div style={{color:'var(--muted)',fontSize:12,padding:'24px 0',textAlign:'center'}}>Loading chart...</div>}<canvas ref={metricsDoughnutRef} style={{display:metricsChartsReady?'block':'none'}} /></div></div>
            <div className="chart-card"><h3>By Priority</h3><div className="chart-wrap">{!metricsChartsReady && <div style={{color:'var(--muted)',fontSize:12,padding:'24px 0',textAlign:'center'}}>Loading chart...</div>}<canvas ref={metricsBarRef} style={{display:metricsChartsReady?'block':'none'}} /></div></div>
          </div>
        </>
      )}
      {showMetrics && metricsStats?.error && (
        <div className="empty-state" style={{marginBottom:20}}>
          <div className="icon">!</div>
          <h3>Metrics Unavailable</h3>
          <p>{metricsStats.error}</p>
        </div>
      )}
      {bugs.length===0 ? <div className="empty-state"><div className="icon">🎉</div><h3>No issues found</h3><p>Try adjusting your filters or create a new issue.</p></div> : (
        <div className="table-card">
          <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'16px 16px 0'}}>
            <div style={{fontSize:13,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>Recent Issues</div>
            <SyncTimestamp toast={toast} onSyncComplete={onSyncComplete} />
          </div>
          {viewMode === 'sheet' && currentProject && isCompactSheetProject(currentProject)
            ? <SheetViewIssueTable bugs={paginatedBugs} users={users} project={currentProject} onSelectBug={setSelectedBug} />
            : <IssueTable bugs={paginatedBugs} users={users} projects={projects} currentProject={currentProject} onSelectBug={setSelectedBug} />}
          {totalPages > 1 && (
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'0 16px 16px',flexWrap:'wrap'}}>
              <div style={{fontSize:12,color:'var(--muted)'}}>
                Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, bugs.length)} of {bugs.length}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <button className="btn btn-ghost btn-sm" disabled={currentPage===1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
                <span style={{fontSize:12,color:'var(--muted)'}}>Page {currentPage} of {totalPages}</span>
                <button className="btn btn-ghost btn-sm" disabled={currentPage===totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}
      {showCreate && <BugModal projects={projects} setProjects={setProjects} users={users} currentProject={currentProject} currentUser={currentUser} onClose={() => setShowCreate(false)} toast={toast} onSave={() => { load(); setShowCreate(false); }} />}
      {selectedBug && <BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={() => setSelectedBug(null)} toast={toast} onUpdate={() => load()} onDelete={async (id) => { setBugs(bs => bs.filter(b => b.id !== id)); setSelectedBug(null); await load(); }} />}
      <ExportReportFiltersModal visible={showExportFilters} onClose={closeExportModal} currentProject={currentProject} projects={projects} users={users} exportFilters={exportFilters} setExportFilter={setExportFilter} onReset={resetExportFilters} onExport={exportReport} />
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
      {showCreate&&<BugModal projects={projects} users={users} currentProject={currentProject} currentUser={currentUser} onClose={()=>setShowCreate(false)} toast={toast} onSave={()=>{load();setShowCreate(false);}}/>}
      {selectedBug&&<BugDetail bugId={selectedBug} projects={projects} users={users} currentUser={currentUser} onClose={()=>setSelectedBug(null)} toast={toast} onUpdate={b=>setBugs(bs=>bs.map(x=>x.id===b.id?b:x))} onDelete={id=>setBugs(bs=>bs.filter(b=>b.id!==id))}/>}
    </div>
  );
}

// ── ProjectsPage ──────────────────────────────────────────────────────────────
const BASE_SHEET_COLS = ['Date Created','Issue Title','Raised By','Issue Type','Assignee','Priority','Status'];

function ProjectModal({ onClose, onCreate }) {
  const [form, setForm] = useState({name:'',key:'',description:'',color:'#6366f1'});
  const [cols, setCols] = useState(() => BASE_SHEET_COLS.map(label => ({ label, isBase: true })));
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);

  const addCol = () => setCols(prev => [...prev, { label: '', isBase: false }]);
  const removeCol = idx => setCols(prev => prev.filter((_,i) => i !== idx));
  const updateCol = (idx, val) => setCols(prev => prev.map((c,i) => i === idx ? { ...c, label: val } : c));
  const moveCol = (from, to) => {
    if (from === to || to < 0 || to >= cols.length) return;
    setCols(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const create = async e => {
    e.preventDefault();
    if (!form.name || !form.key) return;
    const sheetHeaders = cols.map(c => c.label.trim()).filter(Boolean);
    const customIssueFields = cols
      .filter(c => !c.isBase && c.label.trim())
      .map(c => ({ id: normalizeCustomFieldId(c.label.trim()), label: c.label.trim(), type:'text', required:false, options:[] }));
    await onCreate({ ...form, customIssueFields, sheetHeaders });
    setForm({name:'',key:'',description:'',color:'#6366f1'});
    setCols(BASE_SHEET_COLS.map(label => ({ label, isBase: true })));
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-header"><h2 className="modal-title">New Project</h2><button className="btn-icon" onClick={onClose}>✕</button></div>
      <form onSubmit={create}>
        <div className="modal-body">
          <div className="form-group"><label className="form-label">Project Name *</label><input className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value,key:e.target.value.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,4)}))} required autoFocus/></div>
          <div className="form-group"><label className="form-label">Project Key *</label><input className="form-input" value={form.key} onChange={e=>setForm(f=>({...f,key:e.target.value.toUpperCase()}))} required maxLength={6}/></div>
          <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          <div className="form-group"><label className="form-label">Colour</label><div className="color-swatches">{COLORS.map(c=><div key={c} className={`swatch ${form.color===c?'selected':''}`} style={{background:c}} onClick={()=>setForm(f=>({...f,color:c}))}/>)}</div></div>
          <div className="form-group">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <label className="form-label" style={{margin:0}}>Sheet Columns</label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addCol}>+ Add Column</button>
            </div>
            <div style={{fontSize:11,color:'var(--muted)',marginBottom:8}}>Drag to reorder. Column order matches the sheet.</div>
            {cols.map((col,idx)=>(
              <div
                key={idx}
                draggable
                onDragStart={e=>{ e.dataTransfer.setData('text/plain', String(idx)); setDragIdx(idx); }}
                onDragOver={e=>{ e.preventDefault(); setDropIdx(idx); }}
                onDrop={e=>{ e.preventDefault(); moveCol(Number(e.dataTransfer.getData('text/plain')), idx); setDragIdx(null); setDropIdx(null); }}
                onDragEnd={()=>{ setDragIdx(null); setDropIdx(null); }}
                style={{display:'flex',gap:8,alignItems:'center',marginBottom:6,opacity:dragIdx===idx?0.4:1,borderTop:dropIdx===idx&&dragIdx!==idx?'2px solid var(--accent)':'2px solid transparent',paddingTop:2,transition:'border-color .1s'}}
              >
                <span style={{color:'var(--muted)',cursor:'grab',fontSize:16,lineHeight:1,userSelect:'none'}}>⠿</span>
                {col.isBase
                  ? <span style={{flex:1,fontSize:13,padding:'6px 10px',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)'}}>{col.label}</span>
                  : <input className="form-input" value={col.label} onChange={e=>updateCol(idx,e.target.value)} placeholder="Column header name" style={{flex:1}}/>
                }
                <button type="button" className="btn btn-ghost btn-sm" onClick={()=>removeCol(idx)} style={{flexShrink:0}}>✕</button>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary">Create Project</button></div>
      </form>
    </Modal>
  );
}

function ProjectsPage({ projects, setProjects, toast, onProjectCreated }) {
  const [showCreate,setShowCreate]=useState(false);
  const [projectToDelete,setProjectToDelete]=useState(null);
  const handleCreate=async form=>{const p=await api.post('/api/projects',form);setProjects(ps=>[...ps,p]);setShowCreate(false);onProjectCreated?.(p);toast('Project created','success');};
  const del=async project=>{await api.delete(`/api/projects/${project.id}`);setProjects(ps=>ps.filter(p=>p.id!==project.id));setProjectToDelete(null);toast('Project deleted','info');};
  return (
    <div>
      <div className="page-header"><div><h1>Projects</h1><p>{projects.length} project{projects.length!==1?'s':''}</p></div><button className="btn btn-primary" onClick={()=>setShowCreate(true)}>+ New Project</button></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))',gap:16}}>
        {projects.map(p=>(<div key={p.id} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20,borderTop:`3px solid ${p.color}`}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}><div style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:36,height:36,borderRadius:8,background:p.color,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'#fff',fontSize:14}}>{p.key}</div><div><div style={{fontWeight:600}}>{p.name}</div><div style={{fontSize:11,color:'var(--muted)'}}>{p.key}</div></div></div><button className="btn btn-danger btn-sm" onClick={()=>setProjectToDelete(p)}>Delete</button></div><div style={{fontSize:13,color:'var(--muted)',lineHeight:1.5}}>{p.description||'No description.'}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:10}}>Created {new Date(p.createdAt).toLocaleDateString()}</div></div>))}
      </div>
      {showCreate&&<ProjectModal onClose={()=>setShowCreate(false)} onCreate={handleCreate}/>}
      {projectToDelete&&(<Modal onClose={()=>setProjectToDelete(null)}><div className="modal-header"><h2 className="modal-title">Delete Project</h2><button className="btn-icon" onClick={()=>setProjectToDelete(null)}>✕</button></div><div className="modal-body"><p style={{fontSize:14,lineHeight:1.6,color:'var(--muted)'}}>Are you sure you want to delete <strong style={{color:'var(--text)'}}>{projectToDelete.name}</strong>? This will remove the project and its issues.</p></div><div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={()=>setProjectToDelete(null)}>Cancel</button><button type="button" className="btn btn-danger" onClick={()=>del(projectToDelete)}>Delete Project</button></div></Modal>)}
    </div>
  );
}

// ── MemberDashboard ───────────────────────────────────────────────────────────
function MemberDashboard({ member, bugs, projects, users, onBack, toast, currentUser }) {
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterProject,  setFilterProject]  = useState('');
  const [filterAssignedBy, setFilterAssignedBy] = useState('');
  const [selectedBug, setSelectedBug] = useState(null);
  const [localBugs, setLocalBugs] = useState(bugs);

  // keep in sync if parent bugs list changes
  useEffect(() => setLocalBugs(bugs), [bugs]);

  const memberBugs = localBugs.filter(b => b.assigneeId === member.id);

  // stats
  const total      = memberBugs.length;
  const done       = memberBugs.filter(b => b.status === 'Done').length;
  const inProgress = memberBugs.filter(b => b.status === 'In Progress').length;
  const inReview   = memberBugs.filter(b => b.status === 'In Review').length;
  const todo       = memberBugs.filter(b => b.status === 'To Do').length;
  const critical   = memberBugs.filter(b => b.priority === 'P0').length;
  const resolveRate = total > 0 ? Math.round((done / total) * 100) : 0;

  // unique assignedBy (reporter) options from this member's bugs
  const assignedByOptions = [...new Map(
    memberBugs
      .filter(b => b.reporterId)
      .map(b => {
        const u = users.find(u => u.id === b.reporterId);
        return [b.reporterId, u ? u.name : 'Unknown'];
      })
  ).entries()].map(([id, name]) => ({ id, name }));

  // filtered list
  const filtered = memberBugs.filter(b => {
    if (filterStatus    && b.status   !== filterStatus)    return false;
    if (filterPriority  && b.priority !== filterPriority)  return false;
    if (filterProject   && String(b.projectId) !== String(filterProject)) return false;
    if (filterAssignedBy && String(b.reporterId) !== String(filterAssignedBy)) return false;
    return true;
  });

  const activeFilters = [filterStatus, filterPriority, filterProject, filterAssignedBy].filter(Boolean).length;
  const clearFilters = () => { setFilterStatus(''); setFilterPriority(''); setFilterProject(''); setFilterAssignedBy(''); };
  const statusOptions = ['To Do','In Progress','In Review','Done'].map(value => ({ value, label: value }));
  const priorityOptions = ['P0','P1','P2','P3'].map(value => ({ value, label: value }));
  const projectOptions = projects
    .filter(project => memberBugs.some(b => b.projectId === project.id))
    .map(project => ({ value: project.id, label: project.name }));
  const assignedBySearchOptions = assignedByOptions.map(option => ({ value: option.id, label: option.name }));

  return (
    <div className="member-dashboard">
      {/* Back header */}
      <div className="member-dashboard-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back to Team</button>
        <div className="member-dashboard-identity">
          <div className="member-dashboard-avatar">
            {member.avatar && member.avatar.startsWith('data:image/')
              ? <img src={member.avatar} alt={member.name} style={{width:'100%',height:'100%',borderRadius:'50%',objectFit:'cover'}}/>
              : <span>{member.avatar || getInitials(member.name)}</span>}
          </div>
          <div>
            <h2 style={{fontSize:20,fontWeight:700,margin:0}}>{member.name}</h2>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4}}>
              <span style={{fontSize:12,color:'var(--muted)'}}>{member.email}</span>
              <span style={{fontSize:11,fontWeight:600,color:'#fff',background:ROLE_COLORS[member.role]||'#6366f1',padding:'2px 8px',borderRadius:99}}>
                {ROLE_LABELS[member.role]||member.role}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="member-stat-row">
        {[
          { label:'Total Assigned', value:total,      color:'var(--primary)' },
          { label:'To Do',          value:todo,        color:'var(--muted)'   },
          { label:'In Progress',    value:inProgress,  color:'var(--primary)' },
          { label:'In Review',      value:inReview,    color:'var(--warning)' },
          { label:'Resolved',       value:done,        color:'var(--success)' },
          { label:'P0',             value:critical,    color:'var(--danger)'  },
          { label:'Resolve Rate',   value:resolveRate+'%', color:'var(--success)' },
        ].map(s => (
          <div key={s.label} className="member-stat-card">
            <div style={{fontSize:22,fontWeight:700,color:s.color}}>{s.value}</div>
            <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="member-filters">
        <SearchableSelect value={filterStatus} onChange={setFilterStatus} options={statusOptions} placeholder="All Statuses" width={150} />
        <SearchableSelect value={filterPriority} onChange={setFilterPriority} options={priorityOptions} placeholder="All Priorities" width={160} />
        <SearchableSelect value={filterProject} onChange={setFilterProject} options={projectOptions} placeholder="All Projects" width={200} />
        <SearchableSelect value={filterAssignedBy} onChange={setFilterAssignedBy} options={assignedBySearchOptions} placeholder="Assigned By (all)" width={180} />
        {activeFilters > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>✕ Clear ({activeFilters})</button>
        )}
        <span style={{marginLeft:'auto',fontSize:12,color:'var(--muted)',alignSelf:'center'}}>
          {filtered.length} issue{filtered.length!==1?'s':''}
        </span>
      </div>

      {/* Issues table */}
      <div className="member-issue-table-wrap">
        {filtered.length === 0 ? (
          <div style={{textAlign:'center',padding:'40px 0',color:'var(--muted)',fontSize:14}}>No issues match the current filters.</div>
        ) : (
          <table className="bug-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Title</th>
                <th>Project</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Type</th>
                <th>Assigned By</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const proj = projects.find(p => p.id === b.projectId);
                const reporter = b.reporterId ? users.find(u => u.id === b.reporterId) : null;
                return (
                  <tr key={b.id} style={{cursor:'pointer'}} onClick={()=>setSelectedBug(b.id)}>
                    <td><span style={{fontFamily:'monospace',fontSize:12,color:'var(--muted)'}}>{b.key||`#${b.id}`}</span></td>
                    <td style={{maxWidth:280}}>
                      <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500}}>{b.title}</div>
                    </td>
                    <td>
                      {proj && (
                        <span style={{display:'flex',alignItems:'center',gap:5}}>
                          <span style={{width:8,height:8,borderRadius:'50%',background:proj.color,flexShrink:0}}/>
                          <span style={{fontSize:12}}>{proj.name}</span>
                        </span>
                      )}
                    </td>
                    <td><StatusBadge s={b.status}/></td>
                    <td><PriorityBadge p={b.priority}/></td>
                    <td><TypeBadge t={b.type}/></td>
                    <td>
                      {reporter ? (
                        <span style={{display:'flex',alignItems:'center',gap:6}}>
                          <Avatar user={reporter} size="xs"/>
                          <span style={{fontSize:12}}>{reporter.name}</span>
                        </span>
                      ) : <span style={{color:'var(--muted)',fontSize:12}}>—</span>}
                    </td>
                    <td style={{fontSize:12,color:'var(--muted)',whiteSpace:'nowrap'}}>{formatDate(b.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedBug && (
        <BugDetail
          bugId={selectedBug}
          projects={projects}
          users={users}
          onClose={()=>setSelectedBug(null)}
          onUpdate={updated => setLocalBugs(bs => bs.map(b => b.id === updated.id ? updated : b))}
          onDelete={id => { setLocalBugs(bs => bs.filter(b => b.id !== id)); setSelectedBug(null); }}
          toast={toast}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}

// ── TeamPage (multi-tenant, role-aware) ───────────────────────────────────────
function TeamPage({ users, setUsers, bugs, bugsLoading, setBugs, toast, currentUser, onCurrentUserUpdated, projects }) {
  const isAdmin = currentUser?.role === 'admin';
  const [selectedMember, setSelectedMember] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [reassignTarget, setReassignTarget] = useState(null);
  const [reassignToId, setReassignToId] = useState('');
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

  const reassignMemberIssues = async () => {
    if (!reassignTarget || !reassignToId) {
      toast('Select a member to move the issues to', 'error');
      return;
    }
    const res = await api.post(`/api/members/${reassignTarget.id}/reassign`, { targetUserId: reassignToId });
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
    if (setBugs) {
      setBugs(current => current.map(bug =>
        bug.assigneeId === reassignTarget.id
          ? { ...bug, assigneeId: reassignToId, updatedAt: new Date().toISOString() }
          : bug
      ));
    }
    setReassignTarget(null);
    setReassignToId('');
    toast(`${res.movedCount || 0} issue${res.movedCount === 1 ? '' : 's'} moved successfully`, 'success');
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

  const [search, setSearch] = useState('');

  const roleOrder = { admin:0, project_manager:1, developer:2, frontend_developer:3, backend_developer:4, tester:5, qa:5, viewer:6 };
  const sorted = [...users]
    .sort((a,b) => (roleOrder[a.role]||9) - (roleOrder[b.role]||9))
    .filter(u => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (ROLE_LABELS[u.role]||u.role).toLowerCase().includes(q);
    });
  const reassignOptions = users
    .filter(u => u.id !== reassignTarget?.id)
    .map(u => ({ value: u.id, label: `${u.name} (${ROLE_LABELS[u.role] || u.role})` }));

  return (
    <div>
      {bugsLoading && !selectedMember && (
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16,padding:'10px 12px',border:'1px solid var(--border)',borderRadius:12,background:'var(--surface)'}}>
          <span className="spinner" style={{width:14,height:14}} />
          <span style={{fontSize:13,color:'var(--muted)'}}>Loading team metrics...</span>
        </div>
      )}
      {selectedMember && (
        <MemberDashboard
          member={selectedMember}
          bugs={bugs}
          projects={projects||[]}
          users={users}
          onBack={()=>setSelectedMember(null)}
          toast={toast}
          currentUser={currentUser}
        />
      )}
      {!selectedMember && <>
      <div className="page-header">
        <div>
          <h1>Team Members</h1>
          <p>{users.length} member{users.length!==1?'s':''} · {users.filter(u=>u.role==='admin').length} admin · {users.filter(u=>u.role==='project_manager').length} project manager · {users.filter(u=>u.role==='developer').length} developer · {users.filter(u=>u.role==='frontend_developer').length} frontend · {users.filter(u=>u.role==='backend_developer').length} backend · {users.filter(u=>u.role==='tester' || u.role==='qa').length} QA · {users.filter(u=>u.role==='viewer').length} viewer</p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--muted)',fontSize:14,pointerEvents:'none'}}>🔍</span>
            <input
              type="text"
              placeholder="Search by name, email or role…"
              value={search}
              onChange={e=>setSearch(e.target.value)}
              style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'7px 12px 7px 32px',color:'var(--text)',width:240,outline:'none',fontSize:13}}
              onFocus={e=>e.target.style.borderColor='var(--primary)'}
              onBlur={e=>e.target.style.borderColor='var(--border)'}
            />
            {search && <button onClick={()=>setSearch('')} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:14,lineHeight:1}}>✕</button>}
          </div>
          {isAdmin && <button className="btn btn-primary" onClick={()=>setShowAdd(true)}>+ Add Member</button>}
        </div>
      </div>

      {search && <div style={{fontSize:13,color:'var(--muted)',marginBottom:4}}>{sorted.length} result{sorted.length!==1?'s':''} for "<strong>{search}</strong>"</div>}
      {sorted.length === 0 && (
        <div style={{textAlign:'center',padding:'48px 0',color:'var(--muted)',fontSize:14}}>
          No members match "<strong>{search}</strong>"
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))',gap:16}}>
        {sorted.map(u => {
          const assigned = bugs.filter(b => b.assigneeId === u.id);
          const done = assigned.filter(b => b.status === 'Done').length;
          const isSelf = u.id === currentUser?.id;
          return (
            <div key={u.id} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20,position:'relative',cursor:'pointer',transition:'border-color .15s,box-shadow .15s'}}
              onClick={e=>{ if(e.target.closest('select,button,input,label')) return; setSelectedMember(u); }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor='var(--primary)'; e.currentTarget.style.boxShadow='0 0 0 1px var(--primary)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.boxShadow='none'; }}>
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
                  <button className="btn btn-ghost btn-sm" style={{fontSize:11}} onClick={()=>{ setReassignTarget(u); setReassignToId(''); }}>Re-Assign</button>
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

      {reassignTarget && (
        <Modal onClose={() => { setReassignTarget(null); setReassignToId(''); }}>
          <div className="modal-header"><h2 className="modal-title">Re-Assign Issues</h2><button className="btn-icon" onClick={() => { setReassignTarget(null); setReassignToId(''); }}>✕</button></div>
          <div className="modal-body">
            <p style={{fontSize:13,color:'var(--muted)',marginBottom:16}}>Move all issues currently assigned to <strong>{reassignTarget.name}</strong> to another member in this organization.</p>
            <div className="form-group">
              <label className="form-label">Move Assigned Issues To</label>
              <SearchableSelect value={reassignToId} onChange={setReassignToId} options={reassignOptions} placeholder="Select member" width="100%" />
            </div>
            <div style={{background:'var(--surface2)',borderRadius:8,padding:'10px 14px',fontSize:12,color:'var(--muted)'}}>
              Only assigned issues will move. Reporter history and member profile details stay unchanged.
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => { setReassignTarget(null); setReassignToId(''); }}>Cancel</button>
            <button className="btn btn-primary" onClick={reassignMemberIssues} disabled={!reassignToId}>Re-Assign Issues</button>
          </div>
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
      </>}
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
    appsScriptUrl: org?.appsScriptUrl || '',
  });
  const [logoFile, setLogoFile] = useState(null);
  const [spreadsheetFile, setSpreadsheetFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [planSaving, setPlanSaving] = useState('');
  const [syncingSource, setSyncingSource] = useState(false);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);

  const addToSheet = async () => {
    setExportingSheet(true);
    try {
      if (org?.appsScriptUrl) {
        const res = await api.post('/api/sheet-push', {});
        if (res?.error) { toast(res.error, 'error'); return; }
        if (res?.nothing) { toast('No new issues to push — sheet is already up to date', 'info'); return; }
        toast('Issues pushed to Google Sheet', 'success');
      } else {
        const token = Token.get();
        const res = await fetch('/api/sheet-export', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) { const j = await res.json(); toast(j.error || 'Export failed', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cd = res.headers.get('Content-Disposition') || '';
        const match = cd.match(/filename="([^"]+)"/);
        a.download = match ? match[1] : 'issues.xlsx';
        a.click();
        URL.revokeObjectURL(url);
        toast('Sheet downloaded', 'success');
      }
    } finally {
      setExportingSheet(false);
    }
  };
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  useEffect(() => {
    setForm({
      name: org?.name||'',
      color: org?.color||'#6366f1',
      dataSourceType: org?.dataSourceType || '',
      dataSourceUrl: org?.dataSourceUrl || '',
      dataSourceSyncEnabled: Boolean(org?.dataSourceSyncEnabled),
      appsScriptUrl: org?.appsScriptUrl || '',
    });
  }, [org?.name, org?.color, org?.dataSourceType, org?.dataSourceUrl, org?.dataSourceSyncEnabled, org?.appsScriptUrl]);

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

  const copyAppsScriptSnippet = async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_SNIPPET);
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 2000);
      toast('Apps Script copied', 'success');
    } catch {
      toast('Unable to copy script', 'error');
    }
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
                <div style={{display:'flex',gap:8}}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={addToSheet}
                    disabled={exportingSheet}
                    title="Download all issues as a multi-tab XLSX file"
                  >
                    {exportingSheet ? 'Exporting…' : 'Add to Sheet'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={runSourceSync}
                    disabled={syncingSource || !org?.dataSourceType}
                  >
                    {syncingSource ? 'Syncing…' : 'Sync Now'}
                  </button>
                </div>
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
              <div style={{marginTop:24,paddingTop:20,borderTop:'1px solid var(--border)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:4,flexWrap:'wrap'}}>
                  <h3 style={{fontSize:14,fontWeight:600,margin:0}}>Google Sheet Write-back (Apps Script)</h3>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={copyAppsScriptSnippet}>
                    {scriptCopied ? '✓ Copied' : '📋 Copy Script'}
                  </button>
                </div>
                <p style={{fontSize:13,color:'var(--muted)',marginBottom:12,lineHeight:1.6}}>
                  Paste your Apps Script Web App URL to enable "Add to Sheet" to push issues directly into Google Sheets.
                  <br/>
                  <strong style={{color:'var(--text)'}}>Setup:</strong> In your Google Sheet → Extensions → Apps Script → paste the script below → Deploy → Web app → Execute as: Me, Access: Anyone → Copy the URL.
                </p>
                <pre style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:6,padding:'10px 14px',fontSize:11,overflow:'auto',marginBottom:12,lineHeight:1.7,maxHeight:220,whiteSpace:'pre'}}>{APPS_SCRIPT_SNIPPET}</pre>
                <div className="form-group">
                  <label className="form-label">Apps Script Web App URL</label>
                  <input
                    className="form-input"
                    value={form.appsScriptUrl}
                    onChange={e=>setF('appsScriptUrl', e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                  />
                  {form.appsScriptUrl && <div style={{fontSize:12,color:'var(--accent)',marginTop:6}}>✓ "Add to Sheet" will push directly to Google Sheets</div>}
                </div>
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
  const [loggingOut, setLoggingOut] = useState(false);
  const [view, setView]             = useState('dashboard');
  const [projects, setProjects]     = useState([]);
  const [users, setUsers]           = useState([]);
  const [allBugs, setAllBugs]       = useState([]);
  const [allBugsLoaded, setAllBugsLoaded] = useState(false);
  const [allBugsLoading, setAllBugsLoading] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [showSidebarProjectCreate, setShowSidebarProjectCreate] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectsLoading, setProjectsLoading] = useState(false);
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
        if (data.error) { Token.clear(); sessionStorage.removeItem('bt_root_redirecting'); setAuthChecked(true); }
        else {
          setAuthUser(data.user || data); setAuthOrg(data.org || null); setAuthChecked(true);
          sessionStorage.removeItem('bt_root_redirecting');
          document.title = 'FixPulse - Bug Tracker';
          if (window.location.pathname === '/login') window.history.replaceState({}, '', '/app');
        }
      })
      .catch(() => { Token.clear(); sessionStorage.removeItem('bt_root_redirecting'); setAuthChecked(true); });
  }, []);

  // ── Load app data after login ──
  useEffect(() => {
    if (!authUser) return;
    setProjectsLoading(true);
    Promise.all([api.get('/api/projects'), api.get('/api/members')])
      .then(([p, u]) => { setProjects(p); setUsers(u); })
      .finally(() => setProjectsLoading(false));
  }, [authUser]);

  useEffect(() => {
    if (!authUser || view !== 'team' || allBugsLoaded || allBugsLoading) return;
    setAllBugsLoading(true);
    api.get('/api/bugs')
      .then(b => {
        setAllBugs(Array.isArray(b) ? b : []);
        setAllBugsLoaded(true);
      })
      .finally(() => setAllBugsLoading(false));
  }, [authUser, view, allBugsLoaded, allBugsLoading]);

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

  const handleLogout = async () => {
    setLoggingOut(true);
    await api.post('/api/auth/logout', {});
    Token.clear();
    sessionStorage.removeItem('bt_root_redirecting');
    document.title = 'FixPulse - Login';
    window.location.replace('/login');
  };

  const currentProject = projects.find(p => p.id === currentProjectId) || null;
  const visibleProjects = projects.filter(project => project.name.toLowerCase().includes(projectSearch.toLowerCase()));
  const reloadData = () => {
    setProjectsLoading(true);
    Promise.all([api.get('/api/projects'), api.get('/api/members')])
      .then(([p, u]) => { setProjects(p); setUsers(u); })
      .finally(() => setProjectsLoading(false));
  };
  const handleProjectCreated = project => {
    setCurrentProjectId(project.id);
    setView('projects');
  };
  const handleDashboardProjectSelect = projectId => {
    setCurrentProjectId(projectId);
  };
  const navItems = [
    { id:'dashboard', label:'Dashboard', icon:'📊' },
    { id:'list',      label:'Issues',    icon:'🐛' },
    { id:'projects',  label:'Projects',  icon:'📁' },
    { id:'team',      label:'Team',      icon:'👥' },
    ...(authUser?.role==='admin' ? [
      { id:'roles',    label:'Roles',     icon:'🔐' },
      { id:'settings', label:'Settings',  icon:'⚙️' },
    ] : []),
  ];

  useEffect(() => {
    const closeMenu = () => setShowProfileMenu(false);
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, []);

  if (!authChecked || loggingOut) return null;

  if (!authUser) {
    if (window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
    return null;
  }

  return (
    <div className="app">
      <aside className="sidebar">
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
          {projectsLoading ? (
            <div style={{padding:'12px',color:'var(--muted)',fontSize:13,display:'flex',alignItems:'center',gap:10}}>
              <span className="btn-spinner" style={{width:16,height:16,borderWidth:2}}/>
              <span>Loading projects…</span>
            </div>
          ) : (
            <>
              <div style={{padding:'0 12px 10px'}}>
                <input
                  className="form-input"
                  value={projectSearch}
                  onChange={e=>setProjectSearch(e.target.value)}
                  placeholder="Search projects..."
                  style={{height:36, fontSize:13}}
                />
              </div>
              <div className={`sidebar-item ${!currentProjectId?'active':''}`} onClick={()=>setCurrentProjectId(null)}>
                <span style={{width:10,height:10,borderRadius:'50%',background:'var(--muted)',flexShrink:0}}/><span className="label">All Projects</span>
                <button className="btn-icon" style={{marginLeft:'auto',width:24,height:24,fontSize:14}} title="Create Project" onClick={e=>{e.stopPropagation();setShowSidebarProjectCreate(true);}}>+</button>
              </div>
              {visibleProjects.map(p => (
                <div key={p.id} className={`sidebar-item ${currentProjectId===p.id?'active':''}`} onClick={()=>{ setCurrentProjectId(p.id); setView('list'); }}>
                  <span style={{width:10,height:10,borderRadius:'50%',background:p.color,flexShrink:0}}/><span className="label">{p.name}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <span className="topbar-title">
            {navItems.find(n=>n.id===view)?.icon} {navItems.find(n=>n.id===view)?.label}
            {currentProject&&<span style={{color:'var(--muted)',fontWeight:400,marginLeft:6}}>/ {currentProject.name}</span>}
          </span>
          {(() => { const others = onlineUsers.filter(u => u.id !== authUser.id); return others.length > 0 && (
            <div className="online-members" title={`${others.length} online`}>
              {others.slice(0,5).map((u, i) => (
                <div key={u.id} className="online-member-avatar" style={{zIndex: others.length - i}} title={u.name}>
                  {u.avatar && u.avatar.startsWith('data:image/')
                    ? <img src={u.avatar} alt={u.name} style={{width:'100%',height:'100%',borderRadius:'50%',objectFit:'cover'}} />
                    : <span>{String(u.name || '?').trim().charAt(0).toUpperCase() || '?'}</span>}
                  <span className="online-dot"/>
                </div>
              ))}
              {others.length > 5 && (
                <div className="online-member-avatar online-member-overflow" style={{zIndex:0}}>+{others.length - 5}</div>
              )}
            </div>
          ); })()}
          <button className="theme-toggle" onClick={toggleTheme} title={theme==='dark'?'Switch to light mode':'Switch to dark mode'}>
            {theme==='dark' ? '☀️' : '🌙'}
          </button>
          <div style={{display:'flex',alignItems:'center',gap:10,position:'relative'}} onClick={e=>e.stopPropagation()}>
            <div style={{textAlign:'right',display:'flex',flexDirection:'column'}}>
              <span style={{fontSize:13,fontWeight:500}}>{authUser.name}</span>
              <span style={{fontSize:11,color:'var(--muted)'}}>{ROLE_LABELS[authUser.role]||authUser.role}</span>
            </div>
            <button className="btn-ghost" style={{padding:0,border:'none',background:'transparent',display:'flex',alignItems:'center',gap:8}} onClick={()=>setShowProfileMenu(v=>!v)}>
              <div style={{position:'relative',display:'inline-flex'}}>
                <Avatar user={authUser} />
                <span style={{position:'absolute',bottom:1,right:1,width:9,height:9,borderRadius:'50%',background:'#22c55e',border:'2px solid var(--surface)',boxSizing:'border-box',display:'block'}}/>
              </div>
              <span style={{fontSize:12,color:'var(--muted)'}}>▾</span>
            </button>
            {showProfileMenu && (
              <div style={{position:'absolute',top:'calc(100% + 8px)',right:0,width:220,background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',boxShadow:'var(--shadow)',padding:8,zIndex:50}}>
                <div style={{padding:'8px 10px',borderBottom:'1px solid var(--border)',marginBottom:6}}>
                  <div style={{fontWeight:600,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{authUser.name}</div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>{ROLE_LABELS[authUser.role]||authUser.role}</div>
                </div>
                <button style={{width:'100%',justifyContent:'flex-start',marginBottom:2,padding:'8px 10px',border:'none',background:'transparent',color:'var(--text)',fontSize:13,fontWeight:500,textAlign:'left',borderRadius:8,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'} onClick={()=>{setShowProfileMenu(false);setShowProfileSettings(true);}}>Profile Settings</button>
                <button style={{width:'100%',justifyContent:'flex-start',padding:'8px 10px',border:'none',background:'transparent',color:'var(--text)',fontSize:13,fontWeight:500,textAlign:'left',borderRadius:8,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'} onClick={handleLogout}>Log Out</button>
              </div>
            )}
          </div>
        </div>

        <div className="content">
          {view==='dashboard' && <Dashboard projects={projects} users={users} currentProject={currentProject} onSelectProject={handleDashboardProjectSelect} currentUser={authUser} toast={toast} onSyncComplete={reloadData}/>}
          {view==='list'      && <BugList projects={projects} setProjects={setProjects} users={users} currentProject={currentProject} toast={toast} currentUser={authUser} onSyncComplete={reloadData}/>}
          {view==='projects'  && <ProjectsPage projects={projects} setProjects={setProjects} toast={toast} onProjectCreated={handleProjectCreated}/>}
          {view==='team'      && <TeamPage users={users} setUsers={setUsers} bugs={allBugs} bugsLoading={allBugsLoading} setBugs={next => { setAllBugsLoaded(true); setAllBugs(next); }} projects={projects} toast={toast} currentUser={authUser} onCurrentUserUpdated={user=>setAuthUser(user)}/>}
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
