import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

const MAX_SCALE = 8
// A pinch reports small deltas (a few units per event); this makes a full
// spread of the fingers roughly double the picture.
const PINCH_RATE = 0.01

/**
 * Zoom into the video and move around inside it.
 *
 * A touchpad pinch reaches the page as wheel events with ctrlKey set (Chromium
 * does this for every pinch it does not consume itself), so Ctrl + mouse wheel
 * zooms as well. Once zoomed in, a two-finger scroll or a drag pans.
 *
 * The transform is written straight to the element: a pinch fires dozens of
 * events a second and none of them needs React. Only the rounded scale is
 * state, for the readout.
 */
export function useVideoZoom(
  wrapRef: RefObject<HTMLDivElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>
): { scale: number; reset: () => void } {
  const view = useRef({ s: 1, x: 0, y: 0 })
  const [scale, setScale] = useState(1)

  const apply = useCallback((): void => {
    const wrap = wrapRef.current
    const video = videoRef.current
    if (!wrap || !video) return
    const v = view.current
    // Snap back rather than sit at 1.02x looking slightly soft.
    if (v.s < 1.02) v.s = 1
    // The picture always covers the pane: never pan past its own edge.
    v.x = Math.min(0, Math.max(wrap.clientWidth * (1 - v.s), v.x))
    v.y = Math.min(0, Math.max(wrap.clientHeight * (1 - v.s), v.y))
    video.style.transform = v.s === 1 ? '' : `translate(${v.x}px, ${v.y}px) scale(${v.s})`
    wrap.classList.toggle('is-zoomed', v.s > 1)
    setScale(Math.round(v.s * 10) / 10)
  }, [wrapRef, videoRef])

  const reset = useCallback((): void => {
    view.current = { s: 1, x: 0, y: 0 }
    apply()
  }, [apply])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const onWheel = (e: WheelEvent): void => {
      const v = view.current
      if (e.ctrlKey) {
        e.preventDefault()
        const rect = wrap.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const next = Math.min(MAX_SCALE, Math.max(1, v.s * Math.exp(-e.deltaY * PINCH_RATE)))
        // Keep the point under the cursor where it is while the scale changes.
        v.x = cx - ((cx - v.x) * next) / v.s
        v.y = cy - ((cy - v.y) * next) / v.s
        v.s = next
        apply()
      } else if (v.s > 1) {
        e.preventDefault()
        v.x -= e.deltaX
        v.y -= e.deltaY
        apply()
      }
    }

    let drag: { id: number; x: number; y: number } | null = null
    const onDown = (e: PointerEvent): void => {
      if (view.current.s === 1 || e.button !== 0 || e.target !== videoRef.current) return
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
      wrap.setPointerCapture(e.pointerId)
      wrap.classList.add('is-panning')
    }
    const onMove = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return
      view.current.x += e.clientX - drag.x
      view.current.y += e.clientY - drag.y
      drag.x = e.clientX
      drag.y = e.clientY
      apply()
    }
    const onUp = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return
      drag = null
      wrap.classList.remove('is-panning')
    }

    // passive: false, or preventDefault is ignored and the pinch is lost.
    wrap.addEventListener('wheel', onWheel, { passive: false })
    wrap.addEventListener('pointerdown', onDown)
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerup', onUp)
    wrap.addEventListener('pointercancel', onUp)
    // Hiding chat or resizing the window changes the pane: clamp again.
    const ro = new ResizeObserver(apply)
    ro.observe(wrap)
    return () => {
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('pointerdown', onDown)
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerup', onUp)
      wrap.removeEventListener('pointercancel', onUp)
      ro.disconnect()
    }
  }, [wrapRef, videoRef, apply])

  return { scale, reset }
}
