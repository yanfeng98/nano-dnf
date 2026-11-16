// Real Core emissions, loaded bitmap, isolated visible projectile/clock checks.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.FIRE_OUT||'/tmp/nano159-fire-browser';fs.mkdirSync(out,{recursive:true});

const server=http.createServer((request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end();return;}
 const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json','.ogg':'audio/ogg','.css':'text/css'};
 response.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(response);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(process.env.FIRE_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0);await page.keyboard.press('p');
 await page.evaluate(()=>{
  const s=window.nanoDnf.getState(),C=window.DNFCore;s.intro=null;s.titleT=s.transition=0;s.target=null;s.props=[];
  s.room.pendingWave=[];s.room.pendingWaves=[];s.player.x=500;s.camera.x=500-250/C.CAMERA.zoom;
  const original=window.DNFRender.render;
  window.DNFRender.render=(ctx,state,meta)=>{
   const draw=ctx.drawImage;window.fireDraws=[];
   ctx.drawImage=function(...args){
    if(args[0]===meta.sprites.goblinFire){
     const m=this.getTransform();
     window.fireDraws.push({src:args[0].src,source:args.slice(1,5),
      screenWidth:args[7]*Math.hypot(m.a,m.b),facing:Math.sign(m.a*m.d-m.b*m.c),alpha:this.globalAlpha,x:m.e,y:m.f});
    }
    return draw.apply(this,args);
   };
   try{return original(ctx,state,{...meta,paused:false});}finally{ctx.drawImage=draw;}
  };
 });


 const emissions=[],samples=[],flights=[];
 for(const type of ['goblinRed','cursedRed'])for(const facing of [-1,1]){
  const emission=await page.evaluate(({type,facing})=>{
   const C=window.DNFCore,s=window.nanoDnf.getState(),e=C.createEnemy(s,type,500);
   s.enemies=[e];s.projectiles=[];s.hitStop=0;s.player.x=e.x+facing*150;s.player.invuln=Infinity;
   e.z=s.player.z;e.attackCooldown=0;
   for(let i=0;i<60&&!s.projectiles.length;i++)C.step(s,{});
   const q=s.projectiles[0];if(!q)return {count:0};
   const age=q.maxLife-q.life,scale=(C.VIEW.width/640)/C.CAMERA.zoom;
   window.fireBirth={...q,x:q.x-q.vx*age,y:q.y-q.vy*age+q.gravity*age*age/2,
    vy:q.vy-q.gravity*age,life:q.maxLife,traveled:0};
   const result={type,count:s.projectiles.length,nativeObject:q.nativeObject,maxLife:q.maxLife,
    facing:e.facing,kind:e.attackKind,hitDone:e.attackHitDone,
    sourceX:(window.fireBirth.x-e.x)/scale,sourceHeight:(e.y-window.fireBirth.y)/scale};
   s.enemies=[];s.player.x=10000;return result;
  },{type,facing});
  fs.writeFileSync(path.join(out,'latest-emission.json'),JSON.stringify(emission,null,2)+'\n');
  assert.equal(emission.count,1);assert.equal(emission.nativeObject,30047);assert.equal(emission.maxLife,3);
  assert.equal(emission.facing,facing);assert.equal(emission.kind,'shoot');assert.ok(emission.hitDone);
  assert.ok(Math.abs(emission.sourceX-facing*20)<1e-8);assert.ok(Math.abs(emission.sourceHeight-60)<1e-8);emissions.push(emission);
  for(const age of [0,.1,.25,.3,.4]){
   await page.evaluate(age=>{
    const C=window.DNFCore,s=window.nanoDnf.getState();s.projectiles=[{...window.fireBirth}];s.time=1234;
    C.updateProjectiles(s,age);
   },age);
   await page.waitForTimeout(80);const draws=await page.evaluate(()=>window.fireDraws);
   const births=[];for(let n=0;n<=Math.floor((age+1e-7)/.02);n++)if(age-n*.02<.35-1e-7)births.push(n);
   fs.writeFileSync(path.join(out,'latest-sample.json'),JSON.stringify({type,facing,age,draws},null,2)+'\n');
   assert.equal(draws.length,births.length);
   draws.forEach((draw,i)=>{
    const particleAge=age-births[i]*.02,frame=particleAge<.23?0:1;
    assert.ok(draw.src.endsWith('/assets/goblin-fire.png'));assert.deepEqual(draw.source,[frame*128,0,128,128]);
    assert.equal(draw.facing,facing);assert.ok(Math.abs(draw.screenWidth-100.8)<1e-4);
    assert.ok(Math.abs(draw.alpha-(frame===0?1:100/255))<1e-6);
    assert.ok(draw.x>20&&draw.x<700&&draw.y>20&&draw.y<460,'fire source in view');
   });
   samples.push({type,facing,age,draws});if(age===.3)await page.screenshot({path:path.join(out,`${type}-${facing}-trail.png`)});
  }
  const before=await page.evaluate(()=>({draw:window.fireDraws,life:window.nanoDnf.getState().projectiles[0].life}));
  await page.waitForTimeout(180);const after=await page.evaluate(()=>({draw:window.fireDraws,life:window.nanoDnf.getState().projectiles[0].life}));assert.deepEqual(after,before);
  const flight=await page.evaluate(()=>{
   const C=window.DNFCore,s=window.nanoDnf.getState();s.projectiles=[{...window.fireBirth}];const q=s.projectiles[0],start={x:q.x,y:q.y,vy:q.vy};
   for(let i=0;i<18;i++)C.updateProjectiles(s,C.DT);
   return {screenSpeed:Math.abs(q.x-start.x)*C.CAMERA.zoom/.3,screenGravity:q.gravity*C.CAMERA.zoom,
    analyticalError:Math.abs(q.y-start.y-start.vy*.3-q.gravity*.3*.3/2),remaining:s.projectiles.length};
  });
  assert.ok(Math.abs(flight.screenSpeed-337.5)<1e-8);assert.ok(Math.abs(flight.screenGravity-225)<1e-8);
  assert.ok(flight.analyticalError<1e-8);assert.equal(flight.remaining,1);flights.push({type,facing,...flight});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({url:page.url(),emissions,samples,flights,errors,
  limits:['Natural fire emission, primary trail bitmaps, clock and measured-compatible constant gravity checked.','Trail cadence/lifetime use candidate PTL declarations; parent-child binding, other variants/light particles, blend/interpolation/rotation and landing are not fully calibrated.','Launch10deg is a native-angle interpretation, not an independently measured unique launch angle.','AI spacing/cadence and collision remain provisional.']},null,2)+'\n');
 console.log('four natural fire emissions, twenty main-trail samples, ballistic flight and pause OK');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
