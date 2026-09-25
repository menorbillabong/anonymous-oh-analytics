// Isolated local fixture only; never authenticate against production.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript({path:path.join(__dirname,'account-review-browser-fixture.js')});
  await page.goto('http://127.0.0.1:3107/?matrix-test=media-performance');
  await page.waitForSelector('.ref-card .is-frame-ready');
  const card=page.locator('.ref-card').first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>!document.querySelector('.ref-card-grid[data-scroll-active]'));
  await card.hover();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ref-card')).transform!=='none');
  const idle=await card.evaluate(el=>({transform:getComputedStyle(el).transform,shadow:getComputedStyle(el).boxShadow}));
  assert.notEqual(idle.shadow,'none');
  await page.mouse.wheel(0,100);
  await page.waitForFunction(()=>!!document.querySelector('.ref-card-grid[data-scroll-active]'));
  const active=await card.evaluate(el=>({transform:getComputedStyle(el).transform,shadow:getComputedStyle(el).boxShadow,pointer:getComputedStyle(el.querySelector('button')).pointerEvents}));
  assert.equal(active.transform,'none');assert.equal(active.shadow,'none');assert.notEqual(active.pointer,'none');
  await page.waitForFunction(()=>!document.querySelector('.ref-card-grid[data-scroll-active]'));
  await card.hover();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ref-card')).transform!=='none');
  // Click in the suppressed interval still opens the editor (no disabled hit testing).
  await card.evaluate(el=>{
   el.dispatchEvent(new WheelEvent('wheel',{deltaY:1,bubbles:true}));
   el.querySelector('.ref-pencil').click();
  });
  await page.waitForSelector('.edit-post-modal');
  await page.locator('.edit-post-close').click();
  const video=page.locator('.ref-card .is-frame-ready video').first();
  await video.scrollIntoViewIfNeeded();
  const frame=await video.evaluate(v=>{
   const c=document.createElement('canvas');c.width=320;c.height=180;c.getContext('2d').drawImage(v,0,0,320,180);
   return {pixel:[...c.getContext('2d').getImageData(10,10,1,1).data],controls:v.controls};
  });
  assert.ok(frame.pixel[1]>80&&frame.pixel[1]>frame.pixel[0]*1.5);assert.equal(frame.controls,true);
  await video.evaluate(v=>{v.closest('.ref-card-grid').dispatchEvent(new WheelEvent('wheel',{deltaY:1}));return v.play()});
  await page.waitForFunction(()=>[...document.querySelectorAll('.ref-card video')].some(v=>!v.paused&&v.currentTime>1.6));
  await video.evaluate(v=>{v.pause();v.currentTime=.5});
  await page.waitForTimeout(350);
  assert.ok(Math.abs(await video.evaluate(v=>v.currentTime)-.5)<.1);
  await page.screenshot({path:path.join(__dirname,'../card-scroll-verified.png')});
  await page.getByRole('button',{name:'Exibir publicações em lista',exact:true}).click();
  assert.equal(await page.locator('.ref-list-row').count(),80);
  assert.equal(await page.locator('[data-scroll-active]').count(),0);
  await page.locator('.ref-list-row').first().click();
  await page.waitForSelector('.ref-expanded .x-reference-preview');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({idle,active,frame,restoration:true,editDuringSuppression:true,playAndSeek:true,list:true,errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
