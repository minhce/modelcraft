/* SPDX-License-Identifier: Apache-2.0 */
/**
 * solids.js — Union, Subtract and Intersect on closed groups and components (0.4 M9). DOM-free: bin/test-modelcraft.mjs
 * runs it in Node. The work is done by manifold-3d (Apache-2.0, vendored; the build's import map names it), loaded the
 * first time a solid tool runs — the same method as CadCraft's boolean3d.js (0.4 C12).
 *
 *   manifold(load?)                              → Promise<the manifold module> (once)
 *   solidOp(M, model, path, op, keep, cut = [])  op 'union' | 'subtract' | 'intersect' on placements of the open context
 *                                                `path`: keep = the solids to join or intersect (subtract: the ones cut);
 *                                                cut = the ones taken away (subtract only). One new group in their place,
 *                                                in one change of the model (one undo step); it keeps the first one's name,
 *                                                colour and tag. → {iid, faces, volume, closed}. Throws Error with a plain
 *                                                message when a placement is not a solid or the result is empty.
 *   isSolid(model, def, iid)                     → is that placement a closed solid (its geometry and everything in it)?
 *
 * Solids are welded and moved near their common middle before manifold sees them (its vertices are 32-bit floats), and
 * back after on a 1 µm grid; coplanar triangles of the result are merged into one face per flat side (mergeCoplanar).
 */
import { faceTris, meshDef, solidInfo, mergeCoplanar } from './model.js';
import { apply, mmul, translation } from './vec.js';
import { t } from './i18n.js';

let modulePromise = null;
/** The manifold-3d module, set up once. `load` lets Node tests pass the vendored file. */
export function manifold(load = () => import('manifold-3d')) {
  modulePromise ??= load().then(async (mod) => { const M = await (mod.default || mod)(); M.setup(); return M; });
  return modulePromise;
}

/** Every triangle of placement iid of `def` (its definition and what is nested in it), in def's coordinates. */
function placementTris(model, def, iid) {
  const inst = def.insts.get(iid);
  const out = [];
  const visit = (d, m, depth) => {
    if (!d || depth > 32) return;
    for (const f of d.faces.values()) for (const tri of faceTris(d, f)) out.push(tri.map((v) => apply(m, d.verts.get(v))));
    for (const sub of d.insts.values()) visit(model.def(sub.def), mmul(m, sub.m), depth + 1);
  };
  if (inst) visit(model.def(inst.def), inst.m, 0);
  return out;
}

/** Is placement iid of def a closed solid? (Each definition inside it closed on its own, as SketchUp asks.) */
export function isSolid(model, def, iid) {
  const inst = def.insts.get(iid);
  if (!inst) return false;
  let ok = true, any = false;
  const visit = (d, depth) => {
    if (!d || depth > 32 || !ok) return;
    if (d.faces.size) { any = true; if (!solidInfo(d).closed) ok = false; }
    for (const sub of d.insts.values()) visit(model.def(sub.def), depth + 1);
  };
  visit(model.def(inst.def), 0);
  return ok && any;
}

/** Triangles → a manifold Manifold near the origin `o`; throws when they do not close a volume. */
function toManifold(M, tris, o, name) {
  const key = new Map(), verts = [], idx = [];
  const vid = (p) => {
    const q = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const k = q.map((x) => Math.round(x * 1e7)).join(',');   // weld to 0.1 µm
    let i = key.get(k);
    if (i === undefined) { i = verts.length / 3; key.set(k, i); verts.push(q[0], q[1], q[2]); }
    return i;
  };
  for (const tri of tris) {
    const a = vid(tri[0]), b = vid(tri[1]), c = vid(tri[2]);
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  const mesh = new M.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(idx) });
  mesh.merge();
  const man = new M.Manifold(mesh);
  if (man.status() !== 'NoError' || man.isEmpty()) { man.delete?.(); throw new Error(t('app.solid.open', { name })); }
  return man;
}

export function solidOp(M, model, path, op, keep, cut = []) {
  const ctx = model.context(path);
  if (!ctx) throw new Error(t('app.solid.gone'));
  const def = ctx.def, all = [...keep, ...cut];
  if (op === 'subtract' ? !(keep.length && cut.length) : all.length < 2) throw new Error(t(op === 'subtract' ? 'app.solid.need.subtract' : 'app.solid.need.two'));
  const nameOf = (iid) => model.def(def.insts.get(iid)?.def)?.name || t('app.solid.a_solid');
  for (const iid of all) if (!isSolid(model, def, iid)) throw new Error(t('app.solid.open', { name: nameOf(iid) }));
  const tris = new Map(all.map((iid) => [iid, placementTris(model, def, iid)]));
  // the origin: the middle of everything, so the 32-bit vertices keep their precision
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const ts of tris.values()) for (const tri of ts) for (const p of tri) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const o = lo.map((v, k) => (v + hi[k]) / 2);
  const made = [];
  try {
    const of = (iid) => { const m = toManifold(M, tris.get(iid), o, nameOf(iid)); made.push(m); return m; };
    const A = keep.map(of), B = cut.map(of);
    let r;
    if (op === 'union') r = M.Manifold.union(A);
    else if (op === 'intersect') r = M.Manifold.intersection(A);
    else r = M.Manifold.union(A).subtract(M.Manifold.union(B));
    made.push(r);
    if (r.isEmpty()) throw new Error(t(op === 'intersect' ? 'app.solid.empty.intersect' : 'app.solid.empty'));
    const g = r.getMesh();
    // back from 32-bit floats: each corner on a 1 µm grid of the model (exact sizes stay exact), relative to o again
    const r6 = (v, k) => Math.round((o[k] + v) * 1e6) / 1e6 - o[k];
    const P = (i) => [r6(g.vertProperties[i * g.numProp], 0), r6(g.vertProperties[i * g.numProp + 1], 1), r6(g.vertProperties[i * g.numProp + 2], 2)];
    const polys = [];
    for (let i = 0; i < g.triVerts.length; i += 3) polys.push([P(g.triVerts[i]), P(g.triVerts[i + 1]), P(g.triVerts[i + 2])]);
    const first = def.insts.get(keep[0]);
    const label = t({ union: 'app.solid.union', subtract: 'app.solid.subtract', intersect: 'app.solid.intersect' }[op]);
    const base = nameOf(keep[0]).replace(/\s*#\d+$/, '');
    let iid = null;
    model.change(label, (m) => {
      const d = m.context(path).def;
      const nd = meshDef(m, polys, m.uniqueName(base), 'group');
      // one face per flat side, as drawn faces are (manifold hands back triangles)
      mergeCoplanar(nd, [...nd.edges].filter(([, e]) => e.soft).map(([id]) => id));
      for (const id of all) d.insts.delete(id);
      iid = m.place(d, nd.id, translation(o));
      const inst = d.insts.get(iid);
      if (first.color) inst.color = first.color;
      if (first.tag) inst.tag = first.tag;
      m.purge?.();
    });
    const info = solidInfo(model.def(model.context(path).def.insts.get(iid).def));
    return { iid, faces: info.faces, volume: Math.abs(info.volume), closed: info.closed };
  } finally {
    for (const m of made) m.delete?.();
  }
}
