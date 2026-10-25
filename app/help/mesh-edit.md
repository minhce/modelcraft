---
title: Edit a mesh in the Mesh workspace
summary: Select a mesh's vertices, edges and faces, move them, and extrude, inset, bevel, cut, merge, fill and bridge them, with either key style.
section: tasks
order: 59
keywords: mesh, edit mode, mesh workspace, vertex, vertices, edge, edges, face, faces, extrude, inset, bevel, loop cut, knife, bisect, spin, merge, dissolve, fill, grid fill, bridge, subdivide, slide, proportional editing, falloff, workspace
---

The **Mesh** workspace edits a [mesh](topic:meshes) point by point: its vertices, edges and faces. Push/pull geometry stays in the **Model** workspace.

## Open it

- Pick {{ui:Mesh}} in the {{ui:Workspace}} list at the left of the toolbar. The selected mesh opens for editing; a selected group or component is turned into a mesh first (one undo step).
- Or double-click a mesh, or, with the modeler keys, select it and press {{key:Tab}}.
- With nothing selected, the panel offers meshes to add: plane, grid, cube, circle, cylinder, cone, sphere, ico sphere and torus. A new one goes where the view is looking and opens for editing.

{{ui:Back to Model}} (or the list, {{key:Tab}} with the modeler keys, {{key:Esc}} with nothing selected with the push/pull keys) goes back to Model with the mesh selected. While the Mesh workspace is open, the rest of the model is faded and Model's drawing tools are put away.

## Select

| Do | To |
|---|---|
| {{key:1}} {{key:2}} {{key:3}} | Select vertices, edges or faces |
| Click | Select one; {{key:Shift}}+click adds or removes |
| Drag a box | Select what is inside and seen; {{key:Shift}} adds, {{key:Ctrl}} removes |
| {{key:Alt}}+click an edge, or double-click it | Its edge loop (a face loop in face mode; the whole border on an open edge) |
| {{key:Ctrl}}+{{key:Alt}}+click an edge | Its edge ring |
| Triple-click | Everything joined to it |

The {{ui:Select}} group also has {{ui:All}}, {{ui:Linked}}, {{ui:Loop}}, {{ui:Ring}}, {{ui:More}} and {{ui:Less}}.

## Move, rotate, scale

{{ui:Move}}, {{ui:Rotate}} and {{ui:Scale}} start from the pointer: move it, then click or press {{key:Enter}} to put the selection down, or {{key:Esc}} to cancel. {{key:X}}, {{key:Y}} or {{key:Z}} (or the arrow keys) lock an axis. Type a distance, an angle or a factor for an exact one — [calculations](topic:value-box#calculations) work too.

**Proportional editing** ({{ui:Proportional}}, or the panel): vertices near the selection follow a move, less the further they are, up to the reach you set, with the falloff you choose. Turn on {{ui:Only along the mesh}} to measure along edges rather than straight.

{{ui:Slide}} moves a selected edge loop along the edges beside it.

## Change the shape

| Tool | Does |
|---|---|
| {{ui:Extrude}} | Pulls the selected faces out along their normal, with new side faces (or makes faces from open border edges). Type the distance |
| {{ui:Inset}} | A band inside the selected faces' outline; press {{key:I}} again for each face on its own |
| {{ui:Bevel}} | Cuts the selected edges (or, {{key:Ctrl}}+{{key:Shift}}+{{key:B}}, vertices) at a width; the wheel or the plus and minus keys add segments for a rounded edge |
| {{ui:Loop cut}} | Point at an edge: new loops across the ring of four-sided faces; the wheel sets how many; click to cut |
| {{ui:Knife}} | Click points on edges or corners; {{key:Enter}} cuts straight across the faces between them, as you see them |
| {{ui:Bisect}} | Draw a line on screen: the selected faces (or all) are cut along it |
| {{ui:Spin}} | Turns the selected faces or open edges round the blue axis in steps (the wheel sets them); a full turn closes |
| {{ui:Subdivide}} | Cuts the selected edges in two; whole faces become a grid |
| {{ui:Merge}} | The selected vertices become one, at their centre |
| {{ui:Dissolve}} | Takes the selection out but keeps the surface: faces join |
| {{ui:Fill}} | A face across a selected open border (or between two open edges) |
| {{ui:Grid fill}} | Fills an open border with an even number of edges with a grid of quads |
| {{ui:Bridge}} | Joins two selected open edge loops with faces |
| {{ui:Crease}} | How sharp the selected edges stay when the mesh is smoothed by a Subdivision surface: move away from the centre, use the wheel (steps of 0.1) or type 0 to 1. The panel shows the selected edges' crease and takes a typed value too. Creased edges are drawn in magenta |
| {{ui:Flip}}, {{ui:Smooth}}, {{ui:Delete}} | Turn faces over; smooth vertices toward their neighbours; delete by the select mode |

Each is one undo step. Texture coordinates, colours and weights follow onto the new faces and vertices.

## Remesh

{{ui:Remesh}} makes the whole mesh again as even triangles of one size, asked for when you press it (smaller is finer and slower). It closes holes, joins pieces that overlap, and evens out a mesh that sculpting has stretched. Sharp edges come out very slightly rounded. UVs, paint and creases start again. One undo step.

## Retopology

To build a new, cleaner mesh over a detailed one (a sculpt, a scan), choose the detailed one under {{ui:Retopology}} › **Build on** in the panel, then:

- **Snap moved points onto it:** points you move, and edges you extrude, land on its surface.
- **Put the selected points on it** moves the selected points onto it now (one undo step).
- **Show this mesh's edges in front** draws the mesh you are building over the surface, so you can see it.

## Adjust the last operation

After {{ui:Inset}}, {{ui:Bevel}}, {{ui:Loop cut}}, {{ui:Subdivide}}, {{ui:Smooth}}, {{ui:Grid fill}} or {{ui:Spin}}, the panel shows its settings (width, segments, profile, cuts …). Change one and the operation is done again from where it started, still one undo step.

## Keys

| | Push/pull keys | Modeler keys |
|---|---|---|
| Move, rotate, scale | {{key:M}} {{key:Q}} {{key:S}} | {{key:G}} {{key:R}} {{key:S}} ({{key:G}} twice slides) |
| Extrude, inset | {{key:P}}, {{key:F}} | {{key:E}}, {{key:I}} |
| Delete | {{key:E}} or {{key:Delete}} | {{key:X}} or {{key:Delete}} |
| Crease | {{key:Shift+C}} | {{key:Shift+E}} |
| Select all, none, invert | {{key:Ctrl+A}}, {{key:Esc}}, {{key:Ctrl+I}} | {{key:A}}, {{key:Alt+A}}, {{key:Ctrl+I}} |
| Both | {{key:Ctrl+B}} bevel, {{key:Ctrl+R}} loop cut, {{key:K}} knife | the same, and {{key:F}} fill, {{key:M}} merge, {{key:Ctrl+X}} dissolve, {{key:L}} / {{key:Ctrl+L}} linked, {{key:Alt+N}} flip, {{key:O}} proportional, {{key:Shift+V}} vertex slide |

See also [Meshes](topic:meshes), [Modifiers on a mesh](topic:modifiers) and [Not built yet](topic:not-built-yet).
