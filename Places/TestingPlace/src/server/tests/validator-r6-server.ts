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
import { R6_LARGE, R6_REMOTE, R6_SMALL } from "shared/fixtures/validator-r6";
import { waitForPlayer } from "./players";

// Validator round 6: the server side of the client's validator-r6-sa section, and a server test.

/**
 * `("provide", folderName, "small" | "large")` provides that schema under `player.<folderName>`,
 * without templates (a second call with "large" adds the missing action to the copy). `("state",
 * folderName, contextName, actionName)` returns the action's state on the server.
 */
function hostValidatorRemote() {
	const noTemplates = new Instance("Folder");
	noTemplates.Name = "ValidatorR6NoTemplates";
	noTemplates.Parent = ReplicatedStorage;
	const remote = new Instance("RemoteFunction");
	remote.Name = R6_REMOTE;
	remote.OnServerInvoke = (player, command, folderName, second, actionName) => {
		if (command === "provide") {
			const schema = second === "large" ? R6_LARGE : R6_SMALL;
			const stop = InputActions.ProvideToPlayers(schema, {
				Folder: noTemplates,
				PlayerFolderName: folderName as string,
			});
			stop();
			return true;
		}
		if (command === "state") {
			const action = player
				.FindFirstChild(folderName as string)
				?.FindFirstChild(second as string)
				?.FindFirstChild(actionName as string);
			return action !== undefined && action.IsA("InputAction") ? action.GetState() : undefined;
		}
		return undefined;
	};
	remote.Parent = ReplicatedStorage;
}

let folderCount = 0;
function testFolderName(player: Player) {
	folderCount++;
	const name = `ValidatorR6Server${folderCount}`;
	defer(() => player.FindFirstChild(name)?.Destroy());
	return name;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR6ServerTests implements OnStart {
	onStart() {
		hostValidatorRemote();

		defineTests("validator-r6-server", () => {
			test("a second ProvideToPlayers adds its action enabled, whatever the schema's Enabled", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				defer(InputActions.ProvideToPlayers(R6_SMALL, { Folder: scratch(), PlayerFolderName: name }));
				const copy = expectDefined(
					player.FindFirstChild(name)?.FindFirstChild("R6Shared"),
				) as InputContext;
				expectEqual(copy.FindFirstChild("Extra"), undefined);
				defer(InputActions.ProvideToPlayers(R6_LARGE, { Folder: scratch(), PlayerFolderName: name }));
				const extra = expectDefined(copy.FindFirstChild("Extra"), "Extra") as InputAction;
				expectTrue(extra.Enabled, "the client owns Enabled; the server's copy is enabled");
				expectEqual(extra.Type, Enum.InputActionType.Bool);
				const handle = InputActions.ForPlayer(R6_LARGE, player, { PlayerFolderName: name, Timeout: 1 });
				expectEqual(handle.R6Shared.Actions.Extra.Instance, extra);
			});
		});
	}
}
