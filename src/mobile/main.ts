import { nativeFetch } from './native-fetch'
import { mobileApi } from './api'
import { Capacitor } from '@capacitor/core'

// Safe to replace globally: the renderer itself never calls fetch, and hls.js
// loads over XHR, so the only callers are the shared modules api.ts runs.
// The browser preview uses ordinary fetch. Capacitor's web HTTP fallback itself
// calls fetch, so replacing it there would recurse instead of making a request.
if (Capacitor.isNativePlatform()) globalThis.fetch = nativeFetch
window.slipstream = mobileApi

// After the bridge exists, exactly as the preload runs before the page does. The
// phone layout loads last so it wins over app.css at equal specificity.
void import('./render')
