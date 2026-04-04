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
 *
 * Data is fetched on the main thread (I/O bound), then passed to a
 * dedicated worker_thread for the CPU-intensive XLSX build so the
 * event loop is never blocked during workbook generation.
 */
async function exportOrgToXlsxBuffer(orgId, projectId = null) {
  const projectQuery  = projectId
    ? 'SELECT id, name FROM projects WHERE org_id=$1 AND id=$2 ORDER BY name ASC'
    : 'SELECT id, name FROM projects WHERE org_id=$1 ORDER BY name ASC';
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
                  assignee_id, reporter_id, created_at
           FROM bugs WHERE org_id=$1 AND project_id=$2 ORDER BY created_at ASC`,
          [orgId, p.id]
        ).then(({ rows }) => ({ projectName: safeName(p.name), bugs: rows }))
      )
    );
    projectsData.push(...results);
  }

  // Hand off to worker thread — XLSX.write is synchronous and CPU-heavy
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(__dirname, '../workers/xlsxBuild.js'),
      { workerData: { projects: projectsData, userMap, headers: SHEET_HEADERS } }
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

    const rows = bugs.map((bug, idx) => [
      startIndex + idx + 1,
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
    bugs.forEach(b => allPushedIds.push(b.id));
  }

  if (sheets.length === 0) return { nothing: true };

  const result = await httpsPost(appsScriptUrl, { action: 'append', sheets });
  return { ...result, pushedIds: allPushedIds };
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
