import { useState } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { barcodeAudio } from '../utils/barcodeAudio';
import { resolvePartInfo, normalizeInventoryUnits, validateAppleSerialNumber } from '../utils/partResolver';
import { reconcileUnitsWithPackedDrafts, isExplicitlyCleared, canUserDeleteRecord } from '../utils/appContextHelpers';

export function useInventory({
  parts = [],
  setParts,
  _sites = [],
  currentUser,
  showToast,
  broadcastCloudEvent,
  dcIntakeRecords = [],
  setDcIntakeRecords,
  setShipments,
  setCloudSyncStatus
}) {
  const [inventoryUnits, setInventoryUnits] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_inventory');
      let baseUnits = [];
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) baseUnits = parsed;
      }
      if (baseUnits.length === 0) {
        const savedIntakes = localStorage.getItem('mdc_dc_intake_records');
        if (savedIntakes) {
          const parsedIntakes = JSON.parse(savedIntakes);
          if (Array.isArray(parsedIntakes)) {
            parsedIntakes.forEach(rec => {
              if (Array.isArray(rec.items)) {
                rec.items.forEach(it => {
                  baseUnits.push({
                    id: it.id || `unit-${it.serial_number}`,
                    part_id: it.part_id || `part-${it.part_number}`,
                    part_number: it.part_number,
                    description: it.description || 'Service Replacement Part',
                    serial_number: it.serial_number,
                    current_site_id: 'site-dc',
                    site_code: 'DC-MDC',
                    status: 'in_stock',
                    box_number: 1,
                    received_at: it.received_at || rec.intake_date || new Date().toISOString(),
                    received_by: it.received_by || rec.saved_by_name || 'Warehouse Staff'
                  });
                });
              }
            });
          }
        }
      }
      return reconcileUnitsWithPackedDrafts(baseUnits);
    } catch {
      return [];
    }
  });

  const [purchaseOrders, setPurchaseOrders] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_pos');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [scanLogs, setScanLogs] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_scan_logs');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [repairUsageRecords, setRepairUsageRecords] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_repair_usage');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const logScan = (scanType, partNumber, serialNumber, isValid, errorMessage = null) => {
    const logEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      scan_type: scanType,
      part_number: partNumber,
      serial_number: serialNumber,
      user_name: currentUser?.fullName || 'Staff',
      is_valid: isValid,
      error_message: errorMessage,
      created_at: new Date().toISOString()
    };
    setScanLogs(prev => [logEntry, ...(prev || []).slice(0, 199)]);
  };

  const unmarkDeletedSerials = async (serialsToKeep) => {
    if (!serialsToKeep || serialsToKeep.length === 0) return;
    const serialSetToKeep = new Set(serialsToKeep.map(s => String(s).trim().toUpperCase()));
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      const filtered = localDeleted.filter(s => !serialSetToKeep.has(String(s).trim().toUpperCase()));
      localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(filtered));
    } catch (e) {}

    if (supabase) {
      try {
        const { data: reg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'deleted_unit_serials_registry').maybeSingle();
        if (reg?.snapshot_data?.deletedSerials && Array.isArray(reg.snapshot_data.deletedSerials)) {
          const updatedCloud = reg.snapshot_data.deletedSerials.filter(s => !serialSetToKeep.has(String(s).trim().toUpperCase()));
          await supabase.from('saved_records').upsert({
            id: 'deleted_unit_serials_registry',
            record_type: 'deletion_registry',
            period_label: 'Deleted Unit Serials Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { deletedSerials: updatedCloud },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        }
      } catch (e) {}
    }
  };

  const saveUnitsToSupabase = async (units) => {
    if (!supabase || !units || units.length === 0) return;
    unmarkDeletedSerials(units.map(u => u.serial_number));
    if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
    try {
      let defaultCatId = null;
      const { data: dbCats } = await supabase.from('part_categories').select('id').limit(1);
      if (dbCats && dbCats.length > 0) {
        defaultCatId = dbCats[0].id;
      } else {
        const { data: newCat } = await supabase
          .from('part_categories')
          .insert({ code: 'cat-general', name: 'General Parts' })
          .select('id')
          .maybeSingle();
        defaultCatId = newCat?.id || null;
      }

      let dcSiteId = null;
      const { data: dcSite } = await supabase.from('sites').select('id').or('is_dc.eq.true,code.eq.DC-MDC,code.eq.DC').limit(1).maybeSingle();
      if (dcSite?.id) {
        dcSiteId = dcSite.id;
      } else {
        const { data: anySite } = await supabase.from('sites').select('id').limit(1).maybeSingle();
        if (anySite?.id) {
          dcSiteId = anySite.id;
        } else {
          const { data: newSite } = await supabase
            .from('sites')
            .insert({ code: 'DC-MDC', name: 'Mobile Care Distribution Center', is_dc: true })
            .select('id')
            .maybeSingle();
          dcSiteId = newSite?.id || null;
        }
      }

      const { data: existingParts } = await supabase.from('parts').select('id, part_number');
      const pMap = new Map((existingParts || []).map(p => [p.part_number.toUpperCase(), p.id]));

      const unitRows = [];
      for (const u of units) {
        const cleanPN = String(u.part_number || '').trim().toUpperCase();
        const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
        if (!cleanPN || !cleanSerial) continue;

        let pId = pMap.get(cleanPN);
        if (!pId) {
          const { data: createdPart } = await supabase.from('parts').upsert({
            part_number: cleanPN,
            description: u.description || `Part ${cleanPN}`,
            ...(defaultCatId ? { category_id: defaultCatId } : {})
          }, { onConflict: 'part_number' }).select('id').maybeSingle();
          pId = createdPart?.id;
          if (pId) pMap.set(cleanPN, pId);
        }

        if (pId && dcSiteId) {
          const assign = u.intake_assignment || (u.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
          unitRows.push({
            part_id: pId,
            current_site_id: dcSiteId,
            serial_number: cleanSerial,
            status: u.status || 'in_stock',
            box_number: u.box_number || 1,
            notes: assign,
            received_at: u.received_at || new Date().toISOString()
          });
        }
      }

      if (unitRows.length > 0) {
        await supabase.from('inventory_units').upsert(unitRows, { onConflict: 'serial_number' });
      }

      try {
        let currentInv = [];
        try {
          currentInv = JSON.parse(localStorage.getItem('mdc_inventory') || '[]');
        } catch (e) {}
        const mergedMap = new Map();
        currentInv.forEach(u => {
          const s = String(u.serial_number || '').toUpperCase();
          if (s) mergedMap.set(s, u);
        });
        units.forEach(u => {
          const s = String(u.serial_number || '').toUpperCase();
          if (s) {
            const assign = u.intake_assignment || (u.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
            mergedMap.set(s, {
              id: u.id || `unit-${u.serial_number}`,
              part_id: u.part_id || `part-${u.part_number}`,
              part_number: u.part_number,
              description: u.description || 'Service Replacement Part',
              serial_number: u.serial_number,
              intake_assignment: assign,
              notes: assign,
              current_site_id: 'site-dc',
              site_code: 'DC-MDC',
              status: u.status || 'in_stock',
              box_number: u.box_number || 1,
              received_at: u.received_at || new Date().toISOString(),
              received_by: u.received_by || currentUser?.fullName || 'Warehouse Staff',
              shipped_at: u.shipped_at || null
            });
          }
        });
        const allPoolUnits = Array.from(mergedMap.values());
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
            units: allPoolUnits
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      } catch (poolErr) {
        console.warn('live_master_dc_inventory sync note:', poolErr.message);
      }

      if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
    } catch (err) {
      console.warn('saveUnitsToSupabase notice:', err.message);
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
    }
  };

  const addScanInUnit = ({ partNumber, serialNumber, poId, intakeAssignment = 'MDC - Forecasting', notes = null }) => {
    const rawPN = String(partNumber || '').trim();
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();

    if (!rawPN || !cleanSerial) {
      barcodeAudio.playError();
      showToast('Scan error: Missing part number or serial number', 'error');
      return { success: false, error: 'Missing part number or serial number' };
    }

    let part = resolvePartInfo(rawPN, parts);
    if (!part) {
      const cleanPN = rawPN.toUpperCase();
      const newPart = {
        id: `part-${cleanPN}`,
        part_number: cleanPN,
        description: `Replacement Part (${cleanPN})`,
        category_id: 'cat-battery',
        iphone_model: 'iPhone Model',
        stocking_price: 100,
        is_active: true
      };
      if (setParts) setParts(prev => [newPart, ...prev]);
      part = newPart;
    }

    const cleanPN = part.part_number;
    const serialValidation = validateAppleSerialNumber(cleanSerial, cleanPN, parts);
    if (!serialValidation.isValid) {
      barcodeAudio.playError();
      showToast(serialValidation.error, 'error');
      logScan('RECEIVE_IN', cleanPN, cleanSerial, false, serialValidation.error);
      return { success: false, error: serialValidation.error, isInvalidSerial: true };
    }

    const validatedSerial = serialValidation.cleanSerial;
    const existingUnit = inventoryUnits.find(u => String(u.serial_number || '').toUpperCase() === validatedSerial);
    if (existingUnit) {
      barcodeAudio.playError();
      showToast(`Duplicate Serial: ${validatedSerial} already exists in DC stock!`, 'error');
      logScan('RECEIVE_IN', cleanPN, validatedSerial, false, 'Duplicate serial number');
      return { success: false, error: `Duplicate serial number: ${validatedSerial}` };
    }

    const effectiveAssignment = intakeAssignment === 'DC - CRBR' ? 'DC - CRBR' : 'MDC - Forecasting';
    const effectiveNotes = notes || effectiveAssignment;

    const newUnit = {
      id: `unit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      part_id: part.id || `part-${part.part_number}`,
      part_number: part.part_number,
      description: part.description,
      category_id: part.category_id,
      serial_number: validatedSerial,
      intake_assignment: effectiveAssignment,
      notes: effectiveNotes,
      current_site_id: 'site-dc',
      site_code: 'DC-MDC',
      po_id: poId || null,
      status: 'in_stock',
      box_number: 1,
      received_at: new Date().toISOString(),
      received_by: currentUser?.fullName || 'Warehouse Staff',
      stocking_price: part.stocking_price || 99
    };

    unmarkDeletedSerials([validatedSerial]);

    setInventoryUnits(prev => {
      const updated = [newUnit, ...(prev || []).filter(u => u.serial_number !== newUnit.serial_number)];
      const normalized = normalizeInventoryUnits(updated, parts);
      try {
        localStorage.removeItem('mdc_is_cleared');
        localStorage.setItem('mdc_inventory', JSON.stringify(normalized));
        localStorage.setItem('mdc_parts', JSON.stringify(parts));
        const currentRecent = JSON.parse(localStorage.getItem('mdc_recent_scans') || '[]');
        const updatedRecent = [newUnit, ...currentRecent.filter(u => u.serial_number !== newUnit.serial_number)].slice(0, 300);
        localStorage.setItem('mdc_recent_scans', JSON.stringify(updatedRecent));
      } catch (e) {
        console.warn('LocalStorage save error:', e);
      }
      dbStorage.setItem('mdc_inventory', normalized);
      return normalized;
    });

    saveUnitsToSupabase([newUnit]);

    if (poId) {
      setPurchaseOrders(prev => prev.map(po => {
        if (po.id === poId) {
          const updatedItems = po.items.map(item => {
            if (item.part_number.toUpperCase() === cleanPN || item.part_number.toUpperCase() === rawPN.toUpperCase()) {
              return { ...item, quantity_received: item.quantity_received + 1 };
            }
            return item;
          });
          const allReceived = updatedItems.every(it => it.quantity_received >= it.quantity_ordered);
          return {
            ...po,
            items: updatedItems,
            status: allReceived ? 'received' : 'partially_received'
          };
        }
        return po;
      }));
    }

    barcodeAudio.playSuccess();
    logScan('RECEIVE_IN', cleanPN, cleanSerial, true);
    showToast(`Received ${part.part_number} — ${part.description} (${cleanSerial})`, 'success');
    return { success: true, unit: newUnit };
  };

  const updateUnitAssignment = async (serialNumber, newAssignment) => {
    if (!serialNumber) return;
    const cleanSerial = String(serialNumber).trim().toUpperCase();
    const effectiveAssignment = String(newAssignment).includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting';

    // Retrieve target unit synchronously from state or local cache to guarantee Supabase persistence
    let currentUnit = (inventoryUnits || []).find(u => String(u.serial_number || '').toUpperCase() === cleanSerial);
    if (!currentUnit) {
      try {
        const localInv = JSON.parse(localStorage.getItem('mdc_inventory') || '[]');
        currentUnit = localInv.find(u => String(u.serial_number || '').toUpperCase() === cleanSerial);
      } catch (e) {}
    }

    const targetUnit = currentUnit
      ? { ...currentUnit, intake_assignment: effectiveAssignment, notes: effectiveAssignment }
      : { serial_number: cleanSerial, intake_assignment: effectiveAssignment, notes: effectiveAssignment };

    setInventoryUnits(prev => {
      const updated = (prev || []).map(u => {
        if (String(u.serial_number || '').toUpperCase() === cleanSerial) {
          return {
            ...u,
            intake_assignment: effectiveAssignment,
            notes: effectiveAssignment
          };
        }
        return u;
      });
      const normalized = normalizeInventoryUnits(updated, parts);
      try {
        localStorage.setItem('mdc_inventory', JSON.stringify(normalized));
        const recent = JSON.parse(localStorage.getItem('mdc_recent_scans') || '[]');
        const updatedRecent = recent.map(u => {
          if (String(u.serial_number || '').toUpperCase() === cleanSerial) {
            return { ...u, intake_assignment: effectiveAssignment, notes: effectiveAssignment };
          }
          return u;
        });
        localStorage.setItem('mdc_recent_scans', JSON.stringify(updatedRecent));
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', normalized);
      return normalized;
    });

    if (setDcIntakeRecords) {
      setDcIntakeRecords(prev => {
        let modified = false;
        const updatedRecords = (prev || []).map(rec => {
          if (Array.isArray(rec.items) && rec.items.some(it => String(it.serial_number || '').toUpperCase() === cleanSerial)) {
            modified = true;
            const updatedItems = rec.items.map(it => {
              if (String(it.serial_number || '').toUpperCase() === cleanSerial) {
                return { ...it, intake_assignment: effectiveAssignment, notes: effectiveAssignment };
              }
              return it;
            });
            const updatedRec = { ...rec, items: updatedItems, updated_at: new Date().toISOString() };
            if (supabase) {
              supabase.from('dc_intake_records').upsert(updatedRec, { onConflict: 'id' }).then(() => {}).catch(() => {});
              const intakeYear = new Date(updatedRec.intake_date || new Date()).getFullYear() || new Date().getFullYear();
              const intakeMonth = (new Date(updatedRec.intake_date || new Date()).getMonth() + 1) || (new Date().getMonth() + 1);
              supabase.from('saved_records').upsert({
                id: updatedRec.id,
                record_type: 'intake_batch',
                period_label: updatedRec.record_name,
                period_year: intakeYear,
                period_month: intakeMonth,
                snapshot_data: updatedRec,
                updated_at: new Date().toISOString()
              }, { onConflict: 'id' }).then(() => {}).catch(() => {});
            }
            return updatedRec;
          }
          return rec;
        });
        if (modified) {
          try { localStorage.setItem('mdc_dc_intake_records', JSON.stringify(updatedRecords)); } catch (e) {}
          dbStorage.setItem('mdc_dc_intake_records', updatedRecords);
        }
        return updatedRecords;
      });
    }

    if (targetUnit) {
      await saveUnitsToSupabase([targetUnit]);
      if (supabase) {
        try {
          await supabase
            .from('inventory_units')
            .update({ notes: effectiveAssignment })
            .eq('serial_number', cleanSerial);
        } catch (e) {}
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('STOCK_UPDATED', {
        serialNumber: cleanSerial,
        assignment: effectiveAssignment,
        table: 'inventory_units'
      });
    }

    showToast(`Updated ${cleanSerial} assignment to "${effectiveAssignment}"`, 'success');
    return { success: true, assignment: effectiveAssignment };
  };

  const batchAddScanInUnits = (itemsList = [], defaultPoId = null, defaultAssignment = 'MDC - Forecasting') => {
    if (!itemsList || itemsList.length === 0) {
      return { success: false, error: 'No units provided to import' };
    }

    let currentParts = [...parts];
    const newUnits = [];
    const newLogs = [];
    const newlyCreatedParts = [];
    const poMap = new Map();

    const seenSerials = new Set();
    const existingInventoryMap = new Map((inventoryUnits || []).map(u => [String(u.serial_number || '').toUpperCase(), u]));

    for (const item of itemsList) {
      const rawPN = String(item.part_number || item.partNumber || '').trim();
      const rawDesc = String(item.description || '').trim();
      const cleanSerial = String(item.serial_number || item.serialNumber || '').trim().toUpperCase();

      if ((!rawPN && !rawDesc) || !cleanSerial) continue;
      if (seenSerials.has(cleanSerial)) continue;
      seenSerials.add(cleanSerial);

      let part = resolvePartInfo(rawPN, currentParts) || resolvePartInfo(rawDesc, currentParts);
      if (!part) {
        const cleanPN = (rawPN || rawDesc).toUpperCase();
        const newPart = {
          id: `part-${cleanPN}`,
          part_number: cleanPN,
          description: rawDesc || `Replacement Part (${cleanPN})`,
          category_id: 'cat-battery',
          iphone_model: 'iPhone Model',
          stocking_price: 100,
          is_active: true
        };
        currentParts = [newPart, ...currentParts];
        newlyCreatedParts.push(newPart);
        part = newPart;
      }

      const cleanPN = part.part_number;
      const serialValidation = validateAppleSerialNumber(cleanSerial, cleanPN, currentParts);
      if (!serialValidation.isValid) continue;
      const validatedSerial = serialValidation.cleanSerial;

      const assignedPoId = item.poId || defaultPoId || null;
      const existingUnit = existingInventoryMap.get(validatedSerial);

      const assignedType = item.intake_assignment || item.intakeAssignment || item.notes || defaultAssignment || 'MDC - Forecasting';
      const effectiveAssignment = String(assignedType).includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting';
      const effectiveNotes = item.notes || effectiveAssignment;

      const processedUnit = {
        id: existingUnit?.id || `unit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        part_id: part.id || `part-${part.part_number}`,
        part_number: part.part_number,
        description: part.description || rawDesc,
        category_id: part.category_id,
        serial_number: validatedSerial,
        intake_assignment: effectiveAssignment,
        notes: effectiveNotes,
        current_site_id: 'site-dc',
        site_code: 'DC-MDC',
        po_id: assignedPoId || existingUnit?.po_id || null,
        status: 'in_stock',
        box_number: item.boxNumber || existingUnit?.box_number || 1,
        received_at: existingUnit?.received_at || new Date().toISOString(),
        received_by: currentUser?.fullName || 'Warehouse Staff (Import)',
        stocking_price: part.stocking_price || 99
      };

      newUnits.push(processedUnit);

      if (assignedPoId) {
        if (!poMap.has(assignedPoId)) {
          poMap.set(assignedPoId, new Map());
        }
        const pnMap = poMap.get(assignedPoId);
        pnMap.set(cleanPN, (pnMap.get(cleanPN) || 0) + 1);
      }

      newLogs.push({
        id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        scan_type: 'RECEIVE_IN_BATCH',
        part_number: cleanPN,
        serial_number: cleanSerial,
        user_name: currentUser?.fullName || 'Warehouse Staff (Import)',
        is_valid: true,
        error_message: null,
        created_at: new Date().toISOString()
      });
    }

    if (newUnits.length === 0) {
      return { success: false, error: 'No valid units found to import' };
    }

    if (newlyCreatedParts.length > 0 && setParts) {
      setParts(currentParts);
    }

    setInventoryUnits(prev => {
      const existingSerialsMap = new Map((prev || []).map(u => [String(u.serial_number || '').toUpperCase(), u]));
      newUnits.forEach(u => existingSerialsMap.set(String(u.serial_number || '').toUpperCase(), u));
      const updated = Array.from(existingSerialsMap.values());
      try {
        localStorage.removeItem('mdc_is_cleared');
        localStorage.setItem('mdc_inventory', JSON.stringify(updated));
        localStorage.setItem('mdc_parts', JSON.stringify(currentParts));
        const currentRecent = JSON.parse(localStorage.getItem('mdc_recent_scans') || '[]');
        const recentMap = new Map(currentRecent.map(u => [String(u.serial_number || '').toUpperCase(), u]));
        newUnits.forEach(u => recentMap.set(String(u.serial_number || '').toUpperCase(), { ...u, isImported: true }));
        localStorage.setItem('mdc_recent_scans', JSON.stringify(Array.from(recentMap.values()).slice(0, 500)));
      } catch (e) {
        console.warn('LocalStorage batch save error:', e);
      }
      dbStorage.setItem('mdc_inventory', updated);
      return updated;
    });

    saveUnitsToSupabase(newUnits);

    if (poMap.size > 0) {
      setPurchaseOrders(prev => prev.map(po => {
        if (poMap.has(po.id)) {
          const pnIncrements = poMap.get(po.id);
          const updatedItems = po.items.map(it => {
            const inc = pnIncrements.get(it.part_number.toUpperCase()) || 0;
            if (inc > 0) {
              return { ...it, quantity_received: it.quantity_received + inc };
            }
            return it;
          });
          const allReceived = updatedItems.every(it => it.quantity_received >= it.quantity_ordered);
          return {
            ...po,
            items: updatedItems,
            status: allReceived ? 'received' : 'partially_received'
          };
        }
        return po;
      }));
    }

    setScanLogs(prev => [...newLogs, ...(prev || [])].slice(0, 200));
    if (broadcastCloudEvent) broadcastCloudEvent('UNITS_IMPORTED', { count: newUnits.length });

    barcodeAudio.playSuccess();
    showToast(`Successfully imported ${newUnits.length} parts into DC Stock!`, 'success');
    return { success: true, count: newUnits.length, units: newUnits };
  };

  const commitUnitsToStock = async (unitsList = []) => {
    let targetUnits = unitsList;
    if (!targetUnits || targetUnits.length === 0) {
      targetUnits = inventoryUnits;
    }
    if (!targetUnits || targetUnits.length === 0) {
      targetUnits = (dcIntakeRecords || []).flatMap(r => Array.isArray(r.items) ? r.items : []);
    }
    if (!targetUnits || targetUnits.length === 0) {
      showToast('No units found to add to stock', 'error');
      return { success: false, error: 'No units found' };
    }

    const nowIso = new Date().toISOString();
    const resolvedUnits = targetUnits.map(u => {
      const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
      const rawPN = String(u.part_number || '').trim();
      const rawDesc = String(u.description || '').trim();
      const part = resolvePartInfo(rawPN, parts) || resolvePartInfo(rawDesc, parts);

      return {
        ...u,
        id: u.id || `unit-${cleanSerial}`,
        part_id: part?.id || u.part_id || `part-${part?.part_number || rawPN}`,
        part_number: part?.part_number || rawPN,
        description: part?.description || rawDesc || 'Service Replacement Part',
        category_id: part?.category_id || u.category_id,
        serial_number: cleanSerial,
        current_site_id: 'site-dc',
        site_code: 'DC-MDC',
        status: 'in_stock',
        box_number: 1,
        received_at: u.received_at || nowIso,
        received_by: u.received_by || currentUser?.fullName || 'Warehouse Staff',
        stocking_price: part?.stocking_price || u.stocking_price || 99,
        shipped_at: null,
        shipped_by: null
      };
    });
    const finalUnits = normalizeInventoryUnits(resolvedUnits, parts);

    let allUpdatedUnits = [];
    setInventoryUnits(prev => {
      const map = new Map((prev || []).map(u => [String(u.serial_number || '').toUpperCase(), u]));
      finalUnits.forEach(u => map.set(String(u.serial_number).toUpperCase(), u));
      allUpdatedUnits = Array.from(map.values());
      try {
        localStorage.removeItem('mdc_is_cleared');
        localStorage.setItem('mdc_inventory', JSON.stringify(allUpdatedUnits));
        localStorage.removeItem('mdc_recent_scans');
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', allUpdatedUnits);
      return allUpdatedUnits;
    });

    saveUnitsToSupabase(finalUnits);
    if (broadcastCloudEvent) broadcastCloudEvent('STOCK_UPDATED', { count: finalUnits.length });

    barcodeAudio.playSuccess();
    showToast(`Successfully added ${finalUnits.length} parts to DC In-Stock! Visible for packing list creation across all accounts.`, 'success');
    return { success: true, count: finalUnits.length, units: finalUnits };
  };

  const deleteScanInUnit = async (serialNumber) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    const existing = (inventoryUnits || []).find(u => String(u.serial_number || '').toUpperCase() === cleanSerial);

    // Authority Rule: Only the user who originally received/saved the unit has permission to delete it
    if (existing && !canUserDeleteRecord(existing, currentUser)) {
      const creatorName = existing.received_by_name || existing.received_by || existing.saved_by_name || 'the original user';
      showToast(`Permission Denied: Only ${creatorName} can delete this stock part.`, 'error');
      return { success: false, error: `Permission Denied: Only ${creatorName} can delete this part.` };
    }

    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      const updatedDeleted = Array.from(new Set([...localDeleted, cleanSerial]));
      localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(updatedDeleted));
    } catch (e) {}

    let nextUnits = [];
    setInventoryUnits(prev => {
      nextUnits = (prev || []).filter(u => String(u.serial_number || '').toUpperCase() !== cleanSerial);
      try {
        localStorage.setItem('mdc_inventory', JSON.stringify(nextUnits));
        const recent = JSON.parse(localStorage.getItem('mdc_recent_scans') || '[]');
        const filteredRecent = recent.filter(u => String(u.serial_number || '').toUpperCase() !== cleanSerial);
        localStorage.setItem('mdc_recent_scans', JSON.stringify(filteredRecent));
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', nextUnits);
      return nextUnits;
    });

    let updatedRecords = [];
    const recordsToUpdateInDb = [];
    if (setDcIntakeRecords) {
      setDcIntakeRecords(prev => {
        updatedRecords = (prev || []).map(rec => {
          if (Array.isArray(rec.items) && rec.items.some(it => String(it.serial_number || '').toUpperCase() === cleanSerial)) {
            const filteredItems = rec.items.filter(it => String(it.serial_number || '').toUpperCase() !== cleanSerial);
            const updatedRec = {
              ...rec,
              items: filteredItems,
              total_units: filteredItems.length,
              updated_at: new Date().toISOString()
            };
            recordsToUpdateInDb.push(updatedRec);
            return updatedRec;
          }
          return rec;
        });
        try {
          localStorage.setItem('mdc_dc_intake_records', JSON.stringify(updatedRecords));
        } catch (e) {}
        dbStorage.setItem('mdc_dc_intake_records', updatedRecords);
        return updatedRecords;
      });
    }

    if (supabase) {
      (async () => {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          const { data: reg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'deleted_unit_serials_registry').maybeSingle();
          const cloudDeleted = reg?.snapshot_data?.deletedSerials || [];
          const updatedCloudDeleted = Array.from(new Set([...cloudDeleted, cleanSerial]));

          await supabase.from('saved_records').upsert({
            id: 'deleted_unit_serials_registry',
            record_type: 'deletion_registry',
            period_label: 'Deleted Unit Serials Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { deletedSerials: updatedCloudDeleted },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

          try { await supabase.from('inventory_units').update({ is_deleted: true }).eq('serial_number', cleanSerial); } catch (e) {}
          try { await supabase.from('inventory_units').delete().eq('serial_number', cleanSerial); } catch (e) {}

          await supabase.from('saved_records').upsert({
            id: 'live_master_dc_inventory',
            record_type: 'inventory_master',
            period_label: 'Live Master DC Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { units: nextUnits },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

          for (const rec of recordsToUpdateInDb) {
            try {
              await supabase.from('dc_intake_records').upsert(rec, { onConflict: 'id' });
              const rYear = new Date(rec.intake_date || new Date()).getFullYear() || new Date().getFullYear();
              const rMonth = (new Date(rec.intake_date || new Date()).getMonth() + 1) || (new Date().getMonth() + 1);
              await supabase.from('saved_records').upsert({
                id: rec.id,
                record_type: 'intake_batch',
                period_label: rec.record_name,
                period_year: rYear,
                period_month: rMonth,
                snapshot_data: rec,
                updated_at: new Date().toISOString()
              }, { onConflict: 'id' });
            } catch (e) {}
          }

          if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
          if (broadcastCloudEvent) broadcastCloudEvent('UNIT_DELETED', { serialNumber: cleanSerial });
        } catch (dbErr) {
          console.warn('Supabase delete inventory_unit notice:', dbErr.message);
          if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('UNIT_DELETED', { serialNumber: cleanSerial });
    }

    if (existing?.po_id) {
      setPurchaseOrders(prev => prev.map(po => {
        if (po.id === existing.po_id) {
          const updatedItems = (po.items || []).map(it => {
            if (existing?.part_number && it.part_number.toUpperCase() === existing.part_number.toUpperCase() && it.quantity_received > 0) {
              return { ...it, quantity_received: it.quantity_received - 1 };
            }
            return it;
          });
          const allReceived = updatedItems.every(it => it.quantity_received >= it.quantity_ordered);
          const anyReceived = updatedItems.some(it => it.quantity_received > 0);
          return {
            ...po,
            items: updatedItems,
            status: allReceived ? 'received' : anyReceived ? 'partially_received' : 'ordered'
          };
        }
        return po;
      }));
    }

    if (broadcastCloudEvent) broadcastCloudEvent('STOCK_UPDATED', { serial: cleanSerial });
    logScan('DELETE_RECEIVED_UNIT', existing?.part_number || 'PART', cleanSerial, true, 'Manually deleted by operator');
    barcodeAudio.playSuccess();
    showToast(`Deleted part ${existing?.part_number || 'unit'} (${cleanSerial}) from inventory and database`, 'info');
    return { success: true };
  };

  const addScanOutUnit = ({ shipmentId, siteId, partNumber, serialNumber, boxNumber = 1 }) => {
    const cleanPN = partNumber.trim().toUpperCase();
    const cleanSerial = serialNumber.trim().toUpperCase();

    const unitIndex = inventoryUnits.findIndex(u => 
      u.serial_number.toUpperCase() === cleanSerial && 
      u.part_number.toUpperCase() === cleanPN
    );

    if (unitIndex === -1) {
      barcodeAudio.playError();
      showToast(`Unit not found in stock: ${cleanPN} / ${cleanSerial}`, 'error');
      logScan('PACK_OUT', cleanPN, cleanSerial, false, 'Unit not found in stock');
      return { success: false, error: 'Unit not found in DC stock' };
    }

    const unit = inventoryUnits[unitIndex];
    if (unit.status !== 'in_stock' && unit.status !== 'allocated') {
      barcodeAudio.playError();
      showToast(`Unit ${cleanSerial} cannot be scanned out (Status: ${unit.status})`, 'error');
      logScan('PACK_OUT', cleanPN, cleanSerial, false, `Invalid status: ${unit.status}`);
      return { success: false, error: `Unit is already ${unit.status}` };
    }

    const updatedUnits = [...inventoryUnits];
    updatedUnits[unitIndex] = {
      ...unit,
      status: 'packed',
      current_site_id: siteId,
      box_number: boxNumber,
      shipped_at: new Date().toISOString(),
      shipped_by: currentUser?.fullName || 'Warehouse Staff'
    };
    setInventoryUnits(updatedUnits);
    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(updatedUnits));
    } catch (e) {
      console.warn('LocalStorage save error in addScanOutUnit:', e);
    }
    dbStorage.setItem('mdc_inventory', updatedUnits);

    if (supabase) {
      (async () => {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          await supabase
            .from('inventory_units')
            .upsert({
              part_id: unit.part_id,
              serial_number: cleanSerial,
              status: 'packed',
              box_number: boxNumber,
              current_site_id: siteId || 'site-dc',
              shipped_at: new Date().toISOString()
            }, { onConflict: 'serial_number' });
          if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        } catch (dbErr) {
          console.warn('Supabase pack unit note:', dbErr.message);
          if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    const itemToAdd = {
      part_number: unit.part_number,
      description: unit.description,
      serial_number: unit.serial_number,
      box_number: boxNumber
    };

    if (setShipments) {
      setShipments(prev => prev.map(sh => {
        if (sh.id === shipmentId) {
          return {
            ...sh,
            items: [...(sh.items || []), itemToAdd]
          };
        }
        return sh;
      }));
    }

    if (broadcastCloudEvent) broadcastCloudEvent('UNIT_PACKED', { serialNumber: cleanSerial });

    barcodeAudio.playSuccess();
    logScan('PACK_OUT', cleanPN, cleanSerial, true);
    showToast(`Packed: ${unit.description} (#${cleanSerial}) into Box ${boxNumber}`, 'success');
    return { success: true, item: itemToAdd };
  };

  const batchAddScanOutUnits = ({ shipmentId, siteId, items }) => {
    if (!items || items.length === 0) {
      return { success: false, error: 'No items to pack' };
    }

    const itemsToAdd = [];
    const newLogs = [];
    const updatedSerialsMap = new Map();

    for (const item of items) {
      const cleanPN = String(item.partNumber || '').trim().toUpperCase();
      const cleanSerial = String(item.serialNumber || '').trim().toUpperCase();
      const box = item.boxNumber || 1;
      const targetSiteId = item.siteId || siteId;

      const unit = inventoryUnits.find(u =>
        u.serial_number.toUpperCase() === cleanSerial &&
        (u.status === 'in_stock' || u.status === 'allocated')
      );

      if (unit) {
        updatedSerialsMap.set(unit.serial_number.toUpperCase(), {
          ...unit,
          status: 'packed',
          current_site_id: targetSiteId,
          box_number: box,
          shipped_at: new Date().toISOString(),
          shipped_by: currentUser?.fullName || 'Warehouse Staff (Import)'
        });

        itemsToAdd.push({
          part_number: unit.part_number,
          description: unit.description,
          serial_number: unit.serial_number,
          box_number: box
        });

        newLogs.push({
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          scan_type: 'PACK_OUT_BATCH',
          part_number: cleanPN || unit.part_number,
          serial_number: cleanSerial,
          user_name: currentUser?.fullName || 'Warehouse Staff (Import)',
          is_valid: true,
          error_message: null,
          created_at: new Date().toISOString()
        });
      }
    }

    if (itemsToAdd.length === 0) {
      return { success: false, error: 'No matching in-stock units found to pack.' };
    }

    const updatedInventory = inventoryUnits.map(u => {
      const match = updatedSerialsMap.get(u.serial_number.toUpperCase());
      return match ? match : u;
    });
    setInventoryUnits(updatedInventory);
    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory));
    } catch (e) {
      console.warn('LocalStorage save error in batchAddScanOutUnits:', e);
    }
    dbStorage.setItem('mdc_inventory', updatedInventory);

    if (supabase) {
      (async () => {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          const rowsToUpsert = itemsToAdd.map(it => {
            const matchUnit = updatedSerialsMap.get(it.serial_number.toUpperCase());
            return {
              part_id: matchUnit?.part_id || `part-${it.part_number}`,
              serial_number: it.serial_number,
              status: 'packed',
              box_number: it.box_number || 1,
              current_site_id: siteId || 'site-dc',
              shipped_at: new Date().toISOString()
            };
          });
          await supabase
            .from('inventory_units')
            .upsert(rowsToUpsert, { onConflict: 'serial_number' });
          if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        } catch (dbErr) {
          console.warn('Supabase batch pack note:', dbErr.message);
          if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    let targetShipmentNumber = '';
    if (setShipments) {
      setShipments(prev => prev.map(sh => {
        if (sh.id === shipmentId) {
          targetShipmentNumber = sh.invoice_ref || sh.shipment_number;
          return {
            ...sh,
            items: [...(sh.items || []), ...itemsToAdd]
          };
        }
        return sh;
      }));
    }

    setScanLogs(prev => [...newLogs, ...(prev || [])].slice(0, 300));
    if (broadcastCloudEvent) broadcastCloudEvent('UNITS_BATCH_PACKED', { count: itemsToAdd.length });

    barcodeAudio.playSuccess();
    showToast(`Batch packed ${itemsToAdd.length} units into ${targetShipmentNumber || 'Shipment'}!`, 'success');
    return { success: true, count: itemsToAdd.length, items: itemsToAdd };
  };

  const removeScanOutUnit = ({ shipmentId, serialNumber }) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) return { success: false };

    let revertedPart = null;
    const updatedInventory = inventoryUnits.map(u => {
      if (u.serial_number && u.serial_number.toUpperCase() === cleanSerial) {
        revertedPart = u;
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

    if (setShipments) {
      setShipments(prev => prev.map(sh => {
        if (sh.id === shipmentId) {
          return {
            ...sh,
            items: (sh.items || []).filter(it => String(it.serial_number || '').toUpperCase() !== cleanSerial)
          };
        }
        return sh;
      }));
    }

    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory));
    } catch (e) {
      console.warn('LocalStorage save error in removeScanOutUnit:', e);
    }
    dbStorage.setItem('mdc_inventory', updatedInventory);

    if (supabase) {
      (async () => {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          let dcSiteId = null;
          const { data: dcSite } = await supabase.from('sites').select('id').or('is_dc.eq.true,code.eq.DC-MDC,code.eq.DC').limit(1).maybeSingle();
          if (dcSite?.id) dcSiteId = dcSite.id;
          else {
            const { data: anySite } = await supabase.from('sites').select('id').limit(1).maybeSingle();
            dcSiteId = anySite?.id;
          }

          if (dcSiteId) {
            await supabase
              .from('inventory_units')
              .update({
                status: 'in_stock',
                current_site_id: dcSiteId,
                box_number: 1,
                shipped_at: null,
                shipped_by: null
              })
              .eq('serial_number', cleanSerial);
          }
          if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        } catch (dbErr) {
          console.warn('Supabase unit revert error:', dbErr.message);
          if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    if (broadcastCloudEvent) broadcastCloudEvent('UNIT_UNPACKED', { serialNumber: cleanSerial });

    showToast(`Removed #${cleanSerial} from packing list. Returned to DC In-Stock inventory.`, 'info');
    return { success: true, unit: revertedPart };
  };

  const deleteAllStockUnits = async () => {
    const allSerialsToDelete = new Set();
    (inventoryUnits || []).forEach(u => { if (u.serial_number) allSerialsToDelete.add(String(u.serial_number).toUpperCase()); });
    (dcIntakeRecords || []).forEach(r => {
      if (Array.isArray(r.items)) {
        r.items.forEach(it => { if (it.serial_number) allSerialsToDelete.add(String(it.serial_number).toUpperCase()); });
      }
    });

    const deletedSerialsArray = Array.from(allSerialsToDelete);

    try {
      const existingDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      const updatedDeleted = Array.from(new Set([...existingDeleted, ...deletedSerialsArray]));
      localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(updatedDeleted));
      localStorage.setItem('mdc_inventory', '[]');
      localStorage.setItem('mdc_dc_intake_records', '[]');
      localStorage.removeItem('mdc_recent_scans');
      localStorage.removeItem('mdc_is_cleared');
      localStorage.removeItem('mdc_deleted_intake_ids');
    } catch (e) {}

    setInventoryUnits([]);
    if (setDcIntakeRecords) setDcIntakeRecords([]);
    dbStorage.setItem('mdc_inventory', []);
    dbStorage.setItem('mdc_dc_intake_records', []);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        await supabase.from('saved_records').upsert({
          id: 'deleted_unit_serials_registry',
          record_type: 'deletion_registry',
          period_label: 'Deleted Unit Serials Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Global registry of purged stock unit serial numbers',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: { deletedSerials: deletedSerialsArray },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        await supabase.from('saved_records').upsert({
          id: 'live_master_dc_inventory',
          record_type: 'both',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Cleared stock parts for testing',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: { units: [] },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        await supabase.from('saved_records').upsert({
          id: 'master_dc_intakes_registry',
          record_type: 'intake_registry',
          period_label: 'Master DC Intakes Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Cleared intake records for testing',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: { records: [] },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        try { await supabase.from('saved_records').delete().eq('record_type', 'intake_batch'); } catch (e) {}
        try { await supabase.from('saved_records').delete().eq('record_type', 'intake_record'); } catch (e) {}

        try {
          const { data: mdcRecs } = await supabase.from('saved_records').select('id');
          if (Array.isArray(mdcRecs)) {
            const mdcIds = mdcRecs.filter(r => r.id && (r.id.startsWith('MDC') || r.id.startsWith('intake-'))).map(r => r.id);
            if (mdcIds.length > 0) {
              await supabase.from('saved_records').delete().in('id', mdcIds);
            }
          }
        } catch (e) {}

        try { await supabase.from('inventory_units').delete().neq('id', '00000000-0000-0000-0000-000000000000'); } catch (e) {}
        try { await supabase.from('dc_intake_records').delete().neq('id', '00000000-0000-0000-0000-000000000000'); } catch (e) {}

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('STOCK_UNITS_CLEARED', { timestamp: new Date().toISOString() });
      } catch (err) {
        console.error('deleteAllStockUnits error:', err);
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('STOCK_UNITS_CLEARED', { timestamp: new Date().toISOString() });
    }

    showToast('Deleted all stock parts & intake records for testing!', 'success');
    return { success: true };
  };

  return {
    inventoryUnits,
    setInventoryUnits,
    scanLogs,
    setScanLogs,
    purchaseOrders,
    setPurchaseOrders,
    repairUsageRecords,
    setRepairUsageRecords,
    addScanInUnit,
    deleteScanInUnit,
    updateUnitAssignment,
    batchAddScanInUnits,
    commitUnitsToStock,
    addScanOutUnit,
    removeScanOutUnit,
    batchAddScanOutUnits,
    deleteAllStockUnits,
    unmarkDeletedSerials,
    saveUnitsToSupabase,
    logScan
  };
}
