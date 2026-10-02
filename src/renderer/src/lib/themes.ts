/**
 * The whole feature, from the renderer's side: a data-theme attribute on <html>
 * that the token blocks in tokens.css key off, plus an optional accent parked on
 * the element's inline style. Nothing else in the app needs to know which theme
 * is on, which is the point — a component that asks is a component that can get
 * it wrong.
 *
 * Ported from PlayTime's lib/util.js so the two apps behave the same way.
 */

import { applyAccent, nextAccentRecents } from './accent'

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

const THEME_KEY = 'slipstream.theme'
const ACCENT_KEY = 'slipstream.accent'
const RECENTS_KEY = 'slipstream.accent.recents'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // A choice that cannot be remembered is still a choice for this session.
  }
}

/**
 * Midnight is the default and carries no attribute, so an unknown or missing
 * value falls back to it rather than leaving the app half-themed — a stored id
 * from a theme that was later removed must not strand someone on a ground that
 * no longer has tokens behind it.
 */
function setThemeAttr(id: string): string {
  const known = THEMES.some((t) => t.id === id)
  const next = known ? id : DEFAULT_THEME
  if (next === DEFAULT_THEME) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = next
  return next
}

/**
 * Switching theme re-derives the accent, and has to. The accent's companions are
 * computed against the theme's own green and red — a hue that crowded Deep's
 * mint may sit clear of Moss's — so the nudge has to be recalculated against
 * whichever ground is now underneath. The accent itself survives the switch
 * because it is parked on the element rather than held in a component.
 */
export function applyTheme(id: string): void {
  write(THEME_KEY, setThemeAttr(id))
  applyAccent(currentAccent())
}

export function currentTheme(): string {
  return document.documentElement.dataset.theme || DEFAULT_THEME
}

/** null means Auto: whatever accent the theme was drawn with. */
export function currentAccent(): string | null {
  return document.documentElement.dataset.accent || null
}

export function accentRecents(): string[] {
  const raw = read(RECENTS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * Passing null is Auto, which clears the override and lets the theme's own
 * accent show through. Auto is not added to the recents: a history of "no
 * colour" is not a colour anyone wants to return to.
 */
export function setAccent(hex: string | null): void {
  applyAccent(hex)
  write(ACCENT_KEY, hex)
  if (hex) write(RECENTS_KEY, JSON.stringify(nextAccentRecents(accentRecents(), hex)))
}

/**
 * Called before the first render, so the window never paints the default ground
 * and then swaps under the person who chose something else.
 *
 * The theme has to land before the accent does — the nudge reads the theme's own
 * green and red to decide whether the accent is crowding them.
 */
export function restoreAppearance(): void {
  setThemeAttr(read(THEME_KEY) || DEFAULT_THEME)
  applyAccent(read(ACCENT_KEY))
}
