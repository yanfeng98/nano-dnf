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
 * The contract half (assets exist, bytes still match the checkout) lives in
 * deploy-contract.mjs so the dependency-free `npm test` job can check it. This
 * script adds the browser half: load the live URL, wait for the game to boot,
 * idle on the title, and fail on any console, page or request error.
 *
 *   npm run test:live
 *   LIVE_URL=https://example.test/nano-dnf/ npm run test:live
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_URL,
  DEFAULT_WAIT_SECONDS,
  waitForPublished
} from "./deploy-contract.mjs";

function flag(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const baseUrl = flag("url", process.env.LIVE_URL || DEFAULT_URL);
const waitSeconds = Number(
  flag("wait-seconds", process.env.LIVE_WAIT_SECONDS || DEFAULT_WAIT_SECONDS)
);
const IDLE_SECONDS = 5;

function chromiumLaunchOptions() {
  const cached = [
    process.env.CHROMIUM_PATH,
    process.env.HOME && path.join(process.env.HOME, ".cache/ms-playwright/chromium-1161/chrome-linux/chrome"),
    process.env.HOME &&
      path.join(process.env.HOME, ".cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell")
  ].find((candidate) => candidate && fs.existsSync(candidate));
  return cached ? { executablePath: cached } : {};
}

const BOOT_ATTEMPTS = 3;

/**
 * Load the live build and prove it boots, idles safely and stays quiet.
 *
 * The first load after a deploy can be slow while the CDN warms, so the boot is
 * retried on a fresh page; problems are only kept from the attempt that worked,
 * because an aborted navigation produces failures of its own. A 404 or a page
 * that throws still fails all three attempts and is reported.
 */
async function smokeTheBuild() {
  const browser = await chromium.launch(chromiumLaunchOptions());
  let problems = [];
  let idle = null;
  let booted = false;

  for (let attempt = 1; attempt <= BOOT_ATTEMPTS && !booted; attempt += 1) {
    const page = await browser.newPage();
    const attemptProblems = [];
    page.on("console", (message) => {
      if (message.type() === "error") attemptProblems.push(`console error: ${message.text()}`);
    });
    page.on("pageerror", (error) => attemptProblems.push(`page error: ${String(error)}`));
    page.on("requestfailed", (request) => attemptProblems.push(`failed request: ${request.url()}`));
    page.on("response", (response) => {
      if (response.status() >= 400) {
        attemptProblems.push(`HTTP ${response.status()} ${response.url()}`);
      }
    });

    try {
      /* domcontentloaded is enough: the game boots from its scripts, not images. */
      const response = await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
      if (!response || response.status() !== 200) {
        throw new Error(`HTTP ${response ? response.status() : "none"}`);
      }
      await page.waitForFunction(() => window.nanoDnf && window.nanoDnf.getState().room, {
        timeout: 30000
      });

      /* Idle on the title: the dungeon must not be running behind it. */
      await page.waitForTimeout(IDLE_SECONDS * 1000);
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
      problems = attemptProblems;
      booted = true;
    } catch (error) {
      if (attempt === BOOT_ATTEMPTS) {
        problems = [
          ...attemptProblems,
          `the live page did not boot after ${BOOT_ATTEMPTS} attempts: ${String(error)}`
        ];
      } else {
        console.log(`live page load attempt ${attempt} failed, retrying: ${String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
      }
    } finally {
      await page.close();
    }
  }
  await browser.close();

  if (idle) {
    if (idle.hp !== idle.maxHp || idle.damageTaken !== 0 || idle.time !== 0 || idle.defeat) {
      problems.push(
        `the dungeon ran behind the title for ${IDLE_SECONDS}s: ` +
          `hp=${idle.hp}/${idle.maxHp} damageTaken=${idle.damageTaken} time=${idle.time} defeat=${idle.defeat}`
      );
    }
    if (typeof idle.seed !== "number") problems.push("the live build did not report a seed");
  }

  return { problems, idle };
}

async function main() {
  console.log(`live smoke against ${baseUrl} (deploy lag budget ${waitSeconds}s)`);

  const published = await waitForPublished(baseUrl, waitSeconds, (message) => console.log(message));
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

/* Only run when invoked as a script, so importing it stays side-effect free. */
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
