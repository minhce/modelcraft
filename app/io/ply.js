/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ply.js — PLY meshes with colour, both ways (0.7 XF.3, session `interchange`), from the published format (Greg Turk,
 * "The PLY Polygon File Format", 1994): a text header naming elements and their properties, then the elements in ASCII,
 * binary little-endian or binary big-endian. DOM-free; untrusted input (every count and index checked, caps).
 *
 *   readPly(bytes) → { vertices, faces, positions: Float64Array, normals: Float32Array | null, colors: Float32Array RGBA
 *                      (linear) | null, uvs: Float32Array | null, faceIndex: Int32Array (CSR: faceStart), faceStart,
 *                      faceColors: Float32Array RGBA (linear) | null, comments: [string], notes }
 *   importPly(model, ply, name) → { def, report }       inside model.change(); one mesh definition in a group
 *   exportPly(model) → { bytes, report }                 binary little-endian: x y z, nx ny nz, red green blue alpha (uchar),
 *                                                        s t (when the model has UVs), faces as vertex_indices
 *
 * PLY says nothing about units or axes: coordinates come in and go out as they are (metres, Z up). Colours: 0–255 bytes or
 * 0–1 floats are read as sRGB; the mesh keeps them exact in its `color` layer (linear RGBA) and each face is painted the
 * nearest of at most 4,096 colours (12-bit) so it shows now. Elements other than vertex and face are skipped.
 */
import { Mesh } from '../mesh.js';
import { paintHex, faceNormal as fN, faceTris as fT } from '../model.js';
import { det3 as det } from '../vec.js';
import { markSharp } from './obj.js';
import { t } from '../i18n.js';

const MAX = 20000000;
const TYPES = { char: ['getInt8', 1], int8: ['getInt8', 1], uchar: ['getUint8', 1], uint8: ['getUint8', 1], short: ['getInt16', 2], int16: ['getInt16', 2], ushort: ['getUint16', 2], uint16: ['getUint16', 2], int: ['getInt32', 4], int32: ['getInt32', 4], uint: ['getUint32', 4], uint32: ['getUint32', 4], float: ['getFloat32', 4], float32: ['getFloat32', 4], double: ['getFloat64', 8], float64: ['getFloat64', 8] };
const fail = (why) => new Error(t('ply.bad', { why }));
export const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function readPly(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!(b[0] === 0x70 && b[1] === 0x6c && b[2] === 0x79 && (b[3] === 0x0a || b[3] === 0x0d))) throw new Error(t('ply.not_ply'));
  // header: text lines up to end_header
  let pos = 0;
  const lines = [];
  for (;;) {
    let e = pos;
    while (e < b.length && b[e] !== 0x0a) e++;
    if (e >= b.length || lines.length > 10000) throw fail(t('ply.why.header'));
    let s = '';
    for (let i = pos; i < e; i++) s += String.fromCharCode(b[i]);
    pos = e + 1;
    s = s.replace(/\r$/, '').trim();
    lines.push(s);
    if (s === 'end_header') break;
  }
  let format = null;
  const elements = [];
  const comments = [];
  for (const s of lines.slice(1)) {
    const w = s.split(/\s+/);
    if (w[0] === 'format') format = w[1];
    else if (w[0] === 'comment' || w[0] === 'obj_info') comments.push(s.slice(w[0].length + 1).slice(0, 300));
    else if (w[0] === 'element') {
      const count = Number(w[2]);
      if (!Number.isInteger(count) || count < 0 || count > MAX) throw fail(t('ply.why.count'));
      elements.push({ name: w[1], count, props: [] });
    } else if (w[0] === 'property') {
      const el = elements[elements.length - 1];
      if (!el) throw fail(t('ply.why.header'));
      if (w[1] === 'list') {
        if (!TYPES[w[2]] || !TYPES[w[3]]) throw fail(t('ply.why.type', { type: w[2] + ' ' + w[3] }));
        el.props.push({ name: w[4], list: true, count: w[2], type: w[3] });
      } else {
        if (!TYPES[w[1]]) throw fail(t('ply.why.type', { type: w[1] }));
        el.props.push({ name: w[2], type: w[1] });
      }
    }
  }
  if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format)) throw fail(t('ply.why.format', { format: String(format).slice(0, 30) }));
  const little = format === 'binary_little_endian';
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // ASCII: a token reader over the body
  let tokPos = pos;
  const tok = () => {
    while (tokPos < b.length && (b[tokPos] === 0x20 || b[tokPos] === 0x0a || b[tokPos] === 0x0d || b[tokPos] === 0x09)) tokPos++;
    const s0 = tokPos;
    while (tokPos < b.length && !(b[tokPos] === 0x20 || b[tokPos] === 0x0a || b[tokPos] === 0x0d || b[tokPos] === 0x09)) tokPos++;
    if (s0 === tokPos) throw fail(t('ply.why.short'));
    let s = '';
    for (let i = s0; i < tokPos; i++) s += String.fromCharCode(b[i]);
    const v = Number(s);
    if (!Number.isFinite(v)) throw fail(t('ply.why.number'));
    return v;
  };
  const read = (type) => {
    if (format === 'ascii') return tok();
    const [g, n] = TYPES[type];
    if (pos + n > b.length) throw fail(t('ply.why.short'));
    const v = n === 1 ? dv[g](pos) : dv[g](pos, little);
    pos += n;
    return v;
  };
  const out = { vertices: 0, faces: 0, positions: null, normals: null, colors: null, uvs: null, faceStart: null, faceIndex: null, faceColors: null, comments, notes: {} };
  for (const el of elements) {
    const names = el.props.map((p) => p.name);
    const has = (...n) => n.every((x) => names.includes(x));
    if (el.name === 'vertex') {
      const n = el.count;
      out.vertices = n;
      out.positions = new Float64Array(n * 3);
      const nrm = has('nx', 'ny', 'nz') ? (out.normals = new Float32Array(n * 3)) : null;
      const cr = names.find((x) => x === 'red' || x === 'r' || x === 'diffuse_red');
      const cg = names.find((x) => x === 'green' || x === 'g' || x === 'diffuse_green');
      const cb = names.find((x) => x === 'blue' || x === 'b' || x === 'diffuse_blue');
      const ca = names.find((x) => x === 'alpha' || x === 'a');
      const col = cr && cg && cb ? (out.colors = new Float32Array(n * 4)) : null;
      const us = names.find((x) => ['s', 'u', 'texture_u', 'texture_s'].includes(x));
      const vs = names.find((x) => ['t', 'v', 'texture_v', 'texture_t'].includes(x));
      const uvs = us && vs ? (out.uvs = new Float32Array(n * 2)) : null;
      const byte = (p) => p && ['uchar', 'uint8', 'char', 'int8'].includes(el.props.find((q) => q.name === p).type);
      const scaleOf = (p) => (byte(p) ? 1 / 255 : ['ushort', 'uint16'].includes(el.props.find((q) => q.name === p)?.type) ? 1 / 65535 : 1);
      const sc = { [cr]: scaleOf(cr), [cg]: scaleOf(cg), [cb]: scaleOf(cb), [ca]: scaleOf(ca) };
      for (let i = 0; i < n; i++) {
        if (col) col[i * 4 + 3] = 1;
        for (const p of el.props) {
          if (p.list) { const c = read(p.count); if (c < 0 || c > 1000) throw fail(t('ply.why.count')); for (let k = 0; k < c; k++) read(p.type); continue; }
          const v = read(p.type);
          switch (p.name) {
            case 'x': out.positions[i * 3] = v; break;
            case 'y': out.positions[i * 3 + 1] = v; break;
            case 'z': out.positions[i * 3 + 2] = v; break;
            case 'nx': if (nrm) nrm[i * 3] = v; break;
            case 'ny': if (nrm) nrm[i * 3 + 1] = v; break;
            case 'nz': if (nrm) nrm[i * 3 + 2] = v; break;
            default:
              if (col && p.name === cr) col[i * 4] = srgbToLin(Math.min(1, Math.max(0, v * sc[cr])));
              else if (col && p.name === cg) col[i * 4 + 1] = srgbToLin(Math.min(1, Math.max(0, v * sc[cg])));
              else if (col && p.name === cb) col[i * 4 + 2] = srgbToLin(Math.min(1, Math.max(0, v * sc[cb])));
              else if (col && p.name === ca) col[i * 4 + 3] = Math.min(1, Math.max(0, v * sc[ca]));
              else if (uvs && p.name === us) uvs[i * 2] = v;
              else if (uvs && p.name === vs) uvs[i * 2 + 1] = v;
          }
        }
        const x = out.positions[i * 3]; const y = out.positions[i * 3 + 1]; const z = out.positions[i * 3 + 2];
        if (!(Math.abs(x) < 1e7 && Math.abs(y) < 1e7 && Math.abs(z) < 1e7)) throw fail(t('ply.why.number'));
      }
    } else if (el.name === 'face') {
      const n = el.count;
      out.faces = n;
      const start = new Int32Array(n + 1);
      let idx = new Int32Array(Math.min(MAX, Math.max(16, n * 3)));
      let used = 0;
      const lp = el.props.find((p) => p.list && (p.name === 'vertex_indices' || p.name === 'vertex_index')) || el.props.find((p) => p.list);
      if (!lp) throw fail(t('ply.why.no_indices'));
      const fr = el.props.find((p) => !p.list && (p.name === 'red' || p.name === 'r'));
      const fg = el.props.find((p) => !p.list && (p.name === 'green' || p.name === 'g'));
      const fb = el.props.find((p) => !p.list && (p.name === 'blue' || p.name === 'b'));
      const fcol = fr && fg && fb ? (out.faceColors = new Float32Array(n * 4)) : null;
      const fscale = fr && ['uchar', 'uint8'].includes(fr.type) ? 1 / 255 : 1;
      for (let i = 0; i < n; i++) {
        start[i] = used;
        if (fcol) fcol[i * 4 + 3] = 1;
        for (const p of el.props) {
          if (p.list) {
            const c = read(p.count);
            if (!(c >= 0 && c <= 100000)) throw fail(t('ply.why.count'));
            for (let k = 0; k < c; k++) {
              const v = read(p.type);
              if (p !== lp) continue;
              if (used >= idx.length) { if (idx.length >= MAX * 4) throw fail(t('ply.why.count')); const nb = new Int32Array(idx.length * 2); nb.set(idx); idx = nb; }
              idx[used++] = v;
            }
            continue;
          }
          const v = read(p.type);
          if (fcol && p === fr) fcol[i * 4] = srgbToLin(Math.min(1, Math.max(0, v * fscale)));
          else if (fcol && p === fg) fcol[i * 4 + 1] = srgbToLin(Math.min(1, Math.max(0, v * fscale)));
          else if (fcol && p === fb) fcol[i * 4 + 2] = srgbToLin(Math.min(1, Math.max(0, v * fscale)));
        }
      }
      start[n] = used;
      out.faceStart = start;
      out.faceIndex = idx.subarray(0, used);
    } else {
      // another element: read past it
      out.notes[t('ply.note.element', { name: String(el.name).slice(0, 40) })] = el.count;
      for (let i = 0; i < el.count; i++) for (const p of el.props) {
        if (p.list) { const c = read(p.count); if (!(c >= 0 && c <= 100000)) throw fail(t('ply.why.count')); for (let k = 0; k < c; k++) read(p.type); } else read(p.type);
      }
    }
  }
  if (!out.positions) throw fail(t('ply.why.no_vertices'));
  if (out.faceIndex) for (const i of out.faceIndex) if (i < 0 || i >= out.vertices) throw fail(t('ply.why.index'));
  return out;
}

/** The nearest of 4,096 colours (4 bits a channel) as '#rrggbb', from linear RGB. */
export function paintFromLinear(r, g, b) {
  const q = (c) => { const v = Math.round(linToSrgb(Math.min(1, Math.max(0, c))) * 15) * 17; return v.toString(16).padStart(2, '0'); };
  return '#' + q(r) + q(g) + q(b);
}

export function importPly(model, ply, name) {
  const report = { faces: 0, vertices: 0, colours: 0, points: 0, skipped: { ...ply.notes } };
  const top = model.newDef('group', String(name || 'PLY import').slice(0, 120));   // i18n-ignore: a fallback for a file with no name
  if (!ply.faceIndex || !ply.faces) {
    report.points = ply.vertices;
    report.skipped[t('ply.note.points')] = ply.vertices;
    return { def: top, report };
  }
  const nf = ply.faces;
  const fc = new Int32Array(nf);
  for (let i = 0; i < nf; i++) fc[i] = ply.faceStart[i + 1] - ply.faceStart[i];
  const keep = [];
  let corners = 0;
  for (let i = 0; i < nf; i++) if (fc[i] >= 3) { keep.push(i); corners += fc[i]; }
  if (keep.length < nf) report.skipped[t('ply.note.small_faces')] = nf - keep.length;
  const fck = new Int32Array(keep.length);
  const fik = new Int32Array(corners);
  let o = 0;
  keep.forEach((f, k) => { fck[k] = fc[f]; for (let q = ply.faceStart[f]; q < ply.faceStart[f + 1]; q++) fik[o++] = ply.faceIndex[q]; });
  const mesh = new Mesh();
  const { faceOf, cornerOf, dropped } = mesh._bulk(ply.positions, ply.vertices, fck, fik);
  if (dropped) report.skipped[t('ply.note.small_faces')] = (report.skipped[t('ply.note.small_faces')] || 0) + dropped;
  const NR = ply.normals ? (mesh.addAttr('normal', 'corner', 3), mesh.attrArray('normal')) : null;
  const UV = ply.uvs ? (mesh.addAttr('uv', 'corner', 2), mesh.attrArray('uv')) : null;
  const CO = ply.colors || ply.faceColors ? (mesh.addAttr('color', 'corner', 4), mesh.attrArray('color')) : null;
  const seen = new Set();
  o = 0;
  keep.forEach((f, k) => {
    const mf = faceOf[k];
    let r = 0; let g = 0; let b2 = 0; let n = 0;
    for (let q = 0; q < fc[f]; q++, o++) {
      const h = cornerOf[o];
      const v = fik[o];
      if (h < 0) continue;
      if (NR) { const x = ply.normals[v * 3]; const y = ply.normals[v * 3 + 1]; const z = ply.normals[v * 3 + 2]; const l = Math.hypot(x, y, z) || 1; NR[h * 3] = x / l; NR[h * 3 + 1] = y / l; NR[h * 3 + 2] = z / l; }
      if (UV) { UV[h * 2] = ply.uvs[v * 2]; UV[h * 2 + 1] = ply.uvs[v * 2 + 1]; }
      if (CO) {
        const src = ply.faceColors ? ply.faceColors : ply.colors;
        const at = ply.faceColors ? f : v;
        for (let c = 0; c < 4; c++) CO[h * 4 + c] = src[at * 4 + c];
        r += src[at * 4]; g += src[at * 4 + 1]; b2 += src[at * 4 + 2]; n++;
      }
    }
    if (CO && mf >= 0 && n) {
      const p = paintFromLinear(r / n, g / n, b2 / n);
      seen.add(p);
      mesh.fMat[mf] = mesh.paintIndex(p);
    }
  });
  report.colours = seen.size;
  markSharp(mesh, NR, null);
  const def = model.newMeshDef(mesh, String(name || 'PLY').slice(0, 120));
  model.place(top, def.id, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  report.faces = mesh.faceCount;
  report.vertices = mesh.vertexCount;
  return { def: top, report };
}

// ------------------------------------------------------------------------------------------------- export

/**
 * Every face of the model in world coordinates, as corner lists [{pos [3], nor [3], col [r, g, b] 0–255 sRGB | null (no
 * paint, no colour layer), uv | null}]: a mesh's own n-gons, push/pull faces as their outline (or triangles when they have
 * holes). { triangles: true } hands out triangles only (STL).
 */
export function worldFaces(model, each, { triangles = false } = {}) {
  model.walk((d, wm, path, pc) => {
    const mirror = det(wm) < 0;
    const P = (p) => [wm[0] * p[0] + wm[4] * p[1] + wm[8] * p[2] + wm[12], wm[1] * p[0] + wm[5] * p[1] + wm[9] * p[2] + wm[13], wm[2] * p[0] + wm[6] * p[1] + wm[10] * p[2] + wm[14]];
    const D = (n) => { const x = wm[0] * n[0] + wm[4] * n[1] + wm[8] * n[2]; const y = wm[1] * n[0] + wm[5] * n[1] + wm[9] * n[2]; const z = wm[2] * n[0] + wm[6] * n[1] + wm[10] * n[2]; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    const rgb = (paint) => { if (!paint) return null; const h = paintHex(paint); return [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)); };
    if (d.mesh) {
      const M = d.mesh;
      const NC = M.cornerNormals();
      const UV = M.attrArray('uv');
      const COL = M.attrArray('color');
      const corner = (h, base) => {
        const v = M.hV[h];
        const col = COL ? [0, 1, 2].map((k) => Math.round(linToSrgb(Math.min(1, Math.max(0, COL[h * 4 + k]))) * 255)) : base;
        return { pos: P([M.P[v * 3], M.P[v * 3 + 1], M.P[v * 3 + 2]]), nor: D([NC[h * 3], NC[h * 3 + 1], NC[h * 3 + 2]]), col, uv: UV ? [UV[h * 2], UV[h * 2 + 1]] : null };
      };
      if (triangles) {
        const { tri, face } = M.triangulate({ hidden: false });
        for (let k = 0; k < tri.length; k += 3) {
          const base = rgb(M.facePaint(face[k / 3]) || pc || null);
          const seq = mirror ? [tri[k], tri[k + 2], tri[k + 1]] : [tri[k], tri[k + 1], tri[k + 2]];
          each(seq.map((h) => corner(h, base)));
        }
      } else {
        const cs = [];
        for (let f = 0; f < M.nf; f++) {
          if (M.fFl[f] & 1) continue;
          cs.length = 0;
          M.faceCorners(f, cs);
          if (cs.length < 3) continue;
          const base = rgb(M.facePaint(f) || pc || null);
          each((mirror ? cs.slice().reverse() : cs).map((h) => corner(h, base)));
        }
      }
    } else {
      for (const [, f] of d.faces) {
        const loops = f.loops.length === 1 && !triangles ? [f.loops[0]] : null;
        const base = rgb(f.color || pc || null);
        const n = faceNormalOf(d, f);
        if (!n) continue;
        const pieces = loops || trisOf(d, f);
        for (let loop of pieces) {
          if (mirror) loop = loop.slice().reverse();
          each(loop.map((v) => ({ pos: P(d.verts.get(v)), nor: D(n), col: base, uv: null })));
        }
      }
    }
  });
}
const faceNormalOf = (d, f) => { const n = fN(d, f); return Math.hypot(n[0], n[1], n[2]) > 0 ? n : null; };
const trisOf = (d, f) => fT(d, f);

export function exportPly(model) {
  const verts = [];
  const keyOf = new Map();
  const faces = [];
  let anyUV = false;
  worldFaces(model, (corners) => {
    const ix = corners.map((c) => {
      if (c.uv) anyUV = true;
      const k = c.pos.join(',') + '|' + c.nor.map((x) => x.toFixed(5)).join(',') + '|' + (c.col ? c.col.join(',') : '') + (c.uv ? '|' + c.uv.join(',') : '');
      let i = keyOf.get(k);
      if (i === undefined) { i = verts.length; keyOf.set(k, i); verts.push(c); }
      return i;
    });
    faces.push(ix);
  });
  const wide = faces.some((f) => f.length > 255);   // a face of more than 255 corners needs a wider count
  // i18n-ignore-start: the PLY header, written into the file
  const head = ['ply', 'format binary_little_endian 1.0', 'comment ModelCraft PLY export, meters, Z up', 'element vertex ' + verts.length,   // i18n-ignore: written into the file
    'property float x', 'property float y', 'property float z', 'property float nx', 'property float ny', 'property float nz',
    'property uchar red', 'property uchar green', 'property uchar blue', 'property uchar alpha', ...(anyUV ? ['property float s', 'property float t'] : []),
    'element face ' + faces.length, 'property list ' + (wide ? 'int' : 'uchar') + ' int vertex_indices', 'end_header', ''].join('\n');
  // i18n-ignore-end
  const vsize = 28 + (anyUV ? 8 : 0);
  let fbytes = 0;
  for (const f of faces) fbytes += (wide ? 4 : 1) + 4 * f.length;
  const h = new TextEncoder().encode(head);
  const out = new Uint8Array(h.length + verts.length * vsize + fbytes);
  out.set(h);
  const dv = new DataView(out.buffer);
  let p = h.length;
  for (const v of verts) {
    dv.setFloat32(p, v.pos[0], true); dv.setFloat32(p + 4, v.pos[1], true); dv.setFloat32(p + 8, v.pos[2], true);
    dv.setFloat32(p + 12, v.nor[0], true); dv.setFloat32(p + 16, v.nor[1], true); dv.setFloat32(p + 20, v.nor[2], true);
    const col = v.col || [204, 204, 204];
    out[p + 24] = col[0]; out[p + 25] = col[1]; out[p + 26] = col[2]; out[p + 27] = 255;
    if (anyUV) { dv.setFloat32(p + 28, v.uv ? v.uv[0] : 0, true); dv.setFloat32(p + 32, v.uv ? v.uv[1] : 0, true); }
    p += vsize;
  }
  for (const f of faces) {
    if (wide) { dv.setInt32(p, f.length, true); p += 4; } else out[p++] = f.length;
    for (const v of f) { dv.setInt32(p, v, true); p += 4; }
  }
  return { bytes: out, report: { vertices: verts.length, faces: faces.length } };
}
