/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { ALL_PAGES, PAGE_TITLES } from '../constants/navigation';
import {
  ROLE_PRESETS,
  ROLE_OPTIONS,
  getDefaultRolePosition,
  INITIAL_USERS,
  LEGACY_MOCK_EMAILS,
  LEGACY_MOCK_IDS
} from '../constants/roles';
import { LIVE_MASTER_RECORD_ID } from '../constants/config';
import { matchUserByEmail } from '../utils/userMatcher';
import { isUUID, safeUUID, reconcileUnitsWithPackedDrafts, canUserDeleteRecord } from '../utils/appContextHelpers';
import { isSupabaseConfigured } from '../supabase/client';

// Domain Hooks
import { useAuth } from './useAuth';
import { useUserManagement } from './useUserManagement';
import { useCatalogAndSites } from './useCatalogAndSites';
import { useForecastingAndAllocation } from './useForecastingAndAllocation';
import { useAuditLogs } from './useAuditLogs';
import { useInventory } from './useInventory';
import { useIntakeRecords } from './useIntakeRecords';
import { useShipments } from './useShipments';
import { usePartsRequests } from './usePartsRequests';
import { usePeriodRecordsAndReports } from './usePeriodRecordsAndReports';
import { useCloudSync } from './useCloudSync';

// Re-export constants and helpers for backward compatibility
export {
  ALL_PAGES,
  PAGE_TITLES,
  ROLE_PRESETS,
  ROLE_OPTIONS,
  getDefaultRolePosition,
  INITIAL_USERS,
  LEGACY_MOCK_EMAILS,
  LEGACY_MOCK_IDS,
  LIVE_MASTER_RECORD_ID,
  matchUserByEmail,
  isUUID,
  safeUUID,
  reconcileUnitsWithPackedDrafts,
  canUserDeleteRecord
};

import {
  DEFAULT_SELECTED_CATEGORIES,
  HARDWARE_CATEGORIES,
  isPartMatchingCategoryFilter
} from '../utils/categoryFilter.js';

export { DEFAULT_SELECTED_CATEGORIES, HARDWARE_CATEGORIES, isPartMatchingCategoryFilter };

const AppContext = createContext();

export function AppProvider({ children }) {
  const [activeTab, setActiveTabState] = useState(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
      if (ALL_PAGES.some(p => p.id === hash)) {
        return hash;
      }
    }
    const saved = typeof window !== 'undefined' ? localStorage.getItem('mdc_active_tab') : null;
    if (saved && ALL_PAGES.some(p => p.id === saved)) {
      return saved;
    }
    return 'dashboard';
  });

  const setActiveTab = (newTab) => {
    setActiveTabState(newTab);
  };

  const [selectedCategories, setSelectedCategoriesState] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_selected_categories');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return DEFAULT_SELECTED_CATEGORIES;
    } catch {
      return DEFAULT_SELECTED_CATEGORIES;
    }
  });

  const setSelectedCategories = useCallback((newCats) => {
    setSelectedCategoriesState((prev) => {
      const resolved = typeof newCats === 'function' ? newCats(prev) : newCats;
      const safeList = Array.isArray(resolved) && resolved.length > 0 ? resolved : DEFAULT_SELECTED_CATEGORIES;
      try {
        localStorage.setItem('mdc_selected_categories', JSON.stringify(safeList));
      } catch (e) {}
      return safeList;
    });
  }, []);

  const selectedCategory = useMemo(() => {
    if (selectedCategories.length === 2 && selectedCategories.includes('BATTERY') && selectedCategories.includes('DISPLAY')) {
      return 'ALL';
    }
    if (selectedCategories.length === 1) {
      return selectedCategories[0];
    }
    if (selectedCategories.length >= 5) {
      return 'ALL_PARTS';
    }
    return 'CUSTOM';
  }, [selectedCategories]);

  const setSelectedCategory = useCallback((val) => {
    if (val === 'ALL' || val === 'DEFAULT') {
      setSelectedCategories(DEFAULT_SELECTED_CATEGORIES);
    } else if (val === 'ALL_PARTS') {
      setSelectedCategories(HARDWARE_CATEGORIES.map(c => c.code));
    } else if (typeof val === 'string') {
      setSelectedCategories([val]);
    }
  }, [setSelectedCategories]);

  const [searchQuery, setSearchQuery] = useState('');
  const [pmgSubTab, setPmgSubTab] = useState('requests_table');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const [activePeriod, setActivePeriod] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_active_period');
      return saved ? JSON.parse(saved) : { month: 9, year: 2026, label: 'September 2026' };
    } catch {
      return { month: 9, year: 2026, label: 'September 2026' };
    }
  });

  // Sync activeTab to URL Hash and LocalStorage so page refreshes stay on the exact active page
  useEffect(() => {
    if (activeTab) {
      try {
        localStorage.setItem('mdc_active_tab', activeTab);
        if (window.location.hash.replace(/^#\/?/, '') !== activeTab) {
          window.history.replaceState(null, '', `#${activeTab}`);
        }
      } catch (e) {
        console.warn('Could not persist activeTab:', e);
      }
    }
  }, [activeTab]);

  // Listen for browser Back/Forward or manual URL hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '').trim();
      if (hash && ALL_PAGES.some(p => p.id === hash) && hash !== activeTab) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeTab]);

  const showToast = (message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast(null), 4000);
  };

  // Keyboard shortcut for Command Palette (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 1. Catalog & Sites Domain
  const catalogAndSites = useCatalogAndSites({
    showToast,
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    enqueueOfflineAction: (...args) => cloudSync.enqueueOfflineAction(...args),
    setCloudSyncStatus: (...args) => cloudSync.setCloudSyncStatus(...args)
  });

  // 2. User Management Domain
  const userManagement = useUserManagement({
    currentUser: null, // wired dynamically below
    setCurrentUser: (...args) => auth.setCurrentUser(...args),
    showToast,
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    enqueueOfflineAction: (...args) => cloudSync.enqueueOfflineAction(...args),
    setCloudSyncStatus: (...args) => cloudSync.setCloudSyncStatus(...args)
  });

  // 3. Auth Domain
  const auth = useAuth({
    usersList: userManagement.usersList,
    setUsersList: userManagement.setUsersList,
    showToast,
    hydrateFromSupabase: (...args) => cloudSync.hydrateFromSupabase(...args),
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    syncMasterUsersRegistry: userManagement.syncMasterUsersRegistry,
    setActiveTab
  });

  // 4. Audit Logs Domain
  const auditLogs = useAuditLogs({
    currentUser: auth.currentUser,
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    setScanLogs: (...args) => inventory.setScanLogs(...args)
  });

  // 5. Forecasting & Allocation Domain
  const forecastingAndAllocation = useForecastingAndAllocation({
    parts: catalogAndSites.parts,
    sites: catalogAndSites.sites,
    showToast,
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    setCloudSyncStatus: (...args) => cloudSync.setCloudSyncStatus(...args)
  });

  // 6. Period Records & Historical Snapshots Domain
  const periodRecords = usePeriodRecordsAndReports({
    currentUser: auth.currentUser,
    forecastItems: forecastingAndAllocation.forecastItems,
    setForecastItems: forecastingAndAllocation.setForecastItems,
    allocations: forecastingAndAllocation.allocations,
    setAllocations: forecastingAndAllocation.setAllocations,
    parts: catalogAndSites.parts,
    setParts: catalogAndSites.setParts,
    sites: catalogAndSites.sites,
    setSites: catalogAndSites.setSites,
    forecastingModel: forecastingAndAllocation.forecastingModel,
    setForecastingModel: forecastingAndAllocation.setForecastingModel,
    activePeriod,
    setActivePeriod,
    setActiveTab,
    showToast,
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    logDeletionAudit: auditLogs.logDeletionAudit,
    enqueueOfflineAction: (...args) => cloudSync.enqueueOfflineAction(...args),
    setCloudSyncStatus: (...args) => cloudSync.setCloudSyncStatus(...args)
  });

  // 7. Intake Records Domain
  const intakeRecords = useIntakeRecords({
    currentUser: auth.currentUser,
    showToast,
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    logDeletionAudit: auditLogs.logDeletionAudit,
    setInventoryUnits: (...args) => inventory.setInventoryUnits(...args),
    unmarkDeletedSerials: (...args) => inventory.unmarkDeletedSerials(...args),
    enqueueOfflineAction: (...args) => cloudSync.enqueueOfflineAction(...args),
    setCloudSyncStatus: (...args) => cloudSync.setCloudSyncStatus(...args)
  });

  // 8. Inventory Domain
  const inventory = useInventory({
    parts: catalogAndSites.parts,
    setParts: catalogAndSites.setParts,
    sites: catalogAndSites.sites,
    currentUser: auth.currentUser,
    showToast,
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    dcIntakeRecords: intakeRecords.dcIntakeRecords,
    setDcIntakeRecords: intakeRecords.setDcIntakeRecords,
    setShipments: (...args) => shipmentsDomain.setShipments(...args),
    setCloudSyncStatus: (...args) => cloudSync.setCloudSyncStatus(...args)
  });

  // 9. Shipments Domain
  const shipmentsDomain = useShipments({
    currentUser: auth.currentUser,
    parts: catalogAndSites.parts,
    sites: catalogAndSites.sites,
    showToast,
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    logDeletionAudit: auditLogs.logDeletionAudit,
    inventoryUnits: inventory.inventoryUnits,
    setInventoryUnits: inventory.setInventoryUnits,
    enqueueOfflineAction: (...args) => cloudSync.enqueueOfflineAction(...args),
    setCloudSyncStatus: (...args) => cloudSync.setCloudSyncStatus(...args)
  });

  // 10. Parts Requests Domain
  const partsRequestsDomain = usePartsRequests({
    currentUser: auth.currentUser,
    parts: catalogAndSites.parts,
    sites: catalogAndSites.sites,
    inventoryUnits: inventory.inventoryUnits,
    setInventoryUnits: inventory.setInventoryUnits,
    repairUsageRecords: inventory.repairUsageRecords,
    showToast,
    broadcastCloudEvent: (...args) => cloudSync.broadcastCloudEvent(...args),
    enqueueOfflineAction: (...args) => cloudSync.enqueueOfflineAction(...args),
    setCloudSyncStatus: (...args) => cloudSync.setCloudSyncStatus(...args)
  });

  // 11. Central Cloud Sync & Realtime Engine
  const cloudSync = useCloudSync({
    currentUser: auth.currentUser,
    setCurrentUser: auth.setCurrentUser,
    setPendingFirstTimeUser: auth.setPendingFirstTimeUser,
    activeTab,
    setActiveTab,
    activePeriod,
    setActivePeriod,
    showToast,
    usersList: userManagement.usersList,
    setUsersList: userManagement.setUsersList,
    categories: catalogAndSites.categories,
    setCategories: catalogAndSites.setCategories,
    sites: catalogAndSites.sites,
    setSites: catalogAndSites.setSites,
    parts: catalogAndSites.parts,
    setParts: catalogAndSites.setParts,
    forecastingModel: forecastingAndAllocation.forecastingModel,
    setForecastingModel: forecastingAndAllocation.setForecastingModel,
    forecastItems: forecastingAndAllocation.forecastItems,
    setForecastItems: forecastingAndAllocation.setForecastItems,
    allocations: forecastingAndAllocation.allocations,
    setAllocations: forecastingAndAllocation.setAllocations,
    inventoryUnits: inventory.inventoryUnits,
    setInventoryUnits: inventory.setInventoryUnits,
    purchaseOrders: inventory.purchaseOrders,
    setPurchaseOrders: inventory.setPurchaseOrders,
    shipments: shipmentsDomain.shipments,
    setShipments: shipmentsDomain.setShipments,
    activePackDraft: shipmentsDomain.activePackDraft,
    setActivePackDraft: shipmentsDomain.setActivePackDraft,
    scanLogs: inventory.scanLogs,
    setScanLogs: inventory.setScanLogs,
    repairUsageRecords: inventory.repairUsageRecords,
    setRepairUsageRecords: inventory.setRepairUsageRecords,
    savedRecords: periodRecords.savedRecords,
    setSavedRecords: periodRecords.setSavedRecords,
    stockTransferReports: periodRecords.stockTransferReports,
    setStockTransferReports: periodRecords.setStockTransferReports,
    stockTransferMetadata: periodRecords.stockTransferMetadata,
    setStockTransferMetadata: periodRecords.setStockTransferMetadata,
    dcIntakeRecords: intakeRecords.dcIntakeRecords,
    setDcIntakeRecords: intakeRecords.setDcIntakeRecords,
    partsRequests: partsRequestsDomain.partsRequests,
    setPartsRequests: partsRequestsDomain.setPartsRequests,
    uploadAuditLogs: auditLogs.uploadAuditLogs,
    setUploadAuditLogs: auditLogs.setUploadAuditLogs,
    deletionAuditLogs: auditLogs.deletionAuditLogs,
    setDeletionAuditLogs: auditLogs.setDeletionAuditLogs,
    logDeletionAudit: auditLogs.logDeletionAudit
  });

  const offlineQueue = [];

  return (
    <AppContext.Provider
      value={{
        // Nav & Filters
        activeTab,
        setActiveTab,
        selectedCategory,
        setSelectedCategory,
        selectedCategories,
        setSelectedCategories,
        isPartMatchingCategoryFilter,
        HARDWARE_CATEGORIES,
        DEFAULT_SELECTED_CATEGORIES,
        searchQuery,
        setSearchQuery,
        toast,
        showToast,
        activePeriod,
        setActivePeriod,
        cloudSyncStatus: cloudSync.cloudSyncStatus,

        // Auth & RBAC
        currentUser: auth.currentUser,
        isInitialSyncing: auth.isInitialSyncing,
        setIsInitialSyncing: auth.setIsInitialSyncing,
        usersList: userManagement.usersList,
        pendingFirstTimeUser: auth.pendingFirstTimeUser,
        setPendingFirstTimeUser: auth.setPendingFirstTimeUser,
        canAccess: auth.canAccess,
        canEdit: auth.canEdit,
        isReadOnly: auth.isReadOnly,
        verifyLoginEmail: auth.verifyLoginEmail,
        signInWithPassword: auth.signInWithPassword,
        createFirstTimePassword: auth.createFirstTimePassword,
        signOut: auth.signOut,
        provisionUser: userManagement.provisionUser,
        updateUser: userManagement.updateUser,
        updateUserRolePosition: userManagement.updateUserRolePosition,
        resetUserPassword: userManagement.resetUserPassword,
        deleteUser: userManagement.deleteUser,
        toggleUserPagePermission: userManagement.toggleUserPagePermission,
        applyRolePresetToUser: userManagement.applyRolePresetToUser,
        toggleUserActiveStatus: userManagement.toggleUserActiveStatus,
        canUserDeleteRecord,

        // Data Stores
        categories: catalogAndSites.categories,
        sites: catalogAndSites.sites,
        parts: catalogAndSites.parts,
        supervisorSettings: catalogAndSites.supervisorSettings,
        setSupervisorSettings: catalogAndSites.setSupervisorSettings,
        saveSupervisorSettings: catalogAndSites.saveSupervisorSettings,
        forecastingModel: forecastingAndAllocation.forecastingModel,
        setForecastingModel: forecastingAndAllocation.setForecastingModel,
        changeForecastingModel: forecastingAndAllocation.changeForecastingModel,
        forecastItems: forecastingAndAllocation.forecastItems,
        setForecastItems: forecastingAndAllocation.setForecastItems,
        allocations: forecastingAndAllocation.allocations,
        setAllocations: forecastingAndAllocation.setAllocations,
        inventoryUnits: inventory.inventoryUnits,
        setInventoryUnits: inventory.setInventoryUnits,
        purchaseOrders: inventory.purchaseOrders,
        shipments: shipmentsDomain.shipments,
        scanLogs: inventory.scanLogs,
        repairUsageRecords: inventory.repairUsageRecords,
        savedRecords: periodRecords.savedRecords,
        dcIntakeRecords: intakeRecords.dcIntakeRecords,
        setDcIntakeRecords: intakeRecords.setDcIntakeRecords,
        generateNextIntakeRecordId: intakeRecords.generateNextIntakeRecordId,
        saveIntakeRecord: intakeRecords.saveIntakeRecord,
        deleteIntakeRecord: intakeRecords.deleteIntakeRecord,
        // Parts Requests Domain
        partsRequests: partsRequestsDomain.partsRequests,
        setPartsRequests: partsRequestsDomain.setPartsRequests,
        isLoadingPartsRequests: partsRequestsDomain.isLoadingRequests,
        isFulfillmentUser: partsRequestsDomain.isFulfillmentUser,
        fetchPartsRequests: partsRequestsDomain.fetchPartsRequests,
        submitPartsRequest: partsRequestsDomain.submitPartsRequest,
        cancelPartsRequest: partsRequestsDomain.cancelPartsRequest,
        updatePartsRequestStatus: partsRequestsDomain.updatePartsRequestStatus,
        getStockOnHandForSite: partsRequestsDomain.getStockOnHandForSite,
        getAllSitesStockSummary: partsRequestsDomain.getAllSitesStockSummary,
        getUsedPartsForSite: partsRequestsDomain.getUsedPartsForSite,
        getUsedUnitsLog: partsRequestsDomain.getUsedUnitsLog,
        markUnitAsUsed: partsRequestsDomain.markUnitAsUsed,
        unmarkUnitAsUsed: partsRequestsDomain.unmarkUnitAsUsed,
        stockTransferReports: periodRecords.stockTransferReports,
        setStockTransferReports: periodRecords.setStockTransferReports,
        stockTransferMetadata: periodRecords.stockTransferMetadata,
        setStockTransferMetadata: periodRecords.setStockTransferMetadata,
        uploadAuditLogs: auditLogs.uploadAuditLogs,
        setUploadAuditLogs: auditLogs.setUploadAuditLogs,
        deletionAuditLogs: auditLogs.deletionAuditLogs,
        setDeletionAuditLogs: auditLogs.setDeletionAuditLogs,
        logDeletionAudit: auditLogs.logDeletionAudit,
        deleteAllAuditLogs: auditLogs.deleteAllAuditLogs,
        importStockTransfersReport: periodRecords.importStockTransfersReport,
        clearStockTransfersReport: periodRecords.clearStockTransfersReport,
        savePeriodRecord: periodRecords.savePeriodRecord,
        restorePeriodRecord: periodRecords.restorePeriodRecord,
        deletePeriodRecord: periodRecords.deletePeriodRecord,
        addScanInUnit: inventory.addScanInUnit,
        deleteScanInUnit: inventory.deleteScanInUnit,
        updateUnitAssignment: inventory.updateUnitAssignment,
        updateUnitDetails: inventory.updateUnitDetails,
        batchAddScanInUnits: inventory.batchAddScanInUnits,
        commitUnitsToStock: inventory.commitUnitsToStock,
        addScanOutUnit: inventory.addScanOutUnit,
        removeScanOutUnit: inventory.removeScanOutUnit,
        batchAddScanOutUnits: inventory.batchAddScanOutUnits,
        clearShipmentDraftItems: shipmentsDomain.clearShipmentDraftItems,
        activePackDraft: shipmentsDomain.activePackDraft,
        setActivePackDraft: shipmentsDomain.setActivePackDraft,
        syncActivePackDraftToCloud: shipmentsDomain.syncActivePackDraftToCloud,
        deleteShipment: shipmentsDomain.deleteShipment,
        batchImportShipments: shipmentsDomain.batchImportShipments,
        clearAllShipmentsData: shipmentsDomain.clearAllShipmentsData,
        saveShipment: shipmentsDomain.saveShipment,
        confirmSiteReceive: shipmentsDomain.confirmSiteReceive,
        updateForecastOverride: forecastingAndAllocation.updateForecastOverride,
        updateSiteAllocation: forecastingAndAllocation.updateSiteAllocation,
        runAutoAllocation: forecastingAndAllocation.runAutoAllocation,
        resetPartAllocation: forecastingAndAllocation.resetPartAllocation,
        resetAllAllocationsToCalculation: forecastingAndAllocation.resetAllAllocationsToCalculation,
        savePart: catalogAndSites.savePart,
        deletePart: catalogAndSites.deletePart,
        saveSite: catalogAndSites.saveSite,
        deleteSite: catalogAndSites.deleteSite,
        refreshSitesFromCloud: catalogAndSites.refreshSitesFromCloud,
        applyPmgDirectoryToSites: catalogAndSites.applyPmgDirectoryToSites,
        applyParsedDataset: cloudSync.applyParsedDataset,
        syncAllDataToCloud: cloudSync.syncAllDataToCloud,
        forceGlobalCloudSyncAndPurge: cloudSync.forceGlobalCloudSyncAndPurge,
        testDatabaseConnection: cloudSync.testDatabaseConnection,
        refreshDataFromCloud: cloudSync.refreshDataFromCloud,
        hydrateFromSupabase: cloudSync.hydrateFromSupabase,
        isAutoRefreshing: cloudSync.isAutoRefreshing,
        lastSyncedAt: cloudSync.lastSyncedAt,
        autoRefreshData: cloudSync.autoRefreshData,
        isSupabaseConfigured,
        realtimeConnected: cloudSync.realtimeConnected,
        offlineQueue,
        processOfflineSyncQueue: cloudSync.processOfflineSyncQueue,
        resetToDefaultData: cloudSync.resetToDefaultData,
        clearAllData: cloudSync.clearAllData,
        deleteAllStockUnits: inventory.deleteAllStockUnits,
        activePackingStations: cloudSync.activePackingStations,
        broadcastPackingPresence: cloudSync.broadcastPackingPresence,
        isCommandPaletteOpen,
        setIsCommandPaletteOpen,
        pmgSubTab,
        setPmgSubTab
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
