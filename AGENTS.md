# Project conventions

Maintain a modular Electron application with clear process boundaries. Read docs/architecture.md before adding features.

- Keep startup entry points small. Organize functionality by feature, not one large shared utility directory.
- Main owns operating-system access, Salesforce integrations, credentials, and long-running work. Renderer owns presentation. Preload exposes a narrow, typed API.
- Share plain contracts in src/shared/contracts; never import main or preload code into the renderer.
- Favor simple, measured optimizations: asynchronous I/O, lazy loading for heavy optional features, bounded concurrency, paginated data, and explicit listener cleanup. Avoid speculative caching and unnecessary dependencies.
- Never block Electron's main thread with CPU-intensive tasks; move substantial parsing or computation to workers when needed.
- Validate IPC payloads and sender origins at runtime. Do not expose generic IPC, shell, filesystem, or credential access to the renderer.
- Add meaningful tests for new business behavior; run targeted source checks and tests during development. Per user preference, do not rebuild/package after every change. Build/package only on request or when specifically necessary to investigate a build issue; this overrides routine packaging guidance below and in other project docs.
- Maintain Windows and macOS compatibility; use node:path and avoid hardcoded platform paths in application code.
- When the user requests a rebuild, stop running Salesforce Apex Test app processes first if needed; the user explicitly authorizes killing them for rebuilds. Always build into the standard out directory. Do not use alternate output folders to work around locked files.
- Update architecture documentation when introducing a new layer or dependency.
- Keep SQLite work in the database worker. Append migrations, use parameterized indexed queries, and preserve batch/page/queue limits. Read docs/database.md before modifying storage. Run source database/worker tests for database changes; run the packaged Electron smoke test only when a build is requested or specifically required.
