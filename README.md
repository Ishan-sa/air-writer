# ✦ Air Writer

Write in the air with a pinch, and it appears on your wall as glowing sparkler light.

- **Control view** (laptop screen): the tracking camera feed, live readouts, calibration and tuning.
- **Wall view** (projector): only the ink. Nothing else is ever drawn there while you shoot.

Design: [docs/specs/2026-10-17-air-writer-design.md](docs/specs/2026-10-17-air-writer-design.md)

## Run it

```bash
cd ~/Desktop/my-apps/automations/air-writer
npm run dev
```

Open **http://localhost:5199** in **Google Chrome** (Chrome handles the iPhone camera, the full-screen projector window and the glow effects best). The first time, allow camera access.

Everything (tracker, model) is local, so it works with no internet at the shoot.

**Running it from another computer on your Wi-Fi:** `npm run dev:lan` serves over HTTPS on your network and prints a `https://192.168.x.x:5199` address. Open that in Chrome on the other computer and accept the self-signed certificate warning (*Advanced → Proceed*). The camera, projector and wall window all run on that computer.

## Shoot-day checklist

### 1. Hardware

1. **Projector → Mac**: HDMI cable into the HDMI port on the right side of the MacBook. Turn the projector on. macOS adds it as a second display. In *System Settings → Displays*, make sure it's set to **Extend**, not Mirror.
2. **Tracking iPhone** (iPhone #1): on a tripod **near the wall, facing you**, at about chest height, a bit below or beside the projected area so it stays **out of the filming iPhone's shot**. It needs a clear view of your writing hand. It connects wirelessly through Continuity Camera: same Apple ID as the Mac, Wi-Fi and Bluetooth on, locked or just sitting there in landscape.
3. **Filming iPhone** (iPhone #2): behind you or over your shoulder, framing you and the wall. Record normally. It isn't connected to the app.

### 2. Projector position: avoid your own shadow

Put the projector **high** (shelf or tall stand, above your head) or **off to one side**. If it's directly behind you at shoulder height, your raised hand's shadow lands exactly where the ink appears, and the ink gets projected onto your hand.

Quick check: open the wall view, press **M** for mouse test mode, draw a line where you'll be writing, then stand in your spot and raise your hand. If your hand's shadow covers the line, move the projector.

### 3. Lighting

Turn the room lights down so only the ink shows on the wall. **But the tracking camera has to see your hand.** Facing a black wall in a dark room, your hand is nearly invisible to it.

- Put a **dim light on you from the wall side**: a small LED panel or lamp on low, aimed at your chest and hand, kept low or to the side so it doesn't light up the wall or shine into the filming iPhone.
- The control view's **Light** readout says *Too dark / Dim / Good*. Aim for *Good*, or at least *Dim* with *Hand: Tracking* showing a high percentage.

### 4. Start the app

1. `npm run dev` and open http://localhost:5199 in Chrome.
2. **Camera**: it picks the iPhone automatically the first time. If not, choose it from the *Camera* menu under the video. You should see yourself and the orange hand skeleton when your hand is in view.
3. Click **Open wall window** (or press **W**). If Chrome asks to *manage windows on all your displays*, allow it, and the window opens on the projector. If it opens on the laptop (or on your big 4K screen instead), drag it onto the projector.
4. Click the wall window and press **F** (or double-click) for full screen. The cursor hides itself.
5. The control view header should say **Tracker ready** and **Wall connected**.

### 5. Calibrate (about 20 seconds)

Stand where you'll stand for the shot. Press **C**. The wall shows four targets one at a time:

> move your hand to that corner of the area you'll write in → **pinch and hold for about half a second** → release → next corner

Move your whole hand, don't just point from where you stand: the app maps how far your hand travels in front of the camera onto the wall. Make the area about as big as you'll write, and keep your hand inside the tracking camera's view the whole time.

Order: top-left, top-right, bottom-right, bottom-left. After the fourth, the control view says **Calibrated**. The calibration is saved, so you only redo it if you, the camera or the projector moves.

- **Space** captures the current corner without pinching (if a pinch isn't registering).
- **Q** (or Esc on the laptop) cancels. On the full-screen wall use Q, because Esc there exits full screen. **Forget calibration** goes back to the default "draw big in front of you" mode.
- If it says your hand barely moved, make the corners further apart and press C again.
- If it says the corners came out of order, press C and go top left, top right, bottom right, bottom left.

### 6. Do a test word, then shoot

- **Pinch** (thumb and index touching) = writing. **Open** = pen lifted (the dot follows your hand without sparks).
- **Open palm, fingers spread, held for a second** = wipe the wall for another take. The *Wipe hold* bar fills up as you hold it.
- Keyboard backups (on either window): **X** clear, **Z** undo last stroke.

Write "Hello World" once, check it on the filming iPhone, adjust, then roll.

## Sound

The wall plays Iron Man–style sound effects: a repulsor charge when you pinch, an electric hum with spark crackle that follows your hand speed while you write, a power-down when you let go, a whoosh when you wipe, and blips during calibration. They're synthesized in the browser, so there are no sound files.

Browsers only allow sound after you interact with a page, so **click the wall window once** (or press any key there) and it says *Sound on*. Set the volume, or turn sound off, with **Sound effects** under Tuning. To audition every sound, open `/sounds.html`.

## Light and dark

The control view starts in **Dark**: dim darkroom reds that won't light up your scene or spill into the shot. Switch to **Light** while setting up with the room lights on, or pick **Auto** to follow your Mac's appearance. The switch sits at the bottom of the side panel, and **T** cycles through the three. The wall view is always black, because that's what the projector shows as "no light".

## Tuning (control view → Tuning)

| Slider | Turn it **up** if… | Turn it **down** if… |
|---|---|---|
| **Smoothing** | lines look shaky or jagged | the ink trails behind your hand |
| **Ink thickness** | words are hard to read on the Reel | letters blob together |
| **Sparks** | you want more sparkle | sparks distract from the words |
| **Pinch sensitivity** | strokes break while you're pinching | ink appears between letters when you didn't pinch |

The **Pinch** bar shows how closed your fingers are, and the white mark is where writing starts. Settings are remembered.

## Troubleshooting

- **No camera / "Couldn't open the camera"**: Chrome needs camera permission (*System Settings → Privacy & Security → Camera → Google Chrome*). The iPhone has to be near the Mac, on the same Apple ID, with Wi-Fi and Bluetooth on. Pick it from the Camera menu.
- **Ink lags behind the hand**: lower Smoothing, add light (a dark scene drops the camera's frame rate), and check the fps readout under the video (aim for 30+). A wired USB webcam is also an option; any camera Chrome sees shows up in the menu.
- **Ink jumps around or the hand drops out**: more light on your hand, keep the hand fully in the camera's frame, and avoid a busy background behind you from the camera's point of view.
- **Ink appears in the wrong place**: recalibrate (C) from the exact spot you'll stand in.
- **Wall says "not open" but the window is there**: keep the control view window open and visible on the laptop screen (Chrome slows down hidden windows), and refresh the wall window.

## Keys

| Key | Where | What |
|---|---|---|
| W | control | open the wall window |
| T | control | switch between dark, light and auto |
| C | either | calibrate |
| Space | control | capture current corner (during calibration) |
| Q / Esc | either | cancel calibration (use Q on the full-screen wall) |
| X / Backspace | either | clear the wall |
| Z | either | undo last stroke |
| F / double-click | wall | full screen |
| M | wall | mouse test mode (click and drag to draw) |

## Development

```bash
npm test        # unit tests: calibration math, pinch/palm gestures, smoothing, strokes
npm run build   # type-check + production build into dist/
```

- `src/tracking/`: MediaPipe setup, pinch and palm gestures, One Euro smoothing, homography and calibration
- `src/control/`: the control view (camera, tracking loop, UI)
- `src/wall/`: the wall view (sparkler ink, sparks, pen dot, calibration targets)
- The MediaPipe runtime is copied into `public/mediapipe/` on `npm install`. The hand model lives in `public/models/hand_landmarker.task` (Google's official float16 model).
