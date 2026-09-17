/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Ambient types for the import queries provided by the Lit Vite plugin.
 *
 * Reference via tsconfig (`"types": ["@oddsquad/vite-plugin-lit/client"]`) or
 * `/// <reference types="@oddsquad/vite-plugin-lit/client" />`.
 */

declare module '*.css?hmr-url' {
  const href: string;
  export default href;
}

declare module '*.css?css-sheet' {
  const sheet: CSSStyleSheet;
  export default sheet;
}

declare module 'virtual:lit-plugin/timeline' {
  export interface TimelineLayer {
    id: string;
    label: string;
    /** 0xRRGGBB */
    color: number;
  }

  export interface TimelineEvent<TData = unknown> {
    layerId: string;
    /** Milliseconds since the current recording started. */
    time: number;
    data: TData;
    title?: string;
    subtitle?: string;
    /** Pairs a start event with its matching end event in the same update group. */
    groupId?: number | string;
    logType?: 'default' | 'warning' | 'error';
    /** Set by the plugin's built-in capture layers; not needed for custom events. */
    meta?: {
      elementId?: number;
      tagName?: string;
      source?: {file: string; line: number};
    };
  }

  /**
   * Emit a custom timeline event from app code. No-ops in production or
   * when the `timeline` option is disabled.
   */
  export function addTimelineEvent(event: TimelineEvent): void;

  /**
   * Register a custom timeline layer and announce it to the panel.
   * Idempotent — duplicate ids are ignored.
   */
  export function addTimelineLayer(layer: TimelineLayer): void;
}
