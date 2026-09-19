// Records the DeepChart demo as screenshots (docs/screenshots/deepchart/).
// Needs a stub backend with the records check on, serving the built site:
//   cd web && npm run build && cd .. && EMERFLOW_STUB=1 EMERFLOW_RECORDS_CHECK=1 .venv/bin/uvicorn backend.main:app --port 8010
//   PLAYWRIGHT=<path to the playwright package> node tools/record_deepchart_demo.cjs docs/screenshots/deepchart
// Which patient gets held depends on timing, so the screenshots can differ from run to run.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
// What the doctor records for each fact in the demo (status, value): what they found after asking the patient.
const ENTRY = {
  'Blood thinners': ['active', 'warfarin 5mg'], 'Penicillin allergy': ['absent', ''], 'Stable heart rate and breathing': ['present', 'stable'],
  'Needs intensive care': ['present', 'yes'], 'On blood-pressure support': ['absent', ''], 'Blood type': ['present', 'O+'],
};
const OUT = process.argv[2], B = 'http://localhost:8010';
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const shot = async (page, name, loc) => { if (loc) { await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await loc.screenshot({ path: `${OUT}/${name}.png` }) } else { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${name}.png` }) } console.log('saved', name) };
(async () => {
  const br = await chromium.launch(); const errs = [];
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  // 1. board: commander logs in, bus crash
  const board = await ctx.newPage(); board.on('pageerror', e => errs.push(String(e)));
  await board.goto(B + '/login/'); await board.fill('#pin', 'demo'); await board.getByRole('button', { name: 'Log in' }).click();
  await board.waitForURL(/\/board/); await board.getByRole('button', { name: /Bus crash/ }).click();
  await post('/api/control', { action: 'speed', speed: 5 });
  await board.getByText('VERIFICATION REQUIRED').first().waitFor({ timeout: 120000 });
  await post('/api/control', { action: 'pause' });
  const card = board.locator('li', { hasText: 'VERIFICATION REQUIRED' }).first();
  await shot(board, '01-board-hold-card', card);
  const href = await card.getByRole('link', { name: /DeepChart/ }).getAttribute('href'); console.log('hold link', href);
  // 2. doctor logs in by name
  const doc = await ctx.newPage(); doc.on('pageerror', e => errs.push(String(e)));
  await doc.goto(B + '/login/?as=doctor&next=' + encodeURIComponent(href));
  await doc.selectOption('#doctor', 'Dr. Amara Whitfield'); await doc.fill('#pin', 'demo');
  await shot(doc, '02-login-doctor', doc.locator('form'));
  await doc.getByRole('button', { name: 'Log in' }).click();
  await doc.getByText('VERIFICATION REQUIRED').first().waitFor();
  await shot(doc, '03-doctor-chart-hold');
  // 3. lookup
  await doc.getByRole('button', { name: /Look up other hospitals/ }).click(); await doc.getByText(/Strong match|Possible match/).first().waitFor();
  const look = doc.locator('section', { has: doc.getByRole('heading', { name: 'Records at other hospitals' }) });
  await shot(doc, '04-lookup-matches', look);
  const nots = doc.locator('li', { hasText: 'Possible match' }).getByRole('button', { name: 'Not this patient' });
  if (await nots.count()) { await nots.first().click(); await doc.waitForTimeout(800); console.log('rejected lookalike') } else console.log('NO possible match for this patient');
  // 4. merged chart
  const chart = doc.locator('section', { has: doc.getByRole('heading', { name: 'Merged chart' }) });
  const fact = await chart.locator('li', { hasText: 'Records disagree' }).first().locator('strong').first().innerText(); console.log('conflict fact', fact);
  await shot(doc, '05-merged-chart', chart);
  // 5. add to the record
  const entry = doc.locator('section', { has: doc.getByRole('heading', { name: 'Add to the record' }) });
  await entry.getByRole('button', { name: fact, exact: true }).click();
  const [st, val] = ENTRY[fact] || ['present', 'confirmed']
  await entry.locator('select').selectOption(st); if (val) await entry.getByLabel('Value').fill(val);
  await entry.getByRole('button', { name: /Add entry/ }).click(); await entry.getByText(/Added to/).waitFor();
  await shot(doc, '06-add-to-record', entry);
  // 6. order
  const order = doc.locator('section', { has: doc.getByRole('heading', { name: 'New order' }) });
  await order.getByPlaceholder(/heparin/).fill('admit to the ward');
  await order.getByRole('button', { name: fact, exact: true }).click(); await order.getByRole('button', { name: /Check order/ }).click();
  await order.getByText('VERIFICATION REQUIRED').waitFor();
  await order.getByPlaceholder('What did you check?').fill('Called Fells Point Heart Institute and asked the patient');
  await shot(doc, '07-order-verification', order);
  await order.getByRole('button', { name: 'I have reviewed' }).click(); await order.getByText(/saved/).waitFor();
  // 7. release the hold
  await doc.getByRole('button', { name: /Records checked: move/ }).click(); await doc.getByText(/Move released/).waitFor();
  await shot(doc, '08-hold-released', doc.locator('section', { hasText: 'Move released' }));
  // 8. patient link
  await doc.getByRole('button', { name: /private link/ }).click();
  const plink = await doc.locator('a[href^="/p/"]').getAttribute('href');
  const dob = (await doc.getByText(/^Born /).innerText()).match(/\d{4}-\d{2}-\d{2}/)[0];
  await shot(doc, '09-access-log', doc.locator('section', { has: doc.getByRole('heading', { name: 'Who opened this record' }) }));
  const phone = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); phone.on('pageerror', e => errs.push(String(e)));
  await phone.goto(B + plink); await phone.getByText('confirm your date of birth').waitFor();
  await shot(phone, '10-patient-dob');
  await phone.fill('#dob', dob); await phone.getByRole('button', { name: 'Open my page' }).click(); await phone.getByText('Who opened your record').waitFor();
  await phone.waitForTimeout(1200); await phone.screenshot({ path: `${OUT}/11-patient-page.png`, fullPage: true }); console.log('saved 11-patient-page');
  const body = (await phone.innerText('body')).toLowerCase();
  console.log('patient page shows doctor:', body.includes('dr. amara whitfield'), '| leaks:', ['warfarin','disagree','conflict','admit to the ward','o+'].filter(w => body.includes(w)));
  // 9. the sending hospital
  const sinai = await br.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await sinai.goto(B + '/login/?as=doctor'); await sinai.selectOption('#hospital', 'Fells Point Heart Institute');
  await sinai.selectOption('#doctor', 'Dr. Samuel Achebe'); await sinai.fill('#pin', 'demo'); await sinai.getByRole('button', { name: 'Log in' }).click();
  await sinai.getByRole('button', { name: /Transfer to/ }).first().click(); await sinai.getByText(/^Sent /).waitFor();
  await shot(sinai, '12-transfer-desk');
  await doc.bringToFront(); await doc.getByRole('heading', { name: 'Incoming transfers' }).waitFor({ timeout: 10000 });
  await shot(doc, '13-incoming-transfer', doc.locator('section', { has: doc.getByRole('heading', { name: 'Incoming transfers' }) }));
  console.log('errors:', errs); await br.close();
})().catch(async e => { console.error(e); process.exit(1) });
