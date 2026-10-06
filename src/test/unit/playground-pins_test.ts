import {describe, expect, test} from 'vite-plus/test';
import playground from '../../../playground/package.json' with {type: 'json'};
import core from 'vite/package.json' with {type: 'json'};
import vitePlus from 'vite-plus/package.json' with {type: 'json'};

// The playground runs on StackBlitz, where npm can't read the workspace's
// `catalog:`, so its package.json repeats the toolchain as plain versions.
// Nothing keeps those in step with the workspace but this test: a routine
// dependency update once bumped the rolldown pin past the one vite-plus-core
// bundles, which only shows up on WebContainer as "Cannot find native
// binding".
describe('playground pins', () => {
  const deps: Record<string, string> = playground.devDependencies;

  test('rolldown matches the version vite-plus-core bundles', () => {
    // On WebContainer the bundled binding reads `rolldown/package.json` to
    // pick its wasm build, so the pin must name exactly that version.
    expect(deps.rolldown).toBe(core.bundledVersions.rolldown);
  });

  test('vite points at the installed vite-plus-core', () => {
    expect(deps.vite).toBe(`npm:@voidzero-dev/vite-plus-core@${core.version}`);
  });

  test('vite-plus matches the installed vite-plus', () => {
    expect(deps['vite-plus']).toBe(vitePlus.version);
  });
});
