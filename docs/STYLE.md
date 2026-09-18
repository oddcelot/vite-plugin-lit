# Docs style guide

Every page on the site follows this. When a rule here and a habit disagree,
the rule wins; when this file is silent, write the way the Vite and Astro
docs do.

## Voice

- Second person, present tense. Write to one developer at a keyboard.
- Lead with the payoff. Say what the reader gets, then how.
- Sentences run 12–18 words, hard cap 25. One idea per sentence.
- At most one dash per sentence. Prefer a full stop.
- Keep every technical claim. Drop every hedge.
- Never open with "You want this when…". Use the opener below.

## Page opener

Two sentences, no heading, straight after the imports:

1. The outcome: what the reader can do after this page.
2. The scope: who should skip it, or what to read first.

Tutorials add a third sentence with the time it takes and the prerequisites.

## Define terms at first use

The first time a term appears on a page, define it in the same sentence in
plain words. Later pages may link the concept page instead. Use these
phrasings:

| Term                  | First-use phrasing                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| hot patch             | an edit applied to the running page without a reload                                                         |
| template interning    | reusing the same template object for identical template text, so Lit sees an unchanged template as unchanged |
| canonical class       | the class the browser registered first; the plugin updates it in place instead of replacing it               |
| self-accepting module | a module that tells Vite it can apply its own updates, so an edit stops there instead of reloading the page  |
| incompatible patch    | a component shape the plugin cannot update in place, so it reloads or warns instead                          |
| shared stylesheet     | one `CSSStyleSheet` object adopted by many shadow roots                                                      |
| FOUC                  | a brief flash of unstyled content while a stylesheet is still loading                                        |
| devframe              | the small framework the panel is built on; it runs inside Vite DevTools, in its own tab, or from the CLI     |
| dock                  | a panel slot inside Vite DevTools; the Lit panel is the `lit` dock                                           |
| layer                 | one category of recorded timeline events, with its own colour and toggle                                     |
| Vite DevTools         | the browser overlay from `@vitejs/devtools` that hosts plugin panels                                         |

## One page, one job (Diátaxis)

- **Start here** pages are tutorials. Numbered steps; every step ends with a
  check the reader can see.
- **Guides** do one task each. Imperative title ("Open a component in your
  editor"). Assume the reader knows why; link to Concepts for the why.
- **Concepts** explain. No steps, no option tables.
- **Reference** states facts. Tables and signatures, no persuasion, one
  consistent shape per entry.

Never mix. When a guide starts explaining, cut the paragraph and link.

## Code blocks

- Every block is a complete file or a complete shell session. No bare
  fragments.
- Always `title="path/from/project/root"`. Shell blocks use
  `frame="terminal"` and no title.
- Highlight the lines the page is about with `{3-5}`. Show edits with
  `ins={…}` / `del={…}`, or a ` ```diff lang="ts" ` fence.
- Available (expressive-code 0.44): `frames`, `shiki`, `text-markers`.
  Not available: `showLineNumbers`, `collapse`, `// [!code …]` comments.
- Playground-sourced examples are imported, not pasted, so they cannot rot:
  (paths below are from a page directly under `src/content/docs/`; add one
  `../` per subdirectory)

  ```mdx
  import {Code} from '@astrojs/starlight/components';
  import src from '../../../../playground/src/hmr-siblings.ts?raw';
  import {stripHeader} from '../../lib/fixture';

  <Code
    code={stripHeader(src)}
    lang="ts"
    title="src/hmr-siblings.ts"
    mark={[12]}
  />
  ```

- Hand-written blocks are only for files that have no fixture:
  `vite.config.ts`, `tsconfig.json`, `.env.local`, MCP JSON, and the tutorial
  files under `examples/tutorial/` (verified by hand in a scaffolded project;
  see its README).
- Component examples include the import lines, the `@customElement` line, the
  class, and `render()`.

## Asides

- `note`: a fact that changes what the reader does next.
- `tip`: an optional shortcut.
- `caution`: data loss, silent failure, security.
- At most two per page. Never open a page with one.

## Related footer

Exactly two `LinkCard`s under `## Related`: one step deeper (a reference or
concept page), one sideways (the next task). Tutorial pages link forward to
Guides only.

## Screenshots

- `docs/src/assets/shots/<subject>.<light|dark>.png`, captured at 2x by
  `pnpm run docs:shots`, cropped to the UI in question.
- Render through `<ThemedImage light={…} dark={…} alt="…" />`.
- Alt text says what the reader should notice, not what the image is.
- Recapture after any panel or indicator redesign.

## Keeping reference in lockstep

`reference/options` mirrors the JSDoc in `src/lib/plugin.ts`. When an option
changes, change both in the same commit.
