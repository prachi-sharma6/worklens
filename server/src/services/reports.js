// Persisted daily/weekly reports (data_json + summary). One row per (user|team, date/week); regenerating replaces it.
// Team digests are stored with user_id NULL and are visible to managers only (single-team setup — see PROGRESS.md).

const TABLE = { daily: { table: 'daily_reports', key: 'report_date' }, weekly: { table: 'weekly_reports', key: 'week_start' } };

export function saveReport(db, report) {
  const { table, key } = TABLE[report.kind];
  return db.tx(() => {
    db.run(`DELETE FROM ${table} WHERE ${key} = ? AND user_id IS ?`, [report.key, report.user_id]);
    const id = db.insert(table, { user_id: report.user_id, [key]: report.key, data_json: JSON.stringify(report.data), summary_text: report.summary_text, summary_source: report.summary_source });
    return id;
  });
}

const toReport = (kind, row) => ({
  id: `${kind}-${row[TABLE[kind].key]}-${row.user_id ?? 'team'}`, saved_id: row.id, kind, key: row[TABLE[kind].key], user_id: row.user_id,
  data: JSON.parse(row.data_json), summary_text: row.summary_text, summary_source: row.summary_source,
  generated_at: row.updated_at, delivered_via: row.delivered_via, delivered_at: row.delivered_at,
});

export function getSaved(db, kind, id) {
  const row = db.get(`SELECT * FROM ${TABLE[kind].table} WHERE id = ?`, [id]);
  return row ? toReport(kind, row) : null;
}

/** History for the given audience: userIds (numbers) and/or includeTeam (manager digests). */
export function history(db, kind, { userIds = [], includeTeam = false, limit = 30 }) {
  const { table, key } = TABLE[kind];
  const ids = userIds.length ? userIds : [-1];
  const rows = db.all(`SELECT r.id, r.user_id, r.${key} AS period_key, r.summary_text, r.summary_source, r.updated_at, r.delivered_via, u.name AS user_name
                       FROM ${table} r LEFT JOIN users u ON u.id = r.user_id
                       WHERE r.user_id IN (${ids.map(() => '?').join(',')}) ${includeTeam ? 'OR r.user_id IS NULL' : ''}
                       ORDER BY r.${key} DESC, r.user_id IS NOT NULL, u.name LIMIT ?`, [...ids, limit]);
  return rows.map((r) => ({ saved_id: r.id, kind, key: r.period_key, user_id: r.user_id, user_name: r.user_name ?? 'Team digest', summary_text: r.summary_text, summary_source: r.summary_source, generated_at: r.updated_at, delivered_via: r.delivered_via }));
}
