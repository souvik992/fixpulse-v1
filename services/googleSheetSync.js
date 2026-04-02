require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { spawn } = require('child_process');
const db = require('../db');

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1a41W8XdllH-lzTBQmO4QCaRQMURAQb0Z7Z2EQjL2jXU';
const TARGET_ORG_NAME = process.env.GOOGLE_SHEET_TARGET_ORG || 'Twinleaves';
const SYNC_INTERVAL_MS = Math.max(Number(process.env.SHEET_SYNC_INTERVAL_MS || 60000), 15000);
const ENABLED = String(process.env.SHEET_SYNC_ENABLED || 'true').toLowerCase() !== 'false';
const IGNORED_SHEETS = new Set(['Summary', 'Master']);

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

function parseWorkbookViaPowerShell(xlsxPath) {
  const psScript = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path '${xlsxPath.replace(/'/g, "''")}'))
function Get-EntryText($path) {
  $entry = $zip.GetEntry($path)
  if (-not $entry) { return $null }
  $sr = New-Object System.IO.StreamReader($entry.Open())
  try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
}
function ColToIndex($letters) {
  $sum = 0
  foreach($ch in $letters.ToCharArray()) { $sum = ($sum * 26) + ([int][char]$ch - [int][char]'A' + 1) }
  return $sum - 1
}
function Get-SharedStringValue($si) {
  if ($si.t) { return [string]$si.t }
  if ($si.r) {
    return (($si.r | ForEach-Object {
      if ($_.t -is [string]) { $_.t }
      elseif ($_.t.'#text') { $_.t.'#text' }
      else { [string]$_.t }
    }) -join '')
  }
  return ''
}
$sharedXmlText = Get-EntryText 'xl/sharedStrings.xml'
$shared = @()
if ($sharedXmlText) {
  $sharedXml = [xml]$sharedXmlText
  foreach($si in $sharedXml.sst.si){ $shared += (Get-SharedStringValue $si) }
}
$workbook = [xml](Get-EntryText 'xl/workbook.xml')
$rels = [xml](Get-EntryText 'xl/_rels/workbook.xml.rels')
$relMap = @{}
foreach($rel in $rels.Relationships.Relationship){ $relMap[$rel.Id] = $rel.Target }
$nsRel = New-Object System.Xml.XmlNamespaceManager($workbook.NameTable)
$nsRel.AddNamespace('x','http://schemas.openxmlformats.org/spreadsheetml/2006/main')
$nsRel.AddNamespace('r','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
$sheets = $workbook.SelectNodes('//x:sheets/x:sheet', $nsRel)
$result = @()
foreach($sheet in $sheets){
  $name = $sheet.GetAttribute('name')
  $state = $sheet.GetAttribute('state')
  if (-not $state) { $state = 'visible' }
  $rid = $sheet.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $target = $relMap[$rid]
  $sheetXmlText = Get-EntryText ('xl/' + $target)
  if (-not $sheetXmlText) { continue }
  $sheetXml = [xml]$sheetXmlText
  $ns = New-Object System.Xml.XmlNamespaceManager($sheetXml.NameTable)
  $ns.AddNamespace('x','http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $rows = @()
  foreach($row in $sheetXml.SelectNodes('//x:sheetData/x:row', $ns)) {
    $cells = @{}
    $maxIndex = -1
    foreach($c in $row.SelectNodes('x:c', $ns)) {
      $ref = $c.GetAttribute('r')
      $col = ([regex]::Match($ref,'[A-Z]+')).Value
      $idx = ColToIndex $col
      if ($idx -gt $maxIndex) { $maxIndex = $idx }
      $t = $c.GetAttribute('t')
      $vNode = $c.SelectSingleNode('x:v', $ns)
      $value = ''
      if ($vNode) {
        $raw = [string]$vNode.InnerText
        if ($t -eq 's') {
          $value = $shared[[int]$raw]
        } else {
          $value = $raw
        }
      } else {
        $inlineNode = $c.SelectSingleNode('x:is/x:t', $ns)
        if ($inlineNode) { $value = [string]$inlineNode.InnerText }
      }
      if ($value -isnot [string]) { $value = [string]$value }
      $value = $value.Trim()
      $cells[$idx] = $value
    }
    if ($maxIndex -ge 0) {
      $rowValues = @()
      foreach($i in 0..$maxIndex) {
        if ($cells.ContainsKey($i)) { $rowValues += $cells[$i] } else { $rowValues += '' }
      }
      while ($rowValues.Count -gt 0 -and [string]::IsNullOrWhiteSpace($rowValues[$rowValues.Count - 1])) {
        $rowValues = $rowValues[0..($rowValues.Count - 2)]
      }
      if ($rowValues.Count -gt 0) { $rows += ,@($rowValues) }
    }
  }
  $result += [pscustomobject]@{ name=$name; state=$state; rows=$rows }
}
$zip.Dispose()
$result | ConvertTo-Json -Depth 8 -Compress
`;
  const output = execFileSync('powershell', ['-NoProfile', '-Command', psScript], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 80,
  });
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function cleanValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\r/g, '').trim();
  if (!text) return '';
  if (text === 'System.Xml.XmlElement' || text === '#VALUE!') return '';
  return text;
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
  if (!value) return 'Medium';
  if (/(^p0$|critical|immediate|blocker|sev ?0|sev ?1)/.test(value)) return 'Critical';
  if (/(^p1$|high|urgent)/.test(value)) return 'High';
  if (/(^p2$|medium|normal)/.test(value)) return 'Medium';
  if (/(^p3$|low|minor|next release)/.test(value)) return 'Low';
  return 'Medium';
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
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) return value;
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
  const raw = {
    date: getByHeader(row, headerMap, [/^date$/, /^issue raised on$/, /^raised on$/, /^expected date$/, /^due date$/]),
    raisedBy: getByHeader(row, headerMap, [/^issue raised by$/, /^raised by$/, /^qa owner$/, /^tested by$/]),
    application: getByHeader(row, headerMap, [/^application$/, /^product$/, /^apppliation$/]),
    issueType: getByHeader(row, headerMap, [/^issue type$/, /^bug type$/, /^type$/]),
    os: getByHeader(row, headerMap, [/^os operating system$/, /^os$/]),
    browser: getByHeader(row, headerMap, [/^browser$/]),
    environment: getByHeader(row, headerMap, [/^envirnoment$/, /^environment$/, /^deployement status$/, /^stage deployment$/, /^prod deployment$/]),
    retailType: getByHeader(row, headerMap, [/^retail type$/, /^domain retail restaurant$/, /^org type$/]),
    locationType: getByHeader(row, headerMap, [/^location type$/]),
    module: getByHeader(row, headerMap, [/^module$/, /^module page$/, /^page channel$/]),
    feature: getByHeader(row, headerMap, [/^feature$/, /^sales channel$/]),
    titleSource: getByHeader(row, headerMap, [/^issue description$/, /^description of bug$/, /^description$/, /^issues implementation descriptions$/, /^description implememtation$/, /^remarks$/, /^relix comments$/]),
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
  if (!title || title === 'PENDING ISSUES / IMPLEMENTATIONS') return null;
  const metadata = [
    ['Source Tab', sheetName],
    ['Source Row', String(rowNumber)],
    ['Date', parseExcelDate(raw.date)],
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
    sourceRef: `${SHEET_ID}:${sheetName}:${rowNumber}`,
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
      if (headerIndex < 0) return { name: sheet.name, issues: [] };
      const headerMap = buildHeaderMap(sheet.rows[headerIndex]);
      const issues = (sheet.rows || [])
        .slice(headerIndex + 1)
        .map((row, index) => buildIssueRecord(sheet.name, headerIndex + index + 2, headerMap, row))
        .filter(Boolean);
      return { name: sheet.name, issues };
    })
    .filter((sheet) => sheet.issues.length > 0);
}

function hashIssue(issue) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
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
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bugs_source_unique ON bugs(source_kind, source_ref) WHERE source_kind IS NOT NULL AND source_ref IS NOT NULL`);
}

async function getTargetOrg() {
  const { rows } = await db.query('SELECT * FROM organizations WHERE LOWER(name)=LOWER($1) ORDER BY created_at ASC LIMIT 1', [TARGET_ORG_NAME]);
  return rows[0] || null;
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

async function ensureProject(org, name, projectByName, usedKeys) {
  const key = name.toLowerCase();
  if (projectByName.has(key)) return projectByName.get(key);
  const projectKey = makeProjectKey(name, usedKeys);
  const { rows } = await db.query(
    `INSERT INTO projects (org_id, name, key, description, color)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [org.id, name, projectKey, `${name} issues synced from Google Sheet`, makeColor(name)]
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

async function syncOnce() {
  if (syncInFlight) return;
  syncInFlight = true;
  lastStatus.running = true;
  lastStatus.lastRunAt = new Date().toISOString();
  try {
    await ensureSchema();
    const org = await getTargetOrg();
    if (!org) throw new Error(`Organization "${TARGET_ORG_NAME}" not found`);

    const syncPath = path.join(process.cwd(), 'data', 'live-sheet-sync.xlsx');
    await download(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`, syncPath);
    const workbook = parseWorkbookViaPowerShell(syncPath);
    const sheets = normalizeWorkbook(workbook);

    const [{ rows: projectRows }, { rows: userRows }, { rows: allEmailsRows }, { rows: bugRows }] = await Promise.all([
      db.query('SELECT * FROM projects WHERE org_id=$1 ORDER BY created_at ASC', [org.id]),
      db.query('SELECT * FROM users WHERE org_id=$1 ORDER BY created_at ASC', [org.id]),
      db.query('SELECT email FROM users'),
      db.query('SELECT id, source_ref, source_hash FROM bugs WHERE org_id=$1 AND source_kind=$2', [org.id, 'google_sheet']),
    ]);

    const projectByName = new Map(projectRows.map((row) => [row.name.toLowerCase(), row]));
    const usedKeys = new Set(projectRows.map((row) => String(row.key).toUpperCase()));
    const userByName = new Map(userRows.map((row) => [String(row.name).toLowerCase(), row]));
    const usedEmails = new Set(allEmailsRows.map((row) => String(row.email || '').toLowerCase()).filter(Boolean));
    const existingBySourceRef = new Map(bugRows.map((row) => [row.source_ref, row]));
    const developerRoleId = await getSystemRoleId('developer');

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const sheet of sheets) {
      const project = await ensureProject(org, sheet.name === 'WEB POS' ? 'webPOS' : sheet.name, projectByName, usedKeys);
      for (const issue of sheet.issues) {
        const assignee = issue.assigneeNames[0] ? await ensureUser(org, issue.assigneeNames[0], userByName, usedEmails, developerRoleId) : null;
        const reporter = issue.reporterName ? await ensureUser(org, issue.reporterName, userByName, usedEmails, developerRoleId) : null;
        const sourceHash = hashIssue(issue);
        const existing = existingBySourceRef.get(issue.sourceRef);

        if (!existing) {
          const key = await nextBugKey(project);
          const { rows } = await db.query(
            `INSERT INTO bugs (
              org_id, key, project_id, title, description, type, priority, status,
              assignee_id, reporter_id, labels, attachments, reference_link, curl_command,
              source_kind, source_ref, source_hash
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,
              $9,$10,$11,$12,$13,$14,
              $15,$16,$17
            ) RETURNING id, source_ref, source_hash`,
            [
              org.id,
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
               source_hash=$13
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
          ]
        );
        existing.source_hash = sourceHash;
        updated += 1;
      }
    }

    lastStatus = {
      running: false,
      lastRunAt: lastStatus.lastRunAt,
      lastSuccessAt: new Date().toISOString(),
      created,
      updated,
      skipped,
      lastError: null,
    };
    log(`sync complete: created ${created}, updated ${updated}, skipped ${skipped}`);
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
  log(`enabled for sheet ${SHEET_ID} every ${SYNC_INTERVAL_MS / 1000}s`);
  triggerGoogleSheetSync();
  syncTimer = setInterval(() => {
    triggerGoogleSheetSync();
  }, SYNC_INTERVAL_MS);
}

function getGoogleSheetSyncStatus() {
  return { ...lastStatus, intervalMs: SYNC_INTERVAL_MS, enabled: ENABLED, sheetId: SHEET_ID };
}

function triggerGoogleSheetSync() {
  if (syncInFlight) return;
  syncInFlight = true;
  lastStatus.running = true;
  lastStatus.lastRunAt = new Date().toISOString();

  const child = spawn(process.execPath, [__filename], {
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
          ...parsed,
          running: false,
          intervalMs: SYNC_INTERVAL_MS,
          enabled: ENABLED,
          sheetId: SHEET_ID,
        };
        return;
      } catch {}
    }

    lastStatus.lastError = code === 0 ? 'Unable to parse sync result' : `Sync worker exited with code ${code}`;
  });
}

module.exports = { startGoogleSheetSync, getGoogleSheetSyncStatus };

if (require.main === module) {
  (async () => {
    await db.connect();
    await syncOnce();
    process.stdout.write(`__SHEET_SYNC_STATUS__${JSON.stringify(getGoogleSheetSyncStatus())}\n`);
    process.exit(0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
