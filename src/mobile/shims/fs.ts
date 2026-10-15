/**
 * node:fs/promises for the mobile bundle. Only emotes.ts and its disk cache reach
 * for it, and that cache is never switched on here (no setEmoteCacheDir), so these
 * exist to satisfy the import. A call would mean that changed: fail loudly.
 */
const unavailable = (): Promise<never> => Promise.reject(new Error('No filesystem in the mobile build'))
export const readFile = unavailable
export const writeFile = unavailable
export const mkdir = unavailable
export const rm = unavailable
