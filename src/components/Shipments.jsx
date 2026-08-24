import { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { generatePackingListPDF, printPackingListDirect } from '../utils/pdfGenerator';
import {
  Download,
  Printer,
  CheckCircle,
  Search,
  FileSpreadsheet,
  UploadCloud,
  FileText,
  X,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
  Check,
  Trash2
} from 'lucide-react';
import { parseShipmentManifestFile, downloadShipmentManifestTemplate } from '../utils/excelParser';

export default function Shipments() {
  const {
    shipments,
    sites,
    parts,
    saveShipment,
    deleteShipment,
    batchImportShipments,
    clearAllShipmentsData,
    showToast,
    currentUser,
    canUserDeleteRecord
  } = useApp();

  const [filterStatus, setFilterStatus] = useState('ALL');
  const [search, setSearch] = useState('');

  // Tracking Number Required Prompt Modal State
  const [trackingModalState, setTrackingModalState] = useState(null);

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedBatch, setParsedBatch] = useState(null);
  const fileInputRef = useRef(null);

  // Clear Confirmation Modal State
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  // Safe Print / PDF Request Handler (Requires Tracking Number)
  const handleRequestPrintOrPDF = (shipmentObj, items, siteObj, action = 'pdf') => {
    const trk = String(shipmentObj.tracking_number || '').trim();
    if (!trk) {
      setTrackingModalState({
        shipment: shipmentObj,
        items: items || [],
        site: siteObj || {},
        action,
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

    await saveShipment(updatedShipment);
    showToast(`Tracking number #${cleanTrk} saved!`, 'success');

    if (trackingModalState.action === 'pdf') {
      generatePackingListPDF(updatedShipment, trackingModalState.items, trackingModalState.site);
    } else {
      printPackingListDirect(updatedShipment, trackingModalState.items, trackingModalState.site);
    }

    setTrackingModalState(null);
  };

  const filteredShipments = shipments.filter(s => {
    if (filterStatus !== 'ALL' && s.status !== filterStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const refMatch = s.invoice_ref?.toLowerCase().includes(q) || s.shipment_number?.toLowerCase().includes(q);
      const trackMatch = s.tracking_number?.toLowerCase().includes(q);
      const siteMatch = s.site_name?.toLowerCase().includes(q);
      if (!refMatch && !trackMatch && !siteMatch) return false;
    }
    return true;
  });

  const handleUpdateStatus = (shipment, newStatus) => {
    const updated = {
      ...shipment,
      status: newStatus
    };
    saveShipment(updated);
    showToast(`Shipment ${shipment.invoice_ref || shipment.shipment_number} marked as ${newStatus}`, 'success');
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

  // --- Safe Clear Handling ---
  const handleConfirmClearAll = () => {
    clearAllShipmentsData();
    setIsClearModalOpen(false);
  };

  return (
    <div className="shipments-view">
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h3 style={{ margin: 0 }}>Shipments & Manifest Archive</h3>
              <span className="badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                <Check size={11} style={{ display: 'inline', marginRight: '3px' }} />
                Database Persisted
              </span>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
              Historical packing lists dispatched to branches with tracking numbers and delivery verification ({shipments.length} total)
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
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

            {shipments.length > 0 && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setIsClearModalOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RotateCcw size={13} />
                <span>Clear All Shipments</span>
              </button>
            )}

            <div style={{ position: 'relative', width: '200px' }}>
              <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search ref or tracking..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: '26px', height: '34px', fontSize: '12px', width: '100%' }}
              />
            </div>

            <select
              className="form-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ height: '34px', fontSize: '12px' }}
            >
              <option value="ALL">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="packing">Packing</option>
              <option value="shipped">Shipped</option>
              <option value="received_confirmed">Received Confirmed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Shipment Manifests Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice Ref</th>
                <th>Destination Site</th>
                <th>Shipment Date</th>
                <th>Carrier & Tracking</th>
                <th style={{ textAlign: 'center' }}>Total Units</th>
                <th style={{ textAlign: 'center' }}>Boxes</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredShipments.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    {search ? `No shipments found matching "${search}".` : 'No shipments found. Pack parts or import manifests above.'}
                  </td>
                </tr>
              ) : (
                filteredShipments.map(sh => {
                  const destSite = sites.find(s => s.id === sh.site_id) || {};
                  return (
                    <tr key={sh.id}>
                      <td className="font-mono">
                        <strong>{sh.invoice_ref || sh.shipment_number}</strong>
                      </td>
                      <td>
                        <strong>{destSite.code || 'ASP'}</strong>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {destSite.name || sh.site_name}
                        </div>
                      </td>
                      <td>{sh.shipment_date}</td>
                      <td>
                        <div>{sh.carrier || 'Lite Express'}</div>
                        <div className="font-mono" style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {sh.tracking_number ? `#${sh.tracking_number}` : <span style={{ fontStyle: 'italic', opacity: 0.7 }}>No Tracking #</span>}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                        {sh.items?.length || 0}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                        {sh.total_boxes || 1}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`badge ${
                          sh.status === 'received_confirmed' ? 'badge-success' :
                          sh.status === 'shipped' ? 'badge-primary' : 'badge-neutral'
                        }`}>
                          {sh.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleRequestPrintOrPDF(sh, sh.items, destSite, 'pdf')}
                            title="Download Corporate PDF Manifest (Requires Tracking #)"
                          >
                            <Download size={13} />
                            <span>PDF</span>
                          </button>

                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleRequestPrintOrPDF(sh, sh.items, destSite, 'print')}
                            title="Print Packing List Direct (Requires Tracking #)"
                          >
                            <Printer size={13} />
                          </button>

                          {sh.status === 'shipped' && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleUpdateStatus(sh, 'received_confirmed')}
                              title="Site staff confirms shipment receipt"
                            >
                              <CheckCircle size={13} />
                              <span>Confirm</span>
                            </button>
                          )}

                          {canUserDeleteRecord(sh, currentUser) ? (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                if (window.confirm(`Delete shipment "${sh.invoice_ref || sh.shipment_number}"? This will return its parts to DC stock.`)) {
                                  deleteShipment(sh.id);
                                }
                              }}
                              title="Delete Shipment"
                              style={{ background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          ) : (
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled
                              style={{ opacity: 0.4, cursor: 'not-allowed' }}
                              title={`Only ${sh.prepared_by_name || sh.saved_by_name || 'the creator'} can delete this shipment`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Safety Confirmation Modal: Clear All Shipments --- */}
      {isClearModalOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsClearModalOpen(false); }}>
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ background: '#991b1b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} color="#fff" />
                <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>Clear All Shipment Manifests?</h3>
              </div>
              <button onClick={() => setIsClearModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ fontSize: '13.5px', color: 'var(--text-main)', marginBottom: '12px' }}>
                Are you sure you want to remove all <strong>{shipments.length} shipment records</strong>?
              </p>
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: '12px', color: '#991b1b' }}>
                <strong>Safety Feature:</strong> Any units currently packed in these shipments will be safely restored back to <strong>In-Stock DC inventory</strong>.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsClearModalOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleConfirmClearAll}>
                Yes, Clear All Shipments
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
                    Manifest {trackingModalState.shipment?.invoice_ref || trackingModalState.shipment?.shipment_number || 'Shipment'}
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
    </div>
  );
}
