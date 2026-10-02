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

## Enable it on a site

The extension does nothing until you turn it on for a site, and it asks for no
host access at install.

1. Open DevTools on the page and go to the **Lit** tab.
2. Click **Enable on this site**. Chrome asks to let the extension read and
   change that origin's pages; allow it, and the page reloads.
3. From then on, every page load on that origin gets the runtime at
   `document_start`, before the page's own scripts run, until you click
   **Disable** or remove the permission in the extension's details.

## Current limits

- The Lit tab is a placeholder. It shows the site's status and counts messages
  from the page; the real panel hasn't moved in yet.
- The page's runtime doesn't send anything yet. The window-to-port transport
  that carries its traffic is still being written, so the count stays at 0.
- Top frames only: components inside iframes aren't seen.
- Only `http:` and `https:` pages.
- Chrome 114 or later.
