/* Native XP glyph selection and above-body placement on a real Canvas. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = process.env.EXPERIENCE_OUT || '/tmp/nano-experience-anchor';
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ogg': 'audio/ogg' };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
  await page.evaluate(()=>{
    const render=window.DNFRender.render;
    window.DNFRender.render=(ctx,state,meta)=>{window.experienceMeta=meta;return render(ctx,state,meta);};
  });
  await page.waitForFunction(()=>window.experienceMeta);
  const rows=await page.evaluate(()=>{
    const C=window.DNFCore, R=window.DNFRender, rows=[];
    for(const [height,depth,credit] of [[0,0,50],[35,0,80],[20,45,40]]) {
      const s=C.createState({stage:'mirkwood',referenceProfile:true}),p=s.player;
      s.transition=0;p.xpToNext=100000;p.y=C.ARENA.groundY-height;p.z=depth;
      const enemy=C.createEnemy(s,'grunt',p.x+200,depth);s.enemies=[enemy];
      // Exercise observed numeral shapes independently of the uncalibrated XP balance.
      enemy.xp=credit;
      C.damageEnemy(s,enemy,enemy.hp+1,0,p.x);s.shake=0;
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
      const ctx=canvas.getContext('2d'),text=[],digits=[],digitAlpha=[],original=ctx.fillText,originalImage=ctx.drawImage;
      ctx.drawImage=function(...args){
        if(args[0]?.src?.endsWith('/experience-digits.png')) { digits.push(args.slice(1));digitAlpha.push(this.globalAlpha); }
        return originalImage.apply(this,args);
      };
      ctx.fillText=function(value,x,y,...rest){
        const m=this.getTransform();text.push({value:String(value),x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f,alpha:this.globalAlpha});
        return original.call(this,value,x,y,...rest);
      };
      R.render(ctx,s,{sprites:window.experienceMeta.sprites});
      const xp=text.find(t=>t.value==='Exp');
      const name=text.find(t=>t.value.includes('阿努纳奇'));
      const eventLog=text.find(t=>t.value===`获得${credit}点经验值`);
      const row={height,depth,credit,xp,name,eventLog,digits:digits.slice(),png:canvas.toDataURL('image/png'),timeline:[]};
      const effect=s.effects.find(e=>e.kind==='pickupText');
      for(const age of [.1,.2,.3,.6,23/30,.81]) {
        effect.life=effect.maxLife-age;text.length=digits.length=digitAlpha.length=0;
        R.render(ctx,s,{sprites:window.experienceMeta.sprites});
        const float=text.find(t=>t.value==='Exp');
        row.timeline.push({age,baseline:float?.y,alpha:float?.alpha,digitAlpha:digitAlpha.slice(),digitCount:digits.length});
      }
      effect.life=effect.maxLife-.2;
      p.x+=40;p.y-=15;p.z+=20;s.camera.x+=30;
      text.length=digits.length=digitAlpha.length=0;
      R.render(ctx,s,{sprites:window.experienceMeta.sprites});
      row.follow={xp:text.find(t=>t.value==='Exp'),name:text.find(t=>t.value.includes('阿努纳奇'))};
      row.followPng=canvas.toDataURL('image/png');
      rows.push(row);
    }
    return rows;
  });
  for(const row of rows){
    assert.deepEqual(row.digits.map(d=>d[0]),String(row.credit).split('').map(n=>Number(n)*16),
      'death XP selects the actual native numeral glyphs without an extra plus');
    assert.ok(row.xp && row.name,'XP suffix and player name are actually drawn');
    assert.ok(row.xp.y<row.name.y,'death XP must be above the name/body, including airborne and depth cases');
    assert.ok(row.eventLog && row.eventLog.y>=100 && row.eventLog.y<=104,
      'the first event-log row is below the target bar near recorded y102');
    for(const frame of row.timeline) {
      if(frame.age>=.8) { assert.equal(frame.digitCount,0,'XP must disappear after 24/30s');continue; }
      assert.ok(Math.abs(frame.baseline-(row.xp.y-33*Math.min(frame.age/.3,1)))<.1,
        'XP rises 33 screen pixels over 0.3s, then holds');
      assert.equal(frame.alpha,1,'suffix stays opaque until disappearance');
      assert.ok(frame.digitAlpha.every(a=>a===1),'native digits stay opaque until disappearance');
    }
    assert.ok(Math.abs((row.follow.xp.x-row.follow.name.x)-(row.xp.x-row.name.x))<.1,
      'XP follows the player horizontally when the player and camera move');
    assert.ok(Math.abs((row.follow.xp.y-row.follow.name.y)-(row.xp.y-row.name.y-22))<.1,
      'XP follows current jump/depth height while its own rise clock continues');
    fs.writeFileSync(`${out}/follow-height-${row.height}-depth-${row.depth}.png`,Buffer.from(row.followPng.split(',')[1],'base64'));
    delete row.followPng;
    fs.writeFileSync(`${out}/height-${row.height}-depth-${row.depth}.png`,Buffer.from(row.png.split(',')[1],'base64'));
    delete row.png;
  }
  const levelMessage=await page.evaluate(()=>{
    const C=window.DNFCore,s=C.createState({stage:'mirkwood',referenceProfile:true});
    const enemy=C.createEnemy(s,'grunt',s.player.x+200,0);s.enemies=[enemy];
    s.player.xp=s.player.xpToNext-enemy.xp;
    C.damageEnemy(s,enemy,enemy.hp+1,0,s.player.x);s.transition=s.shake=0;
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
    const ctx=canvas.getContext('2d'),draws=[],original=ctx.fillText;
    ctx.fillText=function(value,x,y,...rest){
      const m=this.getTransform();draws.push({text:String(value),x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f});
      return original.call(this,value,x,y,...rest);
    };
    window.DNFRender.render(ctx,s,{sprites:window.experienceMeta.sprites});
    return {level:s.player.level,log:s.log,draws,png:canvas.toDataURL('image/png')};
  });
  assert.equal(levelMessage.level,4);
  const notice=levelMessage.draws.find(d=>d.text==='[阿努纳奇]已达到Lv4');
  assert.ok(notice && notice.y>=100 && notice.y<=104,'the real level gain is drawn in the left log');
  assert.ok(!levelMessage.draws.some(d=>/LEVEL UP/.test(d.text)),'no generic level-up banner');
  fs.writeFileSync(`${out}/level-up.png`,Buffer.from(levelMessage.png.split(',')[1],'base64'));
  delete levelMessage.png;
  assert.deepEqual(errors,[]);
  fs.writeFileSync(`${out}/measurement.json`,JSON.stringify({rows,levelMessage,errors},null,2));
  console.log('death XP above-body Canvas checks OK',rows);
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
