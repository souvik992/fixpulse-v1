'use strict';

const https = require('https');
const db = require('../db');

let xlsxLib = null;
function getXlsx() {
  if (!xlsxLib) xlsxLib = require('xlsx');
  return xlsxLib;
}

const SHEET_HEADERS = [
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
async function addProjectTabToSheet(orgId, projectName) {
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
      const ws = XLSX.utils.aoa_to_sheet([SHEET_HEADERS]);
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
 * Each project becomes a sheet tab; rows follow SHEET_HEADERS.
 */
async function exportOrgToXlsxBuffer(orgId, projectId = null) {
  const XLSX = getXlsx();

  const projectQuery = projectId
    ? 'SELECT * FROM projects WHERE org_id=$1 AND id=$2 ORDER BY name ASC'
    : 'SELECT * FROM projects WHERE org_id=$1 ORDER BY name ASC';
  const projectParams = projectId ? [orgId, projectId] : [orgId];

  const [{ rows: projects }, { rows: users }] = await Promise.all([
    db.query(projectQuery, projectParams),
    db.query('SELECT id, name FROM users WHERE org_id=$1', [orgId]),
  ]);

  const userMap = new Map(users.map(u => [String(u.id), u.name]));
  const workbook = XLSX.utils.book_new();

  for (const project of projects) {
    const { rows: bugs } = await db.query(
      'SELECT * FROM bugs WHERE org_id=$1 AND project_id=$2 ORDER BY created_at ASC',
      [orgId, project.id]
    );

    const rows = [SHEET_HEADERS];
    bugs.forEach((bug, idx) => {
      rows.push([
        idx + 1,
        bug.title || '',
        bug.status || '',
        bug.priority || '',
        userMap.get(String(bug.assignee_id)) || '',
        bug.type || '',
        getMetaValue(bug.description, 'Module'),
        getMetaValue(bug.description, 'Feature'),
        userMap.get(String(bug.reporter_id)) || getMetaValue(bug.description, 'Raised By'),
        bug.created_at ? new Date(bug.created_at).toLocaleDateString('en-GB') : '',
        getMetaValue(bug.description, 'Developer Comments'),
        getMetaValue(bug.description, 'QA Comments'),
        getMetaValue(bug.description, 'Sprint'),
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths
    ws['!cols'] = [
      { wch: 6 }, { wch: 60 }, { wch: 14 }, { wch: 12 },
      { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 20 },
      { wch: 20 }, { wch: 12 }, { wch: 30 }, { wch: 30 }, { wch: 14 },
    ];

    XLSX.utils.book_append_sheet(workbook, ws, safeName(project.name));
  }

  if (workbook.SheetNames.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([SHEET_HEADERS]);
    XLSX.utils.book_append_sheet(workbook, ws, 'Issues');
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
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
 * Build the sheets payload (same shape for both add_tab and push_all)
 * and post it to the org's configured Apps Script Web App URL.
 */
async function pushToAppsScript(orgId, appsScriptUrl, action = 'push_all', projectId = null) {
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
  for (const project of projects) {
    const { rows: bugs } = await db.query(
      'SELECT * FROM bugs WHERE org_id=$1 AND project_id=$2 ORDER BY created_at ASC',
      [orgId, project.id]
    );
    const rows = bugs.map((bug, idx) => [
      idx + 1,
      bug.title || '',
      bug.status || '',
      bug.priority || '',
      userMap.get(String(bug.assignee_id)) || '',
      bug.type || '',
      getMetaValue(bug.description, 'Module'),
      getMetaValue(bug.description, 'Feature'),
      userMap.get(String(bug.reporter_id)) || getMetaValue(bug.description, 'Raised By'),
      bug.created_at ? new Date(bug.created_at).toLocaleDateString('en-GB') : '',
      getMetaValue(bug.description, 'Developer Comments'),
      getMetaValue(bug.description, 'QA Comments'),
      getMetaValue(bug.description, 'Sprint'),
    ]);
    sheets.push({ name: safeName(project.name), headers: SHEET_HEADERS, rows });
  }

  return httpsPost(appsScriptUrl, { action, sheets });
}

/**
 * Push a single empty tab (with headers) to Apps Script when a project is created.
 */
async function pushNewTabToAppsScript(appsScriptUrl, projectName) {
  return httpsPost(appsScriptUrl, {
    action: 'add_tab',
    sheets: [{ name: safeName(projectName), headers: SHEET_HEADERS, rows: [] }],
  });
}

module.exports = { addProjectTabToSheet, exportOrgToXlsxBuffer, pushToAppsScript, pushNewTabToAppsScript };
