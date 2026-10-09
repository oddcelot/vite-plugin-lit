# Lit Inspector extension on a production Lit build: reference

Captured with the real unpacked extension (dist/extension, v0.15.0) in Playwright Chromium, dark scheme, on the
playground production build (`vite preview`, no plugin, no sourcemaps, Lit 3.3.3 prod bundle). Script: /tmp/ext-ref/ (lib.mjs, t1-t6).
Host permission was added in a build copy (stands in for the Chrome prompt). The Lit tab is opened as a normal tab, so a
`chrome.devtools` shim was injected into the panel tab to get the gate state and the "Reveal in Elements" button; see Caveats.

Files are in this folder. `*-sbs.png` = 1920x1080, page (760px) | panel (1159px). `*-panel.png` = panel only at 1159x1080.
`*-panel-full.png` = panel only at ~1920 wide.

## Screenshot index
| File | Shows |
|---|---|
| 01-gate-panel | Lit tab before the site is enabled: "Site / http://localhost:4391 / Status: not permitted / [Enable on this site]" |
| 02-components-task-{sbs,panel,panel-full} | Components tree, `<hmr-task>` selected: STATE userId, ATTRIBUTES, INSTANCE userTask `task` chip + green dot "complete" + value; footer |
| 03-components-counter | `<hmr-counter>`: STATE count, ATTRIBUTES data-renders, INSTANCE renders |
| 04-components-properties | `<hmr-properties>`: PROPERTIES (label, factor), STATE (items Array(0), config {...}), ATTRIBUTES |
| 05-details-buttons-hover-panel | Details header two icon buttons (scroll-into-view, reveal in Elements), tooltip on hover |
| 06-slots | `<hmr-slots>`: SLOTS 5 (icon empty, title, default, footer fallback, slot="aside" not rendered) + PARTS 2 (header, body) |
| 07-anatomy, 07b-anatomy-scrolled | Anatomy button on; 07b has the page scrolled so the overlay is visible on `<hmr-slots>` |
| 08-context-provider, 08b-context-expanded | `<hmr-ctx-provider>`: INSTANCE row "context hmr-counter-context 0 to <hmr-ctx-consumer>"; tree expanded shows the consumer child |
| 09-flash | Flash on, click counter: green fill over the updated component in the page |
| 10-pick, 10b-pick-clicked | Pick on, hover: blue overlay box + label chip (cube icon + `<hmr-counter>`) in the page; 10b after click selects the row |
| 11-undefined | `<hmr-undefined>` (wrapper; STATE defined false). The "not defined" chip belongs to the unregistered child tag (see Caveats) |
| 20-timeline-empty, 21-timeline-recording | Timeline before and during recording |
| 22-timeline-tracks | Tracks view, default layers (Lit Lifecycle bars/ticks, "task" bars); empty-render note |
| 23/24/25/26-timeline-list* | List view (default layers): performUpdate/task/connectedCallback rows, detail pane, task row, rails on hover |
| 30-timeline-alllayers-tracks (+ -panel-full) | Tracks with Mouse/Keyboard/Custom events/Changed values/Render verbose layer chips toggled on |
| 31-timeline-alllayers-list (+ list-panel-full) | List with mouse/keyboard/custom rows and coloured cause rails (best rail shot) |
| 32-timeline-list-expanded | "Expand all" |
| 33-timeline-range-alllayers, 27-timeline-range | Shift+drag range selected, summary bar |
| 34-timeline-copy-link-clicked | "Copy link" turned into "Copied" |
| 40-updates, 41-updates-selected (+ -panel-full) | Updates tab; 41 has `<hmr-task>` selected with per-update detail |
| 50-settings (+ -panel-full) | Settings tab |

## Capability table (production build, in the extension)
| Feature | Works? | Evidence |
|---|---|---|
| Enable gate | yes | 01: Site / Status "not permitted" / button "Enable on this site"; after enabling the panel replaces it and the page reloads. Click opens Chrome's native permission prompt (not capturable headless) |
| Component tree | yes | 02: 34 rows on prod, nested (ctx-provider > consumer expand with chevron) |
| Properties / state / attributes | yes | 03/04: PROPERTIES, STATE, ATTRIBUTES, INSTANCE sections with counts, typed colours (numbers orange, strings green, booleans purple) |
| Tasks / controllers | yes | 02: `userTask` `task` chip, status dot + "complete", expandable value |
| Pick + icon tooltip | yes | 10: overlay + chip with cube icon and `<tag>` in the page |
| Flash | yes | 09 (toggle in tree toolbar and in Settings "flash updates") |
| Reveal in Elements button | yes, real DevTools only | Button `Reveal in Elements` (tip "Reveal in the Elements panel") needs `chrome.devtools`; present in 05 only because of the shim. Scroll-into-view button ("Scroll this element into view on the page") always present. Both are small icon buttons top right of the details pane |
| "defined" link via sourcemaps | no (on this build) | Playground dist has zero .map files, so no `defined` row (source is only set when a sourcemap resolves it; the extension does fetch sourcemaps via `resolveDefineSource`, untested here). Also no "rendered" row. 03 shows only root/state/attrs/instance |
| Slots / parts | yes | 06 |
| Anatomy overlay | yes | 07b: coloured labels `slot "title"`, `::part(header)`, `default slot`, `::part(body)`, `slot "footer" . fallback` over the page |
| Context provider/consumer | yes | 08: "context <name> value  to <hmr-ctx-consumer>" |
| not-defined chip | yes (code + element), not framed | String "not defined" in tree/details; the demo tag is a child of `<hmr-undefined>` only until defined |
| Updates tab | yes | 40/41: per component: tags of changed props, count "2x", total/slowest ms with bar, "1 skipped" orange chip; detail rows "1505.7ms 1.1ms userId", "userId 1 -> 2", "after click (440, 539)", "after userTask task", "#16" |
| Error attribution | not shown | The Updates tab has an `errors` chip in code; no playground component throws in an update, so not exercised |
| Timeline lifecycle layer | yes | performUpdate (ms, "+2 hmr-counter"), connectedCallback/disconnectedCallback, task (302.4ms) |
| Mouse layer | yes | mousedown/mouseup/click with (x, y) |
| Keyboard layer | yes | keydown rows "h", "i" |
| Custom events layer | yes | `pick` on hmr-events-picker, `rangeChanged` on lit-virtualizer (orange/brown square) |
| Changed values layer | partial | chip toggles, but no extra rows appeared in this recording; unverified |
| Render layer / verbose | no | Note shown: "No Lit render events yet. Lit emits them only from its development build; a production build leaves these layers empty." |
| Warnings layer | no events | Lit emits dev warnings only; track stays empty (hmr-warnings fired nothing) |
| Cause rails | yes (List view) | 31, 26: coloured dot+line column at left joining click -> performUpdate -> task -> performUpdate, per chain a different colour (teal, orange, pink, blue, green, yellow); also pick -> performUpdate |
| Task rows | yes | "task" row with duration 301-303ms, bar labelled "task" in Tracks |
| Range select + summary | yes | Shift+drag in Tracks: shaded band + bar "Range 1.58s-3.45s (1.87s) 26 events starting in it", per-layer counts (Lit Lifecycle 26, Mouse 15), table component / updates / total with "filter" "inspect" links, buttons "Zoom to range", "Filter to range", "Copy link", "Clear". Tooltip: "Wheel to zoom, drag to pan, Shift+drag to select a range, double-click to fit" |
| Copy link | button exists, link is not a usable deep link | Clipboard gets `chrome-extension://<id>/panel.html?tabId=<n>#tab=timeline&range=639.598-3207.141`; button label flips to "Copied". Do not show a shareable URL |
| Performance tracks setting | present | Settings > TIMELINE > "performance tracks" toggle, default off, link "Where to find them" |

## Exact UI strings
- Brand (panel header): icon + **LIT INSPECTOR** (uppercase, bold, letter-spaced). Extension name `Lit Inspector`; DevTools tab titled `Lit`.
- Tabs: Components, Updates, Timeline, Settings. Active tab blue with underline.
- Gate: `Site` / `http://localhost:4391`; `Status` / `not permitted` (other values: `disabled`, `unavailable`); button `Enable on this site`. Firefox-only hint: "Firefox doesn't let DevTools ask for site access..." (not Chrome).
- Footer left: `Lit runtime connected on http://localhost:4391`; not connected: `No Lit runtime in this page. Reload it to inject one.` with a `Reload page` button; initial `Waiting for the page...`. Footer right (blue link style): `Disable on this site`.
- Permission wording: Chrome's own prompt (read and change data on that origin); README: "Click **Enable on this site**. Chrome asks to let the extension read and change that origin's pages; allow it, and the page reloads."
- Components toolbar: `Pick`, `Filter tags`, `Live`, `Flash`, `Anatomy`; details `Filter rows`; sections `STATE`, `ATTRIBUTES`, `INSTANCE`, `PROPERTIES`, `SLOTS`, `PARTS`; `root  shadow, open`; empty: `Select a component to inspect.`
- Timeline: `List` `Tracks` | `Clear` `Record`; layer chips: Lit Lifecycle, Lit Render, Lit Render (verbose), Changed values, Mouse, Keyboard, Custom events, Lit warnings; `Element` selector `All elements`, `filter regex...`; `Show as tracks`; list header `Raw`, `Expand all`, count `86 / 86`.
- Updates columns: `COMPONENT . 6`, `UPDATES`, `TOTAL`, `SLOWEST`; hint `Pick a component to see each of its updates and what changed.`
- Settings: APPEARANCE color scheme (Auto/Dark/Light); note "Plugin settings need the Vite plugin; this page is inspected without a Vite dev server."; COMPONENTS flash updates (off), colour by frequency (disabled); TIMELINE performance tracks (off) "Where to find them"; ABOUT plugin version, lit-html, lit-element, @lit/reactive-element, timeline layers, element picker "available".
- No "Export snapshot" button, no editor/open-in-source links, no HMR history in the extension.

## Colours
Same panel as the Vite one (shared tokens): near-black bg (tree area #000, header/footer ~#0a0a0a), accent `hsl(232 100% 65%)` (Lit blue; active tab, Live/Flash/Anatomy on-state with soft blue fill, selected row `hsla(232 100% 65% / .16)` with blue left bar), values: numbers orange/red, strings light green, booleans purple, tags white mono. Layer colours: lifecycle/render blue, mouse purple, keyboard violet, custom events orange-brown, warnings amber. Rail colours: hsl(174 72% 40%) teal, hsl(24 88% 54%) orange, hsl(330 72% 58%) pink, hsl(203 82% 50%) sky, hsl(96 52% 44%) green, hsl(46 92% 45%) yellow. Slot/part labels: icon blue, title orange, default green, footer pink, parts cyan/purple.
Differences from the Vite panel: brand reads "LIT INSPECTOR" with the extension icon instead of Lit's; footer bar with connection text and Disable link (own strip, 12px system font); plugin-only features absent. The gate screen is unstyled system UI on #121212 with a grey default button (looks nothing like the panel).
Brand icon (extension/public/icon.svg, copied to assets/promo-video-extension/assets/icon.svg): magnifying glass, 8-facet lens + handle. Lens facets `#324fff` and `#283198` (blues) on the lower/right, `#00e8ff` and `#00ffff` (cyans) on the upper-left; handle `#324fff` + `#283198`. No tile, transparent.

## Caveats and surprises
- The Lit tab was opened as a standalone tab (as the repo's own store shots do), not inside real DevTools; so there is no DevTools chrome. Without the injected shim the gate screen shows "(not a web page) / unavailable", because a tab without host permission has no URL; the shim feeds origin and shows the Reveal button.
- Gate state cannot show the Chrome permission prompt; clicking Enable in headless does nothing visible.
- Pick shows the tooltip only after a pointer move following activation; page overlay label is `<hmr-counter>`, not the component's properties.
- Anatomy overlay only draws when the element is in the viewport; scroll the page first (07b).
- Timeline starts empty and shows the "Lit Render" note only after events arrive; mouse/keyboard/custom layers are off by default in the panel (chips unfilled) and must be toggled before recording.
- Changed values layer showed nothing on prod (unverified why); not-defined chip and error attribution were not framed.
- Panel-only "-panel-full" shots are 1919-1920px wide; the other "-panel" shots are 1159px.
- Preview server used port 4391; all browsers and servers closed.
