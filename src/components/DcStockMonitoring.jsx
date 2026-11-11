import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../supabase/client';
import { useApp } from '../context/AppContext';
import {
  LayoutDashboard,
  UploadCloud,
  Zap,
  Layers,
  Truck,
  DollarSign,
  AlertTriangle,
  FileSpreadsheet,
  Calendar,
  RefreshCw,
  Cloud,
  CloudOff
} from 'lucide-react';
import {
  DC_MONITORING_SLOTS,
  ingestDcMonitoringFile,
  ingestCompleteWorkbookFile,
  computeDcStockMonitoringAnalytics,
  parseOrderReportFile,
  alignShippingCostsWithOrderReports,
  ORDER_REPORT_BASELINE
} from '../utils/dcStockMonitoringEngine';
import {
  exportDcMonitoringToExcel,
  exportSdrRepTatToPdf
} from '../utils/dcStockMonitoringExporter';
import {
  loadDcMonitoringState,
  saveDcMonitoringDatasets,
  saveDcMonitoringLedger,
  syncDcMonitoringFromCloud,
  pullAvailableFixablySlotsFromAllStocks,
  clearAllDcMonitoringData,
  subscribeDcMonitoringSync
} from '../services/dcMonitoringStorageService';
import IngestionCenterPanel from './dc-monitoring/IngestionCenterPanel';
import SdrRepTatPanel from './dc-monitoring/SdrRepTatPanel';
import {
  OverviewPanel,
  SiteStocksAgingPanel,
  TransfersShippingPanel,
  SalesWarrantyPanel,
  ExceptionsReconciliationPanel
} from './dc-monitoring/DcOperationsPanels';

export default function DcStockMonitoring() {
  const { currentUser, showToast, broadcastCloudEvent } = useApp();
  const canPushToCloud = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';
  const currentUserName = currentUser?.fullName || currentUser?.email || 'Admin';
  const senderId = String(currentUser?.id || currentUser?.email || 'anon');
  const [cloudSyncState, setCloudSyncState] = useState({
    status: supabase ? 'idle' : 'offline',
    isSyncing: false,
    syncedBy: null,
    updatedAt: null
  });
  const isMountedRef = useRef(true);
  const lastFocusSyncAtRef = useRef(0);

  const [activeSubTab, setActiveSubTab] = useState('overview');
  const [datasets, setDatasets] = useState({});
  const [validationLogs, setValidationLogs] = useState({});
  const [shippingCosts, setShippingCosts] = useState([]);
  const [orderReportOrders, setOrderReportOrders] = useState(() => ORDER_REPORT_BASELINE?.orders || []);
  const [remarksMap, setRemarksMap] = useState({});
  const [inventoryYearFilter, setInventoryYearFilter] = useState('2026');
  const [referenceDate, setReferenceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const applySyncedStateToUi = useCallback((state, { switchFromIngestionIfLoaded = false } = {}) => {
    if (!isMountedRef.current || !state) return;
    setDatasets(state.datasets || {});
    setValidationLogs(state.validationLogs || {});
    if (Array.isArray(state.shippingCosts)) setShippingCosts(state.shippingCosts);
    if (Array.isArray(state.orderReportOrders)) setOrderReportOrders(state.orderReportOrders);
    if (state.remarksMap) setRemarksMap(state.remarksMap);
    const syncedCount = Object.values(state.datasets || {}).filter(v => Array.isArray(v) && v.length > 0).length;
    if (switchFromIngestionIfLoaded && syncedCount > 0) {
      setActiveSubTab(prev => (prev === 'ingestion' ? 'overview' : prev));
    }
  }, []);

  const runCloudSync = useCallback(async ({ localState = null, force = false, silent = true } = {}) => {
    if (!supabase) {
      if (isMountedRef.current) {
        setCloudSyncState(prev => ({ ...prev, status: 'offline', isSyncing: false }));
      }
      return null;
    }
    if (isMountedRef.current) {
      setCloudSyncState(prev => ({ ...prev, isSyncing: true }));
    }
    try {
      const res = await syncDcMonitoringFromCloud({
        localState,
        userName: currentUserName,
        canPushToCloud,
        force,
        broadcastCloudEvent,
        senderId
      });
      if (!isMountedRef.current) return res;

      if (res?.changed || res?.clearedFromCloud) {
        applySyncedStateToUi(res.state, { switchFromIngestionIfLoaded: !res.clearedFromCloud });
        if (!silent) {
          if (res.clearedFromCloud) {
            showToast?.('DC Stock Monitoring workspace cleared in Cloud', 'info');
          } else if (res.pulledSlots?.length > 0) {
            showToast?.(`Synced ${res.pulledSlots.length} dataset(s) from Cloud`, 'success');
          } else {
            showToast?.('Cloud sync complete — datasets are up to date', 'success');
          }
        }
      } else if (!silent) {
        if (res?.pushedSlots?.length > 0) {
          showToast?.(`Uploaded ${res.pushedSlots.length} local dataset(s) to Cloud`, 'success');
        } else {
          showToast?.('DC Stock Monitoring is already up to date with Cloud', 'info');
        }
      }

      if (res?.pushedSlots?.length > 0 && silent) {
        showToast?.(`Synced ${res.pushedSlots.length} local dataset(s) to Cloud for all admins`, 'success');
      }

      setCloudSyncState({
        status: res?.cloudStatus === 'offline' ? 'offline' : 'synced',
        isSyncing: false,
        syncedBy: res?.state?.syncedBy || currentUserName,
        updatedAt: res?.state?.updatedAt || new Date().toISOString()
      });
      return res;
    } catch (err) {
      if (isMountedRef.current) {
        setCloudSyncState(prev => ({ ...prev, isSyncing: false, status: 'offline' }));
        if (!silent) showToast?.(`Cloud sync failed: ${err?.message || err}`, 'error');
      }
      return null;
    }
  }, [applySyncedStateToUi, broadcastCloudEvent, canPushToCloud, currentUserName, senderId, showToast]);

  const hydrateFromStorage = useCallback(async ({ syncCloudAfter = true } = {}) => {
    try {
      const local = await loadDcMonitoringState();
      if (!isMountedRef.current) return;
      setDatasets(local.datasets || {});
      setValidationLogs(local.validationLogs || {});
      setShippingCosts(local.shippingCosts || []);
      setOrderReportOrders(local.orderReportOrders || ORDER_REPORT_BASELINE?.orders || []);
      setRemarksMap(local.remarksMap || {});

      const loadedCountLocal = Object.values(local.datasets || {}).filter(a => Array.isArray(a) && a.length > 0).length;
      if (loadedCountLocal === 0) {
        setActiveSubTab('ingestion');
      }
      setIsLoading(false);

      if (syncCloudAfter) {
        await runCloudSync({ localState: local, silent: true });
      }
    } catch (err) {
      console.warn('[DcStockMonitoring] Hydration notice:', err);
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [runCloudSync]);

  useEffect(() => {
    isMountedRef.current = true;
    hydrateFromStorage({ syncCloudAfter: true });

    const unsubLocalBroadcast = subscribeDcMonitoringSync(() => {
      hydrateFromStorage({ syncCloudAfter: false });
    });

    const handleCloudSignal = (ev) => {
      const detail = ev?.detail;
      if (!detail) return;
      if (detail.type === 'DC_MONITORING_CLEARED') {
        showToast?.(`Workspace cleared by ${detail.payload?.updatedBy || 'peer admin'}`, 'info');
      }
      runCloudSync({ silent: true });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('mdc:dc_monitoring_cloud_signal', handleCloudSignal);
    }

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusSyncAtRef.current < 15000) return;
      lastFocusSyncAtRef.current = now;
      runCloudSync({ silent: true });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleVisibilityOrFocus);
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    }

    return () => {
      isMountedRef.current = false;
      unsubLocalBroadcast();
      if (typeof window !== 'undefined') {
        window.removeEventListener('mdc:dc_monitoring_cloud_signal', handleCloudSignal);
        window.removeEventListener('focus', handleVisibilityOrFocus);
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      }
    };
  }, [hydrateFromStorage, runCloudSync, showToast]);

  const analytics = useMemo(() => (
    computeDcStockMonitoringAnalytics(datasets, {
      referenceDate,
      inventoryYearFilter,
      shippingCosts,
      orderReportOrders
    })
  ), [datasets, referenceDate, inventoryYearFilter, shippingCosts, orderReportOrders]);

  const handleUploadSlotFile = async (slotId, file) => {
    setIsProcessing(true);
    try {
      const { records, validationLog } = await ingestDcMonitoringFile(slotId, file);
      const nextLogs = { ...validationLogs, [slotId]: validationLog };
      setValidationLogs(nextLogs);

      if (validationLog.status === 'error') {
        await saveDcMonitoringDatasets(datasets, nextLogs, { skipCloud: true });
        showToast?.(validationLog.errors?.[0] || 'File validation failed', 'error');
        return;
      }

      const nextDatasets = { ...datasets, [slotId]: records };
      setDatasets(nextDatasets);
      const saveRes = await saveDcMonitoringDatasets(nextDatasets, nextLogs, {
        changedSlotIds: [slotId],
        userName: currentUserName,
        skipCloud: !canPushToCloud,
        broadcastCloudEvent,
        senderId
      });
      if (saveRes?.cloudSynced) {
        setCloudSyncState({ status: 'synced', isSyncing: false, syncedBy: currentUserName, updatedAt: saveRes.updatedAt });
      }
      showToast?.(`Loaded ${records.length.toLocaleString()} row(s) into ${slotId}${saveRes?.cloudSynced ? ' & synced to Cloud' : ''}`, 'success');
    } catch (err) {
      showToast?.(`Failed to parse file: ${err?.message || err}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUploadCompleteWorkbook = async (file) => {
    setIsProcessing(true);
    try {
      const result = await ingestCompleteWorkbookFile(file);
      const importedSlots = Object.keys(result.datasets || {});
      if (importedSlots.length === 0) {
        showToast?.('No matching DC Stock Monitoring input sheets found in workbook.', 'warning');
        return;
      }

      const nextDatasets = { ...datasets, ...result.datasets };
      const nextLogs = { ...validationLogs, ...result.validationLogs };
      setDatasets(nextDatasets);
      setValidationLogs(nextLogs);
      const saveRes = await saveDcMonitoringDatasets(nextDatasets, nextLogs, {
        changedSlotIds: importedSlots,
        userName: currentUserName,
        skipCloud: !canPushToCloud,
        broadcastCloudEvent,
        senderId
      });
      if (saveRes?.cloudSynced) {
        setCloudSyncState({ status: 'synced', isSyncing: false, syncedBy: currentUserName, updatedAt: saveRes.updatedAt });
      }

      let updatedCosts = shippingCosts;
      let updatedRemarks = remarksMap;
      let ledgerChanged = false;

      if (result.extras?.shippingCosts?.length > 0) {
        // Enforce Order Report (August to October) as authoritative source of truth
        updatedCosts = alignShippingCostsWithOrderReports(result.extras.shippingCosts);
        setShippingCosts(updatedCosts);
        ledgerChanged = true;
      }
      if (result.extras?.nonSerialRemarks && Object.keys(result.extras.nonSerialRemarks).length > 0) {
        updatedRemarks = { ...result.extras.nonSerialRemarks, ...remarksMap };
        setRemarksMap(updatedRemarks);
        ledgerChanged = true;
      }
      if (ledgerChanged) {
        await saveDcMonitoringLedger({
          shippingCosts: updatedCosts,
          orderReportOrders,
          remarksMap: updatedRemarks,
          userName: currentUserName,
          broadcastCloudEvent,
          senderId
        });
      }

      showToast?.(`Imported ${importedSlots.length} sheets from ${file.name}${canPushToCloud ? ' & synced to Cloud' : ''}`, 'success');
      setActiveSubTab('overview');
    } catch (err) {
      showToast?.(`Workbook import error: ${err?.message || err}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePullFromAllStocks = async () => {
    setIsProcessing(true);
    try {
      const { pulledDatasets, pulledLogs, pulledSlotIds, pulledCount } = await pullAvailableFixablySlotsFromAllStocks();
      if (pulledCount === 0) {
        showToast?.('No Fixably files found in All Stocks & Inventory cache yet.', 'info');
        return;
      }
      const nextDatasets = { ...datasets, ...pulledDatasets };
      const nextLogs = { ...validationLogs, ...pulledLogs };
      setDatasets(nextDatasets);
      setValidationLogs(nextLogs);
      const saveRes = await saveDcMonitoringDatasets(nextDatasets, nextLogs, {
        changedSlotIds: pulledSlotIds,
        userName: currentUserName,
        skipCloud: !canPushToCloud,
        broadcastCloudEvent,
        senderId
      });
      if (saveRes?.cloudSynced) {
        setCloudSyncState(prev => ({ ...prev, status: 'synced', syncedBy: currentUserName, updatedAt: saveRes.updatedAt }));
      }
      showToast?.(`Synced ${pulledCount} Fixably dataset(s) from All Stocks & Inventory${saveRes?.cloudSynced ? ' & Cloud' : ''}`, 'success');
    } catch (err) {
      showToast?.(`Sync error: ${err?.message || err}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearAll = async () => {
    setIsProcessing(true);
    try {
      await clearAllDcMonitoringData({
        userName: currentUserName,
        skipCloud: !canPushToCloud,
        broadcastCloudEvent,
        senderId
      });
      setDatasets({});
      setValidationLogs({});
      setCloudSyncState({ status: canPushToCloud ? 'synced' : 'idle', isSyncing: false, syncedBy: currentUserName, updatedAt: new Date().toISOString() });
      showToast?.(canPushToCloud ? 'Cleared DC Stock Monitoring datasets across workspace & Cloud' : 'Cleared local DC Stock Monitoring datasets', 'info');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveShippingCosts = async (nextCosts, { orderReportOrders: nextOrders = null } = {}) => {
    setShippingCosts(nextCosts);
    if (nextOrders) setOrderReportOrders(nextOrders);
    await saveDcMonitoringLedger({
      shippingCosts: nextCosts,
      orderReportOrders: nextOrders || orderReportOrders,
      remarksMap,
      userName: currentUserName,
      broadcastCloudEvent,
      senderId
    });
    showToast?.('Shipping cost ledger saved & synced to Cloud', 'success');
  };

  const handleUploadOrderReport = async (file) => {
    setIsProcessing(true);
    try {
      const parsed = await parseOrderReportFile(file);
      if (!parsed.success || parsed.completedCount === 0) {
        showToast?.('No completed delivery orders found in the uploaded Order Report.', 'warning');
        return;
      }

      // Merge monthly totals into shipping costs
      const currentCosts = [...shippingCosts];
      parsed.monthlyTotals.forEach(mTotal => {
        const existingIdx = currentCosts.findIndex(c => String(c.month).toLowerCase() === mTotal.month.toLowerCase());
        if (existingIdx !== -1) {
          currentCosts[existingIdx] = {
            ...currentCosts[existingIdx],
            amount: mTotal.amount,
            notes: mTotal.notes,
            isOrderReportVerified: true
          };
        } else {
          currentCosts.push(mTotal);
        }
      });

      const nextCosts = alignShippingCostsWithOrderReports(currentCosts);

      // Merge order items by orderId
      const existingOrders = Array.isArray(orderReportOrders) ? orderReportOrders : [];
      const orderIdMap = new Map();
      existingOrders.forEach(o => orderIdMap.set(o.orderId, o));
      parsed.orders.forEach(o => orderIdMap.set(o.orderId, o));
      const nextOrders = Array.from(orderIdMap.values());

      setShippingCosts(nextCosts);
      setOrderReportOrders(nextOrders);

      await saveDcMonitoringLedger({
        shippingCosts: nextCosts,
        orderReportOrders: nextOrders,
        remarksMap,
        userName: currentUserName,
        broadcastCloudEvent,
        senderId
      });

      const monthsStr = parsed.monthlyTotals.map(m => `${m.month} (₱${m.amount.toLocaleString()})`).join(', ');
      showToast?.(`Ingested ${parsed.completedCount} Order Report deliveries: ${monthsStr} as Source of Truth`, 'success');
    } catch (err) {
      showToast?.(`Order Report error: ${err?.message || err}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveRemark = async (key, remarkText) => {
    const nextRemarks = {
      ...remarksMap,
      [key]: {
        remark: remarkText,
        updatedBy: currentUserName,
        updatedAt: new Date().toISOString()
      }
    };
    setRemarksMap(nextRemarks);
    await saveDcMonitoringLedger({
      shippingCosts,
      remarksMap: nextRemarks,
      userName: currentUserName,
      broadcastCloudEvent,
      senderId
    });
    showToast?.('Investigation remark saved & synced to Cloud', 'success');
  };

  const loadedCount = DC_MONITORING_SLOTS.filter(s => Array.isArray(datasets[s.id]) && datasets[s.id].length > 0).length;

  const navTabs = [
    { id: 'overview', label: 'Executive Overview', icon: LayoutDashboard },
    { id: 'ingestion', label: `Ingestion (${loadedCount}/${DC_MONITORING_SLOTS.length})`, icon: UploadCloud },
    { id: 'sdr-reptat', label: 'SDR & RepTAT Breakdown', icon: Zap },
    { id: 'site-stocks', label: 'Site Stocks & Used Serials', icon: Layers },
    { id: 'transfers-shipping', label: 'DC Outbound Transfers', icon: Truck },
    { id: 'sales-warranty', label: 'Sales (DC) & Warranty', icon: DollarSign },
    { id: 'exceptions', label: 'Exceptions & Audit Queues', icon: AlertTriangle }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Top Action Header Card */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>DC Stock Monitoring &amp; Same-Day Repair (SDR) Intelligence</h2>
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
              Automated multi-file Fixably reconciliation, DC financial attribution, RepTAT analytics (2025 vs 2026), and exception workflows
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <Calendar size={14} /> Aging Anchor:
              <input
                type="date"
                value={referenceDate}
                onChange={(e) => e.target.value && setReferenceDate(e.target.value)}
                style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '12px' }}
              />
            </label>

            <select
              value={inventoryYearFilter}
              onChange={(e) => setInventoryYearFilter(e.target.value)}
              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '12px' }}
              title="Site Stock Received Year Filter"
            >
              <option value="2026">Site Stock Year: 2026 (Parity)</option>
              <option value="ALL">Site Stock Year: All Years</option>
            </select>

            <button
              type="button"
              className="btn btn-secondary"
              disabled={cloudSyncState.isSyncing}
              onClick={() => runCloudSync({ force: true, silent: false })}
              title={
                cloudSyncState.updatedAt
                  ? `Last synced ${new Date(cloudSyncState.updatedAt).toLocaleString()} by ${cloudSyncState.syncedBy || 'Admin'}`
                  : 'Sync uploaded datasets & reports across all admins'
              }
              style={{ fontSize: '12.5px', padding: '7px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {cloudSyncState.status === 'offline' ? (
                <CloudOff size={14} style={{ color: '#f59e0b' }} />
              ) : (
                <Cloud size={14} style={{ color: cloudSyncState.status === 'synced' ? '#10b981' : '#64748b' }} />
              )}
              <span>
                {cloudSyncState.isSyncing
                  ? 'Syncing...'
                  : (cloudSyncState.status === 'synced' ? 'Cloud Synced' : 'Sync Cloud')}
              </span>
              <RefreshCw size={13} className={cloudSyncState.isSyncing ? 'spin' : ''} />
            </button>

            <button
              type="button"
              className="btn btn-primary"
              disabled={loadedCount === 0}
              onClick={() => exportDcMonitoringToExcel(analytics, remarksMap)}
              style={{ fontSize: '12.5px', padding: '7px 14px' }}
            >
              <FileSpreadsheet size={15} /> Export Enhanced Workbook (.xlsx)
            </button>
          </div>
        </div>

        {/* Sub-navigation strip */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border-light)' }}>
          {navTabs.map(tab => {
            const Icon = tab.icon;
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '7px 13px', fontSize: '12.5px' }}
                onClick={() => setActiveSubTab(tab.id)}
              >
                <Icon size={14} /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCw size={24} className="spin" style={{ marginBottom: '8px' }} />
          <div>Loading DC Stock Monitoring datasets...</div>
        </div>
      ) : (
        <>
          {activeSubTab === 'overview' && (
            <OverviewPanel analytics={analytics} onNavigateTab={setActiveSubTab} />
          )}
          {activeSubTab === 'ingestion' && (
            <IngestionCenterPanel
              datasets={datasets}
              validationLogs={validationLogs}
              onUploadSlotFile={handleUploadSlotFile}
              onUploadCompleteWorkbook={handleUploadCompleteWorkbook}
              onUploadOrderReport={handleUploadOrderReport}
              onPullFromAllStocks={handlePullFromAllStocks}
              onClearAll={handleClearAll}
              isProcessing={isProcessing}
            />
          )}
          {activeSubTab === 'sdr-reptat' && (
            <SdrRepTatPanel
              analytics={analytics}
              onExportSdrPdf={() => exportSdrRepTatToPdf(analytics)}
            />
          )}
          {activeSubTab === 'site-stocks' && (
            <SiteStocksAgingPanel analytics={analytics} />
          )}
          {activeSubTab === 'transfers-shipping' && (
            <TransfersShippingPanel
              analytics={analytics}
              onSaveShippingCosts={handleSaveShippingCosts}
              onUploadOrderReport={handleUploadOrderReport}
            />
          )}
          {activeSubTab === 'sales-warranty' && (
            <SalesWarrantyPanel analytics={analytics} />
          )}
          {activeSubTab === 'exceptions' && (
            <ExceptionsReconciliationPanel
              analytics={analytics}
              remarksMap={remarksMap}
              onSaveRemark={handleSaveRemark}
            />
          )}
        </>
      )}
    </div>
  );
}
