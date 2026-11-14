"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

for (const mode of ["touch", "keybord"]) {
  test(`browser proof rejects unsupported PASSES=${mode} instead of passing without a run`, () => {
    const result = spawnSync(process.execPath, ["tests/browser/playability.mjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, PASSES: mode },
      encoding: "utf8",
      timeout: 10000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported PASSES.*keyboard/);
    assert.doesNotMatch(result.stdout, /browser playability OK/);
  });
}
