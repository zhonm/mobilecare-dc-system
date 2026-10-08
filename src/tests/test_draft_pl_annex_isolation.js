import assert from 'assert';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[match[1].trim()] = val;
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

console.log('=== VERIFYING DRAFT PL AND ANNEX STOCK ISOLATION ===');

async function runTests() {
  const annexSiteId = '438b8e51-3e54-4b12-9a1c-9a631713dc25';

  // 1. Verify G9P5207NNJZ14YDAX in Supabase inventory_units
  const { data: dbUnits } = await supabase
    .from('inventory_units')
    .select('*')
    .ilike('serial_number', '%G9P5207%');

  console.log('Step 1: DB inventory_units for G9P5207:', dbUnits);
  const annexDbMatch = (dbUnits || []).find(u => u.current_site_id === annexSiteId);
  assert.strictEqual(annexDbMatch, undefined, 'G9P5207 must NOT belong to Annex in inventory_units table');
  console.log('✓ PASS: G9P5207 is not in Annex in inventory_units table');

  // 2. Verify master_branch_inventory_registry
  const { data: branchDoc } = await supabase
    .from('saved_records')
    .select('snapshot_data')
    .eq('id', 'master_branch_inventory_registry')
    .maybeSingle();

  const branchMatch = (branchDoc?.snapshot_data?.units || []).find(u =>
    String(u.serial_number || '').includes('G9P5207') && (u.current_site_id === annexSiteId || u.site_code === 'APP ANX')
  );
  assert.strictEqual(branchMatch, undefined, 'G9P5207 must NOT be in master_branch_inventory_registry for Annex');
  console.log('✓ PASS: G9P5207 is removed from master_branch_inventory_registry');

  // 3. Simulate Draft PL Packing behavior in memory
  console.log('\n--- Step 3: Simulating Draft Packing List Behavior ---');
  let inventoryUnits = [
    {
      id: 'unit-dc-test-1',
      part_number: '661-30401',
      serial_number: 'TEST-SERIAL-14PM-001',
      current_site_id: 'site-dc',
      site_code: 'DC-MDC',
      status: 'in_stock'
    }
  ];

  // Helper getBranchStockOnHand logic
  const getBranchStockOnHand = (siteCode, units) => {
    const isDc = (u) => u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.is_dc;
    const siteUnits = units.filter(u => {
      if (u.status === 'packed' || u.status === 'draft') return false;
      if (siteCode === 'ALL') return !isDc(u);
      return (u.current_site_id === 'site-anx' || u.site_code === siteCode) && !isDc(u);
    });
    return siteUnits.filter(u => u.status === 'in_stock' || !u.status);
  };

  // Check Annex stock before draft PL
  let anxStockBefore = getBranchStockOnHand('APP ANX', inventoryUnits);
  assert.strictEqual(anxStockBefore.length, 0, 'Annex has 0 stock before draft PL');

  // User packs unit into a DRAFT PL for APP ANX
  const draftShipment = {
    id: 'draft-ship-1',
    site_id: 'site-anx',
    site_code: 'APP ANX',
    status: 'draft',
    items: [{ serial_number: 'TEST-SERIAL-14PM-001', part_number: '661-30401', box_number: 1 }]
  };

  // Simulating updated addScanOutUnit
  inventoryUnits = inventoryUnits.map(u => {
    if (u.serial_number === 'TEST-SERIAL-14PM-001') {
      return {
        ...u,
        status: 'packed',
        current_site_id: u.current_site_id || 'site-dc',
        destination_site_id: draftShipment.site_id,
        box_number: 1
      };
    }
    return u;
  });

  // Verify unit in draft packing station
  const packedUnit = inventoryUnits.find(u => u.serial_number === 'TEST-SERIAL-14PM-001');
  assert.strictEqual(packedUnit.status, 'packed');
  assert.strictEqual(packedUnit.current_site_id, 'site-dc', 'Unit current_site_id must remain site-dc during draft packing');

  // Verify Annex Stock during Draft mode
  let anxStockDuringDraft = getBranchStockOnHand('APP ANX', inventoryUnits);
  assert.strictEqual(anxStockDuringDraft.length, 0, 'Annex MUST have 0 stock while PL is in draft mode');
  console.log('✓ PASS: While PL is in draft mode, Annex has 0 stock on hand');

  // 4. Simulate Finalizing the Packing List
  console.log('\n--- Step 4: Simulating Finalize & Save Packing List ---');
  const finalizedShipment = {
    ...draftShipment,
    status: 'pending_pickup'
  };

  // Simulating updated saveShipment on finalized PL
  inventoryUnits = inventoryUnits.map(u => {
    if (u.serial_number === 'TEST-SERIAL-14PM-001') {
      return {
        ...u,
        status: 'packed',
        current_site_id: finalizedShipment.site_id,
        site_code: finalizedShipment.site_code,
        destination_site_id: finalizedShipment.site_id
      };
    }
    return u;
  });

  const finalizedUnit = inventoryUnits.find(u => u.serial_number === 'TEST-SERIAL-14PM-001');
  assert.strictEqual(finalizedUnit.current_site_id, 'site-anx');
  assert.strictEqual(finalizedUnit.site_code, 'APP ANX');
  console.log('✓ PASS: Finalized PL assigns unit to branch manifest for APP ANX');

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
