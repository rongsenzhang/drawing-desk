// Two real PDF page renders and OCR runs, with all model traffic intercepted.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { chromium, webkit, devices } = require('playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8000/');
if (!base.pathname.endsWith('/')) base.pathname += '/';
const fixtures = path.join(__dirname, '..', 'tests', 'pdf-fixtures');
const digest = data => createHash('sha256').update(data).digest('hex');
const expected = {
  first: { partId: 'DESK-742', revision: 'C', material: 'PAPER', finish: 'MATTE', spec: 'LABEL-38' },
  second: { partId: 'CARD-386', revision: 'F', material: 'VINYL', finish: 'GLOSS', spec: 'CARD-72' },
};

async function waitText(page, selector, pattern) {
  await page.waitForFunction(({ selector, source }) => {
    const target = document.querySelector(selector);
    return target && new RegExp(source, 'i').test(target.textContent);
  }, { selector, source: pattern.source }, { timeout: 60000 });
}

async function previewDigest(page) {
  // This is the exact prepared blob shown to the visitor, including JPEG
  // compression. Checking it catches wrong-page and whole-document transfers.
  return page.locator('#preview').evaluate(async img => {
    const response = await fetch(img.src);
    const bytes = await response.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  });
}

function stubReading(values) {
  return {
    model: 'synthetic-pdf-test-model',
    readAt: '2026-11-20T12:30:00Z',
    fields: Object.entries(values).map(([key, value], i) => ({
      key, value, status: 'read', evidence: value, box: [65, 210 + i * 95, 390, 275 + i * 95],
    })),
  };
}

async function execute(engine, options, profile) {
  const browser = await engine.launch(options);
  let stage = 'initialisation';
  try {
    const context = await browser.newContext({ ...profile, serviceWorkers: 'block' });
    const submissions = [], unexpected = [], errors = [];
    let requestedSheet = null;
    // The mock is same-origin even when BASE_URL points to the public site.
    // An unexpected origin is blocked before an HTTP request can leave.
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base.origin && !['blob:', 'data:'].includes(url.protocol)) {
        unexpected.push(url.origin); return route.abort();
      }
      if (url.pathname.endsWith('/app/service-config.mjs')) {
        return route.fulfill({ contentType: 'text/javascript', body: 'export const apiBase = location.origin;' });
      }
      if (url.pathname === '/api/read') {
        if (request.method() !== 'POST' || !requestedSheet) {
          unexpected.push('unsolicited model request'); return route.abort();
        }
        const body = request.postDataJSON();
        const fields = Object.keys(body);
        const raw = typeof body.image === 'string' ? body.image : '';
        const bytes = Buffer.from(raw.split(',')[1] || '', 'base64');
        submissions.push({ fields, prefix: raw.split(',')[0], digest: digest(bytes), signature: bytes.subarray(0, 2).toString('hex'),
          metadataLeaked: bytes.includes(Buffer.from('PRIVATE-PDF-METADATA-ALPHA-OMEGA')) });
        const response = stubReading(requestedSheet);
        requestedSheet = null;
        return route.fulfill({ json: response });
      }
      return route.continue();
    });

    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const chooser = page.locator('#image-file');
    const controls = page.locator('#pdf-controls');
    const selector = page.locator('#pdf-page');
    const preview = page.locator('#preview');
    await page.goto(new URL('upload.html', base).href, { waitUntil: 'domcontentloaded' });
    assert.match(await chooser.getAttribute('accept'), /(?:application\/pdf|\.pdf)/i);
    stage = 'open local multi-page PDF';
    await chooser.setInputFiles(path.join(fixtures, 'workshop-label-pages.pdf'));
    await controls.waitFor();
    await waitText(page, '#file-caption', /page\s+1\s+of\s+2/);
    await waitText(page, '#pdf-count', /2\s+pages/);
    assert.equal(await selector.locator('option').count(), 2);
    assert.equal(await selector.inputValue(), '1');
    const firstDigest = await previewDigest(page);
    assert.ok(await preview.evaluate(i => i.naturalWidth > i.naturalHeight));
    assert.equal(submissions.length, 0);

    stage = 'read page 1 locally and verify explicit transfer of exactly this preview';
    await page.locator('#run-local').click();
    await waitText(page, '#local-status', /completed/);
    await waitText(page, '#transcript', /DESK-742/);
    assert.doesNotMatch(await page.locator('#transcript').textContent(), /CARD-386/);
    assert.equal(submissions.length, 0);
    requestedSheet = expected.first;
    await page.locator('#run-model').click();
    await waitText(page, '#source-summary', /synthetic-pdf-test-model/);
    await page.locator('[data-field="partId"][data-state="match"]').waitFor();
    assert.equal(submissions[0].digest, firstDigest);
    await page.locator('[data-locate="partId"]').click();
    const position = await page.locator('#model-box').boundingBox();
    const raster = await preview.boundingBox();
    assert.ok(position && raster);
    for (const [actual, desired] of [[position.x, raster.x + .065 * raster.width],
      [position.y, raster.y + .210 * raster.height], [position.width, .325 * raster.width],
      [position.height, .065 * raster.height]]) assert.ok(Math.abs(actual - desired) < 2);

    stage = 'switch to the scan-only portrait page and clear prior findings';
    await selector.selectOption('2');
    await waitText(page, '#file-caption', /page\s+2\s+of\s+2/);
    assert.equal(await page.locator('#results [data-field]').count(), 0);
    assert.ok(await page.locator('#model-box').isHidden());
    assert.doesNotMatch(await page.locator('#transcript').textContent(), /DESK-742/);
    assert.doesNotMatch(await page.locator('#source-summary').textContent(), /synthetic-pdf-test-model/);
    const secondDigest = await previewDigest(page);
    assert.notEqual(secondDigest, firstDigest);
    assert.ok(await preview.evaluate(i => i.naturalHeight > i.naturalWidth));
    assert.equal(submissions.length, 1);

    stage = 'read scan-only page pixels and verify its independently supplied JPEG';
    requestedSheet = expected.second;
    await page.locator('#run-model').click();
    await waitText(page, '#source-summary', /synthetic-pdf-test-model/);
    await waitText(page, '#local-status', /completed/);
    await waitText(page, '#transcript', /CARD-386/);
    assert.doesNotMatch(await page.locator('#transcript').textContent(), /DESK-742/);
    await page.locator('[data-field="partId"][data-state="match"]').waitFor();
    assert.equal(submissions[1].digest, secondDigest);
    for (const sent of submissions) {
      assert.deepEqual(sent.fields, ['image']);
      assert.equal(sent.prefix, 'data:image/jpeg;base64');
      assert.equal(sent.signature, 'ffd8');
      assert.equal(sent.metadataLeaked, false);
    }

    stage = 'reject password, oversized page count and broken structure with recovery';
    const badInputs = [
      [path.join(fixtures, 'locked-workshop-pages.pdf'), /password|encrypted/],
      [path.join(fixtures, 'thirty-one-pages.pdf'), /30\s+pages/],
      [path.join(fixtures, 'interactive-label.pdf'), /interactive|form/],
      [{ name: 'malformed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nBroken structure\n%%EOF') }, /damaged|invalid PDF|corrupt/],
    ];
    for (const [input, error] of badInputs) {
      await chooser.setInputFiles(input);
      await waitText(page, '#image-error', error);
      assert.ok(await preview.isHidden());
      assert.equal(await page.locator('#results [data-field]').count(), 0);
      assert.ok(await page.locator('#run-model').isDisabled());
      assert.ok(await page.locator('#run-local').isDisabled());
    }
    await chooser.setInputFiles(path.join(fixtures, 'workshop-label-pages.pdf'));
    await waitText(page, '#file-caption', /page\s+1\s+of\s+2/);
    assert.equal(await selector.inputValue(), '1');
    assert.equal(await previewDigest(page), firstDigest);
    assert.equal(submissions.length, 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log(engine.name(), browser.version(), await page.evaluate(() => innerWidth),
      'px · two selected-page raster/OCR checks, two exact JPEG transfers intercepted, stale results cleared, four rejected files, valid recovery');
    await context.close();
  } catch (error) {
    throw new Error(engine.name() + ' / ' + stage + ' / ' + error.message, { cause: error });
  } finally {
    await browser.close();
  }
}

const engines = process.env.BROWSER_ENGINE;
if (engines && !['chromium', 'webkit'].includes(engines)) throw new Error('BROWSER_ENGINE must be chromium or webkit.');
const tasks = [];
if (!engines || engines === 'chromium') tasks.push(execute(chromium,
  { executablePath: process.env.CHROME_PATH || undefined }, { viewport: { width: 1280, height: 850 } }));
if (!engines || engines === 'webkit') tasks.push(execute(webkit, {}, devices['iPhone 13']));
Promise.allSettled(tasks).then(results => {
  for (const result of results) if (result.status === 'rejected') { console.error(result.reason); process.exitCode = 1; }
});
