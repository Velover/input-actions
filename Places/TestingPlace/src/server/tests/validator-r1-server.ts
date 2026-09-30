import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	expectDefined,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	scratch,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { BuildSaTemplate, SA_SCHEMA } from "shared/fixtures/schemas";
import { waitForPlayer } from "./players";

// Validator round 1: adversarial server tests for ProvideToPlayers and ForPlayer.

let folderCount = 0;
function testFolderName(player: Player) {
	folderCount++;
	const name = `ValidatorR1Server${folderCount}`;
	defer(() => player.FindFirstChild(name)?.Destroy());
	return name;
}

/** A stand-in player (only a key and a parent) holding a folder of contexts */
function standInWith(contexts: Array<[string, Array<[string, Enum.InputActionType]>]>): Player {
	const player = new Instance("Folder");
	player.Name = "StandIn";
	const folder = new Instance("Folder");
	folder.Name = "Inputs";
	for (const [contextName, actions] of contexts) {
		const context = new Instance("InputContext");
		context.Name = contextName;
		for (const [actionName, actionType] of actions) {
			const action = new Instance("InputAction");
			action.Name = actionName;
			action.Type = actionType;
			action.Parent = context;
		}
		context.Parent = folder;
	}
	folder.Parent = player;
	player.Parent = scratch();
	return player as unknown as Player;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR1ServerTests implements OnStart {
	onStart() {
		defineTests("validator-r1-server", () => {
			test("ForPlayer throws on an action of another Type, naming the path", () => {
				const player = standInWith([
					[
						"SaGameplay",
						[
							["Jump", Enum.InputActionType.Direction1D],
							["Move", Enum.InputActionType.Direction2D],
						],
					],
					["SaVehicle", [["Throttle", Enum.InputActionType.Direction1D]]],
				]);
				const message = expectThrows(() =>
					InputActions.ForPlayer(SA_SCHEMA, player, { Timeout: 1 }),
				);
				expectTrue(message.find("SaGameplay/Jump", 1, true)[0] !== undefined, message);
			});

			test("ProvideToPlayers makes the copy enabled, even from a disabled template: the client owns Enabled", () => {
				// IAS on the server ignores the client's input for a context or action the server
				// disabled (validator round 4, R4-F1); the client starts from the template's Enabled
				const player = waitForPlayer();
				const name = testFolderName(player);
				const templates = BuildSaTemplate(scratch());
				const template = templates.FindFirstChild("SaGameplay") as InputContext;
				template.Enabled = false;
				(template.FindFirstChild("Jump") as InputAction).Enabled = false;
				(template.FindFirstChild("Emote") as InputAction).Enabled = false;
				defer(
					InputActions.ProvideToPlayers(SA_SCHEMA, { Folder: templates, PlayerFolderName: name }),
				);
				const copy = expectDefined(
					player.FindFirstChild(name)?.FindFirstChild("SaGameplay"),
				) as InputContext;
				expectTrue(copy.Enabled, "the context");
				for (const actionName of ["Jump", "Emote", "Move"]) {
					expectTrue((copy.FindFirstChild(actionName) as InputAction).Enabled, actionName);
				}
				expectFalse(template.Enabled, "the template keeps its own");
			});

			test("ProvideToPlayers adds missing actions to a context already under the player", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				const folder = new Instance("Folder");
				folder.Name = name;
				const context = new Instance("InputContext");
				context.Name = "SaGameplay";
				const jump = new Instance("InputAction");
				jump.Name = "Jump";
				jump.Parent = context;
				context.Parent = folder;
				folder.Parent = player;
				defer(
					InputActions.ProvideToPlayers(SA_SCHEMA, { Folder: scratch(), PlayerFolderName: name }),
				);
				expectEqual(folder.FindFirstChild("SaGameplay"), context);
				const move = expectDefined(context.FindFirstChild("Move")) as InputAction;
				expectEqual(move.Type, Enum.InputActionType.Direction2D);
				expectEqual(context.FindFirstChild("Jump"), jump);
				expectDefined(folder.FindFirstChild("SaVehicle"));
			});

			test("ProvideToPlayers throws on a player's context with an action of another Type", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				const folder = new Instance("Folder");
				folder.Name = name;
				const context = new Instance("InputContext");
				context.Name = "SaGameplay";
				const jump = new Instance("InputAction");
				jump.Name = "Jump";
				jump.Type = Enum.InputActionType.ViewportPosition;
				jump.Parent = context;
				context.Parent = folder;
				folder.Parent = player;
				const message = expectThrows(() =>
					InputActions.ProvideToPlayers(SA_SCHEMA, { Folder: scratch(), PlayerFolderName: name }),
				);
				expectTrue(message.find("SaGameplay/Jump", 1, true)[0] !== undefined, message);
			});

			test("ForPlayer's Bool handles carry Pressed and Released", () => {
				const player = standInWith([
					[
						"SaGameplay",
						[
							["Jump", Enum.InputActionType.Bool],
							["Move", Enum.InputActionType.Direction2D],
						],
					],
					["SaVehicle", [["Throttle", Enum.InputActionType.Direction1D]]],
				]);
				const handle = InputActions.ForPlayer(SA_SCHEMA, player, { Timeout: 1 });
				expectEqual(typeOf(handle.SaGameplay.Actions.Jump.Pressed), "RBXScriptSignal");
				expectEqual(typeOf(handle.SaGameplay.Actions.Jump.Released), "RBXScriptSignal");
				expectEqual(typeOf(handle.SaVehicle.Actions.Throttle.StateChanged), "RBXScriptSignal");
				expectEqual(handle.SaVehicle.Name, "SaVehicle");
			});
		});
	}
}
