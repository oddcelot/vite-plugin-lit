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

const deepElementFromPoint = (
  x: number,
  y: number,
  dialog: HTMLDialogElement | null = null
): Element | null => {
  if (dialog !== null) dialog.close();
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot !== undefined && el?.shadowRoot !== null) {
    const deeper = el.shadowRoot.elementFromPoint(x, y);
    if (deeper === null || deeper === el) break;
    el = deeper;
  }
  if (dialog !== null && !dialog.open) dialog.showModal();
  return el;
};

class LitSourceOverlay extends HTMLElement {
  #active = false;
  #options: SourceOverlayInitOptions = {};
  #editor: EditorConfig = BUILTIN_EDITORS.vscode;
  #resolver = defaultResolver;
  #dialog: HTMLDialogElement;
  #tooltip: HTMLElement;
  #path: HTMLElement;
  #info: ElementInfo | null = null;
  #targetEl: Element | null = null;
  #throttleTimer: ReturnType<typeof setTimeout> | undefined;
  #lastMouseX = 0;
  #lastMouseY = 0;

  constructor() {
    super();
    const root = this.attachShadow({mode: 'closed'});
    root.innerHTML = `
      <style>
        dialog {
          background: transparent;
          border: none;
          padding: 0;
          margin: 0;
          max-width: none;
          max-height: none;
          pointer-events: none;
        }
        #tooltip {
          position: fixed;
          bottom: 16px;
          left: 50%;
          translate: -50%;
          display: none;
          pointer-events: auto;
          max-width: min(90vw, 480px);
          padding: 6px 8px;
          border-radius: 6px;
          background: rgba(26,26,46,0.92);
          color: #e8e8f0;
          font: 12px/1.4 system-ui, sans-serif;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        }
        #path { word-break: break-all; }
        #copy {
          margin-left: 8px;
          padding: 2px 6px;
          border: 1px solid rgba(255,255,255,0.25);
          border-radius: 4px;
          background: transparent;
          color: inherit;
          cursor: pointer;
          font: inherit;
        }
      </style>
      <dialog id="overlay">
        <div id="tooltip">
          <span id="path"></span>
          <button id="copy">Copy</button>
        </div>
      </dialog>
    `;
    this.#dialog = root.getElementById('overlay') as HTMLDialogElement;
    this.#tooltip = root.getElementById('tooltip')!;
    this.#path = root.getElementById('path')!;
    root.getElementById('copy')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.#info === null) return;
      const text = `${this.#info.source.filePath}:${this.#info.source.lineNumber}`;
      navigator.clipboard?.writeText(text);
    });
    this.#dialog.addEventListener('cancel', (e) => e.preventDefault());
  }

  connectedCallback() {
    document.addEventListener('mousemove', this.#onTrackMouse, true);
    document.addEventListener('keydown', this.#onKeyDown, true);
    (
      import.meta as {hot?: {on: (event: string, cb: () => void) => void}}
    ).hot?.on('vite:beforeFullReload', () => this.deactivate());
  }

  disconnectedCallback() {
    document.removeEventListener('mousemove', this.#onTrackMouse, true);
    document.removeEventListener('keydown', this.#onKeyDown, true);
    this.deactivate();
  }

  configure(options: SourceOverlayInitOptions) {
    this.#options = options;
    const editorOpt = options.editor ?? 'vscode';
    this.#editor =
      typeof editorOpt === 'string'
        ? (BUILTIN_EDITORS[editorOpt] ?? BUILTIN_EDITORS.vscode)
        : editorOpt;
  }

  activate() {
    if (this.#active) return;
    this.#active = true;
    this.#dialog.showModal();
    document.addEventListener('mousemove', this.#onMouseMove, true);
    document.addEventListener('click', this.#onClick, true);
    this.#resolveAt(this.#lastMouseX, this.#lastMouseY);
  }

  deactivate() {
    if (!this.#active) return;
    this.#active = false;
    this.#dialog.close();
    document.removeEventListener('mousemove', this.#onMouseMove, true);
    document.removeEventListener('click', this.#onClick, true);
    if (this.#throttleTimer !== undefined) {
      clearTimeout(this.#throttleTimer);
      this.#throttleTimer = undefined;
    }
    this.#hideTooltip();
  }

  toggle() {
    if (this.#active) this.deactivate();
    else this.activate();
  }

  #normalizePath(filePath: string): string {
    const root = this.#options.workspaceRoot;
    if (root !== undefined && filePath.startsWith(root)) return filePath;
    return filePath;
  }

  async #openInEditor(filePath: string, lineNumber: number) {
    const path = this.#normalizePath(filePath);
    const endpoint = this.#options.openInEditorPath ?? '/__lit-open-in-editor';
    try {
      const params = new URLSearchParams({
        file: path,
        line: String(lineNumber),
      });
      const res = await fetch(`${endpoint}?${params.toString()}`);
      if (res.ok) return;
    } catch {
      // Fall back to editor URL schemes (e.g. StackBlitz previews).
    }
    window.open(this.#editor.url(path, lineNumber), '_self');
  }

  #showTooltip() {
    if (this.#info === null) return;
    const label = `${this.#info.source.filePath}:${this.#info.source.lineNumber}`;
    this.#path.textContent = label;
    this.#tooltip.style.display = 'block';
  }

  #hideTooltip() {
    this.#targetEl = null;
    this.#info = null;
    this.#tooltip.style.display = 'none';
  }

  #shouldSkip(el: Element): boolean {
    if (el === this.#dialog || this.#dialog.contains(el)) return true;
    if (el.tagName === 'IFRAME') return true;
    const exclude = this.#options.exclude;
    return exclude !== undefined && exclude(el);
  }

  async #resolveAt(x: number, y: number) {
    this.#lastMouseX = x;
    this.#lastMouseY = y;
    const el = deepElementFromPoint(x, y, this.#dialog);
    if (el === null || this.#shouldSkip(el)) {
      this.#hideTooltip();
      return;
    }
    const host = findSourceHost(el);
    if (host === null) {
      this.#hideTooltip();
      return;
    }
    if (host === this.#targetEl && this.#info !== null) return;
    this.#targetEl = host;
    const resolved = await this.#resolver.resolveElementInfo(el);
    if (resolved === null) {
      this.#hideTooltip();
      return;
    }
    this.#info = resolved;
    this.#showTooltip();
  }

  #onTrackMouse = (event: MouseEvent) => {
    this.#lastMouseX = event.clientX;
    this.#lastMouseY = event.clientY;
  };

  #onKeyDown = (event: KeyboardEvent) => {
    const key = this.#options.key ?? 's';
    if (
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === key.toLowerCase()
    ) {
      event.preventDefault();
      this.toggle();
    }
    if (this.#active && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  #onMouseMove = (event: MouseEvent) => {
    if (!this.#active) return;
    const throttleMs = this.#options.throttleMs ?? 50;
    if (this.#throttleTimer !== undefined) return;
    this.#throttleTimer = setTimeout(() => {
      this.#throttleTimer = undefined;
      this.#resolveAt(event.clientX, event.clientY);
    }, throttleMs);
  };

  #onClick = (event: MouseEvent) => {
    if (!this.#active || this.#info === null) return;
    event.preventDefault();
    event.stopPropagation();
    const selected = this.#info;
    this.#options.onSelect?.(selected);
    this.#openInEditor(selected.source.filePath, selected.source.lineNumber);
  };
}

customElements.define('lit-source-overlay', LitSourceOverlay);

export const initSourceOverlay = (
  initOptions: SourceOverlayInitOptions = {}
) => {
  if (typeof window === 'undefined') return;
  const el = document.createElement('lit-source-overlay') as LitSourceOverlay;
  el.configure(initOptions);
  document.body.append(el);
};

export const toggleSourceOverlay = () => {
  const el = document.querySelector(
    'lit-source-overlay'
  ) as LitSourceOverlay | null;
  el?.toggle();
};
