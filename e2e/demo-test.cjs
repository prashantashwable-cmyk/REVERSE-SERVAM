// Phone-size check of the GitHub Pages demo (docs/demo): Marathi by default with no English
// words outside data, switch to English and back, choice remembered after reload.
// Usage: serve the repo's docs/ folder (e.g. `python3 -m http.server 8765 -d docs`), then
//   node e2e/demo-test.cjs <screenshot-dir> [http://127.0.0.1:8765/demo/]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const URL = process.argv[3] ?? 'http://127.0.0.1:8765/demo/';
const results = [];

function dictionary(locale) {
  const src = fs.readFileSync(path.join(__dirname, `../packages/domain/src/messages/${locale}.ts`), 'utf8');
  const out = {};
  for (const m of src.matchAll(/^  '((?:[^'\\]|\\.)*)': '((?:[^'\\]|\\.)*)',$/gm)) out[m[1].replace(/\\(.)/g, '$1')] = m[2].replace(/\\(.)/g, '$1');
  return out;
}
const MR = dictionary('mr');
const EN = dictionary('en');
const strip = (s) => s.replace(/<\/?b>/g, '');

// Data words: fictional people/places from the demo seed (the i18n-ignore blocks) + what this test types.
const store = fs.readFileSync(path.join(__dirname, '../apps/demo/src/store.ts'), 'utf8');
const seedText = [...store.matchAll(/i18n-ignore-start[\s\S]*?i18n-ignore-end/g)].map((m) => m[0].replace(/\b(id|name|role|org|contactName|phone|projectName|locality|lat|lng|status|ownerId|builderName|city|nextActionAt|score|qualification|lostReason|closedReason|liftRequirement|mk|push|leads|need|decision_authority|timeline|next_action|tx|export|const|USERS|DemoUser|fictional|people|and|company|names|data|not|interface|text|seed|ignore|start|end)\b/g, ' ')).join(' ');
const dataWords = new Set((seedText + ' Kavita Joshi Test Tower Baner Pune AIEC').match(/[A-Za-z]{2,}/g).map((w) => w.toLowerCase()));
// Strip identifiers that are written in code form: business IDs, role keys and seed user ids.
const LATIN_OK = new Set(['aiec', 'os', 'gps', 'mrl', 'mm', 'cm', 'english', 'pun', 'pcmc', 'ld', 'sv', 'whatsapp', 'sms', 'demo', 'ist']);

async function scan(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText);
  const english = [...new Set((text.match(/[A-Za-z]{2,}/g) ?? []).filter((w) => !LATIN_OK.has(w.toLowerCase()) && !dataWords.has(w.toLowerCase())))];
  results.push({ name, ok: english.length === 0, note: english.length ? `English words: ${english.join(', ')}` : 'all Marathi (or data)' });
  console.log(`${english.length ? 'FAIL' : 'PASS'} ${name} ${english.join(', ')}`);
}
function check(name, ok, note) {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${note}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], geolocation: { latitude: 18.5596, longitude: 73.7868 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.getByText(MR['demo.try_title']).waitFor();
  check('default-language', (await page.evaluate(() => document.documentElement.lang)) === 'mr-IN', 'html lang is mr-IN on first visit');
  await scan(page, '01-home-sales');

  // Leads list, lead detail, new lead (validation error toast + duplicate panel)
  await page.getByRole('button', { name: MR['demo.tab_leads'], exact: true }).click();
  await scan(page, '02-leads');
  await page.getByText('Green Valley Society').first().click();
  await scan(page, '03-lead-detail');
  await page.getByRole('button', { name: MR['demo.back_leads'] }).click();
  await page.getByRole('button', { name: MR['demo.new_lead_btn'] }).click();
  await page.getByRole('button', { name: MR['lead_form.create'], exact: true }).click();
  await page.getByText(MR['error.REQUIRED_FIELD_MISSING.title']).waitFor();
  await scan(page, '04-new-lead-errors');
  const fields = page.locator('.field input');
  await fields.nth(0).fill('Kavita Joshi');
  await fields.nth(1).fill('98220 11001');
  await fields.nth(3).fill('Test Tower');
  await fields.nth(6).fill('One lift');
  await page.locator('.field select').selectOption('referral');
  // After a failed attempt the duplicate check runs live, so the panel may already be open.
  const dupTitle = page.getByText(MR['demo.dup_title']);
  if (!(await dupTitle.count())) await page.getByRole('button', { name: MR['lead_form.create'], exact: true }).click();
  await dupTitle.waitFor();
  check('duplicate-button-label', (await page.getByRole('button', { name: MR['lead_form.confirm_create'] }).count()) === 1, 'submit button asks to confirm');
  await scan(page, '05-duplicate-review');

  // Surveyor flow: survey detail in Marathi
  await page.locator('.role select').selectOption('u-surv1');
  await page.getByRole('button', { name: MR['demo.tab_my_surveys'] }).click();
  await page.locator('.list .item').first().click();
  await page.getByRole('button', { name: MR['mobile.accept'], exact: true }).click();
  await page.getByRole('button', { name: MR['mobile.check_in_now'] }).click();
  await page.getByText(MR['mobile.measurements'], { exact: true }).waitFor();
  await scan(page, '06-survey-capture');
  await page.getByRole('button', { name: MR['demo.tab_inbox'] }).click();
  await scan(page, '07-inbox');

  // Owner audit log
  await page.locator('.role select').selectOption('u-owner');
  await page.getByRole('button', { name: MR['demo.tab_audit'] }).click();
  await scan(page, '08-audit');
  await page.getByRole('button', { name: MR['demo.what_is_this'] }).click();
  await scan(page, '09-about');

  // Switch to English, then back; the choice survives a reload
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: EN['demo.tab_home'], exact: true }).click();
  await page.getByText(strip(EN['demo.try_title'])).waitFor();
  await page.screenshot({ path: `${OUT}/10-english-home.png`, fullPage: true });
  check('english-switch', (await page.evaluate(() => document.documentElement.lang)) === 'en-IN', 'switched to English');
  await page.reload();
  await page.getByText(EN['demo.try_title']).waitFor();
  check('english-remembered', true, 'English kept after reload');
  await page.getByRole('button', { name: 'मराठी' }).click();
  await page.reload();
  await page.getByText(MR['demo.try_title']).waitFor();
  check('marathi-remembered', true, 'Marathi kept after reload');
  check('no-js-errors', errors.length === 0, errors.join('; ') || 'none');

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[demo] ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('DEMO TEST ERROR', e); process.exit(2); });
