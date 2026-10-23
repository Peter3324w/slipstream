import { useEffect, useState, type RefObject } from 'react'

/** Keep fullscreen chrome awake for activity without rerendering on every move. */
export function useFullscreenControls(target: RefObject<HTMLElement | null>): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const stage = target.current
    if (!stage) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let dragging = false

    const clear = (): void => {
      clearTimeout(timer)
      timer = undefined
    }
    const wake = (): void => {
      clear()
      setHidden(false)
      if (document.fullscreenElement !== stage) return
      timer = setTimeout(() => {
        const controls = stage.querySelector('.controls')
        // A slider drag, open quality menu or keyboard focus must remain usable.
        if (dragging || controls?.matches(':hover') ||
          controls?.querySelector(':focus-visible, [role="menu"]')) return
        setHidden(true)
      }, 2000)
    }
    const down = (): void => {
      dragging = true
      wake()
    }
    const up = (): void => {
      dragging = false
      wake()
    }
    const fullscreenChanged = (): void => {
      dragging = false
      wake()
    }

    document.addEventListener('fullscreenchange', fullscreenChanged)
    stage.addEventListener('pointermove', wake)
    stage.addEventListener('pointerleave', wake)
    stage.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    stage.addEventListener('keydown', wake)
    stage.addEventListener('focusin', wake)
    stage.addEventListener('focusout', wake)
    wake()
    return () => {
      clear()
      document.removeEventListener('fullscreenchange', fullscreenChanged)
      stage.removeEventListener('pointermove', wake)
      stage.removeEventListener('pointerleave', wake)
      stage.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      stage.removeEventListener('keydown', wake)
      stage.removeEventListener('focusin', wake)
      stage.removeEventListener('focusout', wake)
    }
  }, [target])

  return hidden
}
