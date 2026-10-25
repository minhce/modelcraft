/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file: what a person reads goes through t() (gltf.* keys); the rest is internal diagnostics and glTF names. */
/**
 * gltf-read.js — glTF 2.0 into one plain scene, from the Khronos glTF 2.0 specification and the ratified extensions'
 * own specifications (0.7 XF.1, session `interchange`). DOM-free; no three.js. The file is untrusted: every index,
 * offset, stride and count is checked against what it points at, sizes are capped (LIMITS), nothing is evaluated.
 *
 *   const scene = await readGltf(bytes, { resolve, draco, meshopt, limits })
 *     bytes    .glb or .gltf (JSON) bytes
 *     resolve  async (uri) → Uint8Array | null   — external buffers and images of a .gltf (null: not there)
 *     draco    async (bytes, attrs {NAME: uniqueId}, kinds {NAME: 'f32' | 'u16'}) → { indices: Uint32Array, points,
 *              attrs {NAME: {data, nc}} } — KHR_draco_mesh_compression (see draco.js); absent → such files are refused
 *     meshopt  async () → MeshoptDecoder (meshopt_decoder.mjs) — EXT/KHR_meshopt_compression; absent → refused
 *
 * The scene stays in glTF's own terms: metres, Y up, column-major matrices, linear colours. gltf-import.js turns it into
 * ModelCraft definitions. Shape (every array may be empty):
 *   { asset {version, generator, copyright}, extensionsUsed, extensionsRequired, scene (index), scenes [{name, nodes}],
 *     nodes [{name, matrix (16), mesh, camera, light, skin, children, weights, instances: {t, r, s} | null}],
 *     meshes [{name, weights, primitives [Primitive]}], materials [Material], textures [{image, sampler}],
 *     images [{name, mime, bytes} | null], samplers [{magFilter, minFilter, wrapS, wrapT}],
 *     cameras [{name, type, yfov, aspect, znear, zfar, xmag, ymag}], lights [{name, type, color, intensity, range, inner,
 *     outer}], skins [{name, joints, ibm: Float32Array | null, skeleton}], animations [{name, channels [{node, path,
 *     sampler}], samplers [{input: Float32Array, output: Float32Array, interpolation, size}]}], notes {what: count} }
 *   Primitive = { mode, material, positions: Float32Array, normals, tangents, uvs [Float32Array…] (TEXCOORD_n),
 *     colors [Float32Array RGBA…], joints [Uint16Array ×4…], weights [Float32Array ×4…], indices: Uint32Array | null,
 *     count (vertices), targets [{positions, normals, tangents}], draco: bool }
 *   Material = { name, baseColor [4], baseColorTex: TexRef | null, metallic, roughness, metallicRoughnessTex, normalTex,
 *     normalScale, occlusionTex, occlusionStrength, emissive [3], emissiveTex, emissiveStrength, alphaMode, alphaCutoff,
 *     doubleSided, unlit, ior, transmission, transmissionTex, volume {thickness, thicknessTex, attenuationDistance,
 *     attenuationColor} | null, clearcoat {factor, tex, roughness, roughnessTex, normalTex} | null, sheen {color, colorTex,
 *     roughness, roughnessTex} | null, specular {factor, tex, color, colorTex} | null, iridescence {…} | null, anisotropy
 *     {strength, rotation, tex} | null, dispersion }
 *   TexRef = { texture, texCoord, scale | strength, transform: {offset [2], rotation, scale [2]} | null }
 * Errors: GltfError(code, message) — not_gltf | damaged | too_big | unsupported | missing (an external file not given).
 */
import { t } from '../i18n.js';

export class GltfError extends Error {
  constructor(code, message) { super(message); this.name = 'GltfError'; this.code = code; }
}

export const LIMITS = {
  numbers: 1 << 27,       // every number read from accessors together (≈ 512 MB as floats)
  accessor: 1 << 26,      // one accessor's numbers
  nodes: 200000,
  meshes: 50000,
  primitives: 100000,
  materials: 20000,
  images: 4096,
  imageBytes: 1 << 28,
  animations: 4096,
  depth: 128,
};

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMP = { 5120: [1, 'getInt8', Int8Array], 5121: [1, 'getUint8', Uint8Array], 5122: [2, 'getInt16', Int16Array], 5123: [2, 'getUint16', Uint16Array], 5125: [4, 'getUint32', Uint32Array], 5126: [4, 'getFloat32', Float32Array] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
/** Extensions this reader understands (others listed as required make the file refused, as the spec asks). */
export const SUPPORTED = new Set(['KHR_materials_pbrSpecularGlossiness', 'KHR_materials_unlit', 'KHR_materials_emissive_strength',
  'KHR_materials_ior', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_clearcoat', 'KHR_materials_sheen',
  'KHR_materials_specular', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion',
  'KHR_materials_variants', 'KHR_texture_transform', 'KHR_lights_punctual', 'KHR_mesh_quantization', 'EXT_mesh_gpu_instancing',
  'KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression', 'EXT_texture_webp']);

/** Metadata extensions: nothing to read for the model, nothing to say. */
const METADATA = new Set(['KHR_xmp', 'KHR_xmp_json_ld']);

const dec = new TextDecoder();
const damaged = (why) => new GltfError('damaged', t('gltf.damaged', { why }));
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const vec = (x, n, d) => (Array.isArray(x) && x.length === n && x.every((v) => typeof v === 'number' && Number.isFinite(v)) ? x.slice() : d.slice());
const idx = (x, n) => (Number.isInteger(x) && x >= 0 && x < n ? x : null);
const str = (x, max = 200) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');

function base64(s) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const b = atob(s.replace(/\s+/g, ''));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

/** A data: URI → bytes, or null when it isn't one. */
function dataUri(uri) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  return m[2] ? base64(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
}

export function sniffImage(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[0] === 0xab && b[1] === 0x4b && b[2] === 0x54 && b[3] === 0x58) return 'image/ktx2';
  return null;
}

/** Split a .glb into its JSON and binary chunk, or read a .gltf's JSON. */
export function parseContainer(u8) {
  let json = null;
  let bin = null;
  if (u8.length >= 12 && new DataView(u8.buffer, u8.byteOffset, 12).getUint32(0, true) === GLB_MAGIC) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint32(4, true) !== 2) throw new GltfError('unsupported', t('gltf.version', { version: dv.getUint32(4, true) }));
    const total = Math.min(dv.getUint32(8, true), u8.length);
    let o = 12;
    let first = true;
    while (o + 8 <= total) {
      const len = dv.getUint32(o, true);
      const type = dv.getUint32(o + 4, true);
      if (o + 8 + len > total) throw damaged('a chunk runs past the end');
      const data = u8.subarray(o + 8, o + 8 + len);
      if (first && type !== CHUNK_JSON) throw damaged('the first chunk is not JSON');
      if (type === CHUNK_JSON && !json) { try { json = JSON.parse(dec.decode(data)); } catch { throw damaged('its JSON is broken'); } }
      else if (type === CHUNK_BIN && !bin) bin = data;
      first = false;
      o += 8 + len;
    }
    if (!json) throw damaged('no JSON chunk');
  } else {
    let text = dec.decode(u8);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!/^\s*\{/.test(text)) throw new GltfError('not_gltf', t('gltf.not_gltf'));
    try { json = JSON.parse(text); } catch { throw damaged('its JSON is broken'); }
  }
  if (!isObj(json) || !isObj(json.asset) || String(json.asset.version || '').split('.')[0] !== '2') {
    throw new GltfError('unsupported', t('gltf.version', { version: isObj(json?.asset) ? String(json.asset.version).slice(0, 10) : '?' }));
  }
  return { json, bin };
}

export async function readGltf(input, opts = {}) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const L = { ...LIMITS, ...(opts.limits || {}) };
  const { json, bin } = parseContainer(u8);
  const notes = {};
  const note = (k, n = 1) => { notes[k] = (notes[k] || 0) + n; };
  const used = arr(json.extensionsUsed).filter((x) => typeof x === 'string');
  const required = arr(json.extensionsRequired).filter((x) => typeof x === 'string');
  for (const e of required) {
    if (!SUPPORTED.has(e)) throw new GltfError('unsupported', t('gltf.extension', { name: str(e, 80) }));
    if (e === 'KHR_draco_mesh_compression' && !opts.draco) throw new GltfError('unsupported', t('gltf.extension', { name: e }));
    if ((e === 'EXT_meshopt_compression' || e === 'KHR_meshopt_compression') && !opts.meshopt) throw new GltfError('unsupported', t('gltf.extension', { name: e }));
  }
  for (const e of used) if (!SUPPORTED.has(e) && !METADATA.has(e)) note(t('gltf.note.extension', { name: str(e, 80) }));

  // ---- buffers
  const buffers = [];
  for (const [i, b] of arr(json.buffers).entries()) {
    if (!isObj(b)) throw damaged('buffer ' + i + ' is not an object');
    const want = b.byteLength;
    let data = null;
    const fallback = b.extensions?.EXT_meshopt_compression?.fallback === true || b.extensions?.KHR_meshopt_compression?.fallback === true;
    if (b.uri === undefined && fallback && !(i === 0 && bin)) {
      // a meshopt fallback buffer holds nothing: every view on it is unpacked from its compressed copy below
      if (!Number.isInteger(want) || want < 0 || want > L.accessor * 4) throw new GltfError('too_big', t('gltf.too_big'));
      data = new Uint8Array(want);
    } else if (b.uri === undefined) {
      if (i !== 0 || !bin) throw damaged('buffer ' + i + ' has no data');
      data = bin;
    } else if (typeof b.uri === 'string') {
      data = dataUri(b.uri);
      if (!data) {
        if (!opts.resolve) throw new GltfError('missing', t('gltf.missing', { file: str(b.uri, 120) }));
        data = await opts.resolve(safeUri(b.uri));
        if (!data) throw new GltfError('missing', t('gltf.missing', { file: str(b.uri, 120) }));
      }
    } else throw damaged('buffer ' + i + ' has a bad uri');
    if (!Number.isInteger(want) || want < 0 || data.length < want) throw damaged('buffer ' + i + ' is shorter than it says');
    buffers.push(data.subarray(0, want));
  }

  // ---- buffer views (meshopt-compressed ones are unpacked here, before any accessor reads them)
  const viewsIn = arr(json.bufferViews);
  const views = viewsIn.map((v, i) => {
    if (!isObj(v)) throw damaged('buffer view ' + i + ' is not an object');
    const buf = buffers[idx(v.buffer, buffers.length)];
    const off = v.byteOffset ?? 0;
    const len = v.byteLength;
    if (!buf || !Number.isInteger(off) || !Number.isInteger(len) || off < 0 || len < 0 || off + len > buf.length) throw damaged('buffer view ' + i + ' runs past its buffer');
    const stride = v.byteStride;
    if (stride !== undefined && !(Number.isInteger(stride) && stride >= 4 && stride <= 252 && stride % 4 === 0)) throw damaged('buffer view ' + i + ' has a bad stride');
    return { bytes: buf.subarray(off, off + len), stride: stride ?? 0, ext: v.extensions };
  });
  let meshopt = null;
  for (const [i, v] of views.entries()) {
    const mx = v.ext?.EXT_meshopt_compression || v.ext?.KHR_meshopt_compression;
    if (!isObj(mx)) continue;
    if (!opts.meshopt) throw new GltfError('unsupported', t('gltf.extension', { name: 'EXT_meshopt_compression' }));
    meshopt ??= await opts.meshopt();
    if (meshopt.ready) await meshopt.ready;
    const src = buffers[idx(mx.buffer, buffers.length)];
    const off = mx.byteOffset ?? 0;
    const { byteLength: len, byteStride: stride, count } = mx;
    if (!src || !Number.isInteger(off) || !Number.isInteger(len) || off < 0 || off + len > src.length
      || !Number.isInteger(stride) || stride < 1 || stride > 256 || !Number.isInteger(count) || count < 0 || count * stride > L.accessor * 4) throw damaged('buffer view ' + i + ' has a broken meshopt block');
    const mode = { ATTRIBUTES: 'ATTRIBUTES', TRIANGLES: 'TRIANGLES', INDICES: 'INDICES' }[mx.mode];
    const filter = { NONE: 'NONE', OCTAHEDRAL: 'OCTAHEDRAL', QUATERNION: 'QUATERNION', EXPONENTIAL: 'EXPONENTIAL', COLOR: 'COLOR' }[mx.filter ?? 'NONE'];
    if (!mode || !filter) throw damaged('buffer view ' + i + ' names an unknown meshopt mode');
    const out = new Uint8Array(count * stride);
    try { meshopt.decodeGltfBuffer(out, count, stride, src.subarray(off, off + len), mode, filter); } catch (e) { throw damaged('a meshopt block does not unpack (' + String(e?.message || e).slice(0, 80) + ')'); }
    v.bytes = out;
    v.stride = viewsIn[i].byteStride ?? 0;
  }

  // ---- accessors
  const accIn = arr(json.accessors);
  let budget = L.numbers;
  const accCache = new Map();
  /** → { data: TypedArray (Float32Array when float or normalized), count, nc, type, componentType, normalized } */
  const accessor = (ai, what = 'an accessor') => {
    if (accCache.has(ai)) return accCache.get(ai);
    const a = accIn[ai];
    if (!isObj(a)) throw damaged(what + ' names a missing accessor');
    const ct = COMP[a.componentType];
    const nc = NCOMP[a.type];
    if (!ct || !nc) throw damaged('accessor ' + ai + ' has an unknown type');
    const count = a.count;
    if (!Number.isInteger(count) || count < 1) throw damaged('accessor ' + ai + ' has a bad count');
    const n = count * nc;
    if (n > L.accessor) throw new GltfError('too_big', t('gltf.too_big'));
    budget -= n;
    if (budget < 0) throw new GltfError('too_big', t('gltf.too_big'));
    const [size, getter, Arr] = ct;
    const norm = a.normalized === true && a.componentType !== 5126 && a.componentType !== 5125;
    const out = norm || a.componentType === 5126 ? new Float32Array(n) : new Arr(n);
    const scale = !norm ? 1 : { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType];
    const signed = a.componentType === 5120 || a.componentType === 5122;
    // matrix columns of 1- and 2-byte components start on 4-byte boundaries
    const rows = a.type === 'MAT2' ? 2 : a.type === 'MAT3' ? 3 : a.type === 'MAT4' ? 4 : nc;
    const cols = nc / rows;
    const colBytes = (a.type === 'MAT2' && size === 1) || (a.type === 'MAT3' && size <= 2) ? Math.ceil(rows * size / 4) * 4 : rows * size;
    const elBytes = cols * colBytes;
    const readInto = (bytes, stride, off, cnt, put) => {
      const st = stride || elBytes;
      if (!Number.isInteger(off) || off < 0 || off % size || (cnt && off + st * (cnt - 1) + elBytes > bytes.length)) throw damaged('accessor ' + ai + ' runs past its buffer view');
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < cnt; i++) {
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
          let v = dv[getter](off + i * st + c * colBytes + r * size, true);
          if (norm) v = signed ? Math.max(v / scale, -1) : v / scale;
          put(i, c * rows + r, v);
        }
      }
    };
    if (a.bufferView !== undefined) {
      const v = views[idx(a.bufferView, views.length)];
      if (!v) throw damaged('accessor ' + ai + ' names a missing buffer view');
      readInto(v.bytes, v.stride, a.byteOffset ?? 0, count, (i, k, val) => { out[i * nc + k] = val; });
    }
    if (a.sparse !== undefined) {
      const s = a.sparse;
      if (!isObj(s) || !Number.isInteger(s.count) || s.count < 1 || s.count > count || !isObj(s.indices) || !isObj(s.values)) throw damaged('accessor ' + ai + ' has a broken sparse part');
      const it = COMP[s.indices.componentType];
      if (!it || ![5121, 5123, 5125].includes(s.indices.componentType)) throw damaged('accessor ' + ai + ' has bad sparse indices');
      const iv = views[idx(s.indices.bufferView, views.length)];
      const vv = views[idx(s.values.bufferView, views.length)];
      if (!iv || !vv) throw damaged('accessor ' + ai + ' sparse part names a missing buffer view');
      const io = s.indices.byteOffset ?? 0;
      if (!Number.isInteger(io) || io < 0 || io + s.count * it[0] > iv.bytes.length) throw damaged('accessor ' + ai + ' sparse indices run past their view');
      const idv = new DataView(iv.bytes.buffer, iv.bytes.byteOffset, iv.bytes.byteLength);
      const at = new Uint32Array(s.count);
      for (let i = 0; i < s.count; i++) {
        at[i] = idv[it[1]](io + i * it[0], true);
        if (at[i] >= count || (i && at[i] <= at[i - 1])) throw damaged('accessor ' + ai + ' sparse indices are out of order or range');
      }
      readInto(vv.bytes, 0, s.values.byteOffset ?? 0, s.count, (i, k, val) => { out[at[i] * nc + k] = val; });
    }
    const r = { data: out, count, nc, type: a.type, componentType: a.componentType, normalized: norm };
    accCache.set(ai, r);
    return r;
  };
  const floats = (r) => (r.data instanceof Float32Array ? r.data : Float32Array.from(r.data));

  // ---- images, samplers, textures
  const images = [];
  let imageBytes = 0;
  for (const [i, im] of arr(json.images).slice(0, L.images).entries()) {
    let bytes = null;
    if (!isObj(im)) { images.push(null); continue; }
    if (im.bufferView !== undefined) bytes = views[idx(im.bufferView, views.length)]?.bytes ?? null;
    else if (typeof im.uri === 'string') {
      bytes = dataUri(im.uri);
      if (!bytes && opts.resolve) bytes = await opts.resolve(safeUri(im.uri));
      if (!bytes) note(t('gltf.note.image_missing'));
    }
    const mime = sniffImage(bytes);
    if (bytes && !mime) note(t('gltf.note.image_kind'));
    if (mime === 'image/ktx2') note(t('gltf.note.ktx2'));
    imageBytes += bytes ? bytes.length : 0;
    if (imageBytes > L.imageBytes) throw new GltfError('too_big', t('gltf.too_big'));
    images.push(bytes && mime && mime !== 'image/ktx2' ? { name: str(im.name, 120) || 'image ' + i, mime, bytes } : null);
  }
  const samplers = arr(json.samplers).map((s) => ({
    magFilter: isObj(s) ? s.magFilter ?? null : null, minFilter: isObj(s) ? s.minFilter ?? null : null,
    wrapS: isObj(s) ? num(s.wrapS, 10497) : 10497, wrapT: isObj(s) ? num(s.wrapT, 10497) : 10497,
  }));
  const textures = arr(json.textures).map((tx) => {
    if (!isObj(tx)) return { image: null, sampler: null };
    let src = tx.source;
    if (isObj(tx.extensions?.EXT_texture_webp)) src = tx.extensions.EXT_texture_webp.source;
    else if (isObj(tx.extensions?.KHR_texture_basisu) && src === undefined) note(t('gltf.note.ktx2'));
    return { image: idx(src, images.length), sampler: idx(tx.sampler, samplers.length) };
  });
  const texRef = (ti, extra) => {
    if (!isObj(ti)) return null;
    const ti2 = idx(ti.index, textures.length);
    if (ti2 === null) return null;
    const tt = ti.extensions?.KHR_texture_transform;
    const transform = isObj(tt) ? { offset: vec(tt.offset, 2, [0, 0]), rotation: num(tt.rotation, 0), scale: vec(tt.scale, 2, [1, 1]) } : null;
    const texCoord = isObj(tt) && Number.isInteger(tt.texCoord) ? tt.texCoord : Number.isInteger(ti.texCoord) ? ti.texCoord : 0;
    const r = { texture: ti2, texCoord: Math.min(7, Math.max(0, texCoord)), transform };
    if (extra === 'scale') r.scale = num(ti.scale, 1);
    if (extra === 'strength') r.strength = num(ti.strength, 1);
    return r;
  };

  // ---- materials
  const materials = arr(json.materials).slice(0, L.materials).map((m, i) => {
    m = isObj(m) ? m : {};
    const p = isObj(m.pbrMetallicRoughness) ? m.pbrMetallicRoughness : {};
    const x = isObj(m.extensions) ? m.extensions : {};
    const mat = {
      name: str(m.name, 120) || 'Material ' + i,
      baseColor: vec(p.baseColorFactor, 4, [1, 1, 1, 1]), baseColorTex: texRef(p.baseColorTexture),
      metallic: num(p.metallicFactor, 1), roughness: num(p.roughnessFactor, 1), metallicRoughnessTex: texRef(p.metallicRoughnessTexture),
      normalTex: texRef(m.normalTexture, 'scale'), occlusionTex: texRef(m.occlusionTexture, 'strength'),
      emissive: vec(m.emissiveFactor, 3, [0, 0, 0]), emissiveTex: texRef(m.emissiveTexture), emissiveStrength: 1,
      alphaMode: ['OPAQUE', 'MASK', 'BLEND'].includes(m.alphaMode) ? m.alphaMode : 'OPAQUE', alphaCutoff: num(m.alphaCutoff, 0.5),
      doubleSided: m.doubleSided === true, unlit: isObj(x.KHR_materials_unlit), ior: 1.5, transmission: 0, transmissionTex: null,
      volume: null, clearcoat: null, sheen: null, specular: null, iridescence: null, anisotropy: null, dispersion: 0,
    };
    const sg = x.KHR_materials_pbrSpecularGlossiness;
    if (isObj(sg)) {   // archived extension: kept as the closest metal/rough reading
      mat.baseColor = vec(sg.diffuseFactor, 4, [1, 1, 1, 1]);
      mat.baseColorTex = texRef(sg.diffuseTexture);
      mat.metallic = 0;
      mat.roughness = 1 - num(sg.glossinessFactor, 1);
      mat.specular = { factor: 1, tex: null, color: vec(sg.specularFactor, 3, [1, 1, 1]), colorTex: texRef(sg.specularGlossinessTexture) };
    }
    if (isObj(x.KHR_materials_emissive_strength)) mat.emissiveStrength = Math.max(0, num(x.KHR_materials_emissive_strength.emissiveStrength, 1));
    if (isObj(x.KHR_materials_ior)) mat.ior = num(x.KHR_materials_ior.ior, 1.5);
    if (isObj(x.KHR_materials_transmission)) { mat.transmission = num(x.KHR_materials_transmission.transmissionFactor, 0); mat.transmissionTex = texRef(x.KHR_materials_transmission.transmissionTexture); }
    const vo = x.KHR_materials_volume;
    if (isObj(vo)) mat.volume = { thickness: num(vo.thicknessFactor, 0), thicknessTex: texRef(vo.thicknessTexture), attenuationDistance: num(vo.attenuationDistance, Infinity), attenuationColor: vec(vo.attenuationColor, 3, [1, 1, 1]) };
    const cc = x.KHR_materials_clearcoat;
    if (isObj(cc)) mat.clearcoat = { factor: num(cc.clearcoatFactor, 0), tex: texRef(cc.clearcoatTexture), roughness: num(cc.clearcoatRoughnessFactor, 0), roughnessTex: texRef(cc.clearcoatRoughnessTexture), normalTex: texRef(cc.clearcoatNormalTexture, 'scale') };
    const sh = x.KHR_materials_sheen;
    if (isObj(sh)) mat.sheen = { color: vec(sh.sheenColorFactor, 3, [0, 0, 0]), colorTex: texRef(sh.sheenColorTexture), roughness: num(sh.sheenRoughnessFactor, 0), roughnessTex: texRef(sh.sheenRoughnessTexture) };
    const sp = x.KHR_materials_specular;
    if (isObj(sp)) mat.specular = { factor: num(sp.specularFactor, 1), tex: texRef(sp.specularTexture), color: vec(sp.specularColorFactor, 3, [1, 1, 1]), colorTex: texRef(sp.specularColorTexture) };
    const ir = x.KHR_materials_iridescence;
    if (isObj(ir)) mat.iridescence = { factor: num(ir.iridescenceFactor, 0), tex: texRef(ir.iridescenceTexture), ior: num(ir.iridescenceIor, 1.3), thicknessMin: num(ir.iridescenceThicknessMinimum, 100), thicknessMax: num(ir.iridescenceThicknessMaximum, 400), thicknessTex: texRef(ir.iridescenceThicknessTexture) };
    const an = x.KHR_materials_anisotropy;
    if (isObj(an)) mat.anisotropy = { strength: num(an.anisotropyStrength, 0), rotation: num(an.anisotropyRotation, 0), tex: texRef(an.anisotropyTexture) };
    if (isObj(x.KHR_materials_dispersion)) mat.dispersion = Math.max(0, num(x.KHR_materials_dispersion.dispersion, 0));
    if (isObj(x.KHR_materials_variants)) note(t('gltf.note.variants'));
    return mat;
  });

  // ---- meshes
  const meshesIn = arr(json.meshes);
  if (meshesIn.length > L.meshes) throw new GltfError('too_big', t('gltf.too_big'));
  let prims = 0;
  const meshes = [];
  for (const [mi, m] of meshesIn.entries()) {
    if (!isObj(m)) { meshes.push({ name: 'Mesh ' + mi, weights: [], primitives: [] }); continue; }
    const out = { name: str(m.name, 120) || 'Mesh ' + mi, weights: arr(m.weights).map((w) => num(w, 0)), primitives: [] };
    for (const p of arr(m.primitives)) {
      if (++prims > L.primitives) throw new GltfError('too_big', t('gltf.too_big'));
      if (!isObj(p) || !isObj(p.attributes)) throw damaged('mesh ' + mi + ' has a broken primitive');
      const mode = p.mode ?? 4;
      if (!Number.isInteger(mode) || mode < 0 || mode > 6) throw damaged('mesh ' + mi + ' has an unknown primitive mode');
      const prim = { mode, material: idx(p.material, materials.length), positions: null, normals: null, tangents: null, uvs: [], colors: [], joints: [], weights: [], indices: null, count: 0, targets: [], draco: false };
      const at = p.attributes;
      const dx = p.extensions?.KHR_draco_mesh_compression;
      let dracoOut = null;
      if (isObj(dx)) {
        if (!opts.draco) throw new GltfError('unsupported', t('gltf.extension', { name: 'KHR_draco_mesh_compression' }));
        const v = views[idx(dx.bufferView, views.length)];
        if (!v || !isObj(dx.attributes)) throw damaged('mesh ' + mi + ' has a broken Draco block');
        const ids = {};
        const kinds = {};
        for (const [k, id] of Object.entries(dx.attributes)) {
          if (!Number.isInteger(id) || id < 0 || at[k] === undefined) continue;
          ids[k] = id;
          kinds[k] = /^JOINTS_/.test(k) ? 'u16' : 'f32';
        }
        try { dracoOut = await opts.draco(v.bytes, ids, kinds); } catch (e) { throw damaged('a Draco block does not unpack (' + String(e?.message || e).slice(0, 80) + ')'); }
        prim.draco = true;
      }
      /** → { data, nc } (Draco's own arrays, or the accessor's) */
      const attr = (k, nc) => {
        if (at[k] === undefined) return null;
        let r;
        if (dracoOut && dracoOut.attrs[k]) {
          r = dracoOut.attrs[k];
          if (!r.data || r.data.length !== dracoOut.points * r.nc) throw damaged('a Draco attribute has the wrong size');
        } else r = accessor(at[k], k);
        if (r.nc !== nc && !(k.startsWith('COLOR_') && r.nc === 3)) throw damaged(k + ' has the wrong shape');
        return r;
      };
      const P = attr('POSITION', 3);
      if (!P) { note(t('gltf.note.no_positions')); continue; }
      const Pf = floats(P);
      prim.positions = Pf;
      prim.count = Pf.length / 3;
      for (let i = 0; i < Pf.length; i++) if (!Number.isFinite(Pf[i]) || Math.abs(Pf[i]) > 1e7) throw damaged('a position is not a sane number');
      const fl = (k, nc) => { const r = attr(k, nc); if (!r) return null; const f = floats(r); if (f.length !== prim.count * r.nc) throw damaged(k + ' has a different count from POSITION'); return f; };
      prim.normals = fl('NORMAL', 3);
      prim.tangents = fl('TANGENT', 4);
      for (let n = 0; n < 8 && at['TEXCOORD_' + n] !== undefined; n++) prim.uvs.push(fl('TEXCOORD_' + n, 2));
      for (let n = 0; n < 4 && at['COLOR_' + n] !== undefined; n++) {
        const r = attr('COLOR_' + n, 4);
        const f = floats(r);
        const nc = r.nc;
        if (f.length !== prim.count * nc) throw damaged('COLOR has a different count from POSITION');
        const rgba = new Float32Array(prim.count * 4);
        for (let i = 0; i < prim.count; i++) { rgba[i * 4] = f[i * nc]; rgba[i * 4 + 1] = f[i * nc + 1]; rgba[i * 4 + 2] = f[i * nc + 2]; rgba[i * 4 + 3] = nc === 4 ? f[i * nc + 3] : 1; }
        prim.colors.push(rgba);
      }
      for (let n = 0; n < 4 && at['JOINTS_' + n] !== undefined; n++) {
        const r = attr('JOINTS_' + n, 4);
        const d = r.data;
        if (d.length !== prim.count * 4) throw damaged('JOINTS has a different count from POSITION');
        prim.joints.push(Uint16Array.from(d));
        prim.weights.push(fl('WEIGHTS_' + n, 4) ?? new Float32Array(prim.count * 4));
      }
      if (dracoOut) prim.indices = dracoOut.indices;
      else if (p.indices !== undefined) {
        const r = accessor(p.indices, 'indices');
        if (r.nc !== 1 || ![5121, 5123, 5125].includes(r.componentType)) throw damaged('indices have the wrong type');
        prim.indices = Uint32Array.from(r.data);
      }
      if (prim.indices) for (const i of prim.indices) if (i >= prim.count) throw damaged('an index points past the vertices');
      for (const tg of arr(p.targets)) {
        if (!isObj(tg)) continue;
        const one = (k) => { if (tg[k] === undefined) return null; const r = accessor(tg[k], 'a morph target'); if (r.nc !== 3 || r.count !== prim.count) throw damaged('a morph target has the wrong size'); return floats(r); };
        prim.targets.push({ positions: one('POSITION'), normals: one('NORMAL'), tangents: one('TANGENT') });
      }
      out.primitives.push(prim);
    }
    meshes.push(out);
  }

  // ---- cameras, lights
  const cameras = arr(json.cameras).map((c, i) => {
    c = isObj(c) ? c : {};
    const p = isObj(c.perspective) ? c.perspective : null;
    const o = isObj(c.orthographic) ? c.orthographic : null;
    if (c.type === 'orthographic' && o) return { name: str(c.name, 80) || 'Camera ' + (i + 1), type: 'orthographic', xmag: num(o.xmag, 1), ymag: num(o.ymag, 1), znear: num(o.znear, 0.01), zfar: num(o.zfar, 1000) };
    return { name: str(c.name, 80) || 'Camera ' + (i + 1), type: 'perspective', yfov: num(p?.yfov, 0.8), aspect: num(p?.aspectRatio, null), znear: num(p?.znear, 0.01), zfar: num(p?.zfar, Infinity) };
  });
  const lights = arr(json.extensions?.KHR_lights_punctual?.lights).map((l, i) => {
    l = isObj(l) ? l : {};
    const type = ['directional', 'point', 'spot'].includes(l.type) ? l.type : 'point';
    return { name: str(l.name, 80) || 'Light ' + (i + 1), type, color: vec(l.color, 3, [1, 1, 1]), intensity: Math.max(0, num(l.intensity, 1)), range: num(l.range, Infinity),
      inner: num(l.spot?.innerConeAngle, 0), outer: num(l.spot?.outerConeAngle, Math.PI / 4) };
  });

  // ---- nodes (a tree: a node with two parents, or a loop, is refused)
  const nodesIn = arr(json.nodes);
  if (nodesIn.length > L.nodes) throw new GltfError('too_big', t('gltf.too_big'));
  const parent = new Int32Array(nodesIn.length).fill(-1);
  const nodes = nodesIn.map((n, i) => {
    n = isObj(n) ? n : {};
    const children = [];
    for (const c of arr(n.children)) {
      const ci = idx(c, nodesIn.length);
      if (ci === null || ci === i || parent[ci] !== -1) throw damaged('node ' + i + ' has a child that is not its own');
      parent[ci] = i;
      children.push(ci);
    }
    let instances = null;
    const gi = n.extensions?.EXT_mesh_gpu_instancing;
    if (isObj(gi) && isObj(gi.attributes)) {
      const a = gi.attributes;
      const get = (k, nc) => (a[k] === undefined ? null : (() => { const r = accessor(a[k], 'instancing'); if (r.nc !== nc) throw damaged('instancing ' + k + ' has the wrong shape'); return floats(r); })());
      const T = get('TRANSLATION', 3); const R = get('ROTATION', 4); const S = get('SCALE', 3);
      const count = T ? T.length / 3 : R ? R.length / 4 : S ? S.length / 3 : 0;
      if ((T && T.length !== count * 3) || (R && R.length !== count * 4) || (S && S.length !== count * 3)) throw damaged('instancing attributes differ in count');
      if (count) instances = { count, t: T, r: R, s: S };
    }
    const light = n.extensions?.KHR_lights_punctual?.light;
    return {
      name: str(n.name, 120), matrix: nodeMatrix(n, i), mesh: idx(n.mesh, meshes.length), camera: idx(n.camera, cameras.length),
      light: idx(light, lights.length), skin: idx(n.skin, arr(json.skins).length), children, weights: Array.isArray(n.weights) ? n.weights.map((w) => num(w, 0)) : null, instances,
    };
  });
  // a loop has no root above it: walk up from each node
  for (let i = 0; i < nodes.length; i++) {
    let k = i;
    for (let d = 0; parent[k] !== -1; d++) { k = parent[k]; if (d > L.depth || k === i) throw damaged('the node tree loops or is too deep'); }
  }

  // ---- skins, animations
  const skins = arr(json.skins).map((s, i) => {
    s = isObj(s) ? s : {};
    const joints = arr(s.joints).map((j) => idx(j, nodes.length)).filter((j) => j !== null);
    let ibm = null;
    if (s.inverseBindMatrices !== undefined) {
      const r = accessor(s.inverseBindMatrices, 'a skin');
      if (r.type !== 'MAT4' || r.count < joints.length) throw damaged('skin ' + i + ' has too few bind matrices');
      ibm = floats(r);
    }
    return { name: str(s.name, 80) || 'Skin ' + (i + 1), joints, ibm, skeleton: idx(s.skeleton, nodes.length) };
  });
  const animations = arr(json.animations).slice(0, L.animations).map((a, i) => {
    a = isObj(a) ? a : {};
    const samplers = arr(a.samplers).map((s) => {
      if (!isObj(s)) throw damaged('animation ' + i + ' has a broken sampler');
      const inp = accessor(s.input, 'an animation');
      const outp = accessor(s.output, 'an animation');
      if (inp.nc !== 1) throw damaged('animation ' + i + ' times are not scalars');
      const interpolation = ['LINEAR', 'STEP', 'CUBICSPLINE'].includes(s.interpolation) ? s.interpolation : 'LINEAR';
      const input = floats(inp);
      for (let k = 1; k < input.length; k++) if (!(input[k] >= input[k - 1])) throw damaged('animation ' + i + ' times go backwards');
      return { input, output: floats(outp), interpolation, size: outp.nc };
    });
    const channels = arr(a.channels).map((c) => {
      if (!isObj(c) || !isObj(c.target)) return null;
      if (isObj(c.target.extensions?.KHR_animation_pointer)) { note(t('gltf.note.pointer')); return null; }
      const path = ['translation', 'rotation', 'scale', 'weights'].includes(c.target.path) ? c.target.path : null;
      const node = idx(c.target.node, nodes.length);
      const sampler = idx(c.sampler, samplers.length);
      return path && node !== null && sampler !== null ? { node, path, sampler } : null;
    }).filter(Boolean);
    return { name: str(a.name, 80) || 'Animation ' + (i + 1), channels, samplers };
  });

  const scenes = arr(json.scenes).map((s, i) => ({ name: str(s?.name, 80) || 'Scene ' + (i + 1), nodes: arr(s?.nodes).map((n) => idx(n, nodes.length)).filter((n) => n !== null && parent[n] === -1) }));
  let scene = idx(json.scene, scenes.length);
  if (scene === null && scenes.length) scene = 0;
  if (!scenes.length) {   // no scene: every root node (or, with no nodes, every mesh at the origin)
    const roots = nodes.map((_, i) => i).filter((i) => parent[i] === -1);
    if (!roots.length) meshes.forEach((_, i) => { nodes.push({ name: meshes[i].name, matrix: IDENT.slice(), mesh: i, camera: null, light: null, skin: null, children: [], weights: null, instances: null }); roots.push(nodes.length - 1); });
    scenes.push({ name: 'Scene', nodes: roots });
    scene = 0;
  }
  return {
    asset: { version: String(json.asset.version).slice(0, 10), generator: str(json.asset.generator, 200), copyright: str(json.asset.copyright, 400) },
    extensionsUsed: used, extensionsRequired: required, scene, scenes, nodes, meshes, materials, textures, images, samplers,
    cameras, lights, skins, animations, notes,
  };
}

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A node's local matrix (column-major), from `matrix` or TRS. */
function nodeMatrix(n, i) {
  if (n.matrix !== undefined) {
    if (!Array.isArray(n.matrix) || n.matrix.length !== 16 || !n.matrix.every((v) => typeof v === 'number' && Number.isFinite(v))) throw damaged('node ' + i + ' has a bad matrix');
    return n.matrix.slice();
  }
  const T = vec(n.translation, 3, [0, 0, 0]);
  const R = vec(n.rotation, 4, [0, 0, 0, 1]);
  const S = vec(n.scale, 3, [1, 1, 1]);
  return trs(T, R, S);
}

export function trs(T, R, S) {
  let [x, y, z, w] = R;
  const l = Math.hypot(x, y, z, w) || 1;
  x /= l; y /= l; z /= l; w /= l;
  return [
    (1 - 2 * (y * y + z * z)) * S[0], (2 * (x * y + z * w)) * S[0], (2 * (x * z - y * w)) * S[0], 0,
    (2 * (x * y - z * w)) * S[1], (1 - 2 * (x * x + z * z)) * S[1], (2 * (y * z + x * w)) * S[1], 0,
    (2 * (x * z + y * w)) * S[2], (2 * (y * z - x * w)) * S[2], (1 - 2 * (x * x + y * y)) * S[2], 0,
    T[0], T[1], T[2], 1,
  ];
}

/** An external URI as a plain relative file name (percent-decoded; no scheme, no going up). */
export function safeUri(uri) {
  let u = String(uri);
  try { u = decodeURIComponent(u); } catch { /* keep it */ }
  return u.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}
