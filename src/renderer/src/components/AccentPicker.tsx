import { useEffect, useRef, useState } from 'react'
import {
  ACCENT_PRESETS,
  accentSwatch,
  applyAccent,
  hexToRgb,
  rgbToHex,
  type RGB
} from '../lib/accent'
import { accentRecents, currentAccent, setAccent } from '../lib/themes'
import { Tick } from './Icons'

/* The square is HSV because that is the shape people expect to drag on — a
   saturation axis across and a brightness axis down. The deriver works in HSL,
   which is the right space for the clamps it applies but a confusing one to
   point at, so the conversion lives here rather than leaking into accent.ts. */

function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const d = max - min
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
    h *= 60
  }
  return [h, s, max]
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  const c = v * s
  const hh = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = v - c
  const base: RGB =
    hh < 1
      ? [c, x, 0]
      : hh < 2
        ? [x, c, 0]
        : hh < 3
          ? [0, c, x]
          : hh < 4
            ? [0, x, c]
            : hh < 5
              ? [x, 0, c]
              : [c, 0, x]
  return [(base[0] + m) * 255, (base[1] + m) * 255, (base[2] + m) * 255]
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** Drag anywhere in the box, including outside it once the pointer is captured —
 *  a colour picker you can fall off the edge of is a colour picker that fights
 *  you at exactly the saturated end people reach for. */
function useDrag(
  onMove: (x: number, y: number) => void
): (e: React.PointerEvent<HTMLDivElement>) => void {
  return (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const send = (cx: number, cy: number): void =>
      onMove(clamp01((cx - box.left) / box.width), clamp01((cy - box.top) / box.height))
    send(e.clientX, e.clientY)
    const move = (ev: PointerEvent): void => send(ev.clientX, ev.clientY)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
}

interface Props {
  /** Closes the whole theme popover once a choice is committed. */
  onDone: () => void
}

/**
 * Auto, a fixed row, your last four, and a square for everything else.
 *
 * PlayTime's version of this could not live in its theme menu — a 224px sidebar
 * with overflow-x hidden sliced the panel off at the edge, so it went to
 * Settings instead. This popover floats out of the titlebar and is as wide as it
 * asks to be, so the control gets to sit with the themes it belongs to.
 */
export function AccentPicker({ onDone }: Props): React.JSX.Element {
  const [accent, setAccentState] = useState<string | null>(currentAccent)
  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState<[number, number, number]>([265, 0.52, 1])
  // What to put back if they change their mind. Captured when the square opens,
  // because everything before that point was already committed.
  const previous = useRef<string | null>(null)

  const hex = rgbToHex(hsvToRgb(...hsv))

  // Live preview while dragging: the square is the one place a lie about what
  // you picked would be noticed, so the app wears it immediately and Save only
  // decides whether it is remembered.
  useEffect(() => {
    if (open) applyAccent(hex)
  }, [open, hex])

  const commit = (value: string | null): void => {
    setAccent(value)
    setAccentState(value)
    setOpen(false)
    onDone()
  }

  const openSquare = (): void => {
    previous.current = currentAccent()
    const rgb = hexToRgb(currentAccent() || '#9d7bff')
    if (rgb) setHsv(rgbToHsv(rgb))
    setOpen(true)
  }

  const cancel = (): void => {
    applyAccent(previous.current)
    setOpen(false)
  }

  const onSquare = useDrag((x, y) => setHsv(([h]) => [h, x, 1 - y]))
  const onHue = useDrag((x) => setHsv(([, s, v]) => [x * 360, s, v]))

  const dot = (value: string, key: string): React.JSX.Element => (
    <button
      key={key}
      className={`accent-dot ${accent === value ? 'on' : ''}`}
      style={{ background: accentSwatch(value) }}
      onClick={() => commit(value)}
      title={value}
    />
  )

  const recents = accentRecents().filter((c) => !ACCENT_PRESETS.includes(c))

  return (
    <div className="accent">
      <p className="accent-head">Accent</p>
      <div className="accent-row">
        <button className={`accent-auto ${accent === null ? 'on' : ''}`} onClick={() => commit(null)}>
          {accent === null && <Tick size={11} />}
          AUTO
        </button>
        {ACCENT_PRESETS.map((c) => dot(c, c))}
      </div>

      {/* Only drawn once there is a history. An empty row of holes says the
          feature is broken rather than unused. */}
      {recents.length > 0 && (
        <div className="accent-row accent-recents">
          <span className="accent-sub">Recent</span>
          {recents.map((c) => dot(c, `r-${c}`))}
        </div>
      )}

      {!open && (
        <button className="accent-custom" onClick={openSquare}>
          <span className="accent-wheel" />
          Custom colour
        </button>
      )}

      {open && (
        <div className="accent-panel">
          <div
            className="accent-sv"
            onPointerDown={onSquare}
            style={{
              background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hsv[0]} 100% 50%))`
            }}
          >
            <span
              className="accent-knob"
              style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }}
            />
          </div>

          <div className="accent-hue" onPointerDown={onHue}>
            <span className="accent-knob" style={{ left: `${(hsv[0] / 360) * 100}%`, top: '50%' }} />
          </div>

          <div className="accent-fields">
            <span className="accent-preview" style={{ background: accentSwatch(hex) }} />
            <label className="accent-field accent-field-hex">
              HEX
              <input
                value={hex}
                onChange={(e) => {
                  const rgb = hexToRgb(e.target.value)
                  if (rgb) setHsv(rgbToHsv(rgb))
                }}
                spellCheck={false}
              />
            </label>
            {(['R', 'G', 'B'] as const).map((label, i) => (
              <label key={label} className="accent-field">
                {label}
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={Math.round(hsvToRgb(...hsv)[i])}
                  onChange={(e) => {
                    const next = hsvToRgb(...hsv).map(Math.round) as RGB
                    next[i] = Math.max(0, Math.min(255, Number(e.target.value) || 0))
                    setHsv(rgbToHsv(next))
                  }}
                />
              </label>
            ))}
          </div>

          <div className="accent-actions">
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => commit(hex)}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
