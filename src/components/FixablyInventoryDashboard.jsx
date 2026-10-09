import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Globe,
  Building2,
  Package,
  AlertTriangle,
  Clock,
  CheckCircle2,
  FileSpreadsheet,
  UploadCloud,
  Download,
  Search,
  X,
  Copy,
  ChevronRight,
  ChevronLeft,
  Layers,
  Phone,
  Mail,
  MapPin,
  RefreshCw,
  Trash2,
  Boxes,
  Check,
  TrendingDown,
  ShieldAlert,
  ArrowRightLeft,
  Zap,
  Filter
} from 'lucide-react';
import dbStorage from '../utils/dbStorage.js';
import {
  validateFixablyFile,
  reconcileFixablyMultiFile,
  exportDeadStockToCsv,
  exportDeadStockToExcel,
  exportInvestigationToCsv,
  exportInvestigationToExcel,
  exportSiteToExcel,
  AGING_BRACKETS
} from '../utils/fixablyInventoryEngine.js';

export default function FixablyInventoryDashboard({
  currentUser = null,
  sites = [],
  _parts = [],
  _inventoryUnits = [],
  batchAddScanInUnits = null,
  clearSiteParts = null,
  showToast = null,
  initialViewMode = 'all_stocks',
  initialSelectedSiteId = null
}) {
  const isSuperadmin = currentUser?.role === 'superadmin';

  // 1. Core State
  const [viewMode, setViewMode] = useState(initialViewMode || 'all_stocks'); // 'all_stocks' | 'multi_site'
  const [snapshot, setSnapshot] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(null);
  const [isDropzoneOpen, setIsDropzoneOpen] = useState(false);
  const [syncWithAppInventory, setSyncWithAppInventory] = useState(true);

  // 2. 3-Slot File Ingestion State (User Uploads Only)
  const [slots, setSlots] = useState({
    site_stock: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null },
    kgb_used: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null },
    stock_transfer: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null }
  });
  const [activeSlotDrag, setActiveSlotDrag] = useState(null);

  // Hidden file inputs for each of the 3 slots
  const siteStockInputRef = useRef(null);
  const kgbInputRef = useRef(null);
  const stockTransferInputRef = useRef(null);

  // 3. All Stocks Master Table Filters
  const [masterSearch, setMasterSearch] = useState('');
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [agingFilter, setAgingFilter] = useState('ALL');
  const [classificationFilter, setClassificationFilter] = useState('ALL');
  const [investigationFilter, setInvestigationFilter] = useState('ALL'); // 'ALL' | 'INVESTIGATION_ONLY' | 'CLEAN_ONLY'
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [copiedSerial, setCopiedSerial] = useState(null);

  // 4. Multi-Site View State
  const [selectedRegion, setSelectedRegion] = useState('metro_manila'); // 'metro_manila' | 'provincial'
  const [selectedSiteCode, setSelectedSiteCode] = useState(() => {
    if (initialSelectedSiteId) {
      const match = sites.find(s => s.id === initialSelectedSiteId || s.code === initialSelectedSiteId);
      if (match) return match.code.replace(/^(ASP|APP)\s+/, '');
    }
    return 'BHS';
  });
  const [segmentedTab, setSegmentedTab] = useState('dead_stock'); // 'dead_stock' | 'non_moving' | 'slow_moving' | 'active_stock' | 'investigation' | 'part_aggregations' | 'all_stock'
  const [expandedPartPn, setExpandedPartPn] = useState(null);

  // Format file size helper
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Load initial data strictly from Storage (user uploads). NO default demo files.
  useEffect(() => {
    let isMounted = true;

    async function loadInitialData() {
      setIsLoading(true);
      try {
        const cached = await dbStorage.getItem('mdc_fixably_snapshot');
        if (cached && cached.items && cached.items.length > 0) {
          if (isMounted) {
            setSnapshot(cached);
            setIsLoading(false);
            return;
          }
        }

        // If no snapshot exists yet, open upload center automatically
        if (isMounted) {
          setIsDropzoneOpen(true);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('Error loading initial Fixably data:', err);
        if (isMounted) setIsLoading(false);
      }
    }

    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [sites]);

  // Handle slot file assignment and validation
  const handleSlotFileChange = async (slotKey, file) => {
    if (!file) return;
    try {
      const validation = await validateFixablyFile(file, slotKey);
      if (!validation.valid) {
        setSlots(prev => ({
          ...prev,
          [slotKey]: {
            file,
            name: file.name,
            size: file.size,
            rowCount: 0,
            valid: false,
            error: validation.error,
            content: null
          }
        }));
        showToast?.(validation.error, 'error');
        return;
      }

      setSlots(prev => ({
        ...prev,
        [slotKey]: {
          file,
          name: file.name,
          size: file.size,
          rowCount: validation.rowCount,
          valid: true,
          error: null,
          content: file
        }
      }));
      showToast?.(`Verified ${file.name} (${validation.rowCount.toLocaleString()} rows)`, 'success');
    } catch (err) {
      setSlots(prev => ({
        ...prev,
        [slotKey]: {
          file,
          name: file.name,
          size: file.size,
          rowCount: 0,
          valid: false,
          error: err.message,
          content: null
        }
      }));
      showToast?.(`File validation failed: ${err.message}`, 'error');
    }
  };

  // Clear specific slot
  const handleClearSlot = (slotKey) => {
    setSlots(prev => ({
      ...prev,
      [slotKey]: {
        file: null,
        name: '',
        size: 0,
        rowCount: 0,
        valid: false,
        error: null,
        content: null
      }
    }));
  };

  // Clear all slots
  const handleClearAllSlots = () => {
    setSlots({
      site_stock: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null },
      kgb_used: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null },
      stock_transfer: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null }
    });
  };

  // Process & Reconcile Multi-File Sync
  const handleProcessMultiFile = async () => {
    if (!slots.site_stock.content && !slots.site_stock.file) {
      showToast?.('Site Stocks (output.csv) is required.', 'error');
      return;
    }
    if (slots.site_stock.error) {
      showToast?.(`Slot 1 Error: ${slots.site_stock.error}`, 'error');
      return;
    }

    setIsParsing(true);
    setParseProgress({ stage: 'Reading files and validating schemas...', percent: 15 });

    try {
      const siteStockContent = slots.site_stock.file || slots.site_stock.content;
      const kgbUsedContent = slots.kgb_used.file || slots.kgb_used.content || null;
      const stockTransferContent = slots.stock_transfer.file || slots.stock_transfer.content || null;

      setParseProgress({ stage: 'Indexing KGB closed repairs & DC transfers...', percent: 45 });
      await new Promise(r => setTimeout(r, 60));

      const reconciled = await reconcileFixablyMultiFile({
        siteStockContent,
        kgbUsedContent,
        stockTransferContent,
        options: { sites, currentDate: new Date('2026-10-09T00:00:00Z') }
      });

      if (!reconciled.success) {
        showToast?.(reconciled.error || 'Reconciliation failed.', 'error');
        setIsParsing(false);
        setParseProgress(null);
        return;
      }

      setParseProgress({ stage: 'Calculating aging metrics and branch health...', percent: 75 });
      await new Promise(r => setTimeout(r, 60));

      // Persist snapshot in IndexedDB and LocalStorage
      await dbStorage.setItem('mdc_fixably_snapshot', reconciled);
      try {
        localStorage.setItem('mdc_fixably_snapshot_timestamp', reconciled.timestamp);
        const existingBatches = (await dbStorage.getItem('inventory_sync_batches')) || [];
        const updatedBatches = [
          reconciled.batchSummary,
          ...(Array.isArray(existingBatches) ? existingBatches.slice(0, 19) : [])
        ];
        await dbStorage.setItem('inventory_sync_batches', updatedBatches);
      } catch (e) {}

      setSnapshot(reconciled);
      setIsDropzoneOpen(false);

      // Optional: synchronize with batchAddScanInUnits
      if (syncWithAppInventory && typeof batchAddScanInUnits === 'function') {
        setParseProgress({ stage: 'Synchronizing with application stock...', percent: 90 });
        try {
          const validUnits = reconciled.items.map(it => ({
            ...it,
            part_number: it.partNumber,
            serial_number: it.serialNumber,
            site_code: it.siteCode,
            current_site_id: it.siteId,
            status: 'VALID',
            lifecycle_status: 'in_stock'
          }));
          await batchAddScanInUnits(validUnits, null, 'Branch Stock', 'ALL', 'ALL', 'All Retail Branches', {
            replaceExistingBranchStock: false
          });
        } catch (syncErr) {
          console.warn('Batch add sync warning:', syncErr);
        }
      }

      showToast?.(
        `Successfully synced ${reconciled.items.length.toLocaleString()} units across ${reconciled.sites.length} sites (${reconciled.investigationItems?.length || 0} flagged in closed repairs)!`,
        'success'
      );
    } catch (err) {
      console.error('Multi-file intake error:', err);
      showToast?.(`Error processing files: ${err.message}`, 'error');
    } finally {
      setIsParsing(false);
      setParseProgress(null);
    }
  };

  // Drag and drop helper for individual slots
  const handleSlotDragOver = (e, slotKey) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSlotDrag(slotKey);
  };

  const handleSlotDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSlotDrag(null);
  };

  const handleSlotDrop = (e, slotKey) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSlotDrag(null);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleSlotFileChange(slotKey, files[0]);
    }
  };

  // Filtered Master Items for All Stocks Page
  const filteredMasterItems = useMemo(() => {
    if (!snapshot?.items) return [];

    return snapshot.items.filter(item => {
      // 1. Site Filter
      if (siteFilter !== 'ALL') {
        const itemSite = String(item.siteCode || '').toUpperCase().replace(/^(ASP|APP)\s+/, '');
        const targetSite = siteFilter.toUpperCase().replace(/^(ASP|APP)\s+/, '');
        if (itemSite !== targetSite) return false;
      }

      // 2. Aging Filter
      if (agingFilter !== 'ALL') {
        if (item.agingBracket !== agingFilter) return false;
      }

      // 3. Classification Filter
      if (classificationFilter !== 'ALL') {
        if (item.stockType !== classificationFilter) return false;
      }

      // 4. Investigation Status Filter
      if (investigationFilter === 'INVESTIGATION_ONLY' && !item.isInvestigation) {
        return false;
      }
      if (investigationFilter === 'CLEAN_ONLY' && item.isInvestigation) {
        return false;
      }

      // 5. Search query
      if (masterSearch.trim()) {
        const q = masterSearch.toLowerCase().trim();
        const pn = String(item.partNumber || '').toLowerCase();
        const desc = String(item.description || '').toLowerCase();
        const sn = String(item.serialNumber || '').toLowerCase();
        const site = String(item.siteCode || '').toLowerCase();
        const siteNm = String(item.siteName || '').toLowerCase();
        const orderId = String(item.investigationDetails?.orderId || '').toLowerCase();
        if (!pn.includes(q) && !desc.includes(q) && !sn.includes(q) && !site.includes(q) && !siteNm.includes(q) && !orderId.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [snapshot, siteFilter, agingFilter, classificationFilter, investigationFilter, masterSearch]);

  // Pagination for Master Table
  const paginatedMasterItems = useMemo(() => {
    if (rowsPerPage === 'ALL') return filteredMasterItems;
    const start = (currentPage - 1) * rowsPerPage;
    return filteredMasterItems.slice(start, start + rowsPerPage);
  }, [filteredMasterItems, currentPage, rowsPerPage]);

  const totalPages = useMemo(() => {
    if (rowsPerPage === 'ALL' || rowsPerPage <= 0) return 1;
    return Math.ceil(filteredMasterItems.length / rowsPerPage) || 1;
  }, [filteredMasterItems, rowsPerPage]);

  // Current Site Data for Multi-Site Page
  const currentSiteData = useMemo(() => {
    if (!snapshot?.sites) return null;
    const target = selectedSiteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '');
    return snapshot.sites.find(s => s.siteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '') === target) || snapshot.sites[0] || null;
  }, [snapshot, selectedSiteCode]);

  // Available Sites grouped by region
  const { metroManilaSitesList, provincialSitesList } = useMemo(() => {
    if (!snapshot?.sites) return { metroManilaSitesList: [], provincialSitesList: [] };

    const provCodes = new Set(['ABR', 'CDO', 'CEB', 'COT', 'CBO', 'ILO', 'LAN', 'LAU', 'LIM', 'NAG', 'ZAM']);

    const mm = [];
    const prov = [];

    snapshot.sites.forEach(s => {
      const clean = s.siteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '');
      if (provCodes.has(clean)) {
        prov.push(s);
      } else {
        mm.push(s);
      }
    });

    return { metroManilaSitesList: mm, provincialSitesList: prov };
  }, [snapshot]);

  // Copy helper
  const handleCopy = (text, label) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSerial(text);
    showToast?.(`Copied ${label || text} to clipboard`, 'info');
    setTimeout(() => setCopiedSerial(null), 2000);
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [masterSearch, siteFilter, agingFilter, classificationFilter, investigationFilter, rowsPerPage]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '360px', gap: '14px' }}>
        <RefreshCw size={36} color="#0284c7" className="animate-spin" />
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Loading Inventory Snapshot...</div>
        <div style={{ fontSize: '12px', color: '#64748b' }}>Checking local cache and inventory sync state</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', width: '100%' }}>

      {/* 1. Refined Main Header Banner */}
      <div
        className="card"
        style={{
          padding: '18px 22px',
          background: '#ffffff',
          border: '1.5px solid #cbd5e1',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          
          <div style={{ flex: 1, minWidth: '300px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Globe size={22} color="#0284c7" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  All Stocks &amp; Multi-Site Inventory
                </h2>
                <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '2px' }}>
                  Network-wide on-hand inventory visibility, Fixably aging health &amp; GSX repair reconciliation
                </div>
              </div>
            </div>

            {snapshot && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                <span className="badge" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={12} color="#059669" />
                  <span>File: {snapshot.fileName || 'output.csv'}</span>
                </span>
                <span className="badge" style={{ background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 600 }}>
                  Synced: {new Date(snapshot.timestamp).toLocaleDateString()} {new Date(snapshot.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="badge" style={{ background: '#0284c7', color: '#ffffff', fontSize: '11px', fontWeight: 800 }}>
                  {snapshot.globalMetrics?.totalUnits || snapshot.items?.length || 0} Units On-Hand
                </span>
                <span className="badge" style={{ background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 700 }}>
                  {snapshot.sites?.length || 0} Authorized Service Points
                </span>
                {(snapshot.investigationItems?.length > 0 || snapshot.globalMetrics?.investigationCount > 0) && (
                  <span
                    className="badge"
                    onClick={() => {
                      setViewMode('all_stocks');
                      setInvestigationFilter(prev => prev === 'INVESTIGATION_ONLY' ? 'ALL' : 'INVESTIGATION_ONLY');
                    }}
                    style={{
                      background: '#fff1f2',
                      color: '#be123c',
                      border: '1.5px solid #fecdd3',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    title="Click to filter table to items appearing in closed GSX repairs"
                  >
                    <ShieldAlert size={12} color="#be123c" />
                    <span>{snapshot.investigationItems?.length || snapshot.globalMetrics?.investigationCount} Flagged in KGB</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* View Switcher Pills & Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
            <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: '3px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
              <button
                type="button"
                onClick={() => setViewMode('all_stocks')}
                style={{
                  padding: '7px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '12.5px',
                  fontWeight: viewMode === 'all_stocks' ? 800 : 600,
                  background: viewMode === 'all_stocks' ? '#0284c7' : 'transparent',
                  color: viewMode === 'all_stocks' ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                  boxShadow: viewMode === 'all_stocks' ? '0 1px 4px rgba(2, 132, 199, 0.3)' : 'none'
                }}
              >
                <Layers size={14} />
                <span>All Stocks (Master Directory)</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('multi_site')}
                style={{
                  padding: '7px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '12.5px',
                  fontWeight: viewMode === 'multi_site' ? 800 : 600,
                  background: viewMode === 'multi_site' ? '#0284c7' : 'transparent',
                  color: viewMode === 'multi_site' ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                  boxShadow: viewMode === 'multi_site' ? '0 1px 4px rgba(2, 132, 199, 0.3)' : 'none'
                }}
              >
                <Building2 size={14} />
                <span>Multi-Site (Branch Aging &amp; Health)</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setIsDropzoneOpen(prev => !prev)}
                style={{
                  fontSize: '12px',
                  padding: '6px 14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 700,
                  color: '#0284c7',
                  border: '1.5px solid #0284c7',
                  background: isDropzoneOpen ? '#e0f2fe' : '#ffffff',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                <UploadCloud size={14} color="#0284c7" />
                <span>{isDropzoneOpen ? 'Close Upload Center' : 'Upload Reports (3-Slot)'}</span>
              </button>

              {snapshot && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => exportDeadStockToExcel(snapshot.items, 'NETWORK')}
                    style={{
                      fontSize: '12px',
                      padding: '6px 14px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 700,
                      color: '#dc2626',
                      border: '1.5px solid #f87171',
                      background: '#fff1f2',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    title="Export all network dead stock (>= 180 days) for pull-out logistics"
                  >
                    <Download size={13} color="#dc2626" />
                    <span>Dead Stock (.xlsx)</span>
                  </button>

                  {snapshot.investigationItems?.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => exportInvestigationToExcel(snapshot.investigationItems, 'NETWORK')}
                      style={{
                        fontSize: '12px',
                        padding: '6px 14px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontWeight: 700,
                        color: '#be123c',
                        border: '1.5px solid #fecdd3',
                        background: '#ffe4e6',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                      title="Export all flagged investigation items (closed GSX repairs) for dispatch audit"
                    >
                      <ShieldAlert size={13} color="#be123c" />
                      <span>Investigation (.xlsx)</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* 2. Unified 3-Slot Upload Center (No demo workspace defaults) */}
      {isDropzoneOpen && (
        <div
          className="card"
          style={{
            padding: '24px',
            background: '#ffffff',
            border: '2px solid #0284c7',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(2, 132, 199, 0.12)'
          }}
        >
          {/* Hidden file inputs */}
          <input
            type="file"
            ref={siteStockInputRef}
            onChange={(e) => e.target.files?.[0] && handleSlotFileChange('site_stock', e.target.files[0])}
            accept=".csv,.txt"
            style={{ display: 'none' }}
          />
          <input
            type="file"
            ref={kgbInputRef}
            onChange={(e) => e.target.files?.[0] && handleSlotFileChange('kgb_used', e.target.files[0])}
            accept=".csv,.txt"
            style={{ display: 'none' }}
          />
          <input
            type="file"
            ref={stockTransferInputRef}
            onChange={(e) => e.target.files?.[0] && handleSlotFileChange('stock_transfer', e.target.files[0])}
            accept=".csv,.txt"
            style={{ display: 'none' }}
          />

          {/* Header of Upload Center */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UploadCloud size={22} color="#0284c7" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                  Unified Fixably Multi-File Ingestion Center
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  Select or drop your export files to reconcile branch on-hand inventory, GSX repair consumption, and DC transfers.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsDropzoneOpen(false)}
              style={{ border: 'none', background: '#f1f5f9', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}
            >
              <X size={16} />
            </button>
          </div>

          {/* The 3 Drop Slots Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            
            {/* SLOT 1: Site Stocks (output.csv) [Required] */}
            <div
              onDragOver={(e) => handleSlotDragOver(e, 'site_stock')}
              onDragLeave={handleSlotDragLeave}
              onDrop={(e) => handleSlotDrop(e, 'site_stock')}
              onClick={() => !slots.site_stock.valid && siteStockInputRef.current?.click()}
              style={{
                padding: '16px',
                borderRadius: '10px',
                border: activeSlotDrag === 'site_stock' ? '2px dashed #0284c7' : slots.site_stock.valid ? '2px solid #10b981' : slots.site_stock.error ? '2px solid #ef4444' : '2px dashed #cbd5e1',
                background: activeSlotDrag === 'site_stock' ? '#f0f9ff' : slots.site_stock.valid ? '#f0fdf4' : slots.site_stock.error ? '#fef2f2' : '#f8fafc',
                cursor: slots.site_stock.valid ? 'default' : 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Package size={17} color={slots.site_stock.valid ? '#16a34a' : '#0284c7'} />
                  <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Slot 1: Site Stocks</strong>
                </div>
                <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '4px', background: slots.site_stock.valid ? '#dcfce7' : '#fee2e2', color: slots.site_stock.valid ? '#15803d' : '#b91c1c' }}>
                  REQUIRED
                </span>
              </div>

              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '12px' }}>
                Expected: <code style={{ fontWeight: 700, color: '#0284c7' }}>output.csv</code> (Stock Name, Part Number, Serial, Last Received Date)
              </div>

              {slots.site_stock.valid ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #86efac', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <CheckCircle2 size={15} color="#16a34a" />
                      <span>{slots.site_stock.name}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#4b5563', marginTop: '2px' }}>
                      {formatFileSize(slots.site_stock.size)} • {slots.site_stock.rowCount.toLocaleString()} inventory units
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearSlot('site_stock');
                    }}
                    style={{ border: 'none', background: '#fee2e2', borderRadius: '4px', padding: '5px', cursor: 'pointer', color: '#dc2626' }}
                    title="Remove file"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : slots.site_stock.error ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #fecdd3', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                    <AlertTriangle size={14} color="#dc2626" />
                    <span>Validation Error</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#991b1b' }}>{slots.site_stock.error}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      siteStockInputRef.current?.click();
                    }}
                    style={{ marginTop: '8px', border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Select Replacement File
                  </button>
                </div>
              ) : (
                <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: '8px', padding: '18px 10px', textAlign: 'center', background: '#ffffff' }}>
                  <UploadCloud size={24} color="#0284c7" style={{ margin: '0 auto 6px' }} />
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0284c7' }}>Select or drop output.csv</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Fixably branch on-hand stock export</div>
                </div>
              )}
            </div>

            {/* SLOT 2: KGB Used Report (kgb_used.csv) [Recommended] */}
            <div
              onDragOver={(e) => handleSlotDragOver(e, 'kgb_used')}
              onDragLeave={handleSlotDragLeave}
              onDrop={(e) => handleSlotDrop(e, 'kgb_used')}
              onClick={() => !slots.kgb_used.valid && kgbInputRef.current?.click()}
              style={{
                padding: '16px',
                borderRadius: '10px',
                border: activeSlotDrag === 'kgb_used' ? '2px dashed #0284c7' : slots.kgb_used.valid ? '2px solid #10b981' : slots.kgb_used.error ? '2px solid #ef4444' : '2px dashed #cbd5e1',
                background: activeSlotDrag === 'kgb_used' ? '#f0f9ff' : slots.kgb_used.valid ? '#f0fdf4' : slots.kgb_used.error ? '#fef2f2' : '#f8fafc',
                cursor: slots.kgb_used.valid ? 'default' : 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldAlert size={17} color={slots.kgb_used.valid ? '#16a34a' : '#ea580c'} />
                  <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Slot 2: GSX KGB Used Report</strong>
                </div>
                <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '4px', background: slots.kgb_used.valid ? '#dcfce7' : '#e0e7ff', color: slots.kgb_used.valid ? '#15803d' : '#3730a3' }}>
                  RECOMMENDED
                </span>
              </div>

              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '12px' }}>
                Expected: <code style={{ fontWeight: 700, color: '#0284c7' }}>kgb_used.csv</code> (Order ID, Product KGB, Repair Closed Date)
              </div>

              {slots.kgb_used.valid ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #86efac', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <CheckCircle2 size={15} color="#16a34a" />
                      <span>{slots.kgb_used.name}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#4b5563', marginTop: '2px' }}>
                      {formatFileSize(slots.kgb_used.size)} • {slots.kgb_used.rowCount.toLocaleString()} repair log rows
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearSlot('kgb_used');
                    }}
                    style={{ border: 'none', background: '#fee2e2', borderRadius: '4px', padding: '5px', cursor: 'pointer', color: '#dc2626' }}
                    title="Remove file"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : slots.kgb_used.error ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #fecdd3', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                    <AlertTriangle size={14} color="#dc2626" />
                    <span>Validation Error</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#991b1b' }}>{slots.kgb_used.error}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      kgbInputRef.current?.click();
                    }}
                    style={{ marginTop: '8px', border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Select Replacement File
                  </button>
                </div>
              ) : (
                <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: '8px', padding: '18px 10px', textAlign: 'center', background: '#ffffff' }}>
                  <UploadCloud size={24} color="#ea580c" style={{ margin: '0 auto 6px' }} />
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#ea580c' }}>Select or drop kgb_used.csv</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>GSX closed repair consumed parts</div>
                </div>
              )}
            </div>

            {/* SLOT 3: Stock Transfers (stock_transfer.csv) [Recommended] */}
            <div
              onDragOver={(e) => handleSlotDragOver(e, 'stock_transfer')}
              onDragLeave={handleSlotDragLeave}
              onDrop={(e) => handleSlotDrop(e, 'stock_transfer')}
              onClick={() => !slots.stock_transfer.valid && stockTransferInputRef.current?.click()}
              style={{
                padding: '16px',
                borderRadius: '10px',
                border: activeSlotDrag === 'stock_transfer' ? '2px dashed #0284c7' : slots.stock_transfer.valid ? '2px solid #10b981' : slots.stock_transfer.error ? '2px solid #ef4444' : '2px dashed #cbd5e1',
                background: activeSlotDrag === 'stock_transfer' ? '#f0f9ff' : slots.stock_transfer.valid ? '#f0fdf4' : slots.stock_transfer.error ? '#fef2f2' : '#f8fafc',
                cursor: slots.stock_transfer.valid ? 'default' : 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ArrowRightLeft size={17} color={slots.stock_transfer.valid ? '#16a34a' : '#6d28d9'} />
                  <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Slot 3: Stock Transfers</strong>
                </div>
                <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '4px', background: slots.stock_transfer.valid ? '#dcfce7' : '#e0e7ff', color: slots.stock_transfer.valid ? '#15803d' : '#3730a3' }}>
                  RECOMMENDED
                </span>
              </div>

              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '12px' }}>
                Expected: <code style={{ fontWeight: 700, color: '#0284c7' }}>stock_transfer.csv</code> (From Stock, To Stock, Serial Number)
              </div>

              {slots.stock_transfer.valid ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #86efac', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <CheckCircle2 size={15} color="#16a34a" />
                      <span>{slots.stock_transfer.name}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#4b5563', marginTop: '2px' }}>
                      {formatFileSize(slots.stock_transfer.size)} • {slots.stock_transfer.rowCount.toLocaleString()} transfer records
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearSlot('stock_transfer');
                    }}
                    style={{ border: 'none', background: '#fee2e2', borderRadius: '4px', padding: '5px', cursor: 'pointer', color: '#dc2626' }}
                    title="Remove file"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : slots.stock_transfer.error ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #fecdd3', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                    <AlertTriangle size={14} color="#dc2626" />
                    <span>Validation Error</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#991b1b' }}>{slots.stock_transfer.error}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      stockTransferInputRef.current?.click();
                    }}
                    style={{ marginTop: '8px', border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Select Replacement File
                  </button>
                </div>
              ) : (
                <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: '8px', padding: '18px 10px', textAlign: 'center', background: '#ffffff' }}>
                  <UploadCloud size={24} color="#6d28d9" style={{ margin: '0 auto 6px' }} />
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#6d28d9' }}>Select or drop stock_transfer.csv</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>DC transfers for DC Stock classification</div>
                </div>
              )}
            </div>

          </div>

          {/* Action Toolbar & Progress */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleClearAllSlots}
                disabled={isParsing}
                style={{ fontSize: '12px', padding: '7px 14px', background: '#f8fafc', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
              >
                Clear All Slots
              </button>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#334155', cursor: 'pointer', fontWeight: 600, marginLeft: '6px' }}>
                <input
                  type="checkbox"
                  checked={syncWithAppInventory}
                  onChange={(e) => setSyncWithAppInventory(e.target.checked)}
                />
                <span>Sync with App Active Stock (Branch Inventory)</span>
              </label>
            </div>

            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleProcessMultiFile}
                disabled={isParsing || !slots.site_stock.valid || Boolean(slots.site_stock.error)}
                style={{
                  padding: '9px 24px',
                  fontSize: '13.5px',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)'
                }}
              >
                {isParsing ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" />
                    <span>Processing &amp; Reconciling...</span>
                  </>
                ) : (
                  <>
                    <Zap size={15} />
                    <span>Process &amp; Sync Inventory</span>
                  </>
                )}
              </button>
            </div>

          </div>

          {/* Parsing progress bar */}
          {isParsing && parseProgress && (
            <div style={{ marginTop: '16px', background: '#f0f9ff', padding: '12px 16px', borderRadius: '8px', border: '1px solid #bae6fd' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#0369a1', fontWeight: 700, marginBottom: '6px' }}>
                <span>{parseProgress.stage}</span>
                <span>{parseProgress.percent}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#e0f2fe', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${parseProgress.percent}%`, height: '100%', background: '#0284c7', transition: 'width 0.2s ease' }} />
              </div>
            </div>
          )}

        </div>
      )}

      {/* 3. Global Summary KPI Cards (Interactive Filters) */}
      {snapshot?.globalMetrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
          
          {/* Card 1: Total Active Value */}
          <div
            className="card"
            style={{
              padding: '16px',
              background: '#ffffff',
              border: '1.5px solid #cbd5e1',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Active Value
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Boxes size={15} color="#0284c7" />
              </div>
            </div>
            <div style={{ fontSize: '21px', fontWeight: 900, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
              ${Number(snapshot.globalMetrics.totalValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px', fontWeight: 600 }}>
              Across {snapshot.globalMetrics.sitesCount} service sites
            </div>
          </div>

          {/* Card 2: Total Units On-Hand */}
          <div
            className="card"
            onClick={() => {
              setAgingFilter('ALL');
              setInvestigationFilter('ALL');
            }}
            style={{
              padding: '16px',
              background: '#ffffff',
              border: (agingFilter === 'ALL' && investigationFilter === 'ALL') ? '2px solid #0284c7' : '1.5px solid #cbd5e1',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
            }}
            title="Click to reset filters and view all on-hand units"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Total On-Hand
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Package size={15} color="#16a34a" />
              </div>
            </div>
            <div style={{ fontSize: '21px', fontWeight: 900, color: '#0f172a' }}>
              {snapshot.globalMetrics.totalUnits.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px', fontWeight: 600 }}>
              {snapshot.globalMetrics.uniqueParts} catalog parts
            </div>
          </div>

          {/* Card 3: Dead Stock (>= 180 days) - Action Required */}
          <div
            className="card"
            onClick={() => setAgingFilter(prev => prev === AGING_BRACKETS.DEAD_STOCK ? 'ALL' : AGING_BRACKETS.DEAD_STOCK)}
            style={{
              padding: '16px',
              background: agingFilter === AGING_BRACKETS.DEAD_STOCK ? '#ffe4e6' : '#fff1f2',
              border: agingFilter === AGING_BRACKETS.DEAD_STOCK ? '2px solid #e11d48' : '1.5px solid #fecdd3',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Click to filter Master Table to Dead Stock (>= 180 days)"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#be123c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Dead Stock (≥ 180d)
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#ffe4e6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={15} color="#e11d48" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <div style={{ fontSize: '21px', fontWeight: 900, color: '#be123c' }}>
                {snapshot.globalMetrics.agingCounts[AGING_BRACKETS.DEAD_STOCK]?.toLocaleString() || 0}
              </div>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#e11d48' }}>
                ({snapshot.globalMetrics.deadStockPercent}%)
              </span>
            </div>
            <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#be123c', marginTop: '3px' }}>
              {agingFilter === AGING_BRACKETS.DEAD_STOCK ? 'Filtering Active (Click to reset)' : 'Action Required (RMA Pull-Out)'}
            </div>
          </div>

          {/* Card 4: Non-Moving (90 - 179 days) */}
          <div
            className="card"
            onClick={() => setAgingFilter(prev => prev === AGING_BRACKETS.NON_MOVING ? 'ALL' : AGING_BRACKETS.NON_MOVING)}
            style={{
              padding: '16px',
              background: agingFilter === AGING_BRACKETS.NON_MOVING ? '#ffedd5' : '#fff7ed',
              border: agingFilter === AGING_BRACKETS.NON_MOVING ? '2px solid #ea580c' : '1.5px solid #fed7aa',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Click to filter Master Table to Non-Moving Stock (90–179 days)"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Non-Moving (90–179d)
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#ffedd5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Clock size={15} color="#ea580c" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <div style={{ fontSize: '21px', fontWeight: 900, color: '#c2410c' }}>
                {snapshot.globalMetrics.agingCounts[AGING_BRACKETS.NON_MOVING]?.toLocaleString() || 0}
              </div>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#ea580c' }}>
                ({snapshot.globalMetrics.nonMovingPercent}%)
              </span>
            </div>
            <div style={{ fontSize: '10.5px', color: '#9a3412', marginTop: '3px', fontWeight: 700 }}>
              {agingFilter === AGING_BRACKETS.NON_MOVING ? 'Filtering Active' : 'Pre-aging inventory tier'}
            </div>
          </div>

          {/* Card 5: Slow-Moving (60 - 89 days) */}
          <div
            className="card"
            onClick={() => setAgingFilter(prev => prev === AGING_BRACKETS.SLOW_MOVING ? 'ALL' : AGING_BRACKETS.SLOW_MOVING)}
            style={{
              padding: '16px',
              background: agingFilter === AGING_BRACKETS.SLOW_MOVING ? '#fef3c7' : '#fffbeb',
              border: agingFilter === AGING_BRACKETS.SLOW_MOVING ? '2px solid #d97706' : '1.5px solid #fde68a',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Click to filter Master Table to Slow-Moving Stock (60–89 days)"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Slow-Moving (60–89d)
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <TrendingDown size={15} color="#d97706" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <div style={{ fontSize: '21px', fontWeight: 900, color: '#b45309' }}>
                {snapshot.globalMetrics.agingCounts[AGING_BRACKETS.SLOW_MOVING]?.toLocaleString() || 0}
              </div>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#d97706' }}>
                ({snapshot.globalMetrics.slowMovingPercent}%)
              </span>
            </div>
            <div style={{ fontSize: '10.5px', color: '#92400e', marginTop: '3px', fontWeight: 700 }}>
              {agingFilter === AGING_BRACKETS.SLOW_MOVING ? 'Filtering Active' : 'Velocity slowing down'}
            </div>
          </div>

          {/* Card 6: In Stock / Active (< 60 days) */}
          <div
            className="card"
            onClick={() => setAgingFilter(prev => prev === AGING_BRACKETS.IN_STOCK ? 'ALL' : AGING_BRACKETS.IN_STOCK)}
            style={{
              padding: '16px',
              background: agingFilter === AGING_BRACKETS.IN_STOCK ? '#dcfce7' : '#f0fdf4',
              border: agingFilter === AGING_BRACKETS.IN_STOCK ? '2px solid #16a34a' : '1.5px solid #bbf7d0',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Click to filter Master Table to Active In-Stock (< 60 days)"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Active Stock (&lt; 60d)
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle2 size={15} color="#16a34a" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <div style={{ fontSize: '21px', fontWeight: 900, color: '#15803d' }}>
                {snapshot.globalMetrics.agingCounts[AGING_BRACKETS.IN_STOCK]?.toLocaleString() || 0}
              </div>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#16a34a' }}>
                ({snapshot.globalMetrics.inStockPercent}%)
              </span>
            </div>
            <div style={{ fontSize: '10.5px', color: '#166534', marginTop: '3px', fontWeight: 700 }}>
              {agingFilter === AGING_BRACKETS.IN_STOCK ? 'Filtering Active' : 'Fresh active rotation'}
            </div>
          </div>

          {/* Card 7: KGB Closed Repairs */}
          <div
            className="card"
            onClick={() => {
              setViewMode('all_stocks');
              setInvestigationFilter(prev => prev === 'INVESTIGATION_ONLY' ? 'ALL' : 'INVESTIGATION_ONLY');
            }}
            style={{
              padding: '16px',
              background: investigationFilter === 'INVESTIGATION_ONLY' ? '#ffe4e6' : '#fff1f2',
              border: investigationFilter === 'INVESTIGATION_ONLY' ? '2px solid #e11d48' : '1.5px solid #fecdd3',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Click to filter Master Table to on-hand parts consumed in GSX repairs"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#be123c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                KGB Closed Repairs
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#ffe4e6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldAlert size={15} color="#e11d48" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <div style={{ fontSize: '21px', fontWeight: 900, color: '#be123c' }}>
                {snapshot.globalMetrics?.investigationCount || snapshot.investigationItems?.length || 0}
              </div>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#e11d48' }}>
                UNITS
              </span>
            </div>
            <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#be123c', marginTop: '3px' }}>
              {investigationFilter === 'INVESTIGATION_ONLY' ? 'Filtering Active (Click to reset)' : 'On-hand parts used in GSX'}
            </div>
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 1: "ALL STOCKS" MASTER DIRECTORY TABLE (High-Visibility Redesign) */}
      {/* ========================================================================= */}
      {viewMode === 'all_stocks' && (
        <div
          className="card"
          style={{
            padding: 0,
            overflow: 'hidden',
            border: '1.5px solid #cbd5e1',
            borderRadius: '12px',
            background: '#ffffff',
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)'
          }}
        >
          {/* Filter Bar with Strong Visual Hierarchy */}
          <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              
              {/* Search Bar */}
              <div style={{ position: 'relative', flex: 1, minWidth: '280px', maxWidth: '420px' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#0284c7' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{
                    paddingLeft: '36px',
                    paddingRight: masterSearch ? '30px' : '10px',
                    fontSize: '13px',
                    height: '38px',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#0f172a',
                    fontWeight: 600
                  }}
                  placeholder="Search part #, description, serial #, branch, order #..."
                  value={masterSearch}
                  onChange={(e) => setMasterSearch(e.target.value)}
                />
                {masterSearch && (
                  <button
                    type="button"
                    onClick={() => setMasterSearch('')}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Dropdown Filters */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                
                {/* Site Filter */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>Branch:</label>
                  <select
                    className="form-select"
                    style={{ fontSize: '12px', padding: '6px 10px', height: '38px', borderRadius: '8px', border: '1.5px solid #cbd5e1', background: '#ffffff', fontWeight: 600, color: '#0f172a' }}
                    value={siteFilter}
                    onChange={(e) => setSiteFilter(e.target.value)}
                  >
                    <option value="ALL">All Branches ({snapshot?.sites?.length || 0})</option>
                    {snapshot?.sites?.map(s => (
                      <option key={s.siteCode} value={s.siteCode}>
                        {s.siteCode} ({s.totalUnits})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Aging Status Filter */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>Aging:</label>
                  <select
                    className="form-select"
                    style={{ fontSize: '12px', padding: '6px 10px', height: '38px', borderRadius: '8px', border: '1.5px solid #cbd5e1', background: '#ffffff', fontWeight: 600, color: '#0f172a' }}
                    value={agingFilter}
                    onChange={(e) => setAgingFilter(e.target.value)}
                  >
                    <option value="ALL">All Aging Brackets</option>
                    <option value={AGING_BRACKETS.DEAD_STOCK}>Dead Stock (≥ 180d)</option>
                    <option value={AGING_BRACKETS.NON_MOVING}>Non-Moving (90–179d)</option>
                    <option value={AGING_BRACKETS.SLOW_MOVING}>Slow-Moving (60–89d)</option>
                    <option value={AGING_BRACKETS.IN_STOCK}>Active Stock (&lt; 60d)</option>
                  </select>
                </div>

                {/* Stock Classification Filter */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>Type:</label>
                  <select
                    className="form-select"
                    style={{ fontSize: '12px', padding: '6px 10px', height: '38px', borderRadius: '8px', border: '1.5px solid #cbd5e1', background: '#ffffff', fontWeight: 600, color: '#0f172a' }}
                    value={classificationFilter}
                    onChange={(e) => setClassificationFilter(e.target.value)}
                  >
                    <option value="ALL">All Stock Types</option>
                    <option value="DC Stock">DC Stock</option>
                    <option value="MSPI-Owned / C/I REP">MSPI-Owned / C/I REP</option>
                  </select>
                </div>

                {/* Investigation Filter */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>GSX Status:</label>
                  <select
                    className="form-select"
                    style={{
                      fontSize: '12px',
                      padding: '6px 10px',
                      height: '38px',
                      borderRadius: '8px',
                      border: investigationFilter === 'INVESTIGATION_ONLY' ? '2px solid #e11d48' : '1.5px solid #cbd5e1',
                      background: investigationFilter === 'INVESTIGATION_ONLY' ? '#fff1f2' : '#ffffff',
                      color: investigationFilter === 'INVESTIGATION_ONLY' ? '#be123c' : '#0f172a',
                      fontWeight: 700
                    }}
                    value={investigationFilter}
                    onChange={(e) => setInvestigationFilter(e.target.value)}
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="INVESTIGATION_ONLY">⚠️ Flagged in Closed Repairs ({snapshot?.investigationItems?.length || snapshot?.globalMetrics?.investigationCount || 0})</option>
                    <option value="CLEAN_ONLY">✓ Verified Clean Stock</option>
                  </select>
                </div>

                {/* Rows per page */}
                <select
                  className="form-select"
                  style={{ fontSize: '12px', padding: '6px 10px', height: '38px', borderRadius: '8px', border: '1.5px solid #cbd5e1', background: '#ffffff', width: '90px', fontWeight: 600 }}
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                >
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                  <option value={200}>200 / page</option>
                  <option value="ALL">View All</option>
                </select>

                {(masterSearch || siteFilter !== 'ALL' || agingFilter !== 'ALL' || classificationFilter !== 'ALL' || investigationFilter !== 'ALL') && (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      setMasterSearch('');
                      setSiteFilter('ALL');
                      setAgingFilter('ALL');
                      setClassificationFilter('ALL');
                      setInvestigationFilter('ALL');
                    }}
                    style={{ fontSize: '12px', padding: '6px 12px', height: '38px', fontWeight: 700 }}
                    title="Reset all filters"
                  >
                    Reset
                  </button>
                )}

              </div>

            </div>

            {/* Results count & active filters display */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#475569', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
              <div>
                Showing <strong style={{ color: '#0f172a' }}>{filteredMasterItems.length.toLocaleString()}</strong> of {snapshot?.items?.length.toLocaleString() || 0} total serialized units
                {investigationFilter === 'INVESTIGATION_ONLY' && (
                  <span style={{ marginLeft: '8px', color: '#be123c', fontWeight: 800 }}>
                    (Filtered to units matching closed GSX repair consumption)
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className="badge" style={{ background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd', fontSize: '11px', fontWeight: 800 }}>
                  DC Stock: {filteredMasterItems.filter(i => i.stockType === 'DC Stock').length.toLocaleString()}
                </span>
                <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #7dd3fc', fontSize: '11px', fontWeight: 800 }}>
                  MSPI-Owned: {filteredMasterItems.filter(i => i.stockType !== 'DC Stock').length.toLocaleString()}
                </span>
                {filteredMasterItems.filter(i => i.isInvestigation).length > 0 && (
                  <span className="badge" style={{ background: '#fff1f2', color: '#be123c', border: '1.5px solid #fecdd3', fontSize: '11px', fontWeight: 800 }}>
                    ⚠️ Flagged: {filteredMasterItems.filter(i => i.isInvestigation).length.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Master Table: High-Visibility Dark Sticky Header & High-Contrast Typography */}
          <div className="table-container" style={{ overflowX: 'auto', maxHeight: '720px' }}>
            {paginatedMasterItems.length === 0 ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
                <Boxes size={40} color="#94a3b8" style={{ marginBottom: '10px' }} />
                <h4 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: '16px', fontWeight: 800 }}>No Inventory Records Match Your Filter</h4>
                <p style={{ margin: 0, fontSize: '13px' }}>Try broadening your search query or resetting the dropdown filters.</p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0284c7' }}>
                    <th style={{ width: '50px', textAlign: 'center', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>#</th>
                    <th style={{ minWidth: '150px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Number</th>
                    <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Description</th>
                    <th style={{ width: '110px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Branch</th>
                    <th style={{ width: '140px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Classification</th>
                    <th style={{ minWidth: '175px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Serial Number</th>
                    <th style={{ width: '120px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Last Received</th>
                    <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Aging &amp; Status</th>
                    <th style={{ minWidth: '180px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>GSX / Dispatch Status</th>
                    <th style={{ width: '110px', textAlign: 'right', padding: '12px 16px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMasterItems.map((item, idx) => {
                    const rowNumber = rowsPerPage === 'ALL' ? idx + 1 : (currentPage - 1) * rowsPerPage + idx + 1;
                    const isCopied = copiedSerial === item.serialNumber;
                    const isEven = idx % 2 === 1;

                    return (
                      <tr
                        key={item.id}
                        style={{
                          borderBottom: '1px solid #e2e8f0',
                          background: item.isInvestigation ? '#fff5f5' : isEven ? '#f8fafc' : '#ffffff',
                          transition: 'background-color 0.1s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#e0f2fe';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = item.isInvestigation ? '#fff5f5' : isEven ? '#f8fafc' : '#ffffff';
                        }}
                      >
                        <td style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', fontWeight: 700, verticalAlign: 'middle', padding: '12px 10px', whiteSpace: 'nowrap' }}>
                          {rowNumber}
                        </td>
                        
                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#0284c7', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '13px', fontWeight: 700 }}>
                              {item.partNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(item.partNumber, 'Part Number')}
                              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                              title="Copy Part Number"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px' }}>
                          <div style={{ color: '#0f172a', fontWeight: 500, fontSize: '13px', lineHeight: 1.4, minWidth: '220px' }}>
                            {item.description}
                          </div>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            onClick={() => {
                              setSelectedSiteCode(item.cleanSiteCode || item.siteCode.replace(/^(ASP|APP)\s+/, ''));
                              setViewMode('multi_site');
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '4px 9px',
                              borderRadius: '6px',
                              background: '#f1f5f9',
                              color: '#1e293b',
                              fontWeight: 700,
                              fontSize: '11.5px',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              border: '1px solid #e2e8f0',
                              transition: 'background-color 0.15s ease'
                            }}
                            title="Click to view branch in Multi-Site dashboard"
                          >
                            {item.siteCode}
                          </span>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '3px 9px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              background: item.stockType === 'DC Stock' ? '#f5f3ff' : '#f0f9ff',
                              color: item.stockType === 'DC Stock' ? '#6d28d9' : '#0369a1',
                              border: item.stockType === 'DC Stock' ? '1px solid #ddd6fe' : '1px solid #bae6fd'
                            }}
                          >
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.stockType === 'DC Stock' ? '#8b5cf6' : '#0284c7' }} />
                            {item.stockType}
                          </span>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          {item.serialNumber ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{
                                fontSize: '12px',
                                color: '#0f172a',
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                padding: '3px 8px',
                                borderRadius: '5px',
                                fontWeight: 600,
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                letterSpacing: '0.02em'
                              }}>
                                {item.serialNumber}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopy(item.serialNumber, 'Serial')}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: isCopied ? '#16a34a' : '#94a3b8', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                                title="Copy Serial Number"
                              >
                                {isCopied ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '11.5px', fontStyle: 'italic' }}>Non-serialized (Qty: {item.quantity})</span>
                          )}
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', fontSize: '12px', color: '#475569', fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', whiteSpace: 'nowrap' }}>
                          {item.lastReceivedDate || '—'}
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '3px 9px',
                                borderRadius: '6px',
                                fontSize: '11.5px',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                background: item.badgeBg,
                                color: item.badgeColor,
                                border: item.agingBracket === AGING_BRACKETS.DEAD_STOCK ? '1px solid #fca5a5'
                                  : item.agingBracket === AGING_BRACKETS.NON_MOVING ? '1px solid #fdba74'
                                  : item.agingBracket === AGING_BRACKETS.SLOW_MOVING ? '1px solid #fde047'
                                  : '1px solid #86efac'
                              }}
                              title={item.statusLabel}
                            >
                              {item.agingBracket === AGING_BRACKETS.DEAD_STOCK && <AlertTriangle size={12} color="#dc2626" />}
                              {item.agingBracket === AGING_BRACKETS.NON_MOVING && <Clock size={12} color="#ea580c" />}
                              {item.agingBracket === AGING_BRACKETS.SLOW_MOVING && <TrendingDown size={12} color="#d97706" />}
                              {item.agingBracket === AGING_BRACKETS.IN_STOCK && <CheckCircle2 size={12} color="#16a34a" />}
                              <span>
                                {item.agingBracket === AGING_BRACKETS.DEAD_STOCK
                                  ? `Dead Stock (${item.agingDays}d)`
                                  : item.agingBracket === AGING_BRACKETS.NON_MOVING
                                  ? `Non-Moving (${item.agingDays}d)`
                                  : item.agingBracket === AGING_BRACKETS.SLOW_MOVING
                                  ? `Slow-Moving (${item.agingDays}d)`
                                  : `In Stock (${item.agingDays}d)`}
                              </span>
                            </span>

                            {item.agingBracket === AGING_BRACKETS.DEAD_STOCK && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                  background: '#fee2e2',
                                  color: '#b91c1c',
                                  border: '1px solid #fca5a5',
                                  whiteSpace: 'nowrap'
                                }}
                                title="Action Required: RMA pull-out or site reallocation"
                              >
                                Action Req.
                              </span>
                            )}
                          </div>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          {item.isInvestigation ? (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 700,
                                background: '#fff1f2',
                                color: '#be123c',
                                border: '1px solid #fecdd3'
                              }}
                              title={`Closed GSX Repair Order #${item.investigationDetails?.orderId || ''} (${item.investigationDetails?.gsxStatus || 'SCOM'}) closed on ${item.investigationDetails?.repairClosedDate || ''} at ${item.investigationDetails?.locationName || ''}`}
                            >
                              <ShieldAlert size={12} color="#e11d48" />
                              <span>Order #{item.investigationDetails?.orderId} ({item.investigationDetails?.gsxStatus || 'SCOM'})</span>
                            </div>
                          ) : (
                            <span style={{ color: '#059669', fontSize: '11.5px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <Check size={13} color="#059669" />
                              <span>Verified Clean</span>
                            </span>
                          )}
                        </td>

                        <td style={{ verticalAlign: 'middle', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '13px', color: '#0f172a', padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          ${(item.totalValue || item.partValue || 0).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination Controls with High Contrast */}
          {rowsPerPage !== 'ALL' && totalPages > 1 && (
            <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1.5px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ fontSize: '12.5px', color: '#334155', fontWeight: 600 }}>
                Page <strong style={{ color: '#0f172a' }}>{currentPage}</strong> of <strong style={{ color: '#0f172a' }}>{totalPages}</strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(1)}
                  style={{ fontSize: '12px', padding: '5px 10px', fontWeight: 700 }}
                >
                  First
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  style={{ fontSize: '12px', padding: '5px 8px' }}
                >
                  <ChevronLeft size={14} />
                </button>

                <span style={{ fontSize: '12.5px', padding: '0 10px', fontWeight: 800, color: '#0f172a' }}>
                  {currentPage} / {totalPages}
                </span>

                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  style={{ fontSize: '12px', padding: '5px 8px' }}
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  style={{ fontSize: '12px', padding: '5px 10px', fontWeight: 700 }}
                >
                  Last
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: "MULTI-SITE" BRANCH AGING & HEALTH DASHBOARD */}
      {/* ========================================================================= */}
      {viewMode === 'multi_site' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          {/* Site Navigation Card: Region tabs & Branch Selector Chips */}
          <div className="card" style={{ padding: '18px 22px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: '12px', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)' }}>
            
            {/* Region Tabs (Metro Manila vs Provincial) */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
              <button
                type="button"
                onClick={() => {
                  setSelectedRegion('metro_manila');
                  if (metroManilaSitesList.length > 0 && !metroManilaSitesList.some(s => s.siteCode.includes(selectedSiteCode))) {
                    setSelectedSiteCode(metroManilaSitesList[0].siteCode.replace(/^(ASP|APP)\s+/, ''));
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: '220px',
                  padding: '11px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  background: selectedRegion === 'metro_manila' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : '#f8fafc',
                  color: selectedRegion === 'metro_manila' ? '#ffffff' : '#1e293b',
                  boxShadow: selectedRegion === 'metro_manila' ? '0 4px 10px rgba(2, 132, 199, 0.25)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={18} color={selectedRegion === 'metro_manila' ? '#ffffff' : '#0284c7'} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, fontSize: '13.5px' }}>Metro Manila Sites</div>
                    <div style={{ fontSize: '11.5px', opacity: 0.9 }}>{metroManilaSitesList.length} Authorized Service Points</div>
                  </div>
                </div>
                <span style={{ background: selectedRegion === 'metro_manila' ? 'rgba(255, 255, 255, 0.25)' : '#e2e8f0', color: selectedRegion === 'metro_manila' ? '#ffffff' : '#0f172a', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800 }}>
                  {metroManilaSitesList.reduce((acc, s) => acc + s.totalUnits, 0).toLocaleString()} units
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedRegion('provincial');
                  if (provincialSitesList.length > 0 && !provincialSitesList.some(s => s.siteCode.includes(selectedSiteCode))) {
                    setSelectedSiteCode(provincialSitesList[0].siteCode.replace(/^(ASP|APP)\s+/, ''));
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: '220px',
                  padding: '11px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  background: selectedRegion === 'provincial' ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : '#f8fafc',
                  color: selectedRegion === 'provincial' ? '#ffffff' : '#1e293b',
                  boxShadow: selectedRegion === 'provincial' ? '0 4px 10px rgba(217, 119, 6, 0.25)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={18} color={selectedRegion === 'provincial' ? '#ffffff' : '#d97706'} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, fontSize: '13.5px' }}>Provincial Sites</div>
                    <div style={{ fontSize: '11.5px', opacity: 0.9 }}>{provincialSitesList.length} Regional Service Points</div>
                  </div>
                </div>
                <span style={{ background: selectedRegion === 'provincial' ? 'rgba(255, 255, 255, 0.25)' : '#e2e8f0', color: selectedRegion === 'provincial' ? '#ffffff' : '#0f172a', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800 }}>
                  {provincialSitesList.reduce((acc, s) => acc + s.totalUnits, 0).toLocaleString()} units
                </span>
              </button>
            </div>

            {/* Individual Branch Selector Chips with Crisp Contrast */}
            <div style={{ paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                Select Site to View Health &amp; Inventory Aging:
              </div>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {(selectedRegion === 'metro_manila' ? metroManilaSitesList : provincialSitesList).map(site => {
                  const cleanCode = site.siteCode.replace(/^(ASP|APP)\s+/, '');
                  const isSelected = selectedSiteCode.toUpperCase() === cleanCode.toUpperCase();
                  const deadCount = site.metrics?.dcStock?.dead + site.metrics?.mspiOwned?.dead || 0;
                  const invCount = site.investigationCount || site.metrics?.segmentedLists?.investigation?.length || 0;

                  return (
                    <button
                      key={site.siteCode}
                      type="button"
                      onClick={() => setSelectedSiteCode(cleanCode)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '7px 12px',
                        borderRadius: '6px',
                        border: isSelected
                          ? (selectedRegion === 'provincial' ? '2px solid #d97706' : '2px solid #0284c7')
                          : '1.5px solid #cbd5e1',
                        background: isSelected
                          ? (selectedRegion === 'provincial' ? '#fffbeb' : '#f0f9ff')
                          : '#ffffff',
                        color: isSelected
                          ? (selectedRegion === 'provincial' ? '#92400e' : '#0369a1')
                          : '#0f172a',
                        cursor: 'pointer',
                        fontWeight: isSelected ? 800 : 600,
                        fontSize: '12.5px',
                        transition: 'all 0.1s ease'
                      }}
                    >
                      <span>{site.siteCode}</span>
                      <span
                        style={{
                          background: site.totalUnits > 0 ? (isSelected ? '#0284c7' : '#e2e8f0') : '#fee2e2',
                          color: site.totalUnits > 0 ? (isSelected ? '#ffffff' : '#0f172a') : '#dc2626',
                          borderRadius: '999px',
                          padding: '1px 6px',
                          fontSize: '11px',
                          fontWeight: 700
                        }}
                      >
                        {site.totalUnits}
                      </span>
                      {deadCount > 0 && (
                        <span
                          style={{
                            background: '#fee2e2',
                            color: '#dc2626',
                            border: '1px solid #fecdd3',
                            borderRadius: '999px',
                            padding: '1px 5px',
                            fontSize: '10px',
                            fontWeight: 800
                          }}
                          title={`${deadCount} dead stock units requiring pull-out`}
                        >
                          {deadCount} dead
                        </span>
                      )}
                      {invCount > 0 && (
                        <span
                          style={{
                            background: '#fff1f2',
                            color: '#be123c',
                            border: '1px solid #fecdd3',
                            borderRadius: '999px',
                            padding: '1px 5px',
                            fontSize: '10px',
                            fontWeight: 800
                          }}
                          title={`${invCount} serials flagged in closed repairs`}
                        >
                          {invCount} ⚠️
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Selected Site Detail Banner */}
          {currentSiteData && (
            <div className="card" style={{ padding: '18px 22px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: '12px', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <Building2 size={22} color="#0284c7" />
                    <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#0f172a' }}>
                      {currentSiteData.siteName}
                    </h3>
                    <span className="badge badge-primary" style={{ fontSize: '11.5px', fontWeight: 800 }}>
                      {currentSiteData.siteCode}
                    </span>
                    {currentSiteData.shipTo && (
                      <span className="badge" style={{ fontSize: '11.5px', background: '#e0e7ff', color: '#3730a3', fontWeight: 700, border: '1px solid #c7d2fe' }}>
                        Ship-To: {currentSiteData.shipTo}
                      </span>
                    )}
                    {currentSiteData.investigationCount > 0 && (
                      <span className="badge" style={{ fontSize: '11.5px', background: '#fff1f2', color: '#be123c', border: '1.5px solid #fecdd3', fontWeight: 800 }}>
                        ⚠️ {currentSiteData.investigationCount} Closed Repair Matches
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={14} color="#64748b" />
                    <span>{currentSiteData.address || 'Standard Authorized Service Facility'}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0f172a' }}>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>Branch Supervisor:</span>
                      <strong>{currentSiteData.supervisor}</strong>
                    </div>

                    {currentSiteData.phone && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Phone size={13} color="#0284c7" />
                        <a href={`tel:${currentSiteData.phone}`} style={{ color: '#0284c7', textDecoration: 'none', fontWeight: 700 }}>
                          {currentSiteData.phone}
                        </a>
                      </div>
                    )}

                    {currentSiteData.email && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Mail size={13} color="#0284c7" />
                        <a href={`mailto:${currentSiteData.email}`} style={{ color: '#0284c7', textDecoration: 'none', fontWeight: 700 }}>
                          {currentSiteData.email}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Action Exports for Dead Stock & Investigation */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const deadItems = currentSiteData.metrics.segmentedLists.deadStock;
                      if (deadItems.length === 0) {
                        showToast?.(`No dead stock found for ${currentSiteData.siteCode}.`, 'info');
                        return;
                      }
                      exportDeadStockToCsv(currentSiteData.items, currentSiteData.siteCode);
                      showToast?.(`Exported ${deadItems.length} dead stock items for ${currentSiteData.siteCode}`, 'success');
                    }}
                    style={{
                      fontSize: '12px',
                      padding: '8px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontWeight: 700,
                      color: '#dc2626',
                      border: '1.5px solid #f87171',
                      background: '#fff1f2',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    title="Export Dead Stock CSV for RMA logistics"
                  >
                    <Download size={13} color="#dc2626" />
                    <span>Dead Stock CSV</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      exportDeadStockToExcel(currentSiteData.items, currentSiteData.siteCode);
                      showToast?.(`Exported Dead Stock Excel workbook for ${currentSiteData.siteCode}`, 'success');
                    }}
                    style={{
                      fontSize: '12px',
                      padding: '8px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontWeight: 700,
                      color: '#ea580c',
                      border: '1.5px solid #fb923c',
                      background: '#fff7ed',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    title="Export Dead Stock Excel (.xlsx)"
                  >
                    <FileSpreadsheet size={13} color="#ea580c" />
                    <span>Dead Stock Excel</span>
                  </button>

                  {currentSiteData.investigationCount > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        exportInvestigationToExcel(currentSiteData.items, currentSiteData.siteCode);
                        showToast?.(`Exported ${currentSiteData.investigationCount} flagged items to Excel for ${currentSiteData.siteCode}`, 'success');
                      }}
                      style={{
                        fontSize: '12px',
                        padding: '8px 12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontWeight: 700,
                        color: '#be123c',
                        border: '1.5px solid #fecdd3',
                        background: '#ffe4e6',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                      title="Export items flagged in closed repairs to Excel"
                    >
                      <ShieldAlert size={13} color="#be123c" />
                      <span>Investigation XLSX</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      exportSiteToExcel(currentSiteData, snapshot.items);
                      showToast?.(`Exported complete multi-tab inventory workbook for ${currentSiteData.siteCode}`, 'success');
                    }}
                    style={{
                      fontSize: '12px',
                      padding: '8px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontWeight: 700,
                      color: '#0284c7',
                      border: '1.5px solid #0284c7',
                      background: '#f0f9ff',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    title="Export complete site inventory workbook with aging breakdown"
                  >
                    <FileSpreadsheet size={13} color="#0284c7" />
                    <span>Site XLSX</span>
                  </button>

                  {isSuperadmin && typeof clearSiteParts === 'function' && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to clear old site parts for ${currentSiteData.siteCode}?`)) {
                          clearSiteParts({ siteId: currentSiteData.siteId, siteCode: currentSiteData.siteCode });
                          showToast?.(`Cleared parts for ${currentSiteData.siteCode}`, 'info');
                        }
                      }}
                      style={{
                        fontSize: '11.5px',
                        padding: '8px 10px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontWeight: 700,
                        color: '#64748b',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                      title="Clear old parts prior to fresh intake"
                    >
                      <Trash2 size={13} color="#94a3b8" />
                      <span>Clear Site</span>
                    </button>
                  )}
                </div>

              </div>
            </div>
          )}

          {/* SITE KPI HEALTH SUMMARY TABLE (High-Contrast Header & Borders) */}
          {currentSiteData?.metrics && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1.5px solid #cbd5e1', borderRadius: '12px', background: '#ffffff', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)' }}>
              <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Boxes size={18} color="#0284c7" />
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                    Inventory Aging &amp; Health Summary ({currentSiteData.siteCode})
                  </h4>
                </div>
                <div style={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}>
                  Parity Model matching <code style={{ fontWeight: 700, color: '#0284c7' }}>SIte Stocks (Fixably).xlsx</code>
                </div>
              </div>

              <div className="table-container" style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #0284c7' }}>
                      <th style={{ minWidth: '180px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Stock Classification</th>
                      <th style={{ textAlign: 'center', background: '#0f172a', color: '#fca5a5', padding: '12px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Dead Stock (≥ 180d)</th>
                      <th style={{ textAlign: 'center', background: '#0f172a', color: '#fdba74', padding: '12px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Non-Moving (90–179d)</th>
                      <th style={{ textAlign: 'center', background: '#0f172a', color: '#fde047', padding: '12px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Slow-Moving (60–89d)</th>
                      <th style={{ textAlign: 'center', background: '#0f172a', color: '#86efac', padding: '12px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>In Stock (&lt; 60d)</th>
                      <th style={{ textAlign: 'center', fontWeight: 900, background: '#0f172a', color: '#ffffff', padding: '12px 10px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Total Units</th>
                      <th style={{ textAlign: 'center', background: '#0f172a', color: '#fca5a5', padding: '12px 10px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap' }}>Dead %</th>
                      <th style={{ textAlign: 'center', background: '#0f172a', color: '#fdba74', padding: '12px 10px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap' }}>Non-Moving %</th>
                      <th style={{ textAlign: 'center', background: '#0f172a', color: '#fde047', padding: '12px 10px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap' }}>Slow %</th>
                      <th style={{ textAlign: 'center', background: '#0f172a', color: '#86efac', padding: '12px 10px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap' }}>In Stock %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* DC Stock Row */}
                    <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ fontWeight: 800, color: '#6d28d9', padding: '12px 14px' }}>
                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#8b5cf6', marginRight: '6px' }} />
                        DC Stock
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#dc2626', background: '#fff1f2', padding: '12px 10px' }}>
                        {currentSiteData.metrics.dcStock.dead}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#ea580c', padding: '12px 10px' }}>
                        {currentSiteData.metrics.dcStock.nonMoving}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#d97706', padding: '12px 10px' }}>
                        {currentSiteData.metrics.dcStock.slow}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#16a34a', padding: '12px 10px' }}>
                        {currentSiteData.metrics.dcStock.inStock}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 900, background: '#f8fafc', color: '#0f172a', padding: '12px 10px' }}>
                        {currentSiteData.metrics.dcStock.units}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#dc2626', background: '#fff1f2', padding: '12px 10px' }}>
                        {currentSiteData.metrics.dcStock.deadPercent}
                      </td>
                      <td style={{ textAlign: 'center', color: '#ea580c', fontWeight: 600, padding: '12px 10px' }}>
                        {currentSiteData.metrics.dcStock.nonMovingPercent}
                      </td>
                      <td style={{ textAlign: 'center', color: '#d97706', fontWeight: 600, padding: '12px 10px' }}>
                        {currentSiteData.metrics.dcStock.slowPercent}
                      </td>
                      <td style={{ textAlign: 'center', color: '#16a34a', fontWeight: 700, padding: '12px 10px' }}>
                        {currentSiteData.metrics.dcStock.inStockPercent}
                      </td>
                    </tr>

                    {/* MSPI-Owned / C/I REP Row */}
                    <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1' }}>
                      <td style={{ fontWeight: 800, color: '#0369a1', padding: '12px 14px' }}>
                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#0284c7', marginRight: '6px' }} />
                        MSPI-Owned / C/I REP
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#dc2626', background: '#fff1f2', padding: '12px 10px' }}>
                        {currentSiteData.metrics.mspiOwned.dead}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#ea580c', padding: '12px 10px' }}>
                        {currentSiteData.metrics.mspiOwned.nonMoving}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#d97706', padding: '12px 10px' }}>
                        {currentSiteData.metrics.mspiOwned.slow}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#16a34a', padding: '12px 10px' }}>
                        {currentSiteData.metrics.mspiOwned.inStock}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 900, background: '#f1f5f9', color: '#0f172a', padding: '12px 10px' }}>
                        {currentSiteData.metrics.mspiOwned.units}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#dc2626', background: '#fff1f2', padding: '12px 10px' }}>
                        {currentSiteData.metrics.mspiOwned.deadPercent}
                      </td>
                      <td style={{ textAlign: 'center', color: '#ea580c', fontWeight: 600, padding: '12px 10px' }}>
                        {currentSiteData.metrics.mspiOwned.nonMovingPercent}
                      </td>
                      <td style={{ textAlign: 'center', color: '#d97706', fontWeight: 600, padding: '12px 10px' }}>
                        {currentSiteData.metrics.mspiOwned.slowPercent}
                      </td>
                      <td style={{ textAlign: 'center', color: '#16a34a', fontWeight: 700, padding: '12px 10px' }}>
                        {currentSiteData.metrics.mspiOwned.inStockPercent}
                      </td>
                    </tr>

                    {/* COMBINED TOTAL Row */}
                    <tr style={{ background: '#f1f5f9', fontWeight: 900, borderTop: '2px solid #94a3b8' }}>
                      <td style={{ color: '#0f172a', padding: '12px 14px' }}>COMBINED TOTAL</td>
                      <td style={{ textAlign: 'center', color: '#dc2626', background: '#ffe4e6', padding: '12px 10px', fontWeight: 900 }}>
                        {currentSiteData.metrics.total.dead}
                      </td>
                      <td style={{ textAlign: 'center', color: '#ea580c', padding: '12px 10px', fontWeight: 800 }}>
                        {currentSiteData.metrics.total.nonMoving}
                      </td>
                      <td style={{ textAlign: 'center', color: '#d97706', padding: '12px 10px', fontWeight: 800 }}>
                        {currentSiteData.metrics.total.slow}
                      </td>
                      <td style={{ textAlign: 'center', color: '#16a34a', padding: '12px 10px', fontWeight: 800 }}>
                        {currentSiteData.metrics.total.inStock}
                      </td>
                      <td style={{ textAlign: 'center', fontSize: '14px', color: '#0f172a', background: '#e2e8f0', padding: '12px 10px', fontWeight: 900 }}>
                        {currentSiteData.metrics.total.units}
                      </td>
                      <td style={{ textAlign: 'center', color: '#dc2626', background: '#ffe4e6', padding: '12px 10px', fontWeight: 900 }}>
                        {currentSiteData.metrics.total.deadPercent}
                      </td>
                      <td style={{ textAlign: 'center', color: '#ea580c', padding: '12px 10px', fontWeight: 700 }}>
                        {currentSiteData.metrics.total.nonMovingPercent}
                      </td>
                      <td style={{ textAlign: 'center', color: '#d97706', padding: '12px 10px', fontWeight: 700 }}>
                        {currentSiteData.metrics.total.slowPercent}
                      </td>
                      <td style={{ textAlign: 'center', color: '#16a34a', padding: '12px 10px', fontWeight: 800 }}>
                        {currentSiteData.metrics.total.inStockPercent}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SEGMENTED LISTS & SUB-TABS */}
          {currentSiteData?.metrics && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1.5px solid #cbd5e1', borderRadius: '12px', background: '#ffffff', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)' }}>
              
              {/* Segmented Sub-Tab Header */}
              <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                
                {/* Tab 1: Dead Stock */}
                <button
                  type="button"
                  onClick={() => setSegmentedTab('dead_stock')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: segmentedTab === 'dead_stock' ? 800 : 600,
                    background: segmentedTab === 'dead_stock' ? '#fff1f2' : 'transparent',
                    color: segmentedTab === 'dead_stock' ? '#dc2626' : '#64748b',
                    borderBottom: segmentedTab === 'dead_stock' ? '2px solid #dc2626' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <AlertTriangle size={13} color={segmentedTab === 'dead_stock' ? '#dc2626' : '#94a3b8'} />
                  <span>Dead Stock (≥ 180d)</span>
                  <span style={{ background: '#fecdd3', color: '#be123c', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                    {currentSiteData.metrics.segmentedLists.deadStock.length}
                  </span>
                </button>

                {/* Tab 2: Non-Moving */}
                <button
                  type="button"
                  onClick={() => setSegmentedTab('non_moving')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: segmentedTab === 'non_moving' ? 800 : 600,
                    background: segmentedTab === 'non_moving' ? '#fff7ed' : 'transparent',
                    color: segmentedTab === 'non_moving' ? '#ea580c' : '#64748b',
                    borderBottom: segmentedTab === 'non_moving' ? '2px solid #ea580c' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Clock size={13} color={segmentedTab === 'non_moving' ? '#ea580c' : '#94a3b8'} />
                  <span>Non-Moving (90–179d)</span>
                  <span style={{ background: '#fed7aa', color: '#c2410c', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                    {currentSiteData.metrics.segmentedLists.nonMoving.length}
                  </span>
                </button>

                {/* Tab 3: Slow-Moving */}
                <button
                  type="button"
                  onClick={() => setSegmentedTab('slow_moving')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: segmentedTab === 'slow_moving' ? 800 : 600,
                    background: segmentedTab === 'slow_moving' ? '#fffbeb' : 'transparent',
                    color: segmentedTab === 'slow_moving' ? '#d97706' : '#64748b',
                    borderBottom: segmentedTab === 'slow_moving' ? '2px solid #d97706' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <TrendingDown size={13} color={segmentedTab === 'slow_moving' ? '#d97706' : '#94a3b8'} />
                  <span>Slow-Moving (60–89d)</span>
                  <span style={{ background: '#fde68a', color: '#b45309', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                    {currentSiteData.metrics.segmentedLists.slowMoving.length}
                  </span>
                </button>

                {/* Tab 4: Active Stock */}
                <button
                  type="button"
                  onClick={() => setSegmentedTab('active_stock')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: segmentedTab === 'active_stock' ? 800 : 600,
                    background: segmentedTab === 'active_stock' ? '#f0fdf4' : 'transparent',
                    color: segmentedTab === 'active_stock' ? '#16a34a' : '#64748b',
                    borderBottom: segmentedTab === 'active_stock' ? '2px solid #16a34a' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <CheckCircle2 size={13} color={segmentedTab === 'active_stock' ? '#16a34a' : '#94a3b8'} />
                  <span>Active Stock (&lt; 60d)</span>
                  <span style={{ background: '#bbf7d0', color: '#15803d', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                    {currentSiteData.metrics.segmentedLists.activeStock.length}
                  </span>
                </button>

                {/* Tab 5: Dispatch / For Investigation */}
                <button
                  type="button"
                  onClick={() => setSegmentedTab('investigation')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: segmentedTab === 'investigation' ? 800 : 600,
                    background: segmentedTab === 'investigation' ? '#fff1f2' : 'transparent',
                    color: segmentedTab === 'investigation' ? '#be123c' : '#64748b',
                    borderBottom: segmentedTab === 'investigation' ? '2px solid #be123c' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <ShieldAlert size={13} color={segmentedTab === 'investigation' ? '#be123c' : '#94a3b8'} />
                  <span>Investigation / Cross-Used Serials</span>
                  <span
                    style={{
                      background: currentSiteData.metrics.segmentedLists.investigation.length > 0 ? '#fecdd3' : '#e2e8f0',
                      color: currentSiteData.metrics.segmentedLists.investigation.length > 0 ? '#be123c' : '#475569',
                      padding: '1px 6px',
                      borderRadius: '999px',
                      fontSize: '10px',
                      fontWeight: 800
                    }}
                  >
                    {currentSiteData.metrics.segmentedLists.investigation.length}
                  </span>
                </button>

                {/* Tab 6: Part Aggregations */}
                <button
                  type="button"
                  onClick={() => setSegmentedTab('part_aggregations')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: segmentedTab === 'part_aggregations' ? 800 : 600,
                    background: segmentedTab === 'part_aggregations' ? '#eff6ff' : 'transparent',
                    color: segmentedTab === 'part_aggregations' ? '#0284c7' : '#64748b',
                    borderBottom: segmentedTab === 'part_aggregations' ? '2px solid #0284c7' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Boxes size={13} color={segmentedTab === 'part_aggregations' ? '#0284c7' : '#94a3b8'} />
                  <span>Part Aggregations (On-Hand Summary)</span>
                  <span style={{ background: '#bae6fd', color: '#0369a1', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                    {currentSiteData.metrics.partAggregations.length} parts
                  </span>
                </button>

                {/* Tab 7: All Site Stock */}
                <button
                  type="button"
                  onClick={() => setSegmentedTab('all_stock')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: segmentedTab === 'all_stock' ? 800 : 600,
                    background: segmentedTab === 'all_stock' ? '#f1f5f9' : 'transparent',
                    color: segmentedTab === 'all_stock' ? '#0f172a' : '#64748b',
                    borderBottom: segmentedTab === 'all_stock' ? '2px solid #0f172a' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Layers size={13} color={segmentedTab === 'all_stock' ? '#0f172a' : '#94a3b8'} />
                  <span>All Site Stock</span>
                  <span style={{ background: '#e2e8f0', color: '#0f172a', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                    {currentSiteData.items.length} units
                  </span>
                </button>

              </div>

              {/* Tab Content Display */}
              <div className="table-container" style={{ overflowX: 'auto', maxHeight: '680px' }}>
                
                {/* 5.1 Part Aggregations View */}
                {segmentedTab === 'part_aggregations' ? (
                  <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #0284c7' }}>
                        <th style={{ minWidth: '160px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Number</th>
                        <th style={{ minWidth: '240px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Description</th>
                        <th style={{ textAlign: 'center', width: '150px', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Total Serials</th>
                        <th style={{ textAlign: 'center', width: '110px', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>DC Stock</th>
                        <th style={{ textAlign: 'center', width: '110px', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>MSPI-Owned</th>
                        <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Aging Breakdown</th>
                        <th style={{ textAlign: 'center', width: '120px', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentSiteData.metrics.partAggregations.map((partRow, pIdx) => {
                        const isExpanded = expandedPartPn === partRow.partNumber;
                        const isEven = pIdx % 2 === 1;

                        return (
                          <React.Fragment key={partRow.partNumber}>
                            <tr
                              style={{
                                borderBottom: isExpanded ? 'none' : '1px solid #e2e8f0',
                                background: isExpanded ? '#f0f9ff' : isEven ? '#f8fafc' : '#ffffff'
                              }}
                            >
                              <td style={{ verticalAlign: 'middle', padding: '11px 14px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <strong style={{ color: '#0284c7', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 800 }}>
                                    {partRow.partNumber}
                                  </strong>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(partRow.partNumber, 'Part Number')}
                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
                                  >
                                    <Copy size={12} />
                                  </button>
                                </div>
                              </td>

                              <td style={{ verticalAlign: 'middle', fontWeight: 600, color: '#0f172a', padding: '11px 14px' }}>
                                {partRow.partDescription}
                              </td>

                              <td style={{ textAlign: 'center', verticalAlign: 'middle', padding: '11px 10px' }}>
                                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '999px', fontWeight: 800, fontSize: '12px', border: '1px solid #7dd3fc' }}>
                                  {partRow.totalSerialsOnHand} UNITS
                                </span>
                              </td>

                              <td style={{ textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#6d28d9', padding: '11px 10px' }}>
                                {partRow.dcStockCount}
                              </td>

                              <td style={{ textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#0369a1', padding: '11px 10px' }}>
                                {partRow.mspiCount}
                              </td>

                              <td style={{ verticalAlign: 'middle', padding: '11px 14px' }}>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                  {partRow.deadCount > 0 && (
                                    <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fecdd3', fontSize: '10.5px', fontWeight: 800 }}>
                                      {partRow.deadCount} Dead
                                    </span>
                                  )}
                                  {partRow.nonMovingCount > 0 && (
                                    <span className="badge" style={{ background: '#ffedd5', color: '#ea580c', border: '1px solid #fed7aa', fontSize: '10.5px', fontWeight: 800 }}>
                                      {partRow.nonMovingCount} Non-Moving
                                    </span>
                                  )}
                                  {partRow.slowCount > 0 && (
                                    <span className="badge" style={{ background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a', fontSize: '10.5px', fontWeight: 800 }}>
                                      {partRow.slowCount} Slow
                                    </span>
                                  )}
                                  {partRow.inStockCount > 0 && (
                                    <span className="badge" style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', fontSize: '10.5px', fontWeight: 800 }}>
                                      {partRow.inStockCount} Active
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td style={{ textAlign: 'center', verticalAlign: 'middle', padding: '11px 10px' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => setExpandedPartPn(isExpanded ? null : partRow.partNumber)}
                                  style={{
                                    fontSize: '11.5px',
                                    padding: '5px 12px',
                                    fontWeight: 800,
                                    color: isExpanded ? '#dc2626' : '#0284c7',
                                    background: isExpanded ? '#fff1f2' : '#ffffff',
                                    border: isExpanded ? '1.5px solid #fecdd3' : '1.5px solid #0284c7',
                                    borderRadius: '6px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  {isExpanded ? 'Hide Serials' : `Serials (${partRow.serials.length})`}
                                </button>
                              </td>
                            </tr>

                            {/* Expanded serial listing row */}
                            {isExpanded && (
                              <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1' }}>
                                <td colSpan={7} style={{ padding: '14px 20px' }}>
                                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#334155', marginBottom: '8px' }}>
                                    Serials in Stock for {partRow.partNumber} ({partRow.serials.length} units):
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {currentSiteData.items
                                      .filter(it => it.partNumber === partRow.partNumber)
                                      .map((unit, sIdx) => (
                                        <div
                                          key={`${unit.serialNumber}-${sIdx}`}
                                          style={{
                                            background: '#ffffff',
                                            border: unit.isInvestigation ? '1.5px solid #f87171' : '1.5px solid #cbd5e1',
                                            borderRadius: '6px',
                                            padding: '4px 8px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            fontSize: '12px'
                                          }}
                                        >
                                          <code style={{ color: unit.isInvestigation ? '#be123c' : '#0f172a', fontWeight: 800 }}>
                                            {unit.serialNumber || 'NON-SERIALIZED'}
                                          </code>
                                          <span style={{ fontSize: '10.5px', padding: '1px 5px', borderRadius: '4px', background: unit.badgeBg, color: unit.badgeColor, fontWeight: 800 }}>
                                            {unit.agingDays}d
                                          </span>
                                          {unit.isInvestigation && (
                                            <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: '#ffe4e6', color: '#9f1239', fontWeight: 800 }}>
                                              KGB Used
                                            </span>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => handleCopy(unit.serialNumber, 'Serial')}
                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '1px' }}
                                            title="Copy serial"
                                          >
                                            <Copy size={11} />
                                          </button>
                                        </div>
                                      ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                ) : segmentedTab === 'investigation' ? (
                  /* 5.2 Dedicated Dispatch / For Investigation Tab */
                  (() => {
                    const invList = currentSiteData.metrics.segmentedLists.investigation;

                    if (invList.length === 0) {
                      return (
                        <div style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>
                          <CheckCircle2 size={36} color="#10b981" style={{ margin: '0 auto 8px' }} />
                          <h4 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: '16px', fontWeight: 800 }}>
                            No Dispatched / Closed GSX Contradictions for {currentSiteData.siteCode}
                          </h4>
                          <p style={{ margin: 0, fontSize: '13px' }}>
                            None of the on-hand units at this site match repairs in the KGB Used Report. All serials are verified clean.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div>
                        {/* Sub-header with export actions */}
                        <div style={{ padding: '12px 18px', background: '#fff1f2', borderBottom: '1.5px solid #fecdd3', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ShieldAlert size={18} color="#be123c" />
                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#be123c' }}>
                              {invList.length} Units Flagged in Closed GSX Repairs (Investigation Required)
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => exportInvestigationToCsv(currentSiteData.items, currentSiteData.siteCode)}
                              style={{
                                fontSize: '11.5px',
                                padding: '5px 12px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                fontWeight: 700,
                                color: '#be123c',
                                background: '#ffffff',
                                border: '1.5px solid #fecdd3',
                                borderRadius: '5px',
                                cursor: 'pointer'
                              }}
                            >
                              <Download size={12} color="#be123c" />
                              <span>Export Investigation CSV</span>
                            </button>

                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => exportInvestigationToExcel(currentSiteData.items, currentSiteData.siteCode)}
                              style={{
                                fontSize: '11.5px',
                                padding: '5px 12px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                fontWeight: 700,
                                color: '#be123c',
                                background: '#ffffff',
                                border: '1.5px solid #fecdd3',
                                borderRadius: '5px',
                                cursor: 'pointer'
                              }}
                            >
                              <FileSpreadsheet size={12} color="#be123c" />
                              <span>Export Investigation Excel</span>
                            </button>
                          </div>
                        </div>

                        <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid #0284c7' }}>
                              <th style={{ width: '45px', textAlign: 'center', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>#</th>
                              <th style={{ minWidth: '150px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Number</th>
                              <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Description</th>
                              <th style={{ minWidth: '170px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Transferred Serial</th>
                              <th style={{ width: '120px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Stock Type</th>
                              <th style={{ minWidth: '130px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Order Number</th>
                              <th style={{ width: '120px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Closed Date</th>
                              <th style={{ minWidth: '180px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Used By (Location)</th>
                              <th style={{ width: '100px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>GSX Status</th>
                              <th style={{ width: '110px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Last Received</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invList.map((unit, uIdx) => (
                              <tr key={unit.id} style={{ borderBottom: '1px solid #e2e8f0', background: '#fff5f5' }}>
                                <td style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', fontWeight: 700, verticalAlign: 'middle', padding: '11px 10px' }}>
                                  {uIdx + 1}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '11px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <strong style={{ color: '#0284c7', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 800 }}>{unit.partNumber}</strong>
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(unit.partNumber, 'Part Number')}
                                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
                                    >
                                      <Copy size={12} />
                                    </button>
                                  </div>
                                </td>

                                <td style={{ verticalAlign: 'middle', fontWeight: 600, color: '#0f172a', padding: '11px 12px' }}>
                                  {unit.description}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '11px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <code style={{ fontSize: '12px', color: '#9f1239', background: '#ffe4e6', border: '1.5px solid #fecdd3', padding: '3px 8px', borderRadius: '5px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                                      {unit.serialNumber}
                                    </code>
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(unit.serialNumber, 'Serial')}
                                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
                                      title="Copy Serial Number"
                                    >
                                      <Copy size={12} />
                                    </button>
                                  </div>
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '11px 12px' }}>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '3px 8px',
                                      borderRadius: '6px',
                                      fontSize: '11px',
                                      fontWeight: 800,
                                      background: unit.stockType === 'DC Stock' ? '#ede9fe' : '#e0f2fe',
                                      color: unit.stockType === 'DC Stock' ? '#6d28d9' : '#0369a1',
                                      border: unit.stockType === 'DC Stock' ? '1.5px solid #c4b5fd' : '1.5px solid #7dd3fc'
                                    }}
                                  >
                                    {unit.stockType}
                                  </span>
                                </td>

                                <td style={{ verticalAlign: 'middle', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)', padding: '11px 12px' }}>
                                  {unit.investigationDetails?.orderId || '—'}
                                </td>

                                <td style={{ verticalAlign: 'middle', fontSize: '12.5px', color: '#1e293b', fontWeight: 600, padding: '11px 12px' }}>
                                  {unit.investigationDetails?.repairClosedDate || '—'}
                                </td>

                                <td style={{ verticalAlign: 'middle', fontSize: '12.5px', color: '#0f172a', fontWeight: 700, padding: '11px 12px' }}>
                                  {unit.investigationDetails?.locationName || currentSiteData.siteName}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '11px 12px' }}>
                                  <span className="badge" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', fontSize: '11px', fontWeight: 800 }}>
                                    {unit.investigationDetails?.gsxStatus || 'SCOM'}
                                  </span>
                                </td>

                                <td style={{ verticalAlign: 'middle', fontSize: '12.5px', color: '#475569', fontWeight: 600, padding: '11px 12px' }}>
                                  {unit.lastReceivedDate || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()
                ) : (
                  /* 5.3 Segmented Lists View (Dead Stock, Non-Moving, Slow-Moving, Active Stock, All Stock) */
                  (() => {
                    const activeList =
                      segmentedTab === 'dead_stock'
                        ? currentSiteData.metrics.segmentedLists.deadStock
                        : segmentedTab === 'non_moving'
                        ? currentSiteData.metrics.segmentedLists.nonMoving
                        : segmentedTab === 'slow_moving'
                        ? currentSiteData.metrics.segmentedLists.slowMoving
                        : segmentedTab === 'active_stock'
                        ? currentSiteData.metrics.segmentedLists.activeStock
                        : currentSiteData.items;

                    if (activeList.length === 0) {
                      return (
                        <div style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>
                          <CheckCircle2 size={36} color="#10b981" style={{ margin: '0 auto 8px' }} />
                          <h4 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: '16px', fontWeight: 800 }}>
                            No Items in this Aging Bracket
                          </h4>
                          <p style={{ margin: 0, fontSize: '13px' }}>
                            {currentSiteData.siteCode} has 0 parts classified in this bracket.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #0284c7' }}>
                            <th style={{ width: '50px', textAlign: 'center', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>#</th>
                            <th style={{ minWidth: '150px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Number</th>
                            <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Description</th>
                            <th style={{ width: '130px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Classification</th>
                            <th style={{ minWidth: '175px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Serial Number</th>
                            <th style={{ width: '120px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Last Received</th>
                            <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Aging &amp; Status</th>
                            <th style={{ width: '110px', textAlign: 'right', padding: '12px 16px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeList.map((unit, uIdx) => {
                            const isEven = uIdx % 2 === 1;

                            return (
                              <tr
                                key={unit.id}
                                style={{
                                  borderBottom: '1px solid #e2e8f0',
                                  background: isEven ? '#f8fafc' : '#ffffff',
                                  transition: 'background-color 0.1s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = '#e0f2fe';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = isEven ? '#f8fafc' : '#ffffff';
                                }}
                              >
                                <td style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', fontWeight: 700, verticalAlign: 'middle', padding: '12px 10px', whiteSpace: 'nowrap' }}>
                                  {uIdx + 1}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: '#0284c7', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '13px', fontWeight: 700 }}>{unit.partNumber}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(unit.partNumber, 'Part Number')}
                                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                                    >
                                      <Copy size={12} />
                                    </button>
                                  </div>
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px' }}>
                                  <div style={{ color: '#0f172a', fontWeight: 500, fontSize: '13px', lineHeight: 1.4, minWidth: '220px' }}>
                                    {unit.description}
                                  </div>
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '5px',
                                      padding: '3px 9px',
                                      borderRadius: '6px',
                                      fontSize: '11px',
                                      fontWeight: 700,
                                      whiteSpace: 'nowrap',
                                      background: unit.stockType === 'DC Stock' ? '#f5f3ff' : '#f0f9ff',
                                      color: unit.stockType === 'DC Stock' ? '#6d28d9' : '#0369a1',
                                      border: unit.stockType === 'DC Stock' ? '1px solid #ddd6fe' : '1px solid #bae6fd'
                                    }}
                                  >
                                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: unit.stockType === 'DC Stock' ? '#8b5cf6' : '#0284c7' }} />
                                    {unit.stockType}
                                  </span>
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  {unit.serialNumber ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{
                                        fontSize: '12px',
                                        color: '#0f172a',
                                        background: '#f8fafc',
                                        border: '1px solid #e2e8f0',
                                        padding: '3px 8px',
                                        borderRadius: '5px',
                                        fontWeight: 600,
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                        letterSpacing: '0.02em'
                                      }}>
                                        {unit.serialNumber}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(unit.serialNumber, 'Serial')}
                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                                      >
                                        <Copy size={12} />
                                      </button>
                                    </div>
                                  ) : (
                                    <span style={{ color: '#94a3b8', fontSize: '11.5px', fontStyle: 'italic' }}>Non-serialized</span>
                                  )}
                                </td>

                                <td style={{ verticalAlign: 'middle', fontSize: '12.5px', color: '#475569', fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  {unit.lastReceivedDate || '—'}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        padding: '3px 9px',
                                        borderRadius: '6px',
                                        fontSize: '11.5px',
                                        fontWeight: 700,
                                        whiteSpace: 'nowrap',
                                        background: unit.badgeBg,
                                        color: unit.badgeColor,
                                        border: unit.agingBracket === AGING_BRACKETS.DEAD_STOCK ? '1px solid #fca5a5'
                                          : unit.agingBracket === AGING_BRACKETS.NON_MOVING ? '1px solid #fdba74'
                                          : unit.agingBracket === AGING_BRACKETS.SLOW_MOVING ? '1px solid #fde047'
                                          : '1px solid #86efac'
                                      }}
                                      title={unit.statusLabel}
                                    >
                                      {unit.agingBracket === AGING_BRACKETS.DEAD_STOCK && <AlertTriangle size={12} color="#dc2626" />}
                                      {unit.agingBracket === AGING_BRACKETS.NON_MOVING && <Clock size={12} color="#ea580c" />}
                                      {unit.agingBracket === AGING_BRACKETS.SLOW_MOVING && <TrendingDown size={12} color="#d97706" />}
                                      {unit.agingBracket === AGING_BRACKETS.IN_STOCK && <CheckCircle2 size={12} color="#16a34a" />}
                                      <span>
                                        {unit.agingBracket === AGING_BRACKETS.DEAD_STOCK
                                          ? `Dead Stock (${unit.agingDays}d)`
                                          : unit.agingBracket === AGING_BRACKETS.NON_MOVING
                                          ? `Non-Moving (${unit.agingDays}d)`
                                          : unit.agingBracket === AGING_BRACKETS.SLOW_MOVING
                                          ? `Slow-Moving (${unit.agingDays}d)`
                                          : `In Stock (${unit.agingDays}d)`}
                                      </span>
                                    </span>

                                    {unit.agingBracket === AGING_BRACKETS.DEAD_STOCK && (
                                      <span
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          fontSize: '10px',
                                          fontWeight: 800,
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.04em',
                                          background: '#fee2e2',
                                          color: '#b91c1c',
                                          border: '1px solid #fca5a5',
                                          whiteSpace: 'nowrap'
                                        }}
                                        title="Action Required: RMA pull-out or site reallocation"
                                      >
                                        Action Req.
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td style={{ verticalAlign: 'middle', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '13px', color: '#0f172a', padding: '12px 16px', whiteSpace: 'nowrap' }}>
                                  ${(unit.totalValue || unit.partValue || 0).toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  })()
                )}

              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
