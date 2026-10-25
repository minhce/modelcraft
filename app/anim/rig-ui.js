/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/rig-ui.js — the Animate panel's Armature section and the Rig commands (0.7 AN.2, session `anim`): for the chosen mesh,
 * add an armature, its bones as a tree (choose one; add a child, remove), the chosen bone's head, tail, roll, parent and
 * whether it deforms; its pose (keyed like the transform); linear or dual-quaternion skinning; automatic weights (heat or
 * envelope) and the weight brush's settings. The tools are anim/rig-view.js; the sums anim/rig.js and anim/weights.js.
 *
 *   rigPart = {id, render(host, box, tl), command(name, host, tl), toolState(name, host, tl), keydown(ev, host, tl)}
 */
import { rigsOf, addRig, setRig, removeRig, setBone, removeBone, clearPose, setPose, setPropKey, bonePose, findProp, RIG_MODES } from '../render/anim.js';
import { RIG, installBones, keyOrPose } from './rig-view.js';
import { autoWeights, writeWeights, fromJoints, LAYER } from './weights.js';

function chosenMesh(host) {
  const sel = (host.sel || []).filter((x) => x.t === 'i');
  if (sel.length !== 1) return null;
  const path = [...host.path, sel[0].id], p = host.model.placementAt(path), def = p && host.model.defs.get(p.inst.def);
  return def && def.mesh ? { path, def } : null;
}
const rigFor = (tl, def) => rigsOf(tl.anim, def.id)[0] || null;
const fmtN = (x) => String(Math.round(x * 1000) / 1000);
const slug = (s, taken) => {
  let b = String(s).toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 30) || 'bone';
  let id = b, n = 2;
  while (taken.has(id)) id = b + '.' + String(n++).padStart(3, '0');
  return id;
};
let paintingDef = null;
function stopPainting(host, tl) {
  if (paintingDef) { tl.deformer.showWeights(paintingDef, null); paintingDef = null; }
  if (host.tools.name === 'animweight' || host.tools.name === 'animpose') host.tools.set('select');
}

function command(name, host, tl) {
  const { t } = host;
  const ch = chosenMesh(host);
  if (name === 'pose' || name === 'paint' || name === 'autoweights' || name === 'addbone') {
    if (!ch) { host.print(t('app.an.rig.pick')); return true; }
  } else return false;
  const { def, path } = ch;
  let rg = rigFor(tl, def);
  if (name === 'addbone') { addBone(host, tl, def, rg); return true; }
  if (!rg || !rg.bones.length) { host.print(t('app.an.rig.none')); return true; }
  if (name === 'pose') {
    if (host.tools.name === 'animpose') { stopPainting(host, tl); return true; }
    stopPainting(host, tl);
    RIG.rig = rg.id; RIG.show = true;
    host.tools.set('animpose', { tl });
    host.tip?.(host.tools.tool.hint);
  } else if (name === 'paint') {
    if (host.tools.name === 'animweight') { stopPainting(host, tl); return true; }
    stopPainting(host, tl);
    RIG.rig = rg.id;
    if (!RIG.bone || !rg.bones.some((b) => b.id === RIG.bone)) RIG.bone = rg.bones[0].id;
    host.tools.set('animweight', { tl, path });
    paintingDef = def.id;
    tl.deformer.showWeights(def.id, RIG.bone);
    host.tip?.(host.tools.tool.hint);
  } else if (name === 'autoweights') runAuto(host, tl, def, rg, 'heat');
  return true;
}
function runAuto(host, tl, def, rg, mode) {
  const { t, model } = host;
  const m = def.mesh, t0 = performance.now();
  const map = autoWeights(m, rg, { mode });
  model.meshEdit(def.id, t('app.an.undo.autoweights'), (mm) => writeWeights(mm, rg, map));
  tl.deformer.repaint(def.id); tl.apply();
  host.print(t('app.an.rig.auto.done', { n: rg.bones.filter((b) => b.deform !== false).length, ms: Math.round(performance.now() - t0) }));
}
function addBone(host, tl, def, rg) {
  const { t } = host;
  let a = tl.anim;
  const b = def.mesh.bounds();
  const lo = b.min, hi = b.max, cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
  if (!rg) { a = addRig(a, def.id, t('app.an.rig.default', { name: def.name })); rg = rigsOf(a, def.id)[0]; }
  const taken = new Set(rg.bones.map((x) => x.id));
  const parent = rg.bones.find((x) => x.id === RIG.bone) || null;
  let head, tail;
  if (parent) {
    // from the chosen bone's tip, on in the same direction, half as long
    const d = [0, 1, 2].map((i) => parent.tail[i] - parent.head[i]);
    head = parent.tail.slice(); tail = head.map((v, i) => v + d[i] * 0.5);
  } else if (!rg.bones.length) {
    // the first bone: up the middle of the mesh, from its foot to a third of its height
    head = [cx, cy, lo[2]]; tail = [cx, cy, lo[2] + Math.max((hi[2] - lo[2]) / 3, 1e-3)];
  } else { head = [cx, cy, hi[2]]; tail = [cx, cy, hi[2] + Math.max((hi[2] - lo[2]) / 6, 1e-3)]; }
  const n = rg.bones.length + 1, name = t('app.an.rig.bone.default', { n }), id = slug(name, taken);
  a = setBone(a, rg.id, { id, name, parent: parent ? parent.id : '', head, tail });
  RIG.rig = rg.id; RIG.bone = id; RIG.show = true;
  tl.commit(a, t('app.an.rig.bone.added', { name }));
}

function render(host, box, tl) {
  const { el, t, model } = host;
  installBones(host.view, model, tl);
  RIG.show = true;
  const ch = chosenMesh(host);
  if (!ch) return;
  const { def } = ch, rg = rigFor(tl, def);
  const wrap = el('div', { className: 'mc-an-panel', dataset: { anRig: def.id } }, el('h4', {}, t('app.an.rig.h')));
  const btn = (key, data, on, extra = {}) => { const b = el('button', { type: 'button', className: 'mc-btn', dataset: data, ...extra }, t(key)); b.addEventListener('click', on); return b; };
  if (!rg || !rg.bones.length) {
    wrap.append(el('p', { className: 'mc-an-note' }, t('app.an.rig.none.how')), btn('app.an.rig.add', { anRigAdd: '' }, () => addBone(host, tl, def, rg)));
    box.append(wrap);
    return;
  }
  RIG.rig = rg.id;
  if (!rg.bones.some((b) => b.id === RIG.bone)) RIG.bone = rg.bones[0].id;
  const name = el('input', { type: 'text', className: 'mc-input', value: rg.name, maxLength: 80, 'aria-label': t('app.an.rig.name'), dataset: { anRigName: '' } });
  name.addEventListener('change', () => tl.commit(setRig(tl.anim, rg.id, { name: name.value })));
  const mode = el('select', { className: 'mc-select', 'aria-label': t('app.an.rig.mode'), dataset: { anRigMode: '' } }, RIG_MODES.map((m) => el('option', { value: m }, t('app.an.rig.mode.' + m))));
  mode.value = rg.mode;
  mode.addEventListener('change', () => tl.commit(setRig(tl.anim, rg.id, { mode: mode.value }), t('app.an.rig.mode.set', { mode: t('app.an.rig.mode.' + mode.value) })));
  wrap.append(name, el('label', { className: 'mc-an-row' }, el('span', {}, t('app.an.rig.mode')), mode));
  // the bones as a tree
  const kids = new Map();
  for (const b of rg.bones) { const p = b.parent || ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(b); }
  const list = el('ul', { className: 'mc-an-list mc-an-bones', role: 'listbox', 'aria-label': t('app.an.rig.bones'), dataset: { anBones: '' } });
  const walk = (p, depth) => { for (const b of kids.get(p) || []) {
    const on = b.id === RIG.bone, w = def.mesh.attrArray(LAYER(b.id));
    let held = 0; if (w) for (let v = 0; v < def.mesh.nv; v++) if (w[v] > 0.01) held++;
    const item = el('li', { role: 'option', 'aria-selected': String(on), tabIndex: 0, style: `padding-left:${depth * 0.8}rem`, className: on ? 'is-on' : '', dataset: { anBone: b.id } },   // i18n-ignore: CSS
      el('i', { className: 'bi bi-diagram-2', 'aria-hidden': 'true' }), el('span', {}, b.name), el('span', { className: 'mc-an-note' }, t('app.an.rig.held', { n: held })));   // i18n-ignore: an icon class
    const choose = () => { RIG.bone = b.id; if (paintingDef) tl.deformer.showWeights(paintingDef, b.id); host.renderPanel(); host.view.invalidate(); };
    item.addEventListener('click', choose);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    list.append(item);
    walk(b.id, depth + 1);
  } };
  walk('', 0);
  wrap.append(el('h4', {}, t('app.an.rig.bones')), list);
  const b = rg.bones.find((x) => x.id === RIG.bone);
  // the chosen bone
  const bone = el('div', { className: 'mc-an-props', dataset: { anBoneForm: b.id } });
  const bname = el('input', { type: 'text', className: 'mc-input', value: b.name, maxLength: 80, 'aria-label': t('app.an.rig.bone.name'), dataset: { anBoneName: '' } });
  bname.addEventListener('change', () => tl.commit(setBone(tl.anim, rg.id, { ...b, name: bname.value || b.id })));
  const parent = el('select', { className: 'mc-select', 'aria-label': t('app.an.rig.bone.parent'), dataset: { anBoneParent: '' } }, el('option', { value: '' }, t('app.an.rig.bone.noparent')),
    rg.bones.filter((x) => x.id !== b.id).map((x) => el('option', { value: x.id }, x.name)));
  parent.value = b.parent;
  parent.addEventListener('change', () => tl.commit(setBone(tl.anim, rg.id, { ...b, parent: parent.value })));
  const vec = (key, v, on) => {
    const ins = v.map((x, j) => el('input', { type: 'number', step: '0.05', className: 'mc-input', value: fmtN(x), 'aria-label': t(key) + ' ' + 'XYZ'[j], dataset: { anBoneIn: key.split('.').pop() + '.' + j } }));   // i18n-ignore: axis letters
    for (const i of ins) i.addEventListener('change', () => { const o = ins.map((x) => Number(x.value)); if (o.every(Number.isFinite)) on(o); });
    return el('span', { className: 'mc-an-vec' }, ins);
  };
  const roll = el('input', { type: 'number', step: '5', className: 'mc-input', value: fmtN(b.roll), 'aria-label': t('app.an.rig.bone.roll'), dataset: { anBoneIn: 'roll' } });
  roll.addEventListener('change', () => { const r = Number(roll.value); if (Number.isFinite(r)) tl.commit(setBone(tl.anim, rg.id, { ...b, roll: r })); });
  const deform = el('input', { type: 'checkbox', checked: b.deform !== false, 'aria-label': t('app.an.rig.bone.deform'), dataset: { anBoneDeform: '' } });
  deform.addEventListener('change', () => tl.commit(setBone(tl.anim, rg.id, { ...b, deform: deform.checked })));
  const row = (key, ctl) => [el('span', {}, t(key)), ctl, el('span')];
  bone.append(...row('app.an.rig.bone.name', bname), ...row('app.an.rig.bone.parent', parent),
    ...row('app.an.rig.bone.head', vec('app.an.rig.bone.head', b.head, (h) => tl.commit(setBone(tl.anim, rg.id, { ...b, head: h })))),
    ...row('app.an.rig.bone.tail', vec('app.an.rig.bone.tail', b.tail, (h) => tl.commit(setBone(tl.anim, rg.id, { ...b, tail: h })))),
    ...row('app.an.rig.bone.roll', roll), ...row('app.an.rig.bone.deform', deform));
  wrap.append(el('h4', {}, t('app.an.rig.bone.h', { name: b.name })), bone,
    el('div', { className: 'mc-an-drvbtns' },
      btn('app.an.rig.bone.child', { anBoneChild: '' }, () => addBone(host, tl, def, rg)),
      btn('app.an.rig.bone.remove', { anBoneRemove: '' }, () => {
        model.meshEdit(def.id, t('app.an.undo.bone_remove', { name: b.name }), (mm) => { mm.removeAttr(LAYER(b.id)); });
        const next = removeBone(tl.anim, rg.id, b.id);
        RIG.bone = null;
        tl.commit(next.rigs?.find((r) => r.id === rg.id)?.bones.length ? next : removeRig(next, rg.id), t('app.an.rig.bone.removed', { name: b.name }));
      })));
  // its pose
  const vals = tl.values, p = bonePose(vals, rg.id, b.id), target = 'bone:' + rg.id + '/' + b.id;
  const keyedAt = (prop) => { const i = findProp(tl.anim, target, prop); return i >= 0 && tl.anim.props[i].keys.some((k) => Math.abs(k.t - tl.time) < 0.5 / tl.anim.fps); };
  const pose = el('div', { className: 'mc-an-props', dataset: { anBonePose: b.id } });
  for (const prop of ['location', 'rotation', 'scale']) {
    const put = (v) => tl.commit(keyOrPose(tl, tl.anim, rg.id, b.id, { ...p, [prop]: v }), t('app.an.rig.posed', { name: b.name }));
    const ins = p[prop].map((x, j) => el('input', { type: 'number', step: prop === 'rotation' ? '5' : '0.05', className: 'mc-input', value: fmtN(x), 'aria-label': t('app.an.prop.' + prop) + ' ' + 'XYZ'[j], dataset: { anPoseIn: prop + '.' + j } }));   // i18n-ignore: axis letters
    for (const i of ins) i.addEventListener('change', () => { const o = ins.map((x) => Number(x.value)); if (o.every(Number.isFinite)) put(o); });
    const k = el('button', { type: 'button', className: 'mc-icon', title: t('app.an.key.this', { what: t('app.an.prop.' + prop) }), 'aria-label': t('app.an.key.this', { what: t('app.an.prop.' + prop) }), 'aria-pressed': String(keyedAt(prop)), dataset: { anPoseKey: prop } }, el('i', { className: keyedAt(prop) ? 'bi bi-diamond-fill' : 'bi bi-diamond', 'aria-hidden': 'true' }));   // i18n-ignore: an icon class
    k.addEventListener('click', () => tl.keyProp(target, prop, p[prop], b.name));
    pose.append(el('span', {}, t('app.an.prop.' + prop)), el('span', { className: 'mc-an-vec' }, ins), k);
  }
  wrap.append(el('h4', {}, t('app.an.rig.pose.h')), pose,
    el('div', { className: 'mc-an-drvbtns' },
      btn('app.an.rig.pose.key', { anPoseKeyAll: '' }, () => {
        let a = tl.anim;
        for (const x of rg.bones) { const q = bonePose(vals, rg.id, x.id); for (const prop of ['location', 'rotation', 'scale']) a = setPropKey(a, 'bone:' + rg.id + '/' + x.id, prop, tl.time, q[prop]); }
        tl.commit(a, t('app.an.rig.pose.keyed', { n: rg.bones.length }));
      }),
      btn('app.an.rig.pose.reset', { anPoseReset: '' }, () => tl.commit(setPose(tl.anim, rg.id, b.id, { location: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }))),
      btn('app.an.rig.pose.resetall', { anPoseResetAll: '' }, () => tl.commit(clearPose(tl.anim, rg.id), t('app.an.rig.pose.cleared')))),
    el('p', { className: 'mc-an-note' }, t('app.an.rig.pose.note')));
  // weights
  const brush = RIG.brush;
  const bmode = el('select', { className: 'mc-select', 'aria-label': t('app.an.rig.brush.mode'), dataset: { anBrushMode: '' } }, ['add', 'subtract', 'smooth'].map((m) => el('option', { value: m }, t('app.an.rig.brush.' + m))));
  bmode.value = brush.mode;
  bmode.addEventListener('change', () => { brush.mode = bmode.value; });
  const num = (k, min, max, step, data) => { const i = el('input', { type: 'number', className: 'mc-input', min: String(min), max: String(max), step: String(step), value: String(brush[k]), dataset: { [data]: '' } }); i.addEventListener('change', () => { const v = Number(i.value); if (Number.isFinite(v)) brush[k] = Math.min(max, Math.max(min, v)); }); return i; };
  const norm = el('input', { type: 'checkbox', checked: brush.normalise, dataset: { anBrushNormalise: '' } });
  norm.addEventListener('change', () => { brush.normalise = norm.checked; });
  const brushGrid = el('div', { className: 'mc-an-props' },
    ...row('app.an.rig.brush.mode', bmode), ...row('app.an.rig.brush.radius', num('radius', 4, 400, 2, 'anBrushRadius')),
    ...row('app.an.rig.brush.strength', num('strength', 0.01, 1, 0.05, 'anBrushStrength')), ...row('app.an.rig.brush.normalise', norm));
  wrap.append(el('h4', {}, t('app.an.rig.weights.h')),
    el('div', { className: 'mc-an-drvbtns' },
      btn('app.an.rig.auto.heat', { anAutoHeat: '' }, () => runAuto(host, tl, def, rg, 'heat')),
      btn('app.an.rig.auto.envelope', { anAutoEnvelope: '' }, () => runAuto(host, tl, def, rg, 'envelope')),
      def.mesh.hasAttr('joints') && def.mesh.hasAttr('weights') ? btn('app.an.rig.fromfile', { anFromJoints: '' }, () => {
        // an imported skin's packed weights (glTF JOINTS_0 / WEIGHTS_0): joint n → this armature's bone n, in the list's order
        model.meshEdit(def.id, t('app.an.undo.fromfile'), (mm) => fromJoints(mm, rg));
        tl.deformer.repaint(def.id); tl.apply(); host.renderPanel();
        host.print(t('app.an.rig.fromfile.done', { n: rg.bones.length }));
      }) : null,
      btn(host.tools.name === 'animweight' ? 'app.an.rig.paint.stop' : 'app.an.rig.paint.start', { anPaint: '' }, () => { command('paint', host, tl); host.renderPanel(); }, { 'aria-pressed': String(host.tools.name === 'animweight') }),
      btn(host.tools.name === 'animpose' ? 'app.an.rig.pose.stop' : 'app.an.rig.pose.start', { anPoseTool: '' }, () => { command('pose', host, tl); host.renderPanel(); }, { 'aria-pressed': String(host.tools.name === 'animpose') })),
    brushGrid, el('p', { className: 'mc-an-note' }, t('app.an.rig.weights.note')),
    btn('app.an.rig.remove', { anRigRemove: '' }, () => {
      stopPainting(host, tl);
      model.meshEdit(def.id, t('app.an.undo.rig_remove'), (mm) => { for (const x of rg.bones) mm.removeAttr(LAYER(x.id)); });
      RIG.bone = null;
      tl.commit(removeRig(tl.anim, rg.id), t('app.an.rig.removed', { name: rg.name }));
    }));
  box.append(wrap);
}

function toolState(name, host, tl) {
  if (!['pose', 'paint', 'autoweights', 'addbone'].includes(name)) return null;
  const ch = chosenMesh(host);
  if (!ch) return { ok: false, why: host.t('app.an.rig.pick') };
  const rg = rigFor(tl, ch.def);
  if (name === 'addbone') return { ok: true };
  if (!rg || !rg.bones.length) return { ok: false, why: host.t('app.an.rig.none') };
  if (name === 'pose') return { ok: true, pressed: host.tools.name === 'animpose' };
  if (name === 'paint') return { ok: true, pressed: host.tools.name === 'animweight' };
  return { ok: true };
}
function keydown(e, host, tl) {
  const k = e.key.toLowerCase();
  if (e.shiftKey) return false;
  if (k === 'p' && !e.ctrlKey) return command('pose', host, tl);
  if (k === 'w' && !e.ctrlKey) return command('paint', host, tl);
  return false;
}
export function leaveRig(host, tl) { stopPainting(host, tl); RIG.show = false; host.view?.invalidate(); }
export const rigPart = { id: 'rig', render, command, toolState, keydown };
