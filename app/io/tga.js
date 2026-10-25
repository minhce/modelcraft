/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file: internal diagnostics only; a picture that cannot be read is reported by its importer. */
/**
 * tga.js — Truevision TGA pictures (common in FBX and OBJ material folders) turned into PNG, which ModelCraft keeps
 * (0.7 XF.6, session `interchange`). From the published "Truevision TGA File Format Specification" (version 2.0, 1991):
 * an 18-byte header (id length, colour-map type, image type 1/2/3 or RLE 9/10/11, colour-map spec, origin, width, height,
 * pixel depth, descriptor: alpha bits and origin corner), the id, the colour map, the pixels. PNG from the published PNG
 * specification (W3C): signature, IHDR, one IDAT (zlib, filter 0 rows), IEND, each with its CRC. DOM-free.
 *
 *   tgaToPng(bytes) → Uint8Array (PNG) | null when it is not a TGA we read
 *   decodeTga(bytes) → { width, height, rgba: Uint8Array } | null
 *   encodePng(width, height, rgba) → Uint8Array
 */
import { deflateZlib } from '../exr/zlib.js';

const MAX = 1 << 26;   // pixels

export function decodeTga(b) {
  if (!b || b.length < 18) return null;
  const idLen = b[0];
  const cmType = b[1];
  const type = b[2];
  const cmFirst = b[3] | (b[4] << 8);
  const cmLen = b[5] | (b[6] << 8);
  const cmBits = b[7];
  const w = b[12] | (b[13] << 8);
  const h = b[14] | (b[15] << 8);
  const bpp = b[16];
  const desc = b[17];
  if (![1, 2, 3, 9, 10, 11].includes(type) || !w || !h || w * h > MAX || cmType > 1) return null;
  const rle = type >= 9;
  const kind = type & 3;   // 1 colour-mapped, 2 true colour, 3 grey
  if (kind === 2 && ![15, 16, 24, 32].includes(bpp)) return null;
  if (kind === 3 && ![8, 16].includes(bpp)) return null;
  if (kind === 1 && (bpp !== 8 && bpp !== 16 || cmType !== 1)) return null;
  let p = 18 + idLen;
  let map = null;
  if (cmType === 1) {
    const eb = Math.ceil(cmBits / 8);
    if (p + cmLen * eb > b.length) return null;
    map = [];
    for (let i = 0; i < cmLen; i++) map.push(colour(b, p + i * eb, cmBits));
    p += cmLen * eb;
  }
  const pb = Math.ceil(bpp / 8);
  const n = w * h;
  const px = new Uint8Array(n * pb);
  if (!rle) {
    if (p + n * pb > b.length) return null;
    px.set(b.subarray(p, p + n * pb));
  } else {
    let o = 0;
    while (o < n * pb) {
      if (p >= b.length) return null;
      const c = b[p++];
      const count = (c & 0x7f) + 1;
      if (o + count * pb > n * pb) return null;
      if (c & 0x80) {
        if (p + pb > b.length) return null;
        for (let k = 0; k < count; k++) for (let j = 0; j < pb; j++) px[o++] = b[p + j];
        p += pb;
      } else {
        if (p + count * pb > b.length) return null;
        px.set(b.subarray(p, p + count * pb), o);
        o += count * pb;
        p += count * pb;
      }
    }
  }
  const rgba = new Uint8Array(n * 4);
  const top = (desc & 0x20) !== 0;
  const right = (desc & 0x10) !== 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = right ? w - 1 - x : x;
      const sy = top ? y : h - 1 - y;
      const s = (sy * w + sx) * pb;
      let c;
      if (kind === 2) c = colour(px, s, bpp);
      else if (kind === 3) { const g = px[s]; c = [g, g, g, bpp === 16 ? px[s + 1] : 255]; }
      else { const i = (bpp === 16 ? px[s] | (px[s + 1] << 8) : px[s]) - cmFirst; c = map[i] || [0, 0, 0, 255]; }
      const o = (y * w + x) * 4;
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = c[3];
    }
  }
  return { width: w, height: h, rgba };
}

/** BGR(A) at p in `bits` → [r, g, b, a] */
function colour(b, p, bits) {
  if (bits === 24) return [b[p + 2], b[p + 1], b[p], 255];
  if (bits === 32) return [b[p + 2], b[p + 1], b[p], b[p + 3]];
  const v = b[p] | (b[p + 1] << 8);   // 15/16 bits: x RRRRR GGGGG BBBBB
  return [((v >> 10) & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, (v & 31) * 255 / 31 | 0, 255];
}

let CRC = null;
function crc32(b) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(w, h, rgba) {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA, deflate, adaptive filters (0 here), no interlace
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', ihdr), chunk('IDAT', deflateZlib(raw)), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

export function tgaToPng(bytes) {
  const img = decodeTga(bytes);
  return img ? encodePng(img.width, img.height, img.rgba) : null;
}
