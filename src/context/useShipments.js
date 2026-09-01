import { useState, useCallback } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { isUUID, safeUUID, toValidUUID, isExplicitlyCleared, canUserDeleteRecord, isLockedConfirmedShipment, formatShipmentForDb, formatShipmentItemsForDb, generateNextInvoiceRef } from '../utils/appContextHelpers';

export function useShipments({
  currentUser,
  _parts = [],
  sites = [],
  showToast,
  broadcastCloudEvent,
  logDeletionAudit,
  inventoryUnits = [],
  setInventoryUnits,
  enqueueOfflineAction,
  setCloudSyncStatus
}) {
  const [shipments, setShipments] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      let deletedTokensSet = new Set(['DCOWNED082726A', 'DCOWNED082726B', 'DCOWNED#082726A', 'DCOWNED#082726B']);
      try {
        const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_shipment_ids') || '[]');
        localDeleted.forEach(d => {
          if (d) {
            const raw = String(d).trim().toUpperCase();
            deletedTokensSet.add(raw);
            deletedTokensSet.add(raw.replace(/[^A-Z0-9]/g, ''));
          }
        });
      } catch (e) {}

      const saved = localStorage.getItem('mdc_shipments');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter(s => {
              if (!s) return false;
              const sId = String(s.id || '').trim().toUpperCase();
              const sRef = String(s.invoice_ref || s.invoiceRef || '').trim().toUpperCase();
              const sNum = String(s.shipment_number || '').trim().toUpperCase();
              const sNorm = sRef.replace(/[^A-Z0-9]/g, '');

              // Explicitly filter out accidental test shipments
              if (sNorm === 'DCOWNED082726A' || sNorm === 'DCOWNED082726B') return false;
              if (sRef.includes('082726A') || sRef.includes('082726B')) return false;

              if (deletedTokensSet.has(sId) || deletedTokensSet.has(sRef) || deletedTokensSet.has(sNum) || (sNorm && deletedTokensSet.has(sNorm))) {
                return false;
              }
              return true;
            })
            .map(s => {
              if (!s) return s;
              const cleanPreparedBy = (s.prepared_by_name && s.prepared_by_name !== 'Warehouse Staff') ? s.prepared_by_name : (currentUser?.fullName || 'Zhon Manaois');
              return {
                ...s,
                status: s.status || 'pending_pickup',
                prepared_by_name: cleanPreparedBy,
                saved_by_name: cleanPreparedBy
              };
            });
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const [activePackDraft, setActivePackDraft] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_active_pack_draft');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const syncActivePackDraftToCloud = useCallback(async (draftObj) => {
    const hasItems = draftObj && Array.isArray(draftObj.items) && draftObj.items.length > 0;
    const cleanDraft = hasItems ? draftObj : null;

    setActivePackDraft(cleanDraft);
    const userDraftKey = currentUser?.id ? `mdc_pack_draft_${currentUser.id}` : 'mdc_active_pack_draft';
    try {
      if (cleanDraft) {
        localStorage.setItem(userDraftKey, JSON.stringify(cleanDraft));
        localStorage.setItem('mdc_active_pack_draft', JSON.stringify(cleanDraft));
      } else {
        localStorage.removeItem(userDraftKey);
        localStorage.removeItem('mdc_active_pack_draft');
      }
    } catch (e) {}
  }, [currentUser]);

  const clearShipmentDraftItems = async (shipmentIdOrObj, explicitItems = []) => {
    let targetShipmentId = typeof shipmentIdOrObj === 'object' ? (shipmentIdOrObj.shipmentId || shipmentIdOrObj.id) : shipmentIdOrObj;
    let itemsToProcess = [];

    if (Array.isArray(explicitItems) && explicitItems.length > 0) {
      itemsToProcess = explicitItems;
    } else if (typeof shipmentIdOrObj === 'object' && Array.isArray(shipmentIdOrObj.items) && shipmentIdOrObj.items.length > 0) {
      itemsToProcess = shipmentIdOrObj.items;
    } else {
      const targetShipment = shipments.find(s => s.id === targetShipmentId);
      if (targetShipment && Array.isArray(targetShipment.items)) {
        itemsToProcess = targetShipment.items;
      }
    }

    if (itemsToProcess.length === 0) {
      return { success: true, count: 0 };
    }

    const serialsToRevert = new Set(
      itemsToProcess.map(it => String(it.serial_number || it.serialNumber || '').trim().toUpperCase()).filter(Boolean)
    );

    // 1. Remove these serials from deleted serials registry so they are never filtered out
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      const filteredDeleted = localDeleted.filter(s => !serialsToRevert.has(String(s).trim().toUpperCase()));
      localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(filteredDeleted));
    } catch (e) {}

    // 2. Restore all units in local inventoryUnits state
    if (serialsToRevert.size > 0 && setInventoryUnits) {
      const existingSerialsMap = new Map();
      const updatedInventory = (inventoryUnits || []).map(u => {
        const s = String(u.serial_number || '').trim().toUpperCase();
        if (s) existingSerialsMap.set(s, true);
        if (serialsToRevert.has(s)) {
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

      // If any units from draft were missing in inventoryUnits, construct and append them
      itemsToProcess.forEach(it => {
        const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
        if (s && serialsToRevert.has(s) && !existingSerialsMap.has(s)) {
          updatedInventory.push({
            id: it.id || `unit-${s}`,
            part_id: it.part_id || `part-${it.part_number || 'unknown'}`,
            part_number: it.part_number,
            description: it.description || 'Service Replacement Part',
            serial_number: s,
            current_site_id: 'site-dc',
            site_code: 'DC-MDC',
            status: 'in_stock',
            box_number: 1,
            received_at: it.received_at || new Date().toISOString(),
            received_by: it.received_by || currentUser?.fullName || 'Warehouse Staff'
          });
          existingSerialsMap.set(s, true);
        }
      });

      setInventoryUnits(updatedInventory);
      dbStorage.setItem('mdc_inventory', updatedInventory);
      try { localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory)); } catch (e) {}
    }

    if (targetShipmentId) {
      setShipments(prev => prev.map(sh => {
        if (sh.id === targetShipmentId) {
          return {
            ...sh,
            items: []
          };
        }
        return sh;
      }));
    }

    // 3. Update Supabase with both update and upsert fallback
    if (supabase && serialsToRevert.size > 0) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const serialsArray = Array.from(serialsToRevert);
        let dcSiteId = null;
        const { data: dcSite } = await supabase.from('sites').select('id').or('is_dc.eq.true,code.eq.DC-MDC,code.eq.DC').limit(1).maybeSingle();
        if (dcSite?.id) {
          dcSiteId = dcSite.id;
        } else {
          const { data: anySite } = await supabase.from('sites').select('id').limit(1).maybeSingle();
          dcSiteId = anySite?.id;
        }

        if (dcSiteId && serialsArray.length > 0) {
          await supabase
            .from('inventory_units')
            .update({
              status: 'in_stock',
              current_site_id: dcSiteId,
              box_number: 1,
              shipped_at: null,
              shipped_by: null
            })
            .in('serial_number', serialsArray);

          // Upsert fallback to ensure rows definitely exist in Supabase
          const rowsToUpsert = itemsToProcess.map(it => {
            const cleanS = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
            return {
              id: isUUID(it.id) ? it.id : toValidUUID(it.id || cleanS),
              part_id: isUUID(it.part_id) ? it.part_id : toValidUUID('part-' + (it.part_number || 'unknown')),
              serial_number: cleanS,
              status: 'in_stock',
              current_site_id: dcSiteId,
              box_number: 1,
              received_at: it.received_at || new Date().toISOString(),
              received_by_name: it.received_by || currentUser?.fullName || 'Warehouse Staff',
              notes: it.notes || null,
              updated_at: new Date().toISOString()
            };
          }).filter(r => r.serial_number && isUUID(r.part_id));

          if (rowsToUpsert.length > 0) {
            await supabase.from('inventory_units').upsert(rowsToUpsert, { onConflict: 'serial_number' });
          }
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('DRAFT_CLEARED', { shipmentId: targetShipmentId, serialNumbers: Array.from(serialsToRevert), status: 'in_stock' });
      } catch (dbErr) {
        console.error('Supabase inventory revert error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (broadcastCloudEvent) broadcastCloudEvent('DRAFT_CLEARED', { shipmentId: targetShipmentId, serialNumbers: Array.from(serialsToRevert), status: 'in_stock' });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('DRAFT_CLEARED', { shipmentId: targetShipmentId, serialNumbers: Array.from(serialsToRevert), status: 'in_stock' });
    }

    showToast(`Cleared ${serialsToRevert.size} packed items from draft. Units returned to In-Stock DC inventory!`, 'info');
    return { success: true, count: serialsToRevert.size };
  };

  const deleteShipment = async (shipmentId) => {
    const target = shipments.find(s => s.id === shipmentId);
    if (!target) return { success: false, error: 'Shipment not found' };

    // Immutability Rule: Received confirmed shipments are permanently locked in the database
    if (isLockedConfirmedShipment(target)) {
      showToast('Locked Record: This shipment is marked as Received Confirmed and permanently archived. To maintain data integrity, confirmed shipments cannot be deleted from the system UI.', 'error');
      return { success: false, error: 'Confirmed shipments cannot be deleted through the system interface.' };
    }

    // Authority Rule: Only the user who originally saved/prepared the shipment has permission to delete it
    if (!canUserDeleteRecord(target, currentUser)) {
      const creatorName = target.prepared_by_name || target.saved_by_name || 'the original creator';
      showToast(`Permission Denied: Only ${creatorName} can delete this shipment manifest.`, 'error');
      return { success: false, error: `Permission Denied: Only ${creatorName} can delete this shipment.` };
    }

    let serialsToDelete = [];
    let updatedInventory = inventoryUnits;
    if (target.items && target.items.length > 0) {
      serialsToDelete = target.items.map(it => String(it.serial_number || it.serialNumber || '').trim().toUpperCase()).filter(Boolean);
      const serialsSet = new Set(serialsToDelete);
      
      // Permanently remove these units from live DC inventory
      updatedInventory = (inventoryUnits || []).filter(u => !serialsSet.has(String(u.serial_number || '').toUpperCase()));
      if (setInventoryUnits) setInventoryUnits(updatedInventory);
      dbStorage.setItem('mdc_inventory', updatedInventory);
      try { localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory)); } catch (e) {}

      // Register deleted serials in local deletion registry
      try {
        const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
        const updatedDeletedSerials = Array.from(new Set([...localDeleted, ...serialsToDelete]));
        localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(updatedDeletedSerials));
      } catch (e) {}
    }

    const targetId = target?.id || shipmentId;
    const targetRef = target?.invoice_ref ? String(target.invoice_ref).trim() : '';
    const targetNum = target?.shipment_number ? String(target.shipment_number).trim() : '';
    const cleanRef = targetRef.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const nextList = shipments.filter(s => {
      if (!s) return false;
      const sId = String(s.id || '').trim();
      const sRef = String(s.invoice_ref || s.invoiceRef || '').trim();
      const sNum = String(s.shipment_number || '').trim();
      const sNorm = sRef.toUpperCase().replace(/[^A-Z0-9]/g, '');

      if (sId === targetId || sId === shipmentId) return false;
      if (targetRef && sRef.toUpperCase() === targetRef.toUpperCase()) return false;
      if (targetNum && sNum.toUpperCase() === targetNum.toUpperCase()) return false;
      if (cleanRef && sNorm === cleanRef) return false;
      return true;
    });

    setShipments(nextList);
    dbStorage.setItem('mdc_shipments', nextList);

    let updatedDeletedList = [];
    try {
      localStorage.setItem('mdc_shipments', JSON.stringify(nextList));
      const deletedList = JSON.parse(localStorage.getItem('mdc_deleted_shipment_ids') || '[]');
      const tokensToAdd = [targetId, shipmentId, targetRef, targetNum, cleanRef].filter(Boolean);
      updatedDeletedList = Array.from(new Set([...deletedList, ...tokensToAdd]));
      localStorage.setItem('mdc_deleted_shipment_ids', JSON.stringify(updatedDeletedList));
    } catch (e) {}

    if (logDeletionAudit) {
      await logDeletionAudit({
        entityType: 'Shipment Manifest',
        entityId: shipmentId,
        entityLabel: target.tracking_number ? `Shipment #${target.tracking_number}` : `Shipment ${shipmentId}`,
        summary: {
          destinationSite: target.destination_site_name || target.destination_site_id || 'Branch',
          itemsCount: target.items?.length || 0,
          boxCount: target.box_count || 1,
          shippedAt: target.shipped_at || target.created_at
        },
        reason: 'Deleted by warehouse dispatcher / admin (parts purged)'
      });
    }

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error: delRecErr } = await supabase.from('saved_records').delete().eq('id', shipmentId);
        if (delRecErr) {
          await supabase.from('saved_records').update({ notes: '__DELETED__', snapshot_data: { isDeleted: true }, updated_at: new Date().toISOString() }).eq('id', shipmentId);
        }
        // Find all actual PostgreSQL shipment IDs associated with targetId, shipmentId, invoice_ref, or shipment_number
        const matchedDbIds = new Set();
        if (isUUID(targetId)) matchedDbIds.add(targetId);
        if (isUUID(shipmentId)) matchedDbIds.add(shipmentId);

        try {
          const filterParts = [];
          if (isUUID(targetId)) filterParts.push(`id.eq.${targetId}`);
          if (isUUID(shipmentId)) filterParts.push(`id.eq.${shipmentId}`);
          if (targetRef) filterParts.push(`invoice_ref.eq.${targetRef}`);
          if (targetNum) filterParts.push(`shipment_number.eq.${targetNum}`);

          if (filterParts.length > 0) {
            const { data: dbMatchedRows } = await supabase
              .from('shipments')
              .select('id')
              .or(filterParts.join(','));

            if (dbMatchedRows && Array.isArray(dbMatchedRows)) {
              dbMatchedRows.forEach(r => {
                if (r?.id) matchedDbIds.add(r.id);
              });
            }
          }
        } catch (mErr) {}

        // 1. Delete child shipment_items for every matched ID first to prevent foreign key constraint violations
        for (const dbId of matchedDbIds) {
          try { await supabase.from('shipment_items').delete().eq('shipment_id', dbId); } catch (e) {}
        }
        try { await supabase.from('shipment_items').delete().eq('shipment_id', targetId); } catch (e) {}
        try { await supabase.from('shipment_items').delete().eq('shipment_id', shipmentId); } catch (e) {}

        // 2. Delete parent shipments rows
        for (const dbId of matchedDbIds) {
          try { await supabase.from('shipments').delete().eq('id', dbId); } catch (e) {}
        }
        try { await supabase.from('shipments').delete().eq('id', targetId); } catch (e) {}
        try { await supabase.from('shipments').delete().eq('id', shipmentId); } catch (e) {}
        if (targetRef) {
          try { await supabase.from('shipments').delete().eq('invoice_ref', targetRef); } catch (e) {}
        }
        if (targetNum) {
          try { await supabase.from('shipments').delete().eq('shipment_number', targetNum); } catch (e) {}
        }

        await supabase.from('saved_records').upsert({
          id: 'deleted_shipment_ids_registry',
          record_type: 'deletion_registry',
          period_label: 'Deleted Shipment IDs Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { deletedIds: updatedDeletedList },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        try {
          await supabase.from('saved_records').upsert({
            id: 'master_shipments_registry',
            record_type: 'shipments_registry',
            period_label: 'Master Shipments Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Master DC Outbound Shipments & Packing Lists',
            saved_by_name: currentUser?.fullName || 'Warehouse Staff',
            snapshot_data: {
              shipments: nextList,
              deletedIds: updatedDeletedList,
              updatedAt: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (mErr) {
          console.warn('master_shipments_registry delete note:', mErr.message);
        }

        if (updatedInventory && updatedInventory.length > 0) {
          await supabase.from('saved_records').upsert({
            id: 'live_master_dc_inventory',
            record_type: 'inventory_master',
            period_label: 'Live Master DC Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            period_week: 1,
            notes: 'Master DC In-Stock inventory pool across all accounts',
            saved_by_name: currentUser?.fullName || 'Warehouse Staff',
            snapshot_data: {
              units: updatedInventory
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        }

        // Permanently delete units from Supabase inventory_units and update deletion registry
        if (serialsToDelete.length > 0) {
          try {
            await supabase.from('inventory_units').delete().in('serial_number', serialsToDelete);
          } catch (delUnitErr) {
            console.warn('Supabase inventory_units delete notice:', delUnitErr.message);
          }

          try {
            const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
            await supabase.from('saved_records').upsert({
              id: 'deleted_unit_serials_registry',
              record_type: 'deletion_registry',
              period_label: 'Deleted Unit Serials Registry',
              period_year: new Date().getFullYear(),
              period_month: new Date().getMonth() + 1,
              snapshot_data: { deletedSerials: localDeleted },
              updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
          } catch (regErr) {
            console.warn('Deleted unit serials registry update notice:', regErr.message);
          }
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('SHIPMENT_DELETED', { shipmentId });
      } catch (dbErr) {
        console.error('Supabase delete shipment error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) enqueueOfflineAction('SHIPMENT_DELETE', { shipmentId });
        if (broadcastCloudEvent) broadcastCloudEvent('SHIPMENT_DELETED', { shipmentId });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('SHIPMENT_DELETED', { shipmentId });
    }

    showToast(`Deleted manifest ${target.invoice_ref || target.shipment_number} and permanently removed all included parts from database.`, 'info');
    return { success: true };
  };

  const batchImportShipments = async (newShipmentsList) => {
    if (!newShipmentsList || newShipmentsList.length === 0) {
      return { success: false, error: 'No shipments to import' };
    }

    const updated = [...newShipmentsList, ...shipments.filter(s => !newShipmentsList.some(ns => ns.id === s.id))];
    setShipments(updated);

    try {
      localStorage.setItem('mdc_shipments', JSON.stringify(updated));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
    dbStorage.setItem('mdc_shipments', updated);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const recordsToUpsert = newShipmentsList.map(sh => ({
          id: sh.id,
          record_type: 'shipment',
          period_label: sh.invoice_ref || sh.shipment_number,
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: sh.week_number || 1,
          notes: sh.remarks || '',
          saved_by_name: sh.prepared_by_name || currentUser?.fullName || 'Warehouse Staff',
          saved_by_user_id: safeUUID(currentUser?.id),
          snapshot_data: sh,
          created_at: sh.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));
        const { error } = await supabase.from('saved_records').upsert(recordsToUpsert, { onConflict: 'id' });
        if (error) throw error;

        try {
          await supabase.from('saved_records').upsert({
            id: 'master_shipments_registry',
            record_type: 'shipments_registry',
            period_label: 'Master Shipments Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Master DC Outbound Shipments & Packing Lists',
            saved_by_name: currentUser?.fullName || 'Warehouse Staff',
            snapshot_data: {
              shipments: newShipmentsList,
              updatedAt: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (mErr) {
          console.warn('master_shipments_registry batch import note:', mErr.message);
        }

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('SHIPMENTS_IMPORTED', { count: newShipmentsList.length });
      } catch (dbErr) {
        console.error('Supabase batch import shipments error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (broadcastCloudEvent) broadcastCloudEvent('SHIPMENTS_IMPORTED', { count: newShipmentsList.length });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('SHIPMENTS_IMPORTED', { count: newShipmentsList.length });
    }

    showToast(`Successfully imported ${newShipmentsList.length} shipment manifests!`, 'success');
    return { success: true, count: newShipmentsList.length };
  };

  const clearAllShipmentsData = async () => {
    let updatedInventory = inventoryUnits;
    if (setInventoryUnits) {
      updatedInventory = inventoryUnits.map(u => {
        if (u.status === 'packed' || u.status === 'shipped') {
          return {
            ...u,
            status: 'in_stock',
            current_site_id: 'site-dc',
            shipped_at: null,
            shipped_by: null
          };
        }
        return u;
      });
      setInventoryUnits(updatedInventory);
    }
    setShipments([]);

    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory));
      localStorage.removeItem('mdc_shipments');
      localStorage.removeItem('mdc_active_pack_draft');
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
    dbStorage.setItem('mdc_inventory', updatedInventory);
    dbStorage.setItem('mdc_shipments', []);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        await supabase.from('saved_records').delete().eq('record_type', 'shipment');
        try {
          await supabase.from('saved_records').upsert({
            id: 'master_shipments_registry',
            record_type: 'shipments_registry',
            period_label: 'Master Shipments Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Master DC Outbound Shipments & Packing Lists',
            saved_by_name: currentUser?.fullName || 'Warehouse Staff',
            snapshot_data: {
              shipments: [],
              updatedAt: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (mErr) {}
        try { await supabase.from('shipment_items').delete().neq('id', '00000000-0000-0000-0000-000000000000'); } catch (e) {}
        try { await supabase.from('shipments').delete().neq('id', '00000000-0000-0000-0000-000000000000'); } catch (e) {}
        await supabase.from('inventory_units').update({ status: 'in_stock', current_site_id: 'site-dc', shipped_at: null }).neq('id', '00000000-0000-0000-0000-000000000000');
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('SHIPMENTS_CLEARED');
      } catch (dbErr) {
        console.error('Supabase clear all shipments error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (broadcastCloudEvent) broadcastCloudEvent('SHIPMENTS_CLEARED');
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('SHIPMENTS_CLEARED');
    }

    showToast('Cleared all shipment records and restored parts to DC stock.', 'info');
  };

  const saveShipment = async (shipmentData) => {
    if (!shipmentData) return;
    const isUpdate = shipmentData.id && shipments.some(s => s.id === shipmentData.id);
    const resolvedPreparedBy = (shipmentData.prepared_by_name && shipmentData.prepared_by_name !== 'Warehouse Staff')
      ? shipmentData.prepared_by_name
      : (currentUser?.fullName || currentUser?.name || 'Zhon Manaois');

    const cleanShipmentDate = (shipmentData.status === 'pending_pickup' || shipmentData.status === 'draft')
      ? (shipmentData.shipment_date || '')
      : (shipmentData.shipment_date || shipmentData.pickup_date || '');

    const newShipment = {
      ...shipmentData,
      id: shipmentData.id || `ship-${Date.now()}`,
      shipment_number: shipmentData.shipment_number || `SHIP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(shipments.length + 1).padStart(3, '0')}`,
      invoice_ref: shipmentData.invoice_ref || generateNextInvoiceRef(shipments),
      status: shipmentData.status || 'pending_pickup',
      prepared_by_name: resolvedPreparedBy,
      saved_by_name: resolvedPreparedBy,
      shipment_date: cleanShipmentDate,
      created_at: shipmentData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const nextList = isUpdate 
      ? shipments.map(s => s.id === shipmentData.id ? newShipment : s)
      : [newShipment, ...shipments.filter(s => s.id !== newShipment.id)];

    setShipments(nextList);
    try {
      localStorage.setItem('mdc_shipments', JSON.stringify(nextList));
    } catch (e) {}
    dbStorage.setItem('mdc_shipments', nextList);

    let updatedInv = [];
    if (newShipment.items && newShipment.items.length > 0 && setInventoryUnits) {
      const serialsInShipment = new Set(newShipment.items.map(it => String(it.serial_number || it.serialNumber || '').trim().toUpperCase()).filter(Boolean));
      const targetUnitStatus = (newShipment.status === 'received_confirmed' || newShipment.status === 'delivered') 
        ? 'in_stock' 
        : ((newShipment.status === 'shipped' || newShipment.status === 'in_transit') ? 'shipped' : 'packed');
      
      setInventoryUnits(prev => {
        updatedInv = (prev || []).map(u => {
          const s = String(u.serial_number || '').trim().toUpperCase();
          if (serialsInShipment.has(s)) {
            return {
              ...u,
              status: targetUnitStatus,
              box_number: u.box_number || 1,
              current_site_id: newShipment.site_id || u.current_site_id,
              shipped_at: newShipment.shipment_date || new Date().toISOString(),
              shipped_by: resolvedPreparedBy,
              received_at: (newShipment.status === 'received_confirmed' || newShipment.status === 'delivered') ? (newShipment.received_at || new Date().toISOString()) : u.received_at,
              received_by: (newShipment.status === 'received_confirmed' || newShipment.status === 'delivered') ? (newShipment.received_by_name || currentUser?.fullName || 'Superadmin') : u.received_by
            };
          }
          return u;
        });
        try { localStorage.setItem('mdc_inventory', JSON.stringify(updatedInv)); } catch (e) {}
        dbStorage.setItem('mdc_inventory', updatedInv);
        return updatedInv;
      });
    }

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error: recErr } = await supabase.from('saved_records').upsert({
          id: newShipment.id,
          record_type: 'shipment',
          period_label: newShipment.invoice_ref || newShipment.shipment_number,
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: newShipment.week_number || 1,
          notes: newShipment.remarks || '',
          saved_by_name: resolvedPreparedBy,
          saved_by_user_id: safeUUID(currentUser?.id),
          snapshot_data: newShipment,
          created_at: newShipment.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        if (recErr) throw recErr;

        // Channel 0: Upsert to authoritative master_shipments_registry
        try {
          await supabase.from('saved_records').upsert({
            id: 'master_shipments_registry',
            record_type: 'shipments_registry',
            period_label: 'Master Shipments Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Master DC Outbound Shipments & Packing Lists',
            saved_by_name: resolvedPreparedBy,
            saved_by_user_id: safeUUID(currentUser?.id),
            snapshot_data: {
              shipments: nextList,
              updatedAt: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (mErr) {
          console.warn('master_shipments_registry save note:', mErr.message);
        }

        // Channel 1: Atomic Upsert to direct shipments table in Supabase
        const directShipmentRow = formatShipmentForDb(newShipment, sites);
        let effectiveDbShipmentId = directShipmentRow?.id;
        let shipmentSavedInDb = false;

        if (directShipmentRow && isUUID(directShipmentRow.site_id)) {
          try {
            // First check if matching row exists by exact shipment_number
            const { data: existingShp } = await supabase
              .from('shipments')
              .select('id')
              .eq('shipment_number', directShipmentRow.shipment_number)
              .maybeSingle();

            const targetDbId = existingShp?.id || directShipmentRow.id;
            effectiveDbShipmentId = targetDbId;

            const upsertPayload = {
              ...directShipmentRow,
              id: targetDbId
            };

            const { data: upsertData, error: upsertErr } = await supabase
              .from('shipments')
              .upsert(upsertPayload, { onConflict: 'shipment_number' })
              .select('id');

            if (!upsertErr) {
              shipmentSavedInDb = true;
              if (upsertData && upsertData[0]?.id) {
                effectiveDbShipmentId = upsertData[0].id;
              }
            } else {
              console.warn('Direct shipments table upsert notice:', upsertErr.message);
              // Fallback direct update by shipment_number
              const { error: updErr } = await supabase
                .from('shipments')
                .update(upsertPayload)
                .eq('shipment_number', directShipmentRow.shipment_number);
              if (!updErr) {
                shipmentSavedInDb = true;
              }
            }
          } catch (shpErr) {
            console.warn('Direct shipments table catch notice:', shpErr.message);
          }
        }

        // Channel 1b: Upsert to direct shipment_items table with DB foreign key integrity resolution
        if (shipmentSavedInDb && effectiveDbShipmentId && isUUID(effectiveDbShipmentId) && newShipment.items && newShipment.items.length > 0) {
          try {
            // Verify that parent shipment actually exists in database before inserting child items
            const { data: verifyParent } = await supabase
              .from('shipments')
              .select('id')
              .eq('id', effectiveDbShipmentId)
              .maybeSingle();

            if (verifyParent?.id) {
              const shipmentItemsRows = formatShipmentItemsForDb(
                { ...newShipment, id: verifyParent.id },
                [],
                [],
                currentUser
              );

              if (shipmentItemsRows.length > 0) {
                // Delete old items for this shipment first to prevent duplicates & constraint collisions
                await supabase.from('shipment_items').delete().eq('shipment_id', verifyParent.id);
                // Insert with safe null part and unit references to ensure zero foreign key collisions
                const safeRows = shipmentItemsRows.map(r => ({
                  ...r,
                  shipment_id: verifyParent.id,
                  part_id: null,
                  inventory_unit_id: null
                }));
                const { error: itInsErr } = await supabase.from('shipment_items').insert(safeRows);
                if (itInsErr) {
                  console.warn('Direct shipment_items insert notice:', itInsErr.message);
                }
              }
            }
          } catch (itErr) {
            console.warn('Direct shipment_items table notice:', itErr.message);
          }
        }

        setActivePackDraft(null);
        try {
          const userDraftKey = currentUser?.id ? `mdc_pack_draft_${currentUser.id}` : 'mdc_active_pack_draft';
          localStorage.removeItem(userDraftKey);
          localStorage.removeItem('mdc_active_pack_draft');
        } catch (e) {}

        if (updatedInv && updatedInv.length > 0) {
          try {
            await supabase.from('saved_records').upsert({
              id: 'live_master_dc_inventory',
              record_type: 'inventory_master',
              period_label: 'Live Master DC Inventory',
              period_year: new Date().getFullYear(),
              period_month: new Date().getMonth() + 1,
              period_week: 1,
              notes: 'Master DC In-Stock inventory pool across all accounts',
              saved_by_name: currentUser?.fullName || 'Warehouse Staff',
              snapshot_data: {
                units: updatedInv
              },
              updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
          } catch (invErr) {
            console.warn('live_master_dc_inventory update note:', invErr.message);
          }
        }

        if (newShipment.items && newShipment.items.length > 0) {
          const targetUnitStatus = (newShipment.status === 'received_confirmed' || newShipment.status === 'delivered') 
            ? 'in_stock' 
            : ((newShipment.status === 'shipped' || newShipment.status === 'in_transit') ? 'shipped' : 'packed');
          
          const rowsToUpsert = newShipment.items.map(it => {
            const cleanSerial = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
            const existingU = inventoryUnits.find(u => String(u.serial_number || '').toUpperCase() === cleanSerial);
            const partId = isUUID(existingU?.part_id) ? existingU.part_id : null;
            const siteId = isUUID(newShipment.site_id) ? newShipment.site_id : null;

            return {
              ...(partId ? { part_id: partId } : {}),
              serial_number: cleanSerial,
              status: targetUnitStatus,
              box_number: it.box_number || 1,
              ...(siteId ? { current_site_id: siteId } : {}),
              shipped_at: newShipment.shipment_date || new Date().toISOString(),
              received_at: (newShipment.status === 'received_confirmed' || newShipment.status === 'delivered') ? (newShipment.received_at || new Date().toISOString()) : null
            };
          }).filter(r => r.serial_number);

          if (rowsToUpsert.length > 0) {
            try {
              await supabase.from('inventory_units').upsert(rowsToUpsert, { onConflict: 'serial_number' });
            } catch (uErr) {
              console.warn('Supabase inventory_units upsert note:', uErr.message);
            }
          }
        }

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) {
          broadcastCloudEvent('SHIPMENT_SAVED', { shipmentId: newShipment.id });
          broadcastCloudEvent('DRAFT_UPDATED', { count: 0 });
          if (newShipment.status === 'received_confirmed') {
            broadcastCloudEvent('SHIPMENT_RECEIVED', { shipmentId: newShipment.id, siteId: newShipment.site_id });
          }
        }
      } catch (dbErr) {
        console.error('Supabase save shipment error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) {
          enqueueOfflineAction('SHIPMENT_UPSERT', {
            id: newShipment.id,
            record_type: 'shipment',
            period_label: newShipment.invoice_ref || newShipment.shipment_number,
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            period_week: newShipment.week_number || 1,
            notes: newShipment.remarks || '',
            saved_by_name: newShipment.prepared_by_name || currentUser?.fullName || 'Warehouse Staff',
            saved_by_user_id: safeUUID(currentUser?.id),
            snapshot_data: newShipment,
            created_at: newShipment.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
        if (broadcastCloudEvent) {
          broadcastCloudEvent('SHIPMENT_SAVED', { shipmentId: newShipment.id });
          broadcastCloudEvent('DRAFT_UPDATED', { count: 0 });
          if (newShipment.status === 'received_confirmed') {
            broadcastCloudEvent('SHIPMENT_RECEIVED', { shipmentId: newShipment.id, siteId: newShipment.site_id });
          }
        }
      }
    } else {
      if (broadcastCloudEvent) {
        broadcastCloudEvent('SHIPMENT_SAVED', { shipmentId: newShipment.id });
        broadcastCloudEvent('DRAFT_UPDATED', { count: 0 });
        if (newShipment.status === 'received_confirmed') {
          broadcastCloudEvent('SHIPMENT_RECEIVED', { shipmentId: newShipment.id, siteId: newShipment.site_id });
        }
      }
    }

    showToast(isUpdate ? `Shipment ${newShipment.invoice_ref || newShipment.shipment_number} updated` : `Created Packing List Manifest: ${newShipment.invoice_ref || newShipment.shipment_number}`, 'success');
    return newShipment;
  };

  // Dedicated Superadmin Site Receipt Confirmation Handler
  const confirmSiteReceive = async (shipmentId, receiveDetails = {}, { partsRequests = [], updatePartsRequestStatus = null } = {}) => {
    const target = shipments.find(s => s.id === shipmentId || s.shipment_number === shipmentId || s.invoice_ref === shipmentId);
    if (!target) {
      showToast?.('Shipment manifest not found.', 'error');
      return { success: false, error: 'Shipment not found' };
    }

    const cleanReceiver = String(receiveDetails.receivedByName || '').trim() || currentUser?.fullName || 'Superadmin';
    const cleanDate = String(receiveDetails.receivedDate || '').trim() || new Date().toISOString().split('T')[0];
    const cleanCondition = receiveDetails.receivedCondition || 'Good Condition (All parts intact & verified)';
    const cleanNotes = receiveDetails.receivingNotes || 'Confirmed physical receipt of package and parts at branch.';

    const updatedShipment = {
      ...target,
      status: 'received_confirmed',
      received_at: new Date().toISOString(),
      received_date: cleanDate,
      received_by_name: cleanReceiver,
      receiving_signature: cleanReceiver,
      receiving_condition: cleanCondition,
      receiving_notes: cleanNotes,
      updated_at: new Date().toISOString()
    };

    await saveShipment(updatedShipment);

    // Automatically fulfill linked parts requests for this destination site and parts
    if (typeof updatePartsRequestStatus === 'function' && Array.isArray(partsRequests) && partsRequests.length > 0) {
      const shipmentPartNumbers = new Set((target.items || []).map(it => String(it.part_number || '').trim().toUpperCase()).filter(Boolean));
      const targetSiteId = target.site_id;

      const matchingRequests = partsRequests.filter(req => {
        if (req.status === 'fulfilled' || req.status === 'cancelled' || req.status === 'rejected') return false;
        const matchesSite = req.site_id === targetSiteId || req.site_code === target.site_code;
        const reqPN = String(req.part_number || '').trim().toUpperCase();
        const matchesPart = !reqPN || shipmentPartNumbers.has(reqPN);
        return matchesSite && matchesPart;
      });

      for (const req of matchingRequests) {
        try {
          await updatePartsRequestStatus(req.id, {
            status: 'fulfilled',
            quantityFulfilled: req.quantity_requested || 1,
            reviewedBy: cleanReceiver,
            notes: `Auto-fulfilled via confirmed shipment ${target.invoice_ref || target.shipment_number}`,
            fulfilledShipmentId: target.id
          });
        } catch (reqErr) {
          console.warn('Auto fulfill parts request note:', reqErr.message);
        }
      }
    }

    showToast?.(`Confirmed Receipt at site! Shipment ${updatedShipment.invoice_ref || updatedShipment.shipment_number} parts are now ACTIVE & IN STOCK at branch.`, 'success');
    return { success: true, shipment: updatedShipment };
  };

  return {
    shipments,
    setShipments,
    activePackDraft,
    setActivePackDraft,
    syncActivePackDraftToCloud,
    clearShipmentDraftItems,
    deleteShipment,
    batchImportShipments,
    clearAllShipmentsData,
    saveShipment,
    confirmSiteReceive
  };
}
