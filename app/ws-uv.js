/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ws-uv.js — the UV workspace (0.7 MD.5): the mesh open as in the Mesh workspace (the same tool, keys and selection) with
 * a UV editor beside the 3D view. Seams, unwrap (angle-based or conformal), projections (box, cylinder, sphere, as seen),
 * packing, a checker preview and a stretch display. Every change is one undo step on the mesh (mesh/uv.js inside
 * meshEdit). Follows PartCraft's workspace pattern through workspaces.js; the 3D view narrows to the left half while the
 * workspace is open (`.mc-stage-uv`).
 *
 * Keys — both styles: U unwrap, Ctrl+E mark seams on the selected edges, Ctrl+Shift+E clear them; over the UV editor G /
 * R / S move, turn, scale the selected faces' UVs, L their island, F fit the square; the rest as in the Mesh workspace.
 */
import { registerWorkspace } from './workspaces.js';
import { enterMeshEdit, leaveMeshEdit, meshKeydown, meshEditing } from './ws-mesh.js';
import * as U from './mesh/uv.js';
import { UVEditor } from './mesh/uv-editor.js';
import { apply } from './vec.js';

const G = (cmd, icon) => ({ cmd: 'uv-' + cmd, icon, labelKey: 'app.uv.cmd.' + cmd, titleKey: 'app.uv.cmd.' + cmd + '.title' });
const st = { editor: null, box: null, preview: null, stretchMode: 'angle', margin: 0.01 };
const SELECT = ['mode-edge', 'mode-face', 'select-all', 'select-linked'];

export const UV_WS = registerWorkspace({
  id: 'uv', labelKey: 'app.ws.uv', icon: 'grid-3x3-gap',
  groups: [
    { labelKey: 'app.uv.group.select', items: [G('mode-edge', 'slash-lg'), G('mode-face', 'square-fill'), G('select-all', 'check2-all'), G('select-linked', 'diagram-2')] },
    { labelKey: 'app.uv.group.seams', items: [G('seam-mark', 'scissors'), G('seam-clear', 'eraser'), G('seam-sharp', 'bezier2'), G('seam-islands', 'bounding-box')] },
    { labelKey: 'app.uv.group.unwrap', items: [G('unwrap', 'map'), G('unwrap-conformal', 'map-fill'), G('project-box', 'box'), G('project-cylinder', 'cup'), G('project-sphere', 'globe'), G('project-view', 'camera')] },
    { labelKey: 'app.uv.group.arrange', items: [G('pack', 'grid-1x2'), G('rotate90', 'arrow-clockwise'), G('flip-u', 'symmetry-vertical')] },
    { labelKey: 'app.uv.group.show', items: [G('checker', 'grid-3x3'), G('stretch', 'thermometer-half'), G('done', 'box-arrow-left')] },
  ],
  enter(host) { return enter(host); },
  exit(host) { exit(host); },
  command(cmd, host) { return command(cmd.slice(3), host); },
  keydown(ev, host) { return keydown(ev, host); },
  renderPanel(host, box) { return panel(host, box); },
  toolState(cmd, host) {
    const name = cmd.slice(3);
    if (name === 'done') return { ok: true };
    if (!meshEditing(host)) return { ok: false, why: host.t('app.mesh.why.no_mesh') };
    if (name === 'checker' || name === 'stretch') return { ok: true, pressed: st.preview === name };
    return { ok: true };
  },
  changed(host) {
    const tool = meshEditing(host);
    if (host.tools.name === 'meshedit' && (!tool || !tool.mesh)) { host.setWorkspace('model'); return; }
    tool?.show();
    refresh(host);
  },
});

function enter(host) {
  if (enterMeshEdit(host) === false) return false;
  // the UV editor: the right half of the stage
  const stage = host.stage;
  stage.classList.add('mc-stage-uv');
  st.box = host.el('div', { className: 'mc-uv', dataset: { uvEditor: '' } });
  stage.append(st.box);
  st.editor = new UVEditor(host, st.box);
  const tool = meshEditing(host);
  if (tool) { st.editor.attach(tool); host.tip(host.t('app.uv.hint.editor')); }
  setPreview(host, st.preview);
  return true;
}
function exit(host) {
  host.view.uvPreview = null; host.view.builtFor = null;
  st.editor?.destroy(); st.editor = null;
  st.box?.remove(); st.box = null;
  host.stage.classList.remove('mc-stage-uv');
  leaveMeshEdit(host);
  host.view.invalidate();
}
/** The editor and the preview follow the mesh (after an edit, an undo, a new selection). */
function refresh(host) {
  const tool = meshEditing(host);
  if (!st.editor) return;
  if (tool && st.editor.tool !== tool) st.editor.attach(tool);
  st.editor.stretch = st.preview === 'stretch' && tool ? U.stretch(tool.mesh, st.stretchMode) : null;
  st.editor.draw();
}
function setPreview(host, mode) {
  st.preview = mode;
  const tool = meshEditing(host);
  host.view.uvPreview = mode && tool ? { defId: tool.defId, mode, stretch: (m) => U.stretch(m, st.stretchMode) } : null;
  host.view.builtFor = null; host.view.invalidate();
  refresh(host); host.renderPanel();
}

/** The faces an operation works on: the selected ones, else every face. */
const facesOf = (tool) => tool.sel.faces();
function command(name, host) {
  const { t } = host;
  if (name === 'done') { host.setWorkspace('model'); return true; }
  const tool = meshEditing(host);
  if (!tool) { host.print(t('app.mesh.why.no_mesh')); return false; }
  const run = (labelKey, fn, msg) => {
    const r = tool.edit(t(labelKey), fn);
    if (r === null) return false;
    if (msg) host.print(msg(r));
    refresh(host); host.renderPanel();
    return true;
  };
  if (SELECT.includes(name)) { const ok = tool.command(name, host.cursor()); refresh(host); host.renderPanel(); return ok; }
  switch (name) {
    case 'seam-mark':
    case 'seam-clear': {
      const es = tool.sel.edges();
      if (!es.length) { host.print(t('app.uv.need_edges')); return false; }
      return run(name === 'seam-mark' ? 'app.uv.undo.seam_mark' : 'app.uv.undo.seam_clear', (m) => U.markSeams(m, es, name === 'seam-mark'), (n) => t(name === 'seam-mark' ? 'app.uv.seams.marked' : 'app.uv.seams.cleared', { n }));
    }
    case 'seam-sharp': return run('app.uv.undo.seam_mark', (m) => U.seamsFromSharp(m, 60), (n) => t('app.uv.seams.marked', { n }));
    case 'seam-islands': return run('app.uv.undo.seam_mark', (m) => U.seamsFromIslands(m), (n) => t('app.uv.seams.marked', { n }));
    case 'unwrap':
    case 'unwrap-conformal': {
      const faces = facesOf(tool), method = name === 'unwrap' ? 'angle' : 'conformal';
      return run('app.uv.undo.unwrap', (m) => U.unwrap(m, faces, { method, margin: st.margin }), (r) => [t('app.uv.unwrapped', { n: r.islands }), ...r.notes.map((n) => t('app.uv.note.' + n))].join(' '));
    }
    case 'project-box': return run('app.uv.undo.project', (m) => U.projectBox(m, facesOf(tool)), (n) => t('app.uv.projected', { n }));
    case 'project-cylinder': return run('app.uv.undo.project', (m) => U.projectCylinder(m, facesOf(tool)), (n) => t('app.uv.projected', { n }));
    case 'project-sphere': return run('app.uv.undo.project', (m) => U.projectSphere(m, facesOf(tool)), (n) => t('app.uv.projected', { n }));
    case 'project-view': {
      const W = tool.world;
      return run('app.uv.undo.project', (m) => U.projectView(m, facesOf(tool), (p) => host.cam.project(apply(W, p))), (n) => t('app.uv.projected', { n }));
    }
    case 'pack': return run('app.uv.undo.pack', (m) => U.pack(m, facesOf(tool), { margin: st.margin }), (r) => t('app.uv.packed', { n: r.islands }));
    case 'rotate90':
    case 'flip-u': {
      const faces = facesOf(tool);
      if (!faces.length) { host.print(t('app.uv.need_faces')); return false; }
      return run('app.uv.undo.' + (name === 'rotate90' ? 'rotate' : 'flip'), (m) => turn(m, faces, name === 'rotate90'));
    }
    case 'checker':
    case 'stretch': setPreview(host, st.preview === name ? null : name); return true;
    default: return false;
  }
}
/** The faces' UVs turned a quarter (or mirrored in u) about their centre. */
function turn(m, faces, rotate) {
  const uv = m.attrArray('uv');
  if (!uv) return 0;
  const cs = [], all = [];
  for (const f of faces) { m.faceCorners(f, cs); all.push(...cs); }
  let cx = 0, cy = 0;
  for (const h of all) { cx += uv[h * 2]; cy += uv[h * 2 + 1]; }
  cx /= all.length; cy /= all.length;
  for (const h of all) {
    const u = uv[h * 2] - cx, v = uv[h * 2 + 1] - cy;
    m.setAttr('uv', h, rotate ? [cx - v, cy + u] : [cx - u, cy + v]);
  }
  return all.length;
}

function keydown(e, host) {
  const tool = meshEditing(host);
  if (tool && st.editor?.hover && !tool.op && st.editor.key(e)) return true;
  const k = e.key, l = k.length === 1 ? k.toLowerCase() : k, ctrl = e.ctrlKey || e.metaKey;
  if (tool && !tool.op) {
    if (!ctrl && !e.altKey && !e.shiftKey && l === 'u') return command('unwrap', host);
    if (ctrl && !e.altKey && l === 'e') return command(e.shiftKey ? 'seam-clear' : 'seam-mark', host);
  }
  const used = meshKeydown(e, host);
  if (used) refresh(host);
  return used;
}

/** The panel: the mesh's islands and seams, how unwrap packs, what the preview shows. */
function panel(host, box) {
  const { t, el } = host;
  const tool = meshEditing(host);
  if (!tool || !tool.mesh) { box.append(el('p', { className: 'mc-note' }, t('app.uv.panel.none'))); return t('app.ws.uv'); }
  const m = tool.mesh, c = tool.sel.counts();
  let seams = 0;
  for (let h = 0; h < m.nh; h++) if (!m.heDead(h) && m.hFl[h] & 16 && m.edgeOf(h) === h) seams++;
  const props = el('div', { className: 'mc-props' });
  const row = (label, value, key) => props.append(el('span', { className: 'k' }, label), el('span', { className: 'v', dataset: { uvInfo: key } }, value));
  row(t('app.mesh.panel.selected'), t('app.mesh.panel.counts', { v: c.verts, e: c.edges, f: c.faces }), 'selected');
  row(t('app.uv.panel.seams'), String(seams), 'seams');
  row(t('app.uv.panel.islands'), m.hasAttr('uv') ? String(U.uvIslands(m).length) : t('app.uv.panel.no_uvs'), 'islands');
  if (m.hasAttr('uv')) {
    const s = U.stretch(m, st.stretchMode);
    let sum = 0, n = 0; for (let f = 0; f < m.nf; f++) if (!m.faceDead(f)) { sum += s[f]; n++; }
    row(t('app.uv.panel.stretch'), n ? (sum / n).toFixed(3) : '—', 'stretch');
  }
  box.append(props);
  // margin for packing
  const mg = el('input', { type: 'text', className: 'mc-input', id: 'mc-uv-margin', value: String(st.margin), spellcheck: false });
  mg.addEventListener('change', () => { const v = Number(mg.value); if (!(v >= 0 && v <= 0.2)) { host.print(t('app.mesh.adjust.range', { min: 0, max: 0.2 })); mg.value = String(st.margin); return; } st.margin = v; });
  box.append(el('label', { for: 'mc-uv-margin' }, t('app.uv.panel.margin')), mg);
  // stretch measure
  const sm = el('select', { className: 'mc-select', id: 'mc-uv-stretch' }, el('option', { value: 'angle' }, t('app.uv.stretch.angle')), el('option', { value: 'area' }, t('app.uv.stretch.area')));
  sm.value = st.stretchMode;
  sm.addEventListener('change', () => { st.stretchMode = sm.value; setPreview(host, st.preview); });
  box.append(el('label', { for: 'mc-uv-stretch' }, t('app.uv.panel.stretch_mode')), sm);
  box.append(el('p', { className: 'mc-note' }, t('app.uv.panel.how')));
  return t('app.ws.uv');
}
