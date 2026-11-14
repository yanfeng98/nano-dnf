/* Count actual spawned/dead enemies while stepping the real entry-room core. */
const Core=require('../src/core.js'),fs=require('node:fs');
const outIndex=process.argv.indexOf('--out'),out=outIndex>=0?process.argv[outIndex+1]:'/tmp/nano-entry-enemy-counts.json';
const rows=[];
for(const [stage,expected]of [['mirkwood',4],['mirkwooddeep',7]])for(const seed of [1,2,7,123]) {
 const state=Core.createState({stage,seed,referenceProfile:true}),seen=new Set();
 for(let frame=0;frame<900&&!state.room.cleared;frame++) {
  for(const enemy of state.enemies){seen.add(enemy.id);for(let hit=0;hit<50&&!enemy.dead;hit++)Core.damageEnemy(state,enemy,999999,0,state.player.x);}
  Core.step(state,{});
 }
 rows.push({stage,seed,spawned:seen.size,kills:state.stats.kills,cleared:state.room.cleared,waveSpawned:state.room.waveSpawned||0,expected});
}
fs.writeFileSync(out,JSON.stringify({method:'real damageEnemy plus step; no direct kill-stat or clear-flag assignment',rows},null,2)+'\n');
console.log(rows);
if(process.argv.includes('--require-match'))for(const row of rows)if(!row.cleared||row.spawned!==row.expected||row.kills!==row.expected)throw Error(JSON.stringify(row));
