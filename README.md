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

> move your hand to that corner of the area you'll write in → **point (or pinch, in pinch mode) and hold for about half a second** → release → next corner

Move your whole hand, don't just point from where you stand: the app maps how far your hand travels in front of the camera onto the wall. Make the area about as big as you'll write, and keep your hand inside the tracking camera's view the whole time.

Order: top-left, top-right, bottom-right, bottom-left. After the fourth, the control view says **Calibrated**. The calibration is saved (separately for pointing and pinching, since the pen sits on a different spot of your hand), so you only redo it if you, the camera or the projector moves.

- **Space** captures the current corner without pinching (if a pinch isn't registering).
- **Q** (or Esc on the laptop) cancels. On the full-screen wall use Q, because Esc there exits full screen. **Forget calibration** goes back to the default "draw big in front of you" mode.
- If it says your hand barely moved, make the corners further apart and press C again.
- If it says the corners came out of order, press C and go top left, top right, bottom right, bottom left.

### 6. Do a test word, then shoot

1. **Start: hold an open palm toward the camera for about half a second.** Until then, a hand in view does nothing. When it goes live, the pen dot ignites on the wall with a burst of sparks. The *Start hold* bar fills up as you hold.
2. **Write: point your index finger** (other fingers curled) to draw. The pen is your fingertip. **Lift between letters by raising your middle finger too** (two fingers up ✌️). The dot keeps following so you can aim the next letter; drop the middle finger to write again. Opening your hand also lifts. (Curling the finger doesn't: at the bottom of letters a straight finger can look curled to the camera.) Prefer pinching? Switch *Draw with* to **Pinch** under Tuning, or press **P**.
3. **Wipe: swipe an open hand sideways**, like wiping a board.
4. **Move it: raise both open hands.** After a moment the writing is grabbed, with a glowing ring at each hand. Slide your hands to move it, twist them to rotate it, and spread them apart or bring them together to resize it. Drop or close either hand to let go. While both hands are up, erasing is switched off.
5. **Stop: lower your hand out of the camera's view for about a second.** Show your palm again to start the next take.
- Keyboard backups (on either window): **X** clear, **Z** undo last stroke.

The big word on the control screen tracks this: *Show your palm* → *Ready* → *Writing*.

Write "Hello World" once, check it on the filming iPhone, adjust, then roll.

## Sound

The wall plays Iron Man–style sound effects: a repulsor charge when writing goes live, a power-down when you stop, a whoosh when you wipe, and blips during calibration. Writing itself is silent. The sounds are synthesized in the browser, so there are no sound files.

Browsers only allow sound after you interact with a page, so **click the wall window once** (or press any key there) and it says *Sound on*. Set the volume, or turn sound off, with **Sound effects** under Tuning. To audition every sound, open `/sounds.html`.

## The heads-up display

The wall wears a cyan heads-up display around the writing, so it looks alive on camera even before you write. Every number on it is real:

- **Live camera** (top right): the tracking camera in monochrome cyan, with your hands' skeletons, a bracket around each hand, and the pen point lighting up orange while it writes. The wall opens the same camera as the control view, so nothing extra is needed. If the wall can't get the camera, it shows the skeletons alone.
- **Status** (top left): Standby, Armed, Writing, Holding or Calibrating, plus how long the session has run.
- **Readouts** (bottom left): tracking speed, hands and confidence, pen position, strokes and ink length, and a live graph of how fast the pen moves.
- **Gestures** (bottom right): the gesture list, with the one you're doing lit up. In standby it only says how to start.
- **On the wall**: a reticle follows your finger, rulers mark its position, and the grid lights up around your hand.

It also animates the moments that matter. Brackets close in on your palm while you hold it up, then a scan line sweeps the wall and *Hand lock acquired* types out. A bright bar sweeps the ink off on a wipe. During a grab, brackets frame the writing and show its scale and rotation.

**H** hides the display and **V** hides the camera, on either window. The same switches are under Tuning. Turn both off for a clean shot of just the ink.

## Hiding the projector's rectangle

A projector can't project true black. Its "black" is dim light, so the whole projected area shows as a faint gray rectangle. Software can't draw darker than black, so hide it on the camera side:

- **Lock the filming iPhone's exposure on the ink.** In the Camera app, tap and hold on the glowing writing until *AE/AF Lock* appears, then drag the sun icon down. The ink is far brighter than the projector's black, so the gray rectangle and the wall fall to black while the writing stays bright. This is the single biggest fix.
- **Turn the projector's brightness down** (eco mode, or lower brightness and contrast) as far as the ink still looks good. Turn off any "dynamic contrast" or "auto iris" that brightens blacks.
- **Make the projection bigger than the shot**: move the projector back or zoom out so the rectangle's edges fall outside the frame.
- **In the edit**, crush the shadows a little (lift contrast, lower blacks) and the last trace of the rectangle disappears.

## Light and dark

The control view starts in **Dark**: dim darkroom reds that won't light up your scene or spill into the shot. Switch to **Light** while setting up with the room lights on, or pick **Auto** to follow your Mac's appearance. The switch sits at the bottom of the side panel, and **T** cycles through the three. The wall view is always black, because that's what the projector shows as "no light". Its heads-up display is always cyan, so the warm ink stands out.

## Tuning (control view → Tuning)

| Slider | Turn it **up** if… | Turn it **down** if… |
|---|---|---|
| **Smoothing** | lines look shaky or jagged | the ink trails behind your hand |
| **Ink thickness** | words are hard to read on the Reel | letters blob together |
| **Sparks** | you want more sparkle | sparks distract from the words |
| **Pinch sensitivity** (pinch mode) | strokes break while you're pinching | ink appears between letters when you didn't pinch |

The **Pinch** bar shows how closed your fingers are, and the white mark is where writing starts. Settings are remembered.

## Troubleshooting

- **No camera / "Couldn't open the camera"**: Chrome needs camera permission (*System Settings → Privacy & Security → Camera → Google Chrome*). The iPhone has to be near the Mac, on the same Apple ID, with Wi-Fi and Bluetooth on. Pick it from the Camera menu.
- **Ink lags behind the hand**: lower Smoothing, add light (a dark scene drops the camera's frame rate), and check the fps readout under the video (aim for 30+). A wired USB webcam is also an option; any camera Chrome sees shows up in the menu.
- **Lines are shaky**: the tracking camera is too far away. When your hand is small in its view, the control screen says so. Move the iPhone closer (about 1 to 1.5 m from you), then recalibrate.
- **Ink jumps around or the hand drops out**: more light on your hand, keep the hand fully in the camera's frame, and avoid a busy background behind you from the camera's point of view.
- **Ink appears in the wrong place**: recalibrate (C) from the exact spot you'll stand in.
- **Wall says "not open" but the window is there**: keep the control view window open and visible on the laptop screen (Chrome slows down hidden windows), and refresh the wall window.

## Keys

| Key | Where | What |
|---|---|---|
| W | control | open the wall window |
| T | control | switch between dark, light and auto |
| P | control | draw by pointing or by pinching |
| C | either | calibrate |
| Space | control | capture current corner (during calibration) |
| Q / Esc | either | cancel calibration (use Q on the full-screen wall) |
| X / Backspace | either | clear the wall |
| Z | either | undo last stroke |
| F / double-click | wall | full screen |
| M | wall | mouse test mode (click and drag to draw) |
| H | either | show or hide the heads-up display |
| V | either | show or hide the live camera on the wall |

## Development

```bash
npm test        # unit tests: calibration, gestures, start/stop flow, smoothing, strokes
npm run build   # type-check + production build into dist/
```

- `src/tracking/`: MediaPipe setup, pinch and palm gestures, One Euro smoothing, homography and calibration
- `src/control/`: the control view (camera, tracking loop, UI)
- `src/wall/`: the wall view (sparkler ink, sparks, pen dot, calibration targets)
- The MediaPipe runtime is copied into `public/mediapipe/` on `npm install`. The hand model lives in `public/models/hand_landmarker.task` (Google's official float16 model).
