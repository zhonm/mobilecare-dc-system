import { useState, useRef, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { generatePackingListPDF } from '../utils/pdfGenerator';
import {
  Download,
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
  Trash2,
  Lock,
  Truck,
  Clock,
  PackageCheck,
  Package,
  Calendar,
  UserCheck,
  MapPin,
  ShieldCheck,
  ArrowRightCircle
} from 'lucide-react';
import { parseShipmentManifestFile, downloadShipmentManifestTemplate } from '../utils/excelParser';
import { isLockedConfirmedShipment } from '../utils/appContextHelpers';

export default function Shipments() {
  const {
    shipments,
    sites,
    parts,
    saveShipment,
    deleteShipment,
    confirmSiteReceive,
    partsRequests,
    updatePartsRequestStatus,
    batchImportShipments,
    clearAllShipmentsData,
    showToast,
    currentUser,
    canUserDeleteRecord,
    supervisorSettings
  } = useApp();

  const [filterStatus, setFilterStatus] = useState('ALL');
  const [search, setSearch] = useState('');

  // Auto-migration: Move any existing unconfirmed shipments to 'pending_pickup', fix 'Warehouse Staff' to active user ('Zhon Manaois'), and clear forced dates
  useEffect(() => {
    const activeUserName = currentUser?.fullName || currentUser?.name || 'Zhon Manaois';
    const needMigration = (shipments || []).filter(s => 
      !isLockedConfirmedShipment(s) && (
        s.status === 'shipped' || 
        s.prepared_by_name === 'Warehouse Staff' ||
        s.saved_by_name === 'Warehouse Staff' ||
        (s.status === 'pending_pickup' && s.shipment_date && !s.pickup_date)
      )
    );
    if (needMigration.length > 0) {
      needMigration.forEach(s => {
        const cleanPrepBy = (s.prepared_by_name && s.prepared_by_name !== 'Warehouse Staff') ? s.prepared_by_name : activeUserName;
        saveShipment({
          ...s,
          status: 'pending_pickup',
          prepared_by_name: cleanPrepBy,
          saved_by_name: cleanPrepBy,
          shipment_date: ''
        });
      });
    }
  }, [shipments, saveShipment, currentUser]);

  // Courier Pickup Handover Modal State
  const [pickupModalState, setPickupModalState] = useState(null);

  // Site Confirmation & Receipt Modal State
  const [receiveModalState, setReceiveModalState] = useState(null);

  // Tracking Number Required Prompt Modal State (for Print / PDF)
  const [trackingModalState, setTrackingModalState] = useState(null);

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedBatch, setParsedBatch] = useState(null);
  const fileInputRef = useRef(null);

  // Clear Confirmation Modal State
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  // Direct Corporate PDF Request Handler
  const handleRequestPrintOrPDF = (shipmentObj, items, siteObj, _action = 'pdf') => {
    const pdfOptions = {
      supervisorName: supervisorSettings?.supervisor_name || shipmentObj.verified_by_name || 'Anjo Alcazar',
      supervisorTitle: supervisorSettings?.supervisor_title || 'MDC Supervisor of DC',
      guardOnDuty: shipmentObj.guard_on_duty || supervisorSettings?.guard_on_duty,
      pickupDate: shipmentObj.pickup_date || shipmentObj.shipment_date
    };

    generatePackingListPDF(shipmentObj, items || [], siteObj || {}, pdfOptions);
    showToast(`Downloaded 2-Page PDF (Packing List + Declaration Form) for ${shipmentObj.invoice_ref || 'manifest'}`, 'info');
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
      return sh.status;
    }
    return 'pending_pickup';
  };

  // Status Summary Counts
  const statusCounts = useMemo(() => {
    let pending = 0;
    let shipped = 0;
    let received = 0;
    let validTotal = 0;

    (shipments || []).forEach(sh => {
      if (!sh.items || sh.items.length === 0) return;
      validTotal++;
      const norm = getNormalizedStatus(sh);
      if (norm === 'received_confirmed') received++;
      else if (norm === 'shipped') shipped++;
      else pending++;
    });

    return { total: validTotal, pending, shipped, received };
  }, [shipments]);

  // Filtered shipments list
  const filteredShipments = useMemo(() => {
    return (shipments || []).filter(s => {
      if (!s.items || s.items.length === 0) return false;
      const norm = getNormalizedStatus(s);

      if (filterStatus !== 'ALL') {
        if (filterStatus === 'pending_pickup' && norm !== 'pending_pickup' && norm !== 'draft' && norm !== 'packing') return false;
        if (filterStatus === 'shipped' && norm !== 'shipped') return false;
        if (filterStatus === 'received_confirmed' && norm !== 'received_confirmed') return false;
        if (filterStatus === 'draft' && norm !== 'draft') return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const refMatch = s.invoice_ref?.toLowerCase().includes(q) || s.shipment_number?.toLowerCase().includes(q);
        const trackMatch = s.tracking_number?.toLowerCase().includes(q);
        const siteMatch = s.site_name?.toLowerCase().includes(q);
        const carrierMatch = (s.carrier || s.courier)?.toLowerCase().includes(q);
        const pickupMatch = s.pickup_by_name?.toLowerCase().includes(q);
        const receivedMatch = s.received_by_name?.toLowerCase().includes(q);
        if (!refMatch && !trackMatch && !siteMatch && !carrierMatch && !pickupMatch && !receivedMatch) return false;
      }
      return true;
    });
  }, [shipments, filterStatus, search]);

  // --- Courier Handover: Open Modal ---
  const handleOpenPickupModal = (shipment) => {
    const isMM = sites.find(st => st.id === shipment.site_id)?.region === 'Metro Manila';
    setPickupModalState({
      shipment,
      carrier: shipment.carrier || shipment.courier || (isMM ? 'Lalamove' : 'Lite Express'),
      trackingNumber: shipment.tracking_number || '',
      riderName: shipment.pickup_by_name || '',
      riderPhone: shipment.rider_phone || '',
      vehiclePlate: shipment.vehicle_plate || '',
      guardOnDuty: shipment.guard_on_duty || supervisorSettings?.guard_on_duty || 'Anjo Alcazar / MDC DC Guard',
      pickupDate: shipment.pickup_date || new Date().toISOString().split('T')[0]
    });
  };

  // --- Courier Handover: Submit Pickup Action ---
  const handleConfirmCourierPickup = async (e) => {
    e.preventDefault();
    if (!pickupModalState) return;

    const cleanTrk = String(pickupModalState.trackingNumber || '').trim();
    if (!cleanTrk) {
      showToast('Booking ID / Tracking Number is required for dispatch.', 'warning');
      return;
    }

    const cleanCarrier = String(pickupModalState.carrier || '').trim() || 'Lite Express';
    const cleanRider = String(pickupModalState.riderName || '').trim();
    const cleanPickupDate = String(pickupModalState.pickupDate || '').trim() || new Date().toISOString().split('T')[0];

    const updatedShipment = {
      ...pickupModalState.shipment,
      status: 'shipped',
      carrier: cleanCarrier,
      courier: cleanCarrier,
      tracking_number: cleanTrk,
      booking_id: cleanTrk,
      pickup_by_name: cleanRider,
      courier_name: cleanRider,
      pickup_date: cleanPickupDate,
      shipment_date: cleanPickupDate,
      rider_phone: String(pickupModalState.riderPhone || '').trim(),
      vehicle_plate: String(pickupModalState.vehiclePlate || '').trim(),
      guard_on_duty: String(pickupModalState.guardOnDuty || '').trim(),
      dispatched_at: new Date().toISOString(),
      dispatched_by: currentUser?.fullName || 'Warehouse Staff',
      updated_at: new Date().toISOString()
    };

    await saveShipment(updatedShipment);
    showToast(`Dispatched! Shipment ${updatedShipment.invoice_ref || updatedShipment.shipment_number} status set to SHIPPED (${cleanCarrier} #${cleanTrk}).`, 'success');
    setPickupModalState(null);
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

    if (typeof confirmSiteReceive === 'function') {
      await confirmSiteReceive(
        receiveModalState.shipment.id,
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
        ...receiveModalState.shipment,
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
    setReceiveModalState(null);
  };

  // Tracking modal submit for PDF / Print
  const handleConfirmTrackingModal = async () => {
    if (!trackingModalState) return;
    const cleanTrk = String(trackingModalState.trackingInput || '').trim();
    if (!cleanTrk) {
      showToast('Booking ID / Tracking Number is required.', 'warning');
      return;
    }

    const cleanCarrier = String(trackingModalState.carrierInput || '').trim() || 'Lite Express';
    const cleanCourierName = String(trackingModalState.courierNameInput || '').trim();
    const cleanGuardOnDuty = String(trackingModalState.guardOnDutyInput || '').trim();
    const cleanPickupDate = String(trackingModalState.pickupDateInput || '').trim() || new Date().toLocaleDateString('en-US');

    const updatedShipment = {
      ...trackingModalState.shipment,
      tracking_number: cleanTrk,
      booking_id: cleanTrk,
      carrier: cleanCarrier,
      courier: cleanCarrier,
      pickup_by_name: cleanCourierName,
      courier_name: cleanCourierName,
      pickup_date: cleanPickupDate,
      guard_on_duty: cleanGuardOnDuty,
      rider_phone: String(trackingModalState.riderPhoneInput || '').trim(),
      vehicle_plate: String(trackingModalState.vehiclePlateInput || '').trim()
    };

    await saveShipment(updatedShipment);
    showToast(`Dispatch details & Booking ID #${cleanTrk} saved!`, 'success');

    const pdfOptions = {
      supervisorName: supervisorSettings?.supervisor_name || 'Anjo Alcazar',
      supervisorTitle: supervisorSettings?.supervisor_title || 'MDC Supervisor of DC',
      guardOnDuty: updatedShipment.guard_on_duty || supervisorSettings?.guard_on_duty,
      pickupDate: updatedShipment.pickup_date
    };

    generatePackingListPDF(updatedShipment, trackingModalState.items, trackingModalState.site, pdfOptions);

    setTrackingModalState(null);
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

  const handleBulkMoveToPendingPickup = async () => {
    let count = 0;
    const activeUserName = currentUser?.fullName || currentUser?.name || 'Zhon Manaois';
    const toUpdate = (shipments || []).filter(s => !isLockedConfirmedShipment(s) && s.status !== 'received_confirmed');
    for (const sh of toUpdate) {
      count++;
      const cleanPrepBy = (sh.prepared_by_name && sh.prepared_by_name !== 'Warehouse Staff') ? sh.prepared_by_name : activeUserName;
      await saveShipment({
        ...sh,
        status: 'pending_pickup',
        prepared_by_name: cleanPrepBy,
        saved_by_name: cleanPrepBy,
        shipment_date: '',
        updated_at: new Date().toISOString()
      });
    }
    showToast(`Successfully moved ${count} shipment manifest(s) to Pending for Pickup!`, 'success');
  };

  // --- Safe Clear Handling ---
  const handleConfirmClearAll = () => {
    clearAllShipmentsData();
    setIsClearModalOpen(false);
  };

  return (
    <div className="shipments-view">
      {/* 1. Header & Action Controls */}
      <div className="card" style={{ marginBottom: '16px' }}>
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
              Multi-stage dispatch management with Courier Pickup and Site Confirmation ({shipments.length} total manifests)
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleBulkMoveToPendingPickup}
              title="Move all unconfirmed shipments to Pending for Pickup"
              style={{
                background: '#fffbeb',
                color: '#b45309',
                borderColor: '#fde68a',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Clock size={14} />
              <span>Move to Pending Pickup</span>
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

            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search ref, site, courier, tracking..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: '26px', height: '34px', fontSize: '12px', width: '100%' }}
              />
            </div>
          </div>
        </div>

        {/* 2. Interactive Status Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap', borderTop: '1px solid #f1f5f9', paddingTop: '14px' }}>
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
        </div>
      </div>

      {/* 3. Shipment Manifests Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice Ref</th>
                <th>Destination Site</th>
                <th>Shipment / Pickup Date</th>
                <th>Courier & Tracking</th>
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
                    {search ? `No shipments found matching "${search}".` : 'No shipments found for this status. Pack parts or import manifests above.'}
                  </td>
                </tr>
              ) : (
                filteredShipments.map(sh => {
                  const destSite = sites.find(s => s.id === sh.site_id) || {};
                  const normStatus = getNormalizedStatus(sh);

                  return (
                    <tr key={sh.id}>
                      <td className="font-mono">
                        <strong>{sh.invoice_ref || sh.shipment_number}</strong>
                        {sh.transfer_slip_number && (
                          <div style={{ fontSize: '11px', color: '#0284c7', marginTop: '2px' }}>
                            TS: {sh.transfer_slip_number}
                          </div>
                        )}
                      </td>
                      <td>
                        <strong>{destSite.code || 'ASP'}</strong>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {destSite.name || sh.site_name}
                        </div>
                      </td>
                      <td>
                        <div>
                          {(sh.pickup_date || (normStatus !== 'pending_pickup' && sh.shipment_date)) ? (
                            <span>{sh.pickup_date || sh.shipment_date}</span>
                          ) : (
                            <span style={{ color: '#d97706', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <Clock size={11} />
                              Pending Dispatch
                            </span>
                          )}
                        </div>
                        {sh.received_date && (
                          <div style={{ fontSize: '11px', color: '#059669', marginTop: '1px' }}>
                            Received: {sh.received_date}
                          </div>
                        )}
                      </td>
                      <td>
                        <div><strong>{sh.carrier || sh.courier || 'Lite Express'}</strong></div>
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
                      <td style={{ textAlign: 'center' }}>
                        {normStatus === 'pending_pickup' && (
                          <span
                            className="badge"
                            style={{
                              background: '#fffbeb',
                              color: '#b45309',
                              border: '1px solid #fde68a',
                              fontWeight: 600,
                              fontSize: '11px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px'
                            }}
                          >
                            <Clock size={11} />
                            <span>PENDING FOR PICKUP</span>
                          </span>
                        )}

                        {normStatus === 'shipped' && (
                          <span
                            className="badge"
                            style={{
                              background: '#f0f9ff',
                              color: '#0369a1',
                              border: '1px solid #bae6fd',
                              fontWeight: 600,
                              fontSize: '11px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px'
                            }}
                          >
                            <Truck size={11} />
                            <span>SHIPPED</span>
                          </span>
                        )}

                        {normStatus === 'received_confirmed' && (
                          <span
                            className="badge"
                            style={{
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                              fontWeight: 600,
                              fontSize: '11px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px'
                            }}
                          >
                            <CheckCircle size={11} />
                            <span>RECEIVED CONFIRMED</span>
                          </span>
                        )}

                        {normStatus === 'draft' && (
                          <span className="badge badge-neutral" style={{ fontSize: '11px', fontWeight: 600 }}>
                            DRAFT
                          </span>
                        )}
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleRequestPrintOrPDF(sh, sh.items, destSite, 'pdf')}
                            title="Download Corporate PDF Manifest"
                          >
                            <Download size={13} />
                            <span>PDF</span>
                          </button>

                          {/* ACTION BUTTON 1: Courier Pick Up (When Pending Pickup) */}
                          {normStatus === 'pending_pickup' && (
                            <button
                              className="btn btn-sm"
                              onClick={() => handleOpenPickupModal(sh)}
                              title="Handover package to Courier (Update status to Shipped)"
                              style={{
                                background: '#f59e0b',
                                color: '#ffffff',
                                border: '1px solid #d97706',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <Truck size={13} />
                              <span>Pick Up</span>
                            </button>
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
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <PackageCheck size={13} />
                              <span>Receive</span>
                            </button>
                          )}

                          {/* ACTION BUTTON 3: Locked Indicator (When Received Confirmed) */}
                          {isLockedConfirmedShipment(sh) ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled
                              style={{ opacity: 0.85, cursor: 'not-allowed', color: '#059669', borderColor: '#a7f3d0', background: '#ecfdf5' }}
                              title="Locked Record: Manifest is Received Confirmed and permanently archived. To maintain data integrity, confirmed shipments cannot be deleted from the system UI."
                            >
                              <Lock size={13} />
                            </button>
                          ) : canUserDeleteRecord(sh, currentUser) ? (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                if (window.confirm(`Delete shipment "${sh.invoice_ref || sh.shipment_number}"? This will permanently delete both the manifest and all serialized parts included in this shipment.`)) {
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
                <button type="button" className="btn btn-secondary" onClick={() => setTrackingModalState(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} />
                  <span>Save &amp; Download PDF (2 Pages)</span>
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

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>
                    DC Guard on Duty / Security Verifier
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

              <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setPickupModalState(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{
                    background: '#0284c7',
                    borderColor: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Truck size={14} />
                  <span>Confirm Courier Pickup & Mark Shipped</span>
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
                    Courier: <strong>{receiveModalState.shipment?.carrier || 'Lite Express'}</strong> • Tracking: <strong>#{receiveModalState.shipment?.tracking_number || 'N/A'}</strong>
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
                      {receiveModalState.shipment.items.map((it, idx) => (
                        <div key={idx} style={{ padding: '2px 0', borderBottom: '1px dashed #e2e8f0' }}>
                          • {it.part_number || it.description} - <strong>{it.serial_number || it.serialNumber}</strong> (Box {it.box_number || 1})
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setReceiveModalState(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{
                    background: '#059669',
                    borderColor: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <CheckCircle size={14} />
                  <span>Confirm Receipt & Archive Manifest</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
