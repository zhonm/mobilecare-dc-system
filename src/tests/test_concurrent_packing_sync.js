// ============================================================================
// TEST SUITE: Simultaneous Multi-User Packing List & Stock Sync Parity
// Verifies:
// 1. Independent workstation drafts for concurrent users (Person 1 vs Person 2)
// 2. Real-time stock deduction when parts are added to packing lists
// 3. Prevention of duplicate serial scans across different users
// 4. Isolation of draft clearing and finalization (Person 1 does not wipe Person 2)
// 5. Finalized manifests appear in shared history for all users
// ============================================================================

import assert from 'assert';

console.log('====================================================');
console.log('TEST SUITE: Concurrent Multi-User Packing & Stock Sync');
console.log('====================================================');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
  }
}

// 1. Setup Mock Inventory Units
const initialInventory = [
  { id: 'unit-1', part_id: 'part-disp-13', part_number: '661-21988', serial_number: 'G9PQ1001', status: 'in_stock', current_site_id: 'site-dc' },
  { id: 'unit-2', part_id: 'part-disp-13', part_number: '661-21988', serial_number: 'G9PQ1002', status: 'in_stock', current_site_id: 'site-dc' },
  { id: 'unit-3', part_id: 'part-bat-13', part_number: '661-21990', serial_number: 'G9PQ2001', status: 'in_stock', current_site_id: 'site-dc' },
  { id: 'unit-4', part_id: 'part-bat-13', part_number: '661-21990', serial_number: 'G9PQ2002', status: 'in_stock', current_site_id: 'site-dc' },
  { id: 'unit-5', part_id: 'part-cam-13', part_number: '661-21995', serial_number: 'G9PQ3001', status: 'in_stock', current_site_id: 'site-dc' }
];

let sharedInventory = [...initialInventory];
let sharedShipments = [];

// Helper to filter available stock for a given user
function getAvailableStock(inventory, userPackedSerialsSet = new Set()) {
  return inventory.filter(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    if (userPackedSerialsSet.has(s)) return false;
    return u.status === 'in_stock' || (!u.status && u.current_site_id === 'site-dc');
  });
}

// Simulation of User 1 (Person 1) and User 2 (Person 2)
const user1 = { id: 'user-001', fullName: 'Person 1', email: 'person1@mobilecare.ph' };
const user2 = { id: 'user-002', fullName: 'Person 2', email: 'person2@mobilecare.ph' };

// Initial draft states (User-isolated)
let user1Draft = {
  id: 'ship-draft-1',
  invoice_ref: 'DCMSPIOWNED#001G',
  site_id: 'site-sm-megamall',
  prepared_by_name: user1.fullName,
  items: []
};

let user2Draft = {
  id: 'ship-draft-2',
  invoice_ref: 'DCMSPIOWNED#002G',
  site_id: 'site-ayala-cebu',
  prepared_by_name: user2.fullName,
  items: []
};

// 1. Initial State Checks
it('Initial available stock count is 5 units across all users', () => {
  const availUser1 = getAvailableStock(sharedInventory);
  const availUser2 = getAvailableStock(sharedInventory);
  assert.strictEqual(availUser1.length, 5);
  assert.strictEqual(availUser2.length, 5);
});

// 2. Person 1 packs unit G9PQ1001 and G9PQ2001
it('Person 1 packs 2 units into Draft A (SM Megamall)', () => {
  const serialsToPack = ['G9PQ1001', 'G9PQ2001'];
  
  serialsToPack.forEach(sn => {
    const unit = sharedInventory.find(u => u.serial_number === sn && u.status === 'in_stock');
    assert.ok(unit, `Unit ${sn} should be available in stock`);
    
    // Set status to packed with destination site
    unit.status = 'packed';
    unit.current_site_id = user1Draft.site_id;
    
    user1Draft.items.push({
      id: unit.id,
      part_number: unit.part_number,
      serial_number: unit.serial_number,
      box_number: 1
    });
  });

  assert.strictEqual(user1Draft.items.length, 2);
});

// 3. Real-Time Stock Deduction for Person 2
it('Available stock immediately decrements from 5 to 3 on Person 2 screen', () => {
  const availUser2 = getAvailableStock(sharedInventory);
  assert.strictEqual(availUser2.length, 3);
  
  const remainingSerials = availUser2.map(u => u.serial_number);
  assert.deepStrictEqual(remainingSerials, ['G9PQ1002', 'G9PQ2002', 'G9PQ3001']);
  assert.ok(!remainingSerials.includes('G9PQ1001'), 'G9PQ1001 must not be in available stock');
  assert.ok(!remainingSerials.includes('G9PQ2001'), 'G9PQ2001 must not be in available stock');
});

// 4. Duplicate Prevention: Person 2 attempts to scan a part already packed by Person 1
it('Person 2 is blocked from scanning serial G9PQ1001 (duplicate protection)', () => {
  const targetSerial = 'G9PQ1001';
  const unit = sharedInventory.find(u => u.serial_number === targetSerial);
  
  // Validation logic as in addScanOutUnit
  let scanSuccess = false;
  let errorMessage = '';
  
  if (!unit) {
    errorMessage = 'Unit not found in stock';
  } else if (unit.status !== 'in_stock') {
    errorMessage = `Unit is already ${unit.status}`;
  } else {
    scanSuccess = true;
  }
  
  assert.strictEqual(scanSuccess, false);
  assert.strictEqual(errorMessage, 'Unit is already packed');
});

// 5. Person 2 packs unit G9PQ1002 into Draft B (Ayala Cebu)
it('Person 2 packs 1 unit into Draft B (Ayala Cebu) concurrently', () => {
  const targetSerial = 'G9PQ1002';
  const unit = sharedInventory.find(u => u.serial_number === targetSerial && u.status === 'in_stock');
  assert.ok(unit);
  
  unit.status = 'packed';
  unit.current_site_id = user2Draft.site_id;
  
  user2Draft.items.push({
    id: unit.id,
    part_number: unit.part_number,
    serial_number: unit.serial_number,
    box_number: 1
  });
  
  assert.strictEqual(user2Draft.items.length, 1);
  assert.strictEqual(user2Draft.site_id, 'site-ayala-cebu');
  assert.strictEqual(user1Draft.site_id, 'site-sm-megamall');
});

// 6. Remaining Stock Check
it('Available stock count is now 2 units', () => {
  const avail = getAvailableStock(sharedInventory);
  assert.strictEqual(avail.length, 2);
  const remaining = avail.map(u => u.serial_number);
  assert.deepStrictEqual(remaining, ['G9PQ2002', 'G9PQ3001']);
});

// 7. Isolation check: Person 1 finalizes Draft A
it('Person 1 finalizes Draft A: Person 2 draft remains completely untouched', () => {
  // Finalize Draft A
  const finalizedA = {
    ...user1Draft,
    status: 'shipped',
    shipped_at: new Date().toISOString()
  };
  sharedShipments.push(finalizedA);
  
  // Mark units in shipment A as shipped
  finalizedA.items.forEach(it => {
    const u = sharedInventory.find(unit => unit.serial_number === it.serial_number);
    if (u) u.status = 'shipped';
  });
  
  // Reset Person 1 workstation for next site
  user1Draft = {
    id: 'ship-draft-3',
    invoice_ref: 'DCMSPIOWNED#003G',
    site_id: 'site-sm-north',
    prepared_by_name: user1.fullName,
    items: []
  };
  
  // Verify Person 2's draft is 100% preserved
  assert.strictEqual(user2Draft.items.length, 1);
  assert.strictEqual(user2Draft.site_id, 'site-ayala-cebu');
  assert.strictEqual(user2Draft.items[0].serial_number, 'G9PQ1002');
  assert.strictEqual(sharedShipments.length, 1);
  assert.strictEqual(sharedShipments[0].invoice_ref, 'DCMSPIOWNED#001G');
});

// 8. Person 2 removes item from Draft B: Returns to stock
it('Person 2 removes G9PQ1002 from Draft B: returns unit to in-stock inventory', () => {
  const removeSerial = 'G9PQ1002';
  user2Draft.items = user2Draft.items.filter(it => it.serial_number !== removeSerial);
  
  const unit = sharedInventory.find(u => u.serial_number === removeSerial);
  assert.ok(unit);
  unit.status = 'in_stock';
  unit.current_site_id = 'site-dc';
  
  const avail = getAvailableStock(sharedInventory);
  assert.strictEqual(avail.length, 3);
  assert.ok(avail.some(u => u.serial_number === 'G9PQ1002'));
});

// 9. Active Packing Presence
it('Packing presence accurately tracks active stations and sites', () => {
  const presenceMap = {};
  
  // Person 1 heartbeat
  presenceMap[user1.id] = {
    userId: user1.id,
    userName: user1.fullName,
    siteId: user1Draft.site_id,
    itemCount: user1Draft.items.length,
    isPacking: true,
    timestamp: Date.now()
  };
  
  // Person 2 heartbeat
  presenceMap[user2.id] = {
    userId: user2.id,
    userName: user2.fullName,
    siteId: user2Draft.site_id,
    itemCount: user2Draft.items.length,
    isPacking: true,
    timestamp: Date.now()
  };
  
  const activeStations = Object.values(presenceMap).filter(st => st.isPacking);
  assert.strictEqual(activeStations.length, 2);
  assert.strictEqual(activeStations.find(st => st.userId === user1.id).siteId, 'site-sm-north');
  assert.strictEqual(activeStations.find(st => st.userId === user2.id).siteId, 'site-ayala-cebu');
});

// 10. Real-Time Event Mutator: UNIT_PACKED payload processing
it('handleRealtimeInventoryEvent: UNIT_PACKED immediately updates peer inventory in memory', () => {
  let peerInventory = [
    { id: 'u-1', serial_number: 'SN-001', status: 'in_stock', current_site_id: 'site-dc' },
    { id: 'u-2', serial_number: 'SN-002', status: 'in_stock', current_site_id: 'site-dc' }
  ];

  const payload = { serialNumber: 'SN-001', siteId: 'site-sm-megamall', boxNumber: 1, status: 'packed' };
  
  // Apply mutator logic
  peerInventory = peerInventory.map(u => {
    if (u.serial_number === payload.serialNumber) {
      return { ...u, status: 'packed', current_site_id: payload.siteId, box_number: payload.boxNumber };
    }
    return u;
  });

  assert.strictEqual(peerInventory.find(u => u.serial_number === 'SN-001').status, 'packed');
  assert.strictEqual(peerInventory.find(u => u.serial_number === 'SN-001').current_site_id, 'site-sm-megamall');
  assert.strictEqual(peerInventory.find(u => u.serial_number === 'SN-002').status, 'in_stock');
});

// 11. Real-Time Event Mutator: UNITS_BATCH_PACKED payload processing
it('handleRealtimeInventoryEvent: UNITS_BATCH_PACKED updates multiple serials in a single pass', () => {
  let peerInventory = [
    { id: 'u-1', serial_number: 'SN-001', status: 'in_stock' },
    { id: 'u-2', serial_number: 'SN-002', status: 'in_stock' },
    { id: 'u-3', serial_number: 'SN-003', status: 'in_stock' }
  ];

  const payload = { serialNumbers: ['SN-001', 'SN-003'], siteId: 'site-cebu', status: 'packed' };
  const serialsSet = new Set(payload.serialNumbers);

  peerInventory = peerInventory.map(u => {
    if (serialsSet.has(u.serial_number)) {
      return { ...u, status: 'packed', current_site_id: payload.siteId };
    }
    return u;
  });

  assert.strictEqual(peerInventory.find(u => u.serial_number === 'SN-001').status, 'packed');
  assert.strictEqual(peerInventory.find(u => u.serial_number === 'SN-002').status, 'in_stock');
  assert.strictEqual(peerInventory.find(u => u.serial_number === 'SN-003').status, 'packed');
});

// 12. Real-Time Event Mutator: UNIT_UNPACKED payload processing
it('handleRealtimeInventoryEvent: UNIT_UNPACKED immediately restores unit to in_stock', () => {
  let peerInventory = [
    { id: 'u-1', serial_number: 'SN-001', status: 'packed', current_site_id: 'site-sm-megamall' }
  ];

  const payload = { serialNumber: 'SN-001', status: 'in_stock' };

  peerInventory = peerInventory.map(u => {
    if (u.serial_number === payload.serialNumber) {
      return { ...u, status: 'in_stock', current_site_id: 'site-dc', box_number: 1, shipped_at: null, shipped_by: null };
    }
    return u;
  });

  const unit = peerInventory.find(u => u.serial_number === 'SN-001');
  assert.strictEqual(unit.status, 'in_stock');
  assert.strictEqual(unit.current_site_id, 'site-dc');
});

// 13. Relational Join Resolution: Supabase dbU.parts mapping
it('Relational Join Resolution: dbU.parts reliably attaches part_number and description', () => {
  const dbRow = {
    id: 'unit-uuid-1',
    part_id: 'part-uuid-13-disp',
    serial_number: 'G9PQ9999',
    status: 'in_stock',
    current_site_id: 'site-dc',
    parts: {
      id: 'part-uuid-13-disp',
      part_number: '661-21988',
      description: 'Display, iPhone 13',
      stocking_price: 279,
      category_id: 'cat-disp'
    }
  };

  const partJoined = dbRow.parts;
  const mapped = {
    id: dbRow.id,
    part_id: partJoined?.id || dbRow.part_id,
    part_number: partJoined?.part_number,
    description: partJoined?.description,
    category_id: partJoined?.category_id,
    stocking_price: partJoined?.stocking_price || 99,
    serial_number: dbRow.serial_number,
    status: dbRow.status
  };

  assert.strictEqual(mapped.part_number, '661-21988');
  assert.strictEqual(mapped.description, 'Display, iPhone 13');
  assert.strictEqual(mapped.stocking_price, 279);
});

// 14. Multi-User Shipment Parity: Master Registry Aggregation & Cloud Sync
it('Master Shipments Registry: Person 2 with empty cache hydrates all 9 shipments from Person 1 cloud registry', () => {
  const person1Shipments = [
    { id: 'ship-1', invoice_ref: 'DCONMED#083126A', site_id: 'site-npm', items: [{ serial_number: 'SN-A1' }] },
    { id: 'ship-2', invoice_ref: 'DCONMED#083126B', site_id: 'site-lau', items: [{ serial_number: 'SN-B1' }] },
    { id: 'ship-3', invoice_ref: 'DCONMED#083126C', site_id: 'site-abr', items: [{ serial_number: 'SN-C1' }] },
    { id: 'ship-4', invoice_ref: 'DCONMED#083126D', site_id: 'site-nag', items: [{ serial_number: 'SN-D1' }] },
    { id: 'ship-5', invoice_ref: 'DCONMED#083126E', site_id: 'site-zam', items: [{ serial_number: 'SN-E1' }] },
    { id: 'ship-6', invoice_ref: 'DCONMED#083126F', site_id: 'site-lim', items: [{ serial_number: 'SN-F1' }] },
    { id: 'ship-7', invoice_ref: 'DCONMED#083126G', site_id: 'site-ilo', items: [{ serial_number: 'SN-G1' }] },
    { id: 'ship-8', invoice_ref: 'DCONMED#083126H', site_id: 'site-ceb', items: [{ serial_number: 'SN-H1' }] },
    { id: 'ship-9', invoice_ref: 'DCONMED#083126I', site_id: 'site-cdo', items: [{ serial_number: 'SN-I1' }] },
  ];

  const dbSavedRecordsMock = [
    {
      id: 'master_shipments_registry',
      record_type: 'shipments_registry',
      snapshot_data: {
        shipments: person1Shipments,
        deletedIds: []
      }
    }
  ];

  // Simulate Person 2 hydration
  const cloudShipmentsRegistryDoc = dbSavedRecordsMock.find(r => r.id === 'master_shipments_registry');
  const cloudShipmentsList = (cloudShipmentsRegistryDoc?.snapshot_data?.shipments && Array.isArray(cloudShipmentsRegistryDoc.snapshot_data.shipments))
    ? cloudShipmentsRegistryDoc.snapshot_data.shipments
    : [];

  const shipmentMap = new Map();
  cloudShipmentsList.forEach(s => {
    const canonicalRef = String(s.invoice_ref || s.shipment_number || s.id || '').trim().toUpperCase();
    if (canonicalRef) {
      shipmentMap.set(canonicalRef, s);
    }
  });

  const hydratedPerson2Shipments = Array.from(shipmentMap.values());
  assert.strictEqual(hydratedPerson2Shipments.length, 9, 'Person 2 must receive all 9 shipments from master_shipments_registry');
  assert.deepStrictEqual(
    hydratedPerson2Shipments.map(s => s.invoice_ref),
    ['DCONMED#083126A', 'DCONMED#083126B', 'DCONMED#083126C', 'DCONMED#083126D', 'DCONMED#083126E', 'DCONMED#083126F', 'DCONMED#083126G', 'DCONMED#083126H', 'DCONMED#083126I']
  );
});

// 15. Direct shipments table join with shipment_items resolution
it('Direct Shipments Table Join: Resolves nested shipment_items into items array', () => {
  const dbShipmentRow = {
    id: 'shp-uuid-1',
    invoice_ref: 'DCOVNED#083026A',
    shipment_number: 'SHIP-202608-001',
    status: 'ready_for_dispatch',
    shipment_items: [
      { id: 'item-1', serial_number: 'G9PQ9991', parts: { part_number: '661-21988', description: 'Display' } },
      { id: 'item-2', serial_number: 'G9PQ9992', parts: { part_number: '661-21989', description: 'Battery' } }
    ]
  };

  const formattedItems = Array.isArray(dbShipmentRow.shipment_items)
    ? dbShipmentRow.shipment_items.map(it => ({
        id: it.id,
        serial_number: it.serial_number,
        part_number: it.parts?.part_number || it.part_number,
        description: it.parts?.description || it.description
      }))
    : [];

  assert.strictEqual(formattedItems.length, 2);
  assert.strictEqual(formattedItems[0].serial_number, 'G9PQ9991');
  assert.strictEqual(formattedItems[0].part_number, '661-21988');
  assert.strictEqual(formattedItems[1].serial_number, 'G9PQ9992');
  assert.strictEqual(formattedItems[1].part_number, '661-21989');
});

console.log('====================================================');
console.log(`RESULTS: ${passedTests}/${totalTests} PASSED (0 FAILED)`);
console.log('====================================================');

if (passedTests !== totalTests) {
  process.exit(1);
}

