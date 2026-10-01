/**
 * Font Awesome Free icons for `<wa-icon>`, bundled into the panel.
 *
 * Web Awesome's `default` icon library fetches SVGs from the Font Awesome CDN
 * at runtime, which breaks the panel offline and inside exported snapshots.
 * This module re-registers `default` over an explicit map of SVGs imported as
 * strings, so only the icons listed here ship, `<wa-icon name>` never leaves
 * the bundle, and an unlisted name renders nothing.
 *
 * Each SVG keeps the license comment Font Awesome ships in it (icons are
 * CC BY 4.0), which is the attribution the license asks for.
 */
import {registerIconLibrary} from '@awesome.me/webawesome/dist/components/icon/library.js';
import bell from '@fortawesome/fontawesome-free/svgs/solid/bell.svg?raw';
import clock from '@fortawesome/fontawesome-free/svgs/solid/clock.svg?raw';
import cube from '@fortawesome/fontawesome-free/svgs/solid/cube.svg?raw';
import gear from '@fortawesome/fontawesome-free/svgs/solid/gear.svg?raw';
import triangleExclamation from '@fortawesome/fontawesome-free/svgs/solid/triangle-exclamation.svg?raw';
import xmark from '@fortawesome/fontawesome-free/svgs/solid/xmark.svg?raw';

const ICONS = {
  bell,
  clock,
  cube,
  gear,
  'triangle-exclamation': triangleExclamation,
  xmark,
} as const;

/** A name `<wa-icon name=…>` resolves in the panel. */
export type IconName = keyof typeof ICONS;

const isIconName = (name: string): name is IconName => name in ICONS;

registerIconLibrary('default', {
  resolver: (name) =>
    isIconName(name)
      ? `data:image/svg+xml,${encodeURIComponent(ICONS[name])}`
      : '',
});
