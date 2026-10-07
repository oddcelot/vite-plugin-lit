/**
 * Phosphor icons (https://phosphoricons.com, MIT) for the docs, in the
 * regular weight, as SVG strings that take `currentColor`.
 *
 * Only the icons imported below ship. That keeps the build from globbing
 * Phosphor's 9,000 files, and an unknown name fails the type check instead of
 * rendering nothing. Add a name here before using it on a page. The panel
 * keeps its own list in src/panel/wa-icons.ts.
 */
import lightning from '@phosphor-icons/core/assets/regular/lightning.svg?raw';
import paintBrush from '@phosphor-icons/core/assets/regular/paint-brush.svg?raw';
import robot from '@phosphor-icons/core/assets/regular/robot.svg?raw';
import treeStructure from '@phosphor-icons/core/assets/regular/tree-structure.svg?raw';

const icons = {
  lightning,
  'paint-brush': paintBrush,
  robot,
  'tree-structure': treeStructure,
};

export type IconName = keyof typeof icons;

/** The icon's SVG markup, `size` square (any CSS length), hidden from assistive tech. */
export function phosphor(name: IconName, size = '1em'): string {
  return icons[name].replace(
    '<svg ',
    `<svg width="${size}" height="${size}" aria-hidden="true" focusable="false" `
  );
}
