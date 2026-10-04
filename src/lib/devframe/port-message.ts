/**
 * The message shape on a `chrome.runtime.Port` between the page, the
 * extension's background and its panel: a channel name and its payload.
 * Kept apart from `port-link.ts`, which pulls in the whole devframe, so the
 * background worker can share the guard without bundling it.
 */

/** The structural slice of `chrome.runtime.Port` used here. */
export interface PortLike {
  postMessage(message: unknown): void;
  onMessage: {addListener(callback: (message: unknown) => void): void};
  onDisconnect?: {addListener(callback: () => void): void};
}

/** What travels on the port, in both directions. */
export interface PortMessage {
  channel: string;
  data?: unknown;
}

export const isPortMessage = (message: unknown): message is PortMessage =>
  typeof message === 'object' &&
  message !== null &&
  typeof (message as {channel?: unknown}).channel === 'string';
