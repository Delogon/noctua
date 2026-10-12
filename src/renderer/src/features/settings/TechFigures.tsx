/**
 * Graphic building blocks of the tech page (letterpress vocabulary in SVG):
 * 1px ink lines, hairline grid, accent squares, outline chips —
 * no gradients, no rounded corners, colors only via CSS variables.
 *
 * Convention: solid = runs on the device, dashed = cloud call
 * via OpenRouter (the legend at the top of the page explains exactly that).
 */

import { chipWidth } from '@renderer/features/settings/tech-metrics'

export const INK = 'var(--ink)'
export const AC = 'var(--ac)'
export const SHEET = 'var(--sheet)'
export const HAIR = 'var(--hairline)'
export const MUTED = 'var(--muted)'
export const FAINT = 'var(--faint)'
export const SECONDARY = 'var(--secondary)'

/** Dash pattern for cloud edges — the same everywhere so the legend holds. */
export const DASH = '5 3'

/** Mono label in graphics — 8.5–10px, letter-spaced, caps come from the caller. */
export function L({
  x,
  y,
  children,
  size = 9,
  color = INK,
  anchor = 'start',
  ls = 1,
  w = 500
}: {
  x: number
  y: number
  children: string
  size?: number
  color?: string
  anchor?: 'start' | 'middle' | 'end'
  ls?: number
  w?: number
}): React.JSX.Element {
  return (
    <text
      x={x}
      y={y}
      fill={color}
      textAnchor={anchor}
      fontFamily="var(--mono)"
      fontSize={size}
      fontWeight={w}
      letterSpacing={ls}
    >
      {children}
    </text>
  )
}

/** Serif line in graphics — for quotes/sample text, italic. */
export function S({
  x,
  y,
  children,
  size = 11.5,
  color = SECONDARY,
  anchor = 'start'
}: {
  x: number
  y: number
  children: string
  size?: number
  color?: string
  anchor?: 'start' | 'middle' | 'end'
}): React.JSX.Element {
  return (
    <text
      x={x}
      y={y}
      fill={color}
      textAnchor={anchor}
      fontFamily="var(--serif)"
      fontSize={size}
      fontStyle="italic"
    >
      {children}
    </text>
  )
}

/** 1px rectangle — base shape of almost all building blocks. */
export function Box({
  x,
  y,
  w,
  h,
  dashed = false,
  stroke = INK,
  fill = SHEET
}: {
  x: number
  y: number
  w: number
  h: number
  dashed?: boolean
  stroke?: string
  fill?: string
}): React.JSX.Element {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      fill={fill}
      stroke={stroke}
      strokeWidth={1}
      strokeDasharray={dashed ? DASH : undefined}
    />
  )
}

/** Small square as a marker — filled (accent/ink) or outline only. */
export function Sq({
  x,
  y,
  s = 6,
  fill = AC,
  stroke
}: {
  x: number
  y: number
  s?: number
  fill?: string
  stroke?: string
}): React.JSX.Element {
  return <rect x={x} y={y} width={s} height={s} fill={fill} stroke={stroke} strokeWidth={1} />
}

/** Envelope: rectangle plus a fold made of two lines. */
export function Envelope({
  x,
  y,
  w = 34,
  h = 23,
  stroke = INK,
  fill = SHEET
}: {
  x: number
  y: number
  w?: number
  h?: number
  stroke?: string
  fill?: string
}): React.JSX.Element {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={1} />
      <path
        d={`M ${x} ${y} L ${x + w / 2} ${y + h * 0.55} L ${x + w} ${y}`}
        fill="none"
        stroke={stroke}
        strokeWidth={1}
      />
    </g>
  )
}

/**
 * Model block: dashed rectangle with ✦ — every ✦ box is a cloud call via
 * OpenRouter; the second line names the default model.
 */
export function ModelBox({
  x,
  y,
  w = 118,
  h = 46,
  name,
  note = 'OPENROUTER'
}: {
  x: number
  y: number
  w?: number
  h?: number
  name: string
  note?: string
}): React.JSX.Element {
  const cx = x + w / 2
  return (
    <g>
      <Box x={x} y={y} w={w} h={h} dashed />
      <text x={cx} y={y + 17} fill={AC} textAnchor="middle" fontSize={12}>
        ✦
      </text>
      <L x={cx} y={y + 30} anchor="middle" size={8.5} ls={0.8}>
        {name}
      </L>
      <L x={cx} y={y + 40} anchor="middle" size={7.5} ls={1} color={MUTED} w={400}>
        {note}
      </L>
    </g>
  )
}

/** Outline chip — centered on (x,y), width from the text. */
export function Chip({
  cx,
  cy,
  text,
  tone = 'ink',
  size = 8.5
}: {
  cx: number
  cy: number
  text: string
  /** ink = outline, fill = filled (ink), ac = accent outline, faint = hairline */
  tone?: 'ink' | 'fill' | 'ac' | 'faint'
  size?: number
}): React.JSX.Element {
  const w = chipWidth(text, size)
  const h = 16
  const stroke = tone === 'ac' ? AC : tone === 'faint' ? HAIR : INK
  const fill = tone === 'fill' ? INK : SHEET
  const color = tone === 'fill' ? SHEET : tone === 'ac' ? AC : tone === 'faint' ? MUTED : INK
  return (
    <g>
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
      />
      <L x={cx} y={cy + 3.2} anchor="middle" size={size} color={color} ls={0.8}>
        {text}
      </L>
    </g>
  )
}

/** Arrow from (x1,y1) to (x2,y2) — dashed for cloud routes. */
export function Arrow({
  x1,
  y1,
  x2,
  y2,
  dashed = false,
  stroke = INK
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  dashed?: boolean
  stroke?: string
}): React.JSX.Element {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = 5
  const tipX = x2
  const tipY = y2
  const leftX = tipX - size * Math.cos(angle - Math.PI / 7)
  const leftY = tipY - size * Math.sin(angle - Math.PI / 7)
  const rightX = tipX - size * Math.cos(angle + Math.PI / 7)
  const rightY = tipY - size * Math.sin(angle + Math.PI / 7)
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2 - 3 * Math.cos(angle)}
        y2={y2 - 3 * Math.sin(angle)}
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray={dashed ? DASH : undefined}
      />
      <polygon points={`${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`} fill={stroke} />
    </g>
  )
}

/** Small ✕ — for filtered-out and blocked items. */
export function Cross({
  x,
  y,
  s = 4,
  stroke = MUTED
}: {
  x: number
  y: number
  s?: number
  stroke?: string
}): React.JSX.Element {
  return (
    <g stroke={stroke} strokeWidth={1.2}>
      <line x1={x - s} y1={y - s} x2={x + s} y2={y + s} />
      <line x1={x - s} y1={y + s} x2={x + s} y2={y - s} />
    </g>
  )
}
