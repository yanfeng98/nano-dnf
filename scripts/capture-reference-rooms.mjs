// Shared measured-camera room captures. Entry points select a room profile.
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const room=process.env.CAPTURE_ROOM || '42';
const profiles={
 '24-closeback':{cameraTolerance:1,evidence:'54-room24',col:3,row:1,out:'/tmp/nano-room66/render',times:[277,281,293,307],actorScreenX:80,entryDoor:'W',exit:'E',next:'暗咒猫妖的林地',
  scope:'native room 24 closeback at four measured cameras; other scenery and physical props remain open',
  cases:[
   ['entry-tree',277,'room24Closeback',(340+.01)/1.125,178/1.125,60/1.125,40/1.125,340,180,60,40,40,1500,.97,null,null,true],
   ['west-tree',281,'room24Closeback',(340+264.35)/1.125,178/1.125,60/1.125,40/1.125,340,180,60,40,40,1500,.97,null,null,true],
   ['center-tree',293,'room24Closeback',(520+533.25)/1.125,178/1.125,60/1.125,40/1.125,520,180,60,40,40,1500,.97,null,null,true],
   ['east-tree',307,'room24Closeback',(400+1013.63)/1.125,138/1.125,60/1.125,40/1.125,400,140,60,40,40,1500,.97,null,null,true],
   ['upper-floor',277,'forest',672+((144+0.01)/1.125)%224,380+(376-233)/1.125,36/1.125,24/1.125,144,376,36,24,24,800,.6,null,null,true,15],
   ['descending-floor',277,'forest',448+((336+0.01)/1.125)%224,380+(416-235.25)/1.125,36/1.125,24/1.125,336,416,36,24,24,800,.6,null,null,true,15],
   ['lower-floor',281,'forest',0+((288+264.35)/1.125)%224,380+(424-269)/1.125,36/1.125,24/1.125,288,424,36,24,24,800,.6,null,null,true,15],
   ['ascending-floor',293,'forest',224+((612+533.25)/1.125)%224,380+(400-235.25)/1.125,36/1.125,24/1.125,612,400,36,24,24,800,.6,null,null,true,15],
   ['east-floor',307,'forest',672+((576+1013.63)/1.125)%224,380+(384-233)/1.125,36/1.125,24/1.125,576,384,36,24,24,800,.6,null,null,true,15]
  ]},
 '14-closeback':{evidence:'53-room14',referenceNames:{261.3:'53-room14-maximum-camera-reference.png'},col:3,row:0,out:'/tmp/nano-room65/render',times:[236.5,260,261.3,265.5],actorScreenX:80,entryDoor:'W',exit:'W',next:'老树回廊',
  scope:'native room 14 closeback at four measured cameras including the eastern limit; other scenery and physical props remain open',
  cases:[
   ['entry-tree',236.5,'room14Closeback',(160+.15)/1.125,98/1.125,60/1.125,40/1.125,160,100,60,40,40,1500,.97,null,null,true],
   ['east-canopy',260,'room14Closeback',(280+756.61)/1.125,58/1.125,60/1.125,40/1.125,280,60,60,40,40,1500,.97,null,null,true],
   ['east-limit-tree',261.3,'room14Closeback',(280+791.6)/1.125,178/1.125,60/1.125,40/1.125,280,180,60,40,40,1500,.97,null,null,true],
   ['return-tree',265.5,'room14Closeback',(460+.63)/1.125,178/1.125,60/1.125,40/1.125,460,180,60,40,40,1500,.97,null,null,true],
   ['entry-floor',236.5,'forest',672+(180+.15)/1.125,380+(376-233)/1.125,48/1.125,32/1.125,180,376,48,32,32,1400,.6,null,null,true,13],
   ['east-floor',260,'forest',672+((460+756.61)/1.125)%224,380+(280-233)/1.125,42/1.125,32/1.125,460,280,42,32,32,1300,.55,null,null,true,13],
   ['east-limit-floor',261.3,'forest',672+((420+791.6)/1.125)%224,380+(280-233)/1.125,48/1.125,32/1.125,420,280,48,32,32,1400,.55,null,null,true,13],
   ['return-floor',265.5,'forest',672+(180+.63)/1.125,380+(376-233)/1.125,48/1.125,32/1.125,180,376,48,32,32,1400,.6,null,null,true,13]
  ]},
 '13-closeback':{cameraTolerance:1,evidence:'52-room13',col:2,row:0,out:'/tmp/nano-room64/render',times:[190,210,235.5,271.5],actorScreenX:80,entryDoor:'S',exit:'E',next:'残柱祭坛',extraSouth:'投掷手坡',
  scope:'native room 13 closeback at four measured cameras including a revisit; other scenery and physical props remain open',
  cases:[
   ['entry-tree',190,'room13Closeback',520/1.125,178/1.125,60/1.125,40/1.125,520,180,60,40,40,1500,.97,null,null,true],
   ['center-tree',210,'room13Closeback',(400+497.23)/1.125,58/1.125,60/1.125,40/1.125,400,60,60,40,40,1500,.97,null,null,true],
   ['east-tree',235.5,'room13Closeback',(400+1249.91)/1.125,138/1.125,60/1.125,40/1.125,400,140,60,40,40,1500,.97,null,null,true],
   ['revisit-tree',271.5,'room13Closeback',(220+166.85)/1.125,58/1.125,60/1.125,40/1.125,220,60,60,40,40,1500,.97,null,null,true],
   ['entry-floor',190,'forest',672+((360+0+46.125)/1.125)%224,380+(332-233)/1.125,36/1.125,24/1.125,360,332,36,24,24,800,.6,null,null,true,14],
   ['middle-floor',210,'forest',672+((420+497.23+46.125)/1.125)%224,380+(420-233)/1.125,36/1.125,24/1.125,420,420,36,24,24,800,.6,null,null,true,14],
   ['east-floor',235.5,'forest',672+((348+1249.91+46.125)/1.125)%224,380+(396-233)/1.125,36/1.125,24/1.125,348,396,36,24,24,800,.6,null,null,true,14],
   ['revisit-floor',271.5,'forest',672+((192+166.85+46.125)/1.125)%224,380+(316-233)/1.125,36/1.125,24/1.125,192,316,36,24,24,800,.6,null,null,true,14]
  ]},
 '23-closeback':{cameraTolerance:1,evidence:'51-room23',referenceNames:{153.5:'63-room23-153.5-reference.png'},col:2,row:1,out:'/tmp/nano-room63/render',times:[148,150,153.5,180],actorScreenX:80,entryDoor:'S',exit:'N',next:'老树回廊',extraSouth:'藤蔓窄道',
  scope:'native room 23 closeback at four measured cameras; physical props and other scenery layers remain open',
  cases:[
   ['entry-tree',148,'room23Closeback',(160+600.81)/1.125,138/1.125,60/1.125,40/1.125,160,140,60,40,40,1000,.97,null,null,true],
   ['center-tree',150,'room23Closeback',(520+734.75)/1.125,138/1.125,60/1.125,40/1.125,520,140,60,40,40,1500,.97,null,null,true],
   ['east-tree',153.5,'room23Closeback',(460+1244.36)/1.125,178/1.125,60/1.125,40/1.125,460,180,60,40,40,1500,.97,null,null,true],
   ['west-tree',180,'room23Closeback',(160+2.26)/1.125,178/1.125,60/1.125,40/1.125,160,180,60,40,40,1500,.97,null,null,true],
   ['entry-floor',148,'forest',672+((180+600.81+51.75)/1.125)%224,380+(388-233)/1.125,36/1.125,24/1.125,180,388,36,24,24,800,.6,null,null,true,14],
   ['center-floor',150,'forest',672+((432+734.75+51.75)/1.125)%224,380+(420-233)/1.125,36/1.125,24/1.125,432,420,36,24,24,800,.6,null,null,true,14],
   ['east-floor',153.5,'forest',672+((552+1244.36+51.75)/1.125)%224,380+(388-233)/1.125,36/1.125,24/1.125,552,388,36,24,24,800,.6,null,null,true,14],
   ['west-floor',180,'forest',672+((324+2.26+51.75)/1.125)%224,380+(396-233)/1.125,36/1.125,24/1.125,324,396,36,24,24,800,.6,null,null,true,14]
  ]},
 '33-closeback':{evidence:'50-room33',col:2,row:2,out:'/tmp/nano-room62/render',times:[106,125,133,146],actorScreenX:80,entryDoor:'S',exit:'N',next:'投掷手坡',
  scope:'native room 33 closeback at four measured cameras; props and other scenery layers remain open',
  cases:[
   ['entry-tree',106,'room33Closeback',(580+712.56)/1.125,178/1.125,60/1.125,40/1.125,580,180,60,40,40,1500,.97,null,null,true],
   ['east-tree',125,'room33Closeback',(580+906)/1.125,178/1.125,60/1.125,40/1.125,580,180,60,40,40,1500,.97,null,null,true],
   ['center-tree',133,'room33Closeback',(160+554.49)/1.125,138/1.125,60/1.125,40/1.125,160,140,60,40,40,1000,.97,null,null,true],
   ['west-tree',146,'room33Closeback',(340+111.38)/1.125,138/1.125,60/1.125,40/1.125,340,140,60,40,40,900,.97,null,null,true],
   ['entry-floor',106,'forest',672+((132+712.56+12.375)/1.125)%224,380+(380-233)/1.125,36/1.125,24/1.125,132,380,36,24,24,800,.6,null,null,true,14],
   ['east-floor',125,'forest',672+((192+906+12.375)/1.125)%224,380+(396-233)/1.125,36/1.125,24/1.125,192,396,36,24,24,800,.6,null,null,true,14],
   ['center-floor',133,'forest',672+((540+554.49+12.375)/1.125)%224,380+(396-233)/1.125,36/1.125,24/1.125,540,396,36,24,24,800,.6,null,null,true,14],
   ['west-floor',146,'forest',672+((180+111.38+12.375)/1.125)%224,380+(396-233)/1.125,36/1.125,24/1.125,180,396,36,24,24,800,.6,null,null,true,14]
  ]},
 '43-rocks':{cameraTolerance:1,evidence:'99-room43',col:2,row:3,out:'/tmp/nano-room99/render',times:[76.25,82.25,87.75],actorScreenX:80,exit:'N',next:'藤蔓窄道',
  scope:'three native room43 StoneHead bitmaps; other scenery and native engine collision semantics remain open',
  cases:[
   ['native-rock-519',76.25,'forest',585,803,141,89,310,357,159,100,60,2000,.97],
   ['native-rock-1045',82.25,'forest',585,803,141,89,354,398,159,100,55,1500,.97],
   ['native-rock-1490',87.75,'forest',585,803,141,89,314,399,159,100,55,1500,.97]
  ]},
 '43-pillars':{cameraTolerance:1,evidence:'97-room43',col:2,row:3,out:'/tmp/nano-room97/render',times:[76.25,79.25,82.25],actorScreenX:80,exit:'N',next:'藤蔓窄道',
  scope:'six independently identified room43 native pillars at three measured cameras; other scenery remains open',
  cases:[
   ['native-700-cap',76.25,'pillar',0,0,44,133,557,152,50,150,30,300,.97],
   ['native-746-cap',76.25,'pillar',0,0,44,133,609,190,50,150,30,300,.97],
   ['native-920-cap',79.25,'pillar',0,0,44,133,496,309,50,150,30,300,.97],
   ['native-966-cap',79.25,'pillar',0,0,44,133,548,350,50,150,30,300,.97],
   ['native-1208-cap',82.25,'pillar',0,0,44,133,581,225,50,150,30,300,.97],
   ['native-1250-cap',82.25,'pillar',0,0,44,133,628,255,50,150,30,300,.97]
  ]},
 '43-closeback':{cameraTolerance:1,evidence:'02-room43',referenceNames:{74.25:'02-room43-074.25.png',90.25:'02-room43-090.25.png',104.25:'02-room43-104.25.png'},col:2,row:3,out:'/tmp/nano-room61/render',times:[74.25,90.25,104.25],actorScreenX:80,exit:'N',next:'藤蔓窄道',
  scope:'native room 43 closeback at three measured cameras; physical props and other scenery layers remain open',
  cases:[
   ['west-tree',74.25,'room43Closeback',280/1.125,178/1.125,60/1.125,40/1.125,280,180,60,40,40,1500,.97,null,null,true],
   ['east-wall',90.25,'room43Closeback',(520+1200.42)/1.125,138/1.125,60/1.125,40/1.125,520,140,60,40,40,1500,.97,null,null,true],
   ['north-gate-tree',104.25,'room43Closeback',(100+1047.41)/1.125,58/1.125,60/1.125,40/1.125,100,60,60,40,40,1500,.97,null,null,true],
   ['west-floor',74.25,'forest',672+216/1.125,380+(420-233)/1.125,36/1.125,24/1.125,216,420,36,24,24,800,.6,null,null,true,14],
   ['east-floor',90.25,'forest',672+((372+1200.42)/1.125)%224,380+(388-233)/1.125,36/1.125,24/1.125,372,388,36,24,24,800,.6,null,null,true,14],
   ['return-floor',104.25,'forest',672+((528+1047.41)/1.125)%224,380+(388-233)/1.125,36/1.125,24/1.125,528,388,36,24,24,800,.6,null,null,true,14]
  ]},
 '42-closeback':{batch:60,col:1,row:3,out:'/tmp/nano-room60/render',times:[28,72.5,73.5],actorScreenX:80,next:'猫妖岔路',
  scope:'native room 42 closeback at three measured cameras; physical props, other layers and scenery lifecycle remain open',
  cases:[
   ['west-wall',28,'room42Closeback',270/1.125,88/1.125,180/1.125,30/1.125,270,90,180,30,30,2000,.97,null,null,true],
   ['east-wall',72.5,'room42Closeback',(270+1164.12)/1.125,88/1.125,180/1.125,30/1.125,270,90,180,30,30,2000,.97,null,null,true],
   ['east-gate-wall',73.5,'room42Closeback',(270+1295.73)/1.125,88/1.125,180/1.125,30/1.125,270,90,180,30,30,2000,.97,null,null,true],
   ['upper-floor',28,'forest',672+((144+0)/1.125)%224,380+(376-233)/1.125,36/1.125,24/1.125,144,376,36,24,24,800,.6,null,null,true,15],
   ['transition-floor',28,'forest',448+((252+0)/1.125)%224,380+(416-235.25)/1.125,36/1.125,24/1.125,252,416,36,24,24,800,.6,null,null,true,15],
   ['lower-floor',72.5,'forest',0+((552+1164.12)/1.125)%224,380+(408-269)/1.125,36/1.125,24/1.125,552,408,36,24,24,800,.6,null,null,true,15],
   ['east-floor',73.5,'forest',0+((420+1295.73)/1.125)%224,380+(408-269)/1.125,36/1.125,24/1.125,420,408,36,24,24,800,.6,null,null,true,15]
  ]},
 '41-closeback':{batch:59,col:0,row:3,out:'/tmp/nano-room59/render',times:[10.5,13.5,17.5,25.5],actorScreenX:80,next:'宝箱浅沟',
  scope:'native entry closeback and measured phase at four cameras; fade, other layers and scenery lifecycle remain open',
  cases:[
   ['entry-west-wall',10.5,'entryCloseback',270/1.125,78/1.125,290/1.125,80/1.125,270,80,290,80,80,10000,.97,null,null,true],
   ['entry-tree0',13.5,'entryCloseback',(270+210.27)/1.125,78/1.125,290/1.125,80/1.125,270,80,290,80,80,10000,.97,null,null,true],
   ['entry-middle-wall',17.5,'entryCloseback',(270+427.4)/1.125,78/1.125,290/1.125,50/1.125,270,80,290,50,50,6000,.97,null,null,true],
   ['entry-east-wall',25.5,'entryCloseback',(270+791.92)/1.125,78/1.125,240/1.125,50/1.125,270,80,240,50,50,5000,.97,null,null,true],
   ['mid-west',13.5,'forest',640+(441+210.27*.9)%720/1.125,(74+106.5)/1.125,31/1.125,35/1.125,441,74,31,35,35,600,.75,null,null,true,10],
   ['mid-center',17.5,'forest',640+(408+427.4*.9)%720/1.125,(6+106.5)/1.125,31/1.125,35/1.125,408,6,31,35,35,600,.75,null,null,true,10],
   ['mid-east',25.5,'forest',640+(452+791.92*.9)%720/1.125,(142+106.5)/1.125,31/1.125,35/1.125,452,142,31,35,35,600,.75,null,null,true,10],
   ['entry-west-floor',13.5,'forest',672+((384+210.27)/1.125)%224,380+(420-233)/1.125,36/1.125,24/1.125,384,420,36,24,24,800,.6,null,null,true,14],
   ['entry-center-floor',17.5,'forest',672+((168+427.4)/1.125)%224,380+(420-233)/1.125,36/1.125,24/1.125,168,420,36,24,24,800,.6,null,null,true,14],
   ['entry-east-floor',25.5,'forest',672+((528+791.92)/1.125)%224,380+(404-233)/1.125,36/1.125,24/1.125,528,404,36,24,24,800,.6,null,null,true,14]
  ]},
 '25-closeback':{cameraTolerance:1,batch:58,col:4,row:1,out:'/tmp/nano-room58/render',times:[312,314.5,319,330,370],actorScreenX:80,boss:true,
  scope:'native boss closeback list and measured phase at five cameras; far/mid motion, floor, foreground, actors and object lifecycle remain open',
  cases:[
   ['west-wall',312,'closeback',185/1.125,78/1.125,395/1.125,200/1.125,185,80,395,200,200,30000,.97,null,null,true],
   ['west-middle-wall',314.5,'closeback',(250+291.44)/1.125,78/1.125,300/1.125,90/1.125,250,80,300,90,90,10000,.97,null,null,true],
   ['central-tree4',319,'closeback',(450+1047.05)/1.125,78/1.125,120/1.125,120/1.125,450,80,120,120,120,8000,.97,null,null,true],
   ['east-wall',330,'closeback',(185+1547.69)/1.125,98/1.125,395/1.125,120/1.125,185,100,395,120,120,20000,.97,null,null,true],
   ['east-wall-revisit',370,'closeback',(185+1453.32)/1.125,98/1.125,395/1.125,70/1.125,185,100,395,70,70,12000,.97,null,null,true],
   ['west-floor',312,'forest',0+((168+0.02)/1.125)%224,380+(352-269)/1.125,36/1.125,24/1.125,168,352,36,24,24,800,.6,null,null,true,15],
   ['rising-floor',314.5,'forest',224+((336+291.44)/1.125)%224,380+(424-235.25)/1.125,36/1.125,24/1.125,336,424,36,24,24,800,.6,null,null,true,15],
   ['descending-floor',319,'forest',448+((120+1047.05)/1.125)%224,380+(424-235.25)/1.125,36/1.125,24/1.125,120,424,36,24,24,800,.6,null,null,true,15],
   ['east-floor',330,'forest',672+((372+1547.69)/1.125)%224,380+(376-233)/1.125,36/1.125,24/1.125,372,376,36,24,24,800,.6,null,null,true,15],
   ['east-revisit-floor',370,'forest',224+((264+1453.32)/1.125)%224,380+(424-235.25)/1.125,36/1.125,24/1.125,264,424,36,24,24,800,.6,null,null,true,15]
  ]},
 '25-trees':{cameraTolerance:1,batch:57,col:4,row:1,out:'/tmp/nano-room57/render',times:[316.5,317,319,320],actorScreenX:80,boss:true,
  scope:'four earliest visible fruit-tree forms and visible native regions; hidden roots, depletion trigger and fruit/hit lifecycle remain open',
  cases:[
   ['first-back-fruit',316.5,'fruitTree',0,0,153,203,494,96,173,227,190,1000,.97,62,null,true],
   ['first-front-fruit',319,'fruitTree',0,0,153,203,188,127,173,229,229,5000,.97,null,null,true],
   ['second-back-initial-fruit',317,'fruitTree',0,0,153,203,638,231,171,227,100,500,.97,61,null,true],
   ['second-front-fruit',320,'fruitTree',0,0,153,203,213,271,171,229,192,5000,.97,null,null,true]
  ]},
 '25':{cameraTolerance:1,batch:56,col:4,row:1,out:'/tmp/nano-room56/render',times:[314,315,317,318,319,320,330],actorScreenX:360,boss:true,
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
 '24-west-gate':{cameraTolerance:1,evidence:'54-room24',col:3,row:1,out:'/tmp/nano-room103/render',times:[277,277.5,278],actorScreenX:210,exit:'W',next:'投掷手坡',entryDoor:'W',
  referenceNames:{277.5:'103-room24-277.5-reference.png',278:'103-room24-278-reference.png'},
  scope:'native west frame/bush geometry; existing exitMode retained, leaf-state discrepancy and native fade/light timing remain open',
  cases:[
   ['west-frame-post',277,'nativePathGate',233+117/1.125,100/1.125,30/1.125,70/1.125,94,249,30,70,70,100,.97,null,null,true],
   ['west-frame-post-later',278,'nativePathGate',233+117/1.125,100/1.125,30/1.125,70/1.125,92,249,30,70,70,100,.97,null,null,true],
   ['west-over-bush',277.5,'nativePathGate',60/1.125,35/1.125,60/1.125,45/1.125,3,389,60,45,45,500,.97,null,null,true],
   ['west-over-bush-later',278,'nativePathGate',60/1.125,35/1.125,60/1.125,45/1.125,1,389,60,45,45,500,.97,null,null,true]
  ]},
 '24-foreground':{cameraTolerance:1,evidence:'54-room24',col:3,row:1,out:'/tmp/nano-room102/render',times:[277,281,293,307],actorScreenX:40,next:'暗咒猫妖的林地',exit:'E',entryDoor:'W',
  scope:'native close-layer texture and110% camera motion; unmatched objects/features and other scene requirements remain open',
  cases:[
   ['close-fallen-log',277,'room24Foreground',139,50,317,175,156,430,357,197,25,100,.97,null,null,true],
   ['close-canopy-west',281,'room24Foreground',587,17,153,203,370,393,172,228,60,2000,.97,null,null,true],
   ['close-canopy-return',293,'room24Foreground',587,17,153,203,74,393,172,228,60,2000,.97,null,null,true],
   ['close-canopy-east',307,'room24Foreground',1313,42,153,203,362,421,172,228,35,1000,.97,null,null,true]
  ]},
 '24':{cameraTolerance:1,batch:54,col:3,row:1,out:'/tmp/nano-room54/render',times:[277,281,293,307],actorScreenX:40,next:'暗咒猫妖的林地',exit:'E',entryDoor:'W',
  cases:[
   ['front-barrel',277,'forest',560,1874,63,78,472,370,72,89,22,100,.95],
   ['middle-barrel',277,'forest',560,1874,63,78,428,296,70,86,22,100,.95],
   ['back-barrel',277,'forest',560,1874,63,78,458,247,72,89,22,100,.95],
   ['native-bush-592',293,'nativeFlora',256,0,64,59,98,250,72,66,66,1000,.97,null,null,true],
   ['native-bush-680',293,'nativeFlora',256,0,64,59,197,273,72,66,66,1000,.97,null,null,true],
   ['single-large-rock',277,'forest',585,803,141,89,494,286,159,100,60,1000,.97],
   ['rock-after-pan',281,'forest',585,803,141,89,230,286,159,100,60,1000,.97],
   ['first-green-tree',293,'tree',0,0,153,203,303,162,171,229,229,5000,.97,null,null,true],
   ['second-green-tree',307,'tree',0,0,153,203,192,169,173,227,227,5000,.97,null,null,true]
  ]},
 '14':{batch:53,col:3,row:0,out:'/tmp/nano-room53/render',times:[236.5,260,265.5],next:'老树回廊',exit:'W',entryDoor:'W',
  scope:'camera capacity and west-door keyboard only; tree and gate artwork remain unverified',cases:[]},
 '13':{cameraTolerance:1,batch:52,col:2,row:0,out:'/tmp/nano-room52/render',times:[190,210,235.5,268,271.5],next:'残柱祭坛',exit:'E',entryDoor:'S',extraSouth:'投掷手坡',
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
 '23':{cameraTolerance:1,batch:51,col:2,row:1,out:'/tmp/nano-room51/render',times:[148,150,180],next:'老树回廊',exit:'N',entryDoor:'S',extraEast:true,
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
 '41':{batch:47,col:0,out:'/tmp/nano-room47/render',times:[10.5,13.5,15.5,17.5,21,25.5],next:'宝箱浅沟',
  referenceNames:{15.5:'100-room41-15.5-reference.png',21:'100-room41-21-reference.png'},
  cases:[
   ['initial-back-barrel-cap',10.5,'forest',560,1874,63,78,502,256,72,89,22,100,.95],
   ['initial-high-barrel-cap',10.5,'forest',560,1874,63,78,665,200,72,89,22,100,.95,50],
   ['first-rock',17.5,'forest',585,803,141,89,86,207,159,100,80,1000,.97],
   ['first-rock-unoccluded',15.5,'forest',585,803,141,89,126,207,159,100,80,1000,.97],
   ['second-rock',25.5,'forest',585,803,141,89,185,322,159,100,80,1000,.97],
   ['second-rock-west-camera',21,'forest',585,803,141,89,299,322,159,100,80,1000,.97],
   ['back-barrel-cap',13.5,'forest',560,1874,63,78,270,316,72,89,22,100,.95],
   ['front-barrel-cap',17.5,'forest',560,1874,63,78,322,403,70,86,22,100,.95]
  ]}
};
assert.ok(profiles[room],'unknown room capture profile');const profile=profiles[room];
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Fixed native bark regions independently measured from the recording.
const measuredMid=JSON.parse(fs.readFileSync(path.join(root,'docs/reference-evidence/86-deep-mid-measurement.json'),'utf8')).rooms.find(r=>room===`${r.room}-closeback`);
if(measuredMid){
 for(const sample of measuredMid.samples){
  const [x,y,w,h]=sample.roi;
  const phase=((x+(sample.camera_px+measuredMid.originX*1.125)*measuredMid.scroll)%720+720)%720;
  profile.cases.push([`mid-${measuredMid.room}-${sample.time}`,sample.time,'forest',640+phase/1.125,(y-measuredMid.screenY)/1.125,w/1.125,h/1.125,x,y,w,h,h,Math.floor(w*h*.55),.7,null,null,true,12]);
 }
}
const pillarDamageObservations = room==='42'||room==='42-closeback'
 ? JSON.parse(fs.readFileSync(path.join(root,'docs/reference-evidence/88-pillar-anchors.json'),'utf8')).observations.filter(o=>o.kind==='damaged') : [];
const farSamples=JSON.parse(fs.readFileSync(path.join(root,'docs/reference-evidence/87-deep-far-measurement.json'),'utf8')).samples.filter(s=>room===`${s.room}-closeback`);
for(const sample of farSamples){
 profile.cases.push([`far-${sample.room}-${sample.time}`,sample.time,`far-mask-${sample.room}-${sample.time}`,0,0,720,120,0,0,720,120,120,Math.floor(sample.pixels*.95),.65,null,null,true,20]);
}
const out=process.env.CAPTURE_OUT || profile.out;fs.mkdirSync(out,{recursive:true});
const evidence=profile.evidence ?? `${profile.batch}-room${room}`;
const cameras=JSON.parse(fs.readFileSync(path.join(root,`docs/reference-evidence/${evidence}-camera.json`)));
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 const mime={'.png':'image/png','.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.ogg':'audio/ogg'};
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});
 if(process.env.ROOM_BASELINE==='1'&&room==='41'&&file===path.join(root,'src/core.js')){
  let source=fs.readFileSync(file,'utf8');const start=source.indexOf('/* 0 —— 路线 41'),end=source.indexOf('/* 1 —— 路线 25 Boss',start);
  assert.ok(start>=0&&end>start);let entry=source.slice(start,end);
  assert.ok(entry.includes('width: 958.55'));entry=entry.replace('width: 958.55','width: 560');
  const a=entry.indexOf('          props: ['),b=entry.indexOf('          scatter:',a);assert.ok(a>=0&&b>a);
  const oldProps=[{piece:'trunkTall',x:81,depth:2.03},{piece:'trunkMossy',x:228,depth:2.03},{piece:'trunkBent',x:374,depth:2.03},
   {piece:'rockFlat',x:242,depth:1.79,scale:[.34,.34]},{piece:'barrel',x:210,depth:.46},{piece:'barrel',x:378,depth:-.29},{piece:'fallenTrunk',x:304,depth:-.58}];
  entry=entry.slice(0,a)+'          props: '+JSON.stringify(oldProps)+',\n'+entry.slice(b);
  source=source.slice(0,start)+entry+source.slice(end);
  assert.equal(source.split('      0: 958.55,').length,2);source=source.replace('      0: 958.55,','      0: 560,');
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
  if((room==='41'||room==='41-closeback')&&time>10.5&&!prepared&&process.env.ROOM_BASELINE!=='1'){
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
  const fade=room==='25-closeback'&&time===312?JSON.parse(fs.readFileSync(path.join(root,'docs/reference-evidence/85-room25-entry-fade.json'),'utf8')).blackOpacity:0;
  const record=await page.evaluate(({camera,time,col,row,entryDoor,actorScreenX,fade,pillarDamageObservations})=>{
   const C=window.DNFCore,s=window.nanoDnf.getState();
   C.goToCell(s,s.dungeon.cells.findIndex(c=>c.col===col&&c.row===row));
   const pillarActions=[];
   for(const observed of pillarDamageObservations){
    if(observed.time>time)continue;
    const prop=s.props.find(p=>p.nativePillar&&p.nativePillar.x===observed.nativeXY[0]);
    if(!prop||prop.nativePillar.damagedAt>=0)continue;
    const enemies=s.enemies,cell=C.currentCell(s),roomCleared=s.room.cleared,cellCleared=cell.cleared;
    // Isolate the prop hit without clearing the room and auto-entering its exit.
    s.intro=null;s.transition=0;s.enemies=[];s.room.cleared=cell.cleared=true;s.player.invuln=100;
    C.runFrames(s,45,{});
    s.player.x=prop.nativePillar.x*1.125/C.CAMERA.zoom-30;
    s.player.z=Math.min(prop.sortZ,C.bandDepth(s.band));s.player.facing=1;
    C.runFrames(s,35,{attack:true});C.runFrames(s,30,{});
    s.enemies=enemies;s.room.cleared=roomCleared;cell.cleared=cellCleared;
    if(prop.nativePillar.damagedAt<0)throw new Error('real fixture hit missed pillar '+prop.nativePillar.x);
    pillarActions.push({nativeXY:observed.nativeXY,observedBy:observed.time,action:'aligned normal swing',piece:prop.piece});
   }
   s.entryDoor=entryDoor===undefined?(col===0?null:'W'):entryDoor;s.titleT=0;s.intro=null;s.transition=fade*C.TRANSITION.dur;
   // Relocate the actor only to keep the sampled native faces unobscured.
   s.player.x=(camera+(actorScreenX??(col===0?80:time<=28?240:200)))/C.CAMERA.zoom;s.player.z=40;
   s.player.hurtTimer=0;s.player.invuln=0;s.player.buffs={};
   s.camera.x=camera/C.CAMERA.zoom;s.time=pillarDamageObservations.length?Math.max(10,s.time):10;
   window.nanoDnf.setMapMode('radar');
   return {time,room:s.room.name,width:s.room.width,cameraPx:camera,pillarActions,
    props:s.props.map(p=>({piece:p.piece,x:p.x,z:p.z,broken:p.broken,gone:!!p.gone,screenX:p.x*C.CAMERA.zoom-camera,bottom:430-C.depthLift(p.z)*C.CAMERA.zoom}))};
  },{camera,time,col:profile.col,row:profile.row??3,entryDoor:profile.entryDoor,actorScreenX:profile.actorScreenX,fade,pillarDamageObservations});
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
  const name=t===26.5?'47-room42-entry-reference.png':(profile.referenceNames?.[t] ?? `${evidence}-${t}-reference.png`);
  return [t,fs.readFileSync(path.join(root,'docs/reference-evidence',name)).toString('base64')];
 }));
 const native=Object.fromEntries([['pillar','pillar-pale.png'],['forest','forest.png'],['nativeFlora','native-flora.png'],['nativePathGate','native-pathgate.png'],['bunker','goblin-bunker.png'],['tree','tree-reference.png'],['fruitTree','tree-fruit-reference.png'],['closeback','deep-boss-closeback.png'],['entryCloseback','deep-entry-closeback.png'],['room42Closeback','deep-room42-closeback.png'],['room43Closeback','deep-room43-closeback.png'],['room33Closeback','deep-room33-closeback.png'],['room23Closeback','deep-room23-closeback.png'],['room13Closeback','deep-room13-closeback.png'],['room14Closeback','deep-room14-closeback.png'],['room24Closeback','deep-room24-closeback.png'],['room24Foreground','deep-room24-foreground.png']].map(([key,name])=>[key,fs.readFileSync(path.join(root,'assets',name)).toString('base64')]));
 for(const sample of farSamples)native[`far-mask-${sample.room}-${sample.time}`]=fs.readFileSync(path.join(root,'docs/reference-evidence',sample.mask)).toString('base64');
 const faces=await page.evaluate(async({reference,images,native,cases})=>{
  async function picture(url,videoPixels=false){
   // ffmpeg PNG gamma tags otherwise alter the decoded video pixels (audit101).
   if(videoPixels)return createImageBitmap(await(await fetch(url)).blob(),{colorSpaceConversion:'none'});
   const im=new Image();im.src=url;await im.decode();return im;
  }
  function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d');}
  const atlases={},refs={},actuals={};
  for(const [key,value] of Object.entries(native))atlases[key]=await picture('data:image/png;base64,'+value);
  for(const t of Object.keys(reference)){
   const r=canvas(720,540);r.drawImage(await picture('data:image/png;base64,'+reference[t],true),0,0);refs[t]=r;
   const a=canvas(960,540);a.drawImage(await picture(images[t]),0,0);actuals[t]=a;
  }
  const result=[];
  for(const [label,time,sheet,sx,sy,sw,sh,x,y,w,h,cutoff,minPixels,threshold,maxX,maskBox,alphaOnly,maxError] of cases){
   const c=canvas(w,h);c.drawImage(atlases[sheet],sx,sy,sw,sh,0,0,w,h);
   const mask=c.getImageData(0,0,w,h).data,ref=refs[time].getImageData(x,y,w,h).data;let best={cosine:0};
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    if(y+dy<0)continue; // Keep top-edge comparisons inside the real canvas.
    const actual=actuals[time].getImageData(x+120+dx,y+dy,w,h).data;let dot=0,a2=0,b2=0,pixels=0;
    const sumsA=[0,0,0],sumsB=[0,0,0];
    for(let i=0;i<mask.length;i+=4){
     const px=(i/4)%w,py=Math.floor(i/4/w);
     if(maskBox&&(px<maskBox[0]||py<maskBox[1]||px>=maskBox[2]||py>=maskBox[3]))continue;
     if((i/4)%w>=(maxX||w)||Math.floor(i/4/w)>=cutoff||mask[i+3]<=220||(!alphaOnly&&(mask[i]<=70||mask[i+1]<=70||mask[i+2]<=45)))continue;
     pixels++;
    for(let k=0;k<3;k++){
     const a=ref[i+k],b=actual[i+k];
     dot+=a*b;a2+=a*a;b2+=b*b;
     if(maxError){sumsA[k]+=a;sumsB[k]+=b;}
    }
    }
    if(!pixels)continue;
    const error=Math.sqrt((a2+b2-2*dot)/(3*pixels));
    if(maxError){
     for(let k=0;k<3;k++){
      dot-=sumsA[k]*sumsB[k]/pixels;
      a2-=sumsA[k]**2/pixels;b2-=sumsB[k]**2/pixels;
     }
    }
    const cosine=dot/Math.sqrt(a2*b2);
    if(cosine>best.cosine)best={cosine,dx,dy,pixels,...(maxError?{error,maxError}:{})};
   }
   result.push({label,time,minPixels,threshold,nativeMask:{rows:cutoff,columns:maxX||w,alphaOnly:!!alphaOnly,box:maskBox||null},...best});
  }
  return result;
 },{reference,images,native,cases:profile.cases});
 fs.writeFileSync(path.join(out,'browser-comparison.json'),JSON.stringify(faces,null,2)+'\n');
 const span=Math.max(...cameras.map(c=>c.camera_px))-Math.min(...cameras.map(c=>c.camera_px));
 assert.ok(records[0].width*265/168+(profile.cameraTolerance||0)>=720+span,`room${room} must contain the independently observed camera span`);
 if(room==='42')assert.equal(records[0].props.filter(p=>p.piece==='chest').length,2);
 else if(room==='41'){
  assert.equal(records[0].props.filter(p=>p.piece==='rockFlat').length,2);
  assert.equal(records[0].props.filter(p=>p.piece==='barrel'&&!p.broken).length,4);
  assert.equal(records[1].props.filter(p=>p.piece==='barrel'&&!p.broken).length,2);
 }
 for(const face of faces)assert.ok(face.pixels>face.minPixels&&face.cosine>face.threshold&&(!face.maxError||face.error<face.maxError),`${face.label} native face matches its measured source anchor`);

 // Drive the normal camera at the eastern limit, then verify the rendered
 // viewport is wholly backed by the finite native tile row (batch81).
 const edge=await page.evaluate(()=>{
  const C=window.DNFCore,s=window.nanoDnf.getState();
  s.intro=null;s.transition=s.titleT=0;s.player.invuln=999;
  s.player.x=C.roomRight(s)-s.player.width/2;s.player.z=125;
  s.player.vx=s.player.vz=0;C.runFrames(s,2,{});
  const g=s.room.nativeGround;
  const nativeRight=((g.tiles?g.tiles.length:g.columns)*224-(g.originX||0))*1.125;
  return {room:s.room.name,width:s.room.width,cameraPx:s.camera.x*C.CAMERA.zoom,
   viewportRight:s.camera.x*C.CAMERA.zoom+C.VIEW.width,nativeRight};
 });
 assert.ok(edge.viewportRight<=edge.nativeRight,'eastern viewport must stay on native ground');
 assert.ok(Math.abs(edge.cameraPx-Math.max(...cameras.map(c=>c.camera_px)))<=1,'eastern camera matches reference within one pixel: '+JSON.stringify(edge));
 await page.waitForTimeout(100);
 await page.locator('#stage').screenshot({path:path.join(out,'right-edge.png')});
 fs.writeFileSync(path.join(out,'right-edge.json'),JSON.stringify(edge,null,2)+'\n');
 if(profile.boss){
  await page.evaluate(()=>{const s=window.nanoDnf.getState();s.player.x=1000;s.player.z=125;s.player.invuln=100;s.player.vx=s.player.vz=0;s.transition=0;s.intro=null;});
  await page.keyboard.press('p');await page.keyboard.down('ArrowRight');
  await page.waitForFunction(()=>{const s=window.nanoDnf.getState();return s.player.x>=window.DNFCore.roomRight(s)-s.player.width/2-2;},null,{timeout:15000});
  await page.keyboard.up('ArrowRight');
  const travel=await page.evaluate(()=>{const s=window.nanoDnf.getState();return {room:s.room.name,x:s.player.x,cameraPx:s.camera.x*window.DNFCore.CAMERA.zoom};});
  // The measured boss maximum includes subpixel tracking error / death shake.
  assert.ok(travel.cameraPx+(profile.cameraTolerance||0)>=span,'keyboard movement reaches observed far-right camera within measurement tolerance');
  const nativeRight=9*224*1.125;
  assert.ok(travel.cameraPx+720<=nativeRight,'rightmost viewport stays over the native boss floor');travel.validationScope=profile.scope;
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
  // First leave the south door's horizontal trigger span before going down.
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(()=>{
   const C=window.DNFCore,s=window.nanoDnf.getState();
   return s.player.x>C.doorX(s,C.currentCell(s),'S')+C.DOOR.span+10;
  });
  // The native1121 pillar blocks this row. Walk around its front instead of
  // treating a correctly solid column as a failed exit or reducing its box.
  const frontLaneClear=await page.evaluate(()=>{
   const C=window.DNFCore,s=window.nanoDnf.getState();
   return s.props.every(p=>{
    const b=C.propObstacle(p,s.player);
    return !b || b.x+b.width/2<s.player.x || Math.abs(b.z)>=b.depth/2;
   });
  });
  assert.ok(frontLaneClear,'the measured front lane is physically clear to the east');
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(()=>{
   const s=window.nanoDnf.getState(),c=s.dungeon.cells[s.cell];
   if(c.col!==2||c.row!==1)throw new Error('front detour entered an unintended door');
   return s.player.z<=1;
  });
  await page.keyboard.up('ArrowDown');
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
  const cell={col:profile.col,row:profile.row};
  await page.evaluate(({col,row})=>{
   const C=window.DNFCore,s=window.nanoDnf.getState();C.goToCell(s,s.dungeon.cells.findIndex(c=>c.col===col&&c.row===row));
   s.transition=s.titleT=0;s.intro=null;s.player.x=C.doorX(s,C.currentCell(s),'S');s.player.z=C.DOOR.depth+20;
  },cell);
  await page.keyboard.press('p');await page.keyboard.down('ArrowDown');
  await page.waitForFunction(({col,row})=>{const s=window.nanoDnf.getState(),c=s.dungeon.cells[s.cell];return c.col===col&&c.row===row+1;},cell);
  await page.keyboard.up('ArrowDown');travel.south=await page.evaluate(()=>({room:window.nanoDnf.getState().room.name}));
  assert.equal(travel.south.room,profile.extraSouth);
 }
 fs.writeFileSync(path.join(out,'travel.json'),JSON.stringify(travel,null,2)+'\n');
 console.log(`room${room} measured-camera captures + ${profile.exit||'E'} keyboard travel OK`,out);
}
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
