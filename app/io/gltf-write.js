/* SPDX-License-Identifier: Apache-2.0 */
/**
 * gltf-write.js — ModelCraft → glTF 2.0 binary (.glb), from the Khronos glTF 2.0 specification (0.7 XF.1, session
 * `interchange`). DOM-free. Supersedes io.js's exportGLB for ModelCraft (io.js keeps it: the m3d kernel copies use it).
 *
 *   exportGltf(model, { lights = true, cameras = true }) → { bytes: Uint8Array, report }
 *
 * - One glTF mesh per definition (and placement paint), one node per placement, under a root node that turns Z up into
 *   Y up — components stay shared. Push/pull faces are triangulated with their soft-edge normals; **mesh definitions**
 *   (MD.1) write their own triangles with their corner normals (the `normal` layer, else smooth split at sharp edges),
 *   `uv` → TEXCOORD_0 and `uv.1` → TEXCOORD_1 (v turned back to run down, as glTF reads it), `color` → COLOR_0.
 * - Paints: a colour → baseColorFactor (linear); a library material → its colour; an imported image paint → the image
 *   embedded as baseColorTexture (PNG / JPEG / WebP as stored), with UVs from the face's placement (push/pull) or the
 *   mesh's `uv` layer. Metal 0, roughness 0.9, double-sided (ModelCraft shows both sides). The full material model (RN.2,
 *   OpenPBR → the KHR_materials_* extensions) is written once it exists.
 * - Lamps (on ones) → KHR_lights_punctual point / spot lights (lumens ÷ 4π = candela; a spot's outer cone = half its
 *   angle); area lamps have no punctual equivalent and are counted. Scenes → cameras (perspective: the vertical field of
 *   view; parallel: the view's height).
 */
import { faceTris, faceNormal, smoothNormals, paintHex, isImagePaint, isMaterialPaint, imageId, imageUV } from '../model.js';
import { len, norm, cross, sub } from '../vec.js';
import { t } from '../i18n.js';

const Z2Y = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const isIdent = (m) => m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-12);
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToLinear = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLin(v / 255)); };
const enc = new TextEncoder();

function unb64(s) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const b = atob(s);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

export function exportGltf(model, { lights = true, cameras = true } = {}) {
  const report = { meshes: 0, triangles: 0, materials: 0, textures: 0, lights: 0, cameras: 0, skipped: {} };
  const skip = (k, n = 1) => { report.skipped[k] = (report.skipped[k] || 0) + n; };
  const gltf = {
    asset: { version: '2.0', generator: 'ModelCraft' },   // i18n-ignore: written into the file
    scene: 0, scenes: [{ name: 'Model', nodes: [0] }], nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [],   // i18n-ignore: written into the file
    accessors: [], bufferViews: [], buffers: [], cameras: [], extensionsUsed: [], extensions: {},
  };
  const chunks = [];
  let byteLength = 0;
  const pushView = (bytes, target) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    const v = { buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength };
    if (target) v.target = target;
    gltf.bufferViews.push(v);
    chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    byteLength += bytes.byteLength;
    return gltf.bufferViews.length - 1;
  };
  const accessor = (arr, type, comp, target, minmax = false) => {
    const nc = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const a = { bufferView: pushView(arr, target), componentType: comp, count: arr.length / nc, type };
    if (minmax) {
      const min = new Array(nc).fill(Infinity);
      const max = new Array(nc).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) { const k = i % nc; if (arr[i] < min[k]) min[k] = arr[i]; if (arr[i] > max[k]) max[k] = arr[i]; }
      a.min = min; a.max = max;
    }
    gltf.accessors.push(a);
    return gltf.accessors.length - 1;
  };

  // ---- materials (one per paint) and textures (one per image)
  const texOf = new Map();
  const texture = (id) => {
    if (texOf.has(id)) return texOf.get(id);
    const im = model.images?.get(id);
    let ti = null;
    if (im && /^image\/(png|jpeg|webp)$/.test(im.mime)) {
      if (!gltf.samplers.length) gltf.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
      gltf.images.push({ name: im.name || id, mimeType: im.mime, bufferView: pushView(unb64(im.data)) });
      if (im.mime === 'image/webp') { if (!gltf.extensionsUsed.includes('EXT_texture_webp')) gltf.extensionsUsed.push('EXT_texture_webp'); gltf.textures.push({ sampler: 0, extensions: { EXT_texture_webp: { source: gltf.images.length - 1 } } }); }
      else gltf.textures.push({ sampler: 0, source: gltf.images.length - 1 });
      ti = gltf.textures.length - 1;
      report.textures++;
    }
    texOf.set(id, ti);
    return ti;
  };
  const matOf = new Map();
  const material = (paint) => {
    const k = paint || '';
    if (matOf.has(k)) return matOf.get(k);
    const pbr = { metallicFactor: 0, roughnessFactor: 0.9 };
    let name = 'Default';   // i18n-ignore: written into the file
    if (paint && isImagePaint(paint)) {
      const ti = texture(imageId(paint));
      if (ti !== null) { pbr.baseColorTexture = { index: ti }; name = 'Texture ' + (model.images.get(imageId(paint))?.name || imageId(paint)); }   // i18n-ignore: written into the file
      else { pbr.baseColorFactor = [...hexToLinear(paintHex(paint)), 1]; name = 'Colour ' + paintHex(paint); }   // i18n-ignore: written into the file
    } else if (paint) {
      pbr.baseColorFactor = [...hexToLinear(paintHex(paint)), 1];
      name = isMaterialPaint(paint) ? 'Material ' + paint.slice(4) : 'Colour ' + paint;   // i18n-ignore: written into the file
    }
    gltf.materials.push({ name, pbrMetallicRoughness: pbr, doubleSided: true });
    matOf.set(k, gltf.materials.length - 1);
    report.materials++;
    return gltf.materials.length - 1;
  };

  // ---- one primitive from flat corner lists
  const primitive = (b, paint) => {
    const n = b.pos.length / 3;
    const attributes = { POSITION: accessor(Float32Array.from(b.pos), 'VEC3', 5126, 34962, true), NORMAL: accessor(Float32Array.from(b.nor), 'VEC3', 5126, 34962) };
    if (b.uv && b.uv.length === n * 2) attributes.TEXCOORD_0 = accessor(Float32Array.from(b.uv), 'VEC2', 5126, 34962);
    if (b.uv1 && b.uv1.length === n * 2) attributes.TEXCOORD_1 = accessor(Float32Array.from(b.uv1), 'VEC2', 5126, 34962);
    if (b.col && b.col.length === n * 4) attributes.COLOR_0 = accessor(Float32Array.from(b.col), 'VEC4', 5126, 34962);
    const idx = n > 65535 ? Uint32Array.from(b.idx) : Uint16Array.from(b.idx);
    report.triangles += b.idx.length / 3;
    return { attributes, indices: accessor(idx, 'SCALAR', n > 65535 ? 5125 : 5123, 34963), material: material(paint), mode: 4 };
  };
  /** Corner lists that share a vertex where every attribute is the same. */
  const bucket = () => ({ pos: [], nor: [], uv: null, uv1: null, col: null, idx: [], keys: new Map() });
  const corner = (b, p, n, uv, uv1, col) => {
    const k = p[0] + ',' + p[1] + ',' + p[2] + '|' + n[0].toFixed(5) + ',' + n[1].toFixed(5) + ',' + n[2].toFixed(5) + (uv ? '|' + uv[0] + ',' + uv[1] : '') + (uv1 ? '|' + uv1[0] + ',' + uv1[1] : '') + (col ? '|' + col.join(',') : '');
    let i = b.keys.get(k);
    if (i === undefined) {
      i = b.pos.length / 3;
      b.keys.set(k, i);
      b.pos.push(p[0], p[1], p[2]);
      b.nor.push(n[0], n[1], n[2]);
      if (uv) (b.uv ??= []).push(uv[0], 1 - uv[1]);
      if (uv1) (b.uv1 ??= []).push(uv1[0], 1 - uv1[1]);
      if (col) (b.col ??= []).push(col[0], col[1], col[2], col[3]);
    }
    b.idx.push(i);
  };

  const meshOf = new Map();
  const meshFor = (def, dflt) => {
    const key = def.id + '|' + (dflt || '');
    if (meshOf.has(key)) return meshOf.get(key);
    const byPaint = new Map();
    const B = (paint) => { const k = paint || ''; if (!byPaint.has(k)) byPaint.set(k, { paint, b: bucket() }); return byPaint.get(k).b; };
    if (def.mesh) {
      const M = def.mesh;
      const { tri, face } = M.triangulate({ hidden: false });
      const N = M.cornerNormals();
      const UV = M.attrArray('uv');
      const UV1 = M.attrArray('uv.1');
      const COL = M.attrArray('color');
      const P = M.P; const hV = M.hV;
      for (let k = 0; k < tri.length; k += 3) {
        const f = face[k / 3];
        const paint = M.facePaint(f) || dflt || null;
        const b = B(paint);
        const img = paint && isImagePaint(paint);
        for (let q = 0; q < 3; q++) {
          const h = tri[k + q];
          const v = hV[h];
          const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
          const uv = UV ? [UV[h * 2], UV[h * 2 + 1]] : img ? imageUV(paint, p) : null;
          corner(b, p, [N[h * 3], N[h * 3 + 1], N[h * 3 + 2]], uv, UV1 ? [UV1[h * 2], UV1[h * 2 + 1]] : null, COL ? [COL[h * 4], COL[h * 4 + 1], COL[h * 4 + 2], COL[h * 4 + 3]] : null);
        }
      }
    } else {
      const smooth = smoothNormals(def);
      for (const [fid, f] of def.faces) {
        const n = faceNormal(def, f);
        if (!len(n)) continue;
        const paint = f.color || dflt || null;
        const img = paint && isImagePaint(paint);
        const b = B(paint);
        for (const tr of faceTris(def, f)) {
          const ps = tr.map((v) => def.verts.get(v));
          if (!(len(cross(sub(ps[1], ps[0]), sub(ps[2], ps[0]))) > 1e-18)) continue;
          tr.forEach((v, q) => corner(b, ps[q], smooth.get(fid + '|' + v) || n, img ? imageUV(paint, ps[q]) : null, null, null));
        }
      }
    }
    const prims = [];
    for (const { paint, b } of byPaint.values()) if (b.idx.length) prims.push(primitive(b, paint));
    if (!prims.length) { meshOf.set(key, null); return null; }
    gltf.meshes.push({ name: def.name || 'Mesh', primitives: prims });   // i18n-ignore: written into the file
    report.meshes++;
    meshOf.set(key, gltf.meshes.length - 1);
    return gltf.meshes.length - 1;
  };
  const nodeFor = (def, m, name, depth, dflt = null) => {
    const node = { name: name || def.name || 'Node' };   // i18n-ignore: written into the file
    if (m && !isIdent(m)) node.matrix = m.map((v) => (Math.abs(v) < 1e-15 ? 0 : v));
    gltf.nodes.push(node);
    const i = gltf.nodes.length - 1;
    const mesh = meshFor(def, dflt);
    if (mesh !== null) node.mesh = mesh;
    if (depth < 64) {
      const kids = [];
      for (const inst of def.insts.values()) {
        if (inst.hidden) continue;
        const d = model.defs.get(inst.def);
        if (d) kids.push(nodeFor(d, inst.m, inst.name || d.name, depth + 1, inst.color || dflt));
      }
      if (kids.length) node.children = kids;
    }
    return i;
  };
  gltf.nodes.push({ name: 'ModelCraft (Z up → Y up)', matrix: Z2Y, children: [] });   // i18n-ignore: written into the file
  gltf.nodes[0].children.push(nodeFor(model.root, null, model.root.name || 'Model', 0));   // i18n-ignore: written into the file

  // ---- lamps
  if (lights && model.lights?.size) {
    const list = [];
    for (const L of model.lights.values()) {
      if (L.on === false) { skip(t('gltf.note.lamp_off')); continue; }
      if (L.kind === 'area') { skip(t('gltf.note.area_lamp')); continue; }
      const light = { name: L.name || (L.kind === 'spot' ? 'Spot' : 'Lamp'), type: L.kind === 'spot' ? 'spot' : 'point', color: hexToLinear(L.color), intensity: L.lumens / (4 * Math.PI) };   // i18n-ignore: written into the file
      if (L.kind === 'spot') light.spot = { innerConeAngle: 0, outerConeAngle: Math.min(Math.PI / 2, (L.angle * Math.PI) / 360) };
      list.push(light);
      gltf.nodes.push({ name: light.name, matrix: aim(L.p, L.dir), extensions: { KHR_lights_punctual: { light: list.length - 1 } } });
      gltf.nodes[0].children.push(gltf.nodes.length - 1);
      report.lights++;
    }
    if (list.length) { gltf.extensionsUsed.push('KHR_lights_punctual'); gltf.extensions.KHR_lights_punctual = { lights: list }; }
  }
  // ---- scenes as cameras
  if (cameras && Array.isArray(model.scenes)) {
    for (const s of model.scenes) {
      const c = s.cam;
      const d = sub(c.target, c.eye);
      if (!(len(d) > 1e-9)) continue;
      const cam = c.persp !== false
        ? { name: s.name, type: 'perspective', perspective: { yfov: (c.fov * Math.PI) / 180, znear: 0.05 } }
        : { name: s.name, type: 'orthographic', orthographic: { xmag: c.height / 2, ymag: c.height / 2, znear: 0.05, zfar: 1e5 } };
      gltf.cameras.push(cam);
      gltf.nodes.push({ name: s.name, matrix: aim(c.eye, d), camera: gltf.cameras.length - 1 });
      gltf.nodes[0].children.push(gltf.nodes.length - 1);
      report.cameras++;
    }
  }

  for (const k of ['materials', 'textures', 'images', 'samplers', 'cameras', 'meshes', 'extensionsUsed']) if (!gltf[k].length) delete gltf[k];
  if (!Object.keys(gltf.extensions).length) delete gltf.extensions;
  if (!byteLength) { delete gltf.accessors; delete gltf.bufferViews; delete gltf.buffers; }
  else gltf.buffers.push({ byteLength });
  if (!gltf.accessors?.length) delete gltf.accessors;
  return { bytes: glb(gltf, chunks, byteLength), report };
}

/** A node matrix (Z-up model coordinates) at `p` whose −Z looks along `dir` and whose +Y is as near world up (+Z) as it can be. */
function aim(p, dir) {
  const f = norm(dir);
  let up = [0, 0, 1];
  if (Math.abs(f[2]) > 0.999) up = [0, 1, 0];
  const r = norm(cross(f, up));
  const u = cross(r, f);
  return [r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, -f[0], -f[1], -f[2], 0, p[0], p[1], p[2], 1].map((v) => (Math.abs(v) < 1e-15 ? 0 : v));
}

function glb(gltf, chunks, byteLength) {
  const json = enc.encode(JSON.stringify(gltf));
  const jpad = (4 - (json.length % 4)) % 4;
  const jsonChunk = new Uint8Array(json.length + jpad).fill(0x20);
  jsonChunk.set(json);
  const binPad = (4 - (byteLength % 4)) % 4;
  const binLen = byteLength + binPad;
  const total = 12 + 8 + jsonChunk.length + (byteLength ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  if (byteLength) {
    let o = 20 + jsonChunk.length;
    dv.setUint32(o, binLen, true); dv.setUint32(o + 4, 0x004e4942, true);
    o += 8;
    for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  }
  return out;
}
