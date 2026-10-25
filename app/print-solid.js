/* SPDX-License-Identifier: Apache-2.0 */
/**
 * print-solid.js — the print tools' results in the model (0.7 LC.21, session print-07; solids since kernel-print,
 * 2026-10-23): the Beginner style's Group with holes, Hollow and Repair each put one part in the model in place of the
 * placements they worked on, in one undo step. DOM-free; ModelCraft's alone.
 *
 * The part is a solid group of push/pull faces when the kernel can hold it (replaceWithPart): the triangles are put on
 * the 1 µm grid, coplanar ones merged into one face per flat side (model.js mergeCoplanar, as solids.js does), edges
 * between faces less than `sharpDeg` apart softened, and the result kept only when it is closed and holds the same volume.
 * Otherwise — a result that is not a closed solid, more than SOLID_MAX_TRIS triangles to start from, or more than
 * SOLID_MAX_FACES faces once merged (a curved part from the distance field: the faces kernel edits that many slowly, and
 * rule 19's laptop) — it is a mesh (mesh.js) that keeps every triangle. Before kernel-print the result was
 * always a mesh: mergeCoplanar lost faces (print-07 § Found 1; its cause was reface's sample point landing on the edge
 * being merged away, not the part's size).
 *
 *   placementTris(model, ctxDef, iid)      → [[p, p, p] …] every triangle of that placement and what is inside it, in the
 *                                            open context's coordinates (metres)
 *   meshFromTris(tris, {sharpDeg = 30, weld = 1e-7})
 *                                          → a Mesh (mesh.js): corners within `weld` metres joined, edges sharper than
 *                                            sharpDeg marked sharp
 *   booleanTris(MF, keepTris, cutTris, op) → triangles of union(keep) − union(cut) ('subtract') or union(all) ('union'),
 *                                            through manifold-3d (solids.js's manifold()); throws Error('open') when a part
 *                                            does not close a volume, Error('empty') when nothing is left
 *   replaceWithMesh(model, path, iids, mesh, {label, name, color, tag}) → the new placement's id: the placements iids of the
 *                                            open context are taken out and the mesh is placed where they were, one undo step
 *   solidFromTris(model, tris, name, {sharpDeg = 30, max = SOLID_MAX_TRIS, maxFaces = SOLID_MAX_FACES})
 *                                          → {def: a new group definition of faces (not placed) or null, why: null | 'size' |
 *                                            'open'} — call it inside model.change
 *   replaceWithPart(model, path, iids, tris, {label, name, color, tag, sharpDeg, max, maxFaces})
 *                                          → {iid, solid (true: a group of faces; false: a mesh), why ('size' | 'open' |
 *                                            null)}: replaceWithMesh's job with a solid when the kernel can hold it
 */
import { faceTris, meshDef, mergeCoplanar, softenEdges, solidInfo } from './model.js';
import { Mesh, FL_SHARP } from './mesh.js';
import { apply, mmul, translation } from './vec.js';

export function placementTris(model, ctxDef, iid) {
  const inst = ctxDef.insts.get(iid), out = [];
  const visit = (d, m, depth) => {
    if (!d || depth > 32) return;
    for (const f of d.faces.values()) for (const tri of faceTris(d, f)) out.push(tri.map((v) => apply(m, d.verts.get(v))));
    for (const sub of d.insts.values()) visit(model.def(sub.def), mmul(m, sub.m), depth + 1);
  };
  if (inst) visit(model.def(inst.def), inst.m, 0);
  return out;
}

export function meshFromTris(tris, { sharpDeg = 30, weld = 1e-7 } = {}) {
  const key = new Map(), pts = [], faces = [];
  const vid = (p) => {
    const k = Math.round(p[0] / weld) + ',' + Math.round(p[1] / weld) + ',' + Math.round(p[2] / weld);
    let i = key.get(k);
    if (i === undefined) { i = pts.length; key.set(k, i); pts.push([p[0], p[1], p[2]]); }
    return i;
  };
  for (const t of tris) {
    const a = vid(t[0]), b = vid(t[1]), c = vid(t[2]);
    if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
  }
  const mesh = Mesh.fromLists(pts, faces);
  const cos = Math.cos(sharpDeg * Math.PI / 180);
  for (let h = 0; h < mesh.nh; h++) {
    const tw = mesh.hTw[h];
    if (tw < h) continue;   // each edge once (open edges: tw = -1 < h)
    const n1 = mesh.faceNormal(mesh.hF[h]), n2 = mesh.faceNormal(mesh.hF[tw]);
    if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < cos) { mesh.hFl[h] |= FL_SHARP; mesh.hFl[tw] |= FL_SHARP; }
  }
  return mesh;
}

/** Triangles → a manifold Manifold near `o` (32-bit vertices keep their precision there). */
function toManifold(M, tris, o) {
  const key = new Map(), verts = [], idx = [];
  const vid = (p) => {
    const q = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const k = q.map((x) => Math.round(x * 1e7)).join(',');
    let i = key.get(k);
    if (i === undefined) { i = verts.length / 3; key.set(k, i); verts.push(q[0], q[1], q[2]); }
    return i;
  };
  for (const tri of tris) { const a = vid(tri[0]), b = vid(tri[1]), c = vid(tri[2]); if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  const mesh = new M.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(idx) });
  mesh.merge();
  const man = new M.Manifold(mesh);
  if (man.status() !== 'NoError' || man.isEmpty()) { man.delete?.(); const e = new Error('open'); e.code = 'open'; throw e; }
  return man;
}

export function booleanTris(M, keep, cut = [], op = 'subtract') {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const ts of [...keep, ...cut]) for (const tri of ts) for (const p of tri) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  const o = lo.map((v, k) => (v + hi[k]) / 2), made = [];
  try {
    const of = (ts) => { const m = toManifold(M, ts, o); made.push(m); return m; };
    const A = keep.map(of), B = cut.map(of);
    let r = M.Manifold.union(A);
    made.push(r);
    if (op === 'subtract' && B.length) { const u = M.Manifold.union(B); made.push(u); r = r.subtract(u); made.push(r); }
    if (r.isEmpty()) { const e = new Error('empty'); e.code = 'empty'; throw e; }
    const g = r.getMesh(), P = (i) => [o[0] + g.vertProperties[i * g.numProp], o[1] + g.vertProperties[i * g.numProp + 1], o[2] + g.vertProperties[i * g.numProp + 2]];
    const out = [];
    for (let i = 0; i < g.triVerts.length; i += 3) out.push([P(g.triVerts[i]), P(g.triVerts[i + 1]), P(g.triVerts[i + 2])]);
    return out;
  } finally {
    for (const m of made) m.delete?.();
  }
}

export function replaceWithMesh(model, path, iids, mesh, { label, name, color, tag } = {}) {
  return model.change(label, (m) => {
    const d = m.context(path).def;
    const md = m.newMeshDef(mesh, name);
    for (const id of iids) d.insts.delete(id);
    const iid = m.place(d, md.id, translation([0, 0, 0]));
    const inst = d.insts.get(iid);
    if (color) inst.color = color;
    if (tag) inst.tag = tag;
    m.purge?.();
    return iid;
  });
}

/**
 * Above this many triangles the result stays a mesh without trying (merging 50 000 takes about a second here, VPS, capped),
 * and above this many faces after merging it goes back to one (the faces kernel edits big face sets slowly).
 */
export const SOLID_MAX_TRIS = 100000, SOLID_MAX_FACES = 20000;

const volumeOf = (tris) => {
  let v = 0;
  for (const [a, b, c] of tris) v += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  return v;
};

export function solidFromTris(model, tris, name, { sharpDeg = 30, max = SOLID_MAX_TRIS, maxFaces = SOLID_MAX_FACES } = {}) {
  if (!tris.length || tris.length > max) return { def: null, why: 'size' };
  const g = (x) => Math.round(x * 1e6) / 1e6;   // the 1 µm grid of solids.js: exact sizes stay exact, flat sides flat
  const polys = tris.map((t) => t.map((p) => [g(p[0]), g(p[1]), g(p[2])]));
  const d = meshDef(model, polys, name, 'group');
  mergeCoplanar(d, [...d.edges].filter(([, e]) => e.soft).map(([id]) => id));
  if (d.faces.size > maxFaces) { model.defs.delete(d.id); return { def: null, why: 'size' }; }
  const info = solidInfo(d), want = volumeOf(tris);
  if (!info.closed || !(Math.abs(info.volume - want) <= Math.abs(want) * 1e-4 + 1e-15)) {
    model.defs.delete(d.id);
    return { def: null, why: 'open' };
  }
  softenEdges(d, [...d.edges.keys()], sharpDeg);
  return { def: d, why: null };
}

export function replaceWithPart(model, path, iids, tris, { label, name, color, tag, sharpDeg = 30, max = SOLID_MAX_TRIS, maxFaces = SOLID_MAX_FACES } = {}) {
  let solid = false, why = null;
  const iid = model.change(label, (m) => {
    const d = m.context(path).def;
    const r = solidFromTris(m, tris, name, { sharpDeg, max, maxFaces });
    let nd = r.def;
    why = r.why;
    solid = !!nd;
    if (!nd) nd = m.newMeshDef(meshFromTris(tris, { sharpDeg }), name);
    for (const id of iids) d.insts.delete(id);
    const id = m.place(d, nd.id, translation([0, 0, 0]));
    const inst = d.insts.get(id);
    if (color) inst.color = color;
    if (tag) inst.tag = tag;
    m.purge?.();
    return id;
  });
  return { iid, solid, why };
}
