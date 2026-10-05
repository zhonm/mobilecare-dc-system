import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  HardDrive,
  ShieldCheck,
  Download,
  Upload,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  RotateCcw,
  Eye,
  Info
} from 'lucide-react';
import {
  compileSystemBackupPackage,
  uploadBackupPackageToDrive,
  listGoogleDriveBackups,
  fetchBackupPackageFromDrive,
  validateBackupPackage,
  executeSystemStateRestore
} from '../services/backupRestoreService';
import {
  isGoogleDriveConfigured,
  setGoogleDriveCredentialsOverride,
  GOOGLE_DRIVE_CONFIG
} from '../services/googleDriveService';

export default function BackupRestoreSettings() {
  const app = useApp();
  const {
    currentUser,
    parts = [],
    sites = [],
    categories = [],
    inventoryUnits = [],
    shipments = [],
    purchaseOrders = [],
    forecastItems = [],
    allocations = [],
    usersList = [],
    supervisorSettings = {},
    autoLogoutConfig = {},
    uploadAuditLogs = [],
    scanLogs = [],
    showToast,
    savePart,
    saveSite,
    batchAddScanInUnits,
    batchImportShipments,
    saveShipment,
    saveSupervisorSettings,
    updateAutoLogoutConfig,
    forceGlobalCloudSyncAndPurge,
    syncAllDataToCloud
  } = app;

  const isSuperadmin =
    currentUser?.role === 'superadmin' ||
    (currentUser?.role || '').toLowerCase().includes('superadmin') ||
    currentUser?.role === 'SUPERADMIN';

  // Remote Backups State
  const [remoteBackups, setRemoteBackups] = useState([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [, setLastBackupCreated] = useState(null);

  // Credentials Override Modal State
  const [driveConfigured, setDriveConfigured] = useState(() => isGoogleDriveConfigured());
  const [isCredsModalOpen, setIsCredsModalOpen] = useState(false);
  const [pastedCreds, setPastedCreds] = useState('');

  // Backup Execution State
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupProgressMsg, setBackupProgressMsg] = useState('');

  // Restore Modal & Staging State
  const [stagedBackupPackage, setStagedBackupPackage] = useState(null);
  const [stagedValidation, setStagedValidation] = useState(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmInputText, setConfirmInputText] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(null);
  const [restoreSuccessStats, setRestoreSuccessStats] = useState(null);

  // Preview Modal for remote backup package
  const [inspectingPackage, setInspectingPackage] = useState(null);
  const [isLoadingInspect, setIsLoadingInspect] = useState(false);

  const fileInputRef = useRef(null);

  // Load list of backups from Google Drive on mount
  useEffect(() => {
    setDriveConfigured(isGoogleDriveConfigured());
    if (isSuperadmin) {
      loadRemoteBackups();
    }
  }, [isSuperadmin]);

  const loadRemoteBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const files = await listGoogleDriveBackups(30);
      setRemoteBackups(files);
    } catch (err) {
      console.warn('[BackupRestore] Could not list remote backups:', err);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 KB';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  // Save credentials override from Superadmin setup modal
  const handleSaveCredentialsOverride = () => {
    try {
      const clean = pastedCreds.trim();
      if (!clean) {
        showToast?.('Please paste the Google Service Account JSON or Private Key PEM.', 'warning');
        return;
      }

      let keyToSave = null;
      if (clean.startsWith('{')) {
        const parsed = JSON.parse(clean);
        if (!parsed.private_key) {
          throw new Error('JSON is missing "private_key" field');
        }
        keyToSave = parsed;
      } else if (clean.includes('BEGIN PRIVATE KEY')) {
        keyToSave = {
          client_email: GOOGLE_DRIVE_CONFIG.clientEmail,
          private_key: clean
        };
      } else {
        throw new Error('Unrecognized credentials format. Expected JSON credentials object or RSA Private Key PEM block.');
      }

      setGoogleDriveCredentialsOverride(keyToSave);
      setDriveConfigured(isGoogleDriveConfigured());
      setIsCredsModalOpen(false);
      setPastedCreds('');
      showToast?.('Google Drive credentials configured successfully!', 'success');
      loadRemoteBackups();
    } catch (err) {
      showToast?.('Invalid credentials: ' + err.message, 'error');
    }
  };

  // 1. Create Live Backup to Google Drive
  const handleCreateDriveBackup = async () => {
    if (!isGoogleDriveConfigured()) {
      setIsCredsModalOpen(true);
      showToast?.('Google Drive credentials are required. Please configure your service account private key.', 'warning');
      return;
    }

    setIsBackingUp(true);
    setBackupProgressMsg('Compiling system state records...');

    try {
      const pkg = compileSystemBackupPackage(
        {
          parts,
          sites,
          categories,
          inventoryUnits,
          shipments,
          purchaseOrders,
          forecastItems,
          allocations,
          usersList,
          supervisorSettings,
          autoLogoutConfig,
          uploadAuditLogs,
          scanLogs
        },
        currentUser
      );

      setBackupProgressMsg('Streaming backup package to Google Drive (backups folder)...');

      const result = await uploadBackupPackageToDrive(pkg, ({ percent }) => {
        setBackupProgressMsg(`Uploading to Google Drive... ${percent}%`);
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to upload backup to Google Drive');
      }

      setLastBackupCreated({
        filename: result.filename,
        webViewLink: result.webViewLink,
        timestamp: new Date()
      });

      showToast?.('Full system backup successfully archived to Google Drive!', 'success');
      await loadRemoteBackups();
    } catch (err) {
      console.error('[BackupRestore] Backup error:', err);
      showToast?.('Backup failed: ' + err.message, 'error');
    } finally {
      setIsBackingUp(false);
      setBackupProgressMsg('');
    }
  };

  // 2. Download Local JSON Backup
  const handleDownloadLocalBackup = () => {
    try {
      const pkg = compileSystemBackupPackage(
        {
          parts,
          sites,
          categories,
          inventoryUnits,
          shipments,
          purchaseOrders,
          forecastItems,
          allocations,
          usersList,
          supervisorSettings,
          autoLogoutConfig,
          uploadAuditLogs,
          scanLogs
        },
        currentUser
      );

      const jsonStr = JSON.stringify(pkg, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MDC_SYSTEM_BACKUP_${pkg.formattedTimestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast?.('System backup JSON downloaded to your computer.', 'success');
    } catch (err) {
      showToast?.('Failed to export local backup: ' + err.message, 'error');
    }
  };

  // 3. Staging a Local File for Restore
  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const validation = validateBackupPackage(parsed);

        if (!validation.isValid) {
          showToast?.(validation.error || 'Invalid backup file', 'error');
          return;
        }

        setStagedBackupPackage(parsed);
        setStagedValidation(validation);
        setConfirmInputText('');
        setIsConfirmModalOpen(true);
      } catch (parseErr) {
        showToast?.('Invalid JSON file format: ' + parseErr.message, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 4. Staging a Remote Drive Backup for Restore
  const handleStageRemoteBackup = async (file) => {
    setIsLoadingInspect(true);
    try {
      showToast?.(`Downloading ${file.name} from Google Drive...`, 'info');
      const pkg = await fetchBackupPackageFromDrive(file.id);
      const validation = validateBackupPackage(pkg);

      if (!validation.isValid) {
        showToast?.(validation.error || 'Backup file validation failed', 'error');
        return;
      }

      setStagedBackupPackage(pkg);
      setStagedValidation(validation);
      setConfirmInputText('');
      setIsConfirmModalOpen(true);
    } catch (err) {
      showToast?.('Failed to fetch backup from Drive: ' + err.message, 'error');
    } finally {
      setIsLoadingInspect(false);
    }
  };

  // 5. Inspect Remote Backup Details
  const handleInspectRemoteBackup = async (file) => {
    setIsLoadingInspect(true);
    try {
      const pkg = await fetchBackupPackageFromDrive(file.id);
      const validation = validateBackupPackage(pkg);
      setInspectingPackage({ file, pkg, validation });
    } catch (err) {
      showToast?.('Failed to inspect backup: ' + err.message, 'error');
    } finally {
      setIsLoadingInspect(false);
    }
  };

  // 6. Execute System Restore
  const handleConfirmExecuteRestore = async () => {
    if (confirmInputText.trim().toUpperCase() !== 'RESTORE') {
      showToast?.('Please type RESTORE in capital letters to confirm.', 'warning');
      return;
    }

    if (!stagedBackupPackage) return;

    setIsRestoring(true);
    setRestoreProgress({ step: 1, totalSteps: 6, title: 'Starting restoration...', percent: 5 });

    try {
      const result = await executeSystemStateRestore(
        stagedBackupPackage,
        {
          savePart,
          saveSite,
          batchAddScanInUnits,
          batchImportShipments,
          saveShipment,
          saveSupervisorSettings,
          updateAutoLogoutConfig,
          forceGlobalCloudSyncAndPurge,
          syncAllDataToCloud
        },
        (progress) => {
          setRestoreProgress(progress);
        }
      );

      setRestoreSuccessStats(result.restoredStats);
      showToast?.('System restoration completed successfully! All records preserved.', 'success');
      setIsConfirmModalOpen(false);
      setStagedBackupPackage(null);
    } catch (err) {
      console.error('[BackupRestore] Restore execution failed:', err);
      showToast?.('Restore failed: ' + err.message, 'error');
    } finally {
      setIsRestoring(false);
      setRestoreProgress(null);
    }
  };

  if (!isSuperadmin) {
    return (
      <div style={{ padding: '32px 24px', maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '12px', padding: '24px' }}>
          <AlertTriangle size={36} color="#b91c1c" style={{ margin: '0 auto 12px auto' }} />
          <h3 style={{ margin: 0, color: '#991b1b', fontSize: '18px', fontWeight: 800 }}>
            Restricted System Access
          </h3>
          <p style={{ margin: '8px 0 0 0', color: '#7f1d1d', fontSize: '13.5px' }}>
            Full system backup and disaster recovery operations are strictly restricted to Superadmin personnel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      
      {/* Top Banner: Storage Health & Cloud Drive Parity */}
      <div
        style={{
          background: 'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)',
          borderRadius: '14px',
          padding: '24px 28px',
          color: '#ffffff',
          boxShadow: '0 10px 25px -5px rgba(6, 78, 59, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.18)',
                padding: '12px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <HardDrive size={28} color="#ffffff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#ffffff' }}>
                  Enterprise Backup &amp; Disaster Recovery
                </h2>
                <span
                  style={{
                    background: '#10b981',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '20px',
                    textTransform: 'uppercase'
                  }}
                >
                  Superadmin
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#a7f3d0' }}>
                Automated full-system state preservation directly to Google Workspace Shared Drive.
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.12)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '12px',
                textAlign: 'right'
              }}
            >
              <div style={{ color: '#a7f3d0', fontSize: '11px' }}>Drive Cold Storage Target</div>
              <div style={{ fontWeight: 700, color: '#ffffff' }}>MDC DC Logistics Archive / backups</div>
            </div>
          </div>
        </div>

        {/* Storage Parity Notice */}
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.2)',
            borderRadius: '8px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '12.5px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#d1fae5' }}>
            <ShieldCheck size={16} color="#34d399" />
            <span>
              <strong>Zero-Supabase-Storage Architecture:</strong> 100% of backup archives and heavy snapshots are cold-stored in Google Drive, preserving Supabase free-tier egress limits.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: driveConfigured ? '#6ee7b7' : '#fcd34d', fontSize: '11.5px', fontWeight: 600 }}>
              {driveConfigured ? '✓ Google Drive Connected' : '⚠️ Drive Credentials Pending'}
            </span>
            <button
              type="button"
              onClick={() => {
                setPastedCreds('');
                setIsCredsModalOpen(true);
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.18)',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                color: '#ffffff',
                padding: '3px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {driveConfigured ? 'View / Change Key' : 'Configure Key'}
            </button>
          </div>
        </div>
      </div>

      {/* Restore Success Banner */}
      {restoreSuccessStats && (
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: '10px',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <CheckCircle2 size={24} color="#059669" />
            <div>
              <h4 style={{ margin: 0, color: '#065f46', fontSize: '14.5px', fontWeight: 800 }}>
                System Restoration Complete
              </h4>
              <p style={{ margin: '2px 0 0 0', color: '#047857', fontSize: '12.5px' }}>
                Restored {restoreSuccessStats.inventoryUnitsCount} Inventory Units, {restoreSuccessStats.shipmentsCount} Shipments, {restoreSuccessStats.partsCount} Catalog Parts, {restoreSuccessStats.sitesCount} Sites.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRestoreSuccessStats(null)}
            style={{ fontSize: '12px', padding: '4px 10px' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Grid: Immediate Actions & Live Status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        
        {/* Card 1: Create Full System Backup */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '16px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{ background: '#ecfdf5', padding: '8px', borderRadius: '8px', color: '#059669' }}>
                <Database size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#1e293b' }}>
                Create Full System Backup
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
              Compiles an immutable JSON snapshot of all {inventoryUnits.length} inventory units, {shipments.length} shipments, {parts.length} parts, {sites.length} sites, and system configs directly to Google Drive.
            </p>
          </div>

          {/* Current Live Stats Pill */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '10px 14px',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              textAlign: 'center'
            }}
          >
            <div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>{inventoryUnits.length}</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Units</div>
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>{shipments.length}</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Shipments</div>
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>{parts.length}</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Parts</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreateDriveBackup}
              disabled={isBackingUp}
              style={{
                width: '100%',
                padding: '10px 16px',
                fontSize: '13.5px',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                borderColor: '#047857',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              {isBackingUp ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  <span>{backupProgressMsg || 'Creating Backup...'}</span>
                </>
              ) : (
                <>
                  <HardDrive size={16} />
                  <span>Backup to Google Drive Now</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDownloadLocalBackup}
              disabled={isBackingUp}
              style={{
                width: '100%',
                padding: '8px 14px',
                fontSize: '12.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <Download size={14} />
              <span>Download Local Backup (.json)</span>
            </button>
          </div>
        </div>

        {/* Card 2: Restore from Local File */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '16px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{ background: '#eff6ff', padding: '8px', borderRadius: '8px', color: '#2563eb' }}>
                <Upload size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#1e293b' }}>
                Restore from Local File
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
              Upload a previously exported <code>MDC_SYSTEM_BACKUP_*.json</code> file to restore all system records with pre-flight schema inspection.
            </p>
          </div>

          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed #cbd5e1',
              borderRadius: '10px',
              padding: '24px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              background: '#f8fafc',
              transition: 'border-color 0.15s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#059669')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
          >
            <Upload size={24} color="#64748b" style={{ margin: '0 auto 8px auto' }} />
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
              Click or Drag &amp; Drop Backup File
            </div>
            <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px' }}>
              Accepts .json backup packages
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelected}
              accept=".json"
              style={{ display: 'none' }}
            />
          </div>

          <div style={{ fontSize: '11.5px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Info size={14} color="#64748b" />
            <span>Restoring will require typing RESTORE to prevent accidental overwrites.</span>
          </div>
        </div>
      </div>

      {/* Section 2: Remote Google Drive Backup Archives */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '16px',
            paddingBottom: '12px',
            borderBottom: '1px solid #f1f5f9'
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#1e293b' }}>
              Google Drive Remote Backup Archives
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: '#64748b' }}>
              Backups stored in Shared Drive "MDC DC Logistics Archive" / <code>backups</code>
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={loadRemoteBackups}
              disabled={isLoadingBackups}
              style={{ fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={13} className={isLoadingBackups ? 'spin' : ''} />
              <span>Refresh Archives</span>
            </button>
          </div>
        </div>

        {/* Backups Table */}
        {isLoadingBackups ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#64748b' }}>
            <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px auto', color: '#059669' }} />
            <div style={{ fontSize: '13px' }}>Scanning Google Drive backups folder...</div>
          </div>
        ) : remoteBackups.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px' }}>
            <HardDrive size={32} color="#94a3b8" style={{ margin: '0 auto 8px auto' }} />
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#334155' }}>
              No Google Drive backups found
            </div>
            <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '4px' }}>
              Click "Backup to Google Drive Now" above to generate your first immutable cloud archive.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>Backup Package Name</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>Archived Date</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>Size</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {remoteBackups.map((file) => (
                  <tr
                    key={file.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background 0.1s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '12px', fontWeight: 600, color: '#1e293b' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <HardDrive size={15} color="#059669" />
                        <span>{file.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {file.createdTime ? new Date(file.createdTime).toLocaleString() : 'Recent'}
                    </td>
                    <td style={{ padding: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {formatFileSize(file.size)}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => handleInspectRemoteBackup(file)}
                          disabled={isLoadingInspect}
                          style={{
                            fontSize: '11.5px',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Inspect backup package contents"
                        >
                          <Eye size={13} />
                          <span>Inspect</span>
                        </button>

                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleStageRemoteBackup(file)}
                          disabled={isLoadingInspect}
                          style={{
                            fontSize: '11.5px',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            background: '#047857',
                            borderColor: '#065f46',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Restore system state from this Google Drive backup"
                        >
                          <RotateCcw size={13} />
                          <span>Restore</span>
                        </button>

                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: '#64748b',
                              padding: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title="Open file in Google Drive"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Inspection of Backup Package */}
      {inspectingPackage && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 10000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setInspectingPackage(null); }}
        >
          <div className="modal-content" style={{ maxWidth: '600px', width: '95%', borderRadius: '12px' }}>
            <div className="modal-header" style={{ background: '#065f46', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <HardDrive size={20} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>
                    Backup Package Inspection
                  </h3>
                  <div style={{ fontSize: '11.5px', color: '#a7f3d0' }}>
                    {inspectingPackage.file?.name}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectingPackage(null)}
                style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Metadata</div>
                <div style={{ fontSize: '13px', color: '#1e293b' }}>
                  <strong>Exported At:</strong> {inspectingPackage.pkg?.createdAt ? new Date(inspectingPackage.pkg.createdAt).toLocaleString() : 'N/A'}
                </div>
                <div style={{ fontSize: '13px', color: '#1e293b' }}>
                  <strong>Exported By:</strong> {inspectingPackage.pkg?.createdBy?.fullName || 'Superadmin'} ({inspectingPackage.pkg?.createdBy?.email || 'N/A'})
                </div>
                <div style={{ fontSize: '13px', color: '#1e293b' }}>
                  <strong>Schema Version:</strong> {inspectingPackage.pkg?.schemaVersion || '1.0.0'}
                </div>
              </div>

              {/* Counts Breakdown */}
              <div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                  Preserved System Records
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  <div style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px' }}>
                    📦 <strong>Inventory Units:</strong> {inspectingPackage.validation?.stats?.inventoryUnitsCount || 0}
                  </div>
                  <div style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px' }}>
                    🚚 <strong>Shipments:</strong> {inspectingPackage.validation?.stats?.shipmentsCount || 0}
                  </div>
                  <div style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px' }}>
                    📱 <strong>Parts Master:</strong> {inspectingPackage.validation?.stats?.partsCount || 0}
                  </div>
                  <div style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px' }}>
                    🏢 <strong>Service Sites:</strong> {inspectingPackage.validation?.stats?.sitesCount || 0}
                  </div>
                  <div style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px' }}>
                    📑 <strong>Purchase Orders:</strong> {inspectingPackage.validation?.stats?.purchaseOrdersCount || 0}
                  </div>
                  <div style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px' }}>
                    👥 <strong>User Accounts:</strong> {inspectingPackage.validation?.stats?.usersCount || 0}
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setInspectingPackage(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setStagedBackupPackage(inspectingPackage.pkg);
                  setStagedValidation(inspectingPackage.validation);
                  setInspectingPackage(null);
                  setConfirmInputText('');
                  setIsConfirmModalOpen(true);
                }}
                style={{ background: '#059669', borderColor: '#047857' }}
              >
                Proceed to Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Safety Confirmation & Execution of System Restore */}
      {isConfirmModalOpen && stagedBackupPackage && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 10001 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isRestoring) {
              setIsConfirmModalOpen(false);
            }
          }}
        >
          <div className="modal-content" style={{ maxWidth: '560px', width: '95%', borderRadius: '12px' }}>
            <div className="modal-header" style={{ background: '#b91c1c', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertTriangle size={22} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '16.5px', fontWeight: 800 }}>
                    Confirm System Disaster Recovery &amp; Restore
                  </h3>
                  <div style={{ fontSize: '11.5px', color: '#fecaca' }}>
                    High-Security Operation • Superadmin Authorization Required
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#92400e', marginBottom: '4px' }}>
                  ⚠️ Critical Notice: Full System State Replacement
                </div>
                <div style={{ fontSize: '12.5px', color: '#b45309', lineHeight: 1.45 }}>
                  Restoring will hydrate the live system state with the records contained in this backup package. Current database records will be replaced and synchronized to Supabase PostgreSQL, and peer sessions will be notified.
                </div>
              </div>

              {/* Package Summary */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                  Target Backup Records to Restore:
                </div>
                <div style={{ fontSize: '12.5px', color: '#1e293b' }}>
                  {stagedValidation?.summary || 'Validated System Backup Package'}
                </div>
              </div>

              {/* Progress bar during restore */}
              {isRestoring && restoreProgress && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, color: '#047857' }}>
                    <span>Step {restoreProgress.step} of {restoreProgress.totalSteps}: {restoreProgress.title}</span>
                    <span>{restoreProgress.percent}%</span>
                  </div>
                  <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${restoreProgress.percent}%`,
                        background: '#059669',
                        transition: 'width 0.3s ease'
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                    {restoreProgress.description}
                  </div>
                </div>
              )}

              {/* Confirmation Input */}
              {!isRestoring && (
                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    Type <strong style={{ color: '#b91c1c' }}>RESTORE</strong> to confirm:
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="RESTORE"
                    value={confirmInputText}
                    onChange={(e) => setConfirmInputText(e.target.value)}
                    style={{
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      letterSpacing: '1px',
                      textTransform: 'uppercase'
                    }}
                  />
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isRestoring}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmExecuteRestore}
                disabled={isRestoring || confirmInputText.trim().toUpperCase() !== 'RESTORE'}
                style={{
                  background: '#b91c1c',
                  borderColor: '#991b1b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {isRestoring ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    <span>Restoring System State...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw size={14} />
                    <span>Confirm &amp; Restore System</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Google Service Account Credentials Configuration */}
      {isCredsModalOpen && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 10002 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCredsModalOpen(false);
          }}
        >
          <div className="modal-content" style={{ maxWidth: '620px', width: '95%', borderRadius: '12px' }}>
            <div className="modal-header" style={{ background: '#065f46', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <HardDrive size={22} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '16.5px', fontWeight: 800 }}>
                    Google Drive Service Account Configuration
                  </h3>
                  <div style={{ fontSize: '11.5px', color: '#a7f3d0' }}>
                    Shared Drive: MDC DC Logistics Archive (0AEWZPge3zfLtUk9PVA)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCredsModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px' }}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Active Service Bot Account</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
                  {GOOGLE_DRIVE_CONFIG.clientEmail}
                </div>
                <div style={{ fontSize: '11.5px', color: driveConfigured ? '#059669' : '#b45309', marginTop: '4px', fontWeight: 600 }}>
                  Status: {driveConfigured ? '✓ Key Configured and Active' : '⚠️ Private Key Not Yet Loaded'}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Paste Service Account Key (JSON or RSA Private Key PEM):
                </label>
                <textarea
                  className="form-control"
                  rows={8}
                  placeholder={`{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n...",\n  "client_email": "mdc-dc-storage-bot@..."\n}`}
                  value={pastedCreds}
                  onChange={(e) => setPastedCreds(e.target.value)}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '11.5px',
                    lineHeight: 1.4,
                    width: '100%',
                    padding: '10px'
                  }}
                />
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
                  Paste either the contents of <code>google-service-account.json</code> or the <code>-----BEGIN PRIVATE KEY-----</code> PEM block. It will be securely saved into your browser storage and connect immediately without restarting the server.
                </div>
              </div>

            </div>

            <div className="modal-footer" style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                {driveConfigured && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setGoogleDriveCredentialsOverride(null);
                      setDriveConfigured(isGoogleDriveConfigured());
                      showToast?.('Custom credentials cleared. Resetting to environment defaults.', 'info');
                    }}
                    style={{ fontSize: '12px', color: '#b91c1c' }}
                  >
                    Clear Custom Key
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsCredsModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveCredentialsOverride}
                  style={{
                    background: '#059669',
                    borderColor: '#047857'
                  }}
                >
                  Save &amp; Connect to Drive
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
