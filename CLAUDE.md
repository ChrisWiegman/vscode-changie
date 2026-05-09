# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run compile          # TypeScript compile (output to out/)
npm run watch            # Watch mode
npm run lint             # Biome linter
npm test                 # Compile + unit tests (Mocha, no VS Code host)
npm run test:extension   # Integration tests (requires VS Code host)
make package             # Build .vsix for distribution
```

Unit tests run only `out/test/changie.test.js` — they cover `changie.ts` utilities and run without VS Code. To run a single test, use Mocha's `--grep` flag directly:

```bash
npx mocha out/test/changie.test.js --grep "parseSimpleYaml"
```

## Architecture

The extension has two primary concerns: reading changie's file system layout and presenting it as VS Code tree views.

**File system layer** (`changie.ts`) — all disk I/O lives here. Reads `.changie.yaml` config, scans `.changes/unreleased/*.yaml` for pending entries, and scans `.changes/*.md` (files starting with a digit) for released versions. Uses a hand-rolled regex YAML parser rather than a library dependency. Executes the `changie` CLI via `execFile` for write operations (new entry, batch, merge).

**Two tree providers** — `changelogProvider.ts` serves `changie.entries` (2-level: Kind → Entry). `releasesProvider.ts` serves `changie.releases` (3-level: Version → Kind → Entry). Both receive a `WorkspaceInfo[]` array via `setWorkspaces()` and call `refresh()` to signal data changes; they hold no file-system logic themselves.

**Activation flow** (`extension.ts`) — critical ordering constraint: `changie.isConfigured` context key must be **awaited** before calling `createTreeView`, because VS Code only registers views with `when` clauses after the clause evaluates to true. `getChangieWorkspaces()` is called synchronously at the top of `activate()` for this purpose, then called again inside `refresh()` on every subsequent update.

**Multi-workspace support** — all workspace folders are scanned for `.changie.yaml`. Entries and releases from all workspaces are merged into flat lists. Kind labels are suffixed with `(workspaceName)` only when entries of the same kind exist across multiple workspaces.

**File watchers** — a watcher on `${changesDir}/**` per workspace folder drives automatic refresh. Watchers are torn down and rebuilt on `onDidChangeWorkspaceFolders`.
