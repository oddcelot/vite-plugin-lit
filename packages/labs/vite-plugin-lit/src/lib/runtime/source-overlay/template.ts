/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {FONT_MONO_VAR} from '../fonts.js';
import {CODE_ICON, COPY_ICON} from '../icons.js';

// Shadow DOM markup for the overlay: a transparent modal <dialog> hosting the
// dimming mask, the highlight ring, and the bottom-fixed tooltip panel. The
// panel is a three-section split: open-in-editor icon | tag + path | copy icon.
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
      pointer-events: none;
      box-sizing: border-box;

      border-radius: var(--lit-devtools-radius, 6px);
    }
    #tooltip {
      position: fixed;
      /* Lift above the Vite DevTools edge panel when it's docked to the bottom
         (--edge-bottom is set from JS; 0 otherwise). */
      bottom: calc(16px + var(--edge-bottom, 0px));
      left: 50%;
      translate: -50%;
      display: none;
      align-items: stretch;
      pointer-events: auto;
      max-width: min(90vw, 480px);
      border-radius: var(--lit-devtools-radius, 6px);
      background: rgba(26,26,46,0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #fff;
      font: 12px/1.4 ${FONT_MONO_VAR};
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
    /* No outline ring; keyboard focus reuses the subtle hover tint. */
    .icon-btn:focus { outline: none; }
    .icon-btn:focus-visible { background: rgba(255,255,255,0.1); }
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
      color: rgba(255,255,255,0.6);
      font-size: 11px;
      word-break: break-all;
    }
  </style>
  <dialog id="overlay">
    <div id="mask"></div>
    <div id="highlight"></div>
    <div id="tooltip">
      <span
        id="open"
        class="icon-btn"
        title="Open in editor"
        aria-label="Open in editor"
      >${CODE_ICON}</span>
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
      >${COPY_ICON}</button>
    </div>
  </dialog>
`;
