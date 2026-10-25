/* SPDX-License-Identifier: Apache-2.0 */
/**
 * print-view.js — the print tools' marks in ModelCraft's 3D view (0.7 LC.21, session print-07): overhanging faces tinted,
 * support columns and trees, the bed, thin walls coloured. Its own three.js group beside view3d.js's (view3d.js is not
 * changed); the marks are in the model's world (metres, Z up), drawn over the model's faces (polygon offset).
 *
 *   const o = new PrintOverlay(view)
 *   o.set(name, layer | null)    layer: {tris: Float32Array (9 per triangle, metres), color?: css colour | colors: Float32Array
 *                                (rgb per corner), opacity?} or {lines: Float32Array (6 per segment, metres), color, dashed?}
 *   o.clear()                    every layer gone
 *   o.token(name, fallback)      a page colour token (paper/model themes)
 */
import * as THREE from 'three';

export class PrintOverlay {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    this.group.name = 'print-tools';
    this.layers = new Map();
    view.scene.add(this.group);
  }
  token(name, fallback) { return this.view.tok ? this.view.tok(name, fallback) : fallback; }
  set(name, layer) {
    const old = this.layers.get(name);
    if (old) { this.group.remove(old); old.geometry.dispose(); old.material.dispose(); this.layers.delete(name); }
    if (layer) {
      const g = new THREE.BufferGeometry();
      let o;
      if (layer.tris) {
        g.setAttribute('position', new THREE.BufferAttribute(layer.tris, 3));
        if (layer.colors) g.setAttribute('color', new THREE.BufferAttribute(layer.colors, 3));
        const m = new THREE.MeshBasicMaterial({
          color: layer.colors ? 0xffffff : new THREE.Color(layer.color || '#b3122e'), vertexColors: !!layer.colors,
          transparent: true, opacity: layer.opacity ?? 0.6, side: THREE.DoubleSide, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        o = new THREE.Mesh(g, m);
        o.renderOrder = 20;
      } else {
        g.setAttribute('position', new THREE.BufferAttribute(layer.lines, 3));
        const m = layer.dashed
          ? new THREE.LineDashedMaterial({ color: new THREE.Color(layer.color || '#34404e'), dashSize: layer.dash || 0.004, gapSize: layer.dash || 0.004 })
          : new THREE.LineBasicMaterial({ color: new THREE.Color(layer.color || '#a8641a') });
        o = new THREE.LineSegments(g, m);
        if (layer.dashed) o.computeLineDistances();
        o.renderOrder = 21;
      }
      this.layers.set(name, o);
      this.group.add(o);
    }
    this.view.invalidate();
  }
  clear() { for (const k of [...this.layers.keys()]) this.set(k, null); }
  dispose() { this.clear(); this.view.scene.remove(this.group); }
}
