import type { SlipstreamApi } from './index'

declare global {
  interface Window {
    slipstream: SlipstreamApi
  }
}

export {}
