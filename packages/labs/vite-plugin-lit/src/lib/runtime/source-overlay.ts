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

// Pierce nested shadow roots to find the deepest element under the cursor.
// document.elementFromPoint retargets shadow content to the top-level host, so
// we descend through each shadowRoot to reach the innermost element.
const deepElementFromPoint = (x: number, y: number): Element | null => {
  let el = document.elementFromPoint(x, y);
  let deepest: Element | null = el;
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (inner === null || inner === el) break;
    deepest = inner;
    el = inner;
  }
  return deepest;
};

const findSourceAtPoint = (
  x: number,
  y: number,
  dialog: HTMLDialogElement | null = null
): Element | null => {
  if (dialog !== null) dialog.close();
  try {
    const deepest = deepElementFromPoint(x, y);
    if (deepest !== null) {
      const host = findSourceHost(deepest);
      if (host !== null) return host;
    }

    // Bounding-rect fallback for elements elementFromPoint misses — prefer the
    // deepest matching host so nested components still beat their ancestors.
    let best: Element | null = null;
    for (const el of document.querySelectorAll('*')) {
      const ctor = el.constructor as CustomElementConstructor & {
        [SOURCE_META_KEY]?: LitSourceMeta;
      };
      if (ctor[SOURCE_META_KEY] === undefined) continue;
      const rect = el.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        if (best === null || best.contains(el)) best = el;
      }
    }
    return best;
  } finally {
    if (dialog !== null && !dialog.open) dialog.showModal();
  }
};

class LitSourceOverlay extends HTMLElement {
  #active = false;
  #options: SourceOverlayInitOptions = {};
  #editor: EditorConfig = BUILTIN_EDITORS.vscode;
  #resolver = defaultResolver;
  #dialog: HTMLDialogElement;
  #mask: HTMLElement;
  #highlight: HTMLElement;
  #tooltip: HTMLElement;
  #tag: HTMLElement;
  #path: HTMLElement;
  #info: ElementInfo | null = null;
  #targetEl: Element | null = null;
  #throttleTimer: ReturnType<typeof setTimeout> | undefined;
  #scrollTimer: ReturnType<typeof setTimeout> | undefined;
  #resizeObserver: ResizeObserver | undefined;
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
        #mask {
          position: fixed;
          inset: 0;
          pointer-events: none;
          background: rgba(0,0,0,0);
          transition: background-color 0.3s cubic-bezier(0.9, 0, 0.1, 1);
        }
        #highlight {
          position: fixed;
          top: 0;
          left: 0;
          pointer-events: none;
          box-sizing: border-box;

          border-radius: var(--lit-devtools-radius, 6px);
        }
        #tooltip {
          position: fixed;
          bottom: 16px;
          left: 50%;
          translate: -50%;
          display: none;
          align-items: stretch;
          pointer-events: auto;
          max-width: min(90vw, 480px);
          border-radius: var(--lit-devtools-radius, 6px);
          background: rgba(26,26,46,0.92);
          color: #e8e8f0;
          font: 12px/1.4 system-ui, sans-serif;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
          overflow: hidden;
        }
        .icon-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          padding: 0 12px;
          border: none;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.1); }
        .icon-btn svg {
          width: 16px;
          height: 16px;
          display: block;
          fill: currentColor;
        }
        #meta {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 1px;
          min-width: 0;
          padding: 6px 10px;
          border-left: 1px solid rgba(255,255,255,0.14);
          border-right: 1px solid rgba(255,255,255,0.14);
        }
        #tag {
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #path {
          color: rgba(232,232,240,0.6);
          font-size: 11px;
          word-break: break-all;
        }
      </style>
      <dialog id="overlay">
        <div id="mask"></div>
        <div id="highlight"></div>
        <div id="tooltip">
          <button
            id="open"
            class="icon-btn"
            type="button"
            title="Open in editor"
            aria-label="Open in editor"
          >
            <svg viewBox="0 0 256 256" aria-hidden="true">
              <path d="M69.12,94.15,28.5,128l40.62,33.85a8,8,0,1,1-10.24,12.29l-48-40a8,8,0,0,1,0-12.29l48-40a8,8,0,0,1,10.24,12.3Zm176,27.7-48-40a8,8,0,1,0-10.24,12.3L227.5,128l-40.62,33.85a8,8,0,1,0,10.24,12.29l48-40a8,8,0,0,0,0-12.29ZM162.73,32.48a8,8,0,0,0-10.25,4.79l-64,176a8,8,0,0,0,4.79,10.26A8.14,8.14,0,0,0,96,224a8,8,0,0,0,7.52-5.27l64-176A8,8,0,0,0,162.73,32.48Z"></path>
            </svg>
          </button>
          <div id="meta">
            <span id="tag"></span>
            <span id="path"></span>
          </div>
          <button
            id="copy"
            class="icon-btn"
            type="button"
            title="Copy path"
            aria-label="Copy path"
          >
            <svg viewBox="0 0 256 256" aria-hidden="true">
              <path d="M184,64H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H184a8,8,0,0,0,8-8V72A8,8,0,0,0,184,64Zm-8,144H48V80H176ZM224,40V184a8,8,0,0,1-16,0V48H72a8,8,0,0,1,0-16H216A8,8,0,0,1,224,40Z"></path>
            </svg>
          </button>
        </div>
      </dialog>
    `;
    this.#dialog = root.getElementById('overlay') as HTMLDialogElement;
    this.#mask = root.getElementById('mask')!;
    this.#highlight = root.getElementById('highlight')!;
    this.#tooltip = root.getElementById('tooltip')!;
    this.#tag = root.getElementById('tag')!;
    this.#path = root.getElementById('path')!;
    root.getElementById('open')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.#info !== null) this.#select(this.#info);
    });
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
    this.#mask.style.background = 'rgba(0,0,0,0.35)';
    document.addEventListener('mousemove', this.#onMouseMove, true);
    document.addEventListener('click', this.#onClick, true);
    window.addEventListener('scroll', this.#onScrollOrResize, {passive: true});
    window.addEventListener('resize', this.#onScrollOrResize, {passive: true});
    this.#resolveAt(this.#lastMouseX, this.#lastMouseY);
  }

  deactivate() {
    if (!this.#active) return;
    this.#active = false;
    this.#dialog.close();
    this.#mask.style.background = 'rgba(0,0,0,0)';
    document.removeEventListener('mousemove', this.#onMouseMove, true);
    document.removeEventListener('click', this.#onClick, true);
    window.removeEventListener('scroll', this.#onScrollOrResize);
    window.removeEventListener('resize', this.#onScrollOrResize);
    if (this.#throttleTimer !== undefined) {
      clearTimeout(this.#throttleTimer);
      this.#throttleTimer = undefined;
    }
    if (this.#scrollTimer !== undefined) {
      clearTimeout(this.#scrollTimer);
      this.#scrollTimer = undefined;
    }
    this.#clearTarget();
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

  #updateHighlightRect() {
    if (this.#targetEl === null) return;
    const rect = this.#targetEl.getBoundingClientRect();
    const raw = getComputedStyle(this)
      .getPropertyValue('--lit-devtools-radius')
      .trim();
    const r = parseFloat(raw) || 6;
    this.#highlight.style.left = `${rect.left - r}px`;
    this.#highlight.style.top = `${rect.top - r}px`;
    this.#highlight.style.width = `${rect.width + 2 * r}px`;
    this.#highlight.style.height = `${rect.height + 2 * r}px`;
    this.#updateMask(
      rect.left - r,
      rect.top - r,
      rect.width + 2 * r,
      rect.height + 2 * r,
      r
    );
  }

  #updateMask(l: number, t: number, w: number, h: number, r: number) {
    r = Math.min(r, w / 2, h / 2);
    // Outer rect (clockwise) + inner rounded rect (counterclockwise) = nonzero fill punches a hole.
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
    this.#mask.style.clipPath = `path('${outer} ${inner}')`;
  }

  #showTooltip() {
    if (this.#info === null) return;
    this.#tag.textContent = `<${this.#info.tagName}>`;
    this.#path.textContent = `${this.#info.source.filePath}:${this.#info.source.lineNumber}`;
    this.#tooltip.style.display = 'flex';
  }

  #clearTarget() {
    this.#targetEl = null;
    this.#info = null;
    this.#highlight.style.left = '0';
    this.#highlight.style.top = '0';
    this.#highlight.style.width = '0';
    this.#highlight.style.height = '0';
    this.#mask.style.clipPath = 'none';
    this.#tooltip.style.display = 'none';
    if (this.#resizeObserver !== undefined) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = undefined;
    }
  }

  #shouldSkip(el: Element): boolean {
    if (el === this.#dialog || this.#dialog.contains(el)) return true;
    if (el.tagName === 'IFRAME') return true;
    // Never target devtools' own injected elements (indicator, overlay).
    const tag = el.tagName.toLowerCase();
    if (tag === 'lit-source-overlay' || tag.startsWith('lit-devtools-')) {
      return true;
    }
    const exclude = this.#options.exclude;
    return exclude !== undefined && exclude(el);
  }

  async #resolveAt(x: number, y: number) {
    this.#lastMouseX = x;
    this.#lastMouseY = y;
    const el = findSourceAtPoint(x, y, this.#dialog);
    if (el === null || this.#shouldSkip(el)) {
      this.#clearTarget();
      return;
    }
    const host = findSourceHost(el);
    if (host === null) {
      this.#clearTarget();
      return;
    }
    if (host === this.#targetEl && this.#info !== null) {
      this.#updateHighlightRect();
      return;
    }
    this.#targetEl = host;
    if (this.#resizeObserver === undefined) {
      this.#resizeObserver = new ResizeObserver(() =>
        this.#updateHighlightRect()
      );
    } else {
      this.#resizeObserver.disconnect();
    }
    this.#resizeObserver.observe(host);
    const resolved = await this.#resolver.resolveElementInfo(el);
    if (resolved === null) {
      this.#clearTarget();
      return;
    }
    this.#info = resolved;
    this.#updateHighlightRect();
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
    // Keep the current selection while hovering the tooltip so its buttons stay
    // clickable — the tooltip isn't a source element, so re-resolving here would
    // clear the target and hide the panel out from under the pointer.
    if (this.#pointInTooltip(event.clientX, event.clientY)) return;
    const throttleMs = this.#options.throttleMs ?? 50;
    if (this.#throttleTimer !== undefined) return;
    this.#throttleTimer = setTimeout(() => {
      this.#throttleTimer = undefined;
      this.#resolveAt(event.clientX, event.clientY);
    }, throttleMs);
  };

  #select(info: ElementInfo) {
    // Cancel the whole selection mode on any deliberate pick, before opening —
    // the editor may open via a URL scheme that doesn't navigate this tab away,
    // so we can't rely on the open outcome to dismiss the inspector.
    this.deactivate();
    this.#options.onSelect?.(info);
    this.#openInEditor(info.source.filePath, info.source.lineNumber);
  }

  #pointInTooltip(x: number, y: number): boolean {
    if (this.#tooltip.style.display === 'none') return false;
    const r = this.#tooltip.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  #onClick = (event: MouseEvent) => {
    if (!this.#active || this.#info === null) return;
    // Clicks on the tooltip panel are handled by its own buttons (open/copy).
    // The overlay's shadow root is closed, so we detect this by hit-rect rather
    // than inspecting the event path, and let the event reach those buttons.
    if (this.#pointInTooltip(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    this.#select(this.#info);
  };

  #onScrollOrResize = () => {
    if (this.#scrollTimer !== undefined) clearTimeout(this.#scrollTimer);
    this.#scrollTimer = setTimeout(() => {
      this.#scrollTimer = undefined;
      if (this.#targetEl !== null) {
        this.#updateHighlightRect();
      }
    }, 50);
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
