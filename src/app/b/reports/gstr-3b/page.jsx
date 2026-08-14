'use client';
// src/app/b/reports/gstr-3b/page.jsx
// GSTR-3B DRAFT viewer — computed from your ledger + invoices.
//
// Deliberate framing: this page shows a DRAFT return the merchant reviews and
// files elsewhere (GST portal or a GSP). The disclaimer is loud because
// wrong 3B numbers attract interest under Section 50 and late fees under
// Section 47 — automating the arithmetic without owning the filing is the
// safe, useful thing to do now.
import { useState, useEffect, useCallback } from 'react';
import { resolveWorkspace } from '@/lib/resolve-workspace';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { supabase } from '@/lib/supabase';
import { apiGet } from '@/lib/safeFetch';
import BizNavbar from '@/components/biz/BizNavbar';
import {
  AuroraPage, PageHeader, SectionTitle, Grid, GlassCard,
  StatTile, NudgeCard, Pill, SkeletonCard,
} from '@/components/aurora';

function fmt(v) {
  return `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function nowMonth() { return new Date().toISOString().slice(0, 7); }
function prevMonth(period) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}
function labelMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

const WARNING_LABELS = {
  no_issued_invoices_in_period: 'No sent/paid invoices found for this period.',
  no_gst_purchases_logged_ITC_is_zero_verify: 'No purchases with GST logged — ITC is zero. Verify you have no eligible input tax.',
  itc_split_assumes_intra_state_verify_inter_state_purchases: 'ITC is split as CGST + SGST assuming intra-state purchases. Adjust for any inter-state (IGST) purchases.',
  zero_rated_exempt_non_gst_supplies_not_auto_detected_add_manually: 'Zero-rated / nil-rated / non-GST supplies are not auto-detected — enter tables 3.1(b/c/e) manually.',
  rcm_inward_3_1_d_not_auto_detected_add_manually: 'Reverse-charge inward supplies (3.1(d)) not auto-detected — enter manually.',
  itc_reversals_and_ineligible_itc_manual_only: 'ITC reversals (4B) and ineligible ITC (4D) are manual entries.',
  workspace_has_no_gstin_configured: 'Your workspace has no GSTIN configured in settings.',
};

export default function GSTR3BPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [period, setPeriod] = useState(prevMonth(nowMonth())); // default: last month (filing month)
  const [workspace, setWorkspace] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (p) => {
    setLoading(true); setError(null);
    try {
      const res = await apiGet(`/api/business/gstr-3b?period=${p}`, accessToken);
      if (res?.error) setError(res.error); else setData(res);
    } catch (e) { setError(e?.message || 'Could not load draft'); }
    setLoading(false);
  }, [accessToken]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
      const ws = await resolveWorkspace(supabase, user.id, 'id,name');
      if (!ws) { router.replace('/b/onboarding'); return; }
      setWorkspace(ws);
      load(period);
    })();
  }, [user, authLoading, router, load, period]);

  const t = data?.tables || {};
  const tot = data?.totals || {};

  return (
    <AuroraPage mode="business">
      <BizNavbar />

      <PageHeader
        title="GSTR-3B draft"
        subtitle={`Auto-computed for ${labelMonth(period)}. Review every line before filing on the GST portal.`}
        action={
          <input
            type="month" value={period}
            onChange={e => setPeriod(e.target.value || nowMonth())}
            max={nowMonth()} className="qk-month"
          />
        }
      />

      <NudgeCard
        title="Draft — not filed"
        body="This is a computed draft. QuietKeep does not file it. Verify every number on the GST portal — wrong figures attract interest under Section 50 and late fees under Section 47."
        icon="⚖️" tone="amber"
      />

      {error && <NudgeCard title="Could not load draft" body={error} icon="⚠️" tone="amber" onDismiss={() => setError(null)} />}

      {loading ? (
        <Grid min={220}><SkeletonCard lines={3} /><SkeletonCard lines={3} /><SkeletonCard lines={3} /></Grid>
      ) : data && (
        <>
          <Grid min={170}>
            <StatTile label="Output tax (total)" hue="#0ea5e9"
              value={Math.round((tot.output_tax?.cgst || 0) + (tot.output_tax?.sgst || 0) + (tot.output_tax?.igst || 0))}
              prefix="₹" />
            <StatTile label="ITC available" hue="#10b981"
              value={Math.round((tot.itc_available?.cgst || 0) + (tot.itc_available?.sgst || 0) + (tot.itc_available?.igst || 0))}
              prefix="₹" />
            <StatTile label="Net payable" hue="#f59e0b"
              value={Math.round(tot.net_payable?.total || 0)} prefix="₹"
              hint={`${data.counts?.invoices_included || 0} invoices · ${data.counts?.purchases_with_gst || 0} purchases with GST`} />
          </Grid>

          <SectionTitle hint="from issued invoices">3.1 Outward taxable supplies</SectionTitle>
          <GlassCard>
            <table className="qk-tbl">
              <thead><tr><th>Row</th><th className="qk-r">Taxable</th><th className="qk-r">CGST</th><th className="qk-r">SGST</th><th className="qk-r">IGST</th></tr></thead>
              <tbody>
                <tr>
                  <td>(a) Outward taxable (excl. zero/nil/exempt)</td>
                  <td className="qk-r">{fmt(t['3.1_a_outward_taxable']?.taxable_value)}</td>
                  <td className="qk-r">{fmt(t['3.1_a_outward_taxable']?.cgst)}</td>
                  <td className="qk-r">{fmt(t['3.1_a_outward_taxable']?.sgst)}</td>
                  <td className="qk-r">{fmt(t['3.1_a_outward_taxable']?.igst)}</td>
                </tr>
                {['3.1_b_zero_rated','3.1_c_nil_exempt','3.1_d_inward_rcm','3.1_e_non_gst'].map(k => (
                  <tr key={k} className="qk-manual">
                    <td>{t[k]?.label} <Pill tone="warn">manual</Pill></td>
                    <td className="qk-r qk-dash" colSpan={4}>enter on GST portal</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>

          <SectionTitle hint="from ledger purchases with GST">4 Eligible ITC</SectionTitle>
          <GlassCard>
            <table className="qk-tbl">
              <thead><tr><th>Row</th><th className="qk-r">CGST</th><th className="qk-r">SGST</th><th className="qk-r">IGST</th></tr></thead>
              <tbody>
                <tr>
                  <td>(A)(5) All other ITC</td>
                  <td className="qk-r">{fmt(t['4_A_5_other_itc']?.cgst)}</td>
                  <td className="qk-r">{fmt(t['4_A_5_other_itc']?.sgst)}</td>
                  <td className="qk-r">{fmt(t['4_A_5_other_itc']?.igst)}</td>
                </tr>
                <tr className="qk-manual">
                  <td>(B) ITC reversals <Pill tone="warn">manual</Pill></td>
                  <td className="qk-r qk-dash" colSpan={3}>enter on GST portal</td>
                </tr>
                <tr className="qk-manual">
                  <td>(D) Ineligible ITC — Sec 17(5) <Pill tone="warn">manual</Pill></td>
                  <td className="qk-r qk-dash" colSpan={3}>enter on GST portal</td>
                </tr>
              </tbody>
            </table>
          </GlassCard>

          <SectionTitle>Net tax payable</SectionTitle>
          <GlassCard>
            <table className="qk-tbl">
              <thead><tr><th></th><th className="qk-r">CGST</th><th className="qk-r">SGST</th><th className="qk-r">IGST</th><th className="qk-r">Total</th></tr></thead>
              <tbody>
                <tr><td>Output tax</td>
                  <td className="qk-r">{fmt(tot.output_tax?.cgst)}</td>
                  <td className="qk-r">{fmt(tot.output_tax?.sgst)}</td>
                  <td className="qk-r">{fmt(tot.output_tax?.igst)}</td>
                  <td className="qk-r">{fmt((tot.output_tax?.cgst||0)+(tot.output_tax?.sgst||0)+(tot.output_tax?.igst||0))}</td></tr>
                <tr><td>Less: ITC</td>
                  <td className="qk-r">−{fmt(tot.itc_available?.cgst)}</td>
                  <td className="qk-r">−{fmt(tot.itc_available?.sgst)}</td>
                  <td className="qk-r">−{fmt(tot.itc_available?.igst)}</td>
                  <td className="qk-r">−{fmt((tot.itc_available?.cgst||0)+(tot.itc_available?.sgst||0)+(tot.itc_available?.igst||0))}</td></tr>
                <tr className="qk-total"><td><strong>Net payable</strong></td>
                  <td className="qk-r"><strong>{fmt(tot.net_payable?.cgst)}</strong></td>
                  <td className="qk-r"><strong>{fmt(tot.net_payable?.sgst)}</strong></td>
                  <td className="qk-r"><strong>{fmt(tot.net_payable?.igst)}</strong></td>
                  <td className="qk-r"><strong>{fmt(tot.net_payable?.total)}</strong></td></tr>
              </tbody>
            </table>
            <p className="qk-note">Heads never cross-set-off in 3B. Interest and late fees (Table 6.1) not included — add on the portal if applicable.</p>
          </GlassCard>

          {data.warnings?.length > 0 && (
            <>
              <SectionTitle hint="review before filing">Notes and things to add manually</SectionTitle>
              <GlassCard>
                <ul className="qk-warn">
                  {data.warnings.map((w, i) => (
                    <li key={i}>{WARNING_LABELS[w] || w.replace(/_/g, ' ')}</li>
                  ))}
                </ul>
              </GlassCard>
            </>
          )}

          <SectionTitle>Export</SectionTitle>
          <GlassCard>
            <p className="qk-note">
              Copy the raw JSON to feed a GSP integration, or use the numbers above to fill the portal by hand.
            </p>
            <details className="qk-details">
              <summary>Show raw JSON</summary>
              <pre className="qk-pre">{JSON.stringify(data, null, 2)}</pre>
            </details>
          </GlassCard>
        </>
      )}

      <style jsx global>{`
        .qk-month { padding: 8px 12px; border-radius: 10px; font-size: 13px; font-weight: 600;
          border: 1px solid rgba(255,255,255,0.9); background: rgba(255,255,255,0.8); color: var(--ink); }
        .qk-tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
        .qk-tbl th { text-align: left; padding: 8px 6px; color: var(--muted); font-weight: 600; font-size: 12px;
          border-bottom: 1px solid rgba(15,23,42,0.09); }
        .qk-tbl td { padding: 10px 6px; border-bottom: 1px solid rgba(15,23,42,0.06); }
        .qk-r { text-align: right; }
        .qk-manual td:first-child { color: var(--muted); }
        .qk-dash { color: var(--muted); font-style: italic; font-size: 12.5px; }
        .qk-total td { border-top: 2px solid rgba(15,23,42,0.15); padding-top: 12px; }
        .qk-note { margin: 10px 0 0; font-size: 12.5px; color: var(--muted); }
        .qk-warn { margin: 0; padding-left: 22px; font-size: 13px; color: var(--ink); line-height: 1.6; }
        .qk-warn li { margin-bottom: 4px; }
        .qk-details { margin-top: 8px; }
        .qk-details summary { cursor: pointer; font-size: 13px; color: var(--muted); font-weight: 600; }
        .qk-pre { margin-top: 10px; padding: 12px; border-radius: 8px; background: rgba(15,23,42,0.06);
          font-size: 11px; overflow-x: auto; max-height: 400px; }
      `}</style>
    </AuroraPage>
  );
}
