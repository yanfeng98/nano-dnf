/* Same-camera evidence for V2 76s / 104.25s. Uses real damage/clear paths. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.env.CAPTURE_OUT || '/tmp/nano-reference-audit/after';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1120, height: 720 } });
  await context.addInitScript(() => localStorage.setItem('nano-dnf-progress', JSON.stringify({ cleared: { mirkwood: true } })));
  const page = await context.newPage();
  await page.goto(process.env.CAPTURE_URL || 'http://localhost:8080/?seed=1');
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.nanoDnf.leaveTown());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3400);
  await page.keyboard.press('p');
  // Freeze simulation with the real pause key; omit only its dark readout
  // while the real renderer paints the measured camera view.
  await page.evaluate(() => {
    const render = window.DNFRender.render;
    window.DNFRender.render = (ctx, state, meta) => render(ctx, state, { ...meta, paused: false });
  });
  for (const [name, cameraPx, playerPx, clear] of [['076', 207, 418, false], ['104', 1047.41, 418, true]]) {
    const actual = await page.evaluate(({ cameraPx, playerPx, clear }) => {
      const C = window.DNFCore, api = window.nanoDnf, s = api.getState();
      const cell = s.dungeon.cells.findIndex(c => c.col === 2 && c.row === 3);
      C.goToCell(s, cell);
      s.entryDoor = 'W';
      if (clear) for (let n = 0; n < 10 && !s.room.cleared; n++) {
        s.enemies.slice().forEach(e => { if (!e.dead) C.damageEnemy(s, e, 99999, 0, s.player.x); });
        C.runFrames(s, 60, {});
      }
      s.player.x = (cameraPx + playerPx) / C.CAMERA.zoom;
      s.player.z = clear ? C.bandDepth(s.band) : 250;
      s.player.invuln = 0;
      s.player.hurtTimer = 0;
      s.player.buffs = {};
      s.camera.x = cameraPx / C.CAMERA.zoom;
      s.titleT = 0;
      s.intro = null;
      s.transition = 0;
      api.setMapMode('window');
      return { room: s.room.name, width: s.room.width, camera: s.camera.x, cleared: s.room.cleared, north: C.doorX(s, C.currentCell(s), 'N') };
    }, { cameraPx, playerPx, clear });
    await page.waitForTimeout(150);
    const url = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
    fs.writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    console.log(name, actual);
  }
  await page.evaluate(() => {
    const C = window.DNFCore, s = window.nanoDnf.getState();
    s.player.x = C.doorX(s, C.currentCell(s), 'N');
    s.player.z = C.bandDepth(s.band) - C.DOOR.depth - 10;
  });
  await page.keyboard.press('p');
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => {
    const s = window.nanoDnf.getState(), c = s.dungeon.cells[s.cell];
    return c.col === 2 && c.row === 2;
  });
  await page.keyboard.up('ArrowUp');
  console.log('room43 north door keyboard travel OK');
} finally { await browser.close(); }
