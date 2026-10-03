# Gameplay recording

`capture-gameplay.mjs` records the running app in Chromium through Playwright. It uses the actual player movement/collision code and UI actions for placement, painting, undo, and lighting. Chapters use staged camera positions for readable views of each room.

The browser's normal animation renderer and player tick are paused only in the recording session. Each captured frame advances the original simulation by 1/20 second, then renders the real Three.js scene and HUD. This normalizes playback timing despite the cloud software GPU. The recording lowers only the canvas render resolution; the HUD remains at 1280 × 720. The app source and user projects are unchanged. The browser uses isolated, temporary local storage.

Run with the dev server available on port 5173:

```sh
mkdir -p /tmp/homestead-gameplay-frames
node recordings/capture-gameplay.mjs
ffmpeg -f concat -safe 0 -i /tmp/homestead-gameplay-frames/frames.txt -vf fps=20,format=yuv420p -c:v libx264 -crf 19 -preset medium -movflags +faststart homestead-gameplay.mp4
```

The capture report records resolution, playback duration, frame count and browser errors. Caption overlays are added for the recording; the underlying scene and game HUD come directly from the app. No generated images or external video footage are used.
