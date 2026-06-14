# DevTools Redesign — Align with Lit Design System

Replace hardcoded colors/fonts with design token CSS custom properties,
swap the Vue-green accent for flame blue, and add the Lit flame brand mark.

## New files

| File                        | Purpose                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/tokens.ts`         | Shared design tokens — Lit `css` export for panel components + `injectTokens()` for runtime elements. Colors, typography, spacing, radius, motion from the lit-design skill. |
| `src/lib/segmented-tabs.ts` | `SegmentedTabs` Lit element — inline segmented tab control matching the design system spec. Props: `items`, `value`, `size`. Event: `change`.                                |

## Modified files — Panel (`src/panel/`)

| File                     | Changes                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeline-app.ts`        | Import `tokens` + `segmented-tabs`; `[tokens, css`...`]`; replace tab `<button>`s with `<segmented-tabs>`; add flame logo SVG to header; token colors throughout                                                                 |
| `components-view.ts`     | `[tokens, css`...`]`; all hardcoded hex → `var(--*)` token refs; green accent → flame blue (`var(--accent)` / `var(--accent-soft)`); monospace → `var(--font-mono)`; sizes → `var(--text-*)`; badges/flags → token radius/colors |
| `timeline-view.ts`       | `[tokens, css`...`]`; toolbar → token colors; record.active → `var(--error-soft)` / `var(--error)`                                                                                                                               |
| `timeline-layers.ts`     | `[tokens, css`...`]`; pills → `var(--radius-pill)`, token bg/text/hover                                                                                                                                                          |
| `timeline-event-list.ts` | `[tokens, css`...`]`; filterbar/rows/detail → token colors; hover `#1e1e26` → `var(--surface-hover)`; selected `#252530` → `var(--surface-active)`; links → `var(--accent)`                                                      |
| `devtools-settings.ts`   | `[tokens, css`...`]`; sections → token border/radius; h3 → `var(--surface-low)`; pills/table/forms → token colors; accent-color → `var(--accent)`                                                                                |

## Modified files — Runtime (`src/lib/runtime/`)

| File                 | Changes                                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `indicator.ts`       | Call `injectTokens()` in `connectedCallback`; inline styles → `var(--*)` token refs; glass bg → `var(--surface-elevated)`; separator → `var(--border-subtle)`; dot → `var(--success)`                                       |
| `overlay-element.ts` | Call `injectTokens()` in `connectedCallback`; `--lit-devtools-radius` fallback → `var(--radius-md)`                                                                                                                         |
| `template.ts`        | Tooltip bg → `var(--surface-elevated)`; text → `var(--text-strong)`; border → `var(--border-subtle)`; shadows → `var(--shadow-md)`; hover → `var(--surface-hover)`; tag/path → `var(--text-strong)`/`var(--text-secondary)` |

## Key decisions

- **Fonts**: Keep system stacks (`--font-sans`: system-ui, `--font-mono`: ui-monospace). No Manrope/Roboto Mono — saves network cost in the Vite side-panel iframe.
- **Flame logo**: Inline `flame.svg` paths in the header next to "Lit DevTools" text.
- **Dual token delivery**: Panel components consume `tokens` (Lit `css` for shadow roots); runtime components call `injectTokens()` which adds `:root { ... }` to the page head (CSS custom properties cascade into shadow DOM).
- **No light theme**: The devtools surfaces solely in the Vite DevTools dark environment.
