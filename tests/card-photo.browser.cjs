// Local fixture only. Tests display URLs without changing saved post data.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const failPreview of [false,true]){
   const context=await browser.newContext({viewport:{width:1440,height:900}});
   const page=await context.newPage(),requests=[],errors=[];
   const original='https://pbs.twimg.com/media/TestPhoto.jpg?name=orig';
   const preview='https://pbs.twimg.com/media/TestPhoto.jpg?name=small';
   page.on('pageerror',e=>errors.push(e.message));
   await context.route('https://pbs.twimg.com/**',route=>{
    requests.push(route.request().url());
    if(failPreview&&route.request().url()===preview)return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="680" height="680"><rect width="680" height="680" fill="#236090"/></svg>'});
   });
   await page.addInitScript({path:path.join(__dirname,'account-review-browser-fixture.js')});
   await page.addInitScript(({original})=>{
    localStorage.setItem('matrix-fixture:11111111-1111-4111-8111-111111111111',JSON.stringify({matrix_enabled:false}));
    const fetchFixture=window.fetch;
    window.fetch=async(input,init)=>{
     const response=await fetchFixture(input,init);
     const url=new URL(typeof input==='string'?input:input.url||String(input),location.href);
     if(url.origin==='http://127.0.0.1:54321'&&url.pathname.endsWith('/posts')){
      const data=await response.json();
      return new Response(JSON.stringify(Array.isArray(data)&&data.length?[{...data[0],id:1,image_urls:[original],video_url:null},{...data[0],id:2,image_urls:[original],video_url:null,counting_excluded:true}]:data),{headers:{'Content-Type':'application/json'}});
     }
     // Keep editor hydration from replacing the supplied photo with fixture SVG.
     if(url.origin===location.origin&&url.pathname==='/api/x-metrics')return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});
     return response;
    };
   },{original});
   await page.goto('http://127.0.0.1:3107/?matrix-test=media-performance&photo-only=1');
   await page.waitForSelector('.ref-card img');
   await page.waitForFunction(()=>{const i=document.querySelector('.ref-card img');return i.complete&&i.naturalWidth>0});
   assert.equal(await page.locator('.ref-card img').getAttribute('src'),failPreview?original:preview);
   assert.ok(requests.includes(preview));
   if(!failPreview)assert.ok(!requests.includes(original),'Grid must not request the original');
   await page.locator('.ref-pencil').click();
   await page.waitForSelector('.edit-post-modal .x-media-grid img');
   assert.equal(await page.locator('.edit-post-modal .x-media-grid img').getAttribute('src'),original);
   await page.locator('.edit-post-close').click();
   await page.getByRole('tab',{name:/PERÍODO ANTERIOR/}).click();
   await page.waitForSelector('.ref-card img');
   await page.waitForFunction(()=>{const i=document.querySelector('.ref-card img');return i.complete&&i.naturalWidth>0});
   assert.equal(await page.locator('.ref-card img').getAttribute('src'),failPreview?original:preview);
   await page.getByRole('button',{name:'Exibir publicações em lista',exact:true}).click();
   await page.locator('.ref-list-row').click();
   await page.waitForSelector('.ref-expanded .x-media-grid img');
   assert.equal(await page.locator('.ref-expanded .x-media-grid img').getAttribute('src'),original);
   assert.equal(await page.locator('[data-nextjs-dialog]').count(),0);
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({failPreview,currentAndPreviousCards:true,originalInEditorAndList:true,errors}));
   await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
