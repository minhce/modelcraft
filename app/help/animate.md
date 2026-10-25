---
title: Animate any property, shape it as curves, and mix clips
summary: The Animate workspace keys an object's place, turn and size, a lamp's brightness, spread and colour, the lens and a mesh's shape keys; armatures bend a mesh with bones and painted weights; IK and constraints make bones and objects reach, look at, copy, stay within limits, hang from or follow others; rigid bodies drop, stack and collide and are baked to keys; drivers set a value from others; the timeline's Curves view shapes each change with Bézier handles and cycles, and its Clips view saves animations as actions you place again and mix.
section: tasks
order: 115
keywords: physics, rigid body, rigid bodies, simulation, simulate, drop, fall, gravity, collide, collision, stack, bounce, friction, bake, baked, ik, inverse kinematics, constraint, constraints, look at, track to, aim, copy transforms, copy location, copy rotation, limit rotation, limits, child of, parent, follow path, path, pole, fabrik, chain, armature, armatures, rig, rigging, bones, bone, skeleton, skin, skinning, weights, weight paint, weight painting, vertex groups, automatic weights, bone heat, pose, pose mode, dual quaternion, linear blend, shape keys, shape key, morph, morphs, morph targets, blend shapes, blendshapes, facial, expression, driver, drivers, expressions, animate workspace, animate, animation, keyframe, key, keys, property, properties, transform, location, rotation, scale, lamp, light, brightness, colour, color, lens, field of view, fov, graph editor, curves, curve, bezier, handles, tangent, interpolation, cycle, cycles, repeat, loop, ping pong, offset, dope sheet, select keys, box select, copy keys, paste keys, stretch keys, scale keys, clips, actions, nla, mix, blend, influence, stash
---

The [timeline](topic:animation) moves the camera and whole groups and components. The **Animate** workspace keys more than that, and the timeline gets two more views to shape and reuse what you keyed.

## Open it

Choose {{ui:Animate}} in the workspace list on the toolbar. The timeline opens under the view, the toolbar shows the Animate groups ({{ui:Keys}}, {{ui:Play}}, {{ui:Timeline}}) and the panel on the right lists what you can key at the playhead.

## Key a property

The panel lists, at the playhead:

- **Chosen object**: its {{ui:Place}}, {{ui:Turn (°)}} and {{ui:Size}}, three numbers each. Type a number and press {{key:Enter}}: it is keyed at the playhead and the object moves there. The diamond beside a row keys the value as it is now; a filled diamond means there is a key at the playhead already.
- **Lamps**: each lamp's {{ui:Brightness (lm)}}, {{ui:Spread (°)}} (spot lamps) and {{ui:Colour}}.
- **Camera**: the {{ui:Lens angle (°)}}, for a zoom while the camera moves.

{{ui:Key transform}} (or {{key:I}}) keys the place, turn and size of every chosen group or component at once; {{ui:Key camera}} (or {{key:K}}) keys the camera. With {{ui:Auto key}} on, a group whose place, turn and size are keyed this way gets a new key whenever you move it.

Turns are three angles, about X, then Y, then Z. A turn keyed past 180° keeps going the same way round (190° stays 190°, not −170°), so a wheel can spin several times.

:::tip
A group keyed with {{ui:Key selected}} on the timeline has whole-placement keys. The curve button on its row turns them into place, turn and size curves (the same placement at every key) so you can shape them in {{ui:Curves}}.
:::

## Shape keys (morphs)

A **shape key** is another shape of the same [mesh](topic:meshes): a smile on a face, a door's bulge, a bent leaf. Its slider blends from the mesh as it is (0) to that shape (1); several keys add up.

1. Choose a mesh in the Animate workspace: the panel shows its {{ui:Shape keys}}.
2. Click {{ui:Add shape key}}. ModelCraft goes to the [Mesh workspace](topic:mesh-edit) with the new key being edited: move points, extrude, sculpt — change the mesh into the shape you want.
3. Come back to {{ui:Animate}} and click {{ui:Done}}. The mesh goes back as it was, and the key holds your change.

Then drag the key's slider (or type a value) to blend it in. The diamond keys the value at the playhead, so a key can grow and fade over time; once it has a track, a new value is keyed at the playhead. The pencil edits the key's shape again (the mesh shows it fully until {{ui:Done}}; {{ui:Cancel}} leaves the key as it was), the eye turns the key off, the bin removes it.

A vertex you add while editing a key belongs to the mesh itself: it stays where you made it, in every shape.

:::note
Shape keys move the mesh before its [modifiers](topic:modifiers): a Subdivision modifier smooths the blended shape. Rendered pictures and videos show the keys at each frame.
:::

## Armatures: bones that bend a mesh

An **armature** is a set of bones inside a [mesh](topic:meshes). Pose the bones and the mesh follows, each point as much as its **weights** say.

1. Choose the mesh in the Animate workspace and click {{ui:Add an armature}} in the panel (or {{ui:Add bone}} in the {{ui:Rig}} group): the first bone runs up the middle of the mesh from its foot.
2. With a bone chosen, {{ui:Add a child bone}} adds the next one from its tip. Set any bone's {{ui:Head}}, {{ui:Tip}}, {{ui:Roll (°)}} and what it {{ui:Hangs from}} in the panel; a bone that hangs from another moves with it. Untick {{ui:Moves the mesh}} for a bone that only steers others.
3. Click {{ui:Automatic weights}}: each bone takes hold of the points nearest to it, and the hold spreads smoothly over the mesh, so the points between two bones share them. {{ui:Nearest bones only}} is a quicker, harder split.

**Pose** the bones with {{ui:Pose}} ({{key:P}}): click a bone to choose it, drag to turn it about the view's axis, {{key:Shift}}-drag to move it. Or type its {{ui:Place}}, {{ui:Turn (°)}} and {{ui:Size}} under {{ui:Pose}}; turns are in the bone's own axes, from where it rests. The diamonds and {{ui:Key the whole pose}} key the pose at the playhead; once a bone has keys, posing it keys it there. {{ui:Reset this bone}} and {{ui:Reset the pose}} put the bones back at rest.

**Paint weights** ({{key:W}}) for the chosen bone: the mesh shows at rest, each face coloured by how much that bone holds it — red all, blue none. Paint to add hold ({{key:Mod}} takes it away, {{key:Shift}} smooths); {{ui:Size (px)}} and {{ui:Strength}} set the brush. With {{ui:Keep each point's weights adding up to 1}}, giving one bone more takes the same from the others. Each stroke is one step of the model's undo.

{{ui:Skin}} chooses how a point between bones moves: {{ui:Linear (fast)}} blends the bones' moves, and pinches a bent joint a little; {{ui:Dual quaternion (keeps volume at joints)}} turns the point round the joint instead, so an elbow or a knee keeps its thickness (a bone's {{ui:Size}} then doesn't stretch the skin).

:::note
Shape keys come first, then the armature, then the [modifiers](topic:modifiers). The view, pictures and videos all show the posed mesh; a mesh's weights are saved with it, the bones and their pose with the animation.
:::

## IK and constraints

A **constraint** moves a bone or an object after its keys, by a rule. Choose the object (or, in an armature, the bone) and add one under {{ui:Constraints of …}}; several run in the order listed (the arrows change it), and each has {{ui:How much}} (0 to 1, keyed with its diamond like any property) and an on/off switch.

| Constraint | For | What it does |
|---|---|---|
| {{ui:Reach (IK)}} | Bones | The bone and the bones it hangs from ({{ui:Bones in the chain}}) bend so its tip reaches the target. With two bones and a {{ui:Pole (the bend points to it)}}, the elbow or knee points towards the pole; longer chains bend smoothly. Out of reach, the chain points straight at the target. |
| {{ui:Look at}} | Both | Turns so the {{ui:Axis that points}} faces the target, keeping the {{ui:Axis kept up}} as near to up as it can. |
| {{ui:Copy transforms}} | Both | Takes the target's place, turn or size — the ones ticked. |
| {{ui:Limits}} | Both | Keeps its own place, turn (degrees) or size between a {{ui:min}} and a {{ui:max}} per axis; leave a pair empty to leave that axis free. |
| {{ui:Child of}} | Both | Moves with the target as if it hung from it, from where both were when you chose the target. |
| {{ui:Follow path}} | Objects | Sits on a [curve object](topic:curves) at {{ui:Along the curve}} (0 its start, 1 its end; key it to travel), and with {{ui:Turn along the curve}} faces along it. |

A target is another object in the open group, a bone of the same armature, or {{ui:A point}} you type (an object's point is in the model's coordinates, a bone's in its mesh's). For an IK leg, put the target where the foot should be and key the target, or key {{ui:How much}} to hand the leg between the keys and the IK.

:::tip
An object that looks at one that follows a path sees it on the path: ModelCraft works out the targets first, whatever the order of the objects.
:::

## Physics: drop, stack and collide

Let objects fall and knock into each other, then keep the result as keys.

1. Choose a group, component or mesh and set its {{ui:Rigid body}} under {{ui:Physics}}: {{ui:Falls and collides}} (it moves) or {{ui:Stays put, gets in the way}} (a table, a wall, a ramp). Give a falling one its {{ui:Shape}} — {{ui:Box (its bounds)}} or {{ui:Ball (round its bounds)}} — its {{ui:Mass (kg)}}, {{ui:Friction}} and {{ui:Bounce}} (0 thuds, 1 bounces back as high).
2. Under {{ui:The whole model}}, set {{ui:From (s)}} and {{ui:To (s)}}, the {{ui:Gravity (m/s², down)}} and whether there is {{ui:A ground to land on}} (and its height).
3. Click {{ui:Bake physics}} (in the panel or the {{ui:Physics}} group). Each falling object gets a place, turn and size key on every frame between the two times; play it like any animation.

Baking again replaces those keys; {{ui:Remove baked keys}} takes them off. The objects start at rest, where their keys, curves and constraints put them at {{ui:From (s)}} (a keyed movement before it doesn't carry on into the fall). More {{ui:Steps a frame}} keeps tall stacks steadier; the status bar says when something is still moving at the end.

:::note
Shapes are boxes and balls round each object's bounds; a box touches with its corners, edge middles and face middles, so boxes stack and tip over as you would expect. Cloth, fluids, joints between objects and exact shapes are not built.
:::

## Drivers

A **driver** sets a shape key from other things instead of by hand: open a key's driver (the calculator button), write an **expression**, and give each name in it what it reads ({{ui:Reads}}): the time in seconds, the frame, a placement's place, turn or size along X, Y or Z, a lamp's brightness, or another shape key. For example, with `v` reading a door's turn about Z, `clamp(v / 90, 0, 1)` opens a shape as the door opens.

Expressions use numbers, the names, `+ - * / % ^` and brackets, and the functions `sin cos tan asin acos atan atan2 abs sqrt exp log floor ceil round sign pow min max clamp lerp smoothstep rad deg` with `pi` and `e`. A mistake is pointed out and changes nothing. A driven key's slider shows the driver's value; the driver wins over the key's track until you remove it.

## Choose and change keys (Keys view)

{{ui:Keys}} shows a row per track: the camera, each moving group, and each property ("Lamp 2 · Brightness (lm)"; property keys are round).

- Click a key to choose it; {{key:Shift}}-click or {{key:Mod}}-click adds or removes keys from the choice. {{key:Shift}}-drag over the rows draws a box that adds every key in it.
- Drag a chosen key to move them all; {{key:Left}} / {{key:Right}} move them a frame ({{key:Shift}}: ten).
- {{key:Mod+C}} copies the chosen keys, {{key:Mod+V}} pastes them from the playhead onto the same tracks (another ModelCraft tab can paste them too).
- {{ui:Stretch}} spreads the chosen keys out from the playhead by the number beside it (2 = twice as far apart; 0.5 pulls them in).
- The ease list sets how every chosen key moves on.

## Shape the curves (Curves view)

{{ui:Curves}} is a graph of each number over time: time along, value up. Tick the curves to show in the list on the left (X, Y and Z are red, green and blue).

- Click a key (a square) to choose it, {{key:Shift}}-click for more, or drag a box. Drag a chosen key to change its time and value; with several chosen, drag moves them along in time.
- A chosen key shows its two **handles**. Drag one to shape the curve on that side. {{ui:Handles}} says how they behave: {{ui:Automatic}} (a smooth curve through the keys around it), {{ui:Pointing at the next key}}, {{ui:Aligned}} (the two stay in a straight line, so the curve has no corner) or {{ui:Free}}.
- {{ui:From the chosen keys}} sets how each chosen key moves on to the next: {{ui:Curve (handles)}}, {{ui:Smooth}}, {{ui:Steady}}, {{ui:Slow in and out}} or {{ui:Hold}}.
- {{ui:Before}} and {{ui:After}} set what a curve does outside its keys: {{ui:Hold}} (stays at the first or last value), {{ui:Repeat}}, {{ui:Back and forth}}, or {{ui:Repeat and carry on}} (each repeat starts where the last one ended: a wheel keeps rolling, a walker keeps walking).
- The wheel zooms ({{key:Mod}}: values only, {{key:Shift}}: time only); drag with the middle button or with {{key:Alt}} to pan; {{ui:Show all}} or {{key:Home}} fits every shown curve. Click on empty space to move the playhead there. {{key:Delete}} deletes the chosen keys.

Handles are kept from crossing each other in time, so a curve never runs backwards.

## Reuse animations (Clips view)

A **clip** plays a saved animation (an **action**) on the timeline. Clips are mixed in order, the lower rows over the upper ones; the timeline's own tracks go on top of every clip.

1. Key the groups and lamps as usual, then click {{ui:Make a clip}} in {{ui:Clips}} and give the action a name. The tracks become the action and a clip plays it where they were (the camera stays on the timeline).
2. To use it again, choose the action and click {{ui:Add clip}}: a new clip starts at the playhead.
3. Drag a clip along its row to move it; click it to set {{ui:Start (s)}}, {{ui:Speed}} (2 = twice as fast), {{ui:Repeats}}, {{ui:How much}} (0 to 1), {{ui:Mix}} ({{ui:Replace}}, or {{ui:Add on top}} of the clips before it), {{ui:Outside the clip}} (nothing, hold its end, or hold both ends) and {{ui:Mute}}. The arrows change the order; the bin removes it (an action no clip uses any more goes with it).

A clip at less than full {{ui:How much}} blends from what is under it: the clip before it, or the lamp or placement as it is without the animation.

## What plays where

| What | In the view | In a rendered video |
|---|---|---|
| Camera keys, lens angle with camera keys | Yes | Yes |
| Place, turn and size (keys, curves, clips) | Yes | Yes |
| Lamp brightness, spread and colour | Yes | Not yet: the video uses the lamps as they are when it starts (see [what isn't built yet](topic:not-built-yet)) |
| Lens angle with no camera keys | Yes | Not yet: key the camera too |
| Shape keys and drivers | Yes | Yes |
| Armatures (posed meshes) | Yes | Yes |
| IK and constraints | Yes | Yes |
| Baked physics (keys) | Yes | Yes |

Everything is saved in the `.modelcraft` file with the rest of the animation, and the timeline's {{ui:Undo}} and {{ui:Redo}} take back any of it.
