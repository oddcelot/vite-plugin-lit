# Iterating on the Lit Inspector promo

A 47.2 s, 1920×1080 film for the Chrome Web Store listing and the docs'
browser-extension page. A dark Chrome window holds a fictional production
shop with DevTools docked below. The **Lit** tab is the star, and captions sit
in a rail on the left. Output: `renders/video.mp4`.

It is built like `../promo-video-v2/` (read that project's ITERATING.md too):
one persistent `compositions/chrome.html` (z-index 1, the whole film) draws
the browser, the page, the DevTools dock and tab bar, and the Lit header and
footer. The 12 scenes (`compositions/frames/NN-*.html`, ids `sNN-*`, z-index
2) draw the caption rail, the DevTools body for the active tab, and overlays
on the page. `index.html` is hand-written; don't run `assemble-index.mjs`.

## Rules that are easy to break

- **Show only what the extension does.** Store policy treats showing plugin-only
  features as misleading. The checked list is in
  `capture/ref/EXTENSION-REFERENCE.md` (the real extension on a production
  build) and the docs' features-by-host page. Not in the film, on purpose:
  HMR, open in editor, source overlay, MCP, snapshot export, Copy link,
  Rendered-at links, render and warning layers.
- **The chrome owns the schedules.** The active DevTools tab, the gate, the
  permission prompt, the reload, the Lit tab per period, the omnibox URL and
  the collapse are tables in `.hyperframes/stage-spec.md`. A scene that
  switches what it draws has to switch at those exact times, so change the
  table, `chrome.html` and the scene together.
- **Fictional sites only** (`.example` domains, made-up brands), and the end
  card keeps the not-affiliated line from the store listing.

## Music

`assets/bgm/bounce-energique-from-bar4.m4a` is the v2 project's AAC re-encode
of the user's track, cut from 7.733 s (its bar 4) with a 0.12 s fade-in, so
the film's 0 s is on a bar line and both drops survive: drop A at 7.68 and
drop B at 23.04.

## Commands

Run from this directory.

```sh
npx hyperframes lint && npx hyperframes check
npx hyperframes snapshot --no-end --at 7.66,7.70,23.02,23.06   # the drops
npx hyperframes render --quality high --output renders/video.mp4
```

The Chrome Web Store field only takes a YouTube URL. Upload the render there,
then record the URL in `extension/store/listing.md`.

`capture/ref/EXTENSION-REFERENCE.md` indexes 63 screenshots, but only the ten
the scenes were drawn from are committed (see `.gitignore`). To shoot the rest
again, follow the `store` mode of `scripts/extension-assets.mjs`.
