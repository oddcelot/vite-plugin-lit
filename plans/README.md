# Design docs

Lasting design rationale: what each part is, why it is shaped that way, and the
invariants a maintainer must not break. Step-by-step execution plans are not
kept here.

- [devframe-foundation.md](./devframe-foundation.md): the panel as a Devframe
  definition, the source port, and the agent surface.
- [devtools-timeline.md](./devtools-timeline.md): timeline capture layers, clock
  and grouping, and the `virtual:lit-plugin/timeline` API.
- [devtools-features.md](./devtools-features.md): HMR diagnostics, agent access,
  the update explainer, CLI and MCP, snapshots, deep links, editor opens,
  settings.
- [devtools-redesign.md](./devtools-redesign.md): design tokens and theming
  shared by the panel and runtime elements.
- [css-sheet-inline-build.md](./css-sheet-inline-build.md): `?css-sheet` build
  modes and library builds.
- [docs-site.md](./docs-site.md): the Astro and Starlight documentation site.
- [release-tooling.md](./release-tooling.md): tag-driven releases, changelog
  drafting, and rejected alternatives.
