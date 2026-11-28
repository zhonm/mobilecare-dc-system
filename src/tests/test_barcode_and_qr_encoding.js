import assert from 'assert';
import {
  encodeCode128B,
  buildCode128SvgString,
  encodeQrCode,
  buildQrSvgString
} from '../utils/barcodeGenerator.js';

console.log('====================================================================');
console.log('TEST SUITE: Scannable ISO Code 128B Barcode & QR Code Encoders');
console.log('====================================================================\n');

// ----------------------------------------------------------------------------
// 1. Independent Code 128B Decoder Verification
// ----------------------------------------------------------------------------
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112'
];

function decodeCode128FromBars(encoded) {
  // Reconstruct 1-bit module strip from SVG bar rectangles
  const strip = new Array(encoded.totalWidth).fill(0);
  for (const b of encoded.bars) {
    for (let x = b.x; x < b.x + b.w; x += 1) {
      strip[x] = 1;
    }
  }

  // Verify left & right quiet zones (>= 10 light modules)
  const firstDark = strip.indexOf(1);
  const lastDark = strip.lastIndexOf(1);
  assert.ok(firstDark >= 10, `Left quiet zone must be >= 10 modules (got ${firstDark})`);
  assert.ok(encoded.totalWidth - 1 - lastDark >= 10, `Right quiet zone must be >= 10 modules`);

  // Convert active region into run-length widths
  const runs = [];
  let cur = strip[firstDark];
  let len = 1;
  for (let i = firstDark + 1; i <= lastDark; i += 1) {
    if (strip[i] === cur) {
      len += 1;
    } else {
      runs.push(len);
      cur = strip[i];
      len = 1;
    }
  }
  runs.push(len);

  // Stop symbol is last 7 runs ('2331112'), every preceding symbol is 6 runs
  const stopPat = runs.slice(-7).join('');
  assert.strictEqual(stopPat, '2331112', 'Must end with ISO Code 128 Stop pattern');

  const bodyRuns = runs.slice(0, -7);
  assert.strictEqual(bodyRuns.length % 6, 0, 'Body runs must be a multiple of 6');

  const decodedCodes = [];
  for (let i = 0; i < bodyRuns.length; i += 6) {
    const pat = bodyRuns.slice(i, i + 6).join('');
    const idx = CODE128_PATTERNS.indexOf(pat);
    assert.ok(idx >= 0, `Unknown Code 128 pattern "${pat}" at symbol ${i / 6}`);
    decodedCodes.push(idx);
  }

  assert.strictEqual(decodedCodes[0], 104, 'Must start with Start Code B (104)');
  const checkSymbol = decodedCodes[decodedCodes.length - 1];
  const dataSymbols = decodedCodes.slice(1, -1);

  let sum = 104;
  dataSymbols.forEach((sym, idx) => {
    sum += sym * (idx + 1);
  });
  assert.strictEqual(checkSymbol, sum % 103, 'Modulo-103 checksum must match');

  return dataSymbols.map((sym) => String.fromCharCode(sym + 32)).join('');
}

const sampleTags = [
  'MDC-TL-07701158-0001',
  'MDC-TL-07701167-0002',
  'APPLE-07701158-02-GBXF',
  'F8Y5443C2SC20J9B5'
];

for (const tag of sampleTags) {
  const encoded = encodeCode128B(tag);
  const decoded = decodeCode128FromBars(encoded);
  assert.strictEqual(decoded, tag, `Code 128B round-trip failed for ${tag}`);
  const svg = buildCode128SvgString(tag);
  assert.ok(svg.includes('<svg') && svg.includes('fill="#000000"'), 'Code 128B SVG must render crisp black bars');
}
console.log(`  ✓ PASS: ISO Code 128B round-trip decode verified for ${sampleTags.length} real asset/serial tags (Start B + Checksum + Stop + 10-module Quiet Zones)`);

// ----------------------------------------------------------------------------
// 2. ISO/IEC 18004 QR Code Structural & Reed-Solomon Verification
// ----------------------------------------------------------------------------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function verifyRsSyndromeZero(dataBlock, ecBlock) {
  const codeword = [...dataBlock, ...ecBlock];
  for (let i = 0; i < ecBlock.length; i += 1) {
    // Evaluate polynomial at alpha^i
    let val = 0;
    const root = GF_EXP[i];
    for (let j = 0; j < codeword.length; j += 1) {
      val = gfMul(val, root) ^ codeword[j];
    }
    assert.strictEqual(val, 0, `Reed-Solomon syndrome at root alpha^${i} must be 0 (got ${val})`);
  }
}

function verifyFinderAt(matrix, top, left) {
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const expected = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      assert.strictEqual(matrix[top + r][left + c], expected, `Finder mismatch at (${top + r},${left + c})`);
    }
  }
}

for (const tag of sampleTags) {
  const qr = encodeQrCode(tag);
  const expectedSize = 17 + 4 * qr.version;
  assert.strictEqual(qr.size, expectedSize, `QR size must equal 17 + 4*version (${expectedSize})`);
  assert.strictEqual(qr.quietZone, 4, 'QR quiet zone must be 4 modules');

  // Verify all 3 finder patterns
  verifyFinderAt(qr.matrix, 0, 0);
  verifyFinderAt(qr.matrix, 0, qr.size - 7);
  verifyFinderAt(qr.matrix, qr.size - 7, 0);

  // Verify dark module at (4*version + 9, 8)
  assert.strictEqual(qr.matrix[4 * qr.version + 9][8], true, 'QR fixed dark module must be dark');

  // Verify timing patterns on row 6 and col 6
  for (let i = 8; i < qr.size - 8; i += 1) {
    assert.strictEqual(qr.matrix[6][i], i % 2 === 0, `Horizontal timing mismatch at col ${i}`);
    assert.strictEqual(qr.matrix[i][6], i % 2 === 0, `Vertical timing mismatch at row ${i}`);
  }

  // Verify Reed-Solomon ECC syndromes are all 0
  for (let b = 0; b < qr.dataBlocks.length; b += 1) {
    verifyRsSyndromeZero(qr.dataBlocks[b], qr.ecBlocks[b]);
  }

  const qrSvg = buildQrSvgString(tag);
  assert.ok(qrSvg.includes(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`), 'QR SVG viewBox must include 4-module quiet zone on each side');
}
console.log(`  ✓ PASS: ISO/IEC 18004 QR Code verified for ${sampleTags.length} asset tags (Finders + Timing + Dark Module + RS Syndromes = 0 + 4-module Quiet Zone)`);

console.log('\n====================================================================');
console.log('ALL BARCODE & QR ENCODING TESTS PASSED!');
console.log('====================================================================\n');
