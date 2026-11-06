/*
 * 通关后的翻牌奖励（`docs/adr/0055`）。
 *
 * 纯状态机 + 纯函数：它只说"现在该到哪一拍、选的是哪张、给什么"，不碰 DOM、
 * 不碰 canvas、也不碰存储。表现层在 `src/render.js`，输入在 `src/main.js`。
 * 这样翻牌的时序、倒计时自动选最左一张、以及"同一个种子给同一份奖励"都能单测。
 *
 * 参考录像（`dnf-dungeon-videos/00001-幽暗密林.mp4`，约 343.5–356s）：
 * 战绩页之后另起一页 `奖励`：蓝色魔法阵、中央红木宝箱打开、四张牌背、
 * 同步褪去青色光层成为金色牌面、`请选择奖励卡牌` + 3→2→1、超时自动选最左一张；
 * 选中后左侧出现玩家名条与物品卡（本局是「古老的法杖 ×1 + 3526 金币」）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"));
  } else {
    root.DNFReward = factory(root.DNFCore);
  }
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  /* V1 346.63..352.13 / V2 399.2..404.7: 1.2s spread, then
   * a shared cyan fade; prompt at 2s and the 3-second counter at 2.5s.
   * The first card's separate V2 highlight is not a staggered flip.
   * Stats lasts ~10s in both recordings. Chest/list and reveal timings are
   * still pending their own event reconstruction; do not claim those match.
   */
  var TIMES = {
    stats: 10.0,
    chest: 1.2,
    spread: 1.2,
    fadeStart: 1.2,
    flip: 1.9,
    prompt: 2.0,
    countdownAt: 2.5,
    countdown: 3.0,
    reveal: 2.5
  };
  var CARD_COUNT = 4;

  /** A small deterministic mix of the run's seed: the same seed pays the same card. */
  function hash(seed) {
    var x = (Number(seed) >>> 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }

  /** The item pool: the client's own cyan loot names (the recording's is 古老的法杖). */
  function itemPool() {
    var pool = Core.LOOT && Core.LOOT.cyan;
    return pool && pool.length ? pool : ["古老的法杖"];
  }

  function create(options) {
    options = options || {};
    var seed = Number(options.seed);
    if (!isFinite(seed)) seed = Core.DEFAULT_SEED;
    seed = seed >>> 0;
    var h = hash(seed);
    var pool = itemPool();
    var reward = {
      seed: seed,
      item: pool[h % pool.length],
      /* 参考里那张牌给 3526 金币；本作按种子给 500–3499，和地上捡的金币分开。 */
      gold: 500 + (h % 3000),
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
        : reward.phase === "chest" ? TIMES.chest
        : reward.phase === "cards" ? TIMES.countdownAt + TIMES.countdown
        : reward.phase === "reveal" ? TIMES.reveal : Infinity;
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
        reward.phase = "done";
      }
      reward.t = 0;
    }
    return reward;
  }

  function snapshot(reward) {
    if (!reward) return null;
    return {
      seed: reward.seed,
      item: reward.item,
      gold: reward.gold,
      phase: reward.phase,
      elapsed: Math.round(reward.elapsed * 1000) / 1000,
      t: Math.round(reward.t * 1000) / 1000,
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
    CARD_COUNT: CARD_COUNT,
    hash: hash,
    create: create,
    pick: pick,
    step: step,
    snapshot: snapshot
  };
});
