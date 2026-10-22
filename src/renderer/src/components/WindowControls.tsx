import { useEffect, useState } from 'react'

export function WindowControls(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const controls = window.slipstream?.windowControls

  useEffect(() => {
    if (!controls) return
    let active = true
    const unsubscribe = controls.onMaximized(setMaximized)
    void controls.isMaximized().then((value) => {
      if (active) setMaximized(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [controls])

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button className="window-button" title="Minimise" aria-label="Minimise"
        disabled={!controls} onClick={() => void controls?.minimize()}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M1 6h10" />
        </svg>
      </button>
      <button className="window-button" title={maximized ? 'Restore' : 'Maximise'}
        aria-label={maximized ? 'Restore' : 'Maximise'} disabled={!controls}
        onClick={() => void controls?.toggleMaximize()}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
          {maximized ? <path d="M4 3V1.5h6.5V8H9M1.5 4h6.5v6.5H1.5z" /> : <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" />}
        </svg>
      </button>
      <button className="window-button window-button-close" title="Close" aria-label="Close"
        disabled={!controls} onClick={() => void controls?.close()}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="m2 2 8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  )
}
