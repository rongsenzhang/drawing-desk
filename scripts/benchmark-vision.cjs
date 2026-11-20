// Run with Playwright installed; --write refreshes committed browser output after a review.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const {chromium, webkit, devices} = require('playwright');
const root = path.resolve(__dirname, '..');
const labels = require('../tests/vision-labels.json');
const types = {'.js': 'application/javascript', '.mjs':'application/javascript', '.png':'image/png', '.gz':'application/gzip'};

function fileServer() {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/drawing-desk/') return res.end('<title>Vision benchmark</title>');
    const relative = pathname.replace(/^\/drawing-desk\//, '');
    const name = path.resolve(root, relative);
    if (!name.startsWith(root + path.sep)) {res.writeHead(404);return res.end();}
    try {
      const content = await fs.readFile(name);
      res.setHeader('Content-Type', types[path.extname(name)] || 'application/octet-stream');
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
}

function score(obs, truth, variant) {
  const present = {...truth.fields};
  if (variant === 'spec-erased') present.SPEC = null;
  if (variant === 'unseen-id') present['PART ID'] = 'PL-541';
  const fieldMatches = Object.entries(present).map(([name, target]) => {
    const matches = obs.text.split('\n').map(line => line.trim()).filter(line => line.startsWith(name + ':'));
    const actual = matches.length === 1 ? matches[0].slice(name.length + 1).trim() : null;
    return {name, target, actual, exact: actual === target && matches.length <= 1};
  });
  const available = new Set(obs.holes.map((h, i) => i));
  let hit = 0;
  const factor = variant === 'downsample-60' ? 0.6 : 1;
  const dx = variant === 'shifted' ? 5 : 0, dy = variant === 'shifted' ? -4 : 0;
  const centres = variant === 'hole-erased' ? truth.centres.slice(1) : truth.centres;
  for (const [x,y] of centres) {
    const match = [...available].find(i => Math.hypot(obs.holes[i].x - (x * factor + dx), obs.holes[i].y - (y * factor + dy)) < 3);
    if (match !== undefined) {available.delete(match); hit++;}
  }
  return {fieldMatches, matchedCentres:hit, referenceCentres:centres.length, extraCentres:available.size};
}

// Exercises six input conditions per original, always passing image pixels to the production recogniser.
async function main() {
  const server = fileServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const mobileWebKit = process.argv.includes('--webkit');
    browser = mobileWebKit
      ? await webkit.launch()
      : await chromium.launch({executablePath:process.env.CHROME_PATH || undefined});
    const page = await browser.newPage(mobileWebKit ? devices['iPhone 13'] : {});
    const origin = 'http://127.0.0.1:' + server.address().port;
    const externalRequests = [];
    await page.route('**/*', async route => {
      const dest = new URL(route.request().url());
      if (dest.protocol === 'http:' || dest.protocol === 'https:') {
        if (dest.origin !== origin) {externalRequests.push(dest.origin);return route.abort();}
      }
      return route.continue();
    });
    await page.goto(origin + '/drawing-desk/');
    const observations = {}, cases = [];
    for (const [id, truth] of Object.entries(labels)) {
      for (const variant of ['original','shifted','downsample-60','spec-erased','hole-erased','unseen-id']) {
        const output = await page.evaluate(async ({id,variant,firstHole}) => {
          const {recognizeScan} = await import('./app/vision.mjs');
          let url = 'assets/scans/' + id + '.png';
          if (variant !== 'original') {
            const im = new Image();
            im.src = url;
            await im.decode();
            const factor = variant === 'downsample-60' ? 0.6 : 1;
            const canvas = document.createElement('canvas');
            canvas.width = im.width * factor;
            canvas.height = im.height * factor;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#f9f8f2';
            ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.drawImage(im,variant === 'shifted' ? 5 : 0,variant === 'shifted' ? -4 : 0,canvas.width,canvas.height);
            if (variant === 'spec-erased') ctx.fillRect(776,411,375,50);
            if (variant === 'hole-erased') ctx.fillRect(firstHole[0]-17,firstHole[1]-17,34,34);
            if (variant === 'unseen-id') {
              ctx.fillRect(776,233,375,52);
              ctx.font = 'bold 24px sans-serif';
              ctx.fillStyle = '#2a3432';
              ctx.fillText('PART ID: PL-541',790,272);
            }
            url = canvas.toDataURL('image/png');
          }
          return recognizeScan(url);
        }, {id,variant,firstHole:truth.centres[0]});
        if (variant === 'original') observations[id] = output;
        const result = score(output,truth,variant);
        cases.push({id,variant,...result});
        console.log(id, variant, result.fieldMatches.filter(f => f.exact).length + '/5 fields',result.matchedCentres + '/' + result.referenceCentres + ' centres',result.extraCentres + ' extra');
      }
    }
    const report = {browser: browser.version(), engine:'Tesseract.js 7.0.0 LSTM English tessdata_fast 4.1.0', externalRequests, cases};
    if (process.argv.includes('--write')) {
      if (!mobileWebKit) await fs.writeFile(path.join(root,'data/observations.json'),JSON.stringify(observations,null,2) + '\n');
      const reportName = mobileWebKit ? 'tests/vision-webkit.json' : 'tests/vision-benchmark.json';
      await fs.writeFile(path.join(root,reportName),JSON.stringify(report,null,2) + '\n');
    }
    if (externalRequests.length) throw Error('Unexpected external request: ' + externalRequests.join(', '));
    if (cases.some(c => c.variant === 'original' && (!c.fieldMatches.every(f=>f.exact) || c.extraCentres || c.referenceCentres !== c.matchedCentres))) {
      throw Error('Baseline recognition does not match fixture labels');
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
