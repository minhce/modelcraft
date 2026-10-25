/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/deform.js — meshes moved by their shape keys (AN.4) and, from AN.2, by a skin: the page's side of model.js
 * MESH_HOOKS.deform / deforms / deformKey (owner's grant 2026-10-23). This is the CPU path: what the view, picking, exports
 * and the JS reference read (`def.shown` / `def.rendered` start from it; modifiers come after). The GPU skinning for the
 * real-time view and the path tracer is anim/skin-gpu.js (same sums).
 *
 *   const d = createDeformer(model)  →  setMeshHooks(d.hooks)
 *   d.setWeights(defId, Map(id → w))      the shape-key values (the timeline sets them at the playhead)
 *   d.setSkin(defId, skin | null)          AN.2: {apply(mesh, points out)} — runs after the shape keys
 *   d.deformed(defId) → Float32Array | null   the points as they are now (tests, exports)
 *   d.forget(defId) · d.clear()
 *   d.skinWith(defId, rig, M)               AN.2: skin the mesh with `rig` at skin matrices M (Float64Array 16 × bones)
 *   d.showWeights(defId, bone | null) · d.repaint(defId)   AN.2's weight brush: the mesh at rest, its 'mask' shading (on the
 *                                           copy) = 1 − that bone's weight, so the view shows where the bone has a hold
 *   animateDeformer(d, anim, vals, ctxFor?) every mesh's shape keys and rig (its constraints too: ctxFor(rig) → anim/cns-model.js
 *                                           rigCtx) from propsAt's values (the timeline at the
 *                                           playhead, render-mc.js per video frame); meshes no longer animated are let go
 *   deformerOf(model) → the deformer made for that model (render-mc.js: shape keys in rendered video frames)
 *   modelReadVar(model) → readVar(target, prop) for drivers: a placement's place / turn / size, a lamp, as the model has them
 *
 * One deformed copy per mesh (made again when the mesh itself changes); its points are written in place and its `live`
 * counter goes up, so the view moves the points without rebuilding (view3d.js's fast path), and def.rev++ tells the
 * model's caches. A mesh whose shape is being edited (anim/shapes.js editing) shows as it is.
 */
import { blendShapes, editing } from './shapes.js';
import { matrixToTRS, shapeWeights, bonePose } from '../render/anim.js';
import { poseMatrices, skinMatrixArray, packWeights, skinPoints } from './rig.js';
import { solveRig } from './constraints.js';

const OF = new WeakMap();
/** The weight brush's colours, none → all: dark blue, blue, cyan, green, yellow, orange, red (a weight ramp, drawn by us). */
export const RAMP = ['#1d2f6f', '#2456b5', '#1f8fc9', '#1fae8a', '#5fc04a', '#c8cc2c', '#f0a020', '#e8601c', '#d42a1a'];
export const deformerOf = (model) => OF.get(model) || null;
export function modelReadVar(model) {
  return (target, prop) => {
    if (target.startsWith('obj:')) { const p = model.placementAt(target.slice(4).split('/').map(Number)); return p ? matrixToTRS(p.inst.m)[prop] || null : null; }
    if (target.startsWith('light:')) { const L = model.lights.get(+target.slice(6)); return L && (prop === 'lumens' || prop === 'angle') ? [L[prop]] : null; }
    return null;
  };
}

export function createDeformer(model) {
  const state = new Map();   // def id → {weights: Map, skin, stamp}
  const cache = new Map();   // def id → {key, mesh, stamp}
  let stamps = 0;

  const active = (s) => !!s && (s.skin || s.show || [...s.weights.values()].some((w) => w !== 0));
  function deforms(def) {
    const s = state.get(def.id);
    return active(s) && !!def.mesh && !editing(def.mesh);
  }
  function deformKey(def) { const s = state.get(def.id); return deforms(def) ? String(s.stamp) : ''; }
  function deform(def, base) {
    if (base !== def.mesh || !deforms(def)) return null;   // a curve object's made mesh has no shape keys or skin
    const s = state.get(def.id);
    let c = cache.get(def.id);
    const key = base.uid + ':' + base.v + ':' + base.live + ':' + base.nv;
    if (!c || c.key !== key) { c = { key, mesh: base.clone(), stamp: -1 }; cache.set(def.id, c); }
    if (c.stamp !== s.stamp) {
      const D = c.mesh, P = D.P;
      blendShapes(base, s.weights, P);   // straight into the copy's points
      if (s.show) {
        // painting weights (AN.2): at rest, each face coloured by the bone's weight there (blue none … red all), on this copy
        // only; topo goes up so the view builds its colours again
        const W = base.attrArray('weight.' + s.show), cs = [];
        for (let f = 0; f < base.nf; f++) {
          if (base.faceDead(f)) continue;
          base.faceVerts(f, cs);
          let w = 0;
          for (const v of cs) w += W ? W[v] : 0;
          D.setFaceMat(f, D.paintIndex(RAMP[Math.round((w / (cs.length || 1)) * (RAMP.length - 1))]));
        }
        D.topo++;
      } else if (s.skin) s.skin.apply(base, P);
      D.live++;
      c.stamp = s.stamp;
    }
    return c.mesh;
  }
  function touch(defId) {
    const d = model.defs.get(defId);
    if (d) { d.rev++; model.bumpSafe(); }
  }
  function entry(defId) { let s = state.get(defId); if (!s) { s = { weights: new Map(), skin: null, show: null, stamp: 0 }; state.set(defId, s); } return s; }
  const sameWeights = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

  const api = {
    hooks: { deform, deforms, deformKey },
    setWeights(defId, weights) {
      const s = entry(defId), w = weights instanceof Map ? weights : new Map(Object.entries(weights || {}));
      if (sameWeights(s.weights, w)) return false;
      const was = active(s);
      s.weights = w; s.stamp = ++stamps;
      if (was || active(s)) touch(defId);
      return true;
    },
    setSkin(defId, skin) {
      const s = entry(defId);
      if (s.skin === skin && !skin) return false;
      s.skin = skin || null; s.stamp = ++stamps;
      touch(defId);
      return true;
    },
    /** Skin mesh `defId` with `rig` at skin matrices M (a new pose: the view updates; the same one: nothing happens). */
    skinWith(defId, rig, M) {
      const s = entry(defId), k = s.skin;
      if (k && k.rig === rig && k.M.length === M.length && k.M.every((x, i) => x === M[i])) return false;
      s.skin = { rig, M, apply(mesh, P) { skinPoints(mesh, packWeights(mesh, this.rig), this.M, this.rig.mode, P); } };
      s.stamp = ++stamps;
      touch(defId);
      return true;
    },
    /** Show bone `boneId`'s weights on mesh `defId` (at rest, the mesh darker where they are low), or null to stop. */
    showWeights(defId, boneId) {
      const s = entry(defId);
      if (s.show === (boneId || null)) return false;
      s.show = boneId || null; s.stamp = ++stamps;
      cache.delete(defId);   // a fresh copy: the view builds it with its mask colours (or without them again)
      touch(defId);
      return true;
    },
    /** The weights changed (a brush dab): show them again. */
    repaint(defId) { const s = state.get(defId); if (s && s.show) { s.stamp = ++stamps; touch(defId); } },
    /** Let go of the meshes not in `shaped` (no shape keys now) or `skinned` (no rig now). */
    prune(shaped, skinned) {
      for (const [id, s] of state) {
        let changed = false;
        if (!shaped.has(id) && s.weights.size) { s.weights = new Map(); changed = true; }
        if (!skinned.has(id) && s.skin) { s.skin = null; changed = true; }
        if (changed) { s.stamp = ++stamps; touch(id); }
      }
    },
    /** Tell the deformer a skin's pose changed (its apply gives other points now). */
    posed(defId) { const s = state.get(defId); if (!s || !s.skin) return; s.stamp = ++stamps; touch(defId); },
    weights: (defId) => state.get(defId)?.weights || new Map(),
    deformed(defId) { const d = model.defs.get(defId); const m = d && deform(d, d.mesh); return m ? m.P.slice(0, m.nv * 3) : null; },
    forget(defId) { if (state.delete(defId)) touch(defId); cache.delete(defId); },
    clear() { for (const id of [...state.keys()]) this.forget(id); },
    /** Every mesh's shape-key values and skin as they are now (to put back after a render moved them frame by frame). */
    snapshot() { return new Map([...state].map(([id, s]) => [id, { weights: new Map(s.weights), skin: s.skin }])); },
    restore(snap) {
      for (const [id, s] of state) {
        const k = snap.get(id) || { weights: new Map(), skin: null };
        s.weights = k.weights; s.skin = k.skin; s.stamp = ++stamps; touch(id);
      }
    },
  };
  OF.set(model, api);
  return api;
}

/** A rig's bones at the values: its pose, then its bone constraints (AN.3). → {world, skin}. ctx: anim/cns-model.js rigCtx. */
export function rigWorld(rg, anim, vals, ctx) {
  const poseOf = (id) => bonePose(vals, rg.id, id), pre = 'bone:' + rg.id + '/';
  const cons = (anim.constraints || []).filter((c) => c.on && c.owner.startsWith(pre));
  return cons.length ? solveRig(rg, poseOf, cons, ctx || {}) : poseMatrices(rg, poseOf);
}
export function animateDeformer(d, anim, vals, ctxFor) {
  const shaped = new Set(), skinned = new Set();
  for (const sh of anim.shapes || []) { shaped.add(sh.def); d.setWeights(sh.def, shapeWeights(vals, sh.def)); }
  for (const rg of anim.rigs || []) {
    if (!rg.bones.length || skinned.has(rg.def)) continue;   // one rig a mesh: the first
    skinned.add(rg.def);
    const { skin } = rigWorld(rg, anim, vals, ctxFor ? ctxFor(rg) : null);
    d.skinWith(rg.def, rg, skinMatrixArray(rg, skin));
  }
  d.prune(shaped, skinned);
}
