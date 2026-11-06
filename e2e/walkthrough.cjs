// End-to-end walkthrough of the built web app (real Postgres + RLS via local gateway).
const { chromium } = require('playwright');
const OUT = process.argv[2];
const BASE = process.env.AIEC_E2E_BASE_URL ?? 'http://127.0.0.1:3123';
// Interface language for this run: AIEC_E2E_LOCALE=mr (default, like the product) or en.
const LOCALE = process.env.AIEC_E2E_LOCALE === 'en' ? 'en' : 'mr';
const fs = require('fs');
const path = require('path');
/** Read a generated dictionary (packages/domain/src/messages/<locale>.ts: one `'key': 'value',` per line). */
function dictionary(locale) {
  const src = fs.readFileSync(path.join(__dirname, `../packages/domain/src/messages/${locale}.ts`), 'utf8');
  const out = {};
  for (const m of src.matchAll(/^  '((?:[^'\\]|\\.)*)': '((?:[^'\\]|\\.)*)',$/gm)) out[m[1].replace(/\\(.)/g, '$1')] = m[2].replace(/\\(.)/g, '$1');
  return out;
}
const DICT = dictionary(LOCALE);
/** Translated text for a key (with {params}), exactly as the app renders it. */
const T = (key, params = {}) => {
  const v = DICT[key];
  if (v === undefined) throw new Error(`no such key ${key}`);
  return v.replace(/\{(\w+)\}/g, (_, n) => String(params[n] ?? `{${n}}`));
};
// Words allowed to stay in Latin script on a Marathi page: brand / technical tokens and the
// data the people typed (names, projects, addresses) collected below.
const LATIN_OK = new Set(['AIEC', 'OS', 'GPS', 'IST', 'OTP', 'MRL', 'SMS', 'WhatsApp', 'PUN', 'PCMC', 'LD', 'SV', 'mm', 'cm', 'DEMO', 'Supabase', 'ID', 'demo', 'BOM',
  'English', // the language switch names each language in its own script
]);
const dataWords = new Set();
const addData = (...texts) => texts.forEach((x) => String(x ?? '').match(/[A-Za-z]+/g)?.forEach((w) => dataWords.add(w.toLowerCase())));
const PHONES = { owner: '9000000000', sales1: '9000000001', surveyor2: '9000000004', tech1: '9000000005', partnerA_admin: '9000000007', pending1: '9000000012' };
const results = [];
let shot = 0;

function istLocal(daysAhead, hour) {
  const d = new Date(Date.now() + 330 * 60000 + daysAhead * 864e5);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
}

async function login(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'aiec_locale', value: LOCALE, url: BASE }]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  CONSOLE-ERR', who, page.url().replace(BASE, ''), m.text().slice(0, 160)); });
  await page.goto(`${BASE}/`);
  await page.fill('input[autocomplete="tel"]', PHONES[who]);
  await page.click(`button:has-text("${T('login.send_code')}")`);
  await page.fill('input[autocomplete="one-time-code"]', '123456');
  await page.click(`button:has-text("${T('login.verify')}")`);
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await page.getByText(T('home.welcome')).first().waitFor({ timeout: 15000 });
  await page.waitForLoadState('networkidle');
  return page;
}

async function snap(page, name, check) {
  shot++;
  const file = `${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  let ok = true, note = '';
  try { if (check) note = (await check()) || ''; } catch (e) { ok = false; note = e.message; }
  if (LOCALE === 'mr') {
    // Every visible word must be Marathi, a known token, or data a person typed.
    const text = (await page.evaluate(() => document.body.innerText))
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ')
      .replace(/\b[0-9a-f]{8}\b/gi, ' ')
      .replace(/\S+@\S+/g, ' ');
    const english = [...new Set((text.match(/[A-Za-z]{2,}/g) ?? []).filter((w) => !LATIN_OK.has(w) && !LATIN_OK.has(w.toLowerCase()) && !dataWords.has(w.toLowerCase())))];
    if (english.length) { ok = false; note += ` English words on a Marathi page: ${english.join(', ')}`; }
  }
  if (page.errors?.length) { ok = false; note += ` JS errors: ${page.errors.join('; ')}`; page.errors = []; }
  results.push({ file, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file} ${note}`);
}
const expectText = (page, text) => async () => {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 });
  return `saw "${text}"`;
};

(async () => {
  // Text people typed (fixture + this scenario) may stay in Latin script on Marathi pages.
  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.AIEC_E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/aiec_test' });
  await db.connect();
  const { rows } = await db.query(`
    select string_agg(coalesce(x, ''), ' ') as t from (
      select full_name as x from user_profiles union all select email from user_profiles
      union all select name from organizations union all select legal_name from organizations union all select city from organizations
      union all select contact_name || ' ' || project_name || ' ' || coalesce(builder_name, '') || ' ' || lift_requirement || ' ' || coalesce(email, '') || ' ' || coalesce(closed_reason, '') || ' ' || coalesce(no_action_reason, '') || ' ' || coalesce(qualification::text, '') from leads
      union all select coalesce(name, '') || ' ' || coalesce(address_line, '') || ' ' || coalesce(locality, '') || ' ' || city || ' ' || coalesce(zone, '') from sites
      union all select scope || ' ' || coalesce(special_instructions, '') || ' ' || site_contact_name || ' ' || coalesce(status_reason, '') || ' ' || coalesce(gps_exception_reason, '') from surveys
      union all select summary || ' ' || coalesce(no_action_reason, '') from lead_activities
      union all select coalesce(revision_reason, '') || ' ' || data::text from survey_revisions
      union all select coalesce(level_label, '') from survey_measurements
      union all select coalesce(source_exception_reason, '') from evidence_files
      union all select coalesce(reason, '') from audit_logs
      union all select coalesce(reason, '') from lead_duplicate_decisions
    ) q`);
  addData(rows[0].t);
  await db.end();
  const browser = await chromium.launch();
  const phone = `97${String(Date.now()).slice(-8)}`;
  const project = `Shanti Kunj Residency ${String(Date.now()).slice(-4)}`;
  addData(project, 'Mrs. Kavita Deshpande (demo)', 'Kavita D.', 'Shanti Kunj Wing B', 'Kothrud', 'One 6-passenger MRL lift, G+4', 'Second lift',
    'Spoke to secretary; wants site survey this week', 'Passenger lift for 5-storey society', 'Book survey', 'Please re-measure overhead at top landing');

  // ---------- Sales ----------
  const s = await login(browser, 'sales1');
  await snap(s, 'sales-home', expectText(s, T('kpi.my_uncontacted.label')));
  await s.goto(`${BASE}/leads`);
  await snap(s, 'sales-lead-list', expectText(s, T('leads.subtitle_mine')));

  await s.goto(`${BASE}/leads/new`);
  await s.click(`button:has-text("${T('lead_form.create')}")`);
  await snap(s, 'new-lead-validation-errors', expectText(s, T('error.REQUIRED_FIELD_MISSING.title')));

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
  await s.click(`button:has-text("${T('lead_form.create')}")`);
  try { await s.waitForURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 15000, waitUntil: 'commit' }); } catch (e) {
    await s.screenshot({ path: OUT + '/ERROR-create.png', fullPage: true });
    console.log('ALERTS', await s.locator('[role=alert]').allTextContents(), await s.locator('li').allTextContents());
    throw e;
  }
  await s.waitForLoadState('networkidle');
  await snap(s, 'lead-created-detail', expectText(s, T('lead.created_banner')));
  const leadUrl = s.url().split('?')[0];

  // Duplicate attempt with same phone
  await s.goto(`${BASE}/leads/new`);
  await s.fill('#contact_name', 'Kavita D.');
  await s.fill('#phone', `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);
  await s.fill('#project_name', 'Shanti Kunj Wing B');
  await s.fill('#city', 'Pune');
  await s.fill('#lift_requirement', 'Second lift');
  await s.selectOption('#source', 'phone');
  await s.click(`button:has-text("${T('lead_form.create')}")`);
  await snap(s, 'duplicate-review-required', expectText(s, T('dup.title')));
  // values were preserved after the warning?
  const kept = await s.inputValue('#project_name');
  results.push({ file: '(form state)', ok: kept === 'Shanti Kunj Wing B', note: `form kept values after warning: "${kept}"` });

  // Activity -> contacted
  await s.goto(leadUrl);
  await s.selectOption('#outcome', 'survey_required');
  await s.fill('#summary', 'Spoke to secretary; wants site survey this week');
  await s.fill('#next_follow_up_at', istLocal(1, 11));
  await s.click(`button:has-text("${T('lead.record_activity')}")`);
  await snap(s, 'activity-recorded-contacted', async () => {
    await s.getByText(T('lead.activity_recorded')).waitFor({ timeout: 8000 });
    await s.reload();
    await s.getByText(T('lead.state.contacted'), { exact: true }).first().waitFor({ timeout: 8000 });
    return 'status moved to Contacted';
  });

  // Qualify
  await s.fill('#need', 'Passenger lift for 5-storey society');
  await s.selectOption('#decision_authority', 'confirmed');
  await s.selectOption('#budget_readiness', 'ready');
  await s.selectOption('#timeline', 'within_3_months');
  await s.fill('#next_action', 'Book survey');
  await s.click(`button:has-text("${T('lead_form.save_qualification')}")`);
  try { await s.getByText(T('lead.qualified_done')).waitFor({ timeout: 8000 }); } catch (e) {
    await s.screenshot({ path: OUT + '/ERROR-qualify.png', fullPage: true });
    console.log('ALERTS', await s.locator('[role=alert],[role=status]').allTextContents()); throw e; }
  await s.reload();
  await snap(s, 'lead-qualified-score', expectText(s, T('lead.score_explanation')));

  // Book survey
  await s.selectOption('#surveyor_id', { index: 1 });
  await s.fill('#scheduled_start', istLocal(6, 10));
  await s.click(`button:has-text("${T('lead_form.book_survey')}")`);
  await s.getByText(T('lead.survey_booked')).waitFor({ timeout: 8000 });
  await s.reload();
  await snap(s, 'survey-booked-on-lead', expectText(s, 'SV-PUN-'));

  // Double booking with the same surveyor & slot on another qualified lead is covered by DB tests; here check the survey page.
  await s.getByRole('link', { name: /SV-PUN-/ }).first().click();
  await s.waitForURL(/\/surveys\//, { waitUntil: 'commit' }); await s.waitForLoadState('networkidle');
  await snap(s, 'sales-survey-detail', expectText(s, T('survey.appointment')));

  // ---------- Owner ----------
  const o = await login(browser, 'owner');
  await snap(o, 'owner-home-kpis', expectText(o, T('kpi.basis_count')));
  await o.goto(`${BASE}/audit?entity=lead`);
  await snap(o, 'owner-audit-log', expectText(o, T('audit.action.lead.qualified')));
  await o.goto(`${BASE}/admin/users`);
  await snap(o, 'owner-users-roles', expectText(o, T('admin.title')));
  await o.goto(leadUrl);
  await snap(o, 'owner-sees-lead-read-only', async () => {
    await o.getByText(project).first().waitFor();
    const canRecord = await o.getByText(T('lead.record_activity')).count();
    if (canRecord) throw new Error('owner should not get activity form');
    return 'owner reads lead; no sales-only forms';
  });

  // ---------- Technical ----------
  const t = await login(browser, 'tech1');
  await snap(t, 'tech-home', expectText(t, T('kpi.surveys_awaiting_review.label')));
  await t.goto(`${BASE}/surveys?status=submitted`);
  await snap(t, 'tech-submitted-surveys', expectText(t, 'SV-PUN-'));
  const first = t.getByRole('link', { name: /SV-PUN-/ }).first();
  if (await first.count()) {
    await first.click();
    await t.waitForURL(/\/surveys\//, { waitUntil: 'commit' }); await t.waitForLoadState('networkidle');
    await snap(t, 'tech-survey-measurements-evidence', expectText(t, T('survey.measurements_heading')));
    await t.fill('#reason', 'Please re-measure overhead at top landing');
    await t.click(`button:has-text("${T('survey_form.return')}")`);
    await snap(t, 'tech-returned-for-revision', expectText(t, T('survey.state.revision_requested')));
  }
  await t.goto(leadUrl);
  await snap(t, 'tech-cannot-open-sales-lead', expectText(t, T('error.NOT_FOUND.title')));

  // ---------- Partner (tenant isolation) ----------
  const p = await login(browser, 'partnerA_admin');
  await snap(p, 'partner-home', expectText(p, T('home.welcome')));
  await p.goto(`${BASE}/leads`);
  await snap(p, 'partner-leads-denied', expectText(p, T('common.no_access', { what: T('leads.what') })));
  await p.goto(`${BASE}/admin/users`);
  await snap(p, 'partner-sees-only-own-team', async () => {
    const names = await p.locator('section p.font-semibold').allTextContents();
    if (names.some((n) => /sales|owner|partnerB/i.test(n))) throw new Error(`leak: ${names}`);
    return `visible people: ${names.join(', ')}`;
  });
  await p.goto(leadUrl);
  await snap(p, 'partner-cannot-open-lead', expectText(p, T('error.NOT_FOUND.title')));

  // ---------- Pending account ----------
  const u = await login(browser, 'pending1');
  await snap(u, 'pending-account', expectText(u, T('account.pending_title')));

  // ---------- Mobile viewport (sales) ----------
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await m.addCookies([{ name: 'aiec_locale', value: LOCALE, url: BASE }]);
  const mp = await m.newPage();
  await mp.goto(`${BASE}/`);
  await mp.fill('input[autocomplete="tel"]', PHONES.sales1);
  await mp.click(`button:has-text("${T('login.send_code')}")`);
  await mp.fill('input[autocomplete="one-time-code"]', '123456');
  await mp.click(`button:has-text("${T('login.verify')}")`);
  await mp.waitForURL(`${BASE}/`); await mp.getByText(T('home.welcome')).first().waitFor();
  await mp.goto(leadUrl);
  await snap(mp, 'mobile-width-lead-detail', async () => {
    const w = await mp.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) throw new Error(`horizontal overflow ${w}px`);
    return 'no horizontal overflow at 390px';
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[${LOCALE}] ${results.length - failed.length}/${results.length} checks passed`);
  require('fs').writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('WALKTHROUGH ERROR', e); process.exit(2); });
