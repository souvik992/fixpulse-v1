'use strict';

const https        = require('https');
const path         = require('path');
const { Worker }   = require('worker_threads');
const db           = require('../db');

let xlsxLib = null;
function getXlsx() {
  if (!xlsxLib) xlsxLib = require('xlsx');
  return xlsxLib;
}

const LEGACY_SHEET_HEADERS = [
  'S.No',
  'Issue Description',
  'Status',
  'Priority',
  'Assignee',
  'Issue Type',
  'Module',
  'Feature',
  'Raised By',
  'Date',
  'Dev Comments',
  'QA Comments',
  'Sprint',
];

const COMPACT_SHEET_HEADERS = [
  'Date Created',
  'Issue Title',
  'Raised By',
  'Issue Type',
  'Assignee',
  'Priority',
  'Status',
];

function getSheetLayoutVersion(projectOrVersion) {
  if (typeof projectOrVersion === 'string') return projectOrVersion === 'compact_v2' ? 'compact_v2' : 'legacy';
  return projectOrVersion?.sheet_layout_version === 'compact_v2' ? 'compact_v2' : 'legacy';
}

function getSheetHeaders(projectOrVersion) {
  // Any project with explicit sheet_headers uses them — respects user-defined column order
  if (typeof projectOrVersion === 'object' && projectOrVersion !== null) {
    const stored = Array.isArray(projectOrVersion.sheet_headers)
      ? projectOrVersion.sheet_headers.filter(Boolean)
      : [];
    if (stored.length > 0) return stored;
  }
  if (getSheetLayoutVersion(projectOrVersion) !== 'compact_v2') {
    return LEGACY_SHEET_HEADERS;
  }
  const customFields = Array.isArray(projectOrVersion?.custom_issue_fields) ? projectOrVersion.custom_issue_fields : [];
  return [...COMPACT_SHEET_HEADERS, ...customFields.map((field) => String(field?.label || '').trim()).filter(Boolean)];
}

function getCustomFieldValueMap(bug) {
  return bug?.custom_fields && typeof bug.custom_fields === 'object' ? bug.custom_fields : {};
}

/**
 * Resolve a single sheet column header to its value for a bug row.
 * Handles all known column names case-insensitively, with fallback to
 * reading from the description metadata blob.
 */
function resolveColumnValue(header, bug, userMap, index, createdDate, customFieldsByLabel) {
  const hl = String(header || '').trim().toLowerCase();
  if (/^(s\.?no\.?|#|sr\.?\s*no\.?|serial\s*no\.?|no\.)$/.test(hl)) return String(index + 1);
  if (/^(date|date created|entry date|created date|logged date|open date)$/.test(hl)) return createdDate;
  if (/^(raised by|issue raised by|raised date|reporter)$/.test(hl)) return userMap.get(String(bug.reporter_id)) || getMetaValue(bug.description, 'Raised By') || '';
  if (/^assignee$/.test(hl)) return userMap.get(String(bug.assignee_id)) || '';
  if (/^(issue description|issue title|title|description of bug|description)$/.test(hl)) return bug.title || '';
  if (/^status$/.test(hl)) return bug.status || '';
  if (/^priority$/.test(hl)) return bug.priority || '';
  if (/^(issue type|bug type|type)$/.test(hl)) return bug.type || '';
  if (/^module$/.test(hl)) return getMetaValue(bug.description, 'Module') || '';
  if (/^feature$/.test(hl)) return getMetaValue(bug.description, 'Feature') || '';
  if (/^(dev comments?|developer comments?)$/.test(hl)) return getMetaValue(bug.description, 'Developer Comments') || getMetaValue(bug.description, 'Dev Comments') || '';
  if (/^(qa comments?|qa comment)$/.test(hl)) return getMetaValue(bug.description, 'QA Comments') || '';
  if (/^sprint$/.test(hl)) return getMetaValue(bug.description, 'Sprint') || '';
  if (/^(location type|location)$/.test(hl)) return getMetaValue(bug.description, 'Location Type') || getMetaValue(bug.description, 'Location') || getMetaValue(bug.description, header) || '';
  if (/^(retail type|domain retail restaurant|org type)$/.test(hl)) return getMetaValue(bug.description, 'Retail Type') || '';
  if (/^(environment|envirnoment)$/.test(hl)) return getMetaValue(bug.description, 'Environment') || '';
  if (/^browser$/.test(hl)) return getMetaValue(bug.description, 'Browser') || '';
  if (/^(os|os operating system|operating system)$/.test(hl)) return getMetaValue(bug.description, 'Operating System') || '';
  if (/^(application|product)$/.test(hl)) return getMetaValue(bug.description, 'Application') || '';
  // Custom fields: look up by label
  if (customFieldsByLabel) {
    const h = String(header).trim();
    if (customFieldsByLabel[h] !== undefined) return customFieldsByLabel[h];
  }
  // Fallback: look for header name in description metadata (exact then lowercase)
  return getMetaValue(bug.description, String(header).trim()) || getMetaValue(bug.description, hl) || '';
}

function buildSheetRow(bug, userMap, index, projectOrVersion) {
  const createdDate = bug.created_at ? new Date(bug.created_at).toLocaleDateString('en-GB') : '';

  // If explicit sheet_headers stored (user-defined column order), use for all project types
  const storedHeaders = Array.isArray(projectOrVersion?.sheet_headers)
    ? projectOrVersion.sheet_headers.filter(Boolean)
    : [];
  if (storedHeaders.length > 0) {
    const customFields = Array.isArray(projectOrVersion?.custom_issue_fields) ? projectOrVersion.custom_issue_fields : [];
    const customValues = getCustomFieldValueMap(bug);
    const customFieldsByLabel = Object.fromEntries(
      customFields.map(f => [String(f.label || '').trim(), customValues[f.id] || ''])
    );
    return storedHeaders.map(h => resolveColumnValue(h, bug, userMap, index, createdDate, customFieldsByLabel));
  }

  const layoutVersion = getSheetLayoutVersion(projectOrVersion);

  if (layoutVersion === 'compact_v2') {
    const customFields = Array.isArray(projectOrVersion?.custom_issue_fields) ? projectOrVersion.custom_issue_fields : [];
    const customValues = getCustomFieldValueMap(bug);
    const raisedBy = userMap.get(String(bug.reporter_id)) || getMetaValue(bug.description, 'Raised By');
    const assignee = userMap.get(String(bug.assignee_id)) || '';
    return [
      createdDate,
      bug.title || '',
      raisedBy,
      bug.type || '',
      assignee,
      bug.priority || '',
      bug.status || '',
      ...customFields.map((field) => customValues[field.id] || ''),
    ];
  }

  // Default legacy format (no sheet_headers stored)
  const raisedBy = userMap.get(String(bug.reporter_id)) || getMetaValue(bug.description, 'Raised By');
  const assignee = userMap.get(String(bug.assignee_id)) || '';
  return [
    index + 1,
    bug.title || '',
    bug.status || '',
    bug.priority || '',
    assignee,
    bug.type || '',
    getMetaValue(bug.description, 'Module'),
    getMetaValue(bug.description, 'Feature'),
    raisedBy,
    createdDate,
    getMetaValue(bug.description, 'Developer Comments'),
    getMetaValue(bug.description, 'QA Comments'),
    getMetaValue(bug.description, 'Sprint'),
  ];
}

function getMetaValue(description, label) {
  const prefix = `${label}:`;
  const line = String(description || '').split('\n').find(l => l.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function safeName(name) {
  // Excel sheet names: max 31 chars, no [ ] : * ? / \
  return String(name || 'Sheet').replace(/[\[\]:*?/\\]/g, '-').slice(0, 31);
}

function bufferToDataUrl(buffer) {
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString('base64')}`;
}

function decodeDataUrl(text) {
  const commaIdx = text.indexOf(',');
  const isBase64 = /;base64/i.test(text.slice(0, commaIdx));
  return Buffer.from(text.slice(commaIdx + 1), isBase64 ? 'base64' : 'utf8');
}

/**
 * When a project is created, add a new tab (with standard headers) to the
 * org's stored XLSX data source.  No-ops for Google Sheet / CSV sources.
 */
async function addProjectTabToSheet(orgId, projectName, sheetLayoutVersion = 'legacy') {
  try {
    const { rows } = await db.query(
      'SELECT data_source_type, data_source_file_data FROM organizations WHERE id=$1',
      [orgId]
    );
    const org = rows[0];
    if (!org || org.data_source_type !== 'xlsx' || !org.data_source_file_data) return;

    const XLSX = getXlsx();
    const buffer = decodeDataUrl(org.data_source_file_data);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const tabName = safeName(projectName);
    if (!workbook.SheetNames.includes(tabName)) {
      const ws = XLSX.utils.aoa_to_sheet([getSheetHeaders(sheetLayoutVersion)]);
      XLSX.utils.book_append_sheet(workbook, ws, tabName);
      const newBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      await db.query(
        'UPDATE organizations SET data_source_file_data=$1 WHERE id=$2',
        [bufferToDataUrl(newBuffer), orgId]
      );
    }
  } catch (_) {
    // Non-fatal — project creation must not fail if sheet update fails
  }
}

/**
 * Build a multi-tab XLSX buffer with all (or one) project's issues.
 *
 * Data is fetched on the main thread (I/O bound), then passed to a
 * dedicated worker_thread for the CPU-intensive XLSX build so the
 * event loop is never blocked during workbook generation.
 */
async function exportOrgToXlsxBuffer(orgId, projectId = null) {
  const projectQuery  = projectId
    ? 'SELECT id, name, sheet_layout_version, custom_issue_fields FROM projects WHERE org_id=$1 AND id=$2 ORDER BY name ASC'
    : 'SELECT id, name, sheet_layout_version, custom_issue_fields FROM projects WHERE org_id=$1 ORDER BY name ASC';
  const projectParams = projectId ? [orgId, projectId] : [orgId];

  const [{ rows: projects }, { rows: users }] = await Promise.all([
    db.query(projectQuery, projectParams),
    db.query('SELECT id, name FROM users WHERE org_id=$1', [orgId]),
  ]);

  // Plain object — safer to transfer to a worker than a Map
  const userMap = {};
  users.forEach(u => { userMap[String(u.id)] = u.name; });

  // Fetch bugs per project in parallel batches (avoids pool exhaustion on large orgs)
  const BATCH = 5;
  const projectsData = [];
  for (let i = 0; i < projects.length; i += BATCH) {
    const slice = projects.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(p =>
        db.query(
          // Select only columns needed — skips large attachment blobs
          `SELECT id, title, description, status, priority, type,
                  assignee_id, reporter_id, created_at, custom_fields
           FROM bugs WHERE org_id=$1 AND project_id=$2 ORDER BY created_at ASC`,
          [orgId, p.id]
        ).then(({ rows }) => ({
          projectName: safeName(p.name),
          bugs: rows,
          sheetLayoutVersion: getSheetLayoutVersion(p),
          customIssueFields: Array.isArray(p.custom_issue_fields) ? p.custom_issue_fields : [],
          sheetHeaders: Array.isArray(p.sheet_headers) ? p.sheet_headers.filter(Boolean) : [],
        }))
      )
    );
    projectsData.push(...results);
  }

  // Hand off to worker thread — XLSX.write is synchronous and CPU-heavy
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(__dirname, '../workers/xlsxBuild.js'),
      { workerData: { projects: projectsData, userMap, legacyHeaders: LEGACY_SHEET_HEADERS, compactHeaders: COMPACT_SHEET_HEADERS } }
    );
    worker.once('message', (msg) => {
      if (msg.ok) resolve(Buffer.from(msg.buffer));
      else reject(new Error(msg.error));
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`XLSX worker exited with code ${code}`));
    });
  });
}

// ── Apps Script push ─────────────────────────────────────────────────────────

function httpsPost(url, data, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return resolve(httpsPost(res.headers.location, data, redirectsLeft - 1));
      }
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({ ok: true }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Build the sheet payload and post it to the org's configured Apps Script URL.
 *
 * Incremental push:
 * only bugs where sheet_pushed_at IS NULL are sent so newly-added issues
 * get appended below the last existing issue row in each project tab.
 */
async function pushToAppsScript(orgId, appsScriptUrl, projectId = null) {
  const projectQuery = projectId
    ? 'SELECT * FROM projects WHERE org_id=$1 AND id=$2 ORDER BY name ASC'
    : 'SELECT * FROM projects WHERE org_id=$1 ORDER BY name ASC';
  const projectParams = projectId ? [orgId, projectId] : [orgId];

  const [{ rows: projects }, { rows: users }] = await Promise.all([
    db.query(projectQuery, projectParams),
    db.query('SELECT id, name FROM users WHERE org_id=$1', [orgId]),
  ]);

  const userMap = new Map(users.map(u => [String(u.id), u.name]));

  const sheets = [];
  const allPushedIds = [];

  for (const project of projects) {
    const { rows: bugs } = await db.query(
      'SELECT * FROM bugs WHERE org_id=$1 AND project_id=$2 AND sheet_pushed_at IS NULL ORDER BY created_at ASC',
      [orgId, project.id]
    );
    if (bugs.length === 0) continue;

    const { rows: countRows } = await db.query(
      'SELECT COUNT(*)::int AS count FROM bugs WHERE org_id=$1 AND project_id=$2 AND sheet_pushed_at IS NOT NULL',
      [orgId, project.id]
    );
    const startIndex = countRows[0]?.count || 0;

    const rows = bugs.map((bug, idx) => buildSheetRow(bug, userMap, startIndex + idx, project));
    sheets.push({ name: safeName(project.name), headers: getSheetHeaders(project), rows });
    bugs.forEach(b => allPushedIds.push(b.id));
  }

  if (sheets.length === 0) return { nothing: true };

  const developerOptions = users.map(u => u.name).filter(Boolean).sort();
  const result = await httpsPost(appsScriptUrl, { action: 'append', sheets, developerOptions });
  return { ...result, pushedIds: allPushedIds };
}

/**
 * Push a single empty tab (with headers) to Apps Script when a project is created.
 */
async function pushNewTabToAppsScript(appsScriptUrl, projectName, sheetLayoutVersion = 'legacy', customIssueFields = []) {
  return httpsPost(appsScriptUrl, {
    action: 'add_tab',
    sheets: [{ name: safeName(projectName), headers: getSheetHeaders({ sheet_layout_version: sheetLayoutVersion, custom_issue_fields: customIssueFields }), rows: [] }],
  });
}

module.exports = {
  addProjectTabToSheet,
  exportOrgToXlsxBuffer,
  pushToAppsScript,
  pushNewTabToAppsScript,
  getSheetLayoutVersion,
};
