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

export async function checkTownCamera(page, measurement) {
  const get = () => page.evaluate(() => ({ ...window.nanoDnf.getTown(),
    center: window.DNFCore.VIEW.width/2,
    maxCamera: window.DNFRender.TOWN.width-window.DNFCore.VIEW.width }));
  await page.evaluate(() => window.nanoDnf.setTownPosition(1000, 50));
  await page.waitForTimeout(80);
  const start = await get();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(120);
  const inside = await get();
  if (inside.x-start.x < 10 || inside.x-start.x > 48) throw new Error('camera interior sample left its intended window');
  if (Math.abs(inside.cameraX-start.cameraX) > .1) {
    await page.keyboard.up('ArrowRight');
    throw new Error(`town camera moved inside the recording's activity window: ${inside.cameraX-start.cameraX}px`);
  }
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowRight');
  await page.waitForFunction(() => !window.nanoDnf.getTown().moving);
  const right = await get();
  await page.waitForTimeout(240);
  const stopped = await get();
  if (Math.abs(stopped.cameraX-right.cameraX) > .1) throw new Error('town camera kept drifting after horizontal movement stopped');
  const [min,max] = measurement.camera_radius_band;
  const rightOffset = right.x-right.cameraX-right.center;
  if (rightOffset < min || rightOffset > max) throw new Error(`town right camera offset ${rightOffset} differs from recording band ${min}..${max}`);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(850);
  await page.keyboard.up('ArrowLeft');
  await page.waitForFunction(() => !window.nanoDnf.getTown().moving);
  const left = await get();
  const leftOffset = left.center-(left.x-left.cameraX);
  if (leftOffset < min || leftOffset > max) throw new Error(`town left camera offset ${leftOffset} differs from recording band ${min}..${max}`);
  for (const [x,expected] of [[80,0],[2440,left.maxCamera]]) {
    await page.evaluate(x => window.nanoDnf.setTownPosition(x,50), x);
    await page.waitForTimeout(80);
    if (Math.abs((await get()).cameraX-expected) > .1) throw new Error('town camera moved outside the panorama');
  }
  console.log(`town camera OK: ${JSON.stringify({insideShift:inside.cameraX-start.cameraX,rightOffset,leftOffset,stopDrift:stopped.cameraX-right.cameraX})}`);
}

export async function checkTownDiagonal(page, measurement) {
  const sample = async (keys) => {
    await page.evaluate(() => window.nanoDnf.setTownPosition(1000, 50));
    await page.waitForTimeout(80);
    for (const key of keys) await page.keyboard.down(key);
    // Measure only after all requested keys have reached a simulation frame.
    await page.waitForTimeout(50);
    const before = await page.evaluate(() => window.nanoDnf.getTown());
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.nanoDnf.getTown());
    for (const key of keys) await page.keyboard.up(key);
    const elapsed = after.walk-before.walk;
    if (!after.moving || elapsed <= 0 || after.z <= 0 || after.z >= 100) throw new Error('diagonal velocity sample hit an edge or stopped');
    return { x:(after.x-before.x)/elapsed, z:(after.z-before.z)/elapsed };
  };
  const horizontal = await sample(['ArrowRight']);
  const vertical = await sample(['ArrowUp']);
  const [min,max] = measurement.axis_ratio_band;
  const results = [];
  for (const h of ['ArrowLeft','ArrowRight']) for (const v of ['ArrowUp','ArrowDown']) {
    const speed = await sample([h,v]);
    const xRatio = Math.abs(speed.x/horizontal.x), zRatio = Math.abs(speed.z/vertical.z);
    if (Math.sign(speed.x) !== (h === 'ArrowLeft' ? -1 : 1) || Math.sign(speed.z) !== (v === 'ArrowUp' ? 1 : -1)) throw new Error('diagonal input reversed an axis');
    if (xRatio < min || xRatio > max || zRatio < min || zRatio > max) {
      throw new Error(`town diagonal loses cardinal axis speed: ${JSON.stringify({h,v,xRatio,zRatio,band:[min,max]})}`);
    }
    results.push({h,v,speed,xRatio,zRatio});
  }
  console.log(`town diagonal velocity OK: ${JSON.stringify(results)}`);
}
