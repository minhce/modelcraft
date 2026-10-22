/* SPDX-License-Identifier: Apache-2.0 */
/**
 * terrain.js — terrain for ModelCraft (0.4 M24, SketchUp Sandbox). DOM-free: bin/test-modelcraft.mjs runs it.
 *
 *   delaunay(pts) → [[i, j, k]…] counter-clockwise triangles over 2D points (Bowyer–Watson; duplicates dropped)
 *   terrainFromContours(model, def, eids, {name}) → a new group definition: the edges' points (at their heights)
 *        triangulated in plan, every inner edge soft so the ground shades smooth. Points closer than 1 cm in plan are
 *        merged; at most 8 000 points (contours are thinned evenly above that: about a second to triangulate).
 *   terrainGrid(model, {width, depth, spacing, origin, name}) → a flat grid of triangles to sculpt (Sculpt tool),
 *        width × depth from `origin`, cells of about `spacing` (at most 200 × 200 cells).
 * Both return the definition; the caller places it (inside model.change).
 */
import { meshDef, edgeFaces } from './model.js';

export function delaunay(pts) {
  const n = pts.length;
  if (n < 3) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const d = Math.max(x1 - x0, y1 - y0) || 1, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const P = pts.concat([[cx - 20 * d, cy - d], [cx, cy + 20 * d], [cx + 20 * d, cy - d]]);
  const circ = (a, b, c) => {
    const [ax, ay] = P[a], [bx, by] = P[b], [qx, qy] = P[c];
    const D = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
    if (Math.abs(D) < 1e-18) return { x: 0, y: 0, r2: Infinity };
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = qx * qx + qy * qy;
    const x = (a2 * (by - qy) + b2 * (qy - ay) + c2 * (ay - by)) / D, y = (a2 * (qx - bx) + b2 * (ax - qx) + c2 * (bx - ax)) / D;
    return { x, y, r2: (ax - x) ** 2 + (ay - y) ** 2 };
  };
  let tris = [{ v: [n, n + 1, n + 2], c: circ(n, n + 1, n + 2) }];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i];
    const bad = [], keep = [];
    for (const tr of tris) ((px - tr.c.x) ** 2 + (py - tr.c.y) ** 2 < tr.c.r2 * (1 - 1e-12) ? bad : keep).push(tr);
    // the hole's rim: edges of the bad triangles that only one of them has
    const count = new Map();
    for (const tr of bad) for (let k = 0; k < 3; k++) { const a = tr.v[k], b = tr.v[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; count.set(key, (count.get(key) || 0) + 1); }
    tris = keep;
    for (const tr of bad) for (let k = 0; k < 3; k++) {
      const a = tr.v[k], b = tr.v[(k + 1) % 3];
      if (count.get(a < b ? a + ',' + b : b + ',' + a) === 1) tris.push({ v: [a, b, i], c: circ(a, b, i) });
    }
  }
  const out = [];
  for (const { v } of tris) {
    if (v.some((k) => k >= n)) continue;
    const [a, b, c] = v, [ax, ay] = P[a], [bx, by] = P[b], [qx, qy] = P[c];
    const cr = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    if (Math.abs(cr) < 1e-14) continue;
    out.push(cr > 0 ? [a, b, c] : [a, c, b]);
  }
  return out;
}

/** Soften every edge between two faces (the inside of a terrain). */
function softInside(def) {
  const ef = edgeFaces(def);
  for (const e of def.edges.values()) if ((ef.get(e.a < e.b ? e.a + '|' + e.b : e.b + '|' + e.a) || []).length === 2) e.soft = true;
}

export function terrainFromContours(model, def, eids, { name = 'Terrain' } = {}) {   // i18n-ignore: a fallback name
  const seen = new Map();
  for (const eid of eids) {
    const e = def.edges.get(eid);
    if (!e) continue;
    for (const v of [e.a, e.b]) {
      const p = def.verts.get(v), k = Math.round(p[0] * 100) + ',' + Math.round(p[1] * 100);
      if (!seen.has(k)) seen.set(k, p);
    }
  }
  let pts = [...seen.values()];
  if (pts.length > 8000) { const step = pts.length / 8000; pts = Array.from({ length: 8000 }, (_, i) => pts[Math.floor(i * step)]); }
  const tris = delaunay(pts.map((p) => [p[0], p[1]]));
  if (!tris.length) return null;
  const d = meshDef(model, tris.map((tr) => tr.map((i) => pts[i].slice())), model.uniqueName(name), 'group');
  softInside(d);
  return d;
}

export function terrainGrid(model, { width = 20, depth = 20, spacing = 1, origin = [0, 0, 0], name = 'Terrain' } = {}) {   // i18n-ignore: a fallback name
  const nx = Math.max(1, Math.min(200, Math.round(width / spacing))), ny = Math.max(1, Math.min(200, Math.round(depth / spacing)));
  const P = (i, j) => [origin[0] + (width * i) / nx, origin[1] + (depth * j) / ny, origin[2]];
  const polys = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    // alternate the diagonals, so slopes sculpted later have no grain
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), e = P(i, j + 1);
    if ((i + j) % 2) { polys.push([a, b, c], [a, c, e]); } else { polys.push([a, b, e], [b, c, e]); }
  }
  const d = meshDef(model, polys, model.uniqueName(name), 'group');
  // meshDef merges nothing; flat triangles stay separate faces (each one moves on its own when sculpted)
  softInside(d);
  return d;
}
