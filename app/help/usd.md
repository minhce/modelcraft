---
title: Save, open and export USD
summary: Save the whole model as USD (.usda, .usdc or .usdz) with nothing lost, open it again, and import USD scenes from other 3D programs.
section: tasks
order: 135
keywords: usd, usda, usdc, usdz, openusd, universal scene description, save as, export, import, scene assembly, archviz, openpbr, materialx, package
---

USD is a scene format many 3D, rendering and archviz programs share. ModelCraft writes and reads it. `.modelcraft` stays the format {{ui:Save}} writes; USD is a choice in {{ui:Save as}}.

## Save as USD

1. Choose {{ui:Save as}} in the {{ui:File}} group (or press {{key:Mod+Shift+S}}).
2. Pick the format: {{ui:Text (.usda)}} (readable, good for version control), {{ui:Binary (.usdc)}} (smallest and fastest) or {{ui:Package (.usdz)}} (one file with the textures inside).
3. The file downloads (in the desktop app you choose where it goes).

The same choices are in {{ui:Export}} › {{ui:USD (.usda, .usdc, .usdz)…}}.

## Nothing is lost

Open a USD file that ModelCraft saved and you get the model back exactly: faces with their holes, soft and hidden edges, curves, groups and components, tags, scenes, dimensions, guides, section planes, lamps, imported textures and the view. Other programs see the same model as meshes, groups, prototypes for components, materials, lamps and cameras.

:::note
If another program changes the geometry of a group or component, ModelCraft opens that part as a mesh with the change kept, and says how many parts it read that way. A placement moved or deleted in another program stays moved or deleted.
:::

## Open or import someone else's USD

- {{ui:Open}} a `.usd`, `.usda`, `.usdc` or `.usdz` file to start a model from it.
- {{ui:Import}} one to add it to the open model. Drop the files it refers to (other layers, textures) together with it.

Meshes come in with their normals, UV coordinates and colours, shared geometry as components, materials as paint colours, lamps as lamps and cameras as scenes, in metres with Z up whatever the file's units and up axis.

## Not yet

Animation, skeletons and MaterialX node graphs are not read or written as USD yet. ModelCraft's own animation and node materials are kept in a USD file it saved, for ModelCraft to open again, but other programs don't see them. Layers a file refers to that ModelCraft can't read (for example a MaterialX document) are left out with a note.
