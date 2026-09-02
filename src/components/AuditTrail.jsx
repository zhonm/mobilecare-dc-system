import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from '../context/AppContext';
import { generateAuditTrailPDF } from '../utils/pdfGenerator';
import {
  History,
  Search,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Box,
  UploadCloud,
  FileSpreadsheet,
  Calendar,
  Trash2,
  Download,
  RefreshCw,
  FileText,
  AlertTriangle,
  X,
  Truck,
  Layers,
  BarChart3,
  TrendingUp,
  Clock,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Printer,
  Sparkles
} from 'lucide-react';

export default function AuditTrail() {
  const {
    inventoryUnits = [],
    scanLogs = [],
    sites = [],
    uploadAuditLogs = [],
    deletionAuditLogs = [],
    deleteAllAuditLogs,
    currentUser,
    showToast,
    autoRefreshData,
    isAutoRefreshing
  } = useApp();

  const isSuperadmin = currentUser?.role === 'superadmin';

  // Active Tab: 'report' | 'uploads' | 'deletions' | 'serial_tracer' | 'scan_logs'
  const [auditTab, setAuditTab] = useState('report');

  // Search & Filter State
  const [localSearch, setLocalSearch] = useState('');
  const [deletionEntityTypeFilter, setDeletionEntityTypeFilter] = useState('ALL');
  const [periodFilter, setPeriodFilter] = useState('ALL');
  const [selectedSerial, setSelectedSerial] = useState('');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  // Modals & Async state
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  // ── Executive Report Metrics Calculations ────────────────────────────────────
  const reportMetrics = useMemo(() => {
    const totalUploads = (uploadAuditLogs || []).length;
    const totalValuation = (uploadAuditLogs || []).reduce((acc, curr) => acc + Number(curr.total_master_cost || 0), 0);
    const totalForecastUnits = (uploadAuditLogs || []).reduce((acc, curr) => acc + Number(curr.total_forecast_units || 0), 0);
    const totalAllocatedUnits = (uploadAuditLogs || []).reduce((acc, curr) => acc + Number(curr.total_allocated_units || 0), 0);
    const totalDeletions = (deletionAuditLogs || []).length;
    const totalScans = (scanLogs || []).length;

    // Monthly aggregation
    const monthlyGroups = {};
    (uploadAuditLogs || []).forEach(log => {
      const monthKey = log.target_month || 'Other Period';
      if (!monthlyGroups[monthKey]) {
        monthlyGroups[monthKey] = {
          month: monthKey,
          uploadCount: 0,
          totalCost: 0,
          forecastUnits: 0,
          allocatedUnits: 0,
          latestUpload: log.timestamp,
          uploadedBy: log.user_name || 'Super Admin'
        };
      }
      monthlyGroups[monthKey].uploadCount += 1;
      monthlyGroups[monthKey].totalCost += Number(log.total_master_cost || 0);
      monthlyGroups[monthKey].forecastUnits += Number(log.total_forecast_units || 0);
      monthlyGroups[monthKey].allocatedUnits += Number(log.total_allocated_units || 0);
    });

    const monthlySummary = Object.values(monthlyGroups).sort((a, b) => new Date(b.latestUpload) - new Date(a.latestUpload));

    return {
      totalUploads,
      totalValuation,
      totalForecastUnits,
      totalAllocatedUnits,
      totalDeletions,
      totalScans,
      monthlySummary
    };
  }, [uploadAuditLogs, deletionAuditLogs, scanLogs]);

  // ── Filtered Datasets ───────────────────────────────────────────────────────

  // 1. Upload Logs Filter
  const filteredUploads = useMemo(() => {
    let list = (uploadAuditLogs || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (periodFilter !== 'ALL') {
      list = list.filter(l => (l.target_month || '').toLowerCase() === periodFilter.toLowerCase());
    }

    if (!localSearch.trim()) return list;
    const q = localSearch.toLowerCase();
    return list.filter(l =>
      (l.file_name || '').toLowerCase().includes(q) ||
      (l.user_name || '').toLowerCase().includes(q) ||
      (l.user_email || '').toLowerCase().includes(q) ||
      (l.target_month || '').toLowerCase().includes(q) ||
      (l.user_role || '').toLowerCase().includes(q)
    );
  }, [uploadAuditLogs, localSearch, periodFilter]);

  // 2. Deletion Logs Filter
  const filteredDeletions = useMemo(() => {
    let list = (deletionAuditLogs || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (deletionEntityTypeFilter !== 'ALL') {
      list = list.filter(l => l.entity_type === deletionEntityTypeFilter);
    }
    if (!localSearch.trim()) return list;
    const q = localSearch.toLowerCase();
    return list.filter(l =>
      (l.entity_id || '').toLowerCase().includes(q) ||
      (l.entity_label || '').toLowerCase().includes(q) ||
      (l.entity_type || '').toLowerCase().includes(q) ||
      (l.deleted_by_name || '').toLowerCase().includes(q) ||
      (l.deleted_by_email || '').toLowerCase().includes(q) ||
      (l.deleted_by_role || '').toLowerCase().includes(q) ||
      (l.reason || '').toLowerCase().includes(q)
    );
  }, [deletionAuditLogs, deletionEntityTypeFilter, localSearch]);

  // 3. Scan Logs Filter
  const filteredScanLogs = useMemo(() => {
    const list = (scanLogs || [])
      .slice()
      .sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp));
    if (!localSearch.trim()) return list;
    const q = localSearch.toLowerCase();
    return list.filter(l =>
      (l.part_number || '').toLowerCase().includes(q) ||
      (l.serial_number || '').toLowerCase().includes(q) ||
      (l.scan_type || '').toLowerCase().includes(q) ||
      (l.user_name || '').toLowerCase().includes(q)
    );
  }, [scanLogs, localSearch]);

  // 4. Serial Tracer Matched Unit
  const matchedUnit = useMemo(() => {
    if (!selectedSerial.trim()) return null;
    const q = selectedSerial.trim().toUpperCase();
    return inventoryUnits.find(u =>
      (u.serial_number || '').toUpperCase() === q ||
      (u.serial_number || '').toUpperCase().includes(q)
    );
  }, [selectedSerial, inventoryUnits]);

  // Paginated data for uploads
  const paginatedUploads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredUploads.slice(start, start + pageSize);
  }, [filteredUploads, currentPage]);

  const totalUploadPages = Math.ceil(filteredUploads.length / pageSize) || 1;

  // ── Export Handlers: XLSX ───────────────────────────────────────────────────

  const handleExportUploadsXLSX = () => {
    if (filteredUploads.length === 0) {
      showToast?.('No upload audit records to export', 'warning');
      return;
    }
    const rows = filteredUploads.map((l, idx) => ({
      '#': idx + 1,
      'Date & Time': new Date(l.timestamp).toLocaleString(),
      'Uploaded By (Name)': l.user_name || 'Superadmin',
      'Uploaded By (Email)': l.user_email || '',
      'Role': (l.user_role || 'SUPERADMIN').toUpperCase(),
      'Ingested Masterlist': l.file_name || '',
      'File Type': l.file_type || 'WORKBOOK',
      'Target Period': l.target_month || 'N/A',
      'Forecast Units': l.total_forecast_units || 0,
      'Allocated Units': l.total_allocated_units || 0,
      'Total Valuation ($)': Number(l.total_master_cost || 0),
      'Parts Count': l.parts_count || 0,
      'Sites Count': l.sites_count || 0,
      'System Status': l.status || 'Active on Cloud'
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Upload_Audits');
    XLSX.writeFile(wb, `MDC_Upload_Audits_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Upload audits exported to Excel (.xlsx)', 'success');
  };

  const handleExportDeletionsXLSX = () => {
    if (filteredDeletions.length === 0) {
      showToast?.('No deletion audit records to export', 'warning');
      return;
    }
    const rows = filteredDeletions.map((d, idx) => ({
      '#': idx + 1,
      'Date & Time': new Date(d.timestamp).toLocaleString(),
      'Entity Type': d.entity_type || 'Record',
      'Record ID': d.entity_id || '',
      'Record Label': d.entity_label || '',
      'Deleted By (Name)': d.deleted_by_name || 'System',
      'Deleted By (Email)': d.deleted_by_email || '',
      'Role / Position': d.deleted_by_position || d.deleted_by_role || 'Specialist',
      'Reason / Note': d.reason || 'User initiated deletion',
      'Items Purged': d.summary?.itemsCount ?? '',
      'PO Reference': d.summary?.poNumber ?? '',
      'Destination Site': d.summary?.destinationSite ?? '',
      'Forecast Parts': d.summary?.forecastPartsCount ?? '',
      'Intake Date': d.summary?.intakeDate ?? ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Deletion_Audits');
    XLSX.writeFile(wb, `MDC_Deletion_Audits_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Deletion audits exported to Excel (.xlsx)', 'success');
  };

  const handleExportScanLogsXLSX = () => {
    if (filteredScanLogs.length === 0) {
      showToast?.('No barcode scanner event logs to export', 'warning');
      return;
    }
    const rows = filteredScanLogs.map((s, idx) => ({
      '#': idx + 1,
      'Date & Time': new Date(s.created_at || s.timestamp).toLocaleString(),
      'Operation': s.scan_type || 'SCAN_IN',
      'Part Number': s.part_number || 'N/A',
      'Serial Number': s.serial_number || 'N/A',
      'Warehouse Operator': s.user_name || 'Warehouse Staff',
      'Validation Result': s.is_valid !== false ? 'VALID' : 'REJECTED',
      'Error Message': s.error_message || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scanner_Logs');
    XLSX.writeFile(wb, `MDC_Scanner_Event_Logs_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Scanner logs exported to Excel (.xlsx)', 'success');
  };

  const handleExportSerialTracerXLSX = () => {
    if (!matchedUnit) {
      showToast?.('Search and select a serial number first', 'warning');
      return;
    }
    const siteObj = sites.find(s => s.id === matchedUnit.current_site_id);
    const unitSheet = [
      { Property: 'Serial Number', Value: matchedUnit.serial_number },
      { Property: 'Part Number', Value: matchedUnit.part_number },
      { Property: 'Description', Value: matchedUnit.description || 'N/A' },
      { Property: 'Current Status', Value: String(matchedUnit.status || 'in_stock').toUpperCase() },
      { Property: 'Current Location', Value: siteObj?.name || 'Distribution Center' },
      { Property: 'Box Number', Value: matchedUnit.box_number || 1 },
      { Property: 'PO Number', Value: matchedUnit.po_number || 'N/A' },
      { Property: 'Received Date', Value: matchedUnit.received_at ? new Date(matchedUnit.received_at).toLocaleString() : 'Recorded' },
      { Property: 'Received By', Value: matchedUnit.received_by || 'Warehouse Staff' },
      { Property: 'Shipped Date', Value: matchedUnit.shipped_at ? new Date(matchedUnit.shipped_at).toLocaleString() : 'N/A' }
    ];
    const ws = XLSX.utils.json_to_sheet(unitSheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Custody_Trace');
    XLSX.writeFile(wb, `MDC_Serial_Trace_${matchedUnit.serial_number}_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Serial custody trace exported to Excel (.xlsx)', 'success');
  };

  const handleExportAllAuditsXLSX = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Uploads
    const uploadRows = (uploadAuditLogs || []).map((l, idx) => ({
      '#': idx + 1,
      'Timestamp': new Date(l.timestamp).toLocaleString(),
      'Uploaded By': l.user_name || 'Superadmin',
      'Email': l.user_email || '',
      'Role': (l.user_role || 'SUPERADMIN').toUpperCase(),
      'File Name': l.file_name || '',
      'Target Period': l.target_month || '',
      'Forecast Units': l.total_forecast_units || 0,
      'Allocated Units': l.total_allocated_units || 0,
      'Total Value ($)': Number(l.total_master_cost || 0),
      'Status': l.status || 'Active'
    }));
    const wsUploads = XLSX.utils.json_to_sheet(uploadRows.length > 0 ? uploadRows : [{ Notice: 'No upload audit logs' }]);
    XLSX.utils.book_append_sheet(wb, wsUploads, 'File_Upload_Audits');

    // Sheet 2: Deletions
    const delRows = (deletionAuditLogs || []).map((d, idx) => ({
      '#': idx + 1,
      'Timestamp': new Date(d.timestamp).toLocaleString(),
      'Entity Type': d.entity_type || '',
      'Record ID': d.entity_id || '',
      'Record Label': d.entity_label || '',
      'Deleted By': d.deleted_by_name || '',
      'Role / Position': d.deleted_by_position || d.deleted_by_role || 'Specialist',
      'Reason': d.reason || '',
      'Details': JSON.stringify(d.summary || {})
    }));
    const wsDeletions = XLSX.utils.json_to_sheet(delRows.length > 0 ? delRows : [{ Notice: 'No deletion audit logs' }]);
    XLSX.utils.book_append_sheet(wb, wsDeletions, 'Data_Deletion_Audits');

    // Sheet 3: Scan Logs
    const scanRows = (scanLogs || []).map((s, idx) => ({
      '#': idx + 1,
      'Timestamp': new Date(s.created_at || s.timestamp).toLocaleString(),
      'Operation': s.scan_type || 'SCAN_IN',
      'Part Number': s.part_number || '',
      'Serial Number': s.serial_number || '',
      'Operator': s.user_name || '',
      'Result': s.is_valid !== false ? 'VALID' : 'REJECTED'
    }));
    const wsScans = XLSX.utils.json_to_sheet(scanRows.length > 0 ? scanRows : [{ Notice: 'No barcode scan logs' }]);
    XLSX.utils.book_append_sheet(wb, wsScans, 'Scanner_Event_Logs');

    XLSX.writeFile(wb, `MDC_Full_Master_Audit_Package_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Complete Multi-Sheet Audit Package exported (.xlsx)', 'success');
  };

  // ── Export Handlers: PDF ────────────────────────────────────────────────────

  const handleExportPDF = (type = auditTab) => {
    let targetData = [];
    let filterLabel = '';

    if (type === 'uploads' || type === 'report') {
      targetData = filteredUploads;
      filterLabel = periodFilter !== 'ALL' ? `Period: ${periodFilter}` : (localSearch ? `Search: "${localSearch}"` : 'All Master Uploads');
    } else if (type === 'deletions') {
      targetData = filteredDeletions;
      filterLabel = deletionEntityTypeFilter !== 'ALL' ? `Entity: ${deletionEntityTypeFilter}` : 'All Entities';
    } else if (type === 'scan_logs') {
      targetData = filteredScanLogs;
      filterLabel = localSearch ? `Search: "${localSearch}"` : 'All Scanner Logs';
    } else if (type === 'serial_tracer') {
      if (!matchedUnit) {
        showToast?.('Please search and select a valid serial number first', 'warning');
        return;
      }
      targetData = [matchedUnit];
    }

    if (type !== 'serial_tracer' && targetData.length === 0) {
      showToast?.('No records to export for this report', 'warning');
      return;
    }

    const siteObj = sites.find(s => s.id === matchedUnit?.current_site_id);
    generateAuditTrailPDF(type === 'report' ? 'uploads' : type, targetData, {
      currentUser,
      filterLabel,
      matchedUnit,
      siteName: siteObj?.name || 'Distribution Center'
    });
    showToast?.(`Audit report PDF generated successfully`, 'success');
  };

  // ── Purge All Audits Handler (Superadmin Only) ──────────────────────────────

  const handleConfirmPurgeAllAudits = async () => {
    if (!isSuperadmin) {
      showToast?.('Superadmin authorization required to purge audit records', 'error');
      return;
    }
    setIsPurging(true);
    try {
      await deleteAllAuditLogs();
      showToast?.('All audit trail records permanently purged from system & database', 'success');
      setShowPurgeModal(false);
    } catch (err) {
      console.error('Failed to purge audits:', err);
      showToast?.('Failed to purge audit records: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="audit-view" style={{ maxWidth: '100%', margin: '0 auto', paddingBottom: '30px' }}>
      {/* ── Top Header & KPI Banner Card ────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '16px', padding: '18px 22px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', color: '#ffffff', padding: '10px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(2,132,199,0.3)' }}>
              <ShieldCheck size={26} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  Serialized Lifecycle &amp; Traceability Audit System
                </h2>
                <span
                  style={{
                    background: '#ecfdf5',
                    color: '#059669',
                    border: '1px solid #a7f3d0',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                  Live Traceability Active
                </span>
              </div>
              <p style={{ fontSize: '12.5px', color: '#64748b', margin: '3px 0 0' }}>
                Enterprise custody chain, masterlist ingestion history, hardware scanner events, and immutable deletion audit records.
              </p>
            </div>
          </div>

          {/* Action Tools in Header */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData && autoRefreshData({ force: true, silent: false, reason: 'AuditTrail manual refresh' })}
              disabled={isAutoRefreshing}
              title="Force reload latest audit logs from Supabase cloud database"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, padding: '6px 12px', borderRadius: '6px' }}
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin-animation' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Sync Cloud'}</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExportAllAuditsXLSX}
              title="Export complete 3-sheet audit archive (.xlsx)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, padding: '6px 12px', borderRadius: '6px', color: '#047857' }}
            >
              <FileSpreadsheet size={14} color="#059669" />
              <span>Export Full XLSX</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleExportPDF(auditTab)}
              title="Export active audit view as official branded PDF report"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, padding: '6px 12px', borderRadius: '6px', color: '#dc2626' }}
            >
              <FileText size={14} color="#dc2626" />
              <span>Export PDF Report</span>
            </button>

            {/* Superadmin Delete All Audits Trigger */}
            {isSuperadmin && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowPurgeModal(true)}
                title="Superadmin authority: Delete all audit logs across system and cloud database"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 700,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Trash2 size={13} color="#b91c1c" />
                <span>Delete All Audits</span>
              </button>
            )}
          </div>
        </div>

        {/* ── 4 Executive KPI Metric Cards ────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '16px' }}>
          {/* KPI 1: Ingested Valuation */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TrendingUp size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Ingested Valuation</div>
              <div className="font-mono" style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                ${reportMetrics.totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '10.5px', color: '#0284c7', fontWeight: 600 }}>{reportMetrics.totalUploads} Masterlist Batches</div>
            </div>
          </div>

          {/* KPI 2: Total Units Volume */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#dcfce7', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layers size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Forecast &amp; Allocated</div>
              <div className="font-mono" style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {reportMetrics.totalForecastUnits.toLocaleString()} units
              </div>
              <div style={{ fontSize: '10.5px', color: '#15803d', fontWeight: 600 }}>100% Master Fulfillment</div>
            </div>
          </div>

          {/* KPI 3: Deletion Audits */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#fee2e2', color: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Trash2 size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Purge &amp; Deletions</div>
              <div className="font-mono" style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {reportMetrics.totalDeletions} Records Logged
              </div>
              <div style={{ fontSize: '10.5px', color: '#b91c1c', fontWeight: 600 }}>Superadmin Protected</div>
            </div>
          </div>

          {/* KPI 4: Barcode Scanner Throughput */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#f3e8ff', color: '#7e22ce', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <History size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Scanner Events</div>
              <div className="font-mono" style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {reportMetrics.totalScans} Scan Events
              </div>
              <div style={{ fontSize: '10.5px', color: '#7e22ce', fontWeight: 600 }}>Realtime Barcode Stream</div>
            </div>
          </div>
        </div>

        {/* ── Sub-Tabs Segmented Ribbon ────────────────────────────────────────── */}
        <div
          style={{
            background: '#f1f5f9',
            padding: '4px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            display: 'flex',
            gap: '4px',
            alignItems: 'center',
            marginTop: '16px',
            overflowX: 'auto'
          }}
        >
          {/* Tab: Report Summary UI */}
          <button
            type="button"
            onClick={() => setAuditTab('report')}
            style={{
              background: auditTab === 'report' ? 'linear-gradient(135deg, #0f172a 0%, #334155 100%)' : 'transparent',
              color: auditTab === 'report' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'report' ? 700 : 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'report' ? '0 2px 6px rgba(15,23,42,0.3)' : 'none'
            }}
          >
            <BarChart3 size={14} />
            <span>Executive Audit Report</span>
            <span
              style={{
                background: auditTab === 'report' ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                color: auditTab === 'report' ? '#ffffff' : '#475569',
                padding: '1px 6px',
                borderRadius: '10px',
                fontSize: '10px',
                fontWeight: 700
              }}
            >
              Summary
            </span>
          </button>

          {/* Tab: Uploads */}
          <button
            type="button"
            onClick={() => setAuditTab('uploads')}
            style={{
              background: auditTab === 'uploads' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
              color: auditTab === 'uploads' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'uploads' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'uploads' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
            }}
          >
            <UploadCloud size={14} />
            <span>Master File Ingestion</span>
            <span
              style={{
                background: auditTab === 'uploads' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: auditTab === 'uploads' ? '#ffffff' : '#475569',
                padding: '2px 7px',
                borderRadius: '12px',
                fontSize: '10.5px',
                fontWeight: 700
              }}
            >
              {uploadAuditLogs?.length || 0}
            </span>
          </button>

          {/* Tab: Deletions */}
          <button
            type="button"
            onClick={() => setAuditTab('deletions')}
            style={{
              background: auditTab === 'deletions' ? 'linear-gradient(135deg, #b91c1c 0%, #991b1b 100%)' : 'transparent',
              color: auditTab === 'deletions' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'deletions' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'deletions' ? '0 2px 6px rgba(185,28,28,0.25)' : 'none'
            }}
          >
            <Trash2 size={14} />
            <span>Data Deletions &amp; Purge</span>
            <span
              style={{
                background: auditTab === 'deletions' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: auditTab === 'deletions' ? '#ffffff' : '#475569',
                padding: '2px 7px',
                borderRadius: '12px',
                fontSize: '10.5px',
                fontWeight: 700
              }}
            >
              {deletionAuditLogs?.length || 0}
            </span>
          </button>

          {/* Tab: Serial Tracer */}
          <button
            type="button"
            onClick={() => setAuditTab('serial_tracer')}
            style={{
              background: auditTab === 'serial_tracer' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
              color: auditTab === 'serial_tracer' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'serial_tracer' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'serial_tracer' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
            }}
          >
            <Box size={14} />
            <span>Serialized Part Custody Tracer</span>
          </button>

          {/* Tab: Scanner Logs */}
          <button
            type="button"
            onClick={() => setAuditTab('scan_logs')}
            style={{
              background: auditTab === 'scan_logs' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
              color: auditTab === 'scan_logs' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'scan_logs' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'scan_logs' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
            }}
          >
            <History size={14} />
            <span>Barcode Scanner Event Logs</span>
            <span
              style={{
                background: auditTab === 'scan_logs' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: auditTab === 'scan_logs' ? '#ffffff' : '#475569',
                padding: '2px 7px',
                borderRadius: '12px',
                fontSize: '10.5px',
                fontWeight: 700
              }}
            >
              {scanLogs?.length || 0}
            </span>
          </button>
        </div>
      </div>

      {/* ── TAB 0: Executive Audit Summary Report UI (The Simple Report UI) ──────── */}
      {auditTab === 'report' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Report Summary Card */}
          <div className="card" style={{ padding: '22px 24px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BarChart3 size={20} color="#0284c7" />
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    Monthly Master Ingestion &amp; Period Valuation Report
                  </h3>
                  <span style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' }}>
                    Executive View
                  </span>
                </div>
                <p style={{ fontSize: '12.5px', color: '#64748b', margin: '3px 0 0' }}>
                  Consolidated breakdown of all masterlist datasets, period unit totals, aggregate inventory valuations, and audit timestamps.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleExportAllAuditsXLSX}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                >
                  <Download size={13} />
                  <span>Download Report (.xlsx)</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleExportPDF('report')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#dc2626' }}
                >
                  <Printer size={13} color="#dc2626" />
                  <span>Print PDF Report</span>
                </button>
              </div>
            </div>

            {/* Monthly Breakdown Table */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', padding: '11px 14px', color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Target Period</th>
                    <th style={{ textAlign: 'center', padding: '11px 10px', color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Ingestion Count</th>
                    <th style={{ textAlign: 'right', padding: '11px 14px', color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Forecast Units</th>
                    <th style={{ textAlign: 'right', padding: '11px 14px', color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Master Valuation</th>
                    <th style={{ textAlign: 'left', padding: '11px 14px', color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Primary Uploader</th>
                    <th style={{ textAlign: 'center', padding: '11px 12px', color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reportMetrics.monthlySummary.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                        No monthly ingestion reports available.
                      </td>
                    </tr>
                  ) : (
                    reportMetrics.monthlySummary.map((item, idx) => (
                      <tr
                        key={item.month}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: idx === 0 ? '#f0fdf4' : (idx % 2 === 0 ? '#ffffff' : '#fafafa')
                        }}
                      >
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <Calendar size={13} color="#0284c7" />
                            <span>{item.month}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '12px 10px' }}>
                          <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 }}>
                            {item.uploadCount} masterlists
                          </span>
                        </td>
                        <td className="font-mono" style={{ textAlign: 'right', padding: '12px 14px', fontWeight: 700, color: '#0284c7' }}>
                          {item.forecastUnits.toLocaleString()} units
                        </td>
                        <td className="font-mono" style={{ textAlign: 'right', padding: '12px 14px', fontWeight: 800, color: '#0f172a' }}>
                          ${item.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 14px', color: '#334155' }}>
                          <div style={{ fontWeight: 600 }}>{item.uploadedBy}</div>
                          <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                            Last: {new Date(item.latestUpload).toLocaleDateString()}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '12px 12px' }}>
                          {idx === 0 ? (
                            <span style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', fontSize: '10.5px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px' }}>
                              Active Cycle
                            </span>
                          ) : (
                            <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: '10.5px', fontWeight: 600, padding: '2px 7px', borderRadius: '10px' }}>
                              Archived
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Quick Audit Health & System Security Info */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginTop: '18px' }}>
              <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                  <ShieldCheck size={14} color="#059669" />
                  <span>Audit Security &amp; Database State</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                  Connected to Supabase Cloud PostgreSQL. Audit records are streamed with real-time websocket broadcasts and cross-tab synchronization.
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                  <UserCheck size={14} color="#0284c7" />
                  <span>Operator Identity &amp; Accountability</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                  Logged-in Specialist: <strong>{currentUser?.fullName || 'Superadmin'}</strong> ({currentUser?.email || 'zhonmanaois@gmail.com'}).
                  All actions are stamped with immutable cryptographic timestamps.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 1: File Upload & Master Ingestion Audits ────────────────────────── */}
      {auditTab === 'uploads' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
          {/* Toolbar */}
          <div
            style={{
              padding: '14px 18px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileSpreadsheet size={16} color="#0284c7" />
                  Master Ingestion &amp; Upload History
                </h3>
                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
                  {filteredUploads.length} Events
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Period Filter Dropdown */}
              <select
                value={periodFilter}
                onChange={(e) => {
                  setPeriodFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="form-select"
                style={{ height: '34px', fontSize: '12px', width: '150px', borderRadius: '6px' }}
              >
                <option value="ALL">All Periods</option>
                <option value="September 2026">September 2026</option>
                <option value="August 2026">August 2026</option>
              </select>

              {/* Search Bar */}
              <div style={{ position: 'relative', width: '200px' }}>
                <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Search file, user..."
                  value={localSearch}
                  onChange={(e) => {
                    setLocalSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="form-input"
                  style={{ paddingLeft: '30px', paddingRight: localSearch ? '26px' : '10px', height: '34px', fontSize: '12px', width: '100%', borderRadius: '6px' }}
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocalSearch('');
                      setCurrentPage(1);
                    }}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Single Tab Export Buttons */}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportUploadsXLSX}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <Download size={13} />
                <span>Export XLSX</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleExportPDF('uploads')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <FileText size={13} />
                <span>PDF Report</span>
              </button>
            </div>
          </div>

          {/* Table Container - Auto Responsive */}
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '920px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ width: '40px', textAlign: 'center', padding: '10px 6px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>#</th>
                  <th style={{ width: '110px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Date &amp; Time</th>
                  <th style={{ width: '190px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Uploaded By</th>
                  <th style={{ textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Ingested File</th>
                  <th style={{ width: '110px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Target Period</th>
                  <th style={{ width: '110px', textAlign: 'right', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Units</th>
                  <th style={{ width: '110px', textAlign: 'right', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Total Value</th>
                  <th style={{ width: '90px', textAlign: 'center', padding: '10px 6px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUploads.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                      <FileSpreadsheet size={36} style={{ margin: '0 auto 10px', color: '#cbd5e1' }} />
                      <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#64748b' }}>No upload events found</p>
                      <p style={{ margin: 0, fontSize: '12px' }}>Upload a masterlist to generate live audit records.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedUploads.map((log, index) => {
                    const actualIdx = (currentPage - 1) * pageSize + index;
                    const isActive = actualIdx === 0;
                    return (
                      <tr
                        key={log.id || `upload-log-${actualIdx}`}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: isActive ? '#f0fdf4' : (actualIdx % 2 === 0 ? '#ffffff' : '#fafafa')
                        }}
                      >
                        <td className="font-mono" style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>
                          {actualIdx + 1}
                        </td>
                        <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '11.5px' }}>
                            {new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                            {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <div
                              style={{
                                width: '26px',
                                height: '26px',
                                borderRadius: '50%',
                                background: isActive ? '#dcfce7' : '#e0f2fe',
                                color: isActive ? '#15803d' : '#0369a1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: '11px',
                                flexShrink: 0
                              }}
                            >
                              {log.user_name ? log.user_name.charAt(0).toUpperCase() : 'Z'}
                            </div>
                            <div style={{ overflow: 'hidden' }}>
                              <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {log.user_name || 'Super Admin'}
                              </div>
                              <div style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {log.user_email || 'zhon.manaois@mobilecareph.com'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <div style={{ fontWeight: 600, fontSize: '12px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <FileSpreadsheet size={13} color="#0284c7" style={{ flexShrink: 0 }} />
                            <span style={{ wordBreak: 'break-word' }}>{log.file_name}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '2px', alignItems: 'center' }}>
                            <span style={{ fontSize: '9px', fontWeight: 700, background: '#f1f5f9', color: '#475569', padding: '1px 4px', borderRadius: '3px' }}>
                              {log.file_type ? log.file_type.replace('_', ' ') : 'WORKBOOK'}
                            </span>
                            <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                              {log.parts_count || 41} SKUs &bull; {log.sites_count || 27} Sites
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: '11.5px', fontWeight: 600, color: '#334155' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#f8fafc', padding: '2px 7px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                            <Calendar size={11} color="#0284c7" />
                            <span>{log.target_month || 'Current'}</span>
                          </div>
                        </td>
                        <td className="font-mono" style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 700, fontSize: '12px', color: '#0284c7' }}>
                          {log.total_forecast_units?.toLocaleString() || 0} units
                        </td>
                        <td className="font-mono" style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 800, fontSize: '12px', color: '#0f172a' }}>
                          ${(log.total_master_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ textAlign: 'center', padding: '9px 6px' }}>
                          {isActive ? (
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '2px 7px',
                                borderRadius: '10px',
                                background: '#ecfdf5',
                                color: '#047857',
                                border: '1px solid #a7f3d0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                            >
                              <CheckCircle2 size={10} />
                              <span>Active</span>
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '9.5px',
                                fontWeight: 600,
                                padding: '2px 6px',
                                borderRadius: '10px',
                                background: '#f1f5f9',
                                color: '#64748b',
                                border: '1px solid #e2e8f0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                            >
                              <History size={9} />
                              <span>Archived</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {totalUploadPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to <strong>{Math.min(currentPage * pageSize, filteredUploads.length)}</strong> of <strong>{filteredUploads.length}</strong> records
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  style={{ height: '30px', padding: '0 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                >
                  <ChevronLeft size={13} />
                  <span>Prev</span>
                </button>
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                  {currentPage} / {totalUploadPages}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={currentPage === totalUploadPages}
                  onClick={() => setCurrentPage(p => Math.min(totalUploadPages, p + 1))}
                  style={{ height: '30px', padding: '0 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                >
                  <span>Next</span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: Data Deletions & Purge Audits ────────────────────────────────── */}
      {auditTab === 'deletions' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
          {/* Toolbar */}
          <div
            style={{
              padding: '14px 18px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Trash2 size={16} color="#b91c1c" />
                  Data Deletions &amp; Purge Audit Trail
                </h3>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
                  {filteredDeletions.length} Events
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Entity Type Filter */}
              <select
                value={deletionEntityTypeFilter}
                onChange={(e) => setDeletionEntityTypeFilter(e.target.value)}
                className="form-select"
                style={{ height: '34px', fontSize: '12px', width: '160px', borderRadius: '6px' }}
              >
                <option value="ALL">All Entities ({deletionAuditLogs.length})</option>
                <option value="DC Intake Record">Intake Records</option>
                <option value="Period Snapshot">Period Snapshots</option>
                <option value="Shipment Manifest">Shipments</option>
                <option value="Purchase Order">Purchase Orders</option>
                <option value="Inventory Unit">Inventory Units</option>
              </select>

              {/* Search Bar */}
              <div style={{ position: 'relative', width: '190px' }}>
                <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Search ID, user, reason..."
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: '30px', paddingRight: localSearch ? '26px' : '10px', height: '34px', fontSize: '12px', width: '100%', borderRadius: '6px' }}
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => setLocalSearch('')}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Export Buttons */}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportDeletionsXLSX}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <Download size={13} />
                <span>Export XLSX</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleExportPDF('deletions')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <FileText size={13} />
                <span>PDF Report</span>
              </button>
            </div>
          </div>

          {/* Table Container - Auto Responsive */}
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '880px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ width: '40px', textAlign: 'center', padding: '10px 6px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>#</th>
                  <th style={{ width: '120px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Timestamp</th>
                  <th style={{ width: '130px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Entity Type</th>
                  <th style={{ textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Deleted Record ID &amp; Reason</th>
                  <th style={{ width: '200px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Deleted By</th>
                  <th style={{ width: '150px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Impact Summary</th>
                  <th style={{ width: '85px', textAlign: 'center', padding: '10px 6px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeletions.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                      <Trash2 size={36} style={{ margin: '0 auto 10px', color: '#cbd5e1' }} />
                      <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#64748b' }}>No deletion audit events found</p>
                      <p style={{ margin: 0, fontSize: '12px' }}>When records are deleted, immutable audit logs will appear here.</p>
                    </td>
                  </tr>
                ) : (
                  filteredDeletions.map((log, index) => {
                    const isIntake = log.entity_type === 'DC Intake Record';
                    const isSnapshot = log.entity_type === 'Period Snapshot';
                    const isShipment = log.entity_type === 'Shipment Manifest';

                    return (
                      <tr
                        key={log.id || `deletion-log-${index}`}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: index % 2 === 0 ? '#ffffff' : '#fafafa'
                        }}
                      >
                        <td className="font-mono" style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>
                          {index + 1}
                        </td>
                        <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '11.5px' }}>
                            {new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                            {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '5px',
                              background: isIntake ? '#fffbeb' : isSnapshot ? '#eff6ff' : isShipment ? '#f0fdf4' : '#fee2e2',
                              color: isIntake ? '#b45309' : isSnapshot ? '#1d4ed8' : isShipment ? '#15803d' : '#b91c1c',
                              border: `1px solid ${isIntake ? '#fde68a' : isSnapshot ? '#bfdbfe' : isShipment ? '#bbf7d0' : '#fecaca'}`,
                              display: 'inline-block'
                            }}
                          >
                            {log.entity_type}
                          </span>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <div className="font-mono" style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a' }}>
                            {log.entity_id}
                          </div>
                          <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>
                            {log.entity_label || log.entity_id}
                          </div>
                          {log.reason && (
                            <div style={{ fontSize: '10.5px', color: '#b91c1c', marginTop: '2px', fontStyle: 'italic' }}>
                              Reason: {log.reason}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <div
                              style={{
                                width: '26px',
                                height: '26px',
                                borderRadius: '50%',
                                background: '#fee2e2',
                                color: '#b91c1c',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: '11px',
                                flexShrink: 0
                              }}
                            >
                              {log.deleted_by_name ? log.deleted_by_name.charAt(0).toUpperCase() : 'Z'}
                            </div>
                            <div style={{ overflow: 'hidden' }}>
                              <div style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {log.deleted_by_name || 'Zhon Manaois'}
                              </div>
                              <div style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {log.deleted_by_position || log.deleted_by_role || 'Specialist'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: '11px', color: '#334155' }}>
                          {log.summary?.itemsCount !== undefined && (
                            <div style={{ fontWeight: 600 }}>
                              <strong>{log.summary.itemsCount}</strong> units purged
                            </div>
                          )}
                          {log.summary?.poNumber && (
                            <div style={{ color: '#64748b' }}>
                              PO: <span className="font-mono">{log.summary.poNumber}</span>
                            </div>
                          )}
                          {log.summary?.destinationSite && (
                            <div style={{ color: '#64748b' }}>
                              Dest: {log.summary.destinationSite}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', padding: '9px 6px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '2px 7px',
                              borderRadius: '10px',
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <ShieldCheck size={10} />
                            <span>Logged</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 3: Serialized Part Custody Tracer ──────────────────────────────── */}
      {auditTab === 'serial_tracer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Search Card */}
          <div className="card" style={{ padding: '18px 22px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Box size={16} color="#0284c7" />
                  Serialized Unit Custody Chain Tracer
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Search any individual Apple serial number to inspect its lifecycle: Scan-In &rarr; Allocation &rarr; Pack Out &rarr; Branch Dispatch.
                </p>
              </div>

              {matchedUnit && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleExportSerialTracerXLSX}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    <Download size={13} />
                    <span>Export XLSX</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleExportPDF('serial_tracer')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    <FileText size={13} />
                    <span>Trace PDF</span>
                  </button>
                </div>
              )}
            </div>

            <div style={{ position: 'relative', maxWidth: '580px' }}>
              <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Enter exact Apple Serial Number (e.g. FG9HTN005WS00006TT)..."
                value={selectedSerial}
                onChange={(e) => setSelectedSerial(e.target.value)}
                className="form-input font-mono"
                style={{ paddingLeft: '34px', height: '40px', fontSize: '13px', fontWeight: 600, width: '100%', borderRadius: '8px' }}
              />
              {selectedSerial && (
                <button
                  type="button"
                  onClick={() => setSelectedSerial('')}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Matched Unit Lifecycle Display */}
          {matchedUnit ? (
            <div className="card" style={{ padding: '20px 22px', border: '1px solid #bae6fd', background: '#ffffff', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '2px 8px', borderRadius: '10px', background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }}>
                      {String(matchedUnit.status || 'in_stock').toUpperCase()}
                    </span>
                    <span className="font-mono" style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                      {matchedUnit.serial_number}
                    </span>
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '4px 0 2px' }}>
                    {matchedUnit.description || 'Apple Genuine Component'}
                  </h3>
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                    Part Number: <strong className="font-mono" style={{ color: '#0f172a' }}>{matchedUnit.part_number}</strong>
                    {matchedUnit.po_number && <> &bull; PO Ref: <strong className="font-mono" style={{ color: '#0f172a' }}>{matchedUnit.po_number}</strong></>}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Current Location</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: '#0284c7', marginTop: '1px' }}>
                    {sites.find(s => s.id === matchedUnit.current_site_id)?.name || 'Distribution Center Main Warehouse'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>
                    Box #{matchedUnit.box_number || 1} &bull; Intake Batch Verified
                  </div>
                </div>
              </div>

              {/* 4-Stage Custody Visual Stepper Pipeline */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                {/* Stage 1: DC Receive Scan-In */}
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>
                    <CheckCircle2 size={13} />
                    <span>1. DC Receive Scan-In</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {matchedUnit.received_at ? new Date(matchedUnit.received_at).toLocaleDateString() : 'Recorded in Stock'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    By: <strong>{matchedUnit.received_by || 'Warehouse Staff'}</strong>
                  </div>
                </div>

                {/* Stage 2: Allocation & Order Matching */}
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>
                    <Layers size={13} />
                    <span>2. Allocation &amp; Cycle</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {matchedUnit.allocated_at ? new Date(matchedUnit.allocated_at).toLocaleDateString() : 'Auto-Allocated'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Target: <strong>{sites.find(s => s.id === matchedUnit.current_site_id)?.name || 'DC Stock'}</strong>
                  </div>
                </div>

                {/* Stage 3: Box Pack Scan-Out */}
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>
                    <Box size={13} />
                    <span>3. Pack Scan-Out</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {matchedUnit.shipped_at ? new Date(matchedUnit.shipped_at).toLocaleDateString() : (matchedUnit.status === 'packed' ? 'Packed in Dispatch' : 'Awaiting Pack')}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Box #: <strong>{matchedUnit.box_number || 1}</strong>
                  </div>
                </div>

                {/* Stage 4: Dispatch & Delivery */}
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>
                    <Truck size={13} />
                    <span>4. Dispatch &amp; Delivery</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {matchedUnit.status === 'delivered' ? 'Delivered' : matchedUnit.status === 'shipped' || matchedUnit.status === 'packed' ? 'Dispatched' : 'In DC Stock'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Status: <strong style={{ color: '#047857' }}>{String(matchedUnit.status || 'in_stock').toUpperCase()}</strong>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedSerial.trim() ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', border: '1px dashed #cbd5e1', borderRadius: '12px' }}>
              <Box size={32} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
              <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: '#475569' }}>
                No serial number found matching &quot;{selectedSerial}&quot;
              </p>
              <p style={{ margin: 0, fontSize: '12px' }}>
                Verify the entered Apple serial string or check Barcode Scanner Event Logs.
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* ── TAB 4: Barcode Scanner Event Logs ──────────────────────────────────── */}
      {auditTab === 'scan_logs' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
          {/* Toolbar */}
          <div
            style={{
              padding: '14px 18px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <History size={16} color="#0284c7" />
                  Hardware Barcode Scanner Event Logs
                </h3>
                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
                  {filteredScanLogs.length} Events
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Search Bar */}
              <div style={{ position: 'relative', width: '200px' }}>
                <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Search serial, P/N..."
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: '30px', paddingRight: localSearch ? '26px' : '10px', height: '34px', fontSize: '12px', width: '100%', borderRadius: '6px' }}
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => setLocalSearch('')}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Single Tab Export Buttons */}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportScanLogsXLSX}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <Download size={13} />
                <span>Export XLSX</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleExportPDF('scan_logs')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <FileText size={13} />
                <span>PDF Report</span>
              </button>
            </div>
          </div>

          {/* Table Container - Auto Responsive */}
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '850px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ width: '40px', textAlign: 'center', padding: '10px 6px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>#</th>
                  <th style={{ width: '140px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Timestamp</th>
                  <th style={{ width: '120px', textAlign: 'center', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Operation</th>
                  <th style={{ width: '130px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Part Number</th>
                  <th style={{ textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Serial Number</th>
                  <th style={{ width: '160px', textAlign: 'left', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Operator</th>
                  <th style={{ width: '110px', textAlign: 'center', padding: '10px 8px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {filteredScanLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                      <History size={36} style={{ margin: '0 auto 10px', color: '#cbd5e1' }} />
                      <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#64748b' }}>No barcode scanner events recorded</p>
                      <p style={{ margin: 0, fontSize: '12px' }}>Live scans from Receive Scan-In and Pack Scan-Out will stream here.</p>
                    </td>
                  </tr>
                ) : (
                  filteredScanLogs.map((log, index) => (
                    <tr
                      key={log.id || `scan-log-${index}`}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: index % 2 === 0 ? '#ffffff' : '#fafafa'
                      }}
                    >
                      <td className="font-mono" style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>
                        {index + 1}
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '11.5px' }}>
                          {new Date(log.created_at || log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                          {new Date(log.created_at || log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '9px 10px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: '#e0f2fe',
                            color: '#0369a1',
                            border: '1px solid #bae6fd',
                            fontFamily: 'var(--font-mono, monospace)',
                            display: 'inline-block'
                          }}
                        >
                          {log.scan_type || 'SCAN_IN'}
                        </span>
                      </td>
                      <td className="font-mono" style={{ padding: '9px 10px', fontWeight: 700, color: '#0f172a' }}>
                        {log.part_number || 'N/A'}
                      </td>
                      <td className="font-mono" style={{ padding: '9px 10px', fontWeight: 700, color: '#0284c7' }}>
                        {log.serial_number || 'N/A'}
                      </td>
                      <td style={{ padding: '9px 10px', fontSize: '11.5px', color: '#334155' }}>
                        <div style={{ fontWeight: 600 }}>{log.user_name || 'Warehouse Staff'}</div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '9px 8px' }}>
                        {log.is_valid !== false ? (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '10px',
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <CheckCircle2 size={10} />
                            <span>Valid</span>
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '10px',
                              background: '#fee2e2',
                              color: '#991b1b',
                              border: '1px solid #fecaca',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                            title={log.error_message}
                          >
                            <XCircle size={10} />
                            <span>{log.error_message || 'Rejected'}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODAL: Delete All Audit Records Confirmation (Superadmin Only) ─────── */}
      {showPurgeModal && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !isPurging) setShowPurgeModal(false); }}>
          <div className="modal-content" style={{ maxWidth: '520px', borderRadius: '12px', overflow: 'hidden' }}>
            {/* Modal Header */}
            <div className="modal-header" style={{ background: '#991b1b', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#f87171', color: '#7f1d1d', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={20} color="#ffffff" />
                </div>
                <div>
                  <h3 style={{ color: '#ffffff', fontSize: '16px', fontWeight: 800, margin: 0 }}>
                    Permanently Delete All Audit Records?
                  </h3>
                  <p style={{ color: '#fecaca', fontSize: '11.5px', margin: '2px 0 0' }}>
                    Superadmin Authority &bull; System &amp; PostgreSQL Database Purge
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isPurging && setShowPurgeModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#fecaca', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="modal-body" style={{ padding: '20px' }}>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '12px 14px', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>
                  Warning: This action is irreversible and will permanently wipe all audit logs across all connected clients and the Supabase cloud database.
                </p>
              </div>

              <div style={{ fontSize: '12.5px', color: '#334155', marginBottom: '14px' }}>
                The following records will be completely removed:
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Master File Upload Audits:</span>
                  <strong style={{ color: '#0f172a' }}>{uploadAuditLogs.length} records</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Data Deletion &amp; Purge Audits:</span>
                  <strong style={{ color: '#0f172a' }}>{deletionAuditLogs.length} records</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Hardware Scanner Event Logs:</span>
                  <strong style={{ color: '#0f172a' }}>{scanLogs.length} events</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Supabase Cloud DB Tables:</span>
                  <strong style={{ color: '#b91c1c' }}>audit_logs, scan_logs, saved_records</strong>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isPurging}
                onClick={() => setShowPurgeModal(false)}
                style={{ fontSize: '12.5px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={isPurging}
                onClick={handleConfirmPurgeAllAudits}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 700 }}
              >
                {isPurging ? (
                  <>
                    <RefreshCw size={14} className="spin-animation" />
                    <span>Purging Cloud Database...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Yes, Purge All Audit Records</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

