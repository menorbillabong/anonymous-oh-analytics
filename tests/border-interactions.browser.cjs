// Isolated local fixture only; no production accounts or writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const styles=el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color,border:s.borderTopColor,left:s.borderLeftColor,glow:s.getPropertyValue('--own-color-glow').trim(),shadow:s.boxShadow,transform:s.transform,outline:s.outlineStyle,height:el.getBoundingClientRect().height}};
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
   primary.first(), page.locator('.metrics-refresh-button'),
   page.locator('.sheets-sync-button').first(), page.locator('.sheets-adjustment-gear'),
   page.locator('.period-action-pair button').first(), page.locator('.mission-period-button'),
   page.locator('.split-btn button').first(), page.locator('.report-btn'),
  ];
  for(const el of coloredButtons){
   await page.mouse.move(0,0);await page.waitForTimeout(220);
   const before=await el.evaluate(styles);
   await el.hover();await page.waitForTimeout(220);
   const after=await el.evaluate(styles);
   assert.equal(after.background,before.background,'No new hover background change');
   assert.equal(after.color,before.color,'Keep button text contrast');
   assert.notEqual(after.shadow,'none');
   assert.equal(after.border,before.border,'Lighting must not recolor the border');
   assert.equal(after.glow,before.left,'Glow must use the actual rendered border, not a role mapping');
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
  await page.mouse.move(0,0);await page.waitForTimeout(220);await card.hover();
  await page.waitForTimeout(220);
  assert.equal((await card.evaluate(styles)).border,'rgb(114, 156, 255)');
  assert.equal((await card.evaluate(styles)).glow,'rgb(114, 156, 255)');
  // Arbitrary colors, with no corresponding role mapping, must work immediately.
  for(const [selector,color] of [['.metrics-refresh-button','#bc51de'],['.action-group','#21c5d4'],['.exact-stat','#d35685']]){
   const element=page.locator(selector).first();
   await page.mouse.move(0,0);
   await element.evaluate((el,color)=>el.style.setProperty('border-color',color,'important'),color);
   await page.waitForTimeout(220);
   const base=await element.evaluate(styles);
   await element.hover();await page.waitForTimeout(220);
   const lit=await element.evaluate(styles);
   assert.equal(lit.glow,base.left,selector+' must follow its customized color');
   assert.equal(lit.border,base.border);
   assert.equal(lit.background,base.background);
   assert.notEqual(lit.shadow,'none');
   await element.evaluate(el=>el.style.removeProperty('border-color'));
  }
  // A borderless colored button uses its fill, not the parent's mission color.
  await card.evaluate(el=>{const b=document.createElement('button');b.id='glow-test-button';b.textContent='Glow fixture';b.style.cssText='border:0!important;background:#9257da!important;color:white!important';el.appendChild(b)});
  const borderless=page.locator('#glow-test-button');
  await borderless.hover();await page.waitForTimeout(220);
  assert.equal((await borderless.evaluate(styles)).glow,'rgb(146, 87, 218)');
  await page.mouse.move(0,0);
  await borderless.evaluate(el=>el.style.setProperty('background','#000','important'));
  await page.waitForTimeout(220);await borderless.hover();await page.waitForTimeout(220);
  assert.equal((await borderless.evaluate(styles)).glow,'rgb(0, 0, 0)','Opaque black is not transparent');
  await borderless.evaluate(el=>el.remove());
  await card.hover();await page.waitForTimeout(220);
  // Moving inside the same card (including between its children) must not resample it.
  await card.evaluate(el=>{const original=window.getComputedStyle;window.__glowCardReads=0;window.getComputedStyle=function(target,...args){if(target===el)window.__glowCardReads++;return original.call(window,target,...args)};window.__restoreGlowRead=()=>{window.getComputedStyle=original}});
  const image=card.locator('img').first();
  await image.hover();
  const rect=await image.boundingBox();
  await page.mouse.move(rect.x+10,rect.y+10,{steps:10});
  assert.equal(await page.evaluate(()=>window.__glowCardReads),0,'No repeated style reads inside the same card');
  await page.evaluate(()=>window.__restoreGlowRead());
  const refresh=page.locator('.metrics-refresh-button');
  await refresh.evaluate(el=>el.disabled=true);await refresh.hover();await page.waitForTimeout(220);
  assert.equal((await refresh.evaluate(styles)).shadow,'none');
  assert.equal((await refresh.evaluate(styles)).transform,'none');
  await refresh.evaluate(el=>el.disabled=false);
  await page.getByRole('button',{name:'Cadastrar ou alterar perfil do X',exact:true}).click();
  await page.waitForSelector('.x-handle-dialog[open]');
  const field=page.locator('.x-handle-dialog input').first();
  await field.evaluate(el=>el.style.setProperty('border-color','#b961cf','important'));
  await page.mouse.move(0,0);await page.waitForTimeout(220);
  const fieldBase=await field.evaluate(styles);
  await field.hover();await page.waitForTimeout(220);
  assert.equal((await field.evaluate(styles)).glow,fieldBase.left,'Dialog field keeps its own color');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.locator('.ref-pencil').first().click();
  const danger=page.locator('.edit-post-actions .delete');
  await danger.hover();await page.waitForTimeout(220);
  const dangerStyle=await danger.evaluate(styles);
  assert.equal(dangerStyle.background,'rgb(48, 27, 27)');
  assert.equal(dangerStyle.color,'rgb(255, 176, 176)');
  assert.equal(dangerStyle.border,'rgb(135, 71, 71)');
  assert.equal(dangerStyle.glow,dangerStyle.left);
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
  console.log(JSON.stringify({primaryPalette:true,secondaryPalette:true,actualBorderColors:true,customColors:true,borderlessFill:true,noRepeatedReads:true,dialogField:true,missionColoredEdges:true,unchangedBackground:true,existingLift:true,disabled:true,gearDialog:true,danger:true,keyboardFocus:true,reducedMotion:true,mobile:true,errors}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
