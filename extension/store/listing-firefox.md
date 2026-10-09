# Firefox Add-ons (AMO) listing: Lit Inspector

Copy for addons.mozilla.org, field by field, in the order the submission
asks for it. The upload and the source package come from

```sh
pnpm run package:extension --firefox
```

which writes `dist/lit-inspector-<version>-firefox.zip` and
`dist/amo-source-<version>.zip`. Run it on the release tag with a clean
working tree. The screenshots are the ones next to this file, shared with
the Chrome listing (`listing.md`).

New versions after the first go out from CI: the release workflow's
`firefox-add-ons` job builds both files from the tag and submits them with
`web-ext sign`, once approved in the `stores` environment. It sends the
version notes and the "Notes for reviewers" below
(`scripts/amo-metadata.mjs` reads them from this file), so edit them here.

## Submit a New Add-on

**How to distribute**

On this site (listed on addons.mozilla.org).

**Compatible applications**

Firefox only. Not Firefox for Android: the extension is a DevTools panel, and
Android has no DevTools.

**Upload**

`lit-inspector-<version>-firefox.zip`. Its add-on id,
`lit-inspector@oddcelot.github.io`, is fixed from the first upload.

**Do you need to submit source code?**

Yes. The extension is bundled with Vite. Upload `amo-source-<version>.zip`
and paste the notes under [Notes for reviewers](#notes-for-reviewers).

## Describe Add-on

**Name**

Lit Inspector

**Add-on URL**

`lit-inspector`

**Summary** (250 characters at most)

Inspect Lit web components on any page, production builds included: component
tree, properties, updates and a timeline, in a Lit tab in Firefox DevTools.

**Description**

```text
Lit Inspector adds a Lit tab to Firefox DevTools for inspecting the Lit web components on a page: sites you don't serve, production builds, and pages whose Content Security Policy blocks injected script tags.

What it shows
- Components: the tree of Lit elements on the page. Select one to see its reactive properties, state, attributes and controllers. Pick selects an element by clicking it in the page.
- Updates: which components updated during a recording, how often, which properties changed, and how long each update took.
- Timeline: recorded lifecycle events (performUpdate, willUpdate, update, updated) with their timings, filterable by element and layer, as tracks on a time axis or as a list.
- Settings: appearance, and an option that writes Lit's updates as User Timing markers, so they show in the Firefox Profiler next to the browser's own work.

How to use it
1. Open the page, then Lit Inspector from the Extensions button in the toolbar.
2. Click "Enable on this site". Firefox asks for access to that site; allow it and the page reloads.
3. Open DevTools and go to the Lit tab. Click "Disable on this site" in the popup or at the bottom of the tab to turn it off again.

The extension asks for no site access at install and does nothing on a site until you enable it there. Firefox can't name a port in site access, so enabling a site covers every port on that host: enabling localhost:5173 enables localhost.

On production builds
Lit's production build is supported: the component tree, the inspector and the lifecycle timeline work. Some features need Lit's development build or a dev server and are not available from the extension: render events (Lit emits them only in development), source locations and open-in-editor, HMR history, and exporting a snapshot. For those, use the Vite plugin @oddsquad/vite-plugin-lit in development.

Limits
Top-level frames only (components inside iframes are not shown), http and https pages only, Firefox 140 or later.

Privacy
Lit Inspector collects no data. Its only network requests fetch an enabled site's own scripts and sourcemaps, from that site, to show where components are defined. It stores the sites you enabled and your panel settings in your browser. Privacy policy: https://oddcelot.github.io/vite-plugin-lit/reference/extension-privacy/

Lit Inspector is an independent, unofficial tool. It is not affiliated with, endorsed by, or produced by Google, Mozilla or the Lit project.

Source code and issues: https://github.com/oddcelot/vite-plugin-lit
```

**Categories**

Web Development

**Tags**

developer tools, web components, lit, debugging, devtools

**Support email**

Leave empty, or a contact address you keep.

**Support website**

https://github.com/oddcelot/vite-plugin-lit/issues

**License**

BSD 3-Clause "New" or "Revised" License, the package's (`LICENSE`).

**Does this add-on have a privacy policy?**

Yes. AMO takes the policy as text, so paste:

```text
Lit Inspector collects no personal data and sends nothing anywhere. It has no server, no analytics, no telemetry and no accounts. It stores the sites you enabled and your panel settings in the extension's local storage, and a few page-side preferences in the localStorage and sessionStorage of the sites you enabled. Removing the extension removes its own storage. The full policy, with every stored key and permission: https://oddcelot.github.io/vite-plugin-lit/reference/extension-privacy/
```

## Notes for reviewers

```text
The extension is built with Vite from the attached source (the repository at the release tag). To reproduce the uploaded package:

Requirements: Node.js 20 or later, pnpm 12 (run `corepack enable`, which picks the version pinned in package.json), and the `zip` command.

  cd vite-plugin-lit
  pnpm install --frozen-lockfile
  pnpm run package:extension --firefox

The package is dist/lit-inspector-<version>-firefox.zip; its contents are dist/extension-firefox/. The build is not minified, so the bundled files are readable as they are.

Entry points: extension/vite.config.ts (the Firefox manifest is written by firefoxManifest() there), extension/src/ (background, popup, DevTools page, panel, and the two content scripts page.ts and content.ts), and the panel UI it bundles from src/panel/.

innerHTML warnings from the linter (four): lit-html's template element, once in page.js and once in the panel bundle, and Web Awesome's icon loader are vendor code; the fourth is the in-page overlay's static template (src/lib/runtime/source-overlay/template.ts), a constant that holds no page or user data.

Testing: load the package, open any site that uses Lit (for example https://lit.dev), click the toolbar button and "Enable on this site", then open DevTools and the Lit tab.
```

**Version notes** (per version, shown to users)

CI sends one line naming the version and linking its GitHub Release, whose
notes are the `CHANGELOG.md` section. The section also covers the Vite
plugin, so it isn't pasted in whole; for a hand upload, shorten it to the
Firefox-relevant lines instead.

## For the publisher, outside this repo

- Sign in to addons.mozilla.org with a Mozilla account and accept the
  Firefox Add-on Distribution Agreement. There is no fee.
- Make sure the privacy policy page is deployed with the Firefox section (it
  ships with the docs site) before submitting.
- Every update needs a higher version than the last upload, and the source
  package of that version.
