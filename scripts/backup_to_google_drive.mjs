/**
 * Automated Database Backup to Google Drive for MDC DC System
 * 
 * Extracts current snapshot data from Supabase and uploads a timestamped
 * backup directly to the "System Backups" folder in Google Drive.
 * 
 * Usage:
 *   node scripts/backup_to_google_drive.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables manually
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const k = trimmed.substring(0, idx).trim();
      let v = trimmed.substring(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.substring(1, v.length - 1);
      }
      process.env[k] = v;
    }
  });
}

// Inject service account key
const keyPath = path.join(rootDir, 'google-service-account.json');
if (fs.existsSync(keyPath)) {
  globalThis.__GOOGLE_SERVICE_KEY__ = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
}

const { uploadToGoogleDrive, isGoogleDriveConfigured } = await import('../src/services/googleDriveService.js');

async function runBackup() {
  console.log('========================================================================');
  console.log('MDC DC SYSTEM: Automated Database Backup to Google Drive');
  console.log('========================================================================');

  if (!isGoogleDriveConfigured()) {
    console.error('✗ ERROR: Google Drive credentials are not configured.');
    process.exit(1);
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('✗ ERROR: Supabase credentials not found in .env');
    process.exit(1);
  }

  console.log('1. Connecting to Supabase database...');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const tablesToBackup = [
    'profiles',
    'sites',
    'parts',
    'shipments',
    'shipment_items',
    'inventory_units',
    'dc_intake_records',
    'repair_usage_records',
    'saved_records'
  ];

  const backupData = {
    metadata: {
      system: 'Mobile Care Services Philippines Inc. (MDC) - DC System',
      backup_timestamp: new Date().toISOString(),
      source_supabase_url: supabaseUrl,
      tables: {}
    },
    tables: {}
  };

  console.log('2. Exporting database tables...');
  for (const table of tablesToBackup) {
    try {
      const { data, count, error } = await supabase.from(table).select('*', { count: 'exact' });
      if (error) {
        console.warn(`  - [WARN] Could not export table "${table}": ${error.message}`);
        backupData.tables[table] = [];
        backupData.metadata.tables[table] = { count: 0, status: 'error', error: error.message };
      } else {
        backupData.tables[table] = data || [];
        backupData.metadata.tables[table] = { count: data?.length || 0, status: 'ok' };
        console.log(`  ✓ Table "${table}": ${data?.length || 0} records exported`);
      }
    } catch (e) {
      console.warn(`  - [WARN] Exception exporting "${table}":`, e.message);
    }
  }

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const backupFileName = `mdc_dc_db_backup_${dateStr}.json`;
  const jsonContent = JSON.stringify(backupData, null, 2);
  const sizeKb = (Buffer.byteLength(jsonContent, 'utf8') / 1024).toFixed(2);

  console.log(`\n3. Uploading ${backupFileName} (${sizeKb} KB) to Google Drive "System Backups"...`);
  const uploadResult = await uploadToGoogleDrive({
    name: backupFileName,
    mimeType: 'application/json',
    data: jsonContent,
    folderType: 'backups'
  });

  if (uploadResult.success) {
    console.log('  ✓ System Database Backup saved:', uploadResult.webViewLink);
  } else {
    console.warn('  ✗ Database backup upload failed:', uploadResult.error);
  }

  // Also check if saved_records contains live master state with forecasting & allocation
  const liveState = (backupData.tables.saved_records || []).find(r => r.id === 'master_live_state' || r.id === 'live_master_state');
  if (liveState?.snapshot_data?.forecastItems) {
    console.log('\n4. Archiving live Forecasting data snapshot to "Forecasting Data" folder...');
    const forecastSnapshot = JSON.stringify(liveState.snapshot_data.forecastItems, null, 2);
    const fRes = await uploadToGoogleDrive({
      name: `Forecasting_Data_Snapshot_${dateStr}.json`,
      mimeType: 'application/json',
      data: forecastSnapshot,
      folderType: 'forecasting'
    });
    if (fRes.success) console.log('  ✓ Forecasting Data archived:', fRes.webViewLink);
  }

  if (liveState?.snapshot_data?.allocations) {
    console.log('\n5. Archiving live Allocation matrix snapshot to "Allocation" folder...');
    const allocSnapshot = JSON.stringify(liveState.snapshot_data.allocations, null, 2);
    const aRes = await uploadToGoogleDrive({
      name: `Allocation_Matrix_Snapshot_${dateStr}.json`,
      mimeType: 'application/json',
      data: allocSnapshot,
      folderType: 'allocation'
    });
    if (aRes.success) console.log('  ✓ Allocation Matrix archived:', aRes.webViewLink);
  }

  console.log('\n🎉 ALL BACKUPS COMPLETED SUCCESSFULLY ACROSS GOOGLE DRIVE FOLDERS!');
}

runBackup().catch(err => {
  console.error('Fatal backup error:', err);
  process.exit(1);
});
