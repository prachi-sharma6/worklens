-- M91 phone alerts (through viaSocket). integration_connections gains the 'm91' app (SQLite can't alter a CHECK,
-- so the table is rebuilt; nothing references it). m91_alerts remembers which conditions have an open alert, so each
-- condition rings once and is closed from code when it clears.

CREATE TABLE integration_connections_new (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  app TEXT NOT NULL CHECK (app IN ('slack','gmail','m91')),
  auth_id TEXT NOT NULL,
  script_id TEXT,
  label TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  connected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, app)
);
INSERT INTO integration_connections_new SELECT id, user_id, app, auth_id, script_id, label, settings_json, connected_at, created_at, updated_at FROM integration_connections;
DROP TABLE integration_connections;
ALTER TABLE integration_connections_new RENAME TO integration_connections;
CREATE INDEX idx_conn_user ON integration_connections(user_id);

-- One row per condition per manager. custom_id is the M91 customId (names the condition, not the run).
-- No foreign keys: rows outlive a demo reset so open alerts can still be closed.
CREATE TABLE m91_alerts (
  id INTEGER PRIMARY KEY,
  manager_id INTEGER NOT NULL,
  custom_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- critical_overdue | critical_blocked | blocker_stuck | delivery_failing | test
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  path TEXT,                       -- WorkLens page the alert points to
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_m91_open ON m91_alerts(manager_id, status);
