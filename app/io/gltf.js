/* SPDX-License-Identifier: Apache-2.0 */
/**
 * gltf.js — the page's way into glTF (0.7 XF.1): reads a .glb / .gltf with the decoders loaded only when a file needs
 * them, then builds it into the model. modelcraft.js imports this file on the first glTF import.
 *
 *   const scene = await readGltfFile(bytes, { companions })   companions: the other files dropped or picked with a .gltf
 *                                                              (its .bin and textures, found by file name)
 *   importGltfScene(model, scene, name) → { def, report }     inside model.change() (gltf-import.js)
 *   importMessage(fileName, report) → the line printed after an import
 *
 * Decoders (vendored, see each folder's SOURCE.txt): Draco ("draco-wrapper" + "draco-wasm" in the manifest's import
 * map, a classic script loaded once with a <script> tag, then dracoDecode in draco.js on this thread) and meshoptimizer
 * ("meshopt-decoder", an ES module). Neither is fetched for a file that doesn't use it.
 */
import { readGltf } from './gltf-read.js';
import { importGltfScene } from './gltf-import.js';
import { dracoDecode } from './draco.js';
import { t } from '../i18n.js';

export { importGltfScene };

let draco = null;
function dracoModule() {
  draco ??= (async () => {
    if (typeof globalThis.DracoDecoderModule !== 'function') {
      await new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = import.meta.resolve('draco-wrapper');
        s.onload = ok;
        s.onerror = () => fail(new Error(t('gltf.decoder_failed', { name: 'Draco' })));
        document.head.append(s);
      });
    }
    const res = await fetch(import.meta.resolve('draco-wasm'));
    if (!res.ok) throw new Error(t('gltf.decoder_failed', { name: 'Draco' }));
    return globalThis.DracoDecoderModule({ wasmBinary: await res.arrayBuffer() });
  })();
  draco.catch(() => { draco = null; });
  return draco;
}

export async function readGltfFile(bytes, { companions = [] } = {}) {
  const byName = new Map();
  for (const f of companions) if (f && typeof f.name === 'string') byName.set(f.name.toLowerCase(), f);
  const resolve = async (uri) => {
    const f = byName.get(String(uri).split('/').pop().toLowerCase());
    if (!f) return null;
    return typeof f.bytes === 'function' ? new Uint8Array(await f.bytes()) : new Uint8Array(await f.arrayBuffer());
  };
  return readGltf(bytes, {
    resolve,
    draco: async (b, attrs, kinds) => dracoDecode(await dracoModule(), b, attrs, kinds),
    meshopt: async () => (await import('meshopt-decoder')).MeshoptDecoder,
  });
}

export function importMessage(file, r) {
  const parts = [t('gltf.import.done', { file, faces: r.faces, n: r.meshes })];
  if (r.components) parts.push(t('gltf.import.components', { n: r.components }));
  if (r.textures) parts.push(t('gltf.import.textures', { n: r.textures }));
  if (r.lights) parts.push(t('gltf.import.lights', { n: r.lights }));
  if (r.cameras) parts.push(t('gltf.import.cameras', { n: r.cameras }));
  if (r.skins || r.animations) parts.push(t('gltf.import.animation', { skins: r.skins, animations: r.animations }));
  if (r.morphs) parts.push(t('gltf.import.morphs', { n: r.morphs }));
  if (r.materials.some((m) => m.extra)) parts.push(t('gltf.import.materials'));
  return parts.join(' ');
}
