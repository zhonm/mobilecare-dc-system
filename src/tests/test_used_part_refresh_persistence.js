import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { reconcileUnitsWithPackedDrafts } from '../utils/appContextHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Testing Used Part Persistence Across Refresh & Shipment Reconciliation...');

// 1. Verify PMG_DOC_IDS and SYSTEM_DOC_IDS include master_used_parts_registry in useCloudSync.js
const cloudSyncPath = path.resolve(__dirname, '../context/useCloudSync.js');
const cloudSyncSrc = fs.readFileSync(cloudSyncPath, 'utf8');

assert(
  cloudSyncSrc.includes("'master_used_parts_registry'") &&
  cloudSyncSrc.includes("PMG_DOC_IDS = [") &&
  cloudSyncSrc.indexOf("'master_used_parts_registry'") > cloudSyncSrc.indexOf("PMG_DOC_IDS = ["),
  'PMG_DOC_IDS must include master_used_parts_registry'
);
console.log('✓ PASS: PMG_DOC_IDS includes master_used_parts_registry');

assert(
  cloudSyncSrc.includes("SYSTEM_DOC_IDS = [") &&
  cloudSyncSrc.lastIndexOf("'master_used_parts_registry'") > cloudSyncSrc.indexOf("SYSTEM_DOC_IDS = ["),
  'SYSTEM_DOC_IDS must include master_used_parts_registry'
);
console.log('✓ PASS: SYSTEM_DOC_IDS includes master_used_parts_registry');

// 2. Verify reconcileUnitsWithPackedDrafts does NOT revert used units when a confirmed shipment exists
const sampleSerial = 'G9P1204D9H0J4F849';
const mockUnits = [
  {
    serial_number: sampleSerial,
    part_number: '661-10608',
    description: 'Display, iPhone Xs',
    status: 'used',
    work_order_number: 'WO-998877',
    usage_notes: 'Replaced cracked screen',
    used_at: new Date().toISOString(),
    current_site_id: 'site-ilo',
    site_code: 'ASP ILO'
  }
];

const mockShipments = [
  {
    id: 'shipment-123',
    status: 'received_confirmed',
    site_id: 'site-ilo',
    site_code: 'ASP ILO',
    items: [
      {
        serial_number: sampleSerial,
        part_number: '661-10608',
        description: 'Display, iPhone Xs'
      }
    ]
  }
];

const reconciled = reconcileUnitsWithPackedDrafts(mockUnits, mockShipments);
const targetUnit = reconciled.find(u => u.serial_number === sampleSerial);

assert(targetUnit, 'Target unit must exist in reconciled output');
assert.strictEqual(targetUnit.status, 'used', `Unit status must remain "used", but was "${targetUnit.status}"`);
assert.strictEqual(targetUnit.work_order_number, 'WO-998877', 'Work order number must be preserved');
console.log('✓ PASS: reconcileUnitsWithPackedDrafts preserves status="used" despite confirmed historical shipment');

// 3. Verify cold startup reload simulation where inputUnits is empty but mdc_master_used_parts_registry exists
const coldSerial = 'GVH54610SLHPR5PAK';
const mockRegistry = [
  {
    serial_number: coldSerial,
    part_number: '661-21988',
    work_order_number: '20031234',
    usage_notes: 'Repaired screen on iPhone 13',
    used_at: '2026-10-07T12:00:00.000Z',
    date_used: '2026-10-07',
    site_id: 'site-ilo',
    site_code: 'ASP ILO'
  }
];

// Mock localStorage for test environment
global.localStorage = {
  getItem: (key) => {
    if (key === 'mdc_master_used_parts_registry') return JSON.stringify(mockRegistry);
    return null;
  },
  setItem: () => {}
};

const coldShipments = [
  {
    id: 'shipment-dc-ilo',
    status: 'received_confirmed',
    site_id: 'site-ilo',
    site_code: 'ASP ILO',
    items: [
      {
        serial_number: coldSerial,
        part_number: '661-21988',
        description: 'Display, iPhone 13'
      }
    ]
  }
];

const coldReconciled = reconcileUnitsWithPackedDrafts([], coldShipments);
const coldTarget = coldReconciled.find(u => u.serial_number === coldSerial);

assert(coldTarget, 'Synthesized unit must exist');
assert.strictEqual(coldTarget.status, 'used', `Synthesized unit status must be "used", got "${coldTarget.status}"`);
assert.strictEqual(coldTarget.work_order_number, '20031234', 'Work order number must be synthesized from registry');
assert.strictEqual(coldTarget.dateUsed, '2026-10-07', 'Date used must be preserved');
console.log('✓ PASS: Cold startup reload preserves used status even when synthesized from shipments');

// 5. Verify RequestParts.jsx passes partNumber and siteId to markUnitAsUsed
const rpPath = path.resolve(__dirname, '../components/RequestParts.jsx');
const rpSrc = fs.readFileSync(rpPath, 'utf8');

assert(rpSrc.includes('partNumber: markUsedPartPn'), 'RequestParts must pass partNumber to markUnitAsUsed');
assert(rpSrc.includes('siteId'), 'RequestParts must pass siteId to markUnitAsUsed');
console.log('✓ PASS: RequestParts passes partNumber and siteId to markUnitAsUsed');

console.log('All persistence & refresh regression checks passed!');
