/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The direct page ↔ panel channel, for interactions that never need the node
 * side.
 *
 * Everything else the Components tab does goes panel → node → page over RPC
 * and Vite's HMR channel, and should keep going that way: the node side caches
 * the tree and the last details so a panel that connects late has something to
 * render, and so the MCP tools can answer without a panel open. None of that
 * is true of the hover outline — it is pure page-local drawing, it is issued
 * on every `mouseenter` in the tree, and nothing but the page itself ever
 * wants to know about it.
 *
 * Devframe's in-page channel connects a page script to a panel iframe over a
 * `MessageChannel` with no server in the path (same-origin, handshake by
 * posting to the ancestor chain). Two consequences:
 *
 *  - The outline stops paying a full round trip through node on every pointer
 *    move.
 *  - It keeps working where there is no node side at all, which is what a
 *    static snapshot of the panel needs to be more than a screenshot.
 *
 * The channel is best-effort by construction. A panel opened as its own tab
 * has no ancestor page script to handshake with, so both sides must treat
 * "not connected" as normal and fall back to the RPC path.
 */

/** Channel name, shared by both endpoints. */
export const LIT_IN_PAGE_CHANNEL = 'lit:in-page';

/**
 * Contract for {@link LIT_IN_PAGE_CHANNEL}.
 *
 * `highlight` is an event, not a query: the panel does not want an answer, and
 * a fire-and-forget emit is what keeps a hover cheap. `id` is the same stable
 * numeric element id used everywhere else (the timeline's `idOf()` WeakMap),
 * so a tree node, a details payload, and an outline all agree on identity.
 * `null` clears the outline.
 */
export interface LitInPageProtocol {
  events: {
    pageScript: {
      highlight: (id: number | null) => void;
    };
  };
}
