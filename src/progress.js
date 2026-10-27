/*
 * 跨局进度（`docs/adr/0065`）：金币、背包、装备、三条任务、已通关关卡。
 *
 * 纯数据 + 纯函数，和 `records.js` 同一套写法：浏览器里是
 * `window.DNFProgress`，Node 测试里是 CommonJS。**它不碰 records**：
 * 重置只清这里的进度，通关记录与最佳时间留在 `DNFRecords` 里。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DNFProgress = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = 1;
  var STORAGE_KEY = "nano-dnf.progress.v1";

  var EQUIP_SLOTS = [
    "weapon", "top", "bottom", "shoulder", "belt",
    "shoes", "necklace", "bracelet", "ring", "support"
  ];

  var ITEMS = {
    hpPotion: {
      id: "hpPotion", name: "HP 药水", category: "consumable",
      price: 30, hp: 40, note: "回复 40 点生命"
    },
    mpPotion: {
      id: "mpPotion", name: "MP 药水", category: "consumable",
      price: 30, mp: 40, note: "回复 40 点法力"
    },
    material: {
      id: "material", name: "下级硬化剂", category: "material",
      price: 12, note: "铁匠分解与商店回收的材料"
    },
    starterBlade: {
      id: "starterBlade", name: "生锈的铁剑", category: "equipment",
      slot: "weapon", price: 120, note: "主线奖励；本片装备加成为 0"
    },
    rustyBlade: {
      id: "rustyBlade", name: "锈蚀短剑", category: "equipment",
      slot: "weapon", price: 90, note: "精英掉落；本片装备加成为 0"
    },
    clothArmor: {
      id: "clothArmor", name: "粗布上衣", category: "equipment",
      slot: "top", price: 80, note: "精英掉落；本片装备加成为 0"
    },
    copperRing: {
      id: "copperRing", name: "铜戒指", category: "equipment",
      slot: "ring", price: 70, note: "精英掉落；本片装备加成为 0"
    }
  };

  var QUESTS = {
    main: {
      id: "main", title: "通关幽暗密林深处", npc: "seria",
      kind: "clear", stage: "mirkwooddeep", goal: 1,
      reward: { gold: 500, item: "starterBlade" }
    },
    cats: {
      id: "cats", title: "击杀 10 只猫妖", npc: "minet",
      kind: "kill", target: "cat", goal: 10,
      reward: { gold: 200, item: "hpPotion" }
    },
    breakables: {
      id: "breakables", title: "打碎 5 个木桶/宝箱", npc: "gsd",
      kind: "break", goal: 5,
      reward: { gold: 200, item: "mpPotion" }
    }
  };

  function defaults() {
    var quests = {};
    Object.keys(QUESTS).forEach(function (id) {
      quests[id] = { state: "available", progress: 0, done: false };
    });
    var equipment = {};
    EQUIP_SLOTS.forEach(function (slot) { equipment[slot] = null; });
    return {
      version: VERSION,
      gold: 0,
      items: { hpPotion: 0, mpPotion: 0, material: 0 },
      equipment: equipment,
      quests: quests,
      cleared: []
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** Merge whatever storage had onto the current shape, so old saves survive. */
  function normalize(raw) {
    var out = defaults();
    if (!raw || typeof raw !== "object") return out;
    if (typeof raw.gold === "number" && raw.gold >= 0) out.gold = Math.floor(raw.gold);
    if (raw.items && typeof raw.items === "object") {
      Object.keys(out.items).forEach(function (id) {
        if (typeof raw.items[id] === "number" && raw.items[id] >= 0) {
          out.items[id] = Math.floor(raw.items[id]);
        }
      });
    }
    if (raw.equipment && typeof raw.equipment === "object") {
      EQUIP_SLOTS.forEach(function (slot) {
        var item = raw.equipment[slot];
        if (typeof item === "string" && ITEMS[item]) out.equipment[slot] = item;
      });
    }
    if (raw.quests && typeof raw.quests === "object") {
      Object.keys(QUESTS).forEach(function (id) {
        var q = raw.quests[id];
        if (!q || typeof q !== "object") return;
        var state = ["available", "active", "turnedIn"].indexOf(q.state) >= 0
          ? q.state
          : "available";
        out.quests[id] = {
          state: state,
          progress: Math.max(0, Math.min(QUESTS[id].goal, Number(q.progress) || 0)),
          done: !!q.done
        };
      });
    }
    if (Array.isArray(raw.cleared)) {
      out.cleared = raw.cleared.filter(function (id) { return typeof id === "string"; });
    }
    out.version = VERSION;
    return out;
  }

  function load(storage) {
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (error) {
      return defaults();
    }
  }

  function save(profile, storage) {
    try {
      if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(profile));
      return true;
    } catch (error) {
      return false;
    }
  }

  function reset(profile, storage) {
    var fresh = defaults();
    save(fresh, storage);
    return fresh;
  }

  function addGold(profile, amount) {
    profile.gold = Math.max(0, Math.floor((profile.gold || 0) + (amount || 0)));
  }

  function addItem(profile, id, count) {
    var item = ITEMS[id];
    if (!item) return false;
    var amount = Math.max(1, Math.floor(count || 1));
    if (item.category === "equipment") {
      /* 装备只存一件；槽位本身在 `equip` 里管。 */
      profile.items[id] = (profile.items[id] || 0) + amount;
      return true;
    }
    profile.items[id] = (profile.items[id] || 0) + amount;
    return true;
  }

  function useItem(profile, id) {
    var item = ITEMS[id];
    if (!item || item.category !== "consumable") return null;
    if ((profile.items[id] || 0) <= 0) return null;
    profile.items[id] -= 1;
    return { hp: item.hp || 0, mp: item.mp || 0 };
  }

  function equip(profile, id) {
    var item = ITEMS[id];
    if (!item || item.category !== "equipment" || !item.slot) return false;
    if ((profile.items[id] || 0) <= 0) return false;
    profile.items[id] -= 1;
    if (profile.items[id] <= 0) delete profile.items[id];
    var old = profile.equipment[item.slot];
    profile.equipment[item.slot] = id;
    if (old) addItem(profile, old, 1);
    return true;
  }

  function salvage(profile, id) {
    var item = ITEMS[id];
    if (!item || item.category !== "equipment") return null;
    if ((profile.items[id] || 0) <= 0) return null;
    profile.items[id] -= 1;
    if (profile.items[id] <= 0) delete profile.items[id];
    addItem(profile, "material", 2);
    addGold(profile, Math.round((item.price || 0) * 0.4));
    return { material: 2, gold: Math.round((item.price || 0) * 0.4) };
  }

  function accept(profile, id) {
    var quest = profile.quests[id];
    if (!quest || quest.state !== "available") return false;
    quest.state = "active";
    return true;
  }

  function noteKill(profile, target, count) {
    Object.keys(QUESTS).forEach(function (id) {
      var def = QUESTS[id];
      var quest = profile.quests[id];
      if (!quest || quest.state !== "active" || def.kind !== "kill" || def.target !== target) return;
      quest.progress = Math.max(quest.progress, Math.min(def.goal, count || 0));
      quest.done = quest.progress >= def.goal;
    });
  }

  function noteBreak(profile, count) {
    Object.keys(QUESTS).forEach(function (id) {
      var def = QUESTS[id];
      var quest = profile.quests[id];
      if (!quest || quest.state !== "active" || def.kind !== "break") return;
      quest.progress = Math.max(quest.progress, Math.min(def.goal, count || 0));
      quest.done = quest.progress >= def.goal;
    });
  }

  function noteClear(profile, stageId) {
    if (stageId && profile.cleared.indexOf(stageId) < 0) profile.cleared.push(stageId);
    Object.keys(QUESTS).forEach(function (id) {
      var def = QUESTS[id];
      var quest = profile.quests[id];
      if (!quest || quest.state !== "active" || def.kind !== "clear") return;
      if (def.stage && def.stage !== stageId) return;
      quest.progress = def.goal;
      quest.done = true;
    });
  }

  function turnIn(profile, id) {
    var def = QUESTS[id];
    var quest = profile.quests[id];
    if (!def || !quest || quest.state !== "active" || !quest.done) return null;
    addGold(profile, def.reward.gold || 0);
    if (def.reward.item) addItem(profile, def.reward.item, 1);
    quest.state = "turnedIn";
    return clone(def.reward);
  }

  return {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    EQUIP_SLOTS: EQUIP_SLOTS,
    ITEMS: ITEMS,
    QUESTS: QUESTS,
    defaults: defaults,
    normalize: normalize,
    load: load,
    save: save,
    reset: reset,
    addGold: addGold,
    addItem: addItem,
    useItem: useItem,
    equip: equip,
    salvage: salvage,
    accept: accept,
    noteKill: noteKill,
    noteBreak: noteBreak,
    noteClear: noteClear,
    turnIn: turnIn
  };
});
