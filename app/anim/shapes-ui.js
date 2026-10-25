/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/shapes-ui.js — the Animate panel's Shape keys section (0.7 AN.4, session `anim`): for the chosen mesh, its shape keys
 * with a slider each (keyed at the playhead with the diamond), add / rename / mute / remove, edit a key's shape in the Mesh
 * workspace (Done puts it back in the key), and a driver per key: a small expression over variables that read other
 * things (time, a placement's place / turn / size, a lamp, another key). The mesh layers are anim/shapes.js (model undo);
 * names, sliders and drivers are the animation's (render/anim.js; the timeline's undo).
 *
 *   shapesPart = {id, render(host, box, tl), command(name, host, tl)}   added by ws-animate.js
 */
import { shapeIds, nextShapeId, addShape, removeShape, editing, beginEdit, finishEdit, cancelEdit } from './shapes.js';
import { shapeKeys, setShapeKey, removeShapeKey, setDriver, removeDriver, compileExpr, findProp, pathKey } from '../render/anim.js';

/** The one chosen mesh: {path, def} or null. */
function chosenMesh(host) {
  const sel = (host.sel || []).filter((x) => x.t === 'i');
  if (sel.length !== 1) return null;
  const path = [...host.path, sel[0].id], p = host.model.placementAt(path), def = p && host.model.defs.get(p.inst.def);
  return def && def.mesh ? { path, def } : null;
}
const TRS = ['location', 'rotation', 'scale'], XYZ = ['X', 'Y', 'Z'];   // i18n-ignore: axis letters

function sources(host, def) {
  const { t, model } = host;
  const out = [{ value: 'time|seconds|0', label: t('app.an.drv.src.seconds') }, { value: 'time|frame|0', label: t('app.an.drv.src.frame') }];
  const ctx = model.context(host.path) || model.context([]);
  let n = 0;
  for (const [iid, inst] of ctx.def.insts) {
    if (n++ >= 50) break;
    const name = inst.name || model.defs.get(inst.def)?.name || t('app.tl.object'), target = 'obj:' + pathKey([...host.path, iid]);
    TRS.forEach((p) => XYZ.forEach((a, c) => out.push({ value: `${target}|${p}|${c}`, label: t('app.an.drv.src.obj', { name, what: t('app.an.prop.' + p), axis: a }) })));
  }
  for (const [id, L] of model.lights) out.push({ value: `light:${id}|lumens|0`, label: t('app.an.drv.src.lamp', { name: L.name || t('app.an.target.light') }) });   // i18n-ignore: a value, not words
  for (const k of shapeKeys(activeAnim(host), def.id)) out.push({ value: `shape:${def.id}|${k.id}|0`, label: t('app.an.drv.src.shape', { name: k.name }) });   // i18n-ignore: a value, not words
  return out;
}
let tlRef = null;
const activeAnim = () => tlRef.anim;

function driverForm(host, tl, def, k) {
  const { el, t } = host;
  const target = 'shape:' + def.id, d = (tl.anim.drivers || []).find((x) => x.target === target && x.prop === k.id);
  const vars = d ? d.vars.map((v) => ({ ...v })) : [{ name: 'v', target: 'time', prop: 'seconds', comp: 0 }];
  const expr = el('input', { type: 'text', className: 'mc-input', value: d ? d.expr : 'v', spellcheck: false, maxLength: 400, dataset: { anDrvExpr: k.id }, 'aria-label': t('app.an.drv.expr') });
  const msg = el('p', { className: 'mc-an-note', dataset: { anDrvMsg: k.id }, 'aria-live': 'polite' });
  const save = () => {
    const c = compileExpr(expr.value);
    if (!c.ok) { msg.textContent = t('app.an.drv.bad.' + c.error, { at: c.at + 1 }); return; }
    const unknown = c.names.filter((n) => !vars.some((v) => v.name === n));
    if (unknown.length) { msg.textContent = t('app.an.drv.unknown', { names: unknown.join(', ') }); return; }
    msg.textContent = '';
    tl.commit(setDriver(tl.anim, target, k.id, { expr: expr.value, vars }), t('app.an.drv.set', { name: k.name }));
  };
  expr.addEventListener('change', save);
  const opts = sources(host, def);
  const rows = vars.map((v, i) => {
    const nm = el('input', { type: 'text', className: 'mc-input', value: v.name, maxLength: 16, spellcheck: false, 'aria-label': t('app.an.drv.var'), dataset: { anDrvVar: String(i) } });
    nm.addEventListener('change', () => { if (/^[a-z_][a-z0-9_]{0,15}$/i.test(nm.value)) { vars[i].name = nm.value; save(); } else nm.value = v.name; });
    const sel = el('select', { className: 'mc-select', 'aria-label': t('app.an.drv.from'), dataset: { anDrvSrc: String(i) } }, opts.map((x) => el('option', { value: x.value }, x.label)));
    sel.value = `${v.target}|${v.prop}|${v.comp}`;
    if (sel.selectedIndex < 0) sel.append(el('option', { value: sel.value = `${v.target}|${v.prop}|${v.comp}` }, v.target + ' ' + v.prop));
    sel.addEventListener('change', () => { const [tg, pr, c] = sel.value.split('|'); Object.assign(vars[i], { target: tg, prop: pr, comp: +c }); save(); });
    const rm = el('button', { type: 'button', className: 'mc-icon', title: t('app.an.drv.var.remove'), 'aria-label': t('app.an.drv.var.remove'), disabled: vars.length < 2 }, el('i', { className: 'bi bi-dash-circle', 'aria-hidden': 'true' }));   // i18n-ignore: an icon class
    rm.addEventListener('click', () => { vars.splice(i, 1); save(); });
    return el('div', { className: 'mc-an-drvvar' }, nm, sel, rm);
  });
  const add = el('button', { type: 'button', className: 'mc-btn', disabled: vars.length >= 16, dataset: { anDrvAdd: k.id } }, t('app.an.drv.var.add'));
  add.addEventListener('click', () => {
    const used = new Set(vars.map((v) => v.name));
    const name = 'abcdefghijklmnopqrstuvwxyz'.split('').find((c) => !used.has(c)) || 'v' + vars.length;
    vars.push({ name, target: 'time', prop: 'seconds', comp: 0 });
    save();
  });
  const off = el('button', { type: 'button', className: 'mc-btn', disabled: !d, dataset: { anDrvRemove: k.id } }, t('app.an.drv.remove'));
  off.addEventListener('click', () => tl.commit(removeDriver(tl.anim, target, k.id), t('app.an.drv.removed', { name: k.name })));
  return el('div', { className: 'mc-an-driver', dataset: { anDriver: k.id } },
    el('label', {}, el('span', {}, t('app.an.drv.expr')), expr), ...rows, el('div', { className: 'mc-an-drvbtns' }, add, off), msg,
    el('p', { className: 'mc-an-note' }, t('app.an.drv.how')));
}

const open = new Set();   // keys whose driver form is open
function render(host, box, tl) {
  tlRef = tl;
  const { el, t, model } = host;
  const ch = chosenMesh(host);
  if (!ch) return;
  const { def, path } = ch, m = def.mesh;
  const wrap = el('div', { className: 'mc-an-panel', dataset: { anShapes: String(def.id) } }, el('h4', {}, t('app.an.shape.h')));
  const meta = shapeKeys(tl.anim, def.id), ids = shapeIds(m);
  const keyOf = (id) => meta.find((k) => k.id === id) || { id, name: id, value: 0, min: 0, max: 1, mute: false };
  const ed = editing(m);
  if (ed) {
    const k = keyOf(ed);
    const done = el('button', { type: 'button', className: 'mc-btn', dataset: { anShapeDone: '' } }, t('app.an.shape.done'));
    done.addEventListener('click', () => { model.meshEdit(def.id, t('app.an.undo.shape_done', { name: k.name }), (mm) => finishEdit(mm)); tl.apply(); host.print(t('app.an.shape.saved', { name: k.name })); host.renderPanel(); });
    const cancel = el('button', { type: 'button', className: 'mc-btn', dataset: { anShapeCancel: '' } }, t('app.an.shape.cancel'));
    cancel.addEventListener('click', () => { model.meshEdit(def.id, t('app.an.undo.shape_cancel'), (mm) => cancelEdit(mm)); tl.apply(); host.renderPanel(); });
    const go = el('button', { type: 'button', className: 'mc-btn', dataset: { anShapeGo: '' } }, t('app.an.shape.go'));
    go.addEventListener('click', () => { host.selectPlacement(path); host.setWorkspace('mesh'); });
    wrap.append(el('p', { className: 'mc-an-note' }, t('app.an.shape.editing', { name: k.name })), el('div', { className: 'mc-an-drvbtns' }, go, done, cancel));
    box.append(wrap);
    return;
  }
  if (!ids.length) wrap.append(el('p', { className: 'mc-an-note' }, t('app.an.shape.none')));
  const at = tl.time, target = 'shape:' + def.id;
  for (const id of ids) {
    const k = keyOf(id), ti = findProp(tl.anim, target, id), tracked = ti >= 0;
    const keyed = tracked && tl.anim.props[ti].keys.some((x) => Math.abs(x.t - at) < 0.5 / tl.anim.fps);
    const driven = (tl.anim.drivers || []).some((d) => d.target === target && d.prop === id);
    const now = tl.deformer.weights(def.id).get(id) ?? k.value;
    const name = el('input', { type: 'text', className: 'mc-input', value: k.name, maxLength: 80, 'aria-label': t('app.an.shape.name'), dataset: { anShapeName: id } });
    name.addEventListener('change', () => tl.commit(setShapeKey(tl.anim, def.id, id, { name: name.value || id })));
    const slider = el('input', { type: 'range', min: String(k.min), max: String(k.max), step: '0.01', value: String(now), disabled: driven, 'aria-label': t('app.an.shape.value', { name: k.name }), dataset: { anShapeSlider: id } });
    const num = el('input', { type: 'number', className: 'mc-input', min: String(k.min), max: String(k.max), step: '0.05', value: String(Math.round(now * 1000) / 1000), disabled: driven, 'aria-label': t('app.an.shape.value', { name: k.name }), dataset: { anShapeValue: id } });
    const setValue = (v) => {
      // keyed when the key is animated (a track), else the slider itself
      if (tracked) tl.keyProp(target, id, [v], def.name);
      else tl.commit(setShapeKey(tl.anim, def.id, id, { value: v }), t('app.an.shape.set', { name: k.name, v: Math.round(v * 100) / 100 }));
    };
    slider.addEventListener('input', () => { num.value = slider.value; const w = new Map(tl.deformer.weights(def.id)); w.set(id, Number(slider.value)); tl.deformer.setWeights(def.id, w); host.view.invalidate(); });
    slider.addEventListener('change', () => setValue(Number(slider.value)));
    num.addEventListener('change', () => { const v = Number(num.value); if (Number.isFinite(v)) setValue(Math.min(k.max, Math.max(k.min, v))); });
    const keyB = el('button', { type: 'button', className: 'mc-icon', title: t('app.an.key.this', { what: k.name }), 'aria-label': t('app.an.key.this', { what: k.name }), 'aria-pressed': String(keyed), dataset: { anShapeKey: id } }, el('i', { className: keyed ? 'bi bi-diamond-fill' : 'bi bi-diamond', 'aria-hidden': 'true' }));   // i18n-ignore: an icon class
    keyB.addEventListener('click', () => tl.keyProp(target, id, [Number(num.value)], def.name));
    const icon = (cls, title, data, on) => { const b = el('button', { type: 'button', className: 'mc-icon', title, 'aria-label': title, dataset: data }, el('i', { className: 'bi bi-' + cls, 'aria-hidden': 'true' })); b.addEventListener('click', on); return b; };   // i18n-ignore: an icon class
    const edit = icon('pencil', t('app.an.shape.edit', { name: k.name }), { anShapeEdit: id }, () => {
      model.meshEdit(def.id, t('app.an.undo.shape_edit', { name: k.name }), (mm) => beginEdit(mm, id));
      tl.apply();
      host.print(t('app.an.shape.editing.tip', { name: k.name }));
      host.selectPlacement(path); host.setWorkspace('mesh');
    });
    const mute = el('button', { type: 'button', className: 'mc-icon', title: t(k.mute ? 'app.an.shape.unmute' : 'app.an.shape.mute'), 'aria-label': t(k.mute ? 'app.an.shape.unmute' : 'app.an.shape.mute'), 'aria-pressed': String(k.mute), dataset: { anShapeMute: id } }, el('i', { className: k.mute ? 'bi bi-eye-slash' : 'bi bi-eye', 'aria-hidden': 'true' }));   // i18n-ignore: an icon class
    mute.addEventListener('click', () => tl.commit(setShapeKey(tl.anim, def.id, id, { mute: !k.mute })));
    const drv = el('button', { type: 'button', className: 'mc-icon', title: t('app.an.drv.title', { name: k.name }), 'aria-label': t('app.an.drv.title', { name: k.name }), 'aria-pressed': String(driven), 'aria-expanded': String(open.has(def.id + id)), dataset: { anShapeDriver: id } }, el('i', { className: 'bi bi-calculator', 'aria-hidden': 'true' }));   // i18n-ignore: an icon class
    drv.addEventListener('click', () => { const kk = def.id + id; if (open.has(kk)) open.delete(kk); else open.add(kk); host.renderPanel(); });
    const rm = icon('trash', t('app.an.shape.remove', { name: k.name }), { anShapeRemove: id }, () => {
      model.meshEdit(def.id, t('app.an.undo.shape_remove', { name: k.name }), (mm) => removeShape(mm, id));
      tl.commit(removeShapeKey(tl.anim, def.id, id), t('app.an.shape.removed', { name: k.name }));
    });
    wrap.append(el('div', { className: 'mc-an-shape', dataset: { anShape: id } },
      el('div', { className: 'mc-an-shapehead' }, name, keyB, drv, edit, mute, rm),
      el('div', { className: 'mc-an-slider' }, slider, num, el('span', { className: 'mc-an-note' }, driven ? t('app.an.shape.driven') : '')),
      open.has(def.id + id) ? driverForm(host, tl, def, k) : null));
  }
  const add = el('button', { type: 'button', className: 'mc-btn', dataset: { anShapeAdd: '' } }, t('app.an.shape.add'));
  add.addEventListener('click', () => {
    const id = nextShapeId(m), n = ids.length + 1, nm = t('app.an.shape.default', { n });
    model.meshEdit(def.id, t('app.an.undo.shape_add', { name: nm }), (mm) => { addShape(mm, id); beginEdit(mm, id); });
    tl.commit(setShapeKey(tl.anim, def.id, id, { name: nm, value: 0 }), t('app.an.shape.added', { name: nm }));
    host.print(t('app.an.shape.editing.tip', { name: nm }));
    host.selectPlacement(path); host.setWorkspace('mesh');
  });
  wrap.append(add, el('p', { className: 'mc-an-note' }, t('app.an.shape.how')));
  box.append(wrap);
}

export const shapesPart = { id: 'shapes', render };
