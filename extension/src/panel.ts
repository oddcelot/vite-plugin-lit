/**
 * Placeholder for the Lit DevTools tab, until the panel SPA moves in (bead
 * vej.5). It does the parts that are the extension's own: shows whether the
 * inspected site is enabled, enables or disables it, and once enabled opens
 * the panel's port and counts what arrives from the page, as a sign the whole
 * path (page, relay, background, panel) carries traffic.
 *
 * Enabling asks for the site's host permission first. Only an extension page
 * can, inside the user's click, so it happens here and not in the
 * background, which is then asked to register the scripts. The page is
 * reloaded so they run at `document_start` of a fresh document.
 */

import {CHANNEL_PAGE_STATUS, PANEL_PORT} from './protocol.js';
import type {
  OriginStatus,
  PageStatus,
  PanelHello,
  RegistryRequest,
} from './protocol.js';
import type {PortMessage} from '../../src/lib/devframe/port-link.js';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const originEl = $('origin');
const statusEl = $('status');
const pageEl = $('page');
const countEl = $<HTMLOutputElement>('count');
const enableButton = $<HTMLButtonElement>('enable');
const disableButton = $<HTMLButtonElement>('disable');

const tabId = chrome.devtools.inspectedWindow.tabId;
let origin: string | undefined;
let port: chrome.runtime.Port | undefined;
let count = 0;

const request = (message: RegistryRequest): Promise<OriginStatus> =>
  chrome.runtime.sendMessage(message);

const inspectedOrigin = (): Promise<string | undefined> =>
  new Promise((resolve) =>
    chrome.devtools.inspectedWindow.eval<string>(
      'location.origin',
      (result, exception) => resolve(exception ? undefined : result)
    )
  );

const connect = (): void => {
  if (port !== undefined) return;
  const next = chrome.runtime.connect({name: PANEL_PORT});
  port = next;
  next.onMessage.addListener((message: PortMessage) => {
    if (message.channel === CHANNEL_PAGE_STATUS) {
      const {connected} = message.data as PageStatus;
      pageEl.textContent = connected ? 'connected' : 'not connected';
      return;
    }
    countEl.value = String(++count);
  });
  // The service worker restarted or the extension reloaded: dial again.
  next.onDisconnect.addListener(() => {
    port = undefined;
    pageEl.textContent = 'not connected';
    setTimeout(connect, 500);
  });
  const hello: PanelHello = {tabId};
  next.postMessage(hello);
};

const render = (status: OriginStatus | undefined): void => {
  originEl.textContent = origin ?? '(not a web page)';
  statusEl.textContent =
    status === undefined
      ? 'unavailable'
      : status.enabled
        ? 'enabled'
        : (status.error ?? (status.permitted ? 'disabled' : 'not permitted'));
  enableButton.disabled = status === undefined || status.enabled;
  disableButton.disabled = status === undefined || !status.enabled;
  if (status?.enabled) connect();
};

const refresh = async (): Promise<void> => {
  origin = await inspectedOrigin();
  render(
    origin === undefined
      ? undefined
      : await request({type: 'lit:status', origin})
  );
};

enableButton.addEventListener('click', async () => {
  if (origin === undefined) return;
  // First thing in the handler: the request must run inside the click.
  const granted = await chrome.permissions.request({origins: [`${origin}/*`]});
  if (!granted) return;
  const status = await request({type: 'lit:enable', origin});
  render(status);
  if (status.enabled) chrome.devtools.inspectedWindow.reload({});
});

disableButton.addEventListener('click', async () => {
  if (origin === undefined) return;
  render(await request({type: 'lit:disable', origin}));
  chrome.devtools.inspectedWindow.reload({});
});

chrome.devtools.network.onNavigated.addListener(() => void refresh());
void refresh();
