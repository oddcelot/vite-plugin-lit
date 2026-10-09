# Chrome Web Store listing: Lit Inspector

Copy for the store's developer dashboard, field by field. The images next to
this file are rendered by `pnpm run extension:assets store`; the upload is
`pnpm run package:extension`.

## Store listing

**Name**

Lit Inspector

**Summary** (the manifest `description`, 132 characters at most)

Inspect Lit web components on any page, production builds included: component
tree, properties, updates and a timeline.

**Category**

Developer Tools

**Language**

English

**Detailed description**

```text
Lit Inspector adds a Lit tab to Chrome DevTools for inspecting the Lit web components on a page: sites you don't serve, production builds, and pages whose Content Security Policy blocks injected script tags.

What it shows
- Components: the tree of Lit elements on the page. Select one to see its reactive properties, state, attributes and controllers. Pick selects an element by clicking it in the page.
- Updates: which components updated during a recording, how often, which properties changed, and how long each update took.
- Timeline: recorded lifecycle events (performUpdate, willUpdate, update, updated) with their timings, filterable by element and layer, as a list or as tracks.
- Settings: appearance, and an option that mirrors Lit updates into Chrome's Performance panel as their own track.

How to use it
1. Open DevTools on the page and go to the Lit tab.
2. Click "Enable on this site". Chrome asks for access to that one site; allow it and the page reloads.
3. The Lit tab now shows the page's components. Click "Disable on this site" at the bottom of the tab to turn it off again.

The extension asks for no site access at install and does nothing on a site until you enable it there.

On production builds
Lit's production build is supported: the component tree, the inspector and the lifecycle timeline work. Some features need Lit's development build or a dev server and are not available from the extension: render events (Lit emits them only in development), source locations and open-in-editor, HMR history, and exporting a snapshot. For those, use the Vite plugin @oddsquad/vite-plugin-lit in development.

Limits
Top-level frames only (components inside iframes are not shown), http and https pages only, Chrome 114 or later.

Privacy
Lit Inspector collects no data. Its only network requests fetch an enabled site's own scripts and sourcemaps, from that site, to show where components are defined. It stores the sites you enabled and your panel settings in your browser. Privacy policy: https://oddcelot.github.io/vite-plugin-lit/reference/extension-privacy/

Lit Inspector is an independent, unofficial tool. It is not affiliated with, endorsed by, or produced by Google or the Lit project.

Source code and issues: https://github.com/oddcelot/vite-plugin-lit
```

**Graphic assets**

| Field              | File                                    | Size     |
| ------------------ | --------------------------------------- | -------- |
| Store icon         | `icon-128.png`                          | 128×128  |
| Screenshot 1       | `screenshot-1-components.png`           | 1280×800 |
| Screenshot 2       | `screenshot-2-pick.png`                 | 1280×800 |
| Screenshot 3       | `screenshot-3-timeline.png`             | 1280×800 |
| Screenshot 4       | `screenshot-4-updates.png`              | 1280×800 |
| Small promo tile   | `promo-small-440x280.png`               | 440×280  |
| Marquee promo tile | `promo-marquee-1400x560.png` (optional) | 1400×560 |

**Promo video** (the field takes a YouTube URL)

https://www.youtube.com/watch?v=3sPdpev0emU

The 47 s Lit Inspector film from `assets/promo-video-extension/`. It shows only
what the extension does; the plugin's own promo shows HMR and other
Vite-only features, which the store treats as misleading here.

Screenshot captions, if the dashboard asks for them:

1. Component tree and inspector next to the page.
2. Pick: click an element in the page to select it.
3. Timeline of a recorded session.
4. Updates per component, with changed properties and timings.

**Official URL / homepage**

https://oddcelot.github.io/vite-plugin-lit/

**Support URL**

https://github.com/oddcelot/vite-plugin-lit/issues

## Privacy practices

**Single purpose**

Lit Inspector adds a DevTools panel that inspects the Lit web components on a
page the user has enabled: their tree, properties, state and update timings.

**Permission justifications**

- `scripting`: Registers the extension's two content scripts on the origins
  the user enabled from the Lit tab. One runs in the page's MAIN world to read
  Lit component state for the panel; the other relays it to the panel. Nothing
  is injected anywhere else, and nothing leaves the browser.
- `storage`: Keeps the list of enabled origins and the panel's settings in
  `chrome.storage.local`, on the user's machine.
- Host permission (`<all_urls>`, in `optional_host_permissions`): Not granted
  at install. Requested for one origin at a time, when the user clicks "Enable
  on this site" in the Lit tab, and used only to register the content scripts
  on the origins the user enabled. The user can revoke it with "Disable on
  this site" or in the extension's details.

**Remote code**

No, I am not using remote code. All JavaScript ships in the package, and the
extension pages run under Manifest V3's default `script-src 'self'`.

(Not for the form: the extension build replaces the panel's snapshot export
with a stub, so the dev-server code that fetches assets from unpkg and
jsDelivr is not in the package. Nothing else about the listing changes. The
one CDN URL left in the bundle is Web Awesome's Font Awesome icon library,
which the panel replaces with bundled icons before any icon renders.)

**Data usage**

What user data does the extension collect? None of the listed categories:

- Personally identifiable information: no
- Health information: no
- Financial and payment information: no
- Authentication information: no
- Personal communications: no
- Location: no
- Web history: no
- User activity: no
- Website content: no. The panel reads component state from enabled pages and
  shows it in DevTools; it is not stored, collected or transmitted.

Certifications (all true):

- I do not sell or transfer user data to third parties, outside of the
  approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes.

**Privacy policy URL**

https://oddcelot.github.io/vite-plugin-lit/reference/extension-privacy/

## Distribution

Visibility: public (or unlisted for a first round). Regions: all.

## For the publisher, outside this repo

- Pay the one-time developer registration fee and complete the account's
  contact email verification.
- Complete the trader / non-trader declaration on the developer account.
- Make sure the privacy policy page is deployed (it ships with the docs site)
  before submitting.
