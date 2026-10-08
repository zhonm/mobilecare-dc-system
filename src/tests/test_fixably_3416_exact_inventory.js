import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { parseFixablyInventoryValueCsv } from '../utils/excelParser.js';
import { normalizeInventoryUnits, isProvincialSite } from '../utils/partResolver.js';
import { defaultPartsCatalog } from '../data/defaultCatalog.js';
import { reconcileUnitsWithPackedDrafts } from '../utils/appContextHelpers.js';
import { OFFICIAL_BRANCH_DIRECTORY } from '../constants/branchDirectory.js';

async function runTest() {
  console.log('--- Testing Fixably 3,416 Inventory Pipeline Consistency ---');

  // 1. Prepare sites
  const sites = Object.entries(OFFICIAL_BRANCH_DIRECTORY).map(([code, s]) => ({
    id: 'site-' + code.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    code,
    ...s
  }));

  // 2. Read and parse CSV
  const csvPath = path.resolve('Custom reports - Inventory Value.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const parseRes = await parseFixablyInventoryValueCsv(csvContent, defaultPartsCatalog, [], { sites });

  assert.strictEqual(parseRes.success, true, 'CSV parser must succeed');
  assert.strictEqual(parseRes.items.length, 3416, `CSV items must be exactly 3,416, got ${parseRes.items.length}`);
  console.log(`✓ 1. parseFixablyInventoryValueCsv parsed exactly ${parseRes.items.length} units`);

  // 3. Normalize units
  const normalized = normalizeInventoryUnits(parseRes.items, defaultPartsCatalog);
  assert.strictEqual(normalized.length, 3416, `Normalized units must be exactly 3,416, got ${normalized.length}`);
  console.log(`✓ 2. normalizeInventoryUnits preserved 100% of units (${normalized.length} units)`);

  // 4. Verify non-standard serials are retained
  const specialSerials = ['00', 'N', 'REPLACE', '661-22374'];
  specialSerials.forEach(sn => {
    const found = normalized.find(u => String(u.serial_number).trim().toUpperCase() === sn);
    assert(Boolean(found), `Special serial '${sn}' must be preserved in normalized units`);
  });
  console.log('✓ 3. Special technician serials (00, N, REPLACE, 661-22374) are fully preserved');

  // 5. Test reconcileUnitsWithPackedDrafts with potential cleared timestamps
  const reconciled = reconcileUnitsWithPackedDrafts(normalized, [], null, null);
  assert.strictEqual(reconciled.length, 3416, `Reconciled units must be exactly 3,416, got ${reconciled.length}`);
  console.log(`✓ 4. reconcileUnitsWithPackedDrafts preserved exactly ${reconciled.length} units`);

  // 6. Regional grouping check (Metro Manila vs Provincial)
  let mmCount = 0;
  let provCount = 0;
  const siteCounts = {};

  reconciled.forEach(u => {
    const sObj = sites.find(s => s.code === u.site_code);
    const isProv = isProvincialSite(sObj);
    if (isProv) {
      provCount++;
    } else {
      mmCount++;
    }
    siteCounts[u.site_code] = (siteCounts[u.site_code] || 0) + 1;
  });

  console.log(`✓ 5. Regional breakdown: Metro Manila = ${mmCount}, Provincial = ${provCount}, Total = ${mmCount + provCount}`);
  assert.strictEqual(mmCount, 2368, `Metro Manila count must be exactly 2,368, got ${mmCount}`);
  assert.strictEqual(provCount, 1048, `Provincial count must be exactly 1,048, got ${provCount}`);
  assert.strictEqual(mmCount + provCount, 3416, `Total count must be exactly 3,416, got ${mmCount + provCount}`);

  console.log('====================================================');
  console.log('ALL TESTS PASSED: Fixably 3,416 inventory consistency 100% verified!');
  console.log('====================================================');
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
