import { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  Barcode,
  CheckCircle2,
  AlertCircle,
  Zap,
  ArrowRight,
  UploadCloud,
  FileSpreadsheet,
  Download,
  X,
  FileText,
  RefreshCw,
  Sparkles,
  Search,
  Check,
  BookmarkPlus,
  Building2,
  Database,
  Trash2,
  PackageCheck,
  ShieldAlert,
  ShieldCheck,
  Layers,
  Tag,
  ArrowLeftRight,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Copy,
  Boxes
} from 'lucide-react';
import { parseScanInPartsFile, downloadScanInTemplate } from '../utils/excelParser';
import { resolvePartInfo, normalizeInventoryUnits, validateAppleSerialNumber, isProvincialSite } from '../utils/partResolver';
import { barcodeAudio } from '../utils/barcodeAudio';
import SaveIntakeRecordModal from './SaveIntakeRecordModal';
import IntakeRecords from './IntakeRecords';

// Pure category & assignment classification helpers
function isUnitSvnr(u) {
  if (!u) return false;
  const a = String(u.intake_assignment || u.part_assignment || u.assignment || '').trim().toUpperCase();
  return a.includes('SVNR') || a.includes('NON-REPAIR') || a.includes('NON REPAIR') || Boolean(u.isSvnr);
}

function isUnitCrbr(u) {
  if (!u) return false;
  const a = String(u.intake_assignment || u.part_assignment || u.assignment || '').trim().toUpperCase();
  return (a.includes('CRBR') || Boolean(u.isCrbr)) && !isUnitSvnr(u);
}

function isUnitForecasting(u) {
  return !isUnitSvnr(u) && !isUnitCrbr(u);
}

export default function ScanInReceiving({ initialTab = 'station' }) {
  // Top Segmented Tab: 'station' (DC Receive Scan-In Station) | 'records' (DC Stock Records)
  const [activeReceiveTab, setActiveReceiveTab] = useState(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveReceiveTab(initialTab);
    }
  }, [initialTab]);
  const {
    addScanInUnit,
    deleteScanInUnit,
    updateUnitAssignment,
    batchAddScanInUnits,
    purchaseOrders,
    parts,
    categories = [],
    inventoryUnits,
    dcIntakeRecords,
    cloudSyncStatus,
    showToast,
    commitUnitsToStock,
    _setActiveTab,
    activePackDraft,
    shipments,
    currentUser,
    sites = []
  } = useApp();

  const isPmgUser = currentUser?.role === 'parts_management';

  const userSiteObj = useMemo(() => {
    return sites.find(s => s.id === currentUser?.siteId || s.code === currentUser?.siteId) || sites[0] || {};
  }, [sites, currentUser?.siteId]);

  const dcSiteObj = useMemo(() => {
    return sites.find(s => s.is_dc || s.code === 'DC-MDC' || s.code === 'DC') || { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center' };
  }, [sites]);

  const activeReceivingSite = useMemo(() => {
    if (isPmgUser) return userSiteObj;
    return dcSiteObj;
  }, [isPmgUser, userSiteObj, dcSiteObj]);

  
  const [selectedPoId, setSelectedPoId] = useState(purchaseOrders[0]?.id || '');
  const [partNumberInput, setPartNumberInput] = useState('');
  const [serialInput, setSerialInput] = useState('');
  const [scanResult, setScanResult] = useState(null); // { type: 'success' | 'error', message: '' }
  const [isSaveIntakeModalOpen, setIsSaveIntakeModalOpen] = useState(false);
  const [unitToDelete, setUnitToDelete] = useState(null);
  const [showPnDropdown, setShowPnDropdown] = useState(false);

  // Option to hide or show Scanner Simulator & Quick Tools bar
  const [showSimulator, setShowSimulator] = useState(() => {
    try {
      return localStorage.getItem('mdc_show_scanner_simulator') === 'true';
    } catch (e) {
      return false;
    }
  });

  const toggleShowSimulator = () => {
    setShowSimulator(prev => {
      const next = !prev;
      try {
        localStorage.setItem('mdc_show_scanner_simulator', String(next));
      } catch (e) {}
      return next;
    });
  };

  // Part Intake Assignment: 'MDC - Forecasting' | 'DC - CRBR' | 'SVNR - Service Non-Repair'
  const [intakeAssignment, setIntakeAssignment] = useState(() => {
    try {
      return localStorage.getItem('mdc_intake_assignment') || 'DC - CRBR';
    } catch (e) {
      return 'DC - CRBR';
    }
  });

  // Keep intakeAssignmentRef synced to eliminate any closure stale-state during rapid barcode scanner firing
  const intakeAssignmentRef = useRef(intakeAssignment);
  useEffect(() => {
    intakeAssignmentRef.current = intakeAssignment;
    try {
      localStorage.setItem('mdc_intake_assignment', intakeAssignment);
    } catch (e) {}
  }, [intakeAssignment]);

  // Auto-Receive Feature State with localStorage persistence
  const [autoReceive, setAutoReceive] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_auto_receive');
      return saved !== null ? JSON.parse(saved) : true; // Default ON for seamless warehouse workflow
    } catch (e) {
      return true;
    }
  });

  const [keepPartNumber, setKeepPartNumber] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_keep_pn');
      return saved !== null ? JSON.parse(saved) : true; // Keep P/N by default for batch serial scanning
    } catch (e) {
      return true;
    }
  });

  // Sync Auto-Receive settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('mdc_auto_receive', JSON.stringify(autoReceive));
    } catch (e) {}
  }, [autoReceive]);

  useEffect(() => {
    try {
      localStorage.setItem('mdc_keep_pn', JSON.stringify(keepPartNumber));
    } catch (e) {}
  }, [keepPartNumber]);

  // In-memory scans state for current component lifecycle (cleared on unmount/session switch)
  const [sessionScans, setSessionScans] = useState([]);

  // Ensure persistent cross-user session scans cache is thoroughly cleared
  useEffect(() => {
    try {
      localStorage.removeItem('mdc_recent_scans');
    } catch (e) {}
  }, []);

  // View & Filter States for Table (Defaults to All Authorized Stock)
  const [assignmentFilter, setAssignmentFilter] = useState('ALL'); // 'ALL' | 'MDC - Forecasting' | 'DC - CRBR' | 'SVNR'
  const [categoryFilter, setCategoryFilter] = useState('ALL'); // 'ALL' | category code
  const [tableSearch, setTableSearch] = useState('');

  const handleCopySerial = (serial) => {
    if (!serial) return;
    try {
      navigator.clipboard?.writeText(serial);
      showToast(`Copied serial #${serial} to clipboard`, 'info');
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

  // Helper functions for Part Intake Assignment Classification


  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [modalAssignment, setModalAssignment] = useState('DC - CRBR');
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedBatch, setParsedBatch] = useState(null);
  const [modalPoId, setModalPoId] = useState(purchaseOrders[0]?.id || '');
  const [importFilter, setImportFilter] = useState('ALL'); // 'ALL' | 'VALID' | 'DUPLICATE'

  const pnInputRef = useRef(null);
  const serialInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const autoScanTimerRef = useRef(null);
  const dropdownRef = useRef(null);

  // Auto-focus Part Number input on mount
  useEffect(() => {
    pnInputRef.current?.focus();
    return () => {
      if (autoScanTimerRef.current) {
        clearTimeout(autoScanTimerRef.current);
      }
    };
  }, []);

  // Close suggestions dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) && pnInputRef.current && !pnInputRef.current.contains(e.target)) {
        setShowPnDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync modal PO with hero PO when opening
  useEffect(() => {
    if (isImportModalOpen) {
      setModalPoId(selectedPoId);
      setModalAssignment(intakeAssignment);
    }
  }, [isImportModalOpen, selectedPoId, intakeAssignment]);

  // Real-time resolved Apple genuine part from user's current P/N or description input
  const matchedPart = useMemo(() => {
    return resolvePartInfo(partNumberInput, parts);
  }, [partNumberInput, parts]);

  // Autocomplete Suggestions for Part Number field
  const suggestedParts = useMemo(() => {
    if (!partNumberInput.trim()) return [];
    const q = partNumberInput.toLowerCase().trim();
    return (parts || []).filter(p => {
      const pn = (p.part_number || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      const model = (p.iphone_model || '').toLowerCase();
      return pn.includes(q) || desc.includes(q) || model.includes(q);
    }).slice(0, 6);
  }, [partNumberInput, parts]);

  // Fast lookup map for any serial number already present in the system (Session, Inventory, Batch Archives, Shipments)
  // Fast lookup map for serial numbers already present in the active site (Session, Inventory, Batch Archives)
  const systemSerialsMap = useMemo(() => {
    const map = new Map();
    const isDcMode = activeReceivingSite.id === 'site-dc' || activeReceivingSite.code === 'DC-MDC' || activeReceivingSite.code === 'DC';

    // 1. Current Session Scans (highest priority / most immediate)
    (sessionScans || []).forEach((u, idx) => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s && !map.has(s)) {
        map.set(s, {
          serial_number: s,
          part_number: u.part_number,
          description: u.description || 'Genuine Apple Part',
          assignment: u.intake_assignment || u.notes || 'Received Stock',
          received_at: u.received_at || new Date().toISOString(),
          location: `Current Session (Item #${idx + 1})`
        });
      }
    });

    // 2. Active Site Inventory Units (Strict Site Isolation)
    (inventoryUnits || []).forEach(u => {
      const unitIsDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
      const isSiteMatch = isDcMode ? unitIsDc : (u.current_site_id === activeReceivingSite.id || u.site_code === activeReceivingSite.code);
      if (!isSiteMatch) return; // Completely ignore other sites to avoid false cross-site conflicts

      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s && !map.has(s)) {
        map.set(s, {
          serial_number: s,
          part_number: u.part_number,
          description: u.description || 'Genuine Apple Part',
          assignment: u.intake_assignment || u.notes || (isDcMode ? 'DC Warehouse Stock' : `${activeReceivingSite.code} Stock`),
          received_at: u.received_at || u.created_at,
          location: u.status === 'packed' || u.status === 'shipped' ? 'Packed in Outbound Shipment' : (isDcMode ? 'DC Inventory Stock' : `${activeReceivingSite.code} Stock`)
        });
      }
    });

    // 3. Historical Batch Records (Only relevant in DC mode)
    if (isDcMode) {
      (dcIntakeRecords || []).forEach(rec => {
        if (Array.isArray(rec.items)) {
          rec.items.forEach(u => {
            const s = String(u.serial_number || u.serialNumber || '').trim().toUpperCase();
            if (s && !map.has(s)) {
              map.set(s, {
                serial_number: s,
                part_number: u.part_number || u.partNumber,
                description: u.description || 'Genuine Apple Part',
                assignment: u.intake_assignment || rec.record_name || 'Historical Intake Batch',
                received_at: u.received_at || rec.intake_date,
                location: `Intake Batch "${rec.record_name || rec.id}"`
              });
            }
          });
        }
      });

      // 4. DC Shipments / Outbound Packing Lists
      (shipments || []).forEach(sh => {
        if (Array.isArray(sh.items)) {
          sh.items.forEach(u => {
            const s = String(u.serial_number || u.serialNumber || '').trim().toUpperCase();
            if (s && !map.has(s)) {
              map.set(s, {
                serial_number: s,
                part_number: u.part_number || u.partNumber,
                description: u.description || 'Genuine Apple Part',
                assignment: sh.invoice_ref || 'Outbound Packing List',
                received_at: sh.shipment_date || sh.created_at,
                location: `Packing List "${sh.invoice_ref || sh.shipment_number}"`
              });
            }
          });
        }
      });
    }

    return map;
  }, [sessionScans, inventoryUnits, dcIntakeRecords, shipments, activeReceivingSite]);

  // Check if current serial input is already scanned / present in the system
  const duplicateSerialMatch = useMemo(() => {
    const clean = String(serialInput || '').trim().toUpperCase();
    if (!clean || clean.length < 4) return null;
    return systemSerialsMap.get(clean) || null;
  }, [serialInput, systemSerialsMap]);

  // Real-time Serial Number Security Validation
  const serialValidation = useMemo(() => {
    if (!serialInput.trim()) return null;
    const currentPn = matchedPart ? matchedPart.part_number : partNumberInput;
    const base = validateAppleSerialNumber(serialInput, currentPn, parts);
    return {
      ...base,
      isDuplicate: !!duplicateSerialMatch,
      duplicateInfo: duplicateSerialMatch
    };
  }, [serialInput, matchedPart, partNumberInput, parts, duplicateSerialMatch]);

  // Select part from autocomplete dropdown
  const handleSelectSuggestedPart = (p) => {
    setPartNumberInput(p.part_number);
    setShowPnDropdown(false);
    showToast(`Selected ${p.part_number} — ${p.description}`, 'info');
    serialInputRef.current?.focus();
    serialInputRef.current?.select();
  };

  // Helper to parse combined 2D / GS1 DataMatrix / Tab / Slash delimited barcode formats
  const parseBarcodeData = (raw) => {
    if (!raw) return null;
    let str = String(raw).trim();

    // 1. GS1 DataMatrix with Group Separators or control headers
    if (str.startsWith('[)>') || str.includes('06\x1d') || str.includes('\x1d') || str.includes('\x1e')) {
      const pMatch = str.match(/P([0-9]{3}-?[0-9]{4,6})/i);
      const sMatch = str.match(/S([A-Za-z0-9]{8,24})/i);
      if (pMatch && sMatch) {
        let pn = pMatch[1];
        if (/^[0-9]{7,9}$/.test(pn)) pn = `${pn.slice(0, 3)}-${pn.slice(3)}`;
        return { pn, sn: sMatch[1] };
      }
    }

    // 2. Delimited formats: PN,SN or PN/SN or PN\tSN or PN|SN or PN#SN
    const match = str.match(/^([A-Za-z0-9-,s]+?)[,\t/|#;]([A-Za-z0-9-]+)$/);
    if (match) {
      let pn = match[1].trim();
      let sn = match[2].trim();
      if (/^1?P[0-9]{3}-?[0-9]{4,6}$/i.test(pn)) pn = pn.replace(/^1?P/i, '');
      if (/^1?S[A-Za-z0-9]{8,24}$/i.test(sn) && sn.length > 10) sn = sn.replace(/^1?S/i, '');
      if (pn.toUpperCase() === 'PART' || pn.toUpperCase() === 'PART-UNKNOWN') return null;
      return { pn, sn };
    }

    // 3. Space-separated: PN SN
    const spaceMatch = str.match(/^([0-9]{3}-?[0-9]{4,6}|[A-Za-z0-9-,s]+?)\s+([A-Za-z0-9]{8,24})$/);
    if (spaceMatch) {
      let pn = spaceMatch[1].trim();
      let sn = spaceMatch[2].trim();
      if (pn.toUpperCase() === 'PART' || pn.toUpperCase() === 'PART-UNKNOWN') return null;
      return { pn, sn };
    }

    return null;
  };

  const executeScan = (overridePn = null, overrideSn = null) => {
    if (autoScanTimerRef.current) {
      clearTimeout(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }

    const rawPn = (overridePn !== null ? overridePn : partNumberInput).trim();
    const rawSn = (overrideSn !== null ? overrideSn : serialInput).trim();

    if (!rawSn) {
      setScanResult({
        type: 'error',
        message: 'Please scan or enter a Serial Number'
      });
      serialInputRef.current?.focus();
      return false;
    }

    // 1. Immediate Duplicate Detection: Check if serial is already in the system (Session, Inventory, Batches, Shipments)
    const cleanSN = rawSn.toUpperCase();
    const dup = systemSerialsMap.get(cleanSN);
    if (dup) {
      barcodeAudio.playError();
      const dupMsg = `⚠️ [DUPLICATE SERIAL DETECTED] S/N "${cleanSN}" has already been received in the system (${dup.part_number} — ${dup.description}, Tagged: ${dup.assignment}, Location: ${dup.location}). Duplicate scans are prevented.`;
      setScanResult({
        type: 'error',
        message: dupMsg
      });
      showToast(`Duplicate S/N: ${cleanSN} is already scanned in the system!`, 'error');
      serialInputRef.current?.select();
      return false;
    }

    if (!rawPn) {
      setScanResult({
        type: 'error',
        message: `Please scan or select a Part Number for S/N ${rawSn}`
      });
      pnInputRef.current?.focus();
      return false;
    }

    // Resolve canonical Apple Part Number (661-xxxxx)
    const resolved = resolvePartInfo(rawPn, parts);
    const pnToUse = resolved ? resolved.part_number : rawPn;

    // Security Verification: Validate Serial Number before adding
    const validation = validateAppleSerialNumber(rawSn, pnToUse, parts);
    if (!validation.isValid) {
      setScanResult({
        type: 'error',
        message: validation.error
      });
      serialInputRef.current?.select();
      return false;
    }

    const snToUse = validation.cleanSerial;
    const currentAssignment = intakeAssignmentRef.current || intakeAssignment;

    const res = addScanInUnit({
      partNumber: pnToUse,
      serialNumber: snToUse,
      poId: selectedPoId || null,
      intakeAssignment: currentAssignment,
      notes: currentAssignment,
      targetSiteId: activeReceivingSite.id,
      targetSiteCode: activeReceivingSite.code,
      targetSiteName: activeReceivingSite.name
    });

    if (res.success) {
      setScanResult({
        type: 'success',
        message: `[RECEIVED ${currentAssignment}] ${res.unit.part_number} — ${res.unit.description} (SN: ${res.unit.serial_number})`
      });
      setSessionScans(prev => [res.unit, ...prev]);
      setShowPnDropdown(false);
      
      // Clear inputs and refocus based on continuous batch scanning preferences
      setSerialInput('');
      if (!keepPartNumber && overridePn === null) {
        setPartNumberInput('');
        pnInputRef.current?.focus();
      } else {
        serialInputRef.current?.focus();
      }
      return true;
    } else {
      setScanResult({
        type: 'error',
        message: res.error
      });
      serialInputRef.current?.select();
      return false;
    }
  };

  // Handle Part Number change
  const handlePnChange = (e) => {
    const val = e.target.value;
    setPartNumberInput(val);
    setShowPnDropdown(true);

    if (autoScanTimerRef.current) {
      clearTimeout(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }

    const cleanPn = val.trim();
    const combined = parseBarcodeData(cleanPn);
    if (combined) {
      const resolved = resolvePartInfo(combined.pn, parts);
      const actualPn = resolved ? resolved.part_number : combined.pn;
      setPartNumberInput(actualPn);
      setSerialInput(combined.sn);
      setShowPnDropdown(false);
      if (autoReceive) {
        executeScan(actualPn, combined.sn);
      } else {
        serialInputRef.current?.focus();
      }
      return;
    }

    // Auto-advance to Serial field once valid Apple Part Number is entered (e.g. 661-xxxxx)
    if (/^[0-9]{3}-[0-9]{4,6}$/i.test(cleanPn)) {
      autoScanTimerRef.current = setTimeout(() => {
        setShowPnDropdown(false);
        serialInputRef.current?.focus();
        serialInputRef.current?.select();
      }, 150);
    }
  };

  // Handle Serial change with security verification and real-time duplicate alerting
  const handleSerialChange = (e) => {
    const val = e.target.value;
    setSerialInput(val);

    if (autoScanTimerRef.current) {
      clearTimeout(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }

    const cleanSerial = val.trim();
    const cleanPn = (matchedPart ? matchedPart.part_number : partNumberInput).trim();

    // Check for combined 2D barcode format
    const combined = parseBarcodeData(cleanSerial);
    if (combined) {
      const resolved = resolvePartInfo(combined.pn, parts);
      const actualPn = resolved ? resolved.part_number : combined.pn;
      setPartNumberInput(actualPn);
      setSerialInput(combined.sn);
      setShowPnDropdown(false);
      if (autoReceive) {
        executeScan(actualPn, combined.sn);
      } else {
        serialInputRef.current?.focus();
      }
      return;
    }

    // Immediate Duplicate Alert: If entered value matches an existing serial in the system (even if Part Number is empty!), warn user immediately
    const cleanSN = cleanSerial.toUpperCase();
    const dup = systemSerialsMap.get(cleanSN);
    if (dup) {
      barcodeAudio.playError();
      setScanResult({
        type: 'error',
        message: `⚠️ [DUPLICATE SERIAL DETECTED] S/N "${cleanSN}" has already been received in the system (${dup.part_number} — ${dup.description}, Tagged: ${dup.assignment}, Location: ${dup.location}). Duplicate scans are prevented.`
      });
      return; // Do NOT auto-receive duplicate serial numbers!
    }

    // Security Verification: If entered value is an Apple Part Number, block auto-receive and alert user!
    const validation = validateAppleSerialNumber(cleanSerial, cleanPn, parts);
    if (validation.isPartNumber) {
      setScanResult({
        type: 'error',
        message: validation.error
      });
      return; // Do NOT auto-receive when a Part Number is entered into Serial field!
    }

    // When full valid serial number is scanned and part number is present, auto-receive!
    if (autoReceive && cleanPn && validation.isValid) {
      autoScanTimerRef.current = setTimeout(() => {
        executeScan(cleanPn, validation.cleanSerial);
      }, 160);
    }
  };

  // Handle Part Number Enter key
  const handlePnKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const combined = parseBarcodeData(partNumberInput);
      if (combined) {
        const resolved = resolvePartInfo(combined.pn, parts);
        const actualPn = resolved ? resolved.part_number : combined.pn;
        setPartNumberInput(actualPn);
        setSerialInput(combined.sn);
        setShowPnDropdown(false);
        if (autoReceive) {
          executeScan(actualPn, combined.sn);
        } else {
          serialInputRef.current?.focus();
        }
        return;
      }

      // If matched part from text
      const resolved = resolvePartInfo(partNumberInput, parts);
      if (resolved) {
        setPartNumberInput(resolved.part_number);
      }
      setShowPnDropdown(false);
      serialInputRef.current?.focus();
      serialInputRef.current?.select();
    } else if (e.key === 'Escape') {
      setShowPnDropdown(false);
    }
  };

  // Handle Serial Enter key
  const handleSerialKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const combined = parseBarcodeData(serialInput);
      if (combined) {
        const resolved = resolvePartInfo(combined.pn, parts);
        const actualPn = resolved ? resolved.part_number : combined.pn;
        setPartNumberInput(actualPn);
        setSerialInput(combined.sn);
        setShowPnDropdown(false);
        if (autoReceive) {
          executeScan(actualPn, combined.sn);
        } else {
          serialInputRef.current?.focus();
        }
        return;
      }
      executeScan();
    }
  };

  // Quick Mock Scanner Simulator with Genuine 17-Character Apple Serial Numbers
  const testSampleParts = [
    { pn: '661-30373', desc: 'Battery, iPhone 14', prefix: 'F8Y6234C9A', suffix: 'R231LB3' },
    { pn: '661-30394', desc: 'Battery, iPhone 14 Plus', prefix: 'F8Y6235D1B', suffix: 'R235LB4' },
    { pn: '661-30366', desc: 'Display, iPhone 14', prefix: 'GH3891MZP0', suffix: '1289XC' },
    { pn: '661-21991', desc: 'Battery, iPhone 13', prefix: 'DN86234C1U', suffix: 'QMCN3R' },
    { pn: '661-21996', desc: 'Battery, iPhone 13 Pro', prefix: 'DNM6234C2U', suffix: 'Q33817' },
    { pn: '661-22294', desc: 'Battery, iPhone 13 Pro Max', prefix: 'F8Y6235C3Z', suffix: 'A13XCBB' },
    { pn: '661-36918', desc: 'Battery, iPhone 15 Pro Max', prefix: 'FG9HTN0049', suffix: 'R00006TT' },
    { pn: '661-30401', desc: 'Display, iPhone 14 Pro Max', prefix: 'GH36234D9A', suffix: '00MUZ' }
  ];

  const handleSimulateScan = (pn, prefix = 'F8Y6234C9A', suffix = 'R231LB3') => {
    const randomSerial = `${prefix}${Date.now().toString().slice(-4)}${suffix}`;
    const serial = randomSerial;
    setPartNumberInput(pn);
    setSerialInput(serial);
    setShowPnDropdown(false);
    const currentAssignment = intakeAssignmentRef.current || intakeAssignment;

    if (autoReceive) {
      setTimeout(() => {
        const res = addScanInUnit({
          partNumber: pn,
          serialNumber: serial,
          poId: selectedPoId || null,
          intakeAssignment: currentAssignment,
          notes: currentAssignment,
          targetSiteId: activeReceivingSite.id,
          targetSiteCode: activeReceivingSite.code,
          targetSiteName: activeReceivingSite.name
        });
        if (res.success) {
          setScanResult({
            type: 'success',
            message: `[AUTO-RECEIVED ${currentAssignment} @ ${activeReceivingSite.code}] ${res.unit.part_number} — ${res.unit.description} (SN: ${res.unit.serial_number})`
          });
          setSessionScans(prev => [res.unit, ...prev]);
          setSerialInput('');
          if (!keepPartNumber) {
            setPartNumberInput('');
            pnInputRef.current?.focus();
          } else {
            serialInputRef.current?.focus();
          }
        } else {
          setScanResult({ type: 'error', message: res.error });
        }
      }, 120);
    } else {
      showToast(`Scanned ${pn} (S/N: ${serial}). Auto-Receive is OFF — click Receive button to save.`, 'info');
      serialInputRef.current?.focus();
    }
  };

  // --- XLSX / CSV File Import Handling ---
  const handleFileSelect = async (file) => {
    if (!file) return;
    setIsParsing(true);
    try {
      const res = await parseScanInPartsFile(
        file,
        parts,
        inventoryUnits,
        purchaseOrders,
        activeReceivingSite?.id,
        activeReceivingSite?.code
      );
      if (res.success) {
        setParsedBatch(res);
        showToast(`Parsed ${res.summary.total} rows (${res.summary.valid} ready to import)`, 'info');
      } else {
        showToast(res.error || 'Failed to parse parts file', 'error');
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

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await handleFileSelect(files[0]);
    }
  };

  const handleDownloadTemplate = (format) => {
    downloadScanInTemplate(format, parts, purchaseOrders);
    showToast(`Downloaded sample template (${format.toUpperCase()})`, 'info');
  };

  const handleConfirmBatchImport = () => {
    if (!parsedBatch || !parsedBatch.items) return;

    const effectiveDest = isPmgUser ? `${activeReceivingSite.code} Stock` : modalAssignment;

    const validItems = parsedBatch.items
      .filter(it => it.status === 'VALID' || it.status === 'NEW_PART' || it.status === 'EXISTING_INVENTORY')
      .map(it => ({
        ...it,
        intake_assignment: isPmgUser ? `${activeReceivingSite.code} Stock` : (it.notes?.includes('CRBR') ? 'DC - CRBR' : modalAssignment),
        notes: isPmgUser ? `${activeReceivingSite.code} Stock` : (it.notes || modalAssignment),
        current_site_id: activeReceivingSite.id,
        site_code: activeReceivingSite.code,
        site_name: activeReceivingSite.name
      }));

    if (validItems.length === 0) {
      showToast('No valid parts to import.', 'error');
      return;
    }

    const res = batchAddScanInUnits(
      validItems,
      isPmgUser ? null : (modalPoId || selectedPoId || null),
      effectiveDest,
      activeReceivingSite.id,
      activeReceivingSite.code,
      activeReceivingSite.name
    );
    if (res.success) {
      const importedWithFlag = res.units.map(u => ({ ...u, isImported: true }));
      setSessionScans(prev => [...importedWithFlag, ...prev]);

      setScanResult({
        type: 'success',
        message: `[BATCH IMPORT COMPLETE] Successfully received & saved ${res.count} parts into ${activeReceivingSite.name} database!`
      });

      setParsedBatch(null);
      setIsImportModalOpen(false);
      pnInputRef.current?.focus();
    } else {
      showToast(res.error || 'Batch import failed', 'error');
    }
  };

  const filteredPreviewItems = (parsedBatch?.items || []).filter(item => {
    if (importFilter === 'VALID') return item.status === 'VALID' || item.status === 'NEW_PART' || item.status === 'EXISTING_INVENTORY';
    if (importFilter === 'EXISTING') return item.status === 'EXISTING_INVENTORY';
    if (importFilter === 'DUPLICATE') return item.status === 'DUPLICATE';
    return true;
  });

  // Serials that are currently in an active packing list draft or saved/dispatched shipments
  const packedSerialsSet = useMemo(() => {
    const set = new Set();
    if (activePackDraft?.items && Array.isArray(activePackDraft.items)) {
      activePackDraft.items.forEach(it => {
        const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
        if (s) set.add(s);
      });
    }
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

  // Filter for currently available IN-STOCK units in DC or Branch (normalized to ensure Apple P/N and exclude mislabeled/packed units)
  const availableInStockUnits = useMemo(() => {
    const raw = (inventoryUnits || []).filter(u => {
      const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
      if (cleanSerial && packedSerialsSet.has(cleanSerial)) return false;
      if (u.status === 'packed' || u.status === 'shipped' || u.status === 'dispatched' || u.status === 'allocated' || u.status === 'deleted' || u.is_deleted) return false;
      if (u.status !== 'in_stock' && u.status) return false;

      const targetSiteId = activeReceivingSite?.id;
      const targetSiteCode = activeReceivingSite?.code;

      if (isPmgUser || (targetSiteCode && targetSiteCode !== 'DC-MDC' && targetSiteCode !== 'DC')) {
        const uSite = u.current_site_id || u.site_id || u.siteId;
        const uCode = u.site_code || u.siteCode;
        const isUserSite = (
          uSite === targetSiteId ||
          uSite === targetSiteCode ||
          uCode === targetSiteCode ||
          uCode === targetSiteId ||
          u.added_by_user_id === currentUser?.id ||
          u.received_by_id === currentUser?.id
        );
        return isUserSite;
      }

      const isDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
      return (u.status === 'in_stock' || !u.status) && isDc;
    });
    return normalizeInventoryUnits(raw, parts);
  }, [inventoryUnits, packedSerialsSet, parts, isPmgUser, activeReceivingSite, currentUser]);

  // Enrich available stock units with part catalog info and accurate Apple category classification
  const enrichedReceivedUnits = useMemo(() => {
    const partsMap = new Map((parts || []).map(p => [String(p.part_number || '').toUpperCase(), p]));
    const catMap = new Map((categories || []).map(c => [c.id, c]));

    return (availableInStockUnits || []).map(unit => {
      const pn = String(unit.part_number || '').toUpperCase();
      const partInfo = partsMap.get(pn);
      const desc = unit.description || partInfo?.description || 'Apple Genuine Service Part';
      const descLower = desc.toLowerCase();

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
        category_code: categoryCode
      };
    });
  }, [availableInStockUnits, parts, categories]);

  // Metric counts for assignment
  const assignmentCounts = useMemo(() => {
    let forecasting = 0;
    let crbr = 0;
    let svnr = 0;

    (availableInStockUnits || []).forEach(u => {
      if (isUnitSvnr(u)) svnr++;
      else if (isUnitCrbr(u)) crbr++;
      else forecasting++;
    });

    return {
      all: (availableInStockUnits || []).length,
      forecasting,
      crbr,
      svnr
    };
  }, [availableInStockUnits]);

  // Table items calculation with Assignment, Category & Search Filters
  const displayedUnits = useMemo(() => {
    return (enrichedReceivedUnits || []).filter(u => {
      // 1. Assignment Filter
      if (assignmentFilter === 'MDC - Forecasting' && !isUnitForecasting(u)) return false;
      if (assignmentFilter === 'DC - CRBR' && !isUnitCrbr(u)) return false;
      if ((assignmentFilter === 'SVNR - Service Non-Repair' || assignmentFilter === 'SVNR') && !isUnitSvnr(u)) return false;

      // 2. Sub-Category Filter
      if (categoryFilter !== 'ALL') {
        const targetCode = categoryFilter.toUpperCase();
        const uCode = (u.category_code || '').toUpperCase();
        const uName = (u.category_name || '').toUpperCase();
        if (uCode !== targetCode && !uName.includes(targetCode)) return false;
      }

      // 3. Search Filter
      if (tableSearch.trim()) {
        const q = tableSearch.toLowerCase().trim();
        const matchesPn = (u.part_number || '').toLowerCase().includes(q);
        const matchesSn = (u.serial_number || '').toLowerCase().includes(q);
        const matchesDesc = (u.description || '').toLowerCase().includes(q);
        const matchesModel = (u.iphone_model || '').toLowerCase().includes(q);
        const matchesCat = (u.category_name || '').toLowerCase().includes(q);
        const matchesAssign = (u.intake_assignment || '').toLowerCase().includes(q);
        const matchesNotes = (u.notes || '').toLowerCase().includes(q);
        if (!matchesPn && !matchesSn && !matchesDesc && !matchesModel && !matchesCat && !matchesAssign && !matchesNotes) return false;
      }

      return true;
    });
  }, [enrichedReceivedUnits, assignmentFilter, categoryFilter, tableSearch]);

  const handleConfirmDeletePart = async () => {
    if (!unitToDelete) return;
    const serial = unitToDelete.serial_number;
    await deleteScanInUnit(unitToDelete);
    setSessionScans(prev => prev.filter(u => String(u.serial_number).toUpperCase() !== String(serial).toUpperCase()));
    setUnitToDelete(null);
  };

  const [isAddingToStock, setIsAddingToStock] = useState(false);

  const handleAddAllToStock = async () => {
    setIsAddingToStock(true);
    try {
      let targetUnits = [];
      if (availableInStockUnits && availableInStockUnits.length > 0) {
        targetUnits = availableInStockUnits;
      } else if (inventoryUnits && inventoryUnits.length > 0) {
        targetUnits = inventoryUnits;
      } else if (dcIntakeRecords && dcIntakeRecords.length > 0) {
        targetUnits = dcIntakeRecords.flatMap(r => Array.isArray(r.items) ? r.items : []);
      }

      if (targetUnits.length === 0) {
        showToast('No scanned or imported parts to add to stock. Please scan barcodes or import a spreadsheet first.', 'info');
        return;
      }

      const res = await commitUnitsToStock(targetUnits);

      if (res.success) {
        setScanResult({
          type: 'success',
          message: `[STOCK FINALIZED] Successfully added ${targetUnits.length} units to ${isPmgUser ? activeReceivingSite?.name : 'DC'} Stock! All parts are now in-stock and confirmed in database.`
        });
        setSessionScans([]);
        try { localStorage.removeItem('mdc_recent_scans'); } catch (e) {}
      }
    } catch (err) {
      console.error('Add to stock error:', err);
      showToast('Error finalizing parts to stock', 'error');
    } finally {
      setIsAddingToStock(false);
    }
  };


  return (
    <div className="scanner-container">
      {/* Top Segmented Navigation Tabs: Station vs Records */}
      <div className="scanin-top-tabs-bar">
        <div className="scanin-top-tabs-group">
          <button
            type="button"
            className={`scanin-tab-btn ${activeReceiveTab === 'station' ? 'active' : ''}`}
            onClick={() => setActiveReceiveTab('station')}
          >
            <Barcode size={16} />
            <span>{isPmgUser ? 'Branch Receive Scan-In Station' : 'DC Receive Scan-In Station'}</span>
            <span className="scanin-tab-badge">
              {availableInStockUnits.length} in stock
            </span>
          </button>

          <button
            type="button"
            className={`scanin-tab-btn ${activeReceiveTab === 'records' ? 'active' : ''}`}
            onClick={() => setActiveReceiveTab('records')}
          >
            <BookmarkPlus size={16} />
            <span>{isPmgUser ? 'Branch Stock Records' : 'DC Stock Records'}</span>
            <span className="scanin-tab-badge">
              {dcIntakeRecords?.length || 0} batches
            </span>
          </button>
        </div>

        <div className="scanin-top-tabs-actions">
          <div className="telemetry-badge" title="Hardware Scanner Connection Status" style={{ height: '32px' }}>
            <div className="pulse-dot" />
            <span style={{ color: '#34d399', fontWeight: 600, fontSize: '11.5px' }}>Scanner: Ready (HID)</span>
          </div>
        </div>
      </div>

      {activeReceiveTab === 'records' ? (
        <IntakeRecords 
          embeddedMode={true} 
          onNavigateToScanIn={() => setActiveReceiveTab('station')} 
        />
      ) : (
        <>
          {/* Scanner Workstation Hero Card */}
          <div className="scanner-hero">
        {/* Header Row: Title & System Telemetry Status */}
        <div className="scanner-hero-header" style={{ marginBottom: '18px', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '21px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <Barcode size={24} color="#38bdf8" />
              <span>{isPmgUser ? 'Branch Receive Scan-In Station' : 'DC Receive Scan-In Station'}</span>
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '3px', margin: '3px 0 0 0' }}>
              Physical Keyboard HID Barcode Scanner Active • Receiving Site: <strong style={{ color: '#38bdf8' }}>{activeReceivingSite.name} ({activeReceivingSite.code})</strong>
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div className="telemetry-badge" title="Cloud Database Realtime Active">
              <span className={`status-indicator ${cloudSyncStatus.isSaving ? 'syncing' : 'online'}`} />
              <span>{cloudSyncStatus.isSaving ? 'Saving to Cloud...' : 'Cloud Auto-Save: Active'}</span>
            </div>

            <div className="telemetry-badge" title="Current In-Stock Inventory in DB">
              <Database size={13} color="#38bdf8" />
              <span>
                <strong style={{ color: '#38bdf8' }}>{availableInStockUnits.length}</strong> units in {isPmgUser ? (activeReceivingSite?.code || 'Branch') : 'DC'}
              </span>
            </div>

            <div className="telemetry-badge" title="Hardware Scanner Connection Status">
              <div className="pulse-dot" />
              <span style={{ color: '#34d399', fontWeight: 600 }}>Scanner: Ready (HID)</span>
            </div>
          </div>
        </div>

        {/* Workstation Controls & Actions Toolbar */}
        <div className="workstation-controls-bar" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {/* Column 1: PO Selector (DC Only) */}
          {!isPmgUser && (
            <div>
              <label className="workstation-col-label">
                <Building2 size={13} color="#38bdf8" />
                <span>1. Linked Purchase Order</span>
              </label>
              <select
                className="form-select"
                style={{ width: '100%', background: '#0f172a', color: '#fff', borderColor: '#334155', height: '42px', fontSize: '13px' }}
                value={selectedPoId}
                onChange={(e) => setSelectedPoId(e.target.value)}
              >
                <option value="">-- Direct Intake (No PO) --</option>
                {purchaseOrders.map(po => (
                  <option key={po.id} value={po.id}>
                    {po.po_number} ({po.status})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Column 2: Part Assignment Classification - Forecasting, CRBR, SVNR */}
          {!isPmgUser && (
            <div>
              <label className="workstation-col-label">
                <Layers size={13} color="#38bdf8" />
                <span>2. Part Assignment Category</span>
              </label>
              <div style={{
                display: 'flex',
                gap: '6px',
                background: '#0f172a',
                padding: '4px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid #334155',
                height: '42px',
                alignItems: 'center'
              }}>
                <button
                  type="button"
                  onClick={() => {
                    const next = 'MDC - Forecasting';
                    setIntakeAssignment(next);
                    intakeAssignmentRef.current = next;
                    try { localStorage.setItem('mdc_intake_assignment', next); } catch (e) {}
                    showToast('Part assignment set to "MDC - Forecasting"', 'info');
                  }}
                  style={{
                    flex: 1,
                    height: '32px',
                    background: intakeAssignment === 'MDC - Forecasting' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                    color: intakeAssignment === 'MDC - Forecasting' ? '#fff' : '#94a3b8',
                    border: intakeAssignment === 'MDC - Forecasting' ? '1px solid #38bdf8' : 'none',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: intakeAssignment === 'MDC - Forecasting' ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap'
                  }}
                  title="Designated for Monthly Forecasting & Branch Stock Allocation"
                >
                  <span>MDC - Forecasting</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = 'DC - CRBR';
                    setIntakeAssignment(next);
                    intakeAssignmentRef.current = next;
                    try { localStorage.setItem('mdc_intake_assignment', next); } catch (e) {}
                    showToast('Part assignment set to "DC - CRBR"', 'info');
                  }}
                  style={{
                    flex: 1,
                    height: '32px',
                    background: intakeAssignment === 'DC - CRBR' ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : 'transparent',
                    color: intakeAssignment === 'DC - CRBR' ? '#fff' : '#94a3b8',
                    border: intakeAssignment === 'DC - CRBR' ? '1px solid #f59e0b' : 'none',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: intakeAssignment === 'DC - CRBR' ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap'
                  }}
                  title="Designated for Customer Return / Repair Buffer Returns (CRBR)"
                >
                  <span>DC - CRBR</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = 'SVNR - Service Non-Repair';
                    setIntakeAssignment(next);
                    intakeAssignmentRef.current = next;
                    try { localStorage.setItem('mdc_intake_assignment', next); } catch (e) {}
                    showToast('Part assignment set to "SVNR - Service Non-Repair"', 'info');
                  }}
                  style={{
                    flex: 1,
                    height: '32px',
                    background: intakeAssignment === 'SVNR - Service Non-Repair' ? 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)' : 'transparent',
                    color: intakeAssignment === 'SVNR - Service Non-Repair' ? '#fff' : '#c084fc',
                    border: intakeAssignment === 'SVNR - Service Non-Repair' ? '1px solid #a855f7' : 'none',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: intakeAssignment === 'SVNR - Service Non-Repair' ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap'
                  }}
                  title="Designated for Service Non-Repair (SVNR) — Provincial Sites"
                >
                  <span>SVNR</span>
                </button>
              </div>
              <span style={{ fontSize: '11px', color: intakeAssignment === 'SVNR - Service Non-Repair' ? '#c084fc' : intakeAssignment === 'DC - CRBR' ? '#fbbf24' : '#38bdf8', marginTop: '4px', display: 'block' }}>
                {intakeAssignment === 'SVNR - Service Non-Repair'
                  ? '• Tagged: SVNR - Service Non-Repair'
                  : intakeAssignment === 'DC - CRBR'
                  ? '• Tagged: DC - CRBR (Customer Return & Buffer)'
                  : '• Tagged: MDC - Forecasting (Stock Allocation)'}
              </span>
            </div>
          )}

          {/* Column: Auto-Receive Switch & Settings */}
          <div>
            <label className="workstation-col-label">
              <Zap size={13} color={autoReceive ? "#10b981" : "#94a3b8"} />
              <span>{isPmgUser ? '1. Barcode Auto-Receive' : '3. Scanner Intake Mode'}</span>
            </label>
            <div
              className={`auto-receive-card-switch ${autoReceive ? 'active' : ''}`}
              onClick={() => {
                const next = !autoReceive;
                setAutoReceive(next);
                showToast(`Auto-Receive Parts ${next ? 'ENABLED (Instant intake on barcode scan)' : 'DISABLED (Manual confirmation required)'}`, next ? 'success' : 'info');
              }}
              title={autoReceive ? "Click to disable Auto-Receive" : "Click to enable Auto-Receive"}
            >
              <div>
                <strong style={{ fontSize: '12.5px', color: autoReceive ? '#34d399' : '#cbd5e1', display: 'block' }}>
                  {autoReceive ? '⚡ Auto-Receive: ON' : 'Auto-Receive: OFF'}
                </strong>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {autoReceive ? 'Saves instantly to DB on scan' : 'Requires manual click'}
                </span>
              </div>
              <div className={`toggle-switch-pill ${autoReceive ? 'checked' : ''}`}>
                <div className="toggle-knob" />
              </div>
            </div>

            {autoReceive && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#cbd5e1', cursor: 'pointer', marginTop: '6px' }}>
                <input
                  type="checkbox"
                  checked={keepPartNumber}
                  onChange={(e) => setKeepPartNumber(e.target.checked)}
                  style={{ accentColor: '#10b981', cursor: 'pointer' }}
                />
                <span>Keep P/N for batch scanning</span>
              </label>
            )}
          </div>

          {/* Column: Workstation Action Buttons */}
          <div>
            <label className="workstation-col-label">
              <Sparkles size={13} color="#38bdf8" />
              <span>{isPmgUser ? '2. Bulk Import & Actions' : '4. Batch Actions'}</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {!isPmgUser && (
                <button
                  type="button"
                  className="action-btn-emerald"
                  onClick={handleAddAllToStock}
                  disabled={isAddingToStock || availableInStockUnits.length === 0}
                  style={{
                    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '13px',
                    boxShadow: '0 3px 10px rgba(16, 185, 129, 0.35)',
                    border: '1px solid #34d399',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer'
                  }}
                  title="Finalize all parts, commit to DC Stock, and make visible for packing list creation across all accounts"
                >
                  {isAddingToStock ? <RefreshCw size={15} className="spin" /> : <PackageCheck size={16} />}
                  <span>Add to Stock ({availableInStockUnits.length})</span>
                </button>
              )}

              <button
                type="button"
                className="action-btn-slate"
                onClick={() => setIsImportModalOpen(true)}
                title="Bulk upload parts spreadsheet (.xlsx / .csv)"
                style={{
                  background: isPmgUser ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : undefined,
                  color: '#fff',
                  border: isPmgUser ? '1px solid #38bdf8' : undefined,
                  fontWeight: 700
                }}
              >
                <FileSpreadsheet size={15} />
                <span>Import Spreadsheet (XLSX/CSV)</span>
              </button>

              {!isPmgUser && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsSaveIntakeModalOpen(true)}
                  title="Save current scanned parts into a named Dispatched Record (MDC202600015)"
                  style={{ justifyContent: 'center', height: '32px', fontSize: '12px', opacity: 0.9 }}
                >
                  <BookmarkPlus size={14} />
                  <span>Save Dispatched Batch</span>
                </button>
              )}

              {isPmgUser && (
                <div style={{
                  padding: '6px 10px',
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11.5px',
                  color: '#34d399',
                  fontWeight: 600
                }}>
                  <CheckCircle2 size={13} color="#34d399" />
                  <span>Permanent Database Sync Active</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dual Input Fields for Barcode Scans with Autocomplete & Security Validation */}
        <div className="scan-input-grid" style={{ position: 'relative' }}>
          {/* Part Number Input Column */}
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label className="scanner-field-label">1. Part Number (P/N)</label>
              {matchedPart && (
                <span className="badge badge-success" style={{ fontSize: '11px', padding: '2px 6px' }}>
                  ✓ {matchedPart.part_number}
                </span>
              )}
            </div>

            <div style={{ position: 'relative' }}>
              <input
                ref={pnInputRef}
                type="text"
                className="scanner-input"
                placeholder="Scan barcode or type e.g. 661-30373 or Battery, iPhone 14"
                value={partNumberInput}
                onChange={handlePnChange}
                onKeyDown={handlePnKeyDown}
                onFocus={() => setShowPnDropdown(true)}
                style={{
                  borderColor: matchedPart ? '#10b981' : undefined,
                  boxShadow: matchedPart ? '0 0 0 1px rgba(16, 185, 129, 0.3)' : undefined
                }}
              />

              {/* Clear button */}
              {partNumberInput && (
                <button
                  type="button"
                  onClick={() => {
                    setPartNumberInput('');
                    setShowPnDropdown(false);
                    pnInputRef.current?.focus();
                  }}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer'
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Live Apple Genuine Part Recognition Banner */}
            {matchedPart && (
              <div style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                borderRadius: '6px',
                padding: '6px 10px',
                marginTop: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: '#34d399'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Check size={13} color="#34d399" />
                  <span><strong>{matchedPart.part_number}</strong> — {matchedPart.description}</span>
                </div>
                <span style={{ color: '#cbd5e1', fontSize: '11px' }}>
                  {matchedPart.iphone_model || 'Genuine Service Part'}
                </span>
              </div>
            )}

            {/* Interactive Suggestions Dropdown */}
            {showPnDropdown && suggestedParts.length > 0 && !matchedPart && (
              <div
                ref={dropdownRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  marginTop: '4px',
                  maxHeight: '260px',
                  overflowY: 'auto'
                }}
              >
                <div style={{ padding: '6px 10px', fontSize: '11px', color: '#94a3b8', borderBottom: '1px solid #334155', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Select Matching Apple Part:
                </div>
                {suggestedParts.map((p) => (
                  <div
                    key={p.id || p.part_number}
                    onClick={() => handleSelectSuggestedPart(p)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #334155',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#334155'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div>
                      <span className="font-mono" style={{ color: '#38bdf8', fontWeight: 700, fontSize: '12.5px', marginRight: '8px' }}>
                        {p.part_number}
                      </span>
                      <span style={{ color: '#fff', fontSize: '12px' }}>
                        {p.description}
                      </span>
                    </div>
                    <span className="badge" style={{ background: '#0f172a', color: '#94a3b8', fontSize: '11px' }}>
                      {p.iphone_model || 'Part'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Serial Number Input Column with Security Validation & Duplicate Alert */}
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label className="scanner-field-label">2. Serial Number (S/N)</label>
              {duplicateSerialMatch ? (
                <span className="badge badge-danger" style={{ fontSize: '11px', padding: '2px 8px', background: '#dc2626', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                  <AlertCircle size={11} /> DUPLICATE S/N (ALREADY RECEIVED)
                </span>
              ) : serialValidation && serialValidation.isPartNumber ? (
                <span className="badge badge-danger" style={{ fontSize: '11px', padding: '2px 6px', background: '#dc2626' }}>
                  ⚠️ Part Number Detected
                </span>
              ) : serialValidation && serialValidation.isValid ? (
                <span className="badge badge-success" style={{ fontSize: '11px', padding: '2px 6px' }}>
                  ✓ Valid S/N
                </span>
              ) : null}
            </div>

            <div style={{ position: 'relative' }}>
              <input
                ref={serialInputRef}
                type="text"
                className="scanner-input"
                placeholder="Scan barcode e.g. F8Y6234C9AR231LB3"
                value={serialInput}
                onChange={handleSerialChange}
                onKeyDown={handleSerialKeyDown}
                style={{
                  borderColor: duplicateSerialMatch ? '#ef4444' : serialValidation?.isPartNumber ? '#ef4444' : serialValidation?.isValid ? '#10b981' : undefined,
                  boxShadow: duplicateSerialMatch ? '0 0 0 1.5px rgba(239, 68, 68, 0.5)' : serialValidation?.isPartNumber ? '0 0 0 1px rgba(239, 68, 68, 0.4)' : undefined,
                  background: duplicateSerialMatch ? '#241419' : undefined
                }}
              />

              {/* Clear button */}
              {serialInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSerialInput('');
                    serialInputRef.current?.focus();
                  }}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer'
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Serial Number Duplicate Alert Banner */}
            {duplicateSerialMatch && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                borderRadius: '6px',
                padding: '8px 12px',
                marginTop: '6px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                fontSize: '12px',
                color: '#fca5a5'
              }}>
                <AlertTriangle size={16} color="#ef4444" style={{ marginTop: '1px', flexShrink: 0 }} />
                <div>
                  <div style={{ color: '#f87171', fontWeight: 700 }}>
                    Duplicate Serial Detected: "{serialInput.trim()}" has already been received in the system!
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#cbd5e1', marginTop: '2px' }}>
                    <strong>Recorded Unit:</strong> {duplicateSerialMatch.part_number} — {duplicateSerialMatch.description} ({duplicateSerialMatch.assignment}) • <strong>Location:</strong> {duplicateSerialMatch.location}
                  </div>
                </div>
              </div>
            )}

            {/* Serial Number Security Warning Banner */}
            {!duplicateSerialMatch && serialValidation?.isPartNumber && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: '6px',
                padding: '6px 10px',
                marginTop: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: '#f87171'
              }}>
                <ShieldAlert size={14} color="#ef4444" />
                <span><strong>Security Guard:</strong> "{serialInput}" is a Part Number! Please scan the component's unique Serial Number (S/N).</span>
              </div>
            )}

            {/* Serial Number Verified Banner */}
            {!duplicateSerialMatch && serialValidation?.isValid && (
              <div style={{
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                borderRadius: '6px',
                padding: '6px 10px',
                marginTop: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: '#34d399'
              }}>
                <ShieldCheck size={14} color="#34d399" />
                <span>Verified Component Serial: <strong>{serialValidation.cleanSerial}</strong></span>
              </div>
            )}
          </div>

          {/* Receive Submit Button */}
          <div>
            <button
              className={`btn ${autoReceive ? 'btn-primary' : 'btn-secondary'} btn-lg`}
              onClick={() => executeScan()}
              style={{
                height: '54px',
                minWidth: '130px',
                background: autoReceive ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : '#1e293b',
                borderColor: autoReceive ? '#38bdf8' : '#475569',
                color: '#fff',
                fontWeight: 600
              }}
              title={autoReceive ? "Auto-Receive is Active: Press Enter or scan barcode to receive automatically" : "Click to manually confirm and receive part"}
            >
              <span>{autoReceive ? 'Receive ↵' : 'Receive'}</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        {/* Real-Time Scan Feedback Box */}
        {scanResult && (
          <div
            className={`scanner-feedback-box ${
              scanResult.type === 'success' ? 'scanner-feedback-success' : 'scanner-feedback-error'
            }`}
          >
            {scanResult.type === 'success' ? (
              <CheckCircle2 size={20} color="#10b981" />
            ) : (
              <AlertCircle size={20} color="#ef4444" />
            )}
            <span style={{ fontSize: '14px', fontWeight: 600 }}>{scanResult.message}</span>
          </div>
        )}
      </div>

      {/* Simulator Tools for Rapid Paired Testing (Collapsible / Hideable) */}
      <div
        className="card"
        style={{
          marginBottom: '20px',
          background: showSimulator ? '#f8fafc' : '#ffffff',
          border: '1px solid var(--border-light)',
          padding: showSimulator ? '16px 20px' : '10px 16px',
          transition: 'all 0.2s ease'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            userSelect: 'none'
          }}
          onClick={toggleShowSimulator}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              background: showSimulator ? '#e0f2fe' : '#f1f5f9',
              color: showSimulator ? 'var(--primary)' : '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Zap size={14} />
            </div>
            <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>Scanner Simulator & Quick Tools</strong>
            <span
              className="badge"
              style={{
                fontSize: '11px',
                background: showSimulator ? '#e0f2fe' : '#f1f5f9',
                color: showSimulator ? '#0369a1' : '#64748b',
                padding: '2px 8px'
              }}
            >
              {showSimulator ? 'Visible' : 'Hidden'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {showSimulator && (
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                Click any sample part to simulate hardware scan into <strong style={{ color: intakeAssignment === 'DC - CRBR' ? '#d97706' : '#0284c7' }}>{intakeAssignment}</strong>
              </span>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px'
              }}
              onClick={(e) => {
                e.stopPropagation();
                toggleShowSimulator();
              }}
              title={showSimulator ? "Hide Simulator Bar" : "Show Simulator Bar"}
            >
              {showSimulator ? (
                <>
                  <EyeOff size={13} />
                  <span>Hide Simulator</span>
                  <ChevronDown size={14} />
                </>
              ) : (
                <>
                  <Eye size={13} />
                  <span>Show Simulator Tools</span>
                  <ChevronRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>

        {showSimulator && (
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {testSampleParts.map((sample, idx) => (
                <button
                  key={idx}
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSimulateScan(sample.pn, sample.prefix, sample.suffix)}
                  style={{
                    background: '#fff',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px'
                  }}
                  title={`Simulate scanning ${sample.pn} (${sample.desc}) into ${intakeAssignment}`}
                >
                  <Barcode size={13} color="var(--primary)" />
                  <span><strong>{sample.pn}</strong> — {sample.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Scanned DC Inventory Units Table */}
      <div className="card" style={{ marginBottom: '24px', background: '#ffffff', border: '1px solid #e2e8f0', padding: '18px 20px' }}>
        {/* Table Header Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: '#e0f2fe', color: '#0284c7', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Boxes size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '15.5px', color: '#0f172a', fontWeight: 700 }}>
                  {isPmgUser ? `${activeReceivingSite?.code || 'Branch'} Received Stock & Inventory History` : 'Received DC Stock & Intake History'}
                </h3>
                <span className="badge badge-success" style={{ fontSize: '11.5px', padding: '2px 8px' }}>
                  {availableInStockUnits.length} in-stock
                </span>
                <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11px', padding: '2px 8px' }}>
                  {assignmentCounts.all} Total Units
                </span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                {isPmgUser
                  ? 'All serialized units received and on-hand at your authorized retail branch'
                  : 'Manage serialized inventory in DC and click any assignment badge to switch tags'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '260px' }}>
              <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder={isPmgUser ? "Search P/N, Serial, Model..." : "Search P/N, Serial, Tag, Model..."}
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '26px', paddingRight: tableSearch ? '24px' : '8px', height: '32px', fontSize: '12px', width: '100%' }}
              />
              {tableSearch && (
                <button
                  type="button"
                  onClick={() => setTableSearch('')}
                  style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 1. Primary Part Assignment Tabs (Forecasting, CRBR, SVNR) */}
        {!isPmgUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginRight: '4px' }}>
              Inventory Tag:
            </span>

            {/* All Destinations / All Parts Tab */}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAssignmentFilter('ALL')}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: assignmentFilter === 'ALL' ? '1px solid #0f172a' : '1px solid #cbd5e1',
                background: assignmentFilter === 'ALL' ? '#0f172a' : '#ffffff',
                color: assignmentFilter === 'ALL' ? '#ffffff' : '#334155',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: assignmentFilter === 'ALL' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              <span>All Destinations</span>
              <span
                style={{
                  background: assignmentFilter === 'ALL' ? 'rgba(255,255,255,0.22)' : '#e2e8f0',
                  color: assignmentFilter === 'ALL' ? '#ffffff' : '#334155',
                  padding: '1px 7px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 800
                }}
              >
                {assignmentCounts.all}
              </span>
            </button>

            {/* MDC – Forecasting Tab */}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAssignmentFilter('MDC - Forecasting')}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: assignmentFilter === 'MDC - Forecasting' ? '1px solid #0284c7' : '1px solid #cbd5e1',
                background: assignmentFilter === 'MDC - Forecasting' ? '#0284c7' : '#ffffff',
                color: assignmentFilter === 'MDC - Forecasting' ? '#ffffff' : '#0369a1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: assignmentFilter === 'MDC - Forecasting' ? '0 1px 3px rgba(2,132,199,0.2)' : 'none'
              }}
            >
              <span>MDC – Forecasting</span>
              <span
                style={{
                  background: assignmentFilter === 'MDC - Forecasting' ? 'rgba(255,255,255,0.25)' : '#e0f2fe',
                  color: assignmentFilter === 'MDC - Forecasting' ? '#ffffff' : '#0369a1',
                  padding: '1px 7px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 800
                }}
              >
                {assignmentCounts.forecasting}
              </span>
            </button>

            {/* DC – CRBR Tab */}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAssignmentFilter('DC - CRBR')}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: assignmentFilter === 'DC - CRBR' ? '1px solid #d97706' : '1px solid #cbd5e1',
                background: assignmentFilter === 'DC - CRBR' ? '#d97706' : '#ffffff',
                color: assignmentFilter === 'DC - CRBR' ? '#ffffff' : '#b45309',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: assignmentFilter === 'DC - CRBR' ? '0 1px 3px rgba(217,119,6,0.2)' : 'none'
              }}
            >
              <span>DC – CRBR</span>
              <span
                style={{
                  background: assignmentFilter === 'DC - CRBR' ? 'rgba(255,255,255,0.25)' : '#fef3c7',
                  color: assignmentFilter === 'DC - CRBR' ? '#ffffff' : '#b45309',
                  padding: '1px 7px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 800
                }}
              >
                {assignmentCounts.crbr}
              </span>
            </button>

            {/* SVNR Tab */}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAssignmentFilter('SVNR - Service Non-Repair')}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: (assignmentFilter === 'SVNR - Service Non-Repair' || assignmentFilter === 'SVNR') ? '1px solid #9333ea' : '1px solid #cbd5e1',
                background: (assignmentFilter === 'SVNR - Service Non-Repair' || assignmentFilter === 'SVNR') ? '#9333ea' : '#ffffff',
                color: (assignmentFilter === 'SVNR - Service Non-Repair' || assignmentFilter === 'SVNR') ? '#ffffff' : '#7e22ce',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: (assignmentFilter === 'SVNR - Service Non-Repair' || assignmentFilter === 'SVNR') ? '0 1px 3px rgba(147,51,234,0.2)' : 'none'
              }}
            >
              <span>SVNR</span>
              <span
                style={{
                  background: (assignmentFilter === 'SVNR - Service Non-Repair' || assignmentFilter === 'SVNR') ? 'rgba(255,255,255,0.25)' : '#f3e8ff',
                  color: (assignmentFilter === 'SVNR - Service Non-Repair' || assignmentFilter === 'SVNR') ? '#ffffff' : '#7e22ce',
                  padding: '1px 7px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 800
                }}
              >
                {assignmentCounts.svnr}
              </span>
            </button>
          </div>
        )}

        {/* 2. Sub-Category Filter Pills */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px', paddingBottom: '8px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginRight: '2px' }}>Filter Part Type:</span>
          <button
            type="button"
            className={`btn btn-sm ${categoryFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setCategoryFilter('ALL')}
            style={{ padding: '2px 8px', fontSize: '11px', borderRadius: 'var(--radius-full)' }}
          >
            All Types
          </button>
          {['DISPLAY', 'BATTERY', 'CAMERA', 'BACK_GLASS', 'MID_REAR'].map(code => {
            const countForCat = enrichedReceivedUnits.filter(u => {
              if (assignmentFilter === 'MDC - Forecasting' && !isUnitForecasting(u)) return false;
              if (assignmentFilter === 'DC - CRBR' && !isUnitCrbr(u)) return false;
              if ((assignmentFilter === 'SVNR - Service Non-Repair' || assignmentFilter === 'SVNR') && !isUnitSvnr(u)) return false;
              return u.category_code === code || u.category_name?.toUpperCase().includes(code);
            }).length;
            if (countForCat === 0 && categoryFilter !== code) return null;
            const catLabel = code === 'DISPLAY' ? 'Display' : code === 'BATTERY' ? 'Battery' : code === 'CAMERA' ? 'Camera' : code === 'BACK_GLASS' ? 'Back Glass' : 'Logic / Mid';
            return (
              <button
                key={code}
                type="button"
                className={`btn btn-sm ${categoryFilter === code ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setCategoryFilter(code)}
                style={{ padding: '2px 8px', fontSize: '11px', borderRadius: 'var(--radius-full)' }}
              >
                {catLabel} ({countForCat})
              </button>
            );
          })}
        </div>

        {/* 3. Table / Empty State */}
        {availableInStockUnits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            <CheckCircle2 size={28} color="#10b981" style={{ margin: '0 auto 6px' }} />
            <h4 style={{ margin: '0 0 2px 0', fontSize: '13.5px', color: '#0f172a', fontWeight: 600 }}>All Scanned Units Processed</h4>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
              No parts currently in {isPmgUser ? (activeReceivingSite?.code || 'Branch') : 'DC'} inventory. Scan barcode or upload XLSX/CSV to receive parts.
            </p>
          </div>
        ) : displayedUnits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            <Search size={22} color="#94a3b8" style={{ margin: '0 auto 4px' }} />
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              {assignmentFilter !== 'ALL'
                ? `No available units found under "${assignmentFilter === 'MDC - Forecasting' ? 'MDC – Forecasting' : assignmentFilter === 'DC - CRBR' ? 'DC – CRBR' : 'SVNR'}".`
                : `No available parts match "${tableSearch}".`}
            </p>
            {(assignmentFilter !== 'ALL' || categoryFilter !== 'ALL' || tableSearch) && assignmentCounts.all > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => { setAssignmentFilter('ALL'); setCategoryFilter('ALL'); setTableSearch(''); }}
                style={{ fontSize: '11px', padding: '3px 10px' }}
              >
                View All Received Parts ({assignmentCounts.all})
              </button>
            )}
          </div>
        ) : (
          <div className="table-container" style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
            <table className="data-table" style={{ fontSize: '12px', width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 2 }}>
                <tr>
                  <th style={{ width: '36px', textAlign: 'center' }}>#</th>
                  <th style={{ width: '110px' }}>Part Number</th>
                  <th>Description / Model</th>
                  <th style={{ width: '100px' }}>Category</th>
                  <th style={{ width: '180px' }}>Serial Number</th>
                  <th style={{ width: '160px' }}>{isPmgUser ? 'Receiving Branch' : 'Assignment (Click to switch)'}</th>
                  <th style={{ width: '130px' }}>Intake Source</th>
                  <th style={{ width: '90px' }}>Timestamp</th>
                  <th style={{ width: '80px' }}>Status</th>
                  <th style={{ textAlign: 'right', width: '80px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedUnits.map((unit, idx) => {
                  const catBadge = getCategoryBadgeStyle(unit.category_code);
                  const isSvnr = isUnitSvnr(unit);
                  const isCrbr = isUnitCrbr(unit);
                  const badgeBg = isSvnr ? '#f3e8ff' : isCrbr ? '#fef3c7' : '#e0f2fe';
                  const badgeColor = isSvnr ? '#7e22ce' : isCrbr ? '#92400e' : '#0369a1';
                  const badgeBorder = isSvnr ? '1px solid #e9d5ff' : isCrbr ? '1px solid #fde68a' : '1px solid #bae6fd';
                  const badgeLabel = isSvnr ? 'SVNR' : isCrbr ? 'DC – CRBR' : 'MDC – Forecasting';

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
                        {isPmgUser ? (
                          <span
                            className="badge"
                            style={{
                              background: '#f0fdf4',
                              color: '#166534',
                              border: '1px solid #bbf7d0',
                              fontWeight: 600,
                              fontSize: '11.5px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px',
                              borderRadius: '4px'
                            }}
                          >
                            <Building2 size={11} color="#16a34a" />
                            <span>{unit.site_code || activeReceivingSite.code} Stock</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              let newDest = 'MDC - Forecasting';
                              if (isSvnr) {
                                newDest = 'MDC - Forecasting';
                              } else if (isCrbr) {
                                newDest = isProvincialSite(activeReceivingSite?.code) ? 'SVNR - Service Non-Repair' : 'MDC - Forecasting';
                              } else {
                                newDest = 'DC - CRBR';
                              }
                              updateUnitAssignment(unit.serial_number, newDest);
                              setSessionScans(prev => (prev || []).map(u => String(u.serial_number || '').toUpperCase() === String(unit.serial_number || '').toUpperCase() ? { ...u, intake_assignment: newDest, notes: newDest } : u));
                            }}
                            className="badge"
                            style={{
                              background: badgeBg,
                              color: badgeColor,
                              border: badgeBorder,
                              fontWeight: 700,
                              fontSize: '11px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              cursor: 'pointer',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              transition: 'all 0.15s'
                            }}
                            title={`Click to switch assignment (${badgeLabel})`}
                          >
                            {isSvnr ? <Layers size={11} color="#7e22ce" /> : isCrbr ? <Tag size={11} /> : <Layers size={11} />}
                            <span>{badgeLabel}</span>
                            <ArrowLeftRight size={10} style={{ opacity: 0.6, marginLeft: '2px' }} />
                          </button>
                        )}
                      </td>
                      <td>
                        {unit.isImported || (unit.received_by && unit.received_by.includes('Import')) ? (
                          <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '10.5px' }}>
                            <FileSpreadsheet size={11} style={{ display: 'inline', marginRight: '3px' }} />
                            Spreadsheet Import
                          </span>
                        ) : (
                          <span className="badge" style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', fontSize: '10.5px' }}>
                            <Barcode size={11} style={{ display: 'inline', marginRight: '3px' }} />
                            Barcode Scan
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {unit.received_at ? new Date(unit.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                      </td>
                      <td>
                        <span className="badge badge-success" style={{ fontSize: '10.5px', padding: '1px 6px' }}>In Stock</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setUnitToDelete(unit)}
                          style={{
                            padding: '3px 7px',
                            fontSize: '11px',
                            color: '#ef4444',
                            borderColor: '#fca5a5',
                            background: '#fff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            borderRadius: '4px'
                          }}
                          title={`Delete part #${unit.part_number} (${unit.serial_number}) if details are incorrect`}
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
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

      {/* --- XLSX / CSV Import Modal Dialog --- */}
      {isImportModalOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsImportModalOpen(false); }}>
          <div className="modal-content">
            {/* Modal Header */}
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: 'rgba(56, 189, 248, 0.15)', padding: '8px', borderRadius: '8px' }}>
                  <FileSpreadsheet size={22} color="#38bdf8" />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '17px', margin: 0 }}>Import Parts (XLSX / CSV)</h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Bulk receive parts with serial numbers, destination assignment, and persistent database save
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="modal-body">
              {/* Template Download & Options Row */}
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
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-main)' }}>Need a formatted template?</span>
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

              {/* Target Destination & Linked PO (DC Only) */}
              {!isPmgUser ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                      Linked Purchase Order:
                    </label>
                    <select
                      className="form-select"
                      style={{ width: '100%' }}
                      value={modalPoId}
                      onChange={(e) => setModalPoId(e.target.value)}
                    >
                      <option value="">-- No PO (Direct Dispatch) --</option>
                      {purchaseOrders.map(po => (
                        <option key={po.id} value={po.id}>
                          {po.po_number} ({po.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                      Intake Assignment / Destination:
                    </label>
                    <select
                      className="form-select"
                      style={{ width: '100%' }}
                      value={modalAssignment}
                      onChange={(e) => setModalAssignment(e.target.value)}
                    >
                      <option value="DC - CRBR">DC - CRBR (Customer Return & Buffer)</option>
                      <option value="MDC - Forecasting">MDC - Forecasting (Stock Allocation)</option>
                      <option value="SVNR - Service Non-Repair">SVNR - Service Non-Repair</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: '10px 14px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12.5px',
                  color: '#15803d'
                }}>
                  <Building2 size={16} color="#16a34a" />
                  <span>
                    Receiving directly into Branch Stock: <strong style={{ color: '#166534' }}>{activeReceivingSite.name} ({activeReceivingSite.code})</strong>
                  </span>
                </div>
              )}

              {/* Dropzone Area */}
              {!parsedBatch ? (
                <div
                  className={`dropzone ${isDragging ? 'active' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
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
                    {isParsing ? 'Processing and validating intake file...' : isDragging ? 'Drop your file here' : 'Click to browse or drag & drop file'}
                  </h4>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                    Supports Microsoft Excel (<strong>.xlsx, .xls</strong>) and <strong>.csv</strong> files
                  </p>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-subtle)', marginTop: '8px' }}>
                    Columns detected: Part Number, Serial Number, Description, PO Number, Box Number
                  </span>
                </div>
              ) : (
                /* Parsed Batch Results & Preview */
                <div>
                  {/* File Info Bar */}
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
                      <span className="badge" style={{
                        background: modalAssignment === 'DC - CRBR' ? '#fef3c7' : '#e0f2fe',
                        color: modalAssignment === 'DC - CRBR' ? '#92400e' : '#0369a1'
                      }}>
                        {modalAssignment}
                      </span>
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setParsedBatch(null); }}
                      style={{ fontSize: '12px', background: '#fff' }}
                    >
                      <RefreshCw size={12} style={{ display: 'inline', marginRight: '4px' }} />
                      Choose Different File
                    </button>
                  </div>

                  {/* Summary Metric Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
                    <div className="import-stat-card">
                      <span className="import-stat-label">Total Rows</span>
                      <span className="import-stat-value">{parsedBatch.summary.total}</span>
                    </div>
                    <div className="import-stat-card" style={{ borderColor: '#bbf7d0', background: '#f0fdf4' }}>
                      <span className="import-stat-label" style={{ color: '#16a34a' }}>Ready to Receive</span>
                      <span className="import-stat-value" style={{ color: '#16a34a' }}>{parsedBatch.summary.valid}</span>
                    </div>
                    <div className="import-stat-card" style={{ borderColor: (parsedBatch.summary.existingInStock || 0) > 0 ? '#bae6fd' : '#e2e8f0', background: (parsedBatch.summary.existingInStock || 0) > 0 ? '#f0f9ff' : 'transparent' }}>
                      <span className="import-stat-label" style={{ color: (parsedBatch.summary.existingInStock || 0) > 0 ? '#0284c7' : 'var(--text-muted)' }}>
                        Already in Stock
                      </span>
                      <span className="import-stat-value" style={{ color: (parsedBatch.summary.existingInStock || 0) > 0 ? '#0284c7' : 'var(--text-muted)' }}>
                        {parsedBatch.summary.existingInStock || 0}
                      </span>
                    </div>
                    <div className="import-stat-card" style={{ borderColor: parsedBatch.summary.duplicates > 0 ? '#fecaca' : '#e2e8f0' }}>
                      <span className="import-stat-label" style={{ color: parsedBatch.summary.duplicates > 0 ? '#dc2626' : 'var(--text-muted)' }}>
                        Duplicates in File
                      </span>
                      <span className="import-stat-value" style={{ color: parsedBatch.summary.duplicates > 0 ? '#dc2626' : 'var(--text-muted)' }}>
                        {parsedBatch.summary.duplicates}
                      </span>
                    </div>
                  </div>

                  {/* Filter Tabs */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button
                      className={`btn btn-sm ${importFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setImportFilter('ALL')}
                      style={{ fontSize: '12px' }}
                    >
                      All Items ({parsedBatch.items.length})
                    </button>
                    <button
                      className={`btn btn-sm ${importFilter === 'VALID' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setImportFilter('VALID')}
                      style={{ fontSize: '12px' }}
                    >
                      Valid ({parsedBatch.summary.valid})
                    </button>
                    {parsedBatch.summary.duplicates > 0 && (
                      <button
                        className={`btn btn-sm ${importFilter === 'DUPLICATE' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setImportFilter('DUPLICATE')}
                        style={{ fontSize: '12px' }}
                      >
                        Duplicates ({parsedBatch.summary.duplicates})
                      </button>
                    )}
                  </div>

                  {/* Preview Table */}
                  <div className="table-container" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                    <table className="data-table" style={{ fontSize: '12px' }}>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Part Number</th>
                          <th>Description</th>
                          <th>Serial Number</th>
                          <th>{isPmgUser ? 'Receiving Site' : 'Destination'}</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPreviewItems.map((item, idx) => (
                          <tr key={item.id || idx}>
                            <td>{item.rowNumber}</td>
                            <td className="font-mono"><strong>{item.partNumber}</strong></td>
                            <td>{item.description}</td>
                            <td className="font-mono">{item.serialNumber}</td>
                            <td>
                              <span className="badge" style={{
                                background: isPmgUser ? '#f0fdf4' : (modalAssignment === 'DC - CRBR' ? '#fef3c7' : '#e0f2fe'),
                                color: isPmgUser ? '#166534' : (modalAssignment === 'DC - CRBR' ? '#92400e' : '#0369a1'),
                                border: isPmgUser ? '1px solid #bbf7d0' : undefined,
                                fontSize: '11px'
                              }}>
                                {isPmgUser ? activeReceivingSite.code : modalAssignment}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${
                                item.status === 'VALID' ? 'badge-success' :
                                item.status === 'NEW_PART' ? 'badge-info' :
                                item.status === 'EXISTING_INVENTORY' ? 'badge-warning' : 'badge-danger'
                              }`}>
                                {item.statusMessage}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setParsedBatch(null);
                  setIsImportModalOpen(false);
                }}
              >
                Cancel
              </button>
              {parsedBatch && (
                <button
                  className="btn btn-primary"
                  onClick={handleConfirmBatchImport}
                  disabled={parsedBatch.summary.valid === 0}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CheckCircle2 size={16} />
                  <span>Receive & Save {parsedBatch.summary.valid} Parts {isPmgUser ? `(${activeReceivingSite.code})` : `(${modalAssignment})`}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save Intake Record Modal */}
      <SaveIntakeRecordModal
        isOpen={isSaveIntakeModalOpen}
        onClose={() => setIsSaveIntakeModalOpen(false)}
        initialUnits={availableInStockUnits}
        onSaved={(newRec) => {
          setSessionScans([]);
          try { localStorage.removeItem('mdc_recent_scans'); } catch (e) {}
          setScanResult({
            type: 'success',
            message: `[DISPATCHED RECORD CREATED] Successfully created record ${newRec.id} with ${newRec.total_units} units!`
          });
          setActiveReceiveTab('records');
        }}
      />

      {/* Delete Single Unit Confirmation Dialog */}
      {unitToDelete && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setUnitToDelete(null); }}>
          <div className="modal-content" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={20} color="#ef4444" />
                <h3 style={{ color: '#fff', fontSize: '17px', margin: 0 }}>Delete Unit from DC Stock?</h3>
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
                Are you sure you want to delete unit <strong>#{unitToDelete.part_number}</strong> with Serial <strong>{unitToDelete.serial_number}</strong>?
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                This will remove the item from active DC In-Stock inventory and delete its registration in the central database.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setUnitToDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleConfirmDeletePart}>Delete Unit</button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
