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
  AlertTriangle
} from 'lucide-react';
import { parseScanInPartsFile, downloadScanInTemplate } from '../utils/excelParser';
import { resolvePartInfo, normalizeInventoryUnits, validateAppleSerialNumber } from '../utils/partResolver';
import { barcodeAudio } from '../utils/barcodeAudio';
import SaveIntakeRecordModal from './SaveIntakeRecordModal';

export default function ScanInReceiving() {
  const {
    addScanInUnit,
    deleteScanInUnit,
    updateUnitAssignment,
    batchAddScanInUnits,
    purchaseOrders,
    parts,
    inventoryUnits,
    dcIntakeRecords,
    cloudSyncStatus,
    showToast,
    commitUnitsToStock,
    setActiveTab,
    activePackDraft,
    shipments
  } = useApp();

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

  // Part Intake Assignment: 'MDC - Forecasting' | 'DC - CRBR'
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

  // Recent scans state for active intake session
  const [sessionScans, setSessionScans] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_recent_scans');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Sync sessionScans to localStorage
  useEffect(() => {
    try {
      if (sessionScans.length > 0) {
        localStorage.setItem('mdc_recent_scans', JSON.stringify(sessionScans));
      } else {
        localStorage.removeItem('mdc_recent_scans');
      }
    } catch (e) {}
  }, [sessionScans]);

  // View & Filter States for Table (Defaults to All DC Stock)
  const [activeTableView, setActiveTableView] = useState('ALL_DC_STOCK'); // 'ALL_DC_STOCK' | 'SESSION_SCANS'
  const [assignmentFilter, setAssignmentFilter] = useState('ALL'); // 'ALL' | 'MDC - Forecasting' | 'DC - CRBR'
  const [tableSearch, setTableSearch] = useState('');

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
  const systemSerialsMap = useMemo(() => {
    const map = new Map();

    // 1. Current Session Scans (highest priority / most immediate)
    (sessionScans || []).forEach((u, idx) => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s && !map.has(s)) {
        map.set(s, {
          serial_number: s,
          part_number: u.part_number,
          description: u.description || 'Genuine Apple Part',
          assignment: u.intake_assignment || u.notes || 'MDC - Forecasting',
          received_at: u.received_at || new Date().toISOString(),
          location: `Current Session (Item #${idx + 1})`
        });
      }
    });

    // 2. DC Inventory Units
    (inventoryUnits || []).forEach(u => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s && !map.has(s)) {
        map.set(s, {
          serial_number: s,
          part_number: u.part_number,
          description: u.description || 'Genuine Apple Part',
          assignment: u.intake_assignment || u.notes || 'DC Warehouse Stock',
          received_at: u.received_at || u.created_at,
          location: u.status === 'packed' || u.status === 'shipped' ? 'Packed in Outbound Shipment' : 'DC Inventory Stock'
        });
      }
    });

    // 3. DC Intake Batch Records (Historical Batches)
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

    // 4. Shipments / Packing Lists
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

    return map;
  }, [sessionScans, inventoryUnits, dcIntakeRecords, shipments]);

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
      notes: currentAssignment
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
          notes: currentAssignment
        });
        if (res.success) {
          setScanResult({
            type: 'success',
            message: `[AUTO-RECEIVED ${currentAssignment}] ${res.unit.part_number} — ${res.unit.description} (SN: ${res.unit.serial_number})`
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
      const res = await parseScanInPartsFile(file, parts, inventoryUnits, purchaseOrders);
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

    const validItems = parsedBatch.items
      .filter(it => it.status === 'VALID' || it.status === 'NEW_PART' || it.status === 'EXISTING_INVENTORY')
      .map(it => ({
        ...it,
        intake_assignment: it.notes?.includes('CRBR') ? 'DC - CRBR' : modalAssignment,
        notes: it.notes || modalAssignment
      }));

    if (validItems.length === 0) {
      showToast('No valid parts to import.', 'error');
      return;
    }

    const res = batchAddScanInUnits(validItems, modalPoId || selectedPoId || null, modalAssignment);
    if (res.success) {
      const importedWithFlag = res.units.map(u => ({ ...u, isImported: true }));
      setSessionScans(prev => [...importedWithFlag, ...prev]);

      setScanResult({
        type: 'success',
        message: `[BATCH IMPORT COMPLETE] Successfully received & saved ${res.count} parts (${modalAssignment}) from "${parsedBatch.fileName}" into DC Database!`
      });

      setActiveTableView('ALL_DC_STOCK');
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

  // Filter for currently available IN-STOCK units in DC (normalized to ensure Apple P/N and exclude mislabeled/packed units)
  const availableInStockUnits = useMemo(() => {
    const raw = (inventoryUnits || []).filter(u => {
      const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
      if (cleanSerial && packedSerialsSet.has(cleanSerial)) return false;
      if (u.status === 'packed' || u.status === 'shipped' || u.status === 'dispatched' || u.status === 'allocated') return false;
      return u.status === 'in_stock' || (!u.status && u.current_site_id === 'site-dc');
    });
    return normalizeInventoryUnits(raw, parts);
  }, [inventoryUnits, packedSerialsSet, parts]);

  // Normalized session scans
  const normalizedSessionScans = useMemo(() => {
    return normalizeInventoryUnits(sessionScans, parts);
  }, [sessionScans, parts]);

  // Table items calculation with Assignment Filter
  const displayedUnits = useMemo(() => {
    let sourceList = activeTableView === 'ALL_DC_STOCK'
      ? availableInStockUnits
      : normalizedSessionScans;

    if (!sourceList) sourceList = [];

    // Assignment filter
    if (assignmentFilter === 'MDC - Forecasting') {
      sourceList = sourceList.filter(u => !u.intake_assignment?.includes('CRBR') && !u.notes?.includes('CRBR'));
    } else if (assignmentFilter === 'DC - CRBR') {
      sourceList = sourceList.filter(u => u.intake_assignment?.includes('CRBR') || u.notes?.includes('CRBR'));
    }

    if (!tableSearch.trim()) return sourceList;

    const q = tableSearch.toLowerCase().trim();
    return sourceList.filter(u =>
      (u.part_number && u.part_number.toLowerCase().includes(q)) ||
      (u.serial_number && u.serial_number.toLowerCase().includes(q)) ||
      (u.description && u.description.toLowerCase().includes(q)) ||
      (u.intake_assignment && u.intake_assignment.toLowerCase().includes(q)) ||
      (u.notes && u.notes.toLowerCase().includes(q))
    );
  }, [activeTableView, assignmentFilter, availableInStockUnits, normalizedSessionScans, tableSearch]);

  const handleClearSessionHistory = () => {
    setSessionScans([]);
    localStorage.removeItem('mdc_recent_scans');
    showToast('Cleared session view history (Stock inventory remains intact in Database)', 'info');
  };

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
      if (sessionScans && sessionScans.length > 0) {
        targetUnits = sessionScans;
      } else if (availableInStockUnits && availableInStockUnits.length > 0) {
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
          message: `[STOCK FINALIZED] Successfully added ${targetUnits.length} units to DC Stock! All parts are now in-stock, accessible to other users, and visible for packing list creation.`
        });
        setSessionScans([]);
        localStorage.removeItem('mdc_recent_scans');
        setActiveTableView('ALL_DC_STOCK');
      }
    } catch (err) {
      console.error('Add to stock error:', err);
      showToast('Error finalizing parts to DC stock', 'error');
    } finally {
      setIsAddingToStock(false);
    }
  };

  // Metric counts for assignment
  const forecastingCount = useMemo(() => {
    const list = activeTableView === 'ALL_DC_STOCK' ? availableInStockUnits : normalizedSessionScans;
    return list.filter(u => !u.intake_assignment?.includes('CRBR') && !u.notes?.includes('CRBR')).length;
  }, [activeTableView, availableInStockUnits, normalizedSessionScans]);

  const crbrCount = useMemo(() => {
    const list = activeTableView === 'ALL_DC_STOCK' ? availableInStockUnits : normalizedSessionScans;
    return list.filter(u => u.intake_assignment?.includes('CRBR') || u.notes?.includes('CRBR')).length;
  }, [activeTableView, availableInStockUnits, normalizedSessionScans]);

  return (
    <div className="scanner-container">
      {/* Scanner Workstation Hero Card */}
      <div className="scanner-hero">
        {/* Header Row: Title & System Telemetry Status */}
        <div className="scanner-hero-header" style={{ marginBottom: '18px', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '21px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <Barcode size={24} color="#38bdf8" />
              <span>DC Receive Scan-In Station</span>
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '3px', margin: '3px 0 0 0' }}>
              Physical Keyboard HID Barcode Scanner Active • Current Destination: <strong style={{ color: intakeAssignment === 'DC - CRBR' ? '#fbbf24' : '#38bdf8' }}>{intakeAssignment}</strong>
            </p>
          </div>

          {/* System Telemetry Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div
              className="telemetry-badge"
              style={{
                background: cloudSyncStatus?.isSaving ? 'rgba(56, 189, 248, 0.15)' : 'rgba(16, 185, 129, 0.12)',
                borderColor: cloudSyncStatus?.isSaving ? '#38bdf8' : 'rgba(16, 185, 129, 0.4)'
              }}
              title="Real-time Direct Database Sync (Auto-Save on every scan)"
            >
              {cloudSyncStatus?.isSaving ? (
                <>
                  <RefreshCw size={13} className="spin" color="#38bdf8" />
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>Saving to Cloud DB...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} color="#34d399" />
                  <span style={{ color: '#34d399', fontWeight: 600 }}>Cloud Auto-Save: Active</span>
                </>
              )}
            </div>

            <div className="telemetry-badge" title="Total active parts in DC stock inventory">
              <Database size={14} color="#38bdf8" />
              <span>DC Stock: <strong>{availableInStockUnits.length} units</strong></span>
            </div>

            <div className="telemetry-badge" title="Hardware Scanner Connection Status">
              <div className="pulse-dot" />
              <span style={{ color: '#34d399', fontWeight: 600 }}>Scanner: Ready (HID)</span>
            </div>
          </div>
        </div>

        {/* Workstation Controls & Actions Toolbar */}
        <div className="workstation-controls-bar" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {/* Column 1: PO Selector */}
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

          {/* Column 2: Part Assignment Classification (CRBR vs Forecasting) */}
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
                  fontSize: '11.5px',
                  fontWeight: intakeAssignment === 'MDC - Forecasting' ? 700 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  transition: 'all 0.15s'
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
                  fontSize: '11.5px',
                  fontWeight: intakeAssignment === 'DC - CRBR' ? 700 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  transition: 'all 0.15s'
                }}
                title="Designated for Customer Return / Repair Buffer Returns (CRBR) — Separate from Forecasting"
              >
                <span>DC - CRBR</span>
              </button>
            </div>
            <span style={{ fontSize: '11px', color: intakeAssignment === 'DC - CRBR' ? '#fbbf24' : '#38bdf8', marginTop: '4px', display: 'block' }}>
              {intakeAssignment === 'DC - CRBR' ? '• Tagged: DC - CRBR (Customer Return & Buffer)' : '• Tagged: MDC - Forecasting (Stock Allocation)'}
            </span>
          </div>

          {/* Column 3: Auto-Receive Switch & Settings */}
          <div>
            <label className="workstation-col-label">
              <Zap size={13} color={autoReceive ? "#10b981" : "#94a3b8"} />
              <span>3. Scanner Intake Mode</span>
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
                  {autoReceive ? 'Intakes instantly on scan' : 'Requires manual click'}
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

          {/* Column 4: Workstation Action Buttons */}
          <div>
            <label className="workstation-col-label">
              <Sparkles size={13} color="#38bdf8" />
              <span>4. Batch Actions</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                className="action-btn-emerald"
                onClick={handleAddAllToStock}
                disabled={isAddingToStock || (sessionScans.length === 0 && availableInStockUnits.length === 0)}
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
                <span>Add to Stock ({sessionScans.length > 0 ? sessionScans.length : availableInStockUnits.length})</span>
              </button>

              <button
                type="button"
                className="action-btn-slate"
                onClick={() => setIsImportModalOpen(true)}
                title="Bulk upload parts spreadsheet (.xlsx / .csv)"
              >
                <FileSpreadsheet size={15} />
                <span>Import Spreadsheet</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsSaveIntakeModalOpen(true)}
                title="Save current scanned parts into a named DC Intake Record (MDC202600015)"
                style={{ justifyContent: 'center', height: '32px', fontSize: '12px', opacity: 0.9 }}
              >
                <BookmarkPlus size={14} />
                <span>Save Intake Record Batch</span>
              </button>
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
      <div className="card">
        {/* Table Header Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Received DC Stock & Intake History</h3>
            {/* View Switcher: All DC Stock vs Current Session */}
            <div style={{ display: 'flex', background: 'var(--bg-app)', padding: '3px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                onClick={() => setActiveTableView('ALL_DC_STOCK')}
                style={{
                  background: activeTableView === 'ALL_DC_STOCK' ? '#fff' : 'transparent',
                  color: activeTableView === 'ALL_DC_STOCK' ? 'var(--text-main)' : 'var(--text-muted)',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: activeTableView === 'ALL_DC_STOCK' ? 600 : 400,
                  cursor: 'pointer',
                  boxShadow: activeTableView === 'ALL_DC_STOCK' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
              >
                All DC Stock ({availableInStockUnits.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTableView('SESSION_SCANS')}
                style={{
                  background: activeTableView === 'SESSION_SCANS' ? '#fff' : 'transparent',
                  color: activeTableView === 'SESSION_SCANS' ? 'var(--text-main)' : 'var(--text-muted)',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: activeTableView === 'SESSION_SCANS' ? 600 : 400,
                  cursor: 'pointer',
                  boxShadow: activeTableView === 'SESSION_SCANS' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
              >
                Current Session ({normalizedSessionScans.length})
              </button>
            </div>

            {/* Assignment Filter Switcher */}
            <div style={{ display: 'flex', background: 'var(--bg-app)', padding: '3px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                onClick={() => setAssignmentFilter('ALL')}
                style={{
                  background: assignmentFilter === 'ALL' ? '#fff' : 'transparent',
                  color: assignmentFilter === 'ALL' ? 'var(--text-main)' : 'var(--text-muted)',
                  border: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11.5px',
                  fontWeight: assignmentFilter === 'ALL' ? 600 : 400,
                  cursor: 'pointer'
                }}
              >
                All Destinations
              </button>
              <button
                type="button"
                onClick={() => setAssignmentFilter('MDC - Forecasting')}
                style={{
                  background: assignmentFilter === 'MDC - Forecasting' ? '#0284c7' : 'transparent',
                  color: assignmentFilter === 'MDC - Forecasting' ? '#fff' : 'var(--text-muted)',
                  border: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11.5px',
                  fontWeight: assignmentFilter === 'MDC - Forecasting' ? 600 : 400,
                  cursor: 'pointer'
                }}
              >
                MDC - Forecasting ({forecastingCount})
              </button>
              <button
                type="button"
                onClick={() => setAssignmentFilter('DC - CRBR')}
                style={{
                  background: assignmentFilter === 'DC - CRBR' ? '#d97706' : 'transparent',
                  color: assignmentFilter === 'DC - CRBR' ? '#fff' : 'var(--text-muted)',
                  border: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11.5px',
                  fontWeight: assignmentFilter === 'DC - CRBR' ? 600 : 400,
                  cursor: 'pointer'
                }}
              >
                DC - CRBR ({crbrCount})
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Filter P/N, S/N, destination..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '28px', height: '34px', fontSize: '12px', width: '100%' }}
              />
            </div>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setActiveTab('intake-records')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', height: '34px' }}
              title="View all stock grouped by date in DC Intake Records"
            >
              <BookmarkPlus size={14} color="#0284c7" />
              <span>Intake Records</span>
            </button>

            {sessionScans.length > 0 && activeTableView === 'SESSION_SCANS' && (
              <button className="btn btn-secondary btn-sm" onClick={handleClearSessionHistory} style={{ height: '34px' }}>
                Clear Session View
              </button>
            )}
          </div>
        </div>

        {displayedUnits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)', fontSize: '13.5px' }}>
            {tableSearch || assignmentFilter !== 'ALL' ? (
              <span>No parts found matching current filters. Try resetting search or destination filters.</span>
            ) : activeTableView === 'ALL_DC_STOCK' ? (
              <span>No parts currently in DC inventory. Scan barcode or upload XLSX/CSV to receive parts.</span>
            ) : (
              <span>No units in recent session view. Switch to "All DC Stock ({availableInStockUnits.length})" above to see all inventory.</span>
            )}
          </div>
        ) : (
          <div className="table-container" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th>Serial Number</th>
                  <th>Assignment / Note (Click to switch)</th>
                  <th>Intake Source</th>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedUnits.map((unit, idx) => {
                  const isCrbr = unit.intake_assignment?.includes('CRBR') || unit.notes?.includes('CRBR');
                  return (
                    <tr key={unit.id || `${unit.serial_number}-${idx}`}>
                      <td className="font-mono">{idx + 1}</td>
                      <td className="font-mono">
                        <strong style={{ color: '#0f172a' }}>{unit.part_number}</strong>
                      </td>
                      <td>{unit.description}</td>
                      <td className="font-mono">{unit.serial_number}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => {
                            const newDest = isCrbr ? 'MDC - Forecasting' : 'DC - CRBR';
                            updateUnitAssignment(unit.serial_number, newDest);
                            setSessionScans(prev => (prev || []).map(u => String(u.serial_number || '').toUpperCase() === String(unit.serial_number || '').toUpperCase() ? { ...u, intake_assignment: newDest, notes: newDest } : u));
                          }}
                          className="badge"
                          style={{
                            background: isCrbr ? '#fef3c7' : '#e0f2fe',
                            color: isCrbr ? '#92400e' : '#0369a1',
                            border: isCrbr ? '1px solid #fde68a' : '1px solid #bae6fd',
                            fontWeight: 700,
                            fontSize: '11.5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: 'pointer',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            transition: 'all 0.15s'
                          }}
                          title={`Click to toggle destination to ${isCrbr ? 'MDC - Forecasting' : 'DC - CRBR'}`}
                        >
                          {isCrbr ? <Tag size={11} /> : <Layers size={11} />}
                          <span>{isCrbr ? 'DC - CRBR' : 'MDC - Forecasting'}</span>
                          <ArrowLeftRight size={10} style={{ opacity: 0.6, marginLeft: '2px' }} />
                        </button>
                      </td>
                      <td>
                        {unit.isImported || (unit.received_by && unit.received_by.includes('Import')) ? (
                          <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>
                            <FileSpreadsheet size={12} style={{ display: 'inline', marginRight: '4px' }} />
                            Spreadsheet Import
                          </span>
                        ) : (
                          <span className="badge" style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}>
                            <Barcode size={12} style={{ display: 'inline', marginRight: '4px' }} />
                            Barcode Scan
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {unit.received_at ? new Date(unit.received_at).toLocaleTimeString() : 'Recent'}
                      </td>
                      <td>
                        <span className="badge badge-success">In Stock</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setUnitToDelete(unit)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '11.5px',
                            color: '#ef4444',
                            borderColor: '#fca5a5',
                            background: '#fff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title={`Delete part #${unit.part_number} (${unit.serial_number}) if details are incorrect`}
                        >
                          <Trash2 size={13} />
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

              {/* Grid: PO Selector & Assignment Selector */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                    Default Purchase Order:
                  </label>
                  <select
                    className="form-select"
                    style={{ width: '100%' }}
                    value={modalPoId}
                    onChange={(e) => setModalPoId(e.target.value)}
                  >
                    <option value="">-- No PO (Direct DC Intake) --</option>
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
                  </select>
                </div>
              </div>

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
                          <th>Destination</th>
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
                                background: modalAssignment === 'DC - CRBR' ? '#fef3c7' : '#e0f2fe',
                                color: modalAssignment === 'DC - CRBR' ? '#92400e' : '#0369a1',
                                fontSize: '11px'
                              }}>
                                {modalAssignment}
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
                  <span>Receive & Save {parsedBatch.summary.valid} Parts ({modalAssignment})</span>
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
        initialUnits={sessionScans.length > 0 ? sessionScans : availableInStockUnits}
        onSaved={(newRec) => {
          setSessionScans([]);
          localStorage.removeItem('mdc_recent_scans');
          setScanResult({
            type: 'success',
            message: `[INTAKE RECORD CREATED] Successfully created record ${newRec.id} with ${newRec.total_units} units!`
          });
          setActiveTab('intake-records');
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
    </div>
  );
}
