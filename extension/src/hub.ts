/**
 * The background's routing: pairs each tab's page port (opened by the content
 * script) with the DevTools panel ports inspecting that tab, and pipes
 * `PortMessage`s between them.
 *
 * A port is one document. A navigation drops the old document's port and the
 * new document opens another, and Chrome does not promise the old one's
 * `onDisconnect` fires before the new one connects, so a page port is only
 * forgotten if it is still the tab's current one. Panels outlive navigations;
 * they hear about each change on {@link CHANNEL_PAGE_STATUS} instead of losing
 * their port.
 *
 * Nothing is buffered. A message for a panel that is not open, or for a page
 * that has not connected yet, is dropped: both ends announce themselves when
 * the other arrives (the runtime re-announces on attach, the panel asks again
 * on `connected`), as they do on every other carrier.
 *
 * Only top frames for now: a frame's runtime would need its own pairing, and
 * the content scripts are registered with `allFrames: false` anyway.
 *
 * Free of `chrome` so it runs against fake ports in unit tests; the service
 * worker hands it the real ones from `chrome.runtime.onConnect`.
 */

import {
  isPortMessage,
  type PortLike,
  type PortMessage,
} from '../../src/lib/devframe/port-message.js';
import {PEER_CONNECTED_CHANNEL} from '../../src/lib/devframe/protocol.js';
import {
  CHANNEL_PAGE_STATUS,
  PAGE_PORT,
  PANEL_PORT,
  isPanelHello,
} from './protocol.js';
import type {PageStatus} from './protocol.js';

/** The slice of `chrome.runtime.Port` the hub uses. */
export interface HubPort extends PortLike {
  name: string;
  sender?: {tab?: {id?: number}; frameId?: number};
  disconnect(): void;
}

export interface Hub {
  /** Take a newly connected port; ports with other names are left alone. */
  connect(port: HubPort): void;
}

/** Chrome throws on a port whose other end is gone; that is not an error. */
const post = (port: HubPort, message: PortMessage): void => {
  try {
    port.postMessage(message);
  } catch {
    // Its onDisconnect cleans up.
  }
};

export const createHub = (): Hub => {
  const pages = new Map<number, HubPort>();
  const panels = new Map<number, Set<HubPort>>();

  const status = (port: HubPort, connected: boolean): void => {
    const data: PageStatus = {connected};
    post(port, {channel: CHANNEL_PAGE_STATUS, data});
  };

  const connectPage = (port: HubPort): void => {
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined || port.sender?.frameId !== 0) {
      port.disconnect();
      return;
    }
    pages.set(tabId, port);
    for (const panel of panels.get(tabId) ?? []) status(panel, true);
    port.onMessage.addListener((message) => {
      if (!isPortMessage(message)) return;
      for (const panel of panels.get(tabId) ?? []) post(panel, message);
    });
    port.onDisconnect?.addListener(() => {
      // A navigation's new document may have connected first.
      if (pages.get(tabId) !== port) return;
      pages.delete(tabId);
      for (const panel of panels.get(tabId) ?? []) status(panel, false);
    });
  };

  const connectPanel = (port: HubPort): void => {
    let tabId: number | undefined;
    port.onMessage.addListener((message) => {
      if (tabId === undefined) {
        if (!isPanelHello(message)) return;
        tabId = message.tabId;
        let set = panels.get(tabId);
        if (set === undefined) panels.set(tabId, (set = new Set()));
        set.add(port);
        const page = pages.get(tabId);
        status(port, page !== undefined);
        // The page's port predates this panel; have it re-announce itself.
        if (page !== undefined) post(page, {channel: PEER_CONNECTED_CHANNEL});
        return;
      }
      const page = pages.get(tabId);
      if (page !== undefined && isPortMessage(message)) post(page, message);
    });
    port.onDisconnect?.addListener(() => {
      if (tabId === undefined) return;
      const set = panels.get(tabId);
      set?.delete(port);
      if (set?.size === 0) panels.delete(tabId);
    });
  };

  return {
    connect(port) {
      if (port.name === PAGE_PORT) connectPage(port);
      else if (port.name === PANEL_PORT) connectPanel(port);
    },
  };
};
