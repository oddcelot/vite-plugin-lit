## Video direction

The whole piece lives inside ONE persistent stage: a dark Lit DevTools window showing its
Timeline tab. The stage chrome is IDENTICAL in every frame (frames 02–06 draw it fully built;
01 builds it in; 07 tears it down), so hard cuts between frames are invisible and only the bloom
stage content changes. A cyan playhead sweeps left→right at constant speed across the full 20s.
Each capability is one blue event bar on its own track; when the playhead reaches a bar it glows
and "blooms" into a demo in the stage area above the ruler, then snaps shut as the playhead leaves.
Silent (music may be added later): time big hits on a 0.5s grid (120 bpm) — every frame start is
on the grid. Rhythm: 01 fast build · 02 longest (the thesis) · 03 big motion · 04 dense-but-calm ·
05/06 quick punches · 07 held lockup.

### STAGE SPEC — binding for every frame (1920×1080, px, global time `tg` in seconds)

Global time: `tg = frame_start + local_t`. Frame starts: 01=0.0 · 02=2.0 · 03=6.0 · 04=9.5 · 05=12.5 · 06=14.5 · 07=17.0.

- Ground: full-bleed `canvas` #030308 + a radial indigo (#2a2c9d @ 35%) glow centered (960, 360), radius ~900.
- **Window**: x 64 → 1856, y 48 → 1032 (1792×984), fill `surface` #121212, radius 14, shadow.window.
- **Header**: y 48 → 104 (56px), fill #1c1c1c, bottom hairline #363636. At x 96: flame.svg 28px tall, then "LIT DEVTOOLS" Manrope 800 18px tracking 0.12em #e3e3e3. Tabs starting x 330, 40px apart: "Components" "Updates" "Timeline" "Settings" Manrope 600 17px #a1a1a1; "Timeline" is #4d63ff with a 2px #4d63ff underline at y 102. Record pill right-aligned ending x 1824, 34px tall, centered y 76: while recording (tg 1.0 → 17.4) = transparent fill, 1px #ff6b6b border, "■ Stop" #ff6b6b Manrope 700 15px; otherwise "▶ Record" #e3e3e3 on #292929.
- **Bloom stage**: y 104 → 620, x 64 → 1856, fill #0a0a10. Demo content lives here. Left column (headline) x 144 → 820; right column (demo) x 880 → 1776. Keep 40px clear of the ruler.
- **Ruler**: y 620 → 660, fill #1c1c1c, hairlines top/bottom #363636. Ticks every 1s of `tg`; label every 2s as "`N`000ms" (e.g. "4000ms") Roboto Mono 15px #616161, left-aligned 6px after the tick. Tick x = playhead x formula.
- **Tracks**: 5 rows, 72px each, y 660 → 1020 (row i top = 660 + 72·i). Label gutter x 64 → 344 on #121212 with right hairline; label = 10px dot #4d63ff at x 96 + text at x 118, Roboto Mono 20px #a1a1a1, vertically centered. Row hairlines #363636 at each row bottom.
  - row 0 "HMR" · row 1 "CSS Sheet" · row 2 "Inspector" · row 3 "Source" · row 4 "MCP"
- **Playhead x**: `x(tg) = 360 + 72·tg` (tg 0 → 360, tg 20 → 1800). 2px #00e8ff line from y 620 to y 1020 with glow-cyan; a 14px downward cyan triangle cap sitting in the ruler at y 622. The playhead moves LINEARLY (ease "none") at 72 px/s in every frame — never eased, never paused (except frame 07, which specifies its stop).
- **Event bars** (height 28, radius 6, vertically centered in their row), x from `x(t0)` to `x(t1)`:
  - HMR row 0: tg 2.2 → 5.8 · CSS Sheet row 1: 6.2 → 9.3 · Inspector row 2: 9.7 → 12.3 · Source row 3: 12.7 → 14.3 · MCP row 4: 14.7 → 16.8
  - Bar states: **future** (playhead left of t0) = 1.5px #324fff outline, transparent fill, 55% opacity · **active** (playhead inside) = fill #4d63ff + glow shadow, and the part left of the playhead fills brighter (#6478ff) as the playhead advances · **past** = fill #324fff at 70%, no glow.
  - A bar appears (draws in) only in frame 01; frames 02–06 show all five bars from their first frame, in their correct state at `tg`.
  - Row label of the active track brightens to #ffffff and its dot turns #00e8ff while active.
- **Bloom**: at each active bar's t0, a 2px #4d63ff vertical connector grows from the bar up to the stage (y 620) in 0.2s, then the stage content enters. Stage content is gone (snapped shut: scaleY → 0 toward y 620 over 0.2s, power3.in) by the frame's last 0.15s. Next frame opens on an empty stage.
- Type in the stage: headline Manrope 800, 76px, -0.03em, #ffffff, max 3 short lines; the single emphasized word/number in #00e8ff. Eyebrow above headline: Manrope 700 18px tracking 0.14em uppercase #4d63ff (e.g. "HMR"). Code: Roboto Mono 26px with code-* syntax colors.
- Fonts: `assets/manrope-extrabold.woff2` (800), `assets/manrope-bold.woff2` (700), `assets/manrope-semibold.woff2` (600), `assets/manrope-medium.woff2` (500), `assets/RobotoMono-Latin-400.woff2`. Local @font-face only.

