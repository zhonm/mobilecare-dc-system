/**
 * Google Drive Service Account Credentials Template
 *
 * Instructions:
 * For production, provide environment variables:
 * - VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL
 * - VITE_GOOGLE_SERVICE_ACCOUNT_KEY
 * - VITE_GOOGLE_DRIVE_SHARED_DRIVE_ID
 *
 * For local development, copy this file to googleDriveCredentials.js (which is git-ignored):
 * cp src/config/googleDriveCredentials.template.js src/config/googleDriveCredentials.js
 * and paste your service account JSON keys.
 */

export const GOOGLE_SERVICE_ACCOUNT_KEY = {
  "type": "service_account",
  "project_id": "YOUR_PROJECT_ID",
  "private_key_id": "YOUR_PRIVATE_KEY_ID",
  "private_key": "-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n",
  "client_email": "YOUR_SERVICE_ACCOUNT_EMAIL@project.iam.gserviceaccount.com",
  "client_id": "YOUR_CLIENT_ID"
};
