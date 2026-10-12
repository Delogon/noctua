import { useState } from 'react'

// The owl as inline SVG — one component, five poses (design handoff
// Turn 4a). Head outline and beak are identical in all poses, only
// the eyes change. Stroke widths and eye geometry come as a lookup
// from the specimens, not from a formula.

export type OwlPose = 'awake' | 'blink' | 'asleep' | 'scan' | 'listen'

export interface OwlGlyphProps {
  pose: OwlPose
  /** Width in px; height = size * 18/20. */
  size?: number
  /** Only awake (blinking) and scan (eye sweep) move. */
  live?: boolean
  color?: string
  /** Sole exception to the one-color rule: left eye in accent (OwlView empty state). */
  accentLeftEye?: boolean
}

const HEAD =
  'M2.5 2.2 6 4.6A9.5 9.5 0 0 1 10 3.7a9.5 9.5 0 0 1 4 .9l3.5-2.4v7.1c0 4-3.3 6.5-7.5 6.5S2.5 13.3 2.5 9.3V2.2Z'
const BEAK = 'm8.8 12 1.2 1 1.2-1'

interface Tier {
  min: number
  stroke: number
  beak: number
  pupil: number
  scan: number
  listen: number
  lid: { d: string; w: number }
  sleep: { d: string; w: number }
}

// Values per size step from the Turn 4 specimens (64/44/30/17 px).
const TIERS: Tier[] = [
  {
    min: 64,
    stroke: 1.2,
    beak: 1.1,
    pupil: 1.35,
    scan: 1.2,
    listen: 1.8,
    lid: { d: 'M5.75 8.6h2.7M11.55 8.6h2.7', w: 1.35 },
    sleep: { d: 'M5.75 8.3q1.35 1.6 2.7 0M11.55 8.3q1.35 1.6 2.7 0', w: 1.35 }
  },
  {
    min: 40,
    stroke: 1.35,
    beak: 1.2,
    pupil: 1.35,
    scan: 1.2,
    listen: 1.8,
    lid: { d: 'M5.75 8.6h2.7M11.55 8.6h2.7', w: 1.35 },
    sleep: { d: 'M5.75 8.3q1.35 1.6 2.7 0M11.55 8.3q1.35 1.6 2.7 0', w: 1.35 }
  },
  {
    min: 24,
    stroke: 1.5,
    beak: 1.35,
    pupil: 1.5,
    scan: 1.35,
    listen: 1.95,
    lid: { d: 'M5.7 8.6h2.8M11.5 8.6h2.8', w: 1.4 },
    sleep: { d: 'M5.7 8.3q1.4 1.65 2.8 0M11.5 8.3q1.4 1.65 2.8 0', w: 1.4 }
  },
  {
    min: 0,
    stroke: 1.7,
    beak: 1.5,
    pupil: 1.7,
    scan: 1.5,
    listen: 2.1,
    lid: { d: 'M5.5 8.6h3.2M11.3 8.6h3.2', w: 1.5 },
    sleep: { d: 'M5.6 8.3q1.5 1.7 3 0M11.4 8.3q1.5 1.7 3 0', w: 1.5 }
  }
]

/** Exported for the render test — deliberately a lookup, not a calculation (4a "SCALES"). */
// eslint-disable-next-line react-refresh/only-export-components -- pure function imported by the render test; Fast Refresh of the component is unaffected
export function owlTier(size: number): Tier {
  return TIERS.find((tier) => size >= tier.min) ?? TIERS[TIERS.length - 1]
}

export function OwlGlyph({
  pose,
  size = 17,
  live = false,
  color = 'var(--ink)',
  accentLeftEye = false
}: OwlGlyphProps): React.JSX.Element {
  // Roll the blink duration once per mount — never two owls in sync
  const [blinkDur] = useState(() => 8 + Math.random() * 6)
  const tier = owlTier(size)

  const pupils = (radius: number): React.JSX.Element => (
    <>
      <circle cx="7.1" cy="8.6" r={radius} fill={accentLeftEye ? 'var(--ac)' : color} />
      <circle cx="12.9" cy="8.6" r={radius} fill={color} />
    </>
  )

  const eyes = (): React.JSX.Element => {
    switch (pose) {
      case 'awake':
        if (!live) return pupils(tier.pupil)
        return (
          <>
            <g style={{ animation: `owl-pupil ${blinkDur}s infinite` }}>{pupils(tier.pupil)}</g>
            <path
              d={tier.lid.d}
              stroke={color}
              strokeWidth={tier.lid.w}
              strokeLinecap="round"
              style={{ animation: `owl-lid ${blinkDur}s infinite`, opacity: 0 }}
            />
          </>
        )
      case 'blink':
        return <path d={tier.lid.d} stroke={color} strokeWidth={tier.lid.w} strokeLinecap="round" />
      case 'asleep':
        return (
          <path
            d={tier.sleep.d}
            stroke={color}
            strokeWidth={tier.sleep.w}
            strokeLinecap="round"
            fill="none"
          />
        )
      case 'scan':
        if (!live) return pupils(tier.scan)
        return (
          <g style={{ animation: 'owl-scan 3.6s ease-in-out infinite' }}>{pupils(tier.scan)}</g>
        )
      case 'listen':
        return pupils(tier.listen)
    }
  }

  return (
    <svg
      className="owl-glyph"
      width={size}
      height={(size * 18) / 20}
      viewBox="0 0 20 18"
      fill="none"
      aria-hidden="true"
    >
      <path d={HEAD} stroke={color} strokeWidth={tier.stroke} strokeLinejoin="round" />
      {eyes()}
      <path d={BEAK} stroke={color} strokeWidth={tier.beak} />
    </svg>
  )
}
