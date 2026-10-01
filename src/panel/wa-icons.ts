/**
 * Font Awesome Free icons for `<wa-icon>`, bundled into the panel.
 *
 * Web Awesome's `default` icon library fetches SVGs from the Font Awesome CDN
 * at runtime, which breaks the panel offline and inside exported snapshots.
 * This module re-registers `default` over an explicit map of SVGs imported as
 * strings, so only the icons listed here ship, `<wa-icon name>` never leaves
 * the bundle, and an unlisted name renders nothing.
 *
 * Names are Font Awesome's; the solid style unless suffixed `-regular`.
 * Each SVG keeps the license comment Font Awesome ships in it (icons are
 * CC BY 4.0), which is the attribution the license asks for.
 */
import {registerIconLibrary} from '@awesome.me/webawesome/dist/components/icon/library.js';
import circleRegular from '@fortawesome/fontawesome-free/svgs/regular/circle.svg?raw';
import arrowRight from '@fortawesome/fontawesome-free/svgs/solid/arrow-right.svg?raw';
import arrowUpRightFromSquare from '@fortawesome/fontawesome-free/svgs/solid/arrow-up-right-from-square.svg?raw';
import bell from '@fortawesome/fontawesome-free/svgs/solid/bell.svg?raw';
import bolt from '@fortawesome/fontawesome-free/svgs/solid/bolt.svg?raw';
import chevronDown from '@fortawesome/fontawesome-free/svgs/solid/chevron-down.svg?raw';
import chevronRight from '@fortawesome/fontawesome-free/svgs/solid/chevron-right.svg?raw';
import circle from '@fortawesome/fontawesome-free/svgs/solid/circle.svg?raw';
import clock from '@fortawesome/fontawesome-free/svgs/solid/clock.svg?raw';
import crosshairs from '@fortawesome/fontawesome-free/svgs/solid/crosshairs.svg?raw';
import cube from '@fortawesome/fontawesome-free/svgs/solid/cube.svg?raw';
import equals from '@fortawesome/fontawesome-free/svgs/solid/equals.svg?raw';
import fileExport from '@fortawesome/fontawesome-free/svgs/solid/file-export.svg?raw';
import gear from '@fortawesome/fontawesome-free/svgs/solid/gear.svg?raw';
import rotateLeft from '@fortawesome/fontawesome-free/svgs/solid/rotate-left.svg?raw';
import rotateRight from '@fortawesome/fontawesome-free/svgs/solid/rotate-right.svg?raw';
import stop from '@fortawesome/fontawesome-free/svgs/solid/stop.svg?raw';
import trashCan from '@fortawesome/fontawesome-free/svgs/solid/trash-can.svg?raw';
import triangleExclamation from '@fortawesome/fontawesome-free/svgs/solid/triangle-exclamation.svg?raw';
import xmark from '@fortawesome/fontawesome-free/svgs/solid/xmark.svg?raw';

const ICONS = {
  'arrow-right': arrowRight,
  'arrow-up-right-from-square': arrowUpRightFromSquare,
  bell,
  bolt,
  'chevron-down': chevronDown,
  'chevron-right': chevronRight,
  circle,
  'circle-regular': circleRegular,
  clock,
  crosshairs,
  cube,
  equals,
  'file-export': fileExport,
  gear,
  'rotate-left': rotateLeft,
  'rotate-right': rotateRight,
  stop,
  'trash-can': trashCan,
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
