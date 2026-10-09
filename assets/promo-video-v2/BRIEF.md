---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Lit HMR that keeps your state, and DevTools that explain every update"
destination: youtube
aspect: 1920x1080
language: en
audience: Lit / web-components developers using Vite
length: 54.9s
angle: product-ui-as-stage
recipe: lit-devtools-timeline (v1, adapted)
---

## Intent

Second promo for @oddsquad/vite-plugin-lit, replacing the 20s v1 in
`../promo-video/`. Same concept: the video IS the plugin's own DevTools panel,
with the Timeline tracks as the clock. Redrawn for the current Web Awesome panel
and the features shipped up to 0.15.0. Cut to the user's track "Bounce
Énergique" (54.9s, 125 BPM, bar = 1.92s), every scene starting on a bar line.

High-impact visuals land on the two drops (15.41s, 30.77s); the quiet intro,
the break and the dip carry the calmer reads. The 1,000-root recolour hits on
the first drop downbeat.

## Scene table (agreed with the user 2026-10-09)

| # | Time (s) | Topic |
|---|---|---|
| 1 | 0.05–3.89 | Cold open / Record |
| 2 | 3.89–9.65 | HMR keeps state ("Still 42.") |
| 3 | 9.65–13.49 | Components tree + details pane |
| 4 | 13.49–15.41 | `?css-sheet` setup (riser) |
| 5 | 15.41–19.25 | DROP: one sheet, 1,000 roots recolour |
| 6 | 19.25–23.09 | Shift-hover every instance, not-defined / warning chips |
| 7 | 23.09–26.93 | Anatomy overlay: slots, parts, context |
| 8 | 26.93–30.77 | Break: select a range, Copy link |
| 9 | 30.77–34.61 | DROP: cause rails |
| 10 | 34.61–38.45 | `@lit/task` chain, warnings, update skipped |
| 11 | 38.45–42.29 | Jump to source |
| 12 | 42.29–46.13 | Agents (MCP `lit_range-summary`) |
| 13 | 46.13–49.97 | Lit Inspector: Chrome Web Store, Firefox, Performance tracks |
| 14 | 49.97–54.92 | Lockup |

## Assets

- `assets/bgm/bounce-energique.m4a`: user-supplied track, the original Opus
  re-encoded to AAC 256k (the assembler's container cannot carry Opus). Used
  whole, no trim.
- `assets/flame.svg`, Manrope + Roboto Mono woff2: copied from v1 / lit-design.
- `capture/ref/`: screenshots and PANEL-REFERENCE.md of the live panel, the
  source of truth for the redrawn chrome.

## Customizations

- Rebuild all UI in HTML (no screenshots in frame), 16:9 only.
- Dark tokens; match the current panel's layout, tab names and layer names.
