/**
 * The extension's relay, in the ISOLATED world at `document_start` on the
 * sites the user enabled: the page runtime (`page.ts`) cannot reach
 * `chrome.runtime` from the MAIN world, so this script opens the document's
 * port to the background and carries messages between it and the page's
 * `window`.
 *
 * One port per document. The background pairs it with the panel inspecting
 * this tab (`hub.ts`); a navigation loads a new copy of this script, which
 * opens a new port.
 *
 * Bundled as a self-contained classic script, like `page.ts`.
 */

import {PAGE_PORT} from './protocol.js';

const port = chrome.runtime.connect({name: PAGE_PORT});

// vej.3: relayWindowToPort(window, port);
void port;
