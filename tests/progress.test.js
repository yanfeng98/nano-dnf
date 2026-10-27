"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Progress = require("../src/progress.js");

function memoryStorage() {
  const store = {};
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; }
  };
}

test("a fresh profile has no gold, empty gear and three available quests", () => {
  const profile = Progress.defaults();
  assert.equal(profile.gold, 0);
  assert.deepEqual(Object.keys(profile.quests).sort(), ["breakables", "cats", "main"]);
  Object.keys(profile.quests).forEach((id) => {
    assert.equal(profile.quests[id].state, "available");
  });
  Progress.EQUIP_SLOTS.forEach((slot) => assert.equal(profile.equipment[slot], null));
});

test("progress survives a save/load round trip and old saves are normalized", () => {
  const storage = memoryStorage();
  const profile = Progress.defaults();
  Progress.accept(profile, "main");
  Progress.addGold(profile, 77);
  Progress.addItem(profile, "hpPotion", 2);
  Progress.save(profile, storage);
  const loaded = Progress.load(storage);
  assert.equal(loaded.gold, 77);
  assert.equal(loaded.items.hpPotion, 2);
  assert.equal(loaded.quests.main.state, "active");

  storage.setItem(Progress.STORAGE_KEY, JSON.stringify({ gold: 12, items: { hpPotion: 1 } }));
  const old = Progress.load(storage);
  assert.equal(old.gold, 12);
  assert.equal(old.items.hpPotion, 1);
  assert.equal(old.quests.main.state, "available");
});

test("the main quest turns in with gold and the starter weapon", () => {
  const profile = Progress.defaults();
  Progress.accept(profile, "main");
  Progress.noteClear(profile, "mirkwooddeep");
  assert.equal(profile.quests.main.done, true);
  const reward = Progress.turnIn(profile, "main");
  assert.equal(reward.gold, 500);
  assert.equal(profile.gold, 500);
  assert.equal(profile.quests.main.state, "turnedIn");
  assert.equal(profile.items.starterBlade, 1);
});

test("cat kills and breakables advance only their own active quest", () => {
  const profile = Progress.defaults();
  Progress.accept(profile, "cats");
  Progress.accept(profile, "breakables");
  Progress.noteKill(profile, "cat", 4);
  Progress.noteKill(profile, "goblinRed", 99);
  assert.equal(profile.quests.cats.progress, 4);
  assert.equal(profile.quests.breakables.progress, 0);
  Progress.noteBreak(profile, 5);
  assert.equal(profile.quests.breakables.done, true);
  Progress.noteKill(profile, "cat", 10);
  assert.equal(profile.quests.cats.done, true);
});

test("consumables are used, equipment is equipped and salvaged", () => {
  const profile = Progress.defaults();
  Progress.addItem(profile, "hpPotion", 1);
  const effect = Progress.useItem(profile, "hpPotion");
  assert.equal(effect.hp, 40);
  assert.equal(profile.items.hpPotion, 0);
  assert.equal(Progress.useItem(profile, "hpPotion"), null);

  Progress.addItem(profile, "starterBlade", 1);
  assert.equal(Progress.equip(profile, "starterBlade"), true);
  assert.equal(profile.equipment.weapon, "starterBlade");
  assert.equal(profile.items.starterBlade, undefined);

  Progress.addItem(profile, "starterBlade", 1);
  const salvage = Progress.salvage(profile, "starterBlade");
  assert.equal(salvage.material, 2);
  assert.equal(profile.items.material, 2);
  assert.ok(profile.gold > 0);
});

test("reset clears progress but is a separate store from records", () => {
  const storage = memoryStorage();
  const profile = Progress.defaults();
  Progress.addGold(profile, 500);
  Progress.accept(profile, "main");
  Progress.save(profile, storage);
  const fresh = Progress.reset(profile, storage);
  assert.equal(fresh.gold, 0);
  assert.equal(fresh.quests.main.state, "available");
  assert.deepEqual(Progress.load(storage), fresh);
});
