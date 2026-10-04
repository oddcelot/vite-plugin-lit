import {expect, test, vi} from 'vite-plus/test';
import {channelListeners} from '../../lib/runtime/channel-listeners.js';

test('hands a message to every listener on its channel, and no other', () => {
  const listeners = channelListeners();
  const a = vi.fn();
  const b = vi.fn();
  const other = vi.fn();
  listeners.on('x', a);
  listeners.on('x', b);
  listeners.on('y', other);
  listeners.emit('x', 1);
  expect(a).toHaveBeenCalledWith(1);
  expect(b).toHaveBeenCalledWith(1);
  expect(other).not.toHaveBeenCalled();
});

test('a removed listener hears nothing more', () => {
  const listeners = channelListeners();
  const a = vi.fn();
  const off = listeners.on('x', a);
  off();
  listeners.emit('x', 1);
  expect(a).not.toHaveBeenCalled();
});

test('one listener throwing does not keep the message from the rest', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const listeners = channelListeners();
  const after = vi.fn();
  listeners.on('x', () => {
    throw new Error('boom');
  });
  listeners.on('x', after);
  listeners.emit('x', 1);
  expect(after).toHaveBeenCalledWith(1);
  expect(String(error.mock.calls[0]?.[0])).toContain('listener for x threw');
  error.mockRestore();
});

test('a channel with no listeners is fine', () => {
  expect(() => channelListeners().emit('nobody', 1)).not.toThrow();
});
