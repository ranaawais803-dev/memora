import { useRef, useState } from 'react'

/**
 * Records a voice note (MediaRecorder) and transcribes it live in the browser
 * with the free Web Speech API (Chrome / Edge / Safari). No API key needed.
 * If the browser has no speech recognition, the note is still sent, just without a transcript.
 */
export function useVoice() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [live, setLive] = useState('')
  const rec = useRef<MediaRecorder | null>(null)
  const speech = useRef<any>(null)
  const chunks = useRef<Blob[]>([])
  const text = useRef('')
  const timer = useRef<number>(0)

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks.current = []
    text.current = ''
    setLive('')
    const r = new MediaRecorder(stream)
    r.ondataavailable = (e) => chunks.current.push(e.data)
    r.start()
    rec.current = r

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (SR) {
      const s = new SR()
      s.continuous = true
      s.interimResults = true
      s.lang = navigator.language || 'en-US'
      s.onresult = (e: any) => {
        let final = '', interim = ''
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript
          if (e.results[i].isFinal) final += t + ' '
          else interim += t
        }
        text.current = final.trim()
        setLive((final + interim).trim())
      }
      s.onerror = () => {}
      s.start()
      speech.current = s
    }
    setSeconds(0)
    timer.current = window.setInterval(() => setSeconds((x) => x + 1), 1000)
    setRecording(true)
  }

  const stop = () =>
    new Promise<{ blob: Blob; transcript: string } | null>((resolve) => {
      const r = rec.current
      clearInterval(timer.current)
      setRecording(false)
      speech.current?.stop()
      if (!r) return resolve(null)
      r.onstop = () => {
        r.stream.getTracks().forEach((t) => t.stop())
        // give speech recognition a moment to deliver its last final result
        setTimeout(() => resolve({ blob: new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }), transcript: text.current || live }), 400)
      }
      r.stop()
    })

  const cancel = async () => {
    await stop()
    setLive('')
  }

  return { recording, seconds, live, start, stop, cancel }
}
