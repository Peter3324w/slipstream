/** node:path for the mobile bundle: the one function the shared modules call. */
export const join = (...parts: string[]): string => parts.filter(Boolean).join('/')
export const dirname = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')))
