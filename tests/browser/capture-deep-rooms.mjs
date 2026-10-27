/*
 * 逐房抓帧：深处路线 9 间，每间在**镜头贴左墙（camera.x = 0）**时拍一张。
 *
 *   CAPTURE_OUT=/tmp/deepcheck/ours node tests/browser/capture-deep-rooms.mjs
 *
 * 这是同机位对照的取数工具：录像的进门帧里镜头就在 0，本作把镜头也钉到 0，
 * 两张图并排看，柱/树/桶/箱的屏幕位置与深浅才比得出来（`docs/adr/0063` 的样板
 * 是 42 房）。房间跳转走 `Core.goToCell`，清房走 `Core.damageEnemy`，与浏览器
 * 冒烟同一条正规路径；输出是工作用参照，不进版本库。
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = process.env.CAPTURE_OUT || "/tmp/deepcheck/ours";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ogg": "audio/ogg"
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
const context = await browser.newContext({ viewport: { width: 1120, height: 720 } });
await context.addInitScript(() => {
  try {
    localStorage.setItem(
      "nano-dnf-progress",
      JSON.stringify({ cleared: { mirkwood: true } })
    );
  } catch (error) {
    /* 存储不可用时让页面自己报错。 */
  }
});
const page = await context.newPage();
await page.goto(`http://localhost:${server.address().port}/?seed=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getAssetState().ready);

await page.keyboard.press("Enter");
await page.waitForTimeout(350);
await page.evaluate(() => window.nanoDnf.leaveTown());
await page.waitForTimeout(250);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(250);
await page.keyboard.press("Enter");
await page.waitForTimeout(3400);

/*
 * [名字, 列, 行, 进来那扇门]。**第四个数不能省**：录像里的对照帧都拍在"刚走进这间房"
 * 前后，而**进来那扇门**是从进门那一刻就画着的（`exitMode` 对 `entryDoor` 直接返回
 * open）。`goToCell` 是个传送（`entryDoor = null`），不补这一笔，那扇门在抓帧里
 * 根本不存在 —— 13/23/33 房底部那道石拱（下门）一直没进过对照图，就是因为它只在
 * "从下门进来"时画（2026-10-26）。
 */
const ROOMS = [
  ["41", 0, 3, null],
  ["42", 1, 3, "W"],
  ["43", 2, 3, "W"],
  ["33", 2, 2, "S"],
  ["23", 2, 1, "S"],
  ["13", 2, 0, "S"],
  ["14", 3, 0, "W"],
  ["24", 3, 1, "W"],
  ["25", 4, 1, "W"]
];

const canvas = await page.locator("#stage");
/* 清房开关要在 Node 这一侧读，页面里没有 `process`。 */
const clearRooms = process.env.CAPTURE_CLEAR === "1";
for (const [name, col, row, entry] of ROOMS) {
  const info = await page.evaluate(([col, row, clearRoom, entryDoor]) => {
    const Core = window.DNFCore;
    const state = window.nanoDnf.getState();
    const index = state.dungeon.cells.findIndex((cell) => cell.col === col && cell.row === row);
    Core.goToCell(state, index);
    /* 传送不带门；补上"从哪扇门进来"，那扇门才会像录像里那样画着。 */
    state.entryDoor = entryDoor;
    /*
     * **不清房**：录像的进门帧都还没清（出口门只会在清房后出现，见 `drawGate`），
     * 清掉再拍会多出几扇录像里没有的门。`CAPTURE_CLEAR=1` 时反过来 —— 要看清房后
     * 那扇门和它的符文光。
     */
    if (clearRoom) {
      for (let round = 0; round < 8 && !state.room.cleared; round += 1) {
        state.enemies.slice().forEach((enemy) => {
          if (!enemy.dead) Core.damageEnemy(state, enemy, 99999, 0, state.player.x);
        });
        Core.runFrames(state, 50, {});
      }
    }
    state.camera.x = 0;
    /* 关卡名是进门那一下的过场；录像的对照帧都过了这一段，别让字压在布景上。 */
    state.titleT = 0;
    Core.runFrames(state, 2, {});
    return {
      room: state.room.name,
      width: state.room.width,
      camera: state.camera.x,
      props: (state.stage.rooms[state.dungeon.cells[index].room].props || []).length,
      enemies: state.enemies.length,
      entryDoor: state.entryDoor
    };
  }, [col, row, clearRooms, entry]);
  const box = await canvas.boundingBox();
  await page.screenshot({
    path: path.join(OUT, name + ".png"),
    clip: { x: box.x, y: box.y, width: box.width, height: box.height }
  });
  process.stdout.write(`${name} ${JSON.stringify(info)}\n`);
}

await browser.close();
await new Promise((resolve) => server.close(resolve));
