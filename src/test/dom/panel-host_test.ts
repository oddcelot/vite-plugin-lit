import {afterEach, expect, test, vi} from 'vite-plus/test';
import {calls, meta, resetClient, setSnapshot} from './fakes/client.js';

vi.mock('../../panel/client.js', () => import('./fakes/client.js'));

const page = vi.hoisted(() => ({
  connected: false,
  emitted: [] as Array<[string, unknown]>,
}));
vi.mock('../../panel/in-page.js', () => ({
  inPageConnected: () => page.connected,
  inPageChannel: () => ({
    emit: (name: string, arg: unknown) => page.emitted.push([name, arg]),
  }),
}));

const {hostInfo, resetHostInfo, sendToPage} =
  await import('../../panel/host.js');

afterEach(() => {
  resetClient();
  resetHostInfo();
  page.connected = false;
  page.emitted.length = 0;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const inspects = () =>
  calls.filter((c) => c.name === 'inspect').map((c) => c.args[0]);

test('reads the host once and folds snapshot mode into the picker', async () => {
  const client = await import('./fakes/client.js');
  const reads = vi.spyOn(client, 'getMeta');
  meta.picker = true;
  expect(await hostInfo()).toMatchObject({snapshot: false, picker: true});
  await hostInfo();
  expect(reads).toHaveBeenCalledOnce();
  reads.mockRestore();

  resetHostInfo();
  setSnapshot(true);
  expect(await hostInfo()).toMatchObject({snapshot: true, picker: false});
});

test('assumes nothing it would have to offer when get-meta fails', async () => {
  const client = await import('./fakes/client.js');
  vi.spyOn(client, 'getMeta').mockRejectedValueOnce(new Error('gone'));
  expect(await hostInfo()).toEqual({
    snapshot: false,
    picker: false,
    openInEditor: false,
    exportSnapshot: false,
    pluginSettings: false,
    hmr: true,
    sourceLocations: false,
    componentDocs: false,
  });
});

test('sends commands to the page, and none in a snapshot', async () => {
  sendToPage({type: 'tree'});
  await settle();
  sendToPage({type: 'details', id: 1});
  expect(inspects()).toEqual([{type: 'tree'}, {type: 'details', id: 1}]);

  setSnapshot(true);
  sendToPage({type: 'tree'});
  await settle();
  expect(inspects()).toHaveLength(2);
});

test('highlight and reveal take the direct page channel when it is up', async () => {
  page.connected = true;
  sendToPage({type: 'highlight', id: 3});
  sendToPage({type: 'reveal', id: 3});
  sendToPage({type: 'tree'});
  await settle();
  expect(page.emitted).toEqual([
    ['highlight', 3],
    ['reveal', 3],
  ]);
  expect(inspects()).toEqual([{type: 'tree'}]);

  page.connected = false;
  sendToPage({type: 'highlight', id: null});
  expect(inspects()).toContainEqual({type: 'highlight', id: null});
});
