import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { ExtensionApi } from "../../src/extension";

const EXTENSION_ID = "chriswiegman.cw-changie";

suite("Extension", () => {
	let ext: vscode.Extension<ExtensionApi>;
	let sandbox: sinon.SinonSandbox;

	suiteSetup(async () => {
		const found = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
		assert.ok(found, `Extension ${EXTENSION_ID} not found`);
		await found.activate();
		ext = found;
	});

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	test("activates successfully", () => {
		assert.strictEqual(ext.isActive, true);
	});

	test("registers changie.newEntry command", async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("changie.newEntry"));
	});

	test("registers changie.batchRelease command", async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("changie.batchRelease"));
	});

	test("registers changie.mergeChangelog command", async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("changie.mergeChangelog"));
	});

	test("registers changie.refresh command", async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("changie.refresh"));
	});

	test("registers changie.openChangelog command", async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("changie.openChangelog"));
	});

	test("exposes ChangelogProvider via api", () => {
		assert.ok(ext.exports.provider);
	});

	suite("changie.newEntry with no workspace", () => {
		test("shows error message when no changie config found", async () => {
			const showError = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
			const showQuickPick = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);

			await vscode.commands.executeCommand("changie.newEntry");

			assert.ok(
				showError.called || showQuickPick.called,
				"Should show error or quick pick when no workspace has changie",
			);
		});
	});
});
