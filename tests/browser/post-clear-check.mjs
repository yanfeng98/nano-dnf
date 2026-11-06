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
  async function finish(pauseAtFade=false) {
    await page.evaluate(pauseAtFade => {
      const C=window.DNFCore, api=window.nanoDnf, s=api.getState();
      s.intro=null;s.transition=0;s.enemies=[];s.props=[];
      s.room.pendingWave=[];s.room.pendingWaves=[];s.room.cleared=true;
      C.currentCell(s).cleared=true;s.victory=true;
      const R=window.DNFReward, original=R.step;
      R.step=(reward,dt)=>{
        if (pauseAtFade) {
          original(reward,R.TIMES.stats+R.TIMES.chest+R.TIMES.countdownAt+R.TIMES.countdown+R.TIMES.reveal+.4);
          R.step=()=>reward;
          window.restoreRewardClock=()=>{R.step=original;delete window.restoreRewardClock;};
          return reward;
        }
        R.step=original;return original(reward,30);
      };
    },pauseAtFade);
    if (pauseAtFade) {
      await page.waitForFunction(()=>window.nanoDnf.getReward()?.phase==='fade');
      assert.equal(await page.evaluate(()=>window.nanoDnf.getState().postClear),false,'Continue waits for the fade');
      const before=await page.evaluate(()=>window.nanoDnf.getState().player.x);
      await page.keyboard.down('ArrowRight');await page.waitForTimeout(100);await page.keyboard.up('ArrowRight');
      assert.equal(await page.evaluate(()=>window.nanoDnf.getState().player.x),before,'the result phase still owns movement');
      assert.ok(Math.abs(await page.evaluate(()=>window.nanoDnf.getReward().opacity)-.5)<1e-9);
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
  await finish(true);
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
  await finish();await click('select');
  await page.waitForFunction(()=>window.nanoDnf.getProgress().regionOpen);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!window.nanoDnf.getProgress().regionOpen);
  await finish();await click('town');
  await page.waitForFunction(()=>window.nanoDnf.getTown().open);
  console.log('post-clear play + Continue retry/select/town OK');
}
