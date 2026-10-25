/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file: internal diagnostics only (gltf-read.js wraps them in a gltf.damaged message). */
/**
 * draco.js — one KHR_draco_mesh_compression block through Google's Draco decoder (vendored, Apache-2.0:
 * assets/vendor/draco/current, the glTF-only WebAssembly build). The same function runs in the page's Draco worker
 * (draco-worker.js) and in Node tests, so both read with the file the app ships.
 *
 *   dracoDecode(D, bytes, attrs {NAME: uniqueId}, kinds {NAME: 'f32' | 'u16'}) → { indices: Uint32Array, points,
 *                                                                                 attrs {NAME: {data, nc}} }
 *   D = the decoder module (await DracoDecoderModule({ wasmBinary }))
 */
const MAX_POINTS = 1 << 24;

export function dracoDecode(D, bytes, attrs, kinds = {}) {
  const decoder = new D.Decoder();
  const mesh = new D.Mesh();
  try {
    const st = decoder.DecodeArrayToMesh(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength, mesh);
    if (!st.ok() || mesh.ptr === 0) throw new Error('Draco: ' + st.error_msg());
    const points = mesh.num_points();
    const faces = mesh.num_faces();
    if (points < 1 || points > MAX_POINTS || faces < 0 || faces > MAX_POINTS * 2) throw new Error('Draco: implausible sizes');
    const n = faces * 3;
    let ptr = D._malloc(n * 4);
    decoder.GetTrianglesUInt32Array(mesh, n * 4, ptr);
    const indices = new Uint32Array(D.HEAPU32.buffer, ptr, n).slice();
    D._free(ptr);
    const out = {};
    for (const [name, id] of Object.entries(attrs)) {
      const a = decoder.GetAttributeByUniqueId(mesh, id);
      if (!a || a.ptr === 0) throw new Error('Draco: no attribute ' + id);
      const nc = a.num_components();
      if (nc < 1 || nc > 16) throw new Error('Draco: implausible components');
      const count = points * nc;
      if (kinds[name] === 'u16') {
        ptr = D._malloc(count * 2);
        decoder.GetAttributeDataArrayForAllPoints(mesh, a, D.DT_UINT16, count * 2, ptr);
        out[name] = { data: new Uint16Array(D.HEAPU16.buffer, ptr, count).slice(), nc };
      } else {
        ptr = D._malloc(count * 4);
        decoder.GetAttributeDataArrayForAllPoints(mesh, a, D.DT_FLOAT32, count * 4, ptr);
        out[name] = { data: new Float32Array(D.HEAPF32.buffer, ptr, count).slice(), nc };
      }
      D._free(ptr);
    }
    for (const i of indices) if (i >= points) throw new Error('Draco: an index past the points');
    return { indices, points, attrs: out };
  } finally {
    D.destroy(mesh);
    D.destroy(decoder);
  }
}
