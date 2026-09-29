import {afterEach, expect, test} from 'vite-plus/test';
import {
  type Fixture,
  fsp,
  joinPath,
  mountElement,
  shadowText,
  startFixture,
} from './utils.js';

const COMPONENT = `import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';

@customElement('hmr-private')
export class HmrPrivate extends LitElement {
  #count = 0;
  get #label() {
    return 'Count';
  }
  #bump() {
    this.#count++;
  }
  render() {
    return html\`<button
      id="bump"
      @click=\${() => {
        this.#bump();
        this.requestUpdate();
      }}
    >
      Count: \${this.#count}
    </button>\`;
  }
}
`;

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

/** Starts a fixture, adds the private-field component, mounts it, clicks 3x. */
const setup = async (
  options: Parameters<typeof startFixture>[0]
): Promise<Fixture> => {
  const f = await startFixture(options);
  fixture = f;
  await fsp.writeFile(joinPath(f.root, 'src/hmr-private.ts'), COMPONENT);
  const load = () => f.page.evaluate(`import('/src/hmr-private.ts')`);
  // A first import can make the dep optimizer discover new deps and reload
  // the page mid-test; do it once up front, let that settle, then start clean.
  await load();
  await f.page.waitForLoadState('networkidle');
  await f.page.reload();
  await f.page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );
  await load();
  await mountElement(f.page, 'hmr-private');
  // Wait for each render before the next click so none race the update.
  for (let i = 1; i <= 3; i++) {
    await f.page.click('hmr-private #bump');
    await expect
      .poll(() => shadowText(f.page, 'hmr-private >> #bump'))
      .toBe(`Count: ${i}`);
  }
  await f.page.evaluate(() => {
    (window as unknown as {__marker: number}).__marker = 1;
  });
  return f;
};

const marker = (f: Fixture) =>
  f.page.evaluate(
    () => (window as unknown as {__marker?: number}).__marker ?? null
  );

test('native #private members are hot-patched in place, state intact', async () => {
  const {page, edit} = await setup({});

  await edit('src/hmr-private.ts', (code) =>
    code.replace('Count: ${', 'Tally: ${')
  );

  await expect
    .poll(() => shadowText(page, 'hmr-private >> #bump'), {timeout: 10_000})
    .toBe('Tally: 3');
  expect(await marker(fixture!)).toBe(1);

  // The new class's methods run against the old instance's private state.
  await page.click('hmr-private #bump');
  await expect
    .poll(() => shadowText(page, 'hmr-private >> #bump'))
    .toBe('Tally: 4');
  expect(await marker(fixture!)).toBe(1);
});

test('control: with privateFields off the patched render throws on old instances', async () => {
  const {page, edit} = await setup({plugin: {hmr: {privateFields: false}}});
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await edit('src/hmr-private.ts', (code) =>
    code.replace('Count: ${', 'Tally: ${')
  );

  // No reload: the patched render throws on the old instance's missing
  // private brand, so the DOM never gets the new text.
  await expect
    .poll(() => errors.some((e) => e.includes('private member')), {
      timeout: 10_000,
    })
    .toBe(true);
  expect(await marker(fixture!)).toBe(1);
  expect(await shadowText(page, 'hmr-private >> #bump')).toBe('Count: 3');
});
