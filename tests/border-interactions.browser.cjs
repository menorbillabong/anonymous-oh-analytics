// Isolated local fixture only; no production accounts or writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const styles=el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color,border:s.borderTopColor,shadow:s.boxShadow,transform:s.transform,outline:s.outlineStyle,height:el.getBoundingClientRect().height}};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript({path:path.join(__dirname,'account-review-browser-fixture.js')});
  await page.addInitScript(()=>localStorage.setItem('matrix-fixture:11111111-1111-4111-8111-111111111111',JSON.stringify({matrix_enabled:false})));
  await page.goto('http://127.0.0.1:3107/?matrix-test=media-performance&photo-only=1');
  await page.waitForSelector('.ref-card');
  assert.equal(await page.locator('[data-nextjs-dialog]').count(),0);
  const primary=page.locator('.hero-actions .orange-add');
  const main=await primary.first().evaluate(styles);
  assert.notEqual(main.background,'rgb(32, 32, 32)');
  for(const el of await primary.all())assert.equal((await el.evaluate(styles)).background,main.background);
  const secondary=page.locator('.hero-actions button:not(.orange-add)');
  for(const el of await secondary.all()){
   const state=await el.evaluate(styles);
   assert.equal(state.background,'rgb(32, 32, 32)');
   assert.equal(state.color,'rgb(233, 230, 225)');
  }
  const coloredButtons = [
   [primary.first(), main.background],
   [page.locator('.metrics-refresh-button'), 'rgb(36, 217, 165)'],
   [page.locator('.sheets-sync-button').first(), 'rgb(114, 182, 255)'],
   [page.locator('.sheets-adjustment-gear'), 'rgb(114, 182, 255)'],
   [page.locator('.period-action-pair button').first(), 'rgb(105, 171, 255)'],
   [page.locator('.mission-period-button'), 'rgb(105, 171, 255)'],
   [page.locator('.split-btn button').first(), 'rgb(141, 144, 153)'],
   [page.locator('.report-btn'), main.background],
  ];
  for(const [el, expected] of coloredButtons){
   await page.mouse.move(0,0);await page.waitForTimeout(220);
   const before=await el.evaluate(styles);
   await el.hover();await page.waitForTimeout(220);
   const after=await el.evaluate(styles);
   assert.equal(after.background,before.background,'No new hover background change');
   assert.equal(after.color,before.color,'Keep button text contrast');
   assert.notEqual(after.shadow,'none');
   assert.equal(after.border,expected,'Each button must light up in its own color');
   // Holding the pointer down must not restore the legacy orange shadow.
   await page.mouse.down();await page.waitForTimeout(220);
   assert.equal((await el.evaluate(styles)).shadow,after.shadow);
   await page.mouse.move(0,0);await page.mouse.up();
  }
  await page.mouse.move(0,0);await page.waitForTimeout(220);
  await page.locator('.hero-actions').screenshot({path:path.join(__dirname,'../button-harmony-desktop.png')});
  const card=page.locator('.ref-card').first();
  await card.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(220);
  const before=await card.evaluate(styles);
  await card.hover();await page.waitForTimeout(220);
  const after=await card.evaluate(styles);
  assert.equal(after.background,before.background);
  assert.equal(after.border,'rgb(84, 194, 122)','Mission green must not turn orange');
  assert.notEqual(after.shadow,'none');assert.notEqual(after.transform,'none','Existing card lift retained');
  await page.screenshot({path:path.join(__dirname,'../border-glow-desktop.png')});
  // Locally exercise alternate mission colors and disabled state without saving anything.
  await card.evaluate(el=>el.style.setProperty('--post-mission-color','#729cff'));
  await page.waitForTimeout(220);
  assert.equal((await card.evaluate(styles)).border,'rgb(114, 156, 255)');
  const refresh=page.locator('.metrics-refresh-button');
  await refresh.evaluate(el=>el.disabled=true);await refresh.hover();await page.waitForTimeout(220);
  assert.equal((await refresh.evaluate(styles)).shadow,'none');
  assert.equal((await refresh.evaluate(styles)).transform,'none');
  await refresh.evaluate(el=>el.disabled=false);
  await page.getByRole('button',{name:'Cadastrar ou alterar perfil do X',exact:true}).click();
  await page.waitForSelector('.x-handle-dialog[open]');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.locator('.ref-pencil').first().click();
  const danger=page.locator('.edit-post-actions .delete');
  await danger.hover();await page.waitForTimeout(220);
  const dangerStyle=await danger.evaluate(styles);
  assert.equal(dangerStyle.background,'rgb(48, 27, 27)');
  assert.equal(dangerStyle.color,'rgb(255, 176, 176)');
  assert.equal(dangerStyle.border,'rgb(255, 119, 119)');
  await page.locator('.edit-post-close').click();
  await refresh.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal((await refresh.evaluate(styles)).outline,'solid');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await card.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await page.setViewportSize({width:390,height:844});
  await page.locator('.hero-actions').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.locator('.hero-actions').screenshot({path:path.join(__dirname,'../button-harmony-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({primaryPalette:true,secondaryPalette:true,missionColoredEdges:true,unchangedBackground:true,existingLift:true,disabled:true,gearDialog:true,danger:true,keyboardFocus:true,reducedMotion:true,mobile:true,errors}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
