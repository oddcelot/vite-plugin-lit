---
version: alpha
name: Lit DevTools Night — Frame (video / frame layer)
description: >
  Hand-authored from the lit-design skill's dark DevTools theme (build-frame's blue-professional
  remix inverted the brand into a light canvas, which the brief rules out; kept at
  .hyperframes/frame.blue-professional.md). The unit is the frame (1920×1080). Atoms are sacred —
  near-black void canvas, charcoal surfaces with hairline borders, the Lit flame blue as the one
  accent with flame-tip cyan as its highlight, Manrope for display/body, Roboto Mono for code,
  track labels and timestamps. The video's stage is the Lit DevTools Timeline itself.
unit: the frame — 1920×1080
principle: atoms are sacred · composition is free · the DevTools UI is the stage

colors:
  canvas: "#030308"
  surface: "#121212"
  surface-high: "#1c1c1c"
  surface-top: "#292929"
  border: "#363636"
  text: "#e3e3e3"
  text-strong: "#ffffff"
  text-muted: "#a1a1a1"
  text-dim: "#616161"
  accent: "#4d63ff"
  accent-deep: "#324fff"
  indigo: "#2a2c9d"
  cyan: "#00e8ff"
  accent-soft: "rgba(77,99,255,0.16)"
  accent-ring: "rgba(77,99,255,0.45)"
  success: "#34e0a1"
  error: "#ff6b6b"
  code-keyword: "#c792ea"
  code-string: "#c3e88d"
  code-number: "#f78c6c"
  code-tag: "#89ddff"
  code-callee: "#82aaff"
  code-property: "#b2ccd6"

fonts:
  display: Manrope        # assets/manrope-{medium,semibold,bold,extrabold}.woff2
  body: Manrope
  mono: Roboto Mono       # assets/RobotoMono-Latin-400.woff2

typography:
  hero:    { fontFamily: "Manrope", px: 132, weight: 800, lineHeight: 1.0, tracking: "-0.04em", color: "text-strong" }
  h1:      { fontFamily: "Manrope", px: 88, weight: 800, lineHeight: 1.05, tracking: "-0.03em", color: "text-strong" }
  h2:      { fontFamily: "Manrope", px: 56, weight: 700, lineHeight: 1.1, tracking: "-0.02em", color: "text" }
  lede:    { fontFamily: "Manrope", px: 32, weight: 500, lineHeight: 1.35, color: "text-muted" }
  eyebrow: { fontFamily: "Manrope", px: 20, weight: 700, tracking: "0.14em", upper: true, color: "accent" }
  code:    { fontFamily: "Roboto Mono", px: 30, weight: 400, lineHeight: 1.55, color: "text" }
  track:   { fontFamily: "Roboto Mono", px: 22, weight: 400, color: "text-muted" }
  tick:    { fontFamily: "Roboto Mono", px: 16, weight: 400, color: "text-dim" }

radii:
  window: "14px"
  card: "10px"
  chip: "999px"
  bar: "6px"

shadows:
  window: "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px #363636"
  glow: "0 0 40px rgba(77,99,255,0.55)"
  glow-cyan: "0 0 24px rgba(0,232,255,0.7)"

components:
  devtools-window:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border}"
    rounded: "{radii.window}"
    shadow: "{shadows.window}"
    header: "56px bar on surface-high: flame mark + 'LIT DEVTOOLS' (Manrope 800, 0.12em tracking, text); tabs Components · Updates · Timeline · Settings in text-muted; active tab = accent text + 2px accent underline"
  track-row:
    spec: "left label gutter 280px; row height 76px; hairline divider in border; label = 10px accent dot + track type"
  event-bar:
    spec: "accent-deep fill, radius bar, height 28px; when the playhead hits it: fill accent + glow, then it blooms into a demo card"
  playhead:
    spec: "2px cyan vertical line with glow-cyan; 14px cyan downward triangle cap on the ruler"
  ruler:
    spec: "40px band on surface-high, tick type every 100ms label ('1600ms' style)"
  chip:
    spec: "surface-top pill, 8px colored dot, track type"
  code-card:
    spec: "#0b0b12 fill, 1px border, radius card, code type with code-* syntax colors, 32px padding"
  record-button:
    spec: "idle: pill on surface-top, '▶ Record' text. Recording: 1px error border, error text '■ Stop'"

layout:
  safe: "96px inset all sides"
  ground: "canvas + a soft radial indigo glow (indigo @ ~35%) behind the focal element. Never busy."

rules:
  - Dark only. No light surfaces, no cream, no pure-white fills.
  - Blue is the voice; cyan is punctuation (playhead, the one highlighted word or number). One cyan focus at a time.
  - Real product vocabulary only — tag names, API and tool names from the README.
  - Big type, few words per beat; each beat readable in under 2s.
---

# Lit DevTools Night

The video borrows the plugin's own Lit DevTools Timeline as its stage. Everything reads as if
recorded inside the panel: mono track labels, a millisecond ruler, blue event bars, a cyan
playhead. Headlines are Manrope 800, white, tight tracking, placed over the void with an indigo glow.
