import {afterEach, beforeEach, expect, test, vi} from 'vite-plus/test';
import {installTooltips} from '../../panel/tooltip.js';

let dispose: () => void;

const bubble = () => document.body.querySelector<HTMLElement>('[role=tooltip]');

// happy-dom has no focus-visible heuristic; every programmatic focus here is
// a keyboard one.
const focusVisible = () => {
  // eslint-disable-next-line typescript/unbound-method -- called with this below
  const real = Element.prototype.matches;
  return vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
    this: Element,
    sel: string
  ) {
    return sel === ':focus-visible' || real.call(this, sel);
  });
};

const fire = (el: Element, type: string, init: EventInit = {}) =>
  el.dispatchEvent(
    new Event(type, {bubbles: true, composed: true, cancelable: true, ...init})
  );

const mount = () => {
  const host = document.createElement('div');
  host.attachShadow({mode: 'open'}).innerHTML =
    '<button data-tip="Delete every recorded event"><span>x</span></button>';
  document.body.append(host);
  return host.shadowRoot!.querySelector('button')!;
};

beforeEach(() => {
  vi.useFakeTimers();
  dispose = installTooltips();
  focusVisible();
});

afterEach(() => {
  dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

test('hover shows the tip after a short delay, through a shadow root', () => {
  const button = mount();
  fire(button.firstElementChild!, 'pointerover');
  expect(bubble()).toBeNull();
  vi.advanceTimersByTime(400);
  expect(bubble()?.textContent).toBe('Delete every recorded event');
  expect(bubble()?.getAttribute('popover')).toBe('manual');
});

test('keyboard focus shows it at once', () => {
  const button = mount();
  fire(button, 'focusin');
  expect(bubble()?.textContent).toBe('Delete every recorded event');
});

test('Tab within one shadow root shows the tip of what it focused', () => {
  // Chromium never delivers that focusin to the document: both ends of the
  // move retarget to the same host. The Tab's keyup still arrives.
  const button = mount();
  button.focus();
  button.dispatchEvent(
    new KeyboardEvent('keyup', {key: 'Tab', bubbles: true, composed: true})
  );
  expect(bubble()?.textContent).toBe('Delete every recorded event');
  button.blur();
  button.dispatchEvent(
    new KeyboardEvent('keyup', {key: 'Tab', bubbles: true, composed: true})
  );
  expect(bubble()).toBeNull();
});

test('leaving the target, pressing a button, typing or Escape hides it', () => {
  const button = mount();
  const other = document.createElement('p');
  document.body.append(other);

  fire(button, 'focusin');
  fire(other, 'pointerover');
  expect(bubble()).toBeNull();

  fire(button, 'focusin');
  fire(button, 'pointerdown');
  expect(bubble()).toBeNull();

  fire(button, 'focusin');
  document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
  expect(bubble()).toBeNull();

  fire(button, 'focusin');
  fire(button, 'input');
  expect(bubble()).toBeNull();
});

test('hides once the target is removed', () => {
  const button = mount();
  fire(button, 'focusin');
  button.remove();
  vi.advanceTimersByTime(300);
  expect(bubble()).toBeNull();
});

test('stays inside the viewport near the right edge', () => {
  const button = mount();
  const rect = (left: number, width: number, height: number) =>
    ({
      left,
      width,
      height,
      top: 10,
      bottom: 10 + height,
      right: left + width,
    }) as DOMRect;
  const spy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tooltip'
        ? rect(0, 200, 20)
        : rect(window.innerWidth - 20, 20, 20);
    });
  fire(button, 'focusin');
  const left = parseFloat(bubble()!.style.left);
  expect(left + 200).toBeLessThanOrEqual(window.innerWidth);
  expect(left).toBeGreaterThanOrEqual(0);
  spy.mockRestore();
});
