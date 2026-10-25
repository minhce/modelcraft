---
title: The live view
summary: A window beside the model that shows it in the real-time look, with sun and shadows, and follows every change you make; walk through it, and set the time of day and the month.
section: tasks
order: 113
keywords: share, panorama, 360, tour, virtual tour, standalone viewer, offline viewer, send to a client, video, walkthrough video, scatter, scattering, grass, meadow, forest, rocks, plants, trees, crowd, paint plants, live view, real time, realtime, real-time render, walkthrough, walk, walk through, first person, presentation, client, second screen, second window, monitor, time of day, sun, season, month, shadows, ambient occlusion, reflections, bounce light, global illumination, webgpu, webgl
---

{{ui:Export}} › {{ui:Live view}} opens a panel over the app that shows the model in the real-time look: the sky and the sun from your model's place and date, the sun's shadows, the looks and materials you gave the faces, lamps, and light bounced off walls and floors. It follows what you do: turn the view and it turns too, change the model and it shows the change a moment later. Nothing is uploaded.

## Open it

1. Choose {{ui:Export}} › {{ui:Live view}}. The panel opens in the bottom right corner.
2. Drag its title bar to move it, pull its corner to make it bigger.
3. {{ui:New window}} moves it to a window of its own, for a second screen. {{ui:Export}} › {{ui:Live view in a new window}} opens it there straight away. If your browser blocks pop-up windows, it opens as the panel.
4. {{ui:Close}} closes it.

## The controls

| Control | What it does |
|---|---|
| {{ui:Follow the view}} | On: the live view looks where ModelCraft's view looks. Walking turns it off |
| {{ui:Walk}} | Walk through the model (below) |
| {{ui:Gravity}} | While walking: stand on floors and climb stairs. Off: fly |
| {{ui:Time}} | The hour of the day, from 05:00 to 21:00. The sun moves as you drag |
| {{ui:Month}} | The month (the 21st of it), so you can see the sun in winter and summer |
| {{ui:Quality}} | {{ui:For this computer}} (what [your machine](topic:your-machine) gets), or {{ui:Low}}, {{ui:Medium}} or {{ui:High}} |

The line at the bottom says what draws the view (WebGPU or WebGL 2), the quality, and the bounce light.

## Walk through the model

1. Turn the main view to where you want to stand and choose {{ui:Walk}}. You stand on the floor below the view's eye point, 1.6 m tall.
2. Click the live view, then use {{key:W}} {{key:A}} {{key:S}} {{key:D}} or the arrow keys. Hold {{key:Shift}} to run. Drag to look round.
3. Steps up to 40 cm are climbed (stairs); anything higher is a wall. Walls stop you and you slide along them.
4. With {{ui:Gravity}} off you fly: {{key:E}} goes up, {{key:Q}} down.
5. {{key:Esc}} stops walking.

## Scatter plants, rocks and people

{{ui:Scatter}} in the live view's bar opens the scatter panel beside the picture. A scatter set spreads items from the entourage library (trees, shrubs, grass, flowers, rocks, people, cars) over part of the model. The items are drawn in the live view only: they are not geometry in the model, and the main view does not show them.

1. **Fill faces:** select faces (or a group, such as a terrain) in ModelCraft, then choose {{ui:Fill selection}}. The set covers them.
2. **Paint:** choose {{ui:Paint}}, then drag over the live view. With faces selected the paint lands only on them; with nothing selected it lands on anything below the brush, the ground included. {{ui:Brush size}} sets the brush; {{ui:Eraser}} takes painted spots away.
3. Tick what to scatter. The number beside each is its weight: 3 and 1 makes three of the first for every one of the second.

| Control | What it does |
|---|---|
| {{ui:Per m²}} | How many items on each square metre |
| {{ui:Keep away (m)}} | No items closer than this to other objects, and none under a roof or a table. 0 turns it off |
| {{ui:Turn (°)}} | How far each item is turned at random about the vertical |
| {{ui:Steepest (°)}} | No items where the surface is steeper |
| {{ui:Size}} | The smallest and largest size, as a factor of the item's own size |
| {{ui:Height from, to (m)}} | Only between these heights (blank = any) |
| {{ui:Lean with the surface}} | 0 keeps items upright; 1 stands them square to a slope |
| {{ui:Seed}}, {{ui:Shuffle}} | The same seed always gives the same scatter; Shuffle picks another |

The sets are saved in the .modelcraft file and follow the faces they cover when you change them. How many items the live view draws at most is set by [your machine](topic:your-machine)'s level: 20 000 for {{ui:Processor only}}, 100 000 for {{ui:Graphics card, basic}}, a million for {{ui:Graphics card, high}}. The panel says how many are placed of how many the density asks for: fewer are placed when the budget is reached, or where objects keep them out. Items close to the camera are drawn as themselves; far ones as simple shapes in their colours.

:::note
Scattered items are in the live view (and its walk, panoramas and the standalone viewer). Render a picture does not draw them yet.
:::

## Share: panoramas, tours, a viewer, a video

{{ui:Share}} in the live view's bar makes files from the live view. Everything is made on this computer; nothing is uploaded.

| Choice | What you get |
|---|---|
| {{ui:360° panorama}} | A 360° picture from where the view stands (or where you are walking), as an equirectangular PNG that panorama viewers and most photo sites open |
| {{ui:Add this spot to the tour}}, then {{ui:Save the tour}} | One web page with a panorama at each spot and arrows to the spots each one can see (a wall in between hides the arrow) |
| {{ui:Save a viewer}} | One web page with the model in this real-time look: turn it, walk through it, jump to its saved scenes. It opens offline in a browser with WebGPU or WebGL 2, from a folder, a USB stick or an email, with no install and no account, and it loads nothing from the internet |
| {{ui:Video of the path}} | The timeline's camera path (or the saved scenes in order) as a video in this real-time look, at the live view's size: WebM or MP4 where the browser can make them, else numbered pictures in a ZIP |

The panorama's size follows the quality: 1024, 2048 or 4096 pixels wide on Low, Medium and High. A viewer file is about 5 MB plus the model.

:::note
The tour and the viewer are made for showing, not editing: they keep the model as it is when you save them.
:::

## Quality

| | Low | Medium | High |
|---|---|---|---|
| Sun shadows | one shadow map | three cascades | four cascades |
| Ambient occlusion (contact shadows) | | ✓ | ✓, finer |
| Reflections in metal | | | ✓ |
| Bloom (when Render a picture sets it) | | ✓ | ✓ |
| Edges smoothed | FXAA | over several frames (TAA) | over several frames (TAA) |
| Bounce light | coarse | finer | finest |

{{ui:For this computer}} picks Low on a computer with no usable graphics card, Medium with a built-in graphics chip, High with a separate graphics card. Low is meant for an 8 GB laptop with no graphics card.

## Bounce light

Light that bounces off a sunlit wall onto the floor, and the darker inside of a room, are worked out by the same path tracer that makes [rendered pictures](topic:render): it renders a small panorama at points through the model, in the background on every processor core. While it works the bottom line says {{ui:Bounce light: 40 %}}; when it is ready the view takes it in. After a change it starts again.

:::note
This is an approximation for a live view, not a rendered picture: small details between the points get the bounce light of the points near them. For a finished picture use [Render a picture](topic:render).
:::

## Brightness and colours

The live view uses the same brightness, white balance, contrast and view transform (ACES, AgX, filmic or standard) as [Render a picture](topic:render): set them there and the live view follows.

:::note
Browsers differ. Where the browser has WebGPU (Chrome and Edge on Windows, macOS and ChromeOS, Safari 26) the live view uses it; elsewhere (most browsers on Linux, older Apple systems) it uses WebGL 2 and looks the same.
:::
