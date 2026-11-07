/* Real shell/reward/core handoff. Only the presentation clock is accelerated;
   input, rendering, routing, persistence and the reward state machine are real. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export async function checkPostClear(page, out) {
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.nanoDnf.getTown().open);
  await page.evaluate(() => window.nanoDnf.leaveTown());
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.nanoDnf.getProgress().regionOpen);
  async function finish(pauseAtFade=false, manual=false) {
    await page.evaluate(({pauseAtFade,manual}) => {
      const C=window.DNFCore, api=window.nanoDnf, s=api.getState();
      s.intro=null;s.transition=0;s.enemies=[];s.props=[];
      s.room.pendingWave=[];s.room.pendingWaves=[];s.room.cleared=true;
      C.currentCell(s).cleared=true;s.victory=true;
      if(pauseAtFade){
        const boss=C.createEnemy(s,'boss',600);boss.dead=true;boss.hp=0;
        s.target={enemy:boss,dying:0,share:0,ghost:{from:.2,to:0,t:0}};
        s.hitStop=.1;
      }
      const R=window.DNFReward, original=R.step;
      R.step=(reward,dt)=>{
        if (manual) {
          R.step=original;return original(reward,R.TIMES.stats+R.TIMES.chest+R.TIMES.flip);
        }
        if (pauseAtFade) {
          original(reward,R.TIMES.stats+R.TIMES.chest+R.TIMES.countdownAt+R.TIMES.countdown+R.TIMES.reveal+.4);
          R.step=()=>reward;
          window.restoreRewardClock=()=>{R.step=original;delete window.restoreRewardClock;};
          return reward;
        }
        R.step=original;return original(reward,30);
      };
    },{pauseAtFade,manual});
    if (manual) {
      await page.waitForFunction(()=>window.nanoDnf.getReward()?.phase==='cards'&&window.nanoDnf.getReward().faceUp);
      return;
    }
    if (pauseAtFade) {
      await page.waitForFunction(()=>window.nanoDnf.getReward()?.phase==='fade');
      assert.equal(await page.evaluate(()=>window.nanoDnf.getState().postClear),false,'Continue waits for the fade');
      const before=await page.evaluate(()=>window.nanoDnf.getState().player.x);
      await page.keyboard.down('ArrowRight');await page.waitForTimeout(100);await page.keyboard.up('ArrowRight');
      assert.equal(await page.evaluate(()=>window.nanoDnf.getState().player.x),before,'the result phase still owns movement');
      assert.ok(Math.abs(await page.evaluate(()=>window.nanoDnf.getReward().opacity)-.5)<1e-9);
      const deathStart=await page.evaluate(()=>({time:window.nanoDnf.getState().time,dying:window.nanoDnf.getState().target?.dying}));
      await page.waitForFunction(()=>window.nanoDnf.getState().target===null,null,{timeout:5000});
      assert.equal(await page.evaluate(()=>window.nanoDnf.getState().postClear),false,'the target expires while the real result overlay still owns control');
      fs.writeFileSync(path.join(out,'shell-target-death-clock.json'),JSON.stringify({start:deathStart,
        end:await page.evaluate(()=>({time:window.nanoDnf.getState().time,target:window.nanoDnf.getState().target,reward:window.nanoDnf.getReward().phase}))},null,2));
      await page.evaluate(()=>window.restoreRewardClock());
    }
    await page.waitForFunction(() => window.nanoDnf.getState().postClear);
    assert.equal(await page.evaluate(() => window.nanoDnf.getReward().phase),'done');
  }
  async function click(action) {
    const canvas=page.locator('#stage'), box=await canvas.boundingBox();
    const point=await page.evaluate(action=>{
      const ui=window.DNFRender.CONTINUE_UI, i=ui.actions.indexOf(action);
      return {x:ui.x+135*ui.scale,y:(ui.rows[i]+15)*ui.scale};
    },action);
    await page.mouse.click(box.x+point.x*box.width/960,box.y+point.y*box.height/540);
  }
  const beforePrize=await page.evaluate(()=>window.nanoDnf.getProgressState());
  await finish(true);
  const firstPrize=await page.evaluate(()=>({profile:window.nanoDnf.getProgressState(),reward:window.nanoDnf.getReward()}));
  assert.equal(firstPrize.reward.claimed,true);
  assert.equal(firstPrize.profile.gold,beforePrize.gold+3526);
  assert.equal(firstPrize.profile.items.ancientStaff,(beforePrize.items.ancientStaff||0)+1);
  const x=await page.evaluate(()=>window.nanoDnf.getState().player.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(x=>window.nanoDnf.getState().player.x>x+10,x);
  await page.keyboard.up('ArrowRight');
  const swings=await page.evaluate(()=>window.nanoDnf.getState().stats.swings);
  await page.keyboard.press('KeyX');
  await page.waitForFunction(n=>window.nanoDnf.getState().stats.swings>n,swings);
  const gold=await page.evaluate(()=>window.nanoDnf.getProgressState().gold);
  await page.evaluate(()=>{window.nanoDnf.getState().stats.gold+=27;});
  await page.waitForFunction(gold=>window.nanoDnf.getProgressState().gold===gold+27,gold);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getProgressState().gold),gold+27,'post-clear loot banks once');
  const presentation=await page.locator('#stage').evaluate(c=>{
    const ctx=c.getContext('2d');
    function count(x,y,w,h,kind){
      const data=ctx.getImageData(x,y,w,h).data;let n=0;
      for(let i=0;i<data.length;i+=4)if(kind==='red'
        ? data[i]>80&&data[i]>2*data[i+1]&&data[i]>2*data[i+2]
        : data[i]>100&&data[i+1]>70&&data[i]>1.4*data[i+2])n++;
      return n;
    }
    return {menuRows:[30,64,99,134].map(y=>count(600,y,160,24,'gold')),
      hudRed:count(135,465,30,55,'red')};
  });
  assert.ok(presentation.menuRows.every(n=>n>60),'the English title and all three native menu labels are actually drawn');
  assert.ok(presentation.hudRed>100,'the combat HUD returns below Continue');
  fs.writeFileSync(path.join(out,'post-clear-measurement.json'),JSON.stringify(presentation,null,2)+'\n');
  fs.writeFileSync(path.join(out,'continue.png'),Buffer.from((await page.locator('#stage').evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
  await click('retry');
  await page.waitForFunction(()=>!window.nanoDnf.getState().victory);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getReward()),null,'retry creates a fresh reward flow');
  assert.equal(await page.evaluate(()=>window.nanoDnf.getState().postClear),false);
  const beforeManual=await page.evaluate(()=>window.nanoDnf.getProgressState());
  await finish(false,true);
  await page.keyboard.press('Digit3');
  await page.keyboard.press('F4');
  await page.waitForFunction(()=>window.nanoDnf.getTown().open);
  const manualPrize=await page.evaluate(()=>window.nanoDnf.getProgressState());
  assert.equal(manualPrize.gold,beforeManual.gold+3526,'manual selection banks before immediate return to town');
  assert.equal(manualPrize.items.ancientStaff,(beforeManual.items.ancientStaff||0)+1);
  await page.evaluate(()=>window.nanoDnf.leaveTown());
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!window.nanoDnf.getProgress().regionOpen);
  assert.equal(await page.evaluate(()=>window.nanoDnf.getStage()),'mirkwooddeep');
  const beforeDeep=await page.evaluate(()=>window.nanoDnf.getProgressState());
  await finish();
  const deepPrize=await page.evaluate(()=>window.nanoDnf.getProgressState());
  assert.equal(deepPrize.gold,beforeDeep.gold+6094);
  assert.equal(deepPrize.items.kunicTotem,(beforeDeep.items.kunicTotem||0)+1);
  await click('select');
  await page.waitForFunction(()=>window.nanoDnf.getProgress().regionOpen);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!window.nanoDnf.getProgress().regionOpen);
  await finish();await click('town');
  await page.waitForFunction(()=>window.nanoDnf.getTown().open);
  const persisted=await page.evaluate(()=>({
    profile:window.nanoDnf.getProgressState(), stages:window.nanoDnf.getProgress()
  }));
  await page.waitForLoadState('networkidle');
  await page.reload();
  await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready,null,{timeout:30000});
  const restored=await page.evaluate(()=>({
    profile:window.nanoDnf.getProgressState(), stages:window.nanoDnf.getProgress()
  }));
  assert.equal(restored.profile.gold,persisted.profile.gold,'clear, card and post-clear gold survive reload');
  assert.equal(restored.profile.items.ancientStaff,persisted.profile.items.ancientStaff);
  assert.equal(restored.profile.items.kunicTotem,persisted.profile.items.kunicTotem);
  assert.deepEqual(restored.profile.cleared,persisted.profile.cleared,'profile clear history survives reload');
  assert.deepEqual(restored.stages.cleared,persisted.stages.cleared,'stage unlock history has its own surviving store');
  assert.deepEqual(restored.stages.open,persisted.stages.open,'the next stage remains open after reload');
  fs.writeFileSync(path.join(out,'prize-payment-measurement.json'),JSON.stringify({
    beforePrize,firstPrize,beforeManual,manualPrize,beforeDeep,deepPrize,restored
  },null,2)+'\n');
  console.log('post-clear play + Continue retry/select/town + profile/unlock persistence OK');
}
