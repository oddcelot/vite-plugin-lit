import {expect, test} from 'vite-plus/test';
import {
  SETTINGS_STATE_KEY,
  createSettingsGate,
  settleSettings,
  type SettingsSyncClient,
} from '../../panel/settings-sync.js';

/** A client whose shared-state fetch resolves only when the test says so. */
const fakeClient = (backend = 'websocket') => {
  const log: string[] = [];
  let release!: () => void;
  const synced = new Promise<void>((r) => (release = r));
  const client: SettingsSyncClient & {log: string[]} = {
    log,
    base: {
      connectionMeta: {backend},
      sharedState: {
        get: async (key) => {
          log.push(`get ${key}`);
          await synced;
          log.push('synced');
        },
      },
    },
  };
  return {client, release, log};
};

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test('the gate holds the client back until the settings state has synced', async () => {
  const {client, release, log} = fakeClient();
  const gate = createSettingsGate(async () => client);
  const got = gate().then((c) => {
    log.push('write');
    return c;
  });
  await tick();
  expect(log).toEqual([`get ${SETTINGS_STATE_KEY}`]);
  release();
  expect(await got).toBe(client);
  expect(log).toEqual([`get ${SETTINGS_STATE_KEY}`, 'synced', 'write']);
});

test('every caller shares one sync per connection', async () => {
  const {client, release, log} = fakeClient();
  let connects = 0;
  const gate = createSettingsGate(async () => (connects++, client));
  const all = Promise.all([gate(), gate(), gate()]);
  release();
  await all;
  await gate();
  expect(connects).toBe(1);
  expect(log.filter((l) => l.startsWith('get'))).toHaveLength(1);
});

test('a failed sync does not block writes', async () => {
  const client: SettingsSyncClient = {
    base: {
      sharedState: {
        get: async () => {
          throw new Error('no store');
        },
      },
    },
  };
  await expect(settleSettings(client)).resolves.toBeUndefined();
});

test('a static snapshot has no server to sync with', async () => {
  const {client, log} = fakeClient('static');
  await settleSettings(client);
  expect(log).toEqual([]);
});
