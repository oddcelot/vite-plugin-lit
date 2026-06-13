# CSS-delivery benchmark

Measures the cost of delivering one utility stylesheet to many shadow-DOM
components three ways, to back the recommendations in
[`docs/css-delivery.md`](../docs/css-delivery.md) with real numbers and
DevTools traces.

## What it compares

| Variant   | What each component does                             | Maps to                        |
| --------- | ---------------------------------------------------- | ------------------------------ |
| `link`    | its own `<link rel="stylesheet">` in its shadow root | `?hmr-url`                     |
| `style`   | its own `<style>` with the CSS text inlined          | per-component `unsafeCSS(raw)` |
| `adopted` | adopts one shared constructed `CSSStyleSheet`        | `?css-sheet` / `urlSheet()`    |

The harness uses **vanilla custom elements**, not Lit — the variable under test
is the platform primitive (`<link>`/`<style>` per root vs one shared
`adoptedStyleSheets`), which is exactly what Lit's `static styles` uses
underneath. Keeping Lit and the plugin out of the measurement path isolates the
CSS cost. `adopted` here is fed from a `fetch()`; an inline-shared sheet
(`?raw`/`?inline`) has the _same_ runtime parse/recalc/memory profile — it
differs only in bundling and FOUC, which a timeline trace doesn't capture.

## Setup

Requires Node ≥ 20 and a Chrome/Chromium. The runner uses Chrome via
playwright-core's `chrome` channel by default — the same setup as the e2e
suite. If you don't have system Chrome:

```sh
npx playwright install chromium
BENCH_CHROME="$(node -e "console.log(require('playwright-core').chromium.executablePath())")" node bench/run.mjs
```

No build step and no dev server: the runner serves the harness itself and
generates the synthetic utility sheet on the fly.

## Run

From the package root (`packages/labs/vite-plugin-lit`):

```sh
node bench/run.mjs                                   # variants link,style,adopted × n 50,200,500, 300 class-groups
node bench/run.mjs --n 100,1000 --classes 600        # custom component counts / sheet size
node bench/run.mjs --variants link,adopted           # subset of variants
BENCH_HEADED=1 node bench/run.mjs                     # watch the browser
```

Flags: `--variants a,b,c`, `--n 50,200,500`, `--classes 300` (utility groups;
~3 CSS rules each). Env: `BENCH_HEADED=1`, `BENCH_CHROME=/path/to/chrome`.

## Output

Everything lands in [`results/`](./results/) (git-ignored):

- `summary.json` — every row of metrics.
- `trace-<variant>-n<N>-c<C>.json` — a DevTools timeline trace per run. Open
  Chrome DevTools ▸ **Performance** ▸ **Load profile…** and pick the file to
  inspect `ParseAuthorStyleSheet`, `UpdateLayoutTree` (style recalc), and
  `Layout` events directly.

The console prints a table:

| metric       | meaning                                                          |
| ------------ | ---------------------------------------------------------------- |
| `sheets`     | distinct `CSSStyleSheet` objects across all roots (the headline) |
| `parse(ms)`  | summed `ParseAuthorStyleSheet` self-time                         |
| `recalc(ms)` | summed style-recalc self-time                                    |
| `layout(ms)` | summed `Layout` self-time                                        |
| `mount(ms)`  | wall time to create + insert + flush layout for N elements       |
| `fcp(ms)`    | first-contentful-paint                                           |
| `heap(MB)`   | `usedJSHeapSize` after mount (Chrome-only, quantized)            |

## Reading it

The headline is `sheets`: `link` and `style` scale **linearly** with component
count (one parsed sheet per element), while `adopted` stays at **1** regardless
of N — which is why parse time and heap diverge as N grows. Numbers vary by
machine; run on a quiet box and compare variants from the _same_ run, not
across runs.
