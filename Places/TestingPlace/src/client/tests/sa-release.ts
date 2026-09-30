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
import { frames } from "./helpers";

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(SA_REMOTE, 10),
		SA_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

function createSaInput() {
	expectTrue(server("provide", "sa") === true);
	const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
	defer(() => input.Destroy());
	return input;
}

function serverJump() {
	return server("state", "sa", "SaGameplay", "Jump");
}

function serverPressed() {
	return server("pressed", "sa") as number;
}

/**
 * A Scriptable binding the package doesn't drive, under the server's action: it stands in for a
 * key held down. Afterwards a real true/false change leaves the server's Jump at rest for the tests
 * that follow, whatever this test left behind.
 */
function heldKey(action: InputAction) {
	const binding = new Instance("InputBinding");
	binding.Name = "HeldKeyStandIn";
	binding.Type = Enum.InputBindingType.Scriptable;
	binding.Parent = action;
	defer(() => {
		pcall(() => binding.Fire(true));
		frames(3);
		pcall(() => binding.Fire(false));
		pcall(() => eventually(() => serverJump() === false, "the held key let go", 5));
		binding.Destroy();
	});
	return binding;
}

/** Holds Jump through a key the package doesn't drive, until the server sees it */
function holdJumpOnServer(action: InputAction) {
	const key = heldKey(action);
	key.Fire(true);
	eventually(() => serverJump() === true, "the server to see Jump held", 10);
	return key;
}

/** Whether the client's state stays at rest for a few frames (it comes back when not released) */
function staysReleased(read: () => boolean) {
	for (let index = 0; index < 20; index++) {
		if (read()) return false;
		frames(1);
	}
	return true;
}

/**
 * Under Server Authority a client-side reset (a context or action disabled) releases the client's
 * state only: the server keeps the last value it received, and the client's comes back when the
 * context is enabled again. The package releases through a Scriptable binding first (design spec §5, §8).
 */
@Provider({ activeIn: ["testing"] })
export class ServerAuthorityReleaseTests implements OnStart {
	onStart() {
		defineTests("sa-release", () => {
			test("focus loss releases a key held on the server, and it doesn't come back", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				holdJumpOnServer(jump.Instance);

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
				eventually(() => serverJump() === false, "the release on the server", 5);
				eventually(() => input.SaGameplay.IsEnabled(), "the context back on");
				expectTrue(
					staysReleased(() => jump.IsPressed()),
					"the client's Jump stays released",
				);
				expectEqual(serverJump(), false);
			});

			test("action SetEnabled(false) releases a key held on the server", () => {
				if (getProject() !== "authority") return;
				const jump = createSaInput().SaGameplay.Actions.Jump;
				holdJumpOnServer(jump.Instance);
				jump.SetEnabled(false);
				defer(() => jump.SetEnabled(true));
				eventually(() => serverJump() === false, "the release on the server", 5);
				jump.SetEnabled(true);
				expectTrue(staysReleased(() => jump.IsPressed()), "the client's Jump stays released");
			});

			test("a Fire right before Request(false) doesn't stay held on the server", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				heldKey(jump.Instance); // only for its clean-up
				jump.Fire(true);
				const release = input.SaGameplay.Request(false);
				defer(release);
				frames(10);
				eventually(() => serverJump() === false, "Jump at rest on the server", 5);
				release();
				expectTrue(staysReleased(() => jump.IsPressed()), "the client's Jump stays released");
			});

			test("a button binding removed while held releases the server", () => {
				if (getProject() !== "authority") return;
				const jump = createSaInput().SaGameplay.Actions.Jump;
				const gui = new Instance("ScreenGui");
				gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
				defer(() => gui.Destroy());
				const detach = jump.AttachButton(new Instance("TextButton", gui));
				// The key stands in for the pressed button: removing the button's binding resets Jump
				holdJumpOnServer(jump.Instance);
				detach();
				eventually(() => serverJump() === false, "the release on the server", 5);
				expectFalse(jump.IsPressed());
			});

			test("Destroy releases on the server what a key still holds", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				holdJumpOnServer(input.SaGameplay.Actions.Jump.Instance);
				input.Destroy();
				eventually(() => serverJump() === false, "the release on the server", 5);
			});

			test("every Tap reaches the server as one press", () => {
				if (getProject() !== "authority") return;
				const jump = createSaInput().SaGameplay.Actions.Jump;
				heldKey(jump.Instance); // only for its clean-up
				eventually(() => serverJump() === false, "Jump at rest on the server", 5);
				const before = serverPressed();
				for (let index = 0; index < 3; index++) {
					jump.Tap();
					eventually(() => serverPressed() === before + index + 1, `the server's press ${index + 1}`, 5);
					eventually(() => !jump.IsPressed() && serverJump() === false, "the release", 5);
				}
			});

			test("two handles on the server's copy release it once", () => {
				if (getProject() !== "authority") return;
				const first = createSaInput();
				const second = createSaInput();
				expectEqual(first.SaGameplay.Instance, second.SaGameplay.Instance);
				holdJumpOnServer(first.SaGameplay.Actions.Jump.Instance);
				frames(5);
				const pressed = serverPressed();
				const release = second.SaGameplay.Request(false);
				defer(release);
				eventually(() => serverJump() === false, "the release on the server", 5);
				frames(10);
				expectEqual(serverPressed(), pressed, "no extra press on the server");
				expectFalse(first.SaGameplay.IsEnabled());
			});

			test("RawInputHandler.ControlSetEnabled(false) releases the character's move on the server", () => {
				if (getProject() !== "authority") return;
				RawInputHandler.Initialize();
				const context = expectDefined(
					Players.LocalPlayer.WaitForChild("InputContexts", 10)?.WaitForChild("CharacterContext", 10),
				) as InputContext;
				const move = context.WaitForChild("MoveAction", 10) as InputAction;
				const serverMove = () => server("playerModule", undefined, "CharacterContext", "MoveAction");
				const stick = new Instance("InputBinding");
				stick.Name = "HeldStickStandIn";
				stick.Type = Enum.InputBindingType.Scriptable;
				stick.Parent = move;
				defer(() => {
					RawInputHandler.ControlSetEnabled(true);
					pcall(() => stick.Fire(new Vector2(0, 1)));
					frames(3);
					pcall(() => stick.Fire(Vector2.zero));
					pcall(() => eventually(() => serverMove() === Vector2.zero, "the stick let go", 5));
					stick.Destroy();
				});
				stick.Fire(new Vector2(0, 1));
				eventually(() => serverMove() === new Vector2(0, 1), "the server to see the stick", 10);
				const bindings = move.GetChildren().size();

				RawInputHandler.ControlSetEnabled(false);
				expectFalse(context.Enabled);
				eventually(() => serverMove() === Vector2.zero, "the release on the server", 5);
				expectEqual(move.GetChildren().size(), bindings, "no binding left behind");
				RawInputHandler.ControlSetEnabled(true);
				expectTrue(
					staysReleased(() => move.GetState() !== Vector2.zero),
					"the client's move stays released",
				);
			});
		});
	}
}
