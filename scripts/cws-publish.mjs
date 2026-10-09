/**
 * Uploads a signed CRX to the Chrome Web Store and submits it for review:
 *
 *     CWS_ACCESS_TOKEN=… CWS_PUBLISHER_ID=… CWS_ITEM_ID=… \
 *       node scripts/cws-publish.mjs dist/lit-inspector-<version>.crx
 *     … node scripts/cws-publish.mjs --check   # read-only access check
 *
 * Used by the release workflow's `chrome-web-store` job, which gets the
 * access token keylessly (GitHub OIDC through Workload Identity Federation,
 * scope `https://www.googleapis.com/auth/chromewebstore`). The item has
 * opted in to verified CRX uploads, so the file must be the CRX
 * `package:extension --key` writes, not the zip.
 *
 * Follows https://developer.chrome.com/docs/webstore/using-api (API v2):
 * `:upload` takes the raw file, named in `X-Goog-Upload-File-Name`, and may answer `IN_PROGRESS`, in which case
 * `:fetchStatus` is polled until `lastAsyncUploadState` settles; then
 * `:publish` submits the uploaded version for review. The script finishes
 * once the store accepts the submission. The review itself takes days and
 * runs on its own; the item is published with its dashboard visibility when
 * it passes.
 *
 * `--check` only reads the item's status, which proves the token, the
 * service account's access and both IDs without changing anything; the
 * `store-access` workflow runs it.
 */

import {readFile} from 'node:fs/promises';
import * as path from 'node:path';

const API = 'https://chromewebstore.googleapis.com';
const POLL_MS = 5_000;
const POLL_TRIES = 60;

const [file] = process.argv.slice(2);
const {
  CWS_ACCESS_TOKEN: token,
  CWS_PUBLISHER_ID: publisher,
  CWS_ITEM_ID: item,
} = process.env;
if (!file || !token || !publisher || !item) {
  console.error(
    'Usage: CWS_ACCESS_TOKEN=… CWS_PUBLISHER_ID=… CWS_ITEM_ID=… node scripts/cws-publish.mjs <file.crx>'
  );
  process.exit(1);
}

const itemPath = `publishers/${publisher}/items/${item}`;

/** One API call; throws with the store's own error message on failure. */
const call = async (method, url, body, headers = {}) => {
  const res = await fetch(url, {
    method,
    headers: {Authorization: `Bearer ${token}`, ...headers},
    ...(body === undefined ? {} : {body}),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401
        ? ' The access token was refused; check the Workload Identity setup.'
        : res.status === 403
          ? ' Is the service account added under Account in the developer dashboard?'
          : res.status === 404
            ? ' Check CWS_PUBLISHER_ID and CWS_ITEM_ID.'
            : '';
    throw new Error(`${method} ${url} -> ${res.status}.${hint}\n${text}`);
  }
  return text ? JSON.parse(text) : {};
};

if (file === '--check') {
  const status = await call('GET', `${API}/v2/${itemPath}:fetchStatus`);
  console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}

// The store tells a CRX from a zip by the file name in this header, not by
// the bytes or the Content-Type; without it a CRX is taken for a zip and
// refused with PKG_MUST_UPDATE_AS_CRX (the item takes only verified CRXs).
const upload = await call(
  'POST',
  `${API}/upload/v2/${itemPath}:upload`,
  await readFile(file),
  {
    'X-Goog-Upload-Protocol': 'raw',
    'X-Goog-Upload-File-Name': path.basename(file),
  }
);
console.log(
  `Uploaded ${file}: ${upload.uploadState} (version ${upload.crxVersion})`
);

let state = upload.uploadState;
for (let i = 0; state === 'IN_PROGRESS' && i < POLL_TRIES; i++) {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  state = (await call('GET', `${API}/v2/${itemPath}:fetchStatus`))
    .lastAsyncUploadState;
  console.log(`Upload state: ${state}`);
}
if (state !== 'SUCCEEDED') {
  throw new Error(
    `Upload did not succeed (${state}). A version that isn't higher than the store's fails here.`
  );
}

const published = await call(
  'POST',
  `${API}/v2/${itemPath}:publish`,
  JSON.stringify({}),
  {'Content-Type': 'application/json'}
);
console.log(`Submitted for review: ${published.state}`);
for (const warning of published.warningInfo?.warnings ?? []) {
  console.log(`::warning::${JSON.stringify(warning)}`);
}
