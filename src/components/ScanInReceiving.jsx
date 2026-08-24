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
  ArrowUpRight
} from 'lucide-react';
import { parseScanInPartsFile, downloadScanInTemplate } from '../utils/excelParser';
import SaveIntakeRecordModal from './SaveIntakeRecordModal';

export default function ScanInReceiving() {
  const {
    addScanInUnit,
    deleteScanInUnit,
    batchAddScanInUnits,
    purchaseOrders,
    parts,
    inventoryUnits,
    dcIntakeRecords,
    cloudSyncStatus,
    isAutoRefreshing,
    lastSyncedAt,
    autoRefreshData,
    showToast,
    commitUnitsToStock,
    setActiveTab
  } = useApp();

  const [selectedPoId, setSelectedPoId] = useState(purchaseOrders[0]?.id || '');
  const [partNumberInput, setPartNumberInput] = useState('');
  const [serialInput, setSerialInput] = useState('');
  const [scanResult, setScanResult] = useState(null); // { type: 'success' | 'error', message: '' }
  const [isSaveIntakeModalOpen, setIsSaveIntakeModalOpen] = useState(false);
  const [unitToDelete, setUnitToDelete] = useState(null);

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
  const [tableSearch, setTableSearch] = useState('');

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedBatch, setParsedBatch] = useState(null);
  const [modalPoId, setModalPoId] = useState(purchaseOrders[0]?.id || '');
  const [importFilter, setImportFilter] = useState('ALL'); // 'ALL' | 'VALID' | 'DUPLICATE'

  const pnInputRef = useRef(null);
  const serialInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const autoScanTimerRef = useRef(null);

  // Auto-focus Part Number input on mount
  useEffect(() => {
    pnInputRef.current?.focus();
    return () => {
      if (autoScanTimerRef.current) {
        clearTimeout(autoScanTimerRef.current);
      }
    };
  }, []);

  // Sync modal PO with hero PO when opening
  useEffect(() => {
    if (isImportModalOpen) {
      setModalPoId(selectedPoId);
    }
  }, [isImportModalOpen, selectedPoId]);

  // Helper to parse combined 2D / GS1 / Tab-delimited barcode formats
  const parseBarcodeData = (raw) => {
    if (!raw) return null;
    const str = raw.trim();
    const match = str.match(/^([A-Za-z0-9-]+)[,\t/|#;]([A-Za-z0-9-]+)$/);
    if (match) {
      return { pn: match[1].trim(), sn: match[2].trim() };
    }
    const spaceMatch = str.match(/^([0-9]{3}-[0-9]{4,5})\s+([A-Za-z0-9-]+)$/);
    if (spaceMatch) {
      return { pn: spaceMatch[1].trim(), sn: spaceMatch[2].trim() };
    }
    return null;
  };

  const executeScan = (overridePn = null, overrideSn = null) => {
    if (autoScanTimerRef.current) {
      clearTimeout(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }

    const pnToUse = (overridePn !== null ? overridePn : partNumberInput).trim();
    const snToUse = (overrideSn !== null ? overrideSn : serialInput).trim();

    if (!pnToUse || !snToUse) {
      setScanResult({
        type: 'error',
        message: 'Please provide both Part Number and Serial Number'
      });
      return false;
    }

    const res = addScanInUnit({
      partNumber: pnToUse,
      serialNumber: snToUse,
      poId: selectedPoId || null
    });

    if (res.success) {
      setScanResult({
        type: 'success',
        message: `Successfully received: ${res.unit.description} (SN: ${res.unit.serial_number})`
      });
      setSessionScans(prev => [res.unit, ...prev]);
      
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

  // Handle Part Number change (detects barcode scanner stream, combined barcodes, and auto-advance)
  const handlePnChange = (e) => {
    const val = e.target.value;
    setPartNumberInput(val);

    if (autoScanTimerRef.current) {
      clearTimeout(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }

    if (!autoReceive) return;

    const cleanPn = val.trim();
    const combined = parseBarcodeData(cleanPn);
    if (combined) {
      setPartNumberInput(combined.pn);
      setSerialInput(combined.sn);
      executeScan(combined.pn, combined.sn);
      return;
    }

    // Auto-advance to Serial field once valid Apple Part Number is scanned (e.g. 661-xxxxx)
    if (/^[0-9]{3}-[0-9]{4,6}$/i.test(cleanPn) || (cleanPn.length >= 9 && cleanPn.includes('-'))) {
      autoScanTimerRef.current = setTimeout(() => {
        serialInputRef.current?.focus();
        serialInputRef.current?.select();
      }, 140);
    }
  };

  // Handle Serial change (instantly auto-receives once full serial number is complete and scanned!)
  const handleSerialChange = (e) => {
    const val = e.target.value;
    setSerialInput(val);

    if (autoScanTimerRef.current) {
      clearTimeout(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }

    if (!autoReceive) return;

    const cleanSerial = val.trim();
    const cleanPn = partNumberInput.trim();

    const combined = parseBarcodeData(cleanSerial);
    if (combined) {
      setPartNumberInput(combined.pn);
      setSerialInput(combined.sn);
      executeScan(combined.pn, combined.sn);
      return;
    }

    // When full serial number is scanned and complete (>= 8 chars), automatically receive!
    if (cleanPn && cleanSerial.length >= 8) {
      autoScanTimerRef.current = setTimeout(() => {
        executeScan(cleanPn, cleanSerial);
      }, 160);
    }
  };

  // Handle Part Number submission (Enter key from scanner)
  const handlePnKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const combined = parseBarcodeData(partNumberInput);
      if (combined) {
        setPartNumberInput(combined.pn);
        setSerialInput(combined.sn);
        if (autoReceive) {
          executeScan(combined.pn, combined.sn);
        } else {
          serialInputRef.current?.focus();
        }
        return;
      }
      if (partNumberInput.trim()) {
        serialInputRef.current?.focus();
        serialInputRef.current?.select();
      }
    }
  };

  // Handle Serial submission (Enter key from scanner)
  const handleSerialKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const combined = parseBarcodeData(serialInput);
      if (combined) {
        setPartNumberInput(combined.pn);
        setSerialInput(combined.sn);
        if (autoReceive) {
          executeScan(combined.pn, combined.sn);
        } else {
          serialInputRef.current?.focus();
        }
        return;
      }
      executeScan();
    }
  };

  // Quick Mock Scanner Simulator (for testing without a physical barcode scanner)
  const testSampleParts = [
    { pn: '661-21991', desc: 'Battery, iPhone 13', prefix: 'DN8', suffix: 'MCN3R' },
    { pn: '661-21996', desc: 'Battery, iPhone 13 Pro', prefix: 'DNM', suffix: '33817' },
    { pn: '661-22294', desc: 'Battery, iPhone 13 Pro Max', prefix: 'F8Y', suffix: '13XCB' },
    { pn: '661-30401', desc: 'Display, iPhone 14 Pro Max', prefix: 'GH3', suffix: '00MUZ' }
  ];

  const handleSimulateScan = (pn, prefix = 'DN8', suffix = 'MCN3R') => {
    const randomSerial = `${prefix}${Date.now().toString().slice(-6)}${suffix}`;
    const serial = randomSerial;
    setPartNumberInput(pn);
    setSerialInput(serial);
    if (autoReceive) {
      setTimeout(() => {
        const res = addScanInUnit({
          partNumber: pn,
          serialNumber: serial,
          poId: selectedPoId || null
        });
        if (res.success) {
          setScanResult({
            type: 'success',
            message: `[AUTO-RECEIVED] ${res.unit.description} (SN: ${res.unit.serial_number})`
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

    const validItems = parsedBatch.items.filter(it => it.status === 'VALID' || it.status === 'NEW_PART' || it.status === 'EXISTING_INVENTORY');
    if (validItems.length === 0) {
      showToast('No valid parts to import.', 'error');
      return;
    }

    const res = batchAddScanInUnits(validItems, modalPoId || selectedPoId || null);
    if (res.success) {
      // Mark imported units with import source badge
      const importedWithFlag = res.units.map(u => ({ ...u, isImported: true }));
      setSessionScans(prev => [...importedWithFlag, ...prev]);

      setScanResult({
        type: 'success',
        message: `[BATCH IMPORT COMPLETE] Successfully received & saved ${res.count} parts from "${parsedBatch.fileName}" into DC Database!`
      });

      // Switch view to show the newly imported items in All DC Stock
      setActiveTableView('ALL_DC_STOCK');

      // Reset and close modal
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

  // Filter for currently available IN-STOCK units in DC (packed/shipped units are automatically deducted)
  const availableInStockUnits = useMemo(() => {
    return (inventoryUnits || []).filter(u => u.status === 'in_stock' || (!u.status && u.current_site_id === 'site-dc'));
  }, [inventoryUnits]);

  // Table items calculation
  const displayedUnits = useMemo(() => {
    let sourceList = activeTableView === 'ALL_DC_STOCK'
      ? availableInStockUnits
      : sessionScans;

    if (!sourceList) sourceList = [];

    if (!tableSearch.trim()) return sourceList;

    const q = tableSearch.toLowerCase().trim();
    return sourceList.filter(u =>
      (u.part_number && u.part_number.toLowerCase().includes(q)) ||
      (u.serial_number && u.serial_number.toLowerCase().includes(q)) ||
      (u.description && u.description.toLowerCase().includes(q))
    );
  }, [activeTableView, availableInStockUnits, sessionScans, tableSearch]);

  const handleClearSessionHistory = () => {
    setSessionScans([]);
    localStorage.removeItem('mdc_recent_scans');
    showToast('Cleared session view history (Stock inventory remains intact in Database)', 'info');
  };

  const handleConfirmDeletePart = async () => {
    if (!unitToDelete) return;
    const serial = unitToDelete.serial_number;
    await deleteScanInUnit(serial);
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

  return (
    <div className="scanner-container">
      {/* Scanner Workstation Hero Card */}
      <div className="scanner-hero">
        {/* Header Row: Title & System Telemetry Status (Read-Only Badges) */}
        <div className="scanner-hero-header" style={{ marginBottom: '18px', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '21px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <Barcode size={24} color="#38bdf8" />
              <span>DC Receive Scan-In Station</span>
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '3px', margin: '3px 0 0 0' }}>
              Physical Keyboard HID Barcode Scanner Active • Automatic Database Persistence
            </p>
          </div>

          {/* System Telemetry Badges (Read-Only Information Badges) */}
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

        {/* Workstation Controls & Actions Toolbar (3 Distinct Logical Columns) */}
        <div className="workstation-controls-bar">
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

          {/* Column 2: Auto-Receive Switch & Settings */}
          <div>
            <label className="workstation-col-label">
              <Zap size={13} color={autoReceive ? "#10b981" : "#94a3b8"} />
              <span>2. Scanner Intake Mode</span>
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

          {/* Column 3: Workstation Action Buttons */}
          <div>
            <label className="workstation-col-label">
              <Sparkles size={13} color="#38bdf8" />
              <span>3. Batch Actions</span>
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

        {/* Dual Input Fields for Barcode Scans */}
        <div className="scan-input-grid">
          <div>
            <label className="scanner-field-label">1. Part Number (P/N)</label>
            <input
              ref={pnInputRef}
              type="text"
              className="scanner-input"
              placeholder="e.g. 661-21991"
              value={partNumberInput}
              onChange={handlePnChange}
              onKeyDown={handlePnKeyDown}
            />
          </div>

          <div>
            <label className="scanner-field-label">2. Serial Number (S/N)</label>
            <input
              ref={serialInputRef}
              type="text"
              className="scanner-input"
              placeholder="e.g. F8Y6276C1UQ13XCB1"
              value={serialInput}
              onChange={handleSerialChange}
              onKeyDown={handleSerialKeyDown}
            />
          </div>

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

      {/* Simulator Tools for Rapid Paired Testing */}
      <div className="card" style={{ marginBottom: '24px', background: '#f8fafc' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Zap size={16} color="var(--primary)" />
            <strong style={{ fontSize: '13px' }}>Scanner Simulator & Quick Tools</strong>
          </div>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>No hardware required</span>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {testSampleParts.map((sample, idx) => (
            <button
              key={idx}
              className="btn btn-secondary btn-sm"
              onClick={() => handleSimulateScan(sample.pn, sample.prefix, sample.suffix)}
            >
              <span>+ Scan {sample.desc}</span>
            </button>
          ))}

          <div style={{ marginLeft: 'auto' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsImportModalOpen(true)}
              style={{ background: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <UploadCloud size={14} color="var(--primary)" />
              <span>Upload Parts Spreadsheet</span>
            </button>
          </div>
        </div>
      </div>

      {/* Inventory & Intake History Table (Persistent & Live) */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h3 style={{ margin: 0 }}>Received DC Stock & Intake History</h3>
              <span
                className="badge"
                style={{
                  background: isAutoRefreshing ? '#f0f9ff' : '#ecfdf5',
                  color: isAutoRefreshing ? '#0284c7' : '#047857',
                  border: `1px solid ${isAutoRefreshing ? '#7dd3fc' : '#a7f3d0'}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.2s ease'
                }}
                title={isAutoRefreshing ? "Auto-refreshing latest inventory from database..." : "Data auto-refreshed on page visit and synced with database"}
              >
                {isAutoRefreshing ? (
                  <>
                    <RefreshCw size={11} className="spin" />
                    <span>Auto-Refreshing...</span>
                  </>
                ) : (
                  <>
                    <Check size={11} />
                    <span>Live Synced</span>
                  </>
                )}
              </span>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
              Total DC In-Stock Units: <strong>{availableInStockUnits.length}</strong> • Recent Session Intake: <strong>{sessionScans.length}</strong>
              {lastSyncedAt && <span style={{ marginLeft: '8px', opacity: 0.8 }}>• Verified: {new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* View Filter Switcher */}
            <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: 'var(--radius-md)' }}>
              <button
                className={`btn btn-sm ${activeTableView === 'ALL_DC_STOCK' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveTableView('ALL_DC_STOCK')}
                style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '4px' }}
              >
                All DC Stock ({availableInStockUnits.length})
              </button>
              <button
                className={`btn btn-sm ${activeTableView === 'SESSION_SCANS' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveTableView('SESSION_SCANS')}
                style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '4px' }}
              >
                Recent Session ({sessionScans.length})
              </button>
            </div>

            {/* Quick Search */}
            <div style={{ position: 'relative', minWidth: '200px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search P/N, serial..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '30px', paddingRight: '10px', height: '34px', fontSize: '12.5px', width: '100%' }}
              />
            </div>

            {/* Quick Manual Refresh Button */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData && autoRefreshData({ force: true, silent: false, reason: 'ScanInReceiving manual refresh' })}
              disabled={isAutoRefreshing}
              title="Force reload latest inventory from database"
              style={{ height: '34px', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Refresh'}</span>
            </button>

            {/* Direct Add to Stock button in Table Toolbar */}
            {sessionScans.length > 0 && (
              <button
                className="btn btn-sm btn-primary"
                onClick={handleAddAllToStock}
                disabled={isAddingToStock}
                style={{
                  background: '#10b981',
                  borderColor: '#059669',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontWeight: 600,
                  height: '34px'
                }}
                title="Finalize recent session parts and add them to permanent DC Stock"
              >
                {isAddingToStock ? <RefreshCw size={13} className="spin" /> : <PackageCheck size={14} />}
                <span>Add to Stock ({sessionScans.length})</span>
              </button>
            )}

            {/* Quick jump to Pack Scan-Out button */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setActiveTab('scan-out')}
              style={{
                height: '34px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                color: '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.3)',
                background: 'rgba(56, 189, 248, 0.08)'
              }}
              title="Navigate to Pack Scan-Out to create packing lists with available stock"
            >
              <ArrowUpRight size={14} />
              <span>Create Packing List</span>
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
            {tableSearch ? (
              <span>No parts found matching "{tableSearch}". Try a different search term.</span>
            ) : activeTableView === 'ALL_DC_STOCK' ? (
              <span>No parts currently in DC inventory. Scan barcode or upload XLSX/CSV to receive parts.</span>
            ) : (
              <span>No units in recent session view. Switch to "All DC Stock ({inventoryUnits.length})" above to see all inventory.</span>
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
                  <th>Intake Source</th>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedUnits.map((unit, idx) => (
                  <tr key={unit.id || `${unit.serial_number}-${idx}`}>
                    <td className="font-mono">{idx + 1}</td>
                    <td className="font-mono"><strong>{unit.part_number}</strong></td>
                    <td>{unit.description}</td>
                    <td className="font-mono">{unit.serial_number}</td>
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
                ))}
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
                    Bulk receive parts with serial numbers and save directly to persistent database
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

              {/* Linked PO Selector inside modal */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                  Default Purchase Order for this Intake:
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', maxWidth: '450px' }}
                  value={modalPoId}
                  onChange={(e) => setModalPoId(e.target.value)}
                >
                  <option value="">-- No PO (Direct DC Intake) --</option>
                  {purchaseOrders.map(po => (
                    <option key={po.id} value={po.id}>
                      {po.po_number} ({po.status}) - {po.supplier || 'Apple Direct'}
                    </option>
                  ))}
                </select>
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
                        Repeated in File
                      </span>
                      <span className="import-stat-value" style={{ color: parsedBatch.summary.duplicates > 0 ? '#dc2626' : 'var(--text-muted)' }}>
                        {parsedBatch.summary.duplicates}
                      </span>
                    </div>
                  </div>

                  {/* Filter tabs */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                    <button
                      className={`btn btn-sm ${importFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setImportFilter('ALL')}
                    >
                      All ({parsedBatch.items.length})
                    </button>
                    <button
                      className={`btn btn-sm ${importFilter === 'VALID' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setImportFilter('VALID')}
                    >
                      Ready to Receive ({parsedBatch.summary.valid})
                    </button>
                    {(parsedBatch.summary.existingInStock || 0) > 0 && (
                      <button
                        className={`btn btn-sm ${importFilter === 'EXISTING' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setImportFilter('EXISTING')}
                        style={{ background: importFilter === 'EXISTING' ? '#0284c7' : 'transparent', color: importFilter === 'EXISTING' ? '#fff' : '#0369a1', borderColor: '#bae6fd' }}
                      >
                        In-Stock Updates ({parsedBatch.summary.existingInStock})
                      </button>
                    )}
                    {parsedBatch.summary.duplicates > 0 && (
                      <button
                        className={`btn btn-sm ${importFilter === 'DUPLICATE' ? 'btn-danger' : 'btn-secondary'}`}
                        onClick={() => setImportFilter('DUPLICATE')}
                      >
                        Repeated ({parsedBatch.summary.duplicates})
                      </button>
                    )}
                  </div>

                  {/* Preview Table */}
                  <div className="table-container" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                    <table className="data-table" style={{ fontSize: '12.5px' }}>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Status</th>
                          <th>Part Number</th>
                          <th>Description</th>
                          <th>Serial Number</th>
                          <th>Target PO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPreviewItems.map((item) => (
                          <tr key={item.id}>
                            <td className="font-mono" style={{ fontSize: '11.5px' }}>#{item.rowNumber}</td>
                            <td>
                              {item.status === 'VALID' && (
                                <span className="badge badge-success" style={{ fontSize: '11px' }}>
                                  Ready
                                </span>
                              )}
                              {item.status === 'EXISTING_INVENTORY' && (
                                <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '11px' }} title="Part already registered in DC inventory - Will update & sync intake record">
                                  In-Stock (Update)
                                </span>
                              )}
                              {item.status === 'NEW_PART' && (
                                <span className="badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '11px' }}>
                                  New Part
                                </span>
                              )}
                              {item.status === 'DUPLICATE' && (
                                <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', fontSize: '11px' }} title="Same serial appears on multiple rows in this spreadsheet">
                                  Repeated in File
                                </span>
                              )}
                              {item.status === 'ERROR' && (
                                <span className="badge badge-danger" style={{ fontSize: '11px' }}>
                                  Error
                                </span>
                              )}
                            </td>
                            <td className="font-mono"><strong>{item.partNumber}</strong></td>
                            <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.description}
                            </td>
                            <td className="font-mono" style={{ fontSize: '11.5px' }}>{item.serialNumber}</td>
                            <td style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                              {item.poNumber || (modalPoId ? purchaseOrders.find(p => p.id === modalPoId)?.po_number : 'Direct Intake')}
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
                onClick={() => setIsImportModalOpen(false)}
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
                  <span>Import & Receive {parsedBatch.summary.valid} Valid Parts</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save Intake Record Modal Dialog */}
      <SaveIntakeRecordModal
        isOpen={isSaveIntakeModalOpen}
        onClose={() => setIsSaveIntakeModalOpen(false)}
        initialUnits={sessionScans.length > 0 ? sessionScans : availableInStockUnits}
        defaultPoId={selectedPoId}
        onSaved={(newRec) => {
          // Clear active session intake history from station view and localStorage
          setSessionScans([]);
          setActiveTableView('SESSION_SCANS');
          try {
            localStorage.removeItem('mdc_recent_scans');
          } catch (e) {
            console.warn('LocalStorage clear error:', e);
          }
          setPartNumberInput('');
          setSerialInput('');
          setScanResult({
            type: 'success',
            message: `[BATCH SAVED & ARCHIVED] Successfully saved batch "${newRec.id}" (${newRec.total_units || newRec.items?.length || 0} parts) to Database. Intake History is cleared and ready for new parts!`
          });
          showToast(`Saved Batch "${newRec.id}". Intake History cleared & station ready!`, 'success');
        }}
      />

      {/* Delete Unit Confirmation Modal */}
      {unitToDelete && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setUnitToDelete(null); }}>
          <div className="modal-content" style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={20} color="#ef4444" />
                <h3 style={{ color: '#fff', fontSize: '17px', margin: 0 }}>Delete Part from Inventory?</h3>
              </div>
              <button
                onClick={() => setUnitToDelete(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '13.5px', color: 'var(--text-main)', margin: '0 0 12px 0' }}>
                Are you sure you want to remove this received part from DC inventory and database?
              </p>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: '12.5px', marginBottom: '12px' }}>
                <div style={{ marginBottom: '6px' }}><strong>Part Number:</strong> <span className="font-mono">{unitToDelete.part_number}</span></div>
                <div style={{ marginBottom: '6px' }}><strong>Description:</strong> {unitToDelete.description}</div>
                <div style={{ marginBottom: '6px' }}><strong>Serial Number:</strong> <span className="font-mono" style={{ color: '#0284c7' }}>{unitToDelete.serial_number}</span></div>
                <div><strong>Scanned At:</strong> {unitToDelete.received_at ? new Date(unitToDelete.received_at).toLocaleString() : 'Recent'}</div>
              </div>

              <p style={{ fontSize: '12px', color: '#ef4444', margin: 0 }}>
                This will permanently delete the unit from DC in-stock inventory and database records.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setUnitToDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleConfirmDeletePart} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Trash2 size={15} />
                <span>Delete Part</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
