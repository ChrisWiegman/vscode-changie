# VS Code Changie

Manage [changie](https://changie.dev) changelog entries without leaving your editor. Add new entries, batch them into a release, and browse your full release history — all from the VS Code sidebar.

## Features

### Unreleased Changes panel

The sidebar shows all pending changelog entries grouped by kind. Click any entry to open its source YAML file. When there are no pending entries, the panel shows a clear empty state.

### Releases panel

Browse every past release in a collapsible tree: version and date at the top level, change kinds as groups, individual entries underneath. Click any item to open the corresponding release file.

### Commands

All commands are available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| **Changie: Add New Changelog Entry** | Prompts for kind and description, then writes a new entry file via the `changie new` CLI |
| **Changie: Batch for Release** | Collects unreleased entries into a versioned release file. Choose `auto`, `major`, `minor`, `patch`, or a custom version string |
| **Changie: Merge Changelog** | Runs `changie merge` to combine all versioned files into `CHANGELOG.md` |
| **Changie: Open CHANGELOG.md** | Opens the merged changelog in the editor |
| **Changie: Refresh** | Manually re-reads the changes directory |

Toolbar buttons for the most common actions appear at the top of each sidebar panel.

### Inline actions

Right-click any unreleased entry in the sidebar to delete it.

### Status bar

A status bar item shows the count of unreleased entries. Click it to add a new entry.

### Multi-workspace support

All workspace folders are scanned for a `.changie.yaml` configuration. Entries and releases from every folder appear together. When a kind has entries from more than one workspace, the workspace name is shown alongside the kind label.

## Requirements

The `changie` CLI must be available. The extension looks for it in this order:

1. The path configured in `changie.executablePath`
2. `node_modules/.bin/changie` in the workspace root
3. `changie` on `$PATH`

Install changie via the [official instructions](https://changie.dev/guide/installation/) or as an npm dev dependency:

```bash
npm install --save-dev changie
```

## Configuration

| Setting | Default | Description |
|---|---|---|
| `changie.executablePath` | *(empty)* | Explicit path to the changie binary. Leave empty to use auto-detection. |

## Getting started

1. Add a `.changie.yaml` to your workspace root (run `changie init` if you don't have one yet).
2. Open the Changie panel in the activity bar.
3. Click **+** to add your first changelog entry.

The sidebar refreshes automatically when entry files are created, modified, or deleted.
