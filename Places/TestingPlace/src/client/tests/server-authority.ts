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
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players, ReplicatedStorage } from "@rbxts/services";
import {
	expectedServerAuthority,
	isModeWarning,
	isTimeoutWarning,
	names,
} from "shared/fixtures/authority";
import { SA_LATE_FOLDER_NAME, SA_LATE_SCHEMA, SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import {
	countSignal,
	createTestInput,
	frames,
	newFolder,
	recordSignal,
	recordWarnings,
} from "./helpers";

const K = Enum.KeyCode;
const BOOL = Enum.InputActionType.Bool;

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(SA_REMOTE, 10),
		SA_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

/** The templates folder the server made (the Input Action Manager's, in a real game) */
function templates() {
	return server("templates") as Folder;
}

/** Asks the server to provide SA_SCHEMA to this player, and returns the templates folder */
function provide() {
	expectTrue(server("provide", "sa") === true);
	return templates();
}

function createSaInput() {
	const input = InputActions.Create(SA_SCHEMA, { Folder: provide() });
	defer(() => input.Destroy());
	return input;
}

let copyCount = 0;
/**
 * The server's copy, played on the client in a player folder no server provides: the context and
 * its actions enabled, as ProvideToPlayers makes them, parented last
 */
function localCopy(contextName: string, actionNames: string[]) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `InputsLocalCopy${copyCount}`;
	const context = new Instance("InputContext");
	context.Name = contextName;
	for (const name of actionNames) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Type = BOOL;
		action.Parent = context;
	}
	return {
		FolderName: folder.Name,
		Context: context,
		/** Parents the copy under the player */
		Arrive() {
			context.Parent = folder;
			folder.Parent = Players.LocalPlayer;
		},
		Action(name: string) {
			return context.FindFirstChild(name) as InputAction;
		},
		Cleanup: () => folder.Destroy(),
	};
}

/** A template context with one Bool action per entry of `actions` (name to Enabled), each with a key */
function localTemplate(contextName: string, enabled: boolean, actions: Array<[string, boolean]>) {
	const folder = newFolder("SaEnabledTemplates");
	const context = new Instance("InputContext");
	context.Name = contextName;
	context.Enabled = enabled;
	for (const [name, actionEnabled] of actions) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Enabled = actionEnabled;
		action.Parent = context;
		const binding = new Instance("InputBinding");
		binding.Name = `${name}KeyboardAndMouse`;
		binding.KeyCode = K.H;
		binding.Parent = action;
	}
	context.Parent = folder;
	return folder;
}

/** Server Authority on the client: the server's copy, or a stand-in until it arrives (design spec §8) */
@Provider({ activeIn: ["testing"] })
export class ServerAuthorityClientTests implements OnStart {
	onStart() {
		defineTests("server-authority", () => {
			test("with the copy already there, Create uses it and adds the bindings locally", () => {
				const folder = provide();
				const input = createSaInput();
				const playerFolder = expectDefined(Players.LocalPlayer.FindFirstChild("Inputs"));
				const gameplay = input.SaGameplay;
				expectTrue(gameplay.IsLinkedToServer());
				const links = countSignal(gameplay.LinkedToServer);
				expectEqual(gameplay.Instance.Parent, playerFolder);
				expectEqual(gameplay.Instance.Priority, 1700);

				// from the template: its key and its Manager name
				const jumpKeys = gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance;
				expectEqual(jumpKeys.Parent, gameplay.Actions.Jump.Instance);
				expectEqual(jumpKeys.Name, "JumpKeyboardAndMouse");
				expectEqual(jumpKeys.KeyCode, Enum.KeyCode.F);
				// from the schema
				const jumpPad = gameplay.Actions.Jump.Bindings.Gamepad.Instance;
				expectEqual(jumpPad.Name, "JumpGamepad");
				expectEqual(jumpPad.KeyCode, Enum.KeyCode.ButtonA);
				expectEqual(gameplay.Actions.Move.Bindings.KeyboardAndMouse.Instance.Up, Enum.KeyCode.W);
				expectEqual(
					gameplay.Actions.Move.Bindings.Virtual.Instance.Type,
					Enum.InputBindingType.Scriptable,
				);
				// the template's action the schema lacks still gets its binding
				const emote = expectDefined(gameplay.Instance.FindFirstChild("Emote"));
				expectEqual(
					(emote.FindFirstChild("EmoteKeyboardAndMouse") as InputBinding).KeyCode,
					Enum.KeyCode.H,
				);
				expectEqual(
					input.SaVehicle.Actions.Throttle.Bindings.KeyboardAndMouse.Instance.Up,
					Enum.KeyCode.W,
				);
				// a context without ServerAuthority is created in the folder, as usual
				expectEqual(input.SaLocal.Instance.Parent, folder);

				// the template is disabled locally, so it doesn't process the same keys
				const template = folder.FindFirstChild("SaGameplay") as InputContext;
				expectFalse(template.Enabled);
				frames(3);
				expectEqual(links.count, 0);
				input.Destroy();
				expectTrue(template.Enabled);
				expectEqual(jumpKeys.Parent, undefined);
				expectEqual(jumpPad.Parent, undefined);
				// the server's instances stay
				expectEqual(gameplay.Instance.Parent, playerFolder);
				expectDefined(gameplay.Instance.FindFirstChild("Jump"));
			});

			test("Create twice adopts the local bindings", () => {
				const first = createSaInput();
				const second = createSaInput();
				expectEqual(
					second.SaGameplay.Actions.Jump.Bindings.Gamepad.Instance,
					first.SaGameplay.Actions.Jump.Bindings.Gamepad.Instance,
				);
				// the three device bindings, once
				expectEqual(first.SaGameplay.Actions.Jump.Instance.GetChildren().size(), 3);
			});

			test("before the server's copy arrives, a stand-in works; then everything moves to it", () => {
				const input = InputActions.Create(SA_LATE_SCHEMA, {
					Folder: templates(),
					PlayerFolderName: SA_LATE_FOLDER_NAME,
				});
				defer(() => input.Destroy());
				const gameplay = input.LateGameplay;
				const { Jump, Move, Crouch } = gameplay.Actions;
				expectFalse(gameplay.IsLinkedToServer());
				expectFalse(input.LateVehicle.IsLinkedToServer());
				const standIn = gameplay.Instance;
				expectFalse(standIn.IsDescendantOf(Players.LocalPlayer));
				const links = countSignal(gameplay.LinkedToServer);

				// the stand-in works at once: state, events, Fire
				const pressed = countSignal(Jump.Pressed);
				const moves = recordSignal(Move.StateChanged);
				Jump.Fire(true);
				expectTrue(Jump.GetState());
				eventually(() => pressed.count === 1, "Pressed on the stand-in");
				Jump.Fire(false);
				// what must carry over: a rebind, a held request, a held virtual stick
				const jumpKey = Jump.Bindings.KeyboardAndMouse;
				jumpKey.Set(Enum.KeyCode.F);
				const vehicleOff = input.LateVehicle.Request(false);
				Move.Bindings.Virtual.Fire(new Vector2(0, 1));
				const jumpKeyInstance = jumpKey.Instance;

				expectTrue(server("provide", "late") === true);
				eventually(
					() => gameplay.IsLinkedToServer() && input.LateVehicle.IsLinkedToServer(),
					"the link to the server's copy",
				);
				const copy =
					Players.LocalPlayer.FindFirstChild(SA_LATE_FOLDER_NAME)?.FindFirstChild("LateGameplay");
				expectEqual(gameplay.Instance, copy);
				expectEqual(Jump.Instance.Parent, copy);
				expectEqual(standIn.Parent, undefined);
				// the same binding moved, with the rebind
				expectEqual(jumpKey.Instance, jumpKeyInstance);
				expectEqual(jumpKeyInstance.Parent, Jump.Instance);
				expectEqual(jumpKeyInstance.KeyCode, Enum.KeyCode.F);
				// the request still holds the context off
				expectFalse(input.LateVehicle.IsEnabled());
				expectFalse(input.LateVehicle.Instance.Enabled);
				vehicleOff();
				expectTrue(input.LateVehicle.Instance.Enabled);
				// the virtual stick is still held, now on the copy
				eventually(() => Move.GetState() === new Vector2(0, 1), "Move held on the copy");

				// connections made before the swap keep firing
				const before = pressed.count;
				Jump.Fire(true);
				eventually(() => pressed.count > before, "Pressed after the swap");
				if (getProject() === "authority") {
					// checked here, before the Reset below changes Jump's keys, which releases it on the
					// server too (design spec §6): asked after it, the poll only passed while the
					// release had not reached the server yet (2 failures in 3 isolated runs, 2026-10-02)
					eventually(
						() => server("state", "late", "LateGameplay", "Jump") === true,
						"the server to see the state driven after the swap",
						10,
					);
				}
				Move.Bindings.Virtual.Fire(Vector2.zero);
				eventually(() => moves[moves.size() - 1] === Vector2.zero, "StateChanged after the swap");
				let pressedFrames = 0;
				Crouch.Fire(true);
				for (let index = 0; index < 8; index++) {
					frames(1);
					if (Crouch.IsJustPressed()) pressedFrames++;
				}
				expectEqual(pressedFrames, 1, "TrackPrevious on the copy");
				// Reset returns to the same defaults
				jumpKey.Reset();
				expectEqual(jumpKeyInstance.KeyCode, Enum.KeyCode.Space);
				frames(3);
				expectEqual(links.count, 1);

				if (getProject() === "authority") {
					// the Reset changed the keys of a held Jump: released on the server too
					eventually(
						() => server("state", "late", "LateGameplay", "Jump") === false,
						"the Reset of a held Jump's keys releases it on the server",
						10,
					);
				}
				Jump.Fire(false);
				Crouch.Fire(false);
			});

			test("a copy that never arrives: one warning after Timeout, and a working stand-in", () => {
				const warnings = recordWarnings();
				const schema = InputActions.Schema({
					SaNever: { ServerAuthority: true, Actions: { Poke: InputActions.Bool() } },
				});
				const input = InputActions.Create(schema, {
					Folder: templates(),
					PlayerFolderName: "InputsNever",
					Timeout: 0.3,
				});
				defer(() => input.Destroy());
				expectFalse(input.SaNever.IsLinkedToServer());
				input.SaNever.Actions.Poke.Fire(true);
				expectTrue(input.SaNever.Actions.Poke.GetState());
				task.wait(1);
				const mine = warnings.filter((message) => names(message, "SaNever"));
				const timeouts = mine.filter(isTimeoutWarning);
				expectEqual(timeouts.size(), 1, "Timeout warnings naming SaNever");
				expectTrue(names(timeouts[0], "InputsNever"), timeouts[0]);
				expectTrue(names(timeouts[0], "ProvideToPlayers"), timeouts[0]);
				// The Timeout warning says nothing about the mode; that is a warning of its own
				expectFalse(isModeWarning(timeouts[0]), timeouts[0]);
				const modeWarnings = expectedServerAuthority() === false ? 1 : 0;
				expectEqual(mine.filter(isModeWarning).size(), modeWarnings, "Server Authority warnings");
				expectEqual(mine.size(), 1 + modeWarnings, mine.join(" | "));
				expectTrue(input.SaNever.Actions.Poke.GetState());
			});

			test("a copy without every schema action: the Timeout warning names what it lacks", () => {
				const warnings = recordWarnings();
				const schema = InputActions.Schema({
					SaPartial: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool(), Prod: InputActions.Bool() },
					},
				});
				// the server's copy, played on the client: an older schema, without Prod
				const playerFolder = new Instance("Folder");
				playerFolder.Name = "InputsPartial";
				const copy = new Instance("InputContext");
				copy.Name = "SaPartial";
				const poke = new Instance("InputAction");
				poke.Name = "Poke";
				poke.Parent = copy;
				copy.Parent = playerFolder;
				playerFolder.Parent = Players.LocalPlayer;
				defer(() => playerFolder.Destroy());
				const input = InputActions.Create(schema, {
					Folder: templates(),
					PlayerFolderName: "InputsPartial",
					Timeout: 0.3,
				});
				defer(() => input.Destroy());
				expectFalse(input.SaPartial.IsLinkedToServer());
				const timeout = (message: string) =>
					isTimeoutWarning(message) && names(message, "SaPartial");
				eventually(() => warnings.some(timeout), "the Timeout warning");
				const message = warnings.find(timeout)!;
				expectTrue(names(message, "lacks Prod"), message);
				input.SaPartial.Actions.Prod.Fire(true);
				expectTrue(input.SaPartial.Actions.Prod.GetState(), "the stand-in works");
			});

			// ---- the place's mode (IsServerAuthority)

			test("Create warns once when marked contexts meet a place without Server Authority", () => {
				const warnings = recordWarnings();
				const schema = InputActions.Schema({
					ModeMarkedB: { ServerAuthority: true, Actions: { Poke: InputActions.Bool() } },
					ModeMarkedA: { ServerAuthority: true, Actions: { Poke: InputActions.Bool() } },
					ModeLocal: { Actions: { Poke: InputActions.Bool() } },
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: "InputsMode",
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				frames(3);
				const mode = warnings.filter(isModeWarning);
				if (expectedServerAuthority() !== false) {
					expectEqual(mode.size(), 0, mode.join(" | "));
					return;
				}
				expectEqual(mode.size(), 1, mode.join(" | "));
				const message = mode[0];
				expectTrue(names(message, "InputActions.Create"), message);
				expectTrue(names(message, "ModeMarkedA, ModeMarkedB are marked"), message);
				expectFalse(names(message, "ModeLocal"), message);
				expectTrue(names(message, "never receive"), message);
				// still working on the client
				const poke = input.ModeMarkedA.Actions.Poke;
				poke.Fire(true);
				expectTrue(poke.GetState());
				poke.Fire(false);
			});

			test("a schema without marked contexts never warns about the mode", () => {
				const warnings = recordWarnings();
				createTestInput();
				frames(3);
				// TEST_SCHEMA's contexts; another test's warning may still be on its way
				const about = warnings.filter(
					(message) => isModeWarning(message) && names(message, ": Gameplay"),
				);
				expectEqual(about.size(), 0, about.join(" | "));
			});

			// ---- the server's copy is always enabled; the client owns Enabled (R4-F1)

			test("the copy takes the schema's Enabled on the client, once: the client's state stays", () => {
				const copy = localCopy("SaMenu", ["Open", "Close"]);
				defer(copy.Cleanup);
				copy.Arrive();
				const schema = InputActions.Schema({
					SaMenu: {
						ServerAuthority: true,
						Enabled: false,
						Actions: {
							Open: InputActions.Bool({ KeyboardAndMouse: K.M }, { Enabled: false }),
							Close: InputActions.Bool({ KeyboardAndMouse: K.N }),
						},
					},
				});
				const options = { Folder: newFolder(), PlayerFolderName: copy.FolderName, Timeout: 1000 };
				const first = InputActions.Create(schema, options);
				const menu = first.SaMenu;
				expectTrue(menu.IsLinkedToServer());
				expectEqual(menu.Instance, copy.Context);
				expectFalse(copy.Context.Enabled, "the schema's Enabled: false");
				expectFalse(menu.IsEnabled());
				expectFalse(menu.Actions.Open.IsEnabled(), "the action's Enabled: false");
				expectTrue(menu.Actions.Close.IsEnabled());

				// a second handle shares the client's state; after the last Destroy it stays on the copy
				menu.SetEnabled(true);
				menu.Actions.Open.SetEnabled(true);
				const second = InputActions.Create(schema, options);
				expectTrue(second.SaMenu.IsEnabled());
				expectTrue(second.SaMenu.Actions.Open.IsEnabled());
				second.Destroy();
				first.Destroy();
				expectTrue(copy.Context.Enabled, "the base state stays on the copy");
				const again = InputActions.Create(schema, options);
				defer(() => again.Destroy());
				expectTrue(again.SaMenu.IsEnabled(), "not the schema's again");
				expectTrue(again.SaMenu.Actions.Open.IsEnabled());
			});

			test("on the copy, the template's Enabled wins over the schema's, its extra actions included", () => {
				const folder = localTemplate("SaTemplated", false, [
					["Poke", false],
					["Wave", true],
					["Extra", false],
				]);
				const copy = localCopy("SaTemplated", ["Poke", "Wave", "Fresh", "Extra"]);
				defer(copy.Cleanup);
				copy.Arrive();
				const schema = InputActions.Schema({
					SaTemplated: {
						ServerAuthority: true,
						Enabled: true,
						Actions: {
							Poke: InputActions.Bool({ KeyboardAndMouse: K.P }, { Enabled: true }),
							Wave: InputActions.Bool({ KeyboardAndMouse: K.O }, { Enabled: false }),
							// the template lacks it: the schema's
							Fresh: InputActions.Bool({ KeyboardAndMouse: K.I }, { Enabled: false }),
						},
					},
				});
				const input = InputActions.Create(schema, {
					Folder: folder,
					PlayerFolderName: copy.FolderName,
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				expectTrue(input.SaTemplated.IsLinkedToServer());
				expectFalse(copy.Context.Enabled, "the template's context is off");
				expectFalse(input.SaTemplated.IsEnabled());
				expectFalse(copy.Action("Poke").Enabled, "Poke: the template's");
				expectTrue(copy.Action("Wave").Enabled, "Wave: the template's");
				expectFalse(copy.Action("Fresh").Enabled, "Fresh: the schema's");
				expectFalse(copy.Action("Extra").Enabled, "Extra: the template's, beside its key");
				expectDefined(copy.Action("Extra").FindFirstChild("ExtraKeyboardAndMouse"));
			});

			test("at the swap the copy takes the stand-in's Enabled, the template's extra actions included", () => {
				const folder = localTemplate("SaSwapped", true, [
					["Poke", true],
					["Extra", false],
				]);
				const copy = localCopy("SaSwapped", ["Poke", "Extra"]);
				defer(copy.Cleanup);
				const schema = InputActions.Schema({
					SaSwapped: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const input = InputActions.Create(schema, {
					Folder: folder,
					PlayerFolderName: copy.FolderName,
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				const context = input.SaSwapped;
				expectFalse(context.IsLinkedToServer());
				context.SetEnabled(false);
				context.Actions.Poke.SetEnabled(false);
				copy.Arrive();
				eventually(() => context.IsLinkedToServer(), "the swap");
				expectEqual(context.Instance, copy.Context);
				expectFalse(copy.Context.Enabled, "the base state");
				expectFalse(copy.Action("Poke").Enabled, "Poke, disabled on the stand-in");
				expectFalse(copy.Action("Extra").Enabled, "Extra, disabled in the template");
				context.SetEnabled(true);
				context.Actions.Poke.SetEnabled(true);
				expectTrue(copy.Context.Enabled);
				expectTrue(copy.Action("Poke").Enabled);
			});

			test("the server reads the state the client drives", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				const state = (actionName: string) => server("state", "sa", "SaGameplay", actionName);
				const pressedBefore = server("pressed", "sa") as number;
				jump.Fire(true);
				eventually(() => state("Jump") === true, "the server to see Jump pressed", 10);
				eventually(
					() => (server("pressed", "sa") as number) > pressedBefore,
					"the server's Pressed",
				);

				input.SaGameplay.Actions.Move.Bindings.Virtual.Fire(new Vector2(0, 1));
				eventually(() => state("Move") === new Vector2(0, 1), "the server to see Move", 10);

				// disabling the context on the client releases the state on the server too
				const release = input.SaGameplay.Request(false);
				eventually(() => state("Jump") === false, "the release on the server", 10);
				expectTrue(server("enabled", "sa", "SaGameplay") === true);
				release();
				input.SaGameplay.Actions.Move.Bindings.Virtual.Fire(Vector2.zero);
				frames(2);
			});

			test("a held binding removed under Server Authority releases the action", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				const gui = new Instance("ScreenGui");
				gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
				defer(() => gui.Destroy());
				const detach = jump.AttachButton(new Instance("TextButton", gui));
				// A binding that held the action and is gone, as a pressed button would be
				const holder = new Instance("InputBinding");
				holder.Type = Enum.InputBindingType.Scriptable;
				holder.Parent = jump.Instance;
				holder.Fire(true);
				eventually(() => jump.IsPressed(), "the press");
				holder.Destroy();
				frames(2);
				detach();
				eventually(() => !jump.IsPressed(), "the release on the client");
				eventually(
					() => server("state", "sa", "SaGameplay", "Jump") === false,
					"the release on the server",
					10,
				);
			});
		});
	}
}
