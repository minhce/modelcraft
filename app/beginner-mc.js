/* SPDX-License-Identifier: Apache-2.0 */
/**
 * beginner-mc.js — the Beginner menu style's commands on the page (0.7 LC.21 item 2, session print-07). ui.inc has one
 * hidden button per command ([data-beginner], data-input-only); the style (input-modelcraft.js) clicks them, and
 * modelcraft.js hands each click to run(). The work is beginner.js (shapes, holes, align) and print-solid.js (Group with
 * holes → one closed part, one undo step: a solid group of faces, or a mesh when the kernel can't hold it as one).
 *
 *   mountBeginner(ctx) → {run(cmd)}
 *   ctx: {model, host ({path, sel, setSel}), t, print(msg), setTool(name, arg), afterHistory(), clickAct(name)}
 */
import { buildShape, setHole, solidsAndHoles, align, dropToGround, SHAPES, HOLE_COLOR } from './beginner.js';
import { placementTris, booleanTris, replaceWithPart } from './print-solid.js';
import { manifold } from './solids.js';

const ALIGN = {
  'align-left': [0, 'min'], 'align-centerx': [0, 'mid'], 'align-right': [0, 'max'],
  'align-front': [1, 'min'], 'align-centery': [1, 'mid'], 'align-back': [1, 'max'],
  'align-bottom': [2, 'min'], 'align-centerz': [2, 'mid'], 'align-top': [2, 'max'],
};

export function mountBeginner(ctx) {
  const { model, host, t, print } = ctx;
  const ctxDef = () => (model.context(host.path) || model.context([])).def;
  const picked = () => { const d = ctxDef(); return host.sel.filter((s) => s.t === 'i' && d.insts.has(s.id)).map((s) => s.id); };

  function dropShape(id) {
    const name = t('app.beginner.shape.' + id);
    // one waiting definition per shape: a drop that was cancelled leaves its shape for the next
    const used = model.instanceCounts();
    const starter = (id.startsWith('hole-') ? 'beginner-hole-' + id.slice(5) : 'beginner-' + id);
    let def = [...model.defs.values()].find((d) => d.kind === 'group' && d.starter === starter && !used.get(d.id));
    if (!def) def = model.change(t('app.beginner.undo.shape', { name }), (m) => buildShape(m, id, m.uniqueName(name)), []);
    ctx.afterHistory();
    const hint = () => t('app.beginner.where', { name });
    ctx.setTool('place', { defId: def.id, align: true, hint });
    print(hint());
  }

  async function group() {
    const iids = picked();
    if (iids.length < 2) { print(t('app.beginner.group.pick')); return; }
    const d = ctxDef(), { solids, holes } = solidsAndHoles(model, d, iids);
    if (!holes.length) { ctx.clickAct('group'); return; }   // no holes: a plain group, as Organize › Group makes
    if (!solids.length) { print(t('app.beginner.group.only_holes')); return; }
    print(t('app.beginner.group.working'));
    let tris;
    try {
      const MF = await manifold();
      tris = booleanTris(MF, solids.map((i) => placementTris(model, d, i)), holes.map((i) => placementTris(model, d, i)), 'subtract');
    } catch (err) {
      print(t(err.code === 'empty' ? 'app.beginner.group.empty' : err.code === 'open' ? 'app.beginner.group.open' : 'app.beginner.group.failed', { error: err.message }));
      return;
    }
    const first = d.insts.get(solids[0]), fd = model.def(first.def);
    const paint = first.color || [...fd.faces.values()].find((f) => f.color && f.color !== HOLE_COLOR)?.color || null;
    const name = (fd.name || '').replace(/\s*#\d+$/, '') || t('app.beginner.shape.box');
    const r = replaceWithPart(model, host.path, [...solids, ...holes], tris, { label: t('app.beginner.undo.group'), name: model.uniqueName(name), color: paint, tag: first.tag });
    ctx.afterHistory();
    host.setSel([{ t: 'i', id: r.iid }]);
    print(t('app.beginner.group.done', { n: holes.length }) + (r.solid ? '' : ' ' + t(r.why === 'size' ? 'app.ptool.result.mesh_size' : 'app.ptool.result.mesh_open')));
  }

  async function run(cmd) {
    if (SHAPES.includes(cmd)) { dropShape(cmd); return; }
    if (cmd === 'group') { await group(); return; }
    const iids = picked();
    if (cmd === 'hole' || cmd === 'solid') {
      if (!iids.length) { print(t('app.beginner.pick')); return; }
      const n = model.change(t(cmd === 'hole' ? 'app.beginner.undo.hole' : 'app.beginner.undo.solid'), (m) => setHole(m, m.context(host.path).def, iids, cmd === 'hole'));
      ctx.afterHistory();
      print(t(cmd === 'hole' ? 'app.beginner.holed' : 'app.beginner.solided', { n }));
      return;
    }
    if (ALIGN[cmd]) {
      if (iids.length < 2) { print(t('app.beginner.align.pick')); return; }
      const [axis, where] = ALIGN[cmd];
      const n = model.change(t('app.beginner.undo.align'), (m) => align(m, m.context(host.path).def, iids, axis, where));
      ctx.afterHistory();
      print(t('app.beginner.aligned', { n }));
      return;
    }
    if (cmd === 'drop') {
      if (!iids.length) { print(t('app.beginner.pick')); return; }
      const n = model.change(t('app.beginner.undo.drop'), (m) => dropToGround(m, m.context(host.path).def, iids));
      ctx.afterHistory();
      print(t('app.beginner.dropped', { n }));
    }
  }
  return { run };
}
