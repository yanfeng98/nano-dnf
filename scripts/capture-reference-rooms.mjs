// Shared measured-camera room captures. Entry points select a room profile.
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const room=process.env.CAPTURE_ROOM || '42';
const profiles={
 '25':{batch:56,col:4,row:1,out:'/tmp/nano-room56/render',times:[314,315,317,318,319,320,330],actorScreenX:360,boss:true,
  scope:'visible native barrel caps, chest fragments and bunker walls plus far-right keyboard movement; trees and object lifecycle remain open',
  cases:[
   ['back-bunker-wall',314,'bunker',0,0,142,138,552,220,155,155,155,500,.95,null,[19,99,74,143]],
   ['front-bunker-wall',318,'bunker',0,0,142,138,51,318,155,156,156,500,.95,null,[19,99,74,144]],
   ['first-barrel-cap',315,'forest',560,1874,63,78,466,341,72,86,22,100,.95],
   ['middle-barrel-cap',317,'forest',560,1874,63,78,539,315,72,86,22,100,.95],
   ['right-barrel-cap',320,'forest',560,1874,63,78,642,226,70,89,22,100,.95],
   ['left-chest-visible-cap',319,'forest',623,1874,86,56,220,247,95,64,31,100,.95,26],
   ['right-chest-left',330,'forest',623,1874,86,56,194,247,95,64,22,100,.95],
   ['right-chest-right',330,'forest',623,1874,86,56,291,247,95,64,22,100,.95]
  ]},
 '24':{batch:54,col:3,row:1,out:'/tmp/nano-room54/render',times:[277,281,293,307],actorScreenX:80,next:'暗咒猫妖的林地',exit:'E',entryDoor:'W',
  cases:[
   ['front-barrel',277,'forest',560,1874,63,78,472,370,72,89,22,100,.95],
   ['middle-barrel',277,'forest',560,1874,63,78,428,296,70,86,22,100,.95],
   ['back-barrel',277,'forest',560,1874,63,78,458,247,72,89,22,100,.95],
   ['single-large-rock',277,'forest',585,803,141,89,496,286,156,98,60,1000,.97],
   ['rock-after-pan',281,'forest',585,803,141,89,231,286,156,98,60,1000,.97],
   ['first-green-tree',293,'tree',0,0,153,203,303,162,171,229,229,5000,.97,null,null,true],
   ['second-green-tree',307,'tree',0,0,153,203,192,169,173,227,227,5000,.97,null,null,true]
  ]},
 '14':{batch:53,col:3,row:0,out:'/tmp/nano-room53/render',times:[236.5,260,265.5],next:'老树回廊',exit:'W',entryDoor:'W',
  scope:'camera capacity and west-door keyboard only; tree and gate artwork remain unverified',cases:[]},
 '13':{batch:52,col:2,row:0,out:'/tmp/nano-room52/render',times:[190,210,235.5,268,271.5],next:'残柱祭坛',exit:'E',entryDoor:'S',extraSouth:true,
  cases:[
   ['entry-back-cap',190,'pillar',0,0,44,133,358,153,49,150,30,300,.97],
   ['entry-middle-cap',190,'pillar',0,0,44,133,402,190,49,150,30,300,.97],
   ['entry-barrel',190,'forest',560,1874,63,78,515,315,70,86,22,100,.95],
   ['central-cap',210,'pillar',0,0,44,133,490,179,49,150,30,300,.97],
   ['east-cap',235.5,'pillar',0,0,44,133,298,136,49,150,30,300,.97],
   ['return-east-cap',268,'pillar',0,0,44,133,478,136,49,150,30,300,.97],
   ['return-front-cap',268,'pillar',0,0,44,133,123,353,49,150,30,300,.97],
   ['return-entry-cap',271.5,'pillar',0,0,44,133,191,153,49,150,30,300,.97]
  ]},
 '23':{batch:51,col:2,row:1,out:'/tmp/nano-room51/render',times:[148,150,180],next:'老树回廊',exit:'N',entryDoor:'S',extraEast:true,
  cases:[
   ['entry-right-back-cap',148,'pillar',0,0,44,133,537,215,49,150,30,300,.97],
   ['entry-right-front-cap',148,'pillar',0,0,44,133,585,250,49,150,30,300,.97],
   ['entry-back-barrel-cap',148,'forest',560,1874,63,78,469,211,72,89,22,100,.95],
   ['entry-middle-barrel-cap',148,'forest',560,1874,63,78,489,306,70,86,22,100,.95],
   ['front-barrel-left-cap',150,'forest',560,1874,63,78,490,391,72,89,22,100,.95,35],
   ['left-first-cap',180,'pillar',0,0,44,133,288,142,49,150,30,300,.97],
   ['left-second-cap',180,'pillar',0,0,44,133,337,174,49,150,30,300,.97],
   ['left-barrel-cap',180,'forest',560,1874,63,78,556,205,70,86,22,100,.95]
  ]},
 '33':{batch:50,col:2,row:2,out:'/tmp/nano-room50/render',times:[106,125,133,146],next:'投掷手坡',exit:'N',entryDoor:'S',
  cases:[
   ['back-first-cap',106,'pillar',0,0,44,133,424,141,49,150,30,300,.97],
   ['back-second-cap',106,'pillar',0,0,44,133,456,172,49,150,30,300,.97],
   ['back-third-cap',106,'pillar',0,0,44,133,484,205,49,150,30,300,.97],
   ['back-fourth-cap',106,'pillar',0,0,44,133,522,236,49,150,30,300,.97],
   ['left-front-cap',106,'pillar',0,0,44,133,30,320,49,150,30,300,.97],
   ['left-back-cap',146,'pillar',0,0,44,133,219,142,49,150,30,300,.97],
   ['front-bunker-wall',106,'bunker',0,0,142,138,535,320,162,152,152,500,.95,null,[17,88,68,127]],
   ['back-bunker-wall',133,'bunker',0,0,142,138,36,174,157,158,158,500,.95,null,[16,91,65,131]]
  ]},
 '42':{batch:46,col:1,out:'/tmp/nano-room46/render',times:[26.5,28,44.5,66.5,72.5],next:'猫妖岔路',
  cases:[
   ['entry-flat',26.5,'pillar',0,0,44,133,360,230,49,150,80,1000,.97],
   ['entry-front',28,'pillar',0,0,44,133,481,327,49,150,100,1000,.97],
   ['entry-back',28,'pillar',0,0,44,133,546,228,49,150,100,1000,.97],
   ['right-front',72.5,'pillar',0,0,44,133,351,305,49,150,100,1000,.97],
   ['right-back',72.5,'pillar',0,0,44,133,444,246,49,150,100,1000,.97]
  ]},
 '41':{batch:47,col:0,out:'/tmp/nano-room47/render',times:[10.5,13.5,17.5,25.5],next:'宝箱浅沟',
  cases:[
   ['initial-back-barrel-cap',10.5,'forest',560,1874,63,78,502,256,72,89,22,100,.95],
   ['initial-high-barrel-cap',10.5,'forest',560,1874,63,78,665,200,72,89,22,100,.95,50],
   ['first-rock',17.5,'forest',585,803,141,89,87,208,156,98,80,1000,.97],
   ['second-rock',25.5,'forest',585,803,141,89,183,321,161,102,80,1000,.97],
   ['back-barrel-cap',13.5,'forest',560,1874,63,78,270,316,72,89,22,100,.95],
   ['front-barrel-cap',17.5,'forest',560,1874,63,78,322,403,70,86,22,100,.95]
  ]}
};
assert.ok(profiles[room],'unknown room capture profile');const profile=profiles[room];
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.env.CAPTURE_OUT || profile.out;fs.mkdirSync(out,{recursive:true});
const cameras=JSON.parse(fs.readFileSync(path.join(root,`docs/reference-evidence/${profile.batch}-room${room}-camera.json`)));
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 const mime={'.png':'image/png','.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.ogg':'audio/ogg'};
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});
 if(process.env.ROOM_BASELINE==='1'&&room==='41'&&file===path.join(root,'src/core.js')){
  let source=fs.readFileSync(file,'utf8');const start=source.indexOf('/* 0 —— 路线 41'),end=source.indexOf('/* 1 —— 路线 25 Boss',start);
  assert.ok(start>=0&&end>start);let entry=source.slice(start,end);
  assert.ok(entry.includes('width: 960'));entry=entry.replace('width: 960','width: 560');
  const a=entry.indexOf('          props: ['),b=entry.indexOf('          scatter:',a);assert.ok(a>=0&&b>a);
  const oldProps=[{piece:'trunkTall',x:81,depth:2.03},{piece:'trunkMossy',x:228,depth:2.03},{piece:'trunkBent',x:374,depth:2.03},
   {piece:'rockFlat',x:242,depth:1.79,scale:[.34,.34]},{piece:'barrel',x:210,depth:.46},{piece:'barrel',x:378,depth:-.29},{piece:'fallenTrunk',x:304,depth:-.58}];
  entry=entry.slice(0,a)+'          props: '+JSON.stringify(oldProps)+',\n'+entry.slice(b);
  source=source.slice(0,start)+entry+source.slice(end);
  assert.equal(source.split('      0: 960,').length,2);source=source.replace('      0: 960,','      0: 560,');
  fs.writeFileSync(path.join(out,'baseline-core.js'),source);res.end(source);return;
 }
 fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1120,height:720}});
 await page.addInitScript(()=>localStorage.setItem('nano-dnf-progress',JSON.stringify({cleared:{mirkwood:true}})));
 await page.goto(process.env.CAPTURE_URL || `http://127.0.0.1:${server.address().port}/?seed=1`);
 await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready);
 await page.keyboard.press('Enter');await page.evaluate(()=>window.nanoDnf.leaveTown());
 await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.nanoDnf.getState().stage.id==='mirkwooddeep'&&!window.nanoDnf.getState().intro);
 await page.keyboard.press('p');
 await page.evaluate(()=>{
  const render=window.DNFRender.render;
  window.DNFRender.render=(ctx,state,meta)=>render(ctx,state,{...meta,paused:false});
 });
 const records=[],images={},actions=[];let prepared=false;
 for(const time of profile.times){
  if(room==='41'&&time>10.5&&!prepared&&process.env.ROOM_BASELINE!=='1'){
   const performed=await page.evaluate(()=>{
    const C=window.DNFCore,s=window.nanoDnf.getState(),result=[];s.player.invuln=100;
    // Build the observed post-hit state through real attacks, not flags/timers.
    for(const [x,input] of [[341,{skills:{ghostSlash:true}}],[444,{attack:true}]]){
     const prop=s.props.find(p=>p.piece==='barrel'&&p.x===x);if(!prop)throw new Error('missing initial barrel '+x);
     const before={hp:prop.hp,broken:prop.broken};
     s.player.x=prop.x-42;s.player.z=Math.min(prop.z,C.bandDepth(s.band));s.player.facing=1;
     C.runFrames(s,50,input);C.runFrames(s,40,{});
     if(!prop.broken)throw new Error('real attack did not break '+x);
     result.push({x,input,before,after:{hp:prop.hp,broken:prop.broken,gone:!!prop.gone}});
    }
    const remaining=s.props.filter(p=>p.piece==='barrel'&&!p.broken).map(p=>p.x);
    if(remaining.join(',')!=='328,498')throw new Error('wrong remaining barrels '+remaining);
    return result;
   });
   actions.push(...performed);prepared=true;
  }
  const camera=time===26.5?0:cameras.find(c=>c.t===time).camera_px;
  const record=await page.evaluate(({camera,time,col,row,entryDoor,actorScreenX})=>{
   const C=window.DNFCore,s=window.nanoDnf.getState();
   C.goToCell(s,s.dungeon.cells.findIndex(c=>c.col===col&&c.row===row));
   s.entryDoor=entryDoor===undefined?(col===0?null:'W'):entryDoor;s.titleT=0;s.intro=null;s.transition=0;
   // Relocate the actor only to keep the sampled native faces unobscured.
   s.player.x=(camera+(actorScreenX??(col===0?80:time<=28?240:200)))/C.CAMERA.zoom;s.player.z=40;
   s.player.hurtTimer=0;s.player.invuln=0;s.player.buffs={};
   s.camera.x=camera/C.CAMERA.zoom;s.time=10;
   window.nanoDnf.setMapMode('radar');
   return {time,room:s.room.name,width:s.room.width,cameraPx:camera,
    props:s.props.map(p=>({piece:p.piece,x:p.x,z:p.z,broken:p.broken,gone:!!p.gone,screenX:p.x*C.CAMERA.zoom-camera,bottom:430-C.depthLift(p.z)*C.CAMERA.zoom}))};
  },{camera,time,col:profile.col,row:profile.row??3,entryDoor:profile.entryDoor,actorScreenX:profile.actorScreenX});
  await page.waitForTimeout(100);
  const url=await page.locator('#stage').evaluate(c=>c.toDataURL('image/png'));
  images[time]=url;
  fs.writeFileSync(path.join(out,`${time}.png`),Buffer.from(url.split(',')[1],'base64'));
  records.push(record);
 }
 fs.writeFileSync(path.join(out,'poses.json'),JSON.stringify(records,null,2)+'\n');
 fs.writeFileSync(path.join(out,'fixture-actions.json'),JSON.stringify(actions,null,2)+'\n');
 const refTimes=[...new Set(profile.cases.map(c=>c[1]))];
 const reference=Object.fromEntries(refTimes.map(t=>{
  const name=t===26.5?'47-room42-entry-reference.png':`${profile.batch}-room${room}-${t}-reference.png`;
  return [t,fs.readFileSync(path.join(root,'docs/reference-evidence',name)).toString('base64')];
 }));
 const native=Object.fromEntries([['pillar','pillar-pale.png'],['forest','forest.png'],['bunker','goblin-bunker.png'],['tree','tree-reference.png']].map(([key,name])=>[key,fs.readFileSync(path.join(root,'assets',name)).toString('base64')]));
 const faces=await page.evaluate(async({reference,images,native,cases})=>{
  async function picture(url){const im=new Image();im.src=url;await im.decode();return im;}
  function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d');}
  const atlases={},refs={},actuals={};
  for(const [key,value] of Object.entries(native))atlases[key]=await picture('data:image/png;base64,'+value);
  for(const t of Object.keys(reference)){
   const r=canvas(720,540);r.drawImage(await picture('data:image/png;base64,'+reference[t]),0,0);refs[t]=r;
   const a=canvas(960,540);a.drawImage(await picture(images[t]),0,0);actuals[t]=a;
  }
  const result=[];
  for(const [label,time,sheet,sx,sy,sw,sh,x,y,w,h,cutoff,minPixels,threshold,maxX,maskBox,alphaOnly] of cases){
   const c=canvas(w,h);c.drawImage(atlases[sheet],sx,sy,sw,sh,0,0,w,h);
   const mask=c.getImageData(0,0,w,h).data,ref=refs[time].getImageData(x,y,w,h).data;let best={cosine:0};
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const actual=actuals[time].getImageData(x+120+dx,y+dy,w,h).data;let dot=0,a2=0,b2=0,pixels=0;
    for(let i=0;i<mask.length;i+=4){
     const px=(i/4)%w,py=Math.floor(i/4/w);
     if(maskBox&&(px<maskBox[0]||py<maskBox[1]||px>=maskBox[2]||py>=maskBox[3]))continue;
     if((i/4)%w>=(maxX||w)||Math.floor(i/4/w)>=cutoff||mask[i+3]<=220||(!alphaOnly&&(mask[i]<=70||mask[i+1]<=70||mask[i+2]<=45)))continue;
     pixels++;for(let k=0;k<3;k++){dot+=ref[i+k]*actual[i+k];a2+=ref[i+k]**2;b2+=actual[i+k]**2;}
    }
    const cosine=dot/Math.sqrt(a2*b2);if(cosine>best.cosine)best={cosine,dx,dy,pixels};
   }
   result.push({label,time,minPixels,threshold,nativeMask:{rows:cutoff,columns:maxX||w,alphaOnly:!!alphaOnly,box:maskBox||null},...best});
  }
  return result;
 },{reference,images,native,cases:profile.cases});
 fs.writeFileSync(path.join(out,'browser-comparison.json'),JSON.stringify(faces,null,2)+'\n');
 const span=Math.max(...cameras.map(c=>c.camera_px))-Math.min(...cameras.map(c=>c.camera_px));
 assert.ok(records[0].width*265/168>=720+span,`room${room} must contain the independently observed camera span`);
 if(room==='42')assert.equal(records[0].props.filter(p=>p.piece==='chest').length,2);
 else if(room==='41'){
  assert.equal(records[0].props.filter(p=>p.piece==='rockFlat').length,2);
  assert.equal(records[0].props.filter(p=>p.piece==='barrel'&&!p.broken).length,4);
  assert.equal(records[1].props.filter(p=>p.piece==='barrel'&&!p.broken).length,2);
 }
 for(const face of faces)assert.ok(face.pixels>face.minPixels&&face.cosine>face.threshold,`${face.label} native face matches its measured source anchor`);

 if(profile.boss){
  await page.evaluate(()=>{const s=window.nanoDnf.getState();s.player.x=1000;s.player.z=125;s.player.invuln=100;s.player.vx=s.player.vz=0;s.transition=0;s.intro=null;});
  await page.keyboard.press('p');await page.keyboard.down('ArrowRight');
  await page.waitForFunction(()=>{const s=window.nanoDnf.getState();return s.player.x>=window.DNFCore.roomRight(s)-s.player.width/2-2;},null,{timeout:15000});
  await page.keyboard.up('ArrowRight');
  const travel=await page.evaluate(()=>{const s=window.nanoDnf.getState();return {room:s.room.name,x:s.player.x,cameraPx:s.camera.x*window.DNFCore.CAMERA.zoom};});
  assert.ok(travel.cameraPx>=span,'keyboard movement reaches observed far-right camera');travel.validationScope=profile.scope;
  fs.writeFileSync(path.join(out,'travel.json'),JSON.stringify(travel,null,2)+'\n');
  console.log(`room${room} native prop captures + far-right keyboard movement OK`,out);
 }else{
 // Clear through the real damage path, then leave the extended room by keyboard.
 const departure=await page.evaluate(exit=>{
  const C=window.DNFCore,s=window.nanoDnf.getState();
  // Keep the capture actor outside an open entry gate during forced clearing.
  s.player.x=C.roomWidth(s)/2;s.player.z=C.bandDepth(s.band)/2;s.player.vx=s.player.vz=0;
  for(let n=0;n<12&&!s.room.cleared;n++){
   s.enemies.slice().forEach(e=>{if(!e.dead)C.damageEnemy(s,e,99999,0,s.player.x);});C.runFrames(s,60,{});
  }
  if(!s.room.cleared)throw new Error('captured room did not clear');
  if(exit==='N'){
   s.player.x=C.doorX(s,C.currentCell(s),'N');s.player.z=C.bandDepth(s.band)-C.DOOR.depth-20;
  }else{s.player.x=exit==='W'?C.roomLeft(s)+C.DOOR.side+20:C.roomRight(s)-C.DOOR.side-20;s.player.z=C.bandDepth(s.band)/2;}
  return {x:s.player.x,z:s.player.z,exit,sideThreshold:C.DOOR.side,depthThreshold:C.DOOR.depth,sideDistance:exit==='W'?s.player.x-C.roomLeft(s):C.roomRight(s)-s.player.x,northDistance:C.bandDepth(s.band)-s.player.z};
 },profile.exit||'E');
 assert.ok(departure.exit==='N'?departure.northDistance>departure.depthThreshold:departure.sideDistance>departure.sideThreshold,'departure starts outside the door trigger');
 const key=profile.exit==='N'?'ArrowUp':profile.exit==='W'?'ArrowLeft':'ArrowRight';
 await page.keyboard.press('p');await page.keyboard.down(key);
 await page.waitForFunction(({col,row,exit})=>{const s=window.nanoDnf.getState(),c=s.dungeon.cells[s.cell];return exit==='N'?c.col===col&&c.row===row-1:exit==='W'?c.col===col-1&&c.row===row:c.col===col+1&&c.row===row;},{col:profile.col,row:profile.row??3,exit:profile.exit});
 await page.keyboard.up(key);
 const travel=await page.evaluate(()=>({room:window.nanoDnf.getState().room.name}));
 travel.departure=departure;
 if(profile.scope)travel.validationScope=profile.scope;
 assert.equal(travel.room,profile.next);
 if(profile.extraEast){
  await page.keyboard.press('p');
  await page.evaluate(()=>{
   const C=window.DNFCore,s=window.nanoDnf.getState();
   C.goToCell(s,s.dungeon.cells.findIndex(c=>c.col===2&&c.row===1));
   s.intro=null;s.transition=s.titleT=0;s.player.x=C.doorX(s,C.currentCell(s),'N');
   s.player.z=C.bandDepth(s.band)/2;s.player.vx=s.player.vz=0;
  });
  await page.keyboard.press('p');await page.keyboard.down('ArrowRight');
  await page.waitForFunction(()=>window.nanoDnf.getState().player.x>=640);
  await page.keyboard.up('ArrowRight');await page.keyboard.press('x');
  await page.waitForFunction(()=>window.nanoDnf.getState().props.find(p=>p.piece==='barrel'&&p.x===713)?.broken);
  await page.keyboard.down('ArrowRight');
  try{
  await page.waitForFunction(()=>{const s=window.nanoDnf.getState(),c=s.dungeon.cells[s.cell];return c.col===3&&c.row===1;},null,{timeout:30000});
  }catch(error){
   const blocked=await page.evaluate(()=>{const s=window.nanoDnf.getState();return {cell:s.cell,room:s.room.name,cleared:s.room.cleared,transition:s.transition,player:s.player,props:s.props};});
   fs.writeFileSync(path.join(out,'east-blocked.json'),JSON.stringify(blocked,null,2)+'\n');
   await page.locator('#stage').screenshot({path:path.join(out,'east-blocked.png')});
   throw error;
  }
  await page.keyboard.up('x');await page.keyboard.up('ArrowRight');
  travel.east=await page.evaluate(()=>{
   const s=window.nanoDnf.getState(),original=s.dungeon.cells.find(c=>c.col===2&&c.row===1);
   return {room:s.room.name,barrel713Broken:!!original.props.find(p=>p.piece==='barrel'&&p.x===713)?.broken};
  });
  assert.equal(travel.east.room,'断墙营地');assert.equal(travel.east.barrel713Broken,true);
 }
 if(profile.extraSouth){
  await page.keyboard.press('p');
  await page.evaluate(()=>{
   const C=window.DNFCore,s=window.nanoDnf.getState();C.goToCell(s,s.dungeon.cells.findIndex(c=>c.col===2&&c.row===0));
   s.transition=s.titleT=0;s.intro=null;s.player.x=C.doorX(s,C.currentCell(s),'S');s.player.z=C.DOOR.depth+20;
  });
  await page.keyboard.press('p');await page.keyboard.down('ArrowDown');
  await page.waitForFunction(()=>{const s=window.nanoDnf.getState(),c=s.dungeon.cells[s.cell];return c.col===2&&c.row===1;});
  await page.keyboard.up('ArrowDown');travel.south=await page.evaluate(()=>({room:window.nanoDnf.getState().room.name}));
  assert.equal(travel.south.room,'投掷手坡');
 }
 fs.writeFileSync(path.join(out,'travel.json'),JSON.stringify(travel,null,2)+'\n');
 console.log(`room${room} measured-camera captures + ${profile.exit||'E'} keyboard travel OK`,out);
}
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
