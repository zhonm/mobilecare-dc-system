import { useState, useRef, useEffect } from 'react';
import {
  PackageCheck,
  Download,
  UploadCloud,
  FileText,
  CheckCircle2,
  Check,
  Copy,
  X,
  Loader2,
  ShieldCheck,
  FolderCheck
} from 'lucide-react';
import { generatePackingListPDF } from '../utils/pdfGenerator';
import { uploadPmgSignedPackingListToDrive, resolvePmgSiteFolderName } from '../services/driveAutoSyncService';
import { getTodayDateString, getShipmentCourierDisplay, getShipmentRiderName, healShipmentItem, resolveSiteBranchCode } from '../utils/shipmentHelpers';

export default function ConfirmReceiveModal({
  isOpen,
  shipment,
  site,
  shipments = [],
  currentUser,
  supervisorSettings,
  onClose,
  onConfirmed,
  showToast
}) {
  const initialBranch = resolveSiteBranchCode(site, shipment);
  const [receivingBranch, setReceivingBranch] = useState(initialBranch);
  const defaultReceiver = currentUser?.fullName || currentUser?.name || '';
  const [receivedByName, setReceivedByName] = useState(defaultReceiver);
  const [receivedDate, setReceivedDate] = useState(getTodayDateString());
  const [receivedCondition, setReceivedCondition] = useState('Good Condition (All parts intact & verified)');
  const [receivingNotes, setReceivingNotes] = useState('');
  
  const [hasDownloadedPL, setHasDownloadedPL] = useState(false);
  const [signedFile, setSignedFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgressMsg, setUploadProgressMsg] = useState('');
  const [copiedWaybill, setCopiedWaybill] = useState(null);

  const fileInputRef = useRef(null);

  // Synchronize state whenever modal opens or active shipment/site changes
  useEffect(() => {
    if (!isOpen || !shipment) return;

    const resolvedBranch = resolveSiteBranchCode(site, shipment);
    setReceivingBranch(resolvedBranch);

    const isSuper = currentUser?.role === 'superadmin' || currentUser?.isSuperAdmin;
    const autoReceiver = isSuper ? '' : (currentUser?.fullName || currentUser?.name || '');
    setReceivedByName(autoReceiver);

    setReceivedDate(getTodayDateString());
    setReceivedCondition('Good Condition (All parts intact & verified)');
    setReceivingNotes('');
    setHasDownloadedPL(false);
    setSignedFile(null);
  }, [
    isOpen,
    shipment,
    site,
    currentUser?.fullName,
    currentUser?.name,
    currentUser?.role,
    currentUser?.isSuperAdmin
  ]);

  if (!isOpen || !shipment) return null;

  const targetSiteName = site?.name || shipment?.site_name || 'Destination Branch';
  const siteFolderName = resolvePmgSiteFolderName(site || shipment?.site_name || shipment?.site_id);
  const invoiceRef = shipment?.invoice_ref || shipment?.shipment_number || 'Shipment';
  const trackingNum = shipment?.tracking_number || shipment?.booking_id || '';

  const cleanReceiver = String(receivedByName || '').trim();
  const cleanBranch = String(receivingBranch || '').trim();
  const computedSignature = cleanReceiver 
    ? (cleanBranch && !cleanReceiver.toLowerCase().includes(cleanBranch.toLowerCase()) ? `${cleanReceiver} (${cleanBranch})` : cleanReceiver)
    : cleanBranch;

  const handleCopyWaybill = (rawTracking) => {
    if (!rawTracking) return;
    const clean = String(rawTracking).replace(/^#\s*/, '').trim();
    if (!clean) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(clean);
      }
    } catch (_) {}
    setCopiedWaybill(clean);
    setTimeout(() => setCopiedWaybill(null), 2500);
  };

  const handleDownloadPL = () => {
    try {
      const targetShipment = (shipments || []).find(s => s.id === shipment?.id) || shipment;
      const rawItems = (targetShipment?.items?.length ? targetShipment.items : shipment?.items) || [];
      const healedItems = rawItems.map(it => healShipmentItem(it));
      const resolvedRider = getShipmentRiderName(targetShipment, shipments || []) || getShipmentRiderName(shipment, shipments || []) || targetShipment?.pickup_by_name || shipment?.pickup_by_name || targetShipment?.courier_name || shipment?.courier_name || '';
      generatePackingListPDF(targetShipment, healedItems, site || {}, {
        supervisorName: supervisorSettings?.supervisor_name || targetShipment?.verified_by_name || 'Anjo Alcazar',
        supervisorTitle: supervisorSettings?.supervisor_title || 'MDC Supervisor of DC',
        guardOnDuty: targetShipment?.guard_on_duty || supervisorSettings?.guard_on_duty,
        pickupDate: targetShipment?.pickup_date || targetShipment?.shipment_date,
        pickupByName: resolvedRider,
        allShipments: shipments || [],
        receivingSignature: computedSignature,
        receivedByName: cleanReceiver,
        receivingBranch: cleanBranch,
        includeDeclarationForm: false
      });
      setHasDownloadedPL(true);
      showToast?.(`Downloaded Packing List for ${invoiceRef} with signature: ${computedSignature || cleanBranch}`, 'info');
    } catch (err) {
      console.error('Failed to download PL:', err);
      showToast?.('Error downloading Packing List PDF: ' + err.message, 'error');
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type (PDF or Image)
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    const validExts = ['.pdf', '.jpg', '.jpeg', '.png'];
    const hasValidExt = validExts.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!validTypes.includes(file.type) && !hasValidExt) {
      showToast?.('Please upload a valid PDF document or image file (.pdf, .jpg, .png).', 'warning');
      return;
    }

    // Validate size (max 25MB)
    if (file.size > 25 * 1024 * 1024) {
      showToast?.('File is too large. Maximum file size is 25MB.', 'warning');
      return;
    }

    setSignedFile(file);
    showToast?.(`Attached signed PL: ${file.name}`, 'success');
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();

    if (!cleanReceiver) {
      showToast?.('Please enter the name of the staff member receiving and signing the package.', 'warning');
      return;
    }

    if (!signedFile) {
      showToast?.('Signed Packing List file upload is required before confirming receipt.', 'warning');
      return;
    }

    setIsSubmitting(true);
    setUploadProgressMsg(`Uploading signed PL to Google Drive (DC- MSPI- PACKING LIST / ${siteFolderName})...`);

    try {
      // 1. Upload Signed PL to Google Drive under "DC- MSPI- PACKING LIST" / [SITE]
      let driveResult = null;
      try {
        driveResult = await uploadPmgSignedPackingListToDrive({
          file: signedFile,
          shipment,
          site,
          receivedByName: cleanReceiver
        });
      } catch (uploadErr) {
        console.warn('[ConfirmReceiveModal] Google Drive upload error:', uploadErr);
        driveResult = { success: false, error: uploadErr.message };
      }

      setUploadProgressMsg('Confirming package receipt and updating branch inventory...');

      const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
      const invoiceRef = String(shipment.invoice_ref || shipment.shipment_number || 'PL').replace(/[/\\:*?"<>|]/g, '_');
      const fallbackFilename = `Signed_PackingList_${invoiceRef}_${timestampStr}.pdf`;

      // 2. Complete confirmation with drive links and signature details
      await onConfirmed({
        receivedByName: cleanReceiver,
        receivingBranch: cleanBranch,
        receivingSignature: computedSignature,
        receivedDate,
        receivedCondition,
        receivingNotes,
        signedPlDriveLink: driveResult?.success ? driveResult.webViewLink : null,
        signedPlFileId: driveResult?.success ? driveResult.fileId : null,
        signedPlFilename: driveResult?.success ? driveResult.filename : (signedFile?.name || fallbackFilename),
        siteFolder: driveResult?.success ? driveResult.siteFolder : siteFolderName
      });

      if (driveResult?.success) {
        showToast?.(`Receipt confirmed! Signed PL stored in Google Drive under DC- MSPI- PACKING LIST / ${driveResult.siteFolder}`, 'success');
      } else {
        showToast?.(`Receipt confirmed & stock updated! (Note: Google Drive notice: ${driveResult?.error || 'Signed PL recorded locally'})`, 'info');
      }
      onClose();
    } catch (err) {
      console.error('Confirmation error:', err);
      showToast?.('Failed to complete confirmation: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
      setUploadProgressMsg('');
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 9999 }} onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: '620px', width: '95%', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
        
        {/* Header */}
        <div className="modal-header" style={{ background: 'linear-gradient(135deg, #065f46 0%, #047857 100%)', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: 'rgba(255,255,255,0.2)', padding: '8px', borderRadius: '8px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PackageCheck size={22} />
            </div>
            <div>
              <h3 style={{ color: '#fff', fontSize: '16.5px', fontWeight: 700, margin: 0 }}>
                Confirm Site Package Receipt
              </h3>
              <p style={{ color: '#a7f3d0', fontSize: '12px', margin: '2px 0 0 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>Site:</span> <strong>{targetSiteName}</strong>
                <span style={{ opacity: 0.6 }}>•</span>
                <span style={{ background: 'rgba(255,255,255,0.2)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>Folder: {siteFolderName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{ background: 'transparent', border: 'none', color: '#a7f3d0', cursor: isSubmitting ? 'not-allowed' : 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '74vh', overflowY: 'auto', padding: '20px' }}>
            
            {/* Manifest Summary Card */}
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12.5px', color: '#065f46', fontWeight: 700 }}>
                  Invoice Ref: {invoiceRef}
                </span>
                <span style={{ fontSize: '12px', color: '#065f46', fontWeight: 700, background: '#d1fae5', padding: '2px 8px', borderRadius: '4px' }}>
                  {shipment?.items?.length || 0} Units ({shipment?.total_boxes || 1} Box)
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#047857' }}>
                Courier: <strong>{getShipmentCourierDisplay(shipment)}</strong> • Waybill: <strong
                  className="font-mono select-all"
                  style={{
                    fontSize: '12.5px',
                    color: '#065f46',
                    cursor: trackingNum ? 'pointer' : 'default',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    background: copiedWaybill ? '#a7f3d0' : 'transparent',
                    transition: 'background-color 0.15s ease'
                  }}
                  title={trackingNum ? "Click to copy Waybill number" : ""}
                  onClick={() => handleCopyWaybill(trackingNum)}
                >
                  #{trackingNum || 'N/A'}
                  {trackingNum && (
                    copiedWaybill ? (
                      <Check size={12} strokeWidth={2.5} color="#15803d" />
                    ) : (
                      <Copy size={11} color="#047857" style={{ opacity: 0.7 }} />
                    )
                  )}
                </strong>
              </div>
            </div>

            {/* STEP 1: Receiving Branch & Signatory Details */}
            <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#0284c7', color: '#fff', width: '20px', height: '20px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>1</span>
                <span>Receiving Branch &amp; Signatory Details</span>
              </div>
              
              <div className="modal-form-grid-2" style={{ marginBottom: '10px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                    Receiving Branch (ASP, ABR, etc.)
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. APP ASP ABR"
                    value={receivingBranch}
                    onChange={(e) => setReceivingBranch(e.target.value)}
                    style={{ fontSize: '12.5px', height: '36px', fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                    Received By (Staff Name) <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter your full name"
                    value={receivedByName}
                    onChange={(e) => setReceivedByName(e.target.value)}
                    required
                    style={{ fontSize: '12.5px', height: '36px' }}
                  />
                </div>
              </div>

              <div className="modal-form-grid-2" style={{ marginBottom: '10px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                    Date of Receipt <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={receivedDate}
                    onChange={(e) => setReceivedDate(e.target.value)}
                    required
                    style={{ fontSize: '12.5px', height: '36px' }}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                    Package &amp; Parts Condition Status
                  </label>
                  <select
                    className="form-select"
                    value={receivedCondition}
                    onChange={(e) => setReceivedCondition(e.target.value)}
                    style={{ fontSize: '12.5px', height: '36px' }}
                  >
                    <option value="Good Condition (All parts intact & verified)">Good Condition (All parts intact &amp; verified)</option>
                    <option value="Minor box wear, all parts complete">Minor box wear, all parts complete</option>
                    <option value="Discrepancy / damage noted for inspection">Discrepancy / damage noted for inspection</option>
                  </select>
                </div>
              </div>

              {/* Live Signature Preview Badge */}
              <div style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '6px',
                padding: '7px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '6px'
              }}>
                <div style={{ fontSize: '11.5px', color: '#166534' }}>
                  <span>Printed on Packing List Signature: </span>
                  <strong style={{ color: '#14532d', fontFamily: 'var(--font-mono)' }}>
                    {computedSignature || cleanBranch || 'Receiving Staff Name'}
                  </strong>
                </div>
                <span style={{ fontSize: '10.5px', color: '#15803d', background: '#dcfce7', padding: '1px 7px', borderRadius: '4px', fontWeight: 600 }}>
                  Auto-updated on PL
                </span>
              </div>
            </div>

            {/* STEP 2: Download Official Packing List */}
            <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ background: '#0284c7', color: '#fff', width: '20px', height: '20px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>2</span>
                    <span>Download Packing List (PL)</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    Generates the official PDF displaying your name as the receiving signatory.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={handleDownloadPL}
                  style={{
                    background: hasDownloadedPL ? '#f0fdf4' : '#0284c7',
                    color: hasDownloadedPL ? '#15803d' : '#ffffff',
                    border: hasDownloadedPL ? '1.5px solid #86efac' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 700,
                    fontSize: '12.5px',
                    padding: '7px 14px',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  {hasDownloadedPL ? <CheckCircle2 size={15} color="#16a34a" /> : <Download size={15} />}
                  <span>{hasDownloadedPL ? 'PL Downloaded' : 'Download PL (PDF)'}</span>
                </button>
              </div>
            </div>

            {/* STEP 3: Re-upload Signed Packing List */}
            <div style={{
              background: signedFile ? '#f0fdf4' : '#fffbeb',
              border: `2px dashed ${signedFile ? '#22c55e' : '#f59e0b'}`,
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px',
              transition: 'all 0.2s ease'
            }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: signedFile ? '#166534' : '#92400e', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: signedFile ? '#16a34a' : '#d97706', color: '#fff', width: '20px', height: '20px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>3</span>
                <span>Upload Signed Packing List (Required) <span style={{ color: '#dc2626' }}>*</span></span>
              </div>
              <p style={{ fontSize: '12px', color: signedFile ? '#15803d' : '#78350f', margin: '0 0 12px 0' }}>
                Re-upload the signed PL document to complete package confirmation. It will be stored in Google Drive: <strong>DC- MSPI- PACKING LIST / {siteFolderName}</strong>.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/png,image/jpeg,image/jpg"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />

              {!signedFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '16px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#0284c7'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = '#cbd5e1'}
                >
                  <UploadCloud size={28} color="#d97706" style={{ margin: '0 auto 6px auto', display: 'block' }} />
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                    Click to select signed Packing List file
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                    Supports PDF documents or scanned photos (.pdf, .jpg, .png up to 25MB)
                  </div>
                </div>
              ) : (
                <div style={{
                  background: '#ffffff',
                  border: '1px solid #86efac',
                  borderRadius: '6px',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div style={{ background: '#dcfce7', padding: '8px', borderRadius: '6px', color: '#16a34a', flexShrink: 0 }}>
                      <FileText size={20} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {signedFile.name}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#15803d', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{formatFileSize(signedFile.size)}</span>
                        <span>•</span>
                        <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <FolderCheck size={12} /> Target: DC- MSPI- PACKING LIST / {siteFolderName}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSignedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    style={{ background: '#f1f5f9', border: 'none', color: '#64748b', padding: '6px', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}
                    title="Remove file"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Optional Remarks */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: '12px' }}>
                Receipt Remarks (Optional)
              </label>
              <textarea
                className="form-input"
                rows={2}
                placeholder="e.g. Received intact, verified all serial numbers matched physical units."
                value={receivingNotes}
                onChange={(e) => setReceivingNotes(e.target.value)}
                style={{ fontSize: '12px', resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="modal-footer" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '11.5px', color: '#64748b' }}>
              {isSubmitting ? (
                <span style={{ color: '#047857', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Loader2 size={13} className="animate-spin" /> {uploadProgressMsg}
                </span>
              ) : (
                <span>Confirmation will activate branch parts inventory</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={isSubmitting}
                style={{ fontSize: '13px', padding: '7px 16px', borderRadius: '6px' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || !signedFile || !receivedByName?.trim()}
                style={{
                  background: (!signedFile || !receivedByName?.trim()) 
                    ? '#9ca3af' 
                    : 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                  borderColor: (!signedFile || !receivedByName?.trim()) ? '#9ca3af' : '#047857',
                  color: '#ffffff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 700,
                  fontSize: '13.5px',
                  padding: '10px 22px',
                  borderRadius: '8px',
                  boxShadow: (!signedFile || !receivedByName?.trim()) ? 'none' : '0 4px 12px rgba(5, 150, 105, 0.32)',
                  cursor: (isSubmitting || !signedFile || !receivedByName?.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (isSubmitting || !signedFile || !receivedByName?.trim()) ? 0.75 : 1,
                  minHeight: '40px',
                  transition: 'all 0.15s ease'
                }}
                title={!signedFile ? 'You must upload the signed Packing List before confirming receipt' : undefined}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Archiving &amp; Confirming...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} strokeWidth={2.4} />
                    <span>Confirm Receipt &amp; Save to Drive</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
