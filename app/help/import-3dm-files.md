---
title: Bring in a .3dm model
summary: Import a .3dm file with its meshes, surfaces, curves, blocks, layers and colors; where the triangles come from, and what is left out.
section: tasks
order: 102
keywords: 3dm, import, nurbs, polysurface, brep, surfaces, render mesh, extrusion, curves, blocks, layers, tags, colors, units, switching, migrate
---

ModelCraft reads `.3dm` files with its own reader, in the page. Nothing is uploaded, and it works offline whenever ModelCraft does. Files saved in the version 5, 6, 7 and 8 layouts have been tested; older ones (versions 2 to 4) should open too, but have not been tried yet.

## Import the file

1. Click {{ui:Import}} in the {{ui:File}} group (or drop the `.3dm` file on the 3D view).
2. Pick the file.

   The status bar says "Reading chair.3dm…" while it reads, then what came in, for example "Imported chair.3dm: 14 meshes (8330 faces), 8 curves, 5 block placements, 3 layers as tags. Surfaces: 7 faces from the meshes saved in the file, 29 tessellated by CadCraft."

The whole model arrives as one group named after the file, selected, and the view zooms to it. One {{key:Mod+Z}} takes it all away again, tags included.

## Where the triangles come from

ModelCraft models with faces and meshes, so every surface in the file comes in as a [mesh](topic:meshes) of small flat triangles. For each face of a polysurface (and each extrusion) ModelCraft takes, in this order:

1. **The render mesh saved in the file.** Most modeling programs save the mesh they showed on screen with each surface; when it is there, ModelCraft uses it as it is.
2. **Its own tessellation**, when the file has no saved mesh: planes, NURBS surfaces, surfaces of revolution (spheres, cones, tori, lathe shapes), extruded curves and extrusions (with their holes and end caps), trimmed by their edges. Faces of one polysurface share their edge points, so a closed polysurface comes in as a closed mesh. Curved areas are split until the triangles lie within about 0.15 % of the object's size of the true surface.
3. **Nothing**, for a face on a kind of surface ModelCraft does not read yet. The status bar says how many faces, and of what kind.

The status bar's "Surfaces:" part says how many faces came from saved meshes and how many ModelCraft tessellated. Edges inside one face of the file are soft and edges between two faces sharp, so a curved face shades smoothly.

:::tip
For the most faithful shapes, save the file with its render meshes in the program that made it (that is usually the default; a "save small" option leaves them out).
:::

## What comes in

- **Meshes** with their vertex colors and texture coordinates.
- **Polysurfaces, surfaces and extrusions**, as described above.
- **Curves** (lines, polylines, arcs, circles, NURBS curves and curves joined from them) as [edges](topic:curves), one group of edges per layer.
- **Blocks** become [components](topic:groups-components): every placement of a block is a placement of one component, so editing one copy changes them all. Blocks inside blocks are kept.
- **Layers** become [tags](topic:tags) with the layer's full name ("Furniture::Chairs"), hidden when the layer was off. Each object's placement carries its layer's tag.
- **Colors.** An object's color comes from where the file says: its own color, its layer's, or its material's base color. It becomes the paint of its faces.
- **Hidden objects come in hidden**; {{ui:Unhide all}} shows them.
- **Units:** the file says its unit; the model comes in at its true size.

## What is left out (and said)

The status bar's "Notes:" part names everything that did not come in, with how many:

- points and point clouds, text, text dots, dimensions, leaders, hatches, lights, clipping planes and layout details;
- SubD objects: turn them into meshes or polysurfaces in the program that made the file first;
- faces on offset surfaces and other surface kinds ModelCraft does not read yet, when the file saved no mesh for them;
- blocks linked from other files (only the file you import is read);
- extrusions with slanted (mitered) ends come in with square ends.

Material textures, render settings, named views, groups and user text are not read; a material gives its base color only.

## Limits

Files up to 300 MB. A damaged file says what is wrong and adds nothing; one object that cannot be read is left out and counted, and the rest comes in.
