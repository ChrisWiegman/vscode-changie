import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import type { ChangeEntry, ChangieConfig, ReleaseEntry, ReleaseInfo } from "./types";

const execFileAsync = promisify(execFile);

const DEFAULT_KINDS = [
	{ label: "Added" },
	{ label: "Changed" },
	{ label: "Deprecated" },
	{ label: "Removed" },
	{ label: "Fixed" },
	{ label: "Security" },
];

export function parseSimpleYaml(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const match = line.match(/^([\w-]+):\s*(.*)$/);
		if (match) {
			const value = match[2].trim();
			result[match[1]] = value.replace(/^['"](.*)['"]$/, "$1");
		}
	}
	return result;
}

export function parseKindsFromConfig(content: string): Array<{ label: string }> {
	const kinds: Array<{ label: string }> = [];
	const kindsBlock = content.match(/^kinds:\s*\n((?:[ \t]+-[^\n]*\n?)*)/m);
	if (!kindsBlock) return kinds;

	for (const line of kindsBlock[1].split("\n")) {
		const labelMatch = line.match(/\s*-\s*label:\s*(.+)/);
		if (labelMatch) {
			kinds.push({ label: labelMatch[1].trim() });
		}
	}
	return kinds;
}

export function findConfigPath(workspaceRoot: string): string | undefined {
	for (const name of [".changie.yaml", ".changie.yml"]) {
		const p = path.join(workspaceRoot, name);
		if (fs.existsSync(p)) return p;
	}
	return undefined;
}

export function readConfig(workspaceRoot: string): ChangieConfig | undefined {
	const configPath = findConfigPath(workspaceRoot);
	if (!configPath) return undefined;

	let content: string;
	try {
		content = fs.readFileSync(configPath, "utf-8");
	} catch {
		return undefined;
	}

	const parsed = parseSimpleYaml(content);
	const kinds = parseKindsFromConfig(content);

	return {
		changesDir: parsed.changesDir ?? ".changes",
		unreleasedDir: parsed.unreleasedDir ?? "unreleased",
		changelogPath: parsed.changelogPath ?? "CHANGELOG.md",
		kinds: kinds.length > 0 ? kinds : DEFAULT_KINDS,
	};
}

export function readUnreleasedEntries(
	workspaceRoot: string,
	workspaceName: string,
	config: ChangieConfig,
): ChangeEntry[] {
	const dir = path.join(workspaceRoot, config.changesDir, config.unreleasedDir);
	if (!fs.existsSync(dir)) return [];

	let files: string[];
	try {
		files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
	} catch {
		return [];
	}

	const entries: ChangeEntry[] = [];
	for (const file of files) {
		const filePath = path.join(dir, file);
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const data = parseSimpleYaml(content);
			entries.push({
				kind: data.kind ?? "Unknown",
				body: data.body ?? "",
				time: data.time,
				filePath,
				workspaceRoot,
				workspaceName,
			});
		} catch {
			// skip malformed files
		}
	}

	return entries;
}

function parseReleaseFile(
	content: string,
	filePath: string,
	workspaceRoot: string,
	workspaceName: string,
): ReleaseInfo | undefined {
	const lines = content.split("\n");
	const headerMatch = lines[0]?.match(/^##\s+(.+?)\s+-\s+(\d{4}-\d{2}-\d{2})/);
	if (!headerMatch) return undefined;

	const version = headerMatch[1].trim();
	const date = headerMatch[2];
	const entries: ReleaseEntry[] = [];
	let currentKind = "";

	for (const line of lines.slice(1)) {
		const kindMatch = line.match(/^###\s+(.+)/);
		if (kindMatch) {
			currentKind = kindMatch[1].trim();
			continue;
		}
		const entryMatch = line.match(/^\*\s+(.+)/);
		if (entryMatch && currentKind) {
			entries.push({ kind: currentKind, body: entryMatch[1].trim() });
		}
	}

	return { version, date, filePath, workspaceRoot, workspaceName, entries };
}

export function readReleases(
	workspaceRoot: string,
	workspaceName: string,
	config: ChangieConfig,
): ReleaseInfo[] {
	const changesDir = path.join(workspaceRoot, config.changesDir);
	if (!fs.existsSync(changesDir)) return [];

	let files: string[];
	try {
		files = fs.readdirSync(changesDir).filter((f) => /^\d/.test(f) && f.endsWith(".md"));
	} catch {
		return [];
	}

	const releases: ReleaseInfo[] = [];
	for (const file of files) {
		const filePath = path.join(changesDir, file);
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const release = parseReleaseFile(content, filePath, workspaceRoot, workspaceName);
			if (release) releases.push(release);
		} catch {
			// skip malformed files
		}
	}

	return releases.sort((a, b) =>
		b.version.localeCompare(a.version, undefined, { numeric: true }),
	);
}

export function findChangieBin(workspaceRoot: string, configuredPath?: string): string {
	if (configuredPath) return configuredPath;

	const local = path.join(workspaceRoot, "node_modules", ".bin", "changie");
	if (fs.existsSync(local)) return local;

	return "changie";
}

export async function runChangie(
	workspaceRoot: string,
	args: string[],
	configuredPath?: string,
): Promise<string> {
	const bin = findChangieBin(workspaceRoot, configuredPath);
	const { stdout, stderr } = await execFileAsync(bin, args, { cwd: workspaceRoot });
	if (stderr) throw new Error(stderr);
	return stdout;
}
