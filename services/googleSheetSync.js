require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('../db');

const SYNC_INTERVAL_MS = Math.max(Number(process.env.SHEET_SYNC_INTERVAL_MS || 3600000), 15000);
const ENABLED = String(process.env.SHEET_SYNC_ENABLED || 'true').toLowerCase() !== 'false';
const IGNORED_SHEETS = new Set(['Summary', 'Master']);
const LEGACY_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1a41W8XdllH-lzTBQmO4QCaRQMURAQb0Z7Z2EQjL2jXU';
const LEGACY_TARGET_ORG_NAME = process.env.GOOGLE_SHEET_TARGET_ORG || 'Twinleaves';

let syncTimer = null;
let syncInFlight = false;
let lastStatus = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  created: 0,
  updated: 0,
  skipped: 0,
  lastError: null,
};
let orgStatuses = {};
let xlsxLib = null;

function getXlsx() {
  if (!xlsxLib) xlsxLib = require('xlsx');
  return xlsxLib;
}

function log(message) {
  console.log(`[sheet-sync] ${message}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return resolve(download(res.headers.location, dest));
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (error) => {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        reject(error);
      });
  });
}

function parseWorkbookViaXlsx(xlsxPath) {
  const XLSX = getXlsx();
  const workbook = XLSX.readFile(xlsxPath, {
    cellDates: false,
    cellNF: false,
    cellText: false,
    dense: true,
  });

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
    }).map((row) => (Array.isArray(row) ? row.map((cell) => (cell === undefined || cell === null ? '' : String(cell))) : []));

    return {
      name: sheetName,
      state: 'visible',
      rows,
    };
  });
}

function cleanValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\r/g, '').trim();
  if (!text) return '';
  if (text === 'System.Xml.XmlElement' || text === '#VALUE!') return '';
  return text;
}

function normalizeMatchText(value) {
  return cleanValue(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function getDescriptionMetadataValue(description, label) {
  const prefix = `${label}:`;
  const line = String(description || '').split('\n').find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function normalizeHeader(value) {
  return cleanValue(value)
    .toLowerCase()
    .replace(/[\[\]()]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findHeaderRowIndex(rows) {
  const keywords = ['description', 'issue', 'status', 'priority', 'assignee', 'application', 'module', 'feature'];
  let best = { index: -1, score: -1 };
  rows.slice(0, 8).forEach((row, index) => {
    const headers = row.map(normalizeHeader).filter(Boolean);
    if (headers.length < 3) return;
    const score = keywords.reduce((sum, keyword) => sum + (headers.some((header) => header.includes(keyword)) ? 1 : 0), 0);
    if (score > best.score) best = { index, score };
  });
  return best.score >= 2 ? best.index : -1;
}

function buildHeaderMap(headerRow) {
  return headerRow.map((cell, index) => ({ index, normalized: normalizeHeader(cell) }));
}

function getByHeader(row, headerMap, patterns) {
  for (const pattern of patterns) {
    const header = headerMap.find((entry) => pattern.test(entry.normalized));
    if (!header) continue;
    const value = cleanValue(row[header.index]);
    if (value) return value;
  }
  return '';
}

function splitNames(raw) {
  const text = cleanValue(raw);
  if (!text) return [];
  const normalized = text
    .replace(/@/g, '')
    .replace(/\band\b/gi, '/')
    .replace(/\n/g, '/')
    .replace(/&/g, '/')
    .replace(/\s*,\s*/g, '/')
    .replace(/\s*\/\s*/g, '/');
  return [...new Set(normalized.split('/').map((part) => part.trim()).filter(Boolean))];
}

function slugify(value) {
  return cleanValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function titleCase(value) {
  return cleanValue(value)
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function mapPriority(raw) {
  const value = cleanValue(raw).toLowerCase();
  if (!value) return 'P2';
  if (/(^p0$|critical|immediate|blocker|sev ?0|sev ?1)/.test(value)) return 'P0';
  if (/(^p1$|high|urgent)/.test(value)) return 'P1';
  if (/(^p2$|medium|normal)/.test(value)) return 'P2';
  if (/(^p3$|low|minor|next release)/.test(value)) return 'P3';
  return 'P2';
}

function mapStatus(raw) {
  const value = cleanValue(raw).toLowerCase();
  if (!value) return 'To Do';
  if (/(closed|fixed|done|resolved|completed|complete|deployed|not feasible|not required|released|available on stage)/.test(value)) return 'Done';
  if (/(pending retest|retest|in review|review|qa|testing|uat|ready for qa)/.test(value)) return 'In Review';
  if (/(inprogress|in progress|working|ongoing|progress|development|under dev|assigned|hold|not fixed)/.test(value)) return 'In Progress';
  if (/(open|todo|to do|pending|new|backlog)/.test(value)) return 'To Do';
  return 'To Do';
}

function mapType(raw) {
  const value = cleanValue(raw).toLowerCase();
  if (!value) return 'Bug';
  if (/(implementation|feature|enhancement|request)/.test(value)) return 'Feature';
  if (/(task|support|maintenance)/.test(value)) return 'Task';
  if (/(improvement|optimization)/.test(value)) return 'Improvement';
  return 'Bug';
}

function parseExcelDate(raw) {
  const value = cleanValue(raw);
  if (!value) return '';
  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }
  const dashMatch = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const [, day, month, year] = dashMatch;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }
  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(epoch.getTime() + Math.round(num) * 24 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return value;
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function parseSheetDateToIso(raw) {
  const value = parseExcelDate(raw);
  if (!value) return null;
  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0)).toISOString();
  }
  const dashMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dashMatch) {
    const [, year, month, day] = dashMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0)).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractRowCreatedDate(row) {
  const values = row.map(cleanValue).filter(Boolean);
  if (!values.length) return null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const normalized = value.toLowerCase();
    const embedded = normalized.match(/(?:^|[^0-9])(\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{4}-\d{1,2}-\d{1,2})(?:[^0-9]|$)/);
    if (embedded) {
      const iso = parseSheetDateToIso(embedded[1]);
      if (iso) return iso;
    }

    if (normalized === 'date' || normalized.endsWith(' date') || normalized.includes('date:')) {
      const sameCell = value.split(':').slice(1).join(':').trim();
      const sameCellIso = parseSheetDateToIso(sameCell);
      if (sameCellIso) return sameCellIso;
      const nextIso = parseSheetDateToIso(values[index + 1] || '');
      if (nextIso) return nextIso;
    }
  }

  for (const value of values) {
    const iso = parseSheetDateToIso(value);
    if (iso) return iso;
  }

  return null;
}

function makeColor(seed) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const palette = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];
  return palette[hash % palette.length];
}

function getInitials(name) {
  const parts = cleanValue(name).split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'US';
}

function makePlaceholderEmail(name, usedEmails) {
  const base = slugify(name) || 'user';
  let email = `${base}@import.fixpulse.local`;
  let counter = 2;
  while (usedEmails.has(email.toLowerCase())) {
    email = `${base}-${counter}@import.fixpulse.local`;
    counter += 1;
  }
  usedEmails.add(email.toLowerCase());
  return email;
}

function sanitizeLabel(value) {
  const label = slugify(value).replace(/-/g, '_');
  return label && label.length <= 40 ? label : '';
}

function makeProjectKey(name, usedKeys) {
  const normalized = cleanValue(name);
  const candidates = [];
  const compact = normalized.replace(/[^A-Za-z0-9]+/g, '');
  if (compact) candidates.push(compact.slice(0, 5).toUpperCase());
  const initials = normalized.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 5).toUpperCase();
  if (initials) candidates.push(initials);
  if (/web\s*pos/i.test(normalized)) candidates.unshift('W');
  if (/m\s*pos/i.test(normalized)) candidates.unshift('M');
  if (/access\s*control/i.test(normalized)) candidates.unshift('AC');
  if (/backoffice/i.test(normalized)) candidates.unshift('BO');
  if (/ticket/i.test(normalized)) candidates.unshift('TM');
  if (/offline\s*pos/i.test(normalized)) candidates.unshift('OP');
  if (/store\s*qr/i.test(normalized)) candidates.unshift('SQ');
  if (/qr\s*dine/i.test(normalized)) candidates.unshift('QD');
  for (const candidate of candidates) {
    const key = candidate.replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (key && !usedKeys.has(key)) {
      usedKeys.add(key);
      return key;
    }
  }
  const fallbackBase = (compact || 'PRJ').toUpperCase().slice(0, 4) || 'PRJ';
  let suffix = 1;
  let key = fallbackBase;
  while (usedKeys.has(key)) {
    key = `${fallbackBase.slice(0, Math.max(1, 4 - String(suffix).length))}${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key);
  return key;
}

function buildIssueRecord(sheetName, rowNumber, headerMap, row) {
  // Prefer a specific "Date / Raised Date / Issue Date" column over scanning all cells,
  // because scan-all-cells picks up the first date it finds (could be a "Fixed" or "Deploy" date).
  const specificDateRaw = getByHeader(row, headerMap, [
    /^date$/, /^issue date$/, /^raised date$/, /^reported date$/, /^bug date$/,
    /^created date$/, /^date created$/, /^open date$/, /^logged date$/, /^entry date$/,
  ]);
  const inferredCreatedAt = specificDateRaw
    ? parseSheetDateToIso(specificDateRaw)
    : extractRowCreatedDate(row);
  const raw = {
    date: inferredCreatedAt ? parseExcelDate(inferredCreatedAt.slice(0, 10)) : '',
    raisedBy: getByHeader(row, headerMap, [/^issue raised by$/, /^raised by$/, /^qa owner$/, /^tested by$/]),
    application: getByHeader(row, headerMap, [/^application$/, /^product$/, /^apppliation$/]),
    issueType: getByHeader(row, headerMap, [/^issue type$/, /^bug type$/, /^type$/]),
    os: getByHeader(row, headerMap, [/^os operating system$/, /^os$/]),
    browser: getByHeader(row, headerMap, [/^browser$/]),
    environment: getByHeader(row, headerMap, [/^envirnoment$/, /^environment$/, /^deployement status$/, /^stage deployment$/, /^prod deployment$/]),
    retailType: getByHeader(row, headerMap, [/^retail type$/, /^domain retail restaurant$/, /^org type$/]),
    locationType: getByHeader(row, headerMap, [/^location type$/, /^location$/]),
    module: getByHeader(row, headerMap, [/^module$/, /^module page$/, /^page channel$/]),
    feature: getByHeader(row, headerMap, [/^feature$/, /^sales channel$/]),
    titleSource: getByHeader(row, headerMap, [/^issue title$/, /^issue description$/, /^description of bug$/, /^description$/, /^issues implementation descriptions$/, /^description implememtation$/, /^remarks$/, /^relix comments$/]),
    assigneeRaw: getByHeader(row, headerMap, [/^assignee$/, /^assigned$/, /^owners$/, /^owner$/]),
    priorityRaw: getByHeader(row, headerMap, [/^priority$/, /^priority for current release$/]),
    statusRaw: getByHeader(row, headerMap, [/^issue status$/, /^status$/, /^implementation status$/, /^dev status$/]),
    devComments: getByHeader(row, headerMap, [/^dev comments$/, /^dev comment$/]),
    qaComments: getByHeader(row, headerMap, [/^qa comments$/, /^qa comment$/]),
    sprint: getByHeader(row, headerMap, [/^sprints$/, /^sprint$/]),
    steps: getByHeader(row, headerMap, [/^steps to reproduce$/]),
    reference: getByHeader(row, headerMap, [/^attachments$/, /^reference files$/, /^additional comments$/]),
    qaCheck: getByHeader(row, headerMap, [/^qa check$/, /^qa check andriod$/, /^qa check ios$/]),
    version: getByHeader(row, headerMap, [/^version$/]),
    slicing: getByHeader(row, headerMap, [/^slicing$/]),
    affected: getByHeader(row, headerMap, [/^affected components services$/]),
    release: getByHeader(row, headerMap, [/^release status$/, /^expected release date$/]),
    mode: getByHeader(row, headerMap, [/^mode$/, /^internet throttling speed$/]),
  };
  const rawValues = row.map(cleanValue).filter(Boolean);
  if (rawValues.length === 0) return null;
  const title = cleanValue(raw.titleSource) || cleanValue(raw.feature) || cleanValue(raw.module) || rawValues[0];
  const normalizedTitle = cleanValue(title).replace(/\s+/g, ' ').trim();
  const words = normalizedTitle.split(' ').filter(Boolean);
  const hasStrongSignal = Boolean(raw.titleSource || raw.issueType || raw.statusRaw || raw.raisedBy || raw.assigneeRaw || raw.module || raw.feature || raw.devComments || raw.qaComments || raw.steps || raw.reference);
  const isNumericOnly = /^\d+$/.test(normalizedTitle);
  const isGenericHeading = new Set(['ISSUES', 'ISSUE', 'WEB POS']).has(normalizedTitle.toUpperCase());
  const isAllCapsShort = /^[A-Z0-9&'\/\- ]+$/.test(normalizedTitle) && words.length <= 5;
  const normalizedApplication = cleanValue(raw.application).replace(/\s+/g, ' ').trim();
  const applicationLooksLikeSection = /^[A-Z0-9&'\/\- ]+$/.test(normalizedApplication) && normalizedApplication.split(' ').filter(Boolean).length <= 5;
  const matchesSheetLabel = normalizedTitle.toLowerCase() === cleanValue(sheetName).toLowerCase() || (applicationLooksLikeSection && normalizedTitle.toLowerCase() === normalizedApplication.toLowerCase());
  const isTitleCaseShort = words.length <= 3 && words.every((word) => /^[A-Z][A-Za-z'’-]*$/.test(word));
  if (!normalizedTitle || normalizedTitle === 'PENDING ISSUES / IMPLEMENTATIONS') return null;
  if (!hasStrongSignal && (isNumericOnly || isGenericHeading || matchesSheetLabel || isAllCapsShort || isTitleCaseShort)) return null;
  const metadata = [
    ['Source Tab', sheetName],
    ['Source Row', String(rowNumber)],
    ['Date', raw.date],
    ['Raised By', raw.raisedBy],
    ['Application', raw.application],
    ['Issue Type', raw.issueType],
    ['Operating System', raw.os],
    ['Browser', raw.browser],
    ['Environment', raw.environment],
    ['Retail Type', raw.retailType],
    ['Location Type', raw.locationType],
    ['Module', raw.module],
    ['Feature', raw.feature],
    ['Assignee(s)', raw.assigneeRaw],
    ['Priority (Original)', raw.priorityRaw],
    ['Status (Original)', raw.statusRaw],
    ['Sprint', raw.sprint],
    ['Version', raw.version],
    ['QA Check', raw.qaCheck],
    ['Release', raw.release],
    ['Slicing', raw.slicing],
    ['Affected Components', raw.affected],
    ['Mode', raw.mode],
    ['Steps To Reproduce', raw.steps],
    ['Developer Comments', raw.devComments],
    ['QA Comments', raw.qaComments],
  ].filter(([, value]) => cleanValue(value));
  const description = metadata.map(([label, value]) => `${label}: ${value}`).join('\n');
  const labels = [
    sheetName,
    raw.application,
    raw.issueType,
    raw.module,
    raw.feature,
    raw.retailType,
    raw.locationType,
  ]
    .map(sanitizeLabel)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 8);

  return {
    sheetName,
    rowNumber,
    sourceRef: '',
    sourceCreatedAt: inferredCreatedAt,
    title: title.length > 500 ? `${title.slice(0, 497)}...` : title,
    description,
    type: mapType(raw.issueType),
    priority: mapPriority(raw.priorityRaw),
    status: mapStatus(raw.statusRaw),
    reporterName: titleCase(raw.raisedBy),
    assigneeNames: splitNames(raw.assigneeRaw).map(titleCase).filter(Boolean),
    labels,
    referenceLink: cleanValue(raw.reference).startsWith('http') ? cleanValue(raw.reference) : '',
    curlCommand: '',
  };
}

function normalizeWorkbook(workbook) {
  return workbook
    .filter((sheet) => !IGNORED_SHEETS.has(sheet.name))
    .map((sheet) => {
      const headerIndex = findHeaderRowIndex(sheet.rows || []);
      if (headerIndex < 0) return { name: sheet.name, issues: [], headers: [] };
      const headerRow = sheet.rows[headerIndex];
      const headers = headerRow.map(cleanValue).filter(Boolean);
      const headerMap = buildHeaderMap(headerRow);
      const issues = (sheet.rows || [])
        .slice(headerIndex + 1)
        .map((row, index) => buildIssueRecord(sheet.name, headerIndex + index + 2, headerMap, row))
        .filter(Boolean);
      return { name: sheet.name, issues, headers };
    })
    .filter((sheet) => sheet.issues.length > 0);
}

function hashIssue(issue) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
      sourceCreatedAt: issue.sourceCreatedAt,
      title: issue.title,
      description: issue.description,
      type: issue.type,
      priority: issue.priority,
      status: issue.status,
      reporterName: issue.reporterName,
      assigneeNames: issue.assigneeNames,
      labels: issue.labels,
      referenceLink: issue.referenceLink,
      curlCommand: issue.curlCommand,
    }))
    .digest('hex');
}

async function ensureSchema() {
  await db.query(`ALTER TABLE bugs ADD COLUMN IF NOT EXISTS source_kind TEXT`);
  await db.query(`ALTER TABLE bugs ADD COLUMN IF NOT EXISTS source_ref TEXT`);
  await db.query(`ALTER TABLE bugs ADD COLUMN IF NOT EXISTS source_hash TEXT`);
  await db.query(`ALTER TABLE bugs ADD COLUMN IF NOT EXISTS source_created_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_source_type TEXT`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_source_url TEXT`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_source_sheet_id TEXT`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_source_file_name TEXT`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_source_file_data TEXT`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_source_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_source_last_synced_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_source_last_error TEXT`);
  await db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS sheet_headers JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bugs_source_unique ON bugs(source_kind, source_ref) WHERE source_kind IS NOT NULL AND source_ref IS NOT NULL`);
}

function extractGoogleSheetId(value) {
  const text = cleanValue(value);
  if (!text) return '';
  const idMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (idMatch) return idMatch[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return '';
}

function decodeDataUrl(value) {
  const text = cleanValue(value);
  if (!text.startsWith('data:')) throw new Error('Invalid uploaded spreadsheet data');
  const commaIndex = text.indexOf(',');
  if (commaIndex < 0) throw new Error('Invalid uploaded spreadsheet data');
  const meta = text.slice(5, commaIndex);
  const payload = text.slice(commaIndex + 1);
  const isBase64 = /;base64/i.test(meta);
  return Buffer.from(payload, isBase64 ? 'base64' : 'utf8');
}

function parseWorkbookFromBuffer(buffer) {
  const XLSX = getXlsx();
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellNF: false,
    cellText: false,
    dense: true,
  });

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
    }).map((row) => (Array.isArray(row) ? row.map((cell) => (cell === undefined || cell === null ? '' : String(cell))) : []));

    return {
      name: sheetName,
      state: 'visible',
      rows,
    };
  });
}

function normalizeWorkbookForSource(workbook, source) {
  const sheets = normalizeWorkbook(workbook);
  if (source.data_source_type !== 'csv' || sheets.length !== 1) return sheets;
  const fileName = cleanValue(source.data_source_file_name).replace(/\.[^.]+$/, '');
  if (!fileName) return sheets;
  return sheets.map((sheet, index) => (index === 0 ? { ...sheet, name: fileName } : sheet));
}

async function ensureLegacyTargetConfigured() {
  const sheetId = extractGoogleSheetId(LEGACY_SHEET_ID);
  if (!sheetId || !LEGACY_TARGET_ORG_NAME) return;
  await db.query(
    `UPDATE organizations
     SET data_source_type = COALESCE(NULLIF(data_source_type, ''), 'google_sheet'),
         data_source_url = COALESCE(NULLIF(data_source_url, ''), $2),
         data_source_sheet_id = COALESCE(NULLIF(data_source_sheet_id, ''), $3),
         data_source_sync_enabled = CASE
           WHEN data_source_sync_enabled IS TRUE THEN TRUE
           ELSE TRUE
         END
     WHERE LOWER(name)=LOWER($1)`,
    [LEGACY_TARGET_ORG_NAME, `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, sheetId]
  );
}

async function getSyncTargets(targetOrgId = null) {
  const params = [];
  let where = `
    (
      (data_source_type = 'google_sheet' AND COALESCE(data_source_sheet_id, '') <> '')
      OR (data_source_type IN ('xlsx', 'csv') AND COALESCE(data_source_file_data, '') <> '')
    )
  `;
  if (targetOrgId) {
    params.push(targetOrgId);
    where += ` AND id = $${params.length}`;
  } else {
    where += ` AND data_source_sync_enabled = TRUE`;
  }
  const { rows } = await db.query(
    `SELECT *
     FROM organizations
     WHERE ${where}
     ORDER BY created_at ASC`,
    params
  );
  return rows;
}

function buildSourceRef(source, sheetName, rowNumber) {
  const sourceId = source.data_source_type === 'google_sheet'
    ? source.data_source_sheet_id
    : `${source.id}:${cleanValue(source.data_source_file_name) || source.data_source_type}`;
  return `${sourceId}:${sheetName}:${rowNumber}`;
}

async function loadWorkbookForTarget(target) {
  if (target.data_source_type === 'google_sheet') {
    const syncPath = path.join(process.cwd(), 'data', `live-sheet-sync-${target.id}-${process.pid}-${Date.now()}.xlsx`);
    await download(`https://docs.google.com/spreadsheets/d/${target.data_source_sheet_id}/export?format=xlsx`, syncPath);
    const workbook = parseWorkbookViaXlsx(syncPath);
    try { fs.unlinkSync(syncPath); } catch {}
    return normalizeWorkbookForSource(workbook, target);
  }

  if (target.data_source_type === 'xlsx' || target.data_source_type === 'csv') {
    const workbook = parseWorkbookFromBuffer(decodeDataUrl(target.data_source_file_data));
    return normalizeWorkbookForSource(workbook, target);
  }

  throw new Error(`Unsupported data source type "${target.data_source_type}"`);
}

function setOrgStatus(orgId, patch) {
  orgStatuses[orgId] = {
    running: false,
    lastRunAt: null,
    lastSuccessAt: null,
    created: 0,
    updated: 0,
    skipped: 0,
    lastError: null,
    ...orgStatuses[orgId],
    ...patch,
  };
}

async function getSystemRoleId(roleName) {
  const { rows } = await db.query('SELECT id FROM roles WHERE org_id IS NULL AND LOWER(name)=LOWER($1) LIMIT 1', [roleName]);
  return rows[0]?.id || null;
}

async function ensureUser(org, name, userByName, usedEmails, developerRoleId) {
  const normalized = titleCase(name);
  if (!normalized) return null;
  const existing = userByName.get(normalized.toLowerCase());
  if (existing) return existing;
  const email = makePlaceholderEmail(normalized, usedEmails);
  const { rows } = await db.query(
    `INSERT INTO users (org_id, name, email, avatar, color, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, NULL, 'developer')
     RETURNING *`,
    [org.id, normalized, email, getInitials(normalized), makeColor(normalized)]
  );
  const user = rows[0];
  userByName.set(user.name.toLowerCase(), user);
  if (developerRoleId) {
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, org_id, project_id)
       SELECT $1, $2, $3, NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM user_roles WHERE user_id=$1 AND role_id=$2 AND org_id=$3 AND project_id IS NULL
       )`,
      [user.id, developerRoleId, org.id]
    );
  }
  return user;
}

async function ensureProject(org, name, projectByName, usedKeys, headers = []) {
  const key = name.toLowerCase();
  const headersJson = JSON.stringify(headers);
  if (projectByName.has(key)) {
    const project = projectByName.get(key);
    if (headers.length > 0) {
      await db.query('UPDATE projects SET sheet_headers=$1 WHERE id=$2', [headersJson, project.id]);
    }
    return project;
  }
  const projectKey = makeProjectKey(name, usedKeys);
  const { rows } = await db.query(
    `INSERT INTO projects (org_id, name, key, description, color, sheet_headers)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [org.id, name, projectKey, `${name} issues synced from Google Sheet`, makeColor(name), headersJson]
  );
  const project = rows[0];
  await db.query('INSERT INTO project_sequences (project_id, next_num) VALUES ($1, 1) ON CONFLICT (project_id) DO NOTHING', [project.id]);
  projectByName.set(project.name.toLowerCase(), project);
  return project;
}

async function nextBugKey(project) {
  const result = await db.query(
    'UPDATE project_sequences SET next_num = next_num + 1 WHERE project_id=$1 RETURNING next_num - 1 AS num',
    [project.id]
  );
  const num = result.rows[0]?.num ?? 1;
  return `${project.key}-${num}`;
}

async function syncTarget(target) {
  const runAt = new Date().toISOString();
  setOrgStatus(target.id, {
    running: true,
    lastRunAt: runAt,
    lastError: null,
  });

  try {
    const sheets = await loadWorkbookForTarget(target);
    const [{ rows: projectRows }, { rows: userRows }, { rows: allEmailsRows }, { rows: bugRows }] = await Promise.all([
      db.query('SELECT * FROM projects WHERE org_id=$1 ORDER BY created_at ASC', [target.id]),
      db.query('SELECT * FROM users WHERE org_id=$1 ORDER BY created_at ASC', [target.id]),
      db.query('SELECT email FROM users'),
      db.query('SELECT id, key, project_id, title, description, source_kind, source_ref, source_hash FROM bugs WHERE org_id=$1', [target.id]),
    ]);

    const projectByName = new Map(projectRows.map((row) => [row.name.toLowerCase(), row]));
    const usedKeys = new Set(projectRows.map((row) => String(row.key).toUpperCase()));
    const userByName = new Map(userRows.map((row) => [String(row.name).toLowerCase(), row]));
    const usedEmails = new Set(allEmailsRows.map((row) => String(row.email || '').toLowerCase()).filter(Boolean));
    const existingBySourceRef = new Map(
      bugRows
        .filter((row) => row.source_kind === 'google_sheet' && row.source_ref)
        .map((row) => [row.source_ref, row])
    );
    const legacyByProjectAndTitle = new Map();
    for (const row of bugRows) {
      if (row.source_ref || !getDescriptionMetadataValue(row.description, 'Source Tab')) continue;
      const key = `${row.project_id}::${normalizeMatchText(row.title)}`;
      if (!legacyByProjectAndTitle.has(key)) legacyByProjectAndTitle.set(key, []);
      legacyByProjectAndTitle.get(key).push(row);
    }
    const developerRoleId = await getSystemRoleId('developer');

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const sheet of sheets) {
      const projectName = sheet.name === 'WEB POS' ? 'webPOS' : sheet.name;
      const project = await ensureProject(target, projectName, projectByName, usedKeys, sheet.headers || []);
      for (const sheetIssue of sheet.issues) {
        const issue = { ...sheetIssue, sourceRef: buildSourceRef(target, sheet.name, sheetIssue.rowNumber) };
        const assignee = issue.assigneeNames[0] ? await ensureUser(target, issue.assigneeNames[0], userByName, usedEmails, developerRoleId) : null;
        const reporter = issue.reporterName ? await ensureUser(target, issue.reporterName, userByName, usedEmails, developerRoleId) : null;
        const sourceHash = hashIssue(issue);
        const existing = existingBySourceRef.get(issue.sourceRef);
        const legacyKey = `${project.id}::${normalizeMatchText(issue.title)}`;
        const legacyMatches = legacyByProjectAndTitle.get(legacyKey) || [];
        const legacy = !existing && legacyMatches.length ? legacyMatches.shift() : null;

        if (!existing && legacy) {
          await db.query(
            `UPDATE bugs
             SET title=$2,
                 description=$3,
                 type=$4,
                 priority=$5,
                 status=$6,
                 assignee_id=$7,
                 reporter_id=$8,
                 labels=$9,
                 reference_link=$10,
                 curl_command=$11,
                 project_id=$12,
                 source_kind='google_sheet',
                 source_ref=$13,
                 source_hash=$14,
                 source_created_at=$15,
                 created_at=COALESCE($15, created_at)
             WHERE id=$1`,
            [
              legacy.id,
              issue.title,
              issue.description,
              issue.type,
              issue.priority,
              issue.status,
              assignee?.id || null,
              reporter?.id || null,
              issue.labels,
              issue.referenceLink,
              issue.curlCommand,
              project.id,
              issue.sourceRef,
              sourceHash,
              issue.sourceCreatedAt,
            ]
          );
          existingBySourceRef.set(issue.sourceRef, {
            id: legacy.id,
            source_ref: issue.sourceRef,
            source_hash: sourceHash,
          });
          updated += 1;
          continue;
        }

        if (!existing) {
          const key = await nextBugKey(project);
          const { rows } = await db.query(
            `INSERT INTO bugs (
              org_id, key, project_id, title, description, type, priority, status,
              assignee_id, reporter_id, labels, attachments, reference_link, curl_command,
              source_kind, source_ref, source_hash, source_created_at, created_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,
              $9,$10,$11,$12,$13,$14,
              $15,$16,$17,$18,COALESCE($18, NOW())
            ) RETURNING id, source_ref, source_hash`,
            [
              target.id,
              key,
              project.id,
              issue.title,
              issue.description,
              issue.type,
              issue.priority,
              issue.status,
              assignee?.id || null,
              reporter?.id || null,
              issue.labels,
              JSON.stringify([]),
              issue.referenceLink,
              issue.curlCommand,
              'google_sheet',
              issue.sourceRef,
              sourceHash,
              issue.sourceCreatedAt,
            ]
          );
          existingBySourceRef.set(issue.sourceRef, rows[0]);
          created += 1;
          continue;
        }

        if (existing.source_hash === sourceHash) {
          skipped += 1;
          continue;
        }

        await db.query(
          `UPDATE bugs
           SET title=$2,
               description=$3,
               type=$4,
               priority=$5,
               status=$6,
               assignee_id=$7,
               reporter_id=$8,
               labels=$9,
               reference_link=$10,
               curl_command=$11,
               project_id=$12,
               source_hash=$13,
               source_created_at=$14,
               created_at=COALESCE($14, created_at)
           WHERE id=$1`,
          [
            existing.id,
            issue.title,
            issue.description,
            issue.type,
            issue.priority,
            issue.status,
            assignee?.id || null,
            reporter?.id || null,
            issue.labels,
            issue.referenceLink,
            issue.curlCommand,
            project.id,
            sourceHash,
            issue.sourceCreatedAt,
          ]
        );
        existing.source_hash = sourceHash;
        updated += 1;
      }
    }

    const completedAt = new Date().toISOString();
    await db.query(
      `UPDATE organizations
       SET data_source_last_synced_at=$2,
           data_source_last_error=NULL
       WHERE id=$1`,
      [target.id, completedAt]
    );
    setOrgStatus(target.id, {
      running: false,
      lastRunAt: runAt,
      lastSuccessAt: completedAt,
      created,
      updated,
      skipped,
      lastError: null,
    });
    log(`sync complete for ${target.name}: created ${created}, updated ${updated}, skipped ${skipped}`);
    return { created, updated, skipped, ok: true };
  } catch (error) {
    await db.query(
      `UPDATE organizations
       SET data_source_last_error=$2
       WHERE id=$1`,
      [target.id, error.message]
    );
    setOrgStatus(target.id, {
      running: false,
      lastRunAt: runAt,
      lastError: error.message,
    });
    log(`sync failed for ${target.name}: ${error.message}`);
    return { created: 0, updated: 0, skipped: 0, ok: false, error: error.message };
  }
}

async function syncOnce(targetOrgId = null) {
  if (syncInFlight) return;
  syncInFlight = true;
  lastStatus.running = true;
  lastStatus.lastRunAt = new Date().toISOString();
  try {
    await ensureSchema();
    await ensureLegacyTargetConfigured();
    const targets = await getSyncTargets(targetOrgId);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let lastError = null;

    for (const target of targets) {
      const result = await syncTarget(target);
      created += result.created || 0;
      updated += result.updated || 0;
      skipped += result.skipped || 0;
      if (!result.ok) lastError = result.error;
    }

    lastStatus = {
      running: false,
      lastRunAt: lastStatus.lastRunAt,
      lastSuccessAt: new Date().toISOString(),
      created,
      updated,
      skipped,
      lastError,
    };
    log(`sync cycle complete: ${targets.length} organization(s), created ${created}, updated ${updated}, skipped ${skipped}`);
  } catch (error) {
    lastStatus.running = false;
    lastStatus.lastError = error.message;
    log(`sync failed: ${error.message}`);
  } finally {
    syncInFlight = false;
  }
}

function startGoogleSheetSync() {
  if (!ENABLED) {
    log('disabled');
    return;
  }
  log(`enabled for organization data sources every ${SYNC_INTERVAL_MS / 1000}s`);
  triggerGoogleSheetSync();
  syncTimer = setInterval(() => {
    triggerGoogleSheetSync();
  }, SYNC_INTERVAL_MS);
}

async function getGoogleSheetSyncStatus(targetOrgId = null) {
  if (!targetOrgId) {
    return {
      ...lastStatus,
      intervalMs: SYNC_INTERVAL_MS,
      enabled: ENABLED,
      orgStatuses,
    };
  }

  const { rows } = await db.query(
    `SELECT id, data_source_type, data_source_url, data_source_file_name, data_source_sync_enabled,
            data_source_last_synced_at, data_source_last_error
     FROM organizations
     WHERE id=$1
     LIMIT 1`,
    [targetOrgId]
  );
  const orgRow = rows[0] || {};
  return {
    ...(orgStatuses[targetOrgId] || {}),
    running: orgStatuses[targetOrgId]?.running || false,
    intervalMs: SYNC_INTERVAL_MS,
    enabled: ENABLED,
    dataSourceType: orgRow.data_source_type || '',
    dataSourceUrl: orgRow.data_source_url || '',
    dataSourceFileName: orgRow.data_source_file_name || '',
    dataSourceSyncEnabled: Boolean(orgRow.data_source_sync_enabled),
    lastSuccessAt: orgStatuses[targetOrgId]?.lastSuccessAt || orgRow.data_source_last_synced_at || null,
    lastError: orgStatuses[targetOrgId]?.lastError || orgRow.data_source_last_error || null,
  };
}

function triggerGoogleSheetSync(targetOrgId = null) {
  if (syncInFlight) return false;
  syncInFlight = true;
  lastStatus.running = true;
  lastStatus.lastRunAt = new Date().toISOString();

  const childArgs = [__filename];
  if (targetOrgId) childArgs.push('--org', targetOrgId);
  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('close', (code) => {
    syncInFlight = false;
    lastStatus.running = false;

    if (stderr.trim()) {
      console.error(stderr.trim());
    }

    const marker = stdout.split('\n').find((line) => line.startsWith('__SHEET_SYNC_STATUS__'));
    if (code === 0 && marker) {
      try {
        const parsed = JSON.parse(marker.replace('__SHEET_SYNC_STATUS__', ''));
        lastStatus = {
          ...lastStatus,
          ...parsed.global,
          running: false,
          intervalMs: SYNC_INTERVAL_MS,
          enabled: ENABLED,
        };
        orgStatuses = { ...orgStatuses, ...(parsed.orgStatuses || {}) };
        return;
      } catch {}
    }

    lastStatus.lastError = code === 0 ? 'Unable to parse sync result' : `Sync worker exited with code ${code}`;
  });

  return true;
}

module.exports = {
  startGoogleSheetSync,
  getGoogleSheetSyncStatus,
  triggerGoogleSheetSync,
  parseWorkbookViaXlsx,
  normalizeWorkbook,
};

if (require.main === module) {
  (async () => {
    await db.connect();
    const orgIndex = process.argv.indexOf('--org');
    const targetOrgId = orgIndex >= 0 ? process.argv[orgIndex + 1] : null;
    await syncOnce(targetOrgId);
    process.stdout.write(`__SHEET_SYNC_STATUS__${JSON.stringify({
      global: await getGoogleSheetSyncStatus(),
      orgStatuses,
    })}\n`);
    process.exit(0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
