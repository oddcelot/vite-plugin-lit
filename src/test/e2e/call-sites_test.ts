/**
 * Call sites end to end, on a real dev server and a real browser: the dev
 * transform stamps `data-lit-source` (in an `html` template and in the HTML
 * entry file), the inspector reads it into `callSite`, the Components tab
 * shows a "rendered" link under the tag, and clicking it asks the editor to open the
 * file at that line and column.
 *
 * The editor is a stub: `LAUNCH_EDITOR` points `launch-editor` (which both the
 * panel's `open-source` RPC and `/__lit-open-in-editor` end up in) at a script
 * named `code` that writes the arguments it got to a file instead of opening
 * anything.
 */

import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {
  type Fixture,
  type PanelHandle,
  fsp,
  joinPath,
  startFixture,
  tmpRoot,
} from './utils.js';

let fixture: Fixture;
let panel: PanelHandle;
let stubDir: string;
let argsFile: string;
let previousEditor: string | undefined;

/** `line:col` (1-based) of the first `needle` in `text`. */
const positionOf = (text: string, needle: string): string => {
  const index = text.indexOf(needle);
  if (index === -1) throw new Error(`fixture has no ${needle}`);
  const before = text.slice(0, index).split('\n');
  return `${before.length}:${before.at(-1)!.length + 1}`;
};

beforeAll(async () => {
  stubDir = tmpRoot('editor');
  argsFile = joinPath(stubDir, 'args.txt');
  await fsp.mkdir(stubDir, {recursive: true});
  // Named `code` so launch-editor builds its `-g file:line:column` arguments.
  await fsp.writeFile(
    joinPath(stubDir, 'code'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\n`,
    {mode: 0o755}
  );
  previousEditor = process.env['LAUNCH_EDITOR'];
  process.env['LAUNCH_EDITOR'] = joinPath(stubDir, 'code');

  fixture = await startFixture({
    plugin: {sourceOverlay: true, timeline: true},
    panel: true,
  });
  panel = await fixture.openPanel();
});

afterAll(async () => {
  await fixture?.close();
  if (previousEditor === undefined) delete process.env['LAUNCH_EDITOR'];
  else process.env['LAUNCH_EDITOR'] = previousEditor;
  await fsp.rm(stubDir, {recursive: true, force: true});
});

test('an element in index.html is stamped with its line and column', async () => {
  const html = await fsp.readFile(joinPath(fixture.root, 'index.html'), 'utf8');
  const stamp = await fixture.page.evaluate(() =>
    document.querySelector('hmr-parent')?.getAttribute('data-lit-source')
  );
  expect(stamp).toBe(`index.html:${positionOf(html, '<hmr-parent>')}`);
});

test('an element in a template is stamped with its line and column', async () => {
  const source = await fsp.readFile(
    joinPath(fixture.root, 'src/hmr-parent.ts'),
    'utf8'
  );
  const stamp = await fixture.page.evaluate(() =>
    document
      .querySelector('hmr-parent')
      ?.shadowRoot?.querySelector('hmr-child')
      ?.getAttribute('data-lit-source')
  );
  expect(stamp).toBe(
    `src/hmr-parent.ts:${positionOf(source, '<hmr-child id="child">')}`
  );
});

/** Opens the Components tab and selects the row of `tag`, expanding to it. */
const selectInTree = async (path: string[]): Promise<void> => {
  const {page} = panel;
  await page.goto(`${fixture.origin}/__lit/#tab=components`);
  await page.reload();
  const rows = page.locator('components-view .row');
  await rows.first().waitFor();
  for (const [i, tag] of path.entries()) {
    const row = rows.filter({hasText: new RegExp(`^\\s*<${tag}>\\s*$`)});
    await row.first().waitFor();
    if (i < path.length - 1) {
      // Reveal the children unless an earlier step already expanded them.
      await row.first().locator('.twisty').click();
    } else {
      await row.first().click();
    }
  }
};

test('the Components tab links the call site and opens it at its column', async () => {
  const source = await fsp.readFile(
    joinPath(fixture.root, 'src/hmr-parent.ts'),
    'utf8'
  );
  const [line, column] = positionOf(source, '<hmr-child id="child">').split(
    ':'
  );
  await selectInTree(['hmr-parent', 'hmr-child']);

  const link = panel.page.locator('components-view button.call-site');
  await link.waitFor();
  expect((await link.textContent())?.replace(/\s+/g, ' ').trim()).toBe(
    `src/hmr-parent.ts:${line}`
  );

  await link.click();
  await expect
    .poll(() => fsp.readFile(argsFile, 'utf8').catch(() => ''), {
      timeout: 10_000,
    })
    .toMatch(/hmr-parent\.ts:\d+:\d+/);
  const args = (await fsp.readFile(argsFile, 'utf8')).trim().split('\n');
  expect(args.at(-1)).toBe(
    `${joinPath(fixture.root, 'src/hmr-parent.ts')}:${line}:${column}`
  );
  expect(panel.errors).toEqual([]);
});

test('an element written in index.html links to its place in the file', async () => {
  const html = await fsp.readFile(joinPath(fixture.root, 'index.html'), 'utf8');
  const [line, column] = positionOf(html, '<hmr-parent>').split(':');
  await fsp.rm(argsFile, {force: true});
  await selectInTree(['hmr-parent']);

  const link = panel.page.locator('components-view button.call-site');
  await link.waitFor();
  expect((await link.textContent())?.replace(/\s+/g, ' ').trim()).toBe(
    `index.html:${line}`
  );

  await link.click();
  await expect
    .poll(() => fsp.readFile(argsFile, 'utf8').catch(() => ''), {
      timeout: 10_000,
    })
    .toMatch(/index\.html:\d+:\d+/);
  const args = (await fsp.readFile(argsFile, 'utf8')).trim().split('\n');
  expect(args.at(-1)).toBe(
    `${joinPath(fixture.root, 'index.html')}:${line}:${column}`
  );
});
