/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {EditorConfig} from '../../types.js';

export const BUILTIN_EDITORS: Record<string, EditorConfig> = {
  vscode: {
    name: 'VS Code',
    url: (path, line) => `vscode://file/${path}:${line}`,
  },
  cursor: {
    name: 'Cursor',
    url: (path, line) => `cursor://file/${path}:${line}`,
  },
  zed: {
    name: 'Zed',
    url: (path, line) => `zed://file/${path}:${line}`,
  },
  idea: {
    name: 'IntelliJ',
    url: (path, line) =>
      `idea://open?file=${encodeURIComponent(path)}&line=${line}`,
  },
  windsurf: {
    name: 'Windsurf',
    url: (path, line) => `windsurf://file/${path}:${line}`,
  },
};

// Resolve an editor option to a config: a builtin name, a custom config, or the
// VS Code default (also used as the fallback for an unknown name).
export const resolveEditor = (
  editor: EditorConfig | string | undefined
): EditorConfig => {
  if (editor === undefined) return BUILTIN_EDITORS.vscode;
  if (typeof editor === 'string') {
    return BUILTIN_EDITORS[editor] ?? BUILTIN_EDITORS.vscode;
  }
  return editor;
};
