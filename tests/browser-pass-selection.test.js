"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

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

test('invalid browser pass is rejected on a dependency-free checkout', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-browser-cli-'));
  try {
    for (const name of ['tests/browser/playability.mjs', 'tests/browser/keyboard-policy.cjs', 'src/core.js']) {
      const target = path.join(directory, name);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.copyFileSync(path.resolve(__dirname, '..', name), target);
    }
    const result = spawnSync(process.execPath, ['tests/browser/playability.mjs'], {
      cwd: directory, env: {...process.env, PASSES: 'touch'}, encoding: 'utf8', timeout: 10000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported PASSES.*keyboard/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
