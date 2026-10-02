import fs from 'fs';
import crypto from 'crypto';

const key = JSON.parse(fs.readFileSync('./google-service-account.json', 'utf8'));
const SHARED_DRIVE_ID = '0AEWZPge3zfLtUk9PVA';

function createSignedJwt(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodeBase64Url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const unsignedToken = `${encodeBase64Url(header)}.${encodeBase64Url(claimSet)}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  sign.end();
  const signature = sign.sign(privateKey, 'base64url');

  return `${unsignedToken}.${signature}`;
}

async function testConnection() {
  console.log('1. Generating signed JWT...');
  const jwt = createSignedJwt(key.client_email, key.private_key);

  console.log('2. Requesting OAuth2 access token from Google...');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    console.error('Token exchange failed:', tokenData);
    process.exit(1);
  }
  console.log('  ✓ Token obtained successfully! (Expires in ' + tokenData.expires_in + 's)');

  const accessToken = tokenData.access_token;

  console.log('3. Checking access to Shared Drive (' + SHARED_DRIVE_ID + ')...');
  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/drives/${SHARED_DRIVE_ID}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  const driveData = await driveRes.json();
  if (!driveRes.ok) {
    console.error('Failed to get Shared Drive details:', driveData);
    process.exit(1);
  }
  console.log('  ✓ Shared Drive Name:', driveData.name);

  console.log('4. Listing folders inside Shared Drive...');
  const filesRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?corpora=drive&driveId=${SHARED_DRIVE_ID}&includeItemsFromAllDrives=true&supportsAllDrives=true&q='${SHARED_DRIVE_ID}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  const filesData = await filesRes.json();
  console.log('  ✓ Folders/Files found:', filesData.files.map(f => f.name));
  console.log('\n🎉 ALL TESTS PASSED! Google Drive Service Account is fully authenticated and ready!');
}

testConnection().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
