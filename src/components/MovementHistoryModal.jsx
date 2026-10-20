import { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  X,
  ArrowRight,
  Clock,
  User,
  Building2,
  FileText,
  Copy,
  Check,
  ShieldCheck,
  History,
  RotateCcw,
  Send,
  Boxes
} from 'lucide-react';
import { resolvePartOwnershipDetails, formatTransferDate, formatSiteOwner } from '../services/transferHistoryService.js';

export default function MovementHistoryModal({
  targetPart,
  onClose,
  onNavigateTab: propNavigateTab
}) {
  const [copied, setCopied] = useState(false);
  const appContext = useApp?.() || {};
  const navigateTab = propNavigateTab || appContext.setActiveTab;

  if (!targetPart) return null;

  const serialNumber = targetPart.serial_number || targetPart.serialNumber || '';
  const partNumber = targetPart.part_number || targetPart.partNumber || 'Apple Service Part';
  const description = targetPart.description || 'Apple Genuine Component';
  const model = targetPart.iphone_model || targetPart.iphoneModel || '';

  const ownershipDetails = resolvePartOwnershipDetails(targetPart);
  const { currentOwner, movementHistory, transferCount, latestTransferFormatted, transfers } = ownershipDetails;

  const handleCopySerial = () => {
    if (serialNumber && navigator.clipboard) {
      navigator.clipboard.writeText(serialNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getTransferTypeBadge = (type) => {
    const t = String(type || '').toUpperCase();
    if (t.includes('RETURN')) {
      return {
        bg: '#fef3c7',
        color: '#b45309',
        border: '1px solid #fde68a',
        icon: <RotateCcw size={12} />,
        label: 'Return to DC'
      };
    }
    if (t.includes('INBOUND') || t.includes('INTAKE')) {
      return {
        bg: '#e0f2fe',
        color: '#0369a1',
        border: '1px solid #bae6fd',
        icon: <Boxes size={12} />,
        label: 'Initial Intake'
      };
    }
    return {
      bg: '#ecfdf5',
      color: '#047857',
      border: '1px solid #a7f3d0',
      icon: <Send size={12} />,
      label: 'Site Transfer'
    };
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.78)',
        backdropFilter: 'blur(4px)',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '720px',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '24px',
          position: 'relative',
          borderRadius: '14px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.1)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px', marginBottom: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span className="badge" style={{ padding: '4px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 800, background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <History size={13} color="#0284c7" />
                Stock Ownership &amp; Transfer Trail
              </span>
              <span className="badge" style={{ fontSize: '11px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                <ShieldCheck size={12} style={{ display: 'inline', marginRight: '3px', verticalAlign: 'text-bottom' }} />
                Immutable Audit Trail
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a', fontFamily: serialNumber ? 'var(--font-mono)' : 'inherit' }}>
                {serialNumber || partNumber}
              </h2>
              {serialNumber && (
                <button
                  type="button"
                  onClick={handleCopySerial}
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
                  <span>{copied ? 'Copied' : 'Copy S/N'}</span>
                </button>
              )}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#334155', fontWeight: 600 }}>
              {partNumber} &bull; {description} {model && `(${model})`}
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

        {/* Current Owner & Movement Trail Card */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginBottom: '18px' }}>
          {/* Current Owner Tracking */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building2 size={13} color="#0284c7" />
              <span>Current Site Ownership</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                {(currentOwner ? String(currentOwner).toUpperCase() : formatSiteOwner(targetPart.site_code || 'DC'))}
              </span>
              <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '11px', fontWeight: 700 }}>
                Active Owner
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
              Stored location: <strong>{targetPart.site_name || targetPart.site_code || 'Central DC'}</strong>
            </div>
          </div>

          {/* Movement Trail Summary */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <History size={13} color="#059669" />
              <span>Movement History</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {movementHistory.map((site, sIdx) => (
                <div key={`${site}-${sIdx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      background: sIdx === movementHistory.length - 1 ? '#0284c7' : '#ffffff',
                      color: sIdx === movementHistory.length - 1 ? '#ffffff' : '#0f172a',
                      border: sIdx === movementHistory.length - 1 ? '1px solid #0284c7' : '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '3px 8px',
                      fontSize: '12px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    {site}
                  </span>
                  {sIdx < movementHistory.length - 1 && (
                    <ArrowRight size={13} color="#94a3b8" />
                  )}
                </div>
              ))}
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
              Transfers Recorded: <strong>{transferCount}</strong> &bull; Latest: <strong>{latestTransferFormatted}</strong>
            </div>
          </div>
        </div>

        {/* Detailed Transfer Trail Timeline */}
        <div style={{ background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '16px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h4 style={{ margin: 0, fontSize: '12.5px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FileText size={14} color="#0284c7" />
              <span>Full Transfer Audit Trail (Chronological)</span>
            </h4>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>
              {transfers.length} {transfers.length === 1 ? 'record' : 'records'}
            </span>
          </div>

          {transfers.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
              <Building2 size={28} color="#94a3b8" style={{ margin: '0 auto 8px', display: 'block' }} />
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                No Inter-Site Transfers Recorded Yet
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', maxWidth: '420px', margin: '0 auto' }}>
                This part currently resides at its initial stock location (<strong>{targetPart.site_code || 'DC'}</strong>) under ownership <strong>{currentOwner}</strong>.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {transfers.map((xfer, idx) => {
                const badge = getTransferTypeBadge(xfer.transfer_type);
                return (
                  <div
                    key={xfer.id || idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      padding: '12px',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1px solid #f1f5f9',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    {/* Step Number Circle */}
                    <div
                      style={{
                        minWidth: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: '#0284c7',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                        marginTop: '2px'
                      }}
                    >
                      {idx + 1}
                    </div>

                    {/* Transfer Details */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                            {xfer.from_site_code} → {xfer.to_site_code}
                          </span>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              background: badge.bg,
                              color: badge.color,
                              border: badge.border,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            {badge.icon}
                            {badge.label}
                          </span>
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} />
                          <span>{formatTransferDate(xfer.transfer_date)}</span>
                        </div>
                      </div>

                      {/* Ownership Shift */}
                      <div style={{ fontSize: '11.5px', color: '#475569', marginBottom: '4px' }}>
                        Ownership: <code style={{ fontSize: '11px', background: '#e2e8f0', padding: '1px 4px', borderRadius: '3px', color: '#334155' }}>{(xfer.from_owner || '').toUpperCase()}</code>
                        {' → '}
                        <code style={{ fontSize: '11px', background: '#dbeafe', padding: '1px 4px', borderRadius: '3px', color: '#1e40af', fontWeight: 700 }}>{(xfer.to_owner || '').toUpperCase()}</code>
                      </div>

                      {/* User & Manifest Audit Record */}
                      <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <User size={12} color="#94a3b8" />
                          <span>Performed by: <strong>{xfer.user_name || 'Warehouse Staff'}</strong></span>
                        </span>
                        {xfer.manifest_ref && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <FileText size={12} color="#94a3b8" />
                            <span>Ref: <strong className="font-mono">{xfer.manifest_ref}</strong></span>
                          </span>
                        )}
                        {xfer.notes && (
                          <span style={{ color: '#475569', fontStyle: 'italic' }}>
                            &bull; &ldquo;{xfer.notes}&rdquo;
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '14px', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {navigateTab && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigateTab('all-stocks');
                    onClose();
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Building2 size={13} />
                  <span>View in All Stocks</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigateTab('audit');
                    onClose();
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <History size={13} />
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
