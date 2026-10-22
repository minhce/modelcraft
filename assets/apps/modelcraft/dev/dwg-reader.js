/* SPDX-License-Identifier: Apache-2.0 */
import { t } from "./i18n.js";
/**
 * dwg-reader.js — reads a DWG file into the drawing model io.js importDWG() turns into a site plan.
 *
 * The reader is cc-dwg, the site's own DWG library (Apache-2.0, plain JavaScript, no WebAssembly): byte-identical
 * copies of lib/dwg in ./dwg/ (node tools/dwg-test/writer-sync.mjs keeps them in step). modelcraft.js imports this
 * file only when a DWG is opened, and this file imports the reader then. Nothing else in ModelCraft depends on it.
 * Since 0.4 (1.3) the reading runs in a module worker (`read-async.js`), so a big site plan no longer freezes the page;
 * where a worker cannot start (Node, a blocked blob: URL) it reads on the page's thread, with the same result.
 *
 *   readDWG(bytes) → Promise<model>   cc-dwg's model (header, tables, blocks with their entities, layouts)
 *   dwgVersion(bytes) → 'AC1018 (2004)' etc.
 */

export const DWG_VERSIONS = {
  AC1009: 'R12', AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004',
  AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018',
};

export function dwgVersion(bytes) {
  const tag = new TextDecoder().decode(bytes.subarray(0, 6));
  return /^AC\d{4}$/.test(tag) ? tag + (DWG_VERSIONS[tag] ? ' (' + DWG_VERSIONS[tag] + ')' : '') : '';
}

export async function readDWG(bytes) {
  if (!/^AC\d{4}$/.test(new TextDecoder().decode(bytes.subarray(0, 6)))) throw new Error(t('m3d.dwg.this_is_not_a_dwg_drawing'));
  const { readDwgAsync } = await import('./dwg/read-async.js');
  // readDwg never throws on a damaged file: it returns what it could read, and why not in report.notes
  const m = await readDwgAsync(bytes);
  if (!m.blocks.length) throw new Error(t('m3d.dwg.unreadable', { why: m.report.notes[0] || t('m3d.dwg.unknown_reason'), version: dwgVersion(bytes) || t('m3d.dwg.unknown') }));
  return m;
}
