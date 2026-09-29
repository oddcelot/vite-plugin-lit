/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/// <reference lib="esnext.temporal" />

import {afterAll, beforeAll, describe, expect, test, vi} from 'vite-plus/test';
import {serialize, typeTag} from '../../lib/runtime/inspector/serialize.js';

// The serializer checks `instanceof Node` for DOM previews; the unit project
// runs in plain Node, which has no DOM.
beforeAll(() => vi.stubGlobal('Node', class {}));
afterAll(() => vi.unstubAllGlobals());

describe('Temporal values', () => {
  const cases = [
    [
      Temporal.Instant.from('2026-09-29T07:00:00Z'),
      'Temporal.Instant',
      'Temporal.Instant(2026-09-29T07:00:00Z)',
    ],
    [
      Temporal.PlainDate.from('2026-09-29'),
      'Temporal.PlainDate',
      'Temporal.PlainDate(2026-09-29)',
    ],
    [
      Temporal.ZonedDateTime.from('2026-09-29T09:00:00+02:00[Europe/Vienna]'),
      'Temporal.ZonedDateTime',
      'Temporal.ZonedDateTime(2026-09-29T09:00:00+02:00[Europe/Vienna])',
    ],
    [
      Temporal.Duration.from({minutes: 5}),
      'Temporal.Duration',
      'Temporal.Duration(PT5M)',
    ],
  ] as const;

  test.each(cases)(
    '%s previews with its kind and ISO form',
    (value, tag, preview) => {
      expect(typeTag(value)).toBe(tag);
      expect(serialize(value)).toBe(preview);
    }
  );

  test('nested Temporal values preview inside objects', () => {
    const value = {due: Temporal.PlainDate.from('2026-10-01')};
    expect(serialize(value)).toBe('{due: Temporal.PlainDate(2026-10-01)}');
  });

  test('recognises polyfilled values by their toStringTag', () => {
    // What a polyfill's Instant looks like to the serializer on a page with
    // no native Temporal: a class instance tagged per the spec.
    class Instant {
      get [Symbol.toStringTag]() {
        return 'Temporal.Instant';
      }
      toString() {
        return '2026-09-29T07:00:00Z';
      }
    }
    expect(typeTag(new Instant())).toBe('Temporal.Instant');
    expect(serialize(new Instant())).toBe(
      'Temporal.Instant(2026-09-29T07:00:00Z)'
    );
  });

  test('Date previews are unchanged', () => {
    expect(serialize(new Date('2026-09-29T07:00:00Z'))).toBe(
      '2026-09-29T07:00:00.000Z'
    );
  });
});
