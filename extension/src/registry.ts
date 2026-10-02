/**
 * Which sites the extension runs on, and the content scripts that make it so.
 *
 * Nothing is injected at install: the manifest has no `content_scripts` and
 * asks for no host access. A site is enabled from the DevTools panel, which
 * requests the origin's host permission on the user's click (only an
 * extension page can, and only inside a gesture) and then asks the background
 * to register the two scripts for it here:
 *
 * - the page runtime in the MAIN world, so it can wrap the page's own
 *   `customElements.define` and Lit prototypes. Injected by the browser, not
 *   by a `<script>` the page loads, so the page's `script-src` cannot block it;
 * - the relay in the ISOLATED world, the only one with `chrome.runtime`.
 *
 * Both at `document_start`, before any of the page's scripts run, so the
 * runtime is in place before the first component is defined.
 * `persistAcrossSessions` keeps them registered over browser restarts; the
 * enabled origins are also kept in `storage.local` so the panel can tell
 * "enabled" from "permitted" without listing scripts.
 *
 * Takes its `chrome` APIs as arguments, structurally typed, so it is
 * unit-testable with fakes.
 */

import type {OriginStatus, RegistryRequest} from './protocol.js';

/** What `chrome.scripting.registerContentScripts` takes, as used here. */
export interface ContentScript {
  id: string;
  js: string[];
  matches: string[];
  runAt: 'document_start';
  world: 'MAIN' | 'ISOLATED';
  allFrames: boolean;
  persistAcrossSessions: boolean;
}

export interface ScriptingLike {
  registerContentScripts(scripts: ContentScript[]): Promise<unknown>;
  unregisterContentScripts(filter?: {ids?: string[]}): Promise<unknown>;
  getRegisteredContentScripts(filter?: {
    ids?: string[];
  }): Promise<Array<{id: string}>>;
}

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<unknown>;
}

export interface PermissionsLike {
  contains(permissions: {origins: string[]}): Promise<boolean>;
}

export interface RegistryOptions {
  scripting: ScriptingLike;
  storage: StorageAreaLike;
  permissions: PermissionsLike;
  /** The built scripts, relative to the extension root. */
  files?: {page: string; content: string};
}

export interface Registry {
  enable(origin: string): Promise<OriginStatus>;
  disable(origin: string): Promise<OriginStatus>;
  status(origin: string): Promise<OriginStatus>;
  /**
   * Unregister origins whose host permission is gone (`permissions.onRemoved`):
   * their scripts would no longer inject, but would still be listed.
   */
  forget(origins: string[]): Promise<void>;
}

/** The `storage.local` key holding the enabled origins. */
export const ENABLED_ORIGINS_KEY = 'enabledOrigins';

/**
 * The origin of `input` if it is one the extension can run on, else undefined.
 * Only http(s): `chrome://` and the Web Store refuse content scripts anyway,
 * and `file://` needs a separate opt-in the user gives in the extension's
 * settings.
 */
export const normalizeOrigin = (input: string): string | undefined => {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
};

/** The match pattern, and the host permission, for an origin. */
export const originPattern = (origin: string): string => `${origin}/*`;

const scriptIds = (origin: string) => ({
  page: `lit-page@${origin}`,
  content: `lit-content@${origin}`,
});

export const createRegistry = (options: RegistryOptions): Registry => {
  const {scripting, storage, permissions} = options;
  const files = options.files ?? {page: 'page.js', content: 'content.js'};

  const readEnabled = async (): Promise<string[]> => {
    const value = (await storage.get(ENABLED_ORIGINS_KEY))[ENABLED_ORIGINS_KEY];
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : [];
  };

  const writeEnabled = (origins: string[]) =>
    storage.set({[ENABLED_ORIGINS_KEY]: origins});

  const registered = async (origin: string): Promise<string[]> => {
    const ids = scriptIds(origin);
    const scripts = await scripting.getRegisteredContentScripts({
      ids: [ids.page, ids.content],
    });
    return scripts.map((s) => s.id);
  };

  const unregister = async (origin: string): Promise<void> => {
    // Unregistering an id that is not registered rejects the whole call.
    const ids = await registered(origin);
    if (ids.length > 0) await scripting.unregisterContentScripts({ids});
  };

  const status = async (input: string): Promise<OriginStatus> => {
    const origin = normalizeOrigin(input);
    if (origin === undefined) {
      return {
        origin: input,
        enabled: false,
        permitted: false,
        error: 'not an http(s) origin',
      };
    }
    const [enabled, ids, permitted] = await Promise.all([
      readEnabled(),
      registered(origin),
      permissions.contains({origins: [originPattern(origin)]}),
    ]);
    return {
      origin,
      enabled: enabled.includes(origin) && ids.length === 2,
      permitted,
    };
  };

  return {
    status,

    async enable(input) {
      const origin = normalizeOrigin(input);
      if (origin === undefined) return status(input);
      const pattern = originPattern(origin);
      if (!(await permissions.contains({origins: [pattern]}))) {
        return {
          origin,
          enabled: false,
          permitted: false,
          error: 'host permission not granted',
        };
      }
      const ids = scriptIds(origin);
      // Re-register from scratch, so a half-registered origin (one call
      // rejected) or an older script list heals on the next enable.
      await unregister(origin);
      const common: Omit<ContentScript, 'id' | 'js' | 'world'> = {
        matches: [pattern],
        runAt: 'document_start',
        allFrames: false,
        persistAcrossSessions: true,
      };
      await scripting.registerContentScripts([
        {...common, id: ids.page, js: [files.page], world: 'MAIN'},
        {...common, id: ids.content, js: [files.content], world: 'ISOLATED'},
      ]);
      const enabled = await readEnabled();
      if (!enabled.includes(origin)) await writeEnabled([...enabled, origin]);
      return status(origin);
    },

    async disable(input) {
      const origin = normalizeOrigin(input);
      if (origin === undefined) return status(input);
      await unregister(origin);
      const enabled = await readEnabled();
      if (enabled.includes(origin)) {
        await writeEnabled(enabled.filter((o) => o !== origin));
      }
      return status(origin);
    },

    async forget(patterns) {
      // `permissions.onRemoved` reports match patterns; `<all_urls>` removed
      // means every origin goes.
      const enabled = await readEnabled();
      const gone = patterns.includes('<all_urls>')
        ? enabled
        : enabled.filter((origin) => patterns.includes(originPattern(origin)));
      for (const origin of gone) await unregister(origin);
      if (gone.length > 0) {
        await writeEnabled(enabled.filter((o) => !gone.includes(o)));
      }
    },
  };
};

/** Answers one of the runtime messages extension pages send. */
export const handleRegistryRequest = (
  registry: Registry,
  message: RegistryRequest
): Promise<OriginStatus> => {
  switch (message.type) {
    case 'lit:enable':
      return registry.enable(message.origin);
    case 'lit:disable':
      return registry.disable(message.origin);
    case 'lit:status':
      return registry.status(message.origin);
  }
};
