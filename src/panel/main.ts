/**
 * Entry module of the panel SPA. `index.html` loads this; Vite bundles it into
 * `dist/client`, which the devframe host serves as the dock's iframe.
 *
 * Importing the root element is enough — it registers `<lit-devtools-panel>`,
 * which the HTML already contains, and pulls in the views it renders. The Web
 * Awesome theme goes first so its tokens exist before any `wa-*` renders.
 */

import './wa-theme.css';
import './wa-icons.js';
import './lit-devtools-panel.js';
