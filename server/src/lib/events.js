// Every state change writes an activity_timeline row; automation-relevant ones also enqueue an outbox row.
// Nothing consumes the outbox until Phase 5 — rows stay 'queued'.
export const nowIso = () => new Date().toISOString();

export function logEvent(db, { user_id, task_id = null, event_type, title, detail = null, at = nowIso() }) {
  markChanged(db, user_id);
  return db.insert('activity_timeline', { user_id, task_id, event_type, title, detail, occurred_at: at });
}

/** Score-relevant change for a user ('all' = every user, e.g. weights changed). Listeners live on the db object. */
export function markChanged(db, userId) {
  for (const fn of db.changeListeners ?? []) fn(userId);
}
export function onChanged(db, fn) {
  (db.changeListeners ??= new Set()).add(fn);
}

export function enqueue(db, event_type, payload) {
  return db.insert('integration_events', { event_type, payload_json: JSON.stringify(payload), status: 'queued', attempts: 0 });
}
