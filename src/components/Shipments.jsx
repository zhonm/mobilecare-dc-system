import { useState, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { generatePackingListPDF } from '../utils/pdfGenerator';
import {
  Download,
  CheckCircle,
  CheckCircle2,
  RotateCcw,
  Search,
  FileSpreadsheet,
  UploadCloud,
  FileText,
  X,
  RefreshCw,
  Check,
  Trash2,
  Lock,
  Truck,
  Plane,
  Clock,
  PackageCheck,
  Hash,
  Copy,
  Building2,
  MapPin,
  Layers,
  ChevronDown,
  ChevronUp,
  Calendar,
  Loader2,
  Archive,
  Eye
} from 'lucide-react';
import { parseShipmentManifestFile, downloadShipmentManifestTemplate, exportPackingListXLSX } from '../utils/excelParser';
import { isLockedConfirmedShipment, resolveSite } from '../utils/appContextHelpers';
import StatusChangeLoadingModal from './StatusChangeLoadingModal';
import {
  isShipmentMetroManila,
  isShipmentProvince,
  extractShipmentSerials,
  buildSerialDictionary,
  healShipmentItem,
  sortShipmentsChronological,
  partitionShipmentsByRecency,
  parseShipmentDate,
  isShipmentToday,
  getShipmentCourierDisplay,
  formatCourierWithMode,
  detectRecommendedShippingMode,
  hasBatteryItem
} from '../utils/shipmentHelpers';

export default function Shipments() {
  const {
    shipments,
    sites,
    parts,
    saveShipment,
    updateShipmentStatus,
    deleteShipment,
    confirmSiteReceive,
    partsRequests,
    updatePartsRequestStatus,
    batchImportShipments,
    showToast,
    currentUser,
    canUserDeleteRecord,
    supervisorSettings,
    inventoryUnits,
    dcIntakeRecords,
    masterlistData,
    savedRecords
  } = useApp();

  const { serialDict, partsMapByPn } = useMemo(() => {
    return buildSerialDictionary({
      dcIntakeRecords,
      inventoryUnits,
      parts,
      masterlistData,
      savedRecords,
      shipments
    });
  }, [dcIntakeRecords, inventoryUnits, parts, masterlistData, savedRecords, shipments]);

  // Regional Tab State: 'ALL' | 'METRO_MANILA' | 'PROVINCE'
  const [regionTab, setRegionTab] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [search, setSearch] = useState('');

  // Older Shipments Dropdown & View Mode State
  const [viewArchiveMode, setViewArchiveMode] = useState('recent_default'); // 'recent_default' | 'all' | 'older_only'
  const [isOlderExpanded, setIsOlderExpanded] = useState(false);

  // Consolidated Plain Text Serials Format & Copy State
  const [serialsFormat, setSerialsFormat] = useState('lines'); // 'lines' | 'csv' | 'tsv'
  const [showPlainTextArea, setShowPlainTextArea] = useState(false);
  const [copiedSerialToken, setCopiedSerialToken] = useState(null); // 'ALL' | specific serial string

  // Site Serials Aggregator Modal State
  const [isSiteSerialsModalOpen, setIsSiteSerialsModalOpen] = useState(false);
  const [selectedAggSiteId, setSelectedAggSiteId] = useState('');

  // Courier Pickup Handover Modal State
  const [pickupModalState, setPickupModalState] = useState(null);

  // Site Confirmation & Receipt Modal State
  const [receiveModalState, setReceiveModalState] = useState(null);

  // Completed Delivered Package Full Details Pop-up Modal State
  const [viewPackageModalState, setViewPackageModalState] = useState(null);
  const [packageModalSearch, setPackageModalSearch] = useState('');
  const [copiedPackageSerialToken, setCopiedPackageSerialToken] = useState(null);

  const handleOpenPackageDetails = (shipment) => {
    if (!shipment) return;
    const dest = resolveSite(shipment.site_id || shipment.site_name, sites);
    setViewPackageModalState({
      shipment,
      site: dest
    });
    setPackageModalSearch('');
    setCopiedPackageSerialToken(null);
    setSerialsFormat('lines');
    setShowPlainTextArea(false);
  };

  const handleCopyPackageModalSingleSerial = (sn) => {
    if (!sn) return;
    const clean = String(sn).trim().toUpperCase();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clean);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = clean;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedPackageSerialToken(clean);
    showToast(`Copied ${clean} to clipboard`, 'info');
    setTimeout(() => setCopiedPackageSerialToken(null), 2000);
  };

  const handleCopyPackageModalAllSerials = (shipment) => {
    if (!shipment || !Array.isArray(shipment.items)) return;
    const serials = extractShipmentSerials(shipment);
    if (serials.length === 0) {
      showToast('No serial numbers found in this package.', 'warning');
      return;
    }
    const textToCopy = serials.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedPackageSerialToken('ALL');
    showToast(`Copied ${serials.length} serials to clipboard`, 'success');
    setTimeout(() => setCopiedPackageSerialToken(null), 2500);
  };

  // Tracking Number Required Prompt Modal State (for Print / PDF)
  const [trackingModalState, setTrackingModalState] = useState(null);

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedBatch, setParsedBatch] = useState(null);
  const fileInputRef = useRef(null);

  // Shipment Deletion Modal State
  const [shipmentToDelete, setShipmentToDelete] = useState(null);
  const [deletionReason, setDeletionReason] = useState('Manifest Canceled / Not Dispatched');
  const [customDeletionReason, setCustomDeletionReason] = useState('');

  const handleConfirmDeleteShipment = async () => {
    if (!shipmentToDelete) return;
    const finalReason = deletionReason === 'OTHER'
      ? (customDeletionReason.trim() || 'Shipment manifest deleted by user')
      : (deletionReason || 'Manifest Canceled / Not Dispatched');
    try {
      await deleteShipment(shipmentToDelete.id, finalReason);
      setShipmentToDelete(null);
      setDeletionReason('Manifest Canceled / Not Dispatched');
      setCustomDeletionReason('');
    } catch (err) {
      console.error('Failed to delete shipment:', err);
      showToast('Failed to delete shipment: ' + (err.message || err), 'error');
    }
  };

  // Status Change Loading Screen State
  const [statusLoadingState, setStatusLoadingState] = useState(null);
  const [isSubmittingPickup, setIsSubmittingPickup] = useState(false);
  const isSubmittingPickupRef = useRef(false);
  const [isSubmittingTracking, setIsSubmittingTracking] = useState(false);
  const isSubmittingTrackingRef = useRef(false);

  const handleStatusChange = async (shipmentId, newStatus) => {
    const target = (shipments || []).find(s => s.id === shipmentId || s.invoice_ref === shipmentId || s.shipment_number === shipmentId);
    const targetLabel = (newStatus === 'pending_pickup' || newStatus === 'ready_for_pickup')
      ? 'Ready for Pickup'
      : (newStatus === 'draft' ? 'Draft' : newStatus);

    setStatusLoadingState({
      isOpen: true,
      invoiceRef: target?.invoice_ref || target?.shipment_number || 'Shipment',
      siteName: target?.site_name || target?.destination_site_name || '',
      targetStatus: targetLabel
    });

    const startTime = Date.now();
    try {
      await updateShipmentStatus(shipmentId, newStatus);
      const elapsed = Date.now() - startTime;
      if (elapsed < 350) {
        await new Promise(r => setTimeout(r, 350 - elapsed));
      }
    } finally {
      setStatusLoadingState(null);
    }
  };

  // Direct Corporate PDF Request Handler
  const handleRequestPrintOrPDF = (shipmentObj, items, siteObj, _action = 'pdf') => {
    const pdfOptions = {
      supervisorName: supervisorSettings?.supervisor_name || shipmentObj.verified_by_name || 'Anjo Alcazar',
      supervisorTitle: supervisorSettings?.supervisor_title || 'MDC Supervisor of DC',
      guardOnDuty: shipmentObj.guard_on_duty || supervisorSettings?.guard_on_duty,
      pickupDate: shipmentObj.pickup_date || shipmentObj.shipment_date
    };

    const sourceItems = items && items.length > 0 ? items : (shipmentObj?.items || []);
    const resolvedItems = sourceItems.map(it => healShipmentItem(it, serialDict, partsMapByPn));

    generatePackingListPDF(shipmentObj, resolvedItems, siteObj || {}, pdfOptions);
    showToast(`Downloaded 2-Page PDF (Packing List + Declaration Form) for ${shipmentObj.invoice_ref || 'manifest'}`, 'info');
  };

  // Direct Corporate Excel (.xlsx) Request Handler
  const handleDownloadXLSX = async (shipmentObj, items, siteObj) => {
    try {
      const sourceItems = items && items.length > 0 ? items : (shipmentObj?.items || []);
      const resolvedItems = sourceItems.map(it => healShipmentItem(it, serialDict, partsMapByPn));
      const exportOptions = {
        supervisorName: supervisorSettings?.supervisor_name || shipmentObj.verified_by_name || 'Anjo Alcazar',
        supervisorTitle: supervisorSettings?.supervisor_title || 'MDC Supervisor of DC',
        userName: currentUser?.fullName || currentUser?.name || shipmentObj.prepared_by_name || 'Zhon Manaois'
      };
      await exportPackingListXLSX(shipmentObj, resolvedItems, siteObj || {}, exportOptions);
      showToast(`Downloaded Excel Packing List (.xlsx) for ${shipmentObj.invoice_ref || shipmentObj.shipment_number || 'manifest'}`, 'success');
    } catch (err) {
      console.error('Failed to export XLSX:', err);
      showToast('Failed to export Excel file: ' + err.message, 'error');
    }
  };

  // Helper to normalize status
  const getNormalizedStatus = (sh) => {
    if (!sh) return 'pending_pickup';
    if (isLockedConfirmedShipment(sh) || sh.status === 'received_confirmed' || sh.status === 'delivered') {
      return 'received_confirmed';
    }
    if (sh.status === 'shipped' || sh.status === 'in_transit') {
      return 'shipped';
    }
    if (sh.status === 'draft' || sh.status === 'packing') {
      return 'draft';
    }
    return 'pending_pickup';
  };

  // Regional Summary Counts
  const regionalCounts = useMemo(() => {
    let all = 0;
    let mm = 0;
    let prov = 0;

    (shipments || []).forEach(sh => {
      if (!sh.items || sh.items.length === 0) return;
      all++;
      if (isShipmentMetroManila(sh, sites)) {
        mm++;
      } else {
        prov++;
      }
    });

    return { all, mm, prov };
  }, [shipments, sites]);

  // Status Summary Counts (dynamically scoped by active regional tab)
  const statusCounts = useMemo(() => {
    let pending = 0;
    let shipped = 0;
    let received = 0;
    let draft = 0;
    let validTotal = 0;

    (shipments || []).forEach(sh => {
      if (!sh.items || sh.items.length === 0) return;

      // Filter by active region tab
      if (regionTab === 'METRO_MANILA' && !isShipmentMetroManila(sh, sites)) return;
      if (regionTab === 'PROVINCE' && !isShipmentProvince(sh, sites)) return;

      validTotal++;
      const norm = getNormalizedStatus(sh);
      if (norm === 'received_confirmed') received++;
      else if (norm === 'shipped') shipped++;
      else if (norm === 'draft') draft++;
      else pending++;
    });

    return { total: validTotal, pending, shipped, received, draft };
  }, [shipments, regionTab, sites]);

  // Operational KPI metrics across active regional filter
  const kpiMetrics = useMemo(() => {
    let pendingManifests = 0;
    let pendingUnits = 0;
    let shippedManifests = 0;
    let shippedUnits = 0;
    let receivedManifests = 0;
    let receivedUnits = 0;
    let todayManifests = 0;
    let todayUnits = 0;
    let draftManifests = 0;
    let draftUnits = 0;

    (shipments || []).forEach(sh => {
      if (!sh.items || sh.items.length === 0) return;
      if (regionTab === 'METRO_MANILA' && !isShipmentMetroManila(sh, sites)) return;
      if (regionTab === 'PROVINCE' && !isShipmentProvince(sh, sites)) return;

      const units = sh.items?.length || 0;
      const norm = getNormalizedStatus(sh);

      if (norm === 'draft') {
        draftManifests++;
        draftUnits += units;
      } else if (norm === 'pending_pickup') {
        pendingManifests++;
        pendingUnits += units;
      } else if (norm === 'shipped') {
        shippedManifests++;
        shippedUnits += units;
      } else if (norm === 'received_confirmed') {
        receivedManifests++;
        receivedUnits += units;
      }

      if (isShipmentToday(sh)) {
        todayManifests++;
        todayUnits += units;
      }
    });

    return {
      pendingManifests,
      pendingUnits,
      shippedManifests,
      shippedUnits,
      receivedManifests,
      receivedUnits,
      todayManifests,
      todayUnits,
      draftManifests,
      draftUnits
    };
  }, [shipments, regionTab, sites]);

  // Filtered shipments list (regional tab + status pill + search query), chronologically sorted newest-first
  const filteredShipments = useMemo(() => {
    const list = (shipments || []).filter(s => {
      if (!s.items || s.items.length === 0) return false;

      // 1. Regional Tab Filter
      if (regionTab === 'METRO_MANILA' && !isShipmentMetroManila(s, sites)) return false;
      if (regionTab === 'PROVINCE' && !isShipmentProvince(s, sites)) return false;

      // 2. Status Filter
      const norm = getNormalizedStatus(s);
      if (filterStatus !== 'ALL') {
        if (filterStatus === 'pending_pickup' && norm !== 'pending_pickup') return false;
        if (filterStatus === 'shipped' && norm !== 'shipped') return false;
        if (filterStatus === 'received_confirmed' && norm !== 'received_confirmed') return false;
        if (filterStatus === 'draft' && norm !== 'draft') return false;
        if (filterStatus === 'today' && !isShipmentToday(s)) return false;
      }

      // 3. Search Filter (searches Invoice Ref, TS#, Tracking, Site, Courier, Rider, and Serial Numbers)
      if (search.trim()) {
        const q = search.toLowerCase();
        const refMatch = s.invoice_ref?.toLowerCase().includes(q) || s.shipment_number?.toLowerCase().includes(q);
        const tsMatch = (s.transfer_slip_number || s.transfer_slip)?.toLowerCase().includes(q);
        const trackMatch = s.tracking_number?.toLowerCase().includes(q);
        const siteMatch = s.site_name?.toLowerCase().includes(q);
        const carrierMatch = (s.carrier || s.courier)?.toLowerCase().includes(q);
        const pickupMatch = s.pickup_by_name?.toLowerCase().includes(q);
        const receivedMatch = s.received_by_name?.toLowerCase().includes(q);
        const serialMatch = s.items?.some(it => {
          const sn = String(it.serial_number || it.serialNumber || it.serial || '').toLowerCase();
          const pn = String(it.part_number || it.partNumber || '').toLowerCase();
          return sn.includes(q) || pn.includes(q);
        });
        if (!refMatch && !tsMatch && !trackMatch && !siteMatch && !carrierMatch && !pickupMatch && !receivedMatch && !serialMatch) return false;
      }
      return true;
    });

    return sortShipmentsChronological(list, 'desc');
  }, [shipments, regionTab, filterStatus, search, sites]);

  // Recency Partitioning: Recent & Active vs Older Historical Archive
  const { recentShipments, olderShipments } = useMemo(() => {
    const partitioned = partitionShipmentsByRecency(filteredShipments, 7);
    return {
      recentShipments: partitioned.recent,
      olderShipments: partitioned.older
    };
  }, [filteredShipments]);

  // Date span for older shipments archive description
  const olderDateSpan = useMemo(() => {
    if (olderShipments.length === 0) return '';
    const oldest = parseShipmentDate(olderShipments[olderShipments.length - 1]);
    const newestOlder = parseShipmentDate(olderShipments[0]);
    if (!oldest || !newestOlder) return '';
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (fmt(oldest) === fmt(newestOlder)) return fmt(oldest);
    return `${fmt(oldest)} — ${fmt(newestOlder)}`;
  }, [olderShipments]);

  // Today's Shipments: all manifests created or active today, sorted newest → oldest
  const todaysShipments = useMemo(() => {
    return (shipments || [])
      .filter(s => {
        if (!s.items || s.items.length === 0) return false;
        return isShipmentToday(s);
      })
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [shipments]);

  // Aggregate sites with active shipments for site-level serial viewer
  const availableSitesWithShipments = useMemo(() => {
    const siteMap = new Map();
    (shipments || []).forEach(s => {
      if (!s.items || s.items.length === 0) return;
      const resolved = resolveSite(s.site_id || s.site_name, sites);
      if (!siteMap.has(resolved.id)) {
        siteMap.set(resolved.id, {
          site: resolved,
          shipments: [s],
          totalUnits: s.items.length,
          isMM: isShipmentMetroManila(s, sites)
        });
      } else {
        const entry = siteMap.get(resolved.id);
        entry.shipments.push(s);
        entry.totalUnits += s.items.length;
      }
    });
    return Array.from(siteMap.values());
  }, [shipments, sites]);

  // --- Consolidated Shipment & Serial Numbers Handlers ---
  const handleOpenSerialsModal = (shipment) => {
    handleOpenPackageDetails(shipment);
  };

  const handleCopySerials = (shipment, format = serialsFormat) => {
    if (!shipment || !Array.isArray(shipment.items)) return;
    const serials = extractShipmentSerials(shipment);

    if (serials.length === 0) {
      showToast('No serial numbers found in this packing list.', 'warning');
      return;
    }

    let textToCopy = '';
    if (format === 'lines') {
      textToCopy = serials.join('\n');
    } else if (format === 'csv') {
      textToCopy = serials.join(', ');
    } else if (format === 'tsv') {
      const rows = shipment.items.map((it, idx) => {
        const healed = healShipmentItem(it, serialDict, partsMapByPn);
        const pn = healed.part_number || healed.partNumber || 'N/A';
        const desc = healed.description || healed.partDescription || '';
        const sn = String(healed.serial_number || healed.serialNumber || healed.serial || '').trim().toUpperCase();
        const box = healed.box_number ? `${healed.box_number}/${shipment.total_boxes || 1}` : '1/1';
        return `${idx + 1}\t${pn}\t${desc}\t${sn}\t${box}`;
      });
      textToCopy = `NO\tPART NUMBER\tDESCRIPTION\tSERIAL NUMBER\tBOX #\n${rows.join('\n')}`;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    setCopiedSerialToken('ALL');
    setCopiedPackageSerialToken('ALL');
    showToast(`Copied ${serials.length} serials to clipboard (${format === 'lines' ? 'GSX/Fixably plain text' : format.toUpperCase()})`, 'success');
    setTimeout(() => {
      setCopiedSerialToken(null);
      setCopiedPackageSerialToken(null);
    }, 2500);
  };

  const handleCopySingleSerial = (sn) => {
    if (!sn) return;
    const clean = String(sn).trim().toUpperCase();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clean);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = clean;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedSerialToken(clean);
    showToast(`Copied ${clean} to clipboard`, 'info');
    setTimeout(() => setCopiedSerialToken(null), 2000);
  };

  // --- Courier Handover: Open Modal ---
  const handleOpenPickupModal = (shipment) => {
    const isMM = isShipmentMetroManila(shipment, sites);
    const rawCarrier = shipment.carrier || shipment.courier || (isMM ? 'Lalamove' : 'Lite Express');
    const isLite = String(rawCarrier).toLowerCase().includes('lite express');
    const currentMode = shipment.shipping_mode || shipment.freight_mode || (isLite ? detectRecommendedShippingMode(shipment.items) : '');
    setPickupModalState({
      shipment,
      carrier: isLite ? 'Lite Express' : rawCarrier,
      shippingMode: currentMode || (hasBatteryItem(shipment.items) ? 'Land' : 'Air'),
      trackingNumber: shipment.tracking_number || '',
      transferSlip: shipment.transfer_slip_number || shipment.transfer_slip || '',
      riderName: shipment.pickup_by_name || '',
      riderPhone: shipment.rider_phone || '',
      vehiclePlate: shipment.vehicle_plate || '',
      guardOnDuty: shipment.guard_on_duty || supervisorSettings?.guard_on_duty || 'Anjo Alcazar / MDC DC Guard',
      pickupDate: shipment.pickup_date || new Date().toISOString().split('T')[0]
    });
  };

  // --- Courier Handover: Submit Pickup Action ---
  const handleConfirmCourierPickup = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!pickupModalState) return;
    if (isSubmittingPickupRef.current) return;

    const cleanTrk = String(pickupModalState.trackingNumber || '').trim();
    if (!cleanTrk) {
      showToast('Booking ID / Tracking Number is required for dispatch.', 'warning');
      return;
    }

    const targetShipment = pickupModalState.shipment;
    const isLite = String(pickupModalState.carrier || '').toLowerCase().includes('lite express');
    const shippingMode = isLite ? (pickupModalState.shippingMode || detectRecommendedShippingMode(targetShipment?.items)) : '';
    const cleanCarrier = isLite ? formatCourierWithMode('Lite Express', shippingMode) : (String(pickupModalState.carrier || '').trim() || 'Lite Express');
    const cleanRider = String(pickupModalState.riderName || '').trim();
    const cleanPickupDate = String(pickupModalState.pickupDate || '').trim() || new Date().toISOString().split('T')[0];
    const cleanTS = String(pickupModalState.transferSlip || '').trim();

    isSubmittingPickupRef.current = true;
    setIsSubmittingPickup(true);

    const invRef = targetShipment?.invoice_ref || targetShipment?.shipment_number || 'Shipment';
    const siteName = targetShipment?.site_name || targetShipment?.destination_site_name || '';

    // Immediately show responsive loading screen
    setStatusLoadingState({
      isOpen: true,
      title: 'Confirming Courier Dispatch & Handover...',
      subtitle: `Recording ${cleanCarrier} #${cleanTrk} & setting status to SHIPPED...`,
      invoiceRef: invRef,
      siteName: siteName,
      targetStatus: 'SHIPPED'
    });

    const startTime = Date.now();

    try {
      const updatedShipment = {
        ...targetShipment,
        status: 'shipped',
        carrier: cleanCarrier,
        courier: cleanCarrier,
        shipping_mode: isLite ? shippingMode : (targetShipment?.shipping_mode || ''),
        tracking_number: cleanTrk,
        booking_id: cleanTrk,
        pickup_by_name: cleanRider,
        courier_name: cleanRider,
        pickup_date: cleanPickupDate,
        shipment_date: cleanPickupDate,
        rider_phone: String(pickupModalState.riderPhone || '').trim(),
        vehicle_plate: String(pickupModalState.vehiclePlate || '').trim(),
        guard_on_duty: String(pickupModalState.guardOnDuty || '').trim(),
        ...(cleanTS ? { transfer_slip: cleanTS, transfer_slip_number: cleanTS } : {}),
        dispatched_at: new Date().toISOString(),
        dispatched_by: currentUser?.fullName || 'Warehouse Staff',
        updated_at: new Date().toISOString()
      };

      await saveShipment(updatedShipment);

      // Guarantee minimum 400ms duration for reassuring visual feedback
      const elapsed = Date.now() - startTime;
      if (elapsed < 400) {
        await new Promise(r => setTimeout(r, 400 - elapsed));
      }

      showToast(`Dispatched! Shipment ${updatedShipment.invoice_ref || updatedShipment.shipment_number} status set to SHIPPED (${cleanCarrier} #${cleanTrk}).`, 'success');
      setPickupModalState(null);
    } catch (err) {
      console.error('Failed to confirm courier pickup:', err);
      showToast('Failed to confirm courier pickup: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setStatusLoadingState(null);
      isSubmittingPickupRef.current = false;
      setIsSubmittingPickup(false);
    }
  };

  // --- Site Receipt: Open Modal ---
  const handleOpenReceiveModal = (shipment) => {
    const destSite = sites.find(st => st.id === shipment.site_id) || {};
    setReceiveModalState({
      shipment,
      site: destSite,
      receivedByName: currentUser?.fullName || `${destSite.code || 'Branch'} Staff`,
      receivedDate: new Date().toISOString().split('T')[0],
      receivedCondition: 'Good Condition (All parts intact & verified)',
      receivingNotes: 'Confirmed physical receipt of package and parts at branch.'
    });
  };

  // --- Site Receipt: Submit Receive Action ---
  const handleConfirmSiteReceive = async (e) => {
    e.preventDefault();
    if (!receiveModalState) return;

    const targetShipment = receiveModalState.shipment;
    const targetSite = receiveModalState.site;
    const invRef = targetShipment?.invoice_ref || targetShipment?.shipment_number || 'Shipment';
    const siteName = targetSite?.name || targetShipment?.site_name || '';

    setStatusLoadingState({
      isOpen: true,
      title: 'Confirming Site Package Receipt...',
      invoiceRef: invRef,
      siteName: siteName,
      targetStatus: 'Received Confirmed & Archived',
      isConfirmReceive: true
    });

    const startTime = Date.now();
    try {
      if (typeof confirmSiteReceive === 'function') {
        await confirmSiteReceive(
          targetShipment.id,
          {
            receivedByName: receiveModalState.receivedByName,
            receivedDate: receiveModalState.receivedDate,
            receivedCondition: receiveModalState.receivedCondition,
            receivingNotes: receiveModalState.receivingNotes
          },
          { partsRequests, updatePartsRequestStatus }
        );
      } else {
        const cleanReceiver = String(receiveModalState.receivedByName || '').trim() || currentUser?.fullName || 'Branch Staff';
        const cleanDate = String(receiveModalState.receivedDate || '').trim() || new Date().toISOString().split('T')[0];

        const updatedShipment = {
          ...targetShipment,
          status: 'received_confirmed',
          received_at: new Date().toISOString(),
          received_date: cleanDate,
          received_by_name: cleanReceiver,
          receiving_signature: cleanReceiver,
          receiving_condition: receiveModalState.receivedCondition,
          receiving_notes: receiveModalState.receivingNotes,
          updated_at: new Date().toISOString()
        };

        await saveShipment(updatedShipment);
        showToast(`Confirmed Receipt! Shipment ${updatedShipment.invoice_ref || updatedShipment.shipment_number} is now marked RECEIVED CONFIRMED and archived.`, 'success');
      }

      const elapsed = Date.now() - startTime;
      if (elapsed < 350) {
        await new Promise(r => setTimeout(r, 350 - elapsed));
      }

      setReceiveModalState(null);
    } catch (err) {
      console.error('Error confirming site receipt:', err);
      showToast(`Error confirming receipt: ${err?.message || 'Failed to update'}`, 'error');
    } finally {
      setStatusLoadingState(null);
    }
  };

  // Tracking modal submit for PDF / Print
  const handleConfirmTrackingModal = async () => {
    if (!trackingModalState) return;
    if (isSubmittingTrackingRef.current) return;

    const cleanTrk = String(trackingModalState.trackingInput || '').trim();
    if (!cleanTrk) {
      showToast('Booking ID / Tracking Number is required.', 'warning');
      return;
    }

    isSubmittingTrackingRef.current = true;
    setIsSubmittingTracking(true);

    const targetShipment = trackingModalState.shipment;
    const invRef = targetShipment?.invoice_ref || targetShipment?.shipment_number || 'Shipment';
    const siteName = trackingModalState.site?.name || targetShipment?.site_name || '';

    setStatusLoadingState({
      isOpen: true,
      title: 'Saving Dispatch Details...',
      subtitle: `Saving tracking details & preparing Packing List PDF...`,
      invoiceRef: invRef,
      siteName: siteName,
      targetStatus: 'DISPATCH RECORD'
    });

    const startTime = Date.now();
    try {
      const rawCarrierInput = String(trackingModalState.carrierInput || '').trim() || 'Lite Express';
      const isLite = rawCarrierInput.toLowerCase().includes('lite express');
      const sourceItems = trackingModalState.items && trackingModalState.items.length > 0 ? trackingModalState.items : (trackingModalState.shipment?.items || []);
      const modalMode = trackingModalState.shippingModeInput || (isLite ? (trackingModalState.shipment?.shipping_mode || detectRecommendedShippingMode(sourceItems)) : '');
      const cleanCarrier = isLite ? formatCourierWithMode('Lite Express', modalMode) : rawCarrierInput;
      const cleanCourierName = String(trackingModalState.courierNameInput || '').trim();
      const cleanGuardOnDuty = String(trackingModalState.guardOnDutyInput || '').trim();
      const cleanPickupDate = String(trackingModalState.pickupDateInput || '').trim() || new Date().toLocaleDateString('en-US');

      const updatedShipment = {
        ...trackingModalState.shipment,
        tracking_number: cleanTrk,
        booking_id: cleanTrk,
        carrier: cleanCarrier,
        courier: cleanCarrier,
        shipping_mode: isLite ? modalMode : (trackingModalState.shipment?.shipping_mode || ''),
        pickup_by_name: cleanCourierName,
        courier_name: cleanCourierName,
        pickup_date: cleanPickupDate,
        guard_on_duty: cleanGuardOnDuty,
        rider_phone: String(trackingModalState.riderPhoneInput || '').trim(),
        vehicle_plate: String(trackingModalState.vehiclePlateInput || '').trim()
      };

      await saveShipment(updatedShipment);

      const elapsed = Date.now() - startTime;
      if (elapsed < 350) {
        await new Promise(r => setTimeout(r, 350 - elapsed));
      }

      showToast(`Dispatch details & Booking ID #${cleanTrk} saved!`, 'success');

      const pdfOptions = {
        supervisorName: supervisorSettings?.supervisor_name || 'Anjo Alcazar',
        supervisorTitle: supervisorSettings?.supervisor_title || 'MDC Supervisor of DC',
        guardOnDuty: updatedShipment.guard_on_duty || supervisorSettings?.guard_on_duty,
        pickupDate: updatedShipment.pickup_date
      };

      const resolvedItems = sourceItems.map(it => healShipmentItem(it, serialDict, partsMapByPn));

      generatePackingListPDF(updatedShipment, resolvedItems, trackingModalState.site, pdfOptions);
      setTrackingModalState(null);
    } catch (err) {
      console.error('Failed to save tracking details:', err);
      showToast('Failed to save dispatch details: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setStatusLoadingState(null);
      isSubmittingTrackingRef.current = false;
      setIsSubmittingTracking(false);
    }
  };

  // --- XLSX / CSV Import Handling ---
  const handleFileSelect = async (file) => {
    if (!file) return;
    setIsParsing(true);
    try {
      const res = await parseShipmentManifestFile(file, sites, parts);
      if (res.success) {
        setParsedBatch(res);
        showToast(`Parsed ${res.shipments.length} shipments (${res.totalItems} total parts)`, 'info');
      } else {
        showToast(res.error || 'Failed to parse shipment manifest file', 'error');
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
    downloadShipmentManifestTemplate(format, sites);
    showToast(`Downloaded Shipment Manifest template (${format.toUpperCase()})`, 'info');
  };

  const handleConfirmBatchImport = () => {
    if (!parsedBatch || !parsedBatch.shipments || parsedBatch.shipments.length === 0) return;

    const res = batchImportShipments(parsedBatch.shipments);
    if (res.success) {
      setParsedBatch(null);
      setIsImportModalOpen(false);
    } else {
      showToast(res.error || 'Failed to import shipments', 'error');
    }
  };

  // Render a standardized, ergonomic table row for a shipment
  const renderShipmentRow = (sh, isOlder = false) => {
    const destSite = resolveSite(sh.site_id || sh.site_name, sites);
    const normStatus = getNormalizedStatus(sh);
    const isLatest = filteredShipments[0]?.id === sh.id;
    const isToday = todaysShipments.some(ts => ts.id === sh.id);

    return (
      <tr
        key={sh.id}
        onClick={(e) => {
          if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) {
            return;
          }
          handleOpenPackageDetails(sh);
        }}
        className="shipment-row-clickable"
        style={{
          background: isOlder ? '#fafbfc' : 'inherit',
          cursor: 'pointer'
        }}
        title="Click row to view full package & delivery details"
      >
        <td className="font-mono">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <strong style={{ color: '#0f172a', fontSize: '13px' }}>{sh.invoice_ref || sh.shipment_number}</strong>
            {isLatest && !isOlder && (
              <span style={{
                background: '#1d4ed8',
                color: '#fff',
                fontSize: '9px',
                fontWeight: 800,
                padding: '1px 6px',
                borderRadius: '8px',
                letterSpacing: '0.3px'
              }}>
                LATEST
              </span>
            )}
            {isToday && !isLatest && !isOlder && (
              <span style={{
                background: '#dbeafe',
                color: '#1d4ed8',
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '8px'
              }}>
                TODAY
              </span>
            )}
            {isOlder && (
              <span style={{
                background: '#f1f5f9',
                color: '#64748b',
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0'
              }}>
                ARCHIVED
              </span>
            )}
          </div>
          {(sh.transfer_slip_number || sh.transfer_slip) && (
            <div style={{ fontSize: '11px', color: '#0284c7', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span>TS:</span>
              <span style={{ fontWeight: 600 }}>{sh.transfer_slip_number || sh.transfer_slip}</span>
            </div>
          )}
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <strong style={{ color: '#0f172a' }}>{destSite.code || 'ASP'}</strong>
            <span
              className="badge"
              style={{
                fontSize: '9.5px',
                padding: '1px 5px',
                background: isShipmentMetroManila(sh, sites) ? '#e0f2fe' : '#f3e8ff',
                color: isShipmentMetroManila(sh, sites) ? '#0369a1' : '#6b21a8',
                border: `1px solid ${isShipmentMetroManila(sh, sites) ? '#bae6fd' : '#e9d5ff'}`,
                fontWeight: 600
              }}
            >
              {isShipmentMetroManila(sh, sites) ? 'Metro Manila' : 'Province'}
            </span>
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {destSite.name || sh.site_name}
          </div>
        </td>
        <td>
          <div>
            {(sh.pickup_date || (normStatus !== 'pending_pickup' && sh.shipment_date)) ? (
              <span style={{ fontWeight: 500, color: '#334155' }}>{sh.pickup_date || sh.shipment_date}</span>
            ) : (
              <span style={{ color: '#d97706', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={11} />
                Pending Dispatch
              </span>
            )}
          </div>
          {sh.received_date && (
            <div style={{ fontSize: '11px', color: '#059669', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <CheckCircle size={10} />
              <span>Received: {sh.received_date}</span>
            </div>
          )}
        </td>
        <td>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{getShipmentCourierDisplay(sh)}</div>
          <div className="font-mono" style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
            {sh.tracking_number ? `#${sh.tracking_number}` : <span style={{ fontStyle: 'italic', opacity: 0.7 }}>No Tracking #</span>}
          </div>
          {sh.pickup_by_name && (
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Rider: {sh.pickup_by_name}
            </div>
          )}
          {sh.received_by_name && (
            <div style={{ fontSize: '11px', color: '#047857' }}>
              Recv: {sh.received_by_name}
            </div>
          )}
        </td>
        <td style={{ textAlign: 'center', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
          {sh.items?.length || 0}
        </td>
        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
          {sh.box_number_label || (sh.box_number ? `${sh.box_number}/${sh.total_boxes || 1}` : `${sh.total_boxes || 1}`)}
        </td>
        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
          {normStatus === 'draft' ? (
            <span
              className="badge"
              style={{
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #cbd5e1',
                fontWeight: 700,
                fontSize: '10.5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '8px',
                whiteSpace: 'nowrap'
              }}
            >
              <FileText size={11} />
              <span>DRAFT</span>
            </span>
          ) : normStatus === 'pending_pickup' ? (
            <span
              className="badge"
              style={{
                background: '#fffbeb',
                color: '#b45309',
                border: '1px solid #fde68a',
                fontWeight: 700,
                fontSize: '10.5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '8px',
                whiteSpace: 'nowrap'
              }}
            >
              <Clock size={11} />
              <span>READY FOR PICKUP</span>
            </span>
          ) : normStatus === 'shipped' ? (
            <span
              className="badge"
              style={{
                background: '#f0f9ff',
                color: '#0369a1',
                border: '1px solid #bae6fd',
                fontWeight: 700,
                fontSize: '10.5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '8px',
                whiteSpace: 'nowrap'
              }}
            >
              <Truck size={11} />
              <span>SHIPPED</span>
            </span>
          ) : (
            <span
              className="badge"
              style={{
                background: '#ecfdf5',
                color: '#047857',
                border: '1px solid #a7f3d0',
                fontWeight: 700,
                fontSize: '10.5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '8px',
                whiteSpace: 'nowrap'
              }}
            >
              <CheckCircle size={11} />
              <span>RECEIVED CONFIRMED</span>
            </span>
          )}
        </td>

        <td style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', flexWrap: 'wrap' }}>
            {/* Document group */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleRequestPrintOrPDF(sh, sh.items, destSite, 'pdf')}
              title="Download Corporate PDF Manifest"
              style={{
                fontSize: '11.5px',
                padding: '4px 7px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px'
              }}
            >
              <Download size={12} />
              <span>PDF</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleDownloadXLSX(sh, sh.items, destSite)}
              title="Download Excel (.xlsx) Backup"
              style={{
                background: '#f0fdf4',
                color: '#15803d',
                borderColor: '#bbf7d0',
                fontSize: '11.5px',
                padding: '4px 7px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px'
              }}
            >
              <FileSpreadsheet size={12} color="#16a34a" />
              <span>XLSX</span>
            </button>

            {/* ACTION: Mark Ready when Draft */}
            {normStatus === 'draft' && (
              <button
                className="btn btn-sm"
                onClick={() => handleStatusChange(sh.id, 'pending_pickup')}
                title="Mark manifest as Ready for Pickup"
                style={{
                  background: '#fffbeb',
                  color: '#b45309',
                  border: '1px solid #fde68a',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  padding: '4px 8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <CheckCircle2 size={12} />
                <span>Mark Ready</span>
              </button>
            )}

            {/* ACTION BUTTON 1: Courier Pick Up (When Pending Pickup) */}
            {normStatus === 'pending_pickup' && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={() => handleOpenPickupModal(sh)}
                  title="Handover package to Courier (Update status to Shipped)"
                  style={{
                    background: '#f59e0b',
                    color: '#ffffff',
                    border: '1px solid #d97706',
                    fontWeight: 700,
                    fontSize: '11.5px',
                    padding: '4px 9px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: '0 1px 3px rgba(245, 158, 11, 0.3)'
                  }}
                >
                  <Truck size={12} />
                  <span>Pick Up</span>
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => handleStatusChange(sh.id, 'draft')}
                  title="Revert status to Draft for editing"
                  style={{
                    background: '#f1f5f9',
                    color: '#475569',
                    border: '1px solid #cbd5e1',
                    fontWeight: 600,
                    fontSize: '11.5px',
                    padding: '4px 7px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px'
                  }}
                >
                  <RotateCcw size={11} />
                  <span>Set Draft</span>
                </button>
              </>
            )}

            {/* ACTION BUTTON 2: Site Receive (When Shipped / In Transit) */}
            {normStatus === 'shipped' && (
              <button
                className="btn btn-sm"
                onClick={() => handleOpenReceiveModal(sh)}
                title="Branch/Site confirms receipt of package"
                style={{
                  background: '#10b981',
                  color: '#ffffff',
                  border: '1px solid #059669',
                  fontWeight: 700,
                  fontSize: '11.5px',
                  padding: '4px 9px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 1px 3px rgba(16, 185, 129, 0.3)'
                }}
              >
                <PackageCheck size={12} />
                <span>Receive</span>
              </button>
            )}

            {/* ACTION BUTTON 3: View Full Shipment & Package Details */}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenPackageDetails(sh);
              }}
              style={{
                color: isLockedConfirmedShipment(sh) ? '#047857' : '#0369a1',
                borderColor: isLockedConfirmedShipment(sh) ? '#a7f3d0' : '#bae6fd',
                background: isLockedConfirmedShipment(sh) ? '#ecfdf5' : '#f0f9ff',
                padding: '4px 8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontWeight: 600,
                fontSize: '11px',
                cursor: 'pointer'
              }}
              title="View full package shipment and delivery details"
            >
              <Eye size={12} color={isLockedConfirmedShipment(sh) ? '#059669' : '#0284c7'} />
              <span>Details</span>
            </button>

            {/* ACTION BUTTON 4: Delete Controls for Pending / Draft Manifests */}
            {!isLockedConfirmedShipment(sh) && normStatus !== 'shipped' && (
              canUserDeleteRecord(sh, currentUser) ? (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShipmentToDelete(sh);
                    setDeletionReason('Manifest Canceled / Not Dispatched');
                    setCustomDeletionReason('');
                  }}
                  title="Delete Pending Shipment"
                  style={{ background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5', padding: '4px 7px' }}
                >
                  <Trash2 size={12} />
                </button>
              ) : (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled
                  style={{ opacity: 0.4, cursor: 'not-allowed', padding: '4px 7px' }}
                  title={`Only ${sh.prepared_by_name || sh.saved_by_name || 'the creator'} can delete this shipment`}
                >
                  <Trash2 size={12} />
                </button>
              )
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="shipments-view">
      <style>{`
        .shipment-row-clickable {
          transition: background-color 0.15s ease;
        }
        .shipment-row-clickable:hover {
          background-color: #f0fdf4 !important;
        }
      `}</style>
      {/* 1. Header & Action Controls */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h3 style={{ margin: 0 }}>Shipments &amp; Manifest Archive</h3>
              <span className="badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                <Check size={11} style={{ display: 'inline', marginRight: '3px' }} />
                Database Persisted
              </span>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
              Multi-stage dispatch management with Courier Pickup and Site Confirmation ({shipments.length} total manifests)
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsSiteSerialsModalOpen(true)}
              style={{
                background: '#f8fafc',
                color: '#0f172a',
                borderColor: '#cbd5e1',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title="View all serial numbers grouped by site"
            >
              <Hash size={15} color="#0284c7" />
              <span>Serials by Site</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsImportModalOpen(true)}
              style={{
                background: '#f8fafc',
                color: 'var(--primary)',
                borderColor: 'var(--primary)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <FileSpreadsheet size={15} />
              <span>Import Manifests (XLSX / CSV)</span>
            </button>

            <div style={{ position: 'relative', width: '260px' }}>
              <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search ref, site, courier, tracking..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: '28px', paddingRight: search ? '28px' : '10px', height: '34px', fontSize: '12px', width: '100%' }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 2. Regional Navigation Tabs & Archive View Filter */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginTop: '16px',
          borderTop: '1px solid #f1f5f9',
          paddingTop: '14px'
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '4px' }}>
              Region:
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setRegionTab('ALL')}
              style={{
                background: regionTab === 'ALL' ? '#0f172a' : '#f8fafc',
                color: regionTab === 'ALL' ? '#ffffff' : '#475569',
                borderColor: regionTab === 'ALL' ? '#0f172a' : '#e2e8f0',
                fontWeight: 700,
                fontSize: '12px',
                borderRadius: '8px',
                padding: '5px 12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: regionTab === 'ALL' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              <Layers size={13} />
              <span>All Sites</span>
              <span style={{
                background: regionTab === 'ALL' ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                color: regionTab === 'ALL' ? '#fff' : '#475569',
                padding: '1px 6px',
                borderRadius: '10px',
                fontSize: '10.5px',
                fontWeight: 700,
                marginLeft: '2px'
              }}>
                {regionalCounts.all}
              </span>
            </button>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setRegionTab('METRO_MANILA')}
              style={{
                background: regionTab === 'METRO_MANILA' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : '#f8fafc',
                color: regionTab === 'METRO_MANILA' ? '#ffffff' : '#475569',
                borderColor: regionTab === 'METRO_MANILA' ? '#0284c7' : '#e2e8f0',
                fontWeight: 700,
                fontSize: '12px',
                borderRadius: '8px',
                padding: '5px 12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: regionTab === 'METRO_MANILA' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
              }}
            >
              <Building2 size={13} />
              <span>Metro Manila</span>
              <span style={{
                background: regionTab === 'METRO_MANILA' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: regionTab === 'METRO_MANILA' ? '#fff' : '#475569',
                padding: '1px 6px',
                borderRadius: '10px',
                fontSize: '10.5px',
                fontWeight: 700,
                marginLeft: '2px'
              }}>
                {regionalCounts.mm}
              </span>
            </button>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setRegionTab('PROVINCE')}
              style={{
                background: regionTab === 'PROVINCE' ? 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)' : '#f8fafc',
                color: regionTab === 'PROVINCE' ? '#ffffff' : '#475569',
                borderColor: regionTab === 'PROVINCE' ? '#7c3aed' : '#e2e8f0',
                fontWeight: 700,
                fontSize: '12px',
                borderRadius: '8px',
                padding: '5px 12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: regionTab === 'PROVINCE' ? '0 2px 6px rgba(124,58,237,0.25)' : 'none'
              }}
            >
              <MapPin size={13} />
              <span>Province</span>
              <span style={{
                background: regionTab === 'PROVINCE' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: regionTab === 'PROVINCE' ? '#fff' : '#475569',
                padding: '1px 6px',
                borderRadius: '10px',
                fontSize: '10.5px',
                fontWeight: 700,
                marginLeft: '2px'
              }}>
                {regionalCounts.prov}
              </span>
            </button>
          </div>

          {/* Archive View Filter Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Archive View:
            </span>
            <select
              value={viewArchiveMode}
              onChange={(e) => {
                const val = e.target.value;
                setViewArchiveMode(val);
                if (val === 'all' || val === 'older_only') {
                  setIsOlderExpanded(true);
                }
              }}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                cursor: 'pointer',
                height: '32px',
                outline: 'none',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
              }}
              title="Select view mode: Recent & Active (Default), All Shipments, or Older Archive"
            >
              <option value="recent_default">Recent &amp; Active (Default)</option>
              <option value="all">All Shipments ({statusCounts.total})</option>
              <option value="older_only">Older Archive Only ({olderShipments.length})</option>
            </select>
          </div>
        </div>

        {/* 3. Interactive Status Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm"
            onClick={() => setFilterStatus('ALL')}
            style={{
              background: filterStatus === 'ALL' ? '#0f172a' : '#f8fafc',
              color: filterStatus === 'ALL' ? '#fff' : '#475569',
              borderColor: filterStatus === 'ALL' ? '#0f172a' : '#e2e8f0',
              fontWeight: 600,
              fontSize: '12px',
              borderRadius: '20px',
              padding: '4px 12px'
            }}
          >
            All Manifests ({statusCounts.total})
          </button>

          <button
            className="btn btn-sm"
            onClick={() => setFilterStatus('draft')}
            style={{
              background: filterStatus === 'draft' ? '#475569' : '#f8fafc',
              color: filterStatus === 'draft' ? '#fff' : '#475569',
              borderColor: filterStatus === 'draft' ? '#475569' : '#e2e8f0',
              fontWeight: 600,
              fontSize: '12px',
              borderRadius: '20px',
              padding: '4px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <FileText size={12} />
            <span>Drafts ({statusCounts.draft})</span>
          </button>

          <button
            className="btn btn-sm"
            onClick={() => setFilterStatus('pending_pickup')}
            style={{
              background: filterStatus === 'pending_pickup' ? '#d97706' : '#fffbeb',
              color: filterStatus === 'pending_pickup' ? '#fff' : '#b45309',
              borderColor: filterStatus === 'pending_pickup' ? '#d97706' : '#fde68a',
              fontWeight: 600,
              fontSize: '12px',
              borderRadius: '20px',
              padding: '4px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <Clock size={12} />
            <span>Pending for Pickup ({statusCounts.pending})</span>
          </button>

          <button
            className="btn btn-sm"
            onClick={() => setFilterStatus('shipped')}
            style={{
              background: filterStatus === 'shipped' ? '#0284c7' : '#f0f9ff',
              color: filterStatus === 'shipped' ? '#fff' : '#0369a1',
              borderColor: filterStatus === 'shipped' ? '#0284c7' : '#bae6fd',
              fontWeight: 600,
              fontSize: '12px',
              borderRadius: '20px',
              padding: '4px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <Truck size={12} />
            <span>Shipped / In Transit ({statusCounts.shipped})</span>
          </button>

          <button
            className="btn btn-sm"
            onClick={() => setFilterStatus('received_confirmed')}
            style={{
              background: filterStatus === 'received_confirmed' ? '#059669' : '#ecfdf5',
              color: filterStatus === 'received_confirmed' ? '#fff' : '#047857',
              borderColor: filterStatus === 'received_confirmed' ? '#059669' : '#a7f3d0',
              fontWeight: 600,
              fontSize: '12px',
              borderRadius: '20px',
              padding: '4px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <CheckCircle size={12} />
            <span>Received Confirmed ({statusCounts.received})</span>
          </button>

          <button
            className="btn btn-sm"
            onClick={() => setFilterStatus(filterStatus === 'today' ? 'ALL' : 'today')}
            style={{
              background: filterStatus === 'today' ? '#4f46e5' : '#eef2ff',
              color: filterStatus === 'today' ? '#fff' : '#4338ca',
              borderColor: filterStatus === 'today' ? '#4f46e5' : '#c7d2fe',
              fontWeight: 600,
              fontSize: '12px',
              borderRadius: '20px',
              padding: '4px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <Calendar size={12} />
            <span>Today ({kpiMetrics.todayManifests})</span>
          </button>
        </div>
      </div>

      {/* ── Operational KPI Metric Strip ───────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '12px',
        marginBottom: '16px'
      }}>
        {/* Card 1: Pending Pickup */}
        <div
          onClick={() => setFilterStatus(filterStatus === 'pending_pickup' ? 'ALL' : 'pending_pickup')}
          className="card"
          style={{
            padding: '14px 16px',
            cursor: 'pointer',
            background: filterStatus === 'pending_pickup' ? '#fffbeb' : '#ffffff',
            border: `1.5px solid ${filterStatus === 'pending_pickup' ? '#f59e0b' : '#fde68a'}`,
            boxShadow: filterStatus === 'pending_pickup' ? '0 2px 8px rgba(245, 158, 11, 0.2)' : '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.15s ease'
          }}
          title="Click to filter by Pending for Pickup"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Pending Pickup
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#b45309', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                {kpiMetrics.pendingManifests}
              </div>
              <div style={{ fontSize: '11.5px', color: '#92400e', marginTop: '2px' }}>
                {kpiMetrics.pendingUnits} units awaiting courier
              </div>
            </div>
            <div style={{ background: '#fef3c7', padding: '8px', borderRadius: '10px', color: '#d97706', display: 'flex' }}>
              <Clock size={18} />
            </div>
          </div>
        </div>

        {/* Card 2: In Transit */}
        <div
          onClick={() => setFilterStatus(filterStatus === 'shipped' ? 'ALL' : 'shipped')}
          className="card"
          style={{
            padding: '14px 16px',
            cursor: 'pointer',
            background: filterStatus === 'shipped' ? '#f0f9ff' : '#ffffff',
            border: `1.5px solid ${filterStatus === 'shipped' ? '#0284c7' : '#bae6fd'}`,
            boxShadow: filterStatus === 'shipped' ? '0 2px 8px rgba(2, 132, 199, 0.2)' : '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.15s ease'
          }}
          title="Click to filter by Shipped / In Transit"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                In Transit
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#0369a1', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                {kpiMetrics.shippedManifests}
              </div>
              <div style={{ fontSize: '11.5px', color: '#0284c7', marginTop: '2px' }}>
                {kpiMetrics.shippedUnits} units with couriers
              </div>
            </div>
            <div style={{ background: '#e0f2fe', padding: '8px', borderRadius: '10px', color: '#0284c7', display: 'flex' }}>
              <Truck size={18} />
            </div>
          </div>
        </div>

        {/* Card 3: Received Confirmed */}
        <div
          onClick={() => setFilterStatus(filterStatus === 'received_confirmed' ? 'ALL' : 'received_confirmed')}
          className="card"
          style={{
            padding: '14px 16px',
            cursor: 'pointer',
            background: filterStatus === 'received_confirmed' ? '#ecfdf5' : '#ffffff',
            border: `1.5px solid ${filterStatus === 'received_confirmed' ? '#059669' : '#a7f3d0'}`,
            boxShadow: filterStatus === 'received_confirmed' ? '0 2px 8px rgba(5, 150, 105, 0.2)' : '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.15s ease'
          }}
          title="Click to filter by Received Confirmed"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Received Confirmed
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#047857', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                {kpiMetrics.receivedManifests}
              </div>
              <div style={{ fontSize: '11.5px', color: '#059669', marginTop: '2px' }}>
                {kpiMetrics.receivedUnits} units branch verified
              </div>
            </div>
            <div style={{ background: '#d1fae5', padding: '8px', borderRadius: '10px', color: '#059669', display: 'flex' }}>
              <CheckCircle size={18} />
            </div>
          </div>
        </div>

        {/* Card 4: Today's Dispatches */}
        <div
          onClick={() => setFilterStatus(filterStatus === 'today' ? 'ALL' : 'today')}
          className="card"
          style={{
            padding: '14px 16px',
            cursor: 'pointer',
            background: filterStatus === 'today' ? '#eef2ff' : '#ffffff',
            border: `1.5px solid ${filterStatus === 'today' ? '#4f46e5' : '#c7d2fe'}`,
            boxShadow: filterStatus === 'today' ? '0 2px 8px rgba(79, 70, 229, 0.2)' : '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.15s ease'
          }}
          title="Click to filter manifests active today"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Today's Dispatches
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#3730a3', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                {kpiMetrics.todayManifests}
              </div>
              <div style={{ fontSize: '11.5px', color: '#4f46e5', marginTop: '2px' }}>
                {kpiMetrics.todayUnits} units active today
              </div>
            </div>
            <div style={{ background: '#e0e7ff', padding: '8px', borderRadius: '10px', color: '#4f46e5', display: 'flex' }}>
              <Calendar size={18} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Primary Shipment Manifests Table ────────────────────────── */}
      {(() => {
        const primaryDisplayShipments = viewArchiveMode === 'older_only'
          ? olderShipments
          : (viewArchiveMode === 'all' ? filteredShipments : recentShipments);

        const shouldRenderOlderDropdown = viewArchiveMode === 'recent_default' && olderShipments.length > 0;
        const isSearchActive = search.trim().length > 0;
        const effectiveOlderExpanded = isOlderExpanded || (isSearchActive && olderShipments.length > 0) || (filterStatus === 'received_confirmed' && recentShipments.length === 0);

        return (
          <>
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1.5px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              {/* Primary Table Header Banner */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 18px',
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                borderBottom: '1px solid #e2e8f0',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>
                    {viewArchiveMode === 'older_only'
                      ? 'Older Shipments Archive'
                      : (viewArchiveMode === 'all' ? 'All Outbound Manifests' : 'Active & Recent Shipments')}
                  </span>
                  <span style={{
                    background: '#dbeafe',
                    color: '#1d4ed8',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '10px'
                  }}>
                    {primaryDisplayShipments.length} manifest{primaryDisplayShipments.length !== 1 ? 's' : ''}
                  </span>
                  {viewArchiveMode === 'recent_default' && (
                    <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                      · Active queue &amp; recent dispatches
                    </span>
                  )}
                  {todaysShipments.length > 0 && (
                    <span style={{
                      background: '#ecfdf5',
                      color: '#047857',
                      border: '1px solid #a7f3d0',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '8px'
                    }}>
                      {todaysShipments.length} today
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {shouldRenderOlderDropdown && (
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      {olderShipments.length} older shipment{olderShipments.length !== 1 ? 's' : ''} archived below
                    </span>
                  )}
                </div>
              </div>

              <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice Ref</th>
                      <th>Destination Site</th>
                      <th>Shipment / Pickup Date</th>
                      <th>Courier &amp; Tracking</th>
                      <th style={{ textAlign: 'center' }}>Total Units</th>
                      <th style={{ textAlign: 'center' }}>Boxes</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {primaryDisplayShipments.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                          {search ? (
                            <div>
                              <div>No active or recent shipments matching &quot;{search}&quot;.</div>
                              {olderShipments.length > 0 && (
                                <div style={{ marginTop: '8px', color: '#0284c7', fontWeight: 600 }}>
                                  {olderShipments.length} matching record{olderShipments.length !== 1 ? 's' : ''} found in the Older Shipments Archive below.
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              {viewArchiveMode === 'recent_default' && olderShipments.length > 0 ? (
                                <div>
                                  <div style={{ fontWeight: 600, color: '#334155' }}>
                                    No active or recent shipments for this filter.
                                  </div>
                                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                    All {olderShipments.length} completed records are archived in the Older Shipments section below.
                                  </div>
                                  <div style={{ marginTop: '12px' }}>
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => setIsOlderExpanded(true)}
                                      style={{ fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                                    >
                                      <ChevronDown size={14} />
                                      <span>Expand Older Shipments ({olderShipments.length})</span>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                'No shipments found for this status. Pack parts or import manifests above.'
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : (
                      primaryDisplayShipments.map(sh => renderShipmentRow(sh, false))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Older Shipments Archive Collapsible Dropdown Feature ── */}
            {shouldRenderOlderDropdown && (
              <div
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  marginTop: '16px',
                  border: '1.5px solid #e2e8f0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                }}
              >
                {/* Collapsible Dropdown Header */}
                <div
                  onClick={() => setIsOlderExpanded(prev => !prev)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    background: effectiveOlderExpanded ? 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)' : '#f8fafc',
                    borderBottom: effectiveOlderExpanded ? '1px solid #e2e8f0' : 'none',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'background 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      background: '#e0f2fe',
                      color: '#0284c7',
                      padding: '8px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Archive size={16} />
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>
                          Older Shipments Archive
                        </span>
                        <span style={{
                          background: '#e2e8f0',
                          color: '#334155',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '10px'
                        }}>
                          {olderShipments.length} manifest{olderShipments.length !== 1 ? 's' : ''}
                        </span>
                        {isSearchActive && (
                          <span style={{
                            background: '#dbeafe',
                            color: '#1d4ed8',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '6px'
                          }}>
                            Matched Search
                          </span>
                        )}
                        <span style={{
                          fontSize: '10px',
                          color: '#64748b',
                          background: '#f1f5f9',
                          border: '1px solid #e2e8f0',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600
                        }}>
                          Hidden by Default
                        </span>
                      </div>

                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                        Completed &amp; confirmed historical dispatches {olderDateSpan ? `(${olderDateSpan})` : 'older than 7 days'} · Kept collapsed to prioritize recent operations
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOlderExpanded(prev => !prev);
                      }}
                      style={{
                        background: effectiveOlderExpanded ? '#e2e8f0' : '#ffffff',
                        fontWeight: 600,
                        fontSize: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 12px'
                      }}
                    >
                      {effectiveOlderExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      <span>{effectiveOlderExpanded ? 'Hide Older Shipments' : `Show Older Shipments (${olderShipments.length})`}</span>
                    </button>
                  </div>
                </div>

                {/* Collapsible Dropdown Table Content */}
                {effectiveOlderExpanded && (
                  <div>
                    <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Invoice Ref</th>
                            <th>Destination Site</th>
                            <th>Shipment / Pickup Date</th>
                            <th>Courier &amp; Tracking</th>
                            <th style={{ textAlign: 'center' }}>Total Units</th>
                            <th style={{ textAlign: 'center' }}>Boxes</th>
                            <th style={{ textAlign: 'center' }}>Status</th>
                            <th style={{ textAlign: 'center' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {olderShipments.map(sh => renderShipmentRow(sh, true))}
                        </tbody>
                      </table>
                    </div>

                    <div style={{
                      padding: '10px 18px',
                      background: '#f8fafc',
                      borderTop: '1px solid #f1f5f9',
                      fontSize: '11.5px',
                      color: '#64748b',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px'
                    }}>
                      <span>
                        Showing all {olderShipments.length} archived historical manifests. All items and serials are permanently preserved in database storage.
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsOlderExpanded(false)}
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '11px', padding: '2px 8px', height: '26px' }}
                      >
                        <ChevronUp size={12} />
                        <span>Collapse Archive</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        );
      })()}

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
                  <h3 style={{ color: '#fff', fontSize: '17px', margin: 0 }}>Import Shipment Manifests (XLSX / CSV)</h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Bulk upload historical or branch packing manifests
                  </p>
                </div>
              </div>
              <button onClick={() => setIsImportModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {/* Template Row */}
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
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-main)' }}>Need a formatted manifest template?</span>
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
                    {isParsing ? 'Processing and validating shipment manifest...' : isDragging ? 'Drop manifest file here' : 'Click to browse or drag & drop shipment file'}
                  </h4>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                    Supports Microsoft Excel (<strong>.xlsx, .xls</strong>) and <strong>.csv</strong> files
                  </p>
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

                  <div className="table-container" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                    <table className="data-table" style={{ fontSize: '12.5px' }}>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Invoice Ref</th>
                          <th>Shipment Number</th>
                          <th>Destination Site</th>
                          <th>Carrier</th>
                          <th>Items Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedBatch.shipments.map((sh, idx) => (
                          <tr key={sh.id || idx}>
                            <td className="font-mono">{idx + 1}</td>
                            <td className="font-mono"><strong>{sh.invoice_ref}</strong></td>
                            <td className="font-mono">{sh.shipment_number}</td>
                            <td>{sh.site_name || 'Branch'}</td>
                            <td>{sh.carrier}</td>
                            <td style={{ textAlign: 'center', fontWeight: 600 }}>{sh.items?.length || 0}</td>
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
                  onClick={handleConfirmBatchImport}
                  disabled={parsedBatch.shipments.length === 0}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CheckCircle size={16} />
                  <span>Import {parsedBatch.shipments.length} Shipment Manifests</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Tracking Number & Declaration Form Required for Official Print / PDF --- */}
      {trackingModalState && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setTrackingModalState(null); }}>
          <div className="modal-content" style={{ maxWidth: '580px', width: '95%' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#38bdf8', padding: '6px', borderRadius: '6px', color: '#0f172a' }}>
                  <Download size={20} />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '15px', margin: 0 }}>
                    Dispatch Details &amp; Declaration Form Record
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '11.5px', margin: '2px 0 0 0' }}>
                    Manifest {trackingModalState.shipment?.invoice_ref || trackingModalState.shipment?.shipment_number || 'Shipment'} • Destination: {trackingModalState.site?.name || 'Service Hub'}
                  </p>
                </div>
              </div>
              <button onClick={() => setTrackingModalState(null)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleConfirmTrackingModal(); }}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px' }}>
                  <p style={{ margin: 0, fontSize: '12px', color: '#334155', lineHeight: 1.4 }}>
                    To generate the official 2-Page corporate Packing List and Declaration Form, please provide the courier and pickup details below.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                      Booking ID / Airway Bill <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input font-mono"
                      placeholder="e.g. TRK-20227258, LAL-897123"
                      value={trackingModalState.trackingInput}
                      onChange={(e) => setTrackingModalState(prev => ({ ...prev, trackingInput: e.target.value }))}
                      autoFocus
                      required
                      style={{ fontSize: '12.5px' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                      Type of Courier <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Lalamove, Lite Express, Grab"
                      value={trackingModalState.carrierInput}
                      onChange={(e) => setTrackingModalState(prev => ({ ...prev, carrierInput: e.target.value }))}
                      required
                      style={{ fontSize: '12.5px' }}
                    />
                    {String(trackingModalState.carrierInput || '').toLowerCase().includes('lite express') && (
                      <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Mode:</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => setTrackingModalState(prev => ({ ...prev, shippingModeInput: 'Air', carrierInput: 'Lite Express (Air)' }))}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              border: (trackingModalState.shippingModeInput === 'Air' || (!trackingModalState.shippingModeInput && !hasBatteryItem(trackingModalState.shipment?.items)))
                                ? '1px solid #0284c7'
                                : '1px solid #cbd5e1',
                              background: (trackingModalState.shippingModeInput === 'Air' || (!trackingModalState.shippingModeInput && !hasBatteryItem(trackingModalState.shipment?.items)))
                                ? '#0284c7'
                                : '#f8fafc',
                              color: (trackingModalState.shippingModeInput === 'Air' || (!trackingModalState.shippingModeInput && !hasBatteryItem(trackingModalState.shipment?.items)))
                                ? '#ffffff'
                                : '#334155'
                            }}
                          >
                            <Plane size={11} /> Air
                          </button>
                          <button
                            type="button"
                            onClick={() => setTrackingModalState(prev => ({ ...prev, shippingModeInput: 'Land', carrierInput: 'Lite Express (Land)' }))}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              border: (trackingModalState.shippingModeInput === 'Land' || (!trackingModalState.shippingModeInput && hasBatteryItem(trackingModalState.shipment?.items)))
                                ? '1px solid #f59e0b'
                                : '1px solid #cbd5e1',
                              background: (trackingModalState.shippingModeInput === 'Land' || (!trackingModalState.shippingModeInput && hasBatteryItem(trackingModalState.shipment?.items)))
                                ? '#d97706'
                                : '#f8fafc',
                              color: (trackingModalState.shippingModeInput === 'Land' || (!trackingModalState.shippingModeInput && hasBatteryItem(trackingModalState.shipment?.items)))
                                ? '#ffffff'
                                : '#334155'
                            }}
                          >
                            <Truck size={11} /> Land
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>
                      Courier / Rider Name (Optional)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Juan Dela Cruz (or leave blank)"
                      value={trackingModalState.courierNameInput}
                      onChange={(e) => setTrackingModalState(prev => ({ ...prev, courierNameInput: e.target.value }))}
                      style={{ fontSize: '12.5px' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>
                      Guard on Duty (Optional)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. SG. Roberto Cruz (or leave blank for physical sign)"
                      value={trackingModalState.guardOnDutyInput}
                      onChange={(e) => setTrackingModalState(prev => ({ ...prev, guardOnDutyInput: e.target.value }))}
                      style={{ fontSize: '12.5px' }}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                    Date of Pickup <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 8/30/2026"
                    value={trackingModalState.pickupDateInput}
                    onChange={(e) => setTrackingModalState(prev => ({ ...prev, pickupDateInput: e.target.value }))}
                    required
                    style={{ fontSize: '12.5px' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '4px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>
                      Rider Contact Phone (Optional)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. 0917-123-4567"
                      value={trackingModalState.riderPhoneInput}
                      onChange={(e) => setTrackingModalState(prev => ({ ...prev, riderPhoneInput: e.target.value }))}
                      style={{ fontSize: '12.5px' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>
                      Vehicle Plate # (Optional)
                    </label>
                    <input
                      type="text"
                      className="form-input font-mono"
                      placeholder="e.g. ABC 1234"
                      value={trackingModalState.vehiclePlateInput}
                      onChange={(e) => setTrackingModalState(prev => ({ ...prev, vehiclePlateInput: e.target.value }))}
                      style={{ fontSize: '12.5px' }}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isSubmittingTracking}
                  onClick={() => setTrackingModalState(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTracking}
                  className="btn btn-primary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: isSubmittingTracking ? 0.75 : 1,
                    cursor: isSubmittingTracking ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isSubmittingTracking ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      <span>Saving Dispatch Details...</span>
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      <span>Save &amp; Download PDF (2 Pages)</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* --- MODAL 1: Courier Pickup Handover (Pending for Pickup -> Shipped) --- */}
      {pickupModalState && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPickupModalState(null); }}>
          <div className="modal-content" style={{ maxWidth: '560px', width: '95%' }}>
            <div className="modal-header" style={{ background: '#1e293b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#f59e0b', padding: '7px', borderRadius: '6px', color: '#fff' }}>
                  <Truck size={20} />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>
                    Courier Pickup & Dispatch Handover
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '11.5px', margin: '2px 0 0 0' }}>
                    Manifest: <strong>{pickupModalState.shipment?.invoice_ref || pickupModalState.shipment?.shipment_number}</strong>
                  </p>
                </div>
              </div>
              <button onClick={() => setPickupModalState(null)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleConfirmCourierPickup}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto', padding: '20px' }}>
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px' }}>
                  <p style={{ margin: 0, fontSize: '12px', color: '#92400e', lineHeight: 1.4 }}>
                    Confirm the courier pickup from the Distribution Center. This action transitions the manifest status from <strong>Pending for Pickup</strong> to <strong>Shipped</strong>.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                      Courier / Carrier <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <select
                      className="form-select"
                      value={pickupModalState.carrier}
                      onChange={(e) => setPickupModalState(prev => ({ ...prev, carrier: e.target.value }))}
                      style={{ fontSize: '12.5px', height: '36px' }}
                      required
                    >
                      <option value="Lite Express">Lite Express (Provincial)</option>
                      <option value="Lalamove">Lalamove (Metro Manila)</option>
                      <option value="2GO Express">2GO Express</option>
                      <option value="J&T Express">J&T Express</option>
                      <option value="Grab Express">Grab Express</option>
                      <option value="Utility / Direct MDC">Utility / Direct MDC</option>
                    </select>
                    {String(pickupModalState.carrier || '').toLowerCase().includes('lite express') && (
                      <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Freight Mode:</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => setPickupModalState(prev => ({ ...prev, shippingMode: 'Air' }))}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              border: (pickupModalState.shippingMode === 'Air' || (!pickupModalState.shippingMode && !hasBatteryItem(pickupModalState.shipment?.items)))
                                ? '1px solid #0284c7'
                                : '1px solid #cbd5e1',
                              background: (pickupModalState.shippingMode === 'Air' || (!pickupModalState.shippingMode && !hasBatteryItem(pickupModalState.shipment?.items)))
                                ? '#0284c7'
                                : '#f8fafc',
                              color: (pickupModalState.shippingMode === 'Air' || (!pickupModalState.shippingMode && !hasBatteryItem(pickupModalState.shipment?.items)))
                                ? '#ffffff'
                                : '#334155'
                            }}
                          >
                            <Plane size={11} /> Air Express
                          </button>
                          <button
                            type="button"
                            onClick={() => setPickupModalState(prev => ({ ...prev, shippingMode: 'Land' }))}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              border: (pickupModalState.shippingMode === 'Land' || (!pickupModalState.shippingMode && hasBatteryItem(pickupModalState.shipment?.items)))
                                ? '1px solid #f59e0b'
                                : '1px solid #cbd5e1',
                              background: (pickupModalState.shippingMode === 'Land' || (!pickupModalState.shippingMode && hasBatteryItem(pickupModalState.shipment?.items)))
                                ? '#d97706'
                                : '#f8fafc',
                              color: (pickupModalState.shippingMode === 'Land' || (!pickupModalState.shippingMode && hasBatteryItem(pickupModalState.shipment?.items)))
                                ? '#ffffff'
                                : '#334155'
                            }}
                          >
                            <Truck size={11} /> Land Cargo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                      Tracking Number / Booking ID <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input font-mono"
                      placeholder="e.g. 548396878383 or LAL-12345"
                      value={pickupModalState.trackingNumber}
                      onChange={(e) => setPickupModalState(prev => ({ ...prev, trackingNumber: e.target.value }))}
                      required
                      autoFocus
                      style={{ fontSize: '12.5px', height: '36px' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>
                      Rider / Driver Name
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Juan Dela Cruz"
                      value={pickupModalState.riderName}
                      onChange={(e) => setPickupModalState(prev => ({ ...prev, riderName: e.target.value }))}
                      style={{ fontSize: '12.5px', height: '36px' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                      Pickup Date <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="date"
                      className="form-input"
                      value={pickupModalState.pickupDate}
                      onChange={(e) => setPickupModalState(prev => ({ ...prev, pickupDate: e.target.value }))}
                      required
                      style={{ fontSize: '12.5px', height: '36px' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>
                      Rider Phone Number (Optional)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. 0917-123-4567"
                      value={pickupModalState.riderPhone}
                      onChange={(e) => setPickupModalState(prev => ({ ...prev, riderPhone: e.target.value }))}
                      style={{ fontSize: '12.5px', height: '36px' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>
                      Vehicle Plate # / Transport (Optional)
                    </label>
                    <input
                      type="text"
                      className="form-input font-mono"
                      placeholder="e.g. NBD 1234 / Motorcycle"
                      value={pickupModalState.vehiclePlate}
                      onChange={(e) => setPickupModalState(prev => ({ ...prev, vehiclePlate: e.target.value }))}
                      style={{ fontSize: '12.5px', height: '36px' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                      Transfer Slip # (Optional)
                    </label>
                    <input
                      type="text"
                      className="form-input font-mono"
                      placeholder="e.g. 20227468"
                      value={pickupModalState.transferSlip || ''}
                      onChange={(e) => setPickupModalState(prev => ({ ...prev, transferSlip: e.target.value }))}
                      style={{ fontSize: '12.5px', height: '36px' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '12px' }}>
                      DC Guard on Duty / Verifier
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. SG. Roberto Cruz"
                      value={pickupModalState.guardOnDuty}
                      onChange={(e) => setPickupModalState(prev => ({ ...prev, guardOnDuty: e.target.value }))}
                      style={{ fontSize: '12.5px', height: '36px' }}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isSubmittingPickup}
                  onClick={() => setPickupModalState(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPickup}
                  className="btn btn-primary"
                  style={{
                    background: '#0284c7',
                    borderColor: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: isSubmittingPickup ? 0.75 : 1,
                    cursor: isSubmittingPickup ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isSubmittingPickup ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      <span>Confirming Shipped Details...</span>
                    </>
                  ) : (
                    <>
                      <Truck size={14} />
                      <span>Confirm Courier Pickup &amp; Mark Shipped</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: Site Receive Confirmation (Shipped -> Received Confirmed) --- */}
      {receiveModalState && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setReceiveModalState(null); }}>
          <div className="modal-content" style={{ maxWidth: '580px', width: '95%' }}>
            <div className="modal-header" style={{ background: '#065f46' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#10b981', padding: '7px', borderRadius: '6px', color: '#fff' }}>
                  <PackageCheck size={20} />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>
                    Confirm Site Package Receipt
                  </h3>
                  <p style={{ color: '#a7f3d0', fontSize: '11.5px', margin: '2px 0 0 0' }}>
                    Destination: <strong>{receiveModalState.site?.name || receiveModalState.shipment?.site_name}</strong>
                  </p>
                </div>
              </div>
              <button onClick={() => setReceiveModalState(null)} style={{ background: 'transparent', border: 'none', color: '#a7f3d0', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleConfirmSiteReceive}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto', padding: '20px' }}>
                {/* Manifest Summary Box */}
                <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#065f46', fontWeight: 600 }}>
                      Invoice Ref: {receiveModalState.shipment?.invoice_ref || receiveModalState.shipment?.shipment_number}
                    </span>
                    <span style={{ fontSize: '12px', color: '#065f46', fontWeight: 700 }}>
                      {receiveModalState.shipment?.items?.length || 0} Total Units ({receiveModalState.shipment?.total_boxes || 1} Box)
                    </span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#047857' }}>
                    Courier: <strong>{getShipmentCourierDisplay(receiveModalState.shipment)}</strong> • Tracking: <strong>#{receiveModalState.shipment?.tracking_number || 'N/A'}</strong>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                      Received By (Staff Name) <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Maria Santos"
                      value={receiveModalState.receivedByName}
                      onChange={(e) => setReceiveModalState(prev => ({ ...prev, receivedByName: e.target.value }))}
                      required
                      autoFocus
                      style={{ fontSize: '12.5px', height: '36px' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                      Date of Receipt <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="date"
                      className="form-input"
                      value={receiveModalState.receivedDate}
                      onChange={(e) => setReceiveModalState(prev => ({ ...prev, receivedDate: e.target.value }))}
                      required
                      style={{ fontSize: '12.5px', height: '36px' }}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                    Package & Parts Condition Status
                  </label>
                  <select
                    className="form-select"
                    value={receiveModalState.receivedCondition}
                    onChange={(e) => setReceiveModalState(prev => ({ ...prev, receivedCondition: e.target.value }))}
                    style={{ fontSize: '12.5px', height: '36px' }}
                  >
                    <option value="Good Condition (All parts intact & verified)">Good Condition (All parts intact & verified)</option>
                    <option value="Minor box wear, all parts complete">Minor box wear, all parts complete</option>
                    <option value="Discrepancy / damage noted for inspection">Discrepancy / damage noted for inspection</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>
                    Receipt Remarks & Verification Notes
                  </label>
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="e.g. Received intact, verified all serial numbers matched manifest."
                    value={receiveModalState.receivingNotes}
                    onChange={(e) => setReceiveModalState(prev => ({ ...prev, receivingNotes: e.target.value }))}
                    style={{ fontSize: '12px', resize: 'vertical' }}
                  />
                </div>

                {/* Serial checklist preview */}
                {receiveModalState.shipment?.items && receiveModalState.shipment.items.length > 0 && (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                      Included Parts to be Confirmed at Site ({receiveModalState.shipment.items.length}):
                    </div>
                    <div style={{ maxHeight: '100px', overflowY: 'auto', fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#334155' }}>
                      {receiveModalState.shipment.items.map(it => healShipmentItem(it, serialDict, partsMapByPn)).map((it, idx) => (
                        <div key={idx} style={{ padding: '2px 0', borderBottom: '1px dashed #e2e8f0' }}>
                          • {it.part_number || it.description} - <strong>{it.serial_number || it.serialNumber}</strong> (Box {it.box_number || 1})
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReceiveModalState(null)}
                  disabled={Boolean(statusLoadingState?.isOpen)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={Boolean(statusLoadingState?.isOpen)}
                  style={{
                    background: '#059669',
                    borderColor: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: statusLoadingState?.isOpen ? 0.75 : 1,
                    cursor: statusLoadingState?.isOpen ? 'not-allowed' : 'pointer'
                  }}
                >
                  {statusLoadingState?.isOpen ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      <span>Confirming Receipt...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={14} />
                      <span>Confirm Receipt & Archive Manifest</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Delivered / Package Full Details Pop-up Modal --- */}
      {viewPackageModalState && (() => {
        const sh = viewPackageModalState.shipment;
        const site = viewPackageModalState.site;
        const normStatus = getNormalizedStatus(sh);
        const isReceivedConfirmed = normStatus === 'received_confirmed' || isLockedConfirmedShipment(sh);
        const isShipped = normStatus === 'shipped';
        const isPendingPickup = normStatus === 'pending_pickup';

        const headerGradient = isReceivedConfirmed
          ? 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)'
          : isShipped
          ? 'linear-gradient(135deg, #0369a1 0%, #0284c7 100%)'
          : isPendingPickup
          ? 'linear-gradient(135deg, #b45309 0%, #d97706 100%)'
          : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';

        const modalTitle = isReceivedConfirmed
          ? 'Delivered Package Details'
          : isShipped
          ? 'In-Transit Package Details'
          : isPendingPickup
          ? 'Ready for Pickup Package Details'
          : 'Draft Manifest Package Details';

        const statusBadgeStyle = isReceivedConfirmed
          ? { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }
          : isShipped
          ? { background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }
          : isPendingPickup
          ? { background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }
          : { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };

        const statusBadgeLabel = isReceivedConfirmed
          ? 'DELIVERED & CONFIRMED'
          : isShipped
          ? 'SHIPPED / IN TRANSIT'
          : isPendingPickup
          ? 'PENDING PICKUP'
          : 'DRAFT';

        return (
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setViewPackageModalState(null);
            }}
          >
            <div
              className="modal-content"
              style={{
                maxWidth: '880px',
                width: '95%',
                maxHeight: '92vh',
                display: 'flex',
                flexDirection: 'column',
                padding: 0,
                overflow: 'hidden'
              }}
            >
              {/* Modal Header */}
              <div
                className="modal-header"
                style={{
                  background: headerGradient,
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '16px 20px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.15)',
                      padding: '8px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {isReceivedConfirmed ? (
                      <PackageCheck size={24} color="#6ee7b7" />
                    ) : isShipped ? (
                      <Truck size={24} color="#93c5fd" />
                    ) : (
                      <Clock size={24} color="#fde68a" />
                    )}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <h3 style={{ color: '#ffffff', fontSize: '17px', margin: 0, fontWeight: 700 }}>
                        {modalTitle}
                      </h3>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: '12px',
                          textTransform: 'uppercase',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          ...statusBadgeStyle
                        }}
                      >
                        {statusBadgeLabel}
                      </span>
                    </div>
                    <p style={{ color: '#cbd5e1', fontSize: '12px', margin: '3px 0 0 0' }}>
                      Manifest: <strong style={{ color: '#f8fafc' }}>{sh?.invoice_ref || sh?.shipment_number}</strong>
                      {(sh?.transfer_slip_number || sh?.transfer_slip) && (
                        <span> • TS: <strong style={{ color: '#93c5fd' }}>{sh?.transfer_slip_number || sh?.transfer_slip}</strong></span>
                      )}
                      <span> • Destination: <strong style={{ color: '#f8fafc' }}>{site?.name || sh?.site_name}</strong></span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setViewPackageModalState(null)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    borderRadius: '6px',
                    padding: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div
                className="modal-body"
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  background: '#ffffff'
                }}
              >
                {/* Summary Cards Ribbon */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                    gap: '12px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '14px 16px'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                      Destination Site
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '13.5px', color: '#0f172a', marginTop: '2px' }}>
                      {site?.name || sh?.site_name}
                    </div>
                    <div style={{ marginTop: '4px' }}>
                      <span
                        className="badge"
                        style={{
                          fontSize: '10px',
                          background: isShipmentMetroManila(sh, sites) ? '#e0f2fe' : '#f3e8ff',
                          color: isShipmentMetroManila(sh, sites) ? '#0369a1' : '#6b21a8',
                          border: `1px solid ${isShipmentMetroManila(sh, sites) ? '#bae6fd' : '#e9d5ff'}`,
                          fontWeight: 600
                        }}
                      >
                        {isShipmentMetroManila(sh, sites) ? 'Metro Manila' : 'Province'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                      Courier &amp; Logistics
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a', marginTop: '2px' }}>
                      {getShipmentCourierDisplay(sh)}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#475569', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                      {sh?.tracking_number
                        ? `Waybill #${sh.tracking_number}`
                        : 'Direct Transfer / Hand Carry'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                      Package Volume
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#0284c7', marginTop: '2px' }}>
                      {(sh?.items || []).length} Serialized Units
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                      {sh?.total_boxes || 1} Box{(sh?.total_boxes || 1) > 1 ? 'es' : ''}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                      Reference Slip
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a', marginTop: '2px' }}>
                      {sh?.transfer_slip_number || sh?.transfer_slip ? (
                        <span style={{ color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                          TS #{sh?.transfer_slip_number || sh?.transfer_slip}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>None specified</span>
                      )}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                      Inv: {sh?.invoice_ref || sh?.shipment_number || 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Delivery & Confirmation Details Section */}
                <div
                  style={{
                    background: isReceivedConfirmed ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${isReceivedConfirmed ? '#86efac' : '#e2e8f0'}`,
                    borderRadius: '10px',
                    padding: '14px 16px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {isReceivedConfirmed ? (
                        <PackageCheck size={16} color="#16a34a" />
                      ) : (
                        <Clock size={16} color="#0284c7" />
                      )}
                      <strong
                        style={{
                          fontSize: '13px',
                          color: isReceivedConfirmed ? '#166534' : '#0369a1',
                          textTransform: 'uppercase',
                          letterSpacing: '0.4px'
                        }}
                      >
                        Branch Delivery &amp; Receipt Confirmation
                      </strong>
                    </div>
                    {!isReceivedConfirmed && (
                      <span
                        className="badge"
                        style={{
                          fontSize: '10.5px',
                          background: isShipped ? '#e0f2fe' : '#fef3c7',
                          color: isShipped ? '#0369a1' : '#b45309',
                          border: `1px solid ${isShipped ? '#bae6fd' : '#fde68a'}`,
                          fontWeight: 600
                        }}
                      >
                        {isShipped ? 'In Transit — Awaiting Site Receipt' : 'Awaiting Courier Handover'}
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '12px'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '11px', color: isReceivedConfirmed ? '#15803d' : '#64748b', fontWeight: 600 }}>
                        Received By (Staff / Tech)
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: isReceivedConfirmed ? '#14532d' : '#64748b', marginTop: '2px' }}>
                        {isReceivedConfirmed ? (
                          sh?.received_by_name || sh?.receiving_signature || 'Authorized Branch Staff'
                        ) : (
                          <span style={{ fontStyle: 'italic', fontWeight: 500, color: '#94a3b8' }}>
                            Awaiting Site Confirmation (Not yet received)
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '11px', color: isReceivedConfirmed ? '#15803d' : '#64748b', fontWeight: 600 }}>
                        Date &amp; Time of Receipt
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: isReceivedConfirmed ? '#14532d' : '#64748b', marginTop: '2px' }}>
                        {isReceivedConfirmed ? (
                          (() => {
                            const raw = sh?.received_at || sh?.received_date;
                            if (!raw) return 'Confirmed upon receipt';
                            try {
                              const d = new Date(raw);
                              if (isNaN(d.getTime())) return String(raw);
                              return d.toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true
                              });
                            } catch {
                              return String(raw);
                            }
                          })()
                        ) : (
                          <span style={{ fontStyle: 'italic', fontWeight: 500, color: '#94a3b8' }}>
                            {isShipped ? 'Pending physical delivery to branch' : 'Awaiting dispatch & delivery'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                      <div style={{ fontSize: '11px', color: isReceivedConfirmed ? '#15803d' : '#64748b', fontWeight: 600 }}>
                        Package &amp; Parts Condition
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '12.5px', color: isReceivedConfirmed ? '#14532d' : '#64748b', marginTop: '2px' }}>
                        {isReceivedConfirmed ? (
                          sh?.receiving_condition || 'Good Condition (All parts intact & verified)'
                        ) : (
                          <span style={{ fontStyle: 'italic', fontWeight: 500, color: '#94a3b8' }}>
                            Pending physical inspection upon branch arrival
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                      <div style={{ fontSize: '11px', color: isReceivedConfirmed ? '#15803d' : '#64748b', fontWeight: 600 }}>
                        Branch Remarks &amp; Notes
                      </div>
                      <div
                        style={{
                          background: '#ffffff',
                          border: `1px solid ${isReceivedConfirmed ? '#bbf7d0' : '#e2e8f0'}`,
                          borderRadius: '6px',
                          padding: '8px 12px',
                          fontSize: '12px',
                          color: isReceivedConfirmed ? '#166534' : '#64748b',
                          marginTop: '4px',
                          lineHeight: 1.4,
                          fontStyle: isReceivedConfirmed ? 'normal' : 'italic'
                        }}
                      >
                        {isReceivedConfirmed ? (
                          sh?.receiving_notes || 'Confirmed physical receipt of package and parts at branch.'
                        ) : (
                          isShipped
                            ? 'This package has been dispatched and is currently in transit with the courier. Receiving remarks and verification notes will only be recorded once the site user physically receives and confirms the shipment.'
                            : 'Package is in preparation/pending courier pickup. Confirmation details will appear after delivery and branch verification.'
                        )}
                      </div>
                    </div>
                  </div>
                </div>

              {/* Dispatch & Courier Handover Details Section */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '14px 16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <Truck size={16} color="#475569" />
                  <strong style={{ fontSize: '13px', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    Dispatch &amp; Handover Information
                  </strong>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Pickup / Dispatch Date</div>
                    <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#0f172a', marginTop: '2px' }}>
                      {viewPackageModalState.shipment?.pickup_date ||
                        viewPackageModalState.shipment?.shipment_date ||
                        (viewPackageModalState.shipment?.dispatched_at ? new Date(viewPackageModalState.shipment.dispatched_at).toLocaleDateString('en-US') : 'N/A')}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Rider / Handover Name</div>
                    <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#0f172a', marginTop: '2px' }}>
                      {viewPackageModalState.shipment?.pickup_by_name ||
                        viewPackageModalState.shipment?.courier_name ||
                        'Assigned Rider'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Rider Phone / Contact</div>
                    <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#0f172a', marginTop: '2px' }}>
                      {viewPackageModalState.shipment?.rider_phone || 'N/A'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Vehicle Plate #</div>
                    <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#0f172a', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                      {viewPackageModalState.shipment?.vehicle_plate || 'N/A'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Prepared / Packed By</div>
                    <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#0f172a', marginTop: '2px' }}>
                      {viewPackageModalState.shipment?.prepared_by_name ||
                        viewPackageModalState.shipment?.saved_by_name ||
                        'DC Warehouse Staff'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Supervisor / Guard on Duty</div>
                    <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#0f172a', marginTop: '2px' }}>
                      {viewPackageModalState.shipment?.guard_on_duty ||
                        viewPackageModalState.shipment?.supervisor_verified_by ||
                        'Verified'}
                    </div>
                  </div>
                </div>
              </div>

              {/* GSX / Fixably Plain Text Export Card (Consolidated) */}
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '10px',
                  padding: '14px 16px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <strong style={{ fontSize: '13.5px', color: '#14532d' }}>GSX / Fixably Plain Text Export</strong>
                      <span className="badge" style={{ background: '#dcfce7', color: '#15803d', fontSize: '10px', border: '1px solid #86efac' }}>
                        Ready to Paste
                      </span>
                    </div>
                    <p style={{ fontSize: '11.5px', color: '#166534', margin: '2px 0 0 0' }}>
                      Copies plain-text serials formatted for instant insertion into Apple GSX or Fixably Transfer tickets.
                    </p>
                  </div>

                  {/* Copy All Button */}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleCopySerials(viewPackageModalState.shipment, serialsFormat)}
                    style={{
                      background: copiedPackageSerialToken === 'ALL' || copiedSerialToken === 'ALL' ? '#15803d' : '#16a34a',
                      color: '#ffffff',
                      borderColor: '#15803d',
                      fontWeight: 700,
                      fontSize: '12.5px',
                      padding: '8px 16px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                      boxShadow: '0 2px 5px rgba(22, 163, 74, 0.25)',
                      cursor: 'pointer'
                    }}
                  >
                    {copiedPackageSerialToken === 'ALL' || copiedSerialToken === 'ALL' ? (
                      <>
                        <Check size={15} />
                        <span>Copied {extractShipmentSerials(viewPackageModalState.shipment).length} Serials!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={15} />
                        <span>Copy All Serials ({extractShipmentSerials(viewPackageModalState.shipment).length})</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Format Options & Plain Text Preview Toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderTop: '1px solid #dcfce7', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#166534' }}>Format:</span>
                    <button
                      type="button"
                      onClick={() => setSerialsFormat('lines')}
                      style={{
                        background: serialsFormat === 'lines' ? '#166534' : '#ffffff',
                        color: serialsFormat === 'lines' ? '#ffffff' : '#166534',
                        border: '1px solid #86efac',
                        borderRadius: '6px',
                        padding: '3px 9px',
                        fontSize: '11px',
                        fontWeight: serialsFormat === 'lines' ? 700 : 500,
                        cursor: 'pointer'
                      }}
                    >
                      1 Per Line (GSX/Fixably Bulk)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSerialsFormat('csv')}
                      style={{
                        background: serialsFormat === 'csv' ? '#166534' : '#ffffff',
                        color: serialsFormat === 'csv' ? '#ffffff' : '#166534',
                        border: '1px solid #86efac',
                        borderRadius: '6px',
                        padding: '3px 9px',
                        fontSize: '11px',
                        fontWeight: serialsFormat === 'csv' ? 700 : 500,
                        cursor: 'pointer'
                      }}
                    >
                      Comma Separated (CSV)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSerialsFormat('tsv')}
                      style={{
                        background: serialsFormat === 'tsv' ? '#166534' : '#ffffff',
                        color: serialsFormat === 'tsv' ? '#ffffff' : '#166534',
                        border: '1px solid #86efac',
                        borderRadius: '6px',
                        padding: '3px 9px',
                        fontSize: '11px',
                        fontWeight: serialsFormat === 'tsv' ? 700 : 500,
                        cursor: 'pointer'
                      }}
                    >
                      TSV Table (Part No + Serials)
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowPlainTextArea(prev => !prev)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#15803d',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    {showPlainTextArea ? 'Hide Plain-Text Area' : 'Show Plain-Text Area'}
                  </button>
                </div>

                {/* Collapsible Plain Textarea Box */}
                {showPlainTextArea && (
                  <div style={{ marginTop: '12px' }}>
                    <textarea
                      readOnly
                      rows={Math.min(8, Math.max(3, extractShipmentSerials(viewPackageModalState.shipment).length))}
                      value={
                        serialsFormat === 'lines'
                          ? extractShipmentSerials(viewPackageModalState.shipment).join('\n')
                          : serialsFormat === 'csv'
                          ? extractShipmentSerials(viewPackageModalState.shipment).join(', ')
                          : (viewPackageModalState.shipment?.items || []).map(it => healShipmentItem(it, serialDict, partsMapByPn)).map((it, idx) => `${idx + 1}\t${it.part_number || ''}\t${it.description || ''}\t${it.serial_number || it.serialNumber || ''}\t${it.box_number || 1}`).join('\n')
                      }
                      onFocus={(e) => e.target.select()}
                      style={{
                        width: '100%',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11.5px',
                        background: '#ffffff',
                        border: '1px solid #86efac',
                        borderRadius: '6px',
                        padding: '8px 10px',
                        color: '#0f172a'
                      }}
                    />
                    <div style={{ fontSize: '10.5px', color: '#166534', marginTop: '2px', textAlign: 'right' }}>
                      Click inside the box to select all text.
                    </div>
                  </div>
                )}
              </div>

              {/* Included Parts Table Section */}
              <div style={{ marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Hash size={16} color="#0284c7" />
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                      Included Parts &amp; Serial Numbers ({(viewPackageModalState.shipment?.items || []).length})
                    </strong>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Search Input */}
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="form-input form-input-sm"
                        placeholder="Search part or serial..."
                        value={packageModalSearch}
                        onChange={(e) => setPackageModalSearch(e.target.value)}
                        style={{ fontSize: '12px', paddingLeft: '28px', width: '200px' }}
                      />
                      <Search
                        size={13}
                        style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
                      />
                    </div>

                    {/* Copy All Serials */}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleCopyPackageModalAllSerials(viewPackageModalState.shipment)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        background: copiedPackageSerialToken === 'ALL' ? '#ecfdf5' : '#ffffff',
                        color: copiedPackageSerialToken === 'ALL' ? '#059669' : '#334155',
                        borderColor: copiedPackageSerialToken === 'ALL' ? '#a7f3d0' : '#cbd5e1'
                      }}
                      title="Copy all serial numbers in this package to clipboard"
                    >
                      {copiedPackageSerialToken === 'ALL' ? <Check size={13} color="#059669" /> : <Copy size={13} />}
                      <span>{copiedPackageSerialToken === 'ALL' ? 'Copied All!' : 'Copy All Serials'}</span>
                    </button>
                  </div>
                </div>

                {/* Parts Table */}
                <div
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    maxHeight: '260px',
                    overflowY: 'auto'
                  }}
                >
                  <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '8px 12px', color: '#475569', fontWeight: 600, width: '40px' }}>#</th>
                        <th style={{ padding: '8px 12px', color: '#475569', fontWeight: 600 }}>Part Number</th>
                        <th style={{ padding: '8px 12px', color: '#475569', fontWeight: 600 }}>Description</th>
                        <th style={{ padding: '8px 12px', color: '#475569', fontWeight: 600 }}>Serial Number</th>
                        <th style={{ padding: '8px 12px', color: '#475569', fontWeight: 600, width: '70px' }}>Box #</th>
                        <th style={{ padding: '8px 12px', color: '#475569', fontWeight: 600, width: '115px', textAlign: 'center', whiteSpace: 'nowrap' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const rawItems = viewPackageModalState.shipment?.items || [];
                        const healedItems = rawItems.map(it => healShipmentItem(it, serialDict, partsMapByPn));
                        const q = packageModalSearch.trim().toLowerCase();
                        const filtered = healedItems.filter(it => {
                          if (!q) return true;
                          const pn = String(it.part_number || it.partNumber || '').toLowerCase();
                          const desc = String(it.description || it.partDescription || '').toLowerCase();
                          const sn = String(it.serial_number || it.serialNumber || it.serial || '').toLowerCase();
                          const box = String(it.box_number || '').toLowerCase();
                          return pn.includes(q) || desc.includes(q) || sn.includes(q) || box.includes(q);
                        });

                        if (filtered.length === 0) {
                          return (
                            <tr>
                              <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                                {q ? `No parts match filter "${packageModalSearch}"` : 'No parts listed in this manifest.'}
                              </td>
                            </tr>
                          );
                        }

                        return filtered.map((it, idx) => {
                          const sn = String(it.serial_number || it.serialNumber || it.serial || '').trim().toUpperCase();
                          const isCopied = copiedPackageSerialToken === sn;

                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '8px 12px', color: '#64748b' }}>{idx + 1}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: '#0f172a' }}>
                                {it.part_number || it.partNumber || 'N/A'}
                              </td>
                              <td style={{ padding: '8px 12px', color: '#334155' }}>
                                {it.description || it.partDescription || '—'}
                              </td>
                              <td style={{ padding: '8px 12px' }}>
                                {sn ? (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0369a1' }}>
                                      {sn}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyPackageModalSingleSerial(sn)}
                                      title={`Copy serial ${sn}`}
                                      style={{
                                        background: isCopied ? '#dcfce7' : '#f1f5f9',
                                        border: `1px solid ${isCopied ? '#86efac' : '#cbd5e1'}`,
                                        borderRadius: '4px',
                                        padding: '2px 5px',
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                      }}
                                    >
                                      {isCopied ? <Check size={11} color="#15803d" /> : <Copy size={11} color="#64748b" />}
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non-serialized</span>
                                )}
                              </td>
                              <td style={{ padding: '8px 12px', color: '#475569' }}>
                                Box {it.box_number || 1}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                    whiteSpace: 'nowrap',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    lineHeight: 1,
                                    background: isReceivedConfirmed ? '#ecfdf5' : isShipped ? '#e0f2fe' : isPendingPickup ? '#fef3c7' : '#f1f5f9',
                                    color: isReceivedConfirmed ? '#047857' : isShipped ? '#0369a1' : isPendingPickup ? '#b45309' : '#64748b',
                                    border: `1px solid ${isReceivedConfirmed ? '#a7f3d0' : isShipped ? '#bae6fd' : isPendingPickup ? '#fde68a' : '#cbd5e1'}`,
                                    borderRadius: '12px',
                                    padding: '3px 9px'
                                  }}
                                >
                                  {isReceivedConfirmed ? (
                                    <>
                                      <CheckCircle2 size={11} />
                                      <span>Verified</span>
                                    </>
                                  ) : isShipped ? (
                                    <>
                                      <Truck size={11} />
                                      <span>In Transit</span>
                                    </>
                                  ) : isPendingPickup ? (
                                    <>
                                      <Clock size={11} />
                                      <span>Ready</span>
                                    </>
                                  ) : (
                                    <span>Draft</span>
                                  )}
                                </span>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              className="modal-footer"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 20px',
                background: '#f8fafc',
                borderTop: '1px solid #e2e8f0'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    handleRequestPrintOrPDF(
                      viewPackageModalState.shipment,
                      viewPackageModalState.shipment?.items || [],
                      viewPackageModalState.site,
                      'pdf'
                    );
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '12px',
                    fontWeight: 600
                  }}
                  title="Download Corporate PDF Packing List"
                >
                  <Download size={13} />
                  <span>Corporate PDF</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    handleDownloadXLSX(
                      viewPackageModalState.shipment,
                      viewPackageModalState.shipment?.items || [],
                      viewPackageModalState.site
                    );
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: '#f0fdf4',
                    color: '#15803d',
                    borderColor: '#bbf7d0'
                  }}
                  title="Download Excel Backup (.xlsx)"
                >
                  <FileSpreadsheet size={13} color="#16a34a" />
                  <span>Download XLSX</span>
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setViewPackageModalState(null)}
                  style={{ minWidth: '80px' }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleCopySerials(viewPackageModalState.shipment, serialsFormat)}
                  style={{
                    background: '#16a34a',
                    borderColor: '#15803d',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 600,
                    fontSize: '12px'
                  }}
                  title="Copy plain-text serials formatted for GSX / Fixably"
                >
                  {copiedPackageSerialToken === 'ALL' || copiedSerialToken === 'ALL' ? (
                    <>
                      <Check size={13} />
                      <span>Copied All Serials!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      <span>Copy Plain Text Serials</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* --- Site Serials Aggregator Modal (All Shipments per Site) --- */}
      {isSiteSerialsModalOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsSiteSerialsModalOpen(false); }}>
          <div className="modal-content" style={{ maxWidth: '780px', width: '95%' }}>
            <div className="modal-header" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', borderBottom: '1px solid #334155' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: 'rgba(56, 189, 248, 0.15)', padding: '8px', borderRadius: '8px' }}>
                  <Building2 size={22} color="#38bdf8" />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '17px', margin: 0 }}>View All Serial Numbers by Site</h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Aggregate and copy serial numbers across all shipments for a branch
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSiteSerialsModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto', padding: '20px' }}>
              {/* Site Selector */}
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                  Select Destination Site / Branch:
                </label>
                <select
                  className="form-select"
                  value={selectedAggSiteId}
                  onChange={(e) => setSelectedAggSiteId(e.target.value)}
                  style={{ fontSize: '13px', height: '38px', fontWeight: 600 }}
                >
                  <option value="">-- Choose a Site ({availableSitesWithShipments.length} sites with active dispatches) --</option>
                  {availableSitesWithShipments.map(s => (
                    <option key={s.site.id} value={s.site.id}>
                      {s.site.code} - {s.site.name} ({s.isMM ? 'Metro Manila' : 'Province'}) • {s.totalUnits} Units ({s.shipments.length} Manifest{s.shipments.length > 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
              </div>

              {selectedAggSiteId && (() => {
                const targetEntry = availableSitesWithShipments.find(e => e.site.id === selectedAggSiteId);
                if (!targetEntry) return null;

                const aggregatedSerials = targetEntry.shipments.flatMap(s => extractShipmentSerials(s));

                const copySiteSerials = () => {
                  if (aggregatedSerials.length === 0) return;
                  const text = aggregatedSerials.join('\n');
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text);
                  }
                  setCopiedSerialToken(`SITE-${selectedAggSiteId}`);
                  showToast(`Copied ${aggregatedSerials.length} serials for ${targetEntry.site.name} to clipboard!`, 'success');
                  setTimeout(() => setCopiedSerialToken(null), 2500);
                };

                return (
                  <div>
                    {/* Site Summary Box */}
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                          {targetEntry.site.name}
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                          Region: <strong style={{ color: targetEntry.isMM ? '#0369a1' : '#7c3aed' }}>{targetEntry.isMM ? 'Metro Manila' : 'Province'}</strong> • {targetEntry.shipments.length} Dispatches • {aggregatedSerials.length} Total Serials
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={copySiteSerials}
                        style={{
                          background: copiedSerialToken === `SITE-${selectedAggSiteId}` ? '#15803d' : '#16a34a',
                          color: '#fff',
                          borderColor: '#15803d',
                          fontWeight: 700,
                          fontSize: '12px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        {copiedSerialToken === `SITE-${selectedAggSiteId}` ? (
                          <>
                            <Check size={14} />
                            <span>Copied {aggregatedSerials.length} Serials!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={14} />
                            <span>Copy All Site Serials ({aggregatedSerials.length})</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Shipments breakdown */}
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                        Shipments for this site:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {targetEntry.shipments.map(s => {
                          const sSerials = extractShipmentSerials(s);
                          return (
                            <div key={s.id} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span className="font-mono" style={{ fontWeight: 700, fontSize: '12.5px', color: '#0f172a' }}>
                                  {s.invoice_ref || s.shipment_number}
                                </span>
                                {(s.transfer_slip_number || s.transfer_slip) && (
                                  <span style={{ fontSize: '11px', color: '#0284c7', marginLeft: '8px' }}>TS: {s.transfer_slip_number || s.transfer_slip}</span>
                                )}
                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                  Date: {s.shipment_date || s.pickup_date || 'N/A'} • {s.carrier || 'Lite Express'} {s.tracking_number ? `#${s.tracking_number}` : ''} • <strong>{sSerials.length} serials</strong>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                  setIsSiteSerialsModalOpen(false);
                                  handleOpenSerialsModal(s);
                                }}
                                style={{ fontSize: '11px', padding: '4px 10px' }}
                              >
                                View Packing List
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Aggregated Serial Numbers Preview */}
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                        Plain Text Serials (1 per line for GSX / Fixably Bulk):
                      </div>
                      <textarea
                        readOnly
                        rows={6}
                        value={aggregatedSerials.join('\n')}
                        onFocus={(e) => e.target.select()}
                        style={{
                          width: '100%',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '11.5px',
                          background: '#f8fafc',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          padding: '8px 10px',
                          color: '#0f172a'
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsSiteSerialsModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shipment Deletion Confirmation Modal with Audit Reason */}
      {shipmentToDelete && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShipmentToDelete(null); }}>
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ background: '#991b1b', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Trash2 size={18} color="#fca5a5" />
                <h3 style={{ color: '#fff', fontSize: '16px', margin: 0, fontWeight: 700 }}>Delete Pending Shipment</h3>
              </div>
              <button
                onClick={() => setShipmentToDelete(null)}
                style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ fontSize: '13.5px', color: '#1e293b', margin: '0 0 10px 0' }}>
                Are you sure you want to delete pending shipment <strong>{shipmentToDelete.invoice_ref || shipmentToDelete.shipment_number || shipmentToDelete.id}</strong>?
              </p>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 14px 0', lineHeight: 1.5 }}>
                This action will cancel the pending manifest and return all allocated serialized parts back into active DC stock.
              </p>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '5px' }}>
                  Reason for Deletion:
                </label>
                <select
                  className="form-select"
                  value={deletionReason}
                  onChange={(e) => setDeletionReason(e.target.value)}
                  style={{ width: '100%', fontSize: '12.5px', marginBottom: '8px' }}
                >
                  <option value="Manifest Canceled / Not Dispatched">Manifest Canceled / Not Dispatched</option>
                  <option value="Wrong Destination Branch Selected">Wrong Destination Branch Selected</option>
                  <option value="Packing Error / Repack Required">Packing Error / Repack Required</option>
                  <option value="Duplicate Draft Manifest">Duplicate Draft Manifest</option>
                  <option value="Branch Request Revoked">Branch Request Revoked</option>
                  <option value="Courier Handover Aborted">Courier Handover Aborted</option>
                  <option value="OTHER">Other Reason (Specify)</option>
                </select>
                {deletionReason === 'OTHER' && (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter reason for deleting manifest..."
                    value={customDeletionReason}
                    onChange={(e) => setCustomDeletionReason(e.target.value)}
                    style={{ width: '100%', fontSize: '12px' }}
                    autoFocus
                  />
                )}
              </div>
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '11px 14px', borderRadius: '8px', fontSize: '12px', color: '#991b1b', lineHeight: 1.5 }}>
                <strong>Accidental Deletion Protection:</strong> This deletion and reason will be <strong>permanently logged in the system Audit Trail</strong>.
              </div>
            </div>
            <div className="modal-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShipmentToDelete(null)}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={handleConfirmDeleteShipment} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Trash2 size={13} />
                <span>Yes, Delete Shipment</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightweight Status Transition Loading Screen */}
      <StatusChangeLoadingModal {...statusLoadingState} />
    </div>
  );
}
