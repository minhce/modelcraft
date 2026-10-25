---
title: File formats in detail
summary: Exactly what each format ModelCraft opens, imports and exports keeps, converts and leaves out.
section: reference
order: 50
keywords: formats, file types, modelcraft, json, 3dm, nurbs, skp, collada, dae, obj, mtl, gltf, glb, stl, step, stp, ap214, ap242, ply, alembic, abc, cache, fbx, 3mf, ifc, dwg, dxf, units, axes, y up, z up, millimeters, limits
---

ModelCraft's model is in meters with Z (blue) up. Every format below is converted to or from that.

## ModelCraft (.modelcraft)

| What | Details |
|---|---|
| Open | {{ui:Open}} ({{key:Mod+O}}) or drop on the view. Files ending in `.json` are accepted too |
| Save | {{ui:Save}} ({{key:Mod+S}}), as a download |
| Keeps | Everything: geometry, faces and their colors, materials and imported textures, lamps, soft edges, groups, components, names, guides, scenes, the units, and the last camera and style |
| Leaves out | The undo history |
| Limit | 200 MB |

A file saved by a newer ModelCraft than yours is refused: "This model was saved by a newer ModelCraft (file version …). Update ModelCraft to open it." A file that is not a ModelCraft model says "This file is not a ModelCraft model (it is not JSON)." or "This is not a ModelCraft file we can open: …".

## USD (.usd, .usda, .usdc, .usdz)

Open, import, and {{ui:Save as}} or {{ui:Export}} › {{ui:USD (.usda, .usdc, .usdz)…}}. A USD file ModelCraft saved opens again with nothing lost; other programs' USD files open as meshes, groups, components, lamps and cameras. See [Save, open and export USD](topic:usd).

## Collada (.dae)

Import and export. The best format for trading models with other 3D modelers.

- **Export:** Collada 1.4.1, Z up, meters. One geometry per group or component definition; components are written once and placed by reference, so they stay shared. Faces with holes or concave outlines are split into triangles. Colors become materials. Loose edges are written as lines. Names that are not valid in the format are adjusted, and the exact name is kept alongside it.
- **Import:** triangles, polygons (with holes), triangle fans and strips become faces; lines become edges. Node transforms, the file's up axis and its unit are applied. A node placed in several places, or a geometry used by several nodes, comes in as a component; other nodes come in as groups. Material colors (diffuse) become face colors.
- **Not imported:** textures, skins and morphs, cameras, lights, some transform types (look-at and skew), and references to other files. The status bar counts them.
- **Lost on export:** which edges are soft. **On import,** triangulated surfaces stay triangles, with the diagonals softened so flat areas still read as one surface.

## OBJ (.obj, .mtl)

Import and export.

- **Import:** drop the `.obj` together with its `.mtl` and texture pictures (or import the `.obj` alone: it comes in with no materials, and the status bar names the `.mtl` it wanted). Read as meters with Y up. Each object (`o`, else `g`) becomes a [mesh](topic:meshes), its faces kept as they are (quads stay quads). Texture coordinates, normals and per-vertex colors are kept. A material's color picture (`map_Kd`, PNG, JPEG or WebP) comes in as a texture, with its scale and offset options; otherwise its color (`Kd`). Edges where the file's normals break are hard; with no normals, the file's smoothing groups decide. Other maps (bump, normal), points, lines and curves are counted and left out. OBJ has no unit, so a model made in millimeters or inches arrives at the wrong size: scale it after import (see [Rotate and scale](topic:rotate-scale#fix-an-import-that-came-in-the-wrong-size)).
- **Export:** meters, Y up, world coordinates. One object per group placement; components are written out in full at every placement. Meshes keep their own faces, texture coordinates and normals; faces joined by [soft edges](topic:soften) get a normal per corner. When the model has colors, a `.mtl` downloads beside the `.obj`. When it has imported textures, the `.obj`, the `.mtl` and the pictures download together as one `.zip`.
- **Limit:** 2 million vertices or faces; 64 MB of text.

## glTF (.glb, .gltf)

Import and export, glTF 2.0.

- **Import:** a `.glb`, or a `.gltf` together with its `.bin` and texture files: drop them on the view all at once (or pick the `.glb`). A `.gltf` given alone names the file it needs: "This .gltf file needs "…": open the .glb version, or drop the .gltf together with its files."
  - **Meshes** come in as [meshes](topic:meshes), one per mesh in the file, with the file's normals, texture coordinates and vertex colors kept on them. Edges where the file's normals break are hard; the rest are soft. A mesh used in several places stays shared.
  - **Nodes** become groups, named as in the file. Instanced meshes (EXT_mesh_gpu_instancing) come in as one mesh placed many times.
  - **Materials:** a base color texture (PNG, JPEG or WebP) comes in as a texture, placed by the file's texture coordinates (with any texture transform), and is kept when you save; otherwise the base color. Metal, roughness, normal maps, glass, clear coat, sheen and the other material extensions are read but not kept yet: the status bar says so.
  - **Lights** (KHR_lights_punctual): point and spot lights become [lamps](topic:lights). Directional lights are counted: the sun lights the model.
  - **Cameras** become [scenes](topic:scenes).
  - **Skinned characters** come in standing as the file rests them; their bones and animations, and morph targets, are counted and not kept yet.
  - **Compressed files** (Draco, meshopt) and quantized data are read. The decoders load only for a file that needs them.
  - Points and lines are counted and left out (a mesh holds faces). KTX2 textures are left out; the faces keep their color.
- **Export** (`.glb`): glTF 2.0 binary, meters, Y up. One mesh per definition, so components stay shared. Meshes keep their normals, texture coordinates and vertex colors; faces joined by [soft edges](topic:soften) carry smooth normals. Colors and materials become materials (a material as its color); imported textures are written as textures. Lamps that are on become point and spot lights (area lamps have no glTF equivalent and are left out); scenes become cameras. Loose edges are left out.
- **Limit:** files up to 300 MB; about 130 million numbers of geometry.

## STL (.stl)

Import and export.

- **Import:** binary or ASCII. STL has no unit: it is read as **millimeters**, the way printers and ModelCraft's own export write it. Corners at the same point are joined, so a closed part comes in as a closed [mesh](topic:meshes). Colors in the file (the VisCAM / SolidView and the Materialise conventions) paint the faces.
- **Export,** for 3D printing: binary STL, **millimeters**, Z up. Triangles only: groups and loose edges are left out. Painted faces carry their color in the VisCAM / SolidView convention, which other programs ignore if they don't read it. Export closed solids for a clean print.

## STEP (.step, .stp)

Import only. STEP is what part modelers and suppliers send: AP203, AP214 and AP242 files.

- **Import:** ModelCraft reads the file itself, in the page, and turns every solid into a closed [mesh](topic:meshes) of triangles: flat faces stay flat, curved faces (cylinders, cones, spheres, tori, B-spline surfaces) become many small flat ones, with the edges inside one curved face soft and the edges between two faces sharp. STEP files say their unit; the model comes in at its true size. An assembly comes in with every part where the file places it, each part its own mesh in a group named after the file. Colors, part names of the assembly tree and tolerances (PMI) are not read.
- **Messages:** what was skipped or drawn coarser is added to the status line ("Notes: …"); a file with no solid, a damaged file or one past the limits says why and adds nothing.
- **Limit:** files up to 300 MB; 400 000 faces and 8 million triangles.

## .3dm

Import only. `.3dm` files hold NURBS models: polysurfaces, surfaces, meshes, curves and blocks.

- **Import:** ModelCraft reads the file itself, in the page. Meshes come in as they are; every face of a polysurface or extrusion comes from the render mesh saved with it in the file, else ModelCraft tessellates it (planes, NURBS surfaces, surfaces of revolution, extruded curves, extrusions; trimmed by their edges, closed polysurfaces as closed meshes). Curves become edges, blocks become components (blocks in blocks kept), layers become tags (hidden when off), the object's color (its own, its layer's or its material's) paints its faces. The file says its unit; the model comes in at its true size. Step by step: [Bring in a .3dm model](topic:import-3dm-files).
- **Messages:** the status line says how many faces came from saved meshes and how many were tessellated, and names what was left out: points, point clouds, text, dimensions, hatches, lights, SubD objects, faces on surface kinds not read yet, linked blocks.
- **Limit:** files up to 300 MB.

## PLY (.ply)

Import and export, for meshes with colors (scans, 3D printing in color, other modelers).

- **Import:** ASCII and binary. Faces become a [mesh](topic:meshes) with their normals, texture coordinates and vertex colors kept; each face is painted the nearest of 4,096 colors so you see the colors now. PLY has no unit or axis convention: coordinates come in as they are (meters, Z up). A PLY with points only is a point cloud: open it in BimCraft or CivilCraft.
- **Export:** binary PLY with positions, normals and colors (and texture coordinates when the model has them), in meters, Z up.

## FBX (.fbx)

Import only. FBX 7 files (from 2011 on), binary or ASCII, read by ModelCraft's own reader.

- Meshes come in as [meshes](topic:meshes) with their normals, texture coordinates (every UV set) and vertex colors; a mesh several objects use stays shared. Objects become groups with their transforms (pivots, offsets and pre-rotations included).
- Materials: the diffuse texture — embedded in the file, or a picture dropped together with the `.fbx` — comes in as a texture (TGA pictures are kept as PNG); otherwise the diffuse color. Other material settings wait for the new material model.
- The file's up axis and unit are applied: everything comes in Z up, in meters.
- Point and spot lights become [lamps](topic:lights) (an FBX intensity of 100 is ModelCraft's default lamp, 800 lumens: FBX intensities have no unit). Cameras become [scenes](topic:scenes).
- Skinned characters come in at rest; bones and animations are counted and not kept yet. Directional and area lights, and geometry other than meshes (NURBS, curves), are counted and left out.
- FBX 6 and older files are refused: save them again as FBX 2011 or newer.

## Alembic (.abc)

Import only: geometry caches from animation and effects programs.

- Meshes (polygon and subdivision meshes) come in as [meshes](topic:meshes), with their texture coordinates and normals; transforms become groups. Alembic is Y up and is turned to Z up; meters.
- A cache with many samples (an animation) comes in at its first sample; the status bar says how many it has.
- Points, curves, NURBS surfaces, cameras and lights are counted and left out. Files in the old HDF5 layout are refused: save them again as an Ogawa Alembic file.

{{ui:Check for 3D printing (STL or 3MF)…}} checks the shape first and writes the selection, or everything shown. See [Get a model ready for 3D printing](topic:print-3d).

## 3MF (.3mf)

Export only, from {{ui:Check for 3D printing (STL or 3MF)…}}. 3MF core: one mesh in **millimeters**, Z up, with its colors as materials. Most slicers read it, and unlike STL it says its unit. Hidden things are left out. See [Get a model ready for 3D printing](topic:print-3d).

## DWG and DXF export (.dwg, .dxf)

For CAD programs. The model is written in its own unit: inches for feet-and-inches models, otherwise millimeters, centimeters or meters (the status bar names it).

- **Faces** become 3D faces (triangles). Lines inside a face, and soft edges, are written invisible, so the faces look like ModelCraft's.
- **Loose edges** become lines.
- **Groups and components** become blocks: a component is written once and placed as often as it is used, turned and mirrored copies included. A group that was stretched after it was turned (so it is slanted) is written out in place instead.
- **Colors:** DWG keeps each face's color exactly; DXF uses the nearest of the 255 standard CAD colors.
- **Versions:** DWG is written as AutoCAD 2004 (AC1018), which CAD programs from 2004 on open. DXF is R12 (AC1009), the version every CAD program reads; R12 has no unit field, so tell the CAD program which unit to use.
- **Not written:** guides, dimensions, scenes, and the camera.

## IFC (.ifc)

Export only, for BimCraft and other BIM programs. IFC4 with a project, a site, a building and its storeys. Each top-level group or component becomes one building element proxy with its name; closed ones are written as solid shapes (faceted breps), open ones as surface models; holes in faces are kept. Loose geometry at the top level becomes one element called "Loose geometry". No types, properties or materials.

**Storeys:** {{ui:Export}} › {{ui:IFC storeys…}} lists them, each with a name and an elevation ({{ui:Add storey}}, or {{ui:Guess from the model}}, which makes one storey for each height your top-level groups stand on). On export, each group or component goes on the storey at or below its lowest point, and keeps its place. With no storeys, everything goes on one storey, "Level 1", at 0. The storeys are saved in the ModelCraft file.

## DWG (.dwg) and DXF (.dxf)

Import as lines on the ground (hatches and 3D faces as faces); export as described above. See [Model on a site plan](topic:site-plan).

- **Read:** lines, polylines (with arcs), 3D polylines, circles, arcs, and block references including arrays, from model space. Invisible objects (such as the hidden states of a dynamic block) are left out. Curves become 48 straight pieces per full turn.
- **Read since 0.4:** splines and ellipses (as edges), text, multiline text and attribute values (as edges in a single-stroke lettering), hatches (faces with holes), 3D faces and solid fills (faces), and dimensions (drawn from the drawing's own dimension blocks).
- **Read since 0.7:** 3D solids, regions and bodies (their ACIS data, DWG and DXF of every version), each as its own group, closed ones as solids. Faces on surfaces other than planes, cylinders, cones, spheres, tori and simple spline surfaces are left out and listed.
- **Not read:** points, tables, multileaders, images, and anything in paper space.
- **Units:** taken from the drawing when it says. If not, ModelCraft asks.
- **DXF** must be ASCII. Binary DXF is refused.
- **DWG** files from AutoCAD R13 up to the current format (AutoCAD 2018 and later; AC1012 to AC1032) are read by ModelCraft's own DWG reader, in the page; it is part of ModelCraft, so it works offline whenever ModelCraft does. Older versions (R12 and before) and badly damaged files cannot be read; save them as DXF.
- **Limits:** coordinates more than 10,000 km from the origin, or more than 2 million line pieces, are refused.

## SKP files

{{ui:Import}} (or drop the file on the view) reads SketchUp files with ModelCraft's own reader, in the page: nothing is uploaded, and it works offline whenever ModelCraft does. Tested with files from SketchUp 3, 6, 7, 2014, 2017, 2018, 2020, 2025 and 2026; other versions should open too, but have not been tried yet. The model comes in as one group named after the file. One {{key:Mod+Z}} takes it away again. Step by step: [Bring in an SKP model](topic:import-sketchup-files).

- **Kept:** faces with their holes, groups (as groups) and components (as components, shared), their names and placements, colors, tags on groups and components, edges that are not part of a face, and soft and smooth edges, so curved surfaces stay smooth.
- **Colors:** a face's own material gives its color. A material painted on a group or component becomes that placement's paint, so faces inside with no color of their own take it, as in SketchUp; a component painted two colors stays one component.
- **Tags** on groups and components become ModelCraft tags, shown or hidden as they were. Tags on loose faces and edges are not kept (ModelCraft tags groups and components only); the status bar counts them.
- **Hidden things come in hidden** (faces, edges, groups, components, and faces and edges on a hidden tag), so you see what SketchUp showed; {{ui:Unhide all}} shows them.
- **Textures:** a face painted with a textured material keeps its texture, placed as in the file, and the ModelCraft file keeps the image. A texture on a whole group or component, a texture missing from the file, or an image browsers can't show (such as a Photoshop file) keeps only its material's color.
- **Left out, and counted in the status bar:** images placed in the model. Text, dimensions, guides, section planes, scenes and styles are not read.
- **Units:** SketchUp files are in inches inside; ModelCraft converts them, so sizes come out right in any unit.
- **Saving `.skp`** is not built. To take a model back to SketchUp, export Collada (`.dae`).

## Not supported

ModelCraft cannot open 3DS or IFC files, and cannot save 3DS, FBX, STEP, `.3dm` or SketchUp (`.skp`) files.
