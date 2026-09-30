import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectFalse,
	expectTrue,
	getProject,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players, ReplicatedStorage } from "@rbxts/services";
import { R5_REMOTE, R5_SA_SCHEMA, R5_TEMPLATE_FOLDER } from "shared/fixtures/validator-r5";

// Validator round 5, Server Authority only: a template the designer disabled, provided by the real
// server (design spec section 8: the server's copy is always enabled, the client owns Enabled and
// starts from the template's).

function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(R5_REMOTE, 10),
		R5_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

function templates() {
	return expectDefined(ReplicatedStorage.WaitForChild(R5_TEMPLATE_FOLDER, 10), R5_TEMPLATE_FOLDER);
}

/** Waits for the server to read `expected`; fails with what the server's copy looks like */
function expectServerState(
	folderName: string,
	actionName: string,
	expected: unknown,
	what: string,
) {
	const [ok] = pcall(() =>
		eventually(() => server("state", folderName, "R5Menu", actionName) === expected, what, 5),
	);
	if (ok) return;
	expectEqual(
		server("state", folderName, "R5Menu", actionName),
		expected,
		`${what} (on the server: R5Menu.Enabled = ${server("enabled", folderName, "R5Menu")}, ` +
			`${actionName}.Enabled = ${server("enabled", folderName, "R5Menu", actionName)})`,
	);
}

function create(folderName: string) {
	const input = InputActions.Create(R5_SA_SCHEMA, {
		Folder: templates(),
		PlayerFolderName: folderName,
		Timeout: 1000,
	});
	defer(() => input.Destroy());
	return input;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR5ServerAuthorityTests implements OnStart {
	onStart() {
		defineTests("validator-r5-sa", () => {
			test("a template context and action the designer disabled reach the server once the client enables them", () => {
				if (getProject() !== "authority") return;
				const folderName = "ValidatorR5A";
				expectTrue(server("provide", folderName) === true);
				expectDefined(
					Players.LocalPlayer.WaitForChild(folderName, 10)?.WaitForChild("R5Menu", 10),
					"the server's copy",
				);
				const input = create(folderName);
				const menu = input.R5Menu;
				const { Open, Pick, Scroll } = menu.Actions;
				expectTrue(menu.IsLinkedToServer(), "on the copy from the start");
				expectFalse(menu.IsEnabled(), "the template's Enabled: false");
				expectFalse(Pick.IsEnabled(), "Pick: the template's Enabled: false");
				expectTrue(Open.IsEnabled());
				expectEqual(server("enabled", folderName, "R5Menu"), true, "the server's copy is enabled");

				menu.SetEnabled(true);
				Pick.SetEnabled(true);
				defer(() => {
					Open.Fire(false);
					Pick.Fire(false);
					Scroll.Bindings.Virtual.Fire(0);
				});
				Open.Fire(true);
				expectServerState(folderName, "Open", true, "the server's Open pressed");
				Pick.Fire(true);
				expectServerState(folderName, "Pick", true, "the server's Pick pressed");
				Scroll.Bindings.Virtual.Fire(0.5);
				expectServerState(folderName, "Scroll", 0.5, "the server's Scroll at 0.5");
				const hint = menu.Instance.FindFirstChild("Hint") as InputAction;
				expectFalse(hint.Enabled, "the template's extra action stays as the designer left it");
			});

			test("the same through the stand-in: enabled on it, the server receives after the swap", () => {
				if (getProject() !== "authority") return;
				const folderName = "ValidatorR5B";
				const input = create(folderName);
				const menu = input.R5Menu;
				const { Open, Pick, Scroll } = menu.Actions;
				expectFalse(menu.IsLinkedToServer(), "on a stand-in");
				expectFalse(menu.IsEnabled(), "the template's Enabled: false");
				menu.SetEnabled(true);
				Pick.SetEnabled(true);
				defer(() => {
					Open.Fire(false);
					Pick.Fire(false);
					Scroll.Bindings.Virtual.Fire(0);
				});
				Scroll.Bindings.Virtual.Fire(0.5);

				expectTrue(server("provide", folderName) === true);
				eventually(() => menu.IsLinkedToServer(), "the swap", 10);
				expectTrue(menu.IsEnabled(), "the stand-in's base state carried over");
				expectTrue(Pick.IsEnabled(), "Pick's Enabled carried over");
				expectServerState(
					folderName,
					"Scroll",
					0.5,
					"the held Scroll reaches the server after the swap",
				);
				Open.Fire(true);
				expectServerState(folderName, "Open", true, "the server's Open pressed");
				Pick.Fire(true);
				expectServerState(folderName, "Pick", true, "the server's Pick pressed");
				const hint = menu.Instance.FindFirstChild("Hint") as InputAction;
				expectFalse(hint.Enabled, "the template's extra action stays as the designer left it");
			});

			test("Destroy, then Create again on the copy: the client's Enabled stays and still reaches the server", () => {
				if (getProject() !== "authority") return;
				const folderName = "ValidatorR5A";
				expectTrue(server("provide", folderName) === true);
				expectDefined(
					Players.LocalPlayer.WaitForChild(folderName, 10)?.WaitForChild("R5Menu", 10),
					"the server's copy",
				);
				const first = create(folderName);
				first.R5Menu.SetEnabled(true);
				first.Destroy();
				const template = templates().FindFirstChild("R5Menu") as InputContext;
				expectFalse(template.Enabled, "the template gets the designer's Enabled back");
				const again = create(folderName);
				expectTrue(again.R5Menu.IsEnabled(), "the client's state, not the template's");
				const open = again.R5Menu.Actions.Open;
				defer(() => open.Fire(false));
				open.Fire(true);
				expectServerState(folderName, "Open", true, "the server's Open pressed");
				open.Fire(false);
				expectServerState(folderName, "Open", false, "the server's Open released");
			});
		});
	}
}
