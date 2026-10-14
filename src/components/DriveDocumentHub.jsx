import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  HardDrive,
  Cloud,
  FileText,
  FileSpreadsheet,
  Database,
  Search,
  RefreshCw,
  ExternalLink,
  Download,
  Eye,
  AlertTriangle,
  Building2,
  X,
  FileCheck,
  ShieldCheck,
  FolderOpen
} from 'lucide-react';
import {
  isGoogleDriveConfigured,
  listFilesInDriveFolder,
  downloadFromGoogleDrive,
  GOOGLE_DRIVE_CONFIG
} from '../services/googleDriveService';
import {
  getPendingOfflineUploads,
  processOfflineDriveQueue
} from '../services/driveOfflineQueueService';
import { formatTo12HourDateTime } from '../utils/dateUtils';

const DOC_CATEGORIES = [
  { id: 'all', label: 'All Documents', icon: FolderOpen, folderKey: null },
  { id: 'shipments', label: 'Packing Lists & Manifests', icon: FileText, folderKey: 'shipments' },
  { id: 'pmg_signed_pl', label: 'Signed Delivery Receipts', icon: FileCheck, folderKey: 'pmg_signed_pl' },
  { id: 'allocation', label: 'Allocation & Forecasts', icon: FileSpreadsheet, folderKey: 'allocation' },
  { id: 'backups', label: 'System Backups', icon: Database, folderKey: 'backups' }
];

export default function DriveDocumentHub() {
  const { sites = [], showToast } = useApp();

  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSite, setSelectedSite] = useState('ALL');
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  // Tab Switching Loading Popup Screen
  const [isTabLoadingModalOpen, setIsTabLoadingModalOpen] = useState(true);
  const [loadingTab, setLoadingTab] = useState(() => DOC_CATEGORIES[0]);

  // Preview Modal
  const [previewFile, setPreviewFile] = useState(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const driveAvailable = useMemo(() => isGoogleDriveConfigured(), []);

  // Fetch pending offline queue items
  const loadOfflineQueue = useCallback(async () => {
    try {
      const pending = await getPendingOfflineUploads();
      setOfflineQueue(pending || []);
    } catch (err) {
      console.warn('[DriveHub] Failed to fetch offline queue:', err);
    }
  }, []);

  // Fetch files from Google Drive
  const loadFiles = useCallback(async (targetCatId = activeCategory) => {
    if (!driveAvailable) {
      setIsTabLoadingModalOpen(false);
      return;
    }
    setIsLoading(true);
    const startMs = Date.now();
    try {
      if (targetCatId === 'all') {
        // Parallel fetch across key folders
        const [shipmentFiles, signedFiles, backupFiles, allocFiles] = await Promise.all([
          listFilesInDriveFolder('shipments', 40).catch(() => []),
          listFilesInDriveFolder('pmg_signed_pl', 40).catch(() => []),
          listFilesInDriveFolder('backups', 20).catch(() => []),
          listFilesInDriveFolder('allocation', 20).catch(() => [])
        ]);

        const taggedShipments = shipmentFiles.map(f => ({ ...f, docCategory: 'shipments' }));
        const taggedSigned = signedFiles.map(f => ({ ...f, docCategory: 'pmg_signed_pl' }));
        const taggedBackups = backupFiles.map(f => ({ ...f, docCategory: 'backups' }));
        const taggedAlloc = allocFiles.map(f => ({ ...f, docCategory: 'allocation' }));

        const merged = [...taggedShipments, ...taggedSigned, ...taggedBackups, ...taggedAlloc]
          .sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));

        setFiles(merged);
      } else {
        const catObj = DOC_CATEGORIES.find(c => c.id === targetCatId);
        if (catObj?.folderKey) {
          const list = await listFilesInDriveFolder(catObj.folderKey, 60);
          setFiles(list.map(f => ({ ...f, docCategory: targetCatId })));
        }
      }
    } catch (err) {
      console.error('[DriveHub] Failed to load files:', err);
      showToast?.('Unable to list Google Drive files', 'error');
    } finally {
      setIsLoading(false);
      const elapsed = Date.now() - startMs;
      const minDisplayMs = 450; // Smooth visual presentation
      const remainingWait = Math.max(0, minDisplayMs - elapsed);
      setTimeout(() => {
        setIsTabLoadingModalOpen(false);
      }, remainingWait);
    }
  }, [activeCategory, driveAvailable, showToast]);

  const handleTabSwitch = (cat) => {
    if (cat.id === activeCategory && !isLoading) return;
    setLoadingTab(cat);
    setIsTabLoadingModalOpen(true);
    setActiveCategory(cat.id);
  };

  const handleRefreshClick = () => {
    const currentCat = DOC_CATEGORIES.find(c => c.id === activeCategory) || DOC_CATEGORIES[0];
    setLoadingTab(currentCat);
    setIsTabLoadingModalOpen(true);
    loadFiles(activeCategory);
  };

  useEffect(() => {
    loadFiles(activeCategory);
    loadOfflineQueue();
  }, [loadFiles, loadOfflineQueue, activeCategory]);

  // Handle retry offline queue
  const handleProcessOfflineQueue = async () => {
    setIsProcessingQueue(true);
    try {
      const res = await processOfflineDriveQueue();
      showToast?.(`Offline queue processed: ${res.succeeded} uploaded, ${res.failed} remaining`, 'success');
      await loadOfflineQueue();
      await loadFiles();
    } catch (err) {
      console.error('[DriveHub] Error processing queue:', err);
      showToast?.('Error processing offline queue', 'error');
    } finally {
      setIsProcessingQueue(false);
    }
  };

  // Format file size
  const formatSize = (bytes) => {
    if (!bytes || isNaN(bytes)) return '—';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // Preview or download file
  const handleOpenPreview = async (file) => {
    setPreviewFile(file);
    setIsLoadingPreview(true);
    try {
      const res = await downloadFromGoogleDrive(file.id);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl(url);
    } catch (err) {
      console.warn('[DriveHub] Inline preview fetch failed, redirecting to webViewLink:', err);
      if (file.webViewLink) {
        window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
        setPreviewFile(null);
      } else {
        showToast?.('Failed to preview document', 'error');
      }
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleClosePreview = () => {
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewFile(null);
  };

  const handleDownload = async (file) => {
    try {
      showToast?.(`Downloading ${file.name}...`, 'info');
      const res = await downloadFromGoogleDrive(file.id);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[DriveHub] Download failed:', err);
      showToast?.('Download failed from Google Drive', 'error');
    }
  };

  // Filter files by query and site
  const filteredFiles = useMemo(() => {
    return files.filter(f => {
      const name = (f.name || '').toLowerCase();
      const invoiceRef = (f.appProperties?.invoiceRef || '').toLowerCase();
      const siteCode = (f.appProperties?.siteCode || f.appProperties?.siteFolder || '').toLowerCase();
      const q = searchQuery.toLowerCase().trim();

      const matchesSearch = !q || name.includes(q) || invoiceRef.includes(q) || siteCode.includes(q);

      let matchesSite = true;
      if (selectedSite !== 'ALL') {
        const cleanSite = selectedSite.toLowerCase();
        matchesSite = siteCode.includes(cleanSite) || name.includes(cleanSite);
      }

      return matchesSearch && matchesSite;
    });
  }, [files, searchQuery, selectedSite]);

  return (
    <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Banner & Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: '#eff6ff', color: '#2563eb', padding: '10px', borderRadius: '12px' }}>
              <HardDrive size={24} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>
                Google Drive Document Hub & Archive
              </h1>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                Centralized cloud archive for official packing lists, signed manifests, and allocation workbooks
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <a
            href={`https://drive.google.com/drive/folders/${GOOGLE_DRIVE_CONFIG.sharedDriveId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
          >
            <ExternalLink size={15} />
            Open Shared Drive
          </a>
          <button
            onClick={handleRefreshClick}
            disabled={isLoading}
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            Refresh Files
          </button>
        </div>
      </div>

      {/* Connection & Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px 20px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: driveAvailable ? '#f0fdf4' : '#fef2f2', color: driveAvailable ? '#16a34a' : '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {driveAvailable ? <ShieldCheck size={22} /> : <AlertTriangle size={22} />}
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Drive Connection</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
              {driveAvailable ? 'Service Account Active' : 'Not Configured'}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>MDC DC System Archive</div>
          </div>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px 20px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FolderOpen size={22} />
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Archived Files</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
              {files.length} <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>files loaded</span>
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Across 4 core directories</div>
          </div>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px 20px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: offlineQueue.length > 0 ? '#fffbeb' : '#f8fafc', color: offlineQueue.length > 0 ? '#d97706' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Cloud size={22} />
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Offline Queue</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: offlineQueue.length > 0 ? '#b45309' : '#0f172a' }}>
                {offlineQueue.length} Pending
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>IndexedDB Resilience</div>
            </div>
          </div>
          {offlineQueue.length > 0 && (
            <button
              onClick={handleProcessOfflineQueue}
              disabled={isProcessingQueue}
              className="btn btn-sm btn-secondary"
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              <RefreshCw size={12} className={isProcessingQueue ? 'animate-spin' : ''} />
              Sync Now
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', overflowX: 'auto' }}>
        {DOC_CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => handleTabSwitch(cat)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: isActive ? 700 : 500,
                border: 'none',
                cursor: 'pointer',
                background: isActive ? '#2563eb' : '#f1f5f9',
                color: isActive ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease'
              }}
            >
              <Icon size={16} />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Search & Site Filter Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Search by filename, invoice ref (e.g. DCMSPIOWNED#), or branch..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px 9px 38px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              background: '#ffffff'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={16} color="#64748b" />
          <select
            value={selectedSite}
            onChange={(e) => setSelectedSite(e.target.value)}
            style={{
              padding: '9px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              background: '#ffffff',
              outline: 'none',
              color: '#334155'
            }}
          >
            <option value="ALL">All Branch Sites (26 ASP)</option>
            {sites.map(s => (
              <option key={s.id || s.code} value={s.code || s.name}>
                {s.code ? `${s.code} – ${s.name}` : s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* File List / Data Grid */}
      <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
            Showing {filteredFiles.length} {filteredFiles.length === 1 ? 'document' : 'documents'}
          </span>
          {isLoading && (
            <span style={{ fontSize: '12px', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RefreshCw size={13} className="animate-spin" /> Fetching from Google Drive...
            </span>
          )}
        </div>

        {filteredFiles.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
            <FolderOpen size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p style={{ margin: 0, fontWeight: 600, fontSize: '15px', color: '#334155' }}>No archived files found</p>
            <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
              {searchQuery || selectedSite !== 'ALL' ? 'Try adjusting your search criteria or site filter' : 'Files will automatically appear here once dispatched or ingested'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Document Name</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Category & Metadata</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Branch Site</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Created Date</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Size</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFiles.map((file) => {
                  const isPdf = file.mimeType?.includes('pdf') || file.name?.endsWith('.pdf');
                  const isExcel = file.mimeType?.includes('spreadsheet') || file.name?.endsWith('.xlsx') || file.name?.endsWith('.csv');
                  const invoiceRef = file.appProperties?.invoiceRef;
                  const siteCode = file.appProperties?.siteCode || file.appProperties?.siteFolder;

                  return (
                    <tr
                      key={file.id}
                      style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.1s' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '12px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '6px',
                            background: isPdf ? '#fee2e2' : (isExcel ? '#dcfce7' : '#eff6ff'),
                            color: isPdf ? '#dc2626' : (isExcel ? '#16a34a' : '#2563eb'),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            {isPdf ? <FileText size={18} /> : (isExcel ? <FileSpreadsheet size={18} /> : <Database size={18} />)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>{file.name}</div>
                            {file.webViewLink && (
                              <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: '11px', color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              >
                                View in Drive <ExternalLink size={10} />
                              </a>
                            )}
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '12px 18px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {invoiceRef && (
                            <span style={{ background: '#f1f5f9', color: '#334155', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace' }}>
                              {invoiceRef}
                            </span>
                          )}
                          <span style={{
                            background: file.docCategory === 'pmg_signed_pl' ? '#dcfce7' : '#eff6ff',
                            color: file.docCategory === 'pmg_signed_pl' ? '#15803d' : '#1d4ed8',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600
                          }}>
                            {file.docCategory === 'pmg_signed_pl' ? 'Signed Receipt' : (file.docCategory === 'shipments' ? 'Packing List' : 'Archive')}
                          </span>
                        </div>
                      </td>

                      <td style={{ padding: '12px 18px' }}>
                        {siteCode ? (
                          <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                            {siteCode}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>Central DC</span>
                        )}
                      </td>

                      <td style={{ padding: '12px 18px', color: '#64748b' }}>
                        {file.createdTime ? formatTo12HourDateTime(file.createdTime) : '—'}
                      </td>

                      <td style={{ padding: '12px 18px', color: '#64748b', fontFamily: 'monospace' }}>
                        {formatSize(file.size)}
                      </td>

                      <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            onClick={() => handleOpenPreview(file)}
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '5px 8px', fontSize: '12px' }}
                            title="Preview Document"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => handleDownload(file)}
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '5px 8px', fontSize: '12px' }}
                            title="Download File"
                          >
                            <Download size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inline Preview Modal */}
      {previewFile && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(4px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '960px',
            height: '85vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)'
          }}>
            {/* Modal Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FileText size={20} color="#2563eb" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{previewFile.name}</h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Google Drive Document Preview</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {previewFile.webViewLink && (
                  <a
                    href={previewFile.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-sm btn-secondary"
                    style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <ExternalLink size={13} /> Open in Drive
                  </a>
                )}
                <button
                  onClick={handleClosePreview}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: '#64748b' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div style={{ flex: 1, position: 'relative', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isLoadingPreview ? (
                <div style={{ textAlign: 'center', color: '#475569' }}>
                  <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Streaming document from Google Drive...</p>
                </div>
              ) : previewBlobUrl ? (
                <iframe
                  src={previewBlobUrl}
                  title="Document Preview"
                  style={{ width: '100%', height: '100%', border: 'none' }}
                />
              ) : (
                <div style={{ textAlign: 'center', color: '#475569', padding: '24px' }}>
                  <AlertTriangle size={32} color="#f59e0b" style={{ margin: '0 auto 8px' }} />
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Preview not supported for this file format.</p>
                  {previewFile.webViewLink && (
                    <a
                      href={previewFile.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary"
                      style={{ marginTop: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      Open in Google Drive <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Centered Popup Window Loading Screen for Tab Switches */}
      {isTabLoadingModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              padding: '36px 40px',
              maxWidth: '440px',
              width: '90%',
              boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(226, 232, 240, 0.8)',
              border: '1px solid #e2e8f0',
              textAlign: 'center',
              animation: 'slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            {/* Themed Icon with Clean Encircling Orbit Spinner Ring (No Overlap) */}
            <div
              style={{
                position: 'relative',
                width: '84px',
                height: '84px',
                margin: '0 auto 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {/* Outer Circular Spinner Track & Rotating Blue Arc */}
              <svg
                viewBox="0 0 84 84"
                className="animate-spin"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none'
                }}
              >
                {/* Static Background Ring Track */}
                <circle
                  cx="42"
                  cy="42"
                  r="37"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="3.5"
                />
                {/* Dynamic Primary Rotating Arc */}
                <circle
                  cx="42"
                  cy="42"
                  r="37"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="3.5"
                  strokeDasharray="60 172"
                  strokeLinecap="round"
                />
              </svg>

              {/* Centered Crisp Icon Badge - 100% Unobstructed */}
              <div
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                  border: '1.5px solid #bfdbfe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px -2px rgba(37, 99, 235, 0.15)',
                  zIndex: 1
                }}
              >
                {(() => {
                  const TabIcon = loadingTab?.icon || HardDrive;
                  return <TabIcon size={26} color="#1d4ed8" />;
                })()}
              </div>
            </div>

            <h3
              style={{
                margin: '0 0 8px',
                fontSize: '18px',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.01em'
              }}
            >
              Loading {loadingTab?.label || 'Google Drive Archive'}...
            </h3>

            <p
              style={{
                margin: '0 0 20px',
                fontSize: '13px',
                color: '#64748b',
                lineHeight: 1.5
              }}
            >
              Streaming records and manifests from Google Workspace Shared Drive...
            </p>

            {/* Sub-badge: Shared Drive name */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                padding: '6px 14px',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#475569'
              }}
            >
              <Cloud size={14} color="#2563eb" />
              <span>MDC DC System Archive • Shared Drive</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
