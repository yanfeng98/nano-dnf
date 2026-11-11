"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
const installStep = workflow.match(/- name: Install the smoke-test browser\n\s*run: \|\n((?: {10}[^\n]*\n)+)/);
assert.ok(installStep, "the published workflow must keep its browser installation step");
const installCommands = installStep[1].split("\n").map(line => line.slice(10)).join("\n");

function install(npmStatus, browserStatus) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nano-browser-install-"));
  try {
    for (const [name, status] of [["npm", npmStatus], ["npx", browserStatus]]) {
      fs.writeFileSync(path.join(dir, name),
        `#!/bin/bash\necho '${name} diagnostic: 50% complete'\necho 'second line'\nexit ${status}\n`,
        { mode: 0o755 });
    }
    return spawnSync("bash", ["-eo", "pipefail", "-c", installCommands], {
      cwd: root,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      encoding: "utf8"
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("browser install runs both commands when installation succeeds", () => {
  const result = install(0, 0);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm diagnostic/);
  assert.match(result.stdout, /npx diagnostic/);
  assert.doesNotMatch(result.stdout, /::error/);
});

test("npm install failure is visible in an escaped annotation and stops Chromium installation", () => {
  const result = install(23, 0);
  assert.equal(result.status, 23);
  assert.match(result.stdout, /::error title=Smoke browser installation: npm package::Exit 23: npm diagnostic: 50%25 complete%0Asecond line/);
  assert.doesNotMatch(result.stdout, /npx diagnostic/);
});

test("Chromium install failure reports its own stage and preserves the exit code", () => {
  const result = install(0, 42);
  assert.equal(result.status, 42);
  assert.match(result.stdout, /::error title=Smoke browser installation: Chromium and system dependencies::Exit 42: npx diagnostic/);
});
