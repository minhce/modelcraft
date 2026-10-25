/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/anim-css.js — the styles of the animation panels (0.7 AN.1–AN.5, session `anim`): the timeline's Keys / Curves / Clips
 * views, the graph editor and the Animate workspace's panel. Kept here so modelcraft.css (shared) stays as it was; put on the
 * page once by injectAnimCss(). Sizes in rem, colours from the page's tokens.
 */
const CSS = `
.mc-tl-views { display: inline-flex; gap: 0; }
.mc-tl-mode { min-height: 1.9rem; padding: .15rem .6rem; border: var(--pen-1) solid var(--line); background: var(--sheet); color: var(--ink); font: inherit; cursor: pointer; }
.mc-tl-mode + .mc-tl-mode { margin-left: calc(-1 * var(--pen-1)); }
.mc-tl-mode[aria-pressed="true"] { background: var(--action); border-color: var(--action); color: var(--on-action); position: relative; }
.mc-tl-mode:focus-visible { outline: var(--pen-2) solid var(--action); outline-offset: 2px; position: relative; }
.mc-timeline[data-tl-mode="curves"] .mc-tl-rows, .mc-timeline[data-tl-mode="clips"] .mc-tl-rows,
.mc-timeline[data-tl-mode="curves"] .mc-tl-playhead, .mc-timeline[data-tl-mode="clips"] .mc-tl-playhead { display: none; }
.mc-tl-key.is-picked { background: var(--action); border-color: var(--action); }
.mc-tl-row.is-prop .mc-tl-name { color: var(--ink); }
.mc-tl-row.is-prop .mc-tl-key { border-radius: 50%; transform: translate(-50%, -50%); }
.mc-tl-box { position: absolute; border: var(--pen-1) dashed var(--action); background: color-mix(in srgb, var(--action) 12%, transparent); pointer-events: none; z-index: 4; }
.mc-tl-stretch { width: 3.5rem; }
.mc-an-curves { display: grid; grid-template-columns: var(--tl-name) minmax(0, 1fr); min-height: 13rem; }
.mc-an-chans { overflow-y: auto; max-height: 15rem; border-right: var(--pen-1) solid var(--line); padding: .25rem 0; }
.mc-an-chans label { display: flex; align-items: center; gap: .3rem; padding: .05rem .5rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-an-chans .mc-an-swatch { width: .6rem; height: .6rem; border: var(--pen-1) solid var(--ink); flex: none; }
.mc-an-graph { position: relative; min-width: 0; display: flex; flex-direction: column; }
.mc-an-graphbar { display: flex; flex-wrap: wrap; gap: .25rem .4rem; align-items: center; padding: .2rem .5rem; border-bottom: var(--pen-1) solid var(--grid); }
.mc-an-graphbar label { display: inline-flex; align-items: center; gap: .3rem; margin: 0; }
.mc-an-graphbar .mc-select { min-height: 1.75rem; width: auto; }
.mc-an-canvas { display: block; width: 100%; height: 12rem; touch-action: none; cursor: crosshair; outline: none; }
.mc-an-canvas:focus-visible { outline: var(--pen-2) solid var(--action); outline-offset: -2px; }
.mc-an-empty { padding: .75rem; color: var(--ink-2); }
.mc-an-clips { padding: .25rem 0; max-height: 15rem; overflow-y: auto; }
.mc-an-clipbar { display: flex; flex-wrap: wrap; gap: .25rem .4rem; align-items: center; padding: .2rem .5rem; border-bottom: var(--pen-1) solid var(--grid); }
.mc-an-clipbar .mc-select { width: auto; min-height: 1.75rem; }
.mc-an-clipbar .mc-tool, .mc-an-graphbar .mc-tool { flex-direction: row; gap: .3rem; min-height: 1.75rem; padding: .15rem .45rem; }
.mc-an-cliprow { display: grid; grid-template-columns: var(--tl-name) minmax(0, 1fr); align-items: center; min-height: 1.8rem; border-top: var(--pen-1) solid var(--grid); }
.mc-an-cliplane { position: relative; height: 1.5rem; margin: 0 1.2rem; }
.mc-an-clip { position: absolute; top: .15rem; bottom: .15rem; left: calc(var(--a) * 100%); width: max(.5rem, calc((var(--b) - var(--a)) * 100%));
  border: var(--pen-1) solid var(--ink); background: var(--sheet); color: var(--ink); font-size: .75rem; padding: 0 .3rem; text-align: left;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: grab; }
.mc-an-clip.is-sel { border-color: var(--action); outline: var(--pen-2) solid var(--action); }
.mc-an-clip.is-mute { opacity: .5; border-style: dashed; }
.mc-an-clipform { display: flex; flex-wrap: wrap; gap: .3rem .6rem; align-items: center; padding: .35rem .5rem; border-top: var(--pen-1) solid var(--line); }
.mc-an-clipform label { display: inline-flex; align-items: center; gap: .3rem; margin: 0; }
.mc-an-clipform .mc-num { width: 4.5rem; }
.mc-an-panel { display: grid; grid-template-columns: minmax(0, 1fr); gap: .6rem; }
.mc-an-panel h4 { font-size: .8125rem; margin: .4rem 0 .2rem; }
.mc-an-panel { min-width: 0; overflow-wrap: anywhere; }
.mc-an-panel .mc-btn { white-space: normal; text-align: left; max-width: 100%; }
.mc-an-props { display: grid; grid-template-columns: minmax(3.5rem, 6.5rem) minmax(0, 1fr) auto; gap: .25rem .35rem; align-items: center; }
.mc-an-props > span { min-width: 0; }
.mc-an-props input[type="checkbox"] { justify-self: start; }
.mc-an-props > span:first-child, .mc-an-props > span { overflow-wrap: anywhere; }
.mc-an-props .mc-input { width: 100%; min-width: 0; }
.mc-an-props .mc-an-vec { display: flex; gap: .2rem; min-width: 0; }
.mc-an-props .mc-an-vec .mc-input { flex: 1 1 0; width: auto; min-width: 2.5rem; padding-left: .25rem; padding-right: .25rem; }
.mc-an-note { color: var(--ink-2); font-size: .75rem; margin: 0; }
.mc-an-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .2rem; }
.mc-an-list li { display: flex; align-items: center; gap: .3rem; }
.mc-an-list li .mc-icon { margin-left: auto; }
.mc-an-slider { display: grid; grid-template-columns: minmax(0, 1fr) 6rem 3.2rem; gap: .3rem; align-items: center; }
.mc-an-shape { display: grid; gap: .2rem; padding: .3rem 0; border-top: var(--pen-1) solid var(--grid); }
.mc-an-shapehead { display: flex; align-items: center; gap: .15rem; }
.mc-an-shapehead .mc-input { flex: 1 1 auto; min-width: 0; }
.mc-an-driver { display: grid; gap: .3rem; padding: .35rem; border: var(--pen-1) dashed var(--line); }
.mc-an-driver label { display: grid; gap: .15rem; margin: 0; }
.mc-an-drvvar { display: grid; grid-template-columns: 3rem minmax(0, 1fr) auto; gap: .25rem; align-items: center; }
.mc-an-drvvar .mc-select, .mc-an-drvvar .mc-input { width: 100%; min-width: 0; }
.mc-an-drvbtns { display: flex; flex-wrap: wrap; gap: .3rem; }
.mc-an-row { display: flex; align-items: center; gap: .4rem; margin: 0; }
.mc-an-row .mc-select { width: auto; min-width: 0; flex: 1 1 auto; }
.mc-an-props .mc-select { width: 100%; min-width: 0; }
.mc-an-panel select, .mc-an-panel input { max-width: 100%; }
.mc-an-bones li { cursor: pointer; padding: .1rem .3rem; border: var(--pen-1) solid transparent; }
.mc-an-bones li.is-on { border-color: var(--action); background: color-mix(in srgb, var(--action) 10%, transparent); }
.mc-an-bones li:focus-visible { outline: var(--pen-2) solid var(--action); outline-offset: 1px; }
.mc-an-bones li .mc-an-note { margin-left: auto; }
.mc-an-shape.is-off { opacity: .6; }
.mc-an-lim { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: .15rem; min-width: 0; }
.mc-an-lim .mc-input { width: 100%; min-width: 0; padding-left: .2rem; padding-right: .2rem; }
`;
export function injectAnimCss() {
  if (typeof document === 'undefined' || document.getElementById('cc-anim-css')) return;
  const s = document.createElement('style');
  s.id = 'cc-anim-css';
  s.textContent = CSS;
  document.head.append(s);
}
