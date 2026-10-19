/*
 * 通关后的翻牌奖励（`docs/adr/0055`）。
 *
 * 纯状态机 + 纯函数：它只说"现在该到哪一拍、选的是哪张、给什么"，不碰 DOM、
 * 不碰 canvas、也不碰存储。表现层在 `src/render.js`，输入在 `src/main.js`。
 * 这样翻牌的时序、倒计时自动选最左一张、以及"同一个种子给同一份奖励"都能单测。
 *
 * 参考录像（`dnf-dungeon-videos/00001-幽暗密林.mp4`，约 343.5–356s）：
 * 战绩页之后另起一页 `奖励`：蓝色魔法阵、中央红木宝箱打开、四张牌背、
 * 同时翻成金色宝箱面、`请选择奖励卡牌` + 3→2→1、超时自动选最左一张；
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

  /*
   * 参考的整段约 22.5 秒（牌背 1.5、翻面 0.5、选牌 3.5、领奖 2.5，加上前后）。
   * 本作压到约 13 秒：翻牌的**内容与交互**照录像，节奏按本作已有的结算页压缩。
   */
  var TIMES = {
    stats: 3.0,
    chest: 1.2,
    flip: 0.5,
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
      /* 0..3：哪一张被选中；null = 还没选。 */
      picked: null,
      /* The cards are all the same face, as in the recording; this is the flip. */
      faceUp: false,
      countdown: 3
    };
    return reward;
  }

  function toCards(reward) {
    reward.phase = "cards";
    reward.t = 0;
    reward.faceUp = false;
    reward.countdown = 3;
  }

  /** 选一张牌（0..3）。只在一手牌还开着的时候算数。 */
  function pick(reward, index) {
    if (!reward || reward.phase !== "cards" || reward.picked !== null) return false;
    var spot = Math.floor(Number(index));
    if (!isFinite(spot) || spot < 0 || spot >= CARD_COUNT) return false;
    reward.picked = spot;
    reward.phase = "reveal";
    reward.t = 0;
    return true;
  }

  /**
   * 走一帧。`stats` 走完进 `chest`（宝箱打开），再进 `cards`：0.5 秒后翻面，
   * 然后 3→2→1；倒计时到点**自动选最左一张**（参考里就是这么收的）。
   */
  function step(reward, dt) {
    if (!reward) return null;
    var span = Number(dt);
    if (!isFinite(span) || span <= 0) return reward;
    reward.t += span;

    if (reward.phase === "stats") {
      if (reward.t >= TIMES.stats) {
        reward.phase = "chest";
        reward.t -= TIMES.stats;
      }
    }
    if (reward.phase === "chest") {
      if (reward.t >= TIMES.chest) {
        toCards(reward);
      }
    }
    if (reward.phase === "cards") {
      if (!reward.faceUp && reward.t >= TIMES.flip) reward.faceUp = true;
      if (reward.faceUp) {
        var left = Math.max(0, TIMES.countdown - (reward.t - TIMES.flip));
        reward.countdown = Math.max(0, Math.ceil(left));
        if (reward.t - TIMES.flip >= TIMES.countdown) pick(reward, 0);
      }
    } else if (reward.phase === "reveal") {
      if (reward.t >= TIMES.reveal) {
        reward.phase = "done";
        reward.t = 0;
      }
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
      t: Math.round(reward.t * 1000) / 1000,
      picked: reward.picked,
      faceUp: reward.faceUp,
      countdown: reward.countdown,
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
