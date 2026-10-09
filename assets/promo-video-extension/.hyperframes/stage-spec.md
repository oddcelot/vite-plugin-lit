# STAGE SPEC: Lit Inspector promo (binding)

1920×1080, 47.20 s. `tg` is global seconds. Music: "Bounce Énergique" from its bar 4, at 125 BPM.
Beat = 0.48 s, bar = 1.92 s, the grid starts at 0.00. Sections: intro 0–7.68 · **drop A 7.68** · break 19.20 · **drop B 23.04** · dip 34.56 ·
outro 38.40 · the music ends about 46.1 and its tail runs to 47.20.

**Store-honesty rule:** show only what the extension does. No HMR, no open in editor, no source overlay, no MCP,
no snapshot export, no Copy link / deep links, no "Rendered at" links, no render or warning layers. If unsure, check
`capture/ref/EXTENSION-REFERENCE.md`.

## Architecture

- `compositions/chrome.html` (id `chrome`, 0 → 47.20, z-index 1) is everything persistent: the ground, the Chrome browser window,
  its tab strip and omnibox, the Fernhouse page (the base state), the DevTools dock and its tab bar, the Lit panel header and footer,
  the permission prompt, the reload, and the window collapse. It follows the schedules below.
- `compositions/frames/NN-*.html` (ids `sNN-*`, z-index 2) are transparent and draw: (a) the caption rail on the left;
  (b) the **DevTools body** for their scene (Lit panel body, or Chrome's Elements / Sources / Performance body when that tab is active);
  (c) overlays on the page area (pick boxes, Anatomy, flash, cursors). They never draw the chrome.

## Look

- Ground (full canvas): `#030308` plus radial `rgba(42,44,157,0.35)` at (1200, 540), radius 1100.
- Fonts (local `@font-face` from `assets/`): Manrope 800/700/600/500/400 and Roboto Mono 400. Chrome's own UI is drawn in Manrope 500/600.
- Lit panel ink, the same as the Vite panel: bg `#030303`, bars `#0d0d0d`, borders `#363636`, chip `#292929`, text `#e3e3e3`, muted `#919191`,
  accent `#4d63ff`, underline `#324fff`, link `#8a9bff`, tree tags `#82aaff` (from the reference: tags are blue in the extension),
  selected row `rgb(24,29,61)` + 2px `#4d63ff` left bar, amber `#f4bf4f`, square corners. Layer colours: Lit Lifecycle `#4d63ff`, Mouse `#a451af`,
  Keyboard `#8151af`, Custom events `#af7a51`. Rail chain colours: teal `#20c997`, orange `#fd7e14`.
- Brand mark: `assets/icon.svg` (the Lit Inspector magnifier: blues `#324fff`/`#283198`, cyans `#00e8ff`/`#00ffff`). Wordmark "LIT INSPECTOR".
- Chrome (dark theme): frame `#202124`, active tab and toolbar `#35363a`, omnibox `#202124` pill, text `#e8eaed`, muted `#9aa0a6`.
  DevTools: bg `#282828` tab bar, 1px `#3c3c3c` lines, tab text `#c4c7c5`, active tab text `#e3e3e3` with a 2px `#a8c7fa` underline,
  body bg `#1e1e1e`.
- Panel UI is drawn at **1.25×** the real panel (13 px → 16 px, 12 px mono → 15 px, tree rows 22 → 27 px).
- Fernhouse page (light, a fictional production shop): bg `#f4f1ea`, ink `#1f2a1f`, green `#2f6f4e`, cards `#ffffff`, 1px `#e3ddd0`, radius 10.

## Geometry

- **Caption rail** (frames draw it): x 80 → 500. Eyebrow Manrope 700 16 px, letter-spacing .14em, uppercase `#4d63ff`, at y 330.
  Headline Manrope 800 58 px, letter-spacing −0.03em, line-height 1.04, `#fff`, top 362, max 3 lines of about 12 characters.
  The emphasised word is `#00e8ff`. Lines slam in on beats (y 20 → 0 + opacity, 0.28 s, power3.out). An optional sub-line goes under them:
  Manrope 500 22 px `#a1a1a1`, max 2 lines.
- **Browser window**: x 540 → 1880, y 40 → 1040 (1340 × 1000), radius 12, shadow `0 30px 80px rgba(0,0,0,.6), 0 0 0 1px #3c3c3c`, overflow hidden.
  - Tab strip y 40 → 82 (`#202124`). Active tab x 556 → 836 (`#35363a`, top radius 8): a 16 px leaf favicon (green circle)
    and "Fernhouse · Plants" Manrope 500 15 px `#e8eaed`. A loading spinner replaces the favicon while reloading.
  - Toolbar y 82 → 128 (`#35363a`): back, forward and reload icons at x 566 / 600 / 634 (`#9aa0a6`). Omnibox pill x 670 → 1740, y 89 → 121,
    `#202124`: a lock icon, then the URL `fernhouse.example` Manrope 500 16 px `#e8eaed`. Right of it: a puzzle icon at x 1764 and the
    Lit Inspector icon (16 px) at x 1800.
  - Page area x 540 → 1880, y 128 → 470 (342 px).
  - DevTools y 470 → 1040: tab bar y 470 → 504 (`#282828`, 1px `#3c3c3c` bottom). At x 556: inspect-arrow and device icons, a separator,
    then the tabs Elements, Console, Sources, Network, Performance, Memory, Application, and **Lit** (with the 14 px icon before "Lit").
    Manrope 500 15 px, 14 px padding each side. Body y 504 → 1040.
  - Lit panel (when the Lit tab is active and the site is enabled): header y 504 → 548 (`#0d0d0d`, 1px `#363636` bottom), icon 20 px at x 560,
    "LIT INSPECTOR" Manrope 800 15 px .08em at x 588; tabs Components / Updates / Timeline / Settings (16 px line icons + Manrope 600 16 px,
    18 px padding) starting x 760, active `#4d63ff` + 2px `#324fff` underline. **Lit body y 548 → 1012** (frames draw here).
    Footer y 1012 → 1040 (`#0d0d0d`, 1px `#363636` top): "Lit runtime connected on https://fernhouse.example" Manrope 500 13 px `#919191` at x 556;
    "Disable on this site" `#8a9bff` right-aligned to x 1864.
- **Fernhouse page** (chrome draws the base, y 128 → 470): header bar y 128 → 180 (`#ffffff`, 1px `#e3ddd0` bottom). "Fernhouse" logo Manrope 800 24 px `#2f6f4e`
  with a leaf at x 572. A search field `<fh-search>` at x 900 → 1300 (pill `#f4f1ea`, "Search plants"). A cart button `<fh-cart-button>` at x 1720 → 1856
  (green pill "Cart · 2"). Below: 3 product cards `<fh-product-card>` at x 572 → 984, 1004 → 1416, 1436 → 1848, y 200 → 452. Each has an image block
  (a soft green gradient with a plant silhouette, top 120 px), a title (Manrope 700 18 px: "Monstera", "Fiddle Leaf Fig", "Snake Plant"),
  a price (Roboto Mono 16 px "€34" / "€48" / "€22") and an "Add to cart" button (green outline, radius 6). Card 2 (Fiddle Leaf Fig) also shows
  `<fh-reviews>`: "★ 4.8 · 126 reviews".

## Schedules (chrome executes; frames align to them)

DevTools dock: hidden until 1.00 (page area runs to y 1040). It slides up to y 470 over 1.00 → 1.60 (power3.out), and the page area shrinks
to 470 with the content top-anchored.

Active DevTools tab (switches are instant; the underline slides 0.2 s):

| from tg | tab |
|---|---|
| 1.60 | Elements |
| 2.40 | Lit (gate state) |
| 11.52 | Elements |
| 13.44 | Lit |
| 14.64 | Elements |
| 15.36 | Lit |
| 20.64 | Sources |
| 23.04 | Lit |
| 31.92 | Performance |
| 34.56 | Lit |

- **Gate** (Lit active, tg 2.40 → 5.76): no Lit header or footer. The body is the unstyled gate from `capture/ref/01-gate-panel.png`
  at 1.25×, on `#121212`: "Site  https://fernhouse.example", "Status  not permitted", and a grey system button "Enable on this site".
  The **chrome** draws the gate (the frames don't).
- **Permission prompt** (chrome): a Chrome bubble anchored under the omnibox's right end (x 1380 → 1860, y 124 → 300, `#35363a`, radius 12,
  shadow). Lit Inspector icon + "Lit Inspector" title; text "Allow this extension to read and change your data on fernhouse.example?"
  (Manrope 500 16 px `#e8eaed`); buttons "Deny" (outline) and "Allow" (`#a8c7fa` fill, `#062e6f` text), radius 16. It pops in at tg 4.32
  (scale 0.96 → 1, 0.2 s). It closes at 5.38 after the frame's cursor clicks Allow at 5.28.
- **Reload** (chrome) at 5.40 → 5.76: the tab favicon becomes a spinner, the page area dims to white `#f4f1ea` and re-draws, and at 5.76
  the Lit header and footer appear (fade 0.15 s) with the Components tab active.
- **Lit tab per period**: Components 5.76 → 23.04 (whenever Lit is active) · Timeline 23.04 → 26.88 · Updates 26.88 → 30.72 ·
  Settings 30.72 → 31.92 · Components 34.56 → end.
- **Omnibox URL**: `fernhouse.example` throughout, except in scene 11: `atlas.example/app` at 39.36, `tickets.example` at 40.32,
  `fernhouse.example` again at 41.28. The footer's "connected on" origin follows it. Scene 11 covers the page area itself for the other sites.
- **Outro collapse** (chrome): 42.24 → 42.90 (power3.in), the browser window scales 1 → 0.9 toward its centre and fades to 0. The ground stays.
  It fades to black 46.70 → 47.20.

## Scene windows

| # | id | start | dur | section |
|---|---|---|---|---|
| 1 | s01-open | 0 | 3.84 | intro |
| 2 | s02-enable | 3.84 | 3.84 | intro |
| 3 | s03-pick | 7.68 | 3.84 | DROP A |
| 4 | s04-elements | 11.52 | 3.84 | drop A |
| 5 | s05-anatomy | 15.36 | 3.84 | drop A |
| 6 | s06-sources | 19.20 | 3.84 | break |
| 7 | s07-timeline | 23.04 | 3.84 | DROP B |
| 8 | s08-updates | 26.88 | 3.84 | drop B |
| 9 | s09-performance | 30.72 | 3.84 | drop B |
| 10 | s10-trust | 34.56 | 3.84 | dip |
| 11 | s11-any-site | 38.40 | 3.84 | outro |
| 12 | s12-endcard | 42.24 | 4.96 | outro |

Local beats: 0, .48, .96, 1.44 | 1.92, 2.40, 2.88, 3.36. Frame content leaves by local `dur − 0.12` (fade 0.15 s);
the caption rail may cross-fade instead. The DevTools body a frame draws must sit exactly in y 548 → 1012 (Lit) or y 504 → 1040 (Chrome panels),
x 540 → 1880, with an opaque body bg (`#030303` Lit / `#1e1e1e` Chrome panels) so the frames hand over cleanly at the cut.
