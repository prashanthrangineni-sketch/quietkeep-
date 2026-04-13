'use client';
// src/app/smart-home/page.jsx — Smart IoT Hub with voice-guided setup
import { useState } from 'react';
import NavbarClient from '@/components/NavbarClient';
import Link from 'next/link';

const INTEGRATIONS = [
  {
    icon: '💡', name: 'Smart Lights', brands: 'Philips Hue, LIFX, TP-Link',
    status: 'setup_guide',
    guide: [
      'Open your light\'s official app (e.g. Philips Hue)',
      'Enable "Developer Mode" or "Third-party API" in app settings',
      'Find your Bridge IP address in app → Settings → My Hue System',
      'In QuietKeep Settings → Connectors → Smart Lights, enter the Bridge IP',
      'Tap "Link Bridge" — press the physical button on your Hue Bridge within 30s',
      'Done! Say "Lights on" or "Lights off" in Drive Mode or Daily Brief',
    ],
    voiceHint: 'Say: lights on, lights off, dim lights',
    docsUrl: 'https://developers.meethue.com/develop/get-started-2/',
    color: '#fbbf24',
  },
  {
    icon: '🌡️', name: 'Smart Thermostat', brands: 'Nest, Ecobee',
    status: 'setup_guide',
    guide: [
      'Open Google Home app → tap your Nest thermostat',
      'Go to Settings → Works with Google → enable API access',
      'Visit console.nest.com and generate a Device Access token',
      'In QuietKeep Settings → Connectors → Thermostat, paste your token',
      'QuietKeep will now show your home temperature in Daily Brief',
    ],
    voiceHint: 'Temperature shows in your Daily Brief automatically',
    docsUrl: 'https://developers.google.com/nest/device-access',
    color: '#60a5fa',
  },
  {
    icon: '🔒', name: 'Smart Lock', brands: 'August, Yale, Schlage',
    status: 'setup_guide',
    guide: [
      'Open your August/Yale app → go to Settings → API → Generate token',
      'Copy the API token (32-character string)',
      'In QuietKeep Settings → Connectors → Smart Lock, enter the token + your Device ID',
      'Lock status will appear in your Daily Brief each morning',
      '⚠️ Safety: QuietKeep only reads status — it cannot unlock remotely for security',
    ],
    voiceHint: 'Lock status shown in Daily Brief each morning',
    docsUrl: 'https://august.com/developer',
    color: '#34d399',
  },
  {
    icon: '📷', name: 'Security Camera', brands: 'Arlo, Ring, Nest Cam',
    status: 'coming_soon',
    guide: [],
    voiceHint: 'Coming in next update',
    color: '#f87171',
  },
  {
    icon: '🔌', name: 'Smart Plugs', brands: 'TP-Link Kasa, Tapo',
    status: 'setup_guide',
    guide: [
      'Open Kasa app → tap your plug → tap Settings → Developer Mode → enable',
      'Note your plug\'s local IP address (shown in app)',
      'In QuietKeep Settings → Connectors → Smart Plugs, add IP + alias (e.g. "Geyser")',
      'You can now control it from Daily Brief or Drive Mode',
    ],
    voiceHint: 'Say: turn on geyser, turn off fan',
    docsUrl: 'https://www.tp-link.com/en/support/faq/2262/',
    color: '#fb923c',
  },
  {
    icon: '🎵', name: 'Smart Speaker', brands: 'Alexa, Google Home',
    status: 'setup_guide',
    guide: [
      'For Alexa: Open Alexa app → More → Skills → search "QuietKeep" (coming soon)',
      'For Google Home: Open Google Home → + → Set up device → Works with Google → QuietKeep',
      'Once linked, you can say "Hey Google, ask QuietKeep to read my brief"',
      'Currently available as integration — full Alexa skill in development',
    ],
    voiceHint: 'Google Home integration works today',
    color: '#a78bfa',
  },
];

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  try { u.lang = localStorage.getItem('qk_voice_lang') || 'en-IN'; } catch { u.lang = 'en-IN'; }
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

export default function SmartHomePage() {
  const [expanded, setExpanded] = useState(null);
  const [guideStep, setGuideStep] = useState({});

  function toggleExpand(name) {
    const next = expanded === name ? null : name;
    setExpanded(next);
    if (next) {
      const d = INTEGRATIONS.find(d => d.name === name);
      if (d?.guide?.length) {
        speak(`Setting up ${name}. Step 1: ${d.guide[0]}`);
        setGuideStep(prev => ({ ...prev, [name]: 0 }));
      }
    }
  }

  function nextStep(device, total) {
    const current = guideStep[device] ?? 0;
    const next = Math.min(current + 1, total - 1);
    setGuideStep(prev => ({ ...prev, [device]: next }));
    const d = INTEGRATIONS.find(d => d.name === device);
    if (d?.guide[next]) speak(`Step ${next + 1}: ${d.guide[next]}`);
  }

  function prevStep(device) {
    const current = guideStep[device] ?? 0;
    const prev = Math.max(current - 1, 0);
    setGuideStep(p => ({ ...p, [device]: prev }));
    const d = INTEGRATIONS.find(d => d.name === device);
    if (d?.guide[prev]) speak(`Step ${prev + 1}: ${d.guide[prev]}`);
  }

  function readAllSteps(device) {
    const d = INTEGRATIONS.find(d => d.name === device);
    if (!d?.guide?.length) return;
    const text = d.guide.map((s, i) => `Step ${i + 1}: ${s}`).join('. ');
    speak(`Setting up ${device}. ${text}`);
  }

  return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">

        <div style={{ marginBottom: 24 }}>
          <h1 className="qk-h1">🏠 Smart Home</h1>
          <p className="qk-desc">Connect your IoT devices. Tap any device for a voice-guided setup walkthrough.</p>
        </div>

        <div style={{ background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>🎙️</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', marginBottom: 3 }}>Voice-Guided Setup</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tap any device below → tap 🔊 to hear the setup steps read aloud. Each step guides you through the official app integration.</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {INTEGRATIONS.map(device => {
            const isOpen = expanded === device.name;
            const step = guideStep[device.name] ?? 0;
            const hasGuide = device.guide.length > 0;

            return (
              <div key={device.name} className="qk-card" style={{ overflow: 'hidden', borderLeft: `3px solid ${device.color}` }}>
                {/* Header row */}
                <div
                  onClick={() => hasGuide && toggleExpand(device.name)}
                  style={{ padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'center', cursor: hasGuide ? 'pointer' : 'default' }}
                >
                  <div style={{ fontSize: 24, flexShrink: 0 }}>{device.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{device.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{device.brands}</div>
                    {device.voiceHint && (
                      <div style={{ fontSize: 11, color: device.color, marginTop: 4, fontWeight: 600 }}>🎙️ {device.voiceHint}</div>
                    )}
                  </div>
                  {device.status === 'coming_soon' ? (
                    <div style={{ fontSize: 10, color: 'var(--amber)', background: 'var(--amber-dim)', padding: '3px 8px', borderRadius: 10, fontWeight: 700, flexShrink: 0 }}>SOON</div>
                  ) : (
                    <div style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '3px 8px', borderRadius: 10, fontWeight: 700, flexShrink: 0 }}>
                      {isOpen ? 'CLOSE ▲' : 'SETUP ▼'}
                    </div>
                  )}
                </div>

                {/* Setup guide */}
                {isOpen && hasGuide && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 12px' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                        Step {step + 1} of {device.guide.length}
                      </span>
                      <button onClick={() => readAllSteps(device.name)} style={{
                        background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)',
                        borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700,
                        color: 'var(--primary)', cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        🔊 Read all steps
                      </button>
                    </div>

                    {/* Step content */}
                    <div style={{
                      background: 'var(--surface-hover)', borderRadius: 10, padding: '14px 16px',
                      marginBottom: 12, border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: device.color, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Step {step + 1}
                      </div>
                      <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>
                        {device.guide[step]}
                      </div>
                      <button onClick={() => speak(`Step ${step + 1}: ${device.guide[step]}`)} style={{
                        marginTop: 10, background: 'none', border: 'none', color: device.color,
                        fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        🔊 Read this step
                      </button>
                    </div>

                    {/* All steps mini-list */}
                    <div style={{ marginBottom: 12 }}>
                      {device.guide.map((g, i) => (
                        <div key={i} onClick={() => { setGuideStep(p => ({ ...p, [device.name]: i })); speak(`Step ${i + 1}: ${g}`); }}
                          style={{
                            padding: '8px 12px', fontSize: 12, color: i === step ? 'var(--primary)' : 'var(--text-muted)',
                            background: i === step ? 'var(--primary-dim)' : 'transparent',
                            borderRadius: 8, cursor: 'pointer', marginBottom: 3,
                            fontWeight: i === step ? 700 : 400,
                            display: 'flex', gap: 8, alignItems: 'flex-start',
                          }}>
                          <span style={{ color: i < step ? 'var(--accent)' : i === step ? 'var(--primary)' : 'var(--border-strong)', flexShrink: 0, marginTop: 1 }}>
                            {i < step ? '✓' : i === step ? '▶' : '○'}
                          </span>
                          <span>{g}</span>
                        </div>
                      ))}
                    </div>

                    {/* Navigation */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => prevStep(device.name)} disabled={step === 0}
                        className="qk-btn qk-btn-ghost qk-btn-sm" style={{ flex: 1 }}>← Prev</button>
                      {step < device.guide.length - 1 ? (
                        <button onClick={() => nextStep(device.name, device.guide.length)}
                          className="qk-btn qk-btn-primary qk-btn-sm" style={{ flex: 1 }}>Next Step →</button>
                      ) : (
                        <div style={{ flex: 1, padding: '7px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 12, fontWeight: 700, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          ✓ Setup Complete!
                        </div>
                      )}
                    </div>
                    {device.docsUrl && (
                      <a href={device.docsUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 11, color: 'var(--text-subtle)', textDecoration: 'underline' }}>
                        Official developer docs ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 20, padding: '14px 16px', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>📡 How QuietKeep IoT works</div>
          QuietKeep connects to your existing smart home apps — it does not replace them. You keep your current smart home setup, and QuietKeep reads status data and shows it in your Daily Brief or responds to voice commands. No hub required beyond what your device already uses.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Link href="/connectors" className="qk-btn qk-btn-primary qk-btn-sm" style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }}>
            🔌 All Connectors
          </Link>
          <Link href="/more" className="qk-btn qk-btn-ghost qk-btn-sm" style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }}>
            ← Back
          </Link>
        </div>
      </div>
    </div>
  );
                    }
