import { useEffect, useState, type RefObject } from 'react'

interface Props {
  target: RefObject<HTMLElement | null>
}

export function FullscreenButton({ target }: Props): React.JSX.Element {
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenPending, setFullscreenPending] = useState(false)

  useEffect(() => {
    const update = (): void => setFullscreen(!!target.current && document.fullscreenElement === target.current)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || !target.current || document.fullscreenElement !== target.current) return
      event.preventDefault()
      void document.exitFullscreen().catch((error) => console.warn('Could not exit fullscreen', error))
    }
    document.addEventListener('fullscreenchange', update)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', update)
      document.removeEventListener('keydown', onKey)
    }
  }, [target])

  const toggleFullscreen = async (): Promise<void> => {
    setFullscreenPending(true)
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await target.current?.requestFullscreen()
    } catch (error) {
      console.warn('Could not change fullscreen mode', error)
    } finally {
      setFullscreenPending(false)
    }
  }

  return (
    <button className="ctl" title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen video'}
      aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen video'} aria-pressed={fullscreen}
      disabled={fullscreenPending} onClick={() => void toggleFullscreen()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={fullscreen
          ? 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5'
          : 'M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5'} />
      </svg>
    </button>
  )
}
