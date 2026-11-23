// The single authorization helper. Every route resolves visibility through these functions;
// a user_id from the client is only ever used as a *filter* after passing canSeeUser().
import { forbidden, notFound } from './lib/http.js';
import { publicUserCols } from './auth.js';

export const isManager = (u) => u.role === 'manager';

/** Users whose records the viewer may read: self, plus direct reports for managers. */
export function visibleUsers(db, viewer) {
  if (isManager(viewer)) return db.all(`SELECT ${publicUserCols}, category FROM users WHERE manager_id = ? ORDER BY name`, [viewer.id]);
  return [db.get(`SELECT ${publicUserCols}, category FROM users WHERE id = ?`, [viewer.id])];
}
export const visibleUserIds = (db, viewer) => visibleUsers(db, viewer).map((u) => u.id);

export function canSeeUser(db, viewer, userId) {
  if (viewer.id === userId) return true;
  if (!isManager(viewer)) return false;
  return !!db.get('SELECT 1 AS ok FROM users WHERE id = ? AND manager_id = ?', [userId, viewer.id]);
}
export function assertCanSeeUser(db, viewer, userId) {
  if (!Number.isInteger(userId) || !canSeeUser(db, viewer, userId)) throw notFound('User not found');
}

/**
 * Load a task the viewer may access.
 * mode 'read'   → owner or owner's manager
 * mode 'owner'  → owner only (edit, status, evidence, blockers)
 * mode 'review' → owner's manager only
 * Invisible tasks are 404 (never reveal existence); visible-but-not-allowed is 403.
 */
export function getTaskFor(db, viewer, taskId, mode = 'read') {
  const t = Number.isInteger(taskId) ? db.get('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', [taskId]) : null;
  if (!t || !canSeeUser(db, viewer, t.user_id)) throw notFound('Task not found');
  if (mode === 'owner' && t.user_id !== viewer.id) throw forbidden('Only the task owner can change this task');
  if (mode === 'review' && (t.user_id === viewer.id || !isManager(viewer))) throw forbidden('Only the owner’s manager can review this task');
  return t;
}
