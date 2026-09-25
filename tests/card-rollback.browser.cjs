// Isolated photo-only regression check; no live accounts or production writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript({path:path.join(__dirname,'account-review-browser-fixture.js')});
  await page.addInitScript(()=>localStorage.setItem('matrix-fixture:11111111-1111-4111-8111-111111111111',JSON.stringify({matrix_enabled:false})));
  await page.goto('http://127.0.0.1:3107/?matrix-test=media-performance&photo-only=1');
  await page.waitForSelector('.ref-card');
  assert.equal(await page.locator('.ref-card').count(),80);
  assert.equal(await page.locator('.ref-card video').count(),0);
  await page.waitForFunction(()=>[...document.querySelectorAll('.ref-card img')].every(img=>img.complete&&img.naturalWidth>0));
  await page.locator('.ref-card').first().scrollIntoViewIfNeeded();
  for(let i=0;i<5;i++){
   await page.locator('.ref-card').nth(i).hover();
   await page.waitForTimeout(220);
   assert.notEqual(await page.locator('.ref-card').nth(i).evaluate(el=>getComputedStyle(el).transform),'none');
  }
  for(let i=0;i<8;i++){
   await page.mouse.wheel(0,170);await page.waitForTimeout(220);
   assert.equal(await page.locator('[data-scroll-active]').count(),0);
  }
  await page.locator('.ref-card .ref-pencil').nth(20).click();
  await page.waitForSelector('.edit-post-modal');await page.locator('.edit-post-close').click();
  await page.getByRole('button',{name:'Exibir publicações em lista',exact:true}).click();
  assert.equal(await page.locator('.ref-list-row').count(),80);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({photos:80,videos:0,originalHover:true,scrollSuppression:false,editor:true,listRows:80,browserErrors:errors}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
