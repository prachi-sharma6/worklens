// Every page × both roles × 375/768/1280 px × light/dark: console errors, failed requests, horizontal overflow.
// Read-only (no clicks that change data). Usage: dev server running, then `node scripts/responsive.mjs`.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = 'screenshots/responsive';
fs.mkdirSync(OUT, { recursive: true });
const channel = fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'msedge' : 'chrome';
const browser = await chromium.launch({ channel });

const ROLES = {
  'aarav@worklens.dev': ['/dashboard', '/tasks', '/tasks/new', '/tasks/5', '/evidence', '/performance', '/insights', '/reports/daily', '/reports/weekly', '/people/2', '/settings'],
  'manager@worklens.dev': ['/manager', '/team', '/people/2', '/people/6', '/tasks/5', '/reports/daily', '/reports/weekly', '/settings'],
};
const WIDTHS = [375, 768, 1280];
const problems = [];
let visits = 0;

for (const [email, pages] of Object.entries(ROLES)) {
  for (const theme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      await ctx.addInitScript((t) => { try { localStorage.setItem('wl-theme', t); } catch {} }, theme);
      const page = await ctx.newPage();
      const tag = () => `${email.split('@')[0]} ${theme} ${width}px ${new URL(page.url()).pathname}`;
      page.on('console', (m) => m.type() === 'error' && problems.push(`[${tag()}] console: ${m.text()}`));
      page.on('pageerror', (e) => problems.push(`[${tag()}] pageerror: ${e.message}`));
      page.on('response', (r) => { if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/api')) problems.push(`[${tag()}] HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
      await page.goto(`${BASE}/login`);
      await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'demo1234');
      await page.click('button[type=submit]'); await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      for (const p of pages) {
        await page.goto(`${BASE}${p}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(250);
        visits++;
        const o = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const over = [...document.querySelectorAll('body *')].filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.right <= vw + 1) return false;
            // horizontally scrollable containers (tables) are fine; only flag things that push the page itself
            for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden)/.test(s.overflowX)) return false; }
            return true;
          });
          return { pageWide: document.documentElement.scrollWidth > vw + 1, sample: over.slice(0, 2).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 3).join('.')}`) };
        });
        if (o.pageWide) problems.push(`[${tag()}] horizontal overflow: ${o.sample.join(', ') || 'page wider than viewport'}`);
        if (theme === 'dark' && (p === '/dashboard' || p === '/manager' || p === '/settings')) await page.screenshot({ path: `${OUT}/${email.split('@')[0]}-${p.slice(1).replace(/\//g, '-')}-${width}.png` });
      }
      await ctx.close();
    }
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/problems.txt`, problems.join('\n') || 'none');
console.log(`${visits} page visits. ${problems.length ? `${problems.length} problems:\n${problems.slice(0, 40).join('\n')}` : 'No console errors, failed requests or horizontal overflow.'}`);
