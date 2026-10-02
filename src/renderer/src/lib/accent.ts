/**
 * A theme is the ground; the accent is the one colour on top of it. Splitting
 * them is what lets any accent ride any theme instead of needing five variants
 * of each, and it is the split Windows itself uses.
 *
 * Everything here derives from ONE hex, deliberately. The moment a person can
 * set --on-accent by hand, someone ships white text on a pale yellow pill; the
 * companions have to be computed from the accent or they will eventually be
 * wrong.
 *
 * Ported from PlayTime's lib/util.js, where the clamps and the hue-nudging were
 * worked out. The one addition is --accent-rgb, which PlayTime has no need for
 * and Slipstream does: .chat-7tv.is-on washes itself with
 * rgb(var(--accent-rgb) / 0.12), and a deriver that forgot it would leave the
 * sync and EMOTES pills tinted with the previous accent under every new pick.
 */

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB | null {
  const h = String(hex || '')
    .replace('#', '')
    .trim()
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const hex2 = (v: number): string =>
  Math.round(Math.max(0, Math.min(255, v)))
    .toString(16)
    .padStart(2, '0')

export const rgbToHex = ([r, g, b]: RGB): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s, l]
}

const normHue = (x: number): number => ((x % 360) + 360) % 360

export function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hh = normHue(h) / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [channel(hh + 1 / 3) * 255, channel(hh) * 255, channel(hh - 1 / 3) * 255]
}

/** WCAG relative luminance — the only honest way to decide whether what sits on
 *  this fill has to be dark or light. */
function luminance([r, g, b]: RGB): number {
  const f = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const shortestHueGap = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % 360) + 360) % 360
  return d > 180 ? 360 - d : d
}
const inBand = (h: number, [lo, hi]: [number, number]): boolean =>
  lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi

/**
 * Green means alive in this app and red means danger, in every theme. A person
 * picking an accent can land on either, and then "selected" and "live" — or
 * "selected" and "stop" — become the same colour. Moss and Rose each needed this
 * separation done by hand in their theme blocks; here it happens on its own, so
 * a hue that crowds one of them pushes THAT one aside rather than the accent the
 * person actually chose.
 *
 * Two things have to hold at once. Pick the side of the accent that is nearer
 * the colour's own hue, and stay inside a band where it still reads as what it
 * means — red that has become purple has not been rescued.
 */
function nudgeAway(
  rgbTriplet: RGB,
  accentHue: number,
  minGap: number,
  band: [number, number]
): RGB | null {
  const [h, s, l] = rgbToHsl(rgbTriplet)
  if (shortestHueGap(h, accentHue) >= minGap) return null
  const span = minGap * 1.35
  const sides = [normHue(accentHue + span), normHue(accentHue - span)].filter((x) =>
    inBand(x, band)
  )
  // Both sides outside the band means the accent is sitting on top of it; the
  // far edge is the most separation the band can give.
  const target = sides.length
    ? sides.sort((a, b) => shortestHueGap(a, h) - shortestHueGap(b, h))[0]
    : [...band].sort((a, b) => shortestHueGap(b, accentHue) - shortestHueGap(a, accentHue))[0]
  return hslToRgb(target, s, l)
}

// Where each meaning is still itself. Outside these a red stops reading as
// danger and a green stops reading as alive, which is the thing being defended.
const GREEN_BAND: [number, number] = [75, 190]
const DANGER_BAND: [number, number] = [330, 35]

const readTriplet = (name: string): RGB | null => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const p = raw.split(/[\s,]+/).map(Number)
  return p.length === 3 && p.every((n) => Number.isFinite(n)) ? (p as RGB) : null
}

const triplet = (rgb: RGB): string => rgb.map((c) => Math.round(c)).join(' ')

/**
 * Every custom property a picked accent owns. Two clamps keep an arbitrary
 * choice usable on this app's dark grounds:
 *
 * - the accent itself can't go below 38% lightness, or a selected pill
 *   disappears into the page;
 * - the DATA colour can't go below 52%, because a chart is thin marks on a dark
 *   ground and needs more light than a filled pill does. Windows makes the same
 *   call by refusing very dark accents in dark mode.
 */
export function deriveAccent(hex: string): Record<string, string> | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [h, s0, l0] = rgbToHsl(rgb)
  /* A grey has no hue — rgbToHsl reports 0, which is red — so flooring its
     saturation turned #808080 into dusty rose, and nudging green and danger away
     from "red" turned the danger colour orange under a white accent. A grey
     keeps its greyness and moves nothing else. */
  const grey = s0 < 0.04
  const s = grey ? s0 : Math.max(s0, 0.22)
  const accent = hslToRgb(h, s, Math.max(l0, 0.38))
  const hover = hslToRgb(h, s, Math.min(Math.max(l0, 0.38) + 0.1, 0.92))
  const data = hslToRgb(h, s, Math.max(l0, 0.52))
  const dark = luminance(accent) > 0.32
  const on = dark ? hslToRgb(h, 0.55, 0.07) : hslToRgb(h, 0.18, 0.96)
  const mute = on.map((c, i) => c + (accent[i] - c) * 0.45) as RGB

  const vars: Record<string, string> = {
    '--accent': rgbToHex(accent),
    '--accent-2': rgbToHex(accent),
    // Slipstream's own: the washes that tint themselves from the accent.
    '--accent-rgb': triplet(accent),
    '--accent-hover': rgbToHex(hover),
    '--on-accent': rgbToHex(on),
    '--on-accent-soft': `rgba(${triplet(on).split(' ').join(', ')}, 0.62)`,
    '--on-accent-mute': rgbToHex(mute),
    '--data': rgbToHex(data),
    '--data-rgb': triplet(data)
  }

  const green = readTriplet('--green-rgb')
  const danger = readTriplet('--danger-rgb')
  const g = !grey && green ? nudgeAway(green, h, 38, GREEN_BAND) : null
  const d = !grey && danger ? nudgeAway(danger, h, 34, DANGER_BAND) : null
  if (g) vars['--green-rgb'] = triplet(g)
  if (d) vars['--danger-rgb'] = triplet(d)
  return vars
}

/**
 * What a picked hex actually becomes once the lightness floor is applied. The
 * swatches and the preview draw THIS, not the raw pick: choosing a near-black
 * and being shown a near-black while the app lit up in a lifted version of it is
 * a small lie, and the picker is the one place it would be noticed.
 */
export function accentSwatch(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [h, s, l] = rgbToHsl(rgb)
  return rgbToHex(hslToRgb(h, s < 0.04 ? s : Math.max(s, 0.22), Math.max(l, 0.38)))
}

const ACCENT_VARS = [
  '--accent',
  '--accent-2',
  '--accent-rgb',
  '--accent-hover',
  '--on-accent',
  '--on-accent-soft',
  '--on-accent-mute',
  '--data',
  '--data-rgb',
  '--green-rgb',
  '--danger-rgb'
]

/**
 * Cleared before deriving, always: nudgeAway reads the CURRENT --green-rgb, so
 * leaving the last accent's nudge in place would rotate an already-rotated green
 * and walk it around the wheel one pick at a time.
 */
export function applyAccent(hex: string | null): void {
  const root = document.documentElement
  ACCENT_VARS.forEach((v) => root.style.removeProperty(v))
  const vars = hex ? deriveAccent(hex) : null
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
    root.dataset.accent = hex as string
  } else {
    delete root.dataset.accent
  }
}

/**
 * Capped at four because every row that shows it shows four. A longer history
 * would mean the colour you used yesterday is somewhere you can't see, which is
 * the same as not having it.
 */
export function nextAccentRecents(list: string[], hex: string | null): string[] {
  return hex ? [hex, ...(list || []).filter((c) => c !== hex)].slice(0, 4) : list || []
}

/** Spread around the wheel on purpose: four blues would look like one choice. */
export const ACCENT_PRESETS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7']
