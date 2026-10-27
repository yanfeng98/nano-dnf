/*
 * 城镇冒烟（`docs/adr/0065`）：标题 → 城镇 → 8 个 NPC → 城门 → 地区地图。
 * 只证明这条流程与原件加载，不冒充城镇的视觉/手感验收。
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
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
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
  throw new Error(`town smoke: ${message}`);
}

async function main() {
  const { server, port } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error)));
  page.on("requestfailed", (request) => diagnostics.failedRequests.push(request.url()));

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?seed=1`);
    await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getAssetState().ready,
                              null, { timeout: 30000 });
    await page.evaluate(() => window.nanoDnf.resetProgress());
    await page.keyboard.press("Enter");
    await page.waitForTimeout(350);

    const town = await page.evaluate(() => window.nanoDnf.getTown());
    if (!town.open) fail("Enter did not open the town");
    if (town.npcCount !== 8) fail(`town has ${town.npcCount} NPCs, not 8`);
    ["seria", "minet", "gsd", "kanna", "brownie", "sinda", "guard", "guardCaptain"]
      .forEach((id) => {
        if (!town.npcs.includes(id)) fail(`town is missing ${id}`);
      });
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS, "town.png") });

    /* Walk up to Seria and talk (the dialogue is the first-pass NPC hook). */
    await page.evaluate(() => window.nanoDnf.setTownPosition(650, 50));
    await page.keyboard.press("Space");
    await page.waitForTimeout(120);
    const talk = await page.evaluate(() => ({
      town: window.nanoDnf.getTown(),
      progress: window.nanoDnf.getProgressState()
    }));
    if (talk.town.dialogue !== "seria") fail(`Seria did not answer, got ${talk.town.dialogue}`);
    if (talk.progress.quests.main.state !== "active") {
      fail("Seria did not hand out the main quest");
    }

    /* Shop / storage / blacksmith open their windows. */
    await page.evaluate(() => window.nanoDnf.setTownPosition(1400, 50));
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    let panel = await page.evaluate(() => window.nanoDnf.getTown());
    if (panel.panel !== "shop") fail(`Kanna opened ${panel.panel}, not the shop`);
    await page.keyboard.press("Digit1");
    await page.waitForTimeout(60);
    panel = await page.evaluate(() => window.nanoDnf.getTown());
    if (!panel.panelMessage) fail("buying without gold left no message");
    await page.keyboard.press("Escape");

    await page.evaluate(() => window.nanoDnf.setTownPosition(1700, 50));
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    panel = await page.evaluate(() => window.nanoDnf.getTown());
    if (panel.panel !== "storage") fail(`Brownie opened ${panel.panel}, not storage`);
    await page.keyboard.press("KeyR");
    await page.waitForTimeout(60);
    panel = await page.evaluate(() => window.nanoDnf.getTown());
    if (!/确认/.test(panel.panelMessage || "")) fail("reset did not ask for confirmation");
    await page.keyboard.press("KeyR");
    await page.waitForTimeout(80);
    const reset = await page.evaluate(() => window.nanoDnf.getProgressState());
    if (reset.gold !== 0 || reset.quests.main.state !== "available") {
      fail("reset did not clear the quest/gold");
    }
    await page.keyboard.press("Escape");

    await page.evaluate(() => window.nanoDnf.setTownPosition(2000, 50));
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    panel = await page.evaluate(() => window.nanoDnf.getTown());
    if (panel.panel !== "craft") fail(`Sinda opened ${panel.panel}, not the craft panel`);
    await page.keyboard.press("Escape");

    /* The gate opens the region map and closes the town. */
    await page.evaluate(() => window.nanoDnf.setTownPosition(2420, 50));
    await page.keyboard.press("Space");
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({
      town: window.nanoDnf.getTown(),
      progress: window.nanoDnf.getProgress()
    }));
    if (after.town.open) fail("the gate did not close the town");
    if (!after.progress.regionOpen) fail("the gate did not open the region map");

    if (diagnostics.consoleErrors.length) {
      fail(`console errors: ${diagnostics.consoleErrors.join(" | ")}`);
    }
    if (diagnostics.pageErrors.length) {
      fail(`page errors: ${diagnostics.pageErrors.join(" | ")}`);
    }
    if (diagnostics.failedRequests.length) {
      fail(`failed requests: ${diagnostics.failedRequests.join(" | ")}`);
    }
    console.log(`town smoke OK ${JSON.stringify({
      town: town.npcs,
      dialogue: talk.town.dialogue,
      quest: talk.progress.quests.main.state,
      region: after.progress.regionOpen
    })}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
