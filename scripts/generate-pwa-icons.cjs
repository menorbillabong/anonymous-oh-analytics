// Deterministic geometric app mark. No external images, fonts, or network requests.
const sharp=require('sharp');
const {mkdir}=require('node:fs/promises');
const {join}=require('node:path');
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#111111"/><rect x="90" y="90" width="332" height="332" rx="72" fill="#242424" stroke="#f6ad55" stroke-width="8"/><path d="M150 336V258M222 336V210M294 336V244M366 336V166" stroke="#f6ad55" stroke-width="30" stroke-linecap="round"/><path d="M150 202L218 158L282 182L350 126" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
(async()=>{const dir=join(__dirname,'../public/pwa');await mkdir(dir,{recursive:true});for(const [name,size] of [['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512],['apple-touch-icon.png',180]])await sharp(svg).resize(size,size).png().toFile(join(dir,name));})().catch(e=>{console.error(e);process.exitCode=1});
