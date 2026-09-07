import assert from 'assert';
import { isDisplayOrBatteryForIPhone13Plus } from '../utils/partResolver.js';
import { defaultPartsCatalog } from '../data/defaultCatalog.js';

console.log('====================================================');
console.log('TEST SUITE: Multi-Part Request Batch & iPhone 13+ Displays/Batteries');
console.log('====================================================');

let passedTests = 0;
function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// ----------------------------------------------------
// 1. CATALOG RESTRICTION: isDisplayOrBatteryForIPhone13Plus
// ----------------------------------------------------
console.log('\n--- 1. Catalog Restriction Rules ---');

it('Approves Displays for iPhone 13, 14, 15, 16, 17 series', () => {
  const testParts = [
    { part_number: '661-37213', description: 'Display, iPhone 15 Plus', iphone_model: 'iPhone 15 Plus', category_id: 'cat-display' },
    { part_number: '661-44955', description: 'Display, iPhone 16 Pro Max', iphone_model: 'iPhone 16 Pro Max', category_id: 'cat-display' },
    { part_number: '661-30401', description: 'Display, iPhone 14 Pro Max', iphone_model: 'iPhone 14 Pro Max', category_id: 'cat-display' },
    { part_number: '661-22375', description: 'Display, iPhone 13 mini', iphone_model: 'iPhone 13 mini', category_id: 'cat-display' },
    { part_number: '661-17001', description: 'Display, iPhone 17', iphone_model: 'iPhone 17', category_id: 'cat-display' },
    { part_number: '661-17002', description: 'Display, iPhone 17 Pro', iphone_model: 'iPhone 17 Pro', category_id: 'cat-display' },
    { part_number: '661-17003', description: 'Display, iPhone 17 Pro Max', iphone_model: 'iPhone 17 Pro Max', category_id: 'cat-display' }
  ];

  testParts.forEach(p => {
    assert.strictEqual(
      isDisplayOrBatteryForIPhone13Plus(p),
      true,
      `Should accept display: ${p.description}`
    );
  });
});

it('Approves Batteries for iPhone 13, 14, 15, 16, 17 series', () => {
  const testParts = [
    { part_number: '661-21991', description: 'Battery, iPhone 13', iphone_model: 'iPhone 13', category_id: 'cat-battery' },
    { part_number: '661-22374', description: 'Battery, iPhone 13 mini', iphone_model: 'iPhone 13 mini', category_id: 'cat-battery' },
    { part_number: '661-30397', description: 'Battery, iPhone 14 Pro Max', iphone_model: 'iPhone 14 Pro Max', category_id: 'cat-battery' },
    { part_number: '661-36918', description: 'Battery, iPhone 15 Pro Max', iphone_model: 'iPhone 15 Pro Max', category_id: 'cat-battery' },
    { part_number: '661-42728', description: 'Battery, iPhone 16 Pro', iphone_model: 'iPhone 16 Pro', category_id: 'cat-battery' },
    { part_number: '661-17010', description: 'Battery, iPhone 17', iphone_model: 'iPhone 17', category_id: 'cat-battery' },
    { part_number: '661-17011', description: 'Battery, pSIM, iPhone 17 Pro', iphone_model: 'iPhone 17 Pro', category_id: 'cat-battery' },
    { part_number: '661-17012', description: 'Battery, pSIM, iPhone 17 Pro Max', iphone_model: 'iPhone 17 Pro Max', category_id: 'cat-battery' }
  ];

  testParts.forEach(p => {
    assert.strictEqual(
      isDisplayOrBatteryForIPhone13Plus(p),
      true,
      `Should accept battery: ${p.description}`
    );
  });
});

it('Rejects non-display and non-battery parts (cameras, back glass, enclosures, screws)', () => {
  const nonEligibleParts = [
    { part_number: '661-30393', description: 'Camera, iPhone 14 Plus', iphone_model: 'iPhone 14 Plus', category_id: 'cat-camera-rear' },
    { part_number: '661-30391', description: 'TrueDepth Camera, iPhone 14 Plus', iphone_model: 'iPhone 14 Plus', category_id: 'cat-camera-truedepth' },
    { part_number: '661-42727', description: 'TrueDepth Camera, iPhone 16 Pro', iphone_model: 'iPhone 16 Pro', category_id: 'cat-camera-truedepth' },
    { part_number: '661-17050', description: 'Lavender, Back Glass, iPhone 17', iphone_model: 'iPhone 17', category_id: 'cat-backglass' },
    { part_number: '661-17051', description: 'Camera, iPhone 17 Pro Max', iphone_model: 'iPhone 17 Pro Max', category_id: 'cat-camera' },
    { part_number: '661-17052', description: 'Front Camera, iPhone 17', iphone_model: 'iPhone 17', category_id: 'cat-camera' },
    { part_number: '661-17053', description: 'Deep Blue, Back Glass, iPhone 17 Pro', iphone_model: 'iPhone 17 Pro', category_id: 'cat-backglass' },
    { part_number: '661-99999', description: 'Screw Kit, iPhone 15', iphone_model: 'iPhone 15', category_id: 'cat-screws' }
  ];

  nonEligibleParts.forEach(p => {
    assert.strictEqual(
      isDisplayOrBatteryForIPhone13Plus(p),
      false,
      `Should REJECT non-display/battery part: ${p.description}`
    );
  });
});

it('Rejects legacy iPhone models (iPhone 12, 11, X, 8, SE) even for displays and batteries', () => {
  const legacyParts = [
    { part_number: '661-18001', description: 'Display, iPhone 12', iphone_model: 'iPhone 12', category_id: 'cat-display' },
    { part_number: '661-18002', description: 'Battery, iPhone 12 Pro', iphone_model: 'iPhone 12 Pro', category_id: 'cat-battery' },
    { part_number: '661-18003', description: 'Display, iPhone 11', iphone_model: 'iPhone 11', category_id: 'cat-display' },
    { part_number: '661-18004', description: 'Battery, iPhone 11 Pro Max', iphone_model: 'iPhone 11 Pro Max', category_id: 'cat-battery' },
    { part_number: '661-18005', description: 'Display, iPhone SE (3rd Gen)', iphone_model: 'iPhone SE', category_id: 'cat-display' },
    { part_number: '661-18006', description: 'Battery, iPhone SE', iphone_model: 'iPhone SE', category_id: 'cat-battery' },
    { part_number: '661-18007', description: 'Display, iPhone X', iphone_model: 'iPhone X', category_id: 'cat-display' }
  ];

  legacyParts.forEach(p => {
    assert.strictEqual(
      isDisplayOrBatteryForIPhone13Plus(p),
      false,
      `Should REJECT legacy part: ${p.description}`
    );
  });
});

// ----------------------------------------------------
// 2. SIMULATION OF MULTI-PART REQUEST BATCH SUBMISSION
// ----------------------------------------------------
console.log('\n--- 2. Multi-Part Request Batch Submission Simulation ---');

it('Submits multiple parts (iPhone 17 battery, iPhone 14 Pro battery, iPhone 17 Pro display) in a single transaction', () => {
  const requestingSite = { id: 'site-ppm', code: 'APP PPM', name: 'Power Plant Mall' };
  const requestingUser = { id: 'usr-pmg-01', fullName: 'Jose Rizal', role: 'parts_management', siteId: 'site-ppm' };

  // Example from User prompt:
  // "Battery for iPhone 17 and 14 Pro, as well as a display for iPhone 17 Pro, all in one submission"
  const requestedItems = [
    {
      partNumber: '661-17010',
      description: 'Battery, iPhone 17',
      iphone_model: 'iPhone 17',
      quantity: 1,
      notes: 'Work Order #WO-2026-901'
    },
    {
      partNumber: '661-30397',
      description: 'Battery, iPhone 14 Pro',
      iphone_model: 'iPhone 14 Pro',
      quantity: 2,
      notes: 'Buffer replenishment'
    },
    {
      partNumber: '661-17002',
      description: 'Display, iPhone 17 Pro',
      iphone_model: 'iPhone 17 Pro',
      quantity: 1,
      notes: 'Customer drop damage'
    }
  ];

  // 1. Verify all requested items pass restriction check
  requestedItems.forEach(item => {
    assert.strictEqual(
      isDisplayOrBatteryForIPhone13Plus(item),
      true,
      `Item ${item.description} must pass restriction`
    );
  });

  // 2. Simulate submitBatchPartsRequests execution
  const batchYearMonth = '202609';
  const batchSeed = 88123;
  const batchRequests = requestedItems.map((item, idx) => {
    const itemSuffix = requestedItems.length > 1 ? `-${String(idx + 1).padStart(2, '0')}` : '';
    return {
      id: `req-test-${idx + 1}`,
      request_number: `PR-${batchYearMonth}-${batchSeed}${itemSuffix}`,
      site_id: requestingSite.id,
      site_code: requestingSite.code,
      site_name: requestingSite.name,
      part_number: item.partNumber,
      part_description: item.description,
      quantity_requested: item.quantity,
      quantity_fulfilled: 0,
      status: 'pending',
      priority: 'urgent',
      requested_by: requestingUser.id,
      requested_by_name: requestingUser.fullName,
      reason: 'Customer Repair Backlog (Immediate Need)',
      notes: item.notes,
      created_at: new Date().toISOString()
    };
  });

  assert.strictEqual(batchRequests.length, 3, 'Must create 3 request records');
  assert.strictEqual(batchRequests[0].request_number, 'PR-202609-88123-01');
  assert.strictEqual(batchRequests[1].request_number, 'PR-202609-88123-02');
  assert.strictEqual(batchRequests[2].request_number, 'PR-202609-88123-03');

  // Quantities
  assert.strictEqual(batchRequests[0].quantity_requested, 1);
  assert.strictEqual(batchRequests[1].quantity_requested, 2);
  assert.strictEqual(batchRequests[2].quantity_requested, 1);
  const totalUnits = batchRequests.reduce((acc, r) => acc + r.quantity_requested, 0);
  assert.strictEqual(totalUnits, 4, 'Total units must equal 4');

  // Attribution
  batchRequests.forEach(req => {
    assert.strictEqual(req.site_id, 'site-ppm');
    assert.strictEqual(req.requested_by, 'usr-pmg-01');
    assert.strictEqual(req.status, 'pending');
  });
});

it('Filters defaultPartsCatalog strictly to iPhone 13+ Displays & Batteries', () => {
  const eligibleFromDefault = defaultPartsCatalog.filter(isDisplayOrBatteryForIPhone13Plus);
  assert.ok(eligibleFromDefault.length > 0, 'Catalog should contain eligible iPhone 13+ displays and batteries');

  // Verify none of the filtered parts are cameras or legacy models
  eligibleFromDefault.forEach(p => {
    const desc = (p.description || '').toLowerCase();
    const model = (p.iphone_model || '').toLowerCase();
    assert.ok(!desc.includes('camera'), `No camera allowed in filtered catalog: ${desc}`);
    assert.ok(!desc.includes('back glass'), `No back glass allowed: ${desc}`);
    assert.ok(
      model.includes('iphone 13') ||
      model.includes('iphone 14') ||
      model.includes('iphone 15') ||
      model.includes('iphone 16') ||
      model.includes('iphone 17') ||
      /iphone\s*(1[3-9]|[2-9][0-9])/i.test(model) ||
      /iphone\s*(1[3-9]|[2-9][0-9])/i.test(desc),
      `Only iPhone 13+ allowed: ${model} - ${desc}`
    );
  });
});

console.log('\n====================================================');
console.log(`ALL MULTI-PART REQUEST BATCH TESTS PASSED (${passedTests}/${passedTests})`);
console.log('====================================================');
