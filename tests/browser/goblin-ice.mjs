// Real Core emissions, loaded bitmap, isolated visible projectile/clock checks.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.ICE_OUT||'/tmp/nano158-ice-browser';fs.mkdirSync(out,{recursive:true});

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
 await page.goto(process.env.ICE_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0);await page.keyboard.press('p');
 await page.evaluate(()=>{
  const s=window.nanoDnf.getState(),C=window.DNFCore;s.intro=null;s.titleT=s.transition=0;s.target=null;s.props=[];
  s.room.pendingWave=[];s.room.pendingWaves=[];s.player.x=500;s.camera.x=500-250/C.CAMERA.zoom;
  const original=window.DNFRender.render;
  window.DNFRender.render=(ctx,state,meta)=>{
   const draw=ctx.drawImage;window.iceDraws=[];
   ctx.drawImage=function(...args){
    if(args[0]===meta.sprites.goblinIce){
     const m=this.getTransform();
     window.iceDraws.push({src:args[0].src,source:args.slice(1,5),
      screenWidth:Math.abs(args[7]*m.a),facing:Math.sign(m.a),x:m.e,y:m.f});
    }
    return draw.apply(this,args);
   };
   try{return original(ctx,state,{...meta,paused:false});}finally{ctx.drawImage=draw;}
  };
 });

 const emissions=[],samples=[],flights=[];
 for(const facing of [-1,1]){
  const emission=await page.evaluate(facing=>{
   const C=window.DNFCore,s=window.nanoDnf.getState(),e=C.createEnemy(s,'goblinBlue',500);
   s.enemies=[e];s.projectiles=[];s.hitStop=0;s.player.x=e.x+facing*150;s.player.invuln=Infinity;
   e.z=s.player.z;e.attackCooldown=0; // Let actual AI select and execute its attack.
   for(let i=0;i<60&&!s.projectiles.length;i++)C.step(s,{});
   const shot=s.projectiles[0];if(!shot)return {count:0};
   const age=shot.maxLife-shot.life,scale=(C.VIEW.width/640)/C.CAMERA.zoom;
   const result={count:s.projectiles.length,nativeObject:shot.nativeObject,maxLife:shot.maxLife,
    facing:e.facing,kind:e.attackKind,hitDone:e.attackHitDone,
    sourceX:(shot.x-shot.vx*age-e.x)/scale,sourceHeight:(e.y-shot.y)/scale};
   s.enemies=[];s.player.x=10000;return result;
  },facing);
  fs.writeFileSync(path.join(out,'latest-emission.json'),JSON.stringify(emission,null,2)+'\n');
  assert.equal(emission.count,1);assert.equal(emission.nativeObject,30057);assert.equal(emission.maxLife,1.5);
  assert.equal(emission.facing,facing);assert.equal(emission.kind,'shoot');assert.ok(emission.hitDone);
  assert.ok(Math.abs(emission.sourceX-facing*20)<1e-9);assert.ok(Math.abs(emission.sourceHeight-60)<1e-9);emissions.push(emission);
  for(let frame=0;frame<8;frame++){
   await page.evaluate(frame=>{const s=window.nanoDnf.getState();s.projectiles[0].life=1.5-frame*.05;},frame);
   await page.waitForTimeout(80);const draws=await page.evaluate(()=>window.iceDraws);assert.equal(draws.length,1);
   const draw=draws[0];assert.ok(draw.src.endsWith('/assets/goblin-ice.png'));
   assert.deepEqual(draw.source,[frame*64,0,64,64]);assert.equal(draw.facing,facing);
   assert.ok(Math.abs(draw.screenWidth-72)<1e-5);assert.ok(draw.x>36&&draw.x<684&&draw.y>36&&draw.y<444,'ice in view');
   samples.push({facing,frame,...draw});if(frame===0||frame===4)await page.screenshot({path:path.join(out,`ice-${facing}-${frame}.png`)});
  }
  const before=await page.evaluate(()=>({draw:window.iceDraws,life:window.nanoDnf.getState().projectiles[0].life}));
  await page.waitForTimeout(180);const after=await page.evaluate(()=>({draw:window.iceDraws,life:window.nanoDnf.getState().projectiles[0].life}));assert.deepEqual(after,before);
  const flight=await page.evaluate(()=>{
   const C=window.DNFCore,s=window.nanoDnf.getState(),q=s.projectiles[0];q.life=q.maxLife;q.traveled=0;
   const start=q.x;for(let i=0;i<18;i++)C.updateProjectiles(s,C.DT);
   const speed=Math.abs(q.x-start)*C.CAMERA.zoom/(18*C.DT);let frames=18;
   while(s.projectiles.length&&frames<120){C.updateProjectiles(s,C.DT);frames++;}
   return {screenSpeed:speed,frames,remaining:s.projectiles.length};
  });
  assert.ok(Math.abs(flight.screenSpeed-225)<1e-8);assert.equal(flight.remaining,0);assert.ok(Math.abs(flight.frames/60-1.5)<=1/60+1e-9);flights.push({facing,...flight});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({url:page.url(),emissions,samples,flights,errors,
  limits:['Primary object identity, native frames, offset, declared X speed/lifetime and pause checked.','Z-sine, particle children, IceMissile2 semantics, collision/piercing and video timing remain open.','Current ranged spacing and cooldown are provisional.']},null,2)+'\n');
 console.log('two natural ice emissions, sixteen native frame/direction samples, flight, expiry and pause OK');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
