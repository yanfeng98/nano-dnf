// Deterministic real-renderer frames, for comparison with the recording/baseline.
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const root=process.env.GAME_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.env.WAVE_OUT || '/tmp/nano-wave-capture';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 const ext=path.extname(file),mime={'.js':'text/javascript','.png':'image/png','.json':'application/json','.ogg':'audio/ogg','.html':'text/html'};
 res.writeHead(200,{'content-type':mime[ext]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
 await page.goto(`http://127.0.0.1:${server.address().port}/?seed=1`);
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());
 await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>{const a=window.nanoDnf,s=a.getState();return !s.intro&&s.transition<=0&&!a.getProgress().regionOpen&&!a.getTown().open;});
 await page.keyboard.press('p');
 await page.evaluate(()=>{
  const render=window.DNFRender.render;
  window.DNFRender.render=(ctx,s,m)=>{window.captureMeta=m;return render(ctx,s,m);};
 });
 await page.waitForTimeout(100);
 const snapshots=await page.evaluate((gains)=>{
  const C=window.DNFCore,R=window.DNFRender,initial=structuredClone(window.nanoDnf.getState());
  const result=[];
  for(const facing of [-1,1]) for(const frames of [2,6,10,14,18,22,28,36,48]) {
   const s=structuredClone(initial),p=s.player;
   s.enemies=[];s.props=[];s.effects=[];s.pickups=[];s.shots=[];s.hitStop=0;
   p.x=200;p.z=0;p.y=C.ARENA.groundY;p.facing=facing;p.invuln=p.solidInvuln=10;
   C.step(s,{skills:{normalWave:true}});
   for(let n=0;n<frames;n++){s.enemies=[];s.props=[];C.step(s,{});s.effects=[];s.pickups=[];}
   const c=document.createElement('canvas');c.width=960;c.height=540;
   R.render(c.getContext('2d'),s,{...window.captureMeta,paused:false});
   result.push({facing,frames,elapsed:frames/60,frame:R.playerFrame(s,p),skillTimer:p.skillTimer,
    shots:s.shots.map(q=>({x:q.x,age:q.maxLife-q.life})),url:c.toDataURL('image/png')});
   if(gains && facing===1 && frames===18) {
    const saved=R.EFFECT.castingStarGain;
    for(const gain of [1,2,2.25,2.4,2.5,2.75,3]) {
     R.EFFECT.castingStarGain=gain;
     R.render(c.getContext('2d'),s,{...window.captureMeta,paused:false});
     result.push({facing,frames,gain,url:c.toDataURL('image/png')});
    }
    R.EFFECT.castingStarGain=saved;
   }
  }
  return result;
 },Boolean(process.env.WAVE_GAINS));
 for(const s of snapshots){fs.writeFileSync(path.join(out,`${s.facing}-${s.frames}${s.gain?"-gain"+s.gain:""}.png`),Buffer.from(s.url.split(',')[1],'base64'));delete s.url;}
 fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify(snapshots,null,2));
 console.log(`${snapshots.length} deterministic frames -> ${out}`);
} finally {await browser?.close();await new Promise(r=>server.close(r));}
