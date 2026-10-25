/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/mod-eval.js — what a mesh with modifiers shows (0.7 MD.3): the page's side of model.js's MESH_HOOKS. Keeps each
 * mesh definition's evaluated mesh, keyed by the mesh's state, its stack and (when the stack refers to other objects) the
 * model's version, so nothing is worked out twice. Small stacks run at once on the page; a big mesh's stack runs in
 * compute's pool (mod-job.js) and the view shows the last result (or the mesh itself) until it is ready, then redraws.
 * Booleans run on the page with manifold-3d, once it is loaded (until then the stack shows without them, said once).
 *
 *   const ev = new ModEval(model, { onReady(), pool?: () => Promise<pool>, manifold?: () => Promise<module>, jobUrl })
 *   setMeshHooks({ clean: cleanMods, cleanLattice, shown: (d) => ev.shown(d) })
 *   ev.now(def, {render, upTo}) → Mesh       evaluate right now, on the page (Apply, exports that must not wait)
 *   ev.rendered(def) → Mesh                 with each modifier's render settings, cached (MESH_HOOKS.rendered)
 *   ev.setBudget(faces), ev.infoOf(def)      the view's face budget (VIEW_FACES by tier); a lowered level per modifier
 *   resolveRef(model, def, ref) → data      a reference in the modified mesh's own space (see modifiers.js)
 *   makeLattice(mesh, res, {pad}) → {mesh, lattice}   a cage round a mesh: a box of res[0] × res[1] × res[2] points
 *   cleanLattice(x, mesh)                    a cage's description from a file (untrusted)
 */
import { Mesh } from '../mesh.js';
import { evaluate, cleanMods, refsOf } from './modifiers.js';
import { curveMesh, curveLines, cleanCurve } from './curve.js';
import { apply, invert, mmul, ident } from '../vec.js';
import { faceTris, curveInfo, MESH_HOOKS } from '../model.js';

export { cleanMods, cleanCurve };
const INLINE_FACES = 40000;   // up to this many faces (in times out) a stack runs at once on the page
/** Faces per mesh the view takes before Subdivision's adaptive level comes down, by compute's real-time level (probe.js TIER_DEFAULTS). */
export const VIEW_FACES = { high: 4000000, medium: 1000000, low: 300000 };

/** The first placement of definition id: its world matrix (null when it is placed nowhere). */
export function worldOf(model, id) {
  let found = null;
  model.walk((d, m) => { if (!found && d.id === id) { found = m; return false; } return undefined; });
  return found;
}
/** Triangles of a definition (what shows: a mesh with its modifiers, a group's faces and what is placed in it), in `into`'s space. */
function trisOf(model, def, toLocal) {
  const pos = [], tri = [];
  model.walk((d, m) => {
    const M = mmul(toLocal, m);
    if (d.mesh) {
      const s = d.shown, T = s.triangulate(), base = pos.length / 3, map = new Int32Array(s.nv).fill(-1);
      let k = 0;
      for (let v = 0; v < s.nv; v++) if (!s.vertDead(v)) { map[v] = base + k++; const q = apply(M, [s.P[v * 3], s.P[v * 3 + 1], s.P[v * 3 + 2]]); pos.push(q[0], q[1], q[2]); }
      for (let i = 0; i < T.n * 3; i++) tri.push(map[s.hV[T.tri[i]]]);
      return;
    }
    // push/pull faces through the kernel's own triangles (holes handled there)
    for (const f of d.faces.values()) {
      if (f.hidden) continue;
      for (const t of faceTris(d, f)) { const b = pos.length / 3; for (const v of t) { const q = apply(M, d.verts.get(v)); pos.push(q[0], q[1], q[2]); } tri.push(b, b + 1, b + 2); }
    }
  }, def, ident());
  return { pos: Float64Array.from(pos), tri: Uint32Array.from(tri) };
}

/** A reference of the stack of `def` resolved into def's own space. */
export function resolveRef(model, def, r) {
  const meW = worldOf(model, def.id);
  if (!meW) return null;
  const toLocal = invert(meW);
  const [id, curve] = r.ref.split('/');
  const target = model.def(id);
  if (!target || target === def) return null;
  const tW = worldOf(model, id);
  if (!tW) return null;
  const M = mmul(toLocal, tW);
  if (r.kind === 'object') return { tris: trisOf(model, target, M) };
  if (r.kind === 'curve') {
    const ci = curve ? curveInfo(target, curve) : null;
    if (!ci) return null;
    const pts = ci.verts.map((v) => apply(M, target.verts.get(v)));
    if (ci.closed && pts.length) pts.push(pts[0]);
    return { pts };
  }
  if (r.kind === 'lattice') {
    const L = target.lattice, me = target.mesh;
    if (!L || !me) return null;
    // each cage point's move from where the grid put it, in def's space
    const disp = new Map();
    const [nx, ny, nz] = L.res;
    for (const [key, v] of Object.entries(L.ids)) {
      if (me.vertDead(v)) continue;
      const [i, j, k] = key.split(',').map(Number);
      const rest = [L.min[0] + ((L.max[0] - L.min[0]) * i) / (nx - 1), L.min[1] + ((L.max[1] - L.min[1]) * j) / (ny - 1), L.min[2] + ((L.max[2] - L.min[2]) * k) / (nz - 1)];
      const now = apply(M, [me.P[v * 3], me.P[v * 3 + 1], me.P[v * 3 + 2]]), restL = apply(M, rest);
      disp.set(key, [now[0] - restL[0], now[1] - restL[1], now[2] - restL[2]]);
    }
    // the rest box in def's space (the cage's own space carried over)
    const a = apply(M, L.min), b = apply(M, L.max);
    return { cage: { res: L.res.slice(), min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])], disp } };
  }
  return null;
}

/** A lattice cage round a mesh's bounds: the surface of a res grid (a box of quads), and its description. */
export function makeLattice(mesh, res = [3, 3, 3], { pad = 0.05 } = {}) {
  const b = mesh.bounds() || { min: [0, 0, 0], max: [1, 1, 1] };
  const size = [0, 1, 2].map((k) => Math.max(1e-6, b.max[k] - b.min[k])), d = Math.max(...size) * pad;
  const min = b.min.map((x) => x - d), max = b.max.map((x) => x + d);
  const [nx, ny, nz] = res.map((x) => Math.max(2, Math.min(8, Math.round(x))));
  const pts = [], ids = {}, at = new Map();
  const P = (i, j, k) => {
    const key = i + ',' + j + ',' + k;
    if (!at.has(key)) { at.set(key, pts.length); ids[key] = pts.length; pts.push([min[0] + ((max[0] - min[0]) * i) / (nx - 1), min[1] + ((max[1] - min[1]) * j) / (ny - 1), min[2] + ((max[2] - min[2]) * k) / (nz - 1)]); }
    return at.get(key);
  };
  const faces = [];
  // the six sides, each a grid of quads facing out
  for (let j = 0; j < ny - 1; j++) for (let k = 0; k < nz - 1; k++) { faces.push([P(0, j, k), P(0, j, k + 1), P(0, j + 1, k + 1), P(0, j + 1, k)]); faces.push([P(nx - 1, j, k), P(nx - 1, j + 1, k), P(nx - 1, j + 1, k + 1), P(nx - 1, j, k + 1)]); }
  for (let i = 0; i < nx - 1; i++) for (let k = 0; k < nz - 1; k++) { faces.push([P(i, 0, k), P(i + 1, 0, k), P(i + 1, 0, k + 1), P(i, 0, k + 1)]); faces.push([P(i, ny - 1, k), P(i, ny - 1, k + 1), P(i + 1, ny - 1, k + 1), P(i + 1, ny - 1, k)]); }
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny - 1; j++) { faces.push([P(i, j, 0), P(i, j + 1, 0), P(i + 1, j + 1, 0), P(i + 1, j, 0)]); faces.push([P(i, j, nz - 1), P(i + 1, j, nz - 1), P(i + 1, j + 1, nz - 1), P(i, j + 1, nz - 1)]); }
  const cage = Mesh.fromLists(pts, faces);
  for (let h = 0; h < cage.nh; h++) cage.hFl[h] |= 8;   // FL_SHARP: a cage shows as its wires
  return { mesh: cage, lattice: { res: [nx, ny, nz], min, max, ids } };
}
/** A cage's description from a file (untrusted): res 2…8, finite boxes, ids naming vertices of `mesh` on the grid's surface. */
export function cleanLattice(x, mesh) {
  if (!x || typeof x !== 'object' || !Array.isArray(x.res) || x.res.length !== 3) return null;
  const res = x.res.map((r) => Math.round(r));
  if (res.some((r) => !(r >= 2 && r <= 8))) return null;
  const v3 = (a) => Array.isArray(a) && a.length === 3 && a.every((y) => Number.isFinite(y) && Math.abs(y) < 1e7);
  if (!v3(x.min) || !v3(x.max) || !x.ids || typeof x.ids !== 'object') return null;
  const ids = {};
  for (const [key, v] of Object.entries(x.ids).slice(0, 600)) {
    const m = /^(\d),(\d),(\d)$/.exec(key);
    if (!m || +m[1] >= res[0] || +m[2] >= res[1] || +m[3] >= res[2] || !Number.isInteger(v) || v < 0 || v >= (mesh?.nv ?? 0)) continue;
    ids[key] = v;
  }
  return { res, min: x.min.slice(), max: x.max.slice(), ids };
}

export class ModEval {
  constructor(model, { onReady = () => {}, pool = null, manifold = null, jobUrl = null, faceBudget = VIEW_FACES.medium } = {}) {
    this.model = model; this.onReady = onReady; this.poolFn = pool; this.manifoldFn = manifold; this.jobUrl = jobUrl;
    this.faceBudget = faceBudget;   // the view's faces per mesh before Subdivision's adaptive level comes down (setBudget)
    this.cache = new Map();   // def id → {key, mesh, notes, info}
    this.bases = new Map();   // def id → {key, mesh, lines}: curve objects' made meshes (MD.6)
    this.busy = new Map();    // def id → key being worked out
    this.manifold = null; this.loadingManifold = false; this.said = new Set();
  }
  /**
   * The mesh the modifiers start from: a curve object's made from its curve (cached), else the definition's own; deformed by
   * its shape keys or skin when MESH_HOOKS.deform says so (0.7 AN.4/AN.2, session `anim`).
   */
  base(def) {
    const b = this.curveBase(def);
    return (MESH_HOOKS.deform && MESH_HOOKS.deform(def, b)) || b;
  }
  curveBase(def) {
    if (!def.curve) return def.mesh;
    const key = JSON.stringify(def.curve), c = this.bases.get(def.id);
    if (c && c.key === key) return c.mesh;
    const mesh = curveMesh(def.curve);
    this.bases.set(def.id, { key, mesh, lines: null });
    return mesh;
  }
  /** A curve object's own lines (MESH_HOOKS.lines), cached with its base. */
  lines(def) {
    if (!def.curve) return null;
    this.curveBase(def);
    const c = this.bases.get(def.id);
    return c.lines || (c.lines = curveLines(def.curve));
  }
  keyOf(def, render = false) {
    const refs = refsOf(def.mods);
    return def.mesh.uid + ':' + def.mesh.v + ':' + JSON.stringify(def.mods) + (def.curve ? ':' + JSON.stringify(def.curve) : '') + (render ? ':r' : ':' + this.faceBudget) + (refs.length ? ':' + this.model.version : '') + (MESH_HOOKS.deformKey ? ':' + (MESH_HOOKS.deformKey(def) || '') : '');
  }
  /** A new view budget (the machine's tier is known): what shows is worked out again. */
  setBudget(faces) { if (faces > 0 && faces !== this.faceBudget) { this.faceBudget = faces; this.onReady(); } }
  /** What the view's evaluation said per modifier ([i] → {level}), or []. */
  infoOf(def) { return this.cache.get(def.id)?.info || []; }
  refsFor(def) {
    const out = new Map();
    for (const r of refsOf(def.mods)) { const d = resolveRef(this.model, def, r); if (d) out.set(r.index, d); }
    return out;
  }
  wantsManifold(def) { return def.mods.some((m) => m.on && m.type === 'boolean'); }
  loadManifold() {
    if (this.manifold || this.loadingManifold || !this.manifoldFn) return;
    this.loadingManifold = true;
    this.manifoldFn().then((m) => { this.manifold = m; this.cache.clear(); this.onReady(); }).catch(() => {}).finally(() => { this.loadingManifold = false; });
  }
  /** Evaluate now, on the page. */
  now(def, { render = false, upTo = Infinity, budget = 0 } = {}) {
    if (this.wantsManifold(def)) this.loadManifold();
    return evaluate(this.base(def), def.mods, { render, refs: this.refsFor(def), manifold: this.manifold, upTo, budget });
  }
  /** What shows for def (MESH_HOOKS.shown): the evaluated mesh, the last one while a new one is worked out, or null. */
  shown(def) {
    if (!def.mods.some((m) => m.on && m.view)) { const b = this.base(def); return b !== def.mesh ? b : null; }
    const key = this.keyOf(def), c = this.cache.get(def.id);
    if (c && c.key === key) return c.mesh;
    if (def.mesh.recording) return c?.mesh || null;   // mid-edit: the mesh is half done
    const work = this.base(def).faceCount * def.mods.reduce((k, m) => k * (m.on && m.type === 'subsurf' ? 4 ** m.params.levels : m.on && m.type === 'array' ? m.params.count : 1), 1);
    if (work <= INLINE_FACES || !this.poolFn || !this.jobUrl) {
      const r = this.now(def, { budget: this.faceBudget });
      this.note(r.notes);
      this.cache.set(def.id, { key, mesh: r.mesh, notes: r.notes, info: r.info });
      return r.mesh;
    }
    if (this.busy.get(def.id) !== key) this.runAsync(def, key);
    return c?.mesh || null;
  }
  /** What renders (MESH_HOOKS.rendered): worked out at once on the page, kept until the mesh or stack changes. */
  rendered(def) {
    if (!def.mods.some((m) => m.on && m.render)) return this.base(def);
    const key = this.keyOf(def, true), c = this.cache.get(def.id + ':r');
    if (c && c.key === key) return c.mesh;
    const r = this.now(def, { render: true });
    this.note(r.notes);
    this.cache.set(def.id + ':r', { key, mesh: r.mesh, notes: r.notes });
    return r.mesh;
  }
  note(notes) { for (const n of notes) if (!this.said.has(n)) { this.said.add(n); this.onNote?.(n); } }
  /** The stack in the pool, split round booleans (those run here). */
  async runAsync(def, key) {
    this.busy.set(def.id, key);
    try {
      const pool = await this.poolFn();
      const refs = this.refsFor(def), mods = def.mods;
      let cur = this.base(def), notes = [];
      const info = [];
      let seg = [];
      const flush = async () => {
        if (!seg.length) return;
        const list = mods.map((m, i) => (seg.includes(i) ? m : { ...m, on: false }));
        const arr = cur.toArrays();
        const out = await pool.run(this.jobUrl, 'evaluate', { mesh: arr, mods: list, refs: [...refs].filter(([i]) => seg.includes(i)), render: false, budget: this.faceBudget }, { transfer: [arr.p.buffer, arr.fi.buffer, arr.fc.buffer], priority: 5 });
        cur = Mesh.fromArrays(out.mesh); notes = notes.concat(out.notes || []);
        (out.info || []).forEach((x, i) => { if (x) info[i] = x; });
        seg = [];
      };
      for (let i = 0; i < mods.length; i++) {
        const m = mods[i];
        if (!m.on || !m.view) continue;
        if (m.type === 'boolean') {
          await flush();
          if (!this.manifold) this.loadManifold();
          const r = evaluate(cur, mods.map((x, k) => (k === i ? x : { ...x, on: false })), { refs, manifold: this.manifold });
          cur = r.mesh; notes = notes.concat(r.notes);
        } else seg.push(i);
      }
      await flush();
      if (this.busy.get(def.id) !== key) return;   // something newer was asked for
      this.cache.set(def.id, { key, mesh: cur, notes, info });
      this.note(notes);
      this.onReady();
    } catch (e) {
      // the pool may be gone (no workers here): work it out on the page instead
      const r = this.now(def, { budget: this.faceBudget });
      this.cache.set(def.id, { key, mesh: r.mesh, notes: r.notes, info: r.info });
      this.onReady();
    } finally {
      if (this.busy.get(def.id) === key) this.busy.delete(def.id);
    }
  }
}
