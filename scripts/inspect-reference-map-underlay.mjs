/* Diagnose exposed native radar rim beneath the ordinary full map against exact video frames; no geometry overrides. */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.css':'text/css','.json':'application/json','.ogg':'audio/ogg'};res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const out=process.env.MAP_WINDOW_OUT||'/tmp/nano112-underlay';fs.mkdirSync(out,{recursive:true});
const frames=process.env.MAP_WINDOW_FRAMES;
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[],results=[],inputs=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
 for(const [stage,video,times,x,y]of [['mirkwood','00001',[76,100,160,220,280],594,55]]) {
  await page.goto(process.env.MAP_WINDOW_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());
  if(stage==='mirkwooddeep')await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0&&!window.nanoDnf.getProgress().regionOpen);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getState().stage.id),stage);
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'window');
  await page.keyboard.press('p');await page.evaluate(()=>{const render=window.DNFRender.render;window.DNFRender.render=(ctx,s,meta)=>render(ctx,s,{...meta,paused:false});});
  await page.waitForTimeout(100);
  await page.locator('#stage').screenshot({path:path.join(out,stage+'.png')});
  for(const time of times){
  const reference=fs.readFileSync(frames?path.join(frames,`${video}-${time}.png`):path.join(root,`docs/reference-evidence/108-${video}-${time}-map-reference.png`)).toString('base64'),atlas=fs.readFileSync(path.join(root,'assets/minimap.png')).toString('base64');
  const result=await page.evaluate(async({reference,atlas,x,y,cropped})=>{
   const blob=async b=>await(await fetch('data:image/png;base64,'+b)).blob();
   const ref=await createImageBitmap(await blob(reference),{colorSpaceConversion:'none'}),source=await createImageBitmap(await blob(atlas));
   const ctx=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d');};
   const r=ctx(720,540);r.drawImage(ref,0,0);const target=r.getImageData(cropped?x-570:x,y,18,63).data;
   const mask=ctx(18,63);mask.drawImage(source,82,18,104,104,0,-31.5,117,117);const m=mask.getImageData(0,0,18,63).data;
   const live=document.querySelector('#stage').getContext('2d');let best={cosine:-1};
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++) {
    const a=live.getImageData(x+120+dx,y+dy,18,63).data;let dot=0,a2=0,b2=0,pixels=0;
    for(let i=0;i<m.length;i+=4){if(m[i+3]<=220)continue;pixels++;for(let k=0;k<3;k++){dot+=target[i+k]*a[i+k];a2+=target[i+k]**2;b2+=a[i+k]**2;}}
    const cosine=dot/Math.sqrt(a2*b2);if(cosine>best.cosine)best={cosine,dx,dy,pixels};
   }
   return {cellRoi:[x,y,18,63],threshold:.97,...best};
  },{reference,atlas,x,y,cropped:!frames});results.push({stage,video,time,...result});
  }
  const box=await page.evaluate(()=>window.DNFRender.minimapBox({map:window.nanoDnf.getMap()}));
  const bounds=await page.locator('#stage').boundingBox();
  await page.mouse.click(bounds.x+(box.x+box.w-10)/960*bounds.width,bounds.y+(box.y+8)/540*bounds.height);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'radar');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'window');
  inputs.push({stage,windowButton:'radar',tab:'window'});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'diagnostic.json'),JSON.stringify({results,inputs,errors},null,2)+'\n');
 console.log(JSON.stringify(results));
 if(process.argv.includes('--require-match'))for(const r of results){assert.ok(r.pixels>=250,JSON.stringify(r));assert.ok(r.cosine>=r.threshold,JSON.stringify(r));}
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
