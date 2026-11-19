import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShieldCheck,
  Lock,
  Search,
  FileSpreadsheet,
  Download,
  RefreshCw,
  Copy,
  Check,
  Calendar,
  Building2,
  User,
  Tag
} from 'lucide-react';
import {
  loadScanInAuditLedger,
  syncScanInAuditFromCloud,
  backfillAuditFromExistingData,
  subscribeScanInAuditSync,
  exportScanInAuditToExcel,
  isValidAuditRecord
} from '../services/scanInAuditService';
import { formatTo12HourTime } from '../utils/dateUtils';

function getClassificationBadgeStyle(classification = '') {
  const u = String(classification).toUpperCase();
  if (u.includes('SVNR')) {
    return { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
  }
  if (u.includes('CRBR')) {
    return { background: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff' };
  }
  if (u.includes('TRANSFER')) {
    return { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
  }
  return { background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' };
}

export default function ScanInAuditTrailPanel({
  inventoryUnits = [],
  dcIntakeRecords = [],
  sites = [],
  currentUser = null,
  showToast = null,
  onCountChange = null
}) {
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('ALL');
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [userFilter, setUserFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [displayLimit, setDisplayLimit] = useState(200);

  const userName = currentUser?.fullName || currentUser?.email || 'Admin';

  const hydrateAuditLedger = useCallback(async ({ runCloud = true, runBackfill = true } = {}) => {
    try {
      let list = await loadScanInAuditLedger();
      setRecords(list);
      onCountChange?.(list.length);
      setIsLoading(false);

      if (runBackfill && ((inventoryUnits && inventoryUnits.length > 0) || (dcIntakeRecords && dcIntakeRecords.length > 0))) {
        const afterBackfill = await backfillAuditFromExistingData({
          inventoryUnits,
          dcIntakeRecords,
          sites,
          userName
        });
        if (afterBackfill.length !== list.length) {
          list = afterBackfill;
          setRecords(list);
          onCountChange?.(list.length);
        }
      }

      if (runCloud) {
        setIsSyncing(true);
        const cloudRes = await syncScanInAuditFromCloud({ userName });
        if (Array.isArray(cloudRes?.records)) {
          setRecords(cloudRes.records);
          onCountChange?.(cloudRes.records.length);
        }
        setIsSyncing(false);
      }
    } catch (err) {
      console.warn('[ScanInAuditTrailPanel] Load notice:', err);
      setIsLoading(false);
      setIsSyncing(false);
    }
  }, [inventoryUnits, dcIntakeRecords, sites, userName, onCountChange]);

  useEffect(() => {
    hydrateAuditLedger({ runCloud: true, runBackfill: true });
    const unsub = subscribeScanInAuditSync(() => {
      hydrateAuditLedger({ runCloud: false, runBackfill: false });
    });
    return () => unsub();
  }, [hydrateAuditLedger]);

  // Dynamic filter dropdown choices derived from actual audited records
  const filterOptions = useMemo(() => {
    const classSet = new Set(['MDC - Forecasting', 'DC - CRBR', 'SVNR - Service Non-Repair', 'Transfer Parts']);
    const siteMap = new Map();
    const userSet = new Set();

    records.forEach(r => {
      if (r.classification) classSet.add(r.classification);
      if (r.receiving_site_code) {
        siteMap.set(r.receiving_site_code, r.receiving_site_name || r.receiving_site_code);
      }
      if (r.scanned_by) userSet.add(r.scanned_by);
    });

    return {
      classifications: Array.from(classSet),
      sites: Array.from(siteMap.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      users: Array.from(userSet).sort((a, b) => a.localeCompare(b))
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records.filter(r => {
      if (!isValidAuditRecord(r)) return false;
      if (classificationFilter !== 'ALL' && r.classification !== classificationFilter) return false;
      if (siteFilter !== 'ALL' && r.receiving_site_code !== siteFilter) return false;
      if (userFilter !== 'ALL' && r.scanned_by !== userFilter) return false;
      const dateStr = String(r.scanned_at || '').slice(0, 10);
      if (dateFrom && dateStr && dateStr < dateFrom) return false;
      if (dateTo && dateStr && dateStr > dateTo) return false;
      if (q) {
        const hay = `${r.audit_id || ''} ${r.part_number || ''} ${r.part_description || ''} ${r.serial_number || ''} ${r.classification || ''} ${r.scanned_by || ''} ${r.origin_site || ''} ${r.receiving_site_code || ''} ${r.receiving_site_name || ''} ${r.reference_number || ''} ${r.intake_method || ''} ${r.integrity_hash || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, searchQuery, classificationFilter, siteFilter, userFilter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayCount = filteredRecords.filter(r => String(r.scanned_at || '').slice(0, 10) === todayIso).length;
    const uniqueParts = new Set(filteredRecords.map(r => r.part_number)).size;
    const uniqueSites = new Set(filteredRecords.map(r => r.receiving_site_code)).size;
    return {
      total: filteredRecords.length,
      todayCount,
      uniqueParts,
      uniqueSites
    };
  }, [filteredRecords]);

  const hasActiveFilters = Boolean(
    searchQuery || classificationFilter !== 'ALL' || siteFilter !== 'ALL' || userFilter !== 'ALL' || dateFrom || dateTo
  );

  const handleCopy = (val) => {
    if (!val || val === 'N/A') return;
    try {
      navigator.clipboard?.writeText(val);
      setCopiedKey(val);
      setTimeout(() => setCopiedKey(''), 1400);
    } catch {}
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const fileName = await exportScanInAuditToExcel({
        records: filteredRecords,
        filters: {
          classification: classificationFilter === 'ALL' ? 'All Tags' : classificationFilter,
          site: siteFilter === 'ALL' ? 'All Sites' : siteFilter,
          user: userFilter === 'ALL' ? 'All Users' : userFilter,
          dateFrom,
          dateTo
        },
        generatedBy: userName
      });
      showToast?.(`Exported ${fileName}`, 'success');
    } catch (err) {
      showToast?.(`Audit Excel export failed: ${err?.message || err}`, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Audit ID',
      'Date Scanned',
      'Time Scanned',
      'Part Number',
      'Part Description',
      'Serial Number',
      'Tagging / Classification',
      'Scanned By',
      'Origin / From',
      'Receiving Site Code',
      'Receiving Site / Location',
      'Reference / Transaction #',
      'Intake Method',
      'Notes',
      'Integrity Hash'
    ];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filteredRecords.map(r => {
      const iso = String(r.scanned_at || '');
      return [
        r.audit_id,
        iso.slice(0, 10),
        iso ? (formatTo12HourTime ? formatTo12HourTime(iso) : iso.slice(11, 19)) : '',
        r.part_number,
        r.part_description,
        r.serial_number,
        r.classification,
        r.scanned_by,
        r.origin_site || 'Supplier / Inbound',
        r.receiving_site_code,
        r.receiving_site_name,
        r.reference_number,
        r.intake_method,
        r.notes || '',
        r.integrity_hash
      ].map(esc).join(',');
    });
    const blob = new Blob([[headers.map(esc).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MDC_Permanent_ScanIn_Audit_Trail_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Immutable Compliance Header Banner */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#ffffff',
          border: '1px solid #334155',
          padding: '18px 22px',
          borderRadius: '12px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <span
                className="badge"
                style={{
                  background: 'rgba(16, 185, 129, 0.18)',
                  color: '#34d399',
                  borderColor: 'rgba(16, 185, 129, 0.35)',
                  fontWeight: 700
                }}
              >
                <Lock size={11} /> Immutable &amp; Permanent Record
              </span>
              <span
                className="badge"
                style={{
                  background: 'rgba(56, 189, 248, 0.18)',
                  color: '#38bdf8',
                  borderColor: 'rgba(56, 189, 248, 0.35)'
                }}
              >
                <ShieldCheck size={11} /> All Scanned Parts · All Transaction Types
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#ffffff' }}>
              Receive Scan-In Permanent Audit Trail
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#cbd5e1', maxWidth: '780px', lineHeight: 1.5 }}>
              Permanent, append-only receipt ledger capturing every part scanned via Receive Scan-In across all sites and transaction types (Forecasting, CRBR, SVNR, Transfer Parts, Returns). Records are tamper-evident and cannot be modified or deleted by any user.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isSyncing}
              onClick={() => hydrateAuditLedger({ runCloud: true, runBackfill: true })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              title="Sync permanent audit records with Cloud"
            >
              <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Cloud'}</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={isExporting || filteredRecords.length === 0}
              onClick={handleExportExcel}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <FileSpreadsheet size={14} />
              <span>{isExporting ? 'Exporting...' : 'Export Audit Excel (.xlsx)'}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={filteredRecords.length === 0}
              onClick={handleExportCsv}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Download size={13} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        <div className="card" style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Total Audited Scans</div>
          <div className="font-mono" style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
            {stats.total.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Permanent receipt proof records</div>
        </div>
        <div className="card" style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid #bfdbfe', background: '#eff6ff' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase' }}>Scanned Today</div>
          <div className="font-mono" style={{ fontSize: '22px', fontWeight: 800, color: '#1e40af', marginTop: '2px' }}>
            {stats.todayCount.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#1d4ed8' }}>{new Date().toISOString().slice(0, 10)}</div>
        </div>
        <div className="card" style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid #bbf7d0', background: '#f0fdf4' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#15803d', textTransform: 'uppercase' }}>Unique Part Numbers</div>
          <div className="font-mono" style={{ fontSize: '22px', fontWeight: 800, color: '#166534', marginTop: '2px' }}>
            {stats.uniqueParts.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#15803d' }}>Distinct SKUs verified</div>
        </div>
        <div className="card" style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid #e9d5ff', background: '#faf5ff' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#7e22ce', textTransform: 'uppercase' }}>Receiving Sites</div>
          <div className="font-mono" style={{ fontSize: '22px', fontWeight: 800, color: '#6b21a8', marginTop: '2px' }}>
            {stats.uniqueSites}
          </div>
          <div style={{ fontSize: '11px', color: '#7e22ce' }}>Locations with scanned receipts</div>
        </div>
      </div>

      {/* Filter Bar + Permanent Audit Table */}
      <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', background: '#f8fafc' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '210px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Search P/N, description, serial, ref #, user, audit ID..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setDisplayLimit(200); }}
              style={{ width: '100%', paddingLeft: '32px', height: '34px', fontSize: '12.5px' }}
            />
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Tag size={13} color="#64748b" />
            <select
              className="form-select"
              value={classificationFilter}
              onChange={(e) => { setClassificationFilter(e.target.value); setDisplayLimit(200); }}
              style={{ height: '34px', fontSize: '12px', minWidth: '155px' }}
            >
              <option value="ALL">All Classifications</option>
              {filterOptions.classifications.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Building2 size={13} color="#64748b" />
            <select
              className="form-select"
              value={siteFilter}
              onChange={(e) => { setSiteFilter(e.target.value); setDisplayLimit(200); }}
              style={{ height: '34px', fontSize: '12px', minWidth: '155px' }}
            >
              <option value="ALL">All Sites ({filterOptions.sites.length})</option>
              {filterOptions.sites.map(([code, name]) => (
                <option key={code} value={code}>{code} — {name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <User size={13} color="#64748b" />
            <select
              className="form-select"
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setDisplayLimit(200); }}
              style={{ height: '34px', fontSize: '12px', minWidth: '140px' }}
            >
              <option value="ALL">All Users</option>
              {filterOptions.users.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={13} color="#64748b" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setDisplayLimit(200); }}
              title="From date"
              style={{ height: '34px', fontSize: '11.5px', padding: '2px 6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setDisplayLimit(200); }}
              title="To date"
              style={{ height: '34px', fontSize: '11.5px', padding: '2px 6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSearchQuery('');
                setClassificationFilter('ALL');
                setSiteFilter('ALL');
                setUserFilter('ALL');
                setDateFrom('');
                setDateTo('');
                setDisplayLimit(200);
              }}
              style={{ height: '34px', fontSize: '11.5px' }}
            >
              Reset
            </button>
          )}
        </div>

        {isLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            <RefreshCw size={22} className="spin" style={{ marginBottom: '8px' }} />
            <div>Loading permanent Scan-In Audit Trail...</div>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div style={{ padding: '44px 20px', textAlign: 'center', color: '#64748b' }}>
            <ShieldCheck size={30} style={{ opacity: 0.45, marginBottom: '8px' }} />
            <div style={{ fontWeight: 600, color: '#334155', marginBottom: '4px' }}>No Scan-In Audit Records Match</div>
            <div style={{ fontSize: '12.5px' }}>
              {records.length === 0
                ? 'Parts scanned via Receive Scan-In will appear here permanently as tamper-proof audit records.'
                : 'Try adjusting your search or filter criteria.'}
            </div>
          </div>
        ) : (
          <>
            <div className="table-container" style={{ overflowX: 'auto', maxHeight: '620px', overflowY: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '12px', minWidth: '1060px' }}>
                <thead>
                  <tr>
                    <th>Audit ID</th>
                    <th>Date &amp; Time Scanned</th>
                    <th>Part Number</th>
                    <th>Part Description</th>
                    <th>Serial Number</th>
                    <th>Tagging / Classification</th>
                    <th>Scanned By</th>
                    <th>Receiving Site</th>
                    <th>Ref / Transaction #</th>
                    <th>Integrity</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.slice(0, displayLimit).map(rec => {
                    const iso = String(rec.scanned_at || '');
                    const datePart = iso ? iso.slice(0, 10) : '—';
                    const timePart = iso ? (formatTo12HourTime ? formatTo12HourTime(iso) : iso.slice(11, 19)) : '';
                    const badgeStyle = getClassificationBadgeStyle(rec.classification);
                    return (
                      <tr key={rec.audit_id}>
                        <td className="font-mono" style={{ whiteSpace: 'nowrap', fontSize: '11px', color: '#475569' }}>
                          <span style={{ fontWeight: 700, color: '#0f172a' }}>{rec.audit_id}</span>
                          <div style={{ fontSize: '10px', color: '#94a3b8' }}>{rec.intake_method}</div>
                        </td>
                        <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{datePart}</div>
                          <div style={{ fontSize: '10.5px', color: '#64748b' }}>{timePart}</div>
                        </td>
                        <td className="font-mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {rec.part_number}
                        </td>
                        <td style={{ maxWidth: '240px' }}>
                          <div style={{ fontWeight: 500, color: '#1e293b' }}>{rec.part_description}</div>
                          {rec.notes && (
                            <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>{rec.notes}</div>
                          )}
                        </td>
                        <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>
                          {rec.serial_number && rec.serial_number !== 'N/A' ? (
                            <button
                              type="button"
                              onClick={() => handleCopy(rec.serial_number)}
                              title="Click to copy serial number"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                fontSize: '12px',
                                fontWeight: 700,
                                color: '#0369a1',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <span>{rec.serial_number}</span>
                              {copiedKey === rec.serial_number ? <Check size={11} color="#16a34a" /> : <Copy size={11} style={{ opacity: 0.6 }} />}
                            </button>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>N/A</span>
                          )}
                        </td>
                        <td>
                          <span
                            style={{
                              ...badgeStyle,
                              fontSize: '10.5px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '999px',
                              whiteSpace: 'nowrap',
                              display: 'inline-block'
                            }}
                          >
                            {rec.classification}
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 600, color: '#0f172a' }}>
                          {rec.scanned_by}
                        </td>
                        <td>
                          <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>{rec.receiving_site_code}</div>
                          {rec.receiving_site_name && rec.receiving_site_name !== rec.receiving_site_code && (
                            <div style={{ fontSize: '10.5px', color: '#64748b' }}>{rec.receiving_site_name}</div>
                          )}
                          {rec.origin_site && (
                            <div style={{ fontSize: '10px', color: '#0369a1', marginTop: '1px' }}>From: {rec.origin_site}</div>
                          )}
                        </td>
                        <td className="font-mono" style={{ fontSize: '11.5px', color: '#334155', whiteSpace: 'nowrap' }}>
                          {rec.reference_number || '—'}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span
                            title={`Immutable Record Hash: ${rec.integrity_hash}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              color: '#047857',
                              background: '#ecfdf5',
                              border: '1px solid #a7f3d0',
                              borderRadius: '6px',
                              padding: '2px 6px'
                            }}
                          >
                            <Lock size={10} />
                            <span>Locked</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ padding: '10px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#64748b' }}>
              <span>
                Showing <strong>{Math.min(displayLimit, filteredRecords.length).toLocaleString()}</strong> of <strong>{filteredRecords.length.toLocaleString()}</strong> permanent audit record(s)
              </span>
              {filteredRecords.length > displayLimit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setDisplayLimit(prev => prev + 200)}
                >
                  Show More (+200)
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
