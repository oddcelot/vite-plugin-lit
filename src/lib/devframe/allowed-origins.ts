/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The origin allowlist behind `lit-devtools dev --allow-origin`.
 *
 * devframe compares `allowedOrigins` entries exactly, which cannot admit a
 * page whose origin is only known once it boots: StackBlitz gives every port
 * of a project its own `https://<slug>--<port>--<hash>.<zone>.webcontainer-api.io`.
 * An entry may therefore put `*` in its host (`https://*.webcontainer-api.io`),
 * standing for one or more DNS labels. Scheme and port still have to match.
 *
 * With a wildcard among the entries the list is handed to devframe as an
 * origin registry, the one shape it accepts that decides per origin; its
 * WebSocket and SSE gates both ask it. Without one it stays a plain array.
 */

import {isAllowedOrigin} from 'devframe/rpc/transports/ws-server';
import type {WsOriginRegistry} from 'devframe/rpc/transports/ws-server';

/** An entry with `*` in the host, compiled to a matcher. */
const compilePattern = (entry: string): RegExp => {
  const match = /^(https?):\/\/([^/:]+)(?::(\d+))?\/?$/.exec(entry);
  const host = match?.[2] ?? '';
  // `*` alone, or `*.com`, would admit most of the web.
  if (match === null || !/^(?:[^*]*\*)*[^*]*\.[^*.]+\.[^*.]+$/.test(host)) {
    throw new Error(
      `--allow-origin ${entry}: a wildcard needs the shape ` +
        `https://*.example.com, with at least two literal labels after it`
    );
  }
  const [, scheme, , port] = match;
  const hostSource = host
    .split('*')
    .map((part) => part.replace(/[.\\+?^$()[\]{}|-]/g, '\\$&'))
    .join('[a-z0-9-]+(?:\\.[a-z0-9-]+)*');
  const portSource = port === undefined ? '' : `:${port}`;
  return new RegExp(`^${scheme}://${hostSource}${portSource}$`, 'i');
};

/**
 * `allowedOrigins` for `createDevServer`, from the `--allow-origin` values:
 * `undefined` for none, the entries as given when all are exact, or a registry
 * that also matches the wildcard ones. Throws on a malformed wildcard entry.
 */
export const resolveAllowedOrigins = (
  entries: readonly string[]
): readonly string[] | WsOriginRegistry | undefined => {
  if (entries.length === 0) return undefined;
  const exact = entries
    .filter((entry) => !entry.includes('*'))
    .map((entry) => entry.replace(/\/$/, ''));
  const patterns = entries
    .filter((entry) => entry.includes('*'))
    .map(compilePattern);
  if (patterns.length === 0) return exact;
  return {
    // No viewer registers itself through this list, so the token guards
    // nothing; it is random only so it is never a guessable constant.
    token: crypto.randomUUID(),
    registerFromUrl: () => undefined,
    isAllowed: (origin) =>
      isAllowedOrigin(origin, exact) ||
      (origin !== undefined && patterns.some((re) => re.test(origin))),
  };
};
