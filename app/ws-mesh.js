/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ws-mesh.js — the Mesh workspace (0.7 MD.2; session `mesh`): edit a mesh's vertices, edges and faces. Registers itself
 * (workspaces.js); the editing is the `meshedit` tool (mesh/edit-tool.js), so pointer, value box and Esc work as in every
 * tool. The page gives it `host` (modelcraft.js wsHost): {model, tools, cam, view, el, t, print, settings, path, sel,
 * setWorkspace, renderPanel, ask, askText, units, placeMesh(mesh, name) → path, selectPlacement(path)}.
 *
 * Opening it: the selected mesh placement is edited (Tab with the modeler keys, a double-click on a mesh, or the
 * switcher); a selected group or component is offered as a mesh first; with nothing selected the panel offers meshes to
 * add. Leaving it (the switcher, Tab, Back to Model) selects the mesh's placement again.
 *
 * Keys — both styles: 1 / 2 / 3 vertex / edge / face, Ctrl+B bevel (Ctrl+Shift+B vertices), Ctrl+R loop cut, K knife,
 * Delete delete. Modeler: G / R / S (G twice: slide), E extrude, I inset, F fill, M merge, X delete, Ctrl+X dissolve,
 * A all, Alt+A none, Ctrl+I invert, L linked under the pointer, Ctrl+L linked, Ctrl++ / Ctrl+− more / less, Alt+N flip,
 * O proportional, Shift+V vertex slide, Shift+E crease, Tab back to Model. Push-pull: M move, Q rotate, S scale, P push/pull
 * (extrude), F offset (inset), E erase, Shift+C crease, Ctrl+A all, Esc none (twice: back to Model), Space finishes.
 */
import { registerWorkspace } from './workspaces.js';
import { COMMANDS } from './mesh/edit-tool.js';
import { PRIMITIVES, makePrimitive } from './mesh/primitives.js';
import { FALLOFFS, creaseOfEdges } from './mesh/ops.js';
import { formatLength, parseLength } from './units.js';

const G = (cmd, icon) => ({ cmd: 'mesh-' + cmd, icon, labelKey: 'app.mesh.cmd.' + cmd, titleKey: 'app.mesh.cmd.' + cmd + '.title' });

export const MESH_WS = registerWorkspace({
  id: 'mesh', labelKey: 'app.ws.mesh', icon: 'triangle',
  groups: [
    { labelKey: 'app.mesh.group.select', items: [G('mode-vert', 'dot'), G('mode-edge', 'slash-lg'), G('mode-face', 'square-fill'), G('select-all', 'check2-all'), G('select-linked', 'diagram-2'), G('select-loop', 'arrow-repeat'), G('select-ring', 'circle'), G('select-more', 'plus-circle'), G('select-less', 'dash-circle')] },
    { labelKey: 'app.mesh.group.transform', items: [G('grab', 'arrows-move'), G('rotate', 'arrow-clockwise'), G('scale', 'arrows-angle-expand'), G('edge-slide', 'arrow-left-right'), G('prop-toggle', 'bullseye')] },
    { labelKey: 'app.mesh.group.shape', items: [G('extrude', 'box-arrow-up'), G('inset', 'bounding-box-circles'), G('bevel', 'bezier'), G('loopcut', 'distribute-vertical'), G('knife', 'scissors'), G('bisect', 'slash-square'), G('spin', 'arrow-counterclockwise'), G('subdivide', 'grid-3x3'), G('crease', 'vector-pen')] },
    { labelKey: 'app.mesh.group.join', items: [G('merge', 'intersect'), G('dissolve', 'eraser'), G('fill', 'square'), G('grid-fill', 'grid'), G('bridge', 'bezier2'), G('flip', 'arrow-down-up'), G('smooth', 'droplet'), G('delete', 'trash')] },
    { labelKey: 'app.mesh.group.mesh', items: [G('add', 'plus-square'), G('remesh', 'grid-3x3-gap'), G('done', 'box-arrow-left')] },
  ],
  enter(host) { return enter(host); },
  exit(host) { leave(host); },
  command(cmd, host) { return command(cmd.slice(5), host); },
  keydown(ev, host) { return keydown(ev, host); },
  renderPanel(host, box) { return panel(host, box); },
  toolState(cmd, host) {
    const name = cmd.slice(5);
    if (name === 'add' || name === 'done') return { ok: true };
    if (name === 'remesh') return editing(host) ? { ok: true } : { ok: false, why: host.t('app.mesh.why.no_mesh') };
    return editing(host) ? { ok: true } : { ok: false, why: host.t('app.mesh.why.no_mesh') };
  },
  changed(host) {
    const tool = editing(host);
    if (host.tools.name === 'meshedit' && (!tool || !tool.mesh)) { host.setWorkspace('model'); return; }
    tool?.show();
  },
});

const editing = (host) => (host.tools.name === 'meshedit' ? host.tools.tool : null);

function enter(host) {
  const { model, t } = host;
  const sel = host.sel, path = host.path;
  let target = host.meshPath || null;
  host.meshPath = null;
  if (!target && sel.length === 1 && sel[0].t === 'i') {
    const p = [...path, sel[0].id], d = model.context(p)?.def;
    if (d?.curve) { host.print(t('app.mesh.is_curve')); host.tools.set('select'); host.renderPanel(); return true; }   // MD.6: the Curve workspace edits it
    if (d?.mesh) target = p;
    else if (d) {
      // a group or component: it becomes a mesh first (one undo step), as Convert to mesh does
      try { model.change(t('app.undo.to_mesh'), (m) => m.toMesh(m.context(path).def, sel[0].id)); } catch (e) { host.print(e.message); return false; }
      target = p;
      host.print(t('app.mesh.converted'));
    }
  }
  if (!target) { host.tools.set('select'); host.print(t('app.mesh.pick_or_add')); host.renderPanel(); return true; }
  start(host, target);
  return true;
}
function start(host, path) {
  host.parentPath = path.slice(0, -1);
  host.setPath(path);   // the rest of the model fades, as round an open group
  host.tools.set('meshedit', { path });
  host.tools.tool.show();
  host.renderPanel();
  host.print(host.t('app.mesh.editing', { name: host.model.context(path)?.def.name || '' }));
}
function leave(host) {
  const tool = editing(host);
  const path = tool?.path;
  host.tools.set('select');
  host.view.setMeshEdit(null);
  if (path) { host.setPath(path.slice(0, -1)); host.selectPlacement(path); }
}

function command(name, host) {
  const { t } = host;
  if (name === 'done') { host.setWorkspace('model'); return true; }
  if (name === 'add') { addDialog(host); return true; }
  if (name === 'remesh') { remesh(host); return true; }
  const tool = editing(host);
  if (!tool) { host.print(t('app.mesh.why.no_mesh')); return false; }
  if (!COMMANDS.includes(name)) return false;
  const ok = tool.command(name, host.cursor());
  host.renderPanel();
  return ok;
}

/** The keys (see the header). → true when used. */
function keydown(e, host) {
  const tool = editing(host);
  const k = e.key, l = k.length === 1 ? k.toLowerCase() : k, ctrl = e.ctrlKey || e.metaKey, alt = e.altKey, shift = e.shiftKey;
  const B = host.settings.keys === 'blender';
  const run = (c) => { command(c, host); return true; };
  if (!tool) {
    if ((B && k === 'Tab') || (!B && k === 'Escape')) { host.setWorkspace('model'); return true; }
    return false;
  }
  // while an operation runs: Enter / Space finish, Esc cancels; G again turns a grab into a slide; the rest is its own
  if (tool.op) {
    if (k === 'Escape') { tool.op.cancel(); return true; }
    if (k === 'Enter' || (!B && k === ' ')) { tool.op.confirm?.(); return true; }
    if (B && l === 'g' && tool.op.kind === 'grab' && !ctrl) { tool.op.cancel(); tool.command('edge-slide', host.cursor()); return true; }
    if (B && (l === 'x' || l === 'y' || l === 'z') && !ctrl && tool.op.kind) return false;   // axis locks: the app's (as for any tool)
    if (ctrl && l === 'z') { tool.op.cancel(); return true; }
    return tool.op.key?.(k, e) || false;
  }
  if (!ctrl && !alt && (k === '1' || k === '2' || k === '3')) return run({ 1: 'mode-vert', 2: 'mode-edge', 3: 'mode-face' }[k]);
  if (ctrl && l === 'b') return run(shift ? 'bevel-verts' : 'bevel');
  if (ctrl && l === 'r') return run('loopcut');
  if (!ctrl && l === 'k') return run('knife');
  if (k === 'Delete') return run('delete');
  if (B) {
    if (k === 'Tab') { host.setWorkspace('model'); return true; }
    if (ctrl) {
      if (l === 'x') return run('dissolve');
      if (l === 'i') return run('select-invert');
      if (l === 'l') return run('select-linked');
      if (k === '+' || k === '=' || e.code === 'NumpadAdd') return run('select-more');
      if (k === '-' || e.code === 'NumpadSubtract') return run('select-less');
      return false;
    }
    if (alt && l === 'a') return run('select-none');
    if (alt && l === 'n') return run('flip');
    if (alt) return false;
    if (shift && l === 'v') return run('vertex-slide');
    if (shift && l === 'e') return run('crease');
    if (shift) return false;
    const map = { g: 'grab', r: 'rotate', s: 'scale', e: 'extrude', i: 'inset', f: 'fill', m: 'merge', x: 'delete', a: 'select-all', l: 'select-linked', o: 'prop-toggle' };
    if (map[l]) return run(map[l]);
    return false;
  }
  if (ctrl) {
    if (l === 'a') return run('select-all');
    if (l === 'i') return run('select-invert');
    return false;
  }
  if (k === 'Escape') {
    if (!tool.sel.empty()) return run('select-none');
    host.setWorkspace('model');
    return true;
  }
  if (shift && !alt && l === 'c') return run('crease');
  if (alt || shift) return false;
  const map = { m: 'grab', q: 'rotate', s: 'scale', p: 'extrude', f: 'inset', e: 'delete' };
  if (map[l]) return run(map[l]);
  return false;
}

/**
 * Voxel remesh (MD.8): the whole mesh made again as an even, closed mesh of triangles about the size asked. One undo step;
 * UVs, paint and creases are not kept (said).
 */
async function remesh(host) {
  const { t } = host, tool = editing(host);
  if (!tool) return;
  const me = tool.mesh, b = me.bounds();
  if (!b) return;
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const txt = await host.askText(t('app.mesh.remesh.h'), t('app.mesh.remesh.size'), formatLength(niceSize(size / 40) / 1, host.units));
  if (!txt) return;
  const voxel = parseLength(txt, host.units);
  if (!(voxel > 0)) { host.print(t('app.mesh.remesh.bad')); return; }
  const cells = [0, 1, 2].reduce((n, k) => n * (Math.ceil((b.max[k] - b.min[k] + 4 * voxel) / (voxel / 2)) + 1), 1);
  if (cells > 24e6) { host.print(t('app.mesh.remesh.too_fine', { size: formatLength(size / 140, host.units) })); return; }
  let M, R;
  try { host.print(t('app.mesh.remesh.working')); [M, R] = await Promise.all([import('./solids.js').then((L) => L.manifold()), import('./mesh/remesh.js')]); }
  catch (e) { host.print(t('app.mesh.remesh.failed')); return; }
  let res;
  try { res = R.voxelRemesh(M, me, { voxel }); } catch (e) { host.print(t('app.mesh.remesh.failed')); return; }
  if (!res.mesh.faceCount) { host.print(t('app.mesh.remesh.empty')); return; }
  tool.edit(t('app.mesh.undo.remesh'), (m) => {
    const all = [];
    for (let f = 0; f < m.nf; f++) if (!m.faceDead(f)) all.push(f);
    if (all.length) m.removeFaces(all);
    m.appendMesh(res.mesh);
  }, () => tool.sel.clear());
  host.print([t('app.mesh.remesh.done', { faces: res.mesh.faceCount }), ...res.notes.map((n) => t('app.mesh.remesh.note.' + n))].join(' '));
  host.renderPanel();
}

/** Add a mesh: a list of shapes; the one picked is placed at the view's centre on the ground, and edited. */
async function addDialog(host) {
  const { t, el } = host;
  const key = await host.ask({ title: t('app.mesh.add.h'), text: t('app.mesh.add.text'), buttons: [...PRIMITIVES.map((p) => [p, t('app.mesh.prim.' + p), 'btn-line btn-sm-cc']), ['cancel', t('app.btn.cancel'), 'btn-line btn-sm-cc']] });
  if (!key || key === 'cancel' || !PRIMITIVES.includes(key)) return;
  // a size in the model's own terms: about a fifth of what the view shows, rounded
  const s = niceSize(host.cam.height ? host.cam.height / 5 : host.cam.pixelSize() * host.view.h / 5);
  const opts = { plane: { size: s }, grid: { size: s, x: 10 }, cube: { size: s }, circle: { r: s / 2 }, cylinder: { r: s / 2, h: s }, cone: { r: s / 2, h: s }, uvsphere: { r: s / 2 }, icosphere: { r: s / 2 }, torus: { R: s / 2, r: s / 8 } }[key];
  const mesh = makePrimitive(key, opts);
  const path = host.placeMesh(mesh, t('app.mesh.prim.' + key));
  if (path) { if (editing(host)) host.tools.set('select'); start(host, path); }
  void el;
}
function niceSize(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** The right panel: what is selected, how it edits, the last operation's settings, or meshes to add. */
function panel(host, box) {
  const { t, el } = host;
  const tool = editing(host);
  if (!tool || !tool.mesh) {
    box.append(el('p', { className: 'mc-note' }, t('app.mesh.panel.none')),
      el('div', { className: 'mc-mesh-add' }, ...PRIMITIVES.map((p) => el('button', { type: 'button', className: 'btn-line btn-sm-cc', dataset: { meshAdd: p }, onclick: () => addPrimitive(host, p) }, t('app.mesh.prim.' + p)))));
    return t('app.ws.mesh');
  }
  const me = tool.mesh, c = tool.sel.counts(), I = { verts: me.vertexCount, faces: me.faceCount, edges: me.edgeCount };
  const props = el('div', { className: 'mc-props' });
  const row = (label, value) => props.append(el('span', { className: 'k' }, label), el('span', { className: 'v', dataset: { meshInfo: label } }, value));
  // the mode
  const modes = el('div', { className: 'mc-seg', role: 'group', 'aria-label': t('app.mesh.panel.mode') }, ...['vert', 'edge', 'face'].map((m) =>
    el('button', { type: 'button', className: 'btn-line btn-sm-cc', 'aria-pressed': String(tool.mode === m), dataset: { meshMode: m }, onclick: () => { tool.setMode(m); host.renderPanel(); } }, t('app.mesh.mode.' + m))));
  box.append(modes);
  row(t('app.mesh.panel.selected'), t('app.mesh.panel.counts', { v: c.verts, e: c.edges, f: c.faces }));
  row(t('app.mesh.panel.total'), t('app.mesh.panel.counts', { v: I.verts, e: I.edges, f: I.faces }));
  box.append(props);
  // the selected edges' crease for subdivision (MD.4)
  if (c.edges) {
    const cur = creaseOfEdges(me, tool.sel.edges());
    const cr = el('input', { type: 'text', className: 'mc-input', id: 'mc-crease', value: cur === null ? '' : String(Math.round(cur * 100) / 100), placeholder: t('app.mesh.crease.mixed'), spellcheck: false });
    cr.addEventListener('change', () => {
      const v = Number(cr.value);
      if (cr.value.trim() === '' || !Number.isFinite(v) || v < 0 || v > 1) { host.print(t('app.mesh.adjust.range', { min: 0, max: 1 })); return; }
      if (tool.setCrease(v)) host.renderPanel();
    });
    box.append(el('label', { for: 'mc-crease' }, t('app.mesh.crease.label')), cr);
  }
  // proportional editing
  const pr = tool.prop;
  const on = el('input', { type: 'checkbox', id: 'mc-prop-on', checked: pr.on, onchange: () => { pr.on = on.checked; host.renderPanel(); } });
  box.append(el('div', { className: 'mc-check' }, on, el('label', { for: 'mc-prop-on' }, t('app.mesh.prop.label'))));
  if (pr.on) {
    const rad = el('input', { type: 'text', className: 'mc-input', id: 'mc-prop-r', value: formatLength(pr.radius, host.units) });
    rad.addEventListener('change', () => { const v = parseLength(rad.value, host.units); if (v > 0) pr.radius = v; rad.value = formatLength(pr.radius, host.units); });
    const fo = el('select', { className: 'mc-select', id: 'mc-prop-f' }, ...FALLOFFS.map((f) => el('option', { value: f }, t('app.mesh.falloff.' + f))));
    fo.value = pr.falloff; fo.addEventListener('change', () => { pr.falloff = fo.value; });
    const cn = el('input', { type: 'checkbox', id: 'mc-prop-c', checked: pr.connected, onchange: () => { pr.connected = cn.checked; } });
    box.append(el('label', { for: 'mc-prop-r' }, t('app.mesh.prop.radius')), rad, el('label', { for: 'mc-prop-f' }, t('app.mesh.prop.falloff')), fo,
      el('div', { className: 'mc-check' }, cn, el('label', { for: 'mc-prop-c' }, t('app.mesh.prop.connected'))));
  }
  // retopology (MD.8): a surface to build this mesh on
  box.append(retopoSection(host, tool));
  // the modifier stack (MD.3)
  if (host.modPanel) box.append(host.modPanel(tool.defId));
  // Adjust last: the settings of what was just done
  const L = tool.last;
  if (L && host.model.lastStep() === L.step) {
    box.append(el('h3', { className: 'mc-h' }, t('app.mesh.adjust.h', { what: L.label })));
    const field = (name, kind, min, max) => {
      const id = 'mc-adj-' + name, cur = L.params[name];
      let inp;
      if (kind === 'bool') inp = el('input', { type: 'checkbox', id, checked: !!cur, onchange: () => tool.adjustLast({ [name]: inp.checked }) && host.renderPanel() });
      else inp = el('input', { type: 'text', className: 'mc-input', id, value: kind === 'len' ? formatLength(cur, host.units) : String(cur) });
      if (kind !== 'bool') inp.addEventListener('change', () => {
        let v = kind === 'len' ? parseLength(inp.value, host.units) : Number(inp.value);
        if (kind === 'int') v = Math.round(v);
        if (!Number.isFinite(v) || v < min || v > max) { host.print(t('app.mesh.adjust.range', { min, max })); return; }
        if (tool.adjustLast({ [name]: v })) host.renderPanel();
      });
      box.append(kind === 'bool' ? el('div', { className: 'mc-check' }, inp, el('label', { for: id }, t('app.mesh.param.' + name))) : el('label', { for: id }, t('app.mesh.param.' + name)), ...(kind === 'bool' ? [] : [inp]));
    };
    const F = { inset: [['thickness', 'len', 0, 1e6], ['depth', 'len', -1e6, 1e6], ['individual', 'bool']], bevel: [['width', 'len', 0, 1e6], ['segments', 'int', 1, 64], ['profile', 'num', 0, 1]],
      'bevel-verts': [['width', 'len', 0, 1e6]], subdivide: [['cuts', 'int', 1, 100]], smooth: [['factor', 'num', 0, 1], ['repeat', 'int', 1, 100]],
      'grid-fill': [['span', 'int', 0, 1e6], ['offset', 'int', -1e6, 1e6]], loopcut: [['cuts', 'int', 1, 100], ['slide', 'num', -1, 1]], spin: [['steps', 'int', 1, 512]] }[L.name] || [];
    for (const f of F) field(...f);
  }
  return t('app.ws.mesh');
}
function addPrimitive(host, p) {
  const s = niceSize(host.cam.height ? host.cam.height / 5 : 1);
  const opts = { plane: { size: s }, grid: { size: s, x: 10 }, cube: { size: s }, circle: { r: s / 2 }, cylinder: { r: s / 2, h: s }, cone: { r: s / 2, h: s }, uvsphere: { r: s / 2 }, icosphere: { r: s / 2 }, torus: { R: s / 2, r: s / 8 } }[p];
  const path = host.placeMesh(makePrimitive(p, opts), host.t('app.mesh.prim.' + p));
  if (path) start(host, path);
}

// for the UV workspace (MD.5), which edits the same mesh the same way and adds its UV editor
export { enter as enterMeshEdit, leave as leaveMeshEdit, keydown as meshKeydown, editing as meshEditing };

/** The panel's Retopology section: the target, snapping moved points onto it, projecting the selection, in front. */
function retopoSection(host, tool) {
  const { t, el, model } = host;
  const rt = host.tools.retopo || (host.tools.retopo = { target: '', snap: false, front: false });
  const placed = new Set();
  model.walk((d) => { placed.add(d.id); });
  const opts = [...model.defs.values()].filter((d) => d.id !== 'root' && d.id !== tool.defId && placed.has(d.id) && !d.lattice);
  if (rt.target && !opts.some((d) => d.id === rt.target)) rt.target = '';
  const sec = el('section', { className: 'mc-mods', dataset: { retopo: '' } }, el('h3', { className: 'mc-h' }, t('app.mesh.retopo.h')));
  const sel = el('select', { id: 'mc-retopo-target', className: 'mc-select', onchange: (e) => { rt.target = e.target.value; rt._key = null; host.renderPanel(); } },
    el('option', { value: '' }, t('app.mod.o.none')), ...opts.map((d) => el('option', { value: d.id }, d.name)));
  sel.value = rt.target;
  const chk = (id, label, on, put) => el('div', { className: 'mc-check' }, el('input', { type: 'checkbox', id, checked: !!on, disabled: !rt.target, onchange: (e) => { put(e.target.checked); rt._key = null; tool.show(); host.view.invalidate(); } }), el('label', { for: id }, label));
  sec.append(el('label', { for: 'mc-retopo-target' }, t('app.mesh.retopo.target')), sel,
    chk('mc-retopo-snap', t('app.mesh.retopo.snap'), rt.snap, (v) => { rt.snap = v; }),
    chk('mc-retopo-front', t('app.mesh.retopo.front'), rt.front, (v) => { rt.front = v; }),
    el('button', { type: 'button', className: 'btn-line btn-sm-cc', dataset: { retopoProject: '' }, disabled: !rt.target, onclick: () => {
      const n = tool.projectSelected();
      host.print(n < 0 ? t('app.mesh.retopo.no_target') : t('app.mesh.retopo.projected', { n }));
      host.renderPanel();
    } }, t('app.mesh.retopo.project')));
  return sec;
}

