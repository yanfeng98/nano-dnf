// Real loaded atlas and renderer with isolated poses, not an AI/timing acceptance test.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.GOBLIN_MOTION_OUT||'/tmp/nano153-goblin-motion';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end();return;}
 const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json','.ogg':'audio/ogg','.css':'text/css'};
 response.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(response);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(process.env.GOBLIN_MOTION_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0);await page.keyboard.press('p');
 await page.evaluate(()=>{
  const C=window.DNFCore,s=window.nanoDnf.getState();s.intro=null;s.titleT=s.transition=0;s.target=null;
  s.room.pendingWave=[];s.room.pendingWaves=[];s.player.x=500;s.camera.x=500-250/C.CAMERA.zoom;
  const original=window.DNFRender.render,cache=new Map();
  window.DNFRender.render=(ctx,state,meta)=>{
   const draw=ctx.drawImage;window.motionDraws=[];
   ctx.drawImage=function(...args){
    if(args[0]===meta.sprites.monsters&&args.length===9&&args[3]===360&&args[4]===420){
     const key=args.slice(1,5).join(',');let b=cache.get(key);
     if(!b){
      const cell=document.createElement('canvas');cell.width=360;cell.height=420;const c=cell.getContext('2d');
      c.drawImage(args[0],...args.slice(1,5),0,0,360,420);const pixels=c.getImageData(0,0,360,420).data;
      b=[360,420,0,0];for(let y=0;y<420;y++)for(let x=0;x<360;x++)if(pixels[(y*360+x)*4+3]){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x+1);b[3]=Math.max(b[3],y+1);}cache.set(key,b);
     }
     const m=this.getTransform(),points=[[b[0],b[1]],[b[2],b[3]]].map(([x,y])=>new DOMPoint(args[5]+x*args[7]/360,args[6]+y*args[8]/420).matrixTransform(m));
     window.motionDraws.push({src:args[0].src,source:args.slice(1,5),inkBounds:[Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y))]});
    }
    return draw.apply(this,args);
   };
   try{return original(ctx,state,{...meta,paused:false});}finally{ctx.drawImage=draw;}
  };
 });
 const poses=[];
 for(const [type,row] of [['coward',1],['goblinBlue',6],['goblinRed',7],['cursedRed',7]]){
  for(const [name,time,elapsed,expected] of [['idle',0,null,0],['walk-first',0,null,11],['walk-last',.5,null,16],['attack-start',0,0,0],['attack-contact',0,.241,3],['attack-recovery',0,.4,4],['down',0,null,9]]){
   await page.evaluate(({type,name,time,elapsed})=>{
    const C=window.DNFCore,s=window.nanoDnf.getState(),e=C.createEnemy(s,type,500+200/C.CAMERA.zoom);s.enemies=[e];
    e.z=s.player.z;e.facing=-1;e.attackDuration=.52;e.attackTimer=elapsed===null?0:.52-elapsed;
    e.vx=name.startsWith('walk')?10:0;e.vz=0;e.knockdown=name==='down'?.5:0;s.time=time;
   },{type,name,time,elapsed});
   await page.waitForTimeout(80);const draws=await page.evaluate(()=>window.motionDraws);assert.equal(draws.length,1,`${type}/${name}`);
   const draw=draws[0];assert.ok(draw.src.endsWith('/assets/monsters.png'));assert.deepEqual(draw.source,[expected*360,row*420,360,420],`${type}/${name}`);
   const b=draw.inkBounds;assert.ok(b[0]>=0&&b[2]<=720&&b[0]<b[2]&&b[1]>=0&&b[3]<480&&b[1]<b[3],`${type}/${name} visible ink`);
   poses.push({type,name,...draw});if(name==='walk-first'||name==='attack-contact')await page.screenshot({path:path.join(out,`${type}-${name}.png`)});
  }
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({url:page.url(),poses,errors,limits:['Isolated poses prove loaded atlas rows/native frame identities; absolute timing, AI and whole-play acceptance remain open.']},null,2)+'\n');
 console.log('four goblin bodies:28 visible native pose samples OK');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
