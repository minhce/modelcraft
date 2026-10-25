/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/cns-ui.js — the Animate panel's Constraints sections (0.7 AN.3, session `anim`): the chosen placement's constraints and
 * the chosen bone's (anim/rig-view.js RIG.bone), each a card: what it does, its target, how much (keyable), on / off, order,
 * remove, and its own settings (IK chain and pole, look-at axes, which parts to copy, limits, the path's offset). Data and edits
 * are render/anim.js; the solving is anim/constraints.js.
 *
 *   cnsPart = {id, render(host, box, tl)}
 */
import { constraintsOf, addConstraint, setConstraint, removeConstraint, moveConstraint, setRest, findProp, rigsOf, pathKey, AXES } from '../render/anim.js';
import { RIG } from './rig-view.js';
import { objectCtx, rigCtx } from './cns-model.js';
import { rigWorld } from './deform.js';
import { inv } from './rig.js';

const OBJ_TYPES = ['lookat', 'copy', 'limit', 'childof', 'path'];
const BONE_TYPES = ['ik', 'lookat', 'copy', 'limit', 'childof'];
const fmtN = (x) => String(Math.round(x * 1000) / 1000);

function chosen(host) {
  const sel = (host.sel || []).filter((x) => x.t === 'i');
  if (sel.length !== 1) return null;
  const path = [...host.path, sel[0].id], p = host.model.placementAt(path);
  return p ? { path, inst: p.inst, def: host.model.defs.get(p.inst.def) } : null;
}
/** What a constraint can aim at, as select options: placements in the open group (not the owner), its rig's bones, a point. */
function targetOptions(host, ownerKey, rig) {
  const { model, t } = host, out = [];
  const ctx = model.context(host.path) || model.context([]);
  let n = 0;
  for (const [iid, inst] of ctx.def.insts) {
    const key = pathKey([...host.path, iid]);
    if (key === ownerKey || n++ >= 80) continue;
    const d = model.defs.get(inst.def);
    out.push({ value: 'obj:' + key, label: t(d && d.curve ? 'app.an.cns.tgt.curve' : 'app.an.cns.tgt.obj', { name: inst.name || d?.name || t('app.tl.object') }) });   // i18n-ignore: a value
  }
  if (rig) for (const b of rig.bones) out.push({ value: 'bone:' + b.id, label: t('app.an.cns.tgt.bone', { name: b.name }) });   // i18n-ignore: a value
  out.push({ value: 'point', label: t('app.an.cns.tgt.point') });
  return out;
}
const targetValue = (x) => (!x ? '' : x.kind === 'obj' ? 'obj:' + pathKey(x.path) : x.kind === 'bone' ? 'bone:' + x.bone : 'point');
function targetFrom(v, rig, old) {
  if (!v) return null;
  if (v.startsWith('obj:')) return { kind: 'obj', path: v.slice(4).split('/').map(Number) };
  if (v.startsWith('bone:')) return { kind: 'bone', rig: rig.id, bone: v.slice(5) };
  return { kind: 'point', p: old && old.kind === 'point' ? old.p : [0, 0, 0] };
}

function card(host, tl, c, rig) {
  const { el, t } = host;
  const commit = (patch, msg) => tl.commit(setConstraint(tl.anim, c.id, patch), msg);
  const head = el('div', { className: 'mc-an-shapehead' }, el('strong', {}, t('app.an.cns.type.' + c.type)));
  const icon = (cls, title, data, on, extra = {}) => { const b = el('button', { type: 'button', className: 'mc-icon', title, 'aria-label': title, dataset: data, ...extra }, el('i', { className: 'bi bi-' + cls, 'aria-hidden': 'true' })); b.addEventListener('click', on); return b; };   // i18n-ignore: an icon class
  head.append(
    icon(c.on ? 'toggle-on' : 'toggle-off', t(c.on ? 'app.an.cns.off' : 'app.an.cns.on'), { anCnsOn: c.id }, () => commit({ on: !c.on }), { 'aria-pressed': String(c.on) }),
    icon('arrow-up', t('app.an.cns.up'), { anCnsUp: c.id }, () => tl.commit(moveConstraint(tl.anim, c.id, -1))),
    icon('arrow-down', t('app.an.cns.down'), { anCnsDown: c.id }, () => tl.commit(moveConstraint(tl.anim, c.id, 1))),
    icon('trash', t('app.an.cns.remove'), { anCnsRemove: c.id }, () => tl.commit(removeConstraint(tl.anim, c.id), t('app.an.cns.removed', { what: t('app.an.cns.type.' + c.type) }))));
  const grid = el('div', { className: 'mc-an-props' });
  const row = (key, ctl, extra = null) => grid.append(el('span', {}, t(key)), ctl, extra || el('span'));
  if (c.type !== 'limit') {
    const tgt = el('select', { className: 'mc-select', 'aria-label': t('app.an.cns.target'), dataset: { anCnsTarget: c.id } }, el('option', { value: '' }, t('app.an.cns.tgt.none')),
      targetOptions(host, c.owner.startsWith('obj:') ? c.owner.slice(4) : '', c.owner.startsWith('bone:') ? rig : null).filter((o) => c.type !== 'path' || o.value.startsWith('obj:')).map((o) => el('option', { value: o.value }, o.label)));
    tgt.value = targetValue(c.target);
    tgt.addEventListener('change', () => {
      const target = targetFrom(tgt.value, rig, c.target), patch = { target };
      // child of: what the target is now becomes "where it was when set"
      if (c.type === 'childof' && target) patch.inverse = inverseOf(host, tl, target, c, rig);
      commit(patch);
    });
    row('app.an.cns.target', tgt);
    if (c.target && c.target.kind === 'point') {
      const ins = c.target.p.map((x, j) => el('input', { type: 'number', step: '0.1', className: 'mc-input', value: fmtN(x), 'aria-label': t('app.an.cns.target') + ' ' + 'XYZ'[j], dataset: { anCnsPoint: c.id + '.' + j } }));   // i18n-ignore: axis letters
      for (const i of ins) i.addEventListener('change', () => { const p = ins.map((x) => Number(x.value)); if (p.every(Number.isFinite)) commit({ target: { kind: 'point', p } }); });
      row('app.an.cns.point', el('span', { className: 'mc-an-vec' }, ins));
    }
  }
  // how much, keyable
  const ti = findProp(tl.anim, 'cns:' + c.id, 'influence'), now = tl.values.get('cns:' + c.id + '|influence')?.[0] ?? c.influence;
  const infl = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(now), 'aria-label': t('app.an.cns.influence'), dataset: { anCnsInfluence: c.id } });
  infl.addEventListener('change', () => { const v = Number(infl.value); if (ti >= 0) tl.keyProp('cns:' + c.id, 'influence', [v], ''); else commit({ influence: v }); });
  row('app.an.cns.influence', infl, icon(ti >= 0 ? 'diamond-fill' : 'diamond', t('app.an.key.this', { what: t('app.an.cns.influence') }), { anCnsKey: c.id }, () => tl.keyProp('cns:' + c.id, 'influence', [Number(infl.value)], '')));
  // its own settings
  const num = (key, v, min, max, step, on, data) => { const i = el('input', { type: 'number', className: 'mc-input', min: String(min), max: String(max), step: String(step), value: String(v), dataset: { [data]: c.id } }); i.addEventListener('change', () => { const x = Number(i.value); if (Number.isFinite(x)) on(Math.min(max, Math.max(min, x))); }); row(key, i); };
  const axisSel = (key, v, on, data) => { const s = el('select', { className: 'mc-select', dataset: { [data]: c.id } }, AXES.map((a) => el('option', { value: a }, t('app.an.cns.axis.' + a.replace('+', 'p').replace('-', 'm'))))); s.value = v; s.addEventListener('change', () => on(s.value)); row(key, s); };
  if (c.type === 'ik') {
    num('app.an.cns.chain', c.chain, 1, 16, 1, (v) => commit({ chain: v }), 'anCnsChain');
    const pole = el('select', { className: 'mc-select', dataset: { anCnsPole: c.id } }, el('option', { value: '' }, t('app.an.cns.pole.none')), targetOptions(host, '', rig).filter((o) => o.value !== 'point').map((o) => el('option', { value: o.value }, o.label)));
    pole.value = targetValue(c.pole);
    pole.addEventListener('change', () => commit({ pole: targetFrom(pole.value, rig, null) }));
    row('app.an.cns.pole', pole);
  }
  if (c.type === 'lookat' || c.type === 'path') {
    axisSel('app.an.cns.axis', c.axis, (v) => commit({ axis: v }), 'anCnsAxis');
    axisSel('app.an.cns.upaxis', c.up, (v) => commit({ up: v }), 'anCnsUp');
  }
  if (c.type === 'copy') for (const k of ['location', 'rotation', 'scale']) {
    const b = el('input', { type: 'checkbox', checked: !!c.mix[k], dataset: { anCnsMix: c.id + '.' + k } });
    b.addEventListener('change', () => commit({ mix: { ...c.mix, [k]: b.checked } }));
    row('app.an.prop.' + k, b);
  }
  if (c.type === 'limit') for (const k of ['location', 'rotation', 'scale']) {
    const r = c.limits[k], ins = [];
    for (let j = 0; j < 3; j++) for (let e = 0; e < 2; e++) ins.push(el('input', { type: 'number', step: k === 'rotation' ? '5' : '0.1', className: 'mc-input', value: r[j] ? fmtN(r[j][e]) : '', placeholder: t(e ? 'app.an.cns.max' : 'app.an.cns.min'), 'aria-label': t('app.an.prop.' + k) + ' ' + 'XYZ'[j] + ' ' + t(e ? 'app.an.cns.max' : 'app.an.cns.min'), dataset: { anCnsLimit: c.id + '.' + k + '.' + j + '.' + e } }));   // i18n-ignore: axis letters
    const put = () => { const next = [0, 1, 2].map((j) => { const a = ins[j * 2].value, b = ins[j * 2 + 1].value; return a === '' || b === '' ? null : [Math.min(+a, +b), Math.max(+a, +b)]; }); commit({ limits: { ...c.limits, [k]: next } }); };
    for (const i of ins) i.addEventListener('change', put);
    row('app.an.prop.' + k, el('span', { className: 'mc-an-lim' }, ins));
  }
  if (c.type === 'path') {
    const oi = findProp(tl.anim, 'cns:' + c.id, 'offset'), ov = tl.values.get('cns:' + c.id + '|offset')?.[0] ?? c.offset;
    const off = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(ov), 'aria-label': t('app.an.cns.offset'), dataset: { anCnsOffset: c.id } });
    off.addEventListener('change', () => { const v = Number(off.value); if (oi >= 0) tl.keyProp('cns:' + c.id, 'offset', [v], ''); else commit({ offset: v }); });
    row('app.an.cns.offset', off, icon(oi >= 0 ? 'diamond-fill' : 'diamond', t('app.an.key.this', { what: t('app.an.cns.offset') }), { anCnsOffsetKey: c.id }, () => tl.keyProp('cns:' + c.id, 'offset', [Number(off.value)], '')));
    const fol = el('input', { type: 'checkbox', checked: c.follow, dataset: { anCnsFollow: c.id } });
    fol.addEventListener('change', () => commit({ follow: fol.checked }));
    row('app.an.cns.follow', fol);
  }
  return el('div', { className: 'mc-an-shape' + (c.on ? '' : ' is-off'), dataset: { anCns: c.id } }, head, grid,
    el('p', { className: 'mc-an-note' }, t('app.an.cns.about.' + c.type)));
}
/**
 * The target's matrix now, inverted, so a new child-of starts with nothing moving: in the world for a placement's constraint,
 * in the rig's mesh coordinates for a bone's (a bone target: that bone as posed now).
 */
function inverseOf(host, tl, target, c, rig) {
  if (target.kind === 'point') return inv([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...target.p, 1]);
  if (c.owner.startsWith('bone:') && rig) {
    const ctx = rigCtx(host.model, tl.anim, rig, tl.values);
    if (target.kind === 'bone') { const W = rigWorld(rig, tl.anim, tl.values, ctx).world.get(target.bone); return W ? inv(W) : null; }
    const M = ctx.matrix(target);
    return M ? inv(M) : null;
  }
  const M = target.kind === 'obj' ? objectCtx(host.model, tl.anim, { rests: false }).worldOf(target.path, null) : null;
  return M ? inv(M) : null;
}

function addRow(host, tl, owner, types, rig, onAdd) {
  const { el, t } = host;
  const sel = el('select', { className: 'mc-select', 'aria-label': t('app.an.cns.addtype'), dataset: { anCnsType: owner } }, types.map((x) => el('option', { value: x }, t('app.an.cns.type.' + x))));
  const add = el('button', { type: 'button', className: 'mc-btn', dataset: { anCnsAdd: owner } }, t('app.an.cns.add'));
  add.addEventListener('click', () => onAdd(sel.value));
  return el('div', { className: 'mc-an-drvbtns' }, sel, add);
}
function render(host, box, tl) {
  const { el, t } = host;
  const ch = chosen(host);
  if (!ch) return;
  const wrap = el('div', { className: 'mc-an-panel', dataset: { anConstraints: '' } });
  // the placement's own
  const owner = 'obj:' + pathKey(ch.path), list = constraintsOf(tl.anim, owner);
  wrap.append(el('h4', {}, t('app.an.cns.h.obj', { name: ch.inst.name || ch.def?.name || t('app.tl.object') })));
  for (const c of list) wrap.append(card(host, tl, c, null));
  if (!list.length) wrap.append(el('p', { className: 'mc-an-note' }, t('app.an.cns.none.obj')));
  wrap.append(addRow(host, tl, owner, OBJ_TYPES, null, (type) => {
    // its rest is kept first, so it never starts from the matrix the last frame set
    let a = setRest(tl.anim, ch.path, ch.inst.m);
    a = addConstraint(a, owner, type, {});
    tl.commit(a, t('app.an.cns.added', { what: t('app.an.cns.type.' + type) }));
  }));
  // the chosen bone's
  const rig = ch.def && ch.def.mesh ? rigsOf(tl.anim, ch.def.id)[0] : null;
  if (rig && RIG.bone && rig.bones.some((b) => b.id === RIG.bone)) {
    const bo = 'bone:' + rig.id + '/' + RIG.bone, bl = constraintsOf(tl.anim, bo), bn = rig.bones.find((b) => b.id === RIG.bone).name;
    wrap.append(el('h4', {}, t('app.an.cns.h.bone', { name: bn })));
    for (const c of bl) wrap.append(card(host, tl, c, rig));
    if (!bl.length) wrap.append(el('p', { className: 'mc-an-note' }, t('app.an.cns.none.bone')));
    wrap.append(addRow(host, tl, bo, BONE_TYPES, rig, (type) => {
      const patch = type === 'ik' ? { chain: 2, target: { kind: 'point', p: rig.bones.find((b) => b.id === RIG.bone).tail.slice() } } : {};
      tl.commit(addConstraint(tl.anim, bo, type, patch), t('app.an.cns.added', { what: t('app.an.cns.type.' + type) }));
    }));
  }
  box.append(wrap);
}
export const cnsPart = { id: 'constraints', render };
