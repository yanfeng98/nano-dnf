// Fixed reward poses through the actual renderer; reference crops are audit
// evidence only. RESULT_OUT selects an evidence directory, never game assets.
import {chromium} from 'playwright';
import {checkPostClear} from '../tests/browser/post-clear-check.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.env.RESULT_OUT || '/tmp/nano-reference-results';
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const file=path.resolve(root,'.'+url.pathname.replace(/^\/$/,'/index.html'));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 const mime={'.png':'image/png','.js':'text/javascript','.html':'text/html','.json':'application/json','.ogg':'audio/ogg','.css':'text/css'};
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});
 if(process.env.RESULT_COMBAT_VALUE_FALLBACK==='1'&&file===path.join(root,'src/render.js')){
  const source=fs.readFileSync(file,'utf8'),marker='if (index < 3 && sprites && sprites.results) {';
  assert.equal(source.split(marker).length,2,'the combat-value baseline changes only the native numeric gate');
  const modified=source.replace(marker,'if (false) {');
  fs.writeFileSync(path.join(out,'combat-value-fallback.js'),modified);res.end(modified);return;
 }
 if(process.env.RESULT_SCORE_FALLBACK==='1'&&file===path.join(root,'src/render.js')){
  let source=fs.readFileSync(file,'utf8');
  for(const [before,after] of [
   ['var maxScore = rating.maxScore || 2 * Core.RATING.componentMax;','var maxScore = 100;'],
   ['drawStatsNumber(ctx,sheet,String(points),"gold"','drawStatsNumber(ctx,sheet,amount+"%","gold"']
  ]){
   assert.equal(source.split(before).length,2,'the score baseline replaces only the denominator and gold value');
   source=source.replace(before,after);
  }
  fs.writeFileSync(path.join(out,'score-fallback.js'),source);res.end(source);return;
 }
 if(process.env.RESULT_NUMBER_FALLBACK==='1'&&file===path.join(root,'src/render.js')){
  const source=fs.readFileSync(file,'utf8');
  const marker='function drawStatsNumber(ctx, sheet, text, family, x, y, alignment) {\n    if (!sheet) return false;';
  assert.equal(source.split(marker).length,2,'the numeric baseline must change exactly the native-number gate');
  const modified=source.replace(marker,marker.replace('if (!sheet) return false;','return false;'));
  fs.writeFileSync(path.join(out,'number-fallback.js'),modified);
  res.end(modified);return;
 }
 if(process.env.RESULT_COMBAT_LABEL_FALLBACK==='1'&&file===path.join(root,'src/render.js')){
  const source=fs.readFileSync(file,'utf8');
  const marker='if (sprites && sprites.results) {\n        var native = RESULT_ART[labels[index]], position = labelPositions[index];';
  assert.equal(source.split(marker).length,2,'the label baseline must change only the native combat-label gate');
  const modified=source.replace(marker,marker.replace('if (sprites && sprites.results)','if (false)'));
  fs.writeFileSync(path.join(out,'combat-label-fallback.js'),modified);
  res.end(modified);return;
 }
 fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.evaluate(()=>{
  const original=window.DNFRender.render;
  window.captureResults={original};
  window.DNFRender.render=(ctx,state,meta)=>{window.captureResults.meta=meta;return original(ctx,state,meta);};
 });
 await page.waitForFunction(()=>window.captureResults.meta);
 const fallbackDisplayAlpha=await page.evaluate(()=>{
  const {original,meta}=window.captureResults,C=window.DNFCore;
  const state=C.createState({stage:'mirkwood',seed:39});
  state.victory=true;state.finishedAt=0;state.time=60;state.intro=null;state.transition=0;
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
  const ctx=canvas.getContext('2d'),draw=ctx.fillText.bind(ctx);let alpha=0;
  ctx.fillText=(...args)=>{if(args[0]==='战绩')alpha=ctx.globalAlpha;return draw(...args);};
  original(ctx,state,{...meta,attract:false,region:null,run:null,reward:null,paused:false,showHelp:false});
  return alpha;
 });
 const silhouetteReads=await page.evaluate(()=>{
  const {original,meta}=window.captureResults,C=window.DNFCore;
  const state=C.createState({stage:'mirkwooddeep',seed:34});state.intro=null;state.transition=0;
  state.enemies=['grunt','throwerElite'].map((type,i)=>{
   const e=C.createEnemy(state,type,220+i*100);e.z=0;e.silhouette=true;e.knockdown=1;return e;
  });
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');
  const proto=CanvasRenderingContext2D.prototype,read=proto.getImageData;let count=0;
  proto.getImageData=function(...args){if(args[2]===360&&args[3]===420)count++;return read.apply(this,args);};
  try{for(let i=0;i<3;i++)original(ctx,state,{...meta,attract:false,showHelp:false,paused:false,region:null,run:null,reward:null});}
  finally{proto.getImageData=read;}
  return count;
 });
 assert.ok(silhouetteReads<=2,`two different atlas cells should each bake once, got ${silhouetteReads}`);
 fs.writeFileSync(path.join(out,'silhouette-cache-reads.json'),JSON.stringify({renders:3,atlases:2,reads:silhouetteReads},null,2));
 const deathFrames=await page.evaluate(()=>{
  const {original,meta}=window.captureResults,Core=window.DNFCore,result=[];
  for(const type of ['grunt','boss']){
   const state=Core.createState({seed:33});state.intro=null;state.transition=0;
   state.room.cleared=true;state.dungeon.cells[state.cell].cleared=true;state.dungeon.cells[state.cell].exits=0;
   const enemy=Core.createEnemy(state,type,600);enemy.evasion=0;state.enemies=[enemy];
   Core.damageEnemy(state,enemy,5,0,0,{});Core.step(state,{});
   Core.damageEnemy(state,enemy,99999,0,0,{});
   // This is the actual stopped-world result branch, not a hand-aged target.
   state.victory=true;state.hitStop=.1;let elapsed=0;
   for(const age of [.05,.3,.55,.8,1.05,1.26,1.35]){
    while(elapsed<age-1e-9){const dt=Math.min(1/60,age-elapsed);Core.step(state,{},dt);elapsed+=dt;}
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');
    // The simulation stays victorious; omit only the result-page overlay in
    // this controlled render so pixel samples isolate the target itself.
    original(ctx,{...state,victory:false},{...meta,attract:false,showHelp:false,paused:false,region:null,run:null,reward:null});
    const pixels=ctx.getImageData(127,47,30,30).data;let red=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]>150&&pixels[i]>pixels[i+1]*2.5&&pixels[i]>pixels[i+2]*2.5)red++;
    result.push({type,age,red,present:!!state.target,ghost:!!state.target?.ghost,url:canvas.toDataURL('image/png')});
   }
  }
  return result;
 });
 fs.writeFileSync(path.join(out,'target-death-clock.json'),JSON.stringify(deathFrames.map(({url,...f})=>f),null,2));
 for(const frame of deathFrames){
  fs.writeFileSync(path.join(out,`death-${frame.type}-${frame.age}.png`),Buffer.from(frame.url.split(',')[1],'base64'));
  const hold=frame.type==='boss'?1:1.3;
  assert.equal(frame.present,frame.age<hold,`${frame.type}: panel expires while victory stops the world`);
  if(frame.present)assert.equal(frame.red>90,frame.age% .5<.25,`${frame.type}: cross blinks at ${frame.age}s`);
  if(frame.age>=.8)assert.equal(frame.ghost,false,'the fatal HP block fades during the result delay');

 }

 const portraitShots=await page.evaluate(()=>{
  const {original,meta}=window.captureResults;
  const cases=[['mirkwood','boss',.753,'boss-green'],['mirkwood','boss',.553,'boss-orange'],
   ['mirkwood','boss',.3,'boss-red'],['mirkwood','boss',0,'boss-dead'],
   ['mirkwooddeep','lugaruBoss',.66,'cat-orange'],['mirkwooddeep','lugaruBoss',.2,'cat-red'],
   ['mirkwooddeep','lugaruBoss',0,'cat-dead'],['mirkwood','grunt',.5,'grunt'],
   ['mirkwood','grunt',0,'grunt-dead'],['mirkwood','goblinBlue',.5,'blue-goblin'],
   ['mirkwood','goblinRed',.5,'red-goblin'],['mirkwooddeep','cat',.5,'ordinary-cat',6],
   ['mirkwooddeep','deepElite',.5,'deep-captain6',6],['mirkwooddeep','deepElite',.5,'deep-captain7',7],
   ['mirkwooddeep','throwerElite',.5,'throw-captain6',6],['mirkwooddeep','throwerElite',.5,'throw-captain7',7],
   ['mirkwooddeep','throwerElite',1,'throw-before',7,.54],['mirkwooddeep','throwerElite',1,'throw-release',7,.56],
   ['mirkwooddeep','grunt',.5,'deep-grunt4',4],['mirkwood','caster',.5,'caster4',4],
   ['mirkwood','burningThrower',.5,'fire-champion4',4]];
  return cases.map(([stage,type,hp,label,level,elapsed])=>{
   const state=window.DNFCore.createState({stage,seed:32});
   const boss=window.DNFCore.createEnemy(state,type,600);
   boss.hp=boss.maxHp*hp;boss.dead=hp===0;state.enemies=[boss];
   if(level)boss.level=level;
   if(type==='deepElite'||type==='throwerElite'){boss.x=320;boss.z=0;}
   if(elapsed!==undefined)boss.attackTimer=boss.attackDuration-elapsed;
   state.target={enemy:boss,dying:0,share:hp};state.bossEngaged=true;
   state.intro=null;state.transition=0;
   const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
   const ctx=canvas.getContext('2d');
   original(ctx,state,{...meta,attract:false,showHelp:false,paused:false,region:null,run:null,reward:null});
   const facePixels=ctx.getImageData(128,48,28,28).data;
   if(!facePixels.some((v,i)=>i%4!==3&&v>40))throw new Error('portrait capture is obscured');
   // Sample below the label, near either end of the HP strip.
   function sample(x){return [...ctx.getImageData(x,75,1,1).data].slice(0,3);}
   const edgePixels=ctx.getImageData(180,76,400,1).data;let barEnd=null;
   for(let i=0;i<400;i++){const r=edgePixels[i*4],g=edgePixels[i*4+1],b=edgePixels[i*4+2];
    if(r>150&&g>125&&b>80&&r>g&&g>b*1.1)barEnd=180+i;
   }
   const bodyPixels=ctx.getImageData(590,330,70,100).data;let brown=0;
   for(let i=0;i<bodyPixels.length;i+=4)if(bodyPixels[i]>80&&bodyPixels[i]>1.25*bodyPixels[i+1]&&bodyPixels[i]>1.2*bodyPixels[i+2])brown++;
   return {label,url:canvas.toDataURL('image/png'),atlas:meta.sprites.portraits.width,
    throwerAtlas:meta.sprites.throwerReference.width,barEnd,brown,left:sample(250),right:sample(680)};
  });
 });
 for(const shot of portraitShots){
  assert.equal(shot.atlas,3125,'real browser loads native portrait atlas');
  assert.equal(shot.throwerAtlas,6120,'real browser loads the independent brown body');
  fs.writeFileSync(path.join(out,`target-${shot.label}.png`),Buffer.from(shot.url.split(',')[1],'base64'));
 }
 const byTarget=Object.fromEntries(portraitShots.map(s=>[s.label,s]));
 assert.ok(byTarget['throw-captain7'].brown>byTarget['deep-captain7'].brown*3,'the brown thrower is visibly distinct from the blue sword captain');
 for(const [label,end] of [['grunt',341],['blue-goblin',304],['red-goblin',304],['ordinary-cat',321.5],
  ['deep-captain6',357.5],['deep-captain7',399.5],['throw-captain6',321.5],['throw-captain7',355.5],
  ['deep-grunt4',275.5],['caster4',304]]){
  assert.ok(Math.abs(byTarget[label].barEnd-end)<=3,`${label}: rendered border ends at ${byTarget[label].barEnd}, reference ${end}`);
 }
 fs.writeFileSync(path.join(out,'target-width-render.json'),JSON.stringify(portraitShots.map(({url,...s})=>s),null,2));

 assert.ok(byTarget['boss-green'].left[1]>byTarget['boss-green'].left[0],'green covers orange');
 assert.ok(byTarget['boss-orange'].left[0]>byTarget['boss-orange'].left[1]*1.5,'orange is another HP layer');
 assert.ok(byTarget['boss-orange'].right[0]>100&&byTarget['boss-orange'].right[1]<40,'red is visible under orange');
 assert.ok(byTarget['boss-red'].right.every(v=>v<30),'only the final red HP layer reveals black');
 assert.ok(byTarget['cat-orange'].right[0]>100&&byTarget['cat-orange'].right[1]<40,'cat orange covers red');
 assert.ok(byTarget['cat-red'].right.every(v=>v<30));
 assert.ok(byTarget['boss-dead'].left.every(v=>v<30)&&byTarget['cat-dead'].left.every(v=>v<30));
 fs.writeFileSync(path.join(out,'target-colors.json'),JSON.stringify(portraitShots.map(({url,...s})=>s),null,2));
 const reference={
  combatValueRefs:["operation","technique","hits"].map(kind=>["v1","v2","early"].map(v=>fs.readFileSync(path.join(root,`docs/reference-evidence/45-${v}-${kind}-reference.png`)).toString("base64"))),
  scorePartsRefs:['full-total','operation-points','technique-points'].map(kind=>[1,2].map(v=>fs.readFileSync(path.join(root,`docs/reference-evidence/44-v${v}-${kind}-reference.png`)).toString('base64'))),
  combatLabelRefs:['operation','technique','hits','rating'].map(kind=>[1,2].map(v=>fs.readFileSync(path.join(root,`docs/reference-evidence/41-v${v}-${kind}-reference.png`)).toString('base64'))),
  numberReferences:['total','percent','red'].map(kind=>[1,2].map(v=>fs.readFileSync(path.join(root,`docs/reference-evidence/40-v${v}-${kind}-reference.png`)).toString('base64'))),
  statsRanks:[1,2].map(v=>fs.readFileSync(path.join(root,`docs/reference-evidence/39-v${v}-rank-reference.png`)).toString('base64')),
  statsBars:[1,2].map(v=>fs.readFileSync(path.join(root,`docs/reference-evidence/39-v${v}-bar-reference.png`)).toString('base64')),
  chestFx:[1,2].map(v=>fs.readFileSync(path.join(root,`docs/reference-evidence/38-chest-v${v}-reference.png`)).toString('base64')),
  list:['v1-boss','v1-goblinRed','v1-caster','v2-lugaruBoss'].map(name=>fs.readFileSync(path.join(root,`docs/reference-evidence/37-list-${name}-reference.png`)).toString('base64')),
  circle:fs.readFileSync(path.join(root,'docs/reference-evidence/25-reward-circle-reference.png')).toString('base64'),
  blue:fs.readFileSync(path.join(root,'docs/reference-evidence/26-blue-card-reference.png')).toString('base64'),
  gold:fs.readFileSync(path.join(root,'docs/reference-evidence/26-gold-card-reference.png')).toString('base64'),
  prizes:['staff','totem'].map(label=>fs.readFileSync(path.join(root,`docs/reference-evidence/30-${label}-prize-reference.png`)).toString('base64')),
  digits:[1,2,3].map(n=>fs.readFileSync(path.join(root,`docs/reference-evidence/25-countdown-${n===3?'three':n}-reference.png`)).toString('base64'))
 };
 const captured=await page.evaluate(async(reference)=>{
  const {original,meta}=window.captureResults;window.DNFRender.render=original;delete window.captureResults;
  const result=[],contexts={},chestDraws={},combatGrades={},scoreParts={};
  for(const [label,phase,t,elapsed,countdown=3] of [['combat-rating','combat',6,6],['combat-rating-deep','combat',6,6],['combat-rating-ss','combat',6,6],['stats','stats',6,6],['stats-early','stats',1.5,1.5],['stats-deep','stats',6,6],['chest','chest',.3,12.5],['chest-fx','chest',3.5,13.5],['chest-fx-deep','chest',1.9,11.9],['chest-list','chest',.5,10.5],['chest-list-deep','chest',.5,10.5],['chest-slide','chest',1,11],['chest-late','chest',3,13],['chest-deep','chest',1.8,11.8],['blue','cards',1.2,15.333333],['spread','cards',.6,14.733333],['preHint','cards',1.95,16],['hintOnly','cards',2.1,16.1],['cards','cards',1.5,16.5],['cards-2','cards',1.5,17.5,2],['cards-1','cards',1.5,18.5,1],['reveal','reveal',1.5,21.5],['reveal-deep','reveal',1.5,21.5],['reveal-third','reveal',1.5,21.5],['fade-start','fade',0,20],['fade-half','fade',.4,20],['fade-last','fade',.79,20],['world','done',.01,20]]){
   const state=window.DNFCore.createState({seed:24,referenceProfile:true,stage:label.endsWith('-deep')?'mirkwooddeep':'mirkwood'});
   state.victory=phase!=='combat';state.finishedAt=phase==='combat'?null:0;state.time=elapsed;
   if(phase==='stats'||phase==='combat'){
    state.stats.swings=100;state.stats.swingsLanded=85;state.stats.comboChains=50;state.stats.comboHits=171;
    state.stats.hitsTaken=label.endsWith('-deep')?23:label.endsWith('-ss')?0:15;
    state.resultRating={...window.DNFCore.ratingOf(state),grade:label.endsWith('-ss')?'SS':'S'};
    if(phase==='stats')scoreParts[label]=state.resultRating;
   }state.intro=null;state.transition=0;state.enemies=[];state.postClear=phase==='done';state.stage={...state.stage,rain:false};
   const R=window.DNFReward,flow=R.create({seed:24,stage:state.stage.id});
   const age=label.startsWith('cards') ? R.TIMES.countdownAt+(3-countdown)+.2 : t;
   const total=phase==='combat' ? 0 : phase==='stats' ? age : phase==='chest' ? R.TIMES.stats+age
     : phase==='cards' ? R.TIMES.stats+R.chestDuration(flow)+age
     : R.TIMES.stats+R.chestDuration(flow)+R.TIMES.countdownAt+R.TIMES.countdown
       +(phase==='fade'||phase==='done' ? R.TIMES.reveal : 0)
       +(phase==='done' ? R.TIMES.fade : 0)+age;
   if(label==='reveal-third'){
    R.step(flow,R.TIMES.stats+R.chestDuration(flow)+R.TIMES.flip);R.pick(flow,2);R.step(flow,age);
   }else R.step(flow,total);
   const reward=phase==='combat'?null:{...R.snapshot(flow),elapsed};
   const c=document.createElement('canvas');c.width=960;c.height=540;
   contexts[label]=c.getContext('2d');
   if(phase==='combat'){
    const draw=contexts[label].fillText.bind(contexts[label]);combatGrades[label]=[];
    contexts[label].fillText=(...args)=>{
     if(args[1]>740&&args[1]<800&&args[2]>395&&args[2]<425)combatGrades[label].push(args[0]);
     return draw(...args);
    };
   }
   if(label==='chest-late'||label==='chest-deep'){
    chestDraws[label]=0;
    const draw=contexts[label].drawImage.bind(contexts[label]);
    contexts[label].drawImage=(...args)=>{
     if(args.length===9&&args[5]===473&&args[6]===154&&args[7]===180)chestDraws[label]++;
     return draw(...args);
    };
   }
   original(contexts[label],state,{...meta,attract:false,showHelp:false,paused:false,region:null,run:null,reward});
   result.push({label,url:c.toDataURL('image/png')});
  }
  async function pixels(base64){
   const im=new Image();im.src='data:image/png;base64,'+base64;await im.decode();
   const c=document.createElement('canvas');c.width=im.width;c.height=im.height;
   const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height).data;
  }
  const ref=await pixels(reference.circle);
  const actual=contexts.cards.getImageData(120,0,720,540).data;
  let count=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
  for(let y=36;y<480;y++)for(let x=0;x<720;x++){
   if((y>=130&&y<=355)||(x-360)**2+(y-270)**2>=236**2)continue;
   const i=(y*720+x)*4,a=ref[i+2]-ref[i],b=actual[i+2]-actual[i];
   count++;sx+=a;sy+=b;sxx+=a*a;syy+=b*b;sxy+=a*b;
  }
  const circle=(sxy-sx*sy/count)/Math.sqrt((sxx-sx*sx/count)*(syy-sy*sy/count));
  const digits=[];
  for(const [n,label,x,y,w,h] of [[1,'cards-1',470,419,15,43],[2,'cards-2',450,416,36,44],[3,'cards',454,415,31,53]]){
   const glyph=await pixels(reference.digits[n-1]),digit=contexts[label].getImageData(x,y,w,h).data;
   let dot=0,xx=0,yy=0,ink=0;
   for(let i=0;i<glyph.length;i+=4){
    if(glyph[i]<80||glyph[i]<glyph[i+2]*1.4)continue;
    ink++;
    for(let k=0;k<3;k++){dot+=glyph[i+k]*digit[i+k];xx+=glyph[i+k]**2;yy+=digit[i+k]**2;}
   }
   digits.push({value:n,cosine:dot/Math.sqrt(xx*yy),pixels:ink});
  }
  async function cardCosine(label,encoded){
   const ref=await pixels(encoded),actual=contexts[label].getImageData(129,188,172,109).data;
   let dot=0,a2=0,b2=0;
   for(let i=0;i<ref.length;i+=4)for(let k=0;k<3;k++){
    dot+=ref[i+k]*actual[i+k];a2+=ref[i+k]**2;b2+=actual[i+k]**2;
   }
   return dot/Math.sqrt(a2*b2);
  }
  const combatLabels=[];
  for(const [kindIndex,kind,x,y,w,h] of [[0,'operation',794,345,41,25],[1,'technique',795,362,40,25],[2,'hits',782,380,53,25],[3,'rating',795,397,37,25]]){
   for(const [index,label] of [[0,'combat-rating'],[1,'combat-rating-deep']]){
    const ref=await pixels(reference.combatLabelRefs[kindIndex][index]);let best={cosine:0};
    for(let dy=-1;dy<=1;dy++)for(let dx=-2;dx<=2;dx++){
     const actual=contexts[label].getImageData(x+dx,y+dy,w,h).data;let dot=0,a2=0,b2=0,count=0;
     for(let i=0;i<ref.length;i+=4){
      if(ref[i]<135||ref[i+1]<135||ref[i+2]<135)continue;count++;
      for(let k=0;k<3;k++){dot+=ref[i+k]*actual[i+k];a2+=ref[i+k]**2;b2+=actual[i+k]**2;}
     }
     const cosine=dot/Math.sqrt(a2*b2);if(cosine>best.cosine)best={cosine,dx,dy,pixels:count};
    }
    combatLabels.push({kind,video:index+1,...best});
   }
  }
  const combatValueMatches=[];
  for(const [kindIndex,kind,x,y,w,h] of [[0,'operation',740,345,55,24],[1,'technique',740,362,55,24],[2,'hits',740,380,45,24]]){
   for(const [index,label] of [[0,'combat-rating'],[1,'combat-rating-deep'],[2,'combat-rating-ss']]){
    const ref=await pixels(reference.combatValueRefs[kindIndex][index]);let best={cosine:0};
    for(let dy=-1;dy<=1;dy++)for(let dx=-2;dx<=2;dx++){
     const actual=contexts[label].getImageData(x+dx,y+dy,w,h).data;
     let dot=0,a2=0,b2=0,count=0,intersection=0,union=0;
     for(let i=0;i<ref.length;i+=4){
      const refInk=ref[i]>155&&ref[i+1]>155&&ref[i+2]>155;
      const actualInk=actual[i]>155&&actual[i+1]>155&&actual[i+2]>155;
      if(refInk||actualInk)union++;if(refInk&&actualInk)intersection++;
      if(!refInk)continue;count++;
      for(let k=0;k<3;k++){dot+=ref[i+k]*actual[i+k];a2+=ref[i+k]**2;b2+=actual[i+k]**2;}
     }
     const cosine=dot/Math.sqrt(a2*b2);
     if(cosine>best.cosine)best={cosine,dx,dy,pixels:count,inkIoU:intersection/union};
    }
    combatValueMatches.push({kind,reference:index,...best});
   }
  }
  const scorePartMatches=[];
  for(const [kindIndex,kind,x,y,w,h] of [[0,'full-total',440,90,200,45],[1,'operation-points',440,147,55,30],[2,'technique-points',440,185,55,30]]){
   for(const [index,label] of [[0,'stats'],[1,'stats-deep']]){
    const ref=await pixels(reference.scorePartsRefs[kindIndex][index]);let best={cosine:0};
    for(let dy=-1;dy<=1;dy++)for(let dx=-2;dx<=2;dx++){
     const actual=contexts[label].getImageData(x+dx,y+dy,w,h).data;
     let dot=0,a2=0,b2=0,count=0;
     for(let i=0;i<ref.length;i+=4){
      const ink=kind==='full-total' ? ref[i]>180&&ref[i+1]>180&&ref[i+2]>180 : ref[i]>140&&ref[i+1]>110&&ref[i]>ref[i+2]*1.4;
      if(!ink)continue;count++;
      for(let k=0;k<3;k++){dot+=ref[i+k]*actual[i+k];a2+=ref[i+k]**2;b2+=actual[i+k]**2;}
     }
     const cosine=dot/Math.sqrt(a2*b2);
     if(cosine>best.cosine)best={cosine,dx,dy,pixels:count};
    }
    scorePartMatches.push({kind,video:index+1,...best});
   }
  }
  const numberMatches=[];
  for(const [kindIndex,kind,x,y,w,h] of [[0,'total',440,90,78,45],[1,'percent',590,154,52,24],[2,'red',430,230,65,28]]){
   for(const [index,label] of [[0,'stats'],[1,'stats-deep']]){
    const ref=await pixels(reference.numberReferences[kindIndex][index]);let best={cosine:0};
    for(let dy=-1;dy<=1;dy++)for(let dx=-2;dx<=2;dx++){
     const actual=contexts[label].getImageData(x+dx,y+dy,w,h).data;
     let dot=0,a2=0,b2=0,count=0;
     for(let i=0;i<ref.length;i+=4){
      const ink=kind==='red' ? ref[i]>90&&ref[i]>ref[i+1]*1.4&&ref[i]>ref[i+2]*1.4 : ref[i]>180&&ref[i+1]>180&&ref[i+2]>180;
      if(!ink)continue;count++;
      for(let k=0;k<3;k++){dot+=ref[i+k]*actual[i+k];a2+=ref[i+k]**2;b2+=actual[i+k]**2;}
     }
     const cosine=dot/Math.sqrt(a2*b2);
     if(cosine>best.cosine)best={cosine,dx,dy,pixels:count};
    }
    numberMatches.push({kind,video:index+1,...best});
   }
  }
  const statsRanks=[],statsBars=[];
  for(const [index,label] of [[0,'stats'],[1,'stats-deep']]){
   const rankRef=await pixels(reference.statsRanks[index]),actual=contexts[label].getImageData(249,320,159,160).data;
   let dot=0,a2=0,b2=0,count=0;
   for(let i=0;i<rankRef.length;i+=4){
    if(rankRef[i]<85||rankRef[i+1]<60||rankRef[i]<rankRef[i+2]*1.3)continue;
    count++;
    for(let k=0;k<3;k++){dot+=rankRef[i+k]*actual[i+k];a2+=rankRef[i+k]**2;b2+=actual[i+k]**2;}
   }
   statsRanks.push({cosine:dot/Math.sqrt(a2*b2),pixels:count});
   const barRef=await pixels(reference.statsBars[index]),bar=contexts[label].getImageData(525,154,184,25).data;
   dot=0;a2=0;b2=0;
   for(let i=0;i<barRef.length;i+=4)for(let k=0;k<3;k++){dot+=barRef[i+k]*bar[i+k];a2+=barRef[i+k]**2;b2+=bar[i+k]**2;}
   statsBars.push(dot/Math.sqrt(a2*b2));
  }
  const chestFx=[];
  for(const [index,label] of [[0,'chest-fx'],[1,'chest-fx-deep']]){
   const ref=await pixels(reference.chestFx[index]),actual=contexts[label].getImageData(450,135,200,200).data;
   let dot=0,a2=0,b2=0;
   for(let i=0;i<ref.length;i+=4)for(let k=0;k<3;k++){
    dot+=ref[i+k]*actual[i+k];a2+=ref[i+k]**2;b2+=actual[i+k]**2;
   }
   chestFx.push(dot/Math.sqrt(a2*b2));
  }
  const listFaces=[];
  for(const [index,label,y] of [[0,'chest-list',150],[1,'chest-list',200],[2,'chest-list',235],[3,'chest-list-deep',150]]){
   const ref=await pixels(reference.list[index]),actual=contexts[label].getImageData(238,y,27,27).data;
   let dot=0,a2=0,b2=0;
   for(let i=0;i<ref.length;i+=4)for(let k=0;k<3;k++){
    dot+=ref[i+k]*actual[i+k];a2+=ref[i+k]**2;b2+=actual[i+k]**2;
   }
   listFaces.push(dot/Math.sqrt(a2*b2));
  }
  const blue=await cardCosine('blue',reference.blue),gold=await cardCosine('cards',reference.gold);
  const prizeCosines=[];
  for(const [label,encoded] of [['reveal',reference.prizes[0]],['reveal-deep',reference.prizes[1]]]){
   const ref=await pixels(encoded),actual=contexts[label].getImageData(129,188,172,109).data;
   let dot=0,a2=0,b2=0;
   // Texture and item socket only: system-font localization is still pending.
   for(let y=6;y<50;y++)for(let x=6;x<164;x++)for(let k=0;k<3;k++){
    const i=(y*172+x)*4+k;dot+=ref[i]*actual[i];a2+=ref[i]**2;b2+=actual[i]**2;
   }
   prizeCosines.push(dot/Math.sqrt(a2*b2));
  }
  function cyanCount(label,x){
   const pixels=contexts[label].getImageData(x,188,172,109).data;let n=0;
   for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>150&&pixels[i+2]>200&&pixels[i]<150)n++;
   return n;
  }
  const thirdCardCyan=cyanCount('reveal-third',487),firstCardCyanAfterThird=cyanCount('reveal-third',129);
  const mid=contexts.spread.getImageData(120,190,720,110).data;let left=720,right=-1;
  for(let x=0;x<720;x++){
   let count=0;
   for(let y=0;y<110;y++){const i=(y*720+x)*4;if(mid[i]>60&&mid[i+1]>180&&mid[i+2]>210)count++;}
   if(count>20){left=Math.min(left,x);right=Math.max(right,x);}
  }
  function goldCount(label,x,y,w,h){
   const im=contexts[label].getImageData(x,y,w,h).data;let count=0;
   for(let i=0;i<im.length;i+=4)if(im[i]>100&&im[i+1]>60&&im[i]>.9*im[i+1]&&im[i+2]<.8*im[i+1])count++;
   return count;
  }
  const promptBefore=goldCount('preHint',370,330,230,32),promptAfter=goldCount('hintOnly',370,330,230,32);
  const counterBefore=goldCount('hintOnly',450,410,45,65),counterAfter=goldCount('cards',450,410,45,65);
  function fadeError(label,alpha){
   const start=contexts['fade-start'].getImageData(300,200,300,210).data;
   const end=contexts.world.getImageData(300,200,300,210).data;
   const actual=contexts[label].getImageData(300,200,300,210).data;
   let error=0,count=0;
   for(let i=0;i<actual.length;i+=4)for(let k=0;k<3;k++){
    error+=Math.abs(actual[i+k]-(alpha*start[i+k]+(1-alpha)*end[i+k]));count++;
   }
   return error/count;
  }
  const fadeHalfError=fadeError('fade-half',.5),fadeLastError=fadeError('fade-last',.0125);
  const hudData=contexts.chest.getImageData(135,465,30,55).data;
  let hudChestRed=0;
  for(let i=0;i<hudData.length;i+=4)if(hudData[i]>50&&hudData[i]>2*hudData[i+1]&&hudData[i]>2*hudData[i+2])hudChestRed++;
  return {images:result,measurement:{combatValueMatches,scoreParts,scorePartMatches,combatLabels,combatGrades,numberMatches,statsRanks,statsBars,chestFx,listFaces,chestDraws,thirdCardCyan,firstCardCyanAfterThird,prizeCosines,fadeHalfError,fadeLastError,hudChestRed,circleCorrelation:circle,digits,blueCardCosine:blue,goldCardCosine:gold,
    spreadBounds:[left,right],promptBefore,promptAfter,counterBefore,counterAfter}};
 },reference);
 captured.measurement.fallbackDisplayAlpha=fallbackDisplayAlpha;
 for(const c of captured.images)fs.writeFileSync(path.join(out,`${c.label}.png`),Buffer.from(c.url.split(',')[1],'base64'));
 fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify(captured.measurement,null,2)+'\n');
 console.log(`result poses: ${out}`,captured.measurement);
 assert.deepEqual(captured.measurement.combatGrades,{'combat-rating':['S'],'combat-rating-deep':['S'],'combat-rating-ss':['SS']},'the actual combat panel paints grades rather than numeric scores');
 for(const match of captured.measurement.combatValueMatches)assert.ok(match.pixels>15&&match.cosine>.95&&match.inkIoU>.4,`native combat ${match.kind} matches the observed numeric field ${match.reference}`);
 for(const [label,total] of [['stats',85],['stats-deep',77]]){
  const rating=captured.measurement.scoreParts[label];
  assert.equal(rating.score,total);assert.equal(rating.maxScore,140);
  assert.equal(rating.operationPoints,60);assert.equal(rating.techniquePoints,40);
 }
 for(const match of captured.measurement.scorePartMatches)assert.ok(match.pixels>100&&match.cosine>.98,`native ${match.kind} includes the observed point value or full /140 denominator for video ${match.video}`);
 for(const label of captured.measurement.combatLabels)assert.ok(label.pixels>100&&label.cosine>.92,`native combat ${label.kind} label matches reference ${label.video}`);
 for(const match of captured.measurement.numberMatches)assert.ok(match.pixels>100&&match.cosine>.95,`native ${match.kind} digits match reference ${match.video} within the measured two-pixel alignment range`);
 assert.ok(captured.measurement.fallbackDisplayAlpha>.9,'a clear without a reward flow retains its stats instead of fading to an empty circle');
 for(const rank of captured.measurement.statsRanks)assert.ok(rank.pixels>1000&&rank.cosine>.94,'the stats page uses the observed circular gold result badge at its measured position');
 for(const bar of captured.measurement.statsBars)assert.ok(bar>.9,'the stats bars use the observed native texture and geometry');
 for(const match of captured.measurement.chestFx)assert.ok(match>.94,'the chest becomes the measured native cyan outline and lock flash before card spread');
 for(const match of captured.measurement.listFaces)assert.ok(match>.94,'list portraits match the observed native faces at their measured positions');
 assert.deepEqual(captured.measurement.chestDraws,{'chest-late':1,'chest-deep':1},'native chest stays on screen through each recorded list interval');
 assert.ok(captured.measurement.thirdCardCyan>250&&captured.measurement.firstCardCyanAfterThird<50,'manual third-card selection reveals in column three instead of column one');
 for(const cosine of captured.measurement.prizeCosines)assert.ok(cosine>.94,"the prize card texture and weapon socket match the reference region");
 assert.ok(captured.measurement.fadeHalfError<1&&captured.measurement.fadeLastError<1,'the complete result page fades into the same world without darkening overlapping layers twice');
 assert.ok(captured.measurement.hudChestRed>100,'the recorded bottom HUD remains visible under the result page');
 assert.ok(captured.measurement.circleCorrelation>.7,'the native circle must match the recorded rotation and geometry');
 for(const d of captured.measurement.digits)assert.ok(d.pixels>50&&d.cosine>.97,`gold countdown ${d.value} must match the recorded glyph at its measured position`);
 assert.ok(captured.measurement.blueCardCosine>.97,'the blue stage must retain the native treasure illustration and measured cyan light');
 assert.ok(captured.measurement.goldCardCosine>.96,'the final card must match the recorded native scale and position');
 assert.ok(captured.measurement.spreadBounds[0]>110&&captured.measurement.spreadBounds[0]<180&&captured.measurement.spreadBounds[1]>550&&captured.measurement.spreadBounds[1]<630,'the cards spread from the center before reaching their final positions');
 assert.ok(captured.measurement.promptBefore<30&&captured.measurement.promptAfter>100,'the prompt waits for the recorded fade');
 assert.ok(captured.measurement.counterBefore<30&&captured.measurement.counterAfter>80,'the counter starts after the prompt');
 await checkPostClear(page,out);
} finally {await browser?.close();await new Promise(r=>server.close(r));}
