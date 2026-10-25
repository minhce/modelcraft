/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/sculpt-tool.js — the Sculpt workspace's tool ('meshsculpt', 0.7 MD.7; 'sculpt' is push/pull's own older tool): a round brush on the mesh under the pointer.
 * A stroke is one undo step (model.meshStroke); dabs are spaced a quarter of the brush apart along it. The brush's size is
 * in screen pixels, so it feels the same at any zoom; a pen's pressure scales its size and strength (each can be turned
 * off). Ctrl (or the brush's "Take away") inverts; Shift smooths while held. Settings live on the tools (T.meshSculpt), the
 * Sculpt workspace's panel shows them.
 */
import { Tool, registerTool } from '../tools.js';
import { Sculptor, BRUSHES } from './sculpt.js';
import { apply, applyDir, invert, sub, dot, norm, rayPlane } from '../vec.js';
import { t } from '../i18n.js';

export const SCULPT_DEFAULTS = { brush: 'draw', radius: 50, strength: 0.5, invert: false, sym: '', detail: 0, pressureSize: true, pressureStrength: true };

export class SculptTool extends Tool {
  constructor(T, name, arg = {}) {
    super(T, name);
    this.path = (arg.path || []).slice();
    const ctx = this.h.model.context(this.path);
    if (!ctx?.def.mesh || ctx.def.curve) throw new Error(t('m3d.mesh.not_a_mesh'));
    this.defId = ctx.def.id;
    this.set = T.meshSculpt || (T.meshSculpt = { ...SCULPT_DEFAULTS });
    this.S = null; this.stroke = null; this.cursor = null;
  }
  get mesh() { return this.h.model.def(this.defId)?.mesh || null; }
  get world() { return this.h.model.context(this.path)?.m || null; }
  get busy() { return !!this.stroke; }
  set busy(x) { /* a stroke says */ }
  get hint() { return t('app.sculpt.hint', { brush: t('app.sculpt.brush.' + this.set.brush) }); }
  sculptor() {
    const m = this.mesh;
    if (!this.S || this.S.m !== m || (!this.stroke && (this.S.topo !== m.topo || this.S.liveTopo !== m.liveTopo || this.S.v !== m.v))) { this.S = new Sculptor(m); this.S.v = m.v; }
    return this.S;
  }
  /** The mesh under screen point ev: {p (mesh space), w (world), n} or null. */
  hitAt(ev) {
    const W = this.world, inv = invert(W), r = this.h.cam.ray(ev.x, ev.y);
    const o = apply(inv, r.o), d = norm(applyDir(inv, r.d));
    const h = this.sculptor().hit(o, d);
    return h ? { ...h, w: apply(W, h.p) } : null;
  }
  /** The brush's radius in mesh units at world point w (from its pixels, a pen's pressure if it should). */
  radius(w, ev) {
    const W = this.world, scale = Math.hypot(W[0], W[1], W[2]) || 1;
    const px = this.set.radius * (this.set.pressureSize && ev?.pen ? Math.max(0.1, ev.pressure ?? 1) : 1);
    return (px * this.h.cam.pixelSize(w)) / scale;
  }
  brushOf(ev) { return ev?.shift ? 'smooth' : this.set.brush; }
  invertOf(ev) { return !!this.set.invert !== !!ev?.ctrl; }
  overlay(ev, hit) {
    this.h.overlay({ brush: { x: ev.x, y: ev.y, r: this.set.radius * (this.set.pressureSize && ev.pen ? Math.max(0.1, ev.pressure ?? 1) : 1), off: !hit, invert: this.invertOf(ev) } });
  }

  down(ev) {
    this.pressed = true;
    const hit = this.hitAt(ev);
    if (!hit) return;   // pressed off the mesh: the stroke starts where the pointer reaches it
    this.begin(ev, hit);
  }
  begin(ev, hit) {
    const S = this.sculptor(), brush = this.brushOf(ev), r = this.radius(hit.w, ev);
    try { this.stroke = this.h.model.meshStroke(this.defId); } catch (e) { this.h.print(e.message); return; }
    this.brush = brush; this.last = hit.p; this.lastW = hit.w; this.n = 0;
    if (brush === 'grab') {
      S.grabStart(hit.p, r, this.set.sym);
      // the grab follows the pointer on the plane through the hit, facing the camera
      const cn = norm(sub(this.h.cam.eye, this.h.cam.target));
      this.grabPlane = { n: cn, d: dot(cn, hit.w), w0: hit.w };
    } else this.dabAt(hit.p, r, ev);
    this.overlay(ev, hit);
  }
  dabAt(p, r, ev) {
    const S = this.S, set = this.set, W = this.world, scale = Math.hypot(W[0], W[1], W[2]) || 1;
    const detail = set.detail > 0 ? (set.detail * this.h.cam.pixelSize(apply(W, p))) / scale : 0;
    this.stroke.dab(() => { this.n += S.dab(this.brush, { p, r, strength: set.strength, pressure: set.pressureStrength && ev?.pen ? ev.pressure ?? 1 : 1, invert: this.invertOf(ev), sym: set.sym, detail }); });
    this.h.changed?.();
  }
  move(ev) {
    if (!this.stroke) { const hit = this.hitAt(ev); this.overlay(ev, hit); if (hit && this.pressed && ev.dragging !== false) this.begin(ev, hit); return; }
    if (this.brush === 'grab') {
      const r = this.h.cam.ray(ev.x, ev.y), gp = this.grabPlane, hit = rayPlane(r.o, r.d, { n: gp.n, d: gp.d });
      if (!hit) return;
      const inv = invert(this.world), delta = sub(apply(inv, hit.p), apply(inv, gp.w0));
      this.stroke.dab(() => { this.n += this.S.dab('grab', { delta, invert: false }); });
      this.h.changed?.();
      this.h.overlay({ brush: { x: ev.x, y: ev.y, r: this.set.radius, invert: false } });
      return;
    }
    const hit = this.hitAt(ev);
    this.overlay(ev, hit);
    if (!hit) return;
    const r = this.radius(hit.w, ev), step = r * 0.25;
    // dabs a quarter of the brush apart along the way from the last one
    const d = Math.hypot(hit.p[0] - this.last[0], hit.p[1] - this.last[1], hit.p[2] - this.last[2]);
    if (d < step) return;
    const k = Math.min(32, Math.floor(d / step));
    for (let i = 1; i <= k; i++) {
      const f = i / k, p = [this.last[0] + (hit.p[0] - this.last[0]) * f, this.last[1] + (hit.p[1] - this.last[1]) * f, this.last[2] + (hit.p[2] - this.last[2]) * f];
      this.dabAt(p, r, ev);
    }
    this.last = hit.p;
  }
  up() {
    this.pressed = false;
    if (!this.stroke) return;
    const s = this.stroke;
    this.stroke = null;
    s.end(t('app.sculpt.undo.' + this.brush));
    this.S.refresh(); this.S.v = this.mesh.v;
    this.h.settle?.(); this.h.changed?.();
  }
  key() { return false; }
  value() { return false; }
  escapeStep() { if (this.stroke) { this.stroke.cancel(); this.stroke = null; this.S = null; this.h.changed?.(); return true; } return false; }
  cancel() { if (this.stroke) { this.stroke.cancel(); this.stroke = null; } this.h.overlay(null); }
  finish() { if (this.stroke) { this.up(); return true; } return false; }
}
export { BRUSHES };

registerTool('meshsculpt', SculptTool);
