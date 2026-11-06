/* A saved bag must survive an actual page reload, then real I/E input must
   equip it and preserve the displaced weapon through the next reload. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export async function checkInventoryPersistence(page) {
  const out=process.env.INVENTORY_OUT||'/tmp/nano-inventory-persistence';
  fs.mkdirSync(out,{recursive:true});
  await page.evaluate(()=>{
    const P=window.DNFProgress, profile=P.defaults();
    P.addItem(profile,'starterBlade',1);P.equip(profile,'starterBlade');
    P.addItem(profile,'rustyBlade',2);P.addItem(profile,'clothArmor',1);P.addItem(profile,'copperRing',1);
    P.save(profile,window.localStorage);
  });
  async function reloadTown(){
    // First-gesture audio loads start asynchronously after the image-ready
    // signal. Wait for decoding too, so intentional reloads do not abort them.
    await page.waitForFunction(()=>{
      const a=window.nanoDnf.getAudioState(), m=window.nanoDnf.getMusicState();
      return a.sfxTotal>0&&a.sfxLoaded===a.sfxTotal&&m.trackFiles.length===Object.keys(window.DNFMusic.TRACKS).length;
    },null,{timeout:30000});
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForFunction(()=>window.nanoDnf?.getAssetState().ready,null,{timeout:30000});
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.nanoDnf.getTown().open);
  }
  await reloadTown();
  const before=await page.evaluate(()=>window.nanoDnf.getProgressState());
  assert.equal(before.items.rustyBlade,2,'page reload retains bag weapons');
  assert.equal(before.items.clothArmor,1,'page reload retains bag armor');
  assert.equal(before.items.copperRing,1,'page reload retains bag rings');
  assert.equal(before.equipment.weapon,'starterBlade');
  await page.keyboard.press('KeyI');await page.keyboard.press('KeyE');
  await page.waitForFunction(()=>window.nanoDnf.getProgressState().equipment.weapon==='rustyBlade');
  await reloadTown();
  const after=await page.evaluate(()=>window.nanoDnf.getProgressState());
  assert.equal(after.equipment.weapon,'rustyBlade');
  assert.equal(after.items.rustyBlade,1);
  assert.equal(after.items.starterBlade,1,'the replaced weapon survives the second page reload');
  await page.evaluate(()=>{
    const original=CanvasRenderingContext2D.prototype.fillText;
    window.inventoryTexts=[];
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){
      window.inventoryTexts.push(String(text));return original.call(this,text,...args);
    };
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>window.inventoryTexts.some(text=>text==='生锈的铁剑 × 1')&&
    window.inventoryTexts.some(text=>text==='锈蚀短剑 × 1'));
  await page.locator('#stage').screenshot({path:path.join(out,'inventory-after-reload.png')});
  fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify({before,after,displayedNames:[
    '生锈的铁剑 × 1','锈蚀短剑 × 1']},null,2)+'\n');
  console.log('inventory persistence OK: reload → I/E equip → reload → old and remaining weapons displayed');
}
