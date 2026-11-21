/**
 * The native half of fullscreen on Android.
 *
 * `element.requestFullscreen()` cannot work in a Capacitor WebView: its
 * BridgeWebChromeClient cancels the custom view as soon as it is offered, so
 * nothing is ever attached to the window. Immersive mode and a forced
 * landscape therefore have to come from the activity, the way Xtra does it.
 *
 * The desktop preload provides nothing here, so every call site treats an
 * absent bridge as "use the browser path".
 */

export interface DisplayBridge {
  setOrientation: (value: 'landscape' | 'portrait' | 'unspecified') => Promise<void>
  setImmersive: (enabled: boolean) => Promise<void>
}

declare global {
  interface Window {
    slipstreamDisplay?: DisplayBridge
  }
}

export function displayBridge(): DisplayBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.slipstreamDisplay
}

/** Told to the mobile shell so it can stop drawing chrome around the video. */
export const FULLSCREEN_EVENT = 'slipstream:playerfullscreen'

export function announceFullscreen(on: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(FULLSCREEN_EVENT, { detail: on }))
}
