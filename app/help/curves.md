---
title: Curve objects
summary: Draw Bézier, NURBS and straight-segment curves, give them a thickness, a width or a taper, fill flat ones, set text as a curve, and turn them into meshes.
section: tasks
order: 62
keywords: curve, curves, bezier, nurbs, spline, splines, path, tube, pipe, cable, rope, bevel, extrude, taper, tilt, radius, fill, profile, text, letters, logo, curve to mesh
---

A **curve object** is a curve that makes a shape: a tube along it (bevel), a band (extrude), a tapering horn (taper), or — when it is flat and closed — a filled plate or letters. The shape follows the curve: move a point and the tube moves with it. When the shape is right, turn it into a mesh.

## Add a curve

Pick {{ui:Curve}} in the Workspace list and press {{ui:Add}}:

| Kind | What it is |
| --- | --- |
| Bézier curve, Bézier circle | Passes through its points; each point has two handles that set the curve's direction |
| NURBS curve, NURBS circle, Path | Smooth, drawn towards its points (it starts and ends on its end points); each point has a weight |
| Text | Your text as flat, filled letter outlines |

A new curve gets a thin tube so it can be seen and picked; set its bevel depth to 0 for a bare curve.

You can also start from something drawn: select an arc, a circle, a polygon or a drawn curve in the Model workspace and press {{ui:Make a curve object}} in Entity info. The drawn lines stay.

## Edit the points

Double-click a curve object (or select it and pick {{ui:Curve}}) to edit it.

- Click a point or handle (Shift adds or removes); drag it to move it. Drag on empty space to select with a box.
- {{ui:Extend}} ({{key:E}}, or {{key:Ctrl}}+click) adds a point after the selected end, at the pointer.
- {{ui:Subdivide}} ({{key:W}}) puts a point between each pair of selected neighbours; a Bézier keeps its shape.
- {{ui:Move}}, {{ui:Turn}}, {{ui:Scale}} move the selected points with the pointer (modeler keys {{key:G}} {{key:R}} {{key:S}}, push/pull keys {{key:M}} {{key:Q}} {{key:S}}); click to keep, {{key:Esc}} to cancel.
- {{ui:Close}} ({{key:C}}) closes an open spline or opens a closed one; {{ui:Reverse}} ({{key:Shift+R}}) runs it the other way.
- Bézier handles: {{ui:Smooth}} ({{key:V}}) places them for a smooth curve, {{ui:Corner}} ({{key:Shift+V}}) points them at the neighbours, {{ui:Free}} ({{key:Alt+V}}) leaves them where you put them. Dragging a handle makes it free.
- {{ui:Bézier}}, {{ui:NURBS}} and {{ui:Poly}} change the selected splines' type, keeping the points.

Every change is one undo step.

## Shape

The settings are in the panel (and in Entity info in the Model workspace):

- **Shape:** 3D curves go any way; a flat curve stays in its own plane and can be filled.
- **Fill closed splines** (flat): the outlines become a plate; an outline inside another is a hole, so letters keep their holes.
- **Extrude:** half the band's width (open or 3D curves), or half the plate's thickness (filled).
- **Bevel depth** and **roundness:** a round tube along the curve (with extrude: a rounded band); on a filled shape, a rounded edge.
- **Close the ends:** caps on an open tube.
- **Taper along it:** scales evenly along each spline, for example `1, 0.2` for a horn, `0, 1, 0` for a spindle.
- **Smoothness** and, for NURBS, **order**: how finely it is drawn, and how smooth (2 straight … 6 smoothest).
- With points selected: **radius** (the tube's thickness there, times the bevel), **tilt** (turns the band about the curve) and, for NURBS, **weight**.

Modifiers work on top of a curve object as on a mesh: an Array along it, a Mirror, a Subdivision surface. See [Modifiers on a mesh](topic:modifiers).

## Turn it into a mesh

{{ui:To mesh}} (in the Curve workspace or in Entity info, {{ui:Curve to mesh}}) makes the curve object the mesh it shows now; its modifiers stay on top. Then edit it in the Mesh workspace. Undo turns it back.

See also [Meshes](topic:meshes) and [Edit a mesh](topic:mesh-edit).
