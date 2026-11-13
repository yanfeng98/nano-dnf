/* Native radar frame, content geometry and real pointer/Tab input in both stages. */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.RADAR_OUT||'/tmp/nano-radar-reference';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.css':'text/css','.json':'application/json','.ogg':'audio/ogg'};
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
 const evidence=[];
 for(const [stage,video,times]of [['mirkwood','00001',[60,74]],['mirkwooddeep','00002',[10.5,15.5,25.5,40,60,72.5]]]) {
  await page.goto(process.env.RADAR_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());
  if(stage==='mirkwooddeep')await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!window.nanoDnf.getProgress().regionOpen&&!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getState().stage.id),stage);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'radar','fresh entry starts in radar as the recordings do');
  await page.keyboard.press('p');
  await page.evaluate(()=>{const render=window.DNFRender.render;window.DNFRender.render=(ctx,s,meta)=>render(ctx,s,{...meta,paused:false});});
  if(process.env.RADAR_PROBE_TOP!==undefined)await page.evaluate(top=>{const m=window.DNFRender.MINIMAP,dy=top-m.radarTop;m.radarTop=top;m.radarContentOffset[1]-=dy;m.radarBackgroundBox[1]-=dy;},Number(process.env.RADAR_PROBE_TOP));
  await page.waitForTimeout(100);await page.locator('#stage').screenshot({path:path.join(out,stage+'.png')});
  const references=Object.fromEntries(times.map(t=>[t,fs.readFileSync(path.join(root,`docs/reference-evidence/107-${video}-${t}-radar-reference.png`)).toString('base64')]));
  const native=fs.readFileSync(path.join(root,'assets/minimap.png')).toString('base64');
  const entryFade=JSON.parse(fs.readFileSync(path.join(root,'docs/reference-evidence/107-radar-measurement.json'))).entryFade;
  const metrics=await page.evaluate(async({references,native,stage,entryFade})=>{
   const bitmap=async(b64,raw)=>raw?createImageBitmap(await(await fetch('data:image/png;base64,'+b64)).blob(),{colorSpaceConversion:'none'}):new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='data:image/png;base64,'+b64;});
   const context=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d');};
   const atlas=await bitmap(native,false),actual=document.querySelector('#stage').getContext('2d'),results=[];
   const ring=context(117,117);ring.drawImage(atlas,82,18,104,104,0,0,117,117);
   const marker=context(16,21);marker.drawImage(atlas,64,18,14,19,.25,-.25,16,21);
   const tile=context(20,20);tile.drawImage(atlas,252,0,18,18,0,0,20,20);
   for(const [time,data]of Object.entries(references)) {
    const opacity=stage==='mirkwooddeep'&&Number(time)===entryFade.time?entryFade.adoptedBlackOpacity:0;
    window.nanoDnf.getState().transition=opacity*window.DNFCore.TRANSITION.dur;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const ref=context(150,150);ref.drawImage(await bitmap(data,true),0,0);
    const cases=[['lower-ring',594,85,117,56,ring.getImageData(0,61,117,56).data,500],['player-marker',649,70,16,21,marker.getImageData(0,0,16,21).data,40]];
    if(stage==='mirkwooddeep'&&[15.5,25.5].includes(Number(time)))cases.push(['neighbor-tile',646,51,20,20,tile.getImageData(0,0,20,20).data,350]);
    for(const [label,x,y,w,h,mask,minPixels]of cases) {
     const r=ref.getImageData(x-570,y,w,h).data;let best={cosine:-1};
     for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++) {
      const a=actual.getImageData(x+120+dx,y+dy,w,h).data;let dot=0,a2=0,b2=0,pixels=0;
      for(let i=0;i<mask.length;i+=4){if(mask[i+3]<=220)continue;pixels++;for(let k=0;k<3;k++){dot+=r[i+k]*a[i+k];a2+=r[i+k]**2;b2+=a[i+k]**2;}}
      const cosine=dot/Math.sqrt(a2*b2);if(cosine>best.cosine)best={cosine,dx,dy,pixels};
     }
     results.push({stage,time:Number(time),label,frameTop:window.DNFRender.MINIMAP.radarTop,referenceBlackOpacity:opacity,minPixels,threshold:.97,...best});
    }
   }
   return results;
  },{references,native,stage,entryFade});
  fs.writeFileSync(path.join(out,stage+'-comparison.json'),JSON.stringify(metrics,null,2)+'\n');
  for(const m of metrics){assert.ok(m.pixels>=m.minPixels,JSON.stringify(m));assert.ok(m.cosine>=m.threshold,JSON.stringify(m));}
  const box=await page.locator('#stage').boundingBox();
  const click=async(x,y)=>page.mouse.click(box.x+x/960*box.width,box.y+y/540*box.height);
  const cx=120+594+54.5*1.125,cy=23.5+49.5*1.125;
  await click(cx+60,cy);assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'radar','outside the visible radar is not a map click');
  await click(cx+50,cy);assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'window','the scaled visible rim answers real pointer input');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>window.nanoDnf.getMap().mode),'radar','Tab restores radar');
  evidence.push({stage,metrics,pointerOutside:'unchanged',pointerRim:'window',tab:'radar'});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({evidence,errors},null,2)+'\n');
 console.log('both-stage native radar pixels + pointer/Tab OK',JSON.stringify(evidence.map(e=>({stage:e.stage,minimumCosine:Math.min(...e.metrics.map(m=>m.cosine))}))));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
