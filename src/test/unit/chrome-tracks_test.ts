import {describe, expect, test} from 'vite-plus/test';
import {createChromeTracksSink} from '../../lib/runtime/timeline/chrome-tracks.js';
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
