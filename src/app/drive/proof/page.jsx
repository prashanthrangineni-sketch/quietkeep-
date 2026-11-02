'use client';
// src/app/drive/proof/page.jsx
// QuietKeep Phase-2 Proof Kit — Field-test screen for the founder (Task Card AG-04)
//
// Unlisted URL: /drive/proof only.
// Used with real hardware to execute, evaluate, and save verification evidence
// to public.drive_proof_runs so Claude can verify results directly.

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/context/auth';
import { supabase } from '@/lib/supabase';
import {
  CHECKLIST_STEPS,
  evalDeskTest,
  evalParkedCarSnapshot,
  evalFirmBrakes,
  evalSave60Record,
  parseBlackboxPacket,
  evalSpeedCheck,
  formatProofSummary,
  saveProofResult,
  fetchProofRuns,
} from '@/lib/proof-kit';
import { listBlackboxRecords } from '@/lib/blackbox';
import {
  DROP_TRIAL_TYPES,
  TRIAL_TYPE_KEYS,
  runDropTest,
  evaluateTrialResult,
  computeDropTestTally,
  generateDropTrace,
  getPhoneModel,
} from '@/lib/drop-test';

export default function DriveProofPage() {
  const { user } = useAuth();
  const [results, setResults] = useState({});
  const [notes, setNotes] = useState({});
  const [runningStep, setRunningStep] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [proofRunsHistory, setProofRunsHistory] = useState([]);

  // AG-D3 Drop-and-Fall Test state
  const [selectedTrialType, setSelectedTrialType] = useState('cushion_drop_1m');
  const [dropTestRunning, setDropTestRunning] = useState(false);
  const [trialSecondsLeft, setTrialSecondsLeft] = useState(15);
  const [latestDropSampleCount, setLatestDropSampleCount] = useState(0);
  const [latestDropCurrentG, setLatestDropCurrentG] = useState(1.0);
  const [latestTrialResult, setLatestTrialResult] = useState(null);
  const [dropNote, setDropNote] = useState('');

  // Load existing proof runs for user on mount
  useEffect(() => {
    async function loadHistory() {
      if (!user) {
        setLoadingHistory(false);
        return;
      }
      try {
        const rows = await fetchProofRuns(supabase);
        setProofRunsHistory(rows || []);
        const initialResults = {};
        const initialNotes = {};
        // Rows are sorted by created_at desc; keep latest for each step
        for (const row of rows) {
          if (!initialResults[row.step]) {
            initialResults[row.step] = {
              result: row.result,
              evidence: row.evidence,
              note: row.note,
              savedAt: row.created_at,
            };
            if (row.note) initialNotes[row.step] = row.note;
          }
        }
        setResults(initialResults);
        setNotes(initialNotes);
      } catch (err) {
        console.warn('[proof-kit] Failed to load history:', err);
      } finally {
        setLoadingHistory(false);
      }
    }
    loadHistory();
  }, [user]);

  async function handleRecordResult(stepId, outcome, evidence = {}, explicitNote = null) {
    const note = explicitNote !== null ? explicitNote : (notes[stepId] || '');
    const newEntry = {
      result: outcome,
      evidence,
      note,
      savedAt: new Date().toISOString(),
    };

    setResults(prev => ({
      ...prev,
      [stepId]: newEntry,
    }));

    if (user) {
      setSaveStatus(`Saving ${stepId}...`);
      const res = await saveProofResult(supabase, {
        step: stepId,
        result: outcome,
        evidence,
        note,
      });
      if (res.saved) {
        setSaveStatus(`Saved ${stepId} (${outcome})`);
        if (res.record) {
          setProofRunsHistory(prev => [res.record, ...prev]);
        }
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        setSaveStatus(`Warning: could not save (${res.reason})`);
      }
    }
  }

  async function runDropTrial(isSimulated = false) {
    if (dropTestRunning) return;
    setDropTestRunning(true);
    setTrialSecondsLeft(15);
    setLatestDropSampleCount(0);
    setLatestTrialResult(null);

    const collectedSamples = [];
    let motionHandler = null;

    if (!isSimulated && typeof window !== 'undefined' && window.DeviceMotionEvent) {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          const perm = await DeviceMotionEvent.requestPermission();
          if (perm !== 'granted') {
            console.warn('[drop-test] DeviceMotion permission not granted');
          }
        } catch (e) {
          console.warn('[drop-test] Permission error:', e);
        }
      }

      motionHandler = (event) => {
        const acc = event.accelerationIncludingGravity;
        if (!acc) return;
        const x = acc.x || 0, y = acc.y || 0, z = acc.z || 0;
        const g = Math.sqrt(x * x + y * y + z * z) / 9.81;
        const at = Date.now();
        collectedSamples.push({ at, magnitudeG: g });
        setLatestDropCurrentG(Math.round(g * 100) / 100);
        setLatestDropSampleCount(collectedSamples.length);
      };

      try {
        window.addEventListener('devicemotion', motionHandler);
      } catch (err) {
        console.warn('[drop-test] Failed to add listener:', err);
      }
    }

    // Run 15-second countdown
    let seconds = 15;
    const interval = setInterval(() => {
      seconds -= 1;
      setTrialSecondsLeft(Math.max(0, seconds));
      if (seconds <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    // Wait full 15 seconds
    await new Promise((resolve) => setTimeout(resolve, 15000));
    clearInterval(interval);

    if (motionHandler && typeof window !== 'undefined') {
      try {
        window.removeEventListener('devicemotion', motionHandler);
      } catch {}
    }

    // Determine trace to evaluate: simulated trace if requested or if 0 samples recorded on desktop
    let traceToEval = collectedSamples;
    const wasSimulated = isSimulated || collectedSamples.length === 0;
    if (wasSimulated) {
      traceToEval = generateDropTrace(selectedTrialType);
    }

    const evalResult = runDropTest(traceToEval);
    const verdict = evaluateTrialResult(selectedTrialType, evalResult);
    const outcome = verdict.pass ? 'pass' : 'fail';
    const phone_model = getPhoneModel();

    const evidence = {
      detected: evalResult.detected,
      peakG: evalResult.peakG,
      msToDetect: evalResult.msToDetect,
      phone_model,
      sampleCount: traceToEval.length,
      simulated: wasSimulated,
    };

    const trialStep = `drop_test:${selectedTrialType}`;
    const explicitNote = dropNote || (wasSimulated ? 'Simulated trace trial' : 'Field trial');

    setLatestTrialResult({
      trialType: selectedTrialType,
      outcome,
      verdict,
      evalResult,
      evidence,
      note: explicitNote,
    });

    if (user) {
      setSaveStatus(`Saving ${trialStep}...`);
      const res = await saveProofResult(supabase, {
        step: trialStep,
        result: outcome,
        evidence,
        note: explicitNote,
      });
      if (res.saved) {
        setSaveStatus(`Saved ${trialStep} (${outcome})`);
        if (res.record) {
          setProofRunsHistory((prev) => [res.record, ...prev]);
        }
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        setSaveStatus(`Warning: could not save (${res.reason})`);
      }
    }

    setDropTestRunning(false);
  }

  async function runAutoStep(step) {
    setRunningStep(step.id);
    try {
      if (step.id === 'desk_test_tilt') {
        const listRes = await listBlackboxRecords();
        const records = listRes?.records || [];
        const evaluation = evalDeskTest({ records });
        await handleRecordResult(step.id, evaluation.pass ? 'pass' : 'fail', evaluation.evidence || { reason: evaluation.reason });
      } else if (step.id === 'parked_car_reader') {
        // Query active reader if running or check native plugin
        let snapshot = null;
        if (typeof window !== 'undefined' && window.__QK_OBD_READER__) {
          try { snapshot = await window.__QK_OBD_READER__.readSnapshot(); } catch {}
        }
        const evaluation = evalParkedCarSnapshot(snapshot);
        await handleRecordResult(step.id, evaluation.pass ? 'pass' : 'fail', evaluation.evidence || { reason: evaluation.reason });
      } else if (step.id === 'proof_ride_brakes') {
        if (!user) {
          await handleRecordResult(step.id, 'fail', { reason: 'not_signed_in' });
          return;
        }
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data: events, error } = await supabase
          .from('ride_road_events')
          .select('id, kind, created_at')
          .eq('user_id', user.id)
          .gte('created_at', thirtyMinsAgo);

        if (error) {
          await handleRecordResult(step.id, 'fail', { error: error.message });
          return;
        }
        const evaluation = evalFirmBrakes({ events: events || [] });
        await handleRecordResult(step.id, evaluation.pass ? 'pass' : 'fail', evaluation.evidence || { reason: evaluation.reason });
      } else if (step.id === 'proof_ride_save60') {
        const listRes = await listBlackboxRecords();
        const records = listRes?.records || [];
        if (records.length === 0) {
          await handleRecordResult(step.id, 'fail', { reason: 'no_records_found' });
          return;
        }
        // Newest record
        const newest = records[0];
        let fullRecord = null;
        if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.QkBlackbox) {
          fullRecord = await window.Capacitor.Plugins.QkBlackbox.readRecord({ id: newest.id });
        }
        const evaluation = evalSave60Record(fullRecord || newest);
        await handleRecordResult(step.id, evaluation.pass ? 'pass' : 'fail', evaluation.evidence || { reason: evaluation.reason });
      } else if (step.id === 'speed_check') {
        const listRes = await listBlackboxRecords();
        const records = listRes?.records || [];
        if (records.length === 0) {
          await handleRecordResult(step.id, 'fail', { reason: 'no_records_found' });
          return;
        }
        const newest = records[0];
        let fullRecord = null;
        if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.QkBlackbox) {
          fullRecord = await window.Capacitor.Plugins.QkBlackbox.readRecord({ id: newest.id });
        }
        const parsed = fullRecord ? parseBlackboxPacket(fullRecord) : null;
        const evaluation = evalSpeedCheck({
          obdSamples: parsed?.obdSamples,
          gpsSamples: parsed?.gpsSamples,
          record: fullRecord,
        });
        await handleRecordResult(step.id, evaluation.pass ? 'pass' : 'fail', evaluation.evidence || { reason: evaluation.reason });
      }
    } catch (err) {
      await handleRecordResult(step.id, 'fail', { error: String(err?.message || err) });
    } finally {
      setRunningStep(null);
    }
  }

  function handleCopySummary() {
    const summary = formatProofSummary(CHECKLIST_STEPS, results);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  const passedCount = CHECKLIST_STEPS.filter(s => results[s.id]?.result === 'pass').length;
  const failedCount = CHECKLIST_STEPS.filter(s => results[s.id]?.result === 'fail').length;
  const totalCount = CHECKLIST_STEPS.length;

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#090d16',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '24px 16px 80px',
      maxWidth: '800px',
      margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '24px', borderBottom: '1px solid #1e293b', paddingBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span style={{
              display: 'inline-block',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700,
              color: '#38bdf8',
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              padding: '2px 8px',
              borderRadius: '4px',
              marginBottom: '6px',
            }}>
              Internal Verification · AG-04
            </span>
            <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '4px 0', color: '#f8fafc' }}>
              Phase-2 Proof Kit
            </h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
              Field-test evidence & checklist for real-vehicle verification.
            </p>
          </div>

          <button
            onClick={handleCopySummary}
            style={{
              padding: '10px 18px',
              backgroundColor: copied ? '#059669' : '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
          >
            {copied ? '✓ Summary Copied!' : '📋 Copy Summary'}
          </button>
        </div>

        {/* Progress Bar & Status */}
        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ flex: 1, backgroundColor: '#1e293b', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{
              width: `${(passedCount / totalCount) * 100}%`,
              backgroundColor: '#10b981',
              height: '100%',
              transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
            {passedCount} / {totalCount} Passed
            {failedCount > 0 && <span style={{ color: '#ef4444', marginLeft: '8px' }}>({failedCount} failed)</span>}
          </span>
        </div>

        {saveStatus && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#38bdf8' }}>
            {saveStatus}
          </div>
        )}
      </div>

      {loadingHistory && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '14px' }}>
          Loading recorded test history...
        </div>
      )}

      {/* Steps List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {CHECKLIST_STEPS.map((step) => {
          const res = results[step.id] || {};
          const status = res.result || 'pending';
          const isRunning = runningStep === step.id;

          const badgeColor =
            status === 'pass' ? { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981', border: '#059669' } :
            status === 'fail' ? { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', border: '#dc2626' } :
            status === 'skipped' ? { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b', border: '#d97706' } :
            { bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8', border: '#475569' };

          return (
            <div
              key={step.id}
              style={{
                backgroundColor: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' }}>
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginRight: '6px' }}>
                    STEP {step.num}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    backgroundColor: step.type === 'auto' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                    color: step.type === 'auto' ? '#a5b4fc' : '#fde047',
                  }}>
                    {step.type}
                  </span>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '6px 0 2px', color: '#f8fafc' }}>
                    {step.title}
                  </h3>
                  <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                    {step.description}
                  </p>
                </div>

                {/* Status Badge */}
                <div style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  backgroundColor: badgeColor.bg,
                  color: badgeColor.text,
                  border: `1px solid ${badgeColor.border}`,
                  whiteSpace: 'nowrap',
                }}>
                  {status}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '14px 0 10px' }}>
                {step.type === 'auto' && (
                  <button
                    onClick={() => runAutoStep(step)}
                    disabled={isRunning}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: isRunning ? '#475569' : '#3b82f6',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: isRunning ? 'default' : 'pointer',
                    }}
                  >
                    {isRunning ? '⏳ Running...' : '▶ Run Check'}
                  </button>
                )}

                <button
                  onClick={() => handleRecordResult(step.id, 'pass')}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: status === 'pass' ? '#10b981' : '#1e293b',
                    color: status === 'pass' ? '#ffffff' : '#94a3b8',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ✓ Pass
                </button>

                <button
                  onClick={() => handleRecordResult(step.id, 'fail')}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: status === 'fail' ? '#ef4444' : '#1e293b',
                    color: status === 'fail' ? '#ffffff' : '#94a3b8',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ✕ Fail
                </button>

                <button
                  onClick={() => handleRecordResult(step.id, 'skipped')}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: status === 'skipped' ? '#f59e0b' : '#1e293b',
                    color: status === 'skipped' ? '#ffffff' : '#94a3b8',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Skip
                </button>
              </div>

              {/* Evidence Box */}
              {res.evidence && Object.keys(res.evidence).length > 0 && (
                <div style={{
                  backgroundColor: '#020617',
                  border: '1px solid #1e293b',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  color: '#94a3b8',
                  fontFamily: 'monospace',
                  marginBottom: '10px',
                  wordBreak: 'break-all',
                }}>
                  <strong style={{ color: '#38bdf8' }}>Evidence: </strong>
                  {JSON.stringify(res.evidence)}
                </div>
              )}

              {/* Notes Input */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Add notes for this test (e.g. firmware version, observations)..."
                  value={notes[step.id] || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNotes(prev => ({ ...prev, [step.id]: val }));
                  }}
                  onBlur={() => {
                    if (res.result) {
                      handleRecordResult(step.id, res.result, res.evidence, notes[step.id]);
                    }
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: '#020617',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Drop and Fall Test Section (AG-D3 / DRV-16) ───────────────────── */}
      {(() => {
        const dropTally = computeDropTestTally(proofRunsHistory);
        const selectedDef = DROP_TRIAL_TYPES[selectedTrialType] || DROP_TRIAL_TYPES.cushion_drop_1m;

        return (
          <div style={{
            marginTop: '36px',
            backgroundColor: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '12px',
            padding: '20px',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
              <div>
                <span style={{
                  display: 'inline-block',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontWeight: 700,
                  color: '#f59e0b',
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  marginBottom: '4px',
                }}>
                  Field Verification · DRV-16 / AG-D3
                </span>
                <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '2px 0 4px', color: '#f8fafc' }}>
                  Drop and Fall Test
                </h2>
                <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                  Staged drop & false-alarm verification with simulated riding speed (25 km/h before, 0 after).
                  <span style={{ color: '#38bdf8', marginLeft: '6px' }}>Drill only: never starts SOS or calls contacts.</span>
                </p>
              </div>
            </div>

            {/* Trial Type Selector */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#cbd5e1', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Select Trial Type
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                {TRIAL_TYPE_KEYS.map((k) => {
                  const def = DROP_TRIAL_TYPES[k];
                  const isSelected = selectedTrialType === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={dropTestRunning}
                      onClick={() => setSelectedTrialType(k)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: isSelected ? '2px solid #38bdf8' : '1px solid #334155',
                        backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.15)' : '#020617',
                        color: isSelected ? '#ffffff' : '#94a3b8',
                        cursor: dropTestRunning ? 'default' : 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '2px' }}>
                        {def.name}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: def.expected ? '#34d399' : '#f59e0b',
                      }}>
                        {def.expected ? '● Expect: Detected' : '○ Expect: Ignored'}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
                {selectedDef.description}
              </div>
            </div>

            {/* Trial Run Controls */}
            <div style={{
              backgroundColor: '#020617',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  disabled={dropTestRunning}
                  onClick={() => runDropTrial(false)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: dropTestRunning ? '#475569' : '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: dropTestRunning ? 'default' : 'pointer',
                  }}
                >
                  {dropTestRunning ? `⏳ Recording... ${trialSecondsLeft}s` : '▶ Start 15s Trial'}
                </button>

                <button
                  type="button"
                  disabled={dropTestRunning}
                  onClick={() => runDropTrial(true)}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#1e293b',
                    color: '#94a3b8',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: dropTestRunning ? 'default' : 'pointer',
                  }}
                >
                  🧪 Run Simulated Trace
                </button>

                {dropTestRunning && (
                  <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#cbd5e1' }}>
                    <span>Samples: <strong>{latestDropSampleCount}</strong></span>
                    <span>Current G: <strong>{latestDropCurrentG}g</strong></span>
                  </div>
                )}
              </div>

              {/* Note input */}
              <div style={{ marginTop: '12px' }}>
                <input
                  type="text"
                  placeholder="Trial note (e.g. drop angle, surface description, case type)..."
                  value={dropNote}
                  onChange={(e) => setDropNote(e.target.value)}
                  disabled={dropTestRunning}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: '#090d16',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
              </div>
            </div>

            {/* Latest Result Display */}
            {latestTrialResult && (
              <div style={{
                marginBottom: '20px',
                padding: '14px',
                borderRadius: '8px',
                backgroundColor: latestTrialResult.outcome === 'pass' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${latestTrialResult.outcome === 'pass' ? '#059669' : '#dc2626'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ fontWeight: 800, fontSize: '15px', color: latestTrialResult.outcome === 'pass' ? '#10b981' : '#ef4444' }}>
                    {latestTrialResult.outcome === 'pass' ? '✓ TRIAL PASSED' : '✕ TRIAL FAILED'}
                  </div>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>
                    step: drop_test:{latestTrialResult.trialType}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#e2e8f0', marginBottom: '8px' }}>
                  {latestTrialResult.verdict.reason === 'ok'
                    ? (latestTrialResult.verdict.expected ? 'Expected crash detected and verified with stillness aftermath.' : 'Correctly ignored without false alarm.')
                    : (latestTrialResult.verdict.expected ? 'Missed crash detection (impact < 3.2g or stillness < 8s).' : 'False alarm: motion was incorrectly classified as crash.')}
                </div>
                <div style={{
                  backgroundColor: '#020617',
                  border: '1px solid #1e293b',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  color: '#94a3b8',
                }}>
                  <span style={{ color: '#38bdf8' }}>evidence: </span>
                  {JSON.stringify(latestTrialResult.evidence)}
                </div>
              </div>
            )}

            {/* Running Tally Section */}
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                  Running Tallies & Metrics
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  {dropTally.summary.totalTrials} total trials logged
                </span>
              </div>

              {/* Summary KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '14px' }}>
                <div style={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '8px', padding: '10px 14px' }}>
                  <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
                    Staged Falls Caught
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#34d399', margin: '2px 0' }}>
                    {dropTally.summary.stagedFallsCaught} / {dropTally.summary.stagedFallsTotal}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    Catch Rate: {Math.round(dropTally.summary.stagedFallsCaughtRate * 100)}% (target ≥ 90%)
                  </div>
                </div>

                <div style={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '8px', padding: '10px 14px' }}>
                  <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
                    False Alarms
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: dropTally.summary.falseAlarmsTotal === 0 ? '#34d399' : '#ef4444', margin: '2px 0' }}>
                    {dropTally.summary.falseAlarmsTotal} / {dropTally.summary.nonCrashTrialsTotal}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    False Rate: {Math.round(dropTally.summary.falseAlarmRate * 100)}% (target 0%)
                  </div>
                </div>
              </div>

              {/* Tally Breakdown Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '12px',
                  textAlign: 'left',
                  backgroundColor: '#020617',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid #1e293b',
                }}>
                  <thead>
                    <tr style={{ backgroundColor: '#090d16', borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>
                      <th style={{ padding: '10px 12px' }}>Trial Type</th>
                      <th style={{ padding: '10px 12px' }}>Expected</th>
                      <th style={{ padding: '10px 12px' }}>Caught / Total</th>
                      <th style={{ padding: '10px 12px' }}>False Alarms / Total</th>
                      <th style={{ padding: '10px 12px' }}>Pass / Total</th>
                      <th style={{ padding: '10px 12px' }}>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TRIAL_TYPE_KEYS.map((typeKey) => {
                      const item = dropTally.byType[typeKey];
                      return (
                        <tr key={typeKey} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: '#f8fafc' }}>
                            {item.name}
                          </td>
                          <td style={{ padding: '8px 12px', color: item.expected ? '#34d399' : '#f59e0b' }}>
                            {item.expected ? 'Detected' : 'Ignored'}
                          </td>
                          <td style={{ padding: '8px 12px', color: '#e2e8f0', fontFamily: 'monospace' }}>
                            {item.caught} / {item.total}
                          </td>
                          <td style={{ padding: '8px 12px', color: item.falseAlarms > 0 ? '#ef4444' : '#94a3b8', fontFamily: 'monospace' }}>
                            {item.falseAlarms} / {item.total}
                          </td>
                          <td style={{ padding: '8px 12px', color: item.pass === item.total && item.total > 0 ? '#10b981' : '#e2e8f0', fontFamily: 'monospace' }}>
                            {item.pass} / {item.total}
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 700, color: item.passRate >= 0.9 ? '#10b981' : (item.total === 0 ? '#64748b' : '#ef4444') }}>
                            {item.total > 0 ? `${Math.round(item.passRate * 100)}%` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Summary Footer */}
      <div style={{ marginTop: '32px', textAlign: 'center' }}>
        <button
          onClick={handleCopySummary}
          style={{
            padding: '12px 24px',
            backgroundColor: copied ? '#059669' : '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 700,
            fontSize: '15px',
            cursor: 'pointer',
          }}
        >
          {copied ? '✓ Summary Copied to Clipboard!' : '📋 Copy Full Proof Summary'}
        </button>
      </div>
    </div>
  );
}
