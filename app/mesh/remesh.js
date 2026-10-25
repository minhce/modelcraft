/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/remesh.js — voxel remesh and retopology helpers (0.7 MD.8), DOM-free.
 *
 * Voxel remesh: the mesh's signed distance sampled on a grid of half the voxel size — exact distances to the nearest
 * triangle in a band two voxels wide round the surface, the sign by counting crossings along each grid row (a ray along
 * +x) — then manifold-3d's level set (marching tetrahedra on a body-centred grid) makes a closed, even mesh of about the
 * voxel's size. Inside is where the winding count is above zero (each crossing counted +1 entering a face, −1 leaving
 * it), so overlapping pieces join. Positive inside, as manifold wants. Works best on closed meshes; an open one is closed
 * where its holes are.
 *
 *   voxelRemesh(M, mesh, {voxel}) → {mesh, notes}       M = the manifold-3d module (solids.js manifold())
 *   sdfGrid(mesh, {voxel}) → {min, g, nx, ny, nz, d}    the samples (for tests)
 *
 * Retopology: a surface to build a new, cleaner mesh on — points moved in the Mesh workspace land on it.
 *   surfaceNear(tris) → near(p) → {q, d} | null          (mesh/modifiers.js nearestOnTris)
 *   projectVerts(mesh, verts, near) → n                    the vertices put on the surface
 */
import { Mesh } from '../mesh.js';
import { BoxTree } from '../bvh.js';
import { nearestOnTris } from './modifiers.js';

/** The triangles of a mesh as positions + indices (hidden faces too). */
function trisOf(m) {
  const T = m.triangulate({ hidden: true }), tri = new Uint32Array(T.n * 3);
  for (let i = 0; i < T.n * 3; i++) tri[i] = m.hV[T.tri[i]];
  return { pos: m.P.subarray(0, m.nv * 3), tri, n: T.n };
}
/** Squared distance from p to triangle abc (Ericson's closest point, 5.1.5). */
function dist2Tri(px, py, pz, P, a, b, c) {
  const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
  const abx = P[b * 3] - ax, aby = P[b * 3 + 1] - ay, abz = P[b * 3 + 2] - az, acx = P[c * 3] - ax, acy = P[c * 3 + 1] - ay, acz = P[c * 3 + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  const at = (s, t) => { qx = ax + abx * s + acx * t; qy = ay + aby * s + acy * t; qz = az + abz * s + acz * t; };
  if (d1 <= 0 && d2 <= 0) at(0, 0);
  else {
    const bpx = px - P[b * 3], bpy = py - P[b * 3 + 1], bpz = pz - P[b * 3 + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) at(1, 0);
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) at(d1 / (d1 - d3), 0);
      else {
        const cpx = px - P[c * 3], cpy = py - P[c * 3 + 1], cpz = pz - P[c * 3 + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) at(0, 1);
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) at(0, d2 / (d2 - d6));
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); at(1 - w, w); }
            else { const den = 1 / (va + vb + vc); at(vb * den, vc * den); }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

/** The signed distance on a grid of spacing voxel / 2 round the mesh (two voxels of room each side). */
export function sdfGrid(m, { voxel }) {
  const { pos: P, tri, n } = trisOf(m), b = m.bounds();
  if (!b || !n) return null;
  const g = voxel / 2, pad = 2 * voxel;
  const min = [b.min[0] - pad, b.min[1] - pad, b.min[2] - pad];
  const nx = Math.ceil((b.max[0] - b.min[0] + 2 * pad) / g) + 1, ny = Math.ceil((b.max[1] - b.min[1] + 2 * pad) / g) + 1, nz = Math.ceil((b.max[2] - b.min[2] + 2 * pad) / g) + 1;
  if (nx * ny * nz > 24e6) throw new Error('grid');
  const band = 2 * voxel, far = band * band;
  const d = new Float32Array(nx * ny * nz).fill(far);
  const at = (i, j, k) => (k * ny + j) * nx + i;
  // the band: each triangle against the grid points in its box grown by the band
  for (let t = 0; t < n; t++) {
    const a = tri[t * 3], bb = tri[t * 3 + 1], c = tri[t * 3 + 2];
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of [a, bb, c]) for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], P[v * 3 + q]); hi[q] = Math.max(hi[q], P[v * 3 + q]); }
    const i0 = Math.max(0, Math.floor((lo[0] - band - min[0]) / g)), i1 = Math.min(nx - 1, Math.ceil((hi[0] + band - min[0]) / g));
    const j0 = Math.max(0, Math.floor((lo[1] - band - min[1]) / g)), j1 = Math.min(ny - 1, Math.ceil((hi[1] + band - min[1]) / g));
    const k0 = Math.max(0, Math.floor((lo[2] - band - min[2]) / g)), k1 = Math.min(nz - 1, Math.ceil((hi[2] + band - min[2]) / g));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = at(i, j, k), q = dist2Tri(min[0] + i * g, min[1] + j * g, min[2] + k * g, P, a, bb, c);
      if (q < d[idx]) d[idx] = q;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]);
  // the sign: along each row (j, k) a ray in +x; the winding count (+1 through a face turned against the ray, −1 with it)
  const boxes = new Float64Array(n * 6);
  for (let t = 0; t < n; t++) for (let q = 0; q < 3; q++) {
    const v = [P[tri[t * 3] * 3 + q], P[tri[t * 3 + 1] * 3 + q], P[tri[t * 3 + 2] * 3 + q]];
    boxes[t * 6 + q] = Math.min(...v); boxes[t * 6 + 3 + q] = Math.max(...v);
  }
  const tree = new BoxTree(boxes), size = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;
  const jit = size * 3.1e-7;   // off the grid rows a little, so a row never runs exactly along an edge
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const y = min[1] + j * g + jit, z = min[2] + k * g + jit * 1.7, xs = [];
    tree.ray([min[0] - g, y, z], [1, 0, 0], (t) => {
      // the ray x = s, (y, z) fixed: does it pass through triangle t, and where?
      const A = tri[t * 3], B = tri[t * 3 + 1], C = tri[t * 3 + 2];
      const ay = P[A * 3 + 1] - y, az = P[A * 3 + 2] - z, by = P[B * 3 + 1] - y, bz = P[B * 3 + 2] - z, cy = P[C * 3 + 1] - y, cz = P[C * 3 + 2] - z;
      const w0 = by * cz - bz * cy, w1 = cy * az - cz * ay, w2 = ay * bz - az * by;
      if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) return;
      const s = w0 + w1 + w2;   // twice the triangle's area seen along x, signed like its normal's x
      if (Math.abs(s) < 1e-30) return;
      xs.push([(w0 * P[A * 3] + w1 * P[B * 3] + w2 * P[C * 3]) / s, s < 0 ? 1 : -1]);
    });
    xs.sort((p, q) => p[0] - q[0]);
    let c = 0, wind = 0;
    for (let i = 0; i < nx; i++) {
      const x = min[0] + i * g;
      while (c < xs.length && xs[c][0] < x) wind += xs[c++][1];
      if (wind > 0) d[at(i, j, k)] = -d[at(i, j, k)];   // inside: negative here, turned for manifold below
    }
  }
  return { min, g, nx, ny, nz, d };
}

/** Voxel remesh → {mesh, notes}. */
export function voxelRemesh(M, m, { voxel }) {
  const notes = [];
  if (!m.info().closed) notes.push('open');
  const G = sdfGrid(m, { voxel });
  if (!G) return { mesh: m.clone(), notes: ['empty'] };
  const { min, g, nx, ny, nz, d } = G;
  const val = (i, j, k) => d[(Math.min(nz - 1, Math.max(0, k)) * ny + Math.min(ny - 1, Math.max(0, j))) * nx + Math.min(nx - 1, Math.max(0, i))];
  // manifold wants positive inside: the grid holds inside as negative
  const sdf = ([x, y, z]) => {
    const fx = (x - min[0]) / g, fy = (y - min[1]) / g, fz = (z - min[2]) / g;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, v = fy - j, w = fz - k;
    const c00 = val(i, j, k) * (1 - u) + val(i + 1, j, k) * u, c10 = val(i, j + 1, k) * (1 - u) + val(i + 1, j + 1, k) * u;
    const c01 = val(i, j, k + 1) * (1 - u) + val(i + 1, j, k + 1) * u, c11 = val(i, j + 1, k + 1) * (1 - u) + val(i + 1, j + 1, k + 1) * u;
    return -((c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w);
  };
  const max = [min[0] + (nx - 1) * g, min[1] + (ny - 1) * g, min[2] + (nz - 1) * g];
  const R = M.Manifold.levelSet(sdf, { min, max }, voxel, 0, -1);
  const out = R.getMesh(), np = out.numProp, pts = [], faces = [];
  for (let i = 0; i < out.vertProperties.length / np; i++) pts.push([out.vertProperties[i * np], out.vertProperties[i * np + 1], out.vertProperties[i * np + 2]]);
  for (let i = 0; i < out.triVerts.length; i += 3) faces.push([out.triVerts[i], out.triVerts[i + 1], out.triVerts[i + 2]]);
  R.delete?.();
  const mesh = Mesh.fromLists(pts, faces);
  if (!mesh.faceCount) notes.push('empty');
  return { mesh, notes };
}

// ---- retopology ----
/** A surface to snap to: near(p) → {q (the nearest point on it), d} or null (tris in the edited mesh's own space). */
export function surfaceNear(tris) { return nearestOnTris(tris); }
/** Put each vertex on the surface (one undo step's worth: run it inside a mesh edit). */
export function projectVerts(m, verts, near) {
  let n = 0;
  for (const v of verts) {
    if (m.vertDead(v)) continue;
    const h = near([m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2]]);
    if (!h) continue;
    m.setPos(v, h.q[0], h.q[1], h.q[2]); n++;
  }
  return n;
}
