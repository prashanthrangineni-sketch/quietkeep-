'use client';
// src/app/ride/page.jsx — Ride Safety: crash detection with a spoken check-in.
//
// Flow: start the ride watch → the phone listens to its own motion and GPS →
// a hard impact followed by stillness raises a check-in → Aaria asks "Are you
// okay?" and counts down out loud → "I'm okay" cancels → no answer sends the
// alert with the last known location.
//
// This screen deliberately touches NOTHING in the voice-capture path; it only
// speaks (VoiceTalkback) and, if the browser offers it, listens for one short
// answer of its own.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import useAndroidBack from '@/lib/useAndroidBack';
import NavbarClient from '@/components/NavbarClient';
import { supabase } from '@/lib/supabase';
import { speak } from '@/components/VoiceTalkback';
import { createCrashDetector, magnitudeFromMotionEvent } from '@/lib/crash-detect';

const COUNTDOWN_SECS = 30;

export default function RideSafetyPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const router = useRouter();
  useAndroidBack();

  const [watching, setWatching]   = useState(false);
  const [rideState, setRideState] = useState('idle');
  const [speedKmh, setSpeedKmh]   = useState(null);
  const [contacts, setContacts]   = useState([]);
  const [status, setStatus]       = useState('');
  const [sensorOk, setSensorOk]   = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [isDrill, setIsDrill]     = useState(false);
  const [outcome, setOutcome]     = useState(null);
  const [lastEvents, setLastEvents] = useState([]);
  const [gps, setGps]             = useState({ state: 'unknown', text: '' });
  const [newContact, setNewContact] = useState({ name: '', phone: '' });
  const [savingContact, setSavingContact] = useState(false);

  const detectorRef = useRef(null);
  const motionRef   = useRef(null);
  const watchIdRef  = useRef(null);
  const timerRef    = useRef(null);
  const posRef      = useRef(null);
  const crashRef    = useRef(null);
  const recogRef    = useRef(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    loadContacts();
    loadHistory();
    return () => stopWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  async function loadContacts() {
    const { data } = await supabase
      .from('emergency_contacts')
      .select('id, name, phone')
      .eq('user_id', user.id);
    setContacts(data || []);
  }

  async function loadHistory() {
    const { data } = await supabase
      .from('sos_events')
      .select('id, triggered_at, channel, contacts_notified')
      .eq('user_id', user.id)
      .in('channel', ['crash-auto', 'crash-test'])
      .order('triggered_at', { ascending: false })
      .limit(5);
    setLastEvents(data || []);
  }

  // ── Starting and stopping the watch ────────────────────────────────────────
  async function startWatch() {
    setOutcome(null);
    // iOS (and some Android browsers) require an explicit tap-time permission.
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const granted = await DeviceMotionEvent.requestPermission();
        if (granted !== 'granted') {
          setStatus('Motion access was refused, so crash detection cannot run.');
          setSensorOk(false);
          return;
        }
      }
    } catch {
      setStatus('This phone did not allow motion access.');
      setSensorOk(false);
      return;
    }

    const detector = createCrashDetector();
    detectorRef.current = detector;
    detector.onChange((state, detail) => {
      setRideState(state);
      if (state === 'crash') onCrashDetected(detail);
    });

    let sawReading = false;
    const onMotion = (e) => {
      const g = magnitudeFromMotionEvent(e);
      if (g == null) return;
      if (!sawReading) { sawReading = true; setSensorOk(true); }
      detector.feedMotion({ magnitudeG: g });
    };
    motionRef.current = onMotion;
    window.addEventListener('devicemotion', onMotion);
    setTimeout(() => { if (!sawReading) setSensorOk(false); }, 4000);

    startLocation(detector);

    setWatching(true);
    setRideState(detector.getState());
    setStatus('Watching this ride. Keep the phone on you or in a pocket or mount.');
    speak('Ride safety is on. I am watching for a fall.');
  }

  // ── Location ───────────────────────────────────────────────────────────────
  // An alert without a map link is far less useful, so this says plainly WHY
  // there is no fix and offers a retry, instead of one vague warning line.
  function startLocation(detector) {
    if (!navigator.geolocation) {
      setGps({ state: 'unsupported', text: 'This phone does not offer location to the app.' });
      return;
    }
    setGps({ state: 'searching', text: 'Looking for your location…' });

    const onPos = (pos) => {
      posRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      setGps({ state: 'ready', text: `Location ready, accurate to about ${Math.round(pos.coords.accuracy)} metres.` });
      const kmh = pos.coords.speed != null ? Math.max(0, pos.coords.speed * 3.6) : null;
      if (kmh != null && detector) { setSpeedKmh(Math.round(kmh)); detector.feedSpeed({ kmh }); }
    };
    const onErr = (err) => {
      const text = err?.code === 1
        ? 'Location permission is off for QuietKeep, so an alert would carry no map link. Turn it on in your phone settings, then tap Retry.'
        : err?.code === 2
          ? 'Your phone cannot get a location fix here. Move into the open and tap Retry.'
          : 'Still searching for a location fix. Tap Retry if this stays for long.';
      setGps({ state: 'error', text });
    };

    // One quick fix first — a watch alone can stay silent for a long time.
    navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }

  function retryLocation() { startLocation(detectorRef.current); }

  async function addContact() {
    const name  = newContact.name.trim();
    const digits = newContact.phone.replace(/\D/g, '');
    if (!name)            { setStatus('Type a name for the contact.'); return; }
    if (digits.length < 10) { setStatus('Type a 10-digit mobile number.'); return; }
    setSavingContact(true);
    const phone = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    const { error } = await supabase.from('emergency_contacts').insert({
      user_id: user.id, name, phone, is_primary: contacts.length === 0,
    });
    setSavingContact(false);
    if (error) { setStatus(`Could not save the contact: ${error.message}`); return; }
    setNewContact({ name: '', phone: '' });
    setStatus(`${name} will be told if you do not answer a check-in.`);
    loadContacts();
  }

  function stopWatch() {
    if (motionRef.current) { window.removeEventListener('devicemotion', motionRef.current); motionRef.current = null; }
    if (watchIdRef.current != null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { recogRef.current?.stop(); } catch {}
    recogRef.current = null;
    detectorRef.current = null;
    setWatching(false);
    setCountdown(null);
    setRideState('idle');
    setSpeedKmh(null);
  }

  // ── The check-in ───────────────────────────────────────────────────────────
  function onCrashDetected(detail) {
    if (countdown !== null) return;
    crashRef.current = detail || {};
    setIsDrill(detail?.test === true);
    setCountdown(COUNTDOWN_SECS);
    speak(detail?.test
      ? 'This is a test. Are you okay? Say I am okay, or tap the button.'
      : 'It looks like you have had a fall. Are you okay? Say I am okay, or tap the button.');
    listenForOkay();

    let left = COUNTDOWN_SECS;
    timerRef.current = setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left === 20 || left === 10) speak(`${left} seconds. Say I am okay to stop.`);
      if (left <= 0) {
        clearInterval(timerRef.current); timerRef.current = null;
        sendAlert();
      }
    }, 1000);
  }

  /** One short listen for "I'm okay" — its own recogniser, nothing shared. */
  function listenForOkay() {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return;
    try {
      const r = new SR();
      r.lang = 'en-IN';
      r.continuous = true;
      r.interimResults = false;
      r.onresult = (e) => {
        const said = String(e.results[e.results.length - 1][0].transcript || '').toLowerCase();
        if (/\b(i am okay|i'm okay|im okay|okay|ok|fine|theek|bagunnanu|cancel|stop)\b/.test(said)) cancelAlert('voice');
        else if (/\bhelp\b/.test(said)) sendAlert();
      };
      r.onerror = () => {};
      recogRef.current = r;
      r.start();
    } catch { /* listening is a bonus; the buttons are the real control */ }
  }

  function cancelAlert(how = 'tap') {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { recogRef.current?.stop(); } catch {}
    recogRef.current = null;
    setCountdown(null);
    setOutcome({ kind: 'cancelled', text: how === 'voice' ? 'You said you are okay. No one was contacted.' : 'Cancelled. No one was contacted.' });
    speak('Good. Ride safe.');
    detectorRef.current?.reset(true);
  }

  async function sendAlert() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { recogRef.current?.stop(); } catch {}
    recogRef.current = null;
    setCountdown(null);
    const drill = isDrill;
    speak(drill ? 'Test finished. Nothing was sent.' : 'Sending your location to your emergency contacts.');

    try {
      const res = await fetch('/api/ride/crash-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          test: drill,
          lat: posRef.current?.lat ?? null,
          lng: posRef.current?.lng ?? null,
          accuracy: posRef.current?.acc ?? null,
          impactG: crashRef.current?.impactG ?? null,
          speedBeforeKmh: crashRef.current?.speedBeforeKmh ?? null,
        }),
      });
      const data = await res.json();
      if (drill) {
        setOutcome({ kind: 'drill', text: `Test recorded. ${data.contacts_found || 0} emergency contact(s) would have been messaged. Nobody was contacted.` });
      } else if (data.delivery === 'sent') {
        setOutcome({ kind: 'sent', text: `Alert sent to ${data.sent.filter(s => s.ok).length} of ${data.contacts_found} contact(s).` });
      } else {
        setOutcome({
          kind: 'manual',
          text: 'Crash recorded, but automatic messaging did not go out. Send it yourself with the buttons below.',
        });
      }
    } catch {
      setOutcome({ kind: 'manual', text: 'Could not reach the server. Send the alert yourself with the buttons below.' });
    }
    detectorRef.current?.reset(true);
    loadHistory();
  }

  function whatsappContact(contact) {
    const link = posRef.current
      ? `https://maps.google.com/?q=${posRef.current.lat.toFixed(6)},${posRef.current.lng.toFixed(6)}`
      : 'location unavailable';
    const msg = `🚨 I may have had an accident on my ride. My last location: ${link} — sent from QuietKeep`;
    window.open(`https://wa.me/${contact.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function runDrill() {
    if (!detectorRef.current) { setStatus('Start the ride watch first, then run the test.'); return; }
    detectorRef.current.simulateCrash();
  }

  const stateLabel = {
    idle: 'Watching — no movement yet',
    riding: 'Riding',
    suspected: 'Checking a hard knock…',
    crash: 'Fall detected',
    dismissed: 'That was a bump, not a fall',
  }[rideState] || rideState;

  return (
    <>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 16px 96px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 2px', color: 'var(--text)' }}>🛵 Ride Safety</h1>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          If you have a fall, Aaria asks if you are okay. If you do not answer, your
          emergency contacts get your location.
        </p>

        <div style={{ border: '1px solid var(--border, #e2e8f0)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>Status</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: watching ? '#16a34a' : 'var(--text)' }}>
            {watching ? stateLabel : 'Off'}
          </div>
          {watching && speedKmh != null && (
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Speed {speedKmh} km/h</div>
          )}
          {watching && gps.text && (
            <div style={{ fontSize: 13, color: gps.state === 'ready' ? '#16a34a' : '#b45309', marginTop: 8 }}>
              {gps.text}
              {gps.state !== 'ready' && gps.state !== 'searching' && (
                <button onClick={retryLocation}
                  style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 8, border: '1px solid #b45309', background: 'transparent', color: '#b45309', fontWeight: 700, fontSize: 12 }}>
                  Retry
                </button>
              )}
            </div>
          )}
          {watching && sensorOk === false && (
            <div style={{ fontSize: 13, color: '#b45309', marginTop: 8 }}>
              This phone is not reporting movement, so a fall cannot be detected. The SOS button still works.
            </div>
          )}
          <button
            onClick={watching ? stopWatch : startWatch}
            style={{
              marginTop: 14, width: '100%', padding: '14px 16px', borderRadius: 12, border: 'none',
              fontSize: 16, fontWeight: 700, color: '#fff', background: watching ? '#ef4444' : '#16a34a',
            }}>
            {watching ? 'Stop ride watch' : 'Start ride watch'}
          </button>
          {status && <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>{status}</div>}
        </div>

        <div style={{ border: '1px solid var(--border, #e2e8f0)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--text)' }}>Emergency contacts</div>
          {contacts.length === 0 ? (
            <div style={{ fontSize: 13, color: '#b45309' }}>
              None saved yet. Without one, nobody can be told.{' '}
              <a href="/emergency" style={{ color: '#2563eb', fontWeight: 600 }}>Add a contact</a>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#64748b' }}>
              {contacts.map(c => c.name).join(', ')} — {contacts.length} saved
            </div>
          )}
          <button onClick={runDrill}
            style={{ marginTop: 12, width: '100%', padding: '12px 16px', borderRadius: 12, border: '1px solid #2563eb', background: 'transparent', color: '#2563eb', fontWeight: 700, fontSize: 15 }}>
            Test my crash detection (nothing is sent)
          </button>
        </div>

        {outcome && (
          <div style={{ border: '1px solid var(--border, #e2e8f0)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>Last check-in</div>
            <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>{outcome.text}</div>
            {outcome.kind === 'manual' && contacts.map(c => (
              <button key={c.id} onClick={() => whatsappContact(c)}
                style={{ marginTop: 8, width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: '#22c55e', color: '#fff', fontWeight: 700 }}>
                Send my location to {c.name}
              </button>
            ))}
          </div>
        )}

        {lastEvents.length > 0 && (
          <div style={{ border: '1px solid var(--border, #e2e8f0)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: 'var(--text)' }}>Recent</div>
            {lastEvents.map(e => (
              <div key={e.id} style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>
                {new Date(e.triggered_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {' — '}{e.channel === 'crash-test' ? 'test' : `alert, ${e.contacts_notified || 0} contacted`}
              </div>
            ))}
          </div>
        )}
      </div>

      {countdown !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: isDrill ? 'rgba(37,99,235,0.97)' : 'rgba(220,38,38,0.97)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
        }}>
          <div style={{ color: '#fff', fontSize: 26, fontWeight: 800 }}>
            {isDrill ? 'TEST — Are you okay?' : 'Are you okay?'}
          </div>
          <div style={{ color: '#fff', fontSize: 72, fontWeight: 900, margin: '12px 0' }}>{countdown}</div>
          <div style={{ color: '#fff', fontSize: 15, marginBottom: 24, opacity: 0.9 }}>
            {isDrill ? 'This is a test. Nothing will be sent.' : 'If you do not answer, your contacts get your location.'}
          </div>
          <button onClick={() => cancelAlert('tap')}
            style={{ width: '100%', maxWidth: 360, padding: '22px', borderRadius: 16, border: 'none', background: '#fff', color: '#111', fontSize: 22, fontWeight: 800 }}>
            I'm okay
          </button>
          <button onClick={sendAlert}
            style={{ marginTop: 12, width: '100%', maxWidth: 360, padding: '16px', borderRadius: 14, border: '2px solid #fff', background: 'transparent', color: '#fff', fontSize: 17, fontWeight: 700 }}>
            {isDrill ? 'Finish the test now' : 'Send help now'}
          </button>
        </div>
      )}
      <NavbarClient />
    </>
  );
}
