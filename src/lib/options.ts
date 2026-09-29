/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {SourceOverlayOptions} from './types.js';
import type {FeatureSettings} from '../types/timeline.js';

/**
 * On-page HMR feedback: a small pulsing indicator in the corner of the host
 * page that briefly animates on each HMR update, for at-a-glance feedback
 * without watching the console.
 */
export interface HmrIndicatorOptions {
  /** Inject the indicator element. Defaults to `true` (when HMR is enabled). */
  enabled?: boolean;

  /**
   * Show a cumulative update count next to the dot (idle opacity 0.5 instead
   * of fully transparent). Defaults to `false`.
   */
  count?: boolean;
}

/**
 * HMR for Lit component classes and its on-page feedback.
 */
export interface HmrOptions {
  /**
   * Enable in-place HMR for Lit component classes. When `false`, the plugin
   * skips all HMR transforms and runtime injection. Defaults to `true`.
   */
  enabled?: boolean;

  /**
   * Cycle `disconnectedCallback()`/`connectedCallback()` on live instances
   * after a hot patch. Interning makes this mostly unnecessary, so it's
   * opt-in. Defaults to `false`.
   */
  reconnect?: boolean;

  /**
   * What to do when a component can't be hot-patched in place (e.g.
   * standard `accessor` decorators). Defaults to `'reload'`.
   */
  onIncompatible?: 'reload' | 'warn';

  /**
   * The on-page update indicator. `true` enables it without a count; an
   * object configures it. Forced off when HMR itself is disabled. Defaults
   * to enabled (without a count).
   */
  indicator?: boolean | HmrIndicatorOptions;
}

/**
 * What a `?css-sheet` import compiles to under `vite build`.
 *
 * - `'url'`: fetch-backed sheet over the emitted `.css` asset.
 * - `'inline'`: css text embedded in the JS chunk, processed by the css
 *   pipeline (`?inline`).
 * - `'inline-raw'`: css text embedded verbatim, skipping the css pipeline
 *   (`?raw`).
 * - `'auto'`: `'inline'` when `build.lib` is set, `'url'` otherwise.
 */
export type CssSheetBuild = 'auto' | 'url' | 'inline' | 'inline-raw';

const CSS_SHEET_BUILD_MODES: readonly CssSheetBuild[] = [
  'auto',
  'url',
  'inline',
  'inline-raw',
];

/**
 * Options for the Lit Vite plugin.
 *
 * Every option also resolves from environment variables (and `.env` files)
 * with the `LIT_PLUGIN` prefix — e.g. `LIT_PLUGIN_HMR_INDICATOR=true`. Options
 * passed here take precedence over env vars, which take precedence over the
 * built-in defaults.
 */
export interface LitPluginOptions {
  /**
   * HMR for Lit components and its on-page feedback. `true`/`false` toggles
   * the whole feature (patching and indicator); an object configures it.
   * Defaults to enabled.
   */
  hmr?: boolean | HmrOptions;

  /**
   * Dev-only click-to-open-in-IDE inspector for Lit custom elements.
   * Toggle with Ctrl+Shift+S (configurable via `key`). Defaults to `false`.
   */
  sourceOverlay?: boolean | SourceOverlayOptions;

  /**
   * Vite DevTools Timeline panel — a Vue DevTools–style layered event stream
   * for Lit lifecycle, render, mouse, and keyboard events.
   *
   * Requires `@vitejs/devtools` in the Vite config and the `@vitejs/devtools`
   * Vite plugin (`DevTools()`) to be active. Defaults to `false` while
   * experimental.
   *
   * `true` enables all built-in layers with defaults.
   */
  timeline?: boolean;

  /**
   * What a `?css-sheet` import compiles to under `vite build`.
   * - `'url'`:        fetch-backed sheet over the emitted `.css` asset
   * - `'inline'`:     css text embedded in the JS chunk, processed by the css
   *                   pipeline (`?inline`)
   * - `'inline-raw'`: css text embedded verbatim, skipping the css pipeline
   *                   (`?raw`)
   * - `'auto'`:       `'inline'` when `build.lib` is set, `'url'` otherwise
   *
   * Dev is always the fetch-backed HMR form regardless of this setting.
   * Defaults to `'auto'`.
   */
  cssSheetBuild?: CssSheetBuild;
}

/** Plugin options after merging explicit options, env vars, and defaults. */
export interface ResolvedOptions {
  hmrEnabled: boolean;
  reconnect: boolean;
  onIncompatible: 'reload' | 'warn';
  indicator: false | {count: boolean};
  sourceOverlay: false | SourceOverlayOptions;
  timeline: boolean;
  cssSheetBuild: CssSheetBuild;
}

/** Env var prefix consumed at config time. */
export const ENV_PREFIX = 'LIT_PLUGIN';

const ON_INCOMPATIBLE_MODES: readonly ('reload' | 'warn')[] = [
  'reload',
  'warn',
];

/** Parse a boolean-ish env string; `undefined` when unset/unrecognized. */
const envBool = (v: string | undefined): boolean | undefined =>
  v === 'true' || v === '1'
    ? true
    : v === 'false' || v === '0'
      ? false
      : undefined;

/** Parse a numeric env string; `undefined` when unset/non-numeric. */
const envNum = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

/**
 * Parse a string against a closed set of values; `undefined` (with a warning)
 * when set to something outside it, so a typo falls back to the default
 * instead of silently disabling a feature.
 */
const envEnum = <T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  source: string
): T | undefined => {
  if (v === undefined || v === '') return undefined;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  console.warn(
    `[lit-plugin] ignoring ${source}=${JSON.stringify(v)}; expected one of ` +
      allowed.map((a) => JSON.stringify(a)).join(', ')
  );
  return undefined;
};

/**
 * Merge explicit options over env vars over defaults (in that precedence) into
 * the flat shape the plugin hooks consume.
 */
export const resolveOptions = (
  options: LitPluginOptions,
  env: Record<string, string>
): ResolvedOptions => {
  const hmr = options.hmr;
  const hmrObj = typeof hmr === 'object' ? hmr : undefined;
  const hmrEnabled =
    (typeof hmr === 'boolean' ? hmr : hmrObj?.enabled) ??
    envBool(env[`${ENV_PREFIX}_HMR`]) ??
    true;
  const reconnect =
    hmrObj?.reconnect ?? envBool(env[`${ENV_PREFIX}_HMR_RECONNECT`]) ?? false;
  const onIncompatible =
    hmrObj?.onIncompatible ??
    envEnum(
      env[`${ENV_PREFIX}_HMR_ON_INCOMPATIBLE`],
      ON_INCOMPATIBLE_MODES,
      `${ENV_PREFIX}_HMR_ON_INCOMPATIBLE`
    ) ??
    'reload';

  const ind = hmrObj?.indicator;
  const indObj = typeof ind === 'object' ? ind : undefined;
  const indEnabled =
    (typeof ind === 'boolean' ? ind : indObj?.enabled) ??
    envBool(env[`${ENV_PREFIX}_HMR_INDICATOR`]) ??
    true;
  const indCount =
    indObj?.count ?? envBool(env[`${ENV_PREFIX}_HMR_INDICATOR_COUNT`]) ?? false;
  // The indicator is meaningless without HMR, so it follows the master toggle.
  const indicator = hmrEnabled && indEnabled ? {count: indCount} : false;

  const so = options.sourceOverlay;
  const soExplicit =
    typeof so === 'boolean' ? so : so === undefined ? undefined : true;
  const soEnabled =
    soExplicit ?? envBool(env[`${ENV_PREFIX}_SOURCE_OVERLAY`]) ?? false;
  let sourceOverlay: false | SourceOverlayOptions = false;
  if (soEnabled) {
    const base: SourceOverlayOptions = typeof so === 'object' ? {...so} : {};
    base.key ??= env[`${ENV_PREFIX}_SOURCE_OVERLAY_KEY`] || undefined;
    base.editor ??= env[`${ENV_PREFIX}_SOURCE_OVERLAY_EDITOR`] || undefined;
    base.throttleMs ??= envNum(env[`${ENV_PREFIX}_SOURCE_OVERLAY_THROTTLE_MS`]);
    sourceOverlay = base;
  }

  const timeline =
    options.timeline ?? envBool(env[`${ENV_PREFIX}_TIMELINE`]) ?? false;

  const cssSheetBuild =
    envEnum(options.cssSheetBuild, CSS_SHEET_BUILD_MODES, 'cssSheetBuild') ??
    envEnum(
      env[`${ENV_PREFIX}_CSS_SHEET_BUILD`],
      CSS_SHEET_BUILD_MODES,
      `${ENV_PREFIX}_CSS_SHEET_BUILD`
    ) ??
    'auto';

  return {
    hmrEnabled,
    reconnect,
    onIncompatible,
    indicator,
    sourceOverlay,
    timeline,
    cssSheetBuild,
  };
};

/**
 * Flattens resolved options into the JSON-serializable shape the panel's
 * Settings tab consumes (callback options like `exclude`/`onSelect` dropped;
 * a custom editor object reported as `"custom"`). Default key/editor/throttle
 * are applied here so the panel shows the effective values the runtime uses.
 */
export const toFeatureSettings = (r: ResolvedOptions): FeatureSettings => {
  const so = r.sourceOverlay;
  const editor = so === false ? undefined : so.editor;
  return {
    hmr: {
      enabled: r.hmrEnabled,
      reconnect: r.reconnect,
      onIncompatible: r.onIncompatible,
      indicatorEnabled: r.indicator !== false,
      indicatorCount: r.indicator !== false && r.indicator.count,
    },
    sourceOverlay: {
      enabled: so !== false,
      key: (so === false ? undefined : so.key) ?? 's',
      editor:
        typeof editor === 'string' ? editor : editor ? 'custom' : 'vscode',
      throttleMs: (so === false ? undefined : so.throttleMs) ?? 50,
    },
    timeline: r.timeline,
  };
};
