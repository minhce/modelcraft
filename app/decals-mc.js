/* SPDX-License-Identifier: Apache-2.0 */
/**
 * decals-mc.js — ModelCraft's decals in its views and renders (0.7 MT.6, session `materials`). The decals are the open file's
 * (shading/doc.js, registered in render/materials.js `documentDecals`); this file finds the ones on a placement and makes their
 * geometry from that definition's own triangles (shading/decal.js). DOM-free apart from three.js geometry objects.
 *
 *   defTriangles(def) → Float64Array [ax, ay, az, bx, …]   what the definition shows: push/pull faces (hidden ones left out) or
 *                                                          a mesh's rendered surface (its modifiers' render settings)
 *   decalsOn(model, def, path) → [{decal, geometry: THREE.BufferGeometry}]   kept until the model, the decal or the definition
 *                                                          changes; the caller never disposes them (decalsOn does, when replaced)
 *   decalMeshes(model, def, path, materialOf(key) → THREE.Material | null) → [THREE.Mesh]   the live view's (view3d.js v.decals);
 *                                                          a decal whose material has no texture yet is left out
 *   decalItems(model, def, path, m) → [{geometry, matrix: m, look: 'mat:<id>'}]   for render-mc.js (a fresh geometry each call:
 *                                                          the render disposes its own)
 */
import * as THREE from 'three';
import { faceTris } from './model.js';
import { documentDecals } from './render/materials.js';
import { decalGeometry } from './shading/decal.js';

export function defTriangles(def) {
  const out = [];
  if (def.mesh) {
    const R = def.rendered, T = R.triangulate(), P = R.P, hV = R.hV;
    for (let i = 0; i < T.n; i++) for (let q = 0; q < 3; q++) { const v = hV[T.tri[i * 3 + q]] * 3; out.push(P[v], P[v + 1], P[v + 2]); }
  } else {
    for (const f of def.faces.values()) {
      if (f.hidden) continue;
      for (const tri of faceTris(def, f)) for (const v of tri) { const p = def.verts.get(v); out.push(p[0], p[1], p[2]); }
    }
  }
  return new Float64Array(out);
}

const samePath = (a, b) => a.length === b.length && a.every((x, i) => String(x) === String(b[i]));

function toGeometry(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
  return geo;
}

const cache = new Map();   // decal id → {key, geometry}
export function decalsOn(model, def, path) {
  const out = [];
  for (const d of documentDecals()) {
    if (!samePath(d.path, path)) continue;
    const key = model.version + '|' + def.id + '|' + JSON.stringify(d);
    let c = cache.get(d.id);
    if (!c || c.key !== key) {
      c?.geometry.dispose();
      const g = decalGeometry(d, defTriangles(def));
      c = { key, geometry: g.n ? toGeometry(g) : null };
      cache.set(d.id, c);
    }
    if (c.geometry) out.push({ decal: d, geometry: c.geometry });
  }
  // decals that went
  if (cache.size > documentDecals().length) { const live = new Set(documentDecals().map((d) => d.id)); for (const [id, c] of [...cache]) if (!live.has(id)) { c.geometry?.dispose(); cache.delete(id); } }
  return out;
}

export function decalItems(model, def, path, m) {
  const out = [];
  for (const d of documentDecals()) {
    if (!samePath(d.path, path)) continue;
    const g = decalGeometry(d, defTriangles(def));
    if (g.n) out.push({ geometry: toGeometry(g), matrix: m, look: 'mat:' + d.material });
  }
  return out;
}

export function decalMeshes(model, def, path, materialOf) {
  const out = [];
  for (const x of decalsOn(model, def, path)) {
    const mat = materialOf('mat:' + x.decal.material);
    if (mat) out.push(new THREE.Mesh(x.geometry, mat));
  }
  return out;
}
