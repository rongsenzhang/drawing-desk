// Run against either a local static server or the published project URL.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, webkit } = require('playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8000/');
if (!base.pathname.endsWith('/') && !base.pathname.endsWith('.html')) base.pathname += '/';
const engine = process.env.BROWSER_ENGINE || 'chromium';
const launchers = { chromium, webkit };
const form = id => 'form[data-finding="' + id + '"]';
const devices = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

function watch(context) {
  const errors = [], external = [], seen = new Set();
  context.on('page', page => {
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', entry => { if (entry.type() === 'error') errors.push('Console: ' + entry.text()); });
  });
  const http = url => /^https?:/.test(url);
  context.on('request', request => {
    if (!http(request.url())) return;
    const target = new URL(request.url());
    seen.add(target.pathname);
    if (target.origin !== base.origin) external.push(target.href);
  });
  context.on('requestfailed', req => {
    if (http(req.url())) errors.push('Request failed: ' + req.url() + ' ' + req.failure()?.errorText);
  });
  context.on('response', response => {
    if (http(response.url()) && response.status() >= 400) errors.push('HTTP ' + response.status() + ' ' + response.url());
  });
  return { errors, external, seen };
}

async function hasText(page, selector, pattern, timeout = 10000) {
  await page.locator(selector).filter({ hasText: pattern }).first().waitFor({ timeout });
}

async function checkWidth(page, label) {
  const layout = await page.evaluate(() => ({
    available: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(Math.max(layout.body, layout.document) <= layout.available + 1,
    label + ' overflows the viewport: ' + JSON.stringify(layout));
}

async function downloadHandoff(page) {
  const pending = page.waitForEvent('download');
  await page.locator('[data-download]').click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  const bytes = await fs.readFile(await download.path());
  return {
    document: JSON.parse(bytes.toString('utf8')),
    file: { name: download.suggestedFilename(), mimeType: 'application/json', buffer: bytes },
  };
}

async function upload(page, file, feedback) {
  await page.locator('#handoff-file').setInputFiles(file);
  await page.locator('#import-button').click();
  await hasText(page, '#feedback', feedback);
}

async function review(browser, device) {
  const { name, ...options } = device;
  const context = await browser.newContext({ ...options, acceptDownloads: true });
  const monitor = watch(context);
  let step = 'open workspace';
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    // Let WebKit finish loading the actual drawing before deliberately navigating away.
    const verifyDrawing = async () => {
      const width = await page.locator('.sheet img').evaluate(async image => {
        await image.decode();
        return image.naturalWidth;
      });
      assert.equal(width, 1200);
    };
    const open = async id => {
      const url = new URL(base);
      url.searchParams.set('case', id);
      await page.goto(url.href, { waitUntil: 'load' });
      await page.locator('[data-case="' + id + '"][aria-pressed="true"]').waitFor();
      await verifyDrawing();
    };
    await open('revision');
    await hasText(page, '.tag.held', /On hold/i);
    await checkWidth(page, name + ' initial workspace');
    step = 'guide, drawing highlights and original evidence';
    await page.locator('[data-guide]').click();
    await page.locator('dialog[open]').waitFor();
    assert.equal(await page.locator('#guide ol li').count(), 5);
    await checkWidth(page, name + ' guide');
    await page.getByRole('button', { name: 'Return to workspace' }).click();
    await page.locator('dialog[open]').waitFor({ state: 'hidden' });
    await page.locator('[data-field="revision"]').click();
    await page.locator('.line-box').waitFor();
    await hasText(page, '.viewer-actions', /REVISION: A/);
    await hasText(page, '.viewer-actions', /REVISION: B/);
    assert.equal(await page.locator('.sheet .hit').count(), 4);
    await page.locator('#markers').uncheck();
    assert.equal(await page.locator('.sheet .hit').count(), 0);
    await page.locator('#markers').check();
    assert.equal(await page.locator('.sheet .hit').count(), 4);
    await page.locator('[data-source="enquiry"]').click();
    await hasText(page, '.doc-text', /REVISION: A/);
    await page.locator('[data-source="ocr"]').click();
    await hasText(page, '.doc-text', /REVISION: B/);

    step = 'on-device OCR and lexical retrieval';
    await page.locator('[data-run]').click();
    await hasText(page, '#ocr-status', /Live OCR completed/i, 90000);
    await hasText(page, '.doc-text', /PART ID: PL-104/);
    await hasText(page, '.tag.held', /On hold/i);
    await page.locator('[data-view="reference"]').click();
    await page.locator('#clause-search').fill('DC-03');
    await hasText(page, '#ref-results .ref-item', /DC-03/);
    assert.equal(await page.locator('#ref-results .ref-item').count(), 1);
    await page.locator('#clause-search').fill('unobtainium');
    await hasText(page, '#ref-results', /No matching clause/);
    await page.locator('[data-view="compare"]').click();

    step = 'guided referral and source-backed resolution';
    const revision = page.locator(form('field-revision'));
    await revision.locator('textarea').fill('Check why the enquiry lists revision A and the scan shows B.');
    await revision.getByRole('button', { name: 'Refer to Engineering' }).click();
    await hasText(page, '.tag.held', /On hold/i);
    await hasText(page, '.exception.referred', /CL-104-02/);
    await revision.locator('select').selectOption('CL-104-02');
    await revision.locator('textarea').fill('The written customer confirmation identifies revision B for this enquiry.');
    await revision.getByRole('button', { name: 'Record clarification' }).click();
    await hasText(page, '.tag.ready', /Ready for estimating/i);
    await hasText(page, '.effective', /B.*CL-104-02/);
    await page.locator('[data-view="log"]').click();
    assert.equal(await page.locator('.audit-item').count(), 2);
    await page.reload({ waitUntil: 'load' });
    await hasText(page, '.effective', /CL-104-02/);
    await verifyDrawing();
    const accepted = await downloadHandoff(page);
    assert.equal(accepted.document.status, 'ready');
    assert.deepEqual(accepted.document.decisions.map(d => d.action), ['refer', 'resolve']);
    const field = accepted.document.fields.find(f => f.key === 'revision');
    assert.deepEqual([field.request, field.drawing, field.effective, field.effectiveSource], ['A', 'B', 'B', 'CL-104-02']);

    step = 'file acceptance, duplicate prevention and inbox persistence';
    await page.locator('nav a[href="inbox.html"]').click();
    await page.locator('#import-button:enabled').waitFor();
    await upload(page, accepted.file, /RFQ-104 accepted/);
    assert.equal(await page.locator('#receipt-count').textContent(), '1');
    await page.locator('#receipts details summary').click();
    await hasText(page, '#receipts details', /CL-104-02/);
    await checkWidth(page, name + ' accepted evidence');
    await upload(page, accepted.file, /RFQ-104 is already in the inbox/);
    await page.reload({ waitUntil: 'load' });
    await hasText(page, '#receipts', /RFQ-104/);
    assert.equal(await page.locator('#receipt-count').textContent(), '1');

    step = 'valid clean case and same-tab handoff';
    await open('revision');
    await page.locator('[data-case="clean"]').click();
    await verifyDrawing();
    await hasText(page, '.tag.ready', /Ready for estimating/i);
    assert.equal(await page.locator('.field-row').count(), 5);
    assert.equal(await page.locator('.exception').count(), 0);
    await page.locator('[data-transfer]').click();
    await hasText(page, '#feedback', /RFQ-208 accepted/);
    assert.equal(await page.locator('#receipt-count').textContent(), '2');

    step = 'unresolved missing evidence and intake rejection';
    await open('missing');
    const missing = page.locator(form('field-spec'));
    await missing.locator('textarea').fill('The scan lacks the specification required to prepare an estimate.');
    await missing.getByRole('button', { name: 'Refer to Quality' }).click();
    await hasText(page, '.exception.referred', /Awaiting a source document/);
    assert.equal(await page.locator('form[data-action="resolve"]').count(), 0);
    await hasText(page, '.tag.held', /On hold/i);
    const held = await downloadHandoff(page);
    assert.equal(held.document.documentType, 'clarification-draft');
    await page.locator('nav a[href="inbox.html"]').click();
    await page.locator('#import-button:enabled').waitFor();
    await upload(page, held.file, /clarification draft/i);
    assert.equal(await page.locator('#receipt-count').textContent(), '2');
    assert.equal(await page.locator('#receipts').getByText('RFQ-312').count(), 0);
    await checkWidth(page, name + ' inbox');

    step = 'network and runtime audit';
    assert.ok([...monitor.seen].some(p => p.endsWith('/assets/ocr/worker.min.js')), 'The real OCR worker was never fetched.');
    assert.deepEqual(monitor.external, [], 'Unexpected external requests');
    assert.deepEqual(monitor.errors, [], 'Browser or network errors');
    console.log(`PASS ${engine} ${name} ${device.viewport.width}×${device.viewport.height}: three packets, live OCR, evidence, guide/search, decision persistence, JSON/file transfer, duplicate and draft handling; ${monitor.seen.size} same-origin paths.`);
  } catch (error) {
    throw new Error(`${engine} ${name} at "${step}": ${error.message}\nRuntime/network messages: ${JSON.stringify(monitor.errors)}`, { cause: error });
  } finally {
    await context.close();
  }
}

(async () => {
  const launcher = launchers[engine];
  if (!launcher) throw new Error('BROWSER_ENGINE must be chromium or webkit.');
  const executablePath = engine === 'chromium' ? process.env.CHROME_PATH : undefined;
  const browser = await launcher.launch({ headless: true, executablePath });
  try {
    for (const device of devices) await review(browser, device);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
