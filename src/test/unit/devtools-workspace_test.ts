import {describe, expect, test, vi} from 'vite-plus/test';
import {
  DEVTOOLS_JSON_PATH,
  createDevtoolsJsonMiddleware,
  workspaceUuid,
} from '../../lib/plugins/devtools-workspace.js';

/**
 * The reply names an absolute path on the developer's machine, so who gets it
 * matters as much as what it says.
 */

const ROOT = '/home/dev/monorepo';

const request = (url: string, remoteAddress = '127.0.0.1') => {
  const next = vi.fn();
  const res = {setHeader: vi.fn(), end: vi.fn()};
  createDevtoolsJsonMiddleware(ROOT)({url, socket: {remoteAddress}}, res, next);
  return {next, res};
};

describe('createDevtoolsJsonMiddleware', () => {
  test('answers the root and its UUID to a loopback client', () => {
    const {next, res} = request(`${DEVTOOLS_JSON_PATH}?t=1`);
    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'content-type',
      'application/json'
    );
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({
      workspace: {root: ROOT, uuid: workspaceUuid(ROOT)},
    });
  });

  test('answers IPv6 and IPv4-mapped loopback', () => {
    expect(request(DEVTOOLS_JSON_PATH, '::1').next).not.toHaveBeenCalled();
    expect(
      request(DEVTOOLS_JSON_PATH, '::ffff:127.0.0.1').next
    ).not.toHaveBeenCalled();
  });

  test('passes a client on the network on', () => {
    const {next, res} = request(DEVTOOLS_JSON_PATH, '192.168.1.20');
    expect(next).toHaveBeenCalledOnce();
    expect(res.end).not.toHaveBeenCalled();
  });

  test('passes other paths on', () => {
    expect(request('/src/main.ts').next).toHaveBeenCalledOnce();
  });
});

describe('workspaceUuid', () => {
  test('is a stable v4-shaped UUID per root', () => {
    const uuid = workspaceUuid(ROOT);
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(workspaceUuid(ROOT)).toBe(uuid);
    expect(workspaceUuid('/elsewhere')).not.toBe(uuid);
  });
});
