import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import { requireAuth } from './auth.js';
import { errorHandler, requestLogger, notFound } from './lib/http.js';
import { authRoutes, accountRoutes } from './routes/account.js';
import { taskRoutes } from './routes/tasks.js';
import { peopleRoutes } from './routes/people.js';
import { integrationRoutes } from './routes/integrations.js';
import { onChanged } from './lib/events.js';
import { createRecomputeScheduler } from './scoring/index.js';

export function createApp(db, { recomputeDelayMs = 1500 } = {}) {
  const app = express();
  const scheduler = createRecomputeScheduler(db, recomputeDelayMs);
  onChanged(db, (userId) => scheduler.schedule(userId));
  app.locals.scheduler = scheduler;
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRoutes(db));
  app.use('/api', requireAuth(db));
  app.use('/api', accountRoutes(db));
  app.use('/api', taskRoutes(db));
  app.use('/api', peopleRoutes(db));
  app.use('/api', integrationRoutes(db));
  app.use('/api', (_req, _res, next) => next(notFound('Unknown API route')));

  // `npm start`: serve the built client (client/dist) from the same origin, with SPA fallback.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (process.env.NODE_ENV !== 'test' && fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
