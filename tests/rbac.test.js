const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');
const middleware = require('../rbac/middleware');
const { PERMISSIONS } = require('../rbac/permissions');

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

test('getUserPermissions returns DB-backed permissions when RBAC rows exist', async () => {
  const originalQuery = db.query;
  db.query = async () => ({
    rows: [{ name: PERMISSIONS.CREATE_ISSUE }, { name: PERMISSIONS.VIEW_ISSUE }],
  });

  try {
    const perms = await middleware.getUserPermissions('user-1', 'org-1', 'project-1');
    assert.equal(perms.has(PERMISSIONS.CREATE_ISSUE), true);
    assert.equal(perms.has(PERMISSIONS.VIEW_ISSUE), true);
  } finally {
    db.query = originalQuery;
  }
});

test('getUserPermissions does not fall back to legacy role when scoped RBAC returns empty but user has assigned roles', async () => {
  const originalQuery = db.query;
  let call = 0;
  db.query = async () => {
    call += 1;
    if (call === 1) return { rows: [] };
    if (call === 2) return { rows: [{ '?column?': 1 }] };
    throw new Error('Unexpected query');
  };

  try {
    const perms = await middleware.getUserPermissions('user-1', 'org-1', 'project-1');
    assert.equal(perms.size, 0);
  } finally {
    db.query = originalQuery;
  }
});

test('getUserPermissions falls back to legacy role permissions when user has no RBAC assignments', async () => {
  const originalQuery = db.query;
  let call = 0;
  db.query = async () => {
    call += 1;
    if (call === 1) return { rows: [] };
    if (call === 2) return { rows: [] };
    if (call === 3) return { rows: [{ role: 'viewer' }] };
    throw new Error('Unexpected query');
  };

  try {
    const perms = await middleware.getUserPermissions('user-1', 'org-1', 'project-1');
    assert.equal(perms.has(PERMISSIONS.VIEW_ISSUE), true);
    assert.equal(perms.has(PERMISSIONS.VIEW_REPORTS), true);
    assert.equal(perms.has(PERMISSIONS.EDIT_ISSUE), false);
  } finally {
    db.query = originalQuery;
  }
});

test('checkPermission can resolve project scope from request body', async () => {
  const originalQuery = db.query;
  let call = 0;
  db.query = async () => {
    call += 1;
    if (call === 1) return { rows: [{ name: PERMISSIONS.CREATE_ISSUE }] };
    throw new Error('Unexpected query');
  };

  const req = {
    user: { id: 'user-1', orgId: 'org-1' },
    params: {},
    query: {},
    body: { projectId: 'project-1' },
  };
  const res = createResponse();

  try {
    let nextCalled = false;
    await middleware.checkPermission(PERMISSIONS.CREATE_ISSUE)(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.userPermissions.has(PERMISSIONS.CREATE_ISSUE), true);
  } finally {
    db.query = originalQuery;
  }
});

test('LEGACY_TO_RBAC includes the new built-in roles', () => {
  assert.equal(middleware.LEGACY_TO_RBAC.project_manager, 'Project Manager');
  assert.equal(middleware.LEGACY_TO_RBAC.tester, 'Tester');
  assert.equal(middleware.LEGACY_TO_RBAC.viewer, 'Viewer');
});
