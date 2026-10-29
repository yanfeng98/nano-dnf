/* Run after `npm run serve`, separately from the browser suite.
 * Captures the intrinsic 960x540 canvas, so reference pixels have one scale.
 * REVIEW_URL=http://localhost:8080 REVIEW_OUT=/tmp/nano-town-review node tests/browser/capture-town-review.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const out = process.env.REVIEW_OUT || "/tmp/nano-town-review";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(process.env.REVIEW_URL || "http://localhost:8080");
  await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
  await page.keyboard.press("Enter");
  const shot = async (name) => {
    await page.waitForTimeout(80);
    const url = await page.evaluate(() => document.querySelector("canvas").toDataURL());
    await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
  };
  const resourceShots = async (scene) => {
    for (const share of [0, 0.5, 1]) {
      await page.evaluate((value) => {
        const p = window.nanoDnf.getState().player;
        p.hp = p.maxHp * value;
        p.mp = p.maxMp * value;
      }, share);
      await shot(`${scene}-${share * 100}`);
      const levels = await page.evaluate(() => {
        const ctx = document.querySelector("canvas").getContext("2d");
        return [window.DNFRender.HUD_ORB.left, window.DNFRender.HUD_ORB.right].map((box) =>
          [0.25, 0.75].map((height) => Array.from(ctx.getImageData(
            Math.round(box.x + box.w / 2), Math.round(box.y + box.h * height), 1, 1
          ).data))
        );
      });
      levels.forEach((samples, side) => samples.forEach(([r, , b], index) => {
        const hasLiquid = side === 0 ? r > 35 && r > b * 1.4 : b > 35 && b > r * 1.4;
        const expected = share === 1 || (share === 0.5 && index === 1);
        if (hasLiquid !== expected) throw new Error(`${scene}: ${side ? "MP" : "HP"} ${share} at sample ${index}`);
      }));
    }
  };
  await resourceShots("town");
  for (const z of [0, 1, 50, 100]) {
    await page.evaluate((value) => window.nanoDnf.setTownPosition(500, value), z);
    await shot(`town-depth-${z}`);
  }
  const movement = [];
  for (const keys of [["ArrowRight"], ["ArrowLeft"], ["ArrowRight", "ArrowUp"], ["ArrowUp"], ["ArrowDown"]]) {
    await page.evaluate(() => window.nanoDnf.setTownPosition(500, 50));
    const before = await page.evaluate(() => ({ ...window.nanoDnf.getTown(), time: performance.now() }));
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(350);
    await shot(`town-walk-${keys.join("-")}`);
    for (const key of keys) await page.keyboard.up(key);
    const after = await page.evaluate(() => ({ ...window.nanoDnf.getTown(), time: performance.now() }));
    movement.push({ keys, dx: after.x - before.x, dz: after.z - before.z, ms: after.time - before.time });
  }
  await page.evaluate(() => window.nanoDnf.setTownPosition(2420, 50));
  await shot("town-gate");
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3400);
  await page.keyboard.press("KeyP");
  await resourceShots("dungeon-paused");
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(path.join(out, "movement.json"), JSON.stringify(movement, null, 2));
  console.log(`Town/HUD review captures: ${out}`);
} finally {
  await browser.close();
}
