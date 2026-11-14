'use strict';
// Probe the actual room reinforcement factory without overriding enemy level.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');
const Render = require('../src/render.js');
const rows = [1, 2, 7, 123].map(seed => {
  const state = Core.createState({stage:'mirkwood', seed, referenceProfile:true});
  const cell = state.dungeon.cells.findIndex(c => state.stage.rooms[c.room].name === '投石坡');
  Core.goToCell(state,cell);
  state.transition=0;state.player.invuln=Infinity;state.player.xpToNext=100000;
  for(const enemy of state.enemies) {
    for(let hit=0;hit<20&&!enemy.dead;hit++) Core.damageEnemy(state,enemy,enemy.hp+1,0,state.player.x);
  }
  let frames=0;
  for(;frames<600&&!state.enemies.some(e=>e.type==='burningThrower');frames++) Core.step(state,{},Core.DT);
  const enemy=state.enemies.find(e=>e.type==='burningThrower');
  assert.ok(enemy && !enemy.dead,'live reinforcement must actually spawn');
  return {seed,frames,type:enemy.type,level:enemy.level,champion:enemy.champion,
    trackWidth:Render.targetTrackWidth(state,enemy)};
});
const report={scope:'Real default room reinforcement; no explicit enemy-level override.',rows};
const index=process.argv.indexOf('--out');
if(index>=0) fs.writeFileSync(process.argv[index+1],JSON.stringify(report,null,2)+'\n');
if(process.argv.includes('--require-match')) {
  for(const row of rows) {assert.equal(row.level,4);assert.equal(row.champion,'fire');assert.equal(row.trackWidth,217);}
}
console.log(rows);
