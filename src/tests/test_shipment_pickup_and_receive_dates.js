import assert from 'assert';
import { formatShipmentForDb } from '../utils/appContextHelpers.js';

console.log('--- Running Test: Shipment Pickup & Receive Dates ---');

// 1. Test formatShipmentForDb populates shipment_date & receiving_signature
const mockShipment = {
  id: 'd9b1a540-c782-4fa0-8f92-ec5c0d291888',
  shipment_number: 'SHP-202609-001',
  invoice_ref: 'DCOWNED#091226I',
  site_id: 'e106316d-39f2-4fd3-b825-42a98f483bf0',
  pickup_date: '2026-09-14',
  received_date: '2026-09-20',
  received_by_name: 'Rhomar P. Natibo-oc - PMA',
  status: 'received_confirmed'
};

const formatted = formatShipmentForDb(mockShipment);
assert.strictEqual(formatted.shipment_date, '2026-09-14', 'formatShipmentForDb should preserve pickup_date in shipment_date');
assert.strictEqual(formatted.receiving_signature, 'Rhomar P. Natibo-oc - PMA', 'formatShipmentForDb should map received_by_name to receiving_signature');
assert.strictEqual(formatted.status, 'received_confirmed', 'formatShipmentForDb should preserve status');
console.log('✓ Test 1 Passed: formatShipmentForDb sets shipment_date & receiving_signature');

// 2. Test fallback date resolution logic for confirmed shipments without native columns
function resolveShipmentDatesAndReceivers(s) {
  const isConfirmed = s.status === 'received_confirmed' || s.status === 'delivered';
  const effectivePickupDate = s.pickup_date || s.shipment_date || '';
  let effectiveReceivedDate = s.received_date || (s.received_at ? String(s.received_at).substring(0, 10) : '');
  let effectiveReceivedAt = s.received_at || '';

  if (isConfirmed) {
    if (!effectiveReceivedDate) {
      if (s.updated_at) {
        effectiveReceivedDate = String(s.updated_at).substring(0, 10);
      } else if (s.created_at) {
        effectiveReceivedDate = String(s.created_at).substring(0, 10);
      } else if (effectivePickupDate) {
        effectiveReceivedDate = effectivePickupDate;
      }
    }
    if (!effectiveReceivedAt) {
      effectiveReceivedAt = s.updated_at || (effectiveReceivedDate ? `${effectiveReceivedDate}T12:00:00.000Z` : s.created_at) || '';
    }
  }

  const effectiveReceivedByName = s.received_by_name || s.receiving_signature || (isConfirmed ? 'Authorized Staff' : '');
  const effectiveReceivingSignature = s.receiving_signature || effectiveReceivedByName || '';

  return {
    pickup_date: effectivePickupDate,
    received_date: effectiveReceivedDate,
    received_at: effectiveReceivedAt,
    received_by_name: effectiveReceivedByName,
    receiving_signature: effectiveReceivingSignature
  };
}

// Case A: Confirmed shipment with only legacy/standard DB fields
const legacyConfirmedShipment = {
  id: 'd9b1a540-c782-4fa0-8f92-ec5c0d291888',
  invoice_ref: 'DCOWNED#091226I',
  status: 'received_confirmed',
  shipment_date: '2026-09-14',
  receiving_signature: 'Rhomar P. Natibo-oc - PMA',
  updated_at: '2026-09-19T10:14:45.244+00:00'
};

const resolvedA = resolveShipmentDatesAndReceivers(legacyConfirmedShipment);
assert.strictEqual(resolvedA.pickup_date, '2026-09-14', 'Pickup date should resolve to 2026-09-14');
assert.strictEqual(resolvedA.received_date, '2026-09-19', 'Receive date should resolve to 2026-09-19 from updated_at');
assert.strictEqual(resolvedA.received_by_name, 'Rhomar P. Natibo-oc - PMA', 'Receiver name should resolve to Rhomar P. Natibo-oc - PMA');
console.log('✓ Test 2 Passed: Legacy confirmed shipment date & receiver fallback resolution works');

// Case B: Confirmed shipment with explicit pickup and receive dates
const modernConfirmedShipment = {
  id: 'd9b1a540-c782-4fa0-8f92-ec5c0d291889',
  invoice_ref: 'DCOWNED#091226G',
  status: 'received_confirmed',
  pickup_date: '2026-09-14',
  received_date: '2026-09-20',
  received_at: '2026-09-20T08:30:00.000Z',
  received_by_name: 'Maria Santos',
  updated_at: '2026-09-20T08:30:15.000Z'
};

const resolvedB = resolveShipmentDatesAndReceivers(modernConfirmedShipment);
assert.strictEqual(resolvedB.pickup_date, '2026-09-14', 'Explicit pickup date preserved');
assert.strictEqual(resolvedB.received_date, '2026-09-20', 'Explicit receive date preserved');
assert.strictEqual(resolvedB.received_by_name, 'Maria Santos', 'Explicit receiver name preserved');
console.log('✓ Test 3 Passed: Explicit pickup and receive dates are properly preserved');

// Case C: Pending pickup shipment
const pendingShipment = {
  id: 'd9b1a540-c782-4fa0-8f92-ec5c0d291890',
  status: 'pending_pickup',
  shipment_date: '',
  pickup_date: ''
};
const resolvedC = resolveShipmentDatesAndReceivers(pendingShipment);
assert.strictEqual(resolvedC.pickup_date, '', 'Pending shipment pickup date is empty');
assert.strictEqual(resolvedC.received_date, '', 'Pending shipment received date is empty');
console.log('✓ Test 4 Passed: Pending pickup shipment properly leaves dates empty');

console.log('All tests passed successfully!');
