import * as path from "path";
import * as vscode from "vscode";
import type { ChangeEntry, WorkspaceInfo } from "./types";

export class KindItem extends vscode.TreeItem {
	readonly entries: EntryItem[];

	constructor(kind: string, entries: EntryItem[]) {
		super(kind, vscode.TreeItemCollapsibleState.Expanded);
		this.entries = entries;
		this.contextValue = "kind";
		this.iconPath = new vscode.ThemeIcon("symbol-property");
		this.description = `${entries.length}`;
	}
}

export class EntryItem extends vscode.TreeItem {
	readonly entry: ChangeEntry;

	constructor(entry: ChangeEntry) {
		super(entry.body, vscode.TreeItemCollapsibleState.None);

		this.entry = entry;
		this.contextValue = "entry";
		this.iconPath = new vscode.ThemeIcon("note");
		this.tooltip = new vscode.MarkdownString(
			`**${entry.kind}**\n\n${entry.body}\n\n*${entry.workspaceName}*`,
		);
		this.command = {
			command: "vscode.open",
			title: "Open Entry",
			arguments: [vscode.Uri.file(entry.filePath)],
		};
		this.resourceUri = vscode.Uri.file(entry.filePath);
	}
}

export type TreeNode = KindItem | EntryItem;

function groupByKind(entries: ChangeEntry[]): Map<string, ChangeEntry[]> {
	const map = new Map<string, ChangeEntry[]>();

	for (const entry of entries) {
		const existing = map.get(entry.kind) ?? [];

		existing.push(entry);

		map.set(entry.kind, existing);
	}

	return map;
}

export class ChangelogProvider implements vscode.TreeDataProvider<TreeNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<
		TreeNode | undefined | null | void
	>();

	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private workspaces: WorkspaceInfo[] = [];

	setWorkspaces(workspaces: WorkspaceInfo[]): void {
		this.workspaces = workspaces;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TreeNode): TreeNode[] {
		if (element instanceof KindItem) {
			return element.entries;
		}

		if (element instanceof EntryItem) {
			return [];
		}

		return this.buildRootItems();
	}

	private buildRootItems(): TreeNode[] {
		const allEntries = this.workspaces.flatMap((ws) => ws.entries);

		if (allEntries.length === 0) return [];

		const byKind = groupByKind(allEntries);
		const items: KindItem[] = [];

		for (const [kind, entries] of byKind) {
			const entryItems = entries.map((e) => new EntryItem(e));
			const label =
				this.workspaces.length > 1
					? this.kindLabelWithWorkspace(kind, entries)
					: kind;
			const kindItem = new KindItem(label, entryItems);

			items.push(kindItem);
		}

		return items;
	}

	private kindLabelWithWorkspace(kind: string, entries: ChangeEntry[]): string {
		const workspaceNames = [...new Set(entries.map((e) => e.workspaceName))];

		if (workspaceNames.length === 1) {
			return `${kind} (${workspaceNames[0]})`;
		}

		return kind;
	}

	getEntryFilePath(label: string): string | undefined {
		const all = this.workspaces.flatMap((ws) => ws.entries);

		return all.find((e) => e.body === label || path.basename(e.filePath) === label)?.filePath;
	}

	getTotalUnreleased(): number {
		return this.workspaces.reduce((sum, ws) => sum + ws.entries.length, 0);
	}
}
