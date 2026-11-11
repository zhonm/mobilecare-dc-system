import { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
  Area,
  Line,
  Cell,
  ReferenceLine
} from 'recharts';
import {
  Zap,
  TrendingUp,
  Clock,
  Award,
  Download,
  Search,
  Layers,
  Shield,
  Smartphone
} from 'lucide-react';
import { exportRowsToCsv } from '../../utils/dcStockMonitoringExporter';

const ChartTooltip = ({ active, payload, label, pctSuffix = false }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0f172a',
      color: '#fff',
      padding: '10px 14px',
      borderRadius: '8px',
      fontSize: '12px',
      border: '1px solid #334155',
      boxShadow: '0 6px 18px rgba(0,0,0,0.35)'
    }}>
      <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: '6px' }}>{label}</div>
      {payload.map((entry, idx) => (
        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '2px' }}>
          <span style={{ color: '#cbd5e1' }}>{entry.name}:</span>
          <strong style={{ color: entry.color || '#fff' }}>
            {typeof entry.value === 'number'
              ? (pctSuffix || String(entry.name).includes('%')
                  ? `${entry.value.toFixed(2)}%`
                  : entry.value.toLocaleString())
              : entry.value}
          </strong>
        </div>
      ))}
    </div>
  );
};

export default function SdrRepTatPanel({ analytics, onExportSdrPdf }) {
  const [viewCohort, setViewCohort] = useState('comparative'); // 'comparative' | 'all_2026' | 'orders_drilldown'
  const [tatMetricMode, setTatMetricMode] = useState('pct'); // 'pct' | 'count'
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [tatFilter, setTatFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const kpis = analytics?.kpis || {};
  const sdr = analytics?.sdrAndRepTat || {};
  const comp = sdr.repTatComparison || {};
  const all2026 = sdr.allOrders2026 || {};
  const dcStock = sdr.dcStock || {};
  const baseline2025 = sdr.baseline2025 || {};

  const tatChartData = useMemo(() => (
    (comp.tatComparison || []).map(r => ({
      category: r.category,
      '2025 Non-DC (%)': Number((r.pct2025 * 100).toFixed(2)),
      '2026 DC Stock (%)': Number((r.pct2026Dc * 100).toFixed(2)),
      '2025 Non-DC (Orders)': r.count2025,
      '2026 DC Stock (Orders)': r.count2026Dc
    }))
  ), [comp.tatComparison]);

  const warrantyChartData = useMemo(() => (
    (comp.warrantyComparison || []).map(w => ({
      warranty: w.warranty.replace('Customer Satisfaction (CS) Code', 'CS Code').replace('Out Of Warranty (No Coverage)', 'Out of Warranty'),
      '2025 Non-DC (%)': Number((w.pct2025 * 100).toFixed(2)),
      '2026 DC Stock (%)': Number((w.pct2026Dc * 100).toFixed(2)),
      '2025 Count': w.count2025,
      '2026 Count': w.count2026Dc
    }))
  ), [comp.warrantyComparison]);

  const monthlyTimelineData = useMemo(() => (
    (comp.combinedMonthlyTimeline || []).map(m => ({
      period: m.shortLabel,
      fullLabel: m.periodLabel,
      cohort: m.cohort,
      sdrCount: m.sdrCount,
      sdrRatePct: m.sdrRate !== null ? Number((m.sdrRate * 100).toFixed(2)) : null
    }))
  ), [comp.combinedMonthlyTimeline]);

  const multiSiteShiftData = useMemo(() => (
    (comp.multiSiteShiftSummary || []).map(s => ({
      shortSite: s.site.replace(/^MOBILECARE\s*-\s*/i, ''),
      site: s.site,
      '2025 Non-DC': s.sdr2025,
      '2026 DC Stock': s.sdr2026,
      difference: s.difference
    }))
  ), [comp.multiSiteShiftSummary]);

  const all2026SiteData = useMemo(() => (
    (all2026.siteBreakdown || []).slice(0, 18).map(s => ({
      shortSite: s.site.replace(/^MOBILECARE\s*-\s*/i, ''),
      site: s.site,
      'SDR Rate (%)': Number((s.sdrRate * 100).toFixed(1)),
      'SDR Count': s.sdrCount,
      'Total Orders': s.total,
      avgTat: Number((s.avgTatDays || 0).toFixed(1))
    }))
  ), [all2026.siteBreakdown]);

  const drilldownRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const src = all2026.validOrders || [];
    return src.filter(o => {
      if (siteFilter !== 'ALL' && o.locationName !== siteFilter) return false;
      if (tatFilter !== 'ALL' && o.tatCategory !== tatFilter) return false;
      if (q) {
        const hay = `${o.orderId} ${o.locationName} ${o.deviceDescription} ${o.deviceWarrantyName} ${o.tatCategory}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all2026.validOrders, siteFilter, tatFilter, searchQuery]);

  const uniqueSites = useMemo(() => {
    const s = new Set((all2026.validOrders || []).map(o => o.locationName).filter(Boolean));
    return Array.from(s).sort();
  }, [all2026.validOrders]);

  const totalPages = Math.max(1, Math.ceil(drilldownRows.length / pageSize));
  const pagedOrders = drilldownRows.slice((page - 1) * pageSize, page * pageSize);

  const delay16Plus2025 = (comp.tatComparison || []).find(t => t.category === '16+ Days')?.pct2025 || 0;
  const delay16Plus2026 = (comp.tatComparison || []).find(t => t.category === '16+ Days')?.pct2026Dc || 0;
  const delayReductionPp = (delay16Plus2025 - delay16Plus2026) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* KPI Hero Ribbon */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '14px'
      }}>
        <div className="card" style={{ borderLeft: '4px solid #16a34a' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>2026 DC STOCK SDR RATE</span>
            <Zap size={16} color="#16a34a" />
          </div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#15803d' }}>
            {(kpis.dcSdrRatePct || 0).toFixed(2)}%
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            <strong>{(dcStock.sdrCount || 0).toLocaleString()}</strong> SDR / {(dcStock.totalMatched || 0).toLocaleString()} RepTAT matched
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #64748b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>2025 NON-DC BASELINE</span>
            <Clock size={16} color="#64748b" />
          </div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#334155' }}>
            {(kpis.baseline2025SdrRatePct || 0).toFixed(2)}%
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            <strong>{(baseline2025.sdrCount || 0).toLocaleString()}</strong> SDR / {(baseline2025.totalCompleted || 0).toLocaleString()} completed
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #2563eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>DC VS NON-DC SDR LIFT</span>
            <TrendingUp size={16} color="#2563eb" />
          </div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: (kpis.sdrRateLiftPctPoints || 0) >= 0 ? '#1d4ed8' : '#dc2626' }}>
            {(kpis.sdrRateLiftPctPoints || 0) >= 0 ? '+' : ''}{(kpis.sdrRateLiftPctPoints || 0).toFixed(2)} pp
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            16+ Day Delays: {delayReductionPp >= 0 ? `-${delayReductionPp.toFixed(1)}` : `+${Math.abs(delayReductionPp).toFixed(1)}`} pp drop
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #0284c7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>ALL-ORDERS 2026 SDR</span>
            <Award size={16} color="#0284c7" />
          </div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#0369a1' }}>
            {(kpis.all2026SdrRatePct || 0).toFixed(2)}%
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {(all2026.sdrCount || 0).toLocaleString()} / {(all2026.totalCompleted || 0).toLocaleString()} orders • Avg {(kpis.all2026AvgTatDays || 0).toFixed(1)}d TAT
          </div>
        </div>
      </div>

      {/* Mode Switcher & Exports Bar */}
      <div className="card" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn ${viewCohort === 'comparative' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewCohort('comparative')}
          >
            <Layers size={15} /> RepTAT Breakdown (2025 vs 2026 DC)
          </button>
          <button
            type="button"
            className={`btn ${viewCohort === 'all_2026' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewCohort('all_2026')}
          >
            <Smartphone size={15} /> All-Orders 2026 SDR &amp; Device Mix
          </button>
          <button
            type="button"
            className={`btn ${viewCohort === 'orders_drilldown' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewCohort('orders_drilldown')}
          >
            <Search size={15} /> Orders Drill-Down ({(all2026.validOrders || []).length.toLocaleString()})
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={onExportSdrPdf}>
            <Download size={15} /> Export RepTAT Executive PDF
          </button>
        </div>
      </div>

      {/* VIEW 1: Redesigned Comparative RepTAT Breakdown (Charts 6–9 Enhanced) */}
      {viewCohort === 'comparative' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Row 1: TAT Distribution + Monthly Timeline */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '18px' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <h4 style={{ fontSize: '15px' }}>SDR &amp; TAT Distribution (2025 Non-DC vs 2026 DC Stock)</h4>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Same-Day Repair rate share vs multi-day aging tails
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    className={`btn ${tatMetricMode === 'pct' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '4px 10px', fontSize: '11.5px' }}
                    onClick={() => setTatMetricMode('pct')}
                  >
                    % Share
                  </button>
                  <button
                    type="button"
                    className={`btn ${tatMetricMode === 'count' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '4px 10px', fontSize: '11.5px' }}
                    onClick={() => setTatMetricMode('count')}
                  >
                    Count
                  </button>
                </div>
              </div>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tatChartData} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="category" tick={{ fontSize: 11.5, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11.5, fill: '#475569' }} unit={tatMetricMode === 'pct' ? '%' : ''} />
                    <Tooltip content={<ChartTooltip pctSuffix={tatMetricMode === 'pct'} />} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar
                      dataKey={tatMetricMode === 'pct' ? '2025 Non-DC (%)' : '2025 Non-DC (Orders)'}
                      fill="#94a3b8"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey={tatMetricMode === 'pct' ? '2026 DC Stock (%)' : '2026 DC Stock (Orders)'}
                      fill="#2563eb"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div style={{ marginBottom: '12px' }}>
                <h4 style={{ fontSize: '15px' }}>Continuous Monthly SDR Volume Trend (Aug 2025 – 2026)</h4>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Transition from Non-DC Stock (Aug 2025–Jan 2026) to DC Stock Replenishment (Feb 2026+)
                </div>
              </div>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyTimelineData} margin={{ top: 10, right: 16, left: 0, bottom: 32 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="period"
                      angle={-25}
                      textAnchor="end"
                      interval={0}
                      height={54}
                      tick={{ fontSize: 10.5, fill: '#475569' }}
                    />
                    <YAxis tick={{ fontSize: 11.5, fill: '#475569' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Area
                      type="monotone"
                      dataKey="sdrCount"
                      name="Monthly SDR Volume"
                      fill="#dbeafe"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                    />
                    <Bar dataKey="sdrCount" name="Orders Completed Same Day" barSize={22} radius={[4, 4, 0, 0]}>
                      {monthlyTimelineData.map((m, idx) => (
                        <Cell key={idx} fill={m.cohort.includes('2026') ? '#16a34a' : '#64748b'} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Row 2: Warranty Distribution + Multi-Site Shift Leaderboard */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '18px' }}>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Shield size={16} color="#7c3aed" />
                <h4 style={{ fontSize: '15px' }}>SDR Warranty Distribution Share (Non-DC vs DC)</h4>
              </div>
              <div style={{ width: '100%', height: 290 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={warrantyChartData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" unit="%" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis type="category" dataKey="warranty" width={135} tick={{ fontSize: 11, fill: '#334155' }} />
                    <Tooltip content={<ChartTooltip pctSuffix />} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="2025 Non-DC (%)" fill="#94a3b8" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="2026 DC Stock (%)" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div style={{ marginBottom: '12px' }}>
                <h4 style={{ fontSize: '15px' }}>Multi-Site SDR Growth &amp; Shift Summary (Top 16 Branches)</h4>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Net change (2026 DC Stock SDR minus 2025 Non-DC SDR)
                </div>
              </div>
              <div style={{ width: '100%', height: 290 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={multiSiteShiftData.slice(0, 16)} margin={{ top: 10, right: 16, left: 0, bottom: 38 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="shortSite"
                      angle={-30}
                      textAnchor="end"
                      interval={0}
                      height={58}
                      tick={{ fontSize: 10.5, fill: '#475569' }}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={0} stroke="#0f172a" />
                    <Bar dataKey="difference" name="Net SDR Change (2026 - 2025)" radius={[4, 4, 0, 0]}>
                      {multiSiteShiftData.slice(0, 16).map((entry, idx) => (
                        <Cell key={idx} fill={entry.difference >= 0 ? '#16a34a' : '#dc2626'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Complete Multi-Site Shift Table */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <h4 style={{ fontSize: '15px' }}>Branch-by-Branch SDR Performance Comparison Matrix</h4>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={() => exportRowsToCsv(
                  ['Branch Site', 'SDR 2025 (Non-DC)', 'SDR 2026 (DC Stock)', 'Difference'],
                  multiSiteShiftData.map(s => [s.site, s['2025 Non-DC'], s['2026 DC Stock'], s.difference]),
                  'MDC_MultiSite_SDR_Shift'
                )}
              >
                <Download size={14} /> Export CSV
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-light)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>Site Name</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>SDR 2025 (Non-DC)</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>SDR 2026 (DC)</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Difference</th>
                    <th style={{ padding: '8px 10px' }}>Trend Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {multiSiteShiftData.map((row) => (
                    <tr key={row.site} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 500 }}>{row.site}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row['2025 Non-DC'].toLocaleString()}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{row['2026 DC Stock'].toLocaleString()}</td>
                      <td style={{
                        padding: '8px 10px',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: row.difference > 0 ? '#15803d' : row.difference < 0 ? '#dc2626' : '#64748b'
                      }}>
                        {row.difference > 0 ? `+${row.difference}` : row.difference}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span className={`badge badge-${row.difference > 0 ? 'success' : row.difference < 0 ? 'danger' : 'neutral'}`}>
                          {row.difference > 0 ? 'Accelerated' : row.difference < 0 ? 'Declined' : 'Flat'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: All-Orders 2026 SDR Analytics (from same-day-repair-*.xlsx) */}
      {viewCohort === 'all_2026' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '18px' }}>
            <div className="card">
              <h4 style={{ fontSize: '15px', marginBottom: '4px' }}>All-Orders 2026 Branch SDR Rate (%) &amp; Avg TAT</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                Normalized across {(all2026.totalCompleted || 0).toLocaleString()} closed Fixably repair orders ({(all2026.openOrMissingDates || 0).toLocaleString()} open orders excluded)
              </p>
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={all2026SiteData} margin={{ top: 10, right: 16, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="shortSite" angle={-28} textAnchor="end" interval={0} height={60} tick={{ fontSize: 10.5, fill: '#475569' }} />
                    <YAxis yAxisId="left" unit="%" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis yAxisId="right" orientation="right" unit="d" tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar yAxisId="left" dataKey="SDR Rate (%)" fill="#0284c7" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="avgTat" name="Avg RepTAT (days)" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h4 style={{ fontSize: '15px', marginBottom: '4px' }}>Top iPhone / Device Models by Repair Volume &amp; SDR Speed</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                Highlighting repair turnaround across device families
              </p>
              <div style={{ overflowY: 'auto', maxHeight: 320 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-light)', textAlign: 'left', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '8px 10px' }}>Device Model</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>SDR</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>SDR %</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Avg TAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(all2026.deviceBreakdown || []).slice(0, 30).map((d) => (
                      <tr key={d.device} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={{ padding: '7px 10px', fontWeight: 500 }}>{d.device}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{d.total.toLocaleString()}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#15803d', fontWeight: 600 }}>{d.sdrCount.toLocaleString()}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{(d.sdrRate * 100).toFixed(1)}%</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{d.avgTatDays.toFixed(1)}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: Searchable SDR Order Drill-Down */}
      {viewCohort === 'orders_drilldown' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', flex: 1 }}>
              <input
                type="text"
                placeholder="Search Order ID, Device, Branch, Warranty..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-strong)', minWidth: '240px', fontSize: '13px' }}
              />
              <select
                value={siteFilter}
                onChange={(e) => { setSiteFilter(e.target.value); setPage(1); }}
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '13px' }}
              >
                <option value="ALL">All Sites ({uniqueSites.length})</option>
                {uniqueSites.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={tatFilter}
                onChange={(e) => { setTatFilter(e.target.value); setPage(1); }}
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '13px' }}
              >
                <option value="ALL">All TAT Categories</option>
                {['SDR', '1–3 Days', '4–6 Days', '7–9 Days', '10–12 Days', '13–15 Days', '16+ Days'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '7px 12px' }}
              onClick={() => exportRowsToCsv(
                ['Order ID', 'Received', 'Closed', 'Site', 'Device', 'Warranty', 'TAT Category', 'TAT Days'],
                drilldownRows.map(o => [o.orderId, o.receivedDate, o.closedDate, o.locationName, o.deviceDescription, o.deviceWarrantyName, o.tatCategory, o.tatDays]),
                'MDC_SDR_Orders_Drilldown'
              )}
            >
              <Download size={14} /> Export Filtered ({drilldownRows.length})
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-light)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Order ID</th>
                  <th style={{ padding: '8px 10px' }}>Received</th>
                  <th style={{ padding: '8px 10px' }}>Closed</th>
                  <th style={{ padding: '8px 10px' }}>Location</th>
                  <th style={{ padding: '8px 10px' }}>Device</th>
                  <th style={{ padding: '8px 10px' }}>Warranty</th>
                  <th style={{ padding: '8px 10px' }}>RepTAT</th>
                </tr>
              </thead>
              <tbody>
                {pagedOrders.map((o) => (
                  <tr key={`${o.orderId}-${o.rowIndex}`} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{o.orderId}</td>
                    <td style={{ padding: '7px 10px' }}>{o.receivedDate}</td>
                    <td style={{ padding: '7px 10px' }}>{o.closedDate}</td>
                    <td style={{ padding: '7px 10px' }}>{o.locationName}</td>
                    <td style={{ padding: '7px 10px' }}>{o.deviceDescription}</td>
                    <td style={{ padding: '7px 10px', fontSize: '11.5px', color: 'var(--text-muted)' }}>{o.deviceWarrantyName}</td>
                    <td style={{ padding: '7px 10px' }}>
                      <span className={`badge badge-${o.isSdr ? 'success' : o.tatDays <= 3 ? 'primary' : o.tatDays >= 16 ? 'danger' : 'warning'}`}>
                        {o.tatCategory} ({o.tatDays}d)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '12.5px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Page {page} of {totalPages} • {drilldownRows.length.toLocaleString()} orders</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
                <button type="button" className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
