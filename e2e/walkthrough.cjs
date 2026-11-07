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
const LATIN_OK = new Set(['AIEC', 'OS', 'GPS', 'IST', 'OTP', 'MRL', 'SMS', 'WhatsApp', 'PUN', 'PCMC', 'LD', 'SV', 'mm', 'cm', 'DEMO', 'Supabase', 'ID', 'demo', 'BOM', 'TR', 'QT', 'TD', 'kg', 'PDF', 'CSV', 'Excel', 'MB', 'SHA', 'GST',
  'PR', 'PO', 'GRN', 'OR', 'PM', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'UTR', // business-number prefixes and payment rails
  'English', // the language switch names each language in its own script
]);
const dataWords = new Set();
const addData = (...texts) => texts.forEach((x) => String(x ?? '').match(/[A-Za-z]+/g)?.forEach((w) => dataWords.add(w.toLowerCase())));

// ---------- Test-only seeding through the real RPCs (as the fixture users, RLS applies) ----------
const crypto = require('crypto');
async function seedSubmittedSurvey(db) {
  const ids = Object.fromEntries((await db.query(`select full_name, id from public.user_profiles where full_name like 'Test %'`)).rows.map((r) => [r.full_name.slice(5), r.id]));
  const [{ id: aiec }] = (await db.query(`select id from public.organizations where kind = 'aiec'`)).rows;
  const as = async (user, sql, params) => {
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ids[user], role: 'authenticated' })]);
      const r = await db.query(sql, params);
      await db.query('commit');
      return r.rows[0]?.r;
    } catch (e) { await db.query('rollback'); throw e; }
  };
  const rpc = (user, fn, args) => {
    const keys = Object.keys(args);
    return as(user, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])));
  };
  const uid = () => crypto.randomUUID();
  const word = () => Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz'[crypto.randomInt(26)]).join('');
  const project = `Aditya Heights ${word()}`;
  const lead = await rpc('sales1', 'create_lead', { p_operation_id: uid(), p_payload: { contact_name: 'Mr. Sunil Kale', phone: `98${crypto.randomInt(1e8).toString().padStart(8, '0')}`, customer_type: 'housing_society', project_name: project, lift_requirement: 'One 8-passenger MRL lift, G+4', source: 'referral', site: { city: 'Pune', locality: 'Aundh', pincode: '411007' } } });
  const act = await rpc('sales1', 'record_lead_activity', { p_operation_id: uid(), p_lead_id: lead.lead_id, p_activity_type: 'call', p_outcome: 'survey_required', p_summary: 'Wants survey', p_occurred_at: new Date().toISOString(), p_next_follow_up_at: new Date(Date.now() + 864e5).toISOString() });
  await rpc('sales1', 'qualify_lead', { p_lead_id: lead.lead_id, p_expected_version: act.version, p_qualification: { need: 'Passenger lift', decision_authority: 'confirmed', timeline: 'within_3_months', next_action: 'Survey' } });
  const start = new Date(Date.now() + (300 + crypto.randomInt(300)) * 864e5);
  const sv = await rpc('sales1', 'schedule_survey', { p_operation_id: uid(), p_lead_id: lead.lead_id, p_surveyor_id: ids.surveyor1, p_scheduled_start: start.toISOString(), p_scheduled_end: new Date(start.getTime() + 2 * 3600e3).toISOString(), p_scope: 'New lift site survey', p_site_contact_name: 'Society Secretary', p_site_contact_phone: '9811111111' });
  await rpc('surveyor1', 'survey_field_action', { p_survey_id: sv.survey_id, p_expected_version: sv.version, p_action: 'accept' });
  const c = await rpc('surveyor1', 'check_in_survey', { p_operation_id: uid(), p_survey_id: sv.survey_id, p_location_permission: 'granted', p_latitude: 18.5591, p_longitude: 73.8075, p_accuracy_m: 8, p_client_time: new Date().toISOString() });
  const revVersion = async () => (await db.query('select version from public.survey_revisions where id = $1', [c.current_revision_id])).rows[0].version;
  const docs = ['doc_architectural_drawing', 'doc_structural_drawing', 'doc_shaft_layout', 'doc_electrical_drawing'];
  await rpc('surveyor1', 'save_survey_draft', { p_operation_id: uid(), p_survey_id: sv.survey_id, p_revision_id: c.current_revision_id, p_expected_revision_version: await revVersion(),
    p_data: { building: { usage: 'residential', floors: 5, stops: 5, construction_stage: 'structure_complete' }, shaft: { access_conditions: 'clear' }, machine_room: { availability: 'mrl' },
      electrical: { supply_type: 'temporary', phase: 'three' }, logistics: { material_access_route: 'main gate', safety_hazards: 'open shaft edges' },
      documents_unavailable: Object.fromEntries(docs.map((d) => [d, 'Builder to share later'])) },
    p_measurements: [['shaft_width', 1800], ['shaft_depth', 1900], ['pit_depth', 1500], ['overhead', 3600], ['entrance_width', 900], ['entrance_height', 2100]].map(([key, v]) => ({ key, entered_value: v, entered_unit: 'mm' })) });
  for (const category of ['site_exterior', 'shaft_full_view', 'pit', 'overhead', 'landing_entrance', 'electrical_supply_area', 'access_route']) {
    const op = uid();
    const path = `${aiec}/surveys/${sv.survey_id}/${op}.jpg`;
    await as('surveyor1', `insert into storage.objects (bucket_id, name, owner, metadata) values ('evidence', $1, $2, $3) returning null as r`, [path, ids.surveyor1, { size: 2048, mimetype: 'image/jpeg' }]);
    await rpc('surveyor1', 'register_evidence', { p_operation_id: op, p_survey_id: sv.survey_id, p_payload: { category, storage_path: path, sha256: crypto.createHash('sha256').update(op).digest('hex'), mime_type: 'image/jpeg', size_bytes: 2048, captured_at: new Date().toISOString(), source: 'in_app_camera' } });
  }
  await rpc('surveyor1', 'submit_survey', { p_operation_id: uid(), p_survey_id: sv.survey_id, p_expected_revision_version: await revVersion() });
  return { leadId: lead.lead_id, surveyNumber: sv.survey_number, project };
}

const PHONES = { owner: '9000000000', sales1: '9000000001', surveyor2: '9000000004', tech1: '9000000005', ops1: '9000000006', partnerA_admin: '9000000007', pending1: '9000000012', finance1: '9000000013', procure1: '9000000014' };
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
      .replace(/\b[0-9a-f]{12,64}\b/gi, ' ') // checksums
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
      union all select contract_reference || ' ' || coalesce(notes, '') from orders
      union all select title || ' ' || site_label || ' ' || coalesce(handover_notes, '') from projects
      union all select payer_name || ' ' || payment_reference || ' ' || coalesce(evidence_note, '') || ' ' || coalesce(matched_statement_reference, '') || ' ' || coalesce(decision_reason, '') from payment_claims
      union all select coalesce(change_summary, '') from bom_revisions
      union all select item_code || ' ' || description || ' ' || unit || ' ' || coalesce(make_model, '') || ' ' || coalesce(specification, '') || ' ' || coalesce(source, '') from bom_lines
      union all select coalesce(notes, '') || ' ' || coalesce(selection_rationale, '') || ' ' || coalesce(status_reason, '') from purchase_requests
      union all select coalesce(payment_terms, '') || ' ' || coalesce(notes, '') from supplier_quotes
      union all select delivery_location || ' ' || payment_terms || ' ' || coalesce(terms, '') || ' ' || coalesce(status_reason, '') from purchase_orders
      union all select coalesce(serial_batch, '') || ' ' || coalesce(remarks, '') from goods_receipt_lines
      union all select coalesce(decision_reason, '') || ' ' || coalesce(impact ->> 'justification', '') from approval_requests
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


  // ---------- Slice 3: technical review → configuration → document → quotation → approval → acceptance ----------
  const seedDb = new Client({ connectionString: process.env.AIEC_E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/aiec_test' });
  await seedDb.connect();
  const seeded = await seedSubmittedSurvey(seedDb);
  await seedDb.end();
  addData('Shaft 1800 x 1900 mm, pit 1500 mm and overhead 3600 mm suit an 8-person MRL lift', 'Passenger MRL lift, 8 persons');
  addData('Builder to share later', 'residential structure_complete clear mrl temporary three main gate open shaft edges', 'New lift site survey');
  addData(seeded.project, 'Mr. Sunil Kale', 'Aundh', 'Society Secretary', 'Example Lifts', 'MRL-8', 'Shaft layout', 'First issue',
    'Passenger MRL lift', 'Installation and commissioning', 'Mrs. Kale', 'Signed copy received', 'Supplier quote', 'nos');

  const tq = await login(browser, 'tech1');
  await tq.goto(`${BASE}/technical`);
  await snap(tq, 's3-tech-review-queue', expectText(tq, seeded.surveyNumber));
  await tq.locator('li', { hasText: seeded.surveyNumber }).getByRole('button', { name: T('technical.start_review') }).click();
  await tq.waitForURL(/\/technical\/reviews\//, { waitUntil: 'commit' }); await tq.waitForLoadState('networkidle');
  await snap(tq, 's3-tech-workspace', expectText(tq, T('technical.decision')));
  await tq.selectOption('#decision', 'feasible');
  await tq.fill('#technical_basis', 'Shaft 1800 x 1900 mm, pit 1500 mm and overhead 3600 mm suit an 8-person MRL lift');
  await tq.click(`button:has-text("${T('technical.record_decision')}")`);
  // Wait for the lasting result, not the transient success message (the form unmounts on refresh).
  await tq.getByText(T('technical.decision_locked')).waitFor({ timeout: 15000 });
  await tq.reload();
  await snap(tq, 's3-tech-decision-recorded', expectText(tq, T('technical.decision_locked')));
  const cfg = { rated_load_kg: '544', persons: '8', rated_speed_mps: '1', floors: '5', stops: '5', travel_mm: '12000', car_width_mm: '1100', car_depth_mm: '1400', car_height_mm: '2200',
    shaft_width_mm: '1700', shaft_depth_mm: '1800', pit_depth_mm: '1400', overhead_mm: '3600', door_width_mm: '800', door_height_mm: '2000', manufacturer: 'Example Lifts', model: 'MRL-8' };
  await tq.selectOption('#lift_category', 'passenger');
  for (const [k, v] of Object.entries(cfg)) await tq.fill(`#value_${k}`, v);
  for (const [k, v] of Object.entries({ drive_type: 'traction_mrl', machine_room: 'mrl', door_type: 'centre_opening', power_supply: 'three_phase_415v' })) await tq.selectOption(`#value_${k}`, v);
  await tq.click(`button:has-text("${T('technical.save_configuration')}")`);
  await tq.getByText(T('technical.configuration_saved')).waitFor({ timeout: 10000 });
  await tq.reload();
  await snap(tq, 's3-tech-configuration-draft', expectText(tq, T('technical.configuration_complete')));
  await tq.click(`button:has-text("${T('technical.approve_configuration')}")`);
  await tq.getByRole('button', { name: T('technical.approve_configuration') }).waitFor({ state: 'detached', timeout: 15000 });
  await tq.reload();
  await tq.selectOption('#doc_kind', 'shaft_layout');
  await tq.fill('#doc_title', 'Shaft layout');
  await tq.fill('#doc_change', 'First issue');
  await tq.setInputFiles('#doc_file', { name: 'shaft-layout.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% AIEC E2E ${Date.now()}\n%%EOF\n`) });
  await tq.click(`button:has-text("${T('technical.upload_document')}")`);
  await tq.getByRole('button', { name: T('technical.submit_document') }).waitFor({ timeout: 15000 });
  await tq.click(`button:has-text("${T('technical.submit_document')}")`);
  await tq.getByRole('button', { name: T('technical.approve_document') }).waitFor({ timeout: 15000 });
  await tq.click(`button:has-text("${T('technical.approve_document')}")`);
  await tq.getByRole('button', { name: T('technical.approve_document') }).waitFor({ state: 'detached', timeout: 15000 });
  await tq.reload();
  await snap(tq, 's3-tech-configuration-and-document-approved', expectText(tq, T('technical.document_state.approved')));

  const sq = await login(browser, 'sales1');
  await sq.goto(`${BASE}/leads/${seeded.leadId}`);
  await snap(sq, 's3-sales-lead-technical', expectText(sq, T('lead.configuration')));
  await sq.click(`button:has-text("${T('quotation.create')}")`);
  await sq.waitForURL(/\/quotations\//, { waitUntil: 'commit' }); await sq.waitForLoadState('networkidle');
  const quoteUrl = sq.url().split('?')[0];
  await sq.fill('#desc_0', 'Passenger MRL lift, 8 persons');
  await sq.fill('#rate_0', '1250000');
  await sq.fill('#disc_0', '12');
  await sq.fill('#cost_0', '900000');
  await sq.fill('#src_0', 'Supplier quote');
  for (const k of ['scope_of_supply', 'scope_of_installation', 'customer_responsibilities', 'exclusions', 'tax_treatment', 'payment_terms', 'warranty_terms', 'delivery_assumptions']) {
    await sq.fill(`#terms_${k}`, `As agreed for ${k.replace(/_/g, ' ')}`);
    addData(`As agreed for ${k.replace(/_/g, ' ')}`);
  }
  await sq.click(`button:has-text("${T('quotation.save_draft')}")`);
  await sq.getByText(T('quotation.saved')).waitFor({ timeout: 10000 });
  await sq.reload();
  await snap(sq, 's3-sales-quotation-draft', expectText(sq, T('quotation.submit_needs_approval')));
  await sq.click(`button:has-text("${T('quotation.submit')}")`);
  await sq.getByText(T('quotation.waiting_approval')).waitFor({ timeout: 15000 });
  await sq.reload();
  await snap(sq, 's3-sales-quotation-waiting-approval', expectText(sq, T('quotation.waiting_approval')));

  const oq = await login(browser, 'owner');
  await oq.goto(`${BASE}/approvals`);
  await snap(oq, 's3-owner-approval-center', expectText(oq, T('enum.approval_reason.discount_above_authority')));
  const card = oq.locator('section', { hasText: T('approvals.open_quotation') }).filter({ has: oq.locator(`a[href="${quoteUrl.replace(BASE, '')}"]`) });
  await card.getByRole('button', { name: T('approvals.approve') }).click();
  await card.waitFor({ state: 'detached', timeout: 15000 });

  await sq.goto(quoteUrl);
  await sq.click(`button:has-text("${T('quotation.issue')}")`);
  await sq.getByRole('button', { name: T('quotation.record_response') }).waitFor({ timeout: 15000 });
  await sq.fill('#accepted_by_name', 'Mrs. Kale');
  await sq.fill('#acceptor_authority', 'Society secretary');
  await sq.fill('#evidence', 'Signed copy received');
  addData('Society secretary');
  await sq.click(`button:has-text("${T('quotation.record_response')}")`);
  await sq.getByText(T('quotation.acceptance'), { exact: true }).waitFor({ timeout: 15000 });
  await sq.reload();
  await snap(sq, 's3-sales-quotation-accepted', expectText(sq, T('quotation.acceptance')));
  await snap(tq, 's3-tech-cannot-see-quotation', async () => {
    await tq.goto(quoteUrl);
    await tq.getByText(T('error.NOT_FOUND.title')).first().waitFor({ timeout: 8000 });
    return 'technical reviewer cannot open prices';
  });

  // ---------- Slice 4: order → project → Gate 5 payment → BOM → purchase request → PO → goods receipt ----------
  const stamp = String(Date.now()).slice(-6);
  const contractRef = `WO-${stamp}`;
  const utr = `UTR${stamp}0099`;
  addData(contractRef, utr, 'Aditya Heights Society', 'Advance by NEFT', 'Accepted; plan the site visit', 'Lift machine and controller', 'Guide rails',
    'MC', 'GR', 'set', 'pcs', 'Lowest matching price', '30 percent advance, balance on delivery', 'Received in good condition', 'Pune', 'Aundh', 'Demo Supplier Lift Components');
  const q4 = new Client({ connectionString: process.env.AIEC_E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/aiec_test' });
  await q4.connect();
  const isoDay = (n) => new Date(Date.now() + 330 * 60000 + n * 864e5).toISOString().slice(0, 10);

  await sq.goto(quoteUrl);
  await snap(sq, 's4-sales-convert-to-order', expectText(sq, T('order.checklist_title')));
  await sq.fill('#contract_reference', contractRef);
  for (const box of await sq.locator('input[type="checkbox"][name^="check_"]').all()) await box.check();
  await sq.click(`button:has-text("${T('order.convert')}")`);
  await sq.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { waitUntil: 'commit', timeout: 20000 }); await sq.waitForLoadState('networkidle');
  const projectUrl = sq.url();
  const projectId = projectUrl.split('/').pop();
  await snap(sq, 's4-sales-project-created', expectText(sq, T('project.handover_waiting')));
  const advance = (await q4.query(`select amount_paise::text as a from payment_milestones where project_id = $1 and code = 'advance'`, [projectId])).rows[0].a;
  const advanceRupees = `${advance.slice(0, -2)}.${advance.slice(-2)}`;

  const op = await login(browser, 'ops1');
  await snap(op, 's4-ops-home-kpi', expectText(op, T('kpi.projects_awaiting_planning.label')));
  await op.goto(projectUrl);
  await op.fill('#handover_notes', 'Accepted; plan the site visit');
  await op.click(`button:has-text("${T('project.acknowledge')}")`);
  await op.getByRole('button', { name: T('project.acknowledge') }).waitFor({ state: 'detached', timeout: 15000 });
  await op.reload(); await op.waitForLoadState('networkidle');
  await snap(op, 's4-ops-handover-accepted-gate-blocked', async () => {
    await op.getByText(T('project.state.planning')).first().waitFor({ timeout: 8000 });
    await op.getByText(T('gate5.blocked')).first().waitFor({ timeout: 8000 });
    return 'planning; procurement blocked until the advance is verified';
  });

  await sq.goto(projectUrl);
  await sq.selectOption('#milestone_code', 'advance');
  await sq.fill('#payer_name', 'Aditya Heights Society');
  await sq.fill('#claim_amount', advanceRupees);
  await sq.fill('#payment_reference', utr);
  await sq.fill('#evidence_note', 'Advance by NEFT');
  await sq.click(`button:has-text("${T('payment.record_claim')}")`);
  await sq.getByText(T('payment.state.claimed')).first().waitFor({ timeout: 15000 });
  await sq.reload(); await sq.waitForLoadState('networkidle');
  await snap(sq, 's4-sales-advance-claim-recorded', expectText(sq, T('payment.state.claimed')));

  const fp = await login(browser, 'finance1');
  await fp.goto(`${BASE}/finance`);
  await snap(fp, 's4-finance-claims-to-verify', expectText(fp, utr));
  const claimCard = fp.locator('section', { hasText: utr });
  await claimCard.locator('input[name="matched_statement_reference"]').fill(`HDFC statement line ${utr}`);
  addData(`HDFC statement line ${utr}`);
  await claimCard.getByRole('button', { name: T('payment.record_decision') }).click();
  await claimCard.waitFor({ state: 'detached', timeout: 15000 });
  await fp.reload(); await fp.waitForLoadState('networkidle');
  await snap(fp, 's4-finance-advance-verified', expectText(fp, T('payment.state.verified')));

  await tq.goto(projectUrl);
  await tq.fill('#bi_0', 'MC-01'); await tq.fill('#bd_0', 'Lift machine and controller'); await tq.fill('#bq_0', '1'); await tq.fill('#bu_0', 'set');
  await tq.click(`button:has-text("${T('quotation.add_line')}")`);
  await tq.fill('#bi_1', 'GR-02'); await tq.fill('#bd_1', 'Guide rails'); await tq.fill('#bq_1', '2'); await tq.fill('#bu_1', 'pcs');
  await tq.click(`button:has-text("${T('bom.save')}")`);
  await tq.getByRole('button', { name: T('bom.approve') }).waitFor({ timeout: 15000 });
  await tq.click(`button:has-text("${T('bom.approve')}")`);
  await tq.getByRole('button', { name: T('bom.approve') }).waitFor({ state: 'detached', timeout: 15000 });
  await tq.reload(); await tq.waitForLoadState('networkidle');
  await snap(tq, 's4-tech-bom-approved', expectText(tq, T('bom.state.approved')));

  const pp = await login(browser, 'procure1');
  await pp.goto(projectUrl);
  await snap(pp, 's4-procurement-project-gate-open', async () => {
    await pp.getByRole('button', { name: T('procurement.create_request') }).waitFor({ timeout: 8000 });
    if (await pp.getByText(T('order.contract_value')).count()) throw new Error('procurement must not see customer money');
    return 'gate open; customer contract value hidden from procurement';
  });
  for (const input of await pp.locator('input[name^="qty_"]').all()) await input.fill(await input.getAttribute('placeholder'));
  await pp.fill('#required_by', isoDay(20));
  await pp.click(`button:has-text("${T('procurement.create_request')}")`);
  await pp.waitForURL(/\/procurement\/requests\//, { waitUntil: 'commit', timeout: 20000 }); await pp.waitForLoadState('networkidle');
  await pp.fill('#q_net', '400000'); await pp.fill('#q_tax', '72000'); await pp.fill('#q_freight', '5000');
  await pp.fill('#q_lead', '30'); await pp.fill('#q_warranty', '12'); await pp.fill('#q_terms', '30 percent advance, balance on delivery');
  await pp.click(`button:has-text("${T('procurement.add_quote')}")`);
  await pp.getByRole('button', { name: T('procurement.select_supplier') }).waitFor({ timeout: 15000 });
  await pp.fill('#rationale', 'Lowest matching price');
  await pp.click(`button:has-text("${T('procurement.select_supplier')}")`);
  await pp.getByRole('button', { name: T('procurement.create_po') }).waitFor({ timeout: 15000 });
  await pp.reload(); await pp.waitForLoadState('networkidle');
  await snap(pp, 's4-procurement-quotes-compared-supplier-selected', expectText(pp, T('procurement.selected')));
  const rates = ['450000', '20000'];
  let ri = 0;
  for (const input of await pp.locator('input[name^="rate_"]').all()) await input.fill(rates[ri++] ?? '1000');
  await pp.fill('#delivery_from', isoDay(25)); await pp.fill('#delivery_to', isoDay(35));
  await pp.fill('#po_payment_terms', '30 percent advance, balance on delivery');
  await pp.click(`button:has-text("${T('procurement.create_po')}")`);
  await pp.waitForURL(/\/procurement\/orders\//, { waitUntil: 'commit', timeout: 20000 }); await pp.waitForLoadState('networkidle');
  const poUrl = pp.url();
  await snap(pp, 's4-procurement-po-draft-above-limit', expectText(pp, T('procurement.submit_needs_approval')));
  await pp.click(`button:has-text("${T('procurement.submit_po')}")`);
  await pp.getByText(T('procurement.waiting_approval')).waitFor({ timeout: 15000 });

  await op.goto(`${BASE}/approvals`);
  await snap(op, 's4-ops-po-approval-card', expectText(op, T('enum.approval_reason.po_above_limit')));
  const poCard = op.locator('section', { hasText: T('approvals.open_po') }).filter({ has: op.locator(`a[href="${poUrl.replace(BASE, '')}"]`) });
  await poCard.getByRole('button', { name: T('approvals.approve') }).click();
  await poCard.waitFor({ state: 'detached', timeout: 15000 });

  await pp.goto(poUrl);
  await pp.click(`button:has-text("${T('procurement.issue_po')}")`);
  await pp.getByRole('button', { name: T('procurement.issue_po') }).waitFor({ state: 'detached', timeout: 15000 });
  await pp.reload(); await pp.waitForLoadState('networkidle');
  await pp.getByRole('button', { name: T('action.material.confirm'), exact: true }).first().waitFor({ timeout: 15000 });
  // Advance every line to delivered, one click per refresh (each click re-renders the row).
  const materialLabels = ['confirm', 'mark_ready', 'dispatch', 'mark_delivered'].map((a) => T(`action.material.${a}`));
  for (let guard = 0; guard < 12; guard++) {
    await pp.reload(); await pp.waitForLoadState('networkidle');
    const next = pp.locator('button').filter({ hasText: new RegExp(`^(${materialLabels.join('|')})$`) });
    if ((await next.count()) === 0) break;
    // The server action's POST returns after the database update; the row may unmount right after.
    const posted = pp.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/procurement/orders/'), { timeout: 15000 });
    await next.first().click();
    await posted;
  }
  await pp.reload(); await pp.waitForLoadState('networkidle');
  await snap(pp, 's4-procurement-lines-delivered', expectText(pp, T('procurement.grn_title')));
  // First receipt: line 1 in full, line 2 only one of two (a partial receipt never completes a line).
  for (const input of await pp.locator('input[name^="received_"]').all()) await input.fill('1');
  await pp.click(`button:has-text("${T('procurement.record_grn')}")`);
  await pp.getByText(T('material.state.received')).first().waitFor({ timeout: 15000 });
  await pp.reload(); await pp.waitForLoadState('networkidle');
  await snap(pp, 's4-procurement-partial-receipt', async () => {
    await pp.getByText(T('material.state.received')).first().waitFor({ timeout: 8000 });
    await pp.getByText(T('procurement.po_state.issued')).first().waitFor({ timeout: 8000 });
    return 'line 2 partly received; PO stays issued';
  });
  for (const input of await pp.locator('input[name^="received_"]').all()) await input.fill('1');
  for (const input of await pp.locator('input[name^="remarks_"]').all()) await input.fill('Received in good condition');
  await pp.click(`button:has-text("${T('procurement.record_grn')}")`);
  await pp.getByText(T('procurement.po_state_note.closed')).waitFor({ timeout: 15000 });
  await pp.reload(); await pp.waitForLoadState('networkidle');
  await snap(pp, 's4-procurement-po-closed', expectText(pp, T('procurement.po_state.closed')));
  await snap(sq, 's4-sales-cannot-see-purchasing', async () => {
    await sq.goto(poUrl);
    await sq.getByText(T('error.NOT_FOUND.title')).first().waitFor({ timeout: 8000 });
    return 'sales cannot open supplier prices';
  });
  await q4.end();

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
