# Delivering CSS to shadow roots

How to get a stylesheet — especially a large, shared utility sheet (Tailwind,
UnoCSS, hundreds of classes) — into many Lit components, and what each option
costs at scale. The plugin's helpers are described in the
[package README](../README.md#stylesheets); this is the decision guide behind
them.

## The principle that dominates at scale

Share a **single `CSSStyleSheet` object**, adopted by every component:
parse-once, store-once, match-cheap. Styles don't pierce shadow boundaries, so
every component that uses the utility classes must carry the rules — the only
question is whether they share one parsed sheet or each build their own.

That splits the options into two camps:

| Approach                                                            | Shares one sheet?      | Parse cost @ N comps  | Bytes live in        | FOUC        | HMR                      |
| ------------------------------------------------------------------- | ---------------------- | --------------------- | -------------------- | ----------- | ------------------------ |
| **`?css-sheet` / `urlSheet()`**                                     | ✅                     | **1**                 | standalone `.css`    | yes (brief) | in-place, no re-render   |
| **inline shared module** (`?raw`/`?inline` → one constructed sheet) | ✅                     | **1**                 | JS chunk             | **none**    | in-place, no re-render   |
| `?hmr-url` (`<link>` per instance)                                  | ❌ per instance        | **N**                 | standalone `.css`    | per-link    | re-renders the component |
| per-component `unsafeCSS(raw)` in each `static styles`              | ❌ per component class | **# component types** | duplicated per chunk | none        | re-renders               |

The bottom two **do not scale** for a shared utility layer: `<link>` builds a
separate parsed sheet per element (the HTTP cache dedupes the _bytes_, not the
parsed CSSOM), and per-component `unsafeCSS` parses once per component class and
duplicates the bytes into every chunk. Use them only for one-off,
component-local styles.

## Choosing between the two sharing options

Both give identical runtime semantics — one parse, one shared sheet, in-place
HMR with zero component re-render (the shared module self-accepts the dep and
`replaceSync()`s, so it never re-creates the sheet object). The only real
difference is where the bytes live:

- **`?css-sheet`** keeps the CSS a **separate, content-hashed `.css` asset**:
  independently HTTP-cacheable, kept out of the JS chunks, and the cleanest dev
  story when a framework regenerates the file constantly (no bundle churn).
  Cost: a brief flash of unstyled content while the runtime `fetch()` resolves.
- **inline shared module** ships the bytes **in a JS chunk** (import the CSS
  `?raw`/`?inline`, build one `new CSSStyleSheet()`, `replaceSync()` it,
  `export default` it): no FOUC, no extra request, available synchronously.
  Cost: not independently cacheable, and a CSS change invalidates that chunk.

### Recommendation for Tailwind / UnoCSS

- **Production, purged sheet (usually a few KB):** either works; if a
  FOUC-free first paint matters most, prefer the **inline shared module**.
- **Large sheet, want it cached as its own asset, or heavy dev regeneration:**
  prefer **`?css-sheet`**. Mitigate the FOUC with a
  `<link rel="preload" as="style" href="…">` in the document head so the fetch
  is already in flight when components mount.

## Two reassurances about "hundreds of classes"

1. **Recalc stays cheap.** Utility classes are single-class selectors;
   browsers bucket rules by their rightmost simple selector, so classes a given
   shadow root never uses cost ~nothing to match. A big utility sheet adopted
   everywhere is not a style-recalc problem.
2. **Memory is one copy** no matter how many roots adopt it — the whole win
   over `<link>`/`<style>` duplicated per root.

## Composition

`adoptedStyleSheets` takes an array, so layer a shared utility sheet under
each component's own styles:

```ts
import utilitySheet from './utility.css?css-sheet';

class MyEl extends LitElement {
  static styles = [
    utilitySheet,
    css`
      /* component-specific rules */
    `,
  ];
}
```

## Measuring it yourself

The claims above (distinct parsed sheets, parse/recalc time, heap) are
reproducible — see [`bench/`](../bench/README.md), which drives the variants in
a real browser and captures DevTools timeline traces.
