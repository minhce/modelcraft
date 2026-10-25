/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/rig-view.js — rigs in the view (0.7 AN.2, session `anim`): the bones drawn over the model (the view's drawExtra,
 * wrapped so ModelCraft's own lamps still draw), and two tools registered with tools.js registerTool:
 *   'animpose'   click a bone to choose it; drag turns it about the view's axis (Shift: moves it in the view's plane); each
 *                drag is one step — keyed at the playhead when the bone has a track or Auto key is on, else the rig's pose
 *   'animweight' the weight brush on the chosen bone: add (Ctrl: subtract), Shift smooths; the mesh shows at rest, each face
 *                coloured by that bone's weight (anim/deform.js showWeights); a stroke is one undo step (model.meshStroke)
 *
 *   RIG = {rig (id), bone (id), show: bool, brush: {mode, radius px, strength, normalise}}   the workspace's state
 *   installBones(view, model, tl) — wraps view.drawExtra once
 *   bonesOnScreen(model, tl, project) → [{rig, bone, a: [x, y], b: [x, y]}] · nearestBone(list, x, y, px)
 */
import { Tool, registerTool } from '../tools.js';
import { Sculptor } from '../mesh/sculpt.js';
import { apply, applyDir, invert, norm } from '../vec.js';
import { t } from '../i18n.js';
import { rigsOf, bonePose, setPose, setPropKey, findProp, eulerToQuat, decompose, compose, quatToEuler } from '../render/anim.js';
import { poseMatrices, bonePoints, mul, inv, point } from './rig.js';
import { rigWorld } from './deform.js';
import { rigCtx } from './cns-model.js';
import { paintDab } from './weights.js';

export const RIG = { rig: null, bone: null, show: false, brush: { mode: 'add', radius: 40, strength: 0.4, normalise: true } };

/** Every placement of a definition with its world matrix (open groups included): [{path, m}]. */
function placementsOf(model, defId) {
  const out = [];
  model.walkShown((def, m, path) => { if (def.id === defId) out.push({ path: path.slice(), m }); });
  return out;
}
/** The bones of every rig, posed as the timeline last showed them, on screen. */
export function bonesOnScreen(model, tl, project) {
  const out = [], vals = tl.values, anim = tl.shown;
  for (const rg of rigsOf(anim)) {
    if (!rg.bones.length) continue;
    const { world } = rigWorld(rg, anim, vals, rigCtx(model, anim, rg, vals));   // with its constraints (AN.3)
    const pts = bonePoints(rg, world);
    for (const pl of placementsOf(model, rg.def)) for (const p of pts) {
      const a = project(apply(pl.m, p.head)), b = project(apply(pl.m, p.tail));
      if (a && b) out.push({ rig: rg.id, bone: p.id, a, b, path: pl.path });
    }
  }
  return out;
}
export function nearestBone(list, x, y, px = 10) {
  let best = null, bd = px;
  for (const s of list) {
    const ax = s.a[0], ay = s.a[1], dx = s.b[0] - ax, dy = s.b[1] - ay, L = dx * dx + dy * dy;
    const k = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    const d = Math.hypot(ax + dx * k - x, ay + dy * k - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

let installed = null;
export function installBones(view, model, tl) {
  if (installed === view) return;
  installed = view;
  const own = view.drawExtra;
  view.drawExtra = (g, project, c) => {
    own?.(g, project, c);
    if (!RIG.show) return;
    const list = bonesOnScreen(model, tl, project);
    g.save();
    for (const s of list) {
      const on = s.rig === RIG.rig && s.bone === RIG.bone;
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, w = Math.min(7, L * 0.12);
      // a long thin diamond from head to tail, wider near the head (the bone's look), and a round head
      const m = [s.a[0] + dx * 0.15, s.a[1] + dy * 0.15];
      g.beginPath();
      g.moveTo(s.a[0], s.a[1]); g.lineTo(m[0] + nx * w, m[1] + ny * w); g.lineTo(s.b[0], s.b[1]); g.lineTo(m[0] - nx * w, m[1] - ny * w); g.closePath();
      g.fillStyle = on ? 'rgba(20, 110, 220, 0.35)' : 'rgba(120, 120, 120, 0.18)';
      g.strokeStyle = on ? (c?.sel || '#2f7cf6') : (c?.ink || '#333');
      g.lineWidth = on ? 2 : 1.25;
      g.fill(); g.stroke();
      g.beginPath(); g.arc(s.a[0], s.a[1], 3, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.restore();
  };
}

/** The tools' common start: which rig, which mesh placement. */
function rigOf(tl) { return rigsOf(tl.anim).find((r) => r.id === RIG.rig) || null; }

class PoseTool extends Tool {
  constructor(T, name, arg = {}) {
    super(T, name);
    this.tl = arg.tl;
    this.drag = null;
  }
  get hint() { return t('app.an.rig.pose.hint'); }
  get busy() { return !!this.drag; }
  set busy(x) { /* a drag says */ }
  pick(ev) { return nearestBone(bonesOnScreen(this.h.model, this.tl, (p) => this.h.cam.project(p)), ev.x, ev.y, 12); }
  down(ev) {
    const s = this.pick(ev);
    if (!s) return;
    RIG.rig = s.rig; RIG.bone = s.bone;
    this.h.changed?.();
    const rg = rigOf(this.tl), vals = this.tl.values, base = bonePose(vals, rg.id, s.bone);
    const pl = this.h.model.context(s.path);
    this.drag = { s, rg, x: ev.x, y: ev.y, base, W: pl ? pl.m : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], move: !!ev.shift, start: this.tl.anim };
  }
  move(ev) {
    if (!this.drag) { const s = this.pick(ev); this.h.overlay(s ? { tip: t('app.an.rig.bone.tip', { name: rigOf(this.tl)?.bones.find((b) => b.id === s.bone)?.name || s.bone }) } : null); return; }
    const d = this.drag, next = this.posed(d, ev);
    if (next) { d.next = next; this.tl.preview(next); this.h.changed?.(); }
  }
  /** The pose the drag gives: a turn about the view's axis through the bone's head, or a move in the view's plane. */
  posed(d, ev) {
    const { rg, s, base, W } = d;
    const { world } = poseMatrices(rg, (id) => bonePose(this.tl.values, rg.id, id));
    const Wb = world.get(s.bone);
    let p;
    if (d.move) {
      // pixels → mesh units at the bone's head, along the camera's right and up, into the bone's own frame
      const head = apply(W, point(Wb, [0, 0, 0])), px = this.h.cam.pixelSize(head);
      const cam = this.h.cam, fwd = norm([cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]]);
      const upW = Math.abs(fwd[2]) < 0.999 ? [0, 0, 1] : [0, 1, 0];
      const right = norm([fwd[1] * upW[2] - fwd[2] * upW[1], fwd[2] * upW[0] - fwd[0] * upW[2], fwd[0] * upW[1] - fwd[1] * upW[0]]);
      const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
      const dw = [0, 1, 2].map((i) => ((ev.x - d.x) * right[i] - (ev.y - d.y) * up[i]) * px);
      const dm = applyDir(invert(W), dw);
      // a move in the mesh → the bone's local frame (its pose's location is in its rest frame, parent's pose applied)
      const local = invDir(mul(Wb, inv(compose({ t: base.location, q: eulerToQuat(base.rotation), s: base.scale }))), dm);
      p = { location: base.location.map((v, i) => v + local[i]), rotation: base.rotation, scale: base.scale };
    } else {
      // the turn: the angle swept round the bone's head on screen
      const h = this.h.cam.project(apply(W, point(Wb, [0, 0, 0])));
      if (!h) return null;
      const a0 = Math.atan2(d.y - h[1], d.x - h[0]), a1 = Math.atan2(ev.y - h[1], ev.x - h[0]);
      const ang = -(a1 - a0);   // screen y runs down
      const cam = this.h.cam, axisW = norm([cam.eye[0] - cam.target[0], cam.eye[1] - cam.target[1], cam.eye[2] - cam.target[2]]);
      const axisM = norm(applyDir(invert(W), axisW));
      // the turn in the mesh, carried into the bone's frame: X = Wb⁻¹ · R · Wb (about the bone's own origin, its head)
      const R = compose({ t: [0, 0, 0], q: [axisM[0] * Math.sin(ang / 2), axisM[1] * Math.sin(ang / 2), axisM[2] * Math.sin(ang / 2), Math.cos(ang / 2)], s: [1, 1, 1] });
      const Wr = Wb.slice(); Wr[12] = Wr[13] = Wr[14] = 0;
      const X = mul(inv(Wr), mul(R, Wr));
      const L0 = compose({ t: base.location, q: eulerToQuat(base.rotation), s: base.scale });
      const L1 = mul(L0, X), dd = decompose(L1);
      p = { location: base.location, rotation: quatToEuler(dd.q, base.rotation), scale: base.scale };
    }
    return keyOrPose(this.tl, d.start, rg.id, s.bone, p);
  }
  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    this.tl.preview(null);
    if (d.next && d.next !== d.start) this.tl.commit(d.next, t('app.an.rig.posed', { name: d.rg.bones.find((b) => b.id === d.s.bone)?.name || d.s.bone }));
    this.h.changed?.();
  }
  key() { return false; }
  value() { return false; }
  escapeStep() { if (this.drag) { this.drag = null; this.tl.preview(null); this.h.changed?.(); return true; } return false; }
  cancel() { if (this.drag) { this.drag = null; this.tl.preview(null); } this.h.overlay(null); }
  finish() { if (this.drag) { this.up(); return true; } return false; }
}
const invDir = (m, d) => applyDir(invert(m), d);
/** A bone's new pose: keyed at the playhead when it has a track there or Auto key is on, else the rig's pose. */
export function keyOrPose(tl, anim, rig, bone, p) {
  const target = 'bone:' + rig + '/' + bone;
  const tracked = ['location', 'rotation', 'scale'].some((k) => findProp(anim, target, k) >= 0);
  if (tracked || tl.autoKey) {
    let a = anim;
    for (const k of ['location', 'rotation', 'scale']) a = setPropKey(a, target, k, tl.time, p[k]);
    return a;
  }
  return setPose(anim, rig, bone, p);
}

class WeightTool extends Tool {
  constructor(T, name, arg = {}) {
    super(T, name);
    this.tl = arg.tl; this.path = (arg.path || []).slice();
    const ctx = this.h.model.context(this.path);
    if (!ctx?.def.mesh) throw new Error(t('m3d.mesh.not_a_mesh'));
    this.defId = ctx.def.id; this.S = null; this.stroke = null;
  }
  get hint() { return t('app.an.rig.paint.hint'); }
  get busy() { return !!this.stroke; }
  set busy(x) { /* a stroke says */ }
  get mesh() { return this.h.model.def(this.defId)?.mesh || null; }
  get world() { return this.h.model.context(this.path)?.m || null; }
  hitAt(ev) {
    const m = this.mesh, W = this.world;
    if (!m || !W) return null;
    if (!this.S || this.S.m !== m || (!this.stroke && (this.S.topo !== m.topo || this.S.v !== m.v))) { this.S = new Sculptor(m); this.S.v = m.v; }
    const iv = invert(W), r = this.h.cam.ray(ev.x, ev.y), o = apply(iv, r.o), d = norm(applyDir(iv, r.d));
    const h = this.S.hit(o, d);
    return h ? { ...h, w: apply(W, h.p) } : null;
  }
  radius(w) { const W = this.world, scale = Math.hypot(W[0], W[1], W[2]) || 1; return (RIG.brush.radius * this.h.cam.pixelSize(w)) / scale; }
  overlay(ev, hit) { this.h.overlay({ brush: { x: ev.x, y: ev.y, r: RIG.brush.radius, off: !hit, invert: !!ev.ctrl } }); }
  dab(ev, hit) {
    const rg = rigOf(this.tl), mode = ev.shift ? 'smooth' : ev.ctrl ? 'subtract' : RIG.brush.mode;
    this.stroke.dab((m) => { paintDab(m, RIG.bone, { p: hit.p, r: this.radius(hit.w), strength: RIG.brush.strength * (ev.pen ? Math.max(0.1, ev.pressure ?? 1) : 1), mode, normalise: RIG.brush.normalise, rig: rg }); });
    this.tl.deformer.repaint(this.defId);
    this.h.changed?.();
  }
  down(ev) {
    if (!RIG.bone) { this.h.print(t('app.an.rig.paint.nobone')); return; }
    const hit = this.hitAt(ev);
    this.pressed = true;
    if (!hit) return;
    try { this.stroke = this.h.model.meshStroke(this.defId); } catch (e) { this.h.print(e.message); return; }
    this.last = hit.p;
    this.dab(ev, hit);
    this.overlay(ev, hit);
  }
  move(ev) {
    const hit = this.hitAt(ev);
    this.overlay(ev, hit);
    if (!hit) return;
    if (!this.stroke) { if (this.pressed && ev.dragging !== false && RIG.bone) this.down(ev); return; }
    const r = this.radius(hit.w);
    if (Math.hypot(hit.p[0] - this.last[0], hit.p[1] - this.last[1], hit.p[2] - this.last[2]) < r * 0.25) return;
    this.last = hit.p;
    this.dab(ev, hit);
  }
  up() {
    this.pressed = false;
    if (!this.stroke) return;
    const s = this.stroke;
    this.stroke = null;
    s.end(t('app.an.undo.paint', { name: rigOf(this.tl)?.bones.find((b) => b.id === RIG.bone)?.name || RIG.bone }));
    this.tl.deformer.repaint(this.defId);
    this.h.changed?.();
  }
  key() { return false; }
  value() { return false; }
  escapeStep() { if (this.stroke) { this.stroke.cancel(); this.stroke = null; this.tl.deformer.repaint(this.defId); this.h.changed?.(); return true; } return false; }
  cancel() { if (this.stroke) { this.stroke.cancel(); this.stroke = null; } this.h.overlay(null); }
  finish() { if (this.stroke) { this.up(); return true; } return false; }
}

registerTool('animpose', PoseTool);
registerTool('animweight', WeightTool);
