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
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
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
 const portraitShots=await page.evaluate(()=>{
  const {original,meta}=window.captureResults;
  const cases=[['mirkwood','boss',.753,'boss-green'],['mirkwood','boss',.553,'boss-orange'],
   ['mirkwood','boss',.3,'boss-red'],['mirkwood','boss',0,'boss-dead'],
   ['mirkwooddeep','lugaruBoss',.66,'cat-orange'],['mirkwooddeep','lugaruBoss',.2,'cat-red'],
   ['mirkwooddeep','lugaruBoss',0,'cat-dead'],['mirkwood','grunt',.5,'grunt'],
   ['mirkwood','grunt',0,'grunt-dead'],['mirkwood','goblinBlue',.5,'blue-goblin'],
   ['mirkwood','goblinRed',.5,'red-goblin'],['mirkwooddeep','cat',.5,'ordinary-cat']];
  return cases.map(([stage,type,hp,label])=>{
   const state=window.DNFCore.createState({stage,seed:32});
   const boss=window.DNFCore.createEnemy(state,type,600);
   boss.hp=boss.maxHp*hp;boss.dead=hp===0;state.enemies=[boss];
   state.target={enemy:boss,dying:0,share:hp};state.bossEngaged=true;
   state.intro=null;state.transition=0;
   const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
   const ctx=canvas.getContext('2d');
   original(ctx,state,{...meta,attract:false,showHelp:false,paused:false,region:null,run:null,reward:null});
   const facePixels=ctx.getImageData(128,48,28,28).data;
   if(!facePixels.some((v,i)=>i%4!==3&&v>40))throw new Error('portrait capture is obscured');
   // Sample below the label, near either end of the HP strip.
   function sample(x){return [...ctx.getImageData(x,75,1,1).data].slice(0,3);}
   return {label,url:canvas.toDataURL('image/png'),atlas:meta.sprites.portraits.width,left:sample(250),right:sample(680)};
  });
 });
 for(const shot of portraitShots){
  assert.equal(shot.atlas,3101,'real browser loads native portrait atlas');
  fs.writeFileSync(path.join(out,`target-${shot.label}.png`),Buffer.from(shot.url.split(',')[1],'base64'));
 }
 const byTarget=Object.fromEntries(portraitShots.map(s=>[s.label,s]));
 assert.ok(byTarget['boss-green'].left[1]>byTarget['boss-green'].left[0],'green covers orange');
 assert.ok(byTarget['boss-orange'].left[0]>byTarget['boss-orange'].left[1]*1.5,'orange is another HP layer');
 assert.ok(byTarget['boss-orange'].right[0]>100&&byTarget['boss-orange'].right[1]<40,'red is visible under orange');
 assert.ok(byTarget['boss-red'].right.every(v=>v<30),'only the final red HP layer reveals black');
 assert.ok(byTarget['cat-orange'].right[0]>100&&byTarget['cat-orange'].right[1]<40,'cat orange covers red');
 assert.ok(byTarget['cat-red'].right.every(v=>v<30));
 assert.ok(byTarget['boss-dead'].left.every(v=>v<30)&&byTarget['cat-dead'].left.every(v=>v<30));
 fs.writeFileSync(path.join(out,'target-colors.json'),JSON.stringify(portraitShots.map(({url,...s})=>s),null,2));
 const reference={
  circle:fs.readFileSync(path.join(root,'docs/reference-evidence/25-reward-circle-reference.png')).toString('base64'),
  blue:fs.readFileSync(path.join(root,'docs/reference-evidence/26-blue-card-reference.png')).toString('base64'),
  gold:fs.readFileSync(path.join(root,'docs/reference-evidence/26-gold-card-reference.png')).toString('base64'),
  prizes:['staff','totem'].map(label=>fs.readFileSync(path.join(root,`docs/reference-evidence/30-${label}-prize-reference.png`)).toString('base64')),
  digits:[1,2,3].map(n=>fs.readFileSync(path.join(root,`docs/reference-evidence/25-countdown-${n===3?'three':n}-reference.png`)).toString('base64'))
 };
 const captured=await page.evaluate(async(reference)=>{
  const {original,meta}=window.captureResults;window.DNFRender.render=original;delete window.captureResults;
  const result=[],contexts={};
  for(const [label,phase,t,elapsed,countdown=3] of [['chest','chest',.3,12.5],['blue','cards',1.2,15.333333],['spread','cards',.6,14.733333],['preHint','cards',1.95,16],['hintOnly','cards',2.1,16.1],['cards','cards',1.5,16.5],['cards-2','cards',1.5,17.5,2],['cards-1','cards',1.5,18.5,1],['reveal','reveal',1.5,21.5],['reveal-deep','reveal',1.5,21.5],['reveal-third','reveal',1.5,21.5],['fade-start','fade',0,20],['fade-half','fade',.4,20],['fade-last','fade',.79,20],['world','done',.01,20]]){
   const state=window.DNFCore.createState({seed:24,referenceProfile:true,stage:label==='reveal-deep'?'mirkwooddeep':'mirkwood'});
   state.victory=true;state.finishedAt=0;state.time=elapsed;state.intro=null;state.transition=0;state.enemies=[];state.postClear=phase==='done';state.stage={...state.stage,rain:false};
   const R=window.DNFReward,flow=R.create({seed:24,stage:state.stage.id});
   const age=label.startsWith('cards') ? R.TIMES.countdownAt+(3-countdown)+.2 : t;
   const total=phase==='chest' ? R.TIMES.stats+age
     : phase==='cards' ? R.TIMES.stats+R.TIMES.chest+age
     : R.TIMES.stats+R.TIMES.chest+R.TIMES.countdownAt+R.TIMES.countdown
       +(phase==='fade'||phase==='done' ? R.TIMES.reveal : 0)
       +(phase==='done' ? R.TIMES.fade : 0)+age;
   if(label==='reveal-third'){
    R.step(flow,R.TIMES.stats+R.TIMES.chest+R.TIMES.flip);R.pick(flow,2);R.step(flow,age);
   }else R.step(flow,total);
   const reward={...R.snapshot(flow),elapsed};
   const c=document.createElement('canvas');c.width=960;c.height=540;
   contexts[label]=c.getContext('2d');
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
  return {images:result,measurement:{thirdCardCyan,firstCardCyanAfterThird,prizeCosines,fadeHalfError,fadeLastError,hudChestRed,circleCorrelation:circle,digits,blueCardCosine:blue,goldCardCosine:gold,
    spreadBounds:[left,right],promptBefore,promptAfter,counterBefore,counterAfter}};
 },reference);
 for(const c of captured.images)fs.writeFileSync(path.join(out,`${c.label}.png`),Buffer.from(c.url.split(',')[1],'base64'));
 fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify(captured.measurement,null,2)+'\n');
 console.log(`result poses: ${out}`,captured.measurement);
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
