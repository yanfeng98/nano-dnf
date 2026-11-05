// Fixed reward poses through the actual renderer; reference crops are audit
// evidence only. RESULT_OUT selects an evidence directory, never game assets.
import {chromium} from 'playwright';
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
 const reference={
  circle:fs.readFileSync(path.join(root,'docs/reference-evidence/25-reward-circle-reference.png')).toString('base64'),
  digits:[1,2,3].map(n=>fs.readFileSync(path.join(root,`docs/reference-evidence/25-countdown-${n===3?'three':n}-reference.png`)).toString('base64'))
 };
 const captured=await page.evaluate(async(reference)=>{
  const {original,meta}=window.captureResults;window.DNFRender.render=original;delete window.captureResults;
  const result=[],contexts={};
  for(const [label,phase,t,elapsed,countdown=3] of [['chest','chest',.3,12.5],['cards','cards',1.5,16.5],['cards-2','cards',1.5,17.5,2],['cards-1','cards',1.5,18.5,1],['reveal','reveal',1.5,21.5]]){
   const state=window.DNFCore.createState({seed:24,referenceProfile:true});
   state.victory=true;state.finishedAt=0;state.time=elapsed;state.intro=null;state.transition=0;state.enemies=[];
   const reward={...window.DNFReward.snapshot(window.DNFReward.create({seed:24})),phase,t,elapsed,countdown,faceUp:true,picked:phase==='reveal'?0:null};
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
  return {images:result,measurement:{circleCorrelation:circle,digits}};
 },reference);
 for(const c of captured.images)fs.writeFileSync(path.join(out,`${c.label}.png`),Buffer.from(c.url.split(',')[1],'base64'));
 fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify(captured.measurement,null,2)+'\n');
 console.log(`result poses: ${out}`,captured.measurement);
 assert.ok(captured.measurement.circleCorrelation>.7,'the native circle must match the recorded rotation and geometry');
 for(const d of captured.measurement.digits)assert.ok(d.pixels>50&&d.cosine>.97,`gold countdown ${d.value} must match the recorded glyph at its measured position`);
} finally {await browser?.close();await new Promise(r=>server.close(r));}
