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

export default function DriveProofPage() {
  const { user } = useAuth();
  const [results, setResults] = useState({});
  const [notes, setNotes] = useState({});
  const [runningStep, setRunningStep] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Load existing proof runs for user on mount
  useEffect(() => {
    async function loadHistory() {
      if (!user) {
        setLoadingHistory(false);
        return;
      }
      try {
        const rows = await fetchProofRuns(supabase);
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
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        setSaveStatus(`Warning: could not save (${res.reason})`);
      }
    }
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
