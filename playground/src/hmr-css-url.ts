/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import {devCacheBust} from '@lit-labs/vite-plugin-lit/css.js';
import cssUrl from './hmr-css-url.css?url';

/**
 * External stylesheet loaded via <link> pointing at the real CSS file.
 *
 * The `?url` query parameter (Vite 5.4+) imports the URL of the CSS file
 * itself. The dev server serves actual CSS at that URL (not the JS-wrapped
 * module), so a <link> href can point straight at it.
 *
 * When the .css file changes, Vite invalidates the `?url` module and the
 * update propagates to this component module, which re-executes and
 * re-renders. But the imported URL string is the same on every execution,
 * so without help the browser would keep the stale stylesheet —
 * `devCacheBust` gives each module execution a fresh href, forcing a
 * refetch.
 *
 * Tradeoffs — per-element delivery (the lower-level form of `hmr-linked-css`,
 * wiring the `<link>` yourself). ✅ Real cacheable `.css` asset; full control
 * of the href. ❌ One `<link>` + `CSSStyleSheet` per instance; CSS edits
 * re-render the component. For a shared utility sheet prefer `?css-sheet` —
 * see ../../docs/css-delivery.md (benchmarked in bench/).
 */

// Module scope: one fresh href per module execution, not per render.
const href = devCacheBust(cssUrl);

@customElement('hmr-css-url')
export class HmrCssUrl extends LitElement {
  private renders = 0;

  override render() {
    return html`
      <link rel="stylesheet" href="${href}" />
      <h2>CSS ?url</h2>
      <div id="url-box">styled via &lt;link&gt; to real file</div>
      <span class="badge" id="badge">renders: 0</span>
    `;
  }

  override updated() {
    this.renders++;
    this.setAttribute('data-renders', String(this.renders));
    const badge = this.renderRoot.querySelector('#badge');
    if (badge !== null) {
      badge.textContent = `renders: ${this.renders}`;
    }
  }
}
