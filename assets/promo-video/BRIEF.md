---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Lit HMR that keeps your state — plus the DevTools to see it"
destination: youtube
aspect: 1920x1080
language: en
audience: Lit / web-components developers using Vite
length: 20s
angle: product-ui-as-stage
---

## Intent

A snappy capabilities demo for @oddsquad/vite-plugin-lit. Concept: the video IS the
plugin's own DevTools timeline. Each capability is an event bar on its own track
(HMR, CSS sheets, inspector, source overlay, MCP); as the playhead reaches a bar it
blooms into a ~3s micro-demo, then snaps shut. Opens on "▶ Record". The first bar is
"Still 42." — edit, save, the counter keeps its count. Dark and blue-ish like the Lit logo.

## Assets

- ~/.claude/skills/lit-design/assets/flame.svg — Lit flame logo, closing lockup.
- ~/.claude/skills/lit-design/fonts/* — Manrope + Roboto Mono (brand type).

## Customizations

- Design from the lit-design skill's dark DevTools tokens (Lit blue #324fff/#4d63ff, cyan #00e8ff, ink scale, code syntax colors).
- Rebuild the DevTools timeline UI stylized in dark theme (captured panel screenshots are light theme; don't use them).

## Notes

- Silent (user may add music later) — keep cuts on a steady ~120bpm-ish grid so music can be laid under.
- Destination: README + docs site embed, 16:9.
- Capabilities (from README): state-keeping HMR; `?css-sheet` one shared CSSStyleSheet for thousands of shadow roots, hot-swapped without re-render; DevTools timeline + live component inspector; source overlay click-to-editor; MCP tools for coding agents (lit_list-components, lit_recent-events …).
- Closing: `litPlugin()` one-liner + `npm i -D @oddsquad/vite-plugin-lit`.
