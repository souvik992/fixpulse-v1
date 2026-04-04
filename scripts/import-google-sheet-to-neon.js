require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require('pg');

const SHEET_ID = '1a41W8XdllH-lzTBQmO4QCaRQMURAQb0Z7Z2EQjL2jXU';
const TARGET_ORG_NAME = 'Twinleaves';
const WEBPOS_PROJECT_NAME = 'webPOS';
const IGNORED_SHEETS = new Set(['Summary', 'Master']);
const REQUESTED_SHEET_NAMES = String(process.env.SHEET_NAMES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const REQUESTED_SHEETS = new Set(REQUESTED_SHEET_NAMES.map((value) => value.toLowerCase()));

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
        try {
          fs.unlinkSync(dest);
        } catch {}
        reject(error);
      });
  });
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(downloadText(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function logProgress(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(path.join(process.cwd(), 'data', 'sheet-import.log'), line);
  console.log(message);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(value);
      value = '';
      continue;
    }

    if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      while (row.length > 0 && !row[row.length - 1]) row.pop();
      if (row.length > 0) rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ''));
    while (row.length > 0 && !row[row.length - 1]) row.pop();
    if (row.length > 0) rows.push(row);
  }

  return rows;
}

function parseWorkbookViaPowerShell(xlsxPath) {
  const requestedSheetArray = [...REQUESTED_SHEETS];
  const psScript = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path '${xlsxPath.replace(/'/g, "''")}'))
$requested = @(${requestedSheetArray.map((name) => `'${name.replace(/'/g, "''")}'`).join(',')})
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
  if ($requested.Count -gt 0 -and -not ($requested -contains $name.ToLowerInvariant())) { continue }
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
    const headerSet = new Set(headers);
    const score = keywords.reduce((sum, keyword) => sum + (headers.some((header) => header.includes(keyword)) ? 1 : 0), 0);
    if (score > best.score || (score === best.score && headerSet.size > headers.length / 2)) {
      best = { index, score };
    }
  });
  return best.score >= 2 ? best.index : -1;
}

function buildHeaderMap(headerRow) {
  return headerRow.map((cell, index) => ({ index, original: cleanValue(cell), normalized: normalizeHeader(cell) }));
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

function sanitizeLabel(value) {
  const label = slugify(value).replace(/-/g, '_');
  return label && label.length <= 40 ? label : '';
}

function buildIssueRecord(sheetName, headerMap, row) {
  const inferredCreatedAt = extractRowCreatedDate(row);
  const raw = {
    date: inferredCreatedAt ? parseExcelDate(inferredCreatedAt.slice(0, 10)) : '',
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
    titleSource: getByHeader(row, headerMap, [
      /^issue description$/,
      /^description of bug$/,
      /^description$/,
      /^issues implementation descriptions$/,
      /^description implememtation$/,
      /^remarks$/,
      /^relix comments$/,
    ]),
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
  if (!title) return null;

  const metadata = [
    ['Source Tab', sheetName],
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

  const normalizedTitle = cleanValue(title).replace(/\s+/g, ' ').trim();
  const words = normalizedTitle.split(' ').filter(Boolean);
  const hasStrongSignal = Boolean(raw.titleSource || raw.issueType || raw.statusRaw || raw.raisedBy || raw.assigneeRaw || raw.module || raw.feature || raw.devComments || raw.qaComments || raw.steps || raw.reference);
  const isNumericOnly = /^\d+$/.test(normalizedTitle);
  const isGenericHeading = new Set(['ISSUES', 'ISSUE', 'WEB POS']).has(normalizedTitle.toUpperCase());
  const isAllCapsShort = /^[A-Z0-9&'\/\- ]+$/.test(normalizedTitle) && words.length <= 5;
  const normalizedApplication = cleanValue(raw.application).replace(/\s+/g, ' ').trim();
  const applicationLooksLikeSection = /^[A-Z0-9&'\/\- ]+$/.test(normalizedApplication) && normalizedApplication.split(' ').filter(Boolean).length <= 5;
  const matchesSheetLabel = normalizedTitle.toLowerCase() === cleanValue(sheet.name).toLowerCase() || (applicationLooksLikeSection && normalizedTitle.toLowerCase() === normalizedApplication.toLowerCase());
  const isTitleCaseShort = words.length <= 3 && words.every((word) => /^[A-Z][A-Za-z'’-]*$/.test(word));
  if (!normalizedTitle || normalizedTitle === 'PENDING ISSUES / IMPLEMENTATIONS') return null;
  if (!hasStrongSignal && (isNumericOnly || isGenericHeading || matchesSheetLabel || isAllCapsShort || isTitleCaseShort)) return null;

  return {
    title: title.length > 500 ? title.slice(0, 497) + '...' : title,
    description,
    sourceCreatedAt: inferredCreatedAt,
    type: mapType(raw.issueType),
    priority: mapPriority(raw.priorityRaw),
    status: mapStatus(raw.statusRaw),
    reporterName: raw.raisedBy,
    assigneeNames: splitNames(raw.assigneeRaw),
    assigneeRaw: raw.assigneeRaw,
    labels,
    referenceLink: cleanValue(raw.reference).startsWith('http') ? cleanValue(raw.reference) : '',
    curlCommand: '',
    raw,
  };
}

function normalizeSheets(workbook) {
  return workbook
    .filter((sheet) => !IGNORED_SHEETS.has(sheet.name))
    .filter((sheet) => REQUESTED_SHEETS.size === 0 || REQUESTED_SHEETS.has(sheet.name.toLowerCase()))
    .map((sheet) => {
      const headerIndex = findHeaderRowIndex(sheet.rows || []);
      if (headerIndex < 0) return { name: sheet.name, state: sheet.state, issues: [] };
      const headerMap = buildHeaderMap(sheet.rows[headerIndex]);
      const issues = (sheet.rows || [])
        .slice(headerIndex + 1)
        .map((row) => buildIssueRecord(sheet.name, headerMap, row))
        .filter(Boolean)
        .filter((issue) => issue.title && issue.title !== 'PENDING ISSUES / IMPLEMENTATIONS');
      return { name: sheet.name, state: sheet.state, issues };
    })
    .filter((sheet) => sheet.issues.length > 0);
}

async function loadRequestedSheetsFromCsv() {
  const sheets = [];
  for (const sheetName of REQUESTED_SHEET_NAMES) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    logProgress(`Downloading CSV for sheet ${sheetName}`);
    const csvText = await downloadText(url);
    sheets.push({
      name: sheetName,
      state: 'visible',
      rows: parseCsv(csvText),
    });
  }
  return sheets;
}

function chunk(array, size) {
  const parts = [];
  for (let index = 0; index < array.length; index += size) {
    parts.push(array.slice(index, index + size));
  }
  return parts;
}

async function getTargetOrg(client) {
  const { rows } = await client.query(
    `
      SELECT o.*
      FROM organizations o
      LEFT JOIN projects p ON p.org_id = o.id
      WHERE LOWER(o.name) = LOWER($1)
         OR (LOWER(p.name) = LOWER($2) AND LOWER(o.name) = LOWER($1))
      ORDER BY o.created_at ASC
      LIMIT 1
    `,
    [TARGET_ORG_NAME, WEBPOS_PROJECT_NAME]
  );
  if (!rows[0]) throw new Error(`Organization "${TARGET_ORG_NAME}" not found`);
  return rows[0];
}

async function getSystemRoleId(client, roleName) {
  const { rows } = await client.query('SELECT id FROM roles WHERE org_id IS NULL AND LOWER(name) = LOWER($1) LIMIT 1', [roleName]);
  return rows[0]?.id || null;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const workbookPath = path.join(process.cwd(), 'sheet.xlsx');
  if (!fs.existsSync(workbookPath)) {
    await download(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`, workbookPath);
  }

  const workbook = REQUESTED_SHEETS.size > 0
    ? await loadRequestedSheetsFromCsv()
    : parseWorkbookViaPowerShell(workbookPath);
  logProgress(`Workbook extracted (${workbook.length} sheet payloads)`);
  const normalizedSheets = normalizeSheets(workbook);
  logProgress(`Normalized sheets: ${normalizedSheets.map((sheet) => `${sheet.name}:${sheet.issues.length}`).join(', ')}`);
  if (normalizedSheets.length === 0) throw new Error('No issue sheets found in workbook');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const summary = {
    createdProjects: [],
    reusedProjects: [],
    createdUsers: [],
    reusedUsers: [],
    importedIssues: {},
    skippedIssues: {},
  };

  await client.connect();
  try {
    const org = await getTargetOrg(client);

    const existingProjectsResult = await client.query('SELECT * FROM projects WHERE org_id = $1 ORDER BY created_at ASC', [org.id]);
    const projectByName = new Map(existingProjectsResult.rows.map((row) => [row.name.toLowerCase(), row]));
    const usedKeys = new Set(existingProjectsResult.rows.map((row) => String(row.key).toUpperCase()));

    const existingUsersResult = await client.query('SELECT * FROM users WHERE org_id = $1 ORDER BY created_at ASC', [org.id]);
    const userByName = new Map(existingUsersResult.rows.map((row) => [row.name.toLowerCase(), row]));
    const usedEmails = new Set(existingUsersResult.rows.map((row) => row.email.toLowerCase()));
    const developerRoleId = await getSystemRoleId(client, 'developer');

    const allUserNames = [
      ...new Set(
        normalizedSheets.flatMap((sheet) =>
          sheet.issues.flatMap((issue) => [
            ...issue.assigneeNames.map((name) => titleCase(name)).filter(Boolean),
            titleCase(issue.reporterName || ''),
          ].filter(Boolean))
        )
      ),
    ];

    await client.query('BEGIN');
    try {
      logProgress(`Preparing users for ${allUserNames.length} assignee/reporter names`);
      for (const personName of allUserNames) {
        if (userByName.has(personName.toLowerCase())) {
          summary.reusedUsers.push({
            name: userByName.get(personName.toLowerCase()).name,
            email: userByName.get(personName.toLowerCase()).email,
          });
          continue;
        }

        const email = makePlaceholderEmail(personName, usedEmails);
        const { rows } = await client.query(
          `INSERT INTO users (org_id, name, email, avatar, color, password_hash, role)
           VALUES ($1, $2, $3, $4, $5, NULL, 'developer')
           RETURNING *`,
          [org.id, personName, email, getInitials(personName), makeColor(personName)]
        );
        const user = rows[0];
        userByName.set(user.name.toLowerCase(), user);
        summary.createdUsers.push({ name: user.name, email: user.email });

        if (developerRoleId) {
          await client.query(
            `INSERT INTO user_roles (user_id, role_id, org_id, project_id)
             SELECT $1, $2, $3, NULL
             WHERE NOT EXISTS (
               SELECT 1
               FROM user_roles
               WHERE user_id = $1
                 AND role_id = $2
                 AND org_id = $3
                 AND project_id IS NULL
             )`,
            [user.id, developerRoleId, org.id]
          );
        }
      }
      await client.query('COMMIT');
      logProgress('User preparation committed');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    for (const sheet of normalizedSheets) {
      logProgress(`Processing sheet: ${sheet.name} (${sheet.issues.length} rows)`);
      await client.query('BEGIN');
      try {
      const desiredName = sheet.name === 'WEB POS' ? 'webPOS' : sheet.name;
      let project = projectByName.get(desiredName.toLowerCase());
      if (!project) {
        const key = makeProjectKey(desiredName, usedKeys);
        const { rows } = await client.query(
          `INSERT INTO projects (org_id, name, key, description, color)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [org.id, desiredName, key, `${desiredName} issues imported from Google Sheet`, makeColor(desiredName)]
        );
        project = rows[0];
        projectByName.set(project.name.toLowerCase(), project);
        summary.createdProjects.push({ name: project.name, key: project.key });
      } else {
        summary.reusedProjects.push({ name: project.name, key: project.key });
      }

      await client.query(
        'INSERT INTO project_sequences (project_id, next_num) VALUES ($1, 1) ON CONFLICT (project_id) DO NOTHING',
        [project.id]
      );

      const existingBugFingerprints = new Set(
        (
          await client.query(
            'SELECT lower(trim(title)) AS title, md5(coalesce(description, \'\')) AS description_hash FROM bugs WHERE org_id = $1 AND project_id = $2',
            [org.id, project.id]
          )
        ).rows.map((row) => `${row.title}::${row.description_hash}`)
      );

      const rowsToInsert = [];
      let skipped = 0;

      for (const issue of sheet.issues) {
        const fingerprint = `${issue.title.trim().toLowerCase()}::${crypto.createHash('md5').update(issue.description).digest('hex')}`;
        if (existingBugFingerprints.has(fingerprint)) {
          skipped += 1;
          continue;
        }

        existingBugFingerprints.add(fingerprint);
        const assigneeName = issue.assigneeNames[0] ? titleCase(issue.assigneeNames[0]) : '';
        const assigneeId = assigneeName ? userByName.get(assigneeName.toLowerCase())?.id || null : null;
        const reporterName = titleCase(issue.reporterName || '');
        const reporterId = reporterName ? userByName.get(reporterName.toLowerCase())?.id || null : null;
        rowsToInsert.push({
          title: issue.title,
          description: issue.description,
          type: issue.type,
          priority: issue.priority,
          status: issue.status,
          assigneeId,
          reporterId,
          labels: issue.labels,
          referenceLink: issue.referenceLink,
          curlCommand: issue.curlCommand,
          sourceCreatedAt: issue.sourceCreatedAt,
        });
      }

      let imported = 0;
      if (rowsToInsert.length > 0) {
        logProgress(`Prepared ${rowsToInsert.length} inserts for ${sheet.name}; skipped ${skipped}`);
        const sequenceResult = await client.query('SELECT next_num FROM project_sequences WHERE project_id = $1', [project.id]);
        let nextNumber = Number(sequenceResult.rows[0]?.next_num || 1);
        const numberedRows = rowsToInsert.map((row) => {
          const issueNumber = nextNumber++;
          return {
            ...row,
            key: `${project.key}-${issueNumber}`,
          };
        });

        for (const batch of chunk(numberedRows, 250)) {
          logProgress(`Inserting batch of ${batch.length} into ${sheet.name}`);
          const values = [];
          const placeholders = batch.map((row, index) => {
            const offset = index * 16;
            values.push(
              org.id,
              row.key,
              project.id,
              row.title,
              row.description,
              row.type,
              row.priority,
              row.status,
              row.assigneeId,
              row.reporterId,
              row.labels,
              JSON.stringify([]),
              row.referenceLink,
              row.curlCommand,
              row.sourceCreatedAt,
              row.sourceCreatedAt
            );
            return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12},$${offset + 13},$${offset + 14},$${offset + 15},COALESCE($${offset + 16}, NOW()))`;
          });

          await client.query(
            `
              INSERT INTO bugs (
                org_id, key, project_id, title, description, type, priority, status,
                assignee_id, reporter_id, labels, attachments, reference_link, curl_command,
                source_created_at, created_at
              )
              VALUES ${placeholders.join(',')}
            `,
            values
          );
          imported += batch.length;
        }

        await client.query('UPDATE project_sequences SET next_num = $2 WHERE project_id = $1', [project.id, nextNumber]);
      }

      summary.importedIssues[project.name] = imported;
      summary.skippedIssues[project.name] = skipped;
      await client.query('COMMIT');
      logProgress(`Committed sheet ${sheet.name}: imported ${imported}, skipped ${skipped}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    summary.createdUsers = summary.createdUsers.filter(
      (value, index, array) => array.findIndex((item) => item.email === value.email) === index
    );
    summary.reusedUsers = summary.reusedUsers.filter(
      (value, index, array) => array.findIndex((item) => item.email === value.email) === index
    );

    fs.writeFileSync(path.join(process.cwd(), 'data', 'sheet-import-summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
