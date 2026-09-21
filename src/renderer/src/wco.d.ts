/**
 * Window Controls Overlay. Electron exposes it whenever titleBarOverlay is set,
 * but it is absent in a plain browser tab, hence the optional access at the call
 * site. Not yet in the DOM lib, so declared here.
 */
interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean
  getTitlebarAreaRect(): DOMRect
  addEventListener(type: 'geometrychange', listener: () => void): void
  removeEventListener(type: 'geometrychange', listener: () => void): void
}
