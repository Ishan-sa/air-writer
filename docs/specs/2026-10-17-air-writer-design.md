# Air Writer — design

*2026-10-17 · for Ishan (@ishaninit)*

## What this is and why

Ishan wants a hook shot for an Instagram Reel: he stands facing a wall, raises his hand, writes "Hello World" in the air, and the words appear on the wall in glowing light as he writes them. The wall image comes from a projector driven by his Mac, and an iPhone camera watches his hand. A second iPhone films the Reel.

It only has to look perfect for a few seconds per take. After the hook, the Reel is a normal talking segment. Success looks like this: in one or two takes, Ishan writes "Hello World" in about 10 seconds, it reads cleanly on the wall with no stray marks, and the footage from the filming iPhone looks good enough to post.

## Goals

- Pinch-to-write in the air turns into handwriting projected on the wall, live.
- The ink lands roughly where Ishan is pointing, so on camera it looks like he's drawing with a laser.
- The ink looks like light painting with a sparkler (details below).
- Setup before a shoot takes a few minutes: plug in, connect the iPhone, calibrate, go.

## Non-goals

- A true 3D laser (casting a ray from the finger to the wall). Rejected: one camera gives wobbly, drifting results. A 4-corner calibration stands in for it (below).
- Recording or exporting video inside the app. The second iPhone films the Reel.
- Handwriting recognition, typed text, shapes, a color picker, multiple users.
- Branding or any on-wall text other than what Ishan writes. Branding goes in the edit.

## Anti-goals (fails even if it technically works)

- **Visible lag** between hand and ink that viewers would notice.
- **Shaky, jagged lines** that look like a tracking demo rather than handwriting.
- **Stray marks**: ink appearing while the pen should be lifted (between letters or words), or strokes breaking while it should be down.
- **Anything other than ink on the projector**: no cursor, debug overlay, window chrome, menu bar or dock on the projected image while shooting.

## Hardware and setup (decided)

- **Computer:** this MacBook Pro 16" (M3 Pro).
- **Projector:** connected by HDMI to the Mac's HDMI port. macOS treats it as a second display. No wireless casting (too much latency).
- **Tracking camera:** one iPhone, connected to the Mac through Continuity Camera (shows up as a webcam), on a tripod near the wall, facing Ishan. It must stay out of the filming iPhone's frame. Placement (low below the projected area, or off to one side) is the builder's call; document what works.
- **Filming camera:** the second iPhone, behind or beside Ishan, recording normally. No connection to the app.
- **Room:** lights low, so only the ink shows on the wall. *(My call, since Ishan handed it over:)* a dim light on Ishan from the wall side, aimed at his chest and hand, kept low or to the side so it doesn't wash out the wall or flare the filming iPhone. A small LED panel or lamp on low works. Tracking needs a visible hand; a pure silhouette is not a design target. The control view shows a tracking-confidence readout so he can adjust the light by eye.
- **Projector position** *(my call):* high (shelf or tall stand, above head height) or off to one side, never directly behind him at shoulder height. That way his raised hand's shadow doesn't fall where the ink lands, and his body doesn't block the calibration targets. Calibration handles whatever position he picks; the README explains the shadow check.
- **Hardware is flexible.** Ishan also has spare cameras. If the Continuity Camera iPhone's latency or low-light tracking isn't good enough, a wired USB webcam or a different camera position is fair game. Keep camera selection open rather than hard-coding the iPhone.
- Also connected today: a 4K external display (Ishan's big screen). Useful for testing before the projector is set up, or as an alternate surface.

## How Ishan uses it (decided)

1. **Pinch to write.** Thumb and index fingertips touching = pen down (like holding an invisible marker). Open them = pen up.
2. **Pen-up dot.** While the pen is up, a small glowing dot follows his hand on the wall with no sparks, so the moment he pinches and the sparks start reads clearly on camera.
3. **Open palm to wipe.** Holding an open palm up for about a second clears the wall. The writing fades out quickly rather than vanishing at once *(my call: about half a second)*. *(My call: the wipe is a reset between takes, not part of the shot. Make the gesture strict, with palm toward the camera, fingers clearly spread and a full ~1 s hold, so a hand relaxing between "Hello" and "World" never wipes the wall. The keyboard clear is the dependable path.)*
4. **Ink stays** on the wall until he wipes it. It does not fade on its own.
5. **Calibration.** Before shooting, he points at the four corners of the projected area one at a time (the wall shows which corner to point at). After that, his hand position maps to wall position, so ink lands roughly where he points, as long as he stays in about the same spot. If calibration is skipped or fails, the app falls back to a default mapping that simply draws large in front of him.

## The look (decided: "Sparkler", option C in the mockup)

- Warm gold ink (core around `#ffe7b0`) with an orange glow (`#ffb347` → `#ff8a00` → `#ff5e00`), like a sparkler in a long-exposure photo.
- Sparks shed from the pen tip **only while the pen is down**. They fall a little and fade in about a second.
- Pen tip: a bright near-white dot with a gold glow.
- Strokes are Ishan's actual hand movement drawn as smooth handwriting lines, not a font. *(My call: tune line thickness so "Hello World" is readable on a phone screen in the Reel.)*
- *(My call on cleanup:)* the mockup's font is cleaner than any air handwriting will be, and that's fine. The bar is "his real handwriting, smoothed": jitter removed and curves rounded off. Never replace the strokes with a font or reshape letters. If filtered strokes still look like a tracking demo, stronger smoothing is allowed as long as the letters stay his. Ishan judges "good enough" from a test take on the wall.
- Everything else on the wall is pure black (black = no projector light).
- The mockup that was approved is at `.superpowers/brainstorm/*/content/ink-style-v2.html` (card C).

## Software (my calls — Ishan handed these over)

- **A local web app running in Chrome** on the Mac. Chrome sees the Continuity Camera iPhone as a webcam, can go full screen on the projector display, and the Canvas/WebGL glow effects are easy there.
- **Hand tracking:** Google MediaPipe Hand Landmarker (open source, runs locally on the GPU). Bundle the model file locally so it works offline at a shoot.
- **Two views:**
  - **Wall view**: full screen on the projector. Shows only ink, the pen dot and calibration targets. Nothing else, ever.
  - **Control view**: on the laptop screen. Shows the camera feed with the tracked hand drawn over it, pinch state, frame rate, and buttons/keys for calibrate, clear, undo and camera selection. Useful for setting up the tracking iPhone's placement.
- **Keyboard backups** in the control view, so a take never hinges on a gesture: clear, undo last stroke, recalibrate. *(Exact keys: builder's call.)*

## Left to the builder

- Project tooling and structure, and how the two views talk to each other.
- Pinch detection details: thresholds (normalized to hand size so distance from the camera doesn't matter), with hysteresis or debounce so the pen doesn't flicker between letters.
- Which point is the "pen": e.g. the midpoint between thumb and index tips.
- Smoothing: something like a One Euro filter on the pen position, plus curve smoothing when drawing strokes, balanced against latency.
- Open-palm detection and the ~1 s hold.
- The calibration math (a 4-point perspective mapping from camera coordinates to wall coordinates) and the default fallback mapping.
- Spark particle tuning, glow rendering technique, persistence of strokes across frames.
- Remembering the last calibration and camera choice between launches.
- A short setup checklist (`README`) for shoot day: cable, Continuity Camera, display arrangement, calibrate, test stroke.
