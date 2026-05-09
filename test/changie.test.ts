import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, it } from "mocha";
import {
	findChangieBin,
	findConfigPath,
	parseKindsFromConfig,
	parseSimpleYaml,
	readConfig,
	readUnreleasedEntries,
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
