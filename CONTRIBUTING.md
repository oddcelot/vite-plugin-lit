# Contributing

Issues and pull requests are welcome. For a bug, open an
[issue](https://github.com/oddcelot/vite-plugin-lit/issues) with the Vite and
Lit versions and, if you can, a minimal reproduction. For a larger change,
open an issue first so we can agree on the approach before you write it.

## Setup

The repository needs Node 26 and pnpm 12 (`corepack enable` picks up the
pinned version). It is one pnpm workspace: the plugin at the root, plus
`playground/` and `docs/`.

```sh
git clone https://github.com/oddcelot/vite-plugin-lit.git
cd vite-plugin-lit
pnpm install
pnpm dev             # builds the plugin, serves the playground
```

## Before you open a pull request

```sh
pnpm exec vp check   # format, lint, type check
pnpm test            # unit + e2e
```

Keep each commit to one self-contained step, with a subject in the
imperative (`Flash updated elements on the page`) and a body that says why
the change exists. Every commit carries a `Changelog:` trailer; see
[AGENTS.md](./AGENTS.md#commits-and-the-changelog) for the format.

## More

- [Development](https://oddcelot.github.io/vite-plugin-lit/contributing/development/):
  building, the playground, and the docs site
- [Testing](https://oddcelot.github.io/vite-plugin-lit/contributing/testing/):
  the unit, DOM, and e2e suites
- [Design docs](https://oddcelot.github.io/vite-plugin-lit/contributing/design-docs/)

By contributing, you agree that your contributions are licensed under the
[BSD-3-Clause license](./LICENSE).
