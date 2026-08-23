import { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { generatePackingListPDF, printPackingListDirect } from '../utils/pdfGenerator';
import { calculateWeeklySplit } from '../utils/allocationEngine';
import {
  PackageCheck,
  Printer,
  Download,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Zap,
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
  Calendar
} from 'lucide-react';
import { parseScanOutPartsFile, downloadScanOutTemplate } from '../utils/excelParser';

export default function ScanOutPacking() {
  const {
    sites,
    inventoryUnits,
    allocations,
    shipments,
    saveShipment,
    deleteShipment,
    addScanOutUnit,
    removeScanOutUnit,
    batchAddScanOutUnits,
    clearShipmentDraftItems,
    currentUser,
    showToast
  } = useApp();

  const serviceSites = sites.filter(s => !s.is_dc);
  const [selectedSiteId, setSelectedSiteId] = useState(serviceSites[0]?.id || '');
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [boxNumber, setBoxNumber] = useState(1);
  const [inspectShipmentModal, setInspectShipmentModal] = useState(null);

  // Active Shipment Draft with LocalStorage persistence
  const [currentShipment, setCurrentShipment] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_active_pack_draft');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id) {
          return {
            ...parsed,
            prepared_by_name: currentUser?.fullName || parsed.prepared_by_name || ''
          };
        }
      }
    } catch (e) {
      console.warn('Could not read mdc_active_pack_draft:', e);
    }
    const existing = shipments.find(s => s.site_id === serviceSites[0]?.id && s.status === 'draft');
    if (existing) {
      return {
        ...existing,
        prepared_by_name: currentUser?.fullName || existing.prepared_by_name || ''
      };
    }
    return {
      id: `ship-${Date.now()}`,
      shipment_number: `SHIP-202608-${String(shipments.length + 1).padStart(3, '0')}`,
      invoice_ref: `DCMSPIOWNED#20260808G`,
      site_id: serviceSites[0]?.id,
      week_number: 1,
      shipment_date: new Date().toLocaleDateString('en-US'),
      carrier: 'Lite Express',
      tracking_number: '20227258',
      total_boxes: 1,
      status: 'draft',
      prepared_by_name: currentUser?.fullName || '',
      verified_by_name: 'Zhon Manaois',
      receiving_signature: serviceSites[0]?.code || 'ASP NPM',
      remarks: 'KGB PARTS',
      items: []
    };
  });

  // Automatically synchronize Prepared By with currently logged-in user's full name
  useEffect(() => {
    if (currentUser?.fullName) {
      setCurrentShipment(prev => ({
        ...prev,
        prepared_by_name: currentUser.fullName
      }));
    }
  }, [currentUser?.fullName, currentUser?.id]);

  // Keep active draft synced to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem('mdc_active_pack_draft', JSON.stringify(currentShipment));
    } catch (e) {
      console.warn('Could not persist pack draft:', e);
    }
  }, [currentShipment]);

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

  const selectedSite = useMemo(() => {
    return sites.find(s => s.id === selectedSiteId) || serviceSites[0] || {};
  }, [sites, selectedSiteId, serviceSites]);

  const branchAllocationProgress = useMemo(() => {
    if (!allocations || allocations.length === 0 || !selectedSite?.id) return null;
    let targetWeekTotal = 0;
    allocations.forEach(alloc => {
      const siteQty = alloc.site_quantities?.[selectedSite.id] ?? alloc.site_quantities?.[selectedSite.code] ?? 0;
      if (siteQty > 0) {
        const split = calculateWeeklySplit(siteQty, 0, 0);
        const wQty = split[`w${selectedWeek}_qty`] || 0;
        targetWeekTotal += wQty;
      }
    });
    const packedTotal = (currentShipment?.items || []).length;
    return {
      targetWeekTotal,
      packedTotal,
      pct: targetWeekTotal > 0 ? Math.min(100, Math.round((packedTotal / targetWeekTotal) * 100)) : 0
    };
  }, [allocations, selectedSite, selectedWeek, currentShipment]);

  // Auto-focus Part Number input on mount
  useEffect(() => {
    pnInputRef.current?.focus();
  }, []);

  // Update shipment when site changes
  const handleSiteChange = (newSiteId) => {
    setSelectedSiteId(newSiteId);
    const siteObj = sites.find(s => s.id === newSiteId);
    setCurrentShipment(prev => ({
      ...prev,
      site_id: newSiteId,
      receiving_signature: siteObj?.code || 'ASP NPM'
    }));
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

      setCurrentShipment(prev => ({
        ...prev,
        items: [...(prev.items || []), res.item]
      }));

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

  // Quick simulator for testing pack-out
  const availableStockUnits = inventoryUnits.filter(u => u.status === 'in_stock');
  const handleSimulatePack = (unit) => {
    setPartNumberInput(unit.part_number);
    setSerialInput(unit.serial_number);
    setTimeout(() => {
      const res = addScanOutUnit({
        shipmentId: currentShipment.id,
        siteId: selectedSiteId,
        partNumber: unit.part_number,
        serialNumber: unit.serial_number,
        boxNumber: boxNumber
      });
      if (res.success) {
        setScanResult({
          type: 'success',
          message: `[PACKED] ${res.item.description} (#${res.item.serial_number})`
        });
        setCurrentShipment(prev => ({
          ...prev,
          items: [...(prev.items || []), res.item]
        }));
      } else {
        setScanResult({ type: 'error', message: res.error });
      }
    }, 150);
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

    const res = batchAddScanOutUnits({
      shipmentId: currentShipment.id,
      siteId: selectedSiteId,
      items: validItems
    });

    if (res.success) {
      setCurrentShipment(prev => ({
        ...prev,
        items: [...(prev.items || []), ...res.items]
      }));

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
    const res = removeScanOutUnit({
      shipmentId: currentShipment.id,
      serialNumber: serialNumber
    });
    if (res.success) {
      setCurrentShipment(prev => ({
        ...prev,
        items: (prev.items || []).filter(it => it.serial_number !== serialNumber)
      }));
    }
  };

  // --- Safe Clear / Unpack Handling (Clears ONLY active draft, preserves all database history below) ---
  const handleConfirmClearDraft = () => {
    // If the active draft has items not yet saved to the database, restore them to DC stock
    if (currentShipment.items && currentShipment.items.length > 0) {
      const isAlreadySaved = shipments.some(s => s.id === currentShipment.id && (s.status === 'saved' || s.status === 'shipped'));
      if (!isAlreadySaved) {
        clearShipmentDraftItems(currentShipment.id, currentShipment.items);
      }
    }

    try {
      localStorage.removeItem('mdc_active_pack_draft');
    } catch (e) {}

    // Generate fresh new draft so the user can start a new packing list for another site
    const newDraftId = `ship-${Date.now()}`;
    const newInvoiceRef = `DCMSPIOWNED#${Date.now().toString().slice(-6)}G`;

    setCurrentShipment({
      id: newDraftId,
      shipment_number: `SHIP-202608-${String(shipments.length + 1).padStart(3, '0')}`,
      invoice_ref: newInvoiceRef,
      site_id: selectedSiteId,
      week_number: selectedWeek,
      shipment_date: new Date().toLocaleDateString('en-US'),
      carrier: 'Lite Express',
      tracking_number: '20227258',
      total_boxes: 1,
      status: 'draft',
      prepared_by_name: currentUser?.fullName || '',
      verified_by_name: 'Zhon Manaois',
      receiving_signature: selectedSite?.code || 'ASP NPM',
      remarks: 'KGB PARTS',
      items: []
    });

    setIsClearModalOpen(false);
    setScanResult(null);
    showToast('Active packing list cleared. Ready to create a new packing list for another site.', 'info');
  };

  // --- Combined Action: Save to Database & Finalize Packing List ---
  const handleFinalizeShipment = () => {
    if (!currentShipment.items || currentShipment.items.length === 0) {
      showToast('Cannot finalize an empty packing list. Please add parts first.', 'error');
      return;
    }

    try {
      const finalized = {
        ...currentShipment,
        id: currentShipment.id || `ship-${Date.now()}`,
        status: 'shipped',
        created_at: currentShipment.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // 1. Permanently save to Database History and Cloud DB
      saveShipment(finalized);

      // 2. Automatically generate and download formatted corporate PDF
      try {
        generatePackingListPDF(finalized, finalized.items || [], selectedSite);
      } catch (pdfErr) {
        console.warn('PDF generation note:', pdfErr);
      }
      
      // 3. Reset draft from localStorage and initialize fresh workstation for next shipment
      try {
        localStorage.removeItem('mdc_active_pack_draft');
      } catch (e) {}

      const nextShipmentNumber = `SHIP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(shipments.length + 2).padStart(3, '0')}`;
      const nextInvoiceRef = `DCMSPIOWNED#${Date.now().toString().slice(-6)}G`;

      setCurrentShipment({
        id: `ship-${Date.now()}`,
        shipment_number: nextShipmentNumber,
        invoice_ref: nextInvoiceRef,
        site_id: selectedSiteId,
        week_number: selectedWeek,
        shipment_date: new Date().toLocaleDateString('en-US'),
        carrier: 'Lite Express',
        tracking_number: '20227258',
        total_boxes: 1,
        status: 'draft',
        prepared_by_name: currentUser?.fullName || '',
        verified_by_name: 'Zhon Manaois',
        receiving_signature: selectedSite?.code || 'ASP NPM',
        remarks: 'KGB PARTS',
        items: []
      });

      setScanResult(null);
      showToast(`Finalized & Saved Packing List ${finalized.invoice_ref} (${finalized.items.length} parts) to Database! Station ready for next shipment.`, 'success');
    } catch (err) {
      console.error('Finalize shipment error:', err);
      showToast('Error saving and finalizing packing list: ' + err.message, 'error');
    }
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

  return (
    <div className="scan-out-packing-view" style={{ maxWidth: '1150px', margin: '0 auto' }}>
      {/* Scanner & Manifest Config Banner */}
      <div className="scanner-hero" style={{ marginBottom: '24px' }}>
        <div className="scanner-hero-header">
          <div>
            <h2 style={{ color: '#fff', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PackageCheck size={22} color="#38bdf8" />
              <span>Pack Scan-Out & Packing List Generator</span>
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '12.5px', marginTop: '2px' }}>
              Serialized Verification against DC Stock • Batch XLSX/CSV Scan-Out • Real-Time Database Sync
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsImportModalOpen(true)}
              style={{
                background: '#1e293b',
                color: '#38bdf8',
                borderColor: '#38bdf8',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <FileSpreadsheet size={16} />
              <span>Import XLSX / CSV</span>
            </button>

            {currentShipment.items && currentShipment.items.length > 0 && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setIsClearModalOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RotateCcw size={14} />
                <span>Clear Draft ({currentShipment.items.length})</span>
              </button>
            )}

            <div className="scanner-status-indicator">
              <div className="pulse-dot" />
              <span>HID Scanner Ready</span>
            </div>
          </div>
        </div>

        {/* Site & Batch Selectors */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label className="scanner-field-label">Destination Service Site</label>
            <select
              className="form-select"
              style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155' }}
              value={selectedSiteId}
              onChange={(e) => handleSiteChange(e.target.value)}
            >
              {serviceSites.map(s => (
                <option key={s.id} value={s.id}>
                  {s.code} - {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="scanner-field-label">Allocation Week</label>
            <select
              className="form-select"
              style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155' }}
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(parseInt(e.target.value))}
            >
              <option value={1}>Week 1</option>
              <option value={2}>Week 2</option>
              <option value={3}>Week 3</option>
              <option value={4}>Week 4</option>
            </select>
          </div>

          <div>
            <label className="scanner-field-label">Current Box #</label>
            <select
              className="form-select"
              style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155' }}
              value={boxNumber}
              onChange={(e) => setBoxNumber(parseInt(e.target.value))}
            >
              <option value={1}>Box 1</option>
              <option value={2}>Box 2</option>
              <option value={3}>Box 3</option>
              <option value={4}>Box 4</option>
            </select>
          </div>

          <div>
            <label className="scanner-field-label">Carrier</label>
            <input
              type="text"
              className="form-input"
              style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155' }}
              value={currentShipment.carrier ?? 'Lite Express'}
              placeholder="e.g. Lite Express"
              onChange={(e) => setCurrentShipment(prev => ({ ...prev, carrier: e.target.value }))}
            />
          </div>
        </div>

        {/* Branch Allocated Quota vs Packed Progress Banner */}
        {branchAllocationProgress && branchAllocationProgress.targetWeekTotal > 0 && (
          <div
            style={{
              background: '#0a0f1d',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PackageCheck size={16} color="#38bdf8" />
                <span style={{ fontSize: '13px', color: '#e2e8f0' }}>
                  {selectedSite?.name} • <strong>Week {selectedWeek} Allocation Target:</strong> {branchAllocationProgress.targetWeekTotal} units
                </span>
              </div>
              <span style={{ fontSize: '12.5px', fontWeight: 700, color: branchAllocationProgress.pct >= 100 ? '#10b981' : '#38bdf8' }}>
                {branchAllocationProgress.packedTotal} / {branchAllocationProgress.targetWeekTotal} units ({branchAllocationProgress.pct}%)
              </span>
            </div>
            <div style={{ width: '100%', height: '6px', background: '#1e293b', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${branchAllocationProgress.pct}%`,
                  height: '100%',
                  background: branchAllocationProgress.pct >= 100 ? '#10b981' : '#0284c7',
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
          </div>
        )}

        {/* Editable Manifest Details (Invoice Ref, Tracking, Verified By, Prepared By) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: '14px', marginBottom: '20px' }}>
          <div>
            <label className="scanner-field-label">Invoice Reference (Editable)</label>
            <input
              type="text"
              className="form-input font-mono"
              style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155', fontSize: '12px' }}
              value={currentShipment.invoice_ref ?? 'DCMSPIOWNED#20260808G'}
              placeholder="e.g. DCMSPIOWNED#20260808G"
              onChange={(e) => setCurrentShipment(prev => ({ ...prev, invoice_ref: e.target.value }))}
            />
          </div>

          <div>
            <label className="scanner-field-label">Tracking Number (Editable)</label>
            <input
              type="text"
              className="form-input font-mono"
              style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155', fontSize: '12px' }}
              value={currentShipment.tracking_number ?? '20227258'}
              placeholder="e.g. 20227258"
              onChange={(e) => setCurrentShipment(prev => ({ ...prev, tracking_number: e.target.value }))}
            />
          </div>

          <div>
            <label className="scanner-field-label">Verified By (Editable)</label>
            <input
              type="text"
              className="form-input"
              style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155', fontSize: '12px' }}
              value={currentShipment.verified_by_name ?? 'Zhon Manaois'}
              placeholder="e.g. Zhon Manaois"
              onChange={(e) => setCurrentShipment(prev => ({ ...prev, verified_by_name: e.target.value }))}
            />
          </div>

          <div>
            <label className="scanner-field-label">Prepared By (Editable)</label>
            <input
              type="text"
              className="form-input"
              style={{ width: '100%', background: '#1e293b', color: '#fff', borderColor: '#334155', fontSize: '12px' }}
              value={currentShipment.prepared_by_name ?? (currentUser?.fullName || '')}
              placeholder={currentUser?.fullName || "e.g. User Full Name"}
              onChange={(e) => setCurrentShipment(prev => ({ ...prev, prepared_by_name: e.target.value }))}
            />
          </div>
        </div>

        {/* HID Scan Inputs */}
        <div className="scan-input-grid">
          <div>
            <label className="scanner-field-label">1. Part Number (P/N)</label>
            <input
              ref={pnInputRef}
              type="text"
              className="scanner-input"
              placeholder="e.g. 661-21991"
              value={partNumberInput}
              onChange={(e) => setPartNumberInput(e.target.value)}
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
              onChange={(e) => setSerialInput(e.target.value)}
              onKeyDown={handleSerialKeyDown}
            />
          </div>

          <div>
            <button className="btn btn-primary btn-lg" onClick={executePackScan} style={{ height: '54px' }}>
              <span>Pack Unit</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
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

      {/* Simulator for Available DC Stock */}
      <div className="card" style={{ marginBottom: '24px', background: '#f8fafc' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Zap size={16} color="var(--primary)" />
            <strong style={{ fontSize: '13px' }}>Available Stock Units in DC ({availableStockUnits.length} in-stock)</strong>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Click to test single unit packing
          </span>
        </div>

        {availableStockUnits.length === 0 ? (
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', padding: '8px 0' }}>
            No units in DC stock. Receive or import parts in the Receive Scan-In page first.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', maxHeight: '90px', overflowY: 'auto' }}>
            {availableStockUnits.slice(0, 10).map(unit => (
              <button
                key={unit.id}
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '11.5px', background: '#fff' }}
                onClick={() => handleSimulatePack(unit)}
              >
                <span>+ {unit.part_number} ({unit.serial_number.slice(0, 8)}...)</span>
              </button>
            ))}
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
              onClick={() => printPackingListDirect(currentShipment, currentShipment.items, selectedSite)}
              style={{ height: '34px' }}
              title="Preview and print packing list"
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
                src="/mobilecare_logo.png"
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
                  value={currentShipment.invoice_ref ?? `DCMSPIOWNED#20260818N`}
                  placeholder="DCMSPIOWNED#20260818N"
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
                <span style={{ minWidth: '40px', textAlign: 'right', fontWeight: 700, paddingRight: '6px' }}>{boxNumber}</span>
              </div>
              <div className="packing-invoice-meta-row">
                <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>CARRIER:</strong>
                <input
                  type="text"
                  className="packing-inline-input"
                  style={{ width: '130px' }}
                  value={currentShipment.carrier ?? 'Lalamove'}
                  placeholder="Lalamove"
                  title="Click to edit Carrier"
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, carrier: e.target.value }))}
                />
              </div>
              <div className="packing-invoice-meta-row">
                <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>TRACKING NUMBER:</strong>
                <input
                  type="text"
                  className="packing-inline-input font-mono"
                  style={{ width: '140px' }}
                  value={currentShipment.tracking_number ?? '20227303'}
                  placeholder="20227303"
                  title="Click to edit Tracking Number"
                  onChange={(e) => setCurrentShipment(prev => ({ ...prev, tracking_number: e.target.value }))}
                />
              </div>
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
                  filteredManifestItems.map((it, i) => (
                    <tr key={i} className={i % 2 === 1 ? 'packing-table-row-alt' : ''}>
                      <td style={{ textAlign: 'center', color: '#64748b' }}>{i + 1}</td>
                      <td style={{ textAlign: 'center', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{it.part_number}</td>
                      <td style={{ textAlign: 'left' }}>{it.description}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', letterSpacing: '0.02em' }}>{it.serial_number}</td>
                      <td style={{ textAlign: 'center' }}>{it.box_number || 1}</td>
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
                  ))
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

            <div className="packing-totals-box">
              <div className="packing-total-row">
                <div className="packing-total-label">TOTAL QTY</div>
                <div className="packing-total-val">{currentShipment.items?.length || 0}</div>
              </div>
              <div className="packing-total-row">
                <div className="packing-total-label">TOTAL BOXES</div>
                <div className="packing-total-val">{boxNumber}</div>
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
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
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
                  <th>Carrier & Tracking</th>
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
                          <div>{s.carrier || 'Lite Express'}</div>
                          <span className="font-mono" style={{ fontSize: '11px', color: '#64748b' }}>#{s.tracking_number || 'N/A'}</span>
                        </td>
                        <td style={{ fontSize: '11.5px', color: '#475569' }}>
                          <div>By: <strong>{s.prepared_by_name || 'Warehouse Staff'}</strong></div>
                          <div>Ver: {s.verified_by_name || 'Zhon Manaois'}</div>
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
                              onClick={() => generatePackingListPDF(s, s.items || [], destSite)}
                              title="Download PDF"
                              style={{ padding: '4px 8px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <Download size={12} />
                              <span>PDF</span>
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => printPackingListDirect(s, s.items || [], destSite)}
                              title="Print Manifest"
                              style={{ padding: '4px 8px', fontSize: '11.5px' }}
                            >
                              <Printer size={12} />
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                if (window.confirm(`Delete saved manifest "${s.invoice_ref || s.shipment_number}"? This will return its parts to DC stock.`)) {
                                  deleteShipment(s.id);
                                }
                              }}
                              title="Permanently Delete Manifest from Database"
                              style={{ padding: '4px 8px', fontSize: '11.5px', background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5' }}
                            >
                              <Trash2 size={12} />
                            </button>
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
                Carrier: <strong>{inspectShipmentModal.carrier || 'Lite Express'}</strong> • Tracking: <span className="font-mono">#{inspectShipmentModal.tracking_number || 'N/A'}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    const dest = sites.find(s => s.id === inspectShipmentModal.site_id) || {};
                    generatePackingListPDF(inspectShipmentModal, inspectShipmentModal.items || [], dest);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} />
                  <span>Download PDF</span>
                </button>
                <button className="btn btn-primary" onClick={() => setInspectShipmentModal(null)}>
                  Close
                </button>
              </div>
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
    </div>
  );
}
