import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import SaveIntakeRecordModal from './SaveIntakeRecordModal';
import * as XLSX from 'xlsx';
import {
  BookmarkPlus,
  Package,
  Calendar,
  User,
  Search,
  Printer,
  Trash2,
  Eye,
  CheckCircle2,
  AlertCircle,
  Barcode,
  FileSpreadsheet,
  X,
  Tag,
  Plus,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Boxes,
  Copy,
  Check,
  Filter,
  ArrowUpRight
} from 'lucide-react';
import { normalizeInventoryUnits } from '../utils/partResolver';

export default function IntakeRecords() {
  const {
    dcIntakeRecords,
    deleteIntakeRecord,
    inventoryUnits,
    deleteScanInUnit,
    updateUnitAssignment,
    deleteAllStockUnits,
    parts,
    setActiveTab,
    isAutoRefreshing,
    lastSyncedAt,
    autoRefreshData,
    showToast,
    processOfflineSyncQueue
  } = useApp();

  // Active View Tab: 'stock_by_date' | 'batch_records'
  const [activeView, setActiveView] = useState('stock_by_date');

  // Search & Filtering State
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [assignmentFilter, setAssignmentFilter] = useState('ALL'); // 'ALL' | 'MDC - Forecasting' | 'DC - CRBR'
  const [yearFilter, setYearFilter] = useState('ALL');

  // Modals & Inspectors
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [modalInitialUnits, setModalInitialUnits] = useState([]);
  const [selectedRecordToInspect, setSelectedRecordToInspect] = useState(null);
  const [recordToDelete, setRecordToDelete] = useState(null);
  const [unitToDelete, setUnitToDelete] = useState(null);
  const [inspectSearch, setInspectSearch] = useState('');
  const [copiedSerial, setCopiedSerial] = useState(null);

  // Collapsed / Expanded Date Sections
  const [collapsedDates, setCollapsedDates] = useState({});

  const toggleDateCollapse = (dateKey) => {
    setCollapsedDates(prev => ({
      ...prev,
      [dateKey]: !prev[dateKey]
    }));
  };

  // Helper to copy serial number
  const handleCopySerial = (serial) => {
    navigator.clipboard.writeText(serial);
    setCopiedSerial(serial);
    showToast(`Copied ${serial} to clipboard`, 'info');
    setTimeout(() => setCopiedSerial(null), 2000);
  };

  // Date strings
  const todayDateStr = new Date().toISOString().split('T')[0];

  // Lookup part pricing helper
  const partPriceMap = useMemo(() => {
    const map = new Map();
    (parts || []).forEach(p => {
      if (p.part_number) map.set(p.part_number.toUpperCase(), p.stocking_price || 0);
    });
    return map;
  }, [parts]);

  // Enriched in-stock units with category, pricing, assignment, and normalized receipt date
  const enrichedStockUnits = useMemo(() => {
    const normalizedUnits = normalizeInventoryUnits(inventoryUnits || [], parts || []);
    return normalizedUnits.map((u, idx) => {
      const pn = (u.part_number || '').toUpperCase();
      const desc = u.description || 'Apple Genuine Service Part';
      const isDisplay = desc.toLowerCase().includes('display') || desc.toLowerCase().includes('screen');
      const isBattery = desc.toLowerCase().includes('battery');
      const isCamera = desc.toLowerCase().includes('camera');
      const isBackGlass = desc.toLowerCase().includes('back glass') || desc.toLowerCase().includes('rear glass');
      
      const category = isDisplay
        ? 'Display'
        : isBattery
        ? 'Battery'
        : isCamera
        ? 'Camera'
        : isBackGlass
        ? 'Back Glass'
        : 'Other Parts';

      const price = u.stocking_price || partPriceMap.get(pn) || (isDisplay ? 329 : isBattery ? 99 : 50);

      const rawAssignment = u.intake_assignment || (u.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
      const isCrbr = rawAssignment.includes('CRBR');
      const assignment = isCrbr ? 'DC - CRBR' : 'MDC - Forecasting';

      // Parse date key (YYYY-MM-DD)
      let dateKey = todayDateStr;
      let timeStr = '12:00:00';
      if (u.received_at) {
        try {
          const d = new Date(u.received_at);
          if (!isNaN(d.getTime())) {
            dateKey = d.toISOString().split('T')[0];
            timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }
        } catch (e) {}
      }

      return {
        ...u,
        id: u.id || `unit-${u.serial_number || idx}`,
        part_number: pn || 'PART-UNKNOWN',
        description: desc,
        category,
        price,
        intake_assignment: assignment,
        notes: u.notes || assignment,
        isCrbr,
        dateKey,
        timeStr,
        received_at: u.received_at || new Date().toISOString()
      };
    });
  }, [inventoryUnits, partPriceMap, todayDateStr, parts]);

  // Overall metric calculations
  const totalStockUnitsCount = enrichedStockUnits.length;
  const totalStockValuation = useMemo(() => {
    return enrichedStockUnits.reduce((sum, u) => sum + (u.price || 0), 0);
  }, [enrichedStockUnits]);

  const todayScannedUnits = useMemo(() => {
    return enrichedStockUnits.filter(u => u.dateKey === todayDateStr);
  }, [enrichedStockUnits, todayDateStr]);

  const totalBatchesCount = dcIntakeRecords.length;
  const totalUnitsAcrossBatches = useMemo(() => {
    return dcIntakeRecords.reduce((sum, r) => sum + (r.total_units || (r.items ? r.items.length : 0)), 0);
  }, [dcIntakeRecords]);

  // Unique list of dates present in in-stock inventory
  const availableStockDates = useMemo(() => {
    const dates = new Set();
    enrichedStockUnits.forEach(u => {
      if (u.dateKey) dates.add(u.dateKey);
    });
    return Array.from(dates).sort((a, b) => new Date(b) - new Date(a));
  }, [enrichedStockUnits]);

  // Filtered in-stock units
  const filteredStockUnits = useMemo(() => {
    return enrichedStockUnits.filter(u => {
      // Date filter
      if (dateFilter !== 'ALL' && u.dateKey !== dateFilter) {
        return false;
      }
      // Category filter
      if (categoryFilter !== 'ALL' && u.category !== categoryFilter) {
        return false;
      }
      // Assignment filter
      if (assignmentFilter === 'MDC - Forecasting' && u.isCrbr) {
        return false;
      }
      if (assignmentFilter === 'DC - CRBR' && !u.isCrbr) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchPn = u.part_number?.toLowerCase().includes(q);
        const matchSn = u.serial_number?.toLowerCase().includes(q);
        const matchDesc = u.description?.toLowerCase().includes(q);
        const matchPo = u.po_number?.toLowerCase().includes(q) || u.po_id?.toLowerCase().includes(q);
        const matchAssign = u.intake_assignment?.toLowerCase().includes(q) || u.notes?.toLowerCase().includes(q);
        const matchSource = u.intake_source?.toLowerCase().includes(q);
        if (!matchPn && !matchSn && !matchDesc && !matchPo && !matchAssign && !matchSource) {
          return false;
        }
      }
      return true;
    });
  }, [enrichedStockUnits, dateFilter, categoryFilter, assignmentFilter, searchQuery]);

  // Group filtered in-stock units by Date
  const stockByDateGroups = useMemo(() => {
    const groups = {};
    filteredStockUnits.forEach(u => {
      if (!groups[u.dateKey]) {
        groups[u.dateKey] = [];
      }
      groups[u.dateKey].push(u);
    });

    // Return array of groups sorted by date descending
    return Object.entries(groups)
      .map(([dateKey, items]) => {
        let dateLabel = dateKey;
        try {
          const d = new Date(dateKey + 'T00:00:00');
          if (!isNaN(d.getTime())) {
            dateLabel = d.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });
          }
        } catch (e) {}

        const displaysCount = items.filter(i => i.category === 'Display').length;
        const batteriesCount = items.filter(i => i.category === 'Battery').length;
        const crbrCount = items.filter(i => i.isCrbr).length;
        const forecastingCount = items.length - crbrCount;
        const otherCount = items.length - displaysCount - batteriesCount;
        const groupValuation = items.reduce((acc, i) => acc + (i.price || 0), 0);

        return {
          dateKey,
          dateLabel,
          items,
          count: items.length,
          displaysCount,
          batteriesCount,
          crbrCount,
          forecastingCount,
          otherCount,
          valuation: groupValuation
        };
      })
      .sort((a, b) => new Date(b.dateKey) - new Date(a.dateKey));
  }, [filteredStockUnits]);

  // Unique years for batch records
  const availableBatchYears = useMemo(() => {
    const years = new Set();
    dcIntakeRecords.forEach(r => {
      if (r.intake_date) {
        const y = new Date(r.intake_date).getFullYear();
        if (!isNaN(y)) years.add(y);
      }
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [dcIntakeRecords]);

  // Filtered batch records
  const filteredBatchRecords = useMemo(() => {
    return dcIntakeRecords.filter(rec => {
      if (yearFilter !== 'ALL' && rec.intake_date) {
        const y = new Date(rec.intake_date).getFullYear();
        if (String(y) !== String(yearFilter)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchId = rec.id?.toLowerCase().includes(q);
        const matchName = rec.record_name?.toLowerCase().includes(q);
        const matchUser = rec.saved_by_name?.toLowerCase().includes(q);
        const matchPo = rec.po_number?.toLowerCase().includes(q);
        const matchNotes = rec.notes?.toLowerCase().includes(q);
        const matchItems = (rec.items || []).some(
          it =>
            it.part_number?.toLowerCase().includes(q) ||
            it.serial_number?.toLowerCase().includes(q) ||
            it.description?.toLowerCase().includes(q)
        );
        if (!matchId && !matchName && !matchUser && !matchPo && !matchNotes && !matchItems) {
          return false;
        }
      }
      return true;
    });
  }, [dcIntakeRecords, yearFilter, searchQuery]);

  // Export Date Group to Excel (.xlsx)
  const handleExportDateExcel = (dateGroup) => {
    if (!dateGroup || !dateGroup.items || dateGroup.items.length === 0) {
      showToast('No items to export for this date', 'error');
      return;
    }

    const rows = dateGroup.items.map((it, idx) => ({
      '#': idx + 1,
      'Receipt Date': it.dateKey,
      'Time Received': it.timeStr,
      'Part Number': it.part_number,
      'Description': it.description,
      'Category': it.category,
      'Serial Number': it.serial_number,
      'Assignment / Destination': it.intake_assignment || 'MDC - Forecasting',
      'Stocking Value ($)': it.price,
      'Linked PO': it.po_number || it.po_id || 'Direct Intake',
      'Intake Source': it.intake_source || 'Barcode Scan',
      'Status': 'IN STOCK'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Stock_${dateGroup.dateKey}`);
    XLSX.writeFile(wb, `DC_Stock_Receipts_${dateGroup.dateKey}.xlsx`);
    showToast(`Downloaded Excel manifest for ${dateGroup.dateLabel}`, 'success');
  };

  // Export All In-Stock Inventory to Excel (.xlsx)
  const handleExportAllStockExcel = () => {
    if (enrichedStockUnits.length === 0) {
      showToast('No in-stock parts in warehouse to export', 'error');
      return;
    }

    const rows = enrichedStockUnits.map((it, idx) => ({
      '#': idx + 1,
      'Receipt Date': it.dateKey,
      'Time Received': it.timeStr,
      'Part Number': it.part_number,
      'Description': it.description,
      'Category': it.category,
      'Serial Number': it.serial_number,
      'Assignment / Destination': it.intake_assignment || 'MDC - Forecasting',
      'Stocking Value ($)': it.price,
      'Linked PO': it.po_number || it.po_id || 'Direct Intake',
      'Intake Source': it.intake_source || 'Barcode Scan',
      'Status': 'IN STOCK'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DC In-Stock Inventory');
    XLSX.writeFile(wb, `DC_Complete_Stock_Inventory_${todayDateStr}.xlsx`);
    showToast(`Downloaded complete stock manifest (${enrichedStockUnits.length} units)`, 'success');
  };

  // Print Date Group Slip
  const handlePrintDateSlip = (dateGroup) => {
    if (!dateGroup || !dateGroup.items) return;
    const printWindow = window.open('', '_blank', 'width=850,height=900');
    if (!printWindow) {
      showToast('Please allow popups to print slip', 'warning');
      return;
    }

    const itemsHtml = dateGroup.items.map((it, idx) => `
      <tr>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${idx + 1}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-weight: bold;">${it.part_number}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e2e8f0;">${it.description}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${it.serial_number}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e2e8f0;">${it.intake_assignment || 'MDC - Forecasting'}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">${it.timeStr}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>DC Stock Receipts - ${dateGroup.dateKey}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #0f172a; }
            .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
            .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 20px; background: #f8fafc; padding: 14px; border-radius: 6px; }
            table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
            th { background: #f1f5f9; padding: 8px 10px; border-bottom: 2px solid #cbd5e1; text-transform: uppercase; font-size: 11px; }
            .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h2 style="margin: 0 0 4px 0;">MOBILE CARE SERVICES PHILS. INC.</h2>
              <p style="margin: 0; color: #475569; font-size: 13px;">Distribution Center Daily Stock Receiving Slip</p>
            </div>
            <div style="text-align: right;">
              <h3 style="margin: 0; color: #0284c7;">${dateGroup.dateLabel}</h3>
              <p style="margin: 2px 0 0 0; font-size: 12px; color: #64748b;">Total Parts: ${dateGroup.count} units</p>
            </div>
          </div>

          <div class="meta-grid">
            <div><strong>Receipt Date:</strong><br>${dateGroup.dateKey}</div>
            <div><strong>Breakdown:</strong><br>${dateGroup.forecastingCount} Forecasting • ${dateGroup.crbrCount} CRBR • ${dateGroup.displaysCount} Displays • ${dateGroup.batteriesCount} Batteries</div>
            <div><strong>Total Stock Valuation:</strong><br><span style="font-size: 15px; font-weight: bold; color: #0284c7;">$${dateGroup.valuation.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
          </div>

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Part Number</th>
                <th>Description</th>
                <th>Serial Number</th>
                <th>Destination</th>
                <th>Time Received</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="footer">
            <div>Verified In-Stock by: _______________________</div>
            <div>Warehouse Supervisor: _______________________</div>
          </div>

          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Open Save Batch Modal with custom initial units (e.g. for a specific date group)
  const handleOpenSaveBatchForDate = (dateGroup) => {
    setModalInitialUnits(dateGroup.items || []);
    setIsSaveModalOpen(true);
  };

  // Delete Individual Stock Unit Handler
  const handleConfirmDeleteUnit = async () => {
    if (!unitToDelete) return;
    if (deleteScanInUnit) {
      await deleteScanInUnit(unitToDelete.id || unitToDelete.serial_number);
    }
    setUnitToDelete(null);
  };

  // Delete Batch Record Handler
  const handleConfirmDeleteBatch = async () => {
    if (!recordToDelete) return;
    await deleteIntakeRecord(recordToDelete.id);
    setRecordToDelete(null);
    if (selectedRecordToInspect?.id === recordToDelete.id) {
      setSelectedRecordToInspect(null);
    }
  };

  // Batch inspector search
  const filteredInspectItems = useMemo(() => {
    if (!selectedRecordToInspect || !selectedRecordToInspect.items) return [];
    if (!inspectSearch.trim()) return selectedRecordToInspect.items;
    const q = inspectSearch.toLowerCase().trim();
    return selectedRecordToInspect.items.filter(
      it =>
        it.part_number?.toLowerCase().includes(q) ||
        it.serial_number?.toLowerCase().includes(q) ||
        it.description?.toLowerCase().includes(q) ||
        it.intake_assignment?.toLowerCase().includes(q) ||
        it.notes?.toLowerCase().includes(q)
    );
  }, [selectedRecordToInspect, inspectSearch]);

  return (
    <div className="intake-records-container">
      {/* Top Hero Banner */}
      <div className="scanner-hero" style={{ marginBottom: '24px' }}>
        <div className="scanner-hero-header" style={{ marginBottom: '12px' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '22px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <BookmarkPlus size={24} color="#38bdf8" />
              <span>DC Stock Intake Records & Manifests</span>
            </h2>
            <span
              className="badge"
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                fontSize: '11px',
                marginTop: '4px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {isAutoRefreshing ? (
                <>
                  <RefreshCw size={11} className="spin" />
                  <span>Syncing with Cloud...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={11} />
                  <span>Live Realtime Synced</span>
                </>
              )}
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>
            Live Stock Parts Tracking • Destination Tracking (<code>MDC - Forecasting</code> vs <code>DC - CRBR</code>)
            {lastSyncedAt && <span style={{ marginLeft: '8px', opacity: 0.8 }}>• Verified: {new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (autoRefreshData) autoRefreshData({ force: true, silent: false, reason: 'IntakeRecords manual sync' });
              if (processOfflineSyncQueue) processOfflineSyncQueue();
            }}
            disabled={isAutoRefreshing}
            title="Force reload latest inventory & intake records from database"
            style={{
              background: '#1e293b',
              color: '#38bdf8',
              borderColor: '#38bdf8',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '36px'
            }}
          >
            <RefreshCw size={14} className={isAutoRefreshing ? 'spin' : ''} />
            <span>{isAutoRefreshing ? 'Syncing...' : 'Sync Cloud DB'}</span>
          </button>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setActiveTab('scan-in')}
            style={{
              background: '#1e293b',
              color: '#38bdf8',
              borderColor: '#38bdf8',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '36px'
            }}
          >
            <Barcode size={16} />
            <span>Scan-In Station (F1)</span>
          </button>

          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setModalInitialUnits(todayScannedUnits.length > 0 ? todayScannedUnits : enrichedStockUnits.slice(0, 50));
              setIsSaveModalOpen(true);
            }}
            disabled={enrichedStockUnits.length === 0}
            style={{
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600
            }}
            title={enrichedStockUnits.length > 0 ? "Save stock units into a permanent intake batch record" : "Scan parts first in Receive Scan-In"}
          >
            <Plus size={16} />
            <span>Save Intake Batch ({todayScannedUnits.length > 0 ? todayScannedUnits.length : enrichedStockUnits.length})</span>
          </button>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #0284c7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12.5px', color: '#0369a1', fontWeight: 600 }}>Total DC In-Stock Parts</span>
            <Boxes size={18} color="#0284c7" />
          </div>
          <h3 style={{ fontSize: '24px', margin: '6px 0 2px 0', fontWeight: 700, color: '#0369a1' }}>
            {totalStockUnitsCount} <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)' }}>units</span>
          </h3>
          <span style={{ fontSize: '11.5px', color: 'var(--text-subtle)' }}>
            Across {availableStockDates.length} receipt date(s)
          </span>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12.5px', color: '#047857', fontWeight: 600 }}>Total Stock Valuation</span>
            <DollarSign size={18} color="#10b981" />
          </div>
          <h3 style={{ fontSize: '22px', margin: '6px 0 2px 0', fontWeight: 700, color: '#047857' }}>
            ${totalStockValuation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h3>
          <span style={{ fontSize: '11.5px', color: 'var(--text-subtle)' }}>Active warehouse inventory value</span>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12.5px', color: '#6d28d9', fontWeight: 600 }}>Today's Scanned Stock</span>
            <Calendar size={18} color="#8b5cf6" />
          </div>
          <h3 style={{ fontSize: '24px', margin: '6px 0 2px 0', fontWeight: 700, color: '#6d28d9' }}>
            {todayScannedUnits.length} <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)' }}>units</span>
          </h3>
          <span style={{ fontSize: '11.5px', color: 'var(--text-subtle)' }}>Received on {todayDateStr}</span>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #f59e0b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12.5px', color: '#b45309', fontWeight: 600 }}>Saved Batch Records</span>
            <BookmarkPlus size={18} color="#f59e0b" />
          </div>
          <h3 style={{ fontSize: '24px', margin: '6px 0 2px 0', fontWeight: 700, color: '#b45309' }}>
            {totalBatchesCount} <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)' }}>batches</span>
          </h3>
          <span style={{ fontSize: '11.5px', color: 'var(--text-subtle)' }}>
            {totalUnitsAcrossBatches} units permanently archived
          </span>
        </div>
      </div>

      {/* Main Container Card with View Switcher */}
      <div className="card" style={{ padding: '24px' }}>
        {/* Navigation View Switcher Tabs */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '16px',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '14px'
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`btn btn-sm ${activeView === 'stock_by_date' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveView('stock_by_date')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                fontWeight: 600,
                fontSize: '13px',
                borderRadius: '8px'
              }}
            >
              <Package size={16} />
              <span>All Stock Parts (By Receipt Date)</span>
              <span
                style={{
                  background: activeView === 'stock_by_date' ? 'rgba(255,255,255,0.25)' : 'var(--bg-hover)',
                  color: activeView === 'stock_by_date' ? '#fff' : 'var(--text-muted)',
                  borderRadius: '12px',
                  padding: '1px 8px',
                  fontSize: '11.5px'
                }}
              >
                {totalStockUnitsCount}
              </span>
            </button>

            <button
              className={`btn btn-sm ${activeView === 'batch_records' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveView('batch_records')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                fontWeight: 600,
                fontSize: '13px',
                borderRadius: '8px'
              }}
            >
              <BookmarkPlus size={16} />
              <span>DC Intake Batch Records</span>
              <span
                style={{
                  background: activeView === 'batch_records' ? 'rgba(255,255,255,0.25)' : 'var(--bg-hover)',
                  color: activeView === 'batch_records' ? '#fff' : 'var(--text-muted)',
                  borderRadius: '12px',
                  padding: '1px 8px',
                  fontSize: '11.5px'
                }}
              >
                {totalBatchesCount}
              </span>
            </button>
          </div>

          {/* Quick Actions (Export / Global Refresh) */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {activeView === 'stock_by_date' && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleExportAllStockExcel}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                title="Export complete warehouse inventory to Excel (.xlsx)"
              >
                <FileSpreadsheet size={14} color="#16a34a" />
                <span>Export All Stock (.xlsx)</span>
              </button>
            )}
          </div>
        </div>

        {/* Global Filters & Search Controls */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px',
          background: '#f8fafc',
          padding: '12px 16px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
            {/* Search Input */}
            <div style={{ position: 'relative', width: '260px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder={activeView === 'stock_by_date' ? "Search P/N, S/N, destination..." : "Search batch ID, P/N, S/N..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '32px', height: '34px', fontSize: '12.5px', width: '100%', background: '#fff' }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Destination / Assignment Filter */}
            {activeView === 'stock_by_date' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Layers size={14} color="var(--text-muted)" />
                <select
                  className="form-select"
                  style={{ width: 'auto', height: '34px', fontSize: '12.5px', background: '#fff' }}
                  value={assignmentFilter}
                  onChange={(e) => setAssignmentFilter(e.target.value)}
                >
                  <option value="ALL">All Destinations</option>
                  <option value="MDC - Forecasting">MDC - Forecasting Only</option>
                  <option value="DC - CRBR">DC - CRBR Only</option>
                </select>
              </div>
            )}

            {/* Date Filter (for stock view) */}
            {activeView === 'stock_by_date' && availableStockDates.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Calendar size={14} color="var(--text-muted)" />
                <select
                  className="form-select"
                  style={{ width: 'auto', height: '34px', fontSize: '12.5px', background: '#fff' }}
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                >
                  <option value="ALL">All Receipt Dates ({availableStockDates.length})</option>
                  {availableStockDates.map(d => (
                    <option key={d} value={d}>{d === todayDateStr ? `Today (${d})` : d}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Category Filter (for stock view) */}
            {activeView === 'stock_by_date' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Filter size={14} color="var(--text-muted)" />
                <select
                  className="form-select"
                  style={{ width: 'auto', height: '34px', fontSize: '12.5px', background: '#fff' }}
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="ALL">All Categories</option>
                  <option value="Display">Displays Only</option>
                  <option value="Battery">Batteries Only</option>
                  <option value="Camera">Cameras Only</option>
                  <option value="Back Glass">Back Glass Only</option>
                  <option value="Other Parts">Other Parts</option>
                </select>
              </div>
            )}

            {/* Year Filter (for batch records view) */}
            {activeView === 'batch_records' && availableBatchYears.length > 0 && (
              <select
                className="form-select"
                style={{ width: 'auto', height: '34px', fontSize: '12.5px', background: '#fff' }}
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
              >
                <option value="ALL">All Years</option>
                {availableBatchYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
          </div>

          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
            {activeView === 'stock_by_date' ? (
              <span>Showing <strong>{filteredStockUnits.length}</strong> of {totalStockUnitsCount} stock parts</span>
            ) : (
              <span>Showing <strong>{filteredBatchRecords.length}</strong> of {totalBatchesCount} saved batches</span>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            VIEW 1: ALL DC STOCK PARTS (GROUPED BY RECEIPT DATE)
        ═══════════════════════════════════════════════════════════════════════ */}
        {activeView === 'stock_by_date' && (
          <div>
            {stockByDateGroups.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
                <Boxes size={40} color="var(--border-strong)" style={{ marginBottom: '12px' }} />
                <h4 style={{ fontSize: '16px', color: 'var(--text-main)', marginBottom: '4px' }}>No Stock Parts Found</h4>
                <p style={{ fontSize: '13px', maxWidth: '440px', margin: '0 auto 16px auto' }}>
                  {searchQuery || categoryFilter !== 'ALL' || dateFilter !== 'ALL' || assignmentFilter !== 'ALL'
                    ? 'No stock parts match your active filters. Try clearing your search or filters.'
                    : 'No serialized parts currently in warehouse stock. Scan parts in Receive Scan-In (F1) to receive inventory.'}
                </p>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setActiveTab('scan-in')}
                >
                  <Barcode size={14} />
                  <span>Go to Receive Scan-In (F1)</span>
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {stockByDateGroups.map(group => {
                  const isCollapsed = !!collapsedDates[group.dateKey];
                  const isToday = group.dateKey === todayDateStr;

                  return (
                    <div
                      key={group.dateKey}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        background: '#fff'
                      }}
                    >
                      {/* Date Section Header Bar */}
                      <div
                        style={{
                          background: isToday ? '#f0f9ff' : '#f8fafc',
                          borderBottom: isCollapsed ? 'none' : '1px solid #e2e8f0',
                          padding: '12px 18px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '12px'
                        }}
                      >
                        {/* Title & Date Metadata */}
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                          onClick={() => toggleDateCollapse(group.dateKey)}
                        >
                          <button
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '2px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                          </button>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <div style={{
                              background: isToday ? '#0284c7' : '#475569',
                              color: '#fff',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                              fontSize: '12px',
                              fontWeight: 600
                            }}>
                              <Calendar size={13} />
                              <span>{group.dateKey}</span>
                            </div>

                            <h4 style={{ margin: 0, fontSize: '15px', color: '#0f172a', fontWeight: 600 }}>
                              {group.dateLabel}
                            </h4>

                            {isToday && (
                              <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '11px' }}>
                                Today's Receiving Session
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Subtotals & Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                          {/* Unit Counts Badge */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, color: '#0f172a' }}>{group.count} parts</span>
                            <span style={{ color: 'var(--text-subtle)' }}>•</span>
                            <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11px', padding: '2px 6px' }}>
                              {group.forecastingCount} Forecasting
                            </span>
                            {group.crbrCount > 0 && (
                              <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', padding: '2px 6px' }}>
                                {group.crbrCount} CRBR
                              </span>
                            )}
                            <span style={{ color: 'var(--text-subtle)' }}>•</span>
                            <span style={{ color: '#0369a1', fontWeight: 600 }}>{group.displaysCount} Displays</span>
                            <span style={{ color: 'var(--text-subtle)' }}>•</span>
                            <span style={{ color: '#047857', fontWeight: 600 }}>{group.batteriesCount} Batteries</span>
                            <span style={{ color: 'var(--text-subtle)' }}>•</span>
                            <span style={{ fontWeight: 700, color: '#047857' }}>
                              ${group.valuation.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </div>

                          {/* Action Buttons for this Date Group */}
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleExportDateExcel(group)}
                              style={{ padding: '3px 8px', fontSize: '11.5px', height: '28px' }}
                              title={`Export ${group.dateKey} manifest to Excel`}
                            >
                              <FileSpreadsheet size={13} color="#16a34a" />
                              <span>Export Excel</span>
                            </button>

                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handlePrintDateSlip(group)}
                              style={{ padding: '3px 8px', fontSize: '11.5px', height: '28px' }}
                              title={`Print ${group.dateKey} stock slip`}
                            >
                              <Printer size={13} color="#0284c7" />
                              <span>Print Slip</span>
                            </button>

                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleOpenSaveBatchForDate(group)}
                              style={{ padding: '3px 10px', fontSize: '11.5px', height: '28px', fontWeight: 600 }}
                              title="Save this date's parts into a permanent intake batch record"
                            >
                              <BookmarkPlus size={13} />
                              <span>Save as Batch</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Date Table of Stock Units */}
                      {!isCollapsed && (
                        <div className="table-container" style={{ margin: 0 }}>
                          <table className="data-table" style={{ fontSize: '12.5px' }}>
                            <thead>
                              <tr>
                                <th style={{ width: '45px' }}>#</th>
                                <th>Part Number</th>
                                <th>Description / Model</th>
                                <th>Serial Number</th>
                                <th>Assignment / Destination</th>
                                <th>Category</th>
                                <th>Time Received</th>
                                <th>Linked PO / Source</th>
                                <th>Stock Valuation</th>
                                <th>Status</th>
                                <th style={{ textAlign: 'right', width: '80px' }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.items.map((u, idx) => (
                                <tr key={u.id || `${u.serial_number}-${idx}`}>
                                  <td className="font-mono" style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                                  <td className="font-mono">
                                    <span style={{ fontWeight: 700, color: '#0f172a' }}>{u.part_number}</span>
                                  </td>
                                  <td>
                                    <strong>{u.description}</strong>
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span
                                        className="badge font-mono"
                                        style={{
                                          background: '#f1f5f9',
                                          color: '#0f172a',
                                          border: '1px solid #cbd5e1',
                                          fontWeight: 600,
                                          fontSize: '11.5px'
                                        }}
                                      >
                                        {u.serial_number}
                                      </span>
                                      <button
                                        onClick={() => handleCopySerial(u.serial_number)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)' }}
                                        title="Copy serial number"
                                      >
                                        {copiedSerial === u.serial_number ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                                      </button>
                                    </div>
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextDest = u.isCrbr ? 'MDC - Forecasting' : 'DC - CRBR';
                                        if (updateUnitAssignment) updateUnitAssignment(u.serial_number, nextDest);
                                      }}
                                      className="badge"
                                      style={{
                                        background: u.isCrbr ? '#fef3c7' : '#e0f2fe',
                                        color: u.isCrbr ? '#92400e' : '#0369a1',
                                        border: u.isCrbr ? '1px solid #fde68a' : '1px solid #bae6fd',
                                        fontWeight: 700,
                                        fontSize: '11px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        cursor: 'pointer',
                                        padding: '3px 8px',
                                        borderRadius: '4px'
                                      }}
                                      title={`Click to switch assignment to ${u.isCrbr ? 'MDC - Forecasting' : 'DC - CRBR'}`}
                                    >
                                      {u.isCrbr ? <Tag size={10} /> : <Layers size={10} />}
                                      <span>{u.isCrbr ? 'DC - CRBR' : 'MDC - Forecasting'}</span>
                                    </button>
                                  </td>
                                  <td>
                                    <span
                                      className="badge"
                                      style={{
                                        background: u.category === 'Display' ? '#eff6ff' : u.category === 'Battery' ? '#f0fdf4' : '#faf5ff',
                                        color: u.category === 'Display' ? '#1e40af' : u.category === 'Battery' ? '#166534' : '#6b21a8',
                                        border: `1px solid ${u.category === 'Display' ? '#bfdbfe' : u.category === 'Battery' ? '#bbf7d0' : '#e9d5ff'}`,
                                        fontSize: '11px',
                                        fontWeight: 600
                                      }}
                                    >
                                      {u.category}
                                    </span>
                                  </td>
                                  <td style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                                    {u.timeStr}
                                  </td>
                                  <td style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                                    {u.po_number || u.po_id || u.intake_source || 'Direct Barcode Intake'}
                                  </td>
                                  <td style={{ fontWeight: 600, color: '#047857' }}>
                                    ${Number(u.price || 0).toFixed(2)}
                                  </td>
                                  <td>
                                    <span className="badge badge-success" style={{ fontSize: '11px' }}>
                                      IN STOCK
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <button
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => setUnitToDelete(u)}
                                      style={{ padding: '3px 6px', color: '#ef4444', borderColor: '#fca5a5' }}
                                      title="Delete serialized part from warehouse stock"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            VIEW 2: DC INTAKE BATCH RECORDS (PERMANENT SAVED MANIFESTS)
        ═══════════════════════════════════════════════════════════════════════ */}
        {activeView === 'batch_records' && (
          <div>
            {filteredBatchRecords.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
                <BookmarkPlus size={40} color="var(--border-strong)" style={{ marginBottom: '12px' }} />
                <h4 style={{ fontSize: '16px', color: 'var(--text-main)', marginBottom: '4px' }}>No Intake Batch Records Found</h4>
                <p style={{ fontSize: '13px', maxWidth: '440px', margin: '0 auto 16px auto' }}>
                  {searchQuery
                    ? `No batch records matching "${searchQuery}". Try clearing search.`
                    : 'Save currently scanned stock parts into permanent intake batch records (MDC[YYYY][00000]) for auditing.'}
                </p>
                {enrichedStockUnits.length > 0 && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setModalInitialUnits(todayScannedUnits.length > 0 ? todayScannedUnits : enrichedStockUnits.slice(0, 50));
                      setIsSaveModalOpen(true);
                    }}
                  >
                    <Plus size={14} />
                    <span>Save New Intake Batch ({todayScannedUnits.length > 0 ? todayScannedUnits.length : enrichedStockUnits.length} units)</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="table-container" style={{ maxHeight: '560px', overflowY: 'auto' }}>
                <table className="data-table" style={{ fontSize: '12.5px' }}>
                  <thead>
                    <tr>
                      <th>Batch ID</th>
                      <th>Batch Name / Manifest</th>
                      <th>Intake Date</th>
                      <th>Total Units</th>
                      <th>Recorded By</th>
                      <th>Linked PO</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBatchRecords.map(rec => (
                      <tr key={rec.id}>
                        <td className="font-mono">
                          <strong style={{ color: '#0284c7' }}>{rec.id}</strong>
                        </td>
                        <td>
                          <strong>{rec.record_name || 'DC Intake Batch'}</strong>
                          {rec.notes && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{rec.notes}</div>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Calendar size={13} color="var(--text-muted)" />
                            <span>{rec.intake_date || 'Recent'}</span>
                          </div>
                        </td>
                        <td>
                          <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 700 }}>
                            {rec.total_units || (rec.items ? rec.items.length : 0)} units
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <User size={13} color="var(--text-muted)" />
                            <span>{rec.saved_by_name || 'Warehouse Staff'}</span>
                          </div>
                        </td>
                        <td>{rec.po_number || 'Direct Intake'}</td>
                        <td>
                          <span className="badge badge-success">Archived</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setSelectedRecordToInspect(rec)}
                              style={{ padding: '3px 8px', fontSize: '11.5px' }}
                              title="Inspect serialized parts manifest in this batch"
                            >
                              <Eye size={13} color="#0284c7" />
                              <span>Inspect</span>
                            </button>

                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setRecordToDelete(rec)}
                              style={{ padding: '3px 6px', color: '#ef4444', borderColor: '#fca5a5' }}
                              title="Delete intake batch record"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- Batch Manifest Inspector Modal --- */}
      {selectedRecordToInspect && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setSelectedRecordToInspect(null); }}>
          <div className="modal-content" style={{ maxWidth: '850px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: 'rgba(56, 189, 248, 0.15)', padding: '8px', borderRadius: '8px' }}>
                  <BookmarkPlus size={22} color="#38bdf8" />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '17px', margin: 0 }}>
                    Batch Manifest Inspector: {selectedRecordToInspect.id}
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    {selectedRecordToInspect.record_name} • {selectedRecordToInspect.intake_date} • {selectedRecordToInspect.saved_by_name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedRecordToInspect(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {/* Filter bar inside modal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div style={{ position: 'relative', width: '280px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search serial or part number..."
                    value={inspectSearch}
                    onChange={(e) => setInspectSearch(e.target.value)}
                    className="form-input"
                    style={{ paddingLeft: '32px', height: '32px', fontSize: '12px', width: '100%' }}
                  />
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Total: <strong>{selectedRecordToInspect.items?.length || 0} serialized units</strong>
                </div>
              </div>

              {/* Items Table */}
              <div className="table-container" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                <table className="data-table" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Part Number</th>
                      <th>Description</th>
                      <th>Serial Number</th>
                      <th>Destination</th>
                      <th>Time Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInspectItems.map((it, idx) => {
                      const isCrbr = it.intake_assignment?.includes('CRBR') || it.notes?.includes('CRBR');
                      return (
                        <tr key={it.id || idx}>
                          <td className="font-mono">{idx + 1}</td>
                          <td className="font-mono"><strong>{it.part_number}</strong></td>
                          <td>{it.description}</td>
                          <td className="font-mono">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{it.serial_number}</span>
                              <button
                                onClick={() => handleCopySerial(it.serial_number)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)' }}
                              >
                                {copiedSerial === it.serial_number ? <Check size={11} color="#16a34a" /> : <Copy size={11} />}
                              </button>
                            </div>
                          </td>
                          <td>
                            {isCrbr ? (
                              <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: '10.5px' }}>
                                DC - CRBR
                              </span>
                            ) : (
                              <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '10.5px' }}>
                                MDC - Forecasting
                              </span>
                            )}
                          </td>
                          <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {it.received_at ? new Date(it.received_at).toLocaleTimeString() : 'Recorded'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedRecordToInspect(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Save Intake Record Modal */}
      <SaveIntakeRecordModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        initialUnits={modalInitialUnits}
        onSaved={(newRec) => {
          showToast(`Created Intake Record ${newRec.id}`, 'success');
          setActiveView('batch_records');
        }}
      />

      {/* Delete Unit Confirmation Dialog */}
      {unitToDelete && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setUnitToDelete(null); }}>
          <div className="modal-content" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={20} color="#ef4444" />
                <h3 style={{ color: '#fff', fontSize: '17px', margin: 0 }}>Delete Part from Warehouse Stock?</h3>
              </div>
              <button
                onClick={() => setUnitToDelete(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '13.5px', color: 'var(--text-main)', margin: '0 0 10px 0' }}>
                Are you sure you want to remove unit <strong>#{unitToDelete.part_number}</strong> with Serial <strong>{unitToDelete.serial_number}</strong>?
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                This will delete the item from active DC In-Stock inventory in the database.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setUnitToDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleConfirmDeleteUnit}>Delete Unit</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Batch Confirmation Dialog */}
      {recordToDelete && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setRecordToDelete(null); }}>
          <div className="modal-content" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={20} color="#ef4444" />
                <h3 style={{ color: '#fff', fontSize: '17px', margin: 0 }}>Delete Intake Batch Record?</h3>
              </div>
              <button
                onClick={() => setRecordToDelete(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '13.5px', color: 'var(--text-main)', margin: '0 0 10px 0' }}>
                Are you sure you want to delete batch <strong>{recordToDelete.id}</strong> ({recordToDelete.record_name})?
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRecordToDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleConfirmDeleteBatch}>Delete Batch Record</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
