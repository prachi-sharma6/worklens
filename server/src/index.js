import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const { openDb } = await import('./db/index.js');
const { seedDatabase } = await import('./db/seed.js');
const { createApp } = await import('./app.js');
const { recomputeAll } = await import('./scoring/index.js');
const { startIntegrations } = await import('./integrations/outbox.js');

const db = openDb(process.env.DB_PATH || undefined);
if (!db.get('SELECT COUNT(*) AS n FROM users').n) {
  console.log('Empty database — loading demo data:', seedDatabase(db));
}
const t0 = performance.now();
console.log(`Recomputed weekly scores for ${recomputeAll(db)} employees in ${(performance.now() - t0).toFixed(0)}ms`);
const port = Number(process.env.PORT ?? 4000);
startIntegrations(db);
createApp(db).listen(port, '127.0.0.1', () => console.log(`WorkLens API on http://localhost:${port}`));
