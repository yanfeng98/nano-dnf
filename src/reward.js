/*
 * 通关后的翻牌奖励（`docs/adr/0055`）。
 *
 * 纯状态机 + 纯函数：它只说"现在该到哪一拍、选的是哪张、给什么"，不碰 DOM、
 * 不碰 canvas、也不碰存储。表现层在 `src/render.js`，输入在 `src/main.js`。
 * 这样翻牌时序、自动选择、录像参考奖品以及一次选牌只发一次奖都能单测。
 *
 * 参考录像（`dnf-dungeon-videos/00001-幽暗密林.mp4`，约 343.5–356s）：
 * 战绩页之后另起一页 `奖励`：蓝色魔法阵、中央红木宝箱打开、四张牌背、
 * 同步褪去青色光层成为金色牌面、`请选择奖励卡牌` + 3→2→1、超时自动选最左一张；
 * 选中后左侧出现玩家名条与物品卡（本局是「古老的法杖 ×1 + 3526 金币」）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"), require("./progress.js"));
  } else {
    root.DNFReward = factory(root.DNFCore, root.DNFProgress);
  }
})(typeof self !== "undefined" ? self : this, function (Core, Progress) {
  "use strict";

  /* V1 346.63..352.13 / V2 399.2..404.7: 1.2s spread, then
   * a shared cyan fade; prompt at 2s and the 3-second counter at 2.5s.
   * The first card's separate V2 highlight is not a staggered flip.
   * V1 355.13..355.93 / V2 407.7..408.5: a shared .8s fade after
   * 3s from selection. List content, chest effects and the prize flip itself remain pending.
   */
  var TIMES = {
    stats: 10.0,
    chest: 115 / 30,
    spread: 1.2,
    fadeStart: 1.2,
    flip: 1.9,
    prompt: 2.0,
    countdownAt: 2.5,
    countdown: 3.0,
    // Automatic selection V1 352.133 / V2 404.7; fade starts ~3s later.
    reveal: 3.0,
    fade: 0.8
  };
  var CARD_COUNT = 4;

  // Observed reward/list-to-spread intervals, not a formula for list length.
  // V1 ~342.8..346.633; V2 ~397.0..399.2. Fade boundaries are approximate.
  function chestDuration(reward) {
    return reward && reward.stage === "mirkwooddeep" ? 66 / 30 : TIMES.chest;
  }

  // Observed reference outcomes, not a reconstructed random-drop formula.
  // V1 354s: staff +3526; V2 406s: green kunic totem +6094. The earlier
  // seed-based material/potion pool had no evidence in either reward card.
  var REFERENCE_PRIZES = {
    mirkwood: { itemId: "ancientStaff", gold: 3526 },
    mirkwooddeep: { itemId: "kunicTotem", gold: 6094 }
  };

  function create(options) {
    options = options || {};
    var seed = Number(options.seed);
    if (!isFinite(seed)) seed = Core.DEFAULT_SEED;
    seed = seed >>> 0;
    var stage = options.stage || Core.DEFAULT_STAGE;
    var prize = REFERENCE_PRIZES[stage];
    if (!prize) return null;
    var reward = {
      seed: seed,
      stage: stage,
      itemId: prize.itemId,
      item: Progress.ITEMS[prize.itemId].name,
      gold: prize.gold,
      claimed: false,
      phase: "stats",
      t: 0,
      /* The shared result circle keeps turning across page transitions. */
      elapsed: 0,
      /* 0..3：哪一张被选中；null = 还没选。 */
      picked: null,
      /* The cards are all the same face, as in the recording; this is the flip. */
      faceUp: false,
      countdown: 3
    };
    return reward;
  }

  function clamp01(value) { return Math.max(0, Math.min(1, value)); }

  function syncCards(reward) {
    reward.faceUp = reward.t + 1e-9 >= TIMES.flip;
    var left = TIMES.countdown - Math.max(0, reward.t - TIMES.countdownAt);
    reward.countdown = Math.max(0, Math.ceil(left - 1e-9));
  }

  /**
   * 选一张牌（0..3）。只在一手牌还开着、而且**已经翻成金色牌面**之后算数。
   *
   * 业主 2026-10-21：「我选择第三个，翻得不是」。青光尚未褪去时不收选择，
   * 避免没有展示金色牌面就直接跳进领奖。具体时刻现按两段录像重审。
   */
  function pick(reward, index) {
    if (!reward || reward.phase !== "cards" || reward.picked !== null) return false;
    if (!reward.faceUp) return false;
    var spot = Math.floor(Number(index));
    if (!isFinite(spot) || spot < 0 || spot >= CARD_COUNT) return false;
    reward.picked = spot;
    reward.phase = "reveal";
    reward.t = 0;
    return true;
  }

  /** Advance across every elapsed event, preserving a delayed frame's remainder. */
  function step(reward, dt) {
    if (!reward) return null;
    var span = Number(dt);
    if (!isFinite(span) || span <= 0) return reward;
    reward.elapsed += span;
    var remaining = span;
    while (remaining > 0) {
      var limit = reward.phase === "stats" ? TIMES.stats
        : reward.phase === "chest" ? chestDuration(reward)
        : reward.phase === "cards" ? TIMES.countdownAt + TIMES.countdown
        : reward.phase === "reveal" ? TIMES.reveal
        : reward.phase === "fade" ? TIMES.fade : Infinity;
      var advance = Math.min(remaining, Math.max(0, limit - reward.t));
      reward.t += advance;
      remaining -= advance;
      if (reward.phase === "cards") syncCards(reward);
      if (reward.t + 1e-9 < limit) break;
      if (reward.phase === "stats") {
        reward.phase = "chest";
      } else if (reward.phase === "chest") {
        reward.phase = "cards";
        reward.faceUp = false;
        reward.countdown = 3;
      } else if (reward.phase === "cards") {
        pick(reward, 0);
      } else if (reward.phase === "reveal") {
        reward.phase = "fade";
      } else if (reward.phase === "fade") {
        reward.phase = "done";
      }
      reward.t = 0;
    }
    return reward;
  }

  // Selection is the payment boundary; a delayed frame may already be done.
  function takePrize(reward) {
    if (!reward || reward.picked === null || reward.claimed) return null;
    if (["reveal", "fade", "done"].indexOf(reward.phase) < 0) return null;
    reward.claimed = true;
    return { itemId: reward.itemId, gold: reward.gold };
  }

  function snapshot(reward) {
    if (!reward) return null;
    return {
      seed: reward.seed,
      stage: reward.stage,
      itemId: reward.itemId,
      claimed: reward.claimed,
      item: reward.item,
      gold: reward.gold,
      phase: reward.phase,
      elapsed: Math.round(reward.elapsed * 1000) / 1000,
      t: Math.round(reward.t * 1000) / 1000,
      opacity: reward.phase === "done" ? 0 : reward.phase === "fade" ? 1 - clamp01(reward.t / TIMES.fade) : 1,
      picked: reward.picked,
      faceUp: reward.faceUp,
      countdown: reward.countdown,
      spread: reward.phase === "cards" ? clamp01(reward.t / TIMES.spread) : 1,
      blue: reward.phase === "cards"
        ? 1 - clamp01((reward.t - TIMES.fadeStart) / (TIMES.flip - TIMES.fadeStart)) : 0,
      promptVisible: reward.phase === "cards" && reward.t + 1e-9 >= TIMES.prompt,
      countdownVisible: reward.phase === "cards" && reward.t + 1e-9 >= TIMES.countdownAt,
      flash: reward.phase === "cards" ? 1 - clamp01(reward.t / 0.7) : 0,
      cards: CARD_COUNT
    };
  }

  return {
    TIMES: TIMES,
    chestDuration: chestDuration,
    CARD_COUNT: CARD_COUNT,
    REFERENCE_PRIZES: REFERENCE_PRIZES,
    takePrize: takePrize,
    create: create,
    pick: pick,
    step: step,
    snapshot: snapshot
  };
});
