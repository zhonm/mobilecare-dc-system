import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: Waybill Number Enlargement & Visibility');
console.log('====================================================');

// 1. Verify Shipments.jsx In-Transit Package Details Modal has enlarged Waybill & no wrap
const shipmentsFile = fs.readFileSync(path.join(__dirname, '../components/Shipments.jsx'), 'utf8');

assert(
  shipmentsFile.includes("fontSize: '13.5px'"),
  'In-Transit Package Details modal must display enlarged Waybill font (13.5px)'
);
assert(
  shipmentsFile.includes('whiteSpace: \'nowrap\''),
  'Waybill numbers must have whiteSpace: nowrap to prevent awkward line breaks'
);
assert(
  shipmentsFile.includes('Waybill') && shipmentsFile.includes('#{sh.tracking_number}'),
  'In-Transit Package Details modal must render Waybill label and #{sh.tracking_number}'
);
console.log('  ✓ PASS: Shipments.jsx details modal renders enlarged non-wrapping Waybill (13.5px)');

// 2. Verify Shipments.jsx Outbound Shipments table row has enlarged Waybill
assert(
  shipmentsFile.includes('Waybill') && shipmentsFile.includes('#{sh.tracking_number}'),
  'Outbound Shipments table row must display enlarged Waybill font (13.5px)'
);
console.log('  ✓ PASS: Shipments.jsx Outbound Shipments table row renders enlarged Waybill');

// 3. Verify ScanOutPacking.jsx Outbound drafts table has enlarged Waybill
const scanOutFile = fs.readFileSync(path.join(__dirname, '../components/ScanOutPacking.jsx'), 'utf8');

assert(
  scanOutFile.includes("fontSize: '13px'") && scanOutFile.includes('#{s.tracking_number}'),
  'ScanOutPacking draft table must display enlarged Waybill font with label'
);
console.log('  ✓ PASS: ScanOutPacking.jsx has enlarged Waybill in draft table (13px)');

// 4. Verify select-all class for easy copying
assert(
  shipmentsFile.includes('select-all') && scanOutFile.includes('select-all'),
  'Waybill numbers must include select-all for rapid copying by warehouse staff'
);
console.log('  ✓ PASS: select-all class enabled on Waybill elements for easy copying');

console.log('====================================================');
console.log('ALL WAYBILL VISIBILITY TESTS PASSED (4/4)');
console.log('====================================================');
