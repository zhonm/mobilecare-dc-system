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
  Filter
} from 'lucide-react';
import { normalizeInventoryUnits } from '../utils/partResolver';

export default function IntakeRecords() {
  const {
    dcIntakeRecords,
    deleteIntakeRecord,
    inventoryUnits,
    deleteScanInUnit,
    updateUnitAssignment,
    parts,
    setActiveTab,
    isAutoRefreshing,
    lastSyncedAt,
    autoRefreshData,
    showToast,
    processOfflineSyncQueue,
    currentUser,
    canUserDeleteRecord,
    activePackDraft,
    shipments,
    canEdit,
    isReadOnly
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

  // Helper to check if any filter is active
  const isAnyFilterActive = useMemo(() => {
    return (
      Boolean(searchQuery.trim()) ||
      assignmentFilter !== 'ALL' ||
      dateFilter !== 'ALL' ||
      categoryFilter !== 'ALL' ||
      yearFilter !== 'ALL'
    );
  }, [searchQuery, assignmentFilter, dateFilter, categoryFilter, yearFilter]);

  // Helper to clear all search queries and active filter dropdowns
  const handleClearAllFilters = () => {
    setSearchQuery('');
    setAssignmentFilter('ALL');
    setDateFilter('ALL');
    setCategoryFilter('ALL');
    setYearFilter('ALL');
    showToast('All filters cleared', 'info');
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

  // Serials that are currently in an active packing list draft or saved/dispatched shipments
  const packedSerialsSet = useMemo(() => {
    const set = new Set();
    // 1. Serials in active packing draft state
    if (activePackDraft?.items && Array.isArray(activePackDraft.items)) {
      activePackDraft.items.forEach(it => {
        const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
        if (s) set.add(s);
      });
    }
    // Check localStorage fallback for active packing draft
    try {
      const localDraft = JSON.parse(localStorage.getItem('mdc_active_pack_draft') || 'null');
      if (localDraft?.items && Array.isArray(localDraft.items)) {
        localDraft.items.forEach(it => {
          const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
          if (s) set.add(s);
        });
      }
    } catch (e) {}

    // 2. Serials in finalized/saved shipments & packing lists
    (shipments || []).forEach(sh => {
      if (sh.items && Array.isArray(sh.items)) {
        sh.items.forEach(it => {
          const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
          if (s) set.add(s);
        });
      }
    });
    return set;
  }, [activePackDraft, shipments]);

  // Enriched in-stock units with category, pricing, assignment, and normalized receipt date
  // Filters ONLY for live, available in-stock parts currently in DC warehouse (excluding packed/shipped/dispatched parts)
  const enrichedStockUnits = useMemo(() => {
    const rawInStock = (inventoryUnits || []).filter(u => {
      const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
      if (!cleanSerial) return false;
      // Exclude items in active packing draft or shipments
      if (packedSerialsSet.has(cleanSerial)) return false;
      // Exclude items marked with deleted status
      if (u.is_deleted || u.status === 'deleted') return false;
      // Exclude items marked with status packed, shipped, dispatched, or allocated
      if (u.status === 'packed' || u.status === 'shipped' || u.status === 'dispatched' || u.status === 'allocated') return false;
      // Must be in_stock in DC warehouse (strictly exclude PMG retail branch stock)
      const isDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
      return (u.status === 'in_stock' || !u.status) && isDc;
    });

    const normalizedUnits = normalizeInventoryUnits(rawInStock, parts || []);
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

      const rawAssignment = u.intake_assignment || (u.notes?.includes('SVNR') ? 'SVNR - Service Non-Repair' : u.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
      const isSvnr = rawAssignment.includes('SVNR');
      const isCrbr = !isSvnr && rawAssignment.includes('CRBR');
      const assignment = isSvnr ? 'SVNR - Service Non-Repair' : isCrbr ? 'DC - CRBR' : 'MDC - Forecasting';

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
        notes: u.notes && !u.notes.includes('CRBR') && !u.notes.includes('SVNR') && !u.notes.includes('Forecasting') ? `${assignment} | ${u.notes}` : assignment,
        isCrbr,
        isSvnr,
        dateKey,
        timeStr,
        received_at: u.received_at || new Date().toISOString()
      };
    });
  }, [inventoryUnits, packedSerialsSet, partPriceMap, todayDateStr, parts]);

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
      if (assignmentFilter === 'MDC - Forecasting' && (u.isCrbr || u.isSvnr)) {
        return false;
      }
      if (assignmentFilter === 'DC - CRBR' && !u.isCrbr) {
        return false;
      }
      if (assignmentFilter === 'SVNR - Service Non-Repair' && !u.isSvnr) {
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
        const svnrCount = items.filter(i => i.isSvnr).length;
        const forecastingCount = items.length - crbrCount - svnrCount;
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
          svnrCount,
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
            <div><strong>Breakdown:</strong><br>${dateGroup.forecastingCount} Forecasting • ${dateGroup.crbrCount} CRBR${dateGroup.svnrCount > 0 ? ` • ${dateGroup.svnrCount} SVNR` : ''} • ${dateGroup.displaysCount} Displays • ${dateGroup.batteriesCount} Batteries</div>
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
      await deleteScanInUnit(unitToDelete);
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

  // Description lookup map
  const partDescMap = useMemo(() => {
    const map = new Map();
    (parts || []).forEach(p => {
      if (p.part_number && p.description && p.description !== 'Service Replacement Part' && p.description !== 'Apple Genuine Service Part') {
        map.set(p.part_number.toUpperCase(), p.description);
      }
    });
    return map;
  }, [parts]);

  // Model & Category breakdown for Batch Manifest Inspector
  const inspectModelBreakdown = useMemo(() => {
    if (!selectedRecordToInspect || !Array.isArray(selectedRecordToInspect.items)) return [];
    const countsMap = new Map();
    selectedRecordToInspect.items.forEach(it => {
      const pn = String(it.part_number || '').trim().toUpperCase();
      let desc = it.description || partDescMap.get(pn) || '';
      if (!desc || desc === 'Service Replacement Part' || desc === 'Apple Genuine Service Part') {
        desc = pn || 'Unknown Part';
      }
      countsMap.set(desc, (countsMap.get(desc) || 0) + 1);
    });

    return Array.from(countsMap.entries())
      .map(([modelDesc, count]) => ({ modelDesc, count }))
      .sort((a, b) => b.count - a.count || a.modelDesc.localeCompare(b.modelDesc));
  }, [selectedRecordToInspect, partDescMap]);

  // Batch inspector search
  const filteredInspectItems = useMemo(() => {
    if (!selectedRecordToInspect || !selectedRecordToInspect.items) return [];
    if (!inspectSearch.trim()) return selectedRecordToInspect.items;
    const q = inspectSearch.toLowerCase().trim();
    return selectedRecordToInspect.items.filter(it => {
      const pn = String(it.part_number || '').toLowerCase();
      const resolvedDesc = (it.description || partDescMap.get(it.part_number?.toUpperCase()) || '').toLowerCase();
      const sn = String(it.serial_number || '').toLowerCase();
      const assign = String(it.intake_assignment || it.notes || '').toLowerCase();
      return pn.includes(q) || resolvedDesc.includes(q) || sn.includes(q) || assign.includes(q);
    });
  }, [selectedRecordToInspect, inspectSearch, partDescMap]);

  return (
    <div className="intake-records-container">
      {/* Top Hero Banner */}
      <div className="scanner-hero" style={{ marginBottom: '24px' }}>
        <div className="scanner-hero-header" style={{ marginBottom: '12px' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '22px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <BookmarkPlus size={24} color="#38bdf8" />
              <span>DC Parts Stock Records</span>
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

          {canEdit && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setActiveTab('scan-in')}
              style={{
                background: '#0284c7',
                color: '#ffffff',
                borderColor: '#0284c7',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                height: '36px',
                padding: '0 14px',
                borderRadius: '6px',
                boxShadow: '0 1px 3px rgba(2,132,199,0.3)'
              }}
              title="Return to Receive Scan-In Station"
            >
              <Barcode size={16} />
              <span>← Back to Receive Scan-In (F1)</span>
            </button>
          )}

          {canEdit && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setModalInitialUnits(todayScannedUnits.length > 0 ? todayScannedUnits : enrichedStockUnits);
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
              title={enrichedStockUnits.length > 0 ? "Save stock units into a permanent dispatched batch record" : "Scan parts first in Receive Scan-In"}
            >
              <Plus size={16} />
              <span>Save Dispatched Batch ({todayScannedUnits.length > 0 ? todayScannedUnits.length : enrichedStockUnits.length})</span>
            </button>
          )}

          {isReadOnly && (
            <span
              className="badge"
              style={{
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                fontSize: '12px',
                padding: '6px 12px',
                fontWeight: 600
              }}
            >
              View &amp; Export Mode
            </span>
          )}
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
            <span style={{ fontSize: '12.5px', color: '#b45309', fontWeight: 600 }}>Dispatched Records (All Sites)</span>
            <BookmarkPlus size={18} color="#f59e0b" />
          </div>
          <h3 style={{ fontSize: '24px', margin: '6px 0 2px 0', fontWeight: 700, color: '#b45309' }}>
            {totalBatchesCount} <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)' }}>batches</span>
          </h3>
          <span style={{ fontSize: '11.5px', color: 'var(--text-subtle)' }}>
            {totalUnitsAcrossBatches} units dispatched to all sites
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
              <span>Dispatched Already in All Sites</span>
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
                  <option value="SVNR - Service Non-Repair">SVNR - Service Non-Repair Only</option>
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

            {/* Clear All Filters Button */}
            {isAnyFilterActive && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleClearAllFilters}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  color: '#ef4444',
                  borderColor: '#fca5a5',
                  background: '#fff',
                  fontWeight: 600,
                  height: '34px',
                  fontSize: '12px'
                }}
                title="Clear search and reset all active filter dropdowns"
              >
                <X size={14} />
                <span>Clear Filters</span>
              </button>
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
                {packedSerialsSet.size > 0 && totalStockUnitsCount === 0 && !searchQuery && categoryFilter === 'ALL' && dateFilter === 'ALL' && assignmentFilter === 'ALL' ? (
                  <>
                    <div style={{ width: '56px', height: '56px', background: '#dcfce7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto', color: '#16a34a' }}>
                      <CheckCircle2 size={32} />
                    </div>
                    <h4 style={{ fontSize: '17px', color: 'var(--text-main)', fontWeight: 700, marginBottom: '6px' }}>All DC Stock Parts Packed & Ready for Dispatch</h4>
                    <p style={{ fontSize: '13px', maxWidth: '520px', margin: '0 auto 20px auto', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                      All received parts have been packed into Outbound Packing Lists and marked for branch dispatch. Their permanent historical batch records and manifests remain permanently recorded in the <strong>Dispatched Already in All Sites</strong> tab.
                    </p>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setActiveView('batch_records')}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <BookmarkPlus size={15} />
                        <span>View Dispatched Records ({totalBatchesCount})</span>
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setActiveTab('scan-out')}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <Package size={15} />
                        <span>Open Packing Lists (F2)</span>
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setActiveTab('scan-in')}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <Barcode size={15} />
                        <span>Scan New Stock (F1)</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <Boxes size={40} color="var(--border-strong)" style={{ marginBottom: '12px' }} />
                    <h4 style={{ fontSize: '16px', color: 'var(--text-main)', marginBottom: '4px' }}>No Stock Parts Found</h4>
                    <p style={{ fontSize: '13px', maxWidth: '440px', margin: '0 auto 16px auto' }}>
                      {isAnyFilterActive
                        ? 'No stock parts match your active filters. Click Clear Filters below to view all stock.'
                        : 'No serialized parts currently in warehouse stock. Scan parts in Receive Scan-In (F1) to receive inventory.'}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      {isAnyFilterActive && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={handleClearAllFilters}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: '#ef4444',
                            borderColor: '#fca5a5',
                            background: '#fff',
                            fontWeight: 600
                          }}
                        >
                          <X size={14} />
                          <span>Clear Filters ({totalStockUnitsCount} available)</span>
                        </button>
                      )}
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setActiveTab('scan-in')}
                      >
                        <Barcode size={14} />
                        <span>Go to Receive Scan-In (F1)</span>
                      </button>
                    </div>
                  </>
                )}
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
                            {group.svnrCount > 0 && (
                              <span className="badge" style={{ background: '#f3e8ff', color: '#7e22ce', fontSize: '11px', padding: '2px 6px' }}>
                                {group.svnrCount} SVNR
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
                                        let nextDest = 'MDC - Forecasting';
                                        if (u.isSvnr) {
                                          nextDest = 'MDC - Forecasting';
                                        } else if (u.isCrbr) {
                                          nextDest = 'SVNR - Service Non-Repair';
                                        } else {
                                          nextDest = 'DC - CRBR';
                                        }
                                        if (updateUnitAssignment) updateUnitAssignment(u.serial_number, nextDest);
                                      }}
                                      className="badge"
                                      style={{
                                        background: u.isSvnr ? '#f3e8ff' : u.isCrbr ? '#fef3c7' : '#e0f2fe',
                                        color: u.isSvnr ? '#7e22ce' : u.isCrbr ? '#92400e' : '#0369a1',
                                        border: u.isSvnr ? '1px solid #e9d5ff' : u.isCrbr ? '1px solid #fde68a' : '1px solid #bae6fd',
                                        fontWeight: 700,
                                        fontSize: '11px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        cursor: 'pointer',
                                        padding: '3px 8px',
                                        borderRadius: '4px'
                                      }}
                                      title={`Click to switch assignment to ${u.isSvnr ? 'MDC - Forecasting' : u.isCrbr ? 'SVNR - Service Non-Repair' : 'DC - CRBR'}`}
                                    >
                                      {u.isSvnr ? <Layers size={10} color="#7e22ce" /> : u.isCrbr ? <Tag size={10} /> : <Layers size={10} />}
                                      <span>{u.isSvnr ? 'SVNR - Service Non-Repair' : u.isCrbr ? 'DC - CRBR' : 'MDC - Forecasting'}</span>
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
                                    {canUserDeleteRecord(u, currentUser) ? (
                                      <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setUnitToDelete(u)}
                                        style={{ padding: '3px 6px', color: '#ef4444', borderColor: '#fca5a5' }}
                                        title="Delete serialized part from warehouse stock"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    ) : (
                                      <button
                                        className="btn btn-secondary btn-sm"
                                        disabled
                                        style={{ padding: '3px 6px', opacity: 0.4, cursor: 'not-allowed', color: '#94a3b8' }}
                                        title={`Only ${u.received_by_name || u.received_by || u.saved_by_name || 'the user who received this part'} can delete it`}
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
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
            VIEW 2: DISPATCHED ALREADY IN ALL SITES (PERMANENT PO RECORDS)
        ═══════════════════════════════════════════════════════════════════════ */}
        {activeView === 'batch_records' && (
          <div>
            {filteredBatchRecords.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
                <BookmarkPlus size={40} color="var(--border-strong)" style={{ marginBottom: '12px' }} />
                <h4 style={{ fontSize: '16px', color: 'var(--text-main)', marginBottom: '4px' }}>No Dispatched Records Found</h4>
                <p style={{ fontSize: '13px', maxWidth: '440px', margin: '0 auto 16px auto' }}>
                  {isAnyFilterActive
                    ? `No batch records matching your active filters. Click Clear Filters below to reset.`
                    : 'Save currently scanned stock parts into permanent dispatched batch records based on purchase orders (MDC[YYYY][00000]) for auditing.'}
                </p>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {isAnyFilterActive && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleClearAllFilters}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: '#ef4444',
                        borderColor: '#fca5a5',
                        background: '#fff',
                        fontWeight: 600
                      }}
                    >
                      <X size={14} />
                      <span>Clear Filters ({totalBatchesCount} available)</span>
                    </button>
                  )}
                  {enrichedStockUnits.length > 0 && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setModalInitialUnits(todayScannedUnits.length > 0 ? todayScannedUnits : enrichedStockUnits);
                        setIsSaveModalOpen(true);
                      }}
                    >
                      <Plus size={14} />
                      <span>Save New Dispatched Batch ({todayScannedUnits.length > 0 ? todayScannedUnits.length : enrichedStockUnits.length} units)</span>
                    </button>
                  )}
                </div>
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
                          <strong>{rec.record_name || 'Dispatched Batch'}</strong>
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
                          <span className="badge badge-success">Dispatched</span>
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

                            {canUserDeleteRecord(rec, currentUser) ? (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setRecordToDelete(rec)}
                                style={{ padding: '3px 6px', color: '#ef4444', borderColor: '#fca5a5' }}
                                title="Delete dispatched batch record"
                              >
                                <Trash2 size={13} />
                              </button>
                            ) : (
                              <button
                                className="btn btn-secondary btn-sm"
                                disabled
                                style={{ padding: '3px 6px', opacity: 0.4, cursor: 'not-allowed', color: '#94a3b8' }}
                                title={`Only ${rec.saved_by_name || 'the creator'} has permission to delete this batch record`}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
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
              {/* Scanned Units in Batch Breakdown */}
              {inspectModelBreakdown.length > 0 && (
                <div style={{
                  background: 'var(--bg-card, #ffffff)',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  marginBottom: '16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', fontWeight: 600, color: 'var(--text-main, #0f172a)' }}>
                      <Package size={17} color="#0284c7" />
                      <span>Scanned Units in Batch</span>
                    </div>
                    <span
                      style={{
                        background: '#dcfce7',
                        color: '#15803d',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: '9999px',
                        letterSpacing: '0.3px'
                      }}
                    >
                      {selectedRecordToInspect.items?.length || 0} TOTAL UNITS
                    </span>
                  </div>

                  {/* Model pills */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {inspectModelBreakdown.map((b, bIdx) => {
                      const isSelected = inspectSearch.trim().toLowerCase() === b.modelDesc.toLowerCase();
                      return (
                        <button
                          key={bIdx}
                          type="button"
                          onClick={() => setInspectSearch(prev => prev.toLowerCase() === b.modelDesc.toLowerCase() ? '' : b.modelDesc)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: isSelected ? '#0284c7' : 'var(--bg-main, #f8fafc)',
                            color: isSelected ? '#ffffff' : 'var(--text-main, #334155)',
                            border: `1px solid ${isSelected ? '#0284c7' : 'var(--border-color, #e2e8f0)'}`,
                            borderRadius: '9999px',
                            padding: '4px 12px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                          title={`Click to filter by ${b.modelDesc}`}
                        >
                          <strong style={{ color: isSelected ? '#ffffff' : '#0f172a', fontWeight: 700 }}>
                            {b.count}x
                          </strong>
                          <span>{b.modelDesc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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
                  {inspectSearch && (
                    <button
                      type="button"
                      onClick={() => setInspectSearch('')}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Showing: <strong>{filteredInspectItems.length} of {selectedRecordToInspect.items?.length || 0} units</strong>
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
                      const isSvnr = it.intake_assignment?.includes('SVNR') || it.notes?.includes('SVNR');
                      const isCrbr = !isSvnr && (it.intake_assignment?.includes('CRBR') || it.notes?.includes('CRBR'));
                      const resolvedDesc = it.description || partDescMap.get(it.part_number?.toUpperCase()) || 'Apple Genuine Service Part';
                      return (
                        <tr key={it.id || idx}>
                          <td className="font-mono">{idx + 1}</td>
                          <td className="font-mono"><strong>{it.part_number}</strong></td>
                          <td>{resolvedDesc}</td>
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
                            {isSvnr ? (
                              <span className="badge" style={{ background: '#f3e8ff', color: '#7e22ce', fontSize: '10.5px' }}>
                                SVNR - Service Non-Repair
                              </span>
                            ) : isCrbr ? (
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
          showToast(`Created Dispatched Record ${newRec.id}`, 'success');
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
