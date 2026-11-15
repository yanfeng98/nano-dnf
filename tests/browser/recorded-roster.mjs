/* Shared real-menu, transition, native target, death-credit and clear checks. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const room = process.env.ROSTER_ROOM || '42';
const probes = {
  '23': {col:2,row:1,targetType:'cat',targetLevel:6,targetWidth:162,xp:660,expected:[
    'goblinRed:6:60','goblinRed:6:60','goblinRed:6:60',
    'goblinBlue:6:60','goblinBlue:6:60','goblinBlue:6:60',
    'cat:6:60','cat:6:60','cat:6:60','cat:6:60','cat:6:60'
  ]},
  '33': {col:2,row:2,targetType:'throwerElite',targetLevel:6,targetWidth:162,xp:480,expected:[
    'goblinBlue:6:60','goblinBlue:6:60','goblinBlue:6:60',
    'goblinRed:6:60','goblinRed:6:60','goblinRed:6:60',
    'deepElite:6:60','throwerElite:6:60'
  ]},
  '42': {col:1,row:3,targetType:'cat',targetLevel:7,targetWidth:196,xp:490,expected:[
    'deepElite:6:60','deepElite:6:60','throwerElite:6:60','throwerElite:6:60','throwerElite:6:60',
    'cat:6:60','cat:6:60','cat:7:70'
  ]},
  '43': {col:2,row:3,targetType:'deepElite',targetLevel:6,targetWidth:198,xp:480,expected:[
    'goblinRed:6:60','goblinRed:6:60','goblinBlue:6:60','goblinBlue:6:60',
    'deepElite:6:60','deepElite:6:60','deepElite:6:60','throwerElite:6:60'
  ]}
};
const probe = probes[room];
assert.ok(probe, `Unsupported roster room ${room}`);
const out = process.env.ROSTER_OUT || `/tmp/nano-room${room}-roster-browser`;
fs.mkdirSync(out, {recursive:true});
const mime = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.ogg':'audio/ogg','.json':'application/json'};
const server = http.createServer((request,response)=>{
  const pathname = new URL(request.url,'http://localhost').pathname;
  const file = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200,{'content-type':mime[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1120,height:720}});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
  const url=process.env.ROSTER_URL || `http://127.0.0.1:${server.address().port}/?seed=1`;
  await page.goto(url);
  await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');
  await page.evaluate(()=>window.nanoDnf.leaveTown());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.nanoDnf.getState().stage.id==='mirkwooddeep' && !window.nanoDnf.getState().intro && window.nanoDnf.getState().transition<=0);
  await page.keyboard.press('p');
  await page.evaluate(()=>{
    const render=window.DNFRender.render;
    window.DNFRender.render=(ctx,state,meta)=>{window.rosterMeta=meta;return render(ctx,state,meta);};
  });
  await page.waitForFunction(()=>window.rosterMeta);
  const result=await page.evaluate(probe=>{
    const C=window.DNFCore,s=window.nanoDnf.getState();
    C.goToCell(s,s.dungeon.cells.findIndex(cell=>cell.col===probe.col && cell.row===probe.row));
    s.intro=null;s.transition=0;s.player.xpToNext=100000;s.player.invuln=Infinity;
    const roster=s.enemies.map(e=>({type:e.type,level:e.level,xp:e.xp}));
    const pending=s.room.pendingWave.length+s.room.pendingWaves.flat().length;
    const target=s.enemies.find(e=>e.type===probe.targetType && e.level===probe.targetLevel);
    s.target={enemy:target,dying:0,share:1};
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
    const ctx=canvas.getContext('2d'),draw=ctx.drawImage,portraitDraws=[];
    ctx.drawImage=function(...args){
      if(args.length===9 && /portraits-reference\.png$/.test(args[0]?.src || '')) portraitDraws.push(args.slice(1));
      return draw.apply(this,args);
    };
    window.DNFRender.render(ctx,s,{...window.rosterMeta,paused:false,region:null});
    const targetPng=canvas.toDataURL('image/png');
    const before={xp:s.player.xp,kills:s.stats.kills};
    for (const e of s.enemies) {
      for (let hit=0;hit<50 && !e.dead;hit++) C.damageEnemy(s,e,e.hp+1,0,s.player.x);
    }
    C.runFrames(s,3,{});
    return {targetPng,portraitDraws,stage:s.stage.id,roster,pending,xp:s.player.xp-before.xp,kills:s.stats.kills-before.kills,cleared:s.room.cleared};
  },probe);
  assert.equal(result.stage,'mirkwooddeep');
  assert.deepEqual(result.roster.map(e=>`${e.type}:${e.level}:${e.xp}`).sort(),probe.expected.slice().sort());
  assert.ok(result.portraitDraws.some(d=>Math.abs(d[5]-64.625)<1e-8 && d[6]===probe.targetWidth && d[7]===10.125),
    `actual native ${probe.targetType} Lv${probe.targetLevel} fill draws at${probe.targetWidth}px`);
  fs.writeFileSync(path.join(out,room==='42'?'cat7-target.png':'captain-target.png'),Buffer.from(result.targetPng.split(',')[1],'base64'));
  delete result.targetPng;
  assert.equal(result.pending,0);assert.equal(result.kills,probe.expected.length);assert.equal(result.xp,probe.xp);assert.equal(result.cleared,true);
  await page.screenshot({path:path.join(out,'room42-clear.png')});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({url,...result,errors},null,2)+'\n');
  console.log(`Room${room} browser roster/deaths/${probe.xp}XP/clear OK`);
} finally {
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
