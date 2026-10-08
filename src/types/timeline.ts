import type {
  OverridableKey,
  PreferenceKey,
  SettingValue,
  SourcedKey,
} from '../lib/setting-definitions.js';

export interface TimelineLayer {
  id: string;
  label: string;
  color: number; // 0xRRGGBB
}

export interface TimelineEvent<TData = unknown> {
  /**
   * Stable identity, stamped on the Node side (`${epoch}-${seq}`) when the
   * event is received, so it survives the stream, `recent-events` and a
   * snapshot export. Absent on events still in the page runtime.
   */
  id?: string;
  layerId: string;
  /**
   * Milliseconds since recording started, stamped in the browser page
   * (`performance.now()` re-zeroed on each recording start; see
   * `runtime/timeline/clock.ts`). Not comparable to any Node-side clock.
   */
  time: number;
  data: TData;
  title?: string;
  subtitle?: string;
  /** Pairs a start event with its matching end event in the same update group. */
  groupId?: number | string;
  logType?: 'default' | 'warning' | 'error';
  meta?: {
    elementId?: number;
    tagName?: string;
    source?: {file: string; line: number};
    /**
     * Where this instance was written in a template (or HTML entry file),
     * from the dev transform's `data-lit-source` attribute. Optional and
     * absent from recordings made before it existed.
     */
    callSite?: {file: string; line: number; column: number};
  };
}

/** One changed reactive property of an update, with before/after previews. */
export interface ChangedValue {
  key: string;
  /** `serialize()` preview of the old value (from the PropertyValues Map). */
  prev: string;
  /** `serialize()` preview of the current value, read off the element. */
  next: string;
  /** `Object.is(prev, next)` on the raw values. */
  sameRef: boolean;
  /**
   * Different references with deep-equal contents (a bounded check on the raw
   * values, not the previews). False when the budget runs out.
   */
  equal: boolean;
}

export interface TimelineLayersState {
  recordingState: boolean;
  litLifecycleEnabled: boolean;
  litRenderEnabled: boolean;
  /**
   * Per-part `lit-debug` events (`template updating`, `set part`, `commit
   * *`, …) — one per binding on *every* render, so a ticking clock or
   * animation floods the layer. Off by default; the `lit-render` layer's
   * begin/end render pair already covers the common case.
   */
  litRenderVerboseEnabled: boolean;
  /**
   * Old/new value previews on update events. Costs a `serialize` per changed
   * key per update, so off by default. Emits no events of its own: it only
   * adds data to the `lit-lifecycle` update events.
   */
  litChangedValuesEnabled: boolean;
  mouseEventEnabled: boolean;
  keyboardEventEnabled: boolean;
  /**
   * Events a component dispatches on itself (`this.dispatchEvent(...)`): type,
   * flags and a bounded detail preview. Off by default.
   */
  customEventsEnabled: boolean;
}

export const TIMELINE_LAYERS: readonly TimelineLayer[] = [
  {id: 'lit-lifecycle', label: 'Lit Lifecycle', color: 0x4d63ff},
  {id: 'lit-render', label: 'Lit Render', color: 0x325cff},
  {id: 'lit-render-verbose', label: 'Lit Render (verbose)', color: 0x99aeff},
  {id: 'lit-changed-values', label: 'Changed values', color: 0x6b7bff},
  {id: 'mouse', label: 'Mouse', color: 0xa451af},
  {id: 'keyboard', label: 'Keyboard', color: 0x8151af},
  {id: 'custom-events', label: 'Custom events', color: 0xaf7a51},
];

export const DEFAULT_LAYERS_STATE: TimelineLayersState = {
  recordingState: false,
  litLifecycleEnabled: true,
  litRenderEnabled: true,
  litRenderVerboseEnabled: false,
  litChangedValuesEnabled: false,
  mouseEventEnabled: false,
  keyboardEventEnabled: false,
  customEventsEnabled: false,
};

/**
 * Snapshot of the plugin's resolved feature settings, surfaced in the panel's
 * Settings tab. The plugin produces this at config time (explicit options >
 * LIT_PLUGIN_* env > defaults) and serves it from the panel server. It's the
 * baseline the panel shows; some HMR settings can then be overridden live (see
 * {@link SettingsOverride}).
 */
export interface FeatureSettings {
  hmr: {
    enabled: boolean;
    reconnect: boolean;
    onIncompatible: 'reload' | 'warn';
    childState: 'reset' | 'transfer' | 'reuse';
    indicatorEnabled: boolean;
    indicatorCount: boolean;
  };
  sourceOverlay: {
    enabled: boolean;
    /** Hotkey letter combined with Ctrl+Shift to toggle the overlay. */
    key: string;
    editor: string;
    throttleMs: number;
  };
  timeline: boolean;
  /**
   * Which layer supplied each setting, keyed like {@link SettingsOverride}
   * (plus the read-only source-overlay rows). Lets the panel label a value
   * "Zed (env)" and name the baseline a panel override replaced. Optional so
   * older producers (and snapshots) without it still type-check.
   */
  sources?: SettingSources;
}

/**
 * Where a resolved setting came from, in precedence order after a panel
 * override: an explicit `litPlugin({...})` option, a `LIT_PLUGIN_*` env var,
 * or the built-in default.
 */
export type SettingSource = 'option' | 'env' | 'default';

/**
 * Per-setting {@link SettingSource}, as carried on {@link FeatureSettings}:
 * every Setting with a config value (see `lib/setting-definitions.ts`).
 */
export type SettingSources = {[K in SourcedKey]?: SettingSource};

/**
 * Runtime overrides the panel applies on top of the resolved env config, for
 * settings whose runtime is already injected (so they can change live). A
 * feature disabled at config time has no runtime, so it can't be enabled here
 * — only the behaviour of already-enabled features is overridable. Pure
 * preferences ride along; they have no config value, so unset reads as their
 * default. Each key is documented on its entry in `lib/setting-definitions.ts`.
 *
 * Persisted under {@link SETTINGS_OVERRIDE_LS_KEY} (the panel and app share an
 * origin) so overrides survive reloads, and pushed live over
 * {@link SETTINGS_OVERRIDE_CHANNEL} via Vite HMR for immediate effect.
 */
export type SettingsOverride = {
  [K in OverridableKey | PreferenceKey]?: SettingValue<K>;
};

/**
 * Built-in editors the source overlay can open files in. Keep in sync with
 * BUILTIN_EDITORS in lib/runtime/source-overlay/editors.ts.
 */
export const SOURCE_OVERLAY_EDITORS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  {value: 'vscode', label: 'VS Code'},
  {value: 'cursor', label: 'Cursor'},
  {value: 'zed', label: 'Zed'},
  {value: 'idea', label: 'IntelliJ'},
  {value: 'windsurf', label: 'Windsurf'},
];

/** localStorage key holding the {@link SettingsOverride}. */
export const SETTINGS_OVERRIDE_LS_KEY = 'lit-devtools-overrides';

/** The config values overrides were made against; defined with the key map. */
export type {OverrideBaselines} from '../lib/settings-override.js';

/** localStorage key holding the {@link OverrideBaselines}. */
export const OVERRIDE_BASELINES_LS_KEY = 'lit-devtools-override-baselines';

/** Vite HMR channel the server uses to push overrides to the app runtime. */
export const SETTINGS_OVERRIDE_CHANNEL = 'lit-devtools:settings-override';

/**
 * Timeline channel names carried over `import.meta.hot` (Vite) or the
 * page-link RPC events (standalone). Here rather than in
 * `devframe/protocol.ts` so the page runtime can import them without
 * bundling the protocol into the page.
 */
export const CHANNEL_PUSH_EVENT = 'lit:timeline:push-event';
export const CHANNEL_CUSTOM_LAYER = 'lit:timeline:custom-layer';
export const CHANNEL_RUNTIME_READY = 'lit:timeline:runtime-ready';
export const CHANNEL_RECORDING_CHANGED = 'lit:timeline:recording-changed';
export const CHANNEL_LAYERS_CHANGED = 'lit:timeline:layers-changed';

/**
 * Vite HMR channel the DevTools "toggle source overlay" command uses to tell
 * the app runtime to toggle the overlay (the command handler runs server-side).
 */
export const SOURCE_OVERLAY_TOGGLE_CHANNEL =
  'lit-devtools:toggle-source-overlay';
