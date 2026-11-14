import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabase/client.js';
import dbStorage from '../utils/dbStorage.js';
import consumablesToolsSeed from '../data/consumablesToolsSeed.json' with { type: 'json' };
import {
  importPriorityPartsFromCsv,
  mergePriorityCatalogAndOrders
} from '../utils/priorityPartsImporter.js';
import {
  CT_CLOUD_RECORD_ID,
  CT_REALTIME_CHANNEL,
  CT_LOCAL_BROADCAST_CHANNEL,
  CT_CLOUD_UPDATED_AT_KEY,
  generateCtClientId,
  extractCtStateFromSnapshot,
  shouldApplyRemoteCtSnapshot,
  fetchCtSnapshotFromSupabase,
  pushCtSnapshotToSupabase
} from '../utils/ctCloudSync.js';
import {
  generateCtId,
  normalizePartNumber,
  validateAndReceiveOrderLine,
  parseConsumablesReceivingCsv,
  transitionToolAsset,
  consumeConsumableStock,
  createConsumablesToolsShipment,
  confirmConsumablesToolsDelivery
} from '../utils/consumablesToolsEngine.js';

const LS_KEYS = {
  catalog: 'mdc_ct_catalog',
  orders: 'mdc_ct_orders',
  stock: 'mdc_ct_stock',
  toolAssets: 'mdc_ct_tool_assets',
  movements: 'mdc_ct_movements',
  shipments: 'mdc_ct_shipments'
};

function readStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function persistDual(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore QuotaExceededError on large localStorage writes; IndexedDB handles full persistence
  }
  dbStorage.setItem(key, value).catch(() => {});
}

function stripSeedMovements(list) {
  return Array.isArray(list) ? list.filter(m => m?.performed_by_name !== 'Priority CSV Seed') : [];
}

export function useConsumablesAndTools({
  currentUser,
  getCurrentUser,
  parts = [],
  showToast,
  logAuditEvent
}) {
  const resolveActor = useCallback(() => {
    const activeUser = currentUser || (typeof getCurrentUser === 'function' ? getCurrentUser() : null);
    return {
      id: activeUser?.id || null,
      name: activeUser?.fullName || activeUser?.email || 'Warehouse Specialist',
      email: activeUser?.email || null
    };
  }, [currentUser, getCurrentUser]);

  const [ctCatalog, setCtCatalog] = useState(() => {
    const saved = readStorageJson(LS_KEYS.catalog, []);
    const seedItems = Array.isArray(consumablesToolsSeed?.catalogItems) ? consumablesToolsSeed.catalogItems : [];
    const merged = mergePriorityCatalogAndOrders(saved, [], { catalogItems: seedItems, orders: [] });
    return merged.catalog || [];
  });

  // Unify Priority Consumables/Tools definitions with Settings -> Parts Master Catalog
  // so Consumables & Tools relies on the existing system Parts Master Catalog without a duplicate catalog UI.
  const unifiedCatalog = useMemo(() => {
    const map = new Map();
    (ctCatalog || []).forEach(item => {
      const pn = normalizePartNumber(item.part_number);
      if (pn) map.set(pn, item);
    });
    (parts || []).forEach(part => {
      const pn = normalizePartNumber(part.part_number);
      if (!pn || map.has(pn)) return;
      const catText = `${part.category || ''} ${part.description || ''}`.toLowerCase();
      const inferredKind = /tool|fixture|jig|torque|driver|opener|press|pocket|heater|station|stand|cutter|tray/.test(catText)
        ? 'tool'
        : 'consumable';
      map.set(pn, {
        id: part.id || `master-${pn}`,
        part_number: pn,
        description: part.description || pn,
        item_kind: inferredKind,
        category: part.category || 'Master Catalog',
        unit_of_measure: inferredKind === 'tool' ? 'unit' : 'pcs',
        pack_size: 1,
        unit_cost: Number(part.stock_price ?? part.unit_cost ?? 0) || 0,
        is_serialized: false,
        min_stock_threshold: 2,
        reorder_qty: 5,
        is_synthetic_sku: false,
        needs_review: false,
        is_active: true
      });
    });
    return Array.from(map.values());
  }, [ctCatalog, parts]);

  const [ctOrders, setCtOrders] = useState(() => {
    const saved = readStorageJson(LS_KEYS.orders, []);
    const seedOrders = Array.isArray(consumablesToolsSeed?.orders) ? consumablesToolsSeed.orders : [];
    const merged = mergePriorityCatalogAndOrders([], saved, { catalogItems: [], orders: seedOrders });
    return merged.orders;
  });

  const [ctStock, setCtStock] = useState(() => readStorageJson(LS_KEYS.stock, []));
  const [ctToolAssets, setCtToolAssets] = useState(() => readStorageJson(LS_KEYS.toolAssets, []));
  const [ctMovements, setCtMovements] = useState(() => {
    const saved = readStorageJson(LS_KEYS.movements, []);
    return stripSeedMovements(saved);
  });
  const [ctShipments, setCtShipments] = useState(() => readStorageJson(LS_KEYS.shipments, []));
  const [ctSyncStatus, setCtSyncStatus] = useState({
    isSyncing: false,
    lastSyncedAt: null,
    realtimeConnected: false,
    error: null
  });

  const clientIdRef = useRef(generateCtClientId());
  const localUpdatedAtRef = useRef(readStorageJson(CT_CLOUD_UPDATED_AT_KEY, null));
  const ctRealtimeChannelRef = useRef(null);
  const localBroadcastRef = useRef(null);
  const latestStateRef = useRef({
    catalog: ctCatalog,
    orders: ctOrders,
    stock: ctStock,
    toolAssets: ctToolAssets,
    movements: ctMovements,
    shipments: ctShipments
  });

  useEffect(() => {
    latestStateRef.current = {
      catalog: ctCatalog,
      orders: ctOrders,
      stock: ctStock,
      toolAssets: ctToolAssets,
      movements: ctMovements,
      shipments: ctShipments
    };
  }, [ctCatalog, ctOrders, ctStock, ctToolAssets, ctMovements, ctShipments]);

  const applyRemoteCtState = useCallback((remoteState, { force = false } = {}) => {
    if (!remoteState) return false;
    const shouldApply = shouldApplyRemoteCtSnapshot({
      remoteUpdatedAt: remoteState.updatedAt,
      localUpdatedAt: localUpdatedAtRef.current,
      remoteClientId: remoteState.clientId,
      localClientId: clientIdRef.current,
      force
    });
    if (!shouldApply) return false;

    const hadSeedMovements = Array.isArray(remoteState.movements) &&
      remoteState.movements.some(m => m?.performed_by_name === 'Priority CSV Seed');

    const nextState = {
      catalog: Array.isArray(remoteState.catalog) ? remoteState.catalog : latestStateRef.current.catalog,
      orders: Array.isArray(remoteState.orders) ? remoteState.orders : latestStateRef.current.orders,
      stock: Array.isArray(remoteState.stock) ? remoteState.stock : latestStateRef.current.stock,
      toolAssets: Array.isArray(remoteState.toolAssets) ? remoteState.toolAssets : latestStateRef.current.toolAssets,
      movements: Array.isArray(remoteState.movements)
        ? stripSeedMovements(remoteState.movements)
        : latestStateRef.current.movements,
      shipments: Array.isArray(remoteState.shipments) ? remoteState.shipments : latestStateRef.current.shipments
    };

    latestStateRef.current = nextState;
    setCtCatalog(nextState.catalog);
    setCtOrders(nextState.orders);
    setCtStock(nextState.stock);
    setCtToolAssets(nextState.toolAssets);
    setCtMovements(nextState.movements);
    setCtShipments(nextState.shipments);

    persistDual(LS_KEYS.catalog, nextState.catalog);
    persistDual(LS_KEYS.orders, nextState.orders);
    persistDual(LS_KEYS.stock, nextState.stock);
    persistDual(LS_KEYS.toolAssets, nextState.toolAssets);
    persistDual(LS_KEYS.movements, nextState.movements);
    persistDual(LS_KEYS.shipments, nextState.shipments);

    if (remoteState.updatedAt) {
      localUpdatedAtRef.current = remoteState.updatedAt;
      persistDual(CT_CLOUD_UPDATED_AT_KEY, remoteState.updatedAt);
    }
    if (hadSeedMovements && supabase) {
      const cleanedAt = new Date().toISOString();
      localUpdatedAtRef.current = cleanedAt;
      persistDual(CT_CLOUD_UPDATED_AT_KEY, cleanedAt);
      pushCtSnapshotToSupabase(supabase, nextState, {
        clientId: clientIdRef.current,
        actorName: 'System',
        reason: 'clean_seed_movements',
        updatedAt: cleanedAt
      }).catch(() => {});
    }
    setCtSyncStatus(prev => ({
      ...prev,
      lastSyncedAt: new Date().toISOString(),
      error: null
    }));
    return true;
  }, []);

  const broadcastCtSignal = useCallback((meta = {}) => {
    const payload = {
      type: 'CT_STATE_UPDATED',
      clientId: clientIdRef.current,
      updatedAt: meta.updatedAt || new Date().toISOString(),
      reason: meta.reason || 'state_update',
      actorName: meta.actorName || 'System'
    };

    if (localBroadcastRef.current) {
      try {
        localBroadcastRef.current.postMessage(payload);
      } catch {
        // Ignore closed BroadcastChannel
      }
    }

    if (ctRealtimeChannelRef.current) {
      try {
        ctRealtimeChannelRef.current.send({
          type: 'broadcast',
          event: 'ct_sync',
          payload
        });
      } catch {
        // Non-blocking realtime broadcast
      }
    }
  }, []);

  const commitAndSyncState = useCallback((partialNext, { reason = 'state_update', actorName = 'System' } = {}) => {
    const nextState = {
      catalog: partialNext.catalog ?? latestStateRef.current.catalog,
      orders: partialNext.orders ?? latestStateRef.current.orders,
      stock: partialNext.stock ?? latestStateRef.current.stock,
      toolAssets: partialNext.toolAssets ?? latestStateRef.current.toolAssets,
      movements: partialNext.movements ?? latestStateRef.current.movements,
      shipments: partialNext.shipments ?? latestStateRef.current.shipments
    };
    latestStateRef.current = nextState;

    const updatedAt = new Date().toISOString();
    localUpdatedAtRef.current = updatedAt;
    persistDual(CT_CLOUD_UPDATED_AT_KEY, updatedAt);

    if (!supabase) return;
    setCtSyncStatus(prev => ({ ...prev, isSyncing: true }));
    pushCtSnapshotToSupabase(supabase, nextState, {
      clientId: clientIdRef.current,
      actorName,
      reason,
      updatedAt
    }).then((res) => {
      if (res.ok) {
        broadcastCtSignal({ updatedAt, reason, actorName });
        setCtSyncStatus(prev => ({
          ...prev,
          isSyncing: false,
          lastSyncedAt: updatedAt,
          error: null
        }));
      } else {
        setCtSyncStatus(prev => ({
          ...prev,
          isSyncing: false,
          error: res.error || 'Sync failed'
        }));
      }
    }).catch((err) => {
      setCtSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        error: err?.message || 'Sync error'
      }));
    });
  }, [broadcastCtSignal]);

  const syncCtFromCloud = useCallback(async ({ force = false } = {}) => {
    if (!supabase) return { ok: false, error: 'Supabase unavailable' };
    setCtSyncStatus(prev => ({ ...prev, isSyncing: true }));
    const res = await fetchCtSnapshotFromSupabase(supabase);
    if (res.ok && res.data) {
      applyRemoteCtState(res.data, { force });
      setCtSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        lastSyncedAt: new Date().toISOString(),
        error: null
      }));
      return { ok: true, source: 'remote' };
    }

    if (res.ok && !res.data) {
      // Cloud record does not exist yet: seed Supabase with current state so all peers share it
      const seedRes = await pushCtSnapshotToSupabase(supabase, latestStateRef.current, {
        clientId: clientIdRef.current,
        actorName: currentUser?.fullName || currentUser?.name || 'System',
        reason: 'initial_seed'
      });
      if (seedRes.ok && seedRes.updatedAt) {
        localUpdatedAtRef.current = seedRes.updatedAt;
        persistDual(CT_CLOUD_UPDATED_AT_KEY, seedRes.updatedAt);
      }
      setCtSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        lastSyncedAt: seedRes.ok ? new Date().toISOString() : prev.lastSyncedAt,
        error: seedRes.ok ? null : (seedRes.error || null)
      }));
      return { ok: seedRes.ok, source: 'seeded', error: seedRes.error };
    }

    setCtSyncStatus(prev => ({
      ...prev,
      isSyncing: false,
      error: res.error || 'Failed to sync Consumables & Tools'
    }));
    return { ok: false, error: res.error };
  }, [applyRemoteCtState, currentUser?.fullName, currentUser?.name]);

  // Hydrate asynchronously from IndexedDB (survives cleared/quota-limited localStorage)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dbCat, dbOrd, dbStk, dbAssets, dbMov, dbShp] = await Promise.all([
          dbStorage.getItem(LS_KEYS.catalog),
          dbStorage.getItem(LS_KEYS.orders),
          dbStorage.getItem(LS_KEYS.stock),
          dbStorage.getItem(LS_KEYS.toolAssets),
          dbStorage.getItem(LS_KEYS.movements),
          dbStorage.getItem(LS_KEYS.shipments)
        ]);
        if (cancelled) return;

        if (Array.isArray(dbCat) && dbCat.length > 0) {
          setCtCatalog(prev =>
            mergePriorityCatalogAndOrders(prev, [], { catalogItems: dbCat, orders: [] }).catalog || prev
          );
        }
        if (Array.isArray(dbOrd) && dbOrd.length > 0) {
          setCtOrders(prev =>
            mergePriorityCatalogAndOrders([], prev, { catalogItems: [], orders: dbOrd }).orders
          );
        }
        if (Array.isArray(dbStk) && dbStk.length > 0) {
          setCtStock(prev => (prev.length >= dbStk.length ? prev : dbStk));
        }
        if (Array.isArray(dbAssets) && dbAssets.length > 0) {
          setCtToolAssets(prev => (prev.length >= dbAssets.length ? prev : dbAssets));
        }
        if (Array.isArray(dbMov) && dbMov.length > 0) {
          const cleanedDbMov = stripSeedMovements(dbMov);
          if (cleanedDbMov.length !== dbMov.length) {
            persistDual(LS_KEYS.movements, cleanedDbMov);
          }
          if (cleanedDbMov.length > 0) {
            setCtMovements(prev => (prev.length >= cleanedDbMov.length ? prev : cleanedDbMov));
          }
        }
        if (Array.isArray(dbShp) && dbShp.length > 0) {
          setCtShipments(prev => (prev.length >= dbShp.length ? prev : dbShp));
        }
      } catch {
        // IndexedDB optional in non-browser/test environments
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cloud hydration + Supabase Realtime & BroadcastChannel subscriptions
  useEffect(() => {
    let cancelled = false;
    let debounceTimer = null;

    const triggerDebouncedFetch = () => {
      if (cancelled) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!cancelled) syncCtFromCloud({ force: false });
      }, 150);
    };

    syncCtFromCloud({ force: true });

    let broadcastBus = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        broadcastBus = new BroadcastChannel(CT_LOCAL_BROADCAST_CHANNEL);
        broadcastBus.onmessage = (event) => {
          const msg = event?.data;
          if (!msg || msg.clientId === clientIdRef.current) return;
          if (msg.type === 'CT_STATE_UPDATED') {
            triggerDebouncedFetch();
          }
        };
        localBroadcastRef.current = broadcastBus;
      } catch {
        // BroadcastChannel optional
      }
    }

    let channel = null;
    if (supabase && typeof supabase.channel === 'function') {
      try {
        channel = supabase.channel(CT_REALTIME_CHANNEL, {
          config: { broadcast: { self: false } }
        });

        channel
          .on('broadcast', { event: 'ct_sync' }, ({ payload }) => {
            if (!payload || payload.clientId === clientIdRef.current) return;
            triggerDebouncedFetch();
          })
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'saved_records',
              filter: `id=eq.${CT_CLOUD_RECORD_ID}`
            },
            (ev) => {
              const extracted = extractCtStateFromSnapshot(ev?.new?.snapshot_data);
              if (extracted) {
                applyRemoteCtState(extracted, { force: false });
              } else {
                triggerDebouncedFetch();
              }
            }
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'consumables_tools_movements' },
            () => {
              triggerDebouncedFetch();
            }
          )
          .subscribe((status) => {
            if (cancelled) return;
            setCtSyncStatus(prev => ({
              ...prev,
              realtimeConnected: status === 'SUBSCRIBED'
            }));
          });

        ctRealtimeChannelRef.current = channel;
      } catch {
        // Non-blocking realtime setup
      }
    }

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        syncCtFromCloud({ force: false });
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    const pollInterval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        syncCtFromCloud({ force: false });
      }
    }, 30000);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(pollInterval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (broadcastBus) {
        try { broadcastBus.close(); } catch {}
        localBroadcastRef.current = null;
      }
      if (channel && supabase && typeof supabase.removeChannel === 'function') {
        try { supabase.removeChannel(channel); } catch {}
        ctRealtimeChannelRef.current = null;
      }
    };
  }, [currentUser?.id, currentUser?.email, syncCtFromCloud, applyRemoteCtState]);

  const syncMovementsToSupabase = useCallback(async (newMovements) => {
    if (!supabase || !Array.isArray(newMovements) || newMovements.length === 0) return;
    try {
      await supabase.from('consumables_tools_movements').insert(
        newMovements.map(m => ({
          id: m.id,
          part_number: m.part_number,
          description: m.description,
          item_kind: m.item_kind,
          action: m.action,
          quantity: m.quantity,
          serial_numbers: m.serial_numbers || [],
          asset_tags: m.asset_tags || [],
          from_site_code: m.from_site_code,
          to_site_code: m.to_site_code,
          reference_type: m.reference_type,
          reference_id: m.reference_id,
          reference_number: m.reference_number,
          performed_by_name: m.performed_by_name,
          notes: m.notes,
          created_at: m.created_at
        }))
      );
    } catch {
      // Non-blocking remote sync
    }
  }, []);

  const appendMovements = useCallback((items) => {
    if (!Array.isArray(items) || items.length === 0) return latestStateRef.current.movements;
    const nextMovements = [...items, ...latestStateRef.current.movements];
    latestStateRef.current = { ...latestStateRef.current, movements: nextMovements };
    setCtMovements(nextMovements);
    persistDual(LS_KEYS.movements, nextMovements);
    syncMovementsToSupabase(items);
    return nextMovements;
  }, [syncMovementsToSupabase]);

  const recordAudit = useCallback((action, targetLabel, details = {}) => {
    if (typeof logAuditEvent === 'function') {
      logAuditEvent({
        action,
        entityType: 'Consumables & Tools',
        entityLabel: targetLabel,
        details
      });
    }
  }, [logAuditEvent]);

  const saveCtCatalogItem = useCallback((itemData) => {
    const actor = resolveActor();
    const cleanPn = normalizePartNumber(itemData.part_number);
    if (!cleanPn || !itemData.description?.trim()) {
      showToast?.('Part Number and Description are required.', 'error');
      return { ok: false, message: 'Part Number and Description are required.' };
    }
    const now = new Date().toISOString();
    let savedItem;

    const prevCatalog = latestStateRef.current.catalog;
    const idx = prevCatalog.findIndex(
      it => (itemData.id && it.id === itemData.id) || normalizePartNumber(it.part_number) === cleanPn
    );
    const nextCatalog = [...prevCatalog];
    if (idx >= 0) {
      savedItem = {
        ...nextCatalog[idx],
        ...itemData,
        part_number: cleanPn,
        min_stock_threshold: Number(itemData.min_stock_threshold ?? nextCatalog[idx].min_stock_threshold ?? 2),
        reorder_qty: Number(itemData.reorder_qty ?? nextCatalog[idx].reorder_qty ?? 5),
        unit_cost: Number(itemData.unit_cost ?? nextCatalog[idx].unit_cost ?? 0),
        pack_size: Number(itemData.pack_size ?? nextCatalog[idx].pack_size ?? 1),
        updated_at: now
      };
      nextCatalog[idx] = savedItem;
    } else {
      savedItem = {
        id: itemData.id || generateCtId('ct-cat'),
        part_number: cleanPn,
        description: itemData.description.trim(),
        item_kind: itemData.item_kind === 'tool' ? 'tool' : 'consumable',
        category: itemData.category || (itemData.item_kind === 'tool' ? 'Service Tools' : 'Adhesives'),
        unit_of_measure: itemData.unit_of_measure || (itemData.item_kind === 'tool' ? 'unit' : 'pcs'),
        pack_size: Number(itemData.pack_size) || 1,
        unit_cost: Number(itemData.unit_cost) || 0,
        is_serialized: Boolean(itemData.is_serialized),
        min_stock_threshold: Number(itemData.min_stock_threshold ?? 2),
        reorder_qty: Number(itemData.reorder_qty ?? 5),
        is_synthetic_sku: Boolean(itemData.is_synthetic_sku),
        needs_review: Boolean(itemData.needs_review),
        notes: itemData.notes || null,
        is_active: itemData.is_active !== false,
        created_at: now,
        updated_at: now
      };
      nextCatalog.unshift(savedItem);
    }
    setCtCatalog(nextCatalog);
    persistDual(LS_KEYS.catalog, nextCatalog);
    commitAndSyncState({ catalog: nextCatalog }, { reason: 'catalog_saved', actorName: actor.name });

    recordAudit('CT_CATALOG_SAVED', cleanPn, { performed_by: actor.name });
    showToast?.(`Saved catalog item ${cleanPn}`, 'success');
    return { ok: true, item: savedItem };
  }, [resolveActor, commitAndSyncState, recordAudit, showToast]);

  const addCtOrder = useCallback((orderPayload) => {
    const actor = resolveActor();
    const now = new Date().toISOString();
    const poNumber = String(orderPayload.po_number || '').trim().toUpperCase();
    if (!poNumber || !Array.isArray(orderPayload.items) || orderPayload.items.length === 0) {
      showToast?.('PO Number and at least one line item are required.', 'error');
      return { ok: false, message: 'Missing PO Number or items.' };
    }

    const orderId = orderPayload.id || generateCtId('ct-ord');
    const orderItems = orderPayload.items.map(it => {
      const cleanPn = normalizePartNumber(it.part_number);
      const catMatch = unifiedCatalog.find(c => normalizePartNumber(c.part_number) === cleanPn);
      return {
        id: it.id || generateCtId('ct-oi'),
        order_id: orderId,
        catalog_id: it.catalog_id || catMatch?.id || null,
        part_number: cleanPn,
        description: it.description || catMatch?.description || cleanPn,
        item_kind: it.item_kind || catMatch?.item_kind || 'consumable',
        quantity_ordered: parseInt(it.quantity_ordered, 10) || 1,
        quantity_received: parseInt(it.quantity_received, 10) || 0,
        unit_cost: Number(it.unit_cost ?? catMatch?.unit_cost ?? 0),
        needs_review: Boolean(it.needs_review),
        review_reason: it.review_reason || null
      };
    });

    const newOrder = {
      id: orderId,
      po_number: poNumber,
      order_number: orderPayload.order_number || null,
      site_code: orderPayload.site_code || 'DC-MDC',
      ship_to_location: orderPayload.ship_to_location || orderPayload.site_code || 'DC-MDC',
      sold_to_location: orderPayload.sold_to_location || 'DC-MDC',
      supplier: orderPayload.supplier || 'Apple South Asia Pte Ltd',
      order_date: orderPayload.order_date || now.slice(0, 10),
      status: 'ordered',
      total_amount: orderItems.reduce((s, it) => s + it.quantity_ordered * it.unit_cost, 0),
      remarks: orderPayload.remarks || '',
      created_by: actor.id,
      created_by_name: actor.name,
      items: orderItems,
      created_at: now,
      updated_at: now
    };

    const nextOrders = [newOrder, ...latestStateRef.current.orders.filter(o => o.po_number !== poNumber)];
    setCtOrders(nextOrders);
    persistDual(LS_KEYS.orders, nextOrders);

    const orderedMovements = orderItems.map(it => ({
      id: generateCtId('ct-mov'),
      catalog_id: it.catalog_id,
      part_number: it.part_number,
      description: it.description,
      item_kind: it.item_kind,
      action: 'ordered',
      quantity: it.quantity_ordered,
      serial_numbers: [],
      asset_tags: [],
      from_site_code: newOrder.supplier,
      to_site_code: newOrder.site_code,
      reference_type: 'order',
      reference_id: newOrder.id,
      reference_number: poNumber,
      performed_by: actor.id,
      performed_by_name: actor.name,
      notes: newOrder.remarks || `Created Consumables/Tools PO ${poNumber}`,
      created_at: now
    }));
    const nextMovements = appendMovements(orderedMovements);
    commitAndSyncState(
      { orders: nextOrders, movements: nextMovements },
      { reason: 'po_created', actorName: actor.name }
    );
    recordAudit('CT_PO_CREATED', poNumber, { lineCount: orderItems.length, performed_by: actor.name });
    showToast?.(`Created PO ${poNumber} (${orderItems.length} item lines)`, 'success');
    return { ok: true, order: newOrder };
  }, [resolveActor, unifiedCatalog, appendMovements, commitAndSyncState, recordAudit, showToast]);

  const updateCtOrder = useCallback((orderId, orderPayload) => {
    const actor = resolveActor();
    const now = new Date().toISOString();
    const existing = ctOrders.find(o => o.id === orderId);
    if (!existing) {
      showToast?.('Purchase Order not found.', 'error');
      return { ok: false, message: 'Purchase Order not found.' };
    }

    const poNumber = String(orderPayload.po_number || existing.po_number || '').trim().toUpperCase();
    if (!poNumber || !Array.isArray(orderPayload.items) || orderPayload.items.length === 0) {
      showToast?.('PO Number and at least one line item are required.', 'error');
      return { ok: false, message: 'Missing PO Number or items.' };
    }

    const updatedItems = orderPayload.items.map(it => {
      const cleanPn = normalizePartNumber(it.part_number);
      const catMatch = unifiedCatalog.find(c => normalizePartNumber(c.part_number) === cleanPn);
      const prevLine = (existing.items || []).find(
        p => (it.id && p.id === it.id) || normalizePartNumber(p.part_number) === cleanPn
      );
      return {
        id: it.id || prevLine?.id || generateCtId('ct-oi'),
        order_id: existing.id,
        catalog_id: it.catalog_id || prevLine?.catalog_id || catMatch?.id || null,
        part_number: cleanPn,
        description: it.description || prevLine?.description || catMatch?.description || cleanPn,
        item_kind: it.item_kind || prevLine?.item_kind || catMatch?.item_kind || 'consumable',
        quantity_ordered: Math.max(1, parseInt(it.quantity_ordered, 10) || 1),
        quantity_received: parseInt(it.quantity_received ?? prevLine?.quantity_received ?? 0, 10) || 0,
        unit_cost: Number(it.unit_cost ?? prevLine?.unit_cost ?? catMatch?.unit_cost ?? 0),
        needs_review: Boolean(it.needs_review ?? prevLine?.needs_review),
        review_reason: it.review_reason ?? prevLine?.review_reason ?? null
      };
    });

    const allCompleted = updatedItems.every(
      it => (Number(it.quantity_received) || 0) >= (Number(it.quantity_ordered) || 0)
    );
    const anyReceived = updatedItems.some(it => (Number(it.quantity_received) || 0) > 0);
    const nextStatus = allCompleted ? 'received' : anyReceived ? 'partially_received' : 'ordered';

    const updatedOrder = {
      ...existing,
      po_number: poNumber,
      site_code: orderPayload.site_code || existing.site_code || 'DC-MDC',
      ship_to_location: orderPayload.site_code || existing.ship_to_location || 'DC-MDC',
      supplier: orderPayload.supplier || existing.supplier || 'Apple South Asia Pte Ltd',
      order_date: orderPayload.order_date || existing.order_date || now.slice(0, 10),
      remarks: orderPayload.remarks ?? existing.remarks ?? '',
      status: nextStatus,
      total_amount: updatedItems.reduce((s, it) => s + it.quantity_ordered * it.unit_cost, 0),
      items: updatedItems,
      updated_at: now
    };

    const nextOrders = latestStateRef.current.orders.map(o => (o.id === existing.id ? updatedOrder : o));
    setCtOrders(nextOrders);
    persistDual(LS_KEYS.orders, nextOrders);
    commitAndSyncState({ orders: nextOrders }, { reason: 'po_updated', actorName: actor.name });

    recordAudit('CT_PO_UPDATED', poNumber, { lineCount: updatedItems.length, performed_by: actor.name });
    showToast?.(`Updated PO ${poNumber} (${updatedItems.length} item lines)`, 'success');
    return { ok: true, order: updatedOrder };
  }, [resolveActor, ctOrders, unifiedCatalog, commitAndSyncState, recordAudit, showToast]);

  const deleteCtOrder = useCallback((orderId) => {
    const actor = resolveActor();
    const existing = ctOrders.find(o => o.id === orderId);
    if (!existing) {
      showToast?.('Purchase Order not found.', 'error');
      return { ok: false, message: 'Purchase Order not found.' };
    }

    const nextOrders = latestStateRef.current.orders.filter(o => o.id !== orderId);
    setCtOrders(nextOrders);
    persistDual(LS_KEYS.orders, nextOrders);
    commitAndSyncState({ orders: nextOrders }, { reason: 'po_deleted', actorName: actor.name });

    recordAudit('CT_PO_DELETED', existing.po_number, {
      site_code: existing.site_code,
      lineCount: existing.items?.length || 0,
      performed_by: actor.name
    });
    showToast?.(`Deleted PO ${existing.po_number}`, 'info');
    return { ok: true, deletedOrder: existing };
  }, [resolveActor, ctOrders, commitAndSyncState, recordAudit, showToast]);

  const receiveCtOrderLine = useCallback(({
    orderId = null,
    poNumber = null,
    itemId = null,
    partNumber,
    deliveredQty,
    scannedSerials = [],
    expectedQty = null,
    siteCode = null,
    allowOverDelivery = true,
    allowAdHoc = false,
    notes = ''
  }) => {
    const actor = resolveActor();
    const order = ctOrders.find(
      o => (orderId && o.id === orderId) || (poNumber && o.po_number.toUpperCase() === String(poNumber).toUpperCase())
    ) || null;

    const result = validateAndReceiveOrderLine({
      order,
      itemId,
      partNumber,
      deliveredQty,
      scannedSerials,
      expectedQty,
      siteCode: siteCode || order?.site_code || 'DC-MDC',
      catalogItems: unifiedCatalog,
      stockRows: ctStock,
      toolAssets: ctToolAssets,
      actorName: actor.name,
      actorId: actor.id,
      allowOverDelivery,
      allowAdHoc,
      notes
    });

    if (!result.ok) {
      showToast?.(result.message, 'error');
      return result;
    }

    let nextOrders = latestStateRef.current.orders;
    if (result.updatedOrder) {
      nextOrders = nextOrders.map(o => (o.id === result.updatedOrder.id ? result.updatedOrder : o));
      setCtOrders(nextOrders);
      persistDual(LS_KEYS.orders, nextOrders);
    }

    setCtStock(result.nextStockRows);
    persistDual(LS_KEYS.stock, result.nextStockRows);

    const nextToolAssets = result.newToolAssets.length > 0 ? result.nextToolAssets : latestStateRef.current.toolAssets;
    if (result.newToolAssets.length > 0) {
      setCtToolAssets(nextToolAssets);
      persistDual(LS_KEYS.toolAssets, nextToolAssets);
    }

    const nextMovements = appendMovements(result.movements);
    commitAndSyncState(
      {
        orders: nextOrders,
        stock: result.nextStockRows,
        toolAssets: nextToolAssets,
        movements: nextMovements
      },
      { reason: 'ct_received', actorName: actor.name }
    );
    recordAudit('CT_RECEIVED', `${result.catalogItem.part_number} (x${deliveredQty})`, {
      deliveryStatus: result.deliveryStatus,
      po_number: order?.po_number || 'DIRECT',
      performed_by: actor.name
    });

    if (result.deliveryStatus === 'over_delivery') {
      showToast?.(`Over-delivery recorded for ${result.catalogItem.part_number} (+${result.varianceQty} above PO qty)`, 'warning');
    } else if (result.deliveryStatus === 'partial') {
      showToast?.(`Partial delivery recorded for ${result.catalogItem.part_number} (${result.remainingAfter} still open)`, 'info');
    } else {
      showToast?.(`Received ${deliveredQty}x ${result.catalogItem.part_number} into stock`, 'success');
    }

    return result;
  }, [resolveActor, ctOrders, unifiedCatalog, ctStock, ctToolAssets, appendMovements, commitAndSyncState, recordAudit, showToast]);

  const bulkReceiveCtCsv = useCallback((csvText, defaultSiteCode = null) => {
    const actor = resolveActor();
    const { validRows, errorRows } = parseConsumablesReceivingCsv(csvText, unifiedCatalog);
    let workingOrders = [...ctOrders];
    let workingStock = [...ctStock];
    let workingAssets = [...ctToolAssets];
    const allMovements = [];
    const processed = [];
    const runtimeErrors = [...errorRows];

    for (const row of validRows) {
      const order = row.poNumber
        ? workingOrders.find(o => o.po_number.toUpperCase() === row.poNumber.toUpperCase())
        : null;

      const res = validateAndReceiveOrderLine({
        order,
        partNumber: row.partNumber,
        deliveredQty: row.quantity,
        scannedSerials: row.serials,
        siteCode: row.siteCode || defaultSiteCode || order?.site_code || 'DC-MDC',
        catalogItems: unifiedCatalog,
        stockRows: workingStock,
        toolAssets: workingAssets,
        actorName: actor.name,
        actorId: actor.id,
        allowOverDelivery: true,
        allowAdHoc: !order,
        notes: row.notes || 'Bulk CSV Receiving'
      });

      if (!res.ok) {
        runtimeErrors.push({
          rowNumber: row.rowNumber,
          poNumber: row.poNumber,
          partNumber: row.partNumber,
          errorCode: res.errorCode,
          message: res.message
        });
        continue;
      }

      if (res.updatedOrder) {
        workingOrders = workingOrders.map(o => (o.id === res.updatedOrder.id ? res.updatedOrder : o));
      }
      workingStock = res.nextStockRows;
      workingAssets = res.nextToolAssets;
      allMovements.push(...res.movements);
      processed.push(res);
    }

    if (processed.length > 0) {
      setCtOrders(workingOrders);
      persistDual(LS_KEYS.orders, workingOrders);
      setCtStock(workingStock);
      persistDual(LS_KEYS.stock, workingStock);
      setCtToolAssets(workingAssets);
      persistDual(LS_KEYS.toolAssets, workingAssets);
      const nextMovements = appendMovements(allMovements);
      commitAndSyncState(
        {
          orders: workingOrders,
          stock: workingStock,
          toolAssets: workingAssets,
          movements: nextMovements
        },
        { reason: 'ct_bulk_received', actorName: actor.name }
      );
      recordAudit('CT_BULK_RECEIVING', `${processed.length} row(s) received`, {
        errorCount: runtimeErrors.length,
        performed_by: actor.name
      });
    }

    return {
      processedCount: processed.length,
      errorCount: runtimeErrors.length,
      processed,
      errors: runtimeErrors
    };
  }, [resolveActor, unifiedCatalog, ctOrders, ctStock, ctToolAssets, appendMovements, commitAndSyncState, recordAudit]);

  const checkoutTool = useCallback(({ assetId, assignedTo, siteCode = null, notes = '' }) => {
    const actor = resolveActor();
    const res = transitionToolAsset({
      toolAssets: ctToolAssets,
      assetId,
      action: 'checked_out',
      newStatus: 'in_use',
      assignedTo,
      siteCode,
      actorName: actor.name,
      actorId: actor.id,
      notes
    });
    if (!res.ok) {
      showToast?.(res.message, 'error');
      return res;
    }
    setCtToolAssets(res.nextToolAssets);
    persistDual(LS_KEYS.toolAssets, res.nextToolAssets);
    const nextMovements = appendMovements([res.movement]);
    commitAndSyncState(
      { toolAssets: res.nextToolAssets, movements: nextMovements },
      { reason: 'tool_checked_out', actorName: actor.name }
    );
    showToast?.(`Checked out ${res.updatedAsset.asset_tag} to ${res.updatedAsset.assigned_to}`, 'success');
    return res;
  }, [resolveActor, ctToolAssets, appendMovements, commitAndSyncState, showToast]);

  const checkinTool = useCallback(({ assetId, siteCode = null, notes = '' }) => {
    const actor = resolveActor();
    const res = transitionToolAsset({
      toolAssets: ctToolAssets,
      assetId,
      action: 'checked_in',
      newStatus: 'available',
      siteCode,
      actorName: actor.name,
      actorId: actor.id,
      notes
    });
    if (!res.ok) {
      showToast?.(res.message, 'error');
      return res;
    }
    setCtToolAssets(res.nextToolAssets);
    persistDual(LS_KEYS.toolAssets, res.nextToolAssets);
    const nextMovements = appendMovements([res.movement]);
    commitAndSyncState(
      { toolAssets: res.nextToolAssets, movements: nextMovements },
      { reason: 'tool_checked_in', actorName: actor.name }
    );
    showToast?.(`Checked in ${res.updatedAsset.asset_tag} (now Available)`, 'success');
    return res;
  }, [resolveActor, ctToolAssets, appendMovements, commitAndSyncState, showToast]);

  const updateToolStatus = useCallback(({ assetId, newStatus, notes = '' }) => {
    const actor = resolveActor();
    const res = transitionToolAsset({
      toolAssets: ctToolAssets,
      assetId,
      action: 'status_change',
      newStatus,
      actorName: actor.name,
      actorId: actor.id,
      notes
    });
    if (!res.ok) {
      showToast?.(res.message, 'error');
      return res;
    }
    setCtToolAssets(res.nextToolAssets);
    persistDual(LS_KEYS.toolAssets, res.nextToolAssets);
    const nextMovements = appendMovements([res.movement]);
    commitAndSyncState(
      { toolAssets: res.nextToolAssets, movements: nextMovements },
      { reason: 'tool_status_updated', actorName: actor.name }
    );
    showToast?.(`Updated ${res.updatedAsset.asset_tag} status -> ${newStatus}`, 'info');
    return res;
  }, [resolveActor, ctToolAssets, appendMovements, commitAndSyncState, showToast]);

  const consumeCtStock = useCallback(({ partNumber, siteCode = 'DC-MDC', quantity, notes = '' }) => {
    const actor = resolveActor();
    const res = consumeConsumableStock({
      catalogItems: unifiedCatalog,
      stockRows: ctStock,
      partNumber,
      siteCode,
      quantity,
      actorName: actor.name,
      actorId: actor.id,
      notes
    });
    if (!res.ok) {
      showToast?.(res.message, 'error');
      return res;
    }
    setCtStock(res.nextStockRows);
    persistDual(LS_KEYS.stock, res.nextStockRows);
    const nextMovements = appendMovements([res.movement]);
    commitAndSyncState(
      { stock: res.nextStockRows, movements: nextMovements },
      { reason: 'ct_consumed', actorName: actor.name }
    );
    recordAudit('CT_CONSUMED', `${partNumber} (x${quantity}) at ${siteCode}`, { performed_by: actor.name });
    showToast?.(`Recorded consumption of ${quantity}x ${partNumber} at ${siteCode}`, 'success');
    return res;
  }, [resolveActor, unifiedCatalog, ctStock, appendMovements, commitAndSyncState, recordAudit, showToast]);

  const createCtShipment = useCallback((params) => {
    const actor = resolveActor();
    const res = createConsumablesToolsShipment({
      catalogItems: unifiedCatalog,
      stockRows: ctStock,
      toolAssets: ctToolAssets,
      existingShipments: ctShipments,
      ...params,
      actorName: actor.name,
      actorId: actor.id
    });
    if (!res.ok) {
      showToast?.(res.message, 'error');
      return res;
    }
    setCtStock(res.nextStockRows);
    persistDual(LS_KEYS.stock, res.nextStockRows);
    setCtToolAssets(res.nextToolAssets);
    persistDual(LS_KEYS.toolAssets, res.nextToolAssets);
    const nextShipments = [res.shipment, ...latestStateRef.current.shipments];
    setCtShipments(nextShipments);
    persistDual(LS_KEYS.shipments, nextShipments);
    const nextMovements = appendMovements(res.movements);
    commitAndSyncState(
      {
        stock: res.nextStockRows,
        toolAssets: res.nextToolAssets,
        shipments: nextShipments,
        movements: nextMovements
      },
      { reason: 'ct_shipment_created', actorName: actor.name }
    );
    recordAudit('CT_SHIPMENT_CREATED', res.shipment.packing_list_number, {
      to_site: res.shipment.to_site_code,
      items: res.shipment.items.length,
      performed_by: actor.name
    });
    showToast?.(`Created Consumables/Tools Packing List ${res.shipment.packing_list_number}`, 'success');
    return res;
  }, [resolveActor, unifiedCatalog, ctStock, ctToolAssets, ctShipments, appendMovements, commitAndSyncState, recordAudit, showToast]);

  const confirmCtDelivery = useCallback(({ shipmentId, receivedByName, signatureName = '', notes = '' }) => {
    const actor = resolveActor();
    const target = ctShipments.find(s => s.id === shipmentId);
    const res = confirmConsumablesToolsDelivery({
      shipment: target,
      stockRows: ctStock,
      toolAssets: ctToolAssets,
      receivedByName: receivedByName || actor.name,
      signatureName,
      notes,
      actorName: actor.name,
      actorId: actor.id
    });
    if (!res.ok) {
      showToast?.(res.message, 'error');
      return res;
    }
    setCtStock(res.nextStockRows);
    persistDual(LS_KEYS.stock, res.nextStockRows);
    setCtToolAssets(res.nextToolAssets);
    persistDual(LS_KEYS.toolAssets, res.nextToolAssets);
    const nextShipments = latestStateRef.current.shipments.map(s =>
      s.id === res.updatedShipment.id ? res.updatedShipment : s
    );
    setCtShipments(nextShipments);
    persistDual(LS_KEYS.shipments, nextShipments);
    const nextMovements = appendMovements(res.movements);
    commitAndSyncState(
      {
        stock: res.nextStockRows,
        toolAssets: res.nextToolAssets,
        shipments: nextShipments,
        movements: nextMovements
      },
      { reason: 'ct_shipment_delivered', actorName: actor.name }
    );
    recordAudit('CT_SHIPMENT_DELIVERED', res.updatedShipment.packing_list_number, {
      received_by: res.updatedShipment.received_by_name,
      to_site: res.updatedShipment.to_site_code
    });
    showToast?.(`Delivery confirmed for ${res.updatedShipment.packing_list_number}`, 'success');
    return res;
  }, [resolveActor, ctShipments, ctStock, ctToolAssets, appendMovements, commitAndSyncState, recordAudit, showToast]);

  const importPriorityCsvText = useCallback((csvText) => {
    const actor = resolveActor();
    const imported = importPriorityPartsFromCsv(csvText);
    const merged = mergePriorityCatalogAndOrders(ctCatalog, ctOrders, imported);
    const nextCatalog = merged.catalog || [];
    setCtCatalog(nextCatalog);
    persistDual(LS_KEYS.catalog, nextCatalog);
    setCtOrders(merged.orders);
    persistDual(LS_KEYS.orders, merged.orders);
    commitAndSyncState(
      { catalog: nextCatalog, orders: merged.orders },
      { reason: 'ct_priority_csv_imported', actorName: actor.name }
    );
    showToast?.(
      `Imported Priority CSV: ${nextCatalog.length} catalog items, ${merged.orders.length} orders`,
      'success'
    );
    return { ...imported, catalog: nextCatalog, catalogItems: nextCatalog, orders: merged.orders };
  }, [resolveActor, ctCatalog, ctOrders, commitAndSyncState, showToast]);

  return {
    ctCatalog: unifiedCatalog,
    ctOrders,
    ctStock,
    ctToolAssets,
    ctMovements,
    ctShipments,
    ctSyncStatus,
    syncCtFromCloud,
    saveCtCatalogItem,
    addCtOrder,
    updateCtOrder,
    deleteCtOrder,
    receiveCtOrderLine,
    bulkReceiveCtCsv,
    checkoutTool,
    checkinTool,
    updateToolStatus,
    consumeCtStock,
    createCtShipment,
    confirmCtDelivery,
    importPriorityCsvText
  };
}
