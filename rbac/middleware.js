const db = require('../db');
const { PERMISSIONS, LEGACY_ROLE_PERMISSIONS } = require('./permissions');

// ── Core: resolve all effective permissions for a user ────────────────────────
// Merges org-level roles + optional project-level roles.
// Falls back to legacy `role` column if no user_roles rows exist.
async function getUserPermissions(userId, orgId, projectId = null) {
  const { rows } = await db.query(
    `SELECT DISTINCT p.name
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p       ON p.id = rp.permission_id
     WHERE ur.user_id = $1
       AND ur.org_id  = $2
       AND (ur.project_id IS NULL OR ($3::uuid IS NOT NULL AND ur.project_id = $3::uuid))`,
    [userId, orgId, projectId || null]
  );

  if (rows.length > 0) {
    return new Set(rows.map(r => r.name));
  }

  // Fallback: no RBAC rows yet — use legacy role column
  const assignedRoles = await db.query(
    'SELECT 1 FROM user_roles WHERE user_id=$1 AND org_id=$2 LIMIT 1',
    [userId, orgId]
  );
  if (assignedRoles.rows.length) return new Set();

  const legacy = await db.query('SELECT role FROM users WHERE id=$1', [userId]);
  if (!legacy.rows.length) return new Set([PERMISSIONS.VIEW_ISSUE]);
  return LEGACY_ROLE_PERMISSIONS[legacy.rows[0].role] || new Set([PERMISSIONS.VIEW_ISSUE]);
}

// ── Middleware: attach permissions to req ─────────────────────────────────────
// Use before checkPermission if you need req.userPermissions in route handlers too.
async function attachPermissions(req, _res, next) {
  try {
    const projectId = req.params.projectId || req.query.projectId || req.body?.projectId || null;
    req.userPermissions = await getUserPermissions(req.user.id, req.user.orgId, projectId);
    next();
  } catch (err) {
    next(err);
  }
}

// ── Middleware: gate a route behind a specific permission ─────────────────────
// Usage: router.put('/api/bugs/:id', auth, checkPermission('EDIT_ISSUE'), handler)
//
// Admin bypass: Admin role has ALL permissions seeded in DB, so they always pass.
// Developer ownership: pass { ownerField: 'assignee_id', table: 'bugs', idParam: 'id' }
// to additionally verify the resource belongs to the current user when they lack
// a broader permission (e.g. MANAGE_PROJECT).
function checkPermission(permission, opts = {}) {
  return async (req, res, next) => {
    try {
      const projectId =
        req.params.projectId ||
        req.query.projectId ||
        req.body?.projectId ||
        (typeof opts.projectId === 'function' ? await opts.projectId(req) : opts.projectId) ||
        null;
      const perms = req.userPermissions || await getUserPermissions(req.user.id, req.user.orgId, projectId);
      req.userPermissions = perms;

      if (!perms.has(permission)) {
        return res.status(403).json({
          error: `Forbidden — ${permission} permission required`,
          required: permission,
        });
      }

      // Ownership check: if ownerField provided and user lacks MANAGE_PROJECT,
      // verify they own the resource (e.g. Developer editing only assigned issues).
      if (opts.ownerField && !perms.has(PERMISSIONS.MANAGE_PROJECT)) {
        const resourceId = req.params[opts.idParam || 'id'];
        const { rows } = await db.query(
          `SELECT ${opts.ownerField} FROM ${opts.table} WHERE id=$1`,
          [resourceId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Resource not found' });
        if (rows[0][opts.ownerField] !== req.user.id) {
          return res.status(403).json({ error: 'You can only modify issues assigned to you' });
        }
      }

      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

// ── Helper: assign a system role to a user (used during registration / member add) ──
async function assignSystemRole(userId, roleName, orgId, projectId = null) {
  const { rows } = await db.query(
    "SELECT id FROM roles WHERE name=$1 AND org_id IS NULL AND is_system=true",
    [roleName]
  );
  if (!rows.length) return;
  const col = projectId
    ? 'INSERT INTO user_roles (user_id,role_id,org_id,project_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING'
    : 'INSERT INTO user_roles (user_id,role_id,org_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING';
  const vals = projectId ? [userId, rows[0].id, orgId, projectId] : [userId, rows[0].id, orgId];
  await db.query(col, vals);
}

// Legacy role name → RBAC system role name map
const LEGACY_TO_RBAC = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  developer: 'Developer',
  frontend_developer: 'Frontend Developer',
  backend_developer: 'Backend Developer',
  tester: 'QA',
  qa: 'QA',
  viewer: 'Viewer',
};

module.exports = { getUserPermissions, attachPermissions, checkPermission, assignSystemRole, LEGACY_TO_RBAC };
