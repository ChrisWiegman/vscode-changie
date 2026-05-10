import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ChangelogProvider, EntryItem } from "./changelogProvider";
import { findChangieBin, readConfig, readReleases, readUnreleasedEntries, runChangie, updatePackageVersionFiles } from "./changie";
import { ReleasesProvider } from "./releasesProvider";
import type { ChangieConfig, WorkspaceInfo } from "./types";

export interface ExtensionApi {
	readonly provider: ChangelogProvider;
	readonly releasesProvider: ReleasesProvider;
}

const VERSION_OPTIONS = [
	{ label: "auto", description: "Automatically determine version from change kinds" },
	{ label: "major", description: "Increment major version (breaking changes)" },
	{ label: "minor", description: "Increment minor version (new features)" },
	{ label: "patch", description: "Increment patch version (bug fixes)" },
	{ label: "$(edit) Custom...", description: "Enter a specific version number" },
];

function bumpVersionFiles(workspaceRoot: string, version: string): void {
	const result = updatePackageVersionFiles(workspaceRoot, version);
	if (result.noVersionField) {
		void vscode.window.showWarningMessage(
			"Changie: package.json has no version field — skipped automatic version update.",
		);
	}
}

function getConfiguredPath(): string | undefined {
	const config = vscode.workspace.getConfiguration("changie");
	const p = config.get<string>("executablePath", "");
	return p.length > 0 ? p : undefined;
}

function getChangieWorkspaces(): WorkspaceInfo[] {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) return [];

	const results: WorkspaceInfo[] = [];
	for (const folder of folders) {
		const root = folder.uri.fsPath;
		const config = readConfig(root);
		if (!config) continue;

		const entries = readUnreleasedEntries(root, folder.name, config);
		const releases = readReleases(root, folder.name, config);
		results.push({ root, name: folder.name, config, entries, releases });
	}
	return results;
}

async function pickWorkspace(workspaces: WorkspaceInfo[]): Promise<WorkspaceInfo | undefined> {
	if (workspaces.length === 0) {
		void vscode.window.showErrorMessage(
			"No changie configuration found. Add a .changie.yaml to your workspace.",
		);
		return undefined;
	}
	if (workspaces.length === 1) return workspaces[0];

	const picked = await vscode.window.showQuickPick(
		workspaces.map((ws) => ({ label: ws.name, description: ws.root, ws })),
		{ placeHolder: "Select workspace folder" },
	);
	return picked?.ws;
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
	// Resolve workspaces and set context key before creating tree views so that
	// views with 'when: changie.isConfigured' are registered by the time createTreeView runs.
	let currentWorkspaces = getChangieWorkspaces();
	await vscode.commands.executeCommand(
		"setContext",
		"changie.isConfigured",
		currentWorkspaces.length > 0,
	);

	const provider = new ChangelogProvider();
	const releasesProvider = new ReleasesProvider();
	provider.setWorkspaces(currentWorkspaces);
	releasesProvider.setWorkspaces(currentWorkspaces);

	const treeView = vscode.window.createTreeView("changie.entries", {
		treeDataProvider: provider,
		showCollapseAll: true,
	});
	context.subscriptions.push(treeView);

	const releasesView = vscode.window.createTreeView("changie.releases", {
		treeDataProvider: releasesProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(releasesView);

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
	statusBar.command = "changie.newEntry";
	context.subscriptions.push(statusBar);

	function refresh(): void {
		currentWorkspaces = getChangieWorkspaces();
		provider.setWorkspaces(currentWorkspaces);
		provider.refresh();
		releasesProvider.setWorkspaces(currentWorkspaces);
		releasesProvider.refresh();

		const configured = currentWorkspaces.length > 0;
		void vscode.commands.executeCommand("setContext", "changie.isConfigured", configured);

		const total = provider.getTotalUnreleased();
		if (configured) {
			statusBar.text = total === 0 ? "$(list-unordered) No unreleased" : `$(list-unordered) ${total} unreleased`;
			statusBar.tooltip = "Changie: click to add a new changelog entry";
			statusBar.show();
			treeView.message = total === 0 ? "No unreleased changelog entries." : undefined;
		} else {
			statusBar.hide();
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("changie.refresh", () => {
			refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"changie.newEntry",
			async (args?: { kind?: string; body?: string }) => {
				const ws = await pickWorkspace(currentWorkspaces);
				if (!ws) return;

				const kind =
					args?.kind ??
					(await pickKind(ws.config));
				if (!kind) return;

				const body =
					args?.body ??
					(await vscode.window.showInputBox({
						prompt: "Describe the change",
						placeHolder: "e.g. Added support for dark mode",
						validateInput: (v) => (v.trim().length === 0 ? "Body cannot be empty" : undefined),
					}));
				if (!body) return;

				try {
					await runChangie(ws.root, ["new", "--kind", kind, "--body", body.trim()], getConfiguredPath());
					refresh();
					void vscode.window.showInformationMessage(`Changelog entry added: [${kind}] ${body.trim()}`);
				} catch (err) {
					void vscode.window.showErrorMessage(`changie new failed: ${String(err)}`);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("changie.batchRelease", async () => {
			const ws = await pickWorkspace(currentWorkspaces);
			if (!ws) return;

			if (ws.entries.length === 0) {
				void vscode.window.showInformationMessage("No unreleased entries to batch.");
				return;
			}

			const picked = await vscode.window.showQuickPick(VERSION_OPTIONS, {
				placeHolder: "Select version bump strategy",
			});
			if (!picked) return;

			let version = picked.label.replace(/^\$\([^)]+\)\s*/, "");
			if (version === "Custom...") {
				const custom = await vscode.window.showInputBox({
					prompt: "Enter version number",
					placeHolder: "e.g. v1.2.3",
					validateInput: (v) => (v.trim().length === 0 ? "Version cannot be empty" : undefined),
				});
				if (!custom) return;
				version = custom.trim();
			}

			try {
				const changesDir = path.join(ws.root, ws.config.changesDir);
				const beforeFiles = fs.existsSync(changesDir)
					? new Set(fs.readdirSync(changesDir).filter((f) => /^\d/.test(f) && f.endsWith(".md")))
					: new Set<string>();

				await runChangie(ws.root, ["batch", version], getConfiguredPath());

				let resolvedVersion = version;
				if (fs.existsSync(changesDir)) {
					const newFile = fs
						.readdirSync(changesDir)
						.filter((f) => /^\d/.test(f) && f.endsWith(".md"))
						.find((f) => !beforeFiles.has(f));
					if (newFile) {
						const content = fs.readFileSync(path.join(changesDir, newFile), "utf-8");
						const match = content.split("\n")[0]?.match(/^##\s+(.+?)\s+-\s+\d{4}-\d{2}-\d{2}/);
						if (match) resolvedVersion = match[1].trim();
					}
				}

				await runChangie(ws.root, ["merge"], getConfiguredPath());

				const shouldUpdate = vscode.workspace
					.getConfiguration("changie")
					.get<boolean>("updateVersionFiles", true);
				if (shouldUpdate) {
					bumpVersionFiles(ws.root, resolvedVersion);
				}

				refresh();

				const changelogUri = vscode.Uri.file(path.join(ws.root, ws.config.changelogPath));
				if (fs.existsSync(changelogUri.fsPath)) {
					await vscode.window.showTextDocument(changelogUri);
				}

				void vscode.window.showInformationMessage(
					`Batched and merged ${resolvedVersion} into ${ws.config.changelogPath}.`,
				);
			} catch (err) {
				void vscode.window.showErrorMessage(`changie batch/merge failed: ${String(err)}`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("changie.mergeChangelog", async () => {
			const ws = await pickWorkspace(currentWorkspaces);
			if (!ws) return;

			const confirmed = await vscode.window.showWarningMessage(
				`Merge all versioned entries into ${ws.config.changelogPath}?`,
				{ modal: true },
				"Merge",
			);
			if (confirmed !== "Merge") return;

			try {
				await runChangie(ws.root, ["merge"], getConfiguredPath());
				refresh();

				const changelogUri = vscode.Uri.file(path.join(ws.root, ws.config.changelogPath));
				if (fs.existsSync(changelogUri.fsPath)) {
					await vscode.window.showTextDocument(changelogUri);
				}

				void vscode.window.showInformationMessage("Changelog merged successfully.");
			} catch (err) {
				void vscode.window.showErrorMessage(`changie merge failed: ${String(err)}`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("changie.openChangelog", async () => {
			const ws = await pickWorkspace(currentWorkspaces);
			if (!ws) return;

			const changelogUri = vscode.Uri.file(path.join(ws.root, ws.config.changelogPath));
			if (!fs.existsSync(changelogUri.fsPath)) {
				void vscode.window.showErrorMessage(`${ws.config.changelogPath} not found.`);
				return;
			}
			await vscode.window.showTextDocument(changelogUri);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("changie.deleteEntry", async (item: EntryItem) => {
			const confirmed = await vscode.window.showWarningMessage(
				`Delete entry: "${item.entry.body}"?`,
				{ modal: true },
				"Delete",
			);
			if (confirmed !== "Delete") return;

			const resolvedFile = path.resolve(item.entry.filePath);
			const resolvedRoot = path.resolve(item.entry.workspaceRoot);
			if (!resolvedFile.startsWith(resolvedRoot + path.sep)) {
				void vscode.window.showErrorMessage("Cannot delete entry: path is outside workspace.");
				return;
			}

			try {
				fs.unlinkSync(item.entry.filePath);
				refresh();
			} catch (err) {
				void vscode.window.showErrorMessage(`Failed to delete entry: ${String(err)}`);
			}
		}),
	);

	setupFileWatchers(context, refresh);

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			setupFileWatchers(context, refresh);
			refresh();
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("changie")) {
				refresh();
			}
		}),
	);

	refresh();

	return { provider, releasesProvider };
}

async function pickKind(config: ChangieConfig): Promise<string | undefined> {
	if (config.kinds.length === 0) {
		return vscode.window.showInputBox({
			prompt: "Enter the kind of change",
			placeHolder: "e.g. Features",
		});
	}

	const picked = await vscode.window.showQuickPick(
		config.kinds.map((k) => k.label),
		{ placeHolder: "Select kind of change" },
	);
	return picked;
}

const watchers: vscode.FileSystemWatcher[] = [];

function setupFileWatchers(
	context: vscode.ExtensionContext,
	refresh: () => void,
): void {
	for (const w of watchers) w.dispose();
	watchers.length = 0;

	const folders = vscode.workspace.workspaceFolders ?? [];
	for (const folder of folders) {
		const config = readConfig(folder.uri.fsPath);
		if (!config) continue;

		const pattern = new vscode.RelativePattern(folder, `${config.changesDir}/**`);
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);
		watcher.onDidCreate(() => refresh());
		watcher.onDidDelete(() => refresh());
		watcher.onDidChange(() => refresh());
		context.subscriptions.push(watcher);
		watchers.push(watcher);
	}
}

export function deactivate(): void {
	for (const w of watchers) w.dispose();
	watchers.length = 0;
}

export function isChangieAvailable(workspaceRoot: string): boolean {
	const bin = findChangieBin(workspaceRoot, getConfiguredPath());
	try {
		fs.accessSync(bin, fs.constants.X_OK);
		return true;
	} catch {
		return bin === "changie";
	}
}
