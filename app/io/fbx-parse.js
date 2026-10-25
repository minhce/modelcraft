/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file: what a person reads goes through t() (fbx.* keys); the rest is internal diagnostics and FBX names. */
/**
 * fbx-parse.js — the FBX container, binary and ASCII, into one node tree (0.7 XF.4 / XF.6, session `interchange`).
 * Clean room (docs/0.7-sessions/interchange.md § Licences, docs/spikes/fbx-reader.md): written only from the Blender
 * developers' public-domain prose description of the binary layout (2013), from what FBX files say about themselves, and
 * from black-box comparison with Assimp's output. No FBX SDK, no GPL importer, no other reader's source was read.
 *
 *   parseFbx(bytes) → { binary, version, root: { name: '', props: [], children: [Node] } }
 *   Node = { name, props: [number | bigint-free number | string | boolean | TypedArray | Uint8Array (raw)], children }
 *
 * Binary: "Kaydara FBX Binary  \0", 0x1A 0x00, u32 version. Then node records: end offset (absolute), property count,
 * property list length, u8 name length, the name, the properties, then nested records ended by a null record. Before
 * version 7500 the three leading fields are u32 (a null record is 13 zero bytes); from 7500 they are u64 (25 bytes).
 * Properties: one type letter — Y i16, C bool (one byte), I i32, F f32, D f64, L i64; f d l i b arrays (and c, byte
 * arrays, which files use though the description doesn't list it) (u32 count,
 * u32 encoding 0 = raw / 1 = zlib, u32 byte length); S string and R raw (u32 length + bytes).
 * ASCII: `Name: value, value, … { children }`, `*n { a: … }` for arrays, `;` comments, "quoted" strings.
 * Untrusted: every offset is checked against the file and against its parent's end; depth and size are capped.
 */
import { inflateZlib } from '../exr/zlib.js';
import { t } from '../i18n.js';

export class FbxError extends Error { constructor(code, message) { super(message); this.name = 'FbxError'; this.code = code; } }

const MAGIC = 'Kaydara FBX Binary  \0';
const LIMITS = { depth: 128, nodes: 5000000, arrayBytes: 1 << 30, total: 1 << 30 };
const bad = (why) => new FbxError('damaged', t('fbx.damaged', { why }));
const dec = new TextDecoder();

export function isFbx(b) {
  if (b.length >= 23) {
    let s = '';
    for (let i = 0; i < 21; i++) s += String.fromCharCode(b[i]);
    if (s === MAGIC) return 'binary';
  }
  const head = dec.decode(b.subarray(0, Math.min(b.length, 2048)));
  if (/^﻿?\s*;\s*FBX\s/.test(head) || /FBXHeaderExtension\s*:/.test(head)) return 'ascii';
  return null;
}

export function parseFbx(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const kind = isFbx(b);
  if (!kind) throw new FbxError('not_fbx', t('fbx.not_fbx'));
  return kind === 'binary' ? parseBinary(b) : parseAscii(b);
}

// ------------------------------------------------------------------------------------------------- binary

function parseBinary(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = dv.getUint32(23, true);
  if (version < 6000 || version > 20000) throw new FbxError('unsupported', t('fbx.version', { version }));
  const wide = version >= 7500;
  const head = wide ? 25 : 13;
  let count = 0;
  let budget = LIMITS.total;
  const u = (p) => {
    if (wide) {
      if (p + 8 > b.length) throw bad('a node header runs past the end');
      const lo = dv.getUint32(p, true);
      const hi = dv.getUint32(p + 4, true);
      if (hi > 0x1fffff) throw bad('a node size is impossible');
      return hi * 4294967296 + lo;
    }
    if (p + 4 > b.length) throw bad('a node header runs past the end');
    return dv.getUint32(p, true);
  };
  /** One node record at p (inside [.., limit)) → [node | null (the null record), next position] */
  const node = (p, limit, depth) => {
    if (depth > LIMITS.depth) throw bad('nodes nest too deeply');
    if (p + head > limit) throw bad('a node runs past its parent');
    const end = u(p);
    const nprops = u(p + (wide ? 8 : 4));
    const plen = u(p + (wide ? 16 : 8));
    const nlen = b[p + (wide ? 24 : 12)];
    if (end === 0) return [null, p + head];   // the null record that ends a list
    if (end <= p || end > limit) throw bad('a node ends outside its parent');
    if (++count > LIMITS.nodes) throw new FbxError('too_big', t('fbx.too_big'));
    let q = p + head;
    if (q + nlen > end) throw bad('a node name runs past the node');
    const name = dec.decode(b.subarray(q, q + nlen));
    q += nlen;
    const propsEnd = q + plen;
    if (propsEnd > end) throw bad('a node\'s properties run past the node');
    const props = [];
    for (let i = 0; i < nprops; i++) {
      if (q >= propsEnd) throw bad('a node has fewer properties than it says');
      const tc = String.fromCharCode(b[q++]);
      const need = (n) => { if (q + n > propsEnd) throw bad('a property runs past the node'); };
      switch (tc) {
        case 'Y': need(2); props.push(dv.getInt16(q, true)); q += 2; break;
        case 'C': need(1); props.push(b[q] !== 0); q += 1; break;
        case 'I': need(4); props.push(dv.getInt32(q, true)); q += 4; break;
        case 'F': need(4); props.push(dv.getFloat32(q, true)); q += 4; break;
        case 'D': need(8); props.push(dv.getFloat64(q, true)); q += 8; break;
        case 'L': need(8); props.push(i64(dv, q)); q += 8; break;
        case 'S': case 'R': {
          need(4);
          const n = dv.getUint32(q, true);
          q += 4;
          need(n);
          const raw = b.subarray(q, q + n);
          props.push(tc === 'S' ? dec.decode(raw) : raw);
          q += n;
          break;
        }
        case 'f': case 'd': case 'l': case 'i': case 'b': case 'c': {
          need(12);
          const n = dv.getUint32(q, true);
          const enc = dv.getUint32(q + 4, true);
          const blen = dv.getUint32(q + 8, true);
          q += 12;
          need(blen);
          const size = tc === 'd' || tc === 'l' ? 8 : tc === 'b' || tc === 'c' ? 1 : 4;
          if (n * size > LIMITS.arrayBytes) throw new FbxError('too_big', t('fbx.too_big'));
          budget -= n * size;
          if (budget < 0) throw new FbxError('too_big', t('fbx.too_big'));
          let raw;
          if (enc === 0) { if (blen !== n * size) throw bad('an array has the wrong length'); raw = b.subarray(q, q + blen); }
          else if (enc === 1) { try { raw = inflateZlib(b.subarray(q, q + blen), n * size); } catch (e) { throw bad('a packed array does not unpack (' + e.message + ')'); } }
          else throw bad('an array is packed in an unknown way');
          q += blen;
          props.push(typedArray(tc, raw, n));
          break;
        }
        default: throw bad('a property has an unknown type (' + tc.charCodeAt(0) + ')');
      }
    }
    q = propsEnd;
    const children = [];
    while (q < end) {
      if (end - q === head && b.subarray(q, q + head).every((x) => x === 0)) { q += head; break; }
      const [c, next] = node(q, end, depth + 1);
      q = next;
      if (!c) break;
      children.push(c);
    }
    return [{ name, props, children }, end];
  };
  const root = { name: '', props: [], children: [] };
  let p = 27;
  while (p + head <= b.length) {
    const [n, next] = node(p, b.length, 0);
    if (!n) break;
    root.children.push(n);
    p = next;
  }
  if (!root.children.length) throw bad('it holds no nodes');
  return { binary: true, version, root };
}

/** A signed 64-bit integer: a Number when it fits exactly, else its decimal text (object ids can be that large). */
function i64(dv, q) {
  const lo = dv.getUint32(q, true);
  const hi = dv.getInt32(q + 4, true);
  if (hi >= -0x200000 && hi < 0x200000) return hi * 4294967296 + lo;
  return ((BigInt(hi) << 32n) | BigInt(lo)).toString();
}

function typedArray(tc, raw, n) {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (tc === 'f') { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = dv.getFloat32(i * 4, true); return a; }
  if (tc === 'd') { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = dv.getFloat64(i * 8, true); return a; }
  if (tc === 'i') { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = dv.getInt32(i * 4, true); return a; }
  if (tc === 'l') { const a = new Float64Array(n); for (let i = 0; i < n; i++) { const v = i64(dv, i * 8); a[i] = typeof v === 'number' ? v : Number(v); } return a; }
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = tc === 'b' ? (raw[i] ? 1 : 0) : raw[i];   // b: booleans; c: bytes (seen in files, e.g. edge crease flags)
  return a;
}

// ------------------------------------------------------------------------------------------------- ASCII

function parseAscii(b) {
  const text = dec.decode(b);
  const L = text.length;
  let i = 0;
  let count = 0;
  const ws = () => {
    for (;;) {
      while (i < L && /\s/.test(text[i])) i++;
      if (text[i] === ';') { while (i < L && text[i] !== '\n') i++; continue; }
      return;
    }
  };
  const ident = () => { const s = i; while (i < L && /[A-Za-z0-9_|]/.test(text[i])) i++; return text.slice(s, i); };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '"') {
      let s = '';
      i++;
      while (i < L && text[i] !== '"') s += text[i++];
      if (i >= L) throw bad('a string has no end');
      i++;
      return s;
    }
    if (c === '*') {   // *n { a: … }
      i++;
      const s0 = i;
      while (i < L && /[0-9]/.test(text[i])) i++;
      const n = Number(text.slice(s0, i));
      ws();
      if (text[i] !== '{') throw bad('an array has no body');
      i++;
      ws();
      if (text.slice(i, i + 2) === 'a:') i += 2;
      const nums = [];
      for (;;) {
        ws();
        if (text[i] === '}') { i++; break; }
        if (text[i] === ',') { i++; continue; }
        const s = i;
        while (i < L && /[-+0-9.eE]/.test(text[i])) i++;
        if (s === i) throw bad('an array holds something that is not a number');
        nums.push(Number(text.slice(s, i)));
        if (nums.length > LIMITS.arrayBytes / 8) throw new FbxError('too_big', t('fbx.too_big'));
      }
      if (Number.isFinite(n) && nums.length !== n) throw bad('an array has the wrong length');
      return Float64Array.from(nums);
    }
    const s = i;
    while (i < L && /[-+0-9.eEA-Za-z_]/.test(text[i])) i++;
    const w = text.slice(s, i);
    if (w === 'T' || w === 'Y') return true;
    if (w === 'F' || w === 'N') return false;
    if (w === '') throw bad('a value is missing');
    if (/^-?\d{16,}$/.test(w)) return w;   // an id too long for a Number stays text, as binary files give it
    const v = Number(w);
    return Number.isFinite(v) ? v : w;
  };
  /** Spaces and tabs only: a node's values sit on its own line. */
  const blank = () => { while (i < L && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r')) i++; };
  const body = (depth) => {
    if (depth > LIMITS.depth) throw bad('nodes nest too deeply');
    const out = [];
    for (;;) {
      ws();
      if (i >= L || text[i] === '}') return out;
      const name = ident();
      if (!name) throw bad('a node has no name near character ' + i);
      ws();
      if (text[i] !== ':') throw bad('a node name has no colon near character ' + i);
      i++;
      if (++count > LIMITS.nodes) throw new FbxError('too_big', t('fbx.too_big'));
      const node = { name, props: [], children: [] };
      blank();
      // values, comma separated, up to the end of the line or an opening brace
      while (i < L && text[i] !== '\n' && text[i] !== '{' && text[i] !== '}' && text[i] !== ';') {
        if (text[i] === ',') { i++; blank(); if (text[i] === '\n') ws(); continue; }   // "Content: ," then the value on the next line
        node.props.push(value());
        blank();
        if (text[i] === ',') { i++; blank(); if (text[i] === '\n') ws(); continue; }
        break;
      }
      blank();
      if (text[i] === '{') {
        i++;
        node.children = body(depth + 1);
        ws();
        if (text[i] !== '}') throw bad('a node has no closing brace');
        i++;
      }
      out.push(node);
    }
  };
  const root = { name: '', props: [], children: body(0) };
  const ver = root.children.find((n) => n.name === 'FBXHeaderExtension')?.children.find((n) => n.name === 'FBXVersion')?.props[0];
  return { binary: false, version: typeof ver === 'number' ? ver : 0, root };
}

/** The first child of `n` named `name`. */
export const child = (n, name) => n?.children.find((c) => c.name === name) || null;
export const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
