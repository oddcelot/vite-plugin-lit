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

One machine, **n=3000, classes=800** (~76 kB sheet), unthrottled CPU,
localhost — directional, not precise. Reproduced across runs unless noted.

| variant   | sheets | mount(ms) | nodes  | uaMem(MB) | fouc(ms) |
| --------- | ------ | --------- | ------ | --------- | -------- |
| `adopted` | **1**  | **32**    | 12 017 | **2.6**   | 12       |
| `inline`  | **1**  | 42        | 12 017 | 2.7       | 0        |
| `style`   | 3000   | 53        | 18 017 | 3.3       | 0        |
| `link`    | 3000   | 88        | 15 017 | 3.2       | 1        |

1. **Distinct `CSSStyleSheet` objects scale N vs 1** (deterministic) — but the
   engine **shares the parsed CSS _contents_** for identical sources (same-URL
   `<link>`, byte-identical inline `<style>`). So the per-element cost is N
   wrapper objects + N extra DOM nodes + N per-root style scopes, **not** N
   parses. (An early MCP trace showed a one-off ~4 s `style` mount that did not
   reproduce — parsing is shared; don't chase that number.)
2. **The one-sheet variants mount fastest** — `adopted` 32 ms vs `link` 88 ms
   at n=3000 (~1.5–2.7×). `link` is slowest (an extra node + the resource-load
   machinery per element).
3. **Per-element delivery costs modestly more memory**: ~0.6 MB extra agent
   memory at 3000 elements (`measureUserAgentSpecificMemory`), from the wrapper
   objects and extra DOM nodes (`link` +N nodes, `style` +2N). `usedJSHeapSize`
   barely moves and misses it — which is why the harness uses the UA-memory API
   and reports `nodes`.
4. **FOUC is the real differentiator.** The fetched `adopted` variant mounts
   unstyled and styles ~10 ms later; in a DevTools trace that showed up as
   **CLS 0.42** (a failing Core Web Vital). `inline`/`style`/`link` don't shift.
   On a real network the gap widens — localhost understates it.
5. **Non-perf:** `link` re-renders the component on every HMR edit; the shared
   adopted sheet hot-swaps in place.

Net: share one sheet (`adopted`/`inline`) — fewest objects, nodes, and bytes,
fastest mount. Prefer the **inline-shared** path, or `?css-sheet` + a
`<link rel="preload">`, when first-paint stability (CLS) matters; plain
`?css-sheet` trades a brief shift for an independently cacheable asset. Raw
traces are in `results/` (open in DevTools ▸ Performance).
