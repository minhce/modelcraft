/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/physics-ui.js — the Animate panel's Physics section and the Bake command (0.7 AN.5, session `anim`): for the chosen
 * group, component or mesh, whether it falls and collides (active), only gets in the way (passive), or neither; its shape
 * (box or sphere round its bounds), mass, friction and bounce; for the whole model, gravity, the ground, the time span and
 * the substeps; Bake (keys on every frame for the active ones) and Remove baked keys.
 *
 *   physicsPart = {id, render(host, box, tl), command(name, host, tl), toolState(name, host, tl)}
 */
import { bodyOf, setBody, setPhysics, PHYSICS_DEFAULTS } from '../render/anim.js';
import { bakePhysics, clearBaked } from './bake.js';

function chosen(host) {
  const sel = (host.sel || []).filter((x) => x.t === 'i');
  if (sel.length !== 1) return null;
  const path = [...host.path, sel[0].id], p = host.model.placementAt(path);
  return p ? { path, inst: p.inst, def: host.model.defs.get(p.inst.def) } : null;
}
function bake(host, tl) {
  const { t } = host;
  const ph = tl.anim.physics;
  if (!ph || !ph.bodies.some((b) => b.kind === 'active')) { host.print(t('app.an.phys.none')); return; }
  tl.stop();
  const r = bakePhysics(host.model, tl.anim, tl.values);
  if (r.anim === tl.anim) { host.print(t('app.an.phys.none')); return; }
  tl.commit(r.anim, t(r.settled ? 'app.an.phys.baked' : 'app.an.phys.baked.moving', { n: r.bodies, frames: r.frames, ms: r.ms }));
  if (r.missing) host.print(t('app.an.phys.missing', { n: r.missing }));
  tl.setTime(ph.from);
}
function command(name, host, tl) {
  if (name === 'bake') { bake(host, tl); return true; }
  return false;
}
function toolState(name, host, tl) {
  if (name !== 'bake') return null;
  const ph = tl.anim.physics;
  return ph && ph.bodies.some((b) => b.kind === 'active') ? { ok: true } : { ok: false, why: host.t('app.an.phys.none') };
}
function render(host, box, tl) {
  const { el, t } = host;
  const ch = chosen(host);
  const ph = tl.anim.physics || PHYSICS_DEFAULTS;
  const wrap = el('div', { className: 'mc-an-panel', dataset: { anPhysics: '' } }, el('h4', {}, t('app.an.phys.h')));
  const grid = el('div', { className: 'mc-an-props' });
  const row = (key, ctl) => grid.append(el('span', {}, t(key)), ctl, el('span'));
  const num = (v, min, max, step, data, on) => { const i = el('input', { type: 'number', className: 'mc-input', min: String(min), max: String(max), step: String(step), value: String(Math.round(v * 1000) / 1000), dataset: { [data]: '' } }); i.addEventListener('change', () => { const x = Number(i.value); if (Number.isFinite(x)) on(Math.min(max, Math.max(min, x))); }); return i; };
  if (ch) {
    const b = bodyOf(tl.anim, ch.path), name = ch.inst.name || ch.def?.name || t('app.tl.object');
    const kind = el('select', { className: 'mc-select', dataset: { anPhysKind: '' }, 'aria-label': t('app.an.phys.kind') }, ['none', 'active', 'passive'].map((k) => el('option', { value: k }, t('app.an.phys.kind.' + k))));
    kind.value = b ? b.kind : 'none';
    kind.addEventListener('change', () => tl.commit(setBody(tl.anim, ch.path, kind.value === 'none' ? null : { kind: kind.value }), t('app.an.phys.set.' + kind.value, { name })));
    row('app.an.phys.kind', kind);
    if (b) {
      const shape = el('select', { className: 'mc-select', dataset: { anPhysShape: '' } }, ['box', 'sphere'].map((k) => el('option', { value: k }, t('app.an.phys.shape.' + k))));
      shape.value = b.shape;
      shape.addEventListener('change', () => tl.commit(setBody(tl.anim, ch.path, { shape: shape.value })));
      row('app.an.phys.shape', shape);
      if (b.kind === 'active') row('app.an.phys.mass', num(b.mass, 0.001, 1e6, 0.5, 'anPhysMass', (v) => tl.commit(setBody(tl.anim, ch.path, { mass: v }))));
      row('app.an.phys.friction', num(b.friction, 0, 2, 0.05, 'anPhysFriction', (v) => tl.commit(setBody(tl.anim, ch.path, { friction: v }))));
      row('app.an.phys.bounce', num(b.bounce, 0, 1, 0.05, 'anPhysBounce', (v) => tl.commit(setBody(tl.anim, ch.path, { bounce: v }))));
    }
    wrap.append(el('p', { className: 'mc-an-note' }, t('app.an.phys.for', { name })), grid);
  } else wrap.append(el('p', { className: 'mc-an-note' }, t('app.an.phys.pick')));
  // the whole model's
  const world = el('div', { className: 'mc-an-props' });
  const wrow = (key, ctl) => world.append(el('span', {}, t(key)), ctl, el('span'));
  wrow('app.an.phys.gravity', num(-ph.gravity[2], -100, 100, 0.1, 'anPhysGravity', (v) => tl.commit(setPhysics(tl.anim, { gravity: [0, 0, -v] }))));
  const ground = el('input', { type: 'checkbox', checked: ph.ground.on, dataset: { anPhysGround: '' } });
  ground.addEventListener('change', () => tl.commit(setPhysics(tl.anim, { ground: { on: ground.checked } })));
  wrow('app.an.phys.ground', ground);
  wrow('app.an.phys.groundz', num(ph.ground.z, -1e6, 1e6, 0.1, 'anPhysGroundZ', (v) => tl.commit(setPhysics(tl.anim, { ground: { z: v } }))));
  wrow('app.an.phys.from', num(ph.from, 0, 3600, 0.5, 'anPhysFrom', (v) => tl.commit(setPhysics(tl.anim, { from: v }))));
  wrow('app.an.phys.to', num(ph.to, 0.1, 3600, 0.5, 'anPhysTo', (v) => tl.commit(setPhysics(tl.anim, { to: v }))));
  wrow('app.an.phys.substeps', num(ph.substeps, 1, 100, 1, 'anPhysSubsteps', (v) => tl.commit(setPhysics(tl.anim, { substeps: Math.round(v) }))));
  const bk = el('button', { type: 'button', className: 'mc-btn', dataset: { anPhysBake: '' } }, t('app.an.cmd.bake'));
  bk.addEventListener('click', () => bake(host, tl));
  const cl = el('button', { type: 'button', className: 'mc-btn', dataset: { anPhysClear: '' } }, t('app.an.phys.clear'));
  cl.addEventListener('click', () => { const next = clearBaked(tl.anim); if (next !== tl.anim) tl.commit(next, t('app.an.phys.cleared')); });
  const n = (tl.anim.physics?.bodies || []).filter((b) => b.kind === 'active').length, m = (tl.anim.physics?.bodies || []).length - n;
  wrap.append(el('h4', {}, t('app.an.phys.world')), world, el('div', { className: 'mc-an-drvbtns' }, bk, cl),
    el('p', { className: 'mc-an-note' }, t('app.an.phys.count', { n, m })), el('p', { className: 'mc-an-note' }, t('app.an.phys.note')));
  box.append(wrap);
}
export const physicsPart = { id: 'physics', render, command, toolState };
