/**
 * The direct page <-> panel channel, end to end in a real browser.
 *
 * Worth an e2e rather than a unit test: the whole point of the feature is the
 * handshake between two documents (a page and a panel iframe) over
 * `MessageChannel`, and every interesting failure mode — the bare
 * `devframe/in-page-channel` import not resolving inside a `/@fs/` runtime
 * module, the hello never reaching an ancestor, the page script answering but
 * the outline not drawing — only exists once both sides are real.
 *
 * The stub below stands in for the DevTools panel: the panel's own bundle is
 * served by the DevTools hub, which this fixture does not run, but it uses the
 * same `connectPanelChannel` call and the same protocol.
 */

import {writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;

/**
 * Served from the fixture root so Vite transforms it: the bare specifier is
 * the same one the real panel uses, and resolving it is part of what this
 * test is checking.
 */
const PANEL_STUB = `<!doctype html>
<meta charset="utf-8" />
<script type="module">
  import {connectPanelChannel} from 'devframe/in-page-channel';
  const channel = connectPanelChannel({
    name: 'lit:in-page',
    functions: {},
  });
  window.__panelChannel = channel;
</script>
`;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
  await writeFile(path.join(fixture.root, 'panel-stub.html'), PANEL_STUB);

  // The stub's `devframe/in-page-channel` import is new to this fixture, so
  // the first request for it makes Vite's dep optimizer pre-bundle it and
  // full-reload every page that loaded it. Mid-test that reload destroys the
  // iframe (or the evaluate context) and the handshake never completes.
  // Let the optimizer settle on a throwaway visit, then return to the page.
  const {page, server} = fixture;
  const origin = fixture.origin;
  await page.goto(`${origin}/panel-stub.html`, {waitUntil: 'networkidle'});
  await server.waitForRequestsIdle();
  await page.goto(`${origin}/panel-stub.html`, {waitUntil: 'networkidle'});
  await page.goto(`${origin}/`, {waitUntil: 'networkidle'});
});

afterAll(async () => {
  await fixture?.close();
});

/** The runtime's element id for the fixture's `<hmr-counter>`. */
const counterId = async (): Promise<number> => {
  const {page} = fixture;

  // The inspector runtime is injected as a `/@fs/` module; importing the same
  // URL here hands back that module instance, so an id minted now is the id
  // the runtime will resolve.
  //
  // Evaluated from a string, not a function: this file is itself transformed
  // by Vite, which would rewrite a literal `import()` in a callback body into
  // its SSR helper and blow up inside the browser.
  const src = await page.getAttribute(
    'script[src*="inspector/install"]',
    'src'
  );
  expect(src).not.toBeNull();
  // The injected `src` has a doubled slash (`/@fs//Users/...`) while Vite's
  // own internal imports use a single one. The browser keys module records by
  // URL string, so importing the doubled form would execute a *second* copy of
  // `identity.js` with its own WeakMap, and the id minted here would be
  // invisible to the runtime. Normalise to the form the runtime itself uses.
  const identityUrl = src!
    .replace('/@fs//', '/@fs/')
    .replace('inspector/install', 'timeline/identity');
  const id = await page.evaluate<number>(`(async () => {
    const identity = await import(${JSON.stringify(identityUrl)});
    const el = document.querySelector('hmr-counter');
    if (el === null) throw new Error('no hmr-counter in the fixture page');
    return identity.idOf(el);
  })()`);
  expect(typeof id).toBe('number');
  return id;
};

test('a panel iframe drives the page highlight with no server in the path', async () => {
  const {page} = fixture;
  const id = await counterId();

  // Nothing is drawn before a panel asks for it.
  expect(await page.locator('[data-lit-devtools-highlight]').count()).toBe(0);

  await page.evaluate(async () => {
    const frame = document.createElement('iframe');
    frame.src = '/panel-stub.html';
    frame.style.cssText = 'position:fixed;width:10px;height:10px;bottom:0';
    document.body.append(frame);
    await new Promise((resolve) => frame.addEventListener('load', resolve));
  });

  const panel = page.frameLocator('iframe');
  // The handshake retries with backoff, so poll rather than assuming the
  // first hello lands.
  await expect
    .poll(
      () =>
        panel
          .locator('body')
          .evaluate(() => (window as any).__panelChannel?.status),
      {timeout: 10_000}
    )
    .toBe('connected');

  await panel
    .locator('body')
    .evaluate(
      (_el, elementId) =>
        (window as any).__panelChannel.emit('highlight', elementId),
      id
    );

  const box = page.locator('[data-lit-devtools-highlight]');
  await expect.poll(() => box.count(), {timeout: 5_000}).toBe(1);

  // Positioned over the real element, not merely present.
  const [boxRect, elRect] = await Promise.all([
    box.boundingBox(),
    page.locator('hmr-counter').boundingBox(),
  ]);
  expect(boxRect).not.toBeNull();
  expect(Math.round(boxRect!.width)).toBe(Math.round(elRect!.width));
  expect(Math.round(boxRect!.y)).toBe(Math.round(elRect!.y));

  // `null` clears it.
  await panel
    .locator('body')
    .evaluate(() => (window as any).__panelChannel.emit('highlight', null));
  await expect
    .poll(() => box.evaluate((el) => getComputedStyle(el).display), {
      timeout: 5_000,
    })
    .toBe('none');
});

test('a panel iframe scrolls an element into view with reveal', async () => {
  const {page} = fixture;
  const id = await counterId();
  // Push the counter well below the fold, then start from the top.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.id = 'reveal-spacer';
    spacer.style.height = '3000px';
    document.querySelector('hmr-counter')!.before(spacer);
    window.scrollTo(0, 0);
  });
  const inView = () =>
    page.locator('hmr-counter').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
  expect(await inView()).toBe(false);

  // The in-page channel, from the panel stub the previous test attached.
  await page
    .frameLocator('iframe')
    .locator('body')
    .evaluate(
      (_el, elementId) =>
        (window as any).__panelChannel.emit('reveal', elementId),
      id
    );
  await expect.poll(inView, {timeout: 5_000}).toBe(true);
  const box = page.locator('[data-lit-devtools-highlight]');
  expect(await box.evaluate((el) => getComputedStyle(el).display)).toBe(
    'block'
  );

  // The outline lets go once the scroll has settled.
  await expect
    .poll(() => box.evaluate((el) => getComputedStyle(el).display), {
      timeout: 5_000,
    })
    .toBe('none');
  await page.evaluate(() => document.getElementById('reveal-spacer')?.remove());
});
