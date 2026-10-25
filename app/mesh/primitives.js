/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/primitives.js — meshes to start from (0.7 MD.2): plane, grid, cube, circle, cylinder, cone, UV sphere, ico
 * sphere, torus. DOM-free. Metres, Z up, centred on the origin (a plane, a grid and a circle lie on the ground; solids
 * stand on it: their lowest point at z = 0). Each comes with a 'uv' layer (the usual unwrap for its shape) and sharp
 * edges where a solid's faces meet at a crease (cube edges, cylinder and cone rims).
 *
 *   PRIMITIVES                       the names, in menu order
 *   makePrimitive(name, opts) → Mesh
 *     plane {size}  grid {size, x, y}  cube {size}  circle {r, segs, fill}  cylinder {r, h, segs}  cone {r, h, segs}
 *     uvsphere {r, segs, rings}  icosphere {r, subdiv}  torus {R, r, segs, ring}
 */
import { Mesh, FL_SHARP } from '../mesh.js';

export const PRIMITIVES = ['plane', 'grid', 'cube', 'circle', 'cylinder', 'cone', 'uvsphere', 'icosphere', 'torus'];
const clampInt = (x, lo, hi, d) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
const clampNum = (x, lo, hi, d) => (Number.isFinite(x) && x > 0 ? Math.max(lo, Math.min(hi, x)) : d);

/** A mesh from points, faces and per-face corner UVs ([[u, v] per corner] or null), then sharp edges where faces bend more than `sharpDeg`. */
function build(pts, faces, uvs, sharpDeg = 0) {
  const m = new Mesh();
  const p = new Float64Array(pts.length * 3);
  pts.forEach((q, i) => { p[i * 3] = q[0]; p[i * 3 + 1] = q[1]; p[i * 3 + 2] = q[2]; });
  const fc = new Int32Array(faces.map((f) => f.length)), fi = new Int32Array(faces.flat());
  const keep = m._bulk(p, pts.length, fc, fi);
  if (uvs) {
    m.addAttr('uv', 'corner', 2);
    const a = m.attrArray('uv');
    let c = 0;
    faces.forEach((f, i) => { const uv = uvs[i]; for (let k = 0; k < f.length; k++, c++) { const h = keep.cornerOf[c]; if (h >= 0 && uv) { a[h * 2] = uv[k][0]; a[h * 2 + 1] = uv[k][1]; } } });
  }
  if (sharpDeg > 0) {
    const lim = Math.cos((sharpDeg * Math.PI) / 180), A = [0, 0, 0], B = [0, 0, 0];
    for (let h = 0; h < m.nh; h++) {
      const t = m.hTw[h];
      if (t < 0 || t < h) continue;
      m.faceNormal(m.hF[h], A); m.faceNormal(m.hF[t], B);
      if (A[0] * B[0] + A[1] * B[1] + A[2] * B[2] < lim) { m.hFl[h] |= FL_SHARP; m.hFl[t] |= FL_SHARP; }
    }
  }
  return m;
}

export function makePrimitive(name, o = {}) {
  switch (name) {
    case 'plane': { const s = clampNum(o.size, 1e-4, 1e5, 2) / 2; return build([[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]], [[0, 1, 2, 3]], [[[0, 0], [1, 0], [1, 1], [0, 1]]]); }
    case 'grid': {
      const s = clampNum(o.size, 1e-4, 1e5, 2), nx = clampInt(o.x, 1, 1000, 10), ny = clampInt(o.y, 1, 1000, nx);
      const pts = [], faces = [], uvs = [];
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) pts.push([(i / nx - 0.5) * s, (j / ny - 0.5) * s, 0]);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        faces.push([a, a + 1, a + nx + 2, a + nx + 1]);
        uvs.push([[i / nx, j / ny], [(i + 1) / nx, j / ny], [(i + 1) / nx, (j + 1) / ny], [i / nx, (j + 1) / ny]]);
      }
      return build(pts, faces, uvs);
    }
    case 'cube': {
      const s = clampNum(o.size, 1e-4, 1e5, 2), h = s / 2;
      const pts = [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0], [-h, -h, s], [h, -h, s], [h, h, s], [-h, h, s]];
      const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
      return build(pts, faces, faces.map(() => sq), 30);
    }
    case 'circle': {
      const r = clampNum(o.r, 1e-4, 1e5, 1), n = clampInt(o.segs, 3, 1024, 32);
      const pts = [], uv = [];
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([r * Math.cos(a), r * Math.sin(a), 0]); uv.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]); }
      if (o.fill === 'fan') {
        pts.push([0, 0, 0]);
        const faces = [], uvs = [];
        for (let i = 0; i < n; i++) { faces.push([n, i, (i + 1) % n]); uvs.push([[0.5, 0.5], uv[i], uv[(i + 1) % n]]); }
        return build(pts, faces, uvs);
      }
      return build(pts, [[...Array(n).keys()]], [uv]);
    }
    case 'cylinder': case 'cone': {
      const r = clampNum(o.r, 1e-4, 1e5, 1), hh = clampNum(o.h, 1e-4, 1e5, 2), n = clampInt(o.segs, 3, 1024, 32), cone = name === 'cone';
      const pts = [], faces = [], uvs = [];
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([r * Math.cos(a), r * Math.sin(a), 0]); }
      if (cone) pts.push([0, 0, hh]); else for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([r * Math.cos(a), r * Math.sin(a), hh]); }
      const capUV = (i) => [0.5 + 0.5 * Math.cos((2 * Math.PI * i) / n), 0.5 + 0.5 * Math.sin((2 * Math.PI * i) / n)];
      faces.push([...Array(n).keys()].reverse()); uvs.push([...Array(n).keys()].reverse().map(capUV));
      if (cone) for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i, j, n]); uvs.push([[i / n, 0], [(i + 1) / n, 0], [(i + 0.5) / n, 1]]); }
      else {
        faces.push([...Array(n).keys()].map((i) => n + i)); uvs.push([...Array(n).keys()].map(capUV));
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i, j, n + j, n + i]); uvs.push([[i / n, 0], [(i + 1) / n, 0], [(i + 1) / n, 1], [i / n, 1]]); }
      }
      const m = build(pts, faces, uvs, 0);
      // the rims are sharp, the sides smooth
      for (let h = 0; h < m.nh; h++) { const t = m.hTw[h]; if (t < 0) continue; const capA = m.faceSize(m.hF[h]) === n, capB = m.faceSize(m.hF[t]) === n; if (capA !== capB) m.hFl[h] |= FL_SHARP; }
      return m;
    }
    case 'uvsphere': {
      const r = clampNum(o.r, 1e-4, 1e5, 1), n = clampInt(o.segs, 3, 512, 32), k = clampInt(o.rings, 2, 512, 16);
      const pts = [[0, 0, 0]];   // bottom pole (the sphere stands on the ground: centre at z = r)
      for (let j = 1; j < k; j++) { const th = (Math.PI * j) / k; for (let i = 0; i < n; i++) { const ph = (2 * Math.PI * i) / n; pts.push([r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r - r * Math.cos(th)]); } }
      pts.push([0, 0, 2 * r]);
      const top = pts.length - 1, at = (j, i) => 1 + (j - 1) * n + (i % n);
      const faces = [], uvs = [];
      for (let i = 0; i < n; i++) { faces.push([0, at(1, i + 1), at(1, i)]); uvs.push([[(i + 0.5) / n, 0], [(i + 1) / n, 1 / k], [i / n, 1 / k]]); }
      for (let j = 1; j < k - 1; j++) for (let i = 0; i < n; i++) { faces.push([at(j, i), at(j, i + 1), at(j + 1, i + 1), at(j + 1, i)]); uvs.push([[i / n, j / k], [(i + 1) / n, j / k], [(i + 1) / n, (j + 1) / k], [i / n, (j + 1) / k]]); }
      for (let i = 0; i < n; i++) { faces.push([top, at(k - 1, i), at(k - 1, i + 1)]); uvs.push([[(i + 0.5) / n, 1], [i / n, (k - 1) / k], [(i + 1) / n, (k - 1) / k]]); }
      return build(pts, faces, uvs);
    }
    case 'icosphere': {
      const r = clampNum(o.r, 1e-4, 1e5, 1), sub = clampInt(o.subdiv, 0, 6, 2), g = (1 + Math.sqrt(5)) / 2;
      let pts = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]];
      let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      const unit = (p) => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; };
      pts = pts.map(unit);
      for (let s = 0; s < sub; s++) {
        const mid = new Map(), next = [];
        const mp = (a, b) => { const kk = a < b ? a + ',' + b : b + ',' + a; if (!mid.has(kk)) { pts.push(unit([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2, (pts[a][2] + pts[b][2]) / 2])); mid.set(kk, pts.length - 1); } return mid.get(kk); };
        for (const [a, b, c] of faces) { const ab = mp(a, b), bc = mp(b, c), ca = mp(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
        faces = next;
      }
      const P = pts.map((p) => [p[0] * r, p[1] * r, p[2] * r + r]);
      const uvs = faces.map((f) => f.map((i) => [0.5 + Math.atan2(pts[i][1], pts[i][0]) / (2 * Math.PI), 0.5 + Math.asin(Math.max(-1, Math.min(1, pts[i][2]))) / Math.PI]));
      return build(P, faces, uvs);
    }
    case 'torus': {
      const R = clampNum(o.R, 1e-4, 1e5, 1), rr = clampNum(o.r, 1e-5, 1e5, 0.25), n = clampInt(o.segs, 3, 512, 48), k = clampInt(o.ring, 3, 512, 12);
      const pts = [], faces = [], uvs = [];
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; for (let j = 0; j < k; j++) { const b = (2 * Math.PI * j) / k; const w = R + rr * Math.cos(b); pts.push([w * Math.cos(a), w * Math.sin(a), rr + rr * Math.sin(b)]); } }
      const at = (i, j) => (i % n) * k + (j % k);
      for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) { faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]); uvs.push([[i / n, j / k], [(i + 1) / n, j / k], [(i + 1) / n, (j + 1) / k], [i / n, (j + 1) / k]]); }
      return build(pts, faces, uvs);
    }
    default: throw new Error('makePrimitive: unknown ' + name);   // i18n-ignore: a programmer's error
  }
}
