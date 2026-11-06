// End-to-end walkthrough of the built web app (real Postgres + RLS via local gateway).
const { chromium } = require('playwright');
const OUT = process.argv[2];
const BASE = process.env.AIEC_E2E_BASE_URL ?? 'http://127.0.0.1:3123';
const PHONES = { owner: '9000000000', sales1: '9000000001', surveyor2: '9000000004', tech1: '9000000005', partnerA_admin: '9000000007', pending1: '9000000012' };
const results = [];
let shot = 0;

function istLocal(daysAhead, hour) {
  const d = new Date(Date.now() + 330 * 60000 + daysAhead * 864e5);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
}

async function login(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  CONSOLE-ERR', who, page.url().replace(BASE, ''), m.text().slice(0, 160)); });
  await page.goto(`${BASE}/`);
  await page.fill('input[autocomplete="tel"]', PHONES[who]);
  await page.click('button:has-text("Send code")');
  await page.fill('input[autocomplete="one-time-code"]', '123456');
  await page.click('button:has-text("Verify and sign in")');
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await page.getByText('Welcome').first().waitFor({ timeout: 15000 });
  await page.waitForLoadState('networkidle');
  return page;
}

async function snap(page, name, check) {
  shot++;
  const file = `${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  let ok = true, note = '';
  try { if (check) note = (await check()) || ''; } catch (e) { ok = false; note = e.message; }
  if (page.errors?.length) { ok = false; note += ` JS errors: ${page.errors.join('; ')}`; page.errors = []; }
  results.push({ file, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file} ${note}`);
}
const expectText = (page, text) => async () => {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 });
  return `saw "${text}"`;
};

(async () => {
  const browser = await chromium.launch();
  const phone = `97${String(Date.now()).slice(-8)}`;
  const project = `Shanti Kunj Residency ${String(Date.now()).slice(-4)}`;

  // ---------- Sales ----------
  const s = await login(browser, 'sales1');
  await snap(s, 'sales-home', expectText(s, 'My uncontacted leads'));
  await s.goto(`${BASE}/leads`);
  await snap(s, 'sales-lead-list', expectText(s, 'Leads assigned to you'));

  await s.goto(`${BASE}/leads/new`);
  await s.click('button:has-text("Create lead")');
  await snap(s, 'new-lead-validation-errors', expectText(s, 'Some required information is missing'));

  await s.goto(`${BASE}/leads/new`);
  await s.fill('#contact_name', 'Mrs. Kavita Deshpande (demo)');
  await s.fill('#phone', phone);
  await s.fill('#project_name', project);
  await s.fill('#city', 'Pune');
  await s.fill('#locality', 'Kothrud');
  await s.fill('#pincode', '411038');
  await s.fill('#lift_requirement', 'One 6-passenger MRL lift, G+4');
  await s.fill('#floors_count', '5');
  await s.fill('#stops_count', '5');
  await s.selectOption('#source', 'referral');
  await s.click('button:has-text("Create lead")');
  try { await s.waitForURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 15000, waitUntil: 'commit' }); } catch (e) {
    await s.screenshot({ path: OUT + '/ERROR-create.png', fullPage: true });
    console.log('ALERTS', await s.locator('[role=alert]').allTextContents(), await s.locator('li').allTextContents());
    throw e;
  }
  await s.waitForLoadState('networkidle');
  await snap(s, 'lead-created-detail', expectText(s, 'Lead created.'));
  const leadUrl = s.url().split('?')[0];

  // Duplicate attempt with same phone
  await s.goto(`${BASE}/leads/new`);
  await s.fill('#contact_name', 'Kavita D.');
  await s.fill('#phone', `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);
  await s.fill('#project_name', 'Shanti Kunj Wing B');
  await s.fill('#city', 'Pune');
  await s.fill('#lift_requirement', 'Second lift');
  await s.selectOption('#source', 'phone');
  await s.click('button:has-text("Create lead")');
  await snap(s, 'duplicate-review-required', expectText(s, 'Possible duplicates — review before saving'));
  // values were preserved after the warning?
  const kept = await s.inputValue('#project_name');
  results.push({ file: '(form state)', ok: kept === 'Shanti Kunj Wing B', note: `form kept values after warning: "${kept}"` });

  // Activity -> contacted
  await s.goto(leadUrl);
  await s.selectOption('#outcome', 'survey_required');
  await s.fill('#summary', 'Spoke to secretary; wants site survey this week');
  await s.fill('#next_follow_up_at', istLocal(1, 11));
  await s.click('button:has-text("Record activity")');
  await snap(s, 'activity-recorded-contacted', async () => {
    await s.getByText('Activity recorded.').waitFor({ timeout: 8000 });
    await s.reload();
    await s.getByText('Contacted', { exact: true }).first().waitFor({ timeout: 8000 });
    return 'status moved to Contacted';
  });

  // Qualify
  await s.fill('#need', 'Passenger lift for 5-storey society');
  await s.selectOption('#decision_authority', 'confirmed');
  await s.selectOption('#budget_readiness', 'ready');
  await s.selectOption('#timeline', 'within_3_months');
  await s.fill('#next_action', 'Book survey');
  await s.click('button:has-text("Save qualification")');
  try { await s.getByText('Lead qualified.').waitFor({ timeout: 8000 }); } catch (e) {
    await s.screenshot({ path: OUT + '/ERROR-qualify.png', fullPage: true });
    console.log('ALERTS', await s.locator('[role=alert],[role=status]').allTextContents()); throw e; }
  await s.reload();
  await snap(s, 'lead-qualified-score', expectText(s, 'Score explanation'));

  // Book survey
  await s.selectOption('#surveyor_id', { index: 1 });
  await s.fill('#scheduled_start', istLocal(6, 10));
  await s.click('button:has-text("Book survey")');
  await s.getByText('Survey booked').waitFor({ timeout: 8000 });
  await s.reload();
  await snap(s, 'survey-booked-on-lead', expectText(s, 'SV-PUN-'));

  // Double booking with the same surveyor & slot on another qualified lead is covered by DB tests; here check the survey page.
  await s.getByRole('link', { name: /SV-PUN-/ }).first().click();
  await s.waitForURL(/\/surveys\//, { waitUntil: 'commit' }); await s.waitForLoadState('networkidle');
  await snap(s, 'sales-survey-detail', expectText(s, 'Appointment'));

  // ---------- Owner ----------
  const o = await login(browser, 'owner');
  await snap(o, 'owner-home-kpis', expectText(o, 'Basis: count.'));
  await o.goto(`${BASE}/audit?entity=lead`);
  await snap(o, 'owner-audit-log', expectText(o, 'lead.qualified'));
  await o.goto(`${BASE}/admin/users`);
  await snap(o, 'owner-users-roles', expectText(o, 'Users & roles'));
  await o.goto(leadUrl);
  await snap(o, 'owner-sees-lead-read-only', async () => {
    await o.getByText(project).first().waitFor();
    const canRecord = await o.getByText('Record activity').count();
    if (canRecord) throw new Error('owner should not get activity form');
    return 'owner reads lead; no sales-only forms';
  });

  // ---------- Technical ----------
  const t = await login(browser, 'tech1');
  await snap(t, 'tech-home', expectText(t, 'Surveys awaiting technical review'));
  await t.goto(`${BASE}/surveys?status=submitted`);
  await snap(t, 'tech-submitted-surveys', expectText(t, 'SV-PUN-'));
  const first = t.getByRole('link', { name: /SV-PUN-/ }).first();
  if (await first.count()) {
    await first.click();
    await t.waitForURL(/\/surveys\//, { waitUntil: 'commit' }); await t.waitForLoadState('networkidle');
    await snap(t, 'tech-survey-measurements-evidence', expectText(t, 'Measurements (normalized to mm'));
    await t.fill('#reason', 'Please re-measure overhead at top landing');
    await t.click('button:has-text("Return for revision")');
    await snap(t, 'tech-returned-for-revision', expectText(t, 'Revision requested'));
  }
  await t.goto(leadUrl);
  await snap(t, 'tech-cannot-open-sales-lead', expectText(t, 'Record not found'));

  // ---------- Partner (tenant isolation) ----------
  const p = await login(browser, 'partnerA_admin');
  await snap(p, 'partner-home', expectText(p, 'Welcome'));
  await p.goto(`${BASE}/leads`);
  await snap(p, 'partner-leads-denied', expectText(p, 'You do not have access to leads'));
  await p.goto(`${BASE}/admin/users`);
  await snap(p, 'partner-sees-only-own-team', async () => {
    const names = await p.locator('section p.font-semibold').allTextContents();
    if (names.some((n) => /sales|owner|partnerB/i.test(n))) throw new Error(`leak: ${names}`);
    return `visible people: ${names.join(', ')}`;
  });
  await p.goto(leadUrl);
  await snap(p, 'partner-cannot-open-lead', expectText(p, 'Record not found'));

  // ---------- Pending account ----------
  const u = await login(browser, 'pending1');
  await snap(u, 'pending-account', expectText(u, 'pending verification'));

  // ---------- Mobile viewport (sales) ----------
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/`);
  await mp.fill('input[autocomplete="tel"]', PHONES.sales1);
  await mp.click('button:has-text("Send code")');
  await mp.fill('input[autocomplete="one-time-code"]', '123456');
  await mp.click('button:has-text("Verify and sign in")');
  await mp.waitForURL(`${BASE}/`); await mp.getByText('Welcome').first().waitFor();
  await mp.goto(leadUrl);
  await snap(mp, 'mobile-width-lead-detail', async () => {
    const w = await mp.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) throw new Error(`horizontal overflow ${w}px`);
    return 'no horizontal overflow at 390px';
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  require('fs').writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('WALKTHROUGH ERROR', e); process.exit(2); });
