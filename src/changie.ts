import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
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

function isWithinDirectory(parent: string, childRelative: string): boolean {
	const resolvedParent = path.resolve(parent);
	const resolvedChild = path.resolve(parent, childRelative);

	return resolvedChild === resolvedParent || resolvedChild.startsWith(resolvedParent + path.sep);
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

	const changesDir = parsed.changesDir ?? ".changes";
	const unreleasedDir = parsed.unreleasedDir ?? "unreleased";
	const changelogPath = parsed.changelogPath ?? "CHANGELOG.md";

	if (
		!isWithinDirectory(workspaceRoot, changesDir) ||
		!isWithinDirectory(workspaceRoot, path.join(changesDir, unreleasedDir)) ||
		!isWithinDirectory(workspaceRoot, changelogPath)
	) {
		return undefined;
	}

	return {
		changesDir,
		unreleasedDir,
		changelogPath,
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

	// VS Code on macOS/Linux may not inherit the user's shell PATH, so check
	// common install locations for changie (a Go binary).
	const commonPaths = [
		path.join(os.homedir(), "go", "bin", "changie"),
		"/opt/homebrew/bin/changie",
		"/usr/local/bin/changie",
		path.join(os.homedir(), ".local", "bin", "changie"),
	];

	for (const p of commonPaths) {
		if (fs.existsSync(p)) return p;
	}

	return "changie";
}

export async function runChangie(
	workspaceRoot: string,
	args: string[],
	configuredPath?: string,
): Promise<string> {
	const bin = findChangieBin(workspaceRoot, configuredPath);
	const extraPaths = [
		path.join(os.homedir(), "go", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		path.join(os.homedir(), ".local", "bin"),
	];
	const env = {
		...process.env,
		PATH: [...extraPaths, process.env.PATH ?? ""].join(path.delimiter),
	};
	const { stdout, stderr } = await execFileAsync(bin, args, { cwd: workspaceRoot, env });

	if (stderr) throw new Error(stderr);

	return stdout;
}

export async function runGitCommit(
	workspaceRoot: string,
	filePaths: string[],
	message: string,
): Promise<void> {
	await execFileAsync("git", ["add", "--", ...filePaths], { cwd: workspaceRoot });
	await execFileAsync("git", ["commit", "-m", message], { cwd: workspaceRoot });
}

export function isChangieInPackageJson(workspaceRoot: string): boolean {
	const pkgPath = path.join(workspaceRoot, "package.json");

	if (!fs.existsSync(pkgPath)) return false;

	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
		const deps = {
			...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
			...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
		};

		return "changie" in deps;
	} catch {
		return false;
	}
}

export function normalizeVersion(v: string): string {
	return v.replace(/^v/, "");
}

export interface VersionBumpResult {
	bumped: boolean;
	noVersionField: boolean;
}

export function updatePackageVersionFiles(
	workspaceRoot: string,
	version: string,
): VersionBumpResult {
	const semver = normalizeVersion(version);

	// Reject versions that would break JSON structure or contain control characters
	if (!/^\d/.test(semver) || semver.includes("\"") || semver.includes("\n") || semver.includes("\r")) {
		return { bumped: false, noVersionField: false };
	}

	const pkgPath = path.join(workspaceRoot, "package.json");

	if (!fs.existsSync(pkgPath)) return { bumped: false, noVersionField: false };

	let pkgContent: string;
	let pkg: Record<string, unknown>;

	try {
		pkgContent = fs.readFileSync(pkgPath, "utf-8");
		pkg = JSON.parse(pkgContent) as Record<string, unknown>;
	} catch {
		return { bumped: false, noVersionField: false };
	}

	if (typeof pkg.version !== "string") {
		return { bumped: false, noVersionField: true };
	}

	// Use a function replacement to prevent special replacement patterns ($&, $', $`) from
	// being interpreted when the version string contains those characters.
	const updatedPkg = pkgContent.replace(/"version":\s*"[^"]*"/, () => `"version": "${semver}"`);

	if (updatedPkg !== pkgContent) {
		fs.writeFileSync(pkgPath, updatedPkg);
	}

	const lockPath = path.join(workspaceRoot, "package-lock.json");

	if (fs.existsSync(lockPath)) {
		try {
			const lockContent = fs.readFileSync(lockPath, "utf-8");
			const lock = JSON.parse(lockContent) as Record<string, unknown>;

			let changed = false;

			if (typeof lock.version === "string") {
				lock.version = semver;
				changed = true;
			}

			const packages = lock.packages as Record<string, Record<string, unknown>> | undefined;

			if (packages?.[""] && typeof packages[""].version === "string") {
				packages[""].version = semver;

				changed = true;
			}

			if (changed) {
				const indentMatch = lockContent.match(/^{\n(\s+)/);
				const indent = indentMatch ? indentMatch[1] : "  ";

				fs.writeFileSync(lockPath, JSON.stringify(lock, null, indent) + "\n");
			}
		} catch {
			// skip malformed lock file
		}
	}

	return { bumped: true, noVersionField: false };
}
