import { Cloud, CheckCircle2, Loader2, ExternalLink, ArrowRight, X } from 'lucide-react';

export default function DriveAutoSyncModal({
  isOpen,
  stage = 'saving', // 'saving' | 'completed' | 'error'
  statusMessage = 'Archiving spreadsheets to Google Drive...',
  forecastResult = null,
  allocationResult = null,
  errorMessage = '',
  onClose,
  onProceed
}) {
  if (!isOpen) return null;

  const isCompleted = stage === 'completed';
  const isError = stage === 'error';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '520px',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
          animation: 'fadeIn 0.2s ease-out'
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px',
            background: isCompleted ? '#f0fdf4' : (isError ? '#fef2f2' : '#eff6ff'),
            borderBottom: `1px solid ${isCompleted ? '#bbf7d0' : (isError ? '#fecaca' : '#bfdbfe')}`,
            display: 'flex',
            alignItems: 'center',
            gap: '14px'
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: isCompleted ? '#22c55e' : (isError ? '#ef4444' : '#2563eb'),
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {isCompleted ? (
              <CheckCircle2 size={24} />
            ) : isError ? (
              <X size={24} />
            ) : (
              <Cloud size={24} />
            )}
          </div>

          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
              {isCompleted ? 'Saved to Google Drive!' : (isError ? 'Google Drive Notice' : 'Saving to Google Drive...')}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#475569' }}>
              {isCompleted
                ? 'Workbooks archived to company Shared Drive'
                : (isError ? 'Import succeeded with cloud note' : 'Auto-generating & backing up Excel workbooks')}
            </p>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px' }}>
          {/* Progress / Step List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Step 1: System Ingestion */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: '#22c55e',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <CheckCircle2 size={16} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1e293b' }}>
                  Dataset Ingestion &amp; Calculation
                </span>
                <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>
                  Processed iPhone repair history &amp; demand models
                </span>
              </div>
            </div>

            {/* Step 2: Demand Forecast Excel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: forecastResult ? '#22c55e' : (isCompleted ? '#22c55e' : (isError ? '#cbd5e1' : '#3b82f6')),
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                {forecastResult || isCompleted ? (
                  <CheckCircle2 size={16} />
                ) : isError ? (
                  <X size={14} />
                ) : (
                  <Loader2 size={14} className="spin-animation" />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1e293b' }}>
                    Demand Forecasting (.xlsx)
                  </span>
                  {forecastResult?.webViewLink && (
                    <a
                      href={forecastResult.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '12px',
                        color: '#2563eb',
                        fontWeight: 600,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                    >
                      <span>View in Drive</span>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>
                  {forecastResult?.name || 'Folder: Forecasting Data'}
                </span>
              </div>
            </div>

            {/* Step 3: Master Allocation Excel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: allocationResult ? '#22c55e' : (isCompleted ? '#22c55e' : (isError ? '#cbd5e1' : '#3b82f6')),
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                {allocationResult || isCompleted ? (
                  <CheckCircle2 size={16} />
                ) : isError ? (
                  <X size={14} />
                ) : (
                  <Loader2 size={14} className="spin-animation" />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1e293b' }}>
                    Master Allocation Matrix (.xlsx)
                  </span>
                  {allocationResult?.webViewLink && (
                    <a
                      href={allocationResult.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '12px',
                        color: '#2563eb',
                        fontWeight: 600,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                    >
                      <span>View in Drive</span>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>
                  {allocationResult?.name || 'Folder: Allocation (4-Week Batches)'}
                </span>
              </div>
            </div>
          </div>

          {/* Error notice if any */}
          {isError && errorMessage && (
            <div
              style={{
                marginTop: '16px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '12.5px'
              }}
            >
              Note: {errorMessage}
            </div>
          )}

          {/* Success Banner */}
          {isCompleted && (
            <div
              style={{
                marginTop: '18px',
                padding: '12px 14px',
                borderRadius: '8px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                color: '#15803d',
                fontSize: '13px',
                lineHeight: 1.4
              }}
            >
              🎉 Both workbooks are permanently archived with date and time in your company <strong>MDC DC Logistics Archive</strong> Google Shared Drive!
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px'
          }}
        >
          {isCompleted ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onProceed || onClose}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 20px',
                fontSize: '13.5px',
                fontWeight: 600,
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              <span>Proceed to Demand Forecasting</span>
              <ArrowRight size={15} />
            </button>
          ) : isError ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{ padding: '8px 18px', fontSize: '13px', cursor: 'pointer' }}
            >
              Dismiss
            </button>
          ) : (
            <span style={{ fontSize: '13px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Loader2 size={14} className="spin-animation" />
              <span>{statusMessage}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
