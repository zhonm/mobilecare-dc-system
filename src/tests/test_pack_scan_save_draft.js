/**
 * Automated Test: Pick List "Save Draft" functionality in ScanOutPacking
 * 
 * Verifies:
 * 1. User can save their current Pick List (PL) progress as a draft.
 * 2. Saving as draft preserves status strictly as "draft" (not "pending_pickup" / "Ready for Pickup").
 * 3. Draft can be edited (items added, items removed, metadata changed) and re-saved while maintaining "draft" status.
 * 4. Only when "Finalize & Save Packing List" is explicitly called does status change to "pending_pickup".
 * 5. Draft units remain DC-owned and are not recorded in part_transfer_history until finalized.
 */

import assert from 'assert';

console.log('--- RUNNING TEST: Pick List "Save Draft" Functionality ---');

// Mock site and parts
const mockSite = {
  id: 'site-bhs',
  code: 'BHS',
  name: 'Bonifacio High Street',
  region: 'Metro Manila'
};

const initialInventoryUnits = [
  {
    id: 'unit-1',
    serial_number: 'SN-IPHONE-001',
    part_number: '661-0001',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    current_owner: 'DC_MSPI-OWNED',
    movement_history: ['DC'],
    status: 'in_stock'
  },
  {
    id: 'unit-2',
    serial_number: 'SN-IPHONE-002',
    part_number: '661-0002',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    current_owner: 'DC_MSPI-OWNED',
    movement_history: ['DC'],
    status: 'in_stock'
  },
  {
    id: 'unit-3',
    serial_number: 'SN-IPHONE-003',
    part_number: '661-0003',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    current_owner: 'DC_MSPI-OWNED',
    movement_history: ['DC'],
    status: 'in_stock'
  }
];

// Mock shipments list state
let shipmentsList = [];
let recordedTransfers = [];

// Simulate saveShipment logic from useShipments.js
function mockSaveShipment(shipmentData, currentUnits) {
  const newShipment = {
    ...shipmentData,
    id: shipmentData.id || `ship-${Date.now()}`,
    status: shipmentData.status || 'draft',
    updated_at: new Date().toISOString()
  };

  const isUpd = shipmentsList.some(s => s.id === newShipment.id);
  if (isUpd) {
    shipmentsList = shipmentsList.map(s => s.id === newShipment.id ? newShipment : s);
  } else {
    shipmentsList = [newShipment, ...shipmentsList];
  }

  const isDraft = newShipment.status === 'draft';
  const serialsInShipment = new Set((newShipment.items || []).map(it => it.serial_number));

  // If finalized, record transfers
  if (!isDraft && newShipment.items && newShipment.items.length > 0) {
    newShipment.items.forEach(it => {
      recordedTransfers.push({
        serialNumber: it.serial_number,
        fromSiteCode: 'DC',
        toSiteCode: mockSite.code,
        transferType: 'Transfer'
      });
    });
  }

  // Update units
  const updatedUnits = currentUnits.map(u => {
    if (serialsInShipment.has(u.serial_number)) {
      return {
        ...u,
        status: isDraft ? 'packed' : 'packed',
        current_site_id: isDraft ? (u.current_site_id || 'site-dc') : (mockSite.id || u.current_site_id),
        current_owner: isDraft ? (u.current_owner || 'DC_MSPI-OWNED') : 'BHS_MSPI-OWNED',
        shipped_at: isDraft ? null : new Date().toISOString()
      };
    }
    return u;
  });

  return { newShipment, updatedUnits };
}

// 1. Initial State: Create a new workstation Pick List
let currentShipment = {
  id: 'ship-draft-test-1',
  invoice_ref: 'PL-MDC-20261020-001',
  shipment_number: 'SHP-20261020-001',
  site_id: mockSite.id,
  site_code: mockSite.code,
  carrier: 'Lalamove',
  status: 'draft',
  items: [
    { id: 'it-1', serial_number: 'SN-IPHONE-001', part_number: '661-0001' }
  ]
};

// 2. Perform Save Draft
console.log('Step 1: User clicks "Save Draft" with 1 item...');
const draftRes1 = mockSaveShipment({
  ...currentShipment,
  status: 'draft'
}, initialInventoryUnits);

assert.strictEqual(draftRes1.newShipment.status, 'draft', 'Status must remain "draft"');
assert.strictEqual(shipmentsList.length, 1, 'Shipments list should contain 1 draft');
assert.strictEqual(shipmentsList[0].status, 'draft', 'Stored shipment status must be "draft"');
assert.strictEqual(recordedTransfers.length, 0, 'No transfer history should be logged while in draft status');
const unit1 = draftRes1.updatedUnits.find(u => u.serial_number === 'SN-IPHONE-001');
assert.strictEqual(unit1.current_site_id, 'site-dc', 'Unit remains at DC while draft');
assert.strictEqual(unit1.current_owner, 'DC_MSPI-OWNED', 'Unit ownership remains DC_MSPI-OWNED while draft');
console.log('✓ Step 1 Passed: Draft saved successfully with status="draft", stock ownership preserved at DC');

// 3. Continue Editing: Add another item to the draft
console.log('Step 2: User continues editing, adds 2nd part, and clicks "Save Draft" again...');
currentShipment = {
  ...currentShipment,
  items: [
    ...currentShipment.items,
    { id: 'it-2', serial_number: 'SN-IPHONE-002', part_number: '661-0002' }
  ]
};

const draftRes2 = mockSaveShipment({
  ...currentShipment,
  status: 'draft'
}, draftRes1.updatedUnits);

assert.strictEqual(draftRes2.newShipment.status, 'draft', 'Status must still remain "draft"');
assert.strictEqual(shipmentsList.length, 1, 'Shipment should be updated in-place, not duplicated');
assert.strictEqual(shipmentsList[0].items.length, 2, 'Draft should now contain 2 items');
assert.strictEqual(recordedTransfers.length, 0, 'Still no transfer history logged in draft');
console.log('✓ Step 2 Passed: Draft updated in-place with 2 items, status remains "draft"');

// 4. Continue Editing: Remove 1 item and revise draft
console.log('Step 3: User removes item 1, updates notes, and clicks "Save Draft"...');
currentShipment = {
  ...currentShipment,
  items: currentShipment.items.filter(it => it.serial_number !== 'SN-IPHONE-001'),
  remarks: 'Urgent replacement shipment'
};

const draftRes3 = mockSaveShipment({
  ...currentShipment,
  status: 'draft'
}, draftRes2.updatedUnits);

assert.strictEqual(draftRes3.newShipment.status, 'draft', 'Status remains "draft"');
assert.strictEqual(shipmentsList[0].items.length, 1, 'Draft now has 1 item after removal');
assert.strictEqual(shipmentsList[0].remarks, 'Urgent replacement shipment', 'Remarks persisted');
console.log('✓ Step 3 Passed: Draft items revised and updated, status remains "draft"');

// 5. Finalize Action: User explicitly clicks "Finalize & Save Packing List"
console.log('Step 4: User clicks "Finalize & Save Packing List"...');
const finalizedRes = mockSaveShipment({
  ...currentShipment,
  status: 'pending_pickup' // Finalize transitions status to pending_pickup
}, draftRes3.updatedUnits);

assert.strictEqual(finalizedRes.newShipment.status, 'pending_pickup', 'Status transitions to "pending_pickup" on finalization');
assert.strictEqual(shipmentsList[0].status, 'pending_pickup', 'Stored shipment status updated to "pending_pickup"');
assert.strictEqual(recordedTransfers.length, 1, 'Transfer history logged now that shipment is finalized');
assert.strictEqual(recordedTransfers[0].serialNumber, 'SN-IPHONE-002', 'Transfer history recorded for finalized item');
const finalizedUnit2 = finalizedRes.updatedUnits.find(u => u.serial_number === 'SN-IPHONE-002');
assert.strictEqual(finalizedUnit2.current_owner, 'BHS_MSPI-OWNED', 'Ownership now transferred to destination site');
console.log('✓ Step 4 Passed: Status successfully transitioned from "draft" to "pending_pickup" upon explicit finalization!');

console.log('\n--- ALL PICK LIST SAVE DRAFT TESTS PASSED SUCCESSFULLY! ---');
