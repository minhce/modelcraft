/* SPDX-License-Identifier: Apache-2.0 */
/**
 * workspaces.js — ModelCraft's workspaces (0.7: Model · Mesh · UV · Shading · Animate · Render), after PartCraft's pattern
 * (docs/apps/partcraft-workspaces.md): a registry and the bits of markup modelcraft.js puts on the page. DOM-free (markup
 * is made with the `el` passed in), so Node tests import it and every ws-<id>.js. Model is built in: its tools are ui.inc's
 * (push/pull). The others come from ws-<id>.js files, each imported by one line in modelcraft.js, each owned by its
 * session (`mesh`: Mesh and UV; `materials`: Shading; `anim`: Animate; `render`: Render).
 *
 *   registerWorkspace({ id, labelKey, icon, blurbKey?, groups: [{ labelKey, items: [{ cmd, icon, labelKey, titleKey }] }],
 *     enter?(host) → false (refused: host.print said why), exit?(host), command?(cmd, host) → bool,
 *     renderPanel?(host, container) → heading?, keydown?(ev, host) → bool, toolState?(cmd, host) → {ok, why, pressed?},
 *     changed?(host) })
 * Words are language keys (the registry runs before the page's words load); `t` reads them when drawing. Commands are
 * named `<id>-<name>`. While a workspace other than Model is open, Model's own groups (MODEL_GROUPS: Draw, Modify,
 * Organize) are hidden; File, Edit and Camera stay.
 */

export const MODEL = Object.freeze({ id: 'model', labelKey: 'app.ws.model', icon: 'box', builtin: true, groups: [] });
/** The switcher's order; workspaces not listed follow in the order they registered. */
export const ORDER = ['model', 'mesh', 'curve', 'uv', 'sculpt', 'shading', 'animate', 'render'];
/** Model's own toolbar groups (ui.inc group keys = their aria-label): hidden in the other workspaces. */
export const MODEL_GROUPS = ['Draw', 'Modify', 'Organize'];   // i18n-ignore: ui.inc's group keys
const HOOKS = ['enter', 'exit', 'command', 'renderPanel', 'keydown', 'toolState', 'changed'];
const ID_RE = /^[a-z][a-z0-9]{1,23}$/, KEY_RE = /^[a-z][a-z0-9_.-]{1,80}$/, ICON_RE = /^[a-z0-9-]{1,40}$/;

const REG = new Map([[MODEL.id, MODEL]]);
const CMDS = new Map();

/** Add a workspace. Throws Error with a plain message when the definition is bad. → the stored definition. */
// i18n-ignore-start: registerWorkspace's errors are for the workspace's programmer, never shown in the app
export function registerWorkspace(def) {
  const bad = (msg) => { throw new Error('registerWorkspace: ' + msg); };   // i18n-ignore: errors for the workspace's programmer
  if (!def || typeof def !== 'object') bad('no definition');
  const { id } = def;
  if (typeof id !== 'string' || !ID_RE.test(id)) bad(`id "${id}" must be 2–24 lower-case letters or digits`);
  if (REG.has(id)) bad(`"${id}" is already registered`);
  if (!KEY_RE.test(def.labelKey || '')) bad(`${id}: labelKey`);
  if (def.icon !== undefined && !ICON_RE.test(def.icon)) bad(`${id}: icon`);
  for (const h of HOOKS) if (def[h] !== undefined && typeof def[h] !== 'function') bad(`${id}: ${h} must be a function`);
  const groups = def.groups ?? [];
  if (!Array.isArray(groups) || groups.length > 6) bad(`${id}: at most 6 groups`);
  const cmds = [];
  const clean = groups.map((g) => {
    if (!g || !KEY_RE.test(g.labelKey || '') || !Array.isArray(g.items) || g.items.length > 32) bad(`${id}: a group needs a labelKey and at most 32 items`);
    return { labelKey: g.labelKey, items: g.items.map((it) => {
      if (!it || typeof it.cmd !== 'string' || !new RegExp(`^${id}-[a-z0-9-]{1,40}$`).test(it.cmd)) bad(`${id}: command "${it?.cmd}" must be named ${id}-<name>`);
      if (CMDS.has(it.cmd) || cmds.includes(it.cmd)) bad(`${id}: command "${it.cmd}" is already used`);
      if (!ICON_RE.test(it.icon || '') || !KEY_RE.test(it.labelKey || '') || !KEY_RE.test(it.titleKey || '')) bad(`${id}: ${it.cmd} needs an icon, a labelKey and a titleKey`);
      cmds.push(it.cmd);
      return { cmd: it.cmd, icon: it.icon, labelKey: it.labelKey, titleKey: it.titleKey };
    }) };
  });
  const stored = { ...def, icon: def.icon || 'grid', groups: clean, builtin: false };
  REG.set(id, stored);
  for (const c of cmds) CMDS.set(c, id);
  return stored;
}
// i18n-ignore-end
export const getWorkspace = (id) => REG.get(id) || null;
export function listWorkspaces() {
  const rank = (w) => { const i = ORDER.indexOf(w.id); return i < 0 ? ORDER.length : i; };
  return [...REG.values()].map((w, i) => [w, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([w]) => w);
}
export const workspaceOfCmd = (cmd) => CMDS.get(cmd) || null;

/** A workspace's toolbar groups, in ui.inc's markup (mc-tool-group / mc-tool / data-cmd / bi icon), hidden until it opens. */
export function toolbarGroups(ws, el, t) {
  return ws.groups.map((g) => el('div', { className: 'mc-tool-group', role: 'group', 'aria-label': t(g.labelKey), dataset: { workspaceGroup: ws.id, tbKey: g.labelKey }, hidden: true },
    el('span', { className: 'mc-tool-label', 'aria-hidden': 'true' }, t(g.labelKey)),
    el('div', { className: 'mc-tool-row' }, ...g.items.map((it) => el('button', { type: 'button', className: 'mc-tool', title: t(it.titleKey), dataset: { cmd: it.cmd } },
      // i18n-ignore: 'bi bi-' is the icon font's class prefix
      el('i', { className: 'bi bi-' + it.icon, 'aria-hidden': 'true' }), el('span', {}, t(it.labelKey)))))));
}
/** The switcher: a labelled select of every workspace. */
export function switcher(el, t, active = 'model') {
  const sel = el('select', { className: 'mc-select mc-ws-select', id: 'mc-workspace', dataset: { workspace: '' }, title: t('app.ws.switch.title') },
    ...listWorkspaces().map((w) => el('option', { value: w.id }, t(w.labelKey))));
  sel.value = active;
  return el('div', { className: 'mc-tool-group mc-ws-group', role: 'group', 'aria-label': t('app.ws.group'), dataset: { group: 'workspace' } },
    el('label', { className: 'mc-tool-label', for: 'mc-workspace' }, t('app.ws.group')),
    el('div', { className: 'mc-tool-row' }, sel));
}
