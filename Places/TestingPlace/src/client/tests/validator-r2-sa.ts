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
import { InputActions, RawInputHandler } from "@rbxts/input-actions";
import { Players, ReplicatedStorage } from "@rbxts/services";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { frames, recordSignal } from "./helpers";

// Validator round 2: Server Authority, what reaches the server when the client resets or lets go.

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(SA_REMOTE, 10),
		SA_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

/** Reads any action of the player's copies on the server (src/server/tests/validator-r2-server.ts) */
function serverState(folderName: string, contextName: string, actionName: string): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild("ValidatorR2Server", 10),
		"ValidatorR2Server",
	) as RemoteFunction;
	return remote.InvokeServer("state", folderName, contextName, actionName) as unknown;
}

function serverPressed(folderName: string, contextName: string, actionName: string): number {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild("ValidatorR2Server", 10),
		"ValidatorR2Server",
	) as RemoteFunction;
	return (remote.InvokeServer("pressed", folderName, contextName, actionName) as number) ?? 0;
}

function createSaInput() {
	expectTrue(server("provide", "sa") === true);
	const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
	defer(() => input.Destroy());
	return input;
}

const serverJump = () => serverState("Inputs", "SaGameplay", "Jump");

/**
 * A Scriptable binding the package doesn't drive: it stands in for a key held down. Afterwards a
 * real change to the value and back to rest leaves the server's action at rest for later tests.
 */
function heldKey(action: InputAction, held: unknown, rest: unknown, read: () => unknown) {
	const binding = new Instance("InputBinding");
	binding.Name = "ValidatorR2HeldKey";
	binding.Type = Enum.InputBindingType.Scriptable;
	binding.Parent = action;
	defer(() => {
		pcall(() => binding.Fire(held));
		frames(3);
		pcall(() => binding.Fire(rest));
		pcall(() => eventually(() => read() === rest, "the held key let go", 5));
		binding.Destroy();
	});
	binding.Fire(held);
	eventually(() => read() === held, "the server to see the key held", 10);
	return binding;
}

/** Whether a read stays at rest for a few frames (the client's state comes back when not released) */
function staysAt(read: () => unknown, rest: unknown) {
	for (let index = 0; index < 20; index++) {
		if (read() !== rest) return false;
		frames(1);
	}
	return true;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR2ServerAuthorityTests implements OnStart {
	onStart() {
		defineTests("validator-r2-sa", () => {
			// ---- several root handles on the server's copy

			test("destroying the handle whose Fire holds a shared action releases the server", () => {
				if (getProject() !== "authority") return;
				const keeper = createSaInput();
				const holder = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
				let destroyed = false;
				defer(() => {
					if (!destroyed) holder.Destroy();
				});
				// runs before the keeper's Destroy: leaves the server's Jump at rest for later tests
				defer(() => {
					const jump = keeper.SaGameplay.Actions.Jump;
					jump.Fire(true);
					frames(3);
					jump.Fire(false);
					pcall(() => eventually(() => serverJump() === false, "Jump at rest", 5));
				});
				holder.SaGameplay.Actions.Jump.Fire(true);
				eventually(() => serverJump() === true, "the server to see the holder's Jump", 10);
				holder.Destroy();
				destroyed = true;
				eventually(() => serverJump() === false, "the release on the server", 5);
				expectFalse(keeper.SaGameplay.Actions.Jump.IsPressed());
			});

			// ---- actions of the server's copy that the schema doesn't mention (the template's Emote)

			test("Request(false) releases on the server a template action the package gave keys", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const emote = expectDefined(
					input.SaGameplay.Instance.FindFirstChild("Emote"),
					"the copy's Emote",
				) as InputAction;
				expectDefined(
					emote.FindFirstChild("EmoteKeyboardAndMouse"),
					"the template's binding the package added",
				);
				const read = () => serverState("Inputs", "SaGameplay", "Emote");
				heldKey(emote, true, false, read);
				const release = input.SaGameplay.Request(false);
				defer(release);
				eventually(() => read() === false, "the release of Emote on the server", 5);
			});

			test("focus loss releases on the server a template action the package gave keys", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const emote = expectDefined(input.SaGameplay.Instance.FindFirstChild("Emote")) as InputAction;
				const read = () => serverState("Inputs", "SaGameplay", "Emote");
				heldKey(emote, true, false, read);
				const gui = new Instance("ScreenGui");
				gui.ResetOnSpawn = false;
				const box = new Instance("TextBox");
				box.Parent = gui;
				gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
				defer(() => {
					box.ReleaseFocus();
					gui.Destroy();
				});
				box.CaptureFocus();
				eventually(() => read() === false, "the release of Emote on the server", 5);
			});

			// ---- R1-F1/F2 again, on other paths and action types

			test("context SetEnabled(false) releases a key-held action on the server", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				heldKey(jump.Instance, true, false, serverJump);
				input.SaGameplay.SetEnabled(false);
				defer(() => input.SaGameplay.SetEnabled(true));
				eventually(() => serverJump() === false, "the release on the server", 5);
				input.SaGameplay.SetEnabled(true);
				expectTrue(staysAt(() => jump.IsPressed(), false), "the client's Jump stays released");
			});

			test("focus loss releases a key-held Direction1D on the server", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const throttle = input.SaVehicle.Actions.Throttle;
				const read = () => serverState("Inputs", "SaVehicle", "Throttle");
				heldKey(throttle.Instance, 1, 0, read);
				const gui = new Instance("ScreenGui");
				gui.ResetOnSpawn = false;
				const box = new Instance("TextBox");
				box.Parent = gui;
				gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
				defer(() => {
					box.ReleaseFocus();
					gui.Destroy();
				});
				box.CaptureFocus();
				eventually(() => read() === 0, "the release on the server", 5);
				eventually(() => input.SaVehicle.IsEnabled(), "the context back on");
				expectTrue(staysAt(() => throttle.GetState(), 0), "the client's Throttle stays at rest");
			});

			test("a key-held Direction2D is released on the server by action SetEnabled(false)", () => {
				if (getProject() !== "authority") return;
				const move = createSaInput().SaGameplay.Actions.Move;
				const read = () => serverState("Inputs", "SaGameplay", "Move");
				heldKey(move.Instance, new Vector2(0, 1), Vector2.zero, read);
				move.SetEnabled(false);
				defer(() => move.SetEnabled(true));
				eventually(() => read() === Vector2.zero, "the release on the server", 5);
			});

			test("a virtual stick and a key both holding Move: one Request(false) releases the server", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const move = input.SaGameplay.Actions.Move;
				const read = () => serverState("Inputs", "SaGameplay", "Move");
				heldKey(move.Instance, new Vector2(1, 0), Vector2.zero, read);
				move.Bindings.Virtual.Fire(new Vector2(0, 1));
				eventually(() => read() === new Vector2(0, 1), "the virtual stick on the server", 5);
				const release = input.SaGameplay.Request(false);
				defer(release);
				eventually(() => read() === Vector2.zero, "the release on the server", 5);
				release();
				expectTrue(
					staysAt(() => move.GetState(), Vector2.zero),
					"the client's Move stays at rest",
				);
			});

			test("quick Taps in one frame end released on both sides", () => {
				if (getProject() !== "authority") return;
				const jump = createSaInput().SaGameplay.Actions.Jump;
				eventually(() => serverJump() === false, "Jump at rest on the server", 5);
				const before = serverPressed("Inputs", "SaGameplay", "Jump");
				jump.Tap();
				jump.Tap();
				jump.Tap();
				eventually(
					() => serverPressed("Inputs", "SaGameplay", "Jump") > before,
					"a press on the server",
					5,
				);
				eventually(() => !jump.IsPressed() && serverJump() === false, "the release", 5);
			});

			test("Destroy while a Request(false) holds the copy off leaves nothing held", () => {
				if (getProject() !== "authority") return;
				expectTrue(server("provide", "sa") === true);
				const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
				let destroyed = false;
				defer(() => {
					if (!destroyed) input.Destroy();
				});
				const jump = input.SaGameplay.Actions.Jump;
				const copy = input.SaGameplay.Instance;
				expectTrue(input.SaGameplay.IsLinkedToServer(), "on the server's copy");
				jump.Fire(true);
				eventually(() => serverJump() === true, "the server to see Jump", 10);
				input.SaGameplay.Request(false);
				input.Destroy();
				destroyed = true;
				expectTrue(copy.Enabled, "the copy gets its base state back");
				eventually(() => serverJump() === false, "Jump at rest on the server", 5);
				expectTrue(
					staysAt(() => (copy.FindFirstChild("Jump") as InputAction).GetState(), false),
					"the client's Jump stays at rest",
				);
			});

			test("a context's EnabledChanged hears one pair per focus loss under Server Authority", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const changes = recordSignal(input.SaGameplay.EnabledChanged);
				const gui = new Instance("ScreenGui");
				gui.ResetOnSpawn = false;
				const box = new Instance("TextBox");
				box.Parent = gui;
				gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
				defer(() => {
					box.ReleaseFocus();
					gui.Destroy();
				});
				box.CaptureFocus();
				eventually(() => changes.size() >= 2, "the pair");
				frames(5);
				expectEqual(changes.size(), 2);
				expectTrue(input.SaGameplay.Instance.Enabled);
			});

			test("ControlSetEnabled(false) releases the character's jump on the server", () => {
				if (getProject() !== "authority") return;
				RawInputHandler.Initialize();
				const context = expectDefined(
					Players.LocalPlayer.WaitForChild("InputContexts", 10)?.WaitForChild("CharacterContext", 10),
				) as InputContext;
				const jumpAction = expectDefined(context.WaitForChild("JumpAction", 10)) as InputAction;
				const read = () => server("playerModule", undefined, "CharacterContext", "JumpAction");
				heldKey(jumpAction, true, false, read);
				// runs before the key's clean-up: the context must be on for it to let go
				defer(() => RawInputHandler.ControlSetEnabled(true));
				RawInputHandler.ControlSetEnabled(false);
				eventually(() => read() === false, "the release on the server", 5);
				RawInputHandler.ControlSetEnabled(true);
				expectTrue(staysAt(() => jumpAction.GetState(), false), "the client's jump stays released");
			});
		});
	}
}
