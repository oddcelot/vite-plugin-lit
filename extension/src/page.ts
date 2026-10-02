/**
 * The extension's page script: the Lit runtime, injected into the MAIN world
 * at `document_start` on the sites the user enabled (see `registry.ts`).
 *
 * The same install modules `lit-devtools dev` serves (`standalone.ts`), minus
 * what tied that script to a dev server: it has no `document.currentScript`
 * to read (the browser injects it, no `<script>` loads it) and nothing to
 * dial. Its traffic leaves the page through `window.postMessage` instead, to
 * the relay in the ISOLATED world (`content.ts`), the only world with
 * `chrome.runtime`.
 *
 * Bundled as a self-contained classic script (see `vite.config.ts`): content
 * scripts are not modules and cannot import. Being first on the page is the
 * point: the capture layers wrap `customElements.define` before the page's own
 * scripts define anything.
 */

import {forgetOwnLit} from '../../src/lib/runtime/own-lit.js';
import '../../src/lib/runtime/timeline/install.js';
import '../../src/lib/runtime/inspector/install.js';
import {initSourceOverlay} from '../../src/lib/runtime/source-overlay/overlay-element.js';
import {attachWindowTransport} from '../../src/lib/runtime/window-transport.js';

// The picker's LitElement brought a Lit of our own: not the page's to count.
forgetOwnLit();
attachWindowTransport();

// The picker reports a pick on the page channel; the panel is the DevTools
// tab the user already has open, so there is nothing to raise.
const startPicker = () => initSourceOverlay({hosts: 'lit'});
// At document_start there is no <body> to attach to yet.
if (document.body === null) {
  document.addEventListener('DOMContentLoaded', startPicker, {once: true});
} else {
  startPicker();
}
