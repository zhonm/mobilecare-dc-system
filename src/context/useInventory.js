import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { barcodeAudio } from '../utils/barcodeAudio';
import { resolvePartInfo, normalizeInventoryUnits, validateAppleSerialNumber } from '../utils/partResolver';
import {
  reconcileUnitsWithPackedDrafts,
  isExplicitlyCleared,
  canUserDeleteRecord,
  formatDcIntakeRecordForDb,
  isUUID,
  toValidUUID,
  getBasePoNumber,
  normalizeDateToIso,
  consolidatePurchaseOrdersList,
  consolidateDcIntakeRecordsList
} from '../utils/appContextHelpers';
import { getPartCategory } from '../utils/categoryFilter';
import { queuedSavedRecordsUpsert, flushSavedRecordsQueue } from '../utils/savedRecordsQueue';
import { cleanSerialNumberInput } from '../utils/serialTracker';
import { resolveSiteFromSheetOrCode } from '../utils/excelParser';

export { getBasePoNumber, consolidatePurchaseOrdersList, consolidateDcIntakeRecordsList };


export function useInventory({
  parts = [],
  setParts,
  sites: propSites = [],
  _sites = [],
  currentUser,
  showToast,
  broadcastCloudEvent,
  dcIntakeRecords = [],
  setDcIntakeRecords,
  getShipments,
  setShipments,
  setCloudSyncStatus,
  logDeletionAudit
}) {
  const sites = propSites && propSites.length > 0 ? propSites : _sites;
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
        if (Array.isArray(parsed) && parsed.length > 0) {
          // If parsed has fewer than 100 units, but cloud records exist (system has thousands of units),
          // do NOT initialize with truncated partial 29 units as it flashes misleading 0 used parts!
          const hasCloudRecord = Boolean(
            localStorage.getItem('mdc_live_inventory_updated_at') ||
            localStorage.getItem('mdc_masterlist_data')
          );
          if (!(parsed.length < 100 && hasCloudRecord)) {
            baseUnits = parsed;
          }
        }
      }

      // Filter out deleted serials and pre-September DC stock units (delivered to sites prior to September)
      const filtered = baseUnits.filter(u => {
        const s = String(u.serial_number || '').trim().toUpperCase();
        if (s && deletedSerialsSet.has(s)) return false;
        const isDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
        const recvDate = (u.received_at || '').substring(0, 10);
        if (isDc && recvDate && recvDate < '2026-09-01') return false;
        if (isDc && (u.is_generated || String(u.id || '').startsWith('unit-mdc') || (recvDate === '2026-09-01' && u.po_number))) return false;
        return true;
      });

      return reconcileUnitsWithPackedDrafts(filtered);
    } catch {
      return [];
    }
  });

  const [isInventoryLoaded, setIsInventoryLoaded] = useState(() => {
    try {
      if (isExplicitlyCleared()) return true;
      const saved = localStorage.getItem('mdc_inventory');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 100) return true;
      }
    } catch (e) {}
    return false;
  });

  // Rapid recovery from IndexedDB (dbStorage) on app startup
  // Guarantees immediate access to complete thousands of inventory units even when localStorage was limited or wiped
  useEffect(() => {
    let isMounted = true;
    dbStorage.getItem('mdc_inventory').then(cachedUnits => {
      if (!isMounted) return;
      if (!Array.isArray(cachedUnits) || cachedUnits.length === 0) {
        setIsInventoryLoaded(true);
        return;
      }
      if (isExplicitlyCleared()) {
        setIsInventoryLoaded(true);
        return;
      }

      let deletedSerialsSet = new Set();
      try {
        const deletedSerials = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
        deletedSerialsSet = new Set(deletedSerials.map(s => String(s).trim().toUpperCase()));
      } catch (e) {}

      const filtered = cachedUnits.filter(u => {
        const s = String(u.serial_number || '').trim().toUpperCase();
        if (s && deletedSerialsSet.has(s)) return false;
        const isDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
        const recvDate = (u.received_at || '').substring(0, 10);
        if (isDc && recvDate && recvDate < '2026-09-01') return false;
        if (isDc && (u.is_generated || String(u.id || '').startsWith('unit-mdc') || (recvDate === '2026-09-01' && u.po_number))) return false;
        return true;
      });

      const reconciled = reconcileUnitsWithPackedDrafts(filtered);

      setInventoryUnits(prev => {
        if (!prev || prev.length === 0) return reconciled;
        if (!reconciled || reconciled.length === 0) return prev;

        const map = new Map();
        reconciled.forEach(u => {
          const s = String(u.serial_number || '').trim().toUpperCase();
          if (s) map.set(s, u);
          else map.set(u.id || Math.random(), u);
        });

        prev.forEach(u => {
          const s = String(u.serial_number || '').trim().toUpperCase();
          if (!s) return;
          const ex = map.get(s);
          if (!ex) {
            map.set(s, u);
          } else {
            const isUsed = u.status === 'used' || ex.status === 'used' || Boolean(u.used_at) || Boolean(ex.used_at);
            const uTime = u.updated_at ? new Date(u.updated_at).getTime() : 0;
            const exTime = ex.updated_at ? new Date(ex.updated_at).getTime() : 0;
            const base = uTime >= exTime ? u : ex;
            map.set(s, {
              ...ex,
              ...u,
              ...base,
              status: isUsed ? 'used' : (base.status || ex.status || u.status),
              work_order_number: (isUsed ? (u.work_order_number || ex.work_order_number) : base.work_order_number) || null,
              usage_notes: (isUsed ? (u.usage_notes || ex.usage_notes) : base.usage_notes) || null,
              used_at: (isUsed ? (u.used_at || ex.used_at) : base.used_at) || null,
              dateUsed: (isUsed ? (u.dateUsed || ex.dateUsed) : base.dateUsed) || null
            });
          }
        });

        return Array.from(map.values());
      });
      setIsInventoryLoaded(true);
    }).catch(err => {
      console.debug('[useInventory] IDB inventory cache load note:', err);
      if (isMounted) setIsInventoryLoaded(true);
    });

    return () => { isMounted = false; };
  }, []);

  const [purchaseOrders, setPurchaseOrders] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_pos');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return consolidatePurchaseOrdersList(parsed);
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

  const unmarkDeletedSerials = async (serialsToKeep, options = {}) => {
    if (!serialsToKeep || serialsToKeep.length === 0) return;
    const serialSetToKeep = new Set(serialsToKeep.map(s => String(s).trim().toUpperCase()));
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      const filtered = localDeleted.filter(s => !serialSetToKeep.has(String(s).trim().toUpperCase()));
      localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(filtered));
      dbStorage.setItem('mdc_deleted_unit_serials', filtered);
    } catch (e) {}

    if (supabase) {
      try {
        const { data: reg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'deleted_unit_serials_registry').maybeSingle();
        if (reg?.snapshot_data?.deletedSerials && Array.isArray(reg.snapshot_data.deletedSerials)) {
          const updatedCloud = reg.snapshot_data.deletedSerials.filter(s => !serialSetToKeep.has(String(s).trim().toUpperCase()));
          await queuedSavedRecordsUpsert({
            id: 'deleted_unit_serials_registry',
            record_type: 'deletion_registry',
            period_label: 'Deleted Unit Serials Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { deletedSerials: updatedCloud },
            updated_at: new Date().toISOString()
          }, { debounceMs: options.immediate ? 0 : 1000, immediate: Boolean(options.immediate) });
        }
      } catch (e) {}
    }
  };

  const persistPurchaseOrders = async (orders) => {
    try {
      localStorage.setItem('mdc_pos', JSON.stringify(orders));
    } catch (e) {
      console.warn('Error saving POs to localStorage:', e);
    }
    try {
      dbStorage.setItem('mdc_pos', orders);
    } catch (e) {}

    if (supabase) {
      try {
        queuedSavedRecordsUpsert({
          id: 'master_purchase_orders_registry',
          record_type: 'purchase_orders_registry',
          period_label: 'Master Purchase Orders Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { orders },
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          updated_at: new Date().toISOString()
        }, { debounceMs: 1200 });
      } catch (err) {
        console.warn('master_purchase_orders_registry sync note:', err.message);
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('PURCHASE_ORDERS_UPDATED', { count: orders.length, timestamp: Date.now() });
    }
  };

  const addPurchaseOrder = async (poData) => {
    const newPo = {
      id: poData.id || `po-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      po_number: String(poData.po_number || `PO-${Date.now()}`).trim(),
      invoice_ref: poData.invoice_ref ? String(poData.invoice_ref).trim() : null,
      sales_order_no: poData.sales_order_no ? String(poData.sales_order_no).trim() : null,
      customer_no: poData.customer_no ? String(poData.customer_no).trim() : null,
      supplier: poData.supplier || 'Apple South Asia Pte Ltd',
      order_date: normalizeDateToIso(poData.order_date),
      expected_date: normalizeDateToIso(poData.expected_date || poData.order_date),
      status: 'pending', // Strictly pending initially, zero auto-confirmation!
      currency: poData.currency || 'USD',
      total_amount: poData.total_amount || 0,
      remarks: poData.remarks || '',
      source_filename: poData.source_filename || null,
      created_at: poData.created_at || new Date().toISOString(),
      created_by: currentUser?.fullName || 'Superadmin',
      items: (poData.items || []).map((it, idx) => ({
        id: it.id || `po-item-${idx}-${Date.now()}`,
        part_number: String(it.part_number || '').trim().toUpperCase(),
        description: it.description || `Apple Genuine Part ${it.part_number}`,
        quantity_ordered: Number(it.quantity_ordered) || 0,
        quantity_shipped: Number(it.quantity_shipped) || Number(it.quantity_ordered) || 0,
        quantity_received: 0, // Always 0 on initial upload
        unit_price: Number(it.unit_price) || 0,
        extended_price: Number(it.extended_price) || (Number(it.quantity_ordered || 0) * Number(it.unit_price || 0))
      }))
    };

    const basePoNum = getBasePoNumber(newPo.po_number);
    newPo.po_number = basePoNum;
    newPo.id = `po-${basePoNum.toLowerCase()}`;

    let consolidatedPos = [];
    setPurchaseOrders(prev => {
      consolidatedPos = consolidatePurchaseOrdersList([newPo, ...(prev || [])]);
      persistPurchaseOrders(consolidatedPos);
      return consolidatedPos;
    });

    // Auto-save and consolidate directly into Parts Saved History Records (dcIntakeRecords)
    if (setDcIntakeRecords) {
      setDcIntakeRecords(prev => {
        const { consolidatedRecords, obsoleteIdsToPurge } = consolidateDcIntakeRecordsList(
          prev || [],
          consolidatedPos.length > 0 ? consolidatedPos : [newPo],
          currentUser,
          inventoryUnits
        );
        try {
          localStorage.setItem('mdc_dc_intake_records', JSON.stringify(consolidatedRecords));
        } catch (e) {}
        dbStorage.setItem('mdc_dc_intake_records', consolidatedRecords);

        if (supabase && obsoleteIdsToPurge.length > 0) {
          const cleanObsolete = obsoleteIdsToPurge.filter(Boolean);
          if (cleanObsolete.length > 0) {
            supabase.from('dc_intake_records').delete().in('id', cleanObsolete).then(() => {}).catch(() => {});
            supabase.from('dc_intake_records').delete().in('record_name', cleanObsolete).then(() => {}).catch(() => {});
            supabase.from('saved_records').delete().in('id', cleanObsolete).then(() => {}).catch(() => {});
          }
        }

        const canonicalHistoryRecord = consolidatedRecords.find(r => r.id === basePoNum);
        if (supabase && canonicalHistoryRecord) {
          const formattedRow = formatDcIntakeRecordForDb(canonicalHistoryRecord, currentUser);
          if (formattedRow) {
            supabase.from('dc_intake_records').upsert(formattedRow, { onConflict: 'id' }).then(() => {}).catch(() => {});
          }
        }

        return consolidatedRecords;
      });
    }

    showToast(`Purchase Order ${basePoNum} saved (${newPo.items.length} parts) and synchronized in Parts Saved History Records`, 'success');
    return newPo;
  };

  const deletePurchaseOrder = async (poId) => {
    const targetBasePo = getBasePoNumber(poId);
    setPurchaseOrders(prev => {
      const targetPo = (prev || []).find(p => p.id === poId || getBasePoNumber(p.po_number || p.id) === targetBasePo);
      const updated = (prev || []).filter(p => p.id !== poId && getBasePoNumber(p.po_number || p.id) !== targetBasePo);
      persistPurchaseOrders(updated);

      // Preserve permanent record in Parts Saved History Records (dcIntakeRecords)
      if (setDcIntakeRecords && (targetPo || targetBasePo)) {
        setDcIntakeRecords(prevRecords => {
          const nextRecords = (prevRecords || []).map(r => {
            const rBase = getBasePoNumber(r.po_number || r.id);
            if (r.po_id === poId || (rBase && targetBasePo && rBase === targetBasePo)) {
              return {
                ...r,
                status: 'completed',
                notes: r.notes ? `${r.notes} (PO completed & cleared from active tracking)` : 'PO completed & cleared from active tracking',
                updated_at: new Date().toISOString()
              };
            }
            return r;
          });
          try {
            localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextRecords));
          } catch (e) {}
          dbStorage.setItem('mdc_dc_intake_records', nextRecords);
          return nextRecords;
        });
      }

      return updated;
    });
    showToast('Purchase Order removed from active tracking. History record safely preserved in Parts Saved History Records.', 'info');
  };

  const clearCompletedPurchaseOrders = async () => {
    let clearedCount = 0;
    setPurchaseOrders(prev => {
      const completed = (prev || []).filter(p => p.status === 'received');
      clearedCount = completed.length;
      if (clearedCount === 0) return prev;
      const remaining = (prev || []).filter(p => p.status !== 'received');
      persistPurchaseOrders(remaining);

      if (setDcIntakeRecords) {
        const completedPoBases = new Set(completed.map(p => getBasePoNumber(p.po_number || p.id)));
        setDcIntakeRecords(prevRecords => {
          const nextRecords = (prevRecords || []).map(r => {
            const rBase = getBasePoNumber(r.po_number || r.id);
            if (rBase && completedPoBases.has(rBase)) {
              return {
                ...r,
                status: 'completed',
                updated_at: new Date().toISOString()
              };
            }
            return r;
          });
          try {
            localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextRecords));
          } catch (e) {}
          dbStorage.setItem('mdc_dc_intake_records', nextRecords);
          return nextRecords;
        });
      }

      return remaining;
    });
    if (clearedCount > 0) {
      showToast(`Cleared ${clearedCount} completed Purchase Order${clearedCount > 1 ? 's' : ''} from active tracking`, 'success');
    }
  };

  // Dynamic Self-Healing Reconciliation Engine:
  // Continuously ensure that every PO in purchaseOrders has an accurate, synchronized batch record in dcIntakeRecords.
  // Consolidates multiple invoices or suffixed PO records into 1 canonical history record per base PO (e.g. 54 and 51 units).
  useEffect(() => {
    if (!setDcIntakeRecords) return;

    setDcIntakeRecords(prevRecords => {
      const { consolidatedRecords, obsoleteIdsToPurge } = consolidateDcIntakeRecordsList(
        prevRecords || [],
        purchaseOrders || [],
        currentUser,
        inventoryUnits
      );

      const hasLengthDiff = (prevRecords || []).length !== consolidatedRecords.length;
      const hasObsolete = obsoleteIdsToPurge.length > 0;
      const hasContentDiff = consolidatedRecords.some(cr => {
        const orig = (prevRecords || []).find(r => r.id === cr.id);
        return !orig ||
          orig.expected_units !== cr.expected_units ||
          orig.po_number !== cr.po_number ||
          orig.total_units !== cr.total_units ||
          orig.intake_date !== cr.intake_date ||
          (orig.items || []).length !== (cr.items || []).length;
      });

      if (hasLengthDiff || hasObsolete || hasContentDiff) {
        try {
          localStorage.setItem('mdc_dc_intake_records', JSON.stringify(consolidatedRecords));
        } catch (e) {}
        dbStorage.setItem('mdc_dc_intake_records', consolidatedRecords);
        return consolidatedRecords;
      }

      return prevRecords;
    });
  }, [purchaseOrders, currentUser, setDcIntakeRecords, inventoryUnits]);

  const saveUnitsToSupabase = async (units, options = {}) => {
    if (!supabase || !units || units.length === 0) return;
    await unmarkDeletedSerials(units.map(u => u.serial_number), { immediate: Boolean(options.immediate) });
    if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
    try {
      const { data: dbCats } = await supabase.from('part_categories').select('id, code');
      const catMap = new Map((dbCats || []).map(c => [c.code, c.id]));
      const defaultCatId = dbCats?.[0]?.id || null;

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
          const catCode = getPartCategory({ part_number: cleanPN, description: u.description });
          const partCatId = catMap.get(catCode) || defaultCatId;
          missingPartsMap.set(cleanPN, {
            part_number: cleanPN,
            description: u.description || `Part ${cleanPN}`,
            ...(partCatId ? { category_id: partCatId } : {})
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

      const VALID_DB_STATUSES = new Set(['in_stock', 'allocated', 'packed', 'shipped', 'delivered', 'received', 'damaged', 'returned']);
      const unitRows = [];
      for (const u of units) {
        const cleanPN = String(u.part_number || '').trim().toUpperCase();
        const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
        if (!cleanPN || !cleanSerial) continue;

        const pId = pMap.get(cleanPN);

        // Resolve Target Site UUID: match against Supabase sites by ID, code, or name
        const unitSiteKey = String(u.current_site_id || u.site_id || u.targetSiteId || '').trim();
        const unitSiteCode = String(u.site_code || '').trim().toUpperCase();
        const unitSiteClean = unitSiteCode.replace(/^(ASP|APP)\s+/, '');
        const matchedSite = resolveSiteFromSheetOrCode(unitSiteCode || u.site_name || unitSiteKey, siteList) || siteList.find(s => {
          const sCodeClean = String(s.code || '').replace(/^(ASP|APP)\s+/, '').toUpperCase();
          return (unitSiteKey && (s.id === unitSiteKey || s.code?.toUpperCase() === unitSiteKey.toUpperCase())) ||
                 (unitSiteCode && (s.code?.toUpperCase() === unitSiteCode || sCodeClean === unitSiteClean)) ||
                 (u.site_name && s.name && (s.name.toUpperCase().includes(u.site_name.toUpperCase()) || u.site_name.toUpperCase().includes(s.name.toUpperCase())));
        });

        const isBranchUnit = unitSiteCode && unitSiteCode !== 'DC-MDC' && unitSiteCode !== 'DC';
        const targetSiteId = matchedSite?.id || (isUUID(unitSiteKey) ? unitSiteKey : (isBranchUnit ? (siteList.find(s => !s.is_dc)?.id || dcSiteId) : dcSiteId));

        if (pId && targetSiteId) {
          const assign = u.intake_assignment || u.notes || (u.notes?.includes('SVNR') ? 'SVNR - Service Non-Repair' : u.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
          const dbStatus = VALID_DB_STATUSES.has(u.status) ? u.status : (u.status === 'outtake' ? 'returned' : 'in_stock');
          const metaPayload = {
            lifecycle_status: u.status || 'in_stock',
            work_order_number: u.work_order_number || null,
            usage_notes: u.usage_notes || null,
            used_at: u.used_at || null,
            outtake_at: u.outtake_at || null,
            outtake_reason: u.outtake_reason || null,
            transferred_at: u.transferred_at || null,
            transfer_slip_number: u.transfer_slip_number || null,
            transferred_to_site_code: u.transferred_to_site_code || null,
            site_code: u.site_code || matchedSite?.code || null,
            site_name: u.site_name || matchedSite?.name || null
          };
          const encodedNotes = `${assign} | __META__:${JSON.stringify(metaPayload)}`;

          unitRows.push({
            part_id: pId,
            current_site_id: targetSiteId,
            serial_number: cleanSerial,
            status: dbStatus,
            box_number: u.box_number || 1,
            notes: encodedNotes,
            received_at: u.received_at || new Date().toISOString(),
            updated_at: u.updated_at || new Date().toISOString()
          });
        }
      }

      if (unitRows.length > 0) {
        const uniqueUnitRows = Array.from(new Map(unitRows.map(r => [r.serial_number.trim().toUpperCase(), r])).values());
        const CHUNK_SIZE = 250;
        const chunks = [];
        for (let i = 0; i < uniqueUnitRows.length; i += CHUNK_SIZE) {
          chunks.push(uniqueUnitRows.slice(i, i + CHUNK_SIZE));
        }
        for (let i = 0; i < chunks.length; i += 4) {
          const batch = chunks.slice(i, i + 4);
          await Promise.all(batch.map(async chunk => {
            try {
              const { error: upsertErr } = await supabase.from('inventory_units').upsert(chunk, { onConflict: 'serial_number' });
              if (upsertErr) {
                console.warn('inventory_units chunk upsert notice:', upsertErr.message);
              }
            } catch (chunkErr) {
              console.warn('inventory_units chunk error:', chunkErr.message);
            }
          }));

          if (options?.onProgress) {
            const completedCount = Math.min(i + batch.length * CHUNK_SIZE, uniqueUnitRows.length);
            const pct = Math.min(98, Math.round(85 + (completedCount / uniqueUnitRows.length) * 13));
            options.onProgress({
              stage: `Synchronizing cloud records (${completedCount.toLocaleString()} / ${uniqueUnitRows.length.toLocaleString()})...`,
              detail: 'Saving inventory records to database',
              percent: pct,
              current: completedCount,
              total: uniqueUnitRows.length
            });
            await new Promise(r => setTimeout(r, 0));
          }
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
            const prevEntry = mergedMap.get(s) || {};
            mergedMap.set(s, {
              ...prevEntry,
              ...u,
              id: u.id || prevEntry.id || `unit-${u.serial_number}`,
              part_id: u.part_id || prevEntry.part_id || `part-${u.part_number}`,
              part_number: u.part_number,
              description: u.description || prevEntry.description || 'Service Replacement Part',
              serial_number: u.serial_number,
              intake_assignment: assign,
              notes: assign,
              current_site_id: u.current_site_id || prevEntry.current_site_id || 'site-dc',
              site_code: u.site_code || prevEntry.site_code || 'DC-MDC',
              site_name: u.site_name || prevEntry.site_name || null,
              status: u.status || prevEntry.status || 'in_stock',
              work_order_number: u.work_order_number || prevEntry.work_order_number || null,
              usage_notes: u.usage_notes || prevEntry.usage_notes || null,
              used_at: u.used_at || prevEntry.used_at || null,
              outtake_at: u.outtake_at || prevEntry.outtake_at || null,
              outtake_reason: u.outtake_reason || prevEntry.outtake_reason || null,
              transferred_at: u.transferred_at || prevEntry.transferred_at || null,
              transfer_slip_number: u.transfer_slip_number || prevEntry.transfer_slip_number || null,
              transferred_to_site_code: u.transferred_to_site_code || prevEntry.transferred_to_site_code || null,
              box_number: u.box_number || prevEntry.box_number || 1,
              received_at: u.received_at || prevEntry.received_at || new Date().toISOString(),
              received_by: u.received_by || prevEntry.received_by || currentUser?.fullName || 'Warehouse Staff',
              received_by_id: u.received_by_id || prevEntry.received_by_id || currentUser?.id || null,
              added_by_user_id: u.added_by_user_id || prevEntry.added_by_user_id || currentUser?.id || null,
              shipped_at: u.shipped_at || prevEntry.shipped_at || null,
              stocking_price: u.stocking_price || prevEntry.stocking_price || 99,
              updated_at: u.updated_at || prevEntry.updated_at || new Date().toISOString()
            });
          }
        });
        const allPoolUnits = Array.from(mergedMap.values());
        await queuedSavedRecordsUpsert({
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
        }, { debounceMs: options.immediate ? 0 : 1200, immediate: Boolean(options.immediate) });

        // Synchronize dedicated retail branch inventory registry for PMG Users & multi-site tracking
        const isDcUnit = (item) => {
          const sId = String(item.current_site_id || item.site_id || item.siteId || '').toLowerCase();
          const sCode = String(item.site_code || item.siteCode || '').toUpperCase();
          return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode && item.is_dc);
        };
        const branchUnitsList = allPoolUnits.filter(item => !isDcUnit(item));
        if (branchUnitsList.length > 0) {
          await queuedSavedRecordsUpsert({
            id: 'master_branch_inventory_registry',
            record_type: 'branch_inventory',
            period_label: 'Master Retail Branch Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            period_week: 1,
            notes: 'Master In-Stock & Site Stock Monitoring branch inventory across all MobileCare ASP service points',
            saved_by_name: currentUser?.fullName || 'Warehouse Staff',
            snapshot_data: {
              units: branchUnitsList
            },
            updated_at: new Date().toISOString()
          }, { debounceMs: options.immediate ? 0 : 1200, immediate: Boolean(options.immediate) });
        }
      } catch (poolErr) {
        console.warn('live_master_dc_inventory sync note:', poolErr.message);
      }

      if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      if (broadcastCloudEvent && !options.skipBroadcast) {
        broadcastCloudEvent('STOCK_UPDATED', { count: units.length, units, timestamp: Date.now() });
        broadcastCloudEvent('UNITS_IMPORTED', { count: units.length, units, timestamp: Date.now() });
      }
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

    const resolvedSiteId = targetSiteId || currentUser?.siteId || 'site-dc';
    const resolvedSiteCode = targetSiteCode || (currentUser?.siteId ? (currentUser.siteCode || 'BRANCH') : 'DC-MDC');
    const isDcDest = resolvedSiteId === 'site-dc' ||
      resolvedSiteCode === 'DC-MDC' ||
      resolvedSiteCode === 'DC' ||
      (!resolvedSiteId && !resolvedSiteCode) ||
      (_sites || []).some(s => s.is_dc && (s.id === resolvedSiteId || s.code === resolvedSiteCode));

    const existingUnit = inventoryUnits.find(u => {
      if (String(u.serial_number || '').toUpperCase() !== cleanSerial) return false;
      if (u.status !== 'in_stock' && u.status) return false;
      if (isDcDest) {
        return u.current_site_id === 'site-dc' ||
          u.current_site_id === resolvedSiteId ||
          u.site_code === 'DC-MDC' ||
          u.site_code === 'DC' ||
          u.site_code === resolvedSiteCode ||
          (!u.current_site_id && !u.site_code);
      }
      return u.current_site_id === resolvedSiteId || u.site_code === resolvedSiteCode;
    });

    if (existingUnit) {
      barcodeAudio.playError();
      showToast(`Duplicate Serial: ${cleanSerial} already exists in ${isDcDest ? 'DC stock' : resolvedSiteCode}!`, 'error');
      logScan('RECEIVE_IN', cleanPN, cleanSerial, false, 'Duplicate serial number');
      return { success: false, error: `Duplicate serial number: ${cleanSerial}` };
    }

    const effectiveAssignment = intakeAssignment === 'SVNR - Service Non-Repair' || String(intakeAssignment).includes('SVNR')
      ? 'SVNR - Service Non-Repair'
      : intakeAssignment === 'DC - CRBR' || String(intakeAssignment).includes('CRBR')
      ? 'DC - CRBR'
      : 'MDC - Forecasting';
    const effectiveNotes = notes || effectiveAssignment;

    // Intelligent Multi-PO Cross-Order Auto-Routing Engine:
    // 1. If an explicit poId was passed, verify whether that PO has pending capacity for cleanPN
    let matchedPo = null;
    let isAutoRouted = false;

    if (poId) {
      const explicitPo = purchaseOrders.find(p => p.id === poId || String(p.po_number).toUpperCase() === String(poId).toUpperCase());
      const hasPartWithCapacity = explicitPo && explicitPo.status !== 'received' && explicitPo.items?.some(it => 
        (it.part_number.toUpperCase() === cleanPN || it.part_number.toUpperCase() === rawPN.toUpperCase()) &&
        (it.quantity_received || 0) < (it.quantity_ordered || 0)
      );
      if (hasPartWithCapacity) {
        matchedPo = explicitPo;
      }
    }

    // 2. If no explicit PO or the selected PO does NOT contain this part with pending capacity,
    // automatically search across ALL active pending POs for an order expecting this part!
    if (!matchedPo) {
      const candidatePo = purchaseOrders.find(p => 
        p.status !== 'received' &&
        p.items?.some(it => 
          (it.part_number.toUpperCase() === cleanPN || it.part_number.toUpperCase() === rawPN.toUpperCase()) &&
          (it.quantity_received || 0) < (it.quantity_ordered || 0)
        )
      );
      if (candidatePo) {
        matchedPo = candidatePo;
        isAutoRouted = true;
      }
    }

    // 3. Fallback: If not found with remaining unfulfilled capacity, check if explicit PO lists it
    if (!matchedPo && poId) {
      const explicitPo = purchaseOrders.find(p => p.id === poId || String(p.po_number).toUpperCase() === String(poId).toUpperCase());
      if (explicitPo?.items?.some(it => it.part_number.toUpperCase() === cleanPN || it.part_number.toUpperCase() === rawPN.toUpperCase())) {
        matchedPo = explicitPo;
      }
    }

    const targetPoId = matchedPo ? matchedPo.id : null;

    const newUnit = {
      id: `unit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      part_id: part.id || `part-${part.part_number}`,
      part_number: part.part_number,
      description: part.description,
      category_id: part.category_id,
      serial_number: cleanSerial,
      intake_assignment: effectiveAssignment,
      notes: effectiveNotes,
      current_site_id: resolvedSiteId,
      site_code: resolvedSiteCode,
      site_name: targetSiteName || null,
      po_id: targetPoId || null,
      po_number: matchedPo?.po_number || null,
      status: 'in_stock',
      box_number: 1,
      received_at: new Date().toISOString(),
      received_by: currentUser?.fullName || 'Warehouse Staff',
      received_by_id: currentUser?.id || null,
      added_by_user_id: currentUser?.id || null,
      created_by_site_id: currentUser?.siteId || resolvedSiteId,
      stocking_price: part.stocking_price || 99
    };

    unmarkDeletedSerials([cleanSerial]);

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

    let matchedPoNumber = matchedPo?.po_number || null;
    let matchedPoSupplier = matchedPo?.supplier || null;

    if (targetPoId) {
      setPurchaseOrders(prev => {
        const nextOrders = prev.map(po => {
          if (po.id === targetPoId || po.po_number.toUpperCase() === String(targetPoId).toUpperCase()) {
            matchedPoNumber = po.po_number;
            matchedPoSupplier = po.supplier;
            const updatedItems = po.items.map(item => {
              if (item.part_number.toUpperCase() === cleanPN || item.part_number.toUpperCase() === rawPN.toUpperCase()) {
                return { ...item, quantity_received: (item.quantity_received || 0) + 1 };
              }
              return item;
            });
            const allReceived = updatedItems.every(it => (it.quantity_received || 0) >= it.quantity_ordered);
            return {
              ...po,
              items: updatedItems,
              status: allReceived ? 'received' : 'partially_received'
            };
          }
          return po;
        });
        persistPurchaseOrders(nextOrders);
        return nextOrders;
      });

      // Automatically append this scanned part & serial into the PO's batch in Parts Saved History Records!
      if (setDcIntakeRecords) {
        setDcIntakeRecords(prev => {
          let found = false;
          const targetBasePo = getBasePoNumber(matchedPoNumber || targetPoId);

          const nextRecords = (prev || []).map(rec => {
            const recBasePo = getBasePoNumber(rec.po_number || rec.id);
            const isMatch = (targetBasePo && recBasePo && targetBasePo === recBasePo) ||
                            (targetPoId && rec.po_id === targetPoId) || 
                            (targetPoId && rec.id && rec.id.toUpperCase() === String(targetPoId).toUpperCase());
            if (isMatch) {
              found = true;
              const existingItems = Array.isArray(rec.items) ? rec.items : [];
              const updatedItems = [newUnit, ...existingItems.filter(it => it.serial_number !== newUnit.serial_number)];
              const totalUnits = updatedItems.length;
              const totalValue = updatedItems.reduce((acc, it) => acc + Number(it.stocking_price || 99), 0);
              const isAllDone = rec.expected_units ? totalUnits >= rec.expected_units : false;
              const updatedRec = {
                ...rec,
                items: updatedItems,
                total_units: totalUnits,
                total_value: totalValue,
                status: isAllDone ? 'completed' : 'in_progress',
                updated_at: new Date().toISOString()
              };
              if (supabase) {
                const formattedRow = formatDcIntakeRecordForDb(updatedRec, currentUser);
                if (formattedRow) {
                  supabase.from('dc_intake_records').upsert(formattedRow, { onConflict: 'id' }).then(() => {}).catch(() => {});
                }
              }
              return updatedRec;
            }
            return rec;
          });

          if (!found && targetBasePo) {
            const autoRec = {
              id: targetBasePo,
              record_name: `${targetBasePo} (Apple GSX PO)`,
              intake_date: new Date().toISOString().split('T')[0],
              po_id: targetPoId || `po-${targetBasePo.toLowerCase()}`,
              po_number: targetBasePo,
              invoice_ref: matchedPo?.invoice_ref || null,
              sales_order_no: matchedPo?.sales_order_no || null,
              supplier_name: matchedPoSupplier || 'Apple South Asia Pte Ltd',
              supplier: matchedPoSupplier || 'Apple South Asia Pte Ltd',
              status: 'in_progress',
              items: [newUnit],
              total_units: 1,
              expected_units: (matchedPo?.items || []).reduce((s, it) => s + (it.quantity_ordered || 0), 0) || 1,
              total_value: Number(newUnit.stocking_price || 99),
              expected_value: matchedPo?.total_amount || 0,
              saved_by_id: currentUser?.id || 'usr-system',
              saved_by_name: currentUser?.fullName || 'Warehouse Staff',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            const nextList = [autoRec, ...prev];
            try {
              localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextList));
            } catch (e) {}
            dbStorage.setItem('mdc_dc_intake_records', nextList);

            if (supabase) {
              const formatted = formatDcIntakeRecordForDb(autoRec, currentUser);
              if (formatted) {
                supabase.from('dc_intake_records').upsert(formatted, { onConflict: 'id' }).then(() => {}).catch(() => {});
              }
              queuedSavedRecordsUpsert({
                id: 'master_dc_intakes_registry',
                record_type: 'intake_registry',
                period_label: 'Master DC Intakes Registry',
                period_year: new Date().getFullYear(),
                period_month: new Date().getMonth() + 1,
                notes: 'Master operational intake batches synchronized across all users',
                saved_by_name: currentUser?.fullName || 'Warehouse Staff',
                snapshot_data: { records: nextList },
                updated_at: new Date().toISOString()
              }, { debounceMs: 1200 });
            }

            return nextList;
          }

          try {
            localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextRecords));
          } catch (e) {}
          dbStorage.setItem('mdc_dc_intake_records', nextRecords);

          if (supabase) {
            queuedSavedRecordsUpsert({
              id: 'master_dc_intakes_registry',
              record_type: 'intake_registry',
              period_label: 'Master DC Intakes Registry',
              period_year: new Date().getFullYear(),
              period_month: new Date().getMonth() + 1,
              notes: 'Master operational intake batches synchronized across all users',
              saved_by_name: currentUser?.fullName || 'Warehouse Staff',
              snapshot_data: { records: nextRecords },
              updated_at: new Date().toISOString()
            }, { debounceMs: 1200 });
          }

          return nextRecords;
        });
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('STOCK_UPDATED', {
        count: 1,
        unit: newUnit,
        matchedPoNumber,
        timestamp: Date.now()
      });
    }

    barcodeAudio.playSuccess();
    logScan('RECEIVE_IN', cleanPN, cleanSerial, true);
    showToast(`Received ${part.part_number} — ${part.description} (${cleanSerial})`, 'success');
    return { success: true, unit: newUnit, matchedPo, isAutoRouted };
  };

  const updateUnitAssignment = async (serialNumber, newAssignment) => {
    if (!serialNumber) return;
    const cleanSerial = String(serialNumber).trim().toUpperCase();
    const effectiveAssignment = String(newAssignment).includes('SVNR')
      ? 'SVNR - Service Non-Repair'
      : String(newAssignment).includes('CRBR')
      ? 'DC - CRBR'
      : 'MDC - Forecasting';

    const nowIso = new Date().toISOString();

    let updatedUnits = [];
    setInventoryUnits(prev => {
      const updated = (prev || []).map(u => {
        if (String(u.serial_number || '').toUpperCase() === cleanSerial) {
          return {
            ...u,
            intake_assignment: effectiveAssignment,
            notes: effectiveAssignment,
            updated_at: nowIso
          };
        }
        return u;
      });
      const normalized = normalizeInventoryUnits(updated, parts);
      updatedUnits = normalized;
      try {
        localStorage.setItem('mdc_inventory', JSON.stringify(normalized));
        localStorage.removeItem('mdc_recent_scans');
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', normalized);
      return normalized;
    });

    if (updatedUnits.length === 0) {
      try {
        const saved = JSON.parse(localStorage.getItem('mdc_inventory') || '[]');
        if (Array.isArray(saved) && saved.length > 0) {
          updatedUnits = saved.map(u => {
            if (String(u.serial_number || '').toUpperCase() === cleanSerial) {
              return { ...u, intake_assignment: effectiveAssignment, notes: effectiveAssignment, updated_at: nowIso };
            }
            return u;
          });
        }
      } catch (e) {}
    }

    let updatedRecords = [];
    const matchingBatches = [];
    if (setDcIntakeRecords) {
      setDcIntakeRecords(prev => {
        let modified = false;
        const nextRecords = (prev || []).map(rec => {
          if (Array.isArray(rec.items) && rec.items.some(it => String(it.serial_number || '').toUpperCase() === cleanSerial)) {
            modified = true;
            const updatedItems = rec.items.map(it => {
              if (String(it.serial_number || '').toUpperCase() === cleanSerial) {
                return { ...it, intake_assignment: effectiveAssignment, notes: effectiveAssignment, updated_at: nowIso };
              }
              return it;
            });
            const updatedRec = { ...rec, items: updatedItems, updated_at: nowIso };
            matchingBatches.push(updatedRec);
            return updatedRec;
          }
          return rec;
        });
        if (modified) {
          updatedRecords = nextRecords;
          try { localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextRecords)); } catch (e) {}
          dbStorage.setItem('mdc_dc_intake_records', nextRecords);
        }
        return nextRecords;
      });
    }

    if (updatedRecords.length === 0) {
      try {
        const savedIntakes = JSON.parse(localStorage.getItem('mdc_dc_intake_records') || '[]');
        if (Array.isArray(savedIntakes) && savedIntakes.length > 0) {
          let modified = false;
          updatedRecords = savedIntakes.map(rec => {
            if (Array.isArray(rec.items) && rec.items.some(it => String(it.serial_number || '').toUpperCase() === cleanSerial)) {
              modified = true;
              const updatedItems = rec.items.map(it => {
                if (String(it.serial_number || '').toUpperCase() === cleanSerial) {
                  return { ...it, intake_assignment: effectiveAssignment, notes: effectiveAssignment, updated_at: nowIso };
                }
                return it;
              });
              const updatedRec = { ...rec, items: updatedItems, updated_at: nowIso };
              matchingBatches.push(updatedRec);
              return updatedRec;
            }
            return rec;
          });
          if (modified) {
            try { localStorage.setItem('mdc_dc_intake_records', JSON.stringify(updatedRecords)); } catch (e) {}
            dbStorage.setItem('mdc_dc_intake_records', updatedRecords);
          }
        }
      } catch (e) {}
    }

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error: updateErr } = await supabase
          .from('inventory_units')
          .update({
            notes: effectiveAssignment,
            updated_at: nowIso
          })
          .eq('serial_number', cleanSerial);
        if (updateErr) {
          console.warn('Supabase inventory_units assignment update notice:', updateErr.message);
        }
      } catch (e) {
        console.error('Supabase assignment update error:', e.message);
      }

      for (const updatedRec of matchingBatches) {
        try {
          const formattedRow = formatDcIntakeRecordForDb(updatedRec, currentUser);
          if (formattedRow) {
            await supabase.from('dc_intake_records').upsert(formattedRow, { onConflict: 'id' });
          }
          const intakeYear = new Date(updatedRec.intake_date || nowIso).getFullYear() || new Date().getFullYear();
          const intakeMonth = (new Date(updatedRec.intake_date || nowIso).getMonth() + 1) || (new Date().getMonth() + 1);
          await queuedSavedRecordsUpsert(supabase, {
            id: updatedRec.id,
            record_type: 'intake_batch',
            period_label: updatedRec.record_name,
            period_year: intakeYear,
            period_month: intakeMonth,
            snapshot_data: updatedRec,
            updated_at: nowIso
          }, { immediate: true });
        } catch (e) {
          console.warn('Failed to upsert updated intake record batch:', e.message);
        }
      }

      if (updatedUnits.length > 0) {
        queuedSavedRecordsUpsert(supabase, {
          id: 'live_master_dc_inventory',
          record_type: 'master_inventory',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Master operational serialized inventory snapshot synchronized across all users',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: { units: updatedUnits },
          updated_at: nowIso
        }, { debounceMs: 500 });
      }

      if (updatedRecords.length > 0) {
        queuedSavedRecordsUpsert(supabase, {
          id: 'master_dc_intakes_registry',
          record_type: 'intake_registry',
          period_label: 'Master DC Intakes Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Master operational intake batches synchronized across all users',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: { records: updatedRecords },
          updated_at: nowIso
        }, { debounceMs: 500 });
      }

      if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('STOCK_UPDATED', {
        serialNumber: cleanSerial,
        serial: cleanSerial,
        assignment: effectiveAssignment,
        table: 'inventory_units'
      });
      broadcastCloudEvent('UNIT_SAVED', {
        serialNumber: cleanSerial,
        assignment: effectiveAssignment
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

  const batchAddScanInUnits = async (
    itemsList = [],
    defaultPoId = null,
    defaultAssignment = 'MDC - Forecasting',
    targetSiteId = null,
    targetSiteCode = null,
    targetSiteName = null,
    options = {}
  ) => {
    if (!itemsList || itemsList.length === 0) {
      return { success: false, error: 'No units provided to import' };
    }

    let currentParts = [...parts];
    const newUnits = [];
    const newLogs = [];
    const newlyCreatedParts = [];
    const poMap = new Map();

    // Fast indexed caches for O(1) resolution over thousands of items
    const partsByPnMap = new Map();
    const partsByDescMap = new Map();
    currentParts.forEach(p => {
      if (p.part_number) partsByPnMap.set(String(p.part_number).trim().toUpperCase(), p);
      if (p.description) partsByDescMap.set(String(p.description).trim().toLowerCase(), p);
    });

    const sitesByIdMap = new Map((sites || []).map(s => [s.id, s]));
    const sitesByCodeMap = new Map((sites || []).map(s => [String(s.code).toUpperCase(), s]));
    const sitesByCleanCodeMap = new Map((sites || []).map(s => [String(s.code).replace(/^(ASP|APP)\s+/, '').toUpperCase(), s]));

    const seenSerials = new Set();
    const isMultiSite = targetSiteId === 'ALL' || itemsList.some(it => it.site_code && it.site_code !== targetSiteCode && it.site_code !== 'DC-MDC');
    const resolvedSiteId = isMultiSite ? 'ALL' : (targetSiteId || currentUser?.siteId || 'site-dc');
    const resolvedSiteCode = isMultiSite ? 'ALL' : (targetSiteCode || (currentUser?.siteId ? (currentUser.siteCode || 'BRANCH') : 'DC-MDC'));
    const isDcDest = !isMultiSite && (resolvedSiteId === 'site-dc' || resolvedSiteCode === 'DC-MDC' || resolvedSiteCode === 'DC' || (!resolvedSiteId && !resolvedSiteCode));

    const siteInventoryUnits = (inventoryUnits || []).filter(u => {
      if (isMultiSite) return true;
      if (isDcDest) {
        return u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
      }
      return u.current_site_id === resolvedSiteId || u.site_code === resolvedSiteCode;
    });
    const existingInventoryMap = new Map(siteInventoryUnits.map(u => [String(u.serial_number || '').toUpperCase(), u]));

    for (let idx = 0; idx < itemsList.length; idx++) {
      const item = itemsList[idx];
      const rawPN = String(item.part_number || item.partNumber || '').trim();
      const rawDesc = String(item.description || '').trim();
      const cleanSerial = String(item.serial_number || item.serialNumber || '').trim().toUpperCase();

      if ((!rawPN && !rawDesc) || !cleanSerial) continue;
      if (seenSerials.has(cleanSerial)) continue;
      seenSerials.add(cleanSerial);

      let part = (rawPN ? partsByPnMap.get(rawPN.toUpperCase()) : null) ||
                 (rawDesc ? partsByDescMap.get(rawDesc.toLowerCase()) : null) ||
                 resolvePartInfo(rawPN, currentParts) ||
                 resolvePartInfo(rawDesc, currentParts);
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
        partsByPnMap.set(cleanPN, newPart);
        if (rawDesc) partsByDescMap.set(rawDesc.toLowerCase(), newPart);
        newlyCreatedParts.push(newPart);
        part = newPart;
      }

      const cleanPN = part.part_number;
      const serialToValidate = item.raw_serial || item.raw_serial_number || item.display_serial || cleanSerial;
      const serialValidation = item.summary_only
        ? { isValid: true, cleanSerial }
        : validateAppleSerialNumber(serialToValidate, cleanPN, currentParts);
      if (!serialValidation.isValid) continue;
      const validatedSerial = cleanSerial;

      let effectivePoId = item.poId || defaultPoId || null;
      if (effectivePoId) {
        const explicitPo = purchaseOrders.find(p => p.id === effectivePoId || p.po_number === effectivePoId);
        const hasPart = explicitPo?.items?.some(it => it.part_number.toUpperCase() === cleanPN);
        if (!hasPart) effectivePoId = null;
      }
      if (!effectivePoId) {
        const candidatePo = purchaseOrders.find(p => 
          p.status !== 'received' &&
          p.items?.some(it => it.part_number.toUpperCase() === cleanPN && (it.quantity_received || 0) < (it.quantity_ordered || 0))
        );
        if (candidatePo) effectivePoId = candidatePo.id;
      }
      const existingUnit = existingInventoryMap.get(validatedSerial);
      const assignedPoId = effectivePoId || existingUnit?.po_id || null;

      // Resolve site for this unit with alias normalization support
      let resolvedItemSite = null;
      const rawSiteKey = item.current_site_id || item.site_id || item.siteId;
      if (rawSiteKey) {
        resolvedItemSite = sitesByIdMap.get(rawSiteKey) || sitesByCodeMap.get(String(rawSiteKey).toUpperCase());
      }
      if (!resolvedItemSite && (item.site_code || item.siteCode || item.sheetName)) {
        const sKey = String(item.site_code || item.siteCode || item.sheetName).toUpperCase();
        resolvedItemSite = sitesByCodeMap.get(sKey) || sitesByCleanCodeMap.get(sKey.replace(/^(ASP|APP)\s+/, '')) || resolveSiteFromSheetOrCode(sKey, sites || []);
      }
      if (!resolvedItemSite && (item.site_name || item.siteName)) {
        resolvedItemSite = resolveSiteFromSheetOrCode(item.site_name || item.siteName, sites || []);
      }

      if (options?.onProgress && itemsList.length > 300 && seenSerials.size % 800 === 0) {
        options.onProgress({
          stage: `Indexing & validating parts (${seenSerials.size.toLocaleString()} / ${itemsList.length.toLocaleString()})...`,
          detail: 'Assigning branch locations and verifying serial numbers',
          percent: Math.min(70, Math.round(35 + (seenSerials.size / itemsList.length) * 35)),
          current: seenSerials.size,
          total: itemsList.length
        });
        await new Promise(r => setTimeout(r, 0));
      }

      const itemSiteId = resolvedItemSite?.id || item.current_site_id || item.site_id || (isMultiSite ? (resolvedItemSite?.id || (item.site_code ? `site-${item.site_code.toLowerCase().replace(/[^a-z0-9]/g, '-')}` : null)) : resolvedSiteId);
      const itemSiteCode = resolvedItemSite?.code || item.site_code || item.siteCode || (isMultiSite ? (resolvedItemSite?.code || 'BRANCH') : resolvedSiteCode);
      const itemSiteName = resolvedItemSite?.name || item.site_name || item.siteName || (isMultiSite ? (resolvedItemSite?.name || `${itemSiteCode} Branch`) : (targetSiteName || (isDcDest ? 'Distribution Center (DC)' : null)));

      const assignedType = item.intake_assignment || item.intakeAssignment || item.notes || defaultAssignment || (isDcDest ? 'MDC - Forecasting' : 'Branch Stock');
      const effectiveAssignment = isDcDest
        ? (String(assignedType).includes('SVNR')
            ? 'SVNR - Service Non-Repair'
            : String(assignedType).includes('CRBR')
            ? 'DC - CRBR'
            : 'MDC - Forecasting')
        : (item.intake_assignment || `${itemSiteCode || resolvedSiteCode} Stock`);
      const effectiveNotes = item.notes || effectiveAssignment;

      const nowIso = new Date().toISOString();
      const processedUnit = {
        id: existingUnit?.id || `unit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        part_id: part.id || `part-${part.part_number}`,
        part_number: part.part_number,
        description: part.description || rawDesc,
        serial_number: validatedSerial,
        raw_serial: item.raw_serial || item.raw_serial_number || cleanSerial,
        raw_serial_number: item.raw_serial_number || item.raw_serial || cleanSerial,
        display_serial: item.display_serial || cleanSerial,
        intake_assignment: effectiveAssignment,
        notes: effectiveNotes,
        current_site_id: itemSiteId,
        site_code: itemSiteCode,
        site_name: itemSiteName,
        po_id: assignedPoId || null,
        status: item.lifecycle_status || item.status || 'in_stock',
        used_at: item.dateUsed || item.used_at || (item.lifecycle_status === 'used' ? nowIso : null),
        work_order_number: item.workOrderNumber || item.work_order_number || null,
        usage_notes: item.usage_notes || (item.lifecycle_status === 'used' ? item.remarks : null),
        outtake_at: item.dateOuttake || item.outtake_at || (item.lifecycle_status === 'outtake' ? nowIso : null),
        outtake_reason: item.outtake_reason || (item.lifecycle_status === 'outtake' ? item.remarks : null),
        transferred_at: item.dateTransferred || item.transferred_at || (item.lifecycle_status === 'transferred' ? nowIso : null),
        transfer_slip_number: item.transferSlipNumber || item.transfer_slip_number || null,
        transferred_to_site_code: item.targetSiteCode || item.transferred_to_site_code || null,
        box_number: item.boxNumber || item.box_number || existingUnit?.box_number || 1,
        received_at: item.dateReceived || existingUnit?.received_at || nowIso,
        received_by: currentUser?.fullName || (isDcDest ? 'Warehouse Staff (Import)' : 'Branch Staff'),
        received_by_id: currentUser?.id || null,
        added_by_user_id: currentUser?.id || null,
        created_by_site_id: itemSiteId,
        stocking_price: part.stocking_price || 99,
        is_summary_only: Boolean(item.summary_only),
        updated_at: item.updated_at || nowIso
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
      const serialsToImport = new Set(newUnits.map(u => String(u.serial_number || '').toUpperCase()));
      const untouchedUnits = (prev || []).filter(u => !serialsToImport.has(String(u.serial_number || '').toUpperCase()));
      const updated = [...untouchedUnits, ...newUnits];
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

    // Reset cleared site timestamps for imported sites so units are visible immediately and persist across sync
    try {
      const localClearedSites = JSON.parse(localStorage.getItem('mdc_cleared_site_timestamps') || '{}');
      const updatedClearedSites = { ...localClearedSites };
      if (isMultiSite || resolvedSiteId === 'ALL') {
        delete updatedClearedSites['ALL_BRANCHES'];
        delete updatedClearedSites['ENTIRE_SYSTEM'];
      }
      newUnits.forEach(u => {
        if (u.current_site_id) delete updatedClearedSites[u.current_site_id];
        if (u.site_code) delete updatedClearedSites[u.site_code];
      });
      localStorage.setItem('mdc_cleared_site_timestamps', JSON.stringify(updatedClearedSites));
      dbStorage.setItem('mdc_cleared_site_timestamps', updatedClearedSites);

      if (supabase) {
        queuedSavedRecordsUpsert({
          id: 'cleared_sites_registry',
          record_type: 'cleared_sites',
          period_label: 'Cleared Sites Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { clearedSites: updatedClearedSites },
          updated_at: new Date().toISOString()
        }, { debounceMs: 0, immediate: true });
      }
    } catch (e) {}

    const importedSerials = newUnits.map(u => String(u.serial_number || '').trim().toUpperCase()).filter(Boolean);
    if (importedSerials.length > 0) {
      await unmarkDeletedSerials(importedSerials, { immediate: true });
    }

    if (options?.onProgress) {
      options.onProgress({
        stage: 'Synchronizing with cloud database...',
        detail: 'Saving inventory records to database',
        percent: 85,
        current: newUnits.length,
        total: itemsList.length
      });
      await new Promise(r => setTimeout(r, 0));
    }

    await saveUnitsToSupabase(newUnits, {
      immediate: true,
      skipBroadcast: true,
      onProgress: options?.onProgress
    });
    await flushSavedRecordsQueue();

    if (poMap.size > 0) {
      setPurchaseOrders(prev => {
        const nextOrders = prev.map(po => {
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
        });
        persistPurchaseOrders(nextOrders);
        return nextOrders;
      });
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('UNITS_IMPORTED', { count: newUnits.length, units: newUnits, timestamp: Date.now() });
      broadcastCloudEvent('STOCK_UPDATED', { count: newUnits.length, units: newUnits, timestamp: Date.now() });
    }

    barcodeAudio.playSuccess();
    const destMsg = isMultiSite
      ? `across branch sites`
      : `into ${isDcDest ? 'DC Stock' : (targetSiteName || 'branch stock')}`;
    showToast(`Successfully imported ${newUnits.length} parts ${destMsg}!`, 'success');
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

  const deleteScanInUnit = async (serialOrUnit, reason = 'Inventory unit removed from stock by user') => {
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

    if (logDeletionAudit) {
      await logDeletionAudit({
        entityType: 'Inventory Unit',
        entityId: cleanSerial,
        entityLabel: existing?.part_number
          ? `${existing.part_number} — ${existing.description || 'Apple Service Part'}`
          : `Unit Serial ${cleanSerial}`,
        summary: {
          partNumber: existing?.part_number || 'N/A',
          serialNumber: cleanSerial,
          siteCode: existing?.site_code || existing?.site_name || 'DC',
          intakeAssignment: existing?.intake_assignment || 'DC Stock',
          poNumber: existing?.po_number || 'N/A'
        },
        reason: reason || 'Inventory unit removed from stock by user'
      });
    }

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

          queuedSavedRecordsUpsert({
            id: 'deleted_unit_serials_registry',
            record_type: 'deletion_registry',
            period_label: 'Deleted Unit Serials Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { deletedSerials: updatedCloudDeleted },
            updated_at: new Date().toISOString()
          }, { debounceMs: 800 });

          try { await supabase.from('inventory_units').update({ is_deleted: true, status: 'deleted' }).eq('serial_number', cleanSerial); } catch (e) {}
          try { await supabase.from('inventory_units').delete().eq('serial_number', cleanSerial); } catch (e) {}
          if (existing?.id && isUUID(existing.id)) {
            try { await supabase.from('inventory_units').delete().eq('id', existing.id); } catch (e) {}
          }

          queuedSavedRecordsUpsert({
            id: 'live_master_dc_inventory',
            record_type: 'inventory_master',
            period_label: 'Live Master DC Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { units: nextUnits },
            updated_at: new Date().toISOString()
          }, { debounceMs: 1000 });

          if (updatedRecords.length > 0) {
            queuedSavedRecordsUpsert({
              id: 'master_dc_intakes_registry',
              record_type: 'intake_registry',
              period_label: 'Master DC Intakes Registry',
              period_year: new Date().getFullYear(),
              period_month: new Date().getMonth() + 1,
              snapshot_data: { records: updatedRecords },
              updated_at: new Date().toISOString()
            }, { debounceMs: 1000 });
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
      setPurchaseOrders(prev => {
        const nextOrders = prev.map(po => {
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
              status: allReceived ? 'received' : anyReceived ? 'partially_received' : 'pending'
            };
          }
          return po;
        });
        persistPurchaseOrders(nextOrders);
        return nextOrders;
      });
    }

    if (broadcastCloudEvent) broadcastCloudEvent('STOCK_UPDATED', { serial: cleanSerial });
    logScan('DELETE_RECEIVED_UNIT', existing?.part_number || 'PART', cleanSerial, true, 'Manually deleted by operator');
    barcodeAudio.playSuccess();
    showToast(`Deleted part ${existing?.part_number || 'unit'} (${cleanSerial}) from inventory and database`, 'info');
    return { success: true };
  };

  const clearSiteParts = async ({
    siteId = null,
    siteCode = null,
    clearAllSites = false,
    clearEntireSystem = false,
    onlyInStock = false,
    reason = 'Old shipped parts cleared by user prior to Site Stock Monitoring Excel import'
  } = {}) => {
    // Resolve matching target site object
    const targetSite = (sites || []).find(s =>
      (siteId && (s.id === siteId || s.code === siteId)) ||
      (siteCode && (s.code === siteCode || s.id === siteCode))
    );
    const resolvedId = targetSite?.id || siteId;
    const resolvedCode = targetSite?.code || siteCode;

    const isDc = (u) => {
      const sId = String(u.current_site_id || u.site_id || u.siteId || '').toLowerCase();
      const sCode = String(u.site_code || u.siteCode || '').toUpperCase();
      return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode && u.is_dc);
    };

    const isMatch = (u) => {
      if (onlyInStock) {
        // STRICTLY preserve used, outtake, and transferred parts!
        const st = u.lifecycle_status || u.status || 'in_stock';
        if (st !== 'in_stock') return false;
      }
      if (clearEntireSystem) {
        return true;
      }
      if (clearAllSites) {
        // Exclude Central DC: Central DC stock is strictly preserved!
        return !isDc(u);
      }
      const sId = String(u.current_site_id || u.site_id || u.siteId || '');
      const sCode = String(u.site_code || u.siteCode || '');
      if (resolvedId && (sId === resolvedId || sCode === resolvedId)) return true;
      if (resolvedCode && (sCode === resolvedCode || sId === resolvedCode)) return true;
      if (targetSite && (sId === targetSite.id || sCode === targetSite.code || sId === targetSite.code || sCode === targetSite.id)) return true;
      return false;
    };

    // 1. Gather all current matching units
    const currentUnits = Array.isArray(inventoryUnits) ? inventoryUnits : [];
    const unitsToClear = currentUnits.filter(isMatch);

    let localUnits = [];
    try {
      localUnits = JSON.parse(localStorage.getItem('mdc_inventory') || '[]');
    } catch (e) {}
    const unitsToClearIds = new Set(unitsToClear.map(u => u.id).filter(Boolean));
    const unitsToClearSerials = new Set(unitsToClear.map(u => u.serial_number ? String(u.serial_number).trim().toUpperCase() : null).filter(Boolean));
    const extraLocal = Array.isArray(localUnits)
      ? localUnits.filter(u => isMatch(u) && !unitsToClearIds.has(u.id) && (!u.serial_number || !unitsToClearSerials.has(String(u.serial_number).trim().toUpperCase())))
      : [];
    const allClearedUnits = [...unitsToClear, ...extraLocal];

    // 2. CRITICAL: Harvest ALL serial numbers from completed/historical shipments matching the target site(s)
    // As per user policy: Shipment records themselves (manifests, dispatches, tracking) remain 100% intact!
    // But all their serials are registered so reconcileUnitsWithPackedDrafts will never resurrect them into site inventory.
    let allShipments = [];
    if (typeof getShipments === 'function') {
      try {
        const liveSh = getShipments();
        if (Array.isArray(liveSh)) allShipments = liveSh;
      } catch (e) {}
    }
    if (!allShipments.length && typeof window !== 'undefined') {
      try {
        const savedSh = localStorage.getItem('mdc_shipments');
        if (savedSh) {
          const parsed = JSON.parse(savedSh);
          if (Array.isArray(parsed)) allShipments = parsed;
        }
      } catch (e) {}
    }

    const shipmentSerials = [];
    if (!onlyInStock) {
      allShipments.forEach(sh => {
        if (!sh || !Array.isArray(sh.items)) return;
        const shSiteId = String(sh.site_id || sh.siteId || sh.destination_site_id || sh.target_site_id || sh.destinationSiteId || '');
        const shSiteCode = String(sh.site_code || sh.siteCode || sh.destination_site_code || sh.targetSiteCode || sh.destination || '');
        const isShDc = shSiteId === 'site-dc' || shSiteCode === 'DC-MDC' || shSiteCode === 'DC';

        let isShipmentTarget = false;
        if (clearEntireSystem) {
          isShipmentTarget = true;
        } else if (clearAllSites) {
          isShipmentTarget = !isShDc;
        } else {
          if (resolvedId && (shSiteId === resolvedId || shSiteCode === resolvedId)) isShipmentTarget = true;
          if (resolvedCode && (shSiteCode === resolvedCode || shSiteId === resolvedCode)) isShipmentTarget = true;
          if (targetSite && (shSiteId === targetSite.id || shSiteCode === targetSite.code || shSiteId === targetSite.code || shSiteCode === targetSite.id)) isShipmentTarget = true;
          const shClean = shSiteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '');
          const targetClean = String(resolvedCode || targetSite?.code || '').toUpperCase().replace(/^(ASP|APP)\s+/, '');
          if (targetClean && shClean && targetClean === shClean) isShipmentTarget = true;
        }

        if (isShipmentTarget) {
          sh.items.forEach(it => {
            const s = String(it.serial_number || it.serialNumber || (typeof it === 'string' ? it : '')).trim().toUpperCase();
            if (s) shipmentSerials.push(s);
          });
        }
      });
    }

    const clearedSerials = Array.from(new Set([
      ...allClearedUnits.map(u => String(u.serial_number || '').trim().toUpperCase()),
      ...shipmentSerials
    ].filter(Boolean)));

    const clearedUnitIds = Array.from(new Set(
      allClearedUnits
        .map(u => u.id)
        .filter(id => id && isUUID(id))
    ));

    // 3. Add to deleted unit serials registry in local storage
    let updatedDeleted = [];
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      updatedDeleted = Array.from(new Set([...localDeleted, ...clearedSerials]));
      localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(updatedDeleted));
    } catch (e) {
      updatedDeleted = [...clearedSerials];
    }
    dbStorage.setItem('mdc_deleted_unit_serials', updatedDeleted);

    // 4. Record cleared site timestamp only during full clean slates (NEVER on routine stock-on-hand synchronization)
    const nowIso = new Date().toISOString();
    let updatedClearedSites = {};
    if (!onlyInStock) {
      try {
        const localClearedSites = JSON.parse(localStorage.getItem('mdc_cleared_site_timestamps') || '{}');
        updatedClearedSites = { ...localClearedSites };
      } catch (e) {}

      if (clearEntireSystem) {
        updatedClearedSites['ENTIRE_SYSTEM'] = nowIso;
        updatedClearedSites['ALL_BRANCHES'] = nowIso;
        (sites || []).forEach(s => {
          if (s.id) updatedClearedSites[s.id] = nowIso;
          if (s.code) updatedClearedSites[s.code] = nowIso;
        });
      } else if (clearAllSites) {
        updatedClearedSites['ALL_BRANCHES'] = nowIso;
        (sites || []).forEach(s => {
          const isBranch = s.id !== 'site-dc' && s.code !== 'DC-MDC' && s.code !== 'DC' && !s.is_dc;
          if (isBranch) {
            if (s.id) updatedClearedSites[s.id] = nowIso;
            if (s.code) updatedClearedSites[s.code] = nowIso;
          }
        });
      } else {
        if (resolvedId) updatedClearedSites[resolvedId] = nowIso;
        if (resolvedCode) updatedClearedSites[resolvedCode] = nowIso;
        if (targetSite?.id) updatedClearedSites[targetSite.id] = nowIso;
        if (targetSite?.code) updatedClearedSites[targetSite.code] = nowIso;
      }
      try {
        localStorage.setItem('mdc_cleared_site_timestamps', JSON.stringify(updatedClearedSites));
      } catch (e) {}
      dbStorage.setItem('mdc_cleared_site_timestamps', updatedClearedSites);
    }

    // 5. Update inventoryUnits state
    const nextUnits = currentUnits.filter(u => !isMatch(u));
    setInventoryUnits(nextUnits);
    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(nextUnits));
      localStorage.removeItem('mdc_recent_scans');
    } catch (e) {}
    dbStorage.setItem('mdc_inventory', nextUnits);

    // 6. Cloud deletion and registry sync
    if (supabase) {
      (async () => {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          // Cloud deleted serials registry
          const { data: reg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'deleted_unit_serials_registry').maybeSingle();
          const cloudDeleted = reg?.snapshot_data?.deletedSerials || [];
          const updatedCloudDeleted = Array.from(new Set([...cloudDeleted, ...updatedDeleted]));

          queuedSavedRecordsUpsert({
            id: 'deleted_unit_serials_registry',
            record_type: 'deletion_registry',
            period_label: 'Deleted Unit Serials Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { deletedSerials: updatedCloudDeleted },
            updated_at: new Date().toISOString()
          }, { debounceMs: 500 });

          // Cloud cleared sites registry
          const { data: csReg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'cleared_sites_registry').maybeSingle();
          const cloudClearedSites = csReg?.snapshot_data?.clearedSites || {};
          const mergedCloudClearedSites = { ...cloudClearedSites, ...updatedClearedSites };

          queuedSavedRecordsUpsert({
            id: 'cleared_sites_registry',
            record_type: 'cleared_sites',
            period_label: 'Cleared Sites Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { clearedSites: mergedCloudClearedSites },
            updated_at: new Date().toISOString()
          }, { debounceMs: 500 });

          // Chunked deletion from Supabase inventory_units (batched concurrent requests)
          const CHUNK_DEL_SIZE = 250;
          for (let i = 0; i < clearedSerials.length; i += CHUNK_DEL_SIZE * 4) {
            const batchChunks = [];
            for (let b = 0; b < 4 && (i + b * CHUNK_DEL_SIZE) < clearedSerials.length; b++) {
              batchChunks.push(clearedSerials.slice(i + b * CHUNK_DEL_SIZE, i + (b + 1) * CHUNK_DEL_SIZE));
            }
            await Promise.all(batchChunks.map(async chunk => {
              try {
                await supabase.from('inventory_units').delete().in('serial_number', chunk);
              } catch (e) {}
            }));
          }
          for (let i = 0; i < clearedUnitIds.length; i += CHUNK_DEL_SIZE * 4) {
            const batchChunks = [];
            for (let b = 0; b < 4 && (i + b * CHUNK_DEL_SIZE) < clearedUnitIds.length; b++) {
              batchChunks.push(clearedUnitIds.slice(i + b * CHUNK_DEL_SIZE, i + (b + 1) * CHUNK_DEL_SIZE));
            }
            await Promise.all(batchChunks.map(async chunk => {
              try {
                await supabase.from('inventory_units').delete().in('id', chunk);
              } catch (e) {}
            }));
          }

          if (clearEntireSystem) {
            try {
              let q = supabase.from('inventory_units').delete().neq('id', '00000000-0000-0000-0000-000000000000');
              if (onlyInStock) q = q.eq('status', 'in_stock');
              await q;
            } catch (e) {}
          } else if (clearAllSites) {
            // Branch rows use Supabase site UUIDs, not the local `site-dc`
            // sentinel. Delete each configured non-DC site explicitly so
            // cleared branch inventory cannot be rehydrated on refresh.
            const branchSiteIds = (sites || [])
              .filter(site => !site.is_dc && site.code !== 'DC-MDC' && site.code !== 'DC' && site.id !== 'site-dc')
              .map(site => site.id)
              .filter(id => isUUID(id));
            for (const branchSiteId of branchSiteIds) {
              let q = supabase.from('inventory_units').delete().eq('current_site_id', branchSiteId);
              if (onlyInStock) q = q.eq('status', 'in_stock');
              const { error } = await q;
              if (error) throw error;
            }
          } else if (resolvedId && isUUID(resolvedId)) {
            try {
              let q = supabase.from('inventory_units').delete().eq('current_site_id', resolvedId);
              if (onlyInStock) q = q.eq('status', 'in_stock');
              const { error } = await q;
              if (error) throw error;
            } catch (e) {}
          }

          // Replace the shared snapshots immediately. The debounced queue
          // below is eventually consistent, but a refresh during its delay
          // could overlay a stale branch row back into the UI.
          const snapshotBase = {
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            period_week: 1,
            updated_at: new Date().toISOString()
          };
          const { error: liveSnapshotError } = await supabase.from('saved_records').upsert({
            id: 'live_master_dc_inventory',
            record_type: 'inventory_master',
            period_label: 'Live Master DC Inventory',
            ...snapshotBase,
            snapshot_data: { units: nextUnits }
          }, { onConflict: 'id' });
          if (liveSnapshotError) throw liveSnapshotError;

          const remainingBranchUnits = nextUnits.filter(u => !isDc(u));
          const { error: branchSnapshotError } = await supabase.from('saved_records').upsert({
            id: 'master_branch_inventory_registry',
            record_type: 'branch_inventory',
            period_label: 'Master Retail Branch Inventory',
            ...snapshotBase,
            snapshot_data: { units: remainingBranchUnits }
          }, { onConflict: 'id' });
          if (branchSnapshotError) throw branchSnapshotError;

          // Update live_master_dc_inventory snapshot
          queuedSavedRecordsUpsert({
            id: 'live_master_dc_inventory',
            record_type: 'inventory_master',
            period_label: 'Live Master DC Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            snapshot_data: { units: nextUnits },
            updated_at: new Date().toISOString()
          }, { debounceMs: 800 });

          // Update master_branch_inventory_registry snapshot for retail branches
          queuedSavedRecordsUpsert({
            id: 'master_branch_inventory_registry',
            record_type: 'branch_inventory',
            period_label: 'Master Retail Branch Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            period_week: 1,
            notes: 'Master In-Stock & Site Stock Monitoring branch inventory across all MobileCare ASP service points',
            saved_by_name: currentUser?.fullName || 'Warehouse Staff',
            snapshot_data: { units: remainingBranchUnits },
            updated_at: new Date().toISOString()
          }, { debounceMs: 800 });

        } catch (dbErr) {
          console.warn('Supabase clear site parts notice:', dbErr.message);
        } finally {
          if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    // 7. Audit Logging
    const targetLabel = clearEntireSystem
      ? 'Entire System (All Sites + Central DC)'
      : clearAllSites
        ? 'All Retail Branches'
        : (resolvedCode || resolvedId || 'Site');

    if (logDeletionAudit) {
      await logDeletionAudit({
        entityType: 'Site Inventory Purge',
        entityId: clearEntireSystem ? 'ENTIRE_SYSTEM' : (clearAllSites ? 'ALL_BRANCH_SITES' : (resolvedCode || resolvedId)),
        entityLabel: `Cleared all parts for ${targetLabel}`,
        summary: {
          clearedCount: allClearedUnits.length,
          targetSites: clearEntireSystem ? 'ENTIRE_SYSTEM' : (clearAllSites ? 'ALL_SITES' : targetLabel),
          serialsCount: clearedSerials.length,
          actionUser: currentUser?.fullName || currentUser?.email || 'Staff'
        },
        reason: reason
      });
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('SITE_PARTS_CLEARED', {
        siteId: resolvedId,
        siteCode: resolvedCode,
        clearAllSites,
        clearEntireSystem,
        count: allClearedUnits.length,
        serials: clearedSerials,
        clearedSites: updatedClearedSites
      });
    }
    barcodeAudio.playSuccess();
    const countMsg = allClearedUnits.length;
    showToast(`Successfully cleared ${countMsg} parts from ${targetLabel}. Ready for fresh Excel import.`, 'success');
    return { success: true, count: countMsg, serials: clearedSerials, targetLabel };
  };

  // Supabase Quota Defense: Debounced batch upsert buffer for scanning operations
  const pendingPackUpsertBufferRef = useRef(new Map());
  const packUpsertTimerRef = useRef(null);

  const flushPackUpserts = useCallback(async () => {
    if (packUpsertTimerRef.current) {
      clearTimeout(packUpsertTimerRef.current);
      packUpsertTimerRef.current = null;
    }
    if (!supabase || pendingPackUpsertBufferRef.current.size === 0) return;

    const rows = Array.from(pendingPackUpsertBufferRef.current.values());
    pendingPackUpsertBufferRef.current.clear();

    try {
      await supabase
        .from('inventory_units')
        .upsert(rows, { onConflict: 'serial_number' });
    } catch (err) {
      console.warn('Debounced batch pack unit upsert note:', err.message);
    }
  }, []);

  const queuePackUpsert = useCallback((row) => {
    if (!supabase || !row || !row.serial_number) return;
    pendingPackUpsertBufferRef.current.set(row.serial_number, row);
    if (packUpsertTimerRef.current) clearTimeout(packUpsertTimerRef.current);
    packUpsertTimerRef.current = setTimeout(() => {
      flushPackUpserts();
    }, 1200);
  }, [flushPackUpserts]);

  const addScanOutUnit = ({ shipmentId, siteId, partNumber, serialNumber, boxNumber = 1 }) => {
    const rawSerial = String(serialNumber || '').trim().toUpperCase();
    const cleanSerial = cleanSerialNumberInput(rawSerial) || rawSerial;

    const currentUnit = (inventoryUnits || []).find(u => {
      const uRaw = String(u.serial_number || '').trim().toUpperCase();
      const uClean = cleanSerialNumberInput(uRaw);
      return uClean === cleanSerial || uRaw === rawSerial || uRaw === cleanSerial;
    });

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
        const uRaw = String(u.serial_number || '').trim().toUpperCase();
        const uClean = cleanSerialNumberInput(uRaw);
        if (uClean === cleanSerial || uRaw === rawSerial || uRaw === cleanSerial) {
          return {
            ...u,
            status: 'packed',
            // Parts in draft packing station remain DC stock inventory (not transferred to branch until PL is finalized)
            current_site_id: u.current_site_id || 'site-dc',
            destination_site_id: siteId || null,
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

    // Supabase Quota Protection: Queue row into debounced batcher instead of sending 1 HTTP request per scan
    queuePackUpsert({
      part_id: currentUnit.part_id,
      serial_number: cleanSerial,
      status: 'packed',
      box_number: boxNumber,
      current_site_id: currentUnit.current_site_id || 'site-dc',
      shipped_at: new Date().toISOString()
    });

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
        userId: currentUser?.id || 'anon',
        packerName: currentUser?.fullName || currentUser?.name || 'Warehouse Staff',
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

  const batchAddScanOutUnits = (shipmentIdOrOpts, maybeSiteId, maybeScannedRows = []) => {
    let shipmentId = shipmentIdOrOpts;
    let siteId = maybeSiteId;
    let scannedRows = maybeScannedRows;

    if (typeof shipmentIdOrOpts === 'object' && shipmentIdOrOpts !== null) {
      shipmentId = shipmentIdOrOpts.shipmentId || shipmentIdOrOpts.id;
      siteId = shipmentIdOrOpts.siteId || maybeSiteId;
      scannedRows = shipmentIdOrOpts.items || shipmentIdOrOpts.scannedRows || [];
    }

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
          current_site_id: unit.current_site_id || 'site-dc',
          destination_site_id: siteId || null,
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

    // Queue and immediately flush batch upsert to Supabase in 1 single HTTP request
    itemsToAdd.forEach(it => {
      const matchUnit = updatedSerialsMap.get(it.serial_number.toUpperCase());
      queuePackUpsert({
        part_id: matchUnit?.part_id || `part-${it.part_number}`,
        serial_number: it.serial_number,
        status: 'packed',
        box_number: it.box_number || 1,
        current_site_id: matchUnit?.current_site_id || 'site-dc',
        shipped_at: new Date().toISOString()
      });
    });
    flushPackUpserts();

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
        userId: currentUser?.id || 'anon',
        packerName: currentUser?.fullName || currentUser?.name || 'Warehouse Staff',
        count: itemsToAdd.length,
        serialNumbers: itemsToAdd.map(it => it.serial_number),
        items: itemsToAdd,
        siteId: siteId || 'site-dc',
        status: 'packed'
      });
    }

    barcodeAudio.playSuccess();
    showToast(`Batch packed ${itemsToAdd.length} units into ${targetShipmentNumber || 'Shipment'}!`, 'success');
    return { success: true, count: itemsToAdd.length, items: itemsToAdd };
  };

  const removeScanOutUnit = ({ shipmentId, serialNumber, partInfo = null }) => {
    const rawSerial = String(serialNumber || '').trim().toUpperCase();
    const cleanSerial = cleanSerialNumberInput(rawSerial) || rawSerial;
    if (!cleanSerial) return { success: false };

    // 1. Unmark from deleted serials registry
    try {
      const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
      const filtered = localDeleted.filter(s => {
        const sRaw = String(s).trim().toUpperCase();
        return cleanSerialNumberInput(sRaw) !== cleanSerial && sRaw !== rawSerial;
      });
      localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(filtered));
    } catch (e) {}

    let revertedPart = null;
    setInventoryUnits(prev => {
      let found = false;
      const updated = (prev || []).map(u => {
        const uRaw = String(u.serial_number || '').trim().toUpperCase();
        const uClean = cleanSerialNumberInput(uRaw);
        if (uClean === cleanSerial || uRaw === rawSerial || uRaw === cleanSerial) {
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

    if (pendingPackUpsertBufferRef.current.has(cleanSerial)) {
      pendingPackUpsertBufferRef.current.delete(cleanSerial);
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('UNIT_UNPACKED', {
        userId: currentUser?.id || 'anon',
        packerName: currentUser?.fullName || currentUser?.name || 'Warehouse Staff',
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
    addPurchaseOrder,
    deletePurchaseOrder,
    clearCompletedPurchaseOrders,
    persistPurchaseOrders,
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
    clearSiteParts,
    unmarkDeletedSerials,
    saveUnitsToSupabase,
    logScan,
    isInventoryLoaded,
    setIsInventoryLoaded
  };
}
