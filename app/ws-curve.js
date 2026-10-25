/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ws-curve.js — the Curve workspace (0.7 MD.6): edit a curve object's points (mesh/curve-tool.js) and its shape
 * (mesh/curve-panel.js); add Bézier, NURBS and poly curves and text as a curve. Follows PartCraft's workspace pattern
 * through workspaces.js. A curve object is opened by a double-click, or by selecting it and choosing Curve.
 *
 * Keys — both styles: A all (push-pull: Ctrl+A), Esc none (twice: back to Model), Delete / X delete, E extrude (a point
 * at the pointer; Ctrl+click too), W subdivide, C cyclic, Shift+R reverse, V / Shift+V / Alt+V auto / vector / free
 * handles; modeler G / R / S, push-pull M / Q / S move, turn, scale. Tab (modeler) back to Model.
 */
import { registerWorkspace } from './workspaces.js';
import { CURVE_COMMANDS } from './mesh/curve-tool.js';
import { newCurve, curveMesh } from './mesh/curve.js';
import { curvePanel } from './mesh/curve-panel.js';
import { Mesh } from './mesh.js';

const G = (cmd, icon) => ({ cmd: 'curve-' + cmd, icon, labelKey: 'app.curve.cmd.' + cmd, titleKey: 'app.curve.cmd.' + cmd + '.title' });
const KINDS = ['bezier', 'bezier-circle', 'nurbs', 'nurbs-circle', 'path', 'text'];

export const CURVE_WS = registerWorkspace({
  id: 'curve', labelKey: 'app.ws.curve', icon: 'bezier2',
  groups: [
    { labelKey: 'app.curve.group.points', items: [G('select-all', 'check2-all'), G('extrude', 'plus-circle'), G('subdivide', 'three-dots'), G('delete', 'trash'), G('grab', 'arrows-move'), G('rotate', 'arrow-clockwise'), G('scale', 'arrows-angle-expand')] },
    { labelKey: 'app.curve.group.spline', items: [G('cyclic', 'arrow-repeat'), G('reverse', 'arrow-left-right'), G('handles-auto', 'bezier'), G('handles-vector', 'slash-lg'), G('handles-free', 'vector-pen')] },
    { labelKey: 'app.curve.group.type', items: [G('type-bezier', 'bezier2'), G('type-nurbs', 'activity'), G('type-poly', 'graph-up')] },
    { labelKey: 'app.curve.group.curve', items: [G('add', 'plus-square'), G('to-mesh', 'box'), G('done', 'box-arrow-left')] },
  ],
  enter(host) { return enter(host); },
  exit(host) { leave(host); },
  command(cmd, host) { return command(cmd.slice(6), host); },
  keydown(ev, host) { return keydown(ev, host); },
  renderPanel(host, box) { return panel(host, box); },
  toolState(cmd, host) {
    const name = cmd.slice(6);
    if (name === 'add' || name === 'done') return { ok: true };
    return editing(host) ? { ok: true } : { ok: false, why: host.t('app.curve.why.no_curve') };
  },
  changed(host) {
    const tool = editing(host);
    if (host.tools.name === 'curveedit' && (!tool || !tool.curve)) { host.setWorkspace('model'); return; }
    tool?.show();
  },
});

const editing = (host) => (host.tools.name === 'curveedit' ? host.tools.tool : null);

function enter(host) {
  const { model, t } = host;
  let target = host.meshPath || null;
  host.meshPath = null;
  if (!target && host.sel.length === 1 && host.sel[0].t === 'i') {
    const p = [...host.path, host.sel[0].id], d = model.context(p)?.def;
    if (d?.curve) target = p;
    else if (d) { host.print(t('app.curve.not_a_curve')); }
  }
  if (!target) { host.tools.set('select'); host.print(t('app.curve.pick_or_add')); host.renderPanel(); return true; }
  start(host, target);
  return true;
}
function start(host, path) {
  host.parentPath = path.slice(0, -1);
  host.setPath(path);
  host.tools.set('curveedit', { path });
  host.tools.tool.show();
  host.renderPanel();
  host.print(host.t('app.curve.editing', { name: host.model.context(path)?.def.name || '' }));
}
function leave(host) {
  const tool = editing(host), path = tool?.path;
  host.tools.set('select');
  host.view.setCurveEdit(null);
  if (path) { host.setPath(path.slice(0, -1)); host.selectPlacement(path); }
}

function command(name, host) {
  const { t } = host;
  if (name === 'done') { host.setWorkspace('model'); return true; }
  if (name === 'add') { addDialog(host); return true; }
  const tool = editing(host);
  if (!tool) { host.print(t('app.curve.why.no_curve')); return false; }
  if (name === 'to-mesh') { const ok = toMesh(host, tool.defId); if (ok) host.setWorkspace('model'); return ok; }
  if (!CURVE_COMMANDS.includes(name)) return false;
  const ok = tool.command(name, host.cursor());
  host.renderPanel();
  return ok;
}
/** The curve object becomes a mesh (what it shows now, modifiers still on top), one undo step. */
export function toMesh(host, defId) {
  const d = host.model.def(defId);
  if (!d?.curve) return false;
  const made = curveMesh(d.curve);
  if (!made.faceCount) { host.print(host.t('app.curve.nothing_to_mesh')); return false; }
  try {
    host.model.meshEdit(defId, host.t('app.curve.undo.to_mesh'), (me, dd) => {
      const all = [];
      for (let f = 0; f < me.nf; f++) if (!me.faceDead(f)) all.push(f);
      if (all.length) me.removeFaces(all);
      me.appendMesh(made);
      dd.curve = null;
    });
  } catch (e) { host.print(e.message); return false; }
  host.print(host.t('app.curve.to_mesh.done', { faces: made.faceCount }));
  return true;
}

function keydown(e, host) {
  const tool = editing(host);
  const k = e.key, l = k.length === 1 ? k.toLowerCase() : k, ctrl = e.ctrlKey || e.metaKey, alt = e.altKey, shift = e.shiftKey;
  const B = host.settings.keys === 'blender';
  const run = (c) => { command(c, host); return true; };
  if (!tool) {
    if ((B && k === 'Tab') || (!B && k === 'Escape')) { host.setWorkspace('model'); return true; }
    return false;
  }
  if (tool.op) {
    if (k === 'Escape') { tool.op.cancel(); return true; }
    if (k === 'Enter' || (!B && k === ' ')) { tool.op.confirm?.(); return true; }
    return tool.op.key?.(k, e) || false;
  }
  if (k === 'Delete' || (B && l === 'x' && !ctrl)) return run('delete');
  if (B && k === 'Tab') { host.setWorkspace('model'); return true; }
  if (k === 'Escape') { if (tool.sel.size) return run('select-none'); host.setWorkspace('model'); return true; }
  if (ctrl) { if (l === 'a') return run('select-all'); return false; }
  if (l === 'v') return run(alt ? 'handles-free' : shift ? 'handles-vector' : 'handles-auto');
  if (alt) { if (B && l === 'a') return run('select-none'); return false; }
  if (shift) { if (l === 'r') return run('reverse'); return false; }
  const map = B ? { a: 'select-all', e: 'extrude', w: 'subdivide', c: 'cyclic', g: 'grab', r: 'rotate', s: 'scale' } : { e: 'extrude', w: 'subdivide', c: 'cyclic', m: 'grab', q: 'rotate', s: 'scale' };
  if (map[l]) return run(map[l]);
  return false;
}

/** Add a curve: a list; the one picked is placed at the view's centre on the ground, open for editing. */
async function addDialog(host) {
  const { t } = host;
  const key = await host.ask({ title: t('app.curve.add.h'), text: t('app.curve.add.text'), buttons: [...KINDS.map((k) => [k, t('app.curve.kind.' + k), 'btn-line btn-sm-cc']), ['cancel', t('app.btn.cancel'), 'btn-line btn-sm-cc']] });
  if (!key || !KINDS.includes(key)) return;
  const size = niceSize(host.cam.height ? host.cam.height / 5 : host.cam.pixelSize() * host.view.h / 5);
  let curve;
  if (key === 'text') {
    const str = await host.askText(t('app.curve.text.h'), t('app.curve.text'), t('app.curve.text.default'));
    if (!str) return;
    curve = await textCurve(host, str, size / 2);
    if (!curve) return;
  } else curve = newCurve(key, size);
  const path = host.placeMesh(new Mesh(), t('app.curve.kind.' + key), { curve, label: t('app.curve.undo.add') });
  if (path) { if (editing(host)) host.tools.set('select'); start(host, path); }
}
function niceSize(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
/** Text as a curve object: the letters' outlines (our single-stroke font given a pen width) as closed flat splines, filled. */
export async function textCurve(host, str, height, weight = 0.14) {
  let M, T;
  try { host.print(host.t('app.text3d.loading')); [T, M] = await Promise.all([import('./text3d.js'), import('./solids.js').then((L) => L.manifold())]); }
  catch (e) { host.print(host.t('app.curve.text.failed')); return null; }
  const cs = T.textOutlines(M, str, { height, weight }), loops = cs.toPolygons();
  cs.delete?.();
  if (!loops.length) { host.print(host.t('app.curve.text.empty')); return null; }
  const splines = loops.map((L) => ({ type: 'poly', cyclic: true, resolution: 1, order: 4, points: L.map(([x, y]) => ({ p: [x, y, 0], hl: [x, y, 0], hr: [x, y, 0], h: 'vector', w: 1, radius: 1, tilt: 0 })) }));
  return { dim: '2d', fill: true, extrude: height * 0.05, bevel: { depth: 0, resolution: 2 }, caps: true, taper: [1], splines, text: { string: str, height, weight } };
}

function panel(host, box) {
  const { t, el } = host;
  const tool = editing(host);
  if (!tool || !tool.curve) {
    box.append(el('p', { className: 'mc-note' }, t('app.curve.panel.none')),
      el('button', { type: 'button', className: 'btn-line btn-sm-cc', dataset: { curveAdd: '' }, onclick: () => addDialog(host) }, t('app.curve.cmd.add')));
    return t('app.ws.curve');
  }
  if (host.curvePanel) box.append(host.curvePanel(tool.defId, tool.selPoints()));
  if (host.modPanel) box.append(host.modPanel(tool.defId));
  return t('app.ws.curve');
}
