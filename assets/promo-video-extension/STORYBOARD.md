---
format: 1920x1080
duration: 47.20s
message: "Inspect the Lit components on any site, production builds included"
audience: web developers working with Lit, on any stack
music: user-supplied, assets/bgm/bounce-energique-from-bar4.m4a
---

# Lit Inspector: "The video is Chrome DevTools"

## Video direction

A dark Chrome window sits on the right with a light production shop ("Fernhouse", fictional) on top and DevTools docked below.
DevTools has a **Lit** tab. The caption rail on the left carries the words. Everything binding is in
**`.hyperframes/stage-spec.md`**, including the store-honesty rule: only what the extension really does.
Chrome draws the empty body bg for whichever DevTools tab is active. Frames draw the body content.

Energy follows the song. The intro sets up (open DevTools, enable on the site). **Drop A (7.68)** hits Pick, Elements ↔ Lit
and Anatomy. The **break (19.20)** is the calm sourcemaps → Sources moment. **Drop B (23.04)** carries the Timeline cause chain, Updates
and the Performance panel. The **dip (34.56)** is trust. The outro is "any site", then the end card.

Cursor: a white arrow (24 px drawn SVG, dark outline) used in several frames. A click is a 0.12 s scale press plus a ring ripple.

## Frame 01 — Open (0 → 3.84)

- Caption: eyebrow "LIT INSPECTOR". At 0.48 "A Lit tab", at 0.96 "for **any site.**"
- 0.20 → 0.90: a cursor floats over the page. At 0.96 a small "⌥⌘I" key-cap chip shows near the cursor (DevTools opens at 1.00 → 1.60, chrome).
- 1.60 → 2.40: you draw the Elements body (y 504 → 1040): the DOM tree, Roboto Mono 15 px, with
  `<html>`, `<body>`, `<fh-app>`, `#shadow-root (open)`, `<fh-header>`, `<fh-product-card>` ×3 (purple tag names `#5db0d7`-ish,
  attribute names `#9bbbdc`, values `#f29766`, as in Chrome DevTools dark), and a styles pane stub on the right.
- 1.92: the cursor moves to the **Lit** tab in the DevTools tab bar (its x is in the spec). At 2.30 it clicks; the chrome switches at 2.40.
  The Lit tab gets a cyan glow pulse once.
- 2.40 → 3.84: the chrome draws the gate. You draw only the caption and cursor (the cursor rests near "Enable on this site").

## Frame 02 — Enable on this site (3.84 → 7.68)

- Caption: eyebrow "PER SITE". At 0.10 "Off until", at 0.48 "you **say so.**". At 2.40 a sub-line: "No site access at install."
- 0.24: the cursor moves to the gate's "Enable on this site" button. At 0.40 it clicks (ripple). The chrome shows the permission prompt at 4.32 = local 0.48.
- 1.20 → 1.44: the cursor moves to "Allow" and clicks at local 1.44 (tg 5.28). The chrome closes the prompt and reloads.
- From local 1.92 (tg 5.76): you draw the Lit body, the Components tab. Toolbar strip (y 548 → 588, `#0d0d0d`): Pick, "Filter tags",
  and Live / Flash / Anatomy right. Tree pane x 540 → 1440 and details pane x 1440 → 1880 with a 1px `#363636` divider.
  The tree waterfalls in (0.04 s stagger, on the beat): `<fh-app>`, `▾ <fh-header>`, `<fh-search>`, `<fh-cart-button>`,
  `<fh-product-card>` ×3, `<fh-reviews>`, `<fh-toast>`. The details pane reads "Select a component to inspect." (`#919191`, centred).
- 2.88: a chip over the tree's top-right: "production build · minified" (`#292929`, Roboto Mono 14 px, `#f4bf4f` dot). Hold.

## Frame 03 — DROP A: Pick (7.68 → 11.52)

- Caption: eyebrow "COMPONENTS". At 0 (drop) "Click it." slams. At 0.96 "**Inspect it.**"
- The Lit body persists from frame 02 (same tree, same layout), and the Pick button is pressed (dark-blue fill `#1a2366`, text `#8a9bff`).
- 0.00 HIT: the cursor sits over product card 2 on the page. A pick overlay (a `rgba(77,99,255,.18)` fill + 1px `#4d63ff` box) wraps card 2, and a
  tooltip chip under it shows a cube icon and `<fh-product-card>` (dark `#1e1e1e`, Roboto Mono 15 px). Click ripple.
- 0.24: the tree row `<fh-product-card>` (the 2nd) is selected. The details pane fills: `<fh-product-card>` bold; `root  shadow, open`;
  a Filter rows box; PROPERTIES 2 (`name "Fiddle Leaf Fig"`, `price 48`); STATE 1 (`inCart false`); INSTANCE 2 (`reviews` with a `task` chip and
  a green dot "complete", `renders 3`).
- 1.92 HIT: the page's "Add to cart" button on card 2 is clicked. Card 2 flashes a 2px `#4d63ff` outline (Flash). `inCart false → true` and `renders 3 → 4`
  highlight (row bg `rgba(77,99,255,.35)` fading 0.8 s). On the page the cart button reads "Cart · 3" (overlay the text).
- 2.88: the sub-line "Production builds included."

## Frame 04 — Elements ↔ Lit (11.52 → 15.36)

- Caption: eyebrow "ELEMENTS PANEL". At 0.10 "Select in", at 0.48 "**Elements.**". At 1.92 "Land in **Lit.**"
- 0 → 1.92 (Elements active): you draw the Elements body. The DOM tree is expanded to `<fh-header>` → `#shadow-root` → `<fh-cart-button>`.
  At 0.48 the cursor clicks `<fh-cart-button>`. The row selects (Chrome's selected-row bg `#2c3e57`), the page cart button gets Chrome's blue
  inspect highlight, and `== $0` appears after the row.
- 1.92 (Lit active): the Lit body shows the Components tree with `<fh-cart-button>` already selected (the selected-row style, scrolled into view).
  Details: `<fh-cart-button>`, STATE `count 3`, and a CONTEXT row `cart  {items: 3}  ← <fh-app>` (link `#8a9bff`). A small chip floats by the row:
  "followed the Elements selection".
- 2.64: the cursor clicks the details header's "Reveal in Elements" icon button (draw it as a 28 px square button with an arrow-out icon,
  and a tooltip "Reveal in Elements"). The chrome switches to Elements at 3.12. Draw the Elements tree again with `<fh-cart-button>` selected and flashing once.

## Frame 05 — Anatomy (15.36 → 19.20)

- Caption: eyebrow "ANATOMY". At 0.10 "Slots, parts," at 0.48 "**context.**"
- Lit body: Components with `<fh-product-card>` (card 1, Monstera) selected and the Anatomy toggle pressed. The details pane shows SLOTS 3:
  `media <img>`, `default <h3>`, `price` + a `fallback` chip. PARTS 2: `title <h3>`, `cta <button>`. Each row has a coloured square.
- On the page, overlays draw on card 1 on beats: 0.48 host box (dashed `#919191`, label `<fh-product-card>`) · 0.72 `slot "media"` `#e8590c` ·
  0.96 `default slot` `#2f9e44` · 1.20 `slot "price" · fallback` `#c2255c` · 1.44 `::part(cta)` `#1098ad` (dashed) · `::part(title)` `#9c36b5` (dashed).
  Each overlay is a 2px box plus a label chip in its colour, at the card's real element positions.
- 1.92 HIT: hovering the `price` row pulses its region, and the others fade to 25 %.
- 2.64: a CONTEXT block appears in the details: `cart  {items: 3}  ← <fh-app>`, and on the page a thin `#8a9bff` arrow draws from the header logo area
  (fh-app) to the cart button.

## Frame 06 — Break: sourcemaps → Sources (19.20 → 23.04), calm

- Caption: eyebrow "SOURCE". At 0.30 "Where it's", at 0.78 "**defined.**". Sub-line at 1.92: "From the page's own sourcemaps."
- 0 → 1.44 (Lit active, Components): details for `<fh-product-card>`. Under the tag, a meta line `defined  src/components/product-card.ts:24 ↗` (link `#8a9bff`)
  and `root  shadow, open`. At 0.96 the link underlines on hover, and at 1.20 the cursor clicks it.
- 1.44 (Sources at tg 20.64): you draw Chrome's Sources body: a file tree on the left (`fernhouse.example › assets › src › components › product-card.ts`),
  an editor tab `product-card.ts`, and lines 22–27 of TypeScript (Roboto Mono 15 px, Chrome dark syntax colours) with line 24
  `@customElement('fh-product-card')` highlighted (`#2c3e57` with a `#a8c7fa` left bar). The cursor (blinking caret) is on line 24.
- Hold calm to the end.

## Frame 07 — DROP B: Timeline cause chain (23.04 → 26.88)

- Caption: eyebrow "TIMELINE". At 0 (drop) "Every update" + "knows **why.**" slam together.
- Lit body, Timeline tab: toolbar (List | Tracks segmented with **List** active, "Export snapshot" absent, Clear, red "Stop") and a layer chip strip:
  Lit Lifecycle, Changed values, Mouse, Keyboard, Custom events. **No Render or warnings chips.**
- List rows (Roboto Mono 15 px, 29 px rows, a rail column on the left; copy `capture/ref/31-timeline-alllayers-list-panel.png`):
  `2210.4ms ■ click  (1188, 431)` mouse ·
  `2210.6ms ■ performUpdate  fh-product-card 0.40ms` ·
  `2210.9ms ■ task  fh-reviews 312.0ms` ·
  `2523.1ms ■ performUpdate  fh-reviews 0.30ms` ·
  `2211.2ms ■ performUpdate  fh-cart-button 0.10ms` ·
  plus 2 dim unrelated lifecycle rows.
- 0.00: rows slam in. 0.24 → 0.96: the teal rail draws click → performUpdate → task → the fh-reviews performUpdate, with node dots on the beats.
- 1.92 HIT: the orange rail (`#fd7e14`) draws click → fh-cart-button performUpdate.
- 2.40: hover highlights the teal chain. 2.88: the cause chip "after click (1188, 431)" on the fh-product-card performUpdate row.

## Frame 08 — Updates (26.88 → 30.72)

- Caption: eyebrow "UPDATES". At 0.10 "What changed," at 0.48 "**how often.**"
- Lit body, Updates tab (copy `capture/ref/40-updates-panel.png` + `41-updates-selected-panel.png`): a component list on the left with counts and ms
  (`<fh-product-card> 6  2.1ms`, `<fh-cart-button> 3  0.4ms`, `<fh-reviews> 2  0.6ms` + a "1 skipped" pill, `<fh-search> 1  0.1ms`).
  The right pane shows the selected `<fh-cart-button>` updates: rows with "after click (1188, 431)" and changed props `count 2 → 3`.
- 0.48: the counts tick up on beats (0.48, 0.96, 1.44). 1.92 HIT: `<fh-reviews>` is selected, showing `userId 1 → 2` and the "1 skipped" row. Strings as in the reference only.

## Frame 09 — Performance panel (30.72 → 34.56)

- Caption: eyebrow "PERFORMANCE". At 0.10 "In Chrome's", at 0.48 "**Performance** panel."
- 0 → 1.20 (Lit Settings): you draw the Settings body. A TIMELINE card (bordered, caps header) with a row "Performance tracks" + switch. At 0.72 the cursor
  flips the switch on (`#4d63ff`). There's a "Where to find them" link.
- 1.20 (Performance active at tg 31.92): you draw Chrome's Performance body. A mini overview strip, a time ruler, a "Main" track with grey flame-chart
  blocks, then a **"Lit"** track group (expanded ▾) with sub-tracks "Lifecycle" (blue bars `#4d63ff` labelled performUpdate / update) and "Input" (short purple marks for the clicks). These are the real track names from src/lib/runtime/timeline/chrome-tracks.ts
 . Bars grow in left to right on beats from 1.44.
- 1.92 HIT: a selected bar with Chrome's summary pane at the bottom: "performUpdate · fh-product-card · 0.40 ms".

## Frame 10 — Dip: trust (34.56 → 38.40), calm

- Caption: eyebrow "PRIVATE BY DESIGN". At 0.30 "CSP can't", at 0.78 "**block it.**". At 1.92 "Collects **no data.**"
- Lit body: Components as before (tree, nothing selected), dimmed to 40 %. Over the page area, two calm cards fade in (dark `#121212`, 1px `#363636`, radius 10):
  0.48 a response-header card `content-security-policy: script-src 'self'` (Roboto Mono 16 px) with a green check "Lit Inspector still connected"
  (it points at the footer's "Lit runtime connected on https://fernhouse.example", which gets a soft glow).
  1.92 a second card: "No accounts · no analytics · only this site's own scripts and sourcemaps".

## Frame 11 — Any Lit site (38.40 → 42.24)

- Caption: eyebrow "ANY LIT SITE". At 0.10 "Any site." At 0.96 "**Any build.**"
- The page area cycles through fictional Lit sites on beats, as full covers of the page area (y 128 → 470), each a quick plausible layout:
  0.00 Fernhouse (no cover) · 0.96 `atlas.example/app`, a dark dashboard with charts (`<atlas-chart>`, `<atlas-sidebar>`) · 1.92 `tickets.example`,
  a light event listing (`<tk-event-card>` ×4) · 2.88 back to Fernhouse.
- The Lit body tree swaps with each site (tree rows waterfall in fast): atlas `<atlas-shell>`, `<atlas-sidebar>`, `<atlas-chart>` ×3; tickets
  `<tk-app>`, `<tk-search>`, `<tk-event-card>` ×4. The chrome updates the omnibox URL at the same beats (spec).
- Sub-line at 1.92: "Follows the inspected tab across navigations."

## Frame 12 — End card (42.24 → 47.20)

- 0 → 0.66: the chrome collapses the browser window. The caption rail fades out by 0.30.
- 0.48: centred lockup: `assets/icon.svg` 200 px tall at (960, 360) scales 0.6 → 1 with a blue/cyan glow bloom.
  0.96: "Lit Inspector", Manrope 800 92 px `#fff`, centred at y 560. 1.20: "Inspect Lit components on any site. Production builds included."
  Manrope 500 26 px `#a1a1a1` at y 640.
- 1.44: a Chrome Web Store–style button at y 740: `#1a73e8` fill, radius 6, white "Add to Chrome", Manrope 600 24 px, 64 px tall, pops (spring).
- 1.92: small text at y 1010, Manrope 500 15 px `#616161`: "Independent tool. Not affiliated with Google or the Lit project."
- Hold. The chrome fades to black at 4.46 → 4.96; fade your lockup with it.
