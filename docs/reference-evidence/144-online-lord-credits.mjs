import { chromium } from '/home/luyanfeng/luyanfeng/nano-dnf/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1120,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
 await page.goto('https://luyf-lemon-love.space/nano-dnf/?seed=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');
 await page.evaluate(()=>window.nanoDnf.leaveTown());
 await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.nanoDnf.getState().stage.id==='mirkwooddeep' && !window.nanoDnf.getState().intro && window.nanoDnf.getState().transition<=0);
 await page.keyboard.press('p');
 const result=await page.evaluate(()=>{
  const C=window.DNFCore,s=window.nanoDnf.getState();
  C.goToCell(s,s.dungeon.cells.findIndex(c=>c.col===4 && c.row===1));
  s.intro=null;s.transition=0;s.player.x=C.roomWidth(s)/2;s.player.z=C.bandDepth(s.band)/2;s.player.xpToNext=100000;s.player.invuln=Infinity;
  const start=s.player.xp,seen=new Set(),deaths=[];
  for(let f=0;f<1200 && !s.room.cleared;f++){
   for(const e of s.enemies){
    if(seen.has(e.id))continue;
    if(e.type==='lugaruBoss' && (s.room.pendingWave.length || s.room.pendingWaves.length || s.enemies.some(other=>other!==e && !other.dead)))continue;
    seen.add(e.id);
    const before=s.player.xp;
    for(let hit=0;hit<50 && !e.dead;hit++)C.damageEnemy(s,e,e.hp+1,0,s.player.x);
    deaths.push({type:e.type,level:e.level,configuredXP:e.xp,paidXP:s.player.xp-before,dead:e.dead});
   }
   C.step(s,{});
  }
  return {url:location.href,stage:s.stage.id,deaths,totalPaidXP:s.player.xp-start,cleared:s.room.cleared,victory:s.victory,pending:s.room.pendingWave.length+s.room.pendingWaves.flat().length};
 });
 fs.writeFileSync('/tmp/nano144-online-lord-credits-probe.json',JSON.stringify(result,null,2)+'\n');
 assert.equal(result.stage,'mirkwooddeep');assert.ok(result.cleared);
 assert.equal(result.pending,0);
 for(const d of result.deaths){assert.ok(d.dead);assert.equal(d.paidXP,d.type==='cat'?60:d.type==='lugaruBoss'?360:70);}
 for(const t of ['deepElite','throwerElite','cat','lugaruBoss'])assert.ok(result.deaths.some(d=>d.type===t));
 assert.deepEqual(errors,[]);
 result.errors=errors;result.limits=['Checks the existing partial runtime roster, not the unresolved recorded total, AI, spawn timing or progression.'];
 fs.writeFileSync('/tmp/nano144-online-lord-credits.json',JSON.stringify(result,null,2)+'\n');
 await page.screenshot({path:'/tmp/nano144-online-lord-credits.png'});
 console.log(JSON.stringify(result));
}finally{await browser.close();}
