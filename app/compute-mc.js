/* SPDX-License-Identifier: Apache-2.0 */
/**
 * compute-mc.js — ModelCraft's side of lib/compute (0.7 CU.1; the copy is ./compute/, tools/compute/sync.mjs): the probe and
 * tier for this page, and the "Your machine" card in Settings › ModelCraft › Rendering, filled the first time the dialog opens.
 *
 *   machine() → Promise<{ facts, info }>     info = tierOf(facts, ?tier= override); one probe per page
 *   mountMachineCard(dialog)                 fills [data-compute-card] when the dialog first opens; inside Studio (its
 *                                            render-nodes bridge) also [data-compute-lan]: other computers (CU.7, lan-ui.js)
 *   lanDevices({ W, H, scene }) → Promise<[device]>  the connected LAN nodes as hybrid devices for that scene ({kernel,
 *                                            buffers, params}: what the render shares with its pool); [] outside Studio
 *   benchParam() → bool / openBench()        /lab/modelcraft?bench=render opens the render bench (compute/bench-page.js, CU.8)
 * The bench times the renderers `render` exposes in render/bench-kernels.js, plus `cpu-pool` (compute-pt.js: the same path
 * tracer on every core), (`export const kernels`, bench.js shape) once that
 * file exists (found through the page's import map, so a missing file costs no request); until then it measures the pool, the
 * BVH and rays only.
 */
import { probeCached, tierOf, tierFromQuery } from './compute/probe.js';
import { machineCard } from './compute/machine-card.js';
import { shareHardware } from './compute/report.js';
import { el } from './ui-util.js';
import { t } from "./i18n.js";
import { pagePool } from './compute/runtime.js';

export function machine() {
  return probeCached(globalThis).then((facts) => ({ facts, info: tierOf(facts, tierFromQuery(globalThis.location?.search)) }));
}

export function mountMachineCard(dlg) {
  const box = dlg?.querySelector('[data-compute-card]');
  if (!box) return;
  let done = false;
  const fill = () => {
    if (done || !dlg.open) return;
    done = true;
    machine().then(({ facts, info }) => box.replaceChildren(...machineCard({ el, t }, facts, info)));
  };
  new MutationObserver(fill).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  fill();
  scheduleHardwareShare();
  mountLanBox(dlg.querySelector('[data-compute-lan]'));
}

let lan = null;
async function mountLanBox(box) {
  const bridge = globalThis.window?.cadcraftDesktop?.renderNodes;
  if (!box || !bridge) return;   // a browser tab cannot find other computers: the section stays hidden
  const [{ mountLan }, crypto, pool] = await Promise.all([import('./compute/lan-ui.js'), import('./live-crypto.js'), pagePool()]);
  lan = mountLan({ el, t, bridge, crypto, pool, storage: globalThis.localStorage,
    // what this computer runs for others: its own kernels only, by id
    kernels: {
      preview: { url: new URL('./compute/preview-kernel.js', import.meta.url).href },
      // the path tracer (render's JS reference as tiles); the scene arrives as render/pt-ref-job.js shareable(packed)
      'pt-ref': { url: new URL('./render/pt-ref-job.js', import.meta.url).href },
    } }, box);
}

export function lanDevices(size) { return lan ? lan.devices(size) : Promise.resolve([]); }

export const benchParam = () => new URLSearchParams(globalThis.location?.search || '').get('bench') === 'render';

export async function openBench() {
  const { mountBench } = await import('./compute/bench-page.js');
  return mountBench({
    el, t, machine,
    pool: () => pagePool(),
    kernels: async () => {
      // render's own file, when it has made one (not there is the normal case until RN.1 lands)
      try {
        const map = JSON.parse(document.querySelector('script[type="importmap"]')?.textContent || '{}').imports || {};
        const url = Object.entries(map).find(([k]) => k.endsWith('/render/bench-kernels.js'))?.[1];
        if (!url) return [];
        const m = await import(url);
        const list = Array.isArray(m.kernels) ? [...m.kernels] : [];
        // the same path tracer on every CPU core (CU.5: render's pt-ref-job.js through compute/cpu-render.js)
        const { cpuKernel } = await import('./compute-pt.js');
        list.push(cpuKernel({ pool: await pagePool() }));
        return list;
      } catch { return []; }
    },
    download(name, text, type) {
      const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
  });
}

/**
 * Hardware specs for building more efficient engines (owner 2026-10-24; compute/report.js): a while after the app opens, when
 * the page is idle, the probe's facts go to getcadcraft.com — if Settings › Global › Hardware specs allows it (on by default in
 * the browser, off in the desktop app). At most once a month.
 */
let shareTimer = 0;
function scheduleHardwareShare() {
  if (shareTimer || !globalThis.window) return;
  const go = () => machine().then(({ facts, info }) => shareHardware({ facts, info, app: 'modelcraft',
    build: (document.querySelector('.app-bar-ver summary')?.textContent || '').trim() })).catch(() => {});
  shareTimer = setTimeout(() => (globalThis.requestIdleCallback ? globalThis.requestIdleCallback(go, { timeout: 10000 }) : go()), 20000);
}
