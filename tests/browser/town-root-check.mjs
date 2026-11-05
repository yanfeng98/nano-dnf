// Real canvas transform + independently measured native roots. Used inside the
// existing town browser, so this adds no second browser or concurrent workload.
export async function checkTownRoots(page, measurement, out) {
  await page.evaluate(() => {
    const R = window.DNFRender, original = R.drawTown;
    window.townRootCapture = { original };
    R.drawTown = (ctx, meta) => {
      window.townRootCapture.meta = meta;
      return original(ctx, meta);
    };
  });
  await page.waitForFunction(() => window.townRootCapture.meta);
  const result = await page.evaluate((packedRoots) => {
    const { original, meta } = window.townRootCapture;
    window.DNFRender.drawTown = original;
    delete window.townRootCapture;
    const R = window.DNFRender, C = window.DNFCore, samples = [];
    for (const cameraX of [0, 207]) for (const facing of [-1, 1]) {
      for (let frame = -1; frame < 8; frame++) {
        const moving = frame >= 0, phase = moving ? (frame + 0.5) / 10 : 0;
        const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
        const ctx = canvas.getContext('2d'), drawImage = ctx.drawImage.bind(ctx);
        let root;
        ctx.drawImage = (...args) => {
          if (args[0] === meta.sprites.slayer) {
            const [, sx, sy, sw, sh, dx, dy, dw, dh] = args;
            const row = sy / R.SPRITE.frameH, col = sx / R.SPRITE.frameW;
            const packed = packedRoots[row === R.SPRITE.rows.walk ? 'walk' : 'idle'][col];
            root = ctx.getTransform().transformPoint({
              x: dx + (R.SPRITE.anchorX + packed[0]) * dw / sw,
              y: dy + (R.SPRITE.anchorY + packed[1]) * dh / sh
            });
          }
          drawImage(...args);
        };
        original(ctx, { ...meta, town: { ...meta.town, open: true,
          x: 500, z: 50, cameraX, facing, moving, walk: phase,
          npcs: [], panel: null, dialogue: null, near: null } });
        const expected = { x: C.VIEW.left + 500 - cameraX, y: R.TOWN.groundY - 50 * R.TOWN.depthScale };
        samples.push({ cameraX, facing, frame, root: root && {x:root.x,y:root.y}, expected,
          url: cameraX === 207 ? canvas.toDataURL('image/png') : undefined });
      }
    }
    return samples;
  }, measurement.packed_roots);
  if (out) {
    const fs = await import('node:fs/promises');
    await fs.mkdir(out, { recursive: true });
    for (const s of result) if (s.url) await fs.writeFile(`${out}/${s.facing}-${s.frame}.png`, Buffer.from(s.url.split(',')[1], 'base64'));
    await fs.writeFile(`${out}/roots.json`, JSON.stringify(result.map(({url,...s})=>s),null,2));
  }
  for (const s of result) {
    if (!s.root || Math.hypot(s.root.x-s.expected.x,s.root.y-s.expected.y) > 0.01) {
      throw new Error(`town native root drifts: ${JSON.stringify({...s,url:undefined})}`);
    }
  }
  console.log(`town fixed native root OK: ${result.length} idle/walk/facing/camera samples`);
}

export async function checkTownDepthSpeed(page, measurement) {
  const speeds = {};
  for (const key of ['ArrowRight', 'ArrowUp']) {
    await page.evaluate(() => window.nanoDnf.setTownPosition(500, 20));
    await page.waitForTimeout(80);
    const before = await page.evaluate(() => window.nanoDnf.getTown());
    await page.keyboard.down(key);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.nanoDnf.getTown());
    await page.keyboard.up(key);
    const elapsed = after.walk-before.walk;
    if (!after.moving || elapsed <= 0 || after.z >= 100) throw new Error('town velocity sample did not stay in the road');
    speeds[key] = key === 'ArrowRight' ? (after.x-before.x)/elapsed : (after.z-before.z)/elapsed;
  }
  const depthScale = await page.evaluate(() => window.DNFRender.TOWN.depthScale);
  const ratio = speeds.ArrowUp*depthScale/speeds.ArrowRight;
  const [min, max] = measurement.ratio_band;
  if (ratio < min || ratio > max) throw new Error(`town vertical/horizontal speed ratio ${ratio} is outside recording band ${min}..${max}`);
  console.log(`town keyboard velocity OK: ${JSON.stringify({speeds,ratio})}`);
}
