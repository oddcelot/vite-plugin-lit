import {describe, expect, test} from 'vite-plus/test';
import {hostProfile, type HostKind} from '../../lib/devframe/host-profile.js';
import {resolveOptions, toFeatureSettings} from '../../lib/options.js';

const overlayOn = toFeatureSettings(resolveOptions({sourceOverlay: true}, {}));
const overlayOff = toFeatureSettings(resolveOptions({}, {}));

describe('a live session', () => {
  const live = {live: true, nodeActions: true};

  test.each<[HostKind, object]>([
    [
      'vite',
      {
        openInEditor: true,
        exportSnapshot: true,
        hmr: true,
        sourceLocations: true,
        componentDocs: true,
      },
    ],
    [
      'standalone',
      {
        openInEditor: false,
        exportSnapshot: true,
        hmr: false,
        sourceLocations: false,
        componentDocs: true,
      },
    ],
  ])('on %s', (host, capabilities) => {
    expect(hostProfile(host, live).capabilities).toMatchObject(capabilities);
  });

  test('the extension has no Node actions, so writes nothing', () => {
    expect(hostProfile('extension', {live: true, nodeActions: false})).toEqual({
      picker: true,
      capabilities: {
        openInEditor: false,
        exportSnapshot: false,
        pluginSettings: false,
        hmr: false,
        sourceLocations: false,
        componentDocs: false,
      },
    });
  });

  test('vite picks with the source overlay, the others bring their own', () => {
    expect(hostProfile('vite', {...live, features: overlayOn}).picker).toBe(
      true
    );
    expect(hostProfile('vite', {...live, features: overlayOff}).picker).toBe(
      false
    );
    expect(hostProfile('standalone', live).picker).toBe(true);
  });

  test('plugin settings exist only where the host resolved some', () => {
    expect(
      hostProfile('vite', {...live, features: overlayOff}).capabilities
        .pluginSettings
    ).toBe(true);
    expect(hostProfile('standalone', live).capabilities.pluginSettings).toBe(
      false
    );
  });
});

test('the extension reads docs when the page links its manifests', () => {
  expect(
    hostProfile('extension', {live: true, nodeActions: false, docs: true})
      .capabilities.componentDocs
  ).toBe(true);
});

test('manifests are read only where a Node host can reach the disk', () => {
  for (const host of ['vite', 'standalone'] as const) {
    expect(
      hostProfile(host, {live: true, nodeActions: false}).capabilities
        .componentDocs
    ).toBe(false);
  }
});

test('nothing but a live session opens files or writes a snapshot', () => {
  for (const host of ['vite', 'standalone'] as const) {
    const {capabilities} = hostProfile(host, {live: false, nodeActions: true});
    expect(capabilities).toMatchObject({
      openInEditor: false,
      exportSnapshot: false,
    });
  }
});

describe('a snapshot', () => {
  test('replays what the recording host could do, with no picker', () => {
    expect(
      hostProfile('snapshot', {
        live: false,
        nodeActions: false,
        recorded: {hmr: false, sourceLocations: false},
      })
    ).toEqual({
      picker: false,
      capabilities: {
        openInEditor: false,
        exportSnapshot: false,
        pluginSettings: false,
        hmr: false,
        sourceLocations: false,
        componentDocs: false,
      },
    });
  });

  test('from before recording, assumes the Vite plugin made it', () => {
    expect(
      hostProfile('snapshot', {live: false, nodeActions: false}).capabilities
    ).toMatchObject({hmr: true, sourceLocations: true});
  });
});

test('the bare definition claims nothing a page would bring', () => {
  expect(hostProfile('none', {live: false, nodeActions: false})).toEqual({
    picker: false,
    capabilities: {
      openInEditor: false,
      exportSnapshot: false,
      pluginSettings: false,
      hmr: false,
      sourceLocations: false,
      componentDocs: false,
    },
  });
});
