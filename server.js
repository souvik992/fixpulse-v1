require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('./db');
const { sendAssigneeNotification, sendPasswordResetEmail } = require('./utils/email');
const { randomUUID } = require('crypto');
const { PERMISSIONS } = require('./rbac/permissions');
const { checkPermission, assignSystemRole, getUserPermissions, LEGACY_TO_RBAC } = require('./rbac/middleware');
const { startGoogleSheetSync, getGoogleSheetSyncStatus, triggerGoogleSheetSync } = require('./services/googleSheetSync');
const { addProjectTabToSheet, exportOrgToXlsxBuffer, pushToAppsScript, pushNewTabToAppsScript } = require('./services/sheetExport');
const redisClient = require('./db/redis');
const cache       = require('./db/cache');
const presence    = require('./services/presence');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bugtracker_dev_secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

if (JWT_SECRET === 'bugtracker_dev_secret') {
  console.warn('⚠️  WARNING: JWT_SECRET is using the insecure default. Set JWT_SECRET in your .env file before deploying to production.');
}

// Security headers
app.use(helmet({ contentSecurityPolicy: false })); // CSP off — app uses inline Babel/React from CDN

// CORS — restrict to configured origin in production
const CORS_ORIGIN = process.env.CORS_ORIGIN;
if (!CORS_ORIGIN && process.env.NODE_ENV === 'production') {
  console.warn('⚠️  WARNING: CORS_ORIGIN not set. Allowing all origins in production is insecure.');
}
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN.split(',') } : {}));

app.use(compression());
// 25 MB covers multiple image attachments as base64 data URLs; for large file uploads consider object storage
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));
app.use('/doc', express.static(path.join(__dirname, 'doc'), { maxAge: '1h', etag: true }));

// Health check — no auth, used by load balancers and uptime monitors
app.get('/health', (_req, res) => res.json({ ok: true, uptime: Math.floor(process.uptime()) }));

// Rate limiters
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Rate limit expensive export/push endpoints
const exportLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/sheet-export', exportLimiter);
app.use('/api/sheet-push', exportLimiter);

function hasTokenMarkerCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader.split(';').some((part) => part.trim() === 'bt_has_token=1');
}

const camel = (row) => {
  if (!row) return null;
  const output = {};
  for (const key of Object.keys(row)) {
    output[key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())] = row[key];
  }
  return output;
};

const camels = (rows) => rows.map(camel);
const strip = (user) => {
  if (!user) return null;
  const { passwordHash, password_hash, ...safeUser } = user;
  return safeUser;
};

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const PLAN_DEFINITIONS = {
  basic: { code: 'basic', name: 'Basic', userLimit: 10, priceLabel: 'Free / month', amountPaise: 0 },
  plus: { code: 'plus', name: 'Plus', userLimit: 50, priceLabel: 'Rs 2,999 / month', amountPaise: 299900 },
  enterprise: { code: 'enterprise', name: 'Enterprise', userLimit: null, priceLabel: 'Rs 9,999 / month', amountPaise: 999900 },
};
const DEFAULT_PLAN_CODE = 'enterprise';
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || '';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
const razorpayConfigured = Boolean(
  razorpayKeyId &&
  razorpayKeySecret &&
  !razorpayKeyId.startsWith('your_') &&
  !razorpayKeySecret.startsWith('your_')
);
const razorpay = razorpayConfigured
  ? new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret })
  : null;

function normalizePlan(planCode) {
  return PLAN_DEFINITIONS[planCode] || PLAN_DEFINITIONS[DEFAULT_PLAN_CODE];
}

function buildOrgPayload(orgRow) {
  const org = camel(orgRow);
  const plan = normalizePlan(org.planCode);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    color: org.color,
    logo: org.logo || '',
    planCode: plan.code,
    planName: plan.name,
    userLimit: plan.userLimit,
    priceLabel: plan.priceLabel,
    amountPaise: plan.amountPaise,
    currentUserCount: org.currentUserCount ?? undefined,
    dataSourceType: org.dataSourceType || '',
    dataSourceUrl: org.dataSourceUrl || '',
    dataSourceSheetId: org.dataSourceSheetId || '',
    dataSourceFileName: org.dataSourceFileName || '',
    dataSourceSyncEnabled: Boolean(org.dataSourceSyncEnabled),
    dataSourceLastSyncedAt: org.dataSourceLastSyncedAt || null,
    dataSourceLastError: org.dataSourceLastError || null,
    appsScriptUrl: org.appsScriptUrl || '',
  };
}

function extractGoogleSheetId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return '';
}

function getMetadataLineValue(description, label) {
  const prefix = `${label}:`;
  return String(description || '')
    .split('\n')
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim() || '';
}

function isPseudoSheetIssueRow(bug) {
  const description = String(bug?.description || '');
  if (!description.includes('Source Tab:')) return false;
  const title = String(bug?.title || '').trim();
  if (!title) return true;

  const hasStrongSignal = [
    'Raised By:',
    'Issue Type:',
    'Assignee(s):',
    'Status (Original):',
    'Module:',
    'Feature:',
    'Developer Comments:',
    'QA Comments:',
    'Steps To Reproduce:',
    'Reference',
  ].some((marker) => description.includes(marker));
  if (hasStrongSignal) return false;

  const sourceTab = getMetadataLineValue(description, 'Source Tab');
  const application = getMetadataLineValue(description, 'Application');
  const normalizedTitle = title.replace(/\s+/g, ' ').trim();
  const normalizedSourceTab = sourceTab.replace(/\s+/g, ' ').trim();
  const normalizedApplication = application.replace(/\s+/g, ' ').trim();
  const words = normalizedTitle.split(' ').filter(Boolean);
  const isNumericOnly = /^\d+$/.test(normalizedTitle);
  const isGenericHeading = new Set(['ISSUES', 'ISSUE', 'WEB POS', 'M- RMS APP']).has(normalizedTitle.toUpperCase());
  const isAllCapsShort = /^[A-Z0-9&'\/\- ]+$/.test(normalizedTitle) && words.length <= 5;
  const applicationLooksLikeSection = /^[A-Z0-9&'\/\- ]+$/.test(normalizedApplication) && normalizedApplication.split(' ').filter(Boolean).length <= 5;
  const matchesSheetLabel =
    normalizedTitle.toLowerCase() === normalizedSourceTab.toLowerCase() ||
    (applicationLooksLikeSection && normalizedTitle.toLowerCase() === normalizedApplication.toLowerCase());
  const isTitleCaseShort = words.length <= 3 && words.every((word) => /^[A-Z][A-Za-z'’-]*$/.test(word));

  return isNumericOnly || isGenericHeading || matchesSheetLabel || isAllCapsShort || isTitleCaseShort;
}

function normalizeOrgDataSource(payload = {}, existing = {}) {
  const next = {
    dataSourceType: String(payload.dataSourceType || '').trim(),
    dataSourceUrl: String(payload.dataSourceUrl || '').trim(),
    dataSourceFileName: String(payload.dataSourceFileName || '').trim(),
    dataSourceFileData: payload.dataSourceFileData || null,
    dataSourceSyncEnabled: payload.dataSourceSyncEnabled === undefined
      ? Boolean(existing.data_source_sync_enabled)
      : Boolean(payload.dataSourceSyncEnabled),
  };

  if (!next.dataSourceType) {
    return {
      dataSourceType: null,
      dataSourceUrl: null,
      dataSourceSheetId: null,
      dataSourceFileName: null,
      dataSourceFileData: null,
      dataSourceSyncEnabled: false,
    };
  }

  if (next.dataSourceType === 'google_sheet') {
    const sheetId = extractGoogleSheetId(next.dataSourceUrl);
    if (!sheetId) throw new Error('Enter a valid Google Sheet link');
    return {
      dataSourceType: 'google_sheet',
      dataSourceUrl: next.dataSourceUrl,
      dataSourceSheetId: sheetId,
      dataSourceFileName: null,
      dataSourceFileData: null,
      dataSourceSyncEnabled: next.dataSourceSyncEnabled,
    };
  }

  if (!['xlsx', 'csv'].includes(next.dataSourceType)) {
    throw new Error('Unsupported data source type');
  }

  const hasNewUpload = Boolean(next.dataSourceFileData);
  if (hasNewUpload && !String(next.dataSourceFileData).startsWith('data:')) {
    throw new Error('Invalid spreadsheet upload');
  }
  if (!hasNewUpload && !existing.data_source_file_data) {
    throw new Error('Upload an Excel or CSV file');
  }

  return {
    dataSourceType: next.dataSourceType,
    dataSourceUrl: null,
    dataSourceSheetId: null,
    dataSourceFileName: next.dataSourceFileName || existing.data_source_file_name || null,
    dataSourceFileData: hasNewUpload ? next.dataSourceFileData : existing.data_source_file_data || null,
    dataSourceSyncEnabled: next.dataSourceSyncEnabled,
  };
}

async function createUserNotification({ orgId, userId, bugId = null, type = 'assignment', title, message = '', metadata = {} }) {
  if (!orgId || !userId || !title) return null;
  const { rows } = await db.query(
    `INSERT INTO notifications (org_id, user_id, bug_id, type, title, message, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING *`,
    [orgId, userId, bugId, type, title, message, JSON.stringify(metadata || {})]
  );
  return camel(rows[0]);
}

async function notifyBugAssignment({ orgId, bug, assigneeId, actorName, reason }) {
  if (!orgId || !bug?.id || !assigneeId) return null;
  const projectName = bug.projectName || bug.project_name || '';
  const key = bug.key || '';
  const title = reason === 'created' ? 'New issue assigned' : 'Issue assigned to you';
  const message = [
    key ? `${key}:` : '',
    bug.title,
    actorName ? `by ${actorName}` : '',
  ].filter(Boolean).join(' ');
  return createUserNotification({
    orgId,
    userId: assigneeId,
    bugId: bug.id,
    type: 'assignment',
    title,
    message,
    metadata: {
      reason,
      bugKey: key,
      bugTitle: bug.title,
      projectId: bug.projectId || bug.project_id || null,
      projectName,
      status: bug.status || null,
      priority: bug.priority || null,
    },
  });
}

async function getOrgPlanState(orgId) {
  const { rows } = await db.query('SELECT id, plan_code, user_limit FROM organizations WHERE id=$1', [orgId]);
  if (!rows.length) return null;
  const row = camel(rows[0]);
  const plan = normalizePlan(row.planCode);
  return { planCode: plan.code, userLimit: row.userLimit ?? plan.userLimit };
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

async function getBugContext(bugId, orgId) {
  const { rows } = await db.query(
    `SELECT b.id, b.project_id, b.assignee_id, b.status, p.custom_issue_fields
     FROM bugs b
     LEFT JOIN projects p ON p.id = b.project_id
     WHERE b.id=$1 AND b.org_id=$2`,
    [bugId, orgId]
  );
  return rows[0] || null;
}

async function getProjectContext(projectId, orgId) {
  const { rows } = await db.query(
    'SELECT * FROM projects WHERE id=$1 AND org_id=$2',
    [projectId, orgId]
  );
  return rows[0] || null;
}

async function getScopedPermissions(req, projectId = null) {
  const perms = await getUserPermissions(req.user.id, req.user.orgId, projectId);
  req.userPermissions = perms;
  return perms;
}

async function getAssignableRole(roleId, orgId) {
  const { rows } = await db.query(
    'SELECT * FROM roles WHERE id=$1 AND (org_id=$2 OR (is_system=true AND org_id IS NULL))',
    [roleId, orgId]
  );
  return rows[0] || null;
}

async function assertUserInOrg(userId, orgId) {
  const { rows } = await db.query('SELECT id FROM users WHERE id=$1 AND org_id=$2', [userId, orgId]);
  return rows.length > 0;
}

function denyMissingPermission(res, permission) {
  return res.status(403).json({
    error: `Forbidden - ${permission} permission required`,
    required: permission,
  });
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name || 'attachment'),
      type: String(item.type || 'application/octet-stream'),
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
      dataUrl: String(item.dataUrl || ''),
    }))
    .filter((item) => item.dataUrl.startsWith('data:'));
}

const ALLOWED_CUSTOM_FIELD_TYPES = new Set(['text', 'textarea', 'select', 'date']);

function sanitizeFieldId(value) {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || `field_${Date.now().toString(36)}`;
}

function sanitizeColor(value, fallback = '#6366f1') {
  const text = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

function sanitizeProjectCustomFields(fields) {
  if (!Array.isArray(fields)) return [];
  const seen = new Set();
  return fields
    .map((field, index) => {
      const label = String(field?.label || '').trim().slice(0, 80);
      const type = ALLOWED_CUSTOM_FIELD_TYPES.has(field?.type) ? field.type : 'text';
      if (!label) return null;
      let id = sanitizeFieldId(field?.id || label);
      while (seen.has(id)) id = `${id}_${index + 1}`;
      seen.add(id);
      const options = type === 'select' && Array.isArray(field?.options)
        ? field.options
          .map((option, optionIndex) => {
            const optionLabel = String(option?.label || '').trim().slice(0, 60);
            if (!optionLabel) return null;
            return {
              id: sanitizeFieldId(option?.id || `${label}_${optionIndex + 1}`),
              label: optionLabel,
              color: sanitizeColor(option?.color, '#94a3b8'),
            };
          })
          .filter(Boolean)
          .slice(0, 25)
        : [];
      return {
        id,
        label,
        type,
        required: Boolean(field?.required),
        options,
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

function sanitizeCustomFieldValues(values, schema) {
  const input = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const output = {};
  for (const field of sanitizeProjectCustomFields(schema)) {
    const raw = input[field.id];
    if (raw === undefined || raw === null || raw === '') continue;
    if (field.type === 'select') {
      const allowed = new Set((field.options || []).map((option) => option.label));
      const normalized = String(raw).trim();
      if (allowed.has(normalized)) output[field.id] = normalized;
      continue;
    }
    if (field.type === 'date') {
      const normalized = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) output[field.id] = normalized;
      continue;
    }
    output[field.id] = String(raw).trim().slice(0, field.type === 'textarea' ? 4000 : 500);
  }
  return output;
}

function canManageCustomFields(user) {
  return ['admin', 'project_manager', 'qa', 'tester'].includes(String(user?.role || '').toLowerCase());
}

async function enforceIssueWritePermissions(req, bug, changes) {
  const perms = await getScopedPermissions(req, bug.project_id);

  if (!perms.has(PERMISSIONS.MANAGE_PROJECT) && bug.assignee_id !== req.user.id) {
    return { status: 403, body: { error: 'You can only modify issues assigned to you' } };
  }

  const required = new Set();
  const editableFields = ['title', 'description', 'type', 'priority', 'labels', 'attachments', 'referenceLink', 'curlCommand', 'customFields'];

  if (editableFields.some((field) => changes[field] !== undefined)) {
    required.add(PERMISSIONS.EDIT_ISSUE);
  }
  if (changes.status !== undefined && String(changes.status) !== String(bug.status)) {
    required.add(PERMISSIONS.CHANGE_STATUS);
  }
  if (changes.assigneeId !== undefined || changes.assignee_id !== undefined) {
    required.add(PERMISSIONS.ASSIGN_ISSUE);
  }

  for (const permission of required) {
    if (!perms.has(permission)) {
      return {
        status: 403,
        body: {
          error: `Forbidden - ${permission} permission required`,
          required: permission,
        },
      };
    }
  }

  return { perms };
}


app.post('/api/auth/register-company', async (req, res) => {
  try {
    const { companyName, name, email, password, color = '#6366f1', avatarDataUrl, orgLogoDataUrl } = req.body;
    if (!companyName || !name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (avatarDataUrl && !avatarDataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid avatar data URL' });
    if (orgLogoDataUrl && !orgLogoDataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid organization logo data URL' });

    const hash = await bcrypt.hash(password, 10);
    const avatar = avatarDataUrl || '';
    let slug = slugify(companyName);

    const existingOrg = await db.query('SELECT id FROM organizations WHERE slug=$1', [slug]);
    if (existingOrg.rows.length) {
      slug = `${slug}-${Date.now()}`;
    }

    const emailCheck = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (emailCheck.rows.length) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const {
      rows: [org],
    } = await db.query(
      'INSERT INTO organizations (name,slug,color,logo,plan_code,user_limit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [companyName, slug, color, orgLogoDataUrl || '', DEFAULT_PLAN_CODE, PLAN_DEFINITIONS[DEFAULT_PLAN_CODE].userLimit]
    );

    const {
      rows: [user],
    } = await db.query(
      "INSERT INTO users (org_id,name,email,avatar,color,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6,'admin') RETURNING *", // Use avatarDataUrl if provided, else initials
      [org.id, name, email, avatar, color, hash]
    );
    await assignSystemRole(user.id, 'Admin', org.id);

    const token = jwt.sign(
      { id: user.id, orgId: org.id, email: user.email, name: user.name, role: 'admin' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({ token, user: strip(camel(user)), org: buildOrgPayload(org) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { rows } = await db.query(
      `SELECT u.*,
              o.name AS org_name,
              o.slug AS org_slug,
              o.color AS org_color,
              o.logo AS org_logo,
              o.plan_code AS org_plan_code,
              o.user_limit AS org_user_limit,
              o.data_source_type AS org_data_source_type,
              o.data_source_url AS org_data_source_url,
              o.data_source_sheet_id AS org_data_source_sheet_id,
              o.data_source_file_name AS org_data_source_file_name,
              o.data_source_sync_enabled AS org_data_source_sync_enabled,
              o.data_source_last_synced_at AS org_data_source_last_synced_at,
              o.data_source_last_error AS org_data_source_last_error,
              o.apps_script_url AS org_apps_script_url
       FROM users u
       JOIN organizations o ON o.id=u.org_id
       WHERE u.email=$1`,
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const row = rows[0];
    if (!row.password_hash) {
      return res.status(401).json({ error: 'No password set - please ask your admin to reset it' });
    }
    if (!(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = camel(row);
    const org = buildOrgPayload({
      id: user.orgId,
      name: user.orgName,
      slug: user.orgSlug,
      color: user.orgColor,
      logo: user.orgLogo || '',
      plan_code: user.orgPlanCode,
      user_limit: user.orgUserLimit,
      data_source_type: user.orgDataSourceType,
      data_source_url: user.orgDataSourceUrl,
      data_source_sheet_id: user.orgDataSourceSheetId,
      data_source_file_name: user.orgDataSourceFileName,
      data_source_sync_enabled: user.orgDataSourceSyncEnabled,
      data_source_last_synced_at: user.orgDataSourceLastSyncedAt,
      data_source_last_error: user.orgDataSourceLastError,
      apps_script_url: user.orgAppsScriptUrl,
    });
    const token = jwt.sign(
      { id: user.id, orgId: user.orgId, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({ token, user: strip(user), org });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.*,
              o.name AS org_name,
              o.slug AS org_slug,
              o.color AS org_color,
              o.logo AS org_logo,
              o.plan_code AS org_plan_code,
              o.user_limit AS org_user_limit,
              o.data_source_type AS org_data_source_type,
              o.data_source_url AS org_data_source_url,
              o.data_source_sheet_id AS org_data_source_sheet_id,
              o.data_source_file_name AS org_data_source_file_name,
              o.data_source_sync_enabled AS org_data_source_sync_enabled,
              o.data_source_last_synced_at AS org_data_source_last_synced_at,
              o.data_source_last_error AS org_data_source_last_error,
              o.apps_script_url AS org_apps_script_url
       FROM users u
       JOIN organizations o ON o.id=u.org_id
       WHERE u.id=$1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    const user = camel(rows[0]);
    const org = buildOrgPayload({
      id: user.orgId,
      name: user.orgName,
      slug: user.orgSlug,
      color: user.orgColor,
      logo: user.orgLogo || '',
      plan_code: user.orgPlanCode,
      user_limit: user.orgUserLimit,
      data_source_type: user.orgDataSourceType,
      data_source_url: user.orgDataSourceUrl,
      data_source_sheet_id: user.orgDataSourceSheetId,
      data_source_file_name: user.orgDataSourceFileName,
      data_source_sync_enabled: user.orgDataSourceSyncEnabled,
      data_source_last_synced_at: user.orgDataSourceLastSyncedAt,
      data_source_last_error: user.orgDataSourceLastError,
      apps_script_url: user.orgAppsScriptUrl,
    });
    res.json({ user: strip(user), org });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/auth/me', auth, async (req, res) => {
  try {
    const { name, email, mobileNumber, avatarDataUrl, pin } = req.body;
    if (avatarDataUrl && !avatarDataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid avatar data URL' });
    }
    if (email) {
      const emailCheck = await db.query('SELECT id FROM users WHERE email=$1 AND id<>$2', [email, req.user.id]);
      if (emailCheck.rows.length) {
        return res.status(409).json({ error: 'Email already exists' });
      }
    }
    let passwordHash = null;
    if (pin !== undefined && pin !== null && String(pin).trim() !== '') {
      const normalizedPin = String(pin).trim();
      if (!/^\d{4,10}$/.test(normalizedPin)) {
        return res.status(400).json({ error: 'Login PIN must be 4 to 10 digits' });
      }
      passwordHash = await bcrypt.hash(normalizedPin, 10);
    }
    const { rows } = await db.query(
      `UPDATE users
       SET name=COALESCE($1,name),
           email=COALESCE($2,email),
           mobile_number=COALESCE($3,mobile_number),
           avatar=COALESCE($4,avatar),
           password_hash=COALESCE($5,password_hash)
       WHERE id=$6
       RETURNING *`,
      [name, email, mobileNumber, avatarDataUrl, passwordHash, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(strip(camel(rows[0])));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/auth/me/photo', auth, async (req, res) => {
  try {
    const { avatarDataUrl } = req.body;
    if (avatarDataUrl && !avatarDataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid avatar data URL' });
    }
    const { rows } = await db.query(
      'UPDATE users SET avatar=COALESCE($1,avatar) WHERE id=$2 RETURNING *',
      [avatarDataUrl, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(strip(camel(rows[0])));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', (_, res) => res.json({ success: true }));

app.get('/api/plans', auth, async (_req, res) => {
  res.json(Object.values(PLAN_DEFINITIONS));
});

app.get('/api/notifications', auth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const unreadOnly = String(req.query.unreadOnly || '') === '1';
    const since = String(req.query.since || '').trim();
    const values = [req.user.id];
    const filters = ['n.user_id = $1'];

    if (unreadOnly) {
      values.push(false);
      filters.push(`n.is_read = $${values.length}`);
    }
    if (since) {
      values.push(new Date(since).toISOString());
      filters.push(`n.created_at > $${values.length}`);
    }

    values.push(limit);
    const { rows } = await db.query(
      `SELECT n.*,
              b.key AS bug_key,
              b.title AS bug_title,
              p.name AS project_name
       FROM notifications n
       LEFT JOIN bugs b ON b.id = n.bug_id
       LEFT JOIN projects p ON p.id = b.project_id
       WHERE ${filters.join(' AND ')}
       ORDER BY n.created_at DESC
       LIMIT $${values.length}`,
      values
    );
    const { rows: unreadRows } = await db.query(
      'SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [req.user.id]
    );
    res.json({
      items: camels(rows),
      unreadCount: unreadRows[0]?.unread_count || 0,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notifications/:id/read', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE notifications
       SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    const { rows: unreadRows } = await db.query(
      'SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [req.user.id]
    );
    res.json({ item: camel(rows[0]), unreadCount: unreadRows[0]?.unread_count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notifications/read-all', auth, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE, read_at = COALESCE(read_at, NOW()) WHERE user_id = $1 AND is_read = FALSE',
      [req.user.id]
    );
    res.json({ success: true, unreadCount: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const { rows } = await db.query('SELECT id, name, email FROM users WHERE email=$1', [email]);
    // Always respond OK to prevent email enumeration
    if (!rows.length) return res.json({ success: true });

    const user  = rows[0];
    const token = randomUUID().replace(/-/g, '');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user.id]);
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, token, expires]
    );

    const appUrl  = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetUrl = `${appUrl}?reset_token=${token}`;

    await sendPasswordResetEmail({ toEmail: user.email, toName: user.name, resetUrl });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { rows } = await db.query(
      'SELECT * FROM password_reset_tokens WHERE token=$1 AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Reset link is invalid or has expired' });

    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, rows[0].user_id]);
    await db.query('DELETE FROM password_reset_tokens WHERE token=$1', [token]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/org', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT o.*, (
         SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id
       ) AS current_user_count
       FROM organizations o
       WHERE o.id=$1`,
      [req.user.orgId]
    );
    res.json(buildOrgPayload(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/org', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { name, color, logoDataUrl } = req.body;
    if (logoDataUrl && !logoDataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid organization logo data URL' });
    }
    const existingResult = await db.query('SELECT * FROM organizations WHERE id=$1 LIMIT 1', [req.user.orgId]);
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    const sourceConfig = normalizeOrgDataSource(req.body, existing);
    const appsScriptUrl = String(req.body.appsScriptUrl || '').trim();
    const { rows } = await db.query(
      `UPDATE organizations
       SET name=$1,
           color=$2,
           logo=COALESCE($4,logo),
           data_source_type=$5::text,
           data_source_url=$6::text,
           data_source_sheet_id=$7::text,
           data_source_file_name=$8::text,
           data_source_file_data=$9::text,
           data_source_sync_enabled=$10,
           apps_script_url=$11::text,
           data_source_last_error=CASE
             WHEN $5::text IS NULL THEN NULL
             ELSE data_source_last_error
           END
       WHERE id=$3
       RETURNING *`,
      [
        name,
        color,
        req.user.orgId,
        logoDataUrl,
        sourceConfig.dataSourceType,
        sourceConfig.dataSourceUrl,
        sourceConfig.dataSourceSheetId,
        sourceConfig.dataSourceFileName,
        sourceConfig.dataSourceFileData,
        sourceConfig.dataSourceSyncEnabled,
        appsScriptUrl || null,
      ]
    );
    res.json(buildOrgPayload(rows[0]));
  } catch (error) {
    const status = /valid Google Sheet link|Upload an Excel or CSV file|Invalid spreadsheet upload|Unsupported data source/.test(error.message) ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.put('/api/org/plan', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (!PLAN_DEFINITIONS[req.body.planCode]) {
      return res.status(400).json({ error: 'Unsupported plan' });
    }
    const nextPlan = normalizePlan(req.body.planCode);
    if (nextPlan.amountPaise > 0) {
      return res.status(400).json({ error: `Paid activation required for the ${nextPlan.name} plan.` });
    }
    const { rows: counts } = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE org_id=$1', [req.user.orgId]);
    const currentUserCount = counts[0]?.count || 0;
    if (nextPlan.userLimit !== null && currentUserCount > nextPlan.userLimit) {
      return res.status(400).json({ error: `Cannot switch to ${nextPlan.name}. Current team size is ${currentUserCount}, but this plan allows only ${nextPlan.userLimit} users.` });
    }
    await db.query(
      `UPDATE organizations
       SET plan_code=$1, user_limit=$2
       WHERE id=$3`,
      [nextPlan.code, nextPlan.userLimit, req.user.orgId]
    );
    const { rows } = await db.query(
      `SELECT o.*, (
         SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id
       ) AS current_user_count
       FROM organizations o
       WHERE o.id=$1`,
      [req.user.orgId]
    );
    res.json(buildOrgPayload(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/billing/create-order', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (!razorpayConfigured || !razorpay) {
      return res.status(503).json({ error: 'Razorpay is not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' });
    }
    if (!PLAN_DEFINITIONS[req.body.planCode]) {
      return res.status(400).json({ error: 'Unsupported plan' });
    }
    const plan = normalizePlan(req.body.planCode);
    if (plan.amountPaise <= 0) {
      return res.status(400).json({ error: 'This plan does not require payment.' });
    }
    const { rows: counts } = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE org_id=$1', [req.user.orgId]);
    const currentUserCount = counts[0]?.count || 0;
    if (plan.userLimit !== null && currentUserCount > plan.userLimit) {
      return res.status(400).json({ error: `Cannot switch to ${plan.name}. Current team size is ${currentUserCount}, but this plan allows only ${plan.userLimit} users.` });
    }
    const receipt = `plan_${req.user.orgId.replace(/-/g, '').slice(0, 12)}_${Date.now()}`;
    const order = await razorpay.orders.create({
      amount: plan.amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        org_id: req.user.orgId,
        plan_code: plan.code,
        requested_by: req.user.id,
      },
    });
    await db.query(
      `INSERT INTO billing_orders (org_id, plan_code, amount_paise, currency, status, razorpay_order_id, receipt)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user.orgId, plan.code, plan.amountPaise, 'INR', 'created', order.id, receipt]
    );
    res.json({
      keyId: razorpayKeyId,
      orderId: order.id,
      amount: plan.amountPaise,
      currency: 'INR',
      planCode: plan.code,
      planName: plan.name,
      orgName: req.user.orgId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/billing/verify-payment', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (!razorpayConfigured || !razorpayKeySecret) {
      return res.status(503).json({ error: 'Razorpay is not configured yet.' });
    }
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ error: 'Missing Razorpay payment details' });
    }
    const expectedSignature = crypto
      .createHmac('sha256', razorpayKeySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ error: 'Payment signature verification failed' });
    }
    const { rows } = await db.query(
      'SELECT * FROM billing_orders WHERE razorpay_order_id=$1 AND org_id=$2',
      [razorpayOrderId, req.user.orgId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Billing order not found' });
    }
    const billingOrder = camel(rows[0]);
    const plan = normalizePlan(billingOrder.planCode);
    await db.query(
      `UPDATE billing_orders
       SET status='paid', razorpay_payment_id=$1, verified_at=NOW()
       WHERE id=$2`,
      [razorpayPaymentId, billingOrder.id]
    );
    await db.query(
      'UPDATE organizations SET plan_code=$1, user_limit=$2 WHERE id=$3',
      [plan.code, plan.userLimit, req.user.orgId]
    );
    const { rows: orgRows } = await db.query(
      `SELECT o.*, (
         SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id
       ) AS current_user_count
       FROM organizations o
       WHERE o.id=$1`,
      [req.user.orgId]
    );
    res.json(buildOrgPayload(orgRows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/members', auth, async (req, res) => {
  try {
    const cacheKey = `members:${req.user.orgId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await db.query('SELECT * FROM users WHERE org_id=$1 ORDER BY created_at ASC', [
      req.user.orgId,
    ]);
    const result = camels(rows).map(strip);
    await cache.set(cacheKey, result, 60); // 60s TTL
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/members', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { name, email, role = 'developer', color = '#6366f1', password, avatarDataUrl } = req.body;
    const allowedRoles = new Set(['admin', 'project_manager', 'developer', 'frontend_developer', 'backend_developer', 'tester', 'viewer', 'qa']);
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email required' });
    }
    if (!allowedRoles.has(role)) {
      return res.status(400).json({ error: 'Unsupported role' });
    }

    const tempPassword = password || 'Welcome@123';
    const hash = await bcrypt.hash(tempPassword, 10);
    const avatar = avatarDataUrl || '';

    const planState = await getOrgPlanState(req.user.orgId);
    const { rows: countRows } = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE org_id=$1', [req.user.orgId]);
    const currentUserCount = countRows[0]?.count || 0;
    if (planState?.userLimit !== null && currentUserCount >= planState.userLimit) {
      return res.status(403).json({ error: `User limit reached for your ${normalizePlan(planState.planCode).name} plan. Upgrade to add more members.` });
    }

    const exists = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const { rows } = await db.query(
      'INSERT INTO users (org_id,name,email,avatar,color,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user.orgId, name, email, avatar, color, hash, role] // Use avatarDataUrl if provided, else initials
    );

    // Sync RBAC: assign matching system role
    const rbacRole = LEGACY_TO_RBAC[role];
    if (rbacRole) await assignSystemRole(rows[0].id, rbacRole, req.user.orgId);

    await cache.del(`members:${req.user.orgId}`);
    res.status(201).json({ ...strip(camel(rows[0])), tempPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/members/:id', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { name, role, color, avatarDataUrl } = req.body;
    const allowedRoles = new Set(['admin', 'project_manager', 'developer', 'frontend_developer', 'backend_developer', 'tester', 'viewer', 'qa']);
    if (role && !allowedRoles.has(role)) {
      return res.status(400).json({ error: 'Unsupported role' });
    }
    if (avatarDataUrl && !avatarDataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid avatar data URL' });
    const { rows } = await db.query(
      'UPDATE users SET name=COALESCE($1,name),role=COALESCE($2,role),color=COALESCE($3,color),avatar=COALESCE($6,avatar) WHERE id=$4 AND org_id=$5 RETURNING *',
      [name, role, color, req.params.id, req.user.orgId, avatarDataUrl]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Sync RBAC: if role changed, replace global system role assignment
    if (role) {
      const rbacRole = LEGACY_TO_RBAC[role];
      if (rbacRole) {
        // Remove all existing system global roles for this user in this org
        await db.query(
          `DELETE FROM user_roles ur
           USING roles r
           WHERE ur.role_id = r.id AND ur.user_id=$1 AND ur.org_id=$2
             AND r.is_system=true AND ur.project_id IS NULL`,
          [req.params.id, req.user.orgId]
        );
        await assignSystemRole(req.params.id, rbacRole, req.user.orgId);
      }
    }

    await cache.del(`members:${req.user.orgId}`);
    res.json(strip(camel(rows[0])));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/members/:id/reassign', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You can't reassign issues from yourself with this action" });
    }

    const { targetUserId } = req.body || {};
    if (!targetUserId) {
      return res.status(400).json({ error: 'Target member is required' });
    }
    if (targetUserId === req.params.id) {
      return res.status(400).json({ error: 'Choose a different member to reassign issues to' });
    }

    const { rows: sourceRows } = await db.query(
      'SELECT id, name FROM users WHERE id=$1 AND org_id=$2',
      [req.params.id, req.user.orgId]
    );
    if (!sourceRows.length) {
      return res.status(404).json({ error: 'Source member not found' });
    }

    const { rows: targetRows } = await db.query(
      'SELECT id, name FROM users WHERE id=$1 AND org_id=$2',
      [targetUserId, req.user.orgId]
    );
    if (!targetRows.length) {
      return res.status(404).json({ error: 'Target member not found' });
    }

      const { rows: movedBugsBeforeUpdate } = await db.query(
        `SELECT b.id, b.key, b.title, b.project_id, p.name AS project_name, b.status, b.priority
         FROM bugs b
         LEFT JOIN projects p ON p.id = b.project_id
         WHERE b.org_id=$1 AND b.assignee_id=$2`,
        [req.user.orgId, req.params.id]
      );

      const result = await db.query(
        'UPDATE bugs SET assignee_id=$1, updated_at=NOW() WHERE org_id=$2 AND assignee_id=$3',
        [targetUserId, req.user.orgId, req.params.id]
      );

      res.json({
        success: true,
        movedCount: result.rowCount || 0,
        sourceUser: camel(sourceRows[0]),
        targetUser: camel(targetRows[0]),
      });

      Promise.all(movedBugsBeforeUpdate.map((row) => notifyBugAssignment({
          orgId: req.user.orgId,
          bug: camel(row),
          assigneeId: targetUserId,
          actorName: req.user.name,
          reason: 'reassigned',
        })))
        .catch((err) => console.warn('Reassign notification failed:', err.message));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

app.delete('/api/members/:id', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You can't remove yourself" });
    }

    await db.query('DELETE FROM users WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    await cache.del(`members:${req.user.orgId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/members/:id/reset-password', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const tempPassword = req.body.password || 'Welcome@123';
    const hash = await bcrypt.hash(tempPassword, 10);

    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND org_id=$3', [
      hash,
      req.params.id,
      req.user.orgId,
    ]);

    res.json({ success: true, tempPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM projects WHERE org_id=$1 ORDER BY created_at ASC', [
      req.user.orgId,
    ]);
    res.json(camels(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects', auth, checkPermission(PERMISSIONS.MANAGE_PROJECT), async (req, res) => {
  try {
    const { name, key, description = '', color = '#6366f1', customIssueFields = [], sheetHeaders = [] } = req.body;
    const { rows } = await db.query(
      'INSERT INTO projects (org_id,name,key,description,color,sheet_layout_version,custom_issue_fields,sheet_headers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.user.orgId, name, key.toUpperCase(), description, color, 'compact_v2', JSON.stringify(customIssueFields), JSON.stringify(sheetHeaders)]
    );

    const project = camel(rows[0]);
    await db.query(
      'INSERT INTO project_sequences (project_id,next_num) VALUES ($1,1) ON CONFLICT DO NOTHING',
      [project.id]
    );

    // Add tab to linked XLSX (if any) and push to Apps Script (if configured)
    addProjectTabToSheet(req.user.orgId, name, project.sheetLayoutVersion).catch(e => console.error('[sheet] addProjectTab error:', e.message));
    db.query('SELECT apps_script_url FROM organizations WHERE id=$1', [req.user.orgId])
      .then(({ rows: r }) => {
        const url = r[0]?.apps_script_url;
        console.log('[sheet] apps_script_url for org:', url || '(none)');
        if (url) pushNewTabToAppsScript(url, name, project.sheetLayoutVersion, project.customIssueFields || [])
          .then(r => console.log('[sheet] pushNewTab response:', JSON.stringify(r)))
          .catch(e => console.error('[sheet] pushNewTab error:', e.message));
      })
      .catch(e => console.error('[sheet] org query error:', e.message));

    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/projects/:id', auth, checkPermission(PERMISSIONS.MANAGE_PROJECT), async (req, res) => {
  try {
    await db.query('DELETE FROM projects WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/projects/:id/custom-fields', auth, async (req, res) => {
  try {
    const project = await getProjectContext(req.params.id, req.user.orgId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.sheet_layout_version !== 'compact_v2') {
      return res.status(400).json({ error: 'Custom field builder is available only for new projects' });
    }
    if (!canManageCustomFields(req.user)) {
      return res.status(403).json({ error: 'Only admin, project manager, or QA users can manage custom fields' });
    }

    const customFields = sanitizeProjectCustomFields(req.body?.customFields);
    const { rows } = await db.query(
      'UPDATE projects SET custom_issue_fields=$1::jsonb WHERE id=$2 AND org_id=$3 RETURNING *',
      [JSON.stringify(customFields), req.params.id, req.user.orgId]
    );
    res.json(camel(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bugs', auth, checkPermission(PERMISSIONS.VIEW_ISSUE), async (req, res) => {
  try {
    const { projectId, status, priority, type, assigneeId, search, page, pageSize } = req.query;
    const conditions = ['org_id=$1'];
    const values = [req.user.orgId];
    let index = 2;

    if (projectId) {
      conditions.push(`project_id=$${index++}`);
      values.push(projectId);
    }
    if (status) {
      conditions.push(`status=$${index++}`);
      values.push(status);
    }
    if (priority) {
      conditions.push(`priority=$${index++}`);
      values.push(priority);
    }
    if (type) {
      conditions.push(`type=$${index++}`);
      values.push(type);
    }
    if (assigneeId) {
      conditions.push(`assignee_id=$${index++}`);
      values.push(assigneeId);
    }
    if (search) {
      conditions.push(`(title ILIKE $${index} OR description ILIKE $${index++})`);
      values.push(`%${search}%`);
    }

    const whereClause = conditions.join(' AND ');
    const hasPagination = page !== undefined || pageSize !== undefined;
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safePageSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    if (!hasPagination) {
      const { rows } = await db.query(
        `SELECT * FROM bugs WHERE ${whereClause} ORDER BY created_at DESC`,
        values
      );
      return res.json(camels(rows).filter((bug) => !isPseudoSheetIssueRow(bug)));
    }

    const offset = (safePage - 1) * safePageSize;
    const countQuery = db.query(
      `SELECT COUNT(*)::int AS total FROM bugs WHERE ${whereClause}`,
      values
    );
    const pagedQuery = db.query(
      `SELECT * FROM bugs WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${index++} OFFSET $${index++}`,
      [...values, safePageSize, offset]
    );
    const [{ rows: countRows }, { rows }] = await Promise.all([countQuery, pagedQuery]);
    const total = countRows[0]?.total || 0;

    res.json({
      items: camels(rows).filter((bug) => !isPseudoSheetIssueRow(bug)),
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bugs/:id', auth, checkPermission(PERMISSIONS.VIEW_ISSUE, {
  projectId: async (req) => {
    const bug = await getBugContext(req.params.id, req.user.orgId);
    return bug?.project_id || null;
  },
}), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM bugs WHERE id=$1 AND org_id=$2', [
      req.params.id,
      req.user.orgId,
    ]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    const bug = camel(rows[0]);
    const [comments, activity] = await Promise.all([
      db.query('SELECT * FROM comments WHERE bug_id=$1 ORDER BY created_at ASC', [req.params.id]),
      db.query('SELECT * FROM activity WHERE bug_id=$1 ORDER BY created_at ASC', [req.params.id]),
    ]);
    bug.comments = camels(comments.rows);
    bug.activity = camels(activity.rows);

    res.json(bug);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bugs', auth, checkPermission(PERMISSIONS.CREATE_ISSUE, {
  projectId: (req) => req.body.projectId,
}), async (req, res) => {
  try {
    const {
      projectId,
      title,
      description = '',
      type = 'Bug',
      priority = 'Medium',
      status = 'To Do',
      assigneeId,
      labels = [],
      attachments = [],
      referenceLink = '',
      curlCommand = '',
      customFields = {},
    } = req.body;
    const VALID_STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];
    const safeStatus = VALID_STATUSES.includes(status) ? status : 'To Do';
    const reporterId = req.user.id;

    const project = await getProjectContext(projectId, req.user.orgId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const perms = await getScopedPermissions(req, projectId);
    if (assigneeId && !perms.has(PERMISSIONS.ASSIGN_ISSUE)) {
      return denyMissingPermission(res, PERMISSIONS.ASSIGN_ISSUE);
    }

    const sanitizedCustomFields = sanitizeCustomFieldValues(customFields, project.custom_issue_fields);

    const sequence = await db.query(
      'UPDATE project_sequences SET next_num=next_num+1 WHERE project_id=$1 RETURNING next_num-1 AS num',
      [projectId]
    );
    const number = sequence.rows[0]?.num ?? 1;

    const { rows } = await db.query(
      'INSERT INTO bugs (org_id,key,project_id,title,description,type,priority,status,assignee_id,reporter_id,labels,attachments,reference_link,curl_command,custom_fields,last_status_change_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16) RETURNING *',
      [
        req.user.orgId,
        `${project.key}-${number}`,
        projectId,
        title,
        description,
        type,
        priority,
        safeStatus,
        assigneeId || null,
        reporterId,
        labels,
        JSON.stringify(normalizeAttachments(attachments)),
        String(referenceLink || ''),
        String(curlCommand || ''),
        JSON.stringify(sanitizedCustomFields),
        new Date().toISOString(),
      ]
    );

    const bug = { ...camel(rows[0]), projectName: project.name };
    await db.query("INSERT INTO activity (bug_id,user_id,type,note) VALUES ($1,$2,'created','Issue created')", [
      bug.id,
      reporterId,
    ]);

    bug.comments = [];
    bug.activity = [{ type: 'created', note: 'Issue created' }];
    // Invalidate stats cache for this org (project-level and all-projects)
    cache.del(`stats:${req.user.orgId}:all`, `stats:${req.user.orgId}:${projectId}`);
    res.status(201).json(bug);

    // Send email notification to assignee (non-blocking)
    if (assigneeId) {
      notifyBugAssignment({
        orgId: req.user.orgId,
        bug,
        assigneeId,
        actorName: req.user.name,
        reason: 'created',
      }).catch((err) => console.warn('Assignment notification failed:', err.message));
      db.query('SELECT name, email FROM users WHERE id=$1', [assigneeId])
        .then(({ rows }) => {
          if (!rows.length) return;
          return sendAssigneeNotification({
            assigneeEmail: rows[0].email,
            assigneeName:  rows[0].name,
            reporterName:  req.user.name,
            bug,
            appUrl: process.env.APP_URL,
          });
        })
        .catch((err) => console.warn('Email notification failed:', err.message));
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/bugs/:id', auth, async (req, res) => {
  try {
    const bugContext = await getBugContext(req.params.id, req.user.orgId);
    if (!bugContext) {
      return res.status(404).json({ error: 'Not found' });
    }

    const permissionCheck = await enforceIssueWritePermissions(req, bugContext, req.body);
    if (permissionCheck.status) {
      return res.status(permissionCheck.status).json(permissionCheck.body);
    }

    const { rows: previousRows } = await db.query('SELECT * FROM bugs WHERE id=$1 AND org_id=$2', [
      req.params.id,
      req.user.orgId,
    ]);

    const fieldMap = { assigneeId: 'assignee_id' };
    const sets = [];
    const values = [];
    let index = 1;

    for (const [key, value] of Object.entries(req.body)) {
      const column = fieldMap[key] || key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!['title', 'description', 'type', 'priority', 'status', 'assignee_id', 'labels', 'attachments', 'reference_link', 'curl_command', 'custom_fields'].includes(column)) {
        continue;
      }
      sets.push(`${column}=$${index++}`);
      if (column === 'attachments') {
        values.push(JSON.stringify(normalizeAttachments(value)));
      } else if (column === 'custom_fields') {
        values.push(JSON.stringify(sanitizeCustomFieldValues(value, bugContext.custom_issue_fields)));
      } else if (column === 'reference_link' || column === 'curl_command') {
        values.push(String(value || ''));
      } else {
        values.push(value === '' ? null : value);
      }
    }

    const statusChanged = req.body.status !== undefined && String(req.body.status) !== String(previousRows[0].status);
    if (statusChanged) {
      sets.push('last_status_change_at=NOW()');
    }

    if (sets.length) {
      values.push(req.params.id);
      await db.query(`UPDATE bugs SET ${sets.join(',')} WHERE id=$${index}`, values);
    }

    for (const field of ['status', 'priority', 'assigneeId', 'type', 'referenceLink', 'curlCommand', 'customFields']) {
      const column = fieldMap[field] || field.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (
        req.body[field] !== undefined &&
        String(req.body[field]) !== String(previousRows[0][column])
      ) {
        await db.query(
          "INSERT INTO activity (bug_id,user_id,type,field,from_value,to_value) VALUES ($1,$2,'changed',$3,$4,$5)",
          [req.params.id, req.user.id, field, previousRows[0][column], req.body[field]]
        );
      }
    }

    const { rows } = await db.query(
      `SELECT b.*, p.name AS project_name
       FROM bugs b
       LEFT JOIN projects p ON p.id = b.project_id
       WHERE b.id=$1`,
      [req.params.id]
    );
    const bug = camel(rows[0]);
    const [comments, activity] = await Promise.all([
      db.query('SELECT * FROM comments WHERE bug_id=$1 ORDER BY created_at ASC', [req.params.id]),
      db.query('SELECT * FROM activity WHERE bug_id=$1 ORDER BY created_at ASC', [req.params.id]),
    ]);
    bug.comments = camels(comments.rows);
    bug.activity = camels(activity.rows);

    cache.del(`stats:${req.user.orgId}:all`, `stats:${req.user.orgId}:${bug.projectId}`);
    res.json(bug);

    const previousAssigneeId = previousRows[0]?.assignee_id || null;
    if (bug.assigneeId && bug.assigneeId !== previousAssigneeId) {
      notifyBugAssignment({
        orgId: req.user.orgId,
        bug,
        assigneeId: bug.assigneeId,
        actorName: req.user.name,
        reason: 'updated',
      }).catch((err) => console.warn('Assignment notification failed:', err.message));
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/bugs/:id', auth, checkPermission(PERMISSIONS.DELETE_ISSUE, {
  projectId: async (req) => {
    const bug = await getBugContext(req.params.id, req.user.orgId);
    return bug?.project_id || null;
  },
}), async (req, res) => {
  try {
    await db.query('DELETE FROM bugs WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    cache.del(`stats:${req.user.orgId}:all`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bugs/:id/comments', auth, checkPermission(PERMISSIONS.COMMENT, {
  projectId: async (req) => {
    const bug = await getBugContext(req.params.id, req.user.orgId);
    return bug?.project_id || null;
  },
}), async (req, res) => {
  try {
    const { text } = req.body;
    const { rows } = await db.query(
      'INSERT INTO comments (bug_id,author_id,text) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user.id, text]
    );
    res.status(201).json(camel(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/bugs/:id/comments/:cid', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM comments WHERE id=$1 AND bug_id=$2', [req.params.cid, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', auth, checkPermission(PERMISSIONS.VIEW_REPORTS), async (req, res) => {
  try {
    const { projectId } = req.query;
    const perms = await getScopedPermissions(req, projectId || null);
    if (!perms.has(PERMISSIONS.VIEW_REPORTS)) {
      return denyMissingPermission(res, PERMISSIONS.VIEW_REPORTS);
    }

    const cacheKey = `stats:${req.user.orgId}:${projectId || 'all'}`;
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const filters = ['org_id = $1'];
    const values = [req.user.orgId];

    if (projectId) {
      filters.push(`project_id = $${values.length + 1}`);
      values.push(projectId);
    }

    const where = filters.join(' AND ');
    const dailyFilters = ['b.org_id = $1'];
    if (projectId) {
      dailyFilters.push('b.project_id = $2');
    }
    const dailyWhere = dailyFilters.join(' AND ');

    const [statusRows, priorityRows, typeRows, totals, daily] = await Promise.all([
      db.query(`SELECT status,COUNT(*)::int AS cnt FROM bugs WHERE ${where} GROUP BY status`, values),
      db.query(`SELECT priority,COUNT(*)::int AS cnt FROM bugs WHERE ${where} GROUP BY priority`, values),
      db.query(`SELECT type,COUNT(*)::int AS cnt FROM bugs WHERE ${where} GROUP BY type`, values),
      db.query(
        `SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status!='Done')::int AS open_count,COUNT(*) FILTER (WHERE status='Done')::int AS done_count FROM bugs WHERE ${where}`,
        values
      ),
      db.query(
        `SELECT to_char(d::date,'Mon DD') AS label,COUNT(b.id)::int AS count
         FROM generate_series(NOW()-INTERVAL '6 days',NOW(),INTERVAL '1 day') d
         LEFT JOIN bugs b ON b.created_at::date=d::date AND ${dailyWhere}
         GROUP BY d
         ORDER BY d`,
        values
      ),
    ]);

    const byStatus = { 'To Do': 0, 'In Progress': 0, 'In Review': 0, Done: 0 };
    const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
    const byType = { Bug: 0, Feature: 0, Task: 0, Improvement: 0 };

    statusRows.rows.forEach((row) => {
      if (row.status in byStatus) byStatus[row.status] = row.cnt;
    });
    priorityRows.rows.forEach((row) => {
      if (row.priority in byPriority) byPriority[row.priority] = row.cnt;
    });
    typeRows.rows.forEach((row) => {
      if (row.type in byType) byType[row.type] = row.cnt;
    });

    const result = {
      total: totals.rows[0].total,
      openCount: totals.rows[0].open_count,
      doneCount: totals.rows[0].done_count,
      byStatus,
      byPriority,
      byType,
      daily: daily.rows,
    };
    await cache.set(cacheKey, result, 30); // 30s TTL — stats are near-real-time
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  RBAC API
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/rbac/permissions — all available permission constants
app.get('/api/rbac/permissions', auth, async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM permissions ORDER BY name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rbac/roles — all roles (system + org-specific)
app.get('/api/rbac/roles', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, COALESCE(json_agg(p.name) FILTER (WHERE p.name IS NOT NULL), '[]') AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE r.org_id IS NULL OR r.org_id = $1
       GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
      [req.user.orgId]
    );
    res.json(rows.map(camel));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rbac/roles — create a custom org role (admin only)
app.post('/api/rbac/roles', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { name, description = '', color = '#6366f1', permissions: perms = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Role name required' });

    const { rows: permissionRows } = await db.query(
      'SELECT name FROM permissions WHERE name = ANY($1::text[])',
      [perms]
    );
    if (permissionRows.length !== perms.length) {
      return res.status(400).json({ error: 'One or more permissions are invalid' });
    }

    const { rows: [role] } = await db.query(
      'INSERT INTO roles (org_id,name,description,color,is_system) VALUES ($1,$2,$3,$4,false) RETURNING *',
      [req.user.orgId, name.trim(), description, color]
    );

    if (perms.length) {
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE name = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [role.id, perms]
      );
    }
    res.status(201).json(camel(role));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/rbac/roles/:id/permissions — replace permission set on a role
app.put('/api/rbac/roles/:id/permissions', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { permissions: perms = [] } = req.body;
    const role = await getAssignableRole(req.params.id, req.user.orgId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(403).json({ error: 'Cannot modify system role permissions' });

    const { rows: permissionRows } = await db.query(
      'SELECT name FROM permissions WHERE name = ANY($1::text[])',
      [perms]
    );
    if (permissionRows.length !== perms.length) {
      return res.status(400).json({ error: 'One or more permissions are invalid' });
    }

    await db.query('DELETE FROM role_permissions WHERE role_id=$1', [req.params.id]);
    if (perms.length) {
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE name = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [req.params.id, perms]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/rbac/roles/:id/permissions', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { permission } = req.body;
    if (!permission) return res.status(400).json({ error: 'permission required' });

    const role = await getAssignableRole(req.params.id, req.user.orgId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(403).json({ error: 'Cannot modify system role permissions' });

    const { rows: [permRow] } = await db.query('SELECT id FROM permissions WHERE name=$1', [permission]);
    if (!permRow) return res.status(404).json({ error: 'Permission not found' });

    await db.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, permRow.id]
    );
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/rbac/roles/:id/permissions/:permission', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const role = await getAssignableRole(req.params.id, req.user.orgId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(403).json({ error: 'Cannot modify system role permissions' });

    await db.query(
      `DELETE FROM role_permissions rp
       USING permissions p
       WHERE rp.role_id=$1 AND rp.permission_id=p.id AND p.name=$2`,
      [req.params.id, req.params.permission]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/rbac/roles/:id — delete a custom org role
app.delete('/api/rbac/roles/:id', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { rows: [role] } = await db.query('SELECT * FROM roles WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    await db.query('DELETE FROM roles WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rbac/users/:userId/roles — get roles assigned to a user
app.get('/api/rbac/users/:userId/roles', auth, async (req, res) => {
  try {
    const canManage = (await getScopedPermissions(req)).has(PERMISSIONS.MANAGE_USERS);
    if (!canManage && req.params.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden - MANAGE_USERS permission required' });
    }

    const { rows } = await db.query(
      `SELECT ur.id, ur.project_id, r.name, r.color, r.is_system,
              p.name AS project_name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN projects p ON p.id = ur.project_id
       WHERE ur.user_id=$1 AND ur.org_id=$2
       ORDER BY ur.project_id NULLS FIRST, r.name`,
      [req.params.userId, req.user.orgId]
    );
    res.json(rows.map(camel));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rbac/users/:userId/roles — assign a role to a user (global or project-level)
app.post('/api/rbac/users/:userId/roles', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    const { roleId, projectId = null } = req.body;
    if (!roleId) return res.status(400).json({ error: 'roleId required' });

    const userExists = await assertUserInOrg(req.params.userId, req.user.orgId);
    if (!userExists) return res.status(404).json({ error: 'User not found' });

    const role = await getAssignableRole(roleId, req.user.orgId);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    if (projectId) {
      const project = await getProjectContext(projectId, req.user.orgId);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    }

    const col = projectId
      ? 'INSERT INTO user_roles (user_id,role_id,org_id,project_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *'
      : 'INSERT INTO user_roles (user_id,role_id,org_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *';
    const vals = projectId
      ? [req.params.userId, roleId, req.user.orgId, projectId]
      : [req.params.userId, roleId, req.user.orgId];

    const { rows } = await db.query(col, vals);
    res.status(201).json(rows[0] ? camel(rows[0]) : { message: 'Already assigned' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/rbac/users/:userId/roles/:userRoleId — remove a role from a user
app.delete('/api/rbac/users/:userId/roles/:userRoleId', auth, checkPermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
  try {
    await db.query(
      'DELETE FROM user_roles WHERE id=$1 AND user_id=$2 AND org_id=$3',
      [req.params.userRoleId, req.params.userId, req.user.orgId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rbac/me/permissions — current user's effective permissions (optionally scoped to project)
app.get('/api/rbac/me/permissions', auth, async (req, res) => {
  try {
    const projectId = req.query.projectId || null;
    const perms = await getUserPermissions(req.user.id, req.user.orgId, projectId);
    res.json({ permissions: [...perms] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rbac/users/:userId/permissions', auth, async (req, res) => {
  try {
    const canManage = (await getScopedPermissions(req)).has(PERMISSIONS.MANAGE_USERS);
    if (!canManage && req.params.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden - MANAGE_USERS permission required' });
    }

    const userExists = await assertUserInOrg(req.params.userId, req.user.orgId);
    if (!userExists) return res.status(404).json({ error: 'User not found' });

    const projectId = req.query.projectId || null;
    if (projectId) {
      const project = await getProjectContext(projectId, req.user.orgId);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    }

    const perms = await getUserPermissions(req.params.userId, req.user.orgId, projectId);
    res.json({ permissions: [...perms] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Presence (Redis-backed, in-memory fallback) ──────────────────────────────
// POST /api/presence/heartbeat — client calls every 30 s to stay "online"
app.post('/api/presence/heartbeat', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, avatar, color FROM users WHERE id=$1 AND org_id=$2',
      [req.user.id, req.user.orgId]
    );
    if (!rows[0]) return res.sendStatus(204);
    const { id, name, avatar, color } = rows[0];
    await presence.markPresence(req.user.orgId, id, { id, name, avatar, color });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/presence/offline — called via sendBeacon on tab close
// Token comes in the JSON body because sendBeacon cannot set auth headers
app.post('/api/presence/offline', async (req, res) => {
  try {
    const token = req.body?.token;
    if (!token) return res.sendStatus(204);
    const payload = jwt.verify(token, JWT_SECRET);
    await presence.removePresence(payload.orgId, payload.id);
  } catch { /* invalid token — ignore */ }
  res.sendStatus(204);
});

// GET /api/presence — returns online users in same org
app.get('/api/presence', auth, async (req, res) => {
  try {
    res.json(await presence.getOnlineUsers(req.user.orgId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sheet-sync/status', auth, async (req, res) => {
  try {
    res.json(await getGoogleSheetSyncStatus(req.user.orgId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sheet-sync/run', auth, async (req, res) => {
  try {
    const targetOrgId = req.user.role === 'admin' && req.body?.orgId ? req.body.orgId : req.user.orgId;
    const started = triggerGoogleSheetSync(targetOrgId);
    res.json({ started, status: await getGoogleSheetSyncStatus(targetOrgId) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sheet-push', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT apps_script_url FROM organizations WHERE id=$1', [req.user.orgId]);
    const url = rows[0]?.apps_script_url;
    console.log('[sheet-push] url:', url || '(none)');
    if (!url) return res.status(400).json({ error: 'No Apps Script URL configured in Settings.' });
    const projectId = req.body?.projectId || null;
    const result = await pushToAppsScript(req.user.orgId, url, projectId);
    console.log('[sheet-push] result:', JSON.stringify(result));
    if (result?.nothing) return res.json({ nothing: true });
    if (result?.pushedIds?.length) {
      await db.query('UPDATE bugs SET sheet_pushed_at = NOW() WHERE id = ANY($1)', [result.pushedIds]);
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[sheet-push] error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sheet-export', auth, async (req, res) => {
  try {
    const projectId = req.query.projectId || null;
    const buffer = await exportOrgToXlsxBuffer(req.user.orgId, projectId);
    const { rows } = await db.query('SELECT name FROM organizations WHERE id=$1', [req.user.orgId]);
    const orgName = (rows[0]?.name || 'export').replace(/[^a-zA-Z0-9]/g, '_');
    const suffix = projectId ? `_project` : `_all_projects`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${orgName}${suffix}_issues.xlsx"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  if (hasTokenMarkerCookie(req)) {
    return res.sendFile(path.join(__dirname, 'public', 'app-shell.html'));
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/doc', (_req, res) => res.sendFile(path.join(__dirname, 'doc', 'index.html')));
app.get('/doc/', (_req, res) => res.sendFile(path.join(__dirname, 'doc', 'index.html')));
app.get('/doc/index.html', (_req, res) => res.sendFile(path.join(__dirname, 'doc', 'index.html')));
app.get('/doc/admin', (_req, res) => res.sendFile(path.join(__dirname, 'doc', 'admin', 'index.html')));
app.get('/doc/admin/', (_req, res) => res.sendFile(path.join(__dirname, 'doc', 'admin', 'index.html')));
app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/app',   (req, res) => {
  if (!hasTokenMarkerCookie(req)) return res.redirect('/login');
  return res.sendFile(path.join(__dirname, 'public', 'app-shell.html'));
});
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler — catches any unhandled errors thrown by route handlers
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

(async () => {
  try {
    await redisClient.connect(); // non-fatal — falls back to in-process if unavailable
    await db.connect();
    await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS apps_script_url TEXT`);
    await db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS custom_issue_fields JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS sheet_layout_version TEXT NOT NULL DEFAULT 'legacy'`);
    await db.query(`ALTER TABLE bugs ADD COLUMN IF NOT EXISTS sheet_pushed_at TIMESTAMPTZ`);
    await db.query(`ALTER TABLE bugs ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await db.query(`ALTER TABLE bugs ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ`);
    await db.query(`
      UPDATE bugs b
      SET last_status_change_at = status_changes.latest_status_change
      FROM (
        SELECT bug_id, MAX(created_at) AS latest_status_change
        FROM activity
        WHERE field = 'status'
        GROUP BY bug_id
      ) AS status_changes
      WHERE b.id = status_changes.bug_id
        AND b.last_status_change_at IS NULL
    `);
    await db.query(`
      UPDATE bugs
      SET last_status_change_at = COALESCE(created_at, updated_at, NOW())
      WHERE last_status_change_at IS NULL
    `);
    await db.query(`ALTER TABLE bugs ALTER COLUMN last_status_change_at SET DEFAULT NOW()`);
    // Indexes for high-frequency queries
    await db.query(`CREATE INDEX IF NOT EXISTS idx_bugs_org_project ON bugs(org_id, project_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_bugs_org_id ON bugs(org_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_bugs_assignee ON bugs(assignee_id) WHERE assignee_id IS NOT NULL`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(org_id, status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_bugs_created_at ON bugs(created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_bugs_sheet_pushed ON bugs(sheet_pushed_at) WHERE sheet_pushed_at IS NULL`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_bug_id ON activity(bug_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_comments_bug_id ON comments(bug_id)`);
    await db.query(`CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bug_id UUID REFERENCES bugs(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'assignment',
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC)`);
    const server = app.listen(PORT, () => {
      console.log(`\nBugTracker      ->  http://localhost:${PORT}`);
      console.log('Storage         ->  PostgreSQL');
      console.log('Multi-tenant    ->  enabled');
      console.log('JWT Auth        ->  enabled\n');
      startGoogleSheetSync();
    });

    // Keep-alive tuning for high-concurrency (Node default is 5s which is too short)
    server.keepAliveTimeout = 65_000;
    server.headersTimeout   = 70_000;

    // Graceful shutdown — finish in-flight requests before exiting
    function shutdown(signal) {
      console.log(`\n[server] ${signal} received — shutting down gracefully`);
      server.close(() => {
        console.log('[server] HTTP server closed');
        process.exit(0);
      });
      // Force exit after 15s if requests don't drain
      setTimeout(() => { console.error('[server] Forced exit after timeout'); process.exit(1); }, 15_000).unref();
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();
