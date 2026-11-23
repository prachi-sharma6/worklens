-- WorkLens initial schema. Dates are ISO-8601 TEXT, booleans are INTEGER 0/1.

CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee','manager')),
  team_id INTEGER REFERENCES teams(id),
  manager_id INTEGER REFERENCES users(id),
  title TEXT,
  avatar_color TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_users_manager ON users(manager_id);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  expected_outcome TEXT,
  actual_outcome TEXT,
  estimated_minutes INTEGER,
  actual_minutes INTEGER,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','blocked')),
  impact_level TEXT NOT NULL DEFAULT 'medium' CHECK (impact_level IN ('low','medium','high')),
  impact_note TEXT,
  is_planned_today INTEGER NOT NULL DEFAULT 0,
  planned_for_date TEXT,
  started_at TEXT,
  completed_at TEXT,
  ai_enriched INTEGER NOT NULL DEFAULT 0,
  ai_suggestions_json TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unsubmitted' CHECK (verification_status IN ('unsubmitted','pending','verified','clarification_requested','rejected')),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_deadline ON tasks(deadline);
CREATE INDEX idx_tasks_verification ON tasks(verification_status);

CREATE TABLE task_evidence (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('github','document','screenshot','test_result','deliverable','explanation')),
  url TEXT,
  file_path TEXT,
  note TEXT,
  submitted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_evidence_task ON task_evidence(task_id);

CREATE TABLE task_comments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','clarification','decision')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_comments_task ON task_comments(task_id);

CREATE TABLE blockers (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN ('person','team','external','tool','unclear')),
  dependency_name TEXT,
  is_external INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_blockers_task ON blockers(task_id);
CREATE INDEX idx_blockers_user ON blockers(user_id);
CREATE INDEX idx_blockers_status ON blockers(status);

CREATE TABLE manager_reviews (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  manager_id INTEGER NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('verified','clarification_requested','rejected')),
  note TEXT,
  quality_rating INTEGER CHECK (quality_rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reviews_task ON manager_reviews(task_id);

CREATE TABLE score_overrides (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  period_start TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('productivity','quality','impact','consistency','ownership')),
  original_value INTEGER,
  new_value INTEGER NOT NULL CHECK (new_value BETWEEN 0 AND 100),
  reason TEXT NOT NULL,
  manager_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_overrides_user ON score_overrides(user_id, period_start);

CREATE TABLE performance_records (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  period_type TEXT NOT NULL DEFAULT 'week',
  period_start TEXT NOT NULL,
  productivity INTEGER, quality INTEGER, impact INTEGER, consistency INTEGER, ownership INTEGER, overall INTEGER,
  is_provisional INTEGER NOT NULL DEFAULT 0,
  inputs_json TEXT,
  computed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, period_type, period_start)
);
CREATE INDEX idx_perf_user ON performance_records(user_id);

CREATE TABLE daily_reports (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  report_date TEXT NOT NULL,
  data_json TEXT NOT NULL,
  summary_text TEXT,
  summary_source TEXT NOT NULL DEFAULT 'template' CHECK (summary_source IN ('ai','template')),
  delivered_via TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_daily_user ON daily_reports(user_id, report_date);

CREATE TABLE weekly_reports (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  week_start TEXT NOT NULL,
  data_json TEXT NOT NULL,
  summary_text TEXT,
  summary_source TEXT NOT NULL DEFAULT 'template' CHECK (summary_source IN ('ai','template')),
  delivered_via TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_weekly_user ON weekly_reports(user_id, week_start);

CREATE TABLE activity_timeline (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('task_created','task_completed','evidence_submitted','verified','blocker_opened','blocker_resolved','feedback','achievement')),
  title TEXT NOT NULL,
  detail TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_timeline_user ON activity_timeline(user_id, occurred_at);

CREATE TABLE integration_events (
  id INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped_not_connected')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_outbox_status ON integration_events(status);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
