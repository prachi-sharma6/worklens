// The WorkLens demo video, end to end and repeatable:  node scripts/demo/voice.mjs && node scripts/demo/make-video.mjs
//
// 1. Starts the built app on a COPY of the database (port 4200), resets the demo data there and turns every
//    automation off except AI task suggestions — your live data, Slack and Gmail are never touched.
// 2. Drives Edge (headless, 1280×720 at 1.5× = 1080p) through the real app, scene by scene, with a visible cursor.
//    Every scene lasts at least as long as its narration clip (demo-build/voice.json), so the voice never cuts off.
//    Frames come from the browser's own compositor (CDP screencast) and are rebuilt at a constant 30 fps.
//    Waiting on the network (the AI suggestion) happens "off air": those seconds are cut, nothing else is.
// 3. Mixes the clips at their scene times, writes captions (WebVTT) and the final MP4 into client/public/demo/.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const build = path.join(root, 'demo-build');
const framesDir = path.join(build, 'frames');
const outDir = path.join(root, 'client/public/demo');
const PORT = process.env.DEMO_PORT ?? '4200';
const BASE = `http://localhost:${PORT}`;
const FPS = 30;
const LEAD = 0.35; // seconds of picture before each clip starts
const TAIL = 0.6;  // breath after each clip before the next scene

const clips = JSON.parse(fs.readFileSync(path.join(build, 'voice.json'), 'utf8'));
const dur = Object.fromEntries(clips.map((c) => [c.id, c.duration]));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ------------------------------------------------------------------ 1. isolated server on a DB copy
if (!fs.existsSync(path.join(root, 'client/dist/index.html'))) throw new Error('Build the client first: npm run build');
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(path.join(build, 'db'), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
const dbCopy = path.join(build, 'db', 'worklens.db');
for (const f of [dbCopy, `${dbCopy}-wal`, `${dbCopy}-shm`]) fs.rmSync(f, { force: true });
const { DatabaseSync } = await import('node:sqlite');
const live = path.join(root, 'server/data/worklens.db');
if (fs.existsSync(live)) { const src = new DatabaseSync(live, { readOnly: true }); src.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`); src.close(); }

const server = spawn(process.execPath, ['--env-file=../.env', 'src/index.js'], {
  cwd: path.join(root, 'server'),
  env: { ...process.env, PORT, DB_PATH: dbCopy, DATA_DIR: path.join(build, 'db'), NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const stopServer = async () => { server.kill(); await new Promise((r) => (server.exitCode !== null ? r() : server.on('exit', r))); };
process.on('uncaughtException', async (e) => { console.error(e); await stopServer(); process.exit(1); });
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 500)); } }
if (!up) { console.error(serverLog); await stopServer(); throw new Error('demo server did not start'); }
log(`demo server on ${BASE}`);

// ------------------------------------------------------------------ 2. browser + cursor + frame capture
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, colorScheme: 'dark' });
await ctx.addInitScript(() => {
  const KEY = '__demoCursor';
  const install = () => {
    if (document.getElementById('demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2.5V19l4.6-4.1 3 6.5 3-1.4-2.9-6.4 6.3-.3z" fill="#fff" stroke="#0b0f17" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', willChange: 'transform', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.45))' });
    let p; try { p = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { p = null; }
    p ??= { x: 900, y: 420 };
    c.style.transform = `translate(${p.x - 4}px, ${p.y - 2.5}px)`;
    document.documentElement.appendChild(c);
    window.__cursor = {
      move(x, y, ms) {
        c.style.transition = `transform ${ms}ms cubic-bezier(.33,.72,.3,1)`;
        c.style.transform = `translate(${x - 4}px, ${y - 2.5}px)`;
        sessionStorage.setItem(KEY, JSON.stringify({ x, y }));
      },
      ripple(x, y) {
        const r = document.createElement('div');
        Object.assign(r.style, { position: 'fixed', left: `${x - 18}px`, top: `${y - 18}px`, width: '36px', height: '36px', borderRadius: '50%', border: '2px solid rgba(94,234,212,.95)', background: 'rgba(94,234,212,.2)', zIndex: '2147483646', pointerEvents: 'none', transform: 'scale(.35)', opacity: '1', transition: 'transform 450ms ease-out, opacity 450ms ease-out' });
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transform = 'scale(1.35)'; r.style.opacity = '0'; }));
        setTimeout(() => r.remove(), 520);
      },
      nudge() { c.style.opacity = c.style.opacity === '0.999' ? '1' : '0.999'; }, // forces one fresh frame
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  // The landing page's own "Watch the demo" section would show this video inside itself: leave it out of the recording.
  const hide = () => { const st = document.createElement('style'); st.textContent = '#demo{display:none!important}'; document.documentElement.appendChild(st); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hide); else hide();
});
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/auth/session')) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

// Virtual clock: real time minus the seconds spent "off air".
let pausedTotal = 0; let paused = false; let recording = false;
const vnow = () => performance.now() / 1000 - pausedTotal;
const frames = []; const writes = [];
let lastKept = -1;
const cdp = await ctx.newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  if (!recording || paused) return;
  const t = vnow();
  if (t - lastKept < 1 / (FPS * 2)) return; // at most 60 kept per second; the encoder resamples to 30
  lastKept = t;
  const file = path.join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
  frames.push({ file, t });
  writes.push(fs.promises.writeFile(file, Buffer.from(data, 'base64')));
});

const wait = (ms) => page.waitForTimeout(ms);
const fresh = () => page.evaluate(() => window.__cursor?.nudge());
async function offAir(fn) {
  paused = true; const s = performance.now() / 1000;
  try { return await fn(); } finally { pausedTotal += performance.now() / 1000 - s; paused = false; await fresh(); await wait(60); }
}

/** Smoothly scroll the element's scroll container so the element sits around `at` (0 = top, .5 = middle). */
async function scrollTo(loc, { at = 0.4, ms = 900, force = false } = {}) {
  const h = await loc.elementHandle();
  await page.evaluate(async ([el, at, ms, force]) => {
    let sc = el.parentElement;
    while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
    sc ??= document.scrollingElement;
    const isDoc = sc === document.scrollingElement || sc === document.body;
    const view = isDoc ? { top: 0, height: innerHeight } : sc.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const fullyIn = r.top >= view.top + 70 && r.bottom <= view.top + view.height - 30;
    if (fullyIn && !force) return;
    const from = sc.scrollTop;
    const to = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, from + (r.top - view.top) - view.height * at));
    if (Math.abs(to - from) < 2) return;
    await new Promise((done) => {
      const t0 = performance.now();
      const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      const step = (now) => { const k = Math.min(1, (now - t0) / ms); sc.scrollTop = from + (to - from) * ease(k); k < 1 ? requestAnimationFrame(step) : done(); };
      requestAnimationFrame(step);
    });
  }, [h, at, ms, force]);
}
async function scrollTop(ms = 900) {
  await page.evaluate(async (ms) => {
    const scs = [document.scrollingElement, ...document.querySelectorAll('main')].filter((s) => s && s.scrollTop > 0);
    await Promise.all(scs.map((sc) => new Promise((done) => {
      const from = sc.scrollTop; const t0 = performance.now();
      const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      const step = (now) => { const k = Math.min(1, (now - t0) / ms); sc.scrollTop = from * (1 - ease(k)); k < 1 ? requestAnimationFrame(step) : done(); };
      requestAnimationFrame(step);
    })));
  }, ms);
}
async function cursorTo(x, y, ms = 650) {
  await page.evaluate(([x, y, ms]) => window.__cursor?.move(x, y, ms), [x, y, ms]);
  await wait(ms + 40);
  await page.mouse.move(x, y); // real hover state, under the drawn cursor
}
async function point(loc, { ms = 650, at } = {}) {
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await scrollTo(loc, at === undefined ? {} : { at });
  const b = await loc.boundingBox();
  const x = Math.round(b.x + Math.min(b.width / 2, 120)); const y = Math.round(b.y + b.height / 2);
  await cursorTo(x, y, ms);
  return { x, y };
}
async function click(loc, opts = {}) {
  const { x, y } = await point(loc, opts);
  await wait(110);
  await page.evaluate(([x, y]) => window.__cursor?.ripple(x, y), [x, y]);
  await page.mouse.click(x, y);
}
async function typeInto(loc, text, delay = 30) {
  await click(loc);
  // Some fields arrive pre-filled (the wrap-up copies the expected outcome): select it so the typing replaces it.
  if (await loc.inputValue().catch(() => '')) { await page.keyboard.press('Control+A'); await wait(120); }
  await page.keyboard.type(text, { delay });
}

const marks = [];
async function scene(id, fn) {
  if (!(id in dur)) throw new Error(`no voice clip for ${id}`);
  const start = vnow();
  marks.push({ id, at: start + LEAD });
  log(`scene ${id} (${dur[id].toFixed(1)}s voice)`);
  const end = start + LEAD + dur[id] + TAIL;
  await fn({ until: async (frac) => { const t = start + LEAD + dur[id] * frac - vnow(); if (t > 0) await wait(t * 1000); } });
  const left = end - vnow();
  if (left > 0) await wait(left * 1000);
  else log(`  ${id} ran ${(-left).toFixed(1)}s past its voice (silence, not a cut)`);
}

// ------------------------------------------------------------------ prepare data (not recorded)
const api = (p, method = 'GET', body) => page.evaluate(async ([p, method, body]) => {
  const r = await fetch(p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
}, [p, method, body]);
await page.goto(`${BASE}/login`);
if ((await api('/api/auth/login', 'POST', { email: 'manager@worklens.dev', password: 'demo1234' })).status !== 200) throw new Error('manager login failed');
if ((await api('/api/admin/reset-demo', 'POST')).status !== 204) throw new Error('demo reset failed');
const settings = (await api('/api/settings')).json;
const features = Object.fromEntries(Object.keys(settings.features).map((k) => [k, k === 'ai_enrichment']));
if ((await api('/api/settings', 'PATCH', { features })).status !== 200) throw new Error('could not set automations for the recording');
await api('/api/auth/logout', 'POST');
await ctx.clearCookies();
await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
await page.goto(`${BASE}/login`);
await page.getByRole('heading', { name: 'Make every contribution visible.' }).waitFor();
await page.evaluate(() => document.fonts.ready);
await wait(1200); // entrance animations finish before the first frame

// ------------------------------------------------------------------ 3. the walkthrough
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
recording = true;
await fresh();
const T0 = vnow();
const TITLE = 'Cut checkout page load to under 2 seconds';
let taskPath = '';

await scene('s01_landing', async ({ until }) => {
  await until(0.12);
  await point(page.getByRole('heading', { name: 'Make every contribution visible.' }), { ms: 900 });
  await until(0.36);
  await scrollTo(page.locator('#how'), { at: 0.08, ms: 1400, force: true });
  await until(0.62);
  await scrollTo(page.locator('#viasocket'), { at: 0.08, ms: 1400, force: true });
  await until(0.88);
  await scrollTop(1300);
});

await scene('s02_signin', async ({ until }) => {
  await click(page.getByRole('button', { name: /Aarav Sharma/ }), { ms: 900 });
  await page.waitForURL(/\/dashboard/);
  await page.getByText('Focus now').first().waitFor();
});

await scene('s03_dashboard', async ({ until }) => {
  await point(page.getByText('Focus now').first(), { ms: 700 });
  await until(0.35);
  await scrollTo(page.getByText(/Today.s plan/i).first(), { at: 0.2, ms: 1100, force: true });
  await until(0.7);
  const attention = page.getByText('Needs your attention').first();
  if (await attention.count()) await point(attention, { ms: 700, at: 0.3 });
});

await scene('s04_create', async ({ until }) => {
  await click(page.locator('aside').getByRole('button', { name: 'Add Task' }), { ms: 700 });
  const dlg = page.getByRole('dialog');
  await dlg.locator('#task-title').waitFor();
  await wait(350);
  await typeInto(dlg.locator('#task-title'), TITLE, 26);
  await typeInto(dlg.getByLabel('Expected outcome'), 'Checkout loads in under 2 s on 4G for 95% of visits', 22);
  await click(dlg.getByLabel('Priority'));
  await dlg.getByLabel('Priority').selectOption('high');
  await wait(250);
  await click(dlg.getByRole('button', { name: 'Add', exact: true }));
  await page.waitForURL(/\/tasks\/\d+$/);
  taskPath = new URL(page.url()).pathname;
  await page.getByRole('heading', { name: TITLE }).first().waitFor();
});

// The AI suggestion is a real viaSocket AI call: wait for it off air (those seconds are cut from the video).
const taskId = Number(taskPath.split('/').pop());
const aiReady = await offAir(async () => {
  for (let i = 0; i < 90; i++) {
    const t = (await api(`/api/tasks/${taskId}`)).json?.task;
    if (t?.ai_suggestions_json) return true;
    await wait(1000);
  }
  return false;
});
if (!aiReady) throw new Error('AI suggestions did not arrive in 90 s — not recording a video that says they did');

await scene('s05_ai', async ({ until }) => {
  const status = page.getByLabel('Change status').first();
  await click(status);
  await status.selectOption('in_progress');
  const card = page.getByText('AI suggestions').first();
  await card.waitFor();
  await wait(300);
  await point(card, { ms: 700, at: 0.18 });
  // Tick the AI's sharper outcome (unticked by default because Aarav wrote one), then apply it: "Applied 1 suggestion".
  const aiCard = page.locator('.card', { has: page.getByText('AI suggestions') }).first();
  const outcomeBox = aiCard.locator('li', { hasText: 'Expected outcome' }).getByRole('checkbox');
  await until(0.5);
  if (!(await outcomeBox.isChecked())) await click(outcomeBox);
  await wait(350);
  await click(page.getByRole('button', { name: 'Apply selected' }));
  await page.getByText(/^Applied \d suggestion/).first().waitFor();
  await page.getByRole('button', { name: 'Apply selected' }).waitFor({ state: 'detached' }).catch(() => {});
});

await scene('s06_blocker', async ({ until }) => {
  await scrollTop(600);
  await click(page.getByRole('button', { name: 'Report blocker' }).first());
  const dlg = page.getByRole('dialog');
  await typeInto(dlg.getByLabel('What is blocking you?'), 'Waiting for the payments team to enable the new caching endpoint.', 20);
  await typeInto(dlg.getByLabel('Who / what (name)'), 'Payments team', 30);
  await click(dlg.getByRole('button', { name: 'Report blocker' }));
  await page.getByRole('button', { name: 'Resolve' }).waitFor();
  await point(page.getByRole('button', { name: 'Resolve' }), { ms: 600 });
});

await scene('s07_complete', async ({ until }) => {
  await click(page.getByRole('button', { name: 'Resolve' }));
  await typeInto(page.getByPlaceholder('How was it resolved?'), 'Endpoint enabled by payments.', 22);
  await click(page.getByRole('button', { name: 'Mark resolved' }));
  await page.getByText('Resolution: Endpoint enabled').waitFor();
  await scrollTop(500);
  await click(page.getByRole('button', { name: 'Complete', exact: true }));
  const dlg = page.getByRole('dialog');
  await typeInto(dlg.getByLabel('Actual outcome'), 'Checkout now loads in 1.6 s on 4G (p95).', 20);
  await click(dlg.getByRole('button', { name: 'Add evidence' }));
  await dlg.getByLabel('Evidence type').selectOption('explanation');
  await typeInto(dlg.getByLabel(/Explanation/), 'Lazy-loaded the payment widget and cached prices; p95 load time fell from 3.4 s to 1.6 s.', 14);
  await click(dlg.getByRole('button', { name: 'Complete task' }));
  await page.getByText('Pending review').first().waitFor();
  await point(page.getByText('Pending review').first(), { ms: 600 });
});

await scene('s08_performance', async ({ until }) => {
  await click(page.locator('aside').getByRole('link', { name: 'Performance' }));
  await page.waitForURL(/\/performance/);
  await page.getByRole('button', { name: 'How is quality calculated?' }).first().waitFor();
  await wait(500);
  await until(0.45);
  await click(page.getByRole('button', { name: 'How is quality calculated?' }).first(), { at: 0.35 });
  await until(0.97);
  await page.keyboard.press('Escape');
});

await scene('s09_manager', async ({ until }) => {
  await scrollTop(400);
  await click(page.getByRole('button', { name: 'User menu' }));
  await wait(350);
  await click(page.getByRole('button', { name: 'Sign out' }));
  await page.waitForURL(/\/login/);
  await page.getByRole('button', { name: /Meera Kapoor/ }).waitFor();
  await wait(300);
  await click(page.getByRole('button', { name: /Meera Kapoor/ }));
  await page.waitForURL(/\/manager/);
  await page.getByText(/Review queue/).first().waitFor();
  await wait(400);
  await until(0.62);
  await point(page.getByText(/Review queue/).first(), { ms: 700, at: 0.25 });
});

await scene('s10_review', async ({ until }) => {
  await click(page.getByRole('link', { name: new RegExp(TITLE) }).first(), { at: 0.4 });
  await page.waitForURL(new RegExp(`${taskPath}$`));
  await wait(400);
  await point(page.getByText(/Lazy-loaded the payment widget/).first(), { ms: 700, at: 0.35 });
  await until(0.45);
  await click(page.getByRole('button', { name: '4 stars' }), { at: 0.45 });
  await wait(300);
  await click(page.getByRole('button', { name: 'Verify' }));
  await page.getByText('Verified').first().waitFor();
});

await scene('s11_team', async ({ until }) => {
  await click(page.locator('aside').getByRole('link', { name: 'Team Performance' }));
  await page.waitForURL(/\/team/);
  await wait(600);
  await until(0.5);
  await click(page.locator('aside').getByRole('link', { name: 'Daily Reports' }));
  await page.waitForURL(/\/reports\/daily/);
  await wait(500);
});

await scene('s12_integrations', async ({ until }) => {
  await click(page.locator('aside').getByRole('link', { name: 'Integrations' }));
  await page.waitForURL(/\/integrations/);
  await page.getByText('One connection layer for AI and 2,300+ apps').waitFor();
  await point(page.getByText('One connection layer for AI and 2,300+ apps'), { ms: 700 });
  await until(0.3);
  await scrollTo(page.getByText('WHAT IT DOES HERE').first(), { at: 0.15, ms: 1100, force: true });
  await until(0.5);
  await scrollTo(page.getByText('You’ll be rung when…'), { at: 0.15, ms: 1600, force: true });
  await point(page.getByText('A critical task passes its deadline unfinished'), { ms: 800 });
});

await scene('s13_close', async ({ until }) => {
  await scrollTop(500);
  await click(page.getByRole('button', { name: 'User menu' }));
  await wait(300);
  await click(page.getByRole('button', { name: 'Sign out' }));
  await page.waitForURL(/\/login/);
  await page.getByRole('heading', { name: 'Make every contribution visible.' }).waitFor();
  await cursorTo(1180, 640, 900);
});
await wait(900);
const TEND = vnow();
recording = false;
await cdp.send('Page.stopScreencast');
await Promise.all(writes);
await browser.close();
await stopServer();
log(`recorded ${frames.length} frames, ${(TEND - T0).toFixed(1)}s, cut ${pausedTotal.toFixed(1)}s off air`);
if (problems.length) { console.log('problems seen during the recording:\n' + problems.join('\n')); throw new Error('the recording had errors — not encoding it'); }

// ------------------------------------------------------------------ 4. encode: constant 30 fps video + mixed voice + captions
const list = ['ffconcat version 1.0'];
const keep = frames.filter((f) => f.t >= T0);
keep.forEach((f, i) => {
  const next = i + 1 < keep.length ? keep[i + 1].t : TEND;
  list.push(`file '${f.file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, next - (i === 0 ? T0 : f.t)).toFixed(4)}`);
});
list.push(`file '${keep.at(-1).file.replace(/\\/g, '/')}'`);
fs.writeFileSync(path.join(build, 'frames.ffconcat'), list.join('\n'));
const total = TEND - T0;
const video = path.join(build, 'video.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(build, 'frames.ffconcat'),
  '-vf', `fps=${FPS},scale=1920:1080:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-tune', 'animation',
  '-r', String(FPS), '-t', total.toFixed(3), '-movflags', '+faststart', video], { stdio: 'inherit' });

const offsets = marks.map((m) => ({ ...m, offset: m.at - T0, clip: clips.find((c) => c.id === m.id) }));
const inputs = offsets.flatMap((o) => ['-i', o.clip.file]);
const filter = offsets.map((o, i) => `[${i}:a]aresample=48000,adelay=${Math.round(o.offset * 1000)}:all=1[a${i}]`).join(';')
  + `;${offsets.map((_, i) => `[a${i}]`).join('')}amix=inputs=${offsets.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)}[out]`;
const audio = path.join(build, 'voice.m4a');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', audio], { stdio: 'inherit' });
const final = path.join(outDir, 'worklens-demo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', '-shortest', final], { stdio: 'inherit' });

// Captions: each clip's subtitle cues, shifted to where the clip plays.
const toSec = (s) => { const [h, m, rest] = s.split(':'); return +h * 3600 + +m * 60 + parseFloat(rest.replace(',', '.')); };
const vtt = (x) => { const h = Math.floor(x / 3600); const m = Math.floor((x % 3600) / 60); const s = (x % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}`; };
const cues = [];
for (const o of offsets) {
  const blocks = fs.readFileSync(o.clip.srt, 'utf8').replace(/\r/g, '').trim().split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n'); const time = lines.find((l) => l.includes('-->')); if (!time) continue;
    const [a, z] = time.split('-->').map((s) => toSec(s.trim()));
    cues.push(`${vtt(o.offset + a)} --> ${vtt(o.offset + z)}\n${lines.slice(lines.indexOf(time) + 1).join('\n')}`);
  }
}
fs.writeFileSync(path.join(outDir, 'worklens-demo.en.vtt'), `WEBVTT\n\n${cues.join('\n\n')}\n`);

// Poster: the landing page's first second.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.5', '-i', final, '-frames:v', '1', '-q:v', '3', path.join(outDir, 'worklens-demo-poster.jpg')]);
// Stutter check: during motion the compositor sends a frame every ~16–33 ms; a gap of 100–700 ms between two frames
// that are both part of a moving stretch means a visible hitch. (Longer gaps are just a still screen.)
const gapsMs = keep.slice(1).map((f, i) => (f.t - keep[i].t) * 1000);
const maxMotionGap = Math.max(0, ...gapsMs.filter((g, i) => g < 700 && (gapsMs[i - 1] ?? 999) < 50 && (gapsMs[i + 1] ?? 999) < 50)) / 1000;
fs.writeFileSync(path.join(build, 'timeline.json'), JSON.stringify({ total, cutOffAir: pausedTotal, framesCaptured: keep.length, maxMotionGap, scenes: offsets.map((o) => ({ id: o.id, start: +o.offset.toFixed(2), voice: +o.clip.duration.toFixed(2) })) }, null, 2));
const mb = (fs.statSync(final).size / 1048576).toFixed(1);
log(`done: client/public/demo/worklens-demo.mp4 (${total.toFixed(1)}s, ${mb} MB) + captions + poster`);
