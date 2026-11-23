// SQLite via Node's built-in node:sqlite (no native addon — see CLAUDE.md "Gotchas").
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = path.resolve(here, '../../data/worklens.db');

/** Bind values must be string/number/bigint/null/Uint8Array: map booleans → 0/1, undefined → null, objects → JSON. */
function clean(params) {
  if (params == null) return params;
  if (Array.isArray(params)) return params.map(cv);
  const out = {};
  for (const [k, v] of Object.entries(params)) out[k] = cv(v);
  return out;
}
function cv(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}
const plain = (r) => (r ? { ...r } : r);

export function openDb(file = DEFAULT_DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  const args = (p) => (p === undefined ? [] : Array.isArray(p) ? clean(p) : [clean(p)]);

  const db = {
    raw,
    all: (sql, p) => stmt(sql).all(...args(p)).map(plain),
    get: (sql, p) => plain(stmt(sql).get(...args(p))),
    run: (sql, p) => { const r = stmt(sql).run(...args(p)); return { changes: Number(r.changes), id: Number(r.lastInsertRowid) }; },
    exec: (sql) => raw.exec(sql),
    /** Run fn inside a transaction (nested calls join the outer one). */
    tx(fn) {
      if (db._inTx) return fn();
      db._inTx = true;
      raw.exec('BEGIN IMMEDIATE');
      try { const out = fn(); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
      finally { db._inTx = false; }
    },
    /** Insert a row object; returns new id. */
    insert(table, row) {
      const keys = Object.keys(row);
      const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => '$' + k).join(',')})`;
      return db.run(sql, row).id;
    },
    /** Update columns by id; always bumps updated_at. */
    update(table, id, patch) {
      const keys = Object.keys(patch).filter((k) => k !== 'id');
      if (!keys.length) return;
      const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = $${k}`).join(', ')}, updated_at = $__now WHERE id = $__id`;
      db.run(sql, { ...patch, __now: new Date().toISOString(), __id: id });
    },
    close: () => raw.close(),
    _inTx: false,
  };
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.all('SELECT name FROM schema_migrations').map((r) => r.name));
  const dir = path.join(here, 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => /^\d+_.*\.sql$/.test(x)).sort()) {
    if (done.has(f)) continue;
    db.tx(() => {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [f, new Date().toISOString()]);
    });
  }
}
