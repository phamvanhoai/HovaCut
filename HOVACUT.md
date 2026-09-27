# HovaCut hybrid workspace

This repository keeps both OpenCut generations isolated so they can be migrated safely:

- `/classic` is the working Next.js editor from `OpenCut-app/opencut-classic`.
- The repository root is the current OpenCut rewrite (Vite, Rust core, and GPUI desktop).

Do not copy UI state or rendering logic directly between the applications. New HovaCut business data (voice scripts, TTS jobs, export manifests) should be defined as framework-independent schemas first, then adapted to Classic and eventually moved into the Rust core.

## Run the working editor

From PowerShell at the repository root:

```powershell
.\scripts\start-classic.ps1
```

Open <http://localhost:3000>. Docker is optional for the editor UI; account, database, and Redis features require the services documented in `classic/README.md`.

The first local automation workflow is available at <http://localhost:3000/automation>:

- image + audio to H.264/AAC MP4;
- auto video: choose one random background from up to 30 videos, loop it to the audio duration, and render H.264/AAC;
- Full HD and 4K presets;
- media conversion to MP3 320 kbps, WAV PCM, or H.264/AAC MP4;
- join 2–50 audio files into a 320 kbps MP3 playlist, with optional random ordering;
- FFmpeg availability check and downloadable completed jobs.

The PowerShell launcher enables the local-only API and uses `E:\CGT Auto Tools v1.3.0\ffmpeg.exe` when present. Override `HOVACUT_FFMPEG_PATH` before launching to select another build. The execution API stays disabled on normal public deployments.

## Run the rewrite

```powershell
.\scripts\start-rewrite.ps1
```

Open <http://localhost:5173>. Its editor route is intentionally still a placeholder upstream.

## Migration boundary

1. Ship editor workflows in Classic.
2. Keep HovaCut-specific schemas independent from React and Next.js.
3. Add adapters instead of modifying Classic's renderer contract unnecessarily.
4. Port stable business logic to the rewrite's Rust core incrementally.
