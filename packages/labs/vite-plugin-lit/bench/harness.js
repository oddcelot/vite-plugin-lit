/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Browser-side bench harness. Mounts N shadow-DOM components that deliver the
 * same utility stylesheet three ways, isolating the platform primitive Lit
 * uses under the hood (vanilla custom elements — no Lit or plugin in the
 * measurement path):
 *
 *   - `link`    — each instance renders its own `<link rel="stylesheet">`
 *                 (≈ `?hmr-url`): one parsed sheet *per element*.
 *   - `style`   — each instance inlines the CSS text in its own `<style>`
 *                 (≈ per-component `unsafeCSS`): one parsed sheet *per element*.
 *   - `adopted` — every instance adopts one shared constructed `CSSStyleSheet`
 *                 (≈ `?css-sheet` / `urlSheet()`): a single parsed sheet.
 *
 * Reads `?variant=`, `?n=`, `?classes=` from the URL, mounts, then publishes
 * metrics on `window.__bench` for the runner to read.
 */

const params = new URLSearchParams(location.search);
const variant = params.get('variant') ?? 'adopted';
const n = Number(params.get('n') ?? '200');
const classes = Number(params.get('classes') ?? '300');

const cssUrl = `/util.css?classes=${classes}`;

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

const defineLink = () => {
  customElements.define(
    'bench-link',
    class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({mode: 'open'});
        r.innerHTML = `<link rel="stylesheet" href="${cssUrl}"><div class="${this.getAttribute('cls')}">x</div>`;
      }
    }
  );
};

const defineStyle = (cssText) => {
  customElements.define(
    'bench-style',
    class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({mode: 'open'});
        const style = document.createElement('style');
        style.textContent = cssText;
        r.append(style);
        const div = document.createElement('div');
        div.className = this.getAttribute('cls');
        div.textContent = 'x';
        r.append(div);
      }
    }
  );
};

const defineAdopted = (sheet) => {
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
};

const main = async () => {
  // `link` reads the URL directly; the other two need the bytes up front.
  let cssText = '';
  if (variant !== 'link') {
    cssText = await fetch(cssUrl).then((res) => res.text());
  }

  let tag;
  if (variant === 'link') {
    defineLink();
    tag = 'bench-link';
  } else if (variant === 'style') {
    defineStyle(cssText);
    tag = 'bench-style';
  } else {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
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

  // Force style + layout to flush so the measurement includes recalc, then
  // wait a frame so paint-related trace events land before we stop tracing.
  void root.offsetHeight;
  await new Promise((res) => requestAnimationFrame(() => res()));
  const mountMs = performance.now() - t0;

  const paint = performance
    .getEntriesByType('paint')
    .find((e) => e.name === 'first-contentful-paint');

  window.__bench = {
    variant,
    n,
    classes,
    distinctSheets: distinctSheets(),
    mountMs: Math.round(mountMs * 100) / 100,
    fcpMs: paint ? Math.round(paint.startTime * 100) / 100 : null,
    // Chrome-only, quantized — directional, not exact.
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
  };
};

main();
