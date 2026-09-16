/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {createContext} from '@lit/context';

/**
 * Context key in its own non-component module. Two HMR safety notes:
 *
 * - A string key is identity-by-value (`createContext('x') ===
 *   createContext('x')`), so even a re-executed `createContext` call still
 *   matches existing providers. A `Symbol()` key would not.
 * - Living here, the module never self-accepts, so component edits don't
 *   re-execute it at all (same pattern as the shared signals).
 */
export const counterContext = createContext<number>('hmr-counter-context');
