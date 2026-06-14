/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {ElementInfo, EditorConfig} from '../../types.js';
import {BUILTIN_EDITORS, resolveEditor} from './editors.js';
import {
  defaultResolver,
  findSourceAtPoint,
  findSourceHost,
  type ElementResolver,
} from './source-host.js';
import {buildSpotlightClipPath} from './mask-path.js';
import {OVERLAY_HTML} from './template.js';
import {observeEdgeInsets} from '../edge-panel.js';
import {subscribeOverride} from '../overrides.js';
import {SOURCE_OVERLAY_TOGGLE_CHANNEL} from '../../../types/timeline.js';
import {idOf} from '../timeline/identity.js';
import {
  INSPECT_OVERLAY_TOGGLE_CHANNEL,
  INSPECT_DATA_CHANNEL,
} from '../../../types/inspector.js';

export interface SourceOverlayInitOptions {
  key?: string;
  /**
   * Hotkey letter (combined with Ctrl+Shift) for the "inspect in panel" mode,
   * which selects the picked element in the DevTools Components tab instead of
   * opening it in the editor. Defaults to `'e'`.
   */
  inspectKey?: string;
  editor?: EditorConfig | string;
  workspaceRoot?: string;
  throttleMs?: number;
  exclude?: (el: Element) => boolean;
  onSelect?: (info: ElementInfo) => void;
  openInEditorPath?: string;
}

/**
 * What a deliberate pick does: `'editor'` opens the source file (the original
 * behaviour); `'inspect'` reports the element to the DevTools panel so it can
 * select it in the Components tree.
 */
type OverlayMode = 'editor' | 'inspect';

class LitSourceOverlay extends HTMLElement {
  #active = false;
  #mode: OverlayMode = 'editor';
  #hot: {send: (event: string, data: unknown) => void} | undefined;
  #options: SourceOverlayInitOptions = {};
  #editor: EditorConfig = BUILTIN_EDITORS.vscode;
  #resolver: ElementResolver = defaultResolver;
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
  #cursorStyle: HTMLStyleElement | null = null;
  // Whether the Vite HMR WebSocket is currently connected. Used to suppress the
  // editor-URL-scheme fallback once the dev server is gone — otherwise a failed
  // open-in-editor fetch would navigate the tab to `vscode://…`.
  #connected = true;
  #lastMouseX = 0;
  #lastMouseY = 0;
  #edgeDispose: (() => void) | undefined;
  #overrideSubscribed = false;

  constructor() {
    super();
    const root = this.attachShadow({mode: 'closed'});
    root.innerHTML = OVERLAY_HTML;
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
    const hot = (
      import.meta as {
        hot?: {
          on: (event: string, cb: (data?: unknown) => void) => void;
          send: (event: string, data: unknown) => void;
        };
      }
    ).hot;
    this.#hot = hot;
    hot?.on('vite:beforeFullReload', () => this.deactivate());
    hot?.on('vite:ws:disconnect', () => (this.#connected = false));
    hot?.on('vite:ws:connect', () => (this.#connected = true));
    // Toggle from the Vite DevTools command/shortcut (handler runs server-side).
    hot?.on(SOURCE_OVERLAY_TOGGLE_CHANNEL, () => this.toggle('editor'));
    // The "inspect in panel" command toggles the same picker in inspect mode.
    hot?.on(INSPECT_OVERLAY_TOGGLE_CHANNEL, () => this.toggle('inspect'));
    // Keep the (bottom-fixed) tooltip clear of the Vite DevTools edge panel.
    this.#edgeDispose = observeEdgeInsets((insets) => {
      this.style.setProperty('--edge-bottom', `${insets.bottom}px`);
    });
    // Apply the panel's editor override live (and on load). Merge so other
    // configured options (key, throttle, …) survive.
    if (!this.#overrideSubscribed) {
      this.#overrideSubscribed = true;
      subscribeOverride(hot, (o) => {
        if (o.sourceOverlayEditor !== undefined) {
          this.#options = {...this.#options, editor: o.sourceOverlayEditor};
          this.#editor = resolveEditor(o.sourceOverlayEditor);
        }
      });
    }
  }

  disconnectedCallback() {
    document.removeEventListener('mousemove', this.#onTrackMouse, true);
    document.removeEventListener('keydown', this.#onKeyDown, true);
    this.deactivate();
    this.#edgeDispose?.();
    this.#edgeDispose = undefined;
  }

  configure(options: SourceOverlayInitOptions) {
    this.#options = options;
    this.#editor = resolveEditor(options.editor);
  }

  activate(mode: OverlayMode = 'editor') {
    if (this.#active) {
      // Already inspecting — just switch what a pick will do.
      this.#mode = mode;
      return;
    }
    this.#mode = mode;
    this.#active = true;
    this.#dialog.showModal();
    this.#mask.style.background = 'rgba(0,0,0,0.35)';
    // The overlay is pointer-events:none, so the cursor reflects the hovered
    // page element. Force a crosshair while inspecting. The closed shadow DOM
    // tooltip is unaffected, so its buttons keep their own pointer cursor.
    if (this.#cursorStyle === null) {
      this.#cursorStyle = document.createElement('style');
      this.#cursorStyle.textContent = '*{cursor:crosshair !important}';
    }
    document.head.append(this.#cursorStyle);
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
    this.#cursorStyle?.remove();
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

  toggle(mode: OverlayMode = 'editor') {
    // Re-pressing the active mode's shortcut closes; pressing the other mode's
    // shortcut while open switches modes instead of closing.
    if (this.#active && this.#mode === mode) this.deactivate();
    else this.activate(mode);
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
    // Skip the URL-scheme fallback when the dev server is gone: a fetch failure
    // there means "server quit", not "no endpoint", and navigating the tab to
    // `vscode://…` on shutdown is jarring and unwanted.
    if (!this.#connected) return;
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
    this.#mask.style.clipPath = buildSpotlightClipPath(
      rect.left - r,
      rect.top - r,
      rect.width + 2 * r,
      rect.height + 2 * r,
      r
    );
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
    if (event.ctrlKey && event.shiftKey && !event.altKey) {
      const pressed = event.key.toLowerCase();
      const editorKey = (this.#options.key ?? 's').toLowerCase();
      const inspectKey = (this.#options.inspectKey ?? 'e').toLowerCase();
      if (pressed === editorKey) {
        event.preventDefault();
        this.toggle('editor');
      } else if (pressed === inspectKey) {
        event.preventDefault();
        this.toggle('inspect');
      }
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
    const mode = this.#mode;
    const target = this.#targetEl;
    // Cancel the whole selection mode on any deliberate pick, before acting —
    // the editor may open via a URL scheme that doesn't navigate this tab away,
    // so we can't rely on the open outcome to dismiss the inspector.
    this.deactivate();
    this.#options.onSelect?.(info);
    if (mode === 'inspect') {
      // Report the picked element to the DevTools panel, which selects it in the
      // Components tree. Identity matches the inspector runtime via idOf().
      if (target !== null) {
        this.#hot?.send(INSPECT_DATA_CHANNEL, {type: 'pick', id: idOf(target)});
      }
      return;
    }
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
