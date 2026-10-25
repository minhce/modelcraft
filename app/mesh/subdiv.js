/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/subdiv.js — Catmull-Clark subdivision surfaces for ModelCraft's meshes (0.7 MD.4; used by the Subdivision modifier,
 * MD.3). DOM-free, our own, from the published algorithm: E. Catmull and J. Clark, "Recursively generated B-spline
 * surfaces on arbitrary topological meshes", Computer-Aided Design 10(6), 1978; boundary and crease rules after T. DeRose,
 * M. Kass and T. Truong, "Subdivision Surfaces in Character Animation", SIGGRAPH 1998 (sharp and semi-sharp creases);
 * limit positions after J. Stam's eigen-analysis summary of the same scheme (the standard "limit mask"). No code from any
 * subdivision library was read (the reference library's licence is a modified Apache: not read, 0.7 rule 20).
 *
 *   subdivide(mesh, levels = 1) → Mesh        every n-gon → n quads per level; corner layers (UVs …) and vertex layers
 *                                             interpolated linearly, paint and hidden flags kept, sharp (shading) edges kept
 *   limitPositions(mesh) → Float64Array      where each vertex of an all-quad mesh would lie on the limit surface
 *   creaseOf(mesh, h)                        the edge's sharpness: 1 for an open edge; the 'crease' layer (0…1) × 4
 *
 * Rules, per level: a face point is its corners' average; an edge point is the average of its ends and its two face
 * points, or its midpoint on an open or sharp edge (sharpness ≥ 1; between 0 and 1 the two are blended); a vertex moves to
 * (F + 2R + (n − 3)V) / n (F the faces' points, R the edges' midpoints, n its edges), along a crease or open border to
 * (6V + a + b) / 8, and stays at a corner (three sharp edges or more, or a border vertex with two edges). Sharpness goes down
 * by one per level, so a semi-sharp crease rounds off over a few levels.
 */
import { Mesh, FL_SHARP, FL_HIDE, FL_DEAD } from '../mesh.js';

export const SHARP_SCALE = 4;   // a 'crease' of 1 = sharpness 4: sharp for four levels, as content tools show it
/** The sharpness of edge h (either half): 1 on an open edge, else the 'crease' layer × SHARP_SCALE (0 when there is none). */
export function creaseOf(m, h, crease = m.attrArray('crease')) {
  if (m.hTw[h] < 0) return Infinity;
  return crease ? crease[h] * SHARP_SCALE : 0;
}

/** One level: → {mesh, sharp: Float32Array of the new edges' sharpness by half-edge}. `sharp` in: by half-edge of `m` (or from its layers). */
function step(m, sharpIn) {
  const P = m.P, hV = m.hV, nx = m.hNx, tw = m.hTw, hF = m.hF;
  const nv = m.nv, nf = m.nf, nh = m.nh;
  const S = sharpIn || (() => { const a = new Float32Array(nh), c = m.attrArray('crease'); for (let h = 0; h < nh; h++) a[h] = creaseOf(m, h, c); return a; })();
  // numbering: old vertices keep 0…nv−1, then one point per edge (canonical half-edge), then one per face
  const eIdx = new Int32Array(nh).fill(-1);
  let ne = 0;
  for (let h = 0; h < nh; h++) { if (m.heDead(h)) continue; const k = m.edgeOf(h); if (eIdx[k] < 0) eIdx[k] = ne++; eIdx[h] = eIdx[k]; }
  const fIdx = new Int32Array(nf).fill(-1);
  let nfl = 0;
  for (let f = 0; f < nf; f++) if (!m.faceDead(f)) fIdx[f] = nfl++;
  const total = nv + ne + nfl, out = new Float64Array(total * 3);
  // face points
  const FP = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    if (fIdx[f] < 0) continue;
    let x = 0, y = 0, z = 0, n = 0, h = m.fHe[f];
    const h0 = h;
    do { const v = hV[h] * 3; x += P[v]; y += P[v + 1]; z += P[v + 2]; n++; h = nx[h]; } while (h !== h0 && n < 1e6);
    FP[f * 3] = x / n; FP[f * 3 + 1] = y / n; FP[f * 3 + 2] = z / n;
    const o = (nv + ne + fIdx[f]) * 3;
    out[o] = FP[f * 3]; out[o + 1] = FP[f * 3 + 1]; out[o + 2] = FP[f * 3 + 2];
  }
  // edge points
  for (let h = 0; h < nh; h++) {
    if (m.heDead(h) || m.edgeOf(h) !== h) continue;
    const a = hV[h] * 3, b = m.head(h) * 3, t = tw[h], o = (nv + eIdx[h]) * 3;
    const mx = (P[a] + P[b]) / 2, my = (P[a + 1] + P[b + 1]) / 2, mz = (P[a + 2] + P[b + 2]) / 2;
    const s = S[h];
    if (t < 0 || s >= 1) { out[o] = mx; out[o + 1] = my; out[o + 2] = mz; continue; }
    const f1 = hF[h] * 3, f2 = hF[t] * 3;
    const sx = (P[a] + P[b] + FP[f1] + FP[f2]) / 4, sy = (P[a + 1] + P[b + 1] + FP[f1 + 1] + FP[f2 + 1]) / 4, sz = (P[a + 2] + P[b + 2] + FP[f1 + 2] + FP[f2 + 2]) / 4;
    out[o] = sx + (mx - sx) * s; out[o + 1] = sy + (my - sy) * s; out[o + 2] = sz + (mz - sz) * s;
  }
  // vertex points
  for (let v = 0; v < nv; v++) {
    const o = v * 3;
    if (m.vertDead(v)) continue;
    out[o] = P[o]; out[o + 1] = P[o + 1]; out[o + 2] = P[o + 2];
    const ring = m.outgoing(v);
    if (!ring.length) continue;
    const border = tw[ring[ring.length - 1]] < 0;
    // the edges round v: outgoing half-edges, and for a border vertex the incoming open edge too
    const edges = ring.map((h) => ({ h, w: m.head(h), s: S[h] }));
    if (border) { const p = m.hPv[ring[0]]; edges.push({ h: p, w: hV[p], s: S[p] }); }
    const sharpE = edges.filter((e) => e.s > 0);
    const n = edges.length;
    // smooth position
    let fx = 0, fy = 0, fz = 0;
    for (const h of ring) { const f = hF[h] * 3; fx += FP[f]; fy += FP[f + 1]; fz += FP[f + 2]; }
    fx /= ring.length; fy /= ring.length; fz /= ring.length;
    let rx = 0, ry = 0, rz = 0;
    for (const e of edges) { const w = e.w * 3; rx += (P[o] + P[w]) / 2; ry += (P[o + 1] + P[w + 1]) / 2; rz += (P[o + 2] + P[w + 2]) / 2; }
    rx /= n; ry /= n; rz /= n;
    const smooth = [(fx + 2 * rx + (n - 3) * P[o]) / n, (fy + 2 * ry + (n - 3) * P[o + 1]) / n, (fz + 2 * rz + (n - 3) * P[o + 2]) / n];
    const hard = sharpE.filter((e) => e.s >= 1).length, soft = sharpE.length;
    let res = smooth;
    if (soft >= 3 || (border && n === 2)) res = [P[o], P[o + 1], P[o + 2]];   // a corner stays
    else if (soft === 2) {
      // along a crease or the border: the curve rule, blended in by the creases' average sharpness (borders count as sharp)
      const [a, b] = sharpE, A = a.w * 3, B = b.w * 3;
      const crease = [(6 * P[o] + P[A] + P[B]) / 8, (6 * P[o + 1] + P[A + 1] + P[B + 1]) / 8, (6 * P[o + 2] + P[A + 2] + P[B + 2]) / 8];
      const k = Math.min(1, (Math.min(a.s, 1e9) + Math.min(b.s, 1e9)) / 2);
      res = hard === 2 || k >= 1 ? crease : smooth.map((x, i) => x + (crease[i] - x) * k);
    }
    out[o] = res[0]; out[o + 1] = res[1]; out[o + 2] = res[2];
  }
  // topology: each face corner i → quad (v_i, e_i, f, e_{i−1}); the new edges' sharpness: halves of an old edge get s − 1
  const fc = new Int32Array(nh), fi = new Int32Array(nh * 4), cornerSrc = new Int32Array(nh * 4), faceSrc = new Int32Array(nh);
  let q = 0;
  for (let f = 0; f < nf; f++) {
    if (fIdx[f] < 0) continue;
    const h0 = m.fHe[f];
    let h = h0, g = 0;
    do {
      const p = m.hPv[h];
      fi[q * 4] = hV[h]; fi[q * 4 + 1] = nv + eIdx[h]; fi[q * 4 + 2] = nv + ne + fIdx[f]; fi[q * 4 + 3] = nv + eIdx[p];
      cornerSrc[q * 4] = h; cornerSrc[q * 4 + 1] = h; cornerSrc[q * 4 + 2] = h; cornerSrc[q * 4 + 3] = h;
      fc[q] = 4; faceSrc[q] = f; q++;
      h = nx[h];
    } while (h !== h0 && ++g < 1e6);
  }
  const r = new Mesh();
  const keep = r._bulk(out, total, fc.subarray(0, q), fi.subarray(0, q * 4));
  // flags, paint, layers
  r.paints = m.paints.slice();
  const cornerL = [...m.attrs.values()].filter((L) => L.domain === 'corner'), vertL = [...m.attrs.values()].filter((L) => L.domain === 'vertex'), faceL = [...m.attrs.values()].filter((L) => L.domain === 'face');
  for (const L of [...cornerL, ...vertL, ...faceL]) r.addAttr(L.name, L.domain, L.size, L.type);
  const ownCrease = m.attrArray('crease');
  if (ownCrease) r.addAttr('crease', 'edge', 1);
  const sharpOut = new Float32Array(r.nh);
  for (let k = 0; k < q; k++) {
    const nf2 = keep.faceOf[k];
    if (nf2 < 0) continue;
    const f = faceSrc[k], h = cornerSrc[k * 4], p = m.hPv[h], nxh = nx[h];
    r.fMat[nf2] = m.fMat[f];
    if (m.fFl[f] & FL_HIDE) r.fFl[nf2] |= FL_HIDE;
    for (const L of faceL) { const a = r.attrArray(L.name); for (let j = 0; j < L.size; j++) a[nf2 * L.size + j] = L.col.a[f * L.size + j]; }
    // corners: v_i = h's own value, e_i = mean(h, next), face = mean of the face, e_{i−1} = mean(prev, h)
    const cs = m.faceCorners(f, []);
    for (const L of cornerL) {
      const A = r.attrArray(L.name), s = L.size, src = L.col.a;
      for (let j = 0; j < s; j++) {
        let fm = 0; for (const c of cs) fm += src[c * s + j]; fm /= cs.length;
        const vals = [src[h * s + j], (src[h * s + j] + src[nxh * s + j]) / 2, fm, (src[p * s + j] + src[h * s + j]) / 2];
        for (let c = 0; c < 4; c++) A[keep.cornerOf[k * 4 + c] * s + j] = vals[c];
      }
    }
    // the edges along old edges: v_i → e_i lies on edge h, e_{i−1} → v_i on edge p
    const c0 = keep.cornerOf[k * 4], c3 = keep.cornerOf[k * 4 + 3];
    const sh = Math.max(0, S[h] - 1), sp = Math.max(0, S[p] - 1);
    if (c0 >= 0) { sharpOut[c0] = r.hTw[c0] < 0 ? Infinity : sh; if (m.hFl[h] & FL_SHARP) r.hFl[c0] |= FL_SHARP; }
    if (c3 >= 0) { sharpOut[c3] = r.hTw[c3] < 0 ? Infinity : sp; if (m.hFl[p] & FL_SHARP) r.hFl[c3] |= FL_SHARP; }
  }
  // twins agree (each half was set from its own face); the crease layer shows what is left
  for (let h = 0; h < r.nh; h++) {
    const t = r.hTw[h];
    if (t < 0) continue;
    const s = Math.max(sharpOut[h], sharpOut[t]);
    sharpOut[h] = s; sharpOut[t] = s;
    if (r.hFl[h] & FL_SHARP || r.hFl[t] & FL_SHARP) { r.hFl[h] |= FL_SHARP; r.hFl[t] |= FL_SHARP; }
    if (ownCrease) r.attrArray('crease')[h] = Math.min(1, s / SHARP_SCALE);
  }
  // vertex layers: old vertices keep theirs, edge points the mean of the ends, face points the mean of the face
  for (const L of vertL) {
    const A = r.attrArray(L.name), src = L.col.a, s = L.size;
    for (let v = 0; v < nv; v++) for (let j = 0; j < s; j++) A[v * s + j] = src[v * s + j];
    for (let h = 0; h < nh; h++) { if (m.heDead(h) || m.edgeOf(h) !== h) continue; const a = hV[h], b = m.head(h), e = nv + eIdx[h]; for (let j = 0; j < s; j++) A[e * s + j] = (src[a * s + j] + src[b * s + j]) / 2; }
    for (let f = 0; f < nf; f++) { if (fIdx[f] < 0) continue; const vs = m.faceVerts(f, []), e = nv + ne + fIdx[f]; for (let j = 0; j < s; j++) { let x = 0; for (const v of vs) x += src[v * s + j]; A[e * s + j] = x / vs.length; } }
    for (let i = 0; i < keep.vertFrom.length; i++) for (let j = 0; j < s; j++) A[(total + i) * s + j] = A[keep.vertFrom[i] * s + j];
  }
  return { mesh: r, sharp: sharpOut };
}

/** Catmull-Clark `levels` times (0 = a copy). */
export function subdivide(m, levels = 1) {
  let cur = m, sharp = null;
  const n = Math.max(0, Math.min(8, Math.round(levels)));
  if (!n) return m.clone();
  for (let i = 0; i < n; i++) { const r = step(cur, sharp); cur = r.mesh; sharp = r.sharp; }
  return cur;
}
/**
 * Where each vertex of a subdivided (all-quad) mesh lies on the limit surface. Interior, smooth: (n²V + 4ΣE + ΣF) / (n(n + 5))
 * with E its edge neighbours and F the far corners of its faces; on a crease or border: (4V + a + b) / 6; a corner stays.
 */
export function limitPositions(m) {
  const P = m.P, out = new Float64Array(m.nv * 3), crease = m.attrArray('crease');
  for (let v = 0; v < m.nv; v++) {
    const o = v * 3;
    out[o] = P[o]; out[o + 1] = P[o + 1]; out[o + 2] = P[o + 2];
    if (m.vertDead(v) || m.vHe[v] < 0) continue;
    const ring = m.outgoing(v), border = m.hTw[ring[ring.length - 1]] < 0;
    const edges = ring.map((h) => ({ w: m.head(h), s: creaseOf(m, h, crease) }));
    if (border) { const p = m.hPv[ring[0]]; edges.push({ w: m.hV[p], s: Infinity }); }
    const sharp = edges.filter((e) => e.s >= 1);
    if (sharp.length >= 3 || (border && edges.length === 2)) continue;
    if (sharp.length === 2) {
      const A = sharp[0].w * 3, B = sharp[1].w * 3;
      for (let k = 0; k < 3; k++) out[o + k] = (4 * P[o + k] + P[A + k] + P[B + k]) / 6;
      continue;
    }
    if (ring.some((h) => m.faceSize(m.hF[h]) !== 4)) continue;   // only all-quad neighbourhoods (after one level every one is)
    const n = ring.length;
    let e = [0, 0, 0], f = [0, 0, 0];
    for (const h of ring) {
      const w = m.head(h) * 3, far = m.hV[m.hNx[m.hNx[h]]] * 3;
      for (let k = 0; k < 3; k++) { e[k] += P[w + k]; f[k] += P[far + k]; }
    }
    for (let k = 0; k < 3; k++) out[o + k] = (n * n * P[o + k] + 4 * e[k] + f[k]) / (n * (n + 5));
  }
  return out;
}
void FL_DEAD;
