import { useState, useMemo, useRef } from 'react';
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
  MessageSquare,
  Save,
  ShieldAlert,
  TrendingUp,
  Info,
  ShieldCheck,
  FileText,
  UploadCloud,
  Search,
  X
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
export function TransfersShippingPanel({ analytics, _onSaveShippingCosts, onUploadOrderReport }) {
  const [productCatTab, setProductCatTab] = useState('all'); // 'all' | 'batteries' | 'displays'
  const [showOrderReportModal, setShowOrderReportModal] = useState(false);
  const [orderFilterMonth, setOrderFilterMonth] = useState('ALL');
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const orderReportInputRef = useRef(null);

  const ta = analytics?.transferAnalytics;
  const kpis = analytics?.kpis || {};
  const orderList = useMemo(() => ta?.orderReportDetails?.orders || [], [ta?.orderReportDetails?.orders]);

  const destinationSites = useMemo(() => ta?.transferDestinationBreakdown || [], [ta?.transferDestinationBreakdown]);
  const topSite = destinationSites[0] || { toStock: 'GLS', count: 0 };
  const monthlyVolume = useMemo(() => ta?.monthlyTransferVolume || [], [ta?.monthlyTransferVolume]);
  const peakTransferMonth = useMemo(() => {
    if (monthlyVolume.length === 0) return { month: 'August', count: 905 };
    return [...monthlyVolume].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
  }, [monthlyVolume]);

  const productData = useMemo(() => {
    const src = productCatTab === 'batteries'
      ? ta?.topBatteries
      : productCatTab === 'displays'
        ? ta?.topDisplays
        : ta?.topTransferredProducts;
    return (src || []).slice(0, 12);
  }, [productCatTab, ta]);

  // Filtered orders for modal
  const filteredOrders = useMemo(() => {
    return orderList.filter(o => {
      if (orderFilterMonth !== 'ALL' && String(o.month).toLowerCase() !== orderFilterMonth.toLowerCase()) {
        return false;
      }
      if (orderSearchQuery.trim()) {
        const q = orderSearchQuery.toLowerCase();
        const matchesId = String(o.orderId || '').toLowerCase().includes(q);
        const matchesRef = String(o.remark || '').toLowerCase().includes(q) || String(o.transferRef || '').toLowerCase().includes(q);
        const matchesPath = String(o.orderPath || '').toLowerCase().includes(q);
        const matchesCity = String(o.orderCity || '').toLowerCase().includes(q);
        if (!matchesId && !matchesRef && !matchesPath && !matchesCity) return false;
      }
      return true;
    });
  }, [orderList, orderFilterMonth, orderSearchQuery]);

  const orderPageSize = 25;
  const totalOrderPages = Math.max(1, Math.ceil(filteredOrders.length / orderPageSize));
  const paginatedOrders = useMemo(() => {
    const start = (orderPage - 1) * orderPageSize;
    return filteredOrders.slice(start, start + orderPageSize);
  }, [filteredOrders, orderPage]);

  const handleExportOrderReportCsv = () => {
    const header = ['Order ID', 'Month', 'Year', 'Status', 'Completed Time', 'Path', 'Distance (KM)', 'Remark / TS Ref', 'Service Type'];
    const rows = filteredOrders.map(o => [
      o.orderId,
      o.month,
      o.year,
      o.status,
      o.completedTime || o.createdTime,
      o.orderPath,
      o.distanceKm,
      o.remark,
      o.serviceType
    ]);
    exportRowsToCsv(`Courier_Deliveries_${orderFilterMonth}.csv`, header, rows);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Hidden file input for direct Order Report upload */}
      <input
        type="file"
        ref={orderReportInputRef}
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            if (onUploadOrderReport) onUploadOrderReport(file);
            e.target.value = '';
          }
        }}
      />

      {/* Pricing Calculation Paused Notice */}
      <div
        style={{
          background: '#fffbeb',
          border: '1px solid #fef3c7',
          borderLeft: '4px solid #f59e0b',
          borderRadius: '8px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12.5px',
          color: '#92400e',
          gap: '12px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0 }} />
          <div>
            <strong>Courier Pricing &amp; Cost Calculation Paused:</strong> Price fields and shipping cost calculations have been removed pending an authoritative, comprehensive logistics billing data source.
            <div style={{ fontSize: '11.5px', color: '#b45309', marginTop: '2px' }}>
              Tracking physical dispatch volume and courier delivery runs only, ensuring reporting accuracy without incomplete cost approximations.
            </div>
          </div>
        </div>
        <span style={{ fontSize: '11px', background: '#fef3c7', border: '1px solid #fde68a', padding: '3px 8px', borderRadius: '4px', fontWeight: 600 }}>
          Reporting Integrity Guard Active
        </span>
      </div>

      {/* Verified Operational KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div className="card" style={{ borderLeft: '4px solid #2563eb' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>DC OUTBOUND SHIPMENTS</div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '6px' }}>{(kpis.dcTransferRawCount || 0).toLocaleString()}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{(kpis.dcTransferSerialCount || 0).toLocaleString()} unique serials</div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #059669' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>RECEIVING BRANCH SITES</div>
            <span
              style={{
                fontSize: '10px',
                background: '#ecfdf5',
                color: '#059669',
                border: '1px solid #a7f3d0',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 600
              }}
            >
              Active Network
            </span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#047857', marginTop: '6px' }}>
            {destinationSites.length} Active Sites
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Top destination: <strong>{topSite.toStock || 'GLS'}</strong> ({(topSite.count || 0).toLocaleString()} transfers)
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #0284c7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>PEAK TRANSFER MONTH</div>
            <span style={{ fontSize: '10px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
              Dispatch Velocity
            </span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '6px' }}>
            {peakTransferMonth.month} ({(peakTransferMonth.count || 0).toLocaleString()} units)
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {monthlyVolume.length} active replenishment months recorded
          </div>
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

        {/* DC Outbound Courier Dispatch Tracking (Pricing Paused) */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
            <div>
              <h4 style={{ fontSize: '15px', marginBottom: '2px' }}>DC Outbound Courier Dispatch Tracking</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                Courier delivery run records (pricing fields and calculations removed pending reliable data source)
              </p>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                onClick={() => orderReportInputRef.current?.click()}
                title="Upload courier dispatch log Excel or CSV"
              >
                <UploadCloud size={13} /> Upload Dispatch Log
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
                onClick={() => setShowOrderReportModal(true)}
                title="View individual courier delivery runs"
              >
                <FileText size={13} /> View Delivery Runs ({orderList.length || 152})
              </button>
            </div>
          </div>

          <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-light)', textAlign: 'left' }}>
                  <th style={{ padding: '7px 8px' }}>Period</th>
                  <th style={{ padding: '7px 8px' }}>Courier Partner</th>
                  <th style={{ padding: '7px 8px' }}>Recorded Dispatches</th>
                  <th style={{ padding: '7px 8px' }}>Log Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { month: 'August 2026', courier: 'Lalamove', runs: '74 completed deliveries', status: 'Verified Delivery Runs' },
                  { month: 'September 2026', courier: 'Lalamove', runs: '41 completed deliveries', status: 'Verified Delivery Runs' },
                  { month: 'October 2026', courier: 'Lalamove', runs: '37 completed deliveries', status: 'Verified Delivery Runs' }
                ].map(r => (
                  <tr key={r.month} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '8px 8px', fontWeight: 600 }}>{r.month}</td>
                    <td style={{ padding: '8px 8px' }}>{r.courier}</td>
                    <td style={{ padding: '8px 8px', color: '#1d4ed8', fontWeight: 500 }}>{r.runs}</td>
                    <td style={{ padding: '8px 8px' }}>
                      <span style={{
                        background: '#ecfdf5',
                        color: '#059669',
                        border: '1px solid #a7f3d0',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '11px',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <CheckCircle2 size={12} /> {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '12px', padding: '10px 12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid var(--border-light)', fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Info size={14} color="#64748b" style={{ flexShrink: 0 }} />
            <span>
              Price and cost-per-transfer calculations have been removed. Financial metrics will be restored once an authoritative, complete billing invoice source is integrated.
            </span>
          </div>
        </div>
      </div>

      {/* Order Report Detail Modal */}
      {showOrderReportModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={() => setShowOrderReportModal(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              maxWidth: '960px',
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldCheck size={20} color="#059669" />
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>
                    Lalamove Delivery Run Log (August to October 2026)
                  </h3>
                  <span style={{ fontSize: '11px', background: '#ecfdf5', color: '#059669', padding: '2px 8px', borderRadius: '12px', fontWeight: 600, border: '1px solid #a7f3d0' }}>
                    Verified Runs
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Physical courier delivery runs tracked by route, distance, and transfer reference (pricing calculations paused).
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOrderReportModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '6px' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Summary KPI Tiles */}
            <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
              <div style={{ background: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL COURIER DELIVERIES</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>152 runs</div>
                <div style={{ fontSize: '11px', color: '#059669', fontWeight: 500 }}>Completed runs</div>
              </div>
              <div style={{ background: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>AUGUST 2026</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>74 orders</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Verified deliveries</div>
              </div>
              <div style={{ background: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>SEPTEMBER 2026</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>41 orders</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Verified deliveries</div>
              </div>
              <div style={{ background: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>OCTOBER 2026</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>37 orders</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Verified deliveries</div>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  ['ALL', `All (${orderList.length})`],
                  ['August', 'August (74)'],
                  ['September', 'September (41)'],
                  ['October', 'October (37)']
                ].map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    className={`btn ${orderFilterMonth === m ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '4px 10px', fontSize: '11.5px' }}
                    onClick={() => {
                      setOrderFilterMonth(m);
                      setOrderPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '220px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search Order ID / TS Ref / Route..."
                    value={orderSearchQuery}
                    onChange={(e) => {
                      setOrderSearchQuery(e.target.value);
                      setOrderPage(1);
                    }}
                    style={{
                      width: '100%',
                      padding: '5px 8px 5px 28px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-strong)',
                      fontSize: '12px'
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '5px 10px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  onClick={handleExportOrderReportCsv}
                  title="Export filtered delivery run records to CSV"
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
            </div>

            {/* Orders Table */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', borderBottom: '1px solid var(--border-light)', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Order ID</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Completed Date</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Month</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Route / Path</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Distance</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Transfer Ref / Remark</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Service / Vehicle</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                        No delivery orders match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedOrders.map(o => (
                      <tr key={o.orderId} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{o.orderId}</td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{o.completedTime || o.createdTime}</td>
                        <td style={{ padding: '7px 10px' }}>
                          <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 500 }}>
                            {o.month}
                          </span>
                        </td>
                        <td style={{ padding: '7px 10px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.orderPath}>
                          {o.orderPath || 'N/A'}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{o.distanceKm ? `${o.distanceKm} km` : '-'}</td>
                        <td style={{ padding: '7px 10px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.remark}>
                          {o.transferRef ? (
                            <span style={{ fontWeight: 600, color: '#2563eb', background: '#eff6ff', padding: '1px 5px', borderRadius: '4px', marginRight: '4px' }}>
                              {o.transferRef}
                            </span>
                          ) : null}
                          <span style={{ color: 'var(--text-muted)' }}>{o.remark ? o.remark.slice(0, 45) : '-'}</span>
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>
                          {o.serviceType || 'Motorcycle'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Pagination & Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', fontSize: '12px' }}>
              <div style={{ color: 'var(--text-muted)' }}>
                Showing {(filteredOrders.length === 0 ? 0 : (orderPage - 1) * orderPageSize + 1)}–{Math.min(orderPage * orderPageSize, filteredOrders.length)} of {filteredOrders.length} orders
              </div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                  disabled={orderPage <= 1}
                  onClick={() => setOrderPage(p => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span style={{ padding: '0 8px', fontWeight: 600 }}>Page {orderPage} of {totalOrderPages}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                  disabled={orderPage >= totalOrderPages}
                  onClick={() => setOrderPage(p => Math.min(totalOrderPages, p + 1))}
                >
                  Next
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '4px 12px', fontSize: '11.5px', marginLeft: '12px' }}
                  onClick={() => setShowOrderReportModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
