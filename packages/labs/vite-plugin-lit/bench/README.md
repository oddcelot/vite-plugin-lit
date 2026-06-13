# CSS-delivery benchmark

Measures the cost of delivering one utility stylesheet to many shadow-DOM
components four ways, to back the recommendations in
[`docs/css-delivery.md`](../docs/css-delivery.md) with real numbers and
DevTools traces.

## What it compares

| Variant   | What each component does                                                        | Maps to                                   |
| --------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| `link`    | its own `<link rel="stylesheet">` in its shadow root                            | `?hmr-url`                                |
| `style`   | its own `<style>` with the CSS text inlined                                     | per-**type** `unsafeCSS(raw)` (see below) |
| `adopted` | adopts one shared constructed `CSSStyleSheet`, filled by a post-mount `fetch()` | `?css-sheet` / `urlSheet()`               |
| `inline`  | adopts one shared sheet, filled before mount                                    | inline shared module (`?raw`/`?inline`)   |

> The `style` variant gives every _instance_ its own `<style>` to expose the
> per-parse cost. In Lit, `static styles` is cached **per component class**, so
> one component type instantiated N times parses once — the `style` curve is
> what you pay when the full sheet is inlined into many distinct component
> _types_ (or inlined without caching), not per instance of one type.

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
node bench/run.mjs                                   # all variants × n 50,200,500, 300 class-groups
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

The headline is `sheets`: `link` and `style` carry one `CSSStyleSheet` object
**per element**, while `adopted`/`inline` stay at **1** regardless of N. Numbers
vary by machine; run on a quiet box and compare variants from the _same_ run,
not across runs.

## Findings (sample run)

One machine, Chrome via the DevTools MCP, **n=2000, classes=800** (~76 kB
sheet), unthrottled CPU, localhost. Single runs — directional, not precise.

| variant   | sheets | mount(ms) | LCP(ms)  | CLS      | what the trace shows                                              |
| --------- | ------ | --------- | -------- | -------- | ----------------------------------------------------------------- |
| `adopted` | **1**  | 42        | 113      | **0.42** | one parse; FOUC — late `fetch()` styles shift layout (CLS)        |
| `inline`  | **1**  | 71        | 154      | 0.00     | one parse; styled before mount → fast **and** stable              |
| `link`    | 2000   | 88        | 171      | 0.00     | render-blocking per root; parse is async + shared for same URL    |
| `style`   | 2000   | **4095**  | **4205** | 0.00     | 2000 **synchronous** parses of the 76 kB sheet → ~4 s main-thread |

What the traces revealed, beyond the naive "N parses vs 1":

1. **Inline-per-element is catastrophic at scale.** `style` blocks the main
   thread ~4 s because each `<style>` re-parses the full sheet synchronously at
   mount. This is the cost of inlining a big utility sheet into many component
   _types_. Avoid.
2. **`<link>` to a shared URL is cheaper than "N parses" suggests.** Blink
   shares the parsed stylesheet contents across same-URL `<link>`s and parses
   off the mount path, so mount stays cheap (88 ms) — but you still get N
   `CSSStyleSheet` objects, N per-root style scopes, and a component re-render
   on every HMR edit.
3. **The shared adopted sheet is the lightest to mount** (one parse, one
   object).
4. **FOUC is a real, measurable cost — it surfaces as CLS.** The fetched
   `adopted` variant paints unstyled content, then the sheet lands ~10 ms later
   and shifts layout (CLS 0.42). `inline` (or `?css-sheet` + a
   `<link rel="preload">`) keeps CLS at 0. On a real network the gap widens —
   localhost understates it.

Net: share one sheet (`adopted`/`inline`); prefer the **inline-shared** path or
preload the asset when first-paint stability (CLS) matters. Raw traces for each
row are in `results/mcp-*-n2000.json` (open in DevTools ▸ Performance).
