// Compare native video playback with both ways of decoding its ffmpeg PNG.
// The fixed ROI is the static room24 crown, avoiding frame-timing/actor pixels.
import {chromium} from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=(name,fallback)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const file=flag('video',path.resolve(root,'../dnf-素材/00002-幽暗密林深处.mp4'));
const reference=flag('reference',path.join(root,'docs/reference-evidence/54-room24-293-reference.png'));
const out=flag('out','/tmp/nano-video-color');fs.mkdirSync(out,{recursive:true});
const time=Number(flag('time','293')),size=fs.statSync(file).size,roi=[330,170,100,60];
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html>');return;}
 const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
 const start=m?Number(m[1]):0,end=m&&m[2]?Number(m[2]):size-1;
 res.writeHead(m?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,...(m?{'content-range':`bytes ${start}-${end}/${size}`}:{})});
 fs.createReadStream(file,{start,end}).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage();const base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base+'/');
 const result=await page.evaluate(async({url,reference,time,roi})=>{
  const video=document.createElement('video');video.muted=true;video.src=url;
  await new Promise((r,j)=>{video.onloadedmetadata=r;video.onerror=()=>j(new Error(video.error?.message));});
  video.currentTime=time;await new Promise(r=>video.onseeked=r);
  function canvas(){const c=document.createElement('canvas');c.width=720;c.height=540;return c.getContext('2d');}
  const v=canvas();v.drawImage(video,240,0,1440,1080,0,0,720,540);
  const uri='data:image/png;base64,'+reference,raw=canvas(),converted=canvas();
  raw.drawImage(await createImageBitmap(await(await fetch(uri)).blob(),{colorSpaceConversion:'none'}),0,0);
  const image=new Image();image.src=uri;await image.decode();converted.drawImage(image,0,0);
  const pixels=v.getImageData(...roi).data;
  function error(ctx){const q=ctx.getImageData(...roi).data;let total=0,squares=0,max=0,count=0;for(let i=0;i<q.length;i++){if(i%4===3)continue;const d=Math.abs(q[i]-pixels[i]);total+=d;squares+=d*d;max=Math.max(max,d);count++;}return {meanAbsoluteError:total/count,rmse:Math.sqrt(squares/count),maxError:max};}
  return {time:video.currentTime,roi,rawVideoPixels:error(raw),pngColorConversion:error(converted),videoPng:v.canvas.toDataURL(),rawPng:raw.canvas.toDataURL()};
 },{url:base+'/video.mp4',reference:fs.readFileSync(reference).toString('base64'),time,roi});
 for(const [key,name] of [['videoPng','video.png'],['rawPng','raw-reference.png']]){fs.writeFileSync(path.join(out,name),Buffer.from(result[key].split(',')[1],'base64'));delete result[key];}
 result.source={video:path.basename(file),bytes:size,reference:path.basename(reference),browser:browser.version()};
 result.scope='Static room24 crown at293s. Confirms PNG decoding policy; does not establish game-wide grading, animation phase or every video frame.';
 fs.writeFileSync(path.join(out,'comparison.json'),JSON.stringify(result,null,2)+'\n');
 assert.ok(result.rawVideoPixels.meanAbsoluteError<result.pngColorConversion.meanAbsoluteError,'raw RGB must better match direct video playback');
 console.log(result);
}finally{if(browser)await browser.close();server.close();}
