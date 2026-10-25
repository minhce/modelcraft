/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/edit-tool.js — editing a mesh's own vertices, edges and faces (0.7 MD.2): the `meshedit` tool, registered into
 * tools.js (registerTool), so it gets the same pointer, key, value-box and Esc plumbing as every other tool. DOM-free:
 * the page draws what it reports through host.meshEdit(state) (view3d.setMeshEdit) and host.overlay (the 2D marks).
 * The Mesh workspace (ws-mesh.js) starts it on a mesh placement and sends it its commands and keys.
 *
 *   tools.set('meshedit', {path})        path = the mesh placement's path from the top
 *   tool.command(name, ev)               every command (list in COMMANDS); → true when it did something
 *   tool.setMode('vert'|'edge'|'face')   tool.sel (mesh/select.js), tool.last (the last operation, for Adjust last)
 *
 * Every edit is one undo step through model.meshEdit / meshPreview (delta undo, MD.1). Moves are modal (from the
 * pointer; X/Y/Z or the arrow keys lock an axis, a typed value is exact, a click or Enter puts it down, Esc or a
 * right click cancels); with proportional editing on, vertices near the selection follow by distance (falloff).
 */
import { Tool, registerTool } from '../tools.js';
import { MeshSelection } from './select.js';
import { MeshPicker } from './pick.js';
import * as O from './ops.js';
import { apply, applyDir, invert, add, sub, mul, dot, cross, norm, len, rayPlane } from '../vec.js';
import { formatLength } from '../units.js';
import { t } from '../i18n.js';
import { resolveRef } from './mod-eval.js';
import { surfaceNear, projectVerts } from './remesh.js';

export const COMMANDS = [
  'mode-vert', 'mode-edge', 'mode-face', 'select-all', 'select-none', 'select-invert', 'select-linked', 'select-more', 'select-less',
  'select-loop', 'select-ring', 'select-sharp', 'grab', 'rotate', 'scale', 'extrude', 'extrude-individual', 'inset', 'bevel',
  'bevel-verts', 'loopcut', 'knife', 'bisect', 'edge-slide', 'vertex-slide', 'merge', 'merge-distance', 'dissolve', 'delete',
  'fill', 'grid-fill', 'bridge', 'subdivide', 'spin', 'flip', 'smooth', 'prop-toggle', 'crease', 'crease-clear',
];
const sels = new WeakMap();   // mesh → its selection, kept while the mesh lives (going back to it keeps what was selected)
const DEG = Math.PI / 180;

export class MeshEditTool extends Tool {
  constructor(T, name, arg = {}) {
    super(T, name);
    this.path = (arg.path || []).slice();
    const ctx = this.h.model.context(this.path);
    if (!ctx?.def.mesh) throw new Error(t('m3d.mesh.not_a_mesh'));
    this.defId = ctx.def.id;
    let sel = sels.get(ctx.def.mesh);
    if (!sel) { sel = new MeshSelection(ctx.def.mesh, T.meshMode || 'vert'); sels.set(ctx.def.mesh, sel); }
    this.sel = sel;
    this.ver = 1; this.op = null; this.hover = null; this.press = null; this.last = null;
    this.prop = T.meshProp || (T.meshProp = { on: false, radius: 1, falloff: 'smooth', connected: false });
    this.show();
  }
  get mesh() { return this.h.model.def(this.defId)?.mesh || null; }
  get world() { return this.h.model.context(this.path)?.m || null; }
  get mode() { return this.sel.mode; }
  get lockable() { return !!this.op; }
  get busy() { return !!this.op; }
  set busy(x) { /* the op says */ }
  get hint() { return this.op?.hint?.() || t('app.mesh.hint.' + this.sel.mode); }
  get vcbLabel() { return this.op?.label || t('app.mesh.vcb.value'); }

  /** Tell the page what to draw (the mesh's vertices / edges / selection) and refresh the selection's room. */
  show() {
    const me = this.mesh, m = this.world;
    if (!me || !m) { this.h.meshEdit?.(null); return; }
    if (this.sel.mesh !== me) { this.sel = sels.get(me) || new MeshSelection(me, this.sel.mode); sels.set(me, this.sel); }
    this.sel.fit();
    this.h.meshEdit?.({ mesh: me, m, sel: this.sel, mode: this.sel.mode, hover: this.hover, ver: this.ver, prop: this.prop, front: !!this.T.retopo?.front });
  }
  selChanged() { this.ver++; this.show(); this.h.changed?.(); }
  /**
   * MD.8 retopology: the target surface's nearest-point function in this mesh's space when "snap moved points onto it"
   * is on (T.retopo = {target: definition id, snap, front}), else null. Kept until the model changes.
   */
  snapNear() {
    const rt = this.T.retopo, model = this.h.model;
    if (!rt?.snap || !rt.target || rt.target === this.defId) return null;
    const key = this.defId + '|' + rt.target + '|' + (this.h.model.previewing ? rt._v : model.version);
    if (rt._key === key) return rt._near;
    const r = resolveRef(model, model.def(this.defId), { kind: 'object', ref: rt.target });
    rt._near = r && r.tris.tri.length ? surfaceNear(r.tris) : null;
    rt._key = key; rt._v = model.version;
    return rt._near;
  }
  /** Put the selected vertices on the retopology target now (one undo step). → how many moved, or −1 with no target. */
  projectSelected() {
    const rt = this.T.retopo;
    if (!rt?.target) return -1;
    const r = resolveRef(this.h.model, this.h.model.def(this.defId), { kind: 'object', ref: rt.target });
    if (!r) return -1;
    const near = surfaceNear(r.tris), vs = this.sel.verts();
    return this.edit(t('app.mesh.undo.project'), (m) => projectVerts(m, vs, near)) ?? 0;
  }
  picker() {
    const me = this.mesh, m = this.world;
    if (!this.pk || this.pk.mesh !== me || !this.pk.fresh() || this.pk.m.some((x, i) => x !== m[i])) this.pk = new MeshPicker(me, m);
    return this.pk;
  }
  setMode(mode) { this.sel.setMode(mode); this.T.meshMode = mode; this.hover = null; this.selChanged(); this.h.tip(this.hint); }

  // ---- pointer ----
  down(ev) {
    if (this.op) { this.op.down?.(ev); return; }
    this.press = { x: ev.x, y: ev.y };
  }
  move(ev) {
    this.lastEv = ev;
    if (this.op) { this.op.move(ev); return; }
    if (this.press && ev.dragging) {
      this.h.overlay({ rect: { x0: this.press.x, y0: this.press.y, x1: ev.x, y1: ev.y, crossing: false } });
      return;
    }
    const hit = this.picker().at(this.h.cam, ev.x, ev.y, this.sel.mode, { radius: this.T.touch ? 18 : 10 });
    const hv = hit ? { kind: hit.kind, el: hit.el } : null;
    if (JSON.stringify(hv) !== JSON.stringify(this.hover)) { this.hover = hv; this.show(); }
  }
  up(ev) {
    if (this.op) { this.op.up?.(ev); return; }
    const pr = this.press;
    this.press = null;
    this.h.overlay(null);
    if (!pr) return;
    if (ev.dragged) { this.boxSelect({ x0: pr.x, y0: pr.y, x1: ev.x, y1: ev.y }, ev); return; }
    this.clickSelect(ev);
  }
  clickSelect(ev) {
    const pk = this.picker(), cam = this.h.cam, me = this.mesh;
    const how = ev.shift ? 'toggle' : ev.ctrl && !ev.alt ? 'add' : 'set';
    // Alt + click: the edge loop under the pointer; Ctrl + Alt: the ring; a double click on an edge: its loop; three: linked
    if (ev.alt || ev.count === 2 || ev.count >= 3) {
      if (ev.count >= 3) {
        const f = pk.at(cam, ev.x, ev.y, 'face');
        if (f) { this.sel.linkedFrom(f.el, 'face', ev.shift ? 'add' : 'set'); this.selChanged(); }
        return;
      }
      const e = pk.at(cam, ev.x, ev.y, 'edge', { radius: 14 });
      if (!e) return;
      if (ev.alt && ev.ctrl) this.sel.ring(e.el, ev.shift ? 'add' : 'set');
      else if (this.sel.mode === 'face') this.sel.faceLoop(e.el, ev.shift ? 'add' : 'set');
      else this.sel.loop(e.el, ev.shift ? 'add' : 'set');
      this.selChanged();
      return;
    }
    const hit = pk.at(cam, ev.x, ev.y, this.sel.mode, { radius: this.T.touch ? 18 : 10 });
    if (!hit) { if (how === 'set') { this.sel.clear(); this.selChanged(); } return; }
    if (hit.kind === 'vert') this.sel.pickVert(hit.el, how);
    else if (hit.kind === 'edge') this.sel.pickEdge(hit.el, how);
    else this.sel.pickFace(hit.el, how);
    void me;
    this.selChanged();
  }
  boxSelect(rect, ev) {
    const list = this.picker().inRect(this.h.cam, rect, this.sel.mode, { seen: !this.T.xray });
    const how = ev.shift ? 'add' : ev.ctrl ? 'remove' : 'set';
    const arr = this.sel.mode === 'vert' ? this.sel.v : this.sel.mode === 'edge' ? this.sel.e : this.sel.f;
    if (how === 'set') this.sel.clear();
    for (const x of list) { arr[x] = how === 'remove' ? 0 : 1; if (this.sel.mode === 'edge') { const t2 = this.mesh.hTw[x]; if (t2 >= 0) arr[t2] = arr[x]; } }
    this.sel.flush();
    this.selChanged();
  }

  // ---- keys and typed values ----
  key(k, ev) { return this.op?.key?.(k, ev) || false; }
  relock() { if (this.op && this.lastEv) this.op.move(this.lastEv); }
  value(v, text) {
    if (this.op?.value) return this.op.value(v, text);
    return false;
  }
  escapeStep() { if (this.op) { this.op.cancel(); return true; } return false; }
  cancel() {
    if (this.op) this.op.cancel();
    this.h.overlay(null);
    this.h.meshEdit?.(null);
  }
  finish() { if (this.op?.confirm) { this.op.confirm(); return true; } return false; }

  // ---- helpers ----
  /** A world point under the pointer on the plane through w facing the camera. */
  onViewPlane(ev, w) {
    const r = this.h.cam.ray(ev.x, ev.y), n = norm(sub(this.h.cam.eye, this.h.cam.target));
    const hit = rayPlane(r.o, r.d, { n, d: dot(n, w) });
    return hit ? hit.p : w;
  }
  /** The point of the line (w, dir) nearest the pointer's ray. */
  onLine(ev, w, dir) {
    const r = this.h.cam.ray(ev.x, ev.y), d1 = norm(dir), d2 = r.d, w0 = sub(w, r.o);
    const a = dot(d1, d1), b = dot(d1, d2), c = dot(d2, d2), d = dot(d1, w0), e = dot(d2, w0), den = a * c - b * b;
    const s = Math.abs(den) < 1e-12 ? 0 : (b * e - c * d) / den;
    return add(w, mul(d1, s));
  }
  selCenter() {
    const me = this.mesh, vs = this.sel.verts();
    if (!vs.length) return null;
    let c = [0, 0, 0];
    for (const v of vs) c = add(c, [me.P[v * 3], me.P[v * 3 + 1], me.P[v * 3 + 2]]);
    return mul(c, 1 / vs.length);
  }
  /** One undo step: fn(mesh) between begin and end; the selection follows `after(result)`. */
  edit(label, fn, after) {
    let r;
    try { r = this.h.model.meshEdit(this.defId, label, (me) => fn(me)); }
    catch (err) { this.say(err); return null; }
    this.sel.fit();
    if (after) after(r);
    this.hover = null; this.pk = null;
    this.selChanged();
    this.h.settle?.();
    return r;
  }
  say(err) { this.h.print(err?.code ? t('app.mesh.err.' + err.code) : err?.message || String(err)); }
  needSel(kind = 'any') {
    const c = this.sel.counts();
    const ok = kind === 'faces' ? c.faces : kind === 'edges' ? c.edges : kind === 'verts' ? c.verts : c.verts;
    if (!ok) this.h.print(t('app.mesh.need.' + kind));
    return !!ok;
  }
  /** Remember what was just done, so Adjust last can do it again with other settings. */
  remember(name, params, label) { this.last = { name, params: { ...params }, label, step: this.h.model.lastStep(), defId: this.defId, sel: this._selBefore || this.selSnapshot() }; }
  selSnapshot() { return { mode: this.sel.mode, v: this.sel.v.slice(), e: this.sel.e.slice(), f: this.sel.f.slice() }; }
  selRestore(s) { this.sel.mode = s.mode; this.sel.v = s.v.slice(); this.sel.e = s.e.slice(); this.sel.f = s.f.slice(); this.sel.fit(); }
  /** Do the last operation again from where it started, with `params` changed (the panel's Adjust last). */
  adjustLast(params) {
    const L = this.last;
    if (!L || this.h.model.lastStep() !== L.step) { this.h.print(t('app.mesh.adjust.gone')); return false; }
    const run = OPS_AGAIN[L.name];
    if (!run) return false;
    const next = { ...L.params, ...params };
    let result = null;
    const ok = this.h.model.amendLast(L.step, (model) => {
      const me = model.def(L.defId).mesh;
      this.selRestore(L.sel);
      me.begin();
      try { result = run(me, next, this); } catch (e) { me.cancel(); throw e; }
      me.end();
    });
    if (!ok) { this.h.print(t('app.mesh.adjust.failed')); return false; }
    L.params = next;
    this.sel.fit();
    if (result?.select) result.select(this.sel);
    this.selChanged();
    this.h.settle?.();
    return true;
  }

  // ---- commands ----
  command(name, ev = this.lastEv || { x: 0, y: 0 }) {
    if (this.op && !['prop-toggle'].includes(name)) this.op.confirm?.();
    this._selBefore = this.selSnapshot();   // what Adjust last starts again from
    const me = this.mesh;
    if (!me) return false;
    const S = this.sel;
    switch (name) {
      case 'mode-vert': this.setMode('vert'); return true;
      case 'mode-edge': this.setMode('edge'); return true;
      case 'mode-face': this.setMode('face'); return true;
      case 'select-all': if (S.empty()) S.all(); else S.all(); this.selChanged(); return true;
      case 'select-none': S.clear(); this.selChanged(); return true;
      case 'select-invert': S.invert(); this.selChanged(); return true;
      case 'select-linked': {
        if (ev && this.hover && !S.empty() === false) { /* nothing selected: what is under the pointer */ }
        if (S.empty() && ev) { const f = this.picker().at(this.h.cam, ev.x, ev.y, 'face'); if (f) S.linkedFrom(f.el, 'face', 'add'); }
        else S.linked();
        this.selChanged(); return true;
      }
      case 'select-more': S.grow(); this.selChanged(); return true;
      case 'select-less': S.shrink(); this.selChanged(); return true;
      case 'select-loop': case 'select-ring': {
        const es = S.edges();
        if (!es.length) { this.h.print(t('app.mesh.need.edges')); return false; }
        const all = new Set();
        for (const h of es) for (const x of name === 'select-loop' ? S.loopEdges(h) : S.ringEdges(h)) all.add(x);
        S.pickEdges([...all], 'set');
        this.selChanged(); return true;
      }
      case 'select-sharp': S.sharp(30); this.selChanged(); return true;
      case 'grab': case 'rotate': case 'scale': return this.startTransform(name, ev);
      case 'extrude': return this.startExtrude(ev, false);
      case 'extrude-individual': return this.startExtrude(ev, true);
      case 'inset': return this.startInset(ev);
      case 'bevel': return this.startBevel(ev, false);
      case 'crease': return this.startCrease(ev);
      case 'crease-clear': {
        if (!this.needSel('edges')) return false;
        const es = S.edges();
        this.edit(t('app.mesh.undo.crease'), (m) => O.setCrease(m, es, 0));
        this.h.print(t('app.mesh.creased', { n: es.length, v: 0 }));
        return true;
      }
      case 'bevel-verts': return this.startBevel(ev, true);
      case 'loopcut': this.op = new LoopCutOp(this); this.h.tip(this.hint); return true;
      case 'knife': this.op = new KnifeOp(this); this.h.tip(this.hint); return true;
      case 'bisect': this.op = new BisectOp(this); this.h.tip(this.hint); return true;
      case 'edge-slide': return this.startSlide(ev, false);
      case 'vertex-slide': return this.startSlide(ev, true);
      case 'spin': return this.startSpin(ev);
      case 'merge': {
        if (!this.needSel('verts')) return false;
        const vs = S.verts();
        if (vs.length < 2) { this.h.print(t('app.mesh.need.two')); return false; }
        this.edit(t('app.mesh.undo.merge'), (m) => O.mergeVerts(m, vs, 'center'), (keep) => { S.clear(); if (keep >= 0) S.pickVert(keep, 'set'); });
        this.h.print(t('app.mesh.merged', { n: vs.length }));
        return true;
      }
      case 'merge-distance': {
        const vs = S.empty() ? null : S.verts();
        const d = this.prop.mergeDist ?? 0.0001;
        let n = 0;
        this.edit(t('app.mesh.undo.merge_distance'), (m) => { n = O.mergeByDistance(m, d, vs); return n; });
        this.h.print(t('app.mesh.merged_distance', { n, d: formatLength(d, this.h.units) }));
        return true;
      }
      case 'dissolve': {
        if (!this.needSel()) return false;
        const mode = S.mode;
        this.edit(t('app.mesh.undo.dissolve'), (m) => (mode === 'face' ? O.dissolveFaces(m, S.faces()) : mode === 'edge' ? O.dissolveEdges(m, S.edges()) : O.dissolveVerts(m, S.verts())),
          (made) => { S.clear(); for (const f of made || []) S.f[f] = 1; S.flushFrom('face'); });
        return true;
      }
      case 'delete': {
        if (!this.needSel()) return false;
        const mode = S.mode, what = mode === 'face' ? { faces: S.faces() } : mode === 'edge' ? { edges: S.edges() } : { verts: S.verts() };
        this.edit(t('app.mesh.undo.delete'), (m) => O.deleteElems(m, what), () => S.clear());
        return true;
      }
      case 'fill': {
        if (!this.needSel()) return false;
        const what = { verts: S.verts(), edges: S.edges() };
        this.edit(t('app.mesh.undo.fill'), (m) => O.fill(m, what), (f) => { S.clear(); if (f >= 0) S.pickFace(f, 'set'); });
        return true;
      }
      case 'grid-fill': {
        if (!this.needSel()) return false;
        const what = { verts: S.verts(), edges: S.edges() };
        const params = { span: 0, offset: 0 };
        const r = this.edit(t('app.mesh.undo.grid_fill'), (m) => O.gridFill(m, what, params), (fs) => { S.clear(); for (const f of fs || []) S.f[f] = 1; S.flushFrom('face'); });
        if (r) this.remember('grid-fill', { ...params, what }, t('app.mesh.undo.grid_fill'));
        return true;
      }
      case 'bridge': {
        if (!this.needSel('edges')) return false;
        const es = S.edges().flatMap((h) => [h, me.hTw[h]]).filter((h) => h >= 0);
        this.edit(t('app.mesh.undo.bridge'), (m) => O.bridgeLoops(m, es), (fs) => { S.clear(); for (const f of fs || []) S.f[f] = 1; S.flushFrom('face'); });
        return true;
      }
      case 'subdivide': {
        if (!this.needSel('edges')) return false;
        const params = { cuts: 1, faces: S.faces(), edges: S.edges() };
        const r = this.edit(t('app.mesh.undo.subdivide'), (m) => O.subdivide(m, params, params.cuts), (res) => selectFaces(S, res?.faces, res?.verts));
        if (r) this.remember('subdivide', params, t('app.mesh.undo.subdivide'));
        return true;
      }
      case 'flip': {
        if (!this.needSel('faces')) return false;
        const fs = S.faces();
        this.edit(t('app.mesh.undo.flip'), (m) => O.flipFaces(m, fs), (made) => { S.clear(); for (const f of made || []) S.f[f] = 1; S.flushFrom('face'); });
        return true;
      }
      case 'smooth': {
        if (!this.needSel()) return false;
        const params = { factor: 0.5, repeat: 1, verts: S.verts() };
        const r = this.edit(t('app.mesh.undo.smooth'), (m) => O.smoothVerts(m, params.verts, params));
        if (r !== null) this.remember('smooth', params, t('app.mesh.undo.smooth'));
        return true;
      }
      case 'prop-toggle': this.prop.on = !this.prop.on; this.h.print(t(this.prop.on ? 'app.mesh.prop.on' : 'app.mesh.prop.off')); this.show(); return true;
      default: return false;
    }
  }

  // ---- modal moves: grab, rotate, scale ----
  startTransform(kind, ev) {
    if (!this.needSel()) return false;
    this.op = new TransformOp(this, kind, ev);
    this.h.tip(this.hint);
    this.h.vcb(this.op.label, '');
    return true;
  }
  startExtrude(ev, individual) {
    const S = this.sel;
    const faces = S.faces(), edges = S.edges().filter((h) => this.mesh.hTw[h] < 0);
    if (!faces.length && !edges.length) { this.h.print(t('app.mesh.need.extrude')); return false; }
    this.op = new ExtrudeOp(this, ev, { faces, edges, individual });
    this.h.tip(this.hint);
    return true;
  }
  startInset(ev) {
    if (!this.needSel('faces')) return false;
    this.op = new ValueOp(this, ev, {
      name: 'inset', label: t('app.mesh.vcb.thickness'), params: { thickness: 0.1, depth: 0, individual: false, faces: this.sel.faces() },
      fromPointer: (op, d) => ({ thickness: Math.max(0, d) }), lengthParam: 'thickness',
      run: (me, p) => O.insetFaces(me, p.faces, p), select: (S, r) => selectFaces(S, r?.faces),
      keys: { i: (p) => ({ individual: !p.individual }) },
    });
    this.h.tip(this.hint);
    return true;
  }
  startBevel(ev, vertsOnly) {
    const S = this.sel;
    if (vertsOnly ? !this.needSel('verts') : !this.needSel('edges')) return false;
    this.op = new ValueOp(this, ev, {
      name: vertsOnly ? 'bevel-verts' : 'bevel', label: t('app.mesh.vcb.width'),
      params: { width: 0.05, segments: 1, profile: 0.5, edges: vertsOnly ? [] : S.edges(), verts: vertsOnly ? S.verts() : [] },
      fromPointer: (op, d) => ({ width: Math.max(1e-6, d) }), lengthParam: 'width',
      run: (me, p) => O.bevel(me, p), select: (S2, r) => selectFaces(S2, r?.faces),
      wheel: (p, dir) => ({ segments: Math.max(1, Math.min(64, p.segments + dir)) }),
    });
    this.h.tip(this.hint);
    return true;
  }
  /** Crease (MD.4): the pointer's distance from the selection's centre sets 0…1 (about 200 px for 1); type a number. */
  startCrease(ev) {
    if (!this.needSel('edges')) return false;
    const es = this.sel.edges();
    this.op = new ValueOp(this, ev, {
      name: 'crease', label: t('app.mesh.vcb.crease'), pixels: true, plain: [0, 1],
      params: { crease: O.creaseOfEdges(this.mesh, es) ?? 0, edges: es },
      fromPointer: (op, px) => ({ crease: Math.max(0, Math.min(1, Math.round(px / 2) / 100)) }), lengthParam: 'crease',
      format: (p) => p.crease.toFixed(2),
      run: (me, p) => O.setCrease(me, p.edges, p.crease),
      wheel: (p, dir) => ({ crease: Math.max(0, Math.min(1, Math.round((p.crease + dir * 0.1) * 10) / 10)) }),
    });
    this.h.tip(this.hint);
    return true;
  }
  /** Set the selected edges' crease to v (the panel's field), one undo step. */
  setCrease(v) {
    const es = this.sel.edges();
    if (!es.length) return false;
    this.edit(t('app.mesh.undo.crease'), (m) => O.setCrease(m, es, v));
    return true;
  }
  startSlide(ev, vertex) {
    const S = this.sel, vs = S.verts();
    if (!vs.length) { this.h.print(t('app.mesh.need.verts')); return false; }
    this.op = new SlideOp(this, ev, vertex);
    this.h.tip(this.hint);
    return true;
  }
  startSpin(ev) {
    const faces = this.sel.faces(), edges = this.sel.edges().filter((h) => this.mesh.hTw[h] < 0);
    if (!faces.length && !edges.length) { this.h.print(t('app.mesh.need.extrude')); return false; }
    this.op = new SpinOp(this, ev, { faces, edges });
    this.h.tip(this.hint);
    return true;
  }
}

/** Select the faces made (and their corners), or the vertices made. */
function selectFaces(S, faces, verts) {
  S.clear();
  if (faces?.length) { for (const f of faces) S.f[f] = 1; S.flushFrom('face'); if (S.mode !== 'face') S.flushFrom('face'); return; }
  for (const v of verts || []) S.v[v] = 1;
  S.flushFrom('vert');
}
/** Re-running an operation for Adjust last: (mesh, params, tool) → {select(sel)}. */
const OPS_AGAIN = {
  inset: (me, p) => { const r = O.insetFaces(me, p.faces, p); return { select: (S) => selectFaces(S, r.faces) }; },
  bevel: (me, p) => { const r = O.bevel(me, p); return { select: (S) => selectFaces(S, r.faces) }; },
  crease: (me, p) => { O.setCrease(me, p.edges, p.crease); return {}; },
  'bevel-verts': (me, p) => { const r = O.bevel(me, p); return { select: (S) => selectFaces(S, r.faces) }; },
  subdivide: (me, p) => { const r = O.subdivide(me, p, p.cuts); return { select: (S) => selectFaces(S, r.faces, r.verts) }; },
  smooth: (me, p) => { O.smoothVerts(me, p.verts, p); return null; },
  'grid-fill': (me, p) => { const fs = O.gridFill(me, p.what, p); return { select: (S) => selectFaces(S, fs) }; },
  loopcut: (me, p) => { const r = O.loopCut(me, p.h, p); return { select: (S) => { S.clear(); S.pickEdges(r.edges, 'set'); } }; },
  spin: (me, p) => { O.spin(me, p); return null; },
};

// ---- modal operations: each begins a preview, shows frames, then commits (one undo step) or aborts ----
class TransformOp {
  constructor(tool, kind, ev) {
    this.tool = tool; this.kind = kind; this.h = tool.h;
    const me = tool.mesh, m = tool.world;
    this.inv = invert(m); this.m = m;
    this.verts = tool.sel.verts();
    const pr = tool.prop;
    this.weights = pr.on ? O.falloffWeights(me, this.verts, pr.radius, { mode: pr.falloff, connected: pr.connected }) : null;
    this.affected = this.weights ? [...this.weights.keys()].filter((v) => this.weights[v] > 0) : this.verts;
    this.base = new Map(this.affected.map((v) => [v, apply(m, [me.P[v * 3], me.P[v * 3 + 1], me.P[v * 3 + 2]])]));
    const c = tool.selCenter();
    this.pivot = apply(m, c);
    this.ev0 = ev; this.typed = null;
    this.label = t('app.mesh.vcb.' + kind);
    this.h.model.begin();
    this.move(ev);
  }
  hint() { return t('app.mesh.hint.' + this.kind); }
  axis() { return this.tool.T.lock?.dir || null; }
  matrixFor(ev) {
    const cam = this.h.cam, P = this.pivot, ax = this.axis();
    if (this.kind === 'grab') {
      let d;
      if (this.typed !== null) {
        const dir = ax || norm(sub(this.tool.onViewPlane(ev, P), this.tool.onViewPlane(this.ev0, P))) ;
        d = mul(len(dir) ? dir : [1, 0, 0], this.typed);
      } else if (ax) d = sub(this.tool.onLine(ev, P, ax), this.tool.onLine(this.ev0, P, ax));
      else d = sub(this.tool.onViewPlane(ev, P), this.tool.onViewPlane(this.ev0, P));
      this.shown = len(d);
      return (p) => add(p, d);
    }
    const s0 = cam.project(P);
    if (this.kind === 'rotate') {
      const a0 = Math.atan2(this.ev0.y - s0[1], this.ev0.x - s0[0]), a1 = Math.atan2(ev.y - s0[1], ev.x - s0[0]);
      const toward = norm(sub(cam.eye, P));
      let k = ax || toward;
      let ang = this.typed !== null ? this.typed * DEG : -(a1 - a0) * Math.sign(dot(k, toward) || 1);
      this.shown = ang / DEG;
      return (p) => rotateAbout(p, P, k, ang);
    }
    // scale
    const r0 = Math.hypot(this.ev0.x - s0[0], this.ev0.y - s0[1]) || 1, r1 = Math.hypot(ev.x - s0[0], ev.y - s0[1]);
    const f = this.typed !== null ? this.typed : r1 / r0;
    this.shown = f;
    return (p) => { const q = sub(p, P); if (ax) { const a = norm(ax), along = dot(q, a); return add(p, mul(a, along * (f - 1))); } return add(P, mul(q, f)); };
  }
  move(ev) {
    this.lastEv = ev;
    const T = this.matrixFor(ev), W = this.weights, inv = this.inv;
    this.h.model.meshPreview(this.tool.defId, (me) => {
      for (const [v, p] of this.base) {
        const q = T(p), w = W ? W[v] : 1, r = w === 1 ? q : add(p, mul(sub(q, p), w)), l = apply(inv, r);
        me.setPos(v, l[0], l[1], l[2]);
      }
      const near = this.tool.snapNear();   // MD.8: onto the retopology target
      if (near) projectVerts(me, this.verts, near);
    });
    this.tool.show();
    this.h.changed?.();
    const shown = this.kind === 'grab' ? formatLength(this.shown || 0, this.h.units) : this.kind === 'rotate' ? (Math.round((this.shown || 0) * 10) / 10) + '°' : (Math.round((this.shown || 1) * 1000) / 1000).toString();
    this.h.vcb(this.label, shown);
    this.h.tip(this.hint());
  }
  up() { this.confirm(); }
  key(k) {
    if (k === 'Enter') { this.confirm(); return true; }
    return false;
  }
  value(v) {
    const x = this.kind === 'grab' ? (v.kind === 'len' ? v.v : null) : (v.kind === 'num' ? v.v : v.kind === 'len' ? v.num : null);
    if (x === null || !Number.isFinite(x)) { this.h.print(t('app.mesh.type.' + this.kind)); return true; }
    this.typed = x;
    this.move(this.lastEv || this.ev0);
    this.confirm();
    return true;
  }
  confirm() {
    this.h.model.commit(t('app.mesh.undo.' + this.kind));
    this.end();
  }
  cancel() { this.h.model.abort(); this.end(); }
  end() { this.tool.op = null; this.tool.T.lock = null; this.tool.pk = null; this.tool.show(); this.h.settle?.(); this.h.vcb(this.tool.vcbLabel, ''); this.h.tip(this.tool.hint); this.h.changed?.(); }
}
const rotateAbout = (p, c, k, a) => {
  const q = sub(p, c), n = norm(k), co = Math.cos(a), si = Math.sin(a);
  return add(c, add(add(mul(q, co), mul(cross(n, q), si)), mul(n, dot(n, q) * (1 - co))));
};

/** Extrude, then move the new part along its normal (region) or each face along its own (individual). */
class ExtrudeOp {
  constructor(tool, ev, { faces, edges, individual }) {
    this.tool = tool; this.h = tool.h; this.faces = faces; this.edges = edges; this.individual = individual;
    const me = tool.mesh, m = tool.world;
    this.m = m; this.inv = invert(m);
    // the direction: the faces' average normal (world), or for edges the faces they border, turned out
    let n = [0, 0, 0];
    const tmp = [0, 0, 0];
    for (const f of faces) { me.faceNormalRaw(f, tmp); n = add(n, tmp); }
    if (!faces.length) for (const h of edges) { me.faceNormalRaw(me.hF[h], tmp); n = add(n, tmp); }
    this.dir = norm(applyDir(m, n)); if (!len(this.dir)) this.dir = [0, 0, 1];
    this.pivot = apply(m, tool.selCenter());
    this.ev0 = ev; this.d = 0; this.typed = null;
    this.label = t('app.mesh.vcb.distance');
    this.h.model.begin();
    this.move(ev);
  }
  hint() { return t('app.mesh.hint.extrude'); }
  move(ev) {
    this.lastEv = ev;
    const d = this.typed !== null ? this.typed : dot(sub(this.tool.onLine(ev, this.pivot, this.dir), this.tool.onLine(this.ev0, this.pivot, this.dir)), this.dir);
    this.d = d;
    const dirL = applyDir(this.inv, this.dir);
    this.result = this.h.model.meshPreview(this.tool.defId, (me) => {
      if (this.faces.length) {
        const r = this.individual ? O.extrudeIndividual(me, this.faces) : O.extrudeRegion(me, this.faces);
        for (const v of r.verts) {
          const dl = this.individual ? mul(r.dirs.get(v), d * len(dirL)) : mul(dirL, d);
          me.setPos(v, me.P[v * 3] + dl[0], me.P[v * 3 + 1] + dl[1], me.P[v * 3 + 2] + dl[2]);
        }
        return r;
      }
      const r = O.extrudeEdges(me, this.edges);
      for (const v of r.verts) { const dl = mul(dirL, d); me.setPos(v, me.P[v * 3] + dl[0], me.P[v * 3 + 1] + dl[1], me.P[v * 3 + 2] + dl[2]); }
      const near = this.tool.snapNear();   // MD.8: onto the retopology target
      if (near) projectVerts(me, r.verts, near);
      return r;
    });
    this.tool.sel.fit();
    this.tool.show(); this.h.changed?.();
    this.h.vcb(this.label, formatLength(Math.abs(d), this.h.units));
  }
  up() { this.confirm(); }
  key(k) { if (k === 'Enter') { this.confirm(); return true; } return false; }
  value(v) { if (v.kind !== 'len') { this.h.print(t('app.mesh.type.grab')); return true; } this.typed = v.v; this.move(this.lastEv || this.ev0); this.confirm(); return true; }
  confirm() {
    const r = this.result;
    this.h.model.commit(t('app.mesh.undo.extrude'));
    const S = this.tool.sel;
    S.fit();
    if (r?.faces?.length) selectFaces(S, r.faces); else if (r?.verts) selectFaces(S, null, r.verts);
    this.end();
  }
  cancel() { this.h.model.abort(); this.end(); }
  end() { this.tool.op = null; this.tool.pk = null; this.tool.selChanged(); this.h.settle?.(); this.h.vcb(this.tool.vcbLabel, ''); this.h.tip(this.tool.hint); }
}

/** An operation set by one length from the pointer (its distance from the selection's centre on screen): inset, bevel. */
class ValueOp {
  constructor(tool, ev, spec) {
    this.tool = tool; this.h = tool.h; this.spec = spec; this.params = { ...spec.params };
    this.label = spec.label;
    this.pivot = apply(tool.world, tool.selCenter());
    const s0 = this.h.cam.project(this.pivot);
    this.r0 = s0 ? Math.hypot(ev.x - s0[0], ev.y - s0[1]) : 0;
    this.ev0 = ev;
    this.h.model.begin();
    this.move(ev);
  }
  hint() { return t('app.mesh.hint.' + this.spec.name, { segments: this.params.segments ?? 1 }); }
  move(ev) {
    this.lastEv = ev;
    if (this.typedLen === undefined) {
      const s0 = this.h.cam.project(this.pivot), r = s0 ? Math.hypot(ev.x - s0[0], ev.y - s0[1]) : 0;
      const d = Math.max(0, r - this.r0) * (this.spec.pixels ? 1 : this.h.cam.pixelSize(this.pivot));
      Object.assign(this.params, this.spec.fromPointer(this, d));
    }
    this.frame();
  }
  frame() {
    let res = null;
    this.result = this.h.model.meshPreview(this.tool.defId, (me) => { res = this.spec.run(me, this.params); return res; });
    this.tool.sel.fit();
    this.tool.show(); this.h.changed?.();
    this.h.vcb(this.label, this.spec.format ? this.spec.format(this.params) : formatLength(this.params[this.spec.lengthParam] || 0, this.h.units));
    this.h.tip(this.hint());
  }
  wheel(dir) { if (!this.spec.wheel) return false; Object.assign(this.params, this.spec.wheel(this.params, dir)); this.frame(); return true; }
  up() { this.confirm(); }
  key(k) {
    if (k === 'Enter') { this.confirm(); return true; }
    const f = this.spec.keys?.[String(k).toLowerCase()];
    if (f) { Object.assign(this.params, f(this.params)); this.frame(); return true; }
    if (this.spec.wheel && (k === 'PageUp' || k === '+' || k === '=')) return this.wheel(1);
    if (this.spec.wheel && (k === 'PageDown' || k === '-')) return this.wheel(-1);
    return false;
  }
  value(v) {
    if (this.spec.plain) {
      // a plain number in a range (crease 0…1)
      const x = v.kind === 'num' ? v.v : v.num;
      const [lo, hi] = this.spec.plain;
      if (!Number.isFinite(x) || x < lo || x > hi) { this.h.print(t('app.mesh.adjust.range', { min: lo, max: hi })); return true; }
      this.typedLen = x; this.params[this.spec.lengthParam] = x;
      this.frame(); this.confirm();
      return true;
    }
    if (v.kind !== 'len') { this.h.print(t('app.mesh.type.grab')); return true; }
    this.typedLen = v.v;
    this.params[this.spec.lengthParam] = Math.max(0, v.v);
    this.frame();
    this.confirm();
    return true;
  }
  confirm() {
    const r = this.result;
    this.h.model.commit(t('app.mesh.undo.' + this.spec.name.replace('-', '_')));
    this.tool.sel.fit();
    this.spec.select?.(this.tool.sel, r);
    this.tool.remember(this.spec.name, this.params, t('app.mesh.undo.' + this.spec.name.replace('-', '_')));
    this.end();
  }
  cancel() { this.h.model.abort(); this.end(); }
  end() { this.tool.op = null; this.tool.pk = null; this.tool.selChanged(); this.h.settle?.(); this.h.vcb(this.tool.vcbLabel, ''); this.h.tip(this.tool.hint); }
}

/** Slide: an edge loop's vertices along their rails (the edges leaving the loop), or one vertex toward a neighbour. */
class SlideOp {
  constructor(tool, ev, vertex) {
    this.tool = tool; this.h = tool.h; this.vertex = vertex;
    const me = tool.mesh;
    this.verts = tool.sel.verts();
    this.rails = vertex && this.verts.length === 1 ? null : O.slideRails(me, this.verts);
    this.base = new Float64Array(me.P.subarray(0, me.nv * 3));
    this.ev0 = ev; this.t = 0;
    this.label = t('app.mesh.vcb.factor');
    this.h.model.begin();
    this.move(ev);
  }
  hint() { return t('app.mesh.hint.slide'); }
  move(ev) {
    this.lastEv = ev;
    const me = this.tool.mesh, m = this.tool.world, cam = this.h.cam;
    let rails = this.rails;
    if (!rails) {
      // one vertex: toward the neighbour whose direction on screen is nearest the pointer's
      const v = this.verts[0], s0 = cam.project(apply(m, [this.base[v * 3], this.base[v * 3 + 1], this.base[v * 3 + 2]]));
      let best = null;
      for (const h of me.outgoing(v)) {
        const w = me.head(h), s = cam.project(apply(m, [me.P[w * 3], me.P[w * 3 + 1], me.P[w * 3 + 2]]));
        if (!s || !s0) continue;
        const a = [s[0] - s0[0], s[1] - s0[1]], b = [ev.x - s0[0], ev.y - s0[1]], la = Math.hypot(...a) || 1;
        const along = (a[0] * b[0] + a[1] * b[1]) / la;
        if (!best || along > best.along) best = { w, along, la };
      }
      if (best) { this.t = Math.max(0, Math.min(1, best.along / best.la)); rails = new Map([[v, { a: best.w, b: -1 }]]); }
      else rails = new Map();
    } else {
      // the loop: how far along the average rail (on screen) the pointer has moved
      let ax = 0, ay = 0, L = 0, n = 0;
      for (const [v, r] of rails) {
        const s0 = cam.project(apply(m, [this.base[v * 3], this.base[v * 3 + 1], this.base[v * 3 + 2]])), s1 = cam.project(apply(m, [this.base[r.a * 3], this.base[r.a * 3 + 1], this.base[r.a * 3 + 2]]));
        if (!s0 || !s1) continue;
        ax += s1[0] - s0[0]; ay += s1[1] - s0[1]; L += Math.hypot(s1[0] - s0[0], s1[1] - s0[1]); n++;
      }
      const l = Math.hypot(ax, ay) || 1, avg = n ? L / n : 1;
      this.t = Math.max(-1, Math.min(1, ((ev.x - this.ev0.x) * ax + (ev.y - this.ev0.y) * ay) / l / (avg || 1)));
    }
    if (this.typed !== undefined) this.t = this.typed;
    this.h.model.meshPreview(this.tool.defId, (mm) => O.applySlide(mm, rails, this.t, this.base));
    this.tool.show(); this.h.changed?.();
    this.h.vcb(this.label, (Math.round(this.t * 1000) / 1000).toString());
  }
  up() { this.confirm(); }
  key(k) { if (k === 'Enter') { this.confirm(); return true; } return false; }
  value(v) { const x = v.kind === 'num' ? v.v : v.kind === 'len' ? v.num : null; if (x === null) return true; this.typed = Math.max(-1, Math.min(1, x)); this.move(this.lastEv || this.ev0); this.confirm(); return true; }
  confirm() { this.h.model.commit(t('app.mesh.undo.slide')); this.end(); }
  cancel() { this.h.model.abort(); this.end(); }
  end() { this.tool.op = null; this.tool.pk = null; this.tool.show(); this.h.settle?.(); this.h.vcb(this.tool.vcbLabel, ''); this.h.tip(this.tool.hint); }
}

/** Loop cut: the ring under the pointer shows as a preview; the wheel or a typed number sets how many cuts; a click cuts. */
class LoopCutOp {
  constructor(tool) { this.tool = tool; this.h = tool.h; this.cuts = 1; this.edge = null; this.label = t('app.mesh.vcb.cuts'); }
  hint() { return t('app.mesh.hint.loopcut', { n: this.cuts }); }
  move(ev) {
    this.lastEv = ev;
    const hit = this.tool.picker().at(this.h.cam, ev.x, ev.y, 'edge', { radius: 16 });
    this.edge = hit ? hit.el : null;
    this.preview();
  }
  preview() {
    const me = this.tool.mesh, m = this.tool.world;
    if (this.edge === null) { this.h.overlay(null); return; }
    const ring = O.ringFrom(me, this.edge), lines = [];
    // the cut lines: across each quad of the ring, from each cut point on one ring edge to the same one on the next
    for (const f of ring.faces) {
      const cs = me.faceCorners(f, []), es = cs.filter((h) => ring.edges.includes(me.edgeOf(h)));
      if (es.length < 2) continue;
      const [e1, e2] = es;
      for (let k = 1; k <= this.cuts; k++) {
        const s = k / (this.cuts + 1);
        const p = (h, u) => apply(m, add(mul([me.P[me.hV[h] * 3], me.P[me.hV[h] * 3 + 1], me.P[me.hV[h] * 3 + 2]], 1 - u), mul([me.P[me.head(h) * 3], me.P[me.head(h) * 3 + 1], me.P[me.head(h) * 3 + 2]], u)));
        lines.push({ a: p(e1, s), b: p(e2, 1 - s), kind: 'axis', dash: false });
      }
    }
    this.h.overlay({ lines, tip: t('app.mesh.hint.loopcut', { n: this.cuts }) });
    this.h.vcb(this.label, String(this.cuts));
  }
  wheel(dir) { this.cuts = Math.max(1, Math.min(100, this.cuts + dir)); this.preview(); this.h.tip(this.hint()); return true; }
  key(k) { if (k === 'PageUp' || k === '+' || k === '=') return this.wheel(1); if (k === 'PageDown' || k === '-') return this.wheel(-1); if (k === 'Enter') { this.confirm(); return true; } return false; }
  value(v) { const n = v.kind === 'num' ? v.v : v.kind === 'len' ? v.num : v.kind === 'sides' ? v.n : null; if (!Number.isInteger(n) || n < 1) return true; this.cuts = Math.min(100, n); this.preview(); return true; }
  up() { this.confirm(); }
  confirm() {
    if (this.edge === null) { this.h.print(t('app.mesh.need.ring')); return; }
    const tool = this.tool, params = { h: this.edge, cuts: this.cuts, slide: 0 };
    this.h.overlay(null);
    tool.op = null;
    const r = tool.edit(t('app.mesh.undo.loopcut'), (me) => O.loopCut(me, params.h, params), (res) => { tool.sel.clear(); if (res) { tool.sel.mode = tool.sel.mode === 'face' ? 'edge' : tool.sel.mode; tool.sel.pickEdges(res.edges, 'set'); } });
    if (r) tool.remember('loopcut', params, t('app.mesh.undo.loopcut'));
    this.h.tip(tool.hint);
  }
  cancel() { this.h.overlay(null); this.tool.op = null; this.h.tip(this.tool.hint); }
}

/** Knife: click points on edges or vertices; Enter cuts between them (straight across the faces, as seen); Backspace drops the last. */
class KnifeOp {
  constructor(tool) { this.tool = tool; this.h = tool.h; this.pts = []; this.label = ''; }
  hint() { return t('app.mesh.hint.knife', { n: this.pts.length }); }
  snapAt(ev) {
    const pk = this.tool.picker(), cam = this.h.cam, me = this.tool.mesh;
    const v = pk.at(cam, ev.x, ev.y, 'vert', { radius: 10 });
    if (v) return { v: v.el, w: v.p };
    const e = pk.at(cam, ev.x, ev.y, 'edge', { radius: 12 });
    if (!e) return null;
    // where along the edge: the point of it nearest the pointer's ray
    const m = this.tool.world, a = apply(m, [me.P[me.hV[e.el] * 3], me.P[me.hV[e.el] * 3 + 1], me.P[me.hV[e.el] * 3 + 2]]), b = apply(m, [me.P[me.head(e.el) * 3], me.P[me.head(e.el) * 3 + 1], me.P[me.head(e.el) * 3 + 2]]);
    const q = this.tool.onLine(ev, a, sub(b, a)), L = len(sub(b, a)) || 1, s = Math.max(0, Math.min(1, dot(sub(q, a), sub(b, a)) / (L * L)));
    return { h: e.el, s, w: add(a, mul(sub(b, a), s)) };
  }
  move(ev) {
    this.lastEv = ev;
    const p = this.snapAt(ev), lines = [];
    for (let i = 0; i + 1 < this.pts.length; i++) lines.push({ a: this.pts[i].w, b: this.pts[i + 1].w, kind: 'axis' });
    if (this.pts.length && p) lines.push({ a: this.pts[this.pts.length - 1].w, b: p.w, kind: 'axis', dash: true });
    this.h.overlay({ lines, points: [...this.pts.map((q) => q.w), ...(p ? [p.w] : [])], tip: p ? null : t('app.mesh.knife.off') });
  }
  up(ev) { const p = this.snapAt(ev); if (p) { this.pts.push(p); this.move(ev); this.h.tip(this.hint()); } }
  key(k) {
    if (k === 'Enter' || k === ' ') { this.confirm(); return true; }
    if (k === 'Backspace') { this.pts.pop(); if (this.lastEv) this.move(this.lastEv); return true; }
    return false;
  }
  confirm() {
    const tool = this.tool, pts = this.pts.map((q) => (q.v !== undefined ? { v: q.v } : { h: q.h, s: q.s })), eye = apply(invert(tool.world), this.h.cam.eye);
    this.h.overlay(null); tool.op = null;
    if (pts.length < 2) { this.h.tip(tool.hint); return; }
    tool.edit(t('app.mesh.undo.knife'), (me) => O.knife(me, pts, eye), (r) => { if (r) { tool.sel.clear(); tool.sel.pickEdges(r.edges, 'set'); } });
    this.h.tip(tool.hint);
  }
  cancel() { this.h.overlay(null); this.tool.op = null; this.h.tip(this.tool.hint); }
}

/** Bisect: click two points on screen; the plane through them (as seen) cuts the selected faces (or every face). */
class BisectOp {
  constructor(tool) { this.tool = tool; this.h = tool.h; this.a = null; }
  hint() { return t(this.a ? 'app.mesh.hint.bisect2' : 'app.mesh.hint.bisect1'); }
  move(ev) {
    this.lastEv = ev;
    if (!this.a) return;
    const P = this.tool.selCenter() ? apply(this.tool.world, this.tool.selCenter()) : this.h.cam.target;
    this.h.overlay({ lines: [{ a: this.tool.onViewPlane(this.a, P), b: this.tool.onViewPlane(ev, P), kind: 'axis', dash: true }] });
  }
  up(ev) { if (!this.a) { this.a = { x: ev.x, y: ev.y }; this.h.tip(this.hint()); return; } this.confirm(ev); }
  key(k) { return false; }
  confirm(ev = this.lastEv) {
    const tool = this.tool, cam = this.h.cam, me = tool.mesh;
    if (!this.a || !ev) return;
    const r1 = cam.ray(this.a.x, this.a.y), r2 = cam.ray(ev.x, ev.y);
    const P = tool.selCenter() ? apply(tool.world, tool.selCenter()) : cam.target;
    const p1 = tool.onViewPlane(this.a, P), p2 = tool.onViewPlane(ev, P);
    const n = norm(cross(sub(p2, p1), r1.d));
    void r2;
    const inv = invert(tool.world), plane = { p: apply(inv, p1), n: norm(applyDir(inv, n)) };
    const faces = tool.sel.faces().length ? tool.sel.faces() : Array.from({ length: me.nf }, (_, i) => i).filter((f) => !me.faceDead(f));
    this.h.overlay(null); tool.op = null;
    tool.edit(t('app.mesh.undo.bisect'), (m) => O.bisect(m, faces, plane), (r) => { if (r) { tool.sel.clear(); tool.sel.pickEdges(r.edges, 'set'); } });
    this.h.tip(tool.hint);
  }
  cancel() { this.h.overlay(null); this.tool.op = null; this.h.tip(this.tool.hint); }
}

/** Spin: round the blue axis (or the locked one) through the selection's centre; the pointer turns it, the wheel sets the steps. */
class SpinOp {
  constructor(tool, ev, { faces, edges }) {
    this.tool = tool; this.h = tool.h; this.faces = faces; this.edges = edges;
    this.steps = 12; this.ev0 = ev; this.ang = 0;
    const m = tool.world;
    this.center = apply(m, tool.selCenter());
    this.label = t('app.mesh.vcb.rotate');
    this.h.model.begin();
    this.move(ev);
  }
  hint() { return t('app.mesh.hint.spin', { n: this.steps }); }
  move(ev) {
    this.lastEv = ev;
    const cam = this.h.cam, s0 = cam.project(this.center);
    if (this.typed === undefined && s0) {
      const a0 = Math.atan2(this.ev0.y - s0[1], this.ev0.x - s0[0]), a1 = Math.atan2(ev.y - s0[1], ev.x - s0[0]);
      this.ang = -(a1 - a0);
    } else if (this.typed !== undefined) this.ang = this.typed * DEG;
    this.frame();
  }
  frame() {
    const inv = invert(this.tool.world), axisW = this.tool.T.lock?.dir || [0, 0, 1];
    const p = { faces: this.faces, edges: this.edges, center: apply(inv, this.center), axis: norm(applyDir(inv, axisW)), angle: this.ang || 1e-6, steps: this.steps };
    this.params = p;
    this.h.model.meshPreview(this.tool.defId, (me) => O.spin(me, p));
    this.tool.sel.fit(); this.tool.show(); this.h.changed?.();
    this.h.vcb(this.label, (Math.round((this.ang / DEG) * 10) / 10) + '°');
    this.h.tip(this.hint());
  }
  wheel(dir) { this.steps = Math.max(1, Math.min(512, this.steps + dir)); this.frame(); return true; }
  key(k) { if (k === 'PageUp' || k === '+' || k === '=') return this.wheel(1); if (k === 'PageDown' || k === '-') return this.wheel(-1); if (k === 'Enter') { this.confirm(); return true; } return false; }
  value(v) { const x = v.kind === 'num' ? v.v : v.kind === 'len' ? v.num : null; if (x === null) { this.h.print(t('app.mesh.type.rotate')); return true; } this.typed = x; this.move(this.lastEv || this.ev0); this.confirm(); return true; }
  up() { this.confirm(); }
  confirm() { this.h.model.commit(t('app.mesh.undo.spin')); this.tool.remember('spin', this.params, t('app.mesh.undo.spin')); this.end(); }
  cancel() { this.h.model.abort(); this.end(); }
  end() { this.tool.op = null; this.tool.pk = null; this.tool.sel.fit(); this.tool.selChanged(); this.h.settle?.(); this.h.vcb(this.tool.vcbLabel, ''); this.h.tip(this.tool.hint); }
}

registerTool('meshedit', MeshEditTool);
