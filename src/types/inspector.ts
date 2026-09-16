/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Shared types and channel/path constants for the Components inspector.
 *
 * The inspector lets the DevTools panel show a hierarchical tree of the Lit
 * components on the page plus a detail view (reactive properties, internal
 * state, attributes, source) of a selected element. The panel can't touch the
 * page DOM directly (separate iframe document), so everything flows over the
 * existing transport: panel → server (POST {@link INSPECT_PATH}) → app runtime
 * (HMR {@link INSPECT_CMD_CHANNEL}); app → server (HMR
 * {@link INSPECT_DATA_CHANNEL}) → panel (SSE `event: {@link INSPECT_SSE_EVENT}`).
 *
 * Elements are referenced across the boundary by the stable numeric id from the
 * timeline's `idOf()` WeakMap, so a tree node, a details payload, and an
 * inspector pick all agree on identity.
 */

export interface ElementSource {
  file: string;
  line: number;
}

/** A node in the component render tree (one inspectable Lit element). */
export interface InspectorTreeNode {
  id: number;
  tagName: string;
  componentName?: string;
  source?: ElementSource;
  children: InspectorTreeNode[];
}

/** One reactive property (or internal `@state`) of an inspected element. */
export interface InspectorProp {
  name: string;
  /** Serialized, depth-limited preview of the current value. */
  value: string;
  /** A short type tag (`string`, `number`, `Array(3)`, `MyClass`, …). */
  type: string;
  /** The reflected attribute name, or `false` when `attribute: false`. */
  attribute: string | false;
  /** Whether the property reflects to its attribute. */
  reflects: boolean;
  /** Whether it's an internal `@state()` (no public attribute). */
  state: boolean;
}

/** Full detail snapshot for a single inspected element. */
export interface InspectorDetails {
  id: number;
  tagName: string;
  componentName?: string;
  source?: ElementSource;
  attributes: Array<{name: string; value: string}>;
  properties: InspectorProp[];
  flags: {
    hasUpdated: boolean;
    isUpdatePending: boolean;
    hasShadowRoot: boolean;
  };
}

/** App runtime → panel messages, carried on SSE `event: inspect`. */
export type InspectorMessage =
  /** The runtime came online; the panel should (re)request the tree. */
  | {type: 'ready'}
  | {type: 'tree'; roots: InspectorTreeNode[]}
  | {type: 'details'; details: InspectorDetails}
  /** The requested element id couldn't be resolved (removed / GC'd). */
  | {type: 'gone'; id: number}
  /** An inspect-mode overlay pick — select this element in the panel. */
  | {type: 'pick'; id: number};

/** Panel → app runtime commands, POSTed to {@link INSPECT_PATH}. */
export type InspectorCommand =
  | {type: 'tree'}
  | {type: 'details'; id: number}
  /** Keep pushing fresh details for `id` as it updates; `null` stops. */
  | {type: 'watch'; id: number | null}
  /** Outline element `id` in the page on tree hover; `null` clears it. */
  | {type: 'highlight'; id: number | null}
  /**
   * Opt-in live tree: when enabled, the runtime watches the DOM and pushes a
   * fresh `tree` message whenever the component hierarchy changes. Off by
   * default (the panel otherwise refreshes on demand / on pick).
   */
  | {type: 'observe'; enabled: boolean}
  /**
   * Start the overlay's inspect-mode picker (the panel's "Pick" button). Handled
   * by the server (it broadcasts {@link INSPECT_OVERLAY_TOGGLE_CHANNEL}), not the
   * app runtime, so it never reaches the runtime's command handler.
   */
  | {type: 'pick'};

/** HMR channel the server uses to forward a panel command to the app runtime. */
export const INSPECT_CMD_CHANNEL = 'lit:inspect:cmd';

/** HMR channel the app runtime uses to push an {@link InspectorMessage}. */
export const INSPECT_DATA_CHANNEL = 'lit:inspect:data';

/** Vite HMR channel the DevTools "inspect element" command broadcasts on. */
export const INSPECT_OVERLAY_TOGGLE_CHANNEL = 'lit-devtools:toggle-inspect';

/** POST endpoint the panel uses to send an {@link InspectorCommand}. */
export const INSPECT_PATH = '/__lit-devtools-inspect';

/** Named SSE event the server relays {@link InspectorMessage}s to the panel on. */
export const INSPECT_SSE_EVENT = 'inspect';
