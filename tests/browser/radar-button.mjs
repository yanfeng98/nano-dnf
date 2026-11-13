/* Native radar frame, content geometry and real pointer/Tab input in both stages. */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.RADAR_OUT||'/tmp/nano-radar-button';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 if(pathname==='/src/render.js'&&process.env.RADAR_BUTTON_RENDER){res.writeHead(200,{'content-type':'text/javascript'});fs.createReadStream(process.env.RADAR_BUTTON_RENDER).pipe(res);return;}
 const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.css':'text/css','.json':'application/json','.ogg':'audio/ogg'};
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[],evidence=[],inputs=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
 for(const [stage,video,times]of [['mirkwood','00001',[60,74]],['mirkwooddeep','00002',[10.5,15.5,25.5,40,60]]]) {
  await page.goto(process.env.RADAR_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());
  if(stage==='mirkwooddeep')await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!window.nanoDnf.getProgress().regionOpen&&!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getState().stage.id),stage);
  await page.keyboard.press('p');await page.evaluate(()=>{const render=window.DNFRender.render;window.DNFRender.render=(ctx,s,meta)=>render(ctx,s,{...meta,paused:false});});
  const references=times.map(time=>({time,data:fs.readFileSync(path.join(root,`docs/reference-evidence/107-${video}-${time}-radar-reference.png`)).toString('base64')})),native=fs.readFileSync(path.join(root,'assets/minimap.png')).toString('base64');
  const opacity=JSON.parse(fs.readFileSync(path.join(root,'docs/reference-evidence/107-radar-measurement.json'))).entryFade.adoptedBlackOpacity;
  const rows=await page.evaluate(async({references,native,opacity,stage})=>{
   const bitmap=async(b64,raw)=>createImageBitmap(await(await fetch('data:image/png;base64,'+b64)).blob(),raw?{colorSpaceConversion:'none'}:{});
   const context=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d');};
   const source=await bitmap(native,false),mask=context(36,16);mask.drawImage(source,589,18,24,24,4.5,-14.25,27,27);const m=mask.getImageData(0,0,36,16).data,rows=[];
   for(const r of references){window.nanoDnf.getState().transition=(stage==='mirkwooddeep'&&r.time===10.5?opacity:0)*window.DNFCore.TRANSITION.dur;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const ref=context(150,150);ref.drawImage(await bitmap(r.data,true),0,0);const a=document.querySelector('#stage').getContext('2d').getImageData(120+676,40,36,16).data,b=ref.getImageData(676-570,40,36,16).data;
    let dot=0,a2=0,b2=0,pixels=0;for(let i=0;i<m.length;i+=4){if(m[i+3]<=220)continue;pixels++;for(let k=0;k<3;k++){dot+=a[i+k]*b[i+k];a2+=a[i+k]**2;b2+=b[i+k]**2;}}
    rows.push({stage,time:r.time,part:'button-lower',roi:[676,40,36,16],cosine:dot/Math.sqrt(a2*b2),pixels,minPixels:200,threshold:.97,translation:[0,0]});
   }return rows;
  },{references,native,opacity,stage});evidence.push(...rows);
  await page.evaluate(()=>window.nanoDnf.getState().transition=0);await page.waitForTimeout(50);
  const box=await page.locator('#stage').boundingBox(),click=async(x,y)=>page.mouse.click(box.x+x/960*box.width,box.y+y/540*box.height);
  await click(120+681.5,26.75);const corner=await page.evaluate(()=>window.nanoDnf.getMap().mode);
  await click(120+694,39.25);const centre=await page.evaluate(()=>window.nanoDnf.getMap().mode);
  if(centre==='window')await page.keyboard.press('Tab');
  inputs.push({stage,corner,centre,afterTab:await page.evaluate(()=>window.nanoDnf.getMap().mode)});
 }
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({evidence,inputs,errors},null,2)+'\n');assert.deepEqual(errors,[]);
 for(const r of evidence){assert.ok(r.pixels>=r.minPixels,JSON.stringify(r));assert.ok(r.cosine>=r.threshold,JSON.stringify(r));}
 for(const r of inputs){assert.equal(r.corner,'radar');assert.equal(r.centre,'window');assert.equal(r.afterTab,'radar');}
 console.log('native radar button lower pixels + circle hit/input OK',Math.min(...evidence.map(r=>r.cosine)));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
