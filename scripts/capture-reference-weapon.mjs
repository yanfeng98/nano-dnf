// Controlled town poses through the real renderer, old/new atlases on one
// browser. BASELINE_ATLAS supplies the previous native bake for comparison.
import {chromium} from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseline=process.env.BASELINE_ATLAS;
if(!baseline) throw new Error('Set BASELINE_ATLAS to the previous slayer-reference.png');
const out=process.env.WEAPON_OUT || '/tmp/nano-reference-weapon-capture';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),isBaseline=url.pathname==='/__baseline_slayer.png';
 const file=isBaseline?path.resolve(baseline):path.resolve(root,'.'+url.pathname.replace(/^\/$/,'/index.html'));
 if((!isBaseline&&!file.startsWith(root+path.sep))||!fs.existsSync(file)){res.writeHead(404).end();return;}
 const mime={'.png':'image/png','.js':'text/javascript','.html':'text/html','.json':'application/json','.ogg':'audio/ogg','.css':'text/css'};
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');
 await page.evaluate(()=>{
  const original=window.DNFRender.drawTown;
  window.captureWeapon={original};
  window.DNFRender.drawTown=(ctx,meta)=>{window.captureWeapon.meta=meta;return original(ctx,meta);};
 });
 await page.waitForFunction(()=>window.captureWeapon.meta);
 const images=await page.evaluate(async()=>{
  const {original,meta}=window.captureWeapon;window.DNFRender.drawTown=original;delete window.captureWeapon;
  const old=new Image();old.src='/__baseline_slayer.png';await old.decode();const result=[];
  for(const facing of [-1,1])for(const frame of [-1,0,5]){
   const captures=[];
   for(const [label,atlas] of [['before',old],['after',meta.sprites.slayer]]){
    const c=document.createElement('canvas');c.width=960;c.height=540;const ctx=c.getContext('2d');
    original(ctx,{...meta,sprites:{...meta.sprites,slayer:atlas},town:{...meta.town,x:500,z:50,cameraX:207,
     facing,moving:frame>=0,walk:frame>=0?(frame+.5)/10:0,npcs:[],near:null,panel:null,dialogue:null}});
    captures.push({label,pixels:ctx.getImageData(0,0,960,540).data,url:c.toDataURL('image/png')});
   }
   let changed=0,x0=960,y0=540,x1=-1,y1=-1;
   for(let i=0;i<captures[0].pixels.length;i+=4){
    if(![0,1,2,3].some(k=>captures[0].pixels[i+k]!==captures[1].pixels[i+k]))continue;
    const p=i/4,x=p%960,y=Math.floor(p/960);changed++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
   }
   result.push({facing,frame,changed,box:[x0,y0,x1,y1],captures:captures.map(({label,url})=>({label,url}))});
  }
  return result;
 });
 for(const s of images){
  assert.ok(s.changed>20,'the selected atlas must visibly change the real character');
  assert.ok(s.box[0]>=270&&s.box[2]<560&&s.box[1]>=210&&s.box[3]<405,'changes stay within the controlled character area');
  for(const c of s.captures)fs.writeFileSync(path.join(out,`${c.label}-${s.facing}-${s.frame}.png`),Buffer.from(c.url.split(',')[1],'base64'));
  delete s.captures;
 }
 fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify(images,null,2));
 console.log(`weapon before/after real renderer OK: ${JSON.stringify(images)}`);
} finally {await browser?.close();await new Promise(r=>server.close(r));}
