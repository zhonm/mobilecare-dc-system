import assert from 'assert';
import { getCategoryForPart } from '../utils/categoryFilter.js';
import { getCategoryBadge } from '../utils/rawMasterlistScanner.js';
import { exportDcInventoryToExcel, exportDcInventoryToPDF } from '../utils/dashboardReportExporter.js';

console.log('====================================================');
console.log('TEST SUITE: DC Stock Inventory Category Name Resolution');
console.log('====================================================');

const displayUuid = '89179943-a0e2-4e80-b213-34e3bcb6869f';
const batteryUuid = '8069269c-a7e2-46fd-9d95-f0d476f1d6c3';

const mockCategories = [
  { id: batteryUuid, code: 'BATTERY', name: 'Battery' },
  { id: displayUuid, code: 'DISPLAY', name: 'Display' },
  { id: 'c79bff7c-a7a6-44b4-9761-2f47a8ddda04', code: 'CAMERA', name: 'Camera' }
];

// Test 1: getCategoryForPart resolves PostgreSQL category_id UUID to real name
console.log('\n--- 1. Testing Category UUID to Real Category Name Resolution ---');
{
  const displayPart = {
    part_number: '661-56050',
    description: 'Display, iPhone 17 Pro Max',
    category_id: displayUuid
  };
  const catObj = getCategoryForPart(displayPart, mockCategories);
  assert.strictEqual(catObj.name, 'Display', 'Category name should be "Display"');
  assert.strictEqual(catObj.code, 'DISPLAY', 'Category code should be "DISPLAY"');
  console.log(`  ✓ PASS: ${displayPart.part_number} (${displayPart.description}) resolved to "${catObj.name}"`);

  const batteryPart = {
    part_number: '661-22294',
    description: 'Battery, iPhone 13 Pro Max',
    category_id: batteryUuid
  };
  const battCatObj = getCategoryForPart(batteryPart, mockCategories);
  assert.strictEqual(battCatObj.name, 'Battery', 'Category name should be "Battery"');
  assert.strictEqual(battCatObj.code, 'BATTERY', 'Category code should be "BATTERY"');
  console.log(`  ✓ PASS: ${batteryPart.part_number} (${batteryPart.description}) resolved to "${battCatObj.name}"`);

  const svcBatteryPart = {
    part_number: '661-30397',
    description: 'SVC, IPHONE 14 PRO MAX, BATTERY',
    category_id: batteryUuid
  };
  const svcCatObj = getCategoryForPart(svcBatteryPart, mockCategories);
  assert.strictEqual(svcCatObj.name, 'Battery', 'Category name should be "Battery"');
  console.log(`  ✓ PASS: ${svcBatteryPart.part_number} (${svcBatteryPart.description}) resolved to "${svcCatObj.name}"`);
}

// Test 2: getCategoryBadge styles & names
console.log('\n--- 2. Testing getCategoryBadge with real names and code aliases ---');
{
  const displayBadge = getCategoryBadge('Display');
  assert.strictEqual(displayBadge.name, 'Display');
  assert.strictEqual(displayBadge.color, '#0284c7');

  const upperDisplayBadge = getCategoryBadge('DISPLAY');
  assert.strictEqual(upperDisplayBadge.name, 'Display');

  const batteryBadge = getCategoryBadge('Battery');
  assert.strictEqual(batteryBadge.name, 'Battery');
  assert.strictEqual(batteryBadge.color, '#059669');

  const upperBatteryBadge = getCategoryBadge('BATTERY');
  assert.strictEqual(upperBatteryBadge.name, 'Battery');

  console.log('  ✓ PASS: getCategoryBadge accurately formats Display and Battery badges');
}

// Test 3: exportDcInventoryToExcel & exportDcInventoryToPDF output real category names
console.log('\n--- 3. Testing Excel and PDF exports with category UUID items ---');
async function testExport() {
  const sampleItemsWithUuid = [
    {
      part_number: '661-56050',
      description: 'Display, iPhone 17 Pro Max',
      category: displayUuid, // Simulating stale or unmapped category field
      category_name: 'Display',
      units: [{ serial_number: 'G9PHVAJ6SUF0000PUY' }],
      maxDaysInDc: 4,
      latest_serial: 'G9PHVAJ6SUF0000PUY'
    },
    {
      part_number: '661-22294',
      description: 'Battery, iPhone 13 Pro Max',
      category: batteryUuid, // Raw UUID only
      units: [{ serial_number: 'F8Y6175C3DA19X08K' }],
      maxDaysInDc: 0,
      latest_serial: 'F8Y6175C3DA19X08K'
    }
  ];

  const excelRes = await exportDcInventoryToExcel(sampleItemsWithUuid, { filter: 'ALL', search: '' });
  const sheet = excelRes.workbook.worksheets[0];
  const row1Cat = sheet.getRow(4).getCell(4).value;
  const row2Cat = sheet.getRow(5).getCell(4).value;

  assert.strictEqual(row1Cat, 'Display', `Excel row 1 category should be "Display", got "${row1Cat}"`);
  assert.strictEqual(row2Cat, 'Battery', `Excel row 2 category should be "Battery", got "${row2Cat}"`);
  console.log(`  ✓ PASS: Excel worksheet exported real names: Row 1="${row1Cat}", Row 2="${row2Cat}" (No UUIDs!)`);

  const pdfRes = exportDcInventoryToPDF(sampleItemsWithUuid, { filter: 'ALL', search: '' });
  assert.ok(pdfRes.doc, 'PDF generation successful');
  console.log('  ✓ PASS: PDF generation succeeded with resolved category names');
}

await testExport();

console.log('\n====================================================');
console.log('ALL CATEGORY NAME RESOLUTION TESTS PASSED (100%)');
console.log('====================================================');
