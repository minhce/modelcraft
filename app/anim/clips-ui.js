/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/clips-ui.js — the timeline's Clips view (0.7 AN.1, session `anim`; NLA-style): saved actions placed on the timeline as
 * clips, one row each, mixed in order (lower rows over upper ones). Make a clip of the tracks, add another clip of an action at
 * the playhead, drag a clip along, and set how it plays (start, speed, repeats, how much, add or replace, hold before / after,
 * mute). The edits are render/anim.js (stashAction, addClip, setClip, removeClip), each one step of the timeline's undo.
 *
 *   mountClips({t, anim() → anim, commit(next, msg?), time() → s, setTime(s), askName(def) → Promise<string|null>})
 *     → {el, refresh(), show(), hide()}
 */
import { stashAction, addClip, setClip, removeClip, BLENDS, EXTENDS } from '../render/anim.js';
import { el } from '../ui-util.js';

export function mountClips(o) {
  const { t } = o;
  let selId = null;
  const fmt = (s) => t('app.tl.secs', { s: (Math.round(s * 100) / 100).toFixed(2) });
  const stashBtn = el('button', { type: 'button', className: 'mc-tool mc-tl-btn', dataset: { anStash: '' }, title: t('app.an.clip.stash.title') }, el('i', { className: 'bi bi-collection', 'aria-hidden': 'true' }), el('span', {}, t('app.an.clip.stash')));   // i18n-ignore: an icon class
  const actSel = el('select', { className: 'mc-select', dataset: { anAction: '' }, 'aria-label': t('app.an.clip.action') });
  const addBtn = el('button', { type: 'button', className: 'mc-tool mc-tl-btn', dataset: { anClipAdd: '' }, title: t('app.an.clip.add.title') }, el('i', { className: 'bi bi-plus-square', 'aria-hidden': 'true' }), el('span', {}, t('app.an.clip.add')));   // i18n-ignore: an icon class
  const bar = el('div', { className: 'mc-an-clipbar' }, stashBtn, el('span', { className: 'mc-tl-sep' }), actSel, addBtn);
  const rows = el('div', { className: 'mc-an-clips', dataset: { anClips: '' } });
  const form = el('div', { className: 'mc-an-clipform', dataset: { anClipForm: '' }, hidden: true });
  const empty = el('p', { className: 'mc-an-empty' }, t('app.an.clips.empty'));
  const root = el('div', { dataset: { anClipsView: '' }, hidden: true }, bar, empty, rows, form);

  const clipEnd = (c) => c.start + (c.to - c.from) * c.scale * c.repeat;
  function refresh() {
    const a = o.anim(), clips = a.clips || [], acts = a.actions || [];
    if (!clips.some((c) => c.id === selId)) selId = null;
    actSel.replaceChildren(...acts.map((x) => el('option', { value: x.id }, x.name || x.id)));
    actSel.disabled = addBtn.disabled = !acts.length;
    stashBtn.disabled = !a.objects.length && !(a.props || []).some((p) => p.target !== 'camera' && p.target !== 'render');
    empty.hidden = clips.length > 0;
    const L = Math.max(a.length, ...clips.map(clipEnd));
    rows.replaceChildren(...clips.map((c, idx) => {
      const b = el('button', {
        type: 'button', className: 'mc-an-clip' + (c.id === selId ? ' is-sel' : '') + (c.mute ? ' is-mute' : ''),
        style: `--a:${c.start / L};--b:${clipEnd(c) / L}`, dataset: { anClip: c.id },
        title: t('app.an.clip.tip', { name: c.name, from: fmt(c.start), to: fmt(clipEnd(c)) }),
      }, c.name);
      b.addEventListener('pointerdown', (e) => startDrag(e, c, b, L));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); o.commit(setClip(o.anim(), c.id, { start: Math.max(0, c.start + (e.key === 'ArrowLeft' ? -1 : 1) / a.fps * (e.shiftKey ? 10 : 1)) })); focusSel(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); o.commit(removeClip(o.anim(), c.id), t('app.an.clip.removed', { name: c.name })); }
      });
      return el('div', { className: 'mc-an-cliprow' }, el('span', { className: 'mc-tl-name', title: c.name }, el('i', { className: 'bi bi-film', 'aria-hidden': 'true' }), ' ', String(idx + 1)),   // i18n-ignore: an icon class
        el('div', { className: 'mc-an-cliplane' }, b));
    }));
    renderForm();
  }
  function focusSel() { rows.querySelector(`[data-an-clip="${selId}"]`)?.focus({ preventScroll: true }); }
  function startDrag(e, c, b, L) {
    if (e.button !== 0) return;
    e.preventDefault();
    selId = c.id;
    const lane = b.parentElement.getBoundingClientRect(), x0 = e.clientX, fps = o.anim().fps;
    let to = c.start, moved = false;
    b.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      if (!moved) return;
      to = Math.max(0, Math.round((c.start + ((ev.clientX - x0) / lane.width) * L) * fps) / fps);
      b.style.setProperty('--a', String(to / L)); b.style.setProperty('--b', String((to + clipEnd(c) - c.start) / L));
    };
    const up = () => {
      b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up);
      if (moved && Math.abs(to - c.start) > 1e-6) o.commit(setClip(o.anim(), c.id, { start: to }), t('app.an.clip.moved', { name: c.name, time: fmt(to) }));
      else refresh();
      focusSel();
    };
    b.addEventListener('pointermove', move); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  }
  function field(key, input) { return el('label', {}, el('span', {}, t(key)), input); }
  function renderForm() {
    const c = (o.anim().clips || []).find((x) => x.id === selId);
    form.hidden = !c;
    if (!c) { form.replaceChildren(); return; }
    const n = (k, v, min, max, step) => {
      const i = el('input', { type: 'number', className: 'mc-input mc-num', value: String(Math.round(v * 1000) / 1000), min: String(min), max: String(max), step: String(step), dataset: { anClipField: k } });
      i.addEventListener('change', () => { const x = Number(i.value); if (Number.isFinite(x)) o.commit(setClip(o.anim(), c.id, { [k]: x })); });
      return i;
    };
    // speed is shown as how fast it plays (2 = twice as fast); the clip stores its time stretch (½)
    const speed = el('input', { type: 'number', className: 'mc-input mc-num', value: String(Math.round(1000 / c.scale) / 1000), min: '0.01', max: '100', step: '0.1', dataset: { anClipField: 'speed' } });
    speed.addEventListener('change', () => { const x = Number(speed.value); if (Number.isFinite(x) && x > 0) o.commit(setClip(o.anim(), c.id, { scale: 1 / x })); });
    const name = el('input', { type: 'text', className: 'mc-input', value: c.name, maxLength: 80, dataset: { anClipField: 'name' } });
    name.addEventListener('change', () => o.commit(setClip(o.anim(), c.id, { name: name.value })));
    const infl = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(c.influence), dataset: { anClipField: 'influence' } });
    infl.addEventListener('change', () => o.commit(setClip(o.anim(), c.id, { influence: Number(infl.value) })));
    const blend = el('select', { className: 'mc-select', dataset: { anClipField: 'blend' } }, BLENDS.map((b) => el('option', { value: b }, t('app.an.clip.blend.' + b))));
    blend.value = c.blend;
    blend.addEventListener('change', () => o.commit(setClip(o.anim(), c.id, { blend: blend.value })));
    const ext = el('select', { className: 'mc-select', dataset: { anClipField: 'extend' } }, EXTENDS.map((b) => el('option', { value: b }, t('app.an.clip.extend.' + b))));
    ext.value = c.extend;
    ext.addEventListener('change', () => o.commit(setClip(o.anim(), c.id, { extend: ext.value })));
    const mute = el('button', { type: 'button', className: 'mc-toggle', 'aria-pressed': String(c.mute), dataset: { anClipMute: '' } }, t('app.an.clip.mute'));
    mute.addEventListener('click', () => o.commit(setClip(o.anim(), c.id, { mute: !c.mute })));
    const idx = o.anim().clips.findIndex((x) => x.id === c.id);
    const upB = el('button', { type: 'button', className: 'mc-icon', title: t('app.an.clip.up'), 'aria-label': t('app.an.clip.up'), disabled: idx === 0 }, el('i', { className: 'bi bi-arrow-up', 'aria-hidden': 'true' }));   // i18n-ignore: an icon class
    upB.addEventListener('click', () => o.commit(setClip(o.anim(), c.id, { order: idx - 1 })));
    const downB = el('button', { type: 'button', className: 'mc-icon', title: t('app.an.clip.down'), 'aria-label': t('app.an.clip.down'), disabled: idx === o.anim().clips.length - 1 }, el('i', { className: 'bi bi-arrow-down', 'aria-hidden': 'true' }));   // i18n-ignore: an icon class
    downB.addEventListener('click', () => o.commit(setClip(o.anim(), c.id, { order: idx + 1 })));
    const rm = el('button', { type: 'button', className: 'mc-icon', title: t('app.an.clip.remove'), 'aria-label': t('app.an.clip.remove'), dataset: { anClipRemove: '' } }, el('i', { className: 'bi bi-trash', 'aria-hidden': 'true' }));   // i18n-ignore: an icon class
    rm.addEventListener('click', () => o.commit(removeClip(o.anim(), c.id), t('app.an.clip.removed', { name: c.name })));
    form.replaceChildren(field('app.an.clip.name', name), field('app.an.clip.start', n('start', c.start, 0, 3600, 1 / o.anim().fps)),
      field('app.an.clip.speed', speed), field('app.an.clip.repeat', n('repeat', c.repeat, 0.01, 1000, 1)),
      field('app.an.clip.influence', infl), field('app.an.clip.blend', blend), field('app.an.clip.extend', ext), mute, upB, downB, rm);
  }
  rows.addEventListener('click', (e) => { const b = e.target.closest('[data-an-clip]'); if (b) { selId = b.dataset.anClip; refresh(); focusSel(); } });
  stashBtn.addEventListener('click', async () => {
    const n = (o.anim().actions || []).length + 1;
    const name = await o.askName(t('app.an.clip.default', { n }));
    if (name === null) return;
    const next = stashAction(o.anim(), name || t('app.an.clip.default', { n }));
    if (next === o.anim()) return;
    selId = next.clips[next.clips.length - 1].id;
    o.commit(next, t('app.an.clip.stashed', { name: next.actions[next.actions.length - 1].name }));
  });
  addBtn.addEventListener('click', () => {
    const next = addClip(o.anim(), actSel.value, o.time());
    if (next === o.anim()) return;
    selId = next.clips[next.clips.length - 1].id;
    o.commit(next, t('app.an.clip.added', { time: fmt(o.time()) }));
  });

  return { el: root, refresh, show() { root.hidden = false; refresh(); }, hide() { root.hidden = true; } };
}
