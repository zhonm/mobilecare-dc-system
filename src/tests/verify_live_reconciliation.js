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

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function verifyLiveReconciliation() {
  console.log('=== VERIFYING LIVE CLOUDSYNC RECONCILIATION FROM SUPABASE ===');

  const annexSiteId = '438b8e51-3e54-4b12-9a1c-9a631713dc25';

  // 1. Fetch live dbUnits from Supabase
  const { data: dbUnits } = await supabase.from('inventory_units').select('*');
  console.log(`Total live dbUnits: ${dbUnits?.length || 0}`);

  // 2. Fetch live saved_records
  const { data: dbSavedRecords } = await supabase.from('saved_records').select('*');
  console.log(`Total saved records: ${dbSavedRecords?.length || 0}`);

  // 3. Reconcile exact logic from useCloudSync.js
  const map = new Map();

  (dbUnits || []).forEach(dbU => {
    const s = String(dbU.serial_number || '').trim().toUpperCase();
    if (s) {
      map.set(s, {
        id: dbU.id,
        serial_number: s,
        current_site_id: dbU.current_site_id,
        status: dbU.status,
        updated_at: dbU.updated_at
      });
    }
  });

  const branchMasterInvDoc = dbSavedRecords?.find(r => r.id === 'master_branch_inventory_registry');
  if (branchMasterInvDoc?.snapshot_data?.units) {
    branchMasterInvDoc.snapshot_data.units.forEach(u => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s) {
        if (!map.has(s)) {
          map.set(s, u);
        } else {
          const existing = map.get(s);
          const existingTime = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
          const uTime = u?.updated_at ? new Date(u.updated_at).getTime() : 0;
          const preferExisting = existingTime >= uTime;

          map.set(s, {
            ...u,
            ...existing,
            current_site_id: preferExisting ? existing.current_site_id : (u.current_site_id || existing.current_site_id),
            site_code: preferExisting ? (existing.site_code || (existing.current_site_id === '2cf62bf6-14cf-4d31-838e-9bff43fb9018' ? 'DC-MDC' : u.site_code)) : (u.site_code || existing.site_code),
            status: existing.status
          });
        }
      }
    });
  }

  const allInventory = Array.from(map.values());

  // Find G9P5207NNJZ14YDAX
  const target = allInventory.find(u => u.serial_number === 'G9P5207NNJZ14YDAX');
  console.log('Resolved unit G9P5207NNJZ14YDAX:', target);

  assert(target, 'Target unit must exist');
  assert.notStrictEqual(target.current_site_id, annexSiteId, 'Target unit current_site_id must NOT be Annex');
  assert.strictEqual(target.current_site_id, '2cf62bf6-14cf-4d31-838e-9bff43fb9018', 'Target unit must belong to Central DC');

  // Verify branch stock filter for Annex
  const isDc = (u) => u.current_site_id === '2cf62bf6-14cf-4d31-838e-9bff43fb9018' || u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC';
  const annexStock = allInventory.filter(u => {
    if (u.status === 'packed' || u.status === 'draft') return false;
    if (isDc(u)) return false;
    return u.current_site_id === annexSiteId || u.site_code === 'APP ANX';
  }).filter(u => u.status === 'in_stock');

  const hasTargetInAnnex = annexStock.some(u => u.serial_number === 'G9P5207NNJZ14YDAX');
  assert.strictEqual(hasTargetInAnnex, false, 'G9P5207NNJZ14YDAX must NOT be in Annex Stock on Hand');
  console.log('✓ PASS: G9P5207NNJZ14YDAX is strictly isolated to Central DC and absent from Annex Stock on Hand!');
  console.log('=== VERIFICATION COMPLETE & PASSED ===');
}

verifyLiveReconciliation().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
