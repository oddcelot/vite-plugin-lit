/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {signal} from '@lit-labs/signals';

/**
 * Lives in its own non-component module on purpose: this module never
 * self-accepts, so editing the components that consume it does not
 * re-execute it — the signal object (and its value) survive HMR updates.
 * A module-level signal declared inside an edited component module would
 * be re-created (fresh value) on every update; that's inherent to module
 * re-execution.
 */
export const sharedCounter = signal(0);
