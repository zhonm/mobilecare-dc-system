import { useState } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { barcodeAudio } from '../utils/barcodeAudio';
import { resolvePartInfo, normalizeInventoryUnits, validateAppleSerialNumber } from '../utils/partResolver';
import { reconcileUnitsWithPackedDrafts, isExplicitlyCleared, canUserDeleteRecord, formatDcIntakeRecordForDb, isUUID, toValidUUID } from '../utils/appContextHelpers';

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

      // Load deleted serials FIRST to filter them out immediately (prevents ghost flash on refresh)
      let deletedSerialsSet = new Set();
      try {
        const deletedSerials = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
        deletedSerialsSet = new Set(deletedSerials.map(s => String(s).trim().toUpperCase()));
      } catch (e) {}

      const saved = localStorage.getItem('mdc_inventory');
      let baseUnits = [];
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) baseUnits = parsed;
      }

      // Filter out deleted serials before reconciliation (prevents ghost reappearance)
      const filtered = baseUnits.filter(u => {
        const s = String(u.serial_number || '').trim().toUpperCase();
        return !s || !deletedSerialsSet.has(s);
      });

      return reconcileUnitsWithPackedDrafts(filtered);
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

  const [masterlistData, setMasterlistData] = useState(() => {
    try {
      if (isExplicitlyCleared()) return null;
      const saved = localStorage.getItem('mdc_masterlist_data');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.totalUnits !== undefined) return parsed;
      }
      return null;
    } catch {
      return null;
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

      // Fetch all sites to resolve UUIDs accurately
      const { data: dbSites } = await supabase.from('sites').select('id, code, name, is_dc');
      const siteList = dbSites || [];

      let dcSiteId = null;
      const dcSite = siteList.find(s => s.is_dc || s.code === 'DC-MDC' || s.code === 'DC');
      if (dcSite?.id) {
        dcSiteId = dcSite.id;
      } else if (siteList[0]?.id) {
        dcSiteId = siteList[0].id;
      }

      const { data: existingParts } = await supabase.from('parts').select('id, part_number');
      const pMap = new Map((existingParts || []).map(p => [p.part_number.toUpperCase(), p.id]));

      // Batch create any missing parts in a single query
      const missingPartsMap = new Map();
      for (const u of units) {
        const cleanPN = String(u.part_number || '').trim().toUpperCase();
        if (cleanPN && !pMap.has(cleanPN) && !missingPartsMap.has(cleanPN)) {
          missingPartsMap.set(cleanPN, {
            part_number: cleanPN,
            description: u.description || `Part ${cleanPN}`,
            ...(defaultCatId ? { category_id: defaultCatId } : {})
          });
        }
      }

      if (missingPartsMap.size > 0) {
        try {
          const { data: createdParts } = await supabase.from('parts').upsert(
            Array.from(missingPartsMap.values()),
            { onConflict: 'part_number' }
          ).select('id, part_number');
          (createdParts || []).forEach(p => {
            if (p.part_number && p.id) pMap.set(p.part_number.toUpperCase(), p.id);
          });
        } catch (err) {
          console.warn('Batch parts upsert notice:', err.message);
        }
      }

      const unitRows = [];
      for (const u of units) {
        const cleanPN = String(u.part_number || '').trim().toUpperCase();
        const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
        if (!cleanPN || !cleanSerial) continue;

        const pId = pMap.get(cleanPN);

        // Resolve Target Site UUID: match against Supabase sites by ID, code, or name
        const unitSiteKey = String(u.current_site_id || u.site_id || u.targetSiteId || '').trim();
        const unitSiteCode = String(u.site_code || '').trim().toUpperCase();
        const matchedSite = siteList.find(s =>
          (unitSiteKey && (s.id === unitSiteKey || s.code.toUpperCase() === unitSiteKey.toUpperCase())) ||
          (unitSiteCode && s.code.toUpperCase() === unitSiteCode)
        );

        const targetSiteId = matchedSite?.id || (isUUID(unitSiteKey) ? unitSiteKey : dcSiteId);

        if (pId && targetSiteId) {
          const assign = u.intake_assignment || u.notes || (u.notes?.includes('SVNR') ? 'SVNR - Service Non-Repair' : u.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
          unitRows.push({
            part_id: pId,
            current_site_id: targetSiteId,
            serial_number: cleanSerial,
            status: u.status || 'in_stock',
            box_number: u.box_number || 1,
            notes: assign,
            received_at: u.received_at || new Date().toISOString()
          });
        }
      }

      if (unitRows.length > 0) {
        const uniqueUnitRows = Array.from(new Map(unitRows.map(r => [r.serial_number.trim().toUpperCase(), r])).values());
        const { error: upsertErr } = await supabase.from('inventory_units').upsert(uniqueUnitRows, { onConflict: 'serial_number' });
        if (upsertErr) {
          console.warn('inventory_units upsert notice:', upsertErr.message);
        }
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
            const assign = u.intake_assignment || u.notes || (u.notes?.includes('SVNR') ? 'SVNR - Service Non-Repair' : u.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
            mergedMap.set(s, {
              id: u.id || `unit-${u.serial_number}`,
              part_id: u.part_id || `part-${u.part_number}`,
              part_number: u.part_number,
              description: u.description || 'Service Replacement Part',
              serial_number: u.serial_number,
              intake_assignment: assign,
              notes: assign,
              current_site_id: u.current_site_id || 'site-dc',
              site_code: u.site_code || 'DC-MDC',
              site_name: u.site_name || null,
              status: u.status || 'in_stock',
              box_number: u.box_number || 1,
              received_at: u.received_at || new Date().toISOString(),
              received_by: u.received_by || currentUser?.fullName || 'Warehouse Staff',
              received_by_id: u.received_by_id || currentUser?.id || null,
              added_by_user_id: u.added_by_user_id || currentUser?.id || null,
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
          notes: 'Master In-Stock inventory pool across all accounts',
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

  const addScanInUnit = ({
    partNumber,
    serialNumber,
    poId,
    intakeAssignment = 'MDC - Forecasting',
    notes = null,
    targetSiteId = null,
    targetSiteCode = null,
    targetSiteName = null
  }) => {
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
      // Block generic dummy placeholders from being treated as part numbers
      if (cleanPN === 'PART' || cleanPN === 'PART-UNKNOWN' || cleanPN === 'UNKNOWN' || !/^[0-9]{3}-?[0-9]{4,6}$/i.test(cleanPN)) {
        barcodeAudio.playError();
        showToast(`Invalid Part Number "${rawPN}". Please scan or enter a valid Apple Part Number (661-xxxxx).`, 'error');
        return { success: false, error: `Invalid Part Number "${rawPN}". Please scan a valid Apple Part Number (661-xxxxx).` };
      }
      const newPart = {
        id: `part-${cleanPN}`,
        part_number: cleanPN,
        description: `Apple Genuine Part (${cleanPN})`,
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
    const resolvedSiteId = targetSiteId || currentUser?.siteId || 'site-dc';
    const resolvedSiteCode = targetSiteCode || (currentUser?.siteId ? (currentUser.siteCode || 'BRANCH') : 'DC-MDC');
    const isDcDest = resolvedSiteId === 'site-dc' || resolvedSiteCode === 'DC-MDC' || resolvedSiteCode === 'DC' || (!resolvedSiteId && !resolvedSiteCode);

    const existingUnit = inventoryUnits.find(u => {
      if (String(u.serial_number || '').toUpperCase() !== validatedSerial) return false;
      if (u.status !== 'in_stock' && u.status) return false;
      if (isDcDest) {
        return u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
      }
      return u.current_site_id === resolvedSiteId || u.site_code === resolvedSiteCode;
    });

    if (existingUnit) {
      barcodeAudio.playError();
      showToast(`Duplicate Serial: ${validatedSerial} already exists in ${isDcDest ? 'DC stock' : resolvedSiteCode}!`, 'error');
      logScan('RECEIVE_IN', cleanPN, validatedSerial, false, 'Duplicate serial number');
      return { success: false, error: `Duplicate serial number: ${validatedSerial}` };
    }

    const effectiveAssignment = intakeAssignment === 'SVNR - Service Non-Repair' || String(intakeAssignment).includes('SVNR')
      ? 'SVNR - Service Non-Repair'
      : intakeAssignment === 'DC - CRBR' || String(intakeAssignment).includes('CRBR')
      ? 'DC - CRBR'
      : 'MDC - Forecasting';
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
      current_site_id: resolvedSiteId,
      site_code: resolvedSiteCode,
      site_name: targetSiteName || null,
      po_id: poId || null,
      status: 'in_stock',
      box_number: 1,
      received_at: new Date().toISOString(),
      received_by: currentUser?.fullName || 'Warehouse Staff',
      received_by_id: currentUser?.id || null,
      added_by_user_id: currentUser?.id || null,
      created_by_site_id: currentUser?.siteId || resolvedSiteId,
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
        localStorage.removeItem('mdc_recent_scans');
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
    const effectiveAssignment = String(newAssignment).includes('SVNR')
      ? 'SVNR - Service Non-Repair'
      : String(newAssignment).includes('CRBR')
      ? 'DC - CRBR'
      : 'MDC - Forecasting';

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
        localStorage.removeItem('mdc_recent_scans');
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
              const formattedRow = formatDcIntakeRecordForDb(updatedRec, currentUser);
              if (formattedRow) {
                supabase.from('dc_intake_records').upsert(formattedRow, { onConflict: 'id' }).then(() => {}).catch(() => {});
              }
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

    if (supabase) {
      try {
        const { error: updateErr } = await supabase
          .from('inventory_units')
          .update({
            notes: effectiveAssignment,
            updated_at: new Date().toISOString()
          })
          .eq('serial_number', cleanSerial);
        if (updateErr) {
          console.warn('Supabase inventory_units assignment update notice:', updateErr.message);
        }
      } catch (e) {
        console.error('Supabase assignment update error:', e.message);
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

  const updateUnitDetails = async (serialNumber, updates = {}) => {
    if (!serialNumber) return { success: false, error: 'Missing serial number' };
    const cleanSerial = String(serialNumber).trim().toUpperCase();

    let updatedUnit = null;
    setInventoryUnits(prev => {
      const updated = (prev || []).map(u => {
        if (String(u.serial_number || '').toUpperCase() === cleanSerial) {
          updatedUnit = {
            ...u,
            box_number: updates.box_number !== undefined ? updates.box_number : (updates.boxNumber !== undefined ? updates.boxNumber : u.box_number),
            notes: updates.notes !== undefined ? updates.notes : u.notes,
            work_order_number: updates.work_order_number !== undefined ? updates.work_order_number : u.work_order_number,
            status: updates.status !== undefined ? updates.status : u.status
          };
          return updatedUnit;
        }
        return u;
      });
      const normalized = normalizeInventoryUnits(updated, parts);
      try {
        localStorage.setItem('mdc_inventory', JSON.stringify(normalized));
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', normalized);
      return normalized;
    });

    if (supabase) {
      try {
        await supabase.from('inventory_units').update({
          box_number: updates.box_number || updates.boxNumber,
          notes: updates.notes,
          work_order_number: updates.work_order_number,
          status: updates.status
        }).eq('serial_number', cleanSerial);
      } catch (e) {
        console.warn('updateUnitDetails cloud sync notice:', e.message);
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('STOCK_UPDATED', {
        serialNumber: cleanSerial,
        updates,
        table: 'inventory_units'
      });
    }

    showToast(`Updated part details for serial #${cleanSerial}`, 'success');
    return { success: true, unit: updatedUnit };
  };

  const batchAddScanInUnits = (
    itemsList = [],
    defaultPoId = null,
    defaultAssignment = 'MDC - Forecasting',
    targetSiteId = null,
    targetSiteCode = null,
    targetSiteName = null
  ) => {
    if (!itemsList || itemsList.length === 0) {
      return { success: false, error: 'No units provided to import' };
    }

    let currentParts = [...parts];
    const newUnits = [];
    const newLogs = [];
    const newlyCreatedParts = [];
    const poMap = new Map();

    const seenSerials = new Set();
    const resolvedSiteId = targetSiteId || currentUser?.siteId || 'site-dc';
    const resolvedSiteCode = targetSiteCode || (currentUser?.siteId ? (currentUser.siteCode || 'BRANCH') : 'DC-MDC');
    const isDcDest = resolvedSiteId === 'site-dc' || resolvedSiteCode === 'DC-MDC' || resolvedSiteCode === 'DC' || (!resolvedSiteId && !resolvedSiteCode);

    const siteInventoryUnits = (inventoryUnits || []).filter(u => {
      if (isDcDest) {
        return u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
      }
      return u.current_site_id === resolvedSiteId || u.site_code === resolvedSiteCode;
    });
    const existingInventoryMap = new Map(siteInventoryUnits.map(u => [String(u.serial_number || '').toUpperCase(), u]));

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

      const assignedType = item.intake_assignment || item.intakeAssignment || item.notes || defaultAssignment || (isDcDest ? 'MDC - Forecasting' : 'Branch Stock');
      const effectiveAssignment = isDcDest
        ? (String(assignedType).includes('SVNR')
            ? 'SVNR - Service Non-Repair'
            : String(assignedType).includes('CRBR')
            ? 'DC - CRBR'
            : 'MDC - Forecasting')
        : (item.intake_assignment || `${resolvedSiteCode} Stock`);
      const effectiveNotes = item.notes || effectiveAssignment;

      const itemSiteId = item.current_site_id || resolvedSiteId;
      const itemSiteCode = item.site_code || resolvedSiteCode;

      const processedUnit = {
        id: existingUnit?.id || `unit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        part_id: part.id || `part-${part.part_number}`,
        part_number: part.part_number,
        description: part.description || rawDesc,
        category_id: part.category_id,
        serial_number: validatedSerial,
        intake_assignment: effectiveAssignment,
        notes: effectiveNotes,
        current_site_id: itemSiteId,
        site_code: itemSiteCode,
        site_name: targetSiteName || item.site_name || (isDcDest ? 'Distribution Center (DC)' : null),
        po_id: assignedPoId || existingUnit?.po_id || null,
        status: 'in_stock',
        box_number: item.boxNumber || item.box_number || existingUnit?.box_number || 1,
        received_at: existingUnit?.received_at || new Date().toISOString(),
        received_by: currentUser?.fullName || (isDcDest ? 'Warehouse Staff (Import)' : 'Branch Staff'),
        received_by_id: currentUser?.id || null,
        added_by_user_id: currentUser?.id || null,
        created_by_site_id: itemSiteId,
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
      const otherSitesUnits = (prev || []).filter(u => {
        const uIsDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
        if (isDcDest) return !uIsDc;
        return !(u.current_site_id === resolvedSiteId || u.site_code === resolvedSiteCode);
      });

      const currentSiteSerialsMap = new Map((prev || []).filter(u => {
        const uIsDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
        if (isDcDest) return uIsDc;
        return u.current_site_id === resolvedSiteId || u.site_code === resolvedSiteCode;
      }).map(u => [String(u.serial_number || '').toUpperCase(), u]));

      newUnits.forEach(u => currentSiteSerialsMap.set(String(u.serial_number || '').toUpperCase(), u));
      const updated = [...otherSitesUnits, ...Array.from(currentSiteSerialsMap.values())];
      try {
        localStorage.removeItem('mdc_is_cleared');
        localStorage.setItem('mdc_inventory', JSON.stringify(updated));
        localStorage.setItem('mdc_parts', JSON.stringify(currentParts));
        localStorage.removeItem('mdc_recent_scans');
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

  const deleteScanInUnit = async (serialOrUnit) => {
    let cleanSerial = '';
    let existing = null;

    if (typeof serialOrUnit === 'object' && serialOrUnit !== null) {
      cleanSerial = String(serialOrUnit.serial_number || serialOrUnit.serialNumber || '').trim().toUpperCase();
      existing = serialOrUnit;
    } else {
      const searchKey = String(serialOrUnit || '').trim().toUpperCase();
      existing = (inventoryUnits || []).find(u =>
        String(u.serial_number || '').toUpperCase() === searchKey ||
        String(u.id || '').toUpperCase() === searchKey
      );
      cleanSerial = String(existing?.serial_number || searchKey).trim().toUpperCase();
    }

    if (!existing) {
      try {
        const localInv = JSON.parse(localStorage.getItem('mdc_inventory') || '[]');
        existing = localInv.find(u =>
          String(u.serial_number || '').toUpperCase() === cleanSerial ||
          String(u.id || '').toUpperCase() === cleanSerial
        );
      } catch (e) {}
    }

    if (!cleanSerial) {
      return { success: false, error: 'Invalid or missing serial number' };
    }

    // Authority Rule: Only the user who originally received/saved the unit has permission to delete it
    if (existing && !canUserDeleteRecord(existing, currentUser)) {
      const creatorName = existing.received_by_name || existing.received_by || existing.saved_by_name || 'the original user';
      showToast(`Permission Denied: Only ${creatorName} can delete this stock part.`, 'error');
      return { success: false, error: `Permission Denied: Only ${creatorName} can delete this part.` };
    }

    let updatedDeleted = [];
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      updatedDeleted = Array.from(new Set([...localDeleted, cleanSerial]));
      localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(updatedDeleted));
    } catch (e) {
      updatedDeleted = [cleanSerial];
    }
    dbStorage.setItem('mdc_deleted_unit_serials', updatedDeleted);

    let nextUnits = [];
    setInventoryUnits(prev => {
      nextUnits = (prev || []).filter(u =>
        String(u.serial_number || '').toUpperCase() !== cleanSerial &&
        (!existing?.id || u.id !== existing.id)
      );
      try {
        localStorage.setItem('mdc_inventory', JSON.stringify(nextUnits));
        localStorage.removeItem('mdc_recent_scans');
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
          const updatedCloudDeleted = Array.from(new Set([...cloudDeleted, ...updatedDeleted, cleanSerial]));

          await supabase.from('saved_records').upsert({
            id: 'deleted_unit_serials_registry',
            record_type: 'deletion_registry',
            period_label: 'Deleted Unit Serials Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { deletedSerials: updatedCloudDeleted },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

          try { await supabase.from('inventory_units').update({ is_deleted: true, status: 'deleted' }).eq('serial_number', cleanSerial); } catch (e) {}
          try { await supabase.from('inventory_units').delete().eq('serial_number', cleanSerial); } catch (e) {}
          if (existing?.id && isUUID(existing.id)) {
            try { await supabase.from('inventory_units').delete().eq('id', existing.id); } catch (e) {}
          }

          await supabase.from('saved_records').upsert({
            id: 'live_master_dc_inventory',
            record_type: 'inventory_master',
            period_label: 'Live Master DC Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { units: nextUnits },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

          if (updatedRecords.length > 0) {
            try {
              await supabase.from('saved_records').upsert({
                id: 'master_dc_intakes_registry',
                record_type: 'intake_registry',
                period_label: 'Master DC Intakes Registry',
                period_year: new Date().getFullYear(),
                period_month: new Date().getMonth() + 1,
                snapshot_data: { records: updatedRecords },
                updated_at: new Date().toISOString()
              }, { onConflict: 'id' });
            } catch (e) {}
          }

          for (const rec of recordsToUpdateInDb) {
            try {
              const formattedRow = formatDcIntakeRecordForDb(rec, currentUser);
              if (formattedRow) {
                await supabase.from('dc_intake_records').upsert(formattedRow, { onConflict: 'id' });
              }
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
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();

    const currentUnit = (inventoryUnits || []).find(u => 
      String(u.serial_number || '').trim().toUpperCase() === cleanSerial
    );

    const cleanPN = String(partNumber || currentUnit?.part_number || '').trim().toUpperCase();

    if (!currentUnit) {
      barcodeAudio.playError();
      showToast(`Unit not found in stock: ${cleanSerial}`, 'error');
      logScan('PACK_OUT', cleanPN || 'UNKNOWN', cleanSerial, false, 'Unit not found in stock');
      return { success: false, error: 'Unit not found in DC stock' };
    }

    if (currentUnit.status !== 'in_stock' && currentUnit.status !== 'allocated') {
      barcodeAudio.playError();
      showToast(`Unit ${cleanSerial} cannot be scanned out (Status: ${currentUnit.status})`, 'error');
      logScan('PACK_OUT', cleanPN, cleanSerial, false, `Invalid status: ${currentUnit.status}`);
      return { success: false, error: `Unit is already ${currentUnit.status}` };
    }

    const itemToAdd = {
      id: currentUnit.id || `unit-${cleanSerial}`,
      part_id: currentUnit.part_id,
      part_number: currentUnit.part_number,
      description: currentUnit.description,
      serial_number: currentUnit.serial_number,
      box_number: boxNumber
    };

    setInventoryUnits(prev => {
      const updated = (prev || []).map(u => {
        if (String(u.serial_number || '').trim().toUpperCase() === cleanSerial) {
          return {
            ...u,
            status: 'packed',
            current_site_id: siteId || 'site-dc',
            box_number: boxNumber,
            shipped_at: new Date().toISOString(),
            shipped_by: currentUser?.fullName || 'Warehouse Staff'
          };
        }
        return u;
      });
      try {
        localStorage.setItem('mdc_inventory', JSON.stringify(updated));
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', updated);
      return updated;
    });

    if (supabase) {
      (async () => {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          await supabase
            .from('inventory_units')
            .upsert({
              part_id: currentUnit.part_id,
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

    if (broadcastCloudEvent) {
      broadcastCloudEvent('UNIT_PACKED', {
        serialNumber: cleanSerial,
        partNumber: cleanPN,
        siteId: siteId || 'site-dc',
        boxNumber: boxNumber,
        status: 'packed',
        shippedBy: currentUser?.fullName || 'Warehouse Staff'
      });
    }

    barcodeAudio.playSuccess();
    logScan('PACK_OUT', cleanPN, cleanSerial, true);
    showToast(`Packed: ${itemToAdd.description} (#${cleanSerial}) into Box ${boxNumber}`, 'success');
    return { success: true, item: itemToAdd };
  };

  const batchAddScanOutUnits = async (shipmentId, siteId, scannedRows = []) => {
    if (!scannedRows || scannedRows.length === 0) {
      return { success: false, error: 'No parts to pack.' };
    }

    const itemsToAdd = [];
    const newLogs = [];
    const updatedSerialsMap = new Map();

    for (const row of scannedRows) {
      const cleanPN = (row.part_number || '').trim().toUpperCase();
      const cleanSerial = (row.serial_number || '').trim().toUpperCase();
      if (!cleanSerial) continue;

      const unit = (inventoryUnits || []).find(u => 
        u.serial_number && 
        u.serial_number.toUpperCase() === cleanSerial &&
        (u.status === 'in_stock' || u.status === 'allocated')
      );

      if (unit) {
        const itemObj = {
          part_number: unit.part_number,
          description: unit.description,
          serial_number: unit.serial_number,
          box_number: row.box_number || 1
        };
        itemsToAdd.push(itemObj);

        updatedSerialsMap.set(cleanSerial, {
          ...unit,
          status: 'packed',
          current_site_id: siteId,
          box_number: row.box_number || 1,
          shipped_at: new Date().toISOString(),
          shipped_by: currentUser?.fullName || 'Warehouse Staff'
        });

        newLogs.push({
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          scan_type: 'PACK_OUT',
          part_number: cleanPN,
          serial_number: cleanSerial,
          is_valid: true,
          error_message: null,
          created_at: new Date().toISOString()
        });
      }
    }

    if (itemsToAdd.length === 0) {
      return { success: false, error: 'No matching in-stock units found to pack.' };
    }

    setInventoryUnits(prev => {
      const updatedInventory = (prev || []).map(u => {
        const match = updatedSerialsMap.get(String(u.serial_number || '').toUpperCase());
        return match ? match : u;
      });
      try {
        localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory));
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', updatedInventory);
      return updatedInventory;
    });

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
    if (broadcastCloudEvent) {
      broadcastCloudEvent('UNITS_BATCH_PACKED', {
        count: itemsToAdd.length,
        serialNumbers: itemsToAdd.map(it => it.serial_number),
        siteId: siteId || 'site-dc',
        status: 'packed'
      });
    }

    barcodeAudio.playSuccess();
    showToast(`Batch packed ${itemsToAdd.length} units into ${targetShipmentNumber || 'Shipment'}!`, 'success');
    return { success: true, count: itemsToAdd.length, items: itemsToAdd };
  };

  const removeScanOutUnit = ({ shipmentId, serialNumber, partInfo = null }) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) return { success: false };

    // 1. Unmark from deleted serials registry
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      const filtered = localDeleted.filter(s => String(s).trim().toUpperCase() !== cleanSerial);
      localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(filtered));
    } catch (e) {}

    let revertedPart = null;
    setInventoryUnits(prev => {
      let found = false;
      const updated = (prev || []).map(u => {
        if (String(u.serial_number || '').trim().toUpperCase() === cleanSerial) {
          found = true;
          revertedPart = {
            ...u,
            status: 'in_stock',
            current_site_id: 'site-dc',
            box_number: 1,
            shipped_at: null,
            shipped_by: null
          };
          return revertedPart;
        }
        return u;
      });

      // If unit wasn't in inventoryUnits array, construct it from partInfo fallback
      if (!found && partInfo) {
        revertedPart = {
          id: partInfo.id || `unit-${cleanSerial}`,
          part_id: partInfo.part_id || `part-${partInfo.part_number || 'unknown'}`,
          part_number: partInfo.part_number,
          description: partInfo.description || 'Service Replacement Part',
          serial_number: cleanSerial,
          current_site_id: 'site-dc',
          site_code: 'DC-MDC',
          status: 'in_stock',
          box_number: 1,
          received_at: partInfo.received_at || new Date().toISOString(),
          received_by: partInfo.received_by || currentUser?.fullName || 'Warehouse Staff'
        };
        updated.push(revertedPart);
      }

      try {
        localStorage.setItem('mdc_inventory', JSON.stringify(updated));
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', updated);
      return updated;
    });

    if (setShipments) {
      setShipments(prev => prev.map(sh => {
        if (sh.id === shipmentId) {
          return {
            ...sh,
            items: (sh.items || []).filter(it => String(it.serial_number || it.serialNumber || '').trim().toUpperCase() !== cleanSerial)
          };
        }
        return sh;
      }));
    }

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

          await supabase
            .from('inventory_units')
            .update({
              status: 'in_stock',
              current_site_id: dcSiteId || 'site-dc',
              shipped_at: null,
              box_number: 1
            })
            .eq('serial_number', cleanSerial);

          if (revertedPart) {
            const partId = isUUID(revertedPart.part_id) ? revertedPart.part_id : toValidUUID(revertedPart.part_id || 'part-' + (revertedPart.part_number || cleanSerial));
            if (isUUID(partId)) {
              await supabase.from('inventory_units').upsert({
                id: isUUID(revertedPart.id) ? revertedPart.id : toValidUUID(revertedPart.id || cleanSerial),
                part_id: partId,
                serial_number: cleanSerial,
                status: 'in_stock',
                current_site_id: dcSiteId || 'site-dc',
                box_number: 1,
                received_at: revertedPart.received_at || new Date().toISOString(),
                received_by_name: revertedPart.received_by || currentUser?.fullName || 'Warehouse Staff',
                updated_at: new Date().toISOString()
              }, { onConflict: 'serial_number' });
            }
          }

          if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        } catch (dbErr) {
          console.warn('Supabase unit revert error:', dbErr.message);
          if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('UNIT_UNPACKED', {
        serialNumber: cleanSerial,
        status: 'in_stock',
        unit: revertedPart
      });
    }

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
    masterlistData,
    setMasterlistData,
    addScanInUnit,
    deleteScanInUnit,
    updateUnitAssignment,
    updateUnitDetails,
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
