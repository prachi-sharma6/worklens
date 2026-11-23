-- Phase 5: viaSocket connections, AI metadata, Slack threading, outbox results, notification de-duplication.

CREATE TABLE integration_connections (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  app TEXT NOT NULL CHECK (app IN ('slack','gmail')),
  auth_id TEXT NOT NULL,           -- viaSocket connection id: a credential, server only
  script_id TEXT,                  -- the user's "WorkLens → <app>" flow: a credential, server only
  label TEXT,                      -- the connected account's name/email, safe to show
  settings_json TEXT NOT NULL DEFAULT '{}', -- Slack: channel + teammate map; Gmail: recipients
  connected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, app)
);
CREATE INDEX idx_conn_user ON integration_connections(user_id);

ALTER TABLE blockers ADD COLUMN ai_extraction_json TEXT;
ALTER TABLE blockers ADD COLUMN slack_channel TEXT;
ALTER TABLE blockers ADD COLUMN slack_ts TEXT;

ALTER TABLE integration_events ADD COLUMN result_json TEXT;
ALTER TABLE integration_events ADD COLUMN processed_at TEXT;

CREATE TABLE notification_log (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
