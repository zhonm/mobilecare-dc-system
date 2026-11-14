import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  importGsxCatalogFromCsv,
  mergeGsxPartsIntoCatalog,
  classifyGsxDeviceStatus
} from '../utils/gsxCatalogImporter.js';
import { importPriorityPartsFromCsv } from '../utils/priorityPartsImporter.js';
import { resolvePartInfo } from '../utils/partResolver.js';
import { parseGsxExcelOrCsv } from '../utils/gsxPdfParser.js';
import { getPartCategory, DEFAULT_PART_CATEGORIES } from '../utils/categoryFilter.js';
import gsxCatalogSeed from '../data/gsxPartsCatalog.json' with { type: 'json' };
import ctSeed from '../data/consumablesToolsSeed.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

console.log('====================================================');
console.log('TEST SUITE: GSX Catalog Import, Priority Seed & Regression');
console.log('====================================================');

// 1. GSX Catalog Import & Exclusion Rules
const gsxCsvPath = path.join(rootDir, 'GSX all Parts.csv');
const gsxCsvText = fs.readFileSync(gsxCsvPath, 'utf8');
const gsxImported = importGsxCatalogFromCsv(gsxCsvText);

assert.equal(gsxImported.parts.length, 4640, 'GSX import keeps 4,640 unique current orderable parts');
assert.ok(gsxImported.stats.excludedObsoleteDeviceCount >= 30, 'GSX import excludes 30+ obsolete/vintage device groups');
assert.ok(gsxImported.excludedDevices.length >= 30, 'GSX excludedDevices report lists 30+ entries');
assert.ok(gsxImported.stats.excludedServiceIntangibleUniquePns > 400, 'GSX import excludes 400+ Service Intangible PNs');

const serviceIntangibleInParts = gsxImported.parts.some(
  p => String(p.part_type || '').toLowerCase() === 'service intangible'
);
assert.equal(serviceIntangibleInParts, false, 'Zero Service Intangible items allowed in imported parts');

const obsCheck = classifyGsxDeviceStatus('OBS,IPHONE 6S');
assert.equal(obsCheck.excluded, true, 'OBS,* product names excluded');
const vinCheck = classifyGsxDeviceStatus('~VIN,IPHONE X');
assert.equal(vinCheck.excluded, true, '~VIN,* product names excluded');
const curCheck = classifyGsxDeviceStatus('iPhone 16 Pro Max');
assert.equal(curCheck.excluded, false, 'Current iPhone 16 Pro Max kept');

const excludedInCatalog = gsxImported.parts.some(p =>
  /^(OBS|VIN|~VIN),/i.test(p.iphone_model || '') || p.iphone_model === 'iPhone 7'
);
assert.equal(excludedInCatalog, false, 'Excluded obsolete models must not appear in current catalog');

// Includes non-battery, non-display genuine parts (speakers, cameras, adhesives, etc.)
const nonBatDsp = gsxImported.parts.filter(p => !['BAT', 'DSP'].includes(getPartCategory(p)));
assert.ok(nonBatDsp.length > 2000, 'GSX catalog includes 2,000+ non-battery/display repair parts');
assert.equal(gsxCatalogSeed.parts.length, gsxImported.parts.length, 'Seed JSON matches live GSX CSV import');

console.log('  ✓ PASS: GSX import excludes obsolete/Service Intangible and keeps 4,640 current parts');

// 2. Idempotency & Existing ID Preservation
const existingParts = [
  {
    id: 'existing-uuid-battery-14',
    part_number: '661-30373',
    description: 'Custom Existing Battery, iPhone 14',
    iphone_model: 'iPhone 14',
    stocking_price: 75.5,
    category_id: DEFAULT_PART_CATEGORIES[0].id,
    is_active: true
  }
];
const mergeResOnce = mergeGsxPartsIntoCatalog(existingParts, gsxImported.parts, DEFAULT_PART_CATEGORIES);
const mergedOnce = mergeResOnce.merged;
const mergeResTwice = mergeGsxPartsIntoCatalog(mergedOnce, gsxImported.parts, DEFAULT_PART_CATEGORIES);
const mergedTwice = mergeResTwice.merged;
assert.equal(mergedOnce.length, mergedTwice.length, 'Re-running GSX merge creates zero duplicates');
assert.equal(mergeResTwice.addedCount, 0, 'Zero new rows added on second idempotent pass');

const preservedBat = mergedTwice.find(p => p.part_number === '661-30373');
assert.equal(preservedBat?.id, 'existing-uuid-battery-14', 'Existing part ID is strictly preserved across GSX merge');
assert.equal(preservedBat?.stocking_price, 75.5, 'Existing part price is preserved without overwrite');

console.log('  ✓ PASS: GSX merge is 100% idempotent and preserves existing part IDs');

// 3. Priority CSV Seeding
const priorityCsvPath = path.join(rootDir, 'Priority parts.csv');
const priorityCsvText = fs.readFileSync(priorityCsvPath, 'utf8');
const priorityImported = importPriorityPartsFromCsv(priorityCsvText);

assert.equal(priorityImported.catalogItems.length, 103, 'Priority CSV produces 103 unique Consumables & Tools SKUs');
assert.equal(priorityImported.orders.length, 40, 'Priority CSV produces 40 purchase orders');
const consumablesCount = priorityImported.catalogItems.filter(i => i.item_kind === 'consumable').length;
const toolsCount = priorityImported.catalogItems.filter(i => i.item_kind === 'tool').length;
assert.equal(consumablesCount, 74, '74 consumables classified');
assert.equal(toolsCount, 29, '29 tools classified');

const synWipes = priorityImported.catalogItems.find(i => i.part_number === 'CONS-IPA-WIPES');
const synWheel = priorityImported.catalogItems.find(i => i.part_number === 'CONS-IMAC-WHEEL');
assert.ok(synWipes && synWipes.is_synthetic_sku, 'Synthetic SKU CONS-IPA-WIPES created');
assert.ok(synWheel && synWheel.is_synthetic_sku, 'Synthetic SKU CONS-IMAC-WHEEL created');
assert.equal(priorityImported.needsReview.length, 4, '4 rows flagged for review in needsReview');
assert.equal(ctSeed.catalogItems.length, 103, 'consumablesToolsSeed.json contains 103 catalog items');
assert.equal(ctSeed.orders.length, 40, 'consumablesToolsSeed.json contains 40 orders');

console.log('  ✓ PASS: Priority CSV seeding verified (103 items, 40 orders, 2 synthetic SKUs, 4 needs-review)');

// 4. Regression: 661-xxxxx & general GSX parsing + Battery/Display classification
const mockCsv = [
  'Part Number,Description,Qty,Unit Price',
  '661-30373,"Battery, iPhone 14",5,49',
  '923-09536,"Adhesive, Battery, iPhone 15",10,4',
  '076-00580,Screwdriver Bit Torx,2,12',
  '04-Sep-2026,Invoice Date Should Not Match PN,1,0',
  '2026-09-23,ISO Date Should Not Match PN,1,0'
].join('\n');
const parsedPo = await parseGsxExcelOrCsv(new TextEncoder().encode(mockCsv), 'Regression_Test_PO.csv');
assert.equal(parsedPo.items.length, 3, 'GSX Excel/CSV parser extracts 661, 923, 076 PNs while ignoring date strings');
assert.equal(parsedPo.items[0].part_number, '661-30373');
assert.equal(parsedPo.items[1].part_number, '923-09536');
assert.equal(parsedPo.items[2].part_number, '076-00580');

const batResolved = resolvePartInfo('661-30373', mergedTwice);
const dspResolved = resolvePartInfo('661-36863', mergedTwice);
const sampleNon661 = mergedTwice.find(p => !String(p.part_number || '').startsWith('661-'));
assert.ok(sampleNon661, 'Non-661 GSX part exists in expanded catalog');
const nonBatResolved = resolvePartInfo(`Replacement Part (${sampleNon661.part_number})`, mergedTwice);
assert.ok(batResolved && batResolved.part_number === '661-30373', 'Battery PN still resolves after regex update');
assert.ok(dspResolved || getPartCategory({ description: 'Display, iPhone 15 Pro' }) === 'DISPLAY', 'Display recognition unchanged');
assert.equal(getPartCategory({ description: 'Battery, iPhone 14', part_number: '661-30373' }), 'BATTERY');
assert.equal(getPartCategory({ description: 'Display, iPhone 15 Pro', part_number: '661-36863' }), 'DISPLAY');
assert.ok(nonBatResolved && nonBatResolved.part_number === sampleNon661.part_number, 'General GSX PN resolves from embedded string');

console.log('  ✓ PASS: Battery/Display & GSX regex regression checks passed');
console.log('ALL GSX CATALOG & PRIORITY SEED TESTS PASSED');
