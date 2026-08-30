import { useState } from 'react';
import { useApp } from '../context/AppContext';
import SaveRecordModal from './SaveRecordModal';
import {
  BookmarkCheck,
  BookmarkPlus,
  Search,
  Calendar,
  Layers,
  RotateCcw,
  Trash2,
  Eye,
  TrendingUp,
  Split,
  Clock,
  CheckCircle2,
  X,
  RefreshCw
} from 'lucide-react';

import { LIVE_MASTER_RECORD_ID } from '../constants/config';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export default function SavedRecords() {
  const {
    savedRecords,
    restorePeriodRecord,
    deletePeriodRecord,
    forecastItems,
    allocations,
    isAutoRefreshing,
    lastSyncedAt,
    autoRefreshData,
    currentUser,
    canUserDeleteRecord,
    canEdit,
    isReadOnly
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL'); // 'ALL' | 'both' | 'forecast' | 'allocation'
  const [yearFilter, setYearFilter] = useState('ALL');
  const [monthFilter, setMonthFilter] = useState('ALL');

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [recordToView, setRecordToView] = useState(null);
  const [viewTab, setViewTab] = useState('forecast'); // 'forecast' | 'allocation'
  const [recordToRestore, setRecordToRestore] = useState(null);
  const [restoreForecast, setRestoreForecast] = useState(true);
  const [restoreAllocation, setRestoreAllocation] = useState(true);
  const [recordToDelete, setRecordToDelete] = useState(null);

  // Filter valid historical period snapshots (exclude system registries, live master states, and deleted records)
  const validSavedRecords = (savedRecords || []).filter(rec =>
    rec &&
    rec.id !== LIVE_MASTER_RECORD_ID &&
    rec.id !== 'live_master_state_v1' &&
    rec.id !== 'active_packing_manifest_draft' &&
    rec.id !== 'live_master_dc_inventory' &&
    rec.id !== 'master_dc_intakes_registry' &&
    rec.id !== 'master_upload_audit_logs_registry' &&
    rec.id !== 'master_deletion_audit_logs_registry' &&
    rec.id !== 'master_stock_transfers_report_registry' &&
    rec.id !== 'master_users_registry' &&
    !rec.id?.startsWith('deleted_') &&
    !rec.id?.startsWith('master_') &&
    rec.record_type !== 'system_registry' &&
    rec.record_type !== 'deletion_registry' &&
    rec.record_type !== 'live_master_state' &&
    rec.record_type !== 'users_registry' &&
    rec.record_type !== 'stock_transfer_report' &&
    rec.record_type !== 'upload_audit_registry' &&
    rec.record_type !== 'deletion_audit_registry' &&
    rec.record_type !== 'deleted_snapshot' &&
    rec.period_label !== 'Deleted Records Registry' &&
    !rec.period_label?.includes('Live Master State') &&
    rec.notes !== '__DELETED__' &&
    rec.snapshot_data?.isDeleted !== true
  );

  // Derive unique years from saved records for filter dropdown
  const availableYears = Array.from(new Set(validSavedRecords.map(r => r.period_year).filter(Boolean))).sort((a, b) => b - a);

  // Filter records
  const filteredRecords = validSavedRecords.filter(rec => {
    // Type filter
    if (typeFilter !== 'ALL' && rec.record_type !== typeFilter) {
      return false;
    }
    // Year filter
    if (yearFilter !== 'ALL' && String(rec.period_year) !== String(yearFilter)) {
      return false;
    }
    // Month filter
    if (monthFilter !== 'ALL' && String(rec.period_month) !== String(monthFilter)) {
      return false;
    }
    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchLabel = rec.period_label?.toLowerCase().includes(q);
      const matchNotes = rec.notes?.toLowerCase().includes(q);
      const matchUser = rec.saved_by_name?.toLowerCase().includes(q);
      const matchYear = String(rec.period_year).includes(q);
      if (!matchLabel && !matchNotes && !matchUser && !matchYear) {
        return false;
      }
    }
    return true;
  });

  // Calculate Metrics
  const totalSavedCount = validSavedRecords.length;
  const latestRecord = validSavedRecords[0];

  const handleOpenRestoreModal = (record) => {
    setRecordToRestore(record);
    const hasForecast = record.snapshot_data?.forecastItems?.length > 0;
    const hasAlloc = record.snapshot_data?.allocations?.length > 0;
    setRestoreForecast(hasForecast);
    setRestoreAllocation(hasAlloc);
  };

  const handleConfirmRestore = async () => {
    if (!recordToRestore) return;
    await restorePeriodRecord(recordToRestore.id, {
      restoreForecast,
      restoreAllocation
    });
    setRecordToRestore(null);
  };

  const handleConfirmDelete = async () => {
    if (!recordToDelete) return;
    await deletePeriodRecord(recordToDelete.id);
    setRecordToDelete(null);
  };

  const formatDate = (isoString) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="saved-records-view" style={{ maxWidth: '100%' }}>
      {/* Header & Action Bar */}
      <div className="card" style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: '#e0f2fe',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <BookmarkCheck size={20} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700, color: 'var(--text-main)' }}>
                    Saved Period Records & Historical Archives
                  </h2>
                  <span
                    className="badge"
                    style={{
                      background: isAutoRefreshing ? '#f0f9ff' : '#ecfdf5',
                      color: isAutoRefreshing ? '#0284c7' : '#047857',
                      border: `1px solid ${isAutoRefreshing ? '#7dd3fc' : '#a7f3d0'}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11.5px',
                      padding: '3px 8px',
                      transition: 'all 0.2s ease'
                    }}
                    title={isAutoRefreshing ? "Auto-refreshing latest saved records from database..." : "Records are auto-refreshed on page visit and synchronized across all accounts"}
                  >
                    {isAutoRefreshing ? (
                      <>
                        <RefreshCw size={11} className="spin" />
                        <span>Auto-Refreshing...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={11} />
                        <span>Live Synced</span>
                      </>
                    )}
                  </span>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0, marginTop: '2px' }}>
                  Permanent, immutable snapshots of Demand Forecasting & Master Allocation matrices across weeks and months.
                  {lastSyncedAt && <span style={{ marginLeft: '8px', opacity: 0.8 }}>• Verified: {new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData && autoRefreshData({ force: true, silent: false, reason: 'SavedRecords manual refresh' })}
              disabled={isAutoRefreshing}
              title="Force reload saved records from database"
              style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Refresh'}</span>
            </button>

            {canEdit && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowSaveModal(true)} style={{ height: '36px' }}>
                <BookmarkPlus size={16} />
                <span>Save Current Working Data as Record</span>
              </button>
            )}

            {isReadOnly && (
              <span
                className="badge"
                style={{
                  background: '#f0fdf4',
                  color: '#166534',
                  border: '1px solid #bbf7d0',
                  fontSize: '11px',
                  padding: '4px 8px',
                  fontWeight: 600
                }}
              >
                View &amp; Export Mode
              </span>
            )}
          </div>
        </div>

        {/* High-Contrast KPI Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '14px',
            marginTop: '20px'
          }}
        >
          <div className="matrix-kpi-card">
            <div className="matrix-kpi-icon-wrap" style={{ background: '#e0f2fe', color: '#0284c7' }}>
              <BookmarkCheck size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Total Saved Records
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#0369a1', fontFamily: 'var(--font-mono)' }}>
                {totalSavedCount} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>snapshots</span>
              </div>
            </div>
          </div>

          <div className="matrix-kpi-card">
            <div className="matrix-kpi-icon-wrap" style={{ background: '#f1f5f9', color: '#334155' }}>
              <Calendar size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Latest Archived Period
              </div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>
                {latestRecord ? latestRecord.period_label : 'None Saved Yet'}
              </div>
            </div>
          </div>

          <div className="matrix-kpi-card">
            <div className="matrix-kpi-icon-wrap" style={{ background: '#dcfce7', color: '#15803d' }}>
              <TrendingUp size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Active Live Working Tables
              </div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#15803d' }}>
                {forecastItems?.length || 0} Forecasts • {allocations?.length || 0} Allocations
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="card" style={{ padding: '12px 18px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {/* Search Box */}
          <div className="search-input-box" style={{ width: '280px' }}>
            <Search size={15} />
            <input
              type="text"
              placeholder="Search by period, notes, author..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Scope Filter Pills */}
            <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 'var(--radius-sm)', padding: '3px', border: '1px solid #e2e8f0' }}>
              <button
                className={`btn btn-sm ${typeFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTypeFilter('ALL')}
                style={{ border: 'none', fontSize: '11.5px', padding: '4px 10px', fontWeight: 600 }}
              >
                All Types
              </button>
              <button
                className={`btn btn-sm ${typeFilter === 'both' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTypeFilter('both')}
                style={{ border: 'none', fontSize: '11.5px', padding: '4px 10px', fontWeight: 600 }}
              >
                Full Bundle
              </button>
              <button
                className={`btn btn-sm ${typeFilter === 'forecast' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTypeFilter('forecast')}
                style={{ border: 'none', fontSize: '11.5px', padding: '4px 10px', fontWeight: 600 }}
              >
                Forecast Only
              </button>
              <button
                className={`btn btn-sm ${typeFilter === 'allocation' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTypeFilter('allocation')}
                style={{ border: 'none', fontSize: '11.5px', padding: '4px 10px', fontWeight: 600 }}
              >
                Allocation Only
              </button>
            </div>

            {/* Year Filter */}
            {availableYears.length > 1 && (
              <select
                className="form-select"
                style={{ width: '100px', fontSize: '12px', padding: '5px 8px' }}
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
              >
                <option value="ALL">All Years</option>
                {availableYears.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            )}

            {/* Month Filter */}
            <select
              className="form-select"
              style={{ width: '110px', fontSize: '12px', padding: '5px 8px' }}
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
            >
              <option value="ALL">All Months</option>
              {MONTH_NAMES.map((m, idx) => (
                <option key={idx + 1} value={idx + 1}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Saved Records Table or Empty State */}
      {filteredRecords.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed var(--border-strong)' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: '#e0f2fe',
              color: '#0284c7',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px'
            }}
          >
            <BookmarkCheck size={30} />
          </div>
          <h3 style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--text-main)' }}>
            {savedRecords.length === 0 ? 'No Saved Period Records Yet' : 'No Matching Saved Records'}
          </h3>
          <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 20px', lineHeight: 1.5 }}>
            {savedRecords.length === 0
              ? 'Save your current demand forecast or master allocation as a labeled period record to keep a permanent historical archive.'
              : 'Try clearing your search query or adjusting your type/month filters.'}
          </p>
          {savedRecords.length === 0 ? (
            <button className="btn btn-primary" onClick={() => setShowSaveModal(true)}>
              <BookmarkPlus size={16} />
              <span>Save Current Data as Record</span>
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => { setSearchQuery(''); setTypeFilter('ALL'); setYearFilter('ALL'); setMonthFilter('ALL'); }}>
              <span>Reset Filters</span>
            </button>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '220px' }}>Period Record</th>
                  <th style={{ textAlign: 'center', width: '100px' }}>Scope Type</th>
                  <th style={{ minWidth: '240px' }}>Archived Snapshot Details</th>
                  <th style={{ minWidth: '160px' }}>Saved By & Timestamp</th>
                  <th style={{ minWidth: '180px' }}>Notes</th>
                  <th style={{ textAlign: 'center', minWidth: '200px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map(record => {
                  const snap = record.snapshot_data || {};
                  const summary = snap.summary || {};
                  const forecastCount = snap.forecastItems?.length || 0;
                  const allocCount = snap.allocations?.length || 0;
                  const monthLabel = MONTH_NAMES[record.period_month - 1] || 'Aug';

                  return (
                    <tr key={record.id}>
                      {/* Period Label */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <div
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '6px',
                              background: record.record_type === 'forecast' ? '#e0f2fe' : record.record_type === 'allocation' ? '#dcfce7' : '#f1f5f9',
                              color: record.record_type === 'forecast' ? '#0369a1' : record.record_type === 'allocation' ? '#15803d' : '#475569',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              marginTop: '2px'
                            }}
                          >
                            {record.record_type === 'forecast' ? (
                              <TrendingUp size={15} />
                            ) : record.record_type === 'allocation' ? (
                              <Split size={15} />
                            ) : (
                              <Layers size={15} />
                            )}
                          </div>
                          <div>
                            <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block' }}>
                              {record.period_label}
                            </strong>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                              <span className="badge badge-neutral" style={{ fontSize: '10px', padding: '1px 6px' }}>
                                {monthLabel} {record.period_year}
                              </span>
                              {record.period_week && (
                                <span className="badge badge-primary" style={{ fontSize: '10px', padding: '1px 6px' }}>
                                  Week {record.period_week}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Scope Type Badge */}
                      <td style={{ textAlign: 'center' }}>
                        {record.record_type === 'both' && (
                          <span className="badge badge-neutral" style={{ background: '#f1f5f9', color: '#334155' }}>
                            Full Bundle
                          </span>
                        )}
                        {record.record_type === 'forecast' && (
                          <span className="badge badge-primary">
                            Forecast
                          </span>
                        )}
                        {record.record_type === 'allocation' && (
                          <span className="badge badge-success">
                            Allocation
                          </span>
                        )}
                      </td>

                      {/* Snapshot Details */}
                      <td>
                        <div style={{ fontSize: '12px', lineHeight: 1.4 }}>
                          {forecastCount > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#334155' }}>
                              <TrendingUp size={12} color="#0284c7" />
                              <span><strong>{forecastCount}</strong> forecast parts ({(summary.totalForecastUnits || 0).toLocaleString()} units)</span>
                            </div>
                          )}
                          {allocCount > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#334155', marginTop: '2px' }}>
                              <Split size={12} color="#15803d" />
                              <span><strong>{allocCount}</strong> allocation parts ({(summary.totalAllocatedUnits || 0).toLocaleString()} units across {summary.totalSites || 26} sites)</span>
                            </div>
                          )}
                          {summary.grandTotalValue > 0 && (
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                              Master Value: ${summary.grandTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Saved By & Time */}
                      <td>
                        <div style={{ fontSize: '12.5px', color: '#0f172a', fontWeight: 600 }}>
                          {record.saved_by_name || 'System User'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                          <Clock size={11} />
                          <span>{formatDate(record.created_at)}</span>
                        </div>
                      </td>

                      {/* Notes */}
                      <td>
                        <span style={{ fontSize: '12px', color: record.notes ? '#334155' : '#94a3b8', fontStyle: record.notes ? 'normal' : 'italic' }}>
                          {record.notes || 'No remarks recorded'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          {/* Inspect Snapshot */}
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => {
                              setRecordToView(record);
                              setViewTab(record.snapshot_data?.forecastItems?.length > 0 ? 'forecast' : 'allocation');
                            }}
                            title="Inspect archived snapshot matrix"
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          >
                            <Eye size={12} />
                            <span>Inspect</span>
                          </button>

                          {/* Restore Record (Admin only) */}
                          {canEdit && (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => handleOpenRestoreModal(record)}
                              title="Restore into live working tables"
                              style={{ fontSize: '11px', padding: '4px 8px' }}
                            >
                              <RotateCcw size={12} />
                              <span>Restore</span>
                            </button>
                          )}

                          {/* Delete Record (Admin/Creator only) */}
                          {canEdit && (
                            canUserDeleteRecord(record, currentUser) ? (
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => setRecordToDelete(record)}
                                title="Delete this historical record"
                                style={{ fontSize: '11px', padding: '4px 8px' }}
                              >
                                <Trash2 size={12} />
                              </button>
                            ) : (
                              <button
                                className="btn btn-sm btn-secondary"
                                disabled
                                style={{ fontSize: '11px', padding: '4px 8px', opacity: 0.4, cursor: 'not-allowed' }}
                                title={`Only ${record.saved_by_name || 'the creator'} can delete this record`}
                              >
                                <Trash2 size={12} />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 1. Save Record Modal */}
      {showSaveModal && (
        <SaveRecordModal
          isOpen={showSaveModal}
          onClose={() => setShowSaveModal(false)}
          defaultType="both"
        />
      )}

      {/* 2. Restore Confirmation Modal */}
      {recordToRestore && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRecordToRestore(null);
          }}
        >
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RotateCcw size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', color: '#fff', fontWeight: 600 }}>
                    Restore Historical Record
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                    Load "{recordToRestore.period_label}" back into live working tables.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecordToRestore(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div
                style={{
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  color: '#0369a1',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12.5px',
                  marginBottom: '16px',
                  lineHeight: 1.5
                }}
              >
                ℹ️ Restoring loads the snapshot data into your active workspace for viewing or editing. <strong>The saved record itself remains safely preserved in history.</strong>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', marginBottom: '8px' }}>
                  Select Tables to Load:
                </div>

                {recordToRestore.snapshot_data?.forecastItems?.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '10px', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={restoreForecast}
                      onChange={(e) => setRestoreForecast(e.target.checked)}
                    />
                    <span>
                      <strong>Demand Forecasting Table</strong> ({recordToRestore.snapshot_data.forecastItems.length} parts)
                    </span>
                  </label>
                )}

                {recordToRestore.snapshot_data?.allocations?.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={restoreAllocation}
                      onChange={(e) => setRestoreAllocation(e.target.checked)}
                    />
                    <span>
                      <strong>Master Allocation Matrix</strong> ({recordToRestore.snapshot_data.allocations.length} parts across 26 branches)
                    </span>
                  </label>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRecordToRestore(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmRestore}
                disabled={!restoreForecast && !restoreAllocation}
              >
                <RotateCcw size={14} />
                <span>Restore into Live Workspace</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Delete Confirmation Modal */}
      {recordToDelete && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRecordToDelete(null);
          }}
        >
          <div className="modal-content" style={{ maxWidth: '460px' }}>
            <div className="modal-header" style={{ background: '#7f1d1d' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', color: '#fff', fontWeight: 600 }}>
                    Delete Saved Record
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#fecaca' }}>
                    Permanent removal from local & cloud database.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecordToDelete(null)}
                style={{ background: 'transparent', border: 'none', color: '#fecaca', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '13.5px', color: '#1e293b', lineHeight: 1.5 }}>
                Are you sure you want to permanently delete <strong>"{recordToDelete.period_label}"</strong>? This historical snapshot will be removed and cannot be recovered.
              </p>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRecordToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmDelete}
              >
                Delete Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Snapshot Details / Inspector Modal */}
      {recordToView && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRecordToView(null);
          }}
        >
          <div className="modal-content" style={{ maxWidth: '960px', width: '95vw', maxHeight: '90vh' }}>
            <div className="modal-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', color: '#fff', fontWeight: 700 }}>
                    {recordToView.period_label}
                  </h3>
                  <span className="badge badge-primary" style={{ fontSize: '10.5px' }}>
                    Snapshot Inspector
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>
                  Saved by {recordToView.saved_by_name} on {formatDate(recordToView.created_at)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setRecordToView(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Tabs */}
            <div style={{ background: '#f8fafc', padding: '8px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '10px' }}>
              {recordToView.snapshot_data?.forecastItems?.length > 0 && (
                <button
                  className={`btn btn-sm ${viewTab === 'forecast' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setViewTab('forecast')}
                >
                  <TrendingUp size={13} />
                  <span>Forecast Snapshot ({recordToView.snapshot_data.forecastItems.length} parts)</span>
                </button>
              )}
              {recordToView.snapshot_data?.allocations?.length > 0 && (
                <button
                  className={`btn btn-sm ${viewTab === 'allocation' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setViewTab('allocation')}
                >
                  <Split size={13} />
                  <span>Allocation Snapshot ({recordToView.snapshot_data.allocations.length} parts)</span>
                </button>
              )}
            </div>

            <div className="modal-body" style={{ padding: '16px 24px', overflowY: 'auto' }}>
              {/* Forecast Tab */}
              {viewTab === 'forecast' && recordToView.snapshot_data?.forecastItems && (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Part Number</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'center' }}>Computed Forecast</th>
                        <th style={{ textAlign: 'center' }}>Admin Override</th>
                        <th style={{ textAlign: 'center', background: '#ecfdf5', color: '#065f46' }}>Recommended Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recordToView.snapshot_data.forecastItems.map(item => (
                        <tr key={item.part_id || item.part_number}>
                          <td className="font-mono"><strong>{item.part_number}</strong></td>
                          <td>{item.description}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.computed_forecast || 0}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                            {item.admin_override !== null && item.admin_override !== undefined ? item.admin_override : '—'}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', background: '#f0fdf4', color: '#15803d' }}>
                            {item.recommended_order || item.final_forecast || item.computed_forecast || 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Allocation Tab */}
              {viewTab === 'allocation' && recordToView.snapshot_data?.allocations && (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Part Number</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'center' }}>Total Alloc</th>
                        <th style={{ textAlign: 'center' }}>W1</th>
                        <th style={{ textAlign: 'center' }}>W2</th>
                        <th style={{ textAlign: 'center' }}>W3</th>
                        <th style={{ textAlign: 'center' }}>W4</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recordToView.snapshot_data.allocations.map(item => (
                        <tr key={item.part_id || item.part_number}>
                          <td className="font-mono"><strong>{item.part_number}</strong></td>
                          <td>{item.description}</td>
                          <td style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#0369a1' }}>
                            {item.total_allocated_qty || 0}
                          </td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.w1_qty || 0}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.w2_qty || 0}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.w3_qty || 0}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.w4_qty || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRecordToView(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const target = recordToView;
                  setRecordToView(null);
                  handleOpenRestoreModal(target);
                }}
              >
                <RotateCcw size={14} />
                <span>Restore This Record</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
