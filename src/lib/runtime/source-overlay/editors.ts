import type {EditorConfig} from '../../types.js';

// `<scheme>://file/` already ends in the slash that starts a POSIX path, so a
// second one would put `//Users/...` in the URL path, which VS Code-family
// editors only resolve by accident. Drop exactly one: Windows drive paths have
// none to drop, and a UNC `//server/share` keeps the double slash it needs.
const filePath = (path: string) =>
  path.startsWith('/') ? path.slice(1) : path;

// Keep the keys/labels in sync with SOURCE_OVERLAY_EDITORS in
// src/types/timeline.ts (the panel's editor-selection options).
export const BUILTIN_EDITORS: Record<string, EditorConfig> = {
  vscode: {
    name: 'VS Code',
    url: (path, line) => `vscode://file/${filePath(path)}:${line}`,
  },
  cursor: {
    name: 'Cursor',
    url: (path, line) => `cursor://file/${filePath(path)}:${line}`,
  },
  zed: {
    name: 'Zed',
    url: (path, line) => `zed://file/${filePath(path)}:${line}`,
  },
  idea: {
    name: 'IntelliJ',
    url: (path, line) =>
      `idea://open?file=${encodeURIComponent(path)}&line=${line}`,
  },
  windsurf: {
    name: 'Windsurf',
    url: (path, line) => `windsurf://file/${filePath(path)}:${line}`,
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
