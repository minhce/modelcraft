/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/bake.js — rigid bodies baked to keys (0.7 AN.5, session `anim`): each body read from its placement as it is at the
 * start time (its keys, curves and constraints there), simulated (anim/physics.js), and each active body given a place / turn /
 * size key on every frame from the start to the end (its earlier transform keys in that span replaced; its whole-placement
 * keys turned into curves first). One step of the timeline's own undo. Passive bodies stay as they are.
 *
 *   bakePhysics(model, anim, vals) → {anim, frames, bodies, ms, settled, missing}   (anim unchanged when nothing can be baked)
 *   clearBaked(anim) → anim   the active bodies' transform keys between the start and the end removed
 */
import { pathKey, findProp, putKeys, removeKey, toPropTracks, matrixToTRS, setRest, propsAt } from '../render/anim.js';
import { simulate, bodyFromPlacement, placementAt } from './physics.js';
import { objectPoses, objectCtx } from './cns-model.js';
import { mul, inv } from './rig.js';

const TRS = ['location', 'rotation', 'scale'];
const r3 = (x) => Math.round(x * 1000) / 1000;

export function bakePhysics(model, anim, vals) {
  const ph = anim.physics;
  if (!ph || !ph.bodies.some((b) => b.kind === 'active')) return { anim, frames: 0, bodies: 0, ms: 0, settled: true, missing: 0 };
  const v0 = vals || propsAt(anim, ph.from);
  // where everything is at the start: keys, curves and constraints at that time
  const start = new Map(objectPoses(model, anim, ph.from, v0).map((p) => [p.key, p.m]));
  const oc = objectCtx(model, anim, { rests: true });
  const worldAt = (path) => { const m = start.get(pathKey(path)) || oc.local(path); return m ? mul(oc.parentWorld(path, start), m) : null; };
  const bodies = [], info = new Map();
  let missing = 0;
  for (const b of ph.bodies) {
    const pl = model.placementAt(b.path), def = pl && model.defs.get(pl.inst.def), W = pl && worldAt(b.path);
    const bb = def && model.bbox(def);
    if (!W || !bb) { missing++; continue; }
    const body = bodyFromPlacement(pathKey(b.path), W, bb, b);
    bodies.push(body);
    info.set(body.id, { path: b.path, body, PW: oc.parentWorld(b.path, start), name: pl.inst.name || def.name || '' });
  }
  const fps = anim.fps, out = simulate({ bodies, gravity: ph.gravity, ground: ph.ground, fps, from: ph.from, to: ph.to, substeps: ph.substeps });
  let a = anim;
  for (const body of bodies) {
    if (body.kind !== 'active') continue;
    const { path, PW, name } = info.get(body.id), key = pathKey(path), target = 'obj:' + key;
    // whole-placement keys join the curves first; the rest kept once (the body's own matrix before it fell)
    const ti = a.objects.findIndex((o) => pathKey(o.path) === key);
    if (ti >= 0) a = toPropTracks(a, ti);
    a = setRest(a, path, model.placementAt(path).inst.m);
    // the old keys between the start and the end go
    for (const p of TRS) { const i = findProp(a, target, p); if (i >= 0) for (const k of a.props[i].keys.filter((k) => k.t >= ph.from - 1e-9 && k.t <= ph.to + 1e-9)) a = removeKey(a, 'p' + findProp(a, target, p), k.t); }
    const iPW = inv(PW), keys = { location: [], rotation: [], scale: [] };
    let near = null;
    out.frames.forEach((fr, f) => {
      const st = fr.get(body.id), local = mul(iPW, placementAt(body, st)), trs = matrixToTRS(local, near);
      near = trs.rotation;
      const t = r3(ph.from + f / fps);
      for (const p of TRS) keys[p].push({ t, v: trs[p], ease: 'linear' });
    });
    for (const p of TRS) a = putKeys(a, target, p, keys[p], { name });
  }
  return { anim: a, frames: out.frames.length, bodies: bodies.filter((b) => b.kind === 'active').length, ms: out.ms, settled: out.settled, missing };
}

export function clearBaked(anim) {
  const ph = anim.physics;
  if (!ph) return anim;
  let a = anim;
  for (const b of ph.bodies) {
    if (b.kind !== 'active') continue;
    const target = 'obj:' + pathKey(b.path);
    for (const p of TRS) {
      let i = findProp(a, target, p);
      while (i >= 0) {
        const k = a.props[i].keys.find((x) => x.t >= ph.from - 1e-9 && x.t <= ph.to + 1e-9);
        if (!k) break;
        a = removeKey(a, 'p' + i, k.t);
        i = findProp(a, target, p);
      }
    }
  }
  return a;
}
