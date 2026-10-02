import { useEffect, useRef, useState } from 'react'
import { Palette, Tick } from './Icons'
import { applyTheme, currentTheme, THEMES } from '../lib/themes'
import { AccentPicker } from './AccentPicker'

/**
 * The titlebar's theme menu. It holds the open/closed state and the id it is
 * showing a tick against, and nothing else — the ground itself lives on
 * <html>, so no other component has to be told a theme changed.
 */
export function ThemePicker(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState(currentTheme)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (id: string): void => {
    applyTheme(id)
    setTheme(id)
    setOpen(false)
  }

  return (
    <div className="theme-wrap" ref={wrap}>
      <button
        className={`ctl ${open ? 'is-pinned' : 'is-off'}`}
        onClick={() => setOpen((o) => !o)}
        title="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Palette />
      </button>
      {open && (
        <div className="theme-pop" role="menu">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-opt ${theme === t.id ? 'on' : ''}`}
              onClick={() => pick(t.id)}
              role="menuitem"
            >
              <span className="theme-chip" style={{ background: t.dot }} />
              <span className="theme-label">{t.label}</span>
              {theme === t.id && <Tick />}
            </button>
          ))}
          <div className="theme-sep" />
          <AccentPicker onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
