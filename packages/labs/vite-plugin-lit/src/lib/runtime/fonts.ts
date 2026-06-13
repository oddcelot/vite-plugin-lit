/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Default monospace font stack for the devtools UI (HMR indicator, source
 * overlay). Surfaced through the `--lit-devtools-font-mono` custom property so
 * consumers can override it; this constant is the fallback default, mirroring
 * the `--lit-devtools-radius` convention.
 *
 * The devtools only render code-adjacent text, so monospace is the only stack
 * they need.
 */
export const LIT_DEVTOOLS_FONT_MONO = `ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace`;

/** `var()` reference to the devtools mono font with the default stack inlined. */
export const FONT_MONO_VAR = `var(--lit-devtools-font-mono, ${LIT_DEVTOOLS_FONT_MONO})`;
