/**
 * Keeps one port to the background alive for as long as the document and the
 * extension are. Free of `chrome`, so the policy is unit-testable.
 *
 * A document's port dies without the document doing so: Chrome closes it when
 * the page enters the back/forward cache, and the MV3 service worker takes
 * all its ports with it when it restarts. Either way the panel would see the
 * page as gone until a reload, so the port is reopened: after a backoff when
 * it drops, at once when the page is restored.
 */

export interface KeptPort {
  onDisconnect: {addListener(listener: () => void): void};
  disconnect(): void;
}

export interface KeepConnectedOptions {
  /** Opens a port and starts whatever uses it. May throw. */
  open(): KeptPort;
  /** False once the extension was unloaded or reloaded: this script is orphaned. */
  alive(): boolean;
  /** First retry delay, doubled per consecutive drop up to {@link max}. */
  initial?: number;
  max?: number;
}

export interface KeepConnected {
  /** Drop the current port, if any, and open a fresh one now. */
  reconnect(): void;
}

export const keepConnected = (options: KeepConnectedOptions): KeepConnected => {
  const {initial = 250, max = 5000} = options;
  let current: KeptPort | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = initial;
  let openedAt = 0;

  const retry = () => {
    if (timer !== undefined || !options.alive()) return;
    timer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, max);
  };

  function connect(): void {
    clearTimeout(timer);
    timer = undefined;
    if (!options.alive()) return;
    let port: KeptPort;
    try {
      port = options.open();
    } catch {
      return retry();
    }
    current = port;
    openedAt = Date.now();
    port.onDisconnect.addListener(() => {
      // Superseded by a reconnect: not this port's drop to answer.
      if (current !== port) return;
      current = undefined;
      // A port that held for a while means the trouble passed.
      if (Date.now() - openedAt >= max) delay = initial;
      retry();
    });
  }

  connect();

  return {
    reconnect() {
      const old = current;
      current = undefined;
      try {
        old?.disconnect();
      } catch {
        // Already closed.
      }
      delay = initial;
      connect();
    },
  };
};
