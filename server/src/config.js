// Where things live and how the server runs, locally or on Embarko (which sets APP_NAME, PORT, DATA_DIR, CRON_SECRET).
// Read after .env is loaded (index.js imports everything else dynamically).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** True on Embarko (or any host that sets APP_NAME). */
export const HOSTED = !!process.env.APP_NAME;
/** Everything that must survive a redeploy goes here. */
export const DATA_DIR = process.env.DATA_DIR || path.join(serverRoot, 'data');
export const DB_FILE = process.env.DB_PATH || path.join(DATA_DIR, 'worklens.db');
export const UPLOAD_DIR = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'uploads') : path.join(serverRoot, 'uploads');
export const HOST = process.env.HOST || (HOSTED ? '0.0.0.0' : '127.0.0.1');
export const PORT = Number(process.env.PORT ?? 4000);
/** Public address of the app, for links in Slack/Gmail. */
export const APP_URL = (process.env.APP_URL || (HOSTED ? `https://${process.env.APP_NAME}.embarko.app` : 'http://localhost:5173')).replace(/\/$/, '');
/** Secure cookies whenever the app is served over https. */
export const SECURE_COOKIES = HOSTED || process.env.NODE_ENV === 'production';

/**
 * The session-signing secret: JWT_SECRET from the environment, or (when absent) one generated once and kept in
 * DATA_DIR so sessions survive restarts and redeploys without anyone handling a secret.
 */
export function ensureJwtSecret() {
  if (process.env.JWT_SECRET) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'jwt_secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  process.env.JWT_SECRET = fs.readFileSync(file, 'utf8').trim();
}
