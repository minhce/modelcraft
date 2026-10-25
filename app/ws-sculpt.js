/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ws-sculpt.js — the Sculpt workspace (0.7 MD.7): brushes on a mesh (mesh/sculpt-tool.js, mesh/sculpt.js). Follows
 * PartCraft's workspace pattern through workspaces.js. The mask shows darker while it is open.
 *
 * Keys — both styles: D draw, C clay, S smooth, G grab, I inflate, Shift+C crease, P pinch, T flatten, M mask; [ and ]
 * the brush's size, Shift+[ and Shift+] its strength; Ctrl while stroking takes away, Shift smooths; X symmetry; Alt+M
 * clears the mask, Ctrl+I turns it over; Esc (Tab with the modeler keys) back to Model.
 */
import { registerWorkspace } from './workspaces.js';
import { BRUSHES, SCULPT_DEFAULTS } from './mesh/sculpt-tool.js';
import { Sculptor } from './mesh/sculpt.js';

const ICON = { draw: 'brush', clay: 'layers', smooth: 'droplet', grab: 'hand-index', inflate: 'circle', crease: 'slash-lg', pinch: 'arrows-angle-contract', flatten: 'dash-lg', mask: 'mask' };
const G = (cmd, icon) => ({ cmd: 'sculpt-' + cmd, icon, labelKey: 'app.sculpt.cmd.' + cmd, titleKey: 'app.sculpt.cmd.' + cmd + '.title' });

export const SCULPT_WS = registerWorkspace({
  id: 'sculpt', labelKey: 'app.ws.sculpt', icon: 'brush',
  groups: [
    { labelKey: 'app.sculpt.group.brush', items: BRUSHES.map((b) => G(b, ICON[b])) },
    { labelKey: 'app.sculpt.group.options', items: [G('invert', 'dash-circle'), G('symmetry', 'symmetry-vertical'), G('detail', 'triangle'), G('mask-clear', 'eraser'), G('mask-invert', 'circle-half'), G('done', 'box-arrow-left')] },
  ],
  enter(host) { return enter(host); },
  exit(host) { leave(host); },
  command(cmd, host) { return command(cmd.slice(7), host); },
  keydown(ev, host) { return keydown(ev, host); },
  renderPanel(host, box) { return panel(host, box); },
  toolState(cmd, host) {
    const name = cmd.slice(7), set = settings(host);
    if (name === 'done') return { ok: true };
    if (!sculpting(host)) return { ok: false, why: host.t('app.mesh.why.no_mesh') };
    if (BRUSHES.includes(name)) return { ok: true, pressed: set.brush === name };
    if (name === 'invert') return { ok: true, pressed: !!set.invert };
    if (name === 'symmetry') return { ok: true, pressed: set.sym === 'x' };
    if (name === 'detail') return { ok: true, pressed: set.detail > 0 };
    return { ok: true };
  },
  changed(host) {
    const tool = sculpting(host);
    if (host.tools.name === 'meshsculpt' && (!tool || !tool.mesh)) host.setWorkspace('model');
  },
});

const sculpting = (host) => (host.tools.name === 'meshsculpt' ? host.tools.tool : null);
const settings = (host) => host.tools.meshSculpt || (host.tools.meshSculpt = { ...SCULPT_DEFAULTS });

function enter(host) {
  const { model, t } = host;
  let target = host.meshPath || null;
  host.meshPath = null;
  if (!target && host.sel.length === 1 && host.sel[0].t === 'i') {
    const p = [...host.path, host.sel[0].id], d = model.context(p)?.def;
    if (d?.curve) host.print(t('app.mesh.is_curve'));
    else if (d?.mesh) target = p;
    else if (d) {
      // a group or component becomes a mesh first (one undo step), as in the Mesh workspace
      try { model.change(t('app.undo.to_mesh'), (m) => m.toMesh(m.context(host.path).def, host.sel[0].id)); } catch (e) { host.print(e.message); return false; }
      target = p;
      host.print(t('app.mesh.converted'));
    }
  }
  if (!target) { host.tools.set('select'); host.print(t('app.sculpt.pick')); host.renderPanel(); return true; }
  host.parentPath = target.slice(0, -1);
  host.setPath(target);
  host.tools.set('meshsculpt', { path: target });
  host.view.showMask = true; host.view.dropCache(); host.view.builtFor = null;
  host.tip(host.tools.tool.hint);
  host.renderPanel();
  host.print(t('app.sculpt.editing', { name: model.context(target)?.def.name || '' }));
  return true;
}
function leave(host) {
  const tool = sculpting(host), path = tool?.path;
  host.tools.set('select');
  host.view.showMask = false; host.view.dropCache(); host.view.builtFor = null;
  host.tools.host.overlay?.(null);
  if (path) { host.setPath(path.slice(0, -1)); host.selectPlacement(path); }
  host.view.invalidate();
}

function command(name, host) {
  const { t } = host, set = settings(host), tool = sculpting(host);
  if (name === 'done') { host.setWorkspace('model'); return true; }
  if (!tool) { host.print(t('app.mesh.why.no_mesh')); return false; }
  const after = () => { host.tip(tool.hint); host.renderPanel(); };
  if (BRUSHES.includes(name)) { set.brush = name; after(); return true; }
  switch (name) {
    case 'invert': set.invert = !set.invert; after(); return true;
    case 'symmetry': set.sym = set.sym === 'x' ? '' : 'x'; host.print(t(set.sym ? 'app.sculpt.sym.on' : 'app.sculpt.sym.off')); after(); return true;
    case 'detail': return toggleDetail(host, tool, set);
    case 'mask-clear':
    case 'mask-invert':
      try { host.model.meshEdit(tool.defId, t('app.sculpt.undo.' + name.replace('-', '_')), (m) => { const S = new Sculptor(m); return name === 'mask-clear' ? S.maskAll(0) : S.maskInvert(); }); } catch (e) { host.print(e.message); return false; }
      tool.S = null; host.view.dropCache(); host.changed(); after();
      return true;
    default: return false;
  }
}
/** Dynamic detail needs triangles: a mesh with bigger faces is made of triangles first (asked, one undo step). */
async function toggleDetail(host, tool, set) {
  const { t } = host;
  if (set.detail > 0) { set.detail = 0; host.print(t('app.sculpt.detail.off')); host.renderPanel(); return true; }
  const m = tool.mesh;
  let big = 0;
  for (let f = 0; f < m.nf; f++) if (!m.faceDead(f) && m.faceSize(f) !== 3) big++;
  if (big) {
    const ok = await host.ask({ title: t('app.sculpt.detail.h'), text: t('app.sculpt.detail.triangulate', { n: big }), buttons: [['yes', t('app.sculpt.detail.yes'), 'btn-plot btn-sm-cc'], ['no', t('app.btn.cancel'), 'btn-line btn-sm-cc']] });
    if (ok !== 'yes') return false;
    try { host.model.meshEdit(tool.defId, t('app.sculpt.undo.triangulate'), (me) => triangulateAll(me)); } catch (e) { host.print(e.message); return false; }
    tool.S = null; host.changed();
  }
  set.detail = 8;
  host.print(t('app.sculpt.detail.on', { px: set.detail }));
  host.renderPanel();
  return true;
}
/** Every face bigger than a triangle made of triangles (its corners' layers kept). */
export function triangulateAll(m) {
  const T = m.triangulate({ hidden: true }), byFace = new Map();
  for (let i = 0; i < T.n; i++) { const f = T.face[i]; if (m.faceSize(f) === 3) continue; let l = byFace.get(f); if (!l) byFace.set(f, (l = [])); l.push([T.tri[i * 3], T.tri[i * 3 + 1], T.tri[i * 3 + 2]]); }
  if (!byFace.size) return 0;
  const remove = [...byFace.keys()], add = [];
  for (const [f, tris] of byFace) for (const tr of tris) add.push({ verts: tr.map((h) => m.hV[h]), mat: m.fMat[f], from: f, corners: tr });
  m.replaceFaces(remove, add);
  return remove.length;
}

function keydown(e, host) {
  const tool = sculpting(host), set = settings(host);
  const k = e.key, l = k.length === 1 ? k.toLowerCase() : k, ctrl = e.ctrlKey || e.metaKey, alt = e.altKey, shift = e.shiftKey;
  const B = host.settings.keys === 'blender';
  const run = (c) => { command(c, host); host.renderPanel(); return true; };
  if ((B && k === 'Tab') || k === 'Escape') { if (tool?.stroke) { tool.escapeStep(); return true; } host.setWorkspace('model'); return true; }
  if (!tool) return false;
  if (ctrl && l === 'i') return run('mask-invert');
  if (alt && l === 'm') return run('mask-clear');
  if (ctrl || alt) return false;
  if (k === '[' || k === ']' || k === '{' || k === '}') {
    const up = k === ']' || k === '}';
    if (shift || k === '{' || k === '}') set.strength = Math.round(Math.max(0.05, Math.min(1, set.strength + (up ? 0.05 : -0.05))) * 100) / 100;
    else set.radius = Math.round(Math.max(4, Math.min(400, set.radius * (up ? 1.15 : 1 / 1.15))));
    host.tip(host.t('app.sculpt.size', { px: set.radius, s: set.strength }));
    host.renderPanel();
    return true;
  }
  if (shift && l === 'c') return run('crease');
  if (shift) return false;
  const map = { d: 'draw', c: 'clay', s: 'smooth', g: 'grab', i: 'inflate', p: 'pinch', t: 'flatten', m: 'mask', x: 'symmetry' };
  if (map[l]) return run(map[l]);
  return false;
}

function panel(host, box) {
  const { t, el } = host;
  const tool = sculpting(host), set = settings(host);
  if (!tool || !tool.mesh) { box.append(el('p', { className: 'mc-note' }, t('app.sculpt.panel.none'))); return t('app.ws.sculpt'); }
  const props = el('div', { className: 'mc-props mc-mod-props' });
  const field = (id, label, input) => props.append(el('label', { for: id, className: 'k' }, label), el('span', { className: 'v' }, input));
  const br = el('select', { id: 'mc-sculpt-brush', className: 'mc-select', onchange: (e) => { set.brush = e.target.value; host.tip(tool.hint); host.renderPanel(); } }, ...BRUSHES.map((b) => el('option', { value: b }, t('app.sculpt.brush.' + b))));
  br.value = set.brush;
  field('mc-sculpt-brush', t('app.sculpt.panel.brush'), br);
  const num = (id, value, min, max, put, step = 'any') => { const i = el('input', { type: 'number', id, className: 'mc-input', value: String(value), min: String(min), max: String(max), step }); i.addEventListener('change', () => { const v = Number(i.value); if (!(v >= min && v <= max)) { host.print(t('app.mesh.adjust.range', { min, max })); i.value = String(value); return; } put(v); host.renderPanel(); }); return i; };
  field('mc-sculpt-radius', t('app.sculpt.panel.radius'), num('mc-sculpt-radius', set.radius, 4, 400, (v) => { set.radius = Math.round(v); }, '1'));
  field('mc-sculpt-strength', t('app.sculpt.panel.strength'), num('mc-sculpt-strength', set.strength, 0.01, 1, (v) => { set.strength = v; }, '0.05'));
  const chk = (id, label, on, put) => field(id, label, el('input', { type: 'checkbox', id, checked: !!on, onchange: (e) => { put(e.target.checked); host.renderPanel(); } }));
  chk('mc-sculpt-invert', t('app.sculpt.panel.invert'), set.invert, (v) => { set.invert = v; });
  chk('mc-sculpt-sym', t('app.sculpt.panel.sym'), set.sym === 'x', (v) => { set.sym = v ? 'x' : ''; });
  chk('mc-sculpt-psize', t('app.sculpt.panel.psize'), set.pressureSize, (v) => { set.pressureSize = v; });
  chk('mc-sculpt-pstrength', t('app.sculpt.panel.pstrength'), set.pressureStrength, (v) => { set.pressureStrength = v; });
  if (set.detail > 0) field('mc-sculpt-detail', t('app.sculpt.panel.detail'), num('mc-sculpt-detail', set.detail, 2, 100, (v) => { set.detail = v; }, '1'));
  const me = tool.mesh;
  props.append(el('span', { className: 'k' }, t('app.mesh.panel.total')), el('span', { className: 'v', dataset: { sculptInfo: '' } }, t('app.mesh.panel.counts', { v: me.vertexCount, e: me.edgeCount, f: me.faceCount })));
  box.append(props, el('p', { className: 'mc-note' }, t('app.sculpt.panel.how')));
  return t('app.ws.sculpt');
}
