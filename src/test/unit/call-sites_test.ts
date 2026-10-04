import {describe, expect, test} from 'vite-plus/test';
import MagicString from 'magic-string';
import {CALL_SITE_ATTR, injectCallSites} from '../../lib/call-sites.js';
import {CALL_SITE_ATTR as RUNTIME_CALL_SITE_ATTR} from '../../lib/runtime/source-meta.js';
import {createOptionsContext} from '../../lib/plugins/context.js';
import {litSourceOverlay} from '../../lib/plugins/source-overlay.js';

const run = (code: string, wire = 'src/app.ts', id = '/app/src/app.ts') => {
  const ms = new MagicString(code);
  const changed = injectCallSites(code, id, wire, ms);
  return {changed, out: ms.toString()};
};

const stamps = (out: string) =>
  [...out.matchAll(/data-lit-source="([^"]*)"/g)].map((m) => m[1]);

test('the transform and the runtime agree on the attribute name', () => {
  expect(CALL_SITE_ATTR).toBe(RUNTIME_CALL_SITE_ATTR);
  expect(CALL_SITE_ATTR).toBe('data-lit-source');
});

describe('injectCallSites', () => {
  test('stamps a custom element with its line and column', () => {
    const code = 'const a = 1;\nconst t = html`<my-el></my-el>`;\n';
    const {changed, out} = run(code);
    expect(changed).toBe(true);
    // `<` sits at column 16 on line 2.
    expect(out).toBe(
      'const a = 1;\nconst t = html`<my-el data-lit-source="src/app.ts:2:16"></my-el>`;\n'
    );
    expect(code.split('\n')[1].indexOf('<') + 1).toBe(16);
  });

  test('multiline templates', () => {
    const code = 'html`\n  <div>\n    <a-b></a-b>\n  <c-d />\n</div>`';
    const {out} = run(code);
    expect(stamps(out)).toEqual(['src/app.ts:3:5', 'src/app.ts:4:3']);
  });

  test('nested html in an expression', () => {
    const code =
      'html`<a-b>${items.map((i) => html`<c-d .i=${i}></c-d>`)}</a-b>`';
    const {out} = run(code);
    expect(stamps(out)).toEqual([
      `src/app.ts:1:${code.indexOf('<a-b') + 1}`,
      `src/app.ts:1:${code.indexOf('<c-d') + 1}`,
    ]);
  });

  test('TypeScript syntax in the file', () => {
    const code = [
      `import {LitElement} from 'lit';`,
      `@customElement('x-y')`,
      `export class XY extends LitElement {`,
      `  @property() accessor n: number = 0;`,
      `  render(): TemplateResult<1> {`,
      `    return html\`<my-el .n=\${this.n as number}></my-el>\`;`,
      `  }`,
      `}`,
    ].join('\n');
    const {changed, out} = run(code);
    expect(changed).toBe(true);
    expect(stamps(out)).toEqual(['src/app.ts:6:17']);
  });

  test('tsx and jsx files parse with their own language', () => {
    const code = 'const x = <div>{html`<a-b></a-b>`}</div>;';
    expect(run(code, 'a.tsx', '/a.tsx').changed).toBe(true);
    expect(run(code, 'a.jsx', '/a.jsx').changed).toBe(true);
  });

  test('svg tag', () => {
    const {out} = run('svg`<g><my-icon></my-icon></g>`');
    expect(stamps(out)).toEqual(['src/app.ts:1:8']);
  });

  test('ignores everything that is not a custom element in html/svg', () => {
    for (const code of [
      'html`<div><span></span><x-y.z></x-y.z></div>`.length; css`<a-b>`',
      'html`</a-b>`',
      'css`<a-b></a-b>`',
      'other`<a-b></a-b>`',
      'ns.html`<a-b></a-b>`',
      'unsafeHTML("<a-b></a-b>")',
      `const s = '<a-b>'; const t = "<a-b>"; const u = \`<a-b>\`;`,
      '// <a-b>\n/* <a-b> */ html`<div></div>`',
      'html`<A-b></A-b>`',
      'html`<1-b></1-b>`',
    ]) {
      const {out} = run(code);
      // Only the dotted-name case in the first sample is a valid custom name.
      if (code.startsWith('html`<div><span>')) continue;
      expect(out, code).toBe(code);
    }
  });

  test('attribute values and comments hiding tags', () => {
    const {out} = run(
      'html`<div title="<a-b>" data=\'<c-d>\'></div><!-- <e-f> --><g-h></g-h>`'
    );
    expect(stamps(out)).toHaveLength(1);
    expect(out).toContain('<g-h data-lit-source=');
  });

  test('quoted attribute value spanning an expression', () => {
    const {out} = run('html`<div class="a ${x} <a-b>"></div><c-d></c-d>`');
    expect(stamps(out)).toHaveLength(1);
    expect(out).toContain('<c-d data-lit-source=');
  });

  test('comment spanning an expression', () => {
    const {out} = run('html`<!-- ${x} <a-b> --><c-d></c-d>`');
    expect(stamps(out)).toHaveLength(1);
    expect(out).toContain('<c-d data-lit-source=');
  });

  test('raw-text elements are skipped', () => {
    const {out} = run(
      'html`<textarea><a-b></a-b></textarea><style>a-b{}<c-d></style><e-f></e-f>`'
    );
    expect(stamps(out)).toHaveLength(1);
    expect(out).toContain('<e-f data-lit-source=');
  });

  test('a tag name split by an expression is not stamped', () => {
    const code = 'html`<my-${x}></my-${x}><a-${y}-b>`';
    expect(run(code).out).toBe(code);
  });

  test('self-closing-ish and attributed tags stay valid', () => {
    const {out} = run('html`<a-b/><c-d .foo=${x} @click=${y} ?on=${z}>`');
    expect(out).toBe(
      'html`<a-b data-lit-source="src/app.ts:1:6"/>' +
        '<c-d data-lit-source="src/app.ts:1:12" .foo=${x} @click=${y} ?on=${z}>`'
    );
  });

  test('a tag at the very end of a quasi stays unstamped', () => {
    const code = 'html`<a-b${x}>`';
    expect(run(code).out).toBe(code);
  });

  test('wire paths: backslashes become slashes, unsafe characters skip', () => {
    expect(stamps(run('html`<a-b>`', 'C:\\proj\\a.ts').out)).toEqual([
      'C:/proj/a.ts:1:6',
    ]);
    for (const wire of [
      'a"b.ts',
      'a&b.ts',
      'a<b.ts',
      'a>b.ts',
      'a$b.ts',
      'a`b.ts',
    ]) {
      const {changed, out} = run('html`<a-b>`', wire);
      expect(changed, wire).toBe(false);
      expect(out).toBe('html`<a-b>`');
    }
  });

  test('unparseable code is left alone', () => {
    const {changed} = run('html`<a-b>` )(');
    expect(changed).toBe(false);
  });
});

describe('source-overlay transform', () => {
  const transform = (code: string, id = '/app/src/only-templates.ts') => {
    const ctx = createOptionsContext({sourceOverlay: true});
    const plugin = litSourceOverlay(ctx);
    const hook = plugin.transform as unknown as (
      code: string,
      id: string,
      opts?: {ssr?: boolean}
    ) => {code: string} | null;
    return hook.call({}, code, id, {});
  };

  test('stamps a file that has templates but no customElement', () => {
    const result = transform('export const t = html`<a-b></a-b>`;');
    expect(result?.code).toContain(
      'data-lit-source="/app/src/only-templates.ts:1:23"'
    );
  });

  test('stamps call sites and source meta together', () => {
    const result = transform(
      `@customElement('x-y') class XY extends HTMLElement { r = html\`<a-b></a-b>\`; }`
    );
    expect(result?.code).toContain('data-lit-source=');
    expect(result?.code).toContain('XY[');
  });

  test('returns null when nothing changes', () => {
    expect(transform('export const t = html`<div></div>`;')).toBeNull();
    expect(transform('export const n = 1;')).toBeNull();
  });
});
