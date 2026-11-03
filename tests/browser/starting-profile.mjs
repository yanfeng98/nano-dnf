/* Real menu entry and restart use the recording profile, not a label override. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = process.env.PROFILE_OUT || '/tmp/nano-starting-profile';
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ogg': 'audio/ogg' };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({ viewport: { width: 1120, height: 720 } });
  await page.addInitScript(() => localStorage.setItem('nano-dnf-progress', JSON.stringify({ cleared: { mirkwood: true } })));
  const results = [];
  for (const [stage, level, deep] of [['mirkwood', 3, false], ['mirkwooddeep', 6, true]]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?seed=1`);
    await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.nanoDnf.leaveTown());
    if (deep) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !window.nanoDnf.getProgress().regionOpen && !window.nanoDnf.getState().intro && window.nanoDnf.getState().transition <= 0);
    await page.keyboard.press('p');
    const actual = await page.evaluate(() => {
      const C = window.DNFCore, s = window.nanoDnf.getState(), p = s.player;
      return { stage: s.stage.id, upSlashSlot: window.nanoDnf.getLoadout().indexOf("upSlash"), thirdSlot: window.nanoDnf.getLoadout()[2], level: p.level, name: p.name, upSlashRank: p.skillRanks?.upSlash, attackBonus: p.attackBonus,
        maxHp: p.maxHp, maxMp: p.maxMp, xpToNext: p.xpToNext,
        expectedHp: C.PLAYER.maxHp + (p.level - 1) * C.PROGRESSION.maxHpPerLevel,
        expectedMp: C.PLAYER.maxMp + (p.level - 1) * C.PROGRESSION.maxMpPerLevel };
    });
    assert.equal(actual.upSlashSlot, 1);
    assert.equal(actual.thirdSlot, deep ? "normalWave" : "crossSlash");
    assert.equal(actual.stage, stage); assert.equal(actual.level, level);
    assert.equal(actual.name, '阿努纳奇'); assert.equal(actual.upSlashRank, 1);
    assert.equal(actual.maxHp, actual.expectedHp); assert.equal(actual.maxMp, actual.expectedMp);
    assert.equal(actual.attackBonus, (level - 1) * 2);
    results.push(actual);
    const render = await page.evaluate(() => {
      const original = window.DNFRender.render;
      window.DNFRender.render = (ctx, s, m) => {
        window.waveMeta = {...m, paused:false};
        return original(ctx, s, window.waveMeta);
      };
      return true;
    });
    await page.waitForTimeout(100);
    const url = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
    fs.writeFileSync(`${out}/${stage}.png`, Buffer.from(url.split(',')[1], 'base64'));
    if (deep) {
      const reference = fs.readFileSync(new URL('../../docs/reference-evidence/14-wave-slot-reference-076.00.png', import.meta.url)).toString('base64');
      const icon = await page.locator('#stage').evaluate(async (canvas, reference) => {
        const actual = canvas.getContext('2d').getImageData(619,503,31,31).data;
        const image = new Image(); image.src = 'data:image/png;base64,' + reference; await image.decode();
        const c = document.createElement('canvas'); c.width = c.height = 31;
        const ctx = c.getContext('2d'); ctx.drawImage(image,0,0);
        const expected = ctx.getImageData(0,0,31,31).data, a=[], b=[];
        for (let i=0; i<actual.length; i++) if (i%4!==3) { a.push(actual[i]); b.push(expected[i]); }
        const ma=a.reduce((s,n)=>s+n,0)/a.length, mb=b.reduce((s,n)=>s+n,0)/b.length;
        let cov=0, va=0, vb=0;
        a.forEach((v,i)=>{const x=v-ma,y=b[i]-mb;cov+=x*y;va+=x*x;vb+=y*y;});
        return {correlation:cov/Math.sqrt(va*vb), rect:[619,503,31,31]};
      }, reference);
      assert.ok(icon.correlation >= 0.65, 'deep default D icon matches recording frame6');
      const wave = [];
      await page.evaluate(() => {
        const ctx = document.querySelector('#stage').getContext('2d'), original = ctx.drawImage;
        // Protect this capture fixture from interruption; full playability tests keep normal combat.
        const player = window.nanoDnf.getState().player;
        player.invuln = player.solidInvuln = 4;
        window.waveDraws = [];
        window.waveBodyDraws = [];
        ctx.drawImage = function (...args) {
          if (args.length === 9 && /\/normal-wave\.png$/.test(args[0]?.src || '') && args[2] === 256) {
            if (window.waveDraws.length < 500) window.waveDraws.push({ sourceY: args[2], blend: this.globalCompositeOperation });
          }
          if (args.length === 9 && /\/normal-wave-body\.png$/.test(args[0]?.src || '')) {
            if (window.waveBodyDraws.length < 500) window.waveBodyDraws.push(args.slice(1));
          }
          return original.apply(this, args);
        };
      });
      await page.keyboard.press('p');
      await page.keyboard.press('KeyD');
      await page.waitForFunction(() => {
        const s = window.nanoDnf.getState();
        return s.player.skillId === 'normalWave' && s.shots.some(q => q.skillId === 'normalWave');
      });
      await page.keyboard.press('p');
      async function captureWave(name) {
        await page.waitForTimeout(100);
        const snapshot = await page.evaluate(() => {
          const s = window.nanoDnf.getState(), p = s.player;
          return { casting: p.skillTimer > 0, skillId: p.skillId, cooldown: p.skillCooldowns.normalWave,
            playerX: p.x, frame: window.DNFRender.playerFrame(s, p),
            shots: s.shots.filter(q => q.skillId === 'normalWave').map(q => ({ x:q.x, z:q.z, life:q.life, facing:q.facing })),
            draws: window.waveDraws, bodyDraws: window.waveBodyDraws };
        });
        const url = await page.locator('#stage').evaluate(c => c.toDataURL('image/png'));
        fs.writeFileSync(`${out}/wave-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
        wave.push({ name, ...snapshot }); return snapshot;
      }
      const launched = await captureWave('launch');
      assert.equal(launched.frame.row, 14); assert.equal(launched.shots.length, 1);
      assert.ok(launched.draws.some(d => d.blend === 'lighter'), 'native moving qi is actually drawn');
      assert.ok(launched.bodyDraws.some(d => d[2] === 384 && d[3] === 320 && Math.abs(d[4] + 108.8) < 1e-8),
        'D uses the native-size body and its fixed ANI root');
      await page.keyboard.press('p');
      await page.waitForFunction(() => window.nanoDnf.getState().player.skillTimer <= 0);
      await page.keyboard.press('p');
      const recovered = await captureWave('after-cast');
      assert.equal(recovered.casting, false); assert.equal(recovered.shots.length, 1);
      assert.ok(recovered.shots[0].x > launched.shots[0].x, 'the visible qi keeps moving after recovery');
      assert.ok(recovered.cooldown > 0);
      if (process.env.WAVE_POSES) {
        const poses = await page.evaluate(() => {
          const s = window.nanoDnf.getState(), p = s.player;
          const saved = {x:p.x,skillId:p.skillId,skillTimer:p.skillTimer,facing:p.facing};
          const shots = s.shots; s.shots = [];
          const baseMeta = window.waveMeta;
          const clip = window.DNFRender.SPRITE.skillClips.normalWave, offsets = clip.rootX;
          const output = [];
          try {
            p.x = 200; p.skillId = 'normalWave';
            for (const facing of [-1,1]) for (const elapsed of [0.225,0.275,0.325,0.525]) {
              p.facing = facing; p.skillTimer = 0.7 - elapsed;
              for (const mode of ['before','after']) {
                const c = document.createElement('canvas'); c.width = 960; c.height = 540;
                const meta = {...baseMeta, sprites:{...baseMeta.sprites}};
                if (mode === 'before') {
                  meta.sprites.normalWave = meta.sprites.normalWaveBody = null;
                  clip.rootX = offsets.map(() => 0);
                } else clip.rootX = offsets;
                window.DNFRender.render(c.getContext('2d'),s,meta);
                output.push({facing,elapsed,mode,url:c.toDataURL('image/png')});
              }
            }
          } finally { Object.assign(p,saved); s.shots=shots; clip.rootX=offsets; window.waveMeta=baseMeta; }
          return output;
        });
        for (const {facing,elapsed,mode,url} of poses) {
          fs.writeFileSync(`${out}/pose-${facing}-${elapsed}-${mode}.png`,Buffer.from(url.split(',')[1],'base64'));
        }
      }
      fs.writeFileSync(`${out}/wave-measurement.json`, JSON.stringify({icon,snapshots:wave}, null, 2));
      console.log('deep default D wave OK', {icon, snapshots:wave.map(({draws,...m}) => ({...m,draws:draws.length}))});
    }
    await page.evaluate(() => window.nanoDnf.restart());
    assert.equal(await page.evaluate(() => window.nanoDnf.getState().player.level), level);
    assert.equal(await page.evaluate(() => window.nanoDnf.getLoadout()[2]), deep ? "normalWave" : "crossSlash");
  }
  // A custom/saved bar is intentional: refreshing must not silently reorder it.
  const custom = ['upSlash', 'mountainBreaker', null, 'bloodSword', null, null];
  await page.evaluate(slots => window.nanoDnf.setLoadout(slots), custom);
  await page.reload();
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  assert.deepEqual(await page.evaluate(() => window.nanoDnf.getLoadout()), custom);
  const reset = await page.evaluate(() => window.nanoDnf.resetLoadout());
  assert.equal(reset[1], 'upSlash');
  await page.reload();
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  assert.deepEqual(await page.evaluate(() => window.nanoDnf.getLoadout()), reset);
  fs.writeFileSync(`${out}/measurement.json`, JSON.stringify(results, null, 2));
  console.log('starting profiles OK', results);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
