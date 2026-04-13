'use client'
import { safeFetch, apiPost, apiGet } from '@/lib/safeFetch';

import { useState, useRef, useCallback, useEffect } from 'react'

const LANG_MAP = {
  'en':'en-IN','en-IN':'en-IN','en-US':'en-US',
  'hi':'hi-IN','hi-IN':'hi-IN',
  'te':'te-IN','te-IN':'te-IN',
  'ta':'ta-IN','ta-IN':'ta-IN',
  'mr':'mr-IN','kn':'kn-IN','ml':'ml-IN','gu':'gu-IN','bn':'bn-IN',
}
function getSpeechLang(lang) { return LANG_MAP[lang] || lang || 'en-IN' }

// Web-only: Sarvam STT fallback for non-English browser path
async function trySarvamSTT(audioBlob, languageCode) {
  try {
    const form = new FormData()
    form.append('audio', audioBlob, 'audio.webm')
    form.append('language_code', languageCode)
    // FIX: Pass FormData as body. safeFetch must NOT set Content-Type here —
    // the browser sets multipart/form-data with boundary automatically.
    const res = await fetch('/api/sarvam-stt', {
      method: 'POST',
      body: form,
    })
    if (!res.ok) return null
    const json = await res.json()
    if (json.fallback || !json.transcript) return null
    return json.transcript
  } catch { return null }
}

/**
 * callPluginAsync — invoke a Capacitor plugin method via toNative().
 */
function callPluginAsync(pluginName, methodName, options = {}) {
  return new Promise((resolve, reject) => {
    const cap = typeof window !== 'undefined' ? window?.Capacitor : null
    if (!cap?.toNative) { reject(new Error('Capacitor bridge not available')); return }
    cap.toNative(pluginName, methodName, options, {
      resolve: (value) => resolve(value),
      reject:  (err)   => reject(new Error(
        typeof err === 'string' ? err : err?.message ?? JSON.stringify(err)
      )),
    })
  })
}

/** True only when running inside the Capacitor native Android runtime. */
function isAndroidNative() {
  if (typeof window === 'undefined') return false
  return !!(window?.Capacitor?.isNativePlatform?.() &&
            window?.Capacitor?.getPlatform?.() === 'android')
}

/**
 * VoiceCapture v2
 *
 * CRITICAL FIX v2: Android mic permission flow.
 *
 * PREVIOUS BUG: startNativeCapture() called requestMicPermission() which,
 * on failure, fell back to navigator.mediaDevices.getUserMedia({ audio: true }).
 * On Oppo/Realme/Vivo (ColorOS/Funtouch), getUserMedia in a Capacitor WebView:
 *   1. Fires a second, WebView-level audio permission dialog AFTER the OS dialog.
 *   2. On first install, always fails because the WebView audio permission
 *      cache hasn't been populated yet (separate from RECORD_AUDIO).
 *   3. The catch block returned false → "Microphone permission denied" banner
 *      even when the user had already granted RECORD_AUDIO at OS level.
 *
 * FIX:
 *   - requestMicPermission() on Android ONLY uses VoicePlugin.requestMicPermission().
 *   - If the plugin returns denied, wait 400ms and retry checkMicPermission() ONCE.
 *     The 400ms covers the ColorOS/Hans UID permission commit delay.
 *   - getUserMedia is NEVER called on Android native (not in requestMicPermission,
 *     not anywhere in the native voice path).
 *   - Web browser path is completely unchanged.
 */
export default function VoiceCapture({
  onCapture,
  disabled = false,
  lang = 'en-IN',
  workspaceId = null,
  authToken = null,
  serverUrl = 'https://quietkeep.com',
}) {
  // ── Shared state ─────────────────────────────────────────────────────
  const [textInput, setTextInput]             = useState('')
  const [mode, setMode]                       = useState('voice')
  const [submitting, setSubmitting]           = useState(false)
  const [error, setError]                     = useState('')

  // ── Native Android state ─────────────────────────────────────────────
  const [nativeStatus, setNativeStatus]       = useState('idle')
  // 'idle' | 'requesting' | 'listening' | 'processing' | 'error'
  const [nativeActive, setNativeActive]       = useState(false)

  // ── Web browser state ─────────────────────────────────────────────────
  const [isListening, setIsListening]         = useState(false)
  const [transcript, setTranscript]           = useState('')
  const [interim, setInterim]                 = useState('')
  const [speechSupported, setSpeechSupported] = useState(true)

  const recognitionRef   = useRef(null)
  const sessionRef       = useRef(null)
  const isListeningRef   = useRef(false)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef   = useRef([])

  const isNonEnglish = !!(lang && !lang.startsWith('en'))
  const onAndroid    = isAndroidNative()

  // ── Init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (onAndroid) return // native path — SpeechRecognition not used
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setSpeechSupported(false); setMode('text') }
  }, [onAndroid])

  useEffect(() => { isListeningRef.current = isListening }, [isListening])

  // Poll native voice state so the indicator stays accurate
  useEffect(() => {
    if (!onAndroid) return
    async function poll() {
      try {
        const r = await callPluginAsync('VoicePlugin', 'isRunning')
        setNativeActive(r?.running === true && r?.capturing === true)
      } catch { setNativeActive(false) }
    }
    poll()
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
  }, [onAndroid])

  // ── Native Android voice ──────────────────────────────────────────────

  /**
   * Request RECORD_AUDIO on Android native.
   *
   * FIX v2: NEVER calls getUserMedia on Android.
   *
   * Step 1: Call VoicePlugin.requestMicPermission().
   * Step 2: If denied, wait 400ms (ColorOS Hans commit delay) and retry
   *         VoicePlugin.checkMicPermission() once.
   * Step 3: If still denied, show settings guidance.
   *
   * Returns true if granted, false otherwise.
   */
  async function requestMicNative() {
    try {
      const result = await callPluginAsync('VoicePlugin', 'requestMicPermission')
      if (result?.granted === true) return true

      // 400ms retry for ColorOS/Hans UID commit delay
      await new Promise(r => setTimeout(r, 400))
      const retry = await callPluginAsync('VoicePlugin', 'checkMicPermission')
      return retry?.granted === true
    } catch (e) {
      // Bridge error — try a direct check as last resort
      try {
        const check = await callPluginAsync('VoicePlugin', 'checkMicPermission')
        return check?.granted === true
      } catch { return false }
    }
  }

  async function startNativeCapture() {
    if (nativeStatus === 'requesting' || nativeStatus === 'listening') return
    setError('')
    setNativeStatus('requesting')

    try {
      // Step 1: Request RECORD_AUDIO (native-only, no getUserMedia fallback)
      const granted = await requestMicNative()
      if (!granted) {
        setError(
          'Microphone permission required. '
          + 'Go to Settings → Apps → QuietKeep → Permissions → Microphone → Allow.'
        )
        setNativeStatus('error')
        return
      }

      // Step 2: Start VoiceService
      setNativeStatus('listening')
      await callPluginAsync('VoicePlugin', 'startService', {
        auth_token:    (authToken || '').replace(/^Bearer\s+/i, '').trim(),
        server_url:    serverUrl,
        mode:          workspaceId ? 'business' : 'personal',
        workspace_id:  workspaceId || null,
        language_code: getSpeechLang(lang),
      })
      setNativeActive(true)

      // Step 3: Confirm after 900ms that AudioRecord actually started
      setTimeout(async () => {
        try {
          const r = await callPluginAsync('VoicePlugin', 'isRunning')
          if (r?.capturing !== true) {
            setNativeStatus('error')
            setNativeActive(false)
            setError(
              'Mic capture did not start. '
              + 'Ensure the app is exempt from battery optimisation '
              + '(Settings → Battery → App Launch → QuietKeep → Manage manually → enable all).'
            )
          } else {
            setNativeStatus('listening')
          }
        } catch { setNativeStatus('listening') } // assume running if check throws
      }, 900)

    } catch (e) {
      setError('Could not start voice: ' + (e?.message ?? 'unknown error'))
      setNativeStatus('error')
    }
  }

  async function stopNativeCapture() {
    try { await callPluginAsync('VoicePlugin', 'stopService') } catch {}
    setNativeActive(false)
    setNativeStatus('idle')
  }

  // ── Web browser voice (SpeechRecognition + Sarvam) ────────────────────

  const startMediaRecorder = useCallback(async () => {
    if (!isNonEnglish) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      audioChunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.start(3000)
      mediaRecorderRef.current = mr
    } catch { /* MediaRecorder unavailable — browser STT only */ }
  }, [isNonEnglish])

  const stopMediaRecorder = useCallback(() => {
    if (!mediaRecorderRef.current) return
    try { mediaRecorderRef.current.stop() } catch {}
    mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop())
    mediaRecorderRef.current = null
    audioChunksRef.current = []
  }, [])

  const startListening = useCallback(() => {
    if (onAndroid) return // native path handles this
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    startMediaRecorder()

    const recognition = new SR()
    recognition.continuous      = true
    recognition.interimResults  = true
    recognition.maxAlternatives = 1
    recognition.lang = getSpeechLang(lang)

    recognition.onstart = () => { setIsListening(true); isListeningRef.current = true }

    recognition.onend = () => {
      if (recognitionRef.current === recognition && isListeningRef.current) {
        try { recognition.start(); return } catch {}
      }
      setIsListening(false)
      isListeningRef.current = false
      setInterim('')
    }

    recognition.onerror = (event) => {
      setIsListening(false)
      isListeningRef.current = false
      setInterim('')
      if (event.error !== 'no-speech') setError(`Microphone error: ${event.error}`)
    }

    recognition.onresult = async (event) => {
      let final = ''; let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) final += r[0].transcript
        else interimText += r[0].transcript
      }
      if (final) {
        if (isNonEnglish && audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
          audioChunksRef.current = []
          const sarvamText = await trySarvamSTT(blob, getSpeechLang(lang))
          setTranscript(prev => (prev + ' ' + (sarvamText || final)).trim())
        } else {
          setTranscript(prev => (prev + ' ' + final).trim())
        }
      }
      setInterim(interimText)
    }

    recognitionRef.current = recognition
    try { recognition.start() }
    catch { setError('Could not start microphone. Please check permissions.') }
  }, [lang, isNonEnglish, startMediaRecorder, onAndroid])

  const stopListening = useCallback(() => {
    isListeningRef.current = false
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }
    stopMediaRecorder()
    setIsListening(false)
    setInterim('')
  }, [stopMediaRecorder])

  // ── Submit ────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    const finalText = (mode === 'voice' ? transcript : textInput).trim()
    if (!finalText || submitting) return
    stopListening()
    setSubmitting(true)
    setError('')
    try {
      await onCapture(finalText, {
        session_id:   sessionRef.current,
        is_final:     true,
        workspace_id: workspaceId || null,
      })
      setTranscript('')
      setTextInput('')
      sessionRef.current = null
    } catch { setError('Failed to save. Please try again.') }
    finally { setSubmitting(false) }
  }, [mode, transcript, textInput, submitting, stopListening, onCapture, workspaceId])

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit() }
  }, [handleSubmit])

  const activeText = mode === 'voice'
    ? (onAndroid ? '' : transcript)
    : textInput
  const hasContent = activeText.trim().length > 0 || (!onAndroid && transcript.trim().length > 0)

  // ── Render ────────────────────────────────────────────────────────────

  const STATUS_LABEL = {
    idle:       'Tap mic to start',
    requesting: 'Requesting permission…',
    listening:  '● Listening…',
    processing: 'Processing…',
    error:      'Error — tap to retry',
  }
  const STATUS_COLOR = {
    idle:       'var(--text-subtle)',
    requesting: '#f59e0b',
    listening:  '#ef4444',
    processing: '#6366f1',
    error:      'var(--red)',
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Mode toggle — always show text option */}
      <div style={{ display:'flex', gap:6, marginBottom:10, background:'var(--surface)',
        border:'1px solid var(--border)', borderRadius:10, padding:4, width:'fit-content' }}>
        {[['voice','🎙️ Voice'],['text','⌨️ Type']].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); if (m==='text') { stopListening(); if (onAndroid) stopNativeCapture() } setError('') }}
            style={{ padding:'6px 14px', borderRadius:7, border:'none',
              background: mode===m ? 'var(--primary)' : 'transparent',
              color: mode===m ? '#fff' : 'var(--text-muted)',
              fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ANDROID NATIVE VOICE UI ─────────────────────────────────── */}
      {onAndroid && mode === 'voice' && (
        <div>
          {nativeActive && (
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8,
              background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.25)',
              borderRadius:8, padding:'6px 12px' }}>
              <span style={{ width:7, height:7, background:'#10b981', borderRadius:'50%',
                display:'inline-block', animation:'pulse 1.5s infinite' }} />
              <span style={{ fontSize:12, color:'#10b981', fontWeight:600 }}>
                Always-on voice capturing — speak naturally
              </span>
            </div>
          )}

          <div style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:8 }}>
            <button
              onClick={nativeActive ? stopNativeCapture : startNativeCapture}
              disabled={disabled || nativeStatus === 'requesting'}
              style={{ width:52, height:52, borderRadius:'50%', border:'none', flexShrink:0,
                background: nativeActive ? '#ef4444'
                  : nativeStatus === 'requesting' ? '#f59e0b'
                  : 'var(--primary)',
                color:'#fff', fontSize:22,
                cursor: (disabled || nativeStatus === 'requesting') ? 'not-allowed' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
                transition:'background 0.2s',
                animation: nativeStatus === 'listening' ? 'pulse 1.5s infinite' : 'none' }}>
              {nativeActive ? '⏹' : nativeStatus === 'requesting' ? '⏳' : '🎙️'}
            </button>

            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:12, fontWeight:600, margin:'0 0 4px',
                color: STATUS_COLOR[nativeStatus] || 'var(--text-subtle)',
                animation: nativeStatus === 'listening' ? 'pulse 1.5s infinite' : 'none' }}>
                {STATUS_LABEL[nativeStatus]}
              </p>
              {!nativeActive && nativeStatus === 'idle' && (
                <p style={{ fontSize:11, color:'var(--text-subtle)', margin:0, lineHeight:1.5 }}>
                  Uses always-on native mic capture — works with screen off
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── WEB BROWSER VOICE UI ───────────────────────────────────── */}
      {!onAndroid && mode === 'voice' && (
        <div>
          {isNonEnglish && (
            <p style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6, opacity:0.7 }}>
              🇮🇳 Sarvam AI STT active for {lang}
            </p>
          )}
          {!speechSupported ? (
            <p style={{ fontSize:12, color:'var(--text-muted)', margin:'0 0 8px' }}>
              Voice not supported in this browser. Use text mode.
            </p>
          ) : (
            <div style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:8 }}>
              <button onClick={isListening ? stopListening : startListening}
                disabled={disabled}
                className={isListening ? 'qk-mic-active' : ''}
                style={{ width:52, height:52, borderRadius:'50%', border:'none',
                  background: isListening ? '#ef4444' : 'var(--primary)',
                  color:'#fff', fontSize:22, cursor:disabled?'not-allowed':'pointer',
                  flexShrink:0, transition:'background 0.2s',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                {isListening ? '⏹' : '🎙️'}
              </button>
              <div style={{ flex:1, minWidth:0 }}>
                {isListening && (
                  <p style={{ fontSize:12, color:'#ef4444', fontWeight:600, margin:'0 0 4px',
                    animation:'pulse 1.5s infinite' }}>
                    ● Listening{isNonEnglish ? ` (${lang})` : ''}…
                  </p>
                )}
                {interim && (
                  <p style={{ fontSize:13, color:'var(--text-muted)', fontStyle:'italic', margin:'0 0 4px' }}>
                    {interim}
                  </p>
                )}
                {transcript && (
                  <p style={{ fontSize:14, color:'var(--text)', margin:0, lineHeight:1.5 }}>
                    {transcript}
                  </p>
                )}
                {!isListening && !transcript && !interim && (
                  <p style={{ fontSize:12, color:'var(--text-subtle)', margin:0 }}>
                    Tap mic to start speaking
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{ background:'var(--red-dim)', border:'1px solid rgba(220,38,38,0.2)',
          borderRadius:8, padding:'8px 12px', fontSize:12, color:'var(--red)', marginBottom:8 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Text input mode */}
      {mode === 'text' && (
        <textarea value={textInput} onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your keep… (Ctrl+Enter to save)" rows={3}
          style={{ width:'100%', background:'var(--bg)', border:'1.5px solid var(--border)',
            borderRadius:10, color:'var(--text)', padding:'10px 12px', fontSize:14,
            fontFamily:'inherit', resize:'vertical', outline:'none', lineHeight:1.6,
            marginBottom:8, boxSizing:'border-box' }} />
      )}

      {/* Submit — visible when text is available (web transcript or text input) */}
      {(hasContent || (mode === 'voice' && !onAndroid && transcript)) && (
        <button onClick={handleSubmit} disabled={submitting || disabled}
          style={{ width:'100%', padding:'12px', borderRadius:10, border:'none',
            background: submitting ? 'var(--surface-hover)' : 'var(--primary)',
            color: submitting ? 'var(--text-subtle)' : '#fff',
            fontSize:14, fontWeight:700, cursor:submitting?'not-allowed':'pointer',
            fontFamily:'inherit', transition:'all 0.2s' }}>
          {submitting ? 'Saving…' : '✓ Keep this'}
        </button>
      )}
    </div>
  )
}
