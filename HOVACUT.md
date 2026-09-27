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
