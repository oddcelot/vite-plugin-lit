import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {
  chromeTracksSupported,
  createChromeTracksSink,
  userTimingStamp,
} from '../../lib/runtime/timeline/chrome-tracks.js';
import type {TimelineEvent} from '../../types/timeline.js';

const setup = () => {
  const calls: unknown[][] = [];
  const sink = createChromeTracksSink(
    (...args) => void calls.push(args),
    (t) => t + 1000
  );
  return {calls, sink};
};

const ev = (e: Partial<TimelineEvent>): TimelineEvent =>
  ({layerId: 'lit-lifecycle', time: 0, data: {}, ...e}) as TimelineEvent;

describe('chrome tracks sink', () => {
  test('pairs a lifecycle start/end into one stamp', () => {
    const {calls, sink} = setup();
    const base = {subtitle: 'x-a', groupId: 'a:1'};
    sink.push(ev({...base, title: 'performUpdate:start', time: 5}));
    sink.push(ev({...base, title: 'performUpdate:end', time: 12}));
    expect(calls).toEqual([
      ['<x-a> performUpdate', 1005, 1012, 'Lifecycle', 'Lit', 'primary'],
    ]);
  });

  test('nested phases in one group pair independently', () => {
    const {calls, sink} = setup();
    const base = {subtitle: 'x-a', groupId: 'a:1'};
    sink.push(ev({...base, title: 'performUpdate:start', time: 1}));
    sink.push(ev({...base, title: 'willUpdate:start', time: 2}));
    sink.push(ev({...base, title: 'willUpdate:end', time: 3}));
    sink.push(ev({...base, title: 'performUpdate:end', time: 4}));
    expect(calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ['<x-a> willUpdate', 1002, 1003],
      ['<x-a> performUpdate', 1001, 1004],
    ]);
  });

  test('ignores an unmatched end', () => {
    const {calls, sink} = setup();
    sink.push(ev({title: 'update:end', groupId: 'a:1'}));
    expect(calls).toEqual([]);
  });

  test('stamps input instants as zero-length on the Input track', () => {
    const {calls, sink} = setup();
    sink.push(ev({layerId: 'keyboard', title: 'Enter', time: 7}));
    expect(calls).toEqual([['Enter', 1007, 1007, 'Input', 'Lit', 'tertiary']]);
  });

  test('error logType uses the error colour', () => {
    const {calls, sink} = setup();
    sink.push(ev({layerId: 'lit-render', title: 'boom', logType: 'error'}));
    expect(calls[0]?.[5]).toBe('error');
  });

  test('skips unknown layers', () => {
    const {calls, sink} = setup();
    sink.push(ev({layerId: 'nope', title: 'x'}));
    expect(calls).toEqual([]);
  });

  test('reset drops pending starts', () => {
    const {calls, sink} = setup();
    sink.push(ev({title: 'update:start', groupId: 'g'}));
    sink.reset();
    sink.push(ev({title: 'update:end', groupId: 'g'}));
    expect(calls).toEqual([]);
  });

  test('caps pending starts, dropping the oldest', () => {
    const {calls, sink} = setup();
    for (let i = 0; i < 1001; i++) {
      sink.push(ev({title: 'update:start', groupId: `g${i}`}));
    }
    sink.push(ev({title: 'update:end', groupId: 'g0'}));
    expect(calls).toEqual([]);
    sink.push(ev({title: 'update:end', groupId: 'g1000'}));
    expect(calls).toHaveLength(1);
  });
});

describe('chrome tracks support', () => {
  const brands = (version: string) => ({
    userAgentData: {
      brands: [
        {brand: 'Not.A/Brand', version: '99'},
        {brand: 'Chromium', version},
      ],
    },
  });

  test('reads the Chromium brand where userAgentData exists', () => {
    expect(chromeTracksSupported(brands('134'))).toBe(true);
    expect(chromeTracksSupported(brands('141'))).toBe(true);
    expect(chromeTracksSupported(brands('133'))).toBe(false);
  });

  test('falls back to the UA string outside a secure context', () => {
    const ua = (v: number) =>
      `Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`;
    expect(chromeTracksSupported({userAgent: ua(134)})).toBe(true);
    expect(chromeTracksSupported({userAgent: ua(120)})).toBe(false);
  });

  test('is off in Firefox, Safari and without a navigator', () => {
    expect(
      chromeTracksSupported({
        userAgent:
          'Mozilla/5.0 (Macintosh; rv:140.0) Gecko/20100101 Firefox/140.0',
      })
    ).toBe(false);
    expect(
      chromeTracksSupported({
        userAgent:
          'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      })
    ).toBe(false);
    expect(chromeTracksSupported(undefined)).toBe(false);
  });
});

describe('user timing stamp', () => {
  afterEach(() => vi.restoreAllMocks());

  test('a range is a measure and a marker a mark, both named and cleared', () => {
    const measure = vi.spyOn(performance, 'measure');
    const mark = vi.spyOn(performance, 'mark');
    const clearMeasures = vi.spyOn(performance, 'clearMeasures');
    const clearMarks = vi.spyOn(performance, 'clearMarks');

    userTimingStamp('<x-a> update', 1, 3, 'Lifecycle', 'Lit', 'primary');
    expect(measure).toHaveBeenCalledWith('lit:Lifecycle <x-a> update', {
      start: 1,
      end: 3,
    });
    expect(clearMeasures).toHaveBeenCalledWith('lit:Lifecycle <x-a> update');

    userTimingStamp('click', 2, 2, 'Input', 'Lit', 'tertiary');
    expect(mark).toHaveBeenCalledWith('lit:Input click', {startTime: 2});
    expect(clearMarks).toHaveBeenCalledWith('lit:Input click');

    // Nothing stays in the page's own timeline.
    expect(performance.getEntriesByType('measure')).toEqual([]);
    expect(
      performance
        .getEntriesByType('mark')
        .filter((e) => e.name.startsWith('lit:'))
    ).toEqual([]);
  });

  test('a time the browser refuses is dropped, not thrown', () => {
    expect(() =>
      userTimingStamp('x', -5, -5, 'Input', 'Lit', 'tertiary')
    ).not.toThrow();
  });
});
