/**
 * Pixelarticons (https://pixelarticons.com), Copyright (c) 2019 Gerrit
 * Halfmann, MIT License, for `<wa-icon>`, bundled into the panel.
 *
 * Web Awesome's `default` icon library fetches Font Awesome SVGs from a CDN
 * at runtime, which breaks the panel offline and inside exported snapshots.
 * This module re-registers `default` over an explicit map of SVGs imported as
 * strings, so only the icons listed here ship, `<wa-icon name>` never leaves
 * the bundle, and an unlisted name renders nothing.
 *
 * Names are Pixelarticons'. The icons are drawn on a 12-pixel grid (2-unit
 * steps in a 24-unit viewBox); `crispEdges` keeps those pixels sharp when an
 * icon renders at a size that isn't a multiple of 12.
 */
import {
  getIconLibrary,
  registerIconLibrary,
} from '@awesome.me/webawesome/dist/components/icon/library.js';
import arrowRight from 'pixelarticons/svg/arrow-right.svg?raw';
import bell from 'pixelarticons/svg/bell.svg?raw';
import check from 'pixelarticons/svg/check.svg?raw';
import box from 'pixelarticons/svg/box.svg?raw';
import chevronDown from 'pixelarticons/svg/chevron-down.svg?raw';
import chevronLeft from 'pixelarticons/svg/chevron-left.svg?raw';
import chevronRight from 'pixelarticons/svg/chevron-right.svg?raw';
import chevronUp from 'pixelarticons/svg/chevron-up.svg?raw';
import clock from 'pixelarticons/svg/clock.svg?raw';
import close from 'pixelarticons/svg/close.svg?raw';
import download from 'pixelarticons/svg/download.svg?raw';
import externalLink from 'pixelarticons/svg/external-link.svg?raw';
import eyeOff from 'pixelarticons/svg/eye-off.svg?raw';
import eye from 'pixelarticons/svg/eye.svg?raw';
import gear from 'pixelarticons/svg/gear.svg?raw';
import play from 'pixelarticons/svg/play.svg?raw';
import reload from 'pixelarticons/svg/reload.svg?raw';
import repeat from 'pixelarticons/svg/repeat.svg?raw';
import stopSolid from 'pixelarticons/svg/stop-solid.svg?raw';
import target from 'pixelarticons/svg/target.svg?raw';
import trash from 'pixelarticons/svg/trash.svg?raw';
import undo from 'pixelarticons/svg/undo.svg?raw';
import warningDiamond from 'pixelarticons/svg/warning-diamond.svg?raw';
import zap from 'pixelarticons/svg/zap.svg?raw';

const ICONS = {
  'arrow-right': arrowRight,
  bell,
  box,
  'chevron-down': chevronDown,
  'chevron-right': chevronRight,
  clock,
  close,
  download,
  'external-link': externalLink,
  eye,
  'eye-off': eyeOff,
  gear,
  play,
  reload,
  repeat,
  'stop-solid': stopSolid,
  target,
  trash,
  undo,
  'warning-diamond': warningDiamond,
  zap,
} as const;

/** A name `<wa-icon name=…>` resolves in the panel. */
export type IconName = keyof typeof ICONS;

const isIconName = (name: string): name is IconName => name in ICONS;

const toUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const crisp = (svg: SVGElement) =>
  svg.setAttribute('shape-rendering', 'crispEdges');

registerIconLibrary('default', {
  resolver: (name) => (isIconName(name) ? toUri(ICONS[name]) : ''),
  mutator: crisp,
});

/**
 * Web Awesome components draw their own glyphs (the select's arrow and clear
 * cross, a checked state, tab-scroll chevrons) from the inlined `system`
 * library. Swap in Pixelarticons for those, and defer to the original for
 * anything else so no built-in glyph goes missing.
 */
const SYSTEM: Record<string, string> = {
  check,
  'chevron-down': chevronDown,
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  'chevron-up': chevronUp,
  xmark: close,
};
const system = getIconLibrary('system');
if (system !== undefined) {
  registerIconLibrary('system', {
    resolver: (name, family, variant, autoWidth) =>
      SYSTEM[name] !== undefined
        ? toUri(SYSTEM[name])
        : system.resolver(name, family, variant, autoWidth),
    mutator: (svg, host) => {
      system.mutator?.(svg, host);
      crisp(svg);
    },
  });
}
