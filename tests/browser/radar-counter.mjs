/* Native radar frame, content geometry and real pointer/Tab input in both stages. */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.RADAR_OUT||'/tmp/nano-radar-counter';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 if(pathname==='/src/render.js'&&process.env.RADAR_COUNTER_RENDER){res.writeHead(200,{'content-type':'text/javascript'});fs.createReadStream(process.env.RADAR_COUNTER_RENDER).pipe(res);return;}
 const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.css':'text/css','.json':'application/json','.ogg':'audio/ogg'};
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
 const evidence=[];
 for(const [stage,video,cases]of [['mirkwood','00001',[[60,0],[74,4]]],['mirkwooddeep','00002',[[10.5,0],[15.5,0],[25.5,7],[40,8],[60,14]]]]) {
  await page.goto(process.env.RADAR_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());
  if(stage==='mirkwooddeep')await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!window.nanoDnf.getProgress().regionOpen&&!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getState().stage.id),stage);
  await page.keyboard.press('p');await page.evaluate(()=>{const render=window.DNFRender.render;window.DNFRender.render=(ctx,s,meta)=>render(ctx,s,{...meta,paused:false});});
  const references=cases.map(([time,kills])=>({time,kills,data:fs.readFileSync(path.join(root,`docs/reference-evidence/107-${video}-${time}-radar-reference.png`)).toString('base64')}));
  const native=fs.readFileSync(path.join(root,'assets/minimap.png')).toString('base64');
  const opacity=JSON.parse(fs.readFileSync(path.join(root,'docs/reference-evidence/107-radar-measurement.json'))).entryFade.adoptedBlackOpacity;
  const rows=await page.evaluate(async({references,native,opacity,stage})=>{
   const bitmap=async(b64,raw)=>createImageBitmap(await(await fetch('data:image/png;base64,'+b64)).blob(),raw?{colorSpaceConversion:'none'}:{});
   const context=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d');};
   const atlas=await bitmap(native,false),actual=document.querySelector('#stage').getContext('2d'),rows=[];
   const glyphs=[[443,11],[458,7],[469,11],[484,11],[499,11],[514,11],[529,11],[544,11],[559,11],[574,11]];
   for(const r of references) {
    const state=window.nanoDnf.getState();state.stats.kills=r.kills;state.transition=(stage==='mirkwooddeep'&&r.time===10.5?opacity:0)*window.DNFCore.TRANSITION.dur;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const ref=context(150,150);ref.drawImage(await bitmap(r.data,true),0,0);
    const bag=context(32,31);bag.drawImage(atlas,385,18,54,23,2.75,2,54*1.125,23*1.125);
    const digits=context(28,11),text=String(r.kills);let width=text.length-1;
    for(const d of text)width+=glyphs[Number(d)][1];let x=645.625-width*1.125;
    for(const d of text){const [sx,w]=glyphs[Number(d)];digits.drawImage(atlas,sx,18,w,13,x-620,32.5-38,w*1.125,13*1.125);x+=(w+1)*1.125;}
    for(const [part,x,y,w,h,mask,minPixels]of [['bag',589,25,32,31,bag.getImageData(0,0,32,31).data,500],['digits-lower',620,38,28,11,digits.getImageData(0,0,28,11).data,40]]) {
     const refPixels=ref.getImageData(x-570,y,w,h).data,live=actual.getImageData(x+120,y,w,h).data;let dot=0,a2=0,b2=0,pixels=0;
     for(let i=0;i<mask.length;i+=4){if(mask[i+3]<=220)continue;pixels++;for(let k=0;k<3;k++){dot+=refPixels[i+k]*live[i+k];a2+=refPixels[i+k]**2;b2+=live[i+k]**2;}}
     rows.push({stage,time:r.time,kills:r.kills,part,cosine:dot/Math.sqrt(a2*b2),pixels,minPixels,threshold:.97,translation:[0,0]});
    }
   }
   return rows;
  },{references,native,opacity,stage});
  evidence.push(...rows);
  await page.evaluate(()=>{const s=window.nanoDnf.getState();s.transition=0;s.stats.kills=0;const e=s.enemies.find(e=>e.hp>0);window.DNFCore.damageEnemy(s,e,999999,0,s.player.x);window.DNFCore.damageEnemy(s,e,999999,0,s.player.x);});
  assert.equal(await page.evaluate(()=>window.nanoDnf.getState().stats.kills),1,'one real enemy death counts once despite a repeat hit');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'window');
  if(stage==='mirkwood') {
   const reference=fs.readFileSync(path.join(root,'docs/reference-evidence/108-00001-76-map-reference.png')).toString('base64');
   const row=await page.evaluate(async({reference,native})=>{
    const bitmap=async(b64,raw)=>createImageBitmap(await(await fetch('data:image/png;base64,'+b64)).blob(),raw?{colorSpaceConversion:'none'}:{});
    const context=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d');};
    const ref=context(150,160);ref.drawImage(await bitmap(reference,true),0,0);
    const mask=context(24,31);mask.drawImage(await bitmap(native,false),385,18,54,23,2.75,2,54*1.125,23*1.125);
    const a=document.querySelector('#stage').getContext('2d').getImageData(120+589,25,24,31).data,r=ref.getImageData(589-570,25,24,31).data,m=mask.getImageData(0,0,24,31).data;
    let dot=0,a2=0,b2=0,pixels=0;for(let i=0;i<m.length;i+=4){if(m[i+3]<=220)continue;pixels++;for(let k=0;k<3;k++){dot+=a[i+k]*r[i+k];a2+=a[i+k]**2;b2+=r[i+k]**2;}}
    return {part:'bag-window-left',cosine:dot/Math.sqrt(a2*b2),pixels,minPixels:350,threshold:.97,translation:[0,0]};
   },{reference,native});evidence.push({stage,time:76,...row});
  }
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'radar');
 }
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({evidence,realDeathOnce:true,errors},null,2)+'\n');
 assert.deepEqual(errors,[]);for(const r of evidence){assert.ok(r.pixels>=r.minPixels,JSON.stringify(r));assert.ok(r.cosine>=r.threshold,JSON.stringify(r));}
 console.log('native radar counter pixels + real death once OK',Math.min(...evidence.map(r=>r.cosine)));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
