/**
 * Keeps a view subscribed to the {@link PanelLocation} it was handed: calls
 * `onChange` whenever the location changes, and once each time the view is
 * given a different one (the shell's, replacing the default a view starts
 * with so it also works on its own, as in tests).
 */

import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {PanelLocation} from './panel-location.js';

export class LocationController implements ReactiveController {
  readonly #host: ReactiveControllerHost & {location: PanelLocation};
  readonly #onChange: () => void;
  #subscribed: PanelLocation | undefined;
  #off: (() => void) | undefined;

  constructor(
    host: ReactiveControllerHost & {location: PanelLocation},
    onChange: () => void
  ) {
    this.#host = host;
    this.#onChange = onChange;
    host.addController(this);
  }

  hostConnected(): void {
    this.#follow();
  }

  hostUpdate(): void {
    if (this.#subscribed !== this.#host.location) this.#follow();
  }

  hostDisconnected(): void {
    this.#off?.();
    this.#off = undefined;
    this.#subscribed = undefined;
  }

  #follow(): void {
    this.#off?.();
    const location = this.#host.location;
    this.#subscribed = location;
    this.#off = location.subscribe(this.#onChange);
    this.#onChange();
  }
}
