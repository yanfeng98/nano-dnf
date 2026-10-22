/*
 * 幽暗密林深处 的浏览器冒烟（2026-10-21）。
 *
 * 它不重跑整关：只证明四件事 ——
 *   1. 通关 幽暗密林 之后，地区地图上的「幽暗密林深处」真的进得去；
 *   2. 这一关的 4x4/15 格地牢、猫妖、投掷十夫长、宝箱/石碑都在页面上；
 *   3. 暗咒猫妖半血进二阶段（金环、无横幅），被打死以后真的结算通关；
 *   4. 页面没有 console/page error，新素材（含 forest02.ogg）都是 200。
 *
 * 它跑在 `playability.mjs` 之后，同样只起一个无头浏览器 —— 云开发机一次一核。
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACTS = path.join(ROOT, "tests", "browser", "artifacts");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ogg": "audio/ogg"
};

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const relative = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.join(ROOT, path.normalize(relative));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream"
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function fail(message) {
  throw new Error(`deep smoke: ${message}`);
}

async function main() {
  const { server, port } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  /*
   * 地区地图只开"前一关已通关"的关：把 mirkwood 先记成通关，deep 才会亮。
   * 放在 init script 里，页面第一次读 localStorage 之前就生效。
   */
  await context.addInitScript(() => {
    try {
      localStorage.setItem(
        "nano-dnf-progress",
        JSON.stringify({ cleared: { mirkwood: true } })
      );
    } catch (error) {
      /* 无痕/禁用存储时让页面自己报错，不在冒烟里吞掉。 */
    }
  });
  const page = await context.newPage();
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], assets: [] };
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error)));
  page.on("requestfailed", (request) =>
    diagnostics.failedRequests.push(`${request.url()} ${request.failure()?.errorText}`)
  );
  page.on("response", (response) => {
    const url = response.url();
    if (url.endsWith(".png") || url.endsWith(".js") || url.endsWith(".html") || url.endsWith(".ogg")) {
      diagnostics.assets.push(`${response.status()} ${path.basename(url)}`);
    }
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?seed=1`);
    await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState);

    /* 标题 → 地区地图 → 右移到深处 → 进关。 */
    await page.keyboard.press("Enter");
    await page.waitForTimeout(350);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3400);

    const entry = await page.evaluate(() => {
      const api = window.nanoDnf;
      const state = api.getState();
      return {
        stage: api.getStage(),
        room: state.room && state.room.name,
        cells: state.dungeon && state.dungeon.cells.length,
        hole: state.dungeon
          ? state.dungeon.cells.some((cell) => cell.col === 3 && cell.row === 2)
          : true,
        entry: state.dungeon && state.dungeon.entry,
        boss: state.dungeon && state.dungeon.boss,
        types: state.enemies.map((enemy) => enemy.type),
        levels: state.enemies.map((enemy) => enemy.level),
        width: state.room && state.room.width,
        band: state.band && state.band.backY,
        route: [[1, 1], [1, 3], [1, 2], [1, 0], [2, 0], [2, 1], [3, 1]].map(([col, row]) => {
          const cell = state.dungeon.cells.find((at) => at.col === col && at.row === row);
          return `${col},${row}=${state.stage.rooms[cell.room].name}`;
        })
      };
    });
    if (entry.stage !== "mirkwooddeep") fail(`entered ${entry.stage}, not mirkwooddeep`);
    if (entry.cells !== 15) fail(`dungeon has ${entry.cells} cells, not 15`);
    if (entry.hole) fail("the (3,2) hole became a cell");
    if (entry.room !== "铁门入口") fail(`entry room is ${entry.room}`);
    if (!entry.types.includes("cat")) fail("the entry room has no cat");
    if (!entry.types.includes("throwerElite")) fail("the entry room has no throwing ten-captain");
    if (!entry.types.includes("goblinBlue")) fail("the entry room has no recoloured goblin");
    if (entry.width !== 1008) fail(`entry room width is ${entry.width}, not 1008`);
    if (entry.band !== 256) fail(`entry band is ${entry.band}, not 256`);
    const wantedRoute = [
      "1,1=铁门入口",
      "1,3=宝箱浅沟",
      "1,2=猫妖岔路",
      "1,0=老树回廊",
      "2,0=藤蔓窄道",
      "2,1=投掷手坡",
      "3,1=暗咒猫妖的林地"
    ];
    if (JSON.stringify(entry.route) !== JSON.stringify(wantedRoute)) {
      fail(`pinned route is ${JSON.stringify(entry.route)}`);
    }
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS, "deep-entry.png") });

    /*
     * 清掉入口这一间（不只是“看见”它）：第一波 + 第二波都走 `damageEnemy` 的正规
     * 路径，再让房间自己结算。清完 check `room.cleared` —— Q9 要的“清一间”。
     */
    const cleared = await page.evaluate(() => {
      const Core = window.DNFCore;
      const state = window.nanoDnf.getState();
      for (let round = 0; round < 5; round += 1) {
        state.enemies.slice().forEach((enemy) => {
          if (!enemy.dead) Core.damageEnemy(state, enemy, 99999, 0, state.player.x);
        });
        Core.runFrames(state, 45, {});
        if (state.room && state.room.cleared) break;
      }
      return {
        cleared: !!(state.room && state.room.cleared),
        alive: state.enemies.filter((enemy) => !enemy.dead).length,
        pending: state.room && state.room.pendingWave ? state.room.pendingWave.length : 0
      };
    });
    if (!cleared.cleared) {
      fail(`the entry room did not clear: ${JSON.stringify(cleared)}`);
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(ARTIFACTS, "deep-entry-cleared.png") });

    /* 进 Boss 房：暗咒猫妖、半血金环、无横幅，然后打死结算。 */
    const boss = await page.evaluate(() => {
      const Core = window.DNFCore;
      const api = window.nanoDnf;
      const state = api.getState();
      Core.goToCell(state, state.dungeon.boss);
      const cat = state.enemies.find((enemy) => Core.isBossEnemy(enemy));
      if (!cat) return null;
      return {
        room: state.room && state.room.name,
        label: Core.monsterInfo(cat.type).label,
        level: Core.monsterInfo(cat.type).level,
        type: cat.type,
        behavior: cat.behavior,
        tenCaptain: state.enemies.some((enemy) => enemy.type === "deepElite"),
        width: state.room && state.room.width,
        band: state.band && state.band.backY
      };
    });
    if (!boss) fail("the boss cell fields no boss");
    if (boss.label !== "领主 - 暗咒猫妖") fail(`boss label is ${boss.label}`);
    if (boss.type !== "lugaruBoss" || boss.behavior !== "boss") {
      fail(`boss type/behavior is ${boss.type}/${boss.behavior}`);
    }
    if (!boss.tenCaptain) fail("the boss room has no deep ten-captain");
    if (boss.width !== 960) fail(`boss room width is ${boss.width}, not 960`);
    if (boss.band !== 256) fail(`boss band is ${boss.band}, not 256`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(ARTIFACTS, "deep-boss.png") });

    /* 打它一下，让当前目标条切到 Boss —— 猫脸头像走的是 `drawMonsterFace`。 */
    await page.evaluate(() => {
      const Core = window.DNFCore;
      const state = window.nanoDnf.getState();
      const cat = state.enemies.find((enemy) => Core.isBossEnemy(enemy));
      Core.damageEnemy(state, cat, 1, 0, state.player.x);
    });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(ARTIFACTS, "deep-boss-target.png") });

    const phase = await page.evaluate(() => {
      const Core = window.DNFCore;
      const state = window.nanoDnf.getState();
      const cat = state.enemies.find((enemy) => Core.isBossEnemy(enemy));
      /* 房间自己的名牌还挂在队列里；清掉它，只看半血那一下新增了什么。 */
      state.effects = [];
      for (let hit = 0; hit < 50 && cat.phase < 2; hit += 1) {
        Core.damageEnemy(state, cat, Math.ceil(cat.maxHp * 0.52), 0, state.player.x);
      }
      return {
        phase: cat.phase,
        banners: state.effects.filter((effect) => effect.kind === "banner").map((effect) => effect.text),
        gold: state.effects.some((effect) => effect.kind === "shockwave" && effect.gold)
      };
    });
    if (phase.phase !== 2) fail(`boss phase is ${phase.phase}, not 2`);
    if (!phase.gold) fail("the phase-two gold ring is missing");
    if (phase.banners.some((text) => /暗咒|暴怒|enraged/i.test(text))) {
      fail(`the phase-two banner should be silent, got ${JSON.stringify(phase.banners)}`);
    }

    await page.evaluate(() => {
      const Core = window.DNFCore;
      const state = window.nanoDnf.getState();
      const cat = state.enemies.find((enemy) => Core.isBossEnemy(enemy));
      for (let hit = 0; hit < 50 && !cat.dead; hit += 1) {
        Core.damageEnemy(state, cat, 99999, 0, state.player.x);
      }
    });
    await page.waitForTimeout(6200);
    const end = await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      return {
        victory: state.victory,
        finishedAt: state.finishedAt,
        stage: window.nanoDnf.getStage()
      };
    });
    if (!end.victory) fail("the cat king died but the run did not reach victory");
    await page.screenshot({ path: path.join(ARTIFACTS, "deep-clear.png") });

    if (diagnostics.consoleErrors.length) {
      fail(`console errors: ${diagnostics.consoleErrors.join(" | ")}`);
    }
    if (diagnostics.pageErrors.length) {
      fail(`page errors: ${diagnostics.pageErrors.join(" | ")}`);
    }
    if (diagnostics.failedRequests.length) {
      fail(`failed requests: ${diagnostics.failedRequests.join(" | ")}`);
    }
    const missing = ["monsters.png", "forest.png", "forest02.ogg"].filter(
      (name) => !diagnostics.assets.some((line) => line === `200 ${name}`)
    );
    if (missing.length) fail(`assets not loaded: ${missing.join(", ")}`);

    console.log("deep smoke OK", JSON.stringify({ entry, boss, phase, end }, null, 0));
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
