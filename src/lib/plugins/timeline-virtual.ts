import type {Plugin} from 'vite';
import {resolveRuntimeModule} from './shared.js';

const TIMELINE_VIRTUAL_ID = 'virtual:lit-plugin/timeline';
const TIMELINE_RESOLVED_ID = '\0virtual:lit-plugin/timeline';
const TIMELINE_STUB =
  'export const addTimelineEvent = () => {};\n' +
  'export const addTimelineLayer = () => {};\n';

/**
 * The public timeline API virtual module, served in dev and build alike:
 * app code importing it must keep building under `vite build`, where the HMR
 * plugin doesn't apply. While these hooks lived on that serve-only plugin,
 * nothing claimed the specifier during a build and the bundler failed to
 * resolve it.
 *
 * `getTimeline` is a getter, not a value: `litPlugin()` re-resolves its
 * options against the loaded env in a `config` hook, which runs after the
 * plugin array is built.
 */
export const litTimelineVirtual = (
  getTimeline: () => boolean = () => false
): Plugin => {
  let isBuild = false;
  return {
    name: 'lit-timeline-virtual',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    resolveId(id) {
      return id === TIMELINE_VIRTUAL_ID ? TIMELINE_RESOLVED_ID : null;
    },
    load(id) {
      if (id !== TIMELINE_RESOLVED_ID) {
        return null;
      }
      // Under build the stub is unconditional, even with `timeline: true`.
      // The runtime delivers only over `import.meta.hot`, so in a production
      // bundle it is a queue that never drains; the stub keeps the transport
      // out of the bundle and makes the documented "no-op in production"
      // behavior true.
      if (isBuild || !getTimeline()) {
        return {code: TIMELINE_STUB, moduleType: 'js'};
      }
      const apiPath = resolveRuntimeModule('timeline/public-api');
      return {
        code: `export * from ${JSON.stringify(apiPath)};\n`,
        moduleType: 'js',
      };
    },
  };
};
