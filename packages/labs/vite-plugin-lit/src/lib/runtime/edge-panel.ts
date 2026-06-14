/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Keeps our on-page dev UI (HMR indicator, source-overlay tooltip) clear of the
 * Vite DevTools edge panel so they don't sit on top of it.
 *
 * The panel is `#vite-devtools-edge-panel` inside the open shadow root of the
 * `<vite-devtools-dock-embedded>` host, and only exists while the dock is
 * docked to an edge (it can be moved/resized). We report the inset, in px, that
 * the panel occupies on each viewport edge it touches — plus a small gap — so
 * callers can offset themselves.
 */

const HOST_TAG = 'vite-devtools-dock-embedded';
const PANEL_ID = 'vite-devtools-edge-panel';
/** Gap to leave between our UI and the devtools panel. */
const GAP = 12;
/** Tolerance (px) for treating the panel as touching a viewport edge. */
const EDGE = 2;

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO: EdgeInsets = {top: 0, right: 0, bottom: 0, left: 0};

const findPanel = (): HTMLElement | null => {
  const host = document.querySelector(HOST_TAG);
  const root = (host as {shadowRoot?: ShadowRoot | null} | null)?.shadowRoot;
  return (root?.getElementById(PANEL_ID) as HTMLElement | null) ?? null;
};

/** Inset (px + gap) the docked panel occupies on each viewport edge. */
const computeInsets = (): EdgeInsets => {
  const panel = findPanel();
  if (panel === null) return ZERO;
  const r = panel.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return ZERO;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    top: r.top <= EDGE ? r.bottom + GAP : 0,
    bottom: r.bottom >= vh - EDGE ? vh - r.top + GAP : 0,
    left: r.left <= EDGE ? r.right + GAP : 0,
    right: r.right >= vw - EDGE ? vw - r.left + GAP : 0,
  };
};

/**
 * Calls `onChange` with the current insets and again whenever they change — the
 * panel being docked/resized/moved, the window resizing, or the devtools
 * mounting after us. Returns a disposer.
 */
export const observeEdgeInsets = (
  onChange: (insets: EdgeInsets) => void
): (() => void) => {
  let raf = 0;
  let last = '';
  let observedPanel: Element | null = null;
  let observingRoot = false;

  const emit = () => {
    raf = 0;
    const insets = computeInsets();
    const key = `${insets.top}|${insets.right}|${insets.bottom}|${insets.left}`;
    if (key !== last) {
      last = key;
      onChange(insets);
    }
  };
  const schedule = () => {
    if (raf === 0) raf = requestAnimationFrame(emit);
  };

  const ro = new ResizeObserver(schedule);
  // Re-attach on any devtools DOM change (panel mounting, docking to a new edge)
  // then recompute; cheap thanks to the rAF + diff above.
  const mo = new MutationObserver(() => attach());

  const attach = () => {
    const host = document.querySelector(HOST_TAG);
    const root = (host as {shadowRoot?: ShadowRoot | null} | null)?.shadowRoot;
    if (root && !observingRoot) {
      observingRoot = true;
      mo.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }
    const panel = findPanel();
    if (panel !== null && panel !== observedPanel) {
      observedPanel = panel;
      ro.observe(panel);
    }
    schedule();
  };

  // The devtools host mounts asynchronously; poll until it's present, then let
  // the observers drive updates.
  let tries = 0;
  const poll = () => {
    attach();
    if (!observingRoot && tries++ < 60) {
      setTimeout(poll, 250);
    }
  };
  poll();

  window.addEventListener('resize', schedule);

  return () => {
    window.removeEventListener('resize', schedule);
    ro.disconnect();
    mo.disconnect();
    if (raf !== 0) cancelAnimationFrame(raf);
  };
};
