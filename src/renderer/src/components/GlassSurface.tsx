import { memo } from 'react'
import LiquidGlass from 'liquid-glass-react'

// Fixed coordinates opt out of the library's mouse tracking. Large navigation
// panels should stay still, and moving the pointer should not rerender them.
const STILL = { x: 0, y: 0 }
const FILL = {
  position: 'absolute' as const,
  top: '50%',
  left: '50%',
  width: '100%',
  height: '100%'
}

/** A decorative layer: text, inputs and video remain outside the glass filter. */
export const GlassSurface = memo(function GlassSurface(): React.JSX.Element {
  return (
    <div className="liquid-skin" aria-hidden="true">
      <LiquidGlass
        className="liquid-root"
        style={FILL}
        padding="0"
        cornerRadius={24}
        displacementScale={28}
        blurAmount={0.12}
        saturation={125}
        aberrationIntensity={0.6}
        elasticity={0}
        globalMousePos={STILL}
        mouseOffset={STILL}
        mode="standard"
      >
        <span />
      </LiquidGlass>
    </div>
  )
})
