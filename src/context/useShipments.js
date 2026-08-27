import { useState, useCallback } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { isUUID, safeUUID, isExplicitlyCleared, canUserDeleteRecord, isLockedConfirmedShipment, formatShipmentForDb, formatShipmentItemsForDb } from '../utils/appContextHelpers';

export function useShipments({
  currentUser,
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
      const saved = localStorage.getItem('mdc_shipments');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
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
    setActivePackDraft(draftObj || null);
    if (!supabase) return;
    try {
      if (!draftObj || !draftObj.items || draftObj.items.length === 0) {
        await supabase.from('saved_records').delete().eq('id', 'active_packing_manifest_draft');
      } else {
        await supabase.from('saved_records').upsert({
          id: 'active_packing_manifest_draft',
          record_type: 'packing_draft',
          period_label: draftObj.invoice_ref || draftObj.shipment_number || 'Live Packing Draft',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: draftObj.week_number || 1,
          notes: 'Live workstation packing list draft in progress',
          saved_by_name: draftObj.prepared_by_name || currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: draftObj,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      }
    } catch (e) {
      console.warn('Sync active pack draft error:', e);
    }
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

    if (serialsToRevert.size > 0 && setInventoryUnits) {
      const updatedInventory = inventoryUnits.map(u => {
        if (serialsToRevert.has(String(u.serial_number || '').toUpperCase())) {
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
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('DRAFT_CLEARED', { shipmentId: targetShipmentId });
      } catch (dbErr) {
        console.error('Supabase inventory revert error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (broadcastCloudEvent) broadcastCloudEvent('DRAFT_CLEARED', { shipmentId: targetShipmentId });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('DRAFT_CLEARED', { shipmentId: targetShipmentId });
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

    const nextList = shipments.filter(s => s.id !== shipmentId);
    setShipments(nextList);
    dbStorage.setItem('mdc_shipments', nextList);

    let updatedDeletedList = [];
    try {
      localStorage.setItem('mdc_shipments', JSON.stringify(nextList));
      const deletedList = JSON.parse(localStorage.getItem('mdc_deleted_shipment_ids') || '[]');
      updatedDeletedList = Array.from(new Set([...deletedList, shipmentId]));
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
        try { await supabase.from('shipments').delete().eq('id', shipmentId); } catch (e) {}

        await supabase.from('saved_records').upsert({
          id: 'deleted_shipment_ids_registry',
          record_type: 'deletion_registry',
          period_label: 'Deleted Shipment IDs Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { deletedIds: updatedDeletedList },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

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
    const newShipment = {
      ...shipmentData,
      id: shipmentData.id || `ship-${Date.now()}`,
      shipment_number: shipmentData.shipment_number || `SHIP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(shipments.length + 1).padStart(3, '0')}`,
      invoice_ref: shipmentData.invoice_ref || `DCMSPIOWNED#${Date.now().toString().slice(-6)}G`,
      status: shipmentData.status || 'shipped',
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
      const targetUnitStatus = newShipment.status === 'shipped' || newShipment.status === 'delivered' ? 'shipped' : 'packed';
      
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
              shipped_by: newShipment.prepared_by_name || currentUser?.fullName || 'Warehouse Staff'
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
          saved_by_name: newShipment.prepared_by_name || currentUser?.fullName || 'Warehouse Staff',
          saved_by_user_id: safeUUID(currentUser?.id),
          snapshot_data: newShipment,
          created_at: newShipment.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        if (recErr) throw recErr;

        // Channel 1: Upsert to direct shipments table in Supabase
        const directShipmentRow = formatShipmentForDb(newShipment);
        if (directShipmentRow && isUUID(directShipmentRow.site_id)) {
          try {
            await supabase.from('shipments').upsert(directShipmentRow, { onConflict: 'id' });
          } catch (shpErr) {
            console.warn('Direct shipments table notice:', shpErr.message);
          }
        }

        // Channel 1b: Upsert to direct shipment_items table in Supabase
        if (newShipment.items && newShipment.items.length > 0) {
          try {
            const shipmentItemsRows = formatShipmentItemsForDb(newShipment, inventoryUnits, [], currentUser);
            if (shipmentItemsRows.length > 0) {
              await supabase.from('shipment_items').upsert(shipmentItemsRows, { onConflict: 'id' });
            }
          } catch (itErr) {
            console.warn('Direct shipment_items table notice:', itErr.message);
          }
        }

        try {
          await supabase.from('saved_records').delete().eq('id', 'active_packing_manifest_draft');
          setActivePackDraft(null);
          try { localStorage.removeItem('mdc_active_pack_draft'); } catch (e) {}
        } catch (draftDelErr) {
          console.warn('active_packing_manifest_draft delete notice:', draftDelErr.message);
        }

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
          const targetUnitStatus = newShipment.status === 'shipped' || newShipment.status === 'delivered' ? 'shipped' : 'packed';
          
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
              shipped_at: new Date().toISOString()
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
        }
      }
    } else {
      if (broadcastCloudEvent) {
        broadcastCloudEvent('SHIPMENT_SAVED', { shipmentId: newShipment.id });
        broadcastCloudEvent('DRAFT_UPDATED', { count: 0 });
      }
    }

    showToast(isUpdate ? `Shipment ${newShipment.invoice_ref || newShipment.shipment_number} updated` : `Created Packing List Manifest: ${newShipment.invoice_ref || newShipment.shipment_number}`, 'success');
    return newShipment;
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
    saveShipment
  };
}
