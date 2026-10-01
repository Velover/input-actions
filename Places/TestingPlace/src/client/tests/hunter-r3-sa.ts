import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectTrue,
	getProject,
	test,
} from "@flamework-experimental/testing";
import { InputActions, RawInputHandler } from "@rbxts/input-actions";
import { ReplicatedStorage } from "@rbxts/services";
import { HUNTER_LATE_SCHEMA, HUNTER_R2_REMOTE } from "shared/fixtures/hunter-r2-fixture";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { skip } from "shared/fixtures/skip";
import { frames, newFolder } from "./helpers";
import { clickProblem, RealInput, realInput, screenCenter, testButton, testGui } from "./virtual";

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

/**
 * SA_SCHEMA on the server's copy (the template binds Jump's KeyboardAndMouse to F). Without the
 * focus-loss reset: these tests hold real keys on the server's copy, and a `WindowFocusReleased`
 * from the user working in another window would release them mid-test (hunt round 4, H4-F4); the
 * reset is tested in sa-release and contexts
 */
function createSaInput() {
	expectTrue(server("provide", "sa") === true);
	const input = InputActions.Create(SA_SCHEMA, {
		Folder: server("templates") as Folder,
		ResetOnFocusLoss: false,
	});
	defer(() => input.Destroy());
	eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy", 10);
	return input;
}

/**
 * Holds `key` until the client and then the server see Jump pressed. A failure says which side
 * never did, and whether the window lost focus meanwhile
 */
function pressUntilServerSees(real: RealInput, key: Enum.KeyCode, jump: InputActions.BoolAction) {
	real.Press(key);
	eventually(() => jump.IsPressed(), `${key.Name} presses Jump on the client${real.FocusNote()}`, 5);
	eventually(
		() => serverJump() === true,
		`the server sees ${key.Name} (client ${jump.IsPressed()})${real.FocusNote()}`,
		10,
	);
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

/** HUNTER_LATE_SCHEMA on stand-ins, under a player folder name the server provides on `provide()` */
function createLateInput() {
	lateCount++;
	const folderName = `InputsHunterR3Late${lateCount}`;
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
	return { input, provide, serverState };
}

/**
 * Hunt round 3: Server Authority with real keys and clicks (authority only). A key that comes up
 * while its context or action is off, on the server's copy, must not bring the action back once it
 * is on again; and a button held at the swap.
 */
@Provider({ activeIn: ["testing"] })
export class HunterR3SaTests implements OnStart {
	onStart() {
		defineTests("hunter-r3-sa", () => {
			test("server's copy: a key that comes up while a request holds the context off leaves both sides at rest", () => {
				if (getProject() !== "authority") return;
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				const read = () => `${jump.IsPressed()}/${serverJump()}`;
				pressUntilServerSees(real, K.F, jump);
				const release = input.SaGameplay.Request(false);
				defer(release);
				eventually(() => serverJump() === false, "released on the server", 5);
				real.Release(K.F);
				frames(5);
				release();
				frames(15);
				expectEqual(read(), "false/false", "back on after F came up while off");
				// F works again
				pressUntilServerSees(real, K.F, jump);
				real.Release(K.F);
				expectTrue(within(read, "false/false"), `after a press of F: ${read()}`);
			});

			test("server's copy: a key that comes up while the action is disabled leaves both sides at rest", () => {
				if (getProject() !== "authority") return;
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				defer(() => jump.SetEnabled(true));
				const read = () => `${jump.IsPressed()}/${serverJump()}`;
				pressUntilServerSees(real, K.F, jump);
				jump.SetEnabled(false);
				eventually(() => serverJump() === false, "released on the server", 5);
				real.Release(K.F);
				frames(5);
				jump.SetEnabled(true);
				frames(15);
				expectEqual(read(), "false/false", "enabled again after F came up while disabled");
				// F works again
				pressUntilServerSees(real, K.F, jump);
				real.Release(K.F);
				expectTrue(within(read, "false/false"), `after a press of F: ${read()}`);
			});

			test("RawInputHandler: W comes up while the controls are off; turned on again, the character stays still on both sides", () => {
				if (getProject() !== "authority") return;
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				RawInputHandler.Initialize();
				defer(() => RawInputHandler.ControlSetEnabled(true));
				real.Press(K.W);
				eventually(() => serverCharacterMove() !== Vector2.zero, "the server sees W", 5);
				RawInputHandler.ControlSetEnabled(false);
				eventually(() => serverCharacterMove() === Vector2.zero, "stopped on the server", 5);
				real.Release(K.W);
				frames(5);
				RawInputHandler.ControlSetEnabled(true);
				frames(15);
				const moved = `${RawInputHandler.GetMoveVector()}/${tostring(serverCharacterMove())}`;
				expectEqual(
					RawInputHandler.GetMoveVector().Magnitude,
					0,
					`the client's move vector after W came up while off (client/server: ${moved})`,
				);
				expectEqual(serverCharacterMove(), Vector2.zero, `the server's MoveAction (${moved})`);
				real.Press(K.W);
				eventually(() => serverCharacterMove() !== Vector2.zero, "W works again", 5);
				real.Release(K.W);
				eventually(() => serverCharacterMove() === Vector2.zero, "at rest on the server", 5);
			});

			test("swap: the server's copy arrives while an attached button is held on the stand-in; afterwards nothing sticks", () => {
				if (getProject() !== "authority") return;
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input, provide, serverState } = createLateInput();
				const jump = input.HunterLate.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				jump.AttachButton(button);
				const read = () => `${jump.IsPressed()}/${serverState("Jump")}`;
				real.MouseDown(screenCenter(button));
				eventually(() => jump.IsPressed(), "pressed on the stand-in");
				provide();
				frames(10);
				const atSwap = read();
				real.MouseUp();
				expectTrue(
					within(read, "false/false"),
					`client/server after the mouse-up: ${read()} (after the swap: ${atSwap})`,
				);
				frames(10);
				expectEqual(read(), "false/false", "still at rest");
				real.MouseDown(screenCenter(button));
				eventually(() => serverState("Jump") === true, "the button reaches the server", 5);
				real.MouseUp();
				expectTrue(within(read, "false/false"), `after a click: ${read()}`);
			});
		});
	}
}
