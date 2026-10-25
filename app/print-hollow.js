/* SPDX-License-Identifier: Apache-2.0 */
/**
 * print-hollow.js — hollow a closed body to a wall thickness (0.7 LC.21 item 4, session print-07). DOM-free;
 * ModelCraft's alone. print-ui.js puts the result in the model (print-solid.js) and the drain holes through it.
 *
 *   hollowMesh(mesh, opts) → {
 *     method: 'offset' | 'field' | 'none' ('none': no part of it is thicker than two walls, so there is no inside to take out),
 *     positions, indices (the hollow body: the outside as it was + the inside surface facing the hollow; mm),
 *     cavity: {positions, indices}, cavityVolume (mm³), volume (mm³ of the body before), cell (mm: the field's grid step;
 *     0 for an offset), why (when the offset was not used: 'spike' | 'flipped' | 'close' | 'crossing') }
 *   mesh: a closed print3d.js printer mesh (mm, Z up, faces outward; weld() it). opts:
 *     wall      mm (2)
 *     method    'auto' (an exact inward offset when it is clean, else the distance field) | 'offset' | 'field'
 *     maxCells  the distance field's grid at most (2 000 000 points ≈ 16 MB; rule 19: the same on every tier, the grid
 *               step grows on a big model and the result says by how much)
 *
 * The offset: every corner moves inward so that each face around it moves by `wall` (a least-squares fit when more than
 * three face directions meet, so a box's corners and a sphere's points land exactly) — exact for convex bodies and boxes.
 * It is refused when a corner would spike (more than 3 × the wall), a face would turn over, a corner would come closer
 * than the wall to another part of the outside, or the inner surface would cross itself or the outside: the cases where
 * an offset self-intersects. Then the field: the signed distance to the outside on a grid (exact distance to the nearest
 * triangle within the wall's band, inside or outside by counting crossings along each grid row) and the surface where it
 * equals −wall by marching tetrahedra (six per cell along one diagonal, the same split in every cell, so the inside
 * surface is closed and never crosses itself). Its walls are the asked thickness to within one grid step.
 *
 *   drainHole(T, at, {d = 3, extra = 1}) → [[p, p, p] …] a closed cylinder (24 sides, mm) along the inward normal of the
 *     face under `at` ({tri, p}: from a pick on the outside), long enough to break into the hollow: subtract it
 *     (print-solid.js booleanTris). null when nothing is behind that face within 20 walls.
 */
import { triMesh, rayNearest, triPointDist2, nearestDist } from './print-geom.js';
import { printCheck, meshFromTriangles } from './print3d.js';

// ---------------------------------------------------------------- the offset

function offsetCavity(T, wall) {
  const { P, I, nt, N, A } = T, nv = P.length / 3;
  // the face directions around each corner (distinct ones, area-weighted for the fallback)
  const fans = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) if (A[t]) for (let k = 0; k < 3; k++) fans[I[t * 3 + k]].push(t);
  const Q = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const dirs = [];
    for (const t of fans[v]) {
      const n = [N[t * 3], N[t * 3 + 1], N[t * 3 + 2]];
      if (!dirs.some((d) => d[0] * n[0] + d[1] * n[1] + d[2] * n[2] > 1 - 1e-9)) dirs.push(n);
    }
    const m = moveFor(dirs);
    if (!m || Math.hypot(m[0], m[1], m[2]) > 3) return { why: 'spike' };
    for (let k = 0; k < 3; k++) Q[v * 3 + k] = P[v * 3 + k] - wall * m[k];
  }
  // reversed triangles: the inside surface faces the hollow
  const Iq = new Uint32Array(nt * 3);
  for (let t = 0; t < nt; t++) { Iq[t * 3] = I[t * 3]; Iq[t * 3 + 1] = I[t * 3 + 2]; Iq[t * 3 + 2] = I[t * 3 + 1]; }
  // no face turned over
  for (let t = 0; t < nt; t++) {
    if (!A[t]) continue;
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = Q[b] - Q[a], uy = Q[b + 1] - Q[a + 1], uz = Q[b + 2] - Q[a + 2], vx = Q[c] - Q[a], vy = Q[c + 1] - Q[a + 1], vz = Q[c + 2] - Q[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * N[t * 3] + ny * N[t * 3 + 1] + nz * N[t * 3 + 2] <= 1e-12) return { why: 'flipped' };
  }
  // every corner a wall away from the outside (a concave place pushes a corner close to another face)
  for (let v = 0; v < nv; v++) if (nearestDist(T, Q[v * 3], Q[v * 3 + 1], Q[v * 3 + 2], wall) < wall * 0.95) return { why: 'close' };
  return { positions: Q, indices: Iq };
}

/** m with n·m = 1 for every face direction n (least squares beyond three). */
function moveFor(dirs) {
  if (!dirs.length) return null;
  if (dirs.length === 1) return dirs[0].slice();
  if (dirs.length === 2) {
    const c = dirs[0][0] * dirs[1][0] + dirs[0][1] * dirs[1][1] + dirs[0][2] * dirs[1][2], s = 1 / (1 + c);
    return [0, 1, 2].map((k) => s * (dirs[0][k] + dirs[1][k]));
  }
  // normal equations (NᵀN) m = Nᵀ1
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  for (const n of dirs) for (let i = 0; i < 3; i++) { r[i] += n[i]; for (let j = 0; j < 3; j++) M[i][j] += n[i] * n[j]; }
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-9 * dirs.length ** 3) {
    // all the directions in one plane or nearly (a ridge): the mean direction, scaled so the faces move a wall
    const s = [0, 0, 0];
    for (const n of dirs) for (let k = 0; k < 3; k++) s[k] += n[k];
    const l = Math.hypot(...s);
    if (!l) return null;
    const u = s.map((x) => x / l);
    const cmin = Math.min(...dirs.map((n) => n[0] * u[0] + n[1] * u[1] + n[2] * u[2]));
    return cmin > 1e-3 ? u.map((x) => x / cmin) : null;
  }
  const inv = (a, b, c, d, e, f, g, h, i) => [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  const C = inv(M[0][0], M[0][1], M[0][2], M[1][0], M[1][1], M[1][2], M[2][0], M[2][1], M[2][2]);
  return [0, 1, 2].map((i) => (C[i * 3] * r[0] + C[i * 3 + 1] * r[1] + C[i * 3 + 2] * r[2]) / det);
}

// ---------------------------------------------------------------- the distance field

const TETS = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]];

function fieldCavity(T, wall, maxCells) {
  const { P, I, nt, size, lo } = T;
  let h = Math.min(wall / 2.5, Math.max(...size) / 24);
  const dims = (hh) => size.map((s) => Math.ceil(s / hh) + 5);
  while (dims(h).reduce((a, b) => a * b, 1) > maxCells) h *= 1.15;
  const [nx, ny, nz] = dims(h), N = nx * ny * nz;
  const ox = lo[0] - 2 * h, oy = lo[1] - 2 * h, oz = lo[2] - 2 * h;
  const id = (i, j, k) => (k * ny + j) * nx + i;
  const B = wall + 2 * h, B2 = B * B;
  const d2 = new Float32Array(N).fill(B2);
  // exact distance near the surface: each triangle visits the grid points within B of its box
  for (let t = 0; t < nt; t++) {
    const bo = t * 6, bx = T.boxes;
    const i0 = Math.max(0, Math.floor((bx[bo] - B - ox) / h)), i1 = Math.min(nx - 1, Math.ceil((bx[bo + 3] + B - ox) / h));
    const j0 = Math.max(0, Math.floor((bx[bo + 1] - B - oy) / h)), j1 = Math.min(ny - 1, Math.ceil((bx[bo + 4] + B - oy) / h));
    const k0 = Math.max(0, Math.floor((bx[bo + 2] - B - oz) / h)), k1 = Math.min(nz - 1, Math.ceil((bx[bo + 5] + B - oz) / h));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const q = id(i, j, k), v = triPointDist2(T, t, ox + i * h, oy + j * h, oz + k * h);
      if (v < d2[q]) d2[q] = v;
    }
  }
  // inside or out: crossings along each row (a hair off the grid rows, so a row never runs along an edge)
  const phi = new Float32Array(N), hit = { tri: -1, back: 0 }, xs = [];
  const dy = h * 1.2345e-4, dz = h * 2.3456e-4, far = size[0] + 8 * h;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const y = oy + j * h + dy, z = oz + k * h + dz;
    xs.length = 0;
    let at = 0;
    for (let guard = 0; guard < 10000; guard++) {
      const d = rayNearest(T, ox - h, y, z, 1, 0, 0, at, far, -1, hit);
      if (d < 0) break;
      xs.push(ox - h + d);
      at = d + 1e-9 * h;
    }
    let c = 0;
    for (let i = 0; i < nx; i++) {
      const x = ox + i * h;
      while (c < xs.length && xs[c] <= x) c++;
      const q = id(i, j, k), dist = Math.sqrt(d2[q]);
      const v = (c % 2 ? -dist : dist) + wall;   // < 0: deeper inside than a wall = the hollow
      phi[q] = v === 0 ? 1e-7 : v;
    }
  }
  // marching tetrahedra; a point on each crossed grid edge, shared by every triangle that uses it
  const pts = [], tris = [], onEdge = new Map();
  const corner = (c, i, j, k) => id(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
  const coord = (q) => { const i = q % nx, j = ((q - i) / nx) % ny, k = (q - i - j * nx) / (nx * ny); return [ox + i * h, oy + j * h, oz + k * h]; };
  const vert = (a, b) => {
    const key = a < b ? a * N + b : b * N + a;
    let v = onEdge.get(key);
    if (v !== undefined) return v;
    const s = Math.min(0.999, Math.max(0.001, phi[a] / (phi[a] - phi[b]))), pa = coord(a), pb = coord(b);
    v = pts.length / 3;
    pts.push(pa[0] + (pb[0] - pa[0]) * s, pa[1] + (pb[1] - pa[1]) * s, pa[2] + (pb[2] - pa[2]) * s);
    onEdge.set(key, v);
    return v;
  };
  const face = (a, b, c, inPt, outPt) => {
    // facing the hollow: from the material (phi > 0) toward the hollow (phi < 0)
    const A3 = pts.slice(a * 3, a * 3 + 3), B3 = pts.slice(b * 3, b * 3 + 3), C3 = pts.slice(c * 3, c * 3 + 3);
    const u = [B3[0] - A3[0], B3[1] - A3[1], B3[2] - A3[2]], w = [C3[0] - A3[0], C3[1] - A3[1], C3[2] - A3[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const g = [inPt[0] - outPt[0], inPt[1] - outPt[1], inPt[2] - outPt[2]];
    if (n[0] * g[0] + n[1] * g[1] + n[2] * g[2] >= 0) tris.push(a, b, c); else tris.push(a, c, b);
  };
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0, pos = 0;
    for (let c = 0; c < 8; c++) { if (phi[corner(c, i, j, k)] < 0) neg++; else pos++; }
    if (!neg || !pos) continue;
    for (const tet of TETS) {
      const q = tet.map((c) => corner(c, i, j, k)), ins = q.filter((x) => phi[x] < 0), outs = q.filter((x) => phi[x] >= 0);
      if (!ins.length || !outs.length) continue;
      const pin = coord(ins[0]), pout = coord(outs[0]);
      if (ins.length === 1) face(vert(ins[0], outs[0]), vert(ins[0], outs[1]), vert(ins[0], outs[2]), pin, pout);
      else if (ins.length === 3) face(vert(outs[0], ins[0]), vert(outs[0], ins[1]), vert(outs[0], ins[2]), pin, pout);
      else {
        const a = vert(ins[0], outs[0]), b = vert(ins[0], outs[1]), c = vert(ins[1], outs[1]), d = vert(ins[1], outs[0]);
        face(a, b, c, pin, pout); face(a, c, d, pin, pout);
      }
    }
  }
  return { positions: new Float64Array(pts), indices: new Uint32Array(tris), cell: h };
}

// ---------------------------------------------------------------- hollowing

function signedVolume(P, I) {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return v;
}
function join(m1, m2) {
  const n1 = m1.positions.length / 3, positions = new Float64Array(m1.positions.length + m2.positions.length), indices = new Uint32Array(m1.indices.length + m2.indices.length);
  positions.set(m1.positions); positions.set(m2.positions, m1.positions.length);
  indices.set(m1.indices);
  for (let i = 0; i < m2.indices.length; i++) indices[m1.indices.length + i] = m2.indices[i] + n1;
  return { positions, indices };
}
const asTris = (m) => { const out = []; for (let t = 0; t < m.indices.length; t += 3) out.push({ p: [0, 1, 2].map((k) => { const v = m.indices[t + k] * 3; return [m.positions[v], m.positions[v + 1], m.positions[v + 2]]; }) }); return out; };

export function hollowMesh(mesh, { wall = 2, method = 'auto', maxCells = 2e6, T = null } = {}) {
  T ||= triMesh(mesh);
  const volume = signedVolume(mesh.positions, mesh.indices);
  let cav = null, why = null, used = 'offset', cell = 0;
  if (method !== 'field') {
    const o = offsetCavity(T, wall);
    if (o.why) why = o.why;
    else {
      const both = join(mesh, o);
      const r = printCheck(meshFromTriangles(asTris(both)), { tol: Math.min(1e-4, wall * 1e-4) });
      if (r.ok && !r.overlaps && !r.selfIntersections) cav = o; else why = 'crossing';
    }
  }
  if (!cav && method !== 'offset') {
    used = 'field';
    const f = fieldCavity(T, wall, maxCells);
    cell = f.cell;
    cav = f.indices.length ? f : null;
    if (!cav) used = 'none';
  }
  if (!cav) return { method: method === 'offset' ? 'offset' : 'none', why, positions: mesh.positions, indices: mesh.indices, cavity: null, cavityVolume: 0, volume, cell };
  const both = join(mesh, cav);
  return { method: used, why, ...both, cavity: cav, cavityVolume: -signedVolume(cav.positions, cav.indices), volume, cell };
}

// ---------------------------------------------------------------- drain holes

export function drainHole(T, at, { d = 3, extra = 1, wall = 2 } = {}) {
  const t = at.tri, n = [T.N[t * 3], T.N[t * 3 + 1], T.N[t * 3 + 2]], p = at.p;
  const hit = { tri: -1, back: 0 };
  const depth = rayNearest(T, p[0] - n[0] * 1e-4, p[1] - n[1] * 1e-4, p[2] - n[2] * 1e-4, -n[0], -n[1], -n[2], 0, wall * 20, t, hit);
  if (depth < 0) return null;
  // a frame across the hole's axis
  const a = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const ul = Math.hypot(...u); u = u.map((x) => x / ul);
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const r = d / 2, top = p.map((x, k) => x + n[k] * extra), bot = p.map((x, k) => x - n[k] * (depth + extra)), sides = 24;
  const ring = (c) => Array.from({ length: sides }, (_, i) => { const an = 2 * Math.PI * i / sides; return c.map((x, k) => x + r * (Math.cos(an) * u[k] + Math.sin(an) * w[k])); });
  const R1 = ring(top), R0 = ring(bot), out = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    out.push([R0[i], R0[j], R1[j]], [R0[i], R1[j], R1[i]]);
    out.push([top, R1[i], R1[j]], [bot, R0[j], R0[i]]);
  }
  // wound outward: check one side face against the way out from the axis
  const s = out[0], e1 = s[1].map((x, k) => x - s[0][k]), e2 = s[2].map((x, k) => x - s[0][k]);
  const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const outv = s[0].map((x, k) => x - bot[k]);
  return fn[0] * outv[0] + fn[1] * outv[1] + fn[2] * outv[2] >= 0 ? out : out.map((q) => [q[0], q[2], q[1]]);
}
