# Lit Inspector for Chrome

Lit Inspector is a Chrome DevTools extension that inspects the Lit components on any page:
production builds, sites you don't serve, pages whose CSP would refuse the
`<script>` tag `lit-devtools dev` prints. Chrome injects the runtime itself,
so the page's `script-src` doesn't apply.

Work in progress. It isn't published, and it isn't part of the npm package.
It is an independent tool, not affiliated with Google or the Lit project.
Its privacy policy is on the docs site:
https://oddcelot.github.io/vite-plugin-lit/reference/extension-privacy/

The extension is named Lit Inspector in Chrome (`chrome://extensions`, the
Web Store), and the tab it adds to DevTools is titled **Lit**: a short name
fits the DevTools tab strip next to Elements and Console, and inside DevTools
there is nothing else it could be confused with.

## Package for the Web Store

```sh
pnpm run package:extension
```

This builds the extension and writes `dist/lit-inspector-<version>.zip`:
the contents of `dist/extension/` with `manifest.json` at the root and the
source maps left out. It needs the `zip` command. The listing copy, the store
icon, the screenshots and the promo tiles are in `store/`; see
`store/listing.md`.

## Version

`manifest.json` here has no `version`. The build writes
`dist/extension/manifest.json` with the package's version from the root
`package.json`, so the extension and the package can't drift apart. Chrome
takes one to four dot-separated integers, so a prerelease version such as
`1.0.0-beta.1` fails the extension build.

## Install from a release

Every [GitHub release](https://github.com/oddcelot/vite-plugin-lit/releases)
carries a `lit-inspector-<version>.zip`. Until the extension is on the Chrome
Web Store, that's the way to install it without building from source:

1. Download the zip and unzip it into a folder you'll keep: Chrome loads the
   extension from that folder every time it starts.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder, the one with
   `manifest.json` in it.

An unpacked extension doesn't update itself. For a new release, download its
zip, replace the folder's contents, and press the extension's reload button on
`chrome://extensions`. The sites you enabled and your panel settings carry
over, because they belong to the extension's id, which comes from that folder's
path.

## Build and load

```sh
pnpm run build:extension
```

This writes `dist/extension/`. In Chrome, open `chrome://extensions`, turn on
Developer mode, choose **Load unpacked** and pick that directory. Rebuild and
press the extension's reload button to pick up changes.

Or let a script do all of it:

```sh
pnpm run extension:try                        # build, then open the playground
pnpm run extension:try --no-build             # reuse the last builds
pnpm run extension:try --url https://lit.dev  # any other site
```

It builds the package, the extension and a production build of the
playground, serves that build, and opens Playwright's Chromium (branded
Chrome ignores `--load-extension`) with the extension loaded and DevTools
open, in a throwaway profile. Closing the window stops the server and deletes
the profile. Don't point `--url` at a dev server running the Vite plugin: that
page already has the runtime.

## Icons

The mark is `public/icon.svg`: a component tree with its selected node, on a
flame-blue tile so it reads on light and dark toolbars. It is original
artwork, not the Lit logo, which the extension may not use as its own. The
DevTools tab shows the SVG; the manifest lists PNGs in `public/icons/`,
rendered from it by

```sh
pnpm run extension:assets icons
```

At 16px the tree is redrawn on the pixel grid (`store/icon-16.svg`). The
128px icon has 96px of artwork and 16px of transparent padding, which is what
the Web Store asks of its icon. The PNGs are committed; rerun the script after
changing either SVG.

## Enable it on a site

The extension does nothing until you turn it on for a site, and it asks for no
host access at install.

1. Open DevTools on the page and go to the **Lit** tab.
2. Click **Enable on this site**. Chrome asks to let the extension read and
   change that origin's pages; allow it, and the page reloads.
3. From then on, every page load on that origin gets the runtime at
   `document_start`, before the page's own scripts run, until you click
   **Disable on this site** (bottom right of the Lit tab) or remove the
   permission in the extension's details.

Once enabled, the Lit tab is the same panel `lit-devtools dev` and the Vite
plugin serve: Components, Updates, Timeline and Settings, running inside the
extension with no server behind it. A bar under it says whether the page has
the runtime; a page loaded before you enabled the site, or one the extension
couldn't inject into, gets a **Reload page** link there. Panel settings are
kept in the extension's local storage and shared by every tab.

## Current limits

The docs compare the extension with the Vite plugin feature by feature:
https://oddcelot.github.io/vite-plugin-lit/reference/devtools-hosts/

- What needs a dev server isn't there. The panel leaves out the **Export
  snapshot** button, and components have no source location, since no Vite
  transform stamped one, so there is nothing to open in your editor. The
  Settings tab keeps appearance and the About table and says plugin settings
  need the Vite plugin.
- HMR history and patch notices never appear: nothing hot-patches the page.
- The **Lit Render** timeline layers need Lit's development build. A
  production build emits no render events; the Timeline says so under the
  layers once other events have arrived and none came from Lit.
- Top frames only: components inside iframes aren't seen.
- Only `http:` and `https:` pages.
- Chrome 114 or later.
