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

    /* Real keys: up goes into the road, down reaches depth zero continuously,
       holding against an edge stops the gait, blur releases held directions. */
    await page.evaluate(() => window.nanoDnf.setTownPosition(500, 50));
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(300);
    await page.keyboard.up("ArrowUp");
    let moved = await page.evaluate(() => window.nanoDnf.getTown());
    if (moved.z <= 55) fail(`up did not move into the road: z=${moved.z}`);
    await page.evaluate(() => window.nanoDnf.setTownPosition(500, 1));
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(250);
    moved = await page.evaluate(() => window.nanoDnf.getTown());
    if (moved.z !== 0 || moved.moving) fail("the near edge did not stop movement and gait");
    await page.keyboard.up("ArrowDown");
    await page.evaluate(() => window.nanoDnf.setTownPosition(500, 50));
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(150);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const blurred = await page.evaluate(() => window.nanoDnf.getTown());
    await page.waitForTimeout(150);
    moved = await page.evaluate(() => window.nanoDnf.getTown());
    if (moved.x !== blurred.x || moved.moving) fail("blur left the town walking");
    await page.keyboard.up("ArrowRight");

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
    await page.keyboard.press("Space");

    /* Shop / storage / blacksmith open their windows. */
    await page.evaluate(() => window.nanoDnf.setTownPosition(1400, 50));
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    let panel = await page.evaluate(() => window.nanoDnf.getTown());
    if (panel.panel !== "shop") fail(`Kanna opened ${panel.panel}, not the shop`);
    const shopPortrait = () => page.evaluate(() => Array.from(
      document.querySelector("canvas").getContext("2d").getImageData(364, 94, 65, 60).data
    ).join(","));
    const portraitBefore = await shopPortrait();
    await page.evaluate(() => window.nanoDnf.setTownPosition(1500, 50));
    await page.waitForTimeout(100);
    if (await shopPortrait() !== portraitBefore) fail("the shop content area lets the moving town show through");
    await page.evaluate(() => window.nanoDnf.setTownPosition(1400, 50));
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

    /* Exercise actual money/item mutations through keyboard AND visible buttons. */
    await page.evaluate(() => {
      const profile = window.DNFProgress.normalize({ gold: 90, items: { material: 2 } });
      window.DNFProgress.save(profile, localStorage);
    });
    await page.reload();
    await page.waitForFunction(() => window.nanoDnf?.getAssetState().ready);
    await page.keyboard.press("Enter");
    await page.evaluate(() => window.nanoDnf.setTownPosition(1400, 50));
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    const clickCanvas = async (x, y) => {
      const box = await page.locator("canvas").boundingBox();
      await page.mouse.click(box.x + x * box.width / 960, box.y + y * box.height / 540);
    };
    await page.screenshot({ path: path.join(ARTIFACTS, "town-shop.png") });
    await clickCanvas(449, 408); // Buy selected HP potion.
    let bought = await page.evaluate(() => window.nanoDnf.getProgressState());
    if (bought.gold !== 60 || bought.items.hpPotion !== 1) fail("the visible buy button did not buy HP");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    bought = await page.evaluate(() => window.nanoDnf.getProgressState());
    if (bought.gold !== 30 || bought.items.mpPotion !== 1) fail("selected MP did not buy with Enter");
    await page.keyboard.press("Digit3");
    bought = await page.evaluate(() => window.nanoDnf.getProgressState());
    if (bought.gold !== 42 || bought.items.material !== 1) fail("material sale did not update gold/items");
    await clickCanvas(408, 215); // Select second grid cell (MP).
    await clickCanvas(449, 408);
    bought = await page.evaluate(() => window.nanoDnf.getProgressState());
    if (bought.gold !== 12 || bought.items.mpPotion !== 2) fail("grid selection bought the wrong item");
    await page.keyboard.press("Digit2");
    const refused = await page.evaluate(() => ({ p: window.nanoDnf.getProgressState(), t: window.nanoDnf.getTown() }));
    if (refused.p.gold !== 12 || refused.p.items.mpPotion !== 2 || refused.t.panelMessage !== "金币不够") {
      fail("an unaffordable purchase changed inventory or failed to explain why");
    }
    await clickCanvas(493, 408);
    if ((await page.evaluate(() => window.nanoDnf.getTown())).panel) fail("the visible close button did not close");

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
