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
import { ReplicatedStorage } from "@rbxts/services";
import {
	BuildSaTemplate,
	SA_LATE_FOLDER_NAME,
	SA_LATE_SCHEMA,
	SA_REMOTE,
	SA_SCHEMA,
	SA_TEMPLATE_FOLDER,
	TEST_SCHEMA,
} from "shared/fixtures/schemas";
import { waitForPlayer } from "./players";

let folderCount = 0;
/** A player folder name of its own for one test, removed afterwards */
function testFolderName(player: Player) {
	folderCount++;
	const name = `InputActionsTest${folderCount}`;
	defer(() => player.FindFirstChild(name)?.Destroy());
	return name;
}

function bindingCount(root: Instance) {
	return root
		.GetDescendants()
		.filter((descendant) => descendant.IsA("InputBinding"))
		.size();
}

/** A stand-in player (only a key and a parent) */
function standIn(): Player {
	const folder = new Instance("Folder");
	folder.Name = "StandIn";
	folder.Parent = scratch();
	return folder as unknown as Player;
}

interface IFixture {
	Schema: InputActions.InputSchema<Record<string, InputActions.ContextSchema>>;
	Options: { PlayerFolderName: string };
}

type AnyServerHandle = Record<
	string,
	{ Instance: InputContext; Actions: Record<string, { GetState(): unknown }> }
>;

/**
 * The server side of the client's "server-authority" section. On request it provides SA_SCHEMA
 * ("sa") or SA_LATE_SCHEMA ("late"), and reads that player's state back, so the client can check
 * what reached the server. `("playerModule", _, context, action)` reads Roblox's PlayerModule
 * action under `player.InputContexts` instead.
 */
function hostServerAuthorityFixture() {
	const fixtures: Record<string, IFixture> = {
		sa: { Schema: SA_SCHEMA, Options: { PlayerFolderName: "Inputs" } },
		late: { Schema: SA_LATE_SCHEMA, Options: { PlayerFolderName: SA_LATE_FOLDER_NAME } },
	};
	const provided = new Set<string>();
	const pressed = new Map<Player, number>();
	const templates = () =>
		ReplicatedStorage.FindFirstChild(SA_TEMPLATE_FOLDER) ?? BuildSaTemplate(ReplicatedStorage);

	const remote = new Instance("RemoteFunction");
	remote.Name = SA_REMOTE;
	remote.OnServerInvoke = (player, command, fixtureName, contextName, actionName) => {
		const fixture = fixtures[fixtureName as string];
		if (command === "templates") return templates();
		// The state of Roblox's own PlayerModule action on the server: `player.InputContexts`
		if (command === "playerModule") {
			const action = player
				.FindFirstChild("InputContexts")
				?.FindFirstChild(contextName as string)
				?.FindFirstChild(actionName as string);
			return action !== undefined && action.IsA("InputAction") ? action.GetState() : undefined;
		}
		if (command === "provide") {
			if (!provided.has(fixtureName as string)) {
				provided.add(fixtureName as string);
				InputActions.ProvideToPlayers(fixture.Schema, { ...fixture.Options, Folder: templates() });
			}
			if (fixtureName === "sa" && !pressed.has(player)) {
				pressed.set(player, 0);
				const jump = InputActions.ForPlayer(SA_SCHEMA, player).SaGameplay.Actions.Jump;
				jump.Pressed.Connect(() => pressed.set(player, (pressed.get(player) ?? 0) + 1));
			}
			return true;
		}
		const handle = InputActions.ForPlayer(
			fixture.Schema,
			player,
			fixture.Options,
		) as unknown as AnyServerHandle;
		const context = handle[contextName as string];
		if (command === "state") return context.Actions[actionName as string].GetState();
		if (command === "enabled") return context.Instance.Enabled;
		if (command === "pressed") return pressed.get(player) ?? 0;
		return undefined;
	};
	remote.Parent = ReplicatedStorage;
}

/** Server Authority on the server: ProvideToPlayers and ForPlayer (design spec §8) */
@Provider({ activeIn: ["testing"] })
export class ServerAuthorityTests implements OnStart {
	onStart() {
		hostServerAuthorityFixture();

		defineTests("server-authority", () => {
			test("Create runs on the client only", () => {
				expectThrows(() => InputActions.Create(TEST_SCHEMA, { Folder: scratch() }));
			});

			test("ProvideToPlayers clones the template without its bindings and adds the schema's actions", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				const templates = BuildSaTemplate(scratch());
				const stop = InputActions.ProvideToPlayers(SA_SCHEMA, {
					Folder: templates,
					PlayerFolderName: name,
				});
				defer(stop);

				const folder = expectDefined(player.FindFirstChild(name));
				const gameplay = folder.FindFirstChild("SaGameplay") as InputContext;
				expectTrue(gameplay !== undefined && gameplay.IsA("InputContext"));
				expectEqual(gameplay.Priority, 1700);
				expectTrue(gameplay.Sink);
				expectEqual(bindingCount(gameplay), 0);
				expectEqual(
					(gameplay.FindFirstChild("Jump") as InputAction).Type,
					Enum.InputActionType.Bool,
				);
				expectDefined(gameplay.FindFirstChild("Emote"));
				expectEqual(
					(gameplay.FindFirstChild("Move") as InputAction).Type,
					Enum.InputActionType.Direction2D,
				);
				// the template keeps its bindings
				expectEqual(bindingCount(templates), 2);

				const vehicle = folder.FindFirstChild("SaVehicle") as InputContext;
				expectTrue(vehicle !== undefined && vehicle.IsA("InputContext"));
				expectEqual(vehicle.Priority, 1600);
				expectTrue(vehicle.Sink);
				expectEqual(
					(vehicle.FindFirstChild("Throttle") as InputAction).Type,
					Enum.InputActionType.Direction1D,
				);
				expectEqual(folder.FindFirstChild("SaLocal"), undefined);
			});

			test("providing again creates nothing twice", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				const templates = BuildSaTemplate(scratch());
				defer(
					InputActions.ProvideToPlayers(SA_SCHEMA, { Folder: templates, PlayerFolderName: name }),
				);
				const folder = expectDefined(player.FindFirstChild(name));
				const count = folder.GetDescendants().size();
				const gameplay = folder.FindFirstChild("SaGameplay");
				defer(
					InputActions.ProvideToPlayers(SA_SCHEMA, { Folder: templates, PlayerFolderName: name }),
				);
				expectEqual(folder.GetDescendants().size(), count);
				expectEqual(folder.FindFirstChild("SaGameplay"), gameplay);
			});

			test("a template action of another type throws, naming the path", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				const templates = BuildSaTemplate(scratch());
				(templates.FindFirstChild("SaGameplay")!.FindFirstChild("Jump") as InputAction).Type =
					Enum.InputActionType.Direction1D;
				const message = expectThrows(() =>
					InputActions.ProvideToPlayers(SA_SCHEMA, { Folder: templates, PlayerFolderName: name }),
				);
				expectTrue(message.find("SaGameplay/Jump", 1, true)[0] !== undefined, message);
				expectEqual(player.FindFirstChild(name), undefined);
			});

			test("PlayerFolderName can't be Roblox's InputContexts", () => {
				expectThrows(() =>
					InputActions.ProvideToPlayers(SA_SCHEMA, { PlayerFolderName: "InputContexts" }),
				);
			});

			test("ForPlayer gives read-only handles over the player's copy", () => {
				const player = waitForPlayer();
				const name = testFolderName(player);
				defer(
					InputActions.ProvideToPlayers(SA_SCHEMA, {
						Folder: BuildSaTemplate(scratch()),
						PlayerFolderName: name,
					}),
				);
				const handle = InputActions.ForPlayer(SA_SCHEMA, player, { PlayerFolderName: name });
				const context = player.FindFirstChild(name)!.FindFirstChild("SaGameplay");
				expectEqual(handle.SaGameplay.Instance, context);
				expectEqual(handle.SaGameplay.Actions.Jump.Instance.Parent, context);
				expectEqual(handle.SaGameplay.Actions.Jump.Name, "Jump");
				expectFalse(handle.SaGameplay.Actions.Jump.GetState());
				expectEqual(handle.SaGameplay.Actions.Move.GetState(), Vector2.zero);
				expectEqual(handle.SaVehicle.Actions.Throttle.GetState(), 0);
				expectEqual((handle as unknown as Record<string, unknown>).SaLocal, undefined);
			});

			test("ForPlayer waits for the contexts", () => {
				const player = standIn();
				task.delay(0.2, () => {
					const folder = new Instance("Folder");
					folder.Name = "Inputs";
					for (const [contextName, actionName, actionType] of [
						["SaGameplay", "Jump", Enum.InputActionType.Bool],
						["SaVehicle", "Throttle", Enum.InputActionType.Direction1D],
					] as const) {
						const context = new Instance("InputContext");
						context.Name = contextName;
						const action = new Instance("InputAction");
						action.Name = actionName;
						action.Type = actionType;
						action.Parent = context;
						if (contextName === "SaGameplay") {
							const move = new Instance("InputAction");
							move.Name = "Move";
							move.Type = Enum.InputActionType.Direction2D;
							move.Parent = context;
						}
						context.Parent = folder;
					}
					folder.Parent = player;
				});
				const handle = InputActions.ForPlayer(SA_SCHEMA, player, { Timeout: 5 });
				expectFalse(handle.SaGameplay.Actions.Jump.GetState());
			});

			test("ForPlayer times out naming the missing contexts", () => {
				const message = expectThrows(() =>
					InputActions.ForPlayer(SA_SCHEMA, standIn(), { Timeout: 0.2 }),
				);
				expectTrue(message.find("SaGameplay", 1, true)[0] !== undefined, message);
				expectTrue(message.find("SaVehicle", 1, true)[0] !== undefined, message);
			});
		});
	}
}
