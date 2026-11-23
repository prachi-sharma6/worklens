// Runs the destructive smoke test against a throwaway copy of the database, on its own port, with viaSocket
// switched off — so the live demo data (and its real AI outputs) is untouched and no credits are spent.
// Usage: npm run smoke:isolated   (builds the client first if client/dist is missing)
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.env.SMOKE_PORT ?? '4100';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
if (!fs.existsSync(path.join(root, 'client/dist/index.html'))) execSync('npm run build', { cwd: root, stdio: 'inherit' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worklens-smoke-'));
const db = path.join(tmp, 'worklens.db');
const live = path.join(root, 'server/data/worklens.db');
if (fs.existsSync(live)) {
  // node:sqlite: VACUUM INTO makes a consistent copy even while the dev server has the DB open.
  const { DatabaseSync } = await import('node:sqlite');
  const src = new DatabaseSync(live, { readOnly: true });
  src.exec(`VACUUM INTO '${db.replace(/'/g, "''")}'`);
  src.close();
}

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: path.join(root, 'server'),
  env: { ...process.env, PORT, DB_PATH: db, VIASOCKET_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

const base = `http://localhost:${PORT}`;
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  try { up = (await fetch(`${base}/api/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 500)); }
}
if (!up) { console.error('isolated server did not start:\n' + log); server.kill(); process.exit(1); }
console.log(`isolated server on ${base} (DB copy in ${tmp}, viaSocket disabled)`);

const smoke = spawn(process.execPath, ['scripts/flow-smoke.mjs'], { cwd: root, env: { ...process.env, BASE_URL: base }, stdio: 'inherit' });
const code = await new Promise((r) => smoke.on('exit', r));
const problems = log.split('\n').filter((l) => / 5\d\d \d|Error|failed/i.test(l));
if (problems.length) console.log('\nserver-side errors during the run:\n' + problems.slice(0, 20).join('\n'));
server.kill();
await new Promise((r) => (server.exitCode !== null ? r() : server.on('exit', r)));
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { console.log(`(could not delete ${tmp}; safe to remove by hand)`); }
process.exit(code ?? 1);
