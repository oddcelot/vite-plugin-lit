---
format: 1920x1080
duration: 54.92s
message: "Lit HMR that keeps your state, and DevTools that explain every update"
audience: Lit / web-components developers using Vite
mode: autonomous
music: user-supplied, assets/bgm/bounce-energique.m4a ("Bounce Énergique", 125 BPM)
---

# vite-plugin-lit v2: "The video is a timeline"

## Video direction

The panel is the canvas. One persistent chrome composition draws the dark Lit DevTools window:
the header with real tabs, and below the stage the Timeline strip, whose ruler and lanes pan right to left
past a fixed cyan playhead. Each scene is a bar on a lane, and the stage above shows the demo while
the playhead crosses that bar. The binding geometry, colours and time model are in
**`.hyperframes/stage-spec.md`**. Every worker reads it first.

Energy follows the song. The intro (0–15.4) is calm reading. **Drop A (15.41)** carries the big
visuals: the 1,000-root recolour, the instance outlines and the Anatomy overlay. The **break (26.93)** freezes
the pan for a calm range select. **Drop B (30.77)** carries the cause rails and the task chain, then
jump to source. The **dip (42.29)** is the agent terminal. The outro zooms the whole recording out and links
every bar with cause rails, then lands on the lockup.

Hits land on beats (0.48 s grid in local time). Hard cuts only.

## Chrome — persistent (compositions/chrome.html, 0 → 54.92)

- Cold open: ground present from 0. The window grows from a centred 40 % rounded rect to the spec rect at
  tg 0.05 → 0.60 (power3.out). The header flame and title fade in at 0.35, and the tabs waterfall left to right
  from 0.40 (0.06 stagger), with Timeline active. The Record button appears at 0.6. The ruler draws in at 0.6 → 0.9.
  Lanes waterfall top to bottom from 0.7 (0.08 stagger), and labels type on. Bar outlines draw left to right
  over 1.0 → 1.6. At 1.60 Record flips to Stop and the playhead fades in. The strip pans from tg 0 by the spec formula
  (at tg < 1.6 the ruler is already in place, so the pan is visible from 0.6).
- Through the film: tabs per the spec table, Record/Stop, the pan with D(tg), bar states, connectors, ambient marks.
- **Break (tg 26.93 → 30.77)**: the pan holds (D = 26.93). At 27.20 an arrow cursor (white, 24 px, drawn SVG) fades in at
  (330, 860). A "⇧" key cap (Roboto Mono 16 px on `#292929`, 1px `#363636`, 28 px square) sits next to it.
  From 27.44 to 28.32 (power2.inOut) it drags right to (740, 860). A range overlay, `rgba(36,48,140,0.32)` with 1px `#4d63ff`
  left and right edges, grows over the track area (y 664 → 1050) from x 330 to the cursor. Small mono labels on the ruler
  at the edges: `22630ms` and, live while dragging, the end time (final `26730ms`). The cursor fades at 28.6.
  The overlay holds, then fades out at 30.45 → 30.70.
- Outro per spec (zoom-out, rails, Record off, window collapse, fade to black).

## Frame 01 — Cold open (0 → 3.89)

- tab Timeline · lane none · eyebrow none
- 0.60 → 1.20: centred in the stage, a big "● Record" button (Manrope 700 44 px, `#0d0d0d`, 1px `#363636`, square, 96 px tall,
  56 px side padding) springs in.
- 1.44: it presses (scale 0.94 → 1) and turns into "■ Stop" (`#3a0d14` fill, `#8a1f2b` border, `#ff6b6b` text, red glow).
  This matches the header flip at 1.60.
- 1.92: the big button lifts and fades (0.25 s). The left column eyebrow, Roboto Mono 22 px `#a1a1a1` instead of the usual style,
  reads `@oddsquad/vite-plugin-lit` and appears at 1.92. Headline line 1 at 2.16: "Your Lit app,". Line 2 at 2.64: "on the **record.**"
- Right column, 2.40 → 3.40: a quiet stat stack, Roboto Mono 22 px, each line on a beat:
  `Lit 3 · Vite 6–8`, `HMR that keeps state`, `DevTools in the dev server`.
- Snap shut by 3.74.

## Frame 02 — HMR keeps state (3.89 → 9.65, 5.76 s)

- tab Components · lane 0 HMR `#4d63ff` · eyebrow "HMR"
- 0.10: eyebrow. 0.24: right column, a page-mock component card (x 760 → 1820, y 130 → 330) springs in subtly.
  It has title "Counter" Manrope 800 44 px, a button "Count: **42**" (Manrope 700 30 px, `#4d63ff` 1.5px border, radius 6,
  number cyan) and `renders: 1` Roboto Mono 20 px `#a1a1a1`. Under it (y 360 → 600) a code card (`#0a0a0f`, 1px `#363636`, radius 8,
  tab strip "hmr-counter.ts") holds 4 lines, Roboto Mono 24 px, syntax coloured:
  `render() {` / `  return html\`<h2>Counter</h2>` / `    <button>Count: ${this.count}</button>\`;` / `}`
- 0.96: headline line 1 "Edit." · 1.20 → 2.10: a caret retypes `Counter` → `Counter: edited live` char by char.
- 2.40: headline line 2 "Save." · 2.88: SAVE HIT. The code card border pulses `#4d63ff`. A chip pops above the code card:
  `hmr update · 0.8ms` (Roboto Mono 16 px, cyan dot). The component card gets the panel's Flash, a 2px `#4d63ff`
  outline that flashes and fades over 0.6 s. The title swaps to "Counter: edited live". The button stays "Count: 42", and a cyan ring
  pulses around 42 once. `renders: 1` → `renders: 2`.
- 3.36: headline line 3 "Still **42.**"
- 3.84: a toast slides in at the component card's top-right corner: "✓ HMR landed · hmr-counter.ts", Manrope 600 18 px,
  `#0d0d0d`, 1px `#2f9e44`, green check. Hold to 5.4.
- Snap shut by 5.61.

## Frame 03 — Inspect every value (9.65 → 13.49)

- tab Components · lane 1 `#6b7bff` · eyebrow "COMPONENTS"
- 0.10: headline line 1 "Inspect". 0.48: line 2 "**every** value."
- Right column: a Components panel fragment (x 740 → 1840, y 124 → 640). Its toolbar strip holds Pick, a
  "Filter tags" input, and Live/Flash/Anatomy on the right (Live and Flash active, dark-blue fill `#1a2366`, text `#8a9bff`).
  Below, the tree (left 44 %, tree rows 35 px, Roboto Mono 20 px, `<tag>` with grey angle brackets) and the details pane
  (right 56 %, 1px `#363636` left border).
- 0.00 → 0.30: the fragment appears with 10 tree rows (`<hmr-counter>`, `<hmr-lifecycle>`, `<hmr-parent>`, `<hmr-properties>`,
  `<hmr-static-props>`, `<hmr-signal-counter>`, `<hmr-ctx-provider>`, `<hmr-task>`, `<hmr-slots>`, `<hmr-property-options>`).
- 0.48 → 0.90: "prop" types into Filter tags. The tree narrows to `<hmr-properties>`, `<hmr-static-props>` and `<hmr-property-options>`,
  with the match highlighted.
- 0.96: `<hmr-properties>` is selected (selected row style). The details pane fills: `<hmr-properties>` in bold;
  `defined src/hmr-properties.ts:10`, `rendered index.html:173` (links `#8a9bff`); `root shadow, open`; a "Filter rows" box;
  section PROPERTIES 2 with `label "initial"` + a `label` chip and `factor 2`; STATE 2 with `items Array(2) ▸ ["item1", "item2"]`;
  INSTANCE 1 with `renders 3`.
- 1.92: the `items` caret opens. Its children `0 "item1"` and `1 "item2"` unfold, indented.
- 2.40: CHANGED-VALUE HIT. `factor 2 → 4` and `renders 3 → 4`. Each changed row's background flashes `rgba(77,99,255,.35)` and fades over 0.8 s.
- 2.88: property option badges pop on the `factor` row: `hasChanged` and `attribute: false` (chips `#292929`, Roboto Mono 15 px).
- Snap shut by 3.69.

## Frame 04 — `?css-sheet` setup (13.49 → 15.41, 1.92 s), riser into the drop

- tab Components · lane 0 `#4d63ff` · eyebrow "CSS SHEET"
- 0.00 → 0.60: left column under the eyebrow, at y 200, a code card types
  `import sheet from` / `  './theme.css?css-sheet';` (Roboto Mono 26 px).
- 0.48: below the code card at y 340, headline line 1 "One sheet."
- Right column: the TILE GRID. 40 cols × 20 rows of 20×20 tiles with a 7 px gap, top-left at (760, 140), so the grid spans
  x 760 → 1833, y 140 → 673. **Clip the grid to y ≤ 610**: it shows 18 full rows, with the 19th fading out in a bottom mask.
  Tiles are radius 4, `#324fff` at 60 %. They fill centre-outward 0.20 → 1.20. A counter at (760, 616), Roboto Mono 20 px
  `#a1a1a1`, counts `0 → 1,000 shadow roots` (number `#fff`).
- 1.44 → 1.92: riser. The tiles pulse scale 1 → 0.9 → 1 on 1.44, 1.68 and 1.80 (accelerating), and the grid brightens slightly.
- NO snap shut. handoff_out at 1.92: the code card, "One sheet." and the full grid (blue, 60 %, radius 4, scale 1)
  and counter reading `1,000 shadow roots` are exactly in place.

## Frame 05 — DROP: one sheet, 1,000 roots (15.41 → 19.25)

- tab Components · lane 0 · eyebrow "CSS SHEET"
- handoff_in: frame 04's end state exactly, at local 0.
- 0.00 DROP HIT: every tile recolours in the same instant, `#324fff` → white flash (0.06 s) → `#00e8ff`, radius 4 → 9.
  A radial cyan bloom bursts behind the grid. The grid container punches in, scale 1 → 1.035 → 1 (0.5 s, power3.out).
  The code card's `theme.css` flashes. Headline line 2 slams in: "**1,000 roots.**"
- 0.48: a chip pops beside the counter: `0 re-renders` (Roboto Mono 18 px, `#51cf66` dot).
- 1.92 SECOND HIT: all tiles recolour together again, `#00e8ff` → `#f4bf4f`, with a smaller bloom. Headline line 3: "**Hot-swapped.**"
- 2.88: all tiles go to `#4d63ff` (third, softer hit).
- Snap shut by 3.69.

## Frame 06 — Every instance, every typo (19.25 → 23.09)

- tab Components · lane 1 · eyebrow "COMPONENTS"
- 0.10: headline line 1 "Every **instance.**"
- Right column: a small tree fragment (x 740 → 1120, y 124 → 640) with 8 rows, and the page mock (x 1150 → 1840) with 9 small
  cards in a 3×3 grid. Five cards contain a `<hmr-utility-btn>` button ("Click me" `#3b82f6`, "Delete" `#e03131`, "Badge" `#2f9e44`,
  "A", "B"). The others hold text lines.
- 0.48: an arrow cursor moves onto the tree row `<hmr-utility-btn>`, and a "⇧ Shift" key cap lights.
- 0.96 HIT: on the page every `<hmr-utility-btn>` instance gets a dashed 2px `#4d63ff` box with a tag label chip, staggered 0.05 s.
  In the tree, the matching rows (two `<hmr-utility-btn>` rows) are marked with a `#4d63ff` left bar.
- 1.92 HIT: headline line 2 "Every **typo.**" A new tree row `<hmr-not-defind>` (typo intended) appears with an amber dot and a chip
  "not defined" (`#292929`, amber text). On the page an unstyled grey card pulses amber. 2.40: a row `<hmr-warnings>` shows a
  warning chip "1 warning" in amber.
- 2.88: a detail line under the tree: "<hmr-not-defind> is never defined — rendered at index.html:212" (Roboto Mono 17 px, `#919191`).
- Snap shut by 3.69.

## Frame 07 — Anatomy (23.09 → 26.93)

- tab Components · lane 1 · eyebrow "ANATOMY"
- 0.10: headline line 1 "Slots, parts," · 0.48: line 2 "**context.**"
- Right column, left part (x 760 → 1360): a large `<hmr-slots>` page card, as in `capture/ref/page-anatomy-overlay.png`, scaled up.
  It has title "Slots and parts", body "Default slot content.", footer "No footer given, so this is fallback content."
  Overlays draw on beats: 0.48 host box (dashed `#919191`, label `<hmr-slots>`), 0.72 `slot "title"` `#e8590c`,
  0.96 `default slot` `#2f9e44`, 1.20 `slot "footer" · fallback` `#c2255c`, 1.44 `::part(header)` `#1098ad` (dashed),
  `::part(body)` `#9c36b5` (dashed). Each overlay is a 2px box plus a label chip filled with its colour.
- Right part (x 1390 → 1840): the details pane with SLOTS 5: `icon` + `empty` chip, `title <strong>`, `default <p>`, `footer` + `fallback` chip,
  and red `slot="aside" <em> not rendered`. Then PARTS 2: `header <header>`, `body <div>`. The coloured squares match the overlays.
- 1.92 HIT: the `footer` row is hovered and its region pulses. All other overlays fade to 25 %.
- 2.64: a CONTEXT block below the parts: `theme  "dark"  ← <hmr-ctx-provider>` (link `#8a9bff`, arrow draws).
- Snap shut by 3.69.

## Frame 08 — Break: select a range, share it (26.93 → 30.77), calm

- tab Timeline · lane 2 `#99aeff` · eyebrow "TIMELINE"
- The chrome does the drag on the strip (27.44 → 28.32). The stage only reacts.
- 0.30: headline line 1 "Select" · 0.78: line 2 "a **moment.**"
- 1.44: the range summary panel slides up into the right column (x 740 → 1840, y 360 → 640), copying the bottom summary in
  `capture/ref/timeline-tracks-range-summary.png`. It reads **"Range 22.63s–26.73s (4.10s)"** plus "412 events starting in it",
  then the layer counts `■ Lit Render 318  ■ Lit Lifecycle 64  ■ Mouse 21  ■ Custom events 9`, then a table
  (component · updates · total · `filter` `inspect` links): `<hmr-utility-btn> 6 1.2ms`, `<hmr-slots> 3 0.6ms`, `<hmr-not-defind> 0 —`.
  Buttons top-right: Zoom to range · Filter to range · Copy link · Clear (square, 1px `#363636`).
- 2.40: an arrow cursor clicks Copy link (ripple). The button reads "Copied" for 0.6 s. Headline line 3 "**Share it.**"
- 2.64 → 3.30: a URL pill above the summary (y 300) types: `localhost:5173/__lit/#tab=timeline&range=22630-26730`, Roboto Mono 20 px.
- Snap shut by 3.69.

## Frame 09 — DROP B: cause rails (30.77 → 34.61)

- tab Timeline · lane 2 · eyebrow "TIMELINE"
- 0.00 DROP HIT: headline line 1 "Every update" and line 2 "knows **why.**" slam together. A Timeline List fragment (right column)
  appears with a punch-in (scale 1.04 → 1). It copies `capture/ref/timeline-list-cause-rails.png` at 1.6×: a 36 px row, a rail column
  (16 px per lane) on the left, twisty, time `#919191`, layer swatch, title, then element tag and duration right-aligned. Rows:
  `1936.2ms ■mouse click (385, 540)` · `1936.3ms ■ performUpdate  hmr-task 0.50ms` · `1936.5ms ■ task  hmr-task 301.6ms` ·
  `2101.0ms ■ performUpdate  hmr-parent 0.30ms` · `2101.2ms ■ performUpdate  hmr-child 0.10ms` ·
  `2237.7ms ■ performUpdate  hmr-task 0.20ms` · plus 3 dim unrelated `set part` / `commit text` rows in between.
- 0.24 → 0.96: rail chain 1 (teal `#20c997`) draws down the rail column from click → performUpdate → task → the 2237.7 performUpdate.
  Node dots pop on beats 0.24, 0.48, 0.72, 0.96.
- 1.92 HIT: chain 2 (orange `#fd7e14`) draws in the second rail lane: hmr-parent → hmr-child.
- 2.40: chain 1 is hovered. Its rows highlight and the other chain dims. 2.88: a cause chip appears on the hmr-task performUpdate row:
  "after click (385, 540)" (`#292929`, Roboto Mono 16 px), with an arrow back to the click row.
- Snap shut by 3.69.

## Frame 10 — Tasks, warnings, skipped updates (34.61 → 38.45)

- tab Timeline · lane 2 · eyebrow "TIMELINE"
- 0.10: headline line 1 "Click, fetch," · 0.48: line 2 "**render.**"
- Right column: a Timeline Tracks fragment copying `capture/ref/timeline-tracks.png` at 1.6×. It has a ruler `1800ms … 2400ms`
  and lanes Lit Lifecycle, Lit Render, Mouse, Lit warnings (120 px gutter scaled → 192 px).
- 0.48: a mouse mark at 1936ms. 0.72: a lifecycle tick. 0.96 → 1.70: a `task` bar (filled `#4d63ff`, label `task · 301.6ms`)
  grows across the Lit Lifecycle lane. 1.70: render ticks at its end. A rail (teal) links mark → task → render as each lands.
- 1.92 HIT: a `warning` mark pops on the Lit warnings lane, amber with glow, with a callout "change-in-update · <hmr-warnings>".
- 2.40 HIT: an `update skipped` mark with a "2 skipped" pill (`#292929`, amber outline) pops on Lit Lifecycle. Headline line 3 "Nothing **hides.**"
- Snap shut by 3.69.

## Frame 11 — Jump to source (38.45 → 42.29)

- tab Components · lane 3 `#af7a51` · eyebrow "SOURCE"
- 0.10: headline line 1 "Click." · 0.96: line 2 "**Land in code.**"
- Right column: the page-mock counter card (same as frame 02, title "Counter: edited live", Count: 42) at (760 → 1300, 140 → 340).
- 0.24: key caps `Ctrl` `⇧` `S` light up. 0.48: the source overlay hovers the card, a dashed `#4d63ff` box with a tag chip `<hmr-counter>`.
  0.72: a grey tooltip card (`#292929`) under it: `<hmr-counter>` · `src/hmr-counter.ts:7` · `rendered at index.html:120`.
- 0.96 HIT: the arrow cursor clicks (ripple). An editor card morphs out to (1180 → 1840, 300 → 600): tab `hmr-counter.ts`,
  lines 6–8 with line numbers, line 7 highlighted `rgba(77,99,255,.16)`, caret blinking.
- 1.92 HIT: the cursor clicks "rendered at index.html:120". A second editor tab `index.html` takes the front, showing lines 119–121.
  Line 120 `<hmr-counter label="demo"></hmr-counter>` is highlighted. Small label: "the call site".
- Snap shut by 3.69.

## Frame 12 — Agents (42.29 → 46.13), calm dip

- tab Timeline · lane 4 `#a451af` · eyebrow "MCP"
- 0.10: headline line 1 "Your agent" · 0.48: line 2 "**reads it too.**"
- Right column: a terminal card (`#07070c`, 1px `#363636`, radius 8, three grey header dots, title `claude`), Roboto Mono 21 px.
- 0.24 → 1.10: types `› lit_range-summary {"start": 22630, "end": 26730}` (cyan prompt, `#e3e3e3` text).
- 1.44: `  ⎿ 412 events · 4 layers · 3 components` (dim). 1.68 → 2.20: result rows waterfall:
  `<hmr-utility-btn>   6 updates   1.2ms`, `<hmr-slots>         3 updates   0.6ms`, `<hmr-not-defind>    not defined`
  (the last in amber).
- 2.64: the agent reply in Manrope 500 22 px `#e3e3e3`: "`<hmr-not-defind>` is never registered: the tag is misspelled in index.html:212."
- Snap shut by 3.69.

## Frame 13 — Lit Inspector everywhere (46.13 → 49.97)

- tab Timeline · lane 1 `#6b7bff` · eyebrow "LIT INSPECTOR"
- 0.10: headline line 1 "Any Lit site." · 0.96: line 2 "**No Vite needed.**"
- Right column: three cards on beats, staggered.
  - 0.24: a "Chrome Web Store" card with the flame icon, "Lit Inspector", and a blue "Add to Chrome" button (`#1a73e8`, radius 4).
  - 0.48: a "Firefox Add-ons" card with the flame icon and an "Add to Firefox" button (`#0060df`).
  - 0.96: a wide card showing Chrome DevTools' Performance panel: a few grey flame-chart rows labelled "Main", then a track group "Lit"
    with Lit Lifecycle / Lit Render bars in their layer colours. Caption: "Performance tracks".
- 1.92 HIT: the three cards pulse once with a blue rim. 2.40: a small line under them, Roboto Mono 18 px `#a1a1a1`:
  "Chrome · Firefox · Performance panel".
- Snap shut by 3.69.

## Frame 14 — Lockup (49.97 → 54.92)

- tab Timeline · no lane
- While the chrome zooms out and draws rails (local 0 → 2.1), the stage shows a centred headline at y ~300:
  "Every update, **explained.**", Manrope 800 76 px. In at 0.10, out at 2.10 (0.2 s fade).
- From local 2.43 (tg 52.40), with the window collapsing behind, the full-canvas lockup (z above everything):
  the flame `assets/flame.svg` 220 px tall centred at (960, 380) scales 0.6 → 1 with an indigo → blue glow bloom.
  2.90: "vite-plugin-lit" Manrope 800 96 px `#fff` ("lit" in `#4d63ff`) centred at y 600. 3.30: a code chip (`#0b0b12`, radius 10,
  Roboto Mono 30 px) at y 720: `plugins: [litPlugin()]`, syntax coloured. 3.60: `npm i -D @oddsquad/vite-plugin-lit`,
  Roboto Mono 24 px `#a1a1a1`, at y 810. Hold. Everything fades to black with the ground over 4.43 → 4.95.
