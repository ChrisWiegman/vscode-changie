import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, it } from "mocha";
import {
	findChangieBin,
	findConfigPath,
	normalizeVersion,
	parseKindsFromConfig,
	parseSimpleYaml,
	readConfig,
	readUnreleasedEntries,
	updatePackageVersionFiles,
} from "../src/changie";

describe("parseSimpleYaml", () => {
	it("parses simple key: value pairs", () => {
		const result = parseSimpleYaml("foo: bar\nbaz: qux");
		assert.strictEqual(result.foo, "bar");
		assert.strictEqual(result.baz, "qux");
	});

	it("strips surrounding single quotes", () => {
		const result = parseSimpleYaml("kind: 'Features'");
		assert.strictEqual(result.kind, "Features");
	});

	it("strips surrounding double quotes", () => {
		const result = parseSimpleYaml('body: "Fixed the bug"');
		assert.strictEqual(result.body, "Fixed the bug");
	});

	it("handles keys with hyphens", () => {
		const result = parseSimpleYaml("changes-dir: .changes");
		assert.strictEqual(result["changes-dir"], ".changes");
	});

	it("ignores lines that are not key: value", () => {
		const result = parseSimpleYaml("kinds:\n  - label: Features\nfoo: bar");
		assert.strictEqual(result.foo, "bar");
		assert.strictEqual(result.kinds, "");
	});

	it("returns empty object for empty string", () => {
		const result = parseSimpleYaml("");
		assert.deepStrictEqual(result, {});
	});
});

describe("parseKindsFromConfig", () => {
	it("parses kind labels from config content", () => {
		const content = "kinds:\n  - label: Features\n  - label: Bug Fixes\n  - label: Chores\n";
		const kinds = parseKindsFromConfig(content);
		assert.deepStrictEqual(kinds, [
			{ label: "Features" },
			{ label: "Bug Fixes" },
			{ label: "Chores" },
		]);
	});

	it("returns empty array when no kinds block", () => {
		const kinds = parseKindsFromConfig("changesDir: .changes\n");
		assert.deepStrictEqual(kinds, []);
	});

	it("handles kinds with extra whitespace", () => {
		const content = "kinds:\n    - label: Breaking Changes\n";
		const kinds = parseKindsFromConfig(content);
		assert.deepStrictEqual(kinds, [{ label: "Breaking Changes" }]);
	});
});

describe("findConfigPath", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "changie-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("finds .changie.yaml", () => {
		fs.writeFileSync(path.join(tmpDir, ".changie.yaml"), "changesDir: .changes\n");
		const result = findConfigPath(tmpDir);
		assert.ok(result?.endsWith(".changie.yaml"));
	});

	it("finds .changie.yml", () => {
		fs.writeFileSync(path.join(tmpDir, ".changie.yml"), "changesDir: .changes\n");
		const result = findConfigPath(tmpDir);
		assert.ok(result?.endsWith(".changie.yml"));
	});

	it("returns undefined when no config exists", () => {
		const result = findConfigPath(tmpDir);
		assert.strictEqual(result, undefined);
	});
});

describe("readConfig", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "changie-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns undefined when no config file", () => {
		assert.strictEqual(readConfig(tmpDir), undefined);
	});

	it("reads changesDir and unreleasedDir from config", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".changie.yaml"),
			"changesDir: .changes\nunreleasedDir: unreleased\nchangelogPath: CHANGELOG.md\n",
		);
		const config = readConfig(tmpDir);
		assert.strictEqual(config?.changesDir, ".changes");
		assert.strictEqual(config?.unreleasedDir, "unreleased");
		assert.strictEqual(config?.changelogPath, "CHANGELOG.md");
	});

	it("uses defaults when fields are absent", () => {
		fs.writeFileSync(path.join(tmpDir, ".changie.yaml"), "kinds:\n  - label: Added\n");
		const config = readConfig(tmpDir);
		assert.strictEqual(config?.changesDir, ".changes");
		assert.strictEqual(config?.unreleasedDir, "unreleased");
		assert.strictEqual(config?.changelogPath, "CHANGELOG.md");
	});

	it("parses kinds from config", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".changie.yaml"),
			"changesDir: .changes\nkinds:\n  - label: Features\n  - label: Bug Fixes\n",
		);
		const config = readConfig(tmpDir);
		assert.deepStrictEqual(config?.kinds, [{ label: "Features" }, { label: "Bug Fixes" }]);
	});

	it("falls back to default kinds when none configured", () => {
		fs.writeFileSync(path.join(tmpDir, ".changie.yaml"), "changesDir: .changes\n");
		const config = readConfig(tmpDir);
		assert.ok(config?.kinds.length ?? 0 > 0);
		assert.ok(config?.kinds.some((k) => k.label === "Added"));
	});

	it("returns undefined when changesDir escapes workspace root via path traversal", () => {
		fs.writeFileSync(path.join(tmpDir, ".changie.yaml"), "changesDir: ../../outside\n");
		assert.strictEqual(readConfig(tmpDir), undefined);
	});

	it("returns undefined when unreleasedDir escapes workspace root via path traversal", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".changie.yaml"),
			"changesDir: .changes\nunreleasedDir: ../../outside\n",
		);
		assert.strictEqual(readConfig(tmpDir), undefined);
	});

	it("returns undefined when changelogPath escapes workspace root via path traversal", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".changie.yaml"),
			"changesDir: .changes\nchangelogPath: ../../CHANGELOG.md\n",
		);
		assert.strictEqual(readConfig(tmpDir), undefined);
	});
});

describe("readUnreleasedEntries", () => {
	let tmpDir: string;

	const config = {
		changesDir: ".changes",
		unreleasedDir: "unreleased",
		changelogPath: "CHANGELOG.md",
		kinds: [],
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "changie-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns empty array when unreleased dir does not exist", () => {
		const entries = readUnreleasedEntries(tmpDir, "test", config);
		assert.deepStrictEqual(entries, []);
	});

	it("reads yaml entry files", () => {
		const unreleasedDir = path.join(tmpDir, ".changes", "unreleased");
		fs.mkdirSync(unreleasedDir, { recursive: true });
		fs.writeFileSync(
			path.join(unreleasedDir, "20260509-feature.yaml"),
			"kind: Features\nbody: Added something cool\ntime: 2026-05-09T00:00:00Z\n",
		);

		const entries = readUnreleasedEntries(tmpDir, "myworkspace", config);
		assert.strictEqual(entries.length, 1);
		assert.strictEqual(entries[0].kind, "Features");
		assert.strictEqual(entries[0].body, "Added something cool");
		assert.strictEqual(entries[0].workspaceName, "myworkspace");
	});

	it("skips non-yaml files", () => {
		const unreleasedDir = path.join(tmpDir, ".changes", "unreleased");
		fs.mkdirSync(unreleasedDir, { recursive: true });
		fs.writeFileSync(path.join(unreleasedDir, "README.md"), "# Notes\n");
		fs.writeFileSync(
			path.join(unreleasedDir, "entry.yaml"),
			"kind: Bug Fixes\nbody: Fixed a bug\n",
		);

		const entries = readUnreleasedEntries(tmpDir, "test", config);
		assert.strictEqual(entries.length, 1);
	});

	it("reads both .yaml and .yml files", () => {
		const unreleasedDir = path.join(tmpDir, ".changes", "unreleased");
		fs.mkdirSync(unreleasedDir, { recursive: true });
		fs.writeFileSync(path.join(unreleasedDir, "a.yaml"), "kind: Features\nbody: One\n");
		fs.writeFileSync(path.join(unreleasedDir, "b.yml"), "kind: Bug Fixes\nbody: Two\n");

		const entries = readUnreleasedEntries(tmpDir, "test", config);
		assert.strictEqual(entries.length, 2);
	});

	it("includes filePath and workspaceRoot on each entry", () => {
		const unreleasedDir = path.join(tmpDir, ".changes", "unreleased");
		fs.mkdirSync(unreleasedDir, { recursive: true });
		fs.writeFileSync(path.join(unreleasedDir, "entry.yaml"), "kind: Chores\nbody: Updated deps\n");

		const entries = readUnreleasedEntries(tmpDir, "test", config);
		assert.strictEqual(entries[0].workspaceRoot, tmpDir);
		assert.ok(entries[0].filePath.endsWith("entry.yaml"));
	});
});

describe("normalizeVersion", () => {
	it("strips a leading v", () => {
		assert.strictEqual(normalizeVersion("v1.2.3"), "1.2.3");
	});

	it("leaves a version without a leading v unchanged", () => {
		assert.strictEqual(normalizeVersion("1.2.3"), "1.2.3");
	});

	it("handles an empty string", () => {
		assert.strictEqual(normalizeVersion(""), "");
	});

	it("strips only the first v character", () => {
		assert.strictEqual(normalizeVersion("vv1.0.0"), "v1.0.0");
	});
});

describe("updatePackageVersionFiles", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "changie-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns bumped: false when no package.json exists", () => {
		const result = updatePackageVersionFiles(tmpDir, "1.2.3");
		assert.deepStrictEqual(result, { bumped: false, noVersionField: false });
	});

	it("returns noVersionField: true when package.json has no version field", () => {
		fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name": "test"}\n');
		const result = updatePackageVersionFiles(tmpDir, "1.2.3");
		assert.deepStrictEqual(result, { bumped: false, noVersionField: true });
	});

	it("updates the version in package.json and returns bumped: true", () => {
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			'{\n  "name": "test",\n  "version": "1.0.0"\n}\n',
		);
		const result = updatePackageVersionFiles(tmpDir, "1.2.3");
		assert.deepStrictEqual(result, { bumped: true, noVersionField: false });
		const updated = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8")) as Record<string, unknown>;
		assert.strictEqual(updated.version, "1.2.3");
	});

	it("strips a leading v before writing to package.json", () => {
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			'{\n  "name": "test",\n  "version": "1.0.0"\n}\n',
		);
		updatePackageVersionFiles(tmpDir, "v2.0.0");
		const updated = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8")) as Record<string, unknown>;
		assert.strictEqual(updated.version, "2.0.0");
	});

	it("preserves surrounding content in package.json", () => {
		const original =
			'{\n  "name": "test",\n  "version": "1.0.0",\n  "description": "A test"\n}\n';
		fs.writeFileSync(path.join(tmpDir, "package.json"), original);
		updatePackageVersionFiles(tmpDir, "1.2.3");
		const content = fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8");
		assert.ok(content.includes('"name": "test"'));
		assert.ok(content.includes('"description": "A test"'));
		assert.ok(content.includes('"version": "1.2.3"'));
	});

	it("skips package-lock.json when it does not exist", () => {
		fs.writeFileSync(path.join(tmpDir, "package.json"), '{\n  "version": "1.0.0"\n}\n');
		updatePackageVersionFiles(tmpDir, "1.2.3");
		assert.ok(!fs.existsSync(path.join(tmpDir, "package-lock.json")));
	});

	it("updates root version and packages[''] version in package-lock.json", () => {
		fs.writeFileSync(path.join(tmpDir, "package.json"), '{\n  "version": "1.0.0"\n}\n');
		const lock = {
			name: "test",
			version: "1.0.0",
			lockfileVersion: 3,
			packages: { "": { name: "test", version: "1.0.0" } },
		};
		fs.writeFileSync(
			path.join(tmpDir, "package-lock.json"),
			JSON.stringify(lock, null, 2) + "\n",
		);
		updatePackageVersionFiles(tmpDir, "1.2.3");
		const updated = JSON.parse(
			fs.readFileSync(path.join(tmpDir, "package-lock.json"), "utf-8"),
		) as typeof lock;
		assert.strictEqual(updated.version, "1.2.3");
		assert.strictEqual(updated.packages[""].version, "1.2.3");
	});

	it("updates root version in package-lock.json when no packages[''] entry", () => {
		fs.writeFileSync(path.join(tmpDir, "package.json"), '{\n  "version": "1.0.0"\n}\n');
		const lock = { name: "test", version: "1.0.0", lockfileVersion: 1 };
		fs.writeFileSync(
			path.join(tmpDir, "package-lock.json"),
			JSON.stringify(lock, null, 2) + "\n",
		);
		updatePackageVersionFiles(tmpDir, "1.2.3");
		const updated = JSON.parse(
			fs.readFileSync(path.join(tmpDir, "package-lock.json"), "utf-8"),
		) as typeof lock;
		assert.strictEqual(updated.version, "1.2.3");
	});

	it("returns bumped: false for a version string containing double quotes", () => {
		fs.writeFileSync(path.join(tmpDir, "package.json"), '{\n  "version": "1.0.0"\n}\n');
		const result = updatePackageVersionFiles(tmpDir, '1.0.0", "scripts":{"postinstall":"evil"}//');
		assert.deepStrictEqual(result, { bumped: false, noVersionField: false });
		const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8")) as Record<string, unknown>;
		assert.strictEqual(pkg.version, "1.0.0");
	});

	it("returns bumped: false for a version string not starting with a digit", () => {
		fs.writeFileSync(path.join(tmpDir, "package.json"), '{\n  "version": "1.0.0"\n}\n');
		const result = updatePackageVersionFiles(tmpDir, "invalid-version");
		assert.deepStrictEqual(result, { bumped: false, noVersionField: false });
	});

	it("does not corrupt package.json when version contains $& replacement pattern", () => {
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			'{\n  "name": "test",\n  "version": "1.0.0"\n}\n',
		);
		// $& would expand to the matched text if not using a function replacement
		const result = updatePackageVersionFiles(tmpDir, "2.$&0");
		// starts with digit, no quotes — should be accepted and written literally
		assert.deepStrictEqual(result, { bumped: true, noVersionField: false });
		const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8")) as Record<string, unknown>;
		assert.strictEqual(pkg.version, "2.$&0");
	});

	it("handles malformed package-lock.json without throwing", () => {
		fs.writeFileSync(path.join(tmpDir, "package.json"), '{\n  "version": "1.0.0"\n}\n');
		fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "not valid json");
		assert.doesNotThrow(() => updatePackageVersionFiles(tmpDir, "1.2.3"));
		const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8")) as Record<string, unknown>;
		assert.strictEqual(pkg.version, "1.2.3");
	});
});

describe("findChangieBin", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "changie-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns configured path when provided", () => {
		const result = findChangieBin(tmpDir, "/usr/local/bin/changie");
		assert.strictEqual(result, "/usr/local/bin/changie");
	});

	it("returns local node_modules/.bin/changie when present", () => {
		const binDir = path.join(tmpDir, "node_modules", ".bin");
		fs.mkdirSync(binDir, { recursive: true });
		const localBin = path.join(binDir, "changie");
		fs.writeFileSync(localBin, "");

		const result = findChangieBin(tmpDir);
		assert.strictEqual(result, localBin);
	});

	it("falls back to changie on PATH when no local binary", () => {
		const result = findChangieBin(tmpDir);
		assert.strictEqual(result, "changie");
	});
});
