---
title: Divide an edge or curve into equal parts
summary: Split a line into equal pieces, or give an arc or circle a new number of segments, with the Divide tool.
section: tasks
order: 33
keywords: divide, divide edge, equal parts, equal segments, split edge, segments, subdivide, subdivide edges, arc segments, circle segments, points along a line
---

{{ui:Divide}} cuts an edge into equal pieces, with a corner at each cut. Use the corners to snap to, to start lines from, or to push and pull parts of a face.

## Divide an edge

1. Click {{ui:Divide}} in the toolbar, or select an edge and click {{ui:Divide…}} in {{ui:Entity info}}.
2. Point at the edge. Marks show where the cuts will go: over the middle of the edge it is two parts; move toward an end for more.
3. Click to divide it into the parts shown. Or type a number, such as `5` (or `5s`, or `/5`), and press {{key:Enter}}: it divides at once.

The pieces are left selected, and it is one undo step. A face the edge belongs to keeps its shape and gains the new corners.

## Divide an arc or a circle

Point at any segment of an arc or circle: it divides as a whole.

- An arc or circle whose corners nothing else uses, lying flat on its face, is **drawn again with that many segments** on the true arc. Its ends stay where they are, and it stays one curve, so you can still select it with one click and change its radius in {{ui:Entity info}}. A 24-sided circle divided into 8 becomes an octagon.
- Any other curve — the rim of a pulled cylinder, a curve drawn with {{ui:Curve}}, an arc with lines joined to its corners — gets new corners at equal lengths along it, and nothing moves.

## With the modeler keys

The tool is the same with the modeler keys (Settings › ModelCraft › Keys, or the Modeler menu style), where it is in the {{ui:Mesh}} menu as {{ui:Subdivide edges}}.

## Things to know

- Typed numbers go from 2 to 1000; moving the pointer gives up to 100.
- A curve drawn with {{ui:Curve}} keeps its points: after {{ui:Edit points}}, it is drawn again from them and the new corners are gone.

See also [Draw faces with lines, rectangles, circles and arcs](topic:draw-faces) and [Type exact sizes in the value box](topic:value-box).
