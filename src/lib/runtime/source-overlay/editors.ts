import type {EditorConfig} from '../../types.js';

// `<scheme>://file/` already ends in the slash that starts a POSIX path, so a
// second one would put `//Users/...` in the URL path, which VS Code-family
// editors only resolve by accident. Drop exactly one: Windows drive paths have
// none to drop, and a UNC `//server/share` keeps the double slash it needs.
const filePath = (path: string) =>
  path.startsWith('/') ? path.slice(1) : path;

// `:<column>` suffix for the editors that take `file:line:column`.
const col = (column?: number) => (column === undefined ? '' : `:${column}`);

// Keep the keys/labels in sync with SOURCE_OVERLAY_EDITORS in
// src/types/timeline.ts (the panel's editor-selection options).
export const BUILTIN_EDITORS: Record<string, EditorConfig> = {
  vscode: {
    name: 'VS Code',
    url: (path, line, column) =>
      `vscode://file/${filePath(path)}:${line}${col(column)}`,
  },
  cursor: {
    name: 'Cursor',
    url: (path, line, column) =>
      `cursor://file/${filePath(path)}:${line}${col(column)}`,
  },
  zed: {
    name: 'Zed',
    url: (path, line, column) =>
      `zed://file/${filePath(path)}:${line}${col(column)}`,
  },
  idea: {
    name: 'IntelliJ',
    url: (path, line, column) =>
      `idea://open?file=${encodeURIComponent(path)}&line=${line}${
        column === undefined ? '' : `&column=${column}`
      }`,
  },
  windsurf: {
    name: 'Windsurf',
    url: (path, line, column) =>
      `windsurf://file/${filePath(path)}:${line}${col(column)}`,
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
