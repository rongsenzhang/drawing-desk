const {webkit,devices}=require('playwright');
const fs=require('node:fs/promises'), assert=require('node:assert/strict');
(async()=>{
 if (!process.argv.includes('--send')) throw Error('Use --send to make one paid request for the supplied synthetic PDF page.');
 const url='https://rongsenzhang.github.io/drawing-desk/upload.html?release=1.0';
 const browser=await webkit.launch();
 try{
  const context=await browser.newContext(devices['iPhone 13']);
  const p=await context.newPage();const errors=[],posts=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST')posts.push(r.url())});
  await p.goto(url,{waitUntil:'networkidle'});
  await p.locator('#image-file').setInputFiles('tests/pdf-fixtures/workshop-label-pages.pdf');
  await p.locator('#pdf-page').waitFor();await p.locator('#pdf-page').selectOption('2');
  await p.waitForFunction(()=>document.querySelector('#preview')?.complete && !document.querySelector('#run-model')?.disabled && document.querySelector('#pdf-page')?.value==='2',null,{timeout:15000});
  assert.equal(posts.length,0);
  const promise=p.waitForResponse(r=>r.url().includes('/api/read')&&r.request().method()==='POST',{timeout:120000});
  await p.getByRole('button',{name:'Send to OpenAI'}).click();
  const resp=await promise;const result=await resp.json();if(!resp.ok())throw Error(resp.status()+' '+result.error);
  const prepared=JSON.parse(resp.request().postData()).image;
  assert.ok(prepared.startsWith('data:image/jpeg;base64,'));
  const expected={partId:'CARD-386',revision:'F',material:'VINYL',finish:'GLOSS',spec:'CARD-72'};
  const fields=result.fields.map(f=>({key:f.key,expected:expected[f.key],value:f.value,status:f.status,exact:f.status==='read'&&f.value===expected[f.key],box:f.box,evidence:f.evidence}));
  await p.locator('#model-status').filter({hasText:/complete|received|finished|read/i}).waitFor({timeout:3000}).catch(()=>{});
  assert.equal(errors.length,0);
  const report={url,input:'tests/pdf-fixtures/workshop-label-pages.pdf',page:2,browser:'WebKit '+browser.version(),emulation:'iPhone 13',requestInput:'JPEG raster of the selected page only',postsBeforeConfirmation:0,requests:posts.length,model:result.model,readAt:result.readAt,exact:fields.filter(x=>x.exact).length,total:fields.length,fields};
  await fs.writeFile('tests/openai-pdf-e2e.json',JSON.stringify(report,null,2)+'\n');console.log(report.exact+'/'+report.total,report.model,fields.map(f=>f.value).join(','));
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
