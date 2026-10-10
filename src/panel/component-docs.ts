/**
 * The selected component's documentation, from the Custom Elements Manifest
 * the host found for its tag (`component-docs`). Docs are per tag, not per
 * element, so selecting another `<sl-button>` keeps what is already here;
 * selecting a different tag asks again, which also picks up a manifest that
 * was regenerated since.
 *
 * Kept apart from the inspector stream on purpose: details come from the
 * page, docs from the host's disk, and a host that can't read manifests
 * (the extension, a snapshot) simply never asks.
 */

import type {ComponentDocs} from '../types/component-docs.js';
import {litRpc} from './client.js';

export class ComponentDocsSource {
  #tagName: string | undefined;
  #docs: ComponentDocs | null = null;
  readonly #onChange: () => void;

  /** `onChange` runs when docs for the current tag arrive. */
  constructor(onChange: () => void) {
    this.#onChange = onChange;
  }

  /**
   * The docs for `tagName`, or null while they load and when no manifest
   * describes it. Safe to call from `render()`: the fetch is asynchronous
   * and starts only when the tag changes.
   */
  for(tagName: string): ComponentDocs | null {
    if (tagName !== this.#tagName) {
      this.#tagName = tagName;
      this.#docs = null;
      void this.#fetch(tagName);
    }
    return this.#docs;
  }

  async #fetch(tagName: string): Promise<void> {
    try {
      const client = await litRpc();
      const {docs} = await client.rpc.call('component-docs', {tagName});
      // A slower answer for a tag the user has since left is dropped.
      if (tagName !== this.#tagName) return;
      this.#docs = docs;
      this.#onChange();
    } catch {
      // No docs is the normal state; the pane shows none.
    }
  }
}
