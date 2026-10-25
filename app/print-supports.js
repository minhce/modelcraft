/* SPDX-License-Identifier: Apache-2.0 */
/**
 * print-supports.js — the supports preview (0.7 LC.21 item 1, session print-07): which faces overhang past a set angle,
 * simple column or tree supports from them down to the bed (or to the model below), and about how much material the
 * supports take. A preview, not a slicer: a slicer decides the real supports. DOM-free; ModelCraft's alone.
 *
 *   supportPreview(mesh, opts) → {
 *     overhang: Uint32Array (triangles that need support), overhangArea (mm²),
 *     points (support points sampled under them), columns, branches, toModel (supports that land on the model),
 *     segs: Float64Array (6 per segment: x0 y0 z0 x1 y1 z1, mm) to draw, radii: Float64Array (one per segment, mm),
 *     volume (mm³, the estimate), bedZ, style, angle, spacing }
 *   mesh: a print3d.js printer mesh (mm, Z up; weld() it first). opts:
 *     angle    degrees from vertical that print without support (45, as print3d.js's overhang warning)
 *     spacing  mm between support points (3) — a square grid in plan, the same for every face, so neighbouring faces
 *              never double up
 *     style    'columns' (one straight column per point) | 'tree' (points nearby join a trunk; branches no flatter than
 *              `branch` degrees from vertical, 45)
 *     density  for columns: the share of the space under an overhang a slicer's support pattern fills (0.15)
 *     tip      for trees: a branch's radius in mm (0.6); a trunk carrying k branches has radius tip·√k (the same cross
 *              section as its branches together)
 *     bedZ     the bed's height (default: the lowest point of the mesh)
 *     maxPoints about this many support points at most (20 000): a larger overhang widens the grid; `spacing` in the
 *              result is the one used
 *
 * The estimate: columns = Σ spacing² · density · height; trees = Σ π r² · length over every branch and trunk. Faces lying on
 * the bed never need support. Rule 18: the sampling loop allocates nothing per point (typed arrays, grown in place).
 */
import { triMesh, rayNearest } from './print-geom.js';

export function supportPreview(mesh, { angle = 45, spacing = 3, style = 'columns', density = 0.15, tip = 0.6, branch = 45, bedZ = null, maxPoints = 20000, T = null } = {}) {
  T ||= triMesh(mesh);
  const { P, I, nt, N, A } = T;
  const zBed = bedZ ?? (nt ? T.lo[2] : 0);
  const cosLimit = Math.cos((90 - angle) * Math.PI / 180);
  const zTol = Math.max(1e-3, 1e-6 * Math.max(...T.size, 1));
  const over = [];
  let overhangArea = 0;
  for (let t = 0; t < nt; t++) {
    const nz = N[t * 3 + 2];
    if (!(nz < -cosLimit) || !A[t]) continue;
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    if (Math.abs(P[a + 2] - zBed) <= zTol && Math.abs(P[b + 2] - zBed) <= zTol && Math.abs(P[c + 2] - zBed) <= zTol) continue;   // on the bed
    over.push(t);
    overhangArea += A[t];
  }
  // support points: a plan grid at (i + ½)·spacing (nudged by a millionth, so a grid point never sits exactly on an edge
  // two triangles share and is counted twice), kept where it falls inside an overhanging triangle's plan
  const OX = 0.5 + 1.234567e-6, OY = 0.5 + 2.345671e-6;
  let pts = new Float64Array(3 * 256), np = 0;
  // a laptop's limit (rule 19): about maxPoints points; a bigger overhang gets a wider grid (the result says which)
  const s = Math.max(spacing, Math.sqrt(overhangArea / maxPoints));
  for (const t of over) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ax = P[a], ay = P[a + 1], bx = P[b], by = P[b + 1], cx = P[c], cy = P[c + 1];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;   // seen edge-on from above
    const i0 = Math.ceil(Math.min(ax, bx, cx) / s - OX), i1 = Math.floor(Math.max(ax, bx, cx) / s - OX);
    const j0 = Math.ceil(Math.min(ay, by, cy) / s - OY), j1 = Math.floor(Math.max(ay, by, cy) / s - OY);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = (i + OX) * s, y = (j + OY) * s;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      if (np * 3 + 3 > pts.length) { const g = new Float64Array(pts.length * 2); g.set(pts); pts = g; }
      pts[np * 3] = x; pts[np * 3 + 1] = y; pts[np * 3 + 2] = l1 * P[a + 2] + l2 * P[b + 2] + l3 * P[c + 2];
      np++;
    }
  }
  // where a straight line down from each point lands: the bed, or the first surface below it
  const bottom = new Float64Array(np), onModel = new Uint8Array(np), hit = { tri: -1, back: 0 };
  const eps = Math.max(1e-4, zTol);
  for (let k = 0; k < np; k++) {
    const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
    const d = rayNearest(T, x, y, z - eps, 0, 0, -1, 0, Math.max(0, z - eps - zBed), -1, hit);
    if (d >= 0) { bottom[k] = z - eps - d; onModel[k] = 1; } else bottom[k] = zBed;
  }
  const segs = [], radii = [];
  let volume = 0, columns = 0, branches = 0, toModel = 0;
  const column = (k) => {
    const h = pts[k * 3 + 2] - bottom[k];
    if (h <= eps) return;
    segs.push(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], pts[k * 3], pts[k * 3 + 1], bottom[k]);
    radii.push(style === 'tree' ? tip : s * Math.sqrt(density / Math.PI));
    volume += style === 'tree' ? Math.PI * tip * tip * h : s * s * density * h;
    columns++;
    if (onModel[k]) toModel++;
  };
  if (style !== 'tree') for (let k = 0; k < np; k++) column(k);
  else {
    // trees: points in the same 4 × spacing plan cell join one trunk under their middle
    const cell = 4 * s, groups = new Map();
    for (let k = 0; k < np; k++) {
      if (pts[k * 3 + 2] - bottom[k] <= eps) continue;
      const key = Math.floor(pts[k * 3] / cell) + ',' + Math.floor(pts[k * 3 + 1] / cell);
      const g = groups.get(key);
      if (g) g.push(k); else groups.set(key, [k]);
    }
    const tanB = Math.tan(branch * Math.PI / 180);
    for (const g of groups.values()) {
      if (g.length < 2) { column(g[0]); continue; }
      let mx = 0, my = 0;
      for (const k of g) { mx += pts[k * 3]; my += pts[k * 3 + 1]; }
      mx /= g.length; my /= g.length;
      // the joint: low enough that every branch is no flatter than `branch` from vertical
      let jz = Infinity;
      for (const k of g) jz = Math.min(jz, pts[k * 3 + 2] - Math.hypot(pts[k * 3] - mx, pts[k * 3 + 1] - my) / tanB);
      // the trunk lands where a line down from the joint does; it must start outside the model
      const dj = rayNearest(T, mx, my, jz, 0, 0, -1, 0, Math.max(0, jz - zBed), -1, hit);
      const trunkInside = dj >= 0 && hit.back;
      const jb = dj >= 0 ? jz - dj : zBed;
      const joined = [];
      for (const k of g) {
        const px = pts[k * 3], py = pts[k * 3 + 1], pz = pts[k * 3 + 2];
        if (trunkInside || jz <= bottom[k] + eps || jz <= zBed + eps) { column(k); continue; }
        // a branch through the model is no branch: that point gets its own column
        const dx = mx - px, dy = my - py, dz = jz - (pz - eps), L = Math.hypot(dx, dy, dz);
        if (L > eps && rayNearest(T, px, py, pz - eps, dx / L, dy / L, dz / L, 0, L, -1, null) >= 0) { column(k); continue; }
        joined.push(k);
      }
      if (joined.length < 2) { for (const k of joined) column(k); continue; }
      for (const k of joined) {
        const px = pts[k * 3], py = pts[k * 3 + 1], pz = pts[k * 3 + 2];
        segs.push(px, py, pz, mx, my, jz);
        radii.push(tip);
        volume += Math.PI * tip * tip * Math.hypot(mx - px, my - py, jz - pz);
        branches++;
      }
      const r = tip * Math.sqrt(joined.length);
      segs.push(mx, my, jz, mx, my, jb);
      radii.push(r);
      volume += Math.PI * r * r * (jz - jb);
      columns++;
      if (dj >= 0) toModel++;
    }
  }
  return {
    overhang: Uint32Array.from(over), overhangArea, points: np, columns, branches, toModel,
    segs: Float64Array.from(segs), radii: Float64Array.from(radii), volume, bedZ: zBed, style: style === 'tree' ? 'tree' : 'columns', angle, spacing: s,
  };
}
