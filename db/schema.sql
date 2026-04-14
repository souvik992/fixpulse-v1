-- ============================================================
--  BugTracker – Multi-Tenant PostgreSQL Schema
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── organizations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,   -- e.g. "acme-corp"
  color       TEXT        NOT NULL DEFAULT '#6366f1',
  logo        TEXT        NOT NULL DEFAULT '',
  plan_code   TEXT        NOT NULL DEFAULT 'enterprise',
  user_limit  INTEGER,
  data_source_type TEXT,
  data_source_url TEXT,
  data_source_sheet_id TEXT,
  data_source_file_name TEXT,
  data_source_file_data TEXT,
  data_source_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  data_source_last_synced_at TIMESTAMPTZ,
  data_source_last_error TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS logo TEXT NOT NULL DEFAULT '';
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan_code TEXT NOT NULL DEFAULT 'enterprise';
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS user_limit INTEGER;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS data_source_type TEXT;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS data_source_url TEXT;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS data_source_sheet_id TEXT;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS data_source_file_name TEXT;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS data_source_file_data TEXT;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS data_source_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS data_source_last_synced_at TIMESTAMPTZ;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS data_source_last_error TEXT;

CREATE TABLE IF NOT EXISTS billing_orders (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code           TEXT        NOT NULL,
  amount_paise        INTEGER     NOT NULL,
  currency            TEXT        NOT NULL DEFAULT 'INR',
  status              TEXT        NOT NULL DEFAULT 'created',
  razorpay_order_id   TEXT        UNIQUE,
  razorpay_payment_id TEXT,
  receipt             TEXT        NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at         TIMESTAMPTZ
);

-- ── users ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  mobile_number TEXT,
  avatar        TEXT        NOT NULL,
  color         TEXT        NOT NULL DEFAULT '#6366f1',
  password_hash TEXT,
  role          TEXT        NOT NULL DEFAULT 'developer', -- admin | project_manager | developer | frontend_developer | backend_developer | tester | viewer | qa
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mobile_number TEXT;

-- ── projects ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  key         TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  color       TEXT        NOT NULL DEFAULT '#6366f1',
  sprint_status TEXT      NOT NULL DEFAULT 'inactive',
  sheet_layout_version TEXT NOT NULL DEFAULT 'legacy',
  custom_issue_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  sheet_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, key)
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sprint_status TEXT NOT NULL DEFAULT 'inactive';
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sheet_layout_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS custom_issue_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sheet_headers JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS permissions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  description TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  color       TEXT        NOT NULL DEFAULT '#6366f1',
  is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID        NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID        REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (user_id, role_id, org_id, project_id)
);

-- ── bugs ───────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE issue_status AS ENUM ('To Do', 'In Progress', 'In Review', 'Done', 'Hold');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE issue_priority AS ENUM ('P0', 'P1', 'P2', 'P3');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE issue_type AS ENUM ('Bug', 'Feature', 'Task', 'Improvement');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS bugs (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key         TEXT,
  project_id  UUID           NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT           NOT NULL,
  description TEXT           NOT NULL DEFAULT '',
  type        issue_type     NOT NULL DEFAULT 'Bug',
  priority    issue_priority NOT NULL DEFAULT 'P2',
  status      issue_status   NOT NULL DEFAULT 'To Do',
  assignee_id UUID           REFERENCES users(id) ON DELETE SET NULL,
  reporter_id UUID           REFERENCES users(id) ON DELETE SET NULL,
  labels      TEXT[]         NOT NULL DEFAULT '{}',
  attachments JSONB          NOT NULL DEFAULT '[]'::jsonb,
  reference_link TEXT        NOT NULL DEFAULT '',
  curl_command TEXT          NOT NULL DEFAULT '',
  custom_fields JSONB        NOT NULL DEFAULT '{}'::jsonb,
  source_created_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  last_status_change_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_sequences (
  project_id UUID    PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  next_num   INTEGER NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS bugs_updated_at ON bugs;
CREATE TRIGGER bugs_updated_at BEFORE UPDATE ON bugs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── comments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_id     UUID        NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  author_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
  text       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── activity ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE activity_type AS ENUM ('created', 'changed', 'commented');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS activity (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_id      UUID          NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  user_id     UUID          REFERENCES users(id) ON DELETE SET NULL,
  type        activity_type NOT NULL DEFAULT 'changed',
  field       TEXT,
  from_value  TEXT,
  to_value    TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bug_id      UUID        REFERENCES bugs(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL DEFAULT 'assignment',
  title       TEXT        NOT NULL,
  message     TEXT        NOT NULL DEFAULT '',
  metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── indexes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_system_name_unique
  ON roles (LOWER(name))
  WHERE org_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_org       ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_org    ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_roles_org       ON roles(org_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id, org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_bugs_org        ON bugs(org_id);
CREATE INDEX IF NOT EXISTS idx_bugs_project    ON bugs(project_id);
CREATE INDEX IF NOT EXISTS idx_bugs_status     ON bugs(status);
CREATE INDEX IF NOT EXISTS idx_bugs_priority   ON bugs(priority);
CREATE INDEX IF NOT EXISTS idx_bugs_created    ON bugs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_bug    ON comments(bug_id);
CREATE INDEX IF NOT EXISTS idx_activity_bug    ON activity(bug_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
