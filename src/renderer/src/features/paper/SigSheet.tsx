import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useAccounts } from '@renderer/queries/accounts'
import { usePaper } from '@renderer/stores/paper'
import { useT } from '@renderer/lib/i18n'
import type { StringKey } from '@renderer/i18n/strings'
import { useStyleProfile } from '@renderer/features/paper/useVoiceTag'
import { accountLabels } from '@renderer/lib/accountLabels'
import {
  renderSignatureText,
  signatureImageBackground,
  type SignatureConfig
} from '@shared/signature'
import { SignatureContent } from '@renderer/components/SignatureContent'

// Signatur-Baukasten (Design-Import M31): Bausteine klicken, anordnen,
// Bild per Drag&Drop — eine Signatur pro Adresse, Vorschau live.

export type SigConfig = SignatureConfig

const BLOCK_KEYS = [
  'name',
  'title',
  'studio',
  'phone',
  'website',
  'address',
  'claim',
  'rule'
] as const

// Kuratierte Bildhintergründe (Design 3f): TRANSPARENT · PAPIER · PASTELLE ·
// TINTE ersetzen den OS-Farbwähler. Bereits gespeicherte Fremdfarben bleiben
// gültig und erscheinen als zusätzlicher, ausgewählter Swatch.
const BACKGROUND_SWATCHES: ReadonlyArray<{
  value: string | null
  labelKey: 'sigImgBackgroundTransparent' | 'sigSwatchPaper' | 'sigSwatchPastel' | 'sigSwatchInk'
}> = [
  { value: null, labelKey: 'sigImgBackgroundTransparent' },
  { value: '#F4F1EA', labelKey: 'sigSwatchPaper' },
  { value: '#c3b8e0', labelKey: 'sigSwatchPastel' },
  { value: '#f0d9a8', labelKey: 'sigSwatchPastel' },
  { value: '#b9d6c3', labelKey: 'sigSwatchPastel' },
  { value: '#17150F', labelKey: 'sigSwatchInk' }
]

function swatchStyle(selected: boolean, value: string | null): React.CSSProperties {
  return {
    width: 16,
    height: 16,
    boxSizing: 'border-box',
    padding: 0,
    flex: 'none',
    cursor: 'pointer',
    border: selected ? '2px solid var(--ink)' : '1px solid var(--hairline)',
    background:
      value ??
      'linear-gradient(135deg, var(--sheet) 45%, var(--hairline) 45%, var(--hairline) 55%, var(--sheet) 55%)'
  }
}

function defaultConfig(email: string, displayName: string | null): SigConfig {
  return {
    blocks: ['name'],
    values: { name: displayName || email.split('@')[0] },
    img: false,
    imgShape: 'circle',
    imgPos: 'left',
    imgBorder: true,
    imgPadding: 0,
    imgBackground: null
  }
}

async function fileToSignatureImage(file: File): Promise<{
  dataUri: string
  width: number
  height: number
}> {
  const buf = await file.arrayBuffer()
  const blob = new Blob([buf], { type: file.type })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  let scale = Math.min(1, 512 / bitmap.width, 512 / bitmap.height)
  let dataUri = ''
  let width = 1
  let height = 1

  // settings:set ist bewusst begrenzt; große Fotos werden proportional
  // verkleinert, ohne Logos durch JPEG-Kompression oder Crop zu beschädigen.
  for (;;) {
    width = Math.max(1, Math.round(bitmap.width * scale))
    height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.width = width
    canvas.height = height
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    dataUri = canvas.toDataURL('image/png')
    if (dataUri.length <= 85_000 || Math.max(width, height) <= 64) break
    scale *= Math.max(0.5, Math.sqrt(85_000 / dataUri.length) * 0.92)
  }

  bitmap.close()
  return { dataUri, width, height }
}

export function SigSheet(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const accounts = useAccounts()
  const { toastNow } = usePaper()
  const accs = accounts.data ?? []
  const labels = accountLabels(accs)
  const [addrId, setAddrId] = useState<number | null>(null)
  const account = accs.find((a) => a.id === addrId) ?? accs[0]
  const accountId = account?.id
  const profile = useStyleProfile(account?.id ?? null)
  const [cfg, setCfg] = useState<SigConfig | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Beim Wechsel der Adresse die alte Konfiguration verwerfen (Render-Anpassung)
  const [cfgAccountId, setCfgAccountId] = useState(account?.id)
  if (cfgAccountId !== account?.id) {
    setCfgAccountId(account?.id)
    setCfg(null)
  }

  // Konfiguration der gewählten Adresse laden
  useEffect(() => {
    if (!account) return
    void invoke('settings:get', { key: `sig.${account.id}` }).then((r) => {
      if (r.value) {
        try {
          setCfg(JSON.parse(r.value) as SigConfig)
          return
        } catch {
          // fällt auf Default zurück
        }
      }
      const base = defaultConfig(account.email, account.displayName)
      // Bestehende Plaintext-Signatur als Startwert übernehmen
      if (account.signature?.trim() && base.blocks.length === 1) {
        base.values.claim = account.signature.trim().split('\n').slice(-1)[0]
      }
      setCfg(base)
    })
    // Bewusst nur an die Konto-ID gebunden: ein neues Konto-Objekt nach jedem
    // Refetch darf die Konfiguration nicht neu laden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id])

  // Nur in Event-Handlern genutzt — der React Compiler memoisiert selbst
  const persist = (next: SigConfig): void => {
    if (accountId === undefined) return
    setCfg(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const serialized = JSON.stringify(next)
    queryClient.setQueryData(['signature', accountId], { value: serialized })
    // Die vollständige Konfiguration sofort sichern: Der Composer kann direkt
    // danach geöffnet oder eine Mail versendet werden. Nur die abgeleitete
    // Plaintext-Signatur und die Kontenabfrage werden gebündelt aktualisiert.
    void invoke('settings:set', { key: `sig.${accountId}`, value: serialized })
    saveTimer.current = setTimeout(() => {
      void invoke('accounts:update', {
        accountId: accountId,
        signature: renderSignatureText(next) || null
      }).then(() => void queryClient.invalidateQueries({ queryKey: ['accounts'] }))
    }, 400)
  }

  if (!account || !cfg) {
    return <div className="sheet-card flex min-w-0 flex-1" style={{ padding: '24px 28px' }} />
  }

  const blockLabel = (k: string): string => t(`sigBlock_${k}` as StringKey)

  const toggle = (k: string): void => {
    if (k === 'img') {
      persist({ ...cfg, img: !cfg.img })
      return
    }
    const blocks = cfg.blocks.includes(k) ? cfg.blocks.filter((b) => b !== k) : [...cfg.blocks, k]
    persist({ ...cfg, blocks })
  }
  const move = (k: string, dir: -1 | 1): void => {
    const b = [...cfg.blocks]
    const i = b.indexOf(k)
    const j = i + dir
    if (i < 0 || j < 0 || j >= b.length) return
    b[i] = b[j]
    b[j] = k
    persist({ ...cfg, blocks: b })
  }
  const setValue = (k: string, v: string): void =>
    persist({ ...cfg, values: { ...cfg.values, [k]: v } })

  const onDropImage = (file: File | undefined): void => {
    if (!file || !file.type.startsWith('image/')) return
    void fileToSignatureImage(file)
      .then(({ dataUri, width, height }) =>
        persist({ ...cfg, img: true, imgData: dataUri, imgWidth: width, imgHeight: height })
      )
      .catch(() => toastNow(t('sigImgReadError')))
  }

  const chip = (active: boolean): React.CSSProperties => ({
    cursor: 'pointer',
    font: '500 9px var(--mono)',
    letterSpacing: '.5px',
    padding: '5px 10px',
    ...(active
      ? { color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)' }
      : { color: 'var(--muted)', border: '1px solid var(--hairline)', background: 'var(--sheet)' })
  })

  const greeting = profile?.closings?.[0] || t('sigGreetingFallback')
  const imageBorder = cfg.imgBorder !== false
  const imagePadding = cfg.imgPadding ?? 0
  const imageBackground = signatureImageBackground(cfg.imgBackground)
  const hasImageBackground = imageBackground !== 'transparent'
  // Vor dem Swatch-Umbau gespeicherte Farbe außerhalb der kuratierten Reihe
  const customBackground =
    hasImageBackground &&
    !BACKGROUND_SWATCHES.some(
      (swatch) => swatch.value?.toLowerCase() === imageBackground.toLowerCase()
    )
      ? imageBackground
      : null

  return (
    <div className="sheet-card min-w-0 flex-1 overflow-y-auto" style={{ padding: '24px 28px' }}>
      <div style={{ font: '500 21px var(--serif)' }}>{t('sigHead')}</div>
      <div className="mmeta" style={{ marginTop: 5, letterSpacing: '.5px' }}>
        {t('sigSub')}
      </div>

      <div className="flex flex-wrap gap-1.5" style={{ marginTop: 14 }}>
        {accs.map((a) => (
          <span key={a.id} onClick={() => setAddrId(a.id)} style={chip(a.id === account.id)}>
            {labels.get(a.id)}
          </span>
        ))}
      </div>

      <div
        className="ink-card"
        style={{ padding: 14, marginTop: 14, maxWidth: 640, boxSizing: 'border-box' }}
      >
        <div className="flex items-baseline gap-2">
          <span className="mlabel" style={{ color: 'var(--ac)' }}>
            {t('sigBlocks')}
          </span>
          <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
            {t('sigBlocksHint')}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5" style={{ marginTop: 10 }}>
          {[...BLOCK_KEYS, 'img'].map((k) => {
            const active = k === 'img' ? cfg.img : cfg.blocks.includes(k)
            return (
              <span key={k} onClick={() => toggle(k)} style={chip(active)}>
                {active ? '✓' : '+'} {blockLabel(k)}
              </span>
            )
          })}
        </div>
        {cfg.img && (
          <div className="flex flex-wrap items-baseline gap-2" style={{ marginTop: 12 }}>
            <span className="mlabel" style={{ color: 'var(--muted)' }}>
              {t('sigShape')}
            </span>
            {(
              [
                ['circle', t('sigShapeCircle')],
                ['rounded', t('sigShapeRounded')],
                ['rect', t('sigShapeRect')]
              ] as Array<[SigConfig['imgShape'], string]>
            ).map(([k, label]) => (
              <span
                key={k}
                onClick={() => persist({ ...cfg, imgShape: k })}
                style={chip(cfg.imgShape === k)}
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {(cfg.blocks.length > 0 || cfg.img) && (
        <div
          className="ink-card"
          style={{ padding: 14, marginTop: 12, maxWidth: 640, boxSizing: 'border-box' }}
        >
          <div className="flex items-baseline gap-2">
            <span className="mlabel" style={{ color: 'var(--ac)' }}>
              {t('sigOrder')}
            </span>
            <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
              {t('sigOrderHint')}
            </span>
          </div>
          <div className="flex flex-col gap-[5px]" style={{ marginTop: 10 }}>
            {cfg.img && (
              <div
                className="flex flex-wrap items-center gap-2"
                style={{
                  border: '1px solid var(--hairline)',
                  background: 'var(--sheet)',
                  padding: '6px 9px'
                }}
              >
                <span
                  className="flex-none"
                  style={{
                    font: '500 8.5px var(--mono)',
                    letterSpacing: 1,
                    color: 'var(--ink)',
                    width: 82
                  }}
                >
                  {blockLabel('img')}
                </span>
                {(
                  [
                    ['left', `↤ ${t('sigPosLeft')}`],
                    ['top', `↑ ${t('sigPosTop')}`],
                    ['bottom', `↓ ${t('sigPosBottom')}`]
                  ] as Array<[SigConfig['imgPos'], string]>
                ).map(([k, label]) => (
                  <span
                    key={k}
                    onClick={() => persist({ ...cfg, imgPos: k })}
                    style={chip(cfg.imgPos === k)}
                  >
                    {label}
                  </span>
                ))}
                <span
                  onClick={() => persist({ ...cfg, imgBorder: !imageBorder })}
                  style={chip(imageBorder)}
                >
                  {imageBorder ? '✓' : '+'} {t('sigImgBorder')}
                </span>
                <span
                  onClick={() => persist({ ...cfg, imgPadding: Math.max(0, imagePadding - 4) })}
                  className="cursor-pointer"
                  style={{
                    font: '600 11px var(--mono)',
                    border: '1px solid var(--hairline)',
                    padding: '4px 7px',
                    color: imagePadding === 0 ? 'var(--hairline)' : 'var(--ink)'
                  }}
                >
                  −
                </span>
                <span
                  style={{
                    font: '500 8.5px var(--mono)',
                    color: 'var(--muted)',
                    minWidth: 72,
                    textAlign: 'center'
                  }}
                >
                  {t('sigImgPadding')} {imagePadding}px
                </span>
                <span
                  onClick={() => persist({ ...cfg, imgPadding: Math.min(16, imagePadding + 4) })}
                  className="cursor-pointer"
                  style={{
                    font: '600 11px var(--mono)',
                    border: '1px solid var(--hairline)',
                    padding: '4px 7px',
                    color: imagePadding === 16 ? 'var(--hairline)' : 'var(--ink)'
                  }}
                >
                  +
                </span>
                <span
                  onClick={() => toggle('img')}
                  className="ml-auto cursor-pointer"
                  style={{
                    font: '500 10px var(--mono)',
                    color: 'var(--faint)',
                    border: '1px solid var(--hairline)',
                    padding: '2px 7px'
                  }}
                >
                  ×
                </span>
                <div
                  className="flex basis-full flex-wrap items-center gap-2"
                  style={{
                    borderTop: '1px solid var(--hairline-light)',
                    paddingTop: 7,
                    marginTop: 2
                  }}
                >
                  <span className="mlabel" style={{ color: 'var(--muted)', marginRight: 2 }}>
                    {t('sigImgBackground')}
                  </span>
                  {BACKGROUND_SWATCHES.map((swatch) => {
                    const selected =
                      swatch.value === null
                        ? !hasImageBackground
                        : hasImageBackground &&
                          imageBackground.toLowerCase() === swatch.value.toLowerCase()
                    const label =
                      swatch.value === null
                        ? t(swatch.labelKey)
                        : t(swatch.labelKey, { hex: swatch.value.toUpperCase() })
                    return (
                      <button
                        key={swatch.value ?? 'transparent'}
                        type="button"
                        onClick={() => persist({ ...cfg, imgBackground: swatch.value })}
                        aria-pressed={selected}
                        aria-label={label}
                        title={label}
                        style={swatchStyle(selected, swatch.value)}
                      />
                    )
                  })}
                  {customBackground && (
                    <button
                      type="button"
                      onClick={() => persist({ ...cfg, imgBackground: customBackground })}
                      aria-pressed
                      aria-label={t('sigSwatchCustom', { hex: customBackground.toUpperCase() })}
                      title={t('sigSwatchCustom', { hex: customBackground.toUpperCase() })}
                      style={swatchStyle(true, customBackground)}
                    />
                  )}
                </div>
              </div>
            )}
            {cfg.blocks.map((k, i) => (
              <div
                key={k}
                className="flex items-center gap-2"
                style={{
                  border: '1px solid var(--hairline)',
                  background: 'var(--sheet)',
                  padding: '6px 9px'
                }}
              >
                <span
                  className="flex-none"
                  style={{
                    font: '500 8.5px var(--mono)',
                    letterSpacing: 1,
                    color: 'var(--ink)',
                    width: 82
                  }}
                >
                  {blockLabel(k)}
                </span>
                {k === 'rule' ? (
                  <span
                    className="flex-1"
                    style={{
                      font: '400 12px var(--serif)',
                      fontStyle: 'italic',
                      color: 'var(--secondary)'
                    }}
                  >
                    ———
                  </span>
                ) : (
                  <input
                    value={cfg.values[k] ?? ''}
                    onChange={(e) => setValue(k, e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="···"
                    className="min-w-0 flex-1"
                    style={{
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      font: '400 12px var(--serif)',
                      fontStyle: 'italic',
                      color: 'var(--secondary)'
                    }}
                  />
                )}
                <span
                  onClick={() => move(k, -1)}
                  className="cursor-pointer"
                  style={{
                    font: '500 10px var(--mono)',
                    border: '1px solid var(--hairline)',
                    padding: '2px 7px',
                    color: i === 0 ? 'var(--hairline)' : 'var(--ink)'
                  }}
                >
                  ↑
                </span>
                <span
                  onClick={() => move(k, 1)}
                  className="cursor-pointer"
                  style={{
                    font: '500 10px var(--mono)',
                    border: '1px solid var(--hairline)',
                    padding: '2px 7px',
                    color: i === cfg.blocks.length - 1 ? 'var(--hairline)' : 'var(--ink)'
                  }}
                >
                  ↓
                </span>
                <span
                  onClick={() => toggle(k)}
                  className="cursor-pointer"
                  style={{
                    font: '500 10px var(--mono)',
                    color: 'var(--faint)',
                    border: '1px solid var(--hairline)',
                    padding: '2px 7px'
                  }}
                >
                  ×
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          border: '1px solid var(--ink)',
          background: 'var(--rail)',
          padding: 14,
          marginTop: 12,
          maxWidth: 640,
          boxSizing: 'border-box'
        }}
      >
        <div className="flex items-baseline gap-2">
          <span className="mlabel" style={{ color: 'var(--ac)' }}>
            {t('sigPreview')}
          </span>
          <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
            {t('sigPreviewSub', { addr: labels.get(account.id) ?? account.email })}
          </span>
        </div>
        <div className="rail-card" style={{ padding: '16px 18px', marginTop: 10 }}>
          <div style={{ font: '400 13px/1.65 var(--serif)', color: 'var(--faint)' }}>
            {t('sigPreviewBody')}
          </div>
          <div
            style={{ font: '400 13px/1.65 var(--serif)', color: 'var(--body-text)', marginTop: 10 }}
          >
            {greeting},
          </div>
          <div style={{ marginTop: 10 }} title={t('sigImgHint')}>
            <SignatureContent
              config={cfg}
              onImageClick={() => fileRef.current?.click()}
              onImageDrop={onDropImage}
              imageInput={
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onDropImage(e.target.files?.[0])}
                />
              }
            />
          </div>
        </div>
        <div style={{ font: '400 9px/1.6 var(--mono)', color: 'var(--faint)', marginTop: 9 }}>
          {t('sigImgFootnote')}
        </div>
      </div>
      <div
        style={{
          font: '400 11.5px/1.6 var(--serif)',
          fontStyle: 'italic',
          color: 'var(--faint)',
          marginTop: 12
        }}
      >
        {t('sigGreetingFootnote')}
      </div>
    </div>
  )
}
