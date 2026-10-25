/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/graph.js — the graph editor's sums (0.7 AN.1, session `anim`): where a curve, a key and its handles are on the canvas,
 * what a click hits, the axes' ticks, framing. DOM-free (the canvas drawing is anim/curves-ui.js), so Node tests run it.
 *
 *   view = {t0, t1, v0, v1, w, h, pad}       seconds left → right, values bottom → top, canvas size in CSS pixels
 *   toPx(view, t, v) → [x, y] · fromPx(view, x, y) → [t, v] · frame(anim, chans, {t0?, t1?, w, h}) → view
 *   zoom(view, x, y, f, axis 'both' | 't' | 'v') → view · pan(view, dx, dy) → view
 *   points(anim, chans) → [{track, comp, i, t, v, l: [t, v], r: [t, v]}]   every key of the shown curves, handles absolute
 *   hit(view, pts, x, y, {r, handles}) → {kind: 'key' | 'l' | 'r', p} | null · inBox(view, pts, box) → [p]
 *   ticks(lo, hi, n) → [values]   about n round numbers between lo and hi
 *   dragKey(anim, p, t, v) → anim · dragHandle(anim, p, side, t, v) → anim   (what a drag on the canvas does)
 */
import { handlePoints, moveKey, setPropKey, setHandle } from '../render/anim.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
const trackOf = (anim, track) => anim.props && anim.props[+String(track).slice(1)];

export function toPx(view, t, v) {
  const p = view.pad ?? 12;
  return [p + ((t - view.t0) / (view.t1 - view.t0)) * (view.w - 2 * p), view.h - p - ((v - view.v0) / (view.v1 - view.v0)) * (view.h - 2 * p)];
}
export function fromPx(view, x, y) {
  const p = view.pad ?? 12;
  return [view.t0 + ((x - p) / (view.w - 2 * p)) * (view.t1 - view.t0), view.v0 + ((view.h - p - y) / (view.h - 2 * p)) * (view.v1 - view.v0)];
}

/** Every key of the shown curves: chans = [{track: 'p<i>', comp}]. */
export function points(anim, chans) {
  const out = [];
  for (const c of chans) {
    const tr = trackOf(anim, c.track);
    if (!tr || c.comp >= tr.keys[0].v.length) continue;
    tr.keys.forEach((k, i) => {
      const h = handlePoints(tr, i);
      out.push({ track: c.track, comp: c.comp, i, t: k.t, v: k.v[c.comp], ease: k.ease, hm: k.hm || 'auto', l: [h.l[0], h.l[1][c.comp]], r: [h.r[0], h.r[1][c.comp]], first: i === 0, last: i === tr.keys.length - 1 });
    });
  }
  return out;
}

/** A view that shows the curves whole (a little margin round them); a flat curve gets a value range of its own size. */
export function frame(anim, chans, { t0, t1, w, h, pad = 12 } = {}) {
  const pts = points(anim, chans);
  let lo = Infinity, hi = -Infinity, a = Infinity, b = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p.v, p.l[1], p.r[1]); hi = Math.max(hi, p.v, p.l[1], p.r[1]); a = Math.min(a, p.t); b = Math.max(b, p.t); }
  if (!pts.length) { lo = 0; hi = 1; a = 0; b = anim.length; }
  if (hi - lo < 1e-9) { const m = Math.max(Math.abs(lo) * 0.1, 1); lo -= m; hi += m; }
  if (b - a < 1e-6) { a = 0; b = Math.max(anim.length, a + 1); }
  const mv = (hi - lo) * 0.08, mt = (b - a) * 0.04;
  return { t0: t0 ?? a - mt, t1: t1 ?? b + mt, v0: lo - mv, v1: hi + mv, w: Math.max(40, w || 400), h: Math.max(40, h || 200), pad };
}
export function zoom(view, x, y, f, axis = 'both') {
  const [t, v] = fromPx(view, x, y), o = { ...view };
  if (axis !== 'v') { o.t0 = t + (view.t0 - t) * f; o.t1 = t + (view.t1 - t) * f; }
  if (axis !== 't') { o.v0 = v + (view.v0 - v) * f; o.v1 = v + (view.v1 - v) * f; }
  if (o.t1 - o.t0 < 1e-3 || o.v1 - o.v0 < 1e-9 || o.t1 - o.t0 > 1e5 || o.v1 - o.v0 > 1e12) return view;
  return o;
}
export function pan(view, dx, dy) {
  const p = view.pad ?? 12;
  const st = (view.t1 - view.t0) / (view.w - 2 * p), sv = (view.v1 - view.v0) / (view.h - 2 * p);
  return { ...view, t0: view.t0 - dx * st, t1: view.t1 - dx * st, v0: view.v0 + dy * sv, v1: view.v1 + dy * sv };
}

/** What a click at (x, y) hits: a handle of a chosen key first (when `handles` lists them), then a key. */
export function hit(view, pts, x, y, { r = 7, handles = [] } = {}) {
  let best = null, bd = r * r;
  const near = (px, kind, p) => { const d = (px[0] - x) ** 2 + (px[1] - y) ** 2; if (d <= bd) { bd = d; best = { kind, p }; } };
  for (const p of handles) {
    if (p.ease === 'bezier' || (p.i > 0 && pts.find((q) => q.track === p.track && q.comp === p.comp && q.i === p.i - 1)?.ease === 'bezier')) {
      if (!p.first) near(toPx(view, p.l[0], p.l[1]), 'l', p);
      if (!p.last) near(toPx(view, p.r[0], p.r[1]), 'r', p);
    }
  }
  if (best) return best;
  for (const p of pts) near(toPx(view, p.t, p.v), 'key', p);
  return best;
}
/** The keys inside a dragged box {x0, y0, x1, y1} (canvas pixels). */
export function inBox(view, pts, box) {
  const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
  return pts.filter((p) => { const [x, y] = toPx(view, p.t, p.v); return x >= x0 && x <= x1 && y >= y0 && y <= y1; });
}
/** About n round numbers (1, 2, 5 × a power of ten apart) from lo to hi. */
export function ticks(lo, hi, n = 6) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, n), p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return out;
}

/** A key dragged to (t, v): its time moves (onto another key's time it replaces it) and that number of its value changes. */
export function dragKey(anim, p, t, v) {
  const tr = trackOf(anim, p.track);
  if (!tr) return anim;
  const k = tr.keys[p.i];
  if (!k) return anim;
  const to = Math.max(0, r3(t));
  let a = Math.abs(to - k.t) > 1e-9 ? moveKey(anim, p.track, k.t, to) : anim;
  const tr2 = trackOf(a, p.track), k2 = tr2 && tr2.keys.find((x) => x.t === to);
  if (!k2) return a;
  const val = k2.v.slice();
  val[p.comp] = v;
  return setPropKey(a, tr2.target, tr2.prop, to, val, k2.ease);
}
/** A handle dragged to (t, v): the other numbers of its key keep their handle values. */
export function dragHandle(anim, p, side, t, v) {
  const tr = trackOf(anim, p.track), k = tr && tr.keys[p.i];
  if (!k) return anim;
  const h = handlePoints(tr, p.i)[side];
  let dt = t - k.t;
  if (side === 'l') dt = Math.min(0, dt); else dt = Math.max(0, dt);
  const dv = h[1].map((x, j) => x - k.v[j]);
  dv[p.comp] = v - k.v[p.comp];
  return setHandle(anim, p.track, k.t, side, [dt, ...dv]);
}
