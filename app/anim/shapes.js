/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/shapes.js — shape keys on a mesh (0.7 AN.4, session `anim`): each key is a vertex layer 'shape.<id>' (three numbers
 * per vertex: how far that vertex moves when the key is at 1). The mesh's own points are the basis. DOM-free; every change
 * runs inside model.meshEdit (so it is one step of the model's undo and saved with the mesh); the names, sliders and drivers
 * are the animation's (render/anim.js shapes / drivers).
 *
 *   shapeIds(mesh) → ['k1', …] · nextShapeId(mesh) · addShape(mesh, id) · removeShape(mesh, id)
 *   editing(mesh) → the id whose shape is being edited, or null
 *   beginEdit(mesh, id) — keeps the basis in a layer 'shape.basis' (+ which key, per vertex, in 'shape.editing'), shows the key at 1;
 *     edit the mesh as usual, then finishEdit(mesh) — the key becomes what you made, the mesh goes back to the basis
 *     (or cancelEdit(mesh): back to the basis, the key as it was)
 *   setFromPositions(mesh, id, positions) — the key that moves the basis to `positions` (Float32Array, 3 per vertex;
 *     imports: glTF morph targets, USD blend shapes)
 *   blendShapes(mesh, weights Map(id → w), out?) → Float32Array of every vertex's point (basis + Σ w × offset)
 */

export const PREFIX = 'shape.';
export const BASIS = 'shape.basis';
const EDITING = 'shape.editing';
const ID_RE = /^k\d{1,4}$/;

export function shapeIds(mesh) {
  return mesh.attrNames().filter((n) => n.startsWith(PREFIX) && ID_RE.test(n.slice(PREFIX.length))).map((n) => n.slice(PREFIX.length))
    .sort((a, b) => +a.slice(1) - +b.slice(1));
}
export function nextShapeId(mesh) {
  let n = 1;
  const have = new Set(shapeIds(mesh));
  while (have.has('k' + n)) n++;
  return 'k' + n;
}
export function addShape(mesh, id) {
  if (!ID_RE.test(id) || mesh.hasAttr(PREFIX + id)) return false;
  mesh.addAttr(PREFIX + id, 'vertex', 3);
  return true;
}
export function removeShape(mesh, id) { return mesh.removeAttr(PREFIX + id); }

/** The key being edited (its shape is in the mesh's points right now), or null. */
export function editing(mesh) {
  if (!mesh.hasAttr(BASIS) || !mesh.hasAttr(EDITING)) return null;
  const E = mesh.attrArray(EDITING);
  for (let v = 0; v < mesh.nv; v++) if (!mesh.vertDead(v) && E[v] > 0) return 'k' + E[v];
  return null;
}
/** Start editing key `id`: every vertex there now is marked with the key's number (a vertex added later reads 0). */
export function beginEdit(mesh, id) {
  if (mesh.hasAttr(BASIS) || !mesh.hasAttr(PREFIX + id)) return false;
  mesh.addAttr(BASIS, 'vertex', 3);
  mesh.addAttr(EDITING, 'vertex', 1);
  const P = mesh.P, off = mesh.attrArray(PREFIX + id), b = [0, 0, 0], k = [+id.slice(1)];
  for (let v = 0; v < mesh.nv; v++) {
    if (mesh.vertDead(v)) continue;
    b[0] = P[v * 3]; b[1] = P[v * 3 + 1]; b[2] = P[v * 3 + 2];
    mesh.setAttr(BASIS, v, b);
    mesh.setAttr(EDITING, v, k);
    mesh.setPos(v, b[0] + off[v * 3], b[1] + off[v * 3 + 1], b[2] + off[v * 3 + 2]);
  }
  return true;
}
/** End an edit: the key = the points now − the basis; the points go back to the basis (vertices added meanwhile keep their point, offset 0). */
export function finishEdit(mesh) {
  const id = editing(mesh);
  if (!id) { if (mesh.hasAttr(BASIS)) { mesh.removeAttr(BASIS); mesh.removeAttr(EDITING); } return null; }
  const B = mesh.attrArray(BASIS), E = mesh.attrArray(EDITING), P = mesh.P, d = [0, 0, 0];
  const name = PREFIX + id;
  for (let v = 0; v < mesh.nv; v++) {
    if (mesh.vertDead(v)) continue;
    if (!(E[v] > 0)) { d[0] = d[1] = d[2] = 0; mesh.setAttr(name, v, d); continue; }   // made during the edit: no basis of its own
    const bx = B[v * 3], by = B[v * 3 + 1], bz = B[v * 3 + 2];
    d[0] = P[v * 3] - bx; d[1] = P[v * 3 + 1] - by; d[2] = P[v * 3 + 2] - bz;
    mesh.setAttr(name, v, d);
    mesh.setPos(v, bx, by, bz);
  }
  mesh.removeAttr(BASIS); mesh.removeAttr(EDITING);
  return id;
}
export function cancelEdit(mesh) {
  if (!mesh.hasAttr(BASIS)) return false;
  const B = mesh.attrArray(BASIS), E = mesh.attrArray(EDITING);
  for (let v = 0; v < mesh.nv; v++) if (!mesh.vertDead(v) && E && E[v] > 0) mesh.setPos(v, B[v * 3], B[v * 3 + 1], B[v * 3 + 2]);
  mesh.removeAttr(BASIS); mesh.removeAttr(EDITING);
  return true;
}
export function setFromPositions(mesh, id, positions) {
  if (!mesh.hasAttr(PREFIX + id) && !addShape(mesh, id)) return false;
  if (!positions || positions.length < mesh.nv * 3) return false;
  const P = mesh.P, d = [0, 0, 0];
  for (let v = 0; v < mesh.nv; v++) {
    if (mesh.vertDead(v)) continue;
    d[0] = positions[v * 3] - P[v * 3]; d[1] = positions[v * 3 + 1] - P[v * 3 + 1]; d[2] = positions[v * 3 + 2] - P[v * 3 + 2];
    mesh.setAttr(PREFIX + id, v, d);
  }
  return true;
}
/** Every vertex's point with the keys at `weights` (keys at 0 cost nothing). `out` is reused when it is big enough. */
export function blendShapes(mesh, weights, out) {
  const n = mesh.nv * 3, P = mesh.P;
  const o = out && out.length >= n ? out : new Float32Array(n);
  o.set(P.subarray(0, n));
  if (!weights) return o;
  for (const [id, w] of weights) {
    if (!w) continue;
    const off = mesh.attrArray(PREFIX + id);
    if (!off) continue;
    for (let i = 0; i < n; i++) o[i] += w * off[i];
  }
  return o;
}
