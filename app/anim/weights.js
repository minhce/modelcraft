/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/weights.js — how much each bone moves each vertex (0.7 AN.2, session `anim`): one vertex layer 'weight.<bone id>' per
 * bone on the mesh (0…1). Automatic weights, the paint brush's dab, and the glTF-style packed layers read in. DOM-free; the
 * page writes the results inside model.meshEdit / meshStroke (the model's undo).
 *
 *   autoWeights(mesh, rig, {mode 'heat' | 'envelope', iterations}) → Map(bone id → Float32Array(nv))
 *     heat: each bone heats the vertices nearest to it (1 / distance²) and the heat spreads over the mesh's edges (edges
 *     weighted 1 / length²) until it settles — the "bone heat" idea of Baran and Popović (2007), without its visibility
 *     test (a vertex takes its nearest bone even through a gap). envelope: 1 / distance⁴ between the nearest bones only.
 *     Both: weights under 1 % dropped, each vertex's weights add up to 1. Bones with deform off get none.
 *   writeWeights(mesh, rig, map) — the layers (made when missing; inside meshEdit)
 *   paintDab(mesh, bone, {p, r, strength, mode: 'add' | 'subtract' | 'smooth' | 'set', value, normalise, rig}) → vertices changed
 *     falloff (1 − (d / r)²)², inside meshStroke
 *   fromJoints(mesh, rig) → bool   'joints' / 'weights' layers (4 a vertex, glTF's JOINTS_0 / WEIGHTS_0, joint n = rig bone n)
 *     → 'weight.<bone>' layers
 *   segDist(p, a, b) → distance from p to the segment a–b
 */
export const LAYER = (id) => 'weight.' + id;

export function segDist(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const L = abx * abx + aby * aby + abz * abz;
  let k = L > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / L : 0;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const x = a[0] + abx * k - p[0], y = a[1] + aby * k - p[1], z = a[2] + abz * k - p[2];
  return Math.sqrt(x * x + y * y + z * z);
}

const graphs = new WeakMap();   // mesh → {key, g}: the smooth brush reads only who is next to whom
/** The mesh's vertex graph: CSR {start, nbr, wt (1 / length²), deg (sum of wt)}; `cached` for the brush (topology only). */
function graph(mesh, cached = false) {
  if (cached) {
    const c = graphs.get(mesh), key = mesh.topo + ':' + mesh.liveTopo + ':' + mesh.nv + ':' + mesh.nh;
    if (c && c.key === key) return c.g;
    const g = graph(mesh);
    graphs.set(mesh, { key, g });
    return g;
  }
  const n = mesh.nv, cnt = new Int32Array(n + 1), P = mesh.P, hV = mesh.hV, hNx = mesh.hNx;
  const pairs = [];
  for (let h = 0; h < mesh.nh; h++) {
    if (mesh.heDead(h)) continue;
    const a = hV[h], b = hV[hNx[h]];
    if (a === b || mesh.vertDead(a) || mesh.vertDead(b)) continue;
    pairs.push(a, b);
  }
  // each edge both ways once (a half-edge and its twin give the same pair)
  const seen = new Set(), E = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i], b = pairs[i + 1], k = a < b ? a * n + b : b * n + a;
    if (seen.has(k)) continue;
    seen.add(k); E.push(a, b); cnt[a + 1]++; cnt[b + 1]++;
  }
  for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
  const nbr = new Int32Array(cnt[n]), wt = new Float64Array(cnt[n]), fill = cnt.slice(0, n), deg = new Float64Array(n);
  for (let i = 0; i < E.length; i += 2) {
    const a = E[i], b = E[i + 1];
    const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2];
    const w = 1 / Math.max(1e-12, dx * dx + dy * dy + dz * dz);
    nbr[fill[a]] = b; wt[fill[a]++] = w; nbr[fill[b]] = a; wt[fill[b]++] = w;
    deg[a] += w; deg[b] += w;
  }
  return { start: cnt, nbr, wt, deg };
}

export function autoWeights(mesh, rig, { mode = 'heat', iterations = 200 } = {}) {
  const n = mesh.nv, P = mesh.P, bones = rig.bones.filter((b) => b.deform !== false), nb = bones.length;
  const out = new Map(rig.bones.map((b) => [b.id, new Float32Array(n)]));
  if (!nb || !n) return out;
  // distance from each vertex to each bone; nearest bone(s)
  const D = new Float64Array(n * nb), near = new Float64Array(n), pt = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    if (mesh.vertDead(v)) continue;
    pt[0] = P[v * 3]; pt[1] = P[v * 3 + 1]; pt[2] = P[v * 3 + 2];
    let m = Infinity;
    for (let b = 0; b < nb; b++) { const d = segDist(pt, bones[b].head, bones[b].tail); D[v * nb + b] = d; if (d < m) m = d; }
    near[v] = m;
  }
  const W = bones.map(() => new Float64Array(n));
  if (mode === 'envelope') {
    for (let v = 0; v < n; v++) {
      if (mesh.vertDead(v)) continue;
      let s = 0;
      for (let b = 0; b < nb; b++) { const d = D[v * nb + b]; if (d <= near[v] * 2 + 1e-9) { const w = 1 / Math.pow(Math.max(d, 1e-6), 4); W[b][v] = w; s += w; } }
      if (s > 0) for (let b = 0; b < nb; b++) W[b][v] /= s;
    }
  } else {
    const G = graph(mesh), H = new Float64Array(n);
    for (let v = 0; v < n; v++) H[v] = mesh.vertDead(v) ? 0 : 1 / Math.max(1e-12, near[v] * near[v]);
    for (let b = 0; b < nb; b++) {
      const w = W[b], p = new Float64Array(n);
      for (let v = 0; v < n; v++) if (!mesh.vertDead(v) && D[v * nb + b] <= near[v] * 1.0001 + 1e-12) { p[v] = 1; w[v] = 1; }
      // Gauss–Seidel on (L + H) w = H p, from the nearest-bone guess
      for (let it = 0; it < iterations; it++) {
        let change = 0;
        for (let v = 0; v < n; v++) {
          if (mesh.vertDead(v)) continue;
          let s = H[v] * p[v];
          for (let e = G.start[v]; e < G.start[v + 1]; e++) s += G.wt[e] * w[G.nbr[e]];
          const x = s / (G.deg[v] + H[v]);
          change = Math.max(change, Math.abs(x - w[v]));
          w[v] = x;
        }
        if (change < 1e-5) break;
      }
    }
    // normalise: each vertex's weights add up to 1
    for (let v = 0; v < n; v++) { let s = 0; for (let b = 0; b < nb; b++) s += W[b][v]; if (s > 0) for (let b = 0; b < nb; b++) W[b][v] /= s; }
  }
  // drop the faint ones and add up to 1 again
  for (let v = 0; v < n; v++) {
    let s = 0;
    for (let b = 0; b < nb; b++) { if (W[b][v] < 0.01) W[b][v] = 0; s += W[b][v]; }
    if (s > 0) for (let b = 0; b < nb; b++) W[b][v] /= s;
  }
  bones.forEach((b, i) => out.set(b.id, Float32Array.from(W[i])));
  return out;
}

export function writeWeights(mesh, rig, map) {
  const one = [0];
  for (const b of rig.bones) {
    const w = map.get(b.id);
    if (!w) continue;
    const name = LAYER(b.id);
    if (!mesh.hasAttr(name)) mesh.addAttr(name, 'vertex', 1);
    for (let v = 0; v < mesh.nv; v++) if (!mesh.vertDead(v)) { one[0] = w[v] || 0; mesh.setAttr(name, v, one); }
  }
}

/** One dab of the weight brush on bone `bone` (its layer made when missing). → how many vertices changed. */
export function paintDab(mesh, bone, { p, r, strength = 0.5, mode = 'add', value = 1, normalise = true, rig = null }) {
  const name = LAYER(bone);
  if (!mesh.hasAttr(name)) mesh.addAttr(name, 'vertex', 1);
  const A = mesh.attrArray(name), P = mesh.P, r2 = r * r, one = [0];
  const others = normalise && rig ? rig.bones.filter((b) => b.id !== bone && b.deform !== false && mesh.hasAttr(LAYER(b.id))).map((b) => LAYER(b.id)) : [];
  let G = null, n = 0;
  for (let v = 0; v < mesh.nv; v++) {
    if (mesh.vertDead(v)) continue;
    const dx = P[v * 3] - p[0], dy = P[v * 3 + 1] - p[1], dz = P[v * 3 + 2] - p[2], d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const f = (1 - d2 / r2) ** 2 * strength, w0 = mesh.attrArray(name)[v];
    let w = w0;
    if (mode === 'add') w = w0 + f * (1 - w0);
    else if (mode === 'subtract') w = w0 - f * w0;
    else if (mode === 'set') w = w0 + f * (value - w0);
    else if (mode === 'smooth') {
      G = G || graph(mesh, true);
      let s = 0, k = 0;
      for (let e = G.start[v]; e < G.start[v + 1]; e++) { s += A[G.nbr[e]]; k++; }
      if (k) w = w0 + f * (s / k - w0);
    }
    w = Math.min(1, Math.max(0, w));
    if (w === w0) continue;
    one[0] = w; mesh.setAttr(name, v, one);
    n++;
    // auto-normalise: the other bones share what is left
    if (others.length) {
      let so = 0;
      for (const o of others) so += mesh.attrArray(o)[v];
      if (so > 1e-9) { const k = Math.max(0, 1 - w) / so; for (const o of others) { one[0] = mesh.attrArray(o)[v] * k; mesh.setAttr(o, v, one); } }
    }
  }
  return n;
}

/** glTF-style packed layers ('joints' i32 × 4, 'weights' f32 × 4) → one 'weight.<bone>' layer per rig bone (joint n = bone n). */
export function fromJoints(mesh, rig) {
  const J = mesh.attrArray('joints'), Wt = mesh.attrArray('weights');
  if (!J || !Wt) return false;
  const kj = mesh.attrInfo('joints').size, kw = mesh.attrInfo('weights').size, k = Math.min(kj, kw);
  const map = new Map(rig.bones.map((b) => [b.id, new Float32Array(mesh.nv)]));
  for (let v = 0; v < mesh.nv; v++) for (let q = 0; q < k; q++) {
    const j = J[v * kj + q], w = Wt[v * kw + q], b = rig.bones[j];
    if (b && w > 0) map.get(b.id)[v] += w;
  }
  writeWeights(mesh, rig, map);
  return true;
}
