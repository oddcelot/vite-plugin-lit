/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Fake content API with latency, in its own non-component module (component
 * edits never re-execute it). Every call is counted on `window.__fakeFetches`
 * so the playground HUD-style assertions (and the e2e) can prove that a hot
 * patch does NOT re-fetch.
 */

export interface User {
  id: number;
  name: string;
  bio: string;
}

const USERS: User[] = [
  {
    id: 1,
    name: 'Ada Lovelace',
    bio: 'wrote the first program before computers existed',
  },
  {
    id: 2,
    name: 'Grace Hopper',
    bio: 'found the first actual bug (it was a moth)',
  },
  {
    id: 3,
    name: 'Katherine Johnson',
    bio: 'computed orbital trajectories by hand',
  },
  {
    id: 4,
    name: 'Margaret Hamilton',
    bio: 'named software engineering, landed Apollo 11',
  },
];

export const USER_COUNT = USERS.length;

declare global {
  interface Window {
    __fakeFetches: number;
  }
}

window.__fakeFetches = 0;

export const fakeFetchUser = async (
  id: number,
  signal?: AbortSignal
): Promise<User> => {
  window.__fakeFetches++;
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (signal?.aborted) {
    throw new Error('aborted');
  }
  const user = USERS.find((u) => u.id === id);
  if (user === undefined) {
    throw new Error(`no such user: ${id}`);
  }
  return user;
};
