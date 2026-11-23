import { chromium } from 'playwright-core';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const b = await chromium.launch({ channel: 'msedge' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `screenshots/fail-${name.replace(/\W+/g, '_')}.png` }); } };

async function login(email) {
  await page.goto(`${BASE}/login`);
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]'); await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
// reset demo data on the server (manager-only endpoint) so runs are repeatable
await login('manager@worklens.dev');
const reset = await page.evaluate(async () => (await fetch('/api/admin/reset-demo', { method: 'POST' })).status);
console.log(reset === 204 ? 'OK   reset demo data' : `FAIL reset demo data (${reset})`);
// The smoke test must never spend viaSocket credits or post to real Slack/Gmail: switch every automation off.
const off = await page.evaluate(async () => (await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ features: { ai_enrichment: false, ai_blockers: false, ai_reports: false, slack_alerts: false, email_reports: false, employee_dms: false } }) })).status);
console.log(off === 200 ? 'OK   automations off for the smoke run' : `FAIL automations off (${off})`);
await login('aarav@worklens.dev');

let taskUrl;
await step('quick-add via slide-over', async () => {
  await page.getByRole('button', { name: 'Add Task' }).first().click();
  await page.fill('#task-title', 'Flow test: ship audit log');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/tasks\/\d+$/); taskUrl = page.url();
  await page.getByText('Flow test: ship audit log').first().waitFor();
});
await step('command palette finds task', async () => {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Flow test');
  await page.getByRole('dialog', { name: 'Command palette' }).getByText('Flow test: ship audit log').waitFor();
  await page.keyboard.press('Escape');
});

const status = () => page.getByLabel('Change status').first();
await step('start task (in progress)', async () => {
  await status().selectOption('in_progress');
  await page.getByText('In progress').first().waitFor();
});
await step('report blocker', async () => {
  await page.getByRole('button', { name: 'Report blocker' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('What is blocking you?').fill('Waiting for the platform team to provision the audit table.');
  await dlg.getByLabel('Who / what (name)').fill('Platform team');
  await dlg.getByRole('button', { name: 'Report blocker' }).click();
  await page.getByRole('button', { name: 'Resolve' }).waitFor();
});
await step('resolve blocker', async () => {
  await page.getByRole('button', { name: 'Resolve' }).click();
  await page.getByPlaceholder('How was it resolved?').fill('Table provisioned by platform.');
  await page.getByRole('button', { name: 'Mark resolved' }).click();
  await page.getByText('Resolution: Table provisioned').waitFor();
});
await step('complete with evidence (wrap-up)', async () => {
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Actual outcome').fill('Audit log shipped for all admin actions.');
  await dlg.getByRole('button', { name: 'Add evidence' }).click();
  await dlg.getByLabel('Evidence type').selectOption('explanation');
  await dlg.getByLabel(/Explanation/).fill('Added audit_log table and middleware; verified 12 admin actions are recorded in staging.');
  await dlg.getByRole('button', { name: 'Complete task' }).click();
  await page.getByText('Pending review').first().waitFor();
});
await step('upload screenshot evidence (multipart)', async () => {
  await page.getByRole('button', { name: 'Add evidence' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Evidence type').selectOption('screenshot');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await dlg.locator('input[type=file]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png });
  await dlg.getByRole('button', { name: 'Submit evidence' }).click();
  const link = page.getByRole('link', { name: 'Open attached file' }).first();
  await link.waitFor();
  const status = await page.evaluate(async (href) => (await fetch(href)).status, await link.getAttribute('href'));
  if (status !== 200) throw new Error(`file fetch ${status}`);
});
await step('employee cannot open manager page', async () => {
  await page.goto(`${BASE}/manager`); await page.waitForURL(/\/dashboard/);
});
await step('overdue-only filter (server-side)', async () => {
  await page.goto(`${BASE}/tasks`);
  await page.getByRole('button', { name: 'Overdue only' }).click();
  await page.getByText(/overdue/i).first().waitFor();
});
await login('manager@worklens.dev');
await step('manager requests clarification', async () => {
  await page.goto(taskUrl);
  await page.getByLabel(/Note \(required/).fill('Can you add the before/after numbers?');
  await page.getByRole('button', { name: 'Ask to clarify' }).click();
  await page.getByText('Clarification requested').first().waitFor();
});
await login('aarav@worklens.dev');
await step('employee sees nudge on dashboard', async () => {
  await page.goto(`${BASE}/dashboard`);
  await page.getByText('Needs your attention').waitFor();
  await page.getByRole('link', { name: /Flow test: ship audit log/ }).first().click();
  await page.waitForURL(taskUrl);
});
await step('employee responds and resubmits', async () => {
  await page.getByLabel('Your response').fill('Added numbers: 12 admin actions logged in staging, 0 missing.');
  await page.getByRole('button', { name: 'Resubmit for review' }).click();
  await page.getByText('Pending review').first().waitFor();
});
await login('manager@worklens.dev');
await step('manager verifies with rating', async () => {
  await page.goto(taskUrl);
  await page.getByRole('button', { name: '4 stars' }).click();
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByText('Verified').first().waitFor();
});
await step('whole loop on the employee timeline', async () => {
  await page.goto(`${BASE}/people/2`);
  await page.getByRole('button', { name: 'Everything' }).click();
  for (const t of ['Created “Flow test: ship audit log”', 'Blocked: Flow test: ship audit log', 'Unblocked: Flow test: ship audit log', 'Completed “Flow test: ship audit log”', 'Feedback on “Flow test: ship audit log”', 'Verified: Flow test: ship audit log']) {
    await page.getByText(t).first().waitFor({ timeout: 4000 });
  }
});
await step('manager generates + saves team weekly report, reopens from history', async () => {
  await page.goto(`${BASE}/reports/weekly`);
  await page.getByRole('button', { name: /Generate & save/ }).click();
  await page.getByText('Viewing the saved version').waitFor();
  await page.getByText('Scores for this week').waitFor();
  await page.getByRole('button', { name: /Back to live preview/ }).click();
  await page.getByRole('button', { name: /Team digest/ }).first().click();
  await page.getByText('Viewing the saved version').waitFor();
});
await step('manager recomputes stored scores on a profile', async () => {
  await page.goto(`${BASE}/people/2`);
  await page.getByRole('tab', { name: 'Scores' }).click();
  await page.getByText('Stored weekly records').waitFor();
  await page.getByRole('button', { name: 'Recompute now' }).click();
  await page.getByText('Scores recomputed').waitFor();
});
await step('reject requires a note', async () => {
  await page.goto(taskUrl);
  await page.getByRole('button', { name: 'Reject' }).click();
  await page.getByText(/note is required|required/i).first().waitFor();
});
await step('weights must total 100', async () => {
  await page.goto(`${BASE}/settings`);
  const inputs = page.locator('input[type=number]');
  await inputs.first().fill('40');
  await page.getByText(/115|must total|total/i).first().waitFor();
});
console.log('errors:', errs.length ? errs : 'none');
await b.close();
