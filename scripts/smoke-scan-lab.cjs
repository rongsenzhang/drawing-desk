// Run against an HTTP-served copy of the project. Set LAB_BASE_URL to a project URL.
const assert = require('node:assert/strict');
const {chromium, webkit, devices} = require('playwright');
const base = process.env.LAB_BASE_URL || 'http://127.0.0.1:8080/';
const url = new URL('scan-lab.html', base);

async function check(engine, profile, options) {
  const browser = await engine.launch(options);
  try {
    const page = await browser.newPage(profile);
    const errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => {
      const dest = new URL(req.url());
      if (dest.protocol.startsWith('http') && dest.origin !== url.origin) network.push(dest.href);
    });
    await page.goto(url.href);
    const runButton = page.getByRole('button', {name:'Run OCR on this scan'});
    async function settled() {
      await page.waitForFunction(() => document.getElementById('activity').textContent === 'Live reading complete.');
      assert.ok(await runButton.isEnabled());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await settled();
    assert.equal(await page.locator('#live-gate').innerText(), 'Ready for estimating');
    assert.match(await page.locator('#live-text').innerText(), /SPEC: WS-12/);
    await page.getByLabel('Hide specification').check();
    await settled();
    assert.equal(await page.locator('#live-gate').innerText(), 'Held for clarification');
    assert.doesNotMatch(await page.locator('#live-text').innerText(), /SPEC: WS-12/);
    assert.match(await page.locator('#baseline-text').innerText(), /SPEC: WS-12/);
    assert.match(await page.locator('#field-change').innerText(), /WS-12 to unread/);
    assert.match(await page.locator('#rings').innerText(), /Original 2 \/ live 2/);
    await page.getByLabel('Reduce to 60%').check();
    await settled();
    assert.match(await page.locator('#caption').innerText(), /720 × 432/);
    assert.equal(await page.locator('#live-gate').innerText(), 'Ready for estimating');
    await page.getByLabel('Original scan').check();
    await settled();
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(engine.name(), browser.version(), await page.evaluate(() => innerWidth), 'px · ready → held → ready → ready; no overflow or external requests');
  } finally {
    await browser.close();
  }
}
Promise.all([
  check(chromium, {viewport:{width:1280,height:850}}, {executablePath:process.env.CHROME_PATH || undefined}),
  check(webkit, devices['iPhone 13'], {}),
]).catch(error => {console.error(error);process.exitCode=1;});
