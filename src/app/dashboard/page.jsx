'use client';
import { useAuth } from '@/lib/context/auth';
import { resolveVoiceCommand } from '@/lib/voiceQueryEngine'; // TASK 5+10
import { parseVoiceIntent, getIntentAction, isQueryIntent, CONFIDENCE_THRESHOLD } from '@/lib/voiceIntentEngine'; // Phase 2-4
import { detectLanguage, setStoredLanguagePreference } from '@/lib/languageRouter'; // Step 2
import { processOfflineCommand } from '@/lib/offlineAssistant'; // Step 4
import { selectAIProvider } from '@/lib/aiRouter'; // Step 4 BYO-AI (advisory)
import { getVoiceMode, setVoiceMode, isWakeMode } from '@/lib/voiceMode'; // Phase 8I
import { acquireVoiceLock, releaseVoiceLock, isVoiceLocked, getCurrentLockSource } from '@/lib/voiceLock'; // Step 3
import { isSensitiveIntent, requireVoiceConfirmation, getSessionTrust, markVoiceVerified } from '@/lib/trustState'; // Step 1
import { recordIntent, tryResolveContinuation, clearContext } from '@/lib/voiceContext'; // Phase 8B
import { speak, speakLow, cancelSpeech, speakError, speakConfirmation, speakFollowUp, VoiceResponses, greetOnLogin, greetOnReturn, processWithWakeWord, setWakeMode } from '@/components/VoiceTalkback'; // Jarvis: speakConfirmation added
import InAppNotifications from '@/components/InAppNotifications';
import ContactPicker from '@/components/ContactPicker';
import PermissionOnboarding from '@/components/PermissionOnboarding';
import { onPermissionChange } from '@/lib/capacitor/voice';
import { startBackgroundServices, stopBackgroundServices } from '@/lib/orchestrator';
import {
  startDashboardGeoWatch, stopDashboardGeoWatch, buildProactiveContext,
} from '@/lib/geo-intelligence'; // Phase 3 Step 2
import { CONFIDENCE_THRESHOLDS } from '@/lib/autonomous-engine'; // Phase 4
import { registerConnectivityHandlers, getOfflineQueueCount } from '@/lib/offlineVoice';
import { safeFetch, apiPost } from '@/lib/safeFetch';
// GAP-5 FIX: realtime subscription for nudge_queue + behaviour_signals
import { startRealtimeLoop } from '@/lib/capacitor/realtime';
// GAP-7 FIX: native Android voice service bridge
import {
  startNativeVoice, stopNativeVoice, isNativeVoiceAvailable, registerNativePush,
  requestMicPermission, requestNotificationPermission, isNativeVoiceRunning,
  isBatteryOptimizationExempt, requestBatteryOptimizationExemption,
  captureWithFallback,
  requestPermissionsOnStart,
  warmUpWebViewMic,
} from '@/lib/capacitor/voice';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/lib/context/language';
import NavbarClient from '@/components/NavbarClient';
import ContextCards from '@/components/ContextCards';
import KeepAIAssist from '@/components/KeepAIAssist';
import AgentSuggestionCard from '@/components/AgentSuggestionCard';
import SuggestionChips from '@/components/SuggestionChips';
import DashboardHero from '@/components/dashboard/DashboardHero';
import DailyBriefCard from '@/components/dashboard/DailyBriefCard';
import TalkAssistantResponse from '@/components/TalkAssistantResponse';
import { learnFromCapture } from '@/lib/tau-learning';
import { checkVoiceCapLimit, incrementVoiceCapture } from '@/lib/usage-gate';
import UpgradeModal from '@/components/UpgradeModal';
import { executeClientAction } from '@/lib/intent-executor';
// SPRINT 2: Centralized write surface with IndexedDB outbox.
// handleEdit → keepsStore.update() (PR #8)
// updateState → keepsStore.transition() (PR #9, this commit)
// storeOutboxCount tracks ALL pending writes (edits + transitions) for the badge.
import { keepsStore } from '@/lib/keeps/store';

const TYPE_EMOJI = {
  note: '📝', reminder: '⏰', contact: '📞', task: '✅',
  purchase: '🛒', expense: '💰', trip: '✈️', document: '📄', draft: '💬',
};

const STATE_COLOR = {
  open: '#22c55e', active: '#3b82f6', blocked: '#ef4444',
  deferred: '#f59e0b', closed: '#64748b',
};

function parseDateTime(text) {
  const t = text.toLowerCase();
  const now = new Date();
  let date = null;
  if (/\btoday\b/.test(t)) { date = new Date(now); }
  else if (/\btomorrow\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 1); }
  else if (/\bday after tomorrow\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 2); }
  else if (/\bnext week\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 7); }
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < days.length; i++) {
    if (new RegExp('\\b' + days[i] + '\\b').test(t)) {
      date = new Date(now); const diff = (i - now.getDay() + 7) % 7 || 7; date.setDate(date.getDate() + diff); break;
    }
  }
  const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  for (let m = 0; m < monthNames.length; m++) {
    const re1 = new RegExp('(\\d{1,2})(?:st|nd|rd|th)?\\s+' + monthNames[m]);
    const re2 = new RegExp(monthNames[m] + '\\s+(\\d{1,2})');
    const match = t.match(re1) || t.match(re2);
    if (match) { date = new Date(now.getFullYear(), m, parseInt(match[1])); if (date < now) { date.setFullYear(date.getFullYear() + 1); } break; }
  }
  if (!date) { const nd = t.match(/(\d{1,2})[\/\-](\d{1,2})/); if (nd) { date = new Date(now.getFullYear(), parseInt(nd[2])-1, parseInt(nd[1])); if (date < now) date.setFullYear(date.getFullYear()+1); } }
  if (!date) return null;
  let hours = 9, minutes = 0;
  const ap = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ap) {
    hours = parseInt(ap[1]); minutes = ap[2] ? parseInt(ap[2]) : 0;
    if (ap[3]==='pm' && hours<12) hours+=12;
    if (ap[3]==='am' && hours===12) hours=0;
  } else {
    const pt = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
    if (pt) { hours=parseInt(pt[1]); minutes=pt[2]?parseInt(pt[2]):0; if(hours<7)hours+=12; }
    else if (/\bmidnight\b/.test(t)){hours=0;minutes=0;}
    else if (/\bnoon\b|\bmidday\b/.test(t)){hours=12;}
    else if (/\bmorning\b/.test(t)){hours=9;}
    else if (/\bafternoon\b/.test(t)){hours=14;}
    else if (/\bevening\b/.test(t)){hours=18;}
    else if (/\bnight\b/.test(t)){hours=20;}
  }
  date.setHours(hours, minutes, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(hours)+':'+pad(minutes);
}

function detectCategory(text) {
  const t = text.toLowerCase();
  if (/call|ring|phone|contact|whatsapp|message/.test(t)) return 'contact';
  if (/buy|order|get|purchase|pick up|shop/.test(t)) return 'task';
  if (/meet|meeting|appointment|doctor|dentist|interview|conference|call at|remind/.test(t)) return 'reminder';
  return 'note';
}

function getAISuggestions(text) {
  const t = text.toLowerCase();
  const suggestions = [];
  if (/call|ring|phone|contact/.test(t)) { suggestions.push({ icon: '📞', text: 'Set as Contact type', action: 'contact' }); suggestions.push({ icon: '⏰', text: 'Add a reminder to follow up', action: 'reminder' }); }
  if (/tomorrow|tonight|morning|evening|monday|tuesday|wednesday|thursday|friday|weekend/.test(t)) suggestions.push({ icon: '⏰', text: 'Set a reminder for this', action: 'reminder' });
  if (/buy|order|get|purchase|pick up/.test(t)) suggestions.push({ icon: '🛒', text: 'Mark as a task to complete', action: 'task' });
  if (/meet|meeting|appointment|doctor|dentist|interview/.test(t)) suggestions.push({ icon: '📅', text: 'Add to reminders with time', action: 'reminder' });
  if (/idea|think|consider|maybe|what if/.test(t)) suggestions.push({ icon: '💡', text: 'Save as a note to revisit', action: 'note' });
  if (/email|send|reply|respond/.test(t)) suggestions.push({ icon: '📧', text: 'Add contact info', action: 'contact' });
  return suggestions.slice(0, 2);
}

function EditKeepModal({ intent, onSave, onClose }) {
  const [content, setContent] = useState(intent.content || '');
  const [reminderAt, setReminderAt] = useState(
    intent.reminder_at ? new Date(intent.reminder_at).toISOString().slice(0, 16) : ''
  );
  const [intentType, setIntentType] = useState(intent.intent_type || 'note');
  const [locationName, setLocationName] = useState(intent.location_name || '');
  const [enableGeo, setEnableGeo] = useState(intent.geo_trigger_enabled || false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function save() {
    if (!content.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(intent.id, {
        content: content.trim(),
        reminder_at: reminderAt || null,
        intent_type: intentType,
        location_name: locationName.trim() || null,
        geo_trigger_enabled: enableGeo,
      });
      setSaving(false);
      onClose();
    } catch (e) {
      setSaveError(e.message || 'Save failed — check your connection');
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 0 0' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px 20px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 540, animation: 'qk-sheet-in 0.25s ease' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>✏️ Edit Keep</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {[['note','📝 Note'],['reminder','⏰ Reminder'],['task','✅ Task'],['goal','🎯 Goal']].map(([v,l]) => (
            <button key={v} onClick={() => setIntentType(v)} style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              background: intentType === v ? 'rgba(99,102,241,0.2)' : 'transparent',
              border: `1px solid ${intentType === v ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
              color: intentType === v ? '#a5b4fc' : '#64748b',
            }}>{l}</button>
          ))}
        </div>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={4}
          style={{ width: '100%', background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'var(--text)', padding: '12px 14px', fontSize: 14, fontFamily: 'inherit', outline: 'none', resize: 'none', boxSizing: 'border-box', lineHeight: 1.6 }}
          placeholder="What's on your mind?"
          autoFocus
        />
        {(intentType === 'reminder' || intent.reminder_at) && (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>⏰ Reminder date & time</label>
            <input type="datetime-local" value={reminderAt} onChange={e => setReminderAt(e.target.value)}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'var(--text)', padding: '10px 14px', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            {reminderAt && <button onClick={() => setReminderAt('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', marginTop: 4 }}>× Remove reminder</button>}
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>📍 Location Trigger</label>
          <input type="text" value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="e.g. Office, Home, Supermarket"
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'var(--text)', padding: '10px 14px', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          {locationName.trim() && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={enableGeo} onChange={e => setEnableGeo(e.target.checked)} style={{ cursor: 'pointer' }} />
              Trigger this keep when I arrive here
            </label>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={save} disabled={saving || !content.trim()} style={{
            flex: 1, padding: '12px', borderRadius: 10, border: 'none',
            background: content.trim() ? 'linear-gradient(135deg,#6366f1,#818cf8)' : 'rgba(255,255,255,0.06)',
            color: content.trim() ? '#fff' : '#475569', fontSize: 14, fontWeight: 700,
            cursor: content.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
          }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {saveError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: 6 }}>⚠️ {saveError}</div>}
          <button onClick={onClose} style={{ padding: '12px 20px', borderRadius: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>Cancel</button>
        </div>
      </div>
      {(isOffline || offlineQueueCount > 0) && (
        <div style={{
          position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
          background: isOffline ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
          border: '1px solid ' + (isOffline ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'),
          color: isOffline ? '#f87171' : '#fbbf24',
          padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600,
          zIndex: 9000, whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          {isOffline ? '📡 Offline' : `📥 ${offlineQueueCount} queued — syncing…`}
        </div>
      )}
    </div>
  );
}

function IntentCard({ intent, onUpdateState, onDelete, onEdit, onFeedback, accessToken, userLanguage }) {
  const [expanded, setExpanded] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const emoji = TYPE_EMOJI[intent.intent_type] || '📝';
  const color = STATE_COLOR[intent.status] || '#22c55e';
  const isClosed = intent.status === 'closed';
  const isPrediction = intent.is_prediction === true;

  return (
    <div className="qk-keep-card" style={{
      opacity: isClosed ? 0.55 : 1,
      animation: 'qk-fade-in 0.25s ease forwards',
      border: isPrediction && !isClosed ? '1px solid rgba(139,92,246,0.4)' : undefined,
      background: isPrediction && !isClosed ? 'rgba(139,92,246,0.04)' : undefined,
    }}>
    {isPrediction && !isClosed && (
      <div style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px 4px', borderBottom: '1px solid rgba(139,92,246,0.15)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span>🔮</span> Predicted by QuietKeep
      </div>
    )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 18, flexShrink: 0, paddingTop: 2 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5, wordBreak: 'break-word', textDecoration: isClosed ? 'line-through' : 'none', opacity: isClosed ? 0.6 : 1 }}>
            {intent.content}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', background: color + '18', padding: '2px 7px', borderRadius: 999, border: `1px solid ${color}30` }}>
              {intent.status}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{intent.intent_type}</span>
            {intent.loop_state && intent.loop_state !== 'closed' && intent.status !== 'closed' && (
              <span style={{ fontSize: 10, fontWeight: 700, color: intent.loop_state === 'abandoned' ? '#ef4444' : intent.stale_at && new Date(intent.stale_at) < new Date() ? '#f59e0b' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {intent.stale_at && new Date(intent.stale_at) < new Date() ? '⚠ stale' : intent.loop_state}
              </span>
            )}
            {intent.reminder_at && (
              <span style={{ fontSize: 10, color: '#818cf8' }}>
                ⏰ {new Date(intent.reminder_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)' }}>
              {new Date(intent.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          </div>
        </div>
        <button onClick={() => setExpanded(!expanded)} style={{ background: expanded ? 'rgba(99,102,241,0.15)' : 'transparent', border: expanded ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent', color: expanded ? '#818cf8' : '#475569', cursor: 'pointer', flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, borderRadius: 8, WebkitTapHighlightColor: 'transparent', transition: 'all 0.18s' }}>
          {expanded ? '▲' : '▼'}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!isClosed && intent.stale_at && new Date(intent.stale_at) < new Date() && (
            <div style={{ width: '100%', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 4, fontSize: 12, color: '#fbbf24' }}>
              ⏳ This keep is stale — is it still relevant?
            </div>
          )}
          {!isClosed && (
            <button onClick={() => { onUpdateState(intent.id, 'closed'); onFeedback && onFeedback(intent.id, 'acted'); }} className="qk-btn qk-btn-sm" style={{ background: isPrediction ? 'rgba(139,92,246,0.15)' : 'rgba(34,197,94,0.12)', border: isPrediction ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(34,197,94,0.3)', color: isPrediction ? '#a78bfa' : '#22c55e' }}>
              {isPrediction ? '✓ Looks right' : '✓ Done'}
            </button>
          )}
          {!isClosed && (
            <button onClick={() => { onFeedback && onFeedback(intent.id, 'dismissed'); if (isPrediction) onUpdateState(intent.id, 'closed'); }} className="qk-btn qk-btn-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
              {isPrediction ? '✕ Not now' : '✗ Skip'}
            </button>
          )}
          {isClosed && (
            <button onClick={() => onUpdateState(intent.id, 'open')} className="qk-btn qk-btn-sm" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc' }}>↩ Reopen</button>
          )}
          <button onClick={() => setShowEdit(true)} className="qk-btn qk-btn-sm" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8' }}>✏️ Edit</button>
          <button onClick={() => onDelete(intent.id)} className="qk-btn qk-btn-sm qk-btn-danger">🗑 Delete</button>
          <button
            onClick={() => {
              try {
                if (speaking) { if (typeof window !== 'undefined') { try { window.speechSynthesis?.cancel(); } catch {} } setSpeaking(false); }
                else {
                  setSpeaking(true); speak(intent.content || '');
                  const poll = setInterval(() => { if (!window.speechSynthesis?.speaking) { setSpeaking(false); clearInterval(poll); } }, 300);
                  setTimeout(() => { setSpeaking(false); clearInterval(poll); }, 30000);
                }
              } catch { setSpeaking(false); }
            }}
            className="qk-btn qk-btn-sm"
            style={{ background: speaking ? 'rgba(14,165,233,0.25)' : 'rgba(14,165,233,0.1)', border: `1px solid rgba(14,165,233,${speaking ? '0.6' : '0.25'})`, color: '#38bdf8' }}
            title={speaking ? 'Stop reading' : 'Read aloud'}
          >
            {speaking ? '⏹ Stop' : '🔊 Read'}
          </button>
        </div>
      )}
      {showEdit && <EditKeepModal intent={intent} onSave={onEdit} onClose={() => setShowEdit(false)} />}
      {expanded && <KeepAIAssist keepId={intent.id} content={intent.content} intentType={intent.intent_type} accessToken={accessToken} userLanguage={userLanguage} />}
    </div>
  );
}

export default function Dashboard() {
  const { user, accessToken, loading: authLoading, refreshToken } = useAuth();
  const router = useRouter();
  const { voiceLang, displayLocale } = useLanguage();

  useEffect(() => {
    if (!voiceLang || typeof window === 'undefined') return;
    try { if (window.AndroidTTS?.setLanguage) window.AndroidTTS.setLanguage(voiceLang); } catch {}
  }, [voiceLang]);

  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [assistMode, setAssistMode] = useState('note');
  const [reminderType, setReminderType] = useState('app');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('open');
  const [openLoopCount, setOpenLoopCount] = useState(0);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [toast, setToast] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoDetected, setAutoDetected] = useState(null);
  const [followUpData, setFollowUpData] = useState(null);
  const [clarificationData, setClarificationData] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeInfo, setUpgradeInfo] = useState({});
  const [talkResponse, setTalkResponse] = useState({ show: false, type: 'saved', language: 'en-IN', params: {} });
  const [userTier, setUserTier] = useState('free');
  const [userIsBeta, setUserIsBeta] = useState(false);
  const [gpsLat, setGpsLat] = useState(null);
  const [gpsLng, setGpsLng] = useState(null);
  const [proactiveCtx, setProactiveCtx] = useState(null);
  const [subKeepsToast, setSubKeepsToast] = useState(null);
  const [predictedCards, setPredictedCards] = useState([]);
  const [strongSuggestions, setStrongSuggestions] = useState([]);
  const [autonomyEnabled, setAutonomyEnabled] = useState(false);
  const [automationPaused, setAutomationPaused] = useState(false);
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [autoHistory, setAutoHistory] = useState([]);
  const [whyPanel, setWhyPanel] = useState(null);
  const [nativeVoiceActive, setNativeVoiceActive] = useState(false);
  const [showVoiceHelp, setShowVoiceHelp] = useState(false);
  const [alwaysOnStatus, setAlwaysOnStatus] = useState('off');
  const [userModel, setUserModel] = useState(null);
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);
  const savingRef = useRef(false);
  const webPushRegisteredRef = useRef(false);
  const nativePushRegisteredRef = useRef(false);
  const batteryPromptedRef = useRef(false);
  const [showBatteryPrompt, setShowBatteryPrompt] = useState(false);
  const [showPermOnboarding, setShowPermOnboarding] = useState(false);
  const [permState, setPermState] = useState({ mic: true, notifications: true, battery: true });
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [isOffline, setIsOffline] = useState(false);
  // SPRINT 2: outbox count — now tracks both edits (update) and transitions
  const [storeOutboxCount, setStoreOutboxCount] = useState(0);
  const [pendingAutoExec, setPendingAutoExec] = useState(null);
  const autoExecTimerRef = useRef(null);

  useEffect(() => {
    const unsub = keepsStore.onOutboxChange((count) => setStoreOutboxCount(count));
    return unsub;
  }, []);

  useEffect(() => {
    const hasBrowserSpeech = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    const hasNativeVoice = !!(window?.Capacitor?.Plugins?.VoicePlugin);
    setVoiceSupported(hasBrowserSpeech || hasNativeVoice);
    if (user?.id) {
      supabase.from('profiles').select('subscription_tier, is_beta').eq('user_id', user.id).maybeSingle()
        .then(({ data }) => { if (data) { setUserTier(data.subscription_tier || 'free'); setUserIsBeta(data.is_beta || false); } })
        .catch(() => {});
    }
  }, [user]);
  useEffect(() => { if (content.length > 5) setSuggestions(getAISuggestions(content)); else setSuggestions([]); }, [content]);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2800); }

  function startVoice() {
    if (!acquireVoiceLock('manual')) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { releaseVoiceLock(); return; }
    const recognition = new SR();
    console.log('[QuietKeep] STT LANG:', voiceLang || 'en-IN');
    recognition.lang = voiceLang || 'en-IN'; recognition.continuous = false; recognition.interimResults = true;
    recognitionRef.current = recognition;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => { setListening(false); releaseVoiceLock(); };
    recognition.onerror = () => { setListening(false); releaseVoiceLock(); };
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      setContent(transcript);
      const detectedDate = parseDateTime(transcript);
      const detectedCategory = detectCategory(transcript);
      const detected = [];
      if (detectedDate) { setRemindAt(detectedDate); detected.push('reminder time'); }
      if (detectedCategory !== 'note') { setAssistMode(detectedCategory); detected.push('type -> ' + detectedCategory); }
      if (detected.length > 0) { setAutoDetected(detected.join(' / ')); setTimeout(() => setAutoDetected(null), 4000); }
    };
    recognition.start();
  }

  function stopVoice() { recognitionRef.current?.stop(); setListening(false); releaseVoiceLock(); }

  async function toggleAutomationPause() {
    const newPaused = !automationPaused;
    setAutomationPaused(newPaused);
    try {
      await safeFetch('/api/settings', { method: 'POST', body: JSON.stringify({ settings: { automation: { paused: newPaused } } }), token: accessToken });
    } catch {}
  }

  async function loadAutoHistory() {
    if (!accessToken) return;
    try {
      const { data, error } = await safeFetch('/api/autonomous/history', { token: accessToken });
      if (!error && Array.isArray(data?.history)) setAutoHistory(data.history);
    } catch {}
  }

  function cancelAutoExec() {
    if (autoExecTimerRef.current) { clearTimeout(autoExecTimerRef.current); autoExecTimerRef.current = null; }
    if (pendingAutoExec?.keep_id && accessToken) {
      fetch(`/api/keeps/${pendingAutoExec.keep_id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ outcome: 'dismissed' }) }).catch(() => {});
    }
    setPendingAutoExec(null);
  }

  function launchAutoExec(autoExecPayload) {
    if (autoExecTimerRef.current) return;
    const { intent_type, contact_name, contact_phone, content: execContent, delay_ms } = autoExecPayload;
    const totalMs = typeof delay_ms === 'number' ? delay_ms : 2500;
    const totalSec = Math.round(totalMs / 1000);
    setPendingAutoExec({ intent_type, contact_name, contact_phone, content: execContent, countdown: totalSec });
    let remaining = totalSec;
    const tick = () => {
      remaining -= 1;
      if (remaining > 0) {
        setPendingAutoExec(prev => prev ? { ...prev, countdown: remaining } : null);
        autoExecTimerRef.current = setTimeout(tick, 1000);
      } else {
        setPendingAutoExec(null);
        autoExecTimerRef.current = null;
        const syntheticIntent = { intent_type, content: execContent || '', contact_phone: contact_phone || null, contact_name: contact_name || null };
        try {
          executeClientAction(syntheticIntent);
          if (autoExecPayload.keep_id && accessToken) {
            fetch(`/api/keeps/${autoExecPayload.keep_id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ outcome: 'acted' }) }).catch(() => {});
          }
        } catch (err) { console.warn('[auto-exec] execution error:', err); }
      }
    };
    autoExecTimerRef.current = setTimeout(tick, 1000);
  }

  async function toggleNativeVoice() {
    if (!isNativeVoiceAvailable()) { showToast('Always-on not supported on this device'); return; }
    if (nativeVoiceActive) {
      setAlwaysOnStatus('off'); await stopNativeVoice(); setNativeVoiceActive(false); releaseVoiceLock();
      showToast('Always-on voice stopped'); return;
    }
    showToast('Requesting microphone permission…');
    let hasMic = await requestMicPermission();
    if (!hasMic) { await new Promise(r => setTimeout(r, 600)); hasMic = await requestMicPermission(); console.log('[QK] mic permission re-check result:', hasMic); }
    if (!hasMic) { showToast('⚠ Microphone permission denied — enable in Settings → Apps → QuietKeep → Permissions'); return; }
    await warmUpWebViewMic();
    await requestNotificationPermission();
    const started = await startNativeVoice({ authToken: accessToken, serverUrl: 'https://quietkeep.com', mode: 'personal', workspaceId: null, languageCode: voiceLang || 'en-IN' });
    if (!started) { showToast('⚠ Could not start voice service — check mic permission in Settings'); console.error('[QK Always-On] startNativeVoice returned false'); return; }
    setAlwaysOnStatus('starting'); showToast('Starting always-on voice…');
    setTimeout(async () => {
      const confirmed = await isNativeVoiceRunning();
      if (confirmed) { setNativeVoiceActive(true); setAlwaysOnStatus('active'); showToast('🎙 Always-on voice active'); }
      else { setNativeVoiceActive(false); setAlwaysOnStatus('error'); showToast('⚠ Always-on not available — mic access failed. Enable in Settings → Apps → QuietKeep'); }
    }, 900);
  }

  function handleContentChange(val) {
    setContent(val);
    if (val.length > 8) {
      const detectedDate = parseDateTime(val);
      if (detectedDate) { setRemindAt(detectedDate); setAutoDetected('reminder time auto-detected'); setTimeout(() => setAutoDetected(null), 3000); }
    }
  }

  const loadIntents = useCallback(async (uid) => {
    const { data, error } = await supabase.from('keeps')
      .select('id,content,intent_type,status,loop_state,stale_at,nudge_count,created_at,reminder_at,tags,contact_name,contact_phone,color,is_pinned,show_on_brief,space_type,ai_summary,workspace_id,is_prediction,prediction_id')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(200);
    if (!error && data) setIntents(data);
    fetch('/api/keeps/loop-count', { headers: { 'Authorization': `Bearer ${accessToken || ''}` } })
      .then(r => r.json()).then(d => setOpenLoopCount(d.count || 0)).catch(() => {});
  }, []);

  async function registerWebPush() {
    if (typeof window === 'undefined') return;
    const sdk = await new Promise(resolve => {
      if (window.OneSignal) { resolve(window.OneSignal); return; }
      let tries = 0;
      const iv = setInterval(() => { if (window.OneSignal) { clearInterval(iv); resolve(window.OneSignal); return; } if (++tries >= 20) { clearInterval(iv); resolve(null); } }, 200);
    });
    if (!sdk) return;
    try {
      if (sdk.Notifications?.permissionNative === 'denied') return;
      let playerId = sdk.User?.PushSubscription?.id || null;
      if (!playerId) { await sdk.Notifications?.requestPermission?.(); await new Promise(r => setTimeout(r, 1500)); playerId = sdk.User?.PushSubscription?.id || null; }
      if (!playerId) return;
      await safeFetch('/api/push/register', { method: 'POST', body: JSON.stringify({ token: playerId, platform: 'web', provider: 'onesignal' }) });
    } catch {}
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }

    if (typeof window !== 'undefined' && window?.Capacitor?.isNativePlatform?.()) {
      setTimeout(async () => {
        try { const running = await isNativeVoiceRunning(); if (running) { setNativeVoiceActive(true); setAlwaysOnStatus('active'); console.log('[QK Always-On] restored: service was already running'); } } catch {}
      }, 1500);
    }

    if (typeof window !== 'undefined' && window?.Capacitor?.getPlatform?.() === 'android' && !localStorage.getItem('qk_perm_done')) {
      setTimeout(() => setShowPermOnboarding(true), 1200);
    }

    if (typeof window !== 'undefined' && window?.Capacitor?.isNativePlatform?.() && !localStorage.getItem('qk_perms_requested')) {
      setTimeout(() => {
        requestPermissionsOnStart().then((result) => {
          if (result.mic) { localStorage.setItem('qk_perms_requested', '1'); console.log('[QK] Permissions granted on start — mic:', result.mic, 'notifications:', result.notifications, 'location:', result.location); }
          else console.log('[QK] Mic not granted on start — will retry next open');
        }).catch(() => {});
      }, 1800);
    }

    const unsubPerms = onPermissionChange(state => setPermState(state));
    loadIntents(user.id).finally(() => {
      setLoading(false);
      setTimeout(() => { const keeps = JSON.parse(localStorage.getItem('qk_keep_count') || '0'); greetOnLogin(user, Number(keeps), 0); }, 800);
    });

    safeFetch('/api/user/model', { token: accessToken }).then(({ data: d }) => { if (d?.exists && d?.model) setUserModel(d.model); }).catch(() => {});

    if (!webPushRegisteredRef.current) { webPushRegisteredRef.current = true; registerWebPush().catch(() => {}); }
    if (!nativePushRegisteredRef.current) { nativePushRegisteredRef.current = true; registerNativePush(accessToken, '').catch(() => {}); }

    startBackgroundServices(accessToken, 'https://quietkeep.com');

    safeFetch('/api/settings', { token: accessToken }).then(({ data }) => {
      if (data?.settings?.automation?.paused === true) setAutomationPaused(true);
    }).catch(() => {});

    startDashboardGeoWatch(accessToken,
      (keeps, locationName) => { const ctx = buildProactiveContext(keeps, locationName); if (ctx) setProactiveCtx(ctx); },
      (lat, lng) => { setGpsLat(lat); setGpsLng(lng); }
    );

    const unsubConnectivity = registerConnectivityHandlers(accessToken,
      (synced) => { setOfflineQueueCount(0); showToast(`✓ ${synced} offline ${synced === 1 ? 'keep' : 'keeps'} synced`); },
      () => setIsOffline(true)
    );
    setOfflineQueueCount(getOfflineQueueCount());

    if (!batteryPromptedRef.current && typeof window !== 'undefined' && window?.Capacitor?.getPlatform?.() === 'android' && !localStorage.getItem('qk_battery_exempt_prompted')) {
      batteryPromptedRef.current = true;
      setTimeout(async () => {
        try { const exempt = await isBatteryOptimizationExempt(); if (exempt) localStorage.setItem('qk_battery_exempt_prompted', '1'); else setShowBatteryPrompt(true); } catch {}
      }, 2000);
    }

    const unsubRealtime = startRealtimeLoop(supabase, user.id, (nudge) => {
      if (typeof window !== 'undefined') {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid rgba(99,102,241,0.4);color:#e2e8f0;padding:10px 20px;border-radius:99px;font-size:13px;z-index:9999;font-family:inherit;';
        toast.textContent = `🔔 ${nudge.title || 'New nudge'}`;
        document.body.appendChild(toast);
        setTimeout(() => { try { toast.remove(); } catch {} }, 4000);
      }
    });

    return () => { unsubRealtime(); unsubPerms(); stopBackgroundServices(); stopDashboardGeoWatch(); unsubConnectivity(); if (autoExecTimerRef.current) clearTimeout(autoExecTimerRef.current); };
  }, [user, authLoading, accessToken, router, loadIntents]);

  useEffect(() => {
    if (!accessToken || !user) return;
    let cancelled = false;
    async function loadPredictions() {
      try {
        const params = new URLSearchParams();
        if (typeof gpsLat === 'number') params.set('lat', String(gpsLat));
        if (typeof gpsLng === 'number') params.set('lng', String(gpsLng));
        const { data, error } = await safeFetch(`/api/agent/predict?${params}`, { token: accessToken });
        if (!cancelled && !error && Array.isArray(data?.predicted)) setPredictedCards(data.predicted.slice(0, 2));
        try {
          const autoRes = await safeFetch('/api/autonomous/evaluate', { method: 'POST', body: JSON.stringify({ lat: typeof gpsLat === 'number' ? gpsLat : undefined, lng: typeof gpsLng === 'number' ? gpsLng : undefined }), token: accessToken });
          if (!cancelled && !autoRes.error) {
            setStrongSuggestions(autoRes.data?.strongSuggestions?.slice(0, 2) || []);
            setAutonomyEnabled((autoRes.data?.autoTriggers?.length ?? 0) > 0);
            if (!automationPaused) {
              for (const trigger of (autoRes.data?.autoTriggers || [])) {
                launchAutoExec({ keep_id: null, intent_type: trigger.intentType, confidence: trigger.score, contact_name: trigger.contactName || null, contact_phone: null, content: trigger.label, delay_ms: 5000 });
                break;
              }
            }
          }
        } catch {}
      } catch {}
    }
    loadPredictions();
    return () => { cancelled = true; };
  }, [accessToken, user, gpsLat, gpsLng]);

  useEffect(() => {
    var App = window && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App) return;
    var listenerHandle = null;
    App.addListener('backButton', function(data) {
      if (data && data.canGoBack) window.history.back();
      else { try { if (App.minimizeApp) App.minimizeApp(); } catch (e) { console.log('[QK] minimizeApp not available'); } }
    }).then(function(handle) { listenerHandle = handle; });
    return function() { if (listenerHandle) listenerHandle.remove(); };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onLotusWake(e) {
      console.log('[QK] lotus_wake from:', e?.detail?.source);
      if (isVoiceLocked()) { console.log('[QK] lotus_wake ignored — voice locked by:', getCurrentLockSource?.() ?? 'unknown'); return; }
      if (!acquireVoiceLock('wake')) return;
      startVoice(); speak('Listening.');
    }
    window.addEventListener('lotus_wake', onLotusWake);
    return () => window.removeEventListener('lotus_wake', onLotusWake);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === 'undefined') return;
    async function onResume() {
      if (document.visibilityState !== 'visible') return;
      if (!window?.Capacitor?.isNativePlatform?.()) return;
      try {
        const running = await isNativeVoiceRunning();
        if (running && !nativeVoiceActive) { setNativeVoiceActive(true); setAlwaysOnStatus('active'); }
        else if (!running && nativeVoiceActive) { setNativeVoiceActive(false); setAlwaysOnStatus('off'); releaseVoiceLock(); }
      } catch {}
    }
    document.addEventListener('visibilitychange', onResume);
    return () => document.removeEventListener('visibilitychange', onResume);
  }, [nativeVoiceActive]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (savingRef.current || !content.trim() || !user) return;
    let commandText = content.trim();
    if (listening) {
      const langResult = detectLanguage(commandText);
      if (langResult.confidence > 0.65 && langResult.locale !== 'en-IN') setStoredLanguagePreference(langResult.locale);
      if (!navigator.onLine) {
        const offlineResult = processOfflineCommand(commandText);
        if (offlineResult.handled) { if (offlineResult.response) speak(offlineResult.response); if (offlineResult.navigate) router.push(offlineResult.navigate); setContent(''); setSaving(false); savingRef.current = false; return; }
      }
      if (isWakeMode()) {
        const wakeResult = processWithWakeWord(content.trim());
        if (!wakeResult.triggered) { setContent(''); return; }
        commandText = wakeResult.command || content.trim();
      }
      if (/\bunlock\b|\bpasscode\b|\bvoice\s+pin\b/i.test(commandText)) {
        try {
          const { validateVoicePin, isVoicePinEnabled } = await import('@/lib/voiceUnlock');
          if (isVoicePinEnabled()) {
            const result = validateVoicePin(commandText);
            if (result.success) { markVoiceVerified(); speak('Voice PIN accepted. You are verified.'); }
            else if (result.reason === 'locked_out') speak(`Too many attempts. Try again in ${result.lockoutSeconds} seconds.`);
            else if (result.reason === 'incorrect') speak(`Incorrect PIN. ${result.attemptsRemaining} attempt${result.attemptsRemaining !== 1 ? 's' : ''} remaining.`);
            else if (result.reason === 'no_digits') speak('Please say your PIN number clearly. For example: Lotus unlock 1 2 3 4.');
            setContent(''); setSaving(false); savingRef.current = false; return;
          }
        } catch {}
      }
      const continuation = tryResolveContinuation(commandText);
      if (continuation.isContinuation && continuation.intentType) {
        speak('Refining that.'); resolveVoiceCommand(continuation.command || commandText, { supabase, user, accessToken, router, speak }).catch(() => {});
        setContent(''); setSaving(false); savingRef.current = false; return;
      }
      const intent = parseVoiceIntent(commandText);
      const intentConf = intent.confidence ?? 1.0;
      if (intent.handled && intentConf >= CONFIDENCE_THRESHOLD) {
        if (isSensitiveIntent(intent.intentType, commandText)) {
          const trust = getSessionTrust();
          if (!trust.voice_verified && !trust.biometric_verified) {
            const confirmed = requireVoiceConfirmation(commandText);
            if (!confirmed) { speak("This action needs confirmation. Say 'Lotus confirm' or 'Yes proceed' to continue."); setContent(''); setSaving(false); savingRef.current = false; return; }
          }
          markVoiceVerified();
        }
        if (intent.response) speak(intent.response);
        const action = getIntentAction(intent.actionKey, { router, setWakeMode: (enabled) => setVoiceMode(enabled ? 'wake' : 'manual', 'voice_cmd') });
        action?.();
        if (isQueryIntent(intent.intentType)) resolveVoiceCommand(commandText, { supabase, user, accessToken, router, speak }).catch(() => {});
        recordIntent(intent.intentType, intent.entities, commandText);
        if (intent.intentType === 'query_bills') speakFollowUp("Do you want to open the bills page for details?");
        else if (intent.intentType === 'query_reminders' && intent.entities?.date === 'today') speakFollowUp("Say: Lotus open reminders — to see the full list.");
        try { const aiProv = selectAIProvider({ tier: tier || 'free' }); if (aiProv.id !== 'default') sessionStorage.setItem('qk_ai_provider', aiProv.id); } catch (_) {}
        setContent(''); setSaving(false); savingRef.current = false; return;
      }
    }
    if (listening && commandText && commandText === content.trim()) {
      const lower = commandText.toLowerCase().trim();
      if (/\bwhat\s+can\s+you\s+do\b|\bhelp\b|\bcommands?\b|\bshow\s+help\b/i.test(lower)) {
        speak("Here is what I can do. Tasks: say Lotus add task, or just speak any task. Reminders: say Lotus remind me, or Lotus show reminders. Finance: say Lotus pending bills, Lotus show expenses, or Lotus subscriptions. Navigation: say Lotus open calendar, open reminders, open finance, or open settings. Keeps: say Lotus how many keeps, or just speak a note to save it. Voice control: say Lotus confirm for sensitive actions, or Lotus unlock followed by your PIN.");
        setShowVoiceHelp(true); setTimeout(() => setShowVoiceHelp(false), 8000); setContent(''); setSaving(false); savingRef.current = false; return;
      }
      const lowerCmd = commandText.toLowerCase();
      if (lowerCmd.includes('lotus') || lowerCmd.includes('add') || lowerCmd.includes('set')) speak("I heard you, but could not match a command. Try saying: Lotus help for a full list.");
      else speakError();
    }
    const profile = await supabase.from('profiles').select('subscription_tier, is_beta').eq('user_id', user.id).maybeSingle();
    const tier = profile?.data?.subscription_tier || 'free';
    const isBeta = profile?.data?.is_beta || false;
    const capCheck = await checkVoiceCapLimit({ supabase, userId: user.id, tier, isBeta });
    if (!capCheck.allowed) { setUpgradeInfo({ used: capCheck.used, limit: capCheck.limit, feature: 'voice captures' }); setShowUpgrade(true); return; }
    savingRef.current = true; setSaving(true);
    try {
      incrementVoiceCapture({ supabase, userId: user.id });
      const freshToken = await refreshToken();
      const res = await safeFetch('/api/voice/capture', {
        method: 'POST',
        headers: { 'X-AI-Provider': (() => { try { return sessionStorage.getItem('qk_ai_provider') || 'default'; } catch { return 'default'; } })() },
        body: JSON.stringify({ transcript: commandText, source: listening ? 'voice' : 'text', workspace_id: null, language: voiceLang || 'en-IN' }),
        token: freshToken,
      });
      if (res.error) {
        const errStr = String(res.error || '');
        if (errStr.toLowerCase().includes('network') || errStr.toLowerCase().includes('fetch') || errStr.toLowerCase().includes('failed')) {
          const fallback = await captureWithFallback(commandText, freshToken, { source: listening ? 'voice' : 'text', language: voiceLang || 'en-IN' });
          if (fallback.queued) { setOfflineQueueCount(prev => prev + 1); showToast('📥 Saved offline — syncs when connected'); if (fallback.ttsResponse) speak(fallback.ttsResponse); setContent(''); }
          else showToast('Error: ' + res.error);
        } else showToast('Error: ' + res.error);
        return;
      }
      const data = res.data;
      const saved = data.keep || data.intent;
      if (saved) {
        setIntents(prev => [saved, ...prev]);
        learnFromCapture({ supabase, userId: user.id, intentType: saved.intent_type || 'note', transcript: content.trim(), language: voiceLang || 'en-IN', confidence: saved.confidence || 0, locationName: saved.location_name });
        if (data.tts_response) speak(data.tts_response); else VoiceResponses.keepSaved(content);
        if (data.follow_up) setFollowUpData(data.follow_up);
        if (data.needs_followup && data.clarification && !data.follow_up) setClarificationData({ question: data.clarification, human_type: data.human_type, confidence: data.keep?.confidence });
        if (data.sub_keeps?.length > 0) { const labels = data.sub_keeps.map(k => k.intent_type).join(', '); setSubKeepsToast(`✓ ${data.sub_keeps.length + 1} keeps saved: ${labels}`); setTimeout(() => setSubKeepsToast(null), 4000); }
        if (data.auto_exec && !data.follow_up) launchAutoExec(data.auto_exec);
        setContent(''); setRemindAt(''); setContactInfo(''); setReminderType('app'); setSuggestions([]); setAutoDetected(null);
        if (data.suggest_save && data.keep?.location_name) showToast(`📍 Save "${data.keep.location_name}" to activate geo reminder`);
        else { showToast('✓ Kept!'); setTalkResponse({ show: true, type: saved.intent_type === 'reminder' ? 'reminder' : saved.intent_type === 'expense' ? 'expense' : 'saved', language: voiceLang || 'en-IN', params: { time: saved.reminder_at || '', amount: saved.content?.match(/\d+/)?.[0] || '' } }); }
      }
    } catch (e) { showToast('Error: ' + e.message); }
    finally { setSaving(false); setTimeout(() => { savingRef.current = false; }, 800); }
  }

  // SPRINT 2 PHASE 4: updateState → keepsStore.transition()
  // Removes the direct safeFetch to /api/keeps/[id]/transition.
  // keepsStore.transition() commits to IndexedDB first (guaranteed delivery),
  // then syncs to /api/keeps/[id]/transition with exponential backoff.
  // Outbox badge now tracks transitions alongside edits.
  // SW reminder scheduling still fires inline after optimistic UI update.
  async function updateState(id, state) {
    // Optimistic UI update immediately — don't wait for server
    setIntents(prev => prev.map(k => k.id === id ? { ...k, status: state } : k));
    showToast(state === 'closed' ? '✓ Marked done!' : 'Moved to ' + state);

    try {
      const result = await keepsStore.transition(id, state);
      // Schedule local SW reminder notification if keep has reminder_at
      if (result?.keep?.reminder_at) {
        const fireAt = new Date(result.keep.reminder_at).getTime();
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SCHEDULE_REMINDER', id: result.keep.id, text: result.keep.content || '', fireAt });
        }
      }
    } catch {
      // keepsStore queues to IndexedDB on failure — reload will reflect server state
      // when outbox syncs. No fallback write needed; store handles recovery.
      await loadIntents(user.id);
    }
  }

  async function handleDelete(id) {
    await supabase.from('keeps').delete().eq('id', id);
    try { await supabase.from('audit_log').insert({ user_id: user.id, action: 'keep_deleted', intent_id: id, service: 'dashboard', details: {} }); } catch {}
    showToast('Deleted'); VoiceResponses.keepDeleted(); await loadIntents(user.id);
  }

  // SPRINT 2 PHASE 3: handleEdit → keepsStore.update()
  async function handleEdit(id, updates) {
    if (!id || !updates) throw new Error('Invalid edit params');
    const safeUpdates = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    if (Object.keys(safeUpdates).length === 0) return;
    try {
      await keepsStore.update(id, safeUpdates);
      setIntents(prev => prev.map(k => k.id === id ? { ...k, ...safeUpdates } : k));
      showToast('Keep updated ✓'); VoiceResponses.keepUpdated();
    } catch (e) {
      const msg = e.message || 'Could not update keep'; showToast('⚠ ' + msg); throw new Error(msg);
    }
  }

  async function handleFeedback(id, outcome) {
    try { await apiPost(`/api/keeps/${id}/feedback`, { outcome, latency_seconds: null }, accessToken); } catch {}
  }

  const openIntents = intents.filter(i => i.status !== 'closed');
  const closedIntents = intents.filter(i => i.status === 'closed');
  const filterIntents = (list) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(i => i.content?.toLowerCase().includes(q) || i.intent_type?.toLowerCase().includes(q) || i.status?.toLowerCase().includes(q));
  };
  const reminderIntents = intents.filter(i => i.intent_type === 'reminder' && i.status !== 'closed');
  const displayIntents = filterIntents(activeTab === 'open' ? openIntents : activeTab === 'reminder' ? reminderIntents : closedIntents);

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div className="qk-spinner" />
        <span style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading your keeps…</span>
      </div>
    );
  }

  return (
    <>
      <NavbarClient />
      <InAppNotifications userId={user?.id} />

      {followUpData && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#1e1e2e', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 16, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>🤔 One more thing</p>
            <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 20, lineHeight: 1.6 }}>{followUpData.follow_up}</p>
            {followUpData.action_hint === 'disambiguate_contact' && followUpData.contacts?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {followUpData.contacts.map((c) => (
                  <button key={c.id} onClick={() => { if (c.phone) window.location.href = `tel:${c.phone}`; setFollowUpData(null); }}
                    style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#e2e8f0', fontSize: 13, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'inherit' }}>
                    <span>{c.name}{c.relation ? ` (${c.relation})` : ''}</span>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>{c.phone || 'no phone'}</span>
                  </button>
                ))}
              </div>
            )}
            {followUpData.action_hint === 'call_or_remind' && followUpData.contact?.phone && (
              <button onClick={() => { window.location.href = `tel:${followUpData.contact.phone}`; setFollowUpData(null); }}
                style={{ width: '100%', padding: '12px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 10, fontFamily: 'inherit' }}>
                📞 Call {followUpData.contact.name} Now
              </button>
            )}
            <button onClick={() => setFollowUpData(null)} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Got it, dismiss</button>
          </div>
        </div>
      )}

      {clarificationData && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#1a1a2e', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 16, padding: 24, maxWidth: 360, width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>🧠</span>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#fbbf24', margin: 0 }}>Just to confirm</p>
                <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>Saved as {clarificationData.human_type || 'note'} · confidence {Math.round((clarificationData.confidence || 0) * 100)}%</p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 20, lineHeight: 1.6 }}>{clarificationData.question}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setClarificationData(null); loadIntents(user?.id); }}
                style={{ flex: 1, padding: '11px 0', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, color: '#fbbf24', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                ✓ Yes, that's right
              </button>
              <button onClick={() => setClarificationData(null)}
                style={{ flex: 1, padding: '11px 0', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#64748b', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {subKeepsToast && (
        <div style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#6ee7b7', padding: '6px 16px', borderRadius: 99, fontSize: 12, fontWeight: 600, zIndex: 9001, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {subKeepsToast}
        </div>
      )}

      {whyPanel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 20px' }} onClick={() => setWhyPanel(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 18, padding: '22px 20px', maxWidth: 380, width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>🔍 Why this suggestion?</div>
              <button onClick={() => setWhyPanel(null)} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 12, lineHeight: 1.5 }}>{whyPanel.message}</div>
            <div style={{ fontSize: 12, color: '#a5b4fc', marginBottom: 14, lineHeight: 1.6 }}>{whyPanel.why_text}</div>
            {typeof whyPanel.score === 'number' && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 5 }}>
                  <span>Confidence</span>
                  <span style={{ color: whyPanel.score >= 0.8 ? '#6ee7b7' : whyPanel.score >= 0.6 ? '#fbbf24' : '#94a3b8', fontWeight: 700 }}>{Math.round(whyPanel.score * 100)}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 3, width: `${Math.round(whyPanel.score * 100)}%`, background: whyPanel.score >= 0.8 ? '#6ee7b7' : whyPanel.score >= 0.6 ? '#fbbf24' : '#94a3b8', transition: 'width 0.4s ease' }} />
                </div>
              </div>
            )}
            {whyPanel.signals && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Signals</div>
                {Object.entries(whyPanel.signals).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', width: 80, flexShrink: 0, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 2, width: `${Math.round((v ?? 0) * 100)}%`, background: 'rgba(99,102,241,0.7)' }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-subtle)', width: 30, textAlign: 'right' }}>{Math.round((v ?? 0) * 100)}%</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setWhyPanel(null)} style={{ width: '100%', padding: '10px', borderRadius: 10, border: 'none', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Got it</button>
          </div>
        </div>
      )}

      {showReviewPanel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 20px' }} onClick={() => setShowReviewPanel(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 18, padding: '20px', maxWidth: 380, width: '100%', maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>📋 Last auto actions</div>
              <button onClick={() => setShowReviewPanel(false)} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            {autoHistory.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-subtle)', textAlign: 'center', padding: '20px 0' }}>No automated actions yet</div>
            ) : autoHistory.map((entry, i) => (
              <div key={i} style={{ padding: '11px 13px', marginBottom: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{entry.decision === 'auto_trigger' ? '⚡ Auto-triggered' : '💡 Suggested'}{' '}{entry.inputs?.intentType || entry.inputs?.label || ''}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{entry.created_at ? new Date(entry.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : ''}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.4 }}>{entry.reason}</div>
                <div style={{ fontSize: 10, color: '#6366f1', marginTop: 4 }}>Confidence: {Math.round((entry.priority_score || 0) * 100)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingAutoExec && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#0f172a', border: '1.5px solid rgba(34,197,94,0.5)', borderRadius: 18, padding: '28px 24px', maxWidth: 340, width: '100%', textAlign: 'center', boxShadow: '0 8px 48px rgba(34,197,94,0.15)' }}>
            <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
              {pendingAutoExec.intent_type === 'contact' ? '📞 Auto-Calling' : pendingAutoExec.intent_type === 'navigation' || pendingAutoExec.intent_type === 'trip' ? '🗺️ Opening Maps' : pendingAutoExec.intent_type === 'purchase' ? '🛒 Opening Shop' : '⚡ Executing'}
            </div>
            <div style={{ fontSize: 15, color: '#e2e8f0', fontWeight: 600, marginBottom: 6, wordBreak: 'break-word' }}>{pendingAutoExec.contact_name || pendingAutoExec.content?.slice(0, 60)}</div>
            {pendingAutoExec.contact_phone && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>{pendingAutoExec.contact_phone}</div>}
            <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px', background: `conic-gradient(#22c55e ${(pendingAutoExec.countdown / 3) * 100}%, rgba(34,197,94,0.12) 0%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: '#22c55e' }}>{pendingAutoExec.countdown}</div>
            </div>
            <button onClick={cancelAutoExec} style={{ width: '100%', padding: '12px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✕ Cancel</button>
          </div>
        </div>
      )}

      {showBatteryPrompt && (
        <div style={{ position:'fixed', bottom:80, left:12, right:12, zIndex:9998, background:'linear-gradient(135deg,#1e1b4b,#1e293b)', border:'1px solid rgba(139,92,246,0.5)', borderRadius:16, padding:'16px 18px', boxShadow:'0 8px 32px rgba(0,0,0,0.5)', display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10}}>
            <div style={{flex:1}}>
              <p style={{margin:0, fontSize:14, fontWeight:700, color:'#e2e8f0', lineHeight:1.4}}>⚡ Prevent App Freezing</p>
              <p style={{margin:'6px 0 0', fontSize:12, color:'#94a3b8', lineHeight:1.5}}>To ensure QuietKeep works reliably, disable battery optimization for this app.</p>
            </div>
            <button onClick={() => { setShowBatteryPrompt(false); localStorage.setItem('qk_battery_exempt_prompted','1'); }} style={{background:'none',border:'none',color:'#64748b',fontSize:20,cursor:'pointer',lineHeight:1,padding:'0 2px',flexShrink:0}} aria-label="Dismiss">×</button>
          </div>
          <div style={{display:'flex', gap:8}}>
            <button onClick={async () => { try { await requestBatteryOptimizationExemption(); } catch {} setShowBatteryPrompt(false); localStorage.setItem('qk_battery_exempt_prompted','1'); }} style={{flex:1, padding:'11px 16px', background:'linear-gradient(135deg,#7c3aed,#6d28d9)', border:'none', borderRadius:10, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit'}}>Disable Now</button>
            <button onClick={() => setShowBatteryPrompt(false)} style={{padding:'11px 14px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, color:'#64748b', fontSize:13, cursor:'pointer', fontFamily:'inherit'}}>Later</button>
          </div>
        </div>
      )}

      {showPermOnboarding && (
        <PermissionOnboarding
          onComplete={() => { setShowPermOnboarding(false); localStorage.setItem('qk_perm_done', '1'); }}
          onSkip={() => { setShowPermOnboarding(false); localStorage.setItem('qk_perm_done', '1'); }}
        />
      )}

      {toast && <div className="qk-toast">{toast}</div>}

      <div className="qk-page">
        <div className="qk-container">

          <DashboardHero
            userName={user?.user_metadata?.full_name || user?.email?.split('@')[0]}
            topReminder={intents.find(k => k.intent_type === 'reminder' && k.status === 'open')}
            onReminderTap={() => router.push('/reminders')}
          />

          <SuggestionChips supabase={supabase} userId={user?.id} onChipTap={(action, prefill) => {
            if (action === 'navigate' && prefill?.path) router.push(prefill.path);
            else if (action === 'health') router.push('/health');
            else if (action === 'finance') router.push('/finance');
            else if (action === 'reminder') router.push('/reminders');
          }} />

          <ContextCards userId={user?.id} />
          <DailyBriefCard userId={user?.id} tier={userTier} isBeta={userIsBeta} />

          {openLoopCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, color: '#d97706' }}>
              <span style={{ fontWeight: 700 }}>⚠ {openLoopCount}</span>
              <span>open {openLoopCount === 1 ? 'loop' : 'loops'} — stale, unresolved</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
            {[{ label: 'Open', value: openIntents.length, color: '#6366f1' }, { label: 'Done', value: closedIntents.length, color: '#10b981' }, { label: 'Total', value: intents.length, color: 'var(--text-muted)' }].map((s, i) => (
              <div key={i} className="qk-stat">
                <div className="qk-stat-value" style={{ color: s.color }}>{s.value}</div>
                <div className="qk-stat-label">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="qk-card" style={{ padding: 18, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em' }}>+ New Keep</span>
                {storeOutboxCount > 0 && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#fbbf24', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', padding: '1px 6px', borderRadius: 99, letterSpacing: '0.04em' }}>
                    ↑ {storeOutboxCount} syncing
                  </span>
                )}
              </div>
              {voiceSupported && (
                <button onClick={listening ? stopVoice : startVoice} className="qk-btn qk-btn-sm" style={{ background: listening ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.12)', border: `1px solid ${listening ? 'rgba(239,68,68,0.4)' : 'rgba(99,102,241,0.3)'}`, color: listening ? '#ef4444' : '#a5b4fc' }}>
                  {listening ? (<><span style={{ width: 7, height: 7, background: '#ef4444', borderRadius: '50%', display: 'inline-block', animation: 'qk-pulse 1s ease infinite' }} /> Stop</>) : '🎙 Voice'}
                </button>
              )}
              {isNativeVoiceAvailable() && (
                <button onClick={toggleNativeVoice} className="qk-btn qk-btn-sm" style={{ background: nativeVoiceActive ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.12)', border: `1px solid ${nativeVoiceActive ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.3)'}`, color: nativeVoiceActive ? '#ef4444' : '#10b981' }}>
                  {nativeVoiceActive ? '🎙 Always-On: Stop' : alwaysOnStatus === 'starting' ? '⏳ Starting…' : alwaysOnStatus === 'error' ? '⚠ Always-On (Error)' : '🎙 Always-On'}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              {[{ key: 'manual', label: '🎙️ Manual', desc: 'Tap to speak' }, { key: 'wake', label: '🌸 Wake Word', desc: 'Say Lotus first' }].map(m => {
                const active = getVoiceMode() === m.key;
                return (
                  <button key={m.key} onClick={() => setVoiceMode(m.key, 'ui_toggle')} title={m.desc} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, cursor: 'pointer', background: active ? 'rgba(99,102,241,0.18)' : 'transparent', border: `1px solid ${active ? 'rgba(99,102,241,0.5)' : 'var(--border)'}`, color: active ? '#a5b4fc' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>
                    {m.label}
                  </button>
                );
              })}
            </div>

            {isWakeMode() && !nativeVoiceActive && isNativeVoiceAvailable() && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '7px 12px' }}>
                <span style={{ fontSize: 11, color: '#f59e0b' }}>💡 Enable Always-On to use "Lotus" wake word hands-free</span>
              </div>
            )}

            {listening && isWakeMode() && !autoDetected && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ width: 7, height: 7, background: '#10b981', borderRadius: '50%', display: 'inline-block', animation: 'qk-pulse 1.2s ease infinite', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#10b981' }}>Listening for "Lotus"…</span>
              </div>
            )}
            {autoDetected && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ fontSize: 12, color: '#a5b4fc' }}>✨ Auto-detected: {autoDetected}</span>
              </div>
            )}

            {!listening && !content && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 2 }}>Try:</span>
                {[{ label: 'Lotus show reminders', cmd: 'Lotus show reminders' }, { label: 'Lotus pending bills', cmd: 'Lotus pending bills' }, { label: 'What can you do?', cmd: 'what can you do' }].map(h => (
                  <button key={h.label} onClick={() => { setContent(h.cmd); textareaRef.current?.focus(); }} style={{ fontSize: 10, padding: '3px 9px', borderRadius: 99, cursor: 'pointer', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#a5b4fc', fontFamily: 'inherit' }}>{h.label}</button>
                ))}
              </div>
            )}

            {showVoiceHelp && (
              <div style={{ marginBottom: 10, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc' }}>🎙 Voice Commands</span>
                  <button onClick={() => setShowVoiceHelp(false)} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 14 }}>×</button>
                </div>
                {[{ cat: '📋 Tasks', cmds: ['Add task buy groceries', 'Lotus add task call Suresh'] }, { cat: '⏰ Reminders', cmds: ['Lotus remind me at 5pm', 'Lotus show reminders'] }, { cat: '💰 Finance', cmds: ['Lotus pending bills', 'Lotus show expenses'] }, { cat: '🧭 Navigate', cmds: ['Lotus open calendar', 'Lotus open settings'] }].map(({ cat, cmds }) => (
                  <div key={cat} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{cat}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {cmds.map(cmd => <button key={cmd} onClick={() => { setContent(cmd); setShowVoiceHelp(false); textareaRef.current?.focus(); }} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', fontFamily: 'inherit' }}>{cmd}</button>)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <textarea ref={textareaRef} value={content} onChange={e => handleContentChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); handleSave(); } }} placeholder="What do you want to keep…" rows={3} className="qk-input" style={{ resize: 'none', lineHeight: 1.5 }} />

            {suggestions.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 6 }}>Smart suggestions:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {suggestions.map((s, i) => <button key={i} onClick={() => { setAssistMode(s.action); showToast('Set to ' + s.action); }} className="qk-btn qk-btn-sm" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}>{s.icon} {s.text}</button>)}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'block', marginBottom: 5 }}>Remind at {remindAt && <span style={{ color: '#6366f1' }}>✓</span>}</label>
                <input type="datetime-local" value={remindAt} onChange={e => setRemindAt(e.target.value)} className="qk-input" style={{ padding: '8px 10px', fontSize: 12 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'block', marginBottom: 5 }}>Type</label>
                <select value={assistMode} onChange={e => setAssistMode(e.target.value)} className="qk-input" style={{ padding: '8px 10px', fontSize: 12 }}>
                  <option value="note">Note</option><option value="reminder">Reminder</option><option value="contact">Contact</option><option value="task">Task</option><option value="purchase">Purchase</option><option value="expense">Expense</option><option value="trip">Trip</option><option value="document">Document</option>
                </select>
              </div>
            </div>

            {remindAt && (
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'block', marginBottom: 8 }}>How to remind you?</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[{ value: 'app', label: 'App' }, { value: 'alarm', label: 'Alarm' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'email', label: 'Email' }].map(opt => (
                    <button key={opt.value} onClick={() => setReminderType(opt.value)} className="qk-btn qk-btn-sm" style={{ background: reminderType === opt.value ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${reminderType === opt.value ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`, color: reminderType === opt.value ? '#a5b4fc' : '#64748b' }}>{opt.label}</button>
                  ))}
                </div>
                {reminderType === 'whatsapp' && <div style={{ marginTop: 8, fontSize: 11, color: '#f59e0b', padding: '6px 10px', background: 'rgba(245,158,11,0.08)', borderRadius: 6, border: '1px solid rgba(245,158,11,0.2)' }}>WhatsApp reminder opens a draft at reminder time. You tap Send.</div>}
                {reminderType === 'alarm' && <div style={{ marginTop: 8, fontSize: 11, color: '#22c55e', padding: '6px 10px', background: 'rgba(34,197,94,0.08)', borderRadius: 6, border: '1px solid rgba(34,197,94,0.2)' }}>Rings even if phone is on silent.</div>}
              </div>
            )}

            {assistMode === 'contact' && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" value={contactInfo} onChange={e => setContactInfo(e.target.value)} placeholder="Phone / Email / Notes…" className="qk-input" style={{ flex: 1 }} />
                  <button type="button" onClick={() => setShowContactPicker(true)} style={{ padding: '0 14px', borderRadius: 10, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>👤 Pick</button>
                </div>
                {contactInfo && <div style={{ marginTop: 6, fontSize: 12, color: '#6ee7b7', padding: '4px 8px', background: 'rgba(16,185,129,0.08)', borderRadius: 6 }}>✓ {contactInfo}</div>}
              </div>
            )}
            {showContactPicker && user && (
              <ContactPicker supabase={supabase} userId={user.id} title="Select Contact"
                onSelect={(contacts) => { const c = contacts[0]; setContactInfo(`${c.name}${c.phone ? ' · ' + c.phone : ''}`); setShowContactPicker(false); }}
                onClose={() => setShowContactPicker(false)} />
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)' }}>Ctrl+Enter to save</span>
              <button onClick={handleSave} disabled={saving || !content.trim()} className="qk-btn qk-btn-primary">{saving ? 'Saving…' : '+ Keep this'}</button>
            </div>
          </div>

          <div style={{ marginBottom: 14, position: 'relative' }}>
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search your keeps…" className="qk-input" />
            {searchQuery && <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 18 }}>×</button>}
          </div>

          {(() => {
            const predictions = intents.filter(i => i.is_prediction && i.status !== 'closed');
            if (!predictions.length) return null;
            return (
              <div style={{ marginBottom: 14, background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.07em', textTransform: 'uppercase', borderBottom: '1px solid rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🔮</span><span>QuietKeep suggests ({predictions.length})</span>
                </div>
                {predictions.map(pred => (
                  <div key={pred.id} style={{ padding: '9px 12px', borderBottom: '1px solid rgba(139,92,246,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{TYPE_EMOJI[pred.intent_type] || '📝'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-word' }}>{pred.content}</div>
                      {pred.ai_summary && <div style={{ fontSize: 11, color: '#7c6faf', marginTop: 2 }}>{pred.ai_summary.replace('🔮 Predicted: ', '')}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => { updateState(pred.id, 'closed'); handleFeedback(pred.id, 'acted'); }} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)', color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Yes</button>
                      <button onClick={() => { updateState(pred.id, 'closed'); handleFeedback(pred.id, 'dismissed'); }} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {proactiveCtx && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 14px', marginBottom: 10, background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 16 }}>📍</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7' }}>Near {proactiveCtx.locationName}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{proactiveCtx.summary}</div>
                {proactiveCtx.keeps?.slice(0, 2).map((k, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4, paddingLeft: 22, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {k.content?.slice(0, 60) || k.location_name}</div>)}
              </div>
              <button onClick={() => setProactiveCtx(null)} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}>✕</button>
            </div>
          )}

          {autonomyEnabled && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={toggleAutomationPause} style={{ flex: 1, padding: '8px 12px', borderRadius: 9, border: automationPaused ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(99,102,241,0.2)', background: automationPaused ? 'rgba(239,68,68,0.12)' : 'rgba(99,102,241,0.1)', color: automationPaused ? '#f87171' : '#a5b4fc', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                {automationPaused ? '▶ Resume automation' : '⏸ Pause automation'}
              </button>
              <button onClick={async () => { await loadAutoHistory(); setShowReviewPanel(true); }} style={{ padding: '8px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-subtle)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>📋 Review</button>
            </div>
          )}

          {strongSuggestions.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#fbbf24', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 2 }}>⚡ Suggested for you</div>
              {strongSuggestions.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '12px 13px', marginBottom: 7, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 11 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4, marginBottom: 3 }}>⚡ {s.message}</div>
                    {s.why_text && <div style={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.4, marginBottom: 5 }}>{s.why_text}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 48, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(s.score * 100)}%`, background: '#fbbf24', borderRadius: 2 }} /></div>
                      <span style={{ fontSize: 10, color: '#fbbf24', fontWeight: 700 }}>{Math.round(s.score * 100)}%</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                    <button onClick={() => { if (s.action_hint?.startsWith('contact:')) setContent(`call ${s.action_hint.replace('contact:', '')}`); else setContent(s.label || ''); setTimeout(() => textareaRef.current?.focus(), 50); }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'rgba(245,158,11,0.2)', color: '#fbbf24', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Do it</button>
                    <button onClick={() => setWhyPanel({ message: s.message, why_text: s.why_text, score: s.score, signals: s.signal_weights || null })} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.25)', background: 'transparent', color: '#a5b4fc', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>Why?</button>
                    <button onClick={async () => { const intentType = s.action_hint?.replace(/^(contact:|predicted:)/, '') || s.intentType; const contactName = s.action_hint?.startsWith('contact:') ? s.action_hint.replace('contact:', '') : null; await safeFetch('/api/suggestions/feedback', { method: 'POST', body: JSON.stringify({ intent_type: intentType, outcome: 'ignored', contact_name: contactName }), token: accessToken }).catch(() => {}); setStrongSuggestions(prev => prev.filter((_, j) => j !== i)); }} style={{ padding: '4px 8px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-subtle)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>Skip</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {predictedCards.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 2 }}>🧠 Predicted for you</div>
              {predictedCards.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '11px 13px', marginBottom: 7, background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.22)', borderRadius: 11 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>💡 {s.message}</div>
                    {s.prediction_reason && <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3, lineHeight: 1.4 }}>{s.prediction_reason}</div>}
                    {s.prediction_conf && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                        <div style={{ width: 60, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 2, width: s.prediction_conf === 'high' ? '80%' : s.prediction_conf === 'medium' ? '55%' : '30%', background: s.prediction_conf === 'high' ? '#6ee7b7' : s.prediction_conf === 'medium' ? '#fbbf24' : '#94a3b8' }} />
                        </div>
                        <span style={{ fontSize: 9, fontWeight: 700, color: s.prediction_conf === 'high' ? '#6ee7b7' : s.prediction_conf === 'medium' ? '#fbbf24' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.prediction_conf}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                    <button onClick={async () => { const intentType = s.action_hint?.replace(/^(contact:|predicted:)/, '') || s.intentType; const contactName = s.action_hint?.startsWith('contact:') ? s.action_hint.replace('contact:', '') : null; if (contactName) setContent(`call ${contactName}`); else setContent(s.label || ''); setTimeout(() => textareaRef.current?.focus(), 50); await safeFetch('/api/suggestions/feedback', { method: 'POST', body: JSON.stringify({ intent_type: intentType, outcome: 'acted', contact_name: contactName }), token: accessToken }).catch(() => {}); setPredictedCards(prev => prev.filter((_, j) => j !== i)); }} style={{ padding: '5px 11px', borderRadius: 8, border: 'none', background: 'rgba(139,92,246,0.18)', color: '#c4b5fd', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>👍 Yes</button>
                    <button onClick={async () => { const intentType = s.action_hint?.replace(/^(contact:|predicted:)/, '') || s.intentType; const contactName = s.action_hint?.startsWith('contact:') ? s.action_hint.replace('contact:', '') : null; await safeFetch('/api/suggestions/feedback', { method: 'POST', body: JSON.stringify({ intent_type: intentType, outcome: 'ignored', contact_name: contactName }), token: accessToken }).catch(() => {}); setPredictedCards(prev => prev.filter((_, j) => j !== i)); }} style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'var(--text-subtle)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>👎 No</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <AgentSuggestionCard accessToken={accessToken} lat={gpsLat} lng={gpsLng} onAction={(hint) => {
            if (hint?.startsWith('save_location:')) { setContent(`remind me when I reach ${hint.replace('save_location:', '')}`); setTimeout(() => textareaRef.current?.focus(), 50); }
            if (hint?.startsWith('view_nearby:')) showToast(`📍 Showing keeps near ${hint.replace('view_nearby:', '')}`);
            if (hint?.startsWith('contact:')) { setContent(`call ${hint.replace('contact:', '')}`); setTimeout(() => textareaRef.current?.focus(), 50); }
          }} />

          <div className="qk-tabs">
            {[{ key: 'open', label: `Open (${openIntents.length})` }, { key: 'reminder', label: `⏰ Remind (${intents.filter(i=>i.intent_type==='reminder'&&i.status!=='closed').length})` }, { key: 'closed', label: `Done (${closedIntents.length})` }].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`qk-tab${activeTab === tab.key ? ' active' : ''}`}>{tab.label}</button>
            ))}
          </div>

          {displayIntents.length === 0 ? (
            <div className="qk-empty">
              <div className="qk-empty-icon">{activeTab === 'open' ? '🎙' : activeTab === 'reminder' ? '⏰' : '✅'}</div>
              <div className="qk-empty-title">{activeTab === 'open' ? 'No open keeps' : activeTab === 'reminder' ? 'No reminders' : 'No completed keeps yet'}</div>
              <div className="qk-empty-sub">{activeTab === 'open' ? 'Tap Voice or type to add your first keep' : activeTab === 'reminder' ? 'Type a keep with a time to create reminders' : 'Mark some keeps as done to see them here'}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {displayIntents.map(intent => (
                <IntentCard key={intent.id} intent={intent} onUpdateState={updateState} onDelete={handleDelete} onEdit={handleEdit} onFeedback={handleFeedback} accessToken={accessToken} userLanguage={displayLocale || 'en'} />
              ))}
            </div>
          )}

        </div>
      </div>

      <TalkAssistantResponse show={talkResponse.show} type={talkResponse.type} language={talkResponse.language} params={talkResponse.params} onDismiss={() => setTalkResponse(p => ({ ...p, show: false }))} />
      <UpgradeModal show={showUpgrade} onClose={() => setShowUpgrade(false)} reason={`You've used all free ${upgradeInfo.feature || 'captures'} for today`} used={upgradeInfo.used} limit={upgradeInfo.limit} feature={upgradeInfo.feature} />
    </>
  );
}
