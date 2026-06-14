/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Build an SVG clip-path that fills the viewport except a rounded-rect hole at
// (l, t, w, h) with corner radius r — the spotlight cut-out for the highlight.
// Outer rect (clockwise) + inner rounded rect (counterclockwise) combine under
// the nonzero fill rule to punch the hole.
export const buildSpotlightClipPath = (
  l: number,
  t: number,
  w: number,
  h: number,
  r: number
): string => {
  r = Math.min(r, w / 2, h / 2);
  const outer = `M 0 0 H 9999 V 9999 H 0 Z`;
  const inner = [
    `M ${l + r} ${t}`,
    `Q ${l} ${t} ${l} ${t + r}`,
    `L ${l} ${t + h - r}`,
    `Q ${l} ${t + h} ${l + r} ${t + h}`,
    `L ${l + w - r} ${t + h}`,
    `Q ${l + w} ${t + h} ${l + w} ${t + h - r}`,
    `L ${l + w} ${t + r}`,
    `Q ${l + w} ${t} ${l + w - r} ${t}`,
    `Z`,
  ].join(' ');
  return `path('${outer} ${inner}')`;
};
