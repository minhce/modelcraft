---
title: Lay out a mesh's UVs
summary: Mark seams, unwrap, project and pack a mesh's texture coordinates in the UV workspace, and check them with a checker and the stretch colours.
section: tasks
order: 61
keywords: uv, uvs, unwrap, unwrapping, seam, seams, texture, texture coordinates, atlas, pack, packing, island, islands, checker, stretch, distortion, box projection, cylinder projection, sphere projection, conformal, angle based, lscm, abf
---

A texture is a flat picture; a mesh is not flat. Its **UVs** say where each corner of each face sits on the picture. The UV workspace makes them: you cut the mesh open along **seams**, lay the pieces flat (**unwrap**), and fit them into the square (**pack**).

## Open it

Select a mesh and pick {{ui:UV}} in the Workspace list. A group or component becomes a mesh first, as in the Mesh workspace. The 3D view moves to the left half; the **UV editor** on the right shows the mesh's faces laid out on the texture square. Selecting works as in the Mesh workspace, and what you select in one view is selected in the other.

## Mark seams

Seams are where the mesh may be cut open; they show red in both views.

- Select edges ({{ui:Edge}}, or {{key:2}}) and press {{ui:Mark seam}} ({{key:Ctrl+E}}). {{ui:Clear seam}} ({{key:Ctrl+Shift+E}}) takes them off.
- {{ui:Seams at sharp}} marks every sharp edge and every edge where faces meet at more than 60°: a box falls into its six sides.
- {{ui:Seams from UVs}} marks seams where the UVs already break, for example after a projection.

A closed piece needs seams to lie flat: a ball needs at least one cut, a tube a cut along its length.

## Unwrap

Select the faces to lay out (or none, for the whole mesh) and press {{ui:Unwrap}} ({{key:U}}). Each piece between seams is laid flat, keeping its angles as true as it can (angle-based flattening), then the pieces are packed into the square. {{ui:Conformal}} unwraps by least-squares conformal maps instead: quicker, a little less true on strongly curved pieces. A shape that can be made from a flat sheet, such as a cylinder's side cut once, unwraps with no stretch at all.

## Project

For simple shapes a projection is often enough:

| Projection | What it does |
| --- | --- |
| {{ui:Box}} | Each face onto the side of a box it faces most |
| {{ui:Cylinder}} | Round the blue axis: across is the angle round, up is the height |
| {{ui:Sphere}} | From the centre: across is the angle round, up is the latitude |
| {{ui:From view}} | As the faces are seen in the 3D view now |

A face across the cylinder's or the sphere's join is kept in one piece, so its UVs can run a little past the right edge of the square; textures repeat there.

## Arrange

- {{ui:Pack}} fits the pieces (islands) into the square at one texel size, each turned to take the least room. The panel sets the space left between them.
- {{ui:Turn 90°}} and {{ui:Mirror}} turn or mirror the selected faces' UVs.
- In the UV editor, drag a selected face to move the selection's UVs, or point at the editor and press {{key:R}} or {{key:S}} then move to turn or scale them (a click keeps it, {{key:Esc}} cancels). {{key:G}} moves without dragging. Double-click a face (or {{key:L}}) to select its whole island. The wheel zooms; drag with the middle or right button to pan; {{key:F}} fits the square again.

Every change is one undo step.

## Check them

- {{ui:Checker}} shows a labelled checker on the mesh in its UVs: even, square checks mean the texture lies evenly; the labels show which way it runs.
- {{ui:Stretch}} colours each face by how much its UVs stretch it: blue none, through green, to red a lot. The panel chooses whether that measures **angles bent** or **size changed**, and shows the average.

See also [Edit a mesh](topic:mesh-edit), [Meshes](topic:meshes) and [Modifiers on a mesh](topic:modifiers).
