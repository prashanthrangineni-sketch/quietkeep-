'use client';
// src/app/drive/stats/page.jsx
// QuietKeep Ride Safety & False-Alarm Review Screen (Task Card AG-D4 / DRV-17)
//
// Unlisted URL: /drive/stats only.
// Read-only dashboard for owner to view crash detection false-alarm rates,
// riding hours, check-ins cancelled, and staged drop-test performance
// broken down per phone model and totals.

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/context/auth';
import { supabase } from '@/lib/supabase';
import {
  CONSTANTS,
  fetchFalseAlarmData,
  computeFalseAlarmStats,
} from '@/lib/false-alarm-stats';

export default function DriveStatsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [rawCounts, setRawCounts] = useState({ sessions: 0, clips: 0, blackbox: 0, proof: 0 });
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetchFalseAlarmData(supabase, user.id);
      setStats(res.stats);
      setRawCounts({
        sessions: res.raw.drivingSessions.length,
        clips: res.raw.rideSensorClips.length,
        blackbox: res.raw.blackboxEvents.length,
        proof: res.raw.driveProofRuns.length,
      });
    } catch (err) {
      console.warn('[drive-stats] Error loading false-alarm stats:', err);
      setErrorMsg(err.message || 'Failed to load drive statistics');
      // Graceful fallback: show empty stats
      setStats(computeFalseAlarmStats({}));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totals = stats?.totals || {
    ridingHours: 0,
    ridingHoursDisplay: '0.0 hrs',
    falseAlarms: 0,
    trueEvents: 0,
    checkInsCancelled: 0,
    stagedFallsCaught: 0,
    stagedFallsTotal: 0,
    stagedFallsDisplay: '0 / 0',
    rateDisplay: CONSTANTS.NOT_ENOUGH_RIDING_MSG,
    hasEnoughRiding: false,
  };

  const byModel = stats?.byModel || [];
  const dateRangeStr = stats?.dateRange?.formatted || 'No activity recorded';

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#090d16',
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '24px 16px 64px 16px',
    }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{
          marginBottom: '28px',
          borderBottom: '1px solid #1e293b',
          paddingBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '16px',
        }}>
          <div>
            <span style={{
              display: 'inline-block',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 700,
              color: '#38bdf8',
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              padding: '3px 10px',
              borderRadius: '6px',
              marginBottom: '8px',
            }}>
              Ride Safety Verification · AG-D4 / DRV-17
            </span>
            <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '4px 0', color: '#f8fafc' }}>
              False-Alarm Review & Stats
            </h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
              Real-world calibration metrics, riding duration, cancelled check-ins, and staged fall validation.
            </p>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            style={{
              padding: '8px 16px',
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              border: '1px solid #334155',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {loading ? 'Refreshing...' : '🔄 Refresh Data'}
          </button>
        </div>

        {/* Date Coverage Badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: '#111827',
          border: '1px solid #1f2937',
          padding: '8px 14px',
          borderRadius: '8px',
          marginBottom: '24px',
          fontSize: '13px',
          color: '#cbd5e1',
        }}>
          <span style={{ color: '#38bdf8', fontWeight: 600 }}>Coverage:</span>
          <span>{dateRangeStr}</span>
        </div>

        {!user && !loading && (
          <div style={{
            padding: '20px',
            backgroundColor: '#1e293b',
            borderRadius: '12px',
            border: '1px solid #334155',
            color: '#f1f5f9',
            marginBottom: '24px',
          }}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              Sign in to view your recorded ride data, false-alarm statistics, and staged drop-test evidence.
            </p>
          </div>
        )}

        {errorMsg && (
          <div style={{
            padding: '14px 18px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            color: '#fca5a5',
            marginBottom: '24px',
            fontSize: '13px',
          }}>
            {errorMsg}
          </div>
        )}

        {/* Aggregate Totals Summary Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}>
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '12px',
            padding: '16px 20px',
          }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Riding Hours
            </div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#f8fafc', marginTop: '6px' }}>
              {totals.ridingHoursDisplay}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              Closed sessions only ({rawCounts.sessions} total)
            </div>
          </div>

          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '12px',
            padding: '16px 20px',
          }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              False Alarms / 1,000h
            </div>
            <div style={{
              fontSize: totals.hasEnoughRiding ? '26px' : '18px',
              fontWeight: 800,
              color: totals.hasEnoughRiding ? '#38bdf8' : '#eab308',
              marginTop: '6px',
            }}>
              {totals.rateDisplay}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              {totals.hasEnoughRiding ? 'Normalised rate' : 'Floor: requires ≥ 10 riding hours'}
            </div>
          </div>

          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '12px',
            padding: '16px 20px',
          }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Check-ins Cancelled
            </div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#10b981', marginTop: '6px' }}>
              {totals.checkInsCancelled}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              "I'm OK" driver cancellations
            </div>
          </div>

          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: '12px',
            padding: '16px 20px',
          }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Staged Falls Caught
            </div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#a855f7', marginTop: '6px' }}>
              {totals.stagedFallsDisplay}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              Drop-and-fall proof kit trials
            </div>
          </div>
        </div>

        {/* Totals Table */}
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', marginBottom: '14px' }}>
            Overall Summary (All Phone Models)
          </h2>
          <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #1e293b' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#111827', borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Category</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Riding Hours</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>False Alarms</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Rate / 1,000 hrs</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Check-ins Cancelled</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Staged Falls Caught</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>True Events</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ backgroundColor: '#0f172a' }}>
                  <td style={{ padding: '14px 16px', fontWeight: 700, color: '#38bdf8' }}>{totals.phoneModel}</td>
                  <td style={{ padding: '14px 16px' }}>{totals.ridingHoursDisplay}</td>
                  <td style={{ padding: '14px 16px' }}>{totals.falseAlarms}</td>
                  <td style={{
                    padding: '14px 16px',
                    fontWeight: 600,
                    color: totals.hasEnoughRiding ? '#38bdf8' : '#eab308',
                  }}>
                    {totals.rateDisplay}
                  </td>
                  <td style={{ padding: '14px 16px' }}>{totals.checkInsCancelled}</td>
                  <td style={{ padding: '14px 16px' }}>{totals.stagedFallsDisplay}</td>
                  <td style={{ padding: '14px 16px' }}>{totals.trueEvents}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-Phone Model Tables */}
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', marginBottom: '14px' }}>
            Breakdown by Phone Model
          </h2>

          {byModel.length === 0 ? (
            <div style={{
              padding: '32px 20px',
              backgroundColor: '#111827',
              border: '1px dashed #334155',
              borderRadius: '12px',
              textAlign: 'center',
              color: '#94a3b8',
            }}>
              <p style={{ margin: 0, fontSize: '14px' }}>
                No phone models recorded yet. Complete rides in Drive Mode or run drop trials on the Proof screen to calibrate.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {byModel.map((model) => (
                <div
                  key={model.phoneModel}
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #1e293b',
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{
                    backgroundColor: '#111827',
                    padding: '14px 20px',
                    borderBottom: '1px solid #1e293b',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}>
                    <div>
                      <span style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
                        📱 {model.phoneModel}
                      </span>
                      <span style={{
                        marginLeft: '10px',
                        fontSize: '12px',
                        color: model.hasEnoughRiding ? '#10b981' : '#eab308',
                      }}>
                        {model.hasEnoughRiding ? '● Validated' : '○ Calibrating (< 10h)'}
                      </span>
                    </div>

                    <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                      Riding duration: <strong style={{ color: '#f8fafc' }}>{model.ridingHoursDisplay}</strong>
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#131d33', borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>
                          <th style={{ padding: '10px 16px', fontWeight: 600 }}>Metric</th>
                          <th style={{ padding: '10px 16px', fontWeight: 600 }}>Value</th>
                          <th style={{ padding: '10px 16px', fontWeight: 600 }}>Context & Guidance</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '12px 16px', fontWeight: 600, color: '#e2e8f0' }}>Riding Hours</td>
                          <td style={{ padding: '12px 16px', fontWeight: 700 }}>{model.ridingHoursDisplay}</td>
                          <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                            Sum of completed session durations (open sessions excluded).
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '12px 16px', fontWeight: 600, color: '#e2e8f0' }}>False Alarms / 1,000h</td>
                          <td style={{
                            padding: '12px 16px',
                            fontWeight: 700,
                            color: model.hasEnoughRiding ? '#38bdf8' : '#eab308',
                          }}>
                            {model.rateDisplay}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                            {model.hasEnoughRiding
                              ? `${model.falseAlarms} false alarm(s) across ${model.ridingHoursDisplay}`
                              : 'Requires at least 10 riding hours before displaying a rate.'}
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '12px 16px', fontWeight: 600, color: '#e2e8f0' }}>Check-ins Cancelled</td>
                          <td style={{ padding: '12px 16px', fontWeight: 700, color: '#10b981' }}>{model.checkInsCancelled}</td>
                          <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                            Cancelled alarms with outcome "cancelled_ok" (paired crash/suspected clips deduplicated).
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '12px 16px', fontWeight: 600, color: '#e2e8f0' }}>Staged Falls Caught</td>
                          <td style={{ padding: '12px 16px', fontWeight: 700, color: '#a855f7' }}>{model.stagedFallsDisplay}</td>
                          <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                            Staged drop trials (cushion drop, pocket fall, bag drop) detected on this phone.
                          </td>
                        </tr>
                        <tr>
                          <td style={{ padding: '12px 16px', fontWeight: 600, color: '#e2e8f0' }}>Total False Alarms</td>
                          <td style={{ padding: '12px 16px', fontWeight: 700 }}>{model.falseAlarms}</td>
                          <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                            Sensor clip false alarms (cancelled_ok, bump, nothing) + unconfirmed blackbox events.
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div style={{
          marginTop: '48px',
          borderTop: '1px solid #1e293b',
          paddingTop: '20px',
          fontSize: '12px',
          color: '#64748b',
          lineHeight: '1.6',
        }}>
          <div><strong>Safety & Privacy Rule:</strong> No location coordinates are used or rendered on this page.</div>
          <div>Alarms are calculated using deduplicated sensor clips and blackbox logs. This page is read-only.</div>
        </div>

      </div>
    </div>
  );
}

