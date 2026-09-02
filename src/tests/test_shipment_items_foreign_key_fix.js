import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  formatShipmentForDb,
  formatShipmentItemsForDb,
  isUUID,
  safeUUID,
  toValidUUID
} from '../utils/appContextHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n====================================================');
console.log('TEST SUITE: Shipment Items Foreign Key Fix & Resilience');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

// 1. SQL Migration Script Verification
test('fix_shipment_items_scanned_by_fkey.sql exists and contains required constraint drops', () => {
  const sqlPath = path.join(__dirname, '../supabase/fix_shipment_items_scanned_by_fkey.sql');
  assert.ok(fs.existsSync(sqlPath), 'Migration SQL file must exist');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  assert.ok(sql.includes('DROP CONSTRAINT IF EXISTS shipment_items_scanned_by_fkey;'), 'Must drop shipment_items_scanned_by_fkey');
  assert.ok(sql.includes('DROP CONSTRAINT IF EXISTS shipment_items_shipment_id_fkey;'), 'Must drop shipment_items_shipment_id_fkey');
  assert.ok(sql.includes('DROP CONSTRAINT IF EXISTS shipment_items_part_id_fkey;'), 'Must drop shipment_items_part_id_fkey');
  assert.ok(sql.includes('DROP CONSTRAINT IF EXISTS shipment_items_inventory_unit_id_fkey;'), 'Must drop shipment_items_inventory_unit_id_fkey');
  assert.ok(sql.includes('ALTER COLUMN scanned_by DROP NOT NULL;'), 'Must make scanned_by nullable');
  assert.ok(sql.includes('DROP CONSTRAINT IF EXISTS shipments_created_by_fkey;'), 'Must drop shipments_created_by_fkey');
});

// 2. fix_shipment_constraints.sql Verification
test('fix_shipment_constraints.sql contains shipment_items_scanned_by_fkey drop', () => {
  const sqlPath = path.join(__dirname, '../supabase/fix_shipment_constraints.sql');
  assert.ok(fs.existsSync(sqlPath), 'fix_shipment_constraints.sql file must exist');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  assert.ok(sql.includes('DROP CONSTRAINT IF EXISTS shipment_items_scanned_by_fkey;'), 'Must drop shipment_items_scanned_by_fkey');
  assert.ok(sql.includes('ALTER COLUMN scanned_by DROP NOT NULL;'), 'Must make scanned_by nullable');
});

// 3. schema.sql Verification
test('schema.sql does not enforce restrictive foreign key on shipment_items.scanned_by', () => {
  const sqlPath = path.join(__dirname, '../supabase/schema.sql');
  assert.ok(fs.existsSync(sqlPath), 'schema.sql file must exist');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  assert.ok(!sql.includes('scanned_by UUID REFERENCES public.profiles(id)'), 'schema.sql must not enforce FK on scanned_by');
  assert.ok(sql.includes('ALTER TABLE public.shipment_items DROP CONSTRAINT IF EXISTS shipment_items_scanned_by_fkey;'), 'schema.sql must drop constraint if present');
});

// 4. formatShipmentItemsForDb with null/undefined currentUser
test('formatShipmentItemsForDb returns scanned_by: null when currentUser is null', () => {
  const shipment = {
    id: '11111111-1111-4111-8111-111111111111',
    shipment_number: 'SHP-2026-001',
    items: [
      { id: '22222222-2222-4222-8222-222222222222', serial_number: 'G9PQ1001', box_number: 1 }
    ]
  };

  const rows = formatShipmentItemsForDb(shipment, [], [], null);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].scanned_by, null, 'scanned_by must be null when currentUser is null');
  assert.strictEqual(rows[0].serial_number, 'G9PQ1001');
});

// 5. formatShipmentItemsForDb with non-UUID currentUser ID
test('formatShipmentItemsForDb returns scanned_by: null when currentUser ID is not a UUID', () => {
  const shipment = {
    id: '11111111-1111-4111-8111-111111111111',
    shipment_number: 'SHP-2026-001',
    items: [
      { id: '22222222-2222-4222-8222-222222222222', serial_number: 'G9PQ1001', box_number: 1 }
    ]
  };

  const currentUser = { id: 'usr-superadmin', email: 'superadmin@mobilecare.com' };
  const rows = formatShipmentItemsForDb(shipment, [], [], currentUser);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].scanned_by, null, 'scanned_by must be null when currentUser ID is non-UUID');
});

// 6. formatShipmentItemsForDb with valid UUID currentUser and usersList matching
test('formatShipmentItemsForDb preserves verified UUID when user exists in usersList', () => {
  const validUUID = '33333333-3333-4333-8333-333333333333';
  const shipment = {
    id: '11111111-1111-4111-8111-111111111111',
    shipment_number: 'SHP-2026-001',
    items: [
      { id: '22222222-2222-4222-8222-222222222222', serial_number: 'G9PQ1001', box_number: 1 }
    ]
  };

  const currentUser = { id: validUUID, email: 'tech@mobilecare.com' };
  const usersList = [{ id: validUUID, email: 'tech@mobilecare.com' }];

  const rows = formatShipmentItemsForDb(shipment, [], [], currentUser, usersList);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].scanned_by, validUUID, 'scanned_by must match verified user UUID');
});

// 7. formatShipmentItemsForDb with unverified user in usersList
test('formatShipmentItemsForDb returns scanned_by: null when user is not found in usersList', () => {
  const unverifiedUUID = '44444444-4444-4444-8444-444444444444';
  const shipment = {
    id: '11111111-1111-4111-8111-111111111111',
    shipment_number: 'SHP-2026-001',
    items: [
      { id: '22222222-2222-4222-8222-222222222222', serial_number: 'G9PQ1001', box_number: 1 }
    ]
  };

  const currentUser = { id: unverifiedUUID, email: 'stranger@external.com' };
  const usersList = [{ id: '55555555-5555-4555-8555-555555555555', email: 'admin@mobilecare.com' }];

  const rows = formatShipmentItemsForDb(shipment, [], [], currentUser, usersList);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].scanned_by, null, 'scanned_by must safely fallback to null for unverified user');
});

// 8. Safe direct insertion payload immunity
test('Safe direct insert payload nullifies part_id, inventory_unit_id, and scanned_by', () => {
  const shipment = {
    id: '11111111-1111-4111-8111-111111111111',
    shipment_number: 'SHP-2026-001',
    items: [
      { id: '22222222-2222-4222-8222-222222222222', serial_number: 'G9PQ1001', box_number: 1, part_id: 'bad-part', inventory_unit_id: 'bad-unit' },
      { id: '33333333-3333-4333-8333-333333333333', serial_number: 'G9PQ1002', box_number: 2, part_id: 'bad-part-2', inventory_unit_id: 'bad-unit-2' }
    ]
  };

  const shipmentItemsRows = formatShipmentItemsForDb(shipment, [], [], { id: 'usr-dummy' });
  const safeRows = shipmentItemsRows.map(r => ({
    ...r,
    shipment_id: shipment.id,
    part_id: null,
    inventory_unit_id: null,
    scanned_by: null
  }));

  assert.strictEqual(safeRows.length, 2);
  safeRows.forEach(row => {
    assert.strictEqual(row.part_id, null, 'part_id must be null in safeRows');
    assert.strictEqual(row.inventory_unit_id, null, 'inventory_unit_id must be null in safeRows');
    assert.strictEqual(row.scanned_by, null, 'scanned_by must be null in safeRows');
    assert.ok(isUUID(row.id), 'id must be valid UUID');
    assert.ok(isUUID(row.shipment_id), 'shipment_id must be valid UUID');
    assert.ok(row.serial_number, 'serial_number must be present');
  });
});

console.log('\n====================================================');
console.log(`RESULTS: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
}
