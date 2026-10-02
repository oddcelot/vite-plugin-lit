import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vite-plus/test';
import {keepConnected} from '../../../extension/src/reconnect.js';
import type {KeptPort} from '../../../extension/src/reconnect.js';

const fakePort = () => {
  const listeners: Array<() => void> = [];
  return {
    disconnected: 0,
    onDisconnect: {addListener: (l: () => void) => void listeners.push(l)},
    disconnect() {
      this.disconnected++;
    },
    drop: () => listeners.forEach((l) => l()),
  };
};

describe('keepConnected', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  const setup = (alive = () => true) => {
    const ports: Array<ReturnType<typeof fakePort>> = [];
    let failOpen = false;
    const open = vi.fn((): KeptPort => {
      if (failOpen) throw new Error('Extension context invalidated.');
      const port = fakePort();
      ports.push(port);
      return port;
    });
    const kept = keepConnected({open, alive});
    return {
      ports,
      open,
      kept,
      fail: (v: boolean) => (failOpen = v),
    };
  };

  test('opens a port at once', () => {
    const {open} = setup();
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('reopens after a drop, backing off up to the cap', () => {
    const {ports, open, fail} = setup();
    fail(true);
    ports[0]!.drop();
    for (const wait of [250, 500, 1000, 2000, 4000, 5000, 5000]) {
      const before = open.mock.calls.length;
      vi.advanceTimersByTime(wait - 1);
      expect(open).toHaveBeenCalledTimes(before);
      vi.advanceTimersByTime(1);
      expect(open).toHaveBeenCalledTimes(before + 1);
    }
  });

  test('a port that held resets the backoff', () => {
    const {ports, open} = setup();
    ports[0]!.drop();
    vi.advanceTimersByTime(250);
    ports[1]!.drop();
    vi.advanceTimersByTime(500);
    expect(open).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(10_000);
    ports[2]!.drop();
    vi.advanceTimersByTime(250);
    expect(open).toHaveBeenCalledTimes(4);
  });

  test('stops once the extension is gone', () => {
    let alive = true;
    const {ports, open} = setup(() => alive);
    alive = false;
    ports[0]!.drop();
    vi.advanceTimersByTime(60_000);
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('gives up a pending retry when the extension goes away meanwhile', () => {
    let alive = true;
    const {ports, open} = setup(() => alive);
    ports[0]!.drop();
    alive = false;
    vi.advanceTimersByTime(60_000);
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('reconnect() replaces the port at once and ignores the old one', () => {
    const {ports, open, kept} = setup();
    kept.reconnect();
    expect(ports[0]!.disconnected).toBe(1);
    expect(open).toHaveBeenCalledTimes(2);
    // The old port's late onDisconnect must not schedule a third.
    ports[0]!.drop();
    vi.advanceTimersByTime(10_000);
    expect(open).toHaveBeenCalledTimes(2);
  });

  test('reconnect() cancels a pending retry', () => {
    const {ports, open, kept} = setup();
    ports[0]!.drop();
    kept.reconnect();
    vi.advanceTimersByTime(10_000);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
