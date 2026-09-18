/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {addTimelineEvent, addTimelineLayer} from 'virtual:lit-plugin/timeline';

// Register once, at module scope. Duplicate ids are ignored, so a hot patch
// that re-runs this module is harmless.
addTimelineLayer({id: 'app-router', label: 'Router', color: 0xff6b35});

const routes = ['/', '/inbox', '/settings'] as const;

/**
 * Emits its own events on a custom timeline layer, so app-level navigation
 * lines up against Lit's lifecycle rows on the same time axis.
 */
@customElement('hmr-custom-layer')
export class HmrCustomLayer extends LitElement {
  static override styles = css`
    nav {
      display: flex;
      gap: 0.5rem;
    }
    button[aria-current='page'] {
      font-weight: bold;
    }
  `;

  @state()
  private route: (typeof routes)[number] = '/';

  override render() {
    return html`
      <h2>Custom layer</h2>
      <nav>
        ${routes.map(
          (route) => html`
            <button
              aria-current=${route === this.route ? 'page' : 'false'}
              @click=${() => this.navigate(route)}
            >
              ${route}
            </button>
          `
        )}
      </nav>
      <p>Current route: <code>${this.route}</code></p>
    `;
  }

  private navigate(to: (typeof routes)[number]) {
    const from = this.route;
    this.route = to;
    addTimelineEvent({
      layerId: 'app-router',
      time: performance.now(),
      title: `navigate ${to}`,
      subtitle: `from ${from}`,
      data: {from, to},
    });
  }
}
