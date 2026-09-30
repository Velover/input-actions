import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	expectDefined,
	expectEqual,
	expectTrue,
	scratch,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { ReplicatedStorage } from "@rbxts/services";
import { R4_PLAYER_FOLDER, R4_REMOTE, R4_SA_SCHEMA } from "shared/fixtures/validator-r4";
import { waitForPlayer } from "./players";

// Validator round 4: the server side of the client's validator-r4-sa section, and a server test.

/**
 * `("provide")` provides R4_SA_SCHEMA under `player.ValidatorR4Inputs` (once, without templates).
 * `("state", context, action)` returns that action's state on the server, and
 * `("enabled", context, action?)` whether the server's context (or action) is enabled.
 */
function hostValidatorRemote() {
	let provided = false;
	const remote = new Instance("RemoteFunction");
	remote.Name = R4_REMOTE;
	remote.OnServerInvoke = (player, command, contextName, actionName) => {
		if (command === "provide") {
			if (!provided) {
				provided = true;
				const templates = new Instance("Folder");
				templates.Name = "ValidatorR4NoTemplates";
				templates.Parent = ReplicatedStorage;
				InputActions.ProvideToPlayers(R4_SA_SCHEMA, {
					Folder: templates,
					PlayerFolderName: R4_PLAYER_FOLDER,
				});
			}
			return true;
		}
		const context = player
			.FindFirstChild(R4_PLAYER_FOLDER)
			?.FindFirstChild(contextName as string);
		if (context === undefined || !context.IsA("InputContext")) return undefined;
		const action = actionName !== undefined ? context.FindFirstChild(actionName as string) : undefined;
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
	const name = `ValidatorR4Server${folderCount}`;
	defer(() => player.FindFirstChild(name)?.Destroy());
	return name;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR4ServerTests implements OnStart {
	onStart() {
		hostValidatorRemote();

		defineTests("validator-r4-server", () => {
			test("a preset marked Server Authority is provided with its six actions, and ForPlayer reads it", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				defer(
					InputActions.ProvideToPlayers(R4_SA_SCHEMA, {
						Folder: scratch(),
						PlayerFolderName: name,
					}),
				);
				const ui = expectDefined(player.FindFirstChild(name)?.FindFirstChild("R4Ui"));
				const types: Record<string, Enum.InputActionType> = {
					Navigate: Enum.InputActionType.Direction2D,
					Accept: Enum.InputActionType.Bool,
					Cancel: Enum.InputActionType.Bool,
					NextPage: Enum.InputActionType.Bool,
					PreviousPage: Enum.InputActionType.Bool,
					Scroll: Enum.InputActionType.Direction1D,
				};
				for (const [actionName, actionType] of pairs(types)) {
					const action = expectDefined(ui.FindFirstChild(actionName), actionName);
					expectTrue(action.IsA("InputAction"), actionName);
					expectEqual((action as InputAction).Type, actionType, actionName);
					expectEqual(action.GetChildren().size(), 0, `${actionName} has no bindings`);
				}
				// declared disabled, provided enabled: the client owns Enabled (R4-F1)
				expectTrue((ui as InputContext).Enabled, "R4Ui");
				const off = expectDefined(
					player.FindFirstChild(name)?.FindFirstChild("R4Off"),
				) as InputContext;
				expectTrue(off.Enabled, "R4Off");
				const wave = expectDefined(
					player.FindFirstChild(name)?.FindFirstChild("R4On")?.FindFirstChild("Wave"),
				) as InputAction;
				expectTrue(wave.Enabled, "R4On.Wave");
				const handle = InputActions.ForPlayer(R4_SA_SCHEMA, player, { PlayerFolderName: name });
				const navigate: Vector2 = handle.R4Ui.Actions.Navigate.GetState();
				expectEqual(navigate, Vector2.zero);
				expectEqual(handle.R4Ui.Actions.Accept.GetState(), false);
			});
		});
	}
}
