/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mesh/mod-job.js — a stretch of a modifier stack evaluated in compute's pool (0.7 MD.3; pool API: docs/apps/compute.md
 * § pool). The page sends the mesh as typed arrays (Mesh.toArrays, transferred), the modifiers and their resolved
 * references; the result comes back the same way. Booleans are not run here (manifold-3d lives on the page): the page
 * splits the stack round them (mod-eval.js).
 *
 *   evaluate({ mesh, mods, refs: [[index, data]], render, budget }, ctx) → { mesh (arrays), notes, info }
 */
import { Mesh } from '../mesh.js';
import { evaluate as run } from './modifiers.js';

export function evaluate(args, ctx) {
  const m = Mesh.fromArrays(args.mesh);
  const refs = new Map(args.refs || []);
  if (ctx?.cancelled?.()) return { cancelled: true };
  const r = run(m, args.mods, { render: !!args.render, refs, budget: args.budget || 0 });
  return { mesh: r.mesh.toArrays(), notes: r.notes, info: r.info };
}
