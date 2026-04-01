-- ============================================================
--  BugTracker - Seed Data
-- ============================================================

-- Organization
INSERT INTO organizations (id, name, slug, color) VALUES
  ('90000000-0000-0000-0000-000000000001', 'Demo Workspace', 'demo-workspace', '#6366f1')
ON CONFLICT DO NOTHING;

-- Users
INSERT INTO users (id, org_id, name, email, avatar, color) VALUES
  ('a1000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Alice Johnson', 'alice@company.com', 'AJ', '#6366f1'),
  ('a1000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'Bob Smith',     'bob@company.com',   'BS', '#10b981'),
  ('a1000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'Carol White',   'carol@company.com', 'CW', '#f59e0b'),
  ('a1000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000001', 'David Lee',     'david@company.com', 'DL', '#ef4444')
ON CONFLICT DO NOTHING;

-- Projects
INSERT INTO projects (id, org_id, name, key, description, color) VALUES
  ('b2000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Frontend App', 'FE',  'Customer-facing frontend', '#6366f1'),
  ('b2000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'Backend API',  'BE',  'REST API services',         '#10b981'),
  ('b2000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'Mobile App',   'MOB', 'iOS & Android app',         '#f59e0b')
ON CONFLICT DO NOTHING;

-- Project sequences
INSERT INTO project_sequences (project_id, next_num) VALUES
  ('b2000000-0000-0000-0000-000000000001', 3),
  ('b2000000-0000-0000-0000-000000000002', 3),
  ('b2000000-0000-0000-0000-000000000003', 2)
ON CONFLICT DO NOTHING;

-- Bugs
INSERT INTO bugs (id, org_id, key, project_id, title, description, type, priority, status, assignee_id, reporter_id, labels, created_at, updated_at) VALUES
  ('c3000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'FE-1',
   'b2000000-0000-0000-0000-000000000001',
   'Login button unresponsive on Safari',
   'The login button does not respond to clicks in Safari 16+. Users are unable to log in.',
   'Bug', 'High', 'In Progress',
   'a1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000002',
   '{"safari","auth"}',
   NOW() - INTERVAL '5 days', NOW() - INTERVAL '2 days'),

  ('c3000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'FE-2',
   'b2000000-0000-0000-0000-000000000001',
   'Dashboard charts not loading on mobile',
   'When accessing the dashboard on mobile devices, the charts fail to render properly.',
   'Bug', 'Medium', 'To Do',
   'a1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   '{"mobile","charts"}',
   NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),

  ('c3000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'BE-1',
   'b2000000-0000-0000-0000-000000000002',
   'API rate limiting returns wrong error code',
   'The rate limiter returns HTTP 500 instead of HTTP 429 when the limit is exceeded.',
   'Bug', 'Critical', 'To Do',
   'a1000000-0000-0000-0000-000000000004',
   'a1000000-0000-0000-0000-000000000003',
   '{"api","rate-limiting"}',
   NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),

  ('c3000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000001', 'BE-2',
   'b2000000-0000-0000-0000-000000000002',
   'Add pagination to /users endpoint',
   'The /users endpoint currently returns all records. We need cursor-based pagination.',
   'Feature', 'Medium', 'In Review',
   'a1000000-0000-0000-0000-000000000002',
   'a1000000-0000-0000-0000-000000000004',
   '{"api","performance"}',
   NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day'),

  ('c3000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000001', 'MOB-1',
   'b2000000-0000-0000-0000-000000000003',
   'Push notifications not delivered on Android 13',
   'Users with Android 13 are not receiving push notifications due to new permission model.',
   'Bug', 'High', 'Done',
   'a1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000002',
   '{"android","notifications"}',
   NOW() - INTERVAL '14 days', NOW() - INTERVAL '1 day'),

  ('c3000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000001', 'FE-3',
   'b2000000-0000-0000-0000-000000000001',
   'Refactor authentication module',
   'The current auth module is tightly coupled. Need to decouple and add proper DI.',
   'Task', 'Low', 'Done',
   'a1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   '{"refactor"}',
   NOW() - INTERVAL '20 days', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- Comments
INSERT INTO comments (bug_id, author_id, text, created_at) VALUES
  ('c3000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000002',
   'Reproduced on Safari 16.4. Seems related to the new security policies.',
   NOW() - INTERVAL '4 days'),
  ('c3000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'Investigating the event listeners. Will push a fix today.',
   NOW() - INTERVAL '2 days'),
  ('c3000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000003',
   'This is causing clients to retry instead of back off. High priority fix needed.',
   NOW() - INTERVAL '6 days')
ON CONFLICT DO NOTHING;

-- Activity log
INSERT INTO activity (bug_id, user_id, type, note, created_at) VALUES
  ('c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'created', 'Issue created', NOW() - INTERVAL '5 days'),
  ('c3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'created', 'Issue created', NOW() - INTERVAL '3 days'),
  ('c3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', 'created', 'Issue created', NOW() - INTERVAL '7 days'),
  ('c3000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000004', 'created', 'Issue created', NOW() - INTERVAL '10 days'),
  ('c3000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', 'created', 'Issue created', NOW() - INTERVAL '14 days'),
  ('c3000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', 'created', 'Issue created', NOW() - INTERVAL '20 days')
ON CONFLICT DO NOTHING;
