import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { barcodeAudio } from '../utils/barcodeAudio';
import { isUUID } from '../utils/appContextHelpers';

const FULFILLMENT_ROLES = ['superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff'];

export function usePartsRequests({
  currentUser,
  parts = [],
  sites = [],
  inventoryUnits = [],
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

    const targetPart = parts.find(p => p.id === partId || p.part_number === partId);
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

    // Execute atomic RPC in Supabase if online and UUIDs are valid
    if (supabase && isUUID(resolvedSiteId) && isUUID(resolvedPartId)) {
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('create_parts_request', {
          p_site_id: resolvedSiteId,
          p_part_id: resolvedPartId,
          p_quantity: qty,
          p_priority: cleanPriority,
          p_reason: cleanReason,
          p_notes: cleanNotes
        });

        if (rpcErr) {
          console.warn('create_parts_request RPC error, attempting direct insert fallback:', rpcErr.message);
          // Fallback direct insert if RPC not registered yet
          const { data: directInsert, error: directErr } = await supabase
            .from('parts_requests')
            .insert({
              request_number: tempReqNum,
              site_id: resolvedSiteId,
              part_id: resolvedPartId,
              quantity_requested: qty,
              quantity_fulfilled: 0,
              status: 'pending',
              priority: cleanPriority,
              requested_by: currentUser?.id,
              requested_by_name: currentUser?.fullName || 'MobileCare Staff',
              reason: cleanReason,
              notes: cleanNotes,
              created_at: nowIso,
              updated_at: nowIso
            })
            .select()
            .maybeSingle();

          if (directErr) throw directErr;
          if (directInsert) {
            setPartsRequests(prev => {
              const updated = (prev || []).map(r => r.id === optimisticRequest.id ? { ...optimisticRequest, ...directInsert } : r);
              persistPartsRequests(updated);
              return updated;
            });
          }
        } else if (rpcRes && rpcRes.id) {
          setPartsRequests(prev => {
            const updated = (prev || []).map(r => r.id === optimisticRequest.id ? {
              ...optimisticRequest,
              id: rpcRes.id,
              request_number: rpcRes.request_number || optimisticRequest.request_number,
              created_at: rpcRes.created_at || optimisticRequest.created_at
            } : r);
            persistPartsRequests(updated);
            return updated;
          });
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
    if (!isSuperadmin) {
      showToast?.('Permission Denied: Only the DC Superadmin has the authority to approve or deny parts requests.', 'error');
      return { success: false, error: 'Permission Denied: Only Superadmin can approve/deny requests' };
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
      reviewed_by: currentUser?.id || null,
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

    if (supabase && isUUID(target.id)) {
      try {
        await supabase
          .from('parts_requests')
          .update(updatePayload)
          .eq('id', target.id);
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
        partsSummary[cleanPN] = {
          partNumber: cleanPN,
          partId: matchedPart?.id || u.part_id,
          description: matchedPart?.description || u.description || `Part ${cleanPN}`,
          category: matchedPart?.category_id || u.category_id || 'cat-general',
          model: matchedPart?.iphone_model || u.iphone_model || 'Apple iPhone',
          stockingPrice: matchedPart?.stocking_price || u.stocking_price || 0,
          inStock: 0,
          allocated: 0,
          packed: 0,
          total: 0
        };
      }

      const status = String(u.status || 'in_stock').toLowerCase();
      if (status === 'in_stock') {
        partsSummary[cleanPN].inStock += 1;
        totalInStock += 1;
      } else if (status === 'allocated') {
        partsSummary[cleanPN].allocated += 1;
        totalAllocated += 1;
      } else if (status === 'packed' || status === 'shipped') {
        partsSummary[cleanPN].packed += 1;
        totalPacked += 1;
      }
      partsSummary[cleanPN].total += 1;
    });

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
  }, [inventoryUnits, parts, sites]);

  // 6. Multi-Site Stock Summary with Granular Serial Privacy & Masking
  const getAllSitesStockSummary = useCallback((targetSiteFilter = 'ALL') => {
    const isSuper = currentUser?.role === 'superadmin';
    const userSiteId = currentUser?.siteId;
    const userId = currentUser?.id;

    const siteList = targetSiteFilter === 'ALL'
      ? sites
      : sites.filter(s => s.id === targetSiteFilter || s.code === targetSiteFilter);

    return siteList.map(site => {
      const isOwnSite = isSuper || (userSiteId && (site.id === userSiteId || site.code === userSiteId));
      const stock = getStockOnHandForSite(site.id);

      // Process parts summary with granular privacy
      const processedParts = Object.values(stock.partsSummary || {}).map(partItem => {
        const matchingUnitsForPart = (stock.units || []).filter(u => {
          const rawPN = String(u.part_number || u.partNumber || '').trim().toUpperCase();
          return rawPN === partItem.partNumber;
        });

        // Determine if user can see serialized details
        const serializedUnits = matchingUnitsForPart.map(u => {
          const isAddedBySelf = userId && (u.added_by_user_id === userId || u.received_by_id === userId || u.received_by === currentUser?.fullName);
          const canViewDetails = isSuper || isOwnSite || isAddedBySelf;

          if (canViewDetails) {
            return {
              id: u.id,
              serialNumber: u.serial_number,
              status: u.status,
              boxNumber: u.box_number || 1,
              receivedAt: u.received_at,
              receivedBy: u.received_by,
              notes: u.notes,
              isMasked: false
            };
          } else {
            return {
              id: u.id,
              serialNumber: '••••••••••••••••',
              status: u.status,
              boxNumber: '—',
              receivedAt: null,
              receivedBy: 'Branch Staff',
              notes: null,
              isMasked: true
            };
          }
        });

        const hasUnmaskedAccess = isSuper || isOwnSite || serializedUnits.some(u => !u.isMasked);

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

  return {
    partsRequests,
    setPartsRequests,
    isLoadingRequests,
    isFulfillmentUser,
    fetchPartsRequests,
    submitPartsRequest,
    cancelPartsRequest,
    updatePartsRequestStatus,
    getStockOnHandForSite,
    getAllSitesStockSummary,
    getUsedPartsForSite
  };
}
