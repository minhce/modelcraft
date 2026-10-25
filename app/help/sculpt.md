---
title: Sculpt a mesh
summary: Shape a mesh like clay with brushes — draw, clay, smooth, grab, inflate, crease, pinch, flatten — protect parts with a mask, mirror across X, and add detail where you sculpt.
section: tasks
order: 63
keywords: sculpt, sculpting, brush, brushes, clay, draw, smooth, grab, inflate, crease, pinch, flatten, mask, symmetry, mirror, detail, dynamic topology, pen, pressure, tablet, stylus
---

The Sculpt workspace shapes a mesh with brushes, as with clay: drag across the surface and it rises, sinks, smooths or follows the pointer under a round brush, strongest in the middle and fading to nothing at its rim.

## Start

Select a mesh and pick {{ui:Sculpt}} in the Workspace list. A group or component becomes a mesh first, as in the Mesh workspace. Brushes work on the mesh's vertices, so a mesh with more of them takes finer shapes: subdivide it first (the Mesh workspace's {{ui:Subdivide}}, or a Subdivision surface modifier you Apply), or turn {{ui:Detail}} on.

## Brushes

| Brush | Key | What it does |
| --- | --- | --- |
| {{ui:Draw}} | {{key:D}} | Raises the surface under the brush |
| {{ui:Clay}} | {{key:C}} | Builds up flat layers, filling dips first |
| {{ui:Smooth}} | {{key:S}} | Evens out bumps; hold {{key:Shift}} to smooth with any brush |
| {{ui:Grab}} | {{key:G}} | Pulls the surface along with the pointer |
| {{ui:Inflate}} | {{key:I}} | Swells the surface out along its own direction |
| {{ui:Crease}} | {{key:Shift+C}} | Cuts a sharp groove |
| {{ui:Pinch}} | {{key:P}} | Draws the surface towards the brush's middle |
| {{ui:Flatten}} | {{key:T}} | Presses the surface towards its average plane |
| {{ui:Mask}} | {{key:M}} | Paints a mask that protects the surface from the other brushes |

Hold {{key:Ctrl}} while stroking to work the other way (lower instead of raise, a ridge instead of a groove, remove the mask), or turn {{ui:Take away}} on.

## Size and strength

The brush's size is in pixels on the screen, so it feels the same however far you zoom: {{key:[}} and {{key:]}} make it smaller and bigger, {{key:Shift+[}} and {{key:Shift+]}} change its strength. The panel shows both.

With a pen on a tablet, pressing harder makes the brush bigger and stronger; the panel turns either off.

## Mirror, mask and detail

- {{ui:Mirror X}} ({{key:X}}) sculpts both sides across red at once, for faces and figures.
- The mask shows darker while you sculpt. {{ui:Clear mask}} ({{key:Alt+M}}) takes it off, {{ui:Invert mask}} ({{key:Ctrl+I}}) masks what was free and frees what was masked. The mask is kept with the mesh.
- {{ui:Detail}} adds triangles where you sculpt: edges longer than the size set in the panel (pixels on the screen) are split under the brush. It needs a mesh of triangles, and asks to make one first.

Each stroke is one undo step.

:::note
Detail only adds triangles; it does not take away ones that became tiny. A Remesh (the Mesh workspace) evens the whole mesh out again.
:::

See also [Edit a mesh](topic:mesh-edit), [Meshes](topic:meshes) and [Modifiers on a mesh](topic:modifiers).
