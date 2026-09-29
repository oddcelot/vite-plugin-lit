import type {OverrideBaselines} from '../types/timeline.js';

/**
 * Whether the config value an override was made against has since changed.
 *
 * `recorded` is `undefined` for a legacy override that predates baseline
 * tracking, which never counts as a change (no false positives). Values are
 * compared structurally. The source-overlay editor reports `'custom'` for an
 * `EditorConfig` object, which can't be compared meaningfully, so any side
 * being `'custom'` skips the check.
 */
export const baselineChanged = (
  key: keyof OverrideBaselines,
  recorded: unknown,
  current: unknown
): boolean => {
  if (recorded === undefined || current === undefined) return false;
  if (
    key === 'sourceOverlayEditor' &&
    (recorded === 'custom' || current === 'custom')
  ) {
    return false;
  }
  return JSON.stringify(recorded) !== JSON.stringify(current);
};
