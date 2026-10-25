---
title: Meshes
summary: Turn a group or component into a mesh — the kind of object 3D content tools model with — and back into push/pull geometry.
section: tasks
order: 58
keywords: mesh, meshes, polygon, polygons, n-gon, quad, quads, vertices, half-edge, uv, uvs, convert, convert to mesh, convert to geometry, subdivision, sculpt, modeling, 3d content
---

ModelCraft has two kinds of geometry. **Push/pull geometry** is what you draw: flat faces that stick together, cut each other and heal. A **mesh** is the kind of object 3D content tools model with: faces with any number of corners, each corner able to carry its own texture coordinates (UVs), normals and colors, and each vertex values such as weights. A mesh is placed like a group or component, and sits beside push/pull geometry in the same model.

## Turn a group or component into a mesh

1. Select a group or component.
2. In {{ui:Entity info}}, click {{ui:Convert to mesh}}.

Its faces become the mesh's faces (a face with holes comes in as triangles), hard edges stay sharp, soft edges shade smoothly, and paint, materials and imported textures stay on their faces. Groups and components inside it are joined into the one mesh. Loose edges are left out: a mesh keeps faces. Every placement of a component shows the mesh. It is one undo step.

## What Entity info shows

Select a mesh to see its faces, vertices and edges, whether it is a closed solid (and its volume), and its size as placed. A mesh with open edges says how many.

## Turn a mesh back into push/pull geometry

Select the mesh and click {{ui:Convert to geometry}}. Flat faces come back as they were; a face whose corners are not in one plane comes back as triangles. Sharp edges are hard, the others soft. {{ui:Explode}} puts a mesh's faces straight into the group around it.

## Things to know

- Double-click a mesh to [edit its vertices, edges and faces](topic:mesh-edit) in the Mesh workspace. Convert it to geometry to edit it with push/pull; move, rotate, scale, copy, paint, hide and tag it like any group.
- Exports, 3D printing, renders and VR see a mesh as its faces.
- A file that holds a mesh is saved as a newer version of the `.modelcraft` file, so ModelCraft 0.6 and older can't open it; files without a mesh open in them as before. Convert meshes to geometry first to share a file with someone on an older version.
- Undo on a mesh keeps only what each step changed, so even a very large mesh undoes quickly.

See also [Groups and components](topic:groups-components) and [Not built yet](topic:not-built-yet).
