/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

export interface ElementInfo {
  tagName: string;
  componentName?: string;
  source: {
    filePath: string;
    lineNumber: number;
  };
}

export interface EditorConfig {
  name: string;
  url: (path: string, line: number) => string;
}

export interface SourceOverlayOptions {
  /**
   * Hotkey letter with Ctrl+Shift (default `s` -> Ctrl+Shift+S).
   */
  key?: string;

  /** Built-in editor key or custom `{ name, url }`. Defaults to `vscode`. */
  editor?: EditorConfig | string;

  /** Optional workspace root prefix for absolute file paths. */
  workspaceRoot?: string;

  /** Mouse move throttle in ms (default 50). */
  throttleMs?: number;

  /** Filter elements to skip during inspection. */
  exclude?: (el: Element) => boolean;

  /** Callback fired when the user clicks a component. */
  onSelect?: (info: ElementInfo) => void;
}
