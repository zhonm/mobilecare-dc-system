import { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import {
  Package,
  Truck,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Download,
  Plus,
  Trash2,
  MessageSquare,
  Save,
  ShieldAlert,
  TrendingUp,
  Info
} from 'lucide-react';
import { MONTH_NAMES } from '../../utils/dcStockMonitoringEngine';
import { exportRowsToCsv } from '../../utils/dcStockMonitoringExporter';

const PALETTE = ['#2563eb', '#16a34a', '#7c3aed', '#0284c7', '#d97706', '#dc2626', '#0d9488', '#64748b'];

function formatPhp(amount) {
  return `₱${(Number(amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SimplePaginatedTable({ columns, rows, rowKey, emptyText = 'No matching records found.', exportName }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      columns.some(col => {
        const val = typeof col.raw === 'function' ? col.raw(r) : r[col.key];
        return String(val ?? '').toLowerCase().includes(q);
      })
    );
  }, [rows, columns, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <input
          type="text"
          value={search}
          placeholder="Filter table by serial, order ID, part, or branch..."
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ padding: '7px 12px', borderRadius: '6px', border: '1px solid var(--border-strong)', minWidth: '250px', fontSize: '12.5px' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {filtered.length.toLocaleString()} record(s)
          </span>
          {exportName && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '5px 10px', fontSize: '12px' }}
              onClick={() => exportRowsToCsv(
                columns.map(c => c.label),
                filtered.map(r => columns.map(c => (typeof c.raw === 'function' ? c.raw(r) : r[c.key] ?? ''))),
                exportName
              )}
            >
              <Download size={13} /> CSV
            </button>
          )}
        </div>
      </div>

      {paged.length === 0 ? (
        <div style={{ padding: '26px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', border: '1px dashed var(--border-light)', borderRadius: '8px' }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-light)', textAlign: 'left' }}>
                {columns.map(c => (
                  <th key={c.key} style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: c.align || 'left' }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((row, idx) => (
                <tr key={rowKey ? rowKey(row, idx) : idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  {columns.map(c => (
                    <td key={c.key} style={{ padding: '7px 10px', textAlign: c.align || 'left' }}>
                      {c.render ? c.render(row) : (row[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', fontSize: '12px' }}>
          <span style={{ color: 'var(--text-muted)' }}>Page {safePage} of {totalPages}</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: '12px' }} disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
            <button type="button" className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: '12px' }} disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 1. Executive Overview & Reconciliation Panel ─────────────────────────────
export function OverviewPanel({ analytics, onNavigateTab }) {
  const kpis = analytics?.kpis || {};
  const checks = analytics?.reconciliationChecks || [];
  const aging = analytics?.siteStocks?.agingSummary || {};

  const combinedMonthly = useMemo(() => {
    const salesMonth = analytics?.salesDc?.byMonth || [];
    const dcMonthlyTransfer = analytics?.transferAnalytics?.monthlyTransferVolume || [];
    const months = new Set([
      ...dcMonthlyTransfer.map(m => m.month),
      ...salesMonth.map(m => m.month)
    ]);
    return Array.from(months)
      .sort((a, b) => MONTH_NAMES.indexOf(a) - MONTH_NAMES.indexOf(b))
      .map(m => ({
        month: m.slice(0, 3),
        transfers: dcMonthlyTransfer.find(x => x.month === m)?.count || 0,
        salesPhp: salesMonth.find(x => x.month === m)?.totalAmount || 0
      }));
  }, [analytics]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Executive KPI Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div className="card" style={{ borderLeft: '4px solid #2563eb', cursor: 'pointer' }} onClick={() => onNavigateTab('transfers-shipping')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
            <span>DC TRANSFERRED SERIALS</span>
            <Truck size={15} color="#2563eb" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '6px' }}>{(kpis.dcTransferSerialCount || 0).toLocaleString()}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Used: <strong>{(kpis.dcUsedCount || 0).toLocaleString()}</strong> • On-Hand: <strong>{(kpis.dcUnusedOnHandCount || 0).toLocaleString()}</strong>
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #16a34a', cursor: 'pointer' }} onClick={() => onNavigateTab('sdr-reptat')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
            <span>DC STOCK SDR RATE</span>
            <TrendingUp size={15} color="#16a34a" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#15803d', marginTop: '6px' }}>
            {(kpis.dcSdrRatePct || 0).toFixed(2)}%
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            +{(kpis.sdrRateLiftPctPoints || 0).toFixed(2)} pp vs 2025 Non-DC ({(kpis.baseline2025SdrRatePct || 0).toFixed(2)}%)
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #047857', cursor: 'pointer' }} onClick={() => onNavigateTab('sales-warranty')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
            <span>DC STOCK SALES REVENUE</span>
            <DollarSign size={15} color="#047857" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '6px' }}>
            {formatPhp(kpis.totalDcSalesPhp)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {(kpis.salesOrderCount || 0).toLocaleString()} Picked-Up Orders • Avg {formatPhp(kpis.avgOrderValuePhp)}
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #d97706', cursor: 'pointer' }} onClick={() => onNavigateTab('exceptions')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
            <span>ACTION &amp; EXCEPTION QUEUES</span>
            <AlertTriangle size={15} color="#d97706" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#b45309', marginTop: '6px' }}>
            {((kpis.nonSerialRepairCount || 0) + (kpis.unusedS2SCount || 0) + (kpis.doaDcCount || 0) + (kpis.duplicateSerialRowCount || 0)).toLocaleString()}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Undispatched CIN: {(kpis.undispatchedCinCount || 0).toLocaleString()} • DOA DC: {kpis.doaDcCount || 0} • GPR: {kpis.gprCount || 0}
          </div>
        </div>
      </div>

      {/* Charts + Health Checks Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '18px' }}>
        <div className="card">
          <h4 style={{ fontSize: '15px', marginBottom: '4px' }}>Monthly DC Transfers vs DC Stock Sales Revenue</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Tracking replenishment velocity alongside commercial revenue realization
          </p>
          <div style={{ width: '100%', height: 270 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={combinedMonthly} margin={{ top: 10, right: 16, left: 8, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11.5 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v / 1000000).toFixed(1)}M`} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area yAxisId="left" type="monotone" dataKey="transfers" name="DC Transfers (Units)" fill="#dbeafe" stroke="#2563eb" strokeWidth={2} />
                <Area yAxisId="right" type="monotone" dataKey="salesPhp" name="DC Sales (PHP)" fill="#dcfce7" stroke="#16a34a" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ fontSize: '15px' }}>Automated Reconciliation &amp; Data Integrity Scorecard</h4>
            <span className="badge badge-info">As of {analytics?.referenceDate}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {checks.map(chk => (
              <div
                key={chk.id}
                style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: chk.status === 'warning' ? '#fffbeb' : '#f8fafc',
                  border: `1px solid ${chk.status === 'warning' ? '#fde68a' : 'var(--border-light)'}`
                }}
              >
                {chk.status === 'warning'
                  ? <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                  : chk.status === 'pass'
                    ? <CheckCircle2 size={16} color="#16a34a" style={{ flexShrink: 0, marginTop: '2px' }} />
                    : <Info size={16} color="#0284c7" style={{ flexShrink: 0, marginTop: '2px' }} />}
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>{chk.title}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{chk.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Unused DC Aging Summary Banner */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Package size={18} color="#0284c7" />
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px' }}>Unused Stock Aging Risk Summary (DC &amp; MSPI Combined)</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Total Active Unused Serials: {(aging.totalActive || 0).toLocaleString()} ({(aging.dcUnusedTotal || 0).toLocaleString()} DC-sourced)
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <span className="badge badge-success">In Stock (&lt;60d): {(aging.inStock || 0).toLocaleString()}</span>
          <span className="badge badge-warning">Slow-Moving (60–89d): {(aging.slowMoving || 0).toLocaleString()}</span>
          <span className="badge badge-warning">Non-Moving (90–179d): {(aging.nonMoving || 0).toLocaleString()}</span>
          <span className="badge badge-danger">Dead Stock (180+d): {(aging.deadStock || 0).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// ── 2. Site Stocks Reconciliation & DC Used Serials Panel ────────────────────
export function SiteStocksAgingPanel({ analytics }) {
  const [subTab, setSubTab] = useState('reconciled'); // 'reconciled' | 'dc_used' | 'undispatched_2026'
  const [stockTypeFilter, setStockTypeFilter] = useState('ALL');
  const [agingFilter, setAgingFilter] = useState('ALL');

  const reconciled = analytics?.siteStocks?.reconciledInventory;
  const dcUsed = analytics?.dcUsedSerials || [];
  const undisp2026 = analytics?.siteStocks?.undispatched2026 || [];

  const filteredReconciled = useMemo(() => (
    (reconciled || []).filter(r => {
      if (stockTypeFilter !== 'ALL' && r.stockType !== stockTypeFilter) return false;
      if (agingFilter !== 'ALL' && r.agingBucket !== agingFilter) return false;
      return true;
    })
  ), [reconciled, stockTypeFilter, agingFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="card" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" className={`btn ${subTab === 'reconciled' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSubTab('reconciled')}>
            Reconciled Site Stocks ({(reconciled || []).length.toLocaleString()})
          </button>
          <button type="button" className={`btn ${subTab === 'dc_used' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSubTab('dc_used')}>
            DC Used Serials &amp; RepTAT ({dcUsed.length.toLocaleString()})
          </button>
          <button type="button" className={`btn ${subTab === 'undispatched_2026' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSubTab('undispatched_2026')}>
            2026 Dispatched Orders ({undisp2026.length.toLocaleString()})
          </button>
        </div>

        {subTab === 'reconciled' && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <select value={stockTypeFilter} onChange={(e) => setStockTypeFilter(e.target.value)} style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '12.5px' }}>
              <option value="ALL">All Stock Types</option>
              <option value="DC Stock">DC Stock</option>
              <option value="MSPI Owned/ CIN REP">MSPI Owned / CIN REP</option>
            </select>
            <select value={agingFilter} onChange={(e) => setAgingFilter(e.target.value)} style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '12.5px' }}>
              <option value="ALL">All Aging States</option>
              <option value="Consumed">Consumed (Used)</option>
              <option value="In Stock">In Stock (&lt;60d)</option>
              <option value="Slow-Moving">Slow-Moving (60–89d)</option>
              <option value="Non-Moving">Non-Moving (90–179d)</option>
              <option value="Dead Stock">Dead Stock (180+d)</option>
            </select>
          </div>
        )}
      </div>

      <div className="card">
        {subTab === 'reconciled' && (
          <SimplePaginatedTable
            exportName="MDC_Reconciled_Site_Stocks"
            rows={filteredReconciled}
            rowKey={(r, idx) => `${r.transferredSerial}-${idx}`}
            columns={[
              { key: 'adjustedReceivedDate', label: 'Adj. Received' },
              { key: 'repairClosedDate', label: 'Repair Closed' },
              { key: 'stockName', label: 'Stock Site' },
              { key: 'serialUsedBy', label: 'Serial Used By', render: r => (
                <span style={{ color: String(r.serialUsedBy).startsWith('Transferred to') ? '#b45309' : 'inherit', fontWeight: String(r.serialUsedBy).startsWith('Transferred to') ? 600 : 400 }}>
                  {r.serialUsedBy || '—'}
                </span>
              ) },
              { key: 'partNumber', label: 'Part No.' },
              { key: 'partDescription', label: 'Description' },
              { key: 'transferredSerial', label: 'Serial', render: r => <span className="font-mono">{r.transferredSerial}</span> },
              { key: 'orderNumber', label: 'Order ID' },
              { key: 'stockType', label: 'Stock Type', render: r => <span className={`badge badge-${r.stockType === 'DC Stock' ? 'primary' : 'neutral'}`}>{r.stockType}</span> },
              { key: 'agingStatus', label: 'Aging / Status', render: r => (
                r.agingStatus ? (
                  <span className={`badge badge-${r.agingBucket === 'Dead Stock' ? 'danger' : r.agingBucket === 'In Stock' ? 'success' : 'warning'}`}>
                    {r.agingStatus}
                  </span>
                ) : <span className="badge badge-neutral">Used</span>
              ) },
              { key: 'isDuplicate', label: 'Dup', raw: r => (r.isDuplicate ? 'DUPLICATE' : ''), render: r => r.isDuplicate ? <span className="badge badge-danger">DUP</span> : '' }
            ]}
          />
        )}

        {subTab === 'dc_used' && (
          <SimplePaginatedTable
            exportName="MDC_DC_Used_Serials_RepTAT"
            rows={dcUsed}
            rowKey={(r, idx) => `${r.transferredSerial}-${idx}`}
            columns={[
              { key: 'transferReceivedDate', label: 'Transfer Date' },
              { key: 'repairClosedDate', label: 'Repair Closed' },
              { key: 'toStock', label: 'To Stock' },
              { key: 'serialUsedBy', label: 'Serial Used By' },
              { key: 'partNumber', label: 'Part No.' },
              { key: 'partDescription', label: 'Description' },
              { key: 'transferredSerial', label: 'Serial', render: r => <span className="font-mono">{r.transferredSerial}</span> },
              { key: 'orderId', label: 'Order ID' },
              { key: 'repTat', label: 'RepTAT', render: r => (
                r.repTat ? (
                  <span className={`badge badge-${r.repTat === 'SDR' ? 'success' : r.repTatDays >= 16 ? 'danger' : 'info'}`}>
                    {r.repTat}
                  </span>
                ) : <span style={{ color: '#94a3b8' }}>—</span>
              ) }
            ]}
          />
        )}

        {subTab === 'undispatched_2026' && (
          <SimplePaginatedTable
            exportName="MDC_2026_Dispatched_Orders"
            rows={undisp2026}
            rowKey={(r, idx) => `${r.transferredSerial}-${idx}`}
            columns={[
              { key: 'adjustedReceivedDate', label: 'Transfer Received' },
              { key: 'repairClosedDate', label: 'Repair Closed' },
              { key: 'stockName', label: 'To Stock' },
              { key: 'serialUsedBy', label: 'Serial Used By' },
              { key: 'partNumber', label: 'Part Number' },
              { key: 'partDescription', label: 'Part Description' },
              { key: 'transferredSerial', label: 'Serial', render: r => <span className="font-mono">{r.transferredSerial}</span> },
              { key: 'orderNumber', label: 'Order ID' },
              { key: 'stockType', label: 'Stock Type' }
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ── 3. DC Stock Transfers & Shipping Cost Ledger Panel ───────────────────────
export function TransfersShippingPanel({ analytics, onSaveShippingCosts }) {
  const [productCatTab, setProductCatTab] = useState('all'); // 'all' | 'batteries' | 'displays'
  const [newCost, setNewCost] = useState({ month: 'November', year: 2026, courier: 'Lalamove', amount: '', notes: '' });

  const ta = analytics?.transferAnalytics;
  const kpis = analytics?.kpis || {};
  const costs = ta?.shippingCosts || [];

  const productData = useMemo(() => {
    const src = productCatTab === 'batteries'
      ? ta?.topBatteries
      : productCatTab === 'displays'
        ? ta?.topDisplays
        : ta?.topTransferredProducts;
    return (src || []).slice(0, 12);
  }, [productCatTab, ta]);

  const handleAddShipping = () => {
    const amt = Number(newCost.amount);
    if (!newCost.month || !Number.isFinite(amt) || amt <= 0) return;
    const updated = [
      ...costs,
      {
        id: `ship-${Date.now()}`,
        month: newCost.month,
        year: Number(newCost.year) || 2026,
        courier: newCost.courier || 'Lalamove',
        amount: amt,
        notes: newCost.notes || ''
      }
    ];
    onSaveShippingCosts(updated);
    setNewCost({ ...newCost, amount: '', notes: '' });
  };

  const handleDeleteCost = (id) => {
    onSaveShippingCosts(costs.filter(c => c.id !== id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div className="card" style={{ borderLeft: '4px solid #2563eb' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>DC OUTBOUND SHIPMENTS</div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '6px' }}>{(kpis.dcTransferRawCount || 0).toLocaleString()}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{(kpis.dcTransferSerialCount || 0).toLocaleString()} unique serials</div>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #7c3aed' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL DC SHIPPING COST</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#6d28d9', marginTop: '6px' }}>{formatPhp(kpis.totalShippingCostPhp)}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{costs.length} logged expense entries</div>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #0284c7' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>COST PER DC TRANSFER</div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '6px' }}>{formatPhp(kpis.costPerDcTransferPhp)}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Logistics cost as {(kpis.shippingCostPctOfSales || 0).toFixed(2)}% of DC Sales</div>
        </div>
      </div>

      {/* Charts 1 & 2: Monthly Volume + Top Destination Branches */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '18px' }}>
        <div className="card">
          <h4 style={{ fontSize: '15px', marginBottom: '12px' }}>Monthly DC Stock Transfer Volume</h4>
          <div style={{ width: '100%', height: 270 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ta?.monthlyTransferVolume || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11.5 }} />
                <YAxis tick={{ fontSize: 11.5 }} />
                <Tooltip />
                <Bar dataKey="count" name="Transfer Volume" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h4 style={{ fontSize: '15px', marginBottom: '12px' }}>Top Receiving Sites (DC Outbound Transfers)</h4>
          <div style={{ width: '100%', height: 270 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(ta?.transferDestinationBreakdown || []).slice(0, 14)} layout="vertical" margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="toStock" width={125} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name="Units Received" fill="#0284c7" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Products / Batteries / Displays + Shipping Ledger Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '18px' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <h4 style={{ fontSize: '15px' }}>Top Transferred Products Breakdown</h4>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[['all', 'Overall'], ['batteries', 'Batteries'], ['displays', 'Displays']].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn ${productCatTab === id ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '4px 10px', fontSize: '11.5px' }}
                  onClick={() => setProductCatTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productData} layout="vertical" margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="productName" width={165} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="quantity" name="Transferred Units" fill={productCatTab === 'batteries' ? '#16a34a' : productCatTab === 'displays' ? '#7c3aed' : '#2563eb'} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Interactive Shipping Cost Ledger */}
        <div className="card">
          <h4 style={{ fontSize: '15px', marginBottom: '4px' }}>DC Delivery Shipping Cost Ledger</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Log monthly courier expenses (synced via cloud &amp; IndexedDB)
          </p>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <select value={newCost.month} onChange={(e) => setNewCost({ ...newCost, month: e.target.value })} style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '12.5px' }}>
              {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              type="text"
              placeholder="Courier (e.g. Lalamove)"
              value={newCost.courier}
              onChange={(e) => setNewCost({ ...newCost, courier: e.target.value })}
              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-strong)', width: '120px', fontSize: '12.5px' }}
            />
            <input
              type="number"
              placeholder="Amount PHP"
              value={newCost.amount}
              onChange={(e) => setNewCost({ ...newCost, amount: e.target.value })}
              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-strong)', width: '115px', fontSize: '12.5px' }}
            />
            <button type="button" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '12.5px' }} onClick={handleAddShipping}>
              <Plus size={14} /> Add
            </button>
          </div>

          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-light)', textAlign: 'left' }}>
                  <th style={{ padding: '7px 8px' }}>Month</th>
                  <th style={{ padding: '7px 8px' }}>Courier</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '7px 8px', width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {costs.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 500 }}>{c.month} {c.year || ''}</td>
                    <td style={{ padding: '6px 8px' }}>{c.courier}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{formatPhp(c.amount)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      <button type="button" onClick={() => handleDeleteCost(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }} title="Remove entry">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 4. Sales (DC) & Warranty Breakdown Panel ─────────────────────────────────
export function SalesWarrantyPanel({ analytics }) {
  const [siteFilter, setSiteFilter] = useState('ALL');
  const sales = analytics?.salesDc || {};
  const warranty = analytics?.warrantyDc || {};

  const filteredSalesRows = useMemo(() => (
    (sales.rows || []).filter(r => siteFilter === 'ALL' || r.locationName === siteFilter)
  ), [sales.rows, siteFilter]);

  const filteredTotal = useMemo(
    () => filteredSalesRows.reduce((s, r) => s + (r.linePriceTotal || 0), 0),
    [filteredSalesRows]
  );

  const uniqueSites = useMemo(
    () => Array.from(new Set((sales.rows || []).map(r => r.locationName).filter(Boolean))).sort(),
    [sales.rows]
  );

  const warrantyPieData = useMemo(() => (
    (warranty.breakdown || []).map(w => ({ name: w.warranty, value: w.count, pct: w.percentage * 100 }))
  ), [warranty.breakdown]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>FILTERED DC STOCK SALES TOTAL</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#047857' }}>{formatPhp(filteredTotal)}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {filteredSalesRows.length.toLocaleString()} Picked-Up Orders • Warranty Matched Pool: {(warranty.totalMatched || 0).toLocaleString()} ({warranty.redactedCount || 0} Fixably redacted)
          </div>
        </div>
        <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '13px' }}>
          <option value="ALL">All Sites ({uniqueSites.length})</option>
          {uniqueSites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: '18px' }}>
        <div className="card">
          <h4 style={{ fontSize: '15px', marginBottom: '12px' }}>Top Sites by DC Stock Sales Revenue (PHP)</h4>
          <div style={{ width: '100%', height: 290 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(sales.bySite || []).slice(0, 12)} layout="vertical" margin={{ left: 25, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="site" width={165} tick={{ fontSize: 10.5 }} />
                <Tooltip formatter={(v) => formatPhp(v)} />
                <Bar dataKey="totalSales" name="Total Sales" fill="#047857" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h4 style={{ fontSize: '15px', marginBottom: '12px' }}>Device Warranty Coverage Breakdown (DC Stocks)</h4>
          <div style={{ width: '100%', height: 290 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={warrantyPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {warrantyPieData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip formatter={(val, name, props) => [`${val.toLocaleString()} (${props.payload.pct.toFixed(1)}%)`, name]} />
                <Legend wrapperStyle={{ fontSize: '11.5px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <SimplePaginatedTable
          exportName="MDC_Sales_DC_Transactions"
          rows={filteredSalesRows}
          rowKey={(r, idx) => `${r.orderId}-${r.lineKgb}-${idx}`}
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'orderId', label: 'Order ID', render: r => <span className="font-mono">{r.orderId}</span> },
            { key: 'closedDate', label: 'Closed Date' },
            { key: 'locationName', label: 'Site' },
            { key: 'lineProductCode', label: 'Part Code' },
            { key: 'lineProductName', label: 'Part Name' },
            { key: 'lineKgb', label: 'KGB Serial', render: r => <span className="font-mono">{r.lineKgb}</span> },
            { key: 'deviceWarrantyName', label: 'Warranty' },
            { key: 'linePriceTotal', label: 'Price (VAT Incl.)', align: 'right', raw: r => r.linePriceTotal, render: r => <strong>{formatPhp(r.linePriceTotal)}</strong> }
          ]}
        />
      </div>
    </div>
  );
}

// ── 5. Exceptions, Non-Serial Audits & Investigation Remarks Panel ───────────
export function ExceptionsReconciliationPanel({ analytics, remarksMap = {}, onSaveRemark }) {
  const [queueTab, setQueueTab] = useState('non_serial'); // 'non_serial' | 'doa_dc' | 'doa_all' | 'gpr' | 'undisp_cin' | 's2s_unused' | 'duplicates'
  const [editingKey, setEditingKey] = useState(null);
  const [draftText, setDraftText] = useState('');

  const ex = analytics?.exceptionsAndQueues || {};
  const duplicates = analytics?.siteStocks?.duplicateReconciledRows || [];

  const renderRemarkEditor = (rKey, defaultNote = '') => {
    const existing = remarksMap[rKey];
    if (editingKey === rKey) {
      return (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input
            type="text"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Investigation note..."
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #2563eb', fontSize: '12px', minWidth: '170px' }}
          />
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '4px 8px', fontSize: '11.5px' }}
            onClick={() => {
              onSaveRemark(rKey, draftText);
              setEditingKey(null);
            }}
          >
            <Save size={12} />
          </button>
        </div>
      );
    }
    const displayNote = existing?.remark || defaultNote;
    return (
      <button
        type="button"
        onClick={() => {
          setEditingKey(rKey);
          setDraftText(displayNote || '');
        }}
        style={{
          background: 'none',
          border: '1px dashed var(--border-strong)',
          borderRadius: '4px',
          padding: '3px 8px',
          fontSize: '11.5px',
          cursor: 'pointer',
          color: displayNote ? '#0f172a' : 'var(--text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          textAlign: 'left'
        }}
      >
        <MessageSquare size={12} /> {displayNote || 'Add remark'}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[
          ['non_serial', `Non-Serial Repairs (${(ex.nonSerialRepairs || []).length})`],
          ['doa_dc', `DOA DC Stocks (${(ex.doaDcStockRows || []).length})`],
          ['doa_all', `All DOA Orders (${(ex.doaAllRows || []).length})`],
          ['gpr', `GPR Queue (${(ex.gprRows || []).length})`],
          ['undisp_cin', `Undispatched CIN (${(ex.undispatchedCinDc || []).length})`],
          ['s2s_unused', `Unused S2S Transfers (${(ex.unusedS2SSerials || []).length})`],
          ['duplicates', `Duplicate Serials (${duplicates.length})`]
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`btn ${queueTab === id ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '12.5px', padding: '7px 12px' }}
            onClick={() => setQueueTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card">
        {queueTab === 'non_serial' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#92400e', background: '#fffbeb', padding: '10px 12px', borderRadius: '6px', border: '1px solid #fde68a', fontSize: '12.5px' }}>
              <ShieldAlert size={16} />
              <span>
                <strong>Automated Anomaly Diagnostics:</strong> Cross-references missing KGB serial repairs against <em>DC Masterlists</em>, <em>DOA flags</em>, and <em>Site Stock</em> — replacing manual Excel cell comments with persisted investigation notes.
              </span>
            </div>
            <SimplePaginatedTable
              exportName="MDC_Non_Serial_Repairs_Audit"
              rows={ex.nonSerialRepairs || []}
              rowKey={(r, idx) => `${r.orderId}-${idx}`}
              columns={[
                { key: 'orderId', label: 'Order ID', render: r => <span className="font-mono">{r.orderId}</span> },
                { key: 'gsxRepairNumber', label: 'GSX Repair #' },
                { key: 'repairClosedDate', label: 'Closed Date' },
                { key: 'locationName', label: 'Site' },
                { key: 'productCode', label: 'Part Code' },
                { key: 'productDescription', label: 'Part Description' },
                { key: 'autoDiagnostic', label: 'Auto Cross-Check', render: r => <span className="badge badge-warning">{r.autoDiagnostic}</span> },
                { key: 'remark', label: 'Investigation Remark', render: r => renderRemarkEditor(`nsr::${r.orderId}`) }
              ]}
            />
          </div>
        )}

        {(queueTab === 'doa_dc' || queueTab === 'doa_all') && (
          <SimplePaginatedTable
            exportName={queueTab === 'doa_dc' ? 'MDC_DOA_DC_Stocks' : 'MDC_DOA_All_Orders'}
            rows={queueTab === 'doa_dc' ? (ex.doaDcStockRows || []) : (ex.doaAllRows || [])}
            rowKey={(r, idx) => `${r.orderId}-${r.lineKgb}-${idx}`}
            columns={[
              { key: 'orderId', label: 'Order ID', render: r => <span className="font-mono">{r.orderId}</span> },
              { key: 'closedDate', label: 'Closed Date' },
              { key: 'locationName', label: 'Location' },
              { key: 'lineProductCode', label: 'Product Code' },
              { key: 'lineProductName', label: 'Product Name' },
              { key: 'lineKgb', label: 'Line KGB', render: r => <span className="font-mono">{r.lineKgb}</span> },
              { key: 'deviceWarrantyName', label: 'Device Warranty Name' },
              { key: 'status', label: 'Status' },
              { key: 'lineIsDispatched', label: 'Dispatched' },
              { key: 'remark', label: 'Remark', render: r => renderRemarkEditor(`doa::${r.orderId}::${r.lineKgb}`) }
            ]}
          />
        )}

        {queueTab === 'gpr' && (
          <SimplePaginatedTable
            exportName="MDC_GPR_Queue"
            rows={ex.gprRows || []}
            rowKey={(r, idx) => `${r.orderId}-${idx}`}
            columns={[
              { key: 'orderId', label: 'Order ID', render: r => <span className="font-mono">{r.orderId}</span> },
              { key: 'closedDate', label: 'Closed Date' },
              { key: 'locationName', label: 'Location' },
              { key: 'lineProductCode', label: 'Product Code' },
              { key: 'lineProductName', label: 'Product Name' },
              { key: 'lineKgb', label: 'KGB Serial', render: r => <span className="font-mono">{r.lineKgb}</span> },
              { key: 'lineKbb', label: 'KBB Serial', render: r => <span className="font-mono">{r.lineKbb}</span> },
              { key: 'lineStatusName', label: 'Line Status', render: r => <span className="badge badge-info">{r.lineStatusName}</span> }
            ]}
          />
        )}

        {queueTab === 'undisp_cin' && (
          <SimplePaginatedTable
            exportName="MDC_Undispatched_CIN_DC"
            rows={ex.undispatchedCinDc || []}
            rowKey={(r, idx) => `${r.orderId}-${r.lineProductCode}-${idx}`}
            columns={[
              { key: 'orderId', label: 'Order ID', render: r => <span className="font-mono">{r.orderId}</span> },
              { key: 'closedDate', label: 'Closed Date' },
              { key: 'locationName', label: 'Location' },
              { key: 'lineProductCode', label: 'Product Code' },
              { key: 'lineProductName', label: 'Product Name' },
              { key: 'lineKgb', label: 'Line KGB', render: r => <span className="font-mono">{r.lineKgb}</span> },
              { key: 'lineKbb', label: 'Line KBB', render: r => <span className="font-mono">{r.lineKbb}</span> },
              { key: 'status', label: 'Status' },
              { key: 'lineIsDispatched', label: 'Dispatched', render: r => <span className="badge badge-danger">{r.lineIsDispatched}</span> }
            ]}
          />
        )}

        {queueTab === 's2s_unused' && (
          <SimplePaginatedTable
            exportName="MDC_Unused_S2S_Transfers"
            rows={ex.unusedS2SSerials || []}
            rowKey={(r, idx) => `${r.transferredSerial}-${idx}`}
            columns={[
              { key: 'transferReceivedDate', label: 'Transfer Date' },
              { key: 'fromStock', label: 'From Stock' },
              { key: 'toStock', label: 'To Stock' },
              { key: 'partNumber', label: 'Part No.' },
              { key: 'partDescription', label: 'Part Description' },
              { key: 'transferredSerial', label: 'Serial Number', render: r => <span className="font-mono">{r.transferredSerial}</span> },
              { key: 'remark', label: 'Follow-Up Remark', render: r => renderRemarkEditor(`s2s::${r.transferredSerial}`) }
            ]}
          />
        )}

        {queueTab === 'duplicates' && (
          <SimplePaginatedTable
            exportName="MDC_Duplicate_Serials"
            rows={duplicates}
            rowKey={(r, idx) => `${r.transferredSerial}-${r.stockName}-${idx}`}
            columns={[
              { key: 'adjustedReceivedDate', label: 'Received' },
              { key: 'stockName', label: 'Stock Site' },
              { key: 'partNumber', label: 'Part No.' },
              { key: 'partDescription', label: 'Description' },
              { key: 'transferredSerial', label: 'Duplicate Serial', render: r => <span className="font-mono" style={{ color: '#dc2626', fontWeight: 700 }}>{r.transferredSerial}</span> },
              { key: 'stockType', label: 'Stock Type' },
              { key: 'agingStatus', label: 'Status' }
            ]}
          />
        )}
      </div>
    </div>
  );
}
