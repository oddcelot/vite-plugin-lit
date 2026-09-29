/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Regression coverage for the source overlay's `import.meta.hot` listener
 * lifecycle.
 *
 * `<lit-source-overlay>` used to register its `hot.on(...)` handlers
 * (including the DevTools toggle command) unconditionally from
 * `connectedCallback`, with nothing removing them in `disconnectedCallback`.
 * A single detach-and-reattach of the same element (the DOM operation, not a
 * fresh instance) therefore left two listeners registered for the toggle
 * channel: the server's one broadcast fired `toggle()` twice on the same
 * instance, which is a net no-op, and the overlay silently swallowed the
 * command instead of activating.
 *
 * This only reproduces with a real HMR websocket round trip (the server
 * broadcasting over `hot.send`) and the real custom-element connect/disconnect
 * lifecycle, so it belongs here rather than in a unit test.
 */

import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {INSPECT_OVERLAY_TOGGLE_CHANNEL} from '../../types/inspector.js';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture({plugin: {sourceOverlay: true}});
  await fixture.page.waitForSelector('lit-source-overlay', {state: 'attached'});
});

afterAll(async () => {
  await fixture?.close();
});

/**
 * The overlay's shadow root is closed, so its `#active` flag can't be read
 * directly. `activate()` appends a `*{cursor:crosshair !important}` style to
 * `document.head` (light DOM, deliberately outside the closed root — see
 * the comment in `overlay-element.ts`), so the computed cursor on any plain
 * element is an honest, external proxy for "is the overlay active".
 */
const isOverlayActive = () =>
  fixture.page.evaluate(
    () => getComputedStyle(document.body).cursor === 'crosshair'
  );

test('a detached-and-reattached overlay applies exactly one toggle, not zero', async () => {
  const {page, server} = fixture;

  expect(await isOverlayActive()).toBe(false);

  // Detach and reattach the *same* element once. Under the old code this
  // leaves two `hot.on(INSPECT_OVERLAY_TOGGLE_CHANNEL, ...)` handlers on the
  // instance (one from the original connect, one from the reattach, neither
  // ever removed); a single toggle broadcast then fires `toggle()` twice and
  // nets out to inactive. The fix removes the old handler in
  // `disconnectedCallback`, so exactly one handler survives and the overlay
  // activates.
  await page.evaluate(() => {
    const el = document.querySelector('lit-source-overlay');
    if (el === null) {
      throw new Error('no lit-source-overlay in the fixture page');
    }
    el.remove();
    document.body.append(el);
  });

  // Mirrors `HotTimelineSource.toggleOverlay()` (src/lib/devframe/vite.ts):
  // the server broadcasts the channel with no payload, exactly the command
  // path the Vite DevTools shortcut/command uses.
  server.hot.send(INSPECT_OVERLAY_TOGGLE_CHANNEL);

  await expect.poll(isOverlayActive, {timeout: 5_000}).toBe(true);

  // A fully detached overlay (no reattach) should not react to a further
  // toggle at all. `disconnectedCallback` itself calls `deactivate()`, so
  // removing the element already clears the crosshair — the real question is
  // whether a *subsequent* toggle broadcast reaches a listener that
  // shouldn't exist anymore. Under the old code the `hot.on` handler from the
  // original connect was never removed, so this toggle would reactivate the
  // (detached) instance and the crosshair would come back; the fix removes
  // the handler in `disconnectedCallback`, so nothing reacts.
  await page.evaluate(() => {
    const el = document.querySelector('lit-source-overlay');
    if (el === null) {
      throw new Error('no lit-source-overlay in the fixture page');
    }
    el.remove();
  });
  expect(await isOverlayActive()).toBe(false);
  server.hot.send(INSPECT_OVERLAY_TOGGLE_CHANNEL);
  // No poll for a negative: give a genuine reaction a moment to land, then
  // assert it didn't.
  await page.waitForTimeout(300);
  expect(await isOverlayActive()).toBe(false);
});

test('a DNS-rebound request never reaches the open-in-editor endpoint', async () => {
  // Under DNS rebinding a hostile page reaches the dev server under its own
  // name, so `Origin` and `Host` agree and `isTrustedRequest` (src/lib/http.ts)
  // would pass it. What stops it is Vite's `server.allowedHosts` check, which
  // runs before any plugin middleware. Pinned here because the endpoint relies
  // on it: a `Blocked request` 403 is Vite's answer, while our own refusals
  // read differently. The file doesn't exist, so a regression shows up as a
  // 404 rather than as an editor opening.
  const {host} = new URL(fixture.origin);
  const rebound = host.replace(/^[^:]+/, 'rebind.example');
  const res = await fixture.page.request.get(
    `${fixture.origin}/__lit-open-in-editor?file=does-not-exist.ts`,
    {
      headers: {
        host: rebound,
        origin: `http://${rebound}`,
        'sec-fetch-site': 'same-origin',
      },
    }
  );
  expect(res.status()).toBe(403);
  expect(await res.text()).toContain('Blocked request');
});
