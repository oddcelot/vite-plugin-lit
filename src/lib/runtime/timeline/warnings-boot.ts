/**
 * Hooks Lit's warning Set before the app's modules run. Injected at the top
 * of `<head>`, ahead of the app's own scripts, so Lit finds the hooked Set
 * instead of making its own; see `lit-warnings.ts`.
 */

import {installLitWarningCapture} from './lit-warnings.js';

installLitWarningCapture();
