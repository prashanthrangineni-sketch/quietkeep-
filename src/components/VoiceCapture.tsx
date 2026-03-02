'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface VoiceCaptureProps {
  onCapture: (transcript: string, source: 'voice' | 'text') => Promise<void>
  disabled?: boolean
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition
    webkitSpeechRecognition: new () => SpeechRecognition
  }
}

export default function VoiceCapture({ onCapture, disabled = false }: VoiceCaptureProps) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [textInput, setTextInput] = useState('')
  const [mode, setMode] = useState<'voice' | 'text'>('voice')
  const [speechSupported, setSpeechSupported] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const recognitionRef = useRef<SpeechRecognition | null>(null)

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSpeechSupported(false)
      setMode('text')
    }
  }, [])

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.maxAlternatives = 1

    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => {
      setIsListening(false)
      setInterim('')
    }
    recognition.onerror = (event) => {
      setIsListening(false)
      setInterim('')
      if (event.error !== 'no-speech') {
        setError(`Microphone error: ${event.error}`)
      }
    }
    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      if (finalText) setTranscript(prev => (prev + ' ' + finalText).trim())
      setInterim(interimText)
    }

    recognitionRef.current = recognition
    recognition.start()
    setError('')
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const handleSubmitVoice = async () => {
    const finalText = (transcript + ' ' + interim).trim()
    if (!finalText) return
    stopListening()
    setSubmitting(true)
    setError('')
    try {
      await onCapture(finalText, 'voice')
      setTranscript('')
      setInterim('')
    } catch {
      setError('Failed to save intent. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitText = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!textInput.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await onCapture(textInput.trim(), 'text')
      setTextInput('')
    } catch {
      setError('Failed to save intent. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const displayText = (transcript + ' ' + interim).trim()

  return (
    <div
      className="rounded-2xl p-6 space-y-5"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>
          Capture Intent
        </h2>
        {speechSupported && (
          <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--background)' }}>
            {(['voice', 'text'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); stopListening() }}
                className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: mode === m ? 'var(--accent)' : 'transparent',
                  color: mode === m ? '#fff' : 'var(--muted)',
                }}
              >
                {m === 'voice' ? '🎙️ Voice' : '✏️ Text'}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === 'voice' && speechSupported ? (
        <div className="space-y-4">
          {/* Mic button */}
          <div className="flex justify-center">
            <button
              onClick={isListening ? stopListening : startListening}
              disabled={disabled || submitting}
              className="relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 disabled:opacity-40"
              style={{
                background: isListening ? 'var(--accent)' : 'var(--surface-hover)',
                border: `2px solid ${isListening ? 'var(--accent)' : 'var(--border)'}`,
                boxShadow: isListening ? '0 0 24px rgba(124,106,247,0.5)' : 'none',
              }}
            >
              {isListening && (
                <span className="absolute inset-0 rounded-full animate-ping" style={{ background: 'rgba(124,106,247,0.3)' }} />
              )}
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="2" width="6" height="12" rx="3" fill={isListening ? '#fff' : 'var(--muted)'} />
                <path d="M5 10C5 14.418 8.134 18 12 18C15.866 18 19 14.418 19 10" stroke={isListening ? '#fff' : 'var(--muted)'} strokeWidth="2" strokeLinecap="round" />
                <line x1="12" y1="18" x2="12" y2="22" stroke={isListening ? '#fff' : 'var(--muted)'} strokeWidth="2" strokeLinecap="round" />
                <line x1="8" y1="22" x2="16" y2="22" stroke={isListening ? '#fff' : 'var(--muted)'} strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Transcript display */}
          {displayText ? (
            <div
              className="rounded-xl p-4 min-h-16 text-sm leading-relaxed"
              style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            >
              {transcript}
              {interim && <span style={{ color: 'var(--muted)' }}> {interim}</span>}
            </div>
          ) : (
            <p className="text-center text-sm" style={{ color: 'var(--muted)' }}>
              {isListening ? 'Listening… speak your intention' : 'Tap the mic to start'}
            </p>
          )}

          {displayText && !isListening && (
            <div className="flex gap-2">
              <button
                onClick={() => { setTranscript(''); setInterim('') }}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: 'var(--surface-hover)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                Clear
              </button>
              <button
                onClick={handleSubmitVoice}
                disabled={submitting}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {submitting ? 'Saving…' : 'Save Intent'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmitText} className="space-y-3">
          <textarea
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder="Type your intention here… e.g. 'Schedule a call with the team tomorrow morning'"
            rows={4}
            disabled={disabled || submitting}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none transition-all"
            style={{
              background: 'var(--background)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          />
          <button
            type="submit"
            disabled={!textInput.trim() || submitting || disabled}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {submitting ? 'Saving…' : 'Save Intent'}
          </button>
        </form>
      )}

      {error && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(248,113,113,0.1)', color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
