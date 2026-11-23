import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const badRequest = (m) => new HttpError(400, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'Forbidden') => new HttpError(403, m);

/** Wrap a sync/async handler so thrown errors reach the error middleware. */
export const h = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && typeof r.catch === 'function') r.catch(next); } catch (e) { next(e); } };

/** Parse with a zod schema, throwing a 400 with a readable message. */
export function parse(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) throw r.error;
  return r.data;
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const i = err.issues[0];
    return res.status(400).json({ error: `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}` });
  }
  if (err?.name === 'MulterError') return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB' : err.message });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

export function requestLogger(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  const t = performance.now();
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${(performance.now() - t).toFixed(1)}ms`));
  next();
}
