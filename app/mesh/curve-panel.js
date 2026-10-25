/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/curve-panel.js — a curve object's shape settings (0.7 MD.6): flat or 3D, fill, extrude, bevel depth and roundness,
 * caps, taper, the splines' resolution and order, and — in the Curve workspace — the selected points' radius and tilt.
 * Shown in Model's Entity info for a curve object and in the Curve workspace's panel. Every change is one undo step
 * through `ctx.change(label, fn(curve))`.
 *
 *   curvePanel(ctx) → element    ctx = {def, el, t, units, formatLength, parseLength, print, change, selPoints?: [{s, i}], text?(string)}
 */
import { sample } from './curve.js';

export function curvePanel(ctx) {
  const { def, el, t } = ctx, c = def.curve;
  const box = el('section', { className: 'mc-mods mc-curve', dataset: { curve: def.id } }, el('h3', { className: 'mc-h' }, t('app.curve.h')));
  const props = el('div', { className: 'mc-props mc-mod-props' });
  const set = (label, fn) => ctx.change(label, (cv) => { fn(cv); });
  const field = (id, label, input) => props.append(el('label', { for: id, className: 'k' }, label), el('span', { className: 'v' }, input));
  const num = (id, value, { len = false, min = -Infinity, max = Infinity, int = false } = {}, put) => {
    const inp = el('input', { type: 'text', id, className: 'mc-input', value: len ? ctx.formatLength(value, ctx.units) : String(value), spellcheck: false });
    inp.addEventListener('change', () => {
      let v = len ? ctx.parseLength(inp.value, ctx.units) : Number(inp.value);
      if (int) v = Math.round(v);
      if (v === null || !Number.isFinite(v) || v < min || v > max) { ctx.print(t('app.mod.bad.range', { min: Number.isFinite(min) ? min : '−∞', max: Number.isFinite(max) ? max : '∞' })); return; }
      put(v);
    });
    return inp;
  };
  const check = (id, on, put) => el('input', { type: 'checkbox', id, checked: !!on, onchange: (e) => put(e.target.checked) });
  // facts
  let pts = 0, length = 0;
  for (const sp of c.splines) { pts += sp.points.length; length += sample(sp).length || 0; }
  props.append(el('span', { className: 'k' }, t('app.curve.facts')), el('span', { className: 'v', dataset: { curveSplines: '' } }, String(c.splines.length)),
    el('span', { className: 'k' }, t('app.curve.points')), el('span', { className: 'v', dataset: { curvePoints: '' } }, String(pts)),
    el('span', { className: 'k' }, t('app.curve.length')), el('span', { className: 'v', dataset: { curveLength: '' } }, ctx.formatLength(length, ctx.units)));
  if (c.text) {
    const tx = el('input', { type: 'text', id: 'mc-curve-text', className: 'mc-input', value: c.text.string, spellcheck: false });
    tx.addEventListener('change', () => ctx.text?.(tx.value));
    field('mc-curve-text', t('app.curve.text'), tx);
  }
  const dim = el('select', { id: 'mc-curve-dim', className: 'mc-select', onchange: (e) => set(t('app.curve.undo.shape'), (cv) => { cv.dim = e.target.value; }) },
    el('option', { value: '3d' }, t('app.curve.dim.3d')), el('option', { value: '2d' }, t('app.curve.dim.2d')));
  dim.value = c.dim;
  field('mc-curve-dim', t('app.curve.dim'), dim);
  if (c.dim === '2d') field('mc-curve-fill', t('app.curve.fill'), check('mc-curve-fill', c.fill, (v) => set(t('app.curve.undo.shape'), (cv) => { cv.fill = v; })));
  field('mc-curve-extrude', t('app.curve.extrude'), num('mc-curve-extrude', c.extrude, { len: true, min: 0, max: 1e6 }, (v) => set(t('app.curve.undo.shape'), (cv) => { cv.extrude = v; })));
  field('mc-curve-depth', t('app.curve.bevel'), num('mc-curve-depth', c.bevel.depth, { len: true, min: 0, max: 1e6 }, (v) => set(t('app.curve.undo.shape'), (cv) => { cv.bevel.depth = v; })));
  field('mc-curve-round', t('app.curve.round'), num('mc-curve-round', c.bevel.resolution, { min: 0, max: 16, int: true }, (v) => set(t('app.curve.undo.shape'), (cv) => { cv.bevel.resolution = v; })));
  if (!(c.dim === '2d' && c.fill)) {
    field('mc-curve-caps', t('app.curve.caps'), check('mc-curve-caps', c.caps, (v) => set(t('app.curve.undo.shape'), (cv) => { cv.caps = v; })));
    const tp = el('input', { type: 'text', id: 'mc-curve-taper', className: 'mc-input', value: c.taper.join(', '), spellcheck: false });
    tp.addEventListener('change', () => {
      const vs = tp.value.split(/[,;\s]+/).filter(Boolean).map(Number);
      if (!vs.length || vs.length > 64 || vs.some((v) => !Number.isFinite(v) || v < 0)) { ctx.print(t('app.curve.bad.taper')); return; }
      set(t('app.curve.undo.shape'), (cv) => { cv.taper = vs; });
    });
    field('mc-curve-taper', t('app.curve.taper'), tp);
  }
  const res = c.splines[0].resolution;
  field('mc-curve-res', t('app.curve.resolution'), num('mc-curve-res', res, { min: 1, max: 64, int: true }, (v) => set(t('app.curve.undo.shape'), (cv) => { for (const sp of cv.splines) sp.resolution = v; })));
  if (c.splines.some((sp) => sp.type === 'nurbs')) {
    const ord = c.splines.find((sp) => sp.type === 'nurbs').order;
    field('mc-curve-order', t('app.curve.order'), num('mc-curve-order', ord, { min: 2, max: 6, int: true }, (v) => set(t('app.curve.undo.shape'), (cv) => { for (const sp of cv.splines) if (sp.type === 'nurbs') sp.order = v; })));
  }
  // the selected points' radius and tilt (the Curve workspace)
  const sp = ctx.selPoints || [];
  if (sp.length) {
    const q0 = c.splines[sp[0].s]?.points[sp[0].i];
    if (q0) {
      const same = (f) => sp.every((x) => Math.abs(f(c.splines[x.s].points[x.i]) - f(q0)) < 1e-12);
      const put = (f) => set(t('app.curve.undo.points'), (cv) => { for (const x of sp) f(cv.splines[x.s].points[x.i]); });
      const r = num('mc-curve-radius', same((q) => q.radius) ? q0.radius : '', { min: 0, max: 1e6 }, (v) => put((q) => { q.radius = v; }));
      field('mc-curve-radius', t('app.curve.radius'), r);
      const tl = num('mc-curve-tilt', same((q) => q.tilt) ? Math.round((q0.tilt * 180) / Math.PI * 1000) / 1000 : '', { min: -36000, max: 36000 }, (v) => put((q) => { q.tilt = (v * Math.PI) / 180; }));
      field('mc-curve-tilt', t('app.curve.tilt'), tl);
      if (c.splines[sp[0].s].type === 'nurbs') field('mc-curve-weight', t('app.curve.weight'), num('mc-curve-weight', same((q) => q.w) ? q0.w : '', { min: 1e-6, max: 1e6 }, (v) => put((q) => { q.w = v; })));
    }
  }
  box.append(props);
  return box;
}
