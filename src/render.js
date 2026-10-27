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
   * **HUD 的左右边界量的是世界窗口的边，不是画布的边**（`docs/adr/0040`）。
   *
   * 世界收成居中的 4:3（720 宽）之后，画布左右各 120 px 是黑边；靠左靠右的 HUD
   * 若还按 0 与 960 摆，就会摆进黑边里 —— 而录像的 HUD 一律压在游戏画面**之内**
   * （它的地图窗口、目标条、日志全在 1440 那块里，没有一样画在黑边上）。
   *
   * **以 480 居中的东西不受影响**（120 + 720/2 = 480）：提示条、强化卡、胜负画面、
   * 地区地图、标题、房名牌全在这一档，所以它们一个字都不用动。
   */
  var VIEW = Core.VIEW;
  var HUD_LEFT = VIEW.left;
  var HUD_RIGHT = VIEW.left + VIEW.width;
  /*
   * **界面那一套美术画在世界里时不是 1:1。**
   *
   * 怪的图我们按 1 客户端像素 = 1 世界像素烘（`docs/adr/0028`），那条换算里
   * 1 世界像素 = 265/84 = 3.155 视频像素。可是**界面**那几样在录像里是另一个比例：
   * 脚下那颗椭圆 81 px 的画在录像里占 130 视频px、关卡名那 272 px 的画占 443 ——
   * 两样都是 **≈1.6 视频像素 / 画像素**，不是 3.155。所以画它们时要乘
   * `1.6 ÷ 3.155 = 0.507`。
   *
   * 这条**只管界面那几件**（椭圆、冠军光环、开箱、关卡名），不管怪与布景 ——
   * 怪那边牛头巨兽量下来正好是 1:1（录像 555 视频px 对本作 536），所以两边不是
   * 同一个比例，别把这条推广过去（`docs/adr/0042`）。
   */
  /* 1.6 视频px/画px ÷ 3.155 视频px/世界px = 0.507。 */
  var UI_SCALE = (1.6 * 84) / 265;
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
    /*
     * **The run is the client's eight frames 105-112, played at 15fps.**
     * 105-108 and 109-112 are the **two 4-frame strides** of the client's run
     * (they match frame for frame), and 113-116 is the thrust at the end of a
     * dash, not the run. At 15fps the 8-frame row is 0.533s = two 0.267s
     * strides, which is the recording's cadence; the first 30fps cut played
     * both strides in 0.267s and the owner read it as "hopping" (2026-10-20).
     */
    frames: { idle: 4, run: 8, attack: 27, skill: 6, extras: 6 },
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

  /* Hotbar: DNF's two rows of six (A S D F G H / Q W E R T Y). */
  var SLOT_COUNT = 12;
  var SLOT_COLS = 6;
  /*
   * 录像的底部技能栏是**紧凑方槽**，不是本作原来的长条 + 技能名。
   * 6 列 × 2 行（A S D F G H / Q W E R T Y），贴在窗口右下角；
   * 位置先用 40px 槽估，等 HUD 原件量完再按录像px微调。
   */
  var BAR = {
    /*
     * 录像 A–H 一排在**游戏画面 x860..1295**（band-316.png 逐格量），不是 166；
     * y1000..1072、每格 ≈72×72。折半后 x430 → 画布 550，格宽 36.25。
     * 第二排（Q–Y）按条目的 6+6 决定叠在上面，见 `slotButtons`。
     */
    x: 120 + 430,
    y: 540 - 76,
    slotW: 36.25,
    slotH: 36,
    gap: 0,
    rowGap: 0
  };
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

  /* Loadout panel: every skill as a draggable tile, shown while arranging. */
  var PANEL = { x: HUD_LEFT + 16, y: ARENA.height - 330, w: 696, h: 160, tileW: 104, tileH: 56, gap: 8 };

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
    var slots = skillBarButtons();
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

  /*
   * 幽暗密林's room art: the client's own forest set **02**, baked into
   * `assets/forest.png` by `assets/import_dnf_scene.py`.
   *
   * A client room is not one picture. It is a `far` panorama, a `mid` layer that
   * carries the trees, four `tile` ground strips that repeat across the floor,
   * and numbered `obj` props (`docs/granfloris-assets.md` 第三节). `docs/adr/0028`
   * is where the set number comes from: that document's own guess was 01, and
   * the owner's recording said otherwise.
   *
   * Every rect is in the sheet's own pixels and every piece is already cropped
   * to its ink, so a piece is placed by **where its bottom edge goes**: the foot
   * of a trunk, the front edge of a rock. The three ground strips are the only
   * pieces that are laid end to end instead.
   */
  /*
   * **雨**（`docs/adr/0057`）：客户端 `sprite/map/rain.img`（两条 5×43 的白色雨丝）
   * 与 `sprite/map/raindrop.img`（7 帧落地溅点）。它们被烘进 `assets/weather.png`
   * （`assets/import_dnf_weather.py`）。
   *
   * 参考里雨是**屏幕空间**的一层：细、近垂直略向左斜、低不透明度，静帧几乎看不见。
   * 所以这里画两层（远小暗慢 / 近大亮快），落在房间的地面带上有淡溅点。雨不参与判定。
   */
  var WEATHER = {
    rain: [[0, 0, 5, 43], [6, 0, 5, 22]],
    raindrop: [
      [12, 0, 5, 3], [18, 0, 9, 11], [28, 0, 15, 13],
      [44, 0, 17, 13], [62, 0, 19, 13], [82, 0, 20, 14], [103, 0, 22, 14]
    ],
    /*
     * 960×540 上约 95 条（业主 grill 选的是轻雨、两层）。远层 55 条、近层 40 条；
     * 速度是屏幕像素/秒，风把雨丝略往右推。
     */
    /*
     * **The reference's rain leans the other way and is longer.** 把 1:10 的
     * 时间中位数减掉后，最长的几条雨丝是 128–174 视频像素高、角度 **99–102°**
     * （从 +x 量，即**顶部偏右 / 底部偏左**，离竖直约 10°）。我们第一版是
     * `-0.10`（顶部偏左）且只有 42 px 长 —— 方向和长度都错了。
     * 现在按 960×540 折：近层约 70 px、远层约 40 px，角度 +10°，风往左吹。
     */
    layers: [
      { count: 55, scale: 0.95, speed: 430, alpha: 0.16, wind: -76 },
      { count: 40, scale: 1.65, speed: 760, alpha: 0.25, wind: -134 }
    ],
    angle: 0.18,
    /* 溅点：14 个槽位轮转，每槽 1.2 秒一次；7 帧放 0.35 秒。 */
    splashSlots: 14,
    splashPeriod: 1.2,
    splashLife: 0.35
  };

  /*
   * **牛头巨兽自己的五块死亡碎块**（`metacowpiece.img`，烘成 `assets/bossdeath.png`）。
   * 大块棕红肉片 + 三块小的；`chunk_boss*` 那套通用血花不再用于领主
   * （`docs/adr/0034` 追记二：参考里的碎块是它自己的肉，不是血泊）。
   */
  var BOSSPIECE = {
    frames: [
      [0, 0, 29, 29],
      [30, 0, 11, 12],
      [42, 0, 16, 15],
      [59, 0, 22, 21],
      [82, 0, 6, 7]
    ]
  };

  var SCENE = {
    pieces: {
      far: [0, 0, 640, 375],
      mid: [640, 0, 640, 380],
      tile0: [0, 380, 224, 203],
      tile1: [224, 380, 224, 233],
      tile2: [448, 380, 224, 233],
      tile3: [672, 380, 224, 235],
      trunkTall: [896, 380, 203, 422],
      trunkBent: [1099, 380, 143, 423],
      trunkMossy: [0, 803, 160, 428],
      treeLeafy: [160, 803, 153, 203],
      hut: [0, 0, 222, 198],
      pillarPale: [0, 0, 44, 111],
      /* Same art as pillarPale, but art-only: no collision / door clearance. */
      pillarDecor: [0, 0, 44, 111],
      gateBlock: [0, 0, 157, 198],
      doorBlock: [157, 0, 73, 132],
      /*
       * 清房后门拱上那层符文光（客户端 `granflorisuplight01/02`，蓝/橙两帧），
       * 画在 `gateBlock` 那张表的右半边（`assets/import_dnf_gate.py`）。
       */
      gateLight: [230, 0, 122, 171],
      gateLight2: [352, 0, 122, 171],
      stump: [313, 803, 105, 199],
      wallStone: [418, 803, 167, 125],
      rockFlat: [585, 803, 141, 89],
      rockSmall: [726, 803, 42, 44],
      pillar: [768, 803, 44, 111],
      bush: [812, 803, 64, 59],
      flower: [876, 803, 30, 55],
      grass: [906, 803, 39, 87],
      grassFlower: [945, 803, 188, 78],
      sprout: [1133, 803, 126, 66],
      firSmall: [0, 1231, 42, 59],
      firMid: [42, 1231, 43, 71],
      firTall: [85, 1231, 44, 78],
      pebble: [129, 1231, 24, 27],
      snagTall: [153, 1231, 139, 207],
      fallenTrunk: [292, 1231, 226, 340],
      stumpBroken: [518, 1231, 78, 112],
      trunkHollow: [596, 1231, 133, 178],
      snagShort: [729, 1231, 97, 104],
      snagStub: [826, 1231, 87, 101],
      ruinStone: [913, 1231, 142, 103],
      rockArch: [1055, 1231, 195, 180],
      logMossy: [0, 1571, 317, 175],
      grassPatch: [317, 1571, 110, 48],
      treeDead: [427, 1571, 105, 277],
      treeDeadTall: [532, 1571, 175, 303],
      leaves: [707, 1571, 126, 66],
      leavesBroad: [833, 1571, 126, 66],
      leavesDense: [959, 1571, 126, 66],
      gate: [1085, 1571, 131, 240],
      gateUp: [0, 1874, 157, 198],
      gateDown: [157, 1874, 192, 118],
      door: [349, 1874, 50, 171],
      doorUp: [399, 1874, 73, 132],
      doorDown: [472, 1874, 88, 46],
      barrel: [560, 1874, 63, 78],
      chest: [623, 1874, 86, 56],
      tomb: [709, 1874, 135, 108],
      barrel1: [844, 1874, 25, 21],
      barrel2: [869, 1874, 41, 13],
      barrel3: [910, 1874, 29, 10],
      barrel4: [939, 1874, 33, 14],
      barrel5: [972, 1874, 16, 25],
      barrel6: [988, 1874, 31, 24],
      barrel7: [1019, 1874, 38, 16],
      barrel8: [1057, 1874, 25, 9],
      barrel9: [1082, 1874, 46, 22],
      barrel10: [1128, 1874, 44, 21],
      barrel11: [1172, 1874, 28, 22],
      barrel12: [1200, 1874, 42, 16],
      chest1: [0, 2072, 87, 61],
      chest2: [87, 2072, 108, 66],
      tomb1: [195, 2072, 25, 25],
      tomb2: [220, 2072, 34, 17],
      tomb3: [254, 2072, 29, 15],
      tomb4: [283, 2072, 25, 18],
      tomb5: [308, 2072, 19, 17],
      tomb6: [327, 2072, 12, 14],
      tomb7: [339, 2072, 13, 8],
      chunk_boss0: [352, 2072, 22, 21],
      chunk_brute0: [374, 2072, 22, 21],
      chunk_caster0: [396, 2072, 22, 21],
      chunk_coward0: [418, 2072, 22, 21],
      chunk_elite0: [440, 2072, 22, 21],
      chunk_grunt0: [462, 2072, 22, 21],
      chunk_boss1: [484, 2072, 34, 25],
      chunk_brute1: [518, 2072, 34, 25],
      chunk_caster1: [552, 2072, 34, 25],
      chunk_coward1: [586, 2072, 34, 25],
      chunk_elite1: [620, 2072, 34, 25],
      chunk_grunt1: [654, 2072, 34, 25],
      chunk_boss2: [688, 2072, 40, 25],
      chunk_brute2: [728, 2072, 40, 25],
      chunk_caster2: [768, 2072, 40, 25],
      chunk_coward2: [808, 2072, 40, 25],
      chunk_elite2: [848, 2072, 40, 25],
      chunk_grunt2: [888, 2072, 40, 25],
    },

    /* [piece, dx, dy] - see barrelBreak in src/render.js */
    barrelBreak: [
      ["barrel1", 19, 28],
      ["barrel2", 11, 32],
      ["barrel3", 17, 34],
      ["barrel4", 15, 32],
      ["barrel5", 23, 26],
      ["barrel6", 16, 27],
      ["barrel7", 12, 31],
      ["barrel8", 19, 34],
      ["barrel9", 8, 28],
      ["barrel10", 9, 28],
      ["barrel11", 17, 28],
      ["barrel12", 10, 31],
    ],

    /* [piece, dx, dy] - the chest's two opening frames */
    chestBreak: [
      ["chest1", -2, -5],
      ["chest2", -23, -10],
    ],

    /* [piece, dx, dy] - the tomb's seven stone pieces */
    tombBreak: [
      ["tomb1", 5, 0],
      ["tomb2", 1, 4],
      ["tomb3", 3, 5],
      ["tomb4", 5, 4],
      ["tomb5", 8, 4],
      ["tomb6", 12, 6],
      ["tomb7", 11, 9],
    ],


    /*
     * The ground, left to right. `tile0` is a short one (203 against their 233),
     * so it is not in the run: strips of different heights would leave a ragged
     * top edge, and the top edge is the line the floor meets the trees on.
     *
     * **这个顺序是量出来的，不是 1-2-3**（`docs/adr/0032`）：三张图的顶边缺口天生
     * 接得上，但只在 **tile2 → tile1 → tile3** 这个循环里 —— tile2 末列 39/38/39
     * 接 tile1 首列 40/39/38 ✓、tile1 末列 7/9 接 tile3 首列 6/8 ✓、tile3 末列 9/11
     * 接 tile2 首列 9/7 ✓。按 1→2→3 摆会在 x=672 处留下 11→40 的一道 30 像素竖台阶。
     */
    ground: ["tile2", "tile1", "tile3"],
    /*
     * `mid` 那张图里**树根线在第 316 行、底下还有 63 行是草**（`docs/adr/0032`）。
     * 地面条顶上那些缺口（客户端原图就带，每张 224 列里有 217 列有缺口）在客户端里
     * 透出来的正是这 63 行草裙 —— 客户端的摆位就是让根线落在地面顶边上。所以缺口后面
     * 要**再铺一遍 mid、裁到接缝以下**（`drawBackdrop`），缺口里露出的才是草，不是画布。
     */
    midSkirt: 63,
    /*
     * **贴花**：长在地上的**矮**花草，不参加"站着的东西"那个按身位排的队 ——
     * 一律画在所有人、怪、道具之前，人踩在草上面，**它们不遮人**（业主 2026-10-10 定的）。
     *
     * **`grass`（那一丛高草）不在这一档里了**：录像里它**画在他的裤腿前面**，
     * 也就是说它得按身位排。业主 2026-10-12 照录像把这条改了（Q12 选 c）——
     * 高草**挡画不挡路**：它不占身位、不挡判定，只是画的时候排在他前面。
     * 它已经有 `depth`（房间数据里本来就写了），所以只要从这一档拿出去，
     * 它就自动落进 `drawWorld` 那个按身位排的队里。
     *
     * 木桶、石头、树、树桩、柱子那些**立着的实心件**照样按身位排（`docs/adr/0032`）。
     */
    decals: [
      "grassFlower", "sprout", "flower", "bush",
      /*
       * 02 套里那几片**贴地平铺**的 —— 录像里满地就是这种东西（一屏 8–16 丛）。
       * `pebble` 是一粒小石子，同样的道理：没人会以为自己被一粒石子挡住。
       */
      "grassPatch", "leaves", "leavesBroad", "leavesDense", "pebble"
    ],
    /*
     * How far above the band's back edge the ground's own top edge is drawn. The
     * strips are already grass right to their last row, so this only has to
     * close the seam between the band and the `mid` layer's feet.
     */
    groundLift: 6,
    /* The `mid` layer's own ground line sits on the band's back edge. */
    midLift: 0
  };

  /*
   * 哪一件布景碎开时放哪张碎片表：木桶十二块木片、宝箱两帧开盖、石碑七块石头。
   * 表本身都在 `SCENE` 里（由 `assets/import_dnf_scene.py --table` 印出来）。
   */
  function breakTableFor(piece) {
    if (piece === "chest") return SCENE.chestBreak;
    if (piece === "tomb") return SCENE.tombBreak;
    return SCENE.barrelBreak;
  }


  function sceneRect(name) {
    return SCENE.pieces[name] || null;
  }

  /*
   * The map window: the little dungeon map in the corner of a room.
   *
   * It is the client's own art - `assets/minimap.png`, baked by
   * `assets/import_dnf_minimap.py` - where **one 18x18 tile is one cell of the
   * dungeon**, holding either a room or a corridor and a stub towards every
   * neighbour it links to. `Core.dungeonFor` decides which cell is which shape
   * (the shape itself is measured off the recording, `docs/adr/0030`); this file
   * only says which column of the sheet that shape is.
   *
   * Everything about the window is measured off the owner's recording
   * (`assets/dnf_src/bilibili/BV1d24y1P74G.mp4`, 幽暗密林, the map window in the
   * top-right from 76s on, `docs/adr/0029`):
   *
   * - the tile is drawn **1:1**, the client's own 18 px against this game's 84 px
   *   Slayer - the same 22% of a body the recording shows;
   * - the title bar's brown `(57,48,39)`, its cream text and its button
   *   `(185,173,153)`, the room's khaki `(112,116,47)`, the boss marker's red
   *   `(233,74,0)` and the player's blue `(25,194,255)` are all sampled from it;
   * - the reference draws the whole map in the tile set's **dim** family, not the
   *   bright one (sampled at 90s and again at 250s).
   */
  /*
   * **界面那一张（`assets/ui.png`，`docs/adr/0042`）**：每一样都对着业主录像里的
   * 一帧。它不是"场景"不是"怪"，所以自己一张表、自己一张图 —— 表由
   * `assets/import_dnf_ui.py --table` 生成，**别手抄也别手改**。
   *
   * `cell` 是一段动画的固定单元格，`anchor` 是 `.img` 那张图自己的原点落在这格里的
   * 位置，`ink` 是这一段的**画**在格子里占的框 —— 关卡名要对屏幕某点的中心、
   * 脚下的椭圆要对他的脚，那两样都不是原点，所以两个都留着。
   *
   * 两个坑记在这里：
   * - **过场插画的画框客户端没有**（`sprite_map_cutscene.NPK` 那张 800x600 是光板；
   *   全客户端 639 张大图里没有框这种东西）—— 所以照录像里那张**画**烘，不自己画框。
   * - **脚下的椭圆与冠军光环是画在黑底上的**（角落不透明且黑），烘的时候要抠掉；
   *   标题与评级字母自带透明通道，抠了反而会在深色的美术上打洞（`import_dnf_ui.py`）。
   */
  var UI = {
    /* generated by assets/import_dnf_ui.py --table - do not hand-edit */
    cutscene: { cell: [800, 600], anchor: [0, 0], ink: [0, 0, 800, 600], frames: [
      [0, 0, 800, 600],
    ]},
    stageTitle: { cell: [272, 98], anchor: [9, 20], ink: [0, 0, 272, 98], frames: [
      [800, 0, 272, 98],
      [1072, 0, 272, 98],
      [0, 600, 272, 98],
      [272, 600, 272, 98],
      [544, 600, 272, 98],
      [816, 600, 272, 98],
      [1088, 600, 272, 98],
      [0, 698, 272, 98],
      [272, 698, 272, 98],
      [544, 698, 272, 98],
      [816, 698, 272, 98],
      [1088, 698, 272, 98],
      [0, 796, 272, 98],
      [272, 796, 272, 98],
    ]},
    champdark: { cell: [198, 213], anchor: [0, 0], ink: [1, 21, 172, 190], frames: [
      [544, 796, 198, 213],
      [742, 796, 198, 213],
      [940, 796, 198, 213],
      [1138, 796, 198, 213],
      [1336, 796, 198, 213],
      [0, 1009, 198, 213],
      [198, 1009, 198, 213],
      [396, 1009, 198, 213],
      [594, 1009, 198, 213],
      [792, 1009, 198, 213],
      [990, 1009, 198, 213],
      [1188, 1009, 198, 213],
      [1386, 1009, 198, 213],
      [0, 1222, 198, 213],
      [198, 1222, 198, 213],
      [396, 1222, 198, 213],
    ]},
    champdarkback: { cell: [230, 315], anchor: [0, 0], ink: [0, 70, 216, 224], frames: [
      [594, 1222, 230, 315],
      [824, 1222, 230, 315],
      [1054, 1222, 230, 315],
      [1284, 1222, 230, 315],
      [0, 1537, 230, 315],
      [230, 1537, 230, 315],
      [460, 1537, 230, 315],
      [690, 1537, 230, 315],
      [920, 1537, 230, 315],
      [1150, 1537, 230, 315],
      [0, 1852, 230, 315],
      [230, 1852, 230, 315],
    ]},
    champfire: { cell: [191, 220], anchor: [0, 0], ink: [16, 10, 169, 207], frames: [
      [460, 1852, 191, 220],
      [651, 1852, 191, 220],
      [842, 1852, 191, 220],
      [1033, 1852, 191, 220],
      [1224, 1852, 191, 220],
      [0, 2167, 191, 220],
      [191, 2167, 191, 220],
      [382, 2167, 191, 220],
      [573, 2167, 191, 220],
      [764, 2167, 191, 220],
    ]},
    champfireback: { cell: [233, 367], anchor: [0, 0], ink: [23, 35, 204, 323], frames: [
      [955, 2167, 233, 367],
      [1188, 2167, 233, 367],
      [0, 2534, 233, 367],
      [233, 2534, 233, 367],
      [466, 2534, 233, 367],
      [699, 2534, 233, 367],
      [932, 2534, 233, 367],
      [1165, 2534, 233, 367],
      [0, 2901, 233, 367],
      [233, 2901, 233, 367],
      [466, 2901, 233, 367],
      [699, 2901, 233, 367],
    ]},
    dropMark: { cell: [81, 28], anchor: [0, 0], ink: [1, 1, 79, 25], frames: [
      [932, 2901, 81, 28],
      [1013, 2901, 81, 28],
      [1094, 2901, 81, 28],
      [1175, 2901, 81, 28],
      [1256, 2901, 81, 28],
      [1337, 2901, 81, 28],
    ]},
    chestOpen: { cell: [131, 76], anchor: [32, 82], ink: [0, 0, 131, 76], frames: [
      [1418, 2901, 131, 76],
      [0, 3268, 131, 76],
      [131, 3268, 131, 76],
    ]},
    rank: { cell: [169, 106], anchor: [29, 0], ink: [0, 0, 169, 106], frames: [
      [262, 3268, 169, 106],
      [431, 3268, 169, 106],
      [600, 3268, 169, 106],
      [769, 3268, 169, 106],
      [938, 3268, 169, 106],
      [1107, 3268, 169, 106],
      [1276, 3268, 169, 106],
      [0, 3374, 169, 106],
      [169, 3374, 169, 106],
      [338, 3374, 169, 106],
      [507, 3374, 169, 106],
      [676, 3374, 169, 106],
      [845, 3374, 169, 106],
      [1014, 3374, 169, 106],
      [1183, 3374, 169, 106],
      [1352, 3374, 169, 106],
      [0, 3480, 169, 106],
    ]},
    scoreDigit: { cell: [27, 30], anchor: [4, 0], ink: [0, 0, 27, 30], frames: [
      [169, 3480, 27, 30],
      [196, 3480, 27, 30],
      [223, 3480, 27, 30],
      [250, 3480, 27, 30],
      [277, 3480, 27, 30],
      [304, 3480, 27, 30],
      [331, 3480, 27, 30],
      [358, 3480, 27, 30],
      [385, 3480, 27, 30],
      [412, 3480, 27, 30],
    ]},
    rewardChest: { cell: [153, 97], anchor: [3, 3], ink: [0, 0, 153, 97], frames: [
      [439, 3480, 153, 97],
    ]},
    rewardMagic: { cell: [800, 600], anchor: [0, 0], ink: [20, 0, 734, 600], frames: [
      [592, 3480, 800, 600],
    ]},
    rewardCardFrame: { cell: [153, 97], anchor: [3, 3], ink: [0, 0, 153, 97], frames: [
      [1392, 3480, 153, 97],
    ]},
    rewardCardGem: { cell: [141, 61], anchor: [9, 9], ink: [0, 0, 141, 61], frames: [
      [0, 4080, 141, 61],
    ]},
    rewardNamePlate: { cell: [147, 58], anchor: [0, 0], ink: [0, 0, 147, 58], frames: [
      [141, 4080, 147, 58],
    ]},
    rewardBand: { cell: [732, 113], anchor: [0, 0], ink: [0, 0, 732, 113], frames: [
      [288, 4080, 732, 113],
    ]},
    rewardMagicPanel: { cell: [527, 270], anchor: [0, 0], ink: [0, 0, 527, 270], frames: [
      [1020, 4080, 527, 270],
    ]},
    rewardDigit: { cell: [87, 51], anchor: [28, 14], ink: [0, 0, 87, 51], frames: [
      [0, 4350, 87, 51],
      [87, 4350, 87, 51],
      [174, 4350, 87, 51],
      [261, 4350, 87, 51],
      [348, 4350, 87, 51],
      [435, 4350, 87, 51],
      [522, 4350, 87, 51],
      [609, 4350, 87, 51],
      [696, 4350, 87, 51],
      [783, 4350, 87, 51],
    ]},
  };

  /*
   * 战斗 HUD 的原件表（`assets/import_dnf_hud.py --table`，`docs/adr/0064`）。
   * 尺寸是客户端自己的，画的时候由 `drawHudFrame` 折到录像矩形。
   */
  var HUD_UI = {
    /* generated by assets/import_dnf_hud.py --table - do not hand-edit */
    hudBar: { cell: [800, 91], anchor: [0, 1], ink: [0, 0, 800, 91], frames: [
      [0, 0, 800, 91],
    ]},
    orbRed: { cell: [56, 56], anchor: [0, 0], ink: [0, 0, 56, 56], frames: [
      [800, 0, 56, 56],
    ]},
    orbBlue: { cell: [56, 56], anchor: [0, 0], ink: [0, 0, 56, 56], frames: [
      [856, 0, 56, 56],
    ]},
    slotFrame: { cell: [40, 39], anchor: [0, 0], ink: [0, 0, 40, 39], frames: [
      [912, 0, 40, 39],
    ]},
    menu: { cell: [65, 65], anchor: [0, 0], ink: [1, 1, 63, 63], frames: [
      [952, 0, 65, 65],
    ]},
    quest: { cell: [154, 52], anchor: [0, 0], ink: [0, 0, 154, 52], frames: [
      [1017, 0, 154, 52],
    ]},
    chat: { cell: [317, 146], anchor: [0, 0], ink: [0, 0, 317, 146], frames: [
      [1171, 0, 317, 146],
    ]},
  };

  /*
   * 城镇与 NPC 的原件表（`assets/import_dnf_town.py`，`docs/adr/0065`）。
   * 城镇套来自 `grenselos`，城门借艾尔文防线；NPC 是 `sprite_map_npc.NPK`。
   */
  var TOWN_UI = {
    pieces: {
      far: { rect: [0, 0, 640, 219], size: [640, 219], offset: [0, 0] },
      mid: { rect: [640, 0, 895, 258], size: [895, 258], offset: [0, 40] },
      tile: { rect: [0, 258, 224, 244], size: [224, 244], offset: [0, 236] },
      house1: { rect: [224, 258, 229, 217], size: [229, 217], offset: [1, 55] },
      house2: { rect: [453, 258, 230, 175], size: [230, 175], offset: [1, 92] },
      house3: { rect: [683, 258, 229, 216], size: [229, 216], offset: [1, 54] },
      house4: { rect: [912, 258, 294, 223], size: [294, 223], offset: [1, 55] },
      house5: { rect: [1206, 258, 246, 219], size: [246, 219], offset: [1, 55] },
      house6: { rect: [0, 502, 324, 228], size: [324, 228], offset: [1, 53] },
      brleft: { rect: [324, 502, 222, 147], size: [222, 147], offset: [0, 333] },
      brright: { rect: [546, 502, 222, 164], size: [222, 164], offset: [1, 275] },
      brrightblock: { rect: [768, 502, 187, 110], size: [187, 110], offset: [1, 185] },
      wall01: { rect: [955, 502, 224, 81], size: [224, 81], offset: [0, 175] },
      wall02: { rect: [1179, 502, 224, 81], size: [224, 81], offset: [0, 175] },
      wallleft: { rect: [1403, 502, 119, 81], size: [119, 81], offset: [0, 175] },
      wallright: { rect: [0, 730, 129, 81], size: [129, 81], offset: [0, 175] },
      tree1: { rect: [129, 730, 146, 114], size: [146, 114], offset: [1, 1] },
      tree2: { rect: [275, 730, 99, 224], size: [99, 224], offset: [1, 1] },
      pole1: { rect: [374, 730, 60, 189], size: [60, 189], offset: [1, 1] },
      pole2: { rect: [434, 730, 37, 142], size: [37, 142], offset: [1, 1] },
      pole3: { rect: [471, 730, 29, 29], size: [29, 29], offset: [1, 1] },
      sandbag1: { rect: [500, 730, 159, 82], size: [159, 82], offset: [1, 1] },
      sandbag2: { rect: [659, 730, 151, 77], size: [151, 77], offset: [1, 1] },
      crate1: { rect: [810, 730, 114, 91], size: [114, 91], offset: [1, 1] },
      crate2: { rect: [924, 730, 109, 86], size: [109, 86], offset: [1, 1] },
      gravelLarge: { rect: [1033, 730, 86, 25], size: [86, 25], offset: [1, 1] },
      gravelMid: { rect: [1119, 730, 69, 15], size: [69, 15], offset: [10, 6] },
      gravelSmall: { rect: [1188, 730, 45, 9], size: [45, 9], offset: [22, 9] },
      seriaHouse: { rect: [0, 954, 445, 381], size: [445, 381], offset: [27, 0] },
      gate: { rect: [445, 954, 170, 121], size: [170, 121], offset: [17, 16] },
    },
    runs: {
      gateDoor: { cell: [183, 77], anchor: [0, 0], frames: [[615, 954, 183, 77], [798, 954, 183, 77], [981, 954, 183, 77], [1164, 954, 183, 77], [1347, 954, 183, 77], [0, 1335, 183, 77], [183, 1335, 183, 77], [366, 1335, 183, 77], [549, 1335, 183, 77], [732, 1335, 183, 77]] },
      gateLight: { cell: [298, 121], anchor: [0, 0], frames: [[915, 1335, 298, 121], [1213, 1335, 298, 121], [0, 1456, 298, 121], [298, 1456, 298, 121], [596, 1456, 298, 121], [894, 1456, 298, 121], [1192, 1456, 298, 121], [0, 1577, 298, 121], [298, 1577, 298, 121], [596, 1577, 298, 121]] },
    }
  };
  var NPC_UI = {
    seria: { cell: [62, 143], anchor: [20, 20], frames: [[0, 0, 62, 143], [62, 0, 62, 143], [124, 0, 62, 143], [186, 0, 62, 143], [248, 0, 62, 143], [310, 0, 62, 143]] },
    minet: { cell: [49, 133], anchor: [28, 28], frames: [[372, 0, 49, 133], [421, 0, 49, 133], [470, 0, 49, 133], [519, 0, 49, 133], [568, 0, 49, 133], [617, 0, 49, 133], [666, 0, 49, 133], [715, 0, 49, 133], [764, 0, 49, 133], [813, 0, 49, 133], [862, 0, 49, 133], [911, 0, 49, 133]] },
    gsd: { cell: [75, 96], anchor: [5, 3], frames: [[960, 0, 75, 96], [1035, 0, 75, 96], [1110, 0, 75, 96], [1185, 0, 75, 96]] },
    kanna: { cell: [39, 106], anchor: [35, 69], frames: [[1260, 0, 39, 106], [1299, 0, 39, 106], [1338, 0, 39, 106], [1377, 0, 39, 106], [1416, 0, 39, 106], [1455, 0, 39, 106], [1494, 0, 39, 106], [1533, 0, 39, 106]] },
    brownie: { cell: [103, 79], anchor: [61, 62], frames: [[0, 143, 103, 79], [103, 143, 103, 79], [206, 143, 103, 79], [309, 143, 103, 79], [412, 143, 103, 79], [515, 143, 103, 79], [618, 143, 103, 79], [721, 143, 103, 79], [824, 143, 103, 79], [927, 143, 103, 79], [1030, 143, 103, 79], [1133, 143, 103, 79], [1236, 143, 103, 79], [1339, 143, 103, 79], [1442, 143, 103, 79], [0, 222, 103, 79], [103, 222, 103, 79], [206, 222, 103, 79], [309, 222, 103, 79], [412, 222, 103, 79], [515, 222, 103, 79], [618, 222, 103, 79], [721, 222, 103, 79], [824, 222, 103, 79], [927, 222, 103, 79], [1030, 222, 103, 79]] },
    sinda: { cell: [86, 97], anchor: [0, 8], frames: [[1133, 222, 86, 97], [1219, 222, 86, 97], [1305, 222, 86, 97], [1391, 222, 86, 97], [1477, 222, 86, 97], [0, 319, 86, 97], [86, 319, 86, 97], [172, 319, 86, 97], [258, 319, 86, 97], [344, 319, 86, 97], [430, 319, 86, 97], [516, 319, 86, 97], [602, 319, 86, 97], [688, 319, 86, 97], [774, 319, 86, 97]] },
    guard: { cell: [73, 191], anchor: [67, 12], frames: [[860, 319, 73, 191], [933, 319, 73, 191], [1006, 319, 73, 191], [1079, 319, 73, 191], [1152, 319, 73, 191], [1225, 319, 73, 191], [1298, 319, 73, 191], [1371, 319, 73, 191], [1444, 319, 73, 191], [1517, 319, 73, 191], [0, 510, 73, 191], [73, 510, 73, 191], [146, 510, 73, 191], [219, 510, 73, 191], [292, 510, 73, 191], [365, 510, 73, 191], [438, 510, 73, 191], [511, 510, 73, 191], [584, 510, 73, 191], [657, 510, 73, 191]] },
    guardCaptain: { cell: [75, 171], anchor: [60, 30], frames: [[730, 510, 75, 171], [805, 510, 75, 171], [880, 510, 75, 171], [955, 510, 75, 171], [1030, 510, 75, 171], [1105, 510, 75, 171], [1180, 510, 75, 171], [1255, 510, 75, 171], [1330, 510, 75, 171], [1405, 510, 75, 171], [1480, 510, 75, 171], [0, 701, 75, 171], [75, 701, 75, 171], [150, 701, 75, 171], [225, 701, 75, 171], [300, 701, 75, 171], [375, 701, 75, 171], [450, 701, 75, 171], [525, 701, 75, 171], [600, 701, 75, 171]] },
  };

  /* 商店/任务/背包/对话窗与物品图标（`assets/import_dnf_gui.py --table`）。 */
  var GUI_UI = {
    shop: { cell: [291, 380], anchor: [0, 0], frames: [[0, 0, 291, 380]] },
    quest: { cell: [291, 380], anchor: [0, 0], frames: [[291, 0, 291, 380]] },
    inventory: { cell: [291, 410], anchor: [0, 0], frames: [[582, 0, 291, 410]] },
    equipment: { cell: [291, 410], anchor: [0, 0], frames: [[873, 0, 291, 410]] },
    dialog: { cell: [618, 165], anchor: [0, 0], frames: [[0, 410, 618, 165]] },
    gold: { cell: [17, 21], anchor: [0, 0], frames: [[618, 410, 17, 21]] },
    chat: { cell: [317, 146], anchor: [0, 0], frames: [[635, 410, 317, 146]] },
    potion0: { rect: [952, 410, 28, 28], size: [28, 28] },
    potion1: { rect: [980, 410, 28, 28], size: [28, 28] },
    potion2: { rect: [1008, 410, 28, 28], size: [28, 28] },
    potion3: { rect: [1036, 410, 28, 28], size: [28, 28] },
    mat0: { rect: [1064, 410, 28, 28], size: [28, 28] },
    mat1: { rect: [1092, 410, 28, 28], size: [28, 28] },
    weapon0: { rect: [1120, 410, 28, 28], size: [28, 28] }
  };

  function drawGuiWindow(ctx, sprites, name, x, y, w, h) {
    var sheet = sprites && sprites.gui;
    var block = GUI_UI[name];
    if (!sheet || !block || !block.frames || !block.frames.length) return false;
    var r = block.frames[0];
    ctx.drawImage(sheet, r[0], r[1], r[2], r[3], x, y, w, h);
    return true;
  }

  var MINIMAP = {
    tile: 18,
    /*
     * **兜底的行列数**：真正的行列来自当前这一关的 `state.dungeon`（幽暗密林 4x3、
     * 幽暗密林深处 4x4，`docs/adr/0059`）。`drawMinimap` 直接读 state；触屏命中与
     * HUD 布局从 `meta.map.cols/rows` 读。这里只在没有地牢时兜底。
     */
    cols: 4,
    rows: 3,
    titleH: 16,
    /* Right and top margins, matching the rest of this game's HUD. */
    margin: 16,
    top: 14,
    touchTop: 74,
    /*
     * The window is not drawn by hand: it is the client's own panel as a
     * 9-slice, and the markers and the disc are cut out of the same atlas. Rects
     * are in `assets/minimap.png`, read off the bake's manifest.
     */
    pieces: {
      blank: [0, 18, 18, 18],
      /* 清房后邻接的未探索格：客户端的「?」图块（`assets/import_dnf_minimap.py`）。 */
      question: [22, 18, 18, 18],
      boss: [44, 18, 16, 14],
      marker: [64, 18, 14, 19],
      ring: [82, 18, 104, 104],
      tl: [190, 18, 5, 5],
      top: [199, 18, 18, 5],
      tr: [221, 18, 4, 5],
      left: [229, 18, 5, 18],
      centre: [238, 18, 18, 18],
      right: [260, 18, 4, 18],
      bl: [268, 18, 5, 4],
      bottom: [277, 18, 18, 4],
      br: [299, 18, 4, 4]
    },
    /*
     * Column of each shape in the sheet. The keys are `kind:exits`, the exits
     * being N/E/S/W in that order - the same table
     * `assets/import_dnf_minimap.py --table` prints.
     */
    tiles: {
      "corr:N": 0,
      "corr:E": 1,
      "corr:NE": 2,
      "corr:S": 3,
      "corr:NS": 4,
      "corr:ES": 5,
      "corr:NES": 6,
      "corr:NW": 7,
      "corr:EW": 8,
      "corr:NEW": 9,
      "corr:SW": 10,
      "corr:NSW": 11,
      "corr:ESW": 12,
      /*
       * **四向走廊**：客户端的 `act1.img` 没有单独的 `corr:NESW` 形状 —— 那个十字
       * 被 `import_dnf_minimap.py` 的"宽行/占比"判据归到了 `room:NESW`（第 20 帧），
       * 所以这里借同一张十字图块。幽暗密林深处 的中间一列/第二列都是四向走廊；
       * 不补这一条，地图上那几格会**什么都不画**（业主 2026-10-21 报的"中间的路没显示"）。
       */
      "corr:NESW": 20,
      "room:N": 13,
      "room:E": 14,
      "room:S": 15,
      "room:ES": 16,
      "room:W": 17,
      "room:NW": 18,
      "room:ESW": 19,
      "room:NESW": 20
    },
    /* The panel's own brown, read off the client's frame pieces. */
    panel: "#62543c",
    /* The two colours the hand-drawn fallbacks use, sampled off the recording. */
    boss: "#e94a00",
    marker: "#19c2ff",
    /*
     * The round "radar" form: the same tiles, clipped into a disc and centred on
     * the room the player is in, at twice the scale - which is what the
     * recording shows for the first twenty seconds of a run. The radius is the
     * client's disc read from the inside: the ring is 104 across and its hole
     * measures 93 (`--hole`), so the map is clipped just inside that and the
     * ring's own band covers the edge.
     */
    radarZoom: 2,
    radarRadius: 45
  };

  var MINIMAP_DIRS = [["N", 1], ["E", 2], ["S", 4], ["W", 8]];

  function exitsName(exits) {
    var name = "";
    MINIMAP_DIRS.forEach(function (pair) {
      if (exits & pair[1]) name += pair[0];
    });
    return name;
  }

  function minimapTileName(cell) {
    /*
     * 一格画成**房间**（圆角方块）还是**走廊**（线）是那一格自己的事，不是它有几条路
     * 的事：录像里 (1,0) 是"三出口的走廊"、(2,2) 是"一出口的房间"，而且 (1,1) 与
     * (2,1) 明明贴着却不相通（`docs/adr/0030`）。所以 `kind` 从地牢数据里读。
     */
    return (cell.kind === "corr" ? "corr:" : "room:") + exitsName(cell.exits);
  }

  function drawMinimapTile(ctx, sprites, name, x, y, scale) {
    var sheet = sprites && sprites.minimap;
    var column = MINIMAP.tiles[name];
    if (!sheet || column === undefined) return;
    var tile = MINIMAP.tile * scale;
    ctx.drawImage(sheet, column * MINIMAP.tile, 0, MINIMAP.tile, MINIMAP.tile,
                  Math.round(x), Math.round(y), tile, tile);
  }

  /**
   * The whole grid, then the rooms on it.
   *
   * The client has no empty cell - every frame of its tile set carries a room or
   * a corridor, because in the recording every cell of the dungeon has one. A
   * five-room stage on a 4x3 grid does not, so the cells it leaves over are
   * filled with the blank the bake derives from the unknown-room frame
   * (`import_dnf_minimap.py`), and the map reads as a grid rather than as tiles
   * floating in the dark.
   */
  function drawMinimapGrid(ctx, sprites, x, y, scale, map) {
    var rows = (map && map.rows) || MINIMAP.rows;
    var cols = (map && map.cols) || MINIMAP.cols;
    for (var row = 0; row < rows; row += 1) {
      for (var col = 0; col < cols; col += 1) {
        /*
         * **不是每张 4×4 都满格。** 幽暗密林深处 的 (3,2) 在录像里是纯黑、
         * 没有图块；这里把那格留成窗口的深底，别铺一张绿色 blank。
         */
        if (map && map.cells && !map.cells.some(function (cell) {
          return cell.col === col && cell.row === row;
        })) {
          ctx.fillStyle = "#000000";
          ctx.fillRect(x + col * MINIMAP.tile * scale,
                       y + row * MINIMAP.tile * scale,
                       MINIMAP.tile * scale, MINIMAP.tile * scale);
          continue;
        }
        drawMinimapPiece(ctx, sprites, "blank", x + col * MINIMAP.tile * scale,
                         y + row * MINIMAP.tile * scale,
                         MINIMAP.tile * scale, MINIMAP.tile * scale);
      }
    }
  }

  /** The red horned face that marks the boss's room, drawn at 18 px. */
  function drawBossFaceFallback(ctx, x, y, size) {
    var scale = size / 18;
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    ctx.scale(scale, scale);
    /* the face glows, which is how the recording reads it at this size */
    var glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
    glow.addColorStop(0, "rgba(255, 96, 24, 0.55)");
    glow.addColorStop(1, "rgba(255, 96, 24, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = MINIMAP.boss;
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.lineTo(-7.5, -8);
    ctx.lineTo(-3.5, -6);
    ctx.lineTo(3.5, -6);
    ctx.lineTo(7.5, -8);
    ctx.lineTo(6, -4);
    ctx.lineTo(7, 4);
    ctx.lineTo(0, 8);
    ctx.lineTo(-7, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffd23a";
    ctx.beginPath();
    ctx.ellipse(-3, -1, 1.6, 1.2, 0, 0, Math.PI * 2);
    ctx.ellipse(3, -1, 1.6, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** The blue lozenge that marks the room the player is standing in. */
  function drawMarkerFallback(ctx, x, y, size) {
    var scale = size / 18;
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = MINIMAP.marker;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(3.4, -2);
    ctx.lineTo(3.4, 4);
    ctx.lineTo(0, 7);
    ctx.lineTo(-3.4, 4);
    ctx.lineTo(-3.4, -2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(226, 250, 255, 0.85)";
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(1.5, -2);
    ctx.lineTo(0, 3);
    ctx.lineTo(-1.5, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * 领主房那一格的标记：客户端那张 **16×14 的红牛头**（`MINIMAP.pieces.boss`）。
   *
   * 它是客户端的自有美术，**居中画在格子里、按自己的尺寸**（录像里那张红脸
   * 正好一格宽，蓝色菱形是三分之一格，两个都不随格子放大）。
   *
   * 试过用 `drawMonsterFace` 从 `monsters.png` 第 5 行切牛头巨兽**本体**的脸，
   * 抓帧一比：那张画在 18 px 下只剩一团棕色，角和白鬃糊在一起，反而认不出是牛。
   * 客户端这张标记是**专门为这一格画的**，亮红、双角、轮廓清楚 —— 它本来就是
   * 业主说的「牛头图标」。所以图标不换，换的是**它什么时候出现**（见 drawMinimap：
   * 领主房不吃迷雾，从第一帧就画）。
   */
  function drawMapBoss(ctx, sprites, x, y, size) {
    var piece = MINIMAP.pieces.boss;
    var scale = size / MINIMAP.tile;
    var w = piece[2] * scale;
    var h = piece[3] * scale;
    if (!drawMinimapPiece(ctx, sprites, "boss", x + (size - w) / 2, y + (size - h) / 2, w, h)) {
      drawBossFaceFallback(ctx, x, y, size);
    }
  }

  function drawMapMarker(ctx, sprites, x, y, size, time) {
    var piece = MINIMAP.pieces.marker;
    var scale = size / MINIMAP.tile;
    var w = piece[2] * scale;
    var h = piece[3] * scale;
    /* A slow breath, so the eye finds it in a busy room - the recording's own
       marker is static, and this is the one thing this file adds to it. */
    var bob = Math.sin(time * 3) * 1.2;
    if (!drawMinimapPiece(ctx, sprites, "marker", x + (size - w) / 2, y + (size - h) / 2 + bob,
                          w, h)) {
      drawMarkerFallback(ctx, x, y, size);
    }
  }

  /**
   * The ⊘ in the title bar - the button the recording's map has.
   *
   * **This one is drawn, not baked**: the client has the button's face as a flat
   * tile and no glyph to put on it (`assets/dnf_src/granfloris-probe/mirkmap/`,
   * where every frame of the interface packs was scanned for it), so the circle
   * and its slash are two arcs here.
   */
  function drawMinimapButton(ctx, box) {
    var x = box.x + box.w - 19;
    var y = box.y + 3;
    ctx.save();
    ctx.fillStyle = "rgba(196, 186, 166, 0.85)";
    roundRect(ctx, x, y, 15, 11, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(60, 52, 42, 0.9)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x + 7.5, y + 5.5, 3.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 3);
    ctx.lineTo(x + 10, y + 8);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The map, in whichever of its two forms the player asked for.
   *
   * `meta.map.mode` is "window" (the whole dungeon, the way the recording has it
   * for most of a run) or "radar" (the same map clipped into a disc and centred
   * on the room he is in, the way it starts out).
   */
  /*
   * **没去过的格子是黑的**（业主 2026-10-15 实玩：「探索地图是现在这种颜色，
   * 没有探索过的是黑的」）。
   *
   * 这一条**推翻了 `docs/adr/0030` 里那句「整张图从第一帧就 12 格画满、包括他从没
   * 进去过的那四格」** —— 那是误读：客户端的 `act1.img` 里本来就有一整族"已经去过"的
   * 亮图块，我们只烘了暗的那一族，于是把**没去过**看成了画满。业主说的才对。
   *
   * 盖的时候连那一格的边一起盖：留一条缝就会被读成"去过但没内容"。
   */
  function drawMinimapFog(ctx, x, y, size) {
    ctx.save();
    ctx.fillStyle = "#05060a";
    ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(size), Math.ceil(size));
    ctx.restore();
  }

  /**
   * **清房之后，挨着当前房间、还没去过、有门的那几格露一个「?」**
   * （业主 2026-10-18）。它回答的是"清完这间，下一间在哪" —— 迷雾仍然盖住
   * 房间内容，只把"那边还有一间"这一点告诉玩家。没清房、没门、或已经去过的
   * 格子都不画。Boss 那格也不画：它从第一帧就有牛头图标。
   */
  function drawMinimapQuestions(ctx, sprites, map, here, x, y, scale) {
    if (!map || !here || !here.cleared) return;
    var tile = MINIMAP.tile;
    MINIMAP_DIRS.forEach(function (pair) {
      if (!(here.exits & pair[1])) return;
      var index = Core.doorNeighbour(map, here, pair[0]);
      if (index < 0 || index === map.boss) return;
      var cell = map.cells[index];
      if (!cell || cell.seen) return;
      drawMinimapPiece(ctx, sprites, "question",
                       x + cell.col * tile * scale, y + cell.row * tile * scale,
                       tile * scale, tile * scale);
    });
  }

  function drawMinimap(ctx, state, sprites, meta) {
    /*
     * 画的是**他探过的那几格**（没去过的盖黑）—— 十二格里他在哪一格由 `state.cell` 说。
     */
    var map = state.dungeon;
    if (!map || !sprites || !sprites.minimap) return;
    var box = minimapBox(meta, map);
    var tile = MINIMAP.tile;
    var mode = (meta.map && meta.map.mode) || "window";
    var here = map.cells[state.cell] || map.cells[0];
    var boss = map.cells[map.boss];

    ctx.save();
    if (mode === "radar") {
      /* The disc, centred on the room he is in, twice the scale. */
      var centre = {
        x: box.x + box.w / 2,
        y: box.y + box.h / 2 + 4
      };
      var radius = MINIMAP.radarRadius;
      ctx.save();
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#20340a";
      ctx.fillRect(centre.x - radius, centre.y - radius, radius * 2, radius * 2);
      var zoom = MINIMAP.radarZoom;
      var originX = centre.x - (here.col + 0.5) * tile * zoom;
      var originY = centre.y - (here.row + 0.5) * tile * zoom;
      drawMinimapGrid(ctx, sprites, originX, originY, zoom, map);
      map.cells.forEach(function (cell) {
        if (!cell.seen) {
          drawMinimapFog(ctx, originX + cell.col * tile * zoom,
                         originY + cell.row * tile * zoom, tile * zoom);
          return;
        }
        drawMinimapTile(ctx, sprites, minimapTileName(cell),
                        originX + cell.col * tile * zoom,
                        originY + cell.row * tile * zoom, zoom);
      });
      drawMinimapQuestions(ctx, sprites, map, here, originX, originY, zoom);
      /*
       * **领主房不吃迷雾**：它是这张图唯一要指的地方 —— 等他走进去才画，
       * 图标就只剩"我已经到了"的意义。底下的格子仍是黑的（没去过），只把
       * 牛头露在上面（业主 2026-10-17；这条改了 `docs/adr/0051` 的半条）。
       */
      drawMapBoss(ctx, sprites, originX + boss.col * tile * zoom,
                  originY + boss.row * tile * zoom, tile * zoom);
      drawMapMarker(ctx, sprites, originX + here.col * tile * zoom,
                    originY + here.row * tile * zoom, tile * zoom, state.time);
      ctx.restore();
      /* The client's own disc, over the top: an overlay, not a frame - the map
         shows through the middle of it, which is why it is not a clip. */
      var ring = MINIMAP.pieces.ring;
      drawMinimapPiece(ctx, sprites, "ring", centre.x - ring[2] / 2, centre.y - ring[3] / 2);
      ctx.restore();
      return;
    }

    drawMinimapWindow(ctx, sprites, box);

    ctx.fillStyle = "rgba(255, 248, 226, 0.96)";
    ctx.font = "600 12px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("地图", box.x + box.w / 2 + 3, box.y + 13);

    drawMinimapGrid(ctx, sprites, box.left, box.top, 1, map);
    map.cells.forEach(function (cell) {
      if (!cell.seen) {
        drawMinimapFog(ctx, box.left + cell.col * tile, box.top + cell.row * tile, tile);
        return;
      }
      drawMinimapTile(ctx, sprites, minimapTileName(cell),
                      box.left + cell.col * tile, box.top + cell.row * tile, 1);
    });
    /*
     * 他在的那格压的是蓝柱子先画，Boss 那张红脸后画 —— 顺序是有意的：录像里他走进
     * Boss 房之后**蓝柱子一个像素都看不见**（226s 起整张图里蓝色像素归零），红牛头
     * 比蓝柱子大，正好把它盖住。所以这里的先后不是"谁重要"，是"照录像画"。
     */
    drawMinimapQuestions(ctx, sprites, map, here, box.left, box.top, 1);
    drawMapMarker(ctx, sprites, here.col * tile + box.left, box.top + here.row * tile,
                  tile, state.time);
    /*
     * 领主房那一格**不吃迷雾**：牛头从第一帧就画，底下的格子没去过仍是黑的。
     * 等他走进去才画的话，这张图就只在他已经站在里面时才告诉他 Boss 在哪。
     * 这条改了 `docs/adr/0051` 里「Boss 红脸也只在去过之后才画」那半条。
     */
    drawMapBoss(ctx, sprites, box.left + boss.col * tile, box.top + boss.row * tile, tile);

    drawMinimapButton(ctx, box);
    ctx.restore();
  }

  /**
   * What a tap at `(x, y)` hits on the map, or null.
   *
   * The ⊘ in the title bar switches the window to its radar form, and the disc
   * switches back - a touch surface has no Tab key, and a corner of the screen
   * that does nothing when tapped reads as broken.
   */
  function hitTestMinimap(x, y, meta) {
    var box = minimapBox(meta);
    var mode = (meta && meta.map && meta.map.mode) || "window";
    if (mode === "radar") {
      var dx = x - (box.x + box.w / 2);
      var dy = y - (box.y + box.h / 2 + 4);
      return Math.sqrt(dx * dx + dy * dy) <= MINIMAP.radarRadius + 3 ? "map" : null;
    }
    if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) return null;
    if (x >= box.x + box.w - 21 && y <= box.y + 16) return "map";
    return null;
  }

  /*
   * The window's own edges: the client's panel is 5 px down the left and 4 down
   * the right, 5 across the top and 4 along the bottom, so the box is the grid
   * plus those - not a padding of our choosing.
   */
  /** Where the touch row along the top starts, so the HUD can stay off it. */
  /** How wide the window is, the frame included - the HUD lays out around it. */
  function minimapWidth(cols) {
    var columns = cols || MINIMAP.cols;
    return columns * MINIMAP.tile + MINIMAP.pieces.left[2] + MINIMAP.pieces.right[2];
  }

  function minimapBox(meta, map) {
    /*
     * **窗口的行列跟着这一关的副本图走**，不是一张固定的 4x3。幽暗密林是 4x3，
     * 幽暗密林深处是 4x4（`docs/adr/0059`）；`meta.map` 在 `mapMeta()` 里带着
     * 当前地牢的 cols/rows，绘制这一路直接拿 `state.dungeon`。
     */
    var cols = (map && map.cols) || (meta && meta.map && meta.map.cols) || MINIMAP.cols;
    var rows = (map && map.rows) || (meta && meta.map && meta.map.rows) || MINIMAP.rows;
    var touch = !!(meta && meta.touch && meta.touch.enabled);
    var width = minimapWidth(cols);
    var height = rows * MINIMAP.tile + MINIMAP.titleH +
                 MINIMAP.pieces.top[3] + MINIMAP.pieces.bottom[3];
    var x = HUD_RIGHT - width - MINIMAP.margin;
    var y = touch ? MINIMAP.touchTop : MINIMAP.top;
    return {
      x: x,
      y: y,
      w: width,
      h: height,
      left: x + MINIMAP.pieces.left[2],
      top: y + MINIMAP.titleH + MINIMAP.pieces.top[3],
      centre: { x: x + width / 2, y: y + height / 2 }
    };
  }

  /** One piece of the sheet, placed as a rect. */
  function drawMinimapPiece(ctx, sprites, name, x, y, w, h) {
    var sheet = sprites && sprites.minimap;
    var rect = MINIMAP.pieces[name];
    if (!sheet || !rect) return false;
    ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3],
                  Math.round(x), Math.round(y),
                  w === undefined ? rect[2] : Math.round(w),
                  h === undefined ? rect[3] : Math.round(h));
    return true;
  }

  /**
   * The client's panel, drawn as the 9-slice it is.
   *
   * Its middle piece is **not a colour**: it is a flat 50% black (alpha 128, all
   * 18x18 of it), and the panel's edges are painted over a solid brown. So the
   * window is the brown first and the nine pieces over it - which is also why
   * the recording's title strip comes out a warm `(57,48,39)`: the client's
   * `(98,84,60)` cut in half.
   */
  function drawMinimapWindow(ctx, sprites, box) {
    var corners = MINIMAP.pieces;
    var l = corners.left[2];
    var r = corners.right[2];
    var t = corners.top[3];
    var b = corners.bottom[3];
    ctx.fillStyle = MINIMAP.panel;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    drawMinimapPiece(ctx, sprites, "tl", box.x, box.y);
    drawMinimapPiece(ctx, sprites, "tr", box.x + box.w - r, box.y);
    drawMinimapPiece(ctx, sprites, "bl", box.x, box.y + box.h - b);
    drawMinimapPiece(ctx, sprites, "br", box.x + box.w - r, box.y + box.h - b);
    drawMinimapPiece(ctx, sprites, "top", box.x + l, box.y, box.w - l - r, t);
    drawMinimapPiece(ctx, sprites, "bottom", box.x + l, box.y + box.h - b, box.w - l - r, b);
    drawMinimapPiece(ctx, sprites, "left", box.x, box.y + t, l, box.h - t - b);
    drawMinimapPiece(ctx, sprites, "right", box.x + box.w - r, box.y + t, r, box.h - t - b);
    drawMinimapPiece(ctx, sprites, "centre", box.x + l, box.y + t, box.w - l - r, box.h - t - b);
  }

  /**
   * One piece, placed by its own bottom edge and centred on `x`.
   *
   * Returns false when the piece or the sheet is missing, so a caller can fall
   * back rather than draw nothing at all.
   */
  /*
   * **越靠里画得越小**（`docs/adr/0050` 追记）。量出来的：**同一帧里**两只木桶，
   * 靠前那只 160 视频px、靠里那只 132 —— **1.21 倍/整条带子**。本作原来是平的。
   *
   * **只给不挡人的那几档（贴花）用**，实心件与怪一律不缩：实心件缩了就**判定也得跟着缩**，
   * 那要把 `z` 穿进 `blockProps` / `routeStep` / `swingProps` / `props` 布点五个地方，
   * 而收益只有前后 ±10%。仓库里"美术与判定必须是同一个数"这条规矩（`docs/adr/0014` /
   * `0032`）是踩过坑才有的，不为这 10% 破它。
   */
  var DEPTH_SIZE = 0.18;

  function depthSize(zShare) {
    if (!zShare) return 1;
    return 1 - DEPTH_SIZE * Math.max(0, Math.min(1, zShare));
  }

  function drawScenePiece(ctx, sprites, name, x, bottom, zShare, scaleOverride) {
    var sheet = name === "hut" ? sprites && sprites.hut
      : name === "pillarPale" || name === "pillarDecor"
        ? sprites && sprites.pillarPale
        : name === "gateBlock" || name === "doorBlock" ||
          name === "gateLight" || name === "gateLight2"
          ? sprites && sprites.gateBlock
          : sprites && sprites.forest;
    var rect = sceneRect(name);
    if (!sheet || !rect) return false;
    /*
     * **画的尺寸乘那一件的倍率**（`Core.propScale`，`docs/adr/0050`）：
     * 烘出来的是客户端的**原始像素**，而录像里每一件按自己的倍率画。底边仍是落点，
     * 所以缩了之后还是"站在那儿"。
     *
     * `scaleOverride` 给**逐件量过倍率的布景**用（背景石门，`docs/adr/0063`）：
     * 同一件美术在不同房里被拉成不同比例，一张按名字的表装不下。
     */
    var scale = scaleOverride || (Core.propScale ? Core.propScale(name) : [1, 1]);
    var near = depthSize(zShare);
    var w = rect[2] * scale[0] * near;
    var h = rect[3] * scale[1] * near;
    ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3],
                  Math.round(x - w / 2), Math.round(bottom - h), w, h);
    return true;
  }

  /** A layer that repeats across the room, hung from its own bottom edge. */
  /**
   * 一块场景美术，左上角落在 (left, top)：木桶碎片要的是这个，不是底边。
   *
   * **倍率只作用在尺寸上，坐标已经是世界坐标**。以前这里把 `left/top` 也乘了一遍
   * `scale` —— 碎片名不在 `PROP_SCALE` 里时表里是 1，侥幸没炸；一旦给碎片补上 0.74，
   * 整组碎片会被画到 `0.74 × 世界坐标` 的位置。坐标与缩放分开，才不会再踩。
   */
  function drawScenePieceBox(ctx, sprites, name, left, top, scaleX, scaleY) {
    var sheet = sprites && sprites.forest;
    var rect = sceneRect(name);
    if (!sheet || !rect) return false;
    var sx = scaleX === undefined ? 1 : scaleX;
    var sy = scaleY === undefined ? 1 : scaleY;
    ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3],
                  Math.round(left), Math.round(top),
                  rect[2] * sx, rect[3] * sy);
    return true;
  }

  /** 一块场景美术，画在自己的大小上再缩放，中心落在 (cx, cy)。 */
  function drawScenePieceAt(ctx, sprites, name, cx, cy, scale, alpha) {
    var sheet = sprites && sprites.forest;
    var rect = sceneRect(name);
    if (!sheet || !rect) return false;
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    var w = rect[2] * scale;
    var h = rect[3] * scale;
    ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3],
                  cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
    return true;
  }

  /*
   * **房间是"世界"，`ARENA` 只是窗口**（`docs/adr/0035`）。
   *
   * 凡是画在房间里的东西 —— 背景、地面、门、人、怪、地上的火 —— 宽度都取这一个；
   * 屏幕上的那一层（HUD、地图窗口、暗角、过场那层黑幕）仍然取 `ARENA.width`。
   * 房间还没开出来的时候两者相等（回落到窗口宽），所以这层区分不改变现在的画面。
   */
  function worldWidth(state) {
    return Core.roomWidth(state);
  }

  /*
   * 镜头往右挪了多少。世界那一层整体减掉它；**画在世界那一层里、但属于屏幕的东西**
   * （比如换房那块房名牌）再把它加回来，否则它会跟着房间跑。
   */
  /*
   * **战斗里那几行字**（伤害数字与命中状态词）。全都量自业主的幽暗密林录像，
   * 录像像素用 `Core.VIDEO_PX`（= 84 / 265 —— 一身位在录像里与本作里各是多少像素）
   * 折成**世界**像素。
   *
   * 写成一个名字表而不是散在绘制分支里，是因为它们是一组：录像里这批字的字高、
   * 颜色、存活时间互相只差一点点，改一个往往另几个也要跟着动。
   */
  var HIT_TEXT = {
    /*
     * 伤害数字：**粗斜体**、纯黄、字高 **22 视频像素** = 7.0 世界像素。
     * 字号取 10，因为一个数字画出来大约占字号的 0.7。
     */
    damageFont: "italic 700 10px 'Segoe UI', system-ui, sans-serif",
    damageFill: "#ffff00",
    /* 头 **0.17 秒** 蹿上 **10 视频像素**（3.2 世界像素），占 0.6 秒寿命的那一段。 */
    climb: 10 * Core.VIDEO_PX,
    climbShare: 0.17 / 0.6,
    /* 描边：录像里 2–3 像素。 */
    outline: 2.5 * Core.VIDEO_PX,
    /*
     * MISS 是本作自己的，录像里没有对应物（DNF 的"打空"是另一个样子），
     * 所以它**不跟**这批量出来的数走，只按比例跟着伤害数字缩小。
     */
    missFont: "bold 8px 'Segoe UI', system-ui, sans-serif",
    /* 命中状态词 `无法浮空`：冷白、字高 **29 视频像素** = 9.2 世界像素。 */
    wordFont: "700 13px 'PingFang SC', 'Segoe UI', system-ui, sans-serif",
    wordFill: "#e4e7ed",
    /*
     * 伤害数字旁边那几道火花是本作自己的（录像里量不到），所以它按同样的比例缩小，
     * 免得一圈 22 像素的火花围着一个个位数的字。
     */
    sparkScale: 0.5
  };

  function cameraX(state) {
    var camera = state && state.camera;
    return camera && typeof camera.x === "number" ? camera.x : 0;
  }

  function drawSceneStrip(ctx, sprites, name, bottom, width) {
    var sheet = sprites && sprites.forest;
    var rect = sceneRect(name);
    if (!sheet || !rect) return false;
    for (var x = -rect[2]; x < width + rect[2]; x += rect[2]) {
      ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3],
                    x, Math.round(bottom - rect[3]), rect[2], rect[3]);
    }
    return true;
  }

  function drawBackdrop(ctx, state, sprites) {
    /*
     * The room 幽暗密林 is fought in: the client's own forest, painted in the
     * order the client paints it - far, then the trees, then the ground over
     * their feet. Everything below the band's back edge is ground right to the
     * bottom of the screen, because in the reference the floor does not stop at
     * the line the feet stand on; it carries on under the HUD.
     */
    var band = state.band || Core.BAND;
    var backY = band.backY;
    /*
     * **可走带与可见草带分开**（`docs/adr/0063`）：幽暗密林深处把可走深度收到
     * 37px，但草地/树根线仍从录像的 `visualBackY 320` 开始画。没有这个量时，
     * 两层仍用同一个 `backY`（幽暗密林没有变）。
     */
    var visualBackY = band.visualBackY === undefined ? backY : band.visualBackY;
    var groundTop = visualBackY - SCENE.groundLift;
    var width = worldWidth(state);

    var sky = ctx.createLinearGradient(0, 0, 0, visualBackY);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(1, PALETTE.skyMid);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, visualBackY);

    /*
     * **远景钉在屏幕上，不跟着房间滚。**
     *
     * 量自录像：画面上方那片远墙与远树干**整场一像素都不动**，跟着镜头动的只有它
     * 下面那一层（中景树干、地面、前景一起平移，位移量完全相同）。所以这一层把镜头
     * **加回来**，把世界那一趟的平移抵掉 —— 它就跟着屏幕走，房间再宽背景也不跟着跑。
     * 纵向仍然在世界里（它坐在 `backY` 上，得跟地面带对齐）。
     */
    ctx.save();
    ctx.translate(cameraX(state), 0);
    var farDrawn = drawSceneStrip(ctx, sprites, "far", visualBackY, width);
    ctx.restore();
    if (!farDrawn) {
      drawStoneBackdrop(ctx, state);
      return;
    }
    drawSceneStrip(ctx, sprites, "mid", visualBackY + SCENE.midLift, width);
    /*
     * **上沿那排圆树冠。** 录像每一间的上沿 60–160 都压着一层阔叶树冠
     * （`02obj300` 这一类站着的树），mid 层里只有裸树干、没有冠 —— 少了这层，
     * 背景读起来就是"一排切了头的柱子"。冠按房间宽度平铺，间距/大小用两个固定
     * 的素数错开，同一间房每次进门都一样；它画在背景那一趟，永远在布景和人后面。
     */
    if (state.stage && (state.stage.id === "mirkwood" || state.stage.id === "mirkwooddeep")) {
      /*
       * 间距/大小是照着录像那一条"连续树冠带"定的：树冠要**互相压住**才连成
       * 一条带，稀疏的一排读起来还是柱子。间距 95 世界px、冠的倍率 0.95–1.04，
       * 两个数都用素数错开，同一间房每次进门一模一样。
       */
      for (var cx = 10; cx < width + 120; cx += 88) {
        var jitter = ((cx * 37) % 41) - 20;
        var crownScale = 0.78 + ((cx * 17) % 23) / 160;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.translate(cx + jitter, visualBackY + 8);
        ctx.scale(crownScale, crownScale);
        drawScenePiece(ctx, sprites, "treeLeafy", 0, 0, undefined, [1, 1]);
        ctx.restore();
      }
    }

    /*
     * 地面条顶上的缺口：**mid 自己的草裙**（`SCENE.midSkirt`，量出来的 63 行）。
     *
     * 客户端的摆位是"树根线压在地面顶边上"，所以缺口里透出来的永远是草。本作把 mid
     * 摆得比客户端高一条裙边（`midLift = 0` 对齐的是美术的最低一行），缺口下面就成了
     * 没人画的地方 —— 先烘成竖条纹（还是难看），现在改成在这里**把 mid 再铺一遍、
     * 裁到接缝以下**：地面不透明的地方把它盖住，只有缺口里看得见，看见的就是草裙。
     */
    if (SCENE.midSkirt) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, groundTop, width, ARENA.height - groundTop);
      ctx.clip();
      drawSceneStrip(ctx, sprites, "mid", groundTop + SCENE.midSkirt, width);
      ctx.restore();
    }

    /*
     * The ground, from its own top edge down to the bottom of the room. The
     * strips are shorter than that, so each column repeats instead of stretching
     * - grass that grew to fit would show it immediately.
     */
    var strip = SCENE.pieces[SCENE.ground[0]];
    var column = 0;
    for (var x = 0; x < width; x += strip[2]) {
      var name = SCENE.ground[column % SCENE.ground.length];
      var tall = sceneRect(name)[3];
      for (var bottom = groundTop + tall; bottom - tall < ARENA.height; bottom += tall) {
        drawScenePiece(ctx, sprites, name, x + strip[2] / 2, bottom);
      }
      column += 1;
    }
    /* The front edge of the band: the one line everyone's feet stand on. */
    ctx.fillStyle = "rgba(255, 226, 180, 0.10)";
    ctx.fillRect(0, ARENA.groundY, width, 2);
  }

  function drawStoneBackdrop(ctx, state) {
    /*
     * The room the tower used to be fought in, kept as the fallback for a frame
     * drawn before `assets/forest.png` has loaded. Built outwards from the floor
     * band, because the band is what everything in the room is placed against:
     * the wall stops at its far edge, and the strip in front of the ground line
     * is a skirt nothing ever stands on.
     */
    var band = state.band || Core.BAND;
    var backY = band.backY;
    var width = worldWidth(state);

    var sky = ctx.createLinearGradient(0, 0, 0, backY);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(0.55, PALETTE.skyMid);
    sky.addColorStop(1, PALETTE.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, backY);

    /* far arches, slowly drifting */
    var drift = -((state.time * 6) % 240);
    ctx.fillStyle = PALETTE.wallFar;
    ctx.fillRect(0, 40, width, backY - 40);
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
      ctx.lineTo(width, y);
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
    ctx.fillRect(0, backY, width, ARENA.groundY - backY);
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
      ctx.lineTo(width, seamY);
      ctx.stroke();
    }

    /* the skirt: floor in front of the band, which nothing is ever placed on */
    var floor = ctx.createLinearGradient(0, ARENA.groundY, 0, ARENA.height);
    floor.addColorStop(0, PALETTE.floorTop);
    floor.addColorStop(1, PALETTE.floorBottom);
    ctx.fillStyle = floor;
    ctx.fillRect(0, ARENA.groundY, width, ARENA.height - ARENA.groundY);
    ctx.strokeStyle = PALETTE.floorLine;
    ctx.lineWidth = 1;
    for (var line = 0; line < 5; line += 1) {
      var ly = ARENA.groundY + 8 + line * 14;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(width, ly);
      ctx.stroke();
    }
    /* The front edge of the band: the one line everyone's feet stand on. */
    ctx.fillStyle = "rgba(255, 214, 170, 0.16)";
    ctx.fillRect(0, ARENA.groundY, width, 2);
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

  /*
   * 一扇门画在哪、用什么美术、门里有没有插着那扇拦门的板。
   *
   * 四个方向各有自己的画（客户端 `granfloris{side,up,down}gate02` 那一族）：
   * 侧门立在左右墙上（左右共用一张拱，它的样子本来就是对称的）、上门立在房间后
   * 边的地板上、下门躺在你面前的地上 —— **下门**那个位置在本作的画框里几乎全被
   * 技能栏压住（本站地面线 430、技能栏 444），所以它只画一截露在技能栏上面的
   * 拱顶 + 一圈地上的光，够读"往这边下去"（`docs/adr/0030`）。
   *
   * `northX`/`southX` 是门在房间里的 x（占屏幕宽几成）；侧门没有选择，它就在墙边。
   */
  var GATE = {
    side: { piece: "gate", door: "door", stand: 10, height: 2 },
    N: { piece: "gateUp", door: "doorUp" },
    S: { piece: "gateDown", door: "doorDown" }
  };

  /*
   * **下门（南门）的底边落在世界 y 482**（`Core.GATE_DOWN`，画法与门口净空共用）。
   *
   * 量的：录像 106s 帧那道石拱拱顶在**画布 413**（游戏 y 827），本作那一件
   * 192x118 按 0.533 画出来高 99 画布px → 底边画布 512 → 反算世界 y
   * `430 + (512 - 430) ÷ 1.5775 ≈ 482`。技能栏从画布 456 起，所以拱顶露出 43px，
   * 其余压在栏底下 —— 和录像一样。
   *
   * **不能写 `ARENA.height`（540）**：世界那一趟纵向是按 `CAMERA.zoom` 以地面线
   * 为轴拉开的，540 会落到画布 603 —— 整扇在画布外面。早先那一版就是写 540，
   * 于是录像底部那道拱在本作一次都没出现（2026-10-26 修）。
   */
  var GATE_DOWN_BOTTOM = Core.GATE_DOWN.bottom;

  /** 一块门口美术：左右两个方向共用同一副侧门（它的样子本来就是对称的）。 */
  function gateShape(state, dir) {
    /*
     * 深处用录像里那套**石块框 + 铁栅**（`granflorisupgate02`/`updoor02`），
     * 不是 `sidegate02` 的符文侧拱；其余关卡仍用原侧拱。
     */
    if (state && state.stage && state.stage.id === "mirkwooddeep" &&
        (dir === "E" || dir === "W")) {
      return { piece: "gateBlock", door: "doorBlock", stand: 10, height: 2 };
    }
    return dir === "E" || dir === "W" ? GATE.side : GATE[dir];
  }

  /** 这一格的门画在哪：`{x, bottom, dir}`，没有这扇门就 null。 */
  function gateSpot(state, dir) {
    var cell = Core.currentCell(state);
    if (!cell || !state.dungeon) return null;
    if (Core.exitMode(state, dir) === "none") return null;
    if (dir === "E") return { x: worldWidth(state) - 34, bottom: ARENA.groundY + 4 };
    if (dir === "W") return { x: 34, bottom: ARENA.groundY + 4 };
    var x = Core.doorX(state, cell, dir);
    if (dir === "N") return { x: x, bottom: floorY(Core.bandDepth(state.band)) + 6 };
    /*
     * 南门（下门）**压在技能栏底下**：底边落在 `GATE_DOWN_BOTTOM`（世界 482，
     * 画布 512），拱顶在画布 413 —— 只露拱顶那条在技能栏（456）上面，和录像一致。
     * 清完房另外在地上加一圈光（`drawGateHalo` 的落点跟着改），
     * 因为这一扇没有"门框左右"可以靠。
     */
    return { x: x, bottom: GATE_DOWN_BOTTOM, floorGlow: true };
  }

  /**
   * 门口那一组：拱门 + （没清房时）插在里面的拦门板 + 清房后那一圈光。
   *
   * 光是我们加的（客户端那套美术没有"开着"的样子），但它是这一间房**唯一**会说
   * "现在能出去了"的东西，所以留着；拦门板反过来是客户端的（`granfloris*sidedoor02`），
   * 录像里没清的房间拱门里就插着它。
   */
  /** 他是不是已经站进这扇门的门口那一块（决定画栅栏还是画符文光）。 */
  function inDoorway(state, dir, spot) {
    var player = state.player;
    if (!player || player.dead) return false;
    if (dir === "E" || dir === "W") {
      return Math.abs(player.x - spot.x) < 80;
    }
    var doorZ = dir === "N" ? Core.bandDepth(state.band) : 0;
    return Math.abs((player.z || 0) - doorZ) < 70 &&
      Math.abs(player.x - spot.x) < Core.DOOR.span;
  }

  function drawGate(ctx, state, sprites) {
    if (!sprites || !sprites.forest) {
      drawFallbackGate(ctx, state);
      return;
    }
    Core.MINIMAP_DIRS.forEach(function (dir) {
      var spot = gateSpot(state, dir);
      if (!spot) return;
      var shape = gateShape(state, dir);
      var open = Core.exitMode(state, dir) === "open";
      /*
       * **上/下门从进门那一刻就画着；左右门仍然清完房才出现**（2026-10-27 逐帧）。
       *
       * 155s 帧（23 房）房里还有活着的哥布林，顶上门拱已经立在那儿了 —— 所以
       * 上/下门不看清房状态。左右门反过来：106s 帧（33 房，已清）左边墙上是木桶
       * 不是门，而录像里那两间房从头到尾没在左右墙上出现过门；13s/22s 的 41 房
       * 那扇东门也是**走进视野**才看见的（房宽 560，镜头贴左墙时它在窗口外）。
       * 所以左右门维持旧规矩（`exitMode` 能走才算），只在清完房后随光出现。
       */
      if (state.stage && state.stage.id === "mirkwooddeep" &&
          !open && dir !== "N" && dir !== "S") {
        return;
      }
      var mirror = dir === "W";
      var rect = sceneRect(shape.piece);
      if (!rect) return;
      if (open) {
        /*
         * 光落在哪：侧门/后门落在门的中间，**南门落在地上**（门前那一片地板），
         * 因为那扇门自己几乎整扇都在技能栏底下。
         */
        var glowY = spot.floorGlow ? ARENA.groundY - 6 : spot.bottom - rect[3] / 2;
        drawGateHalo(ctx, spot.x, glowY, spot.floorGlow ? 150 : rect[3]);
      }
      ctx.save();
      /*
       * 没清房的门暗一档：光说了"能走"，暗就说了"还不能走"。
       * **深处上/下门不暗**：155s 帧那道还没开的上门就是正常亮度，它本来就从进门
       * 那一刻立在录像里，不是"锁着"才画出来的部件。
       */
      var deepStage = state.stage && state.stage.id === "mirkwooddeep";
      if (!open && !(deepStage && (dir === "N" || dir === "S"))) ctx.globalAlpha = 0.72;
      drawDoorPiece(ctx, sprites, shape.piece, spot.x, spot.bottom, mirror, shape.scale);
      ctx.restore();
      if (open) {
        /*
         * **门的两种样子**（2026-10-26 照录像定）：
         * - 没清房，哪怕是人刚进来的那扇门，也是**带铁栅**的（42 房 27/30s）；
         * - 清房之后**仍是铁栅**，直到他走到门口那一块（41 房 24s 是栅栏）；
         * - 走进去的那一下才亮成**蓝符文**（33 房 147s）。
         * 所以亮 = 这一格清了 且 他站在门口；其余时候都是栅栏。
         * 只用蓝色那一帧（`granflorisuplight01`），橙色整场没出现过。
         */
        var cell = Core.currentCell(state);
        var lit = deepStage && cell && cell.cleared && inDoorway(state, dir, spot);
        if (lit) {
          var pulse = 0.62 + 0.2 * (0.5 + 0.5 * Math.sin((state.time || 0) * 3.2));
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = pulse;
          drawDoorPiece(ctx, sprites, "gateLight", spot.x, spot.bottom, mirror, shape.scale);
          ctx.restore();
        } else {
          ctx.save();
          ctx.globalAlpha = 0.85;
          drawDoorPiece(ctx, sprites, shape.door, spot.x, spot.bottom, mirror, shape.scale);
          ctx.restore();
        }
        return;
      }
      /* 没清房：拱门里插着那扇拦着的门板。 */
      ctx.save();
      ctx.globalAlpha = 0.85;
      drawDoorPiece(ctx, sprites, shape.door, spot.x, spot.bottom, mirror, shape.scale);
      ctx.restore();
    });
  }

  /** 一块门口美术，摆在 x 上、底边落在 `bottom`；`mirror` 是给西侧门用的。 */
  function drawDoorPiece(ctx, sprites, name, x, bottom, mirror, scale) {
    if (!mirror) {
      drawScenePiece(ctx, sprites, name, x, bottom, undefined, scale);
      return;
    }
    ctx.save();
    ctx.translate(x, 0);
    ctx.scale(-1, 1);
    drawScenePiece(ctx, sprites, name, 0, bottom, undefined, scale);
    ctx.restore();
  }

  /** 一个稳定的 [0,1)：同一个 (种子, 第几块) 每次都落在同一处。 */
  function scatter(seed, index) {
    var t = Math.imul(((seed || 1) * 2654435761 + index * 40503) >>> 0, 2246822519) >>> 0;
    t ^= t >>> 13;
    t = Math.imul(t, 3266489917) >>> 0;
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  }

  /*
   * 一只怪的死。录像里这是一下子出来的两样东西（`docs/adr/0030`）：
   *
   * - 一团**青白色的圆爆**（客户端 `monsterdieflash`），亮 0.10 秒、最大 129x83 游戏像素；
   * - **9-14 块红肉块**，7x11 ~ 16x21 游戏像素，**悬在空中不落、不上飘**，半秒内散掉。
   *
   * 肉块的位置是**算出来的、不是随机的**：十几块的位置由这只怪的 id 决定，同一个 id
   * 每次都撒在同一处 —— 跟着帧随机撒的话，一具尸体半秒钟里会变十几副样子。
   * 地上不留血泊（录像里量过：爆开点正下方 0.5 秒后红像素归零）。
   */
  /*
   * 尸体死掉的第一段：**一团白烟把它盖掉**（`docs/adr/0033`）。
   *
   * 录像里普通怪死就是这一团白烟 —— 0.1–0.4 秒；烟起来的时候尸体还看得见，烟散的那
   * 一下它一起没，**同时**炸出碎块（`drawDeathBurst`）。Boss 那团更大更久（约 0.95 秒），
   * 而且它没有第二段。
   *
   * 烟是客户端自己那团白（`monsterdieblood`：一张白色的形状，颜色由引擎挑），这里
   * 撒几片、每片错开一点钟：一片同时出现同时消失的白贴在身上，看着就是贴纸不是烟。
   */
  /*
   * 炸开：**十几块它自己颜色的碎块**（`docs/adr/0034`）。
   *
   * 量自业主的幽暗密林录像（T+4:50 那只，30fps 逐帧）：白色剪影散掉的那一刻，
   * 十几块**按它自己皮肤色**染的小块放射出去 —— 金黄的那只飞的全是金黄的，
   * 绿哥布林飞绿的（落在深绿草地上几乎看不见，上一片就是这么漏掉的）。飞出去、
   * 减速、坠地，然后化掉；地上不留东西。
   *
   * 位置由怪的 id 定死（`seed`），所以同一具尸体每次都撒在同一处；轨迹是解析的
   * （`h = vy*t - g*t^2/2`），不积分 —— 只读 `t`，暂停、慢放都不会飘。
   */
  /**
   * **领主倒下的那组光线**（参考录像 5:28s / t=328s，业主点名的结束特效）。
   *
   * 参考里是从它身上甩出来的几条**细长白/红光束**（外面红粉晕、芯是白的），
   * 外加一道横在脖子/胸口位置的金色横光。这里用加色混合画，0.7 秒淡出；
   * 角度/长度由尸体 id 定死，同一具 Boss 每次一样。
   */
  /**
   * 深处领主的死亡：一次紫白爆光（录像 384.83–385.00s），没有白剪影/碎块/魂球。
   * 它不是 `deathburst`：后者会去拿 `chunk_*` 与魂球，那些是牛头巨兽那套。
   */
  function drawBossBurst(ctx, effect, alpha) {
    var fade = clamp01(alpha);
    var age = 1 - fade;
    var cx = effect.x;
    var cy = floorY(effect.z || 0) - (effect.height || 28) * 0.6;
    var r = 8 + age * 46;
    ctx.save();
    ctx.globalAlpha = fade;
    var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    glow.addColorStop(0, "rgba(255,255,255,0.95)");
    glow.addColorStop(0.35, "rgba(235,160,255,0.75)");
    glow.addColorStop(1, "rgba(120,40,160,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,230,255,0.85)";
    ctx.lineWidth = 1.6;
    for (var i = 0; i < 8; i += 1) {
      var angle = (i * Math.PI) / 4 + age * 0.35;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * r * 0.25, cy + Math.sin(angle) * r * 0.25);
      ctx.lineTo(cx + Math.cos(angle) * r * 1.35, cy + Math.sin(angle) * r * 1.35);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 低血交叉光束（录像 381–385s）：几条粉白/红的横光，横穿整个房间；
   * 起手结束后亮 `duration` 秒。它不是 `bossrays`——那是牛头死时的收束光线。
   */
  function drawBossBeam(ctx, state, effect, alpha) {
    var fade = clamp01(alpha);
    var width = worldWidth(state);
    var baseY = floorY(effect.z || 0) - (effect.height || 28) * 0.55;
    var count = effect.beams || 5;
    ctx.save();
    ctx.globalAlpha = fade * 0.9;
    for (var i = 0; i < count; i += 1) {
      var offset = (i - (count - 1) / 2) * 11;
      var y = baseY + offset;
      var lean = (i % 2 === 0 ? 1 : -1) * 10;
      var grad = ctx.createLinearGradient(0, y, width, y + lean);
      grad.addColorStop(0, "rgba(255,120,220,0)");
      grad.addColorStop(0.15, "rgba(255,150,230,0.75)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.95)");
      grad.addColorStop(0.85, "rgba(255,150,230,0.75)");
      grad.addColorStop(1, "rgba(255,120,220,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y + lean);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBossRays(ctx, effect, alpha) {
    var fade = clamp01(alpha);
    var h = effect.height || 168;
    /*
     * **从最后一击的那一点出发**（`sourceX` / `sourceZ` 由核心在 Boss 死时记下）：
     * 参考里光束在玩家剑上交汇，金色横光横在他胸口。上一版从 Boss 身上向四周炸，
     * 读起来像 Boss 自己发光（业主：「散光不对」）。
     */
    var ox = effect.sourceX !== undefined ? effect.sourceX : effect.x;
    var sourceZ = effect.sourceZ !== undefined ? effect.sourceZ : effect.z;
    var oy = floorY(sourceZ) - Core.SLAYER_HEIGHT * 0.55;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    /*
     * **十条斜向光束**，不是 360° 的星芒：参考 328.0s 的亮线集中在
     * 约 47°/56°/154°/167° 那几条斜线上（另有一道金色横光），数量比上一版
     * 的 6 条更密。上一版 9 条把竖直/水平方向也铺满了，读起来像"发光球"；
     * 这一版只保留斜向、加密到 10 条。
     */
    var angles = [-2.65, -2.25, -1.85, -1.45, -1.05, 1.05, 1.45, 1.85, 2.25, 2.65];
    for (var index = 0; index < angles.length; index += 1) {
      var angle = angles[index] + (scatter(effect.seed, index) - 0.5) * 0.24;
      var length = h * (2.4 + scatter(effect.seed, index + 40) * 1.9);
      var dx = Math.cos(angle);
      var dy = Math.sin(angle);
      /* 从剑尖稍微外一点起手，别让十条线在原点叠成一颗白球。 */
      var x0 = ox + dx * length * 0.04;
      var y0 = oy + dy * length * 0.04;
      var x1 = ox + dx * length;
      var y1 = oy + dy * length;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255, 70, 90, " + (0.40 * fade).toFixed(3) + ")";
      ctx.lineWidth = Math.max(1.5, h * 0.04);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 246, 246, " + (0.95 * fade).toFixed(3) + ")";
      ctx.lineWidth = Math.max(1, h * 0.01);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    /*
     * **金色横光最后画**：参考里它是最显眼的一道，画在光束下面会被十条白芯
     * 盖掉。约 450 视频像素，折成世界约 140。
     */
    var lensW = Core.SLAYER_HEIGHT * 0.9;
    var lensH = h * 0.10;
    var lens = ctx.createLinearGradient(ox - lensW / 2, oy, ox + lensW / 2, oy);
    lens.addColorStop(0, "rgba(255, 220, 120, 0)");
    lens.addColorStop(0.5, "rgba(255, 250, 220, " + (0.95 * fade).toFixed(3) + ")");
    lens.addColorStop(1, "rgba(255, 220, 120, 0)");
    ctx.fillStyle = lens;
    ctx.beginPath();
    ctx.ellipse(ox, oy, lensW / 2, lensH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /*
   * **领主的魂球**（参考 329.3–329.5s）：白剪影散掉后，在它站的那一点亮起
   * 一颗蓝白球，约 0.2–0.3 秒就灭；不是一根从地面升起的柱子。
   *
   * 画在碎块下面；`age` 从 deathburst 的年龄算，只在前 0.28 秒出现。
   */
  function drawBossSoulOrb(ctx, effect, age) {
    var life = 0.28;
    if (age >= life) return;
    var u = clamp01(age / life);
    var env = Math.sin(Math.PI * u);
    if (env <= 0.01) return;
    var h = effect.height || 168;
    var cx = effect.x;
    var cy = floorY(effect.z) - h * 0.5;
    var radius = h * (0.15 + 0.85 * env) * 0.28;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    var halo = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius * 1.45);
    halo.addColorStop(0, "rgba(255, 255, 255, " + (0.9 * env).toFixed(3) + ")");
    halo.addColorStop(0.28, "rgba(170, 235, 255, " + (0.75 * env).toFixed(3) + ")");
    halo.addColorStop(0.62, "rgba(95, 120, 255, " + (0.45 * env).toFixed(3) + ")");
    halo.addColorStop(1, "rgba(80, 50, 190, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.45, 0, Math.PI * 2);
    ctx.fill();

    /* 白热芯，跟着包络一起亮灭。 */
    var core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.55);
    core.addColorStop(0, "rgba(255, 255, 255, " + (0.95 * env).toFixed(3) + ")");
    core.addColorStop(1, "rgba(210, 245, 255, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
    ctx.fill();

    /* 几粒白火花绕着球炸开。 */
    for (var spark = 0; spark < 8; spark += 1) {
      var angle = scatter(effect.seed, spark + 160) * Math.PI * 2;
      var distance = radius * (0.7 + scatter(effect.seed, spark + 170) * 0.6);
      var size = Math.max(1, h * 0.012 * env);
      ctx.fillStyle = "rgba(240, 250, 255, " + (0.8 * env).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.8,
              size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDeathBurst(ctx, state, sprites, effect, alpha) {
    var forest = sprites && sprites.forest;
    var bossSheet = sprites && sprites.bossdeath;
    if (!forest && !bossSheet) return;
    var life = effect.maxLife || (Core.DEATH && Core.DEATH.chunks) || 0.5;
    var t = clamp01(1 - alpha) * life;
    var bossBurst = effect.type === "boss";
    /* Boss 的大肉块更重：落得快、落地后留在场上。 */
    var gravity = bossBurst ? 950 : 900;
    var count = bossBurst
      ? ((Core.DEATH && Core.DEATH.bossChunkCount) || 12)
      : ((Core.DEATH && Core.DEATH.chunkCount) || 14);
    /*
     * 三张形状轮着用 —— 录像里那些块是**小碎片**（业主：「不如视频不规则」）：
     * T+4:50 那次量到十几块，横竖大多在 **4–17 世界像素**之间，而且不少是细长的
     * 片（11.5×4.5、14×6、4×14）。所以每块按**目标宽度**反推缩放，形状本身的
     * 长须在小尺寸下正好读成碎片；大了才是叶子（上一版就是那么栽的）。
     */
    var shapes = ["0", "1", "2"];
    /* 从**身上**散开，不是从脚底 —— 从脚底起飞读起来像"地上一滩"。 */
    var body = (effect.height || 60) * (bossBurst ? 0.55 : 0.45);
    /*
     * 末四成淡出（杂兵）；Boss 的碎块要**留到过关画面**，所以一直硬着，
     * 只在最后 0.24 秒才化掉。
     */
    var fade = bossBurst ? clamp01(alpha / 0.08) : clamp01(alpha / 0.4);
    /* Boss 的肉片自带暗边，不再压一层阴影；杂兵的碎片仍用暗底做厚度。 */
    var shadow = bossBurst ? null : chunkShadowSheet(forest);
    for (var index = 0; index < count; index += 1) {
      /*
       * **领主的碎块用 `metacowpiece.img` 自己的五块肉**；杂兵仍用
       * `chunk_<type>*` 的通用血花（`docs/adr/0034` 追记二）。
       */
      var sheetForPiece = forest;
      var rect = null;
      if (bossBurst && bossSheet && BOSSPIECE.frames.length) {
        sheetForPiece = bossSheet;
        rect = BOSSPIECE.frames[index % BOSSPIECE.frames.length];
      } else {
        var piece = "chunk_" + (effect.type || "grunt") + shapes[index % shapes.length];
        rect = sceneRect(piece);
      }
      if (!rect) continue;
      /*
       * **放射**：每块自己一个角度一个初速，绕尸体甩出去 —— 都往同一个方向偏
       * 就会摊成一排、糊在地上（业主：「像落叶一样」）。角度与速度都由 id + 序号
       * 定死，同一具尸体每次都甩成同一副样子。
       */
      /*
       * 距离也是量的：录像里那些块**最远飞 60–70 世界像素**（200 px/s 上下、活 0.3 秒），
       * 我们原来 300–640 px/s × 0.5 秒 = 最远 300+，等于甩出去半个房间
       * （业主：「最后散开的距离太远了」）。
       */
      var angle = scatter(effect.seed, index * 6) * Math.PI * 2;
      /*
       * Boss 的大肉块往四周甩、再被重力拉下来；杂兵仍是快速放射。参考里
       * Boss 的块在 329.5s 前后从魂球周围散开，332.5s 过关时已经摊在地上。
       */
      var speed = bossBurst
        ? 80 + scatter(effect.seed, index * 6 + 1) * 140
        : 110 + scatter(effect.seed, index * 6 + 1) * 150;
      var vx = Math.cos(angle) * speed;
      var vy = bossBurst
        ? 45 + scatter(effect.seed, index * 6 + 4) * 130
        : Math.sin(angle) * speed * 0.55 + 70;      /* 略往上偏，甩得开 */
      var spin = (scatter(effect.seed, index * 6 + 3) - 0.5) * 11;
      /*
       * **Boss 的块从它身上不同的位置起手**，不是全从同一个点喷出来：
       * 参考 329.4s 那几块已经散在魂球周围了。起手的水平/高度各按序号散开
       * 到它身量的一小片里，然后才受速度与重力。
       */
      var x0 = effect.x;
      var h0 = body;
      if (bossBurst) {
        x0 += (scatter(effect.seed, index * 6 + 5) - 0.5) * effect.height * 0.8;
        h0 = Math.max(0, body + (scatter(effect.seed, index * 6 + 7) - 0.5) * effect.height * 0.5);
      }
      /*
       * **Boss 的块落地就停在那儿**：解出落地时间，之后 x 不再走、高度归 0。
       * 不解这一步，3 秒的寿命会让它们在地上继续滑，看着像被风吹。
       */
      var travel = t;
      if (bossBurst) {
        var land = (vy + Math.sqrt(vy * vy + 2 * gravity * h0)) / gravity;
        if (travel > land) travel = land;
      }
      var x = x0 + vx * travel;
      var height = h0 + vy * travel - 0.5 * gravity * travel * travel;
      if (height < 0) height = 0;                        /* 落地就摊在那儿 */
      /*
       * 每块按目标宽度反推缩放。Boss 的两块大的（29 / 22 px 原稿）画到
       * 40–60 世界像素，小的三块画到 22–36；杂兵仍是 6–17。
       */
      var target;
      if (bossBurst) {
        var bigPiece = rect[2] >= 20;
        target = (bigPiece ? 40 : 22) +
          scatter(effect.seed, index * 6 + 2) * (bigPiece ? 20 : 14);
      } else {
        target = 6 + scatter(effect.seed, index * 6 + 2) * 11;
      }
      var scale = target / rect[2];
      var w = rect[2] * scale;
      var h = rect[3] * scale;
      /*
       * `height` 是碎块**底边**离地的高度；画的是中心，所以要再抬 `h / 2`。
       * 不减这一下，块的中心落在落地线上，一半埋进草里（领主的大块尤其明显）。
       */
      var cy = floorY(effect.z) - height - h / 2;
      /*
       * **厚度**：同一块先往右下压一个暗的当底，再把本来的那块盖上去 —— 底下那层
       * 就成了它的厚度和暗边（业主：「不如视频中块更厚重」）。
       */
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(x, cy);
      ctx.rotate(spin * travel);
      if (shadow) {
        var edge = Math.max(1, target * 0.14);            /* 碎片小，暗边也得跟着小 */
        ctx.drawImage(shadow, rect[0], rect[1], rect[2], rect[3],
                      -w / 2 + edge, -h / 2 + edge, w, h);
      }
      ctx.drawImage(sheetForPiece, rect[0], rect[1], rect[2], rect[3], -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    /*
     * **魂球画在碎块上面**：前 0.28 秒它还在亮，而这一段碎块正挤在它周围；
     * 画在下面会整颗被棕色肉块盖掉（参考里球是看得见的）。
     */
    if (bossBurst) drawBossSoulOrb(ctx, effect, t);
  }

  /** 一扇开着的门外面那圈光。 */
  function drawGateHalo(ctx, x, y, height) {
    var radius = Math.max(70, height * 0.4);
    ctx.save();
    var halo = ctx.createRadialGradient(x, y, 8, x, y, radius);
    halo.addColorStop(0, "rgba(255, 226, 168, 0.30)");
    halo.addColorStop(1, "rgba(255, 190, 110, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 森林那张表还没落地的头几帧：还是那座手画的石门，只在右边。 */
  function drawFallbackGate(ctx, state) {
    var open = state.room && state.room.cleared;
    ctx.save();
    ctx.translate(Core.ROOM.rightWall + 6, ARENA.groundY - 60);
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
      return { row: rows.run, col: Math.floor(state.time * 15) % SPRITE.frames.run };
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

  /*
   * **他脚下那个亮黄绿椭圆**（`docs/adr/0042`）。录像里**只有玩家有**这一颗，
   * 怪没有；它也不是影子（影子另有一层），是一枚标记。
   *
   * 量出来的四条：**扁环不是实心**（中心透出地面）、**没有深色描边**（外缘直接化进
   * 地面）、**130 x 43 视频px**（即 0.49 x 0.16 身位）、**脚落在它纵向的上 1/4 处**
   * —— 大部分铺在他的脚下方向。它在全片 110 次检出里尺寸恒定，**不随深度缩放**。
   *
   * 客户端那 6 帧是脉动（帧 2-4 最亮），照它自己的帧序走；速度是本作自己的数。
   */
  var FOOT_MARK = { fps: 8, width: 130 / (265 / 84), height: 43 / (265 / 84), footShare: 0.25 };

  /*
   * 过场插画：客户端那张 800x600，铺满世界窗口（窗口正是 4:3，与它同形）。
   * 淡入 0.3 / 保持 1.5 / 淡出 0.24 —— 全部量自录像的 53.93-55.97 s。
   */
  function drawIntroArt(ctx, state, sprites) {
    var sheet = sprites && sprites.ui;
    var run = sheet && UI.cutscene;
    if (!run) return;
    var art = Core.INTRO;
    var t = state.intro.t;
    var alpha = 1;
    if (t < art.artIn) alpha = t / art.artIn;
    else if (t > art.artIn + art.artHold) {
      alpha = Math.max(0, 1 - (t - art.artIn - art.artHold) / art.artOut);
    }
    var frame = run.frames[0];
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(
      sheet,
      frame[0], frame[1], frame[2], frame[3],
      VIEW.left, 0, VIEW.width, VIEW.height
    );
    ctx.restore();
  }

  /*
   * **两行关卡名**（`docs/adr/0044`）。客户端 `mirkwood.img` 那一张里两行字都在
   * 同一张图里（上行大字 + 细线 + `Gran-Floris 格兰之森`），所以这里只画一张。
   *
   * 尺寸对得上：那 272 px 的画在录像里占 443 视频px，正是界面那一档的 ≈1.6 倍
   * （`UI_SCALE`）；换算到本作是 217.6 画布px，量到的录像字块是 221.5 —— 差 2%。
   *
   * **它画在世界那一趟里**：录像里人挡在字前面、地图的近景石柱也压在字上，
   * 所以它跟房名牌走同一个办法 —— 把世界那一趟的变换原地倒退回去。
   */
  /*
   * 画在窗口横向正中、**屏幕上**纵向 295 —— 量自 00002 的 13s 帧：两行字
   * `幽暗密林深处` + `Gran-Floris 格兰之森` 占视频 y530..650（画布 265..325，
   * 重心 295），横向中心在画面正中。
   *
   * 注意这个 `y` 走的是**世界那一趟的变换**（`drawStageTitle` 里把缩放绕
   * `groundY` 倒退回去），所以屏幕 y = groundY + (y - groundY) / zoom。
   * 要让屏幕上落在 295，这里要写反算出来的 **217**，不是 295 —— 早先写 305
   * 画出来落在 351，整块字比录像低了 56 画布 px。
   */
  var TITLE_POS = { x: 0.5, y: 217 };

  function drawStageTitle(ctx, state, sprites) {
    if (!state.titleT || state.titleT <= 0) return;
    var sheet = sprites && sprites.ui;
    var run = sheet && UI.stageTitle;
    if (!run) return;
    var left = Core.INTRO.title - state.titleT;
    var alpha = Math.min(1, left / 0.5);
    if (state.titleT < Core.INTRO.titleOut) alpha = state.titleT / Core.INTRO.titleOut;
    var w = run.cell[0] * UI_SCALE * Core.CAMERA.zoom;
    var h = run.cell[1] * UI_SCALE * Core.CAMERA.zoom;
    var index = Math.floor(left * 12) % run.frames.length;
    var frame = run.frames[index];
    ctx.save();
    ctx.translate(cameraX(state), 0);
    ctx.translate(0, ARENA.groundY);
    ctx.scale(1 / Core.CAMERA.zoom, 1 / Core.CAMERA.zoom);
    ctx.translate(0, -ARENA.groundY);
    ctx.translate(-VIEW.left, 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(
      sheet,
      frame[0], frame[1], frame[2], frame[3],
      HUD_LEFT + VIEW.width * TITLE_POS.x - w / 2,
      TITLE_POS.y - h / 2,
      w, h
    );
    ctx.restore();
  }

  function drawFootMark(ctx, state, sprites) {
    var sheet = sprites && sprites.ui;
    var run = sheet && UI.dropMark;
    var player = state.player;
    if (!run || !player || player.dead) return;
    var frames = run.frames;
    var index = Math.floor(state.time * FOOT_MARK.fps) % frames.length;
    var frame = frames[index];
    var w = FOOT_MARK.width;
    var h = FOOT_MARK.height;
    var feet = floorY(player.z);
    ctx.save();
    ctx.drawImage(
      sheet,
      frame[0], frame[1], frame[2], frame[3],
      player.x - w / 2, feet - h * FOOT_MARK.footShare, w, h
    );
    ctx.restore();
  }

  function drawPlayer(ctx, state, sprites) {
    var player = state.player;
    /*
     * **He does not blink, and there is no flash on him.**
     *
     * 挨打之后那段无敌时间以前是一闪一闪的（每秒 10 次整个消失/出现），挨打那一瞬间
     * 还会整个人提亮一下。业主 2026-10-10 的原话是「角色被打不能闪烁」，而录像量下来
     * 两条都站不住：他挨打那 20 帧**每一帧人都可见**，也没有一帧变白，只有 0.33 秒的
     * 受击硬直（`docs/adr/0030`）。所以两条一起删，不是二选一。
     *
     * `solidInvuln`（跳起来那一段的无敌）不再需要为闪烁让路了 —— 没有人闪，也就没有
     * "这一段不许闪"这件事；那个字段还留着，因为它说的是另一件事（无敌的来路）。
     */
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
    /*
     * 血之狂暴 turns him red all over. The tint is baked off-screen: source-atop
     * composites against whatever already sits on the target canvas, so filling
     * the live frame would wash the arena red instead of the character.
     */
    var body = raging && ragingSheet(image) ? ragingSheet(image) : image;
    /* 血之狂暴 的红色本来就是这股劲的颜色，不跟"挨打"抢 —— 挨打不再画任何东西（见上）。 */
    if (raging && "filter" in ctx) ctx.filter = "saturate(1.2)";
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
    /* 深处那三只：橙猫、灰绿投掷十夫长、金鬃黑身的猫 Boss。 */
    cat: { body: "#e89a4f", dark: "#8a4a1f", accent: "#ffe0a8", eye: "#ffe066" },
    throwerElite: { body: "#9aa87a", dark: "#46503a", accent: "#d9e0b8", eye: "#ffd166" },
    /* 深处的十夫长用客户端的 goblintaskmaster（蓝绿、弯刀），不是白毛的 whiteboss。 */
    deepElite: { body: "#8fb0c8", dark: "#465a6e", accent: "#d9f0ff", eye: "#ffd166" },
    lugaruBoss: { body: "#d9b45a", dark: "#2b2620", accent: "#ffe9a8", eye: "#ff3b3b" },
    bossPhase2: { body: "#ff4d6d", dark: "#8c0f26", accent: "#ffe9a8", eye: "#ff3b3b" }
  };

  /*
   * The monsters are the client's own art: `assets/monsters.png`, baked by
   * `assets/import_dnf_monsters.py`. One row per archetype, frames in the
   * client's own order.
   *
   * **Which frame is which action is not in the client** - it lives in the
   * encrypted `Script.pvf` `.ani`. The ranges below were read off the owner's
   * 幽暗密林 recording, by putting the video's frames next to the art's and
   * matching poses (`assets/match_monster_motions.py`, `docs/granfloris-assets.md`).
   *
   * The cell and the anchor belong to the bake, not to this file: the sheet puts
   * every monster's feet on `anchorY`, with the idle footprint centred on
   * `anchorX`.
   */
  /*
   * **白色剪影按格做，不整张烘。** 整张 monster sheet 是 15360×4000，逐像素
   * 二值化会吃掉几百 MB；一只怪只占一格 480×500，所以死的那一下按 `(row,column)`
   * 取一格、把 alpha 二值化成实心白、再在四周压一圈黑描边，缓存起来。
   * 参考里哥布林和领主的白团都有黑边（`docs/adr/0034` 追记二）。
   */
  var silhouetteCache = {};

  /*
   * 一张压暗的森林图，给碎块当"厚度"用（source-atop 压黑，整张烘一次、缓存）。
   * 只为那十二块服务，但每帧每块都要画两次，所以不能现场做。
   */
  var chunkDark = null;

  function chunkShadowSheet(image) {
    if (typeof document === "undefined" || !document.createElement) return null;
    if (chunkDark && chunkDark.source === image) return chunkDark.sheet;
    var canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    var brush = canvas.getContext("2d");
    if (!brush) return null;
    brush.drawImage(image, 0, 0);
    brush.globalCompositeOperation = "source-atop";
    brush.fillStyle = "rgba(0, 0, 0, 0.5)";
    brush.fillRect(0, 0, canvas.width, canvas.height);
    chunkDark = { source: image, sheet: canvas };
    return canvas;
  }

  var MONSTER = {
    /*
     * **一格 360x420，不是 480x500**（2026-10-21）：加进猫妖一族之后，
     * 37 列 × 480 会把整张 sheet 撑到 17760 宽，超过浏览器 16384 的纹理上限；
     * 缩到 360 宽后 13320，整张 61.5M 像素，和加猫之前那一版基本一样大
     * （15360x4000）。牛头巨兽 170 左 / 96 右的挥击仍然装得下。
     */
    cellW: 360,
    cellH: 420,
    anchorX: 180,
    anchorY: 260,
    rows: {
      grunt: 0, coward: 1, caster: 2, brute: 3, elite: 4, boss: 5,
      /* 换色的两具是后加的两行（`assets/import_dnf_monsters.py` 的 ROSTER 顺序）。 */
      goblinBlue: 6, goblinRed: 7,
      /* 幽暗密林深处 的三只：猫妖、投掷十夫长、暗咒猫妖（ROSTER 顺序 8/9/10）。 */
      cat: 8, throwerElite: 9, lugaruBoss: 10,
      /* 深处的十夫长借投掷十夫长那一行（同一具 goblintaskmaster 美术）。 */
      deepElite: 9,
      /*
       * 冠军怪那两条**没有自己的行**：它们是同一个兵种加一层光环（`docs/adr/0046`），
       * 所以指回原来那一行 —— 咒之赤哥布林就是赤哥布林那张画，燃烧之投掷就是投掷
       * 哥布林那张画。
       */
      cursedRed: 7, burningThrower: 2
    },
    frames: {
      grunt: 17, coward: 17, caster: 17, brute: 32, elite: 17, boss: 32,
      goblinBlue: 17, goblinRed: 17,
      cat: 37, throwerElite: 17, lugaruBoss: 37,
      deepElite: 17,
      cursedRed: 17, burningThrower: 17
    },
    /*
     * How tall each monster's art is on frame 0, in the sheet's own pixels.
     * Measured off the sheet (the alpha box of frame 0), not picked.
     */
    stand: {
      grunt: 76, coward: 76, caster: 78, brute: 164, elite: 86, boss: 164,
      /* 换色那两具是同一套画布，烘的时候量出来的和 `grunt` 一模一样。 */
      goblinBlue: 76, goblinRed: 76,
      /*
       * 猫妖/暗咒猫妖的 `.img` 是 73×75 的画布，站姿帧的墨高 75；投掷十夫长
       * 和十夫长同族，量出来 86。**烘焙后用 `--report` 复核**，不一致改这里。
       */
      cat: 74, throwerElite: 75, lugaruBoss: 74,
      deepElite: 75,
      cursedRed: 76, burningThrower: 78
    },
    /*
     * **头像那一块**，相对于它自己那一格的左上角。
     *
     * 哥布林沿用"站姿帧顶部居中"的裁法；牛头巨兽是**侧身低头**，头不在锚点
     * 正上方 —— 照那条通用裁法切出来的是肩膀。这个矩形是照它的头量的：
     * 那一格整只怪只占 x 230..370、y 170..340，头在最上面 x 242..372、
     * y 168..244（含白鬃与獠牙），宽高比 130:76。头像框是方的，所以
     * `drawMonsterFace` 按比例装进去、上下留一点黑边，不把它拉扁。
     */
    face: {
      /* 牛头巨兽的头：原来按 480x500/锚点 300,340 量，跟着格子缩了 100/40。 */
      boss: [122, 88, 130, 76]
    },
    /*
     * **How big a monster is drawn is `enemy.height`, the same number the fight
     * is fought on.** The two used to differ - the art followed the client and
     * the box stayed where it had been tuned - because every AI reach was
     * centre-to-centre, so a body that grew lost that much of its reach. With the
     * reaches measured past the body (`bodyGap` in src/core.js) the box can be
     * the art's size, and `ENEMY_TYPES` is where both are decided.
     */
    /*
     * The ten goblin bodies are **one set of seventeen poses**, and that was
     * measured rather than assumed - their silhouettes match frame for frame at
     * IoU 0.74-0.94 - so `grunt`, `coward`, `caster` and `elite` all read this
     * one table, and only the beast (32 frames) will need its own.
     *
     * Read off the recording at 63.0-94.6s: a goblin stands on f0, swings
     * f1-f6, is on its back f7-f9, gets up f10-f11, walks f12-f16.
     * **There is no hurt pose among the seventeen** - a hit is the white flash
     * and nothing else, which is also how the client reads.
     */
    goblin: {
      idle: [0, 0],
      attack: [1, 6],
      down: [7, 9],
      rise: [10, 11],
      walk: [12, 16]
    },
    /*
     * 牛头巨兽, read off the same recording by overlaying each candidate frame's
     * silhouette back onto the video and keeping only the fits - the boss fight
     * runs 236-330s. Its own report marks two things as **not settled**, and they
     * are recorded here as such rather than smoothed over:
     *
     * - **`idle` may really be `f0-f1` or may be the `walk` run.** f20-f27 is a
     *   walk beyond doubt (it is on screen while the beast is measurably moving,
     *   +307 px and -276 px, with a static camera), but the beast also plays
     *   that run while standing still for a moment, so which run is *the* idle
     *   is open. f0-f1 is the choice that costs least if it is wrong: two frames
     *   of breathing.
     * - **There are no hurt frames.** Hit without being knocked down, the beast
     *   holds its pose and flashes - which is also what the goblins do.
     *
     * f7-f8, f16-f19 and f28-f31 are transition crouches the recording never
     * isolates, so no state names them.
     *
     * `tau/body01`, `03`, `04` and `06` are **pixel-identical to `body02`** - a
     * frame-by-frame XOR comes out at exactly 0.0000 across all 32 - so they read
     * this table too. `body05` differs slightly and `body07` (牛头王) is another
     * body entirely; neither is in this stage.
     */
    tau: {
      idle: [0, 1],
      attack: [2, 6],
      down: [9, 12],
      rise: [13, 15],
      walk: [20, 27]
    },
    /*
     * 猫妖一族（`lugaru` 与 `blacklugaru` 是同一套 37 帧的画布）：f0 蹲伏待机，
     * f1-f4 快速扑爪（金色拖尾），f8-f11 宽幅横扫（金色月牙），f16-f19 倒地，
     * f20-f28 低姿爬走。**这四个范围是从客户端帧序和录像对出来的**；f5-f7、
     * f12-f15、f29-f36 是待机/过渡，没被任何状态占用。
     */
    lugaru: {
      idle: [0, 0],
      attack: [1, 4],
      sweep: [8, 11],
      down: [16, 19],
      walk: [20, 28]
    },
    poses: {
      grunt: "goblin",
      coward: "goblin",
      caster: "goblin",
      elite: "goblin",
      brute: "tau",
      boss: "tau",
      cat: "lugaru",
      throwerElite: "goblin",
      deepElite: "goblin",
      lugaruBoss: "lugaru",
      /*
       * 换色的那两具走的是**同一套十七帧动作**（客户端那一族本来就是同一画布换色，
       * 量过：轮廓逐帧 IoU 0.74–0.94），所以它们读同一个姿势表。
       */
      goblinBlue: "goblin",
      goblinRed: "goblin"
    }
  };

  /**
   * **一格白色剪影：实心白 + 黑描边。**
   *
   * `ghostSheet` 原来把整张图用 `source-atop` 涂白，保留了半透明边和内部灰
   * 细节；参考录像里哥布林的白团（96.667s）和领主的白团（328.2s）都是
   * **硬的实心白 + 一圈黑边**。所以这里取当前这一格，把 alpha > 32 的像素
   * 全部变成不透明白，再把同一块 mask 往八个方向各偏 `outline` 像素压黑，
   * 最后把白 mask 盖回去。按格缓存，死的那 0.3 / 0.9 秒只做一次。
   */
  function silhouetteCell(image, row, column) {
    if (typeof document === "undefined" || !document.createElement) return null;
    var key = row + ":" + column;
    var cached = silhouetteCache[key];
    if (cached && cached.source === image) return cached.canvas;
    var cw = MONSTER.cellW;
    var ch = MONSTER.cellH;
    var source = document.createElement("canvas");
    source.width = cw;
    source.height = ch;
    var sb = source.getContext("2d");
    if (!sb) return null;
    sb.drawImage(image, column * cw, row * ch, cw, ch, 0, 0, cw, ch);
    var data = sb.getImageData(0, 0, cw, ch);
    var px = data.data;
    var white = document.createElement("canvas");
    white.width = cw;
    white.height = ch;
    var wb = white.getContext("2d");
    if (!wb) return null;
    var mask = wb.createImageData(cw, ch);
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 32) {
        mask.data[i] = 255;
        mask.data[i + 1] = 255;
        mask.data[i + 2] = 255;
        mask.data[i + 3] = 255;
      }
    }
    wb.putImageData(mask, 0, 0);

    var black = document.createElement("canvas");
    black.width = cw;
    black.height = ch;
    var bb = black.getContext("2d");
    bb.drawImage(white, 0, 0);
    bb.globalCompositeOperation = "source-in";
    bb.fillStyle = "#000000";
    bb.fillRect(0, 0, cw, ch);

    var out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    var ob = out.getContext("2d");
    var edge = Math.max(2, Math.round(ch * 0.006));
    for (var dx = -edge; dx <= edge; dx += edge) {
      for (var dy = -edge; dy <= edge; dy += edge) {
        if (!dx && !dy) continue;
        ob.drawImage(black, dx, dy);
      }
    }
    ob.drawImage(white, 0, 0);
    silhouetteCache[key] = { source: image, canvas: out };
    return out;
  }

  /** Which pose an enemy is in, in the sheet's own words. */
  function monsterPose(enemy) {
    if (enemy.dead || enemy.knockdown > 0) return "down";
    /* 猫 Boss 的横扫有自己的四帧；别的攻击仍走 attack。 */
    if (enemy.attackTimer > 0) return enemy.attackKind === "sweep" ? "sweep" : "attack";
    if (Math.abs(enemy.vx || 0) > 1 || Math.abs(enemy.vz || 0) > 1) return "walk";
    return "idle";
  }

  /**
   * The frame to draw: the pose's own range, walked by whatever clock that pose
   * runs on - the swing's timer, a walking monster's gait, a standing one's slow
   * breath. `down` holds its last frame, because a body on the floor is not
   * doing anything, and a pose with no range in the table falls back to the
   * first frame rather than to a frame from another action.
   */
  function monsterFrame(state, enemy, table) {
    var pose = monsterPose(enemy);
    var range = table[pose] || table.idle || [0, 0];
    var first = range[0];
    var span = range[1] - range[0];
    if (span <= 0) return first;
    if (pose === "attack" || pose === "sweep") {
      var progress = 1 - Math.max(0, enemy.attackTimer / (enemy.attackDuration || 1));
      return first + Math.min(span, Math.floor(progress * (span + 1)));
    }
    if (pose === "down") return range[1];
    var beat = pose === "walk" ? 11 : 3.2;
    return first + (Math.floor(state.time * beat) % (span + 1));
  }

  /**
   * One monster, out of the sheet. His feet go on the ground point the bake put
   * them at, so the sprite and his hitbox agree without either one being scaled
   * to the other - the drawn height IS `enemy.height`, which is the contract the
   * boxes were laid out on.
   *
   * **The client's monsters face right**, like `assets/slayer.png`; the old
   * shape art faced left, so the flip is inverted here (it was
   * `facing > 0`).
   */
  /*
   * **冠军怪那一圈光环**（`docs/adr/0046`）。客户端里"冠军怪"不是另一具身体，
   * 是**同一具身体另加一层 `champ*.img`**：一圈发光的地环 + 升起来的焰，分前
   * （画在怪身上）后（画在怪身后）两层。录像里 `咒之赤哥布林` 身上那圈紫光就是
   * `champdark`，`champfire` 是同族的火属性那一套。
   *
   * 尺寸走**界面那一档**（`UI_SCALE`）：它 172 px 的墨按 1:1 画是 2 个身位宽，
   * 而它罩着的那只哥布林自己只有 0.9 —— 按 1:1 会盖掉半间房。
   */
  var CHAMPION_AURA = {
    dark: "champdark",
    fire: "champfire",
    /* 每秒放几帧。录像里那是火焰在动的节奏，本作没有逐帧量它。 */
    fps: 12
  };

  function drawChampionAura(ctx, state, enemy, sprites, layer) {
    var run = enemy.champion && CHAMPION_AURA[enemy.champion];
    var sheet = sprites && sprites.ui;
    var back = layer === "back";
    var art = run && sheet && UI[back ? run + "back" : run];
    if (!art) return;
    var frames = art.frames;
    var frame = frames[Math.floor(state.time * CHAMPION_AURA.fps) % frames.length];
    var w = frame[2] * UI_SCALE * Core.CAMERA.zoom;
    var h = frame[3] * UI_SCALE * Core.CAMERA.zoom;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(sheet, frame[0], frame[1], frame[2], frame[3],
                  enemy.x - w / 2, feetY(enemy) - h * 0.82, w, h);
    ctx.restore();
  }

  function drawMonster(ctx, state, enemy, sprites) {
    var sheet = sprites && sprites.monsters;
    if (!sheet || !sheet.width) return false;
    var row = MONSTER.rows[enemy.type];
    if (row === undefined) return false;
    var table = MONSTER[MONSTER.poses[enemy.type]];
    var column = monsterFrame(state, enemy, table || { idle: [0, 0] });
    /*
     * 死的那一段画的是**它自己的白色剪影**（`docs/adr/0034`，业主：「出现白色怪物
     * 轮廓」）—— 同一行、同一列、同一处落脚点，但这一格是**实心白 + 黑描边**
     * （`silhouetteCell`），不是原来的半透明白。
     */
    var ghost = enemy.silhouette ? silhouetteCell(sheet, row, column) : null;
    var art = enemy.height;
    /* The sheet is in the client's own pixels; `enemy.height` is in ours. */
    var scale = art / (MONSTER.stand[enemy.type] || MONSTER.stand.grunt);
    var dw = MONSTER.cellW * scale;
    var dh = MONSTER.cellH * scale;

    ctx.save();
    ctx.translate(enemy.x, feetY(enemy));
    if (enemy.facing < 0) ctx.scale(-1, 1);
    if (!ghost && enemy.hurtTimer > 0 && "filter" in ctx) ctx.filter = "brightness(1.9)";
    if (ghost) {
      ctx.drawImage(
        ghost,
        -MONSTER.anchorX * scale, -MONSTER.anchorY * scale, dw, dh
      );
    } else {
      ctx.drawImage(
        sheet,
        column * MONSTER.cellW, row * MONSTER.cellH, MONSTER.cellW, MONSTER.cellH,
        -MONSTER.anchorX * scale, -MONSTER.anchorY * scale, dw, dh
      );
    }
    ctx.restore();
    /*
     * **怪头顶的名字。** 量出来只有"**有名字的怪**"才有：录像里普通哥布林头上什么都没有，
     * 而 `诅咒之赤哥布林` 有、Boss 也有。本作照这条办 —— **只有 `grunt` 那一档不写**，
     * 它是这一关里唯一"无名"的杂兵。
     *
     * 颜色量到两个值：哥布林那只 `#A975E5`（淡蓝紫）、Boss 那只 `#DD04C3`（品红）。
     * 分不出这是"两个颜色"还是"同一个半透明的字压在两种背景上"（Boss 站在自己的红气里），
     * 所以这里取**一个**色，写成 `MONSTER_NAME.fill` 一个数 —— 要分色，改一处。
     */
    drawMonsterName(ctx, state, enemy);
    return true;
  }

  var MONSTER_NAME = {
    /*
     * 字高 24 视频像素 = 7.6 **世界**像素（这一层在世界里画，跟着镜头一起放大）——
     * 一个汉字的字面高差不多就是一个字号，所以字号取 8。
     */
    font: "700 8px 'PingFang SC', 'Segoe UI', system-ui, sans-serif",
    fill: "#a975e5",
    /* 浮在头顶上方：量到约 15 视频像素。 */
    lift: 15 * Core.VIDEO_PX,
    /* 唯一不写名字的那一档。 */
    anonymous: "grunt"
  };

  function drawMonsterName(ctx, state, enemy) {
    /*
     * **普通怪头顶不写名字**（录像 30s / 330s 都没有）：只有领主在成为
     * `state.target` 时浮出名字（`docs/adr/0064` 改写 `0060`）。
     * 目标条仍然显示每一只当前目标的名字。
     */
    if (enemy.dead) return;
    var boss = Core.isBossEnemy(enemy);
    if (!boss) return;
    if (!state.target || state.target.enemy !== enemy) return;
    var info = Core.monsterInfo(enemy.type);
    if (!info) return;
    ctx.save();
    ctx.font = MONSTER_NAME.font;
    ctx.textAlign = "center";
    ctx.lineWidth = Math.max(1, 2.5 * Core.VIDEO_PX);
    ctx.strokeStyle = "rgba(24, 4, 32, 0.92)";
    var y = feetY(enemy) - enemy.height - MONSTER_NAME.lift;
    ctx.strokeText(info.label, enemy.x, y);
    ctx.fillStyle = boss ? "#DD04C3" : MONSTER_NAME.fill;
    ctx.fillText(info.label, enemy.x, y);
    ctx.restore();
  }

  function drawPlayerName(ctx, state) {
    var player = state.player;
    if (!player || player.dead) return;
    ctx.save();
    ctx.font = MONSTER_NAME.font;
    ctx.textAlign = "center";
    ctx.lineWidth = Math.max(1, 2.5 * Core.VIDEO_PX);
    ctx.strokeStyle = "rgba(24, 4, 32, 0.92)";
    var y = feetY(player) - (player.height || 84) - MONSTER_NAME.lift;
    var text = "Lv." + player.level + " 鬼剑士";
    ctx.strokeText(text, player.x, y);
    ctx.fillStyle = "#e6eef8";
    ctx.fillText(text, player.x, y);
    ctx.restore();
  }

  function drawEnemy(ctx, state, enemy, sprites) {
    var enraged = enemy.behavior === "boss" && enemy.phase >= 2;
    var style = enraged
      ? ENEMY_STYLE.bossPhase2
      : ENEMY_STYLE[enemy.type] || ENEMY_STYLE.grunt;
    var w = enemy.width;
    var h = enemy.height;

    /*
     * **领主脚下不画影子**（业主 2026-10-21：「脚底下的光环」）。
     * 普通怪仍保留这圈影子，它给出深度；领主只留目标条与阶段闪光。
     */
    if (!Core.isBossEnemy(enemy)) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(enemy.x, feetY(enemy) + 3, w * 0.62, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /*
     * **领主的半血红环也去掉**：Q11 已经定了深处用金色一闪、mirkwood 用暴怒横幅。
     * 这里的持续脉冲环不是录像里的东西，也不再给任何领主画。
     */

    /*
     * The body. If the sheet is missing - a stale staging step, a bake that was
     * never run - the old block-colour figure still draws, because a monster you
     * cannot see is worse than one you can (the deploy test is what keeps that
     * from happening quietly).
     */
    /* 冠军怪那一圈光环的**背面层**画在它身后（`docs/adr/0046`）。 */
    drawChampionAura(ctx, state, enemy, sprites, "back");
    if (!drawMonster(ctx, state, enemy, sprites)) {
      ctx.save();
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
      ctx.fillStyle = style.eye;
      ctx.beginPath();
      ctx.arc(-w * 0.12, -h * 0.8, 2.6, 0, Math.PI * 2);
      ctx.arc(w * 0.12, -h * 0.8, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /* 光环的**正面层**画在怪身上（`docs/adr/0046`）：那圈焰要从它身上烧出来。 */
    drawChampionAura(ctx, state, enemy, sprites, "front");

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

    /* 录像里没有这圈红色预警；深处的出招提示只留音效，不画环。 */
    if (enemy.attackTimer > 0 &&
        !(state.stage && state.stage.id === "mirkwooddeep")) {
      var windup = 1 - Math.max(0, enemy.attackTimer / enemy.attackDuration);
      var radius =
        enemy.attackKind === "slam" && enemy.slam
          ? enemy.slam.radius
          : enemy.attackKind === "sweep" && enemy.sweep
            ? enemy.sweep.radius
            : enemy.attackKind === "spin" && enemy.spinDash
              ? enemy.spinDash.radius
              : enemy.attackRange;
      var telegraphX = enemy.x;
      if (enemy.attackKind === "sweep" && enemy.sweep) {
        telegraphX += enemy.facing * enemy.sweep.offset;
      }
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * windup;
      ctx.strokeStyle = "rgba(255, 120, 120, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(telegraphX, feetY(enemy) -h * 0.55, radius * (0.35 + windup * 0.65), 0, Math.PI * 2);
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
      ctx.fillStyle = enemy.behavior === "boss" ? PALETTE.danger : "#ff9d5c";
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
    ctx.drawImage(image, HUD_LEFT - slide * width, CUT_IN.bottom - height, width, height);
    ctx.restore();
  }

  /*
   * Everything on the floor is 血球 now - monsters stopped leaving heal orbs
   * behind when they died (docs/adr/0021), so this is a name for the walk over
   * `state.pickups` rather than a dispatcher with one case in it.
   */
  function drawDrop(ctx, state, drop, sprites) {
    if (drop.kind === "loot" || drop.kind === "gold") {
      drawLootPlate(ctx, state, drop);
      return;
    }
    drawBloodOrb(ctx, state, drop, sprites);
  }

  /*
   * **地上那块写着物品名的名牌**（`docs/adr/0042`）。录像里它不是一个图标：一块
   * 深色半透明底 + 2-3 px 亮边的圆角牌，里面一行**浅青 (126,210,216)** 的字，
   * 牌宽随名字长度（`诺顿的新手HP药剂` 那块是 263 x 45 视频px）。
   *
   * **边框会变色**：脚下那件（走进去就收得到的那件）换成**黄绿亮边** —— 录像里
   * 同一件东西在 245.8 s 是黄绿边、249.0 s 不在脚下时是白边。那是"这一件现在
   * 收得走"的读数，所以它得跟判定用同一个半径，不能另编一个是给眼睛看的。
   */
  var LOOT_PLATE = {
    padX: 7,
    padY: 4,
    font: 9,
    radius: 3,
    ink: "#7ed2d8",
    edge: "rgba(226,232,238,0.92)",
    ready: "#c6f04a",
    back: "rgba(10,14,20,0.72)"
  };

  function lootWithinReach(state, drop) {
    var player = state.player;
    if (!player || player.dead) return false;
    var onRow =
      Math.abs((player.z || 0) - (drop.z || 0)) <= Core.DEPTH_REACH.melee * Core.SLAYER_HEIGHT;
    return onRow && Math.abs(player.x - drop.x) <= Core.LOOT.reach + player.width / 2;
  }

  function drawLootPlate(ctx, state, drop) {
    var ready = lootWithinReach(state, drop);
    var text = drop.name;
    ctx.save();
    ctx.font = "600 " + LOOT_PLATE.font.toFixed(1) + "px 'PingFang SC', 'Segoe UI', sans-serif";
    var w = ctx.measureText(text).width + LOOT_PLATE.padX * 2;
    var h = LOOT_PLATE.font + LOOT_PLATE.padY * 2;
    var x = drop.x - w / 2;
    var y = floorY(drop.z) - h;
    roundRect(ctx, x, y, w, h, LOOT_PLATE.radius);
    ctx.fillStyle = LOOT_PLATE.back;
    ctx.fill();
    ctx.lineWidth = ready ? 2 : 1.4;
    ctx.strokeStyle = ready ? LOOT_PLATE.ready : LOOT_PLATE.edge;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    /* 石碑只掉金币：同一块牌，字换成金色。 */
    ctx.fillStyle = drop.tone === "gold" ? "#e3bf72" : LOOT_PLATE.ink;
    ctx.fillText(text, drop.x, y + h / 2 + 0.5);
    ctx.restore();
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
      /*
       * **量出来的画法**（录像像素 → 世界像素都过 `Core.VIDEO_PX` = 84/265）。
       *
       * - **粗斜体**（量到向右斜 10–22°）、纯黄 `#FFFF00`、黑描边；
       * - 字高 **22 视频像素** = **7.0 世界像素**；
       * - 活 **0.6 秒**（在 `pushDamageEffect` 上），**到点直接消失**；
       * - 走法**不是匀速上浮**：头 **0.17 秒** 蹿上去约 **10 视频像素**，然后**停在那儿**
       *   一动不动。量了 35 个数字，**没有一个往下掉**，也没有一个淡出。
       *
       * 早先这里是一路匀速浮 28 像素、边浮边淡出 —— 两条都是错的读法，
       * 错在把"蹿一下然后悬住"看成了"慢慢飘上去"。
       */
      var climb = HIT_TEXT.climb * Math.min(1, (1 - alpha) / HIT_TEXT.climbShare);
      ctx.save();
      /*
       * 不淡出：`alpha` 只用来算走到哪一帧，不用来调透明度。签名里那句
       * "alpha 1 → 0" 在这一支上是**还剩多少寿命**，不是"多透明"。
       */
      ctx.globalAlpha = 1;
      /*
       * A miss rides the damage effect because it *is* that hit's readout -
       * there is just no number in it. It is smaller and grey-blue rather than
       * gold, so "I did nothing" can never read as "I did damage"
       * (docs/adr/0018).
       */
      ctx.font = effect.miss ? HIT_TEXT.missFont : HIT_TEXT.damageFont;
      ctx.textAlign = "center";
      ctx.lineWidth = HIT_TEXT.outline;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.92)";
      ctx.strokeText(effect.text, effect.x, ey - climb);
      ctx.fillStyle = effect.miss ? "#b9c6d8" : HIT_TEXT.damageFill;
      ctx.fillText(effect.text, effect.x, ey - climb);
      ctx.restore();
    } else if (effect.kind === "hitWord") {
      /*
       * 命中状态词（`Core.HIT_WORD`）：冷白、深色描边、字高 29 视频像素，
       * **钉在怪身上**（不是钉在数字上），**不淡出**，活完就消失。
       */
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.font = HIT_TEXT.wordFont;
      ctx.textAlign = "left";
      ctx.lineWidth = HIT_TEXT.outline;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.92)";
      ctx.strokeText(effect.text, effect.x, ey);
      ctx.fillStyle = HIT_TEXT.wordFill;
      ctx.fillText(effect.text, effect.x, ey);
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
    } else if (effect.kind === "pickupText") {
      /*
       * `+40 Exp`（`docs/adr/0042`）：亮绿 (105,198,46) 带黑描边，**上浮 66 视频px
       * 用 0.3 秒**（约 220 px/s）然后停住，整串活不到 1 秒。它是"这一件收进来了"的
       * 读数，所以钉在**掉落点**上，不跟人走。
       */
      var climb = Math.min(1, (1 - alpha) / 0.3) * (66 / (265 / 84));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "700 11px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = "rgba(10, 18, 8, 0.9)";
      ctx.strokeText(effect.text, effect.x, ey - climb);
      ctx.fillStyle = "#69c62e";
      ctx.fillText(effect.text, effect.x, ey - climb);
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
        return !enemy.dead && enemy.behavior === "boss";
      });
      /* Simultaneous banners stack instead of overprinting each other. */
      var bannerY = (bossOnScreen ? 230 : 104) + (bannerOrdinal || 0) * 34;
      ctx.save();
      /*
       * **它是屏幕上的字，不是房间里的东西。**
       *
       * 偏偏又是在世界那一趟里画出来的（房名牌按顺序和别的效果混在一起），而世界那一趟
       * 现在已经"拉近 + 平移"了（`docs/adr/0035`）—— 不退回去的话，这块字会跟着房间跑、
       * 跟着 zoom 变大、还会被算到画面外面去（y=104 在世界坐标里，乘完 zoom 是负的）。
       *
       * 所以这里把**世界那一趟的变换原样倒退回去**：反向、逆序，正好是下面四行。
       * 没有用 `setTransform(1,0,0,1,0,0)` 是因为那会连外层的屏幕震动一起抹掉 ——
       * 挨打时那块房名牌跟着震一下是对的。
       */
      ctx.translate(cameraX(state), 0);
      ctx.translate(0, ARENA.groundY);
      ctx.scale(1 / Core.CAMERA.zoom, 1 / Core.CAMERA.zoom);
      ctx.translate(0, -ARENA.groundY);
      /* 还有世界窗口那一段横向偏移（`docs/adr/0040`）—— 退干净之后 x 才是屏幕 x。 */
      ctx.translate(-Core.VIEW.left, 0);
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
      /* 猫 Boss 的二阶段闪光：同一条环，换成金色，读作"它变了"。 */
      ctx.strokeStyle = effect.gold ? "#ffd166" : "#ffb066";
      ctx.lineWidth = effect.gold ? 6 : 4;
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
    } else if (effect.kind === "deathburst") {
      drawDeathBurst(ctx, state, sprites, effect, alpha);
    } else if (effect.kind === "bossrays") {
      drawBossRays(ctx, effect, alpha);
    } else if (effect.kind === "bossburst") {
      drawBossBurst(ctx, effect, alpha);
    } else if (effect.kind === "bossbeam") {
      drawBossBeam(ctx, state, effect, alpha);
    }

    if (effect.kind === "damage" && !effect.miss) {
      /* sparks around every damage number - but never around a miss: nothing
         connected, so nothing flies off it (docs/adr/0018). */
      var spark = 1 - alpha;
      var sparkSize = HIT_TEXT.sparkScale;
      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = "#ffd9a0";
      ctx.lineWidth = 2 * sparkSize;
      for (var i = 0; i < 5; i += 1) {
        var angle = (i / 5) * Math.PI * 2 + effect.x;
        var inner = (6 + spark * 16) * sparkSize;
        var outer = inner + 7 * sparkSize;
        ctx.beginPath();
        ctx.moveTo(effect.x + Math.cos(angle) * inner, ey + Math.sin(angle) * inner);
        ctx.lineTo(effect.x + Math.cos(angle) * outer, ey + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /*
   * **左上角的"当前目标"块**（`Core.TARGET`）。量自业主的幽暗密林录像：
   * 一个描金的**头像框**（怪的脸）、一块**类别牌**（`人型` / `野兽`）、
   * `Lv{n} 名字`、下面一条**红血条**。**每一只怪都会有** —— 它不是精英专属。
   *
   * **长度怎么折**：录像像素 × `HUD_PX`。`HUD_PX` = 一个录像像素在**屏幕上**等于多少，
   * = `Core.VIDEO_PX`（录像 → 世界）× `Core.CAMERA.zoom`（世界 → 屏幕）
   * = 84/265 × 1.5775 = **0.5**。它和 `Core.VIDEO_PX` 不是一回事：那个折进**世界**，
   * 跟着镜头一起放大缩小；这一块是 HUD，画在屏幕那一层，所以要用屏幕这一档。
   */
  var HUD_PX = Core.VIDEO_PX * Core.CAMERA.zoom;

  /** HUD 上的字号：中文优先，回落到系统字体。 */
  function HUD_FONT(size) {
    return "700 " + size.toFixed(1) + "px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
  }

  /*
   * 那块条的尺寸，单位是**录像像素**（画的时候乘 `HUD_PX`）。除了血条长度，
   * 每一个数都是从帧里量出来的。
   */
  var TARGET_PANEL = {
    x: HUD_LEFT + 8,
    /* 玩家卡已按录像撤掉；目标条回到左上角第一行（录像矩形 10,50,340,75）。 */
    y: 25,
    portrait: [50, 52],
    gap: 3,
    rowH: 30,
    nameW: 250,
    tagW: 72,
    textSize: 26,
    barH: 28,
    barBorder: 3,
    /* 边框里那一条红有多高 —— 量出来是 20（上下各 6 是边框与内边距）。 */
    barInner: 18,
    /*
     * **血条长度**：录像里**每只怪不一样**（哥布林量到 287 / 323 / 362，牛头巨兽 1068），
     * 跟着怪变 —— 是照最大血量还是照个头，量不出来（只有三个样本）。所以这里**不编公式**：
     * 杂兵一律取那个出现得最多的 362，Boss 取 1068。真查出规律再改这两个数。
     */
    barW: 250,
    /*
     * **1068，不是 278。** 2026-10-17 重看录像（`docs/adr/0054`）：`x 328..1396`
     * 从来就是**一条**条，绿色是 HP 填充、橙色是这条里没被填满的空槽（上面写满
     * `ALERT!`）。`278` 是 t≈250s 那一帧的绿色剩余量，不是条长 —— 同一场 Boss
     * 战里绿色在 t=232s 还有 776。Boss 条因此按整条重做。
     */
    bossBar: 1068,
    /*
     * 录像里 Boss 头像 80×80、条高 59；本作把它放在玩家卡下面（见 bossY）。
     * **条高 59 → 70**（2026-10-18 业主：「boss的血条应该是粗的」）：宽度仍是
     * 录像的 1068，只把条加厚，让它读起来是一条实心的大条，而不是细带。
     */
    bossPortrait: 80,
    bossBarH: 70,
    /*
     * **录像里这块条贴着屏幕最上沿（y≈97 视频px）**，本作左上角是玩家卡
     * （y 14..110）与配速行（y 128），所以把它放在它们下面：内容与形状照录像，
     * 绝对位置不照（`docs/adr/0054`）。
     */
    bossY: 25
  };

  /** 把一张怪的脸画进头像框：取它站姿那一帧的**头部**那一段。 */
  function drawMonsterFace(ctx, sprites, type, box) {
    var sheet = sprites && sprites.monsters;
    var row = MONSTER.rows[type];
    if (!sheet || row === undefined) return false;
    var face = MONSTER.face && MONSTER.face[type];
    if (face) {
      /* 这一只的头不按通用裁法长（牛头巨兽的侧身低头）：按量的矩形装进框里。 */
      var fit = Math.min(box.w / face[2], box.h / face[3]);
      var fw = face[2] * fit;
      var fh = face[3] * fit;
      ctx.drawImage(
        sheet,
        row * MONSTER.cellW + face[0], row * MONSTER.cellH + face[1], face[2], face[3],
        box.x + (box.w - fw) / 2, box.y + (box.h - fh) / 2, fw, fh
      );
      return true;
    }
    var stand = MONSTER.stand[type] || MONSTER.cellH;
    /*
     * 头在站姿那一帧的顶上：`stand` 是那一帧画了多高，锚点（脚底）在 `anchorY`。
     * 取顶部 55% 见方的一块 —— 哥布林的头宽而扁，切太窄会把耳朵切掉。
     *
     * **行列偏移不能漏**（`drawMonster` 取的是 `column*cellW, row*cellH` 那一格）：
     * 少加 `row * cellH` 就是从上排那只怪身上切一块下来，头像是别人的。
     */
    var side = stand * 0.62;
    var sx = MONSTER.anchorX - side / 2;
    var sy = row * MONSTER.cellH + MONSTER.anchorY - stand;
    var sh = stand * 0.55;
    ctx.drawImage(sheet, row * MONSTER.cellW + sx, sy, side, sh, box.x, box.y, box.w, box.h);
    return true;
  }

  /*
   * **倒下那一下：头像上打一个红叉**，闪三下、共约 1.2 秒（量出来的
   * 0.25 秒亮 / 0.25 秒灭）。它闪完，整块才消失（`Core.TARGET.deathBlink`）。
   */
  function drawDeathCross(ctx, enemy, target, x, y, w, h, px) {
    if (!enemy.dead) return;
    /*
     * **参考 328.5–329.0s 那个红叉是常亮的**，不是本作原来的 0.25 秒闪三下；
     * 而且它有黑描边、方头笔画（客户端那种像素叉）。这里先画粗黑叉再压红叉。
     */
    var pen = Math.max(2, 9 * px);
    var inset = pen / 2;
    ctx.lineCap = "square";
    ctx.strokeStyle = "rgba(12, 4, 6, 0.92)";
    ctx.lineWidth = pen + Math.max(2, 3 * px);
    ctx.beginPath();
    ctx.moveTo(x + inset, y + inset);
    ctx.lineTo(x + w - inset, y + h - inset);
    ctx.moveTo(x + w - inset, y + inset);
    ctx.lineTo(x + inset, y + h - inset);
    ctx.stroke();
    ctx.strokeStyle = "#e00000";
    ctx.lineWidth = pen;
    ctx.beginPath();
    ctx.moveTo(x + inset, y + inset);
    ctx.lineTo(x + w - inset, y + h - inset);
    ctx.moveTo(x + w - inset, y + inset);
    ctx.lineTo(x + inset, y + h - inset);
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  /*
   * **领主的目标条**（`docs/adr/0054`）—— 照录像重做的那一条：
   *
   *   头像 80×80 ｜ 一条 1068 长、59 高的条
   *
   * 绿色是 HP 填充，橙色 `ALERT!` 是**这条里没被填满的空槽**（不是另加的一条）；
   * 绿条见底/翻脸之后换成红色。类别牌与名字画在条内。半血竖线和「· 狂暴」
   * 录像里没有，这里也不画 —— 狂暴仍然是玩法，只是不写在条上。
   *
   * 位置：录像贴着屏幕左上角，本作左上角被玩家卡与配速行占着，所以整块挂在
   * 它们下面（`TARGET_PANEL.bossY`）；条的长度与形状照录像。
   */
  /**
   * **领主的目标框头像**：用赛丽亚选关卡片上那张 **3/4 正脸**（`assets/region.png`
   * 第 0 张卡，crop `[112,8,60,60]`），不是战斗精灵的侧身头 —— 侧脸在 40px 下
   * 只剩肩膀，和参考录像的目标框对不上（业主 2026-10-18：「领主牛头的血条头像不对」）。
   * 卡片自带的森林底用一圈暗角压掉，保留参考里那张脸。
   */
  function drawBossPortrait(ctx, sprites, x, y, size, type) {
    /*
     * **每只领主自己的脸。** 牛头巨兽走参考录像裁的那张 80×80 正脸
     * （`assets/boss_portrait.png`），它连金属框和四角红铆钉一起裁进来了；
     * 暗咒猫妖没有这张现成裁图，就从它自己的战斗精灵里裁头，走"drawn"
     * 那一路（目标框会替它画钢框和红铆钉）。
     */
    if (type === "lugaruBoss" &&
        drawMonsterFace(ctx, sprites, type, { x: x, y: y, w: size, h: size })) {
      return "drawn";
    }
    /*
     * **首选那张从参考录像里裁的 80×80 正脸**（`assets/boss_portrait.png`）——
     * 没有它时才用选关卡片的正脸 / 战斗精灵兜底。
     */
    var baked = sprites && sprites.bossPortrait;
    if (baked && baked.width) {
      ctx.drawImage(baked, x, y, size, size);
      return "baked";
    }
    var region = sprites && sprites.region;
    if (region && region.width) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, size, size);
      ctx.clip();
      ctx.drawImage(region, 112, 8, 60, 60, x, y, size, size);
      var shade = ctx.createRadialGradient(x + size * 0.5, y + size * 0.48, size * 0.18,
                                           x + size * 0.5, y + size * 0.48, size * 0.78);
      shade.addColorStop(0, "rgba(4, 9, 22, 0)");
      shade.addColorStop(1, "rgba(4, 9, 22, 0.82)");
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, size, size);
      ctx.restore();
      return "drawn";
    }
    return drawMonsterFace(ctx, sprites, "boss", { x: x, y: y, w: size, h: size })
      ? "drawn" : false;
  }

  /**
   * **领主是两条血，不是一条变色**（业主 2026-10-18）。
   *
   * Core 里仍是一条 `maxHp` 池，但二阶段在 `hp <= maxHp * phase2.hpRatio`
   * （当前 0.5）触发；所以条按两段画：
   *
   * - 一阶段（绿色）：从满血到 `maxHp * ratio`，这一段走完就空了；
   * - 二阶段（红色）：从 `maxHp * ratio` 到 0，这一段从满格开始往下走。
   *
   * 两条各占整条 1068 的长度；颜色变化就是"换到第二条血"。
   */
  function bossBarShare(enemy) {
    var ratio = enemy.phase2 && enemy.phase2.hpRatio !== undefined
      ? enemy.phase2.hpRatio : 0.5;
    var second = enemy.maxHp * ratio;
    var first = enemy.maxHp - second;
    var red = enemy.phase >= 2;
    var span = red ? second : first;
    if (!(span > 0)) return 0;
    var value = red ? enemy.hp : enemy.hp - second;
    return Math.max(0, Math.min(1, value / span));
  }

  function drawBossTargetPanel(ctx, state, sprites, enemy, info) {
    var px = HUD_PX;
    var x = HUD_LEFT + 4;
    var y = TARGET_PANEL.bossY;
    var portrait = TARGET_PANEL.bossPortrait * px;
    var barX = x + portrait;
    var barW = TARGET_PANEL.bossBar * px;
    var barH = TARGET_PANEL.bossBarH * px;
    var barY = y + (portrait - barH) / 2;
    var border = Math.max(1, 3 * px);
    /* 两条血：绿条走完（到 50%）才换红条，红条从满格再走一遍。 */
    var share = bossBarShare(enemy);
    /* 深处领主从头就是红条（`docs/adr/0063`）；牛头仍走绿→红相位。 */
    var red = enemy.barColor === "red" || enemy.phase >= 2;

    ctx.save();

    /* 头像：深底 + 牛头自己的脸 + 深灰钢框 + 四角红铆钉。 */
    ctx.fillStyle = "#0a0c14";
    ctx.fillRect(x, y, portrait, portrait);
    var portraitMode = drawBossPortrait(ctx, sprites, x, y, portrait, enemy.type);
    if (!portraitMode) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      ctx.fillRect(x, y, portrait, portrait);
    }
    if (portraitMode !== "baked") {
      ctx.strokeStyle = "#3d3d35";
      ctx.lineWidth = Math.max(1, 2 * px);
      ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2,
                     portrait - ctx.lineWidth, portrait - ctx.lineWidth);
      ctx.fillStyle = "#b23a2a";
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (corner) {
        ctx.beginPath();
        ctx.arc(x + (corner[0] ? portrait : 0), y + (corner[1] ? portrait : 0),
                Math.max(1.4, 3 * px), 0, Math.PI * 2);
        ctx.fill();
      });
    }
    drawDeathCross(ctx, enemy, state.target, x, y, portrait, portrait, px);

    /*
     * 条：黑底 + 深灰外框。空槽先画橙色 ALERT（只在绿相位、交上手之后），
     * 再把 HP 填充压上去 —— 绿条从右端退，橙色就露出来。
     */
    ctx.fillStyle = "#000000";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = "#3d3d35";
    ctx.lineWidth = Math.max(1, 2 * px);
    ctx.strokeRect(barX + ctx.lineWidth / 2, barY + ctx.lineWidth / 2,
                   barW - ctx.lineWidth, barH - ctx.lineWidth);

    var innerX = barX + border;
    var innerW = barW - border * 2;
    /*
     * **填满整条高度**（2026-10-18）：业主说 Boss 血条要粗。以前上下各留了
     * `border`，59 高的条只填 53；现在条本身加高到 70，填充从顶到底。
     */
    var innerY = barY;
    var innerH = barH;
    /* 领主倒下那一刻，条要是**黑**的：参考 328.5s 那条橙色 ALERT 已经没了。 */
    if (!red && state.bossEngaged && !enemy.dead) {
      drawAlertStrip(ctx, innerX + innerW * share, innerX + innerW, innerY, innerH);
    }

    ctx.fillStyle = red ? "#db0000" : "#8fc700";
    ctx.fillRect(innerX, innerY, innerW * share, innerH);

    /*
     * 刚失去的那一段：白块原地褪色（和杂兵那条同一个 `target.ghost`），
     * 位置就在新的 HP 右缘。
     */
    if (state.target.ghost) {
      var g = state.target.ghost;
      var t = Math.min(1, g.t / Core.TARGET.ghostFade);
      var gx = innerX + innerW * g.to;
      var gw = Math.max(0, innerW * (g.from - g.to));
      ctx.fillStyle = red ? "#993232" : "#868f45";
      ctx.fillRect(gx, innerY, gw, innerH);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.95;
      ctx.fillStyle = "#f8ece5";
      ctx.fillRect(gx, innerY, gw, innerH);
      ctx.restore();
    }

    /* 内框：绿相位偏橄榄、红相位偏暗红（录像里那条细边）。 */
    ctx.strokeStyle = red ? "rgba(169, 0, 0, 0.9)" : "rgba(117, 144, 0, 0.9)";
    ctx.lineWidth = Math.max(1, 1 * px);
    ctx.strokeRect(innerX, innerY, innerW, innerH);

    /*
     * 类别牌与名字**画在条内**：黑底橙框的「野兽」+ 白字黑描边的
     * `Lv7 领主 - 牛头巨兽`。录像里名字就压在这条上，不另起一行。
     */
    var tagW = TARGET_PANEL.tagW * px;
    var tagH = 32 * px;
    var tagX = barX + 6;
    var tagY = barY + (barH - tagH) / 2;
    var tagPad = 2 * px;
    ctx.fillStyle = "#000000";
    roundRect(ctx, tagX + tagPad, tagY + tagPad, tagW, tagH - tagPad * 2, Math.max(2, 4 * px));
    ctx.fill();
    ctx.strokeStyle = "#d88246";
    ctx.lineWidth = Math.max(1, 3 * px);
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = HUD_FONT(TARGET_PANEL.textSize * px);
    ctx.fillStyle = "#f38d4c";
    ctx.fillText(info.race, tagX + tagPad + tagW / 2, tagY + tagH / 2);

    ctx.textAlign = "left";
    ctx.lineWidth = Math.max(1, 3 * px);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    var label = "Lv" + (enemy.level || info.level) + " " + info.label;
    var labelX = tagX + tagW + 6 * px;
    ctx.strokeText(label, labelX, barY + barH / 2);
    ctx.fillStyle = "#e4edf7";
    ctx.fillText(label, labelX, barY + barH / 2);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  function drawTargetPanel(ctx, state, sprites) {
    var target = state.target;
    if (!target) return;
    var enemy = target.enemy;
    var info = Core.monsterInfo(enemy.type);
    if (!info) return;
    var px = HUD_PX;
    if (enemy.behavior === "boss") {
      drawBossTargetPanel(ctx, state, sprites, enemy, info);
      return;
    }

    var portraitW = TARGET_PANEL.portrait[0] * px;
    var portraitH = TARGET_PANEL.portrait[1] * px;
    var x = TARGET_PANEL.x;
    var y = TARGET_PANEL.y;
    var rowH = TARGET_PANEL.rowH * px;
    var textX = x + portraitW + TARGET_PANEL.gap * px;
    var nameW = TARGET_PANEL.nameW * px;
    var barLen = TARGET_PANEL.barW * px;
    var barH = TARGET_PANEL.barH * px;
    var barY = y + rowH + TARGET_PANEL.gap * px;
    var border = Math.max(1, TARGET_PANEL.barBorder * px);

    ctx.save();
    /* 头像框：描金的框 + 深底；画得出来的怪才画脸，画不出来就留一块深底。 */
    ctx.fillStyle = "#0a0c14";
    ctx.fillRect(x, y, portraitW, portraitH);
    if (!drawMonsterFace(ctx, sprites, enemy.type, { x: x, y: y, w: portraitW, h: portraitH })) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      ctx.fillRect(x, y, portraitW, portraitH);
    }
    ctx.strokeStyle = "#d4c09f";
    ctx.lineWidth = Math.max(1, 2 * px);
    ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2,
                   portraitW - ctx.lineWidth, portraitH - ctx.lineWidth);

    drawDeathCross(ctx, enemy, target, x, y, portraitW, portraitH, px);

    /* 名字行：深底、细亮边；里面一块橙框橙字的类别牌，再是白色的 `Lv{n} 名字`。 */
    ctx.fillStyle = "rgba(8, 10, 18, 0.86)";
    roundRect(ctx, textX, y, nameW, rowH, Math.max(2, 4 * px));
    ctx.fill();
    ctx.strokeStyle = "rgba(212, 192, 159, 0.55)";
    ctx.lineWidth = Math.max(1, 1.5 * px);
    ctx.stroke();

    var tagW = TARGET_PANEL.tagW * px;
    var tagPad = 2 * px;
    ctx.fillStyle = "#000000";
    roundRect(ctx, textX + tagPad, y + tagPad, tagW, rowH - tagPad * 2, Math.max(2, 4 * px));
    ctx.fill();
    ctx.strokeStyle = "#d88246";
    ctx.lineWidth = Math.max(1, 3 * px);
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    /*
     * 字号就是量出来的字高（27 录像像素 = 13.5 屏幕像素）：一个汉字的字面高差不多
     * 就是一个字号，所以这里**不再乘一个 0.7 之类的折算**。
     */
    ctx.font = HUD_FONT(TARGET_PANEL.textSize * px);
    ctx.fillStyle = "#f38d4c";
    ctx.fillText(info.race, textX + tagPad + tagW / 2, y + rowH / 2);

    ctx.textAlign = "left";
    ctx.lineWidth = Math.max(1, 3 * px);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    var label = "Lv" + (enemy.level || info.level) + " " + info.label;
    var labelX = textX + tagPad + tagW + 6 * px;
    ctx.strokeText(label, labelX, y + rowH / 2);
    ctx.fillStyle = "#e4edf7";
    ctx.fillText(label, labelX, y + rowH / 2);
    ctx.textBaseline = "alphabetic";

    /* 血条：亮边、纯黑空槽、左起饱和红；掉掉的那一段是**自己褪色的白块**。 */
    ctx.fillStyle = "#000000";
    ctx.fillRect(textX, barY, barLen, barH);
    var innerH = TARGET_PANEL.barInner * px;
    var innerY = barY + (barH - innerH) / 2;
    var share = enemy.maxHp > 0 ? Math.max(0, enemy.hp / enemy.maxHp) : 0;
    ctx.fillStyle = "#dc0000";
    ctx.fillRect(textX + border, innerY, Math.max(0, (barLen - border * 2) * share), innerH);
    /*
     * 刚失去的那一段：量出来是**白块原地褪到黑**（约 0.8 秒，经过粉 → 暗红），
     * **宽度不变、只有颜色变** —— 不是一条追着填上来的条（`Core.TARGET.ghostFade`）。
     */
    if (target.ghost) {
      var g = target.ghost;
      var t = Math.min(1, g.t / Core.TARGET.ghostFade);
      var gx = textX + border + (barLen - border * 2) * g.to;
      var gw = Math.max(0, (barLen - border * 2) * (g.from - g.to));
      ctx.fillStyle = "#860000";
      ctx.fillRect(gx, innerY, gw, innerH);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.95;
      ctx.fillStyle = "#f8ece5";
      ctx.fillRect(gx, innerY, gw, innerH);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(213, 186, 156, 0.9)";
    ctx.lineWidth = border;
    ctx.strokeRect(textX + border / 2, barY + border / 2, barLen - border, barH - border);
    ctx.restore();
  }

  /*
   * 城镇（`docs/adr/0065`）：一条约 30 身位宽、4 层的横版街。没有战斗；
   * NPC 与城门在 `meta.town` 里，画的时候按深度排序。
   */
  var TOWN = {
    width: 2520,
    groundY: 430,
    backY: 330,
    gateX: 2420,
    houses: [
      { piece: "house1", x: 120 },
      { piece: "house3", x: 520 },
      { piece: "seriaHouse", x: 900 },
      { piece: "house4", x: 1350 },
      { piece: "house2", x: 1750 },
      { piece: "house6", x: 2150 }
    ],
    props: [
      { piece: "tree1", x: 300 },
      { piece: "tree2", x: 700 },
      { piece: "pole1", x: 1050 },
      { piece: "sandbag1", x: 1250 },
      { piece: "crate1", x: 1600 },
      { piece: "tree1", x: 1900 },
      { piece: "pole2", x: 2200 },
      { piece: "wall01", x: 2350 }
    ]
  };

  function drawTownPiece(ctx, sheet, name, x, bottom, width) {
    var piece = TOWN_UI.pieces[name];
    if (!sheet || !piece) return;
    var r = piece.rect;
    var w = width || piece.size[0];
    var h = piece.size[1] * (w / piece.size[0]);
    ctx.drawImage(sheet, r[0], r[1], r[2], r[3], x, bottom - h, w, h);
  }

  /**
   * 背包 / 任务 / 装备三页（`docs/adr/0065`）。第一版是程序画的深色面板；
   * 客户端商店/任务/背包窗的原件另烘（`assets/import_dnf_gui.py`）。
   */
  function drawProgressPanel(ctx, panelName, progress, sprites) {
    var boxes = { inventory: "背包", quests: "任务", equipment: "装备" };
    var x = 334;
    var y = 64;
    var w = 291;
    var h = 410;
    ctx.save();
    ctx.fillStyle = "rgba(4, 6, 12, 0.82)";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    var guiName = panelName === "inventory" ? "inventory"
      : panelName === "quests" ? "quest" : "equipment";
    if (!drawGuiWindow(ctx, sprites, guiName, x, y, w, h)) panel(ctx, x, y, w, h, 10);
    ctx.textAlign = "left";
    ctx.fillStyle = "#f1dfb8";
    ctx.font = HUD_FONT(15);
    ctx.fillText(boxes[panelName] || "进度", x + 16, y + 28);
    ctx.fillStyle = "rgba(225, 232, 240, 0.55)";
    ctx.font = HUD_FONT(9);
    ctx.fillText("I 背包 · L 任务 · K 装备 · Esc", x + 74, y + 28);
    ctx.fillStyle = "rgba(226, 191, 114, 0.8)";
    ctx.fillRect(x + 20, y + 44, w - 40, 1);

    if (!progress) {
      ctx.fillStyle = "#e8ecef";
      ctx.font = HUD_FONT(12);
      ctx.fillText("进度未加载", x + 18, y + 60);
      ctx.restore();
      return;
    }

    var lineY = y + 60;
    var defs = (typeof window !== "undefined" && window.DNFProgress)
      ? window.DNFProgress : null;

    if (panelName === "inventory") {
      ctx.font = HUD_FONT(11);
      ctx.fillStyle = "#e8ecef";
      var ids = Object.keys(progress.items || {});
      if (!ids.length) ctx.fillText("背包是空的。", x + 18, lineY);
      ids.forEach(function (id) {
        var item = defs && defs.ITEMS[id];
        var count = progress.items[id];
        ctx.fillStyle = "#e8ecef";
        ctx.fillText((item ? item.name : id) + " × " + count, x + 18, lineY);
        ctx.fillStyle = "rgba(190, 205, 220, 0.7)";
        ctx.fillText(item && item.category === "consumable"
          ? "1 / 2 使用" : (item ? item.category : ""), x + 170, lineY);
        lineY += 22;
      });
      ctx.fillStyle = "rgba(190, 205, 220, 0.8)";
      ctx.fillText("金币：" + (progress.gold || 0), x + 18, y + h - 26);
      ctx.fillStyle = "#f1dfb8";
      ctx.fillText("E 装备第一件", x + 160, y + h - 26);
    } else if (panelName === "quests") {
      var questDefs = defs ? defs.QUESTS : {};
      Object.keys(questDefs).forEach(function (id) {
        var def = questDefs[id];
        var quest = progress.quests[id] || { state: "available", progress: 0 };
        ctx.font = HUD_FONT(11);
        ctx.fillStyle = quest.state === "turnedIn" ? "#8fa0b6" : "#f1dfb8";
        ctx.fillText(def.title, x + 18, lineY);
        ctx.font = HUD_FONT(9);
        ctx.fillStyle = "#cdd8e6";
        var label = quest.state === "available" ? "未接取"
          : quest.state === "turnedIn" ? "已交付"
            : "进行中 " + quest.progress + " / " + def.goal + (quest.done ? " · 可交付" : "");
        ctx.fillText(label, x + 18, lineY + 14);
        ctx.fillStyle = "rgba(190, 205, 220, 0.7)";
        ctx.fillText("发布：" + def.npc, x + 18, lineY + 26);
        lineY += 58;
      });
    } else {
      var slots = defs ? defs.EQUIP_SLOTS : [];
      ctx.font = HUD_FONT(10);
      slots.forEach(function (slot, index) {
        var itemId = progress.equipment[slot];
        var item = itemId && defs ? defs.ITEMS[itemId] : null;
        ctx.fillStyle = "#cdd8e6";
        ctx.fillText(slot, x + 18, lineY);
        ctx.fillStyle = item ? "#f1dfb8" : "rgba(190, 205, 220, 0.45)";
        ctx.fillText(item ? item.name : "（空）", x + 120, lineY);
        lineY += 24;
        if (index === 4) lineY += 8;
      });
    }
    ctx.restore();
  }

  function drawGuiIcon(ctx, sprites, name, x, y, size) {
    var sheet = sprites && sprites.gui;
    var block = GUI_UI[name];
    if (!sheet || !block || !block.rect) return false;
    var r = block.rect;
    ctx.drawImage(sheet, r[0], r[1], r[2], r[3], x, y, size, size);
    return true;
  }

  /**
   * 城镇里 NPC 打开的窗口（`docs/adr/0065`）：商店、仓库、铁匠、对话。
   * 底图是客户端旧式窗；内容仍是程序画的字。
   */
  function drawTownPanel(ctx, town, progress, sprites) {
    ctx.save();
    ctx.textAlign = "left";
    if (town.dialogue) {
      var dx = 171;
      var dy = 280;
      if (!drawGuiWindow(ctx, sprites, "dialog", dx, dy, 618, 165)) {
        panel(ctx, dx, dy, 618, 165, 8);
      }
      ctx.fillStyle = "#f1dfb8";
      ctx.font = HUD_FONT(15);
      ctx.fillText(town.dialogue.label, dx + 28, dy + 40);
      ctx.fillStyle = "#e8ecef";
      ctx.font = HUD_FONT(12);
      ctx.fillText(town.dialogue.line || "", dx + 28, dy + 74);
      ctx.fillStyle = "rgba(190, 205, 220, 0.7)";
      ctx.font = HUD_FONT(9);
      ctx.fillText("空格 / Esc 关闭", dx + 28, dy + 146);
      ctx.restore();
      return;
    }
    if (!town.panel) { ctx.restore(); return; }

    var x = 334;
    var y = 64;
    var w = 291;
    var h = town.panel === "shop" ? 380 : 410;
    var windowName = town.panel === "shop" ? "shop"
      : town.panel === "storage" ? "inventory" : "equipment";
    if (!drawGuiWindow(ctx, sprites, windowName, x, y, w, h)) {
      panel(ctx, x, y, w, h, 10);
    }
    ctx.fillStyle = "#f1dfb8";
    ctx.font = HUD_FONT(14);
    var title = town.panel === "shop" ? "卡妮娜的商店"
      : town.panel === "storage" ? "布兰妮的仓库" : "辛达的铁匠铺";
    ctx.fillText(title, x + 16, y + 30);
    ctx.fillStyle = "rgba(190, 205, 220, 0.75)";
    ctx.font = HUD_FONT(9);
    ctx.fillText("Esc 关闭", x + 216, y + 30);

    var lineY = y + 62;
    if (town.panel === "shop") {
      var rows = [
        ["potion0", "1  HP 药水", "30 金币"],
        ["potion1", "2  MP 药水", "30 金币"],
        ["mat0", "3  卖 1 个材料", "12 金币"]
      ];
      rows.forEach(function (row) {
        drawGuiIcon(ctx, sprites, row[0], x + 16, lineY - 14, 24);
        ctx.fillStyle = "#e8ecef";
        ctx.font = HUD_FONT(11);
        ctx.fillText(row[1], x + 48, lineY);
        ctx.fillStyle = "#f1dfb8";
        ctx.fillText(row[2], x + 178, lineY);
        lineY += 40;
      });
      ctx.fillStyle = "rgba(190, 205, 220, 0.9)";
      ctx.font = HUD_FONT(10);
      ctx.fillText("金币：" + (progress ? progress.gold : 0), x + 16, y + h - 28);
    } else if (town.panel === "storage") {
      ctx.font = HUD_FONT(10);
      var ids = progress ? Object.keys(progress.items) : [];
      if (!ids.length) {
        ctx.fillStyle = "#cdd8e6";
        ctx.fillText("背包是空的。", x + 18, lineY);
      }
      ids.forEach(function (id) {
        var item = GUI_ITEMS[id];
        ctx.fillStyle = "#e8ecef";
        ctx.fillText((item ? item.name : id) + " × " + progress.items[id], x + 18, lineY);
        lineY += 22;
      });
      ctx.fillStyle = "#f1dfb8";
      ctx.font = HUD_FONT(11);
      ctx.fillText("R  重置进度（记录保留）", x + 18, y + h - 54);
      ctx.fillStyle = "rgba(190, 205, 220, 0.9)";
      ctx.font = HUD_FONT(9);
      ctx.fillText("金币：" + (progress ? progress.gold : 0), x + 18, y + h - 28);
    } else {
      ctx.font = HUD_FONT(10);
      var gear = progress ? Object.keys(progress.items).filter(function (id) {
        var item = GUI_ITEMS[id];
        return item && item.category === "equipment" && progress.items[id] > 0;
      }) : [];
      if (!gear.length) {
        ctx.fillStyle = "#cdd8e6";
        ctx.fillText("没有可分解的装备。", x + 18, lineY);
      }
      gear.forEach(function (id) {
        drawGuiIcon(ctx, sprites, "weapon0", x + 14, lineY - 14, 24);
        ctx.fillStyle = "#e8ecef";
        ctx.fillText(GUI_ITEMS[id].name + " × " + progress.items[id], x + 46, lineY);
        lineY += 30;
      });
      ctx.fillStyle = "#f1dfb8";
      ctx.font = HUD_FONT(11);
      ctx.fillText("1  分解第一件", x + 18, y + h - 28);
    }
    if (town.panelMessage) {
      ctx.fillStyle = "rgba(255, 226, 180, 0.95)";
      ctx.font = HUD_FONT(10);
      ctx.fillText(town.panelMessage, x + 16, y + h - 8);
    }
    ctx.restore();
  }

  /*
   * The store/craft panels read the item names from the same module; this is a
   * narrow view because render.js must not reach into main.js's progress object.
   */
  var GUI_ITEMS = (typeof window !== "undefined" && window.DNFProgress)
    ? window.DNFProgress.ITEMS : {};

  function drawTownChat(ctx, sprites, state) {
    var x = 125;
    var y = 300;
    var w = 285;
    var h = 131;
    if (!drawGuiWindow(ctx, sprites, "chat", x, y, w, h)) return;
    var lines = (state && state.log ? state.log : []).slice(-4);
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = HUD_FONT(9);
    if (!lines.length) {
      ctx.fillStyle = "rgba(210, 220, 232, 0.7)";
      ctx.fillText("暂无消息", x + 12, y + 24);
    }
    lines.forEach(function (line, index) {
      ctx.fillStyle = LOG_STYLE.tones[line.tone] || LOG_STYLE.tones.white;
      ctx.fillText(line.text, x + 12, y + 24 + index * 24);
    });
    ctx.restore();
  }

  function drawTown(ctx, meta) {
    var town = meta.town;
    var sprites = meta.sprites || {};
    var sheet = sprites.town;
    var npcSheet = sprites.npc;
    var player = meta.player || {};
    ctx.save();
    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(VIEW.left, 0, VIEW.width, VIEW.height);
    ctx.clip();
    ctx.translate(VIEW.left, 0);

    var sky = ctx.createLinearGradient(0, 0, 0, TOWN.backY);
    sky.addColorStop(0, "#0b1730");
    sky.addColorStop(1, "#1d3140");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW.width, TOWN.backY);

    var camera = town.cameraX || 0;
    drawTownPiece(ctx, sheet, "far", 0, TOWN.backY, VIEW.width);
    for (var mx = -(camera % 895); mx < VIEW.width; mx += 895) {
      drawTownPiece(ctx, sheet, "mid", mx, TOWN.backY + 40);
    }
    for (var tx = -(camera % 224); tx < VIEW.width; tx += 224) {
      drawTownPiece(ctx, sheet, "tile", tx, TOWN.backY + 204);
    }
    TOWN.houses.forEach(function (house) {
      drawTownPiece(ctx, sheet, house.piece, house.x - camera, TOWN.backY + 20);
    });
    TOWN.props.forEach(function (prop) {
      drawTownPiece(ctx, sheet, prop.piece, prop.x - camera, TOWN.backY + 60);
    });

    /* Gate: the Elvengard arch, its door and its light. */
    var gateX = TOWN.gateX - camera;
    drawTownPiece(ctx, sheet, "gate", gateX, TOWN.groundY - 20);
    var gateFrame = Math.floor((town.time || 0) * 10) % 10;
    var door = TOWN_UI.runs.gateDoor;
    var light = TOWN_UI.runs.gateLight;
    if (sheet && door) {
      var dr = door.frames[gateFrame];
      ctx.drawImage(sheet, dr[0], dr[1], dr[2], dr[3],
                    gateX - 34, TOWN.groundY - 88, 183, 77);
    }
    if (sheet && light) {
      var lr = light.frames[gateFrame];
      ctx.drawImage(sheet, lr[0], lr[1], lr[2], lr[3],
                    gateX - 70, TOWN.groundY - 90, 298, 121);
    }

    /* Actors: NPCs and the player, far (large z) first. */
    var actors = (town.npcs || []).map(function (npc) {
      return { kind: "npc", npc: npc, x: npc.x, z: npc.z || 50 };
    });
    actors.push({ kind: "player", x: town.x, z: town.z || 50 });
    actors.sort(function (a, b) { return b.z - a.z; });
    actors.forEach(function (actor) {
      var sx = actor.x - camera;
      var bottom = TOWN.groundY - (actor.z || 0) * Core.DEPTH.scale;
      if (actor.kind === "player") {
        if (!sprites.slayer) return;
        ctx.save();
        ctx.translate(sx, bottom);
        /* 城镇是 800×600 的客户端比例；他在这里比副本里画大一点，免得像小孩。 */
        ctx.scale((town.facing < 0 ? -1 : 1) * 1.35, 1.35);
        ctx.drawImage(sprites.slayer, 0, 0, SPRITE.frameW, SPRITE.frameH,
                      -SPRITE.anchorX, -SPRITE.anchorY, SPRITE.frameW, SPRITE.frameH);
        ctx.restore();
        return;
      }
      var npc = actor.npc;
      var block = NPC_UI[npc.id];
      if (!npcSheet || !block) return;
      var frame = Math.floor((town.time || 0) * 6) % block.frames.length;
      var r = block.frames[frame];
      var scale = 0.9;
      var w = block.cell[0] * scale;
      var h = block.cell[1] * scale;
      ctx.drawImage(npcSheet, r[0], r[1], r[2], r[3],
                    sx - w / 2, bottom - h, w, h);
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "700 11px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(8, 10, 16, 0.9)";
      ctx.strokeText(npc.label, sx, bottom - h - 8);
      ctx.fillStyle = "#f0e6cf";
      ctx.fillText(npc.label, sx, bottom - h - 8);
      ctx.restore();
    });

    ctx.restore();

    /* Black bars and the town chrome. */
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, VIEW.left, ARENA.height);
    ctx.fillRect(VIEW.left + VIEW.width, 0, ARENA.width - VIEW.left - VIEW.width, ARENA.height);

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 20px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = "#f1dfb8";
    ctx.fillText("格兰之森 · 城镇", VIEW.left + VIEW.width / 2, 34);
    ctx.font = "600 12px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(225, 232, 240, 0.8)";
    ctx.fillText("方向键走动 · 空格交互", VIEW.left + VIEW.width / 2, 54);
    ctx.restore();

    /* The bottom bar and the two orbs keep the town in the same UI as a room. */
    drawHudFrame(ctx, sprites, HUD_UI.hudBar, 120, 456, 720, 82);
    var maxHp = player.maxHp || 1;
    var maxMp = player.maxMp || 1;
    drawOrbSprite(ctx, sprites, HUD_UI.orbRed, 146, 496, 19, 36,
                  (player.hp || maxHp) / maxHp, Math.round(player.hp || maxHp));
    drawOrbSprite(ctx, sprites, HUD_UI.orbBlue, 814, 496, 20, 36,
                  (player.mp || maxMp) / maxMp, Math.round(player.mp || maxMp));
    drawItemSlots(ctx, sprites, 205, 500, 34.6, 36, 0, meta.progress);
    if (meta.state && meta.loadout) {
      drawSkillBar(ctx, meta.state, sprites, meta.loadout, true, false);
    }

    drawTownChat(ctx, sprites, meta.state);
    if (town.panel || town.dialogue) {
      drawTownPanel(ctx, town, meta.progress, sprites);
    } else {
      var prompt = null;
      if (town.near && town.near.kind === "gate") {
        prompt = "空格：进入地区地图";
      } else if (town.near && town.near.kind === "npc") {
        prompt = "空格：与 " + town.near.npc.label + " 对话";
      }
      if (prompt) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
        var width = Math.min(VIEW.width - 40, ctx.measureText(prompt).width + 30);
        var x = VIEW.left + VIEW.width / 2 - width / 2;
        ctx.fillStyle = "rgba(8, 10, 18, 0.9)";
        roundRect(ctx, x, 390, width, 30, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(226, 191, 114, 0.8)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = "#f2e7ce";
        ctx.fillText(prompt, VIEW.left + VIEW.width / 2, 410);
        ctx.restore();
      }
    }
    if (meta.progressPanel) drawProgressPanel(ctx, meta.progressPanel, meta.progress, sprites);
  }

  /*
   * **录像 HUD**（`docs/adr/0064`）：左下红/蓝球、物品槽 1–6、任务条、
   * 右下 6+6 紧凑技能槽、左上目标条、右侧常驻评分面板。
   * 玩家卡/房间卡/节奏线/提示都撤掉；球与槽的位置先按录像比例估，
   * 客户端 HUD 原件回来后按录像px微调。
   */
  function drawHudVideo(ctx, state, sprites, meta) {
    var player = state.player;
    /*
     * 录像坐标（1440×1080，游戏画面内）：红球心 (52,993)、蓝球心 (1388,993)、
     * 底部 HUD 总带 x0..1440 / y912..1080。**物品与技能是两排不同的东西，
     * 位置别对调**（2026-10-25 逐帧量 `band-13.png` / `band-316.png`）：
     *
     *   物品槽 1–6   x170..585   y1000..1072  每格 ≈69×72
     *   中央圆盘     x600..820   y912 以上伸出     C 按钮心 ≈(720, 958)
     *   技能槽 A–H   x860..1295  y1000..1072  每格 ≈72×72
     *   任务条       x890..1210  y930..975
     *   等级卡       “Lv.6” x160..215，绿经验条 x260..390 / y969..989
     *
     * 折到本作 720×540（÷2，x 再加窗口左缘 120）就是下面这些数。
     */
    drawHudFrame(ctx, sprites, HUD_UI.hudBar, 120, 456, 720, 82);
    drawOrbSprite(ctx, sprites, HUD_UI.orbRed, 146, 496, 19, 36,
                  player.hp / player.maxHp, Math.round(player.hp));
    drawOrbSprite(ctx, sprites, HUD_UI.orbBlue, 814, 496, 20, 36,
                  player.mp / player.maxMp, Math.round(player.mp));
    drawItemSlots(ctx, sprites, 205, 500, 34.6, 36, 0, meta.progress);
    /*
     * 中央那张圆盘（C + 雪花/骰子/人像/齿轮）暂时不画：客户端这个版本的
     * `menu_icon.img` 只有一排带中文标签的方按钮（个人情报/物品栏/任务…），
     * 没有录像里那张齿边圆盘，`menu_icon.img` f1 只是青色高亮框 —— 画上去
     * 反而是一个录像里没有的青色方块。底条自带的 SP 位先留着，找到原件再补。
     */
    /*
     * 任务条在录像里压在技能排**正上方**（local 465..489）；本作 6+6 的第二排
     * 正好占那一条，所以往上让一格（local 424..448），x 仍是录像的 445..605。
     */
    drawQuestTracker(ctx, state, sprites, 565, 424, 160, 24, meta.progress);
    drawTargetPanel(ctx, state, sprites);
    drawRatingPanel(ctx, state);
    /* 等级卡：录像里 “Lv.6” 与绿经验条都在底条左侧，不是屏幕底下一条细线。 */
    var xpX = 250;
    var xpW = 65;
    var xpY = 484;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(xpX, xpY, xpW, 10);
    ctx.fillStyle = "#7ed26a";
    ctx.fillRect(xpX, xpY, xpW * clamp01(player.xp / Math.max(1, player.xpToNext)), 10);
    ctx.strokeStyle = "rgba(226, 191, 114, 0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(xpX + 0.5, xpY + 0.5, xpW - 1, 9);
    ctx.fillStyle = "#e8ecef";
    ctx.font = "700 11px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Lv." + player.level, 200, 493);
    ctx.restore();
    if (player.comboTimer > 0 && player.comboIndex > 0) {
      ctx.save();
      ctx.textAlign = "right";
      ctx.font = "800 20px 'Segoe UI', system-ui, sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(12, 14, 24, 0.85)";
      var comboLabel =
        (player.comboIndex + 1) + (player.airHitTimer > 0 ? " AIR COMBO" : " COMBO");
      ctx.strokeText(comboLabel, HUD_RIGHT - 20, 330);
      ctx.fillStyle = "#ffd66b";
      ctx.fillText(comboLabel, HUD_RIGHT - 20, 330);
      ctx.restore();
    }
  }

  function drawHudFrame(ctx, sprites, block, x, y, w, h) {
    var sheet = sprites && sprites.hud;
    if (!sheet || !block || !block.frames || !block.frames.length) return false;
    var r = block.frames[0];
    ctx.drawImage(sheet, r[0], r[1], r[2], r[3], x, y, w, h);
    return true;
  }

  function drawOrbSprite(ctx, sprites, block, cx, cy, rx, ry, share, text) {
    var sheet = sprites && sprites.hud;
    var fill = clamp01(share);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#100b0b";
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    var top = cy + ry - 2 * ry * fill;
    ctx.beginPath();
    ctx.rect(cx - rx, top, 2 * rx, 2 * ry);
    ctx.clip();
    if (sheet && block && block.frames && block.frames.length) {
      var r = block.frames[0];
      ctx.drawImage(sheet, r[0], r[1], r[2], r[3], cx - rx, cy - ry, 2 * rx, 2 * ry);
    } else {
      var grad = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
      grad.addColorStop(0, "#ff7a6b");
      grad.addColorStop(1, "#c41414");
      ctx.fillStyle = grad;
      ctx.fillRect(cx - rx, cy - ry, 2 * rx, 2 * ry);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(226, 191, 114, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.32, cy - ry * 0.38, rx * 0.30, ry * 0.12, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = "700 9px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = "#f2eadf";
    ctx.fillText(String(text), cx, cy + ry - 7);
    ctx.restore();
  }

  function drawOrb(ctx, cx, cy, rx, ry, share, dark, light, text) {
    var fill = clamp01(share);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#0b0c12";
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx - 2, ry - 3, 0, 0, Math.PI * 2);
    ctx.clip();
    var top = cy + ry - (2 * ry - 6) * fill;
    var grad = ctx.createLinearGradient(0, top, 0, cy + ry);
    grad.addColorStop(0, light);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - rx, top, 2 * rx, 2 * ry);
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(226, 191, 114, 0.85)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.32, cy - ry * 0.38, rx * 0.30, ry * 0.12, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = "700 9px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = "#f2eadf";
    ctx.fillText(String(text), cx, cy + ry - 7);
    ctx.restore();
  }

  function drawItemSlots(ctx, sprites, x, y, w, h, gap, progress) {
    var filled = [
      { id: "hpPotion", icon: "potion0" },
      { id: "mpPotion", icon: "potion1" },
      { id: "material", icon: "mat0" }
    ];
    ctx.save();
    for (var i = 0; i < 6; i += 1) {
      var sx = x + i * (w + gap);
      /*
       * **不画槽框**：客户端 `hud.img` 那条底条本身就把六个物品槽与六个技能槽
       * 的凹槽烘进去了，叠一层 `mainhud.img` f77 反而在每格里画出一颗绿宝石
       * （f77 是镶嵌槽/宝石，不是空槽）。空槽就露出底条自己的凹槽。
       */
      var entry = filled[i];
      var count = entry && progress ? (progress.items[entry.id] || 0) : 0;
      if (entry && count > 0) {
        drawGuiIcon(ctx, sprites, entry.icon, sx + 5, y + 6, w - 10);
        ctx.fillStyle = "#fff2d0";
        ctx.font = "700 9px 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(String(count), sx + w - 2, y + h - 2);
      }
      /* 录像里 1–6 是槽**底下正中**的小字，不是左上角。 */
      ctx.fillStyle = "rgba(232, 215, 168, 0.95)";
      ctx.font = "700 8px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), sx + w / 2, y + h - 1);
    }
    ctx.restore();
  }

  function drawQuestTracker(ctx, state, sprites, x, y, w, h, progress) {
    ctx.save();
    /*
     * **底图暂时自己画**：录像那条 `任务` 横条（页签 + 三颗菱形奖励图标）在
     * 这个客户端版本里找不到对应原件 —— `mission.img` f0/f3/f5 是竖着的高面板，
     * `battledungeon.img` f0 写的是「戰場列表」，`quest_tag.img` 是任务类型标签
     * （史诗/主线/重复…）。与其拿错的底板充数，先画一条同位置的深色横条：
     * 位置（x445..605、高 24）按 band-13.png 量，样式等原件找到再换。
     */
    panel(ctx, x, y, w, h, 5);
    ctx.fillStyle = "#e8d7a8";
    ctx.font = "700 11px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("任务", x + 8, y + 15);
    ctx.fillStyle = "rgba(225, 232, 240, 0.88)";
    ctx.font = "600 10px 'PingFang SC', 'Segoe UI', sans-serif";
    var name = state.stage && state.stage.name ? state.stage.name : "幽暗密林深处";
    var line = "通关" + name;
    if (progress && typeof window !== "undefined" && window.DNFProgress) {
      var defs = window.DNFProgress.QUESTS;
      var order = ["main", "cats", "breakables"];
      for (var i = 0; i < order.length; i += 1) {
        var def = defs[order[i]];
        var quest = progress.quests[order[i]];
        if (!def || !quest || quest.state !== "active") continue;
        line = def.title + " " + quest.progress + "/" + def.goal +
          (quest.done ? " · 可交付" : "");
        break;
      }
    }
    ctx.fillText(line, x + 38, y + 15);
    ctx.restore();
  }

  function drawHud(ctx, state, sprites, meta) {
    var player = state.player;
    var panelX = HUD_LEFT + 16;
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

    /* room card - left of the map window, which owns the corner */
    var roomW = 236;
    var roomRight = HUD_RIGHT - 16 - minimapWidth(state.dungeon && state.dungeon.cols) - 12;
    var roomX = roomRight - roomW;
    panel(ctx, roomX, 14, roomW, 60, 8);
    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.text;
    ctx.font = "700 15px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText(state.room ? state.room.name : "", roomX + 14, 38);
    var enemiesLeft = state.enemies.filter(function (enemy) {
      return !enemy.dead;
    }).length + (state.room && state.room.pendingWave ? state.room.pendingWave.length : 0);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = "600 12px 'PingFang SC', 'Segoe UI', sans-serif";
    /*
     * 卡片上不再写"房间 2/5"：副本图里没有"N"可说 —— 一局打几间房由他选的路线决定
     * （`docs/adr/0030`）。清完房改成指路，因为"哪扇门开了"现在是这张卡唯一还没说的
     * 那件事。
     */
    var cardLine = state.room && state.room.cleared
      ? "已清空 · 门口亮了就能走"
      : "剩余敌人 " + enemiesLeft;
    ctx.fillText(
      cardLine,
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

    /*
     * **左上角的当前目标块**，包括 Boss —— 顶部正中那条 420×34 的横条没有。
     * Boss 走自己的形态（`drawBossTargetPanel`）：80×80 头像 + 一条 1068 长的条，
     * 类别牌与名字画在条内；半血竖线与「· 狂暴」录像里没有，已经不画了
     * （`docs/adr/0054`）。狂暴仍然是玩法，只是不在条上读出来。
     */
    drawTargetPanel(ctx, state, sprites);
    /* 录像右侧那块常驻评分面板（`docs/adr/0064`）：不是结算页专属。 */
    drawRatingPanel(ctx, state);
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

  function drawSkillBar(ctx, state, sprites, loadout, compact) {
    var player = state.player;
    var slots = loadout || [];
    var keys = ["A", "S", "D", "F", "G", "H", "Q", "W", "E", "R", "T", "Y"];
    var buttons = skillBarButtons();
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
      /* 紧凑条（录像那条）不叠槽框：底条自己带凹槽，见 `drawItemSlots`。 */
      var framed = compact;
      if (!framed) {
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
      } else if (stanceUp) {
        ctx.strokeStyle = "rgba(240, 84, 96, 0.95)";
        ctx.lineWidth = 1.6;
        ctx.strokeRect(slot.x + 1, slot.y + 1, slot.w - 2, slot.h - 2);
      }

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
        /*
         * 录像的键位字母在**槽底下正中**（A S D F G H，band-skills.png），
         * 不是左上角的小黑框。
         */
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(232, 215, 168, 0.95)";
        ctx.font = "700 8px 'Segoe UI', system-ui, sans-serif";
        ctx.fillText(keys[slot.index], slot.x + slot.w / 2, slot.y + slot.h + 3);
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
  /* --------------------------------------------------------- region map */

  /*
   * The region map is the hub: 格兰之森's stages, one card each. **The cards are
   * the client's own menu art** - `assets/region.png` holds nine 168x73 cells and
   * each one already has that stage's Chinese name and a portrait of its boss
   * painted into it (`assets/import_dnf_region.py`) - so this screen draws no
   * stage name of its own, only the frame around the cards: the cursor, the lock
   * and the record line.
   */
  var REGION_CARD = {
    w: 168, h: 73, sheetCols: 5, gapX: 14, gapY: 30, cols: 4, top: 150
  };

  /** Fixed geometry, so a tap and a draw always agree on where a card is. */
  function regionCards(count) {
    var cards = [];
    for (var index = 0; index < count; index += 1) {
      var row = Math.floor(index / REGION_CARD.cols);
      var col = index % REGION_CARD.cols;
      var inRow = Math.min(count - row * REGION_CARD.cols, REGION_CARD.cols);
      var rowW = inRow * REGION_CARD.w + (inRow - 1) * REGION_CARD.gapX;
      cards.push({
        index: index,
        x: (ARENA.width - rowW) / 2 + col * (REGION_CARD.w + REGION_CARD.gapX),
        y: REGION_CARD.top + row * (REGION_CARD.h + REGION_CARD.gapY),
        w: REGION_CARD.w,
        h: REGION_CARD.h
      });
    }
    return cards;
  }

  function hitTestRegion(x, y, count) {
    var cards = regionCards(count);
    for (var index = 0; index < cards.length; index += 1) {
      var card = cards[index];
      if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) {
        return index;
      }
    }
    return null;
  }

  function drawRegionMap(ctx, meta) {
    var map = meta.region;
    var list = map.list || [];
    var sheet = meta.sprites && meta.sprites.region;
    var cards = regionCards(list.length);

    ctx.save();
    ctx.fillStyle = "rgba(4, 6, 12, 0.94)";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "700 34px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText("格兰之森", ARENA.width / 2, 72);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = "600 15px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText("打过前一个关卡，才开下一个", ARENA.width / 2, 98);

    var selected = null;
    for (var index = 0; index < cards.length; index += 1) {
      var card = cards[index];
      var stage = list[index];
      var onCursor = index === map.selected;
      if (onCursor) selected = stage;
      if (sheet && sheet.width) {
        ctx.drawImage(
          sheet,
          (stage.slot % REGION_CARD.sheetCols) * REGION_CARD.w,
          Math.floor(stage.slot / REGION_CARD.sheetCols) * REGION_CARD.h,
          REGION_CARD.w, REGION_CARD.h,
          card.x, card.y, card.w, card.h
        );
      } else {
        roundRect(ctx, card.x, card.y, card.w, card.h, 6);
        ctx.fillStyle = "rgba(20, 26, 42, 0.9)";
        ctx.fill();
      }

      var shut = !stage.open || !stage.built;
      if (shut) {
        /* A locked card is still worth reading: it dims, it does not vanish. */
        roundRect(ctx, card.x, card.y, card.w, card.h, 6);
        ctx.fillStyle = "rgba(4, 6, 12, 0.7)";
        ctx.fill();
        ctx.fillStyle = "rgba(226, 236, 255, 0.75)";
        ctx.font = "700 14px 'PingFang SC', 'Segoe UI', sans-serif";
        ctx.fillText(stage.open ? "尚未开放" : "未解锁", card.x + card.w / 2, card.y + card.h / 2 + 5);
      }

      ctx.lineWidth = onCursor ? 3 : 1;
      ctx.strokeStyle = onCursor ? PALETTE.gold : "rgba(120, 140, 190, 0.45)";
      roundRect(ctx, card.x - 1, card.y - 1, card.w + 2, card.h + 2, 7);
      ctx.stroke();

      ctx.font = "600 12px 'PingFang SC', 'Segoe UI', sans-serif";
      ctx.fillStyle = stage.cleared ? PALETTE.gold : PALETTE.textDim;
      ctx.fillText(stage.note, card.x + card.w / 2, card.y + card.h + 16);
    }

    ctx.font = "600 15px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(
      selected
        ? selected.name + (selected.open && selected.built ? "　Enter 进入" : "　还不能进")
        : "",
      ARENA.width / 2,
      ARENA.height - 54
    );
    ctx.font = "600 13px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText("← → 选关　Enter 进入　M 静音", ARENA.width / 2, ARENA.height - 28);
    ctx.restore();
  }

  /*
   * **奖励页**（`docs/adr/0055`）：录像 343.5–356s 的那一页。蓝色魔法阵、中央
   * 红木宝箱、四张牌、`请选择奖励卡牌` + 3→2→1、选中后的玩家名条与物品卡。
   *
   * 位置在参考的录像像素 / 2（`HUD_PX`）上取整：四张牌一行 `x 131..836`、
   * y 190..294；标题在 y≈92；倒计时在 y≈458。牌背用客户端的青边外框 + 宝石纹样，
   * 牌面用已经烘好的金币宝箱卡面（`rewardChest`）。
   */
  var REWARD_UI = {
    cardW: 167,
    cardH: 104,
    cardGap: 15,
    cardY: 190,
    countdownY: 458,
    hintY: 340
  };

  function drawUiFrame(ctx, sheet, block, index, x, y, w, h) {
    if (!sheet || !block || !block.frames || !block.frames.length) return false;
    var frame = block.frames[index || 0] || block.frames[0];
    ctx.drawImage(sheet, frame[0], frame[1], frame[2], frame[3], x, y, w, h);
    return true;
  }

  function rewardCardBoxes() {
    var total = REWARD_UI.cardW * 4 + REWARD_UI.cardGap * 3;
    var startX = (ARENA.width - total) / 2;
    var boxes = [];
    for (var index = 0; index < 4; index += 1) {
      boxes.push({
        index: index,
        x: startX + index * (REWARD_UI.cardW + REWARD_UI.cardGap),
        y: REWARD_UI.cardY,
        w: REWARD_UI.cardW,
        h: REWARD_UI.cardH
      });
    }
    return boxes;
  }

  function hitTestRewardCard(x, y) {
    var boxes = rewardCardBoxes();
    for (var index = 0; index < boxes.length; index += 1) {
      var box = boxes[index];
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return index;
    }
    return null;
  }

  function drawRewardCard(ctx, sheet, reward, box) {
    var back = reward.faceUp ? false : true;
    if (back) {
      drawUiFrame(ctx, sheet, UI.rewardCardFrame, 0, box.x, box.y, box.w, box.h);
      /* f42 的锚点是 (9,9)：按外框的同一个倍率放进内圈。 */
      var ix = box.x + (9 / 153) * box.w;
      var iy = box.y + (9 / 97) * box.h;
      drawUiFrame(ctx, sheet, UI.rewardCardGem, 0, ix, iy,
                  (141 / 153) * box.w, (61 / 97) * box.h);
      return;
    }
    drawUiFrame(ctx, sheet, UI.rewardChest, 0, box.x, box.y, box.w, box.h);
  }

  function drawRewardPage(ctx, reward, sprites) {
    var sheet = sprites && sprites.ui;
    ctx.save();
    ctx.fillStyle = "rgba(4, 9, 22, 0.66)";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    /* 蓝色魔法阵铺满中央：800x600 的客户端设计图按 0.9 装进画布。 */
    drawUiFrame(ctx, sheet, UI.rewardMagic, 0, 120, 0, 720, 540);
    /*
     * 客户端的深蓝面板（左边怪物列表、右边五芒星）压在上面，透明度压低一点：
     * 参考里那圈魔法阵是亮蓝的，这一件只是它的底纹。
     */
    if (UI.rewardMagicPanel) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawUiFrame(ctx, sheet, UI.rewardMagicPanel, 0, 0, 24, 960, 492);
      ctx.restore();
    }

    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(6, 10, 24, 0.9)";
    ctx.font = "800 38px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
    ctx.strokeText("奖励", ARENA.width / 2, 100);
    ctx.fillStyle = "#f0d79a";
    ctx.fillText("奖励", ARENA.width / 2, 100);

    /* 牌行只在"选牌"那一拍出现；选中之后参考把牌收走，只剩左边的领奖详情。 */
    var cardsUp = reward.phase === "cards";
    if (reward.phase === "chest" || cardsUp) {
      /*
       * 中央红木宝箱：`chest` 里 0→1→2 开盖；进了牌局就停在打开的那一帧。
       * 它画在牌后面，牌一盖上来就只露出边缘（录像里也是这样）。
       */
      var chest = UI.chestOpen;
      /* `Reward.TIMES.chest` 是 1.2 秒；这里按同一个数分三帧（render 不引那个模块）。 */
      var frame = reward.phase === "chest"
        ? Math.min(2, Math.floor((reward.t / 1.2) * 3))
        : 2;
      var cw = 172;
      var ch = 100;
      drawUiFrame(ctx, sheet, chest, frame, ARENA.width / 2 - cw / 2, 210, cw, ch);
    }

    if (cardsUp) {
      /* 牌行背后的深色横带。 */
      drawUiFrame(ctx, sheet, UI.rewardBand, 0, 114, 176,
                  REWARD_UI.cardW * 4 + REWARD_UI.cardGap * 3, 110);
      var boxes = rewardCardBoxes();
      boxes.forEach(function (box) {
        drawRewardCard(ctx, sheet, reward, box);
        if (reward.picked === box.index) {
          ctx.strokeStyle = "#ffe8a6";
          ctx.lineWidth = 3;
          ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
        }
      });
      if (reward.phase === "cards") {
        ctx.textAlign = "center";
        ctx.font = "700 20px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(6, 10, 24, 0.9)";
        ctx.strokeText("请选择奖励卡牌", ARENA.width / 2, REWARD_UI.hintY);
        ctx.fillStyle = "#f0d79a";
        ctx.fillText("请选择奖励卡牌", ARENA.width / 2, REWARD_UI.hintY);
        if (reward.faceUp) {
          /*
           * 倒计时用客户端自己的金色数字（`rewardDigit` 的帧 0–9），不是现画的字。
           * 参考里 3→2→1 就是这个字形。
           */
          var digit = UI.rewardDigit ? UI.rewardDigit.frames[reward.countdown] : null;
          if (digit) {
            var dw = 60;
            var dh = 35;
            ctx.drawImage(sheet, digit[0], digit[1], digit[2], digit[3],
                          ARENA.width / 2 - dw / 2, REWARD_UI.countdownY - dh + 10, dw, dh);
          } else {
            ctx.font = "800 42px 'Segoe UI', system-ui, sans-serif";
            ctx.strokeText(String(reward.countdown), ARENA.width / 2, REWARD_UI.countdownY);
            ctx.fillStyle = "#ffd66b";
            ctx.fillText(String(reward.countdown), ARENA.width / 2, REWARD_UI.countdownY);
          }
        }
      }
    }

    if (reward.phase === "reveal" || reward.phase === "done") {
      /*
       * 领奖详情：左边玩家名条（f60）与物品卡（复用青边卡框）。录像的奖励是
       * 「古老的法杖 ×1 + 3526 金币」；本作的物品名与金币由 `Reward` 按种子给。
       */
      /*
       * 名条（f60）左端那个黑方块是**玩家头像位**，右边整条橙底才是名字。
       * 名字要压在橙底里、和黑方块同一条水平中线；物品卡紧贴在名条箭头下面
       * （参考里两者只隔几像素，不是隔着一大块魔法阵）。
       */
      var plateX = 130;
      var plateY = 128;
      var plateW = 160;
      var plateH = 63;
      drawUiFrame(ctx, sheet, UI.rewardNamePlate, 0, plateX, plateY, plateW, plateH);
      if (sprites && sprites.rewardAvatar && sprites.rewardAvatar.width) {
        /*
         * 这张 52×60 的玩家头像直接从参考录像的名条上裁下来（`assets/
         * import_reference_portraits.py`）：参考里那张脸朝左、白发尖角，
         * 和游戏内待机头不是同一个裁法。黑方块在 f60 里的位置是
         * `(9, 8, ~28, 40)`；头像放 26×30、居中，正好填满。
         */
        ctx.imageSmoothingEnabled = false;
        /* 黑格上缘在 y=8；脸从 y=9 起，和参考一样顶到格子上沿。 */
        ctx.drawImage(sprites.rewardAvatar, plateX + 11, plateY + 9, 26, 30);
      } else if (sprites && sprites.slayer && sprites.slayer.width) {
        /* 没有参考头像时的兜底：待机头的方裁，不压扁。 */
        ctx.save();
        ctx.beginPath();
        ctx.rect(plateX + 9, plateY + 8, 30, 40);
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprites.slayer, SPRITE.anchorX - 12, 70, 44, 44,
                      plateX + 10, plateY + 11, 28, 28);
        ctx.restore();
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 15px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
      ctx.fillStyle = "#3a2412";
      /*
       * 参考里名条上是一个短昵称。"鬼剑士 SLAYER" 顶到右边框，读起来没对齐
       * （业主 2026-10-18）；这里只写"鬼剑士"，居中对齐橙底那块。
       */
      /*
       * 参考里那个名字的中心在整块名条的 ~52%（不是橙底的正中）：量的是
       * `ref_nameplate` 的 318 宽里名字中心约在 166 处。所以 center = +84；
       * 纵向在**橙底中线** +24（业主复看说 +30 还靠下，见 0055 追记四）。
       */
      ctx.fillText("鬼剑士", plateX + 84, plateY + 24);
      ctx.textBaseline = "alphabetic";

      var cardX = 130;
      var cardY = 193;
      var cardW = 167;
      var cardH = 104;
      drawUiFrame(ctx, sheet, UI.rewardCardFrame, 0, cardX, cardY, cardW, cardH);
      ctx.fillStyle = "rgba(8, 16, 30, 0.82)";
      ctx.fillRect(cardX + 8, cardY + 8, cardW - 16, cardH - 16);
      /*
       * 物品名与金币行**居中**：参考里这两行都在物品卡的中线上，不是左对齐
       * （业主 2026-10-18：「名字还是没对齐」）。金币图标放在文字左边。
       */
      ctx.textAlign = "center";
      ctx.font = "700 15px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
      ctx.fillStyle = "#f1f5f8";
      ctx.fillText(reward.item, cardX + cardW / 2, cardY + 48);
      var goldLabel = "+" + reward.gold + " 金币";
      ctx.font = "700 13px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
      var goldW = ctx.measureText(goldLabel).width;
      var goldX = cardX + cardW / 2 + 7;
      ctx.fillStyle = "#d8a83c";
      ctx.beginPath();
      ctx.arc(goldX - goldW / 2 - 5, cardY + 73, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffe9a8";
      ctx.fillText(goldLabel, goldX, cardY + 78);

      if (reward.phase === "done") {
        ctx.textAlign = "center";
        ctx.font = "600 15px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
        ctx.fillStyle = "rgba(232, 220, 190, 0.82)";
        ctx.fillText("按 F3 回到地区地图 · F4 回城镇", ARENA.width / 2, 500);
      }
    }
    ctx.restore();
  }

  function drawOverlay(ctx, state, meta, sprites) {
    /* The hub is a screen of its own: nothing else belongs behind it. */
    if (meta && meta.region && meta.region.open) {
      drawRegionMap(ctx, meta);
      return;
    }
    if (meta && meta.attract) {
      drawAttractTitle(ctx, state, meta);
      return;
    }
    if (state.defeat || state.victory) {
      /*
       * 通关后的第二页：战绩走完（`Reward` 的 `stats` 拍）就换成 `奖励` 页，
       * 翻牌与开奖都在那一页（`docs/adr/0055`）。失败页不变。
       */
      if (state.victory && meta && meta.reward && meta.reward.phase !== "stats") {
        drawRewardPage(ctx, meta.reward, sprites);
        return;
      }
      ctx.save();
      ctx.fillStyle = "rgba(6, 8, 16, 0.74)";
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
      ctx.textAlign = "center";
      ctx.font = "bold 46px 'Segoe UI', system-ui, sans-serif";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(10, 12, 22, 0.9)";
      /* Cleared means one stage, so the screen says which one (docs/adr/0026). */
      var title = state.defeat
        ? "YOU DIED"
        : ((state.stage && state.stage.name) || "DUNGEON") + " 通关";
      ctx.strokeText(title, ARENA.width / 2, ARENA.height / 2 - 10);
      ctx.fillStyle = state.defeat ? PALETTE.danger : PALETTE.gold;
      ctx.fillText(title, ARENA.width / 2, ARENA.height / 2 - 10);
      ctx.fillStyle = "rgba(230, 240, 255, 0.85)";
      ctx.font = "18px 'PingFang SC', 'Segoe UI', sans-serif";
      /*
       * **F3 在这一页上是"回地区地图"，不是"再来一次"。** 一行提示曾经两个都说错了
       * （`src/main.js` 里，结束之后 F3 走的是 `openRegion()`，只有**跑图当中**才是
       * `restart()`），而选关本来就是下一件该由他决定的事。录像结尾那个
       * `返回城镇 / 再次挑战 / 选择其他地下城` 三步里，本作对应的是**回选关那一步**。
       */
      ctx.fillText("按 F3 回到地区地图 · F4 回城镇", ARENA.width / 2, ARENA.height / 2 + 34);
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
      drawResultFrame(ctx, state, meta, sprites, !state.defeat);
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
        "按 P 继续",
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
      ctx.fillText("清空房间后门口亮起来，从那儿走去下一间；打掉牛头巨兽通关", 344, 462);
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
  /*
   * **左边那一栏事件日志**（`docs/adr/0042`）。量出来的四条：
   *
   * - **没有底板**：字直接描边压在世界画面上（录像 160 s 那帧放大看，后面就是草地）。
   * - **8 个固定槽位**，首字离游戏画面左缘 45 视频px，行距 33.7 视频px、字高 26-27。
   * - **不淡出、不滚动、没有存活时间**：8 行满了把最上面那行挤掉，其余不动。
   * - **四档颜色**（取每行最亮三分之一像素的均值）：经验/金币土黄、白名道具白、
   *   蓝名道具青、状态消息橙。
   */
  var LOG_STYLE = {
    x: (285 - 240) / 2 + 120,
    /*
     * **比录像低 44 px。** 录像的首行在 y 204 视频px（画布 102），因为它那一栏上面
     * 只有一块目标条、再没有别的东西；本作那一带是**玩家卡（14..110）与它下面那行
     * 配速字（128）**，照录像摆会压在它们身上（第一版抓帧就是这样，见
     * `tests/browser/capture-hud.mjs`）。组织是本作自己的（`docs/adr/0041` Q13 选 b），
     * 所以首行让到它们**与"当前目标"条**下面，**左右边距仍是量的那个**。
     */
    top: 70,
    row: 33.7 / 2,
    size: 26.5 / 2,
    tones: {
      gold: "#d7c5a8",
      white: "#f1f4f5",
      cyan: "#7ed2d8",
      orange: "#da612d"
    }
  };

  function drawLog(ctx, state) {
    var lines = state.log || [];
    if (!lines.length) return;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = HUD_FONT(LOG_STYLE.size);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(8, 10, 16, 0.9)";
    lines.forEach(function (line, index) {
      var y = LOG_STYLE.top + index * LOG_STYLE.row;
      ctx.strokeText(line.text, LOG_STYLE.x, y);
      ctx.fillStyle = LOG_STYLE.tones[line.tone] || LOG_STYLE.tones.white;
      ctx.fillText(line.text, LOG_STYLE.x, y);
    });
    ctx.restore();
  }

  /*
   * **右边那一栏战斗评分**（`docs/adr/0041`、`docs/adr/0042`）。四条量出来的：
   *
   * - 包围盒 x 1454..1659、y 702..831（**右缘离游戏画面右缘 20 视频px**），
   *   四行、行距 33 视频px —— 与日志同一套字号。
   * - **进副本就有**，不是打完才出现：t≈57.2 跟房间一起淡入，到 t=330 一字不差。
   * - 数字**右对齐** x≈1575、标签**右对齐** x≈1656。
   * - 全程 330 秒里只有被击数与评分动过（4 变 5 的那一帧 `SS` 掉成 `S`）；
   *   操作 85% 与技巧 57% 一个字没动。
   */
  var RATING_PANEL = {
    valueRight: (1575 - 240) / 2 + 120,
    labelRight: (1656 - 240) / 2 + 120,
    top: 702 / 2 + 4,
    row: 33 / 2,
    size: 26.5 / 2
  };

  function drawRatingPanel(ctx, state) {
    var rating = Core.ratingOf(state);
    var rows = [
      [rating.operation + "%", "操作"],
      [rating.technique + "%", "技巧"],
      [String(rating.hits), "被击数"],
      /*
       * **评分那一行是数字不是字母**：录像四行量下来是 `85% 操作 / 57% 技巧 /
       * 0 被击数 / 55 评分`（`band-13.png`），本作原来写的是 S/A/B 的档位。
       * 档位留给结算页，跑图里照录像写 `score`。
       */
      [String(rating.score), "评分"]
    ];
    ctx.save();
    ctx.textBaseline = "top";
    ctx.font = HUD_FONT(RATING_PANEL.size);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(8, 10, 16, 0.9)";
    rows.forEach(function (row, index) {
      var y = RATING_PANEL.top + index * RATING_PANEL.row;
      ctx.textAlign = "right";
      ctx.strokeText(row[0], RATING_PANEL.valueRight, y);
      ctx.strokeText(row[1], RATING_PANEL.labelRight, y);
      ctx.fillStyle = index === 3 ? "#ffd98a" : "#cdc8c3";
      ctx.fillText(row[0], RATING_PANEL.valueRight, y);
      ctx.fillStyle = "#e8ecef";
      ctx.fillText(row[1], RATING_PANEL.labelRight, y);
    });
    ctx.restore();
  }

  /*
   * **顶部那条 `ALERT!` 是"当前目标"那块条的**交战形态**（`docs/adr/0043`）。
   *
   * 它**不是"Boss 登场"**：录像里那只牛头巨兽早就跟哥布林一起在场上打，248.567
   * 那一帧变的只是这块显示 —— 而它变的时机是**玩家的攻击第一次打到它**（正好是
   * 挥砍弧线命中、冒出 `10` 的那帧）。所以它是"你跟他交上手了"的读数，本作也是
   * 这么亮的（`state.bossEngaged`）。
   *
   * 第二轮的放大图把这块条拆清楚了：左端 80x80 肖像框 → **绿血条 278 视频px**
   * → **橙底 `ALERT!` 条 789 视频px**，三样同一个高度、压在 y 97..155 那一条上，
   * **一帧里整块出现**（248.533 还没有、248.567 全在）。ALERT 字色 (255,159,32)、
   * 两行错开半格、横向重复周期 85.5 视频px、**不闪不滚**，从 248.57 挂到约 292 s。
   *
   * 本作的条比录像长（`bossBar` 534 画布px 对录像的 139），所以橙色那一段只画到
   * **世界窗口的右缘**为止 —— 录像那条 789 长的在这里会伸到窗口外面去。
   */
  var ALERT_STRIP = {
    /* 量的：字 (255,164,39)、底 (236,122,4)。对比很低 —— 录像里它靠**粗斜体**读出来。 */
    ink: "#ffa427",
    back: "#ec7a04",
    row: 24 / 2,
    period: 85.5 / 2
  };

  function drawAlertStrip(ctx, left, right, y, height) {
    if (right - left <= 0) return;
    var px = Core.VIDEO_PX * Core.CAMERA.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, y, right - left, height);
    ctx.clip();
    /* 空槽窄的时候也要是橙色的（只放不下字）：近满血时那条橙色只是一丝。 */
    ctx.fillStyle = ALERT_STRIP.back;
    ctx.fillRect(left, y, right - left, height);
    if (right - left < 40) {
      ctx.restore();
      return;
    }
    ctx.fillStyle = ALERT_STRIP.ink;
    ctx.font = "italic 700 7.8px 'PingFang SC', 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (var row = 0; row < 2; row += 1) {
      var rowY = y + (row === 0 ? height * 0.3 : height * 0.7);
      var start = left + (row === 0 ? 2 * px : 2 * px - ALERT_STRIP.period / 2);
      for (var x = start; x < right; x += ALERT_STRIP.period) {
        ctx.fillText("ALERT!", x, rowY);
      }
    }
    ctx.restore();
  }

  function drawPace(ctx, pace) {
    ctx.save();
    ctx.textAlign = "left";
    ctx.font = "600 14px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillStyle = pace.state === "behind" ? PALETTE.danger : PALETTE.gold;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(10, 12, 22, 0.85)";
    ctx.strokeText(pace.text, HUD_LEFT + 22, 128);
    ctx.fillText(pace.text, HUD_LEFT + 22, 128);
    ctx.restore();
  }

  /*
   * The run's own numbers, shared by the clear and defeat screens: seed, time,
   * level, the upgrades taken, kills, damage taken and how far the run got. Two
   * short columns keep the table clear of the skill bar underneath.
   */
  /*
   * **战绩与奖励**（`docs/adr/0045`）。录像里通关之后是两页：先 `战绩`
   * （`总分 85 / 140`，下面 `操作 60 / 技巧 40 / 被击数 -15` 三行，左边一枚金色
   * 评级徽记），再 `奖励`（一口红木金边宝箱坐在蓝色魔法阵正中、打开时迸出白青的光）。
   *
   * 本作的战绩表本来就在这一页上（种子/用时/等级/强化/击杀/承伤），所以这里补的是
   * **那枚评级徽记**与**那只箱子** —— 徽记用的是客户端 `dungeon_rank.img` 自己那
   * 几帧（白彩两套 SSS..F），不是现画的字。
   *
   * 位置是本作自己的：录像那块板在 4:3 的正中，本作这一页已经排满了，所以徽记摆
   * 在表的左边、箱子摆在右边 —— 「照录像的**内容**，不照它的**排布**」（`docs/adr/0041`
   * 那条同一句）。
   */
  var RANK_FRAME = { S: 5, A: 7, B: 9, C: 11 };

  /*
   * 战绩那一页的逐行拍点（`docs/adr/0045`）：`总分` → `操作` → `技巧` →
   * `被击数` → `评分`，每行 0.45 秒；徽记跟"评分"同拍。三秒后由 `Reward`
   * 切到 `奖励` 页（`docs/adr/0055`）。
   */
  var RESULT_BEATS = {
    rows: 0.45,
    badge: 1.8
  };

  function beatAlpha(since, at) {
    return Math.max(0, Math.min(1, (since - at) / 0.3));
  }

  function drawResultFrame(ctx, state, meta, sprites, won) {
    var since = state.finishedAt === null ? 9 : state.time - state.finishedAt;
    var rating = Core.ratingOf(state);
    var sheet = sprites && sprites.ui;
    var cx = HUD_LEFT + 105;
    var top = ARENA.height / 2 + 96;
    ctx.save();
    ctx.textAlign = "center";
    /*
     * 逐行：总分 → 操作 → 技巧 → 被击数 → 评分。被击数那一行是红的、
     * 操作与技巧是金的 —— 录像里 HUD 上的那三行是白的，结算页这三行是彩的。
     */
    var rows = [
      ["总分 " + rating.score, "#f3d79b"],
      ["操作 " + rating.operation + "%", "#f3d79b"],
      ["技巧 " + rating.technique + "%", "#f3d79b"],
      ["被击数 " + rating.hits, "#ff8080"],
      ["评分 " + rating.grade, "#f3d79b"]
    ];
    ctx.font = "700 15px 'PingFang SC', 'Segoe UI', sans-serif";
    rows.forEach(function (row, index) {
      var alpha = beatAlpha(since, index * RESULT_BEATS.rows);
      if (alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = row[1];
      ctx.fillText(row[0], cx, top + 22 * index);
    });
    ctx.globalAlpha = 1;
    /* 徽记跟"评分"那一行同时到（录像里那一行左边就是它）。 */
    var badgeAlpha = beatAlpha(since, RESULT_BEATS.badge);
    if (sheet && UI.rank && badgeAlpha > 0) {
      var frame = UI.rank.frames[RANK_FRAME[rating.grade] === undefined ? 11 : RANK_FRAME[rating.grade]];
      ctx.globalAlpha = badgeAlpha;
      /* 那一帧 169x106 是连辉光一起量的，字形只占一小块 —— 所以按 1:1 画、不缩。 */
      ctx.drawImage(sheet, frame[0], frame[1], frame[2], frame[3],
                    HUD_LEFT + 20, top + 66, frame[2], frame[3]);
      ctx.globalAlpha = 1;
    }
    /*
     * **箱子与领奖框搬去 `奖励` 页了**（`docs/adr/0055`）：这一页只留战绩，
     * 翻牌与开奖由 `drawRewardPage` 负责，不再在右上角先开一次箱子。
     */
    ctx.restore();
  }

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
     * drawn on top of the plate rather than buried under it.
     */
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

    /*
     * 布景分两拨。
     *
     * 一拨是**贴花**：长在地上的**矮**花草（`SCENE.decals`）先铺掉。它们是画在地面那
     * 一层上的，不是站在地上的东西；矮的草不遮人，谁站上去都是踩着它。
     *
     * **那一丛高草不在这一拨里**：录像里它画在他的裤腿前面，所以它跟立着的东西
     * 走同一个队（业主 2026-10-12 照录像定的，Q12 选 c）。它**挡画不挡路** ——
     * 不占身位、不进判定，只是画的时候能排在人前面。
     *
     * 另一拨**站在同一块地板上**，和人走同一个队：后墙边的树干画在他前面的哥布林
     * 之前，前边缘的桶画在他之后。木桶是其中唯一会变的一件（`docs/adr/0030`）：
     * 碎开的那 0.42 秒画它的 12 块木片，之后这一块地就空了 —— 桶这一局不再回来。
     * 碎片的位置是从桶自己的位置加偏移算的，偏移在 `SCENE.barrelBreak` 里。
     *
     * **它们先入队**：身位相同时身体压在布景上（`docs/adr/0032`）。以前布景排在
     * 怪后面，于是同一个 z 上"布景盖怪、人盖布景"—— 业主报的「怪物和石头的图层
     * 不对」就是这一处不对称。人/怪/抛射物谁盖谁另有规矩（见下面 body 那一段）。
     */
    (state.props || []).forEach(function (prop) {
      if (SCENE.decals.indexOf(prop.piece) !== -1) {
        /* 贴花按它自己在带子里的深浅缩小 —— 带子于是读起来是一块**往里退的面**。 */
        drawScenePiece(ctx, sprites, prop.piece, prop.x, floorY(prop.z),
                       prop.z / Core.bandDepth(state.band));
      }
    });
    (state.props || []).forEach(function (prop) {
      if (SCENE.decals.indexOf(prop.piece) !== -1) return;
      /* `sortZ`：只换画的前后，不换站的位置（背景石门用，见 `core.js`）。 */
      add(prop.sortZ === null || prop.sortZ === undefined ? prop.z : prop.sortZ, function () {
        if (!prop.broken) {
          drawScenePiece(ctx, sprites, prop.piece, prop.x, floorY(prop.z),
                         undefined, prop.scale);
          return;
        }
        if (prop.gone) return;
        var age = state.time - prop.brokenAt;
        if (age >= Core.BREAK_ANIM) return;
        var whole = sceneRect(prop.piece);
        if (!whole) return;
        /*
         * **碎片跟着整只桶的倍率走**（`docs/adr/0050`）：完整桶画 0.74，碎片原来
         * 按 1.0 画、还锚在未缩放的 63×78 框上，于是单块木片几乎和整只桶一样宽 ——
         * 业主 2026-10-17 报的「有的木桶图片图层不对」就是砸碎那一下。`chip[1]/[2]`
         * 是相对桶原始 ink 左上角的偏移，所以整组一起乘同一个倍率。
         */
        var scale = Core.propScale(prop.piece);
        var wholeW = whole[2] * scale[0];
        var wholeH = whole[3] * scale[1];
        var left = prop.x - wholeW / 2;
        var top = floorY(prop.z) - wholeH;
        var breakTable = breakTableFor(prop.piece);
        var shown = Math.floor((age / Core.BREAK_ANIM) * breakTable.length);
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age / Core.BREAK_ANIM);
        breakTable.forEach(function (chip, index) {
          /* 一块一块飞出来，不是一下子全出现。 */
          if (index > shown) return;
          drawScenePieceBox(
            ctx, sprites, chip[0],
            left + chip[1] * scale[0],
            top + chip[2] * scale[1],
            scale[0], scale[1]
          );
        });
        ctx.restore();
      });
    });
    (state.pickups || []).forEach(function (drop) {
      add(drop.z, function () {
        drawDrop(ctx, state, drop, sprites);
      });
    });

    /*
     * **身体压在布景上**：怪和抛射物排在这一队的后半段 —— 同一个身位上，站着的东西
     * 盖过地上的布景（`docs/adr/0032`）。人本来就是最后入队的，这里只是把怪和他对齐；
     * 以前布景排在怪后面，同一个 z 上是"布景盖怪、人盖布景"，业主报的「怪物和石头的
     * 图层不对」就是这处不对称。
     */
    state.enemies.forEach(function (enemy) {
      add(enemy.z, function () {
        drawEnemy(ctx, state, enemy, sprites);
      });
    });
    (state.projectiles || []).forEach(function (shot) {
      add(shot.z, function () {
        drawProjectile(ctx, state, shot);
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
    /*
     * **关卡名插在这一队里，站在他那一档上**（`docs/adr/0044`）。录像里它被
     * **人**挡在前面，所以它不能画在整趟世界之后（那样会盖住人），也不能画在
     * scenery 之前（那样会被草丛吃掉 —— 第一版就是这么整块消失的，抓帧见
     * `tests/browser/capture-hud.mjs`）。跟人同一个 z、排在人前面，这一条天然成立，
     * 而且再没有别的假设。
     */
    add(playerZ, function () {
      drawStageTitle(ctx, state, sprites);
    });
    add(playerZ, function () {
      drawFootMark(ctx, state, sprites);
      drawPlayer(ctx, state, sprites);
    });
    add(playerZ - 0.01, function () {
      drawPlayerName(ctx, state);
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

  /**
   * **地上的雨点**（`docs/adr/0057`）：画在世界那一层、贴着房间的地面带，
   * 在布景和身体之前 —— 所以它们落在地上，不盖人。
   *
   * 14 个槽位各自按 `state.time` 轮转，每 1.2 秒一次、每次 0.35 秒放完
   * `raindrop.img` 的 7 帧。位置由房间 seed 定死，雨不会每帧乱跳。
   */
  function drawRainSplashes(ctx, state, sprites) {
    var sheet = sprites && sprites.weather;
    if (!sheet || !sheet.width || !state.room) return;
    var left = state.room.leftWall;
    var right = state.room.rightWall;
    var depth = Core.bandDepth(state.band);
    var seed = (state.seed || 1) + (state.cell + 1) * 7919 + 31;
    for (var i = 0; i < WEATHER.splashSlots; i += 1) {
      var phase = scatter(seed, i * 5 + 1) * WEATHER.splashPeriod;
      var age = (state.time + phase) % WEATHER.splashPeriod;
      if (age >= WEATHER.splashLife) continue;
      var x = left + scatter(seed, i * 5 + 2) * (right - left);
      var z = scatter(seed, i * 5 + 3) * depth;
      var frame = Math.min(
        WEATHER.raindrop.length - 1,
        Math.floor((age / WEATHER.splashLife) * WEATHER.raindrop.length)
      );
      var rect = WEATHER.raindrop[frame];
      var scale = 0.9;
      var w = rect[2] * scale;
      var h = rect[3] * scale;
      ctx.save();
      ctx.globalAlpha = 0.38 * (1 - age / WEATHER.splashLife);
      ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3],
                    x - w / 2, floorY(z) - h, w, h);
      ctx.restore();
    }
  }

  /**
   * **屏幕空间的雨层**（`docs/adr/0057`）：细、略斜（顶部偏右）、低不透明度；
   * 画在背景之后、人和布景之前（不在人身上盖白线），不随镜头滚动。
   *
   * 两层：远层小 / 暗 / 慢，近层大一点 / 亮一点 / 快。位置由 seed + 序号定死，
   * 但用 `state.time` 推着落，所以静帧也能抓、整段演示可复现。
   */
  function drawRain(ctx, state, sprites, meta) {
    var sheet = sprites && sprites.weather;
    if (!sheet || !sheet.width || !state.room || state.intro) return;
    /* 幽暗密林深处按 `00002` 不下雨（`docs/adr/0063`）。 */
    if (state.stage && state.stage.rain === false) return;
    if (state.victory || state.defeat) return;
    if (meta && (meta.paused || meta.showHelp || (meta.region && meta.region.open))) return;
    var left = Core.VIEW.left;
    var width = Core.VIEW.width;
    var height = Core.ARENA.height;
    var seed = (state.seed || 1) + (state.cell + 1) * 7919;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, 0, width, height);
    ctx.clip();
    WEATHER.layers.forEach(function (layer, layerIndex) {
      ctx.save();
      ctx.globalAlpha = layer.alpha;
      for (var i = 0; i < layer.count; i += 1) {
        var h1 = scatter(seed + layerIndex * 997, i * 11 + 1);
        var h2 = scatter(seed + layerIndex * 997, i * 11 + 2);
        var h3 = scatter(seed + layerIndex * 997, i * 11 + 3);
        var scale = layer.scale * (0.8 + h3 * 0.45);
        var rect = WEATHER.rain[(i + layerIndex) % WEATHER.rain.length];
        var w = rect[2] * scale;
        var h = rect[3] * scale;
        var span = height + h;
        /* 风往左吹（负值）：先做正模，别让雨丝从窗口左边消失。 */
        var drift = h1 * width + state.time * layer.wind;
        var x = left + (((drift % width) + width) % width);
        var y = ((state.time * layer.speed + h2 * span) % span) - h;
        ctx.save();
        ctx.translate(x, y + h / 2);
        ctx.rotate(WEATHER.angle);
        ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3],
                      -w / 2, -h / 2, w, h);
        ctx.restore();
      }
      ctx.restore();
    });
    ctx.restore();
  }

  /**
   * 启动加载屏：**只画字和条，不碰任何素材图。**
   *
   * 它存在的理由就是"别让玩家看见后备画法"（业主 2026-10-17：「开始时加载的
   * 角色和怪物是像素和老的怪物」）。所以这里一个 `drawImage` 都没有 ——
   * 图还没到齐的时候，画面上不该出现任何"老素材"的痕迹。
   */
  function renderLoading(ctx, info) {
    var ratio = info && info.total ? Math.min(1, info.loaded / info.total) : 0;
    var cx = ARENA.width / 2;
    var cy = ARENA.height * 0.42;

    ctx.clearRect(0, 0, ARENA.width, ARENA.height);
    ctx.fillStyle = "#05070b";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    /* 一层很淡的森林绿，让黑屏不像"卡住了"。 */
    var glow = ctx.createRadialGradient(cx, cy, 20, cx, cy, 340);
    glow.addColorStop(0, "rgba(58, 92, 46, 0.38)");
    glow.addColorStop(1, "rgba(5, 7, 11, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.gold;
    ctx.font = "800 52px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText("NANO DNF", cx, cy - 18);

    ctx.fillStyle = "rgba(232, 220, 190, 0.72)";
    ctx.font = "600 15px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText("鬼剑士 · 地下城试炼", cx, cy + 10);

    var barW = 300;
    var barH = 10;
    var barX = cx - barW / 2;
    var barY = cy + 58;
    ctx.fillStyle = "#10161e";
    roundRect(ctx, barX, barY, barW, barH, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 191, 114, 0.45)";
    ctx.lineWidth = 1;
    roundRect(ctx, barX + 0.5, barY + 0.5, barW - 1, barH - 1, 5);
    ctx.stroke();
    if (ratio > 0) {
      ctx.fillStyle = PALETTE.goldDim;
      roundRect(ctx, barX + 2, barY + 2, Math.max(2, (barW - 4) * ratio), barH - 4, 3);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(232, 220, 190, 0.62)";
    ctx.font = "600 12px 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.fillText("正在加载 " + Math.round(ratio * 100) + "%", cx, barY + 30);
    ctx.restore();
  }

  function render(ctx, state, meta) {
    meta = meta || {};
    var sprites = meta.sprites || null;
    /*
     * 深处用**调过色的 set 02**（`assets/grade_deep_forest.py`）：录像的
     * 饱和度/对比度比客户端原图高一档；只换这一关的森林图，别的关不动。
     */
    if (state.stage && state.stage.id === "mirkwooddeep" &&
        sprites && sprites.forestDeep) {
      sprites = Object.assign({}, sprites, { forest: sprites.forestDeep });
    }
    /*
     * A full-screen overlay owns the frame. The sim is frozen behind it, so the
     * room banner would otherwise sit half-faded under the title forever; hold
     * it back and let it announce the room once play actually starts.
     */
    var overlayOpen = !!(
      meta.paused || meta.showHelp || state.victory || state.defeat ||
      (meta.region && meta.region.open)
    );
    ctx.clearRect(0, 0, ARENA.width, ARENA.height);
    /*
     * 左右那两条黑边（`docs/adr/0040`）。录像的游戏画面是**居中的 4:3**（1440×1080
     * 装在 1920×1080 里），两边纯黑；本作照它把**世界**收进中间 720×540，剩下的画布
     * 归 HUD 与触屏。明着填一次黑，而不是指望画布底下那层 CSS —— 抓帧、分享图与
     * "世界有没有画进黑边"这种东西都要它一定是黑的。全屏界面（标题/暂停/通关/地区
     * 地图）画在它**上面**，所以那些仍是满屏 16:9。
     */
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, Core.VIEW.left, ARENA.height);
    ctx.fillRect(
      Core.VIEW.left + Core.VIEW.width, 0,
      ARENA.width - Core.VIEW.left - Core.VIEW.width, ARENA.height
    );

    var shake = 0;
    state.effects.forEach(function (effect) {
      if (effect.kind === "shockwave") shake = Math.max(shake, effect.life / effect.maxLife);
    });

    ctx.save();
    /*
     * 世界只画在**世界窗口**里。这一刀（`clip`）是"收成 4:3"的真正一半：不收，
     * 世界会铺满整块画布，拉近之后黑边里会露出本该在窗口外的树干与地面。
     * 它压在 `shake` **之前** —— 镜头晃的是世界，窗口不动。
     */
    ctx.beginPath();
    ctx.rect(Core.VIEW.left, 0, Core.VIEW.width, Core.VIEW.height);
    ctx.clip();
    /* 窗口自己那一段横向偏移：世界从窗口左缘开始画，而不是从画布左缘。 */
    ctx.translate(Core.VIEW.left, 0);
    /*
     * **进副本那一串**（`docs/adr/0044`）：过场插画占满整个窗口，其余什么都不画 ——
     * 录像里那 2 秒是过场与加载，没有世界、没有 HUD，两边只有纯黑。
     */
    if (state.intro) {
      drawIntroArt(ctx, state, sprites);
      ctx.restore();
      return;
    }
    if (shake > 0) {
      ctx.translate(Math.sin(state.time * 90) * 2.4 * shake, Math.cos(state.time * 77) * 1.6 * shake);
    }
    /*
     * **世界那一趟的全部变换，就在这三行里**（`docs/adr/0035`）。
     *
     *   屏幕 = (世界 − 镜头) × zoom，纵向以**地面线**为轴
     *
     * 写在一次、写在这一个地方，而不是在几十个绘制函数里各乘各的：下面这一整趟 ——
     * 背景、门、布景、人、怪、地上的火、飘出来的伤害数字 —— 全都在同一层，一次变换
     * 全解决。屏幕那一层（HUD、地图窗口、暗角、过场那层黑幕）在 `ctx.restore()` 之后，
     * 一动不动。
     *
     * **纵向以地面线为轴**：0 和 430 原地不动，其余按 zoom 伸缩。地面线于是永远落在
     * 技能栏上沿那一条（430，栏从 444 起），和他站的地方一起不动 —— 拉近的是世界，
     * 不是"脚底那一行"。
     *
     * `zoom` 是量出来的（录像里他一屏高 4.0755 个身位），推法见 `Core.CAMERA`。
     */
    ctx.translate(0, ARENA.groundY);
    ctx.scale(Core.CAMERA.zoom, Core.CAMERA.zoom);
    ctx.translate(0, -ARENA.groundY);
    ctx.translate(-cameraX(state), 0);
    drawBackdrop(ctx, state, sprites);
    drawGate(ctx, state, sprites);
    /*
     * **雨丝画在背景之后、人和布景之前**（`docs/adr/0057` 追记）。参考里雨是天气层，
     * 但我们的近层如果盖在人身上，跑动时会读成"人物在闪"（业主 2026-10-19 实玩）。
     * 放在这一层：背景与缺口里仍看得到斜雨，人和怪保持干净。
     *
     * 雨是屏幕空间的，所以临时把变换切成屏幕坐标；画完再回到世界变换。
     */
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawRain(ctx, state, sprites, meta);
    ctx.restore();
    /* 雨点落在地上：画在地面之后、人和布景之前（`docs/adr/0057`）。 */
    drawRainSplashes(ctx, state, sprites);
    /*
     * Everything in the room - bodies, the Slayer, the art he casts and the
     * ground he leaves burning - in one pass, ordered by depth. See drawWorld.
     */
    drawWorld(ctx, state, sprites);
    var bannerOrdinal = 0;
    var hideTelegraph = !!(state.stage && state.stage.id === "mirkwooddeep");
    state.effects.forEach(function (effect) {
      if (effect.kind === "banner" && overlayOpen) return;
      /* 录像里没有 AIM/扑击/横扫的预警圈；深处的预警只留在核心，不画。 */
      if (hideTelegraph && effect.kind === "telegraph") return;
      drawEffect(
        ctx,
        state,
        effect,
        effect.kind === "banner" ? bannerOrdinal++ : 0,
        sprites
      );
    });
    ctx.restore();

    /*
     * **录像比这套渲染亮一档。** 同机位量 9 间路线房，游戏画面中央的平均亮度
     * 录像 50–77、本作 45–56（`docs/adr/0064` 同机位对照）。客户端美术是同一套，
     * 差的是整体调色；用一层很淡的暖白压在世界窗口上，HUD 与黑边不跟着动。
     * 不用 `ctx.filter`：全屏 filter 在云机器上把帧率拖垮，deep 冒烟因此假红。
     *
     * **深处换一层冷色**（2026-10-26）：那层暖白把地面的红通道抬了 20
     * （草地均值 (50,72,72) 对录像的 (23,62,68)），整片草偏灰、偏亮。
     * 深处改用淡青蓝，红不再被抬、绿蓝补一点 —— 同机位草地上量到
     * ≈(26,59,66)，与录像那一格对得上。别的关照旧用暖白。
     */
    var deepStage = state.stage && state.stage.id === "mirkwooddeep";
    ctx.save();
    ctx.beginPath();
    ctx.rect(VIEW.left, 0, VIEW.width, VIEW.height);
    ctx.clip();
    ctx.fillStyle = deepStage ? "rgba(10, 90, 130, 0.10)" : "rgba(255, 248, 230, 0.08)";
    ctx.fillRect(VIEW.left, 0, VIEW.width, VIEW.height);
    ctx.restore();

    drawVignette(ctx, state);
    /*
     * 魔狱血刹's 觉醒插画 goes over the room and under the HUD: the reference
     * paints its own bar over the picture, and so does this one - the illustration
     * takes the corner the bar does not.
     */
    drawAwakening(ctx, state, sprites);
    drawHudVideo(ctx, state, sprites, meta);
    /* 录像左侧掉落/经验消息流；评分面板已在 `drawHudVideo` 里常驻。 */
    if (!overlayOpen) drawLog(ctx, state);
    /* The map belongs to live play and to the title demo, not to a full-screen overlay. */
    if (!overlayOpen) drawMinimap(ctx, state, sprites, meta);
    drawSkillBar(ctx, state, sprites, meta.loadout, true);
    if (meta.loadoutOpen) drawLoadoutPanel(ctx, state, sprites, meta);
    if (meta.progressPanel) drawProgressPanel(ctx, meta.progressPanel, meta.progress, sprites);
    drawOverlay(ctx, state, meta, sprites);
    /*
     * 换房那一下，**最后画、盖住所有东西**（连 HUD 一起）：录像里切过去是旧画面
     * 直接消失、黑的立刻盖满一帧，然后新房间在 0.3 秒里淡进来（`docs/adr/0030`）。
     * 所以这是一层黑幕在减淡，不是"淡出再淡入"。
     *
     * **但全屏界面开着的时候不画**：这层黑跟着 `state.transition` 走，而那个数只在
     * `Core.step` 里减 —— 标题页和地区地图不步进，所以它一直停在 0.3（= 全黑）。
     * 一开始就把地区地图整个盖住了（业主：「点击任意键，直接黑屏了」）。
     * **标题上那段自动演示是例外**（`meta.attract`）：它是自己步进的，换房该有那一下黑。
     */
    if ((!overlayOpen || meta.attract) && state.transition > 0 && Core.TRANSITION) {
      ctx.save();
      ctx.globalAlpha = clamp01(state.transition / Core.TRANSITION.dur);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
      ctx.restore();
    }
  }

  return {
    render: render,
    drawTown: drawTown,
    TOWN: TOWN,
    /* The start-up screen the shell shows until every sheet is decoded. */
    renderLoading: renderLoading,
    PALETTE: PALETTE,
    SPRITE: SPRITE,
    EFFECT: EFFECT,
    /* The room's art table, so tests can pin every prop name to a rect. */
    SCENE: SCENE,
    /* The map window's table and its box, so tests can pin both. */
    MINIMAP: MINIMAP,
    /* The current-target panel's measured numbers (the boss bar is one 1068-long bar). */
    TARGET_PANEL: TARGET_PANEL,
    /* The boss's two bars: green for the first half of the pool, red for the second. */
    bossBarShare: bossBarShare,
    UI: UI,
    minimapBox: minimapBox,
    hitTestMinimap: hitTestMinimap,
    /* 魔狱血刹's two live-drawn numbers, so tests can pin them to the sheets. */
    BLOOD_SWORD: SWORD,
    BLOOD_SWORD_FORM: SWORD_FORM,
    CUT_IN: CUT_IN,
    attackColumn: attackColumn,
    playerFrame: playerFrame,
    flareFlash: flareFlash,
    skillEffectFrame: skillEffectFrame,
    skillBarButtons: skillBarButtons,
    SLOT_COUNT: SLOT_COUNT,
    loadoutPanelButtons: loadoutPanelButtons,
    hitTestLoadout: hitTestLoadout,
    hitTestRewardCard: hitTestRewardCard,
    REWARD_UI: REWARD_UI,
    hitTestRegion: hitTestRegion
  };
});
