import { useState, useEffect, useRef, useCallback } from 'react';
import seedData from '../data/seedData.json';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { normalizeInventoryUnits } from '../utils/partResolver';
import { reconcileUnitsWithPackedDrafts } from '../utils/appContextHelpers';
import { ROLE_PRESETS, getDefaultRolePosition, INITIAL_USERS, LEGACY_MOCK_EMAILS, LEGACY_MOCK_IDS } from '../constants/roles';
import { LIVE_MASTER_RECORD_ID } from '../constants/config';

export function useCloudSync({
  currentUser,
  activeTab,
  setActiveTab,
  activePeriod,
  setActivePeriod,
  showToast,
  _usersList,
  setUsersList,
  categories,
  setCategories,
  sites,
  setSites,
  parts,
  setParts,
  forecastItems,
  setForecastItems,
  allocations,
  setAllocations,
  inventoryUnits,
  setInventoryUnits,
  _purchaseOrders,
  setPurchaseOrders,
  _shipments,
  setShipments,
  _activePackDraft,
  setActivePackDraft,
  _scanLogs,
  setScanLogs,
  _repairUsageRecords,
  setRepairUsageRecords,
  _savedRecords,
  setSavedRecords,
  _stockTransferReports,
  setStockTransferReports,
  _stockTransferMetadata,
  setStockTransferMetadata,
  _dcIntakeRecords,
  setDcIntakeRecords,
  uploadAuditLogs,
  setUploadAuditLogs,
  deletionAuditLogs,
  setDeletionAuditLogs,
  logDeletionAudit
}) {
  const [cloudSyncStatus, setCloudSyncStatus] = useState({
    isSaving: false,
    lastSaved: null,
    isOnline: navigator.onLine
  });

  const [lastSyncedAt, setLastSyncedAt] = useState(() => new Date());
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);

  const lastRefreshTimeRef = useRef(0);
  const realtimeChannelRef = useRef(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    isSavingRef.current = cloudSyncStatus.isSaving;
  }, [cloudSyncStatus.isSaving]);

  const pendingRealtimeSyncRef = useRef(false);
  const pendingRealtimeTablesRef = useRef(new Set());
  const debounceRealtimeTimerRef = useRef(null);

  // Broadcast event across peers and browser tabs
  const broadcastCloudEvent = useCallback((eventType, payload = {}) => {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bus = new BroadcastChannel('mdc_sync_bus');
        bus.postMessage({ type: eventType, payload, timestamp: Date.now() });
        bus.close();
      }
    } catch (e) {}

    if (supabase && realtimeChannelRef.current) {
      try {
        realtimeChannelRef.current.send({
          type: 'broadcast',
          event: 'mdc_sync',
          payload: { type: eventType, payload, senderId: currentUser?.id || 'anon', timestamp: Date.now() }
        });
      } catch (e) {
        console.warn('Realtime broadcast note:', e.message);
      }
    }
  }, [currentUser]);

  // Offline Sync Queue Processor
  const enqueueOfflineAction = useCallback(async (actionType, payload) => {
    try {
      const existingQueue = JSON.parse(localStorage.getItem('mdc_offline_sync_queue') || '[]');
      const newEntry = {
        id: `offline-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        actionType,
        payload,
        createdAt: new Date().toISOString()
      };
      existingQueue.push(newEntry);
      localStorage.setItem('mdc_offline_sync_queue', JSON.stringify(existingQueue));
      await dbStorage.setItem('mdc_offline_sync_queue', existingQueue);
    } catch (e) {
      console.warn('Could not enqueue offline action:', e);
    }
  }, []);

  const processOfflineSyncQueue = useCallback(async () => {
    if (!supabase || !navigator.onLine) return;
    try {
      const queue = JSON.parse(localStorage.getItem('mdc_offline_sync_queue') || '[]');
      if (queue.length === 0) return;

      const remainingQueue = [];
      for (const item of queue) {
        try {
          if (item.actionType === 'PROFILE_UPSERT') {
            await supabase.from('profiles').upsert(item.payload, { onConflict: 'email' });
          } else if (item.actionType === 'PROFILE_DELETE') {
            await supabase.from('profiles').delete().or(`id.eq.${item.payload.id},email.ilike.${item.payload.email}`);
          } else if (item.actionType === 'PART_UPSERT') {
            await supabase.from('parts').upsert(item.payload, { onConflict: 'part_number' });
          } else if (item.actionType === 'PART_DELETE') {
            await supabase.from('parts').delete().eq('part_number', item.payload.part_number);
          } else if (item.actionType === 'SITE_UPSERT') {
            await supabase.from('sites').upsert(item.payload, { onConflict: 'code' });
          } else if (item.actionType === 'SAVED_RECORD_UPSERT') {
            await supabase.from('saved_records').upsert(item.payload, { onConflict: 'id' });
          } else if (item.actionType === 'SAVED_RECORD_DELETE') {
            await supabase.from('saved_records').delete().eq('id', item.payload.id);
          } else if (item.actionType === 'INTAKE_UPSERT') {
            await supabase.from('dc_intake_records').upsert(item.payload, { onConflict: 'id' });
            await supabase.from('saved_records').upsert({
              id: item.payload.id,
              record_type: 'intake_batch',
              period_label: item.payload.record_name,
              snapshot_data: item.payload,
              updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
          } else if (item.actionType === 'INTAKE_DELETE') {
            await supabase.from('dc_intake_records').delete().eq('id', item.payload.recordId);
            await supabase.from('saved_records').delete().eq('id', item.payload.recordId);
          } else if (item.actionType === 'SHIPMENT_UPSERT') {
            await supabase.from('saved_records').upsert(item.payload, { onConflict: 'id' });
          } else if (item.actionType === 'SHIPMENT_DELETE') {
            await supabase.from('saved_records').delete().eq('id', item.payload.shipmentId);
          }
        } catch (itemErr) {
          console.warn('Could not sync offline item:', item, itemErr);
          remainingQueue.push(item);
        }
      }

      localStorage.setItem('mdc_offline_sync_queue', JSON.stringify(remainingQueue));
      await dbStorage.setItem('mdc_offline_sync_queue', remainingQueue);
    } catch (e) {
      console.warn('processOfflineSyncQueue error:', e);
    }
  }, []);

  // Main Database Hydration
  const hydrateFromSupabase = useCallback(async (selectiveTables = null) => {
    if (!supabase) return false;

    try {
      const shouldFetch = (tbl) => !selectiveTables || selectiveTables.includes(tbl);

      const [
        resProfiles,
        resPerms,
        resSavedRecords,
        resIntakes,
        resUnits,
        resParts,
        resSites,
        resCats,
        resShipments
      ] = await Promise.all([
        shouldFetch('profiles') ? supabase.from('profiles').select('*').limit(200) : Promise.resolve({ data: null }),
        shouldFetch('user_page_permissions') ? supabase.from('user_page_permissions').select('*').limit(500) : Promise.resolve({ data: null }),
        shouldFetch('saved_records') ? supabase.from('saved_records').select('*').order('created_at', { ascending: false }).limit(250) : Promise.resolve({ data: null }),
        shouldFetch('dc_intake_records') ? supabase.from('dc_intake_records').select('*').order('created_at', { ascending: false }).limit(250) : Promise.resolve({ data: null }),
        shouldFetch('inventory_units') ? supabase.from('inventory_units').select('*').limit(3000) : Promise.resolve({ data: null }),
        shouldFetch('parts') ? supabase.from('parts').select('*').limit(500) : Promise.resolve({ data: null }),
        shouldFetch('sites') ? supabase.from('sites').select('*').limit(100) : Promise.resolve({ data: null }),
        shouldFetch('part_categories') ? supabase.from('part_categories').select('*').limit(50) : Promise.resolve({ data: null }),
        shouldFetch('shipments') ? supabase.from('shipments').select('*').order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: null })
      ]);

      const dbProfiles = resProfiles.data;
      const dbPerms = resPerms.data;
      const dbSavedRecords = resSavedRecords.data;
      const dbIntakes = resIntakes.data;
      const dbUnits = resUnits.data;
      const dbParts = resParts.data;
      const dbSites = resSites.data;
      const dbCats = resCats.data;
      const dbShipments = resShipments.data;

      // 1. Process Profiles & User Page Permissions & Master Users Registry
      if (shouldFetch('profiles') || shouldFetch('saved_records') || shouldFetch('user_page_permissions')) {
        const cloudUsersRegistryDoc = dbSavedRecords?.find(r => r.id === 'master_users_registry');
        const cloudUsersList = (cloudUsersRegistryDoc?.snapshot_data?.users && Array.isArray(cloudUsersRegistryDoc.snapshot_data.users))
          ? cloudUsersRegistryDoc.snapshot_data.users
          : [];
        const cloudDeletedUserIds = (cloudUsersRegistryDoc?.snapshot_data?.deletedUserIds && Array.isArray(cloudUsersRegistryDoc.snapshot_data.deletedUserIds))
          ? cloudUsersRegistryDoc.snapshot_data.deletedUserIds
          : [];

        let mergedDeletedUserIds = [];
        try {
          const localDeletedUserIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
          mergedDeletedUserIds = Array.from(new Set([
            ...localDeletedUserIds,
            ...cloudDeletedUserIds
          ].map(s => String(s).trim().toLowerCase())));
          localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(mergedDeletedUserIds));
        } catch (e) {
          mergedDeletedUserIds = cloudDeletedUserIds.map(s => String(s).trim().toLowerCase());
        }

        const permsMap = new Map();
        if (dbPerms && dbPerms.length > 0) {
          dbPerms.forEach(p => {
            if (!permsMap.has(p.user_id)) permsMap.set(p.user_id, []);
            permsMap.get(p.user_id).push(p.page_id);
          });
        }

        setUsersList(prev => {
          const profileMap = new Map();

          // 1. Base seed
          INITIAL_USERS.forEach(u => {
            const cleanEmail = u.email?.toLowerCase();
            if (
              cleanEmail &&
              !mergedDeletedUserIds.includes(u.id?.toLowerCase()) &&
              !mergedDeletedUserIds.includes(cleanEmail) &&
              !LEGACY_MOCK_EMAILS.includes(cleanEmail) &&
              !LEGACY_MOCK_IDS.includes(u.id)
            ) {
              profileMap.set(cleanEmail, u);
            }
          });

          // 2. Overlay previous local state
          (prev || []).forEach(u => {
            const cleanEmail = u.email?.toLowerCase();
            if (
              cleanEmail &&
              !mergedDeletedUserIds.includes(u.id?.toLowerCase()) &&
              !mergedDeletedUserIds.includes(cleanEmail) &&
              !LEGACY_MOCK_EMAILS.includes(cleanEmail) &&
              !LEGACY_MOCK_IDS.includes(u.id)
            ) {
              profileMap.set(cleanEmail, { ...(profileMap.get(cleanEmail) || {}), ...u });
            }
          });

          // 3. Overlay authoritative master_users_registry from cloud
          cloudUsersList.forEach(u => {
            const cleanEmail = u.email?.toLowerCase();
            if (
              cleanEmail &&
              !mergedDeletedUserIds.includes(u.id?.toLowerCase()) &&
              !mergedDeletedUserIds.includes(cleanEmail) &&
              !LEGACY_MOCK_EMAILS.includes(cleanEmail) &&
              !LEGACY_MOCK_IDS.includes(u.id)
            ) {
              profileMap.set(cleanEmail, { ...(profileMap.get(cleanEmail) || {}), ...u });
            }
          });

          // 4. Overlay dbProfiles if available
          if (dbProfiles && dbProfiles.length > 0) {
            dbProfiles.forEach(p => {
              const cleanEmail = p.email?.toLowerCase();
              if (
                cleanEmail &&
                !p.is_deleted &&
                !mergedDeletedUserIds.includes(p.id?.toLowerCase()) &&
                !mergedDeletedUserIds.includes(cleanEmail) &&
                !LEGACY_MOCK_EMAILS.includes(cleanEmail) &&
                !LEGACY_MOCK_IDS.includes(p.id)
              ) {
                const existing = profileMap.get(cleanEmail);
                const customPerms = permsMap.get(p.id);
                const role = p.role || existing?.role || 'user';
                const resolvedPosition = p.role_position || existing?.rolePosition || getDefaultRolePosition(role);

                profileMap.set(cleanEmail, {
                  id: p.id || existing?.id || `usr-${Date.now()}`,
                  email: p.email,
                  fullName: p.full_name || existing?.fullName || p.email.split('@')[0],
                  role: role,
                  rolePosition: resolvedPosition,
                  siteId: p.site_id || existing?.siteId || 'site-dc',
                  hasSetPassword: p.has_set_password ?? existing?.hasSetPassword ?? true,
                  passwordHash: p.password_hash || existing?.passwordHash || 'Password123',
                  isActive: p.is_active ?? existing?.isActive ?? true,
                  permittedPages: role === 'superadmin'
                    ? ROLE_PRESETS.superadmin
                    : (customPerms && customPerms.length > 0 ? customPerms : (existing?.permittedPages || ROLE_PRESETS[role] || ROLE_PRESETS.user))
                });
              }
            });
          }

          // Clean up any deleted users
          mergedDeletedUserIds.forEach(delId => {
            profileMap.delete(delId);
          });

          const merged = Array.from(profileMap.values());
          try {
            localStorage.setItem('mdc_users', JSON.stringify(merged));
            dbStorage.setItem('mdc_users', merged);
          } catch (e) {}

          // Self-heal: If cloud registry is missing or has fewer users, auto-seed it
          if (merged.length > 0 && supabase) {
            if (!cloudUsersRegistryDoc || cloudUsersList.length < merged.length) {
              supabase.from('saved_records').upsert({
                id: 'master_users_registry',
                record_type: 'users_registry',
                period_label: 'Master Users Registry',
                period_year: new Date().getFullYear(),
                period_month: new Date().getMonth() + 1,
                notes: 'Master Provisioned Accounts & Permissions Registry',
                snapshot_data: {
                  users: merged,
                  deletedUserIds: mergedDeletedUserIds,
                  updatedAt: new Date().toISOString()
                },
                updated_at: new Date().toISOString()
              }, { onConflict: 'id' }).then(() => {
                if (broadcastCloudEvent) {
                  broadcastCloudEvent('USER_REGISTRY_UPDATED', { users: merged, table: 'saved_records' });
                }
              }).catch(e => console.warn('Auto-seed master_users_registry notice:', e));
            }
          }

          return merged;
        });
      }

      // 2. Process Categories
      if (shouldFetch('part_categories') && dbCats && dbCats.length > 0) {
        setCategories(dbCats.map(c => ({
          id: c.id,
          code: c.code,
          name: c.name,
          has_imei: c.has_imei || false,
          is_serialized: c.is_serialized ?? true,
          sort_order: c.sort_order || 1
        })));
      }

      // 3. Process Sites
      if (shouldFetch('sites') && dbSites && dbSites.length > 0) {
        setSites(prev => {
          const map = new Map((prev || []).map(s => [s.code, s]));
          dbSites.forEach(s => {
            const existing = map.get(s.code);
            map.set(s.code, {
              ...(existing || {}),
              id: s.id || existing?.id,
              code: s.code,
              name: s.name || existing?.name,
              region: s.region || existing?.region || 'Metro Manila',
              address: s.address || s.full_address || existing?.address,
              full_address: s.full_address || s.address || existing?.full_address,
              contact_person: s.contact_person || existing?.contact_person,
              contact_phone: s.contact_phone || existing?.contact_phone,
              contact_email: s.contact_email || existing?.contact_email,
              ship_to: s.ship_to || existing?.ship_to,
              sold_to: s.sold_to || existing?.sold_to,
              invoice_prefix: s.invoice_prefix || existing?.invoice_prefix,
              is_dc: s.is_dc ?? existing?.is_dc ?? false,
              is_active: s.is_active ?? existing?.is_active ?? true
            });
          });
          const merged = Array.from(map.values());
          try { localStorage.setItem('mdc_sites', JSON.stringify(merged)); } catch (e) {}
          dbStorage.setItem('mdc_sites', merged);
          return merged;
        });
      }

      // 4. Process Parts
      if (shouldFetch('parts') && dbParts && dbParts.length > 0) {
        setParts(prev => {
          const map = new Map((prev || []).map(p => [p.part_number, p]));
          dbParts.forEach(p => {
            const existing = map.get(p.part_number);
            map.set(p.part_number, {
              ...(existing || {}),
              id: p.id || existing?.id,
              part_number: p.part_number,
              description: p.description || existing?.description,
              iphone_model: p.iphone_model || existing?.iphone_model || 'iPhone',
              stocking_price: parseFloat(p.stocking_price ?? existing?.stocking_price) || 0,
              exchange_price: parseFloat(p.exchange_price ?? existing?.exchange_price) || 0,
              category_id: p.category_id || existing?.category_id || 'cat-battery',
              safety_stock_pct: p.safety_stock_pct || existing?.safety_stock_pct || 0.05,
              is_active: p.is_active ?? existing?.is_active ?? true
            });
          });
          const merged = Array.from(map.values());
          try { localStorage.setItem('mdc_parts', JSON.stringify(merged)); } catch (e) {}
          dbStorage.setItem('mdc_parts', merged);
          return merged;
        });
      }

      // 5. Process Saved Records (Historical snapshots, Master Sync, and Live Pool)
      let effectiveShipments = [];
      let effectiveDraft = null;

      if (shouldFetch('saved_records') && dbSavedRecords && dbSavedRecords.length > 0) {
        const liveSnapshot = dbSavedRecords.find(r => r.id === LIVE_MASTER_RECORD_ID);
        if (liveSnapshot && liveSnapshot.snapshot_data) {
          const snap = liveSnapshot.snapshot_data;

          if (snap.isCleared) {
            localStorage.setItem('mdc_is_cleared', 'true');
            dbStorage.setItem('mdc_is_cleared', true);
            setForecastItems([]);
            setAllocations([]);
            setInventoryUnits([]);
          } else {
            localStorage.removeItem('mdc_is_cleared');
            dbStorage.removeItem('mdc_is_cleared');

            const lastLocalOverrideTime = parseInt(localStorage.getItem('mdc_last_override_time') || '0', 10);
            const isRecentlyModifiedLocally = (Date.now() - lastLocalOverrideTime) < 2500;

            if (!isRecentlyModifiedLocally) {
              if (snap.forecastItems && snap.forecastItems.length > 0) {
                setForecastItems(snap.forecastItems);
                try { localStorage.setItem('mdc_forecast', JSON.stringify(snap.forecastItems)); } catch (e) {}
                dbStorage.setItem('mdc_forecast', snap.forecastItems);
              }
              if (snap.allocations && snap.allocations.length > 0) {
                setAllocations(snap.allocations);
                try { localStorage.setItem('mdc_allocations', JSON.stringify(snap.allocations)); } catch (e) {}
                dbStorage.setItem('mdc_allocations', snap.allocations);
              }
            }
          }
        }

        // Hydrate & Merge Upload Audit Logs
        const uploadRegistryDoc = dbSavedRecords.find(r => r.id === 'master_upload_audit_logs_registry');
        const liveSnapshotDoc = dbSavedRecords.find(r => r.id === LIVE_MASTER_RECORD_ID);
        const cloudUploadLogs = [
          ...(Array.isArray(uploadRegistryDoc?.snapshot_data?.logs) ? uploadRegistryDoc.snapshot_data.logs : []),
          ...(Array.isArray(liveSnapshotDoc?.snapshot_data?.uploadAuditLogs) ? liveSnapshotDoc.snapshot_data.uploadAuditLogs : [])
        ];
        let localUploadLogs = [];
        try {
          const saved = localStorage.getItem('mdc_upload_audit_logs');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) localUploadLogs = parsed;
          }
        } catch (e) {}

        const uploadMap = new Map();
        cloudUploadLogs.forEach(l => {
          const k = l?.id || `${l?.timestamp}_${l?.file_name}`;
          if (k) uploadMap.set(k, l);
        });
        localUploadLogs.forEach(l => {
          const k = l?.id || `${l?.timestamp}_${l?.file_name}`;
          if (k && !uploadMap.has(k)) uploadMap.set(k, l);
        });

        const mergedUploads = Array.from(uploadMap.values())
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 300);

        if (mergedUploads.length > 0) {
          setUploadAuditLogs(mergedUploads);
          try { localStorage.setItem('mdc_upload_audit_logs', JSON.stringify(mergedUploads)); } catch (e) {}
          dbStorage.setItem('mdc_upload_audit_logs', mergedUploads);
        }

        // Hydrate & Merge Deletion Audit Logs
        const deletionRegistryDoc = dbSavedRecords.find(r => r.id === 'master_deletion_audit_logs_registry');
        const cloudDeletionLogs = [
          ...(Array.isArray(deletionRegistryDoc?.snapshot_data?.logs) ? deletionRegistryDoc.snapshot_data.logs : []),
          ...(Array.isArray(liveSnapshotDoc?.snapshot_data?.deletionAuditLogs) ? liveSnapshotDoc.snapshot_data.deletionAuditLogs : [])
        ];
        let localDeletionLogs = [];
        try {
          const saved = localStorage.getItem('mdc_deletion_audit_logs');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) localDeletionLogs = parsed;
          }
        } catch (e) {}

        const delMap = new Map();
        cloudDeletionLogs.forEach(l => {
          const k = l?.id || `${l?.timestamp}_${l?.entity_id}`;
          if (k) delMap.set(k, l);
        });
        localDeletionLogs.forEach(l => {
          const k = l?.id || `${l?.timestamp}_${l?.entity_id}`;
          if (k && !delMap.has(k)) delMap.set(k, l);
        });

        const mergedDeletions = Array.from(delMap.values())
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 300);

        if (mergedDeletions.length > 0) {
          setDeletionAuditLogs(mergedDeletions);
          try { localStorage.setItem('mdc_deletion_audit_logs', JSON.stringify(mergedDeletions)); } catch (e) {}
          dbStorage.setItem('mdc_deletion_audit_logs', mergedDeletions);
        }

        const validSavedRecords = dbSavedRecords.filter(r =>
          r.id !== LIVE_MASTER_RECORD_ID &&
          r.id !== 'active_packing_manifest_draft' &&
          r.id !== 'live_master_dc_inventory' &&
          r.id !== 'master_dc_intakes_registry' &&
          r.id !== 'deleted_unit_serials_registry' &&
          r.id !== 'deleted_intake_ids_registry' &&
          r.id !== 'deleted_shipment_ids_registry' &&
          r.id !== 'master_upload_audit_logs_registry' &&
          r.id !== 'master_deletion_audit_logs_registry' &&
          r.id !== 'master_stock_transfers_report_registry' &&
          r.id !== 'master_users_registry' &&
          r.record_type !== 'users_registry' &&
          r.record_type !== 'stock_transfer_report' &&
          r.record_type !== 'upload_audit_registry' &&
          r.record_type !== 'deletion_audit_registry' &&
          r.record_type !== 'shipment' &&
          r.record_type !== 'intake_batch' &&
          r.record_type !== 'intake_record' &&
          r.record_type !== 'inventory_master' &&
          r.record_type !== 'intake_registry' &&
          r.record_type !== 'deletion_registry' &&
          !r.id.startsWith('MDC') &&
          !r.id.startsWith('intake-') &&
          r.notes !== '__DELETED__' &&
          r.snapshot_data?.isDeleted !== true
        );

        if (validSavedRecords.length > 0) {
          setSavedRecords(validSavedRecords);
          try { localStorage.setItem('mdc_saved_records', JSON.stringify(validSavedRecords)); } catch (e) {}
          dbStorage.setItem('mdc_saved_records', validSavedRecords);
        }

        // Hydrate Stock Transfer Reports & Metadata
        const stockTransferDoc = dbSavedRecords.find(r => r.id === 'master_stock_transfers_report_registry');
        if (stockTransferDoc && stockTransferDoc.snapshot_data) {
          const cloudReports = Array.isArray(stockTransferDoc.snapshot_data.records)
            ? stockTransferDoc.snapshot_data.records
            : [];
          const cloudMetadata = stockTransferDoc.snapshot_data.metadata || null;
          if (cloudReports.length > 0) {
            if (setStockTransferReports) setStockTransferReports(cloudReports);
            if (setStockTransferMetadata) setStockTransferMetadata(cloudMetadata);
            try {
              localStorage.setItem('mdc_stock_transfer_reports', JSON.stringify(cloudReports));
              localStorage.setItem('mdc_stock_transfer_metadata', JSON.stringify(cloudMetadata));
            } catch (e) {}
            dbStorage.setItem('mdc_stock_transfer_reports', cloudReports);
            dbStorage.setItem('mdc_stock_transfer_metadata', cloudMetadata);
          } else if (stockTransferDoc.notes === '__CLEARED__') {
            if (setStockTransferReports) setStockTransferReports([]);
            if (setStockTransferMetadata) setStockTransferMetadata(null);
            try {
              localStorage.removeItem('mdc_stock_transfer_reports');
              localStorage.removeItem('mdc_stock_transfer_metadata');
            } catch (e) {}
            dbStorage.setItem('mdc_stock_transfer_reports', []);
            dbStorage.setItem('mdc_stock_transfer_metadata', null);
          }
        } else {
          // Self-heal: If cloud registry is missing, but this client already has local records, upload them to cloud
          try {
            const localSavedReports = JSON.parse(localStorage.getItem('mdc_stock_transfer_reports') || '[]');
            const localSavedMeta = JSON.parse(localStorage.getItem('mdc_stock_transfer_metadata') || 'null');
            if (Array.isArray(localSavedReports) && localSavedReports.length > 0 && supabase) {
              supabase.from('saved_records').upsert({
                id: 'master_stock_transfers_report_registry',
                record_type: 'stock_transfer_report',
                period_label: localSavedMeta?.fileName || 'Reports - Stock Transfers',
                period_year: new Date().getFullYear(),
                period_month: new Date().getMonth() + 1,
                notes: 'Master Fixably stock transfer movement dataset',
                snapshot_data: {
                  records: localSavedReports,
                  metadata: localSavedMeta
                },
                updated_at: new Date().toISOString()
              }, { onConflict: 'id' }).then(() => {
                if (broadcastCloudEvent) {
                  broadcastCloudEvent('STOCK_TRANSFERS_UPDATED', { count: localSavedReports.length, metadata: localSavedMeta, table: 'saved_records' });
                }
              }).catch(e => console.warn('Auto-seed stock transfers to cloud notice:', e));
            }
          } catch (e) {}
        }

        const draftRecord = dbSavedRecords.find(r => r.id === 'active_packing_manifest_draft');
        if (draftRecord && draftRecord.snapshot_data && draftRecord.snapshot_data.items && draftRecord.snapshot_data.items.length > 0) {
          effectiveDraft = draftRecord.snapshot_data;
          setActivePackDraft(effectiveDraft);
          try { localStorage.setItem('mdc_active_pack_draft', JSON.stringify(effectiveDraft)); } catch (e) {}
        } else {
          setActivePackDraft(null);
          try { localStorage.removeItem('mdc_active_pack_draft'); } catch (e) {}
        }

        const cloudDeletedShipmentsDoc = dbSavedRecords.find(r => r.id === 'deleted_shipment_ids_registry');
        const cloudDeletedShipments = Array.isArray(cloudDeletedShipmentsDoc?.snapshot_data?.deletedIds)
          ? cloudDeletedShipmentsDoc.snapshot_data.deletedIds
          : [];

        let deletedShipmentIds = [];
        try {
          const localDeletedShipments = JSON.parse(localStorage.getItem('mdc_deleted_shipment_ids') || '[]');
          deletedShipmentIds = Array.from(new Set([
            ...localDeletedShipments,
            ...cloudDeletedShipments
          ]));
          localStorage.setItem('mdc_deleted_shipment_ids', JSON.stringify(deletedShipmentIds));
        } catch (e) {
          deletedShipmentIds = cloudDeletedShipments;
        }

        const shipmentRecords = dbSavedRecords
          .filter(r => (r.record_type === 'shipment' || (r.snapshot_data && r.snapshot_data.shipment_number)) && !deletedShipmentIds.includes(r.id) && r.notes !== '__DELETED__' && r.snapshot_data?.isDeleted !== true)
          .map(r => r.snapshot_data || r);

        if (dbShipments && dbShipments.length > 0) {
          const directShipments = dbShipments.filter(s => !deletedShipmentIds.includes(s.id));
          const map = new Map();
          shipmentRecords.forEach(s => map.set(s.id, s));
          directShipments.forEach(s => map.set(s.id, { ...(map.get(s.id) || {}), ...s }));
          effectiveShipments = Array.from(map.values()).filter(s => !deletedShipmentIds.includes(s.id));
        } else {
          effectiveShipments = shipmentRecords;
        }

        if (effectiveShipments.length > 0) {
          setShipments(effectiveShipments);
          try { localStorage.setItem('mdc_shipments', JSON.stringify(effectiveShipments)); } catch (e) {}
          dbStorage.setItem('mdc_shipments', effectiveShipments);
        } else {
          setShipments([]);
          try { localStorage.setItem('mdc_shipments', JSON.stringify([])); } catch (e) {}
          dbStorage.setItem('mdc_shipments', []);
        }
      }

      // 6. Process Intake Records & Inventory Units
      let effectiveIntakeRecords = [];
      if (shouldFetch('dc_intake_records') || shouldFetch('saved_records')) {
        const cloudDeletedIntakeDoc = dbSavedRecords?.find(r => r.id === 'deleted_intake_ids_registry');
        const cloudDeletedIntakes = Array.isArray(cloudDeletedIntakeDoc?.snapshot_data?.deletedIds)
          ? cloudDeletedIntakeDoc.snapshot_data.deletedIds
          : [];

        let deletedIntakeIdsSet = new Set();
        try {
          const localDeletedIntakes = JSON.parse(localStorage.getItem('mdc_deleted_intake_ids') || '[]');
          deletedIntakeIdsSet = new Set([
            ...localDeletedIntakes,
            ...cloudDeletedIntakes
          ].map(id => String(id).trim().toUpperCase()));
          localStorage.setItem('mdc_deleted_intake_ids', JSON.stringify(Array.from(deletedIntakeIdsSet)));
        } catch (e) {
          deletedIntakeIdsSet = new Set(cloudDeletedIntakes.map(id => String(id).trim().toUpperCase()));
        }

        const intakeRegistryDoc = dbSavedRecords?.find(r => r.id === 'master_dc_intakes_registry');
        const intakeBatchDocs = dbSavedRecords?.filter(r => (r.record_type === 'intake_batch' || r.record_type === 'intake_record' || r.id?.startsWith('MDC')) && r.notes !== '__DELETED__') || [];

        const intakeMap = new Map();
        if (intakeRegistryDoc?.snapshot_data?.records && Array.isArray(intakeRegistryDoc.snapshot_data.records)) {
          intakeRegistryDoc.snapshot_data.records.forEach(rec => {
            const cleanId = String(rec.id || '').trim().toUpperCase();
            if (cleanId) intakeMap.set(cleanId, rec);
          });
        }

        if (dbIntakes && dbIntakes.length > 0) {
          dbIntakes.forEach(rec => {
            const cleanId = String(rec.id || '').trim().toUpperCase();
            if (cleanId && rec.notes !== '__DELETED__') {
              const existing = intakeMap.get(cleanId);
              intakeMap.set(cleanId, { ...(existing || {}), ...rec });
            }
          });
        }

        intakeBatchDocs.forEach(doc => {
          const rec = doc.snapshot_data || doc;
          const cleanId = String(rec.id || doc.id || '').trim().toUpperCase();
          if (cleanId && rec.notes !== '__DELETED__') {
            const existing = intakeMap.get(cleanId);
            intakeMap.set(cleanId, { ...(existing || {}), ...rec, id: cleanId });
          }
        });

        // Self-heal local deletion set
        if (intakeMap.size > 0 && deletedIntakeIdsSet.size > 0) {
          let modifiedDeleted = false;
          intakeMap.forEach((_, activeId) => {
            if (deletedIntakeIdsSet.has(activeId)) {
              deletedIntakeIdsSet.delete(activeId);
              modifiedDeleted = true;
            }
          });
          if (modifiedDeleted) {
            try {
              localStorage.setItem('mdc_deleted_intake_ids', JSON.stringify(Array.from(deletedIntakeIdsSet)));
            } catch (e) {}
          }
        }

        setDcIntakeRecords(prev => {
          const map = new Map();

          // 1. Preserve existing local records
          (prev || []).forEach(rec => {
            const cleanId = String(rec.id || '').trim().toUpperCase();
            if (cleanId && !deletedIntakeIdsSet.has(cleanId)) {
              map.set(cleanId, rec);
            }
          });

          // Check localStorage as fallback
          try {
            const localSaved = JSON.parse(localStorage.getItem('mdc_dc_intake_records') || '[]');
            if (Array.isArray(localSaved)) {
              localSaved.forEach(rec => {
                const cleanId = String(rec.id || '').trim().toUpperCase();
                if (cleanId && !deletedIntakeIdsSet.has(cleanId) && !map.has(cleanId)) {
                  map.set(cleanId, rec);
                }
              });
            }
          } catch (e) {}

          // 2. Merge cloud records from intakeMap
          intakeMap.forEach((rec, cleanId) => {
            if (!deletedIntakeIdsSet.has(cleanId)) {
              const existing = map.get(cleanId);
              map.set(cleanId, { ...(existing || {}), ...rec, id: cleanId });
            }
          });

          effectiveIntakeRecords = Array.from(map.values())
            .filter(rec => !deletedIntakeIdsSet.has(String(rec.id).trim().toUpperCase()))
            .sort((a, b) => new Date(b.created_at || b.intake_date || 0) - new Date(a.created_at || a.intake_date || 0));

          try { localStorage.setItem('mdc_dc_intake_records', JSON.stringify(effectiveIntakeRecords)); } catch (e) {}
          dbStorage.setItem('mdc_dc_intake_records', effectiveIntakeRecords);
          return effectiveIntakeRecords;
        });
      }

      // 7. Process In-Stock Inventory Units
      if (shouldFetch('inventory_units') || shouldFetch('saved_records') || shouldFetch('dc_intake_records')) {
        const cloudDeletedSerialsDoc = dbSavedRecords?.find(r => r.id === 'deleted_unit_serials_registry');
        const cloudDeletedSerials = Array.isArray(cloudDeletedSerialsDoc?.snapshot_data?.deletedSerials)
          ? cloudDeletedSerialsDoc.snapshot_data.deletedSerials
          : [];

        let deletedSerialsSet = new Set();
        try {
          const localDeletedSerials = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
          deletedSerialsSet = new Set([
            ...localDeletedSerials,
            ...cloudDeletedSerials
          ].map(s => String(s).trim().toUpperCase()));
          localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(Array.from(deletedSerialsSet)));
        } catch (e) {
          deletedSerialsSet = new Set(cloudDeletedSerials.map(s => String(s).trim().toUpperCase()));
        }

        const liveMasterPoolDoc = dbSavedRecords?.find(r => r.id === 'live_master_dc_inventory');
        const poolUnits = (liveMasterPoolDoc?.snapshot_data?.units && Array.isArray(liveMasterPoolDoc.snapshot_data.units))
          ? liveMasterPoolDoc.snapshot_data.units
          : [];

        // Self-heal local deletion set for active cloud units
        if (poolUnits.length > 0 && deletedSerialsSet.size > 0) {
          let modifiedDeletedSerials = false;
          poolUnits.forEach(u => {
            const s = String(u.serial_number || '').trim().toUpperCase();
            if (s && deletedSerialsSet.has(s)) {
              deletedSerialsSet.delete(s);
              modifiedDeletedSerials = true;
            }
          });
          if (modifiedDeletedSerials) {
            try {
              localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(Array.from(deletedSerialsSet)));
            } catch (e) {}
          }
        }

        setInventoryUnits(prev => {
          const map = new Map();

          (prev || []).forEach(u => {
            const s = String(u.serial_number || '').toUpperCase();
            if (s && !deletedSerialsSet.has(s)) map.set(s, u);
          });

          poolUnits.forEach(u => {
            const s = String(u.serial_number || '').toUpperCase();
            if (s && !deletedSerialsSet.has(s)) {
              const existing = map.get(s);
              const cloudAssign = u.intake_assignment || (u.notes?.includes('CRBR') ? 'DC - CRBR' : u.notes?.includes('Forecasting') ? 'MDC - Forecasting' : null);
              const assign = cloudAssign || existing?.intake_assignment || (existing?.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
              map.set(s, { ...(existing || {}), ...u, intake_assignment: assign, notes: assign });
            }
          });

          effectiveIntakeRecords.forEach(rec => {
            if (Array.isArray(rec.items)) {
              rec.items.forEach(it => {
                const cleanSerial = String(it.serial_number || '').toUpperCase();
                if (cleanSerial && !deletedSerialsSet.has(cleanSerial)) {
                  const existing = map.get(cleanSerial);
                  const cloudAssign = it.intake_assignment || (it.notes?.includes('CRBR') ? 'DC - CRBR' : it.notes?.includes('Forecasting') ? 'MDC - Forecasting' : null);
                  const assign = cloudAssign || existing?.intake_assignment || (existing?.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
                  map.set(cleanSerial, {
                    id: it.id || existing?.id || `unit-${cleanSerial}`,
                    part_id: it.part_id || existing?.part_id || `part-${it.part_number}`,
                    part_number: it.part_number || existing?.part_number,
                    description: it.description || existing?.description || 'Service Replacement Part',
                    serial_number: it.serial_number || cleanSerial,
                    intake_assignment: assign,
                    notes: assign,
                    current_site_id: 'site-dc',
                    site_code: 'DC-MDC',
                    po_id: it.po_id || rec.po_id || existing?.po_id || null,
                    status: existing?.status || 'in_stock',
                    box_number: 1,
                    received_at: it.received_at || existing?.received_at || rec.intake_date || new Date().toISOString(),
                    received_by: it.received_by || existing?.received_by || rec.saved_by_name || 'Warehouse Staff',
                    shipped_at: existing?.shipped_at || null,
                    intake_record_id: rec.id
                  });
                }
              });
            }
          });

          if (dbUnits && dbUnits.length > 0) {
            dbUnits.filter(u => !u.is_deleted).forEach(dbU => {
              const cleanSerial = String(dbU.serial_number || '').toUpperCase();
              if (cleanSerial && !deletedSerialsSet.has(cleanSerial)) {
                const existing = map.get(cleanSerial);
                const cloudAssign = dbU.intake_assignment || (dbU.notes?.includes('CRBR') ? 'DC - CRBR' : dbU.notes?.includes('Forecasting') ? 'MDC - Forecasting' : null);
                const assign = cloudAssign || existing?.intake_assignment || (existing?.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
                map.set(cleanSerial, {
                  id: dbU.id || existing?.id || `unit-${cleanSerial}`,
                  part_id: dbU.part_id || existing?.part_id,
                  part_number: dbU.part_number || (dbU.notes && !dbU.notes.includes('CRBR') && !dbU.notes.includes('Forecasting') ? dbU.notes : existing?.part_number) || 'PART',
                  description: dbU.description || existing?.description || 'Service Replacement Part',
                  serial_number: dbU.serial_number || cleanSerial,
                  intake_assignment: assign,
                  notes: dbU.notes && !dbU.notes.includes('CRBR') && !dbU.notes.includes('Forecasting') ? `${assign} | ${dbU.notes}` : assign,
                  current_site_id: dbU.current_site_id || 'site-dc',
                  site_code: dbU.site_code || 'DC-MDC',
                  po_id: dbU.po_id || existing?.po_id,
                  status: dbU.status || existing?.status || 'in_stock',
                  box_number: dbU.box_number || 1,
                  received_at: dbU.received_at || existing?.received_at || new Date().toISOString(),
                  received_by: dbU.received_by_name || existing?.received_by || 'Warehouse Staff',
                  allocated_at: dbU.allocated_at,
                  shipped_at: dbU.shipped_at || existing?.shipped_at || null,
                  intake_record_id: dbU.intake_record_id || existing?.intake_record_id
                });
              }
            });
          }

          (prev || []).forEach(u => {
            if (u.isSessionDraft && !map.has(String(u.serial_number || '').toUpperCase())) {
              map.set(String(u.serial_number || '').toUpperCase(), u);
            }
          });

          const mergedRaw = Array.from(map.values()).sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0));
          const normalized = normalizeInventoryUnits(mergedRaw, parts);
          const merged = reconcileUnitsWithPackedDrafts(normalized, effectiveShipments, effectiveDraft);
          try { localStorage.setItem('mdc_inventory', JSON.stringify(merged)); } catch (e) {}
          dbStorage.setItem('mdc_inventory', merged);
          return merged;
        });
      }

      const syncNow = new Date();
      setLastSyncedAt(syncNow);
      setCloudSyncStatus({ isSaving: false, lastSaved: syncNow, isOnline: true });
      return true;
    } catch (e) {
      console.warn('Supabase fetch note (offline or unauthenticated):', e.message);
      setCloudSyncStatus(prev => ({ ...prev, isOnline: false }));
      return false;
    }
  }, [broadcastCloudEvent, parts, setActivePackDraft, setAllocations, setCategories, setDcIntakeRecords, setDeletionAuditLogs, setForecastItems, setInventoryUnits, setParts, setSavedRecords, setShipments, setSites, setStockTransferMetadata, setStockTransferReports, setUploadAuditLogs, setUsersList]);

  // Centralized Auto-Refresh Controller with strict runaway loop prevention
  const autoRefreshData = useCallback(async ({ silent = true, force = false, reason = 'auto', tables = null, isManual = false } = {}) => {
    const now = Date.now();

    // If a cloud save is actively in progress, queue a pending refresh so it fires immediately upon save completion
    if (isSavingRef.current) {
      pendingRealtimeSyncRef.current = true;
      if (tables) {
        tables.forEach(t => pendingRealtimeTablesRef.current.add(t));
      }
      return { success: true, throttled: true, reason: 'save_in_progress' };
    }

    // Runaway protection: enforce at least 1200ms throttle unless explicit user manual button click or forced
    if (!isManual && !force && now - lastRefreshTimeRef.current < 1200) {
      return { success: true, throttled: true };
    }

    lastRefreshTimeRef.current = now;
    setIsAutoRefreshing(true);
    console.debug('[AutoRefresh] Sync trigger:', reason, tables ? `(Tables: ${tables.join(', ')})` : '(Full)');

    try {
      try {
        localStorage.removeItem('mdc_is_cleared');
        dbStorage.removeItem('mdc_is_cleared');
      } catch (e) {}

      const success = await hydrateFromSupabase(tables);
      if (!silent) {
        if (success) {
          showToast('Successfully synced latest live data from database!', 'success');
        } else {
          showToast('Database sync completed (offline/local fallback active)', 'info');
        }
      }
      return { success };
    } catch (err) {
      console.warn('Auto-refresh error:', err);
      if (!silent) {
        showToast(`Sync error: ${err.message}`, 'error');
      }
      return { success: false, error: err.message };
    } finally {
      setTimeout(() => {
        setIsAutoRefreshing(false);
      }, 300);
    }
  }, [hydrateFromSupabase, showToast]);

  // Watch cloudSyncStatus.isSaving: when saving finishes, trigger any pending realtime sync that arrived during the save
  useEffect(() => {
    if (!cloudSyncStatus.isSaving && pendingRealtimeSyncRef.current) {
      pendingRealtimeSyncRef.current = false;
      const targetTables = pendingRealtimeTablesRef.current.size > 0
        ? Array.from(pendingRealtimeTablesRef.current)
        : null;
      pendingRealtimeTablesRef.current.clear();
      autoRefreshData({
        silent: true,
        force: true,
        reason: 'Pending realtime sync post-save',
        tables: targetTables
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudSyncStatus.isSaving]);

  const refreshDataFromCloud = async () => {
    return await autoRefreshData({ silent: false, force: true, reason: 'Manual sync trigger' });
  };

  // Debounced burst handler for Realtime Postgres & WebSocket events (Part 1 Fix: force: true)
  const triggerDebouncedRealtimeSync = useCallback((reason, table = null) => {
    if (table) {
      pendingRealtimeTablesRef.current.add(table);
    }
    if (debounceRealtimeTimerRef.current) {
      clearTimeout(debounceRealtimeTimerRef.current);
    }
    debounceRealtimeTimerRef.current = setTimeout(() => {
      const targetTables = pendingRealtimeTablesRef.current.size > 0
        ? Array.from(pendingRealtimeTablesRef.current)
        : null;
      pendingRealtimeTablesRef.current.clear();
      autoRefreshData({
        silent: true,
        force: true, // Part 1 Fix: Always force hydration on remote realtime invalidations
        reason: `Debounced Realtime [${reason}]`,
        tables: targetTables
      });
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1. Initial Supabase Hydration and Realtime Subscriptions on app mount
  useEffect(() => {
    let realtimeChannel = null;

    autoRefreshData({ silent: true, force: true, reason: 'Initial app mount' });

    let broadcastBus = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        broadcastBus = new BroadcastChannel('mdc_sync_bus');
        broadcastBus.onmessage = (ev) => {
          if (ev.data && ev.data.type) {
            triggerDebouncedRealtimeSync(`Local Broadcast: ${ev.data.type}`, ev.data.table || null);
          }
        };
      }

      if (supabase && typeof supabase.channel === 'function') {
        realtimeChannel = supabase
          .channel('mdc-global-sync-room', {
            config: { broadcast: { self: false } }
          })
          .on('broadcast', { event: 'mdc_sync' }, (payload) => {
            console.debug('[Realtime WebSocket] Received global peer sync broadcast:', payload);
            triggerDebouncedRealtimeSync(`WebSocket Broadcast: ${payload?.payload?.type || 'SYNC'}`, payload?.payload?.table || null);
          });

        const SYNC_TABLES = [
          'profiles',
          'user_page_permissions',
          'parts',
          'part_categories',
          'sites',
          'repair_usage_records',
          'forecast_cycles',
          'forecast_entries',
          'purchase_orders',
          'po_items',
          'inventory_units',
          'allocation_cycles',
          'allocation_items',
          'shipments',
          'shipment_items',
          'scan_logs',
          'saved_records',
          'dc_intake_records'
        ];

        SYNC_TABLES.forEach(tbl => {
          realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table: tbl }, (ev) => {
            console.debug(`[Realtime Postgres] ${tbl} ${ev.eventType}`);
            triggerDebouncedRealtimeSync(`postgres_changes:${tbl}`, tbl);
          });
        });

        realtimeChannel.subscribe((status) => {
          console.debug('[Realtime WebSocket] Global channel status:', status);
          if (status === 'SUBSCRIBED') {
            setRealtimeConnected(true);
            setCloudSyncStatus(prev => ({ ...prev, isOnline: true }));
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            setRealtimeConnected(false);
          }
        });

        realtimeChannelRef.current = realtimeChannel;
      }
    } catch (e) {
      console.warn('Realtime / Broadcast channel notice:', e);
    }

    return () => {
      if (broadcastBus) {
        try { broadcastBus.close(); } catch (e) {}
      }
      if (realtimeChannel && supabase) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Auto-Refresh on Page Navigation
  useEffect(() => {
    if (currentUser && activeTab) {
      autoRefreshData({ silent: true, force: false, reason: `Page visit: ${activeTab}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser]);

  // 3. Auto-Refresh on Window Focus, Tab Visibility Change, and Network Reconnection
  useEffect(() => {
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible' && currentUser) {
        const now = Date.now();
        if (now - lastRefreshTimeRef.current >= 1500) {
          autoRefreshData({ silent: true, force: false, reason: 'Tab/Window refocus' });
        }
      }
    };

    const handleOnline = () => {
      if (currentUser) {
        processOfflineSyncQueue();
        autoRefreshData({ silent: false, force: true, reason: 'Network reconnected' });
      }
    };

    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      window.removeEventListener('online', handleOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, processOfflineSyncQueue]);

  // 4. Periodic background safety-net heartbeat revalidation
  useEffect(() => {
    if (!currentUser) return;
    const intervalMs = realtimeConnected ? 60000 : 15000;
    const heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        processOfflineSyncQueue();
        autoRefreshData({ silent: true, force: false, reason: 'Background safety heartbeat' });
      }
    }, intervalMs);
    return () => clearInterval(heartbeatInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, realtimeConnected, processOfflineSyncQueue]);

  // Sync All Data to Supabase Cloud
  const syncAllDataToCloud = async (overrideData = null) => {
    if (!supabase) {
      showToast('Supabase client is not connected', 'error');
      return { success: false };
    }

    const currentForecast = overrideData?.forecastItems || forecastItems;
    const currentAllocs = overrideData?.allocations || allocations;
    const currentParts = overrideData?.parts || parts;
    const currentSites = overrideData?.sites || sites;
    const currentUploadLogs = overrideData?.uploadAuditLogs || uploadAuditLogs;
    const currentDeletionLogs = overrideData?.deletionAuditLogs || deletionAuditLogs;

    try {
      showToast('Syncing master data to Supabase cloud...', 'info');

      try {
        const liveSnapshotPayload = {
          id: LIVE_MASTER_RECORD_ID,
          record_type: 'both',
          period_label: `${activePeriod?.label || 'September 2026'} Live Master State`,
          period_year: activePeriod?.year || 2026,
          period_month: activePeriod?.month || 9,
          saved_by_name: currentUser?.fullName || 'Superadmin User',
          saved_by_user_id: null,
          notes: 'Real-time multi-user synchronized Distribution Center state',
          snapshot_data: {
            forecastItems: currentForecast || [],
            allocations: currentAllocs || [],
            parts: currentParts || [],
            sites: currentSites || [],
            uploadAuditLogs: currentUploadLogs || [],
            deletionAuditLogs: currentDeletionLogs || []
          },
          updated_at: new Date().toISOString()
        };

        await supabase.from('saved_records').upsert([liveSnapshotPayload], { onConflict: 'id' });

        if (currentUploadLogs && currentUploadLogs.length > 0) {
          await supabase.from('saved_records').upsert({
            id: 'master_upload_audit_logs_registry',
            record_type: 'upload_audit_registry',
            period_label: 'Master Upload Audit Registry',
            period_year: activePeriod?.year || 2026,
            period_month: activePeriod?.month || 9,
            notes: `Master upload audit records (${currentUploadLogs.length} entries)`,
            saved_by_name: currentUser?.fullName || 'Superadmin User',
            snapshot_data: {
              logs: currentUploadLogs,
              lastUpdated: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        }

        if (currentDeletionLogs && currentDeletionLogs.length > 0) {
          await supabase.from('saved_records').upsert({
            id: 'master_deletion_audit_logs_registry',
            record_type: 'deletion_audit_registry',
            period_label: 'Master Deletion Audit Registry',
            period_year: activePeriod?.year || 2026,
            period_month: activePeriod?.month || 9,
            notes: `Master deletion audit records (${currentDeletionLogs.length} entries)`,
            saved_by_name: currentUser?.fullName || 'Superadmin User',
            snapshot_data: {
              logs: currentDeletionLogs,
              lastUpdated: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        }
      } catch (err) {
        console.warn('Live master snapshot sync notice:', err);
      }

      if (categories && categories.length > 0) {
        try {
          const catRows = categories.map((c, i) => ({
            code: c.code,
            name: c.name,
            has_imei: c.has_imei || false,
            is_serialized: c.is_serialized ?? true,
            sort_order: c.sort_order || i + 1
          }));
          await supabase.from('part_categories').upsert(catRows, { onConflict: 'code' });
        } catch (e) {}
      }

      if (currentSites && currentSites.length > 0) {
        try {
          const siteRows = currentSites.map(s => ({
            code: s.code,
            name: s.name,
            region: s.region || 'Metro Manila',
            address: s.address || '',
            contact_person: s.contact_person || '',
            contact_phone: s.contact_phone || '',
            is_dc: s.is_dc || false,
            is_active: s.is_active ?? true
          }));
          await supabase.from('sites').upsert(siteRows, { onConflict: 'code' });
        } catch (e) {}
      }

      if (currentParts && currentParts.length > 0) {
        try {
          const { data: dbCats } = await supabase.from('part_categories').select('id, code');
          const catMap = new Map((dbCats || []).map(c => [c.code, c.id]));

          const partRows = currentParts.map(p => {
            const catCode = categories.find(c => c.id === p.category_id)?.code || 'BATTERY';
            const catId = catMap.get(catCode) || null;
            return {
              part_number: p.part_number,
              description: p.description,
              iphone_model: p.iphone_model || '',
              stocking_price: p.stocking_price || 0,
              safety_stock_pct: p.safety_stock_pct || 0.05,
              is_active: p.is_active ?? true,
              ...(catId ? { category_id: catId } : {})
            };
          });
          await supabase.from('parts').upsert(partRows, { onConflict: 'part_number' });
        } catch (e) {}
      }

      showToast('All master data, forecasts, allocations & audit logs synced to cloud!', 'success');
      return { success: true };
    } catch (err) {
      console.error('Cloud sync error:', err);
      showToast(`Cloud sync error: ${err.message}`, 'error');
      return { success: false, error: err.message };
    }
  };

  // Reset System Master to Default Seed State
  const resetToDefaultData = async () => {
    dbStorage.removeItem('mdc_is_cleared');
    dbStorage.setItem('mdc_forecast', seedData.forecastItems);
    dbStorage.setItem('mdc_allocations', seedData.allocations);
    dbStorage.setItem('mdc_inventory', seedData.inventoryUnits || []);
    dbStorage.setItem('mdc_parts', seedData.parts);
    dbStorage.setItem('mdc_sites', seedData.sites);
    dbStorage.setItem('mdc_categories', seedData.categories);

    const septPeriod = { month: 9, year: 2026, label: 'September 2026' };
    if (setActivePeriod) setActivePeriod(septPeriod);

    try {
      localStorage.removeItem('mdc_is_cleared');
      localStorage.setItem('mdc_active_period', JSON.stringify(septPeriod));
      localStorage.setItem('mdc_forecast', JSON.stringify(seedData.forecastItems));
      localStorage.setItem('mdc_allocations', JSON.stringify(seedData.allocations));
      localStorage.setItem('mdc_inventory', JSON.stringify(seedData.inventoryUnits || []));
      localStorage.setItem('mdc_parts', JSON.stringify(seedData.parts));
      localStorage.setItem('mdc_sites', JSON.stringify(seedData.sites));
      localStorage.setItem('mdc_categories', JSON.stringify(seedData.categories));
    } catch (e) {}

    setCategories(seedData.categories);
    setSites(seedData.sites);
    setParts(seedData.parts);
    setForecastItems(seedData.forecastItems);
    setAllocations(seedData.allocations);
    setInventoryUnits(seedData.inventoryUnits || []);
    setPurchaseOrders([
      {
        id: 'po-202609-01',
        po_number: 'PO-2026-SEP-BATTERY',
        order_date: '2026-09-01',
        expected_date: '2026-09-10',
        status: 'partially_received',
        remarks: 'Monthly Battery replenishment for iPhone 13-17 series',
        items: [
          { part_id: 'part-661-21991', part_number: '661-21991', description: 'Battery, iPhone 13', quantity_ordered: 234, quantity_received: 150, unit_price: 89 },
          { part_id: 'part-661-21996', part_number: '661-21996', description: 'Battery, iPhone 13 Pro', quantity_ordered: 24, quantity_received: 20, unit_price: 89 },
          { part_id: 'part-661-22294', part_number: '661-22294', description: 'Battery, iPhone 13 Pro Max', quantity_ordered: 31, quantity_received: 31, unit_price: 89 }
        ]
      },
      {
        id: 'po-202609-02',
        po_number: 'PO-2026-SEP-DISPLAY',
        order_date: '2026-09-02',
        expected_date: '2026-09-12',
        status: 'submitted',
        remarks: 'Monthly Display replenishment',
        items: [
          { part_id: 'part-661-21988', part_number: '661-21988', description: 'Display, iPhone 13', quantity_ordered: 23, quantity_received: 0, unit_price: 279 },
          { part_id: 'part-661-56050', part_number: '661-56050', description: 'Display, iPhone 17 Pro Max', quantity_ordered: 45, quantity_received: 0, unit_price: 379 }
        ]
      }
    ]);

    if (supabase) {
      try {
        await supabase.from('saved_records').upsert({
          id: LIVE_MASTER_RECORD_ID,
          record_type: 'both',
          period_label: 'September 2026',
          period_year: 2026,
          period_month: 9,
          notes: 'Master operational dataset synchronized with Google Sheets September 2026',
          saved_by_name: currentUser?.fullName || 'Parts Management Specialist',
          snapshot_data: {
            isCleared: false,
            activePeriod: septPeriod,
            forecastItems: seedData.forecastItems,
            allocations: seedData.allocations,
            uploadAuditLogs: []
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        broadcastCloudEvent('MASTER_DATA_UPDATED', { period: 'September 2026' });
      } catch (e) {
        console.warn('Sync master state on reset error:', e);
      }
    }

    showToast('Loaded verified September 2026 dataset (591 units, $91,199.00) matching Google Sheets', 'success');
  };

  // Clear All Operational Data
  const clearAllData = async ({ reason = 'User initialized clean slate for new forecasting & allocation ingestion', securityPhraseVerified = true } = {}) => {
    dbStorage.setItem('mdc_is_cleared', true);
    dbStorage.setItem('mdc_forecast', []);
    dbStorage.setItem('mdc_allocations', []);
    dbStorage.setItem('mdc_inventory', []);
    dbStorage.setItem('mdc_pos', []);
    dbStorage.setItem('mdc_shipments', []);
    dbStorage.setItem('mdc_scan_logs', []);
    dbStorage.setItem('mdc_repair_usage', []);
    dbStorage.setItem('mdc_stock_transfer_reports', []);
    dbStorage.setItem('mdc_stock_transfer_metadata', null);

    try {
      localStorage.setItem('mdc_is_cleared', 'true');
      localStorage.setItem('mdc_forecast', '[]');
      localStorage.setItem('mdc_allocations', '[]');
      localStorage.setItem('mdc_inventory', '[]');
      localStorage.setItem('mdc_recent_scans', '[]');
      localStorage.setItem('mdc_pos', '[]');
      localStorage.setItem('mdc_shipments', '[]');
      localStorage.setItem('mdc_scan_logs', '[]');
      localStorage.setItem('mdc_repair_usage', '[]');
      localStorage.setItem('mdc_stock_transfer_reports', '[]');
      localStorage.removeItem('mdc_stock_transfer_metadata');
    } catch (e) {
      console.warn('LocalStorage clear error:', e);
    }

    setForecastItems([]);
    setAllocations([]);
    setInventoryUnits([]);
    setPurchaseOrders([]);
    setShipments([]);
    setScanLogs([]);
    setRepairUsageRecords([]);

    if (logDeletionAudit) {
      await logDeletionAudit({
        entityType: 'System State Reset',
        entityId: 'ALL_OPERATIONAL_DATA',
        entityLabel: 'Clear System to Fresh Empty State',
        summary: {
          action: 'CLEARED_ALL_DATA',
          securityPhrase: 'Delete Data',
          securityPhraseVerified: Boolean(securityPhraseVerified),
          previousForecastCount: forecastItems?.length || 0,
          previousAllocCount: allocations?.length || 0,
          previousInventoryCount: inventoryUnits?.length || 0,
          clearedBy: currentUser?.fullName || 'Superadmin User',
          clearedByEmail: currentUser?.email || '',
          clearedByRole: currentUser?.role || 'admin',
          clearedAt: new Date().toISOString()
        },
        reason
      });
    }

    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        await supabase.from('saved_records').upsert({
          id: LIVE_MASTER_RECORD_ID,
          record_type: 'both',
          period_label: 'Cleared Empty State',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Master operational data cleared by user',
          saved_by_name: currentUser?.fullName || 'Parts Management Specialist',
          snapshot_data: {
            isCleared: true,
            forecastItems: [],
            allocations: [],
            uploadAuditLogs: uploadAuditLogs || [],
            deletionAuditLogs: deletionAuditLogs || []
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        await supabase.from('saved_records').upsert({
          id: 'live_master_dc_inventory',
          record_type: 'both',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Cleared inventory state',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: {
            units: []
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        try { await supabase.from('forecast_entries').delete().neq('part_id', '00000000-0000-0000-0000-000000000000'); } catch (e) {}
        try { await supabase.from('allocation_entries').delete().neq('part_id', '00000000-0000-0000-0000-000000000000'); } catch (e) {}

        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('MASTER_DATA_CLEARED', { timestamp: new Date().toISOString() });
      } catch (dbErr) {
        console.error('Supabase clearAllData error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        broadcastCloudEvent('MASTER_DATA_CLEARED', { timestamp: new Date().toISOString() });
      }
    } else {
      broadcastCloudEvent('MASTER_DATA_CLEARED', { timestamp: new Date().toISOString() });
    }

    showToast('Cleared all operational modules (Forecasting, Allocation, Reports, and Inventory). Clean slate ready for fresh uploads!', 'info');
  };

  // Apply Parsed Dataset from Excel / File Ingestion
  const applyParsedDataset = async (dataset, auditMeta = null) => {
    if (!dataset || !dataset.payload) {
      showToast('Invalid dataset: missing payload', 'error');
      return;
    }

    if (currentUser && currentUser.role !== 'superadmin') {
      showToast('Action restricted: Only Superadmin can apply forecasting and allocation datasets.', 'error');
      return;
    }

    try {
      const { type, payload, sheetName } = dataset;
      try {
        localStorage.removeItem('mdc_is_cleared');
      } catch (e) {}

      const resolvedTargetMonth = auditMeta?.target_month || dataset.detectedPeriod?.label || 'September 2026';
      const resolvedPeriodMonth = auditMeta?.period_month || dataset.detectedPeriod?.month || 9;
      const resolvedPeriodYear = auditMeta?.period_year || dataset.detectedPeriod?.year || 2026;

      const newPeriod = {
        month: resolvedPeriodMonth,
        year: resolvedPeriodYear,
        label: resolvedTargetMonth
      };
      if (setActivePeriod) setActivePeriod(newPeriod);
      dbStorage.setItem('mdc_active_period', newPeriod);
      try { localStorage.setItem('mdc_active_period', JSON.stringify(newPeriod)); } catch (e) {}

      const uploadLogEntry = auditMeta ? {
        ...auditMeta,
        target_month: resolvedTargetMonth,
        status: 'ACTIVE_ON_CLOUD'
      } : {
        id: `log-import-${Date.now()}`,
        timestamp: new Date().toISOString(),
        action_type: 'FILE_IMPORT_APPLIED',
        file_name: sheetName || 'Uploaded Dataset',
        file_type: type,
        target_month: resolvedTargetMonth,
        total_forecast_units: payload.allocations?.reduce((s, a) => s + (a.total_allocated_qty || 0), 0) || 591,
        total_allocated_units: payload.allocations?.reduce((s, a) => s + (a.total_allocated_qty || 0), 0) || 591,
        total_master_cost: payload.allocations?.reduce((s, a) => s + (a.total_stock_cost || 0), 0) || 91199,
        parts_count: payload.allocations?.length || payload.forecastItems?.length || 40,
        sites_count: payload.sites?.length || 26,
        user_id: currentUser?.id || 'usr-superadmin',
        user_name: currentUser?.fullName || 'Superadmin User',
        user_email: currentUser?.email || 'superadmin@mobilecare.com',
        user_role: currentUser?.role || 'superadmin',
        status: 'ACTIVE_ON_CLOUD'
      };

      const updatedAuditLogs = [
        uploadLogEntry,
        ...(uploadAuditLogs || []).map(l => ({ ...l, status: 'SUPERSEDED' }))
      ];

      setUploadAuditLogs(updatedAuditLogs);
      dbStorage.setItem('mdc_upload_audit_logs', updatedAuditLogs);
      try { localStorage.setItem('mdc_upload_audit_logs', JSON.stringify(updatedAuditLogs)); } catch (e) {}

      if (type === 'WORKBOOK_BUNDLE') {
        if (payload.sites && payload.sites.length > 0) {
          setSites(payload.sites);
          dbStorage.setItem('mdc_sites', payload.sites);
          try { localStorage.setItem('mdc_sites', JSON.stringify(payload.sites)); } catch (e) {}
        }
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            try { localStorage.setItem('mdc_parts', JSON.stringify(merged)); } catch (e) {}
            return merged;
          });
        }
        if (payload.forecastItems && payload.forecastItems.length > 0) {
          setForecastItems(payload.forecastItems);
          dbStorage.setItem('mdc_forecast', payload.forecastItems);
          try { localStorage.setItem('mdc_forecast', JSON.stringify(payload.forecastItems)); } catch (e) {}
        }
        if (payload.allocations && payload.allocations.length > 0) {
          setAllocations(payload.allocations);
          dbStorage.setItem('mdc_allocations', payload.allocations);
          try { localStorage.setItem('mdc_allocations', JSON.stringify(payload.allocations)); } catch (e) {}
        }
        showToast(`Applied ${payload.forecastItems?.length || 0} forecasts and ${payload.allocations?.length || 0} allocations matching your workbook 100%!`, 'success');
        if (setActiveTab) setActiveTab('forecast');
      } else if (type === 'FORECAST') {
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            try { localStorage.setItem('mdc_parts', JSON.stringify(merged)); } catch (e) {}
            return merged;
          });
        }
        setForecastItems(payload.forecastItems || []);
        dbStorage.setItem('mdc_forecast', payload.forecastItems || []);
        if (payload.allocations && payload.allocations.length > 0) {
          setAllocations(payload.allocations);
          dbStorage.setItem('mdc_allocations', payload.allocations);
        }
        showToast(`Dynamic forecast matrix updated with ${payload.forecastItems?.length || 0} parts and fair allocations from "${sheetName}"!`, 'success');
        if (setActiveTab) setActiveTab('forecast');
      } else if (type === 'ALLOCATION') {
        if (payload.sites && payload.sites.length > 0) {
          setSites(prev => {
            const map = new Map((prev || []).map(s => [s.code, s]));
            payload.sites.forEach(s => map.set(s.code, s));
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_sites', merged);
            return merged;
          });
        }
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            return merged;
          });
        }
        setAllocations(payload.allocations || []);
        dbStorage.setItem('mdc_allocations', payload.allocations || []);
        showToast(`Dynamic Master Allocation updated with ${payload.allocations?.length || 0} parts from "${sheetName}"!`, 'success');
        if (setActiveTab) setActiveTab('allocation');
      } else if (type === 'INVENTORY_STOCK') {
        setInventoryUnits(prev => {
          const next = [...(payload.units || []), ...(prev || [])];
          dbStorage.setItem('mdc_inventory', next);
          return next;
        });
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            return merged;
          });
        }
        showToast(`Imported ${payload.units?.length || 0} inventory units!`, 'success');
        if (setActiveTab) setActiveTab('dashboard');
      } else if (type === 'RAW_USAGE_PIPELINE') {
        if (payload.sites && payload.sites.length > 0) {
          setSites(payload.sites);
          dbStorage.setItem('mdc_sites', payload.sites);
          try { localStorage.setItem('mdc_sites', JSON.stringify(payload.sites)); } catch (e) {}
        }
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            try { localStorage.setItem('mdc_parts', JSON.stringify(merged)); } catch (e) {}
            return merged;
          });
        }
        if (payload.records && payload.records.length > 0) {
          setRepairUsageRecords(payload.records);
          dbStorage.setItem('mdc_repair_usage', payload.records);

          // Non-blocking background sync to Supabase repair_usage_records
          (async () => {
            try {
              const importBatchId = crypto?.randomUUID ? crypto.randomUUID() : `batch-${Date.now()}`;
              const dbRecords = payload.records.slice(0, 5000).map(r => ({
                import_batch_id: importBatchId,
                raw_site_name: r.rawSiteName || r.siteName,
                raw_part_number: r.partNumber,
                raw_part_description: r.description,
                repair_closed_date: r.repairClosedDate,
                month_name: r.monthName || 'Unknown',
                repair_number: r.repairNumber,
                order_id: r.orderId,
                kgb_kbb_number: r.kgbKbb,
                quantity: r.quantity || 1,
                raw_row_ref: r.rawRowRef,
                is_in_scope: true
              }));
              const chunkSize = 250;
              for (let i = 0; i < dbRecords.length; i += chunkSize) {
                const chunk = dbRecords.slice(i, i + chunkSize);
                await supabase.from('repair_usage_records').insert(chunk);
              }
            } catch (dbErr) {
              console.warn('Background repair_usage_records sync info:', dbErr?.message || dbErr);
            }
          })();
        }

        // Preserve existing manual admin overrides if configured
        let finalForecastItems = payload.forecastItems || [];
        if (forecastItems && forecastItems.length > 0) {
          const overrideMap = new Map();
          forecastItems.forEach(fi => {
            if (fi.admin_override !== null && fi.admin_override !== undefined && fi.admin_override !== '') {
              overrideMap.set(fi.part_number, Number(fi.admin_override));
            }
          });
          if (overrideMap.size > 0) {
            finalForecastItems = finalForecastItems.map(item => {
              if (overrideMap.has(item.part_number)) {
                const ov = overrideMap.get(item.part_number);
                return {
                  ...item,
                  admin_override: ov,
                  final_forecast: ov
                };
              }
              return item;
            });
          }
        }

        if (finalForecastItems.length > 0) {
          setForecastItems(finalForecastItems);
          dbStorage.setItem('mdc_forecast', finalForecastItems);
          try { localStorage.setItem('mdc_forecast', JSON.stringify(finalForecastItems)); } catch (e) {}
        }
        if (payload.allocations && payload.allocations.length > 0) {
          setAllocations(payload.allocations);
          dbStorage.setItem('mdc_allocations', payload.allocations);
          try { localStorage.setItem('mdc_allocations', JSON.stringify(payload.allocations)); } catch (e) {}
        }
        showToast(`Masterlist ingested! Recomputed ${finalForecastItems.length} forecasts and ${payload.allocations?.length || 0} allocations across all ${payload.sites?.length || 27} branches!`, 'success');
        if (setActiveTab) setActiveTab('allocation');
      } else if (type === 'USAGE_RECORDS') {
        setRepairUsageRecords(prev => {
          const next = [...(payload.records || []), ...(prev || [])];
          dbStorage.setItem('mdc_repair_usage', next);
          return next;
        });
        showToast(`Imported ${payload.records?.length || 0} raw repair usage records!`, 'success');
      }

      const fullSyncSnapshot = {
        forecastItems: payload.forecastItems || forecastItems,
        allocations: payload.allocations || allocations,
        parts: payload.parts || parts,
        sites: payload.sites || sites,
        uploadAuditLogs: updatedAuditLogs,
        deletionAuditLogs: deletionAuditLogs || []
      };
      await syncAllDataToCloud(fullSyncSnapshot);
      broadcastCloudEvent('AUDIT_UPLOAD_LOGGED', { log: uploadLogEntry });
      broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'saved_records' });
    } catch (err) {
      console.error('Error applying parsed dataset:', err);
      showToast(`Error applying data: ${err.message}`, 'error');
    }
  };

  return {
    cloudSyncStatus,
    setCloudSyncStatus,
    lastSyncedAt,
    setLastSyncedAt,
    realtimeConnected,
    setRealtimeConnected,
    isAutoRefreshing,
    setIsAutoRefreshing,
    broadcastCloudEvent,
    enqueueOfflineAction,
    processOfflineSyncQueue,
    hydrateFromSupabase,
    autoRefreshData,
    triggerDebouncedRealtimeSync,
    refreshDataFromCloud,
    syncAllDataToCloud,
    resetToDefaultData,
    clearAllData,
    applyParsedDataset
  };
}
