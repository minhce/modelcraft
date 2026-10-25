/* SPDX-License-Identifier: Apache-2.0 */
/**
 * print-walls.js — the wall-thickness check (0.7 LC.21 item 3, session print-07): which parts of a model are thinner
 * than a printer can make, found by rays on the mesh. DOM-free; ModelCraft's alone; print-ui.js colours the result.
 *
 *   wallThickness(mesh, opts) → {
 *     values: Float32Array (one per triangle, mm: how far a ray straight in from the triangle's middle travels before it
 *             leaves the solid; Infinity = not found: the ray met a face the wrong way round or nothing at all),
 *     measured: Uint8Array (1 = this triangle's own ray; 0 = took the value of the nearest measured neighbour),
 *     rays, decimated (true when rays < triangles), min (the given limit), thinnest (mm, Infinity when nothing measured),
 *     thin: Uint32Array (triangles under `min`), thinArea (mm²),
 *     regions: [{tris: [t], area (mm²), thinnest (mm), at: [x, y, z] (the middle of its thinnest triangle), lo, hi}]
 *              thin triangles joined by their edges, thinnest first, at most 50 }
 *   mesh: a print3d.js printer mesh (mm, Z up; weld() it first). opts:
 *     min      the thinnest wall to allow, mm (0.8: two lines of a 0.4 mm nozzle)
 *     maxRays  at most this many rays (20 000; rule 19, a laptop): on a bigger mesh every k-th triangle casts one and the
 *              others take their nearest measured neighbour's value across shared edges (the result says so)
 *
 * A ray starts a hair inside the face and runs along the inward normal; the first face it meets from behind is the far
 * side of the wall. Allocation-free per ray (print-geom.js).
 */
import { triMesh, rayNearest } from './print-geom.js';

export function wallThickness(mesh, { min = 0.8, maxRays = 20000, T = null } = {}) {
  T ||= triMesh(mesh);
  const { P, I, nt, N, A } = T;
  const values = new Float32Array(nt).fill(Infinity), measured = new Uint8Array(nt);
  const step = Math.max(1, Math.ceil(nt / Math.max(1, maxRays)));
  const eps = Math.max(1e-5, 1e-7 * Math.max(...T.size, 1));
  const hit = { tri: -1, back: 0 };
  const far = 2 * Math.hypot(...T.size) + 1;
  let rays = 0;
  for (let t = 0; t < nt; t += step) {
    if (!A[t]) continue;
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const nx = N[t * 3], ny = N[t * 3 + 1], nz = N[t * 3 + 2];
    const ox = (P[a] + P[b] + P[c]) / 3 - nx * eps, oy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - ny * eps, oz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - nz * eps;
    const d = rayNearest(T, ox, oy, oz, -nx, -ny, -nz, 0, far, t, hit);
    rays++;
    measured[t] = 1;
    if (d >= 0 && hit.back) values[t] = d + eps;
  }
  // decimated: the rest take the nearest measured neighbour's value, spreading across shared edges
  if (step > 1) {
    const nv = P.length / 3, edges = new Map(), nbr = Array.from({ length: nt }, () => []);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const u = I[t * 3 + k], v = I[t * 3 + (k + 1) % 3], key = u < v ? u * nv + v : v * nv + u;
      const o = edges.get(key);
      if (o === undefined) edges.set(key, t); else { nbr[t].push(o); nbr[o].push(t); }
    }
    const queue = [], seen = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) if (measured[t]) { queue.push(t); seen[t] = 1; }
    for (let q = 0; q < queue.length; q++) {
      const t = queue[q];
      for (const o of nbr[t]) if (!seen[o]) { seen[o] = 1; values[o] = values[t]; queue.push(o); }
    }
  }
  let thinnest = Infinity, thinArea = 0;
  const thin = [];
  for (let t = 0; t < nt; t++) {
    if (values[t] < thinnest) thinnest = values[t];
    if (values[t] < min) { thin.push(t); thinArea += A[t]; }
  }
  return { values, measured, rays, decimated: step > 1, min, thinnest, thin: Uint32Array.from(thin), thinArea, regions: regionsOf(T, thin, values) };
}

/** Thin triangles joined by shared edges → regions, thinnest first (≤ 50). */
function regionsOf(T, thin, values) {
  const { P, I, A } = T, nv = P.length / 3, isThin = new Set(thin), byEdge = new Map();
  for (const t of thin) for (let k = 0; k < 3; k++) {
    const u = I[t * 3 + k], v = I[t * 3 + (k + 1) % 3], key = u < v ? u * nv + v : v * nv + u;
    const l = byEdge.get(key);
    if (l) l.push(t); else byEdge.set(key, [t]);
  }
  const seen = new Set(), out = [];
  for (const s of thin) {
    if (seen.has(s)) continue;
    seen.add(s);
    const tris = [s], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let area = 0, best = s;
    for (let q = 0; q < tris.length; q++) {
      const t = tris[q];
      area += A[t];
      if (values[t] < values[best]) best = t;
      for (let k = 0; k < 3; k++) {
        const v = I[t * 3 + k];
        for (let j = 0; j < 3; j++) { const x = P[v * 3 + j]; if (x < lo[j]) lo[j] = x; if (x > hi[j]) hi[j] = x; }
        const u = I[t * 3 + (k + 1) % 3], key = v < u ? v * nv + u : u * nv + v;
        for (const o of byEdge.get(key) || []) if (isThin.has(o) && !seen.has(o)) { seen.add(o); tris.push(o); }
      }
    }
    const a = I[best * 3] * 3, b = I[best * 3 + 1] * 3, c = I[best * 3 + 2] * 3;
    out.push({ tris, area, thinnest: values[best], at: [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3], lo, hi });
  }
  out.sort((x, y) => x.thinnest - y.thinnest || y.area - x.area);
  return out.slice(0, 50);
}
