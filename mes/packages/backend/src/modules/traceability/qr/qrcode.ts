/**
 * Bağımlılıksız QR Code üreteci (ISO/IEC 18004).
 * Byte mode, ECC seviyesi M. SVG path string üretir.
 * Air-gapped ortam için native bağımlılık YOK.
 *
 * Desteklenen sürümler: 1–10 (kısa-orta metinler için yeterli;
 * 'SH-YYYYMMDD-NNNN' ~15 karakter → sürüm 1-2 yeterlidir).
 */

// ─── Galois Field (256) aritmetiği ──────────────────────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// ─── Reed-Solomon ───────────────────────────────────────────────────────────
function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], GF_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, eccDegree: number): Uint8Array {
  const gen = rsGeneratorPoly(eccDegree);
  const res = new Uint8Array(eccDegree);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.copyWithin(0, 1);
    res[eccDegree - 1] = 0;
    for (let j = 0; j < eccDegree; j++) {
      res[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return res;
}

// ─── Sürüm/ECC tabloları (ECC level M) ─────────────────────────────────────
// [eccCodewordsPerBlock, group1Blocks, group1DataCw, group2Blocks, group2DataCw]
const ECC_M: Record<number, [number, number, number, number, number]> = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

// Byte mode karakter kapasitesi (ECC M)
const CAPACITY_M: Record<number, number> = {
  1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213,
};

const ALIGN_POS: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// ─── Bit buffer ─────────────────────────────────────────────────────────────
class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
    }
    return bytes;
  }
  get length(): number {
    return this.bits.length;
  }
}

// ─── Ana üretim ─────────────────────────────────────────────────────────────

/** Metni QR modül matrisine çevirir (true = koyu modül). */
export function generateQrMatrix(text: string): boolean[][] {
  const data = new TextEncoder().encode(text);

  // Uygun sürümü bul
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (data.length <= CAPACITY_M[v]) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new Error('QR içeriği çok uzun (maks 213 byte, ECC M)');

  const size = 17 + version * 4;
  const [eccCw, g1Blocks, g1DataCw, g2Blocks, g2DataCw] = ECC_M[version];
  const totalDataCw = g1Blocks * g1DataCw + g2Blocks * g2DataCw;

  // ─── Veri kodlaması (byte mode) ───
  const buf = new BitBuffer();
  buf.push(0b0100, 4); // byte mode
  buf.push(data.length, version <= 9 ? 8 : 16);
  for (const b of data) buf.push(b, 8);
  // Terminator
  const capacityBits = totalDataCw * 8;
  buf.push(0, Math.min(4, capacityBits - buf.length));
  // Byte hizalama
  while (buf.length % 8 !== 0) buf.push(0, 1);
  // Pad
  const pads = [0xec, 0x11];
  let padIdx = 0;
  while (buf.length < capacityBits) buf.push(pads[padIdx++ % 2], 8);
  const dataCodewords = buf.toBytes();

  // ─── Bloklara ayır + ECC ───
  const blocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks; i++) {
    const d = dataCodewords.slice(offset, offset + g1DataCw);
    blocks.push(d);
    eccBlocks.push(rsEncode(d, eccCw));
    offset += g1DataCw;
  }
  for (let i = 0; i < g2Blocks; i++) {
    const d = dataCodewords.slice(offset, offset + g2DataCw);
    blocks.push(d);
    eccBlocks.push(rsEncode(d, eccCw));
    offset += g2DataCw;
  }

  // ─── Interleave ───
  const result: number[] = [];
  const maxDataLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocks) if (i < b.length) result.push(b[i]);
  }
  for (let i = 0; i < eccCw; i++) {
    for (const e of eccBlocks) result.push(e[i]);
  }

  // ─── Matris kur ───
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array(size).fill(null)
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array(size).fill(false)
  );

  const setFinder = (r: number, c: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const isDark =
          inOuter &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        matrix[rr][cc] = isDark;
        reserved[rr][cc] = true;
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  // Timing
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  // Alignment
  const aligns = ALIGN_POS[version];
  for (const r of aligns) {
    for (const c of aligns) {
      if (reserved[r]?.[c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          matrix[r + dr][c + dc] = dark;
          reserved[r + dr][c + dc] = true;
        }
      }
    }
  }

  // Dark module
  matrix[size - 8][8] = true;
  reserved[size - 8][8] = true;

  // Format info (placeholder, sonra doldurulur)
  for (let i = 0; i < 8; i++) {
    reserved[8][i] = true;
    reserved[8][size - 1 - i] = true;
    reserved[i][8] = true;
    reserved[size - 1 - i][8] = true;
  }
  reserved[8][7] = true;
  reserved[8][8] = true;
  reserved[7][8] = true;

  // ─── Veriyi yerleştir (zig-zag) ───
  const bits: number[] = [];
  for (const byte of result) {
    for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);
  }

  // Maske 0 (r+c)%2==0 — format info ECC M + maske 0
  const maskPattern = (r: number, c: number) => (r + c) % 2 === 0;

  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        let bit = bitIdx < bits.length ? bits[bitIdx++] === 1 : false;
        if (maskPattern(row, c)) bit = !bit;
        matrix[row][c] = bit;
      }
    }
    upward = !upward;
  }

  // ─── Format info (ECC M = 00, maske 0 = 000 → 101010000010010) ───
  const FORMAT_M0 = 0b101010000010010;
  const fmtBits: boolean[] = [];
  for (let i = 14; i >= 0; i--) fmtBits.push(((FORMAT_M0 >>> i) & 1) === 1);

  const fmtPos1: [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const fmtPos2: [number, number][] = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
    [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
    [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  fmtPos1.forEach(([r, c], i) => (matrix[r][c] = fmtBits[i]));
  fmtPos2.forEach(([r, c], i) => (matrix[r][c] = fmtBits[i]));

  return matrix.map((row) => row.map((cell) => cell === true));
}

/** QR matrisinden SVG path data üretir (koyu modüller). */
export function qrToSvgPath(text: string): { path: string; size: number } {
  const matrix = generateQrMatrix(text);
  const size = matrix.length;
  const parts: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }
  return { path: parts.join(''), size };
}
