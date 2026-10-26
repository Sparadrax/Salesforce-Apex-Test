# Salesforce-Apex-Test

Electron desktop application foundation using Electron Forge, Vite, and TypeScript.

## Requirements

- Node.js 24 LTS (Node 22.17+ is supported by Forge)
- npm and Git
- Windows for the Windows installer

## Development

```powershell
npm ci
npm start
```

`npm run dev` also starts development. Renderer changes update through Vite.
Use the View menu to toggle Developer Tools.

## Checks and distribution

```powershell
npm run typecheck
npm run lint
npm test
npm run package
npm run test:electron
npm run make
```

`package` creates the unpacked desktop app in `out/`.
`make` creates a Windows Squirrel installer in `out/make/` on Windows.
Installers are unsigned until code signing is configured.
`npm run lint:fix` formats code and applies available lint fixes.

## Structure and conventions

See [architecture](docs/architecture.md) for module boundaries, feature organization, and performance practices. See [AGENTS.md](AGENTS.md) for persistent contributor instructions.

- `src/main/`: application lifecycle and native window management
- `src/preload/`: narrow desktop API bridge
- `src/renderer/`: UI bootstrap, feature modules, and styles
- `src/shared/contracts/`: shared API types

Node integration is disabled in the renderer. Never put Salesforce secrets in renderer code or commit credentials.

The first screen lists organizations with an Add organization action. Clicking an org opens its latest dated test run in a new window with JSON import, a complete run picklist, and linked Apex-class, test-class, and method tables. The same org can be opened in multiple independent windows. See [org import](docs/org-import.md) for formats and behavior. Salesforce authentication and executing Apex tests are not implemented yet.

## Local database

Embedded SQLite storage is initialized automatically in the operating-system application-data folder. It uses a dedicated worker, transactional migrations, WAL mode, indexed cursor pagination, and bounded batch writes. No external database setup is needed. See [database documentation](docs/database.md) for API examples, limits, backups, and test instructions.

The [SFCC model](docs/sfcc-model.md) recreates the seven tables from the legacy MariaDB definition, with org-scoped relationships and calculated coverage percentages. Schema version 5 includes deployment JSON, normalized test outcomes, and indexed coverage drill-down. Existing MariaDB data is not imported.
