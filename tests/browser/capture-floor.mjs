/*
 * Frame captures of the floor itself, for eyeballing the depth axis.
 *
 *   CAPTURE_OUT=/tmp/floor-after node tests/browser/capture-floor.mjs
 *
 * Six shots: the title screen, a room entry, mid-room, a jump, and the Sunken
 * Chapel before and during a collapse, plus the boss room. Each one is a place
 * where the floor band has to hold up - the slabs are ellipses lying on it, the
 * gate stands at the end of it, and the jump is where the feet leave it. The
 * band is data (Core.BAND) rather than art, so there is nothing to hand-check;
 * these shots are the only acceptance this slice has, and they get looked at by
 * a person or they mean nothing. Output is a working reference, never committed.
 *
 * Everything after the title screen is driven with real key events, so the
 * captures show the shipped input path; the room jumps at the end go through
 * Core.startRoom on the live state, which is what the browser suite does too.
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = process.env.CAPTURE_OUT || "/tmp/floor-ingame";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, resolve));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1120, height: 720 } });
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: "load" });
await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room);

const shot = (name) => page.screenshot({ path: path.join(OUT, name + ".png") });

/*
 * A run's layout is drawn from the room pool by seed, so the alternate does not
 * always appear in it - and startRoom takes a position in the layout, not an
 * index into ROOMS. Rewriting the layout to that one room is the only way to be
 * sure the capture lands on the collapsing slabs.
 */
const jumpToPoolRoom = (poolIndex) =>
  page.evaluate((index) => {
    const state = window.nanoDnf.getState();
    state.layout = [index];
    window.DNFCore.startRoom(state, 0);
  }, poolIndex);

/* The title screen: the attract demo, playing on the real backdrop. */
await page.waitForTimeout(1500);
await shot("00-title");

await page.keyboard.press("Enter");
await page.waitForTimeout(400);
await shot("01-room-entry");

/* Out into the middle, so the bodies are not all stacked on the spawn. */
await page.keyboard.down("ArrowRight");
await page.waitForTimeout(1100);
await page.keyboard.up("ArrowRight");
await page.waitForTimeout(300);
await shot("02-mid-room");

/* A jump: where the feet leave the band and the shadow stays on it. */
await page.keyboard.press("KeyC");
await page.waitForTimeout(160);
await shot("03-jump");

/* The Sunken Chapel: two collapsing slabs, drawn as ellipses lying on the floor. */
await jumpToPoolRoom(await page.evaluate(() => window.DNFCore.ALTERNATE_ROOM_INDEX));
await page.waitForTimeout(500);
await shot("04-chapel-dormant");
await page.waitForTimeout(900);
await shot("05-chapel-cracking");

/* The boss room: the gate at the end of the floor, and a body on each side. */
await jumpToPoolRoom(await page.evaluate(() => window.DNFCore.BOSS_ROOM_INDEX));
await page.waitForTimeout(500);
await shot("06-boss-room");

console.log("wrote", OUT);
await browser.close();
server.close();
