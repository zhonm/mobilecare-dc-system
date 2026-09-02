import { strict as assert } from 'assert';

console.log('\n====================================================');
console.log('TEST SUITE: Serial Number Only & Instant Auto-Pack Engine');
console.log('====================================================\n');

// 1. Mock DC Inventory Units
const mockInventory = [
  {
    id: 'unit-uuid-1',
    serial_number: 'G9PQHU084CQ9D088S5L4B',
    part_number: '661-21991',
    description: 'IPHONE 13 PRO DISPLAY MODULE',
    status: 'in_stock',
    current_site_id: 'site-dc',
    box_number: 1
  },
  {
    id: 'unit-uuid-2',
    serial_number: 'F8Y6276C1UQ13XCB1',
    part_number: '661-17789',
    description: 'IPHONE 12 BATTERY PACK',
    status: 'in_stock',
    current_site_id: 'site-dc',
    box_number: 1
  },
  {
    id: 'unit-uuid-3',
    serial_number: 'C02ZX001MD6R',
    part_number: '661-09823',
    description: 'MACBOOK PRO TOP CASE WITH BATTERY',
    status: 'shipped', // Already shipped/not in stock
    current_site_id: 'site-sm-megamall',
    box_number: 1
  }
];

// 2. Mock Shipment Draft
let currentDraft = {
  id: 'ship-draft-001',
  invoice_ref: 'DCONMDC#090226A',
  site_id: 'site-sm-megamall',
  items: []
};

// 3. Test packUnitBySerial function implementation
function packUnitBySerial(rawSerial, selectedSiteId, inventoryUnits, currentShipment, boxNumber = 1) {
  const cleanSerial = String(rawSerial || '').trim().toUpperCase();
  if (!cleanSerial) return { success: false, error: 'Empty serial number' };
  if (!selectedSiteId) return { success: false, error: 'Destination site required' };

  const packedSerialsSet = new Set((currentShipment?.items || []).map(it => String(it.serial_number || '').trim().toUpperCase()));
  if (packedSerialsSet.has(cleanSerial)) {
    return { success: false, error: 'Duplicate serial already packed' };
  }

  const matchingUnit = (inventoryUnits || []).find(u => String(u.serial_number || '').trim().toUpperCase() === cleanSerial);
  if (!matchingUnit) {
    return { success: false, error: 'Serial not found in DC inventory' };
  }

  const isDc = matchingUnit.current_site_id === 'site-dc' || !matchingUnit.current_site_id;
  if (!isDc || (matchingUnit.status && matchingUnit.status !== 'in_stock' && matchingUnit.status !== 'allocated')) {
    return { success: false, error: `Unit status is ${matchingUnit.status}` };
  }

  const item = {
    id: matchingUnit.id,
    part_number: matchingUnit.part_number,
    description: matchingUnit.description,
    serial_number: cleanSerial,
    box_number: boxNumber
  };

  return { success: true, item };
}

// Test Case 1: Require Destination Site
const resNoSite = packUnitBySerial('G9PQHU084CQ9D088S5L4B', null, mockInventory, currentDraft);
assert.equal(resNoSite.success, false);
assert.equal(resNoSite.error, 'Destination site required');
console.log('  ✓ PASS: Rejects pack scan if destination site is not selected');

// Test Case 2: Auto-Pack valid in-stock serial without needing Part Number
const resValid = packUnitBySerial('G9PQHU084CQ9D088S5L4B', currentDraft.site_id, mockInventory, currentDraft, 1);
assert.equal(resValid.success, true);
assert.equal(resValid.item.part_number, '661-21991');
assert.equal(resValid.item.description, 'IPHONE 13 PRO DISPLAY MODULE');
currentDraft.items.push(resValid.item);
console.log('  ✓ PASS: Successfully auto-packs serial G9PQHU084CQ9D088S5L4B and auto-attaches part 661-21991');

// Test Case 3: Duplicate protection
const resDup = packUnitBySerial('G9PQHU084CQ9D088S5L4B', currentDraft.site_id, mockInventory, currentDraft, 1);
assert.equal(resDup.success, false);
assert.equal(resDup.error, 'Duplicate serial already packed');
console.log('  ✓ PASS: Prevents duplicate scanning of already packed serial');

// Test Case 4: Non-existent serial
const resNotFound = packUnitBySerial('INVALID_SERIAL_999', currentDraft.site_id, mockInventory, currentDraft, 1);
assert.equal(resNotFound.success, false);
assert.equal(resNotFound.error, 'Serial not found in DC inventory');
console.log('  ✓ PASS: Correctly flags unknown serial number');

// Test Case 5: Out of stock / shipped unit
const resShipped = packUnitBySerial('C02ZX001MD6R', currentDraft.site_id, mockInventory, currentDraft, 1);
assert.equal(resShipped.success, false);
console.log('  ✓ PASS: Blocks packing of unit that is not in DC in_stock status');

// Test Case 6: Second valid unit
const resSecond = packUnitBySerial('F8Y6276C1UQ13XCB1', currentDraft.site_id, mockInventory, currentDraft, 2);
assert.equal(resSecond.success, true);
assert.equal(resSecond.item.box_number, 2);
currentDraft.items.push(resSecond.item);
assert.equal(currentDraft.items.length, 2);
console.log('  ✓ PASS: Successfully auto-packs second unit into Box 2');

console.log('\n====================================================');
console.log('RESULTS: ALL 6/6 AUTO-PACK TESTS PASSED (100%)');
console.log('====================================================\n');
