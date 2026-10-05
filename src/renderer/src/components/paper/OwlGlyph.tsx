import { useState } from 'react'

// Die Eule als Inline-SVG — eine Komponente, fünf Posen (Design-Handoff
// Turn 4a). Kopf-Outline und Schnabel sind in allen Posen identisch, nur
// die Augen wechseln. Strichstärken und Augen-Geometrie kommen als Lookup
// aus den Specimens, nicht aus einer Formel.

export type OwlPose = 'awake' | 'blink' | 'asleep' | 'scan' | 'listen'

export interface OwlGlyphProps {
  pose: OwlPose
  /** Breite in px; Höhe = size * 18/20. */
  size?: number
  /** Nur awake (Blinzeln) und scan (Augenlauf) bewegen sich. */
  live?: boolean
  color?: string
  /** Einzige Ausnahme vom Ein-Farben-Gebot: linkes Auge in Akzent (OwlView-Empty). */
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

// Werte je Größenstufe aus den Turn-4-Specimens (64/44/30/17 px).
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

/** Exportiert für den Render-Test — bewusst Lookup statt Rechnung (4a „SCALES"). */
// eslint-disable-next-line react-refresh/only-export-components -- Reine Funktion, vom Render-Test importiert; Fast Refresh der Komponente bleibt unberührt
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
  // Blinzeldauer einmal pro Mount würfeln — nie zwei Eulen synchron
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
