/* SPDX-License-Identifier: Apache-2.0 */
/**
 * step-import.js — STEP (AP203 / AP214 / AP242) into ModelCraft (0.7 D7.26, session part-08). The file is read by cc-step
 * (./step/, a copy of lib/step/ written only by tools/step/sync.mjs): B-rep faces tessellated, faceted and AP242 triangle sets
 * as they are, assemblies with every part where the file places it, in millimetres. Each placed solid becomes one welded mesh
 * definition in a group named after the file, turned to metres; the curved faces are many small flat ones, the edges inside one
 * STEP face soft and the edges between two faces sharp (markSharp by the face each triangle came from). DOM-free; untrusted
 * input (cc-step's caps, errors with `code` step.err.*).
 *
 *   readStepFile(bytes) → cc-step's read { schema, solids[{ name, positions (mm), indices }], notes[{key, vars}], counts, tol }
 *   importStep(model, read, name) → { def, report { solids, faces, vertices, schema, notes[], skipped } }
 */
import { readStep } from './step/read.js';
import { Mesh } from '../mesh.js';
import { markSharp } from './obj.js';
import { t } from '../i18n.js';

const MM = 0.001;   // the model is in metres
const cleanName = (s, d) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) || d;

export function readStepFile(bytes) { return readStep(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); }

export function importStep(model, read, name) {
  const report = { solids: 0, faces: 0, vertices: 0, schema: read.schema === 'other' ? 'STEP' : read.schema, notes: read.notes.map((n) => t(n.key, n.vars)), skipped: {} };
  const top = model.newDef('group', cleanName(name, 'STEP import'));   // i18n-ignore: a fallback for a file with no name
  const q = Math.max(read.tol * 0.05, 1e-9);   // corners closer than this are one (a face's edge points meet its neighbour's)
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  read.solids.forEach((s, si) => {
    const keyOf = new Map(), pts = [];
    const P = s.positions, nV = P.length / 3;
    const map = new Int32Array(nV);
    for (let v = 0; v < nV; v++) {
      const k = Math.round(P[v * 3] / q) + ',' + Math.round(P[v * 3 + 1] / q) + ',' + Math.round(P[v * 3 + 2] / q);
      let w = keyOf.get(k);
      if (w === undefined) { w = pts.length / 3; keyOf.set(k, w); pts.push(P[v * 3] * MM, P[v * 3 + 1] * MM, P[v * 3 + 2] * MM); }
      map[v] = w;
    }
    const keep = [], keepFace = [];
    for (let i = 0; i < s.indices.length; i += 3) {
      const a = map[s.indices[i]], b = map[s.indices[i + 1]], c = map[s.indices[i + 2]];
      if (a !== b && b !== c && a !== c) { keep.push(a, b, c); keepFace.push(s.triFace ? s.triFace[i / 3] + 1 : 1); }
    }
    const dropped0 = s.indices.length / 3 - keep.length / 3;
    if (dropped0) report.skipped[t('stl.note.degenerate')] = (report.skipped[t('stl.note.degenerate')] || 0) + dropped0;
    if (!keep.length) return;
    const mesh = new Mesh();
    const { faceOf, dropped } = mesh._bulk(Float64Array.from(pts), pts.length / 3, new Int32Array(keep.length / 3).fill(3), Int32Array.from(keep));
    if (dropped) report.skipped[t('stl.note.degenerate')] = (report.skipped[t('stl.note.degenerate')] || 0) + dropped;
    const smooth = new Int32Array(mesh.nf + 1);
    keepFace.forEach((f, k) => { if (faceOf[k] >= 0) smooth[faceOf[k]] = f; });
    markSharp(mesh, null, smooth);
    const def = model.newMeshDef(mesh, cleanName(s.name, cleanName(name, 'STEP') + ' ' + (si + 1)));
    model.place(top, def.id, I);
    report.solids++;
    report.faces += mesh.faceCount;
    report.vertices += mesh.vertexCount;
  });
  return { def: top, report };
}
