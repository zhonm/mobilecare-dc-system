import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Lightweight, responsive loading modal that displays during shipment status transitions
 * (e.g., Draft -> Ready for Pickup or vice versa).
 */
export default function StatusChangeLoadingModal({
  isOpen,
  invoiceRef,
  siteName,
  targetStatus
}) {
  if (!isOpen) return null;

  const isTargetReady = targetStatus?.toLowerCase().includes('ready') || targetStatus?.toLowerCase().includes('pending');

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        animation: 'fadeIn 0.15s ease-out'
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '28px 32px',
          maxWidth: '380px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e2e8f0',
          textAlign: 'center',
          animation: 'slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: isTargetReady ? '#fffbeb' : '#f1f5f9',
            border: isTargetReady ? '2px solid #fde68a' : '2px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}
        >
          <Loader2
            size={26}
            className="spin"
            color={isTargetReady ? '#d97706' : '#475569'}
          />
        </div>

        <h3
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: '#0f172a',
            margin: '0 0 6px 0'
          }}
        >
          Updating Shipment Status...
        </h3>

        {invoiceRef && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
              fontWeight: 700,
              color: '#0284c7',
              marginBottom: '6px'
            }}
          >
            {invoiceRef}
          </div>
        )}

        {siteName && (
          <div
            style={{
              fontSize: '12px',
              color: '#64748b',
              marginBottom: '14px'
            }}
          >
            Destination: <strong>{siteName}</strong>
          </div>
        )}

        {targetStatus && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: isTargetReady ? '#fffbeb' : '#f8fafc',
              border: isTargetReady ? '1px solid #fde68a' : '1px solid #cbd5e1',
              fontSize: '11.5px',
              fontWeight: 600,
              color: isTargetReady ? '#b45309' : '#475569',
              margin: '6px 0 10px'
            }}
          >
            <span>Transitioning to:</span>
            <strong style={{ textTransform: 'uppercase' }}>{targetStatus}</strong>
          </div>
        )}

        <div
          style={{
            fontSize: '11px',
            color: '#94a3b8',
            marginTop: '12px'
          }}
        >
          Synchronizing changes across database &amp; storage...
        </div>
      </div>
    </div>
  );
}
