import type {KnownEditor} from 'devframe/utils/launch-editor';
import type {SettingsOverride} from '../../types/timeline.js';

/**
 * The source overlay's editor keys, mapped to the command `launch-editor`
 * knows them by. The two vocabularies overlap by accident of naming (`zed`,
 * `cursor`, `idea`) except for VS Code, whose overlay key is `vscode` but
 * whose command is `code`.
 *
 * `windsurf` is missing on purpose: `@devframes/service-open` only accepts
 * `launch-editor`'s own picklist, and passing anything else would either be
 * rejected or spawn a command nobody vetted. It, custom `{name, url}`
 * editors and unknown keys all resolve to `undefined`, which leaves
 * `launch-editor` to auto-detect as it always did.
 */
const LAUNCH_EDITORS: Record<string, KnownEditor> = {
  vscode: 'code',
  cursor: 'cursor',
  zed: 'zed',
  idea: 'idea',
};

/** The `launch-editor` command for an overlay editor key, if it has one. */
export const toLaunchEditor = (
  key: string | undefined
): KnownEditor | undefined =>
  key !== undefined && Object.hasOwn(LAUNCH_EDITORS, key)
    ? LAUNCH_EDITORS[key]
    : undefined;

/**
 * The editor server-side open-in-editor should use: the panel override if the
 * developer set one, else the editor named in config or env, else nothing.
 *
 * `configured` must be `undefined` when the developer never named an editor.
 * The Settings tab reports `vscode` for that case (the overlay's URL-scheme
 * default), but forcing `code` here would trade auto-detection for a guess
 * on every project that never chose.
 */
export const resolveLaunchEditor = (
  configured: string | undefined,
  override: SettingsOverride | undefined
): KnownEditor | undefined =>
  toLaunchEditor(override?.sourceOverlayEditor ?? configured);
