export type SignatureImageShape = 'circle' | 'rounded' | 'rect'

export interface SignatureConfig {
  blocks: string[]
  values: Record<string, string>
  img: boolean
  imgShape: SignatureImageShape
  imgPos: 'left' | 'top' | 'bottom'
  imgData?: string
  imgWidth?: number
  imgHeight?: number
  imgBorder?: boolean
  imgPadding?: number
  /** Hex-Farbe oder null/undefined fuer echte Transparenz. */
  imgBackground?: string | null
}

export interface SignatureImageLayout {
  width: number
  height: number
  padding: number
  objectFit: 'cover' | 'contain'
}

export function parseSignatureConfig(value: string | null | undefined): SignatureConfig | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as SignatureConfig
    if (!Array.isArray(parsed.blocks) || !parsed.values || typeof parsed.values !== 'object') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function signatureImageBackground(value: string | null | undefined): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : 'transparent'
}

export function renderSignatureText(config: Pick<SignatureConfig, 'blocks' | 'values'>): string {
  return config.blocks
    .map((key) => (key === 'rule' ? '—' : (config.values[key] ?? '').trim()))
    .filter(Boolean)
    .join('\n')
}

/** Fügt die Signatur genau einmal mit einem lesbaren Abstand an den Mailtext an. */
export function appendSignatureText(body: string, signature: string): string {
  const content = body.trimEnd()
  const cleanSignature = signature.trim()
  if (!cleanSignature) return content
  if (
    content === cleanSignature ||
    content.endsWith(`\n${cleanSignature}`) ||
    content.endsWith(`\n\n${cleanSignature}`)
  ) {
    return content
  }
  return content ? `${content}\n\n${cleanSignature}` : cleanSignature
}

function normalizeSignatureLine(line: string): string {
  return line
    .normalize('NFKC')
    .toLocaleLowerCase('de')
    .replace(/^[\s—–-]+/, '')
    .replace(/[\s,.;:!—–-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isClosingLine(line: string): boolean {
  const normalized = normalizeSignatureLine(line)
  return (
    /^(?:mit freundlichen|viele(?: liebe)?|liebe|beste|herzliche|freundliche|schöne|sonnige) grüße(?: aus .+)?$/.test(
      normalized
    ) || /^(?:kind|best|warm) regards$|^regards$|^sincerely$|^cheers$|^(?:lg|vg)$/.test(normalized)
  )
}

/**
 * Entfernt eine vom Modell erzeugte Grußformel bzw. wiederholte
 * Signaturzeilen am Ende. Der eigentliche Inhalt vor dem Schlussblock bleibt
 * unverändert; die separat konfigurierte Signatur wird beim Versand ergänzt.
 */
export function stripRedundantSignatureTail(body: string, signatureReference = ''): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop()
  if (lines.length === 0) return ''

  const referenceLines = signatureReference
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizeSignatureLine)
    .filter((line) => line.length > 1 && !/^[—–-]+$/.test(line))
  const exactReferences = new Set(referenceLines)
  const compactReferences = new Set(referenceLines.map((line) => line.replace(/\s+/g, '')))
  const firstReference = referenceLines[0]
  if (firstReference?.includes(' ') && !isClosingLine(firstReference)) {
    const firstName = firstReference.split(' ')[0]
    if (firstName.length > 1) {
      exactReferences.add(firstName)
      compactReferences.add(firstName)
    }
  }

  const tailStart = Math.max(0, lines.length - 12)
  let cutAt = lines.findIndex((line, index) => index >= tailStart && isClosingLine(line))
  if (cutAt === -1 && exactReferences.size > 0) {
    cutAt = lines.findIndex((line, index) => {
      if (index < tailStart) return false
      const normalized = normalizeSignatureLine(line)
      if (!normalized) return false
      return (
        exactReferences.has(normalized) || compactReferences.has(normalized.replace(/\s+/g, ''))
      )
    })
  }
  if (cutAt === -1) return lines.join('\n').trimEnd()

  const kept = lines.slice(0, cutAt)
  while (kept.length > 0 && !kept[kept.length - 1].trim()) kept.pop()
  return kept.join('\n').trimEnd()
}

/** Einheitliche Bildmaße für Signatur-Vorschau und tatsächlich versandte HTML-Mail. */
export function fitSignatureImage(
  sourceWidth: number | undefined,
  sourceHeight: number | undefined,
  shape: SignatureImageShape | undefined,
  requestedPadding = 0
): SignatureImageLayout {
  const padding = Number.isFinite(requestedPadding)
    ? Math.max(0, Math.min(16, Math.round(requestedPadding)))
    : 0
  if (shape === 'circle') return { width: 64, height: 64, padding, objectFit: 'cover' }

  const width =
    typeof sourceWidth === 'number' && Number.isFinite(sourceWidth) && sourceWidth > 0
      ? sourceWidth
      : 64
  const height =
    typeof sourceHeight === 'number' && Number.isFinite(sourceHeight) && sourceHeight > 0
      ? sourceHeight
      : 64
  const maxContentWidth = Math.max(1, 180 - padding * 2)
  const maxContentHeight = Math.max(1, 80 - padding * 2)
  const scale = Math.min(1, maxContentWidth / width, maxContentHeight / height)
  return {
    width: Math.max(1, Math.round(width * scale)) + padding * 2,
    height: Math.max(1, Math.round(height * scale)) + padding * 2,
    padding,
    objectFit: 'contain'
  }
}
