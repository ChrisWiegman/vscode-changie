import * as vscode from "vscode";
import type { ReleaseInfo, WorkspaceInfo } from "./types";

export class ReleaseItem extends vscode.TreeItem {
	constructor(public readonly release: ReleaseInfo) {
		super(release.version, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = release.date;
		this.iconPath = new vscode.ThemeIcon("tag");
		this.contextValue = "release";
		this.tooltip = `${release.version} — ${release.date}`;
		this.command = {
			command: "vscode.open",
			title: "Open Release File",
			arguments: [vscode.Uri.file(release.filePath)],
		};
	}
}

export class ReleaseKindItem extends vscode.TreeItem {
	constructor(
		kind: string,
		public readonly entries: ReleaseEntryItem[],
	) {
		super(kind, vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${entries.length}`;
		this.iconPath = new vscode.ThemeIcon("symbol-property");
		this.contextValue = "releaseKind";
	}
}

export class ReleaseEntryItem extends vscode.TreeItem {
	constructor(body: string, filePath: string) {
		super(body, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon("note");
		this.contextValue = "releaseEntry";
		this.command = {
			command: "vscode.open",
			title: "Open Release File",
			arguments: [vscode.Uri.file(filePath)],
		};
	}
}

export type ReleasesNode = ReleaseItem | ReleaseKindItem | ReleaseEntryItem;

export class ReleasesProvider implements vscode.TreeDataProvider<ReleasesNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<
		ReleasesNode | undefined | null | void
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private workspaces: WorkspaceInfo[] = [];

	setWorkspaces(workspaces: WorkspaceInfo[]): void {
		this.workspaces = workspaces;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ReleasesNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: ReleasesNode): ReleasesNode[] {
		if (element instanceof ReleaseItem) {
			const byKind = new Map<string, string[]>();
			for (const { kind, body } of element.release.entries) {
				const existing = byKind.get(kind) ?? [];
				existing.push(body);
				byKind.set(kind, existing);
			}
			return [...byKind.entries()].map(([kind, bodies]) => {
				const entryItems = bodies.map(
					(b) => new ReleaseEntryItem(b, element.release.filePath),
				);
				return new ReleaseKindItem(kind, entryItems);
			});
		}

		if (element instanceof ReleaseKindItem) {
			return element.entries;
		}

		if (element instanceof ReleaseEntryItem) {
			return [];
		}

		return this.buildRootItems();
	}

	private buildRootItems(): ReleasesNode[] {
		const allReleases = this.workspaces.flatMap((ws) => ws.releases);
		allReleases.sort((a, b) =>
			b.version.localeCompare(a.version, undefined, { numeric: true }),
		);
		return allReleases.map((r) => new ReleaseItem(r));
	}
}
