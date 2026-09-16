/*
 * Deployed-artifact smoke check.
 *
 * Every other test in this repo runs against the checkout, so two production
 * failures shipped without any of them noticing:
 *   - the Pages workflow staged a fixed file list and never published
 *     `src/records.js`, so the live page loaded a 404 script and threw;
 *   - an idle page was mobbed to 0 HP because the dungeon ran behind the title.
 * Both were only visible on the deployed build.
 *
 * This script closes that gap: it fetches the live page, proves every asset the
 * page references really exists, proves the published bytes still match the
 * checkout (a lagging deploy fails loudly), and then loads the live URL in
 * headless Chromium to prove the game boots, stays inert behind the title and
 * reports no console, page or request errors.
 *
 *   npm run test:live
 *   LIVE_URL=https://example.test/nano-dnf/ npm run test:live
 */

import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_URL = "https://luyf-lemon-love.space/nano-dnf/";
const DEFAULT_WAIT_SECONDS = 300;
const REF_PATTERN = /(?:src|href)="\.\/([^"]+)"/g;

/** Every asset the page asks the browser to load, in document order. */
export function referencedAssets(html) {
  return [...new Set([...html.matchAll(REF_PATTERN)].map((match) => match[1]))];
}

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function flag(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const baseUrl = flag("url", process.env.LIVE_URL || DEFAULT_URL);
const waitSeconds = Number(flag("wait-seconds", process.env.LIVE_WAIT_SECONDS || DEFAULT_WAIT_SECONDS));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBody(target) {
  try {
    const response = await fetch(target, { redirect: "follow" });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    return { status: 0, body: Buffer.alloc(0), error: String(error) };
  }
}

/** Compare the published bytes with the checkout for one relative path. */
function checkoutMatches(relPath, published) {
  const local = path.join(ROOT, relPath);
  if (!fs.existsSync(local)) return { checked: false };
  return {
    checked: true,
    matches: sha256(fs.readFileSync(local)) === sha256(published),
    localHash: sha256(fs.readFileSync(local)),
    publishedHash: sha256(published)
  };
}

async function inspectPublished() {
  const problems = [];
  const index = await fetchBody(baseUrl);
  if (index.status !== 200) {
    return {
      problems: [`${baseUrl} returned HTTP ${index.status}${index.error ? ` (${index.error})` : ""}`],
      refs: [],
      lagging: []
    };
  }

  const unique = referencedAssets(index.body.toString("utf8"));
  if (!unique.length) problems.push("the live index.html references no local assets");

  const lagging = [];
  for (const relPath of unique) {
    const asset = await fetchBody(new URL(relPath, baseUrl).toString());
    if (asset.status !== 200) {
      problems.push(`${relPath} returned HTTP ${asset.status} - the deploy is missing a referenced asset`);
      continue;
    }
    const comparison = checkoutMatches(relPath, asset.body);
    if (comparison.checked && !comparison.matches) {
      lagging.push(`${relPath} (live ${comparison.publishedHash.slice(0, 12)} vs checkout ${comparison.localHash.slice(0, 12)})`);
    }
  }

  const indexComparison = checkoutMatches("index.html", index.body);
  if (indexComparison.checked && !indexComparison.matches) {
    lagging.push(`index.html (live ${indexComparison.publishedHash.slice(0, 12)} vs checkout ${indexComparison.localHash.slice(0, 12)})`);
  }

  return { problems, refs: unique, lagging };
}

/** Wait out CDN propagation before calling a deploy lagging. */
async function waitForPublished() {
  const deadline = Date.now() + waitSeconds * 1000;
  let last = await inspectPublished();
  while (last.lagging.length && Date.now() < deadline) {
    console.log(`waiting for the deploy to catch up: ${last.lagging.join(", ")}`);
    await sleep(15000);
    last = await inspectPublished();
  }
  return last;
}

function chromiumLaunchOptions() {
  const cached = [
    process.env.CHROMIUM_PATH,
    process.env.HOME && path.join(process.env.HOME, ".cache/ms-playwright/chromium-1161/chrome-linux/chrome"),
    process.env.HOME &&
      path.join(process.env.HOME, ".cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell")
  ].find((candidate) => candidate && fs.existsSync(candidate));
  return cached ? { executablePath: cached } : {};
}

/** Load the live build and prove it boots, idles safely and stays quiet. */
async function smokeTheBuild() {
  const problems = [];
  const browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${String(error)}`));
  page.on("requestfailed", (request) => problems.push(`failed request: ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()} ${response.url()}`);
  });

  let idle = null;
  try {
    const response = await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
    if (!response || response.status() !== 200) {
      problems.push(`the live page returned HTTP ${response ? response.status() : "none"}`);
    }
    await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room, {
      timeout: 30000
    });

    /* Idle on the title: the dungeon must not be running behind it. */
    const idleSeconds = 5;
    await page.waitForTimeout(idleSeconds * 1000);
    idle = await page.evaluate(() => {
      const state = window.nanoDnf.getState();
      return {
        seed: window.nanoDnf.getSeed(),
        hp: state.player.hp,
        maxHp: state.player.maxHp,
        damageTaken: state.stats.damageTaken,
        time: state.time,
        defeat: state.defeat,
        room: state.room.name
      };
    });
    if (idle.hp !== idle.maxHp || idle.damageTaken !== 0 || idle.time !== 0 || idle.defeat) {
      problems.push(
        `the dungeon ran behind the title for ${idleSeconds}s: ` +
          `hp=${idle.hp}/${idle.maxHp} damageTaken=${idle.damageTaken} time=${idle.time} defeat=${idle.defeat}`
      );
    }
    if (typeof idle.seed !== "number") problems.push("the live build did not report a seed");
  } catch (error) {
    problems.push(`the live page did not boot: ${String(error)}`);
  } finally {
    await browser.close();
  }

  return { problems, idle };
}

async function main() {
  console.log(`live smoke against ${baseUrl} (deploy lag budget ${waitSeconds}s)`);
  const published = await waitForPublished();
  published.lagging.forEach((entry) => {
    published.problems.push(`the deployed build lags the checkout: ${entry}`);
  });

  const build = await smokeTheBuild();
  const problems = [...published.problems, ...build.problems];

  console.log(
    JSON.stringify(
      {
        url: baseUrl,
        referencedAssets: published.refs,
        idle: build.idle,
        problems
      },
      null,
      2
    )
  );

  if (problems.length) {
    console.error(`live smoke FAILED:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("live smoke OK: the deployed build matches the checkout and boots cleanly");
}

/* Only run when invoked as a script, so the helpers stay unit testable. */
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
