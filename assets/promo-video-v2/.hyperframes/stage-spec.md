# STAGE SPEC (binding)

1920×1080, 54.92 s. All coordinates are canvas pixels. `tg` is global time in
seconds. Music: 125 BPM. Beat = 0.48 s, bar = 1.92 s, the grid starts at 0.053 s.
Every scene starts on a bar line.

## Architecture: one chrome layer, then stage frames on top

- **`compositions/chrome.html`** (id `chrome`) runs for the whole 0 → 54.92 s at z-index 1.
  It owns everything persistent: the ground, the window, the header (tabs + Record button),
  the stage background, the whole timeline strip (ruler, lanes, scene bars, ambient marks,
  playhead, connectors), the break's range selection on the strip, the outro zoom-out
  and cause rails, and the window collapse.
- **`compositions/frames/NN-*.html`** (ids `sNN-name`, e.g. `s05-sheet-drop`) are one per scene, at z-index 2. They draw
  ONLY stage content, in the stage rect, on a transparent background. They never draw chrome.
  Frame 14 may also draw the full-canvas lockup once the window has collapsed.

Since the chrome is a single composition, cuts between frames cannot shift it. A frame only
has to be empty, or match its neighbour's stated handoff, at its edges.

## Look (from the live panel, `capture/ref/`)

- Square corners everywhere in panel UI (radius 0). Only round things: status dots and rail nodes.
- Ink: panel bg `#030303`; bars/toolbars `#0d0d0d`; borders `#363636`; chip fill `#292929`;
  text `#e3e3e3`; muted `#919191` / `#a1a1a1`; dim lines `#1f1f1f`.
- Accent `#4d63ff`, underline `#324fff`, link `#8a9bff`, amber `#f4bf4f`, red text `#ff6b6b`,
  selected row bg `rgb(24,29,61)` with a 2px `#4d63ff` left bar, range overlay `rgba(36,48,140,0.32)`.
- Video-only accent (not in the panel): playhead / emphasis cyan `#00e8ff`.
- Code colours: string `#c3e88d`, number `#f78c6c`, keyword `#c792ea`, tag `#82aaff`, punctuation `#89ddff`, comment `#616161`.
- Layer colours: Lit Lifecycle `#4d63ff`, Lit Render `#325cff`, Lit Render (verbose) `#99aeff`,
  Changed values `#6b7bff`, Mouse `#a451af`, Keyboard `#8151af`, Custom events `#af7a51`,
  Lit warnings `#f4bf4f`, Router `#ff6b35`.
- Anatomy colours: `#4d63ff #e8590c #2f9e44 #c2255c #1098ad #9c36b5 #f08c00 #5c940d`, host box dashed `#919191`.
- Cause-rail chain colours, in order: teal `#20c997`, orange `#fd7e14`, pink `#e64980`, blue `#4dabf7`, green `#51cf66`, yellow `#fcc419`.
- Fonts (local only, `@font-face` from `assets/`): Manrope 800/700/600/500/400
  (`manrope-extrabold|bold|semibold|medium|regular.woff2`) for UI and headlines; Roboto Mono 400
  (`RobotoMono-Latin-400.woff2`) for tags, rows, values, code, ruler.
- Panel UI inside the video is drawn at **1.6×** the real panel: 13 px UI → 21 px, 12 px mono → 20 px,
  22 px tree rows → 35 px, 23 px list rows → 36 px.

## Chrome geometry

- **Ground** (full canvas): `#030308` plus radial `rgba(42,44,157,0.35)` centred (960, 380), radius 1000.
- **Window**: x 40 → 1880, y 28 → 1052 (1840 × 1024). Fill `#030303`, radius 12, `overflow:hidden`,
  shadow `0 30px 80px rgba(0,0,0,.6), 0 0 0 1px #363636`.
- **Header**: y 28 → 100 (72 px), fill `#0d0d0d`, 1px `#363636` bottom.
  - Flame `assets/flame.svg`, 30 px tall at x 68, centred on y 64. Then "LIT DEVTOOLS" at x 108,
    Manrope 800 19 px, letter-spacing .08em, `#e3e3e3`.
  - Tabs, Manrope 600 21 px, each a 18 px line icon + 10 px gap + label, with 22 px padding each side.
    The tab boxes start at x 290 and sit next to each other: Components, Updates, Timeline, Settings.
    Inactive `#a1a1a1`. Active: label + icon `#4d63ff`, 3 px `#324fff` underline across the tab box at y 97 → 100.
    A tab switch slides the underline to the new box (0.25 s, power3.out) while the colours cross-fade.
  - Record button: right edge x 1856, 44 px tall, centred on y 64, square. **Record** = fill `#0d0d0d`,
    1px `#363636`, "● Record" Manrope 600 19 px `#e3e3e3`. **Stop** = fill `#3a0d14`, 1px `#8a1f2b`,
    "■ Stop" `#ff6b6b`. Stop from tg 1.60 to tg 52.20. Record otherwise.
- **Stage**: x 40 → 1880, y 100 → 664, fill `#030303`. Frames place content in:
  - left column (eyebrow + headline): x 96 → 700
  - right column (demo): x 740 → 1840, y 124 → 640
- **Timeline strip**: y 664 → 1052.
  - Ruler y 664 → 700, fill `#0d0d0d`, 1px `#363636` top and bottom. A tick (1px `#363636`, y 690 → 700) every
    0.5 s of timeline time. Label every 1 s: `N000ms` (e.g. `27000ms`), Roboto Mono 15 px `#919191`,
    left edge 6 px after its tick, vertically centred y 670 → 690.
  - 5 lanes, 70 px each, y 700 → 1050 (lane i top = 700 + 70 i), 1px `#1f1f1f` line at each lane bottom.
  - Gutter x 40 → 280, fill `#030303`, 1px `#363636` right edge. Each lane label: 12 px square swatch in the lane colour
    at x 64, then text at x 86, Roboto Mono 19 px `#c8c8c8`, vertically centred.
    While a lane's bar is active: label `#ffffff`, swatch glows `0 0 10px` in the lane colour.
  - Lanes: 0 `HMR` `#4d63ff` · 1 `Components` `#6b7bff` · 2 `Timeline` `#99aeff` · 3 `Source` `#af7a51` · 4 `Agents` `#a451af`.
  - Track area x 280 → 1880, clipped.

## Time model (the strip pans; the playhead stands still)

- Timeline time shown at the playhead, `D(tg)`:
  - `D = tg` for tg ≤ 26.93
  - `D = 26.93` for 26.93 < tg < 30.77 (the break: the pan holds)
  - `D = tg − 3.84` for tg ≥ 30.77 (until the outro zoom at 49.97)
- An item at timeline time `t` is drawn at **x = 760 + 100·(t − D)** (100 px per second). Pan is linear
  (`ease: "none"`) in every segment.
- **Playhead**: fixed at x 760. 2px `#00e8ff` line, y 664 → 1050, glow `0 0 12px rgba(0,232,255,.6)`,
  14 px downward triangle cap in the ruler at y 666. Visible from tg 1.60 (fades in 0.2 s) to tg 52.20.
- **Ambient marks** (recorded events): for lane i and n = 0, 1, 2, … with `t = 0.053 + 0.48·n`, draw a mark when
  `(7n + 3i) mod 5 == 0` **and** t ≤ D (recorded only once the playhead has passed it). A mark is 2 px wide and 22 px tall,
  centred in its lane, in the lane colour at 75 % opacity. It appears as the playhead crosses it.
  Marks hidden under a scene bar don't matter.
- **Scene bars**: 30 px tall, square, centred in the lane. Label inside: Roboto Mono 15 px, 8 px left padding, clipped.
  Times are timeline time:

  | bar | t0 → t1 | lane | label |
  |---|---|---|---|
  | B2 | 3.99 → 9.55 | 0 HMR | `hmr update` |
  | B3 | 9.75 → 13.39 | 1 Components | `inspect` |
  | B4 | 13.59 → 19.15 | 0 HMR | `?css-sheet` |
  | B6 | 19.35 → 22.99 | 1 Components | `every instance` |
  | B7 | 23.19 → 26.83 | 1 Components | `anatomy` |
  | B9 | 27.03 → 30.67 | 2 Timeline | `cause` |
  | B10 | 30.87 → 34.51 | 2 Timeline | `task chain` |
  | B11 | 34.71 → 38.35 | 3 Source | `open in editor` |
  | B12 | 38.55 → 42.19 | 4 Agents | `lit_range-summary` |
  | B13 | 42.39 → 46.03 | 1 Components | `lit inspector` |

  States: **future** (t0 > D): 1.5px outline in the lane colour, transparent, 55 % opacity, label in the lane colour.
  **Active** (t0 ≤ D ≤ t1): fill in the lane colour, glow `0 0 18px` in the lane colour, label `#ffffff`.
  **Past** (D > t1): fill in the lane colour at 55 %, label `#e3e3e3` at 70 %. Bars are drawn (outlines draw in
  left to right) during the cold open, tg 1.0 → 1.6, and are all present after that.
- **Connector**: when a bar goes active, a 2px line in the lane colour grows from the bar top up to y 664 at x 760 over 0.2 s.
  It stays while the bar is active and fades over 0.15 s at t1.

## Header tab per scene (switch at the scene's start)

| scene | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tab | Timeline | Components | Components | Components | Components | Components | Components | Timeline | Timeline | Timeline | Components | Timeline | Timeline | Timeline |

## Scene windows (global, frame `data-start` / `data-duration`)

| # | id | start | dur |
|---|---|---|---|
| 1 | s01-record | 0 | 3.89 |
| 2 | s02-hmr | 3.89 | 5.76 |
| 3 | s03-inspect | 9.65 | 3.84 |
| 4 | s04-sheet-setup | 13.49 | 1.92 |
| 5 | s05-sheet-drop | 15.41 | 3.84 |
| 6 | s06-instances | 19.25 | 3.84 |
| 7 | s07-anatomy | 23.09 | 3.84 |
| 8 | s08-range | 26.93 | 3.84 |
| 9 | s09-cause | 30.77 | 3.84 |
| 10 | s10-task | 34.61 | 3.84 |
| 11 | s11-source | 38.45 | 3.84 |
| 12 | s12-agents | 42.29 | 3.84 |
| 13 | s13-inspector | 46.13 | 3.84 |
| 14 | s14-lockup | 49.97 | 4.95 |

Beats inside a scene, in local time: 0, .48, .96, 1.44 | 1.92, 2.40, 2.88, 3.36 | 3.84 … Put hits on these.
Unless a handoff says otherwise, stage content is gone by local `dur − 0.15`. It snaps shut with scaleY → 0 toward y 664
plus fade (0.18 s, power3.in), and the next frame opens on an empty stage.

## Stage typography

- Eyebrow: Manrope 700 18 px, letter-spacing .14em, uppercase, in the scene's lane colour, at (96, 150).
- Headline: Manrope 800 68 px, letter-spacing −0.03em, line-height 1.04, `#ffffff`, top 186, max 3 lines,
  each line its own block. The emphasised word or number is `#00e8ff`. Lines slam in (y 24 → 0, opacity, 0.3 s, power3.out) on beats.
- Panel fragments in the right column copy the real panel at 1.6×: square, outer 1px `#363636`, bg `#030303`,
  toolbar strips `#0d0d0d` 66 px tall. Never invent a panel feature that isn't in `capture/ref/PANEL-REFERENCE.md`.
- Page mock (the user's app): cards `#17171c`, 1px `#2c2c33`, radius 8, Manrope 600, buttons radius 6.

## Outro (chrome; scene 14 window)

- tg 49.97 → 50.97 (power3.inOut): the strip zooms out. Every item tweens from the pan mapping to
  **x = 290 + 34·t** (t 0 → 46.5 fits the track area). Bar widths scale to match, and bar labels fade out
  in the first 0.2 s. The ruler relabels to every 5 s (`5000ms` …). Marks keep their 2 px width.
  The playhead slides to x(46.13) = 1858 and holds.
- tg 50.97 → 52.05: cause rails link the bars in order (B2→B3→B4→B6→B7→B9→B10→B11→B12→B13). Each link is
  an SVG path from the end of one bar to the start of the next: right 6 px, then vertical to the target lane, then right.
  Stroke 2 px `#00e8ff`, with a 6 px dot at each bar end. Links draw one after another (stroke-dashoffset), ~0.1 s each, on beats.
- tg 52.20: the Record button flips back to "● Record" and the playhead fades out (0.2 s).
- tg 52.40 → 53.10 (power3.in): the whole window scales 1 → 0.92 toward its centre and fades to 0. The ground stays.
- tg 54.40 → 54.92: the ground fades to black (`#000`).
