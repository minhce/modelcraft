/* SPDX-License-Identifier: Apache-2.0 */
/**
 * print-repair.js — repair beyond flat holes (0.7 LC.21 item 5, session print-07): what is wrong with a mesh for a 3D
 * printer, the safe fixes made and every one listed, the rest reported with where it is. Never silent. DOM-free;
 * ModelCraft's alone; print-ui.js shows it and puts the result in the model (print-solid.js).
 *
 *   repairMesh(mesh, opts) → {positions, indices, fixed: [{kind, n}], left: [{kind, n, at: [[x, y, z] …≤ 20], why}], changed}
 *   mesh: a print3d.js printer mesh (mm; weld() it first — its `degenerate` count is reported as fixed). opts:
 *     minSize   a loose piece smaller than this across is removed (0.5 mm)
 *     maxHole   a hole with more edges than this is left open (500): filling it would make up a large surface
 *
 * The safe fixes, in this order:
 *   degenerate   triangles with no area (left out by weld)
 *   duplicate    the same triangle twice (one kept), or back to back with itself (both removed: no volume between)
 *   small        loose pieces under minSize across
 *   flipped      triangles turned against their neighbours, turned back (each piece is walked across its edges that have
 *                exactly two triangles; a piece that can't be made consistent is left and reported)
 *   holes        open edges joined into loops; each loop up to maxHole edges is closed by a fan from its middle (flat or not)
 *   inverted     a closed piece inside out (its volume negative and it is not a hollow inside another piece) turned outward
 * Reported, not fixed: nonmanifold (edges with three or more faces), selfintersect (a piece passing through itself),
 * open (holes too big, or pinched where two loops share a corner), unorientable, overlap (separate pieces overlapping:
 * joinOverlaps() below is the fix, asked for separately because it rebuilds the faces where they meet).
 *
 *   joinOverlaps(MF, mesh) → triangles of the union of every closed piece (manifold-3d); throws Error('open') when a piece
 *                            is not closed
 */
import { printCheck, meshFromTriangles } from './print3d.js';
import { booleanTris } from './print-solid.js';

const sortKey = (a, b, c) => { const s = [a, b, c].sort((x, y) => x - y); return s[0] + ',' + s[1] + ',' + s[2]; };
const rotKey = (a, b, c) => (a < b && a < c ? a + ',' + b + ',' + c : b < c ? b + ',' + c + ',' + a : c + ',' + a + ',' + b);

export function repairMesh(mesh, { minSize = 0.5, maxHole = 500 } = {}) {
  const P = Array.from(mesh.positions);
  let tris = [];
  for (let t = 0; t < mesh.indices.length; t += 3) tris.push([mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]);
  const fixed = [], left = [];
  const note = (list, kind, n, extra = {}) => { if (n) list.push({ kind, n, ...extra }); };
  const pt = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  note(fixed, 'degenerate', mesh.degenerate || 0);

  // duplicates
  {
    const groups = new Map();
    tris.forEach((t, i) => { const k = sortKey(...t), g = groups.get(k); if (g) g.push(i); else groups.set(k, [i]); });
    const drop = new Set();
    let n = 0;
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const fwd = [], back = [], r0 = rotKey(...tris[g[0]]);
      for (const i of g) (rotKey(...tris[i]) === r0 ? fwd : back).push(i);
      const pairs = Math.min(fwd.length, back.length);
      for (let k = 0; k < pairs; k++) { drop.add(fwd[k]); drop.add(back[k]); }
      const rest = fwd.length > pairs ? fwd.slice(pairs) : back.slice(pairs);
      for (const i of rest.slice(1)) drop.add(i);
      n += g.length - (rest.length ? 1 : 0);
    }
    if (drop.size) tris = tris.filter((_, i) => !drop.has(i));
    note(fixed, 'duplicate', n);
  }

  // pieces: triangles joined by edges
  const pieces = () => {
    const parent = tris.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const byEdge = new Map();
    tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; const o = byEdge.get(key); if (o === undefined) byEdge.set(key, i); else { const ra = find(o), rb = find(i); if (ra !== rb) parent[ra] = rb; } } });
    const out = new Map();
    tris.forEach((_, i) => { const r = find(i), l = out.get(r); if (l) l.push(i); else out.set(r, [i]); });
    return [...out.values()];
  };

  // small loose pieces
  {
    const drop = new Set();
    let n = 0;
    const ps = pieces();
    if (ps.length > 1) for (const ids of ps) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const i of ids) for (const v of tris[i]) for (let k = 0; k < 3; k++) { const x = P[v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
      if (Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) < minSize) { n++; for (const i of ids) drop.add(i); }
    }
    if (drop.size) tris = tris.filter((_, i) => !drop.has(i));
    note(fixed, 'small', n);
  }

  // orientation: each piece walked across its two-triangle edges
  {
    const uses = new Map();   // undirected edge → [[tri, a→b?] …]
    tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; const l = uses.get(key); const u = [i, a < b]; if (l) l.push(u); else uses.set(key, [u]); } });
    const flip = new Int8Array(tris.length), seen = new Uint8Array(tris.length);
    let bad = 0, flips = 0;
    const atBad = [];
    for (let s = 0; s < tris.length; s++) {
      if (seen[s]) continue;
      seen[s] = 1;
      const stack = [s], piece = [s];
      let conflict = false;
      while (stack.length) {
        const i = stack.pop(), t = tris[i];
        for (let k = 0; k < 3; k++) {
          const a = t[k], b = t[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a, l = uses.get(key);
          if (l.length !== 2) continue;
          const [o, oFwd] = l[0][0] === i ? l[1] : l[0], mine = (a < b) !== !!flip[i];
          // neighbours must run the shared edge the other way
          const want = mine ? 1 : 0, theirs = oFwd ? 1 : 0;
          const need = theirs === want ? 1 : 0;
          if (!seen[o]) { seen[o] = 1; flip[o] = need; piece.push(o); stack.push(o); }
          else if (flip[o] !== need) conflict = true;
        }
      }
      if (conflict) { bad++; if (atBad.length < 20) atBad.push(pt(tris[s][0])); for (const i of piece) flip[i] = 0; continue; }
      // keep the piece's majority as it was drawn: flip whichever side is smaller
      const nf = piece.reduce((x, i) => x + flip[i], 0);
      if (nf * 2 > piece.length) for (const i of piece) flip[i] ^= 1;
      flips += Math.min(nf, piece.length - nf);
    }
    tris = tris.map((t, i) => (flip[i] ? [t[0], t[2], t[1]] : t));
    note(fixed, 'flipped', flips);
    note(left, 'unorientable', bad, { at: atBad });
  }

  // holes: open edges as loops, closed by a fan from the loop's middle
  {
    const count = new Map();
    for (const t of tris) for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; count.set(key, (count.get(key) || 0) + 1); }
    const next = new Map(), many = new Set();
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a;
      if (count.get(key) !== 1) continue;
      // the fill runs the open edge the other way: b → a
      if (next.has(b)) many.add(b); else next.set(b, a);
    }
    let filled = 0, open = 0;
    const atOpen = [], used = new Set();
    for (const start of next.keys()) {
      if (used.has(start)) continue;
      const loop = [];
      let v = start, ok = true;
      for (let g = 0; g <= next.size; g++) {
        if (many.has(v)) ok = false;
        loop.push(v); used.add(v);
        v = next.get(v);
        if (v === undefined) { ok = false; break; }
        if (v === start) break;
        if (used.has(v)) { ok = false; break; }
      }
      if (!ok || v !== start || loop.length < 3 || loop.length > maxHole) { open++; if (atOpen.length < 20) atOpen.push(pt(loop[0])); continue; }
      if (loop.length === 3) { tris.push([loop[0], loop[1], loop[2]]); filled++; continue; }
      const c = [0, 0, 0];
      for (const u of loop) for (let k = 0; k < 3; k++) c[k] += P[u * 3 + k] / loop.length;
      const ci = P.length / 3;
      P.push(c[0], c[1], c[2]);
      for (let i = 0; i < loop.length; i++) tris.push([loop[i], loop[(i + 1) % loop.length], ci]);
      filled++;
    }
    note(fixed, 'holes', filled);
    note(left, 'open', open, { at: atOpen, why: 'big' });
  }

  // inside-out pieces (after the holes, so a piece that was open can be judged)
  {
    const ps = pieces(), vol = (ids) => { let v = 0; for (const i of ids) { const [a, b, c] = tris[i].map(pt); v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return v; };
    const inside = (p, mine) => {
      // a ray from p crossing the other pieces an odd number of times
      const d = [0.000123, 0.000457, 1];
      let n = 0;
      tris.forEach((t, i) => { if (mine.has(i)) return; const h = rayHit(p, d, pt(t[0]), pt(t[1]), pt(t[2])); if (h > 1e-9) n++; });
      return n % 2 === 1;
    };
    let n = 0, tested = 0;
    for (const ids of ps) {
      if (vol(ids) >= 0) continue;
      const mine = new Set(ids);
      if (ps.length > 1 && (++tested > 200 || inside(pt(tris[ids[0]][0]), mine))) continue;   // a hollow inside another piece faces in on purpose (past 200 pieces: left as it is)
      for (const i of ids) tris[i] = [tris[i][0], tris[i][2], tris[i][1]];
      n++;
    }
    note(fixed, 'inverted', n);
  }

  // what is left, as the 3D-print check sees it
  const out = { positions: new Float64Array(P), indices: new Uint32Array(tris.flat()) };
  const r = printCheck(meshFromTriangles(tris.map((t) => ({ p: t.map(pt) }))));
  for (const p of r.problems) if (['nonmanifold', 'selfintersect'].includes(p.kind) || (p.kind === 'open' && !left.some((l) => l.kind === 'open'))) left.push({ kind: p.kind, n: p.n, at: p.at });
  for (const w of r.warnings) if (w.kind === 'overlap') left.push({ kind: 'overlap', n: w.n, at: w.at });
  return { ...out, fixed, left, changed: fixed.length > 0 };
}

export function joinOverlaps(MF, mesh) {
  const P = mesh.positions, I = mesh.indices, pt = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  // one closed piece per manifold input
  const tris = [];
  for (let t = 0; t < I.length; t += 3) tris.push([I[t], I[t + 1], I[t + 2]]);
  const parent = tris.map((_, i) => i), find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const byEdge = new Map();
  tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; const o = byEdge.get(key); if (o === undefined) byEdge.set(key, i); else { const ra = find(o), rb = find(i); if (ra !== rb) parent[ra] = rb; } } });
  const groups = new Map();
  tris.forEach((t, i) => { const r = find(i), l = groups.get(r), tri = t.map(pt); if (l) l.push(tri); else groups.set(r, [tri]); });
  return booleanTris(MF, [...groups.values()], [], 'union');
}

function rayHit(o, d, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
  if (Math.abs(det) < 1e-18) return -1;
  const f = 1 / det, s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
  if (u < 0 || u > 1) return -1;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
  if (v < 0 || u + v > 1) return -1;
  return f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
}
