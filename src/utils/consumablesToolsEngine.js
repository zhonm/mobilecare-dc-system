import { parseCsvRecords } from './gsxCatalogImporter.js';

export const TOOL_ASSET_STATUSES = ['available', 'in_use', 'in_transit', 'shipped', 'missing', 'retired'];

export function generateCtId(prefix = 'ct') {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

export function normalizePartNumber(pn) {
  return String(pn || '').trim().toUpperCase();
}

export function buildCatalogLookup(catalogItems = []) {
  const byPn = new Map();
  const byId = new Map();
  (catalogItems || []).forEach(item => {
    const pn = normalizePartNumber(item.part_number);
    if (pn && !byPn.has(pn)) byPn.set(pn, item);
    if (item.id && !byId.has(item.id)) byId.set(item.id, item);
  });
  return { byPn, byId };
}

export function parseSerialTokens(rawSerials) {
  const rawList = Array.isArray(rawSerials)
    ? rawSerials
    : String(rawSerials || '')
        .split(/[\r\n,;\s]+/)
        .map(s => s.trim())
        .filter(Boolean);

  const seen = new Set();
  const serials = [];
  const duplicatesInBatch = [];

  for (const token of rawList) {
    const clean = String(token || '').trim().toUpperCase();
    if (!clean) continue;
    if (seen.has(clean)) {
      if (!duplicatesInBatch.includes(clean)) {
        duplicatesInBatch.push(clean);
      }
      continue;
    }
    seen.add(clean);
    serials.push(clean);
  }

  return { serials, duplicatesInBatch };
}

export function generateNextAssetTag(existingToolAssets = [], partNumber = 'TOOL', reservedSet = null) {
  const cleanPn = normalizePartNumber(partNumber).replace(/[^A-Z0-9]/g, '') || 'TOOL';
  const prefix = `MDC-TL-${cleanPn}-`;
  const usedTags = new Set(
    (existingToolAssets || []).map(a => String(a.asset_tag || '').trim().toUpperCase())
  );
  if (reservedSet) {
    reservedSet.forEach(tag => usedTags.add(String(tag).toUpperCase()));
  }

  let seq = 1;
  while (usedTags.has(`${prefix}${String(seq).padStart(4, '0')}`)) {
    seq += 1;
  }
  const tag = `${prefix}${String(seq).padStart(4, '0')}`;
  if (reservedSet) reservedSet.add(tag);
  return tag;
}

export function computeItemStockSummary(catalogItem, stockRows = [], toolAssets = [], siteCodeFilter = null) {
  if (!catalogItem) {
    return {
      qtyOnHand: 0,
      qtyReserved: 0,
      qtyConsumed: 0,
      qtyShipped: 0,
      toolCounts: { available: 0, in_use: 0, in_transit: 0, shipped: 0, missing: 0, retired: 0, total: 0 },
      threshold: 2,
      isLowStock: true,
      isOutOfStock: true
    };
  }

  const pn = normalizePartNumber(catalogItem.part_number);
  const matchingStock = (stockRows || []).filter(s => {
    const sameItem = (s.catalog_id && s.catalog_id === catalogItem.id) || normalizePartNumber(s.part_number) === pn;
    if (!sameItem) return false;
    if (siteCodeFilter && siteCodeFilter !== 'ALL') {
      return String(s.site_code || '').toUpperCase() === String(siteCodeFilter).toUpperCase();
    }
    return true;
  });

  const matchingTools = (toolAssets || []).filter(a => {
    const sameItem = (a.catalog_id && a.catalog_id === catalogItem.id) || normalizePartNumber(a.part_number) === pn;
    if (!sameItem) return false;
    if (siteCodeFilter && siteCodeFilter !== 'ALL') {
      return String(a.site_code || '').toUpperCase() === String(siteCodeFilter).toUpperCase();
    }
    return true;
  });

  const toolCounts = {
    available: 0,
    in_use: 0,
    in_transit: 0,
    shipped: 0,
    missing: 0,
    retired: 0,
    total: matchingTools.length
  };
  matchingTools.forEach(a => {
    const st = a.status || 'available';
    if (Object.prototype.hasOwnProperty.call(toolCounts, st)) {
      toolCounts[st] += 1;
    }
  });

  const stockSum = matchingStock.reduce(
    (acc, row) => ({
      qtyOnHand: acc.qtyOnHand + (Number(row.qty_on_hand) || 0),
      qtyReserved: acc.qtyReserved + (Number(row.qty_reserved) || 0),
      qtyConsumed: acc.qtyConsumed + (Number(row.qty_consumed) || 0),
      qtyShipped: acc.qtyShipped + (Number(row.qty_shipped) || 0)
    }),
    { qtyOnHand: 0, qtyReserved: 0, qtyConsumed: 0, qtyShipped: 0 }
  );

  const effectiveOnHand = catalogItem.item_kind === 'tool' && matchingTools.length > 0
    ? toolCounts.available
    : stockSum.qtyOnHand;

  const threshold = Number.isFinite(Number(catalogItem.min_stock_threshold))
    ? Number(catalogItem.min_stock_threshold)
    : 2;

  return {
    qtyOnHand: effectiveOnHand,
    qtyReserved: stockSum.qtyReserved,
    qtyConsumed: stockSum.qtyConsumed,
    qtyShipped: catalogItem.item_kind === 'tool' ? toolCounts.shipped : stockSum.qtyShipped,
    toolCounts,
    threshold,
    isLowStock: effectiveOnHand <= threshold,
    isOutOfStock: effectiveOnHand <= 0
  };
}

export function validateAndReceiveOrderLine({
  order = null,
  itemId = null,
  partNumber,
  deliveredQty,
  scannedSerials = [],
  expectedQty = null,
  siteCode = null,
  catalogItems = [],
  stockRows = [],
  toolAssets = [],
  actorName = 'DC Staff',
  actorId = null,
  allowOverDelivery = true,
  allowAdHoc = false,
  notes = '',
  timestamp = new Date().toISOString()
}) {
  const cleanPn = normalizePartNumber(partNumber);
  const { byPn } = buildCatalogLookup(catalogItems);
  const catalogItem = byPn.get(cleanPn);

  if (!catalogItem) {
    return {
      ok: false,
      errorCode: 'UNKNOWN_PART_NUMBER',
      partNumber: cleanPn,
      message: `Unknown part number "${cleanPn || '(blank)'}". Add it to the Consumables & Tools catalog or mark it for review before receiving.`
    };
  }

  const qty = Number(deliveredQty);
  if (!Number.isInteger(qty) || qty <= 0) {
    return {
      ok: false,
      errorCode: 'QUANTITY_MISMATCH',
      partNumber: cleanPn,
      expectedQty: expectedQty ?? null,
      actualQty: deliveredQty,
      message: `Invalid quantity "${deliveredQty}" for ${cleanPn}. Delivered quantity must be a positive whole number.`
    };
  }

  if (expectedQty !== null && expectedQty !== undefined && Number(expectedQty) !== qty) {
    return {
      ok: false,
      errorCode: 'QUANTITY_MISMATCH',
      partNumber: cleanPn,
      expectedQty: Number(expectedQty),
      actualQty: qty,
      message: `Quantity mismatch for ${cleanPn}: manifest expected ${expectedQty}, received scan entered ${qty}.`
    };
  }

  const parsedSerials = parseSerialTokens(scannedSerials);
  if (parsedSerials.duplicatesInBatch.length > 0) {
    return {
      ok: false,
      errorCode: 'DUPLICATE_TOOL_SERIAL',
      partNumber: cleanPn,
      duplicateSerials: parsedSerials.duplicatesInBatch,
      message: `Duplicate serial number(s) detected in scan batch: ${parsedSerials.duplicatesInBatch.join(', ')}.`
    };
  }

  const existingSerialSet = new Set();
  (toolAssets || []).forEach(a => {
    const s = String(a.serial_number || '').trim().toUpperCase();
    if (s) existingSerialSet.add(s);
  });
  (stockRows || []).forEach(r => {
    (r.serial_numbers || []).forEach(sn => {
      const s = String(sn || '').trim().toUpperCase();
      if (s) existingSerialSet.add(s);
    });
  });
  const collidingSerials = parsedSerials.serials.filter(s => existingSerialSet.has(s));
  if (collidingSerials.length > 0) {
    return {
      ok: false,
      errorCode: 'DUPLICATE_TOOL_SERIAL',
      partNumber: cleanPn,
      duplicateSerials: collidingSerials,
      message: `Duplicate tool serial number(s) already registered in inventory: ${collidingSerials.join(', ')}.`
    };
  }

  if (catalogItem.item_kind === 'tool') {
    if (catalogItem.is_serialized && parsedSerials.serials.length !== qty) {
      return {
        ok: false,
        errorCode: 'QUANTITY_MISMATCH',
        partNumber: cleanPn,
        expectedQty: qty,
        actualSerialCount: parsedSerials.serials.length,
        message: `Quantity mismatch for serialized tool ${cleanPn}: received qty is ${qty} but ${parsedSerials.serials.length} serial number(s) were scanned.`
      };
    }
    if (!catalogItem.is_serialized && parsedSerials.serials.length > 0 && parsedSerials.serials.length !== qty) {
      return {
        ok: false,
        errorCode: 'QUANTITY_MISMATCH',
        partNumber: cleanPn,
        expectedQty: qty,
        actualSerialCount: parsedSerials.serials.length,
        message: `Quantity mismatch for tool ${cleanPn}: ${qty} unit(s) specified, but ${parsedSerials.serials.length} serial number(s) supplied.`
      };
    }
  }

  let matchedLine = null;
  let updatedOrder = order ? { ...order, items: [...(order.items || [])] } : null;
  let deliveryStatus = 'ad_hoc';
  let remainingBefore = null;
  let remainingAfter = null;
  let varianceQty = 0;

  if (updatedOrder) {
    const lineIdx = updatedOrder.items.findIndex(it =>
      (itemId && it.id === itemId) || normalizePartNumber(it.part_number) === cleanPn
    );

    if (lineIdx === -1) {
      if (!allowAdHoc) {
        return {
          ok: false,
          errorCode: 'LINE_ITEM_NOT_IN_ORDER',
          partNumber: cleanPn,
          message: `Part number ${cleanPn} is not listed on PO ${updatedOrder.po_number}.`
        };
      }
      matchedLine = {
        id: generateCtId('ct-oi'),
        order_id: updatedOrder.id,
        catalog_id: catalogItem.id,
        part_number: cleanPn,
        description: catalogItem.description,
        item_kind: catalogItem.item_kind,
        quantity_ordered: 0,
        quantity_received: qty,
        unit_cost: Number(catalogItem.unit_cost) || 0,
        needs_review: true,
        review_reason: 'Ad-hoc item received not originally on PO'
      };
      updatedOrder.items.push(matchedLine);
      deliveryStatus = 'over_delivery';
      varianceQty = qty;
    } else {
      const currentLine = updatedOrder.items[lineIdx];
      const ordered = Number(currentLine.quantity_ordered) || 0;
      const prevRec = Number(currentLine.quantity_received) || 0;
      remainingBefore = Math.max(0, ordered - prevRec);
      const nextRec = prevRec + qty;

      if (nextRec > ordered) {
        varianceQty = nextRec - ordered;
        deliveryStatus = 'over_delivery';
        if (!allowOverDelivery) {
          return {
            ok: false,
            errorCode: 'OVER_DELIVERY',
            partNumber: cleanPn,
            orderedQty: ordered,
            previousReceivedQty: prevRec,
            remainingQty: remainingBefore,
            attemptedQty: qty,
            varianceQty,
            message: `Over-delivery blocked for ${cleanPn}: only ${remainingBefore} remaining on PO ${updatedOrder.po_number}, attempted to receive ${qty} (+${varianceQty} extra).`
          };
        }
      } else if (nextRec === ordered) {
        deliveryStatus = 'full';
        remainingAfter = 0;
      } else {
        deliveryStatus = 'partial';
        remainingAfter = ordered - nextRec;
      }

      matchedLine = {
        ...currentLine,
        quantity_received: nextRec,
        updated_at: timestamp
      };
      updatedOrder.items[lineIdx] = matchedLine;
    }

    const allCompleted = updatedOrder.items.every(
      it => (Number(it.quantity_received) || 0) >= (Number(it.quantity_ordered) || 0)
    );
    const anyReceived = updatedOrder.items.some(it => (Number(it.quantity_received) || 0) > 0);
    updatedOrder.status = allCompleted
      ? 'received'
      : anyReceived
        ? 'partially_received'
        : (updatedOrder.status || 'ordered');
    updatedOrder.updated_at = timestamp;
  }

  const targetSite = String(siteCode || updatedOrder?.site_code || 'DC-MDC').trim() || 'DC-MDC';

  // Mint individually tracked tool assets when receiving tools
  const newToolAssets = [];
  const reservedTags = new Set();
  if (catalogItem.item_kind === 'tool') {
    for (let i = 0; i < qty; i += 1) {
      const serial = parsedSerials.serials[i] || null;
      const assetTag = generateNextAssetTag(toolAssets, cleanPn, reservedTags);
      newToolAssets.push({
        id: generateCtId('ct-asset'),
        catalog_id: catalogItem.id,
        part_number: cleanPn,
        description: catalogItem.description,
        asset_tag: assetTag,
        serial_number: serial,
        site_code: targetSite,
        order_id: updatedOrder?.id || null,
        shipment_id: null,
        status: 'available',
        assigned_to: null,
        assigned_at: null,
        received_at: timestamp,
        received_by: actorId,
        received_by_name: actorName,
        shipped_at: null,
        shipped_by_name: null,
        notes: notes || null,
        created_at: timestamp,
        updated_at: timestamp
      });
    }
  }

  // Upsert site stock row
  const nextStockRows = [...(stockRows || [])];
  const existingStockIdx = nextStockRows.findIndex(
    s =>
      ((s.catalog_id && s.catalog_id === catalogItem.id) || normalizePartNumber(s.part_number) === cleanPn) &&
      String(s.site_code || '').toUpperCase() === targetSite.toUpperCase()
  );

  let updatedStockRow;
  if (existingStockIdx >= 0) {
    const prev = nextStockRows[existingStockIdx];
    const mergedSerials = Array.from(
      new Set([...(prev.serial_numbers || []), ...parsedSerials.serials])
    );
    updatedStockRow = {
      ...prev,
      qty_on_hand: (Number(prev.qty_on_hand) || 0) + qty,
      serial_numbers: mergedSerials,
      last_received_at: timestamp,
      last_updated_by: actorId,
      last_updated_by_name: actorName,
      updated_at: timestamp
    };
    nextStockRows[existingStockIdx] = updatedStockRow;
  } else {
    updatedStockRow = {
      id: generateCtId('ct-stk'),
      catalog_id: catalogItem.id,
      part_number: cleanPn,
      description: catalogItem.description,
      item_kind: catalogItem.item_kind,
      site_code: targetSite,
      qty_on_hand: qty,
      serial_numbers: [...parsedSerials.serials],
      qty_reserved: 0,
      qty_consumed: 0,
      qty_shipped: 0,
      min_stock_threshold: Number(catalogItem.min_stock_threshold) || 2,
      reorder_qty: Number(catalogItem.reorder_qty) || 5,
      last_received_at: timestamp,
      last_updated_by: actorId,
      last_updated_by_name: actorName,
      updated_at: timestamp
    };
    nextStockRows.push(updatedStockRow);
  }

  const newAssetTags = newToolAssets.map(a => a.asset_tag);
  const varianceNote =
    deliveryStatus === 'over_delivery'
      ? `Over-delivery (+${varianceQty} above PO qty)`
      : deliveryStatus === 'partial'
        ? `Partial delivery (${remainingAfter} remaining on PO)`
        : '';

  const combinedNotes = [notes, varianceNote].filter(Boolean).join(' · ') || null;

  const receivedMovement = {
    id: generateCtId('ct-mov'),
    catalog_id: catalogItem.id,
    part_number: cleanPn,
    description: catalogItem.description,
    item_kind: catalogItem.item_kind,
    action: 'received',
    quantity: qty,
    serial_numbers: parsedSerials.serials,
    asset_tags: newAssetTags,
    from_site_code: updatedOrder?.supplier || 'APPLE',
    to_site_code: targetSite,
    reference_type: updatedOrder ? 'order' : 'ad_hoc_receipt',
    reference_id: updatedOrder?.id || null,
    reference_number: updatedOrder?.po_number || 'DIRECT-SCAN',
    performed_by: actorId,
    performed_by_name: actorName,
    notes: combinedNotes,
    created_at: timestamp
  };

  const inStockMovement = {
    id: generateCtId('ct-mov'),
    catalog_id: catalogItem.id,
    part_number: cleanPn,
    description: catalogItem.description,
    item_kind: catalogItem.item_kind,
    action: 'in_stock',
    quantity: qty,
    serial_numbers: parsedSerials.serials,
    asset_tags: newAssetTags,
    from_site_code: 'RECEIVING_DOCK',
    to_site_code: targetSite,
    reference_type: 'stock',
    reference_id: updatedStockRow.id,
    reference_number: `${targetSite}-STOCK`,
    performed_by: actorId,
    performed_by_name: actorName,
    notes: `Placed ${qty} ${catalogItem.item_kind === 'tool' ? 'tool(s)' : 'unit(s)'} into ${targetSite} available inventory`,
    created_at: timestamp
  };

  return {
    ok: true,
    deliveryStatus,
    isPartialDelivery: deliveryStatus === 'partial',
    isOverDelivery: deliveryStatus === 'over_delivery',
    varianceQty,
    remainingBefore,
    remainingAfter,
    catalogItem,
    updatedOrder,
    matchedLine,
    updatedStockRow,
    nextStockRows,
    newToolAssets,
    nextToolAssets: [...newToolAssets, ...(toolAssets || [])],
    movements: [receivedMovement, inStockMovement]
  };
}

export function parseConsumablesReceivingCsv(csvText, catalogItems = []) {
  const records = parseCsvRecords(csvText);
  if (!Array.isArray(records) || records.length === 0) {
    return { validRows: [], errorRows: [], headers: [] };
  }

  const headers = Object.keys(records[0] || {});
  const colKey = {
    poNumber: headers.find(h => /po.?num|po#|order/i.test(h)),
    partNumber: headers.find(h => /part.?num|sku|\bpn\b|item/i.test(h)),
    quantity: headers.find(h => /qty|quantity|delivered/i.test(h)),
    serials: headers.find(h => /serial|sn\b/i.test(h)),
    siteCode: headers.find(h => /site|branch|location/i.test(h)),
    notes: headers.find(h => /note|remark/i.test(h))
  };

  const { byPn } = buildCatalogLookup(catalogItems);
  const validRows = [];
  const errorRows = [];

  records.forEach((rec, idx) => {
    const rowNumber = idx + 2;
    const poNumber = colKey.poNumber ? String(rec[colKey.poNumber] || '').trim() : '';
    const partNumber = normalizePartNumber(colKey.partNumber ? rec[colKey.partNumber] : '');
    const qtyRaw = colKey.quantity ? rec[colKey.quantity] : '1';
    const quantity = parseInt(String(qtyRaw || '').trim(), 10);
    const serialsRaw = colKey.serials ? rec[colKey.serials] : '';
    const siteCode = colKey.siteCode ? String(rec[colKey.siteCode] || '').trim() : '';
    const notes = colKey.notes ? String(rec[colKey.notes] || '').trim() : '';

    if (!partNumber) {
      errorRows.push({ rowNumber, poNumber, partNumber, errorCode: 'MISSING_PART_NUMBER', message: 'Missing Part Number' });
      return;
    }

    const catalogItem = byPn.get(partNumber);
    if (!catalogItem) {
      errorRows.push({ rowNumber, poNumber, partNumber, errorCode: 'UNKNOWN_PART_NUMBER', message: `Unknown Part Number ${partNumber}` });
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      errorRows.push({ rowNumber, poNumber, partNumber, errorCode: 'QUANTITY_MISMATCH', message: `Invalid quantity "${qtyRaw}"` });
      return;
    }

    const { serials, duplicatesInBatch } = parseSerialTokens(serialsRaw);
    if (duplicatesInBatch.length > 0) {
      errorRows.push({
        rowNumber,
        poNumber,
        partNumber,
        errorCode: 'DUPLICATE_TOOL_SERIAL',
        message: `Duplicate serials in row: ${duplicatesInBatch.join(', ')}`
      });
      return;
    }

    if (catalogItem.item_kind === 'tool' && catalogItem.is_serialized && serials.length !== quantity) {
      errorRows.push({
        rowNumber,
        poNumber,
        partNumber,
        errorCode: 'QUANTITY_MISMATCH',
        message: `Serialized tool requires ${quantity} serial(s), found ${serials.length}`
      });
      return;
    }

    validRows.push({
      rowNumber,
      poNumber,
      partNumber,
      catalogItem,
      quantity,
      serials,
      siteCode,
      notes
    });
  });

  return { validRows, errorRows, headers };
}

export function transitionToolAsset({
  toolAssets = [],
  assetId,
  action,
  newStatus,
  assignedTo = null,
  siteCode = null,
  actorName = 'DC Staff',
  actorId = null,
  notes = '',
  timestamp = new Date().toISOString()
}) {
  const idx = (toolAssets || []).findIndex(a => a.id === assetId);
  if (idx === -1) {
    return { ok: false, errorCode: 'ASSET_NOT_FOUND', message: 'Tool asset not found.' };
  }

  const current = toolAssets[idx];
  if (!TOOL_ASSET_STATUSES.includes(newStatus)) {
    return { ok: false, errorCode: 'INVALID_STATUS', message: `Unsupported tool status "${newStatus}".` };
  }

  const updated = {
    ...current,
    status: newStatus,
    assigned_to: newStatus === 'in_use' ? (assignedTo || current.assigned_to || actorName) : (newStatus === 'available' ? null : current.assigned_to),
    assigned_at: newStatus === 'in_use' ? timestamp : (newStatus === 'available' ? null : current.assigned_at),
    site_code: siteCode || current.site_code,
    notes: notes || current.notes,
    updated_at: timestamp
  };

  const nextToolAssets = [...toolAssets];
  nextToolAssets[idx] = updated;

  const movement = {
    id: generateCtId('ct-mov'),
    catalog_id: current.catalog_id,
    part_number: current.part_number,
    description: current.description,
    item_kind: 'tool',
    action: action || 'status_change',
    quantity: 1,
    serial_numbers: current.serial_number ? [current.serial_number] : [],
    asset_tags: [current.asset_tag],
    from_site_code: current.site_code,
    to_site_code: updated.site_code,
    reference_type: 'tool_asset',
    reference_id: current.id,
    reference_number: current.asset_tag,
    performed_by: actorId,
    performed_by_name: actorName,
    notes: notes || `Tool ${current.asset_tag} ${current.status} -> ${newStatus}${updated.assigned_to ? ` (${updated.assigned_to})` : ''}`,
    created_at: timestamp
  };

  return { ok: true, updatedAsset: updated, nextToolAssets, movement };
}

export function consumeConsumableStock({
  catalogItems = [],
  stockRows = [],
  partNumber,
  siteCode = 'DC-MDC',
  quantity,
  actorName = 'Technician',
  actorId = null,
  notes = '',
  timestamp = new Date().toISOString()
}) {
  const cleanPn = normalizePartNumber(partNumber);
  const { byPn } = buildCatalogLookup(catalogItems);
  const catalogItem = byPn.get(cleanPn);
  if (!catalogItem) {
    return { ok: false, errorCode: 'UNKNOWN_PART_NUMBER', message: `Unknown item "${cleanPn}".` };
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    return { ok: false, errorCode: 'QUANTITY_MISMATCH', message: 'Consume quantity must be a positive integer.' };
  }

  const idx = (stockRows || []).findIndex(
    s =>
      ((s.catalog_id && s.catalog_id === catalogItem.id) || normalizePartNumber(s.part_number) === cleanPn) &&
      String(s.site_code || '').toUpperCase() === String(siteCode).toUpperCase()
  );
  if (idx === -1 || (Number(stockRows[idx].qty_on_hand) || 0) < qty) {
    const avail = idx >= 0 ? (Number(stockRows[idx].qty_on_hand) || 0) : 0;
    return {
      ok: false,
      errorCode: 'INSUFFICIENT_STOCK',
      availableQty: avail,
      requestedQty: qty,
      message: `Insufficient stock for ${cleanPn} at ${siteCode}: available ${avail}, requested ${qty}.`
    };
  }

  const updatedRow = {
    ...stockRows[idx],
    qty_on_hand: (Number(stockRows[idx].qty_on_hand) || 0) - qty,
    qty_consumed: (Number(stockRows[idx].qty_consumed) || 0) + qty,
    last_updated_by: actorId,
    last_updated_by_name: actorName,
    updated_at: timestamp
  };
  const nextStockRows = [...stockRows];
  nextStockRows[idx] = updatedRow;

  const movement = {
    id: generateCtId('ct-mov'),
    catalog_id: catalogItem.id,
    part_number: cleanPn,
    description: catalogItem.description,
    item_kind: catalogItem.item_kind,
    action: 'consumed',
    quantity: qty,
    serial_numbers: [],
    asset_tags: [],
    from_site_code: siteCode,
    to_site_code: 'CONSUMED',
    reference_type: 'consumption',
    reference_id: updatedRow.id,
    reference_number: `${siteCode}-USE`,
    performed_by: actorId,
    performed_by_name: actorName,
    notes: notes || `Consumed ${qty} ${catalogItem.unit_of_measure || 'units'} at ${siteCode}`,
    created_at: timestamp
  };

  return { ok: true, updatedStockRow: updatedRow, nextStockRows, movement };
}

export function generateNextCtShipmentNumbers(existingShipments = [], isoDate = new Date().toISOString()) {
  const ym = String(isoDate || '').slice(0, 7).replace('-', '') || '202611';
  const maxSeq = (existingShipments || []).reduce((max, shp) => {
    const m = String(shp.shipment_number || '').match(/(\d+)$/);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  const seqStr = String(maxSeq + 1).padStart(4, '0');
  return {
    shipment_number: `CT-SHP-${ym}-${seqStr}`,
    packing_list_number: `CT-PL-${ym}-${seqStr}`
  };
}

export function getSitePackingCandidates({
  targetSiteCode = '',
  fromSiteCode = 'DC-MDC',
  catalogItems = [],
  stockRows = [],
  toolAssets = [],
  orders = [],
  existingShipments = []
} = {}) {
  const cleanTarget = String(targetSiteCode || '').trim().toUpperCase();
  const cleanFrom = String(fromSiteCode || '').trim().toUpperCase();
  const { byPn } = buildCatalogLookup(catalogItems);

  // Track already-shipped quantities per (to_site, part_number) for PO-derived fallback
  const shippedToTargetByPn = new Map();
  if (cleanTarget) {
    (existingShipments || []).forEach(shp => {
      if (String(shp.to_site_code || '').toUpperCase() !== cleanTarget) return;
      (shp.items || []).forEach(it => {
        const pn = normalizePartNumber(it.part_number);
        if (!pn) return;
        shippedToTargetByPn.set(pn, (shippedToTargetByPn.get(pn) || 0) + (Number(it.quantity) || 0));
      });
    });
  }

  const buildCandidatesForSite = (siteCodeToMatch, includeAssignedOrders = false) => {
    if (!siteCodeToMatch) return [];
    const candidateMap = new Map();

    // 1. Individually tracked available tool assets at this site
    const toolsByPn = new Map();
    (toolAssets || []).forEach(asset => {
      if (asset.status !== 'available') return;
      if (String(asset.site_code || '').toUpperCase() !== siteCodeToMatch) return;
      const pn = normalizePartNumber(asset.part_number);
      if (!pn) return;
      if (!toolsByPn.has(pn)) toolsByPn.set(pn, []);
      toolsByPn.get(pn).push(asset);
    });

    toolsByPn.forEach((assets, pn) => {
      const cat = byPn.get(pn);
      candidateMap.set(pn, {
        part_number: pn,
        description: cat?.description || assets[0]?.description || pn,
        item_kind: 'tool',
        availableQty: assets.length,
        sourceSiteCode: siteCodeToMatch,
        sourceLabel: `${siteCodeToMatch} Tool Stock`,
        poNumbers: [],
        availableAssets: assets,
        serial_numbers: assets.map(a => a.serial_number || a.asset_tag).filter(Boolean)
      });
    });

    // 2. Consumables / stock rows with qty_on_hand > 0 at this site
    (stockRows || []).forEach(row => {
      if (String(row.site_code || '').toUpperCase() !== siteCodeToMatch) return;
      const onHand = Number(row.qty_on_hand) || 0;
      if (onHand <= 0) return;
      const pn = normalizePartNumber(row.part_number);
      if (!pn) return;
      const cat = byPn.get(pn);
      const kind = row.item_kind || cat?.item_kind || 'consumable';
      if (candidateMap.has(pn) && kind === 'tool') return; // Already counted via individual assets

      const rowSerials = Array.isArray(row.serial_numbers) ? row.serial_numbers.filter(Boolean) : [];
      const existing = candidateMap.get(pn);
      if (existing) {
        existing.availableQty += onHand;
        existing.serial_numbers = Array.from(new Set([...(existing.serial_numbers || []), ...rowSerials]));
      } else {
        candidateMap.set(pn, {
          part_number: pn,
          description: cat?.description || row.description || pn,
          item_kind: kind,
          availableQty: onHand,
          sourceSiteCode: siteCodeToMatch,
          sourceLabel: `${siteCodeToMatch} Received Stock`,
          poNumbers: [],
          availableAssets: [],
          serial_numbers: [...rowSerials]
        });
      }
    });

    // 3. Annotate with PO numbers assigned to this site (and catch received PO lines staged at fromSite)
    if (includeAssignedOrders) {
      const poReceivedByPn = new Map();
      (orders || []).forEach(ord => {
        if (String(ord.site_code || '').toUpperCase() !== siteCodeToMatch) return;
        (ord.items || []).forEach(it => {
          const rec = Number(it.quantity_received) || 0;
          if (rec <= 0) return;
          const pn = normalizePartNumber(it.part_number);
          if (!pn) return;
          const existing = candidateMap.get(pn);
          if (existing) {
            if (ord.po_number && !existing.poNumbers.includes(ord.po_number)) {
              existing.poNumbers.push(ord.po_number);
            }
            return;
          }
          // Fallback: PO for target site was received into fromSite stock instead of targetSite
          if (!poReceivedByPn.has(pn)) {
            poReceivedByPn.set(pn, { qty: 0, pos: [], desc: it.description, kind: it.item_kind });
          }
          const entry = poReceivedByPn.get(pn);
          entry.qty += rec;
          if (ord.po_number && !entry.pos.includes(ord.po_number)) entry.pos.push(ord.po_number);
        });
      });

      poReceivedByPn.forEach((info, pn) => {
        if (candidateMap.has(pn) || !cleanFrom || cleanFrom === siteCodeToMatch) return;
        const fromRow = (stockRows || []).find(
          r =>
            normalizePartNumber(r.part_number) === pn &&
            String(r.site_code || '').toUpperCase() === cleanFrom &&
            (Number(r.qty_on_hand) || 0) > 0
        );
        const fromAssets = (toolAssets || []).filter(
          a =>
            a.status === 'available' &&
            normalizePartNumber(a.part_number) === pn &&
            String(a.site_code || '').toUpperCase() === cleanFrom
        );
        const unshippedFromPo = Math.max(0, info.qty - (shippedToTargetByPn.get(pn) || 0));
        const usableQty = info.kind === 'tool' && fromAssets.length > 0
          ? Math.min(fromAssets.length, unshippedFromPo || fromAssets.length)
          : Math.min(Number(fromRow?.qty_on_hand) || 0, unshippedFromPo || (Number(fromRow?.qty_on_hand) || 0));

        if (usableQty > 0) {
          const cat = byPn.get(pn);
          candidateMap.set(pn, {
            part_number: pn,
            description: cat?.description || info.desc || pn,
            item_kind: info.kind || cat?.item_kind || 'consumable',
            availableQty: usableQty,
            sourceSiteCode: cleanFrom,
            sourceLabel: `PO ${info.pos.join(', ')} (at ${cleanFrom})`,
            poNumbers: info.pos,
            availableAssets: info.kind === 'tool' ? fromAssets : [],
            serial_numbers: info.kind === 'tool'
              ? fromAssets.map(a => a.serial_number || a.asset_tag).filter(Boolean)
              : [...(Array.isArray(fromRow?.serial_numbers) ? fromRow.serial_numbers.filter(Boolean) : [])]
          });
        }
      });
    }

    return Array.from(candidateMap.values()).sort((a, b) => a.part_number.localeCompare(b.part_number));
  };

  const siteCandidates = cleanTarget ? buildCandidatesForSite(cleanTarget, true) : [];
  const fromCandidates = cleanFrom && cleanFrom !== cleanTarget ? buildCandidatesForSite(cleanFrom, false) : [];

  return {
    targetSiteCode: cleanTarget,
    fromSiteCode: cleanFrom,
    siteCandidates,
    fromCandidates
  };
}

export function validateAndScanPackItem({
  scanToken = '',
  serialToken = '',
  pendingPartNumber = '',
  targetSiteCode = '',
  fromSiteCode = 'DC-MDC',
  catalogItems = [],
  stockRows = [],
  toolAssets = [],
  orders = [],
  existingShipments = [],
  currentBoxLines = [],
  scanQty = 1
} = {}) {
  const cleanScan = normalizePartNumber(scanToken);
  const cleanSerial = normalizePartNumber(serialToken);
  const cleanPendingPn = normalizePartNumber(pendingPartNumber);
  const qty = Math.max(1, parseInt(scanQty, 10) || 1);

  if (!cleanScan && !cleanSerial) {
    return { ok: false, errorCode: 'EMPTY_SCAN', message: 'Scan a Part Number or Serial Number.' };
  }

  const { byPn } = buildCatalogLookup(catalogItems);
  const { siteCandidates, fromCandidates } = getSitePackingCandidates({
    targetSiteCode,
    fromSiteCode,
    catalogItems,
    stockRows,
    toolAssets,
    orders,
    existingShipments
  });

  // Prefer selected target site candidates first, then origin pool
  const combinedCandidates = [];
  const seenKey = new Set();
  [...siteCandidates, ...fromCandidates].forEach(c => {
    const key = `${c.part_number}::${c.sourceSiteCode}`;
    if (!seenKey.has(key)) {
      seenKey.add(key);
      combinedCandidates.push(c);
    }
  });

  const stagedQtyByKey = new Map();
  const stagedAssetIds = new Set();
  const stagedSerials = new Set();
  (currentBoxLines || []).forEach(ln => {
    const key = `${normalizePartNumber(ln.part_number)}::${String(ln.sourceSiteCode || fromSiteCode).toUpperCase()}`;
    stagedQtyByKey.set(key, (stagedQtyByKey.get(key) || 0) + (Number(ln.quantity) || 0));
    (ln.assetIds || []).forEach(id => stagedAssetIds.add(id));
    (ln.serial_numbers || []).forEach(sn => {
      const s = normalizePartNumber(sn);
      if (s) stagedSerials.add(s);
    });
  });

  const appendVerifiedToBox = ({ pn, description, item_kind, sourceSiteCode, addQty, asset = null, stockSerial = null }) => {
    const nextBoxLines = (currentBoxLines || []).map(ln => ({
      ...ln,
      assetIds: [...(ln.assetIds || [])],
      serial_numbers: [...(ln.serial_numbers || [])]
    }));

    const existingIdx = nextBoxLines.findIndex(
      ln =>
        normalizePartNumber(ln.part_number) === pn &&
        String(ln.sourceSiteCode || fromSiteCode).toUpperCase() === String(sourceSiteCode || fromSiteCode).toUpperCase()
    );

    const snOrTag = asset ? (asset.serial_number || asset.asset_tag) : (stockSerial || null);
    if (existingIdx >= 0) {
      nextBoxLines[existingIdx].quantity = (Number(nextBoxLines[existingIdx].quantity) || 0) + addQty;
      nextBoxLines[existingIdx].box_verified = true;
      if (asset?.id && !nextBoxLines[existingIdx].assetIds.includes(asset.id)) {
        nextBoxLines[existingIdx].assetIds.push(asset.id);
      }
      if (snOrTag && !nextBoxLines[existingIdx].serial_numbers.includes(snOrTag)) {
        nextBoxLines[existingIdx].serial_numbers.push(snOrTag);
      }
    } else {
      nextBoxLines.push({
        part_number: pn,
        description,
        item_kind,
        quantity: addQty,
        sourceSiteCode: sourceSiteCode || fromSiteCode,
        assetIds: asset?.id ? [asset.id] : [],
        serial_numbers: snOrTag ? [snOrTag] : [],
        box_verified: true
      });
    }

    return {
      ok: true,
      status: 'PACKED',
      packedPartNumber: pn,
      packedSerial: snOrTag,
      packedQty: addQty,
      nextBoxLines,
      message: snOrTag
        ? `Placed ${pn} (S/N: ${snOrTag}) into box.`
        : `Placed ${addQty}x ${pn} into box.`
    };
  };

  // Helper to match an available tool asset by serial_number or asset_tag
  const allowedSites = new Set(
    [targetSiteCode, fromSiteCode].map(s => String(s || '').trim().toUpperCase()).filter(Boolean)
  );
  const findAssetByToken = (token, requiredPn = null) => {
    if (!token) return null;
    const matches = (toolAssets || []).filter(a => {
      const sn = normalizePartNumber(a.serial_number);
      const tag = normalizePartNumber(a.asset_tag);
      if (sn !== token && tag !== token) return false;
      if (requiredPn && normalizePartNumber(a.part_number) !== requiredPn) return false;
      if (allowedSites.size > 0 && !allowedSites.has(String(a.site_code || '').toUpperCase())) return false;
      return true;
    });
    return matches.find(a => a.status === 'available' && !stagedAssetIds.has(a.id)) || matches[0] || null;
  };

  const findStockSerialCandidate = (token, requiredPn = null) => {
    if (!token) return null;
    for (const c of combinedCandidates) {
      if (requiredPn && c.part_number !== requiredPn) continue;
      const key = `${c.part_number}::${String(c.sourceSiteCode || fromSiteCode).toUpperCase()}`;
      const remQty = Math.max(0, (Number(c.availableQty) || 0) - (stagedQtyByKey.get(key) || 0));
      if (remQty <= 0) continue;
      const matchedSn = (c.serial_numbers || []).find(sn => normalizePartNumber(sn) === token);
      if (matchedSn) return { candidate: c, serialNumber: matchedSn };
    }
    return null;
  };

  // Case 1: Completing Step 2 (Serial Number scan for pending tool/consumable PN)
  if (cleanPendingPn) {
    const tokenForSerial = cleanSerial || cleanScan;
    if (stagedSerials.has(tokenForSerial)) {
      return {
        ok: false,
        errorCode: 'DUPLICATE_IN_BOX',
        message: `Serial/Tag ${tokenForSerial} is already placed in this box.`
      };
    }
    const matchedAsset = findAssetByToken(tokenForSerial, cleanPendingPn);
    if (matchedAsset) {
      if (matchedAsset.status !== 'available') {
        return {
          ok: false,
          errorCode: 'ASSET_NOT_AVAILABLE',
          message: `Tool ${tokenForSerial} has status "${matchedAsset.status}" and cannot be packed.`
        };
      }
      if (stagedAssetIds.has(matchedAsset.id)) {
        return {
          ok: false,
          errorCode: 'DUPLICATE_IN_BOX',
          message: `Tool ${tokenForSerial} is already placed in this box.`
        };
      }
      return appendVerifiedToBox({
        pn: cleanPendingPn,
        description: matchedAsset.description || byPn.get(cleanPendingPn)?.description || cleanPendingPn,
        item_kind: 'tool',
        sourceSiteCode: matchedAsset.site_code,
        addQty: 1,
        asset: matchedAsset
      });
    }
    const stockMatch = findStockSerialCandidate(tokenForSerial, cleanPendingPn);
    if (stockMatch) {
      return appendVerifiedToBox({
        pn: stockMatch.candidate.part_number,
        description: stockMatch.candidate.description,
        item_kind: stockMatch.candidate.item_kind || 'consumable',
        sourceSiteCode: stockMatch.candidate.sourceSiteCode,
        addQty: 1,
        stockSerial: stockMatch.serialNumber
      });
    }
    return {
      ok: false,
      errorCode: 'SERIAL_MISMATCH',
      message: `Serial/Tag "${tokenForSerial}" was not found as an available unit for ${cleanPendingPn}.`
    };
  }

  // Case 2: Direct Serial / Asset Tag scan without scanning PN first
  const directAsset = findAssetByToken(cleanSerial || cleanScan, null);
  if (directAsset) {
    if (stagedAssetIds.has(directAsset.id) || stagedSerials.has(normalizePartNumber(directAsset.serial_number || directAsset.asset_tag))) {
      return {
        ok: false,
        errorCode: 'DUPLICATE_IN_BOX',
        message: `Tool ${directAsset.serial_number || directAsset.asset_tag} is already placed in this box.`
      };
    }
    if (directAsset.status !== 'available') {
      return {
        ok: false,
        errorCode: 'ASSET_NOT_AVAILABLE',
        message: `Tool ${directAsset.serial_number || directAsset.asset_tag} is "${directAsset.status}" (not available).`
      };
    }
    const pn = normalizePartNumber(directAsset.part_number);
    return appendVerifiedToBox({
      pn,
      description: directAsset.description || byPn.get(pn)?.description || pn,
      item_kind: 'tool',
      sourceSiteCode: directAsset.site_code,
      addQty: 1,
      asset: directAsset
    });
  }

  const directStockSerial = findStockSerialCandidate(cleanSerial || cleanScan, null);
  if (directStockSerial && (cleanSerial || !combinedCandidates.some(c => c.part_number === cleanScan))) {
    if (stagedSerials.has(normalizePartNumber(directStockSerial.serialNumber))) {
      return {
        ok: false,
        errorCode: 'DUPLICATE_IN_BOX',
        message: `Serial ${directStockSerial.serialNumber} is already placed in this box.`
      };
    }
    return appendVerifiedToBox({
      pn: directStockSerial.candidate.part_number,
      description: directStockSerial.candidate.description,
      item_kind: directStockSerial.candidate.item_kind || 'consumable',
      sourceSiteCode: directStockSerial.candidate.sourceSiteCode,
      addQty: 1,
      stockSerial: directStockSerial.serialNumber
    });
  }

  // Case 3: Part Number scan
  const cand = combinedCandidates.find(c => c.part_number === cleanScan);
  if (!cand) {
    const inCatalog = byPn.get(cleanScan);
    if (!inCatalog) {
      return {
        ok: false,
        errorCode: 'UNKNOWN_PART_NUMBER',
        message: `Scanned code "${cleanScan}" is not an available part number or serial for ${targetSiteCode || fromSiteCode}.`
      };
    }
    return {
      ok: false,
      errorCode: 'INSUFFICIENT_STOCK',
      message: `Part ${cleanScan} has 0 available stock for ${targetSiteCode || fromSiteCode}.`
    };
  }

  const key = `${cand.part_number}::${String(cand.sourceSiteCode || fromSiteCode).toUpperCase()}`;
  const remainingQty = Math.max(0, (Number(cand.availableQty) || 0) - (stagedQtyByKey.get(key) || 0));
  if (remainingQty < qty) {
    return {
      ok: false,
      errorCode: 'INSUFFICIENT_STOCK',
      message: `No remaining stock for ${cand.part_number} (${remainingQty} left, requested ${qty}).`
    };
  }

  const catItem = byPn.get(cand.part_number);
  const remainingAssets = (cand.availableAssets || []).filter(a => !stagedAssetIds.has(a.id));
  const requiresSerialScan =
    cand.item_kind === 'tool' &&
    (Boolean(catItem?.is_serialized) || remainingAssets.some(a => Boolean(a.serial_number)));

  if (requiresSerialScan) {
    if (cleanSerial) {
      const matched = findAssetByToken(cleanSerial, cand.part_number);
      if (!matched || matched.status !== 'available' || stagedAssetIds.has(matched.id)) {
        return {
          ok: false,
          errorCode: 'SERIAL_MISMATCH',
          message: `Serial "${cleanSerial}" is not an available unit of ${cand.part_number}.`
        };
      }
      return appendVerifiedToBox({
        pn: cand.part_number,
        description: cand.description,
        item_kind: 'tool',
        sourceSiteCode: matched.site_code || cand.sourceSiteCode,
        addQty: 1,
        asset: matched
      });
    }
    return {
      ok: true,
      status: 'NEEDS_SERIAL',
      pendingPartNumber: cand.part_number,
      candidate: cand,
      message: `Part ${cand.part_number} verified. Scan Serial Number / Asset Tag to place in box.`
    };
  }

  // Non-serialized tool (with asset tags) or bulk consumable (with optional serials)
  if (cand.item_kind === 'tool' && remainingAssets.length > 0) {
    return appendVerifiedToBox({
      pn: cand.part_number,
      description: cand.description,
      item_kind: 'tool',
      sourceSiteCode: cand.sourceSiteCode,
      addQty: 1,
      asset: remainingAssets[0]
    });
  }

  const nextUnstagedStockSn = cleanSerial
    ? cleanSerial
    : (cand.serial_numbers || []).find(sn => !stagedSerials.has(normalizePartNumber(sn))) || null;

  return appendVerifiedToBox({
    pn: cand.part_number,
    description: cand.description,
    item_kind: cand.item_kind || 'consumable',
    sourceSiteCode: cand.sourceSiteCode,
    addQty: qty,
    stockSerial: nextUnstagedStockSn
  });
}

export function createConsumablesToolsShipment({
  catalogItems = [],
  stockRows = [],
  toolAssets = [],
  existingShipments = [],
  fromSiteCode = 'DC-MDC',
  fromSiteName = 'MOBILE CARE SERVICES PHILS. INC. - Distribution Center',
  toSiteCode,
  toSiteName,
  carrier = 'Lalamove',
  trackingNumber = '',
  tsNumber = '',
  shipmentDate = new Date().toISOString().slice(0, 10),
  notes = '',
  signatureName = '',
  lineRequests = [],
  actorName = 'DC Staff',
  actorId = null,
  status = 'shipped',
  timestamp = new Date().toISOString()
}) {
  if (!toSiteCode || !lineRequests || lineRequests.length === 0) {
    return {
      ok: false,
      errorCode: 'INVALID_SHIPMENT',
      message: 'Destination site and at least one item line are required to create a shipment.'
    };
  }

  const { byPn } = buildCatalogLookup(catalogItems);
  const nextStockRows = stockRows.map(s => ({ ...s }));
  const nextToolAssets = toolAssets.map(a => ({ ...a }));
  const shipmentId = generateCtId('ct-shp');
  const { shipment_number, packing_list_number } = generateNextCtShipmentNumbers(existingShipments, timestamp);

  const shipmentItems = [];
  const movements = [];

  for (const req of lineRequests) {
    const cleanPn = normalizePartNumber(req.part_number);
    const catalogItem = byPn.get(cleanPn);
    if (!catalogItem) {
      return { ok: false, errorCode: 'UNKNOWN_PART_NUMBER', message: `Unknown item "${cleanPn}" in shipment.` };
    }

    const qty = Number(req.quantity) || 0;
    if (!Number.isInteger(qty) || qty <= 0) {
      return { ok: false, errorCode: 'QUANTITY_MISMATCH', message: `Invalid shipment quantity for ${cleanPn}.` };
    }

    let attachedSerials = [];
    let attachedTags = [];
    const deductSiteCode = req.sourceSiteCode || fromSiteCode;

    if (catalogItem.item_kind === 'tool') {
      const requestedIds = Array.isArray(req.assetIds) && req.assetIds.length > 0 ? new Set(req.assetIds) : null;
      const eligibleAssets = nextToolAssets.filter(a => {
        const matchPn = (a.catalog_id && a.catalog_id === catalogItem.id) || normalizePartNumber(a.part_number) === cleanPn;
        if (!matchPn) return false;
        if (requestedIds) return requestedIds.has(a.id) && a.status === 'available';
        return (
          a.status === 'available' &&
          (!deductSiteCode || String(a.site_code || '').toUpperCase() === String(deductSiteCode).toUpperCase())
        );
      });

      if (eligibleAssets.length < qty) {
        return {
          ok: false,
          errorCode: 'INSUFFICIENT_STOCK',
          partNumber: cleanPn,
          message: `Only ${eligibleAssets.length} available tool asset(s) for ${cleanPn} at ${deductSiteCode}; requested ${qty}.`
        };
      }

      const selectedAssets = eligibleAssets.slice(0, qty);
      selectedAssets.forEach(asset => {
        asset.status = status === 'packed' ? 'in_transit' : 'shipped';
        asset.shipment_id = shipmentId;
        asset.shipped_at = timestamp;
        asset.shipped_by = actorId;
        asset.shipped_by_name = actorName;
        asset.updated_at = timestamp;
        if (asset.serial_number) attachedSerials.push(asset.serial_number);
        if (asset.asset_tag) attachedTags.push(asset.asset_tag);
      });

      const stkIdx = nextStockRows.findIndex(
        s =>
          ((s.catalog_id && s.catalog_id === catalogItem.id) || normalizePartNumber(s.part_number) === cleanPn) &&
          String(s.site_code || '').toUpperCase() === String(deductSiteCode).toUpperCase()
      );
      if (stkIdx >= 0) {
        nextStockRows[stkIdx].qty_on_hand = Math.max(0, (Number(nextStockRows[stkIdx].qty_on_hand) || 0) - qty);
        nextStockRows[stkIdx].qty_shipped = (Number(nextStockRows[stkIdx].qty_shipped) || 0) + qty;
        nextStockRows[stkIdx].updated_at = timestamp;
      }
    } else {
      const stkIdx = nextStockRows.findIndex(
        s =>
          ((s.catalog_id && s.catalog_id === catalogItem.id) || normalizePartNumber(s.part_number) === cleanPn) &&
          String(s.site_code || '').toUpperCase() === String(deductSiteCode).toUpperCase()
      );
      const avail = stkIdx >= 0 ? (Number(nextStockRows[stkIdx].qty_on_hand) || 0) : 0;
      if (avail < qty) {
        return {
          ok: false,
          errorCode: 'INSUFFICIENT_STOCK',
          partNumber: cleanPn,
          message: `Insufficient stock for ${cleanPn} at ${deductSiteCode}: available ${avail}, requested ${qty}.`
        };
      }
      const stockSerials = Array.isArray(nextStockRows[stkIdx].serial_numbers)
        ? nextStockRows[stkIdx].serial_numbers.filter(Boolean)
        : [];
      const reqSerials = Array.isArray(req.serial_numbers) ? req.serial_numbers.filter(Boolean) : [];
      if (reqSerials.length > 0) {
        attachedSerials = [...reqSerials];
      } else if (stockSerials.length > 0) {
        attachedSerials = stockSerials.slice(0, qty);
      }
      if (attachedSerials.length > 0 && stockSerials.length > 0) {
        const shippedSnSet = new Set(attachedSerials.map(s => String(s).trim().toUpperCase()));
        nextStockRows[stkIdx].serial_numbers = stockSerials.filter(
          s => !shippedSnSet.has(String(s).trim().toUpperCase())
        );
      }

      nextStockRows[stkIdx].qty_on_hand = avail - qty;
      nextStockRows[stkIdx].qty_shipped = (Number(nextStockRows[stkIdx].qty_shipped) || 0) + qty;
      nextStockRows[stkIdx].last_updated_by = actorId;
      nextStockRows[stkIdx].last_updated_by_name = actorName;
      nextStockRows[stkIdx].updated_at = timestamp;
    }

    shipmentItems.push({
      id: generateCtId('ct-shi'),
      shipment_id: shipmentId,
      catalog_id: catalogItem.id,
      part_number: cleanPn,
      description: catalogItem.description,
      item_kind: catalogItem.item_kind,
      quantity: qty,
      serial_numbers: attachedSerials,
      asset_tags: attachedTags,
      notes: req.notes || null
    });

    movements.push({
      id: generateCtId('ct-mov'),
      catalog_id: catalogItem.id,
      part_number: cleanPn,
      description: catalogItem.description,
      item_kind: catalogItem.item_kind,
      action: 'shipped',
      quantity: qty,
      serial_numbers: attachedSerials,
      asset_tags: attachedTags,
      from_site_code: fromSiteCode,
      to_site_code: toSiteCode,
      reference_type: 'shipment',
      reference_id: shipmentId,
      reference_number: shipment_number,
      performed_by: actorId,
      performed_by_name: actorName,
      notes: notes || `Shipped via ${packing_list_number} to ${toSiteCode}`,
      created_at: timestamp
    });
  }

  const shipment = {
    id: shipmentId,
    shipment_number,
    packing_list_number,
    from_site_code: fromSiteCode,
    from_site_name: fromSiteName,
    to_site_code: toSiteCode,
    to_site_name: toSiteName || toSiteCode,
    to_address: reqToAddressFallback(notes),
    shipment_date: shipmentDate,
    carrier,
    tracking_number: trackingNumber,
    ts_number: String(tsNumber || '').trim(),
    status,
    prepared_by: actorId,
    prepared_by_name: actorName,
    received_by_name: null,
    received_at: null,
    notes: notes || '',
    signature_name: signatureName || '',
    items: shipmentItems,
    created_at: timestamp,
    updated_at: timestamp
  };

  return {
    ok: true,
    shipment,
    nextStockRows,
    nextToolAssets,
    movements
  };
}

function reqToAddressFallback() {
  return '';
}

export function confirmConsumablesToolsDelivery({
  shipment,
  stockRows = [],
  toolAssets = [],
  receivedByName = 'Branch Receiver',
  signatureName = '',
  notes = '',
  actorName = 'Branch Receiver',
  actorId = null,
  timestamp = new Date().toISOString()
}) {
  if (!shipment || shipment.status === 'delivered') {
    return {
      ok: false,
      errorCode: 'ALREADY_DELIVERED',
      message: 'Shipment is already marked delivered or does not exist.'
    };
  }

  const nextStockRows = stockRows.map(s => ({ ...s }));
  const nextToolAssets = toolAssets.map(a => ({ ...a }));
  const movements = [];
  const destSite = shipment.to_site_code;

  (shipment.items || []).forEach(it => {
    const cleanPn = normalizePartNumber(it.part_number);
    if (it.item_kind === 'tool') {
      const tagSet = new Set(it.asset_tags || []);
      const serialSet = new Set(it.serial_numbers || []);
      nextToolAssets.forEach(a => {
        const matchesTag = a.asset_tag && tagSet.has(a.asset_tag);
        const matchesSerial = a.serial_number && serialSet.has(a.serial_number);
        const matchesShp = a.shipment_id === shipment.id && normalizePartNumber(a.part_number) === cleanPn;
        if (matchesTag || matchesSerial || matchesShp) {
          a.status = 'available';
          a.site_code = destSite;
          a.updated_at = timestamp;
        }
      });
    }

    const stkIdx = nextStockRows.findIndex(
      s =>
        ((s.catalog_id && s.catalog_id === it.catalog_id) || normalizePartNumber(s.part_number) === cleanPn) &&
        String(s.site_code || '').toUpperCase() === String(destSite).toUpperCase()
    );
    if (stkIdx >= 0) {
      nextStockRows[stkIdx].qty_on_hand = (Number(nextStockRows[stkIdx].qty_on_hand) || 0) + (Number(it.quantity) || 0);
      nextStockRows[stkIdx].last_received_at = timestamp;
      nextStockRows[stkIdx].last_updated_by_name = actorName;
      nextStockRows[stkIdx].updated_at = timestamp;
    } else {
      nextStockRows.push({
        id: generateCtId('ct-stk'),
        catalog_id: it.catalog_id,
        part_number: cleanPn,
        description: it.description,
        item_kind: it.item_kind,
        site_code: destSite,
        qty_on_hand: Number(it.quantity) || 0,
        qty_reserved: 0,
        qty_consumed: 0,
        qty_shipped: 0,
        min_stock_threshold: 2,
        reorder_qty: 5,
        last_received_at: timestamp,
        last_updated_by: actorId,
        last_updated_by_name: actorName,
        updated_at: timestamp
      });
    }

    movements.push({
      id: generateCtId('ct-mov'),
      catalog_id: it.catalog_id,
      part_number: cleanPn,
      description: it.description,
      item_kind: it.item_kind,
      action: 'delivered',
      quantity: Number(it.quantity) || 1,
      serial_numbers: it.serial_numbers || [],
      asset_tags: it.asset_tags || [],
      from_site_code: shipment.from_site_code,
      to_site_code: destSite,
      reference_type: 'shipment',
      reference_id: shipment.id,
      reference_number: shipment.packing_list_number,
      performed_by: actorId,
      performed_by_name: actorName,
      notes: notes || `Delivered & signed by ${receivedByName}`,
      created_at: timestamp
    });
  });

  const updatedShipment = {
    ...shipment,
    status: 'delivered',
    received_by_name: receivedByName,
    received_at: timestamp,
    signature_name: signatureName || receivedByName,
    notes: notes ? `${shipment.notes ? shipment.notes + ' | ' : ''}${notes}` : shipment.notes,
    updated_at: timestamp
  };

  return {
    ok: true,
    updatedShipment,
    nextStockRows,
    nextToolAssets,
    movements
  };
}
