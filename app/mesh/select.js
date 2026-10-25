/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/select.js — what is selected in a mesh being edited (0.7 MD.2), DOM-free. Kept beside the mesh, not in it: the
 * selection is not an undo step (as everywhere in ModelCraft). Three modes, as 3D content tools have them: vertices,
 * edges, faces. Each element type has its own Uint8Array (1 = selected), indexed like the mesh's slots; an edge is
 * selected on both of its half-edges. `flush()` makes the other two types follow the mode's (vertices → edges with both
 * ends selected → faces with every corner selected; edges → their ends, faces whose edges all are; faces → their edges
 * and corners).
 *
 *   new MeshSelection(mesh, mode = 'vert')     fit() after the mesh grew; clear() all() invert() setMode(mode)
 *   pickVert(v, how) pickEdge(h, how) pickFace(f, how)    how: 'set' | 'add' | 'toggle' | 'remove'
 *   verts() edges() (one half-edge per edge) faces()      counts() → {verts, edges, faces}
 *   linked() grow() shrink() loop(h, how) ring(h, how) faceLoop(h, how) byAngle(deg)  sharp(deg) (edges sharper than deg)
 *   linkedFrom(el)  the connected piece of one element
 */
import { FL_DEAD, FL_HIDE } from '../mesh.js';

export const MODES = ['vert', 'edge', 'face'];

export class MeshSelection {
  constructor(mesh, mode = 'vert') {
    this.mesh = mesh;
    this.mode = MODES.includes(mode) ? mode : 'vert';
    this.v = new Uint8Array(0); this.e = new Uint8Array(0); this.f = new Uint8Array(0);
    this.fit();
  }
  /** Make room for elements the mesh gained (new ones start unselected; elements now dead are dropped). */
  fit() {
    const m = this.mesh;
    const grow = (a, n) => { if (a.length >= n) return a; const b = new Uint8Array(Math.max(n, a.length * 2)); b.set(a); return b; };
    this.v = grow(this.v, m.nv); this.e = grow(this.e, m.nh); this.f = grow(this.f, m.nf);
    for (let i = 0; i < m.nv; i++) if (this.v[i] && m.vFl[i] & FL_DEAD) this.v[i] = 0;
    for (let i = 0; i < m.nh; i++) if (this.e[i] && m.hFl[i] & FL_DEAD) this.e[i] = 0;
    for (let i = 0; i < m.nf; i++) if (this.f[i] && m.fFl[i] & FL_DEAD) this.f[i] = 0;
    return this;
  }
  clear() { this.v.fill(0); this.e.fill(0); this.f.fill(0); return this; }
  /** Everything that shows (hidden faces and what only they use stay out). */
  all() {
    const m = this.mesh;
    this.clear();
    for (let f = 0; f < m.nf; f++) if (this.live(f)) this.f[f] = 1;
    this.flushFrom('face');
    if (this.mode === 'vert') for (let v = 0; v < m.nv; v++) if (!(m.vFl[v] & (FL_DEAD | FL_HIDE)) && m.vHe[v] < 0) this.v[v] = 1;   // loose points too
    return this;
  }
  invert() {
    const m = this.mesh;
    if (this.mode === 'face') { for (let f = 0; f < m.nf; f++) this.f[f] = this.live(f) && !this.f[f] ? 1 : 0; this.flushFrom('face'); }
    else if (this.mode === 'edge') { for (let h = 0; h < m.nh; h++) this.e[h] = this.liveHe(h) && !this.e[h] ? 1 : 0; this.flushFrom('edge'); }
    else { for (let v = 0; v < m.nv; v++) this.v[v] = !(m.vFl[v] & (FL_DEAD | FL_HIDE)) && !this.v[v] ? 1 : 0; this.flushFrom('vert'); }
    return this;
  }
  live(f) { return !(this.mesh.fFl[f] & (FL_DEAD | FL_HIDE)); }
  liveHe(h) { const m = this.mesh; return !(m.hFl[h] & FL_DEAD) && !(m.fFl[m.hF[h]] & FL_HIDE); }
  setMode(mode) {
    if (!MODES.includes(mode) || mode === this.mode) return this;
    const from = this.mode;
    this.mode = mode;
    // going to a coarser mode keeps only what is wholly selected; to a finer one keeps what the old one held
    if (MODES.indexOf(mode) > MODES.indexOf(from)) this.flushFrom(from); else this.flushFrom(mode);
    return this;
  }
  /** Make the other element types follow `src` (the mode's type, by default). */
  flushFrom(src = this.mode) {
    const m = this.mesh, cs = [];
    if (src === 'vert') {
      this.e.fill(0); this.f.fill(0);
      for (let h = 0; h < m.nh; h++) if (this.liveHe(h) && this.v[m.hV[h]] && this.v[m.head(h)]) this.e[h] = 1;
      for (let f = 0; f < m.nf; f++) { if (!this.live(f)) continue; m.faceCorners(f, cs); if (cs.every((h) => this.v[m.hV[h]])) this.f[f] = 1; }
    } else if (src === 'edge') {
      this.v.fill(0); this.f.fill(0);
      for (let h = 0; h < m.nh; h++) if (this.e[h]) { this.v[m.hV[h]] = 1; this.v[m.head(h)] = 1; const t = m.hTw[h]; if (t >= 0) this.e[t] = 1; }
      for (let f = 0; f < m.nf; f++) { if (!this.live(f)) continue; m.faceCorners(f, cs); if (cs.every((h) => this.e[h])) this.f[f] = 1; }
    } else {
      this.v.fill(0); this.e.fill(0);
      for (let f = 0; f < m.nf; f++) {
        if (!this.f[f]) continue;
        for (const h of m.faceCorners(f, cs)) { this.e[h] = 1; const t = m.hTw[h]; if (t >= 0) this.e[t] = 1; this.v[m.hV[h]] = 1; }
      }
    }
    return this;
  }
  flush() { return this.flushFrom(this.mode); }
  setOne(arr, i, how) {
    if (how === 'set') { this.clear(); arr[i] = 1; }
    else if (how === 'add') arr[i] = 1;
    else if (how === 'remove') arr[i] = 0;
    else arr[i] = arr[i] ? 0 : 1;
  }
  pickVert(v, how = 'set') { this.setOne(this.v, v, how); this.flushFrom('vert'); return this; }
  pickEdge(h, how = 'set') {
    const t = this.mesh.hTw[h];
    const was = this.e[h];
    this.setOne(this.e, h, how);
    if (t >= 0) this.e[t] = this.e[h];
    if (how === 'set' || was !== this.e[h]) this.flushFrom('edge');
    return this;
  }
  pickFace(f, how = 'set') { this.setOne(this.f, f, how); this.flushFrom('face'); return this; }

  verts() { const out = []; for (let v = 0; v < this.mesh.nv; v++) if (this.v[v]) out.push(v); return out; }
  edges() { const m = this.mesh, out = []; for (let h = 0; h < m.nh; h++) if (this.e[h] && m.edgeOf(h) === h) out.push(h); return out; }
  faces() { const out = []; for (let f = 0; f < this.mesh.nf; f++) if (this.f[f]) out.push(f); return out; }
  counts() { return { verts: this.verts().length, edges: this.edges().length, faces: this.faces().length }; }
  empty() { return !this.v.some((x) => x); }

  /** Everything joined to what is selected, through faces. */
  linked() {
    const m = this.mesh, seen = new Uint8Array(m.nf), todo = [];
    for (let h = 0; h < m.nh; h++) if (this.liveHe(h) && this.v[m.hV[h]]) { const f = m.hF[h]; if (!seen[f]) { seen[f] = 1; todo.push(f); } }
    this.floodFaces(todo, seen, () => true);
    for (let f = 0; f < m.nf; f++) if (seen[f]) this.f[f] = 1;
    this.flushFrom('face');
    return this;
  }
  /** The connected piece of one face (or of the face of a half-edge / vertex), optionally stopping at edges `stop(h)`. */
  linkedFrom(el, kind = 'face', how = 'add', stop = () => false) {
    const m = this.mesh;
    const f0 = kind === 'face' ? el : kind === 'edge' ? m.hF[el] : m.vHe[el] >= 0 ? m.hF[m.vHe[el]] : -1;
    if (f0 < 0) return this;
    if (how === 'set') this.clear();
    const seen = new Uint8Array(m.nf);
    seen[f0] = 1;
    this.floodFaces([f0], seen, (h) => !stop(h));
    for (let f = 0; f < m.nf; f++) if (seen[f]) this.f[f] = how === 'remove' ? 0 : 1;
    this.flushFrom('face');
    return this;
  }
  floodFaces(todo, seen, cross) {
    const m = this.mesh, cs = [];
    while (todo.length) {
      const f = todo.pop();
      for (const h of m.faceCorners(f, cs)) {
        const t = m.hTw[h];
        if (t < 0 || !cross(h)) continue;
        const g = m.hF[t];
        if (!seen[g] && this.live(g)) { seen[g] = 1; todo.push(g); }
      }
    }
  }
  /** Add the elements next to the selection (through faces), as 3D content tools grow a selection. */
  grow() {
    const m = this.mesh, add = new Uint8Array(m.nv), cs = [];
    for (let f = 0; f < m.nf; f++) {
      if (!this.live(f)) continue;
      m.faceCorners(f, cs);
      if (cs.some((h) => this.v[m.hV[h]])) for (const h of cs) add[m.hV[h]] = 1;
    }
    if (this.mode === 'face') {
      for (let f = 0; f < m.nf; f++) { if (!this.live(f)) continue; m.faceCorners(f, cs); if (cs.some((h) => this.v[m.hV[h]])) this.f[f] = 1; }
      return this.flushFrom('face');
    }
    for (let v = 0; v < m.nv; v++) if (add[v]) this.v[v] = 1;
    return this.flushFrom('vert');
  }
  /** Drop the elements on the edge of the selection. */
  shrink() {
    const m = this.mesh, cs = [];
    if (this.mode === 'face') {
      const keep = new Uint8Array(m.nf);
      for (let f = 0; f < m.nf; f++) {
        if (!this.f[f]) continue;
        m.faceCorners(f, cs);
        keep[f] = cs.every((h) => { const t = m.hTw[h]; return t >= 0 && this.f[m.hF[t]]; }) ? 1 : 0;
      }
      this.f = keep;
      return this.flushFrom('face');
    }
    const drop = new Uint8Array(m.nv);
    for (let f = 0; f < m.nf; f++) {
      if (!this.live(f)) continue;
      m.faceCorners(f, cs);
      if (cs.some((h) => !this.v[m.hV[h]])) for (const h of cs) drop[m.hV[h]] = 1;
    }
    for (let v = 0; v < m.nv; v++) if (m.vHe[v] >= 0 && m.isBoundaryVert(v)) drop[v] = 1;
    for (let v = 0; v < m.nv; v++) if (drop[v]) this.v[v] = 0;
    return this.flushFrom('vert');
  }
  /**
   * The edge loop through half-edge h: across each vertex with four edges to the edge opposite, along an open border to
   * the next border edge; it stops at a vertex of another valence or where it comes back. → half-edges of the loop.
   */
  loopEdges(h) {
    const m = this.mesh;
    if (m.hTw[h] < 0) {
      // an open border: the whole border it is on
      const out = [], seen = new Set();
      for (let g = h, i = 0; g >= 0 && !seen.has(g) && i < 1e6; i++) { seen.add(g); out.push(m.edgeOf(g)); g = this.nextBorder(g); }
      return out;
    }
    const out = [m.edgeOf(h)], seen = new Set(out);
    for (const start of [h, m.hTw[h]]) {
      let cur = start;
      for (let guard = 0; guard < 1e6; guard++) {
        const nx = this.nextLoop(cur);
        if (nx < 0) break;
        const k = m.edgeOf(nx);
        if (seen.has(k)) break;
        seen.add(k); out.push(k);
        cur = nx;
      }
    }
    return out;
  }
  /** After half-edge h (a → b), the edge leaving b on the far side of a four-edge vertex, as a half-edge from b; -1 if none. */
  nextLoop(h) {
    const m = this.mesh, b = m.head(h), ring = m.outgoing(b);
    if (ring.length !== 4 || m.isBoundaryVert(b)) return -1;
    const back = m.hTw[h];   // b → a
    const i = ring.indexOf(back);
    return i < 0 ? -1 : ring[(i + 2) % 4];
  }
  /** Along an open border: the next border half-edge after h (both have their face on the same side). */
  nextBorder(h) {
    const m = this.mesh;
    let g = m.hNx[h];
    for (let guard = 0; guard < 1e6; guard++) {
      if (m.hTw[g] < 0) return g;
      g = m.hNx[m.hTw[g]];
      if (g === h) return -1;
    }
    return -1;
  }
  /** The edge ring through h: across quads to the opposite edge, both ways. → half-edges (one per edge). */
  ringEdges(h) {
    const m = this.mesh, out = [m.edgeOf(h)], seen = new Set(out);
    for (const start of [h, m.hTw[h]]) {
      let cur = start;
      for (let guard = 0; guard < 1e6 && cur >= 0; guard++) {
        if (m.faceSize(m.hF[cur]) !== 4 || !this.live(m.hF[cur])) break;
        const opp = m.hNx[m.hNx[cur]];
        const k = m.edgeOf(opp);
        if (seen.has(k)) break;
        seen.add(k); out.push(k);
        cur = m.hTw[opp];
      }
    }
    return out;
  }
  loop(h, how = 'set') { return this.pickEdges(this.loopEdges(h), how); }
  ring(h, how = 'set') { return this.pickEdges(this.ringEdges(h), how); }
  /** The faces of the ring through h (a face loop). */
  faceLoop(h, how = 'set') {
    const m = this.mesh, faces = new Set();
    for (const e of this.ringEdges(h)) for (const x of [e, m.hTw[e]]) if (x >= 0 && m.faceSize(m.hF[x]) === 4) faces.add(m.hF[x]);
    if (how === 'set') this.clear();
    for (const f of faces) this.f[f] = how === 'remove' ? 0 : 1;
    return this.flushFrom('face');
  }
  pickEdges(list, how) {
    const m = this.mesh;
    if (how === 'set') this.clear();
    for (const h of list) { const on = how === 'remove' ? 0 : 1; this.e[h] = on; const t = m.hTw[h]; if (t >= 0) this.e[t] = on; }
    return this.flushFrom('edge');
  }
  /** Faces joined to the selection whose normals turn less than `deg` across each edge (select linked, delimited by angle). */
  byAngle(deg) {
    const m = this.mesh, lim = Math.cos((deg * Math.PI) / 180), N = new Float64Array(m.nf * 3), t = [0, 0, 0];
    for (let f = 0; f < m.nf; f++) if (this.live(f)) { m.faceNormal(f, t); N[f * 3] = t[0]; N[f * 3 + 1] = t[1]; N[f * 3 + 2] = t[2]; }
    const seen = new Uint8Array(m.nf), todo = [];
    for (let f = 0; f < m.nf; f++) if (this.f[f] || (this.mode !== 'face' && this.facesTouchSel(f))) { seen[f] = 1; todo.push(f); }
    this.floodFaces(todo, seen, (h) => { const a = m.hF[h], b = m.hF[m.hTw[h]]; return N[a * 3] * N[b * 3] + N[a * 3 + 1] * N[b * 3 + 1] + N[a * 3 + 2] * N[b * 3 + 2] >= lim; });
    for (let f = 0; f < m.nf; f++) if (seen[f]) this.f[f] = 1;
    return this.flushFrom('face');
  }
  facesTouchSel(f) { const m = this.mesh, cs = m.faceCorners(f); return cs.some((h) => this.v[m.hV[h]]); }
  /** Edges where the faces turn more than `deg` (select sharp edges). */
  sharp(deg) {
    const m = this.mesh, lim = Math.cos((deg * Math.PI) / 180), a = [0, 0, 0], b = [0, 0, 0];
    this.clear();
    for (let h = 0; h < m.nh; h++) {
      const t = m.hTw[h];
      if (!this.liveHe(h) || t < 0 || t < h) continue;
      m.faceNormal(m.hF[h], a); m.faceNormal(m.hF[t], b);
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < lim) { this.e[h] = 1; this.e[t] = 1; }
    }
    return this.flushFrom('edge');
  }
}
