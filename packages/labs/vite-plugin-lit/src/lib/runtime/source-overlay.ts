/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {SOURCE_META_KEY, type LitSourceMeta} from './source-meta.js';
import type {ElementInfo, EditorConfig} from '../types.js';

interface SourceOverlayInitOptions {
  key?: string;
  editor?: EditorConfig | string;
  workspaceRoot?: string;
  throttleMs?: number;
  exclude?: (el: Element) => boolean;
  onSelect?: (info: ElementInfo) => void;
  openInEditorPath?: string;
}

const BUILTIN_EDITORS: Record<string, EditorConfig> = {
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

const defaultResolver: {
  resolveElementInfo(el: Element): Promise<ElementInfo | null>;
} = {
  async resolveElementInfo(el) {
    const host = findSourceHost(el);
    if (host === null) return null;
    const ctor = host.constructor as CustomElementConstructor & {
      [SOURCE_META_KEY]?: LitSourceMeta;
    };
    const meta = ctor[SOURCE_META_KEY];
    if (meta === undefined) return null;
    return {
      tagName: host.tagName.toLowerCase(),
      componentName: meta.componentName,
      source: {
        filePath: meta.filePath,
        lineNumber: meta.lineNumber,
      },
    };
  },
};

const findSourceHost = (el: Element): Element | null => {
  let current: Element | null = el;
  while (current !== null) {
    const ctor = current.constructor as CustomElementConstructor & {
      [SOURCE_META_KEY]?: LitSourceMeta;
    };
    if (ctor[SOURCE_META_KEY] !== undefined) {
      return current;
    }
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      current = root.host;
      continue;
    }
    current = current.parentElement;
  }
  return null;
};

const deepElementFromPoint = (x: number, y: number): Element | null => {
  if (dialogEl !== null) {
    dialogEl.close();
  }
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot !== undefined && el.shadowRoot !== null) {
    const deeper = el.shadowRoot.elementFromPoint(x, y);
    if (deeper === null || deeper === el) break;
    el = deeper;
  }
  if (dialogEl !== null && !dialogEl.open) {
    dialogEl.showModal();
  }
  return el;
};

let overlayRoot: HTMLElement | null = null;
let highlightEl: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null;
let dialogEl: HTMLDialogElement | null = null;
let active = false;
let info: ElementInfo | null = null;
let targetEl: Element | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | undefined;
let resizeObserver: ResizeObserver | undefined;
let lastMouseX = 0;
let lastMouseY = 0;
let options: SourceOverlayInitOptions = {};
let resolver = defaultResolver;
let editor: EditorConfig = BUILTIN_EDITORS.vscode;

const normalizePath = (filePath: string): string => {
  const root = options.workspaceRoot;
  if (root !== undefined && filePath.startsWith(root)) {
    return filePath;
  }
  return filePath;
};

const openInEditor = async (filePath: string, lineNumber: number) => {
  const path = normalizePath(filePath);
  const endpoint = options.openInEditorPath ?? '/__lit-open-in-editor';
  try {
    const params = new URLSearchParams({file: path, line: String(lineNumber)});
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (res.ok) return;
  } catch {
    // Fall back to editor URL schemes (e.g. StackBlitz previews).
  }
  window.open(editor.url(path, lineNumber), '_self');
};

const updateHighlightRect = () => {
  if (highlightEl === null || targetEl === null) return;
  const rect = targetEl.getBoundingClientRect();
  highlightEl.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  highlightEl.style.width = `${rect.width}px`;
  highlightEl.style.height = `${rect.height}px`;
};

const updateTooltip = (x: number, y: number) => {
  if (tooltipEl === null || info === null) return;
  const label = `${info.source.filePath}:${info.source.lineNumber}`;
  const textEl = tooltipEl.querySelector('.lit-source-overlay-path');
  if (textEl !== null) {
    textEl.textContent = label;
  }
  tooltipEl.style.display = 'block';
  const offset = 14;
  const tooltipRect = tooltipEl.getBoundingClientRect();
  let left = x + offset;
  let top = y + offset;
  if (left + tooltipRect.width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - tooltipRect.width - 8);
  }
  if (top + tooltipRect.height > window.innerHeight - 8) {
    top = Math.max(8, y - tooltipRect.height - offset);
  }
  tooltipEl.style.transform = `translate(${left}px, ${top}px)`;
};

const clearTarget = () => {
  targetEl = null;
  info = null;
  if (highlightEl !== null) {
    highlightEl.style.width = '0';
    highlightEl.style.height = '0';
  }
  if (tooltipEl !== null) {
    tooltipEl.style.display = 'none';
  }
  if (resizeObserver !== undefined) {
    resizeObserver.disconnect();
    resizeObserver = undefined;
  }
};

const shouldSkip = (el: Element): boolean => {
  if (
    overlayRoot !== null &&
    (el === overlayRoot || overlayRoot.contains(el))
  ) {
    return true;
  }
  if (el.tagName === 'IFRAME') return true;
  const exclude = options.exclude;
  return exclude !== undefined && exclude(el);
};

const resolveAt = async (x: number, y: number) => {
  lastMouseX = x;
  lastMouseY = y;
  const el = deepElementFromPoint(x, y);
  if (el === null || shouldSkip(el)) {
    clearTarget();
    return;
  }
  const host = findSourceHost(el);
  if (host === null) {
    clearTarget();
    return;
  }
  if (host === targetEl && info !== null) {
    updateHighlightRect();
    updateTooltip(x, y);
    return;
  }
  targetEl = host;
  if (resizeObserver === undefined) {
    resizeObserver = new ResizeObserver(() => updateHighlightRect());
  } else {
    resizeObserver.disconnect();
  }
  resizeObserver.observe(host);
  const resolved = await resolver.resolveElementInfo(el);
  if (resolved === null) {
    clearTarget();
    return;
  }
  info = resolved;
  updateHighlightRect();
  updateTooltip(x, y);
};

const onMouseMove = (event: MouseEvent) => {
  if (!active) return;
  const throttleMs = options.throttleMs ?? 50;
  if (throttleTimer !== undefined) return;
  throttleTimer = setTimeout(() => {
    throttleTimer = undefined;
    resolveAt(event.clientX, event.clientY);
  }, throttleMs);
};

const onClick = (event: MouseEvent) => {
  if (!active || info === null) return;
  event.preventDefault();
  event.stopPropagation();
  const selected = info;
  options.onSelect?.(selected);
  openInEditor(selected.source.filePath, selected.source.lineNumber);
};

let scrollTimer: ReturnType<typeof setTimeout> | undefined;

const onScrollOrResize = () => {
  if (scrollTimer !== undefined) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    scrollTimer = undefined;
    if (targetEl !== null) {
      updateHighlightRect();
      updateTooltip(lastMouseX, lastMouseY);
    }
  }, 50);
};

const onKeyDown = (event: KeyboardEvent) => {
  const key = options.key ?? 's';
  if (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === key.toLowerCase()
  ) {
    event.preventDefault();
    if (active) {
      deactivate();
    } else {
      activate();
    }
  }
  if (active && event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
  }
};

const ensureOverlayDom = () => {
  if (dialogEl !== null) return;
  dialogEl = document.createElement('dialog');
  dialogEl.id = 'lit-source-overlay-dialog';
  dialogEl.style.cssText =
    'background:transparent;border:none;padding:0;margin:0;max-width:none;max-height:none;pointer-events:none;';
  overlayRoot = dialogEl;

  highlightEl = document.createElement('div');
  highlightEl.className = 'lit-source-overlay-highlight';
  highlightEl.style.cssText =
    'position:fixed;top:0;left:0;pointer-events:none;box-sizing:border-box;border:2px solid rgba(124,196,245,0.7);background:rgba(124,196,245,0.08);z-index:1;';

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'lit-source-overlay-tooltip';
  tooltipEl.style.cssText =
    'position:fixed;top:0;left:0;display:none;pointer-events:auto;z-index:2;max-width:min(90vw,480px);padding:6px 8px;border-radius:6px;background:rgba(26,26,46,0.92);color:#e8e8f0;font:12px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.25);';

  const pathSpan = document.createElement('span');
  pathSpan.className = 'lit-source-overlay-path';
  pathSpan.style.cssText = 'word-break:break-all;';
  tooltipEl.append(pathSpan);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy file path';
  copyBtn.style.cssText =
    'margin-left:8px;padding:2px 6px;border:1px solid rgba(255,255,255,0.25);border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:inherit;';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (info === null) return;
    const text = `${info.source.filePath}:${info.source.lineNumber}`;
    navigator.clipboard?.writeText(text);
  });
  tooltipEl.append(copyBtn);

  dialogEl.append(highlightEl, tooltipEl);
  document.body.append(dialogEl);
  dialogEl.addEventListener('cancel', (e) => e.preventDefault());
  dialogEl.showModal();
};

const activate = () => {
  if (active) return;
  active = true;
  ensureOverlayDom();
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScrollOrResize, {passive: true});
  window.addEventListener('resize', onScrollOrResize, {passive: true});
  resolveAt(lastMouseX, lastMouseY);
};

const deactivate = () => {
  if (!active) return;
  active = false;
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  window.removeEventListener('scroll', onScrollOrResize);
  window.removeEventListener('resize', onScrollOrResize);
  if (throttleTimer !== undefined) {
    clearTimeout(throttleTimer);
    throttleTimer = undefined;
  }
  if (scrollTimer !== undefined) {
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
  }
  clearTarget();
};

const destroyOverlayDom = () => {
  if (dialogEl !== null) {
    dialogEl.close();
    dialogEl.remove();
    dialogEl = null;
  }
  overlayRoot = null;
  highlightEl = null;
  tooltipEl = null;
};

/**
 * Boots the Lit source overlay inspector (dev only).
 */
export const initSourceOverlay = (
  initOptions: SourceOverlayInitOptions = {}
) => {
  options = initOptions;
  resolver = defaultResolver;
  const editorOpt = initOptions.editor ?? 'vscode';
  editor =
    typeof editorOpt === 'string'
      ? (BUILTIN_EDITORS[editorOpt] ?? BUILTIN_EDITORS.vscode)
      : editorOpt;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener(
    'mousemove',
    (e) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    },
    true
  );
  if (typeof window !== 'undefined') {
    (
      import.meta as {hot?: {on: (event: string, cb: () => void) => void}}
    ).hot?.on('vite:beforeFullReload', () => {
      deactivate();
      destroyOverlayDom();
    });
  }
};

export const toggleSourceOverlay = () => {
  if (active) {
    deactivate();
  } else {
    activate();
  }
};
