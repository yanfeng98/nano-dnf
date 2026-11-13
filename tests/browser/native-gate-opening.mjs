/* Real clear event -> native leaf fade, paused clock, revisit and keyboard exit. */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.NATIVE_GATE_OUT||'/tmp/nano-native-gate-opening';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.css':'text/css','.json':'application/json','.ogg':'audio/ogg'};
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
 await page.goto(process.env.NATIVE_GATE_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());
 await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.nanoDnf.getState().stage.id==='mirkwooddeep'&&!window.nanoDnf.getState().intro);
 await page.keyboard.press('p');
 await page.evaluate(()=>{
  const render=window.DNFRender.render;window.DNFRender.render=(ctx,s,meta)=>render(ctx,s,{...meta,paused:false});
  const C=window.DNFCore,s=window.nanoDnf.getState();s.intro=null;s.transition=s.titleT=0;
  s.player.x=C.roomWidth(s)/2;s.player.z=125;s.player.invuln=999;s.player.vx=s.player.vz=0;
 });
 async function pixels(name) {
  await page.evaluate(()=>{
   const C=window.DNFCore,s=window.nanoDnf.getState();s.camera.x=791.92/C.CAMERA.zoom;
   // Stabilize the camera only; retain the real clear event and world time.
   s.effects=s.effects.filter(e=>e.kind!=='shockwave');
  });
  await page.waitForTimeout(80);
  await page.locator('#stage').screenshot({path:path.join(out,name+'.png')});
  return page.locator('#stage').evaluate(c=>Array.from(c.getContext('2d').getImageData(120+639,250,15,45).data).filter((_,i)=>i%4!==3));
 }
 const closed=await pixels('closed');
 const clear=await page.evaluate(()=>{
  const C=window.DNFCore,s=window.nanoDnf.getState();
  for(let n=0;n<1200&&!s.room.cleared;n++){
   s.enemies.slice().forEach(e=>{if(!e.dead)C.damageEnemy(s,e,99999,0,s.player.x);});C.runFrames(s,1,{});
  }
  if(!s.room.cleared)throw new Error('real damage path did not clear the entry room');
  return {time:s.time,openedAt:s.room.nativeGateOpenedAt,mode:C.exitMode(s,'E')};
 });
 assert.equal(clear.openedAt,clear.time);assert.equal(clear.mode,'open');
 const first=await pixels('first-open');
 await page.evaluate(()=>window.DNFCore.runFrames(window.nanoDnf.getState(),15,{}));
 const half=await pixels('half-open');
 const pausedAt=await page.evaluate(()=>window.nanoDnf.getState().time);
 await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.nanoDnf.getState().time),pausedAt,'paused world must not advance the leaf clock');
 await page.evaluate(()=>window.DNFCore.runFrames(window.nanoDnf.getState(),16,{}));
 const opened=await pixels('open');
 const mae=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
 const measured={clear,firstVsClosed:mae(first,closed),closedVsOpen:mae(closed,opened),halfVsPixelMixture:mae(half,closed.map((v,i)=>(v+opened[i])/2)),pausedTime:pausedAt};
 assert.ok(measured.closedVsOpen>4,'the sampled leaf must actually change visible pixels: '+JSON.stringify(measured));
 assert.ok(measured.firstVsClosed<5,'first open frame retains the leaf: '+JSON.stringify(measured));
 assert.ok(measured.halfVsPixelMixture<5,'250ms real Canvas pixels lie halfway between closed and open: '+JSON.stringify(measured));
 await page.evaluate(()=>{
  const C=window.DNFCore,s=window.nanoDnf.getState(),entry=s.cell,next=s.dungeon.cells.findIndex(c=>c.col===1&&c.row===3);
  C.goToCell(s,next);C.goToCell(s,entry);s.intro=null;s.transition=s.titleT=0;s.player.x=C.roomWidth(s)/2;
 });
 const revisit=await pixels('revisit');measured.revisitVsOpen=mae(revisit,opened);
 assert.ok(measured.revisitVsOpen<5,'a cleared revisit must not replay the leaf fade: '+JSON.stringify(measured));
 const departure=await page.evaluate(()=>{
  const C=window.DNFCore,s=window.nanoDnf.getState();C.goToCell(s,s.dungeon.cells.findIndex(c=>c.col===3&&c.row===1));
  s.entryDoor='W';s.intro=null;s.transition=s.titleT=0;s.player.invuln=999;
  s.player.x=C.roomRight(s)-C.DOOR.side-4;s.player.z=C.bandDepth(s.band)/2;s.player.vx=s.player.vz=0;
  for(let n=0;n<1200&&!s.room.cleared;n++){
   s.enemies.slice().forEach(e=>{if(!e.dead)C.damageEnemy(s,e,99999,0,s.player.x);});C.runFrames(s,1,{});
  }
  if(!s.room.cleared)throw new Error('real damage path did not clear room24');
  return {time:s.time,openedAt:s.room.nativeGateOpenedAt,room:s.room.name};
 });
 assert.equal(departure.time,departure.openedAt);
 await page.keyboard.press('p');await page.keyboard.down('ArrowRight');
 await page.waitForFunction(()=>window.nanoDnf.getState().room.name==='暗咒猫妖的林地',null,{timeout:12000});
 await page.keyboard.up('ArrowRight');
 const travel=await page.evaluate(()=>({room:window.nanoDnf.getState().room.name,time:window.nanoDnf.getState().time}));
 measured.keyboardTravel={...travel,secondsAfterClear:travel.time-departure.time};
 assert.ok(measured.keyboardTravel.secondsAfterClear<.5,'visual fade must not delay real keyboard travel');
 assert.deepEqual(errors,[]);measured.errors=errors;
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(measured,null,2)+'\n');
 console.log('native gate real Canvas clear/fade/pause/revisit + keyboard exit OK',JSON.stringify(measured));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
