/**
 * Listeners by channel name, for a transport that receives every message on
 * one hook and has to hand each to whoever listens on its channel. One
 * listener throwing never keeps the message from the rest: a page runtime
 * and a DevTools host both hold listeners they did not write.
 */

export interface ChannelListeners {
  /** Listen on `channel`. Returns the function that removes the listener. */
  readonly on: (
    channel: string,
    handler: (data: unknown) => void
  ) => () => void;
  /** Hand `data` to every listener on `channel`. */
  readonly emit: (channel: string, data: unknown) => void;
}

export const channelListeners = (): ChannelListeners => {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  return {
    on: (channel, handler) => {
      let set = listeners.get(channel);
      if (set === undefined) listeners.set(channel, (set = new Set()));
      set.add(handler);
      return () => void set.delete(handler);
    },
    emit: (channel, data) => {
      for (const listener of listeners.get(channel) ?? []) {
        try {
          listener(data);
        } catch (error) {
          console.error(`[lit-devtools] listener for ${channel} threw`, error);
        }
      }
    },
  };
};
