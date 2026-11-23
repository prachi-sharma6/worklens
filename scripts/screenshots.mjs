// Phase 1 acceptance: visit every route as both roles, collect console errors, take screenshots.
// Uses playwright-core with the locally installed Edge/Chrome (no browser download).
// Usage: npm run dev (in another terminal), then: npm run screenshots
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = 'screenshots';
fs.mkdirSync(OUT, { recursive: true });

const channel = fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'msedge' : 'chrome';
const browser = await chromium.launch({ channel });
const errors = [];

async function session({ email, theme, width = 1440, height = 900 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('wl-theme', t); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${email} ${theme} ${width}] ${page.url()} :: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${email} ${theme} ${width}] ${page.url()} :: PAGEERROR ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}
async function shot(page, path, name, full = true) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
  if (name) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}

const EMP = ['/dashboard', '/tasks', '/tasks/new', '/tasks/5', '/evidence', '/performance', '/insights', '/reports/daily', '/reports/weekly', '/people/2', '/settings'];
const MGR = ['/manager', '/team', '/people/2', '/people/6', '/tasks/5', '/reports/daily', '/reports/weekly', '/settings'];

for (const theme of ['light', 'dark']) {
  let { ctx, page } = await session({ email: 'aarav@worklens.dev', theme });
  for (const p of EMP) await shot(page, p, null);
  await shot(page, '/dashboard', `employee-dashboard-${theme}`);
  await shot(page, '/people/2', `timeline-${theme}`);
  await shot(page, '/performance', `performance-${theme}`);
  await ctx.close();

  ({ ctx, page } = await session({ email: 'manager@worklens.dev', theme }));
  for (const p of MGR) await shot(page, p, null);
  await shot(page, '/manager', `manager-dashboard-${theme}`);
  await ctx.close();
}

// mobile 375px
{
  const { ctx, page } = await session({ email: 'aarav@worklens.dev', theme: 'light', width: 375, height: 812 });
  await shot(page, '/dashboard', 'mobile-employee-dashboard');
  await shot(page, '/tasks', 'mobile-tasks');
  await ctx.close();
  const m = await session({ email: 'manager@worklens.dev', theme: 'dark', width: 375, height: 812 });
  await shot(m.page, '/manager', 'mobile-manager-dashboard-dark');
  await m.ctx.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/console-errors.txt`, errors.join('\n') || 'none');
console.log(errors.length ? `${errors.length} console errors:\n${errors.slice(0, 30).join('\n')}` : 'No console errors.');
console.log(`Screenshots in ${OUT}/`);
