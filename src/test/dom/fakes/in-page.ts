/** Stand-in for `src/panel/in-page.ts`: a direct page channel that never
 *  connects, so callers take their RPC fallback. */
export const inPageChannel = () => ({status: 'idle', emit() {}});
export const inPageConnected = (): boolean => false;
