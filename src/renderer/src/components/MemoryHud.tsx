import { useEffect, useState } from 'react'
import type { MemorySample } from '@shared/types'

/** The README's promise, on screen: per process, never one summary number. */
const TARGET_BYTES = 300 * 1024 * 1024

const LABELS: Record<string, string> = {
  Browser: 'main',
  Tab: 'renderer',
  GPU: 'gpu',
  Utility: 'utility',
  Zygote: 'zygote'
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

export function MemoryHud(): React.JSX.Element {
  const [samples, setSamples] = useState<MemorySample[]>([])

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      const next = await window.slipstream.memory()
      if (alive) setSamples(next)
    }
    void tick()
    const id = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const total = samples.reduce((sum, s) => sum + s.bytes, 0)

  return (
    <div className="hud">
      <h4>Resident memory</h4>
      {samples
        .slice()
        .sort((a, b) => b.bytes - a.bytes)
        .map((s) => (
          <div className="hud-row" key={s.pid}>
            <span>
              {LABELS[s.type] ?? s.type.toLowerCase()}{' '}
              <span style={{ color: 'var(--text-faint)' }}>{s.pid}</span>
            </span>
            <span className="n">{mb(s.bytes)}</span>
          </div>
        ))}
      <div className={`hud-row hud-total ${total > TARGET_BYTES ? 'over' : 'under'}`}>
        <span>{samples.length} processes</span>
        <span className="n">{mb(total)}</span>
      </div>
      <div className="hud-row" style={{ color: 'var(--text-faint)' }}>
        <span>target</span>
        <span className="n">{mb(TARGET_BYTES)}</span>
      </div>
    </div>
  )
}
