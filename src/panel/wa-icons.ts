/**
 * Phosphor Icons (https://phosphoricons.com), Copyright (c) 2023 Phosphor
 * Icons, MIT License, for `<wa-icon>`, bundled into the panel.
 *
 * Web Awesome's `default` icon library fetches Font Awesome SVGs from a CDN
 * at runtime, which breaks the panel offline and inside exported snapshots.
 * This module re-registers `default` over an explicit map of SVGs imported as
 * strings, so only the icons listed here ship, `<wa-icon name>` never leaves
 * the bundle, and an unlisted name renders nothing.
 *
 * Names are Phosphor's, all in the regular weight.
 */
import {
  getIconLibrary,
  registerIconLibrary,
} from '@awesome.me/webawesome/dist/components/icon/library.js';
import arrowCounterClockwise from '@phosphor-icons/core/assets/regular/arrow-counter-clockwise.svg?raw';
import arrowRight from '@phosphor-icons/core/assets/regular/arrow-right.svg?raw';
import arrowSquareOut from '@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw';
import caretDown from '@phosphor-icons/core/assets/regular/caret-down.svg?raw';
import caretLeft from '@phosphor-icons/core/assets/regular/caret-left.svg?raw';
import caretRight from '@phosphor-icons/core/assets/regular/caret-right.svg?raw';
import caretUp from '@phosphor-icons/core/assets/regular/caret-up.svg?raw';
import check from '@phosphor-icons/core/assets/regular/check.svg?raw';
import clock from '@phosphor-icons/core/assets/regular/clock.svg?raw';
import crosshair from '@phosphor-icons/core/assets/regular/crosshair.svg?raw';
import cube from '@phosphor-icons/core/assets/regular/cube.svg?raw';
import equals from '@phosphor-icons/core/assets/regular/equals.svg?raw';
import exportIcon from '@phosphor-icons/core/assets/regular/export.svg?raw';
import eyeSlash from '@phosphor-icons/core/assets/regular/eye-slash.svg?raw';
import eye from '@phosphor-icons/core/assets/regular/eye.svg?raw';
import gear from '@phosphor-icons/core/assets/regular/gear.svg?raw';
import lightning from '@phosphor-icons/core/assets/regular/lightning.svg?raw';
import notification from '@phosphor-icons/core/assets/regular/notification.svg?raw';
import record from '@phosphor-icons/core/assets/regular/record.svg?raw';
import stop from '@phosphor-icons/core/assets/regular/stop.svg?raw';
import trash from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import warning from '@phosphor-icons/core/assets/regular/warning.svg?raw';
import x from '@phosphor-icons/core/assets/regular/x.svg?raw';

const ICONS = {
  'arrow-counter-clockwise': arrowCounterClockwise,
  'arrow-right': arrowRight,
  'arrow-square-out': arrowSquareOut,
  'caret-down': caretDown,
  'caret-right': caretRight,
  clock,
  crosshair,
  cube,
  equals,
  export: exportIcon,
  eye,
  'eye-slash': eyeSlash,
  gear,
  lightning,
  notification,
  record,
  stop,
  trash,
  warning,
  x,
} as const;

/** A name `<wa-icon name=…>` resolves in the panel. */
export type IconName = keyof typeof ICONS;

const isIconName = (name: string): name is IconName => name in ICONS;

const toUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

registerIconLibrary('default', {
  resolver: (name) => (isIconName(name) ? toUri(ICONS[name]) : ''),
});

/**
 * Web Awesome components draw their own glyphs (the select's arrow and clear
 * cross, a checked state, tab-scroll chevrons) from the inlined `system`
 * library. Swap in the Phosphor equivalents for those, and defer to the
 * original for anything else so no built-in glyph goes missing.
 */
const SYSTEM: Record<string, string> = {
  check,
  'chevron-down': caretDown,
  'chevron-left': caretLeft,
  'chevron-right': caretRight,
  'chevron-up': caretUp,
  xmark: x,
};
const system = getIconLibrary('system');
if (system !== undefined) {
  registerIconLibrary('system', {
    resolver: (name, family, variant, autoWidth) =>
      SYSTEM[name] !== undefined
        ? toUri(SYSTEM[name])
        : system.resolver(name, family, variant, autoWidth),
    mutator: system.mutator,
  });
}
