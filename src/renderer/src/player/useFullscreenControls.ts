import { useEffect, useState, type RefObject } from 'react'
import { FULLSCREEN_EVENT } from './display'

/** How long the bar stays after the last thing you did. */
const HIDE_AFTER_MS = 3000

/**
 * Fullscreen chrome: shown when asked for, gone three seconds later.
 *
 * A tap on the picture toggles the bar. The bar's own buttons, a slider drag,
 * an open quality menu and keyboard focus all keep it up, and anything that
 * does not (a stray mouse move over the picture, a tap that misses the bar)
 * restarts the clock rather than leaving it up for good.
 *
 * There are two fullscreens here: the browser's, and the activity's. A
 * Capacitor WebView cannot do element fullscreen, so Android's comes from
 * MainActivity instead and the mobile shell announces it on FULLSCREEN_EVENT.
 */
export function useFullscreenControls(target: RefObject<HTMLElement | null>): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const stage = target.current
    if (!stage) return
    let native = false
    let hiddenNow = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let dragging = false

    const bar = (): Element | null => stage.querySelector('.controls')
    const fullscreen = (): boolean => native || document.fullscreenElement === stage

    const clear = (): void => {
      clearTimeout(timer)
      timer = undefined
    }
    const apply = (next: boolean): void => {
      if (hiddenNow === next) return
      hiddenNow = next
      setHidden(next)
    }
    /** A drag, an open menu or keyboard focus must stay usable. Sticky hover
     *  after a tap on a phone is not evidence that anyone is still there. */
    const busy = (): boolean => {
      const controls = bar()
      const hovered = window.matchMedia('(hover: hover)').matches && !!controls?.matches(':hover')
      return dragging || hovered ||
        !!controls?.querySelector(':focus-visible, [role="menu"]')
    }
    const schedule = (): void => {
      clear()
      timer = setTimeout(() => {
        if (!busy()) apply(true)
      }, HIDE_AFTER_MS)
    }

    /** Activity of any kind: show the bar, and start the clock. */
    const wake = (): void => {
      clear()
      apply(false)
      if (fullscreen()) schedule()
    }

    /** Fullscreen itself changed, one way or the other. */
    const settle = (): void => {
      dragging = false
      if (fullscreen()) wake()
      else {
        clear()
        apply(false)
      }
    }

    const down = (event: PointerEvent): void => {
      const el = event.target
      if (el instanceof Element && el.closest('.controls')) {
        dragging = true
        wake()
        return
      }
      // Tapping the picture is the toggle; a tap on the bar never is.
      if (!fullscreen()) return
      if (hiddenNow) wake()
      else {
        clear()
        apply(true)
      }
    }
    const up = (): void => {
      // A tap on the picture must not wake the bar again on release.
      if (!dragging) return
      dragging = false
      wake()
    }
    const nativeChanged = (event: Event): void => {
      native = Boolean((event as CustomEvent<boolean>).detail)
      settle()
    }

    document.addEventListener('fullscreenchange', settle)
    window.addEventListener(FULLSCREEN_EVENT, nativeChanged)
    stage.addEventListener('pointermove', wake)
    stage.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    stage.addEventListener('keydown', wake)
    stage.addEventListener('focusin', wake)
    stage.addEventListener('focusout', wake)
    wake()

    return () => {
      clear()
      document.removeEventListener('fullscreenchange', settle)
      window.removeEventListener(FULLSCREEN_EVENT, nativeChanged)
      stage.removeEventListener('pointermove', wake)
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
