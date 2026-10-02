/**
 * The whole feature, from the renderer's side: a data-theme attribute on <html>
 * that the token blocks in tokens.css key off. Nothing else in the app needs to
 * know which theme is on, which is the point — a component that asks is a
 * component that can get it wrong.
 *
 * Ported from PlayTime's lib/util.js so the two apps behave the same way.
 */

export interface Theme {
  id: string
  label: string
  /** The theme's accent, and the whole swatch.
   *
   *  It used to be three bands in PlayTime — floor, raised surface, text —
   *  which was honest about what a theme moves and useless to look at: two of
   *  the three are near-black, so at 16px every chip read as a dark smudge. The
   *  accent is the one value a person can actually name the theme by. Deep is
   *  the blue one.
   *
   *  It is repeated here rather than read from the CSS because the theme blocks
   *  are all loaded at once; this and --accent in tokens.css have to move
   *  together, which is only ever when a theme is added. */
  dot: string
}

export const DEFAULT_THEME = 'midnight'

export const THEMES: Theme[] = [
  // Midnight is Slipstream's own: PlayTime's black ground under this app's
  // purple rather than its white.
  { id: 'midnight', label: 'Midnight', dot: '#9d7bff' },
  { id: 'graphite', label: 'Graphite', dot: '#e8b075' },
  { id: 'deep', label: 'Deep', dot: '#7c9cff' },
  { id: 'moss', label: 'Moss', dot: '#8ce563' },
  { id: 'rose', label: 'Rose', dot: '#f472b6' }
]

const KEY = 'slipstream.theme'

/**
 * Midnight is the default and carries no attribute, so an unknown or missing
 * value falls back to it rather than leaving the app half-themed — a stored id
 * from a theme that was later removed must not strand someone on a ground that
 * no longer has tokens.
 */
export function applyTheme(id: string): void {
  const known = THEMES.some((t) => t.id === id)
  const next = known ? id : DEFAULT_THEME
  if (next === DEFAULT_THEME) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // A theme that cannot be remembered is still a theme for this session.
  }
}

export function currentTheme(): string {
  return document.documentElement.dataset.theme || DEFAULT_THEME
}

/**
 * Called before the first render, so the window never paints the default ground
 * and then swaps under the person who chose something else.
 */
export function restoreTheme(): void {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) applyTheme(saved)
  } catch {
    // Private mode, cleared site data: the default ground is a fine answer.
  }
}
