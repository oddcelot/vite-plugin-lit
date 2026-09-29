import {afterEach, expect, test} from 'vite-plus/test';
import {
  type Fixture,
  fsp,
  joinPath,
  mountElement,
  shadowText,
  startFixture,
} from './utils.js';

const CHILD = `import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

@customElement('cs-child')
export class CsChild extends LitElement {
  @property() label = 'none';
  @state() count = 0;
  #clicks = 0;
  render() {
    return html\`<button
        id="bump"
        @click=\${() => {
          this.#clicks++;
          this.count++;
        }}
      >
        bump
      </button>
      <span id="count">\${this.count}</span>
      <span id="private">\${this.#clicks}</span>
      <span id="label">\${this.label}</span>\`;
  }
}
`;

/** The child sits in the same template literal as the text we edit. */
const BOUND = `<cs-child .label=\${'a'}></cs-child>`;
const UNBOUND = `<cs-child></cs-child>`;

const parent = (child: string) => `import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import './cs-child.js';

@customElement('cs-parent')
export class CsParent extends LitElement {
  render() {
    return html\`<p id="title">ONE</p>${child}\`;
  }
}
`;

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

const CHILD_PATH = 'cs-parent >> cs-child';
const text = (f: Fixture, id: string) =>
  shadowText(f.page, `${CHILD_PATH} >> #${id}`);

/**
 * Starts a fixture, writes the components, mounts the parent, clicks the
 * child twice, then pins the child element and a no-reload marker.
 */
const setup = async (
  child: string,
  options: Parameters<typeof startFixture>[0] = {}
): Promise<Fixture> => {
  const f = await startFixture(options);
  fixture = f;
  await fsp.writeFile(joinPath(f.root, 'src/cs-child.ts'), CHILD);
  await fsp.writeFile(joinPath(f.root, 'src/cs-parent.ts'), parent(child));
  const load = () => f.page.evaluate(`import('/src/cs-parent.ts')`);
  // A first import can make the dep optimizer discover new deps and reload
  // the page mid-test; do it once up front, let that settle, then start clean.
  await load();
  await f.page.waitForLoadState('networkidle');
  await f.page.reload();
  await f.page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );
  await load();
  await mountElement(f.page, 'cs-parent');
  await f.page.waitForFunction(
    () =>
      document
        .querySelector('cs-parent')
        ?.shadowRoot?.querySelector('cs-child')
        ?.shadowRoot?.querySelector('#bump') != null
  );
  // Wait for each render before the next click so none race the update.
  for (let i = 1; i <= 2; i++) {
    await f.page.click('cs-child #bump');
    await expect.poll(() => text(f, 'count')).toBe(String(i));
  }
  await f.page.evaluate(() => {
    const w = window as unknown as {__marker: number; __child: unknown};
    w.__marker = 1;
    w.__child = document
      .querySelector('cs-parent')
      ?.shadowRoot?.querySelector('cs-child');
  });
  return f;
};

const marker = (f: Fixture) =>
  f.page.evaluate(
    () => (window as unknown as {__marker?: number}).__marker ?? null
  );

/** Whether the parent still renders the child element pinned in setup. */
const sameChild = (f: Fixture) =>
  f.page.evaluate(
    () =>
      (window as unknown as {__child?: unknown}).__child ===
      document.querySelector('cs-parent')?.shadowRoot?.querySelector('cs-child')
  );

/** Edits the parent's text (re-creating its template) and waits for it. */
const editParent = async (
  f: Fixture,
  more: (code: string) => string = (c) => c
) => {
  await f.edit('src/cs-parent.ts', (code) =>
    more(code.replace('>ONE<', '>TWO<'))
  );
  await expect
    .poll(() => shadowText(f.page, 'cs-parent >> #title'), {timeout: 10_000})
    .toBe('TWO');
};

test("default ('transfer'): a re-created child keeps its state", async () => {
  const f = await setup(BOUND);
  await editParent(f);

  await expect.poll(() => text(f, 'count')).toBe('2');
  expect(await text(f, 'private')).toBe('2');
  expect(await text(f, 'label')).toBe('a');
  expect(await sameChild(f)).toBe(false);
  expect(await marker(f)).toBe(1);

  // The transferred state is live, not just rendered once.
  await f.page.click('cs-child #bump');
  await expect.poll(() => text(f, 'count')).toBe('3');
  expect(await text(f, 'private')).toBe('3');
});

test('transfer leaves keys the new template binds to the template', async () => {
  const f = await setup(BOUND);
  await editParent(f, (code) => code.replace(`\${'a'}`, `\${'b'}`));

  await expect.poll(() => text(f, 'label')).toBe('b');
  expect(await text(f, 'count')).toBe('2');
  expect(await text(f, 'private')).toBe('2');
  expect(await sameChild(f)).toBe(false);
  expect(await marker(f)).toBe(1);
});

test("'reuse' puts an unbound child element back in place", async () => {
  const f = await setup(UNBOUND, {plugin: {hmr: {childState: 'reuse'}}});
  await editParent(f);

  await expect.poll(() => sameChild(f)).toBe(true);
  expect(await text(f, 'count')).toBe('2');
  expect(await text(f, 'private')).toBe('2');
  expect(await marker(f)).toBe(1);

  await f.page.click('cs-child #bump');
  await expect.poll(() => text(f, 'count')).toBe('3');
});

test("'reuse' falls back to transfer for a bound child", async () => {
  const f = await setup(BOUND, {plugin: {hmr: {childState: 'reuse'}}});
  await editParent(f, (code) => code.replace(`\${'a'}`, `\${'b'}`));

  await expect.poll(() => text(f, 'label')).toBe('b');
  expect(await text(f, 'count')).toBe('2');
  expect(await text(f, 'private')).toBe('2');
  // Give the window time to close (hard cap 1s) before judging identity.
  await f.page.waitForTimeout(1200);
  expect(await sameChild(f)).toBe(false);
  expect(await text(f, 'label')).toBe('b');
  expect(await marker(f)).toBe(1);
});

test("'reset': a re-created child starts over", async () => {
  const f = await setup(BOUND, {plugin: {hmr: {childState: 'reset'}}});
  await editParent(f);

  await expect.poll(() => text(f, 'count')).toBe('0');
  expect(await text(f, 'private')).toBe('0');
  expect(await sameChild(f)).toBe(false);
  expect(await marker(f)).toBe(1);
});
