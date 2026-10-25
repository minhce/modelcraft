---
title: Supports, wall thickness, hollowing and repair
summary: See where a print needs supports and about how much, find walls too thin to print, hollow a part to a wall thickness with drain holes, and repair a mesh with every fix listed.
section: tasks
order: 103
keywords: 3d print, supports, support preview, overhang, tree supports, column supports, wall thickness, thin walls, too thin, nozzle, hollow, hollowing, shell, drain hole, resin, repair, fix mesh, non-manifold, flipped faces, holes, small shells, self-intersection, overlap, join
---

Four tools for getting a model ready for a 3D printer. Open {{ui:Export}} › {{ui:Check for 3D printing (STL or 3MF)…}}; the dialog's **Print tools** line has {{ui:Supports preview}}, {{ui:Wall thickness}}, {{ui:Hollow}} and {{ui:Repair}}. Each opens as a card over the view; {{ui:Close}} (the cross) takes it and its marks away. One card shows at a time.

Each tool works on what prints: the selection, or everything shown when nothing is selected. {{ui:Hollow}} and {{ui:Repair}} need one group, component or mesh selected, because they change it.

## Supports preview

The faces that lean out more than the **overhang angle** from upright are shaded red, and simple supports are drawn from them (orange) down to the bed, or to the part of the model below them.

- **Overhang angle**: 45° is what most printers manage without support. Raise it for a printer that bridges well.
- **Columns**: a straight column every 3 mm under each overhang. The estimate counts them as a 15% support pattern.
- **Tree**: nearby points join one trunk under their middle; no branch leans more than 45°. Trees usually take less material, and touch the bed in fewer places.

The card says how much surface needs support, how many support points there are and about how much material they take. Supports that stand on the model (not the bed) are counted: they leave marks there. With a printer bed chosen in {{ui:Settings}}, the bed is drawn under the model.

:::note
This is a preview, not a slicer: your slicer decides the real supports. On a very large overhang the support points are spread wider so the preview stays quick; the card says so.
:::

## Wall thickness

Each face is measured straight through the solid to the other side. Walls under the **thinnest wall to allow** are red, and walls under one and a half times it are orange: they print, but may come out weak.

The thin areas are listed, thinnest first, with how thin and how large each is. {{ui:Show}} turns the camera to it.

A printer can't make a wall thinner than about two widths of its nozzle: 0.8 mm for the common 0.4 mm nozzle (the start). Resin printers manage less; check your printer's guide.

On a very large model only some faces cast a ray, and the others take their neighbours' thickness; the card says how many were measured.

## Hollow

Hollowing keeps the outside as it is and takes out the inside, leaving walls as thick as you ask. Resin prints use less resin and pull less on the build plate; filament prints use less plastic than infill would.

1. Select the group, component or mesh, then open {{ui:Hollow}}.
2. Set the **wall** (2 mm to start) and how wide the **drain holes** are.
3. For a resin print, click {{ui:Place a drain hole}}, then click the model's outside where it goes: low down, near the build plate, so the liquid resin runs out. Place as many as you need; each shows as a blue circle and is listed with {{ui:Remove}}.
4. {{ui:Preview}} says how much the hollowing takes out.
5. {{ui:Hollow it}} makes the change: one step that {{key:Mod+Z}} undoes.

The result is one closed solid that the 3D-print check accepts: ModelCraft checks it first and changes nothing if it would not pass. Where the model is thinner than two walls, it stays solid. The result is a group whose flat sides are single faces, so you can keep modeling it with {{ui:Push/pull}}; a curved part hollowed on the fine grid usually has too many faces for that and becomes a mesh instead, and the status line says which.

:::tip
For most shapes the inside is the outside moved in by exactly the wall. Where corners or thin parts make that impossible, ModelCraft follows the outside at the wall's distance on a fine grid instead; the card then says how close it is (to within a fraction of a millimeter).
:::

## Repair

{{ui:Repair}} looks at the selected part the way a printer's slicer will, fixes what it can fix safely and lists every fix:

| It fixes | What that means |
|---|---|
| Triangles with no area | left out |
| A triangle drawn twice | one copy kept; a face drawn back to back with itself (no thickness) is removed |
| Loose pieces under 0.5 mm | removed |
| Triangles facing the wrong way | turned to match their neighbours |
| Holes, flat or not | closed with a fan of new triangles from the middle of each hole |
| A piece inside out | turned outward (a hollow inside another piece is left as it is: it is meant to face in) |

{{ui:Fix the safe ones}} makes all of them in one step that {{key:Mod+Z}} undoes, and the status line lists each fix. The fixed part becomes a group whose flat sides are single faces. If it still does not close up (something under **Left for you** remains), or it would have too many faces for a group, it becomes a mesh instead: its faces stay triangles, and flat sides still look flat. The status line says which. {{ui:Join overlapping parts}} works the same way.

What can't be fixed safely is listed under **Left for you** and marked in purple in the view, with {{ui:Show}}:

- **Edges where three or more faces meet**: decide which face belongs and erase the others.
- **A piece passing through itself**: move or redraw that part. See [Intersect faces](topic:intersect).
- **Holes too big or too tangled to close**: draw faces across them.
- **Separate pieces that overlap**: slicers merge them anyway. {{ui:Join overlapping parts}} makes them one closed body (it rebuilds the faces where they meet, so it is a separate button, never done for you).

For push/pull groups you can also fix one at a time in {{ui:Entity info}} › {{ui:Show problems}} / {{ui:Fix}}, which keeps the faces you drew. See [Solid tools](topic:solids).

Related: [Get a model ready for 3D printing](topic:print-3d) · [The Beginner style](topic:beginner) · [Not built yet](topic:not-built-yet#3d-printing)
