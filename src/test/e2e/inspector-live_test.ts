/**
 * Regression coverage for the Components inspector's opt-in "Live" tree mode
 * (`{type: 'observe', enabled: true}` in `src/lib/runtime/inspector/install.ts`).
 *
 * The live tree watches the light DOM and every shadow root, and must keep
 * seeing components however deep they are added: inside a shadow root, and
 * inside a shadow root that only appeared after observing started. Plain
 * markup churn must not push a tree.
 *
 * Worth an e2e rather than a unit test: the whole thing lives on a real
 * `MutationObserver` watching a real page's shadow DOM, debounced against
 * real timers, and driven end to end over the HMR channel the way the panel
 * actually drives it (`fixture.server.hot.send(INSPECT_CMD_CHANNEL, ...)` /
 * `fixture.server.hot.on(INSPECT_DATA_CHANNEL, ...)`, mirroring
 * the codec the Vite host connects in `src/lib/devframe/vite.ts`) — none of that exists in
 * a jsdom-style unit test.
 */

import {afterAll, afterEach, beforeAll, expect, test} from 'vite-plus/test';
import type {Page} from 'playwright-core';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  type InspectorMessage,
  type InspectorTreeNode,
} from '../../types/inspector.js';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;

/** Every `tree` message pushed over {@link INSPECT_DATA_CHANNEL} so far. */
let treeMessages: InspectorTreeNode[][] = [];

let tagCounter = 0;
/** A fresh, never-before-used custom element tag name for a test. */
const nextTag = (name: string): string => `e2e-live-${name}-${tagCounter++}`;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
  fixture.server.hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
    if (data.type === 'tree') treeMessages.push(data.roots);
  });
  // Mirrors the panel's "Live" toggle. `setObserving(true)` always pushes an
  // immediate snapshot (it resets its dedupe cache first), so this also
  // confirms the runtime is listening before any test proceeds.
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {
    type: 'observe',
    enabled: true,
  });
  // `expect.poll` only works inside a `test`; `beforeAll` gets a plain loop.
  const deadline = Date.now() + 5_000;
  while (treeMessages.length === 0) {
    if (Date.now() > deadline) {
      throw new Error('no initial tree message after enabling observe');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
});

afterAll(async () => {
  fixture?.server.hot.send(INSPECT_CMD_CHANNEL, {
    type: 'observe',
    enabled: false,
  });
  await fixture?.close();
});

// Each test appends its own uniquely-tagged elements straight to
// `document.body` (or nested inside a previous element's shadow root); clean
// them back out so a later test's tree diffs never see a stale root, and give
// the 100ms debounce time to flush the removal before the next test marks its
// own starting index into `treeMessages`.
afterEach(async () => {
  await fixture.page.evaluate(() => {
    for (const el of Array.from(document.body.children)) {
      if (el.tagName.toLowerCase().startsWith('e2e-live-')) el.remove();
    }
  });
  await fixture.page.waitForTimeout(250);
});

/** Depth-first search for a node by tag name anywhere in the tree. */
const findNode = (
  roots: InspectorTreeNode[],
  tag: string
): InspectorTreeNode | undefined => {
  for (const node of roots) {
    if (node.tagName === tag) return node;
    const found = findNode(node.children, tag);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * Waits for a `tree` message received at or after `since` (an index into
 * {@link treeMessages}) that satisfies `predicate`, and returns it.
 */
const waitForTree = async (
  since: number,
  predicate: (roots: InspectorTreeNode[]) => boolean,
  timeout = 5_000
): Promise<InspectorTreeNode[]> => {
  await expect
    .poll(() => treeMessages.slice(since).some(predicate), {timeout})
    .toBe(true);
  // treeMessages only ever grows, so the match found by the poll above is
  // still there to hand back.
  const match = treeMessages.slice(since).find(predicate);
  if (match === undefined) throw new Error('tree message vanished');
  return match;
};

/**
 * Defines (once) and appends a plain-`HTMLElement` custom element tagged
 * `tag`, either to `document.body` or inside `parentTag`'s shadow root.
 *
 * `isInspectable` (src/lib/runtime/inspector/collect.ts) requires a
 * `requestUpdate` function on top of the hyphenated tag name, so the stub
 * class provides a no-op one — real Lit components aren't needed to drive
 * the tree-building/observer logic under test.
 */
const appendTag = (
  page: Page,
  tag: string,
  options: {withShadow?: boolean; parentTag?: string} = {}
): Promise<void> =>
  page.evaluate(
    ([tag, withShadow, parentTag]) => {
      if (customElements.get(tag) === undefined) {
        class LiveTestElement extends HTMLElement {
          requestUpdate(): void {}
          connectedCallback(): void {
            if (withShadow && this.shadowRoot === null) {
              this.attachShadow({mode: 'open'});
            }
          }
        }
        customElements.define(tag, LiveTestElement);
      }
      // A parent tag may live inside another element's shadow root (the
      // "deep" scenario nests one custom element inside another's shadow),
      // so the lookup has to pierce shadow boundaries — plain
      // `document.querySelector` does not.
      const findDeep = (tag: string, root: ParentNode): Element | null => {
        const direct = root.querySelector(tag);
        if (direct !== null) return direct;
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot !== null) {
            const found = findDeep(tag, el.shadowRoot);
            if (found !== null) return found;
          }
        }
        return null;
      };
      let parent: Element | ShadowRoot = document.body;
      if (parentTag !== null) {
        const host = findDeep(parentTag, document);
        if (host === null) {
          throw new Error(`appendTag: no host for ${parentTag}`);
        }
        if (host.shadowRoot === null) {
          throw new Error(`appendTag: ${parentTag} has no shadow root`);
        }
        parent = host.shadowRoot;
      }
      parent.appendChild(document.createElement(tag));
    },
    [tag, options.withShadow ?? false, options.parentTag ?? null] as const
  );

/**
 * Appends `count` plain `<div>`/`<span>` text nodes, then removes them again
 * — noise that involves no custom element and no shadow root, either in the
 * light DOM (`parentTag: null`) or inside an already-observed shadow root.
 */
const churnPlainMarkup = (
  page: Page,
  parentTag: string | null,
  count: number
): Promise<void> =>
  page.evaluate(
    ([parentTag, count]) => {
      let parent: Element | ShadowRoot = document.body;
      if (parentTag !== null) {
        const host = document.querySelector(parentTag);
        parent = host?.shadowRoot ?? document.body;
      }
      const added: Element[] = [];
      for (let i = 0; i < count; i++) {
        const el = document.createElement(i % 2 === 0 ? 'div' : 'span');
        el.textContent = `noise-${i}`;
        parent.appendChild(el);
        added.push(el);
      }
      for (const el of added) el.remove();
    },
    [parentTag, count] as const
  );

test('a new component appended to the body appears in the pushed tree', async () => {
  const {page} = fixture;
  const tag = nextTag('a');
  const since = treeMessages.length;

  await appendTag(page, tag, {withShadow: true});

  const tree = await waitForTree(
    since,
    (roots) => findNode(roots, tag) !== undefined
  );
  const node = findNode(tree, tag);
  expect(node?.tagName).toBe(tag);
  expect(node?.children).toEqual([]);
});

test('a component appended inside a freshly-observed shadow root is picked up', async () => {
  const {page} = fixture;
  const tagA = nextTag('a');
  const tagB = nextTag('b');

  let since = treeMessages.length;
  await appendTag(page, tagA, {withShadow: true});
  await waitForTree(since, (roots) => findNode(roots, tagA) !== undefined);

  // B is appended *inside A's shadow root*, which only exists because A was
  // just added — the runtime has to have walked A's added subtree to notice
  // and observe it. Under the old always-full-resync code this also worked;
  // under the fix it only works if `observeShadowRoots` ran on A specifically.
  since = treeMessages.length;
  await appendTag(page, tagB, {parentTag: tagA});
  const tree = await waitForTree(since, (roots) => {
    const a = findNode(roots, tagA);
    return a !== undefined && findNode(a.children, tagB) !== undefined;
  });

  const a = findNode(tree, tagA);
  expect(a?.children.map((c) => c.tagName)).toEqual([tagB]);
});

test('a component nested two shadow roots deep is picked up', async () => {
  const {page} = fixture;
  const tagA = nextTag('a');
  const tagB = nextTag('b');
  const tagC = nextTag('c');

  let since = treeMessages.length;
  await appendTag(page, tagA, {withShadow: true});
  await waitForTree(since, (roots) => findNode(roots, tagA) !== undefined);

  since = treeMessages.length;
  await appendTag(page, tagB, {withShadow: true, parentTag: tagA});
  await waitForTree(since, (roots) => {
    const a = findNode(roots, tagA);
    return a !== undefined && findNode(a.children, tagB) !== undefined;
  });

  // C is appended inside B's shadow root, which itself only became
  // observable because B (which has its own shadow root) was added inside
  // A's shadow root in the previous step.
  since = treeMessages.length;
  await appendTag(page, tagC, {parentTag: tagB});
  const tree = await waitForTree(since, (roots) => {
    const a = findNode(roots, tagA);
    const b = a && findNode(a.children, tagB);
    return b !== undefined && findNode(b.children, tagC) !== undefined;
  });

  const a = findNode(tree, tagA);
  const b = a && findNode(a.children, tagB);
  expect(b?.children.map((c) => c.tagName)).toEqual([tagC]);
});

test('plain-markup churn, in the body or inside a shadow root, pushes no tree', async () => {
  const {page} = fixture;
  const tagHost = nextTag('host');

  let since = treeMessages.length;
  await appendTag(page, tagHost, {withShadow: true});
  await waitForTree(since, (roots) => findNode(roots, tagHost) !== undefined);

  since = treeMessages.length;
  await churnPlainMarkup(page, null, 30);
  await churnPlainMarkup(page, tagHost, 30);
  // Generous vs. the runtime's 100ms debounce: give a genuine (wrong) push a
  // real chance to land before asserting it didn't.
  await page.waitForTimeout(400);
  expect(treeMessages.length).toBe(since);
});

test('removing a component pushes a tree without it', async () => {
  const {page} = fixture;
  const tag = nextTag('a');

  let since = treeMessages.length;
  await appendTag(page, tag, {withShadow: true});
  await waitForTree(since, (roots) => findNode(roots, tag) !== undefined);

  since = treeMessages.length;
  await page.evaluate((tag) => {
    document.querySelector(tag)?.remove();
  }, tag);
  const tree = await waitForTree(
    since,
    (roots) => findNode(roots, tag) === undefined
  );
  expect(findNode(tree, tag)).toBeUndefined();
});
