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
import { SA_LATE_FOLDER_NAME, SA_LATE_SCHEMA, SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { countSignal, frames, recordSignal, recordWarnings } from "./helpers";

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
				expectEqual(first.SaGameplay.Actions.Jump.Instance.GetChildren().size(), 2);
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
					eventually(
						() => server("state", "late", "LateGameplay", "Jump") === true,
						"the server to see the state driven after the swap",
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
				const mine = warnings.filter(
					(message) => message.find("SaNever", 1, true)[0] !== undefined,
				);
				expectEqual(mine.size(), 1, "warnings naming SaNever");
				expectTrue(mine[0].find("InputsNever", 1, true)[0] !== undefined, mine[0]);
				expectTrue(mine[0].find("ProvideToPlayers", 1, true)[0] !== undefined, mine[0]);
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
				eventually(
					() => warnings.some((message) => message.find("SaPartial", 1, true)[0] !== undefined),
					"the Timeout warning",
				);
				const message = warnings.find((text) => text.find("SaPartial", 1, true)[0] !== undefined)!;
				expectTrue(message.find("lacks Prod", 1, true)[0] !== undefined, message);
				input.SaPartial.Actions.Prod.Fire(true);
				expectTrue(input.SaPartial.Actions.Prod.GetState(), "the stand-in works");
			});

			test("the server reads the state the client drives", () => {
				if (getProject() !== "authority") return;
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
				if (getProject() !== "authority") return;
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
