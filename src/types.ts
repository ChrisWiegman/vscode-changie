export interface KindConfig {
	label: string;
}

export interface ChangieConfig {
	changesDir: string;
	unreleasedDir: string;
	changelogPath: string;
	kinds: KindConfig[];
}

export interface ChangeEntry {
	kind: string;
	body: string;
	time?: string;
	filePath: string;
	workspaceRoot: string;
	workspaceName: string;
}

export interface ReleaseEntry {
	kind: string;
	body: string;
}

export interface ReleaseInfo {
	version: string;
	date: string;
	filePath: string;
	workspaceRoot: string;
	workspaceName: string;
	entries: ReleaseEntry[];
}

export interface WorkspaceInfo {
	root: string;
	name: string;
	config: ChangieConfig;
	entries: ChangeEntry[];
	releases: ReleaseInfo[];
}
