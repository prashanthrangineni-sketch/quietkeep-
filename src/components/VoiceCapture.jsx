'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

export default function VoiceCapture({ onCapture, disabled = false }) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [textInput, setTextInput] = useState('')
  const [mode, setMode] = useState('voice')
  const [speechSupported, setSpeechSupported] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const recognitionRef = useRef(null)

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

  const handleSubmitText = async () => {
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

  const combinedTranscript = (transcript + ' ' + interim).trim()

  return (
    <div
      className="rounded-2xl p-6 space-y-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex gap-2 rounded-lg p-1" style={{ background: 'var(--background)' }}>
        {speechSupported && (
          <button
            onClick={() => setMode('voice')}
            className="flex-1 py-2 rounded text-xs font-medium transition-colors"
            style={{
              background: mode === 'voice' ? 'var(--accent)' : 'transparent',
              color: mode === 'voice' ? '#fff' : 'var(--muted)',
            }}
          >
            🎙️ Voice
          </button>
        )}
        <button
          onClick={() => setMode('text')}
          className="flex-1 py-2 rounded text-xs font-medium transition-colors"
          style={{
            background: mode === 'text' ? 'var(--accent)' : 'transparent',
            color: mode === 'text' ? '#fff' : 'var(--muted)',
          }}
        >
          ⌨️ Text
        </button>
      </div>

      {mode === 'voice' ? (
        <div className="space-y-3">
          {combinedTranscript && (
            <div
              className="rounded-lg p-3 space-y-1"
              style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
            >
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Transcript</p>
              <p style={{ color: 'var(--foreground)' }}>{combinedTranscript}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={isListening ? stopListening : startListening}
              disabled={submitting || disabled}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{ background: isListening ? 'var(--error)' : 'var(--accent)', color: '#fff' }}
            >
              {isListening ? '⏹️ Stop' : '🎤 Start'}
            </button>
            <button
              onClick={handleSubmitVoice}
              disabled={!combinedTranscript || submitting || disabled}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{ background: 'var(--success)', color: '#fff' }}
            >
              {submitting ? 'Saving…' : '✓ Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder="Type your intention here…"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            rows={3}
          />
          <button
            onClick={handleSubmitText}
            disabled={!textInput.trim() || submitting || disabled}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {submitting ? 'Saving…' : '✓ Save Intent'}
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(248,113,113,0.1)', color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  )
            }
