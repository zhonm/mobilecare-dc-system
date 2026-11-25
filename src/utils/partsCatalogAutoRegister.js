/**
 * Auto-Registration Utility for Unregistered Part Numbers Discovered in CSV / Excel Uploads
 *
 * Ensures that whenever a user uploads a CSV/Excel file containing part numbers
 * not yet registered in the System Parts Catalog, those part numbers are accepted
 * and automatically added to the Parts Catalog without duplicating existing SKUs.
 */

import { resolvePartCategoryId } from './categoryFilter.js';

export function normalizeCatalogPartNumber(rawPn) {
  return String(rawPn || '').trim().toUpperCase();
}

/**
 * Computes new Part Catalog entries for any candidate items whose part_number
 * is not yet present in `existingParts`.
 *
 * @param {Array<Object>} existingParts - Current System Parts Master Catalog array
 * @param {Array<Object>} candidateItems - Raw items parsed from a CSV/Excel upload
 * @param {Array<Object>} categories - Active part category definitions
 * @returns {{ nextParts: Array<Object>, addedParts: Array<Object>, addedCount: number }}
 */
export function buildAutoRegisteredParts(existingParts = [], candidateItems = [], categories = []) {
  const existingList = Array.isArray(existingParts) ? existingParts : [];
  const existingSet = new Set(
    existingList.map(p => normalizeCatalogPartNumber(p?.part_number)).filter(Boolean)
  );

  const otherCat = (categories || []).find(c => String(c.code || '').toUpperCase() === 'OTHER');
  const otherCatId = otherCat?.id || 'cat-other';

  const nowIso = new Date().toISOString();
  const addedParts = [];
  const seenInBatch = new Set();

  (Array.isArray(candidateItems) ? candidateItems : []).forEach((item, idx) => {
    if (!item) return;
    const rawPn =
      item.part_number ??
      item.partNumber ??
      item.pn ??
      item.PN ??
      item['Part Number'] ??
      '';
    const cleanPn = normalizeCatalogPartNumber(rawPn);
    if (!cleanPn || existingSet.has(cleanPn) || seenInBatch.has(cleanPn)) return;

    seenInBatch.add(cleanPn);

    const rawDesc =
      item.description ??
      item.part_description ??
      item.partDescription ??
      item.name ??
      item.part_name ??
      '';
    const cleanDesc = String(rawDesc || '').trim() || `Part ${cleanPn}`;

    const rawKind = String(item.item_kind || item.itemKind || item.part_type || '').trim().toLowerCase();
    const itemKind = rawKind === 'tool' || rawKind === 'service tool'
      ? 'tool'
      : (rawKind === 'consumable' || rawKind === 'consumables' ? 'consumable' : null);

    const parsedPrice = Number(
      item.stocking_price ??
      item.stock_price ??
      item.unit_price ??
      item.unit_cost ??
      item.partValue ??
      item.part_value ??
      0
    );
    const safePrice = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : 0;

    const categoryId = itemKind
      ? otherCatId
      : (item.category_id || resolvePartCategoryId({ part_number: cleanPn, description: cleanDesc }, categories));

    const defaultModel = itemKind === 'tool'
      ? 'Service Tool'
      : itemKind === 'consumable'
        ? 'Consumable'
        : 'iPhone';

    const newPart = {
      id: `part-auto-${Date.now()}-${idx}-${cleanPn.replace(/[^A-Z0-9]/g, '')}`,
      part_number: cleanPn,
      description: cleanDesc,
      iphone_model: String(item.iphone_model || item.model || '').trim() || defaultModel,
      category_id: categoryId,
      stocking_price: safePrice,
      ...(itemKind ? { item_kind: itemKind } : {}),
      is_active: true,
      auto_registered: true,
      created_at: nowIso,
      updated_at: nowIso
    };

    addedParts.push(newPart);
  });

  if (addedParts.length === 0) {
    return { nextParts: existingList, addedParts: [], addedCount: 0 };
  }

  const nextParts = [...addedParts, ...existingList].sort((a, b) =>
    String(a.part_number || '').localeCompare(String(b.part_number || ''))
  );

  return {
    nextParts,
    addedParts,
    addedCount: addedParts.length
  };
}
