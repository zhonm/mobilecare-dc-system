import assert from 'node:assert/strict';

import ctSeed from '../data/consumablesToolsSeed.json' with { type: 'json' };
import {
  validateAndReceiveOrderLine,
  parseConsumablesReceivingCsv,
  transitionToolAsset,
  consumeConsumableStock,
  getSitePackingCandidates,
  validateAndScanPackItem,
  createConsumablesToolsShipment,
  confirmConsumablesToolsDelivery,
  computeItemStockSummary
} from '../utils/consumablesToolsEngine.js';
import {
  generateConsumablesToolsPackingListPdfBytes,
  generatePackingListPDF
} from '../utils/pdfGenerator.js';

console.log('====================================================');
console.log('TEST SUITE: Consumables & Tools Lifecycle & Packing List');
console.log('====================================================');

const catalog = ctSeed.catalogItems.map(item => ({ ...item }));
// Ensure we test both serialized tools and non-serialized tools cleanly
const serializedToolPn = '076-00108';
const catalogWithSerializedTool = catalog.map(c =>
  c.part_number === serializedToolPn
    ? { ...c, is_serialized: true, item_kind: 'tool', min_stock_threshold: 2 }
    : c
);

// Setup test PO with a consumable (ordered 10) and serialized tool (ordered 4)
const testOrder = {
  id: 'ord-test-1',
  po_number: 'SVC20269999',
  site_code: 'DC-MDC',
  supplier: 'Apple South Asia Pte Ltd',
  status: 'ordered',
  items: [
    {
      id: 'oi-cons-1',
      order_id: 'ord-test-1',
      part_number: '923-06625',
      description: 'Display Adhesive, iPhone 13 Pro Max, 30 PK',
      item_kind: 'consumable',
      quantity_ordered: 10,
      quantity_received: 0,
      unit_cost: 27
    },
    {
      id: 'oi-tool-1',
      order_id: 'ord-test-1',
      part_number: serializedToolPn,
      description: 'Universal Heated Display Removal Tool',
      item_kind: 'tool',
      quantity_ordered: 4,
      quantity_received: 0,
      unit_cost: 9.9
    }
  ]
};

let stockRows = [];
let toolAssets = [];
let movements = [];

// 1. Unknown Part Number
const unknownRes = validateAndReceiveOrderLine({
  order: testOrder,
  partNumber: '999-UNKNOWN',
  deliveredQty: 1,
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets,
  allowAdHoc: true
});
assert.equal(unknownRes.ok, false);
assert.equal(unknownRes.errorCode, 'UNKNOWN_PART_NUMBER', 'Unknown PN rejected gracefully');

// 2. Partial Delivery (receive 4 of 10 consumables)
const partialRes = validateAndReceiveOrderLine({
  order: testOrder,
  partNumber: '923-06625',
  deliveredQty: 4,
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets,
  actorName: 'Juan Dela Cruz',
  timestamp: '2026-11-14T10:00:00.000Z'
});
assert.equal(partialRes.ok, true);
assert.equal(partialRes.deliveryStatus, 'partial');
assert.equal(partialRes.remainingAfter, 6);
assert.equal(partialRes.updatedOrder.status, 'partially_received');
stockRows = partialRes.nextStockRows;
movements.push(...partialRes.movements);

// 3. Full Delivery of remaining 6 consumables
const fullRes = validateAndReceiveOrderLine({
  order: partialRes.updatedOrder,
  partNumber: '923-06625',
  deliveredQty: 6,
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets,
  actorName: 'Juan Dela Cruz',
  timestamp: '2026-11-14T10:15:00.000Z'
});
assert.equal(fullRes.ok, true);
assert.equal(fullRes.deliveryStatus, 'full');
assert.equal(fullRes.remainingAfter, 0);
stockRows = fullRes.nextStockRows;
movements.push(...fullRes.movements);

// 4. Quantity Mismatch on serialized tool (qty=2, only 1 serial)
const mismatchSerialRes = validateAndReceiveOrderLine({
  order: fullRes.updatedOrder,
  partNumber: serializedToolPn,
  deliveredQty: 2,
  scannedSerials: ['TL-SN-001'],
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets
});
assert.equal(mismatchSerialRes.ok, false);
assert.equal(mismatchSerialRes.errorCode, 'QUANTITY_MISMATCH', 'Mismatched serial count vs qty rejected');

// Also test expectedQty mismatch flag
const mismatchExpectedRes = validateAndReceiveOrderLine({
  order: fullRes.updatedOrder,
  partNumber: '923-06625',
  deliveredQty: 2,
  expectedQty: 5,
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets
});
assert.equal(mismatchExpectedRes.ok, false);
assert.equal(mismatchExpectedRes.errorCode, 'QUANTITY_MISMATCH', 'Manifest expectedQty mismatch rejected');

// 5. Intra-batch duplicate tool serial
const intraDupRes = validateAndReceiveOrderLine({
  order: fullRes.updatedOrder,
  partNumber: serializedToolPn,
  deliveredQty: 2,
  scannedSerials: ['TL-SN-100', 'TL-SN-100'],
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets
});
assert.equal(intraDupRes.ok, false);
assert.equal(intraDupRes.errorCode, 'DUPLICATE_TOOL_SERIAL', 'Intra-batch duplicate serial rejected');

// 6. Receive 2 valid serialized tools
const validToolsRes = validateAndReceiveOrderLine({
  order: fullRes.updatedOrder,
  partNumber: serializedToolPn,
  deliveredQty: 2,
  scannedSerials: ['TL-SN-101', 'TL-SN-102'],
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets,
  actorName: 'Maria Santos',
  timestamp: '2026-11-14T10:30:00.000Z'
});
assert.equal(validToolsRes.ok, true);
assert.equal(validToolsRes.newToolAssets.length, 2);
stockRows = validToolsRes.nextStockRows;
toolAssets = validToolsRes.nextToolAssets;
movements.push(...validToolsRes.movements);

// 7. Existing inventory duplicate tool serial
const existingDupRes = validateAndReceiveOrderLine({
  order: validToolsRes.updatedOrder,
  partNumber: serializedToolPn,
  deliveredQty: 1,
  scannedSerials: ['TL-SN-101'],
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets
});
assert.equal(existingDupRes.ok, false);
assert.equal(existingDupRes.errorCode, 'DUPLICATE_TOOL_SERIAL', 'Duplicate serial vs existing inventory rejected');

// 8. Over-delivery (ordered 4, 2 received, 2 remaining -> receive 3 (+1 extra))
const blockedOverRes = validateAndReceiveOrderLine({
  order: validToolsRes.updatedOrder,
  partNumber: serializedToolPn,
  deliveredQty: 3,
  scannedSerials: ['TL-SN-103', 'TL-SN-104', 'TL-SN-105'],
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets,
  allowOverDelivery: false
});
assert.equal(blockedOverRes.ok, false);
assert.equal(blockedOverRes.errorCode, 'OVER_DELIVERY');

const allowedOverRes = validateAndReceiveOrderLine({
  order: validToolsRes.updatedOrder,
  partNumber: serializedToolPn,
  deliveredQty: 3,
  scannedSerials: ['TL-SN-103', 'TL-SN-104', 'TL-SN-105'],
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets,
  allowOverDelivery: true,
  actorName: 'Maria Santos',
  timestamp: '2026-11-14T10:45:00.000Z'
});
assert.equal(allowedOverRes.ok, true);
assert.equal(allowedOverRes.isOverDelivery, true);
assert.equal(allowedOverRes.varianceQty, 1);
assert.equal(allowedOverRes.updatedOrder.status, 'received');
stockRows = allowedOverRes.nextStockRows;
toolAssets = allowedOverRes.nextToolAssets;
movements.push(...allowedOverRes.movements);

// Bulk CSV parser check
const csvSample = [
  'PO Number,Part Number,Qty,Serial Numbers,Site',
  'SVC20269999,923-06625,2,,DC-MDC',
  'SVC20269999,UNKNOWN-SKU,1,,DC-MDC',
  `SVC20269999,${serializedToolPn},2,DUP-A DUP-A,DC-MDC`
].join('\n');
const parsedBulk = parseConsumablesReceivingCsv(csvSample, catalogWithSerializedTool);
assert.equal(parsedBulk.validRows.length, 1);
assert.equal(parsedBulk.errorRows.length, 2);

console.log('  ✓ PASS: Receiving validations (full, partial, over-delivery, unknown PN, dup serial, qty mismatch)');

// 9. Stock Consumption, Low-Stock Alert & Tool Checkout/Checkin History
const consRes = consumeConsumableStock({
  catalogItems: catalogWithSerializedTool,
  stockRows,
  partNumber: '923-06625',
  siteCode: 'DC-MDC',
  quantity: 3,
  actorName: 'Tech Alex',
  timestamp: '2026-11-14T11:00:00.000Z'
});
assert.equal(consRes.ok, true);
stockRows = consRes.nextStockRows;
movements.push(consRes.movement);

const overConsumeRes = consumeConsumableStock({
  catalogItems: catalogWithSerializedTool,
  stockRows,
  partNumber: '923-06625',
  siteCode: 'DC-MDC',
  quantity: 999
});
assert.equal(overConsumeRes.ok, false);
assert.equal(overConsumeRes.errorCode, 'INSUFFICIENT_STOCK');

const adhesiveItem = catalogWithSerializedTool.find(c => c.part_number === '923-06625');
const stockSummary = computeItemStockSummary(adhesiveItem, stockRows, toolAssets, 'DC-MDC');
assert.equal(stockSummary.qtyOnHand, 7, '10 received - 3 consumed = 7 on hand');
assert.equal(stockSummary.qtyConsumed, 3);

// Checkout & check-in first tool asset
const firstAsset = toolAssets[0];
const outToolRes = transitionToolAsset({
  toolAssets,
  assetId: firstAsset.id,
  action: 'checked_out',
  newStatus: 'in_use',
  assignedTo: 'Tech Alex',
  actorName: 'Lead Sarah',
  timestamp: '2026-11-14T11:05:00.000Z'
});
assert.equal(outToolRes.ok, true);
assert.equal(outToolRes.updatedAsset.status, 'in_use');
assert.equal(outToolRes.movement.performed_by_name, 'Lead Sarah');
toolAssets = outToolRes.nextToolAssets;
movements.push(outToolRes.movement);

const inToolRes = transitionToolAsset({
  toolAssets,
  assetId: firstAsset.id,
  action: 'checked_in',
  newStatus: 'available',
  actorName: 'Lead Sarah',
  timestamp: '2026-11-14T11:30:00.000Z'
});
assert.equal(inToolRes.ok, true);
assert.equal(inToolRes.updatedAsset.status, 'available');
toolAssets = inToolRes.nextToolAssets;
movements.push(inToolRes.movement);

// Verify all movements include actor & timestamp
assert.ok(movements.every(m => Boolean(m.performed_by_name) && Boolean(m.created_at)), 'Every movement records user & timestamp');
console.log('  ✓ PASS: Stock levels, consumption, tool check-out/in & user/timestamp audit verified');

// 10. Separate Shipment, Delivery & Packing List PDF Generation
assert.equal(typeof generatePackingListPDF, 'function', 'Existing Parts packing list function preserved');

const shipRes = createConsumablesToolsShipment({
  catalogItems: catalogWithSerializedTool,
  stockRows,
  toolAssets,
  existingShipments: [],
  fromSiteCode: 'DC-MDC',
  toSiteCode: 'APP BHS',
  toSiteName: 'Power Mac Center BHS',
  carrier: 'Lalamove',
  trackingNumber: 'LLM-88991',
  notes: 'Handle heated tool upright',
  lineRequests: [
    { part_number: '923-06625', quantity: 2 },
    { part_number: serializedToolPn, quantity: 2, assetIds: [toolAssets[0].id, toolAssets[1].id] }
  ],
  actorName: 'Dispatcher Kim',
  timestamp: '2026-11-14T12:00:00.000Z'
});
assert.equal(shipRes.ok, true);
assert.ok(shipRes.shipment.packing_list_number.startsWith('CT-PL-'), 'Separate CT Packing List sequence generated');
assert.equal(shipRes.shipment.items.length, 2);
assert.equal(shipRes.shipment.items[1].serial_numbers.length, 2, 'Tool shipment line includes serialized tracking');

const pdfBytes = generateConsumablesToolsPackingListPdfBytes(shipRes.shipment);
assert.ok(pdfBytes instanceof Uint8Array && pdfBytes.length > 4000, 'Packing List PDF generates non-empty bytes');
assert.equal(Buffer.from(pdfBytes.slice(0, 5)).toString(), '%PDF-', 'Valid PDF binary header generated');

const delivRes = confirmConsumablesToolsDelivery({
  shipment: shipRes.shipment,
  stockRows: shipRes.nextStockRows,
  toolAssets: shipRes.nextToolAssets,
  receivedByName: 'Branch Lead Ben',
  signatureName: 'Ben',
  timestamp: '2026-11-14T14:00:00.000Z'
});
assert.equal(delivRes.ok, true);
assert.equal(delivRes.updatedShipment.status, 'delivered');
const bhsStock = computeItemStockSummary(adhesiveItem, delivRes.nextStockRows, delivRes.nextToolAssets, 'APP BHS');
assert.equal(bhsStock.qtyOnHand, 2, 'Destination branch received shipped consumable qty');
const shippedToolInBhs = delivRes.nextToolAssets.find(a => a.id === toolAssets[0].id);
assert.equal(shippedToolInBhs.site_code, 'APP BHS');
assert.equal(shippedToolInBhs.status, 'available');

console.log('  ✓ PASS: Dedicated Consumables/Tools shipment, delivery & PDF packing list verified');

// 11. Site-Filtered Packing List Candidates (MOA site workflow)
const moaStock = [
  { id: 'stk-moa-1', part_number: '923-06625', description: 'Display Adhesive', item_kind: 'consumable', site_code: 'APP MOA', qty_on_hand: 5 },
  { id: 'stk-ppm-1', part_number: '923-04894', description: 'Other Site Part', item_kind: 'consumable', site_code: 'APP PPM', qty_on_hand: 3 }
];
const moaOrders = [
  {
    id: 'ord-moa-1',
    po_number: 'SVC20260150-APP MOA',
    site_code: 'APP MOA',
    items: [{ id: 'l1', part_number: '923-06625', quantity_ordered: 5, quantity_received: 5 }]
  }
];
const candidatesMoa = getSitePackingCandidates({
  targetSiteCode: 'APP MOA',
  fromSiteCode: 'DC-MDC',
  catalogItems: catalogWithSerializedTool,
  stockRows: moaStock,
  toolAssets: [],
  orders: moaOrders
});
assert.equal(candidatesMoa.siteCandidates.length, 1, 'Filters strictly to selected site APP MOA');
assert.equal(candidatesMoa.siteCandidates[0].part_number, '923-06625');
assert.equal(candidatesMoa.siteCandidates[0].availableQty, 5);
assert.deepEqual(candidatesMoa.siteCandidates[0].poNumbers, ['SVC20260150-APP MOA']);

const moaDispatch = createConsumablesToolsShipment({
  catalogItems: catalogWithSerializedTool,
  stockRows: moaStock,
  toolAssets: [],
  existingShipments: [shipRes.shipment],
  fromSiteCode: 'DC-MDC',
  toSiteCode: 'APP MOA',
  toSiteName: 'MOBILECARE - APP MALL OF ASIA',
  lineRequests: [{ part_number: '923-06625', quantity: 5, sourceSiteCode: 'APP MOA' }]
});
assert.equal(moaDispatch.ok, true, 'Dispatches MOA received stock cleanly from sourceSiteCode');
assert.equal(moaDispatch.nextStockRows.find(r => r.site_code === 'APP MOA').qty_on_hand, 0);
console.log('  ✓ PASS: Site-filtered packing candidates & MOA dispatch verified');

// 12. Security Scan-to-Box & Auto-Entry Validations
const scanToolsPool = [
  { id: 'ast-moa-1', part_number: serializedToolPn, description: 'Heated Tool', asset_tag: 'MDC-TL-07600108-0001', serial_number: 'MOA-SN-001', site_code: 'APP MOA', status: 'available' },
  { id: 'ast-moa-2', part_number: serializedToolPn, description: 'Heated Tool', asset_tag: 'MDC-TL-07600108-0002', serial_number: 'MOA-SN-002', site_code: 'APP MOA', status: 'available' }
];
let boxLines = [];

// 12a. Consumable PN scan -> auto-placed in box
const scanCons1 = validateAndScanPackItem({
  scanToken: '923-06625',
  targetSiteCode: 'APP MOA',
  fromSiteCode: 'DC-MDC',
  catalogItems: catalogWithSerializedTool,
  stockRows: moaStock,
  toolAssets: scanToolsPool,
  orders: moaOrders,
  currentBoxLines: boxLines
});
assert.equal(scanCons1.ok, true);
assert.equal(scanCons1.status, 'PACKED');
assert.equal(scanCons1.nextBoxLines[0].box_verified, true);
assert.equal(scanCons1.nextBoxLines[0].quantity, 1);
boxLines = scanCons1.nextBoxLines;

// 12b. Serialized tool PN scan without serial -> prompts for serial
const scanToolNeedSn = validateAndScanPackItem({
  scanToken: serializedToolPn,
  targetSiteCode: 'APP MOA',
  fromSiteCode: 'DC-MDC',
  catalogItems: catalogWithSerializedTool,
  stockRows: moaStock,
  toolAssets: scanToolsPool,
  orders: moaOrders,
  currentBoxLines: boxLines
});
assert.equal(scanToolNeedSn.ok, true);
assert.equal(scanToolNeedSn.status, 'NEEDS_SERIAL');
assert.equal(scanToolNeedSn.pendingPartNumber, serializedToolPn);

// 12c. Wrong serial for pending PN rejected
const scanWrongSn = validateAndScanPackItem({
  scanToken: 'WRONG-SN-999',
  pendingPartNumber: serializedToolPn,
  targetSiteCode: 'APP MOA',
  fromSiteCode: 'DC-MDC',
  catalogItems: catalogWithSerializedTool,
  stockRows: moaStock,
  toolAssets: scanToolsPool,
  currentBoxLines: boxLines
});
assert.equal(scanWrongSn.ok, false);
assert.equal(scanWrongSn.errorCode, 'SERIAL_MISMATCH');

// 12d. Valid serial scan for pending PN -> placed in box with serial
const scanToolValidSn = validateAndScanPackItem({
  scanToken: 'MOA-SN-001',
  pendingPartNumber: serializedToolPn,
  targetSiteCode: 'APP MOA',
  fromSiteCode: 'DC-MDC',
  catalogItems: catalogWithSerializedTool,
  stockRows: moaStock,
  toolAssets: scanToolsPool,
  orders: moaOrders,
  currentBoxLines: boxLines
});
assert.equal(scanToolValidSn.ok, true);
assert.equal(scanToolValidSn.status, 'PACKED');
assert.deepEqual(scanToolValidSn.nextBoxLines[1].serial_numbers, ['MOA-SN-001']);
boxLines = scanToolValidSn.nextBoxLines;

// 12e. Duplicate serial already in box rejected
const scanDupInBox = validateAndScanPackItem({
  scanToken: 'MOA-SN-001',
  targetSiteCode: 'APP MOA',
  fromSiteCode: 'DC-MDC',
  catalogItems: catalogWithSerializedTool,
  stockRows: moaStock,
  toolAssets: scanToolsPool,
  currentBoxLines: boxLines
});
assert.equal(scanDupInBox.ok, false);
assert.equal(scanDupInBox.errorCode, 'DUPLICATE_IN_BOX');

// 12f. Direct serial scan for second tool without scanning PN first
const scanDirectSn = validateAndScanPackItem({
  scanToken: 'MOA-SN-002',
  targetSiteCode: 'APP MOA',
  fromSiteCode: 'DC-MDC',
  catalogItems: catalogWithSerializedTool,
  stockRows: moaStock,
  toolAssets: scanToolsPool,
  currentBoxLines: boxLines
});
assert.equal(scanDirectSn.ok, true);
assert.equal(scanDirectSn.status, 'PACKED');
assert.equal(scanDirectSn.nextBoxLines[1].quantity, 2);
assert.deepEqual(scanDirectSn.nextBoxLines[1].serial_numbers, ['MOA-SN-001', 'MOA-SN-002']);

console.log('  ✓ PASS: Security scan-to-box & serial verification checks passed');

// 13. Consumable Serial Number Recording on Receiving & Duplicate Guard
console.log('13. Testing consumable serial number recording on receiving & duplicate guard...');
const consOrder = {
  id: 'po-cons-sn-1',
  po_number: 'PO-CONS-SN-001',
  site_code: 'APP MOA',
  status: 'ordered',
  items: [{ id: 'li-cons-1', part_number: 'CONS-001', description: 'Display Adhesive', qty_ordered: 5, qty_received: 0 }],
};
const consCatalog = [
  { id: 'cat-cons-1', part_number: 'CONS-001', description: 'Display Adhesive', item_kind: 'consumable', category: 'CONSUMABLE' },
];
const consRecvRes = validateAndReceiveOrderLine({
  order: consOrder,
  partNumber: 'CONS-001',
  deliveredQty: 2,
  scannedSerials: ['CONS-SN-01', 'CONS-SN-02'],
  siteCode: 'APP MOA',
  catalogItems: consCatalog,
  stockRows: [],
  toolAssets: [],
  actorName: 'Test User',
  actorId: 'usr-1',
});
assert.equal(consRecvRes.ok, true);
assert.deepEqual(consRecvRes.updatedStockRow.serial_numbers, ['CONS-SN-01', 'CONS-SN-02']);
assert.equal(consRecvRes.movements.length, 2);
assert.deepEqual(consRecvRes.movements[0].serial_numbers, ['CONS-SN-01', 'CONS-SN-02']);
assert.deepEqual(consRecvRes.movements[1].serial_numbers, ['CONS-SN-01', 'CONS-SN-02']);

const consDupRes = validateAndReceiveOrderLine({
  order: consRecvRes.updatedOrder,
  partNumber: 'CONS-001',
  deliveredQty: 1,
  scannedSerials: ['CONS-SN-01'],
  siteCode: 'APP MOA',
  catalogItems: consCatalog,
  stockRows: [consRecvRes.updatedStockRow],
  toolAssets: [],
  actorName: 'Test User',
  actorId: 'usr-1',
});
assert.equal(consDupRes.ok, false);
assert.equal(consDupRes.errorCode, 'DUPLICATE_TOOL_SERIAL');

const consCandRes = getSitePackingCandidates({
  targetSiteCode: 'APP MOA',
  fromSiteCode: 'DC-MDC',
  catalogItems: consCatalog,
  stockRows: [consRecvRes.updatedStockRow],
  toolAssets: [],
  orders: [consRecvRes.updatedOrder],
  existingShipments: []
});
assert.equal(consCandRes.siteCandidates.length, 1);
assert.deepEqual(consCandRes.siteCandidates[0].serial_numbers, ['CONS-SN-01', 'CONS-SN-02']);

const consScanRes = validateAndScanPackItem({
  scanToken: 'CONS-SN-01',
  targetSiteCode: 'APP MOA',
  fromSiteCode: 'DC-MDC',
  catalogItems: consCatalog,
  stockRows: [consRecvRes.updatedStockRow],
  toolAssets: [],
  orders: [consRecvRes.updatedOrder],
  existingShipments: [],
  currentBoxLines: []
});
assert.equal(consScanRes.ok, true);
assert.deepEqual(consScanRes.nextBoxLines[0].serial_numbers, ['CONS-SN-01']);

const consShipRes = createConsumablesToolsShipment({
  fromSiteCode: 'DC-MDC',
  toSiteCode: 'APP MOA',
  carrier: 'Lite Express (Air)',
  tsNumber: 'TS-2026-8888',
  lineRequests: [{ part_number: 'CONS-001', quantity: 1, sourceSiteCode: 'APP MOA', serial_numbers: ['CONS-SN-01'] }],
  catalogItems: consCatalog,
  stockRows: [consRecvRes.updatedStockRow],
  toolAssets: [],
  existingShipments: [],
  actorName: 'Test User',
  actorId: 'usr-1'
});
assert.equal(consShipRes.ok, true);
assert.equal(consShipRes.shipment.carrier, 'Lite Express (Air)');
assert.equal(consShipRes.shipment.ts_number, 'TS-2026-8888');
assert.deepEqual(consShipRes.shipment.items[0].serial_numbers, ['CONS-SN-01']);
assert.deepEqual(consShipRes.nextStockRows[0].serial_numbers, ['CONS-SN-02']);
const consPdfBytes = generateConsumablesToolsPackingListPdfBytes(consShipRes.shipment);
const consPdfStr = Buffer.from(consPdfBytes).toString('latin1');
assert.equal(consPdfStr.includes('CONS-SN-01'), true, 'PDF must include consumable serial number');
assert.equal(consPdfStr.includes('TS-2026-8888'), true, 'PDF must include TS Number');
assert.equal(
  consPdfStr.includes('Lite Express (Air)') || consPdfStr.includes('Lite Express \\(Air\\)'),
  true,
  'PDF must include selected Courier'
);
assert.equal(consPdfStr.includes('Prepared and Counted by:'), true, 'PDF must include standard PL footer');
assert.equal(consPdfStr.includes('Verified by:'), true, 'PDF must include Verified by footer');
assert.equal(consPdfStr.includes('Receiving Branch Signature:'), true, 'PDF must include Receiving Branch Signature footer');
assert.equal(consPdfStr.includes('Pickup By:'), true, 'PDF must include Pickup By footer');
assert.equal(consPdfStr.includes('BUSINESS DISTRIBUTION CENTER'), true, 'PDF must include Declaration Form page');
assert.equal(consPdfStr.includes('ID HERE'), true, 'Declaration Form must include ID HERE box');
assert.equal(consPdfStr.includes('SHIPPED'), false, 'PL must omit Status field');

const plOnlyBytes = generateConsumablesToolsPackingListPdfBytes(consShipRes.shipment, { includeDeclarationForm: false });
const plOnlyStr = Buffer.from(plOnlyBytes).toString('latin1');
assert.equal(plOnlyStr.includes('BUSINESS DISTRIBUTION CENTER'), false, 'PL-only mode must omit Declaration Form page');

console.log('  ✓ PASS: Consumable serial number recording & duplicate guard passed');

console.log('ALL CONSUMABLES & TOOLS LIFECYCLE TESTS PASSED');
