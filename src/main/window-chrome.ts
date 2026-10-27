/**
 * Position of the macOS traffic lights per layout. The buttons are 12 px tall;
 * their top edge is placed so they sit centered on the respective header:
 * - Letterpress: masthead wordmark from 18–42 px (center 30) → y 24
 * - Classic: title bar 48 px tall (center 24) → y 18
 */
export function trafficLightPosition(layout: 'letterpress' | 'classic'): { x: number; y: number } {
  return { x: 16, y: layout === 'classic' ? 18 : 24 }
}
