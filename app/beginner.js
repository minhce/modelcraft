/* SPDX-License-Identifier: Apache-2.0 */
/**
 * beginner.js — what the Beginner menu style adds to ModelCraft (0.7 LC.21 item 2, session print-07): shapes to drop,
 * holes that subtract when grouped, aligning, dropping to the ground. DOM-free; beginner-mc.js wires it to the page and
 * input-modelcraft.js's Beginner style puts it on big buttons. Every other style is untouched (its commands are optional).
 *
 *   SHAPES                         ['box', 'cylinder', 'sphere', 'cone', 'roof', 'hole-box', 'hole-cylinder']
 *   SIZE                           0.02 m: every shape is 20 mm across and high, standing on z = 0, centred on its origin
 *   buildShape(m, id, name)        → a new group definition (call inside model.change; place it with the Place tool). Its
 *                                  `starter` marks it: 'beginner-<shape>' (a solid shape) or 'beginner-hole-<shape>'
 *   HOLE                           'beginner-hole': a definition whose `starter` is HOLE or starts with 'beginner-hole-' is a
 *                                  hole (`starter` is saved in the file for every definition, so a hole stays a hole)
 *   isHole(model, inst)            → is that placement a hole?
 *   setHole(m, ctxDef, iids, on)   placements → holes (on) or solids (off), inside model.change. A hole is painted HOLE_COLOR
 *                                  (a beginner shape's faces, else the placement's paint); back to solid: its shape colour
 *                                  (beginner shapes) or no paint. A component placed elsewhere too becomes a hole there
 *                                  as well (it is one thing). → how many changed
 *   solidsAndHoles(model, ctxDef, iids) → {solids: [iid], holes: [iid]}
 *   placementBox(model, ctxDef, iid) → {min, max} in the open context's coordinates
 *   align(m, ctxDef, iids, axis, where)   axis 0 | 1 | 2 (x red, y green, z blue), where 'min' | 'mid' | 'max': every
 *                                  placement moved so its box's min / middle / max meets the selection box's. → moved count
 *   dropToGround(m, ctxDef, iids)  each placement moved down (or up) so it stands on z = 0. → moved count
 */
import { addPolygon, pushPull, rectPts, ngonPts, paintFaces, meshDef, softenEdges } from './model.js';

export const SIZE = 0.02;
export const HOLE = 'beginner-hole';
export const HOLE_COLOR = '#9aa5b1';
export const SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'roof', 'hole-box', 'hole-cylinder'];
export const SHAPE_COLORS = { box: '#c0392b', cylinder: '#e67e22', sphere: '#2e86de', cone: '#27ae60', roof: '#8e44ad' };
const S = SIZE, R = SIZE / 2;

function prism(d, pts, h) {
  addPolygon(d, pts);
  pushPull(d, [...d.faces.keys()][0], h);
}
const MAKE = {
  box: (m, name) => { const d = m.newDef('group', name); prism(d, rectPts([-R, -R, 0], [1, 0, 0], [0, 1, 0], S, S), S); return d; },
  cylinder: (m, name) => { const d = m.newDef('group', name); prism(d, ngonPts([0, 0, 0], [0, 0, 1], [1, 0, 0], R, 32), S); return d; },
  cone: (m, name) => {
    const n = 32, base = ngonPts([0, 0, 0], [0, 0, 1], [1, 0, 0], R, n), apex = [0, 0, S];
    const polys = [{ loops: [base.slice().reverse()] }];
    for (let i = 0; i < n; i++) polys.push({ loops: [[base[i], base[(i + 1) % n], apex]] });
    return meshDef(m, polys, name, 'group');
  },
  sphere: (m, name) => {
    const seg = 24, rings = 12, polys = [];
    const p = (i, j) => { const th = Math.PI * i / rings, ph = 2 * Math.PI * j / seg; return [R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), R - R * Math.cos(th)]; };
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), dd = p(i, j + 1);
      // wound outward (counter-clockwise seen from outside); the poles' quads lose their zero-length side
      if (i === 0) polys.push({ loops: [[a, c, b]] });
      else if (i === rings - 1) polys.push({ loops: [[a, dd, b]] });
      else polys.push({ loops: [[a, dd, c, b]] });
    }
    return meshDef(m, polys, name, 'group');
  },
  roof: (m, name) => {
    // a triangle across red (x), pulled along green (y) from −R to +R
    const d = m.newDef('group', name);
    addPolygon(d, [[-R, -R, 0], [R, -R, 0], [0, -R, S]]);
    pushPull(d, [...d.faces.keys()][0], S);
    let lo = Infinity;
    for (const p of d.verts.values()) lo = Math.min(lo, p[1]);
    if (lo < -R - 1e-9) for (const [id, p] of d.verts) d.verts.set(id, [p[0], p[1] + S, p[2]]);   // it went the other way
    return d;
  },
};

export function buildShape(m, id, name) {
  const hole = id.startsWith('hole-'), base = hole ? id.slice(5) : id;
  if (!MAKE[base]) throw new Error('unknown shape ' + id);   // i18n-ignore: a programming error
  const d = MAKE[base](m, name);
  d.starter = (hole ? HOLE + '-' : 'beginner-') + base;
  paintFaces(d, [...d.faces.keys()], hole ? HOLE_COLOR : SHAPE_COLORS[base]);
  softenEdges(d, [...d.edges.keys()], 30);   // a round side shades smooth; a box's corners stay sharp
  return d;
}

const holeDef = (d) => !!d && (d.starter === HOLE || String(d.starter || '').startsWith(HOLE + '-'));
export const isHole = (model, inst) => !!inst && holeDef(model.def(inst.def));

export function setHole(m, ctxDef, iids, on) {
  let n = 0;
  for (const iid of iids) {
    const inst = ctxDef.insts.get(iid), d = inst && m.def(inst.def);
    if (!d || holeDef(d) === !!on) continue;
    if (on) {
      const shape = /^beginner-(\w+)$/.exec(d.starter || '')?.[1] || null;
      d.starter = shape ? HOLE + '-' + shape : HOLE;
      if (shape) paintFaces(d, [...d.faces.keys()], HOLE_COLOR); else inst.color = HOLE_COLOR;
    } else {
      const shape = /^beginner-hole-(\w+)$/.exec(d.starter)?.[1] || null;
      if (shape && SHAPE_COLORS[shape]) { d.starter = 'beginner-' + shape; paintFaces(d, [...d.faces.keys()], SHAPE_COLORS[shape]); }
      else { delete d.starter; if (inst.color === HOLE_COLOR) delete inst.color; }
    }
    n++;
  }
  return n;
}

export function solidsAndHoles(model, ctxDef, iids) {
  const solids = [], holes = [];
  for (const iid of iids) { const inst = ctxDef.insts.get(iid); if (inst) (isHole(model, inst) ? holes : solids).push(iid); }
  return { solids, holes };
}

export function placementBox(model, ctxDef, iid) {
  const inst = ctxDef.insts.get(iid), d = inst && model.def(inst.def);
  return d ? model.bbox(d, inst.m) : null;
}

function moveBy(inst, dx, dy, dz) { const q = inst.m.slice(); q[12] += dx; q[13] += dy; q[14] += dz; inst.m = q; }

export function align(m, ctxDef, iids, axis, where) {
  const boxes = iids.map((iid) => [iid, placementBox(m, ctxDef, iid)]).filter(([, b]) => b);
  if (boxes.length < 2) return 0;
  let lo = Infinity, hi = -Infinity;
  for (const [, b] of boxes) { lo = Math.min(lo, b.min[axis]); hi = Math.max(hi, b.max[axis]); }
  const target = where === 'min' ? lo : where === 'max' ? hi : (lo + hi) / 2;
  let n = 0;
  for (const [iid, b] of boxes) {
    const at = where === 'min' ? b.min[axis] : where === 'max' ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2;
    const d = target - at;
    if (Math.abs(d) < 1e-9) continue;
    const v = [0, 0, 0]; v[axis] = d;
    moveBy(ctxDef.insts.get(iid), v[0], v[1], v[2]);
    n++;
  }
  return n;
}

export function dropToGround(m, ctxDef, iids) {
  let n = 0;
  for (const iid of iids) {
    const b = placementBox(m, ctxDef, iid);
    if (!b || Math.abs(b.min[2]) < 1e-9) continue;
    moveBy(ctxDef.insts.get(iid), 0, 0, -b.min[2]);
    n++;
  }
  return n;
}
