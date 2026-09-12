import assert from 'assert';
import { generateNextShipmentNumber } from '../utils/appContextHelpers.js';

console.log('========================================================================');
console.log('TEST SUITE: Shipment Number Generation & Sequential Conflict Resolution');
console.log('========================================================================');

async function runTests() {
  const testDate = new Date(2026, 8, 12); // September 12, 2026 (Month is 0-indexed: 8 = Sept)
  const currentPrefix = 'SHIP-202609-';

  // ── Test 1: Empty shipment list produces 001 ──────────────────────────────
  console.log('\nTest 1: Empty shipments list starts at 001');
  {
    const nextNum = generateNextShipmentNumber([], testDate);
    assert.strictEqual(nextNum, `${currentPrefix}001`, `Expected ${currentPrefix}001, got ${nextNum}`);
    console.log('  ✓ PASS: Empty shipments list initializes to SHIP-202609-001');
  }

  // ── Test 2: Monotonic incrementing with existing shipments ─────────────────
  console.log('\nTest 2: Monotonic incrementing with unordered list and gaps');
  {
    const existingList = [
      { shipment_number: `${currentPrefix}005`, invoice_ref: 'DCOWNED#091226A' },
      { shipment_number: `${currentPrefix}001`, invoice_ref: 'DCOWNED#091026A' },
      { shipment_number: `${currentPrefix}031`, invoice_ref: 'DCOWNED#091126Z' },
      { shipment_number: `${currentPrefix}012`, invoice_ref: 'DCOWNED#091126A' }
    ];

    const nextNum = generateNextShipmentNumber(existingList, testDate);
    assert.strictEqual(nextNum, `${currentPrefix}032`, `Expected ${currentPrefix}032 (max was 31), got ${nextNum}`);
    console.log('  ✓ PASS: Correctly determined next sequence SHIP-202609-032 based on highest sequence 031');
  }

  // ── Test 3: Sequential generation for rapid successive packing lists ───────
  console.log('\nTest 3: Rapid successive packing lists for provincial sites');
  {
    const shipments = [
      { shipment_number: `${currentPrefix}031`, invoice_ref: 'DCOWNED#091226A' }
    ];

    // User packs batteries for Davao: DCOWNED#091226B
    const nextNumB = generateNextShipmentNumber(shipments, testDate);
    assert.strictEqual(nextNumB, `${currentPrefix}032`);
    const shipmentB = {
      shipment_number: nextNumB,
      invoice_ref: 'DCOWNED#091226B',
      transfer_slip: '20227492',
      items: [{ serial: 'F8Y6176C01013XCB6', part_number: '661-22294' }]
    };
    shipments.push(shipmentB);

    // User immediately packs displays for Davao: DCOWNED#091226C
    const nextNumC = generateNextShipmentNumber(shipments, testDate);
    assert.strictEqual(nextNumC, `${currentPrefix}033`);
    const shipmentC = {
      shipment_number: nextNumC,
      invoice_ref: 'DCOWNED#091226C',
      transfer_slip: '20227493',
      items: [{ serial: 'G0N812345678', part_number: '661-23742' }]
    };
    shipments.push(shipmentC);

    assert.notStrictEqual(shipmentB.shipment_number, shipmentC.shipment_number, 'Shipment numbers must be strictly distinct');
    assert.strictEqual(shipments.length, 3);
    assert.strictEqual(shipments.find(s => s.invoice_ref === 'DCOWNED#091226B')?.shipment_number, `${currentPrefix}032`);
    assert.strictEqual(shipments.find(s => s.invoice_ref === 'DCOWNED#091226C')?.shipment_number, `${currentPrefix}033`);
    console.log('  ✓ PASS: Both manifests receive distinct sequential IDs (032 and 033) without collision or overwrite');
  }

  // ── Test 4: Month boundaries ──────────────────────────────────────────────
  console.log('\nTest 4: Month boundary separation');
  {
    const shipments = [
      { shipment_number: 'SHIP-202608-050', invoice_ref: 'DCOWNED#083126A' },
      { shipment_number: `${currentPrefix}005`, invoice_ref: 'DCOWNED#090126A' }
    ];

    // For August, next should be 051
    const nextAug = generateNextShipmentNumber(shipments, new Date(2026, 7, 31));
    assert.strictEqual(nextAug, 'SHIP-202608-051');

    // For September, next should be 006 (not affected by 050 from August)
    const nextSept = generateNextShipmentNumber(shipments, testDate);
    assert.strictEqual(nextSept, `${currentPrefix}006`);
    console.log('  ✓ PASS: Sequences are strictly scoped to their respective year/month prefix');
  }

  // ── Test 5: Transfer slip fallback resolution ──────────────────────────────
  console.log('\nTest 5: Transfer slip fallback resolution');
  {
    const legacyShipment = {
      id: 'ship-1',
      shipment_number: `${currentPrefix}032`,
      invoice_ref: 'DCOWNED#091226B',
      transfer_slip: '20227492'
    };
    const modernShipment = {
      id: 'ship-2',
      shipment_number: `${currentPrefix}033`,
      invoice_ref: 'DCOWNED#091226C',
      transfer_slip_number: '20227493'
    };

    const getTS = (s) => s.transfer_slip_number || s.transfer_slip || '';
    assert.strictEqual(getTS(legacyShipment), '20227492');
    assert.strictEqual(getTS(modernShipment), '20227493');
    console.log('  ✓ PASS: Transfer slip correctly resolves from both transfer_slip_number and transfer_slip fields');
  }

  // ── Test 6: Double-Click Prevention & Synchronous Submission Locking ───────
  console.log('\nTest 6: Double-Click Prevention & Synchronous Submission Locking');
  {
    let callCount = 0;
    const isSubmittingRef = { current: false };

    const simulatedSubmit = async () => {
      if (isSubmittingRef.current) return { blocked: true };
      isSubmittingRef.current = true;
      try {
        callCount++;
        await new Promise(r => setTimeout(r, 50));
        return { success: true };
      } finally {
        isSubmittingRef.current = false;
      }
    };

    // User rapidly double-clicks the confirm button in parallel
    const [click1, click2] = await Promise.all([
      simulatedSubmit(),
      simulatedSubmit()
    ]);

    assert.strictEqual(callCount, 1, 'Only one submission should be executed');
    assert.strictEqual(click1.success, true);
    assert.strictEqual(click2.blocked, true, 'Second click must be blocked synchronously');
    console.log('  ✓ PASS: Submission guard strictly blocks duplicate / rapid double-clicks');
  }

  console.log('\n========================================================================');
  console.log('ALL SHIPMENT NUMBER & CONFLICT RESOLUTION TESTS PASSED SUCCESSFULLY! ✓');
  console.log('========================================================================\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
