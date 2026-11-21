import { nativeFetch } from './native-fetch'
import { mobileApi } from './api'
import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Immersive mode and forced rotation live in the activity, because a WebView
 * cannot do element fullscreen: Capacitor's chrome client cancels the custom
 * view the moment it is offered. This is the bridge the player's fullscreen
 * button looks for; the desktop preload does not define it, so the desktop
 * keeps the HTML fullscreen path.
 */
interface PlayerDisplayPlugin {
  setOrientation(options: { value: 'landscape' | 'portrait' | 'unspecified' }): Promise<void>
  setImmersive(options: { enabled: boolean }): Promise<void>
}

const PlayerDisplay = registerPlugin<PlayerDisplayPlugin>('PlayerDisplay')

// Safe to replace globally: the renderer itself never calls fetch, and hls.js
// loads over XHR, so the only callers are the shared modules api.ts runs.
// The browser preview uses ordinary fetch. Capacitor's web HTTP fallback itself
// calls fetch, so replacing it there would recurse instead of making a request.
if (Capacitor.isNativePlatform()) {
  globalThis.fetch = nativeFetch
  window.slipstreamDisplay = {
    setOrientation: (value) => PlayerDisplay.setOrientation({ value }),
    setImmersive: (enabled) => PlayerDisplay.setImmersive({ enabled })
  }
}
window.slipstream = mobileApi

// After the bridge exists, exactly as the preload runs before the page does. The
// phone layout loads last so it wins over app.css at equal specificity.
void import('./render')
