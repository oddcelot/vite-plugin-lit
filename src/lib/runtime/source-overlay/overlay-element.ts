import type {ElementInfo, EditorConfig} from '../../types.js';
import {BUILTIN_EDITORS, resolveEditor} from './editors.js';
import {
  findEnclosingHost,
  findSourceAtPoint,
  findSourceHost,
  hasSourceMeta,
  hostInfo,
  isAnyHost,
  type HostTest,
} from './source-host.js';
import {buildSpotlightClipPath} from './mask-path.js';
import {OVERLAY_HTML} from './template.js';
import {observeEdgeInsets} from '../edge-panel.js';
import {subscribeOverrideKeys} from '../overrides.js';
import {pageChannel} from '../page-channel.js';
import {PAGE_ID} from '../page-id.js';
import {injectTokens} from '../../tokens.js';
import {idOf} from '../timeline/identity.js';
import {
  INSPECT_OVERLAY_TOGGLE_CHANNEL,
  INSPECT_DATA_CHANNEL,
} from '../../../types/inspector.js';

export interface SourceOverlayInitOptions {
  key?: string;
  editor?: EditorConfig | string;
  workspaceRoot?: string;
  throttleMs?: number;
  exclude?: (el: Element) => boolean;
  onSelect?: (info: ElementInfo) => void;
  openInEditorPath?: string;
  /**
   * What can be picked. `source` (the default) is components the source-meta
   * transform stamped, which have a file to open. `lit` is any Lit element:
   * library ones such as `<wa-button>` too, and every one on a page with no
   * transform (`lit-devtools dev`). Stamped ones keep their source; the rest
   * pick into the panel with no source to show or open.
   */
  hosts?: 'source' | 'lit';
  /** Called with the picked element's id after the panel is told. */
  onPick?: (id: number) => void;
}

/** What the tooltip shows for the element under the pointer. */
type PickInfo = Omit<ElementInfo, 'source'> & {source?: ElementInfo['source']};

/** What a click opens in the editor; `false` only picks. */
type OpenIntent = false | 'source' | 'callSite';

/**
 * The place an `intent` click actually opens for `info`. Each falls back to
 * the other when the element lacks it, so a library element's Cmd+click
 * opens its call site. Undefined when there is nothing to open.
 */
const resolveOpen = (
  info: PickInfo,
  intent: OpenIntent
): 'source' | 'callSite' | undefined => {
  if (intent === false) return undefined;
  const other = intent === 'source' ? 'callSite' : 'source';
  if (info[intent] !== undefined) return intent;
  return info[other] === undefined ? undefined : other;
};

/** Cmd/Ctrl opens the declaration; adding Shift opens the call site. */
const intentOf = (event: MouseEvent | KeyboardEvent): OpenIntent =>
  event.metaKey || event.ctrlKey
    ? event.shiftKey
      ? 'callSite'
      : 'source'
    : false;

class LitSourceOverlay extends HTMLElement {
  #active = false;
  #options: SourceOverlayInitOptions = {};
  #editor: EditorConfig = BUILTIN_EDITORS.vscode;
  #isHost: HostTest = hasSourceMeta;
  #dialog: HTMLDialogElement;
  #mask: HTMLElement;
  #highlight: HTMLElement;
  #tooltip: HTMLElement;
  #tag: HTMLElement;
  #path: HTMLElement;
  #step: HTMLElement;
  #sourceRow: HTMLElement;
  #siteRow: HTMLElement;
  #siteText: HTMLElement;
  #info: PickInfo | null = null;
  // What a click would open with the modifiers currently held, so the tooltip
  // can light up that row before the click.
  #intent: OpenIntent = false;
  #targetEl: Element | null = null;
  // The host under the pointer, and the hosts stepped out of with ArrowUp,
  // innermost first. The target is the pointer host while the trail is empty.
  #pointerHost: Element | null = null;
  #trail: Element[] = [];
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
  #hotOff: (() => void) | undefined;

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
    this.#step = root.getElementById('step')!;
    this.#sourceRow = root.getElementById('source-row')!;
    this.#siteRow = root.getElementById('site-row')!;
    this.#siteText = root.getElementById('site-text')!;
    this.#dialog.addEventListener('cancel', (e) => e.preventDefault());
  }

  connectedCallback() {
    injectTokens();
    document.addEventListener('mousemove', this.#onTrackMouse, true);
    document.addEventListener('keydown', this.#onKeyDown, true);
    document.addEventListener('keyup', this.#onKeyUp, true);
    window.addEventListener('blur', this.#onBlur);
    const hot = (
      import.meta as {
        hot?: {
          on: (event: string, cb: (data?: unknown) => void) => void;
          off: (event: string, cb: (data?: unknown) => void) => void;
          send: (event: string, data: unknown) => void;
        };
      }
    ).hot;
    if (hot !== undefined) pageChannel.useViteHot(hot);
    if (this.#hotOff === undefined) {
      // Removed again in disconnectedCallback, so a re-attached overlay
      // doesn't stack duplicates and a detached one stops reacting.
      const handlers: Array<[string, (data?: unknown) => void]> =
        hot === undefined
          ? []
          : [
              ['vite:beforeFullReload', () => this.deactivate()],
              ['vite:ws:disconnect', () => (this.#connected = false)],
              ['vite:ws:connect', () => (this.#connected = true)],
            ];
      for (const [event, cb] of handlers) hot?.on(event, cb);
      // Toggle from the panel's Pick button or the Vite DevTools command
      // (handled server-side). The page channel carries it under Vite and,
      // once `connectToDevServer()` attaches its carrier, without.
      const offToggle = pageChannel.on(INSPECT_OVERLAY_TOGGLE_CHANNEL, () =>
        this.toggle()
      );
      this.#hotOff = () => {
        for (const [event, cb] of handlers) hot?.off(event, cb);
        offToggle();
      };
    }
    // Keep the (bottom-fixed) tooltip clear of the Vite DevTools edge panel.
    this.#edgeDispose = observeEdgeInsets((insets) => {
      this.style.setProperty('--edge-bottom', `${insets.bottom}px`);
    });
    // Apply the panel's editor override live (and on load). Merge so other
    // configured options (key, throttle, …) survive.
    if (!this.#overrideSubscribed) {
      this.#overrideSubscribed = true;
      subscribeOverrideKeys(hot, {
        sourceOverlayEditor: (editor) => {
          this.#options = {...this.#options, editor};
          this.#editor = resolveEditor(editor);
        },
      });
    }
  }

  disconnectedCallback() {
    document.removeEventListener('mousemove', this.#onTrackMouse, true);
    document.removeEventListener('keydown', this.#onKeyDown, true);
    document.removeEventListener('keyup', this.#onKeyUp, true);
    window.removeEventListener('blur', this.#onBlur);
    this.deactivate();
    this.#edgeDispose?.();
    this.#edgeDispose = undefined;
    this.#hotOff?.();
    this.#hotOff = undefined;
  }

  configure(options: SourceOverlayInitOptions) {
    this.#options = options;
    this.#editor = resolveEditor(options.editor);
    this.#isHost = options.hosts === 'lit' ? isAnyHost : hasSourceMeta;
  }

  activate() {
    if (this.#active) return;
    this.#active = true;
    this.#dialog.showModal();
    this.#mask.style.background = 'rgba(0,0,0,0.35)';
    // The overlay is pointer-events:none, so the cursor reflects the hovered
    // page element. Force a crosshair while inspecting, including under the
    // tooltip, which takes no pointer events either.
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

  toggle() {
    if (this.#active) this.deactivate();
    else this.activate();
  }

  #normalizePath(filePath: string): string {
    const root = this.#options.workspaceRoot;
    if (root !== undefined && filePath.startsWith(root)) {
      const rest = filePath.slice(root.length);
      return rest.startsWith('/') ? rest.slice(1) : rest;
    }
    return filePath;
  }

  async #openInEditor(filePath: string, lineNumber: number, column?: number) {
    const path = this.#normalizePath(filePath);
    const endpoint = this.#options.openInEditorPath ?? '/__lit-open-in-editor';
    try {
      const params = new URLSearchParams({
        file: path,
        line: String(lineNumber),
      });
      if (column !== undefined) params.set('column', String(column));
      // Name the editor the developer picked (config, env or the panel's
      // override) so the server opens that one; custom editors and an unset
      // choice send nothing and the server auto-detects.
      const {editor} = this.#options;
      if (typeof editor === 'string') params.set('editor', editor);
      const res = await fetch(`${endpoint}?${params.toString()}`);
      if (res.ok) return;
    } catch {
      // Fall back to editor URL schemes (e.g. StackBlitz previews).
    }
    // Skip the URL-scheme fallback when the dev server is gone: a fetch failure
    // there means "server quit", not "no endpoint", and navigating the tab to
    // `vscode://…` on shutdown is jarring and unwanted.
    if (!this.#connected) return;
    window.open(this.#editor.url(path, lineNumber, column), '_self');
  }

  #updateHighlightRect() {
    if (this.#targetEl === null) return;
    const rect = this.#targetEl.getBoundingClientRect();
    const raw = getComputedStyle(this)
      .getPropertyValue('--lit-devtools-radius')
      .trim();
    const r = parseFloat(raw) || 6;
    // The tinted box hugs the element's exact rect — that's the boundary being
    // picked; only the spotlight cutout gets the breathing room of `r`.
    this.#highlight.style.display = 'block';
    this.#highlight.style.left = `${rect.left}px`;
    this.#highlight.style.top = `${rect.top}px`;
    this.#highlight.style.width = `${rect.width}px`;
    this.#highlight.style.height = `${rect.height}px`;
    this.#mask.style.clipPath = buildSpotlightClipPath(
      rect.left - r,
      rect.top - r,
      rect.width + 2 * r,
      rect.height + 2 * r,
      // Square corners, like the rest of the DevTools; `r` is only padding.
      0
    );
  }

  #showTooltip() {
    if (this.#info === null) return;
    const {source} = this.#info;
    this.#tag.textContent = `<${this.#info.tagName}>`;
    // Without a source there is no path to show or open; the tooltip still
    // names what a click will pick, under the same component icon.
    this.#path.textContent =
      source === undefined
        ? ''
        : `${this.#normalizePath(source.filePath)}:${source.lineNumber}`;
    const out = this.#enclosingHost();
    const back = this.#trail.at(-1);
    this.#step.textContent = [
      out === null ? '' : `↑ <${out.tagName.toLowerCase()}>`,
      back === undefined ? '' : `↓ <${back.tagName.toLowerCase()}>`,
    ]
      .filter(Boolean)
      .join('  ');
    this.#step.style.display = out === null && back === undefined ? 'none' : '';
    const {callSite} = this.#info;
    this.#siteText.textContent =
      callSite === undefined
        ? ''
        : `${this.#normalizePath(callSite.filePath)}:${callSite.lineNumber}`;
    this.#siteRow.style.display = callSite === undefined ? 'none' : '';
    this.#path.style.display = source === undefined ? 'none' : '';
    this.#tooltip.style.display = 'flex';
    this.#showIntent();
  }

  /** Light up the row a click would open with the modifiers held now. */
  #showIntent() {
    const place =
      this.#info === null ? undefined : resolveOpen(this.#info, this.#intent);
    this.#sourceRow.classList.toggle('armed', place === 'source');
    this.#siteRow.classList.toggle('armed', place === 'callSite');
  }

  #setIntent(intent: OpenIntent) {
    if (intent === this.#intent) return;
    this.#intent = intent;
    this.#showIntent();
  }

  #clearTarget() {
    this.#targetEl = null;
    this.#pointerHost = null;
    this.#trail = [];
    this.#info = null;
    this.#highlight.style.display = 'none';
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

  #resolveAt(x: number, y: number) {
    this.#lastMouseX = x;
    this.#lastMouseY = y;
    const el = findSourceAtPoint(x, y, this.#dialog, this.#isHost);
    const host =
      el === null || this.#shouldSkip(el)
        ? null
        : findSourceHost(el, this.#isHost);
    if (host === null) {
      this.#clearTarget();
      return;
    }
    // Still over the same host: keep the target, including one stepped out to.
    if (host === this.#pointerHost && this.#info !== null) {
      this.#updateHighlightRect();
      return;
    }
    this.#pointerHost = host;
    this.#trail = [];
    this.#setTarget(host);
  }

  #setTarget(host: Element) {
    this.#targetEl = host;
    if (this.#resizeObserver === undefined) {
      this.#resizeObserver = new ResizeObserver(() =>
        this.#updateHighlightRect()
      );
    } else {
      this.#resizeObserver.disconnect();
    }
    this.#resizeObserver.observe(host);
    this.#info = hostInfo(host);
    this.#updateHighlightRect();
    this.#showTooltip();
  }

  /** The next pickable host out from the target, skipping excluded ones. */
  #enclosingHost(): Element | null {
    let host = this.#targetEl;
    while (host !== null) {
      host = findEnclosingHost(host, this.#isHost);
      if (host === null || !this.#shouldSkip(host)) return host;
    }
    return null;
  }

  // ArrowUp picks the host around the target, ArrowDown goes back in.
  #stepTarget(outward: boolean) {
    const target = this.#targetEl;
    if (target === null) return;
    if (outward) {
      const next = this.#enclosingHost();
      if (next === null) return;
      this.#trail.push(target);
      this.#setTarget(next);
    } else {
      const next = this.#trail.pop();
      if (next !== undefined) this.#setTarget(next);
    }
  }

  #onTrackMouse = (event: MouseEvent) => {
    this.#lastMouseX = event.clientX;
    this.#lastMouseY = event.clientY;
    // Catches modifiers pressed while the page didn't have focus.
    this.#setIntent(intentOf(event));
  };

  #onKeyUp = (event: KeyboardEvent) => {
    this.#setIntent(intentOf(event));
  };

  // A modifier released in another window never sends its keyup here.
  #onBlur = () => {
    this.#setIntent(false);
  };

  #onKeyDown = (event: KeyboardEvent) => {
    this.#setIntent(intentOf(event));
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey) {
      const pressed = event.key.toLowerCase();
      const hotkey = (this.#options.key ?? 's').toLowerCase();
      if (pressed === hotkey) {
        event.preventDefault();
        this.toggle();
      }
    }
    if (this.#active && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    }
    if (
      this.#active &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      // Not a scroll: the page stays put under the picker.
      event.preventDefault();
      event.stopPropagation();
      this.#stepTarget(event.key === 'ArrowUp');
    }
  };

  #onMouseMove = () => {
    if (!this.#active) return;
    const throttleMs = this.#options.throttleMs ?? 50;
    if (this.#throttleTimer !== undefined) return;
    this.#throttleTimer = setTimeout(() => {
      this.#throttleTimer = undefined;
      // Resolve against the latest pointer position (kept current by
      // #onTrackMouse), not the coords captured when this timer was scheduled
      // ~throttleMs ago — otherwise the highlight lags the cursor during
      // continuous movement.
      const x = this.#lastMouseX;
      const y = this.#lastMouseY;
      this.#resolveAt(x, y);
    }, throttleMs);
  };

  /**
   * `open` names what to open in the editor: the declaration (`source`) or
   * where the element is written (`callSite`), with the fallbacks of
   * {@link resolveOpen}. Without either, or with `false`, the click only picks.
   */
  #select(info: PickInfo, open: OpenIntent = false) {
    const target = this.#targetEl;
    // Cancel the whole selection mode on any deliberate pick, before acting —
    // the editor may open via a URL scheme that doesn't navigate this tab away,
    // so we can't rely on the open outcome to dismiss the inspector.
    this.deactivate();
    const {source} = info;
    // onSelect keeps its contract (ElementInfo.source is required), so
    // elements without a declaration, library ones, are not reported.
    if (source !== undefined) this.#options.onSelect?.({...info, source});
    const key = resolveOpen(info, open);
    const place = key === undefined ? undefined : info[key];
    if (place !== undefined) {
      const {columnNumber: column} = place as {columnNumber?: number};
      void this.#openInEditor(place.filePath, place.lineNumber, column);
      return;
    }
    // Report the picked element to the DevTools panel, which selects it in the
    // Components tree. Identity matches the inspector runtime via idOf().
    if (target !== null) {
      const id = idOf(target);
      pageChannel.send(INSPECT_DATA_CHANNEL, {
        type: 'pick',
        id,
        pageId: PAGE_ID,
      });
      this.#openDevtoolsPanel();
      this.#options.onPick?.(id);
    }
  }

  /**
   * Bring the Lit DevTools dock entry to the front so a pick is visible even
   * when the panel was closed. The panel mirrors this by switching to its
   * Components tab on the pick, but only once its iframe is mounted — and the
   * @vitejs/devtools shell does not mount that iframe until the entry has been
   * opened at least once. This overlay always runs on the page, so calling
   * `switchEntry` here covers the cold-start case where no panel exists yet to
   * receive the `pick` message.
   */
  #openDevtoolsPanel() {
    try {
      const ctx = (
        window as unknown as Record<
          string,
          undefined | {docks?: {switchEntry?: (id: string) => Promise<boolean>}}
        >
      ).__VITE_DEVTOOLS_CLIENT_CONTEXT__;
      void ctx?.docks?.switchEntry?.('lit-devtools');
    } catch {
      // Not running inside the DevTools shell — ignore.
    }
  }

  #onClick = (event: MouseEvent) => {
    if (!this.#active || this.#info === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.#select(this.#info, intentOf(event));
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
