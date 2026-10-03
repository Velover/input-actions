import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions, RawInputHandler } from "@rbxts/input-actions";
import { Players, ReplicatedStorage } from "@rbxts/services";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { countSignal, frame, frames, newFolder } from "./helpers";
import { clickProblem, realInput, screenCenter, testButton, testGui } from "./virtual";

const K = Enum.KeyCode;

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(SA_REMOTE, 10),
		SA_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

const serverJump = () => server("state", "sa", "SaGameplay", "Jump");
const serverMove = () => server("state", "sa", "SaGameplay", "Move");
const serverCharacterMove = () =>
	server("playerModule", undefined, "CharacterContext", "MoveAction");

/** SA_SCHEMA on the server's copy (the template binds Jump to F) */
function createSaInput() {
	expectTrue(server("provide", "sa") === true);
	const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
	defer(() => input.Destroy());
	return input;
}

/**
 * Leaves the server's Jump and Move at rest after the test, whatever it left stuck there: a fresh
 * handle fires a held value then the value at rest on the package's Scriptable bindings. Call it
 * first in a test, so it runs after the test's other cleanup.
 */
function settleServerAfter() {
	defer(() => {
		const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
		const { Jump, Move } = input.SaGameplay.Actions;
		Jump.Fire(true);
		Move.Bindings.Virtual.Fire(new Vector2(0, 1));
		pcall(() => eventually(() => serverJump() === true, "the server's Jump held", 3));
		Jump.Fire(false);
		Move.Bindings.Virtual.Fire(Vector2.zero);
		pcall(() =>
			eventually(
				() => serverJump() === false && serverMove() === Vector2.zero,
				"the server's Jump and Move at rest",
				5,
			),
		);
		input.Destroy();
		frames(3);
	});
}

/** Whether `read` reads `value` within `seconds` */
function within(read: () => unknown, value: unknown, seconds = 3) {
	const deadline = os.clock() + seconds;
	while (os.clock() < deadline) {
		if (read() === value) return true;
		frames(2);
	}
	return false;
}

/**
 * Hunt round 1: Server Authority with real keys and clicks (authority only). The client's copy of
 * a context under the player is simulated: what it holds goes to the server.
 */
@Provider({ activeIn: ["testing"] })
export class HunterR1SaTests implements OnStart {
	onStart() {
		defineTests("hunter-r1-sa", () => {
			// ---- what works

			test("a real key held on the copy reaches the server; a context request releases it there for good", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				const release = input.SaGameplay.Request(false);
				eventually(() => serverJump() === false, "released on the server", 5);
				release();
				frames(10);
				expectEqual(
					`${jump.IsPressed()}/${serverJump()}`,
					"false/false",
					"F still down, both at rest",
				);
				real.Release(K.F);
				real.Press(K.F);
				eventually(() => serverJump() === true, "pressed again", 5);
				input.Destroy();
				eventually(() => serverJump() === false, "Destroy releases it on the server", 5);
			});

			test("AttachButton on the copy: the binding removed, or the button destroyed, under the finger releases it on the server", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const detach = jump.AttachButton(button);
				real.MouseDown(screenCenter(button));
				eventually(() => serverJump() === true, "the server sees the button", 5);
				detach();
				eventually(() => serverJump() === false, "released on the server", 5);
				real.MouseUp();
				frames(5);
				expectEqual(`${jump.IsPressed()}/${serverJump()}`, "false/false");

				jump.AttachButton(button);
				real.MouseDown(screenCenter(button));
				eventually(() => serverJump() === true, "the server sees the button again", 5);
				button.Destroy();
				eventually(() => serverJump() === false, "released with the button", 5);
				real.MouseUp();
				frames(5);
				expectEqual(`${jump.IsPressed()}/${serverJump()}`, "false/false");
			});

			// A context under the player is simulated under Server Authority, as the server's copy is. The
			// copy is played on the client here: providing SA_LATE_SCHEMA would spoil the stand-in test
			// of the server-authority section, which needs that copy to arrive after its own Create
			test("TrackPrevious on a context under the player: a real press is IsJustPressed for one frame, its release IsJustReleased for one", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = new Instance("Folder");
				folder.Name = "HunterR1TrackCopy";
				const context = new Instance("InputContext");
				context.Name = "HunterTrack";
				const action = new Instance("InputAction");
				action.Name = "Crouch";
				action.Parent = context;
				context.Parent = folder;
				folder.Parent = Players.LocalPlayer;
				defer(() => folder.Destroy());
				const schema = InputActions.Schema({
					HunterTrack: {
						ServerAuthority: true,
						Actions: {
							Crouch: InputActions.Bool({ KeyboardAndMouse: K.C }, { TrackPrevious: true }),
						},
					},
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: folder.Name,
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				expectTrue(input.HunterTrack.IsLinkedToServer());
				const crouch = input.HunterTrack.Actions.Crouch;
				frames(3);
				real.Press(K.C);
				let just = 0;
				for (let index = 0; index < 20; index++) {
					frame();
					if (crouch.IsJustPressed()) just++;
				}
				expectTrue(crouch.IsPressed());
				expectEqual(just, 1, "IsJustPressed frames");
				real.Release(K.C);
				let justReleased = 0;
				for (let index = 0; index < 20; index++) {
					frame();
					if (crouch.IsJustReleased()) justReleased++;
				}
				expectEqual(justReleased, 1, "IsJustReleased frames");
			});

			test("RawInputHandler.ControlSetEnabled(false) with a real W held stops the character on the server", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				RawInputHandler.Initialize();
				defer(() => RawInputHandler.ControlSetEnabled(true));
				real.Press(K.W);
				eventually(() => serverCharacterMove() !== Vector2.zero, "the server sees W", 5);
				RawInputHandler.ControlSetEnabled(false);
				eventually(() => serverCharacterMove() === Vector2.zero, "stopped on the server", 5);
				RawInputHandler.ControlSetEnabled(true);
				frames(10);
				expectEqual(serverCharacterMove(), Vector2.zero, "W still down: stays stopped");
				real.Release(K.W);
			});

			// ---- rebinding a held key: the copy keeps the action held, on the client and the server

			test("Set on a binding whose key is held: after the key comes up the action is released, on the client and the server", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				frames(3);
				real.Release(K.F);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after F came up: ${jump.IsPressed()}/${serverJump()}`,
				);
			});

			test("Set on a composite whose key is held: Move comes back to rest after the key comes up, on both sides", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const move = createSaInput().SaGameplay.Actions.Move;
				real.Press(K.W);
				eventually(() => serverMove() !== Vector2.zero, "the server sees W", 5);
				move.Bindings.KeyboardAndMouse.Set({ Up: K.T });
				frames(3);
				real.Release(K.W);
				expectTrue(
					within(() => move.GetState() === Vector2.zero && serverMove() === Vector2.zero, true),
					`client/server after W came up: ${move.GetState()}/${tostring(serverMove())}`,
				);
			});

			test("Set that only tunes a held binding (PressedThreshold, the same key): released on both sides once the key comes up", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				jump.Bindings.KeyboardAndMouse.Set({ KeyCode: K.F, PressedThreshold: 0.7 });
				frames(3);
				real.Release(K.F);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after F came up: ${jump.IsPressed()}/${serverJump()}`,
				);
			});

			test("ImportBindings while the old key is held: released on both sides once it comes up", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				const result = input.ImportBindings(
					'{"Version":1,"Bindings":{"SaGameplay/Jump/KeyboardAndMouse":{"KeyCode":"G"}}}',
				);
				expectEqual(result.Applied.size(), 1);
				frames(3);
				real.Release(K.F);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after F came up: ${jump.IsPressed()}/${serverJump()}`,
				);
			});

			test("ResetBindings while the rebound key is held: released on both sides once it comes up", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				real.Press(K.G);
				eventually(() => serverJump() === true, "the server sees G", 5);
				input.ResetBindings();
				frames(3);
				real.Release(K.G);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after G came up: ${jump.IsPressed()}/${serverJump()}`,
				);
			});

			test("Capture while the old key is held: once both keys are up, the server agrees with the client", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				const captured = new Array<Enum.KeyCode>();
				jump.Bindings.KeyboardAndMouse.Capture("KeyCode", (key) => captured.push(key));
				real.Press(K.G);
				eventually(() => captured.size() === 1, "G captured");
				real.Release(K.G);
				real.Release(K.F);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after both keys came up: ${jump.IsPressed()}/${serverJump()}`,
				);
			});

			test("after a rebind left it held, pressing the new key lets go on the server too", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				const released = countSignal(jump.Released);
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				frames(3);
				real.Release(K.F);
				frames(10);
				real.Tap(K.G);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after a tap of G: ${jump.IsPressed()}/${serverJump()} (Released ${released.count})`,
				);
			});
		});
	}
}
