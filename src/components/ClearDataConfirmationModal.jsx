import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  AlertTriangle,
  Trash2,
  X,
  ShieldAlert,
  RotateCcw,
  TrendingUp,
  Split,
  Calendar,
  CheckCircle2,
  Lock
} from 'lucide-react';

export default function ClearDataConfirmationModal({
  isOpen,
  onClose,
  title = 'Confirm Operational Data Deletion',
  customReason = ''
}) {
  const {
    forecastItems,
    allocations,
    activePeriod,
    currentUser,
    clearAllData,
    showToast
  } = useApp();

  const REQUIRED_PHRASE = 'Delete Data';

  const [confirmationInput, setConfirmationInput] = useState('');
  const [reason, setReason] = useState(customReason || 'User initialized clean slate for new forecasting & allocation ingestion');
  const [isDeleting, setIsDeleting] = useState(false);
  const [inputError, setInputError] = useState('');

  // Reset state when opening modal
  useEffect(() => {
    if (isOpen) {
      setConfirmationInput('');
      setReason(customReason || 'User initialized clean slate for new forecasting & allocation ingestion');
      setIsDeleting(false);
      setInputError('');
    }
  }, [isOpen, customReason]);

  if (!isOpen) return null;

  const totalForecastCount = forecastItems?.length || 0;
  const totalAllocCount = allocations?.length || 0;
  const totalForecastUnits = (forecastItems || []).reduce((sum, it) => sum + (it.final_forecast || it.computed_forecast || 0), 0);
  const totalAllocUnits = (allocations || []).reduce((sum, it) => sum + (it.total_allocated_qty || 0), 0);
  const currentPeriodLabel = activePeriod?.label || 'September 2026';

  const isPhraseMatched = confirmationInput.trim() === REQUIRED_PHRASE;

  const handleConfirm = async (e) => {
    e?.preventDefault();
    if (!isPhraseMatched) {
      setInputError(`You must type "${REQUIRED_PHRASE}" exactly to confirm deletion.`);
      return;
    }

    setIsDeleting(true);
    setInputError('');

    try {
      if (clearAllData) {
        await clearAllData({
          reason: reason.trim() || 'User confirmed data purge via security phrase ("Delete Data")',
          securityPhraseVerified: true
        });
      }
      showToast('Operational data cleared and logged to Audit Trail successfully.', 'success');
      onClose();
    } catch (err) {
      console.error('Error clearing data:', err);
      setInputError(err.message || 'Failed to clear system data. Please try again.');
      showToast('Failed to clear operational data', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) onClose();
      }}
    >
      <div
        className="modal-card"
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '540px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
          border: '1px solid #fecaca',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease-out'
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 22px',
            background: '#fef2f2',
            borderBottom: '1px solid #fee2e2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: '#fee2e2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#991b1b' }}>
                {title}
              </h3>
              <span style={{ fontSize: '12px', color: '#b91c1c', fontWeight: 500 }}>
                Security Verification Required
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#991b1b',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              display: 'flex'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleConfirm} style={{ padding: '22px' }}>
          {/* Warning Message Card */}
          <div
            style={{
              background: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: '8px',
              padding: '12px 14px',
              marginBottom: '18px',
              display: 'flex',
              gap: '10px'
            }}
          >
            <ShieldAlert size={20} color="#e11d48" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '12.5px', color: '#881337', lineHeight: 1.5 }}>
              <strong>Permanent Action Warning:</strong> This will permanently erase active demand forecasting models, empirical regression counts, and branch allocation matrices.
            </div>
          </div>

          {/* Scope Summary Preview */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '12px 14px',
              marginBottom: '18px'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', marginBottom: '8px', letterSpacing: '0.05em' }}>
              Current Active Data Summary
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', fontSize: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <TrendingUp size={14} color="#0284c7" />
                <span style={{ color: '#64748b' }}>Forecasts:</span>
                <strong style={{ color: '#0f172a' }}>{totalForecastCount} models ({totalForecastUnits} units)</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Split size={14} color="#059669" />
                <span style={{ color: '#64748b' }}>Allocations:</span>
                <strong style={{ color: '#0f172a' }}>{totalAllocCount} rows ({totalAllocUnits} units)</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', gridColumn: 'span 2' }}>
                <Calendar size={14} color="#d97706" />
                <span style={{ color: '#64748b' }}>Active Period:</span>
                <strong style={{ color: '#0f172a' }}>{currentPeriodLabel}</strong>
              </div>
            </div>
          </div>

          {/* Deletion Reason Field */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              Reason for Purge (Recorded in Audit Trail):
            </label>
            <input
              type="text"
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="E.g., Preparing clean slate for September 2026 Masterlist upload"
              disabled={isDeleting}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '12.5px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Security Phrase Input */}
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
              Type <span style={{ color: '#dc2626', background: '#fee2e2', padding: '1px 6px', borderRadius: '4px', fontFamily: 'var(--font-mono, monospace)' }}>Delete Data</span> to confirm:
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="input"
                value={confirmationInput}
                onChange={(e) => {
                  setConfirmationInput(e.target.value);
                  setInputError('');
                }}
                placeholder='Type "Delete Data"'
                disabled={isDeleting}
                autoFocus
                style={{
                  width: '100%',
                  padding: '9px 36px 9px 12px',
                  fontSize: '13px',
                  borderRadius: '6px',
                  border: isPhraseMatched ? '2px solid #10b981' : inputError ? '2px solid #ef4444' : '1px solid #cbd5e1',
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--font-mono, monospace)',
                  background: isPhraseMatched ? '#f0fdf4' : '#ffffff'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                {isPhraseMatched ? (
                  <CheckCircle2 size={16} color="#10b981" />
                ) : (
                  <Lock size={15} color="#94a3b8" />
                )}
              </div>
            </div>
            {inputError && (
              <div style={{ fontSize: '11.5px', color: '#dc2626', marginTop: '4px', fontWeight: 500 }}>
                {inputError}
              </div>
            )}
          </div>

          {/* Audit Logging Notice */}
          <div
            style={{
              fontSize: '11px',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '20px'
            }}
          >
            <ShieldAlert size={13} color="#64748b" />
            <span>
              Authorized by <strong>{currentUser?.fullName || 'Superadmin User'}</strong> ({currentUser?.role || 'admin'}). Logged to Audit Trail.
            </span>
          </div>

          {/* Modal Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isDeleting}
              style={{ padding: '8px 16px', fontSize: '12.5px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={!isPhraseMatched || isDeleting}
              style={{
                padding: '8px 18px',
                fontSize: '12.5px',
                fontWeight: 600,
                background: isPhraseMatched ? '#dc2626' : '#fca5a5',
                borderColor: isPhraseMatched ? '#b91c1c' : '#fca5a5',
                color: '#ffffff',
                cursor: isPhraseMatched && !isDeleting ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isDeleting ? (
                <>
                  <RotateCcw size={14} className="spin" />
                  <span>Clearing Data...</span>
                </>
              ) : (
                <>
                  <Trash2 size={14} />
                  <span>Confirm & Clear All Data</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
