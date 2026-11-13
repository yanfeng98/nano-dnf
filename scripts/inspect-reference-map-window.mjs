/* Diagnose actual window-map cells against exact video frames; no geometry overrides. */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=process.env.MAP_WINDOW_OUT||'/tmp/nano108-window';fs.mkdirSync(out,{recursive:true});
const frames=process.env.MAP_WINDOW_FRAMES||'/tmp/nano108-frames';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[],results=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
 for(const [stage,video,time,x,y]of [['mirkwood','00001',100,619,54],['mirkwooddeep','00002',277,599,95]]) {
  await page.goto(process.env.MAP_WINDOW_URL||'http://localhost:8080/?seed=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());
  if(stage==='mirkwooddeep')await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0&&!window.nanoDnf.getProgress().regionOpen);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getState().stage.id),stage);
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'window');
  await page.keyboard.press('p');await page.evaluate(()=>{const render=window.DNFRender.render;window.DNFRender.render=(ctx,s,meta)=>render(ctx,s,{...meta,paused:false});});
  await page.waitForTimeout(100);
  await page.locator('#stage').screenshot({path:path.join(out,stage+'.png')});
  const reference=fs.readFileSync(path.join(frames,`${video}-${time}.png`)).toString('base64'),atlas=fs.readFileSync('assets/minimap.png').toString('base64');
  const result=await page.evaluate(async({reference,atlas,x,y})=>{
   const blob=async b=>await(await fetch('data:image/png;base64,'+b)).blob();
   const ref=await createImageBitmap(await blob(reference),{colorSpaceConversion:'none'}),source=await createImageBitmap(await blob(atlas));
   const ctx=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d');};
   const r=ctx(720,540);r.drawImage(ref,0,0);const target=r.getImageData(x,y,20,20).data;
   const mask=ctx(20,20);mask.drawImage(source,252,0,18,18,0,0,20,20);const m=mask.getImageData(0,0,20,20).data;
   const live=document.querySelector('#stage').getContext('2d');let best={cosine:-1};
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++) {
    const a=live.getImageData(x+120+dx,y+dy,20,20).data;let dot=0,a2=0,b2=0,pixels=0;
    for(let i=0;i<m.length;i+=4){if(m[i+3]<=220)continue;pixels++;for(let k=0;k<3;k++){dot+=target[i+k]*a[i+k];a2+=target[i+k]**2;b2+=a[i+k]**2;}}
    const cosine=dot/Math.sqrt(a2*b2);if(cosine>best.cosine)best={cosine,dx,dy,pixels};
   }
   return {cellRoi:[x,y,20,20],threshold:.97,...best};
  },{reference,atlas,x,y});results.push({stage,video,time,...result});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'diagnostic.json'),JSON.stringify({results,errors},null,2)+'\n');
 console.log(JSON.stringify(results));
 if(process.argv.includes('--require-match'))for(const r of results)assert.ok(r.cosine>=r.threshold,JSON.stringify(r));
} finally {await browser.close();}
