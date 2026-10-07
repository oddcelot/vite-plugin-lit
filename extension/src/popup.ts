/**
 * The toolbar popup, in the Firefox build only. Firefox refuses permission
 * requests from DevTools (bugzil.la/1796933), so the Lit tab's Enable button
 * can't ask for a site's host permission there; this popup, an extension page
 * opened by the user's click, can.
 *
 * It does what the Lit tab's setup screen does for the active tab: ask for
 * the permission inside the click, have the background register the scripts,
 * and reload the tab so they run at `document_start`. The Lit tab follows
 * the enabled origins in `storage.local` and opens the panel by itself.
 *
 * The active tab's URL is readable through the `activeTab` permission, which
 * the toolbar click grants for that tab alone.
 */

import type {OriginStatus, RegistryRequest} from './protocol.js';
import {normalizeOrigin, originPattern} from './registry.js';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const originEl = $('origin');
const statusEl = $('status');
const enableButton = $<HTMLButtonElement>('enable');
const disableButton = $<HTMLButtonElement>('disable');

const request = (message: RegistryRequest): Promise<OriginStatus> =>
  chrome.runtime.sendMessage(message);

const render = (status: OriginStatus | undefined): void => {
  statusEl.textContent =
    status === undefined
      ? 'not a web page'
      : (status.error ??
        (status.enabled
          ? 'enabled'
          : status.permitted
            ? 'disabled'
            : 'not permitted'));
  enableButton.hidden = status === undefined || status.enabled;
  disableButton.hidden = status?.enabled !== true;
};

const main = async (): Promise<void> => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  // Firefox's sites are hosts on any port; see `normalizeOrigin`.
  const origin =
    tab?.url === undefined ? undefined : normalizeOrigin(tab.url, false);
  originEl.textContent = origin ?? '(not a web page)';
  if (origin === undefined || tab?.id === undefined) {
    render(undefined);
    return;
  }
  const tabId = tab.id;
  let current = await request({type: 'lit:status', origin});
  render(current);

  enableButton.addEventListener('click', async () => {
    // First thing in the handler: the request must run inside the click.
    if (!current.permitted) {
      const granted = await chrome.permissions.request({
        origins: [originPattern(origin)],
      });
      if (!granted) return;
    }
    current = await request({type: 'lit:enable', origin});
    render(current);
    if (current.enabled) {
      await chrome.tabs.reload(tabId);
      window.close();
    }
  });

  disableButton.addEventListener('click', async () => {
    current = await request({type: 'lit:disable', origin});
    render(current);
    await chrome.tabs.reload(tabId);
    window.close();
  });
};

void main();
