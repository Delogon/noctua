import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@renderer/lib/ipc'
import { t } from '@renderer/lib/i18n'
import { useListeningAudio } from '@renderer/features/paper/useListeningAudio'

export type DictationState = 'idle' | 'listening' | 'transcribing'

/**
 * Dictation for input fields (search, asking the owl): recording via the
 * shared microphone stream, transcription via ai:transcribe, finished
 * text via callback. The composer has its own, more intertwined flow
 * (draft preservation, retry) — this hook is the lightweight variant for fields.
 */
export function useDictation(options: {
  onText: (text: string) => void
  onError?: (message: string) => void
}): {
  state: DictationState
  seconds: number
  bars: number[]
  start: () => void
  finish: () => void
  cancel: () => void
} {
  const [state, setState] = useState<DictationState>('idle')
  const [seconds, setSeconds] = useState(0)
  const operationRef = useRef(0)
  const { bars, takeRecording } = useListeningAudio(state === 'listening')
  const optionsRef = useRef(options)
  // Update the ref only after the commit (don't write during render)
  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    if (state !== 'listening') return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 250)
    return () => clearInterval(timer)
  }, [state])

  const start = useCallback((): void => {
    operationRef.current += 1
    setSeconds(0)
    setState('listening')
  }, [])

  const cancel = useCallback((): void => {
    operationRef.current += 1
    // Discard the recording; the stream closes via the hook effect
    void takeRecording()
    setState('idle')
  }, [takeRecording])

  const finish = useCallback((): void => {
    const operation = ++operationRef.current
    setState('transcribing')
    void (async () => {
      const blob = await takeRecording()
      if (operationRef.current !== operation) return
      if (!blob) {
        setState('idle')
        optionsRef.current.onError?.(t('voiceNothingHeard'))
        return
      }
      const { blobToWav } = await import('@renderer/lib/wav')
      const { base64, peak } = await blobToWav(blob)
      // Don't even transcribe a silent recording (e.g. muted track)
      // — the model would otherwise answer at a loss.
      if (peak < 0.01) {
        if (operationRef.current !== operation) return
        setState('idle')
        optionsRef.current.onError?.(t('voiceNothingHeard'))
        return
      }
      const result = await invoke('ai:transcribe', { audioBase64: base64, format: 'wav' })
      if (operationRef.current !== operation) return
      setState('idle')
      const text = result.text.trim()
      if (text) optionsRef.current.onText(text)
      else optionsRef.current.onError?.(t('voiceNothingHeard'))
    })().catch((error: unknown) => {
      if (operationRef.current !== operation) return
      setState('idle')
      optionsRef.current.onError?.(error instanceof Error ? error.message : String(error))
    })
  }, [takeRecording])

  return { state, seconds, bars, start, finish, cancel }
}
