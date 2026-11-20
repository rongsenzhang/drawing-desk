// Tests only synthetic pixels. All model requests are intercepted and fulfilled locally.
const assert = require('node:assert/strict');
const {chromium, webkit, devices} = require('playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8000/');
if (!base.pathname.endsWith('/')) base.pathname += '/';
const address = new URL('upload.html', base);
const timestamp = '2026-11-20T22:00:00Z';
const example = {partId:'LAB-654', revision:'D', material:'PLASTIC', finish:'MATTE', spec:'LAB-29'};

function responseFields(uncertain) {
  const observed = {...example, finish:'POLISHED'};
  return Object.entries(observed).map(([key, value]) => ({
    key, value: uncertain && key === 'material' ? null : value,
    evidence: uncertain && key === 'material' ? null : value,
    status: uncertain && key === 'material' ? 'uncertain' : 'read'
  }));
}

async function waitText(page, selector, pattern) {
  await page.waitForFunction(({selector,source,flags}) => {
    const target = document.querySelector(selector);
    return target && new RegExp(source,flags).test(target.textContent);
  }, {selector, source:pattern.source, flags:pattern.flags}, {timeout:45000});
}

async function chooseFile(page, file) {
  const chooserEvent = page.waitForEvent('filechooser');
  await page.locator('label[for="image-file"]').click();
  await (await chooserEvent).setFiles(file);
}

async function storageState(page) {
  return page.evaluate(async () => {
    const databases = indexedDB.databases ? await indexedDB.databases() : [];
    const contents = [];
    for (const {name} of databases) {
      const db = await new Promise((resolve,reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        for (const store of db.objectStoreNames) {
          const n = await new Promise((resolve,reject) => {
            const req = db.transaction(store).objectStore(store).count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          if (n) contents.push([name,store,n]);
        }
      } finally {
        db.close();
      }
    }
    return {
      local: Object.keys(localStorage), session: Object.keys(sessionStorage),
      cookies: document.cookie, dbRecords: contents, cacheNames: self.caches ? await caches.keys() : []
    };
  });
}

function installFakeCamera() {
  const calls = [];
  let deny = true;
  const streams = [];
  const getUserMedia = async constraints => {
    calls.push(JSON.parse(JSON.stringify(constraints)));
    if (deny) throw new DOMException('Camera permission declined for this test.', 'NotAllowedError');
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    let frame = 0;
    function paint() {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#18302d';
      ctx.font = '32px sans-serif';
      ctx.fillText('STOCKROOM CAMERA',24,90);
      ctx.fillRect(25,430,20 + (++frame % 5),5);
    }
    paint();
    const stream = canvas.captureStream(12);
    const refresh = setInterval(() => {
      if (stream.getTracks().every(t => t.readyState === 'ended')) clearInterval(refresh);
      else paint();
    }, 70);
    streams.push(stream);
    return stream;
  };
  // Keep a stable harness across WebKit navigator wrapper lifetimes.
  Object.defineProperty(navigator, 'mediaDevices', {configurable:true,value:{getUserMedia}});
  window.__cameraHarness = {
    calls, permit: () => { deny = false; },
    states: () => streams.flatMap(s => s.getTracks().map(t => t.readyState))
  };
}

async function makeNewImage(page) {
  // Text extends well outside the sample-drawing title block.
  const dataURL = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 980;
    canvas.height = 620;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#111';
    ctx.font = '30px sans-serif';
    ['PURPLE CALIPER WORKSHOP','PART ID: LAB-654','REVISION: D','MATERIAL: PLASTIC','FINISH: MATTE','SPEC: LAB-29'].forEach((s,i) => ctx.fillText(s,40,70 + 65 * i));
    return canvas.toDataURL('image/png');
  });
  return {name:'purple-caliper-training.png',mimeType:'image/png',buffer:Buffer.from(dataURL.split(',')[1], 'base64')};
}

async function run(engine, launchOptions, profile) {
  const browser = await engine.launch(launchOptions);
  let step = 'initialise';
  try {
    const context = await browser.newContext({...profile, serviceWorkers:'block'});
    const errors = [], badNetwork = [], requests = [];
    let next = null;
    await context.addInitScript(installFakeCamera);
    await context.route('**/*', async route => {
      const req = route.request();
      const dest = new URL(req.url());
      if (dest.pathname.endsWith('/app/service-config.mjs')) {
        return route.fulfill({contentType:'text/javascript',body:'export const apiBase = location.origin;'});
      }
      if (dest.pathname === '/api/read' && req.method() === 'POST') {
        if (!next || dest.origin !== base.origin) {
          badNetwork.push('Unexpected image submission');
          return route.abort();
        }
        requests.push(req.postDataJSON());
        const reply = next;
        next = null;
        if (reply === 'error') return route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Demo usage limit reached.'})});
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          model:'fixture-vision-model', readAt:timestamp, fields:responseFields(reply === 'uncertain')
        })});
      }
      if (['http:','https:'].includes(dest.protocol) && (dest.origin !== base.origin || !['GET','HEAD'].includes(req.method()))) {
        badNetwork.push(req.method() + ' ' + dest.origin + dest.pathname);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(address.href + '?sample=revision');
    await page.locator('#preview:not([hidden])').waitFor();
    assert.equal(requests.length,0);
    assert.equal(await page.locator('#camera-file').getAttribute('capture'),'environment');
    await page.goto(address.href);
    const storageBefore = await storageState(page);
    step = 'native file chooser and format errors';
    await chooseFile(page,{name:'unsupported.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-fake')});
    await waitText(page,'#image-error',/PNG|JPEG|supported|format/i);
    assert.equal(requests.length,0);
    const file = await makeNewImage(page);
    await chooseFile(page,file);
    await page.locator('#preview:not([hidden])').waitFor();
    assert.equal(await page.locator('#run-local').isEnabled(),true);
    assert.equal(await page.locator('#run-model').isEnabled(),true);
    assert.equal(requests.length,0);
    step = 'local whole-page OCR';
    await page.locator('#run-local').click();
    await waitText(page,'#local-status',/completed|complete/i);
    await waitText(page,'#transcript',/PURPLE CALIPER WORKSHOP/i);
    await waitText(page,'#transcript',/LAB-654/i);
    assert.equal(requests.length,0);
    step = 'explicit model success';
    next = 'success';
    await page.locator('#run-model').click();
    await waitText(page,'#source-summary',/fixture-vision-model/);
    await waitText(page,"#results [data-field='material'][data-state='match']",/PLASTIC/i);
    await waitText(page,"#results [data-field='finish'][data-state='disagreement']",/POLISHED/i);
    assert.equal(requests.length,1);
    assert.deepEqual(Object.keys(requests[0]),['image']);
    const payload = requests[0].image;
    assert.match(payload,/^data:image\/jpeg;base64,/);
    assert.equal(Buffer.from(payload.split(',')[1], 'base64').subarray(0,2).toString('hex'),'ffd8');
    assert.ok(!payload.includes(file.name));
    step = 'uncertain response and failure';
    next = 'uncertain';
    await page.locator('#run-model').click();
    await page.waitForSelector("#results [data-field='material'][data-state='review']");
    assert.equal(requests.length,2);
    next = 'error';
    await page.locator('#run-model').click();
    await waitText(page,'#model-status',/usage limit|rate limit|try again/i);
    assert.equal(requests.length,3);
    await page.waitForFunction(() => document.querySelectorAll('#results [data-state="pending"]').length === 5);
    step = 'rotation and clear';
    await page.locator('#rotate').click();
    await waitText(page,'#file-caption',/620\s*[×x]\s*980/);
    assert.equal(requests.length,3);
    await page.locator('#clear').click();
    await page.locator('#preview').waitFor({state:'hidden'});
    assert.equal(await page.locator('#run-model').isDisabled(),true);
    assert.doesNotMatch(await page.locator('#transcript').textContent(),/PURPLE CALIPER/);
    step = 'camera permission, capture and track cleanup';
    await page.locator('#camera-start').click();
    await waitText(page,'#camera-status',/unavailable|denied|declined/i);
    assert.equal(await page.evaluate(() => window.__cameraHarness.calls.length),1);
    await page.evaluate(() => window.__cameraHarness.permit());
    await page.locator('#camera-start').click();
    await page.waitForFunction(() => !document.querySelector('#camera-shot').disabled);
    await page.locator('#camera-shot').click();
    await page.locator('#preview:not([hidden])').waitFor();
    await page.waitForFunction(() => window.__cameraHarness.states().length > 0 && window.__cameraHarness.states().every(v => v === 'ended'));
    assert.equal(requests.length,3);
    await page.locator('#camera-start').click();
    await page.locator('#camera-stop').click();
    await page.waitForFunction(() => window.__cameraHarness.states().length >= 2 && window.__cameraHarness.states().every(v => v === 'ended'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    step = 'native photo capture fallback and simultaneous readers';
    await page.locator('#camera-file').setInputFiles({...file,name:'workshop-camera.png'});
    await waitText(page,'#file-caption',/workshop-camera/);
    assert.equal(requests.length,3);
    next = 'success';
    await page.locator('#run-model').click();
    await waitText(page,'#local-status',/completed/i);
    await waitText(page,'#transcript',/PURPLE CALIPER WORKSHOP/i);
    await waitText(page,"#results [data-field='finish'][data-state='disagreement']",/POLISHED/i);
    assert.equal(requests.length,4);
    step = 'reload and browser storage';
    await page.reload();
    await page.locator('#preview').waitFor({state:'hidden'});
    assert.equal(await page.locator('#image-file').inputValue(),'');
    assert.equal(await page.locator('#run-local').isDisabled(),true);
    assert.deepEqual(await storageState(page),storageBefore);
    assert.deepEqual(badNetwork,[]);
    assert.deepEqual(errors,[]);
    console.log(engine.name(), browser.version(), await page.evaluate(() => innerWidth), 'px · chooser, full OCR, four mocked submissions, camera capture, clear and storage checks passed');
  } catch (error) {
    throw new Error(engine.name() + ' / ' + step + ' / ' + error.message);
  } finally {
    await browser.close();
  }
}
Promise.allSettled([
  run(chromium,{executablePath:process.env.CHROME_PATH || undefined},{viewport:{width:1280,height:850}}),
  run(webkit,{},devices['iPhone 13']),
]).then(results => {
  for (const result of results) if (result.status === 'rejected') {console.error(result.reason);process.exitCode=1;}
});
