/**
 * Lage der macOS-Ampel je Layout. Die Knöpfe sind 12 px hoch; ihre Oberkante
 * liegt so, dass sie mittig zur jeweiligen Kopfzeile sitzen:
 * - Letterpress: Wortmarke der Masthead von 18–42 px (Mitte 30) → y 24
 * - Classic: Titelleiste 48 px hoch (Mitte 24) → y 18
 */
export function trafficLightPosition(layout: 'letterpress' | 'classic'): { x: number; y: number } {
  return { x: 16, y: layout === 'classic' ? 18 : 24 }
}
