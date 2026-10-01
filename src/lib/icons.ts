// Pixelarticons (https://pixelarticons.com), Copyright (c) 2019 Gerrit
// Halfmann, MIT License. Inlined so the in-page runtime UI stays
// self-contained: it runs inside the user's app, so it can't load <wa-icon>
// or fetch anything. Each is full SVG markup injected as raw HTML and colored
// with `fill: currentColor`; `crispEdges` keeps the pixel grid sharp. These
// match the panel's icons (src/panel/wa-icons.ts).

/** `code` — the source overlay's "open in editor" affordance. */
export const CODE_ICON = `<svg viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true"><path d="M11 18H9v-4h2v4Zm-4-1H5v-2h2v2Zm12-2v2h-2v-2h2ZM5 15H3v-2h2v2Zm16 0h-2v-2h2v2Zm-8-1h-2v-4h2v4ZM3 13H1v-2h2v2Zm20 0h-2v-2h2v2ZM5 11H3V9h2v2Zm16 0h-2V9h2v2Zm-6-1h-2V6h2v4ZM7 9H5V7h2v2Zm12 0h-2V7h2v2Z"/></svg>`;

/** `copy` — the source overlay's "copy path" affordance. */
export const COPY_ICON = `<svg viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true"><path d="M8 6h12v2H8zM4 2h12v2H4zm2 6h2v12H6zM2 4h2v12H2zm6 16h12v2H8zM20 8h2v12h-2zm-4-4h2v2h-2zM4 16h2v2H4z"/></svg>`;

/** `fire` — the HMR update indicator's mark. */
export const FLAME_ICON = `<svg viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true"><path d="M9 2h2v4H9zM7 6h2v2H7zM5 8h2v2H5zm8 2h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2zm2 2h2v6h-2zM3 10h2v8H3zm8-4h2v4h-2zm6 12h2v2h-2zM7 20h10v2H7zm-2-2h2v2H5zm4-2h6v4H9z"/><path d="M11 14h2v3h-2z"/></svg>`;
