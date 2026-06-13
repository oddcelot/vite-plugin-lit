/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Browser-side bench harness. Mounts N shadow-DOM components that deliver the
 * same utility stylesheet four ways, isolating the platform primitive Lit uses
 * under the hood (vanilla custom elements — no Lit or plugin in the
 * measurement path). The variants populate a 2×2 of the two axes that matter:
 *
 *                    one shared sheet            sheet per element
 *   bytes fetched    adopted (`?css-sheet`)      link  (`?hmr-url`)
 *   bytes in chunk   inline  (`?raw` shared)     style (per-component `unsafeCSS`)
 *
 *   - `link`    — each instance renders its own `<link>` → N parsed sheets,
 *                 each stylesheet fetched at runtime (FOUC until it loads).
 *   - `style`   — each instance inlines the text in its own `<style>` → N
 *                 parsed sheets, bytes present at mount (no FOUC).
 *   - `adopted` — every instance adopts one shared sheet, filled by a runtime
 *                 `fetch()` *after* mount → 1 sheet, FOUC until the fetch lands.
 *   - `inline`  — one shared sheet filled *before* mount (bytes modelled as
 *                 already in the JS chunk) → 1 sheet, no FOUC.
 *
 * "bytes in chunk" variants (`style`, `inline`) read the CSS once before the
 * timed section — modelling bytes available at module eval; "fetched" variants
 * (`link`, `adopted`) load at runtime, so their fetch counts toward FOUC.
 *
 * Reads `?variant=`, `?n=`, `?classes=` from the URL, mounts, then publishes
 * metrics on `window.__bench` for the runner / MCP to read.
 */

const params = new URLSearchParams(location.search);
const variant = params.get('variant') ?? 'adopted';
const n = Number(params.get('n') ?? '200');
const classes = Number(params.get('classes') ?? '300');

const cssUrl = `/util.css?classes=${classes}`;

const raf = () => new Promise((res) => requestAnimationFrame(() => res()));

/** Pick a few real utility classes to apply, so styles actually resolve. */
const sampleClasses = (i) =>
  `u-bg-${i % classes} u-text-${(i * 7) % classes} u-p-${(i * 3) % classes}`;

/** Distinct `CSSStyleSheet` objects across the document and all shadow roots. */
const distinctSheets = () => {
  const set = new Set();
  for (const s of document.styleSheets) set.add(s);
  for (const el of document.querySelectorAll('*')) {
    const r = el.shadowRoot;
    if (r === null) continue;
    for (const s of r.styleSheets) set.add(s);
    for (const s of r.adoptedStyleSheets) set.add(s);
  }
  return set.size;
};

const defineLink = () =>
  customElements.define(
    'bench-link',
    class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({mode: 'open'});
        r.innerHTML = `<link rel="stylesheet" href="${cssUrl}"><div class="${this.getAttribute('cls')}">x</div>`;
      }
    }
  );

const defineStyle = (cssText) =>
  customElements.define(
    'bench-style',
    class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({mode: 'open'});
        const style = document.createElement('style');
        style.textContent = cssText;
        const div = document.createElement('div');
        div.className = this.getAttribute('cls');
        div.textContent = 'x';
        r.append(style, div);
      }
    }
  );

const defineAdopted = (sheet) =>
  customElements.define(
    'bench-adopted',
    class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({mode: 'open'});
        r.adoptedStyleSheets = [sheet];
        const div = document.createElement('div');
        div.className = this.getAttribute('cls');
        div.textContent = 'x';
        r.append(div);
      }
    }
  );

/** Resolves once every mounted `<link>`'s stylesheet has loaded. */
const waitForLinks = () => {
  const pending = [];
  for (const host of document.querySelectorAll('bench-link')) {
    const link = host.shadowRoot.querySelector('link');
    if (link.sheet !== null) continue;
    pending.push(
      new Promise((res) => {
        link.addEventListener('load', res, {once: true});
        link.addEventListener('error', res, {once: true});
      })
    );
  }
  return Promise.all(pending);
};

const main = async () => {
  // "bytes in chunk" variants have their CSS at module eval; model that by
  // reading it before the timed section.
  let cssText = '';
  if (variant === 'style' || variant === 'inline') {
    cssText = await fetch(cssUrl).then((r) => r.text());
  }

  let tag;
  let sheet = null;
  if (variant === 'link') {
    defineLink();
    tag = 'bench-link';
  } else if (variant === 'style') {
    defineStyle(cssText);
    tag = 'bench-style';
  } else {
    sheet = new CSSStyleSheet();
    if (variant === 'inline') sheet.replaceSync(cssText); // filled pre-mount
    defineAdopted(sheet);
    tag = 'bench-adopted';
  }

  const root = document.getElementById('root');
  const t0 = performance.now();

  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const el = document.createElement(tag);
    el.setAttribute('cls', sampleClasses(i));
    frag.append(el);
  }
  root.append(frag);

  // Force style + layout to flush, then a frame so the (possibly unstyled)
  // first paint lands — that is the FOUC window for the fetched variants.
  void root.offsetHeight;
  await raf();
  const mountMs = performance.now() - t0;

  // Resolve to "fully styled" — for fetched variants this is after the load.
  if (variant === 'link') {
    await waitForLinks();
  } else if (variant === 'adopted') {
    const txt = await fetch(cssUrl).then((r) => r.text());
    sheet.replaceSync(txt);
    cssText = txt;
    await raf();
  }
  const styledMs = performance.now() - t0;

  if (cssText === '') cssText = await fetch(cssUrl).then((r) => r.text());

  const paint = performance
    .getEntriesByType('paint')
    .find((e) => e.name === 'first-contentful-paint');

  const round = (x) => Math.round(x * 100) / 100;
  window.__bench = {
    variant,
    n,
    classes,
    distinctSheets: distinctSheets(),
    mountMs: round(mountMs),
    styledMs: round(styledMs),
    // FOUC window: time mounted-but-unstyled. ~0 for style/inline.
    foucMs: round(Math.max(0, styledMs - mountMs)),
    // Bytes that ship in the JS chunk for inline/style; live as a separate
    // cacheable asset for adopted/link.
    cssBytes: new Blob([cssText]).size,
    fcpMs: paint ? round(paint.startTime) : null,
    // Chrome-only, quantized — directional, not exact.
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
  };
};

main();
