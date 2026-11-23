import jwt from 'jsonwebtoken';
import { HttpError, forbidden } from './lib/http.js';

export const COOKIE = 'wl_token';
const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set (see .env.example)');
  return s;
};

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, secret(), { expiresIn: '7d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000, path: '/' });
}
export const clearSession = (res) => res.clearCookie(COOKIE, { path: '/' });

const PUBLIC_USER = 'id, name, email, role, team_id, manager_id, title, avatar_color, timezone';
export const publicUserCols = PUBLIC_USER;

/** Returns the signed-in user (fresh from the DB) or null. Never throws. */
export function sessionUser(db, req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
    return db.get(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`, [Number(payload.sub)]) ?? null;
  } catch { return null; }
}

/** Attaches req.user from the JWT cookie; 401 when missing/invalid. The user row is always re-read (role changes apply at once). */
export function requireAuth(db) {
  return (req, _res, next) => {
    const user = sessionUser(db, req);
    if (!user) return next(new HttpError(401, 'Not signed in'));
    req.user = user;
    next();
  };
}

export const requireManager = (req, _res, next) => (req.user?.role === 'manager' ? next() : next(forbidden('Managers only')));
