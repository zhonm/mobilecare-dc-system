import assert from 'assert';
import { exportForecastingReportToPDF } from '../utils/pdfGenerator.js';

console.log('====================================================');
console.log('TEST SUITE: Forecasting Reports PDF Generation & Download');
console.log('====================================================');

async function runTests() {
  const sampleForecastItems = [
    {
      part_number: '661-21991',
      description: 'iPhone 13 Battery Replacement Kit',
      part_name: 'iPhone 13 Battery Replacement Kit',
      commodity: 'BATTERY',
      iphone_model: 'iPhone 13',
      stocking_price: 89,
      computed_forecast: 234,
      final_forecast: 234,
      ytd_monthly_counts: [180, 195, 210, 220, 205, 230, 240, 234]
    },
    {
      part_number: '661-59853',
      description: 'iPhone 17 Pro Max Display Assembly',
      part_name: 'iPhone 17 Pro Max Display Assembly',
      commodity: 'DISPLAY',
      iphone_model: 'iPhone 17 Pro Max',
      stocking_price: 379,
      computed_forecast: 45,
      final_forecast: 45,
      ytd_monthly_counts: [0, 0, 0, 0, 10, 25, 38, 45]
    },
    {
      part_number: '661-33597',
      description: 'iPhone 14 Pro Max Battery Kit',
      part_name: 'iPhone 14 Pro Max Battery Kit',
      commodity: 'BATTERY',
      iphone_model: 'iPhone 14 Pro Max',
      stocking_price: 99,
      computed_forecast: 35,
      final_forecast: 35,
      ytd_monthly_counts: [25, 28, 30, 32, 34, 33, 36, 35]
    },
    {
      part_number: '661-22294',
      description: 'iPhone 13 Pro Max Battery Kit',
      part_name: 'iPhone 13 Pro Max Battery Kit',
      commodity: 'BATTERY',
      iphone_model: 'iPhone 13 Pro Max',
      stocking_price: 89,
      computed_forecast: 31,
      final_forecast: 31,
      ytd_monthly_counts: [28, 29, 31, 30, 32, 30, 33, 31]
    },
    {
      part_number: '661-12345',
      description: 'iPhone 15 Pro TrueDepth Camera Module',
      part_name: 'iPhone 15 Pro TrueDepth Camera Module',
      commodity: 'CAMERA_TRUE_DEPTH',
      iphone_model: 'iPhone 15 Pro',
      stocking_price: 129,
      computed_forecast: 20,
      final_forecast: 20,
      ytd_monthly_counts: [12, 14, 15, 16, 18, 19, 21, 20]
    }
  ];

  const metadata = {
    periodLabel: 'September 2026',
    pastMonthLabel: 'August 2026',
    sites: [
      { code: 'VN', name: 'Vertis North', region: 'Metro Manila' },
      { code: 'FES', name: 'Festival Mall', region: 'Metro Manila' },
      { code: 'CEB', name: 'Cebu Ayala', region: 'Provincial' }
    ],
    analytics: {
      siteAllocationsList: [
        { name: 'Vertis North', isMM: true, totalUnits: 150 },
        { name: 'Festival Mall', isMM: true, totalUnits: 100 },
        { name: 'Cebu Ayala', isMM: false, totalUnits: 115 }
      ]
    },
    rawRecords: [
      {
        transfer_received_date: '2026-09-02',
        from_stock: 'DC Central Warehouse',
        to_stock: 'Vertis North',
        product_code: '661-21991',
        product_name: 'iPhone 13 Battery Replacement Kit',
        transfer_quantity: 50,
        unit_price: 89
      }
    ]
  };

  // 1. Test standard generation without exceptions
  console.log('1. Testing exportForecastingReportToPDF generation...');
  const res = exportForecastingReportToPDF(sampleForecastItems, metadata);
  assert.ok(res, 'Should return result object');
  assert.ok(res.doc, 'jsPDF document instance should be returned');
  assert.strictEqual(res.filename, 'Parts_Usage_and_Forecasting_Report_September_2026.pdf');
  
  const pageCount = res.doc.internal.getNumberOfPages();
  console.log(`  ✓ Generated PDF with ${pageCount} pages`);
  assert.ok(pageCount >= 2, 'Should generate at least 2 pages (Page 1 Executive + Section pages)');

  // 2. Test empty items safeguard
  console.log('2. Testing empty items fallback...');
  const emptyRes = exportForecastingReportToPDF([], { periodLabel: 'October 2026' });
  assert.ok(emptyRes.doc, 'Empty items should still render Page 1 executive briefing safely');
  assert.strictEqual(emptyRes.filename, 'Parts_Usage_and_Forecasting_Report_October_2026.pdf');
  console.log('  ✓ Empty items safely handled without crash');

  console.log('====================================================');
  console.log('ALL FORECASTING PDF DOWNLOAD TESTS PASSED (100%)');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
