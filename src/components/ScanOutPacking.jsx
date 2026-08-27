import { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { generatePackingListPDF, printPackingListDirect } from '../utils/pdfGenerator';
import {
  PackageCheck,
  Printer,
  Download,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Trash2,
  FileSpreadsheet,
  UploadCloud,
  FileText,
  X,
  RefreshCw,
  Search,
  Check,
  AlertTriangle,
  RotateCcw,
  Database,
  Eye,
  History,
  Calendar,
  Boxes,
  Copy,
  Plus,
  Building2,
  MapPin,
  ChevronDown,
  ChevronUp,
  Lock,
  Users,
  ShieldAlert,
  SlidersHorizontal
} from 'lucide-react';
import { parseScanOutPartsFile, downloadScanOutTemplate } from '../utils/excelParser';
import { isLockedConfirmedShipment, generateNextInvoiceRef } from '../utils/appContextHelpers';
import mobileCareLogo from '../assets/mobilecare_logo.png';

export default function ScanOutPacking() {
  const {
    sites,
    inventoryUnits,
    parts,
    categories,
    shipments,
    saveShipment,
    deleteShipment,
    addScanOutUnit,
    removeScanOutUnit,
    batchAddScanOutUnits,
    clearShipmentDraftItems,
    currentUser,
    showToast,
    autoRefreshData,
    isAutoRefreshing,
    canUserDeleteRecord,
    activePackingStations,
    broadcastPackingPresence
  } = useApp();

  const serviceSites = useMemo(() => {
    return (sites || []).filter(s => !s.is_dc);
  }, [sites]);

  const [selectedSiteId, setSelectedSiteId] = useState(() => serviceSites[0]?.id || '');

  const selectedSite = useMemo(() => {
    return sites.find(s => s.id === selectedSiteId) || serviceSites[0] || {};
  }, [sites, selectedSiteId, serviceSites]);

  // Pop-up Site Selection Modal State
  const [isSiteModalOpen, setIsSiteModalOpen] = useState(false);
  const [siteSearchQuery, setSiteSearchQuery] = useState('');
  const [siteRegionFilter, setSiteRegionFilter] = useState('ALL');

  const [totalBoxes, setTotalBoxes] = useState(1);
  const [boxNumber, setBoxNumber] = useState(1);
  const [inspectShipmentModal, setInspectShipmentModal] = useState(null);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

  // User-isolated draft storage key (prevents draft clashing between simultaneous users)
  const userDraftStorageKey = useMemo(() => {
    return currentUser?.id ? `mdc_pack_draft_${currentUser.id}` : 'mdc_pack_draft_default';
  }, [currentUser]);

  // Active Shipment Draft with user-scoped LocalStorage persistence
  const [currentShipment, setCurrentShipment] = useState(() => {
    const userKey = currentUser?.id ? `mdc_pack_draft_${currentUser.id}` : 'mdc_pack_draft_default';
    const isFirstSiteMM = serviceSites[0]?.region === 'Metro Manila';
    const initialCourier = isFirstSiteMM ? 'Lalamove' : 'Lite Express';

    try {
      const saved = localStorage.getItem(userKey) || localStorage.getItem('mdc_active_pack_draft');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id && Array.isArray(parsed.items) && parsed.items.length > 0) {
          const rawTrk = parsed.tracking_number;
          const cleanTrk = (rawTrk === '20227258' || rawTrk === '20227303') ? '' : (rawTrk || '');
          return {
            ...parsed,
            carrier: parsed.carrier || parsed.courier || initialCourier,
            courier: parsed.carrier || parsed.courier || initialCourier,
            transfer_slip_number: parsed.transfer_slip_number || parsed.transfer_slip || '',
            pickup_by_name: parsed.pickup_by_name || (parsed.carrier === 'Utility' ? 'Utility' : ''),
            tracking_number: cleanTrk,
            prepared_by_name: currentUser?.fullName || parsed.prepared_by_name || ''
          };
        }
      }
    } catch (e) {
      console.warn('Could not read user pack draft:', e);
    }
    const existing = shipments.find(s => s.site_id === serviceSites[0]?.id && s.status === 'draft');
    if (existing && Array.isArray(existing.items) && existing.items.length > 0) {
      const rawTrk = existing.tracking_number;
      const cleanTrk = (rawTrk === '20227258' || rawTrk === '20227303') ? '' : (rawTrk || '');
      return {
        ...existing,
        carrier: existing.carrier || existing.courier || initialCourier,
        courier: existing.carrier || existing.courier || initialCourier,
        transfer_slip_number: existing.transfer_slip_number || existing.transfer_slip || '',
        pickup_by_name: existing.pickup_by_name || (existing.carrier === 'Utility' ? 'Utility' : ''),
        tracking_number: cleanTrk,
        prepared_by_name: currentUser?.fullName || existing.prepared_by_name || ''
      };
    }
    return {
      id: `ship-${Date.now()}`,
      shipment_number: `SHIP-202608-${String(shipments.length + 1).padStart(3, '0')}`,
      invoice_ref: generateNextInvoiceRef(shipments),
      site_id: serviceSites[0]?.id,
      week_number: 1,
      shipment_date: new Date().toLocaleDateString('en-US'),
      carrier: initialCourier,
      courier: initialCourier,
      tracking_number: '',
      transfer_slip_number: '',
      total_boxes: 1,
      status: 'draft',
      prepared_by_name: currentUser?.fullName || '',
      verified_by_name: 'Anjo Alcazar',
      pickup_by_name: '',
      receiving_signature: serviceSites[0]?.code || 'ASP NPM',
      remarks: 'KGB PARTS',
      items: []
    };
  });

  // Tracking Number Required Prompt Modal State
  const [trackingModalState, setTrackingModalState] = useState(null);
  // trackingModalState: { shipment, items, site, action: 'print' | 'pdf', isDraft, trackingInput, carrierInput }

  // Automatically synchronize Prepared By with currently logged-in user's full name
  useEffect(() => {
    if (currentUser?.fullName) {
      setCurrentShipment(prev => ({
        ...prev,
        prepared_by_name: currentUser.fullName
      }));
    }
  }, [currentUser?.fullName, currentUser?.id]);

  // Ref to track timestamp of local workstation edits
  const lastLocalEditTimeRef = useRef(0);

  const markLocalDraftEdit = () => {
    lastLocalEditTimeRef.current = Date.now();
  };

  // Keep active user draft persisted to user-scoped LocalStorage
  useEffect(() => {
    const isSaved = currentShipment?.id && shipments.some(s => s.id === currentShipment.id && (s.status === 'shipped' || s.status === 'delivered' || s.status === 'saved'));
    if (isSaved) return;

    if (currentShipment?.items && currentShipment.items.length > 0) {
      try {
        localStorage.setItem(userDraftStorageKey, JSON.stringify(currentShipment));
      } catch (e) {
        console.warn('Could not persist pack draft:', e);
      }
    } else {
      try {
        localStorage.removeItem(userDraftStorageKey);
      } catch (e) {}
    }
  }, [currentShipment, shipments, userDraftStorageKey]);

  // Live Packing Presence Heartbeat: broadcast current user's active packing station to peers
  useEffect(() => {
    if (!currentUser || !broadcastPackingPresence) return;

    const sendPresence = (isPacking = true) => {
      broadcastPackingPresence({
        userId: currentUser.id || 'user',
        userName: currentUser.fullName || currentUser.name || 'Warehouse Staff',
        userEmail: currentUser.email || '',
        siteId: selectedSiteId,
        siteCode: selectedSite?.code || '',
        siteName: selectedSite?.name || '',
        itemCount: (currentShipment?.items || []).length,
        isPacking
      });
    };

    sendPresence(true);
    const heartbeatInterval = setInterval(() => {
      sendPresence(true);
    }, 10000);

    return () => {
      clearInterval(heartbeatInterval);
      sendPresence(false);
    };
  }, [currentUser, selectedSiteId, selectedSite, currentShipment, broadcastPackingPresence]);

  const [partNumberInput, setPartNumberInput] = useState('');
  const [serialInput, setSerialInput] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [manifestSearch, setManifestSearch] = useState('');

  // Clear Confirmation Modal State
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedBatch, setParsedBatch] = useState(null);
  const [importFilter, setImportFilter] = useState('ALL'); // 'ALL' | 'VALID' | 'NOT_FOUND'

  const pnInputRef = useRef(null);
  const serialInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Part price map for Declared Value calculations
  const partPriceMap = useMemo(() => {
    const map = new Map();
    (parts || []).forEach(p => {
      if (p.part_number) {
        map.set(p.part_number.toUpperCase(), p.stocking_price ?? p.price ?? 50);
      }
    });
    return map;
  }, [parts]);

  // Total Declared Value = sum of (part price × 85 PHP)
  const totalDeclaredValuePHP = useMemo(() => {
    const items = currentShipment?.items;
    if (!items || items.length === 0) return 0;
    return items.reduce((sum, it) => {
      const priceUSD = it.stocking_price ?? it.price ?? (partPriceMap.get(it.part_number?.toUpperCase()) || (it.description?.toLowerCase().includes('display') ? 279 : (it.description?.toLowerCase().includes('battery') ? 99 : 50)));
      return sum + (priceUSD * 85);
    }, 0);
  }, [currentShipment, partPriceMap]);

  // Auto-focus Part Number input on mount
  useEffect(() => {
    pnInputRef.current?.focus();
  }, []);

  // Update shipment when site changes (auto-select Courier: Lalamove for MM, Lite Express for provincial)
  const handleSiteChange = (newSiteId) => {
    setSelectedSiteId(newSiteId);
    const siteObj = sites.find(s => s.id === newSiteId);
    const isMM = siteObj?.region === 'Metro Manila';
    const autoCourier = isMM ? 'Lalamove' : 'Lite Express';

    setCurrentShipment(prev => ({
      ...prev,
      site_id: newSiteId,
      carrier: prev.carrier === 'Utility' ? 'Utility' : autoCourier,
      courier: prev.carrier === 'Utility' ? 'Utility' : autoCourier,
      receiving_signature: siteObj?.code || 'ASP NPM',
      pickup_by_name: prev.carrier === 'Utility' ? 'Utility' : prev.pickup_by_name
    }));
  };

  // Handler for Courier selection changes (auto-set Pickup By: Utility when Utility selected)
  const handleCourierChange = (newCourier) => {
    setCurrentShipment(prev => ({
      ...prev,
      carrier: newCourier,
      courier: newCourier,
      pickup_by_name: newCourier === 'Utility' ? 'Utility' : (prev.pickup_by_name === 'Utility' ? '' : prev.pickup_by_name)
    }));
  };

  // Filtered sites for Pop-up Modal
  const availableRegions = useMemo(() => {
    const set = new Set(serviceSites.map(s => s.region || 'Metro Manila'));
    return ['ALL', ...Array.from(set)];
  }, [serviceSites]);

  const filteredServiceSites = useMemo(() => {
    return serviceSites.filter(site => {
      if (siteRegionFilter !== 'ALL' && (site.region || 'Metro Manila') !== siteRegionFilter) {
        return false;
      }
      if (siteSearchQuery.trim()) {
        const q = siteSearchQuery.toLowerCase().trim();
        const code = (site.code || '').toLowerCase();
        const name = (site.name || '').toLowerCase();
        const region = (site.region || '').toLowerCase();
        const addr = (site.address || site.full_address || '').toLowerCase();
        const contact = (site.contact_person || '').toLowerCase();
        const shipTo = (site.ship_to || '').toLowerCase();
        return code.includes(q) || name.includes(q) || region.includes(q) || addr.includes(q) || contact.includes(q) || shipTo.includes(q);
      }
      return true;
    });
  }, [serviceSites, siteRegionFilter, siteSearchQuery]);

  const handleSelectSiteFromModal = (site) => {
    handleSiteChange(site.id);
    setIsSiteModalOpen(false);
    showToast(`Destination branch set to ${site.code} (${site.name})`, 'success');
  };

  // Keyboard HID submission handlers
  const handlePnKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (partNumberInput.trim()) {
        serialInputRef.current?.focus();
      }
    }
  };

  const handleSerialKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executePackScan();
    }
  };

  const executePackScan = () => {
    const cleanPN = partNumberInput.trim().toUpperCase();
    const cleanSerial = serialInput.trim().toUpperCase();

    if (!cleanPN || !cleanSerial) {
      setScanResult({ type: 'error', message: 'Please scan both Part Number and Serial Number' });
      return;
    }

    markLocalDraftEdit();

    const res = addScanOutUnit({
      shipmentId: currentShipment.id,
      siteId: selectedSiteId,
      partNumber: cleanPN,
      serialNumber: cleanSerial,
      boxNumber: boxNumber
    });

    if (res.success) {
      setScanResult({
        type: 'success',
        message: `Packed: ${res.item.description} (SN: ${res.item.serial_number}) into Box ${boxNumber}`
      });

      const updatedDraft = {
        ...currentShipment,
        items: [...(currentShipment.items || []), res.item],
        updated_at: new Date().toISOString()
      };
      setCurrentShipment(updatedDraft);

      setSerialInput('');
      serialInputRef.current?.focus();
    } else {
      setScanResult({
        type: 'error',
        message: res.error
      });
      serialInputRef.current?.select();
    }
  };

  // Packed serial numbers in active draft set for O(1) deduplication
  const packedSerialsSet = useMemo(() => {
    const set = new Set();
    (currentShipment?.items || []).forEach(it => {
      const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
      if (s) set.add(s);
    });
    return set;
  }, [currentShipment]);

  // Reliable Available Stock Calculation (excluding items already in active draft)
  const availableStockUnits = useMemo(() => {
    return (inventoryUnits || []).filter(u => {
      const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
      if (packedSerialsSet.has(cleanSerial)) return false;
      return u.status === 'in_stock' || (!u.status && u.current_site_id === 'site-dc');
    });
  }, [inventoryUnits, packedSerialsSet]);

  // State for upgraded Available Stock Verification UI
  const [stockSearch, setStockSearch] = useState('');
  const [stockCategoryTab, setStockCategoryTab] = useState('ALL'); // 'ALL' | category code
  const [stockInspectUnit, setStockInspectUnit] = useState(null); // unit for detail modal
  const [copiedSerial, setCopiedSerial] = useState(null);

  const handleCopySerial = (serial) => {
    if (!serial) return;
    try {
      navigator.clipboard?.writeText(serial);
      setCopiedSerial(serial);
      showToast(`Copied serial #${serial} to clipboard`, 'info');
      setTimeout(() => setCopiedSerial(null), 2500);
    } catch (e) {}
  };

  const getCategoryBadgeStyle = (catCode = '') => {
    const code = String(catCode).toUpperCase();
    if (code.includes('BATTERY')) return { background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' };
    if (code.includes('DISPLAY')) return { background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' };
    if (code.includes('CAMERA')) return { background: '#f3e8ff', color: '#7e22ce', border: '1px solid #e9d5ff' };
    if (code.includes('BACK') || code.includes('GLASS')) return { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' };
    if (code.includes('MID') || code.includes('REAR')) return { background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' };
    return { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' };
  };

  // Enrich available stock units with part catalog info and accurate Apple category classification
  const enrichedStockUnits = useMemo(() => {
    const partsMap = new Map((parts || []).map(p => [String(p.part_number || '').toUpperCase(), p]));
    const catMap = new Map((categories || []).map(c => [c.id, c]));

    return availableStockUnits.map(unit => {
      const pn = String(unit.part_number || '').toUpperCase();
      const partInfo = partsMap.get(pn);
      const desc = unit.description || partInfo?.description || 'Apple Genuine Service Part';
      const descLower = desc.toLowerCase();

      // Resolve true category from description first, then category_id mapping
      const isDisplay = descLower.includes('display') || descLower.includes('screen');
      const isBattery = descLower.includes('battery');
      const isCamera = descLower.includes('camera');
      const isBackGlass = descLower.includes('back glass') || descLower.includes('rear glass');
      const isMidSystem = descLower.includes('logic') || descLower.includes('mid system') || descLower.includes('rear system');

      const categoryObj = partInfo?.category_id ? catMap.get(partInfo.category_id) : null;
      let categoryName = 'General';
      let categoryCode = 'GENERAL';

      if (isDisplay) {
        categoryName = 'Display';
        categoryCode = 'DISPLAY';
      } else if (isBattery) {
        categoryName = 'Battery';
        categoryCode = 'BATTERY';
      } else if (isCamera) {
        categoryName = 'Camera';
        categoryCode = 'CAMERA';
      } else if (isBackGlass) {
        categoryName = 'Back Glass';
        categoryCode = 'BACK_GLASS';
      } else if (isMidSystem) {
        categoryName = 'Logic / Mid System';
        categoryCode = 'MID_REAR';
      } else if (categoryObj?.name) {
        categoryName = categoryObj.name;
        categoryCode = categoryObj.code || 'GENERAL';
      } else if (pn.startsWith('661-')) {
        categoryName = 'Apple Part';
        categoryCode = 'APPLE_PART';
      }

      const iphoneModel = partInfo?.iphone_model || unit.iphone_model || '';

      return {
        ...unit,
        description: desc,
        iphone_model: iphoneModel,
        category_name: categoryName,
        category_code: categoryCode,
        stocking_price: partInfo?.stocking_price || unit.stocking_price || (isDisplay ? 329 : isBattery ? 99 : 50)
      };
    });
  }, [availableStockUnits, parts, categories]);

  // Filtered Stock Units based on search & category
  const filteredStockUnits = useMemo(() => {
    return enrichedStockUnits.filter(u => {
      // Category filter
      if (stockCategoryTab !== 'ALL') {
        const targetCode = stockCategoryTab.toUpperCase();
        const uCode = (u.category_code || '').toUpperCase();
        const uName = (u.category_name || '').toUpperCase();
        if (uCode !== targetCode && !uName.includes(targetCode)) {
          return false;
        }
      }
      // Search filter
      if (stockSearch.trim()) {
        const q = stockSearch.toLowerCase().trim();
        const matchesPn = (u.part_number || '').toLowerCase().includes(q);
        const matchesSn = (u.serial_number || '').toLowerCase().includes(q);
        const matchesDesc = (u.description || '').toLowerCase().includes(q);
        const matchesModel = (u.iphone_model || '').toLowerCase().includes(q);
        const matchesCat = (u.category_name || '').toLowerCase().includes(q);
        if (!matchesPn && !matchesSn && !matchesDesc && !matchesModel && !matchesCat) return false;
      }
      return true;
    });
  }, [enrichedStockUnits, stockCategoryTab, stockSearch]);

  const uniquePartTypesCount = useMemo(() => {
    const set = new Set(availableStockUnits.map(u => (u.part_number || '').toUpperCase()));
    return set.size;
  }, [availableStockUnits]);

  const handleSimulatePack = (unit, e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (!unit || !unit.serial_number) return;

    markLocalDraftEdit();
    const cleanPN = String(unit.part_number || '').trim();
    const cleanSerial = String(unit.serial_number || '').trim();
    setPartNumberInput(cleanPN);
    setSerialInput(cleanSerial);

    const res = addScanOutUnit({
      shipmentId: currentShipment.id,
      siteId: selectedSiteId,
      partNumber: cleanPN,
      serialNumber: cleanSerial,
      boxNumber: boxNumber
    });

    if (res.success) {
      setScanResult({
        type: 'success',
        message: `[PACKED] ${res.item.description} (#${res.item.serial_number}) into Box ${boxNumber}`
      });
      const updatedDraft = {
        ...currentShipment,
        items: [...(currentShipment.items || []), res.item],
        updated_at: new Date().toISOString()
      };
      setCurrentShipment(updatedDraft);
      setSerialInput('');
    } else {
      setScanResult({ type: 'error', message: res.error });
    }
  };

  // --- XLSX / CSV File Import Handling ---
  const handleFileSelect = async (file) => {
    if (!file) return;
    setIsParsing(true);
    try {
      const res = await parseScanOutPartsFile(file, inventoryUnits, sites, selectedSiteId);
      if (res.success) {
        setParsedBatch(res);
        showToast(`Parsed ${res.summary.total} rows (${res.summary.valid} ready to pack)`, 'info');
      } else {
        showToast(res.error || 'Failed to parse pack file', 'error');
        setParsedBatch(null);
      }
    } catch (err) {
      console.error(err);
      showToast('Error processing file: ' + err.message, 'error');
      setParsedBatch(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleDownloadTemplate = (format) => {
    downloadScanOutTemplate(format, sites, inventoryUnits);
    showToast(`Downloaded Scan-Out template (${format.toUpperCase()})`, 'info');
  };

  const handleConfirmBatchPack = () => {
    if (!parsedBatch || !parsedBatch.items) return;

    const validItems = parsedBatch.items.filter(it => it.status === 'VALID');
    if (validItems.length === 0) {
      showToast('No valid parts ready to pack.', 'error');
      return;
    }

    markLocalDraftEdit();

    const res = batchAddScanOutUnits({
      shipmentId: currentShipment.id,
      siteId: selectedSiteId,
      items: validItems
    });

    if (res.success) {
      const updatedDraft = {
        ...currentShipment,
        items: [...(currentShipment.items || []), ...res.items],
        updated_at: new Date().toISOString()
      };
      setCurrentShipment(updatedDraft);

      setScanResult({
        type: 'success',
        message: `[BATCH PACK COMPLETE] Packed ${res.count} units from "${parsedBatch.fileName}" into Manifest ${currentShipment.invoice_ref}!`
      });

      setParsedBatch(null);
      setIsImportModalOpen(false);
      pnInputRef.current?.focus();
    } else {
      showToast(res.error || 'Batch pack failed', 'error');
    }
  };

  // --- Safe Individual Item Removal (returns part to DC stock) ---
  const handleRemoveItem = (serialNumber) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) return;

    markLocalDraftEdit();

    const targetItem = (currentShipment.items || []).find(it => 
      String(it.serial_number || it.serialNumber || '').trim().toUpperCase() === cleanSerial
    );

    const res = removeScanOutUnit({
      shipmentId: currentShipment.id,
      serialNumber: cleanSerial,
      partInfo: targetItem
    });

    if (res.success) {
      const remainingItems = (currentShipment.items || []).filter(it => {
        const itemSerial = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
        return itemSerial !== cleanSerial;
      });

      const updatedDraft = {
        ...currentShipment,
        items: remainingItems,
        updated_at: new Date().toISOString()
      };

      setCurrentShipment(updatedDraft);

      if (remainingItems.length > 0) {
        try {
          localStorage.setItem(userDraftStorageKey, JSON.stringify(updatedDraft));
        } catch (e) {}
      } else {
        try {
          localStorage.removeItem(userDraftStorageKey);
        } catch (e) {}
      }
    }
  };

  // --- Safe Clear / Unpack Handling (Clears ONLY active draft, preserves all database history below) ---
  const handleConfirmClearDraft = async () => {
    markLocalDraftEdit();

    // If the active draft has items not yet saved to the database, restore them to DC stock
    if (currentShipment.items && currentShipment.items.length > 0) {
      const isAlreadySaved = shipments.some(s => s.id === currentShipment.id && (s.status === 'saved' || s.status === 'shipped'));
      if (!isAlreadySaved) {
        await clearShipmentDraftItems(currentShipment.id, currentShipment.items);
      }
    }

    try {
      localStorage.removeItem(userDraftStorageKey);
      localStorage.removeItem('mdc_active_pack_draft');
    } catch (e) {}

    // Generate fresh new draft so the user can start a new packing list for another site
    const newDraftId = `ship-${Date.now()}`;
    const newInvoiceRef = generateNextInvoiceRef(shipments);
    const isMM = selectedSite?.region === 'Metro Manila';
    const autoCourier = isMM ? 'Lalamove' : 'Lite Express';

    setCurrentShipment({
      id: newDraftId,
      shipment_number: `SHIP-202608-${String(shipments.length + 1).padStart(3, '0')}`,
      invoice_ref: newInvoiceRef,
      site_id: selectedSiteId,
      week_number: 1,
      shipment_date: new Date().toLocaleDateString('en-US'),
      carrier: autoCourier,
      courier: autoCourier,
      tracking_number: '',
      transfer_slip_number: '',
      total_boxes: 1,
      status: 'draft',
      prepared_by_name: currentUser?.fullName || '',
      verified_by_name: 'Anjo Alcazar',
      pickup_by_name: '',
      receiving_signature: selectedSite?.code || 'ASP NPM',
      remarks: 'KGB PARTS',
      items: []
    });
    setTotalBoxes(1);
    setBoxNumber(1);

    setIsClearModalOpen(false);
    setScanResult(null);
    showToast('Active packing list cleared. Ready to create a new packing list for another site.', 'info');
  };

  // --- Combined Action: Save to Database & Finalize Packing List ---
  const handleFinalizeShipment = async () => {
    if (!currentShipment.items || currentShipment.items.length === 0) {
      showToast('Cannot finalize an empty packing list. Please add parts first.', 'error');
      return;
    }

    markLocalDraftEdit();

    try {
      const cleanTracking = String(currentShipment.tracking_number || '').trim();
      const isMM = selectedSite?.region === 'Metro Manila';
      const autoCourier = currentShipment.carrier || (isMM ? 'Lalamove' : 'Lite Express');

      const finalized = {
        ...currentShipment,
        id: currentShipment.id || `ship-${Date.now()}`,
        carrier: autoCourier,
        courier: autoCourier,
        total_boxes: totalBoxes,
        box_number: boxNumber,
        box_number_label: `${boxNumber}/${totalBoxes}`,
        tracking_number: cleanTracking,
        status: 'shipped',
        created_at: currentShipment.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // 1. Permanently save to Database History and Cloud DB (AWAITED)
      await saveShipment(finalized);

      // 2. Automatically generate and download formatted corporate PDF ONLY if tracking number is provided
      if (cleanTracking) {
        try {
          generatePackingListPDF(finalized, finalized.items || [], selectedSite);
          showToast(`Finalized & Saved Packing List ${finalized.invoice_ref} (${finalized.items.length} parts) to Database with PDF downloaded!`, 'success');
        } catch (pdfErr) {
          console.warn('PDF generation note:', pdfErr);
          showToast(`Finalized & Saved Packing List ${finalized.invoice_ref} (${finalized.items.length} parts) to Database!`, 'success');
        }
      } else {
        showToast(`Finalized & Saved Packing List ${finalized.invoice_ref} (${finalized.items.length} parts) to Database! (Tracking # is blank — PDF download skipped until tracking # is provided).`, 'success');
      }
      
      // 3. Reset draft from localStorage and initialize fresh workstation for next shipment
      try {
        localStorage.removeItem(userDraftStorageKey);
        localStorage.removeItem('mdc_active_pack_draft');
      } catch (e) {}

      const nextShipmentNumber = `SHIP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(shipments.length + 2).padStart(3, '0')}`;
      const nextInvoiceRef = generateNextInvoiceRef([finalized, ...shipments]);

      setCurrentShipment({
        id: `ship-${Date.now()}`,
        shipment_number: nextShipmentNumber,
        invoice_ref: nextInvoiceRef,
        site_id: selectedSiteId,
        week_number: 1,
        shipment_date: new Date().toLocaleDateString('en-US'),
        carrier: autoCourier,
        courier: autoCourier,
        tracking_number: '',
        transfer_slip_number: '',
        total_boxes: 1,
        status: 'draft',
        prepared_by_name: currentUser?.fullName || '',
        verified_by_name: 'Anjo Alcazar',
        pickup_by_name: autoCourier === 'Utility' ? 'Utility' : '',
        receiving_signature: selectedSite?.code || 'ASP NPM',
        remarks: 'KGB PARTS',
        items: []
      });
      setTotalBoxes(1);
      setBoxNumber(1);

      setScanResult(null);
    } catch (err) {
      console.error('Finalize shipment error:', err);
      showToast('Error saving and finalizing packing list: ' + err.message, 'error');
    }
  };

  // --- Safe Print / PDF Request Handler (Requires Tracking Number) ---
  const handleRequestPrintOrPDF = (shipmentObj, items, siteObj, action = 'print', isDraft = false) => {
    const trk = String(shipmentObj.tracking_number || '').trim();
    if (!trk) {
      // Prompt user to provide tracking number before printing/downloading PDF
      setTrackingModalState({
        shipment: shipmentObj,
        items: items || [],
        site: siteObj || {},
        action,
        isDraft,
        trackingInput: '',
        carrierInput: shipmentObj.carrier || 'Lite Express'
      });
      return;
    }

    if (action === 'pdf') {
      generatePackingListPDF(shipmentObj, items || [], siteObj || {});
      showToast(`Downloaded PDF for ${shipmentObj.invoice_ref || 'manifest'}`, 'info');
    } else {
      printPackingListDirect(shipmentObj, items || [], siteObj || {});
    }
  };

  const handleConfirmTrackingModal = async () => {
    if (!trackingModalState) return;
    const cleanTrk = String(trackingModalState.trackingInput || '').trim();
    if (!cleanTrk) {
      showToast('Please enter a tracking number before printing/downloading PDF.', 'warning');
      return;
    }

    const updatedShipment = {
      ...trackingModalState.shipment,
      tracking_number: cleanTrk,
      carrier: trackingModalState.carrierInput || trackingModalState.shipment.carrier || 'Lite Express'
    };

    if (trackingModalState.isDraft) {
      setCurrentShipment(prev => ({
        ...prev,
        tracking_number: cleanTrk,
        carrier: updatedShipment.carrier
      }));
    } else {
      await saveShipment(updatedShipment);
    }

    showToast(`Tracking number #${cleanTrk} saved!`, 'success');

    if (trackingModalState.action === 'pdf') {
      generatePackingListPDF(updatedShipment, trackingModalState.items, trackingModalState.site);
    } else {
      printPackingListDirect(updatedShipment, trackingModalState.items, trackingModalState.site);
    }

    setTrackingModalState(null);
  };

  const filteredManifestItems = useMemo(() => {
    const items = currentShipment.items || [];
    if (!manifestSearch.trim()) return items;
    const q = manifestSearch.toLowerCase().trim();
    return items.filter(it =>
      (it.part_number && it.part_number.toLowerCase().includes(q)) ||
      (it.serial_number && it.serial_number.toLowerCase().includes(q)) ||
      (it.description && it.description.toLowerCase().includes(q))
    );
  }, [currentShipment.items, manifestSearch]);

  const filteredPreviewItems = (parsedBatch?.items || []).filter(item => {
    if (importFilter === 'VALID') return item.status === 'VALID';
    if (importFilter === 'NOT_FOUND') return item.status === 'NOT_FOUND' || item.status === 'ALREADY_PACKED';
    return true;
  });

  // Active packing stations list across all concurrent warehouse users
  const activeStationsList = useMemo(() => {
    const now = Date.now();
    const list = Object.values(activePackingStations || {}).filter(st => {
      return st && st.userId && st.isPacking && (now - (st.timestamp || 0) < 45000);
    });

    // Ensure current user is always included in the active station list
    const hasCurrent = list.some(st => st.userId === currentUser?.id);
    if (!hasCurrent && currentUser) {
      list.unshift({
        userId: currentUser.id || 'user',
        userName: currentUser.fullName || currentUser.name || 'Warehouse Staff',
        userEmail: currentUser.email || '',
        siteId: selectedSiteId,
        siteCode: selectedSite?.code || '',
        siteName: selectedSite?.name || '',
        itemCount: (currentShipment?.items || []).length,
        isPacking: true,
        timestamp: Date.now()
      });
    }
    return list;
  }, [activePackingStations, currentUser, selectedSiteId, selectedSite, currentShipment]);

  const otherActiveStations = useMemo(() => {
    return activeStationsList.filter(st => st.userId !== currentUser?.id);
  }, [activeStationsList, currentUser?.id]);

  const siteConflictUsers = useMemo(() => {
    if (!selectedSiteId) return [];
    return otherActiveStations.filter(st => st.siteId === selectedSiteId);
  }, [otherActiveStations, selectedSiteId]);

  return (
    <div className="scan-out-packing-view" style={{ maxWidth: '1150px', margin: '0 auto' }}>
      {/* Active Packing Stations & Multi-User Team Activity Banner */}
      <div
        style={{
          background: otherActiveStations.length > 0
            ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)'
            : 'rgba(15, 23, 42, 0.85)',
          border: otherActiveStations.length > 0
            ? '1px solid rgba(56, 189, 248, 0.35)'
            : '1px solid rgba(51, 65, 85, 0.6)',
          borderRadius: '10px',
          padding: '12px 18px',
          marginBottom: '18px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: otherActiveStations.length > 0 ? 'rgba(56, 189, 248, 0.18)' : 'rgba(71, 85, 105, 0.25)',
                color: otherActiveStations.length > 0 ? '#38bdf8' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Users size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.2px' }}>
                  Simultaneous Multi-User Packing Activity
                </h4>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: otherActiveStations.length > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.12)',
                    color: otherActiveStations.length > 0 ? '#34d399' : '#38bdf8',
                    border: otherActiveStations.length > 0 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(56, 189, 248, 0.25)'
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: otherActiveStations.length > 0 ? '#10b981' : '#38bdf8',
                      boxShadow: otherActiveStations.length > 0 ? '0 0 6px #10b981' : '0 0 6px #38bdf8'
                    }}
                  />
                  {activeStationsList.length} Active {activeStationsList.length === 1 ? 'Station' : 'Stations'}
                </span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '11.5px', color: '#94a3b8' }}>
                Workstation drafts are private. Parts in stock remain synchronized in real-time across all users with instant reservation upon scan.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {activeStationsList.map(st => {
              const isMe = st.userId === currentUser?.id;
              return (
                <div
                  key={st.userId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '5px 10px',
                    borderRadius: '6px',
                    background: isMe ? 'rgba(56, 189, 248, 0.12)' : 'rgba(30, 41, 59, 0.9)',
                    border: isMe ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(71, 85, 105, 0.4)',
                    fontSize: '11.5px'
                  }}
                  title={isMe ? 'Your active packing workstation' : `Active packing station of ${st.userName}`}
                >
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: isMe ? '#0284c7' : '#475569',
                      color: '#fff',
                      fontSize: '10px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {(st.userName || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600, color: isMe ? '#38bdf8' : '#f1f5f9', lineHeight: 1.1 }}>
                      {st.userName} {isMe && <span style={{ fontSize: '10px', opacity: 0.8 }}>(You)</span>}
                    </span>
                    <span style={{ fontSize: '10.5px', color: '#94a3b8', lineHeight: 1.1 }}>
                      {st.siteCode ? `→ ${st.siteCode}` : 'Selecting Site'} • <strong style={{ color: '#cbd5e1' }}>{st.itemCount || 0}</strong> parts
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Site Conflict Alert if two active users are packing for the same site */}
        {siteConflictUsers.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'rgba(234, 179, 8, 0.12)',
              border: '1px solid rgba(234, 179, 8, 0.35)',
              color: '#fde047',
              fontSize: '11.5px'
            }}
          >
            <ShieldAlert size={14} color="#facc15" />
            <span>
              <strong>Branch Notice:</strong> {siteConflictUsers.map(u => u.userName).join(', ')} is also preparing a packing list for <strong>{selectedSite?.code || selectedSite?.name}</strong>.
            </span>
          </div>
        )}
      </div>

      {/* Modern High-Efficiency Scan-Out Workstation Hero */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          borderRadius: '14px',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          padding: '22px 26px',
          marginBottom: '22px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Workstation Header & Quick Tools */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '8px', borderRadius: '10px' }}>
              <PackageCheck size={22} />
            </div>
            <div>
              <h2 style={{ color: '#fff', fontSize: '18.5px', margin: 0, fontWeight: 700, letterSpacing: '-0.01em' }}>
                Pack Scan-Out Station
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                Real-time serialized stock verification & automated branch packing list generation
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsImportModalOpen(true)}
              style={{
                background: 'rgba(30, 41, 59, 0.8)',
                color: '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.4)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                height: '34px'
              }}
            >
              <FileSpreadsheet size={15} />
              <span>Import XLSX / CSV</span>
            </button>

            {currentShipment.items && currentShipment.items.length > 0 && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setIsClearModalOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '34px' }}
              >
                <RotateCcw size={14} />
                <span>Clear Draft ({currentShipment.items.length})</span>
              </button>
            )}

            <div className="scanner-status-indicator" style={{ height: '34px', boxSizing: 'border-box' }}>
              <div className="pulse-dot" />
              <span>HID Scanner Ready</span>
            </div>
          </div>
        </div>

        {/* Operational Overview: 4 Clean & Balanced Information Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.3fr 0.9fr 1.3fr', gap: '12px', marginBottom: '18px' }}>
          {/* Card 1: Destination Branch */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '10px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.4px' }}>
                Destination Site
              </span>
              <button
                type="button"
                onClick={() => { setIsSiteModalOpen(true); setSiteSearchQuery(''); }}
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#38bdf8',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Change
              </button>
            </div>
            <div
              onClick={() => { setIsSiteModalOpen(true); setSiteSearchQuery(''); }}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <div style={{ background: 'rgba(56, 189, 248, 0.12)', padding: '5px', borderRadius: '6px', color: '#38bdf8', flexShrink: 0 }}>
                <Building2 size={16} />
              </div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '13.5px', lineHeight: 1.2 }}>
                  {selectedSite?.code || 'SELECT SITE'}
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                  {selectedSite?.name || 'Click to select branch'}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Courier & Transfer Slip */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.4px' }}>
                Courier & Transfer
              </span>
              <span style={{ fontSize: '10.5px', color: '#38bdf8', fontWeight: 600 }}>
                {currentShipment.carrier || 'Lite Express'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '6px' }}>
              <select
                style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: '6px', fontSize: '11px', padding: '4px 6px', height: '30px' }}
                value={currentShipment.carrier || (selectedSite?.region === 'Metro Manila' ? 'Lalamove' : 'Lite Express')}
                onChange={(e) => handleCourierChange(e.target.value)}
              >
                <option value="Lalamove">Lalamove (MM)</option>
                <option value="Lite Express">Lite Express (Prov)</option>
                <option value="Utility">Utility Pickup</option>
              </select>
              <input
                type="text"
                placeholder="TS # (Manual)"
                style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: '6px', fontSize: '11px', padding: '4px 6px', height: '30px', fontFamily: 'var(--font-mono)' }}
                value={currentShipment.transfer_slip_number || ''}
                onChange={(e) => setCurrentShipment(prev => ({ ...prev, transfer_slip_number: e.target.value }))}
                title="Transfer Slip Number (e.g. TS-2026-0089)"
              />
            </div>
          </div>

          {/* Card 3: Box Management */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.4px' }}>
                Box #
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span style={{ fontSize: '10px', color: '#64748b' }}>Total:</span>
                <select
                  style={{ background: '#1e293b', color: '#38bdf8', border: '1px solid #334155', borderRadius: '4px', fontSize: '10px', padding: '0 4px', height: '20px' }}
                  value={totalBoxes}
                  onChange={(e) => {
                    const nextTotal = Math.max(1, parseInt(e.target.value) || 1);
                    setTotalBoxes(nextTotal);
                    if (boxNumber > nextTotal) setBoxNumber(nextTotal);
                  }}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </div>
            </div>
            <select
              style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px', fontWeight: 700, padding: '4px 6px', height: '30px' }}
              value={boxNumber}
              onChange={(e) => setBoxNumber(parseInt(e.target.value))}
            >
              {Array.from({ length: totalBoxes }, (_, i) => i + 1).map(b => (
                <option key={b} value={b}>
                  Box {b}/{totalBoxes}
                </option>
              ))}
            </select>
          </div>

          {/* Card 4: Total Units & Declared Value */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(5, 150, 105, 0.18) 100%)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: '10px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#6ee7b7', fontWeight: 700, letterSpacing: '0.4px' }}>
                Packed Units
              </span>
              <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.15)', padding: '1px 6px', borderRadius: '8px' }}>
                {currentShipment.items?.length || 0} units
              </span>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#a7f3d0' }}>Declared Value (85 PHP):</div>
              <div style={{ fontSize: '14.5px', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>
                ₱{totalDeclaredValuePHP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>

        {/* Primary Barcode Scanner Inputs (Hero Stage) */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid rgba(56, 189, 248, 0.45)',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '14px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)'
          }}
        >
          <div className="scan-input-grid" style={{ alignItems: 'center' }}>
            <div>
              <label style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px', display: 'block', letterSpacing: '0.4px' }}>
                1. Part Number (P/N)
              </label>
              <input
                ref={pnInputRef}
                type="text"
                className="scanner-input"
                placeholder="e.g. 661-21991"
                value={partNumberInput}
                onChange={(e) => setPartNumberInput(e.target.value)}
                onKeyDown={handlePnKeyDown}
                style={{ height: '46px', fontSize: '15px', borderRadius: '8px' }}
              />
            </div>

            <div>
              <label style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px', display: 'block', letterSpacing: '0.4px' }}>
                2. Serial Number (S/N)
              </label>
              <input
                ref={serialInputRef}
                type="text"
                className="scanner-input"
                placeholder="e.g. F8Y6276C1UQ13XCB1"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                onKeyDown={handleSerialKeyDown}
                style={{ height: '46px', fontSize: '15px', borderRadius: '8px' }}
              />
            </div>

            <div>
              <label style={{ opacity: 0, fontSize: '11px', marginBottom: '6px', display: 'block' }}>Action</label>
              <button
                className="btn btn-primary btn-lg"
                onClick={executePackScan}
                style={{ height: '46px', padding: '0 20px', fontSize: '14px', fontWeight: 700, borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                <span>Pack Unit</span>
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </div>

        {/* Scan Result Feedback Box */}
        {scanResult && (
          <div
            className={`scanner-feedback-box ${
              scanResult.type === 'success' ? 'scanner-feedback-success' : 'scanner-feedback-error'
            }`}
            style={{ marginBottom: '14px' }}
          >
            {scanResult.type === 'success' ? (
              <CheckCircle2 size={18} color="#10b981" />
            ) : (
              <AlertCircle size={18} color="#ef4444" />
            )}
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{scanResult.message}</span>
          </div>
        )}

        {/* Collapsible Manifest Reference & Signatures Settings Bar */}
        <div>
          <button
            type="button"
            onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '11.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '2px 0'
            }}
          >
            <SlidersHorizontal size={13} color="#38bdf8" />
            <span>{isDetailsExpanded ? 'Hide Manifest Reference & Signatures' : 'Show Manifest Reference & Signatures (Invoice Ref, Tracking, Signatures)'}</span>
            {isDetailsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {isDetailsExpanded && (
            <div
              style={{
                marginTop: '10px',
                background: 'rgba(15, 23, 42, 0.65)',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '12px 16px',
                display: 'grid',
                gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr',
                gap: '10px'
              }}
            >
              <div>
                <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 600, marginBottom: '4px', display: 'block' }}>Invoice Ref</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155', fontSize: '11.5px', height: '32px' }}
                  value={currentShipment.invoice_ref ?? 'DCOWNED#082726A'}
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, invoice_ref: e.target.value }))}
                />
              </div>

              <div>
                <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 600, marginBottom: '4px', display: 'block' }}>Tracking # (Optional)</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155', fontSize: '11.5px', height: '32px' }}
                  value={currentShipment.tracking_number || ''}
                  placeholder="e.g. 20227258"
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, tracking_number: e.target.value }))}
                />
              </div>

              <div>
                <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 600, marginBottom: '4px', display: 'block' }}>Prepared By</label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155', fontSize: '11.5px', height: '32px' }}
                  value={currentShipment.prepared_by_name ?? (currentUser?.fullName || '')}
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, prepared_by_name: e.target.value }))}
                />
              </div>

              <div>
                <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 600, marginBottom: '4px', display: 'block' }}>Verified By</label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155', fontSize: '11.5px', height: '32px' }}
                  value={currentShipment.verified_by_name ?? 'Anjo Alcazar'}
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, verified_by_name: e.target.value }))}
                />
              </div>

              <div>
                <label style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 600, marginBottom: '4px', display: 'block' }}>Pickup By</label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155', fontSize: '11.5px', height: '32px' }}
                  value={currentShipment.pickup_by_name || (currentShipment.carrier === 'Utility' ? 'Utility' : '')}
                  placeholder={currentShipment.carrier === 'Utility' ? 'Utility' : 'Driver Name'}
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, pickup_by_name: e.target.value }))}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Simplified & High-Usability Available DC Inventory Table */}
      <div className="card" style={{ marginBottom: '24px', background: '#ffffff', border: '1px solid #e2e8f0', padding: '18px 20px' }}>
        {/* Header with Title, Stats Badges, Search & Category Filters */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: '#e0f2fe', color: '#0284c7', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Boxes size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '15.5px', color: '#0f172a', fontWeight: 700 }}>
                  Available Stock Units in DC
                </h3>
                <span className="badge badge-success" style={{ fontSize: '11.5px', padding: '2px 8px' }}>
                  {availableStockUnits.length} in-stock
                </span>
                <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11px', padding: '2px 8px' }}>
                  {uniquePartTypesCount} Part Models
                </span>
                {currentShipment.items && currentShipment.items.length > 0 && (
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', padding: '2px 8px' }}>
                    {currentShipment.items.length} In Active Manifest
                  </span>
                )}
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Click "Pack" on any serialized unit to immediately add it to Box #{boxNumber}
              </p>
            </div>
          </div>

          {/* Quick Search & Hard Sync Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ position: 'relative', width: '240px' }}>
              <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search P/N, Serial, Model..."
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '26px', paddingRight: stockSearch ? '24px' : '8px', height: '32px', fontSize: '12px', width: '100%' }}
              />
              {stockSearch && (
                <button
                  type="button"
                  onClick={() => setStockSearch('')}
                  style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {autoRefreshData && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async (e) => {
                  if (e && e.preventDefault) e.preventDefault();
                  showToast('Re-pulling latest stock from Cloud Database...', 'info');
                  const ok = await autoRefreshData({ force: true, silent: false, reason: 'Manual hard sync' });
                  if (ok) {
                    showToast('Stock re-synchronized from Cloud Database!', 'success');
                  }
                }}
                disabled={isAutoRefreshing}
                title="Hard Sync: Re-pull all serialized stock from Cloud Database"
                style={{ height: '32px', padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <RefreshCw size={12} className={isAutoRefreshing ? 'spin' : ''} />
                <span style={{ fontSize: '11px' }}>Sync</span>
              </button>
            )}
          </div>
        </div>

        {/* Category Filter Pills */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600, marginRight: '2px' }}>Category:</span>
          <button
            type="button"
            className={`btn btn-sm ${stockCategoryTab === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStockCategoryTab('ALL')}
            style={{ padding: '2px 8px', fontSize: '11px', borderRadius: 'var(--radius-full)' }}
          >
            All Parts ({availableStockUnits.length})
          </button>
          {['DISPLAY', 'BATTERY', 'CAMERA', 'BACK_GLASS', 'MID_REAR'].map(code => {
            const countForCat = enrichedStockUnits.filter(u => u.category_code === code || u.category_name?.toUpperCase().includes(code)).length;
            if (countForCat === 0 && stockCategoryTab !== code) return null;
            const catLabel = code === 'DISPLAY' ? 'Display' : code === 'BATTERY' ? 'Battery' : code === 'CAMERA' ? 'Camera' : code === 'BACK_GLASS' ? 'Back Glass' : 'Logic / Mid';
            return (
              <button
                key={code}
                type="button"
                className={`btn btn-sm ${stockCategoryTab === code ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStockCategoryTab(code)}
                style={{ padding: '2px 8px', fontSize: '11px', borderRadius: 'var(--radius-full)' }}
              >
                {catLabel} ({countForCat})
              </button>
            );
          })}
        </div>

        {/* Simplified Unified Stock Table */}
        {availableStockUnits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            <CheckCircle2 size={28} color="#10b981" style={{ margin: '0 auto 6px' }} />
            <h4 style={{ margin: '0 0 2px 0', fontSize: '13.5px', color: '#0f172a', fontWeight: 600 }}>All Available DC Units Packed</h4>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
              {currentShipment.items && currentShipment.items.length > 0
                ? `All ${currentShipment.items.length} units in DC stock are currently loaded into the active manifest below.`
                : 'No units in DC stock. Receive or import parts in the Receive Scan-In page first.'}
            </p>
          </div>
        ) : filteredStockUnits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            <Search size={22} color="#94a3b8" style={{ margin: '0 auto 4px' }} />
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
              No available parts match "{stockSearch}".
            </p>
          </div>
        ) : (
          <div className="table-container" style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
            <table className="data-table" style={{ fontSize: '12px', width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 2 }}>
                <tr>
                  <th style={{ width: '36px', textAlign: 'center' }}>#</th>
                  <th style={{ width: '110px' }}>Part Number</th>
                  <th>Description / Model</th>
                  <th style={{ width: '100px' }}>Category</th>
                  <th style={{ width: '190px' }}>Serial Number</th>
                  <th style={{ width: '130px' }}>Assignment</th>
                  <th style={{ textAlign: 'right', width: '110px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredStockUnits.map((unit, idx) => {
                  const catBadge = getCategoryBadgeStyle(unit.category_code);
                  const isCrbr = unit.intake_assignment?.includes('CRBR') || unit.notes?.includes('CRBR');
                  return (
                    <tr key={unit.id || `${unit.serial_number}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
                        {idx + 1}
                      </td>
                      <td className="font-mono" style={{ fontWeight: 700, color: '#0f172a' }}>
                        {unit.part_number}
                      </td>
                      <td>
                        <div style={{ fontWeight: 500, color: '#1e293b' }}>{unit.description}</div>
                        {unit.iphone_model && (
                          <div style={{ fontSize: '11px', color: '#64748b' }}>Model: <strong>{unit.iphone_model}</strong></div>
                        )}
                      </td>
                      <td>
                        <span className="badge" style={{ ...catBadge, fontSize: '10px', padding: '1px 6px' }}>
                          {unit.category_name}
                        </span>
                      </td>
                      <td className="font-mono" style={{ fontWeight: 600, color: '#0369a1', letterSpacing: '0.02em' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <span>{unit.serial_number}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              if (e && e.preventDefault) e.preventDefault();
                              handleCopySerial(unit.serial_number);
                            }}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '1px' }}
                            title="Copy Serial Number"
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background: isCrbr ? '#fef3c7' : '#e0f2fe',
                            color: isCrbr ? '#92400e' : '#0369a1',
                            border: isCrbr ? '1px solid #fde68a' : '1px solid #bae6fd',
                            fontSize: '10.5px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}
                        >
                          {isCrbr ? 'DC - CRBR' : 'MDC - Forecasting'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={(e) => handleSimulatePack(unit, e)}
                          style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', borderRadius: '4px' }}
                          title={`Pack ${unit.part_number} (${unit.serial_number}) into Box #${boxNumber}`}
                        >
                          <Plus size={12} />
                          <span>Pack</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Corporate Packing List Live Preview */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0 }}>Live Packing Manifest Preview</h3>
              <span className="badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                <Check size={11} style={{ display: 'inline', marginRight: '3px' }} />
                Persistent Draft
              </span>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
              Formatted identically to Apple Authorized Service Partner corporate standard
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Quick Search */}
            <div style={{ position: 'relative', width: '200px' }}>
              <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search packed items..."
                value={manifestSearch}
                onChange={(e) => setManifestSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '26px', height: '34px', fontSize: '12px', width: '100%' }}
              />
            </div>

            {currentShipment.items && currentShipment.items.length > 0 && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setIsClearModalOpen(true)}
                style={{ height: '34px' }}
                title="Remove all parts and return them to In-Stock inventory"
              >
                <RotateCcw size={13} />
                <span>Clear Draft</span>
              </button>
            )}

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleRequestPrintOrPDF(currentShipment, currentShipment.items, selectedSite, 'print', true)}
              style={{ height: '34px' }}
              title="Preview and print packing list (Requires Tracking #)"
            >
              <Printer size={14} />
              <span>Print Preview</span>
            </button>

            <button
              className="btn btn-primary btn-sm"
              onClick={handleFinalizeShipment}
              style={{
                height: '34px',
                background: '#0284c7',
                borderColor: '#0284c7',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
              title="Save packing list permanently to database, download PDF, and ready station for next packing list"
            >
              <CheckCircle2 size={15} />
              <span>Finalize & Save Packing List</span>
            </button>
          </div>
        </div>

        {/* Exact Corporate Packing List Sheet Matching Google Sheet MSPI_DC PACKING LIST */}
        <div className="packing-list-sheet">
          {/* Top Title Banner */}
          <div className="packing-list-header-banner">
            <h2>Packing List</h2>
          </div>

          {/* Company Branding & Metadata Block */}
          <div className="packing-company-meta">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <img
                src={mobileCareLogo}
                alt="Mobile Care Logo"
                style={{
                  width: '56px',
                  height: '56px',
                  objectFit: 'contain'
                }}
              />
              <div style={{ lineHeight: '1.35' }}>
                <h3 style={{ margin: '0 0 3px 0', fontSize: '13px', fontWeight: 800, color: '#0f172a', letterSpacing: '0.01em' }}>
                  MOBILE CARE SERVICES PHILS. INC.
                </h3>
                <p style={{ margin: '0 0 2px 0', fontSize: '11.5px', color: '#334155' }}>Business and Distribution Center</p>
                <p style={{ margin: '0 0 2px 0', fontSize: '11px', color: '#475569' }}>2/L Northeast Square, #47</p>
                <p style={{ margin: '0 0 2px 0', fontSize: '11px', color: '#475569' }}>Connecticut St. Northeast Greenhills</p>
                <p style={{ margin: 0, fontSize: '11px', color: '#475569' }}>San Juan City, Metro Manila</p>
              </div>
            </div>

            {/* Right Meta Column */}
            <div className="packing-invoice-meta">
              <div className="packing-invoice-meta-row">
                <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>INVOICE REF:</strong>
                <input
                  type="text"
                  className="packing-inline-input font-mono"
                  style={{ width: '220px', fontWeight: 700 }}
                  value={currentShipment.invoice_ref ?? `DCOWNED#082726A`}
                  placeholder="DCOWNED#082726A"
                  title="Click to edit Invoice Reference"
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, invoice_ref: e.target.value }))}
                />
              </div>
              <div className="packing-invoice-meta-row">
                <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>SHIPMENT DATE:</strong>
                <input
                  type="text"
                  className="packing-inline-input"
                  style={{ width: '120px' }}
                  value={currentShipment.shipment_date ?? new Date().toLocaleDateString('en-US')}
                  title="Click to edit Shipment Date"
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, shipment_date: e.target.value }))}
                />
              </div>
              <div className="packing-invoice-meta-row">
                <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>BOX/S #:</strong>
                <span style={{ minWidth: '40px', textAlign: 'right', fontWeight: 700, paddingRight: '6px' }}>{boxNumber}/{totalBoxes}</span>
              </div>
              <div className="packing-invoice-meta-row">
                <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>COURIER:</strong>
                <input
                  type="text"
                  className="packing-inline-input"
                  style={{ width: '130px' }}
                  value={currentShipment.carrier ?? (selectedSite?.region === 'Metro Manila' ? 'Lalamove' : 'Lite Express')}
                  placeholder="Lalamove / Lite Express"
                  title="Click to edit Courier"
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, carrier: e.target.value, courier: e.target.value }))}
                />
              </div>
              <div className="packing-invoice-meta-row">
                <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>TRACKING NUMBER:</strong>
                <input
                  type="text"
                  className="packing-inline-input font-mono"
                  style={{ width: '140px' }}
                  value={currentShipment.tracking_number || ''}
                  placeholder="Enter Tracking #"
                  title="Click to edit Tracking Number"
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, tracking_number: e.target.value }))}
                />
              </div>
              {currentShipment.transfer_slip_number && (
                <div className="packing-invoice-meta-row">
                  <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>TRANSFER SLIP #:</strong>
                  <input
                    type="text"
                    className="packing-inline-input font-mono"
                    style={{ width: '140px' }}
                    value={currentShipment.transfer_slip_number || ''}
                    placeholder="Transfer Slip #"
                    title="Click to edit Transfer Slip Number"
                    onChange={(e) => setCurrentShipment(prev => ({ ...prev, transfer_slip_number: e.target.value }))}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Ship To Section */}
          <div className="packing-shipto-section">
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <strong style={{ minWidth: '55px', fontSize: '12px', color: '#0f172a' }}>Ship To</strong>
              <div>
                <strong style={{ fontSize: '12.5px', color: '#0f172a', textTransform: 'uppercase' }}>{selectedSite.name}</strong>
                <div style={{ color: '#334155', fontSize: '11.5px', marginTop: '2px', lineHeight: '1.4' }}>
                  {selectedSite.address}
                </div>
              </div>
            </div>
          </div>

          {/* Packing Manifest Table */}
          <div className="packing-table-container">
            <table className="packing-manifest-table">
              <thead>
                <tr>
                  <th style={{ width: '42px' }}>#</th>
                  <th style={{ width: '135px' }}>PART NUMBER</th>
                  <th>DESCRIPTION</th>
                  <th style={{ width: '210px' }}>SERIAL NUMBER</th>
                  <th style={{ width: '65px' }}>BOX #</th>
                  <th className="hide-on-print" style={{ width: '45px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredManifestItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: '#94a3b8' }}>
                      {manifestSearch ? `No packed items match "${manifestSearch}"` : 'No items packed yet. Scan parts or import spreadsheet above.'}
                    </td>
                  </tr>
                ) : (
                  filteredManifestItems.map((it, i) => {
                    const itemBoxDisplay = it.box_number 
                      ? (String(it.box_number).includes('/') ? it.box_number : `${it.box_number}/${totalBoxes}`)
                      : `${boxNumber}/${totalBoxes}`;

                    return (
                      <tr key={i} className={i % 2 === 1 ? 'packing-table-row-alt' : ''}>
                        <td style={{ textAlign: 'center', color: '#64748b' }}>{i + 1}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{it.part_number}</td>
                        <td style={{ textAlign: 'left' }}>{it.description}</td>
                        <td style={{ textAlign: 'center', fontSize: '11.5px' }}>{it.serial_number}</td>
                        <td style={{ textAlign: 'center' }}>{itemBoxDisplay}</td>
                        <td className="hide-on-print" style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => handleRemoveItem(it.serial_number)}
                            title="Remove part from packing list & return to DC in-stock inventory"
                            style={{
                              background: '#fee2e2',
                              color: '#dc2626',
                              border: 'none',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Remarks & Totals Block */}
          <div className="packing-summary-bar">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a' }}>Remarks</span>
              <input
                type="text"
                className="packing-inline-input packing-inline-input-left"
                style={{ width: '260px', fontWeight: 600 }}
                value={currentShipment.remarks ?? 'KGB PARTS'}
                placeholder="KGB PARTS"
                title="Click to edit Remarks"
                onChange={(e) => setCurrentShipment(prev => ({ ...prev, remarks: e.target.value }))}
              />
            </div>

            <div className="packing-totals-box" style={{ width: '260px' }}>
              <div className="packing-total-row">
                <div className="packing-total-label">TOTAL QTY</div>
                <div className="packing-total-val">{currentShipment.items?.length || 0}</div>
              </div>
              <div className="packing-total-row">
                <div className="packing-total-label">TOTAL BOXES</div>
                <div className="packing-total-val">{totalBoxes}</div>
              </div>
              <div className="packing-total-row">
                <div className="packing-total-label">DECLARED VALUE</div>
                <div className="packing-total-val" style={{ fontSize: '11px', color: '#059669', fontWeight: 800 }}>
                  PHP {totalDeclaredValuePHP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          {/* Signatures Row */}
          <div className="packing-signatures">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ color: '#0f172a' }}>Prepared and Counted by:</strong>
              <input
                type="text"
                className="packing-inline-input packing-inline-input-left"
                style={{ width: '170px', fontWeight: 600 }}
                value={currentShipment.prepared_by_name ?? (currentUser?.fullName || 'Joshua Juvida')}
                placeholder="Joshua Juvida"
                title="Click to edit Prepared By"
                onChange={(e) => setCurrentShipment(prev => ({ ...prev, prepared_by_name: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ color: '#0f172a' }}>Verified by:</strong>
              <input
                type="text"
                className="packing-inline-input packing-inline-input-left"
                style={{ width: '170px', fontWeight: 600 }}
                value={currentShipment.verified_by_name ?? 'Anjo Alcazar'}
                placeholder="Anjo Alcazar"
                title="Click to edit Verified By"
                onChange={(e) => setCurrentShipment(prev => ({ ...prev, verified_by_name: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ color: '#0f172a' }}>Pickup By:</strong>
              <input
                type="text"
                className="packing-inline-input packing-inline-input-left"
                style={{ width: '170px', fontWeight: 600 }}
                value={currentShipment.pickup_by_name || (currentShipment.carrier === 'Utility' ? 'Utility' : '')}
                placeholder={currentShipment.carrier === 'Utility' ? 'Utility' : 'e.g. Lalamove Driver'}
                title="Click to edit Pickup By"
                onChange={(e) => setCurrentShipment(prev => ({ ...prev, pickup_by_name: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ color: '#0f172a' }}>Receiving Branch Signature:</strong>
              <input
                type="text"
                className="packing-inline-input packing-inline-input-left"
                style={{ width: '170px', fontWeight: 600 }}
                value={currentShipment.receiving_signature ?? (selectedSite.code ? `APP ${selectedSite.code.replace(/^(site-|asp-)/i, '').toUpperCase()}` : 'APP RM')}
                placeholder="APP RM"
                title="Click to edit Receiving Branch Signature"
                onChange={(e) => setCurrentShipment(prev => ({ ...prev, receiving_signature: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Database History: Saved Packing Lists & Historical Records */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: '#e0e7ff', color: '#4338ca', padding: '8px', borderRadius: '8px' }}>
              <History size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16.5px' }}>Saved Packing Lists & Manifest Database History</h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Persistent record of all finalized and saved packing lists with dates, destinations, and included serialized parts
              </p>
            </div>
          </div>
          <span className="badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
            <Database size={11} style={{ display: 'inline', marginRight: '4px' }} />
            {shipments.filter(s => s.items && s.items.length > 0).length} Saved Manifests
          </span>
        </div>

        {shipments.filter(s => s.items && s.items.length > 0).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 20px', color: '#94a3b8', border: '1px dashed #e2e8f0', borderRadius: 'var(--radius-md)' }}>
            <FileText size={32} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
            <p style={{ margin: 0, fontSize: '13.5px' }}>No saved packing lists in database history yet.</p>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
              Pack parts above and click "Save to Database" or "Finalize & Download PDF" to record manifests.
            </p>
          </div>
        ) : (
          <div className="table-container" style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: '12.5px' }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice Reference</th>
                  <th>Destination Branch</th>
                  <th>Total Parts</th>
                  <th>Courier & Tracking</th>
                  <th>Prepared / Verified</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shipments
                  .filter(s => s.items && s.items.length > 0)
                  .map(s => {
                    const destSite = sites.find(st => st.id === s.site_id) || { code: s.site_code || 'HUB', name: s.site_name || 'Branch' };
                    const formattedDate = s.shipment_date || (s.created_at ? new Date(s.created_at).toLocaleDateString('en-US') : 'N/A');
                    return (
                      <tr key={s.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: '#334155' }}>
                            <Calendar size={13} color="var(--primary)" />
                            <span>{formattedDate}</span>
                          </div>
                        </td>
                        <td className="font-mono" style={{ fontWeight: 700, color: '#0f172a' }}>
                          {s.invoice_ref || s.shipment_number}
                        </td>
                        <td>
                          <strong>{destSite.code}</strong> <span style={{ color: '#64748b', fontSize: '11.5px' }}>({destSite.name})</span>
                        </td>
                        <td>
                          <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 700 }}>
                            {s.items?.length || 0} units
                          </span>
                        </td>
                        <td style={{ fontSize: '12px' }}>
                          <div><strong>{s.carrier || s.courier || 'Lite Express'}</strong></div>
                          <span className="font-mono" style={{ fontSize: '11px', color: '#64748b' }}>
                            {s.tracking_number ? `#${s.tracking_number}` : 'No tracking'}
                          </span>
                          {s.transfer_slip_number && (
                            <div style={{ fontSize: '10.5px', color: '#0284c7', marginTop: '1px' }}>
                              TS: {s.transfer_slip_number}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: '11.5px', color: '#475569' }}>
                          <div>By: <strong>{s.prepared_by_name || 'Warehouse Staff'}</strong></div>
                          <div>Ver: {s.verified_by_name || 'Anjo Alcazar'}</div>
                        </td>
                        <td>
                          <span
                            className="badge"
                            style={{
                              background: s.status === 'shipped' ? '#dcfce7' : s.status === 'delivered' ? '#e0e7ff' : '#fef3c7',
                              color: s.status === 'shipped' ? '#15803d' : s.status === 'delivered' ? '#4338ca' : '#b45309',
                              textTransform: 'uppercase',
                              fontSize: '10.5px'
                            }}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setInspectShipmentModal(s)}
                              title="View all serialized parts included in this manifest"
                              style={{ padding: '4px 8px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <Eye size={12} />
                              <span>Inspect Parts</span>
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleRequestPrintOrPDF(s, s.items || [], destSite, 'pdf', false)}
                              title="Download PDF (Requires Tracking #)"
                              style={{ padding: '4px 8px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <Download size={12} />
                              <span>PDF</span>
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleRequestPrintOrPDF(s, s.items || [], destSite, 'print', false)}
                              title="Print Manifest (Requires Tracking #)"
                              style={{ padding: '4px 8px', fontSize: '11.5px' }}
                            >
                              <Printer size={12} />
                            </button>
                            {isLockedConfirmedShipment(s) ? (
                              <button
                                className="btn btn-secondary btn-sm"
                                disabled
                                style={{ padding: '4px 8px', fontSize: '11.5px', opacity: 0.8, cursor: 'not-allowed', color: '#059669', borderColor: '#a7f3d0', background: '#ecfdf5' }}
                                title="Locked Record: Manifest is Received Confirmed and permanently archived. To maintain data integrity, confirmed shipments cannot be deleted from the system UI."
                              >
                                <Lock size={12} />
                              </button>
                            ) : canUserDeleteRecord(s, currentUser) ? (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => {
                                  if (window.confirm(`Delete saved manifest "${s.invoice_ref || s.shipment_number}"? This will permanently delete both the manifest and all serialized parts included in this shipment.`)) {
                                    deleteShipment(s.id);
                                  }
                                }}
                                title="Permanently Delete Manifest from Database"
                                style={{ padding: '4px 8px', fontSize: '11.5px', background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5' }}
                              >
                                <Trash2 size={12} />
                              </button>
                            ) : (
                              <button
                                className="btn btn-secondary btn-sm"
                                disabled
                                style={{ padding: '4px 8px', fontSize: '11.5px', opacity: 0.4, cursor: 'not-allowed' }}
                                title={`Only ${s.prepared_by_name || s.saved_by_name || 'the creator'} can delete this manifest`}
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- Modal: Inspect Parts in Saved Manifest Record --- */}
      {inspectShipmentModal && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setInspectShipmentModal(null); }}>
          <div className="modal-content" style={{ maxWidth: '780px' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#38bdf8', padding: '6px', borderRadius: '6px', color: '#0f172a' }}>
                  <PackageCheck size={20} />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '16.5px', margin: 0 }}>
                    Manifest {inspectShipmentModal.invoice_ref || inspectShipmentModal.shipment_number}
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Destination: {inspectShipmentModal.site_name || inspectShipmentModal.site_code || 'Service Hub'} • Date: {inspectShipmentModal.shipment_date || 'N/A'} • Total: {inspectShipmentModal.items?.length || 0} parts
                  </p>
                </div>
              </div>
              <button onClick={() => setInspectShipmentModal(null)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '420px', overflowY: 'auto' }}>
              <table className="data-table" style={{ fontSize: '12px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>Part Number</th>
                    <th>Description</th>
                    <th>Serial Number</th>
                    <th style={{ width: '60px', textAlign: 'center' }}>Box #</th>
                  </tr>
                </thead>
                <tbody>
                  {(inspectShipmentModal.items || []).map((it, idx) => (
                    <tr key={idx}>
                      <td style={{ textAlign: 'center', color: '#64748b' }}>{idx + 1}</td>
                      <td className="font-mono" style={{ fontWeight: 700 }}>{it.part_number}</td>
                      <td>{it.description}</td>
                      <td className="font-mono" style={{ color: '#0369a1', fontWeight: 600 }}>{it.serial_number}</td>
                      <td style={{ textAlign: 'center' }}>{it.box_number || 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                Carrier: <strong>{inspectShipmentModal.carrier || 'Lite Express'}</strong> • Tracking: <span className="font-mono">{inspectShipmentModal.tracking_number ? `#${inspectShipmentModal.tracking_number}` : 'None'}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    const dest = sites.find(s => s.id === inspectShipmentModal.site_id) || {};
                    handleRequestPrintOrPDF(inspectShipmentModal, inspectShipmentModal.items || [], dest, 'pdf', false);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} />
                  <span>Download PDF</span>
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    const dest = sites.find(s => s.id === inspectShipmentModal.site_id) || {};
                    handleRequestPrintOrPDF(inspectShipmentModal, inspectShipmentModal.items || [], dest, 'print', false);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Printer size={14} />
                  <span>Print</span>
                </button>
                <button className="btn btn-primary" onClick={() => setInspectShipmentModal(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Double-Check Part & Serial Details --- */}
      {stockInspectUnit && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setStockInspectUnit(null); }}>
          <div className="modal-content" style={{ maxWidth: '560px' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#38bdf8', padding: '6px', borderRadius: '6px', color: '#0f172a' }}>
                  <Boxes size={20} />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '16.5px', margin: 0 }}>
                    Part Verification & Details
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Serialized DC Inventory Unit
                  </p>
                </div>
              </div>
              <button onClick={() => setStockInspectUnit(null)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Part Number</span>
                    <div className="font-mono" style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                      {stockInspectUnit.part_number}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Category</span>
                    <div style={{ marginTop: '2px' }}>
                      <span className="badge" style={getCategoryBadgeStyle(stockInspectUnit.category_code)}>
                        {stockInspectUnit.category_name}
                      </span>
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Description</span>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', marginTop: '2px' }}>
                      {stockInspectUnit.description}
                    </div>
                    {stockInspectUnit.iphone_model && (
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                        Device Compatibility: <strong>{stockInspectUnit.iphone_model}</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '14px', borderRadius: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#16a34a', textTransform: 'uppercase', fontWeight: 700 }}>Serial Number</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                    <span className="font-mono" style={{ fontSize: '15px', fontWeight: 700, color: '#047857', letterSpacing: '0.04em' }}>
                      {stockInspectUnit.serial_number}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleCopySerial(stockInspectUnit.serial_number)}
                      style={{ background: '#fff', fontSize: '11.5px', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Copy size={12} />
                      <span>{copiedSerial === stockInspectUnit.serial_number ? 'Copied!' : 'Copy S/N'}</span>
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
                  <div>
                    <span style={{ color: '#64748b' }}>Current Storage:</span>{' '}
                    <strong style={{ color: '#0f172a' }}>Distribution Center (DC-MDC)</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Inventory Status:</span>{' '}
                    <span className="badge badge-success" style={{ fontSize: '10.5px' }}>In Stock</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Received Date:</span>{' '}
                    <strong>{stockInspectUnit.received_at ? new Date(stockInspectUnit.received_at).toLocaleDateString('en-US') : 'Recent Intake'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Received By:</span>{' '}
                    <strong>{stockInspectUnit.received_by || 'Warehouse Staff'}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-secondary" onClick={() => setStockInspectUnit(null)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  handleSimulatePack(stockInspectUnit);
                  setStockInspectUnit(null);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <PackageCheck size={16} />
                <span>Pack into Current Manifest (Box {boxNumber})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Safety Confirmation Modal: Clear Packing Draft --- */}
      {isClearModalOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsClearModalOpen(false); }}>
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ background: '#991b1b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} color="#fff" />
                <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>Clear Active Packing Draft?</h3>
              </div>
              <button onClick={() => setIsClearModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ fontSize: '13.5px', color: 'var(--text-main)', marginBottom: '12px' }}>
                Are you sure you want to remove all <strong>{currentShipment.items?.length || 0} items</strong> from this packing draft?
              </p>
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: '12px', color: '#991b1b' }}>
                <strong>Safety Note:</strong> All packed parts will be safely returned to <strong>In-Stock DC inventory</strong> so no stock is lost.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsClearModalOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleConfirmClearDraft}>
                Yes, Clear Draft & Restore Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- XLSX / CSV Import Modal Dialog --- */}
      {isImportModalOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsImportModalOpen(false); }}>
          <div className="modal-content">
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: 'rgba(56, 189, 248, 0.15)', padding: '8px', borderRadius: '8px' }}>
                  <FileSpreadsheet size={22} color="#38bdf8" />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '17px', margin: 0 }}>Batch Pack Scan-Out (XLSX / CSV)</h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Bulk pack parts into Manifest for {selectedSite.name}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsImportModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {/* Template Download Row */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                padding: '12px 16px',
                background: '#f8fafc',
                borderRadius: 'var(--radius-md)',
                marginBottom: '16px',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Download size={16} color="var(--primary)" />
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-main)' }}>Need a formatted scan-out template?</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleDownloadTemplate('xlsx')}
                    style={{ background: '#fff', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <FileSpreadsheet size={13} color="#16a34a" />
                    <span>Download Excel (.xlsx)</span>
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleDownloadTemplate('csv')}
                    style={{ background: '#fff', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <FileText size={13} color="#0284c7" />
                    <span>Download CSV (.csv)</span>
                  </button>
                </div>
              </div>

              {!parsedBatch ? (
                <div
                  className={`dropzone ${isDragging ? 'active' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files?.[0]) await handleFileSelect(e.dataTransfer.files[0]);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ minHeight: '180px' }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  />
                  <div style={{ background: 'var(--primary-light)', padding: '14px', borderRadius: '50%', marginBottom: '12px' }}>
                    <UploadCloud size={32} color="var(--primary)" />
                  </div>
                  <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>
                    {isParsing ? 'Processing and validating batch file...' : isDragging ? 'Drop pack file here' : 'Click to browse or drag & drop scan-out file'}
                  </h4>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                    Supports Microsoft Excel (<strong>.xlsx, .xls</strong>) and <strong>.csv</strong> files
                  </p>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-subtle)', marginTop: '8px' }}>
                    Columns: Part Number, Serial Number, Box Number, Destination Site
                  </span>
                </div>
              ) : (
                <div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#f1f5f9',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '16px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FileSpreadsheet size={18} color="var(--primary)" />
                      <strong style={{ fontSize: '13px' }}>{parsedBatch.fileName}</strong>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setParsedBatch(null)} style={{ fontSize: '12px', background: '#fff' }}>
                      <RefreshCw size={12} style={{ display: 'inline', marginRight: '4px' }} />
                      Choose Different File
                    </button>
                  </div>

                  {/* Summary Metric Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                    <div className="import-stat-card">
                      <span className="import-stat-label">Total Rows</span>
                      <span className="import-stat-value">{parsedBatch.summary.total}</span>
                    </div>
                    <div className="import-stat-card" style={{ borderColor: '#bbf7d0', background: '#f0fdf4' }}>
                      <span className="import-stat-label" style={{ color: '#16a34a' }}>Ready to Pack</span>
                      <span className="import-stat-value" style={{ color: '#16a34a' }}>{parsedBatch.summary.valid}</span>
                    </div>
                    <div className="import-stat-card" style={{ borderColor: parsedBatch.summary.notFound > 0 ? '#fed7aa' : '#e2e8f0' }}>
                      <span className="import-stat-label" style={{ color: parsedBatch.summary.notFound > 0 ? '#ea580c' : 'var(--text-muted)' }}>
                        Not In DC Stock (Skip)
                      </span>
                      <span className="import-stat-value" style={{ color: parsedBatch.summary.notFound > 0 ? '#ea580c' : 'var(--text-muted)' }}>
                        {parsedBatch.summary.notFound}
                      </span>
                    </div>
                  </div>

                  {/* Filter tabs */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button className={`btn btn-sm ${importFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setImportFilter('ALL')}>
                      All ({parsedBatch.items.length})
                    </button>
                    <button className={`btn btn-sm ${importFilter === 'VALID' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setImportFilter('VALID')}>
                      Ready ({parsedBatch.summary.valid})
                    </button>
                    {parsedBatch.summary.notFound > 0 && (
                      <button className={`btn btn-sm ${importFilter === 'NOT_FOUND' ? 'btn-danger' : 'btn-secondary'}`} onClick={() => setImportFilter('NOT_FOUND')}>
                        Not in Stock ({parsedBatch.summary.notFound})
                      </button>
                    )}
                  </div>

                  {/* Table */}
                  <div className="table-container" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                    <table className="data-table" style={{ fontSize: '12.5px' }}>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Status</th>
                          <th>Part Number</th>
                          <th>Description</th>
                          <th>Serial Number</th>
                          <th>Box #</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPreviewItems.map(item => (
                          <tr key={item.id}>
                            <td className="font-mono" style={{ fontSize: '11.5px' }}>#{item.rowNumber}</td>
                            <td>
                              {item.status === 'VALID' && (
                                <span className="badge badge-success" style={{ fontSize: '11px' }}>In Stock</span>
                              )}
                              {item.status === 'NOT_FOUND' && (
                                <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', fontSize: '11px' }}>Not in Stock</span>
                              )}
                              {item.status === 'ALREADY_PACKED' && (
                                <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontSize: '11px' }}>Already Packed</span>
                              )}
                            </td>
                            <td className="font-mono"><strong>{item.partNumber}</strong></td>
                            <td>{item.description}</td>
                            <td className="font-mono" style={{ fontSize: '11.5px' }}>{item.serialNumber}</td>
                            <td>{item.boxNumber}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsImportModalOpen(false)}>
                Cancel
              </button>
              {parsedBatch && (
                <button
                  className="btn btn-primary"
                  onClick={handleConfirmBatchPack}
                  disabled={parsedBatch.summary.valid === 0}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CheckCircle2 size={16} />
                  <span>Pack {parsedBatch.summary.valid} Valid Units into Manifest</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Tracking Number Required for Official Print / PDF --- */}
      {trackingModalState && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setTrackingModalState(null); }}>
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#38bdf8', padding: '6px', borderRadius: '6px', color: '#0f172a' }}>
                  <Printer size={20} />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>
                    Tracking Number Required
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Manifest {trackingModalState.shipment?.invoice_ref || trackingModalState.shipment?.shipment_number || 'Draft'}
                  </p>
                </div>
              </div>
              <button onClick={() => setTrackingModalState(null)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleConfirmTrackingModal(); }}>
              <div className="modal-body">
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                  <p style={{ margin: 0, fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
                    To generate, download, or print the official corporate packing list, please provide the carrier tracking number for this shipment.
                  </p>
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label font-bold" style={{ fontSize: '12.5px' }}>
                    Tracking Number <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input font-mono"
                    placeholder="e.g. 20227258, TRK-987654"
                    value={trackingModalState.trackingInput}
                    onChange={(e) => setTrackingModalState(prev => ({ ...prev, trackingInput: e.target.value }))}
                    autoFocus
                    required
                    style={{ fontSize: '13px' }}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '6px' }}>
                  <label className="form-label" style={{ fontSize: '12.5px' }}>
                    Courier / Carrier
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Lite Express, Lalamove, J&T"
                    value={trackingModalState.carrierInput}
                    onChange={(e) => setTrackingModalState(prev => ({ ...prev, carrierInput: e.target.value }))}
                    style={{ fontSize: '13px' }}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setTrackingModalState(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  {trackingModalState.action === 'pdf' ? <Download size={14} /> : <Printer size={14} />}
                  <span>Save & {trackingModalState.action === 'pdf' ? 'Download PDF' : 'Print Manifest'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Modal: Searchable Destination Branch Site Selector --- */}
      {isSiteModalOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setIsSiteModalOpen(false); }}
          style={{ zIndex: 1100 }}
        >
          <div className="modal-content" style={{ maxWidth: '840px', width: '95%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            {/* Modal Header */}
            <div className="modal-header" style={{ background: '#0f172a', padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '8px', borderRadius: '8px' }}>
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '17px', margin: 0, fontWeight: 700 }}>
                    Select Destination Branch Site
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Choose destination for Packing List • <strong>{serviceSites.length} Active Branch Sites Available</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSiteModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
                title="Close (Esc)"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Search & Region Filter Toolbar */}
            <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ position: 'relative', marginBottom: '12px' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by branch code (e.g. BHS, NAG, PPM), branch name, region, address, or contact person..."
                  value={siteSearchQuery}
                  onChange={(e) => setSiteSearchQuery(e.target.value)}
                  autoFocus
                  style={{
                    paddingLeft: '38px',
                    paddingRight: siteSearchQuery ? '36px' : '12px',
                    height: '42px',
                    fontSize: '13.5px',
                    borderRadius: '8px',
                    background: '#fff',
                    borderColor: '#cbd5e1',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}
                />
                {siteSearchQuery && (
                  <button
                    onClick={() => setSiteSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '4px'
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Region Filter Chips */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b', marginRight: '4px', whiteSpace: 'nowrap' }}>
                  Region:
                </span>
                {availableRegions.map(reg => {
                  const count = reg === 'ALL'
                    ? serviceSites.length
                    : serviceSites.filter(s => (s.region || 'Metro Manila') === reg).length;
                  const isActive = siteRegionFilter === reg;
                  return (
                    <button
                      key={reg}
                      type="button"
                      onClick={() => setSiteRegionFilter(reg)}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11.5px',
                        fontWeight: isActive ? 700 : 500,
                        borderRadius: '6px',
                        border: isActive ? '1px solid #0284c7' : '1px solid #e2e8f0',
                        background: isActive ? '#0284c7' : '#ffffff',
                        color: isActive ? '#ffffff' : '#475569',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {reg} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Body: Grid of Branch Cards */}
            <div className="modal-body" style={{ maxHeight: '460px', overflowY: 'auto', padding: '16px 20px', background: '#f1f5f9' }}>
              {filteredServiceSites.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
                  <Building2 size={36} color="#cbd5e1" style={{ margin: '0 auto 12px auto' }} />
                  <h4 style={{ margin: '0 0 6px 0', color: '#334155' }}>No branch sites found</h4>
                  <p style={{ margin: 0, fontSize: '13px' }}>
                    No sites match &ldquo;{siteSearchQuery}&rdquo;. Try clearing your search or selecting &ldquo;ALL&rdquo; regions.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '12px' }}>
                  {filteredServiceSites.map(site => {
                    const isSelected = selectedSiteId === site.id;
                    return (
                      <div
                        key={site.id}
                        onClick={() => handleSelectSiteFromModal(site)}
                        style={{
                          background: isSelected ? '#eff6ff' : '#ffffff',
                          border: isSelected ? '2px solid #0284c7' : '1px solid #e2e8f0',
                          borderRadius: '10px',
                          padding: '14px 16px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '10px',
                          transition: 'all 0.15s ease',
                          boxShadow: isSelected ? '0 2px 8px rgba(2, 132, 199, 0.15)' : '0 1px 2px rgba(0,0,0,0.03)',
                          position: 'relative'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span
                                style={{
                                  background: isSelected ? '#0284c7' : '#0f172a',
                                  color: '#fff',
                                  padding: '3px 8px',
                                  borderRadius: '5px',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  fontFamily: 'var(--font-mono, monospace)'
                                }}
                              >
                                {site.code}
                              </span>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '2px 7px', borderRadius: '4px' }}>
                                {site.region || 'Metro Manila'}
                              </span>
                            </div>

                            {isSelected && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: '#0284c7' }}>
                                <Check size={14} />
                                <span>Active</span>
                              </span>
                            )}
                          </div>

                          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>
                            {site.name}
                          </h4>

                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '12px', color: '#475569', lineHeight: 1.4 }}>
                            <MapPin size={13} color="#94a3b8" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {site.full_address || site.address || 'Address on file'}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid #f1f5f9', fontSize: '11.5px', color: '#64748b' }}>
                          <div>
                            {site.contact_person && <span>Contact: <strong>{site.contact_person}</strong></span>}
                          </div>
                          <span style={{ color: '#0284c7', fontWeight: 600 }}>
                            {isSelected ? '✓ Selected' : 'Select Branch →'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="modal-footer" style={{ background: '#ffffff', borderTop: '1px solid #e2e8f0', padding: '12px 20px', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '12.5px', color: '#64748b' }}>
                Showing <strong>{filteredServiceSites.length}</strong> of <strong>{serviceSites.length}</strong> branch service hubs
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsSiteModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
