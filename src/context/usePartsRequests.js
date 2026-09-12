import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { barcodeAudio } from '../utils/barcodeAudio';
import { isUUID } from '../utils/appContextHelpers';
import { defaultPartsCatalog } from '../data/defaultCatalog.js';
import { getCategoryForPart } from '../utils/categoryFilter';

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

  // 1. Fetch & Hydrate Parts Requests from Supabase
  const fetchPartsRequests = useCallback(async () => {
    if (!supabase) return;
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
          data.forEach(dbRow => {
            const partObj = dbRow.parts || parts.find(p => p.id === dbRow.part_id) || {};
            const siteObj = dbRow.sites || sites.find(s => s.id === dbRow.site_id) || {};
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
  }, [currentUser, isFulfillmentUser, parts, sites, persistPartsRequests]);

  // Initial fetch on mount or user change
  useEffect(() => {
    fetchPartsRequests();
  }, [fetchPartsRequests]);

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

    const targetSite = sites.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
    const siteId = targetSite?.id || siteIdOrCode;
    const siteCode = targetSite?.code || siteIdOrCode;

    // Filter matching units
    const matchingUnits = (inventoryUnits || []).filter(u => {
      const uSiteId = u.current_site_id || u.siteId;
      const uSiteCode = u.site_code || u.siteCode;
      return (uSiteId && (uSiteId === siteId || uSiteId === siteCode)) ||
             (uSiteCode && (uSiteCode === siteCode || uSiteCode === siteId));
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
        const matchedPart = parts.find(p => p.part_number?.toUpperCase() === cleanPN);
        const catObj = getCategoryForPart(matchedPart || { description: u.description, category_id: u.category_id }, categories);
        const resolvedCategoryName = catObj?.name || (u.category && !isUUID(u.category) ? u.category : 'General');
        const resolvedCategoryId = catObj?.id || matchedPart?.category_id || u.category_id || 'cat-general';
        const resolvedCategoryCode = catObj?.code || 'GENERAL';

        partsSummary[cleanPN] = {
          partNumber: cleanPN,
          partId: matchedPart?.id || u.part_id,
          description: matchedPart?.description || u.description || `Part ${cleanPN}`,
          category: resolvedCategoryName,
          category_name: resolvedCategoryName,
          category_id: resolvedCategoryId,
          categoryId: resolvedCategoryId,
          categoryCode: resolvedCategoryCode,
          model: matchedPart?.iphone_model || u.iphone_model || 'Apple iPhone',
          stockingPrice: matchedPart?.stocking_price || u.stocking_price || 0,
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
  }, [inventoryUnits, parts, sites, categories]);

  // 6. Multi-Site Stock Summary with Granular Serial Privacy & Masking
  const getAllSitesStockSummary = useCallback((targetSiteFilter = 'ALL') => {
    const isSuper = currentUser?.role === 'superadmin';
    const isPmg = currentUser?.role === 'parts_management';
    const userSiteId = currentUser?.siteId;
    const userId = currentUser?.id;

    let siteList = targetSiteFilter === 'ALL'
      ? sites
      : sites.filter(s => s.id === targetSiteFilter || s.code === targetSiteFilter);

    // PMG users cannot view or access DC stocks!
    if (isPmg) {
      siteList = siteList.filter(s => !s.is_dc && s.code !== 'DC-MDC' && s.code !== 'DC');
    }

    return siteList.map(site => {
      const isOwnSite = !isSuper && Boolean(userSiteId && (site.id === userSiteId || site.code === userSiteId));
      const stock = getStockOnHandForSite(site.id);

      // Process parts summary with granular privacy
      const processedParts = Object.values(stock.partsSummary || {}).map(partItem => {
        const matchingUnitsForPart = (stock.units || []).filter(u => {
          const rawPN = String(u.part_number || u.partNumber || '').trim().toUpperCase();
          return rawPN === partItem.partNumber;
        });

        // Determine if user can see serialized details
        const serializedUnits = matchingUnitsForPart.map(u => {
          const isAddedBySelf = Boolean(userId && (
            u.added_by_user_id === userId ||
            u.received_by_id === userId ||
            (u.received_by && currentUser?.fullName && u.received_by.toLowerCase() === currentUser.fullName.toLowerCase())
          ));
          // In PMG accounts, serial numbers are only visible to the user who added them!
          const canViewDetails = isSuper || (isPmg ? isAddedBySelf : (isOwnSite || isAddedBySelf));

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

        const hasUnmaskedAccess = isSuper || (isPmg ? serializedUnits.some(u => !u.isMasked) : isOwnSite);

        return {
          ...partItem,
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
        totalInStock: stock.totalInStock,
        totalAllocated: stock.totalAllocated,
        totalPacked: stock.totalPacked,
        totalUnits: stock.totalUnits,
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
    notes = ''
  }) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) {
      showToast?.('Please specify a valid serial number.', 'error');
      return { success: false, error: 'Missing serial number' };
    }

    const nowIso = new Date().toISOString();
    const targetUnit = (inventoryUnits || []).find(u =>
      String(u.serial_number || '').trim().toUpperCase() === cleanSerial
    );

    if (!targetUnit) {
      showToast?.(`Unit with serial number ${cleanSerial} was not found in inventory.`, 'error');
      return { success: false, error: 'Unit not found' };
    }

    const effectiveSiteId = siteId || targetUnit.current_site_id || targetUnit.siteId || currentUser?.siteId;
    const targetSite = sites.find(s => s.id === effectiveSiteId || s.code === effectiveSiteId);
    const targetPart = parts.find(p => p.part_number?.toUpperCase() === String(targetUnit.part_number || partNumber).toUpperCase());

    const updatedUnit = {
      ...targetUnit,
      status: 'used',
      used_at: nowIso,
      used_by_id: currentUser?.id || null,
      used_by_name: currentUser?.fullName || 'Branch Specialist',
      work_order_number: workOrderNumber ? String(workOrderNumber).trim() : null,
      usage_notes: notes ? String(notes).trim() : null,
      notes: notes ? `Used in ${workOrderNumber || 'Repair'} | ${notes}` : (targetUnit.notes || 'Used in Repair')
    };

    let nextUnits = [];
    if (setInventoryUnits) {
      setInventoryUnits(prev => {
        nextUnits = (prev || []).map(u =>
          String(u.serial_number || '').trim().toUpperCase() === cleanSerial ? updatedUnit : u
        );
        try {
          localStorage.setItem('mdc_inventory', JSON.stringify(nextUnits));
        } catch (e) {}
        dbStorage.setItem('mdc_inventory', nextUnits);
        return nextUnits;
      });
    }

    const usageEntry = {
      id: `usage-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      site_id: targetSite?.id || effectiveSiteId,
      raw_site_name: targetSite?.name || 'Branch Site',
      site_name: targetSite?.name || 'Branch Site',
      site_code: targetSite?.code || 'BRANCH',
      part_id: targetPart?.id || targetUnit.part_id,
      part_number: targetUnit.part_number,
      raw_part_number: targetUnit.part_number,
      raw_part_description: targetUnit.description || targetPart?.description || '',
      description: targetUnit.description || targetPart?.description || '',
      serial_number: cleanSerial,
      quantity: 1,
      work_order_number: workOrderNumber ? String(workOrderNumber).trim() : null,
      usage_notes: notes ? String(notes).trim() : null,
      used_by: currentUser?.fullName || 'Branch Specialist',
      used_by_id: currentUser?.id || null,
      used_at: nowIso,
      month_name: new Date().toLocaleString('default', { month: 'long', year: 'numeric' })
    };

    if (supabase) {
      try {
        await supabase
          .from('inventory_units')
          .update({
            status: 'used',
            notes: updatedUnit.notes,
            allocated_at: nowIso
          })
          .eq('serial_number', cleanSerial);

        const currentAllUnits = nextUnits.length > 0
          ? nextUnits
          : (inventoryUnits || []).map(u => String(u.serial_number || '').toUpperCase() === cleanSerial ? updatedUnit : u);

        await supabase.from('saved_records').upsert({
          id: 'live_master_dc_inventory',
          record_type: 'inventory_master',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: 1,
          notes: 'Master In-Stock inventory pool across all accounts',
          saved_by_name: currentUser?.fullName || 'Branch Specialist',
          snapshot_data: {
            units: currentAllUnits
          },
          updated_at: nowIso
        }, { onConflict: 'id' });

        const { data: existReg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'master_used_parts_registry').maybeSingle();
        const existingEntries = Array.isArray(existReg?.snapshot_data?.records) ? existReg.snapshot_data.records : [];
        const nextEntries = [usageEntry, ...existingEntries.filter(e => e.serial_number !== cleanSerial)].slice(0, 500);

        await supabase.from('saved_records').upsert({
          id: 'master_used_parts_registry',
          record_type: 'used_parts_registry',
          period_label: 'Master Used Parts Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Log of serialized parts consumed in repairs',
          saved_by_name: currentUser?.fullName || 'Branch Specialist',
          snapshot_data: {
            records: nextEntries
          },
          updated_at: nowIso
        }, { onConflict: 'id' });
      } catch (err) {
        console.warn('markUnitAsUsed cloud sync notice:', err.message);
      }
    }

    barcodeAudio?.playSuccess?.();
    showToast?.(`Part #${targetUnit.part_number} (${cleanSerial}) recorded as USED in repair order ${workOrderNumber || 'N/A'}.`, 'success');

    if (broadcastCloudEvent) {
      broadcastCloudEvent('PART_MARKED_AS_USED', { unit: updatedUnit, usage: usageEntry });
    }

    return { success: true, unit: updatedUnit, usage: usageEntry };
  }, [inventoryUnits, sites, currentUser, parts, setInventoryUnits, showToast, broadcastCloudEvent]);

  // 9. Unmark / Restore Part back to In-Stock (Undo)
  const unmarkUnitAsUsed = useCallback(async (serialNumber) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) return { success: false, error: 'Missing serial' };

    const targetUnit = (inventoryUnits || []).find(u =>
      String(u.serial_number || '').trim().toUpperCase() === cleanSerial
    );

    const nowIso = new Date().toISOString();
    const updatedUnit = {
      ...(targetUnit || {}),
      status: 'in_stock',
      used_at: null,
      used_by_id: null,
      used_by_name: null,
      work_order_number: null,
      usage_notes: null
    };

    let nextUnits = [];
    if (setInventoryUnits) {
      setInventoryUnits(prev => {
        nextUnits = (prev || []).map(u =>
          String(u.serial_number || '').trim().toUpperCase() === cleanSerial ? updatedUnit : u
        );
        try { localStorage.setItem('mdc_inventory', JSON.stringify(nextUnits)); } catch (e) {}
        dbStorage.setItem('mdc_inventory', nextUnits);
        return nextUnits;
      });
    }

    if (supabase) {
      try {
        await supabase
          .from('inventory_units')
          .update({ status: 'in_stock' })
          .eq('serial_number', cleanSerial);

        await supabase.from('saved_records').upsert({
          id: 'live_master_dc_inventory',
          record_type: 'inventory_master',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: 1,
          notes: 'Master In-Stock inventory pool across all accounts',
          saved_by_name: currentUser?.fullName || 'Branch Specialist',
          snapshot_data: { units: nextUnits },
          updated_at: nowIso
        }, { onConflict: 'id' });

        const { data: existReg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'master_used_parts_registry').maybeSingle();
        const existingEntries = Array.isArray(existReg?.snapshot_data?.records) ? existReg.snapshot_data.records : [];
        const nextEntries = existingEntries.filter(e => e.serial_number !== cleanSerial);
        await supabase.from('saved_records').upsert({
          id: 'master_used_parts_registry',
          record_type: 'used_parts_registry',
          period_label: 'Master Used Parts Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { records: nextEntries },
          updated_at: nowIso
        }, { onConflict: 'id' });
      } catch (err) {
        console.warn('unmarkUnitAsUsed cloud sync notice:', err.message);
      }
    }

    showToast?.(`Part #${cleanSerial} has been restored back to In-Stock.`, 'info');
    if (broadcastCloudEvent) {
      broadcastCloudEvent('PART_RESTORED_TO_STOCK', { serialNumber: cleanSerial });
    }
    return { success: true };
  }, [inventoryUnits, setInventoryUnits, currentUser, showToast, broadcastCloudEvent]);

  // 10. Aging / Zero-Stock Awareness (Strict Non-Deletion Policy: all inventory units remain 100% intact)
  const purgeStaleZeroStockUnits = useCallback(async () => {
    // Strictly preserve all inventory units without deletion under any circumstances.
    // Aging and zero-stock notices serve only as informational awareness.
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
    purgeStaleZeroStockUnits
  };
}
