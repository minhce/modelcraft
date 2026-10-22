/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file — tool names, descriptions and results are read by the assistant program, not shown to the person. */
/**
 * agents.js — ModelCraft for AI assistants and scripts (0.4 part 2 X.7, session agents; docs/AGENTS-SPEC.md §5.2): basic
 * modeling. The apps contain no AI: this gives the person's own assistant tools; Settings › Assistants (host.js) decides which.
 *
 * DOM-free kernel side (Node-testable): describeModel(model), boxPolys(w, d, h), cylinderPolys(r, h, sides), addSolid(model, polys,
 * name, at), moveInstance(model, iid, by), eraseInstances(model, ids). Each edit runs inside model.change('Assistant: …') = one
 * undo step. Solids come in as groups, so they never merge with what the person drew.
 * The page (modelcraft.js) calls installAgents({...}) once.
 */
import { meshDef, solidInfo } from './model.js';
import { parseLength, formatLength } from './units.js';
import { getHost, toolResult } from "./host.js";

const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** A length the assistant typed: a number in the model's display unit, or text the value box takes ("10'", "3.2m"). → meters. */
export function lengthOf(v, unit) {
  const m = typeof v === 'number' ? parseLength(String(v), unit) : parseLength(String(v ?? ''), unit);
  if (m === null || m === undefined || !Number.isFinite(m)) throw new Error('"' + v + '" is not a length.');
  return m;
}

/** The six faces of a w × d × h box from its lowest corner at the origin, outward. */
export function boxPolys(w, d, h) {
  return [
    [[0, 0, 0], [0, d, 0], [w, d, 0], [w, 0, 0]],
    [[0, 0, h], [w, 0, h], [w, d, h], [0, d, h]],
    [[0, 0, 0], [w, 0, 0], [w, 0, h], [0, 0, h]],
    [[w, d, 0], [0, d, 0], [0, d, h], [w, d, h]],
    [[0, d, 0], [0, 0, 0], [0, 0, h], [0, d, h]],
    [[w, 0, 0], [w, d, 0], [w, d, h], [w, 0, h]],
  ];
}

/** A cylinder of radius r and height h standing on the origin (its centre), `sides` facets. */
export function cylinderPolys(r, h, sides = 24) {
  const ring = (z) => Array.from({ length: sides }, (_, i) => { const a = (2 * Math.PI * i) / sides; return [r * Math.cos(a), r * Math.sin(a), z]; });
  const lo = ring(0), hi = ring(h);
  const polys = [lo.slice().reverse(), hi];
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; polys.push([lo[i], lo[j], hi[j], hi[i]]); }
  return polys;
}

const translate = (p) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];

/** A solid as a new group placed in the model at `at` (meters). → {instance, def, volume}. Call inside model.change. */
export function addSolid(model, polys, name, at) {
  const d = meshDef(model, polys, name, 'group');
  const info = solidInfo(d);
  const iid = model.place(model.root, d.id, translate(at));
  return { instance: iid, def: d.id, closed: info.closed, volume: info.volume };
}

export function moveInstance(model, iid, by) {
  const inst = model.root.insts.get(iid);
  if (!inst) throw new Error('There is no group or component ' + iid + ' in the model (model_describe lists them).');
  const m = inst.m.slice();
  m[12] += by[0]; m[13] += by[1]; m[14] += by[2];
  model.root.insts.set(iid, { ...inst, m });
}

export function eraseInstances(model, ids) {
  const bad = ids.filter((id) => !model.root.insts.has(id));
  if (bad.length) throw new Error('No groups or components ' + bad.join(', ') + ' in the model.');
  for (const id of ids) model.root.insts.delete(id);
}

export function describeModel(model) {
  const unit = model.units || 'm';
  const L = (m) => formatLength(m, unit);
  const bb = model.bbox();
  const root = solidInfo(model.root);
  const counts = new Map();
  for (const inst of model.root.insts.values()) counts.set(inst.def, (counts.get(inst.def) || 0) + 1);
  return {
    units: unit,
    extents: bb ? { min: bb.min.map(r6), max: bb.max.map(r6), size: [L(bb.max[0] - bb.min[0]), L(bb.max[1] - bb.min[1]), L(bb.max[2] - bb.min[2])] } : null,
    loose: { faces: root.faces, edges: root.edges },
    instances: [...model.root.insts.entries()].slice(0, 1000).map(([id, inst]) => {
      const d = model.defs.get(inst.def);
      const si = d ? solidInfo(d) : null;
      return { id, kind: d ? d.kind : null, name: inst.name || (d && d.name) || '', def: inst.def, at: [inst.m[12], inst.m[13], inst.m[14]].map(r6), faces: si ? si.faces : 0, solid: !!(si && si.closed), volumeM3: si && si.volume !== null ? r6(si.volume) : null };
    }),
    components: [...model.defs.values()].filter((d) => d.kind === 'component').map((d) => ({ def: d.id, name: d.name, copies: counts.get(d.id) || 0 })),
    scenes: (model.scenes || []).map((s) => s.name),
  };
}

/**
 * The live tools. `app` = {model, changed() (redraw + panels), canvas() → the 3D view's canvas, draw()}.
 */
export function installAgents(app) {
  const { model } = app;
  const C = getHost({ app: 'modelcraft' }).control;
  const PREFIX = 'Assistant: ';
  const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const len = { anyOf: [{ type: 'number', exclusiveMinimum: 0 }, { type: 'string', minLength: 1, maxLength: 40 }] };
  const lenAny = { anyOf: [{ type: 'number' }, { type: 'string', minLength: 1, maxLength: 40 }] };
  const pt = { type: 'array', items: lenAny, minItems: 2, maxItems: 3 };
  const unit = () => model.units || 'm';
  const P = (p) => [lengthOf(p[0], unit()), lengthOf(p[1], unit()), p.length > 2 ? lengthOf(p[2], unit()) : 0];
  const edit = (label, fn) => { const r = model.change(PREFIX + label, fn); app.changed(); return r; };
  C.configure({ title: 'ModelCraft', info: () => ({ units: unit(), groups: model.root.insts.size }) });
  C.tool({ name: 'app_info', group: 'read', title: 'About this window', description: 'ModelCraft\'s window: the model\'s display unit, how many groups and components it has, unsaved changes, and the permissions the person allowed.',
    run: async () => ({ app: 'modelcraft', title: 'ModelCraft', allowed: C.groups, units: unit(), instances: model.root.insts.size, unsaved: !!model.dirty }) });
  C.tool({ name: 'model_describe', group: 'read', title: 'Describe the model', description: 'The model: display unit, extents (meters, Z up) and size, loose faces and edges, every group and component placed (id, name, where, whether it is a closed solid, volume in m³), components and scenes.',
    run: async () => describeModel(model) });
  C.tool({ name: 'view_screenshot', group: 'read', title: 'Picture of the view', description: 'A PNG of the 3D view as shown (up to 1600 px on the long side).',
    inputSchema: obj({ maxSize: { type: 'integer', minimum: 200, maximum: 1600, default: 1200 } }),
    run: async (a) => {
      const c = app.canvas && app.canvas();
      if (!c || typeof document === 'undefined') throw new Error('No view to take a picture of.');
      if (app.draw) app.draw();
      const k = Math.min(1, a.maxSize / Math.max(c.width, c.height));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(c.width * k)); out.height = Math.max(1, Math.round(c.height * k));
      out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
      return toolResult([{ type: 'image', data: out.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' }], { width: out.width, height: out.height });
    } });
  C.tool({ name: 'box_add', group: 'edit', title: 'Add a box', description: 'A box as a new group: its lowest corner at `at` [x, y] or [x, y, z] and its size [width (x), depth (y), height (z)]. Numbers are in the model\'s display unit; text such as "10\'", "3.2m" or "600mm" works too. One undo step.',
    inputSchema: obj({ at: pt, size: { type: 'array', items: len, minItems: 3, maxItems: 3 }, name: { type: 'string', maxLength: 80 } }, ['size']),
    run: async (a) => {
      const [w, d, h] = a.size.map((v) => lengthOf(v, unit()));
      if (!(w > 0 && d > 0 && h > 0)) throw new Error('A box needs a width, depth and height above zero.');
      const at = a.at ? P(a.at) : [0, 0, 0];
      const r = edit('box', (m) => addSolid(m, boxPolys(w, d, h), a.name || 'Box', at));
      return { ...r, undo: PREFIX + 'box' };
    } });
  C.tool({ name: 'cylinder_add', group: 'edit', title: 'Add a cylinder', description: 'A cylinder as a new group standing on `center` [x, y] or [x, y, z], with a radius and a height (display unit, or text with a unit), 24 sides unless given. One undo step.',
    inputSchema: obj({ center: pt, radius: len, height: len, sides: { type: 'integer', minimum: 3, maximum: 96, default: 24 }, name: { type: 'string', maxLength: 80 } }, ['radius', 'height']),
    run: async (a) => {
      const r = lengthOf(a.radius, unit()), h = lengthOf(a.height, unit());
      if (!(r > 0 && h > 0)) throw new Error('A cylinder needs a radius and height above zero.');
      const at = a.center ? P(a.center) : [0, 0, 0];
      const res = edit('cylinder', (m) => addSolid(m, cylinderPolys(r, h, a.sides), a.name || 'Cylinder', at));
      return { ...res, undo: PREFIX + 'cylinder' };
    } });
  C.tool({ name: 'instance_move', group: 'edit', title: 'Move a group', description: 'Move a group or component (id from model_describe) by [dx, dy] or [dx, dy, dz]. One undo step.',
    inputSchema: obj({ id: { type: 'integer', minimum: 1 }, by: pt }, ['id', 'by']),
    run: async (a) => { const by = [lengthOf(a.by[0], unit()), lengthOf(a.by[1], unit()), a.by.length > 2 ? lengthOf(a.by[2], unit()) : 0]; edit('move', (m) => moveInstance(m, a.id, by)); return { moved: a.id, undo: PREFIX + 'move' }; } });
  C.tool({ name: 'instances_erase', group: 'edit', title: 'Erase groups', description: 'Erase groups or components placed in the model (ids from model_describe). One undo step.',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 1000 } }, ['ids']),
    run: async (a) => { edit('erase', (m) => eraseInstances(m, a.ids)); return { erased: a.ids.length, undo: PREFIX + 'erase' }; } });
  C.tool({ name: 'undo', group: 'edit', title: 'Undo', description: 'Undo the assistant\'s last steps (only steps labelled "Assistant:" unless any is true).',
    inputSchema: obj({ steps: { type: 'integer', minimum: 1, maximum: 100, default: 1 }, any: { type: 'boolean', default: false } }),
    run: async (a) => {
      const undone = [];
      for (let i = 0; i < a.steps; i++) {
        const top = model.undoStack[model.undoStack.length - 1];
        if (!top || (!a.any && !String(top.label).startsWith(PREFIX))) break;
        undone.push(model.undo());
      }
      app.changed();
      return { undone };
    } });
  return C;
}
