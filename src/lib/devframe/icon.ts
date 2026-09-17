/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

// The official Lit logo mark (Iconify `logos:lit-icon`). Its native viewBox is
// 256×320 — taller than wide — so when the DevTools dock sizes an icon to its
// width it overflowed the square slot and looked bigger than the other icons.
// We pad it to a square viewBox (-32 0 320 320, centering the 256-wide art) so
// it renders at the same box size as the built-in phosphor icons. Inlined as a
// data: URI rather than `logos:lit-icon` so it also works offline (no Iconify
// API fetch).
const LIT_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-32 0 320 320">' +
  '<path fill="#00e8ff" d="m64 192l25.926-44.727l38.233-19.114l63.974 63.974l10.833 61.754L192 320l-64-64l-38.074-25.615z"/>' +
  '<path fill="#283198" d="M128 256V128l64-64v128zM0 256l64 64l9.202-60.602L64 192l-37.542 23.71z"/>' +
  '<path fill="#324fff" d="M64 192V64l64-64v128zm128 128V192l64-64v128zM0 256V128l64 64z"/>' +
  '<path fill="#0ff" d="M64 320V192l64 64z"/></svg>';

/** Dock icon for the Lit devframe. */
export const LIT_LOGO_ICON = `data:image/svg+xml,${encodeURIComponent(
  LIT_LOGO_SVG
)}`;
