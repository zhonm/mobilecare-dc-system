import { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Building2,
  Calendar,
  Wrench,
  Truck,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Barcode
} from 'lucide-react';

export default function SerialDossierModal({
  serialDetails,
  onClose,
  onNavigateTab
}) {
  const [copied, setCopied] = useState(false);

  if (!serialDetails) return null;

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(serialDetails.serialNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const badgeStyles = {
    dc: { background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' },
    site: { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
    transit: { background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' },
    used: { background: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe' }
  };

  const currentBadgeStyle = badgeStyles[serialDetails.statusBadgeType] || badgeStyles.dc;

  return (
    <div
      className="modal-backdrop"
      style={{
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#ffffff',
          borderRadius: '14px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          padding: '24px',
          border: '1px solid #e2e8f0',
          position: 'relative'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px', marginBottom: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <div style={{ padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', ...currentBadgeStyle }}>
                {serialDetails.statusBadgeLabel}
              </div>
              <span className="badge" style={{ fontSize: '11px', background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0' }}>
                <ShieldCheck size={12} style={{ display: 'inline', marginRight: '3px', verticalAlign: 'text-bottom' }} color="#0284c7" />
                Apple Genuine Part
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                {serialDetails.serialNumber}
              </h2>
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  border: '1px solid #cbd5e1',
                  background: copied ? '#dcfce7' : '#f8fafc',
                  color: copied ? '#15803d' : '#64748b',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontWeight: 600,
                  transition: 'all 0.15s ease'
                }}
                title="Copy Serial Number"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#334155', fontWeight: 600 }}>
              {serialDetails.partNumber} &bull; {serialDetails.description} ({serialDetails.iphoneModel})
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: '#f1f5f9',
              color: '#64748b',
              borderRadius: '8px',
              padding: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 4 Essential Intelligence Highlights Requested by User */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          
          {/* 1. Stock Location: DC vs Site */}
          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', marginBottom: '4px' }}>
              <Building2 size={14} />
              <span>Current Stock Location</span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {serialDetails.isDcSite ? 'Central DC Warehouse' : serialDetails.siteName}
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
              {serialDetails.isDcSite ? (
                <span>Distribution Center (DC-MDC) &bull; Box #{serialDetails.boxNumber}</span>
              ) : (
                <span>Branch Code: <strong>{serialDetails.siteCode}</strong> &bull; {serialDetails.siteRegion}</span>
              )}
            </div>
          </div>

          {/* 2. Usage Status & Consumed Date */}
          <div style={{ background: serialDetails.isUsed ? '#faf5ff' : '#f0fdf4', padding: '14px', borderRadius: '10px', border: serialDetails.isUsed ? '1px solid #e9d5ff' : '1px solid #bbf7d0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: serialDetails.isUsed ? '#7c3aed' : '#15803d', textTransform: 'uppercase', marginBottom: '4px' }}>
              <Wrench size={14} />
              <span>Usage / Repair Consumption</span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: serialDetails.isUsed ? '#6d28d9' : '#166534' }}>
              {serialDetails.isUsed ? 'Used in Customer Repair' : 'Available & Unused Stock'}
            </div>
            <div style={{ fontSize: '11.5px', color: serialDetails.isUsed ? '#5b21b6' : '#15803d', marginTop: '2px' }}>
              {serialDetails.isUsed ? (
                <>Date Used: <strong>{serialDetails.dateUsedFormatted || 'Recorded'}</strong> &bull; WO: <strong>{serialDetails.workOrderNumber}</strong></>
              ) : (
                <span>Active in inventory ready for work order allocation</span>
              )}
            </div>
          </div>

          {/* 3. Recorded Site Arrival Date */}
          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', marginBottom: '4px' }}>
              <Calendar size={14} />
              <span>Recorded Site Arrival Date</span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {serialDetails.siteArrivalFormatted || (serialDetails.statusBadgeType === 'transit' ? 'Pending Arrival' : (serialDetails.dcScanInFormatted ? `DC Intake: ${serialDetails.dcScanInFormatted}` : 'In DC Stock'))}
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
              {serialDetails.siteArrivalFormatted ? (
                <span>Confirmed physical arrival at <strong>{serialDetails.siteName}</strong></span>
              ) : serialDetails.statusBadgeType === 'transit' ? (
                <span>Dispatched via {serialDetails.linkedShipment?.courierName || 'Courier'} &bull; In Transit</span>
              ) : (
                <span>Currently stored at Central DC (Not yet dispatched to branch)</span>
              )}
            </div>
          </div>

          {/* 4. Manifest / Courier Dispatch Info */}
          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', marginBottom: '4px' }}>
              <Truck size={14} />
              <span>Dispatch Manifest &amp; Tracking</span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {serialDetails.linkedShipment ? (
                <span>{serialDetails.linkedShipment.invoiceRef}</span>
              ) : (
                <span style={{ color: '#64748b', fontWeight: 500 }}>No Outbound Shipment Manifest</span>
              )}
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
              {serialDetails.linkedShipment ? (
                <span>{serialDetails.linkedShipment.courierName} &bull; #{serialDetails.linkedShipment.trackingNumber || 'Direct Transfer'}</span>
              ) : (
                <span>Stored at DC or received directly at site</span>
              )}
            </div>
          </div>
        </div>

        {/* Lifecycle Milestone Visual Timeline */}
        <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '12.5px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Component Custody &amp; Lifecycle Timeline
          </h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Step 1: DC Intake */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ padding: '4px', background: '#dcfce7', color: '#16a34a', borderRadius: '50%', marginTop: '2px' }}>
                <CheckCircle2 size={14} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>1. DC Warehouse Inbound Scan-In</span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>{serialDetails.dcScanInFormatted || 'Recorded'}</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                  Received at Central DC &bull; Assignment: {serialDetails.intakeAssignment} &bull; Box #{serialDetails.boxNumber}
                </div>
              </div>
            </div>

            {/* Step 2: Outbound Packing & Dispatch */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ padding: '4px', background: serialDetails.linkedShipment ? '#dcfce7' : '#f1f5f9', color: serialDetails.linkedShipment ? '#16a34a' : '#94a3b8', borderRadius: '50%', marginTop: '2px' }}>
                {serialDetails.linkedShipment ? <CheckCircle2 size={14} /> : <Clock size={14} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: serialDetails.linkedShipment ? '#0f172a' : '#64748b' }}>
                    2. Outbound Branch Dispatch
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>{serialDetails.linkedShipment?.shipmentDate || '—'}</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                  {serialDetails.linkedShipment ? (
                    <>Manifest: <strong>{serialDetails.linkedShipment.invoiceRef}</strong> via <strong>{serialDetails.linkedShipment.courierName}</strong> to {serialDetails.siteName}</>
                  ) : (
                    <span>Currently held in Central DC reserve inventory</span>
                  )}
                </div>
              </div>
            </div>

            {/* Step 3: Branch Site Arrival Confirmation */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ padding: '4px', background: serialDetails.siteArrivalFormatted ? '#dcfce7' : '#f1f5f9', color: serialDetails.siteArrivalFormatted ? '#16a34a' : '#94a3b8', borderRadius: '50%', marginTop: '2px' }}>
                {serialDetails.siteArrivalFormatted ? <CheckCircle2 size={14} /> : <Clock size={14} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: serialDetails.siteArrivalFormatted ? '#0f172a' : '#64748b' }}>
                    3. Site Physical Arrival &amp; Package Confirmation
                  </span>
                  <span style={{ fontSize: '11px', color: serialDetails.siteArrivalFormatted ? '#0284c7' : '#64748b', fontWeight: 700 }}>
                    {serialDetails.siteArrivalFormatted ? `Arrived: ${serialDetails.siteArrivalFormatted}` : 'Awaiting Arrival'}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                  {serialDetails.siteArrivalFormatted ? (
                    <>Confirmed arrival at <strong>{serialDetails.siteName}</strong> &bull; Activated into active branch stock</>
                  ) : serialDetails.statusBadgeType === 'transit' ? (
                    <span>Dispatched from DC &bull; Courier in transit to destination branch</span>
                  ) : (
                    <span>Unit has not been dispatched from DC</span>
                  )}
                </div>
              </div>
            </div>

            {/* Step 4: Repair Consumption */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ padding: '4px', background: serialDetails.isUsed ? '#ede9fe' : '#f1f5f9', color: serialDetails.isUsed ? '#7c3aed' : '#94a3b8', borderRadius: '50%', marginTop: '2px' }}>
                {serialDetails.isUsed ? <CheckCircle2 size={14} /> : <Clock size={14} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: serialDetails.isUsed ? '#6d28d9' : '#64748b' }}>
                    4. Repair Usage &amp; Work Order Consumption
                  </span>
                  <span style={{ fontSize: '11px', color: serialDetails.isUsed ? '#7c3aed' : '#64748b', fontWeight: 700 }}>
                    {serialDetails.isUsed ? `Used: ${serialDetails.dateUsedFormatted}` : 'Unused'}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                  {serialDetails.isUsed ? (
                    <>Work Order: <strong>{serialDetails.workOrderNumber}</strong> &bull; Consumed by: <strong>{serialDetails.usedByName}</strong> {serialDetails.usageNotes && `(${serialDetails.usageNotes})`}</>
                  ) : (
                    <span>Unit remains available in inventory for future repair jobs</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '14px', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {onNavigateTab && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    onNavigateTab('all-stocks');
                    onClose();
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Building2 size={13} />
                  <span>View in All Stocks</span>
                </button>
                {serialDetails.linkedShipment && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      onNavigateTab('shipments');
                      onClose();
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Truck size={13} />
                    <span>View Shipment Manifest</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    onNavigateTab('audit');
                    onClose();
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Barcode size={13} />
                  <span>Audit Trail</span>
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onClose}
            style={{ minWidth: '80px' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
