---
workflow: product-launch-video
flow: automation
message: "Inspect the Lit components on any site, production builds included"
destination: Chrome Web Store promo video (YouTube) + docs browser-extension page
aspect: 1920x1080
length: 47.2s
angle: product-ui-as-stage
---

## Intent

Promo for **Lit Inspector**, the browser extension (bead vpl-ekz). The plugin
promo (`../promo-video-v2/`) shows features the extension lacks, and store
policy treats that as misleading, so this film shows only what the extension
does, checked against `capture/ref/EXTENSION-REFERENCE.md` (the real
extension on a production build) and the docs' features-by-host table.

The canvas is a dark Chrome window: a fictional production shop
("Fernhouse", `fernhouse.example`) with DevTools docked below and a **Lit**
tab. Captions sit in a rail on the left.

Music: the user chose to reuse "Bounce Énergique", cut from its bar 4
(7.733 s) so both drops survive at 47.2 s. Chrome only on the end card (the
user's call; no Firefox mention until the AMO listing is live).

## Scene table

| # | Time (s) | Topic |
|---|---|---|
| 1 | 0–3.84 | Cold open: DevTools opens, Lit tab |
| 2 | 3.84–7.68 | Enable on this site → Allow → reload → tree |
| 3 | 7.68–11.52 | DROP A: Pick, details, Flash |
| 4 | 11.52–15.36 | Elements ↔ Lit, Reveal in Elements |
| 5 | 15.36–19.20 | Anatomy: slots, parts, context |
| 6 | 19.20–23.04 | Break: sourcemaps → Sources panel |
| 7 | 23.04–26.88 | DROP B: Timeline cause chain |
| 8 | 26.88–30.72 | Updates |
| 9 | 30.72–34.56 | Performance panel Lit tracks |
| 10 | 34.56–38.40 | Dip: CSP can't block it, no data collected |
| 11 | 38.40–42.24 | Any Lit site |
| 12 | 42.24–47.20 | End card: Add to Chrome, not-affiliated line |

Left out on purpose: HMR, open in editor, source overlay, MCP, snapshot
export, Copy link (it yields a chrome-extension:// URL), Rendered-at links,
render and warning layers (production builds emit none).
