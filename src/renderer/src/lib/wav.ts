// Recording blob (webm/opus from MediaRecorder) → mono 16 kHz PCM16 WAV.
// Chromium decodes webm natively via decodeAudioData; the audio input in
// Chat Completions format needs WAV (it does not accept webm).

/** WAV + peak level — the level exposes silent recordings before the API call. */
export async function blobToWav(blob: Blob): Promise<{ base64: string; peak: number }> {
  const arrayBuffer = await blob.arrayBuffer()
  const decodeCtx = new AudioContext()
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer)
  await decodeCtx.close()

  const targetRate = 16_000
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  const samples = rendered.getChannelData(0)

  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, targetRate, true)
  view.setUint32(28, targetRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  // Base64 in chunks (String.fromCharCode limit)
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  let peak = 0
  for (let i = 0; i < samples.length; i += 20) {
    const value = Math.abs(samples[i])
    if (value > peak) peak = value
  }
  return { base64: btoa(binary), peak }
}

export async function blobToWavBase64(blob: Blob): Promise<string> {
  return (await blobToWav(blob)).base64
}
