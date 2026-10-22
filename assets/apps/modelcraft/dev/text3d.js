/* SPDX-License-Identifier: Apache-2.0 */
/**
 * text3d.js — 3D text (0.4 M11): letters as faces, flat or pushed up to a depth, made into a component the app places.
 * DOM-free: bin/test-modelcraft.mjs runs it. The letters are our single-stroke font (strokefont.js, M1) given a pen
 * width: every stroke segment becomes a thin quad and every joint a small disc, and manifold-3d's 2D CrossSection
 * unions them into outlines with holes (an "o" keeps its hole); depth > 0 extrudes them (manifold, as solids.js does).
 *
 *   textOutlines(M, text, {height, weight}) → manifold CrossSection in text coordinates (x along the text from the
 *        left of the first line's baseline, y up; lines below each other). height = capital height; weight = pen
 *        width as a share of it (0.14). The caller deletes it.
 *   textDef(M, model, text, {height, depth, weight, name}) → a new component definition: faces facing +z (flat) or a
 *        closed solid from z = 0 to depth, flat sides as single faces. Call it inside model.change.
 */
import { textStrokes } from './strokefont.js';
import { meshDef, mergeCoplanar } from './model.js';

export function textOutlines(M, text, { height = 1, weight = 0.14 } = {}) {
  const r = (height * weight) / 2, polys = [];
  const disc = (c) => Array.from({ length: 12 }, (_, i) => [c[0] + r * Math.cos((i * Math.PI) / 6), c[1] + r * Math.sin((i * Math.PI) / 6)]);
  String(text).split(/\r?\n/).slice(0, 50).forEach((line, k) => {
    const dy = -k * height * 1.6;
    for (const pl of textStrokes(line, { h: height }).lines) {
      const P = pl.map(([x, y]) => [x, y + dy]);
      for (const p of P) polys.push(disc(p));
      for (let i = 0; i + 1 < P.length; i++) {
        const [a, b] = [P[i], P[i + 1]], dx = b[0] - a[0], dyy = b[1] - a[1], L = Math.hypot(dx, dyy);
        if (L < 1e-12) continue;
        const nx = (-dyy / L) * r, ny = (dx / L) * r;
        // counter-clockwise, so the Positive fill rule unions everything
        polys.push([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]);
      }
    }
  });
  const cs = new M.CrossSection(polys, 'Positive');
  const clean = cs.simplify(height * 1e-4);
  cs.delete?.();
  return clean;
}

export function textDef(M, model, text, { height = 1, depth = 0, weight = 0.14, name = '' } = {}) {
  const cs = textOutlines(M, text, { height, weight });
  const made = [cs];
  const g6 = (v) => Math.round(v * 1e6) / 1e6;   // back from manifold's 32-bit floats, on a 1 µm grid
  try {
    const polys = [];
    if (depth > 0) {
      const man = M.Manifold.extrude(cs, depth);
      made.push(man);
      const g = man.getMesh();
      const P = (i) => [g6(g.vertProperties[i * g.numProp]), g6(g.vertProperties[i * g.numProp + 1]), g6(g.vertProperties[i * g.numProp + 2])];
      for (let i = 0; i < g.triVerts.length; i += 3) polys.push([P(g.triVerts[i]), P(g.triVerts[i + 1]), P(g.triVerts[i + 2])]);
    } else {
      // one face per letter piece, with its holes
      for (const piece of cs.decompose()) {
        made.push(piece);
        const loops = piece.toPolygons().map((l) => l.map(([x, y]) => [g6(x), g6(y), 0]));
        if (loops.length) polys.push({ loops });
      }
    }
    const d = meshDef(model, polys, model.uniqueName(name || String(text).split(/\r?\n/)[0].slice(0, 40) || 'Text'), 'component');   // i18n-ignore: a fallback name
    if (depth > 0) mergeCoplanar(d, [...d.edges].filter(([, e]) => e.soft).map(([id]) => id));
    return d;
  } finally {
    for (const m of made) m.delete?.();
  }
}
