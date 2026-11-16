// Real menu and loaded assets, then isolated render poses; combat/AI timing is separate.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.GOBLIN_OUT || '/tmp/nano152-goblin-browser';
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end();return;}
 const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json','.ogg':'audio/ogg','.css':'text/css'};
 response.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});
 fs.createReadStream(file).pipe(response);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(process.env.GOBLIN_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0);
 await page.keyboard.press('p');
 await page.evaluate(cells=>{
  const C=window.DNFCore,s=window.nanoDnf.getState();
  C.goToCell(s,s.dungeon.cells.findIndex(c=>c.col===2&&c.row===0));
  const e=s.enemies.find(e=>e.type==='grunt');
  s.intro=null;s.transition=0;s.enemies=[e];s.target=null;s.room.pendingWave=[];s.room.pendingWaves=[];
  s.titleT=0;s.player.x=500;s.camera.x=500-250/C.CAMERA.zoom;
  e.x=500+200/C.CAMERA.zoom;e.z=s.player.z;e.facing=-1;e.attackDuration=.52;
  const original=window.DNFRender.render;
  window.DNFRender.render=(ctx,state,meta)=>{
   const draw=ctx.drawImage;window.goblinDraws=[];
   ctx.drawImage=function(...args){
    if(args[0]===meta.sprites.goblinReference){
     const b=cells[args[1]/360].bbox,m=this.getTransform();
     const points=[[b[0],b[1]],[b[2],b[3]]].map(([x,y])=>new DOMPoint(args[5]+x*args[7]/360,args[6]+y*args[8]/420).matrixTransform(m));
     window.goblinDraws.push({src:args[0].src,source:args.slice(1,5),destination:args.slice(5),size:[args[0].width,args[0].height],
      inkBounds:[Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y))]});
    }
    return draw.apply(this,args);
   };
   try{return original(ctx,state,{...meta,paused:false});}finally{ctx.drawImage=draw;}
  };
 },JSON.parse(fs.readFileSync(path.join(root,'assets/goblin-reference.json'),'utf8')).frames);
 const poses=[];
 for(const [name,time,elapsed,expected] of [['idle',0,null,0],['walk-first',0,null,11],['walk-last',.5,null,16],['attack-start',0,0,0],['attack-contact',0,.241,3],['attack-recovery',0,.4,4]]){
  await page.evaluate(({name,time,elapsed})=>{
   const s=window.nanoDnf.getState(),e=s.enemies[0];s.time=time;e.vx=name.startsWith('walk')?10:0;e.vz=0;e.knockdown=0;
   e.attackTimer=elapsed===null?0:e.attackDuration-elapsed;
  },{name,time,elapsed});
  await page.waitForTimeout(80);
  const draws=await page.evaluate(()=>window.goblinDraws);
  assert.equal(draws.length,1,`${name} renders one ordinary goblin`);
  const draw=draws[0];assert.ok(draw.src.endsWith('/assets/goblin-reference.png'));assert.deepEqual(draw.size,[6120,420]);
  assert.deepEqual(draw.source,[expected*360,0,360,420],name);
  assert.ok(draw.inkBounds[0]>=0&&draw.inkBounds[2]<=720&&draw.inkBounds[1]>=0&&draw.inkBounds[3]<480,`${name} ink is visible inside the playfield`);
  poses.push({name,...draw});await page.screenshot({path:path.join(out,name+'.png')});
 }
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({url:page.url(),poses,errors,limits:['Isolated pose fixture proves native atlas/frame selection, not attack duration, AI, physical scale or whole-play acceptance.']},null,2)+'\n');
 console.log('ordinary club goblin loaded atlas and six native pose samples OK');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
