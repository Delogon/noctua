// Measurement helpers of the tech graphics — pure functions, separate from the
// SVG components (react-refresh dislikes mixed exports).

/** Monospace width estimate: IBM Plex Mono ≈ 0.6 em per character. */
export function monoW(text: string, size: number): number {
  return text.length * size * 0.602
}

/** Chip width from the text — also for left-aligned placement of chips. */
export function chipWidth(text: string, size = 8.5): number {
  return monoW(text, size) + text.length * 0.8 + 14
}
