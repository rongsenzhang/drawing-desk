// Explicit production end-to-end evaluation. One successful run uses one paid model read.
// No routing, request manipulation, private image data, credentials or request bodies.
const {webkit, devices} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const labels = require('../tests/reader-independent-labels.json');
const root = path.resolve(__dirname, '..');
const live = 'https://rongsenzhang.github.io/drawing-desk/upload.html';
const expectedService = 'https://drawing-desk-vision-rz.dark-betta-0975.chatgpt.site/api/read';

async function main() {
  if (!process.argv.includes('--send')) throw Error('Run with --send to submit the original training card to the public image reader.');
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext(devices['iPhone 13']);
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const posts = [], errors = [];
    context.on('request', request => {
      if (request.method() === 'POST') posts.push(new URL(request.url()).origin + new URL(request.url()).pathname);
    });
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(live);
    assert.equal(response.status(),200);
    const chooser = page.waitForEvent('filechooser');
    await page.locator('label[for="image-file"]').click();
    await (await chooser).setFiles(path.join(root,labels.image));
    await page.locator('#preview:not([hidden])').waitFor();
    await page.locator('#run-local').click();
    await page.waitForFunction(() => document.getElementById('local-status').textContent.includes('completed'));
    const localText = await page.locator('#transcript').textContent();
    const before = posts.length;
    assert.equal(before,0);

    const waitRead = page.waitForResponse(res => res.request().method() === 'POST' && res.url() === expectedService,{timeout:125000});
    await page.locator('#run-model').click();
    const res = await waitRead;
    console.log('Live service HTTP',res.status());
    if (res.status() === 429) {
      console.log('Service traffic limit; this run produced no model reading.');
      process.exitCode=75;
      return;
    }
    assert.equal(res.status(),200);
    const {model, readAt, fields} = await res.json();
    const modelFields = fields.map(({key,value,status,evidence,box}) => ({key,value,status,evidence,box}));
    const report = {
      page:live, service:expectedService, httpStatus:res.status(), browser:'WebKit ' + browser.version(), emulation:'iPhone 13',
      groundTruth:'tests/reader-independent-labels.json', inputImage:labels.image,
      inputMethod:'Native file chooser', beforeExplicitSendPosts:before, afterExplicitSendPosts:posts,
      model, readAt, modelFields, browserOcrTranscript:localText
    };
    // Persist the real reading before doing any UI assertions so investigation never needs a second model call.
    const resultPath = path.join(root,'tests/openai-upload-e2e.json');
    await fs.writeFile(resultPath,JSON.stringify(report,null,2)+'\n');
    await page.waitForFunction(() => document.querySelector('#model-status').textContent.includes('completed'));
    const displayed = await page.locator('#results article').evaluateAll(rows => rows.map(row => ({
      key:row.dataset.field, comparison:row.dataset.state, evidence:Object.fromEntries([...row.querySelectorAll('dt')].map(dt => [dt.textContent,dt.nextElementSibling.textContent]))
    })));
    report.outcomes = Object.entries(labels.fields).map(([key,target]) => {
      const observed = modelFields.find(row => row.key === key);
      const ui = displayed.find(row => row.key === key);
      const uiText = ui?.evidence['Browser OCR'];
      const browserValue = uiText === 'Missing' ? null : uiText;
      return {
        key, target, modelValue:observed?.value, modelStatus:observed?.status,
        exactModel:observed?.value === target && observed?.status === (target === null ? 'missing' : 'read'),
        browserValue, exactBrowser:browserValue === target, comparison:ui?.comparison,
        uiModelValue:ui?.evidence.OpenAI
      };
    });
    report.viewport=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
    report.pageErrors=errors;
    report.reviewGate=await page.locator('#review-gate').innerText();
    report.modelStatus=await page.locator('#model-status').textContent();
    report.exactModel=report.outcomes.filter(r=>r.exactModel).length;
    report.exactBrowser=report.outcomes.filter(r=>r.exactBrowser).length;
    report.total=report.outcomes.length;
    await fs.writeFile(resultPath,JSON.stringify(report,null,2)+'\n');
    assert.deepEqual(posts,[expectedService]);
    assert.equal(report.viewport.width,report.viewport.documentWidth);
    assert.equal(displayed.length,5);
    assert.deepEqual(errors,[]);
    console.log('Model exact',report.exactModel+'/5','Browser OCR exact',report.exactBrowser+'/5','UI',report.outcomes.map(o=>o.comparison).join(', '));
  } finally {
    await browser.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
