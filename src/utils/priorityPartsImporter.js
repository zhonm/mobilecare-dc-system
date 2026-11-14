/**
 * Priority Parts (Consumables & Tools) CSV Importer
 *
 * Seeds the Consumables & Tools catalog and initial POs from Priority parts.csv,
 * separates quantity-based Consumables from individually-tracked Tools,
 * generates synthetic SKUs for N/A entries, resolves description conflicts against
 * official GSX descriptions when available, and produces needs-review and
 * description-conflict reports.
 */

import { parseCsvRecords } from './gsxCatalogImporter.js';

export const PRIORITY_SITE_CODE_ALIASES = {
  'APP MAG': 'APP RM',
  'APP MGM': 'APP MEG',
  'DAV': 'ASP ABR',
  'NEP': 'ASP NPM',
  'VER': 'ASP VN',
  'GL5': 'ASP GL5',
  'SMS': 'ASP SMS',
  'POD': 'ASP POD',
  'NES': 'ASP NES',
  'LIM': 'ASP LIM',
  'NAG': 'ASP NAG',
  'LAU': 'ASP LAU',
  'ILO': 'ASP ILO',
  'CEB': 'ASP CEB',
  'ZAM': 'ASP ZAM',
  'CDO': 'ASP CDO',
  'MRK': 'ASP MRK',
  'EEST': 'EEST'
};

export const TOOL_PART_NUMBERS = new Set([
  '076-00108', // IMAC ADHESIVE CUTTER - Display Removal Tool
  '077-00892', // Apple Watch Series 10 and 11 - Dock
  '077-00893', // Apple Watch Series 10 and 11 - Carrier ID 42mm
  '077-00894', // Apple Watch Series 10 and 11 - Carrier ID 46mm
  '077-00970', // Apple Watch Ultra/2/3 - Carrier ID 49mm
  '077-01167', // Torx Plus 4IP 44 mm half-moon bit
  '661-14473', // USB-C Diagnostic Tool
  '661-29193', // Tool, Heated Display Pocket, iPhone 14/Pro
  '661-29194', // Tool, Heated Display Pocket, iPhone 14 Plus/Pro Max
  '922-9918',  // ESD-Safe Brush
  '923-01232', // Digital Barcode Scanner
  '923-01290', // Tool, Trilobe (MicroStix) 44 mm half-moon bit
  '923-02066', // Tool, Super Screw 44 mm half-moon bit
  '923-0246',  // Tool, Crosshead (JCIS) 44 mm half-moon bit
  '923-0247',  // Tool, Security bit, Pentalobe PL1.1 44 mm half-moon bit
  '923-0248',  // Torque Driver kit (black, 0.35 kgf cm)
  '923-07150', // Apple Watch Ultra/2/3 - Dock
  '923-07158', // Apple Watch Series 7/8/9 - Carrier ID 41mm
  '923-07159', // Apple Watch Series 7/8/9 - Carrier ID 45mm
  '923-07161', // Apple Watch Series 7/8/9 - Dock
  '923-0731',  // Tool, Pentalobe Driver
  '923-07593', // Tool, Torx Plus 3IP 25 mm 1/4" bit
  '923-07620', // Tool, Torx Plus 1IP 44 mm half-moon bit
  '923-08085', // Torque Driver (teal, 0.75 kgf cm)
  '923-08468', // Torx Plus 3IP 44 mm half-moon bit
  '923-08470', // Torx Plus 2IP bit, MBP
  '923-09176', // Adhesive Removal Tool, iPhone
  '923-12719', // Tool, Torx T25 50 mm bit, Mac mini (2024)
  '923-14662'  // Tool, Torx Plus 5IP 44 mm half-moon bit
]);

export const SERIALIZED_TOOL_PART_NUMBERS = new Set([
  '661-14473',
  '661-29193',
  '661-29194',
  '923-01232',
  '923-0248',
  '923-08085',
  '923-07150',
  '923-07161',
  '077-00892'
]);

const SYNTHETIC_SKU_RULES = [
  { match: /isopropyl|ipa\s*wipes/i, sku: 'CONS-IPA-WIPES', category: 'Cleaning Supplies' },
  { match: /adhesive\s*cutter\s*replacement\s*wheel/i, sku: 'CONS-IMAC-WHEEL', category: 'Cutting & Removal Supplies' }
];

export function normalizePrioritySiteCode(rawSite) {
  const clean = String(rawSite || '').trim().toUpperCase();
  if (!clean) return 'DC-MDC';
  return PRIORITY_SITE_CODE_ALIASES[clean] || clean;
}

export function classifyPriorityItemKind(partNumber, description = '') {
  const pn = String(partNumber || '').trim().toUpperCase();
  if (TOOL_PART_NUMBERS.has(pn)) return 'tool';
  const d = String(description || '').toLowerCase();
  if (
    /\b(torque driver|barcode scanner|diagnostic tool|heated display pocket|pentalobe driver|esd-safe brush|carrier identification|dock|half-moon bit|torx.*bit)\b/i.test(d) &&
    !/\b(adhesive|screw|pack|pk|100\s*pk|30\s*pk|20\s*pk|10\s*pk|putty|tape|cloth|wipes|bag|cover|cap)\b/i.test(d)
  ) {
    return 'tool';
  }
  return 'consumable';
}

export function inferConsumableToolCategory(description = '', itemKind = 'consumable') {
  const d = String(description || '').toLowerCase();
  if (itemKind === 'tool') {
    if (d.includes('bit')) return 'Precision Bits';
    if (d.includes('driver') || d.includes('torque')) return 'Torque Drivers';
    if (d.includes('dock') || d.includes('carrier identification')) return 'Watch Fixtures & Docks';
    if (d.includes('diagnostic') || d.includes('scanner') || d.includes('heated display pocket')) return 'Diagnostic & Bench Equipment';
    return 'Service Tools';
  }
  if (d.includes('adhesive') || d.includes('tape')) return 'Adhesives & Tapes';
  if (d.includes('screw')) return 'Screws & Fasteners';
  if (d.includes('protective cover') || d.includes('battery cover') || d.includes('camera')) return 'Protective Covers & Caps';
  if (d.includes('putty') || d.includes('cloth') || d.includes('wipes') || d.includes('ipa')) return 'Cleaning Supplies';
  if (d.includes('bag')) return 'ESD Packaging';
  if (d.includes('probe') || d.includes('black stick') || d.includes('wheel') || d.includes('cutting')) return 'Probes & Cutter Blades';
  return 'General Consumables';
}

function inferPackSize(description = '') {
  const m = String(description || '').match(/\b(\d+)\s*(?:PK|PACK|PC|PKG\.?\s*OF\s*\d+)\b/i);
  if (m) return parseInt(m[1], 10) || 1;
  const pkgOf = String(description || '').match(/pkg\.?\s*of\s*(\d+)/i);
  if (pkgOf) return parseInt(pkgOf[1], 10) || 1;
  return 1;
}

function normalizePriorityDate(rawDate, fallbackTimestamp) {
  const clean = String(rawDate || '').trim();
  const tryParse = (val) => {
    const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  };
  return tryParse(clean) || tryParse(String(fallbackTimestamp || '').trim()) || '2026-11-12';
}

function buildDeterministicUuid(seedStr) {
  // Deterministic UUID v4-formatted hex derived from FNV-1a hashes (safe for Postgres UUID & tests)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let i = 0; i < seedStr.length; i++) {
    const ch = seedStr.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (ch * 31), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ (ch + 7), 0x27d4eb2f) >>> 0;
  }
  const p1 = h1.toString(16).padStart(8, '0');
  const p2 = h2.toString(16).padStart(8, '0').slice(0, 4);
  const p3 = '4' + h2.toString(16).padStart(8, '0').slice(5, 8);
  const variantNibble = ['8', '9', 'a', 'b'][h3 & 3];
  const p4 = variantNibble + h3.toString(16).padStart(8, '0').slice(1, 4);
  const p5 = (h3.toString(16).padStart(8, '0').slice(4) + h4.toString(16).padStart(8, '0')).slice(0, 12);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/**
 * Imports Priority parts.csv into Consumables & Tools catalog, initial 40 POs,
 * ordered movement records, plus needsReview and descriptionConflicts reports.
 *
 * @param {string} csvText
 * @param {Object} options - { gsxDescriptionsByPn?: Map<string, string>, gsxParts?: Array }
 */
export function importPriorityPartsFromCsv(csvText, options = {}) {
  const rows = parseCsvRecords(csvText);

  const gsxDescMap = new Map();
  if (options.gsxDescriptionsByPn instanceof Map) {
    for (const [k, v] of options.gsxDescriptionsByPn.entries()) {
      gsxDescMap.set(String(k).toUpperCase(), v);
    }
  }
  if (Array.isArray(options.gsxParts)) {
    for (const p of options.gsxParts) {
      const pn = String(p.part_number || '').trim().toUpperCase();
      if (pn && p.description && !gsxDescMap.has(pn)) {
        gsxDescMap.set(pn, p.description);
      }
    }
  }

  const catalogByPn = new Map();
  const ordersByPo = new Map();
  const rawDescVariantsByPn = new Map();
  const needsReview = [];
  const movements = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const csvLine = i + 2;
    const rawPn = String(row['PART NUMBER'] || '').trim().toUpperCase();
    const rawDesc = String(row['DESCRIPTION'] || '').replace(/\s+/g, ' ').trim();
    const rawQty = String(row['QTY'] || '').trim();
    const parsedQty = rawQty === '' ? null : parseInt(rawQty.replace(/,/g, ''), 10);
    const rawCost = parseFloat(String(row['COST'] || '0').replace(/,/g, '')) || 0;
    const poNumber = String(row['PO#'] || '').trim();
    const orderNumber = String(row['ORDER #'] || '').trim();
    const rawSite = String(row['SITE'] || '').trim();
    const siteCode = normalizePrioritySiteCode(rawSite);
    const shipToLocation = String(row['SHIP TO LOCATION'] || '').trim();
    const soldToLocation = String(row['SOLD TO LOCATION'] || '').trim();
    const orderDate = normalizePriorityDate(row['DATE ORDERED'], row['TIMESTAMP']);

    let effectivePn = rawPn;
    let isSyntheticSku = false;
    let rowNeedsReview = false;
    const rowReviewReasons = [];

    // Handle N/A or blank part numbers
    if (!effectivePn || effectivePn === 'N/A' || effectivePn === 'NA') {
      const matchedRule = SYNTHETIC_SKU_RULES.find((r) => r.match.test(rawDesc));
      if (matchedRule) {
        effectivePn = matchedRule.sku;
        isSyntheticSku = true;
        rowNeedsReview = true;
        rowReviewReasons.push(`Assigned synthetic SKU "${effectivePn}" because PART NUMBER was "${rawPn || 'BLANK'}"`);
      } else {
        // Blank PN on row 222 (Adhesive, Display, iPhone 17 Pro, 30PK -> matches 923-12850) or fallback synthetic
        const fallbackExisting = Array.from(catalogByPn.values()).find(
          (c) => c.description.toLowerCase() === rawDesc.toLowerCase()
        );
        if (fallbackExisting) {
          effectivePn = fallbackExisting.part_number;
          rowNeedsReview = true;
          rowReviewReasons.push(`Blank PART NUMBER matched by description to existing SKU ${effectivePn}`);
        } else {
          effectivePn = `CONS-REVIEW-${csvLine}`;
          isSyntheticSku = true;
          rowNeedsReview = true;
          rowReviewReasons.push('Missing PART NUMBER in CSV; generated review SKU');
        }
      }
    }

    if (parsedQty === null || Number.isNaN(parsedQty) || parsedQty <= 0) {
      rowNeedsReview = true;
      rowReviewReasons.push(`Missing or non-positive QTY ("${rawQty || 'BLANK'}") — defaulted to 0 pending confirmation`);
    }

    if (rowNeedsReview) {
      needsReview.push({
        csv_line: csvLine,
        po_number: poNumber,
        order_number: orderNumber,
        raw_site: rawSite,
        resolved_site_code: siteCode,
        raw_part_number: rawPn || '<BLANK>',
        assigned_part_number: effectivePn,
        raw_description: rawDesc,
        raw_qty: rawQty || '<BLANK>',
        reasons: rowReviewReasons
      });
    }

    // Track all raw description variants for conflict reporting
    if (!rawDescVariantsByPn.has(effectivePn)) {
      rawDescVariantsByPn.set(effectivePn, {
        descriptions: new Set(),
        rows: []
      });
    }
    const variantTracker = rawDescVariantsByPn.get(effectivePn);
    if (rawDesc) variantTracker.descriptions.add(rawDesc);
    variantTracker.rows.push({ csv_line: csvLine, po_number: poNumber, description: rawDesc, cost: rawCost });

    const gsxCanonicalDesc = gsxDescMap.get(effectivePn);
    const canonicalDesc = gsxCanonicalDesc || rawDesc || `Item ${effectivePn}`;
    const itemKind = classifyPriorityItemKind(effectivePn, canonicalDesc);
    const category = inferConsumableToolCategory(canonicalDesc, itemKind);
    const packSize = inferPackSize(canonicalDesc);
    const isSerialized = itemKind === 'tool' && SERIALIZED_TOOL_PART_NUMBERS.has(effectivePn);

    // Derive sensible per-unit cost (some rows multiply cost * qty in CSV, e.g. 076-1417 cost=180 for qty=20 -> 9/unit)
    let unitCost = rawCost;
    if (parsedQty && parsedQty > 1 && rawCost > 0) {
      const existingCat = catalogByPn.get(effectivePn);
      if (existingCat && existingCat.unit_cost > 0 && Math.abs(rawCost / parsedQty - existingCat.unit_cost) < 0.05) {
        unitCost = existingCat.unit_cost;
      }
    }

    let catalogItem = catalogByPn.get(effectivePn);
    if (!catalogItem) {
      catalogItem = {
        id: buildDeterministicUuid(`ct-catalog:${effectivePn}`),
        part_number: effectivePn,
        description: canonicalDesc,
        item_kind: itemKind,
        category,
        unit_of_measure: itemKind === 'tool' ? 'unit' : (packSize > 1 ? `pack (${packSize})` : 'pcs'),
        pack_size: packSize,
        unit_cost: unitCost,
        is_serialized: isSerialized,
        min_stock_threshold: itemKind === 'tool' ? 1 : 2,
        reorder_qty: itemKind === 'tool' ? 1 : 5,
        is_synthetic_sku: isSyntheticSku,
        needs_review: rowNeedsReview,
        gsx_description_applied: Boolean(gsxCanonicalDesc),
        notes: isSyntheticSku ? `Synthetic SKU generated for CSV row ${csvLine}` : null,
        is_active: true
      };
      catalogByPn.set(effectivePn, catalogItem);
    } else {
      if (unitCost > 0 && (catalogItem.unit_cost === 0 || unitCost < catalogItem.unit_cost)) {
        // Prefer lower single-unit cost when CSV has line-total vs unit-cost variance
        catalogItem.unit_cost = unitCost;
      }
      if (rowNeedsReview) catalogItem.needs_review = true;
    }

    // Group into initial Purchase Orders (40 unique PO#s)
    if (poNumber) {
      let order = ordersByPo.get(poNumber);
      if (!order) {
        order = {
          id: buildDeterministicUuid(`ct-order:${poNumber}`),
          po_number: poNumber,
          order_number: orderNumber || null,
          site_code: siteCode,
          raw_site_code: rawSite,
          ship_to_location: shipToLocation,
          sold_to_location: soldToLocation,
          supplier: 'Apple South Asia Pte Ltd',
          order_date: orderDate,
          status: 'ordered',
          total_amount: 0,
          remarks: `Seeded from Priority parts.csv (${rawSite})`,
          created_by_name: 'Priority CSV Seed',
          items: []
        };
        ordersByPo.set(poNumber, order);
      }

      const qtyOrd = parsedQty && parsedQty > 0 ? parsedQty : 0;
      const itemUnitCost = catalogItem.unit_cost > 0 ? catalogItem.unit_cost : rawCost;
      // Merge identical PN within the same PO cleanly
      const existingLine = order.items.find((it) => it.part_number === effectivePn);
      if (existingLine) {
        existingLine.quantity_ordered += qtyOrd;
        if (rowNeedsReview) {
          existingLine.needs_review = true;
          existingLine.review_reason = [existingLine.review_reason, ...rowReviewReasons].filter(Boolean).join('; ');
        }
      } else {
        order.items.push({
          id: buildDeterministicUuid(`ct-order-item:${poNumber}:${effectivePn}:${csvLine}`),
          order_id: order.id,
          catalog_id: catalogItem.id,
          part_number: effectivePn,
          description: catalogItem.description,
          raw_description: rawDesc,
          item_kind: catalogItem.item_kind,
          quantity_ordered: qtyOrd,
          quantity_received: 0,
          unit_cost: itemUnitCost,
          needs_review: rowNeedsReview,
          review_reason: rowReviewReasons.join('; ') || null
        });
      }

      if (qtyOrd > 0) {
        movements.push({
          id: buildDeterministicUuid(`ct-move-ordered:${poNumber}:${effectivePn}:${csvLine}`),
          catalog_id: catalogItem.id,
          part_number: effectivePn,
          description: catalogItem.description,
          item_kind: catalogItem.item_kind,
          action: 'ordered',
          quantity: qtyOrd,
          serial_numbers: [],
          asset_tags: [],
          from_site_code: 'APPLE',
          to_site_code: siteCode,
          reference_type: 'order',
          reference_id: order.id,
          reference_number: poNumber,
          performed_by_name: 'Priority CSV Seed',
          notes: orderNumber ? `Apple Order #${orderNumber}` : 'Seeded Priority PO',
          created_at: `${orderDate}T09:00:00.000Z`
        });
      }
    }
  }

  // Recompute order totals
  const orders = Array.from(ordersByPo.values()).map((order) => {
    const total = order.items.reduce((sum, it) => sum + (it.quantity_ordered * (it.unit_cost || 0)), 0);
    return {
      ...order,
      total_amount: Math.round(total * 100) / 100
    };
  });

  // Build description-conflict report
  const descriptionConflicts = [];
  for (const [pn, info] of rawDescVariantsByPn.entries()) {
    const uniqueDescs = Array.from(info.descriptions).sort();
    const gsxDesc = gsxDescMap.get(pn) || null;
    const hasMultiple = uniqueDescs.length > 1;
    const differsFromGsx = Boolean(gsxDesc && uniqueDescs.some((d) => d.toLowerCase() !== gsxDesc.toLowerCase()));
    if (hasMultiple || differsFromGsx) {
      descriptionConflicts.push({
        part_number: pn,
        resolved_description: catalogByPn.get(pn)?.description || uniqueDescs[0] || '',
        gsx_canonical_description: gsxDesc,
        priority_csv_descriptions: uniqueDescs,
        occurrences: info.rows.length,
        sample_po_numbers: Array.from(new Set(info.rows.map((r) => r.po_number).filter(Boolean))).slice(0, 5)
      });
    }
  }

  const catalogItems = Array.from(catalogByPn.values()).sort((a, b) => a.part_number.localeCompare(b.part_number));

  return {
    catalogItems,
    orders,
    movements,
    needsReview,
    descriptionConflicts: descriptionConflicts.sort((a, b) => a.part_number.localeCompare(b.part_number)),
    stats: {
      totalCsvRows: rows.length,
      uniqueCatalogItems: catalogItems.length,
      consumablesCount: catalogItems.filter((c) => c.item_kind === 'consumable').length,
      toolsCount: catalogItems.filter((c) => c.item_kind === 'tool').length,
      syntheticSkusCount: catalogItems.filter((c) => c.is_synthetic_sku).length,
      ordersCount: orders.length,
      needsReviewCount: needsReview.length,
      descriptionConflictsCount: descriptionConflicts.length
    }
  };
}

/**
 * Idempotently merges Priority catalog items and orders into existing state.
 */
export function mergePriorityCatalogAndOrders(existingCatalog = [], existingOrders = [], imported) {
  const catMap = new Map((existingCatalog || []).map((c) => [String(c.part_number).toUpperCase(), { ...c }]));
  let addedCatalog = 0;
  for (const item of imported?.catalogItems || []) {
    const pn = String(item.part_number).toUpperCase();
    if (!catMap.has(pn)) {
      catMap.set(pn, item);
      addedCatalog++;
    }
  }

  const orderMap = new Map((existingOrders || []).map((o) => [String(o.po_number).toUpperCase(), { ...o }]));
  let addedOrders = 0;
  for (const ord of imported?.orders || []) {
    const po = String(ord.po_number).toUpperCase();
    if (!orderMap.has(po)) {
      orderMap.set(po, ord);
      addedOrders++;
    }
  }

  return {
    catalog: Array.from(catMap.values()),
    orders: Array.from(orderMap.values()),
    addedCatalog,
    addedOrders
  };
}
