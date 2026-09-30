import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	expectDefined,
	expectEqual,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService, ReplicatedStorage } from "@rbxts/services";
import { BuildR5Template, R5_REMOTE, R5_SA_SCHEMA } from "shared/fixtures/validator-r5";
import { waitForPlayer } from "./players";

// Validator round 5: the server side of the client's validator-r5-sa section, and a server test.

/**
 * `("provide", folderName)` provides R5_SA_SCHEMA under `player.<folderName>`, from the template
 * (built at start, so it has replicated before the client's tests run). `("state", folderName,
 * context, action)` returns the action's state on the server, `("enabled", folderName, context,
 * action?)` whether the server's context (or action) is enabled.
 */
function hostValidatorRemote() {
	const templates = BuildR5Template(ReplicatedStorage);
	const provided = new Set<string>();
	const remote = new Instance("RemoteFunction");
	remote.Name = R5_REMOTE;
	remote.OnServerInvoke = (player, command, folderName, contextName, actionName) => {
		if (command === "provide") {
			if (!provided.has(folderName as string)) {
				provided.add(folderName as string);
				InputActions.ProvideToPlayers(R5_SA_SCHEMA, {
					Folder: templates,
					PlayerFolderName: folderName as string,
				});
			}
			return true;
		}
		const context = player
			.FindFirstChild(folderName as string)
			?.FindFirstChild(contextName as string);
		if (context === undefined || !context.IsA("InputContext")) return undefined;
		const action =
			actionName !== undefined ? context.FindFirstChild(actionName as string) : undefined;
		if (command === "enabled") {
			if (actionName === undefined) return context.Enabled;
			return action !== undefined && action.IsA("InputAction") ? action.Enabled : undefined;
		}
		if (command === "state") {
			return action !== undefined && action.IsA("InputAction") ? action.GetState() : undefined;
		}
		return undefined;
	};
	remote.Parent = ReplicatedStorage;
}

let folderCount = 0;
function testFolderName(player: Player) {
	folderCount++;
	const name = `ValidatorR5Server${folderCount}`;
	defer(() => player.FindFirstChild(name)?.Destroy());
	return name;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR5ServerTests implements OnStart {
	onStart() {
		hostValidatorRemote();

		defineTests("validator-r5-server", () => {
			test("a disabled template gives an enabled copy with enabled actions, extras included, and no bindings", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				const templates = expectDefined(ReplicatedStorage.FindFirstChild("ValidatorR5Templates"));
				defer(
					InputActions.ProvideToPlayers(R5_SA_SCHEMA, {
						Folder: templates,
						PlayerFolderName: name,
					}),
				);
				const copy = expectDefined(
					player.FindFirstChild(name)?.FindFirstChild("R5Menu"),
				) as InputContext;
				expectTrue(copy.Enabled, "the context");
				expectEqual(copy.Priority, 2500, "the template's Priority");
				for (const actionName of ["Open", "Pick", "Hint", "Scroll"]) {
					const action = expectDefined(copy.FindFirstChild(actionName), actionName) as InputAction;
					expectTrue(action.Enabled, actionName);
					expectEqual(action.GetChildren().size(), 0, `${actionName} has no bindings`);
				}
				const template = templates.FindFirstChild("R5Menu") as InputContext;
				expectEqual(template.Enabled, false, "the template itself is left as the designer made it");
			});

			test("SanitizeBindings on a client's save nested thousands deep returns an empty save", () => {
				const json = `{"Version":1,"Bindings":${string.rep("[", 5000)}${string.rep("]", 5000)}}`;
				const [ok, result] = pcall(() => InputActions.SanitizeBindings(R5_SA_SCHEMA, json));
				expectTrue(ok, tostring(result));
				expectEqual(
					HttpService.JSONEncode(HttpService.JSONDecode(result as string)),
					'{"Version":1,"Bindings":[]}',
				);
			});
		});
	}
}
