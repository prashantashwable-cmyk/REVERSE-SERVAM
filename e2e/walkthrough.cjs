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
  'PR', 'PO', 'GRN', 'OR', 'PM', 'DF', 'LA', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'UTR', // business-number prefixes and payment rails
  'LLP',
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

/** Test-only: drive the remaining installation tasks through submission and a passing QA inspection (real RPCs, as the people). */
async function seedRemainingTasks(db, projectId) {
  const ids = Object.fromEntries((await db.query(`select full_name, id from public.user_profiles where full_name like 'Test %'`)).rows.map((r) => [r.full_name.slice(5), r.id]));
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
  const safe = { ppe: 1, work_at_height: 1, electrical_isolation: 1, shaft_access_control: 1, barricading: 1, emergency_access: 1, tool_inspection: 1, supervisor_briefing: 1 };
  const answersSafe = Object.fromEntries(Object.keys(safe).map((k) => [k, { applicable: true, confirmed: true }]));
  const qa = (await db.query(`select value from public.business_rules where rule_key = 'qa.checklists' order by version desc limit 1`)).rows[0].value.checklists;
  const tasks = (await db.query(`select t.id, t.code, t.version, t.status, t.checklist, t.evidence_required, a.partner_org_id from public.project_tasks t
    join public.project_partner_assignments a on a.id = t.assignment_id where t.project_id = $1 order by t.sequence`, [projectId])).rows;
  for (const t of tasks) {
    if (t.status !== 'draft') continue;
    const asg = await rpc('partnerA_admin', 'assign_task', { p_task_id: t.id, p_expected_version: t.version, p_assignee_id: ids.partnerA_tech, p_due_date: null });
    const acc = await rpc('partnerA_tech', 'accept_task', { p_task_id: t.id, p_expected_version: asg.version });
    await rpc('partnerA_tech', 'record_safety_check', { p_operation_id: uid(), p_task_id: t.id, p_answers: answersSafe });
    const st = await rpc('partnerA_tech', 'start_task', { p_task_id: t.id, p_expected_version: acc.version });
    const sp = await rpc('partnerA_tech', 'save_task_progress', { p_task_id: t.id, p_expected_version: st.version, p_answers: Object.fromEntries(t.checklist.map((k) => [k, { done: true }])), p_notes: null });
    for (const c of t.evidence_required) {
      const op = uid();
      const path = `${t.partner_org_id}/tasks/${t.id}/${op}.jpg`;
      await as('partnerA_tech', `insert into storage.objects (bucket_id, name, owner, metadata) values ('execution-evidence', $1, $2, $3) returning null as r`, [path, ids.partnerA_tech, { size: 2048, mimetype: 'image/jpeg' }]);
      await rpc('partnerA_tech', 'register_task_evidence', { p_operation_id: op, p_task_id: t.id, p_payload: { category: c, storage_path: path, sha256: crypto.createHash('sha256').update(op).digest('hex'), mime_type: 'image/jpeg', size_bytes: 2048, captured_at: new Date().toISOString(), source: 'in_app_camera' } });
    }
    await rpc('partnerA_tech', 'submit_task', { p_task_id: t.id, p_expected_version: sp.version });
    await rpc('qa1', 'record_inspection', { p_operation_id: uid(), p_payload: { task_id: t.id, answers: Object.fromEntries(qa[t.code].map((c) => [c.key, { result: 'pass' }])) } });
  }
}

const PHONES = { owner: '9000000000', sales1: '9000000001', surveyor2: '9000000004', tech1: '9000000005', ops1: '9000000006', partnerA_admin: '9000000007', partnerA_tech: '9000000008', partnerB_admin: '9000000009', pending1: '9000000012', finance1: '9000000013', procure1: '9000000014', customer1: '9000000011', qa1: '9000000015' };
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
/** Click a server-action submit button and wait for the action's response (sent after the database update). */
async function submitAction(page, label) {
  const done = page.waitForResponse((r) => r.request().method() === 'POST' && !!r.request().headers()['next-action'], { timeout: 15000 });
  await page.click(`button:has-text("${label}")`);
  await done;
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
      union all select coalesce(legal_name, '') || ' ' || coalesce(registered_address, '') || ' ' || coalesce(authorized_representative, '') || ' ' || array_to_string(service_areas, ' ') || ' ' || coalesce(status_reason, '') from partner_profiles
      union all select doc_number || ' ' || issuer || ' ' || coalesce(rejection_reason, '') from partner_documents
      union all select scope_summary || ' ' || payment_terms || ' ' || material_responsibility || ' ' || safety_requirements || ' ' || coalesce(exclusions, '') || ' ' || coalesce(response_reason, '') from project_partner_assignments
      union all select coalesce(notes, '') || ' ' || coalesce(block_reason, '') from project_tasks
      union all select description || ' ' || coalesce(resolution, '') from execution_incidents
      union all select work_completed || ' ' || next_day_plan || ' ' || coalesce(safety_observations, '') || ' ' || coalesce(blockers, '') from daily_reports
      union all select comment from daily_report_comments
      union all select coalesce(training_note, '') from partner_workers
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
  await submitAction(tq, T('technical.approve_configuration'));
  await tq.reload();
  await tq.selectOption('#doc_kind', 'shaft_layout');
  await tq.fill('#doc_title', 'Shaft layout');
  await tq.fill('#doc_change', 'First issue');
  await tq.setInputFiles('#doc_file', { name: 'shaft-layout.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% AIEC E2E ${Date.now()}\n%%EOF\n`) });
  await tq.click(`button:has-text("${T('technical.upload_document')}")`);
  await tq.getByRole('button', { name: T('technical.submit_document') }).waitFor({ timeout: 15000 });
  await tq.click(`button:has-text("${T('technical.submit_document')}")`);
  await tq.getByRole('button', { name: T('technical.approve_document') }).waitFor({ timeout: 15000 });
  await submitAction(tq, T('technical.approve_document'));
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
  const isoDayS = (n) => new Date(Date.now() + 330 * 60000 + n * 864e5).toISOString().slice(0, 10);
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
  await submitAction(op, T('project.acknowledge'));
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
  await submitAction(tq, T('bom.approve'));
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
  // Wait for the lasting result (the button's label changes to "Working…" while pending, so "detached" is not proof).
  await pp.getByText(T('procurement.issued_hint')).waitFor({ timeout: 15000 });
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
  // ---------- Slice 5: partner onboarding → readiness → invitation → tasks with safety → daily report ----------
  const offerScope = 'Install one 8-person MRL lift as per approved drawings';
  addData('Alpha Lift Works', 'Shop 4, Baner Road, Pune', 'Mr. Anil Patil', 'Pune', 'PCMC', 'Licensing Authority Pune', 'Insurer Pune', 'Income Tax Department', 'State Bank',
    'LIC-2026-001', 'INS-2026-001', 'ABCDE1234F', 'SB-2026-001', offerScope, '40 percent on rails, 40 percent on QA, 20 percent on handover', 'AIEC supplies lift material',
    'Full PPE, harness above 2 m', 'Civil work', 'Induction and harness training done', 'Open landing door on floor 3', 'Guard rail fixed and checked',
    'Guard rail fixed', 'Unloaded material, marked bracket positions', 'Fix rail brackets floors 1 to 3', 'Please photograph bracket spacing tomorrow');
  const pa = await login(browser, 'partnerA_admin');
  await pa.goto(`${BASE}/partner/company`);
  await pa.fill('#legal_name', 'Alpha Lift Works LLP');
  await pa.selectOption('#entity_type', 'llp');
  await pa.fill('#registered_address', 'Shop 4, Baner Road, Pune');
  await pa.fill('#authorized_representative', 'Mr. Anil Patil');
  await pa.fill('#contact_phone', '9822000001');
  await pa.fill('#service_areas', 'Pune\nPCMC');
  await pa.check('input[name="lift_categories"][value="passenger"]');
  await pa.fill('#team_size', '8');
  await pa.check('input[name="safety_policy_accepted"]');
  await pa.check('input[name="compliance_declaration"]');
  await pa.click(`button:has-text("${T('partner.save_profile')}")`);
  await pa.getByRole('button', { name: T('partner.submit_profile') }).waitFor({ timeout: 15000 });
  const docsToUpload = [
    ['contractor_licence', 'LIC-2026-001', 'Licensing Authority Pune'], ['insurance', 'INS-2026-001', 'Insurer Pune'],
    ['pan', 'ABCDE1234F', 'Income Tax Department'], ['bank_verification', 'SB-2026-001', 'State Bank'],
  ];
  for (const [i, [type, number, issuer]] of docsToUpload.entries()) {
    await pa.selectOption('#doc_type', type);
    await pa.fill('#doc_number', number);
    await pa.fill('#issuer', issuer);
    if (type === 'contractor_licence' || type === 'insurance') await pa.fill('#expires_on', isoDayS(365));
    if (type === 'contractor_licence') await pa.check('input[name="scope"][value="passenger"]');
    await pa.setInputFiles('#doc_file', { name: `${type}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${type} ${Date.now()}\n%%EOF\n`) });
    await pa.click(`button:has-text("${T('partner.upload_document')}")`);
    await pa.waitForFunction(([label, n]) => [...document.querySelectorAll('li')].filter((li) => li.textContent.includes(label)).length >= n, [T('partners.verification.pending'), i + 1], { timeout: 15000 });
    await pa.reload(); await pa.waitForLoadState('networkidle');
  }
  await snap(pa, 's5-partner-profile-and-documents', expectText(pa, T('partners.verification.pending')));
  await pa.click(`button:has-text("${T('partner.submit_profile')}")`);
  await pa.getByText(T('partner.profile_locked')).waitFor({ timeout: 15000 });

  const ow = await login(browser, 'owner');
  await ow.goto(`${BASE}/partners`);
  await snap(ow, 's5-owner-partner-portfolio', expectText(ow, 'Demo Partner Alpha Lifts'));
  await ow.getByRole('link', { name: 'Demo Partner Alpha Lifts' }).click();
  await ow.waitForURL(/\/partners\/[0-9a-f-]{36}$/, { waitUntil: 'commit' }); await ow.waitForLoadState('networkidle');
  const partnerUrl = ow.url();
  await ow.selectOption('#partner_action', 'start_verification');
  await ow.click(`button:has-text("${T('partners.record_decision')}")`);
  await ow.getByText(T('partner.state.verification_pending')).first().waitFor({ timeout: 15000 });
  for (let n = 0; n < 4; n++) {
    await ow.reload(); await ow.waitForLoadState('networkidle');
    const before = await ow.getByRole('button', { name: T('partners.verify'), exact: true }).count();
    await ow.getByRole('button', { name: T('partners.verify'), exact: true }).first().click();
    await ow.waitForFunction(([l, c]) => [...document.querySelectorAll('button')].filter((b) => b.textContent === l).length < c, [T('partners.verify'), before], { timeout: 15000 });
  }
  await ow.reload(); await ow.waitForLoadState('networkidle');
  await ow.selectOption('#partner_action', 'approve');
  await ow.click(`button:has-text("${T('partners.record_decision')}")`);
  await ow.getByText(T('partner.state.approved')).first().waitFor({ timeout: 15000 });
  await ow.reload(); await ow.waitForLoadState('networkidle');
  await snap(ow, 's5-owner-partner-approved-eligible', expectText(ow, T('partners.eligible')));

  await pa.goto(`${BASE}/partner/team`);
  for (const skill of ['general', 'mechanical', 'electrical', 'testing']) await pa.check(`input[name="skills"][value="${skill}"]`);
  await pa.fill('input[name="training_note"]', 'Induction and harness training done');
  await pa.click(`button:has-text("${T('partner.save_worker')}")`);
  await pa.getByText(T('partner.worker_saved')).waitFor({ timeout: 15000 });

  // Operations: site readiness (Gate 8), then invite the eligible partner (Gate 7).
  await op.goto(projectUrl);
  for (const sel of await op.locator('select[name^="result_"]').all()) await sel.selectOption('pass');
  await op.click(`button:has-text("${T('execution.record_site')}")`);
  await op.getByText(T('execution.site_passed')).first().waitFor({ timeout: 15000 });
  await op.reload(); await op.waitForLoadState('networkidle');
  await op.selectOption('#partner_org_id', { label: 'Demo Partner Alpha Lifts' });
  await op.fill('#scope_summary', offerScope);
  await op.fill('#schedule_from', isoDayS(3)); await op.fill('#schedule_to', isoDayS(40));
  await op.fill('#contract_value', '450000');
  await op.fill('#inv_payment_terms', '40 percent on rails, 40 percent on QA, 20 percent on handover');
  await op.fill('#material_responsibility', 'AIEC supplies lift material');
  await op.fill('#safety_requirements', 'Full PPE, harness above 2 m');
  await op.fill('#inv_exclusions', 'Civil work');
  await op.click(`button:has-text("${T('execution.invite')}")`);
  await op.getByText(T('execution.assignment_state.invited')).first().waitFor({ timeout: 15000 });
  await op.reload(); await op.waitForLoadState('networkidle');
  await snap(op, 's5-ops-site-ready-partner-invited', expectText(op, T('execution.assignment_state.invited')));

  await pa.goto(`${BASE}/partner`);
  await snap(pa, 's5-partner-invitation', expectText(pa, T('execution.assignment_state.invited')));
  await pa.locator('a[href^="/partner/assignments/"]').first().click();
  await pa.waitForURL(/\/partner\/assignments\//, { waitUntil: 'commit' }); await pa.waitForLoadState('networkidle');
  const assignmentUrl = pa.url();
  await pa.click(`button:has-text("${T('partner.accept_invitation')}")`);
  await pa.getByRole('button', { name: T('partner.add_member') }).waitFor({ timeout: 15000 });
  await pa.click(`button:has-text("${T('partner.add_member')}")`);
  await pa.getByRole('button', { name: T('partner.assign_task') }).first().waitFor({ timeout: 15000 });
  await pa.reload(); await pa.waitForLoadState('networkidle');
  const mobilisation = pa.locator('li', { hasText: T('work.task.mobilisation') }).first();
  await mobilisation.getByRole('button', { name: T('partner.assign_task') }).click();
  await mobilisation.getByText(T('work.state.assigned'), { exact: true }).waitFor({ timeout: 15000 });
  await pa.reload(); await pa.waitForLoadState('networkidle');
  await snap(pa, 's5-partner-accepted-team-task-assigned', expectText(pa, T('work.state.assigned')));

  // Pre-dispatch payment verified, then installation ready and started.
  const q5 = new Client({ connectionString: process.env.AIEC_E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/aiec_test' });
  await q5.connect();
  const pre = (await q5.query(`select amount_paise::text as a from payment_milestones where project_id = $1 and code = 'pre_dispatch'`, [projectId])).rows[0].a;
  await q5.end();
  await sq.goto(projectUrl);
  await sq.selectOption('#milestone_code', 'pre_dispatch');
  await sq.fill('#payer_name', 'Aditya Heights Society');
  await sq.fill('#claim_amount', `${pre.slice(0, -2)}.${pre.slice(-2)}`);
  await sq.fill('#payment_reference', `${utr}2`);
  await sq.click(`button:has-text("${T('payment.record_claim')}")`);
  await sq.getByText(T('payment.state.claimed')).first().waitFor({ timeout: 15000 });
  await fp.goto(`${BASE}/finance`);
  const preCard = fp.locator('section', { hasText: `${utr}2` });
  await preCard.locator('input[name="matched_statement_reference"]').fill(`HDFC statement line ${utr}2`);
  addData(`${utr}2`, `HDFC statement line ${utr}2`);
  await preCard.getByRole('button', { name: T('payment.record_decision') }).click();
  await preCard.waitFor({ state: 'detached', timeout: 15000 });
  await op.goto(projectUrl);
  await op.click(`button:has-text("${T('action.mark_installation_ready')}")`);
  await op.getByRole('button', { name: T('action.start_installation') }).waitFor({ timeout: 15000 });
  await op.click(`button:has-text("${T('action.start_installation')}")`);
  await op.getByText(T('project.state.installation')).first().waitFor({ timeout: 15000 });
  await op.reload(); await op.waitForLoadState('networkidle');
  await snap(op, 's5-ops-installation-started', expectText(op, T('project.state.installation')));

  // Technician: accept → safety pre-start (Gate 11) → start → safety stop → AIEC lifts → new pre-start → resume.
  const tc = await login(browser, 'partnerA_tech');
  await tc.goto(`${BASE}/work`);
  await snap(tc, 's5-technician-my-work', expectText(tc, T('work.task.mobilisation')));
  await tc.getByRole('link', { name: T('work.task.mobilisation') }).click();
  await tc.waitForURL(/\/work\/[0-9a-f-]{36}$/, { waitUntil: 'commit' }); await tc.waitForLoadState('networkidle');
  const taskUrl = tc.url();
  await tc.click(`button:has-text("${T('work.accept')}")`);
  await tc.getByRole('button', { name: T('work.record_safety') }).waitFor({ timeout: 15000 });
  const confirmAll = async () => { for (const sel of await tc.locator('select[name^="safety_"]').all()) await sel.selectOption('confirmed'); };
  await confirmAll();
  await tc.click(`button:has-text("${T('work.record_safety')}")`);
  await tc.getByRole('button', { name: T('work.start') }).waitFor({ timeout: 15000 });
  await snap(tc, 's5-technician-safety-passed', expectText(tc, T('work.safety_ok')));
  await tc.click(`button:has-text("${T('work.start')}")`);
  await tc.getByRole('button', { name: T('work.save_progress') }).waitFor({ timeout: 15000 });
  await tc.reload(); await tc.waitForLoadState('networkidle');
  await tc.selectOption('#inc_category', 'unsafe_condition');
  await tc.fill('#inc_description', 'Open landing door on floor 3');
  await tc.click(`button:has-text("${T('work.report')}")`);
  await tc.getByText(T('work.safety_stop_banner')).first().waitFor({ timeout: 15000 });
  await tc.reload(); await tc.waitForLoadState('networkidle');
  await snap(tc, 's5-technician-safety-stop', expectText(tc, T('work.safety_stop_banner')));
  await op.goto(projectUrl);
  await op.locator('input[name="resolution"]').first().fill('Guard rail fixed and checked');
  await op.click(`button:has-text("${T('execution.lift_safety_stop')}")`);
  await op.getByText(T('execution.incident_state.resolved')).first().waitFor({ timeout: 15000 });
  await tc.goto(taskUrl);
  await confirmAll();
  await tc.click(`button:has-text("${T('work.record_safety')}")`);
  await tc.getByText(T('work.safety_passed')).first().waitFor({ timeout: 15000 });
  await pa.goto(assignmentUrl);
  const blockedTask = pa.locator('li', { hasText: T('work.task.mobilisation') }).first();
  await blockedTask.locator('input[name="reason"]').fill('Guard rail fixed');
  await blockedTask.getByRole('button', { name: T('action.unblock') }).click();
  await pa.locator('li', { hasText: T('work.task.mobilisation') }).first().getByText(T('work.state.in_progress'), { exact: true }).waitFor({ timeout: 15000 });

  // Gate 9: checklist + required photo, then submit.
  await tc.goto(taskUrl);
  for (const box of await tc.locator('input[type="checkbox"][name^="done_"]').all()) await box.check();
  await tc.click(`button:has-text("${T('work.save_progress')}")`);
  await tc.getByText(T('work.progress_saved')).waitFor({ timeout: 15000 });
  await tc.reload(); await tc.waitForLoadState('networkidle');
  await tc.selectOption('#ev_category', 'before');
  await tc.setInputFiles('#ev_file', { name: 'before.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(`AIEC ${Date.now()}`), 0xff, 0xd9]) });
  await tc.click(`button:has-text("${T('work.add_photo')}")`);
  await tc.getByText(T('work.evidence_added')).waitFor({ timeout: 15000 });
  await tc.reload(); await tc.waitForLoadState('networkidle');
  await snap(tc, 's5-technician-checklist-and-photo', expectText(tc, T('enum.task_evidence.before')));
  await tc.click(`button:has-text("${T('work.submit')}")`);
  await tc.getByText(T('work.submitted_note')).waitFor({ timeout: 15000 });
  await snap(tc, 's5-technician-task-submitted', expectText(tc, T('work.submitted_note')));

  // Daily report (LP08) and an AIEC comment (OM06).
  await pa.goto(assignmentUrl);
  await pa.check('input[name="present"]');
  await pa.fill('#work_completed', 'Unloaded material, marked bracket positions');
  await pa.selectOption('#incident_declared', 'yes');
  await pa.fill('#safety_observations', 'Open landing door on floor 3');
  await pa.fill('#next_day_plan', 'Fix rail brackets floors 1 to 3');
  await pa.click(`button:has-text("${T('partner.submit_report')}")`);
  await pa.getByText(T('partner.report_submitted')).waitFor({ timeout: 15000 });
  await op.goto(projectUrl);
  await op.locator('input[name="comment"]').first().fill('Please photograph bracket spacing tomorrow');
  await op.click(`button:has-text("${T('execution.add_comment')}")`);
  await op.getByText('Please photograph bracket spacing tomorrow').first().waitFor({ timeout: 15000 });
  await op.reload(); await op.waitForLoadState('networkidle');
  await snap(op, 's5-ops-tasks-incident-daily-report', expectText(op, T('work.state.submitted')));
  await pa.goto(assignmentUrl);
  await snap(pa, 's5-partner-sees-aiec-comment', expectText(pa, 'Please photograph bracket spacing tomorrow'));
  const pb = await login(browser, 'partnerB_admin');
  await snap(pb, 's5-other-partner-cannot-open-assignment', async () => {
    await pb.goto(assignmentUrl);
    await pb.getByText(T('error.NOT_FOUND.title')).first().waitFor({ timeout: 8000 });
    return 'partner B cannot open partner A’s project';
  });

  // ---------- Slice 6: independent QA → defect and rework → final QA → statutory → handover → warranty → close ----------
  addData('Floor 2 landing opening', 'No barricade at open landing', 'Barricade fixed at landing', 'Lift Inspectorate Pune', 'AIR-2026-77', 'OPL-2026-77',
    'Mr. Rao, Society Secretary', 'Final project report', 'Approved specifications', 'Operating manual', 'Emergency instructions', 'Warranty certificate',
    'Statutory documents', 'Maintenance schedule', 'Demo Customer Housing Society', 'Example Lifts', 'MRL');
  const qp = await login(browser, 'qa1');
  await qp.goto(`${BASE}/qa`);
  await snap(qp, 's6-qa-queue', expectText(qp, T('work.task.mobilisation')));
  await qp.locator(`a[href="/qa/tasks/${taskUrl.split('/').pop()}"]`).first().click();
  await qp.waitForURL(/\/qa\/tasks\//, { waitUntil: 'commit' }); await qp.waitForLoadState('networkidle');
  const qaTaskUrl = qp.url();
  for (const sel of await qp.locator('select[name^="result_"]').all()) await sel.selectOption('pass');
  await qp.selectOption('#result_site_safety_setup', 'fail');
  await qp.selectOption('#defect_site_safety_setup_category', 'safety_component');
  await qp.selectOption('#defect_site_safety_setup_severity', 'major');
  await qp.fill('#defect_site_safety_setup_due', isoDayS(3));
  await qp.fill('#defect_site_safety_setup_location', 'Floor 2 landing opening');
  await qp.fill('#defect_site_safety_setup_description', 'No barricade at open landing');
  await submitAction(qp, T('qa.record_inspection'));
  await qp.reload(); await qp.waitForLoadState('networkidle');
  await snap(qp, 's6-qa-defect-raised', expectText(qp, T('qa.defect_state.assigned')));

  await pa.goto(assignmentUrl);
  await snap(pa, 's6-partner-sees-defect', expectText(pa, T('partner.defects')));
  await submitAction(pa, T('action.acknowledge'));
  await tc.goto(taskUrl);
  await submitAction(tc, T('action.start_correction'));
  await tc.reload(); await tc.waitForLoadState('networkidle');
  await tc.setInputFiles('input[id^="cf_"]', { name: 'correction.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(`fix ${Date.now()}`), 0xff, 0xd9]) });
  await tc.fill('input[id^="cr_"]', 'Barricade fixed at landing');
  await submitAction(tc, T('work.add_correction_photo'));
  await tc.reload(); await tc.waitForLoadState('networkidle');
  await submitAction(tc, T('action.submit_correction'));
  await tc.reload(); await tc.waitForLoadState('networkidle');
  await snap(tc, 's6-technician-rework-correction', expectText(tc, T('work.resubmit')));
  await submitAction(tc, T('work.resubmit'));
  await qp.goto(qaTaskUrl);
  for (const sel of await qp.locator('select[name^="result_"]').all()) await sel.selectOption('pass');
  await qp.selectOption('select[name^="decision_"]', 'verify');
  await submitAction(qp, T('qa.record_inspection'));
  await qp.reload(); await qp.waitForLoadState('networkidle');
  await snap(qp, 's6-qa-reinspection-approved', async () => {
    await qp.getByText(T('qa.defect_state.closed')).first().waitFor({ timeout: 8000 });
    await qp.getByText(T('work.state.approved')).first().waitFor({ timeout: 8000 });
    return 'defect closed with correction evidence; task QA-approved';
  });

  // The remaining six tasks go through the same RPCs (test seeding), then final QA in the screens.
  const q6 = new Client({ connectionString: process.env.AIEC_E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/aiec_test' });
  await q6.connect();
  await seedRemainingTasks(q6, projectId);
  await q6.end();
  await op.goto(projectUrl);
  await submitAction(op, T('action.submit_final_qa'));
  await qp.goto(`${BASE}/qa`);
  await qp.locator(`a[href="/qa/projects/${projectId}"]`).click();
  await qp.waitForURL(/\/qa\/projects\//, { waitUntil: 'commit' }); await qp.waitForLoadState('networkidle');
  for (const sel of await qp.locator('select[name^="result_"]').all()) await sel.selectOption('pass');
  await submitAction(qp, T('qa.record_inspection'));
  await qp.reload(); await qp.waitForLoadState('networkidle');
  await snap(qp, 's6-final-qa-passed', expectText(qp, T('project.state.statutory_pending')));

  // Gate 12: Operations records the official documents; the Owner (a second person) verifies them.
  await op.goto(projectUrl);
  for (const [type, ref] of [['authority_inspection_report', 'AIR-2026-77'], ['operating_licence', 'OPL-2026-77']]) {
    await op.locator('details').filter({ has: op.locator('#evidence_type') }).evaluate((d) => { d.open = true; });
    await op.selectOption('#evidence_type', type);
    await op.fill('#authority', 'Lift Inspectorate Pune');
    await op.fill('#reference_number', ref);
    await op.fill('#st_issued_on', isoDayS(0));
    await op.setInputFiles('#st_file', { name: `${type}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${type} ${Date.now()}\n%%EOF\n`) });
    await submitAction(op, T('handover.record_statutory'));
    await op.reload(); await op.waitForLoadState('networkidle');
  }
  await snap(op, 's6-ops-statutory-recorded', expectText(op, T('handover.second_person')));
  await ow.goto(projectUrl);
  for (let n = 0; n < 2; n++) {
    await submitAction(ow, T('handover.verify_statutory'));
    await ow.reload(); await ow.waitForLoadState('networkidle');
  }
  await op.goto(projectUrl);
  await submitAction(op, T('action.record_statutory_clearance'));
  await op.reload(); await op.waitForLoadState('networkidle');
  // Gate 13: the package, the customer link, then the customer signs off in the portal.
  for (const doc of ['final_project_report', 'approved_specifications', 'operating_manual', 'emergency_instructions', 'warranty_certificate', 'statutory_documents', 'maintenance_schedule']) {
    await op.locator('details').filter({ has: op.locator('#ho_doc_type') }).evaluate((d) => { d.open = true; });
    await op.selectOption('#ho_doc_type', doc);
    await op.fill('#ho_title', doc.split('_').map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' '));
    await op.setInputFiles('#ho_file', { name: `${doc}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${doc} ${Date.now()}\n%%EOF\n`) });
    await submitAction(op, T('handover.add_document'));
    await op.reload(); await op.waitForLoadState('networkidle');
  }
  addData('Final project report', 'Approved specifications', 'Operating manual', 'Emergency instructions', 'Warranty certificate', 'Statutory documents', 'Maintenance schedule');
  await submitAction(op, T('handover.link_customer'));
  await op.reload(); await op.waitForLoadState('networkidle');
  await submitAction(op, T('action.confirm_ready'));
  await op.reload(); await op.waitForLoadState('networkidle');
  await snap(op, 's6-ops-package-sent', expectText(op, T('handover.state.ready')));

  const cu = await login(browser, 'customer1');
  await cu.goto(`${BASE}/customer`);
  await snap(cu, 's6-customer-home', expectText(cu, T('customer.action_needed')));
  await cu.goto(`${BASE}/customer/projects/${projectId}`);
  await cu.fill('#acceptor_name', 'Mr. Rao, Society Secretary');
  await submitAction(cu, T('customer.accept_handover'));
  await cu.reload(); await cu.waitForLoadState('networkidle');
  await snap(cu, 's6-customer-accepted-warranty', async () => {
    await cu.getByText(T('handover.warranty_state.active')).first().waitFor({ timeout: 8000 });
    if (await cu.getByText(T('order.contract_value')).count()) throw new Error('customer must not see internal contract data');
    return 'handover accepted; warranty active; no internal data';
  });
  await op.goto(projectUrl);
  await submitAction(op, T('action.close'));
  await op.reload(); await op.waitForLoadState('networkidle');
  await snap(op, 's6-ops-project-closed', expectText(op, T('project.state.closed')));


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
