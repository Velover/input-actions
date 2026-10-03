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
import { InputActions } from "@rbxts/input-actions";
import { Players, ReplicatedStorage, UserInputService } from "@rbxts/services";
import { HUNTER_LATE_SCHEMA, HUNTER_R2_REMOTE } from "shared/fixtures/hunter-r2-fixture";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { countSignal, frames, newFolder } from "./helpers";
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
/** How many times the server's Jump fired Pressed this session */
const serverPressed = () => server("pressed", "sa") as number;

/** SA_SCHEMA on the server's copy (the template binds Jump's KeyboardAndMouse to F) */
function createSaInput() {
	expectTrue(server("provide", "sa") === true);
	const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
	defer(() => input.Destroy());
	return input;
}

/**
 * Leaves the server's Jump and Move at rest after the test, whatever a failure left there. Call it
 * first, so it runs after the rest of the test's cleanup.
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

/** Calls the server's hunter-r2 fixture (src/server/tests/hunter-r2-server.ts) */
function lateServer(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(HUNTER_R2_REMOTE, 10),
		HUNTER_R2_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

let lateCount = 0;

/**
 * HUNTER_LATE_SCHEMA created on stand-ins, under a player folder name of the test's own that the
 * server provides only when `provide` is called; the server stops providing after the test
 */
function createLateInput() {
	lateCount++;
	const folderName = `InputsHunterLate${lateCount}`;
	defer(() => lateServer("stop", folderName));
	const input = InputActions.Create(HUNTER_LATE_SCHEMA, {
		Folder: newFolder(),
		PlayerFolderName: folderName,
		Timeout: 1000,
	});
	defer(() => input.Destroy());
	const provide = () => {
		expectTrue(lateServer("provide", folderName) === true);
		eventually(() => input.HunterLate.IsLinkedToServer(), "the swap to the server's copy", 10);
	};
	const serverState = (action: string) => lateServer("state", folderName, action);
	return { input, provide, serverState, folderName };
}

/** The Pressed/Released sequence of a Bool action until the test ends, as "P" and "R" */
function recordPresses(action: InputActions.BoolAction) {
	const events = new Array<string>();
	const pressed = action.Pressed.Connect(() => events.push("P"));
	const released = action.Released.Connect(() => events.push("R"));
	defer(() => {
		pressed.Disconnect();
		released.Disconnect();
	});
	return events;
}

/** `client/server` for a Bool action of SaGameplay */
function both(action: InputActions.BoolAction) {
	return `${action.IsPressed()}/${serverJump()}`;
}

/**
 * Hunt round 2: Server Authority with real keys and clicks (authority only), on the server's copy
 * of SA_SCHEMA, where IAS keeps an action held on both sides when its bindings are reset.
 */
@Provider({ activeIn: ["testing"] })
export class HunterR2SaTests implements OnStart {
	onStart() {
		defineTests("hunter-r2-sa", () => {
			// The package keeps the value it fired as held while a key-up has since put the action at rest
			// (the last write wins), so a rebind fires its release pair on an action at rest. Measured:
			// that pair shows nowhere, on the client or the server
			test("server's copy: a rebind while Jump rests, after a key-up overrode a fired value, presses nothing on either side", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				jump.Fire(true);
				eventually(() => serverJump() === true, "the server sees the Fire", 5);
				real.Press(K.F);
				frames(3);
				real.Release(K.F);
				expectTrue(
					within(() => both(jump), "false/false"),
					`client/server after F came up: ${both(jump)}`,
				);
				frames(5);
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				const serverBefore = serverPressed();
				jump.Bindings.Gamepad.Set(K.ButtonB);
				frames(10);
				expectEqual(both(jump), "false/false", "client/server after the rebind");
				expectEqual(
					`${pressed.count}/${released.count}`,
					"0/0",
					"Pressed/Released on the client after the rebind",
				);
				expectEqual(serverPressed(), serverBefore, "Pressed on the server after the rebind");
			});

			test("server's copy: Capture while Jump rests takes the key as it goes down; nothing sticks, and the key then works", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				const captured = new Array<Enum.KeyCode>();
				jump.Bindings.KeyboardAndMouse.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				real.Press(K.G);
				eventually(() => captured.size() === 1, "G captured");
				frames(5);
				const whileDown = both(jump);
				real.Release(K.G);
				expectTrue(
					within(() => both(jump), "false/false"),
					`client/server after G came up: ${both(jump)} (while down: ${whileDown})`,
				);
				frames(10);
				expectEqual(both(jump), "false/false", "still at rest");
				real.Press(K.G);
				eventually(() => serverJump() === true, "G presses Jump on the server", 5);
				real.Release(K.G);
				expectTrue(
					within(() => both(jump), "false/false"),
					`client/server after a press of G: ${both(jump)}`,
				);
			});

			test("server's copy: a rebind while an attached button is held releases both sides; the mouse-up leaves both at rest", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				jump.AttachButton(button);
				real.MouseDown(screenCenter(button));
				eventually(() => serverJump() === true, "the server sees the button", 5);
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				expectTrue(
					within(() => both(jump), "false/false"),
					`client/server after the rebind: ${both(jump)}`,
				);
				real.MouseUp();
				frames(10);
				expectEqual(both(jump), "false/false", "after the mouse-up");
				real.MouseDown(screenCenter(button));
				eventually(() => serverJump() === true, "the next press reaches the server", 5);
				real.MouseUp();
				expectTrue(
					within(() => both(jump), "false/false"),
					`client/server after the second press: ${both(jump)}`,
				);
			});

			test("server's copy: rebound while a request holds the context off and the old key is down; afterwards both rest and the new key works", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				const release = input.SaGameplay.Request(false);
				defer(release);
				eventually(() => serverJump() === false, "released on the server", 5);
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				frames(3);
				release();
				frames(10);
				expectEqual(both(jump), "false/false", "back on, F still down and no longer bound");
				real.Release(K.F);
				frames(10);
				expectEqual(both(jump), "false/false", "after F came up");
				real.Press(K.G);
				eventually(() => serverJump() === true, "G", 5);
				real.Release(K.G);
				expectTrue(
					within(() => both(jump), "false/false"),
					`after G came up: ${both(jump)}`,
				);
			});

			test("server's copy: rebound while the action is disabled and its key is down; afterwards both rest and the new key works", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				defer(() => jump.SetEnabled(true));
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				jump.SetEnabled(false);
				eventually(() => serverJump() === false, "released on the server", 5);
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				frames(3);
				jump.SetEnabled(true);
				frames(10);
				expectEqual(both(jump), "false/false", "enabled again, F still down and no longer bound");
				real.Release(K.F);
				frames(10);
				expectEqual(both(jump), "false/false", "after F came up");
				real.Press(K.G);
				eventually(() => serverJump() === true, "G", 5);
				real.Release(K.G);
				expectTrue(
					within(() => both(jump), "false/false"),
					`after G came up: ${both(jump)}`,
				);
			});

			test("server's copy: Move held by two keys, a composite rebind that drops one; both sides rest after the keys come up", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const move = createSaInput().SaGameplay.Actions.Move;
				real.Press(K.W);
				real.Press(K.D);
				eventually(
					() => {
						const value = serverMove() as Vector2;
						return value.X > 0 && value.Y > 0;
					},
					"the server sees W and D",
					5,
				);
				move.Bindings.KeyboardAndMouse.Set({ Right: K.L });
				expectTrue(
					within(() => move.GetState() === Vector2.zero && serverMove() === Vector2.zero, true),
					`client/server after the rebind: ${move.GetState()}/${tostring(serverMove())}`,
				);
				real.Release(K.W);
				frames(5);
				real.Release(K.D);
				frames(10);
				expectEqual(move.GetState(), Vector2.zero, "the client after both keys came up");
				expectEqual(serverMove(), Vector2.zero, "the server after both keys came up");
				real.Press(K.L);
				eventually(() => serverMove() === new Vector2(1, 0), "L", 5);
				real.Release(K.L);
				eventually(() => serverMove() === Vector2.zero, "at rest", 5);
			});

			test("server's copy: the focus-loss reset with a real key held releases both sides while the TextBox has the key", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				const gui = new Instance("ScreenGui");
				gui.ResetOnSpawn = false;
				const box = new Instance("TextBox");
				box.Size = UDim2.fromOffset(200, 50);
				box.Text = "";
				box.Parent = gui;
				gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
				defer(() => {
					box.ReleaseFocus();
					gui.Destroy();
				});
				box.CaptureFocus();
				eventually(() => serverJump() === false, "released on the server", 5);
				eventually(() => input.SaGameplay.IsEnabled(), "the context back on");
				frames(10);
				expectEqual(both(jump), "false/false", "the TextBox has focus, F still down");
				real.Release(K.F);
				frames(5);
				box.ReleaseFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === undefined, "focus released");
				frames(3);
				expectEqual(both(jump), "false/false", "after F came up");
				real.Press(K.F);
				eventually(() => serverJump() === true, "F works again", 5);
				real.Release(K.F);
				expectTrue(
					within(() => both(jump), "false/false"),
					`after F came up: ${both(jump)}`,
				);
			});

			// The copy's state moves on simulation steps: a key that went down this frame doesn't show
			// in GetState yet, so a rebind in that frame reads the action at rest
			test("server's copy: a key goes down and another binding is rebound in the same frame; after the key comes up both rest", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				frames(5);
				real.Press(K.F);
				const before = jump.IsPressed();
				jump.Bindings.Gamepad.Set(K.ButtonB);
				frames(10);
				const afterRebind = both(jump);
				real.Release(K.F);
				expectTrue(
					within(() => both(jump), "false/false"),
					`client/server after F came up: ${both(jump)} (pressed when rebound: ${before}; 10 frames after the rebind: ${afterRebind})`,
				);
				real.Press(K.F);
				eventually(() => serverJump() === true, "F works again", 5);
				real.Release(K.F);
				expectTrue(
					within(() => both(jump), "false/false"),
					`after a press of F: ${both(jump)}`,
				);
			});

			// Since 0.7.0 a binding holds its device's keys only, so the key holding Jump through its
			// keyboard binding can't be captured into the Gamepad one: the capture takes a gamepad
			// KeyCode (as VirtualInput sends it) while F holds Jump, a change to the keys of a held action
			test("server's copy: Capture into the other binding while a key holds Jump; after it comes up both rest", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				const captured = new Array<Enum.KeyCode>();
				real.Press(K.F);
				eventually(() => serverJump() === true, "F holds Jump", 5);
				jump.Bindings.Gamepad.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				real.Tap(K.ButtonX);
				eventually(() => captured.size() === 1, "ButtonX captured");
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonX);
				frames(10);
				const whileDown = both(jump);
				real.Release(K.F);
				expectTrue(
					within(() => both(jump), "false/false"),
					`client/server after F came up: ${both(jump)} (while down: ${whileDown})`,
				);
				real.Press(K.F);
				eventually(() => serverJump() === true, "F works", 5);
				real.Release(K.F);
				expectTrue(
					within(() => both(jump), "false/false"),
					`after a press of F: ${both(jump)}`,
				);
			});

			// ---- the real server's copy arriving while real keys are held on the stand-in

			test("swap: the server's copy arrives while a real key holds Jump on the stand-in; afterwards nothing sticks", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input, provide, serverState } = createLateInput();
				const jump = input.HunterLate.Actions.Jump;
				const events = recordPresses(jump);
				const read = () => `${jump.IsPressed()}/${serverState("Jump")}`;
				real.Press(K.J);
				eventually(() => jump.IsPressed(), "pressed on the stand-in");
				provide();
				frames(10);
				const atSwap = read();
				real.Release(K.J);
				expectTrue(
					within(read, "false/false"),
					`client/server after J came up: ${read()} (after the swap: ${atSwap}; events ${events.join("")})`,
				);
				frames(10);
				expectEqual(read(), "false/false", "still at rest");
				real.Press(K.J);
				eventually(() => serverState("Jump") === true, "J reaches the server", 5);
				real.Release(K.J);
				expectTrue(within(read, "false/false"), `after a press of J: ${read()}`);
				const sequence = events.join("");
				expectTrue(sequence.find("PP", 1, true)[0] === undefined, sequence);
				expectTrue(sequence.find("RR", 1, true)[0] === undefined, sequence);
				expectEqual(sequence.sub(-1), "R", sequence);
			});

			test("swap: a key rebound on the stand-in and held at the swap; afterwards nothing sticks and only the new key reaches the server", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input, provide, serverState } = createLateInput();
				const jump = input.HunterLate.Actions.Jump;
				const read = () => `${jump.IsPressed()}/${serverState("Jump")}`;
				jump.Bindings.KeyboardAndMouse.Set(K.L);
				real.Press(K.L);
				eventually(() => jump.IsPressed(), "L on the stand-in");
				provide();
				frames(10);
				const atSwap = read();
				real.Release(K.L);
				expectTrue(
					within(read, "false/false"),
					`client/server after L came up: ${read()} (after the swap: ${atSwap})`,
				);
				expectEqual(
					jump.Bindings.KeyboardAndMouse.Instance.KeyCode,
					K.L,
					"the rebind carried over",
				);
				real.Press(K.J);
				frames(10);
				expectEqual(read(), "false/false", "the old key does nothing");
				real.Release(K.J);
				real.Press(K.L);
				eventually(() => serverState("Jump") === true, "L reaches the server", 5);
				real.Release(K.L);
				expectTrue(within(read, "false/false"), `after a press of L: ${read()}`);
			});

			test("swap: Move held by a composite key at the swap comes back to rest on both sides", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input, provide, serverState } = createLateInput();
				const move = input.HunterLate.Actions.Move;
				real.Press(K.T);
				eventually(() => move.GetState() === new Vector2(0, 1), "T on the stand-in");
				provide();
				frames(10);
				const atSwap = `${move.GetState()}/${tostring(serverState("Move"))}`;
				real.Release(K.T);
				expectTrue(
					within(
						() => move.GetState() === Vector2.zero && serverState("Move") === Vector2.zero,
						true,
					),
					`client/server after T came up: ${move.GetState()}/${tostring(serverState("Move"))} (after the swap: ${atSwap})`,
				);
				real.Press(K.N);
				eventually(() => serverState("Move") === new Vector2(1, 0), "N reaches the server", 5);
				real.Release(K.N);
				eventually(() => serverState("Move") === Vector2.zero, "at rest on the server", 5);
			});

			test("swap: TrackPrevious with a real key held at the swap: one IsJustPressed for the press, one IsJustReleased for the release", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input, serverState, folderName } = createLateInput();
				const crouch = input.HunterLate.Actions.Crouch;
				let justPressed = 0;
				let justReleased = 0;
				const count = () => {
					if (crouch.IsJustPressed()) justPressed++;
					if (crouch.IsJustReleased()) justReleased++;
				};
				real.Press(K.K);
				for (let index = 0; index < 10; index++) {
					frames(1);
					count();
				}
				expectTrue(crouch.IsPressed(), "K on the stand-in");
				// counted every frame until linked: the swap's IsJustReleased lasts one frame
				expectTrue(lateServer("provide", folderName) === true);
				for (let index = 0; index < 600 && !input.HunterLate.IsLinkedToServer(); index++) {
					frames(1);
					count();
				}
				expectTrue(input.HunterLate.IsLinkedToServer(), "linked");
				for (let index = 0; index < 10; index++) {
					frames(1);
					count();
				}
				const atSwap = `${crouch.IsPressed()}/${serverState("Crouch")} JP${justPressed} JR${justReleased}`;
				real.Release(K.K);
				for (let index = 0; index < 20; index++) {
					frames(1);
					count();
				}
				expectEqual(
					`${crouch.IsPressed()}/${serverState("Crouch")}`,
					"false/false",
					`after K came up (after the swap: ${atSwap})`,
				);
				// a press may be released once and pressed again at the swap (design spec §8): the
				// counts must pair up
				expectEqual(
					justPressed,
					justReleased,
					`IsJustPressed ${justPressed}, IsJustReleased ${justReleased} (after the swap: ${atSwap})`,
				);
			});
		});
	}
}
