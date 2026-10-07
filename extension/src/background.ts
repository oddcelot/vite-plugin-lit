/**
 * The extension's service worker: wires the real `chrome` APIs to the
 * port routing (`hub.ts`) and the per-site script registration
 * (`registry.ts`).
 *
 * Holds no state of its own worth keeping. The worker can be stopped when
 * idle (an open port keeps it alive, Chrome 114+), and what must survive that
 * lives in Chrome: registered scripts persist across sessions, the enabled
 * origins sit in `storage.local`. A restart drops the hub's pairings with the
 * ports, which reconnect.
 */

import {createHub} from './hub.js';
import {
  createRegistry,
  handleRegistryRequest,
  patternsKeepPort,
} from './registry.js';
import {isRegistryRequest} from './protocol.js';

const hub = createHub();
chrome.runtime.onConnect.addListener((port) => hub.connect(port));

const registry = createRegistry({
  scripting: chrome.scripting,
  storage: chrome.storage.local,
  permissions: chrome.permissions,
  keepPort: patternsKeepPort(chrome.runtime.getURL('')),
});

const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the extension's own pages turn sites on or off; a content script's
  // sender URL is the page it runs in.
  if (sender.id !== chrome.runtime.id || sender.url === undefined) return;
  if (new URL(sender.url).origin !== EXTENSION_ORIGIN) return;
  if (!isRegistryRequest(message)) return;
  handleRegistryRequest(registry, message).then(sendResponse, (error) =>
    sendResponse({
      origin: message.origin,
      enabled: false,
      permitted: false,
      error: String(error),
    })
  );
  // Answered asynchronously.
  return true;
});

chrome.permissions.onRemoved.addListener(({origins}) => {
  void registry.forget(origins ?? []);
});
