import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { resolveSite, getCleanDisplaySerial } from '../utils/appContextHelpers';
import { getCategoryForPart } from '../utils/categoryFilter';
import { exportSiteStockMonitoringToExcel } from '../utils/stockExportUtils';
import {
  parseScanInPartsFile,
  parseSiteStockMonitoringWorkbook,
  downloadSiteStockMonitoringTemplate
} from '../utils/excelParser';
import {
  FileSpreadsheet,
  Package,
  Wrench,
  ArrowRightLeft,
  LogOut,
  Boxes,
  Search,
  Download,
  UploadCloud,
  CheckCircle2,
  RotateCcw,
  X,
  Building2,
  Trash2,
  AlertTriangle,
  RefreshCw,
  LayoutGrid,
  Copy,
  Check,
  Globe,
  Info,
  Filter
} from 'lucide-react';

const INITIAL_GRID_ROW_LIMIT = 100;

export default function SiteStockMonitoring({ initialSiteId = null }) {
  const {
    currentUser,
    sites = [],
    parts = [],
    inventoryUnits = [],
    isInventoryLoaded = true,
    isAutoRefreshing = false,
    cloudSyncStatus,
    getSiteMonitoringData,
    markUnitAsUsed,
    unmarkUnitAsUsed,
    markUnitForOuttake,
    unmarkUnitForOuttake,
    transferUnitToSite,
    unmarkUnitTransfer,
    batchAddScanInUnits,
    clearSiteParts,
    showToast
  } = useApp();

  const isSuperadmin = currentUser?.role === 'superadmin' || currentUser?.role === 'SUPERADMIN';
  const isPmgUser = currentUser?.role === 'parts_management';
  const isAdmin = isSuperadmin || currentUser?.role === 'admin' || currentUser?.isSuperAdmin;
  const canRestore = isAdmin;

  // Resolve user site object
  const userSiteObj = useMemo(() => {
    return resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
  }, [sites, currentUser]);

  const branchSitesCount = useMemo(() => (sites || []).filter(s => !s.is_dc && s.is_active !== false).length, [sites]);

  // Selected site for monitoring
  const [selectedSiteId, setSelectedSiteId] = useState(() => {
    if (!isSuperadmin && userSiteObj?.id) return userSiteObj.id;
    if (initialSiteId) return initialSiteId;
    return userSiteObj?.id || sites[0]?.id || 'ALL';
  });

  // Track parent initialSiteId changes without overriding user selections
  const prevInitialSiteIdRef = useRef(initialSiteId);
  useEffect(() => {
    if (!isSuperadmin && userSiteObj?.id) {
      if (selectedSiteId !== userSiteObj.id) {
        setSelectedSiteId(userSiteObj.id);
      }
      return;
    }
    if (initialSiteId && initialSiteId !== prevInitialSiteIdRef.current) {
      prevInitialSiteIdRef.current = initialSiteId;
      setSelectedSiteId(initialSiteId);
    } else if (!selectedSiteId && userSiteObj?.id) {
      setSelectedSiteId(userSiteObj.id);
    }
  }, [initialSiteId, userSiteObj?.id, selectedSiteId, isSuperadmin]);

  const activeSiteObj = useMemo(() => {
    if (selectedSiteId === 'ALL') {
      return { id: 'ALL', code: 'ALL', name: 'All Retail Branches' };
    }
    return sites.find(s => s.id === selectedSiteId || s.code === selectedSiteId) || userSiteObj;
  }, [sites, selectedSiteId, userSiteObj]);

  // View layout: 'grid' (All 5 sections side-by-side / sheet layout) | 'stock' | 'used' | 'outtake' | 'transferred' | 'summary'
  const [viewSection, setViewSection] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [copiedSerial, setCopiedSerial] = useState(null);

  // Spreadsheet Grid Horizontal Section Navigation Refs
  const gridScrollContainerRef = useRef(null);
  const sectionStockRef = useRef(null);
  const sectionUsedRef = useRef(null);
  const sectionOuttakeRef = useRef(null);
  const sectionTransferredRef = useRef(null);
  const sectionSummaryRef = useRef(null);

  const scrollToSection = (sec) => {
    let target = null;
    if (sec === 'stock') target = sectionStockRef.current;
    else if (sec === 'used') target = sectionUsedRef.current;
    else if (sec === 'outtake') target = sectionOuttakeRef.current;
    else if (sec === 'transferred') target = sectionTransferredRef.current;
    else if (sec === 'summary') target = sectionSummaryRef.current;

    if (target && gridScrollContainerRef.current) {
      const left = target.offsetLeft;
      gridScrollContainerRef.current.scrollTo({ left: Math.max(0, left - 10), behavior: 'smooth' });
    }
  };

  const handleCopySerial = (serial, unit) => {
    if (!serial && !unit) return;
    const clean = getCleanDisplaySerial(serial, unit).trim().toUpperCase();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clean);
    } else {
      const ta = document.createElement('textarea');
      ta.value = clean;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedSerial(clean);
    setTimeout(() => {
      setCopiedSerial(prev => prev === clean ? null : prev);
    }, 1800);
  };

  // Modals state
  const [isMarkUsedOpen, setIsMarkUsedOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isOuttakeOpen, setIsOuttakeOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isClearPartsOpen, setIsClearPartsOpen] = useState(false);
  const [clearPartsScope, setClearPartsScope] = useState('CURRENT'); // 'CURRENT' | 'ALL'
  const [isClearingParts, setIsClearingParts] = useState(false);
  const [clearBeforeImport, setClearBeforeImport] = useState(false);

  // Form states
  const [selectedUnitSerial, setSelectedUnitSerial] = useState('');
  const [markUsedDate, setMarkUsedDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [markUsedOrderNumber, setMarkUsedOrderNumber] = useState('');
  const [markUsedNotes, setMarkUsedNotes] = useState('');

  const [transferTargetSiteId, setTransferTargetSiteId] = useState('');
  const [transferSlipNumber, setTransferSlipNumber] = useState('');
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [transferNotes, setTransferNotes] = useState('');

  const [outtakeReason, setOuttakeReason] = useState('Return to DC / Apple');
  const [outtakeNotes, setOuttakeNotes] = useState('');

  // Import state
  const [importParsedBatch, setImportParsedBatch] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({
    active: false,
    stage: '',
    detail: '',
    percent: 0,
    current: 0,
    total: 0
  });
  const isSubmittingImportRef = useRef(false);
  const [importSelectedSheet, setImportSelectedSheet] = useState('');
  const fileInputRef = useRef(null);

  // Helper to resolve human-readable site location code for any unit
  const getUnitSiteCode = useCallback((unit) => {
    if (!unit) return '';
    if (unit.site_code && unit.site_code !== 'ALL') return unit.site_code;
    const sId = unit.current_site_id || unit.site_id || unit.siteId;
    if (sId && sId !== 'ALL') {
      const s = sites.find(site => site.id === sId || site.code === sId);
      if (s?.code) return s.code;
    }
    if (unit.site_name && unit.site_name !== 'All Retail Branches' && unit.site_name !== 'ALL') return unit.site_name;
    if (activeSiteObj && activeSiteObj.code && activeSiteObj.code !== 'ALL') return activeSiteObj.code;
    return 'BRANCH';
  }, [sites, activeSiteObj]);

  // Total branch units across all 26 retail sites (excluding Central DC)
  const allBranchUnitsCount = useMemo(() => {
    let deletedSerialsSet = new Set();
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      if (Array.isArray(localDeleted)) {
        deletedSerialsSet = new Set(localDeleted.map(s => String(s).trim().toUpperCase()));
      }
    } catch (e) {}

    return (inventoryUnits || []).filter(u => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s && deletedSerialsSet.has(s)) return false;
      if (u.status === 'packed' || u.status === 'draft') return false;
      const sId = String(u.current_site_id || u.site_id || u.siteId || '').toLowerCase();
      const sCode = String(u.site_code || u.siteCode || '').toUpperCase();
      return sId !== 'site-dc' && sCode !== 'DC-MDC' && sCode !== 'DC' && !u.is_dc;
    }).length;
  }, [inventoryUnits]);

  // Get live data for active site
  const siteData = useMemo(() => {
    if (typeof getSiteMonitoringData === 'function') {
      return getSiteMonitoringData(activeSiteObj.id);
    }
    let deletedSerialsSet = new Set();
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      if (Array.isArray(localDeleted)) {
        deletedSerialsSet = new Set(localDeleted.map(s => String(s).trim().toUpperCase()));
      }
    } catch (e) {}

    const units = (inventoryUnits || []).filter(u => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s && deletedSerialsSet.has(s)) return false;
      if (u.status === 'packed' || u.status === 'draft') return false;
      const isDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code && u.is_dc);
      if (activeSiteObj.id === 'ALL' && isDc) return false;
      if (activeSiteObj.id !== 'ALL') {
        const uSite = String(u.current_site_id || u.siteId || '').toLowerCase();
        const uCode = String(u.site_code || u.siteCode || '').toUpperCase();
        const uName = String(u.site_name || u.siteName || '').toLowerCase();
        const aId = String(activeSiteObj.id || '').toLowerCase();
        const aCode = String(activeSiteObj.code || '').toUpperCase();
        const aName = String(activeSiteObj.name || '').toLowerCase();
        return (aId && uSite === aId) ||
               (aCode && uCode === aCode) ||
               (aCode && uSite === aCode.toLowerCase()) ||
               (aId && uCode.toLowerCase() === aId) ||
               (aName && uName && (uName.includes(aName) || aName.includes(uName)));
      }
      return true;
    });

    const inStock = units.filter(u => u.status === 'in_stock' || !u.status);
    const used = units.filter(u => u.status === 'used');
    const outtake = units.filter(u => u.status === 'outtake' || u.status === 'for_outtake');
    const transferred = units.filter(u => u.status === 'transferred');

    const sumMap = new Map();
    units.forEach(u => {
      const pn = String(u.part_number || '').toUpperCase();
      if (!pn) return;
      if (!sumMap.has(pn)) {
        sumMap.set(pn, {
          partNumber: pn,
          description: u.description || '',
          inStockCount: 0,
          usedCount: 0,
          outtakeCount: 0,
          transferredCount: 0,
          totalCount: 0
        });
      }
      const e = sumMap.get(pn);
      e.totalCount++;
      if (u.status === 'in_stock' || !u.status) e.inStockCount++;
      else if (u.status === 'used') e.usedCount++;
      else if (u.status === 'outtake' || u.status === 'for_outtake') e.outtakeCount++;
      else if (u.status === 'transferred') e.transferredCount++;
    });

    return {
      siteId: activeSiteObj.id,
      siteCode: activeSiteObj.code,
      siteName: activeSiteObj.name,
      inStock,
      used,
      outtake,
      transferred,
      stockSummary: Array.from(sumMap.values()).sort((a, b) => b.inStockCount - a.inStockCount),
      kpi: {
        inStockCount: inStock.length,
        usedCount: used.length,
        outtakeCount: outtake.length,
        transferredCount: transferred.length,
        totalCount: units.length,
        skuCount: sumMap.size
      }
    };
  }, [getSiteMonitoringData, activeSiteObj, inventoryUnits]);

  const isSyncing = Boolean(
    isAutoRefreshing ||
    !isInventoryLoaded ||
    (cloudSyncStatus?.isSaving && siteData.kpi.totalCount < 100)
  );

  const isPartialDataDuringSync = Boolean(
    isSyncing && siteData.kpi.totalCount < 100
  );

  // Robust part description resolver
  const getPartDescription = useCallback((pn, fallbackDesc) => {
    if (fallbackDesc && fallbackDesc !== 'Replacement Part') return fallbackDesc;
    const clean = String(pn || '').trim().toUpperCase();
    const p = parts.find(it => String(it.part_number || it.partNumber || '').trim().toUpperCase() === clean);
    return p?.description || fallbackDesc || '';
  }, [parts]);

  // Filtering helper
  const filterList = useCallback((items) => {
    if (!items || !Array.isArray(items)) return [];
    const qRaw = searchQuery.toLowerCase().trim();
    const qClean = qRaw.replace(/[^a-z0-9]/gi, '');

    return items.filter(item => {
      // 1. Category Filter
      if (categoryFilter !== 'ALL') {
        const rawPN = item.part_number || item.partNumber || '';
        const cat = getCategoryForPart(rawPN, parts);
        if (categoryFilter === 'cat-display' && !cat.includes('display')) return false;
        if (categoryFilter === 'cat-battery' && !cat.includes('battery')) return false;
      }

      // 2. Search Query Matching
      if (qRaw) {
        const pn = String(item.part_number || item.partNumber || '').toLowerCase();
        const pnClean = pn.replace(/[^a-z0-9]/gi, '');
        const desc = String(item.description || getPartDescription(pn, '') || '').toLowerCase();
        const sn = String(item.serial_number || item.serialNumber || '').toLowerCase();
        const snClean = sn.replace(/[^a-z0-9]/gi, '');
        const rem = String(item.remarks || item.notes || item.work_order_number || item.transfer_slip_number || item.outtake_reason || '').toLowerCase();
        const site = String(item.site_code || item.siteCode || item.site_name || item.siteName || '').toLowerCase();

        // Direct substring check
        if (pn.includes(qRaw) || desc.includes(qRaw) || sn.includes(qRaw) || rem.includes(qRaw) || site.includes(qRaw)) {
          return true;
        }

        // Normalized alphanumeric check (handles missing hyphens/spaces like "66121991" or partial serials)
        if (qClean && qClean.length >= 3) {
          if (pnClean.includes(qClean) || snClean.includes(qClean)) {
            return true;
          }
        }
        return false;
      }
      return true;
    });
  }, [categoryFilter, parts, searchQuery, getPartDescription]);

  const filteredInStock = useMemo(() => filterList(siteData.inStock), [filterList, siteData.inStock]);
  const filteredUsed = useMemo(() => filterList(siteData.used), [filterList, siteData.used]);
  const filteredOuttake = useMemo(() => filterList(siteData.outtake), [filterList, siteData.outtake]);
  const filteredTransferred = useMemo(() => filterList(siteData.transferred), [filterList, siteData.transferred]);

  const filteredSummary = useMemo(() => {
    const list = siteData.stockSummary || [];
    const qRaw = searchQuery.toLowerCase().trim();
    const qClean = qRaw.replace(/[^a-z0-9]/gi, '');

    // Collect part numbers from all units that matched the search in other sections
    const matchingUnitPartNumbers = new Set();
    if (qRaw) {
      filteredInStock.forEach(u => matchingUnitPartNumbers.add(String(u.part_number || u.partNumber || '').toUpperCase()));
      filteredUsed.forEach(u => matchingUnitPartNumbers.add(String(u.part_number || u.partNumber || '').toUpperCase()));
      filteredOuttake.forEach(u => matchingUnitPartNumbers.add(String(u.part_number || u.partNumber || '').toUpperCase()));
      filteredTransferred.forEach(u => matchingUnitPartNumbers.add(String(u.part_number || u.partNumber || '').toUpperCase()));
    }

    return list.filter(item => {
      const rawPN = item.partNumber || item.part_number || '';
      const pnUpper = String(rawPN).toUpperCase();

      if (categoryFilter !== 'ALL') {
        const cat = getCategoryForPart(rawPN, parts);
        if (categoryFilter === 'cat-display' && !cat.includes('display')) return false;
        if (categoryFilter === 'cat-battery' && !cat.includes('battery')) return false;
      }
      if (qRaw) {
        // If this part number had matching serials in any section, include it in summary
        if (matchingUnitPartNumbers.has(pnUpper)) return true;

        const pn = String(rawPN).toLowerCase();
        const pnClean = pn.replace(/[^a-z0-9]/gi, '');
        const desc = String(item.description || getPartDescription(rawPN, '') || '').toLowerCase();
        const site = String(item.siteCode || item.site_code || '').toLowerCase();

        if (pn.includes(qRaw) || desc.includes(qRaw) || site.includes(qRaw)) return true;
        if (qClean && qClean.length >= 3 && pnClean.includes(qClean)) return true;

        return false;
      }
      return true;
    });
  }, [siteData.stockSummary, searchQuery, categoryFilter, parts, filteredInStock, filteredUsed, filteredOuttake, filteredTransferred, getPartDescription]);

  // Check if active query matches items in OTHER retail branches when a specific site is selected (Superadmin only)
  const crossBranchMatchCount = useMemo(() => {
    if (!isSuperadmin || !searchQuery || selectedSiteId === 'ALL') return 0;
    const qRaw = searchQuery.toLowerCase().trim();
    const qClean = qRaw.replace(/[^a-z0-9]/gi, '');
    if (!qClean && !qRaw) return 0;

    const currentSiteIdLower = String(activeSiteObj.id || '').toLowerCase();
    const currentSiteCodeUpper = String(activeSiteObj.code || '').toUpperCase();

    // Check all non-DC inventory units
    return (inventoryUnits || []).filter(u => {
      const sId = String(u.current_site_id || u.site_id || u.siteId || '').toLowerCase();
      const sCode = String(u.site_code || u.siteCode || '').toUpperCase();
      if (sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || u.is_dc) return false;

      // Skip current site
      if (sId === currentSiteIdLower || sCode === currentSiteCodeUpper) return false;

      const pn = String(u.part_number || '').toLowerCase();
      const pnClean = pn.replace(/[^a-z0-9]/gi, '');
      const desc = String(u.description || getPartDescription(u.part_number, '') || '').toLowerCase();
      const sn = String(u.serial_number || '').toLowerCase();
      const snClean = sn.replace(/[^a-z0-9]/gi, '');
      const rem = String(u.remarks || u.notes || u.work_order_number || u.transfer_slip_number || '').toLowerCase();
      const site = String(u.site_code || u.site_name || '').toLowerCase();

      if (pn.includes(qRaw) || desc.includes(qRaw) || sn.includes(qRaw) || rem.includes(qRaw) || site.includes(qRaw)) return true;
      if (qClean && qClean.length >= 3 && (pnClean.includes(qClean) || snClean.includes(qClean))) return true;
      return false;
    }).length;
  }, [isSuperadmin, searchQuery, selectedSiteId, activeSiteObj, inventoryUnits, getPartDescription]);

  // Export handler
  const handleExportXLSX = async () => {
    try {
      await exportSiteStockMonitoringToExcel({
        siteCode: activeSiteObj.code,
        siteName: activeSiteObj.name,
        inStockUnits: siteData.inStock,
        usedUnits: siteData.used,
        outtakeUnits: siteData.outtake,
        transferredUnits: siteData.transferred,
        stockSummary: siteData.stockSummary
      });
      showToast?.(`Exported ${activeSiteObj.code} Site Stock Monitoring spreadsheet (.xlsx)`, 'success');
    } catch (err) {
      console.error('Export error:', err);
      showToast?.('Failed to export monitoring spreadsheet: ' + err.message, 'error');
    }
  };

  // Submit Mark as Used
  const handleConfirmMarkUsed = async (e) => {
    e.preventDefault();
    if (!selectedUnitSerial) {
      showToast?.('Please select or specify a part serial number.', 'error');
      return;
    }
    const serial = selectedUnitSerial;
    const orderNo = markUsedOrderNumber;
    const notesVal = markUsedNotes;
    const usedDateVal = markUsedDate;

    // Locate matching unit in site stock to forward part number
    const inStockUnit = siteData?.inStock?.find(u => String(u.serial_number || '').trim().toUpperCase() === String(serial).trim().toUpperCase());
    const partNo = inStockUnit?.part_number;

    // Instant close and reset
    setIsMarkUsedOpen(false);
    setSelectedUnitSerial('');
    setMarkUsedOrderNumber('');
    setMarkUsedNotes('');
    setMarkUsedDate(new Date().toISOString().substring(0, 10));

    const res = await markUnitAsUsed({
      serialNumber: serial,
      partNumber: partNo,
      siteId: activeSiteObj.id,
      workOrderNumber: orderNo,
      notes: notesVal,
      usedDate: usedDateVal
    });

    if (res?.success === false) {
      showToast?.(res.error || 'Failed to record part as used.', 'error');
    }
  };

  const closeTransferModal = () => {
    setIsTransferOpen(false);
    setSelectedUnitSerial('');
    setTransferTargetSiteId('');
    setTransferSlipNumber('');
    setTransferNotes('');
    setTransferDate(new Date().toISOString().substring(0, 10));
  };

  // Submit Transfer
  const handleConfirmTransfer = async (e) => {
    e.preventDefault();
    if (!selectedUnitSerial) {
      showToast?.('Please select a part serial to transfer.', 'error');
      return;
    }
    if (!transferTargetSiteId) {
      showToast?.('Please select destination site.', 'error');
      return;
    }
    const targetSite = sites.find(s => s.id === transferTargetSiteId || s.code === transferTargetSiteId);
    const res = await transferUnitToSite({
      serialNumber: selectedUnitSerial,
      targetSiteId: targetSite?.id || transferTargetSiteId,
      targetSiteCode: targetSite?.code || transferTargetSiteId,
      transferSlipNumber,
      notes: transferNotes,
      transferDate
    });
    if (res?.success) {
      closeTransferModal();
    }
  };

  // Submit Outtake
  const handleConfirmOuttake = async (e) => {
    e.preventDefault();
    if (!selectedUnitSerial) {
      showToast?.('Please select a part serial.', 'error');
      return;
    }
    const res = await markUnitForOuttake({
      serialNumber: selectedUnitSerial,
      reason: outtakeReason,
      notes: outtakeNotes
    });
    if (res?.success) {
      setIsOuttakeOpen(false);
      setSelectedUnitSerial('');
      setOuttakeReason('Return to DC / Apple');
      setOuttakeNotes('');
    }
  };

  // Handle File Select for Import
  const handleFileSelect = async (file) => {
    if (!file) return;
    setIsImporting(true);
    try {
      const shouldParseAll = selectedSiteId === 'ALL' || isSuperadmin;
      const res = await parseScanInPartsFile(
        file,
        parts,
        inventoryUnits,
        [],
        selectedSiteId === 'ALL' ? 'ALL' : activeSiteObj.id,
        selectedSiteId === 'ALL' ? 'ALL' : activeSiteObj.code,
        {
          parseAllSheets: shouldParseAll,
          sites
        }
      );
      if (res.success) {
        setImportParsedBatch(res);
        setImportSelectedSheet(res.activeSheet || (shouldParseAll ? 'ALL_SHEETS' : ''));
        const label = res.activeSheet === 'ALL_SHEETS' ? 'all 27 branch sheets' : `sheet "${res.activeSheet}"`;
        showToast?.(`Parsed ${res.summary.total} rows from ${label}!`, 'info');
      } else {
        showToast?.(res.error || 'Failed to parse file', 'error');
      }
    } catch (err) {
      showToast?.('Error parsing file: ' + err.message, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  // Switch Active Worksheet in Modal (Instant Client-Side Switch)
  const handleSheetChange = (sheetName) => {
    if (!importParsedBatch?.workbook) return;
    setImportSelectedSheet(sheetName);
    const parseAll = sheetName === 'ALL_SHEETS';
    const siteObj = parseAll ? null : sites.find(s => s.code === sheetName || s.name?.includes(sheetName));
    const res = parseSiteStockMonitoringWorkbook(importParsedBatch.workbook, {
      existingParts: parts,
      existingUnits: inventoryUnits,
      targetSiteId: parseAll ? 'ALL' : (siteObj?.id || activeSiteObj.id),
      targetSiteCode: parseAll ? 'ALL' : (siteObj?.code || activeSiteObj.code),
      specificSheetName: sheetName,
      parseAllSheets: parseAll,
      sites
    });
    if (res.success) {
      setImportParsedBatch(res);
      showToast?.(`Switched to ${parseAll ? 'All 27 Branch Sheets' : `Sheet "${sheetName}"`} (${res.summary.valid} valid records)`, 'info');
    }
  };

  // Confirm Import
  const handleConfirmImport = async () => {
    if (isSubmittingImportRef.current || isImporting) return;
    if (!importParsedBatch || !importParsedBatch.items) return;
    const validItems = importParsedBatch.items.filter(
      it => it.status === 'VALID' || it.status === 'NEW_PART' || it.status === 'EXISTING_INVENTORY'
    );
    if (validItems.length === 0) {
      showToast?.('No valid parts to import.', 'error');
      return;
    }

    isSubmittingImportRef.current = true;
    setIsImporting(true);
    setImportProgress({
      active: true,
      stage: 'Preparing Import Data',
      detail: `Validating ${validItems.length.toLocaleString()} records for insertion...`,
      percent: 5,
      current: 0,
      total: validItems.length
    });

    // Yield control to let React paint the loading screen
    await new Promise(resolve => setTimeout(resolve, 50));

    const isMulti = importParsedBatch.activeSheet === 'ALL_SHEETS' || activeSiteObj.id === 'ALL';

    try {
      if (clearBeforeImport && typeof clearSiteParts === 'function') {
        setImportProgress(prev => ({
          ...prev,
          stage: 'Clearing Outdated Site Inventory',
          detail: isMulti
            ? `Purging old inventory across all ${branchSitesCount} retail branch sites...`
            : `Purging old inventory for ${activeSiteObj.name}...`,
          percent: 18
        }));
        await new Promise(resolve => setTimeout(resolve, 30));

        if (isMulti) {
          await clearSiteParts({
            clearAllSites: true,
            reason: 'Pre-import clean slate for all retail branch sites prior to consolidated Site Stock Monitoring import'
          });
        } else {
          await clearSiteParts({
            siteId: activeSiteObj.id,
            siteCode: activeSiteObj.code,
            clearAllSites: false,
            reason: `Pre-import clean slate for ${activeSiteObj.name} prior to Site Stock Monitoring import`
          });
        }

        setImportProgress(prev => ({
          ...prev,
          stage: 'Inventory Cleared',
          detail: 'Clean slate applied successfully. Structuring part records...',
          percent: 30
        }));
        await new Promise(resolve => setTimeout(resolve, 30));
      }

      setImportProgress(prev => ({
        ...prev,
        stage: 'Processing Part Records',
        detail: `Structuring and indexing ${validItems.length.toLocaleString()} parts...`,
        percent: 35
      }));

      const res = await batchAddScanInUnits(
        validItems,
        null,
        isMulti ? 'Branch Stock' : `${activeSiteObj.code} Stock`,
        isMulti ? 'ALL' : activeSiteObj.id,
        isMulti ? 'ALL' : activeSiteObj.code,
        isMulti ? 'All Retail Branches' : activeSiteObj.name,
        {
          onProgress: ({ stage, detail, percent, current, total }) => {
            const mappedPercent = Math.min(96, Math.max(35, Math.round(35 + ((percent || 0) * 0.62))));
            setImportProgress(prev => ({
              ...prev,
              stage: stage || 'Processing Part Batches',
              detail: detail || prev.detail,
              percent: mappedPercent,
              current: current ?? prev.current,
              total: total || prev.total
            }));
          }
        }
      );

      if (res?.success) {
        setImportProgress({
          active: true,
          stage: 'Finalizing Import',
          detail: 'Database update complete! Refreshing view...',
          percent: 100,
          current: validItems.length,
          total: validItems.length
        });
        await new Promise(resolve => setTimeout(resolve, 400));

        const targetMsg = isMulti ? `all ${branchSitesCount} branch sites` : activeSiteObj.name;
        showToast?.(
          `Successfully imported ${res.count} parts (${importParsedBatch.summary.inStock || 0} In-Stock, ${importParsedBatch.summary.used || 0} Used, ${importParsedBatch.summary.transferred || 0} Transferred, ${importParsedBatch.summary.outtake || 0} Outtake) across ${targetMsg}!`,
          'success'
        );
        setImportParsedBatch(null);
        setIsImportOpen(false);
        setClearBeforeImport(false);
      } else {
        showToast?.(res?.error || 'Import failed', 'error');
      }
    } catch (err) {
      console.error('Import execution error:', err);
      showToast?.('Import encountered an error: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      isSubmittingImportRef.current = false;
      setIsImporting(false);
      setImportProgress({
        active: false,
        stage: '',
        detail: '',
        percent: 0,
        current: 0,
        total: 0
      });
    }
  };

  // Confirm Clear Parts
  const handleConfirmClearParts = async () => {
    if (typeof clearSiteParts !== 'function') return;
    setIsClearingParts(true);
    try {
      if (clearPartsScope === 'SYSTEM') {
        await clearSiteParts({
          clearEntireSystem: true,
          reason: 'Complete system-wide purge (Central DC + All Sites) by Superadmin prior to fresh master import'
        });
      } else if (clearPartsScope === 'ALL') {
        await clearSiteParts({
          clearAllSites: true,
          reason: 'Bulk cleared all retail branch sites prior to Site Stock Monitoring Excel import'
        });
      } else {
        await clearSiteParts({
          siteId: activeSiteObj.id,
          siteCode: activeSiteObj.code,
          clearAllSites: false,
          reason: `Cleared old shipped parts for ${activeSiteObj.code} prior to Site Stock Monitoring Excel import`
        });
      }
      setIsClearPartsOpen(false);
    } catch (err) {
      showToast?.('Failed to clear parts: ' + err.message, 'error');
    } finally {
      setIsClearingParts(false);
    }
  };

  return (
    <div className="site-stock-monitoring-view" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* 1. Header & Controls Card */}
      <div className="card" style={{ padding: '18px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ padding: '6px 8px', background: '#ecfdf5', borderRadius: '8px', color: '#059669', display: 'flex', alignItems: 'center' }}>
                <FileSpreadsheet size={20} />
              </div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span>Site Stock Monitoring — {activeSiteObj.name} ({activeSiteObj.code})</span>
                {isSyncing && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: '#e0f2fe',
                      color: '#0284c7',
                      border: '1px solid #bae6fd'
                    }}
                  >
                    <RefreshCw size={11} className="spin" />
                    Syncing live data...
                  </span>
                )}
              </h2>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              Integrated Excel tracking replicating Google Sheets (Site Stock Monitoring.xlsx) — Live Stock on Hand, Used Parts, For Outtake, Transferred Parts &amp; Site Stock Balance.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* Site selector for selecting branch or All Retail Branches (Superadmin only) */}
            {isSuperadmin ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Building2 size={15} color="#64748b" />
                <select
                  className="form-select"
                  style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '6px', fontWeight: 600, minWidth: '170px' }}
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                >
                  <option value="ALL">All Retail Branches</option>
                  {sites.filter(s => !s.is_dc && s.is_active !== false).map(s => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 12px', borderRadius: '6px' }}>
                <Building2 size={14} color="#0284c7" />
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  {activeSiteObj.code} — {activeSiteObj.name}
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <button
              type="button"
              className="btn btn-sm btn-primary"
              style={{ background: '#d97706', borderColor: '#d97706', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}
              onClick={() => {
                setSelectedUnitSerial('');
                setIsMarkUsedOpen(true);
              }}
              title="Record part consumed/used in customer repair order"
            >
              <Wrench size={13} />
              <span>Record Used</span>
            </button>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              style={{ background: '#0891b2', borderColor: '#0891b2', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}
              onClick={() => {
                setSelectedUnitSerial('');
                setTransferTargetSiteId('');
                setTransferSlipNumber('');
                setTransferNotes('');
                setTransferDate(new Date().toISOString().substring(0, 10));
                setIsTransferOpen(true);
              }}
              title="Record serialized part transfer to another branch"
            >
              <ArrowRightLeft size={13} />
              <span>Transfer Part</span>
            </button>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              style={{ background: '#7c3aed', borderColor: '#7c3aed', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}
              onClick={() => {
                setSelectedUnitSerial('');
                setIsOuttakeOpen(true);
              }}
              title="Mark serialized part for outtake or return to DC/Apple"
            >
              <LogOut size={13} />
              <span>For Outtake</span>
            </button>

            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}
              onClick={() => setIsImportOpen(true)}
              title="Import Site Stock Monitoring spreadsheet directly without manual entry"
            >
              <UploadCloud size={13} color="#0284c7" />
              <span>Import (.xlsx)</span>
            </button>

            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}
              onClick={handleExportXLSX}
              title="Export complete site monitoring board to Excel (.xlsx)"
            >
              <Download size={13} color="#059669" />
              <span>Export (.xlsx)</span>
            </button>

            {isSuperadmin && (
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  fontSize: '11.5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontWeight: 700,
                  color: '#dc2626',
                  border: '1px solid #fecaca',
                  background: '#fff1f2',
                  borderRadius: '6px'
                }}
                onClick={() => {
                  setClearPartsScope(activeSiteObj.id === 'ALL' ? 'ALL' : 'CURRENT');
                  setIsClearPartsOpen(true);
                }}
                title="Clear old shipped parts from site inventory prior to Excel import"
              >
                <Trash2 size={13} color="#dc2626" />
                <span>Clear Parts</span>
              </button>
            )}
          </div>
        </div>

        {/* Realtime Cloud Hydration Banner during initial refresh */}
        {isPartialDataDuringSync && (
          <div style={{
            marginTop: '14px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '12.5px',
            color: '#1e40af'
          }}>
            <RefreshCw size={15} className="spin" color="#2563eb" />
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
              <span>
                <strong>Synchronizing live site stock &amp; parts status...</strong> Initializing complete inventory records from cloud database.
              </span>
              <span style={{ fontSize: '11px', color: '#3b82f6', fontWeight: 700 }}>
                Live Cloud Sync Active
              </span>
            </div>
          </div>
        )}

        {/* 2. KPI Summary Banner */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginTop: '16px' }}>
          
          <div style={{ padding: '12px 14px', borderRadius: '8px', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#1e40af' }}>Stock on Hand</span>
              <Package size={15} color="#2563eb" />
            </div>
            <div style={{ marginTop: '4px', fontSize: '20px', fontWeight: 800, color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isPartialDataDuringSync ? (
                <span style={{ fontSize: '13px', color: '#3b82f6', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <RefreshCw size={11} className="spin" /> Syncing...
                </span>
              ) : (
                siteData.kpi.inStockCount
              )}
            </div>
            <span style={{ fontSize: '10.5px', color: '#3b82f6' }}>Available for repairs</span>
          </div>

          <div style={{ padding: '12px 14px', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fde68a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#92400e' }}>Used Parts</span>
              <Wrench size={15} color="#d97706" />
            </div>
            <div style={{ marginTop: '4px', fontSize: '20px', fontWeight: 800, color: '#78350f', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isPartialDataDuringSync ? (
                <span style={{ fontSize: '13px', color: '#d97706', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <RefreshCw size={11} className="spin" /> Syncing...
                </span>
              ) : (
                siteData.kpi.usedCount
              )}
            </div>
            <span style={{ fontSize: '10.5px', color: '#b45309' }}>Consumed in OC orders</span>
          </div>

          <div style={{ padding: '12px 14px', borderRadius: '8px', background: '#faf5ff', border: '1px solid #e9d5ff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#6b21a8' }}>For Outtake</span>
              <LogOut size={15} color="#9333ea" />
            </div>
            <div style={{ marginTop: '4px', fontSize: '20px', fontWeight: 800, color: '#581c87', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isPartialDataDuringSync ? (
                <span style={{ fontSize: '13px', color: '#9333ea', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <RefreshCw size={11} className="spin" /> Syncing...
                </span>
              ) : (
                siteData.kpi.outtakeCount
              )}
            </div>
            <span style={{ fontSize: '10.5px', color: '#7e22ce' }}>Pending DC/Apple return</span>
          </div>

          <div style={{ padding: '12px 14px', borderRadius: '8px', background: '#ecfeff', border: '1px solid #a5f3fc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#155e75' }}>Transferred</span>
              <ArrowRightLeft size={15} color="#0891b2" />
            </div>
            <div style={{ marginTop: '4px', fontSize: '20px', fontWeight: 800, color: '#164e63', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isPartialDataDuringSync ? (
                <span style={{ fontSize: '13px', color: '#0891b2', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <RefreshCw size={11} className="spin" /> Syncing...
                </span>
              ) : (
                siteData.kpi.transferredCount
              )}
            </div>
            <span style={{ fontSize: '10.5px', color: '#0e7490' }}>Inter-branch transfers</span>
          </div>

          <div style={{ padding: '12px 14px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#166534' }}>Total Tracked SKUs</span>
              <Boxes size={15} color="#16a34a" />
            </div>
            <div style={{ marginTop: '4px', fontSize: '20px', fontWeight: 800, color: '#14532d', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isPartialDataDuringSync ? (
                <span style={{ fontSize: '13px', color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <RefreshCw size={11} className="spin" /> Syncing...
                </span>
              ) : (
                siteData.kpi.skuCount
              )}
            </div>
            <span style={{ fontSize: '10.5px', color: '#15803d' }}>
              {isPartialDataDuringSync ? 'Synchronizing units...' : `${siteData.kpi.totalCount} total units`}
            </span>
          </div>

        </div>

        {/* 3. Section Tabs */}
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            {/* Sub-view switcher */}
            <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '3px', gap: '2px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setViewSection('grid')}
                style={{
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: viewSection === 'grid' ? '#ffffff' : 'transparent',
                  color: viewSection === 'grid' ? '#0f172a' : '#64748b',
                  boxShadow: viewSection === 'grid' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <LayoutGrid size={13} color={viewSection === 'grid' ? '#0284c7' : '#94a3b8'} />
                <span>Consolidated View (All Sections)</span>
              </button>

              <button
                type="button"
                onClick={() => setViewSection('stock')}
                style={{
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: viewSection === 'stock' ? '#ffffff' : 'transparent',
                  color: viewSection === 'stock' ? '#1e40af' : '#64748b',
                  boxShadow: viewSection === 'stock' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <Package size={13} color={viewSection === 'stock' ? '#2563eb' : '#94a3b8'} />
                <span>Stock on hand ({isPartialDataDuringSync ? '...' : siteData.kpi.inStockCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setViewSection('used')}
                style={{
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: viewSection === 'used' ? '#ffffff' : 'transparent',
                  color: viewSection === 'used' ? '#92400e' : '#64748b',
                  boxShadow: viewSection === 'used' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <Wrench size={13} color={viewSection === 'used' ? '#d97706' : '#94a3b8'} />
                <span>Used Parts ({isPartialDataDuringSync ? '...' : siteData.kpi.usedCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setViewSection('outtake')}
                style={{
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: viewSection === 'outtake' ? '#ffffff' : 'transparent',
                  color: viewSection === 'outtake' ? '#6b21a8' : '#64748b',
                  boxShadow: viewSection === 'outtake' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <LogOut size={13} color={viewSection === 'outtake' ? '#9333ea' : '#94a3b8'} />
                <span>For Outtake ({isPartialDataDuringSync ? '...' : siteData.kpi.outtakeCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setViewSection('transferred')}
                style={{
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: viewSection === 'transferred' ? '#ffffff' : 'transparent',
                  color: viewSection === 'transferred' ? '#155e75' : '#64748b',
                  boxShadow: viewSection === 'transferred' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <ArrowRightLeft size={13} color={viewSection === 'transferred' ? '#0891b2' : '#94a3b8'} />
                <span>Transferred ({isPartialDataDuringSync ? '...' : siteData.kpi.transferredCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setViewSection('summary')}
                style={{
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: viewSection === 'summary' ? '#ffffff' : 'transparent',
                  color: viewSection === 'summary' ? '#166534' : '#64748b',
                  boxShadow: viewSection === 'summary' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <Boxes size={13} color={viewSection === 'summary' ? '#16a34a' : '#94a3b8'} />
                <span>Site Stock Breakdown</span>
              </button>
            </div>

            {/* Scope info indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
              <span style={{ fontWeight: 600 }}>Active Scope:</span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '4px',
                fontWeight: 700,
                fontSize: '11px',
                background: selectedSiteId === 'ALL' ? '#e0f2fe' : '#f1f5f9',
                color: selectedSiteId === 'ALL' ? '#0284c7' : '#334155'
              }}>
                {selectedSiteId === 'ALL' ? <Globe size={11} /> : <Building2 size={11} />}
                {selectedSiteId === 'ALL' ? 'All Retail Branches' : (activeSiteObj?.code || 'Current Branch')}
              </span>
            </div>
          </div>

          {/* 4. Dedicated Full-Width Search & Filter Toolbar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            marginTop: '12px',
            padding: '8px 12px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            flexWrap: 'wrap'
          }}>
            {/* Search Input Box */}
            <div style={{ position: 'relative', flex: '1 1 320px', display: 'flex', alignItems: 'center' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '12px',
                  color: searchQuery ? '#0284c7' : '#94a3b8',
                  pointerEvents: 'none'
                }}
              />
              <input
                type="text"
                className="form-input"
                style={{
                  width: '100%',
                  paddingLeft: '34px',
                  paddingRight: searchQuery ? '95px' : '14px',
                  fontSize: '12px',
                  height: '34px',
                  borderRadius: '6px',
                  background: '#ffffff',
                  borderColor: searchQuery ? '#38bdf8' : '#cbd5e1',
                  boxShadow: searchQuery ? '0 0 0 2px rgba(56, 189, 248, 0.15)' : 'none'
                }}
                placeholder="Search by Serial Number, Part Number, Description, Work Order #, or TS#..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <div style={{ position: 'absolute', right: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#0369a1', background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px' }}>
                    {filteredInStock.length + filteredUsed.length + filteredOuttake.length + filteredTransferred.length} found
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: '4px'
                    }}
                    title="Clear search"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Scope & Filter Controls Group */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
              {/* Branch Scope Segmented Control (Superadmin only) */}
              {isSuperadmin && (
                <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '2px', borderRadius: '6px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedSiteId === 'ALL') {
                        setSelectedSiteId(userSiteObj?.id || sites.find(s => !s.is_dc)?.id || 'ALL');
                      }
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '5px',
                      border: 'none',
                      cursor: 'pointer',
                      background: selectedSiteId !== 'ALL' ? '#ffffff' : 'transparent',
                      color: selectedSiteId !== 'ALL' ? '#0f172a' : '#64748b',
                      boxShadow: selectedSiteId !== 'ALL' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'all 0.15s ease'
                    }}
                    title="Limit search to active branch"
                  >
                    <Building2 size={12} />
                    <span>{activeSiteObj?.code || 'This Branch'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSiteId('ALL')}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '5px',
                      border: 'none',
                      cursor: 'pointer',
                      background: selectedSiteId === 'ALL' ? '#0284c7' : 'transparent',
                      color: selectedSiteId === 'ALL' ? '#ffffff' : '#64748b',
                      boxShadow: selectedSiteId === 'ALL' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'all 0.15s ease'
                    }}
                    title="Search across all retail branches network-wide"
                  >
                    <Globe size={12} />
                    <span>All Retail Branches</span>
                  </button>
                </div>
              )}

              {/* Category Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Filter size={12} color="#64748b" />
                <select
                  className="form-select"
                  style={{ fontSize: '11.5px', padding: '4px 8px', height: '30px', borderRadius: '6px', background: '#ffffff', borderColor: '#cbd5e1' }}
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="ALL">All Categories</option>
                  <option value="cat-display">Displays Only</option>
                  <option value="cat-battery">Batteries Only</option>
                </select>
              </div>

              {/* Reset button if filter or search is active */}
              {(searchQuery || categoryFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('ALL');
                  }}
                  style={{
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#64748b',
                    borderRadius: '6px',
                    height: '30px',
                    padding: '0 8px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="Reset search and filters"
                >
                  <RotateCcw size={11} />
                  <span>Reset</span>
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* 4. CONTENT SECTIONS */}

      {/* VIEW A: SPREADSHEET GRID (Replicating exact Site Stock Monitoring.xlsx multi-table layout) */}
      {viewSection === 'grid' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', boxShadow: '0 2px 8px -2px rgba(15, 23, 42, 0.06)' }}>
          {/* Card Title & Context Header */}
          <div style={{ padding: '14px 20px', background: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f0f9ff', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <LayoutGrid size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  Consolidated Stock Lifecycle Overview — {activeSiteObj.code === 'ALL' ? 'All Retail Branches' : activeSiteObj.name}
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Unified side-by-side tracking across all 5 inventory stages (Stock on Hand, Used Parts, For Outtake, Transferred, and Stock Summary). Showing first {Math.min(INITIAL_GRID_ROW_LIMIT, Math.max(filteredInStock.length, filteredUsed.length, filteredOuttake.length, filteredTransferred.length, filteredSummary.length))} rows per section.
                </p>
              </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="badge" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: '11.5px', fontWeight: 600 }}>
                {activeSiteObj.name} ({activeSiteObj.code})
              </span>
            </div>
          </div>

          {/* Quick Jump & Section Navigation Bar */}
          <div style={{ padding: '10px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '4px' }}>
                Quick Jump:
              </span>
              <button
                type="button"
                onClick={() => scrollToSection('stock')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  background: '#ffffff',
                  color: '#0284c7',
                  border: '1px solid #bae6fd',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(2, 132, 199, 0.05)'
                }}
              >
                <Package size={12} />
                <span>1. Stock on Hand ({isPartialDataDuringSync ? '...' : filteredInStock.length})</span>
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('used')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  background: '#ffffff',
                  color: '#d97706',
                  border: '1px solid #fde68a',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(217, 119, 6, 0.05)'
                }}
              >
                <Wrench size={12} />
                <span>2. Used Parts ({isPartialDataDuringSync ? '...' : filteredUsed.length})</span>
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('outtake')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  background: '#ffffff',
                  color: '#7c3aed',
                  border: '1px solid #ddd6fe',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(124, 58, 237, 0.05)'
                }}
              >
                <LogOut size={12} />
                <span>3. For Outtake ({isPartialDataDuringSync ? '...' : filteredOuttake.length})</span>
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('transferred')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  background: '#ffffff',
                  color: '#0891b2',
                  border: '1px solid #a5f3fc',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(8, 145, 178, 0.05)'
                }}
              >
                <ArrowRightLeft size={12} />
                <span>4. Transferred Parts ({isPartialDataDuringSync ? '...' : filteredTransferred.length})</span>
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('summary')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  background: '#ffffff',
                  color: '#059669',
                  border: '1px solid #a7f3d0',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(5, 150, 105, 0.05)'
                }}
              >
                <Boxes size={12} />
                <span>5. Stock Summary ({filteredSummary.length})</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                Tip: Click any serial to copy to clipboard
              </span>
            </div>
          </div>

          {/* Cross-Branch Search Assistant Banner (Superadmin only) */}
          {isSuperadmin && searchQuery && crossBranchMatchCount > 0 && (filteredInStock.length + filteredUsed.length + filteredOuttake.length + filteredTransferred.length === 0) && (
            <div style={{
              margin: '12px 18px',
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Info size={16} color="#0284c7" />
                <span style={{ fontSize: '12px', color: '#0369a1', fontWeight: 600 }}>
                  No matching parts for <strong>"{searchQuery}"</strong> at <strong>{activeSiteObj.code}</strong>, but <strong>{crossBranchMatchCount} matching unit{crossBranchMatchCount > 1 ? 's' : ''}</strong> found in other retail branches.
                </span>
              </div>
              <button
                type="button"
                className="btn btn-xs"
                style={{
                  background: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  padding: '5px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
                onClick={() => setSelectedSiteId('ALL')}
              >
                <Globe size={12} />
                <span>Switch to All Retail Branches</span>
              </button>
            </div>
          )}

          {/* Zero Results Banner */}
          {searchQuery && (filteredInStock.length + filteredUsed.length + filteredOuttake.length + filteredTransferred.length + filteredSummary.length === 0) && crossBranchMatchCount === 0 && (
            <div style={{
              margin: '12px 18px',
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={15} color="#dc2626" />
                <span style={{ fontSize: '12px', color: '#991b1b', fontWeight: 600 }}>
                  No records matching <strong>"{searchQuery}"</strong> found across Part Numbers, Serials, Descriptions, or Remarks.
                </span>
              </div>
              <button
                type="button"
                className="btn btn-xs"
                style={{ background: '#ffffff', border: '1px solid #fca5a5', color: '#dc2626', fontSize: '11.5px', fontWeight: 700, padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' }}
                onClick={() => setSearchQuery('')}
              >
                Clear Search
              </button>
            </div>
          )}

          {/* Sticky Table Viewport */}
          <div
            ref={gridScrollContainerRef}
            style={{
              overflowX: 'auto',
              maxHeight: '680px',
              position: 'relative'
            }}
          >
            <table
              className="data-table"
              style={{
                width: '100%',
                minWidth: '4630px',
                fontSize: '12px',
                borderCollapse: 'separate',
                borderSpacing: 0,
                tableLayout: 'fixed'
              }}
            >
              <colgroup>
                {/* Section 1: Stock on Hand (6 cols) */}
                <col style={{ width: '90px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '260px' }} />
                <col style={{ width: '190px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '260px' }} />

                {/* Section 2: Used Parts (6 cols) */}
                <col style={{ width: '90px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '260px' }} />
                <col style={{ width: '190px' }} />
                <col style={{ width: '240px' }} />

                {/* Section 3: For Outtake (5 cols) */}
                <col style={{ width: '90px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '260px' }} />
                <col style={{ width: '190px' }} />
                <col style={{ width: '220px' }} />

                {/* Section 4: Transferred Parts (6 cols) */}
                <col style={{ width: '90px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '260px' }} />
                <col style={{ width: '190px' }} />
                <col style={{ width: '240px' }} />

                {/* Section 5: Site Stock Summary (4 cols) */}
                <col style={{ width: '90px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '270px' }} />
                <col style={{ width: '120px' }} />
              </colgroup>
              <thead>
                {/* Row 0: Sticky Section Headers */}
                <tr style={{ textAlign: 'center', fontWeight: 800, fontSize: '12px', letterSpacing: '0.04em' }}>
                  <th
                    ref={sectionStockRef}
                    colSpan={6}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      background: '#0284c7',
                      color: '#ffffff',
                      borderRight: '4px solid #ffffff',
                      padding: '10px 14px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      <Package size={14} />
                      <span>1. Stock on hand ({filteredInStock.length})</span>
                    </div>
                  </th>
                  <th
                    ref={sectionUsedRef}
                    colSpan={6}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      background: '#d97706',
                      color: '#ffffff',
                      borderRight: '4px solid #ffffff',
                      padding: '10px 14px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      <Wrench size={14} />
                      <span>2. Used Parts ({filteredUsed.length})</span>
                    </div>
                  </th>
                  <th
                    ref={sectionOuttakeRef}
                    colSpan={5}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      background: '#7c3aed',
                      color: '#ffffff',
                      borderRight: '4px solid #ffffff',
                      padding: '10px 14px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      <LogOut size={14} />
                      <span>3. For Outtake ({filteredOuttake.length})</span>
                    </div>
                  </th>
                  <th
                    ref={sectionTransferredRef}
                    colSpan={6}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      background: '#0891b2',
                      color: '#ffffff',
                      borderRight: '4px solid #ffffff',
                      padding: '10px 14px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      <ArrowRightLeft size={14} />
                      <span>4. Transferred Parts to Other Sites ({filteredTransferred.length})</span>
                    </div>
                  </th>
                  <th
                    ref={sectionSummaryRef}
                    colSpan={4}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      background: '#059669',
                      color: '#ffffff',
                      padding: '10px 14px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      <Boxes size={14} />
                      <span>5. Site Stock Summary ({filteredSummary.length})</span>
                    </div>
                  </th>
                </tr>

                {/* Row 1: Sticky Column Subheaders */}
                <tr style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {/* Section 1: Stock on Hand */}
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '90px', minWidth: '90px', maxWidth: '90px', boxSizing: 'border-box', background: '#f0f9ff', color: '#0369a1', borderBottom: '2px solid #bae6fd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Site</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '140px', minWidth: '140px', maxWidth: '140px', boxSizing: 'border-box', background: '#f0f9ff', color: '#0369a1', borderBottom: '2px solid #bae6fd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>P/N</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '260px', minWidth: '260px', maxWidth: '260px', boxSizing: 'border-box', background: '#f0f9ff', color: '#0369a1', borderBottom: '2px solid #bae6fd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Part Description</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '190px', minWidth: '190px', maxWidth: '190px', boxSizing: 'border-box', background: '#f0f9ff', color: '#0369a1', borderBottom: '2px solid #bae6fd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Serial</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '110px', minWidth: '110px', maxWidth: '110px', boxSizing: 'border-box', background: '#f0f9ff', color: '#0369a1', borderBottom: '2px solid #bae6fd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Date Rcvd</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '260px', minWidth: '260px', maxWidth: '260px', boxSizing: 'border-box', background: '#f0f9ff', color: '#0369a1', borderBottom: '2px solid #bae6fd', borderRight: '3px solid #94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Remarks</th>

                  {/* Section 2: Used Parts */}
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '90px', minWidth: '90px', maxWidth: '90px', boxSizing: 'border-box', background: '#fffbeb', color: '#b45309', borderBottom: '2px solid #fde68a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Site</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '110px', minWidth: '110px', maxWidth: '110px', boxSizing: 'border-box', background: '#fffbeb', color: '#b45309', borderBottom: '2px solid #fde68a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Date Used</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '140px', minWidth: '140px', maxWidth: '140px', boxSizing: 'border-box', background: '#fffbeb', color: '#b45309', borderBottom: '2px solid #fde68a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>P/N</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '260px', minWidth: '260px', maxWidth: '260px', boxSizing: 'border-box', background: '#fffbeb', color: '#b45309', borderBottom: '2px solid #fde68a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Part Description</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '190px', minWidth: '190px', maxWidth: '190px', boxSizing: 'border-box', background: '#fffbeb', color: '#b45309', borderBottom: '2px solid #fde68a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Serial</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '240px', minWidth: '240px', maxWidth: '240px', boxSizing: 'border-box', background: '#fffbeb', color: '#b45309', borderBottom: '2px solid #fde68a', borderRight: '3px solid #94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Remarks (OC#)</th>

                  {/* Section 3: For Outtake */}
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '90px', minWidth: '90px', maxWidth: '90px', boxSizing: 'border-box', background: '#faf5ff', color: '#6d28d9', borderBottom: '2px solid #ddd6fe', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Site</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '140px', minWidth: '140px', maxWidth: '140px', boxSizing: 'border-box', background: '#faf5ff', color: '#6d28d9', borderBottom: '2px solid #ddd6fe', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>P/N</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '260px', minWidth: '260px', maxWidth: '260px', boxSizing: 'border-box', background: '#faf5ff', color: '#6d28d9', borderBottom: '2px solid #ddd6fe', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Part Description</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '190px', minWidth: '190px', maxWidth: '190px', boxSizing: 'border-box', background: '#faf5ff', color: '#6d28d9', borderBottom: '2px solid #ddd6fe', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Serial</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '220px', minWidth: '220px', maxWidth: '220px', boxSizing: 'border-box', background: '#faf5ff', color: '#6d28d9', borderBottom: '2px solid #ddd6fe', borderRight: '3px solid #94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Remarks</th>

                  {/* Section 4: Transferred Parts */}
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '90px', minWidth: '90px', maxWidth: '90px', boxSizing: 'border-box', background: '#ecfeff', color: '#0e7490', borderBottom: '2px solid #a5f3fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Origin Site</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '110px', minWidth: '110px', maxWidth: '110px', boxSizing: 'border-box', background: '#ecfeff', color: '#0e7490', borderBottom: '2px solid #a5f3fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Date Trans</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '140px', minWidth: '140px', maxWidth: '140px', boxSizing: 'border-box', background: '#ecfeff', color: '#0e7490', borderBottom: '2px solid #a5f3fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>P/N</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '260px', minWidth: '260px', maxWidth: '260px', boxSizing: 'border-box', background: '#ecfeff', color: '#0e7490', borderBottom: '2px solid #a5f3fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Part Description</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '190px', minWidth: '190px', maxWidth: '190px', boxSizing: 'border-box', background: '#ecfeff', color: '#0e7490', borderBottom: '2px solid #a5f3fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Serial</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '240px', minWidth: '240px', maxWidth: '240px', boxSizing: 'border-box', background: '#ecfeff', color: '#0e7490', borderBottom: '2px solid #a5f3fc', borderRight: '3px solid #94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Remarks (TS#)</th>

                  {/* Section 5: Site Stock Summary */}
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '90px', minWidth: '90px', maxWidth: '90px', boxSizing: 'border-box', background: '#f0fdf4', color: '#166534', borderBottom: '2px solid #bbf7d0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Site</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '140px', minWidth: '140px', maxWidth: '140px', boxSizing: 'border-box', background: '#f0fdf4', color: '#166534', borderBottom: '2px solid #bbf7d0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>P/N</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '270px', minWidth: '270px', maxWidth: '270px', boxSizing: 'border-box', background: '#f0fdf4', color: '#166534', borderBottom: '2px solid #bbf7d0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Part Description</th>
                  <th style={{ position: 'sticky', top: '39px', zIndex: 29, width: '120px', minWidth: '120px', maxWidth: '120px', boxSizing: 'border-box', background: '#f0fdf4', color: '#166534', borderBottom: '2px solid #bbf7d0', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>In-Stock Qty</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({
                  length: Math.min(INITIAL_GRID_ROW_LIMIT, Math.max(
                    filteredInStock.length,
                    filteredUsed.length,
                    filteredOuttake.length,
                    filteredTransferred.length,
                    filteredSummary.length,
                    1
                  ))
                }).map((_, idx) => {
                  const oh = filteredInStock[idx];
                  const u = filteredUsed[idx];
                  const ot = filteredOuttake[idx];
                  const tr = filteredTransferred[idx];
                  const sum = filteredSummary[idx];

                  return (
                    <tr
                      key={idx}
                      style={{
                        background: idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#eff6ff'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#ffffff' : '#f8fafc'; }}
                    >
                      {/* Section 1: Stock on Hand */}
                      <td style={{ color: '#0369a1', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90px', boxSizing: 'border-box', padding: '10px 12px' }} title={oh ? getUnitSiteCode(oh) : ''}>
                        {oh ? getUnitSiteCode(oh) : ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px', boxSizing: 'border-box', padding: '10px 12px' }} title={oh?.part_number || ''}>
                        {oh ? <strong style={{ color: '#0284c7', fontFamily: 'var(--font-mono)' }}>{oh.part_number}</strong> : ''}
                      </td>
                      <td style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box', padding: '10px 12px' }} title={oh?.description || ''}>
                        {oh?.description || ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '190px', boxSizing: 'border-box', padding: '10px 12px' }} title={oh ? getCleanDisplaySerial(oh.serial_number, oh) : ''}>
                        {oh ? (
                          oh.is_summary_only ? (
                            <span style={{ color: '#64748b', fontStyle: 'italic', fontSize: '11px' }}>Summary (no serial)</span>
                          ) : (
                            <span
                              onClick={() => handleCopySerial(oh.serial_number, oh)}
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 600,
                                cursor: 'pointer',
                                color: (copiedSerial === oh.serial_number || copiedSerial === getCleanDisplaySerial(oh.serial_number, oh)) ? '#15803d' : '#0f172a',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 5px',
                                borderRadius: '4px',
                                background: (copiedSerial === oh.serial_number || copiedSerial === getCleanDisplaySerial(oh.serial_number, oh)) ? '#dcfce7' : 'transparent',
                                transition: 'all 0.15s ease'
                              }}
                              title="Click to copy serial"
                            >
                              <span>{getCleanDisplaySerial(oh.serial_number, oh)}</span>
                              {(copiedSerial === oh.serial_number || copiedSerial === getCleanDisplaySerial(oh.serial_number, oh)) ? <Check size={11} strokeWidth={2.5} color="#15803d" /> : <Copy size={10} color="#94a3b8" />}
                            </span>
                          )
                        ) : ''}
                      </td>
                      <td style={{ color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '110px', boxSizing: 'border-box', padding: '10px 12px' }} title={oh?.received_at ? String(oh.received_at).substring(0, 10) : ''}>
                        {oh ? (oh.received_at ? String(oh.received_at).substring(0, 10) : '—') : ''}
                      </td>
                      <td
                        style={{
                          borderRight: '3px solid #cbd5e1',
                          color: '#475569',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '260px',
                          boxSizing: 'border-box',
                          padding: '10px 12px'
                        }}
                        title={oh?.remarks || oh?.notes || (oh ? 'On-hand' : '')}
                      >
                        {oh?.remarks || oh?.notes || (oh ? 'On-hand' : '')}
                      </td>

                      {/* Section 2: Used Parts */}
                      <td style={{ color: '#b45309', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90px', boxSizing: 'border-box', padding: '10px 12px' }} title={u ? getUnitSiteCode(u) : ''}>
                        {u ? getUnitSiteCode(u) : ''}
                      </td>
                      <td style={{ color: '#b45309', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '110px', boxSizing: 'border-box', padding: '10px 12px' }} title={u ? (u.used_at ? String(u.used_at).substring(0, 10) : (u.dateUsed || '—')) : ''}>
                        {u ? (u.used_at ? String(u.used_at).substring(0, 10) : (u.dateUsed || '—')) : ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px', boxSizing: 'border-box', padding: '10px 12px' }} title={u?.part_number || ''}>
                        {u ? <strong style={{ color: '#d97706', fontFamily: 'var(--font-mono)' }}>{u.part_number}</strong> : ''}
                      </td>
                      <td style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box', padding: '10px 12px' }} title={u?.description || ''}>
                        {u?.description || ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '190px', boxSizing: 'border-box', padding: '10px 12px' }} title={u ? getCleanDisplaySerial(u.serial_number, u) : ''}>
                        {u ? (
                          <span
                            onClick={() => handleCopySerial(u.serial_number, u)}
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 600,
                              cursor: 'pointer',
                              color: (copiedSerial === u.serial_number || copiedSerial === getCleanDisplaySerial(u.serial_number, u)) ? '#15803d' : '#0f172a',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              background: (copiedSerial === u.serial_number || copiedSerial === getCleanDisplaySerial(u.serial_number, u)) ? '#dcfce7' : 'transparent',
                              transition: 'all 0.15s ease'
                            }}
                            title="Click to copy serial"
                          >
                            <span>{getCleanDisplaySerial(u.serial_number, u)}</span>
                            {(copiedSerial === u.serial_number || copiedSerial === getCleanDisplaySerial(u.serial_number, u)) ? <Check size={11} strokeWidth={2.5} color="#15803d" /> : <Copy size={10} color="#94a3b8" />}
                          </span>
                        ) : ''}
                      </td>
                      <td
                        style={{
                          borderRight: '3px solid #cbd5e1',
                          color: '#92400e',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '240px',
                          boxSizing: 'border-box',
                          padding: '10px 12px'
                        }}
                        title={u?.work_order_number ? `Used to OC# ${u.work_order_number}` : (u?.remarks || u?.notes || (u ? 'Used' : ''))}
                      >
                        {u?.work_order_number ? `Used to OC# ${u.work_order_number}` : (u?.remarks || u?.notes || (u ? 'Used' : ''))}
                      </td>

                      {/* Section 3: For Outtake */}
                      <td style={{ color: '#6d28d9', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90px', boxSizing: 'border-box', padding: '10px 12px' }} title={ot ? getUnitSiteCode(ot) : ''}>
                        {ot ? getUnitSiteCode(ot) : ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px', boxSizing: 'border-box', padding: '10px 12px' }} title={ot?.part_number || ''}>
                        {ot ? <strong style={{ color: '#7c3aed', fontFamily: 'var(--font-mono)' }}>{ot.part_number}</strong> : ''}
                      </td>
                      <td style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box', padding: '10px 12px' }} title={ot?.description || ''}>
                        {ot?.description || ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '190px', boxSizing: 'border-box', padding: '10px 12px' }} title={ot ? getCleanDisplaySerial(ot.serial_number, ot) : ''}>
                        {ot ? (
                          <span
                            onClick={() => handleCopySerial(ot.serial_number, ot)}
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 600,
                              cursor: 'pointer',
                              color: (copiedSerial === ot.serial_number || copiedSerial === getCleanDisplaySerial(ot.serial_number, ot)) ? '#15803d' : '#0f172a',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              background: (copiedSerial === ot.serial_number || copiedSerial === getCleanDisplaySerial(ot.serial_number, ot)) ? '#dcfce7' : 'transparent',
                              transition: 'all 0.15s ease'
                            }}
                            title="Click to copy serial"
                          >
                            <span>{getCleanDisplaySerial(ot.serial_number, ot)}</span>
                            {(copiedSerial === ot.serial_number || copiedSerial === getCleanDisplaySerial(ot.serial_number, ot)) ? <Check size={11} strokeWidth={2.5} color="#15803d" /> : <Copy size={10} color="#94a3b8" />}
                          </span>
                        ) : ''}
                      </td>
                      <td
                        style={{
                          borderRight: '3px solid #cbd5e1',
                          color: '#6b21a8',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '220px',
                          boxSizing: 'border-box',
                          padding: '10px 12px'
                        }}
                        title={ot?.outtake_reason || ot?.remarks || ot?.notes || (ot ? 'For Outtake' : '')}
                      >
                        {ot?.outtake_reason || ot?.remarks || ot?.notes || (ot ? 'For Outtake' : '')}
                      </td>

                      {/* Section 4: Transferred Parts */}
                      <td style={{ color: '#0e7490', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90px', boxSizing: 'border-box', padding: '10px 12px' }} title={tr ? getUnitSiteCode(tr) : ''}>
                        {tr ? getUnitSiteCode(tr) : ''}
                      </td>
                      <td style={{ color: '#0e7490', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '110px', boxSizing: 'border-box', padding: '10px 12px' }} title={tr ? (tr.transferred_at ? String(tr.transferred_at).substring(0, 10) : (tr.dateTransferred || '—')) : ''}>
                        {tr ? (tr.transferred_at ? String(tr.transferred_at).substring(0, 10) : (tr.dateTransferred || '—')) : ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px', boxSizing: 'border-box', padding: '10px 12px' }} title={tr?.part_number || ''}>
                        {tr ? <strong style={{ color: '#0891b2', fontFamily: 'var(--font-mono)' }}>{tr.part_number}</strong> : ''}
                      </td>
                      <td style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box', padding: '10px 12px' }} title={tr?.description || ''}>
                        {tr?.description || ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '190px', boxSizing: 'border-box', padding: '10px 12px' }} title={tr ? getCleanDisplaySerial(tr.serial_number, tr) : ''}>
                        {tr ? (
                          <span
                            onClick={() => handleCopySerial(tr.serial_number, tr)}
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 600,
                              cursor: 'pointer',
                              color: (copiedSerial === tr.serial_number || copiedSerial === getCleanDisplaySerial(tr.serial_number, tr)) ? '#15803d' : '#0f172a',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              background: (copiedSerial === tr.serial_number || copiedSerial === getCleanDisplaySerial(tr.serial_number, tr)) ? '#dcfce7' : 'transparent',
                              transition: 'all 0.15s ease'
                            }}
                            title="Click to copy serial"
                          >
                            <span>{getCleanDisplaySerial(tr.serial_number, tr)}</span>
                            {(copiedSerial === tr.serial_number || copiedSerial === getCleanDisplaySerial(tr.serial_number, tr)) ? <Check size={11} strokeWidth={2.5} color="#15803d" /> : <Copy size={10} color="#94a3b8" />}
                          </span>
                        ) : ''}
                      </td>
                      <td
                        style={{
                          borderRight: '3px solid #cbd5e1',
                          color: '#155e75',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '240px',
                          boxSizing: 'border-box',
                          padding: '10px 12px'
                        }}
                        title={tr?.transfer_slip_number ? `${tr.transfer_slip_number} to ${tr.transferred_to_site_code || 'Branch'}` : (tr?.remarks || tr?.notes || (tr ? 'Transferred' : ''))}
                      >
                        {tr?.transfer_slip_number ? `${tr.transfer_slip_number} to ${tr.transferred_to_site_code || 'Branch'}` : (tr?.remarks || tr?.notes || (tr ? 'Transferred' : ''))}
                      </td>

                      {/* Section 5: Site Stock Summary */}
                      <td style={{ color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90px', boxSizing: 'border-box', padding: '10px 12px' }} title={sum ? activeSiteObj.code : ''}>
                        {sum ? activeSiteObj.code : ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px', boxSizing: 'border-box', padding: '10px 12px' }} title={sum?.partNumber || ''}>
                        {sum ? <strong style={{ color: '#059669', fontFamily: 'var(--font-mono)' }}>{sum.partNumber}</strong> : ''}
                      </td>
                      <td style={{ maxWidth: '270px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box', padding: '10px 12px' }} title={sum?.description || ''}>
                        {sum?.description || ''}
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px', boxSizing: 'border-box', padding: '10px 12px' }}>
                        {sum ? (
                          <span className="badge" style={{ background: '#ecfdf5', color: '#166534', border: '1px solid #bbf7d0', fontWeight: 800, padding: '3px 10px', fontSize: '11.5px', borderRadius: '999px' }}>
                            {sum.inStockCount}
                          </span>
                        ) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW B: STOCK ON HAND TABLE */}
      {viewSection === 'stock' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
          <div style={{ padding: '14px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#1e40af' }}>
              Stock on Hand ({filteredInStock.length} serialized parts)
            </h3>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Active in-stock inventory available for local technician consumption
            </span>
          </div>

          <div className="table-container" style={{ overflowX: 'auto' }}>
            {filteredInStock.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                <Package size={32} color="#cbd5e1" style={{ marginBottom: '8px' }} />
                <p style={{ margin: 0, fontSize: '13px' }}>No in-stock parts matching your search criteria.</p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={{ width: '100px' }}>Site</th>
                    <th style={{ width: '130px' }}>Part Number</th>
                    <th>Part Description</th>
                    <th style={{ width: '170px' }}>Serial Number</th>
                    <th style={{ width: '120px' }}>Date Received</th>
                    <th>Remarks</th>
                    <th style={{ width: '220px', textAlign: 'center' }}>Quick Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInStock.map(unit => (
                    <tr key={unit.serial_number}>
                      <td>
                        <span className="badge" style={{ background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', fontWeight: 700, fontSize: '11px' }}>
                          {getUnitSiteCode(unit)}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: '#0284c7', fontFamily: 'var(--font-mono)' }}>{unit.part_number}</strong>
                      </td>
                      <td>{unit.description || 'Replacement Part'}</td>
                      <td>
                        {unit.is_summary_only ? (
                          <span style={{ color: '#64748b', fontStyle: 'italic' }}>Summary quantity (no serial)</span>
                        ) : (
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0f172a' }}>
                            {getCleanDisplaySerial(unit.serial_number, unit)}
                          </span>
                        )}
                      </td>
                      <td style={{ color: '#64748b' }}>
                        {unit.received_at ? String(unit.received_at).substring(0, 10) : '—'}
                      </td>
                      <td style={{ color: '#475569' }}>{unit.remarks || unit.notes || 'On-hand'}</td>
                      <td style={{ textAlign: 'center' }}>
                        {unit.is_summary_only ? (
                          <span className="badge" style={{ background: '#f1f5f9', color: '#64748b', fontSize: '10.5px' }}>Summary only</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-xs"
                            style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', fontWeight: 700 }}
                            onClick={() => {
                              setSelectedUnitSerial(unit.serial_number);
                              setIsMarkUsedOpen(true);
                            }}
                            title="Mark this part as used in a repair order"
                          >
                            <Wrench size={11} style={{ marginRight: '3px' }} />
                            <span>Use</span>
                          </button>

                          <button
                            type="button"
                            className="btn btn-xs"
                            style={{ background: '#ecfeff', color: '#0891b2', border: '1px solid #a5f3fc', fontWeight: 700 }}
                            onClick={() => {
                              setSelectedUnitSerial(unit.serial_number);
                              setIsTransferOpen(true);
                            }}
                            title="Transfer this part to another site"
                          >
                            <ArrowRightLeft size={11} style={{ marginRight: '3px' }} />
                            <span>Transfer</span>
                          </button>

                          <button
                            type="button"
                            className="btn btn-xs"
                            style={{ background: '#faf5ff', color: '#7c3aed', border: '1px solid #e9d5ff', fontWeight: 700 }}
                            onClick={() => {
                              setSelectedUnitSerial(unit.serial_number);
                              setIsOuttakeOpen(true);
                            }}
                            title="Mark for return or outtake"
                          >
                            <LogOut size={11} style={{ marginRight: '3px' }} />
                            <span>Outtake</span>
                          </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* VIEW C: USED PARTS TABLE */}
      {viewSection === 'used' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
          <div style={{ padding: '14px 18px', background: '#fffbeb', borderBottom: '1px solid #fde68a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#92400e' }}>
              Used Parts Log ({filteredUsed.length} consumed parts)
            </h3>
            <span style={{ fontSize: '12px', color: '#b45309' }}>
              Serialized records consumed in repair work orders
            </span>
          </div>

          <div className="table-container" style={{ overflowX: 'auto' }}>
            {filteredUsed.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                <Wrench size={32} color="#cbd5e1" style={{ marginBottom: '8px' }} />
                <p style={{ margin: 0, fontSize: '13px' }}>No used parts recorded for this branch.</p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#fef3c7' }}>
                    <th style={{ width: '110px' }}>Site Location</th>
                    <th style={{ width: '120px' }}>Date Used</th>
                    <th style={{ width: '130px' }}>Part Number</th>
                    <th>Part Description</th>
                    <th style={{ width: '170px' }}>Serial Number</th>
                    <th style={{ width: '160px' }}>Work Order (OC#)</th>
                    <th>Usage Remarks</th>
                    {canRestore && <th style={{ width: '120px', textAlign: 'center' }}>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsed.map(unit => (
                    <tr key={unit.serial_number}>
                      <td>
                        <span className="badge" style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', fontWeight: 700, fontSize: '11px' }}>
                          {getUnitSiteCode(unit)}
                        </span>
                      </td>
                      <td style={{ color: '#92400e', fontWeight: 600 }}>
                        {unit.used_at ? String(unit.used_at).substring(0, 10) : (unit.dateUsed || '—')}
                      </td>
                      <td>
                        <strong style={{ color: '#d97706', fontFamily: 'var(--font-mono)' }}>{unit.part_number}</strong>
                      </td>
                      <td>{unit.description || 'Replacement Part'}</td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{getCleanDisplaySerial(unit.serial_number, unit)}</span>
                      </td>
                      <td>
                        {unit.work_order_number ? (
                          <span className="badge" style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', fontWeight: 700 }}>
                            OC# {unit.work_order_number}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ color: '#64748b' }}>{unit.usage_notes || unit.remarks || unit.notes || 'Used in Repair'}</td>
                      {canRestore && (
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-xs btn-secondary"
                            style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                            onClick={() => unmarkUnitAsUsed(unit.serial_number)}
                            title="Restore back to branch in-stock"
                          >
                            <RotateCcw size={11} color="#059669" />
                            <span>Restore</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* VIEW D: FOR OUTTAKE TABLE */}
      {viewSection === 'outtake' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
          <div style={{ padding: '14px 18px', background: '#faf5ff', borderBottom: '1px solid #e9d5ff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#6b21a8' }}>
              For Outtake Parts ({filteredOuttake.length} units)
            </h3>
            <span style={{ fontSize: '12px', color: '#7e22ce' }}>
              Parts scheduled for return to Central DC or Apple Service Logistics
            </span>
          </div>

          <div className="table-container" style={{ overflowX: 'auto' }}>
            {filteredOuttake.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                <LogOut size={32} color="#cbd5e1" style={{ marginBottom: '8px' }} />
                <p style={{ margin: 0, fontSize: '13px' }}>No parts currently scheduled for outtake.</p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f3e8ff' }}>
                    <th style={{ width: '110px' }}>Site Location</th>
                    <th style={{ width: '130px' }}>Part Number</th>
                    <th>Part Description</th>
                    <th style={{ width: '180px' }}>Serial Number</th>
                    <th style={{ width: '130px' }}>Date Marked</th>
                    <th>Outtake Reason / Remarks</th>
                    {canRestore && <th style={{ width: '120px', textAlign: 'center' }}>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredOuttake.map(unit => (
                    <tr key={unit.serial_number}>
                      <td>
                        <span className="badge" style={{ background: '#faf5ff', color: '#6d28d9', border: '1px solid #ddd6fe', fontWeight: 700, fontSize: '11px' }}>
                          {getUnitSiteCode(unit)}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: '#7c3aed', fontFamily: 'var(--font-mono)' }}>{unit.part_number}</strong>
                      </td>
                      <td>{unit.description || 'Replacement Part'}</td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{getCleanDisplaySerial(unit.serial_number, unit)}</span>
                      </td>
                      <td style={{ color: '#64748b' }}>
                        {unit.outtake_at ? String(unit.outtake_at).substring(0, 10) : '—'}
                      </td>
                      <td style={{ color: '#581c87' }}>{unit.outtake_reason || unit.remarks || unit.notes || 'For Outtake'}</td>
                      {canRestore && (
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-xs btn-secondary"
                            style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                            onClick={() => unmarkUnitForOuttake(unit.serial_number)}
                            title="Restore back to in-stock"
                          >
                            <RotateCcw size={11} color="#059669" />
                            <span>Restore</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* VIEW E: TRANSFERRED PARTS TABLE */}
      {viewSection === 'transferred' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
          <div style={{ padding: '14px 18px', background: '#ecfeff', borderBottom: '1px solid #a5f3fc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#155e75' }}>
              Transferred Parts to Other Sites ({filteredTransferred.length} units)
            </h3>
            <span style={{ fontSize: '12px', color: '#0e7490' }}>
              Inter-branch site stock transfers with Transfer Slip numbers
            </span>
          </div>

          <div className="table-container" style={{ overflowX: 'auto' }}>
            {filteredTransferred.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                <ArrowRightLeft size={32} color="#cbd5e1" style={{ marginBottom: '8px' }} />
                <p style={{ margin: 0, fontSize: '13px' }}>No transferred parts recorded for this branch.</p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#cffafe' }}>
                    <th style={{ width: '110px' }}>Origin Site</th>
                    <th style={{ width: '120px' }}>Date Transferred</th>
                    <th style={{ width: '130px' }}>Part Number</th>
                    <th>Part Description</th>
                    <th style={{ width: '170px' }}>Serial Number</th>
                    <th style={{ width: '140px' }}>Destination Site</th>
                    <th style={{ width: '130px' }}>Transfer Slip (TS#)</th>
                    <th>Transfer Remarks</th>
                    {canRestore && <th style={{ width: '120px', textAlign: 'center' }}>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredTransferred.map(unit => (
                    <tr key={unit.serial_number}>
                      <td>
                        <span className="badge" style={{ background: '#ecfeff', color: '#0e7490', border: '1px solid #a5f3fc', fontWeight: 700, fontSize: '11px' }}>
                          {getUnitSiteCode(unit)}
                        </span>
                      </td>
                      <td style={{ color: '#0e7490', fontWeight: 600 }}>
                        {unit.transferred_at ? String(unit.transferred_at).substring(0, 10) : (unit.dateTransferred || '—')}
                      </td>
                      <td>
                        <strong style={{ color: '#0891b2', fontFamily: 'var(--font-mono)' }}>{unit.part_number}</strong>
                      </td>
                      <td>{unit.description || 'Replacement Part'}</td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{getCleanDisplaySerial(unit.serial_number, unit)}</span>
                      </td>
                      <td>
                        <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontWeight: 700 }}>
                          {unit.transferred_to_site_code || unit.targetSiteCode || 'Other Site'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#155e75' }}>
                          {unit.transfer_slip_number || unit.ts_number || '—'}
                        </span>
                      </td>
                      <td style={{ color: '#64748b' }}>{unit.remarks || unit.notes || 'Transferred'}</td>
                      {canRestore && (
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-xs btn-secondary"
                            style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                            onClick={() => unmarkUnitTransfer(unit.serial_number)}
                            title="Restore back to in-stock"
                          >
                            <RotateCcw size={11} color="#059669" />
                            <span>Restore</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* VIEW F: SITE STOCK BREAKDOWN */}
      {viewSection === 'summary' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
          <div style={{ padding: '14px 18px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#166534' }}>
              Site Stock Summary Balance ({filteredSummary.length} Part Numbers)
            </h3>
            <span style={{ fontSize: '12px', color: '#15803d' }}>
              Aggregated serialized inventory counts matching the Excel "Site Stock" section
            </span>
          </div>

          <div className="table-container" style={{ overflowX: 'auto' }}>
            {filteredSummary.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                <Boxes size={32} color="#cbd5e1" style={{ marginBottom: '8px' }} />
                <p style={{ margin: 0, fontSize: '13px' }}>No part catalog records found.</p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#dcfce7' }}>
                    <th style={{ width: '110px' }}>Site</th>
                    <th style={{ width: '140px' }}>Part Number</th>
                    <th>Part Description</th>
                    <th style={{ width: '120px', textAlign: 'center' }}>In-Stock Count</th>
                    <th style={{ width: '110px', textAlign: 'center' }}>Used Count</th>
                    <th style={{ width: '110px', textAlign: 'center' }}>Outtake Count</th>
                    <th style={{ width: '120px', textAlign: 'center' }}>Transferred</th>
                    <th style={{ width: '120px', textAlign: 'center' }}>Total Lifetime</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSummary.map(row => (
                    <tr key={row.partNumber}>
                      <td style={{ color: '#64748b', fontWeight: 600 }}>{activeSiteObj.code}</td>
                      <td>
                        <strong style={{ color: '#059669', fontFamily: 'var(--font-mono)' }}>{row.partNumber}</strong>
                      </td>
                      <td>{row.description || 'Replacement Part'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="badge" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', fontWeight: 800, fontSize: '12px' }}>
                          {row.inStockCount}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', color: '#b45309', fontWeight: 700 }}>{row.usedCount}</td>
                      <td style={{ textAlign: 'center', color: '#7c3aed', fontWeight: 700 }}>{row.outtakeCount}</td>
                      <td style={{ textAlign: 'center', color: '#0891b2', fontWeight: 700 }}>{row.transferredCount}</td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>{row.totalCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: RECORD PART USED */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {isMarkUsedOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsMarkUsedOpen(false); }}>
          <div className="modal-card" style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ background: '#d97706', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wrench size={18} />
                <h3 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>Record Part Used in Repair</h3>
              </div>
              <button type="button" onClick={() => setIsMarkUsedOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleConfirmMarkUsed} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Select In-Stock Part / Serial Number *
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', fontSize: '12.5px', fontFamily: 'var(--font-mono)' }}
                  value={selectedUnitSerial}
                  onChange={(e) => setSelectedUnitSerial(e.target.value)}
                  required
                >
                  <option value="">-- Select In-Stock Serialized Part --</option>
                  {siteData.inStock.filter(u => !u.is_summary_only).map(u => (
                    <option key={u.serial_number} value={u.serial_number}>
                      {u.part_number} — {getCleanDisplaySerial(u.serial_number, u)} ({u.description})
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  Or enter serial manually if not in list:
                </span>
                <input
                  type="text"
                  className="form-input"
                  style={{ marginTop: '4px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                  placeholder="Type Serial Number..."
                  value={selectedUnitSerial}
                  onChange={(e) => setSelectedUnitSerial(e.target.value.toUpperCase())}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Date Used *
                </label>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: '100%', fontSize: '12px' }}
                  value={markUsedDate}
                  onChange={(e) => setMarkUsedDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Repair Order / OC Number
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', fontSize: '12px' }}
                  placeholder="e.g. 20045111 or OC# 20034848"
                  value={markUsedOrderNumber}
                  onChange={(e) => setMarkUsedOrderNumber(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Usage Remarks
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', fontSize: '12px' }}
                  placeholder="e.g. Battery replacement for iPhone 13"
                  value={markUsedNotes}
                  onChange={(e) => setMarkUsedNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsMarkUsedOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" style={{ background: '#d97706', borderColor: '#d97706' }}>
                  Save Usage Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: TRANSFER PART */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {isTransferOpen && (
        <div className="modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) closeTransferModal(); }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="transfer-part-title" style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ background: '#0891b2', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ArrowRightLeft size={18} />
                <h3 id="transfer-part-title" style={{ margin: 0, fontSize: '15px', color: '#fff' }}>Transfer Part to Other Site</h3>
              </div>
              <button type="button" aria-label="Close transfer dialog" onClick={closeTransferModal} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleConfirmTransfer} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Select Serialized Part to Transfer *
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', fontSize: '12.5px', fontFamily: 'var(--font-mono)' }}
                  value={selectedUnitSerial}
                  onChange={(e) => setSelectedUnitSerial(e.target.value)}
                  required
                >
                  <option value="">-- Select Serialized Part to Transfer --</option>
                  {siteData.inStock.filter(u => !u.is_summary_only).map(u => (
                    <option key={u.serial_number} value={u.serial_number}>
                      {u.part_number} — {getCleanDisplaySerial(u.serial_number, u)} ({u.description})
                    </option>
                  ))}
                </select>
                {siteData.inStock.length === 0 && (
                  <div style={{ marginTop: '5px', fontSize: '11px', color: '#b45309' }}>
                    No in-stock serialized parts are available at this branch.
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Destination Branch *
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', fontSize: '12.5px' }}
                  value={transferTargetSiteId}
                  onChange={(e) => setTransferTargetSiteId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Destination Branch --</option>
                  {sites.filter(s => !s.is_dc && s.is_active !== false && s.id !== activeSiteObj.id && s.code !== activeSiteObj.code).map(s => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Transfer Slip Number (TS#)
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                  placeholder="e.g. TS526151"
                  value={transferSlipNumber}
                  onChange={(e) => setTransferSlipNumber(e.target.value.toUpperCase())}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Date Transferred *
                </label>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: '100%', fontSize: '12px' }}
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Transfer Remarks
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', fontSize: '12px' }}
                  placeholder="e.g. TS526151 to GL5"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={closeTransferModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={siteData.inStock.length === 0} style={{ background: '#0891b2', borderColor: '#0891b2' }}>
                  Confirm Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: MARK FOR OUTTAKE */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {isOuttakeOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsOuttakeOpen(false); }}>
          <div className="modal-card" style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ background: '#7c3aed', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <LogOut size={18} />
                <h3 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>Mark Part for Outtake</h3>
              </div>
              <button type="button" onClick={() => setIsOuttakeOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleConfirmOuttake} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Select Serialized Part *
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', fontSize: '12.5px', fontFamily: 'var(--font-mono)' }}
                  value={selectedUnitSerial}
                  onChange={(e) => setSelectedUnitSerial(e.target.value)}
                  required
                >
                  <option value="">-- Select Serialized Part for Outtake --</option>
                  {siteData.inStock.filter(u => !u.is_summary_only).map(u => (
                    <option key={u.serial_number} value={u.serial_number}>
                      {u.part_number} — {getCleanDisplaySerial(u.serial_number, u)} ({u.description})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Outtake Reason
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', fontSize: '12px' }}
                  value={outtakeReason}
                  onChange={(e) => setOuttakeReason(e.target.value)}
                >
                  <option value="Return to DC / Apple">Return to DC / Apple</option>
                  <option value="Damaged Pin / Defective Return">Damaged Pin / Defective Return</option>
                  <option value="Damaged Packaging">Damaged Packaging</option>
                  <option value="Buffer Rebalancing">Buffer Rebalancing</option>
                  <option value="Apple Audit Pull">Apple Audit Pull</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                  Additional Remarks
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', fontSize: '12px' }}
                  placeholder="Optional details or return ticket reference..."
                  value={outtakeNotes}
                  onChange={(e) => setOuttakeNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsOuttakeOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" style={{ background: '#7c3aed', borderColor: '#7c3aed' }}>
                  Confirm Outtake
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 4: IMPORT SITE STOCK MONITORING SPREADSHEET */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {isImportOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (isImporting || importProgress.active) return;
            if (e.target === e.currentTarget) setIsImportOpen(false);
          }}
        >
          <div className="modal-card" style={{ maxWidth: '640px' }}>
            <div className="modal-header" style={{ background: '#0284c7', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UploadCloud size={18} />
                <h3 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>
                  {importProgress.active
                    ? 'Importing Site Stock Monitoring...'
                    : 'Import Site Stock Monitoring (XLSX / CSV)'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isImporting || importProgress.active) return;
                  setIsImportOpen(false);
                }}
                disabled={isImporting || importProgress.active}
                style={{
                  background: 'none',
                  border: 'none',
                  color: (isImporting || importProgress.active) ? 'rgba(255,255,255,0.4)' : '#fff',
                  cursor: (isImporting || importProgress.active) ? 'not-allowed' : 'pointer'
                }}
              >
                <X size={16} />
              </button>
            </div>

            {importProgress.active ? (
              <div style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '16px' }}>
                <div style={{
                  width: '68px',
                  height: '68px',
                  borderRadius: '50%',
                  background: '#e0f2fe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(2, 132, 199, 0.2)'
                }}>
                  <RefreshCw size={34} color="#0284c7" className="animate-spin" />
                </div>

                <div style={{ maxWidth: '500px' }}>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
                    {importProgress.stage || 'Importing Inventory Records...'}
                  </h4>
                  <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                    {importProgress.detail || 'Please wait while records are validated, structured, and saved.'}
                  </p>
                </div>

                {/* Progress Bar Container */}
                <div style={{ width: '100%', maxWidth: '520px', marginTop: '6px' }}>
                  <div style={{
                    width: '100%',
                    height: '14px',
                    background: '#e2e8f0',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    position: 'relative',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)'
                  }}>
                    <div style={{
                      width: `${Math.min(100, Math.max(5, importProgress.percent))}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #0284c7 0%, #38bdf8 100%)',
                      borderRadius: '8px',
                      transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: '0 0 10px rgba(56, 189, 248, 0.6)'
                    }} />
                  </div>

                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#64748b'
                  }}>
                    <span>
                      {importProgress.current > 0
                        ? `Processed ${importProgress.current.toLocaleString()} / ${importProgress.total.toLocaleString()} units`
                        : `${importProgress.total ? importProgress.total.toLocaleString() : (importParsedBatch?.summary?.valid || 0)} total units`}
                    </span>
                    <span style={{ color: '#0284c7', fontWeight: 800, fontSize: '13px' }}>
                      {importProgress.percent}%
                    </span>
                  </div>
                </div>

                {/* Step indicator pills */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  width: '100%',
                  maxWidth: '520px',
                  marginTop: '8px'
                }}>
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: importProgress.percent >= 25 ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${importProgress.percent >= 25 ? '#bbf7d0' : '#e2e8f0'}`,
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: importProgress.percent >= 25 ? '#15803d' : '#64748b',
                    fontWeight: 600
                  }}>
                    <CheckCircle2 size={13} color={importProgress.percent >= 25 ? '#16a34a' : '#94a3b8'} />
                    <span>1. Clean Slate</span>
                  </div>

                  <div style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: importProgress.percent >= 35 ? (importProgress.percent >= 75 ? '#f0fdf4' : '#eff6ff') : '#f8fafc',
                    border: `1px solid ${importProgress.percent >= 35 ? (importProgress.percent >= 75 ? '#bbf7d0' : '#bfdbfe') : '#e2e8f0'}`,
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: importProgress.percent >= 35 ? (importProgress.percent >= 75 ? '#15803d' : '#0284c7') : '#64748b',
                    fontWeight: 600
                  }}>
                    {importProgress.percent >= 75 ? (
                      <CheckCircle2 size={13} color="#16a34a" />
                    ) : (
                      <RefreshCw size={13} className={importProgress.percent >= 35 ? 'animate-spin' : ''} color={importProgress.percent >= 35 ? '#0284c7' : '#94a3b8'} />
                    )}
                    <span>2. Structure Parts</span>
                  </div>

                  <div style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: importProgress.percent >= 75 ? (importProgress.percent >= 100 ? '#f0fdf4' : '#eff6ff') : '#f8fafc',
                    border: `1px solid ${importProgress.percent >= 75 ? (importProgress.percent >= 100 ? '#bbf7d0' : '#bfdbfe') : '#e2e8f0'}`,
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: importProgress.percent >= 75 ? (importProgress.percent >= 100 ? '#15803d' : '#0284c7') : '#64748b',
                    fontWeight: 600
                  }}>
                    {importProgress.percent >= 100 ? (
                      <CheckCircle2 size={13} color="#16a34a" />
                    ) : (
                      <UploadCloud size={13} color={importProgress.percent >= 75 ? '#0284c7' : '#94a3b8'} />
                    )}
                    <span>3. Cloud Sync</span>
                  </div>
                </div>

                <div style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  fontSize: '11.5px',
                  color: '#64748b',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: '4px'
                }}>
                  <Info size={13} color="#0284c7" />
                  <span>Please keep this window open until import completes. All retail sheets are synchronized automatically.</span>
                </div>
              </div>
            ) : (
              <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ margin: 0, fontSize: '12px', color: '#475569' }}>
                  Upload <strong>Site Stock Monitoring.xlsx</strong> or an individual branch sheet. The system replicates the 4 lifecycle tables (Stock on Hand, Used Parts, Outtake, Transferred) and directly updates the branch database without manual data entry.
                </p>

                {/* Upload Dropzone */}
                <div
                  onClick={() => !isImporting && fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed #0284c7',
                    borderRadius: '10px',
                    padding: '24px',
                    textAlign: 'center',
                    cursor: isImporting ? 'not-allowed' : 'pointer',
                    background: '#f0f9ff'
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  />
                  <FileSpreadsheet size={32} color="#0284c7" style={{ marginBottom: '8px' }} />
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                    {isImporting ? 'Processing and validating spreadsheet...' : 'Click to select or drop Site Stock Monitoring file'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Supports Microsoft Excel (.xlsx, .xls) and .csv
                  </div>
                </div>

                {/* Template Download Link */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px' }}>
                  <span style={{ color: '#64748b' }}>Need the official spreadsheet structure?</span>
                  <button
                    type="button"
                    className="btn btn-xs btn-secondary"
                    onClick={() => downloadSiteStockMonitoringTemplate(activeSiteObj.code)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Download size={11} color="#059669" />
                    <span>Download Excel Template</span>
                  </button>
                </div>

                {/* Sheet Selector (for multi-sheet workbooks) */}
                {importParsedBatch && importParsedBatch.availableSheets?.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', minWidth: '85px', margin: 0 }}>
                      Active Sheet:
                    </label>
                    <select
                      className="form-select form-select-sm"
                      value={importSelectedSheet}
                      onChange={(e) => handleSheetChange(e.target.value)}
                      style={{ fontSize: '12px', fontWeight: 600, flex: 1, padding: '4px 8px' }}
                    >
                      <option value="ALL_SHEETS">
                        ★ All 27 Retail Branch Sheets (Update All 26 Sites — Consolidated)
                      </option>
                      {importParsedBatch.availableSheets.filter(s => s !== 'ALL_SHEETS').map(sName => (
                        <option key={sName} value={sName}>
                          Branch Sheet: {sName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Parsed Preview Statistics */}
                {importParsedBatch && (
                  <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: '8px', padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={16} color="#16a34a" />
                        <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                          {importParsedBatch.activeSheet === 'ALL_SHEETS' ? 'All 27 Branch Sheets' : `Sheet "${importParsedBatch.activeSheet}"`} Ready to Import
                        </strong>
                      </div>
                      <span className="badge" style={{ background: '#16a34a', color: '#fff', fontWeight: 800 }}>
                        {importParsedBatch.summary.valid} Valid Records
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', textAlign: 'center', fontSize: '11px' }}>
                      <div style={{ background: '#fff', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        <div style={{ color: '#1e40af', fontWeight: 700 }}>In-Stock</div>
                        <div style={{ fontSize: '14px', fontWeight: 800 }}>{importParsedBatch.summary.inStock || 0}</div>
                      </div>
                      <div style={{ background: '#fff', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        <div style={{ color: '#92400e', fontWeight: 700 }}>Used</div>
                        <div style={{ fontSize: '14px', fontWeight: 800 }}>{importParsedBatch.summary.used || 0}</div>
                      </div>
                      <div style={{ background: '#fff', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        <div style={{ color: '#6b21a8', fontWeight: 700 }}>Outtake</div>
                        <div style={{ fontSize: '14px', fontWeight: 800 }}>{importParsedBatch.summary.outtake || 0}</div>
                      </div>
                      <div style={{ background: '#fff', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        <div style={{ color: '#155e75', fontWeight: 700 }}>Transferred</div>
                        <div style={{ fontSize: '14px', fontWeight: 800 }}>{importParsedBatch.summary.transferred || 0}</div>
                      </div>
                    </div>

                    {/* Optional Pre-Import Clean Slate Checkbox */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '12px', padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '12px', color: '#92400e', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={clearBeforeImport}
                        onChange={(e) => setClearBeforeImport(e.target.checked)}
                        style={{ width: '16px', height: '16px', accentColor: '#d97706' }}
                      />
                      <span>
                        {importParsedBatch.activeSheet === 'ALL_SHEETS' || activeSiteObj.id === 'ALL'
                          ? `Clear all old parts across all ${branchSitesCount} retail branch sites before importing (recommended)`
                          : `Clear existing old parts for ${activeSiteObj.name} before importing (recommended)`}
                      </span>
                    </label>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={isImporting || importProgress.active}
                    onClick={() => setIsImportOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{
                      background: '#0284c7',
                      borderColor: '#0284c7',
                      minWidth: '180px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      cursor: (!importParsedBatch || importParsedBatch.summary.valid === 0 || isImporting || importProgress.active) ? 'not-allowed' : 'pointer'
                    }}
                    disabled={!importParsedBatch || importParsedBatch.summary.valid === 0 || isImporting || importProgress.active}
                    onClick={handleConfirmImport}
                  >
                    {isImporting || importProgress.active ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Importing Records...</span>
                      </>
                    ) : (
                      <span>Confirm &amp; Insert {importParsedBatch?.summary?.valid || 0} Records</span>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 8. Clear Parts Confirmation Modal (Superadmin Only) */}
      {isSuperadmin && isClearPartsOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(3px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div className="modal-dialog" style={{ background: '#ffffff', borderRadius: '12px', maxWidth: '520px', width: '100%', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)', border: '1px solid #fecaca', overflow: 'hidden' }}>
            
            <div style={{ padding: '16px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ padding: '6px', background: '#fee2e2', borderRadius: '8px', color: '#dc2626' }}>
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#991b1b' }}>
                    Clear Site Parts
                  </h3>
                  <div style={{ fontSize: '11px', color: '#b91c1c' }}>
                    Remove old shipped parts to prepare for latest Excel import
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsClearPartsOpen(false)}
                disabled={isClearingParts}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div style={{ fontSize: '12.5px', color: '#475569', lineHeight: 1.5 }}>
                Select the scope of parts to clear. This will remove previous stock units shipped by the DC so you can import <strong>Site Stock Monitoring.xlsx</strong> fresh with zero conflicting or obsolete records.
              </div>

              {/* Scope Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: clearPartsScope === 'CURRENT' ? '2px solid #dc2626' : '1px solid #e2e8f0',
                    background: clearPartsScope === 'CURRENT' ? '#fff1f2' : '#f8fafc',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="clearScope"
                    value="CURRENT"
                    checked={clearPartsScope === 'CURRENT'}
                    onChange={() => setClearPartsScope('CURRENT')}
                    style={{ marginTop: '3px', accentColor: '#dc2626' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: '13px', color: '#0f172a' }}>
                      Clear Current Site: {activeSiteObj.name} ({activeSiteObj.code})
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                      Clears <strong>{siteData.totalUnits}</strong> parts ({siteData.inStock.length} in-stock, {siteData.used.length} used, {siteData.outtake.length} outtake, {siteData.transferred.length} transferred) from {activeSiteObj.code}.
                    </div>
                  </div>
                </label>

                {(!isPmgUser || isSuperadmin) && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: clearPartsScope === 'ALL' ? '2px solid #dc2626' : '1px solid #e2e8f0',
                      background: clearPartsScope === 'ALL' ? '#fff1f2' : '#f8fafc',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="clearScope"
                      value="ALL"
                      checked={clearPartsScope === 'ALL'}
                      onChange={() => setClearPartsScope('ALL')}
                      style={{ marginTop: '3px', accentColor: '#dc2626' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: '13px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Clear ALL Retail Branches ({branchSitesCount} Sites)</span>
                        <span className="badge" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', fontSize: '10.5px' }}>
                          Network-wide
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                        Clears all <strong>{allBranchUnitsCount}</strong> old parts across all {branchSitesCount} retail branch sites. <em>Central DC stock is strictly preserved.</em>
                      </div>
                    </div>
                  </label>
                )}

                {isSuperadmin && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: clearPartsScope === 'SYSTEM' ? '2px solid #991b1b' : '1px solid #e2e8f0',
                      background: clearPartsScope === 'SYSTEM' ? '#fef2f2' : '#f8fafc',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="clearScope"
                      value="SYSTEM"
                      checked={clearPartsScope === 'SYSTEM'}
                      onChange={() => setClearPartsScope('SYSTEM')}
                      style={{ marginTop: '3px', accentColor: '#991b1b' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: '13px', color: '#991b1b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Clear ENTIRE System (All {branchSitesCount} Retail Sites + Central DC)</span>
                        <span className="badge" style={{ background: '#991b1b', color: '#fff', fontSize: '10.5px' }}>
                          Superadmin Reset
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                        Purges all parts system-wide ({inventoryUnits.length} total units across Central DC and all {branchSitesCount} retail sites) for a completely clean slate before importing the master Excel file.
                      </div>
                    </div>
                  </label>
                )}
              </div>

              {/* Safety Notice */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '11.5px', color: '#92400e' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: '1px' }} />
                  <div>
                    <strong>Important:</strong> After clearing, the selected site(s) will be set to 0 parts. You can immediately import your updated <strong>Site Stock Monitoring.xlsx</strong> file to populate all current live parts and history.
                  </div>
                </div>
                <div style={{ borderTop: '1px dashed #fcd34d', paddingTop: '6px', fontSize: '11px', color: '#78350f', fontWeight: 600 }}>
                  ✓ <strong>Shipment Records Protected:</strong> All DC shipments, packing lists, dispatches, and delivery logs are 100% preserved. The clear feature applies strictly to site inventory parts.
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={isClearingParts}
                  onClick={() => setIsClearPartsOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{
                    background: '#dc2626',
                    borderColor: '#dc2626',
                    color: '#ffffff',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 16px'
                  }}
                  disabled={isClearingParts}
                  onClick={handleConfirmClearParts}
                >
                  {isClearingParts ? (
                    <>
                      <RefreshCw size={13} className="spin" />
                      <span>Clearing Site Parts...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={13} />
                      <span>Confirm Clear {clearPartsScope === 'ALL' ? 'All Sites' : activeSiteObj.code} Parts</span>
                    </>
                  )}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
