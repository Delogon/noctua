import type { ReactNode } from 'react'
import type { SignatureConfig } from '@shared/signature'
import { fitSignatureImage, signatureImageBackground } from '@shared/signature'

interface SignatureContentProps {
  config: SignatureConfig
  onImageClick?: () => void
  onImageDrop?: (file: File | undefined) => void
  imageInput?: ReactNode
}

function textStyleFor(key: string): React.CSSProperties {
  if (key === 'name') return { font: '600 14px var(--serif)', color: 'var(--ink)' }
  if (key === 'title') {
    return { font: '400 12px var(--serif)', fontStyle: 'italic', color: 'var(--secondary)' }
  }
  if (key === 'studio') {
    return { font: '500 9.5px var(--mono)', letterSpacing: 1, color: 'var(--ink)', marginTop: 3 }
  }
  if (key === 'claim') {
    return {
      font: '400 12.5px var(--serif)',
      fontStyle: 'italic',
      color: 'var(--secondary)',
      marginTop: 3
    }
  }
  return { font: '400 10px var(--mono)', color: 'var(--muted)', marginTop: 3 }
}

export function SignatureContent({
  config,
  onImageClick,
  onImageDrop,
  imageInput
}: SignatureContentProps): React.JSX.Element {
  const imageBorder = config.imgBorder !== false
  const imageLayout = fitSignatureImage(
    config.imgWidth,
    config.imgHeight,
    config.imgShape,
    config.imgPadding
  )

  return (
    <div
      className="flex"
      style={{
        gap: 14,
        alignItems: 'flex-start',
        flexDirection: config.imgPos === 'left' ? 'row' : 'column'
      }}
    >
      {config.img && (
        <div
          onClick={onImageClick}
          onDragOver={onImageDrop ? (event) => event.preventDefault() : undefined}
          onDrop={
            onImageDrop
              ? (event) => {
                  event.preventDefault()
                  onImageDrop(event.dataTransfer.files[0])
                }
              : undefined
          }
          className={`signature-image flex flex-none items-center justify-center${onImageClick ? ' cursor-pointer' : ''}`}
          data-shape={config.imgShape}
          style={{
            width: imageLayout.width,
            height: imageLayout.height,
            padding: imageLayout.padding,
            boxSizing: 'border-box',
            border: config.imgData
              ? imageBorder
                ? '1px solid var(--ink)'
                : 'none'
              : '1px dashed var(--hairline)',
            overflow: 'hidden',
            background: config.imgData
              ? signatureImageBackground(config.imgBackground)
              : 'var(--card-tint)',
            order: config.imgPos === 'bottom' ? 2 : 0
          }}
        >
          {config.imgData ? (
            <img
              src={config.imgData}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: imageLayout.objectFit }}
            />
          ) : (
            <span style={{ font: '400 8.5px var(--mono)', color: 'var(--faint)' }}>Bild</span>
          )}
          {imageInput}
        </div>
      )}
      <div className="min-w-0" style={{ order: 1 }}>
        {config.blocks.map((key, index) =>
          key === 'rule' ? (
            <div
              key={`${key}-${index}`}
              style={{
                width: 220,
                maxWidth: '100%',
                borderTop: '1px solid var(--ink)',
                margin: '7px 0'
              }}
            />
          ) : (
            <div key={key} style={textStyleFor(key)}>
              {config.values[key]?.trim() || '···'}
            </div>
          )
        )}
      </div>
    </div>
  )
}
