# MCACS Unity MVP

This project is an isolated vertical slice. It does not replace or edit any view in `town-frontend`.

The MVP proves one complete management loop:

1. Load the first online player from the existing MCACS API.
2. Move the duty officer with WASD to the red command terminal.
3. Press E to submit an idempotent warning command.
4. Poll the persisted command until the Paper plugin reports success or failure.

Build with Unity 6000.0.83f1 and the Web module:

```powershell
unity build .\unity-client --target WebGL --editor-version 6000.0.83f1 --execute-method Mcacs.UnityMvp.Editor.BuildWeb --allow-dirty-build
```

After building, the existing MCACS HTTP service exposes `Build/Web` at `/unity-mvp/`. Open it with the existing development token when authentication is enabled:

```text
https://your-mcacs-host/unity-mvp/?token=ACS_AUTH_SECRET
```

For a local standalone static server, pass the API origin explicitly:

```text
http://127.0.0.1:8080/?apiBase=http://127.0.0.1:55210&token=ACS_AUTH_SECRET
```

The current HTML/Three.js application remains the default production view during this migration.
