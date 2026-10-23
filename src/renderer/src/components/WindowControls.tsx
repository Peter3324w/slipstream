import { useEffect, useState } from 'react'

export function WindowControls(): React.JSX.Element | null {
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)
  const [fullscreenPending, setFullscreenPending] = useState(false)
  const controls = window.slipstream?.windowControls

  useEffect(() => {
    const update = (): void => setFullscreen(!!document.fullscreenElement)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || !document.fullscreenElement) return
      event.preventDefault()
      void document.exitFullscreen().catch((error) => console.warn('Could not exit fullscreen', error))
    }
    document.addEventListener('fullscreenchange', update)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', update)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const toggleFullscreen = async (): Promise<void> => {
    setFullscreenPending(true)
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch (error) {
      console.warn('Could not change fullscreen mode', error)
    } finally {
      setFullscreenPending(false)
    }
  }

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

  if (!controls) return null

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button className="window-button" title={fullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'}
        aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} aria-pressed={fullscreen}
        disabled={fullscreenPending} onClick={() => void toggleFullscreen()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={fullscreen
            ? 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5'
            : 'M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5'} />
        </svg>
      </button>
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
