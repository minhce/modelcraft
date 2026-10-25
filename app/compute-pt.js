/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file: kernel ids and developer errors */
/**
 * compute-pt.js — the path tracer on every CPU core (0.7 CU.5): render's JS reference (render/pt-ref-job.js, RENDER-SPEC) run as
 * tiles in the page's pool through compute/cpu-render.js — the scene packed once (render/pt-pack.js) and shared, each worker
 * keeping one tracer. Until cc-trace-rs (WebAssembly) replaces the tile job this IS the CPU path for browsers without WebGPU.
 * Same shape as render/bench-kernels.js, so the bench, the parity harness and hybrid.js take it as one more kernel.
 *
 *   cpuKernel({ pool, tile = 32 }) → { id: 'cpu-pool', device: 'cpu', run, batches, makeDevice }
 *   cpuRenderFor(pool, packed, { mask, tile }) → cpu-render instance (shared already): what render's dialog uses for a "CPU"
 *     engine — r.run({passes, spp, signal, onPass}) / r.renderRange(s0, spp) / r.image() / r.release()
 */
import { createCpuRender } from './compute/cpu-render.js';
import { packBench } from './render/pt-pack.js';
import { shareable } from './render/pt-ref-job.js';
import { blueNoise } from './render/pt-sampler.js';

const JOB = new URL('./render/pt-ref-job.js', import.meta.url).href;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function cpuRenderFor(pool, packed, { mask = blueNoise(), tile = 32 } = {}) {
  const hu = new Uint32Array(packed.header);
  const W = hu[60], H = hu[61];
  const r = createCpuRender({ pool, kernel: { url: JOB }, W, H, tile });
  await r.share(shareable(packed, mask));
  return r;
}

const mean3 = (acc, w, h) => {
  const out = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { const n = acc[i * 4 + 3] || 1; out[i * 3] = acc[i * 4] / n; out[i * 3 + 1] = acc[i * 4 + 1] / n; out[i * 3 + 2] = acc[i * 4 + 2] / n; }
  return out;
};

export function cpuKernel({ pool, tile = 32 }) {
  return {
    id: 'cpu-pool', device: 'cpu',
    async run(scene, { w, h, spp = 1, signal = null }) {
      const t0 = now(), r = await cpuRenderFor(pool, packBench(scene, { w, h }), { tile }), t1 = now();
      try {
        const res = await r.run({ passes: spp, spp: 1, signal });
        return { samples: res.samples, ms: now() - t1, setupMs: t1 - t0 };
      } finally { r.release(); }
    },
    async batches(scene, { w, h, spp = 1, k = 4, seed = 0 }) {
      const r = await cpuRenderFor(pool, packBench(scene, { w, h }), { tile });
      try {
        const out = [];
        for (let b = 0; b < k; b++) out.push(mean3(await r.renderRange(seed + b * spp, spp), w, h));
        return out;
      } finally { r.release(); }
    },
    makeDevice(scene, { w, h }) {
      let r = null;
      return {
        kind: 'cpu',
        async renderRange(s0, spp, { signal = null } = {}) {
          r ||= await cpuRenderFor(pool, packBench(scene, { w, h }), { tile });
          return r.renderRange(s0, spp, { signal });
        },
        release() { r?.release(); r = null; },
      };
    },
  };
}
