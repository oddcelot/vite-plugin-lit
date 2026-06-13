/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vitest';
import {
  type Fixture,
  dataRenders,
  keepShadow,
  sameAsKept,
  shadowText,
  startFixture,
} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture?.close();
});

const CONSUMER = 'hmr-ctx-provider >> hmr-ctx-consumer';

const consumed = () => shadowText(fixture.page, `${CONSUMER} >> #consumed`);

test('context value and subscription survive patches to provider and consumer', async () => {
  const {page, edit} = fixture;

  // Baseline: @provide pushes to the subscribed @consume.
  await expect.poll(consumed).toBe('Consumed: 0');
  await page.click('hmr-ctx-provider #provide-increment');
  await page.click('hmr-ctx-provider #provide-increment');
  await expect.poll(consumed).toBe('Consumed: 2');

  await keepShadow(page, 'consumer', CONSUMER);

  // Patch the consumer module... (both classes live in one module, so this
  // patches provider and consumer alike).
  await edit('src/hmr-context.ts', (code) => code.replace('Consumed:', 'Got:'));
  await expect.poll(consumed, {timeout: 10_000}).toBe('Got: 2');

  // Element identity and the consumed value survived.
  expect(await sameAsKept(page, 'consumer', CONSUMER)).toBe(true);

  // The subscription (instance-level ContextConsumer controller) still
  // fires through the patched classes.
  await page.click('hmr-ctx-provider #provide-increment');
  await expect.poll(consumed).toBe('Got: 3');

  // Patch only the provider's header literal: the consumer element (in a
  // sibling part of the provider template) is untouched.
  const consumerRenders = await dataRenders(page, CONSUMER);
  await edit('src/hmr-context.ts', (code) =>
    code.replace('Context: HELLO', 'Context: EDITED')
  );
  await expect
    .poll(() => shadowText(page, 'hmr-ctx-provider >> h2'), {timeout: 10_000})
    .toBe('Context: EDITED');
  expect(await sameAsKept(page, 'consumer', CONSUMER)).toBe(true);
  expect(await consumed()).toBe('Got: 3');

  // Provider → consumer still flows after the second patch.
  await page.click('hmr-ctx-provider #provide-increment');
  await expect.poll(consumed).toBe('Got: 4');
  expect(Number(await dataRenders(page, CONSUMER))).toBeGreaterThan(
    Number(consumerRenders)
  );
});
