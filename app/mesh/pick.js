/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/pick.js — what the pointer is over in a mesh being edited (0.7 MD.2), DOM-free. A triangle tree (../bvh.js) finds
 * the face under the pointer; the vertex or edge nearest the pointer on screen is looked for among that face and the
 * faces round its corners (so a million-face mesh picks as quickly as a cube). With nothing under the pointer (the mesh
 * seen edge-on, a pick just past its outline) every vertex is tried, up to 200 000 of them.
 *
 *   const pk = new MeshPicker(mesh, m)      m = the placement's world matrix; rebuilt when the mesh changes (pk.fresh())
 *   pk.at(cam, x, y, mode, {radius})        → {kind: 'vert'|'edge'|'face', el, p (world), dist (px)} | null
 *   pk.inRect(cam, rect, mode, {seen})      → elements whose point(s) project inside rect {x0, y0, x1, y1}: vertices,
 *                                             edges with both ends in, faces with their centre in; `seen` = only those not
 *                                             hidden behind the mesh itself
 *   pk.hit(rayWorld)                        → {f, t, p (world)} | null
 */
import { BoxTree } from '../bvh.js';
import { apply, applyDir, invert, norm, sub, dot, cross, add, mul } from '../vec.js';

export class MeshPicker {
  constructor(mesh, m) {
    this.mesh = mesh; this.m = m.slice(); this.inv = invert(m);
    this.build();
  }
  fresh() { return this.v === this.mesh.v && this.nh === this.mesh.nh; }
  build() {
    const me = this.mesh, P = me.P, T = me.triangulate();
    this.v = me.v; this.nh = me.nh;
    this.tri = T.tri.slice(0, T.n * 3); this.face = T.face.slice(0, T.n);
    const boxes = new Float64Array(T.n * 6);
    for (let i = 0; i < T.n; i++) for (let a = 0; a < 3; a++) {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < 3; k++) { const x = P[me.hV[T.tri[i * 3 + k]] * 3 + a]; if (x < lo) lo = x; if (x > hi) hi = x; }
      boxes[i * 6 + a] = lo; boxes[i * 6 + 3 + a] = hi;
    }
    this.tree = new BoxTree(boxes);
  }
  /** The nearest face the world ray meets: {f, t (world), p}. */
  hit(ray) {
    if (!this.fresh()) this.build();
    const me = this.mesh, P = me.P, o = apply(this.inv, ray.o), d = applyDir(this.inv, ray.d);
    let best = null;
    const lim = { t: Infinity };
    this.tree.ray(o, d, (i) => {
      const a = me.hV[this.tri[i * 3]] * 3, b = me.hV[this.tri[i * 3 + 1]] * 3, c = me.hV[this.tri[i * 3 + 2]] * 3;
      const t = rayTri(o, d, P, a, b, c);
      if (t !== null && t < lim.t) { lim.t = t; best = { f: this.face[i], tl: t }; }
      return false;
    }, lim);
    if (!best) return null;
    const pl = add(o, mul(d, best.tl)), p = apply(this.m, pl);
    return { f: best.f, p, t: Math.hypot(...sub(p, ray.o)) };
  }
  world(v) { const P = this.mesh.P; return apply(this.m, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); }
  /** What is under screen point (x, y): the nearest vertex / edge on screen within `radius` px, or the face. */
  at(cam, x, y, mode = 'vert', { radius = 10 } = {}) {
    const me = this.mesh, vp = cam.viewProj();
    const h = this.hit(cam.ray(x, y));
    if (mode === 'face') {
      if (h) return { kind: 'face', el: h.f, p: h.p, dist: 0 };
      return this.nearestFaceCenter(cam, x, y, radius * 2, vp);
    }
    // the candidates: the face hit and the faces round its corners
    let faces = [];
    if (h) {
      const set = new Set([h.f]);
      for (const c of me.faceCorners(h.f, [])) for (const o of me.outgoing(me.hV[c])) set.add(me.hF[o]);
      faces = [...set];
    }
    const scr = (v) => cam.project(this.world(v), vp);
    if (mode === 'vert') {
      let best = null;
      const tryV = (v) => { const s = scr(v); if (!s) return; const d = Math.hypot(s[0] - x, s[1] - y); if (d <= radius && (!best || d < best.dist)) best = { kind: 'vert', el: v, p: this.world(v), dist: d }; };
      if (faces.length) for (const f of faces) for (const c of me.faceCorners(f, [])) tryV(me.hV[c]);
      else if (me.nv <= 200000) for (let v = 0; v < me.nv; v++) if (!me.vertDead(v)) tryV(v);
      return best;
    }
    let best = null;
    const tryE = (hh) => {
      const a = scr(me.hV[hh]), b = scr(me.head(hh));
      if (!a || !b) return;
      const d = segDist(x, y, a, b);
      if (d <= radius && (!best || d < best.dist)) best = { kind: 'edge', el: me.edgeOf(hh), p: add(mul(this.world(me.hV[hh]), 0.5), mul(this.world(me.head(hh)), 0.5)), dist: d };
    };
    if (faces.length) for (const f of faces) for (const c of me.faceCorners(f, [])) tryE(c);
    else if (me.nh <= 400000) for (let hh = 0; hh < me.nh; hh++) if (!me.heDead(hh)) tryE(hh);
    return best;
  }
  nearestFaceCenter(cam, x, y, radius, vp) {
    const me = this.mesh;
    if (me.nf > 200000) return null;
    let best = null;
    for (let f = 0; f < me.nf; f++) {
      if (me.faceDead(f)) continue;
      const s = cam.project(apply(this.m, me.faceCenter(f)), vp);
      if (!s) continue;
      const d = Math.hypot(s[0] - x, s[1] - y);
      if (d <= radius && (!best || d < best.dist)) best = { kind: 'face', el: f, p: apply(this.m, me.faceCenter(f)), dist: d };
    }
    return best;
  }
  /** Is world point p seen from the camera (no face of this mesh in front of it)? */
  seen(cam, p) {
    const o = cam.persp ? cam.eye : sub(p, mul(cam.ray(...cam.project(p).slice(0, 2)).d, cam.far || 1e4));
    const d = norm(sub(p, o)), L = Math.hypot(...sub(p, o));
    const h = this.hit({ o, d });
    return !h || h.t >= L - Math.max(1e-6, L * 1e-6);
  }
  inRect(cam, rect, mode = 'vert', { seen = true } = {}) {
    const me = this.mesh, vp = cam.viewProj();
    const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1), y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
    const inside = new Uint8Array(me.nv);
    const lift = (p) => { const n = sub(cam.eye, p), l = Math.hypot(...n) || 1; return add(p, mul(n, Math.max(1e-6, cam.pixelSize(p) * 1.5) / l)); };
    for (let v = 0; v < me.nv; v++) {
      if (me.vertDead(v)) continue;
      const w = this.world(v), s = cam.project(w, vp);
      if (!s || s[0] < x0 || s[0] > x1 || s[1] < y0 || s[1] > y1) continue;
      if (seen && me.nv <= 100000 && !this.seen(cam, lift(w))) continue;
      inside[v] = 1;
    }
    if (mode === 'vert') return [...inside.keys()].filter((v) => inside[v]);
    if (mode === 'edge') { const out = []; for (let h = 0; h < me.nh; h++) if (!me.heDead(h) && me.edgeOf(h) === h && inside[me.hV[h]] && inside[me.head(h)]) out.push(h); return out; }
    const out = [];
    for (let f = 0; f < me.nf; f++) {
      if (me.faceDead(f)) continue;
      const c = apply(this.m, me.faceCenter(f)), s = cam.project(c, vp);
      if (!s || s[0] < x0 || s[0] > x1 || s[1] < y0 || s[1] > y1) continue;
      if (seen && me.nf <= 100000 && !this.seen(cam, lift(c))) continue;
      out.push(f);
    }
    return out;
  }
}

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}
/** Möller–Trumbore against triangle (a, b, c offsets into P): t or null. */
function rayTri(o, d, P, a, b, c) {
  const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-18) return null;
  const inv = 1 / det, sx = o[0] - P[a], sy = o[1] - P[a + 1], sz = o[2] - P[a + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9 ? t : null;
}
void cross; void dot;
