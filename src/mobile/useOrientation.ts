import { useEffect, useState } from 'react'

export type Orientation = 'portrait' | 'landscape'

const PORTRAIT = '(orientation: portrait)'

/**
 * Which way up the player is, asked once and kept current.
 *
 * A media query on its own is not enough on Android. The activity declares
 * `configChanges` for orientation, so nothing recreates the WebView when the
 * device turns; if the viewport resize lands a frame late, `matchMedia` can
 * still answer with the old orientation while the new one is on screen. The
 * element's own box is the thing we actually lay out into, so that is the
 * answer, with the query as a fallback before first layout.
 */
export function useOrientation(): Orientation {
  const [portrait, setPortrait] = useState(() => window.matchMedia(PORTRAIT).matches)

  useEffect(() => {
    const query = window.matchMedia(PORTRAIT)

    const read = (): void => {
      const root = document.documentElement
      // Before first layout both are 0, which is not evidence either way.
      if (root.clientWidth > 0 && root.clientHeight > 0) {
        setPortrait(root.clientHeight >= root.clientWidth)
      } else {
        setPortrait(query.matches)
      }
    }

    query.addEventListener('change', read)
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    window.visualViewport?.addEventListener('resize', read)

    // Catches a WebView that changes size without firing a window resize.
    const observer = new ResizeObserver(read)
    observer.observe(document.documentElement)
    read()

    return () => {
      query.removeEventListener('change', read)
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
      window.visualViewport?.removeEventListener('resize', read)
      observer.disconnect()
    }
  }, [])

  return portrait ? 'portrait' : 'landscape'
}
