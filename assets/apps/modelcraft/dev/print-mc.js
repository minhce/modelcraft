/* SPDX-License-Identifier: Apache-2.0 */
/**
 * print-mc.js — what ModelCraft hands print3d.js (0.5 SG.4, suggestion #531). DOM-free; ModelCraft's alone (not part
 * of the m3d kernel other apps copy).
 *
 *   printTriangles(model, {path, sel}) → {tris: [{p: [[x,y,z] ×3] mm, color}], what: 'selection' | 'all'}
 *
 * What prints is what is on screen: hidden faces, hidden placements and placements on hidden tags are left out. With
 * groups, components or faces selected (in the open group `path`) only they print; otherwise everything shown does.
 * Meters → millimeters, Z up as in ModelCraft (a printer's bed is XY too). Colours as the view shows them: a face's
 * own, else the paint of the nearest placement around it.
 */

import { faceTris, paintHex } from './model.js';
import { apply, det3, mmul } from './vec.js';

const MM = 1000;

export function printTriangles(model, { path = [], sel = [] } = {}) {
  const ctx = model.context(path) || model.context([]);
  const tris = [];
  const add = (def, m, color, onlyFaces = null) => {
    const mirror = det3(m) < 0;
    for (const [fid, f] of def.faces) {
      if (f.hidden || (onlyFaces && !onlyFaces.has(fid))) continue;
      for (const t of faceTris(def, f)) {
        let p = t.map((v) => apply(m, def.verts.get(v)).map((c) => c * MM));
        if (mirror) p = [p[0], p[2], p[1]];
        const c = f.color || color || null;
        tris.push({ p, color: c && paintHex(c) });   // a library material prints as its colour (0.5 RC.7)
      }
    }
  };
  const shown = (def, m, color) => model.walkShown((d, wm, p, c) => { add(d, wm, c); }, def, m, [], 0, color);
  const insts = sel.filter((s) => s && s.t === 'i' && ctx.def.insts.has(s.id));
  const faces = new Set(sel.filter((s) => s && s.t === 'f' && ctx.def.faces.has(s.id)).map((s) => s.id));
  const base = model.pathColor(path);
  if (insts.length || faces.size) {
    const off = model.hiddenTags();
    for (const s of insts) {
      const inst = ctx.def.insts.get(s.id), d = model.defs.get(inst.def);
      if (!d || inst.hidden || (inst.tag && off.has(inst.tag))) continue;
      shown(d, mmul(ctx.m, inst.m), inst.color || base);
    }
    if (faces.size) add(ctx.def, ctx.m, base, faces);
    return { tris, what: 'selection' };
  }
  shown(model.root, model.context([]).m, null);
  return { tris, what: 'all' };
}
