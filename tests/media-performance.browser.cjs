// Run against the isolated production build on 127.0.0.1:3107 only.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript({path:path.join(__dirname,'account-review-browser-fixture.js')});
  if(process.env.TEST_VIDEO_FRAME_FALLBACK==='1')await page.addInitScript(()=>{HTMLVideoElement.prototype.requestVideoFrameCallback=undefined});
  await page.goto('http://127.0.0.1:3107/?matrix-test=media-performance');
  await page.waitForSelector('.ref-card');
  assert.equal(await page.locator('.ref-card').count(),80);
  await page.waitForSelector('.ref-card .is-frame-ready');
  const initial=await page.evaluate(()=>({
   mounted:document.querySelectorAll('.ref-card video').length,
   frames:document.querySelectorAll('.ref-card .is-frame-ready').length,
   legacy:document.querySelectorAll('.ref-card .aoh-video-poster-layer').length,
   images:[...document.querySelectorAll('.ref-card img')].map(img=>({loading:img.loading,complete:img.complete,width:img.naturalWidth})),
   paints:window.__matrixPaints,
  }));
  assert.ok(initial.mounted>0&&initial.mounted<40,JSON.stringify(initial));
  assert.equal(initial.legacy,0);assert.equal(initial.paints.text,0);assert.ok(initial.paints.image>0);
  const video=page.locator('.ref-card .is-frame-ready video').first();
  const before=await video.evaluate(v=>{
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
   const ctx=canvas.getContext('2d');ctx.drawImage(v,0,0,320,180);
   return {time:v.currentTime,paused:v.paused,controls:v.controls,pixel:[...ctx.getImageData(10,10,1,1).data]};
  });
  assert.ok(before.time>=1&&before.time<=1.5);assert.equal(before.paused,true);assert.equal(before.controls,true);
  assert.ok(before.pixel[1]>80&&before.pixel[1]>before.pixel[0]*1.5,'Frame must show the green video, not its black opening or blue poster');
  await video.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'../media-performance-desktop.png')});
  await video.evaluate(v=>v.play());
  await page.waitForFunction(()=>[...document.querySelectorAll('.ref-card video')].some(v=>!v.paused&&v.currentTime>1.6));
  await video.evaluate(v=>{v.pause();v.currentTime=.5});
  await page.waitForTimeout(350);
  assert.ok(Math.abs((await video.evaluate(v=>v.currentTime))-.5)<.1,'Manual seek must not be reset to preview time');
  await page.locator('.ref-card').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('.ref-card:last-child .is-frame-ready'));
  const after=await page.locator('.ref-card video').count();
  assert.ok(after>initial.mounted&&after<40,'Only visited/nearby videos should mount');
  await page.locator('.ref-card .ref-pencil').last().click();
  await page.waitForSelector('.edit-post-modal');
  await page.locator('.edit-post-close').click();
  assert.equal(await page.locator('.edit-post-modal').count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.locator('.ref-card').last().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'../media-performance-mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForTimeout(150);
  const still=await page.evaluate(()=>window.__matrixPaints.image);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.__matrixPaints.image),still,'Reduced motion must stop the animation');
  await page.getByRole('button',{name:'Exibir publicações em lista',exact:true}).click();
  assert.equal(await page.locator('.ref-list-row').count(),80);
  await page.locator('.ref-list-row').first().click();
  await page.waitForSelector('.ref-expanded .x-reference-preview');
  await page.getByRole('button',{name:/ADICIONAR PUBLICAÇÃO/i}).first().click();
  await page.locator('.add-publication-screen input[placeholder*="x.com"]').fill('https://x.com/test_fixture/status/999');
  await page.waitForSelector('.add-publication-screen .aoh-add-video-preview video');
  await page.waitForFunction(()=>{
   const v=document.querySelector('.aoh-add-video-preview video');
   return v&&v.readyState>=2&&Math.abs(v.currentTime-1.2)<.1&&v.style.opacity==='1';
  });
  await page.getByRole('button',{name:'Fechar janela de adicionar publicação',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({initial,before,mountedAfterScroll:after,browserErrors:errors},null,2));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
