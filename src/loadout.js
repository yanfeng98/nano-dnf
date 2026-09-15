/*
 * Skill loadout: which DNF skill sits in which hotbar slot.
 *
 * Pure data + pure functions so the drag-and-drop rules can be unit tested
 * without a DOM. Loaded as `window.DNFLoadout` in the browser and as a
 * CommonJS module in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DNFLoadout = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SLOT_COUNT = 6;
  var SLOT_KEYS = ["A", "S", "D", "F", "G", "H"];
  var DEFAULT_SLOTS = [
    "upSlash",
    "mountainBreaker",
    "crossSlash",
    "ghostSlash",
    "graspHead",
    "mountainRift"
  ];

  function create(skillIds) {
    var valid = skillIds || [];
    return DEFAULT_SLOTS.map(function (skillId) {
      return valid.indexOf(skillId) === -1 ? null : skillId;
    });
  }

  function slotOf(loadout, skillId) {
    return loadout.indexOf(skillId);
  }

  /** Drop `skillId` on `slotIndex`; if it already sits elsewhere, swap. */
  function assign(loadout, slotIndex, skillId) {
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return loadout.slice();
    var next = loadout.slice();
    if (!skillId) {
      next[slotIndex] = null;
      return next;
    }
    var existing = next.indexOf(skillId);
    var displaced = next[slotIndex];
    if (existing !== -1 && existing !== slotIndex) {
      next[existing] = displaced;
    }
    next[slotIndex] = skillId;
    return next;
  }

  function swap(loadout, fromIndex, toIndex) {
    if (fromIndex === toIndex) return loadout.slice();
    var next = loadout.slice();
    var a = next[fromIndex];
    next[fromIndex] = next[toIndex];
    next[toIndex] = a;
    return next;
  }

  function clearSlot(loadout, slotIndex) {
    var next = loadout.slice();
    if (slotIndex >= 0 && slotIndex < SLOT_COUNT) next[slotIndex] = null;
    return next;
  }

  function serialize(loadout) {
    return loadout
      .map(function (skillId) {
        return skillId || "";
      })
      .join(",");
  }

  function deserialize(text, skillIds) {
    var valid = skillIds || [];
    var parts = String(text || "").split(",");
    var next = [];
    for (var index = 0; index < SLOT_COUNT; index += 1) {
      var value = (parts[index] || "").trim();
      next.push(valid.indexOf(value) !== -1 ? value : null);
    }
    return next;
  }

  /** Slot index for a keyboard code such as "KeyD" (or -1). */
  function slotForCode(code) {
    if (!code || code.indexOf("Key") !== 0) return -1;
    return SLOT_KEYS.indexOf(code.slice(3));
  }

  return {
    SLOT_COUNT: SLOT_COUNT,
    SLOT_KEYS: SLOT_KEYS,
    DEFAULT_SLOTS: DEFAULT_SLOTS,
    create: create,
    slotOf: slotOf,
    assign: assign,
    swap: swap,
    clearSlot: clearSlot,
    serialize: serialize,
    deserialize: deserialize,
    slotForCode: slotForCode
  };
});
