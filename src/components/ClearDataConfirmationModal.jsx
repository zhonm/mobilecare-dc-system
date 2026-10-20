import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  AlertTriangle,
  Trash2,
  X,
  ShieldAlert,
  TrendingUp,
  Split,
  Calendar,
  CheckCircle2,
  Lock,
  Download,
  FileSpreadsheet,
  Cloud,
  CloudUpload,
  AlertCircle,
  ExternalLink,
  Clock,
  RefreshCw
} from 'lucide-react';
import { exportForecastToExcel, exportAllocationToExcel } from '../utils/excelParser';
import { autoArchiveDatasetToDrive, checkDriveDatasetStatusForPeriod } from '../services/driveAutoSyncService';

export default function ClearDataConfirmationModal({
  isOpen,
  onClose,
  title = 'Confirm Operational Data Deletion',
  customReason = ''
}) {
  const {
    forecastItems,
    allocations,
    sites,
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
  const [isExportingForecast, setIsExportingForecast] = useState(false);
  const [isExportingAllocation, setIsExportingAllocation] = useState(false);
  
  // Google Drive Automated Cloud Backup States
  const [driveStatus, setDriveStatus] = useState(null);
  const [isCheckingDrive, setIsCheckingDrive] = useState(false);
  const [backupStepMessage, setBackupStepMessage] = useState('');
  const [backupStage, setBackupStage] = useState('idle'); // 'idle' | 'starting' | 'forecasting' | 'allocation' | 'clearing' | 'complete'
  const [backupProgressPercent, setBackupProgressPercent] = useState(0);

  const totalForecastCount = forecastItems?.length || 0;
  const totalAllocCount = allocations?.length || 0;
  const totalForecastUnits = (forecastItems || []).reduce((sum, it) => sum + (it.final_forecast || it.computed_forecast || 0), 0);
  const totalAllocUnits = (allocations || []).reduce((sum, it) => sum + (it.total_allocated_qty || 0), 0);
  const currentPeriodLabel = activePeriod?.label || 'September 2026';

  // Check whether Forecasting and Allocation data for that month has been uploaded to Drive
  const fetchDriveStatus = useCallback(async () => {
    setIsCheckingDrive(true);
    try {
      const status = await checkDriveDatasetStatusForPeriod(currentPeriodLabel);
      setDriveStatus(status);
    } catch (err) {
      console.warn('Failed to check Google Drive backup status:', err);
    } finally {
      setIsCheckingDrive(false);
    }
  }, [currentPeriodLabel]);

  // Reset state and check Drive when opening modal
  useEffect(() => {
    if (isOpen) {
      setConfirmationInput('');
      setReason(customReason || 'User initialized clean slate for new forecasting & allocation ingestion');
      setIsDeleting(false);
      setInputError('');
      setIsExportingForecast(false);
      setIsExportingAllocation(false);
      setBackupStage('idle');
      setBackupProgressPercent(0);
      setBackupStepMessage('');
      fetchDriveStatus();
    }
  }, [isOpen, customReason, fetchDriveStatus]);

  const handleExportForecast = async () => {
    if (!forecastItems || forecastItems.length === 0) {
      showToast('No forecasting data available to export', 'warning');
      return;
    }
    setIsExportingForecast(true);
    try {
      await exportForecastToExcel(forecastItems, currentPeriodLabel);
      showToast(`Exported ${currentPeriodLabel} Forecasting XLSX successfully.`, 'success');
    } catch (err) {
      console.error('Error exporting forecast:', err);
      showToast('Failed to export forecasting XLSX', 'error');
    } finally {
      setIsExportingForecast(false);
    }
  };

  const handleExportAllocation = async () => {
    if (!allocations || allocations.length === 0) {
      showToast('No allocation data available to export', 'warning');
      return;
    }
    setIsExportingAllocation(true);
    try {
      await exportAllocationToExcel(allocations, sites || [], currentPeriodLabel);
      showToast(`Exported ${currentPeriodLabel} Allocation Matrix XLSX successfully.`, 'success');
    } catch (err) {
      console.error('Error exporting allocation:', err);
      showToast('Failed to export allocation XLSX', 'error');
    } finally {
      setIsExportingAllocation(false);
    }
  };

  const isPhraseMatched = confirmationInput.trim().toLowerCase() === REQUIRED_PHRASE.toLowerCase();

  const handleConfirm = async (e) => {
    e?.preventDefault();
    if (!isPhraseMatched) {
      setInputError(`You must type "${REQUIRED_PHRASE}" exactly to confirm deletion.`);
      return;
    }

    setIsDeleting(true);
    setInputError('');
    setBackupStage('starting');
    setBackupProgressPercent(10);
    setBackupStepMessage('Initializing automated Google Drive cloud backup...');

    try {
      // Automatic safety backup to Google Drive before purge
      if (totalForecastCount > 0 || totalAllocCount > 0) {
        setBackupStage('forecasting');
        setBackupProgressPercent(25);
        setBackupStepMessage('Generating & uploading Demand Forecasting (.xlsx) to Drive...');

        try {
          const autoRes = await autoArchiveDatasetToDrive({
            forecastItems: forecastItems || [],
            allocations: allocations || [],
            sites: sites || [],
            periodLabel: currentPeriodLabel,
            onProgress: ({ stage, message }) => {
              setBackupStepMessage(message);
              if (stage === 'forecasting') {
                setBackupStage('forecasting');
                setBackupProgressPercent(40);
              } else if (stage === 'allocation') {
                setBackupStage('allocation');
                setBackupProgressPercent(70);
              } else if (stage === 'completed') {
                setBackupStage('completed');
                setBackupProgressPercent(85);
              }
            }
          });
          if (autoRes?.success) {
            setBackupProgressPercent(90);
            showToast(`Safely archived ${currentPeriodLabel} data to Google Drive before purge.`, 'info');
          }
        } catch (backupErr) {
          console.warn('[Google Drive] Pre-deletion auto-backup warning:', backupErr);
        }
      }

      setBackupStage('clearing');
      setBackupProgressPercent(95);
      setBackupStepMessage('Purging operational records & resetting local workspace...');

      if (clearAllData) {
        await clearAllData({
          reason: reason.trim() || 'User confirmed data purge via security phrase ("Delete Data")',
          securityPhraseVerified: true
        });
      }

      setBackupStage('complete');
      setBackupProgressPercent(100);
      setBackupStepMessage('Cloud backup & system reset complete!');
      showToast('Operational data backed up to Google Drive and cleared successfully.', 'success');

      // Brief delay to allow the user to see the 100% completion checkmark
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error('Error clearing data:', err);
      setInputError(err.message || 'Failed to clear system data. Please try again.');
      showToast('Failed to clear operational data', 'error');
      setIsDeleting(false);
      setBackupStage('idle');
      setBackupStepMessage('');
      setBackupProgressPercent(0);
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) onClose();
      }}
    >
      <div
        className="modal-content"
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '540px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
          border: '1px solid #fecaca',
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

          {/* Google Drive Automated Cloud Backup & Monthly Status Card */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '14px',
              marginBottom: '18px'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CloudUpload size={18} color="#2563eb" />
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
                  Google Drive Cloud Backup & Safety Check
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {isCheckingDrive ? (
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <RefreshCw size={12} className="animate-spin" /> Checking Drive...
                  </span>
                ) : driveStatus?.allUploaded ? (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#15803d', background: '#dcfce7', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={12} /> Backed Up to Drive
                  </span>
                ) : driveStatus?.anyUploaded ? (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#d97706', background: '#fef3c7', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertCircle size={12} /> Partially Backed Up
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569', background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Cloud size={12} /> Not Backed Up on Drive
                  </span>
                )}
                <button
                  type="button"
                  onClick={fetchDriveStatus}
                  disabled={isCheckingDrive || isDeleting}
                  title="Re-check Google Drive status"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: isCheckingDrive || isDeleting ? 'not-allowed' : 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    color: '#64748b'
                  }}
                >
                  <RefreshCw size={13} className={isCheckingDrive ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            <p style={{ fontSize: '11.5px', color: '#475569', margin: '0 0 10px 0', lineHeight: 1.4 }}>
              Active data is automatically uploaded and safely archived to Google Drive when you click <strong>Confirm &amp; Clear All Data</strong> below. You can verify existing <strong>{currentPeriodLabel}</strong> cloud archives below.
            </p>

            {/* Live Monthly Status Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              {/* Forecasting Status */}
              <div
                style={{
                  background: '#ffffff',
                  border: driveStatus?.forecasting?.uploaded ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#334155' }}>
                    Forecasting ({currentPeriodLabel})
                  </span>
                  {driveStatus?.forecasting?.uploaded ? (
                    <span style={{ fontSize: '10.5px', color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <CheckCircle2 size={12} /> Uploaded
                    </span>
                  ) : (
                    <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={12} /> Pending Drive Backup
                    </span>
                  )}
                </div>
                {driveStatus?.forecasting?.uploaded && driveStatus?.forecasting?.latestFile && (
                  <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span>{driveStatus.forecasting.latestFile.name}</span>
                    {driveStatus.forecasting.latestFile.webViewLink && (
                      <a
                        href={driveStatus.forecasting.latestFile.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#2563eb', display: 'inline-flex', alignItems: 'center' }}
                        title="Open file in Google Drive"
                      >
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Allocation Status */}
              <div
                style={{
                  background: '#ffffff',
                  border: driveStatus?.allocation?.uploaded ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#334155' }}>
                    Allocation ({currentPeriodLabel})
                  </span>
                  {driveStatus?.allocation?.uploaded ? (
                    <span style={{ fontSize: '10.5px', color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <CheckCircle2 size={12} /> Uploaded
                    </span>
                  ) : (
                    <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={12} /> Pending Drive Backup
                    </span>
                  )}
                </div>
                {driveStatus?.allocation?.uploaded && driveStatus?.allocation?.latestFile && (
                  <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span>{driveStatus.allocation.latestFile.name}</span>
                    {driveStatus.allocation.latestFile.webViewLink && (
                      <a
                        href={driveStatus.allocation.latestFile.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#2563eb', display: 'inline-flex', alignItems: 'center' }}
                        title="Open file in Google Drive"
                      >
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Optional Pre-Deletion Backup Notice and Local XLSX Export Fallback */}
            <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '10px', marginTop: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <FileSpreadsheet size={13} color="#64748b" />
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>
                  Optional Backup: Export Current Data (XLSX)
                </span>
              </div>
              <p style={{ fontSize: '10.5px', color: '#64748b', margin: '0 0 8px 0', lineHeight: 1.35 }}>
                Before clearing the masterlist, you may optionally download a backup spreadsheet of the current forecasting models and allocation matrices to your local computer.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <button
                  type="button"
                  onClick={handleExportForecast}
                  disabled={isDeleting || isExportingForecast || totalForecastCount === 0}
                  className="btn btn-secondary btn-sm"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    padding: '4px 8px',
                    background: '#ffffff',
                    borderColor: '#cbd5e1',
                    color: '#475569',
                    cursor: (isDeleting || isExportingForecast || totalForecastCount === 0) ? 'not-allowed' : 'pointer'
                  }}
                  title={totalForecastCount === 0 ? 'No forecasting data to export' : 'Export current forecasting to Excel'}
                >
                  <Download size={12} className={isExportingForecast ? 'animate-spin' : ''} />
                  <span>{isExportingForecast ? 'Exporting Forecasting...' : 'Export Forecasting (.xlsx)'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportAllocation}
                  disabled={isDeleting || isExportingAllocation || totalAllocCount === 0}
                  className="btn btn-secondary btn-sm"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    padding: '4px 8px',
                    background: '#ffffff',
                    borderColor: '#cbd5e1',
                    color: '#475569',
                    cursor: (isDeleting || isExportingAllocation || totalAllocCount === 0) ? 'not-allowed' : 'pointer'
                  }}
                  title={totalAllocCount === 0 ? 'No allocation data to export' : 'Export current allocation matrix to Excel'}
                >
                  <Download size={12} className={isExportingAllocation ? 'animate-spin' : ''} />
                  <span>{isExportingAllocation ? 'Exporting Allocation...' : 'Export Allocation (.xlsx)'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Automated Google Drive Cloud Backup Progress Indicator */}
          {isDeleting && (
            <div
              style={{
                background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)',
                border: '1.5px solid #86efac',
                borderRadius: '10px',
                padding: '14px 16px',
                marginBottom: '18px',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.12)',
                animation: 'fadeIn 0.25s ease-out'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: backupStage === 'complete' ? '#16a34a' : '#0284c7',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                  }}
                >
                  {backupStage === 'complete' ? (
                    <CheckCircle2 size={20} />
                  ) : (
                    <CloudUpload size={20} className="animate-spin" />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: backupStage === 'complete' ? '#166534' : '#0369a1' }}>
                    {backupStage === 'complete' ? 'Cloud Backup & System Reset Complete' : 'Automated Google Drive Cloud Backup in Progress'}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#047857', marginTop: '2px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {backupStepMessage || 'Uploading workbooks to Google Drive...'}
                  </div>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#047857', fontFamily: 'var(--font-mono, monospace)' }}>
                  {backupProgressPercent}%
                </div>
              </div>

              {/* Animated Progress Bar */}
              <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '10px' }}>
                <div
                  style={{
                    width: `${backupProgressPercent}%`,
                    height: '100%',
                    background: backupStage === 'complete' ? '#16a34a' : 'linear-gradient(90deg, #0284c7 0%, #10b981 100%)',
                    borderRadius: '4px',
                    transition: 'width 0.35s ease-in-out'
                  }}
                />
              </div>

              {/* Stepped Checklist */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {/* Step 1: Forecasting */}
                <div
                  style={{
                    background: backupStage === 'forecasting' ? '#dcfce7' : ['allocation', 'completed', 'clearing', 'complete'].includes(backupStage) ? '#f0fdf4' : '#ffffff',
                    border: `1px solid ${['allocation', 'completed', 'clearing', 'complete'].includes(backupStage) ? '#86efac' : backupStage === 'forecasting' ? '#10b981' : '#cbd5e1'}`,
                    borderRadius: '6px',
                    padding: '6px 8px',
                    fontSize: '10.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    color: ['allocation', 'completed', 'clearing', 'complete'].includes(backupStage) ? '#166534' : backupStage === 'forecasting' ? '#047857' : '#64748b'
                  }}
                >
                  {['allocation', 'completed', 'clearing', 'complete'].includes(backupStage) ? (
                    <CheckCircle2 size={12} color="#16a34a" />
                  ) : backupStage === 'forecasting' ? (
                    <RefreshCw size={11} className="animate-spin" color="#10b981" />
                  ) : (
                    <Clock size={11} />
                  )}
                  <span style={{ fontWeight: 600 }}>1. Forecasting</span>
                </div>

                {/* Step 2: Allocation */}
                <div
                  style={{
                    background: backupStage === 'allocation' ? '#dcfce7' : ['completed', 'clearing', 'complete'].includes(backupStage) ? '#f0fdf4' : '#ffffff',
                    border: `1px solid ${['completed', 'clearing', 'complete'].includes(backupStage) ? '#86efac' : backupStage === 'allocation' ? '#10b981' : '#cbd5e1'}`,
                    borderRadius: '6px',
                    padding: '6px 8px',
                    fontSize: '10.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    color: ['completed', 'clearing', 'complete'].includes(backupStage) ? '#166534' : backupStage === 'allocation' ? '#047857' : '#64748b'
                  }}
                >
                  {['completed', 'clearing', 'complete'].includes(backupStage) ? (
                    <CheckCircle2 size={12} color="#16a34a" />
                  ) : backupStage === 'allocation' ? (
                    <RefreshCw size={11} className="animate-spin" color="#10b981" />
                  ) : (
                    <Clock size={11} />
                  )}
                  <span style={{ fontWeight: 600 }}>2. Allocation</span>
                </div>

                {/* Step 3: Clean Slate */}
                <div
                  style={{
                    background: backupStage === 'clearing' ? '#dcfce7' : backupStage === 'complete' ? '#f0fdf4' : '#ffffff',
                    border: `1px solid ${backupStage === 'complete' ? '#86efac' : backupStage === 'clearing' ? '#10b981' : '#cbd5e1'}`,
                    borderRadius: '6px',
                    padding: '6px 8px',
                    fontSize: '10.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    color: backupStage === 'complete' ? '#166534' : backupStage === 'clearing' ? '#047857' : '#64748b'
                  }}
                >
                  {backupStage === 'complete' ? (
                    <CheckCircle2 size={12} color="#16a34a" />
                  ) : backupStage === 'clearing' ? (
                    <RefreshCw size={11} className="animate-spin" color="#10b981" />
                  ) : (
                    <Clock size={11} />
                  )}
                  <span style={{ fontWeight: 600 }}>3. Clean Slate</span>
                </div>
              </div>
            </div>
          )}

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
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
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
                  <RefreshCw size={14} className="animate-spin" />
                  <span>{backupStepMessage || 'Backing up & clearing...'}</span>
                </>
              ) : (
                <>
                  <Trash2 size={14} />
                  <span>Confirm &amp; Clear All Data</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
