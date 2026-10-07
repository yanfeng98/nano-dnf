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
  /*
   * The floor's foreshortening, named once so nothing else invents a second
   * one. `DEPTH.scale` squashes the ground ellipses; `depthLift` is the same
   * number applied to placement (see Core.DEPTH).
   */
  var DEPTH = Core.DEPTH;
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
    /*
     * The walkable strip where it meets the wall. The room is lit from the
     * wall - the torches are on it - and the existing skirt already runs bright
     * at the ground line down to dark at the viewer, so the band continues that
     * one direction instead of inventing a second: lit at the wall, going dark
     * towards the camera, with no seam where the two meet.
     */
    bandBack: "#3a3758",
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
    /*
     * 47 -> 57 when 暴走's body clip went in, 57 -> 64 when 血之狂暴's cast became
     * its own seventeen-frame motion. Both raises are the same hazard - an
     * overflowing clip is truncated in silence - and both are explained in
     * assets/import_dnf_swordman.py. Every `first` below was re-read off that
     * bake's print, which is the only place the real layout comes from.
     */
    cols: 64,
    anchorX: 88,
    anchorY: 156,
    /*
     * The height he is actually drawn at, which is *not* anchorY. anchorY is
     * where his feet sit in the cell; the art above it is headroom the cell
     * reserves for the widest swing in the sheet. This is the art that is there:
     * the idle row's own bounding box (rows 74..157 of the frame). It is the
     * unit reference measurements are normalised against - "how many Slayers
     * tall is that flame" - so it is pinned by a test to the sheet, because it
     * is a fact about the PNG and not a number anyone should be free to edit.
     * Core.SLAYER_HEIGHT (156) is the other height, and it is a different thing:
     * that one measures the cell between the feet and the anchor.
     */
    bodyHeight: 84,
    rows: { idle: 0, run: 1, attack: 2, skill: 3, extras: 4, clips: 5, clips2: 6, bloodblade: 7, flare: 8,
            /* 血之狂暴's own swing, its own row at the bottom of the sheet. */
            rage: 9,
            /* ... and the client's own slash arc alone, graded to cream. */
            ragearc: 10,
            /*
             * 魔狱血刹's two body motions. They are on a row of their own
             * because `clips2` had three columns left and a clip that runs past
             * `cols` is truncated in silence - see
             * assets/import_dnf_swordman.py ROWS.
             */
            awaken: 11 },
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
    /*
     * **血之狂暴's own swing.** 22 frames, the owner's pick off the full-frame
     * sheet (188-209) and the one animation the client's blood sword is drawn
     * against - three swings over the three-hit chain, so the column is read off
     * `rageComboLocal` and not off the single press. Every normal attack with the
     * stance up plays this instead of the katana chain's small cuts.
     */
    rageSwing: { row: 9, first: 0, frames: 22 },
    /*
     * **The client's own arc, in cream.** The body sheet carries the arc *alone*
     * on the row below the swing (`rage_arc_layer` in the bake: the weapon
     * layer's own frames 188-209, masked to the arc and graded to the reference's
     * cream). Drawn over the body cell a few pixels along the swing, it reads as
     * the second blade's trail - and it is the same arc the client draws, so it is
     * per-swing, at the reference's size, and cannot disagree with the sword.
     * `dx`/`dy` are the offset along the swing that makes it its own arc.
     */
    rageArc: { row: 10, first: 0, frames: 22, dx: 7, dy: 5 },
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
        frames: 12,
        beats: [
          /* the lift: the blade comes up as he leaves the ground, and it is over
             his head by the apex at 0.29 of the cast ... */
          { frames: 3, from: 0.0, until: 0.29 },
          /* ... the coil at the top of the hop (#32-33 of 01 崩山击) ... */
          { frames: 2, from: 0.29, until: 0.35 },
          /*
           * ... the crescent, and it is the descent: the reference has the blade
           * coming down from #34 to #40 and the feet back on the floor at #41,
           * so the whole fall is this one act and the hit at 0.70s of the 1.3s
           * cast lands inside it. These three beats used to sit a full act late -
           * the crescent opened at 0.45, half way through the fall, which left
           * him swinging at the top of the hop while the reference already had
           * the blade down (owner, on the 对照图: 「按照参考」).
           */
          { frames: 2, from: 0.35, until: 0.51 },
          /* ... the lunge it lands in ... */
          { frames: 2, from: 0.51, until: 0.78 },
          /*
           * ... and the get-up: the reference rises from #51 to #55 (0.78-0.89
           * of this cast) and is back on the idle it started from at #56 (0.91),
           * so the client's own 210/211 carry him up and the pose he stands in -
           * 187, the frame this clip opens on - is what he is left holding. The
           * move used to hold the lunge for the whole last third, with the
           * reference standing over its fire.
           */
          { frames: 2, from: 0.78, until: 0.89 },
          { frames: 1, from: 0.89, until: 1.0 }
        ],
        /*
         * The apex flash. The reference paints him flat yellow for the single
         * frame just past the top of the hop (#34 of 01 崩山击, 0.400s after it
         * leaves the ground), which at its 30fps is 0.033s - two of this game's
         * frames. The cell comes off the sheet's `flare` row, his own art filled
         * with that yellow, drawn behind him and run up 1.45x about his feet:
         * the reference's ghost stands on his feet and its head reaches about
         * 310 of its client px against the 216 he is drawn at.
         *
         * The window stops at 0.35 - where the crescent takes over - rather than
         * running into it. #34 is the frame he is still holding the blade up in,
         * and the flash is a *silhouette of him*: riding the crescent cell made
         * the ghost the slash's arc instead, a yellow scythe twice his width.
         */
        flare: { from: 0.325, until: 0.35, scale: 1.45 }
      },
      /*
       * 怒气爆发 barely moves him, and that is the reference rather than an
       * omission: 08_怒气爆发 holds one braced pose for 16 of its 30fps frames
       * (#38-#53) with only the rim glow moving, settles back to the stand over
       * the next five (#54-#58), and is *already standing still* when the column
       * comes up out of the floor at #69 - the clip erupts it with no pose change
       * at all. So the clip is three acts, and the frames are the client's own:
       *
       *   body 76-79  the braced stance (client action 10's own opening)
       *   body 80-83  the settle back up
       *   body 176-177 the stand he is left in, held through the column
       *
       * The beats are what make it read: spreading ten frames evenly over the
       * 1.2s cast put a different pose on screen every 0.12s, which is a settle
       * that never settles. Here one frame takes the press, three carry the half
       * second the clip holds its stance, four do the settle and two hold the
       * stand - i.e. the changeovers are 0.00 / 0.04 / 0.50 / 0.70 against the
       * reference's own #38 / #40 / #53 / #58 (0.00, 0.06, 0.50, 0.65 of its
       * 36-frame cast). The last beat runs to the end because the clip's own last
       * changeover is #69 (0.86) and that one is not a pose at all - the column
       * erupts with the stand he is already holding.
       */
      rageBurst: {
        row: 5,
        first: 12,
        frames: 10,
        beats: [
          { frames: 1, from: 0.0, until: 0.04 },
          { frames: 3, from: 0.04, until: 0.5 },
          { frames: 4, from: 0.5, until: 0.7 },
          { frames: 2, from: 0.7, until: 1.0 }
        ]
      },
      /*
       * 十字斩 is the client's **own twenty-frame animation**, not seven picked
       * poses: `range(5, 19)` (the crouched ready, the forward sweep, and him
       * coming up into the stand) + `range(198, 204)` (the drop into the lunge
       * and the recovery). Two beats, cut where the training-room clip's own
       * act boundary is - #22-#43 (the ready, both cuts and the held 十) is 22
       * of its 34 frames, so 0.647; the lunge and the recovery are the rest.
       *
       * An earlier cut of this slice ran seven one-frame beats instead, and the
       * owner sent the 90-frame contact sheet back (2026-09-27) saying
       * 「释放少帧了，以及动作少了」: the clip's body changes every frame at 30fps,
       * ours held each of seven poses for a tenth of a second. **The trailing
       * overhead swing in 198-203 was a real complaint, but shedding frames was
       * the wrong fix for it.**
       */
      crossSlash: {
        row: 5,
        first: 22,
        frames: 20,
        beats: [
          { frames: 14, from: 0.0, until: 0.647 },
          { frames: 6, from: 0.647, until: 1.0 }
        ]
      },
      /* 血之狂暴: body action 22, the stand that flings both arms out. It opens
         `clips` again since the sheet went 47 -> 57 for 暴走's ten frames -
         before that the row filled up before this clip and it spilled into
         `clips2`. Re-read these off the bake's own print, never by hand. */
      /*
       * 血之狂暴's cast: body 159-175, the owner's own pick - he stands, puts his
       * arm out and holds it, which is the reference's second beat (07_血之狂暴
       * f64-78) and where the blood gathers in his hand. It shares those frames
       * with 嗜魂之手 on purpose; what separates the casts is the art over them,
       * not the body.
       */
      frenzy: {
        row: 5,
        first: 42,
        frames: 17,
        /*
         * **The cast is 1.4s and the motion is not spread evenly through it.**
         * In the reference he stands for the first half - the burst goes off and
         * the body turns red with his feet planted (f40-f58) - and only then does
         * the arm go out (f64-f78). Laid out flat, seventeen frames over 1.4s is
         * 12fps and the arm would creep out from the first instant, which is not
         * what the clip does. So the six near-identical standing frames hold the
         * front half and the eleven that carry the reach spend the back of it,
         * the way 崩山击 paces its wind-up against its smash.
         */
        beats: [
          { from: 0, until: 0.52, frames: 6 },
          { from: 0.52, until: 0.85, frames: 8 },
          { from: 0.85, until: 1, frames: 3 }
        ]
      },
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
        first: 0,
        frames: 7,
        beats: [
          /* the raise, held long enough to read as 举剑 - plain katana */
          { frames: 2, from: 0.0, until: 0.135 },
          /*
           * The leap and the landing carry the **blood blade**: the owner reads
           * the move's own effect as the sword going blood for the strike, and
           * the reference has him swinging it from the hop through the slam. The
           * cells come off the sheet's `bloodblade` row, which is the same
           * frames with the katana's silver pixels pushed red (see
           * assets/import_dnf_swordman.py) - so it is his sword changing, not a
           * second blade drawn beside it.
           */
          { frames: 2, from: 0.135, until: 0.285, blood: true },
          { frames: 2, from: 0.285, until: 0.6, blood: true },
          /* and the stand he comes back to: 「释放完变成原来的剑」 */
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
      silverFall: { row: 6, first: 7, frames: 8 },
      /*
       * 嗜魂之手: the client's own reach grab (body 161-177), the one move in the
       * set that is *not* a swing. The clip holds two poses - the wind-up and
       * the reach - and the four beats are the clip's own:
       *
       *   161-164  0.000-0.097  the wind-up, four frames held
       *   165-167  0.097-0.194  the hand goes out front-left
       *   168-175  0.194-0.677  the hold; this is the move
       *   176-177  0.677-1.000  the hand drops, and the burst plays over it
       *
       * The beats are uneven on purpose, the way 崩山击's are: spreading seventeen
       * frames evenly over 1.0333s puts each pose on screen for 61ms, and the
       * hold - which is 0.48s of the cast and was 0.567s in the reference - would
       * flicker past. The hold's own eight frames are near-identical (they differ
       * only in the wrist, by ~80px of a 9100px figure), so the beat is what
       * keeps the arm out there.
       */
      graspHead: {
        row: 6,
        first: 21,
        frames: 17,
        beats: [
          { frames: 4, from: 0.0, until: 0.0968 },
          { frames: 3, from: 0.0968, until: 0.1935 },
          { frames: 8, from: 0.1935, until: 0.6774 },
          { frames: 2, from: 0.6774, until: 1.0 }
        ]
      },
      /*
       * 暴走: the owner's own pick - body 80-89, the ten frames where he lifts a
       * hand up over his head (he named the range off
       * assets/dnf_src/full-frames/frames-061-121.png, 2026-10-02).
       *
       * They are paced as one act, not spread: the reference's raise is a single
       * movement that arrives at the top and holds, so four frames carry the
       * lift and six hold the pose he lands in, with the head icon lighting on
       * the changeover. 80-83 double as 怒气爆发's middle pose - the owner was
       * told and kept the range.
       */
      /*
       * 嗜魂封魔斩: the only clip whose beats are cut by the *progress of a cast
       * whose length the player chose*. That works because progress is not time
       * here - the entrance is always 0 to 0.182 of the row and the tail always
       * 0.839 to 1, whatever the hold in between was. Letting go jumps progress
       * across the middle beat, which is exactly right: the vortex stops wherever
       * it had got to and the tail starts (docs/adr/0023).
       */
      bloodyRave: {
        row: 6,
        first: 48,
        frames: 13,
        beats: [
          /* 起手闪 → 抬剑（参考 #033-#041，0.267s = 进度的 0.056）。 */
          { frames: 3, from: 0.0, until: 0.056 },
          /* 手伸到位、掌心血球凝出来（#042-#052）。 */
          { frames: 2, from: 0.056, until: 0.182 },
          /*
           * 站桩 —— 参考里那三秒身体**是不动的**（#059-#152 逐帧比 #070，差值
           * 只在漩涡透进框的噪声里），所以四帧几乎一样的姿势在四分之一秒的短按
           * 和三秒的长按里读起来一样。
           */
          { frames: 3, from: 0.182, until: 0.839 },
          /* 收势 → 转身横剑 → 举剑过头 → 拧身 → 劈穿 → 低伏（#153-#163）。 */
          { frames: 5, from: 0.839, until: 1.0 }
        ]
      },
      berserk: {
        row: 6,
        first: 38,
        frames: 10,
        beats: [
          { frames: 4, from: 0.0, until: 0.35 },
          { frames: 6, from: 0.35, until: 1.0 }
        ]
      },
      /*
       * 魔狱血刹's 起手: the client's own body 75-89, the owner's pick off the
       * labelled full-frame sheet (2026-10-05) - 75-79 rising out of a low
       * thrust, 80-89 standing with the sword brought across his body.
       *
       * 15 frames over the first **half** of the 1.0s cast (30fps, which is the
       * reference's own rate) and then the last one holds for the other half.
       * Paced as one beat rather than spread: spread over the whole second it
       * would play at 15fps and read as syrup. The one-cell stand this replaces
       * is why the owner said 「角色动作差了很多」.
       */
      hellbenter: { row: 11, first: 0, frames: 15, beats: [{ frames: 15, from: 0, until: 0.5 }] },
      /*
       * 魔狱血刹's 落: the client's own body 143-156 - 142-144 compress him down,
       * 145-156 is the low forward drive. Two beats so that the drive's first
       * frame lands **on the blow** (`SKILLS.hellbenterSlam.activeFrom` = 0.22)
       * instead of 0.07s early: the wind-up takes the first 0.22s and the twelve
       * frames of the drive take the 0.38s after it, which is 31fps - the
       * reference's own rate again.
       */
      hellbenterSlam: {
        row: 11,
        first: 15,
        frames: 14,
        /*
         * **The drive is over by 0.6s, and the rest is the hold.** The cast is 5.4s
         * (he stands in the whole eruption - see Core's `duration`), so the beats
         * stop at 0.6/5.4: he compresses for the blow at 0.22s, drives through,
         * and then the last cell is what is on screen for the next 4.8 seconds
         * while the ground burns. That is the reference exactly - #158 to #330 is
         * one pose, frame for frame, and he only stands once it has stopped.
         */
        beats: [{ frames: 2, from: 0, until: 0.22 / 5.4 }, { frames: 12, from: 0.22 / 5.4, until: 0.6 / 5.4 }]
      }
    },
    /*
     * The plain hop: the client's own jump animation (sm_body0048 126-131). It is
     * driven by how far the hop has fallen, so the crouch, the launch, the apex
     * and the landing walk in order however high the jump was.
     */
    jump: { row: 6, first: 15, frames: 6 },
    extras: { hurt: 0, dead: 1, jump: 2, fall: 3 }
  };

  /* On-screen controls for touch play, laid out in arena coordinates. */
  var TOUCH_LAYOUT = [
    /*
     * The four-way block: width and depth share one thumb, stacked the way the
     * floor reads - up goes into the screen, down comes back towards the camera -
     * so the hand learns one shape instead of four separate keys.
     */
    { action: "up", x: 22, y: 330, w: 86, h: 86, label: "↑" },
    { action: "down", x: 120, y: 330, w: 86, h: 86, label: "↓" },
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
    { action: "pause", x: 734, y: 20, w: 62, h: 44, label: "停" },
    /*
     * 魔狱血刹's key. It has no hotbar slot to sit in - all twelve are taken and
     * the bar is two rows of six - so a touch surface needs a button of its own
     * or the 一觉 is simply unreachable for anyone playing with fingers. It sits
     * above 攻, on the thumb that already does the fighting.
     */
    { action: "skill:hellbenter", x: 864, y: 330, w: 88, h: 88, label: "觉" }
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
      crossSlash: 34,
      bloodSword: 27,
      /*
       * 血之狂暴's cast row: the pack's own 血气 burst, which is the closest thing
       * the client has to the reference's spiked corona on the frame the stance
       * lands (07_血之狂暴 #44-58). The crescent that rides the swings is on an
       * extra row now, and so is the second blade.
       */
      frenzy: 13,
      /*
       * 嗜魂封魔斩 is the game's only channel, and its row is a **timeline in
       * seconds** rather than in progress: columns 0-9 are the opening (the blood
       * ball growing in his hand, then let go), columns 10-23 the tail that runs
       * from the moment the player lets go. `EFFECT.channel` says where the split
       * is and what a column is worth in seconds - reading this row by progress
       * would name a fraction of a total that does not exist until they release.
       */
      bloodyRave: 24,
      /*
       * 怒气爆发 is a staged row like 大蹦's: the pool and the burst ring own
       * columns 4-11, the quiet stretch is columns 12-29, and the column comes
       * up at 30-35. 36 columns over the 1.2s cast is one every 34ms, which is
       * what it takes to carry the ring's seven frames exactly (cols 5-11), and
       * the column's two - its mass held, then the frame it comes apart on.
       */
      rageBurst: 36,
      bloodSnatch: 19,
      graspHead: 31,
      bloodEvil: 15,
      /*
       * 大蹦 bakes a staged row: the pack is one move in several acts (the floor
       * splits, the crack field glows under the held ring, the first wave comes
       * up, the second eruption rises and dies back), and stacking every layer at
       * once put all of it on screen in the same fraction of a second. The row is
       * as long as the windows in assets/import_dnf_effects.py add up to - and at
       * 45 columns over a 4s cast it is a column every 89ms.
       */
      mountainRift: 45,
      /*
       * 暴走's row is the cast's own flash only - the icon over his head and the
       * threads round him are drawn live (drawBerserkCast / drawBerserkThreads).
       * The row is the whole `blood-start` entry (13 frames), because a picked
       * row ships its real frames rather than the four-frame sample.
       */
      berserk: 13,
      /*
       * 魔狱血刹's 火山 is not a SKILL_ORDER row: it lives on assets/rift.png at
       * `riftCell`, because its column stands five Slayer-heights tall. Its
       * length is here because this is the table `skillEffectFrame` reads a
       * row's column count from.
       */
      hellbenterSlam: 60
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
     * 血之狂暴's swings: **one** extra row here - `rage/attack01.img`, the red
     * brush fan the swipe leaves.
     *
     * The cream trail is not on this sheet. It is the client's *own* slash arc -
     * the one drawn in the weapon layer of the body's 188-209 - lifted onto its
     * own row of the **body** sheet by the bake (`rage_arc_layer`, row
     * `SPRITE.rows.ragearc`) and graded to cream. Anything built out here was a
     * second arc beside the client's and read as one shape cycling: 「好像就两个
     * 剑影不停循环，不如参考的自然」 (docs/adr/0019).
     */
    rageSlashRow: Core.SKILL_ORDER.length + 2,
    rageSlashFrames: 8,
    /*
     * **The second blade**, one row per swing direction - the pack's own
     * blood-red redraw of equipped katana 5601, drawn over the weapon's slot so
     * the swing reads as two blades. The body art never changes: there is no
     * dual-wield animation in the client to switch to (docs/adr/0017). The
     * under row carries 22 frames and the upper 19, because the bake trims each
     * row to the frames that actually have ink in them.
     */
    rageBladeUnderRow: Core.SKILL_ORDER.length + 3,
    rageBladeUnderFrames: 22,
    rageBladeUpperRow: Core.SKILL_ORDER.length + 4,
    rageBladeUpperFrames: 19,
    /* The stance's second beat: the blood gathering in his free hand. */
    rageGatherRow: Core.SKILL_ORDER.length + 5,
    rageGatherFrames: 5,
    /*
     * 嗜魂封魔斩's vortex: one churning loop of the reference's spindle, on its own
     * row because the renderer draws it **live** - several copies along the
     * caster's front, cycling on the reference's own beat - rather than as a
     * baked timeline. The cast can be held for as long as the player likes, so
     * there is no row long enough to hold it (docs/adr/0023).
     */
    vortexRow: Core.SKILL_ORDER.length + 6,
    vortexFrames: 12,
    /*
     * The blood fog that sits at his hand - the vortex's near end, which the
     * reference wears as a dim mass rather than as a loop (see the bake's note
     * and assets/dnf_effect_picks.md §26). Same twelve-frame churn as the loops,
     * drawn live for the same reason the vortex is.
     */
    mistRow: Core.SKILL_ORDER.length + 7,
    mistFrames: 12,
    /*
     * 魔狱血刹's 血气之剑: **one cell per tier**, all cut from the client's own
     * `hellbenter/sword-normal` longest frame, drawn live because the sword is up
     * for as long as the state is - fifty seconds, which no baked row could hold
     * (the same reason the vortex has a row of its own). The cell is read off
     * `player.hellbenterTier`, so the sword comes out one step longer per hit that
     * forged it.
     */
    bloodSwordRow: Core.SKILL_ORDER.length + 8,
    bloodSwordFrames: 8,
    /* The same sword gone white - the warning the last five seconds are (see
       drawBloodSword). Its own row because the bake recolours it; the renderer
       swaps rows rather than tinting a cell at run time. */
    whiteSwordRow: Core.SKILL_ORDER.length + 10,
    /*
     * **血气榨满的那一把，是金的。** The owner pointed at the reference's own
     * gold sword: 「血气汲取满了，剑应该变成这样」. The client ships that version
     * too - `sword-dodge`'s last frame is a plain gold blade - so the row is the
     * same cut-out through a gold ramp, not a second drawing (see
     * PICKS.hellbenterSwordGold).
     */
    goldSwordRow: Core.SKILL_ORDER.length + 9,
    whiteSwordFrames: 1,
    /*
     * 魔狱血刹's 血丝 - one strand of the client's own thin red thread (30 frames
     * of it). Drawn live and rotated, because a strand runs from wherever the
     * monster was to wherever he is now: a baked row could not hold a line whose
     * two ends are both moving (see drawBloodStrand).
     */
    strandRow: Core.SKILL_ORDER.length + 11,
    strandFrames: 30,
    /*
     * **A channel's row is read by elapsed seconds, not by progress.** Progress is
     * a fraction of the cast's total, and this cast has no total until the player
     * lets go - so `channel` cuts the row in two halves and says what each half is
     * worth: columns `0..entranceCols` are the opening seconds since the press,
     * `entranceCols..` the tail seconds since the release (docs/adr/0023). The
     * three numbers on the right are the reference's own (assets/dnf_effect_picks.md
     * §25) and are the same three `SKILLS.bloodyRave.channel` carries, on purpose:
     * the art and the hit beats are the same clock.
     */
    channel: {
      bloodyRave: {
        entrance: 0.867,
        hold: 3.133,
        tail: 0.767,
        entranceCols: 10,
        tailCols: 14
      }
    },
    /*
     * 嗜魂封魔斩's vortex, **drawn live** rather than played as a row.
     *
     * The reference's vortex is a spindle: a line of nested red loops, biggest at
     * the far end and closing to a point at his hand, churning for as long as he
     * holds (measured 2.8-3.0 Slayer-heights forward and 1.68 high). One frame of
     * the pack's `particle.img` is one of those loops, so the draw is `loops`
     * copies of it along the arm - not a baked composite, because the number that
     * matters (how long it runs) is the player's. `lag` is how many frames of the
     * cycle further out each loop is behind the one in front of it, which is what
     * keeps eight copies reading as one thing turning.
     */
    vortex: {
      bloodyRave: {
        /*
         * **It starts as a point at his hand and grows the whole way out.**
         *
         * Two readings of the reference were wrong before this one, and the owner
         * called both of them. The first grew the loops out but started them big
         * (70), so the vortex's near end was a full-height ring floating *above*
         * his hand - 「漩涡开始应该和角色手挨着，不要高一块」. The second read the
         * reference's top edge in 3px slices, hit the **gap between two rings** at
         * 0.7 of the length, took it for a taper, and drew a lemon - 「怎么不是
         * 漩涡了，不是越来越大」. Measured as *thickness* per decile the reference
         * is 0.18, 0.71, 0.76, 1.01, 1.20 ... at his hand, a small blob, then
         * bigger and bigger outward. Which is what a vortex is.
         */
        loops: 24,
        lag: 2,
        /*
         * **`nearX` is the asymptote, not the near end** - the innermost drawn
         * ring is `u = 1/13`, which lands at 74.4px (0.886 Slayer-heights), and
         * what actually touches his hand is the fog (below). The reference's own
         * *loops* start at about 0.8 Slayer-heights and run out to 2.85, which is
         * this span; the old comment called 64px "on his hand" off the ledger's
         * forward origin, which sat 0.20 of a Slayer-height behind the real anchor
         * (assets/dnf_effect_picks.md §26). farX 199 puts the far ink at 2.79.
         */
        nearX: 64, farX: 199,
        nearSize: 26, farSize: 128,
        /*
         * **The pack's one loop is a tall hairpin, and the reference's rings are
         * not.** Overlaying the two masks at the same scale is what showed it:
         * the reference packs *many small, wide* rings into a solid mass, so at
         * the far end they read as a coil; drawn at their own aspect a few big
         * ones stick out above and below as open arcs and the whole thing reads
         * as a tall wall standing next to him - which is what the owner saw
         * (「漩涡太高了」). So each cell is drawn **wider than it is tall**:
         * 62x110 of art in the cell at `wide` x `tall` comes out about square,
         * which is the shape the reference's rings have.
         */
        wide: 1.30, tall: 0.92,
        /*
         * 纺锤的中线压在他手的高度上。沿长度十等分量的参考中线是**一条平的**
         * 0.81 身位（0.75–0.86，94 帧平均；掌心也在 0.81）—— -73 (0.87) 比它高
         * 5px，这 5px 就是业主那句「高」里除深度 bug 之外的那一点。
         */
        midY: -68,
        /*
         * **The fog at his hand.** Centre on the measured mass (身前 0.58 身位、
         * 离地 0.76), sized to what it covers: 0.44 x 0.37 身位 of ink, which is
         * the bake's ~0.77 of a cell. `alpha` is not decoration: the reference's
         * near mass measures 88 brightness against the loops' 159, and a thin
         * stroke stays bright however small it is - dim is what makes it fog and
         * not a ball.
         */
        mist: { x: 49, y: -64, w: 48, h: 40, alpha: 0.5 },
        /* 长出来与收回去的两段：参考 #053-#059 与 #153-#156。 */
        grow: 0.2,
        close: 0.133
      }
    },
    /*
     * How many rows assets/effects.png carries past the skill rows: the orb, the
     * dive arc, the swipe's red fan, two blade halves and second beat,
     * 嗜魂封魔斩's vortex **and the fog that sits at his hand**, 魔狱血刹's sword,
     * its white warning, its 血丝, its 成形 **and the blood its blade sits in**,
     * the disc that 成形 opens with, **the red star it opens into**, and 大蹦's
     * fire. The bake test reads this rather than a literal, so adding a row
     * cannot leave the shipped atlas and the grid disagreeing.
     */
    extraRowCount: 16,
    /*
     * 大蹦 is the one move whose art is drawn far bigger than a cell can hold:
     * its own row on assets/effects.png would be ~120x72 px of art stretched
     * over ~470 px of screen. So its two halves are baked to assets/rift.png at
     * its own, larger cell, and `riftRows` says where - `back` is the half drawn
     * behind the Slayer (the broken floor he stands in, held from the landing to
     * the end), `front` the half drawn over him (the blood sword and the fire
     * that comes out of the split). Both are baked to one window off one anchor,
     * so one draw size places them on top of each other.
     */
    riftCell: 384,
    riftRows: {
      mountainRift: { back: 0, front: 1 },
      /*
       * 魔狱血刹's 火山 is one row on the same sheet, and it is drawn **behind**
       * him: the column comes up out of the floor he is standing in, and the
       * reference keeps him visible in front of it while it burns.
       */
      hellbenterSlam: { back: 2 }
    },
    /*
     * A move that draws a second row over the Slayer says how long it is.
     * 大蹦's second row is a *different* row, on its own sheet (see riftRows);
     * 崩山击's is the same six cells drawn on the other side of him, which is
     * why its draw entry also carries `front` - without that the row would be
     * painted twice, once behind him and once in front.
     */
    frontFrames: { mountainRift: 45, mountainBreaker: 6 },
    draw: {
      upSlash: { dx: 34, dy: -56, size: 156, copies: 1, spin: 0 },
      /*
       * 崩山击 lands on a shockwave that covers half the arena. The row is baked
       * with an anchor now (the foot of the fire column, which is also where the
       * spikes were moved to), so dy is a quarter of the size like 大蹦's rows:
       * that puts the impact on his feet instead of a fixed few pixels under
       * them, which is what the un-anchored row used to need.
       *
       * `size` is not a free zoom knob on this row. The spike fan is the widest
       * thing in it, so the fan is what the row's ink window is measured across
       * and its drawn width comes out as (cell - margin) / cell * `size` - the
       * fan's own `scale` cannot move it (raising it a third moved the fan 6% and
       * cost the column 20%; the measurement is written up in the bake's own
       * note). 264 is what lands the fan at the reference's 2.80 Slayer-heights,
       * where 236 left it at 2.39. The column was signed off at its own size, so
       * its `stretch` in import_dnf_effects.py is scaled by 236/264 to hold it.
       *
       * The row rides him: `ground` is deliberately *not* set here, though this
       * move carried it for two rounds. The reference's fire column opens 167
       * client px above the floor while he is still falling (#35 of 01 崩山击)
       * and its foot only meets the ground after he does (#41-42, where it
       * crosses the floor line by 14px). Pinning it to the floor stood the fire
       * up while he was still in the air, which is the opposite of the clip; on
       * the ground the two are the same point, so this only changes the airborne
       * half.
       *
       * `front` is the other half of the same reading: the reference's fire and
       * spikes are drawn *over* him, and at their peak (#44-45) he is inside the
       * burst and cannot be seen at all. So this row is skipped on the pass
       * behind him and drawn on the one in front instead (see frontFrames).
       *
       * `dx` is the third: the row's anchor is the column's foot, and the
       * reference stands that foot **in front of him, not under him**. Measured
       * against the nameplate over his head (rigid, and the only thing in the
       * clip that holds still), the fire's own centre sits +70px ahead of him as
       * he lands (#42) and +87px as the burst peaks (#45) - 0.83 and 1.03
       * Slayer-heights. With dx at 0 the whole row sat on top of him instead,
       * which is the read the owner sent back on 大蹦 once already (「火焰都靠近
       * 角色，没有在圈内」). 70 puts the column where the clip has it and leaves
       * the burst 0.2 of a Slayer-height short of its own.
       */
      mountainBreaker: { dx: 70, dy: -66, size: 264, copies: 1, spin: 0, front: true },
      /*
       * 十字斩 is **three cuts on one row**, and the row is the clip's own
       * frames - `length: 34` in the bake, **one cell per frame of
       * 02_十字斩.mp4 from his press at #22 to #55**, the last frame the merged
       * qi is still on screen. So the row is read at the clip's own place in the
       * cast and `dx`/`dy`/`size` only put the composite on him. (It was 32
       * cells over #22-#53 until the third act was measured properly: he is
       * still shrinking on #54, and the old row simply stopped two frames early.)
       *
       * **The motion of the third act lives in the baked cells, not here.** The
       * merged qi walks 0.73 of a Slayer-height forward and shrinks away before
       * it goes - that is the bake's `travel` plus the pack's own shrinking
       * frames on the `_atgorecross/shoot.img` stages, interpolated column by
       * column. It used to be one held frame for the whole last 29% of the
       * cast, which is why the owner kept saying 「往前移动，逐渐变小消失」 and
       * this row kept not doing it. `travel` on `draw` is still off and should
       * stay off: it moves the whole row, and the 十 in the first two acts does
       * **not** travel (the clip holds its bar on column 632 for #38-#44).
       *
       * Where the 十 stands was wrong twice, and the second correction is the one
       * that mattered: the clip's caster **faces left** (see the bake's `mirror`
       * paragraph and `docs/adr/0011`), so a bar at x 631 against a midline of
       * 772 is 0.65 of a Slayer-height **in front of him**, not behind. Read the
       * wrong way round it put every layer of the move on his back side, which
       * is what 「绕着他扫的镰」 was.
       *
       * `dx`/`dy`/`size` are not free numbers - they undo the bake's window, and
       * they are chosen so that **one client pixel of the row is one screen
       * pixel**. The window is (-115, -156, 265, 132) client px, so `fit_scale`
       * is 120/380 and `size` = 128 / that = 405.33; the cell then draws at
       * 405/128 = 3.164 screen px per cell px, and a client pixel lands on
       * 0.31579 * 3.164 = 0.9992 of a screen px. `dx`/`dy` are the window's own
       * middle - (75, -12) - which lands the caster's ground point on his feet.
       * The bake prints both numbers when it runs; take them from there rather
       * than from this comment.
       *
       * Why that matters: **it makes the bake's numbers the clip's numbers.** A
       * screen pixel about his feet is the unit the reference is measured in
       * (1 身位 = 84 of them), so every `stretch`/`offset` in the bake can be
       * read straight off `02_十字斩.mp4`. The window used to be 368 client px
       * wide fitted into the 128 cell, which draws the whole move at 0.693 of
       * the clip's size; each layer then had to be pre-multiplied by 1.44 to
       * come back out right, and no number in the row could be compared with
       * the clip it was supposed to be copied from. See `docs/adr/0008`.
       */
      crossSlash: {
        dx: 75,
        dy: -24,
        size: 405,
        copies: 1,
        spin: 0,
        /* He walks through the cross he drew - see `drawEffectRow`. */
        anchor: "cast"
      },
      bloodSword: { dx: 30, dy: -32, size: 182, copies: 1, spin: 0 },
      /*
       * 血之狂暴's cast. The burst goes off *around* him, not in front of him,
       * and it is body-sized: the reference's corona on the frame the stance
       * lands reaches 1.22-1.32 of his height up and 0.37-0.49 of it forward of
       * his centre line (07_血之狂暴 #47-53), which is why it is centred on his
       * middle and drawn bigger than the cell it comes from.
       */
      frenzy: { dx: 28, dy: -62, size: 130, copies: 1, spin: 0 },
      /*
       * ... and the red brush fan under it. Both this row and the crescents
       * below are one attack's art, so they are drawn at **one scale**: the
       * numbers are the reference's, not the client's (the client's own
       * animation data scales effect layers, and the export does not carry it -
       * see the bake's note). Measured off the owner's sheet, the crescent is
       * 0.93-2.02 Slayer-heights across; a swing's own art is 282-348 client px,
       * so one client px is about 0.38 of a screen px here and `size` 142 puts
       * the drawn crescent at 1.5 of his height. The pack draws the fan 113/128
       * of the way across its cell, which is 1.49 x 0.81 Slayer-heights.
       */
      rageSlash: { dx: 26, dy: -26, size: 142, copies: 1, spin: 0 },
      /*
       * **The crescent.** Placed and sized off the owner's contact sheet, the
       * same way the fan above is - the pack's swings are 113/128 of their cell
       * across, so one `size` holds both rows to one scale.
       *
       * Where it sits was measured on three separate swings (d037/d040/d046):
       * its centre is **0.44 of a Slayer-height in front of his centre line and
       * 0.47 of one above his feet** - his middle, not his chest. At our 84px
       * Slayer that is dx 37, dy -39. It used to sit on his centre line at 0.36
       * up, which reads as the arc hanging off his own middle instead of
       * sweeping past it.
       *
       * `stretchX` is 1: the first pass squeezed a 128-cell into 175x95 to make
       * the arc wide, on the strength of a reading (0.89-1.15 Slayer-heights
       * across) taken from the reference's *smaller* frames. Re-measured over
       * every crescent on that sheet, the arc is 0.93-2.02 across by 0.28-0.91
       * tall, and the pack's own swing art is already 2.1 to 3.0 wide; nothing
       * needs stretching (docs/adr/0019).
       */
      /*
       * **The second blade sits on the weapon.** It is the pack's own blood-red
       * redraw of the equipped katana - the same sword, the same hand - so this
       * offset is where that katana is in the *body* cell, and the row is baked
       * centred on its own ink like every other effect row. The `trail` copy is
       * the after-image the swing leaves, which is the owner's own read of the
       * reference ("sword + red after-image", d050).
       *
       * This was moved to the caster's ground point for a round, to put the blade
       * in his *other* hand: it floated. The blood-sword art is drawn against the
       * normal attack's frames (0-22), not against the 188-209 the stance swings
       * with, so a table of per-frame offsets measured off 188-209 put it in the
       * air (docs/adr/0019).
       */
      rageBlade: {
        dx: 18,
        dy: -28,
        size: 98,
        trail: [-30, 10]
      },
      /*
     * 嗜魂封魔斩's own row. The bake anchors it on the caster's own feet, and a
     * cell drawn at `size` puts that anchor at `size / 4` below its middle - so
     * `dx: 0, dy: -size / 4` is what lands the ball on his hand. `size` is the
     * 1:1 number the bake prints for the row's window.
     */
    /*
     * window 于 2026-10-05 加宽到 480（收尾那一叉原先被裁掉一截），fit 因此由 0.2243
     * 变成 0.25 cell px / 客户端px —— `size` = CELL / fit = 512，`dy` = -size/4（锚点在
     * 脚下），1 客户端px 与改窗口前一样是 1 屏幕px。
     */
    bloodyRave: { dx: 0, dy: -180, size: 720, copies: 1, spin: 0 },
      /*
       * 怒气爆发 erupts around him, and its two acts are drawn at the sizes the
       * training room shows: the row's window is 331 x 488 client px, so one
       * client pixel is 0.2459 of a cell pixel and `size` 317 draws the burst
       * ring 2.18 x 0.83 Slayer-heights and the column 1.71 x 3.07 - against the
       * clip's 2.17 x 0.85 and 1.77 x 2.99, every one inside 4%. The row is baked
       * with the caster's ground point on the cell's ground line (75% down), so
       * `dy = -size / 4` puts the ring on his feet rather than his knees.
       */
      rageBurst: { dx: 0, dy: -79, size: 317, copies: 1, spin: 0 },
      bloodSnatch: { dx: 56, dy: -46, size: 190, copies: 1, spin: 0 },
      /*
       * 嗜魂之手's window is 310 x 213 client px around the caster's own ground
       * point, so one client px is 0.3871 of a cell px and `size` 330.67 draws it
       * 1:1 - the same ruler the character is drawn on, which is what puts the
       * blood spray at the size the clip draws it. Anchored like 大蹦's rows, so
       * `dy = -size / 4` puts his ground point on his feet.
       *
       * The window is wider than the effect needs (the ink is 154 client px of
       * it) because **this move only ever draws in front of him**: the anchor is
       * the caster's feet, and the baker centres the anchor in the cell, so a
       * window that merely hugged the ink would push all of it off the cell's
       * left edge. `scale <= 64 / |ink_x0|` is the rule; 310 wide keeps it at
       * 0.3871 against a limit of 0.410.
       */
      graspHead: { dx: 0, dy: -82.67, size: 330.67, copies: 1, spin: 0 },
      bloodEvil: { dx: 44, dy: -30, size: 178, copies: 1, spin: 0 },
      /*
       * 大蹦 is the ultimate, and its art is the training-room reference's: the
       * broken rock field runs forward from the caster's own feet (its middle
       * 170px out, where the blade lands) and the fire stands along it, never
       * behind him.
       *
       * Its two rows are baked to one declared window - 840 client px wide - and
       * both are read off assets/rift.png, so `size` is the whole zoom for the
       * pair: 840 * 0.596 = 501, i.e. one client pixel of the pack lands on
       * 0.596 of a screen pixel, which is what draws the pack's 445px floor as
       * the reference's 265px gash. Both rows carry the caster's ground point on
       * the cell's ground line, so `dy = -size / 4` puts that point on his feet
       * and the two halves cannot drift apart. `ground` pins them to the floor
       * line while he is still leaping: the gash opens on the ground he is
       * coming down to, not on his boots.
       */
      mountainRift: { dx: 0, dy: -125, size: 501, copies: 1, spin: 0, ground: true },
      /*
       * 暴走's cast flash, off the client's own burst: a one-off bloom around his
       * head and shoulders, not a shape on the floor. `dy` lifts it to his head
       * rather than leaving it at his feet, which is where the row is rooted by
       * default.
       */
      berserk: { dx: 0, dy: -46, size: 130, copies: 1, spin: 0 },
      /*
       * **魔狱血刹's 火山**, on the big-cell sheet the way 大蹦's two rows are.
       *
       * `size` is the *character's* own scale, not 大蹦's: the bake fits its
       * window (452x903 client px) into the 384 cell, so a drawn size of 614 puts
       * one client pixel at 84/123.5 of a screen pixel - the same ratio every
       * other piece of art in this game is drawn at. The column comes out 2.2
       * Slayer-heights across and five tall, which is the reference's own
       * eruption (2.6-3.0 across, and clipped by the top of the screen).
       *
       * `dy` is `-size / 4`, the same convention 大蹦's rows use: the row is
       * anchored on the caster's feet, and the bake puts that point on the
       * cell's 0.75 line. And `ground: true` is what makes it a volcano rather
       * than a thing that follows him - the floor is what erupts, so the art
       * belongs to the spot, not to the man who opened it (docs/adr/0002).
       *
       * **`size` is not free, and it was 14% too big.** `fit_scale` is the whole
       * zoom of a row: a client pixel lands on `fit_scale(window, cell) * size /
       * cell` of the screen, and the pack's own scale is fixed by the Slayer -
       * **141 client pixels to a 身位, i.e. 0.596 of a screen pixel** (=
       * `RIFT_CLIENT_PX`). So `size` has to be `RIFT_CLIENT_PX * cell /
       * fit_scale(...)`, which the bake prints on every run. The 670x1150 window
       * gave 685 and this row drew at 782 - so the column came out 2.9 身位 wide
       * where the reference's is 2.77, and everything placed by hand in the bake
       * was scaled with it. The window is 700x1080 now (fit_scale 0.35556) and
       * the printed size is 643.7.
       */
      hellbenterSlam: {
        dx: 0,
        dy: -160.9,
        size: 643.7,
        copies: 1,
        spin: 0,
        ground: true,
        /*
         * **Not additive, and the measurement is why.** 补记三 turned it on when
         * the eruption was three stacked lava domes, which needed the addition to
         * read as one mass. The row is one column now, and additive over *our*
         * floor is not free: the floor is purple, so it puts its own blue into
         * every pixel of the column. Measured against the reference's own
         * eruption (11_魔狱血刹 #230-#260, 190k pixels): the reference's body is
         * (246, 219, 33) and the additive draw came out (213, 190, 83) - the same
         * shape 55 units bluer than the clip, i.e. pale. The reference's floor is
         * black, so for the client additive *is* the flat colour; for us it is
         * flat colour plus floor.
         *
         * `glow` puts the light back without the wash: the cell is drawn flat and
         * then again with `lighter` at 0.14. Measured both ways against the clip
         * (`#230-#260`): body / core-blue come out **33 / 116** at 0.14 where the
         * clip has **30 / 129** - the flat pass alone gives 27 / 70 and the
         * additive one alone 88 / 138.
         *
         * **0.30 without a blur was tried and put back.** The column read pale
         * and washed at that fraction - a uniformly lit slab - and it bought
         * almost nothing (212,176,29 against 210,170,26). A plain additive pass
         * cannot make a core: it scales the art's own bright and dark by the same
         * factor, so the veins come up with the mass. `glowBlur` is what turns it
         * into bloom, and bloom is what the reference actually has - see the note
         * in drawEffectRow and `VOLCANO_RAMP` for the colour.
         */
        blend: "source-over",
        glow: 0.10,
        glowBlur: 6
      }
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
       * 火山 is a **field's** row, and a field's progress is its own five seconds
       * (Core's `spawnField`), not the 0.6s cast it came out of: the default
       * window is derived from `activeFrom`, which would open the eruption at a
       * third of the way in and shut it before the column exists.
       *
       * `cast` is the other half of that thought - **the caster's own beat is not
       * the field's clock**. He shows the first eight columns of the row (the
       * plunge, the two crescents, the gold burst, the crack starting to open)
       * from the press until the ground opens at 0.6s, and the field picks the
       * row up at column 8 (`SKILLS.hellbenterSlam.field.from = 8/59`).
       *
       * **`from` is 0, not the blow at 0.22s.** The row's first beat is the
       * *plunge* - the reference's `11_魔狱血刹` #146-#153, the white blade already
       * in the floor with the claw closed over him - and in the reference that
       * beat is over **before** the blow lands (#158 is where the giant crescent
       * sweeps in). Started at 0.22 it would play after the damage, which is the
       * wrong way round; started at 0 the eight columns are the cast's own 0.6s,
       * 0.075s each, and the blow falls in column 2 exactly the way the bake's
       * stage windows are written (see `PICKS.hellbenterSlam`).
       */
      hellbenterSlam: { from: 0, to: 1, cast: { from: 0, to: 0.6 / 5.4, frames: 8 } },
      /*
       * 血之狂暴's burst is a *window* in a 1.4s cast, not a wash over all of it:
       * the reference's corona is f45-f58, which is 0.10s to 0.60s of a ceremony
       * that starts at f40 - so it opens just after the body goes red and is gone
       * by the time the arm starts to move.
       */
      frenzy: { from: 0.07, to: 0.45 },
      /*
       * 怒气爆发 opens on its own first frame and runs to its last. Neither end
       * is where the default window would put it: that one is derived from
       * `activeFrom`, which for this move is the ring's peak at 0.17s of 1.2 - so
       * it would open a tenth of the way in and throw away the pool that blooms
       * under him before the burst, and close at 0.96 with the column's last
       * frame still to come. `to` is 0.99 rather than 1 for the same reason 大蹦's
       * is: progress reaches exactly 1 only on the frame the cast is already over,
       * and 0.99 still lands the row's last column (0.96 of the way through it).
       */
      rageBurst: { from: 0, to: 0.99 },
      /* 嗜魂之手 draws for the whole cast, like 大蹦: the row's 31 columns
         are the reference's own 31 frames, and its first one is the wind-up. */
      graspHead: { from: 0, to: 1 },
      /*
       * 崩山击's landing art opens as he comes down, not on the press. The
       * reference erupts the fire column at #35 - six of its 30fps frames, i.e.
       * 0.200s, before touchdown at #41 - and the spikes spread as he lands; the
       * default window (a fraction of activeFrom) opened it while the hop was
       * still climbing, and 0.58 opened it on the hit alone. 0.38 is that 0.200s
       * before the landing at 0.70s of the 1.3s cast, and it lands him where the
       * reference has him when the fire appears: 69px up, against its 64px, so
       * the column opens on the same patch of air. The row runs out over the
       * recovery, the way the clip's spikes do.
       */
      mountainBreaker: { from: 0.38, to: 0.95 },
      /*
       * 十字斩's row is the clip's own 34 frames, so it opens at the cast's own
       * start rather than at a fraction of `activeFrom`: the row's first four
       * cells are blank because the clip's first four frames are (#22-#25, the
       * ready crouch, before the blade moves).
       *
       * **`to` is 1, and here that is exact rather than convenient.** The cast
       * is 34 clip frames long, the row is 34 cells, so `col = floor(progress *
       * 34)` is `clip frame - 22` with no rounding left over - the property
       * `0008` asks for, and the reason a stage in the bake can be written as
       * `ref(44)` and land on column 22.
       */
      crossSlash: { from: 0, to: 1 }
    },
    /*
     * How a row dies down, per skill. The default (0.75 -> 1, down to 0.3 of
     * full strength) is right for a move whose last act is its quietest; 大蹦
     * ends on its second eruption, which is its tallest, so its row holds full
     * strength until the fire is actually going out (the reference's last three
     * frames) and only then drops.
     *
     * The floor is what the row has come down to by the last frame, and 大蹦's is
     * nearly full: its ground outlives the cast - the reference's own ground
     * measures (86,26,18) on its last frames against (117,49,38) at the quiet
     * stretch, and that is its *brightness* while the lit web is at its widest -
     * and the rift is handed to a field at that moment (see Core's spawnField),
     * so a low floor here is a rift that arrives dim and fades out from there.
     * It was 0.75, which read as the web going out; holding it near full and
     * keeping the fade on the last eighth is what the reference's own outro does.
     */
    fade: {
      mountainRift: { from: 0.92, to: 1, floor: 0.95 },
      /*
       * 火山's own last act is the smoke, and the row is already drawing it
       * faint: the default (from 0.75) would start dimming the *column* while it
       * is still at full height, three quarters of the way through the eruption.
       *
       * **It was 0.93, and that was cutting the wrong thing.** The reference's
       * last second is two bright acts, not a dying one - a screen-filling
       * white-out at #303-#313 (23% of the play area near-white) and then the
       * violet cloud it cools into, #314-#320 (33% at its peak). At 0.93 the
       * white-out came in at 0.93 of full strength and the violet at 0.40 of it,
       * which is the opposite of what the clip does. The row is now only dimmed
       * in its last fortieth, where the field's own `fade` is already taking it
       * out (`Core.fieldProgress`).
       */
      hellbenterSlam: { from: 0.975, to: 1, floor: 0.65 },
      /*
       * 怒气爆发's last act is its biggest one too - the column is the whole
       * point of the move and it arrives at 0.86 of the cast. The default fade
       * (from 0.75) would draw it at two thirds strength from the frame it
       * appears. It does go out on its own: the pack's own last frames lose their
       * footing, and the clip's do the same at #73.
       */
      rageBurst: { from: 0.93, to: 1, floor: 0.85 },
      graspHead: { from: 0.94, to: 1, floor: 0.35 },
      /*
       * 十字斩's biggest act is its last one too - the merged qi, which arrives
       * at #44 of the clip (0.65 of the cast) and is still at full strength at
       * #50. The default (from 0.75) would start dimming it as it opens.
       *
       * **The fade is the last of the three things that take it away.** The
       * clip loses that qi three ways at once: the bake shrinks it to 0.28 of
       * itself, the clip's own outro goes dark (#53 on), and it is gone by #56.
       * Shrinking alone still leaves a bright 33px blob sitting on screen for
       * the last frame, so the fade is what actually lands 「消失」 - and it
       * starts on #54, which is 0.94 of this cast.
       */
      crossSlash: { from: 0.94, to: 1, floor: 0.2 }
    },
  };

  /*
   * **十字斩第三拍那只翼 —— 画出来的，参数全部由参考的列剖面解出。**
   *
   * 包里有 `gcm_slash.img`（形状对：一团实心羽体 + 一排放射羽丝），但它**太细**：
   * 逐列量它的 alpha，羽丝厚 7.5 原生px，按这一拍该有的尺寸（`scale 0.412`）折下来
   * 只有 **3.1 客户端px**，f8 之后掉到 0.8–0.4px；而**参考 #46–#49 的羽丝是
   * 4.6–7.7 客户端px**、约二十道、整只翼的实心度 **25%**。0.4–3px 的丝画成 140px 宽的
   * 翼必然糊成一团——这就是上一版读起来"光滑"的原因，不是缩放没调对。
   *
   * 所以这一层照**量到的三个数**画：羽丝 **6–8px**、**n 20** 道、整只 **140 x 138px**、
   * 实心度盯着 **25%**。业主 2026-09-27 选的这条路（「照量到的数重画一只」）。
   * **改这几个数之前先把参考和成品各自的列剖面重跑一遍**，别再凭眼睛调。
   *
   * `origin` 是这一行的窗口中心取负（客户端坐标 → 本行局部坐标）；
   * `mirror` 与烘焙那一行同一件事（参考片里的他朝左，见 `docs/adr/0011`）。
   */
  var CROSS_WING = {
    origin: [-50, -55],
    /*
     * **不要再翻一次。** 这一层的 `bx`/`by` 是**手写在"他朝右"的世界坐标里**的
     * （与烘焙那一行的 `offset` 不同：那些是照参考片量的、要过 `mirror` 那一层）。
     * 上一版带了 `mirror: true`，等于把已经写对的方向又翻回去、整只翼跑到他身后。
     */
    mirror: false,
    from: 0.710,
    to: 1.0,
    color: "#f0001c",          // gorecross_cross.img 自己的核心色 (240,0,28)
    /*
     * `bx`/`by` 是**客户端px、以他的脚为原点**（见上面那段）：
     * 参考 #46–#49 那只翼从地面起、往前铺到 身前 +1.6 身位（+134px），
     * 所以羽体的中心在 (+40, -58)、羽丝往上打到脚上方约 150px。
     */
    keys: [
      { at: 0.72, bx: 44, by: -46, bw: 44, bh: 62, n: 18, a0: -112, a1: -16,
        len: 96, w: 7.2, bend: 12, taper: 0.45, tailA: 70, tailLen: 54, tailW: 6.0 },
      { at: 0.82, bx: 48, by: -58, bw: 52, bh: 74, n: 20, a0: -116, a1: -14,
        len: 108, w: 7.4, bend: 10, taper: 0.45, tailA: 66, tailLen: 60, tailW: 6.5 },
      { at: 0.92, bx: 50, by: -58, bw: 50, bh: 72, n: 18, a0: -116, a1: -16,
        len: 100, w: 7.0, bend: 8, taper: 0.45, tailA: 64, tailLen: 56, tailW: 6.0 },
      { at: 1.0, bx: 48, by: -54, bw: 36, bh: 54, n: 14, a0: -114, a1: -20,
        len: 70, w: 6.2, bend: 8, taper: 0.5, tailA: 64, tailLen: 36, tailW: 5.0 }
    ]
  };

  /* Short DNF-style effect tags shown in the loadout panel. */
  var EFFECT_LABEL = {
    upSlash: "浮空",
    mountainBreaker: "跳劈 · 倒地",
    crossSlash: "十字 · 出血",
    bloodSword: "血气 · 三连",
    frenzy: "双刀 · 攻速",
    bloodyRave: "噬魂 · 吸附",
    rageBurst: "范围爆发",
    bloodSnatch: "嗜血 · 血波",
    graspHead: "抓取 · 吸血",
    bloodEvil: "血魔 · 突进",
    mountainRift: "跃斩 · 裂地",
    /*
     * 暴走's own three, heaviest first - the loadout panel is where a player
     * decides whether to equip it, and since the numbers went up it is the
     * attack power that carries the move, not the two speeds it used to name.
     */
    berserk: "暴走 · 攻击移速"
  };

  /**
   * Which effect frame belongs to a skill at a given cast progress (0..1).
   *
   * `row` and `frames` override where the art is read from, for the moves that
   * ship a second row; left out, the skill's own row and its own length are used.
   */
  function skillEffectFrame(skillId, progress, row, frames, timingOverride) {
    var spec = Core.SKILLS[skillId];
    var draw = EFFECT.draw[skillId];
    if (!spec || !draw) return null;
    if (row === undefined || row === null) row = Core.SKILL_ORDER.indexOf(skillId);
    if (row === -1) return null;
    var from = (spec.activeFrom / spec.duration) * 0.8;
    var to = Math.min(0.98, (spec.activeTo + 0.12) / spec.duration);
    /*
     * A move can pin its own window: 大蹦's art starts on the landing. And a move
     * whose row belongs to a **field** can pin a second, narrower one for the
     * caster's own draw - see `timing.cast` and drawEffectRow.
     */
    var timing = timingOverride || (EFFECT.timing && EFFECT.timing[skillId]);
    if (timing) {
      from = timing.from;
      to = timing.to;
    }
    /*
     * The window is half-open: `[from, to)`. `to` is where the move is over, and
     * on that frame there is nothing left to draw - which matters for a row
     * whose `to` is exactly 1 (十字斩's, because its 34 cells are the clip's own
     * 34 frames and the last of them is the last frame the art is on screen).
     * Read as `progress > to` that row drew one frame of itself after the cast
     * had ended.
     */
    if (progress < from || progress >= to) return null;
    var local = Math.min(1, (progress - from) / Math.max(0.0001, to - from));
    if (frames === undefined || frames === null) frames = EFFECT.rowFrames[skillId] || 4;
    /*
     * ...and a window can say it covers only the **first n columns** of the row.
     * A field's row is sixty columns long and its caster's own window is a
     * fraction of a second; without this the window would still walk all sixty
     * (a window is a *mapping*, so what it shows is always the whole row unless
     * it is told how much of it to show).
     */
    if (timing && timing.frames) frames = timing.frames;
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

  /**
   * Which cell of a channel's row is on screen, `elapsed` seconds after the press.
   *
   * Two clocks, because the cast has two halves and only one of them belongs to
   * the player. Before the release the tail has no position at all, so the second
   * half is only ever asked for once there is a release to measure from.
   */
  function channelFrame(skillId, elapsed, releasedAt) {
    var channel = EFFECT.channel[skillId];
    if (releasedAt === null || releasedAt === undefined) {
      var head = Math.min(1, Math.max(0, elapsed / channel.entrance));
      return {
        row: Core.SKILL_ORDER.indexOf(skillId),
        col: Math.min(channel.entranceCols - 1, Math.floor(head * channel.entranceCols)),
        alpha: 1
      };
    }
    var tail = Math.min(1, Math.max(0, (elapsed - releasedAt) / channel.tail));
    return {
      row: Core.SKILL_ORDER.indexOf(skillId),
      col:
        channel.entranceCols +
        Math.min(channel.tailCols - 1, Math.floor(tail * channel.tailCols)),
      alpha: 1
    };
  }

  /**
   * 嗜魂封魔斩's vortex - the one effect in the game that is not a baked row.
   *
   * It is a line of the pack's one loop, laid along his arm and cycled on the
   * reference's own beat, so the same draw covers a quarter-second tap and a full
   * three-second hold. It grows out over `grow` seconds and collapses back over
   * `close`, both of which are the reference's own two beats (#053-#059 and
   * #153-#156) - the collapse runs from the release, which is the one thing here
   * the reference has no frame for because its cast was never let go of early.
   */
  function drawBloodVortex(ctx, state, sprites, player, elapsed) {
    var spec = EFFECT.vortex.bloodyRave;
    var channel = EFFECT.channel.bloodyRave;
    var local = elapsed - channel.entrance;
    if (local < 0 || !sprites.effects) return;
    var grown = Math.min(1, local / spec.grow);
    var released = player.channelReleasedAt;
    if (released !== null && released !== undefined) {
      grown = Math.min(grown, Math.max(0, 1 - (elapsed - released) / spec.close));
    }
    if (grown <= 0) return;
    /*
     * **The churn is a clock, not the damage beat.** This used to advance the art
     * on `channel.tick` - 0.300s, the vortex's *hit* beat - so the whole thing
     * stood still for 0.29 of every 0.3 seconds and then jumped on one frame: 3.3
     * pictures a second. The owner, playing it: 「我觉得现在的漩涡不如参考的漩涡丝滑」.
     *
     * The reference animates on every frame it has. Over #088-#100 every
     * neighbouring pair of its 30fps frames differs by ~15-19 (mean abs over the
     * vortex's box) and frames a whole period apart (9 of them = 0.300s) by ~4-13 -
     * so its 0.300s is the *period* of the churn, and the pack's twelve phases are
     * one turn of it, i.e. 40 pictures a second. `churn` is that many turns since
     * the vortex opened.
     */
    var churn = local / Core.SKILLS[player.skillId].channel.tick;
    ctx.save();
    /*
     * **On his feet, lifted once.** `feetY()` already carries the depth lift, so
     * subtracting `depthLift` again here lifted the whole vortex a second time -
     * z * 0.22 px, which is 1.05 Slayer-heights of float at the back of the band
     * (z = 400) and about 0.4 where the owner was standing when he sent the
     * screenshot. That is the whole of 「高于手」: the art was level with his hand
     * all along *at z = 0*, which is the depth every capture-effect run uses by
     * default - so four rounds of measuring kept signing the vortex off while it
     * visibly floated away from him in play. The body is drawn at `feetY(player)`
     * (drawPlayer), and now this is too, so the two cannot disagree at any depth.
     */
    ctx.translate(player.x, feetY(player));
    ctx.scale(player.facing, 1);
    ctx.imageSmoothingEnabled = true;
    /*
     * The fog first: it is the mass the loops come out of, and drawing it over
     * them would put a red haze on the one part of the vortex that has to stay
     * crisp. It fades with `grown` so it arrives and leaves with the cone.
     */
    if (spec.mist) {
      var mistFrame =
        ((Math.floor(churn * EFFECT.mistFrames) % EFFECT.mistFrames) + EFFECT.mistFrames) % EFFECT.mistFrames;
      ctx.globalAlpha = spec.mist.alpha * grown;
      ctx.drawImage(
        sprites.effects,
        mistFrame * EFFECT.cell,
        EFFECT.mistRow * EFFECT.cell,
        EFFECT.cell,
        EFFECT.cell,
        spec.mist.x - spec.mist.w / 2,
        spec.mist.y - spec.mist.h / 2,
        spec.mist.w,
        spec.mist.h
      );
      ctx.globalAlpha = 1;
    }
    for (var loop = 0; loop < spec.loops; loop += 1) {
      var u = (loop + 1) / spec.loops;
      if (u > grown + 0.001) break;
      var size = spec.nearSize + (spec.farSize - spec.nearSize) * u;
      var x = spec.nearX + (spec.farX - spec.nearX) * u;
      var w = size * spec.wide;
      var h = size * spec.tall;
      var col =
        ((Math.floor(churn * EFFECT.vortexFrames) + loop * spec.lag) % EFFECT.vortexFrames +
          EFFECT.vortexFrames) %
        EFFECT.vortexFrames;
      ctx.drawImage(
        sprites.effects,
        col * EFFECT.cell,
        EFFECT.vortexRow * EFFECT.cell,
        EFFECT.cell,
        EFFECT.cell,
        x - w / 2,
        spec.midY - h / 2,
        w,
        h
      );
    }
    ctx.restore();
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

  /*
   * Where a body's feet land on screen. Depth is the only thing that moves a
   * point off its world `y`: standing further back on the floor draws higher up,
   * by the one foreshortening constant. Every site that places a body or a
   * floor effect goes through these two, so `z` stays a property of the world
   * instead of becoming a second set of coordinates to keep in step.
   */
  function feetY(body) {
    return body.y - Core.depthLift(body.z);
  }

  /** The same spot, for something that is flat on the floor and has no `y`. */
  function floorY(z) {
    return ARENA.groundY - Core.depthLift(z);
  }

  function drawBackdrop(ctx, state) {
    /*
     * Built outwards from the floor band, because the band is what everything
     * in the room is placed against: the wall stops at its far edge, and the
     * strip in front of the ground line is a skirt nothing ever stands on.
     */
    var band = state.band || Core.BAND;
    var backY = band.backY;

    var sky = ctx.createLinearGradient(0, 0, 0, backY);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(0.55, PALETTE.skyMid);
    sky.addColorStop(1, PALETTE.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ARENA.width, backY);

    /* far arches, slowly drifting */
    var drift = -((state.time * 6) % 240);
    ctx.fillStyle = PALETTE.wallFar;
    ctx.fillRect(0, 40, ARENA.width, backY - 40);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#0b1120";
    for (var i = -1; i < 6; i += 1) {
      var ax = drift + i * 240;
      ctx.beginPath();
      ctx.moveTo(ax + 30, backY);
      ctx.lineTo(ax + 30, 150);
      ctx.quadraticCurveTo(ax + 90, 90, ax + 150, 150);
      ctx.lineTo(ax + 150, backY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* near wall bricks */
    ctx.strokeStyle = "rgba(120, 150, 210, 0.07)";
    ctx.lineWidth = 1;
    for (var row = 0; row < 9; row += 1) {
      var y = 120 + row * 38;
      if (y > backY) break;
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

    /*
     * Torches, hung on the wall a fixed height above where it meets the floor,
     * so a room with a floor of its own keeps its torches on its own wall. At
     * the default band that height is the 250 they have always been at.
     */
    var torchY = backY - 60;
    [180, 480, 780].forEach(function (tx, index) {
      var flicker = 0.72 + 0.28 * Math.sin(state.time * 9 + index * 2.1);
      var glow = ctx.createRadialGradient(tx, torchY, 4, tx, torchY, 130 * flicker);
      glow.addColorStop(0, "rgba(255, 176, 92, 0.34)");
      glow.addColorStop(1, "rgba(255, 150, 60, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tx, torchY, 130 * flicker, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a2b1f";
      ctx.fillRect(tx - 3, torchY, 6, 34);
      ctx.fillStyle = "#ffcf7a";
      ctx.beginPath();
      ctx.ellipse(tx, torchY - 4, 6 * flicker, 11 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    /* The band: the floor they walk on, running back to the wall. */
    var recede = ctx.createLinearGradient(0, backY, 0, ARENA.groundY);
    recede.addColorStop(0, PALETTE.bandBack);
    recede.addColorStop(1, PALETTE.floorTop);
    ctx.fillStyle = recede;
    ctx.fillRect(0, backY, ARENA.width, ARENA.groundY - backY);
    /*
     * Board seams placed by the square of how far back they are, so the gaps
     * open up towards the viewer. Even spacing is the one thing that would make
     * this strip read as a wall with lines drawn on it instead of a floor going
     * away from the camera, and it is the whole of the depth cue a 12.7-degree
     * camera gets: the projection has no horizontal convergence to offer.
     */
    ctx.strokeStyle = PALETTE.floorLine;
    ctx.lineWidth = 1;
    var seams = 5;
    for (var seam = 0; seam <= seams; seam += 1) {
      var far = seam / seams;
      var seamY = backY + (ARENA.groundY - backY) * far * far;
      ctx.beginPath();
      ctx.moveTo(0, seamY);
      ctx.lineTo(ARENA.width, seamY);
      ctx.stroke();
    }

    /* the skirt: floor in front of the band, which nothing is ever placed on */
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
    /* The front edge of the band: the one line everyone's feet stand on. */
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
      ctx.translate(hazard.x, floorY(hazard.z));
      ctx.strokeStyle =
        stage === "dormant" ? "rgba(120, 150, 190, 0.34)" : "rgba(255, 152, 110, 0.9)";
      ctx.lineWidth = stage === "collapsing" ? 3.5 : 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, hazard.radius, hazard.radius * DEPTH.scale, 0, 0, Math.PI * 2);
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
    /*
     * **The stance swings differently, and the client is explicit about it.**
     * The body's own animation for these attacks is 188-209 (the owner named the
     * frames): he opens with the blade low, sweeps, raises it over his head and
     * puts the last one through - one animation over the three presses. The
     * columns come off `rageComboLocal`, so the chain walks the whole thing once
     * and the blood sword stays in his hand while it does.
     */
    if (
      player.onGround &&
      player.skillTimer <= 0 &&
      (player.attackTimer > 0 || (player.attackCooldown > 0 && player.comboTimer > 0)) &&
      player.buffs &&
      player.buffs.bloodRage > 0
    ) {
      var rageAt = rageComboLocal(player);
      if (rageAt >= 0) {
        var rage = SPRITE.rageSwing;
        return {
          row: rage.row,
          col: rage.first + Math.min(rage.frames - 1, Math.floor(rageAt * rage.frames))
        };
      }
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
          /*
           * A beat can swap in the blood-bladed copy of the same cell - the
           * columns line up because both rows are baked from the clip's own
           * frames, so this is a row swap rather than a second thing to aim.
           */
          if (clip.beats[beatIndex] && clip.beats[beatIndex].blood) {
            return { row: SPRITE.rows.bloodblade, col: clip.first + step };
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
    /*
     * Walking in depth counts as running. He is running, just not across the
     * screen, and the stand would read as a slide - the client plays the same
     * cycle for it.
     */
    if (Math.abs(player.vx) > 8 || Math.abs(player.vz || 0) > 8) {
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
    ctx.translate(player.x, feetY(player));
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

  /**
   * The clip's own apex flash, if one is due - see 崩山击's `flare` in skillClips.
   *
   * It is declared on the clip rather than here because it only means anything
   * on the clip's own clock, so it travels with the frames it paints and moves
   * with the beats if they move.
   */
  function flareFlash(player) {
    var clip = player.skillTimer > 0 ? SPRITE.skillClips[player.skillId] : null;
    if (!clip || !clip.flare) return null;
    var skill = Core.SKILLS[player.skillId];
    if (!skill || !skill.duration) return null;
    var progress = 1 - player.skillTimer / skill.duration;
    if (progress < clip.flare.from || progress >= clip.flare.until) return null;
    return clip.flare;
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
    ctx.ellipse(player.x, floorY(player.z) + 3, shadowW, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /*
     * The red sheet, for the stance and for **one move of its own**: 魔狱血刹's
     * 落. In the reference the frame the sword goes into the ground is a red
     * silhouette of him - not the demon, just him washed out to blood - and the
     * same tint that draws the stance is exactly that read (docs/adr/0025).
     */
    var raging =
      !!(player.buffs && player.buffs.bloodRage > 0) || player.skillId === "hellbenterSlam";

    var image = sprites && sprites.slayer;
    if (!image || !image.width) {
      drawFallbackPlayer(ctx, state, player);
      drawBerserkThreads(ctx, state, player);
      drawBerserkCast(ctx, state, player, sprites);
      return;
    }
    var frame = playerFrame(state, player);
    /*
     * The apex flash goes down first so it sits behind him, and off the plain
     * sheet rather than the raging one: it is a flash of light, and the stance
     * tinting it would only make two reds.
     */
    var flare = flareFlash(player);
    if (flare) {
      drawSpriteFrame(ctx, image, frame.col, SPRITE.rows.flare, player.x, feetY(player),
                      player.facing < 0, flare.scale);
    }
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
    drawSpriteFrame(ctx, body, frame.col, frame.row, player.x, feetY(player), player.facing < 0);
    /*
     * **The second sword's cream trail, and it is the client's own arc.** The body
     * sheet carries the client's slash arc alone on its own row (`ragearc`), one
     * column per instant of 188-209; drawing it over the body cell, a few pixels
     * along the swing, is that arc again in cream - so it varies from swing to
     * swing the way the reference's does, instead of being one shape cycling
     * (docs/adr/0019).
     */
    if (player.buffs && player.buffs.bloodRage > 0 && player.attackTimer > 0) {
      var arc = SPRITE.rageArc;
      var arcAt = rageComboLocal(player);
      if (arcAt >= 0) {
        drawSpriteFrame(
          ctx,
          sprites.slayer,
          arc.first + Math.min(arc.frames - 1, Math.floor(arcAt * arc.frames)),
          arc.row,
          player.x + player.facing * arc.dx,
          feetY(player) + arc.dy,
          player.facing < 0
        );
      }
    }
    ctx.restore();
    /*
     * 暴走's threads sit *over* him rather than behind: the reference's four
     * columns run down his own body (05_暴走 - measured at -0.23 to +0.19 of a
     * Slayer-height either side of his centre), so drawing them behind the
     * sprite would hide most of what the move is.
     */
    drawBerserkThreads(ctx, state, player);
    drawBerserkCast(ctx, state, player, sprites);
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
    /*
     * The *steady* red, not the flash. The reference has two and they are not
     * the same paint: the burst on the frame the stance lands is (230,26,2),
     * and what he settles into for as long as it is up is (184,63,47) - darker
     * and browner (G/R 0.34 against the flash's 0.11). The steady one is the
     * one that stays on screen, so it is the one this matches (docs/adr/0017).
     */
    brush.fillStyle = "rgba(196, 58, 40, 0.66)";
    brush.fillRect(0, 0, canvas.width, canvas.height);
    rageTint = { source: image, sheet: canvas };
    return canvas;
  }

  /*
   * There is deliberately nothing here for the stance's steady state.
   *
   * It used to draw a pulsing blood aura round him and keep a badge over his
   * head. Both of them were invented: the reference has neither. Measured over
   * `07_血之狂暴`'s steady stretch (f79-f106) the two bands either side of him
   * hold **zero** non-black pixels - no threads, no particles, no ground glow -
   * and the owner's own clip reads the same on a black background. The one
   * "aura" in the reference is the spiked corona on the frame the stance lands,
   * which is the cast's art and not a thing that hangs around (docs/adr/0017).
   *
   * The read for "it is up" is the red body and the lit hotbar slot.
   */

  /*
   * 暴走's own read, for as long as the buff is up: four vertical red threads
   * hanging round him, soft-edged, breathing rather than moving.
   *
   * **The first cut of this was wrong three ways and the owner caught all three
   * (2026-10-02): it marched its dashes, it was a 1.5px hairline, and it kept
   * the lines faint enough to disappear. Re-measured off 05_暴走 frame by frame:**
   *
   *   - **Nothing translates.** Cross-correlating one column's vertical profile
   *     between frames over the whole steady stretch (#78-#102) puts the best
   *     shift at 0px every time, and the mse at zero shift *is* the best one
   *     (f78->f86: 632 at 0px, f86->f94: 418). The pattern holds still; only its
   *     brightness changes.
   *   - **It is a soft band, not a line.** A cut across the left column (#84,
   *     y620) reads 21 31 62 75 64 48 27 21 13 over x736-744 - a 2px core with a
   *     smooth skirt either side, ~8 clip px of visible thread against a floor of
   *     literally 0. At 226px to the 身位 that is 3px here, not 1.5.
   *   - **It is bright, and it swells.** The core runs 40-90 with knots to 134,
   *     against a black floor: full contrast, not a tint. Each column swells and
   *     dies on its own clock - at #84 y620 the left column peaks 75 while the
   *     right-outer one, same row, is at 18.
   *
   * So: two strokes per column (a 3px skirt under a 1.2px core), no dash offset
   * anywhere, and the column's brightness varied **along its length** by a
   * vertical gradient. Cutting the column into even segments with flat ends was
   * the first attempt and the owner sent it straight back (「线条有点不丝滑」):
   * hard segment ends read as a row of little bars, where the reference is one
   * continuous band that fades in and out along itself. The gradient gives the
   * breaks soft ends for free.
   *
   * Geometry is the clip's, converted through 身位: four columns at -0.23 /
   * -0.17 / +0.11 / +0.19 either side of his centre, running from 0.15 above his
   * feet to 1.25 up (the reference spans 0.16-1.23).
   *
   * It is deliberately **not** the stance's aura: 血之狂暴 turns him red all
   * over, 暴走 leaves his colour alone and only hangs these threads on him. The
   * two are different skills - see CONTEXT.md and docs/adr/0016.
   */
  function drawBerserkThreads(ctx, state, player) {
    var buffs = player.buffs;
    if (!buffs || !(buffs.berserk > 0)) return;
    var H = SPRITE.bodyHeight;
    var columns = [-0.23, -0.17, 0.11, 0.19];
    var footY = feetY(player);
    var top = footY - H * 1.25;
    var bottom = footY - H * 0.15;
    var STOPS = 26;
    ctx.save();
    ctx.lineCap = "round";
    for (var i = 0; i < columns.length; i += 1) {
      var x = player.x + player.facing * columns[i] * H;
      /* The column's own slow swell. It never reaches zero: in the reference
         every column is present on every frame of the steady stretch. */
      var swell = 0.62 + 0.38 * Math.sin(state.time * 0.7 + i * 2.1);
      var halo = ctx.createLinearGradient(0, top, 0, bottom);
      var skirt = ctx.createLinearGradient(0, top, 0, bottom);
      var core = ctx.createLinearGradient(0, top, 0, bottom);
      for (var k = 0; k <= STOPS; k += 1) {
        var t = k / STOPS;
        /*
         * How lit the thread is *at this height*. Three slow sines at unrelated
         * rates, so the profile is irregular but smooth both in y and in time -
         * a gap opens where it stands and closes again, and nothing travels
         * down the line. Whatever ends up near zero becomes a break whose ends
         * are ramps, not cuts.
         */
        var a = 0.5 + 0.5 * Math.sin(t * 5.1 + i * 2.7 + state.time * 1.13);
        var b = 0.5 + 0.5 * Math.sin(t * 2.3 + i * 1.3 + state.time * 0.51);
        var c = 0.5 + 0.5 * Math.sin(t * 8.7 + i * 4.1 + state.time * 0.29);
        var lit = swell * (0.16 + 0.84 * (a * b * 0.7 + c * 0.3));
        halo.addColorStop(t, "rgba(150, 30, 20, " + (0.1 * lit).toFixed(3) + ")");
        skirt.addColorStop(t, "rgba(176, 40, 26, " + (0.28 * lit).toFixed(3) + ")");
        core.addColorStop(t, "rgba(212, 66, 42, " + (0.6 * lit).toFixed(3) + ")");
      }
      /*
       * Three passes over the same line - a wide faint halo, a mid skirt and a
       * narrow core - so the edge is a ramp rather than a step. Two passes read
       * as a line with an outline (owner: 「有点不丝滑」); the third is what
       * actually makes it a soft band.
       */
      ctx.strokeStyle = halo;
      ctx.lineWidth = 6.5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.strokeStyle = skirt;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.strokeStyle = core;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    }
    ctx.restore();
  }

  /*
   * The icon 暴走 flashes over his head on the press: the same atlas frame the
   * hotbar shows, on the glowing disc the reference draws it on (05_暴走 #63-93
   * - a flash, then the disc, and it is gone by #94).
   *
   * Its clock is `player.buffIconTimer`, not the buff's own: the buff runs for
   * eight seconds and the icon shows for a beat and a half.
   */
  function drawBerserkCast(ctx, state, player, sprites) {
    if (!(player.buffIconTimer > 0) || !player.buffIconId) return;
    var spec = Core.SKILLS[player.buffIconId];
    if (!spec || !spec.buff) return;
    if (!sprites || !sprites.skills || !sprites.skills.width) return;
    var slot = Core.SKILL_ORDER.indexOf(player.buffIconId);
    if (slot === -1) return;
    var sheet = goldIconSheet(sprites.skills) || sprites.skills;
    var total = spec.castIcon || 1.5;
    var fade = Math.min(1, player.buffIconTimer / 0.45);
    /*
     * Small on purpose (owner, 2026-10-02: 「头顶的图标要小一点」). The disc in
     * the reference is 0.73 of a Slayer-height across, but drawn at that size
     * over an 84px Slayer it reads as a signboard rather than a badge, so the
     * icon itself sits at 22px with the glow doing the rest.
     */
    var size = 22 * (1 + 0.15 * Math.max(0, (player.buffIconTimer - (total - 0.25)) / 0.25));
    var cx = player.x;
    var cy = feetY(player) - player.height - 50 - (1 - fade) * 6;
    ctx.save();
    ctx.globalAlpha = fade;
    var glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, size * 1.5);
    glow.addColorStop(0, "rgba(255, 228, 150, 0.5)");
    glow.addColorStop(1, "rgba(255, 160, 40, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(sheet, slot * 32, 0, 32, 32,
                  cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  }

  /*
   * The atlas again, in gold, built once.
   *
   * 暴走's own client icon is blue; the reference floats a **gold** disc over his
   * head, and the owner asked for that colour (2026-10-02: 「要是黄色的」).
   * Re-baking the atlas for one tint would mean a second icon per skill and a
   * second thing to keep in step, so the recolour happens here instead: each
   * pixel's brightest channel becomes a level, the icon's dark backdrop drops to
   * nothing, and what survives is the icon's own linework in gold. The hotbar
   * keeps the untouched atlas - this is only what hangs over his head.
   */
  var goldTint = null;
  function goldIconSheet(image) {
    if (typeof document === "undefined" || !document.createElement) return null;
    if (goldTint && goldTint.source === image) return goldTint.sheet;
    var canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    var brush = canvas.getContext("2d");
    if (!brush) return null;
    brush.drawImage(image, 0, 0);
    var data;
    try {
      data = brush.getImageData(0, 0, canvas.width, canvas.height);
    } catch (err) {
      return null;
    }
    var px = data.data;
    for (var i = 0; i < px.length; i += 4) {
      var lum = Math.max(px[i], px[i + 1], px[i + 2]);
      if (lum <= 42) {
        px[i + 3] = 0;
        continue;
      }
      /*
       * The level scales the **colour**, it does not just gate it: forcing the
       * red channel to 255 whatever the pixel's own brightness turned the whole
       * 32px cell into one flat gold square, because the icon's art fills its
       * cell and only its dark outlines survived. Scaling all three channels
       * keeps the icon's own light and shade - it reads as an icon in gold
       * rather than a gold plate.
       */
      var level = (lum - 42) / 213;
      px[i] = 255 * level;
      px[i + 1] = 202 * level;
      px[i + 2] = 58 * level;
      px[i + 3] = 255;
    }
    brush.putImageData(data, 0, 0);
    goldTint = { source: image, sheet: canvas };
    return canvas;
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
    ctx.ellipse(enemy.x, feetY(enemy) + 3, w * 0.62, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    /* Second-phase tell: a pulsing blood ring so the enrage reads at a glance. */
    if (enraged) {
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.18 * Math.sin(state.time * 6.5);
      ctx.strokeStyle = "rgba(255, 82, 108, 0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(enemy.x, feetY(enemy) - h * 0.5, w * 0.95, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.translate(enemy.x, feetY(enemy));
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
      ctx.arc(enemy.x, feetY(enemy) -h * 0.45, spinRadius, spinArc, spinArc + Math.PI * 1.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(
        enemy.x,
        feetY(enemy) -h * 0.45,
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
      ctx.arc(enemy.x, feetY(enemy) -h * 0.55, radius * (0.35 + windup * 0.65), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (enemy.hp < enemy.maxHp) {
      var barW = w + 12;
      var ratio = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      roundRect(ctx, enemy.x - barW / 2, feetY(enemy) -h - 18, barW, 6, 3);
      ctx.fill();
      ctx.fillStyle = enemy.type === "boss" ? PALETTE.danger : "#ff9d5c";
      roundRect(ctx, enemy.x - barW / 2 + 1, feetY(enemy) -h - 17, (barW - 2) * ratio, 4, 2);
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
          feetY(enemy) -enemy.height - 26 + wobble,
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
      ctx.arc(enemy.x, feetY(enemy) -6, enemy.width * 0.9, 0.15 * Math.PI, 0.85 * Math.PI);
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
          feetY(enemy) -enemy.height - 22 + Math.sin(angle) * 5,
          3,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawProjectile(ctx, state, shot) {
    var pulse = 0.85 + 0.15 * Math.sin(state.time * 24 + shot.x);
    ctx.save();
    var glow = ctx.createRadialGradient(shot.x, feetY(shot), 1, shot.x, feetY(shot), shot.radius * 3.2 * pulse);
    glow.addColorStop(0, "rgba(255, 214, 150, 0.85)");
    glow.addColorStop(1, "rgba(255, 140, 60, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(shot.x, feetY(shot), shot.radius * 3.2 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff0cf";
    ctx.beginPath();
    ctx.arc(shot.x, feetY(shot), shot.radius * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * One pass of a skill's own effect art.
   *
   * The row is normally the skill's own (one row per SKILL_ORDER entry), but a
   * move can ship a second row drawn on the other side of the Slayer: 大蹦's
   * rift and blade stay behind him and the fire it throws goes in front, the way
   * the client orders the layers of that pack.
   */
  function drawEffectRow(ctx, state, sprites, layer, source) {
    var player = state.player;
    /*
     * `source` is where the art is cast from: the caster himself while he is
     * casting (nothing passed), or a field record - ground he opened and left
     * burning, which outlives his animation (see Core's spawnField). Either way
     * the row is drawn the same way; only the spot, the clock and the alpha come
     * from somewhere else.
     */
    var caster = source || player;
    var skillId = source ? source.skillId : player.skillId;
    if (!skillId || (!source && player.skillTimer <= 0)) return;
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var spec = Core.SKILLS[skillId];
    var draw = EFFECT.draw[skillId];
    if (!spec || !draw) return;
    /*
     * A row that says it belongs in front of the Slayer must not also be painted
     * behind him - 崩山击 draws the one effect it has on the near side, so the
     * pass behind him skips it (the pass in front is gated on frontFrames).
     * 大蹦 splits its art into two rows instead (riftRows) and carries no flag.
     */
    if (draw.front && layer !== "front") return;
    /*
     * Which sheet, which cell and which row the half to draw lives on. Almost
     * everything reads off assets/effects.png at EFFECT.cell, in the skill's own
     * row of SKILL_ORDER (the orb and dive rows are past those, see EXTRA_ROWS).
     * A move whose art is drawn far bigger than a cell can hold - 大蹦 - is
     * baked to its own sheet at its own cell instead, and names the row of it
     * that holds each half (see riftRows). The front half is the one drawn after
     * the Slayer.
     */
    var rift = EFFECT.riftRows && EFFECT.riftRows[skillId];
    var sheet = sprites.effects;
    var cell = EFFECT.cell;
    var row = Core.SKILL_ORDER.indexOf(skillId);
    var frames;
    if (layer === "front") frames = EFFECT.frontFrames[skillId];
    if (rift) {
      if (!sprites.rift || !sprites.rift.width) return;
      sheet = sprites.rift;
      cell = EFFECT.riftCell;
      row = rift[layer === "front" ? "front" : "back"];
    }

    /* A field carries its own clock; a live cast is read off the caster's timer. */
    var progress = source
      ? source.progress
      : Math.min(1, Math.max(0, 1 - player.skillTimer / spec.duration));
    var frame;
    if (spec.channel && !source) {
      /*
       * A channel's elapsed time has to be put back together: once the player
       * lets go, `skillTimer` counts down to the *shortened* end, so the seconds
       * already served get added back on top of the tail's own countdown.
       */
      var served = spec.duration - player.skillTimer;
      var released = player.channelReleasedAt;
      if (released !== null && released !== undefined) {
        served = released + (spec.channel.tail - player.skillTimer);
      }
      frame = channelFrame(skillId, served, released);
    } else {
      /*
       * **A row that belongs to a field is read twice, and the two reads want
       * different windows.** 魔狱血刹's volcano is one five-second timeline -
       * slam, crack, column, smoke - and the *ground* is what plays it (Core's
       * spawnField hands it the row's own clock). The caster's 0.6s cast shows
       * only the first beat, the slam itself, from column 0 to
       * `SKILLS.hellbenterSlam.field.from` where the ground takes over.
       *
       * Reading one window for both put all sixty columns on the 0.6s cast: the
       * column rose and collapsed to smoke in half a second, and then the field
       * started the same five seconds over. Two eruptions, neither of them the
       * move (docs/adr/0025 补记四).
       */
      var timingSpec = EFFECT.timing && EFFECT.timing[skillId];
      var castWindow = source ? timingSpec : (timingSpec && timingSpec.cast) || timingSpec;
      frame = skillEffectFrame(skillId, progress, row, frames, castWindow);
    }
    if (!frame) return;
    var timing = EFFECT.timing && EFFECT.timing[skillId];
    var local = timing
      ? (progress - timing.from) / Math.max(0.0001, timing.to - timing.from)
      : progress;

    /*
     * `travel` pushes a **whole row** forward over its cast. No row uses it:
     * 十字斩 was the only one that ever did, and what the clip actually does is
     * move *him* and then let the third act's own cells fly (`grow`/`travel` in
     * the bake, which are per stage). Kept because it is a property of the draw,
     * not of that one move - but reach for the bake first: moving a whole row
     * moves the 十 too, and the 十 stands still in the clip.
     */
    var reach = draw.dx + (draw.travel || 0) * progress;
    var size = draw.size * (1 + (draw.grow || 0) * progress);
    /*
     * Where the row is rooted. Normally it rides the caster, which is what a
     * slash drawn around the blade wants. 崩山击's landing art is not that: the
     * reference erupts it out of the floor while he is still coming down, so
     * `ground` pins the row to the floor line instead of to his feet - which are
     * in the air for the first half of the window. On the ground the two are the
     * same point, so this only changes the airborne half.
     *
     * `anchor: "cast"` is the third case, and the only one where the caster
     * moves **past** his own effect: 十字斩 刻 a cross in front of him, then the
     * third cut carries him 0.54 of a Slayer-height forward and he walks through
     * it (`Core`'s `advance`). Riding the live `caster.x` would drag the whole
     * row along with him and the cross would never be overtaken. Read off
     * `castOriginX`, which the cast writes once, at the press.
     */
    var originX =
      draw.anchor === "cast" && caster.castOriginX !== undefined
        ? caster.castOriginX
        : caster.x;
    /*
     * **And a move whose ground opens in front of him is drawn there from its
     * own first frame.** 魔狱血刹's crater is 1.5 身位 ahead of him (Core's
     * `field.forward`, measured on the reference), and the *field* has always
     * been drawn on that spot - but the cast's own half of the row was still
     * drawn on `caster.x`, so the impact art appeared on his feet and then
     * jumped forward when the ground took over. The owner saw exactly that:
     * 「开始的一瞬间还是在原来错误的位置」.
     *
     * The stages that belong to the *blow* - the claw, the two crescents, the
     * gold burst - are pulled back onto him inside the bake instead (see
     * PICKS.hellbenterSlam), because the reference has them landing on him and
     * only the ground opening ahead.
     */
    if (!source) {
      var ground = spec.field;
      if (ground && ground.forward) originX += (caster.facing || 1) * ground.forward;
    }
    var baseY = (draw.ground ? Core.ARENA.groundY : caster.y) - Core.depthLift(caster.z);

    ctx.save();
    ctx.translate(originX + caster.facing * reach, baseY + draw.dy);
    ctx.scale(caster.facing, 1);
    /*
     * A row can ask to be drawn **additively**, and 魔狱血刹's volcano is the one
     * that must: the client's own eruption is three lava domes stacked, and in
     * the game they are added together into one blown-out mass - drawn with
     * plain alpha they read as three separate dumplings with seams between them
     * (which is exactly what the first bake of this looked like). Additive is
     * also what makes the core go white the way the reference's does.
     */
    if (draw.blend) ctx.globalCompositeOperation = draw.blend;
    ctx.globalAlpha = frame.alpha * (source ? source.fade : 1);
    ctx.imageSmoothingEnabled = true;
    for (var copy = 0; copy < draw.copies; copy += 1) {
      ctx.save();
      /*
       * `copies`/`spin` draw one shape more than once, mirrored, which is how a
       * pack's single slash was once turned into 十字斩's cross. That is not how
       * the move is drawn any more - the cross is its own art in the pack
       * (`gorecross_cross.img`), and this row is `copies: 1, spin: 0`.
       */
      ctx.rotate(draw.spin * (copy === 0 ? 1 : -1));
      ctx.drawImage(
        sheet,
        frame.col * cell,
        frame.row * cell,
        cell,
        cell,
        -size / 2,
        -size / 2,
        size,
        size
      );
      /*
       * **The bloom, on top of the colour rather than instead of it.** A row's
       * flat draw is what lands its own colours on screen; what a flat draw
       * cannot do is glow. 魔狱血刹's eruption needs both, and the reference says
       * so with numbers: its body is (246, 219, 33) while its core runs to
       * (241, 231, 129). Drawn additively the *whole* row picks up the floor's
       * own colour and the body comes out 55 units bluer than the clip; drawn
       * flat the body is right and the core is 44 units short. So: flat first,
       * then the same cell again with `lighter` at a fraction - the same trick,
       * and for the same reason, as the white sword's pulse in drawBloodSword.
       */
      if (draw.glow) {
        /*
         * **`glowBlur` is the difference between "lit" and "bloomed", and only
         * one row wants the second.** A plain additive pass adds the art to
         * itself: the bright mass gets brighter and the dark veins stay dark,
         * because both are scaled by the same factor. What the reference's
         * volcano has is the *other* thing - a **blown-out core**, a large
         * plateau at the top of the range with the dark rocks floating in it:
         * 66% of its column's pixels sit at level 240+ where ours were 7%. Blur
         * the same copy before adding it and the bright neighbourhood bleeds
         * into the veins, which is what fills that plateau in. The same trick,
         * for the same reason, as the white sword's own `glowBlur` in
         * drawBloodSword.
         */
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = ctx.globalAlpha * draw.glow;
        if (draw.glowBlur) ctx.filter = "blur(" + draw.glowBlur + "px)";
        ctx.drawImage(
          sheet,
          frame.col * cell,
          frame.row * cell,
          cell,
          cell,
          -size / 2,
          -size / 2,
          size,
          size
        );
        if (draw.glowBlur) ctx.filter = "none";
        ctx.globalAlpha = ctx.globalAlpha / draw.glow;
        ctx.globalCompositeOperation = draw.blend || "source-over";
      }
      ctx.restore();
    }
    /*
     * 十字斩第三拍那只翼：全仓库唯一一层不是包里的图（`docs/adr/0009` 的补记）。
     * 画在这一行的变换之内，所以它跟着施法者、也跟着朝向镜像。
     */
    /*
     * 十字斩第三拍那一层现在是 `_atgorecross/shoot.img`（**十字斩自己打出去的那一件**），
     * 所以这里不再画。`CROSS_WING` / `drawFeathers` 留着：它是"包里那张图不对时"的做法，
     * 但 2026-09-28 把 175 个包按剪影扫过一遍之后，答案是**包里本来就有**
     * （IoU 0.46，同一把尺量业主认过的「十」是 0.42）—— 前二十轮找不到它，是因为
     * 一直拿**包围盒**在比。量法与对照见 `dnf_effect_picks.md` 第二十一节。
     */
    drawFeathers(ctx, null, local);
    ctx.restore();
  }

  /**
   * 十字斩第三拍那束羽丝。参数在 `CROSS_WING`，那里写着数是怎么量出来的。
   */
  function drawFeathers(ctx, spec, local) {
    if (!spec || local < spec.from || local > spec.to) return;
    var keys = spec.keys;
    var lo = keys[0], hi = keys[0];
    for (var i = 0; i < keys.length - 1; i += 1) {
      if (local >= keys[i].at) { lo = keys[i]; hi = keys[i + 1]; }
    }
    if (local >= keys[keys.length - 1].at) { lo = hi = keys[keys.length - 1]; }
    var span = Math.max(1e-6, hi.at - lo.at);
    var t = lo === hi ? 0 : Math.max(0, Math.min(1, (local - lo.at) / span));
    var at = function (name) { return lo[name] + (hi[name] - lo[name]) * t; };
    var rad = Math.PI / 180;
    if (spec.mirror) {
      ctx.translate(spec.origin[0], 0);
      ctx.scale(-1, 1);
      ctx.translate(-spec.origin[0], 0);
    }
    var bx = at("bx") + spec.origin[0];
    var by = at("by") + spec.origin[1];
    var disc = function (x, y, r) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    };
    ctx.beginPath();
    var u;
    var bodyW = at("bw"), bodyH = at("bh");
    for (u = 0; u <= 48; u += 1) {
      var a2 = Math.PI * 2 * u / 48;
      disc(bx + Math.cos(a2) * bodyW / 2, by + Math.sin(a2) * bodyH / 2, 2.2);
    }
    var quills = Math.max(1, Math.round(at("n")));
    for (var q = 0; q < quills; q += 1) {
      u = quills === 1 ? 0 : q / (quills - 1);
      var angle = (at("a0") + (at("a1") - at("a0")) * u) * rad;
      var length = at("len") * (0.50 + 0.50 * Math.sin(Math.PI * (0.18 + 0.64 * u)));
      var width = at("w") * (0.80 + 0.35 * Math.sin(Math.PI * u));
      var bend = at("bend") * rad;
      for (var sk = 0; sk <= 26; sk += 1) {
        var along = sk / 26;
        var a = angle - bend * along * along;
        disc(bx + Math.cos(a) * length * along, by + Math.sin(a) * length * along,
             Math.max(1.0, width * Math.pow(Math.max(0, 1 - along), Math.max(0.05, at("taper")))));
      }
    }
    for (var tail = 0; tail < 2; tail += 1) {
      var ta = (at("tailA") + tail * 14) * rad;
      for (var s2 = 0; s2 <= 32; s2 += 1) {
        var v2 = s2 / 32;
        disc(bx + Math.cos(ta) * at("tailLen") * v2, by + Math.sin(ta) * at("tailLen") * v2,
             Math.max(0.8, at("tailW") * (1 - v2)));
      }
    }
    ctx.fillStyle = spec.color;
    ctx.fill();
  }

  function drawSkillEffect(ctx, state, sprites) {
    var player = state.player;
    if (player.skillId && Core.SKILLS[player.skillId] && Core.SKILLS[player.skillId].channel) {
      var spec = Core.SKILLS[player.skillId];
      var elapsed = spec.duration - player.skillTimer;
      if (player.channelReleasedAt !== null && player.channelReleasedAt !== undefined) {
        elapsed = player.channelReleasedAt + (spec.channel.tail - player.skillTimer);
      }
      drawBloodVortex(ctx, state, sprites, player, elapsed);
    }
    drawEffectRow(ctx, state, sprites);
  }

  /** The half of a move's art that belongs in front of the Slayer, if it has one. */
  function drawSkillEffectFront(ctx, state, sprites) {
    var player = state.player;
    if (!player.skillId) return;
    if (EFFECT.frontFrames[player.skillId] === undefined) return;
    drawEffectRow(ctx, state, sprites, "front");
  }

  /**
   * The ground a move opened and left burning, drawn from its own record.
   *
   * It is on the arena's clock rather than the caster's (see Core's spawnField):
   * the rift stays on the spot it was opened on, so it is drawn while he is
   * recovering, after a hit has cut the cast short, and for a moment after -
   * which is how the reference ends, with him on his feet and the cracks still
   * glowing. The same two rows are drawn as during the cast; only where and when
   * they come from is different.
   */
  function drawField(ctx, state, sprites, layer, field) {
    var at = Core.fieldProgress(field);
    /*
     * The row's own window closes just short of the cast's last frame
     * (EFFECT.timing closes 大蹦's at 0.99, where its last column lands), and
     * a field's clock runs to the end of the move: without this clamp the
     * afterglow would ask for a frame past the row and get nothing back, so
     * the ground would go on burning with nothing drawn on it. The field's
     * own fade is what takes it off screen, not the row running out.
     */
    var timing = EFFECT.timing && EFFECT.timing[field.skillId];
    drawEffectRow(ctx, state, sprites, layer, {
      skillId: field.skillId,
      progress: timing ? Math.min(timing.to, at.progress) : at.progress,
      fade: at.fade,
      x: field.x,
      y: field.y,
      /* The spot is four numbers: see Core's spawnField. */
      z: field.z,
      facing: field.facing
    });
  }

  /*
   * How far into a normal attack the stance's own art should be, or -1 when he
   * is not swinging one. The window is the attack's active window widened a
   * little at both ends, so the art is already moving before the hit lands and
   * still fading after it.
   */
  function rageSwingLocal(player) {
    if (!player || player.dead) return -1;
    if (!(player.buffs && player.buffs.bloodRage > 0)) return -1;
    if (player.attackTimer <= 0) return -1;
    var progress = clamp01(1 - player.attackTimer / player.attackDuration);
    /*
     * The window opens on the *press*, not part way in. It used to start at
     * `attackActiveFrom - 0.18` (0.12), which left the first eighth of every
     * swing drawing the katana row and then popping into the stance's own art.
     */
    var from = 0;
    var to = Math.min(1, Core.PLAYER.attackActiveTo + 0.4);
    if (progress < from || progress > to) return -1;
    return clamp01((progress - from) / Math.max(0.0001, to - from));
  }

  /*
   * **Where the swing is in the *combo*, 0..1** - and both the body and the
   * blade read their frame off this, which is the whole reason it exists.
   *
   * 血之狂暴's swing is *one* animation over the three-hit chain: 22 body frames
   * the owner picked (188-209) carrying three swings, and a 22-frame blood sword
   * drawn against them frame for frame - sword frame k is in the grip of body
   * 188+k (docs/adr/0019). Playing a column from the single press instead (what
   * this did) restarts that animation on every hit, and the blade leaves the
   * hand the moment the press's progress and the animation's frame disagree.
   */
  function rageComboLocal(player) {
    var stages = Core.ATTACK_STAGES.length || 3;
    var index = Math.max(0, Math.min(stages - 1, player.comboIndex || 0));
    var swing = rageSwingLocal(player);
    if (swing >= 0) return (index + swing) / stages;
    /*
     * **The recovery holds this press's last frame.** The attack row does the
     * same thing (a cut's follow-through stays on screen until the next press),
     * and without it the stance's art dropped back to the katana pose between
     * every two hits - which is what "the motion is not the frames I gave you"
     * looked like on screen.
     */
    if (
      player.attackCooldown > 0 &&
      player.comboTimer > 0 &&
      player.buffs &&
      player.buffs.bloodRage > 0
    ) {
      return Math.min(0.9999, (index + 1) / stages);
    }
    return -1;
  }

  /*
   * **The second blade.** 血之狂暴's dual-wield is not a second weapon baked
   * into the body art - the client ships no such animation, and all 242 body
   * frames carry one katana - it is this layer: the equipped sword redrawn
   * blood-red, drawn over the weapon's slot as the swing plays. The pack ships
   * it twice, `sword_blood_under` for the half that belongs behind the Slayer
   * and `sword_blood_upper` for the half in front, which is how DNF orders the
   * layers of one effect around a character. Both are the same sword, so this
   * is one blade drawn twice around him, not two blades (docs/adr/0017).
   */
  function drawRageBlade(ctx, sprites, player, local, column, row, offset) {
    if (local < 0 || column < 0 || row === undefined) return;
    var draw = EFFECT.draw.rageBlade;
    if (!draw) return;
    var size = draw.size;
    var dx = draw.dx + (offset ? offset[0] : 0);
    var dy = draw.dy + (offset ? offset[1] : 0);
    ctx.save();
    ctx.translate(player.x + player.facing * dx, feetY(player) + dy);
    ctx.scale(player.facing, 1);
    ctx.globalAlpha = 1 - Math.max(0, (local - 0.75) / 0.25) * 0.7;
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
   * The dual-blade flourish 血之狂暴 puts on every normal attack, on the half
   * of it that belongs behind him: the crescent the swing throws, and the
   * behind-the-body copy of the blood blade.
   *
   * The stance's art rides the swing instead of the cast, and it is timed off
   * the normal attack's active window rather than a skill's.
   */
  function drawRageSlash(ctx, state, sprites) {
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var player = state.player;
    var local = rageSwingLocal(player);
    if (local < 0) return;

    /*
     * **One column for both halves.** The pack ships the same sword twice, once
     * for behind the Slayer and once for in front, so the two rows have to be
     * read at the *same* frame or the swing draws two blades in two different
     * poses. The shorter row sets the ceiling: it is the one that would run out.
     */
    var bladeFrames = Math.min(EFFECT.rageBladeUnderFrames, EFFECT.rageBladeUpperFrames);
    var combo = Math.max(0, rageComboLocal(player));
    var bladeColumn = Math.min(bladeFrames - 1, Math.floor(combo * bladeFrames));
    var bladeDraw = EFFECT.draw.rageBlade;
    drawRageBlade(
      ctx,
      sprites,
      player,
      local,
      bladeColumn,
      EFFECT.rageBladeUnderRow,
      bladeDraw ? bladeDraw.trail : null
    );

    /*
     * The red brush fan the swipe leaves, under the crescent. It is the pack's
     * own `attack01` - eight frames of a fan that opens and fades - so one
     * column per frame *is* the whole animation: the art carries the fade and
     * nothing here has to.
     */
    var trail = EFFECT.draw.rageSlash;
    if (trail) {
      placeEffectCell(
        ctx,
        sprites.effects,
        EFFECT.rageSlashRow,
        rowAt(local, EFFECT.rageSlashFrames || 4),
        trail.size,
        player.x + player.facing * trail.dx,
        feetY(player) + trail.dy,
        player.facing,
        swingFade(local, 0.55, 0.8),
        null,
        true
      );
    }
  }

  /*
   * One cell of the effect atlas, placed by its centre at a given alpha.
   * `stretchX` widens it without making it taller, and no row wants it any
   * more: it was added to squeeze the stance's crescent into a wide flat arc,
   * back when the row behind it was a thin streak a third of the size it should
   * have been. The pack's own swing art is already 2.1-3.0 as wide as it is
   * tall (docs/adr/0019).
   */
  function placeEffectCell(ctx, sheet, row, column, size, x, y, facing, alpha, stretchX, additive) {
    if (column < 0 || alpha <= 0) return;
    var wide = size * (stretchX || 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    ctx.globalAlpha = alpha;
    /*
     * **`lighter` is how DNF draws these.** The client's effects lean on additive
     * blending - the repo's own importer says so ("DNF 靠调色板与叠加混合") - and
     * it is the difference between a bundle of pale strokes and the *mass* of
     * cream the reference shows: laid down additively, the strokes pile up in the
     * middle of the arc until the core burns out to near-white, which is exactly
     * what the reference's crescent looks like and what normal alpha can never
     * reach however many of them are stacked.
     */
    if (additive) ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      sheet,
      column * EFFECT.cell,
      row * EFFECT.cell,
      EFFECT.cell,
      EFFECT.cell,
      -wide / 2,
      -size / 2,
      wide,
      size
    );
    ctx.restore();
  }

  /* How far through a row the swing is, and how much of it is left to show. */
  function rowAt(local, frames) {
    return Math.min(frames - 1, Math.floor(local * frames));
  }

  /* The tail of the swing, where the art starts going: full until `from`. */
  function swingFade(local, from, amount) {
    return 1 - Math.max(0, (local - from) / (1 - from)) * amount;
  }

  /**
   * The swing's front pass: the half of the blood blade that belongs over him,
   * and the cream crescent.
   *
   * **The crescent goes in front, and that is most of what makes it read.** It
   * wraps *around* the Slayer rather than sitting behind him: put it in the back
   * pass and his own body eats the middle of the sweep, which is exactly where
   * its mass is. The reference's arc is drawn over him the same way - on the
   * contact sheet it crosses his chest and his legs, not his silhouette.
   */
  function drawRageBladeFront(ctx, state, sprites) {
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var player = state.player;
    var local = rageSwingLocal(player);
    if (local < 0) return;
    var bladeFrames = Math.min(EFFECT.rageBladeUnderFrames, EFFECT.rageBladeUpperFrames);
    var combo = Math.max(0, rageComboLocal(player));
    drawRageBlade(
      ctx,
      sprites,
      player,
      local,
      Math.min(bladeFrames - 1, Math.floor(combo * bladeFrames)),
      EFFECT.rageBladeUpperRow
    );
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
    ctx.translate(player.x + player.facing * 26, feetY(player) - player.height * 0.35);
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

  /*
   * 魔狱血刹's numbers, and every one of them is measured off the reference
   * rather than dialled in (docs/adr/0025). Two of them are the bake's own: how
   * much of its cell the sword's ink fills. The row is drawn live - the sword is
   * up for the whole of the 持剑期, which no baked timeline could hold - so the
   * renderer has to place the ink itself, and these are the fractions it places.
   */
  var SWORD = {
    /* How many steps the forging has - the game's own number, not a second copy. */
    tiers: Core.HELLBENTER.tiers,
    /*
     * How long the state lasts, which is also how the renderer tells **when** the
     * sword arrived: the buff is written to its full length the moment it lands, so
     * `hold - buffs.hellbenter` is the seconds since - and the two things that
     * happen only at the start (the 成形) and only at the end (the white warning)
     * are both read off it.
     */
    hold: Core.SKILLS.hellbenter.buff.duration,
    /*
     * **The guard is pinned and the blood falls.** The reference's own growth is
     * what pins it (2026-10-06, `BV1oUDLBaEaK.mp4` 1:08.7–1:13.0, measured frame
     * by frame): the star guard does not move - 85–90 px wide and the same 100 px
     * of blade above it for the whole stretch - while **only the part below it
     * grows**, 99 px to 295 px, continuously and without a step. Its centre sits
     * 0.94–0.96 of a Slayer-height off the floor at both ends of that range.
     *
     * 1.31 is that 0.95 plus the 0.357 the blade above the guard occupies, so the
     * pinned thing is the guard's own line, not the sword's tip: a full sword
     * then hangs its blood *onto the floor*, which is what the reference shows
     * (its mass ends at y≈749 with the ground line at 758).
     */
    top: 1.325,
    /*
     * **One cell per tier, and the blade is what grows.** The client's own
     * `sword-normal` is one sword at three lengths (43x73, 43x97, 43x160) and the
     * art is *literally the same picture cut short* - its own two lit frames
     * line up to the pixel above the cut. So the bake emits one cell per tier by
     * cutting the longest frame at the tier's length (see PICKS.hellbenterSword):
     * the hilt and the pommel never move, the blade comes out downwards, and
     * **nothing is ever zoomed** - which is the line the owner drew when he sent
     * the first cut back (「断剑好像不对」: a scaled-down sword is a miniature
     * complete sword, not a broken one).
     *
     * Two cells and one swap at tier 5 (what this was) meant the sword sat at
     * 0.52 身位 for four tiers and then jumped to 1.13 - and the owner read the
     * whole pre-formed stretch as wrong: 「血剑没成型前跟参考不一样」.
     */
    /*
     * **One cell per tier, and the cells are the client's own long frame cut to
     * eight lengths.** 补记十 replaced this with a single cell drawn at eight
     * sizes, on the reading that frame 0's *silhouette* is the reference's sword.
     * The shape was right and the **colour** was not: f0 is the unlit frame - 137
     * opaque pixels, every one of them (55,55,55) - so filling it and running it
     * through a red ramp can only ever produce a red bar. The reference's own
     * sword has a **black four-pointed crossguard and a gold eye**, and those are
     * in the *coloured* frames (f1/f2), which the eye skipped. The owner boxed
     * the reference's sword on the frame and sent it back: 「断剑不对吧」.
     *
     * Cutting is not zooming: the client's f1 (43x73) and the top 73 rows of f2
     * (43x160) agree pixel for pixel, so every tier carries the same 1:1 hilt,
     * guard and eye and only the blade's length changes.
     */
    tierCell: [0, 1, 2, 3, 4, 5, 6, 7],
    /*
     * One `size` for all eight, because the cells already carry the growth. The
     * row is baked at `RIFT_CLIENT_PX * CELL / fit_scale`, the pack's own 0.596
     * screen px per client px.
     *
     * **130, fitted to the cut-out.** The row is no longer built from client
     * entries at all: `assets/import_dnf_awakening_sword.py` keys the sword out
     * of the reference clip's black backdrop, and the bake stretches its drop
     * per tier (see PICKS.hellbenterSword). At 130 the cut-out's own height lands
     * on 0.70 身位 - which is what the reference measures for it - and the full
     * tier on 1.31, against the grow clip's 1.36.
     */
    size: 130,
    size: 130,
    /* Behind him: the client's own frame carries the blade half a height back. */
    behind: 0.5,
    /* Where the ink starts inside the cell - the pommel, the same in all eight. */
    inkTop: 7 / 128,
    /*
     * **The last five seconds are white, and they breathe.** The owner set the
     * number (the reference's own white stretch is 2.9s and he asked for longer),
     * and it is the warning the whole two-press shape needs: the sword says "put
     * me down" before the clock says it for him. The pulse is what makes it read
     * as a warning rather than as a colour change - white throughout, brightness
     * breathing at 2Hz under it.
     */
    whiteFrom: 5,
    pulseHz: 2,
    /*
     * How hard the sword lights itself. The art's blade is dark and the reference
     * draws it over black; one additive pass of the same cell is what keeps it
     * reading as a red sword on our purple floor (see drawBloodSword).
     *
     * **0.35, not 0.9.** The pass used to be doing the sword's colouring for it -
     * the cell was a flat red silhouette and the glow was what made it read. The
     * cell now carries the client's own black crossguard and gold eye, and at 0.9
     * the addition washed the blacks out of exactly those two shapes.
     */
    glow: 0.35,
    /*
     * **Zero: the blur is gone.** It was there to smear a saw blade into the
     * "soft red mass" the reference shows, and it was already known to be
     * dangerous - at three pixels it took the crossguard and the gold eye with
     * it. With the coloured frame in the row there is nothing left to smear.
     */
    glowBlur: 0
  };
  /*
   * Which cell of the sword row a tier draws. Trivial arithmetic, but it is the
   * one place the tier *count* and the cell *count* meet, and the bake's own
   * list of lengths has to be the same length: `SWORD.tiers` cells, tier 1 at
   * the client's shortest frame and tier 8 at its longest.
   */
  SWORD.cellFor = function (tier) {
    var clamped = Math.max(1, Math.min(SWORD.tiers, tier));
    return SWORD.tierCell[clamped - 1];
  };
  /*
   * **The ladder is discrete; the sword is not.** 铸剑 buys a tier every ten hits,
   * and drawing one cell per tier means the drop jumps a whole step on the tenth
   * blow - which is not what the reference does. `BV1U1v6B2EWt` 1:49-2:05, walked
   * frame by frame, has the drop go 0.32 -> 1.05 Slayer-heights **continuously**,
   * with no step anywhere in it (补记十八 二). So the held sword is drawn as the
   * blend of the tier it is on and the one it is working towards, weighted by how
   * many of that tier's hits are already in.
   *
   * `cellFor` stays as it is: the 落 always swings the **full** sword, whatever
   * the ladder happens to be showing.
   */
  SWORD.blendFor = function (player) {
    var tiers = SWORD.tiers;
    var tier = Math.max(1, Math.min(tiers, player.hellbenterTier || 1));
    var per = Math.max(1, Core.HELLBENTER.hitsPerTier);
    var charge = Math.max(0, Math.min(per, player.hellbenterCharge || 0));
    var at = tier - 1 + (tier >= tiers ? 0 : charge / per);
    var low = Math.max(0, Math.min(tiers - 1, Math.floor(at)));
    var high = Math.min(tiers - 1, low + 1);
    return { from: SWORD.tierCell[low], to: SWORD.tierCell[high], mix: at - low };
  };

  /*
   * **血气之剑 成形的那半秒**, drawn live the way the sword itself is because it is
   * the same object arriving: the client's own `sim1-dodge` (7 frames, dark sword
   * -> white -> gold inside a red disc that opens and fades - see the bake). The
   * reference's cast is exactly this, and the owner pointed at those frames
   * (「开始」) after playing a version where the sword simply popped in, finished
   * and red.
   *
   * `seconds` is the reference's own: the disc is up from #54 to about #66, which
   * is 0.4s. Until it is over **the sword row is not drawn at all** - the disc is
   * what the sword is doing, not a second thing next to it.
   */
  /*
   * The sunburst disc the 成形 opens with, a row of its own (see `drawSwordForm`).
   * `size` is `RIFT_CLIENT_PX * CELL / fit_scale` for its own window, so the ring
   * comes out 199 client px = **1.41 Slayer-heights** across - the reference
   * measures 1.26 for the disc's body and 1.54 out to the tips of its rays, and
   * `kaaa-d1`'s ink runs from the middle of one to the other.
   */
  var SWORD_FORM_RING = {
    row: Core.SKILL_ORDER.length + 13,
    size: 136.0,
    up: 0.6,
    /*
     * **The gold disc is the first beat and the red star is the second.** The
     * reference's 成形 is four of them (补记十八 六): a gold sunburst at his chest
     * (`#49-#55`), then a **red spiked star** over it (`#57-#59`), then the white
     * sword (`#61`) and the red one (`#63`). Before this the disc stayed up for
     * the whole stretch, which read as one long gold flash; the star row below is
     * what makes it read as the sword *forging* - light, then shape.
     */
    until: 0.45
  };
  /*
   * The red star 成形 opens into (see SWORD_FORM_RING.until). `new18.img` is the
   * client's own radial star; its frame is 710x182 - a star squashed to fit a
   * wide canvas - so the bake stretches it back round on y, and this `size` then
   * draws its ink at 1.23 x 1.11 Slayer-heights, which is what the reference
   * measures (its red ring is 225x269 px at 220 px to a Slayer = 1.02 x 1.22).
   */
  var SWORD_FORM_STAR = {
    row: Core.SKILL_ORDER.length + 14,
    size: 112.0,
    up: 0.6,
    from: 0.45
  };
  var SWORD_FORM = {
    row: Core.SKILL_ORDER.length + 12,
    /*
     * **Ten frames, and they are the reference's 成形 end to end.** The entry is
     * `sword-dodge.img`: a faint outline -> a solid white sword -> red outline ->
     * a white burst with rays -> red-and-white with sparks -> a red sword -> a
     * gold blade. 11_魔狱血刹 #52-#72 walks the same beats (a white flash at his
     * chest, rays opening, a white sword at his shoulder, then dark red, then the
     * red sword). That is 20 video frames, so 0.67s.
     */
    frames: 4,
    /*
     * **Four frames, not ten** (补记二十). `sword-dodge`'s f4-f8 are the *long*
     * sword - 115 px of ink in the cell against the held first tier's 60 - so the
     * 成形 used to resolve into a full-grown sword and then hand over to a
     * half-length one. That join is what the owner saw: 「在释放的一瞬间有个长剑变成了
     * 短剑，应该一开始就是短剑」. f0-f3 (line drawing -> white sword -> red outline)
     * are 39/63/72/57, which is the first tier's own size.
     */
    /*
     * **0.43s, re-measured.** It was 0.67, from reading the reference's 成形 as
     * #52-#72. Walked again for 补记十八: the gold disc is #49-#55, the red star
     * #57-#59, the white sword #61 and the red one #63 - the whole thing is
     * 1.633s to 2.067s, which is 13 frames, **0.43s**. The extra fifth of a second
     * was the disc's own tail being counted as part of the sword's arrival.
     */
    seconds: 0.43,
    /*
     * **79, sized to the sword he will actually be holding** (补记二十). It was
     * 126.5, which drew the 成形's sword at ~96 screen px - and the held first tier
     * is 60 - so the sword visibly shrank the moment the cast ended. The row's
     * cells carry 97 px of ink in a 128 cell and the held row's first cell carries
     * 59, so 126.5 x 59/97 = 77; 79 with the same centre line lands the forming
     * sword on the held one's length, which is what 「一开始就是短剑」 asks for.
     */
    size: 79.0,
    /*
     * Where the sword will be. The reference's forming sword appears at the same
     * spot the finished one hangs - behind him, pommel at `SWORD.top` - so the two
     * read as one object arriving rather than two swapping. Measured off the two
     * baked cells' ink tops, not guessed: `behind` is the sword's own 0.5, and
     * `up` puts this cell's ink top on the same line as the sword row's.
     */
    behind: 0.5,
    up: 0.635
  };

  function swordFormFrame(player) {
    var at = swordFormAt(player);
    if (at < 0) return -1;
    return Math.min(SWORD_FORM.frames - 1, Math.floor(at * SWORD_FORM.frames));
  }

  /*
   * How far through 成形 this is, 0..1, or -1 when it is not running. The two
   * layers it drives (the disc and the star) are not frames of one sequence, so
   * they need the progress itself and not a frame index.
   */
  function swordFormAt(player) {
    if (!(player.buffs && player.buffs.hellbenter > 0)) return -1;
    var elapsed = SWORD.hold - player.buffs.hellbenter;
    if (!(elapsed >= 0 && elapsed < SWORD_FORM.seconds)) return -1;
    return elapsed / SWORD_FORM.seconds;
  }

  function drawSwordForm(ctx, state, sprites) {
    var player = state.player;
    if (!player || player.dead) return;
    var frame = swordFormFrame(player);
    if (frame < 0) return;
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var slayer = SPRITE.bodyHeight;
    var size = SWORD_FORM.size;
    ctx.save();
    ctx.translate(
      player.x - player.facing * SWORD_FORM.behind * slayer,
      feetY(player) - SWORD_FORM.up * slayer
    );
    ctx.scale(player.facing, 1);
    ctx.imageSmoothingEnabled = true;
    /*
     * **`-dodge` is the client's own word for how this entry is drawn**, and the
     * reference says the same thing: at #56 the ring's inside is the room showing
     * through, not a red plate. Drawn flat the disc is a solid balloon over him.
     */
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(
      sprites.effects,
      frame * EFFECT.cell,
      SWORD_FORM.row * EFFECT.cell,
      EFFECT.cell,
      EFFECT.cell,
      -size / 2,
      -size / 2,
      size,
      size
    );
    ctx.restore();
    /*
     * **And the ring he is standing in.** The reference's 成形 is *two* things -
     * the sword resolving at his shoulder and a sunburst disc centred on his
     * chest (11_魔狱血刹 #56) - and they are not the same size, so they are not the
     * same row: a second layer in the sword's own cell drags the cell's whole
     * `fit_scale` down with it and the sword comes out six tenths of its size.
     *
     * It is drawn where **he** is, not where the sword is: the sword row's cell is
     * centred `behind` Slayer-heights back along his facing, the ring's own cell
     * is centred on his feet. `up` is the reference's own - the disc's middle sits
     * on his chest, 0.6 of a Slayer above the floor.
     */
    var ring = SWORD_FORM_RING;
    var star = SWORD_FORM_STAR;
    var at = swordFormAt(player);
    if (at < star.from) {
      ctx.save();
      ctx.translate(player.x, feetY(player) - ring.up * slayer);
      ctx.scale(player.facing, 1);
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(
        sprites.effects,
        0,
        ring.row * EFFECT.cell,
        EFFECT.cell,
        EFFECT.cell,
        -ring.size / 2,
        -ring.size / 2,
        ring.size,
        ring.size
      );
      ctx.restore();
      return;
    }
    /*
     * **The second beat is a different picture, not a longer one.** At #57 the
     * reference's gold disc is gone and a red spiked star is spinning open in its
     * place; holding the `kaaa-d1` disc up instead is what made the whole 成形
     * read as one gold flash (see SWORD_FORM_RING.until).
     */
    ctx.save();
    ctx.translate(player.x, feetY(player) - star.up * slayer);
    ctx.scale(player.facing, 1);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(
      sprites.effects,
      0,
      star.row * EFFECT.cell,
      EFFECT.cell,
      EFFECT.cell,
      -star.size / 2,
      -star.size / 2,
      star.size,
      star.size
    );
    ctx.restore();
  }
  function drawBloodSword(ctx, state, sprites) {
    var player = state.player;
    if (!player || player.dead) return;
    /*
     * The read is the buff, not the tier: the sword is on his back for as long as
     * `buffs.hellbenter` runs. The tier only says how far it has been forged, and
     * the two disagree for exactly one cast - the 落, when the clock is out but the
     * sword has not been put down yet (see Core's gate).
     */
    /*
     * **The 落 draws no sword of its own.** The owner, 2026-10-07, on the second
     * press: 「再拍的那一下，看到一个另一把剑存在，但是参考是没有的」. Frame by frame
     * the reference has no blade in it at any point: `11_魔狱血刹` #147-#156 (the
     * plunge) is the white spiky mass and the red vortex with nothing held, and
     * #158-#185 has the wing and then the crater. The sword that used to be here
     * came from a misreading of the plunge's white mass as a blade (docs/adr/0025
     * 补记十八 §四, retracted in 补记十九 §十六).
     */
    if (player.skillId === "hellbenterSlam") return;
    if (!(player.buffs && player.buffs.hellbenter > 0)) return;
    /* While it is still forming there is no sword yet - see drawSwordForm. */
    if (swordFormFrame(player) >= 0) return;
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var tier = Math.max(1, Math.min(SWORD.tiers, player.hellbenterTier || 1));
    /*
     * `SPRITE.bodyHeight`, not `Core.SLAYER_HEIGHT`: the reference's heights are
     * measured against the art he is *drawn* at (84), and the other 156 is the
     * cell between his feet and the anchor - using that one in the renderer drew
     * the sword 1.86x too long, which is what the first cut of this did.
     */
    var slayer = SPRITE.bodyHeight;
    /*
     * 铸剑 drawn: the eight cells already carry the growth, so every tier is drawn
     * at the same `size` and it is the *cut* that changes - tier 1 comes out 44
     * screen px, tier 8 95, which is 0.52 and 1.14 of his 84-px height (see
     * `tierCell`).
     */
    var size = SWORD.size;
    /*
     * The pommel is pinned: it sits `top` Slayer-heights off the floor and stays
     * there while the blade comes out downwards, which is what keeps the swap
     * from jumping - the row's two cells share this line and differ below it.
     */
    var centreY = -SWORD.top * slayer + (0.5 - SWORD.inkTop) * size;
    /*
     * **Two cells, cross-faded by how far into the tier the forging is.** See
     * `SWORD.blendFor`: the ladder is bought in tens of hits and the reference's
     * own drop grows with no step in it at all, so a sword that jumped a whole
     * cell every tenth blow was the one thing about 铸剑 the frames disagreed
     * with. The guard is pinned in every cell (the bake cuts from the pommel
     * down), so the two agree exactly where it matters and only the drop's length
     * is what the mix moves.
     */
    var blend = SWORD.blendFor(player);
    var cell = blend.from;
    var mixing = blend.to !== blend.from && blend.mix > 0.002;
    /*
     * The warning, and the only thing about this sword that is a *colour*: the
     * reference turns the same serrated blade white for the last seconds
     * (11_魔狱血刹 B 2:36.4) and the bake carries that as its own row.
     */
    var white = player.buffs.hellbenter <= SWORD.whiteFrom;
    /*
     * **Three states, in this order: forged red, full gold, and the white
     * warning over both.** Gold is the reward the owner asked for - the whole
     * 铸剑 ladder exists to reach it - and white still wins when the clock is
     * nearly out, because that one is about *time*, not about how far the sword
     * got.
     */
    var full = tier >= SWORD.tiers;
    var row = white
      ? EFFECT.whiteSwordRow
      : (full ? EFFECT.goldSwordRow : EFFECT.bloodSwordRow);
    ctx.save();
    ctx.translate(player.x - player.facing * SWORD.behind * slayer, feetY(player));
    ctx.scale(player.facing, 1);
    ctx.imageSmoothingEnabled = true;
    /*
     * One sword, drawn as up to two cells. `weight` is what the mix does to a
     * pass's own alpha, so the fade is the same picture laid on itself twice and
     * the pinned guard never doubles.
     */
    var paint = function (which, weight) {
      ctx.globalAlpha = weight;
      ctx.drawImage(
        sprites.effects,
        which * EFFECT.cell,
        row * EFFECT.cell,
        EFFECT.cell,
        EFFECT.cell,
        -size / 2,
        centreY - size / 2,
        size,
        size
      );
      /*
       * **And then lit, because the blade's own art is mostly dark.** The client's
       * sword is a dark serrated blade with a red edge, and the reference shows it
       * as a red thing hanging behind him - its floor is black, so the dark half
       * simply is not there. Ours is purple, so the same dark half reads as a
       * sword with its blade missing, which is what the owner saw and called by
       * name: 「断剑不对吧」. One additive pass of the same cell puts the light back
       * without inventing anything: whichever pixels are red go brighter, and the
       * black ones stay black (`docs/adr/0025` 补记五).
       */
      if (SWORD.glow) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = SWORD.glow * weight;
        /*
         * **Not blurred any more.** The blur was there to turn a saw into a mass -
         * the reference's sword reads as a soft red blob with the guard on top of
         * it - but that was when the cell was a flat red silhouette. The cell now
         * carries the client's own crossguard and gold eye, and smearing it is
         * what would destroy them.
         */
        if (SWORD.glowBlur) ctx.filter = "blur(" + SWORD.glowBlur + "px)";
        ctx.drawImage(
          sprites.effects,
          which * EFFECT.cell,
          row * EFFECT.cell,
          EFFECT.cell,
          EFFECT.cell,
          -size / 2,
          centreY - size / 2,
          size,
          size
        );
        if (SWORD.glowBlur) ctx.filter = "none";
        ctx.globalCompositeOperation = "source-over";
      }
      if (white) {
        /*
         * The breath. A second pass of the same cell laid on with `lighter`, so
         * what the eye reads is one sword whose brightness moves rather than two
         * swords swapping - it is the same art, added to itself. `state.time` and
         * not the buff's own clock, because a pulse that stopped when the seconds
         * did would go dark exactly as it ran out.
         */
        var beat = 0.5 + 0.5 * Math.sin(state.time * Math.PI * 2 * SWORD.pulseHz);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = (0.12 + 0.3 * beat) * weight;
        ctx.drawImage(
          sprites.effects,
          which * EFFECT.cell,
          row * EFFECT.cell,
          EFFECT.cell,
          EFFECT.cell,
          -size / 2,
          centreY - size / 2,
          size,
          size
        );
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = 1;
    };
    paint(cell, 1);
    if (mixing) paint(blend.to, blend.mix);
    ctx.restore();
  }

  /*
   * 血气被吸进来的那缕丝: from the wound to his chest, drawn live and rotated,
   * because both of its ends move - the monster it came out of may be dead and
   * the Slayer is wherever he is now (docs/adr/0025).
   *
   * The art is the client's own thin blood thread (`hellbenter/new13`, 30 frames
   * of a streak that flickers along its own length), so a long strand is the
   * same picture stretched along the line rather than a longer drawing: the cell
   * is scaled to the distance and turned to face it, and its own column is picked
   * by how far along the flight is.
   */
  function drawBloodStrand(ctx, state, effect, sprites) {
    var player = state.player;
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var progress = clamp01(1 - effect.life / effect.maxLife);
    var to = {
      x: player.x - player.facing * 4,
      y: feetY(player) - player.height * 0.62
    };
    /* Its head leads, so the strand reaches him before the effect runs out. */
    var head = {
      x: effect.x + (to.x - effect.x) * progress,
      y: effect.y + (to.y - effect.y) * progress
    };
    var dx = head.x - effect.x;
    var dy = head.y - effect.y;
    var length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1) return;
    var column = Math.min(
      EFFECT.strandFrames - 1,
      Math.floor(progress * EFFECT.strandFrames)
    );
    /* The art is 112 of a 128 cell tall, so a segment of `length` needs this. */
    var size = (length / (112 / 128)) * 1.08;
    ctx.save();
    ctx.globalAlpha = 1 - progress * 0.35;
    ctx.imageSmoothingEnabled = true;
    ctx.translate(head.x, head.y);
    ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
    ctx.drawImage(
      sprites.effects,
      column * EFFECT.cell,
      EFFECT.strandRow * EFFECT.cell,
      EFFECT.cell,
      EFFECT.cell,
      -size / 2,
      -size / 2,
      size,
      size
    );
    ctx.restore();
    /* The round head the reference draws on the end of every strand. */
    ctx.save();
    ctx.fillStyle = "rgba(255, 74, 58, 0.9)";
    ctx.beginPath();
    ctx.arc(head.x, head.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /*
   * 觉醒插画: the picture that slides in over him on the frame 魔狱血刹 is pressed
   * (docs/adr/0025). Measured off `11_魔狱血刹.mp4`: it is in and settled at
   * 1.00s, holds, and is gone by 1.90s - so it owns the whole of the cast's own
   * second, and the out is a *snap* rather than a fade, which is what makes the
   * end of it read as the cast letting go.
   *
   * The art itself is the one piece in this folder that is not the client's: the
   * client has no 一觉 illustration, so the picture is cut out of the reference
   * frame (assets/import_awakening_cutin.py).
   */
  var CUT_IN = {
    enter: 0.12,
    /*
     * **The whole cast, the way the reference does it** (补记十八 七). Measured
     * off `11_魔狱血刹.mp4`: the illustration is in at 0.900s and still there at
     * 2.067s, when the sword is already forming - it covers the entire cast, and
     * it does not move or grow while it is up.
     *
     * This used to leave at 0.40, on the reading that it would otherwise cover
     * the 成形. That reading was wrong about *where* the two are drawn: the
     * reference puts the illustration in the **lower left corner** and the 成形
     * on the character, and so does this - the bar is 280px wide over a 1080px
     * arena and he stands at its middle. Nothing overlaps, so there is nothing
     * to give way to.
     *
     * The out is still a **snap**, not a fade: that is what makes the end of it
     * read as the cast letting go.
     */
    leaveAt: 0.88,
    leave: 0.12,
    /* The frame it was cut from has 1080 lines; the arena has 540. */
    scale: ARENA.height / 1080,
    /*
     * Its lower edge stops on the skill bar's top line. That is not a coincidence
     * to be tuned: the bake stops at the reference's own HUD line for the same
     * reason, and the reference draws its bar over the picture exactly here.
     */
    bottom: BAR.y
  };

  function drawAwakening(ctx, state, sprites) {
    var player = state.player;
    if (!player || !sprites || !sprites.awakening || !sprites.awakening.width) return;
    if (player.skillTimer <= 0 || player.skillId !== "hellbenter") return;
    var progress = clamp01(1 - player.skillTimer / Core.SKILLS.hellbenter.duration);
    var image = sprites.awakening;
    var width = image.width * CUT_IN.scale;
    var height = image.height * CUT_IN.scale;
    var slide =
      progress < CUT_IN.enter
        ? 1 - progress / CUT_IN.enter
        : progress > CUT_IN.leaveAt
        ? (progress - CUT_IN.leaveAt) / CUT_IN.leave
        : 0;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, -slide * width, CUT_IN.bottom - height, width, height);
    ctx.restore();
  }

  /*
   * Everything on the floor is 血球 now - monsters stopped leaving heal orbs
   * behind when they died (docs/adr/0021), so this is a name for the walk over
   * `state.pickups` rather than a dispatcher with one case in it.
   */
  function drawDrop(ctx, state, drop, sprites) {
    drawBloodOrb(ctx, state, drop, sprites);
  }

  /*
   * 血球: the drop 血之狂暴 pulls out of a monster, and it is a **ball with a
   * tail**, both measured off the reference (docs/adr/0020).
   *
   * The ball is the client's own art, cropped to its core by the bake - the row
   * carries the red ball and nothing else, and `ORB_INK_OF_CELL` is what the
   * bake left filling its cell (measured off the built sheet, 0008's rule).
   * `radius` is the ball in world px, so the cell is drawn at whatever makes
   * that ink come out at `2 * radius`.
   *
   * The tail is the ball drawn again at the positions it has just been at,
   * fading: the reference's tail is the *same ball* left behind (#842-845), a
   * series of blobs with dark gaps between them, which is what a row of
   * after-images looks like and what nothing else would look like.
   */
  var ORB_INK_OF_CELL = 0.595;

  function drawBloodOrb(ctx, state, drop, sprites) {
    var pulse = 0.94 + 0.06 * Math.sin(state.time * 14 + drop.x * 0.05);
    var lift = feetY(drop) - drop.y;
    var size = (2 * drop.radius * pulse) / ORB_INK_OF_CELL;
    var image = sprites && sprites.effects && sprites.effects.width ? sprites.effects : null;
    var col = Math.floor(state.time * 14 + drop.x * 0.05) % EFFECT.orbFrames;
    var trail = drop.trail || [];

    function ballAt(x, y, alpha, at) {
      ctx.globalAlpha = alpha;
      if (image) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(
          image,
          at * EFFECT.cell,
          EFFECT.orbRow * EFFECT.cell,
          EFFECT.cell,
          EFFECT.cell,
          x - size / 2,
          y - size / 2,
          size,
          size
        );
        return;
      }
      ctx.fillStyle = "#e5233c";
      ctx.beginPath();
      ctx.arc(x, y, drop.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.globalAlpha = drop.life < 0.25 ? Math.max(0.2, drop.life / 0.25) : 1;
    /* Furthest back first, so the newest copy of the ball is the one on top. */
    for (var back = trail.length - 1; back >= 1; back -= 1) {
      ballAt(trail[back].x, trail[back].y + lift, 0.5 * (1 - back / (trail.length + 1)), col);
    }
    ctx.globalAlpha = drop.life < 0.25 ? Math.max(0.2, drop.life / 0.25) : 1;
    /*
     * Its halo, under the ball: the reference's glow dies about a fifth of the
     * ball's own radius past its edge (#836: bright to r50, off by r65 against
     * a 50px ball), so this is a tight rim of light rather than a lamp.
     */
    var halo = drop.radius * 1.25 * pulse;
    var glow = ctx.createRadialGradient(drop.x, feetY(drop), 1, drop.x, feetY(drop), halo);
    glow.addColorStop(0, "rgba(255, 74, 96, 0.8)");
    glow.addColorStop(0.55, "rgba(206, 22, 46, 0.45)");
    glow.addColorStop(1, "rgba(150, 8, 26, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(drop.x, feetY(drop), halo, 0, Math.PI * 2);
    ctx.fill();
    ballAt(drop.x, feetY(drop), 1, col);
    /*
     * Its white-hot middle. The reference's ball is a *hot* point inside red
     * rather than flat red: #836 measures pure `(255,255,255)` across the
     * middle ~10px of a 100px ball, fading out to the body's red within a
     * fifth of the ball's own width. The client's art stops at bright red, and
     * without this the ball reads as a painted disc.
     */
    var hot = drop.radius * 0.42 * pulse;
    var core = ctx.createRadialGradient(drop.x, feetY(drop), 0, drop.x, feetY(drop), hot);
    core.addColorStop(0, "rgba(255, 255, 255, 0.92)");
    core.addColorStop(0.35, "rgba(255, 226, 236, 0.5)");
    core.addColorStop(1, "rgba(255, 190, 200, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(drop.x, feetY(drop), hot, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /*
   * The second half of a 血球 landing: the *drink*. A glass-green sphere closes
   * over him and then breaks into motes that float off.
   *
   * Measured off the reference (#850-855, docs/adr/0020): the sphere is about
   * 0.76 Slayer-heights across, its brightest band near-white mint
   * (`(220,254,220)`) with a deeper green rim, and it is translucent - he shows
   * through it. It peaks in under a tenth of a second and is gone by 0.2s, and
   * the three motes it breaks into (each about 0.2 Slayer-heights) rise off him
   * over the next 0.2s. Without this half the orb simply vanished at his chest.
   */
  function drawBloodHeal(ctx, effect, state) {
    var age = 1 - effect.life / effect.maxLife;
    ctx.save();
    /*
     * The sphere opens a beat *after* the flash, not with it: the reference
     * spends #846-849 on the white burst and only then closes the green over
     * him. Drawn together the flash's spokes sit on top of the sphere and
     * neither reads.
     */
    var opened = (age - 0.25) / 0.75;
    if (opened > 0) {
      var radius = SPRITE.bodyHeight * 0.38;
      var sphere = radius * (0.62 + 0.38 * Math.min(1, opened / 0.35));
      ctx.globalAlpha = Math.min(1, (1 - opened) * 2.6);
      var skin = ctx.createRadialGradient(effect.x, effect.y, 1, effect.x, effect.y, sphere);
      skin.addColorStop(0, "rgba(236, 255, 238, 0.34)");
      skin.addColorStop(0.6, "rgba(150, 240, 180, 0.44)");
      /* The glassy edge: the reference's sphere reads by its rim, not its fill. */
      skin.addColorStop(0.9, "rgba(214, 255, 224, 0.62)");
      skin.addColorStop(0.97, "rgba(120, 240, 170, 0.3)");
      skin.addColorStop(1, "rgba(120, 240, 170, 0)");
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, sphere, 0, Math.PI * 2);
      ctx.fill();
    }
    /* The motes it breaks into, each on its own slow drift upward. */
    for (var mote = 0; mote < 3; mote += 1) {
      var own = Math.max(0, Math.min(1, (age - 0.55) / 0.45));
      if (own <= 0) continue;
      var angle = -Math.PI / 2 + (mote - 1) * 0.75;
      var travel = SPRITE.bodyHeight * 0.5 * own;
      var mx = effect.x + Math.cos(angle) * travel * 0.7 + (mote - 1) * 11;
      var my = effect.y + Math.sin(angle) * travel;
      var moteRadius = SPRITE.bodyHeight * 0.1 * (0.7 + 0.3 * Math.sin(state.time * 9 + mote));
      ctx.globalAlpha = Math.min(1, (1 - own) * 2.4);
      var glow = ctx.createRadialGradient(mx, my, 1, mx, my, moteRadius * 2.2);
      glow.addColorStop(0, "rgba(226, 255, 232, 0.95)");
      glow.addColorStop(0.45, "rgba(110, 245, 170, 0.7)");
      glow.addColorStop(1, "rgba(60, 200, 140, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mx, my, moteRadius * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /*
   * What a 血球 does when it lands: the reference goes off like a flashbulb on
   * his chest - a white core, then pale spokes off it, `(226,255,255)` at r45
   * and fading inside a tenth of a second (#846-849, docs/adr/0020).
   */
  function drawBloodFlash(ctx, effect) {
    var age = 1 - effect.life / effect.maxLife;
    var alpha = Math.min(1, effect.life / effect.maxLife) * (1 - age * 0.45);
    /*
     * Short spokes off a bright core, not a sparkler: the reference's rays
     * reach about a ball and a half past their own core and are pale, thin and
     * soft (#847, `(226,255,255)`), and the whole thing is over inside 0.2s.
     */
    var reach = 12 + age * 36;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(222, 252, 255, 0.6)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (var spoke = 0; spoke < 14; spoke += 1) {
      var angle = (spoke / 14) * Math.PI * 2 + 0.35;
      ctx.beginPath();
      ctx.moveTo(effect.x + Math.cos(angle) * (reach * 0.35), effect.y + Math.sin(angle) * (reach * 0.35));
      ctx.lineTo(effect.x + Math.cos(angle) * reach, effect.y + Math.sin(angle) * reach);
      ctx.stroke();
    }
    var core = ctx.createRadialGradient(effect.x, effect.y, 1, effect.x, effect.y, 13);
    core.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    core.addColorStop(0.55, "rgba(226, 255, 255, 0.5)");
    core.addColorStop(1, "rgba(180, 235, 255, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /*
   * 血之狂暴's second beat: the blood gathering in his free hand, and the short
   * flash over his head that goes with it.
   *
   * It follows him rather than sitting where he cast, because by the time it
   * plays he can already move - the stance came up with the burst a beat earlier
   * (docs/adr/0017). Measured off the reference: the mass is 36-42px across at
   * 0.40 of his height in front of him and 0.80-1.27 of it above the ground
   * (07_血之狂暴 f68-74), and the flash runs f65-70 over his head.
   */
  function drawRageGather(ctx, state, sprites, effect) {
    if (!sprites || !sprites.effects || !sprites.effects.width) return;
    var elapsed = effect.maxLife - effect.life;
    if (elapsed < effect.delay) return;
    var player = state.player;
    if (!player || player.dead) return;
    var span = Math.max(0.0001, effect.maxLife - effect.delay);
    var t = clamp01((elapsed - effect.delay) / span);
    /*
     * It gathers and then goes: the mass shrinks away over the back half instead
     * of blinking out, which is the difference between "gathering into his hand"
     * and "a puff that was there for a moment".
     */
    var shrink = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    if (shrink <= 0) return;
    /* 身位 is the height he is *drawn* at, which is taller than his body box. */
    var slayerHeight = player.height * 1.3;
    placeEffectCell(
      ctx,
      sprites.effects,
      EFFECT.rageGatherRow,
      rowAt(t, EFFECT.rageGatherFrames || 4),
      46 * shrink,
      player.x + player.facing * slayerHeight * 0.4,
      feetY(player) - slayerHeight,
      player.facing,
      shrink
    );
    /* The star opens the beat - see drawRageStar. */
    var starT = t / 0.45;
    if (starT > 1) return;
    drawRageStar(
      ctx,
      player.x,
      feetY(player) - slayerHeight,
      slayerHeight * 0.54,
      0.95 * (starT < 0.35 ? 1 : 1 - (starT - 0.35) / 0.65)
    );
  }

  /*
   * **The star over his head** - and it is the loudest thing in the whole
   * activation, which is why leaving it out made the release read as "a burst
   * and then some red".
   *
   * No client board ships this one. It is the game's own "buff applied" flash,
   * the same mark 暴走's reference draws (05_暴走 #63-68), and that is why 暴走's
   * row has a blood burst standing in for it (docs/adr/0016). Drawn live instead,
   * off `07_血之狂暴` f65-70: a white four-point core with cyan rays fanning off
   * it, 124x110px against a 230px Slayer - 0.54 x 0.48 of him - centred on his
   * own centre line with its middle at the top of his head, for six frames.
   */
  function drawRageStar(ctx, x, y, size, alpha) {
    if (alpha <= 0) return;
    var half = size / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    /* The rays: a fan of thin cyan spikes reaching past the core. */
    ctx.strokeStyle = "rgba(120, 196, 236, 0.9)";
    ctx.lineWidth = Math.max(1, size * 0.04);
    ctx.lineCap = "round";
    for (var i = 0; i < 12; i += 1) {
      var angle = (i / 12) * Math.PI * 2 + Math.PI / 12;
      var reach = half * (i % 3 === 0 ? 1.15 : 0.72);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * half * 0.25, Math.sin(angle) * half * 0.25);
      ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
      ctx.stroke();
    }
    /*
     * The core: a squat white four-point star. Two crossed diamonds rather than
     * one symmetric star, because the reference's is much wider than it is tall.
     */
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(0, -half * 0.3);
    ctx.lineTo(half, 0);
    ctx.lineTo(0, half * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -half * 0.8);
    ctx.lineTo(half * 0.22, 0);
    ctx.lineTo(0, half * 0.8);
    ctx.lineTo(-half * 0.22, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawEffect(ctx, state, effect, bannerOrdinal, sprites) {
    var alpha = clamp01(effect.life / effect.maxLife);
    /*
     * An effect's own depth, for the kinds that live on the floor. The banner
     * reads it too but never uses it: it is placed against the frame, not the
     * room. Damage numbers ride their target's depth, baked in when they were
     * spawned, so a hit lands over the body that took it and not over the line
     * the body used to stand on.
     */
    var ey = feetY(effect);
    if (effect.kind === "damage") {
      var rise = (1 - alpha) * 28;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.6);
      /*
       * A miss rides the damage effect because it *is* that hit's readout -
       * there is just no number in it. It is smaller and grey-blue rather than
       * gold, so "I did nothing" can never read as "I did damage"
       * (docs/adr/0018).
       */
      ctx.font = effect.miss
        ? "bold 15px 'Segoe UI', system-ui, sans-serif"
        : "bold 20px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(12, 14, 24, 0.9)";
      ctx.strokeText(effect.text, effect.x, ey - rise);
      ctx.fillStyle = effect.miss ? "#b9c6d8" : "#ffe08a";
      ctx.fillText(effect.text, effect.x, ey - rise);
      ctx.restore();
    } else if (effect.kind === "heal") {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "bold 18px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(12, 24, 16, 0.9)";
      ctx.strokeText(effect.text, effect.x, ey - (1 - alpha) * 26);
      ctx.fillStyle = "#8dffb0";
      ctx.fillText(effect.text, effect.x, ey - (1 - alpha) * 26);
      ctx.restore();
    } else if (effect.kind === "bloodStrand") {
      drawBloodStrand(ctx, state, effect, sprites);
    } else if (effect.kind === "bloodFlash") {
      drawBloodFlash(ctx, effect);
    } else if (effect.kind === "bloodHeal") {
      drawBloodHeal(ctx, effect, state);
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
        ctx.ellipse(effect.x, ey, effect.radius, effect.radius * DEPTH.scale, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (effect.dir) {
        ctx.beginPath();
        ctx.moveTo(effect.x, ey);
        ctx.lineTo(effect.x + effect.dir * effect.radius, ey);
        ctx.stroke();
      }
      if (effect.text) {
        ctx.globalAlpha = 0.55 + 0.4 * (1 - alpha);
        ctx.fillStyle = "#ffd2c4";
        ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(effect.text, effect.x, ey - 10);
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
        ey,
        effect.radius * (1.15 - alpha * 0.35),
        effect.radius * DEPTH.scale * (1.15 - alpha * 0.35),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.restore();
    } else if (effect.kind === "rageGather") {
      drawRageGather(ctx, state, sprites, effect);
    } else if (effect.kind === "ghost") {
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = PALETTE.ghost;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(effect.x, ey, effect.radius, -0.95, 0.95);
      ctx.stroke();
      ctx.restore();
    } else if (effect.kind === "collapse") {
      /* Dust, and grit thrown up out of the hole. */
      var fall = 1 - alpha;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.2);
      ctx.fillStyle = "rgba(38, 30, 34, 0.72)";
      ctx.beginPath();
      ctx.ellipse(effect.x, ey, effect.radius * 0.96, effect.radius * DEPTH.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 168, 120, 0.75)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(
        effect.x,
        ey,
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
        ctx.fillRect(effect.x + spread, ey - lift, 3, 5);
      }
      ctx.restore();
    }

    if (effect.kind === "damage" && !effect.miss) {
      /* sparks around every damage number - but never around a miss: nothing
         connected, so nothing flies off it (docs/adr/0018). */
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
        ctx.moveTo(effect.x + Math.cos(angle) * inner, ey + Math.sin(angle) * inner);
        ctx.lineTo(effect.x + Math.cos(angle) * outer, ey + Math.sin(angle) * outer);
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
      /*
       * A toggle stance that is up says so on its own slot, and that is the whole
       * read for "血之狂暴 is running": the reference draws nothing round him and
       * no icon over his head, so without this the only sign would be the colour
       * of his body (docs/adr/0017). It is UI rather than an effect, which is
       * exactly why it is allowed to exist where the aura was not.
       */
      var stanceUp = !!(
        skill &&
        skill.buff &&
        skill.buff.toggle &&
        player.buffs[skill.buff.id] > 0
      );

      ctx.save();
      ctx.fillStyle = stanceUp
        ? "rgba(62, 14, 22, 0.95)"
        : ready
          ? "rgba(20, 28, 48, 0.92)"
          : "rgba(12, 14, 24, 0.9)";
      roundRect(ctx, slot.x, slot.y, slot.w, slot.h, 6);
      ctx.fill();
      ctx.strokeStyle = skill
        ? stanceUp
          ? "rgba(240, 84, 96, 0.95)"
          : ready
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

    /*
     * **魔狱血刹's key, drawn where this game says which keys exist.** It is not
     * a slot - the twelve are the player's own arrangement and it is not in them
     * (docs/adr/0025) - so it gets a tile of its own at the end of the bar rather
     * than a thirteenth cell. The first cut of this slice had no tile at all, and
     * the owner played it and reported the only thing there was to report:
     * 「没看到技能」. A move the bar cannot show is a move nobody finds.
     *
     * While the sword is on his back the tile lights the way a stance's slot does
     * - same read, same reason - and carries the seconds left, because until the
     * sword's own white warning lands (the next slice) there is no other read of
     * a fifty-second clock.
     */
    if (!compact) {
      var swordSeconds = player.buffs.hellbenter || 0;
      var swordUp = swordSeconds > 0;
      /*
       * 觉醒 is an ordinary cooldown skill now, so its tile reads like every other
       * one: gold while it is ready, grey while it is not (see Core's
       * `hellbenter.cooldown`). "一局一次" was never true - there was no gate -
       * and the owner has said what he wants instead: 「觉醒不能一局一次，像普通技能
       * 一样有冷却」.
       */
      var swordCd = Math.max(0, player.skillCooldowns.hellbenter || 0);
      var swordReady = swordCd <= 0 && !player.dead;
      var tile = {
        x: BAR.x + SLOT_COLS * (BAR.slotW + BAR.gap),
        y: BAR.y,
        w: BAR.slotW,
        h: BAR.slotH * 2 + BAR.rowGap
      };
      ctx.save();
      ctx.fillStyle = swordUp
        ? "rgba(62, 14, 22, 0.95)"
        : swordReady
          ? "rgba(20, 28, 48, 0.92)"
          : "rgba(12, 14, 24, 0.9)";
      roundRect(ctx, tile.x, tile.y, tile.w, tile.h, 6);
      ctx.fill();
      ctx.strokeStyle = swordUp
        ? "rgba(240, 84, 96, 0.95)"
        : swordReady
          ? "rgba(226, 191, 114, 0.85)"
          : "rgba(96, 106, 136, 0.6)";
      ctx.lineWidth = 1.4;
      roundRect(ctx, tile.x + 0.7, tile.y + 0.7, tile.w - 1.4, tile.h - 1.4, 6);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("V", tile.x + 10, tile.y + 20);
      ctx.fillStyle = swordUp ? PALETTE.text : "rgba(198, 208, 228, 0.7)";
      ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText("魔狱血刹", tile.x + 10, tile.y + 41);
      ctx.fillStyle = swordUp ? "rgba(240, 140, 150, 0.95)" : "rgba(150, 160, 190, 0.6)";
      ctx.font = "600 11px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillText(
        swordUp
          ? "持剑 " + Math.ceil(swordSeconds) + "s · 再按落下"
          : swordReady
            ? "觉醒 · 按 V 起手"
            : "冷却 " + Math.ceil(swordCd) + "s",
        tile.x + 10,
        tile.y + 64
      );
      ctx.restore();
    }
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
        ["← → ↑ ↓", "移动（↑ ↓ 走进 / 走出屏幕）"],
        ["C / Space", "跳跃"],
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

  /*
   * How far apart two things that belong together are pushed in the sort. The
   * Slayer's own rows ride on him - they are drawn around his blade, not at a
   * place on the floor - so they need an offset to sit either side of him
   * instead of exactly on him. One z is a fifth of a screen pixel: far too small
   * to see, and far larger than any noise in a z.
   */
  var LAYER_GAP = 1;

  /**
   * Everything standing in the room, one pass, back to front.
   *
   * The frame used to be a hand-written painter's order with the caster's art
   * pinned between two halves of the bodies. That stops working once two things
   * can stand at different depths: a monster the player has walked behind has to
   * be painted before him, one he is standing in front of has to be painted
   * after, and the rift he left burning on the floor has to be painted under
   * both of them.
   *
   * So everything gets a depth and the list is sorted, far end first. Only two
   * kinds of thing are not simply "where it stands": the Slayer's own art, which
   * belongs to him and takes his depth plus or minus the gap (the rows that go
   * behind him, the rows that go in front), and a field, which belongs to the
   * spot it was opened on and is drawn either side of *that* - a rift he opened
   * four Slayer-heights in stays there when he walks back to the camera.
   *
   * A body level with the player still counts as behind him: the sort is stable
   * and the bodies go into the list before he does, which is what keeps a
   * monster he is standing on top of from hiding his sprite.
   */
  function drawWorld(ctx, state, sprites) {
    var player = state.player;
    var playerZ = (player && player.z) || 0;
    var items = [];

    function add(z, draw) {
      items.push({ z: z || 0, draw: draw });
    }

    state.enemies.forEach(function (enemy) {
      add(enemy.z, function () {
        drawEnemy(ctx, state, enemy);
      });
    });
    (state.projectiles || []).forEach(function (shot) {
      add(shot.z, function () {
        drawProjectile(ctx, state, shot);
      });
    });
    (state.pickups || []).forEach(function (drop) {
      add(drop.z, function () {
        drawDrop(ctx, state, drop, sprites);
      });
    });

    var behind = playerZ + LAYER_GAP;
    var inFront = playerZ - LAYER_GAP;
    add(behind, function () {
      drawRageSlash(ctx, state, sprites);
    });
    add(behind, function () {
      drawSkillEffect(ctx, state, sprites);
    });
    (state.fields || []).forEach(function (field) {
      add((field.z || 0) + LAYER_GAP, function () {
        drawField(ctx, state, sprites, "back", field);
      });
    });
    add(behind, function () {
      drawDiveSlash(ctx, state, sprites);
    });
    /* 魔狱血刹's 血气之剑 rides on his back, so it takes his depth and stays
       behind him - the same gap the rest of his own art uses. The 成形 goes in
       with it: it is the same object, half a second earlier. */
    add(behind, function () {
      drawBloodSword(ctx, state, sprites);
    });
    add(behind, function () {
      drawSwordForm(ctx, state, sprites);
    });
    add(playerZ, function () {
      drawPlayer(ctx, state, sprites);
    });
    add(inFront, function () {
      drawSkillEffectFront(ctx, state, sprites);
    });
    /* 血之狂暴's blood blade passes in front of him as well as behind - see
       drawRageBlade for why it is the same blade twice and not two blades. */
    add(inFront, function () {
      drawRageBladeFront(ctx, state, sprites);
    });
    (state.fields || []).forEach(function (field) {
      add((field.z || 0) - LAYER_GAP, function () {
        drawField(ctx, state, sprites, "front", field);
      });
    });

    /* Far end of the floor first, so the near end paints over it. */
    items.sort(function (a, b) {
      return b.z - a.z;
    });
    items.forEach(function (item) {
      item.draw();
    });
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

    /*
     * Everything in the room - bodies, the Slayer, the art he casts and the
     * ground he leaves burning - in one pass, ordered by depth. See drawWorld.
     */
    drawWorld(ctx, state, sprites);
    var bannerOrdinal = 0;
    state.effects.forEach(function (effect) {
      if (effect.kind === "banner" && overlayOpen) return;
      drawEffect(
        ctx,
        state,
        effect,
        effect.kind === "banner" ? bannerOrdinal++ : 0,
        sprites
      );
    });
    ctx.restore();

    drawVignette(ctx, state);
    /*
     * 魔狱血刹's 觉醒插画 goes over the room and under the HUD: the reference
     * paints its own bar over the picture, and so does this one - the illustration
     * takes the corner the bar does not.
     */
    drawAwakening(ctx, state, sprites);
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
    /* 魔狱血刹's two live-drawn numbers, so tests can pin them to the sheets. */
    BLOOD_SWORD: SWORD,
    BLOOD_SWORD_FORM: SWORD_FORM,
    CUT_IN: CUT_IN,
    attackColumn: attackColumn,
    playerFrame: playerFrame,
    flareFlash: flareFlash,
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
