/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file: what a person reads goes through t() (fbx.* keys); the rest is FBX property names and internal diagnostics. */
/**
 * fbx-import.js — an FBX node tree (fbx-parse.js) into ModelCraft (0.7 XF.6, session `interchange`). Clean room: see
 * fbx-parse.js and docs/spikes/fbx-reader.md — meaning taken from the names the files use, checked black-box against
 * Assimp's results; no FBX SDK, no GPL importer, no other reader's source.
 *
 *   readFbxScene(tree, { resolve }) → scene        (async: textures named by file come from `resolve(name)`)
 *   importFbx(model, scene, name) → { def, report } inside model.change(); `def` is a group, not placed
 *
 * - Objects by id from `Objects`; links from `Connections` (`OO` object → object, `OP` object → a property, e.g. a texture
 *   → a material's "DiffuseColor"); each object's `Properties70` over its type's template in `Definitions`.
 * - Axes and unit from `GlobalSettings` (UpAxis / FrontAxis / CoordAxis with their signs; UnitScaleFactor in centimetres):
 *   the file's up axis becomes Z, its "front" axis −Y, its coordinate axis X, all in metres — as a similarity A, so points
 *   become A·p and node matrices A·M·A⁻¹.
 * - Models → groups or placements: translation · rotation offset · rotation pivot · pre-rotation · rotation (its
 *   RotationOrder) · post-rotation⁻¹ · pivot⁻¹ · scaling offset · scaling pivot · scaling · pivot⁻¹; the geometric
 *   transform (GeometricTranslation/Rotation/Scaling) applies to that model's geometry only.
 * - Geometry "Mesh" → a mesh definition (MD.1): polygons from PolygonVertexIndex (a negative index ends a polygon),
 *   LayerElementNormal / UV (+ more UV sets) / Color / Material in every mapping (by polygon vertex, by control point, by
 *   polygon, all same) and reference (direct, index to direct) mode; one Geometry used by several models stays shared.
 * - Materials → colours (DiffuseColor), or the diffuse texture (embedded Video Content, else the file it names among the
 *   files dropped with the .fbx) as an image paint placed by the uv layer. Other material settings are reported (RN.2).
 * - Lights → lamps (point / spot; intensity 100 = 800 lm, ModelCraft's default lamp: FBX intensity has no unit);
 *   directional and area lights are counted. Cameras → scenes (they look along their own +X).
 * - Skins: the mesh is already in its bind pose; each control point's four strongest clusters → `joints` / `weights`.
 *   Bones and animation are counted until Animate (AN.2) has them.
 */
import { Mesh } from '../mesh.js';
import { mmul, ident, apply, applyDir, norm, invert, len } from '../vec.js';
import { cleanScene, imagePaint, toBase64 } from '../model.js';
import { markSharp } from './obj.js';
import { sniffImage } from './gltf-read.js';
import { tgaToPng } from './tga.js';
import { fbxToOpenPBR } from './pbr.js';
import { child, kids, FbxError } from './fbx-parse.js';
import { t } from '../i18n.js';

const MAX_DEPTH = 128;
const cleanName = (s, d) => String(s || d || 'FBX import').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/^[A-Za-z]+::/, '').trim().slice(0, 120) || d || 'FBX import';   // i18n-ignore: a fallback for a file with no name
const idOf = (v) => String(v);
const bad = (why) => new FbxError('damaged', t('fbx.damaged', { why }));

/** Properties70 → { name: [values…] } */
function props70(node) {
  const out = {};
  const p = child(node, 'Properties70') || child(node, 'Properties60');
  for (const c of p ? p.children : []) if ((c.name === 'P' || c.name === 'Property') && typeof c.props[0] === 'string') out[c.props[0]] = c.props.slice(c.name === 'P' ? 4 : 3);
  return out;
}

export async function readFbxScene(tree, { resolve = null } = {}) {
  const root = tree.root;
  if (tree.version && tree.version < 7000) throw new FbxError('unsupported', t('fbx.version', { version: tree.version }));
  // templates: ObjectType "Model" { PropertyTemplate "FbxNode" { Properties70 } }
  const templates = {};
  for (const ot of kids(child(root, 'Definitions'), 'ObjectType')) {
    const pt = child(ot, 'PropertyTemplate');
    if (pt) templates[ot.props[0]] = props70(pt);
  }
  const objects = new Map();
  for (const n of child(root, 'Objects')?.children || []) {
    const id = idOf(n.props[0]);
    const full = typeof n.props[1] === 'string' ? n.props[1] : '';
    const name = full.includes('\u0000\u0001') ? full.split('\u0000\u0001')[0] : full.replace(/^[A-Za-z]+::/, '');
    objects.set(id, { id, type: n.name, name, sub: n.props[2] ?? '', node: n, props: { ...(templates[n.name] || {}), ...props70(n) }, children: [], parents: [], links: [] });
  }
  const rootObj = { id: '0', type: 'Root', name: '', children: [], props: {} };
  objects.set('0', rootObj);
  for (const c of child(root, 'Connections')?.children || []) {
    if (c.name !== 'C' && c.name !== 'Connect') continue;
    const kind = c.props[0];
    const a = objects.get(idOf(c.props[1]));
    const b = objects.get(idOf(c.props[2]));
    if (!a || !b || a === b) continue;
    if (kind === 'OO') { b.children.push(a); (a.parents ||= []).push(b); }
    else if (kind === 'OP') (b.links ||= []).push({ obj: a, prop: String(c.props[3] ?? '') });
  }
  const gs = props70(child(root, 'GlobalSettings') || { children: [] });
  const ax = (k, d) => (Array.isArray(gs[k]) && typeof gs[k][0] === 'number' ? gs[k][0] : d);
  const settings = {
    up: ax('UpAxis', 1), upSign: ax('UpAxisSign', 1), front: ax('FrontAxis', 2), frontSign: ax('FrontAxisSign', 1),
    coord: ax('CoordAxis', 0), coordSign: ax('CoordAxisSign', 1), unit: ax('UnitScaleFactor', 1),
  };
  // textures' pictures: embedded, else from the files given with the .fbx
  const notes = {};
  for (const o of objects.values()) {
    if (o.type !== 'Video') continue;
    const content = child(o.node, 'Content')?.props.find((x) => x instanceof Uint8Array || (typeof x === 'string' && x.length > 16));
    let bytes = content instanceof Uint8Array ? content : typeof content === 'string' ? b64(content) : null;
    const fname = String(child(o.node, 'RelativeFilename')?.props[0] || child(o.node, 'Filename')?.props[0] || child(o.node, 'FileName')?.props[0] || o.props.RelPath?.[0] || '').split(/[\\/]/).pop();
    if (bytes && !sniffImage(bytes) && /\.tga$/i.test(fname)) bytes = tgaToPng(bytes);   // TGA kept as PNG
    if (!bytes || !sniffImage(bytes)) {
      bytes = fname && resolve ? await resolve(fname) : null;
      if (bytes && !sniffImage(bytes) && /\.tga$/i.test(fname)) bytes = tgaToPng(bytes);
      if (!bytes && fname) notes[t('fbx.note.no_texture')] = (notes[t('fbx.note.no_texture')] || 0) + 1;
    }
    const mime = sniffImage(bytes);
    o.image = bytes && mime && mime !== 'image/ktx2' ? { name: o.name || 'texture', mime, bytes } : null;
  }
  return { objects, root: rootObj, settings, version: tree.version, binary: tree.binary, notes };
}

function b64(s) {
  try {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s.replace(/\s+/g, ''));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  } catch { return null; }
}

// ------------------------------------------------------------------------------------------------- matrices

const D2R = Math.PI / 180;
const T = (v) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
const S = (v) => [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1];
const Rx = (a) => { const c = Math.cos(a * D2R); const s = Math.sin(a * D2R); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const Ry = (a) => { const c = Math.cos(a * D2R); const s = Math.sin(a * D2R); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const Rz = (a) => { const c = Math.cos(a * D2R); const s = Math.sin(a * D2R); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
/** Euler angles (degrees) in a RotationOrder: "XYZ" turns about X first, then Y, then Z. */
function euler(v, order = 0) {
  const [x, y, z] = [Rx(v[0]), Ry(v[1]), Rz(v[2])];
  const seq = [[z, y, x], [y, z, x], [x, z, y], [z, x, y], [y, x, z], [x, y, z]][order] || [z, y, x];
  return mmul(seq[0], mmul(seq[1], seq[2]));
}
const vec3 = (p, k, d) => (Array.isArray(p[k]) && p[k].length >= 3 && p[k].slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x)) ? p[k].slice(0, 3) : d);
const num = (p, k, d) => (Array.isArray(p[k]) && typeof p[k][0] === 'number' && Number.isFinite(p[k][0]) ? p[k][0] : d);

function localMatrix(p) {
  const order = num(p, 'RotationOrder', 0);
  const rp = vec3(p, 'RotationPivot', [0, 0, 0]);
  const sp = vec3(p, 'ScalingPivot', [0, 0, 0]);
  const parts = [
    T(vec3(p, 'Lcl Translation', [0, 0, 0])), T(vec3(p, 'RotationOffset', [0, 0, 0])), T(rp),
    euler(vec3(p, 'PreRotation', [0, 0, 0]), 0), euler(vec3(p, 'Lcl Rotation', [0, 0, 0]), order),
    invert(euler(vec3(p, 'PostRotation', [0, 0, 0]), 0)), T(rp.map((x) => -x)),
    T(vec3(p, 'ScalingOffset', [0, 0, 0])), T(sp), S(vec3(p, 'Lcl Scaling', [1, 1, 1])), T(sp.map((x) => -x)),
  ];
  return parts.reduce((m, q) => mmul(m, q), ident());
}
function geometricMatrix(p) {
  return mmul(T(vec3(p, 'GeometricTranslation', [0, 0, 0])), mmul(euler(vec3(p, 'GeometricRotation', [0, 0, 0]), 0), S(vec3(p, 'GeometricScaling', [1, 1, 1]))));
}
/** The file's axes and unit → ModelCraft (Z up, metres): up → +Z, front → −Y, coord → +X. */
export function axisMatrix(s) {
  const e = (i, sign) => { const v = [0, 0, 0]; if (i >= 0 && i <= 2) v[i] = sign < 0 ? -1 : 1; return v; };
  // rows of the map: model X = coord axis, model Y = −front axis, model Z = up axis (each a unit vector in file space)
  const X = e(s.coord, s.coordSign); const Y = e(s.front, s.frontSign).map((v) => -v); const Z = e(s.up, s.upSign);
  const k = (s.unit > 0 && Number.isFinite(s.unit) ? s.unit : 1) * 0.01;
  // column-major: column j = the model coordinates of file axis j
  const m = ident();
  for (let j = 0; j < 3; j++) { m[j * 4] = X[j] * k; m[j * 4 + 1] = Y[j] * k; m[j * 4 + 2] = Z[j] * k; }
  if (Math.abs(det(m)) < 1e-12) return S([k, k, k]);   // contradictory axes: just the unit
  return m;
}
const det = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

// ------------------------------------------------------------------------------------------------- import

export function importFbx(model, scene, name) {
  const report = { meshes: 0, faces: 0, vertices: 0, groups: 0, components: 0, textures: 0, lights: 0, cameras: 0, skins: 0, bones: 0, animations: 0, materials: [], skipped: { ...scene.notes } };
  const skip = (k, n = 1) => { report.skipped[k] = (report.skipped[k] || 0) + n; };
  const A = axisMatrix(scene.settings);
  const AI = invert(A);
  const conj = (m) => mmul(A, mmul(m, AI));
  const top = model.newDef('group', cleanName(name));
  for (const o of scene.objects.values()) {
    if (o.type === 'AnimationStack') report.animations++;
    if (o.type === 'Model' && (o.sub === 'LimbNode' || o.sub === 'Limb')) report.bones++;
  }

  // paints
  const imgIds = new Map();
  const paintOf = new Map();
  const materialPaint = (mat) => {
    if (paintOf.has(mat.id)) return paintOf.get(mat.id);
    const p = mat.props;
    const col = vec3(p, 'DiffuseColor', vec3(p, 'Diffuse', null)) || vec3(p, 'Maya|baseColor', null) || [0.8, 0.8, 0.8];
    const hex = '#' + col.map((c) => Math.round(Math.min(1, Math.max(0, c)) ** (1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
    let paint = hex;
    const link = (mat.links || []).find((l) => /DiffuseColor|Diffuse|baseColor|base_color/i.test(l.prop) && l.obj.type === 'Texture') || (mat.links || []).find((l) => l.obj.type === 'Texture');
    const video = link ? link.obj.children.find((c) => c.type === 'Video' && c.image) : null;
    if (video && model.addImage) {
      if (!imgIds.has(video.id)) {
        let id = null;
        try { id = model.addImage({ name: video.image.name, mime: video.image.mime, data: toBase64(video.image.bytes), avg: hex }); report.textures++; } catch { id = null; }
        imgIds.set(video.id, id);
      }
      const id = imgIds.get(video.id);
      if (id) paint = imagePaint(id, [1, 0, 0, 0], [0, 1, 0, 0], hex);
    }
    const extra = ['Maya|metalness', 'Metalness', 'Roughness', 'Maya|specularRoughness', 'TransparencyFactor', 'Opacity', 'NormalMap', 'Bump'].filter((k) => p[k] !== undefined && !(k === 'TransparencyFactor' && num(p, k, 0) === 0) && !(k === 'Opacity' && num(p, k, 1) === 1));
    report.materials.push({ name: mat.name, kept: paint === hex ? 'colour' : 'texture', also: extra, openpbr: fbxToOpenPBR(p) });
    paintOf.set(mat.id, paint);
    return paint;
  };

  // meshes: one per Geometry (and the materials order of its model)
  const meshOf = new Map();
  const uses = new Map();
  const meshFor = (geo, modelObj) => {
    const mats = modelObj.children.filter((c) => c.type === 'Material');
    const key = geo.id + '|' + mats.map((m) => m.id).join(',');
    if (meshOf.has(key)) return meshOf.get(key);
    const mesh = buildMesh(geo, mats.map(materialPaint), A, report, skip);
    const def = mesh ? model.newMeshDef(mesh, cleanName(modelObj.name, t('fbx.mesh'))) : null;
    if (def) { report.meshes++; report.faces += mesh.faceCount; report.vertices += mesh.vertexCount; }
    meshOf.set(key, def);
    return def;
  };

  // the model tree
  let seen = 0;
  const visit = (o, parentDef, parentWorld, depth) => {
    if (depth > MAX_DEPTH || ++seen > 200000) return;
    const local = localMatrix(o.props);
    const world = mmul(parentWorld, local);
    const geo = o.children.find((c) => c.type === 'Geometry' && (c.sub === 'Mesh' || child(c.node, 'Vertices')));
    const attr = o.children.find((c) => c.type === 'NodeAttribute');
    if (attr && attr.sub === 'Light') addLight(model, attr, mmul(A, world), report, skip);
    if (attr && attr.sub === 'Camera') addCamera(model, attr, mmul(A, world), report);
    if (geo && child(geo.node, 'Vertices') === null) skip(t('fbx.note.kind', { kind: geo.sub || 'Geometry' }));
    const models = o.children.filter((c) => c.type === 'Model');
    const md = geo ? meshFor(geo, o) : null;
    const g0 = geometricMatrix(o.props);
    const hasGeo = !(g0.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-12));
    if (md && !models.length) {
      const iid = model.place(parentDef, md.id, conj(hasGeo ? mmul(local, g0) : local));
      parentDef.insts.get(iid).name = cleanName(o.name, t('fbx.mesh'));
      uses.set(md.id, (uses.get(md.id) || 0) + 1);
      return;
    }
    if (!md && !models.length) return;
    const g = model.newDef('group', cleanName(o.name, t('fbx.group')));
    report.groups++;
    model.place(parentDef, g.id, conj(local));
    if (md) { model.place(g, md.id, conj(g0)); uses.set(md.id, (uses.get(md.id) || 0) + 1); }
    for (const c of models) visit(c, g, world, depth + 1);
  };
  for (const c of scene.root.children) if (c.type === 'Model') visit(c, top, ident(), 0);
  for (const [, n] of uses) if (n > 1) report.components++;
  return { def: top, report };
}

function buildMesh(geo, paints, A, report, skip) {
  const n = geo.node;
  const V = child(n, 'Vertices')?.props[0];
  const PVI = child(n, 'PolygonVertexIndex')?.props[0];
  if (!V || !PVI || V.length % 3) return null;
  const nv = V.length / 3;
  // polygons: a negative index −(i + 1) ends one
  const fc = [];
  const fi = new Int32Array(PVI.length);
  let start = 0;
  for (let k = 0; k < PVI.length; k++) {
    let v = PVI[k];
    const last = v < 0;
    if (last) v = -v - 1;
    if (!(v >= 0 && v < nv) || !Number.isInteger(v)) throw bad('a polygon corner points past the vertices');
    fi[k] = v;
    if (last) { fc.push(k + 1 - start); start = k + 1; }
  }
  if (start !== PVI.length) skip(t('fbx.note.open_polygon'));
  const corners = start;
  const pts = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) { const q = apply(A, [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]]); pts[i * 3] = q[0]; pts[i * 3 + 1] = q[1]; pts[i * 3 + 2] = q[2]; }
  const flip = det(A) < 0;
  const order = new Int32Array(corners);   // mesh corner → file corner
  const fiw = new Int32Array(corners);
  let o = 0;
  for (let f = 0, s0 = 0; f < fc.length; s0 += fc[f], f++) for (let k = 0; k < fc[f]; k++) { const c = flip ? s0 + fc[f] - 1 - k : s0 + k; order[o] = c; fiw[o++] = fi[c]; }
  const keep = fc.map((c) => c >= 3);
  if (keep.includes(false)) skip(t('fbx.note.small_faces'), keep.filter((x) => !x).length);
  const fck = Int32Array.from(fc.filter((c) => c >= 3));
  const fik = [];
  const ordk = [];
  const faceFile = [];
  for (let f = 0, s0 = 0; f < fc.length; s0 += fc[f], f++) { if (!keep[f]) continue; faceFile.push(f); for (let k = 0; k < fc[f]; k++) { fik.push(fiw[s0 + k]); ordk.push(order[s0 + k]); } }
  if (!fck.length) return null;
  const mesh = new Mesh();
  const { faceOf, cornerOf, dropped } = mesh._bulk(pts, nv, fck, Int32Array.from(fik));
  if (dropped) skip(t('fbx.note.small_faces'), dropped);
  // a layer element's value for (file corner c, file polygon f, control point v)
  const layer = (el, dataName, indexName, size) => {
    if (!el) return null;
    const mapping = String(child(el, 'MappingInformationType')?.props[0] || 'ByPolygonVertex');
    const ref = String(child(el, 'ReferenceInformationType')?.props[0] || 'Direct');
    const data = child(el, dataName)?.props[0];
    const index = ref === 'IndexToDirect' || ref === 'Index' ? child(el, indexName)?.props[0] : null;
    if (!data) return null;
    const count = data.length / size;
    return (c, f, v) => {
      let i = mapping === 'ByPolygonVertex' ? c : mapping === 'ByPolygon' ? f : mapping === 'AllSame' ? 0 : v;   // ByVertice / ByVertex / ByControlPoint
      if (index) i = index[i];
      return i >= 0 && i < count ? data.subarray ? data.subarray(i * size, i * size + size) : null : null;
    };
  };
  const normalAt = layer(child(n, 'LayerElementNormal'), 'Normals', 'NormalsIndex', 3);
  const uvLayers = kids(n, 'LayerElementUV').sort((a, b) => (a.props[0] || 0) - (b.props[0] || 0)).map((el) => layer(el, 'UV', 'UVIndex', 2)).filter(Boolean);
  const colorAt = layer(child(n, 'LayerElementColor'), 'Colors', 'ColorIndex', 4);
  const matEl = child(n, 'LayerElementMaterial');
  const matMapping = String(child(matEl, 'MappingInformationType')?.props[0] || 'AllSame');
  const matData = child(matEl, 'Materials')?.props[0];
  const NR = normalAt ? (mesh.addAttr('normal', 'corner', 3), mesh.attrArray('normal')) : null;
  const UVs = uvLayers.map((_, k) => (mesh.addAttr(k ? 'uv.' + k : 'uv', 'corner', 2), mesh.attrArray(k ? 'uv.' + k : 'uv')));
  const CO = colorAt ? (mesh.addAttr('color', 'corner', 4), mesh.attrArray('color')) : null;
  // file corner → polygon
  const polyOf = new Int32Array(PVI.length);
  for (let f = 0, s0 = 0; f < fc.length; s0 += fc[f], f++) for (let k = 0; k < fc[f]; k++) polyOf[s0 + k] = f;
  for (let k = 0; k < ordk.length; k++) {
    const h = cornerOf[k];
    if (h < 0) continue;
    const c = ordk[k];
    const f = polyOf[c];
    const v = fi[c];
    if (NR) { const q = normalAt(c, f, v); if (q) { const d = norm(applyDir(A, [q[0], q[1], q[2]])); NR[h * 3] = d[0]; NR[h * 3 + 1] = d[1]; NR[h * 3 + 2] = d[2]; } }
    uvLayers.forEach((L, j) => { const q = L(c, f, v); if (q) { UVs[j][h * 2] = q[0]; UVs[j][h * 2 + 1] = q[1]; } });
    if (CO) { const q = colorAt(c, f, v); if (q) for (let m = 0; m < 4; m++) CO[h * 4 + m] = q[m]; }
  }
  // paints by polygon
  faceFile.forEach((f, k) => {
    const mf = faceOf[k];
    if (mf < 0) return;
    const mi = matData ? (matMapping === 'AllSame' ? matData[0] : matData[f]) : 0;
    const p = paints[mi] ?? paints[0];
    if (p) mesh.fMat[mf] = mesh.paintIndex(p);
  });
  // skin: four strongest clusters per control point
  const skin = geo.children.find((c) => c.type === 'Deformer' && c.sub === 'Skin');
  if (skin) {
    report.skins++;
    const lists = Array.from({ length: nv }, () => []);
    skin.children.filter((c) => c.type === 'Deformer' || c.type === 'SubDeformer').forEach((cl, j) => {
      const ix = child(cl.node, 'Indexes')?.props[0];
      const w = child(cl.node, 'Weights')?.props[0];
      if (!ix || !w) return;
      for (let k = 0; k < Math.min(ix.length, w.length); k++) if (ix[k] >= 0 && ix[k] < nv && w[k] > 0) lists[ix[k]].push([j, w[k]]);
    });
    mesh.addAttr('joints', 'vertex', 4, 'i32');
    mesh.addAttr('weights', 'vertex', 4);
    const J = mesh.attrArray('joints');
    const W = mesh.attrArray('weights');
    for (let v = 0; v < Math.min(nv, mesh.nv); v++) {
      const top4 = lists[v].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top4.reduce((s, x) => s + x[1], 0) || 1;
      top4.forEach(([j, w], k) => { J[v * 4 + k] = j; W[v * 4 + k] = w / sum; });
    }
  }
  markSharp(mesh, NR, null);
  return mesh;
}

function addLight(model, attr, M, report, skip) {
  const p = attr.props;
  const type = num(p, 'LightType', 0);
  if (type === 1) { skip(t('fbx.note.directional')); return; }
  if (type > 2) { skip(t('fbx.note.area_light')); return; }
  if (!model.addLight) return;
  const c = vec3(p, 'Color', [1, 1, 1]);
  const hex = '#' + c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
  const dir = norm(applyDir(M, [0, -1, 0]));   // FBX spot lights shine along their own −Y
  model.addLight({ kind: type === 2 ? 'spot' : 'point', p: apply(M, [0, 0, 0]), dir: len(dir) ? dir : [0, 0, -1], color: hex,
    lumens: num(p, 'Intensity', 100) * 8, angle: num(p, 'OuterAngle', num(p, 'Cone angle', 45)), name: attr.name || '' });
  report.lights++;
}

function addCamera(model, attr, M, report) {
  if (!Array.isArray(model.scenes)) return;
  const p = attr.props;
  const eye = apply(M, [0, 0, 0]);
  const fwd = norm(applyDir(M, [1, 0, 0]));   // FBX cameras look along their own +X
  if (!len(fwd)) return;
  const target = [eye[0] + fwd[0] * 10, eye[1] + fwd[1] * 10, eye[2] + fwd[2] * 10];
  const ortho = num(p, 'CameraProjectionType', 0) === 1;
  const s = cleanScene({ name: attr.name || 'Camera', cam: ortho ? { eye, target, persp: false, height: num(p, 'OrthoZoom', 1) * 10 } : { eye, target, persp: true, fov: num(p, 'FieldOfViewY', num(p, 'FieldOfView', 40)) } });   // i18n-ignore: a fallback name
  if (s) { model.scenes.push(s); report.cameras++; }
}
