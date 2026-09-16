/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vitest';
import {
  type Fixture,
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

const userText = () => shadowText(fixture.page, 'hmr-task >> #user');

const fetchCount = () =>
  fixture.page.evaluate(
    () => (window as unknown as {__fakeFetches: number}).__fakeFetches
  );

test('Task value survives a patch without re-fetching; args still re-run it', async () => {
  const {page, edit} = fixture;

  // Initial fetch completes through the pending state.
  await expect.poll(userText, {timeout: 10_000}).toContain('Ada Lovelace');
  expect(await fetchCount()).toBe(1);

  // An args change (next user) re-runs the task: pending, then user 2.
  await page.click('hmr-task #next-user');
  await expect.poll(userText, {timeout: 10_000}).toContain('Grace Hopper');
  expect(await fetchCount()).toBe(2);

  await keepShadow(page, 'user-p', 'hmr-task >> #user');
  await keepShadow(page, 'task-host', 'hmr-task');

  // Patch the header literal: the loaded content must stay rendered with
  // DOM identity intact, and — crucially — the task must NOT re-fetch
  // (the patch's update re-evaluates args(), which are shallow-equal).
  await edit('src/hmr-task.ts', (code) =>
    code.replace('Task: HELLO', 'Task: EDITED')
  );
  await expect
    .poll(() => shadowText(page, 'hmr-task >> h2'), {timeout: 10_000})
    .toBe('Task: EDITED');

  expect(await userText()).toContain('Grace Hopper');
  expect(await sameAsKept(page, 'user-p', 'hmr-task >> #user')).toBe(true);
  expect(await sameAsKept(page, 'task-host', 'hmr-task')).toBe(true);
  expect(await fetchCount()).toBe(2);

  // The instance-level Task controller is still wired to the patched
  // class: another args change goes pending and fetches user 3.
  await page.click('hmr-task #next-user');
  await expect.poll(userText, {timeout: 10_000}).toContain('Katherine Johnson');
  expect(await fetchCount()).toBe(3);
});
