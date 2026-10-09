# Iterating on the vite-plugin-lit promo, v2

A 54.92 s, 1920×1080 film cut to the user's track "Bounce Énergique" (125 BPM,
bar = 1.92 s). The dark Lit DevTools panel is the canvas: its Timeline strip
pans past a fixed cyan playhead, and each scene is a bar on a lane while the
stage above shows the demo. Output: `renders/video.mp4`. v1 (20 s) is in
`../promo-video/` and stays as it was.

On YouTube: https://www.youtube.com/watch?v=eUg84347jyE. A new render needs a new upload.

## Where things are

| File | What it holds |
| --- | --- |
| `BRIEF.md` | What the user asked for, plus the agreed scene table |
| `.hyperframes/stage-spec.md` | **Binding** geometry, colours, time model, bars, outro. Read it before touching anything |
| `STORYBOARD.md` | Per-scene shot list in local time, plus the chrome's cold open, break and outro |
| `compositions/chrome.html` | The persistent panel (window, header, tabs, Record, the timeline strip, playhead, outro). It runs for the whole 0 → 54.92 s at z-index 1 |
| `compositions/frames/NN-*.html` | One stage scene each (ids `sNN-*`), z-index 2, transparent, drawing only inside the stage rect |
| `index.html` | **Hand-written.** Don't run `assemble-index.mjs`, which would replace it with a sequential frames-only index and drop the chrome layer |
| `capture/ref/` | Screenshots and `PANEL-REFERENCE.md` of the live panel (dark), the source of truth for the redrawn UI |
| `assets/bgm/bounce-energique.m4a` | The user's track. The original is Opus in an m4a, which the renderer's container can't carry, so it was re-encoded to AAC 256k. Used whole, no trim |

## Why the chrome is its own layer

v1 redrew the chrome in every frame, and parallel workers drifted on it (the
ruler in 3 of 7 frames), so every cut needed a manual seam check. In v2 one
composition draws the chrome for the whole film, so a cut can't move it. A
frame only has to start and end on an empty stage, apart from 04 → 05, where the
tile grid carries across the drop and both files share its constants.

## Timing

- Scenes start on bar lines: 0 · 3.89 · 9.65 · 13.49 · 15.41 (drop A) · 19.25 ·
  23.09 · 26.93 (break) · 30.77 (drop B) · 34.61 · 38.45 · 42.29 (dip) ·
  46.13 · 49.97 (outro). To retime, change `index.html`, the scene table in the
  stage spec, and the bar times and `D(tg)` in `chrome.html` together.
- The strip shows timeline time `D(tg)`. It holds during the break, so
  everything after 30.77 sits 3.84 s behind global time.
- Beat grid: `npx hyperframes beats /path/to/dir-with-the-song` reports
  "250 bpm", the eighth-note grid (0.24 s from 0.053). Hits use the 0.48 s beat.

## Commands

Run from this directory (its `package.json` shields `npx` from the repo root's
pnpm-only `devEngines`).

```sh
npx hyperframes lint && npx hyperframes check
npx hyperframes snapshot --no-end --at 15.40,15.42,30.76,30.80   # seams on the drops
npx hyperframes preview --background                             # Studio
npx hyperframes render --quality high --output renders/video.mp4
```
