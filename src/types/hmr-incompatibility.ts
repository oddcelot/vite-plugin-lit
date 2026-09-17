/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Shared types and channel constant for HMR-incompatibility reporting.
 *
 * When the browser runtime can't hot-patch a component in place it logs one
 * line to the console and, by default, full-reloads the page — which clears
 * the console before anyone reads it. These types carry the same reason, in
 * structured form, from the page runtime to the node side over the HMR
 * {@link HMR_INCOMPATIBLE_CHANNEL}, where it is cached so the DevTools panel
 * and an agent-facing query RPC can both read it back after the reload.
 *
 * The three reasons mirror the "Cannot be patched in place" cases documented
 * in `docs/src/content/docs/reference/limitations.mdx`; adding a fourth means
 * extending {@link HmrIncompatibilityReason} and {@link describeHmrReason}
 * together, plus the docs page.
 */

/** Why a component couldn't be hot-patched in place, or a related silent case. */
export type HmrIncompatibilityReason =
  | {code: 'accessor-decorators'}
  | {code: 'patch-failed'; detail: string}
  | {code: 'observed-attributes-changed'};

/**
 * One HMR-incompatibility notice from the page runtime. `action` reflects
 * what actually happened for *this* event, not just the configured default:
 * 'reload' / 'warn' come from `hmr.onIncompatible`; 'none' is the
 * `observed-attributes-changed` case, which never reloads regardless of that
 * setting (the patch already succeeded).
 */
export interface HmrIncompatibilityEvent {
  tagName: string;
  /** `Date.now()` in the browser — there is no shared clock with the timeline's `performance.now()`. */
  time: number;
  reason: HmrIncompatibilityReason;
  action: 'reload' | 'warn' | 'none';
}

/** HMR channel the page runtime uses to report an {@link HmrIncompatibilityEvent}. */
export const HMR_INCOMPATIBLE_CHANNEL = 'lit:hmr:incompatible';

/**
 * How many events the node-side cache keeps, and the panel mirrors. A dev
 * session with many failing edits must not grow either without bound; the
 * newest are the ones worth keeping.
 */
export const MAX_HMR_INCOMPATIBILITIES = 50;

/**
 * Human-readable text for a reason, shared by the browser console message in
 * `src/lib/runtime/patch.ts` and the DevTools panel's banner so the two can't
 * drift apart. The wording of the first two cases is asserted verbatim by
 * `src/test/unit/patch_test.ts` — it is part of the console output contract.
 */
export const describeHmrReason = (reason: HmrIncompatibilityReason): string => {
  switch (reason.code) {
    case 'accessor-decorators':
      return 'standard accessor decorators';
    case 'patch-failed':
      return `patching failed: ${reason.detail}`;
    case 'observed-attributes-changed':
      return "observedAttributes changed; the platform registry can't pick this up";
  }
};
