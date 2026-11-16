// Candidate foreground-mask fit across Lv3/4/6; not an exact-font acceptance check.
import {chromium} from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
const refs=[3,4,6].map((level,i)=>({level,png:fs.readFileSync(['docs/reference-evidence/121-v1-60-entry-xp.png','docs/reference-evidence/134-v1-98-second-room.png','docs/reference-evidence/121-v2-15.5-entry-xp.png'][i]).toString('base64')}));
const fontPath=process.env.LEVEL_FONT || '/tmp/nano150-level-font/gasinamu-ascii.ttf';
const rasterMode=process.argv.includes('--raster');
const output=process.env.LEVEL_FONT_OUT || (rasterMode?'/tmp/nano150-level-font-raster-fit.json':'/tmp/nano150-level-font-fit.json');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 const result=await page.evaluate(async ({refs,fontData,rasterMode})=>{
  const font=await new FontFace('DNFGasinamu',`url(data:font/ttf;base64,${fontData})`).load();document.fonts.add(font);
  const canvas=document.createElement('canvas');canvas.width=50;canvas.height=16;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const masks=[];
  for(const r of refs){const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+r.png)).blob(),{colorSpaceConversion:'none'});ctx.clearRect(0,0,50,16);ctx.drawImage(bitmap,75,478,50,16,0,0,50,16);const p=ctx.getImageData(0,0,50,16).data;masks.push(Array.from({length:800},(_,i)=>Math.min(p[i*4],p[i*4+1],p[i*4+2])>170));}
  function draw(font,x,y){const scores=[];let box;
   for(let n=0;n<refs.length;n++){ctx.clearRect(0,0,50,16);ctx.fillStyle='#e8ecef';ctx.font=font;ctx.textAlign='left';ctx.fillText('Lv.'+refs[n].level,x-75,y-478);const p=ctx.getImageData(0,0,50,16).data;let aa=0,bb=0,ab=0,minX=999,minY=999,maxX=0,maxY=0;for(let i=0;i<800;i++){const on=Math.min(p[i*4],p[i*4+1],p[i*4+2])>170&&p[i*4+3]>170;if(on){aa++;minX=Math.min(minX,i%50);minY=Math.min(minY,Math.floor(i/50));maxX=Math.max(maxX,i%50);maxY=Math.max(maxY,Math.floor(i/50));}if(masks[n][i])bb++;if(on&&masks[n][i])ab++;}scores.push(2*ab/(aa+bb));box=[minX+75,minY+478,maxX+76,maxY+479];}return {font,x,y,scores,mean:scores.reduce((a,b)=>a+b)/scores.length,bbox:box};}
  if(rasterMode){
  const baseline=draw("700 11px 'Segoe UI', system-ui, sans-serif",80,493),rows=[];
  for(const scale of [.9,1.125])for(const weight of [400,700])for(const size of [10,11,12,13,14])for(const smooth of ['low','high']){
   const glyphs=refs.map(r=>{const c=document.createElement('canvas');c.width=128;c.height=64;const g=c.getContext('2d');g.font=`${weight} ${size}px DNFGasinamu`;g.fillStyle='#e8ecef';g.fillText('Lv.'+r.level,16,32);return c;});
   for(let qx=314;qx<=328;qx++)for(let qy=1956;qy<=1968;qy++){
    const x=qx/4,y=qy/4,scores=[];let box;
    for(let n=0;n<refs.length;n++){
     ctx.clearRect(0,0,50,16);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality=smooth;ctx.drawImage(glyphs[n],x-75-16*scale,y-478-32*scale,128*scale,64*scale);const p=ctx.getImageData(0,0,50,16).data;
     let aa=0,bb=0,ab=0,minX=999,minY=999,maxX=0,maxY=0;
     for(let i=0;i<800;i++){const on=Math.min(p[i*4],p[i*4+1],p[i*4+2])>170&&p[i*4+3]>170;if(on){aa++;minX=Math.min(minX,i%50);minY=Math.min(minY,Math.floor(i/50));maxX=Math.max(maxX,i%50);maxY=Math.max(maxY,Math.floor(i/50));}if(masks[n][i])bb++;if(on&&masks[n][i])ab++;}
     scores.push(2*ab/(aa+bb));box=[minX+75,minY+478,maxX+76,maxY+479];
    }
    rows.push({scale,weight,size,smooth,x,y,scores,mean:scores.reduce((a,b)=>a+b)/3,bbox:box});
   }
  }
  rows.sort((a,b)=>b.mean-a.mean);return {baseline,best:rows.slice(0,10),limits:['Native font outlines unchanged; candidate native rasterization followed by video scaling.','Foreground-mask fit, not yet a runtime font match or exact original display-pipeline identification.']};
  }else{
  const baseline=draw("700 11px 'Segoe UI', system-ui, sans-serif",80,493),rows=[];
  for(const family of ['serif','system-ui','DNFGasinamu'])for(const weight of [400,700])for(let quarter=44;quarter<=56;quarter++)for(let x=78;x<=82;x++)for(let y=490;y<=494;y++)rows.push(draw(`${weight} ${quarter/4}px ${family}`,x,y));
  rows.sort((a,b)=>b.mean-a.mean);return {baseline,best:rows.slice(0,10),limits:['Foreground-mask candidate fit, not identification of the exact original font file.','Three levels share one font, size and position; no reference pixels enter runtime art.']};
  }
 },{refs,fontData:fs.readFileSync(fontPath).toString('base64'),rasterMode});
 result.browserVersion=browser.version();
 result.candidateFontSha256=crypto.createHash('sha256').update(fs.readFileSync(fontPath)).digest('hex');
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
