// Real menu, ordinary second-cell deaths and credited roster; spatial/AI fidelity stays separate.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=process.env.ROSTER_OUT || '/tmp/nano149-ordinary-second-roster';
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){response.writeHead(404).end();return;}
 const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json','.ogg':'audio/ogg','.css':'text/css'};
 response.writeHead(200,{'content-type':mime[path.extname(file)] || 'application/octet-stream'});
 fs.createReadStream(file).pipe(response);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;

try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(process.env.ROSTER_URL || `http://127.0.0.1:${server.address().port}/?seed=1`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');
 await page.evaluate(()=>window.nanoDnf.leaveTown());
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.nanoDnf.getState().stage.id==='mirkwood' && !window.nanoDnf.getState().intro && window.nanoDnf.getState().transition<=0);
 await page.keyboard.press('p');
 const result=await page.evaluate(()=>{
  const C=window.DNFCore,s=window.nanoDnf.getState();
  C.goToCell(s,s.dungeon.cells.findIndex(c=>c.col===2 && c.row===0));
  s.intro=null;s.transition=0;s.player.x=C.roomWidth(s)/2;s.player.z=C.bandDepth(s.band)/2;s.player.xpToNext=100000;s.player.invuln=Infinity;
  const initialCount=s.enemies.length, initialPending=s.room.pendingWave.length+s.room.pendingWaves.flat().length;
  const start=s.player.xp,seen=new Set(),deaths=[];
  for(let f=0;f<1200 && !s.room.cleared;f++){
   for(const e of s.enemies){
    if(seen.has(e.id))continue;
    seen.add(e.id);
    const before=s.player.xp;
    for(let hit=0;hit<50 && !e.dead;hit++)C.damageEnemy(s,e,e.hp+1,0,s.player.x);
    deaths.push({type:e.type,level:e.level,configuredXP:e.xp,paidXP:s.player.xp-before,dead:e.dead});
   }
   C.step(s,{});
  }
  return {url:location.href,stage:s.stage.id,initialCount,initialPending,deaths,totalPaidXP:s.player.xp-start,cleared:s.room.cleared,victory:s.victory,pending:s.room.pendingWave.length+s.room.pendingWaves.flat().length};
 });
 fs.writeFileSync(path.join(out,'probe.json'),JSON.stringify(result,null,2)+'\n');
 assert.equal(result.stage,'mirkwood');assert.ok(result.cleared);
 assert.equal(result.initialCount,6);assert.equal(result.initialPending,0);
 assert.equal(result.pending,0);
 assert.equal(result.deaths.length,6);
 assert.equal(result.totalPaidXP,240);
 const counts={};for(const d of result.deaths)counts[d.type]=(counts[d.type]||0)+1;
 assert.deepEqual(counts,{caster:1,grunt:4,goblinRed:1});
 for(const d of result.deaths){assert.ok(d.dead);assert.equal(d.level,4);assert.equal(d.configuredXP,40);assert.equal(d.paidXP,40);}
 for(const t of ['caster','grunt','goblinRed'])assert.ok(result.deaths.some(d=>d.type===t));
 assert.deepEqual(errors,[]);
 result.errors=errors;result.limits=['Six credited deaths restored; existing positions, activation timing, AI and progression are not validated by this probe.'];
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
 await page.screenshot({path:path.join(out,'clear.png')});
 console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
