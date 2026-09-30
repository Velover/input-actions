import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	expectDefined,
	expectEqual,
	expectThrows,
	expectTrue,
	scratch,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { ReplicatedStorage } from "@rbxts/services";
import { BuildSaTemplate, SA_SCHEMA } from "shared/fixtures/schemas";
import { waitForPlayer } from "./players";

// Validator round 2: a server helper the client's validator-r2 sections call to read any action of
// the player's copies (including actions the schema doesn't mention), and a few server tests.

/** The RemoteFunction the client's validator-r2 sections call */
export const VALIDATOR_R2_REMOTE = "ValidatorR2Server";

/**
 * `("state", folderName, contextName, actionName)` returns that action's state on the server:
 * `player.<folderName>.<contextName>.<actionName>:GetState()`, or undefined when it is missing.
 * `("pressed", folderName, contextName, actionName)` returns how many `Pressed` the server saw on it
 * since the first call for that action.
 */
function hostValidatorRemote() {
	const pressed = new Map<InputAction, number>();
	const remote = new Instance("RemoteFunction");
	remote.Name = VALIDATOR_R2_REMOTE;
	remote.OnServerInvoke = (player, command, folderName, contextName, actionName) => {
		const action = player
			.FindFirstChild(folderName as string)
			?.FindFirstChild(contextName as string)
			?.FindFirstChild(actionName as string);
		if (action === undefined || !action.IsA("InputAction")) return undefined;
		if (command === "state") return action.GetState();
		if (command === "pressed") {
			if (!pressed.has(action)) {
				pressed.set(action, 0);
				action.Pressed.Connect(() => pressed.set(action, (pressed.get(action) ?? 0) + 1));
			}
			return pressed.get(action);
		}
		return undefined;
	};
	remote.Parent = ReplicatedStorage;
}

let folderCount = 0;
function testFolderName(player: Player) {
	folderCount++;
	const name = `ValidatorR2Server${folderCount}`;
	defer(() => player.FindFirstChild(name)?.Destroy());
	return name;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR2ServerTests implements OnStart {
	onStart() {
		hostValidatorRemote();

		defineTests("validator-r2-server", () => {
			test("ProvideToPlayers keeps the template's extra action, without bindings", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				defer(
					InputActions.ProvideToPlayers(SA_SCHEMA, {
						Folder: BuildSaTemplate(scratch()),
						PlayerFolderName: name,
					}),
				);
				const emote = expectDefined(
					player.FindFirstChild(name)?.FindFirstChild("SaGameplay")?.FindFirstChild("Emote"),
				);
				expectTrue(emote.IsA("InputAction"));
				expectEqual(emote.GetChildren().size(), 0);
			});

			test("ForPlayer names an action missing from the player's context", () => {
				const player = new Instance("Folder");
				const folder = new Instance("Folder");
				folder.Name = "Inputs";
				for (const contextName of ["SaGameplay", "SaVehicle"]) {
					const context = new Instance("InputContext");
					context.Name = contextName;
					context.Parent = folder;
				}
				folder.Parent = player;
				player.Parent = scratch();
				const message = expectThrows(() =>
					InputActions.ForPlayer(SA_SCHEMA, player as unknown as Player, { Timeout: 0.5 }),
				);
				expectTrue(message.find("SaGameplay/", 1, true)[0] !== undefined, message);
				expectTrue(message.find("is missing", 1, true)[0] !== undefined, message);
			});

			test("ProvideToPlayers can be stopped twice", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				const stop = InputActions.ProvideToPlayers(SA_SCHEMA, {
					Folder: scratch(),
					PlayerFolderName: name,
				});
				stop();
				stop();
				expectDefined(player.FindFirstChild(name)?.FindFirstChild("SaGameplay"));
			});
		});
	}
}
