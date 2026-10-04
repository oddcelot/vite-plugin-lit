import {FONT_MONO_VAR} from '../fonts.js';
import {CODE_ICON, COPY_ICON} from '../../icons.js';

// Shadow DOM markup for the overlay: a transparent modal <dialog> hosting the
// dimming mask, the highlight ring, and the bottom-fixed tooltip panel. The
// panel is a three-section split: open-in-editor icon | tag + path + arrow-key
// steps | copy icon. A second row of the same shape shows where the element
// is written in a template (its call site), when known.
export const OVERLAY_HTML = `
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
      display: none;
      pointer-events: none;
      box-sizing: border-box;
      border-radius: 0;
      /* Same box the inspector panel draws on tree hover (inspector/install.ts),
         so picking and panel-hovering read as the same selection. */
      background: rgba(77, 99, 255, 0.25);
      outline: 1px solid #4d63ff;
      transition: all 80ms ease-out;
    }
    #tooltip {
      position: fixed;
      /* Lift above the Vite DevTools edge panel when it's docked to the bottom
         (--edge-bottom is set from JS; 0 otherwise). */
      bottom: calc(16px + var(--edge-bottom, 0px));
      left: 50%;
      translate: -50%;
      display: none;
      flex-direction: column;
      pointer-events: auto;
      max-width: min(90vw, 480px);
      border-radius: var(--lit-devtools-radius-md);
      background: var(--lit-devtools-surface-elevated);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: var(--lit-devtools-text-strong);
      font: 12px/1.4 ${FONT_MONO_VAR};
      box-shadow: var(--lit-devtools-shadow-md);
      overflow: hidden;
    }
    .row {
      display: flex;
      align-items: stretch;
    }
    #site-row { border-top: 1px solid var(--lit-devtools-border-subtle); }
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
    .icon-btn:hover { background: var(--lit-devtools-surface-hover); }
    /* No outline ring; keyboard focus reuses the subtle hover tint. */
    .icon-btn:focus { outline: none; }
    .icon-btn:focus-visible { background: var(--lit-devtools-surface-hover); }
    .icon-btn svg {
      width: 16px;
      height: 16px;
      display: block;
      fill: currentColor;
    }
    #meta, #site-meta {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
      min-width: 0;
      padding: 6px 10px;
      border-left: 1px solid var(--lit-devtools-border-subtle);
      border-right: 1px solid var(--lit-devtools-border-subtle);
    }
    #tag {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--lit-devtools-text-strong);
    }
    #path, #site-path {
      color: var(--lit-devtools-text-secondary);
      font-size: 11px;
      word-break: break-all;
    }
    .label { color: var(--lit-devtools-text-muted); }
    /* Where the arrow keys step: out to the enclosing host, back in. */
    #step {
      color: var(--lit-devtools-text-secondary);
      font-size: 11px;
      white-space: pre;
    }
  </style>
  <dialog id="overlay">
    <div id="mask"></div>
    <div id="highlight"></div>
    <div id="tooltip">
      <div class="row">
        <span
          id="open"
          class="icon-btn"
          title="Open in editor"
          aria-label="Open in editor"
        >${CODE_ICON}</span>
        <div id="meta">
          <span id="tag"></span>
          <span id="path"></span>
          <span id="step"></span>
        </div>
        <button
          id="copy"
          class="icon-btn"
          type="button"
          title="Copy path"
          aria-label="Copy path"
        >${COPY_ICON}</button>
      </div>
      <div id="site-row" class="row">
        <button
          id="site-open"
          class="icon-btn"
          type="button"
          title="Open call site in editor"
          aria-label="Open call site in editor"
        >${CODE_ICON}</button>
        <div id="site-meta">
          <span id="site-path"><span class="label">rendered at </span><span id="site-text"></span></span>
        </div>
        <button
          id="site-copy"
          class="icon-btn"
          type="button"
          title="Copy call site"
          aria-label="Copy call site"
        >${COPY_ICON}</button>
      </div>
    </div>
  </dialog>
`;
