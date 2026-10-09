# Lit DevTools panel: visual + token reference (dark theme)

Captured 1920x1080, deviceScaleFactor 1, Chromium `colorScheme: dark`, from the playground
(`http://localhost:5179/`) with the panel open standalone as its own tab (`/__lit/`), which follows the
page through the dev server. Panel Settings > Appearance > color scheme = **Auto**, so it follows the OS and
rendered dark. Sources: `src/lib/tokens.ts`, `src/panel/wa-theme.css`, `src/panel/*.ts`, `src/types/timeline.ts`,
plus computed styles read from the live DOM (values marked "measured").

Notes on the captures
- Standalone panel at 1920 wide: the Components tree is ~1578px wide and the details pane is 338px (split divider 4px, default `position-in-pixels=340`). A docked panel will be narrower; the layout is otherwise identical.
- A lingering hover tooltip ("Wheel to zoom, drag to pan, Shift+drag to select a range, double-click to fit") is visible in the range-summary shot (Playwright mouse state); crop or ignore it.
- Not reached: Lit warnings layer events (none triggered), Router layer events only appear in shots where "/inbox" was clicked, `notLit` chip (no non-Lit custom element reachable), HMR incompatibility banner.

## Screenshot index (this folder)

| File | Shows |
|---|---|
| `components-properties-state.png` | Components tab, `<hmr-properties>` selected: details pane with defined/rendered/root meta, "Filter rows", sections PROPERTIES 2, STATE 2, ATTRIBUTES 2, INSTANCE 1. Tree filter box ("Filter tags") visible in toolbar. |
| `components-context.png` | `<hmr-ctx-provider>` selected: STATE, ATTRIBUTES, INSTANCE with `ContextProvider` and context link to `<hmr-ctx-consumer>` |
| `components-slots-parts.png` | `<hmr-slots>` selected: SLOTS 5 (icon empty, title, default italic, footer fallback, slot="aside" not rendered) with colour swatches, PARTS 2 (header, body) |
| `components-tree-filter.png` | Tree filtered with "hmr-s" (match-count in the filter's end slot, non-matching ancestors dimmed) |
| `components-not-defined-chip.png` | `<hmr-not-defined>` row with amber dot + "not defined" chip, and the details header chip + explanation text |
| `components-anatomy-on.png` | Panel with the Anatomy toggle on and `<hmr-slots>` selected |
| `page-anatomy-overlay.png` | The playground page with the Anatomy overlay drawn on `<hmr-slots>` (coloured boxes + labels `slot "title"`, `::part(header)`, `default slot`, `::part(body)`, `slot "footer" · fallback`) |
| `page-source-overlay-pick.png` | In-page source overlay (Ctrl+Shift+S): page dimmed, blue-filled highlight on `<hmr-counter>`, tooltip card at bottom centre: `<hmr-counter>` / `src/hmr-counter.ts:7` / `rendered at index.html:120` |
| `updates-tab.png` | Updates tab: table of components, nothing selected (empty hint "Pick a component to see each of its updates and what changed.") |
| `updates-tab-task-selected.png` | Updates with `<hmr-task>` selected: bottom detail with `after click (385, 540)`, `after userTask task`, `userId 1 -> 2` |
| `updates-tab-skipped-selected.png` | `<hmr-skipped-update>` selected: orange `2 skipped` pill in the row, per-update `skipped` badges, `after click (382, 867)` |
| `timeline-tracks.png` | Timeline > Tracks, all layers captured, 8 lanes, ruler in ms |
| `timeline-tracks-range-summary.png` | Shift+drag range selected: translucent blue overlay with 1px edges, bottom range summary (`Range 4.73s-8.29s (3.56s)  465 events starting in it`, layer counts, component table with `filter` / `inspect` links, buttons Zoom to range / Filter to range / Copy link / Clear) |
| `timeline-list-top.png` | Timeline > List from the first events (click -> performUpdate short rails at far left) |
| `timeline-list-cause-rails.png` | List with the full cause chain rail: `click` -> `performUpdate` (hmr-task) -> `task` (301.6ms) -> second `performUpdate`, one vertical blue rail (chain colour) with 6px dots on nodes |
| `timeline-list-row-detail.png` | A `performUpdate` row selected, bottom detail pane: element `<hmr-task> #16  filter  inspect`, source, rendered at, `caused by  click at 1936.200 ms  show`, data JSON |
| `settings-tab.png` | Settings tab: intro line, Reset to env, APPEARANCE (color scheme: Auto), HMR, SOURCE OVERLAY, COMPONENTS, TIMELINE, ABOUT sections |

## Tokens (dark; `tokenCSS` in `src/lib/tokens.ts`; inherited on `:root` of the panel iframe)

Neutral ink scale (hsl L): 0=1% `#030303`, 1=5% `#0d0d0d`, 2=7% `#121212`, 3=11% `#1c1c1c`, 4=13% `#212121`, 5=16% `#292929`, 6=21% `#363636`, 7=28% `#474747`, 8=38% `#616161`, 9=57% `#919191`, 10=63% `#a1a1a1`, 11=78% `#c7c7c7`, 12=89% `#e3e3e3`, 13=100% `#ffffff`.

| Role | Token | Value (dark) |
|---|---|---|
| Panel background | `--lit-devtools-bg` | ink-0 `#030303` (measured `rgb(3,3,3)`) |
| Header / toolbar / layer strip / range summary bar | `--lit-devtools-surface-low` | ink-1 `#0d0d0d` (measured) |
| Surface | `--lit-devtools-surface` | ink-2 `#121212` |
| Container / chip fill | `surface-container-high` | ink-5 `#292929` (measured on layer chip) |
| Elevated (tooltip card) | `surface-elevated` | ink-6 `#363636` |
| Row hover | `surface-hover` | white @ 4% |
| Row selected (list) | `surface-active` | white @ 7% |
| Tree selected row | accent-soft-ish | measured `rgb(24,29,61)` plus 2px accent bar on left edge |
| Border | `--lit-devtools-border` | ink-6 `#363636` |
| Border strong (tick lines, hover) | `border-strong` | ink-7 `#474747` |
| Border subtle | | white @ 6% |
| Text | `--lit-devtools-text` | ink-12 `#e3e3e3` |
| Text strong (brand, titles) | `text-strong` | `#ffffff` |
| Text secondary | | ink-11 `#c7c7c7` |
| Text muted (times, punctuation, subtitles) | `text-muted` | ink-9 `#919191` |
| Link | `text-link` | oklch(0.72 0.15 268) ~ `#8a9bff` |
| Accent (brand blue, Lit bright) | `--lit-devtools-accent` | `#4d63ff` |
| Accent hover / pressed | | `#6478ff` / `#3d54f0` |
| Accent soft / ring | | hsla(232 100% 65% / .16) / .45 |
| Lit blue (tab indicator, WA brand) | `lit-blue` | `#324fff` |
| Lit cyan / dark cyan | | `#00ffff` / `#00e8ff` |
| Success | | hsl(158 74% 53%) ~ `#3de6a8` (enabled pill) |
| Warning (amber: not defined, Lit warnings, skip) | | `#f4bf4f` |
| Error / danger | | `#ff6b6b`; Record button when recording uses WA danger (deep red fill, see shot) |
| Info | | `#00e8ff` |
| Value syntax | | keyword `#c792ea`, string `#c3e88d`, number `#f78c6c`, property `#b2ccd6`, tag `#89ddff`, callee `#82aaff` |
| Numbers in details (`factor 2`, `renders 2`) | `.entry > .val` | warning-orange family, measured salmon `#f78c6c`-ish (number colour); strings green `#c3e88d` |

Radius: **0 everywhere** (buttons, inputs, chips, pills). Exceptions: rail node dots and status dots are circles (50%); anatomy swatch has 2px radius.
Shadows (overlays only): xs `0 1px 2px #0000004d`, md `0 4px 14px #00000066`.
Fonts: sans `system-ui, -apple-system, 'Segoe UI', sans-serif` (SF Pro on Mac); mono `ui-monospace, 'SF Mono', Menlo, Consolas, monospace` (SF Mono on Mac). No webfonts.
Type sizes: 2xs 11px, xs 12px, sm 13px (panel base), md 14px, base 16px. Weights 400/500/600/700. Brand tracking caps 0.06em (0.72px at 12px).
Spacing scale: 2, 4, 6, 8, 12, 16, 20, 24, 32px. `--lit-devtools-control-height` 28px, `--lit-devtools-row-height` 22px.
WA theme: `--wa-font-size-scale: 0.8125`, brand ramp hue 268 (brand-60 oklch(.64 .21 268), brand-70 oklch(.74 .15 268), brand-20 oklch(.28 .13 268)).

## Timeline layers (exact labels, order, colours; `src/types/timeline.ts`)

| # | Label shown | id | Colour | Captured by default |
|---|---|---|---|---|
| 1 | Lit Lifecycle | lit-lifecycle | `#4d63ff` | on |
| 2 | Lit Render | lit-render | `#325cff` | on |
| 3 | Lit Render (verbose) | lit-render-verbose | `#99aeff` | on |
| 4 | Changed values | lit-changed-values | `#6b7bff` | on (no lane of its own: values are attached to update rows) |
| 5 | Mouse | mouse | `#a451af` | off by default |
| 6 | Keyboard | keyboard | `#8151af` | off by default |
| 7 | Custom events | custom-events | `#af7a51` | off by default |
| 8 | Lit warnings | lit-warnings | `#f4bf4f` | on |
| 9 | Router (playground custom layer `app-router`) | app-router | `#ff6b35` | on |

Tracks lanes shown (in this order, only captured layers that emit events): Lit Lifecycle, Lit Render, Lit Render (verbose), Mouse, Keyboard, Custom events, Lit warnings, Router. Lane gutter label truncates long names ("Lit Render (ver").

Cause-chain rail colours (list view, cycle of 6): `--rail-0 hsl(174 72% 40%)` teal, `--rail-1 hsl(24 88% 54%)` orange, `--rail-2 hsl(330 72% 58%)` pink, `--rail-3 hsl(203 82% 50%)` blue, `--rail-4 hsl(96 52% 44%)` green, `--rail-5 hsl(46 92% 45%)` yellow. One chain = one colour root to leaf. Hovering a row of a chain fades other chains (35% opacity).

Anatomy colours (slots/parts in order): `#4d63ff #e8590c #2f9e44 #c2255c #1098ad #9c36b5 #f08c00 #5c940d`; host box `#868e96`. Pick highlight: 1px solid `#4d63ff` outline (dashed for secondary), fill rgba(77,99,255,.25) in the source overlay.

## Layout measurements (1920x1080)

Shell: column flex, 100vh. **Header** 45px tall (44 + 1px bottom border `#363636`), bg `#0d0d0d`, padding 0 12px, gap 16px.
- Brand: Lit flame logo mark 20x20 (paths: cyan `#00e8ff`, dark blue `#283198`, blue `#324fff`, cyan `#0ff`) + "LIT DEVTOOLS" 12px/700 uppercase, letter-spacing 0.72px, white, gap 8px. Brand block x=12..137.
- Tabs (segmented-tabs, WA tab group, no pill/box): each tab 42px tall, label 13px/500, icon 15px (1.15em) + label, padding-inline ~12px. Order and labels: **Components** (cube icon), **Updates** (notification/bell-square icon), **Timeline** (clock icon), **Settings** (gear icon). Tab x positions: Components 153..293 (140px), Updates 294..408, Timeline 408..522, Settings 522..635. Active tab: label colour oklch(.64 .21 268) (~`#5b7bff`), icon same, 2px underline `#324fff` flush with the header bottom edge. Inactive: `#9194a2`. Optional red count badge (HMR incompat.) and amber badge (Lit warnings) as pills after the Components label, only when non-zero.
- Optional page-changed callout under the header (warning variant, "Another page connected at <time> - the panel now follows it. The earlier recording was cleared.") only when a second page connects.

### Components tab
- Toolbar: y=45..86 (41px), bg `#0d0d0d`, bottom border, padding 6px 12px, gap ~8px. Left: **Pick** (crosshair icon, 74.5x28), tree filter input (x=94, 200x28, search icon, placeholder **Filter tags**, mono 12px, clear "x", match count at the end when filtering). Spacer. Right: **Live** (eye icon, active = filled dark-blue bg oklch(.28 .13 268) + text oklch(.74 .15 268), 73x28), **Flash** (lightning, 81x28, active by default per setting), **Anatomy** (bounding-box icon, 101x28). Inactive toggle: transparent, 1px border `#545868`, text `#9194a2`, 12px, square.
- Tree: starts y=86, padding-top 4px, rows **22px**, mono 12px, line-height 18px, padding-left `8 + depth*14`px. Twisty caret (14px) before the tag; tag rendered `<` + name + `>` with the angle brackets in muted `#919191` and the name `#e3e3e3`. Selected row: full-width bg `rgb(24,29,61)` and 2px accent bar at x=0. Hover: same-tag rows tinted.
- Chips on rows: 11px text, 6px filled circle before it, margin-left 6px; "not defined" amber `#f4bf4f`; not-lit muted grey; warned amber.
- Split panel: tree 1578px | 4px divider (accent-tinted, `#4d63ff` at low opacity visible as a blue-grey vertical line at x~1580) | details 338px, details padding 12px, font 12px.
- Details pane: header `<hmr-slots>` mono 15px/600 white (brackets muted) + target "scroll into view" icon button at right; meta `dl` (defined / rendered / root; labels muted 12px, link values `#8a9bff` mono with arrow-square-out icon); "Filter rows" wa-input (full width, 28px); collapsible sections `<details>`: caret + UPPERCASE small label (11px, tracking caps, muted) + count; entries are mono 12px `name   value` grids with 2px vertical padding; section separator 1px `#363636`. Badges (`label`, `Array(1)`, `empty`, `fallback`) are 11px muted on faint fill, no border.
- Empty details: centered text **Select a component to inspect.**

### Updates tab
- Header row (sticky): `COMPONENT - 7` left, right columns `UPDATES`, `TOTAL`, `SLOWEST` (11px uppercase muted), y=45..67. Data rows 23px (borders `#363636`), mono 12px: `<hmr-counter>`, changed-prop name in link colour right-aligned (`count`, `userId`, `items`, `route`, `counter`), optional orange outlined pill `2 skipped`, `4x`, a thin blue hot-path bar under TOTAL (width proportional to max, colour `#324fff`-ish), bold total `0.80ms`, muted slowest `0.40ms`.
- Selected row has the tree-style selected bg and left bar. Bottom pane starts at y~562 (top border), header `<hmr-task> updates  src/hmr-task.ts:19  Rendered at index.html:239  [count right]`; each update: time muted `5745.5ms`, bold duration `0.40ms`, changed prop, right side `after click (385, 540)` or `after userTask task` plus `#0` (instance id) and an orange outlined `skipped` badge when skipped; below, diff line `userId 1 -> 2` or `no changed properties`.
- Empty bottom hint: **Pick a component to see each of its updates and what changed.**

### Timeline tab
- Toolbar y=45..86: left a **segmented radio group** `List | Tracks` (28px high, bordered, active segment filled `#212121`-ish + bold). Right-aligned buttons (28px, outlined, 12px): **Export snapshot** (export icon), **Clear** (trash icon), **Record** (record dot icon; while recording the label becomes **Stop** with a stop icon and a filled deep-red/danger fill `~#7f1230` bg, red-pink text).
- Layer strip y=86..127 (41px, bg `#0d0d0d`, padding 6px 12px, gap 4px): one pill-less square chip per layer, 28px tall, padding 0 8px, 1px border `#363636`, fill `#292929`, 12px text `#e3e3e3`, 8x8 square swatch in the layer colour (solid when on; hollow outlined swatch + muted text + transparent fill when off), swatch gap 6px. Labels in order: Lit Lifecycle, Lit Render, Lit Render (verbose), Changed values, Mouse, Keyboard, Custom events, Lit warnings, Router.
- Filter bar y=127..164 (37px): `Element` label (11px muted) + wa-select "All elements" (200x28, mono 12px), regex input (placeholder **filter regex...**, 175x28). In Tracks mode, right-aligned: caption **Show as tracks** (11px muted) + compact chips (22px high, transparent fill, outlined, 11px).
- When a range is set and filtered: button chip `Time <range>  x`.
- List view: a bar y=164..187 with a **Raw** toggle (small switch) + underlined **Expand all** link, right-aligned count `554 / 554` (11px muted). Rows **23px** (22 + 1px border), mono 11px, padding `4px 12px`; columns: rail column (16px per lane, from x=12) | twisty (14px caret) | time right-aligned in a 56px column muted (`1936.3ms`) | 8x8 layer swatch | title (`#e3e3e3`) | right side: nested count `+2` (muted), `skip` (amber) flag, element tag `hmr-counter` muted (max 200px), changed values in accent blue, duration right-aligned 62px, bold white for ticks (`0.50ms`), `301.6ms` for the task run. Selected row white 7% fill.
- Rail drawing: SVG in a 16px-per-lane column starting at x=12; vertical 1-2px line in the chain colour; node dot 6x6 circle with a 2px ring in bg colour (`#030303`); forks drawn as a connector from the parent lane. Chain: click -> performUpdate -> task -> performUpdate (task spans many rows, so the line runs straight down).
- List detail pane (row selected): bottom pane y~880, bg `#0d0d0d`, header `performUpdate  Lit Lifecycle` (swatch, bold mono, layer label muted) and right `at 1936.300 ms   took 500us`; grid rows `element <hmr-task> #16  filter  inspect`, `source src/hmr-task.ts:19`, `rendered at index.html:239`, `caused by  click at 1936.200 ms  show`, `data { "phase": "performUpdate" }`. Labels muted 11px, values mono.
- Tracks view: ruler row y=164..187 (22px) with tick labels (`4500ms`, `5000ms`... 9px-ish mono, muted, each preceded by a 1px `#474747` tick line; spacing ~90px); lanes from y=187: gutter **120px** wide (right border `#363636`) holding 8px layer swatch + label (12px mono, secondary `#c7c7c7`); each lane bottom border `#363636`; lane height = rows x **14px** (min 22px); marks are `height: 11px` (ROW_PX 14 - 3), margin-top 1px, min width 2px, opacity .85 in the layer colour (point events are 2px ticks; spans like `task` are bars with 9px dark label text `task`); nested lifecycle packs on a second row (Lit Lifecycle lane is 2 rows = 43px; others 22-23px). Selected mark: 2px outline `#e3e3e3`. Lane order top to bottom: Lit Lifecycle, Lit Render, Lit Render (verbose), Mouse, Keyboard, Custom events, Lit warnings, Router. Empty area below lanes is `#030303`.
- Range selection (Shift+drag): overlay over the plot area (x from 120), fill accent-ring `rgba(77,99,255,.45)` at **18% opacity** (reads as `#0a1030`-ish dark navy), 1px edge lines in accent-ring colour with 5px-wide drag handles (3px on hover); range label chip near top (surface-low bg, accent-ring border, 11px). Summary panel docked at the bottom: top border `#363636`, bg `#0d0d0d`, padding 8px 12px, mono 11px, secondary text, max-height 150px. Header: bold `Range 4.73s-8.29s (3.56s)` then muted `465 events starting in it`, spacer, four 28px buttons: **Zoom to range**, **Filter to range**, **Copy link** (becomes **Copied** for 1.5s), **Clear** (plain, no border). Then layer counts line: 8px square swatch + `Lit Render (verbose) 436`, `Lit Lifecycle 12`, `Mouse 9`, `Lit Render 4`, `Custom events 4` (count in `#e3e3e3`). Then a table: columns `component | updates | total`, first column 140px; rows `<hmr-task>  2  500us  filter  inspect` (links in accent blue `#4d63ff`).
- Empty state (no events): centered **No events yet** / hint **Interact with the page, or press Record to capture a session.** / outlined button **Start recording** (record icon).

### Settings tab
- Padding 16px. Intro line 13px: "Resolved from plugin options and LIT_PLUGIN_* env at startup. Controls below override the running app live; the rest are config-time (change them in your Vite config / .env and restart)." (code bits in link blue). **Reset to env** outlined button with refresh icon (y~83..111).
- Sections as bordered cards (1px `#363636`, no radius, margin-bottom 12px): header strip uppercase 11px/700 tracking-caps (`APPEARANCE`, `HMR`, `SOURCE OVERLAY`, `COMPONENTS`, `TIMELINE`, `ABOUT`) + green `enabled` pill (success on success-soft) and grey `(option)` mono tag. Rows ~37px: label (left, 12px, muted-secondary, 156px column) | control: wa-select (200px, mono 12px) or switch + mono label (`off`, `shown`, `hidden`, `on`, `single colour`; on = filled `#324fff`-family track).
- Rows: Appearance: color scheme [Auto]. HMR: reconnect (off), on incompatible [reload], child state [transfer], indicator (shown), indicator count (hidden). Source overlay: hotkey `Ctrl+Shift+S LIT_PLUGIN_SOURCE_OVERLAY_KEY`, editor [Zed] (env), throttle (ms) `50`. Components: flash updates (on), colour by frequency (single colour). Timeline: note "Layers and recording are controlled in the Timeline tab.", performance tracks (off) + link "Where to find them". About: plugin version 0.15.0, lit-html 3.3.3, lit-element 4.2.2, @lit/reactive-element 2.1.2, timeline layers (comma list), element picker `available`.

### In-page UI
- Source overlay (Ctrl+Shift+S, then hover): page gets a dark dim, hovered element gets a 1px `#4d63ff` outline filled `rgba(77,99,255,.25)`; a tooltip card (bg ink-6 `#363636`, mono 12px/1.4, no radius, ~234px wide) anchored bottom centre: row 1 cube icon cell | `<hmr-counter>` bold white 12px + `src/hmr-counter.ts:7` 11px secondary; row 2 `</>` icon cell | `rendered at index.html:120` (muted label, value white). Armed row gets accent-soft bg + accent icon.
- HMR indicator: small round Lit flash badge bottom-left of the page (`<lit-devtools-hmr-indicator>`, ~22px at x=12..34, y~1046..1068).
- Anatomy: dashed host box labelled `<hmr-slots>` in grey `#868e96`; each slot/part a 1px box in the ANATOMY colour with a filled label tab above it (`slot "title"`, `::part(header)`, `default slot`, `::part(body)`, `slot "footer" - fallback`), 10-11px mono white-on-colour labels.

## Exact strings

- Brand: `LIT DEVTOOLS`. Tabs: `Components`, `Updates`, `Timeline`, `Settings`.
- Components toolbar: `Pick`, `Filter tags`, `Live`, `Flash`, `Anatomy`. Details: `Filter rows`, `Select a component to inspect.`, section names `PROPERTIES`, `STATE`, `ATTRIBUTES`, `INSTANCE`, `SLOTS`, `PARTS` (+ counts), meta labels `defined`, `rendered`, `root` (`shadow, open`), badges `empty`, `fallback`, `forwarded`, `not rendered`, chip `not defined`, no-match text `No elements match "<q>".`
- Not-defined explanation: "Nothing has called customElements.define('hmr-not-defined'), so the browser treats this as an unknown element. Check that the component's module is imported and the tag is spelled the same in both places."
- Tooltips: Pick `Pick an element on the page (Meta+Shift+E)`; Live `Pause: stop updating the tree as the page changes`; Flash `Flash elements on the page when they update`; Anatomy `Draw the selected element's slots and parts on the page`.
- Timeline toolbar: `List`, `Tracks`, `Export snapshot`, `Clear`, `Record` / `Stop`. Layers listed above. Filter bar: `Element`, `All elements`, `filter regex...`, `Show as tracks`. List: `Raw`, `Expand all`, count `554 / 554`, flag `skip` (tooltip "The update was skipped"), `+2` nested count, row titles `mousedown`, `mouseup`, `click`, `performUpdate`, `render`, `template updating`, `set part`, `commit event listener`, `commit text`, `commit node`, `task`, `template instantiated`, `template instantiated and updated`, `template prep`, `pick`, `rangeChanged`, `visibilityChanged`, `update skipped` (raw event name for skipped updates). Mouse subtitle form `(66, 149)` (x, y).
- Range summary: `Range 4.73s-8.29s (3.56s)`, `465 events starting in it`, `Zoom to range`, `Filter to range`, `Copy link`, `Copied`, `Clear`, table `component  updates  total`, row links `filter`, `inspect`. Axis tooltip: `Wheel to zoom, drag to pan, Shift+drag to select a range, double-click to fit`. Time chip: `Time <range>`.
- Cause text (Updates, per update): `after click (382, 867)`, `after userTask task`; pattern `after ${cause.type} ${detail}`. Timeline detail: `caused by  click at 1936.200 ms  show`. Skipped: `skipped` badge, row pill `2 skipped`. Diff: `count 1 -> 2` (arrow glyph), `no changed properties`.
- Updates columns: `COMPONENT - 7`, `UPDATES`, `TOTAL`, `SLOWEST`.
- Empty timeline: `No events yet`, `Interact with the page, or press Record to capture a session.`, `Start recording`.
- Debug hint (when render layers on but no Lit events): "No Lit render events yet. Lit emits them only from its development build; a production build leaves these layers empty."

## Interaction facts useful for animation
- Record state, enabled layers and settings live on the dev server; the panel store only fills from the moment the panel connects. Click-to-tick latency in the capture is ~0.1-0.3ms (`click` row at t, `performUpdate` at t+0.1..0.3ms).
- Recording must be started in the panel before page interaction; Mouse/Keyboard/Custom events layers are off by default and must be toggled on for `click` rows and rails to appear.
- Playground demos used: `hmr-counter` (button "Count: N"), `hmr-task` (userId change -> task run ~300ms), `hmr-skipped-update` (odd counts skipped), `hmr-properties` ("add item"), `hmr-slots`, `hmr-undefined` ("Define it"), `hmr-custom-layer` (route buttons /, /inbox, /settings emit Router events).
- State left on the server after capture: restored to defaults (recording stopped, Mouse/Keyboard/Custom events layers off).
