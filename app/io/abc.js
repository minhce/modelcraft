/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file: what a person reads goes through t() (abc.* keys); the rest is internal diagnostics and schema names. */
/**
 * abc.js — Alembic caches in, read only (0.7 XF.3, session `interchange`). The Ogawa container and the way AbcCoreOgawa
 * lays out objects, properties and samples are not written down outside the Alembic library, so the layout follows its
 * sources (lib/Alembic/Ogawa, lib/Alembic/AbcCoreOgawa, lib/Alembic/AbcGeom — BSD-3-Clause, © Lucasfilm / Sony Pictures
 * Imageworks, read as a reference at /var/www/CADCRAFT/refs/alembic); the code is our own. HDF5-based Alembic files (the
 * old format) are refused. DOM-free; untrusted input: every position, count and size is checked against the file.
 *
 *   const abc = readAbc(bytes, { time })        → { objects: tree, times: [seconds], samples (max), notes }
 *   importAbc(model, abc, name) → { def, report }   inside model.change(); `def` is a group, not placed
 *
 * Ogawa: a 16-byte header ("Ogawa", 0xff when the file was closed cleanly, version 1, u64 root group). A group is
 * u64 n + n u64 child positions (top bit set = data, 0 = empty group); data is u64 size + bytes. The archive group holds
 * [0] the file version (i32), [1] the library version (i32), [2] the top object, [3] archive metadata, [4] time samplings,
 * [5] indexed metadata. An object group: [0] its properties (a compound), [1…n] its children, [last] their headers. A
 * compound: [0…n-1] its properties, [last] their headers. A scalar property: one data per stored sample; an array
 * property: data + dimensions per stored sample. Each data block starts with a 16-byte hash.
 *
 * Geometry read: Xform (ops: scale, translate, rotate, matrix, rotate X/Y/Z; inherits), PolyMesh and SubD (positions, face
 * counts and indices, uv and N as plain or indexed parameters, facevarying or vertex scope). Points, curves, NURBS, cameras,
 * lights and face sets are counted. A cache with several samples is read at one time (`time`, else its first sample).
 * Axes: Alembic is Y up like the programs that write it; it comes in Z up (x, y, z) → (x, −z, y). Faces: the exporters
 * write them clockwise, so they are turned round — unless the file's own normals say the faces were counter-clockwise.
 */
import { Mesh } from '../mesh.js';
import { mmul, ident } from '../vec.js';
import { markSharp } from './obj.js';
import { t } from '../i18n.js';

export class AbcError extends Error { constructor(code, message) { super(message); this.name = 'AbcError'; this.code = code; } }

const LIMITS = { objects: 200000, depth: 256, numbers: 1 << 27 };
const POD_SIZE = [1, 1, 1, 2, 2, 4, 4, 8, 8, 2, 4, 8, 0, 0];   // bool u8 i8 u16 i16 u32 i32 u64 i64 f16 f32 f64 string wstring
const POD = { bool: 0, u8: 1, i8: 2, u16: 3, i16: 4, u32: 5, i32: 6, u64: 7, i64: 8, f16: 9, f32: 10, f64: 11, string: 12, wstring: 13 };
const bad = (why) => new AbcError('damaged', t('abc.damaged', { why }));

class Ogawa {
  constructor(b) {
    this.b = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.size = b.length;
  }
  u64(pos) {
    if (pos < 0 || pos + 8 > this.size) throw bad('a position runs past the end of the file');
    const lo = this.dv.getUint32(pos, true);
    const hi = this.dv.getUint32(pos + 4, true);
    return { data: (hi & 0x80000000) !== 0, pos: (hi & 0x7fffffff) * 4294967296 + lo };
  }
  /** Children of the group at pos: [{data, pos}] (pos 0 + !data = an empty group; data with pos 0 = empty data). */
  group(pos) {
    if (pos === 0) return [];
    const n = this.u64(pos).pos;
    if (n === 0 || n > this.size / 8) throw bad('a group has an impossible number of children');
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.u64(pos + 8 + i * 8);
    return out;
  }
  /** The bytes of the data at pos (without its size). */
  data(pos) {
    if (pos === 0) return new Uint8Array(0);
    const n = this.u64(pos).pos;
    if (pos + 8 + n > this.size) throw bad('a block of data runs past the end of the file');
    return this.b.subarray(pos + 8, pos + 8 + n);
  }
}

const dec = new TextDecoder();
function metaParse(s) {
  const out = {};
  for (const kv of String(s).split(';')) { const i = kv.indexOf('='); if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1); }
  return out;
}

export function readAbc(input, opts = {}) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x48 && b[2] === 0x44 && b[3] === 0x46) throw new AbcError('unsupported', t('abc.hdf5'));
  if (b.length < 16 || dec.decode(b.subarray(0, 5)) !== 'Ogawa') throw new AbcError('not_abc', t('abc.not_abc'));
  if (b[5] !== 0xff) throw bad(t('abc.why.not_closed'));
  const version = (b[6] << 8) | b[7];
  if (version !== 1) throw new AbcError('unsupported', t('abc.version', { version }));
  const og = new Ogawa(b);
  const root = og.u64(8);
  const top = og.group(root.pos);
  if (top.length < 6 || !top[0].data || !top[1].data || top[2].data || !top[3].data || !top[4].data || !top[5].data) throw bad('the archive is not laid out as Alembic');
  const v0 = og.data(top[0].pos);
  const fileVersion = v0.length === 4 ? new DataView(v0.buffer, v0.byteOffset, 4).getInt32(0, true) : -1;
  if (fileVersion < 0 || fileVersion > 1) throw new AbcError('unsupported', t('abc.version', { version: fileVersion }));
  // time samplings: u32 max samples, f64 time per cycle, u32 n, n × f64 times
  const times = [];
  {
    const d = og.data(top[4].pos);
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    let p = 0;
    while (p < d.length) {
      if (p + 16 > d.length) throw bad('the time samplings are cut short');
      const max = dv.getUint32(p, true);
      const tpc = dv.getFloat64(p + 4, true);
      const n = dv.getUint32(p + 12, true);
      p += 16;
      if (n < 1 || p + n * 8 > d.length) throw bad('the time samplings are cut short');
      const st = [];
      for (let i = 0; i < n; i++) st.push(dv.getFloat64(p + i * 8, true));
      p += n * 8;
      times.push({ max, tpc, times: st });
    }
  }
  // indexed metadata: [0] is the empty one
  const metas = [{}];
  {
    const d = og.data(top[5].pos);
    let p = 0;
    while (p < d.length) {
      const n = d[p++];
      if (p + n > d.length) throw bad('the shared metadata is cut short');
      metas.push(metaParse(dec.decode(d.subarray(p, p + n))));
      p += n;
    }
  }
  const notes = {};
  let count = 0;
  let numbers = LIMITS.numbers;

  const propHeaders = (cpos) => {
    const kids = og.group(cpos);
    if (!kids.length || !kids[kids.length - 1].data) return { kids, heads: [] };
    const d = og.data(kids[kids.length - 1].pos);
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const heads = [];
    let p = 0;
    const need = (n) => { if (p + n > d.length) throw bad('a property header is cut short'); };
    const hinted = (hint) => {
      if (hint === 0) { need(1); return d[p++]; }
      if (hint === 1) { need(2); const v = dv.getUint16(p, true); p += 2; return v; }
      need(4); const v = dv.getUint32(p, true); p += 4; return v;
    };
    while (p < d.length) {
      need(4);
      const info = dv.getUint32(p, true);
      p += 4;
      const ptype = info & 3;
      const hint = (info >> 2) & 3;
      if (hint === 3) throw bad('a property header has a bad size hint');
      const h = { kind: ptype === 0 ? 'compound' : ptype === 1 ? 'scalar' : 'array', index: heads.length };
      if (ptype !== 0) {
        h.pod = (info >> 4) & 15;
        if (h.pod > 13) throw bad('a property has an unknown data type');
        h.extent = (info >> 12) & 0xff;
        h.next = hinted(hint);
        if (info & 0x200) { h.first = hinted(hint); h.last = hinted(hint); }
        else if (info & 0x800) { h.first = 0; h.last = 0; }
        else { h.first = 1; h.last = h.next - 1; }
        h.ts = info & 0x100 ? hinted(hint) : 0;
        if (h.ts >= times.length && times.length) throw bad('a property names a time sampling that is not there');
      }
      const nl = hinted(hint);
      need(nl);
      if (!nl) throw bad('a property has no name');
      h.name = dec.decode(d.subarray(p, p + nl));
      p += nl;
      const mi = (info >> 20) & 0xff;
      if (mi === 0xff) { const ml = hinted(hint); need(ml); h.meta = metaParse(dec.decode(d.subarray(p, p + ml))); p += ml; }
      else if (mi < metas.length) h.meta = metas[mi];
      else throw bad('a property names metadata that is not there');
      heads.push(h);
    }
    return { kids, heads };
  };
  /** Which stored sample holds sample index i. */
  const stored = (h, i) => {
    if (i < h.first) return 0;
    if (h.first === h.last && h.first === 0) return 0;
    if (i >= h.last) return h.last - h.first + 1;
    return i - h.first + 1;
  };
  /** The sample index nearest `time` for a property with time sampling ts and `n` samples. */
  const sampleAt = (h, time) => {
    const n = h.next;
    if (n <= 1 || time === undefined || time === null) return 0;
    const T = times[h.ts];
    if (!T) return 0;
    // uniform and cyclic samplings repeat their times every cycle; an acyclic one (time per cycle = the largest double
    // ÷ 32) lists every time
    const acyclic = !(T.tpc < 1e300);
    const at = (i) => (acyclic ? T.times[Math.min(i, T.times.length - 1)] : T.times[i % T.times.length] + Math.floor(i / T.times.length) * T.tpc);
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < Math.min(n, 1e6); i++) { const dd = Math.abs(at(i) - time); if (dd < bd) { bd = dd; best = i; } }
    return best;
  };
  /** One sample of a scalar or array property → typed array (numbers) or strings. */
  const sample = (kids, h, i) => {
    const g = kids[h.index];
    if (!g || g.data) throw bad('a property is missing its data');
    const sk = og.group(g.pos);
    if (h.next === 0) return null;
    const k = stored(h, Math.min(i, h.next - 1));
    const di = h.kind === 'array' ? k * 2 : k;
    const de = sk[di];
    if (!de || !de.data) throw bad('a property sample is missing');
    const d = og.data(de.pos);
    if (d.length === 0) return null;
    if (d.length < 16) throw bad('a property sample is shorter than its hash');
    const body = d.subarray(16);
    if (h.pod === POD.string) return dec.decode(body).split('\0').slice(0, -1);
    if (h.pod === POD.wstring) return null;
    const size = POD_SIZE[h.pod];
    const n = Math.floor(body.length / size);
    numbers -= n;
    if (numbers < 0) throw new AbcError('too_big', t('abc.too_big'));
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const out = h.pod === POD.f64 ? new Float64Array(n) : h.pod === POD.f32 || h.pod === POD.f16 ? new Float32Array(n) : h.pod === POD.u32 || h.pod === POD.u64 ? new Uint32Array(n) : new Int32Array(n);
    for (let q = 0; q < n; q++) {
      const o = q * size;
      switch (h.pod) {
        case POD.bool: case POD.u8: out[q] = body[o]; break;
        case POD.i8: out[q] = dv.getInt8(o); break;
        case POD.u16: out[q] = dv.getUint16(o, true); break;
        case POD.i16: out[q] = dv.getInt16(o, true); break;
        case POD.u32: out[q] = dv.getUint32(o, true); break;
        case POD.i32: out[q] = dv.getInt32(o, true); break;
        case POD.u64: out[q] = dv.getUint32(o, true); break;
        case POD.i64: out[q] = dv.getInt32(o, true); break;
        case POD.f16: out[q] = half(dv.getUint16(o, true)); break;
        case POD.f32: out[q] = dv.getFloat32(o, true); break;
        default: out[q] = dv.getFloat64(o, true);
      }
    }
    return out;
  };
  const time = opts.time ?? null;
  let maxSamples = 1;
  /** A geometry parameter (uv, N): an array property, or a compound with .vals + .indices → { vals, indices | null, scope, nc } */
  const param = (kids, heads, name, nc) => {
    const h = heads.find((x) => x.name === name);
    if (!h) return null;
    if (h.kind === 'array') return { vals: sample(kids, h, sampleAt(h, time)), indices: null, scope: h.meta.geoScope || 'fvr', nc };
    if (h.kind !== 'compound') return null;
    const sub = propHeaders(kids[h.index].pos);
    const vh = sub.heads.find((x) => x.name === '.vals');
    const ih = sub.heads.find((x) => x.name === '.indices');
    if (!vh) return null;
    return { vals: sample(sub.kids, vh, sampleAt(vh, time)), indices: ih ? sample(sub.kids, ih, sampleAt(ih, time)) : null, scope: h.meta.geoScope || vh.meta.geoScope || 'fvr', nc };
  };

  const readObject = (pos, depth, name, meta) => {
    if (depth > LIMITS.depth || ++count > LIMITS.objects) throw new AbcError('too_big', t('abc.too_big'));
    const kids = og.group(pos);
    const node = { name, schema: meta.schema || '', matrix: null, inherits: true, mesh: null, children: [] };
    // headers of the children
    const heads = [];
    if (kids.length && kids[kids.length - 1].data) {
      const d = og.data(kids[kids.length - 1].pos);
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const end = d.length - 32;   // the last 32 bytes are hashes
      let p = 0;
      while (p < end) {
        if (p + 4 > end) throw bad('an object header is cut short');
        const nl = dv.getUint32(p, true);
        p += 4;
        if (!nl || p + nl + 1 > end) throw bad('an object header is cut short');
        const nm = dec.decode(d.subarray(p, p + nl));
        p += nl;
        const mi = d[p++];
        let md;
        if (mi === 0xff) { if (p + 4 > end) throw bad('an object header is cut short'); const ml = dv.getUint32(p, true); p += 4; if (p + ml > end) throw bad('an object header is cut short'); md = metaParse(dec.decode(d.subarray(p, p + ml))); p += ml; }
        else if (mi < metas.length) md = metas[mi];
        else throw bad('an object names metadata that is not there');
        heads.push({ name: nm, meta: md });
      }
    }
    // properties
    if (kids.length && !kids[0].data && kids[0].pos) {
      const props = propHeaders(kids[0].pos);
      const s = node.schema;
      const geomName = s.startsWith('AbcGeom_Xform') ? '.xform' : (meta.schemaObjTitle || '').split(':')[1] || '.geom';
      const gh = props.heads.find((h) => h.name === geomName && h.kind === 'compound');
      if (gh) {
        const g = propHeaders(props.kids[gh.index].pos);
        if (s.startsWith('AbcGeom_Xform')) readXform(node, g);
        else if (s.startsWith('AbcGeom_PolyMesh') || s.startsWith('AbcGeom_SubD')) readMesh(node, g, s.startsWith('AbcGeom_SubD'));
        else if (s) notes[t('abc.note.kind', { kind: s.replace(/^AbcGeom_/, '').replace(/_v\d+$/, '') })] = (notes[t('abc.note.kind', { kind: s.replace(/^AbcGeom_/, '').replace(/_v\d+$/, '') })] || 0) + 1;
      } else if (s && !s.startsWith('AbcGeom_Xform')) notes[t('abc.note.kind', { kind: s })] = (notes[t('abc.note.kind', { kind: s })] || 0) + 1;
    }
    heads.forEach((h, i) => {
      const c = kids[i + 1];
      if (!c || c.data) throw bad('an object is missing a child');
      node.children.push(readObject(c.pos, depth + 1, h.name, h.meta));
    });
    return node;
  };
  const readXform = (node, g) => {
    const opsH = g.heads.find((h) => h.name === '.ops');
    const valsH = g.heads.find((h) => h.name === '.vals');
    const inhH = g.heads.find((h) => h.name === '.inherits');
    if (inhH) { const v = sample(g.kids, inhH, sampleAt(inhH, time)); node.inherits = !v || v[0] !== 0; }
    if (!opsH || !valsH) { node.matrix = ident(); return; }
    maxSamples = Math.max(maxSamples, valsH.next || 1);
    const ops = sample(g.kids, opsH, 0) || [];
    const vals = sample(g.kids, valsH, sampleAt(valsH, time)) || [];
    let m = ident();
    let c = 0;
    const take = (n) => { if (c + n > vals.length) throw bad('an xform has too few values for its operations'); const v = Array.from(vals.subarray(c, c + n)); c += n; return v; };
    for (const op of ops) {
      const type = op >> 4;
      let M;
      if (type === 0) { const [x, y, z] = take(3); M = [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]; }
      else if (type === 1) { const [x, y, z] = take(3); M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
      else if (type === 2) { const [x, y, z, a] = take(4); M = axisAngle([x, y, z], a); }
      else if (type === 3) M = take(16);   // Imath rows (row vectors) = our columns (column vectors)
      else if (type === 4) M = axisAngle([1, 0, 0], take(1)[0]);
      else if (type === 5) M = axisAngle([0, 1, 0], take(1)[0]);
      else if (type === 6) M = axisAngle([0, 0, 1], take(1)[0]);
      else throw bad('an xform has an unknown operation');
      m = mmul(m, M);   // the first operation is the outermost
    }
    if (!m.every(Number.isFinite)) throw bad('an xform is not a number');
    node.matrix = m;
  };
  const readMesh = (node, g, subd) => {
    const P = g.heads.find((h) => h.name === 'P');
    const FI = g.heads.find((h) => h.name === '.faceIndices');
    const FC = g.heads.find((h) => h.name === '.faceCounts');
    if (!P || !FI || !FC) return;
    maxSamples = Math.max(maxSamples, P.next || 1);
    const pos = sample(g.kids, P, sampleAt(P, time));
    const idx = sample(g.kids, FI, sampleAt(FI, time));
    const cnt = sample(g.kids, FC, sampleAt(FC, time));
    if (!pos || !idx || !cnt) return;
    if (pos.length % 3) throw bad('a mesh has positions that are not points');
    let sum = 0;
    for (const c of cnt) { if (c < 0) throw bad('a mesh has a negative face size'); sum += c; }
    if (sum !== idx.length) throw bad('a mesh\'s face sizes do not add up to its corners');
    const nv = pos.length / 3;
    for (const i of idx) if (i < 0 || i >= nv) throw bad('a mesh corner points past its points');
    for (const v of pos) if (!(Math.abs(v) < 1e8)) throw bad('a mesh point is not a sane number');
    const uv = param(g.kids, g.heads, 'uv', 2) || param(g.kids, g.heads, 'st', 2);
    const N = param(g.kids, g.heads, 'N', 3);
    node.mesh = { positions: pos, indices: idx, counts: cnt, uv, N, subd, samples: P.next || 1 };
  };

  const topNode = readObject(top[2].pos, 0, 'ABC', {});
  const allTimes = new Set();
  for (const T of times) for (const x of T.times) allTimes.add(x);
  return { objects: topNode, samples: maxSamples, times: [...allTimes].sort((a, b) => a - b), notes, fileVersion };
}

function half(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 31;
  const m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
}

function axisAngle(axis, deg) {
  const l = Math.hypot(...axis);
  if (!(l > 0)) return ident();
  const [x, y, z] = axis.map((v) => v / l);
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = 1 - c;
  // column-major, column vectors: a right-handed turn of `deg` about the axis
  return [c + x * x * k, y * x * k + z * s, z * x * k - y * s, 0, x * y * k - z * s, c + y * y * k, z * y * k + x * s, 0, x * z * k + y * s, y * z * k - x * s, c + z * z * k, 0, 0, 0, 0, 1];
}

// ------------------------------------------------------------------------------------------------- import

const C = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const CI = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const conj = (m) => mmul(C, mmul(m, CI));
const cleanName = (s, d) => String(s || d || 'Alembic import').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) || d || 'Alembic import';

export function importAbc(model, abc, name) {
  const report = { meshes: 0, faces: 0, vertices: 0, groups: 0, samples: abc.samples, times: abc.times.length, flipped: 0, skipped: { ...abc.notes } };
  const top = model.newDef('group', cleanName(name));
  // world matrices so an object that does not inherit its parents' transforms can be placed against the top
  const place = (node, parentDef, parentWorld, depth) => {
    if (depth > 256) return;
    const local = node.matrix || ident();
    const world = node.inherits ? mmul(parentWorld, local) : local;
    // an object that does not inherit: its matrix is relative to the world, so relative to its parent group it is
    // parentWorld⁻¹ · local — placed under the top instead, which is the world
    let def = parentDef;
    let m = conj(local);
    if (!node.inherits) { def = top; m = conj(local); }
    if (node.mesh) {
      const md = buildMesh(node.mesh, report);
      if (md) {
        const d = model.newMeshDef(md, cleanName(node.name, t('abc.mesh')));
        model.place(def, d.id, m);
        report.meshes++;
        report.faces += md.faceCount;
        report.vertices += md.vertexCount;
      }
      if (node.children.length) {
        // a mesh object with children (rare): the children sit in the same frame
        const g = model.newDef('group', cleanName(node.name, t('abc.mesh')));
        model.place(def, g.id, m);
        for (const c of node.children) place(c, g, world, depth + 1);
      }
      return;
    }
    if (!node.children.length) return;
    if (node === abc.objects) { for (const c of node.children) place(c, top, world, depth + 1); return; }
    const g = model.newDef('group', cleanName(node.name, t('abc.group')));
    report.groups++;
    model.place(def, g.id, m);
    for (const c of node.children) place(c, g, world, depth + 1);
  };
  place(abc.objects, top, ident(), 0);
  return { def: top, report };
}

function buildMesh(m, report) {
  const nv = m.positions.length / 3;
  const pts = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) { pts[i * 3] = m.positions[i * 3]; pts[i * 3 + 1] = -m.positions[i * 3 + 2]; pts[i * 3 + 2] = m.positions[i * 3 + 1]; }
  // facevarying data follow the file's corner order; decide the winding first
  const nf = m.counts.length;
  const starts = new Int32Array(nf + 1);
  for (let f = 0; f < nf; f++) starts[f + 1] = starts[f] + m.counts[f];
  const Nf = m.N ? expand(m.N, m.indices, starts) : null;
  let reverse = true;
  if (Nf) {
    // compare each face's own normal (counter-clockwise reading) with the file's normals
    let agree = 0;
    let disagree = 0;
    for (let f = 0; f < nf && f < 2000; f++) {
      const n = newell(m.positions, m.indices, starts[f], m.counts[f]);
      let fx = 0; let fy = 0; let fz = 0;
      for (let c = starts[f]; c < starts[f + 1]; c++) { fx += Nf[c * 3]; fy += Nf[c * 3 + 1]; fz += Nf[c * 3 + 2]; }
      const d = n[0] * fx + n[1] * fy + n[2] * fz;
      if (d > 0) agree++; else if (d < 0) disagree++;
    }
    reverse = disagree >= agree;
  }
  if (!reverse) report.flipped++;
  const fc = new Int32Array(nf);
  const fi = new Int32Array(m.indices.length);
  const src = new Int32Array(m.indices.length);   // which file corner each mesh corner came from
  let o = 0;
  for (let f = 0; f < nf; f++) {
    fc[f] = m.counts[f];
    for (let k = 0; k < m.counts[f]; k++) {
      const c = reverse ? starts[f + 1] - 1 - k : starts[f] + k;
      fi[o] = m.indices[c];
      src[o++] = c;
    }
  }
  const keep = [];
  for (let f = 0; f < nf; f++) if (fc[f] >= 3) keep.push(f);
  if (keep.length < nf) report.skipped[t('abc.note.small_faces')] = (report.skipped[t('abc.note.small_faces')] || 0) + nf - keep.length;
  if (!keep.length) return null;
  const fck = new Int32Array(keep.length);
  let corners = 0;
  keep.forEach((f, k) => { fck[k] = fc[f]; corners += fc[f]; });
  const fik = new Int32Array(corners);
  const srck = new Int32Array(corners);
  let q = 0;
  for (const f of keep) for (let k = 0; k < fc[f]; k++) { fik[q] = fi[starts[f] + k]; srck[q] = src[starts[f] + k]; q++; }
  const mesh = new Mesh();
  const { cornerOf, dropped } = mesh._bulk(pts, nv, fck, fik);
  if (dropped) report.skipped[t('abc.note.small_faces')] = (report.skipped[t('abc.note.small_faces')] || 0) + dropped;
  const UVf = m.uv ? expand(m.uv, m.indices, starts) : null;
  const UV = UVf ? (mesh.addAttr('uv', 'corner', 2), mesh.attrArray('uv')) : null;
  const NR = Nf ? (mesh.addAttr('normal', 'corner', 3), mesh.attrArray('normal')) : null;
  for (let k = 0; k < corners; k++) {
    const h = cornerOf[k];
    if (h < 0) continue;
    const c = srck[k];
    if (UV) { UV[h * 2] = UVf[c * 2]; UV[h * 2 + 1] = UVf[c * 2 + 1]; }
    if (NR) {
      const x = Nf[c * 3]; const y = Nf[c * 3 + 1]; const z = Nf[c * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      NR[h * 3] = x / l; NR[h * 3 + 1] = -z / l; NR[h * 3 + 2] = y / l;
    }
  }
  markSharp(mesh, NR, null);
  return mesh;
}

/** A geometry parameter as one value per file corner (facevarying), from facevarying, vertex or uniform scope. */
function expand(p, indices, starts) {
  if (!p.vals) return null;
  const nc = p.nc;
  const corners = indices.length;
  const out = new Float32Array(corners * nc);
  const nvals = p.vals.length / nc;
  const at = (i) => (p.indices ? p.indices[i] : i);
  for (let f = 0; f + 1 < starts.length; f++) {
    for (let c = starts[f]; c < starts[f + 1]; c++) {
      let i;
      if (p.scope === 'vtx' || p.scope === 'var') i = p.indices ? at(indices[c]) : indices[c];
      else if (p.scope === 'uni') i = at(f);
      else if (p.scope === 'con') i = at(0);
      else i = at(c);
      if (!(i >= 0 && i < nvals)) return null;   // the parameter does not fit the mesh: leave it out
      for (let k = 0; k < nc; k++) out[c * nc + k] = p.vals[i * nc + k];
    }
  }
  return out;
}

function newell(P, idx, s, n) {
  let x = 0; let y = 0; let z = 0;
  for (let k = 0; k < n; k++) {
    const a = idx[s + k] * 3; const b = idx[s + ((k + 1) % n)] * 3;
    x += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
    y += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
    z += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
  }
  return [x, y, z];
}

