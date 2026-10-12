import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One shared microphone stream for level meter and recording. If access is
 * still pending or denied, the waveform stays decoratively active; typed
 * dictation keeps working in that case.
 */
export function useListeningAudio(active: boolean): {
  bars: number[]
  takeRecording: () => Promise<Blob | null>
} {
  const [bars, setBars] = useState<number[]>(() => Array(14).fill(4))
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    if (!active) return

    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let fallback: ReturnType<typeof setInterval> | null = null
    let stopped = false

    const startFallback = (): void => {
      if (stopped || fallback) return
      fallback = setInterval(() => {
        const seed = Math.random()
        setBars(
          Array.from(
            { length: 14 },
            (_, index) => 4 + Math.abs(Math.sin(seed * 37 + index * 1.7)) * 16
          )
        )
      }, 110)
    }

    // The macOS permission window may stay open for a while. Until then
    // the animation already signals that Noctua is listening.
    const pending = setTimeout(startFallback, 1200)

    void navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((nextStream) => {
        clearTimeout(pending)
        if (fallback) {
          clearInterval(fallback)
          fallback = null
        }
        if (stopped) {
          nextStream.getTracks().forEach((track) => track.stop())
          return
        }

        stream = nextStream
        const startRecorder = (): void => {
          if (stopped) return
          try {
            const recorder = new MediaRecorder(nextStream, { mimeType: 'audio/webm;codecs=opus' })
            chunksRef.current = []
            recorder.ondataavailable = (event) => {
              if (event.data.size > 0) chunksRef.current.push(event.data)
            }
            recorder.start(500)
            recorderRef.current = recorder
          } catch {
            recorderRef.current = null
          }
        }
        // When the microphone is reused quickly (second dictation shortly
        // after the first), macOS initially delivers the track muted —
        // a recorder started immediately would record only silence.
        const track = nextStream.getAudioTracks()[0]
        if (track?.muted) track.addEventListener('unmute', startRecorder, { once: true })
        else startRecorder()

        ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(nextStream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 64
        source.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = (): void => {
          analyser.getByteFrequencyData(data)
          setBars(
            Array.from({ length: 14 }, (_, index) => {
              const value = data[Math.floor((index / 14) * data.length)] / 255
              return 4 + Math.round(value * 16)
            })
          )
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => {
        clearTimeout(pending)
        startFallback()
      })

    return () => {
      stopped = true
      clearTimeout(pending)
      cancelAnimationFrame(raf)
      if (fallback) clearInterval(fallback)
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      recorderRef.current = null
      stream?.getTracks().forEach((track) => track.stop())
      void ctx?.close()
    }
  }, [active])

  const takeRecording = useCallback(async (): Promise<Blob | null> => {
    const recorder = recorderRef.current
    if (!recorder) return null
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
    }
    recorderRef.current = null
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    chunksRef.current = []
    return blob.size > 2000 ? blob : null
  }, [])

  return { bars, takeRecording }
}
