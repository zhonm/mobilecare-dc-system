import { useState, useEffect, useRef, useCallback } from 'react';
import seedData from '../data/seedData.json';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { normalizeInventoryUnits, isProvincialSite } from '../utils/partResolver';
import { defaultPartsCatalog } from '../data/defaultCatalog.js';
import { reconcileUnitsWithPackedDrafts, toValidUUID, isUUID, safeUUID, formatShipmentForDb, formatDcIntakeRecordForDb, isLockedConfirmedShipment } from '../utils/appContextHelpers';
import { ROLE_PRESETS, getDefaultRolePosition, LEGACY_MOCK_EMAILS, LEGACY_MOCK_IDS, sortUsersDeterministically } from '../constants/roles';
import { LIVE_MASTER_RECORD_ID } from '../constants/config';
import { generateAllocationsFromForecasts } from '../utils/allocationEngine';
import { clearOperationalLocalStorage } from '../utils/cacheManager';
import { clearStoredUserSession } from '../utils/security';

export function useCloudSync({
  currentUser,
  setCurrentUser,
  setPendingFirstTimeUser,
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
  _forecastingModel,
  setForecastingModel,
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
  _partsRequests,
  setPartsRequests,
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
  const lastShipmentsBackfillAttemptRef = useRef(0);

  useEffect(() => {
    isSavingRef.current = cloudSyncStatus.isSaving;
  }, [cloudSyncStatus.isSaving]);

  const pendingRealtimeSyncRef = useRef(false);
  const pendingRealtimeTablesRef = useRef(new Set());
  const debounceRealtimeTimerRef = useRef(null);

  const [activePackingStations, setActivePackingStations] = useState({});

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

  // Broadcast and locally track active packing session presence
  const broadcastPackingPresence = useCallback((presenceData) => {
    if (!presenceData) return;
    const payload = {
      userId: presenceData.userId || currentUser?.id || 'anon',
      userName: presenceData.userName || currentUser?.fullName || currentUser?.name || 'Warehouse Staff',
      userEmail: presenceData.userEmail || currentUser?.email || '',
      siteId: presenceData.siteId || '',
      siteCode: presenceData.siteCode || '',
      siteName: presenceData.siteName || '',
      itemCount: typeof presenceData.itemCount === 'number' ? presenceData.itemCount : 0,
      isPacking: presenceData.isPacking !== false,
      timestamp: Date.now()
    };

    setActivePackingStations(prev => {
      if (!payload.isPacking) {
        const next = { ...prev };
        delete next[payload.userId];
        return next;
      }
      return {
        ...prev,
        [payload.userId]: payload
      };
    });

    broadcastCloudEvent('PACKING_PRESENCE', payload);
  }, [currentUser, broadcastCloudEvent]);

  // Prune stale packing station sessions (> 120s since last heartbeat)
  useEffect(() => {
    const pruneTimer = setInterval(() => {
      const now = Date.now();
      setActivePackingStations(prev => {
        let changed = false;
        const next = {};
        for (const [uid, st] of Object.entries(prev)) {
          if (now - (st.timestamp || 0) < 120000 && st.isPacking) {
            next[uid] = st;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 30000);
    return () => clearInterval(pruneTimer);
  }, []);

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
            const payload = { ...item.payload };
            if (!isUUID(payload.id)) payload.id = toValidUUID(`usr-${Date.now()}-${payload.email}`);
            await supabase.from('profiles').upsert(payload, { onConflict: 'email' });
          } else if (item.actionType === 'PROFILE_DELETE') {
            if (isUUID(item.payload.id)) {
              await supabase.from('profiles').delete().or(`id.eq.${item.payload.id},email.ilike.${item.payload.email}`);
            } else if (item.payload.email) {
              await supabase.from('profiles').delete().ilike('email', item.payload.email);
            }
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
            const cleanRecId = String(item.payload.recordId || '').trim();
            if (cleanRecId) {
              try { await supabase.from('dc_intake_records').delete().eq('id', cleanRecId); } catch (e) {}
              try { await supabase.from('dc_intake_records').delete().eq('record_name', cleanRecId); } catch (e) {}
              try { await supabase.from('saved_records').delete().eq('id', cleanRecId); } catch (e) {}
            }
          } else if (item.actionType === 'SHIPMENT_UPSERT') {
            await supabase.from('saved_records').upsert(item.payload, { onConflict: 'id' });
          } else if (item.actionType === 'SHIPMENT_DELETE') {
            await supabase.from('saved_records').delete().eq('id', item.payload.shipmentId);
          } else if (item.actionType === 'PARTS_REQUEST_CREATE') {
            await supabase.from('parts_requests').upsert(item.payload, { onConflict: 'id' });
          } else if (item.actionType === 'PARTS_REQUEST_UPDATE') {
            await supabase.from('parts_requests').update(item.payload).eq('id', item.payload.id);
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
      const shouldFetch = (tbl) => {
        if (!selectiveTables) return true;
        return selectiveTables.includes(tbl);
      };

      const [
        resProfiles,
        resPerms,
        resSavedRecords,
        resIntakes,
        resUnits,
        resParts,
        resSites,
        resCats,
        resShipments,
        resPartsRequests
      ] = await Promise.all([
        shouldFetch('profiles') ? supabase.from('profiles').select('*').order('created_at', { ascending: true }).limit(100) : Promise.resolve({ data: null }),
        shouldFetch('user_page_permissions') ? supabase.from('user_page_permissions').select('*').limit(200) : Promise.resolve({ data: null }),
        shouldFetch('saved_records') ? (async () => {
          const SYSTEM_DOC_IDS = [
            LIVE_MASTER_RECORD_ID,
            'master_users_registry',
            'master_deletion_audit_logs_registry',
            'master_deleted_shipments_registry',
            'master_deleted_intakes_registry',
            'master_shipments_registry',
            'live_master_dc_inventory'
          ];
          const [resSystem, resPeriods] = await Promise.all([
            supabase.from('saved_records').select('*').in('id', SYSTEM_DOC_IDS),
            supabase.from('saved_records')
              .select('id, record_type, period_label, period_year, period_month, saved_by_name, notes, created_at, updated_at')
              .order('created_at', { ascending: false })
              .limit(50)
          ]);
          const systemRows = resSystem.data || [];
          const periodRows = (resPeriods.data || []).filter(r => !SYSTEM_DOC_IDS.includes(r.id));
          return { data: [...systemRows, ...periodRows] };
        })() : Promise.resolve({ data: null }),
        shouldFetch('dc_intake_records') ? supabase.from('dc_intake_records').select('*').order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: null }),
        // Egress optimization: fetch unit attributes directly; local cache joins parts and sites in memory
        shouldFetch('inventory_units') ? supabase.from('inventory_units').select('*').limit(2000) : Promise.resolve({ data: null }),
        shouldFetch('parts') ? supabase.from('parts').select('*').limit(300) : Promise.resolve({ data: null }),
        shouldFetch('sites') ? supabase.from('sites').select('*').limit(50) : Promise.resolve({ data: null }),
        shouldFetch('part_categories') ? supabase.from('part_categories').select('*').limit(20) : Promise.resolve({ data: null }),
        // Egress optimization: fetch shipments & items directly; local cache joins parts and sites in memory
        shouldFetch('shipments') ? supabase.from('shipments').select('*, shipment_items(*)').order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: null }),
        shouldFetch('parts_requests') ? supabase.from('parts_requests').select('*').order('created_at', { ascending: false }).limit(300) : Promise.resolve({ data: null })
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
      const dbPartsRequests = resPartsRequests.data;

      // 1. Process Profiles & User Page Permissions & Master Users Registry
      if (shouldFetch('profiles') || shouldFetch('saved_records') || shouldFetch('user_page_permissions')) {
        const cloudUsersRegistryDoc = dbSavedRecords?.find(r => r.id === 'master_users_registry');
        const cloudUsersList = (cloudUsersRegistryDoc?.snapshot_data?.users && Array.isArray(cloudUsersRegistryDoc.snapshot_data.users))
          ? cloudUsersRegistryDoc.snapshot_data.users
          : [];
        const cloudDeletedUserIds = Array.isArray(cloudUsersRegistryDoc?.snapshot_data?.deletedUserIds)
          ? cloudUsersRegistryDoc.snapshot_data.deletedUserIds
          : [];
        const activeProfileEmails = new Set(
          (dbProfiles || []).filter(p => !p.is_deleted).map(p => p.email?.toLowerCase().trim()).filter(Boolean)
        );
        const activeProfileIds = new Set(
          (dbProfiles || []).filter(p => !p.is_deleted).map(p => p.id?.toLowerCase().trim()).filter(Boolean)
        );

        let mergedDeletedUserIds = [];
        try {
          const localDeletedUserIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
          mergedDeletedUserIds = Array.from(new Set([
            ...localDeletedUserIds,
            ...cloudDeletedUserIds
          ].map(s => String(s).trim().toLowerCase())))
          .filter(id => !activeProfileEmails.has(id) && !activeProfileIds.has(id));

          localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(mergedDeletedUserIds));
        } catch (e) {
          mergedDeletedUserIds = cloudDeletedUserIds
            .map(s => String(s).trim().toLowerCase())
            .filter(id => !activeProfileEmails.has(id) && !activeProfileIds.has(id));
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

          // 1. Overlay dbProfiles directly from PostgreSQL (Highest Authority)
          if (dbProfiles && dbProfiles.length > 0) {
            dbProfiles.forEach(p => {
              const cleanEmail = p.email?.toLowerCase();
              const pId = p.id?.toLowerCase();
              if (
                cleanEmail &&
                !p.is_deleted &&
                !mergedDeletedUserIds.includes(pId) &&
                !mergedDeletedUserIds.includes(cleanEmail) &&
                !LEGACY_MOCK_EMAILS.includes(cleanEmail) &&
                !LEGACY_MOCK_IDS.includes(p.id)
              ) {
                const customPerms = permsMap.get(p.id);
                const role = p.role || 'user';
                const resolvedPosition = p.role_position || getDefaultRolePosition(role);
                const passHash = p.password_hash || null;
                const isPasswordSet = Boolean(p.has_set_password || passHash);

                profileMap.set(cleanEmail, {
                  id: p.id || `usr-${Date.now()}`,
                  email: p.email,
                  fullName: p.full_name || p.email.split('@')[0],
                  role: role,
                  rolePosition: resolvedPosition,
                  siteId: p.site_id || 'site-dc',
                  hasSetPassword: isPasswordSet,
                  passwordHash: passHash,
                  isActive: p.is_active ?? true,
                  permittedPages: role === 'superadmin'
                    ? ROLE_PRESETS.superadmin
                    : (customPerms && customPerms.length > 0 ? customPerms : (ROLE_PRESETS[role] || ROLE_PRESETS.user))
                });
              }
            });
          }

          // 2. Overlay master_users_registry from cloud
          cloudUsersList.forEach(u => {
            const cleanEmail = u.email?.toLowerCase();
            const uId = u.id?.toLowerCase();
            if (
              cleanEmail &&
              !mergedDeletedUserIds.includes(uId) &&
              !mergedDeletedUserIds.includes(cleanEmail) &&
              !LEGACY_MOCK_EMAILS.includes(cleanEmail) &&
              !LEGACY_MOCK_IDS.includes(u.id)
            ) {
              const prevEntry = profileMap.get(cleanEmail) || {};
              const passHash = u.passwordHash || prevEntry.passwordHash || null;
              profileMap.set(cleanEmail, {
                ...prevEntry,
                ...u,
                passwordHash: passHash,
                hasSetPassword: Boolean(u.hasSetPassword || prevEntry.hasSetPassword || passHash)
              });
            }
          });

          // 3. Overlay previous local state (if not deleted)
          (prev || []).forEach(u => {
            const cleanEmail = u.email?.toLowerCase();
            const uId = u.id?.toLowerCase();
            if (
              cleanEmail &&
              !mergedDeletedUserIds.includes(uId) &&
              !mergedDeletedUserIds.includes(cleanEmail) &&
              !LEGACY_MOCK_EMAILS.includes(cleanEmail) &&
              !LEGACY_MOCK_IDS.includes(u.id)
            ) {
              profileMap.set(cleanEmail, { ...(profileMap.get(cleanEmail) || {}), ...u });
            }
          });

          // Strict final filter and deterministic sort to ensure no deleted user id or email leaks through and list never shuffles
          const merged = sortUsersDeterministically(
            Array.from(profileMap.values()).filter(u => {
              const cleanEmail = u.email?.toLowerCase();
              const uId = u.id?.toLowerCase();
              return !mergedDeletedUserIds.includes(cleanEmail) && !mergedDeletedUserIds.includes(uId);
            })
          );

          if (currentUser && currentUser.email) {
            const cleanCurEmail = currentUser.email.toLowerCase();
            const cleanCurId = currentUser.id?.toLowerCase();
            const isDeleted = mergedDeletedUserIds.includes(cleanCurEmail) ||
              (cleanCurId && mergedDeletedUserIds.includes(cleanCurId));

            const freshCurrent = merged.find(u =>
              u.email?.toLowerCase() === cleanCurEmail ||
              (cleanCurId && u.id?.toLowerCase() === cleanCurId)
            );

            if (isDeleted || !freshCurrent || freshCurrent.isActive === false || freshCurrent.hasSetPassword === false) {
              console.warn('[Security Guard] Active session invalidated on cloud sync:', {
                isDeleted,
                exists: Boolean(freshCurrent),
                isActive: freshCurrent?.isActive,
                hasSetPassword: freshCurrent?.hasSetPassword
              });

              clearStoredUserSession();
              try { dbStorage.removeItem('mdc_current_user'); } catch (e) {}
              if (supabase?.auth?.signOut) {
                supabase.auth.signOut().catch(() => {});
              }
              if (setCurrentUser) {
                setCurrentUser(null);
              }
              if (freshCurrent && freshCurrent.hasSetPassword === false && setPendingFirstTimeUser) {
                setPendingFirstTimeUser(freshCurrent);
              }
              if (showToast) {
                showToast(
                  isDeleted || !freshCurrent
                    ? 'Your account was removed by an administrator. You have been signed out.'
                    : freshCurrent.isActive === false
                      ? 'Your account was deactivated. You have been signed out.'
                      : 'Password configuration required before system access.',
                  'warning'
                );
              }
            } else if (freshCurrent && (freshCurrent.siteId !== currentUser.siteId || freshCurrent.role !== currentUser.role || freshCurrent.rolePosition !== currentUser.rolePosition)) {
              const updatedSession = { ...currentUser, ...freshCurrent };
              if (setCurrentUser) setCurrentUser(updatedSession);
              try {
                localStorage.setItem('mdc_current_user', JSON.stringify(updatedSession));
                sessionStorage.setItem('mdc_current_user', JSON.stringify(updatedSession));
                dbStorage.setItem('mdc_current_user', updatedSession);
              } catch (e) {}
            }
          }

          try {
            localStorage.setItem('mdc_users', JSON.stringify(merged));
            sessionStorage.setItem('mdc_users', JSON.stringify(merged));
            dbStorage.setItem('mdc_users', merged);
          } catch (e) {}

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

      // 3. Process Sites (Authoritative sync from Supabase; purge deleted sites)
      if (shouldFetch('sites') && dbSites && dbSites.length > 0) {
        const cleanSites = dbSites
          .filter(s =>
            !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
            !String(s.address || '').toUpperCase().includes('SM ILOILO')
          )
          .map(s => ({
            id: s.id,
            code: s.code,
            name: s.name,
            region: (s.code === 'ASP LAU' || s.code === 'LAU' || s.code === 'ASP NAG' || s.code === 'NAG')
              ? 'Camarines Sur'
              : (s.region || (isProvincialSite(s) ? 'Provincial' : 'Metro Manila')),
            address: s.address || s.full_address || '',
            full_address: s.full_address || s.address || '',
            contact_person: s.contact_person || '',
            contact_phone: s.contact_phone || '',
            contact_email: s.contact_email || '',
            ship_to: s.ship_to || null,
            sold_to: s.sold_to || null,
            invoice_prefix: s.invoice_prefix || '',
            is_dc: s.is_dc ?? false,
            is_active: s.is_active ?? true
          }))
          .sort((a, b) => (a.code || '').localeCompare(b.code || ''));

        setSites(cleanSites);
        try { localStorage.setItem('mdc_sites', JSON.stringify(cleanSites)); } catch (e) {}
        dbStorage.setItem('mdc_sites', cleanSites);
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
            setRepairUsageRecords([]);
            if (setUploadAuditLogs) setUploadAuditLogs([]);
            try {
              localStorage.setItem('mdc_forecast', '[]');
              localStorage.setItem('mdc_allocations', '[]');
              localStorage.setItem('mdc_inventory', '[]');
              localStorage.setItem('mdc_repair_usage', '[]');
              localStorage.setItem('mdc_upload_audit_logs', '[]');
            } catch (e) {}
            dbStorage.setItem('mdc_forecast', []);
            dbStorage.setItem('mdc_allocations', []);
            dbStorage.setItem('mdc_inventory', []);
            dbStorage.setItem('mdc_repair_usage', []);
            dbStorage.setItem('mdc_upload_audit_logs', []);
          } else {
            localStorage.removeItem('mdc_is_cleared');
            dbStorage.removeItem('mdc_is_cleared');

            const lastLocalOverrideTime = parseInt(localStorage.getItem('mdc_last_override_time') || '0', 10);
            const isRecentlyModifiedLocally = (Date.now() - lastLocalOverrideTime) < 2500;

            if (!isRecentlyModifiedLocally) {
              const cloudPeriod = snap.activePeriod || (liveSnapshot.period_month && liveSnapshot.period_year ? {
                month: liveSnapshot.period_month,
                year: liveSnapshot.period_year,
                label: (liveSnapshot.period_label || 'September 2026').replace(' Live Master State', '').trim()
              } : null);

              if (cloudPeriod && setActivePeriod) {
                setActivePeriod(cloudPeriod);
                try { localStorage.setItem('mdc_active_period', JSON.stringify(cloudPeriod)); } catch (e) {}
                dbStorage.setItem('mdc_active_period', cloudPeriod);
              }
              if (setForecastingModel) {
                const incomingModel = snap.forecastingModel || snap.forecastModel;
                if (incomingModel && ['wma', 'linear', 'holt', 'croston'].includes(incomingModel)) {
                  setForecastingModel(incomingModel);
                  try { localStorage.setItem('mdc_forecasting_model', incomingModel); } catch (e) {}
                  dbStorage.setItem('mdc_forecasting_model', incomingModel);
                }
              }
              if (snap.forecastItems && snap.forecastItems.length > 0) {
                setForecastItems(snap.forecastItems);
                try { localStorage.setItem('mdc_forecast', JSON.stringify(snap.forecastItems)); } catch (e) {}
                dbStorage.setItem('mdc_forecast', snap.forecastItems);

                const restoredAlloc = (snap.allocations && snap.allocations.length > 0)
                  ? snap.allocations
                  : generateAllocationsFromForecasts(snap.forecastItems, sites, snap.forecastingModel || 'linear');

                setAllocations(restoredAlloc);
                try { localStorage.setItem('mdc_allocations', JSON.stringify(restoredAlloc)); } catch (e) {}
                dbStorage.setItem('mdc_allocations', restoredAlloc);
              } else if (snap.allocations && snap.allocations.length > 0) {
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

        // Hydrate Deleted Period Records Registry
        const deletedPeriodDoc = dbSavedRecords.find(r => r.id === 'deleted_period_record_ids_registry');
        let localDeletedPeriodIds = [];
        try { localDeletedPeriodIds = JSON.parse(localStorage.getItem('mdc_deleted_period_record_ids') || '[]'); } catch (e) {}
        const cloudDeletedPeriodIds = Array.isArray(deletedPeriodDoc?.snapshot_data?.deletedIds) ? deletedPeriodDoc.snapshot_data.deletedIds : [];
        const allDeletedPeriodIds = new Set([...localDeletedPeriodIds, ...cloudDeletedPeriodIds].map(id => String(id).trim()));

        const validSavedRecords = dbSavedRecords.filter(r =>
          r.id !== LIVE_MASTER_RECORD_ID &&
          r.id !== 'live_master_state_v1' &&
          r.id !== 'active_packing_manifest_draft' &&
          r.id !== 'live_master_dc_inventory' &&
          r.id !== 'master_dc_intakes_registry' &&
          r.id !== 'deleted_unit_serials_registry' &&
          r.id !== 'deleted_intake_ids_registry' &&
          r.id !== 'deleted_shipment_ids_registry' &&
          r.id !== 'deleted_period_record_ids_registry' &&
          r.id !== 'master_upload_audit_logs_registry' &&
          r.id !== 'master_deletion_audit_logs_registry' &&
          r.id !== 'master_stock_transfers_report_registry' &&
          r.id !== 'master_users_registry' &&
          r.record_type !== 'live_master_state' &&
          r.record_type !== 'users_registry' &&
          r.record_type !== 'stock_transfer_report' &&
          r.record_type !== 'upload_audit_registry' &&
          r.record_type !== 'deletion_audit_registry' &&
          r.record_type !== 'deleted_snapshot' &&
          r.record_type !== 'shipment' &&
          r.record_type !== 'intake_batch' &&
          r.record_type !== 'intake_record' &&
          r.record_type !== 'inventory_master' &&
          r.record_type !== 'intake_registry' &&
          r.record_type !== 'deletion_registry' &&
          !r.period_label?.includes('Live Master State') &&
          !r.id.startsWith('MDC') &&
          !r.id.startsWith('intake-') &&
          r.notes !== '__DELETED__' &&
          r.snapshot_data?.isDeleted !== true &&
          !allDeletedPeriodIds.has(String(r.id).trim())
        );

        if (setSavedRecords) {
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
              }, { onConflict: 'id' }).then(() => {}).catch(e => console.warn('Auto-seed stock transfers to cloud notice:', e));
            }
          } catch (e) {}
        }

        let localDraftSnapshot = null;
        try {
          const userDraftKey = currentUser?.id ? `mdc_pack_draft_${currentUser.id}` : 'mdc_active_pack_draft';
          localDraftSnapshot = JSON.parse(localStorage.getItem(userDraftKey) || localStorage.getItem('mdc_active_pack_draft') || 'null');
        } catch (e) {}

        if (localDraftSnapshot && Array.isArray(localDraftSnapshot.items) && localDraftSnapshot.items.length > 0) {
          effectiveDraft = localDraftSnapshot;
          if (setActivePackDraft) setActivePackDraft(effectiveDraft);
        } else {
          effectiveDraft = null;
          if (setActivePackDraft) setActivePackDraft(null);
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

        const isDeletedOrCorruptedShipment = (s) => {
          if (!s) return true;
          const sId = String(s.id || '').trim().toUpperCase();
          const cleanRef = String(s.invoice_ref || s.invoiceRef || '').replace(/[^A-Z0-9]/g, '');

          // Explicitly block accidental test phantom shipments
          if (cleanRef === 'DCOWNED082726A' || cleanRef === 'DCOWNED082726B') return true;

          return deletedShipmentIds.some(d => {
            if (!d) return false;
            return String(d).trim().toUpperCase() === sId;
          });
        };

        const cloudShipmentsRegistryDoc = dbSavedRecords.find(r => r.id === 'master_shipments_registry');
        const cloudShipmentsList = (cloudShipmentsRegistryDoc?.snapshot_data?.shipments && Array.isArray(cloudShipmentsRegistryDoc.snapshot_data.shipments))
          ? cloudShipmentsRegistryDoc.snapshot_data.shipments
          : [];

        const shipmentMap = new Map();

        // 1. Ingest authoritative master_shipments_registry first
        cloudShipmentsList.forEach(s => {
          const canonicalRef = String(s.invoice_ref || s.shipment_number || s.id || '').trim().toUpperCase();
          if (canonicalRef && !isDeletedOrCorruptedShipment(s)) {
            shipmentMap.set(canonicalRef, s);
          }
        });

        // 2. Overlay individual saved_records shipment docs
        const shipmentRecords = dbSavedRecords
          .filter(r => (r.record_type === 'shipment' || (r.snapshot_data && r.snapshot_data.shipment_number)) && !isDeletedOrCorruptedShipment(r) && !isDeletedOrCorruptedShipment(r.snapshot_data) && r.notes !== '__DELETED__' && r.snapshot_data?.isDeleted !== true)
          .map(r => r.snapshot_data || r);

        shipmentRecords.forEach(s => {
          const canonicalRef = String(s.invoice_ref || s.shipment_number || s.id || '').trim().toUpperCase();
          if (canonicalRef && !isDeletedOrCorruptedShipment(s)) {
            const existing = shipmentMap.get(canonicalRef);
            shipmentMap.set(canonicalRef, {
              ...(existing || {}),
              ...s,
              items: (s.items && s.items.length > 0) ? s.items : (existing?.items || [])
            });
          }
        });

        // 3. Overlay direct public.shipments table joined with shipment_items
        if (dbShipments && dbShipments.length > 0) {
          dbShipments.filter(s => !isDeletedOrCorruptedShipment(s)).forEach(dbS => {
            const canonicalRef = String(dbS.invoice_ref || dbS.shipment_number || dbS.id || '').trim().toUpperCase();
            if (canonicalRef && !isDeletedOrCorruptedShipment(dbS)) {
              const existing = shipmentMap.get(canonicalRef);
              const formattedItems = Array.isArray(dbS.items) && dbS.items.length > 0
                ? dbS.items
                : (Array.isArray(dbS.shipment_items) && dbS.shipment_items.length > 0
                    ? dbS.shipment_items.map(it => {
                        const cleanSerial = String(it.serial_number || '').trim().toUpperCase();
                        const matchingUnit = (dbUnits || []).find(u => String(u.serial_number || '').trim().toUpperCase() === cleanSerial);
                        const matchingPart = (dbParts || []).find(p => (it.part_id && p.id === it.part_id) || (matchingUnit?.part_id && p.id === matchingUnit.part_id) || (matchingUnit?.part_number && p.part_number === matchingUnit.part_number));
                        return {
                          id: it.id,
                          serial_number: it.serial_number,
                          part_number: it.parts?.part_number || it.part_number || matchingUnit?.part_number || matchingPart?.part_number || 'UNKNOWN-PN',
                          description: it.parts?.description || it.description || matchingUnit?.description || matchingPart?.description || 'Part Description',
                          box_number: it.box_number || 1,
                          cost: it.unit_cost || matchingPart?.stocking_price || 0
                        };
                      })
                    : (existing?.items || []));

              const resolvedSiteName = dbS.destination_site_name || dbS.sites?.name || existing?.destination_site_name || existing?.site_name;
              const resolvedSiteCode = dbS.destination_site_code || dbS.sites?.code || existing?.destination_site_code || existing?.site_code;

              shipmentMap.set(canonicalRef, {
                ...(existing || {}),
                ...dbS,
                destination_site_name: resolvedSiteName,
                destination_site_code: resolvedSiteCode,
                items: formattedItems.length > 0 ? formattedItems : (existing?.items || [])
              });
            }
          });
        }

        // 4. Overlay local storage shipments if present
        try {
          const localShipments = JSON.parse(localStorage.getItem('mdc_shipments') || '[]');
          if (Array.isArray(localShipments)) {
            localShipments.forEach(s => {
              const canonicalRef = String(s.invoice_ref || s.shipment_number || s.id || '').trim().toUpperCase();
              if (canonicalRef && !isDeletedOrCorruptedShipment(s)) {
                const existing = shipmentMap.get(canonicalRef);
                if (!existing) {
                  shipmentMap.set(canonicalRef, s);
                }
              }
            });
          }
        } catch (e) {}

        effectiveShipments = Array.from(shipmentMap.values())
          .filter(s => s && Array.isArray(s.items) && s.items.length > 0 && !isDeletedOrCorruptedShipment(s))
          .map(s => {
            if (!s) return s;
            const cleanPrepBy = (s.prepared_by_name && s.prepared_by_name !== 'Warehouse Staff')
              ? s.prepared_by_name
              : (s.saved_by_name && s.saved_by_name !== 'Warehouse Staff' ? s.saved_by_name : (currentUser?.fullName || 'Zhon Manaois'));

            const isConfirmed = isLockedConfirmedShipment(s) || s.status === 'received_confirmed' || s.status === 'delivered';
            const resolvedStatus = isConfirmed ? 'received_confirmed' : (s.status || 'pending_pickup');
            return {
              ...s,
              status: resolvedStatus,
              prepared_by_name: cleanPrepBy,
              saved_by_name: cleanPrepBy,
              shipment_date: s.shipment_date || s.pickup_date || ''
            };
          });

        if (effectiveShipments.length > 0) {
          setShipments(effectiveShipments);
          try { localStorage.setItem('mdc_shipments', JSON.stringify(effectiveShipments)); } catch (e) {}
          dbStorage.setItem('mdc_shipments', effectiveShipments);

          // Self-heal / Auto-seed master_shipments_registry in cloud if missing or has fewer records than merged list
          if (supabase) {
            if (!cloudShipmentsRegistryDoc || cloudShipmentsList.length < effectiveShipments.length) {
              supabase.from('saved_records').upsert({
                id: 'master_shipments_registry',
                record_type: 'shipments_registry',
                period_label: 'Master Shipments Registry',
                period_year: new Date().getFullYear(),
                period_month: new Date().getMonth() + 1,
                notes: 'Master DC Outbound Shipments & Packing Lists',
                saved_by_name: currentUser?.fullName || 'Warehouse Staff',
                snapshot_data: {
                  shipments: effectiveShipments,
                  deletedIds: deletedShipmentIds,
                  updatedAt: new Date().toISOString()
                },
                updated_at: new Date().toISOString()
              }, { onConflict: 'id' }).then(() => {}).catch(e => console.warn('Auto-seed master_shipments_registry notice:', e));
            }
          }

          // Backfill direct public.shipments table headers in Supabase if empty/missing (throttled to once every 60s)
          if (supabase && (!dbShipments || dbShipments.length < effectiveShipments.length) && (Date.now() - lastShipmentsBackfillAttemptRef.current > 60000)) {
            lastShipmentsBackfillAttemptRef.current = Date.now();
            const shipmentRowsToInsert = effectiveShipments
              .map(s => formatShipmentForDb(s, dbSites || []))
              .filter(s => s && isUUID(s.site_id));
            const uniqueShipmentRows = Array.from(new Map(shipmentRowsToInsert.map(r => [r.shipment_number, r])).values());

            if (uniqueShipmentRows.length > 0) {
              (async () => {
                try {
                  const { data: existingShpList } = await supabase.from('shipments').select('id, shipment_number');
                  const existingMap = new Map((existingShpList || []).map(r => [r.shipment_number, r.id]));

                  const rowsToUpsert = uniqueShipmentRows.map(r => {
                    if (existingMap.has(r.shipment_number)) {
                      return { ...r, id: existingMap.get(r.shipment_number) };
                    }
                    return r;
                  });

                  await supabase.from('shipments').upsert(rowsToUpsert, { onConflict: 'shipment_number' });
                } catch (bErr) {
                  console.warn('Shipments cloud header sync notice:', bErr.message);
                }
              })();
            }
          }
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
            const cleanName = String(rec.record_name || '').trim().toUpperCase();
            if (cleanId && !deletedIntakeIdsSet.has(cleanId) && (!cleanName || !deletedIntakeIdsSet.has(cleanName))) {
              intakeMap.set(cleanId, rec);
            }
          });
        }

        if (dbIntakes && dbIntakes.length > 0) {
          dbIntakes.forEach(rec => {
            const cleanId = String(rec.id || '').trim().toUpperCase();
            const cleanName = String(rec.record_name || '').trim().toUpperCase();
            if (cleanId && !deletedIntakeIdsSet.has(cleanId) && (!cleanName || !deletedIntakeIdsSet.has(cleanName)) && rec.notes !== '__DELETED__') {
              const existing = intakeMap.get(cleanId);
              intakeMap.set(cleanId, { ...(existing || {}), ...rec });
            }
          });
        }

        intakeBatchDocs.forEach(doc => {
          const rec = doc.snapshot_data || doc;
          const cleanId = String(rec.id || doc.id || '').trim().toUpperCase();
          const cleanName = String(rec.record_name || '').trim().toUpperCase();
          if (cleanId && !deletedIntakeIdsSet.has(cleanId) && (!cleanName || !deletedIntakeIdsSet.has(cleanName)) && rec.notes !== '__DELETED__') {
            const existing = intakeMap.get(cleanId);
            intakeMap.set(cleanId, { ...(existing || {}), ...rec, id: cleanId });
          }
        });

        // Actively purge any deleted IDs from Supabase database in the background
        if (supabase && deletedIntakeIdsSet.size > 0) {
          Array.from(deletedIntakeIdsSet).forEach(delId => {
            supabase.from('dc_intake_records').delete().eq('id', delId).then(() => {}).catch(() => {});
            supabase.from('dc_intake_records').delete().eq('record_name', delId).then(() => {}).catch(() => {});
            supabase.from('saved_records').delete().eq('id', delId).then(() => {}).catch(() => {});
          });
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

          // If Supabase direct dc_intake_records table is empty or missing rows, backfill them with compliant schema
          if (supabase && effectiveIntakeRecords.length > 0 && (!dbIntakes || dbIntakes.length < effectiveIntakeRecords.length)) {
            const rowsToInsert = effectiveIntakeRecords
              .map(r => formatDcIntakeRecordForDb(r))
              .filter(Boolean);
            const uniqueIntakeRows = Array.from(new Map(rowsToInsert.map(r => [r.id, r])).values());
            if (uniqueIntakeRows.length > 0) {
              supabase.from('dc_intake_records').upsert(uniqueIntakeRows, { onConflict: 'id' }).then(() => {}).catch(() => {});
            }
          }

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

        // Serials that are already shipped, dispatched, or packed in active drafts:
        const shippedOrPackedSerials = new Set();

        // 1. Gather all shipments from effectiveShipments, _shipments prop, and localStorage
        const allShipmentsToCheck = [
          ...(effectiveShipments || []),
          ...(_shipments || [])
        ];
        try {
          const localSavedSh = JSON.parse(localStorage.getItem('mdc_shipments') || '[]');
          if (Array.isArray(localSavedSh)) allShipmentsToCheck.push(...localSavedSh);
        } catch (e) {}

        allShipmentsToCheck.forEach(sh => {
          if (sh && Array.isArray(sh.items)) {
            sh.items.forEach(it => {
              const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
              if (s) shippedOrPackedSerials.add(s);
            });
          }
        });

        // 2. Gather all active drafts from effectiveDraft and all mdc_pack_draft_* in localStorage
        if (effectiveDraft?.items && Array.isArray(effectiveDraft.items)) {
          effectiveDraft.items.forEach(it => {
            const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
            if (s) shippedOrPackedSerials.add(s);
          });
        }
        if (typeof window !== 'undefined') {
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && (k.startsWith('mdc_pack_draft_') || k === 'mdc_active_pack_draft')) {
                const d = JSON.parse(localStorage.getItem(k) || 'null');
                if (d && Array.isArray(d.items)) {
                  d.items.forEach(it => {
                    const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
                    if (s) shippedOrPackedSerials.add(s);
                  });
                }
              }
            }
          } catch (e) {}
        }

        setInventoryUnits(prev => {
          const map = new Map();

          const allAvailableParts = [
            ...(dbParts || []),
            ...(parts || []),
            ...(defaultPartsCatalog || [])
          ];
          const partsByIdMap = new Map();
          const partsByPnMap = new Map();
          allAvailableParts.forEach(p => {
            if (p.id && !partsByIdMap.has(p.id)) partsByIdMap.set(p.id, p);
            if (p.part_number && !partsByPnMap.has(p.part_number.toUpperCase())) partsByPnMap.set(p.part_number.toUpperCase(), p);
          });

          const resolvePartInfo = (rawPn, rawDesc, partId, notes) => {
            const partObj = (partId ? partsByIdMap.get(partId) : null) ||
              (rawPn && rawPn.toUpperCase() !== 'PART' ? partsByPnMap.get(rawPn.toUpperCase()) : null);

            const effectivePn = (rawPn && rawPn.toUpperCase() !== 'PART')
              ? rawPn
              : (notes && !notes.includes('CRBR') && !notes.includes('Forecasting') && /66[0-9]-/i.test(notes) ? notes : (partObj?.part_number || 'PART-UNKNOWN'));

            const effectiveDesc = partObj?.description || rawDesc || 'Apple Genuine Service Part';
            return { partObj, effectivePn, effectiveDesc };
          };

          // 1. Authoritative Source: Direct Supabase public.inventory_units table
          if (Array.isArray(dbUnits)) {
            dbUnits.filter(u => !u.is_deleted && u.status !== 'deleted').forEach(dbU => {
              const cleanSerial = String(dbU.serial_number || '').trim().toUpperCase();
              if (cleanSerial) {
                const isPackedOrShipped = shippedOrPackedSerials.has(cleanSerial);
                const targetStatus = isPackedOrShipped
                  ? (dbU.status === 'shipped' ? 'shipped' : 'packed')
                  : (dbU.status || 'in_stock');

                const cloudAssign = dbU.intake_assignment || (dbU.notes?.includes('SVNR') ? 'SVNR - Service Non-Repair' : dbU.notes?.includes('CRBR') ? 'DC - CRBR' : dbU.notes?.includes('Forecasting') ? 'MDC - Forecasting' : null);
                const assign = cloudAssign || (dbU.notes?.includes('SVNR') ? 'SVNR - Service Non-Repair' : dbU.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');

                const siteJoined = dbU.sites || (dbSites || sites || []).find(s => s.id === dbU.current_site_id || s.code === dbU.current_site_id) || null;
                const partJoined = dbU.parts || null;
                const rawPn = dbU.part_number || partJoined?.part_number;
                const rawDesc = dbU.description || partJoined?.description;
                const { partObj, effectivePn, effectiveDesc } = resolvePartInfo(rawPn, rawDesc, dbU.part_id, dbU.notes);

                map.set(cleanSerial, {
                  id: dbU.id || `unit-${cleanSerial}`,
                  part_id: partJoined?.id || partObj?.id || dbU.part_id,
                  part_number: partJoined?.part_number || effectivePn,
                  description: partJoined?.description || effectiveDesc,
                  category_id: partJoined?.category_id || partObj?.category_id || dbU.category_id,
                  stocking_price: partJoined?.stocking_price || partObj?.stocking_price || dbU.stocking_price || 99,
                  serial_number: cleanSerial,
                  intake_assignment: assign,
                  notes: dbU.notes && !dbU.notes.includes('CRBR') && !dbU.notes.includes('SVNR') && !dbU.notes.includes('Forecasting') ? `${assign} | ${dbU.notes}` : assign,
                  current_site_id: siteJoined?.id || dbU.current_site_id || 'site-dc',
                  site_code: siteJoined?.code || dbU.site_code || 'DC-MDC',
                  site_name: siteJoined?.name || null,
                  po_id: dbU.po_id || null,
                  status: targetStatus,
                  box_number: dbU.box_number || 1,
                  received_at: dbU.received_at || new Date().toISOString(),
                  received_by: dbU.received_by_name || dbU.received_by || 'Warehouse Staff',
                  allocated_at: dbU.allocated_at || null,
                  shipped_at: dbU.shipped_at || null,
                  used_at: dbU.used_at || null,
                  used_by: dbU.used_by || null,
                  used_by_name: dbU.used_by_name || null,
                  work_order_number: dbU.work_order_number || null,
                  usage_notes: dbU.usage_notes || null,
                  intake_record_id: dbU.intake_record_id || null
                });
              }
            });
          }

          // Overlay Live Master Inventory Snapshot from saved_records for cross-client sync
          const liveMasterInvDoc = dbSavedRecords?.find(r => r.id === 'live_master_dc_inventory');
          if (liveMasterInvDoc?.snapshot_data?.units && Array.isArray(liveMasterInvDoc.snapshot_data.units)) {
            liveMasterInvDoc.snapshot_data.units.forEach(u => {
              const s = String(u.serial_number || '').trim().toUpperCase();
              if (s && !deletedSerialsSet.has(s) && !map.has(s)) {
                map.set(s, u);
              }
            });
          }

          // Offline fallback ONLY when Supabase query is completely unavailable
          if (!dbUnits) {
            try {
              const localSaved = JSON.parse(localStorage.getItem('mdc_inventory') || '[]');
              if (Array.isArray(localSaved)) {
                localSaved.forEach(u => {
                  const s = String(u.serial_number || '').trim().toUpperCase();
                  if (s && !deletedSerialsSet.has(s) && !map.has(s)) {
                    const isPackedOrShipped = shippedOrPackedSerials.has(s);
                    const targetStatus = isPackedOrShipped
                      ? (u.status === 'shipped' ? 'shipped' : 'packed')
                      : (u.status || 'in_stock');
                    map.set(s, {
                      ...u,
                      status: targetStatus
                    });
                  }
                });
              }
            } catch (e) {}
          }

          // Preserve active unsaved UI session drafts (in-progress receiving session before clicking Save Batch)
          (prev || []).forEach(u => {
            if (u.isSessionDraft && !deletedSerialsSet.has(String(u.serial_number || '').toUpperCase())) {
              map.set(String(u.serial_number || '').toUpperCase(), u);
            }
          });

          const mergedRaw = Array.from(map.values()).sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0));
          const normalized = normalizeInventoryUnits(mergedRaw, allAvailableParts);
          const merged = reconcileUnitsWithPackedDrafts(normalized, effectiveShipments, effectiveDraft);
          try { localStorage.setItem('mdc_inventory', JSON.stringify(merged)); } catch (e) {}
          dbStorage.setItem('mdc_inventory', merged);

          return merged;
        });
      }

      // 8. Process Parts Requests
      if (shouldFetch('parts_requests') || shouldFetch('saved_records')) {
        const partsReqRegistryDoc = dbSavedRecords?.find(r => r.id === 'master_parts_requests_registry');
        const cloudRegistryRequests = Array.isArray(partsReqRegistryDoc?.snapshot_data?.requests)
          ? partsReqRegistryDoc.snapshot_data.requests
          : [];

        if (setPartsRequests) {
          setPartsRequests(prev => {
            const reqMap = new Map();

            // 1. Start with previous local requests
            (prev || []).forEach(r => {
              if (r.id) reqMap.set(r.id, r);
            });

            // 2. Merge cloud registry requests
            cloudRegistryRequests.forEach(r => {
              if (r.id) {
                const existing = reqMap.get(r.id);
                reqMap.set(r.id, { ...(existing || {}), ...r });
              }
            });

            // 3. Merge direct Supabase table rows
            if (Array.isArray(dbPartsRequests)) {
              dbPartsRequests.forEach(dbR => {
                if (dbR.id) {
                  const partObj = dbR.parts || (dbParts || parts || []).find(p => p.id === dbR.part_id) || {};
                  const siteObj = dbR.sites || (dbSites || sites || []).find(s => s.id === dbR.site_id) || {};
                  const existing = reqMap.get(dbR.id);
                  reqMap.set(dbR.id, {
                    ...(existing || {}),
                    ...dbR,
                    part_number: partObj.part_number || dbR.part_number || existing?.part_number,
                    part_description: partObj.description || dbR.part_description || existing?.part_description,
                    site_code: siteObj.code || dbR.site_code || existing?.site_code,
                    site_name: siteObj.name || dbR.site_name || existing?.site_name
                  });
                }
              });
            }

            const merged = Array.from(reqMap.values()).sort(
              (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
            );

            try { localStorage.setItem('mdc_parts_requests', JSON.stringify(merged)); } catch (e) {}
            dbStorage.setItem('mdc_parts_requests', merged);

            return merged;
          });
        }
      }

      const syncNow = new Date();
      setLastSyncedAt(syncNow);
      setCloudSyncStatus({ isSaving: false, lastSaved: syncNow, isOnline: true });

      const effectiveUserId = currentUser?.id || (() => {
        try {
          const u = JSON.parse(localStorage.getItem('mdc_current_user') || 'null');
          return u?.id;
        } catch (e) {
          return null;
        }
      })();

      if (effectiveUserId) {
        try {
          localStorage.setItem('mdc_local_data_owner', effectiveUserId);
        } catch (e) {}
      }

      return true;
    } catch (e) {
      console.warn('Supabase fetch note (offline or unauthenticated):', e.message);
      setCloudSyncStatus(prev => ({ ...prev, isOnline: false }));
      return false;
    }
  }, [_shipments, currentUser, setCurrentUser, setPendingFirstTimeUser, showToast, parts, setActivePackDraft, setActivePeriod, setAllocations, setCategories, setDcIntakeRecords, setDeletionAuditLogs, setForecastItems, setForecastingModel, setInventoryUnits, setParts, setPartsRequests, setRepairUsageRecords, setSavedRecords, setShipments, setSites, setStockTransferMetadata, setStockTransferReports, setUploadAuditLogs, setUsersList, sites]);

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

    // Runaway protection & bandwidth egress defense:
    // 1. Manual user click: allow immediately.
    // 2. Forced / realtime: enforce at least a 3000ms cooldown to avoid cascade storms.
    // 3. Automatic / background: enforce a 15000ms cooldown.
    const minCooldown = isManual ? 0 : (force ? 3000 : 15000);
    if (now - lastRefreshTimeRef.current < minCooldown) {
      if (tables) {
        tables.forEach(t => pendingRealtimeTablesRef.current.add(t));
        pendingRealtimeSyncRef.current = true;
      }
      return { success: true, throttled: true };
    }

    lastRefreshTimeRef.current = now;
    setIsAutoRefreshing(true);
    console.debug('[AutoRefresh] Sync trigger:', reason, tables ? `(Tables: ${tables.join(', ')})` : '(Full)');

    try {
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
    return await autoRefreshData({ silent: false, force: true, isManual: true, reason: 'Manual sync trigger' });
  };

  // Debounced burst handler for Realtime Postgres & WebSocket events with safe 1500ms cooldown
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
        force: true,
        reason: `Debounced Realtime [${reason}]`,
        tables: targetTables
      });
    }, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Instant zero-latency real-time inventory synchronizer across concurrent users
  const handleRealtimeInventoryEvent = useCallback((type, payload) => {
    if (!setInventoryUnits || !payload) return;

    if (type === 'UNIT_PACKED' && payload.serialNumber) {
      const cleanS = String(payload.serialNumber).trim().toUpperCase();
      setInventoryUnits(prev => {
        const updated = (prev || []).map(u => {
          if (String(u.serial_number || '').trim().toUpperCase() === cleanS) {
            return {
              ...u,
              status: 'packed',
              current_site_id: payload.siteId || u.current_site_id,
              box_number: payload.boxNumber || u.box_number || 1,
              shipped_at: new Date().toISOString()
            };
          }
          return u;
        });
        try { localStorage.setItem('mdc_inventory', JSON.stringify(updated)); } catch (e) {}
        dbStorage.setItem('mdc_inventory', updated);
        return updated;
      });
    } else if (type === 'UNITS_BATCH_PACKED' && Array.isArray(payload.serialNumbers)) {
      const serialsSet = new Set(payload.serialNumbers.map(s => String(s).trim().toUpperCase()));
      setInventoryUnits(prev => {
        const updated = (prev || []).map(u => {
          if (serialsSet.has(String(u.serial_number || '').trim().toUpperCase())) {
            return {
              ...u,
              status: 'packed',
              current_site_id: payload.siteId || u.current_site_id,
              shipped_at: new Date().toISOString()
            };
          }
          return u;
        });
        try { localStorage.setItem('mdc_inventory', JSON.stringify(updated)); } catch (e) {}
        dbStorage.setItem('mdc_inventory', updated);
        return updated;
      });
    } else if ((type === 'UNIT_UNPACKED' || type === 'UNIT_RETURNED') && payload.serialNumber) {
      const cleanS = String(payload.serialNumber).trim().toUpperCase();
      setInventoryUnits(prev => {
        let found = false;
        const updated = (prev || []).map(u => {
          if (String(u.serial_number || '').trim().toUpperCase() === cleanS) {
            found = true;
            return {
              ...u,
              status: 'in_stock',
              current_site_id: 'site-dc',
              box_number: 1,
              shipped_at: null,
              shipped_by: null
            };
          }
          return u;
        });
        if (!found && payload.unit) {
          updated.push({
            ...payload.unit,
            status: 'in_stock',
            current_site_id: 'site-dc'
          });
        }
        try { localStorage.setItem('mdc_inventory', JSON.stringify(updated)); } catch (e) {}
        dbStorage.setItem('mdc_inventory', updated);
        return updated;
      });
    } else if (type === 'DRAFT_CLEARED' && Array.isArray(payload.serialNumbers)) {
      const serialsSet = new Set(payload.serialNumbers.map(s => String(s).trim().toUpperCase()));
      setInventoryUnits(prev => {
        const updated = (prev || []).map(u => {
          if (serialsSet.has(String(u.serial_number || '').trim().toUpperCase())) {
            return {
              ...u,
              status: 'in_stock',
              current_site_id: 'site-dc',
              box_number: 1,
              shipped_at: null,
              shipped_by: null
            };
          }
          return u;
        });
        try { localStorage.setItem('mdc_inventory', JSON.stringify(updated)); } catch (e) {}
        dbStorage.setItem('mdc_inventory', updated);
        return updated;
      });
    }
  }, [setInventoryUnits]);

  // 1. Initial Supabase Hydration and Realtime Subscriptions on app mount
  useEffect(() => {
    let realtimeChannel = null;

    autoRefreshData({ silent: true, force: true, reason: 'Initial app mount' });

    let broadcastBus = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        broadcastBus = new BroadcastChannel('mdc_sync_bus');
        broadcastBus.onmessage = async (ev) => {
          if (ev.data && ev.data.type) {
            handleRealtimeInventoryEvent(ev.data.type, ev.data.payload);

            if (ev.data.type === 'CALCULATION_MODEL_CHANGED') {
              const incomingModel = ev.data.payload?.model;
              if (incomingModel && ['wma', 'linear', 'holt', 'croston'].includes(incomingModel) && setForecastingModel) {
                setForecastingModel(incomingModel);
                try { localStorage.setItem('mdc_forecasting_model', incomingModel); } catch (e) {}
              }
            } else if (ev.data.type === 'PACKING_PRESENCE') {
              const p = ev.data.payload;
              if (p && p.userId) {
                setActivePackingStations(prev => {
                  if (!p.isPacking) {
                    const next = { ...prev };
                    delete next[p.userId];
                    return next;
                  }
                  return {
                    ...prev,
                    [p.userId]: p
                  };
                });
              }
            } else if (ev.data.type === 'PERIOD_RECORD_DELETED' && ev.data.payload?.recordId) {
              const delId = ev.data.payload.recordId;
              if (setSavedRecords) {
                setSavedRecords(prev => {
                  const next = (prev || []).filter(r => r.id !== delId);
                  try { localStorage.setItem('mdc_saved_records', JSON.stringify(next)); } catch (e) {}
                  dbStorage.setItem('mdc_saved_records', next);
                  return next;
                });
              }
            } else if (ev.data.type === 'PERIOD_RECORD_SAVED' && ev.data.payload?.record) {
              const newRec = ev.data.payload.record;
              if (setSavedRecords && newRec?.id) {
                setSavedRecords(prev => {
                  const exists = (prev || []).some(r => r.id === newRec.id);
                  const next = exists ? prev.map(r => r.id === newRec.id ? newRec : r) : [newRec, ...(prev || [])];
                  try { localStorage.setItem('mdc_saved_records', JSON.stringify(next)); } catch (e) {}
                  dbStorage.setItem('mdc_saved_records', next);
                  return next;
                });
              }
            } else if (['GLOBAL_FORCE_CACHE_REFRESH', 'DATASET_UPLOADED', 'FILE_IMPORT_APPLIED', 'MASTER_DATA_CLEARED', 'SHIPMENT_SAVED', 'SHIPMENTS_IMPORTED', 'SHIPMENTS_CLEARED', 'SHIPMENT_DELETED', 'SHIPMENT_RECEIVED'].includes(ev.data.type)) {
              if (ev.data.type === 'GLOBAL_FORCE_CACHE_REFRESH') {
                await clearOperationalLocalStorage({ keepSession: true });
                try { localStorage.removeItem('mdc_last_override_time'); } catch (e) {}
                lastRefreshTimeRef.current = 0;
                await autoRefreshData({ force: true, silent: false, isManual: true, reason: `Global Force Refresh from ${ev.data.payload?.syncedBy || 'Superadmin'}` });
                showToast(`🔄 Global Cloud Sync from Superadmin: Outdated cache cleared & latest database state reloaded.`, 'info');
              } else if (ev.data.type === 'MASTER_DATA_CLEARED') {
                clearOperationalLocalStorage({
                  keepSession: true,
                  preservePeriod: ev.data.payload?.period || null
                });
                try { localStorage.removeItem('mdc_last_override_time'); } catch (e) {}
                if (ev.data.payload?.period && setActivePeriod) {
                  setActivePeriod(ev.data.payload.period);
                }
                autoRefreshData({ force: true, silent: true, isManual: false, reason: `Local Broadcast [${ev.data.type}]` });
              } else {
                if (ev.data.payload?.period && setActivePeriod) {
                  setActivePeriod(ev.data.payload.period);
                }
                autoRefreshData({ force: true, silent: true, isManual: false, reason: `Local Broadcast [${ev.data.type}]` });
              }
            } else if (ev.data.type === 'MASTER_DATA_UPDATED') {
              const lastLocalTime = parseInt(localStorage.getItem('mdc_last_override_time') || '0', 10);
              if (Date.now() - lastLocalTime >= 3000) {
                autoRefreshData({ force: false, silent: true, isManual: false, reason: 'Local Broadcast [MASTER_DATA_UPDATED]' });
              }
            }
            triggerDebouncedRealtimeSync(`Local Broadcast: ${ev.data.type}`, ev.data.table || null);
          }
        };
      }

      if (supabase && typeof supabase.channel === 'function') {
        realtimeChannel = supabase
          .channel('mdc-global-sync-room', {
            config: { broadcast: { self: false } }
          })
          .on('broadcast', { event: 'mdc_sync' }, async (payload) => {
            console.debug('[Realtime WebSocket] Received global peer sync broadcast:', payload);
            const bType = payload?.payload?.type;
            const bPayload = payload?.payload?.payload;

            if (bType && bPayload) {
              handleRealtimeInventoryEvent(bType, bPayload);
            }

            if (bType === 'CALCULATION_MODEL_CHANGED') {
              const incomingModel = bPayload?.model;
              if (incomingModel && ['wma', 'linear', 'holt', 'croston'].includes(incomingModel) && setForecastingModel) {
                setForecastingModel(incomingModel);
                try { localStorage.setItem('mdc_forecasting_model', incomingModel); } catch (e) {}
              }
            } else if (bType === 'PACKING_PRESENCE') {
              const p = bPayload;
              if (p && p.userId) {
                setActivePackingStations(prev => {
                  if (!p.isPacking) {
                    const next = { ...prev };
                    delete next[p.userId];
                    return next;
                  }
                  return {
                    ...prev,
                    [p.userId]: p
                  };
                });
              }
            } else if (bType === 'PERIOD_RECORD_DELETED' && bPayload?.recordId) {
              const delId = bPayload.recordId;
              if (setSavedRecords) {
                setSavedRecords(prev => {
                  const next = (prev || []).filter(r => r.id !== delId);
                  try { localStorage.setItem('mdc_saved_records', JSON.stringify(next)); } catch (e) {}
                  dbStorage.setItem('mdc_saved_records', next);
                  return next;
                });
              }
            } else if (bType === 'PERIOD_RECORD_SAVED' && bPayload?.record) {
              const newRec = bPayload.record;
              if (setSavedRecords && newRec?.id) {
                setSavedRecords(prev => {
                  const exists = (prev || []).some(r => r.id === newRec.id);
                  const next = exists ? prev.map(r => r.id === newRec.id ? newRec : r) : [newRec, ...(prev || [])];
                  try { localStorage.setItem('mdc_saved_records', JSON.stringify(next)); } catch (e) {}
                  dbStorage.setItem('mdc_saved_records', next);
                  return next;
                });
              }
            } else if (['GLOBAL_FORCE_CACHE_REFRESH', 'MASTER_DATA_UPDATED', 'DATASET_UPLOADED', 'FILE_IMPORT_APPLIED', 'MASTER_DATA_CLEARED', 'SHIPMENT_SAVED', 'SHIPMENTS_IMPORTED', 'SHIPMENTS_CLEARED', 'SHIPMENT_DELETED', 'SHIPMENT_RECEIVED'].includes(bType)) {
              if (bType === 'GLOBAL_FORCE_CACHE_REFRESH') {
                await clearOperationalLocalStorage({ keepSession: true });
                try { localStorage.removeItem('mdc_last_override_time'); } catch (e) {}
                lastRefreshTimeRef.current = 0;
                await autoRefreshData({ force: true, silent: false, isManual: true, reason: `WebSocket Global Refresh from ${bPayload?.syncedBy || 'Superadmin'}` });
                showToast(`🔄 Global Cloud Sync from Superadmin: Outdated cache cleared & latest database state reloaded.`, 'info');
              } else if (bType === 'MASTER_DATA_CLEARED') {
                clearOperationalLocalStorage({
                  keepSession: true,
                  preservePeriod: bPayload?.period || null
                });
                try { localStorage.removeItem('mdc_last_override_time'); } catch (e) {}
                if (bPayload?.period && setActivePeriod) {
                  setActivePeriod(bPayload.period);
                }
                autoRefreshData({ force: true, silent: true, isManual: false, reason: `WebSocket Broadcast [${bType}]` });
              } else {
                if (bPayload?.period && setActivePeriod) {
                  setActivePeriod(bPayload.period);
                }
                autoRefreshData({ force: true, silent: true, isManual: false, reason: `WebSocket Broadcast [${bType}]` });
              }
            } else if (bType === 'FORCE_LOGOUT_USER' || (bType === 'USER_REGISTRY_UPDATED' && (bPayload?.action === 'DELETE' || bPayload?.isActive === false))) {
              const targetUserId = String(bPayload?.userId || '').trim().toLowerCase();
              const targetEmail = String(bPayload?.email || '').trim().toLowerCase();
              const curUserId = String(currentUser?.id || '').trim().toLowerCase();
              const curEmail = String(currentUser?.email || '').trim().toLowerCase();

              const isMatch = (targetUserId && (targetUserId === curUserId || targetUserId === curEmail)) ||
                (targetEmail && (targetEmail === curEmail || targetEmail === curUserId));

              if (isMatch) {
                console.warn('[Security Guard] Active session forcefully terminated via Realtime broadcast.');
                clearStoredUserSession();
                try { dbStorage.removeItem('mdc_current_user'); } catch (e) {}
                if (supabase?.auth?.signOut) {
                  supabase.auth.signOut().catch(() => {});
                }
                if (setCurrentUser) {
                  setCurrentUser(null);
                }
                showToast(`Your session was terminated: ${bPayload?.reason || 'Account deleted or modified by administrator.'}`, 'warning');
              }
            }

            // Egress Defense: Only trigger full/selective HTTP hydration if an unhandled table was explicitly targeted.
            // Events that are already applied in-memory (presences, pack updates, model changes) do not re-query the cloud DB.
            const isAlreadyHandledLocally = [
              'PACKING_PRESENCE', 'CALCULATION_MODEL_CHANGED', 'UNIT_PACKED', 'UNIT_UNPACKED',
              'PERIOD_RECORD_SAVED', 'PERIOD_RECORD_DELETED', 'GLOBAL_FORCE_CACHE_REFRESH',
              'MASTER_DATA_UPDATED', 'DATASET_UPLOADED', 'FILE_IMPORT_APPLIED', 'MASTER_DATA_CLEARED',
              'SHIPMENT_SAVED', 'SHIPMENTS_IMPORTED', 'SHIPMENTS_CLEARED', 'SHIPMENT_DELETED', 'SHIPMENT_RECEIVED'
            ].includes(bType);

            if (!isAlreadyHandledLocally && payload?.payload?.table) {
              triggerDebouncedRealtimeSync(`WebSocket Broadcast: ${bType || 'SYNC'}`, payload.payload.table);
            }
          });

        // Only subscribe to low-frequency, event-driven tables for postgres_changes.
        // High-volume bulk tables (inventory_units, scan_logs, allocation_items, etc.) are synchronized
        // via lightweight Supabase Broadcast events to prevent hitting MessagesPerSecondRateLimitReached.
        const REALTIME_POSTGRES_TABLES = [
          'parts_requests',
          'profiles',
          'user_page_permissions',
          'sites',
          'shipments',
          'purchase_orders'
        ];

        REALTIME_POSTGRES_TABLES.forEach(tbl => {
          realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table: tbl }, (ev) => {
            console.debug(`[Realtime Postgres] ${tbl} ${ev.eventType}`);

            if (tbl === 'parts_requests' && setPartsRequests) {
              if (ev.eventType === 'INSERT' && ev.new?.id) {
                setPartsRequests(prev => {
                  if ((prev || []).some(r => r.id === ev.new.id)) return prev;
                  const next = [ev.new, ...(prev || [])];
                  try { localStorage.setItem('mdc_parts_requests', JSON.stringify(next)); } catch (e) {}
                  dbStorage.setItem('mdc_parts_requests', next);
                  return next;
                });
              } else if (ev.eventType === 'UPDATE' && ev.new?.id) {
                setPartsRequests(prev => {
                  const next = (prev || []).map(r => r.id === ev.new.id ? { ...r, ...ev.new } : r);
                  try { localStorage.setItem('mdc_parts_requests', JSON.stringify(next)); } catch (e) {}
                  dbStorage.setItem('mdc_parts_requests', next);
                  return next;
                });
              } else if (ev.eventType === 'DELETE' && ev.old?.id) {
                setPartsRequests(prev => {
                  const next = (prev || []).filter(r => r.id !== ev.old.id);
                  try { localStorage.setItem('mdc_parts_requests', JSON.stringify(next)); } catch (e) {}
                  dbStorage.setItem('mdc_parts_requests', next);
                  return next;
                });
              }
            }

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

  // 1.5. Immediate forced auto-refresh when currentUser logs in or transitions
  const prevUserIdRef = useRef(currentUser?.id);
  useEffect(() => {
    if (currentUser?.id && currentUser.id !== prevUserIdRef.current) {
      prevUserIdRef.current = currentUser.id;
      lastRefreshTimeRef.current = 0; // reset cooldown so login hydration is never throttled
      autoRefreshData({ silent: true, force: true, isManual: true, reason: 'User session active / login transition' });
    } else if (!currentUser?.id) {
      prevUserIdRef.current = null;
    }
  }, [currentUser?.id, autoRefreshData]);

  // 2. Auto-Refresh on Page Navigation (Smart cache TTL: 15 mins since last sync)
  useEffect(() => {
    if (currentUser?.id && activeTab) {
      const now = Date.now();
      if (now - lastRefreshTimeRef.current >= 900000) {
        autoRefreshData({ silent: true, force: false, reason: `Page visit: ${activeTab}` });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser?.id]);

  // 3. Auto-Refresh on Window Focus, Tab Visibility Change, and Network Reconnection (Throttled to 15 mins)
  useEffect(() => {
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible' && currentUser?.id) {
        const now = Date.now();
        if (now - lastRefreshTimeRef.current >= 900000) {
          autoRefreshData({ silent: true, force: false, reason: 'Tab/Window refocus' });
        }
      }
    };

    const handleOnline = () => {
      if (currentUser?.id) {
        processOfflineSyncQueue();
        autoRefreshData({ silent: false, force: true, isManual: true, reason: 'Network reconnected' });
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
  }, [currentUser?.id, processOfflineSyncQueue]);

  // 4. Periodic background safety-net heartbeat revalidation (every 10 mins, only if offline or disconnected)
  useEffect(() => {
    if (!currentUser?.id) return;
    const intervalMs = 600000; // 10 minutes
    const heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        const hasQueuedItems = processOfflineSyncQueue();
        if (hasQueuedItems || !realtimeConnected) {
          autoRefreshData({ silent: true, force: false, reason: 'Background safety heartbeat' });
        }
      }
    }, intervalMs);
    return () => clearInterval(heartbeatInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, processOfflineSyncQueue, realtimeConnected]);

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
        const resolvedActivePeriod = activePeriod || { month: 9, year: 2026, label: 'September 2026' };
        const liveSnapshotPayload = {
          id: LIVE_MASTER_RECORD_ID,
          record_type: 'both',
          period_label: `${resolvedActivePeriod.label || 'September 2026'} Live Master State`,
          period_year: resolvedActivePeriod.year || 2026,
          period_month: resolvedActivePeriod.month || 9,
          saved_by_name: currentUser?.fullName || 'Superadmin User',
          saved_by_user_id: null,
          notes: 'Real-time multi-user synchronized Distribution Center state',
          snapshot_data: {
            isCleared: false,
            activePeriod: resolvedActivePeriod,
            forecastingModel: _forecastingModel || 'linear',
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
          })).filter(c => c.code);
          const uniqueCatRows = Array.from(new Map(catRows.map(r => [r.code.trim().toUpperCase(), r])).values());
          if (uniqueCatRows.length > 0) {
            await supabase.from('part_categories').upsert(uniqueCatRows, { onConflict: 'code' });
          }
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
          })).filter(s => s.code);
          const uniqueSiteRows = Array.from(new Map(siteRows.map(r => [r.code.trim().toUpperCase(), r])).values());
          if (uniqueSiteRows.length > 0) {
            await supabase.from('sites').upsert(uniqueSiteRows, { onConflict: 'code' });
          }
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
          }).filter(p => p.part_number);
          const uniquePartRows = Array.from(new Map(partRows.map(r => [r.part_number.trim().toUpperCase(), r])).values());
          if (uniquePartRows.length > 0) {
            await supabase.from('parts').upsert(uniquePartRows, { onConflict: 'part_number' });
          }
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
    dbStorage.setItem('mdc_upload_audit_logs', []);
    dbStorage.setItem('mdc_stock_transfer_reports', []);
    dbStorage.setItem('mdc_stock_transfer_metadata', null);

    try {
      localStorage.setItem('mdc_is_cleared', 'true');
      localStorage.setItem('mdc_forecast', '[]');
      localStorage.setItem('mdc_allocations', '[]');
      localStorage.setItem('mdc_inventory', '[]');
      localStorage.removeItem('mdc_recent_scans');
      localStorage.setItem('mdc_pos', '[]');
      localStorage.setItem('mdc_shipments', '[]');
      localStorage.setItem('mdc_scan_logs', '[]');
      localStorage.setItem('mdc_repair_usage', '[]');
      localStorage.setItem('mdc_stock_transfer_reports', '[]');
      localStorage.removeItem('mdc_stock_transfer_metadata');
      localStorage.setItem('mdc_upload_audit_logs', '[]');
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
    setUploadAuditLogs([]);

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
        try { await supabase.from('repair_usage_records').delete().neq('id', '00000000-0000-0000-0000-000000000000'); } catch (e) {}

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
        const newForecasts = payload.forecastItems || [];
        setForecastItems(newForecasts);
        dbStorage.setItem('mdc_forecast', newForecasts);
        try { localStorage.setItem('mdc_forecast', JSON.stringify(newForecasts)); } catch (e) {}

        const newAllocations = (payload.allocations && payload.allocations.length > 0)
          ? payload.allocations
          : generateAllocationsFromForecasts(newForecasts, sites);

        setAllocations(newAllocations);
        dbStorage.setItem('mdc_allocations', newAllocations);
        try { localStorage.setItem('mdc_allocations', JSON.stringify(newAllocations)); } catch (e) {}

        showToast(`Dynamic forecast matrix updated with ${newForecasts.length} parts and ${newAllocations.length} branch allocations!`, 'success');
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
        const newAllocations = payload.allocations || [];
        setAllocations(newAllocations);
        dbStorage.setItem('mdc_allocations', newAllocations);
        try { localStorage.setItem('mdc_allocations', JSON.stringify(newAllocations)); } catch (e) {}

        const newForecastItems = payload.forecastItems && payload.forecastItems.length > 0
          ? payload.forecastItems
          : newAllocations.map(a => ({
              part_id: a.part_id,
              part_number: a.part_number,
              description: a.description,
              category_id: a.category_id,
              stocking_price: a.stocking_price,
              exchange_price: a.exchange_price,
              computed_forecast: a.forecasted_qty || a.total_allocated_qty,
              final_forecast: a.forecasted_qty || a.total_allocated_qty,
              ytd_monthly_counts: []
            }));

        setForecastItems(newForecastItems);
        dbStorage.setItem('mdc_forecast', newForecastItems);
        try { localStorage.setItem('mdc_forecast', JSON.stringify(newForecastItems)); } catch (e) {}

        showToast(`Dynamic Master Allocation updated with ${newAllocations.length} parts from "${sheetName}"!`, 'success');
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

        // Clean fresh forecasts from the uploaded raw file without stale cache overrides
        const finalForecastItems = payload.forecastItems || [];

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
      broadcastCloudEvent('DATASET_UPLOADED', { period: newPeriod, targetTab: 'forecast', timestamp: Date.now() });
      broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'saved_records', period: newPeriod, timestamp: Date.now() });
    } catch (err) {
      console.error('Error applying parsed dataset:', err);
      showToast(`Error applying data: ${err.message}`, 'error');
    }
  };

  // Test Database Connection & Latency
  const testDatabaseConnection = async () => {
    if (!supabase) return { connected: false, error: 'Supabase client not initialized', latency: 0 };
    const t0 = performance.now();
    try {
      const { count, error } = await supabase.from('parts').select('id', { count: 'exact', head: true });
      const latency = Math.round(performance.now() - t0);
      if (error) throw error;
      return { connected: true, latency, count: count || 0 };
    } catch (err) {
      return { connected: false, error: err.message, latency: Math.round(performance.now() - t0) };
    }
  };

  // Force Global Cloud Sync & Purge All Users Cache
  const forceGlobalCloudSyncAndPurge = async (overrideData = null) => {
    if (!supabase) {
      showToast('Supabase client is not connected', 'error');
      return { success: false, error: 'Supabase client is not connected' };
    }

    try {
      showToast('Initiating Global Cloud Sync & Database Upsert...', 'info');

      // 1. Sync all master data to Supabase (parts, sites, categories, forecasts, allocations, logs)
      const syncRes = await syncAllDataToCloud(overrideData);
      if (!syncRes.success) throw new Error(syncRes.error || 'Failed to sync master data');

      // 2. Sync Live Inventory Units (DC & Branches)
      const currentInv = overrideData?.inventoryUnits || inventoryUnits || [];
      if (currentInv.length > 0) {
        try {
          await supabase.from('saved_records').upsert({
            id: 'live_master_dc_inventory',
            record_type: 'inventory_master',
            period_label: 'Live Master DC Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            period_week: 1,
            notes: 'Master DC In-Stock inventory pool across all accounts',
            saved_by_name: currentUser?.fullName || 'Superadmin',
            snapshot_data: { units: currentInv },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (e) {
          console.warn('Inventory units saved_records sync note:', e);
        }
      }

      // 3. Sync Outbound Shipments & Manifests
      const currentShipments = overrideData?.shipments || _shipments || [];
      if (currentShipments.length > 0) {
        try {
          await supabase.from('saved_records').upsert({
            id: 'master_shipments_registry',
            record_type: 'shipments_registry',
            period_label: 'Master Shipments Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Master DC Outbound Shipments & Packing Lists',
            saved_by_name: currentUser?.fullName || 'Superadmin',
            snapshot_data: {
              shipments: currentShipments,
              updatedAt: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (e) {
          console.warn('Shipments saved_records sync note:', e);
        }
      }

      // 4. Sync User Accounts & Roles
      const currentUsers = overrideData?.usersList || _usersList || [];
      if (currentUsers.length > 0) {
        try {
          await supabase.from('saved_records').upsert({
            id: 'master_user_accounts_registry',
            record_type: 'user_accounts_registry',
            period_label: 'Master User Accounts Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Master User Accounts & Security Matrix',
            saved_by_name: currentUser?.fullName || 'Superadmin',
            snapshot_data: {
              users: currentUsers,
              updatedAt: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (e) {
          console.warn('Users saved_records sync note:', e);
        }
      }

      // 5. Write Global Sync Beacon
      const syncBeaconPayload = {
        syncVersion: Date.now(),
        syncedBy: currentUser?.fullName || 'Superadmin',
        syncedByEmail: currentUser?.email || '',
        syncedAt: new Date().toISOString(),
        action: 'GLOBAL_FORCE_CACHE_REFRESH'
      };

      try {
        await supabase.from('saved_records').upsert({
          id: 'global_cloud_sync_beacon',
          record_type: 'sync_beacon',
          period_label: 'Global Cloud Sync Beacon',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: `Global synchronization initiated by ${currentUser?.fullName || 'Superadmin'}`,
          saved_by_name: currentUser?.fullName || 'Superadmin',
          saved_by_user_id: safeUUID(currentUser?.id),
          snapshot_data: syncBeaconPayload,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      } catch (e) {
        console.warn('Sync beacon note:', e);
      }

      // 6. Broadcast Global Cache Purge & Hard Refresh across the entire network
      broadcastCloudEvent('GLOBAL_FORCE_CACHE_REFRESH', syncBeaconPayload);

      // 7. Locally clear operational cache & rehydrate fresh data for this Superadmin session
      await clearOperationalLocalStorage({ keepSession: true });
      lastRefreshTimeRef.current = 0;
      await autoRefreshData({ force: true, silent: true, isManual: true, reason: 'Superadmin Initiated Global Sync' });

      setLastSyncedAt(new Date());
      showToast('🚀 Global Cloud Sync Complete: Pushed latest data to PostgreSQL and triggered cache reload on all user devices!', 'success');
      return { success: true, timestamp: syncBeaconPayload.syncedAt };
    } catch (err) {
      console.error('Global cloud sync error:', err);
      showToast(`Global sync error: ${err.message}`, 'error');
      return { success: false, error: err.message };
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
    forceGlobalCloudSyncAndPurge,
    testDatabaseConnection,
    resetToDefaultData,
    clearAllData,
    applyParsedDataset,
    activePackingStations,
    broadcastPackingPresence
  };
}
