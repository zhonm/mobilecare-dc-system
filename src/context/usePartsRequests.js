import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { barcodeAudio } from '../utils/barcodeAudio';
import { isUUID, resolveSite, isDcSite, saveInventoryToLocalStorage, readInventoryFromLocalStorage } from '../utils/appContextHelpers';
import { defaultPartsCatalog } from '../data/defaultCatalog.js';
import { getCategoryForPart } from '../utils/categoryFilter';
import { resolveCanonicalIPhoneModel } from '../utils/partResolver.js';
import { queuedSavedRecordsUpsert } from '../utils/savedRecordsQueue';

const toValidUUID = (str) => (isUUID(str) ? str : null);

const FULFILLMENT_ROLES = ['superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff'];

export function usePartsRequests({
  currentUser,
  parts = [],
  categories = [],
  sites = [],
  inventoryUnits = [],
  setInventoryUnits,
  repairUsageRecords = [],
  setRepairUsageRecords,
  showToast,
  broadcastCloudEvent,
  enqueueOfflineAction,
  setCloudSyncStatus
}) {
  const [partsRequests, setPartsRequests] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_parts_requests');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Error reading mdc_parts_requests from localStorage:', e);
    }
    return [];
  });

  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  // Helper to check if current user has fulfillment authority
  const isFulfillmentUser = useMemo(() => {
    if (!currentUser) return false;
    return FULFILLMENT_ROLES.includes(currentUser.role);
  }, [currentUser]);

  // Sync partsRequests to localStorage & IndexedDB
  const persistPartsRequests = useCallback((requests) => {
    try {
      localStorage.setItem('mdc_parts_requests', JSON.stringify(requests));
      dbStorage.setItem('mdc_parts_requests', requests);
    } catch (e) {
      console.warn('Error saving mdc_parts_requests:', e);
    }
  }, []);

  const lastFetchRef = useRef(0);
  const partsRef = useRef(parts);
  const sitesRef = useRef(sites);
  useEffect(() => { partsRef.current = parts; }, [parts]);
  useEffect(() => { sitesRef.current = sites; }, [sites]);

  // 1. Fetch & Hydrate Parts Requests from Supabase (with safe cooldown & deduping)
  const fetchPartsRequests = useCallback(async ({ force = false } = {}) => {
    if (!supabase) return;
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 20000) {
      return;
    }
    lastFetchRef.current = now;
    setIsLoadingRequests(true);
    try {
      let query = supabase
        .from('parts_requests')
        .select('*, parts:part_id(*), sites:site_id(*)')
        .order('created_at', { ascending: false })
        .limit(300);

      // If user is site-restricted PMG staff and has siteId, filter to their site
      if (!isFulfillmentUser && currentUser?.siteId) {
        if (isUUID(currentUser.siteId)) {
          query = query.eq('site_id', currentUser.siteId);
        }
      }

      const { data, error } = await query;
      if (error) {
        console.warn('Supabase fetchPartsRequests notice:', error.message);
        return;
      }

      if (Array.isArray(data)) {
        setPartsRequests(prev => {
          const map = new Map((prev || []).map(r => [r.id, r]));
          const currentParts = partsRef.current || [];
          const currentSites = sitesRef.current || [];
          data.forEach(dbRow => {
            const partObj = dbRow.parts || currentParts.find(p => p.id === dbRow.part_id) || {};
            const siteObj = dbRow.sites || currentSites.find(s => s.id === dbRow.site_id) || {};
            map.set(dbRow.id, {
              ...dbRow,
              part_number: partObj.part_number || dbRow.part_number,
              part_description: partObj.description || dbRow.part_description,
              site_code: siteObj.code || dbRow.site_code,
              site_name: siteObj.name || dbRow.site_name
            });
          });
          const merged = Array.from(map.values()).sort(
            (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
          );
          persistPartsRequests(merged);
          return merged;
        });
      }
    } catch (err) {
      console.warn('fetchPartsRequests error:', err.message);
    } finally {
      setIsLoadingRequests(false);
    }
  }, [currentUser, isFulfillmentUser, persistPartsRequests]);

  // Initial fetch on mount or user change only (isolated from parts/sites mutations)
  useEffect(() => {
    if (currentUser?.id) {
      fetchPartsRequests();
    }
  }, [currentUser?.id, currentUser?.siteId, fetchPartsRequests]);

  // 2. Submit New Parts Request (Atomic SECURITY DEFINER RPC with offline fallback)
  const submitPartsRequest = async ({
    siteId,
    partId,
    quantity,
    priority = 'normal',
    reason = 'Site replenishment request',
    notes = ''
  }) => {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      barcodeAudio.playError();
      showToast?.('Request quantity must be at least 1 unit.', 'error');
      return { success: false, error: 'Quantity must be greater than zero' };
    }

    if (!partId) {
      barcodeAudio.playError();
      showToast?.('Please select a part to request.', 'error');
      return { success: false, error: 'Missing partId' };
    }

    // Resolve target site (defaults to user's assigned site if not fulfillment role)
    const effectiveSiteId = (!isFulfillmentUser || !siteId) ? (currentUser?.siteId || siteId) : siteId;
    if (!effectiveSiteId) {
      barcodeAudio.playError();
      showToast?.('Please specify the destination site for this request.', 'error');
      return { success: false, error: 'Missing siteId' };
    }

    const targetPart = parts.find(p => p.id === partId || p.part_number === partId)
      || defaultPartsCatalog.find(p => p.id === partId || p.part_number === partId);
    const targetSite = sites.find(s => s.id === effectiveSiteId || s.code === effectiveSiteId);

    const resolvedPartId = targetPart?.id || partId;
    const resolvedSiteId = targetSite?.id || effectiveSiteId;

    const cleanReason = String(reason || 'Site replenishment request').trim();
    const cleanNotes = notes ? String(notes).trim() : null;
    const cleanPriority = ['normal', 'urgent', 'critical'].includes(priority) ? priority : 'normal';

    const nowIso = new Date().toISOString();
    const tempYearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
    const tempReqNum = `PR-${tempYearMonth}-${Math.floor(10000 + Math.random() * 90000)}`;

    const optimisticRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      request_number: tempReqNum,
      site_id: resolvedSiteId,
      site_code: targetSite?.code || 'SITE',
      site_name: targetSite?.name || 'Branch Site',
      part_id: resolvedPartId,
      part_number: targetPart?.part_number || '',
      part_description: targetPart?.description || '',
      quantity_requested: qty,
      quantity_fulfilled: 0,
      status: 'pending',
      priority: cleanPriority,
      requested_by: currentUser?.id || 'usr-anon',
      requested_by_name: currentUser?.fullName || 'MobileCare Staff',
      reason: cleanReason,
      notes: cleanNotes,
      created_at: nowIso,
      updated_at: nowIso
    };

    // Update local state immediately (Optimistic UI)
    setPartsRequests(prev => {
      const next = [optimisticRequest, ...(prev || [])];
      persistPartsRequests(next);
      return next;
    });

    if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));

    // Execute atomic creation in Supabase
    if (supabase) {
      try {
        let validSiteId = isUUID(resolvedSiteId) ? resolvedSiteId : null;
        let validPartId = isUUID(resolvedPartId) ? resolvedPartId : null;

        // 1. Resolve site UUID if not already a UUID
        if (!validSiteId) {
          const siteCodeToMatch = (targetSite?.code || effectiveSiteId).toUpperCase();
          const { data: dbSite } = await supabase.from('sites').select('id').eq('code', siteCodeToMatch).maybeSingle();
          if (dbSite?.id) {
            validSiteId = dbSite.id;
          } else {
            const { data: anyDbSite } = await supabase.from('sites').select('id').limit(1).maybeSingle();
            validSiteId = anyDbSite?.id || toValidUUID(effectiveSiteId);
          }
        }

        // 2. Resolve part UUID if not already a UUID
        if (!validPartId) {
          const pnToMatch = (targetPart?.part_number || partId).toUpperCase();
          const { data: dbPart } = await supabase.from('parts').select('id').eq('part_number', pnToMatch).maybeSingle();
          if (dbPart?.id) {
            validPartId = dbPart.id;
          } else {
            // Upsert part if missing
            const { data: newPart } = await supabase.from('parts').upsert({
              part_number: pnToMatch,
              description: targetPart?.description || `Part ${pnToMatch}`
            }, { onConflict: 'part_number' }).select('id').maybeSingle();
            validPartId = newPart?.id || toValidUUID(partId);
          }
        }

        // 3. Insert into public.parts_requests table in Supabase
        const insertPayload = {
          request_number: tempReqNum,
          site_id: validSiteId,
          part_id: validPartId,
          quantity_requested: qty,
          quantity_fulfilled: 0,
          status: 'pending',
          priority: cleanPriority,
          requested_by: isUUID(currentUser?.id) ? currentUser?.id : null,
          requested_by_name: currentUser?.fullName || 'MobileCare Staff',
          reason: cleanReason,
          notes: cleanNotes,
          created_at: nowIso,
          updated_at: nowIso
        };

        const { data: directInsert, error: directErr } = await supabase
          .from('parts_requests')
          .insert(insertPayload)
          .select('*, parts:part_id(*), sites:site_id(*)')
          .maybeSingle();

        if (directErr) {
          console.warn('parts_requests direct insert warning:', directErr.message);
        }

        const finalReq = directInsert ? {
          ...optimisticRequest,
          id: directInsert.id,
          request_number: directInsert.request_number || optimisticRequest.request_number,
          created_at: directInsert.created_at || optimisticRequest.created_at
        } : optimisticRequest;

        setPartsRequests(prev => {
          const updated = (prev || []).map(r => r.id === optimisticRequest.id ? finalReq : r);
          persistPartsRequests(updated);
          return updated;
        });

        // 4. Update master_parts_requests_registry in saved_records for instant cross-tier synchronization
        try {
          const currentRequests = JSON.parse(localStorage.getItem('mdc_parts_requests') || '[]');
          const mergedReg = [finalReq, ...currentRequests.filter(r => r.id !== finalReq.id && r.id !== optimisticRequest.id)];
          await supabase.from('saved_records').upsert({
            id: 'master_parts_requests_registry',
            record_type: 'parts_requests_registry',
            period_label: 'Master Parts Requests Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Live Parts Requests registry across all branches',
            saved_by_name: currentUser?.fullName || 'MobileCare Staff',
            snapshot_data: {
              requests: mergedReg.slice(0, 300)
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (regErr) {
          console.warn('master_parts_requests_registry sync note:', regErr.message);
        }

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      } catch (err) {
        console.warn('Parts request cloud sync notice:', err.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        if (enqueueOfflineAction) {
          enqueueOfflineAction('PARTS_REQUEST_CREATE', optimisticRequest);
        }
      }
    }

    barcodeAudio.playSuccess();
    showToast?.(`Parts request ${optimisticRequest.request_number} submitted (${targetPart?.part_number || 'Part'} x${qty}).`, 'success');
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PARTS_REQUEST_CREATED', { request: optimisticRequest, table: 'parts_requests' });
    }

    return { success: true, request: optimisticRequest };
  };

  // 2b. Submit Multi-Item Batch Parts Request (Single form submission with multiple parts)
  const submitBatchPartsRequests = async ({
    siteId,
    items = [],
    priority = 'normal',
    reason = 'Site replenishment request',
    notes = ''
  }) => {
    if (!Array.isArray(items) || items.length === 0) {
      barcodeAudio.playError();
      showToast?.('Please add at least one part to your request.', 'error');
      return { success: false, error: 'No items provided' };
    }

    const validItems = items.filter(it => it && (it.partId || it.partNumber) && (parseInt(it.quantity, 10) > 0));
    if (validItems.length === 0) {
      barcodeAudio.playError();
      showToast?.('Please ensure all requested parts have a valid part number and quantity >= 1.', 'error');
      return { success: false, error: 'No valid items' };
    }

    const effectiveSiteId = (!isFulfillmentUser || !siteId) ? (currentUser?.siteId || siteId) : siteId;
    if (!effectiveSiteId) {
      barcodeAudio.playError();
      showToast?.('Please specify the destination site for this request.', 'error');
      return { success: false, error: 'Missing siteId' };
    }

    const targetSite = sites.find(s => s.id === effectiveSiteId || s.code === effectiveSiteId);
    const resolvedSiteId = targetSite?.id || effectiveSiteId;

    const cleanReason = String(reason || 'Site replenishment request').trim();
    const cleanPriority = ['normal', 'urgent', 'critical'].includes(priority) ? priority : 'normal';
    const nowIso = new Date().toISOString();
    const tempYearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
    const batchSeed = Math.floor(10000 + Math.random() * 90000);

    const optimisticRequests = validItems.map((item, index) => {
      const qty = parseInt(item.quantity, 10) || 1;
      const partKey = item.partId || item.partNumber;
      const targetPart = parts.find(p => p.id === partKey || p.part_number === partKey)
        || defaultPartsCatalog.find(p => p.id === partKey || p.part_number === partKey);
      const resolvedPartId = targetPart?.id || item.partId || partKey;
      const partNumber = targetPart?.part_number || item.partNumber || '';
      const partDesc = targetPart?.description || item.description || 'Apple Genuine Service Part';

      const itemSuffix = validItems.length > 1 ? `-${String(index + 1).padStart(2, '0')}` : '';
      const reqNum = `PR-${tempYearMonth}-${batchSeed}${itemSuffix}`;
      const itemNotes = [item.notes, notes].filter(Boolean).join(' | ') || null;

      return {
        id: `req-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
        request_number: reqNum,
        site_id: resolvedSiteId,
        site_code: targetSite?.code || 'SITE',
        site_name: targetSite?.name || 'Branch Site',
        part_id: resolvedPartId,
        part_number: partNumber,
        part_description: partDesc,
        quantity_requested: qty,
        quantity_fulfilled: 0,
        status: 'pending',
        priority: cleanPriority,
        requested_by: currentUser?.id || 'usr-anon',
        requested_by_name: currentUser?.fullName || 'MobileCare Staff',
        reason: cleanReason,
        notes: itemNotes,
        created_at: nowIso,
        updated_at: nowIso
      };
    });

    // Update local state immediately (Optimistic UI)
    setPartsRequests(prev => {
      const next = [...optimisticRequests, ...(prev || [])];
      persistPartsRequests(next);
      return next;
    });

    if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));

    // Supabase persistence
    if (supabase) {
      try {
        let validSiteId = isUUID(resolvedSiteId) ? resolvedSiteId : null;
        if (!validSiteId) {
          const siteCodeToMatch = (targetSite?.code || effectiveSiteId).toUpperCase();
          const { data: dbSite } = await supabase.from('sites').select('id').eq('code', siteCodeToMatch).maybeSingle();
          if (dbSite?.id) {
            validSiteId = dbSite.id;
          } else {
            const { data: anyDbSite } = await supabase.from('sites').select('id').limit(1).maybeSingle();
            validSiteId = anyDbSite?.id || toValidUUID(effectiveSiteId);
          }
        }

        const insertedRecords = [];
        for (const req of optimisticRequests) {
          let validPartId = isUUID(req.part_id) ? req.part_id : null;
          if (!validPartId) {
            const pnToMatch = (req.part_number || '').toUpperCase();
            if (pnToMatch) {
              const { data: dbPart } = await supabase.from('parts').select('id').eq('part_number', pnToMatch).maybeSingle();
              if (dbPart?.id) {
                validPartId = dbPart.id;
              } else {
                const { data: newPart } = await supabase.from('parts').upsert({
                  part_number: pnToMatch,
                  description: req.part_description || `Part ${pnToMatch}`
                }, { onConflict: 'part_number' }).select('id').maybeSingle();
                validPartId = newPart?.id || toValidUUID(req.part_id);
              }
            }
          }

          const insertPayload = {
            request_number: req.request_number,
            site_id: validSiteId,
            part_id: validPartId,
            quantity_requested: req.quantity_requested,
            quantity_fulfilled: 0,
            status: 'pending',
            priority: cleanPriority,
            requested_by: isUUID(currentUser?.id) ? currentUser?.id : null,
            requested_by_name: currentUser?.fullName || 'MobileCare Staff',
            reason: cleanReason,
            notes: req.notes,
            created_at: nowIso,
            updated_at: nowIso
          };

          const { data: directInsert, error: directErr } = await supabase
            .from('parts_requests')
            .insert(insertPayload)
            .select('*, parts:part_id(*), sites:site_id(*)')
            .maybeSingle();

          if (directErr) {
            console.warn('parts_requests batch insert item warning:', directErr.message);
          }

          if (directInsert) {
            insertedRecords.push({
              ...req,
              id: directInsert.id,
              request_number: directInsert.request_number || req.request_number,
              created_at: directInsert.created_at || req.created_at
            });
          } else {
            insertedRecords.push(req);
          }
        }

        // Reconcile optimistic requests with confirmed IDs
        setPartsRequests(prev => {
          const optimisticIds = new Set(optimisticRequests.map(o => o.id));
          const updated = (prev || []).map(r => {
            if (optimisticIds.has(r.id)) {
              const idx = optimisticRequests.findIndex(o => o.id === r.id);
              return insertedRecords[idx] || r;
            }
            return r;
          });
          persistPartsRequests(updated);
          return updated;
        });

        // Update master_parts_requests_registry
        try {
          const currentRequests = JSON.parse(localStorage.getItem('mdc_parts_requests') || '[]');
          const optIds = new Set(optimisticRequests.map(o => o.id));
          const mergedReg = [
            ...insertedRecords,
            ...currentRequests.filter(r => !optIds.has(r.id) && !insertedRecords.some(i => i.id === r.id))
          ];
          await supabase.from('saved_records').upsert({
            id: 'master_parts_requests_registry',
            record_type: 'parts_requests_registry',
            period_label: 'Master Parts Requests Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Live Parts Requests registry across all branches',
            saved_by_name: currentUser?.fullName || 'MobileCare Staff',
            snapshot_data: {
              requests: mergedReg.slice(0, 300)
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (regErr) {
          console.warn('master_parts_requests_registry batch sync note:', regErr.message);
        }

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      } catch (err) {
        console.warn('Batch parts request cloud sync notice:', err.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        if (enqueueOfflineAction) {
          optimisticRequests.forEach(req => {
            enqueueOfflineAction('PARTS_REQUEST_CREATE', req);
          });
        }
      }
    }

    const totalUnits = validItems.reduce((acc, it) => acc + (parseInt(it.quantity, 10) || 1), 0);
    barcodeAudio.playSuccess();
    showToast?.(
      `Parts replenishment request submitted for ${validItems.length} part${validItems.length > 1 ? 's' : ''} (${totalUnits} total unit${totalUnits > 1 ? 's' : ''}).`,
      'success'
    );

    if (broadcastCloudEvent) {
      optimisticRequests.forEach(req => {
        broadcastCloudEvent('PARTS_REQUEST_CREATED', { request: req, table: 'parts_requests' });
      });
    }

    return { success: true, requests: optimisticRequests };
  };

  // 3. Cancel Parts Request (Requesters can cancel own still-pending requests)
  const cancelPartsRequest = async (requestId, cancelReason = 'Cancelled by requester') => {
    const target = partsRequests.find(r => r.id === requestId || r.request_number === requestId);
    if (!target) {
      showToast?.('Parts request not found.', 'error');
      return { success: false, error: 'Request not found' };
    }

    if (target.status !== 'pending') {
      showToast?.(`Cannot cancel request: current status is "${target.status}". Only pending requests can be cancelled.`, 'warning');
      return { success: false, error: 'Only pending requests can be cancelled' };
    }

    const isOwnRequest = target.requested_by === currentUser?.id || target.requested_by_name === currentUser?.fullName;
    if (!isFulfillmentUser && !isOwnRequest) {
      showToast?.('Permission Denied: You can only cancel your own pending parts requests.', 'error');
      return { success: false, error: 'Permission Denied' };
    }

    const nowIso = new Date().toISOString();
    const updatedNotes = target.notes
      ? `${target.notes} | Cancelled: ${cancelReason}`
      : `Cancelled: ${cancelReason}`;

    const nextRequests = partsRequests.map(r => {
      if (r.id === target.id) {
        return {
          ...r,
          status: 'cancelled',
          notes: updatedNotes,
          updated_at: nowIso
        };
      }
      return r;
    });

    setPartsRequests(nextRequests);
    persistPartsRequests(nextRequests);

    if (supabase && isUUID(target.id)) {
      try {
        await supabase
          .from('parts_requests')
          .update({
            status: 'cancelled',
            notes: updatedNotes,
            updated_at: nowIso
          })
          .eq('id', target.id);
      } catch (err) {
        console.warn('cancelPartsRequest cloud sync error:', err.message);
        if (enqueueOfflineAction) {
          enqueueOfflineAction('PARTS_REQUEST_UPDATE', { id: target.id, status: 'cancelled', notes: updatedNotes });
        }
      }
    }

    showToast?.(`Request ${target.request_number} has been cancelled.`, 'info');
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PARTS_REQUEST_CANCELLED', { requestId: target.id, status: 'cancelled', table: 'parts_requests' });
    }

    return { success: true };
  };

  // 4. Update Request Status (Fulfillment role: Approve / Reject / Fulfill)
  const updatePartsRequestStatus = async (requestId, {
    status,
    quantityFulfilled,
    reviewedBy,
    notes,
    fulfilledShipmentId = null
  }) => {
    const isAuthorized = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';
    if (!isAuthorized) {
      showToast?.('Permission Denied: Only the DC Superadmin or Admin has the authority to review parts requests.', 'error');
      return { success: false, error: 'Permission Denied' };
    }

    const validStatuses = ['pending', 'approved', 'rejected', 'partially_fulfilled', 'fulfilled', 'cancelled'];
    if (!validStatuses.includes(status)) {
      showToast?.(`Invalid status "${status}".`, 'error');
      return { success: false, error: 'Invalid status' };
    }

    const target = partsRequests.find(r => r.id === requestId || r.request_number === requestId);
    if (!target) {
      showToast?.('Parts request not found.', 'error');
      return { success: false, error: 'Request not found' };
    }

    const nowIso = new Date().toISOString();
    const effectiveReviewer = reviewedBy || currentUser?.fullName || 'DC Superadmin';
    const effectiveQtyFulfilled = quantityFulfilled !== undefined
      ? parseInt(quantityFulfilled, 10)
      : (status === 'fulfilled' ? target.quantity_requested : target.quantity_fulfilled);

    const updatePayload = {
      status,
      quantity_fulfilled: effectiveQtyFulfilled,
      reviewed_by: isUUID(currentUser?.id) ? currentUser?.id : null,
      reviewed_at: nowIso,
      fulfilled_shipment_id: fulfilledShipmentId || target.fulfilled_shipment_id || null,
      notes: notes !== undefined ? notes : target.notes,
      updated_at: nowIso
    };

    const nextRequests = partsRequests.map(r => {
      if (r.id === target.id) {
        return {
          ...r,
          ...updatePayload,
          reviewed_by_name: effectiveReviewer
        };
      }
      return r;
    });

    setPartsRequests(nextRequests);
    persistPartsRequests(nextRequests);

    if (supabase) {
      try {
        if (isUUID(target.id)) {
          await supabase
            .from('parts_requests')
            .update(updatePayload)
            .eq('id', target.id);
        }

        await supabase.from('saved_records').upsert({
          id: 'master_parts_requests_registry',
          record_type: 'parts_requests_registry',
          period_label: 'Master Parts Requests Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Live Parts Requests registry across all branches',
          saved_by_name: currentUser?.fullName || 'MobileCare Staff',
          snapshot_data: {
            requests: nextRequests.slice(0, 300)
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      } catch (err) {
        console.warn('updatePartsRequestStatus cloud sync error:', err.message);
        if (enqueueOfflineAction) {
          enqueueOfflineAction('PARTS_REQUEST_UPDATE', { id: target.id, ...updatePayload });
        }
      }
    }

    showToast?.(`Request ${target.request_number} updated to "${status.toUpperCase()}".`, 'success');
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PARTS_REQUEST_UPDATED', { requestId: target.id, status, table: 'parts_requests' });
    }

    return { success: true };
  };

  // 5. Stock on Hand Helper (Derives in-stock, allocated, and packed counts for any site from in-memory state)
  const getStockOnHandForSite = useCallback((siteIdOrCode) => {
    if (!siteIdOrCode) return { partsSummary: {}, totalUnits: 0, units: [] };

    const targetSite = resolveSite(siteIdOrCode, sites);
    const siteId = targetSite?.id || siteIdOrCode;
    const siteCode = targetSite?.code || siteIdOrCode;

    // Central DC stock is strictly restricted to Superadmin; other users cannot query DC stock
    const isSuper = currentUser?.role === 'superadmin';
    const isDcTarget = isDcSite(siteId, sites) || isDcSite(siteCode, sites);
    if (!isSuper && isDcTarget) {
      return { siteId, siteCode, partsSummary: {}, totalInStock: 0, totalAllocated: 0, totalPacked: 0, totalUnits: 0, units: [] };
    }

    const targetIdLower = String(siteId).toLowerCase();
    const targetCodeUpper = String(siteCode).toUpperCase();
    const targetNameLower = String(targetSite?.name || '').toLowerCase();

    const targetClean = targetCodeUpper.replace(/^(ASP|APP)\s+/, '');

    let deletedSerialsSet = new Set();
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      if (Array.isArray(localDeleted)) {
        deletedSerialsSet = new Set(localDeleted.map(s => String(s).trim().toUpperCase()));
      }
    } catch (e) {}

    let clearedSitesMap = {};
    try {
      const localCleared = JSON.parse(localStorage.getItem('mdc_cleared_site_timestamps') || '{}');
      if (localCleared && typeof localCleared === 'object') {
        clearedSitesMap = localCleared;
      }
    } catch (e) {}

    const isBranchTarget = !isDcTarget;
    const clearTime = clearedSitesMap['ENTIRE_SYSTEM'] ||
      (isBranchTarget ? clearedSitesMap['ALL_BRANCHES'] : null) ||
      clearedSitesMap[siteId] ||
      clearedSitesMap[siteCode] ||
      clearedSitesMap[targetIdLower] ||
      clearedSitesMap[targetCodeUpper] ||
      null;

    // Filter matching units
    const matchingUnits = (inventoryUnits || []).filter(u => {
      if (!u || u.is_deleted || u.status === 'deleted') return false;

      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s && deletedSerialsSet.has(s)) return false;

      if (clearTime) {
        // Priority: If unit was explicitly updated/created AFTER the clearance time, it is freshly imported or active stock.
        const clearTimeMs = new Date(clearTime).getTime();
        const uUpdatedMs = u.updated_at ? new Date(u.updated_at).getTime() : 0;
        const uReceivedMs = (u.received_at || u.created_at) ? new Date(u.received_at || u.created_at).getTime() : 0;
        const effectiveDateMs = uUpdatedMs || uReceivedMs;
        if (!effectiveDateMs || effectiveDateMs <= clearTimeMs) {
          return false;
        }
      }

      const uSiteId = String(u.current_site_id || u.siteId || u.site_id || '').toLowerCase();
      const uSiteCode = String(u.site_code || u.siteCode || '').toUpperCase();
      const uSiteName = String(u.site_name || u.siteName || '').toLowerCase();
      const uClean = uSiteCode.replace(/^(ASP|APP)\s+/, '');
      return (targetIdLower && uSiteId === targetIdLower) ||
             (targetCodeUpper && uSiteCode === targetCodeUpper) ||
             (targetClean && uClean && targetClean === uClean) ||
             (targetCodeUpper && uSiteId === targetCodeUpper.toLowerCase()) ||
             (targetIdLower && uSiteCode.toLowerCase() === targetIdLower) ||
             (targetNameLower && uSiteName && (uSiteName.includes(targetNameLower) || targetNameLower.includes(uSiteName)));
    });

    const partsSummary = {};
    let totalInStock = 0;
    let totalAllocated = 0;
    let totalPacked = 0;

    matchingUnits.forEach(u => {
      const rawPN = u.part_number || u.partNumber || '';
      const cleanPN = String(rawPN).trim().toUpperCase();
      if (!cleanPN) return;

      if (!partsSummary[cleanPN]) {
        const matchedPart = (parts || []).find(p => p.part_number?.trim().toUpperCase() === cleanPN);
        const catObj = getCategoryForPart(matchedPart || { description: u.description, category_id: u.category_id }, categories);
        const resolvedCategoryName = catObj?.name || (u.category && !isUUID(u.category) ? u.category : 'General');
        const resolvedCategoryId = catObj?.id || matchedPart?.category_id || u.category_id || 'cat-general';
        const resolvedCategoryCode = catObj?.code || 'GENERAL';

        const resolvedModel = resolveCanonicalIPhoneModel(
          matchedPart?.iphone_model || u.iphone_model,
          matchedPart?.description || u.description
        );

        const isCatalogActive = matchedPart ? (matchedPart.is_active !== false && matchedPart.status !== 'inactive') : false;

        partsSummary[cleanPN] = {
          partNumber: cleanPN,
          partId: matchedPart?.id || u.part_id,
          description: matchedPart?.description || u.description || `Part ${cleanPN}`,
          category: resolvedCategoryName,
          category_name: resolvedCategoryName,
          category_id: resolvedCategoryId,
          categoryId: resolvedCategoryId,
          categoryCode: resolvedCategoryCode,
          model: resolvedModel,
          stockingPrice: matchedPart?.stocking_price || u.stocking_price || 0,
          is_active: isCatalogActive,
          inStock: 0,
          allocated: 0,
          packed: 0,
          total: 0
        };
      }

      const status = String(u.status || 'in_stock').toLowerCase();
      if (status === 'in_stock' || status === 'delivered' || status === 'received') {
        partsSummary[cleanPN].inStock += 1;
        totalInStock += 1;
      } else if (status === 'allocated') {
        partsSummary[cleanPN].allocated += 1;
        totalAllocated += 1;
      } else if (status === 'packed' || status === 'shipped' || status === 'in_transit' || status === 'pending_pickup') {
        partsSummary[cleanPN].packed += 1;
        totalPacked += 1;
      }
      partsSummary[cleanPN].total += 1;
    });

    // Load zero-stock 3-day purge tracker
    let zeroStockTracker = {};
    try {
      zeroStockTracker = JSON.parse(localStorage.getItem('mdc_zero_stock_tracker') || '{}');
    } catch (e) {}

    let trackerModified = false;
    const nowMs = Date.now();

    Object.keys(partsSummary).forEach(pn => {
      const item = partsSummary[pn];
      const trackerKey = `${siteId}_${pn}`;

      // In-transit / packed parts or parts with in-stock inventory are actively protected from zero-stock auto-cleaning
      if (item.inStock > 0 || item.packed > 0) {
        item.status = item.inStock > 0 ? 'in_stock' : 'in_transit';
        item.outOfStockDays = 0;
        item.daysUntilPurge = null;
        item.zeroStockSince = null;
        if (zeroStockTracker[trackerKey]) {
          delete zeroStockTracker[trackerKey];
          trackerModified = true;
        }
      } else {
        item.status = 'out_of_stock';
        if (!zeroStockTracker[trackerKey] || !zeroStockTracker[trackerKey].zeroStockSince) {
          zeroStockTracker[trackerKey] = {
            siteId,
            siteCode,
            partNumber: pn,
            zeroStockSince: new Date().toISOString()
          };
          trackerModified = true;
        }

        const zeroSinceMs = new Date(zeroStockTracker[trackerKey].zeroStockSince).getTime();
        const elapsedMs = nowMs - zeroSinceMs;
        const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));

        item.outOfStockDays = elapsedDays;
        item.daysUntilPurge = null;
        item.zeroStockSince = zeroStockTracker[trackerKey].zeroStockSince;

        // Strict Non-Deletion Policy: parts are NEVER deleted from the system under any circumstances.
        // All catalog and inventory records remain 100% intact for consistency and auditability.
      }
    });

    if (trackerModified) {
      try {
        localStorage.setItem('mdc_zero_stock_tracker', JSON.stringify(zeroStockTracker));
      } catch (e) {}
    }

    return {
      siteId,
      siteCode,
      partsSummary,
      totalInStock,
      totalAllocated,
      totalPacked,
      totalUnits: matchingUnits.length,
      units: matchingUnits
    };
  }, [inventoryUnits, parts, sites, categories, currentUser?.role]);

  // 6. Multi-Site Stock Summary with Granular Serial Privacy & Masking
  const getAllSitesStockSummary = useCallback((targetSiteFilter = 'ALL') => {
    const isSuper = currentUser?.role === 'superadmin';
    const userSiteId = currentUser?.siteId;
    const userId = currentUser?.id;

    let siteList = targetSiteFilter === 'ALL'
      ? sites
      : sites.filter(s => s.id === targetSiteFilter || s.code === targetSiteFilter);

    // Central DC stocks are strictly restricted to Superadmin; other users cannot view DC stocks
    if (!isSuper) {
      siteList = siteList.filter(s => !s.is_dc && s.code !== 'DC-MDC' && s.code !== 'DC' && s.id !== 'site-dc');
    }

    const isAvailableStatus = (status) => {
      const normalized = String(status || 'in_stock').toLowerCase();
      return normalized === 'in_stock' || normalized === 'delivered' || normalized === 'received';
    };

    return siteList.map(site => {
      const isOwnSite = !isSuper && Boolean(userSiteId && (site.id === userSiteId || site.code === userSiteId));
      const stock = getStockOnHandForSite(site.id);
      const siteSeenSerials = new Set();
      const uniqueUnits = (stock.units || []).filter(unit => {
        const serial = String(unit.serial_number || unit.serialNumber || '').trim().toUpperCase();
        if (!serial) return true;
        if (siteSeenSerials.has(serial)) return false;
        siteSeenSerials.add(serial);
        return true;
      });

      // Process parts summary with granular privacy
      const processedParts = Object.values(stock.partsSummary || {}).map(partItem => {
        const matchingUnitsForPart = uniqueUnits.filter(u => {
          const rawPN = String(u.part_number || u.partNumber || '').trim().toUpperCase();
          return rawPN === partItem.partNumber;
        });
        const availableUnitsForPart = matchingUnitsForPart.filter(u => isAvailableStatus(u.status));

        // Determine if user can see serialized details
        const serializedUnits = matchingUnitsForPart.map(u => {
          const isAddedBySelf = Boolean(userId && (
            u.added_by_user_id === userId ||
            u.received_by_id === userId ||
            (u.received_by && currentUser?.fullName && u.received_by.toLowerCase() === currentUser.fullName.toLowerCase())
          ));
          // Serial numbers are visible for the user's assigned site, parts added by self, or Superadmin/Admin.
          // Serials for other external sites remain protected.
          const canViewDetails = isSuper || isOwnSite || isAddedBySelf;

          if (canViewDetails) {
            return {
              id: u.id,
              serialNumber: u.serial_number,
              serial_number: u.serial_number,
              part_number: u.part_number,
              description: u.description,
              status: u.status,
              boxNumber: u.box_number || 1,
              box_number: u.box_number || 1,
              receivedAt: u.received_at,
              receivedBy: u.received_by,
              received_by_id: u.received_by_id,
              added_by_user_id: u.added_by_user_id,
              current_site_id: u.current_site_id || site.id,
              site_code: u.site_code || site.code,
              work_order_number: u.work_order_number,
              notes: u.notes,
              isMasked: false
            };
          } else {
            return {
              id: u.id,
              serialNumber: '••••••••••••••••',
              serial_number: '••••••••••••••••',
              part_number: u.part_number,
              description: u.description,
              status: u.status,
              boxNumber: '—',
              box_number: '—',
              receivedAt: null,
              receivedBy: 'Branch Staff',
              received_by_id: null,
              added_by_user_id: null,
              current_site_id: site.id,
              site_code: site.code,
              work_order_number: null,
              notes: null,
              isMasked: true
            };
          }
        });

        const hasUnmaskedAccess = isSuper || isOwnSite || serializedUnits.some(u => !u.isMasked);

        return {
          ...partItem,
          inStock: availableUnitsForPart.length,
          siteId: site.id,
          siteCode: site.code,
          siteName: site.name,
          serializedUnits,
          canViewDetails: hasUnmaskedAccess
        };
      });

      return {
        siteId: site.id,
        siteCode: site.code,
        siteName: site.name,
        isOwnSite,
        totalInStock: uniqueUnits.filter(unit => isAvailableStatus(unit.status)).length,
        totalAllocated: stock.totalAllocated,
        totalPacked: stock.totalPacked,
        totalUnits: uniqueUnits.length,
        parts: processedParts
      };
    });
  }, [sites, currentUser, getStockOnHandForSite]);

  // 6. Used Parts Aggregation Helper (Derives usage from repairUsageRecords)
  const getUsedPartsForSite = useCallback((siteIdOrCode, targetPartPn = null) => {
    const targetSite = sites.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
    const siteName = targetSite?.name?.toLowerCase() || '';
    const siteCode = targetSite?.code?.toLowerCase() || '';

    const records = (repairUsageRecords || []).filter(r => {
      if (siteIdOrCode && siteIdOrCode !== 'ALL') {
        const rawSite = String(r.raw_site_name || r.site_name || '').toLowerCase();
        const rSiteId = String(r.site_id || '').toLowerCase();
        const matchesSite = (siteCode && rawSite.includes(siteCode)) ||
                            (siteName && rawSite.includes(siteName)) ||
                            (rSiteId && rSiteId === String(targetSite?.id || siteIdOrCode).toLowerCase());
        if (!matchesSite) return false;
      }

      if (targetPartPn) {
        const rawPn = String(r.raw_part_number || r.part_number || '').toUpperCase();
        if (rawPn !== targetPartPn.toUpperCase()) return false;
      }

      return true;
    });

    // Group by Part + Month
    const usageByPartAndMonth = {};
    records.forEach(r => {
      const pn = String(r.raw_part_number || r.part_number || 'UNKNOWN').trim().toUpperCase();
      const month = String(r.month_name || 'Unknown').trim();
      const qty = parseInt(r.quantity, 10) || 1;

      if (!usageByPartAndMonth[pn]) {
        usageByPartAndMonth[pn] = {
          partNumber: pn,
          description: r.raw_part_description || r.description || '',
          totalUsed: 0,
          byMonth: {}
        };
      }

      usageByPartAndMonth[pn].totalUsed += qty;
      usageByPartAndMonth[pn].byMonth[month] = (usageByPartAndMonth[pn].byMonth[month] || 0) + qty;
    });

    return {
      recordsCount: records.length,
      usageByPartAndMonth,
      summaryList: Object.values(usageByPartAndMonth).sort((a, b) => b.totalUsed - a.totalUsed)
    };
  }, [repairUsageRecords, sites]);

  // 7. Live Used Units Log (Returns units with status === 'used')
  const getUsedUnitsLog = useCallback((siteIdOrCode = 'ALL') => {
    const targetSite = sites.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
    const siteId = targetSite?.id || siteIdOrCode;
    const siteCode = targetSite?.code || siteIdOrCode;

    return (inventoryUnits || []).filter(u => {
      const isUsed = String(u.status || '').toLowerCase() === 'used';
      if (!isUsed) return false;

      if (siteIdOrCode && siteIdOrCode !== 'ALL') {
        const uSiteId = u.current_site_id || u.siteId;
        const uSiteCode = u.site_code || u.siteCode;
        const matches = (uSiteId && (uSiteId === siteId || uSiteId === siteCode)) ||
                        (uSiteCode && (uSiteCode === siteCode || uSiteCode === siteId));
        if (!matches) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.used_at || b.received_at || 0) - new Date(a.used_at || a.received_at || 0));
  }, [inventoryUnits, sites]);

  // 8. Mark Unit as Used / Consumed in Repair
  const markUnitAsUsed = useCallback(async ({
    serialNumber,
    partNumber,
    siteId,
    workOrderNumber = '',
    notes = '',
    usedDate = null
  }) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) {
      showToast?.('Please specify a valid serial number.', 'error');
      return { success: false, error: 'Missing serial number' };
    }

    const nowIso = new Date().toISOString();
    const effectiveUsedDate = usedDate
      ? (usedDate.includes('T') ? usedDate : `${usedDate}T12:00:00.000Z`)
      : nowIso;
    const cleanWorkOrder = workOrderNumber ? String(workOrderNumber).trim() : null;
    const cleanNotes = notes ? String(notes).trim() : null;

    // 1. Locate target unit from in-memory state or fallback caches
    let targetUnit = (inventoryUnits || []).find(u =>
      String(u.serial_number || '').trim().toUpperCase() === cleanSerial
    );

    if (!targetUnit) {
      try {
        const cached = readInventoryFromLocalStorage();
        if (Array.isArray(cached)) {
          targetUnit = cached.find(u => String(u.serial_number || '').trim().toUpperCase() === cleanSerial);
        }
      } catch (e) {}
    }

    if (!targetUnit) {
      try {
        const cachedSh = JSON.parse(localStorage.getItem('mdc_shipments') || '[]');
        if (Array.isArray(cachedSh)) {
          for (const sh of cachedSh) {
            if (Array.isArray(sh.items)) {
              const item = sh.items.find(it => String(it.serial_number || it.serialNumber || '').trim().toUpperCase() === cleanSerial);
              if (item) {
                targetUnit = {
                  id: `unit-${cleanSerial}`,
                  serial_number: cleanSerial,
                  part_number: item.part_number || partNumber,
                  description: item.description || '',
                  current_site_id: sh.site_id || siteId,
                  site_code: sh.site_code || null,
                  status: 'in_stock'
                };
                break;
              }
            }
          }
        }
      } catch (e) {}
    }

    if (!targetUnit && partNumber) {
      const partObj = parts.find(p => p.part_number?.toUpperCase() === String(partNumber).toUpperCase());
      targetUnit = {
        id: `unit-${cleanSerial}`,
        serial_number: cleanSerial,
        part_number: partNumber,
        description: partObj?.description || '',
        current_site_id: siteId || currentUser?.siteId,
        status: 'in_stock'
      };
    }

    if (!targetUnit) {
      showToast?.(`Unit with serial number ${cleanSerial} was not found in inventory.`, 'error');
      return { success: false, error: 'Unit not found' };
    }

    const effectiveSiteId = siteId || targetUnit.current_site_id || targetUnit.siteId || currentUser?.siteId;
    const targetSite = sites.find(s => s.id === effectiveSiteId || s.code === effectiveSiteId);
    const targetPart = parts.find(p => p.part_number?.toUpperCase() === String(targetUnit.part_number || partNumber).toUpperCase());

    const metaPayload = {
      lifecycle_status: 'used',
      work_order_number: cleanWorkOrder,
      usage_notes: cleanNotes,
      used_at: effectiveUsedDate,
      outtake_at: null,
      outtake_reason: null,
      transferred_at: null,
      transfer_slip_number: null,
      transferred_to_site_code: null,
      site_code: targetSite?.code || targetUnit.site_code || null,
      site_name: targetSite?.name || targetUnit.site_name || null
    };

    const noteText = cleanNotes ? `Used in ${cleanWorkOrder || 'Repair'} | ${cleanNotes}` : (targetUnit.notes || 'Used in Repair');
    const rawNoteWithoutMeta = noteText.includes(' | __META__:') ? noteText.split(' | __META__:')[0] : noteText;
    const encodedNotes = `${rawNoteWithoutMeta} | __META__:${JSON.stringify(metaPayload)}`;

    const updatedUnit = {
      ...targetUnit,
      status: 'used',
      used_at: effectiveUsedDate,
      dateUsed: usedDate || effectiveUsedDate.substring(0, 10),
      used_by_id: currentUser?.id || null,
      used_by_name: currentUser?.fullName || 'Branch Specialist',
      work_order_number: cleanWorkOrder,
      usage_notes: cleanNotes,
      notes: noteText,
      updated_at: nowIso
    };

    const usageEntry = {
      id: `usage-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      site_id: targetSite?.id || effectiveSiteId,
      raw_site_name: targetSite?.name || 'Branch Site',
      site_name: targetSite?.name || 'Branch Site',
      site_code: targetSite?.code || targetUnit.site_code || 'BRANCH',
      part_id: targetPart?.id || targetUnit.part_id,
      part_number: targetUnit.part_number,
      raw_part_number: targetUnit.part_number,
      raw_part_description: targetUnit.description || targetPart?.description || '',
      description: targetUnit.description || targetPart?.description || '',
      serial_number: cleanSerial,
      quantity: 1,
      work_order_number: cleanWorkOrder,
      usage_notes: cleanNotes,
      used_by: currentUser?.fullName || 'Branch Specialist',
      used_by_id: currentUser?.id || null,
      used_at: effectiveUsedDate,
      date_used: usedDate || effectiveUsedDate.substring(0, 10),
      month_name: new Date(effectiveUsedDate).toLocaleString('default', { month: 'long', year: 'numeric' })
    };

    // 2. IMMEDIATE SYNCHRONOUS LOCAL PERSISTENCE (Guarantees survival on instant refresh)
    // A. Update in-memory inventoryUnits state via functional updater
    let currentAllUnits = [];
    if (setInventoryUnits) {
      setInventoryUnits(prev => {
        const base = prev && prev.length > 0 ? prev : (inventoryUnits || []);
        const exists = base.some(u => String(u.serial_number || '').trim().toUpperCase() === cleanSerial);
        const next = exists
          ? base.map(u => String(u.serial_number || '').trim().toUpperCase() === cleanSerial ? updatedUnit : u)
          : [updatedUnit, ...base];
        currentAllUnits = next;
        try { saveInventoryToLocalStorage(next); } catch (e) {}
        dbStorage.setItem('mdc_inventory', next);
        return next;
      });
    }

    // B. Immediately update mdc_master_used_parts_registry in localStorage & IndexedDB
    let localUsedEntries = [];
    try {
      const saved = JSON.parse(localStorage.getItem('mdc_master_used_parts_registry') || '[]');
      if (Array.isArray(saved)) localUsedEntries = saved;
    } catch (e) {}
    const nextUsedRegistry = [
      usageEntry,
      ...localUsedEntries.filter(e => String(e.serial_number || '').trim().toUpperCase() !== cleanSerial)
    ].slice(0, 500);

    try { localStorage.setItem('mdc_master_used_parts_registry', JSON.stringify(nextUsedRegistry)); } catch (e) {}
    dbStorage.setItem('mdc_master_used_parts_registry', nextUsedRegistry);

    // C. Immediately update mdc_repair_usage in localStorage, IndexedDB, and state
    try {
      const repSaved = JSON.parse(localStorage.getItem('mdc_repair_usage') || '[]');
      const nextRep = [usageEntry, ...(Array.isArray(repSaved) ? repSaved.filter(e => String(e.serial_number || '').trim().toUpperCase() !== cleanSerial) : [])].slice(0, 500);
      localStorage.setItem('mdc_repair_usage', JSON.stringify(nextRep));
      dbStorage.setItem('mdc_repair_usage', nextRep);
    } catch (e) {}
    if (setRepairUsageRecords) {
      setRepairUsageRecords(prev => [usageEntry, ...(Array.isArray(prev) ? prev.filter(e => String(e.serial_number || '').trim().toUpperCase() !== cleanSerial) : [])]);
    }

    // 3. User feedback
    barcodeAudio?.playSuccess?.();
    showToast?.(`Part #${targetUnit.part_number} (${cleanSerial}) recorded as USED in repair order ${cleanWorkOrder || 'N/A'}.`, 'success');

    // 4. Realtime broadcast for multi-tab and superadmin live reflection
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PART_MARKED_AS_USED', { unit: updatedUnit, usage: usageEntry, serialNumber: cleanSerial });
    }

    // 5. Cloud persistence to Supabase
    if (supabase) {
      try {
        const { error: err1 } = await supabase
          .from('inventory_units')
          .update({
            status: 'used',
            notes: encodedNotes,
            allocated_at: effectiveUsedDate,
            updated_at: nowIso
          })
          .eq('serial_number', cleanSerial);

        if (err1) {
          await supabase
            .from('inventory_units')
            .update({
              notes: encodedNotes,
              allocated_at: effectiveUsedDate,
              updated_at: nowIso
            })
            .eq('serial_number', cleanSerial);
        }
      } catch (err) {
        console.warn('markUnitAsUsed db update notice:', err.message);
      }

      // Snapshot upsert to master_used_parts_registry
      try {
        await queuedSavedRecordsUpsert({
          id: 'master_used_parts_registry',
          record_type: 'used_parts_registry',
          period_label: 'Master Used Parts Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Log of serialized parts consumed in repairs',
          saved_by_name: currentUser?.fullName || 'Branch Specialist',
          snapshot_data: {
            records: nextUsedRegistry
          },
          updated_at: nowIso
        }, { immediate: true });
      } catch (e) {
        console.warn('master_used_parts_registry notice:', e.message);
      }

      // Snapshot upserts to master inventories
      const unitsToSave = currentAllUnits.length > 0 ? currentAllUnits : (inventoryUnits || []);
      const isDcUnit = (item) => {
        const sId = String(item.current_site_id || item.site_id || item.siteId || '').toLowerCase();
        const sCode = String(item.site_code || item.siteCode || '').toUpperCase();
        return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode && item.is_dc);
      };
      const branchUnitsList = unitsToSave.filter(item => !isDcUnit(item));
      if (branchUnitsList.length > 0) {
        try {
          await queuedSavedRecordsUpsert({
            id: 'master_branch_inventory_registry',
            record_type: 'branch_inventory',
            period_label: 'Master Retail Branch Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            period_week: 1,
            notes: 'Master In-Stock multi-site inventory across all MobileCare ASP service points',
            saved_by_name: currentUser?.fullName || 'Branch Specialist',
            snapshot_data: {
              units: branchUnitsList
            },
            updated_at: nowIso
          }, { immediate: true });
        } catch (e) {}
      }

      try {
        await queuedSavedRecordsUpsert({
          id: 'live_master_dc_inventory',
          record_type: 'inventory_master',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: 1,
          notes: 'Master In-Stock inventory pool across all accounts',
          saved_by_name: currentUser?.fullName || 'Branch Specialist',
          snapshot_data: {
            units: unitsToSave
          },
          updated_at: nowIso
        }, { immediate: true });
      } catch (e) {}
    }

    return { success: true, unit: updatedUnit, usage: usageEntry };
  }, [inventoryUnits, sites, currentUser, parts, setInventoryUnits, setRepairUsageRecords, showToast, broadcastCloudEvent]);

  // 9. Unmark / Restore Part back to In-Stock (Undo)
  const unmarkUnitAsUsed = useCallback(async (serialNumber) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) return { success: false, error: 'Missing serial' };

    const isPmgUser = currentUser?.role === 'parts_management';
    const isAdmin = currentUser?.role === 'superadmin' || currentUser?.role === 'SUPERADMIN' || currentUser?.role === 'admin' || currentUser?.isSuperAdmin;
    if (isPmgUser && !isAdmin) {
      showToast?.('Permission denied: Only administrators can restore or revert used parts.', 'error');
      return { success: false, error: 'Unauthorized: Admin privileges required to restore parts' };
    }

    const targetUnit = (inventoryUnits || []).find(u =>
      String(u.serial_number || '').trim().toUpperCase() === cleanSerial
    );

    const nowIso = new Date().toISOString();
    const cleanNotes = targetUnit?.notes ? targetUnit.notes.split(' | __META__:')[0] : 'In-Stock';
    const metaPayload = {
      lifecycle_status: 'in_stock',
      work_order_number: null,
      usage_notes: null,
      used_at: null,
      outtake_at: null,
      outtake_reason: null,
      transferred_at: null,
      transfer_slip_number: null,
      transferred_to_site_code: null,
      site_code: targetUnit?.site_code || null,
      site_name: targetUnit?.site_name || null
    };
    const encodedNotes = `${cleanNotes} | __META__:${JSON.stringify(metaPayload)}`;

    const updatedUnit = {
      ...(targetUnit || {}),
      status: 'in_stock',
      used_at: null,
      dateUsed: null,
      used_by_id: null,
      used_by_name: null,
      work_order_number: null,
      usage_notes: null,
      notes: cleanNotes,
      updated_at: nowIso
    };

    let currentAllUnits = [];
    if (setInventoryUnits) {
      setInventoryUnits(prev => {
        const base = prev && prev.length > 0 ? prev : (inventoryUnits || []);
        const next = base.map(u =>
          String(u.serial_number || '').trim().toUpperCase() === cleanSerial ? updatedUnit : u
        );
        currentAllUnits = next;
        try { saveInventoryToLocalStorage(next); } catch (e) {}
        dbStorage.setItem('mdc_inventory', next);
        return next;
      });
    }

    // Immediately remove from local used registry
    let nextUsedRegistry = [];
    try {
      const localReg = JSON.parse(localStorage.getItem('mdc_master_used_parts_registry') || '[]');
      nextUsedRegistry = Array.isArray(localReg) ? localReg.filter(r => String(r.serial_number || '').trim().toUpperCase() !== cleanSerial) : [];
      localStorage.setItem('mdc_master_used_parts_registry', JSON.stringify(nextUsedRegistry));
      dbStorage.setItem('mdc_master_used_parts_registry', nextUsedRegistry);
    } catch (e) {}

    // Immediately remove from local repair usage
    try {
      const repSaved = JSON.parse(localStorage.getItem('mdc_repair_usage') || '[]');
      const nextRep = Array.isArray(repSaved) ? repSaved.filter(r => String(r.serial_number || '').trim().toUpperCase() !== cleanSerial) : [];
      localStorage.setItem('mdc_repair_usage', JSON.stringify(nextRep));
      dbStorage.setItem('mdc_repair_usage', nextRep);
    } catch (e) {}
    if (setRepairUsageRecords) {
      setRepairUsageRecords(prev => Array.isArray(prev) ? prev.filter(r => String(r.serial_number || '').trim().toUpperCase() !== cleanSerial) : []);
    }

    showToast?.(`Part #${cleanSerial} has been restored back to In-Stock.`, 'info');
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PART_RESTORED_TO_STOCK', { serialNumber: cleanSerial, unit: updatedUnit });
    }

    if (supabase) {
      try {
        await supabase
          .from('inventory_units')
          .update({ status: 'in_stock', notes: encodedNotes, updated_at: nowIso })
          .eq('serial_number', cleanSerial);
      } catch (err) {
        console.warn('unmarkUnitAsUsed db notice:', err.message);
      }

      try {
        await queuedSavedRecordsUpsert({
          id: 'master_used_parts_registry',
          record_type: 'used_parts_registry',
          period_label: 'Master Used Parts Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { records: nextUsedRegistry },
          updated_at: nowIso
        }, { immediate: true });
      } catch (e) {}

      const unitsToSave = currentAllUnits.length > 0 ? currentAllUnits : (inventoryUnits || []);
      try {
        await queuedSavedRecordsUpsert({
          id: 'live_master_dc_inventory',
          record_type: 'inventory_master',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: 1,
          notes: 'Master In-Stock inventory pool across all accounts',
          saved_by_name: currentUser?.fullName || 'Branch Specialist',
          snapshot_data: { units: unitsToSave },
          updated_at: nowIso
        }, { immediate: true });
      } catch (e) {}

      const isDcUnit = (item) => {
        const sId = String(item.current_site_id || item.site_id || item.siteId || '').toLowerCase();
        const sCode = String(item.site_code || item.siteCode || '').toUpperCase();
        return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode && item.is_dc);
      };
      const branchUnitsList = unitsToSave.filter(item => !isDcUnit(item));
      if (branchUnitsList.length > 0) {
        try {
          await queuedSavedRecordsUpsert({
            id: 'master_branch_inventory_registry',
            record_type: 'branch_inventory',
            period_label: 'Master Retail Branch Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: {
              units: branchUnitsList
            },
            updated_at: nowIso
          }, { immediate: true });
        } catch (e) {}
      }
    }

    return { success: true };
  }, [inventoryUnits, setInventoryUnits, setRepairUsageRecords, currentUser, showToast, broadcastCloudEvent]);

  // 10. Mark Unit for Outtake (Return to DC / Apple)
  const markUnitForOuttake = useCallback(async ({ serialNumber, reason = '', notes = '' }) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) {
      showToast?.('Please specify a valid serial number.', 'error');
      return { success: false, error: 'Missing serial' };
    }
    const targetUnit = (inventoryUnits || []).find(u =>
      String(u.serial_number || '').trim().toUpperCase() === cleanSerial
    );
    if (!targetUnit) {
      showToast?.(`Unit ${cleanSerial} not found in inventory.`, 'error');
      return { success: false, error: 'Unit not found' };
    }
    const nowIso = new Date().toISOString();
    const cleanReason = reason || 'Scheduled for Return / Outtake';
    const cleanNotes = notes || reason || 'For Outtake';

    const metaPayload = {
      lifecycle_status: 'outtake',
      work_order_number: null,
      usage_notes: null,
      used_at: null,
      outtake_at: nowIso,
      outtake_reason: cleanReason,
      transferred_at: null,
      transfer_slip_number: null,
      transferred_to_site_code: null,
      site_code: targetUnit.site_code || null,
      site_name: targetUnit.site_name || null
    };
    const rawNoteWithoutMeta = cleanNotes.includes(' | __META__:') ? cleanNotes.split(' | __META__:')[0] : cleanNotes;
    const encodedNotes = `${rawNoteWithoutMeta} | __META__:${JSON.stringify(metaPayload)}`;

    const updatedUnit = {
      ...targetUnit,
      status: 'outtake',
      outtake_at: nowIso,
      outtake_reason: cleanReason,
      notes: cleanNotes,
      updated_at: nowIso
    };
    let nextUnits = [];
    if (setInventoryUnits) {
      setInventoryUnits(prev => {
        nextUnits = (prev || []).map(u => String(u.serial_number || '').trim().toUpperCase() === cleanSerial ? updatedUnit : u);
        try { saveInventoryToLocalStorage(nextUnits); } catch (e) {}
        dbStorage.setItem('mdc_inventory', nextUnits);
        return nextUnits;
      });
    }

    showToast?.(`Part #${cleanSerial} marked for OUTTAKE.`, 'info');
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PART_MARKED_OUTTAKE', { unit: updatedUnit, serialNumber: cleanSerial });
    }

    if (supabase) {
      try {
        await supabase.from('inventory_units').update({ status: 'returned', notes: encodedNotes, updated_at: nowIso }).eq('serial_number', cleanSerial);
      } catch (e) {
        console.warn('markUnitForOuttake db notice:', e.message);
      }
      try {
        await queuedSavedRecordsUpsert({
          id: 'live_master_dc_inventory',
          record_type: 'inventory_master',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { units: nextUnits },
          updated_at: nowIso
        }, { immediate: true });
      } catch (e) {}

      const isDcUnit = (item) => {
        const sId = String(item.current_site_id || item.site_id || item.siteId || '').toLowerCase();
        const sCode = String(item.site_code || item.siteCode || '').toUpperCase();
        return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode && item.is_dc);
      };
      const branchUnitsList = nextUnits.filter(item => !isDcUnit(item));
      if (branchUnitsList.length > 0) {
        try {
          await queuedSavedRecordsUpsert({
            id: 'master_branch_inventory_registry',
            record_type: 'branch_inventory',
            period_label: 'Master Retail Branch Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { units: branchUnitsList },
            updated_at: nowIso
          }, { immediate: true });
        } catch (e) {}
      }
    }

    return { success: true, unit: updatedUnit };
  }, [inventoryUnits, setInventoryUnits, showToast, broadcastCloudEvent]);

  // 11. Unmark Unit Outtake / Restore to Stock
  const unmarkUnitForOuttake = useCallback(async (serialNumber) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) return { success: false, error: 'Missing serial' };

    const isPmgUser = currentUser?.role === 'parts_management';
    const isAdmin = currentUser?.role === 'superadmin' || currentUser?.role === 'SUPERADMIN' || currentUser?.role === 'admin' || currentUser?.isSuperAdmin;
    if (isPmgUser && !isAdmin) {
      showToast?.('Permission denied: Only administrators can restore parts.', 'error');
      return { success: false, error: 'Unauthorized: Admin privileges required to restore parts' };
    }

    const targetUnit = (inventoryUnits || []).find(u =>
      String(u.serial_number || '').trim().toUpperCase() === cleanSerial
    );
    const nowIso = new Date().toISOString();
    const cleanNotes = targetUnit?.notes ? targetUnit.notes.split(' | __META__:')[0] : 'In-Stock';
    const metaPayload = {
      lifecycle_status: 'in_stock',
      work_order_number: null,
      usage_notes: null,
      used_at: null,
      outtake_at: null,
      outtake_reason: null,
      transferred_at: null,
      transfer_slip_number: null,
      transferred_to_site_code: null,
      site_code: targetUnit?.site_code || null,
      site_name: targetUnit?.site_name || null
    };
    const encodedNotes = `${cleanNotes} | __META__:${JSON.stringify(metaPayload)}`;

    const updatedUnit = {
      ...(targetUnit || {}),
      status: 'in_stock',
      outtake_at: null,
      outtake_reason: null,
      notes: cleanNotes,
      updated_at: nowIso
    };
    let nextUnits = [];
    if (setInventoryUnits) {
      setInventoryUnits(prev => {
        nextUnits = (prev || []).map(u => String(u.serial_number || '').trim().toUpperCase() === cleanSerial ? updatedUnit : u);
        try { saveInventoryToLocalStorage(nextUnits); } catch (e) {}
        dbStorage.setItem('mdc_inventory', nextUnits);
        return nextUnits;
      });
    }

    showToast?.(`Part #${cleanSerial} restored to In-Stock.`, 'info');
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PART_RESTORED_TO_STOCK', { serialNumber: cleanSerial, unit: updatedUnit });
    }

    if (supabase) {
      try {
        await supabase.from('inventory_units').update({ status: 'in_stock', notes: encodedNotes, updated_at: nowIso }).eq('serial_number', cleanSerial);
      } catch (e) {}
      try {
        await queuedSavedRecordsUpsert({
          id: 'live_master_dc_inventory',
          record_type: 'inventory_master',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { units: nextUnits },
          updated_at: nowIso
        }, { immediate: true });
      } catch (e) {}

      const isDcUnit = (item) => {
        const sId = String(item.current_site_id || item.site_id || item.siteId || '').toLowerCase();
        const sCode = String(item.site_code || item.siteCode || '').toUpperCase();
        return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode && item.is_dc);
      };
      const branchUnitsList = nextUnits.filter(item => !isDcUnit(item));
      if (branchUnitsList.length > 0) {
        try {
          await queuedSavedRecordsUpsert({
            id: 'master_branch_inventory_registry',
            record_type: 'branch_inventory',
            period_label: 'Master Retail Branch Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { units: branchUnitsList },
            updated_at: nowIso
          }, { immediate: true });
        } catch (e) {}
      }
    }

    return { success: true };
  }, [inventoryUnits, setInventoryUnits, currentUser, showToast, broadcastCloudEvent]);

  // 12. Transfer Unit to Other Branch Site
  const transferUnitToSite = useCallback(async ({
    serialNumber,
    targetSiteId,
    targetSiteCode,
    transferSlipNumber = '',
    notes = '',
    transferDate = null
  }) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) {
      showToast?.('Please specify a valid serial number.', 'error');
      return { success: false, error: 'Missing serial' };
    }
    const targetUnit = (inventoryUnits || []).find(u =>
      String(u.serial_number || '').trim().toUpperCase() === cleanSerial
    );
    if (!targetUnit) {
      showToast?.(`Unit ${cleanSerial} not found in inventory.`, 'error');
      return { success: false, error: 'Unit not found' };
    }
    const nowIso = new Date().toISOString();
    const effectiveDate = transferDate ? new Date(transferDate).toISOString() : nowIso;
    const destSite = sites.find(s => s.id === targetSiteId || s.code === targetSiteCode) || { id: targetSiteId, code: targetSiteCode };

    const metaPayload = {
      lifecycle_status: 'transferred',
      work_order_number: null,
      usage_notes: null,
      used_at: null,
      outtake_at: null,
      outtake_reason: null,
      transferred_at: effectiveDate,
      transfer_slip_number: transferSlipNumber || null,
      transferred_to_site_code: destSite.code || null,
      site_code: destSite.code || targetUnit.site_code || null,
      site_name: destSite.name || targetUnit.site_name || null
    };
    const noteText = notes || `Transferred: TS ${transferSlipNumber || 'N/A'} to ${destSite.code || 'Branch'}`;
    const rawNoteWithoutMeta = noteText.includes(' | __META__:') ? noteText.split(' | __META__:')[0] : noteText;
    const encodedNotes = `${rawNoteWithoutMeta} | __META__:${JSON.stringify(metaPayload)}`;

    const updatedUnit = {
      ...targetUnit,
      status: 'transferred',
      transferred_at: effectiveDate,
      transferred_to_site_id: destSite.id,
      transferred_to_site_code: destSite.code,
      transfer_slip_number: transferSlipNumber,
      notes: noteText,
      updated_at: nowIso
    };
    let nextUnits = [];
    if (setInventoryUnits) {
      setInventoryUnits(prev => {
        nextUnits = (prev || []).map(u => String(u.serial_number || '').trim().toUpperCase() === cleanSerial ? updatedUnit : u);
        try { saveInventoryToLocalStorage(nextUnits); } catch (e) {}
        dbStorage.setItem('mdc_inventory', nextUnits);
        return nextUnits;
      });
    }

    showToast?.(`Part #${cleanSerial} recorded as TRANSFERRED to ${destSite.code || 'Branch'}.`, 'success');
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PART_TRANSFERRED', { unit: updatedUnit, serialNumber: cleanSerial });
    }

    if (supabase) {
      try {
        await supabase.from('inventory_units').update({
          status: 'in_stock',
          current_site_id: destSite.id || targetUnit.current_site_id,
          notes: encodedNotes,
          updated_at: nowIso
        }).eq('serial_number', cleanSerial);
      } catch (e) {
        console.warn('transferUnitToSite db notice:', e.message);
      }
      try {
        await queuedSavedRecordsUpsert({
          id: 'live_master_dc_inventory',
          record_type: 'inventory_master',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { units: nextUnits },
          updated_at: nowIso
        }, { immediate: true });
      } catch (e) {}

      const isDcUnit = (item) => {
        const sId = String(item.current_site_id || item.site_id || item.siteId || '').toLowerCase();
        const sCode = String(item.site_code || item.siteCode || '').toUpperCase();
        return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode && item.is_dc);
      };
      const branchUnitsList = nextUnits.filter(item => !isDcUnit(item));
      if (branchUnitsList.length > 0) {
        try {
          await queuedSavedRecordsUpsert({
            id: 'master_branch_inventory_registry',
            record_type: 'branch_inventory',
            period_label: 'Master Retail Branch Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { units: branchUnitsList },
            updated_at: nowIso
          }, { immediate: true });
        } catch (e) {}
      }
    }

    return { success: true, unit: updatedUnit };
  }, [inventoryUnits, sites, setInventoryUnits, showToast, broadcastCloudEvent]);

  // 13. Unmark Unit Transfer / Restore to Stock
  const unmarkUnitTransfer = useCallback(async (serialNumber) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) return { success: false, error: 'Missing serial' };

    const isPmgUser = currentUser?.role === 'parts_management';
    const isAdmin = currentUser?.role === 'superadmin' || currentUser?.role === 'SUPERADMIN' || currentUser?.role === 'admin' || currentUser?.isSuperAdmin;
    if (isPmgUser && !isAdmin) {
      showToast?.('Permission denied: Only administrators can restore parts.', 'error');
      return { success: false, error: 'Unauthorized: Admin privileges required to restore parts' };
    }

    const targetUnit = (inventoryUnits || []).find(u =>
      String(u.serial_number || '').trim().toUpperCase() === cleanSerial
    );
    const nowIso = new Date().toISOString();
    const cleanNotes = targetUnit?.notes ? targetUnit.notes.split(' | __META__:')[0] : 'In-Stock';
    const metaPayload = {
      lifecycle_status: 'in_stock',
      work_order_number: null,
      usage_notes: null,
      used_at: null,
      outtake_at: null,
      outtake_reason: null,
      transferred_at: null,
      transfer_slip_number: null,
      transferred_to_site_code: null,
      site_code: targetUnit?.site_code || null,
      site_name: targetUnit?.site_name || null
    };
    const encodedNotes = `${cleanNotes} | __META__:${JSON.stringify(metaPayload)}`;

    const updatedUnit = {
      ...(targetUnit || {}),
      status: 'in_stock',
      transferred_at: null,
      transferred_to_site_id: null,
      transferred_to_site_code: null,
      transfer_slip_number: null,
      notes: cleanNotes,
      updated_at: nowIso
    };
    let nextUnits = [];
    if (setInventoryUnits) {
      setInventoryUnits(prev => {
        nextUnits = (prev || []).map(u => String(u.serial_number || '').trim().toUpperCase() === cleanSerial ? updatedUnit : u);
        try { saveInventoryToLocalStorage(nextUnits); } catch (e) {}
        dbStorage.setItem('mdc_inventory', nextUnits);
        return nextUnits;
      });
    }

    showToast?.(`Part #${cleanSerial} restored to In-Stock.`, 'info');
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PART_RESTORED_TO_STOCK', { serialNumber: cleanSerial, unit: updatedUnit });
    }

    if (supabase) {
      try {
        await supabase.from('inventory_units').update({ status: 'in_stock', notes: encodedNotes, updated_at: nowIso }).eq('serial_number', cleanSerial);
      } catch (e) {}
      try {
        await queuedSavedRecordsUpsert({
          id: 'live_master_dc_inventory',
          record_type: 'inventory_master',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { units: nextUnits },
          updated_at: nowIso
        }, { immediate: true });
      } catch (e) {}

      const isDcUnit = (item) => {
        const sId = String(item.current_site_id || item.site_id || item.siteId || '').toLowerCase();
        const sCode = String(item.site_code || item.siteCode || '').toUpperCase();
        return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode && item.is_dc);
      };
      const branchUnitsList = nextUnits.filter(item => !isDcUnit(item));
      if (branchUnitsList.length > 0) {
        try {
          await queuedSavedRecordsUpsert({
            id: 'master_branch_inventory_registry',
            record_type: 'branch_inventory',
            period_label: 'Master Retail Branch Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { units: branchUnitsList },
            updated_at: nowIso
          }, { immediate: true });
        } catch (e) {}
      }
    }

    return { success: true };
  }, [inventoryUnits, setInventoryUnits, currentUser, showToast, broadcastCloudEvent]);


  // 15. Aging / Zero-Stock Awareness (Strict Non-Deletion Policy: all inventory units remain 100% intact)
  const purgeStaleZeroStockUnits = useCallback(async () => {
    return { success: true, purged: 0 };
  }, []);

  // Run periodic 3-day zero-stock auto-purge check on mount
  useEffect(() => {
    purgeStaleZeroStockUnits();
  }, [purgeStaleZeroStockUnits]);

  return {
    partsRequests,
    setPartsRequests,
    isLoadingRequests,
    isFulfillmentUser,
    fetchPartsRequests,
    submitPartsRequest,
    submitBatchPartsRequests,
    cancelPartsRequest,
    updatePartsRequestStatus,
    getStockOnHandForSite,
    getAllSitesStockSummary,
    getUsedPartsForSite,
    getUsedUnitsLog,
    markUnitAsUsed,
    unmarkUnitAsUsed,
    markUnitForOuttake,
    unmarkUnitForOuttake,
    transferUnitToSite,
    unmarkUnitTransfer,
    purgeStaleZeroStockUnits
  };
}
