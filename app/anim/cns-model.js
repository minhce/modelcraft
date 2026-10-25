/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/cns-model.js — constraints against ModelCraft's model (0.7 AN.3, session `anim`): what anim/constraints.js needs from
 * the model (placements' own matrices and their parents', targets, curve objects' lines), and the poses the view and the
 * videos use: the keys, then the placements' constraints. A constrained placement starts from its rest (anim.rests) — never
 * from its matrix as the model has it now, which the last frame set.
 *
 *   objectPoses(model, anim, t, vals) → [{path, key, m}]   posesAt + solveObjects, every placement that moves
 *   rigCtx(model, anim, rig, vals) → ctx for solveRig      targets in the rig's mesh coordinates
 *   objectCtx(model, anim, {rests}) → ctx for solveObjects (rests: false = the placements as the model has them now)
 */
import { posesAt, pathKey } from '../render/anim.js';
import { MESH_HOOKS } from '../model.js';
import { solveObjects } from './constraints.js';
import { mul, inv } from './rig.js';

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function objectCtx(model, anim, { rests: useRests = true } = {}) {
  const rests = new Map(useRests ? (anim.rests || []).map((r) => [pathKey(r.path), r.m]) : []);
  const own = (path, cur) => { const k = pathKey(path); return (cur && cur.get(k)) || rests.get(k) || model.placementAt(path)?.inst.m || null; };
  const parentWorld = (path, cur) => { let W = IDENT; for (let i = 1; i < path.length; i++) { const m = own(path.slice(0, i), cur); if (m) W = mul(W, m); } return W; };
  const worldOf = (path, cur) => { const m = own(path, cur); return m ? mul(parentWorld(path, cur), m) : null; };
  return {
    local: (path) => own(path, null),
    parentWorld, worldOf,
    point(target, cur) {
      if (!target) return null;
      if (target.kind === 'point') return target.p.slice();
      if (target.kind === 'obj') { const W = worldOf(target.path, cur); return W ? [W[12], W[13], W[14]] : null; }
      return null;
    },
    matrix(target, cur) {
      if (!target) return null;
      if (target.kind === 'obj') return worldOf(target.path, cur);
      if (target.kind === 'point') return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...target.p, 1];
      return null;
    },
    /** A curve object's line in world coordinates, as one polyline. */
    curve(path, cur) {
      const p = model.placementAt(path), def = p && model.defs.get(p.inst.def);
      const L = def && def.curve && MESH_HOOKS.lines ? MESH_HOOKS.lines(def) : null;
      if (!L || L.length < 6) return null;
      const W = worldOf(path, cur), tr = (i) => [W[0] * L[i] + W[4] * L[i + 1] + W[8] * L[i + 2] + W[12], W[1] * L[i] + W[5] * L[i + 1] + W[9] * L[i + 2] + W[13], W[2] * L[i] + W[6] * L[i + 1] + W[10] * L[i + 2] + W[14]];
      // segments a-b, a-b …: chain them (the next segment starts where one ends)
      const pts = [...tr(0)];
      for (let i = 0; i < L.length; i += 6) pts.push(...tr(i + 3));
      const n = pts.length / 3, closed = n > 2 && Math.hypot(pts[0] - pts[(n - 1) * 3], pts[1] - pts[(n - 1) * 3 + 1], pts[2] - pts[(n - 1) * 3 + 2]) < 1e-9;
      return { pts: Float64Array.from(closed ? pts.slice(0, -3) : pts), closed };
    },
  };
}
export function objectPoses(model, anim, t, vals) {
  const base = posesAt(anim, t);
  if (!(anim.constraints || []).some((c) => c.on && c.owner.startsWith('obj:'))) return base;
  const map = new Map(base.map((p) => [p.key, p.m]));
  const solved = solveObjects(anim, map, vals, objectCtx(model, anim));
  for (const [k, m] of solved) map.set(k, m);
  return [...map].map(([key, m]) => ({ path: key.split('/').map(Number), key, m }));
}
/** Bone constraints' targets in the rig's mesh coordinates (through the mesh's first placement). */
export function rigCtx(model, anim, rig, vals) {
  const oc = objectCtx(model, anim, { rests: false });   // targets where they are now (the frame's poses are already set)
  let meshW = null;
  model.walkShown((def, m) => { if (!meshW && def.id === rig.def) meshW = m; });
  const toMesh = inv(meshW || IDENT);
  return {
    influence: (c) => (vals && vals.has('cns:' + c.id + '|influence') ? vals.get('cns:' + c.id + '|influence')[0] : c.influence),
    point(target) {
      if (target.kind === 'point') return target.p.slice();   // a bone's point target is in the mesh's own coordinates
      const p = oc.point(target, null);
      return p ? [toMesh[0] * p[0] + toMesh[4] * p[1] + toMesh[8] * p[2] + toMesh[12], toMesh[1] * p[0] + toMesh[5] * p[1] + toMesh[9] * p[2] + toMesh[13], toMesh[2] * p[0] + toMesh[6] * p[1] + toMesh[10] * p[2] + toMesh[14]] : null;
    },
    matrix(target) { const M = oc.matrix(target, null); return M ? mul(toMesh, M) : null; },
  };
}
