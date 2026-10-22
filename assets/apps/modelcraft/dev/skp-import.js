/* SPDX-License-Identifier: Apache-2.0 */
/**
 * skp-import.js — a SketchUp model read by cc-skp (./skp/read.js, docs/SKP-LIB-SPEC.md) → ModelCraft definitions.
 * Kept out of io.js on purpose: io.js is part of the m3d kernel other apps copy; SketchUp files are ModelCraft's alone.
 * No DOM, no three.js: Node tests run it as is.
 *
 *   importSKP(model, skp, name) → {def, report}   a new group that is NOT placed yet (the caller places it inside
 *                                                  model.change(), like io.js's importers)
 *
 * SketchUp is Z up, in inches: points × 0.0254 → meters, placements keep their turn and scale, their move × 0.0254.
 * Components stay components (one definition, many placements), groups stay groups. A material painted on a placement
 * becomes that placement's paint (`inst.color`, 0.4 M8), which is SketchUp's "default" material: faces with no colour
 * of their own take it, so a component painted two colours stays one component. A textured material on a FACE comes in
 * with its texture (0.5 RC.11 (b)): the image goes into Model.images and the face's paint carries where the texture lies
 * on it (imagePaintFit from cc-skp's UVs); on a placement it gives its colour. The report counts textured faces.
 * Tags (0.5 SG.4): a tag on a group or component becomes a ModelCraft tag of the same name, hidden when it was hidden
 * in SketchUp (a name the model already has is reused as it is). ModelCraft tags only placements, so faces and edges on
 * a tag keep no tag: on a hidden tag they come in hidden, and the report counts the rest. Hidden faces, edges and
 * placements come in hidden (Unhide all shows them) — the import shows what SketchUp showed and loses nothing.
 */

import { meshDef, Model, imagePaintFit, toBase64 } from './model.js';
import { t } from './i18n.js';

const IN = 0.0254;
const toM = (p) => [p[0] * IN, p[1] * IN, p[2] * IN];
const pkey = (p) => p.map((x) => Math.round(x * 1e5)).join(',');
const ekey = (a, b) => [pkey(a), pkey(b)].sort().join('|');
const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const clean = (s, dflt) => (String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || dflt);

export function importSKP(model, skp, name = 'SketchUp import') {
  if (!skp || skp.format !== 'skp' || !Array.isArray(skp.defs) || !skp.defs[skp.root]) throw new Error(t('app.import.skp.bad'));
  const materials = Array.isArray(skp.materials) ? skp.materials : [], layers = Array.isArray(skp.layers) ? skp.layers : [];
  const report = { version: skp.version, faces: 0, edges: 0, components: 0, groups: 0, textured: 0, hidden: 0, tags: 0, untagged: 0, skipped: {}, notes: skp.notes || [] };
  const skip = (k, n = 1) => { report.skipped[k] = (report.skipped[k] || 0) + n; };

  const colorOf = materials.map((m) => (m && Array.isArray(m.color) ? hex(m.color) : null));
  const textured = materials.map((m) => !!(m && m.texture));
  // the textures, kept on first use (a material's image once, however many faces show it)
  const imageIds = new Map();
  const imageOf = (mat) => {
    if (imageIds.has(mat)) return imageIds.get(mat);
    const tx = materials[mat].texture;
    let id = null;
    try { if (tx.bytes && /^image\/(png|jpeg|webp)$/.test(tx.mime || '')) id = model.addImage({ name: clean(tx.name || materials[mat].name, 'texture'), mime: tx.mime, data: toBase64(tx.bytes), avg: colorOf[mat] }); } catch { id = null; }
    imageIds.set(mat, id);
    return id;
  };
  const newell = (l) => { const n = [0, 0, 0]; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]); } return n; };
  const layerOff = layers.map((l) => !!l && l.visible === false);
  const off = (layer) => layer != null && !!layerOff[layer];
  const tagged = (layer) => layer != null && layer > 0 && !!layers[layer];   // tag 0 = Layer0 / Untagged

  // SketchUp tag index → a ModelCraft tag name (made on first use)
  const tagNames = new Map();
  const tagFor = (layer) => {
    if (!tagged(layer)) return null;
    if (tagNames.has(layer)) return tagNames.get(layer);
    const nm = clean(layers[layer].name, '');
    let tag = null;
    if (nm && model.tags.length < 1000) {
      const had = model.tag(nm);
      if (had) tag = had.name;
      else { model.tags.push(layerOff[layer] ? { name: nm, hidden: true } : { name: nm }); tag = nm; report.tags++; }
    }
    tagNames.set(layer, tag);
    return tag;
  };

  const built = new Map(), building = new Set(), made = [];
  const build = (i, depth) => {
    const d = skp.defs[i];
    if (!d) return null;
    if (built.has(i)) return built.get(i);
    if (depth > 64 || building.has(i)) { skip(t('app.import.skp.skip.nested')); return null; }
    if (d.kind === 'image') { skip(t('app.import.skp.skip.images')); built.set(i, null); return null; }
    building.add(i);
    const shown = [], hiddenPolys = [];
    for (const f of d.faces || []) {
      const mat = f.front;
      if (mat != null && textured[mat]) report.textured++;
      const hide = !!f.hidden || off(f.layer);
      if (!hide && tagged(f.layer)) report.untagged++;
      const loops = f.loops.map((l) => l.map(toM));
      let color = mat != null ? colorOf[mat] ?? undefined : undefined;
      if (mat != null && textured[mat] && f.uv && f.uv[0]) {
        const id = imageOf(mat), fit = id && imagePaintFit(id, loops[0], f.uv[0], newell(loops[0]), colorOf[mat]);
        if (fit) { color = fit; report.texturedKept = (report.texturedKept || 0) + 1; }
      }
      (hide ? hiddenPolys : shown).push({ loops, color });
    }
    const segs = [], hiddenSegs = new Set();
    for (const e of d.edges || []) {
      const a = toM(e.a), b = toM(e.b);
      segs.push([a, b]);
      if (e.hidden || off(e.layer)) hiddenSegs.add(ekey(a, b));
      else if (tagged(e.layer)) report.untagged++;
    }
    const places = [];
    for (const n of d.insts || []) {
      const id = build(n.def, depth + 1);
      if (!id) continue;
      const m = n.m.slice();
      m[12] *= IN; m[13] *= IN; m[14] *= IN;
      places.push({ id, m, name: n.name, hidden: !!n.hidden, tag: tagFor(n.layer), color: n.material != null ? colorOf[n.material] : null });
    }
    building.delete(i);
    let id = null;
    if (shown.length || hiddenPolys.length || segs.length || places.length) {
      const kind = d.kind === 'component' ? 'component' : 'group';
      // faces go in the order given, so the hidden ones are the faces after those the shown polygons make
      const nShown = hiddenPolys.length ? meshDef(new Model(), shown, 'count').faces.size : 0;
      const def = meshDef(model, shown.concat(hiddenPolys), clean(d.name, kind === 'component' ? t('app.import.skp.component') : t('app.import.skp.group')), kind, segs);
      if (hiddenPolys.length) {
        let k = 0;
        for (const f of def.faces.values()) if (k++ >= nShown) { f.hidden = true; report.hidden++; }
      }
      const soft = d.soft && d.soft.length ? new Set(d.soft.map(([a, b]) => ekey(toM(a), toM(b)))) : null;
      if (soft || hiddenSegs.size) {
        for (const e of def.edges.values()) {
          const k = ekey(def.verts.get(e.a), def.verts.get(e.b));
          if (soft && soft.has(k)) e.soft = true;
          if (hiddenSegs.has(k)) { e.hidden = true; report.hidden++; }
        }
      }
      for (const p of places) {
        const iid = model.place(def, p.id, p.m);
        const inst = def.insts.get(iid);
        if (p.name) inst.name = clean(p.name, '');
        if (p.color) inst.color = p.color;
        if (p.tag) inst.tag = p.tag;
        if (p.hidden) { inst.hidden = true; report.hidden++; }
      }
      made.push(def);
      id = def.id;
    }
    built.set(i, id);
    return id;
  };

  const rootId = build(skp.root, 0);
  if (!rootId) { for (const d of made) model.defs.delete(d.id); throw new Error(t('app.import.skp.empty')); }
  const top = model.defs.get(rootId);
  top.kind = 'group';
  top.name = clean(name, t('app.import.default'));
  for (const d of made) {
    report.faces += d.faces.size;
    report.edges += d.edges.size;
    if (d === top) continue;
    if (d.kind === 'component') report.components++;
    else report.groups++;
  }
  return { def: top, report };
}
