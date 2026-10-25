/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/curve-tool.js — editing a curve object's points (0.7 MD.6), the Curve workspace's tool ('curveedit'). The curve is
 * plain data on the definition (`def.curve`, mesh/curve.js); every change is one undo step (model.change on it), drags are
 * previewed (model.preview) and committed once. Points and Bézier handles are picked on screen; they move in the plane
 * facing the camera through the point picked (a flat curve: in its own plane).
 *
 *   commands: select-all, select-none, delete, extrude (a point after the selected end, at the pointer), subdivide (a
 *   point in the middle of each segment between selected points), cyclic, reverse, handles-auto | -vector | -free,
 *   type-bezier | -nurbs | -poly, grab, scale, rotate
 * Keys go through the workspace (ws-curve.js). Selection keys: 's:i' a point, 's:i:l' / 's:i:r' its handles.
 */
import { Tool, registerTool } from '../tools.js';
import { handles, insertAfter, reverse, toType } from './curve.js';
import { apply, invert, sub, add, mul, dot, norm, rayPlane } from '../vec.js';
import { t } from '../i18n.js';

export const CURVE_COMMANDS = ['select-all', 'select-none', 'delete', 'extrude', 'subdivide', 'cyclic', 'reverse', 'handles-auto', 'handles-vector', 'handles-free', 'type-bezier', 'type-nurbs', 'type-poly', 'grab', 'scale', 'rotate'];
const sels = new WeakMap();   // def → its selected keys, kept while the definition lives

export class CurveEditTool extends Tool {
  constructor(T, name, arg = {}) {
    super(T, name);
    this.path = (arg.path || []).slice();
    const ctx = this.h.model.context(this.path);
    if (!ctx?.def.curve) throw new Error(t('app.curve.not_a_curve'));
    this.defId = ctx.def.id;
    this.sel = sels.get(ctx.def) || new Set();
    sels.set(ctx.def, this.sel);
    this.ver = 1; this.op = null; this.press = null; this.hover = -1;
    this.show();
  }
  get def() { return this.h.model.def(this.defId); }
  get curve() { return this.def?.curve || null; }
  get world() { return this.h.model.context(this.path)?.m || null; }
  get busy() { return !!this.op; }
  set busy(x) { /* the op says */ }
  get lockable() { return false; }
  get hint() { return this.op ? t('app.curve.hint.' + this.op.kind) : t('app.curve.hint.edit'); }
  get vcbLabel() { return t('app.mesh.vcb.value'); }

  /** Every point and handle as a list: {key, s, i, which ('p' | 'l' | 'r'), p (local)}. */
  items() {
    const c = this.curve, out = [];
    if (!c) return out;
    c.splines.forEach((sp0, s) => {
      const sp = sp0.type === 'bezier' ? handles(sp0) : sp0;
      sp.points.forEach((q, i) => {
        out.push({ key: s + ':' + i, s, i, which: 'p', p: q.p });
        if (sp.type === 'bezier') { out.push({ key: s + ':' + i + ':l', s, i, which: 'l', p: q.hl }); out.push({ key: s + ':' + i + ':r', s, i, which: 'r', p: q.hr }); }
      });
    });
    return out;
  }
  show() {
    const c = this.curve, m = this.world;
    if (!c || !m) { this.h.curveEdit?.(null); return; }
    // keys that no longer exist go
    const its = this.items(), keys = new Set(its.map((x) => x.key));
    for (const k of [...this.sel]) if (!keys.has(k)) this.sel.delete(k);
    const pts = new Float32Array(its.length * 3), kinds = new Uint8Array(its.length), sl = new Uint8Array(its.length), lines = [];
    its.forEach((x, k) => { pts.set(x.p, k * 3); kinds[k] = x.which === 'p' ? 0 : 1; sl[k] = this.sel.has(x.key) ? 1 : 0; });
    c.splines.forEach((sp0) => {
      const sp = sp0.type === 'bezier' ? handles(sp0) : sp0, n = sp.points.length;
      if (sp.type === 'bezier') for (const q of sp.points) lines.push(...q.hl, ...q.p, ...q.p, ...q.hr);
      else { for (let i = 0; i + 1 < n; i++) lines.push(...sp.points[i].p, ...sp.points[i + 1].p); if (sp.cyclic && n > 2) lines.push(...sp.points[n - 1].p, ...sp.points[0].p); }
    });
    this._its = its;
    this.h.curveEdit?.({ m, ver: this.ver, pts, kinds, sel: sl, hover: this.hover, lines: Float32Array.from(lines) });
  }
  selChanged() { this.ver++; this.show(); this.h.changed?.(); }
  /** The item nearest the pointer on screen (within r px), or −1. Handles first when they overlap their point. */
  pick(ev, r = this.T.touch ? 18 : 10) {
    const W = this.world, its = this._its || this.items();
    let best = -1, bd = r * r;
    its.forEach((x, k) => {
      const s = this.h.cam.project(apply(W, x.p));
      if (!s) return;
      const d = (s[0] - ev.x) ** 2 + (s[1] - ev.y) ** 2 - (x.which === 'p' ? 0 : 1);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }
  /** A world point under the pointer on the plane through w facing the camera (a flat curve: its own plane). */
  planeAt(ev, w) {
    const r = this.h.cam.ray(ev.x, ev.y);
    let n = norm(sub(this.h.cam.eye, this.h.cam.target));
    if (this.curve.dim === '2d') { const W = this.world; n = norm(sub(apply(W, [0, 0, 1]), apply(W, [0, 0, 0]))); }
    const hit = rayPlane(r.o, r.d, { n, d: dot(n, w) });
    return hit ? hit.p : w;
  }
  toLocal(w) { return apply(invert(this.world), w); }

  // ---- pointer ----
  down(ev) {
    if (this.op) { this.op.down?.(ev); return; }
    const k = this.pick(ev);
    this.press = { x: ev.x, y: ev.y, k, ev };
    if (k >= 0) {
      const key = this._its[k].key;
      if (ev.shift) { if (this.sel.has(key)) this.sel.delete(key); else this.sel.add(key); this.press.toggled = true; }
      else if (!this.sel.has(key)) { this.sel.clear(); this.sel.add(key); }
      this.selChanged();
    }
  }
  move(ev) {
    this.lastEv = ev;
    if (this.op) { this.op.move(ev); return; }
    const pr = this.press;
    if (pr && ev.dragging) {
      if (pr.k >= 0 && !pr.toggled) { this.op = new MoveOp(this, 'grab', pr.ev, apply(this.world, this._its[pr.k].p), true); this.op.move(ev); return; }
      if (pr.k < 0) { this.h.overlay({ rect: { x0: pr.x, y0: pr.y, x1: ev.x, y1: ev.y, crossing: false } }); return; }
    }
    const k = this.pick(ev);
    if (k !== this.hover) { this.hover = k; this.ver++; this.show(); }
  }
  up(ev) {
    if (this.op) { this.op.up?.(ev); return; }
    const pr = this.press;
    this.press = null;
    this.h.overlay(null);
    if (!pr) return;
    if (pr.k >= 0) return;
    if (ev.dragged) { this.boxSelect({ x0: pr.x, y0: pr.y, x1: ev.x, y1: ev.y }, ev); return; }
    if (ev.ctrl && !ev.alt) { this.extrude(ev); return; }
    if (!ev.shift) { this.sel.clear(); this.selChanged(); }
  }
  boxSelect(r, ev) {
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1), W = this.world;
    if (!ev.shift) this.sel.clear();
    for (const x of this._its || this.items()) { const s = this.h.cam.project(apply(W, x.p)); if (s && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1) this.sel.add(x.key); }
    this.selChanged();
  }
  key(k, ev) { return this.op?.key?.(k, ev) || false; }
  value(v) { return this.op?.value?.(v) || false; }
  escapeStep() { if (this.op) { this.op.cancel(); return true; } return false; }
  cancel() { if (this.op) this.op.cancel(); this.h.overlay(null); this.h.curveEdit?.(null); }
  finish() { if (this.op?.confirm) { this.op.confirm(); return true; } return false; }

  // ---- edits ----
  /** One undo step: fn(a copy of the curve) → the new curve (or nothing to keep the copy). */
  edit(label, fn) {
    let ok = true;
    try {
      this.h.model.change(label, (m) => {
        const d = m.def(this.defId), next = structuredClone(d.curve), r = fn(next);
        d.curve = r || next;
      }, [this.defId]);
    } catch (e) { ok = false; this.h.print(e.message); }
    this.selChanged(); this.h.settle?.();
    return ok;
  }
  /** Selected points (not handles) as {s, i}, by spline. */
  selPoints() {
    const out = [];
    for (const k of this.sel) { const [s, i, w] = k.split(':'); if (!w) out.push({ s: +s, i: +i }); }
    return out.sort((a, b) => a.s - b.s || a.i - b.i);
  }
  command(name, ev) {
    const c = this.curve;
    if (!c) return false;
    switch (name) {
      case 'select-all': for (const x of this.items()) this.sel.add(x.key); this.selChanged(); return true;
      case 'select-none': this.sel.clear(); this.selChanged(); return true;
      case 'delete': {
        const ps = this.selPoints();
        if (!ps.length) { this.h.print(t('app.curve.need_points')); return false; }
        const drop = new Set(ps.map((x) => x.s + ':' + x.i));
        const ok = this.edit(t('app.curve.undo.delete'), (cv) => {
          cv.splines = cv.splines.map((sp, s) => ({ ...sp, points: sp.points.filter((_, i) => !drop.has(s + ':' + i)) })).filter((sp) => sp.points.length >= 2);
          if (!cv.splines.length) throw new Error(t('app.curve.would_be_empty'));
        });
        if (ok) { this.sel.clear(); this.selChanged(); }
        return ok;
      }
      case 'extrude': return this.extrude(ev || this.lastEv);
      case 'subdivide': {
        const ps = this.selPoints(), at = new Set(ps.map((x) => x.s + ':' + x.i));
        const jobs = ps.filter((x) => { const sp = c.splines[x.s], n = sp.points.length, j = (x.i + 1) % n; return (x.i + 1 < n || sp.cyclic) && at.has(x.s + ':' + j); });
        if (!jobs.length) { this.h.print(t('app.curve.need_segment')); return false; }
        return this.edit(t('app.curve.undo.subdivide'), (cv) => {
          // from the end backwards, so earlier indices stay put
          for (const x of jobs.slice().reverse()) cv.splines[x.s] = insertAfter(cv.splines[x.s], x.i);
        });
      }
      case 'cyclic': case 'reverse': case 'type-bezier': case 'type-nurbs': case 'type-poly': {
        const which = this.splinesOfSel();
        return this.edit(t('app.curve.undo.' + (name.startsWith('type-') ? 'type' : name)), (cv) => {
          for (const s of which) {
            const sp = cv.splines[s];
            if (name === 'cyclic') sp.cyclic = !sp.cyclic;
            else if (name === 'reverse') cv.splines[s] = reverse(sp);
            else cv.splines[s] = toType(sp, name.slice(5));
          }
        });
      }
      case 'handles-auto': case 'handles-vector': case 'handles-free': {
        const ps = this.selPoints(), h = name.slice(8);
        if (!ps.length) { this.h.print(t('app.curve.need_points')); return false; }
        return this.edit(t('app.curve.undo.handles'), (cv) => {
          for (const x of ps) {
            const sp = cv.splines[x.s];
            if (sp.type !== 'bezier') continue;
            if (h === 'free') { const placed = handles(sp).points[x.i]; sp.points[x.i].hl = placed.hl; sp.points[x.i].hr = placed.hr; }
            sp.points[x.i].h = h;
          }
        });
      }
      case 'grab': case 'scale': case 'rotate': {
        if (!this.sel.size) { this.h.print(t('app.curve.need_points')); return false; }
        const e = ev || this.lastEv || { x: this.h.view?.w / 2 || 0, y: this.h.view?.h / 2 || 0 };
        this.op = new MoveOp(this, name, e, null, false);
        this.h.tip(this.hint);
        return true;
      }
      default: return false;
    }
  }
  /** The splines the selection touches (all, when nothing is selected). */
  splinesOfSel() {
    const s = new Set();
    for (const k of this.sel) s.add(+k.split(':')[0]);
    return s.size ? [...s] : this.curve.splines.map((_, i) => i);
  }
  /** A new point after the selected end point (or the last spline's end) at the pointer; it becomes the selection. */
  extrude(ev) {
    const c = this.curve;
    let s = c.splines.length - 1, i = c.splines[s].points.length - 1, before = false;
    const ps = this.selPoints();
    if (ps.length === 1) {
      const sp = c.splines[ps[0].s];
      if (ps[0].i === 0 && !sp.cyclic) { s = ps[0].s; i = 0; before = true; } else { s = ps[0].s; i = ps[0].i; }
    }
    const from = c.splines[s].points[i], W = this.world;
    const w = ev ? this.planeAt(ev, apply(W, from.p)) : apply(W, add(from.p, [0.1, 0, 0]));
    let p = this.toLocal(w);
    if (c.dim === '2d') p = [p[0], p[1], 0];
    const np = { p, hl: p.slice(), hr: p.slice(), h: 'auto', w: 1, radius: from.radius, tilt: from.tilt };
    const ok = this.edit(t('app.curve.undo.extrude'), (cv) => { cv.splines[s].points.splice(before ? 0 : i + 1, 0, np); });
    if (ok) { this.sel.clear(); this.sel.add(s + ':' + (before ? 0 : i + 1)); this.selChanged(); }
    return ok;
  }
}

/** Move (grab), scale or turn the selected points and handles, following the pointer; one undo step. */
class MoveOp {
  constructor(tool, kind, ev, anchor, byDrag) {
    this.tool = tool; this.h = tool.h; this.kind = kind; this.byDrag = byDrag;
    this.base = structuredClone(tool.curve);
    const W = tool.world;
    const pts = tool.items().filter((x) => tool.sel.has(x.key));
    let c = [0, 0, 0];
    for (const x of pts) c = add(c, x.p);
    this.center = pts.length ? mul(c, 1 / pts.length) : [0, 0, 0];
    this.anchorW = anchor || apply(W, this.center);
    this.w0 = tool.planeAt(ev, this.anchorW);
    this.ev0 = ev;
    this.h.model.begin();
  }
  move(ev) {
    this.lastEv = ev;
    const tool = this.tool, W = tool.world, inv = invert(W);
    const w1 = tool.planeAt(ev, this.anchorW);
    let fn;
    if (this.kind === 'grab') { const d = sub(apply(inv, w1), apply(inv, this.w0)); fn = (p) => add(p, d); }
    else {
      const cW = apply(W, this.center), cs = this.h.cam.project(cW), a0 = [this.ev0.x - cs[0], this.ev0.y - cs[1]], a1 = [ev.x - cs[0], ev.y - cs[1]];
      if (this.kind === 'scale') { const k = Math.hypot(a1[0], a1[1]) / Math.max(1, Math.hypot(a0[0], a0[1])); fn = (p) => add(this.center, mul(sub(p, this.center), k)); }
      else {
        // turn about the line of sight through the centre (a flat curve: its own z)
        const ang = -(Math.atan2(a1[1], a1[0]) - Math.atan2(a0[1], a0[0]));
        const axisW = tool.curve.dim === '2d' ? norm(sub(apply(W, [0, 0, 1]), apply(W, [0, 0, 0]))) : norm(sub(this.h.cam.eye, this.h.cam.target));
        const ax = norm(sub(apply(inv, add(cW, axisW)), this.center)), c = Math.cos(ang), s = Math.sin(ang);
        fn = (p) => { const v = sub(p, this.center), k = dot(ax, v), x = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]]; return add(this.center, [v[0] * c + x[0] * s + ax[0] * k * (1 - c), v[1] * c + x[1] * s + ax[1] * k * (1 - c), v[2] * c + x[2] * s + ax[2] * k * (1 - c)]); };
      }
    }
    const sel = tool.sel, flat = tool.curve.dim === '2d';
    const next = structuredClone(this.base);
    next.splines.forEach((sp, s) => {
      const placed = sp.type === 'bezier' ? handles(sp) : sp;
      sp.points.forEach((q, i) => {
        const P = sel.has(s + ':' + i), L = sel.has(s + ':' + i + ':l'), R = sel.has(s + ':' + i + ':r');
        const f = (p) => { const r = fn(p); return flat ? [r[0], r[1], p[2]] : r; };
        if (P) { q.p = f(q.p); if (sp.type === 'bezier') { q.hl = f(placed.points[i].hl); q.hr = f(placed.points[i].hr); } }
        if (sp.type === 'bezier' && (L || R) && !P) {
          q.h = 'free'; q.hl = L ? f(placed.points[i].hl) : placed.points[i].hl; q.hr = R ? f(placed.points[i].hr) : placed.points[i].hr;
        }
      });
    });
    this.h.model.preview((m) => { m.def(tool.defId).curve = next; }, [tool.defId]);
    tool.ver++; tool.show(); this.h.changed?.();
  }
  down() { if (!this.byDrag) this.confirm(); }
  up() { if (this.byDrag) this.confirm(); }
  key(k) { if (k === 'Enter') { this.confirm(); return true; } return false; }
  confirm() { this.h.model.commit(t('app.curve.undo.' + this.kind)); this.end(); }
  cancel() { this.h.model.abort(); this.end(); }
  end() { this.tool.op = null; this.tool.press = null; this.tool.selChanged(); this.h.settle?.(); this.h.tip(this.tool.hint); }
}

registerTool('curveedit', CurveEditTool);
