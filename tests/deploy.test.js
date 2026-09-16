"use strict";

/*
 * The deploy contract, checked offline.
 *
 * `src/records.js` once shipped missing: the Pages workflow staged a fixed file
 * list, so the live page loaded a 404 script while every local test stayed
 * green. These tests run the workflow's own staging step into a temp directory
 * and assert that everything the page references is really there, so the gap is
 * caught before a deploy rather than after it.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "pages.yml");

/** Pull one step's `run:` block out of the workflow without a YAML dependency. */
function workflowStepScript(stepName) {
  const lines = fs.readFileSync(WORKFLOW, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.notEqual(start, -1, `the workflow must keep a "${stepName}" step`);

  const body = [];
  let inRun = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*- name:/.test(line)) break;
    if (/^\s*run: \|/.test(line)) {
      inRun = true;
      continue;
    }
    if (!inRun) continue;
    if (line.trim() && !/^\s{10,}/.test(line)) break;
    body.push(line.replace(/^\s{10}/, ""));
  }
  assert.ok(body.length, `the "${stepName}" step must have a runnable script`);
  return body.join("\n");
}

function refsIn(file) {
  const html = fs.readFileSync(file, "utf8");
  return [...new Set([...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]))];
}

test("the workflow stages every asset index.html asks the browser for", () => {
  const stage = workflowStepScript("Stage the static site");
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "nano-dnf-stage-"));
  const script = stage.replaceAll("_site", site);

  execFileSync("bash", ["-c", script], { cwd: ROOT, stdio: "pipe" });

  const refs = refsIn(path.join(site, "index.html"));
  assert.ok(refs.length >= 6, `the page should reference its scripts and icon, got ${refs}`);
  refs.forEach((ref) => {
    assert.ok(
      fs.existsSync(path.join(site, ref)),
      `the staged site is missing ${ref} - the deploy would 404 it`
    );
  });
  assert.ok(
    fs.existsSync(path.join(site, "index.html")),
    "the staged site must contain the page itself"
  );
});

test("the staging step copies the whole src directory instead of a fixed list", () => {
  const stage = workflowStepScript("Stage the static site");

  assert.ok(
    /cp\s+src\/\*\.js\s/.test(stage),
    "stage src/*.js so a new browser module cannot be forgotten again"
  );
  const srcModules = fs
    .readdirSync(path.join(ROOT, "src"))
    .filter((name) => name.endsWith(".js"));
  assert.ok(srcModules.includes("records.js"), "records.js is the module that shipped missing");
  srcModules.forEach((name) => {
    assert.ok(
      !new RegExp(`cp\\s+src/${name.replace(".", "\\.")}\\b`).test(stage),
      `${name} should be covered by the glob, not listed by hand`
    );
  });
});

test("the workflow verifies the staged site before uploading it", () => {
  const stepNames = fs
    .readFileSync(WORKFLOW, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- name:"));
  const verifyAt = stepNames.indexOf("- name: Verify every referenced asset was staged");
  const uploadAt = stepNames.indexOf("- name: Upload the staged site");

  assert.notEqual(verifyAt, -1, "the staging guard must exist");
  assert.notEqual(uploadAt, -1, "the upload step must exist");
  assert.ok(
    verifyAt < uploadAt,
    "the guard has to run before the artifact is uploaded, not after"
  );
});

test("a deploy that lags the checkout is treated as a failure", async () => {
  /* The contract module stays dependency-free so this runs without node_modules. */
  const { sha256, referencedAssets } = await import("./deploy/deploy-contract.mjs");

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const refs = referencedAssets(html);
  assert.ok(refs.includes("src/main.js"), `the page must reference its entry point, got ${refs}`);

  /* The comparison the smoke check uses to call a deploy stale. */
  const local = fs.readFileSync(path.join(ROOT, "src", "main.js"));
  assert.equal(sha256(local), sha256(local));
  assert.notEqual(sha256(local), sha256(Buffer.from("a different build")));
});

test("the browser half is kept out of the dependency-free contract module", async () => {
  const contract = await import("./deploy/deploy-contract.mjs");
  assert.ok(contract.inspectPublished, "the contract module owns the published-page check");
  assert.ok(contract.waitForPublished, "and the bounded lag wait");

  const source = fs.readFileSync(
    path.join(ROOT, "tests", "deploy", "deploy-contract.mjs"),
    "utf8"
  );
  assert.equal(
    /from\s+["']playwright["']/.test(source),
    false,
    "importing playwright here would break `npm test` in CI, which installs no dependencies"
  );
});

test("a network blip is retried, while a real HTTP status is reported as-is", async () => {
  const { fetchBody } = await import("./deploy/deploy-contract.mjs");
  const realFetch = globalThis.fetch;

  try {
    /* Two transport failures, then success: the check must survive this. */
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("fetch failed");
      return new Response("hello", { status: 200 });
    };
    const recovered = await fetchBody("https://example.test/");
    assert.equal(calls, 3, "the flaky fetch should have been retried");
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.toString("utf8"), "hello");

    /* A 404 is a real answer: no retry, and the status is preserved. */
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    };
    const missing = await fetchBody("https://example.test/gone.js");
    assert.equal(calls, 1, "an HTTP status must not be retried");
    assert.equal(missing.status, 404);

    /* A persistent outage still fails after the attempt budget. */
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    };
    const dead = await fetchBody("https://example.test/", 2);
    assert.equal(calls, 2);
    assert.equal(dead.status, 0);
    assert.match(dead.error, /fetch failed/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
