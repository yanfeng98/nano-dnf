// Real Core emissions, loaded bitmap, isolated visible projectile/clock checks.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.STONE_OUT||'/tmp/nano155-stone-browser';fs.mkdirSync(out,{recursive:true});
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
 await page.goto(process.env.STONE_URL||`http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!window.nanoDnf.getState().intro&&window.nanoDnf.getState().transition<=0);await page.keyboard.press('p');
 await page.evaluate(()=>{
  const s=window.nanoDnf.getState(),C=window.DNFCore;s.intro=null;s.titleT=s.transition=0;s.target=null;s.props=[];
  s.room.pendingWave=[];s.room.pendingWaves=[];s.player.x=500;s.camera.x=500-250/C.CAMERA.zoom;
  const original=window.DNFRender.render;
  window.DNFRender.render=(ctx,state,meta)=>{
   const draw=ctx.drawImage;window.stoneDraws=[];
   ctx.drawImage=function(...args){
    if(args[0]===meta.sprites.goblinStone){
     const m=this.getTransform(),points=[[8,8],[25,8],[8,25],[25,25]].map(([x,y])=>new DOMPoint(args[5]+x*args[7]/32,args[6]+y*args[8]/32).matrixTransform(m));
     window.stoneDraws.push({src:args[0].src,source:args.slice(1,5),angle:Math.atan2(m.b,m.a),cellScreenWidth:args[7]*Math.hypot(m.a,m.b),
      inkBounds:[Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y))]});
    }
    return draw.apply(this,args);
   };
   try{return original(ctx,state,{...meta,paused:false});}finally{ctx.drawImage=draw;}
  };
 });
 const emissions=[],samples=[];
 for(const type of ['caster','burningThrower']){
  const emitted=await page.evaluate(type=>{
   const C=window.DNFCore,s=window.nanoDnf.getState(),e=C.createEnemy(s,type,500+200/C.CAMERA.zoom);
   s.enemies=[e];s.projectiles=[];s.hitStop=0;s.player.invuln=Infinity;e.z=s.player.z;
   e.attackKind='shoot';e.attackTimer=e.attackDuration=.8;e.attackWindup=.5;e.attackHitDone=false;
   for(let i=0;i<40&&!s.projectiles.length;i++)C.step(s,{});
   const shot=s.projectiles[0];s.enemies=[];
   return {type,count:s.projectiles.length,nativeObject:shot?.nativeObject,hitDone:e.attackHitDone};
  },type);
  assert.equal(emitted.count,1);assert.equal(emitted.nativeObject,30001);assert.ok(emitted.hitDone);emissions.push(emitted);
  for(const age of [0,.0375,.075,.151]){
   await page.evaluate(age=>{const s=window.nanoDnf.getState();s.time=1234;s.projectiles[0].life=s.projectiles[0].maxLife-age;},age);
   await page.waitForTimeout(80);const draws=await page.evaluate(()=>window.stoneDraws);assert.equal(draws.length,1);
   const draw=draws[0];assert.ok(draw.src.endsWith('/assets/goblin-stone.png'));assert.deepEqual(draw.source,[0,0,32,32]);
   fs.writeFileSync(path.join(out,'latest-sample.json'),JSON.stringify({type,age,draw},null,2)+'\n');
   // Canvas matrices quantize transforms: observed36px as35.9999987044px.
   // Bounds remain far below one pixel; game geometry and texture are unchanged.
   const angle=((age/.15)%1)*6.28000020980835;assert.ok(Math.abs(Math.atan2(Math.sin(draw.angle-angle),Math.cos(draw.angle-angle)))<1e-6);
   assert.ok(Math.abs(draw.cellScreenWidth-36)<1e-5,`uses existing native world-plane projection: ${draw.cellScreenWidth}`);
   const b=draw.inkBounds;assert.ok(b[0]>=0&&b[2]<=720&&b[1]>=0&&b[3]<480,'native stone is visible');
   samples.push({type,age,...draw});if(age===0||age===.075)await page.screenshot({path:path.join(out,`${type}-${age}.png`)});
  }
  const before=await page.evaluate(()=>({draw:window.stoneDraws,life:window.nanoDnf.getState().projectiles[0].life}));
  await page.waitForTimeout(180);const after=await page.evaluate(()=>({draw:window.stoneDraws,life:window.nanoDnf.getState().projectiles[0].life}));assert.deepEqual(after,before,'pause freezes projectile phase and life');
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({url:page.url(),emissions,samples,errors,limits:['Isolated native bitmap/clock checks do not validate video flight size/phase, origin, trajectory, impact or damage.','Unverified captain projectile is not assigned the caster stone.']},null,2)+'\n');
 console.log('two real stone emissions, eight native bitmap/clock samples and pause stability OK');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
