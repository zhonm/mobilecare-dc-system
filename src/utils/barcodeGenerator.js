/**
 * Zero-dependency, standards-compliant 1D Barcode (ISO/IEC 15417 Code 128B)
 * and 2D QR Code (ISO/IEC 18004, Byte Mode, ECC Level M) SVG encoders.
 *
 * Designed for physical peel-and-stick asset labels scanned by USB/Bluetooth
 * handheld barcode scanners, iPhone/Android cameras, and online readers.
 */

// ============================================================================
// 1. ISO/IEC 15417 — CODE 128 (SUBSET B) ENCODER
// ============================================================================

// Standard 107 Code 128 symbol patterns (each string lists alternating bar/space module widths)
// Index 0..94 = ASCII 32..126 in Subset B; 104 = Start Code B; 106 = Stop (13 modules)
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

const START_CODE_B = 104;
const STOP_CODE = 106;

/**
 * Encodes printable ASCII text into an ISO/IEC 15417 Code 128B bar layout.
 * Includes mandatory 10-module white quiet zones on both left and right ends.
 */
export function encodeCode128B(rawText = '') {
  // Sanitize to printable ASCII 32..126
  const clean = String(rawText || 'MDC-TOOL')
    .replace(/[^\x20-\x7E]/g, '')
    .trim() || 'MDC-TOOL';

  const codes = [START_CODE_B];
  let checksum = START_CODE_B;

  for (let i = 0; i < clean.length; i += 1) {
    const val = clean.charCodeAt(i) - 32;
    codes.push(val);
    checksum += val * (i + 1);
  }

  codes.push(checksum % 103);
  codes.push(STOP_CODE);

  const quietZone = 10; // ISO minimum 10 modules on each side
  const bars = [];
  let x = quietZone;

  for (let i = 0; i < codes.length; i += 1) {
    const pattern = CODE128_PATTERNS[codes[i]];
    for (let j = 0; j < pattern.length; j += 1) {
      const w = Number(pattern[j]);
      if (j % 2 === 0) {
        // Even index = dark bar
        bars.push({ x, w });
      }
      x += w;
    }
  }

  const totalWidth = x + quietZone;
  return {
    text: clean,
    codes,
    bars,
    quietZone,
    totalWidth
  };
}

/**
 * Generates a standalone SVG string for a scannable Code 128B barcode.
 */
export function buildCode128SvgString(rawText, options = {}) {
  const height = options.height || 32;
  const encoded = encodeCode128B(rawText);
  const rects = encoded.bars
    .map((b) => `<rect x="${b.x}" y="0" width="${b.w}" height="${height}" fill="#000000" />`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}" viewBox="0 0 ${encoded.totalWidth} ${height}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" role="img" aria-label="Barcode ${encoded.text}" style="display:block;background:#ffffff;"><rect x="0" y="0" width="${encoded.totalWidth}" height="${height}" fill="#ffffff" />${rects}</svg>`;
}

// ============================================================================
// 2. ISO/IEC 18004 — QR CODE ENCODER (BYTE MODE, ECC LEVEL M, VERSIONS 1–10)
// ============================================================================

// GF(256) log/antilog tables with primitive polynomial 0x11d
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
  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcBytes(dataBytes, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const msg = new Uint8Array(dataBytes.length + ecCount);
  msg.set(dataBytes, 0);

  for (let i = 0; i < dataBytes.length; i += 1) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 1; j < gen.length; j += 1) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return Array.from(msg.slice(dataBytes.length));
}

// ISO/IEC 18004 Table 9 — ECC Level M parameters for Versions 1..10
// Format: { version, totalDataBytes, ecPerBlock, blocks: [[count, dataBytesPerBlock], ...], alignment: [...] }
const QR_VERSION_TABLE_M = [
  null,
  { version: 1, totalDataBytes: 16, ecPerBlock: 10, blocks: [[1, 16]], alignment: [] },
  { version: 2, totalDataBytes: 28, ecPerBlock: 16, blocks: [[1, 28]], alignment: [6, 18] },
  { version: 3, totalDataBytes: 44, ecPerBlock: 26, blocks: [[1, 44]], alignment: [6, 22] },
  { version: 4, totalDataBytes: 64, ecPerBlock: 18, blocks: [[2, 32]], alignment: [6, 26] },
  { version: 5, totalDataBytes: 86, ecPerBlock: 24, blocks: [[2, 43]], alignment: [6, 30] },
  { version: 6, totalDataBytes: 108, ecPerBlock: 16, blocks: [[4, 27]], alignment: [6, 34] },
  { version: 7, totalDataBytes: 124, ecPerBlock: 18, blocks: [[4, 31]], alignment: [6, 22, 38] },
  { version: 8, totalDataBytes: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]], alignment: [6, 24, 42] },
  { version: 9, totalDataBytes: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]], alignment: [6, 26, 46] },
  { version: 10, totalDataBytes: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]], alignment: [6, 28, 50] }
];

// BCH(15,5) format info with XOR mask 0x5412 for ECC Level M (indicator bits = 00) and mask 0..7
function computeFormatBitsM(maskPattern) {
  const data = (0b00 << 3) | (maskPattern & 7);
  let rem = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (rem & (1 << (i + 10))) {
      rem ^= 0x537 << i;
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

// BCH(18,6) version info for Versions 7..10
function computeVersionBits(version) {
  let rem = version << 12;
  for (let i = 5; i >= 0; i -= 1) {
    if (rem & (1 << (i + 12))) {
      rem ^= 0x1f25 << i;
    }
  }
  return (version << 12) | rem;
}

function encodeUtf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') {
    return Array.from(new TextEncoder().encode(str));
  }
  const bytes = [];
  for (let i = 0; i < str.length; i += 1) {
    bytes.push(str.charCodeAt(i) & 0xff);
  }
  return bytes;
}

function buildDataCodewords(payloadBytes, versionSpec) {
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i -= 1) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode indicator (0100)
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for V1..V9, 16 bits for V10+)
  pushBits(payloadBytes.length, versionSpec.version <= 9 ? 8 : 16);
  // Payload bytes
  for (let i = 0; i < payloadBytes.length; i += 1) {
    pushBits(payloadBytes[i], 8);
  }

  const totalDataBits = versionSpec.totalDataBytes * 8;
  // Terminator (up to 4 zero bits)
  const termLen = Math.min(4, totalDataBits - bits.length);
  pushBits(0, termLen);
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Convert bits to bytes
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) {
      b = (b << 1) | bits[i + j];
    }
    codewords.push(b);
  }

  // Pad codewords alternating 0xEC and 0x11
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (codewords.length < versionSpec.totalDataBytes) {
    codewords.push(padBytes[padIdx % 2]);
    padIdx += 1;
  }

  return codewords;
}

function interleaveBlocks(dataCodewords, versionSpec) {
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;

  for (const [blockCount, dataLen] of versionSpec.blocks) {
    for (let b = 0; b < blockCount; b += 1) {
      const slice = dataCodewords.slice(offset, offset + dataLen);
      offset += dataLen;
      dataBlocks.push(slice);
      ecBlocks.push(rsComputeEcBytes(slice, versionSpec.ecPerBlock));
    }
  }

  const finalBytes = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i += 1) {
    for (let b = 0; b < dataBlocks.length; b += 1) {
      if (i < dataBlocks[b].length) finalBytes.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < versionSpec.ecPerBlock; i += 1) {
    for (let b = 0; b < ecBlocks.length; b += 1) {
      finalBytes.push(ecBlocks[b][i]);
    }
  }

  const finalBits = [];
  for (let i = 0; i < finalBytes.length; i += 1) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      finalBits.push((finalBytes[i] >>> bit) & 1);
    }
  }
  return { finalBytes, finalBits, dataBlocks, ecBlocks };
}

function placeFunctionPatterns(size, versionSpec) {
  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunc = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFunc = (r, c, dark) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = dark;
      isFunc[r][c] = true;
    }
  };

  // Finder patterns + 1-module white separators
  const drawFinder = (top, left) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onOuterBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFunc(top + r, left + c, inOuter && (onOuterBorder || inCenter));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns (V2+)
  const coords = versionSpec.alignment;
  for (let i = 0; i < coords.length; i += 1) {
    for (let j = 0; j < coords.length; j += 1) {
      const cr = coords[i];
      const cc = coords[j];
      // Skip if overlapping any finder pattern
      if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 9) || (cr >= size - 9 && cc <= 8)) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunc(cr + dr, cc + dc, dark);
        }
      }
    }
  }

  // Reserve format info areas
  for (let i = 0; i <= 8; i += 1) {
    if (!isFunc[8][i]) setFunc(8, i, false);
    if (!isFunc[i][8]) setFunc(i, 8, false);
  }
  for (let i = size - 8; i < size; i += 1) {
    if (!isFunc[8][i]) setFunc(8, i, false);
    if (!isFunc[i][8]) setFunc(i, 8, false);
  }

  // Dark module
  setFunc(size - 8, 8, true);

  // Version info areas for V7..V10
  if (versionSpec.version >= 7) {
    const vBits = computeVersionBits(versionSpec.version);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  return { grid, isFunc };
}

function drawFormatBits(grid, size, formatBits) {
  // Primary copy around top-left finder
  const coords1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  for (let i = 0; i < 15; i += 1) {
    const bit = ((formatBits >>> (14 - i)) & 1) === 1;
    grid[coords1[i][0]][coords1[i][1]] = bit;
  }

  // Secondary copy split between bottom-left and top-right
  for (let i = 0; i < 7; i += 1) {
    const bit = ((formatBits >>> (14 - i)) & 1) === 1;
    grid[size - 1 - i][8] = bit;
  }
  for (let i = 7; i < 15; i += 1) {
    const bit = ((formatBits >>> (14 - i)) & 1) === 1;
    grid[8][size - 15 + i] = bit;
  }
}

function maskBit(maskPattern, r, c) {
  switch (maskPattern) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function computePenalty(grid, size) {
  let penalty = 0;

  // Rule 1: 5+ consecutive same-color modules in rows/cols
  for (let r = 0; r < size; r += 1) {
    let runLen = 1;
    for (let c = 1; c < size; c += 1) {
      if (grid[r][c] === grid[r][c - 1]) {
        runLen += 1;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c += 1) {
    let runLen = 1;
    for (let r = 1; r < size; r += 1) {
      if (grid[r][c] === grid[r - 1][c]) {
        runLen += 1;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  // Rule 4: balance of dark vs light modules
  let darkCount = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (grid[r][c]) darkCount += 1;
    }
  }
  const pct = (darkCount * 100) / (size * size);
  const dev = Math.floor(Math.abs(pct - 50) / 5);
  penalty += dev * 10;

  return penalty;
}

/**
 * Encodes text into a real, ISO/IEC 18004 compliant QR Code matrix (ECC Level M).
 */
export function encodeQrCode(rawText = '') {
  const text = String(rawText || 'MDC-TOOL');
  const payloadBytes = encodeUtf8Bytes(text);

  // Select smallest version (1..10) that fits Byte mode header + payload
  let versionSpec = null;
  for (let v = 1; v < QR_VERSION_TABLE_M.length; v += 1) {
    const spec = QR_VERSION_TABLE_M[v];
    const headerBytes = v <= 9 ? 2 : 3; // 4-bit mode + 8/16-bit len + 4-bit terminator
    if (payloadBytes.length + headerBytes <= spec.totalDataBytes) {
      versionSpec = spec;
      break;
    }
  }
  if (!versionSpec) {
    // Truncate gracefully to V10-M max capacity if unusually long
    versionSpec = QR_VERSION_TABLE_M[10];
  }

  const maxPayload = versionSpec.totalDataBytes - (versionSpec.version <= 9 ? 2 : 3);
  const safePayload = payloadBytes.slice(0, maxPayload);
  const dataCodewords = buildDataCodewords(safePayload, versionSpec);
  const { finalBits, dataBlocks, ecBlocks } = interleaveBlocks(dataCodewords, versionSpec);

  const size = 17 + 4 * versionSpec.version;
  const { grid: baseGrid, isFunc } = placeFunctionPatterns(size, versionSpec);

  // Place data bits in zigzag order
  let bitIdx = 0;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5; // Skip vertical timing column
    for (let step = 0; step < size; step += 1) {
      const r = upward ? (size - 1 - step) : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const c = rightCol - offset;
        if (!isFunc[r][c]) {
          baseGrid[r][c] = bitIdx < finalBits.length ? finalBits[bitIdx] === 1 : false;
          bitIdx += 1;
        }
      }
    }
    upward = !upward;
  }

  // Evaluate all 8 masks and pick the lowest penalty
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestGrid = null;

  for (let m = 0; m < 8; m += 1) {
    const candidate = baseGrid.map((row) => row.slice());
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!isFunc[r][c] && maskBit(m, r, c)) {
          candidate[r][c] = !candidate[r][c];
        }
      }
    }
    drawFormatBits(candidate, size, computeFormatBitsM(m));
    const p = computePenalty(candidate, size);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestMask = m;
      bestGrid = candidate;
    }
  }

  return {
    text,
    version: versionSpec.version,
    size,
    quietZone: 4,
    mask: bestMask,
    matrix: bestGrid,
    dataBlocks,
    ecBlocks
  };
}

/**
 * Generates a standalone SVG string for a scannable ISO/IEC 18004 QR code
 * including the mandatory 4-module white quiet zone.
 */
export function buildQrSvgString(rawText, options = {}) {
  const pixelSize = options.size || 76;
  const qr = encodeQrCode(rawText);
  const qz = qr.quietZone;
  const viewSize = qr.size + qz * 2;
  const rects = [];

  for (let r = 0; r < qr.size; r += 1) {
    for (let c = 0; c < qr.size; c += 1) {
      if (qr.matrix[r][c]) {
        rects.push(`<rect x="${c + qz}" y="${r + qz}" width="1" height="1" fill="#000000" />`);
      }
    }
  }

  const safeLabel = String(options.ariaLabel || `QR ${qr.text}`).replace(/["<>]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges" role="img" aria-label="${safeLabel}" style="display:block;flex-shrink:0;background:#ffffff;"><rect x="0" y="0" width="${viewSize}" height="${viewSize}" fill="#ffffff" />${rects.join('')}</svg>`;
}
