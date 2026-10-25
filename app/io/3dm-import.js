/* SPDX-License-Identifier: Apache-2.0 */
/**
 * 3dm-import.js — a .3dm model into ModelCraft (0.7 SU.810, session 3dm). The file is read by cc-3dm (./3dm/, a copy of
 * lib/3dm/ written only by tools/3dm/sync.mjs): meshes as they are, polysurfaces and extrusions from the render meshes saved
 * in the file or tessellated by cc-3dm, curves as edges, blocks as components placed where the file places them, layers as
 * tags, colours as paints, in metres. What is not read is said, never guessed (the report's notes). DOM-free; untrusted input.
 *
 *   read3dmFile(bytes) → cc-3dm's scene (open3dm): { units, layers, items, blocks, report, notes }
 *   import3dm(model, scene, name) → { def (a group named after the file), report { meshes, faces, curves, components,
 *       placements, tags, hidden, cached, ours, notes [text], skipped {} } }
 */
import { open3dm, msg } from './3dm/index.js';
import { Mesh } from '../mesh.js';
import { markSharp } from './obj.js';
import { edgesDef } from '../model.js';
import { t } from '../i18n.js';

const MAX_DEPTH = 16;
const cleanName = (s, d) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) || d;

export function read3dmFile(bytes) { return open3dm(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); }

/** The file's row-major matrix (m[r][c] = x[r * 4 + c]) as a ModelCraft column-major one, with the translation in metres. */
function placement(x, k) {
  const m = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[c * 4 + r] = x[r * 4 + c];
  m[12] *= k; m[13] *= k; m[14] *= k;
  return m;
}

function buildMesh(it, k) {
  const P = it.positions, nv = P.length / 3;
  const pts = new Float64Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) pts[i] = P[i] * k;
  const nt = it.indices.length / 3;
  const mesh = new Mesh();
  const { faceOf, cornerOf, dropped } = mesh._bulk(pts, nv, new Int32Array(nt).fill(3), Int32Array.from(it.indices));
  if (it.colors) {
    mesh.addAttr('color', 'corner', 4);
    const CO = mesh.attrArray('color');
    for (let c = 0; c < it.indices.length; c++) { const h = cornerOf[c]; if (h < 0) continue; const v = it.indices[c]; for (let q = 0; q < 4; q++) CO[h * 4 + q] = it.colors[v * 4 + q]; }
  }
  if (it.uvs) {
    mesh.addAttr('uv', 'corner', 2);
    const UV = mesh.attrArray('uv');
    for (let c = 0; c < it.indices.length; c++) { const h = cornerOf[c]; if (h < 0) continue; const v = it.indices[c]; UV[h * 2] = it.uvs[v * 2]; UV[h * 2 + 1] = it.uvs[v * 2 + 1]; }
  }
  if (it.color) { const p = mesh.paintIndex(it.color); for (let f = 0; f < nt; f++) if (faceOf[f] >= 0) mesh.fMat[faceOf[f]] = p; }
  // smooth inside one face of the file, sharp between faces; a plain mesh by its own normals
  if (it.triFace) {
    const smooth = new Int32Array(mesh.nf + 1);
    for (let f = 0; f < nt; f++) if (faceOf[f] >= 0) smooth[faceOf[f]] = it.triFace[f] + 1;
    markSharp(mesh, null, smooth);
  } else if (it.normals) {
    const N = new Float64Array(mesh.nh * 3);
    for (let c = 0; c < it.indices.length; c++) { const h = cornerOf[c]; if (h < 0) continue; const v = it.indices[c]; N[h * 3] = it.normals[v * 3]; N[h * 3 + 1] = it.normals[v * 3 + 1]; N[h * 3 + 2] = it.normals[v * 3 + 2]; }
    markSharp(mesh, N);
  } else markSharp(mesh, null);
  return { mesh, dropped };
}

export function import3dm(model, scene, name) {
  const k = scene.units.metres > 0 && Number.isFinite(scene.units.metres) ? scene.units.metres : 0.001;
  const R = scene.report;
  const report = {
    meshes: 0, faces: 0, curves: 0, components: 0, placements: 0, tags: 0, hidden: 0,
    cached: R.surfaces.cached, ours: Object.values(R.surfaces.ours).reduce((a, n) => a + n, 0),
    notes: scene.notes.map((n) => msg(n.key, n.vars)), skipped: {},
  };
  const top = model.newDef('group', cleanName(name, t('ccdm.app.default')));
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  // layers → tags (made when first used; a hidden layer's tag is hidden)
  const tagOf = new Map();
  const tag = (li) => {
    if (li < 0 || !scene.layers[li]) return null;
    if (tagOf.has(li)) return tagOf.get(li);
    const L = scene.layers[li];
    const nm = cleanName(L.name, null);
    let out = null;
    if (nm && model.tags.length < 1000) {
      const had = model.tag(nm);
      if (had) out = had.name;
      else { model.tags.push(L.visible ? { name: nm } : { name: nm, hidden: true }); out = nm; report.tags++; }
    }
    tagOf.set(li, out);
    return out;
  };
  const mark = (def, iid, it) => {
    const inst = def.insts.get(iid);
    if (it.name) inst.name = cleanName(it.name, '');
    const tg = tag(it.layer);
    if (tg) inst.tag = tg;
    if (it.hidden) { inst.hidden = true; report.hidden++; }
  };

  // blocks → components, built the first time a placement needs them (a block inside itself is cut off)
  const compOf = new Map();
  const building = new Set();
  const component = (id, depth) => {
    if (compOf.has(id)) return compOf.get(id);
    const b = scene.blocks.get(id);
    if (!b || building.has(id) || depth > MAX_DEPTH) return null;
    building.add(id);
    const def = model.newDef('component', cleanName(b.name, t('ccdm.app.block')));
    fill(def, b.items, depth + 1);
    building.delete(id);
    compOf.set(id, def);
    report.components++;
    return def;
  };

  // one container's items: meshes and placements one by one, curves together per layer
  function fill(def, items, depth) {
    const curves = new Map();
    for (const it of items) {
      if (it.kind === 'mesh') {
        const { mesh } = buildMesh(it, k);
        if (!mesh.faceCount) continue;
        const md = model.newMeshDef(mesh, cleanName(it.name, t('ccdm.app.object')));
        mark(def, model.place(def, md.id, I), it);
        report.meshes++; report.faces += mesh.faceCount;
      } else if (it.kind === 'curve') {
        const key = it.layer + '|' + (it.hidden ? 1 : 0);
        if (!curves.has(key)) curves.set(key, { it, segs: [] });
        const segs = curves.get(key).segs;
        for (let i = 0; i + 1 < it.pts.length; i++) {
          const a = it.pts[i].map((x) => x * k), b = it.pts[i + 1].map((x) => x * k);
          if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) segs.push([a, b]);
        }
        report.curves++;
      } else if (it.kind === 'instance') {
        const c = component(it.block, depth);
        if (!c) { report.skipped[t('ccdm.app.no_block')] = (report.skipped[t('ccdm.app.no_block')] || 0) + 1; continue; }
        mark(def, model.place(def, c.id, placement(it.xform, k)), it);
        report.placements++;
      }
    }
    for (const { it, segs } of curves.values()) {
      if (!segs.length) continue;
      const L = scene.layers[it.layer];
      const ed = edgesDef(model, segs, L ? t('ccdm.app.curves_on', { layer: cleanName(L.name, '') }) : t('ccdm.app.curves'));
      mark(def, model.place(def, ed.id, I), { layer: it.layer, hidden: it.hidden });
    }
  }
  fill(top, scene.items, 0);
  return { def: top, report };
}

/** The status line after an import (the app prints it). */
export function importMessage(file, r) {
  const parts = [t('ccdm.app.done', { file, meshes: r.meshes, faces: r.faces, curves: r.curves, placements: r.placements, tags: r.tags })];
  if (r.cached || r.ours) parts.push(t('ccdm.app.sources', { cached: r.cached, ours: r.ours }));
  if (r.notes.length) parts.push(t('ccdm.app.notes', { notes: r.notes.join(' ') }));
  return parts.join(' ');
}
