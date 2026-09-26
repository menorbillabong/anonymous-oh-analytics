// Isolated local fake account; never installs software on the user's profile.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {mkdtempSync}=require('node:fs');
const {tmpdir}=require('node:os');
(async()=>{
 const context=await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(),'aoh-pwa-test-')),{channel:'chrome',headless:true,viewport:{width:1440,height:1050}});
 try{
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript({path:path.join(__dirname,'account-review-browser-fixture.js')});
  await page.goto('http://127.0.0.1:3107/?matrix-test=pwa');
  await page.getByRole('button',{name:'⚙ Configurações',exact:true}).click();
  const card=page.getByRole('region',{name:'Aplicativo no computador'});
  await card.waitFor();
  assert.ok(await page.getByRole('button',{name:'SALVAR ALTERAÇÕES',exact:true}).isVisible());
  const cdp=await context.newCDPSession(page);
  const manifest=await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors,[]);
  const data=JSON.parse(manifest.data);
  assert.equal(data.display,'standalone');assert.equal(data.start_url,'/');assert.equal(data.scope,'/');
  for(const icon of data.icons){const response=await context.request.get('http://127.0.0.1:3107'+icon.src);assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/image\/png/);const bytes=await response.body();assert.equal(bytes.readUInt32BE(16),Number(icon.sizes.split('x')[0]));}
  const eligibility=await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(eligibility.installabilityErrors,[]);
  await card.screenshot({path:path.join(__dirname,'../pwa-desktop.png')});
  // Simulated native event tests the UI's accepted/dismissed/error branches only.
  async function offer(outcome){await page.evaluate(outcome=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{if(outcome==='error')throw new Error('fixture')};e.userChoice=Promise.resolve({outcome});window.dispatchEvent(e);},outcome);}
  await offer('dismissed');await card.getByRole('button',{name:'Instalar aplicativo',exact:true}).click();await card.getByText(/Instalação cancelada/).waitFor();
  await offer('error');await card.getByRole('button',{name:'Instalar aplicativo',exact:true}).click();await card.getByText(/Não foi possível abrir/).waitFor();
  await offer('accepted');await card.getByRole('button',{name:'Instalar aplicativo',exact:true}).click();await card.getByText(/Instalação confirmada/).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
  await card.getByText('Aplicativo instalado ou aberto em janela própria.',{exact:true}).waitFor();
  assert.equal(await card.getByRole('button',{name:'Instalar aplicativo',exact:true}).count(),0);
  await context.setOffline(true);await page.getByRole('status').filter({hasText:'Sem conexão.'}).waitFor();
  await context.setOffline(false);await page.getByRole('status').filter({hasText:'Sem conexão.'}).waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
  assert.equal(await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).length),0);
  await page.setViewportSize({width:390,height:844});await card.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await card.screenshot({path:path.join(__dirname,'../pwa-mobile.png')});
  // A standalone window must not offer another installation.
  await page.addInitScript(()=>{const native=window.matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true,addEventListener(){},removeEventListener(){}}:native(q)});
  await page.reload();await page.getByRole('button',{name:'⚙ Configurações',exact:true}).click();
  await card.getByText('Aplicativo instalado ou aberto em janela própria.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({manifest:true,icons:true,chromiumInstallability:eligibility.installabilityErrors,installUiBranches:true,standalone:true,onlineWarning:true,noOfflineCache:true,mobile:true,errors}));
 }finally{await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
