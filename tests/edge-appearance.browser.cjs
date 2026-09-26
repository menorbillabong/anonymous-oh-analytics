// Local fake account only. No production writes or X requests.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const key='matrix-fixture:11111111-1111-4111-8111-111111111111';
const css=el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,text:s.color,border:s.borderLeftColor,glow:s.getPropertyValue('--own-color-glow').trim(),shadow:s.boxShadow}};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript({path:path.join(__dirname,'account-review-browser-fixture.js')});
  await page.addInitScript(key=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({matrix_enabled:false}));},key);
  await page.goto('http://127.0.0.1:3107/?matrix-test=appearance');
  async function settings(){await page.locator('.exact-nav button').filter({hasText:'Configurações'}).click();await page.locator('#edge-glow-intensity').waitFor();}
  async function panel(){await page.locator('.exact-nav button').filter({hasText:'Painel'}).click();await page.locator('.hero-actions').waitFor();}
  async function save(){await page.getByRole('button',{name:'SALVAR ALTERAÇÕES',exact:true}).click();await page.getByText('Configurações salvas.',{exact:true}).waitFor();}
  async function intensity(value){await page.locator('#edge-glow-intensity').fill(String(value));await page.waitForFunction(value=>Math.abs(parseFloat(document.documentElement.style.getPropertyValue('--edge-glow-radius'))-12*value/50)<.001,value);await page.waitForTimeout(250);}
  async function color(value){await page.locator('#appearance-button-color').fill(value);await page.waitForFunction(value=>document.querySelector('[data-edge-glow-preview]').style.getPropertyValue('--own-color-glow')===value,value);await page.waitForTimeout(250);}
  await settings();
  assert.equal(await page.locator('#edge-glow-intensity').inputValue(),'50');
  const preview=page.locator('[data-edge-glow-preview]');
  const initial=(await preview.evaluate(css)).shadow;
  await intensity(100);assert.notEqual((await preview.evaluate(css)).shadow,initial);
  await intensity(0);assert.equal((await preview.evaluate(css)).shadow,'none');
  await intensity(85);
  await page.locator('#appearance-button').selectOption('metrics');
  await color('#9257da');
  assert.equal((await preview.evaluate(css)).background,'rgb(146, 87, 218)');
  await page.locator('#appearance-button').selectOption('sheets');await color('#000000');
  assert.equal((await preview.evaluate(css)).text,'rgb(255, 255, 255)');
  await page.locator('#appearance-button').selectOption('x');await color('#ffffff');
  assert.equal((await preview.evaluate(css)).text,'rgb(0, 0, 0)');
  await page.locator('[data-testid=edge-appearance-settings]').screenshot({path:path.join(__dirname,'../edge-appearance-desktop.png')});
  await save();await page.reload();await settings();
  assert.equal(await page.locator('#edge-glow-intensity').inputValue(),'85');
  const persisted=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  assert.equal(persisted.border_glow_intensity,85);assert.deepEqual(persisted.button_colors,{metrics:'#9257da',sheets:'#000000',x:'#ffffff'});
  await panel();
  for(const [id,expected] of [['x','rgb(255, 255, 255)'],['metrics','rgb(146, 87, 218)'],['sheets','rgb(0, 0, 0)']]){
   for(const button of await page.locator(`[data-appearance-button="${id}"]`).all()){
    await button.hover();await page.waitForTimeout(250);const state=await button.evaluate(css);
    assert.equal(state.border,expected);assert.equal(state.background,expected);assert.notEqual(state.shadow,'none');
   }
  }
  // Joined gear still opens its original dialog, with no requests caused by preview.
  await page.locator('.x-import-gear').click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Fechar',exact:true}).click();
  await settings();await intensity(0);await save();await panel();await page.locator('.metrics-refresh-button').hover();
  assert.equal((await page.locator('.metrics-refresh-button').evaluate(css)).shadow,'none');
  await settings();
  await page.getByLabel('Organização dos botões do Painel').selectOption('classic');await panel();
  assert.equal((await page.locator('.metrics-refresh-button').evaluate(css)).background,'rgb(146, 87, 218)');
  await settings();await page.getByRole('button',{name:'Restaurar todas as cores',exact:true}).click();
  await page.getByRole('button',{name:'Restaurar brilho padrão',exact:true}).click();await save();await panel();
  assert.equal((await page.locator('.metrics-refresh-button').evaluate(css)).background,'rgb(41, 219, 168)');
  // Failed save must not silently persist the preview.
  await settings();await intensity(95);await page.evaluate(()=>localStorage.setItem('matrix-fixture-fail','true'));
  await page.getByRole('button',{name:'SALVAR ALTERAÇÕES',exact:true}).click();await page.getByText('Não foi possível salvar.',{exact:true}).waitFor();
  assert.equal((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)).border_glow_intensity,50);
  await page.evaluate(()=>localStorage.removeItem('matrix-fixture-fail'));await page.reload();await settings();
  assert.equal(await page.locator('#edge-glow-intensity').inputValue(),'50');
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-testid=edge-appearance-settings]').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('[data-testid=edge-appearance-settings]').screenshot({path:path.join(__dirname,'../edge-appearance-mobile.png')});
  await page.setViewportSize({width:1440,height:1050});
  await intensity(90);await color('#123456');
  assert.equal(await page.locator('style[data-button-appearance]').count(),1);
  await page.locator('.user-pill').focus();await page.locator('.user-pill').press('Enter');
  await page.locator('.profile-menu').getByRole('button',{name:'Sair'}).click();
  await page.waitForFunction(()=>!document.querySelector('.exact-app'));
  assert.equal(await page.locator('style[data-button-appearance]').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--edge-glow-radius')),'');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({preview:true,zero:true,strong:true,saveReload:true,restore:true,contrast:true,customButtonsAndGears:true,classic:true,failure:true,mobile:true,logoutCleanup:true,errors}));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
