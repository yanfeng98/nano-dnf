/*
 * Canvas renderer for nano-dnf. Pure drawing: reads state, never mutates it.
 * Loaded as `window.DNFRender` in the browser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"), require("./loadout.js"));
  } else {
    root.DNFRender = factory(root.DNFCore, root.DNFLoadout);
  }
})(typeof self !== "undefined" ? self : this, function (Core, Loadout) {
  "use strict";

  var ARENA = Core.ARENA;
  var PALETTE = {
    night: "#05070f",
    skyTop: "#0a1020",
    skyMid: "#141d33",
    skyBottom: "#1d2438",
    wallFar: "#111726",
    wallNear: "#1b2338",
    wallEdge: "#2b3757",
    floorTop: "#2c2a44",
    floorBottom: "#120e1e",
    floorLine: "rgba(255, 214, 170, 0.08)",
    gold: "#e3bf72",
    goldDim: "#8c7338",
    hp: "#69e08a",
    hpBack: "#3a1c22",
    mp: "#5aa9ff",
    mpBack: "#1a2740",
    xp: "#ffd66b",
    xpBack: "#3a3218",
    text: "#f2f6ff",
    textDim: "rgba(226, 236, 255, 0.62)",
    danger: "#ff5f6d",
    ghost: "#b98cff"
  };

  /*
   * assets/slayer.png: SPRITE.cols columns x 5 rows of SPRITE.frameW x
   * SPRITE.frameH cells. The cell is sized for the widest DNF frame (a swing
   * that reaches 115px right of the feet and 120px above them), because a cell
   * that only fits the body crops the katana and the slash arc mid-blade.
   */
  var SPRITE = {
    frameW: 208,
    frameH: 176,
    cols: 42,
    anchorX: 88,
    anchorY: 156,
    rows: { idle: 0, run: 1, attack: 2, skill: 3, extras: 4, clips: 5, clips2: 6 },
    /* Frames the renderer actually plays per row; the rest of the row is spare art.
       The stand is a four-frame breath off the client's "still" frames, the attack
       is the whole normal-attack chain (see Core.ATTACK_STAGES). */
    frames: { idle: 4, run: 12, attack: 27, skill: 6, extras: 6 },
    /*
     * The air slash, parked at the end of the attack row: the client's own jump
     * attack (sm_body0048 133-136, = 134-137 here). A press of X off the ground
     * plays this instead of the three ground cuts.
     */
    airAttack: { row: 2, first: 23, frames: 4 },
    /* Skill body art: every skill plays the top of the skill row, except the
       up-slash, whose own raise-and-lift is baked right after those. The bake
       (assets/import_dnf_swordman.py CELLS.skill) has to keep the same order,
       and a test pins the clip to the end of the generic frames. The clip is
       the client's body frames 41-50: 41 is the settled pose a normal attack
       opens on, so the skill flows out of a press instead of a dead hold. */
    /*
     * Per-move body animations. Every skill used to draw the generic skill row,
     * which is why the Slayer never looked like he was performing the move; the
     * owner picked these off the body sheet beside each skill's own client clip
     * (assets/dnf_effect_picks.md), and assets/import_dnf_swordman.py CLIPS bakes
     * them into the clips row in this order.
     */
    skillClips: {
      /* 上挑 is the client's own 42-50 on the sm_body0048 sheet = 43-51 here. */
      upSlash: { row: 3, first: 6, frames: 9 },
      /*
       * The client's own 崩山击, straight off its preview clip: 187 (the blade
       * still down and forward) and 194/203 (both hands up, the blade over the
       * head, the client's own 举剑) are the lift, 204-205 is the coil at the top
        * of the hop, the smash's crescent (206-207) cuts through the descent and
        * the low lunge it lands in (208-209) holds through the recovery. Nine frames,
       * paced per beat: spreading them evenly put each pose on screen for a
       * fifth of a second, which is what read as stutter, and playing the
       * client's own hop frames (127-132) in front of all this gave the move two
       * wind-ups.
       */
      mountainBreaker: {
        row: 5,
        first: 0,
        frames: 9,
        beats: [
          /* the lift: the blade comes up as he leaves the ground, and it is over
             his head by the apex at 0.30 of the cast ... */
          { frames: 3, from: 0.0, until: 0.32 },
          /* ... the coil at the top of the hop ... */
          { frames: 2, from: 0.32, until: 0.45 },
          /*
           * ... the crescent. It is brief, the way the reference holds it - two
           * frames around the apex and the descent (#33 of 01 崩山击) - and the
           * hit lands a frame into it, at 0.75s of the 1.3s cast. Holding it
           * for a third of the move (what this used to do) left him swinging
           * mid-air for most of the cast, where the clip is already on the
           * ground with the spikes out.
           */
          { frames: 2, from: 0.45, until: 0.62 },
          /* ... and the lunge it lands in, held through the recovery. */
          { frames: 2, from: 0.62, until: 1.0 }
        ]
      },
      rageBurst: { row: 5, first: 9, frames: 8 },
      crossSlash: { row: 5, first: 17, frames: 20 },
      /* 血之狂暴: body action 22, the stand that flings both arms out. */
      frenzy: { row: 6, first: 0, frames: 9 },
      /*
       * 大蹦 opens on the 举剑 the owner asked for (body frames 123-124: both
       * hands over the head, the blade down in front of him) and drives it into
       * the floor under the ultimate's own giant blood sword and rift effect.
       *
       * The beats are the training-room reference's, measured frame by frame
       * (10_崩山裂地斩): he raises the sword and holds it for half a second
       * (#16-32 = 0.00-0.135 of the cast), leaps with the blade over his head and
       * his legs tucked (#33-50 = 0.135-0.285, apex at 0.867s), lands prone with
       * the sword driven in and stays there while the rift burns under him
       * (#51-88 = 0.285-0.60), then gets up as the second eruption rises
       * (#88-135 = 0.60-1.00).
       *
       * What it must not hold is a pose the move never reaches - the clip used to
       * end on 133, a leaning balance on one raised leg with the blade up in
       * front, which left him standing in his own fire doing it for over a second
       * (owner: 「放完技能多了一个不正确的动作，歪着身体举剑那个动作」). 208-209 are
       * the prone landing itself and the last beat is 132, the plain stand he is
       * left in.
       */
      mountainRift: {
        row: 6,
        first: 9,
        frames: 7,
        beats: [
          /* the raise, held long enough to read as 举剑 */
          { frames: 2, from: 0.0, until: 0.135 },
          /* the leap, blade overhead (the reference's #33-50) */
          { frames: 2, from: 0.135, until: 0.285 },
          /* the landing he holds under the rift, sword in the floor */
          { frames: 2, from: 0.285, until: 0.6 },
          /* and the stand he comes back to for the second eruption */
          { frames: 1, from: 0.6, until: 1.0 }
        ]
      },
      /*
       * 银光落刃: the dive Z becomes in the air. The frames are the air slash plus
       * the landing; the owner gave no range for this one, so the pick is mine
       * and is written down in assets/dnf_effect_picks.md.
       */
      /*
       * The dive sits after 大蹦's clip in the same row, so its first column
       * moves whenever that clip's length does (see assets/import_dnf_swordman.py
       * CLIPS, which prints the layout it bakes).
       */
      silverFall: { row: 6, first: 16, frames: 8 }
    },
    /*
     * The plain hop: the client's own jump animation (sm_body0048 126-131). It is
     * driven by how far the hop has fallen, so the crouch, the launch, the apex
     * and the landing walk in order however high the jump was.
     */
    jump: { row: 6, first: 24, frames: 6 },
    extras: { hurt: 0, dead: 1, jump: 2, fall: 3 }
  };

  /* On-screen controls for touch play, laid out in arena coordinates. */
  var TOUCH_LAYOUT = [
    { action: "left", x: 22, y: 418, w: 86, h: 86, label: "←" },
    { action: "right", x: 120, y: 418, w: 86, h: 86, label: "→" },
    { action: "jump", x: 776, y: 346, w: 76, h: 76, label: "跳" },
    { action: "attack", x: 864, y: 426, w: 88, h: 88, label: "攻" },
    { action: "mute", x: 878, y: 20, w: 62, h: 44, label: "音" },
    { action: "loadout", x: 806, y: 20, w: 62, h: 44, label: "编" },
    /*
     * Pause sits next to mute and the loadout toggle: a touch surface has no P
     * key, so without its own button the pause screen - and the live readout on
     * it - is unreachable for anyone playing with fingers.
     */
    { action: "pause", x: 734, y: 20, w: 62, h: 44, label: "停" }
  ];

  /* Hotbar: DNF's two rows of six (A S D F G H / Q W E R T Y). */
  var SLOT_COUNT = 12;
  var SLOT_COLS = 6;
  var BAR = { x: 16, y: ARENA.height - 96, slotW: 104, slotH: 40, gap: 6, rowGap: 6 };
  var TOUCH_BAR = { x: 250, y: ARENA.height - 118, slotW: 56, slotH: 56, gap: 2, rowGap: 2 };

  function slotButtons(layout) {
    var buttons = [];
    for (var index = 0; index < SLOT_COUNT; index += 1) {
      var column = index % SLOT_COLS;
      /*
       * The bar is laid out like the keyboard above it: the Q row (slots 6-11)
       * sits on top and the A row (slots 0-5) underneath. The slot index still
       * decides the key, so only the drawing flips - and hit testing uses this
       * same table, so drag and drop follows the picture.
       */
      var row = index < SLOT_COLS ? 1 : 0;
      buttons.push({
        action: "slot" + index,
        index: index,
        x: layout.x + column * (layout.slotW + layout.gap),
        y: layout.y + row * (layout.slotH + layout.rowGap),
        w: layout.slotW,
        h: layout.slotH
      });
    }
    return buttons;
  }

  function skillBarButtons() {
    return slotButtons(BAR);
  }

  function touchBarButtons() {
    return slotButtons(TOUCH_BAR);
  }

  /* Loadout panel: every skill as a draggable tile, shown while arranging. */
  var PANEL = { x: 16, y: ARENA.height - 330, w: 696, h: 160, tileW: 104, tileH: 56, gap: 8 };

  function loadoutPanelButtons() {
    var buttons = [];
    var cols = 6;
    for (var index = 0; index < Core.SKILL_ORDER.length; index += 1) {
      buttons.push({
        action: "tile" + index,
        index: index,
        skillId: Core.SKILL_ORDER[index],
        x: PANEL.x + 12 + (index % cols) * (PANEL.tileW + PANEL.gap),
        y: PANEL.y + 34 + Math.floor(index / cols) * (PANEL.tileH + PANEL.gap),
        w: PANEL.tileW,
        h: PANEL.tileH
      });
    }
    return buttons;
  }

  function hitTestLoadout(x, y, open, compact) {
    if (open) {
      var tiles = loadoutPanelButtons();
      for (var tile = 0; tile < tiles.length; tile += 1) {
        var entry = tiles[tile];
        if (x >= entry.x && x <= entry.x + entry.w && y >= entry.y && y <= entry.y + entry.h) {
          return { kind: "tile", index: entry.index, skillId: entry.skillId };
        }
      }
    }
    var slots = compact ? touchBarButtons() : skillBarButtons();
    for (var index = 0; index < slots.length; index += 1) {
      var slot = slots[index];
      if (x >= slot.x && x <= slot.x + slot.w && y >= slot.y && y <= slot.y + slot.h) {
        return { kind: "slot", index: slot.index };
      }
    }
    return null;
  }

  /*
   * assets/effects.png: one row per skill (SKILL_ORDER) of EFFECT.cell square
   * frames. A row is as long as the move's own effect: the picks the owner made
   * ship their whole sequence (崩山击 six frames, 十字斩 eleven), the rest keep
   * the four-frame sample, and the sheet is as wide as its longest row.
   */
  var EFFECT = {
    cell: 128,
    rowFrames: {
      upSlash: 9,
      mountainBreaker: 6,
      crossSlash: 11,
      bloodSword: 27,
      frenzy: 20,
      bloodyRave: 17,
      rageBurst: 13,
      bloodSnatch: 19,
      graspHead: 18,
      bloodEvil: 15,
      /*
       * 大蹦 bakes a staged row: the pack is one move in several acts (the floor
       * splits, the crack field glows under the held ring, the first wave comes
       * up, the second eruption rises and dies back), and stacking every layer at
       * once put all of it on screen in the same fraction of a second. The row is
       * as long as the windows in assets/import_dnf_effects.py add up to - and at
       * 45 columns over a 4s cast it is a column every 89ms.
       */
      mountainRift: 45
    },
    maxFrames: 45,
    /*
     * assets/effects.png carries one row per skill and then, past them, the art
     * a move needs away from its own cast: 血之狂暴's blood orb lives on the row
     * after the last skill, because the orbs that fly into the Slayer must not
     * carry the dual-blade slash the pack draws around them.
     */
    orbRow: Core.SKILL_ORDER.length,
    orbFrames: 6,
    /* 银光落刃's arc, on the extra row after the orbs. */
    diveRow: Core.SKILL_ORDER.length + 1,
    diveFrames: 9,
    /*
     * The row after that is 大蹦's fire. DNF orders an effect's layers around
     * the character - the dim copy of a shape goes behind him, the bright copy
     * in front - and this pack ships both halves: the rift, the blade and the
     * ground stay on the skill's own row behind the Slayer, the flames, the
     * flash and the debris are drawn over him from this row. Both were baked to
     * one window off one anchor, so the fire still comes out of the rift.
     */
    frontRows: { mountainRift: Core.SKILL_ORDER.length + 2 },
    frontFrames: { mountainRift: 45 },
    draw: {
      upSlash: { dx: 34, dy: -56, size: 156, copies: 1, spin: 0 },
      /*
       * 崩山击 lands on a shockwave that covers half the arena. The row is baked
       * with an anchor now (the foot of the fire column, which is also where the
       * spikes were moved to), so dy is a quarter of the size like 大蹦's rows:
       * that puts the impact on his feet instead of a fixed few pixels under
       * them, which is what the un-anchored row used to need. `ground` keeps it
       * there while he is still in the air (see drawEffectRow): the fire comes
       * out of the floor he is falling toward, not out of his boots.
       */
      mountainBreaker: { dx: 0, dy: -59, size: 236, copies: 1, spin: 0, ground: true },
      /* 十字斩's own art draws the cross (a horizontal stroke, then the
         vertical one landing on it), so it is no longer mirrored into one.
         DNF draws the cross and then pushes it forward, so it also travels. */
      crossSlash: { dx: 46, dy: -38, size: 168, copies: 1, spin: 0, travel: 108 },
      bloodSword: { dx: 30, dy: -32, size: 182, copies: 1, spin: 0 },
      frenzy: { dx: 52, dy: -40, size: 150, copies: 1, spin: 0 },
      bloodyRave: { dx: 52, dy: -46, size: 170, copies: 1, spin: 0 },
      /*
       * 怒气爆发 erupts around him: it is the widest effect in the kit, and its
       * row is baked with the caster's ground point on the cell's ground line
       * (75% down), so the ring has to meet his feet rather than his knees.
       */
      rageBurst: { dx: 0, dy: -75, size: 300, copies: 1, spin: 0 },
      bloodSnatch: { dx: 56, dy: -46, size: 190, copies: 1, spin: 0 },
      graspHead: { dx: 30, dy: -36, size: 128, copies: 1, spin: 0 },
      bloodEvil: { dx: 44, dy: -30, size: 178, copies: 1, spin: 0 },
      /*
       * 大蹦 is the ultimate, and its rift is the training-room reference's: the
       * cracked ground there is 720x285 ref px = 265x107 here, with its middle
       * 95px *in front* of the caster - it is a gash running forward, not a ring
       * round him. So the row is drawn forward (dx) and the bake no longer blows
       * the floor up 1.8x (which had put a 745px shatter on screen where the
       * reference shows 265).
       *
       * The rows are baked with the caster's ground point on the cell's ground
       * line, so dy is a quarter of the size: that puts the rift under his feet
       * rather than at his knees the way a centred row would. `size` is the row's
       * zoom - one client pixel of the pack lands on 0.596 of a screen pixel,
       * which is what draws the pack's 444px floor at the reference's 265 - and
       * `ground` pins it to the floor line while he is still leaping (the gash
       * opens on the ground he is coming down to, not on his boots).
       */
      mountainRift: { dx: 95, dy: -73, size: 290, copies: 1, spin: 0, ground: true }
    },
    /*
     * The half of a move's art that is drawn over the Slayer can be baked to its
     * own zoom, because a window is a zoom: 大蹦's ground row is 456px of client
     * art wide and 435 tall (the floor plus the two rear spires), and holding the
     * fire to that same zoom would draw a 223px flame out of 20 cell pixels. So
     * the fire row gets its own window, and this row says what to draw it at.
     *
     * The two halves still land on top of each other, and here is why: both rows
     * are baked with the caster's own ground point on the same spot of their cell
     * (64, 96 of 128), and both are drawn with that spot on his feet. A cell is
     * drawn so that cell (64, 96) lands at the caster + (dx, dy + 0.25 * size),
     * so the front row's dy is the skill's dy plus the quarter-of-the-size
     * difference: -73 + 0.25 * (290 - 469) = -117. `size` is what keeps one
     * client pixel the same size on screen in both rows: the row's `size` over
     * the span the cell had to fit is the same number for both of them
     * (290 / 456 == 469 / 738 == 0.636), and that ratio is all a client pixel
     * is worth on screen (0.596 of a screen pixel here).
     */
    frontDraw: {
      mountainRift: { dx: 95, dy: -117, size: 469 }
    },
    /*
     * When a row is drawn, for the moves whose own art says it: 崩山裂地斩 is a
     * leap, and the move is 先举剑 - the owner points at the client's own body
     * frames 123-124 for it - so the row starts on the first frame of the cast
     * and the blood sword it summons is on screen while he raises it, through
     * the leap (the blade's own gathering frames) and into the strike that lands
     * on the hit. It runs to the end of the cast, so the second eruption and the
     * rift still glowing under the Slayer are drawn while he stands in them.
     */
    timing: {
      mountainRift: { from: 0, to: 0.99 },
      /*
       * 崩山击's landing art opens as he comes down, not on the press. The
       * reference erupts the fire column while he is still in the air (#34 of
       * 01 崩山击, well before touchdown at #41) and the spikes spread as he
       * lands; the default window (a fraction of activeFrom) opened it while
       * the hop was still climbing, and 0.58 opened it on the hit alone. 0.45
       * is a tenth of a second before touchdown at 0.75s of the 1.3s cast, so
       * the column is up when he arrives and the row runs out over the
       * recovery, the way the clip's spikes do.
       */
      mountainBreaker: { from: 0.45, to: 0.95 }
    },
    /*
     * How a row dies down, per skill. The default (0.75 -> 1, down to 0.3 of
     * full strength) is right for a move whose last act is its quietest; 大蹦
     * ends on its second eruption, which is its tallest, so its row holds full
     * strength until the fire is actually going out (the reference's last three
     * frames) and only then drops.
     */
    fade: {
      mountainRift: { from: 0.92, to: 1, floor: 0.45 }
    }
  };

  /* Short DNF-style effect tags shown in the loadout panel. */
  var EFFECT_LABEL = {
    upSlash: "浮空",
    mountainBreaker: "跳劈 · 倒地",
    crossSlash: "十字 · 出血",
    bloodSword: "血气 · 三连",
    frenzy: "双刀 · 攻速",
    bloodyRave: "血气爆发",
    rageBurst: "范围爆发",
    bloodSnatch: "嗜血 · 血波",
    graspHead: "抓取 · 吸血",
    bloodEvil: "血魔 · 突进",
    mountainRift: "跃斩 · 裂地"
  };

  /**
   * Which effect frame belongs to a skill at a given cast progress (0..1).
   *
   * `row` and `frames` override where the art is read from, for the moves that
   * ship a second row; left out, the skill's own row and its own length are used.
   */
  function skillEffectFrame(skillId, progress, row, frames) {
    var spec = Core.SKILLS[skillId];
    var draw = EFFECT.draw[skillId];
    if (!spec || !draw) return null;
    if (row === undefined || row === null) row = Core.SKILL_ORDER.indexOf(skillId);
    if (row === -1) return null;
    var from = (spec.activeFrom / spec.duration) * 0.8;
    var to = Math.min(0.98, (spec.activeTo + 0.12) / spec.duration);
    /* A move can pin its own window: 大蹦's art starts on the landing. */
    var timing = EFFECT.timing && EFFECT.timing[skillId];
    if (timing) {
      from = timing.from;
      to = timing.to;
    }
    if (progress < from || progress > to) return null;
    var local = Math.min(1, (progress - from) / Math.max(0.0001, to - from));
    if (frames === undefined || frames === null) frames = EFFECT.rowFrames[skillId] || 4;
    /*
     * A row's tail fades out, because those rows are a move dying down. A move
     * whose own last act is its biggest one says so instead: 大蹦's second
     * eruption is at 0.70-0.92 of a 4s cast, so the default fade (from 0.75)
     * would draw the tallest fire it has at a third strength. `floor` is what
     * the alpha has fallen to at the end of the window.
     */
    var fade = (EFFECT.fade && EFFECT.fade[skillId]) || { from: 0.75, to: 1, floor: 0.3 };
    return {
      row: row,
      col: Math.min(frames - 1, Math.floor(local * frames)),
      alpha:
        1 -
        Math.min(1, Math.max(0, (local - fade.from) / Math.max(0.0001, fade.to - fade.from))) *
          (1 - fade.floor)
    };
  }

  function touchButtons() {
    return TOUCH_LAYOUT.map(function (entry) {
      return {
        action: entry.action,
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
        label: entry.label
      };
    });
  }

  function hitTestTouch(x, y) {
    for (var i = 0; i < TOUCH_LAYOUT.length; i += 1) {
      var entry = TOUCH_LAYOUT[i];
      if (x >= entry.x && x <= entry.x + entry.w && y >= entry.y && y <= entry.y + entry.h) {
        return entry.action;
      }
    }
    return null;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function panel(ctx, x, y, w, h, radius) {
    ctx.save();
    ctx.fillStyle = "rgba(9, 12, 22, 0.82)";
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 191, 114, 0.55)";
    ctx.lineWidth = 1.4;
    roundRect(ctx, x + 0.7, y + 0.7, w - 1.4, h - 1.4, radius);
    ctx.stroke();
    ctx.strokeStyle = "rgba(120, 160, 220, 0.22)";
    ctx.lineWidth = 1;
    roundRect(ctx, x + 3.5, y + 3.5, w - 7, h - 7, Math.max(2, radius - 2));
    ctx.stroke();
    ctx.restore();
  }

  function bar(ctx, x, y, w, h, ratio, topColor, bottomColor, backColor) {
    ctx.fillStyle = backColor;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    var filled = Math.max(0, Math.min(1, ratio)) * (w - 2);
    if (filled > 1) {
      var gradient = ctx.createLinearGradient(x, y, x, y + h);
      gradient.addColorStop(0, topColor);
      gradient.addColorStop(1, bottomColor);
      ctx.fillStyle = gradient;
      roundRect(ctx, x + 1, y + 1, filled, h - 2, (h - 2) / 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
    ctx.stroke();
  }

  function drawBackdrop(ctx, state) {
    var sky = ctx.createLinearGradient(0, 0, 0, ARENA.groundY);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(0.55, PALETTE.skyMid);
    sky.addColorStop(1, PALETTE.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ARENA.width, ARENA.groundY);

    /* far arches, slowly drifting */
    var drift = -((state.time * 6) % 240);
    ctx.fillStyle = PALETTE.wallFar;
    ctx.fillRect(0, 40, ARENA.width, ARENA.groundY - 40);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#0b1120";
    for (var i = -1; i < 6; i += 1) {
      var ax = drift + i * 240;
      ctx.beginPath();
      ctx.moveTo(ax + 30, ARENA.groundY);
      ctx.lineTo(ax + 30, 150);
      ctx.quadraticCurveTo(ax + 90, 90, ax + 150, 150);
      ctx.lineTo(ax + 150, ARENA.groundY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* near wall bricks */
    ctx.strokeStyle = "rgba(120, 150, 210, 0.07)";
    ctx.lineWidth = 1;
    for (var row = 0; row < 9; row += 1) {
      var y = 120 + row * 38;
      if (y > ARENA.groundY) break;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ARENA.width, y);
      ctx.stroke();
      for (var col = -1; col < 16; col += 1) {
        var bx = col * 64 + (row % 2 ? 32 : 0);
        ctx.beginPath();
        ctx.moveTo(bx, y);
        ctx.lineTo(bx, y + 38);
        ctx.stroke();
      }
    }

    /* torches */
    [180, 480, 780].forEach(function (tx, index) {
      var flicker = 0.72 + 0.28 * Math.sin(state.time * 9 + index * 2.1);
      var glow = ctx.createRadialGradient(tx, 250, 4, tx, 250, 130 * flicker);
      glow.addColorStop(0, "rgba(255, 176, 92, 0.34)");
      glow.addColorStop(1, "rgba(255, 150, 60, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tx, 250, 130 * flicker, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a2b1f";
      ctx.fillRect(tx - 3, 250, 6, 34);
      ctx.fillStyle = "#ffcf7a";
      ctx.beginPath();
      ctx.ellipse(tx, 246, 6 * flicker, 11 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    /* floor */
    var floor = ctx.createLinearGradient(0, ARENA.groundY, 0, ARENA.height);
    floor.addColorStop(0, PALETTE.floorTop);
    floor.addColorStop(1, PALETTE.floorBottom);
    ctx.fillStyle = floor;
    ctx.fillRect(0, ARENA.groundY, ARENA.width, ARENA.height - ARENA.groundY);
    ctx.strokeStyle = PALETTE.floorLine;
    ctx.lineWidth = 1;
    for (var line = 0; line < 5; line += 1) {
      var ly = ARENA.groundY + 8 + line * 14;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(ARENA.width, ly);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 214, 170, 0.16)";
    ctx.fillRect(0, ARENA.groundY, ARENA.width, 2);
  }

  function drawVignette(ctx, state) {
    var glow = ctx.createRadialGradient(
      ARENA.width / 2,
      ARENA.height * 0.45,
      120,
      ARENA.width / 2,
      ARENA.height * 0.5,
      620
    );
    glow.addColorStop(0, "rgba(0,0,0,0)");
    glow.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  }

  /** Cracked slabs are always visible, so a trap is never a surprise. */
  function drawHazards(ctx, state) {
    (state.hazards || []).forEach(function (hazard) {
      var stage = hazard.stage || "dormant";
      ctx.save();
      ctx.translate(hazard.x, ARENA.groundY);
      ctx.strokeStyle =
        stage === "dormant" ? "rgba(120, 150, 190, 0.34)" : "rgba(255, 152, 110, 0.9)";
      ctx.lineWidth = stage === "collapsing" ? 3.5 : 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, hazard.radius, hazard.radius * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-hazard.radius * 0.62, -2);
      ctx.lineTo(-hazard.radius * 0.12, -9);
      ctx.lineTo(hazard.radius * 0.24, -3);
      ctx.lineTo(hazard.radius * 0.68, -10);
      ctx.stroke();
      if (stage !== "dormant") {
        ctx.fillStyle = "rgba(24, 14, 12, 0.5)";
        ctx.beginPath();
        ctx.ellipse(0, 0, hazard.radius * 0.88, hazard.radius * 0.19, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawGate(ctx, state) {
    var x = ARENA.rightWall + 6;
    var open = state.room && state.room.cleared;
    ctx.save();
    ctx.translate(x, ARENA.groundY - 60);
    ctx.fillStyle = "#0d1220";
    ctx.beginPath();
    ctx.moveTo(-26, 60);
    ctx.lineTo(-26, -22);
    ctx.quadraticCurveTo(0, -64, 26, -22);
    ctx.lineTo(26, 60);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = open ? "rgba(255, 214, 140, 0.9)" : "rgba(120, 150, 200, 0.45)";
    ctx.lineWidth = 2.4;
    ctx.stroke();
    if (open) {
      var swirl = ctx.createRadialGradient(0, 0, 2, 0, 0, 42);
      swirl.addColorStop(0, "rgba(255, 226, 168, 0.65)");
      swirl.addColorStop(1, "rgba(255, 190, 110, 0)");
      ctx.fillStyle = swirl;
      ctx.beginPath();
      ctx.arc(0, -4, 38 + Math.sin(state.time * 6) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* Which column of the attack row a swing shows. One press plays one stage of
     the client's normal attack, and the swing progress walks that stage's
     frames; the stages tile the clip, so mashing X plays all of it in order. */
  function attackColumn(swing, stageIndex) {
    var stages = Core.ATTACK_STAGES;
    var index = Math.trunc(Number(stageIndex)) || 0;
    var stage = stages[((index % stages.length) + stages.length) % stages.length];
    var offset = Math.min(stage.frames - 1, Math.floor(clamp01(swing) * stage.frames));
    return stage.first + offset;
  }

  function playerFrame(state, player) {
    var rows = SPRITE.rows;
    if (player.dead) return { row: rows.extras, col: SPRITE.extras.dead };
    if (player.hurtTimer > 0) return { row: rows.extras, col: SPRITE.extras.hurt };
    /*
     * A clip owns its whole cast, air time included. 崩山击 and 大蹦 are leaping
     * moves: they leave the ground part way through, and the airborne branch used
     * to take the sprite away from the skill's own action and draw the generic
     * jump/fall art instead - the owner saw that as an extra attack in the air.
     * Only a move without a clip falls back to the jump/fall frames.
     */
    var clip = player.skillTimer > 0 ? SPRITE.skillClips[player.skillId] : null;
    /*
     * X off the ground is the client's jump attack, not the ground chain: a press
     * that starts in the air plays the air slash from the attack row's tail.
     */
    if (!player.onGround && player.attackTimer > 0 && !(clip && clip.row !== undefined)) {
      var air = SPRITE.airAttack;
      var airProgress = clamp01(
        (player.attackDuration - player.attackTimer) / Math.max(0.0001, player.attackDuration)
      );
      return {
        row: air.row,
        col: air.first + Math.min(air.frames - 1, Math.floor(airProgress * air.frames))
      };
    }
    if (!player.onGround && !(clip && clip.row !== undefined)) {
      /*
       * A hop with nothing else going on plays the client's jump animation: its
       * frames are walked by how far the fall has come, so the crouch, the launch,
       * the apex and the landing come in order whatever the jump's height. Only a
       * move with no clip of its own (a mid-air cast) keeps the generic air pose.
       */
      if (player.skillTimer <= 0) {
        var jump = SPRITE.jump;
        var from = Core.PHYSICS.jumpVelocity;
        var to = Core.PHYSICS.maxFallSpeed;
        var fall = clamp01((player.vy - from) / Math.max(1, to - from));
        return {
          row: jump.row,
          col: jump.first + Math.min(jump.frames - 1, Math.floor(fall * jump.frames))
        };
      }
      return { row: rows.extras, col: player.vy < 0 ? SPRITE.extras.jump : SPRITE.extras.fall };
    }
    if (player.skillTimer > 0) {
      var skill = Core.SKILLS[player.skillId];
      var progress = skill ? 1 - player.skillTimer / skill.duration : 0;
      if (clip && clip.row !== undefined) {
        /*
         * A clip can pace its frames in beats: 崩山击's four raise frames run
         * through the wind-up, its three smash frames land with the hit and then
         * hold. Spreading them evenly put each pose on screen for a quarter of a
         * second, which is what read as stutter.
         */
        var step = clip.frames - 1;
        if (clip.beats) {
          var consumed = 0;
          for (var beatIndex = 0; beatIndex < clip.beats.length; beatIndex += 1) {
            var beat = clip.beats[beatIndex];
            var local = clamp01(
              (progress - beat.from) / Math.max(0.0001, beat.until - beat.from)
            );
            step = consumed + Math.min(beat.frames - 1, Math.floor(local * beat.frames));
            consumed += beat.frames;
            if (progress <= beat.until) break;
          }
        } else {
          step = Math.min(clip.frames - 1, Math.floor(clamp01(progress) * clip.frames));
        }
        return {
          row: clip.row,
          col: clip.first + step
        };
      }
      var skillFrames = SPRITE.frames.skill;
      return {
        row: rows.skill,
        col:
          Math.min(skillFrames - 1, Math.floor(clamp01(progress) * skillFrames))
      };
    }
    if (player.attackCooldown > 0 && player.comboTimer > 0) {
      /*
       * One press, one cut of the client's chain: the cut plays its frames
       * across the swing and then holds its last - follow-through - frame
       * through the recovery the player can move in. Stretching them over the
       * whole press cycle instead put the white arc frame 0.17s after the
       * press, long after the hit had landed; stopping at the swing and
       * dropping to the idle pose is what made the chain look chopped up.
       */
      var swing = player.attackDuration || Core.PLAYER.attackDuration;
      var progress = clamp01((swing - Math.max(0, player.attackTimer)) / swing);
      return { row: rows.attack, col: attackColumn(progress, player.comboIndex) };
    }
    if (Math.abs(player.vx) > 8) {
      return { row: rows.run, col: Math.floor(state.time * 14) % SPRITE.frames.run };
    }
    /* Four frames, so keep the breath under two cycles a second. */
    return { row: rows.idle, col: Math.floor(state.time * 5) % SPRITE.frames.idle };
  }

  function drawSpriteFrame(ctx, image, col, row, x, y, flip, scale) {
    var fw = SPRITE.frameW;
    var fh = SPRITE.frameH;
    var size = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      col * fw,
      row * fh,
      fw,
      fh,
      -SPRITE.anchorX * size,
      -SPRITE.anchorY * size,
      fw * size,
      fh * size
    );
    ctx.restore();
  }

  function drawFallbackPlayer(ctx, state, player) {
    var bodyW = player.width;
    var bodyH = player.height;
    ctx.save();
    ctx.translate(player.x, player.y);
    if (player.facing < 0) ctx.scale(-1, 1);
    var fallbackSwing = player.attackDuration || Core.PLAYER.attackDuration;
    var swing = player.attackTimer > 0 ? 1 - player.attackTimer / fallbackSwing : 0;

    ctx.fillStyle = "#6a1020";
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.4, -bodyH * 0.9);
    ctx.lineTo(bodyW * 0.2, -bodyH * 0.86);
    ctx.lineTo(-bodyW * 0.75, -bodyH * 0.2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1c2338";
    ctx.fillRect(-bodyW * 0.36, -bodyH * 0.78, bodyW * 0.72, bodyH * 0.5);
    ctx.fillStyle = "#2c3654";
    ctx.fillRect(-bodyW * 0.36, -bodyH * 0.78, bodyW * 0.3, bodyH * 0.5);
    ctx.fillStyle = "#bc2a3e";
    ctx.fillRect(-bodyW * 0.36, -bodyH * 0.72, bodyW * 0.72, 3);
    ctx.fillStyle = "#d8b25a";
    ctx.fillRect(-bodyW * 0.36, -bodyH * 0.34, bodyW * 0.72, 3);

    ctx.fillStyle = "#121620";
    ctx.fillRect(-bodyW * 0.28, -bodyH * 0.32, bodyW * 0.22, bodyH * 0.32);
    ctx.fillRect(bodyW * 0.06, -bodyH * 0.32, bodyW * 0.22, bodyH * 0.32);

    ctx.fillStyle = "#ecbe98";
    ctx.beginPath();
    ctx.arc(0, -bodyH * 0.86, bodyW * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#141822";
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.3, -bodyH * 0.86);
    ctx.lineTo(-bodyW * 0.34, -bodyH * 1.04);
    ctx.lineTo(bodyW * 0.3, -bodyH * 0.98);
    ctx.lineTo(bodyW * 0.2, -bodyH * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#5ce0ff";
    ctx.fillRect(bodyW * 0.06, -bodyH * 0.88, 4, 3);

    ctx.strokeStyle = "#ced8e8";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -bodyH * 0.62);
    ctx.lineTo(bodyW * 0.9, -bodyH * (0.9 - swing * 0.5));
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(ctx, state, sprites) {
    var player = state.player;
    /*
     * Invulnerability blinks, except where the move says otherwise: a leap marks
     * its window solid (see SKILLS.leapInvuln), because the client's own preview
     * of 崩山击 holds the pose still through the hop and the flicker chopped the
     * whole move up. `hurtTimer` still wins outright - a hit always flashes.
     */
    var blinking = player.invuln > 0 && !(player.solidInvuln > 0) && player.hurtTimer <= 0;
    if (blinking && Math.floor(state.time * 20) % 2 === 0) return;

    var shadowW = player.width * 0.75;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath();
    ctx.ellipse(player.x, ARENA.groundY + 3, shadowW, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    var raging = !!(player.buffs && player.buffs.bloodRage > 0);
    if (raging) drawRage(ctx, state, player);

    var image = sprites && sprites.slayer;
    if (!image || !image.width) {
      drawFallbackPlayer(ctx, state, player);
      if (raging) drawStanceBadge(ctx, state, sprites);
      return;
    }
    var frame = playerFrame(state, player);
    ctx.save();
    if (player.hurtTimer > 0 && "filter" in ctx) ctx.filter = "brightness(1.7) saturate(0.6)";
    /*
     * 血之狂暴 turns him red all over. The tint is baked off-screen: source-atop
     * composites against whatever already sits on the target canvas, so filling
     * the live frame would wash the arena red instead of the character.
     */
    var body = raging && ragingSheet(image) ? ragingSheet(image) : image;
    /* A hurt flash outranks the stance's own lift. */
    if (raging && player.hurtTimer <= 0 && "filter" in ctx) ctx.filter = "saturate(1.2)";
    drawSpriteFrame(ctx, body, frame.col, frame.row, player.x, player.y, player.facing < 0);
    ctx.restore();
    if (raging) drawStanceBadge(ctx, state, sprites);
  }

  /*
   * The red sheet, built once per sprite image. A run keeps the same Image for
   * its whole life, so the cache never grows past one entry.
   */
  var rageTint = null;
  function ragingSheet(image) {
    if (typeof document === "undefined" || !document.createElement) return null;
    if (rageTint && rageTint.source === image) return rageTint.sheet;
    var canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    var brush = canvas.getContext("2d");
    if (!brush) return null;
    brush.drawImage(image, 0, 0);
    brush.globalCompositeOperation = "source-atop";
    brush.fillStyle = "rgba(214, 28, 44, 0.58)";
    brush.fillRect(0, 0, canvas.width, canvas.height);
    rageTint = { source: image, sheet: canvas };
    return canvas;
  }

  /** The blood aura that reads as "the stance is up" even at a glance. */
  function drawRage(ctx, state, player) {
    var pulse = 0.86 + 0.14 * Math.sin(state.time * 9);
    var cx = player.x;
    var cy = player.y - player.height * 0.5;
    var radius = player.height * 0.95 * pulse;
    ctx.save();
    var glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
    glow.addColorStop(0, "rgba(255, 60, 78, 0.5)");
    glow.addColorStop(0.6, "rgba(196, 18, 40, 0.25)");
    glow.addColorStop(1, "rgba(150, 10, 28, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    /* Drops that run off him, so the state is not just a colour change. */
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(state.time * 7);
    ctx.fillStyle = "rgba(226, 32, 48, 0.9)";
    for (var drop = 0; drop < 3; drop += 1) {
      var t = (state.time * 0.9 + drop / 3) % 1;
      var dx = Math.sin((state.time + drop) * 4) * 10;
      ctx.beginPath();
      ctx.arc(cx + dx, player.y - player.height * (1 - t) - 6, 2.6 - 1.4 * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The buff icon over his head: atlas frame 135, the stance's own art. */
  function drawStanceBadge(ctx, state, sprites) {
    if (!sprites || !sprites.skills || !sprites.skills.width) return;
    var slot = Core.SKILL_ORDER.indexOf("frenzy");
    if (slot === -1) return;
    var player = state.player;
    var size = 22;
    var x = player.x - size / 2;
    var y = player.y - player.height - 42;
    ctx.save();
    roundRect(ctx, x - 3, y - 3, size + 6, size + 6, 6);
    ctx.fillStyle = "rgba(10, 12, 22, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 60, 78, 0.9)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.drawImage(sprites.skills, slot * 32, 32, 32, 32, x, y, size, size);
    ctx.restore();
  }

  var ENEMY_STYLE = {
    grunt: { body: "#8ad36c", dark: "#3f7a3a", accent: "#d9f2b0", eye: "#ffe066" },
    brute: { body: "#e0a44d", dark: "#8a5a1f", accent: "#ffe0a8", eye: "#ff8a4d" },
    caster: { body: "#79a6ff", dark: "#33518f", accent: "#cfe2ff", eye: "#9ef0ff" },
    charger: { body: "#b07cff", dark: "#5a2f96", accent: "#e8d6ff", eye: "#ffd166" },
    elite: { body: "#cdd6e6", dark: "#465071", accent: "#ffd166", eye: "#7ff0ff" },
    boss: { body: "#e0556d", dark: "#7d1f31", accent: "#ffd0d6", eye: "#ffe066" },
    bossPhase2: { body: "#ff4d6d", dark: "#8c0f26", accent: "#ffe9a8", eye: "#ff3b3b" }
  };

  function drawEnemy(ctx, state, enemy) {
    var enraged = enemy.type === "boss" && enemy.phase >= 2;
    var style = enraged
      ? ENEMY_STYLE.bossPhase2
      : ENEMY_STYLE[enemy.type] || ENEMY_STYLE.grunt;
    var w = enemy.width;
    var h = enemy.height;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(enemy.x, enemy.y + 3, w * 0.62, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    /* Second-phase tell: a pulsing blood ring so the enrage reads at a glance. */
    if (enraged) {
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.18 * Math.sin(state.time * 6.5);
      ctx.strokeStyle = "rgba(255, 82, 108, 0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y - h * 0.5, w * 0.95, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.translate(enemy.x, enemy.y);
    if (enemy.facing > 0) ctx.scale(-1, 1);

    if (enemy.hurtTimer > 0 && "filter" in ctx) ctx.filter = "brightness(1.9)";

    ctx.fillStyle = style.dark;
    roundRect(ctx, -w / 2, -h * 0.72, w, h * 0.72, w * 0.28);
    ctx.fill();
    ctx.fillStyle = style.body;
    roundRect(ctx, -w / 2 + 2, -h * 0.72 + 2, w - 4, h * 0.58, w * 0.26);
    ctx.fill();
    ctx.fillStyle = style.accent;
    ctx.fillRect(-w / 2 + 3, -h * 0.34, w - 6, 3);

    ctx.fillStyle = style.dark;
    ctx.fillRect(-w / 2 - 2, -h * 0.2, 8, h * 0.2);
    ctx.fillRect(w / 2 - 6, -h * 0.2, 8, h * 0.2);

    ctx.fillStyle = style.body;
    ctx.beginPath();
    ctx.arc(0, -h * 0.78, w * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.eye;
    ctx.beginPath();
    ctx.arc(-w * 0.12, -h * 0.8, 2.6, 0, Math.PI * 2);
    ctx.arc(w * 0.12, -h * 0.8, 2.6, 0, Math.PI * 2);
    ctx.fill();

    if (enemy.type === "brute" || enemy.type === "boss") {
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.moveTo(-w * 0.26, -h * 0.95);
      ctx.lineTo(-w * 0.4, -h * 1.16);
      ctx.lineTo(-w * 0.06, -h * 1.0);
      ctx.closePath();
      ctx.moveTo(w * 0.26, -h * 0.95);
      ctx.lineTo(w * 0.4, -h * 1.16);
      ctx.lineTo(w * 0.06, -h * 1.0);
      ctx.closePath();
      ctx.fill();
    }
    if (enemy.type === "caster") {
      ctx.strokeStyle = style.eye;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w * 0.42, -h * 0.6, 6 + Math.sin(state.time * 6) * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (enemy.type === "charger") {
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.moveTo(w * 0.3, -h * 0.62);
      ctx.lineTo(w * 0.62, -h * 0.5);
      ctx.lineTo(w * 0.3, -h * 0.4);
      ctx.closePath();
      ctx.fill();
    }
    if (enemy.type === "elite") {
      /* Pauldrons, a crest and a lit visor: rank above the rank and file. */
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.moveTo(-w * 0.3, -h * 0.98);
      ctx.lineTo(-w * 0.46, -h * 1.2);
      ctx.lineTo(-w * 0.08, -h * 1.02);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = style.dark;
      ctx.fillRect(-w * 0.64, -h * 0.7, 10, h * 0.24);
      ctx.fillRect(w * 0.64 - 10, -h * 0.7, 10, h * 0.24);
      ctx.fillStyle = style.eye;
      ctx.fillRect(-w * 0.2, -h * 0.82, w * 0.4, 3);
    }
    ctx.restore();

    /* The whirl itself: two rotating blades so the sweep reads as a spin. */
    if (enemy.attackKind === "spin" && enemy.spinDash && enemy.attackTimer > 0) {
      var spinArc = state.time * 22;
      var spinRadius = enemy.spinDash.radius * 0.7;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(255, 226, 160, 0.92)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y - h * 0.45, spinRadius, spinArc, spinArc + Math.PI * 1.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(
        enemy.x,
        enemy.y - h * 0.45,
        spinRadius,
        spinArc + Math.PI,
        spinArc + Math.PI * 2.2
      );
      ctx.stroke();
      ctx.restore();
    }

    if (enemy.attackTimer > 0) {
      var windup = 1 - Math.max(0, enemy.attackTimer / enemy.attackDuration);
      var radius =
        enemy.attackKind === "slam" && enemy.slam
          ? enemy.slam.radius
          : enemy.attackKind === "spin" && enemy.spinDash
            ? enemy.spinDash.radius
            : enemy.attackRange;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * windup;
      ctx.strokeStyle = "rgba(255, 120, 120, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y - h * 0.55, radius * (0.35 + windup * 0.65), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (enemy.hp < enemy.maxHp) {
      var barW = w + 12;
      var ratio = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      roundRect(ctx, enemy.x - barW / 2, enemy.y - h - 18, barW, 6, 3);
      ctx.fill();
      ctx.fillStyle = enemy.type === "boss" ? PALETTE.danger : "#ff9d5c";
      roundRect(ctx, enemy.x - barW / 2 + 1, enemy.y - h - 17, (barW - 2) * ratio, 4, 2);
      ctx.fill();
      ctx.restore();
    }

    /* DNF-style status tells: bleeding ticks, grounded knockdowns, stunned targets. */
    if (enemy.bleed) {
      ctx.save();
      ctx.fillStyle = "rgba(198, 92, 255, 0.9)";
      for (var drop = 0; drop < 3; drop += 1) {
        var wobble = Math.sin(state.time * 10 + drop) * 3;
        ctx.beginPath();
        ctx.ellipse(
          enemy.x - 10 + drop * 10,
          enemy.y - enemy.height - 26 + wobble,
          2.6,
          4,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.restore();
    }
    if (enemy.knockdown > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, enemy.knockdown * 2);
      ctx.strokeStyle = "rgba(255, 226, 160, 0.9)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y - 6, enemy.width * 0.9, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }
    if (enemy.stun > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, enemy.stun * 3);
      ctx.strokeStyle = "#ffe9a8";
      ctx.lineWidth = 2;
      for (var star = 0; star < 3; star += 1) {
        var angle = state.time * 6 + (star * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(
          enemy.x + Math.cos(angle) * 12,
          enemy.y - enemy.height - 22 + Math.sin(angle) * 5,
          3,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawProjectiles(ctx, state) {
    (state.projectiles || []).forEach(function (shot) {
      var pulse = 0.85 + 0.15 * Math.sin(state.time * 24 + shot.x);
      ctx.save();
      var glow = ctx.createRadialGradient(shot.x, shot.y, 1, shot.x, shot.y, shot.radius * 3.2 * pulse);
      glow.addColorStop(0, "rgba(255, 214, 150, 0.85)");
      glow.addColorStop(1, "rgba(255, 140, 60, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius * 3.2 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff0cf";
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  /**
   * One pass of a skill's own effect art.
   *
   * The row is normally the skill's own (one row per SKILL_ORDER entry), but a
   * move can ship a second row drawn on the other side of the Slayer: 大蹦's
   * rift and blade stay behind him and the fire it throws goes in front, the way
   * the client orders the layers of that pack.
   */
  function drawEffectRow(ctx, state, sprites, row, frames) {
    var player = state.player;
    if (!player.skillId || player.skillTimer <= 0) return;
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var spec = Core.SKILLS[player.skillId];
    var draw = EFFECT.draw[player.skillId];
    if (!spec || !draw) return;
    /*
     * A move's front half carries its own zoom when it has one (see
     * EFFECT.frontDraw): the two rows are baked to different windows, so the
     * same client pixel needs a different draw size in each to come out the same
     * size on screen.
     */
    var front = EFFECT.frontDraw && EFFECT.frontDraw[player.skillId];
    if (row !== undefined && row !== null && front) {
      draw = { dx: front.dx, dy: front.dy, size: front.size, copies: draw.copies, spin: draw.spin };
    }

    var frame = skillEffectFrame(
      player.skillId,
      1 - player.skillTimer / spec.duration,
      row,
      frames
    );
    if (!frame) return;

    /*
     * 十字斩 draws the cross and then pushes it out, so an effect can travel
     * forward over its cast instead of sitting on the caster.
     */
    var progress = Math.min(1, Math.max(0, 1 - player.skillTimer / spec.duration));
    var reach = draw.dx + (draw.travel || 0) * progress;
    var size = draw.size * (1 + (draw.grow || 0) * progress);
    /*
     * Where the row is rooted. Normally it rides the caster, which is what a
     * slash drawn around the blade wants. 崩山击's landing art is not that: the
     * reference erupts it out of the floor while he is still coming down, so
     * `ground` pins the row to the floor line instead of to his feet - which are
     * in the air for the first half of the window. On the ground the two are the
     * same point, so this only changes the airborne half.
     */
    var baseY = draw.ground ? Core.ARENA.groundY : player.y;

    ctx.save();
    ctx.translate(player.x + player.facing * reach, baseY + draw.dy);
    ctx.scale(player.facing, 1);
    ctx.globalAlpha = frame.alpha;
    ctx.imageSmoothingEnabled = true;
    for (var copy = 0; copy < draw.copies; copy += 1) {
      ctx.save();
      /* 十字斩 is the same DNF slash mirrored into a cross. */
      ctx.rotate(draw.spin * (copy === 0 ? 1 : -1));
      ctx.drawImage(
        sprites.effects,
        frame.col * EFFECT.cell,
        frame.row * EFFECT.cell,
        EFFECT.cell,
        EFFECT.cell,
        -size / 2,
        -size / 2,
        size,
        size
      );
      ctx.restore();
    }
    ctx.restore();
  }

  function drawSkillEffect(ctx, state, sprites) {
    drawEffectRow(ctx, state, sprites);
  }

  /** The half of a move's art that belongs in front of the Slayer, if it has one. */
  function drawSkillEffectFront(ctx, state, sprites) {
    var player = state.player;
    if (!player.skillId) return;
    var row = EFFECT.frontRows[player.skillId];
    if (row === undefined || row === null) return;
    drawEffectRow(ctx, state, sprites, row, EFFECT.frontFrames[player.skillId]);
  }

  /**
   * The dual-blade flourish 血之狂暴 puts on every normal attack.
   *
   * The stance's own art rides the swing instead of the cast: the row is the
   * layered blood energy the client draws around both blades, and it is timed
   * off the normal attack's active window rather than a skill's.
   */
  function drawRageSlash(ctx, state, sprites) {
    var player = state.player;
    if (!player || player.dead) return;
    if (!(player.buffs && player.buffs.bloodRage > 0)) return;
    if (player.attackTimer <= 0) return;
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var draw = EFFECT.draw.frenzy;
    var row = Core.SKILL_ORDER.indexOf("frenzy");
    if (!draw || row === -1) return;

    var progress = clamp01(1 - player.attackTimer / player.attackDuration);
    var from = Math.max(0, Core.PLAYER.attackActiveFrom - 0.18);
    var to = Math.min(1, Core.PLAYER.attackActiveTo + 0.4);
    if (progress < from || progress > to) return;
    var local = clamp01((progress - from) / Math.max(0.0001, to - from));
    var frames = EFFECT.rowFrames.frenzy || 4;
    var column = Math.min(frames - 1, Math.floor(local * frames));
    var size = draw.size * 0.9;

    ctx.save();
    ctx.translate(player.x + player.facing * draw.dx * 0.55, player.y + draw.dy * 0.55);
    ctx.scale(player.facing, 1);
    ctx.globalAlpha = 1 - Math.max(0, (local - 0.7) / 0.3) * 0.6;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      sprites.effects,
      column * EFFECT.cell,
      row * EFFECT.cell,
      EFFECT.cell,
      EFFECT.cell,
      -size / 2,
      -size / 2,
      size,
      size
    );
    ctx.restore();
  }

  /**
   * 银光落刃's blade: the same arc the up-slash uses, turned a quarter turn so it
   * reads as the sword coming down with the dive instead of rising with a cut.
   */
  function drawDiveSlash(ctx, state, sprites) {
    var player = state.player;
    if (!player || player.dead) return;
    if (player.skillTimer <= 0 || player.skillId !== "silverFall") return;
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var spec = Core.SKILLS.silverFall;
    var frames = EFFECT.diveFrames;
    var progress = clamp01(1 - player.skillTimer / spec.duration);
    var from = spec.activeFrom / spec.duration;
    var to = Math.min(1, (spec.activeTo + 0.16) / spec.duration);
    if (progress < from || progress > to) return;
    var local = clamp01((progress - from) / Math.max(0.0001, to - from));
    var column = Math.min(frames - 1, Math.floor(local * frames));
    var size = 150;
    ctx.save();
    ctx.translate(player.x + player.facing * 26, player.y - player.height * 0.35);
    ctx.scale(player.facing, 1);
    ctx.rotate(Math.PI * 0.5);
    ctx.globalAlpha = 1 - Math.max(0, (local - 0.7) / 0.3) * 0.7;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      sprites.effects,
      column * EFFECT.cell,
      EFFECT.diveRow * EFFECT.cell,
      EFFECT.cell,
      EFFECT.cell,
      -size / 2,
      -size / 2,
      size,
      size
    );
    ctx.restore();
  }

  function drawPickups(ctx, state, sprites) {
    state.pickups.forEach(function (drop) {
      if (drop.kind === "blood_orb") {
        drawBloodOrb(ctx, state, drop, sprites);
        return;
      }
      var pulse = 0.8 + 0.2 * Math.sin(state.time * 8 + drop.x);
      ctx.save();
      ctx.globalAlpha = drop.life < 2 ? Math.max(0.25, drop.life / 2) : 1;
      var glow = ctx.createRadialGradient(drop.x, drop.y, 1, drop.x, drop.y, drop.radius * 3 * pulse);
      glow.addColorStop(0, "rgba(150, 255, 180, 0.6)");
      glow.addColorStop(1, "rgba(90, 220, 140, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, drop.radius * 3 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8dffb0";
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(drop.x - drop.radius / 3, drop.y - drop.radius / 3, drop.radius / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  /*
   * 血球: the drop 血之狂暴 pulls out of a monster. It is drawn from its own row
   * of assets/effects.png - the owner picked that art out of the same 血之狂暴
   * pack as the dual-blade slash, and it is the only part of the row that is a
   * ball rather than an arc.
   */
  function drawBloodOrb(ctx, state, drop, sprites) {
    var pulse = 0.85 + 0.15 * Math.sin(state.time * 14 + drop.x * 0.05);
    ctx.save();
    ctx.globalAlpha = drop.life < 0.35 ? Math.max(0.2, drop.life / 0.35) : 1;
    var radius = drop.radius * 3.2 * pulse;
    var glow = ctx.createRadialGradient(drop.x, drop.y, 1, drop.x, drop.y, radius);
    glow.addColorStop(0, "rgba(255, 74, 96, 0.8)");
    glow.addColorStop(0.55, "rgba(206, 22, 46, 0.45)");
    glow.addColorStop(1, "rgba(150, 8, 26, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(drop.x, drop.y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (sprites && sprites.effects && sprites.effects.width) {
      var frames = EFFECT.orbFrames;
      var col = Math.floor(state.time * 14 + drop.x * 0.05) % frames;
      var size = drop.radius * 4.6 * pulse;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        sprites.effects,
        col * EFFECT.cell,
        EFFECT.orbRow * EFFECT.cell,
        EFFECT.cell,
        EFFECT.cell,
        drop.x - size / 2,
        drop.y - size / 2,
        size,
        size
      );
    } else {
      ctx.fillStyle = "#e5233c";
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEffect(ctx, state, effect, bannerOrdinal) {
    var alpha = clamp01(effect.life / effect.maxLife);
    if (effect.kind === "damage") {
      var rise = (1 - alpha) * 28;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.6);
      ctx.font = "bold 20px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(12, 14, 24, 0.9)";
      ctx.strokeText(effect.text, effect.x, effect.y - rise);
      ctx.fillStyle = "#ffe08a";
      ctx.fillText(effect.text, effect.x, effect.y - rise);
      ctx.restore();
    } else if (effect.kind === "heal") {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "bold 18px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(12, 24, 16, 0.9)";
      ctx.strokeText(effect.text, effect.x, effect.y - (1 - alpha) * 26);
      ctx.fillStyle = "#8dffb0";
      ctx.fillText(effect.text, effect.x, effect.y - (1 - alpha) * 26);
      ctx.restore();
    } else if (effect.kind === "banner") {
      /*
       * The room banner and the boss health bar both live at the top centre, so
       * drop the transient banner into the empty band under the HUD while a
       * boss is on screen instead of letting the two draw over each other.
       */
      var bossOnScreen = state.enemies.some(function (enemy) {
        return !enemy.dead && enemy.type === "boss";
      });
      /* Simultaneous banners stack instead of overprinting each other. */
      var bannerY = (bossOnScreen ? 230 : 104) + (bannerOrdinal || 0) * 34;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.5);
      ctx.textAlign = "center";
      ctx.font = "700 26px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(10, 12, 22, 0.85)";
      ctx.strokeText(effect.text, ARENA.width / 2, bannerY);
      var grad = ctx.createLinearGradient(0, bannerY - 20, 0, bannerY + 8);
      grad.addColorStop(0, "#fff3c4");
      grad.addColorStop(1, "#e3bf72");
      ctx.fillStyle = grad;
      ctx.fillText(effect.text, ARENA.width / 2, bannerY);
      ctx.restore();
    } else if (effect.kind === "telegraph") {
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.4 * (1 - alpha);
      ctx.strokeStyle = "#ff8f6b";
      ctx.lineWidth = 2;
      if (effect.radius > 0) {
        ctx.beginPath();
        ctx.ellipse(effect.x, effect.y, effect.radius, effect.radius * 0.22, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (effect.dir) {
        ctx.beginPath();
        ctx.moveTo(effect.x, effect.y);
        ctx.lineTo(effect.x + effect.dir * effect.radius, effect.y);
        ctx.stroke();
      }
      if (effect.text) {
        ctx.globalAlpha = 0.55 + 0.4 * (1 - alpha);
        ctx.fillStyle = "#ffd2c4";
        ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(effect.text, effect.x, effect.y - 10);
      }
      ctx.restore();
    } else if (effect.kind === "shockwave" && effect.arc !== false) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = "#ffb066";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(
        effect.x,
        effect.y,
        effect.radius * (1.15 - alpha * 0.35),
        effect.radius * 0.22 * (1.15 - alpha * 0.35),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.restore();
    } else if (effect.kind === "ghost") {
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = PALETTE.ghost;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius, -0.95, 0.95);
      ctx.stroke();
      ctx.restore();
    } else if (effect.kind === "collapse") {
      /* Dust, and grit thrown up out of the hole. */
      var fall = 1 - alpha;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.2);
      ctx.fillStyle = "rgba(38, 30, 34, 0.72)";
      ctx.beginPath();
      ctx.ellipse(effect.x, effect.y, effect.radius * 0.96, effect.radius * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 168, 120, 0.75)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(
        effect.x,
        effect.y,
        effect.radius * (0.9 + fall * 0.5),
        effect.radius * 0.2 * (0.9 + fall * 0.5),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.fillStyle = "rgba(196, 176, 156, 0.9)";
      for (var grit = 0; grit < 6; grit += 1) {
        var spread = (grit / 5 - 0.5) * effect.radius * 1.4;
        var lift = fall * (26 + (grit % 3) * 12);
        ctx.fillRect(effect.x + spread, effect.y - lift, 3, 5);
      }
      ctx.restore();
    }

    if (effect.kind === "damage") {
      /* sparks around every damage number */
      var spark = 1 - alpha;
      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = "#ffd9a0";
      ctx.lineWidth = 2;
      for (var i = 0; i < 5; i += 1) {
        var angle = (i / 5) * Math.PI * 2 + effect.x;
        var inner = 6 + spark * 16;
        var outer = inner + 7;
        ctx.beginPath();
        ctx.moveTo(effect.x + Math.cos(angle) * inner, effect.y + Math.sin(angle) * inner);
        ctx.lineTo(effect.x + Math.cos(angle) * outer, effect.y + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawHud(ctx, state, sprites) {
    var player = state.player;
    var panelX = 16;
    var panelY = 14;
    var panelW = 322;
    var panelH = 96;
    panel(ctx, panelX, panelY, panelW, panelH, 8);

    var portraitSize = 60;
    var px = panelX + 12;
    var py = panelY + 12;
    ctx.save();
    ctx.fillStyle = "rgba(6, 9, 18, 0.9)";
    roundRect(ctx, px, py, portraitSize, portraitSize, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 191, 114, 0.6)";
    ctx.lineWidth = 1.4;
    roundRect(ctx, px + 0.7, py + 0.7, portraitSize - 1.4, portraitSize - 1.4, 6);
    ctx.stroke();
    if (sprites && sprites.slayer && sprites.slayer.width) {
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, px + 2, py + 2, portraitSize - 4, portraitSize - 4, 5);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      /*
       * Head only: the owner asked for the face rather than the whole figure, so
       * the draw takes a square around the head - the idle art puts it at the top
       * of the cell, a little left of the anchor.
       */
      var headSize = 44;
      ctx.drawImage(
        sprites.slayer,
        SPRITE.anchorX - 12,
        70,
        headSize,
        headSize,
        px + 3,
        py + 3,
        portraitSize - 6,
        portraitSize - 6
      );
      ctx.restore();
    }
    ctx.restore();

    var infoX = px + portraitSize + 12;
    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.text;
    ctx.font = "700 16px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText("鬼剑士 SLAYER", infoX, py + 16);
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Lv " + player.level, infoX + 152, py + 16);
    ctx.restore();

    var barX = infoX;
    var barW = panelW - (infoX - panelX) - 14;
    bar(ctx, barX, py + 24, barW, 12, player.hp / player.maxHp, "#8cf0a6", "#37a85c", PALETTE.hpBack);
    bar(ctx, barX, py + 42, barW, 10, player.mp / player.maxMp, "#9ccbff", "#3f7fd8", PALETTE.mpBack);
    bar(ctx, barX, py + 58, barW, 7, player.xp / player.xpToNext, "#ffe9a8", "#d8a83c", PALETTE.xpBack);

    ctx.save();
    ctx.textAlign = "right";
    ctx.font = "600 12px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(Math.round(player.hp) + " / " + player.maxHp, barX + barW - 6, py + 34);
    ctx.fillStyle = "rgba(200, 224, 255, 0.92)";
    ctx.fillText(Math.round(player.mp) + " / " + player.maxMp, barX + barW - 6, py + 51);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = "600 11px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(Math.round(player.xp) + " / " + player.xpToNext + " XP", barX + barW - 4, py + 65);
    ctx.restore();

    /* room card */
    var roomW = 236;
    var roomX = ARENA.width - roomW - 16;
    panel(ctx, roomX, 14, roomW, 60, 8);
    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.text;
    ctx.font = "700 15px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText(state.room ? state.room.name : "", roomX + 14, 38);
    var enemiesLeft = state.enemies.filter(function (enemy) {
      return !enemy.dead;
    }).length;
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = "600 12px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText(
      "房间 " + (state.roomIndex + 1) + "/" + state.layout.length + " · 剩余敌人 " + enemiesLeft,
      roomX + 14,
      58
    );
    ctx.restore();

    if (player.comboTimer > 0 && player.comboIndex > 0) {
      ctx.save();
      ctx.textAlign = "right";
      ctx.font = "800 26px 'Segoe UI', system-ui, sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(12, 14, 24, 0.85)";
      var comboLabel =
        (player.comboIndex + 1) + (player.airHitTimer > 0 ? " AIR COMBO" : " COMBO");
      ctx.strokeText(comboLabel, roomX + roomW - 14, 104);
      ctx.fillStyle = "#ffd66b";
      ctx.fillText(comboLabel, roomX + roomW - 14, 104);
      ctx.restore();
    }

    var boss = state.enemies.find(function (enemy) {
      return !enemy.dead && enemy.type === "boss";
    });
    if (boss) {
      var bossW = 420;
      var bossX = ARENA.width / 2 - bossW / 2;
      panel(ctx, bossX, 84, bossW, 34, 6);
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = PALETTE.text;
      ctx.font = "700 13px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText(boss.phase >= 2 ? "GOBLIN KING · 狂暴" : "GOBLIN KING", ARENA.width / 2, 101);
      ctx.restore();
      bar(
        ctx,
        bossX + 12,
        106,
        bossW - 24,
        8,
        boss.hp / boss.maxHp,
        "#ff9aa8",
        "#a8203a",
        "rgba(40, 10, 18, 0.9)"
      );
      /* Half-health tick: the exact point that flips the boss into phase two. */
      ctx.save();
      ctx.fillStyle = boss.phase >= 2 ? "rgba(255, 226, 160, 0.95)" : "rgba(255, 226, 160, 0.5)";
      ctx.fillRect(ARENA.width / 2 - 1, 105, 2, 10);
      ctx.restore();
    }
  }

  /** A short line of coaching, centred above the action but below the HUD. */
  function drawHint(ctx, hint) {
    if (!hint) return;
    var fade = Math.min(1, hint.life / 0.4) * Math.min(1, (hint.maxLife - hint.life) / 0.2 + 0.2);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, fade));
    ctx.font = "600 17px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    var measured = ctx.measureText ? ctx.measureText(hint.text) : null;
    var textWidth = measured && measured.width ? measured.width : hint.text.length * 10;
    var width = textWidth + 36;
    panel(ctx, ARENA.width / 2 - width / 2, 196, width, 38, 19);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(hint.text, ARENA.width / 2, 221);
    ctx.restore();
  }

  var UPGRADE_CARD = { w: 220, h: 120, gap: 24, y: 206 };

  /** Fixed geometry: the chooser slots stay put so a tap always hits one. */
  function upgradeCards() {
    var count = Core.UPGRADES_PER_ROOM;
    var total = count * UPGRADE_CARD.w + (count - 1) * UPGRADE_CARD.gap;
    var startX = (ARENA.width - total) / 2;
    var cards = [];
    for (var index = 0; index < count; index += 1) {
      cards.push({
        action: "choice" + index,
        index: index,
        x: startX + index * (UPGRADE_CARD.w + UPGRADE_CARD.gap),
        y: UPGRADE_CARD.y,
        w: UPGRADE_CARD.w,
        h: UPGRADE_CARD.h
      });
    }
    return cards;
  }

  function hitTestUpgrade(x, y) {
    var cards = upgradeCards();
    for (var index = 0; index < cards.length; index += 1) {
      var card = cards[index];
      if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) {
        return index;
      }
    }
    return null;
  }

  function drawUpgradeChoice(ctx, state) {
    var choice = state.upgradeChoice;
    if (!choice) return;

    ctx.save();
    ctx.fillStyle = "rgba(6, 8, 16, 0.66)";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "700 24px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("房间已清空 · 选一个强化", ARENA.width / 2, 160);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = "600 14px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("按 1 / 2 / 3 选择，触屏直接点卡片", ARENA.width / 2, 184);

    upgradeCards().forEach(function (card, index) {
      panel(ctx, card.x, card.y, card.w, card.h, 8);
      var id = choice.options[index];
      var spec = id ? Core.UPGRADES[id] : null;
      if (!spec) return;

      ctx.textAlign = "center";
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "700 18px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(String(index + 1), card.x + card.w / 2, card.y + 28);

      ctx.fillStyle = PALETTE.text;
      ctx.font = "700 21px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(spec.name, card.x + card.w / 2, card.y + 62);

      ctx.fillStyle = PALETTE.textDim;
      ctx.font = "600 13px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(spec.detail, card.x + card.w / 2, card.y + 92);
    });
    ctx.restore();
  }

  function drawSkillBar(ctx, state, sprites, loadout, compact) {
    var player = state.player;
    var slots = loadout || [];
    var keys = ["A", "S", "D", "F", "G", "H", "Q", "W", "E", "R", "T", "Y"];
    var buttons = compact ? touchBarButtons() : skillBarButtons();
    var iconIndex = {};
    Core.SKILL_ORDER.forEach(function (skillId, index) {
      iconIndex[skillId] = index;
    });

    buttons.forEach(function (slot) {
      var skillId = slots[slot.index] || null;
      var skill = skillId ? Core.SKILLS[skillId] : null;
      var cooldown = skill ? player.skillCooldowns[skillId] || 0 : 0;
      var ready = skill ? cooldown <= 0 && player.mp >= skill.mp && !player.dead : false;

      ctx.save();
      ctx.fillStyle = ready ? "rgba(20, 28, 48, 0.92)" : "rgba(12, 14, 24, 0.9)";
      roundRect(ctx, slot.x, slot.y, slot.w, slot.h, 6);
      ctx.fill();
      ctx.strokeStyle = skill
        ? ready
          ? "rgba(226, 191, 114, 0.85)"
          : "rgba(96, 106, 136, 0.6)"
        : "rgba(96, 106, 136, 0.4)";
      ctx.lineWidth = 1.4;
      roundRect(ctx, slot.x + 0.7, slot.y + 0.7, slot.w - 1.4, slot.h - 1.4, 6);
      if (!skill) ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (skill && sprites && sprites.skills && sprites.skills.width) {
        var iconSize = compact ? slot.w - 8 : 36;
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = ready ? 1 : 0.55;
        ctx.drawImage(
          sprites.skills,
          iconIndex[skillId] * 32,
          0,
          32,
          32,
          compact ? slot.x + 4 : slot.x + 5,
          compact ? slot.y + 4 : slot.y + 2,
          iconSize,
          iconSize
        );
        ctx.globalAlpha = 1;
      }

      if (compact) {
        /* Touch bar: icon-only slots with the key in the corner and a cooldown sweep. */
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(10, 12, 20, 0.75)";
        roundRect(ctx, slot.x + 2, slot.y + 2, 15, 13, 3);
        ctx.fill();
        ctx.fillStyle = PALETTE.gold;
        ctx.font = "700 10px 'Segoe UI', system-ui, sans-serif";
        ctx.fillText(keys[slot.index], slot.x + 5, slot.y + 12);
        if (cooldown > 0) {
          ctx.fillStyle = "rgba(8, 10, 18, 0.62)";
          roundRect(ctx, slot.x + 1, slot.y + 1, slot.w - 2, (slot.h - 2) * clamp01(cooldown / skill.cooldown), 5);
          ctx.fill();
          ctx.fillStyle = "#9ccbff";
          ctx.font = "700 11px 'Segoe UI', system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(cooldown.toFixed(1), slot.x + slot.w / 2, slot.y + slot.h / 2 + 4);
        }
        ctx.restore();
        return;
      }

      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
      /* A skill with its own key (DNF's Z for 上挑) shows both ways to cast it. */
      var shortcut = skillId ? Loadout.SKILL_SHORTCUTS[skillId] : null;
      ctx.fillText(
        shortcut ? keys[slot.index] + "/" + shortcut : keys[slot.index],
        slot.x + 46,
        slot.y + 18
      );
      if (skill) {
        ctx.fillStyle = ready ? PALETTE.text : "rgba(198, 208, 228, 0.55)";
        ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
        ctx.fillText(skill.name, slot.x + 46, slot.y + 36);
        ctx.textAlign = "right";
        if (cooldown > 0) {
          ctx.fillStyle = "rgba(8, 10, 18, 0.6)";
          roundRect(ctx, slot.x + 1, slot.y + 1, (slot.w - 2) * clamp01(cooldown / skill.cooldown), slot.h - 2, 5);
          ctx.fill();
          ctx.fillStyle = "#9ccbff";
          ctx.font = "700 12px 'Segoe UI', system-ui, sans-serif";
          ctx.fillText(cooldown.toFixed(1) + "s", slot.x + slot.w - 6, slot.y + 27);
        } else {
          ctx.fillStyle = "rgba(150, 206, 255, 0.9)";
          ctx.font = "600 10px 'Segoe UI', system-ui, sans-serif";
          ctx.fillText("MP " + skill.mp, slot.x + slot.w - 5, slot.y + 36);
        }
      } else {
        ctx.fillStyle = "rgba(150, 160, 190, 0.6)";
        ctx.font = "600 12px 'PingFang SC', 'Segoe UI', sans-serif";
        ctx.fillText("空槽 · B 编成", slot.x + 46, slot.y + 32);
      }
      ctx.restore();
    });
  }

  function drawLoadoutPanel(ctx, state, sprites, meta) {
    var loadout = meta.loadout || [];
    var drag = meta.drag || null;

    ctx.save();
    ctx.fillStyle = "rgba(9, 12, 22, 0.94)";
    roundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 191, 114, 0.6)";
    ctx.lineWidth = 1.4;
    roundRect(ctx, PANEL.x + 0.7, PANEL.y + 0.7, PANEL.w - 1.4, PANEL.h - 1.4, 8);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "700 14px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText("技能编成 · 拖动图标到下方 A/S/D/F/G/H 槽位（B 关闭）", PANEL.x + 12, PANEL.y + 20);

    var iconIndex = {};
    Core.SKILL_ORDER.forEach(function (skillId, index) {
      iconIndex[skillId] = index;
    });

    loadoutPanelButtons().forEach(function (tile) {
      var skill = Core.SKILLS[tile.skillId];
      var equipped = loadout.indexOf(tile.skillId) !== -1;
      var dragging = drag && drag.skillId === tile.skillId;

      ctx.fillStyle = dragging
        ? "rgba(226, 191, 114, 0.28)"
        : equipped
          ? "rgba(24, 34, 56, 0.95)"
          : "rgba(16, 20, 32, 0.9)";
      roundRect(ctx, tile.x, tile.y, tile.w, tile.h, 6);
      ctx.fill();
      ctx.strokeStyle = equipped ? "rgba(226, 191, 114, 0.8)" : "rgba(96, 106, 136, 0.5)";
      ctx.lineWidth = 1.3;
      roundRect(ctx, tile.x + 0.7, tile.y + 0.7, tile.w - 1.4, tile.h - 1.4, 6);
      ctx.stroke();

      if (sprites && sprites.skills && sprites.skills.width) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprites.skills, iconIndex[tile.skillId] * 32, 0, 32, 32, tile.x + 4, tile.y + 4, 30, 30);
      }
      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.text;
      ctx.font = "600 12px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText(skill.name, tile.x + 38, tile.y + 18);
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = "600 10px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("MP " + skill.mp + " · CD " + skill.cooldown + "s", tile.x + 38, tile.y + 34);
      ctx.fillText(EFFECT_LABEL[skill.id] || "", tile.x + 38, tile.y + 49);
      ctx.restore();
    });
    ctx.restore();

    if (drag) {
      var dragSkill = Core.SKILLS[drag.skillId];
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(226, 191, 114, 0.22)";
      roundRect(ctx, drag.x - 22, drag.y - 26, 130, 52, 6);
      ctx.fill();
      if (sprites && sprites.skills && sprites.skills.width) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprites.skills, iconIndex[drag.skillId] * 32, 0, 32, 32, drag.x - 18, drag.y - 18, 36, 36);
      }
      ctx.fillStyle = PALETTE.text;
      ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(dragSkill.name, drag.x + 24, drag.y + 4);
      ctx.restore();
    }
  }

  /* `only` redraws a subset of the controls; the pause overlay uses it to put
     the one button that still does something back on top of itself. */
  function drawTouchControls(ctx, state, sprites, meta, only) {
    var player = state.player;
    var pressed = (meta && meta.pressed) || [];

    ctx.save();
    TOUCH_LAYOUT.forEach(function (button) {
      if (only && only.indexOf(button.action) === -1) return;
      var isDown = pressed.indexOf(button.action) !== -1;
      var fill = isDown ? "rgba(226, 191, 114, 0.32)" : "rgba(16, 20, 34, 0.55)";

      ctx.fillStyle = fill;
      roundRect(ctx, button.x, button.y, button.w, button.h, 14);
      ctx.fill();
      ctx.strokeStyle = isDown ? "rgba(255, 232, 170, 0.95)" : "rgba(226, 191, 114, 0.6)";
      ctx.lineWidth = isDown ? 2.4 : 1.6;
      roundRect(ctx, button.x + 0.8, button.y + 0.8, button.w - 1.6, button.h - 1.6, 13);
      ctx.stroke();

      ctx.fillStyle = isDown ? "#fff3c4" : "rgba(238, 244, 255, 0.88)";
      ctx.font = "700 " + Math.round(button.h * 0.42) + "px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var label = button.label;
      if (button.action === "mute") label = meta && meta.muted ? "静" : "音";
      if (button.action === "pause") label = meta && meta.paused ? "续" : "停";
      ctx.fillText(label, button.x + button.w / 2, button.y + button.h / 2 + 1);
      ctx.textBaseline = "alphabetic";
    });
    ctx.restore();
  }

  function drawOverlay(ctx, state, meta, sprites) {
    if (meta && meta.attract) {
      drawAttractTitle(ctx, state, meta);
      return;
    }
    if (state.defeat || state.victory) {
      ctx.save();
      ctx.fillStyle = "rgba(6, 8, 16, 0.74)";
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
      ctx.textAlign = "center";
      ctx.font = "bold 46px 'Segoe UI', system-ui, sans-serif";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(10, 12, 22, 0.9)";
      var title = state.defeat ? "YOU DIED" : "DUNGEON CLEARED";
      ctx.strokeText(title, ARENA.width / 2, ARENA.height / 2 - 10);
      ctx.fillStyle = state.defeat ? PALETTE.danger : PALETTE.gold;
      ctx.fillText(title, ARENA.width / 2, ARENA.height / 2 - 10);
      ctx.fillStyle = "rgba(230, 240, 255, 0.85)";
      ctx.font = "18px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText(
        state.defeat ? "按 F3 重新开始" : "按 F3 再来一次",
        ARENA.width / 2,
        ARENA.height / 2 + 34
      );
      if (meta && meta.run && meta.run.resultText && state.victory) {
        ctx.font = "700 20px 'PingFang SC', 'Segoe UI', sans-serif";
        ctx.fillStyle = meta.run.improved ? PALETTE.gold : PALETTE.textDim;
        ctx.fillText(
          meta.run.resultText,
          ARENA.width / 2,
          ARENA.height / 2 + 70
        );
      }
      if (meta && meta.run && meta.run.recordText) {
        ctx.font = "600 16px 'PingFang SC', 'Segoe UI', sans-serif";
        ctx.fillStyle = PALETTE.textDim;
        ctx.fillText(meta.run.recordText, ARENA.width / 2, ARENA.height / 2 + 98);
      }
      drawRunTable(ctx, meta && meta.run && meta.run.rows);
      /* The link that reopens this exact run, so a good seed can be passed on. */
      if (meta && meta.run && meta.run.linkText) {
        ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
        var linkY = ARENA.height / 2 + 216;
        var linkWidth = ctx.measureText(meta.run.linkText).width + 26;
        /* A backing pill keeps the link readable over the skill bar behind it. */
        roundRect(ctx, ARENA.width / 2 - linkWidth / 2, linkY - 16, linkWidth, 23, 11);
        ctx.fillStyle = "rgba(6, 8, 16, 0.8)";
        ctx.fill();
        ctx.textAlign = "center";
        ctx.fillStyle = PALETTE.textDim;
        ctx.fillText(meta.run.linkText, ARENA.width / 2, linkY);
      }
      ctx.restore();
      return;
    }
    if (meta && meta.paused) {
      ctx.save();
      ctx.fillStyle = "rgba(6, 8, 16, 0.6)";
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
      ctx.textAlign = "center";
      ctx.fillStyle = PALETTE.text;
      ctx.font = "bold 42px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("PAUSED", ARENA.width / 2, ARENA.height / 2);
      ctx.font = "18px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(
        meta.touch && meta.touch.enabled ? "按 P 或点右上角 续 继续" : "按 P 继续",
        ARENA.width / 2,
        ARENA.height / 2 + 34
      );
      /* A paused player still wants to know which run they are standing in. */
      drawRunTable(ctx, (meta && meta.liveRows) || (meta && meta.run && meta.run.rows));
      ctx.restore();
      return;
    }
    if (meta && meta.showHelp) {
      ctx.save();
      ctx.fillStyle = "rgba(5, 7, 14, 0.86)";
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);

      if (sprites && sprites.slayer && sprites.slayer.width) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.95;
        drawSpriteFrame(ctx, sprites.slayer, 0, 0, 244, 392, false, 2.6);
        ctx.globalAlpha = 1;
      }

      ctx.textAlign = "left";
      ctx.font = "800 54px 'Segoe UI', system-ui, sans-serif";
      var grad = ctx.createLinearGradient(0, 70, 0, 124);
      grad.addColorStop(0, "#fff4cc");
      grad.addColorStop(1, "#d9a743");
      ctx.fillStyle = grad;
      ctx.fillText("NANO", 344, 108);
      ctx.fillText("DNF", 344, 162);
      ctx.fillStyle = PALETTE.text;
      ctx.font = "600 20px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText("鬼剑士 · 地下城试炼", 344, 196);

      var rows = [
        ["← →", "移动"],
        ["C / ↑ / Space", "跳跃"],
        ["X", "普攻（连按 X 打完四段连击）"],
        ["Z / A", "上挑（挑飞，DNF 默认 Z）"],
        ["S", "崩山击（冲击波）"],
        ["D", "十字斩"],
        ["F", "血气之刃"],
        ["P / F3 / F1", "暂停 / 重开 / 帮助"]
      ];
      ctx.font = "600 15px 'PingFang SC', 'Segoe UI', sans-serif";
      rows.forEach(function (row, index) {
        var y = 236 + index * 26;
        ctx.fillStyle = PALETTE.gold;
        ctx.fillText(row[0], 344, y);
        ctx.fillStyle = PALETTE.text;
        ctx.fillText(row[1], 508, y);
      });

      ctx.fillStyle = PALETTE.textDim;
      ctx.font = "600 14px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText(
        "清空房间后走到最右侧传送门，第 " + state.layout.length + " 层击败 Boss 即通关",
        344,
        462
      );
      ctx.fillStyle = "#ffd66b";
      ctx.font = "700 16px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText("按任意键开始", 344, 496);

      /* The replay hook: which seed this run uses and how the best one went. */
      if (meta && meta.run) {
        ctx.textAlign = "right";
        ctx.font = "700 18px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
        ctx.fillStyle = PALETTE.gold;
        ctx.fillText(meta.run.seedText || "", ARENA.width - 60, 132);
        ctx.font = "600 15px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
        ctx.fillStyle = PALETTE.textDim;
        ctx.fillText(meta.run.recordText || "", ARENA.width - 60, 160);
        if (meta.run.overallText) {
          ctx.fillText(meta.run.overallText, ARENA.width - 60, 186);
        }
        ctx.fillStyle = PALETTE.text;
        ctx.fillText("按 N 换一个种子", ARENA.width - 60, meta.run.overallText ? 212 : 186);
      }
      ctx.restore();
    }
  }

  /*
   * One line under the HUD: this seed's best time and which side of it the run
   * is on right now, so a replay has something to race.
   */
  function drawPace(ctx, pace) {
    ctx.save();
    ctx.textAlign = "left";
    ctx.font = "600 14px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = pace.state === "behind" ? PALETTE.danger : PALETTE.gold;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(10, 12, 22, 0.85)";
    ctx.strokeText(pace.text, 22, 128);
    ctx.fillText(pace.text, 22, 128);
    ctx.restore();
  }

  /*
   * The run's own numbers, shared by the clear and defeat screens: seed, time,
   * level, the upgrades taken, kills, damage taken and how far the run got. Two
   * short columns keep the table clear of the skill bar underneath.
   */
  function drawRunTable(ctx, rows) {
    if (!rows || !rows.length) return;
    var perColumn = Math.ceil(rows.length / 2);
    var columnWidth = 360;
    var firstColumnX = ARENA.width / 2 - columnWidth / 2;
    var firstRowY = ARENA.height / 2 + 120;
    rows.forEach(function (row, index) {
      var x = firstColumnX + Math.floor(index / perColumn) * columnWidth;
      var y = firstRowY + (index % perColumn) * 21;
      ctx.font = "600 15px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText(row.label, x - 10, y);
      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(row.value, x + 10, y);
    });
  }

  /*
   * The attract title: the demo run plays under a slim banner instead of behind
   * the full help sheet, so the first ten seconds show the game moving rather
   * than a still frame. The controls stay on the page, and F1 still opens the
   * full sheet once the run has started.
   */
  function drawAttractTitle(ctx, state, meta) {
    ctx.save();
    /* A light scrim keeps the text readable without hiding the fight. */
    ctx.fillStyle = "rgba(5, 7, 14, 0.32)";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    /*
     * The plate is solid across the demo's own HUD strip, then fades: the title
     * stays readable without turning the fight below it into a smear.
     */
    var band = ctx.createLinearGradient(0, 0, 0, 200);
    band.addColorStop(0, "rgba(4, 6, 12, 1)");
    band.addColorStop(0.65, "rgba(4, 6, 12, 1)");
    band.addColorStop(1, "rgba(4, 6, 12, 0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, ARENA.width, 200);

    ctx.textAlign = "left";
    var grad = ctx.createLinearGradient(0, 36, 0, 78);
    grad.addColorStop(0, "#fff4cc");
    grad.addColorStop(1, "#d9a743");
    ctx.font = "800 44px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = grad;
    ctx.fillText("NANO DNF", 40, 78);
    ctx.font = "600 16px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = PALETTE.text;
    ctx.fillText("鬼剑士 · 地下城试炼", 42, 106);

    /* The badge says the fight on screen is the page showing off, not the run. */
    roundRect(ctx, 42, 120, 112, 26, 13);
    ctx.fillStyle = "rgba(226, 191, 114, 0.18)";
    ctx.fill();
    ctx.font = "700 13px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText("演示 DEMO", 56, 138);

    /* The replay hook stays on the right, clear of the demo's own HUD. */
    if (meta && meta.run) {
      ctx.textAlign = "right";
      ctx.font = "700 18px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText(meta.run.seedText || "", ARENA.width - 40, 58);
      ctx.font = "600 15px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(meta.run.recordText || "", ARENA.width - 40, 86);
      if (meta.run.overallText) {
        ctx.fillText(meta.run.overallText, ARENA.width - 40, 112);
      }
      ctx.fillStyle = PALETTE.text;
      ctx.fillText("按 N 换一个种子", ARENA.width - 40, meta.run.overallText ? 138 : 112);
    }

    /* A blinking prompt, so an untouched page still asks to be played. */
    var pulse = 0.5 + 0.5 * Math.sin(state.time * 4);
    ctx.textAlign = "center";
    roundRect(ctx, ARENA.width / 2 - 150, 176, 300, 44, 22);
    ctx.fillStyle = "rgba(6, 8, 16, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 191, 114, 0.45)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, ARENA.width / 2 - 149, 177, 298, 42, 21);
    ctx.stroke();
    ctx.font = "700 21px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255, 214, 107, " + pulse.toFixed(3) + ")";
    ctx.fillText("按任意键开始", ARENA.width / 2, 206);

    /*
     * The demo's own banners are the page's running commentary — "Room 2 -
     * Bloody Culvert", "Goblin King enraged!", "Dungeon cleared!" — so they are
     * drawn on top of the plate rather than buried under it. The card chooser
     * speaks for itself while it is open.
     */
    if (!state.upgradeChoice) {
      var bannerY = 260;
      state.effects.forEach(function (effect) {
        if (effect.kind !== "banner") return;
        var alpha = Math.min(1, (effect.life / effect.maxLife) * 1.5);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.font = "700 26px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(10, 12, 22, 0.85)";
        ctx.strokeText(effect.text, ARENA.width / 2, bannerY);
        var bannerGrad = ctx.createLinearGradient(0, bannerY - 20, 0, bannerY + 8);
        bannerGrad.addColorStop(0, "#fff3c4");
        bannerGrad.addColorStop(1, "#e3bf72");
        ctx.fillStyle = bannerGrad;
        ctx.fillText(effect.text, ARENA.width / 2, bannerY);
        ctx.restore();
        bannerY += 32;
      });
    }
    ctx.restore();
  }

  function render(ctx, state, meta) {
    meta = meta || {};
    var sprites = meta.sprites || null;
    /*
     * A full-screen overlay owns the frame. The sim is frozen behind it, so the
     * room banner would otherwise sit half-faded under the title forever; hold
     * it back and let it announce the room once play actually starts.
     */
    var overlayOpen = !!(meta.paused || meta.showHelp || state.victory || state.defeat);
    ctx.clearRect(0, 0, ARENA.width, ARENA.height);

    var shake = 0;
    state.effects.forEach(function (effect) {
      if (effect.kind === "shockwave") shake = Math.max(shake, effect.life / effect.maxLife);
      /* The floor dropping is its own jolt, not a copy of a slam. */
      if (effect.kind === "collapse") shake = Math.max(shake, (effect.life / effect.maxLife) * 1.3);
    });

    ctx.save();
    if (shake > 0) {
      ctx.translate(Math.sin(state.time * 90) * 2.4 * shake, Math.cos(state.time * 77) * 1.6 * shake);
    }
    drawBackdrop(ctx, state);
    drawGate(ctx, state);
    drawHazards(ctx, state);

    state.enemies.forEach(function (enemy) {
      drawEnemy(ctx, state, enemy);
    });
    drawProjectiles(ctx, state);
    drawPickups(ctx, state, sprites);
    /* The stance puts its own arc on the normal attack, under the skill art. */
    drawRageSlash(ctx, state, sprites);
    drawSkillEffect(ctx, state, sprites);
    drawDiveSlash(ctx, state, sprites);
    drawPlayer(ctx, state, sprites);
    /* 大蹦's fire passes in front of him, the rift and the blade behind. */
    drawSkillEffectFront(ctx, state, sprites);
    var bannerOrdinal = 0;
    state.effects.forEach(function (effect) {
      if (effect.kind === "banner" && overlayOpen) return;
      drawEffect(ctx, state, effect, effect.kind === "banner" ? bannerOrdinal++ : 0);
    });
    ctx.restore();

    drawVignette(ctx, state);
    drawHud(ctx, state, sprites);
    /* The pace line belongs to live play, not to a full-screen overlay. */
    if (!overlayOpen && meta.run && meta.run.pace && meta.run.pace.text) {
      drawPace(ctx, meta.run.pace);
    }
    drawSkillBar(ctx, state, sprites, meta.loadout, !!(meta.touch && meta.touch.enabled));
    if (meta.touch && meta.touch.enabled) drawTouchControls(ctx, state, sprites, meta.touch);
    if (meta.loadoutOpen) drawLoadoutPanel(ctx, state, sprites, meta);
    /* The reward prompt belongs to live play too, and to the demo's own card pick. */
    if (!overlayOpen || meta.attract) drawUpgradeChoice(ctx, state);
    /* Coaching belongs to live play as well. */
    if (!overlayOpen) drawHint(ctx, meta.hint);
    drawOverlay(ctx, state, meta, sprites);
    /*
     * The pause overlay is drawn over the controls and says "按 P 继续", which a
     * touch player has no way to press. Put the pause button back on top of that
     * overlay - and flip it to 续 - so the way out of the pause is visible.
     */
    if (meta.paused && meta.touch && meta.touch.enabled) {
      drawTouchControls(ctx, state, sprites, meta.touch, ["pause"]);
    }
  }

  return {
    render: render,
    PALETTE: PALETTE,
    SPRITE: SPRITE,
    EFFECT: EFFECT,
    attackColumn: attackColumn,
    playerFrame: playerFrame,
    skillEffectFrame: skillEffectFrame,
    skillBarButtons: skillBarButtons,
    touchBarButtons: touchBarButtons,
    SLOT_COUNT: SLOT_COUNT,
    loadoutPanelButtons: loadoutPanelButtons,
    hitTestLoadout: hitTestLoadout,
    upgradeCards: upgradeCards,
    hitTestUpgrade: hitTestUpgrade,
    touchButtons: touchButtons,
    hitTestTouch: hitTestTouch
  };
});
