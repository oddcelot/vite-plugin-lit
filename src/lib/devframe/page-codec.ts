/**
 * The mapping between the page runtime's channel messages and the
 * definition's {@link TimelineSink}, written once for every carrier.
 *
 * A carrier is whatever moves named messages to and from the page:
 * `import.meta.hot` on a Vite dev server, devframe RPC events in the
 * standalone CLI. The codec owns everything above that: channel names,
 * validation of inbound payloads, the layers wire format and sink dispatch.
 * Like `source.ts` it imports nothing from Vite, so the Vite-free standalone
 * source and the Vite-side source can share it.
 */

import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  INSPECT_OVERLAY_TOGGLE_CHANNEL,
} from '../../types/inspector.js';
import type {
  InspectorCommand,
  InspectorMessage,
} from '../../types/inspector.js';
import {HMR_INCOMPATIBLE_CHANNEL} from '../../types/hmr-incompatibility.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import {HMR_PATCH_CHANNEL} from '../../types/hmr-patch.js';
import type {HmrPatchEvent} from '../../types/hmr-patch.js';
import {SETTINGS_OVERRIDE_CHANNEL} from '../../types/timeline.js';
import type {
  SettingsOverride,
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../../types/timeline.js';
import {
  CHANNEL_CUSTOM_LAYER,
  CHANNEL_LAYERS_CHANGED,
  CHANNEL_PUSH_EVENT,
  CHANNEL_RECORDING_CHANGED,
  CHANNEL_RUNTIME_READY,
} from '../../types/timeline.js';
import {layersWireFormat} from './source.js';
import type {TimelineSink, TimelineSource} from './source.js';

/** The tiny transport a codec rides on. */
export interface PageCarrier {
  /** Subscribe to messages the page sent on `channel`. Called once per channel. */
  on(channel: string, callback: (data: unknown) => void): void;
  /** Send a message to the connected page(s). */
  send(channel: string, data?: unknown): void;
}

export interface TimelineChannelCodecOptions {
  /**
   * Called with the picked element's id when the page reports an overlay
   * pick, before the message reaches the sink. How the Vite host brings its
   * dock forward; omitted where there is no dock to activate.
   */
  onPick?: (id: number) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The id of the document a runtime message came from; absent on old runtimes. */
const pageIdOf = (data: Record<string, unknown>): string | undefined =>
  typeof data.pageId === 'string' ? data.pageId : undefined;

/**
 * A {@link TimelineSource} over a {@link PageCarrier}. Inbound messages are
 * untrusted in shape, so each is checked before it reaches the sink;
 * anything unrecognised is ignored rather than thrown, which keeps a
 * misbehaving page from taking the session down.
 *
 * Calls made before {@link connect} are dropped, not buffered: nothing can
 * reach the page until a carrier exists.
 */
export class TimelineChannelCodec implements TimelineSource {
  #carrier: PageCarrier | undefined;
  #sink: TimelineSink | undefined;
  readonly #onPick: ((id: number) => void) | undefined;

  constructor(options: TimelineChannelCodecOptions = {}) {
    this.#onPick = options.onPick;
  }

  /** Subscribe to the page's channels on `carrier`. Call once. */
  connect(carrier: PageCarrier): void {
    this.#carrier = carrier;
    carrier.on(CHANNEL_PUSH_EVENT, (data) => {
      const events = isRecord(data) ? data.events : undefined;
      this.#sink?.pushEvents(
        Array.isArray(events) ? (events as TimelineEvent[]) : [],
        isRecord(data) ? pageIdOf(data) : undefined
      );
    });
    carrier.on(CHANNEL_CUSTOM_LAYER, (data) => {
      const layer = isRecord(data) ? (data.layer as TimelineLayer) : undefined;
      if (layer?.id) this.#sink?.addLayer(layer);
    });
    carrier.on(INSPECT_DATA_CHANNEL, (data) => {
      if (!isRecord(data) || typeof data.type !== 'string') return;
      if (data.type === 'pick' && typeof data.id === 'number') {
        this.#onPick?.(data.id);
      }
      // The page id is transport metadata; the sink gets it beside the
      // message, not inside it.
      const {pageId, ...message} = data;
      this.#sink?.inspectorMessage(
        message as unknown as InspectorMessage,
        typeof pageId === 'string' ? pageId : undefined
      );
    });
    carrier.on(HMR_INCOMPATIBLE_CHANNEL, (data) => {
      if (isRecord(data))
        this.#sink?.hmrIncompatible(data as unknown as HmrIncompatibilityEvent);
    });
    carrier.on(HMR_PATCH_CHANNEL, (data) => {
      // Stricter than the incompatibility channel: the node side does
      // arithmetic and string matching on these fields.
      if (
        isRecord(data) &&
        typeof data.tagName === 'string' &&
        typeof data.instances === 'number' &&
        typeof data.generation === 'number' &&
        typeof data.durationMs === 'number' &&
        typeof data.at === 'number'
      ) {
        // Transport metadata: the sink gets the page id beside the event.
        const {pageId, ...event} = data;
        this.#sink?.hmrPatched(
          event as unknown as HmrPatchEvent,
          typeof pageId === 'string' ? pageId : undefined
        );
      }
    });
    // The runtime announces itself on every connect and boots from the
    // compiled-in defaults, so the sink replays the session's state to it.
    carrier.on(CHANNEL_RUNTIME_READY, (data) => {
      this.#sink?.runtimeReady(
        isRecord(data) ? pageIdOf(data) : undefined,
        isRecord(data) && typeof data.tabId === 'string'
          ? data.tabId
          : undefined
      );
    });
  }

  attach(sink: TimelineSink): () => void {
    this.#sink = sink;
    return () => {
      if (this.#sink === sink) this.#sink = undefined;
    };
  }

  toggleOverlay(): void {
    this.#carrier?.send(INSPECT_OVERLAY_TOGGLE_CHANNEL);
  }

  sendInspector(cmd: InspectorCommand): void {
    this.#carrier?.send(INSPECT_CMD_CHANNEL, cmd);
  }

  setRecording(recording: boolean): void {
    this.#carrier?.send(CHANNEL_RECORDING_CHANGED, {recording});
  }

  setLayers(layers: TimelineLayersState): void {
    this.#carrier?.send(CHANNEL_LAYERS_CHANGED, layersWireFormat(layers));
  }

  setSettingsOverride(override: SettingsOverride): void {
    this.#carrier?.send(SETTINGS_OVERRIDE_CHANNEL, override);
  }
}
