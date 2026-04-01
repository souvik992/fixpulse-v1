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
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── users ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  avatar        TEXT        NOT NULL,
  color         TEXT        NOT NULL DEFAULT '#6366f1',
  password_hash TEXT,
  role          TEXT        NOT NULL DEFAULT 'developer', -- admin | developer | qa
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── projects ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  key         TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  color       TEXT        NOT NULL DEFAULT '#6366f1',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, key)
);

-- ── bugs ───────────────────────────────────────────────────────
CREATE TYPE issue_status   AS ENUM ('To Do', 'In Progress', 'In Review', 'Done');
CREATE TYPE issue_priority AS ENUM ('Critical', 'High', 'Medium', 'Low');
CREATE TYPE issue_type     AS ENUM ('Bug', 'Feature', 'Task', 'Improvement');

CREATE TABLE IF NOT EXISTS bugs (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key         TEXT,
  project_id  UUID           NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT           NOT NULL,
  description TEXT           NOT NULL DEFAULT '',
  type        issue_type     NOT NULL DEFAULT 'Bug',
  priority    issue_priority NOT NULL DEFAULT 'Medium',
  status      issue_status   NOT NULL DEFAULT 'To Do',
  assignee_id UUID           REFERENCES users(id) ON DELETE SET NULL,
  reporter_id UUID           REFERENCES users(id) ON DELETE SET NULL,
  labels      TEXT[]         NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_sequences (
  project_id UUID    PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  next_num   INTEGER NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
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
CREATE TYPE activity_type AS ENUM ('created', 'changed', 'commented');
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

-- ── indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_org       ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_org    ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_bugs_org        ON bugs(org_id);
CREATE INDEX IF NOT EXISTS idx_bugs_project    ON bugs(project_id);
CREATE INDEX IF NOT EXISTS idx_bugs_status     ON bugs(status);
CREATE INDEX IF NOT EXISTS idx_bugs_priority   ON bugs(priority);
CREATE INDEX IF NOT EXISTS idx_bugs_created    ON bugs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_bug    ON comments(bug_id);
CREATE INDEX IF NOT EXISTS idx_activity_bug    ON activity(bug_id);
