# Lit DevTools for Chrome

A Chrome DevTools extension that inspects the Lit components on any page:
production builds, sites you don't serve, pages whose CSP would refuse the
`<script>` tag `lit-devtools dev` prints. Chrome injects the runtime itself,
so the page's `script-src` doesn't apply.

Work in progress. It isn't published, and it isn't part of the npm package.

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
