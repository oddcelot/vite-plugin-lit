/**
 * One delegated tooltip for the whole panel. Any element carrying a `data-tip`
 * attribute gets it: hover (after a short delay) or keyboard focus shows a
 * single shared bubble, so views just write `data-tip="..."` instead of a
 * native `title`, which is slow and never appears on focus.
 *
 * The bubble is a manual popover appended to `document.body`: the top layer
 * keeps it clear of every `overflow` clip and the panel edge. Listeners sit on
 * the document and read `composedPath()`, so tips work through the shadow
 * roots of the views and of Web Awesome's own controls. Icon-only buttons still
 * need an `aria-label`; the bubble is visual and cannot be referenced across
 * shadow roots.
 */

const SHOW_DELAY_MS = 300;
/** Gap between the target and the bubble, and the minimum gap to the viewport edge. */
const GAP = 6;
const MARGIN = 4;
/** How often the open bubble checks that its target still exists and re-reads its text. */
const WATCH_MS = 250;

const STYLE = `
  position: fixed;
  inset: auto;
  margin: 0;
  border: 1px solid var(--lit-devtools-border);
  padding: 4px 8px;
  max-width: min(280px, calc(100vw - ${2 * MARGIN}px));
  background: var(--lit-devtools-surface-elevated);
  color: var(--lit-devtools-text);
  font: 12px/1.4 var(--lit-devtools-font-sans);
  box-shadow: var(--lit-devtools-shadow-md);
  pointer-events: none;
  overflow: visible;
`;

/** The first element on the event's composed path that carries a tip. */
const tipTarget = (event: Event): Element | null => {
  for (const node of event.composedPath()) {
    if (node instanceof Element && node.hasAttribute('data-tip')) return node;
  }
  return null;
};

/** The focused element, through every open shadow root on the way down. */
const deepActive = (root: Document): Element | null => {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement)
    active = active.shadowRoot.activeElement;
  return active;
};

/** `el` or the nearest ancestor with a tip, crossing shadow boundaries. */
const closestTip = (el: Element | null): Element | null => {
  for (let node: Node | null = el; node;) {
    if (node instanceof Element && node.hasAttribute('data-tip')) return node;
    node =
      node.parentNode instanceof ShadowRoot
        ? node.parentNode.host
        : node.parentNode;
  }
  return null;
};

const focusVisible = (el: Element): boolean => {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
};

let installed: (() => void) | undefined;

/**
 * Wires the tooltip to `root`. Idempotent: a second call returns the first
 * call's disposer rather than stacking listeners.
 */
export const installTooltips = (root: Document = document): (() => void) => {
  if (installed) return installed;

  const bubble = root.createElement('div');
  bubble.setAttribute('popover', 'manual');
  bubble.setAttribute('role', 'tooltip');
  bubble.style.cssText = STYLE;

  let target: Element | null = null;
  let timer: number | undefined;
  let watch: number | undefined;

  const place = () => {
    if (!target) return;
    const t = target.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const vw = root.documentElement.clientWidth || window.innerWidth;
    const vh = root.documentElement.clientHeight || window.innerHeight;
    const left = t.left + t.width / 2 - b.width / 2;
    const below = t.bottom + GAP;
    const top =
      below + b.height + MARGIN <= vh ? below : t.top - GAP - b.height;
    bubble.style.left = `${Math.max(MARGIN, Math.min(left, vw - b.width - MARGIN))}px`;
    bubble.style.top = `${Math.max(MARGIN, top)}px`;
  };

  const hide = () => {
    clearTimeout(timer);
    clearInterval(watch);
    target = null;
    if (bubble.dataset.open === undefined) return;
    delete bubble.dataset.open;
    bubble.hidePopover?.();
    bubble.remove();
  };

  const show = (el: Element) => {
    const text = el.getAttribute('data-tip');
    if (!text) return hide();
    target = el;
    bubble.textContent = text;
    if (!bubble.isConnected) root.body.append(bubble);
    bubble.dataset.open = '';
    bubble.showPopover?.();
    place();
    clearInterval(watch);
    watch = window.setInterval(() => {
      const current = target?.getAttribute('data-tip');
      if (!target?.isConnected || !current) return hide();
      if (current !== bubble.textContent) {
        bubble.textContent = current;
        place();
      }
    }, WATCH_MS);
  };

  const onOver = (e: Event) => {
    const el = tipTarget(e);
    if (el === target) return;
    clearTimeout(timer);
    if (!el) return hide();
    // Sliding between neighbours reads as one gesture; only the first waits.
    if (bubble.dataset.open !== undefined) show(el);
    else timer = window.setTimeout(() => show(el), SHOW_DELAY_MS);
  };
  const onFocusIn = (e: Event) => {
    const el = tipTarget(e);
    if (el && focusVisible(el)) show(el);
    else hide();
  };
  // Moving to another element is handled by its own over/focusin; only
  // leaving the document needs the out events.
  const onLeave = (e: Event) => {
    if (!(e as PointerEvent | FocusEvent).relatedTarget) hide();
  };
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape') hide();
  };
  // Focus moving between two elements of one shadow tree never reaches the
  // document as `focusin`: both ends retarget to the same host, and the
  // event stops short of it. The Tab that moved it does arrive, so read the
  // focused element from there.
  const onKeyUp = (e: Event) => {
    if ((e as KeyboardEvent).key !== 'Tab') return;
    const active = deepActive(root);
    const el = closestTip(active);
    if (el === target) return;
    if (el && active && focusVisible(active)) show(el);
    else hide();
  };

  const opts = {capture: true};
  root.addEventListener('pointerover', onOver, opts);
  // Chrome stops sending pointerover between shadow-DOM buttons while the
  // popover is open, so moves pick up the next target as well.
  root.addEventListener('pointermove', onOver, opts);
  root.addEventListener('focusin', onFocusIn, opts);
  root.addEventListener('pointerout', onLeave, opts);
  root.addEventListener('focusout', onLeave, opts);
  root.addEventListener('pointerdown', hide, opts);
  root.addEventListener('keydown', onKey, opts);
  root.addEventListener('keyup', onKeyUp, opts);
  root.addEventListener('scroll', hide, opts);
  // A text field matches :focus-visible on click too; typing dismisses its tip.
  root.addEventListener('input', hide, opts);

  installed = () => {
    hide();
    root.removeEventListener('pointerover', onOver, opts);
    root.removeEventListener('pointermove', onOver, opts);
    root.removeEventListener('focusin', onFocusIn, opts);
    root.removeEventListener('pointerout', onLeave, opts);
    root.removeEventListener('focusout', onLeave, opts);
    root.removeEventListener('pointerdown', hide, opts);
    root.removeEventListener('keydown', onKey, opts);
    root.removeEventListener('keyup', onKeyUp, opts);
    root.removeEventListener('scroll', hide, opts);
    root.removeEventListener('input', hide, opts);
    installed = undefined;
  };
  return installed;
};
