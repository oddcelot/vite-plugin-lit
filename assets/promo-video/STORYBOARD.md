---
format: 1920x1080
duration: 20s
message: "Lit HMR that keeps your state — plus the DevTools to see it"
arc: Record → HMR keeps state → shared CSS sheets → inspector → source overlay → agents (MCP) → lockup
audience: Lit / web-components developers using Vite
mode: autonomous
music: none
---

# vite-plugin-lit — "The video is a timeline"

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

## Frame 01 — Record

- scene: An empty DevTools Timeline assembles; "▶ Record" flips to "■ Stop"; five tracks and their event bars draw in; the cyan playhead starts moving.
- duration: 2s
- poster: 1.6s
- transition_in: cut
- status: animated
- src: compositions/frames/01-record.html
- asset_candidates: capture/assets/flame.svg
- blueprint: compose
- focal: capture/assets/flame.svg
- roles: flame.svg = supporting (header mark)
- motion_rules: anchored-layout-expand, waterfall-entry, svg-path-draw
- handoff_out: STAGE SPEC fully built at tg 2.0 — window/header/ruler/5 tracks/5 future-state bars at exact spec positions, opacity 1, scale 1; Record pill in "■ Stop" state; playhead at x 504 moving right 72 px/s; bloom stage empty.

Scene 1 (0.0–0.5s): Ground + indigo glow present. The window expands from a centered 40%-size rounded rect to the exact spec rect (power3.out); header text and tabs waterfall in left→right; "Timeline" tab underline slides in.
Scene 2 (0.5–1.0s): In the bloom stage, centered, a big "▶ Record" pill (Manrope 700, 44px, on #292929) — at 0.9s it presses (scale 0.94 → 1) and becomes "■ Stop" in #ff6b6b, while the header pill also flips to "■ Stop" at tg 1.0.
Scene 3 (1.0–1.6s): Big pill fades up/out. Ruler and 5 track rows waterfall in top→bottom (0.06s stagger); labels type-on; event bar outlines draw left→right (svg-path-draw feel), future state.
Scene 4 (1.0–2.0s): Playhead fades in at tg 1.0 at x(1.0)=432 and moves linearly (it must be at x 504 at local 2.0). Small eyebrow in the stage upper-left at (144, 190): "@oddsquad/vite-plugin-lit" Roboto Mono 22px #a1a1a1 — fades out by 1.85s.

## Frame 02 — HMR keeps state ("Still 42.")

- scene: Playhead hits the HMR bar. The stage blooms into a live counter reading "Count: 42" beside its source; the template edit is typed and saved; the heading changes but the count stays 42.
- duration: 4s
- poster: 3.2s
- transition_in: cut
- status: animated
- src: compositions/frames/02-hmr.html
- asset_candidates: capture/assets/flame.svg
- blueprint: compose
- focal: the counter card (rebuilt UI)
- roles: none (pure UI reconstruction)
- motion_rules: kinetic-beat-slam, physics-press-reaction, ambient-glow-bloom, discrete-text-sequence
- handoff_in: STAGE SPEC fully built at tg 2.0, playhead x 504 moving right 72 px/s, all bars future, stage empty.
- handoff_out: STAGE SPEC at tg 6.0 — playhead x 792; HMR bar past; CSS Sheet bar future (its t0 6.2 not yet reached); stage empty.

Scene 1 (0.0–0.4s): Playhead approaching HMR bar (t0 = tg 2.2 → local 0.2). At local 0.2 the bar goes active; connector grows to the stage. Eyebrow "HMR" appears at left column top (x 144, y 200).
Scene 2 (0.4–1.4s): Right column: a component card (#16161f, 1px #363636, radius 10, ~820×200) at top y 150: title "Counter" Manrope 800 44px #fff, below it a pill button "Count: 42" (Manrope 700 30px, #4d63ff border, cyan number) + "renders: 1" Roboto Mono 20px #a1a1a1. Under it, a code card (~820×210, y 380): `render() {` / `  return html\`<h2>Counter</h2>` / `    <button>Count: ${this.count}</button>\`;` / `}` with syntax colors. Card springs in (spring-pop, subtle). Left headline line 1 slams in at local 0.9: "Edit."
Scene 3 (1.4–2.4s): Caret in the code; the h2 text is re-typed: "Counter" → "Counter: edited live" (discrete char sequence, ~0.6s). Left headline line 2 slams in at local 2.0: "Save."
Scene 4 (2.4–3.3s): At local 2.4 a save flash: code card border pulses #4d63ff, a tiny "hmr update" chip (Roboto Mono 16px, cyan dot) pops above the code card; the component card flashes an outline glow (flash-on-update) and its title swaps to "Counter: edited live". The button stays exactly "Count: 42" — a cyan ring pulses around the 42 once. "renders: 1" → "renders: 2". Left headline line 3 at local 2.8: "Still **42.**" (42. in cyan).
Scene 5 (3.3–4.0s): Hold the read, still. At local 3.6 bar ends (t1 5.8); stage snaps shut by 3.85s.

## Frame 03 — One sheet, every shadow root

- scene: One `?css-sheet` import; a field of 1,000 tiny shadow-root tiles all re-color at once as the stylesheet hot-swaps — no re-render.
- duration: 3.5s
- poster: 2.4s
- transition_in: cut
- status: animated
- src: compositions/frames/03-css-sheet.html
- asset_candidates: none (pure UI reconstruction)
- blueprint: compose
- focal: the tile field
- roles: none
- motion_rules: center-outward-expansion, theme-crossfade-morph, counting-dynamic-scale
- handoff_in: STAGE SPEC at tg 6.0 — playhead x 792 moving right 72 px/s; HMR bar past; others future; stage empty.
- handoff_out: STAGE SPEC at tg 9.5 — playhead x 1044; HMR + CSS Sheet bars past; Inspector future; stage empty.

Scene 1 (0.0–0.5s): At local 0.2 (tg 6.2) CSS Sheet bar goes active, connector grows. Eyebrow "CSS SHEET" at (144, 200). Left: a small code card (Roboto Mono 24px) at y 250: `import sheet from` / `  './theme.css?css-sheet';`.
Scene 2 (0.5–1.3s): Right column (x 880→1776, y 140→580): a grid of tiny rounded tiles (each ~18×18, 6px gap → 40 cols × 20 rows ≈ 800 visible; label says 1,000) expands center-outward, all tiles tinted #324fff at 60%. A counter under the grid counts up "0 → 1,000 shadow roots" Roboto Mono 20px #a1a1a1 (number in #fff). Headline lines 1–2 at local 0.9: "One sheet." / "1,000 roots."
Scene 3 (1.3–2.6s): At local 1.5 the code card's `theme.css` flashes (save); a single wave is NOT used — every tile re-colors in the same instant (that is the point: one adopted sheet) from blue to cyan (#00e8ff) with a quick glow bloom, and their corner radius morphs 4px → 9px. A chip "0 re-renders" (Roboto Mono 18px, #34e0a1 dot) pops beside the counter. Headline line 3 at local 1.8: "**Hot-swapped.**" (cyan).
Scene 4 (2.6–3.5s): Hold. Stage snaps shut by 3.35s.

## Frame 04 — See every update

- scene: The Components tab's tree and state inspector, beside a stream of Lit lifecycle events — the live component inspector and layered timeline.
- duration: 3s
- poster: 2.2s
- transition_in: cut
- status: animated
- src: compositions/frames/04-inspector.html
- asset_candidates: none (pure UI reconstruction)
- blueprint: compose
- focal: the inspector panel
- roles: none
- motion_rules: waterfall-entry, dynamic-content-sequencing, control-target-sync
- handoff_in: STAGE SPEC at tg 9.5 — playhead x 1044; HMR + CSS Sheet past; stage empty.
- handoff_out: STAGE SPEC at tg 12.5 — playhead x 1260; first three bars past; Source future; stage empty.

Scene 1 (0.0–0.5s): At local 0.2 (tg 9.7) Inspector bar active, connector grows. Eyebrow "INSPECTOR" at (144, 200). Headline lines at local 0.4 / 0.9: "See every" / "**update.**" (cyan).
Scene 2 (0.5–1.6s): Right column: an inner panel (#121218, 1px #363636, radius 10) split 45/55. Left pane: component tree in Roboto Mono 22px #82aaff tags, waterfall in: `<hmr-counter>`, `<hmr-lifecycle>`, `▸ <hmr-parent>`, `<hmr-signal-counter>`, `<hmr-ctx-provider>`, `<hmr-virtualizer>`. At local 1.2 `<hmr-counter>` row gets a #4d63ff 16% selection highlight.
Scene 3 (1.6–2.6s): Right pane fills: "hmr-counter" header, state rows `@state count` → `42` (cyan), `renders` → `2`, `@property label` → `"edited live"` (code-string). Below, 3 lifecycle events stream in one by one (0.15s apart): `willUpdate` · `update` · `updated` Roboto Mono 18px with blue dots and ms stamps (`+0.4ms`, `+1.1ms`, `+1.3ms`).
Scene 4 (2.6–3.0s): Hold; snap shut by 2.85s.

## Frame 05 — Click to source

- scene: A click on an element in the page opens its exact source line in the editor.
- duration: 2s
- poster: 1.4s
- transition_in: cut
- status: animated
- src: compositions/frames/05-source.html
- asset_candidates: none (pure UI reconstruction)
- blueprint: compose
- focal: the element + editor jump
- roles: none
- motion_rules: cursor-click-ripple, card-morph-anchor
- handoff_in: STAGE SPEC at tg 12.5 — playhead x 1260; three bars past; stage empty.
- handoff_out: STAGE SPEC at tg 14.5 — playhead x 1404; four bars past; MCP future; stage empty.

Scene 1 (0.0–0.4s): At local 0.2 (tg 12.7) Source bar active, connector. Eyebrow "SOURCE OVERLAY" at (144, 200); headline at local 0.3: "Click." / "**Jump to code.**" (second line cyan).
Scene 2 (0.4–1.0s): Right column: the "Count: 42" button (same styling as frame 02) at (1000, 220); a source-overlay outline (1.5px dashed #00e8ff + tag label chip `<hmr-counter>` above it) appears on hover at 0.5; a stylized arrow cursor (drawn SVG, white) clicks at 0.8 with a ripple.
Scene 3 (1.0–1.7s): From the button, a small editor card morphs out to (900→1760, 330→560): tab "hmr-counter.ts:12", three code lines with line numbers 11–13, line 12 highlighted #4d63ff 16%, caret blinking on it.
Scene 4 (1.7–2.0s): Hold; snap shut by 1.85s.

## Frame 06 — Ask your agent

- scene: A coding agent calls the plugin's MCP tools and reads the live component tree instead of guessing from source.
- duration: 2.5s
- poster: 1.9s
- transition_in: cut
- status: animated
- src: compositions/frames/06-mcp.html
- asset_candidates: none (pure UI reconstruction)
- blueprint: compose
- focal: the agent terminal
- roles: none
- motion_rules: discrete-text-sequence, waterfall-entry
- handoff_in: STAGE SPEC at tg 14.5 — playhead x 1404; four bars past; stage empty.
- handoff_out: STAGE SPEC at tg 17.0 — playhead x 1584; all five bars past; stage empty; Record pill still "■ Stop".

Scene 1 (0.0–0.4s): At local 0.2 (tg 14.7) MCP bar active, connector. Eyebrow "MCP" at (144, 200). Headline at 0.3 / 0.8: "Your agent" / "**sees it too.**" (cyan).
Scene 2 (0.4–1.4s): Right column: a terminal card (#07070c, radius 10, 1px #363636, header dots in #363636). Line 1 types: `› lit_list-components` (cyan prompt char, #e3e3e3 text). Line 2 appears at 1.0 dim: `  ⎿ 24 components · live`.
Scene 3 (1.4–2.2s): Result tree waterfalls in (Roboto Mono 20px): `<hmr-counter>  count: 42`, `<hmr-parent>   ▸ 1 child`, `<hmr-virtualizer>  1,000 items`. Then `› lit_recent-events` types in at 1.9.
Scene 4 (2.2–2.5s): Hold; snap shut by 2.35s.

## Frame 07 — Lockup

- scene: Recording stops; the timeline collapses into the Lit flame and the plugin name with the one-line setup.
- duration: 3s
- poster: 2.5s
- transition_in: cut
- status: animated
- src: compositions/frames/07-lockup.html
- asset_candidates: capture/assets/flame.svg
- blueprint: compose
- focal: capture/assets/flame.svg
- roles: flame.svg = cutout (hero mark)
- motion_rules: ambient-glow-bloom, scale-swap-transition, spring-pop-entrance
- handoff_in: STAGE SPEC at tg 17.0 — playhead x 1584 moving right 72 px/s; all five bars past; stage empty; "■ Stop".

Scene 1 (0.0–0.4s): Playhead keeps moving linearly until local 0.4 (tg 17.4, x 1612.8), then the header pill flips to "▶ Record" and the playhead stops dead.
Scene 2 (0.4–1.0s): Tracks, ruler and window collapse: rows fold up toward the center (0.04s stagger), window shrinks to a centered 120px rounded square and fades while the flame.svg (240px tall) scales up from that point at center (960, 420) with an indigo→blue glow bloom behind it.
Scene 3 (1.0–1.8s): Under the flame: "vite-plugin-lit" Manrope 800 96px #fff (with "lit" in #4d63ff) at y ~640; below it a code chip (#0b0b12, radius 10, Roboto Mono 30px): `plugins: [litPlugin()]` with syntax colors, at y ~760.
Scene 4 (1.8–3.0s): Below: `npm i -D @oddsquad/vite-plugin-lit` Roboto Mono 24px #a1a1a1 at y ~850 fades up. Hold still to the end (last 0.3s: everything holds, no exit).
