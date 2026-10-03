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
import { ReplicatedStorage } from "@rbxts/services";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { countSignal, createTestInput, frame, frames, newFolder, recordSignal } from "./helpers";
import { realInput } from "./virtual";

const K = Enum.KeyCode;

/** Reads `read` for a few frames: true when it never became true */
function staysFalse(read: () => boolean, count = 6) {
	for (let index = 0; index < count; index++) {
		frame();
		if (read()) return false;
	}
	return true;
}

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(SA_REMOTE, 10),
		SA_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

/** Two schemas on one Move: the second gives it a composite (T/G/F/H) the first lacks */
const MOVE_SHARED_SMALL = InputActions.Schema({
	HeldShared: {
		Priority: 2000,
		Actions: { Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }) },
	},
});
const MOVE_SHARED_BIG = InputActions.Schema({
	HeldShared: {
		Priority: 2000,
		Actions: {
			Move: InputActions.Direction2D({
				Virtual: InputActions.Scriptable,
				Keys: { Up: K.T, Down: K.G, Left: K.F, Right: K.H },
			}),
		},
	},
});

const serverJump = () => server("state", "sa", "SaGameplay", "Jump");
const serverMove = () => server("state", "sa", "SaGameplay", "Move");

/** SA_SCHEMA on the server's copy (the template binds Jump's KeyboardAndMouse to F) */
function createSaInput() {
	expectTrue(server("provide", "sa") === true);
	const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
	defer(() => input.Destroy());
	return input;
}

/**
 * Leaves the server's Jump and Move at rest after the test, whatever a failure left there: a fresh
 * handle fires a held value then the value at rest. Call it first, so it runs after the rest of the
 * test's cleanup.
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
 * Changing a binding while its action is held (hunt round 1, H1-F1 and H1-F2). A change to any
 * binding's keys makes IAS reset every binding of the action: a local context releases it at once,
 * and the package releases the server's copy, where IAS would leave it held on both sides. A change
 * that keeps the keys (a threshold, the same key, the save already in effect) writes nothing to the
 * keys and leaves the action held. And removing a binding while it holds its action, as `Destroy`
 * does, which leaves the action stuck on in IAS (hunt round 4, H4-F1).
 */
@Provider({ activeIn: ["testing"] })
export class RebindHeldTests implements OnStart {
	onStart() {
		defineTests("rebind-held", () => {
			// ---- local contexts, every project

			test("Set on another binding of a held action releases it; the held key counts again once pressed again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const released = countSignal(jump.Released);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "Space");
				jump.Bindings.Gamepad.Set(K.ButtonB);
				eventually(() => !jump.IsPressed(), "released by the rebind");
				real.Release(K.Space);
				expectTrue(
					staysFalse(() => jump.IsPressed()),
					"not pressed again by the key-up",
				);
				expectEqual(released.count, 1, "Released");
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "Space counts again");
				real.Release(K.Space);
				eventually(() => !jump.IsPressed(), "released");
			});

			test("a value fired from code is released by a rebind, and firing it again presses the action", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				jump.Fire(true);
				expectTrue(jump.IsPressed());
				jump.Bindings.KeyboardAndMouse.Set(K.F);
				eventually(() => !jump.IsPressed(), "released by the rebind");
				jump.Fire(true);
				eventually(() => jump.IsPressed(), "Fire(true) again");
				jump.Fire(false);
				eventually(() => !jump.IsPressed(), "Fire(false)");
			});

			test("a Set that keeps a held binding's keys (a threshold only) leaves the action held", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const released = countSignal(jump.Released);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "Space");
				jump.Bindings.KeyboardAndMouse.Set({ KeyCode: K.Space, PressedThreshold: 0.7 });
				frames(4);
				expectTrue(jump.IsPressed(), "still pressed");
				expectEqual(released.count, 0, "Released");
				real.Release(K.Space);
				eventually(() => !jump.IsPressed(), "released with the key");
			});

			test("Reset, ResetBindings and an import that changes another action leave a held action alone", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const released = countSignal(jump.Released);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "Space");
				const changes = recordSignal(input.BindingsChanged);
				jump.Bindings.KeyboardAndMouse.Reset();
				input.ResetBindings();
				input.Gameplay.ResetBindings();
				const result = input.ImportBindings(
					'{"Version":1,"Bindings":{"Gameplay/Crouch/KeyboardAndMouse":{"KeyCode":"V"}}}',
				);
				expectEqual(result.Applied.size(), 1);
				frames(4);
				expectTrue(jump.IsPressed(), "still pressed");
				expectEqual(released.count, 0, "Released");
				expectEqual(input.Gameplay.Actions.Crouch.Bindings.KeyboardAndMouse.Instance.KeyCode, K.V);
				// Reset reports its binding (as Set does); the bulk resets and the import report what changed
				expectEqual(
					changes.join(","),
					"Gameplay/Jump/KeyboardAndMouse,Gameplay/Crouch/KeyboardAndMouse",
				);
				real.Release(K.Space);
				eventually(() => !jump.IsPressed(), "released with the key");
			});

			// ---- the server's copy in a place without Server Authority: a local context there

			// IAS releases it as any local context, and the package fires no pair for a server that
			// never receives its state: after the change, the pair would press and release it once
			// more (hunt round 3, H3-F2; hunter-r3-real holds a real key instead)
			test("a provided copy in a place without Server Authority: a rebind releases a fired value once", () => {
				if (getProject() === "authority") return skip("for a place without Server Authority");
				const input = createSaInput();
				eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy");
				expectEqual(InputActions.IsServerAuthority(), false);
				const jump = input.SaGameplay.Actions.Jump;
				const events = new Array<string>();
				const pressed = jump.Pressed.Connect(() => events.push("P"));
				const released = jump.Released.Connect(() => events.push("R"));
				defer(() => {
					pressed.Disconnect();
					released.Disconnect();
				});
				jump.Fire(true);
				eventually(() => events.size() === 1, "Fire(true) presses Jump");
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				frames(10);
				expectEqual(events.join(""), "PR", "Pressed/Released, the rebind 10 frames ago");
				expectFalse(jump.IsPressed(), "released");
				jump.Fire(true);
				eventually(() => jump.IsPressed(), "Fire(true) again");
				jump.Fire(false);
				frames(5);
				expectEqual(events.join(""), "PRPR", "one more press and release");
			});

			// ---- Destroy removes a binding while a key holds its action (hunt round 4, H4-F1)

			// A binding destroyed while it holds its action leaves the action stuck on (probed). Destroy
			// resets an action it leaves held, of any type: before, only a pressed Bool action was reset
			test("Destroy while a real key holds an adopted Direction2D action through a binding the package made: at rest", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const context = new Instance("InputContext");
				context.Name = "Gameplay";
				const action = new Instance("InputAction");
				action.Name = "Move";
				action.Type = Enum.InputActionType.Direction2D;
				action.Parent = context;
				context.Parent = folder;
				const input = createTestInput(folder);
				const move = input.Gameplay.Actions.Move;
				expectEqual(move.Instance, action, "the designer's Move, adopted");
				const binding = move.Bindings.KeyboardAndMouse.Instance;
				real.Press(K.W);
				eventually(() => action.GetState() === new Vector2(0, 1), "W moves Move up");
				input.Destroy();
				expectEqual(binding.Parent, undefined, "the binding the package made went");
				eventually(
					() => action.GetState() === Vector2.zero,
					`Move at rest after Destroy (reads ${action.GetState()})`,
				);
				real.Release(K.W);
				expectTrue(
					staysFalse(() => action.GetState() !== Vector2.zero),
					`Move after W came up: ${action.GetState()}`,
				);
			});

			// The same on an action another root handle still uses (hunt HL3-2, the Bool form is in
			// hunter-label-3): the composite only the destroyed root handle had goes, and a pair on
			// MoveScript lets go of what it held
			test("Destroy while a real key holds a shared Direction2D action through a composite only that root handle has: at rest", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = InputActions.Create(MOVE_SHARED_SMALL, {
					Folder: folder,
					ResetOnFocusLoss: false,
				});
				defer(() => first.Destroy());
				const second = InputActions.Create(MOVE_SHARED_BIG, {
					Folder: folder,
					ResetOnFocusLoss: false,
				});
				defer(() => second.Destroy());
				const move = first.HeldShared.Actions.Move;
				expectEqual(second.HeldShared.Actions.Move.Instance, move.Instance, "one shared Move");
				const keys = second.HeldShared.Actions.Move.Bindings.Keys.Instance;
				real.Press(K.T);
				eventually(
					() => move.GetState() === new Vector2(0, 1),
					`T moves Move up${real.FocusNote()}`,
				);
				second.Destroy();
				expectEqual(keys.Parent, undefined, "the composite only the second had went");
				eventually(
					() => move.GetState() === Vector2.zero,
					`Move at rest after the second's Destroy (reads ${move.GetState()})${real.FocusNote()}`,
				);
				real.Release(K.T);
				expectTrue(
					staysFalse(() => move.GetState() !== Vector2.zero),
					`Move after T came up: ${move.GetState()}`,
				);
				move.Fire(new Vector2(1, 0));
				eventually(() => move.GetState() === new Vector2(1, 0), "the first's Fire still drives it");
				move.Fire(Vector2.zero);
			});

			// The same on the server's copy, which is local without Server Authority: there the package
			// fires no release pair, and the reset alone lets go of it
			test("a provided copy: Destroy while a real key holds Move leaves it at rest on the client and the server", () => {
				const authority = getProject() === "authority";
				if (authority) settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy");
				const move = input.SaGameplay.Actions.Move;
				const action = move.Instance;
				const binding = move.Bindings.KeyboardAndMouse.Instance;
				real.Press(K.W);
				eventually(() => action.GetState() === new Vector2(0, 1), "W moves Move up on the copy");
				if (authority)
					eventually(() => serverMove() === new Vector2(0, 1), "the server sees W", 10);
				input.Destroy();
				expectEqual(binding.Parent, undefined, "the binding the package made went");
				eventually(
					() => action.GetState() === Vector2.zero,
					`Move at rest after Destroy (reads ${action.GetState()}, IsServerAuthority ${InputActions.IsServerAuthority()})`,
				);
				real.Release(K.W);
				expectTrue(
					staysFalse(() => action.GetState() !== Vector2.zero),
					`Move after W came up: ${action.GetState()}`,
				);
				if (authority)
					eventually(() => serverMove() === Vector2.zero, "Move at rest on the server", 10);
			});

			// ---- the server's copy (Server Authority), where IAS would keep the action held

			test("server's copy: Set on another binding of a held action releases it on the client and the server", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				const released = countSignal(jump.Released);
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				jump.Bindings.Gamepad.Set(K.ButtonB);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after the rebind: ${jump.IsPressed()}/${serverJump()}`,
				);
				real.Release(K.F);
				frames(10);
				expectEqual(`${jump.IsPressed()}/${serverJump()}`, "false/false", "after F came up");
				expectEqual(released.count, 1, "Released");
				real.Press(K.F);
				eventually(() => serverJump() === true, "F counts again", 5);
				real.Release(K.F);
				eventually(() => serverJump() === false, "released on the server", 5);
			});

			test("server's copy: a composite change that keeps the held key releases Move on both sides; the key counts again", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const move = createSaInput().SaGameplay.Actions.Move;
				real.Press(K.W);
				eventually(() => serverMove() === new Vector2(0, 1), "the server sees W", 5);
				move.Bindings.KeyboardAndMouse.Set({ Down: K.X });
				expectTrue(
					within(() => move.GetState() === Vector2.zero && serverMove() === Vector2.zero, true),
					`client/server after the rebind: ${move.GetState()}/${tostring(serverMove())}`,
				);
				real.Release(K.W);
				frames(10);
				expectEqual(move.GetState(), Vector2.zero, "the client after W came up");
				expectEqual(serverMove(), Vector2.zero, "the server after W came up");
				real.Press(K.W);
				eventually(() => serverMove() === new Vector2(0, 1), "W counts again", 5);
				real.Release(K.W);
				eventually(() => serverMove() === Vector2.zero, "at rest on the server", 5);
			});

			test("server's copy: a modifier added to a held binding releases it on both sides", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createSaInput().SaGameplay.Actions.Jump;
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				jump.Bindings.KeyboardAndMouse.Set({ KeyCode: K.F, PrimaryModifier: K.LeftControl });
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after the rebind: ${jump.IsPressed()}/${serverJump()}`,
				);
				real.Release(K.F);
				frames(10);
				expectEqual(`${jump.IsPressed()}/${serverJump()}`, "false/false", "after F came up");
			});

			test("server's copy: an import that rebinds two bindings of a held action releases it once, on both sides", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				const result = input.ImportBindings(
					'{"Version":1,"Bindings":{"SaGameplay/Jump/KeyboardAndMouse":{"KeyCode":"G"},' +
						'"SaGameplay/Jump/Gamepad":{"KeyCode":"ButtonB"}}}',
				);
				expectEqual(result.Applied.size(), 2);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after the import: ${jump.IsPressed()}/${serverJump()}`,
				);
				real.Release(K.F);
				frames(10);
				expectEqual(`${pressed.count}/${released.count}`, "1/1", "Pressed/Released");
				real.Press(K.G);
				eventually(() => serverJump() === true, "the new key reaches the server", 5);
				real.Release(K.G);
				eventually(() => serverJump() === false, "released on the server", 5);
			});

			test("server's copy: a value fired from code is released by a rebind on both sides, and Fire(true) reaches the server again", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const jump = createSaInput().SaGameplay.Actions.Jump;
				jump.Fire(true);
				eventually(() => serverJump() === true, "the server sees the Fire", 5);
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after the rebind: ${jump.IsPressed()}/${serverJump()}`,
				);
				jump.Fire(true);
				eventually(() => serverJump() === true, "Fire(true) again", 5);
				jump.Fire(false);
				eventually(() => serverJump() === false, "Fire(false)", 5);
			});

			// The rebind forgets the value the package fired: a request then releases what a key holds
			// with the pair, instead of firing the value at rest on a binding IAS already reset
			test("server's copy: after a rebind released a fired value, a request still releases a held key on the server", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				jump.Fire(true);
				eventually(() => serverJump() === true, "the server sees the Fire", 5);
				jump.Bindings.Gamepad.Set(K.ButtonB);
				expectTrue(
					within(() => `${jump.IsPressed()}/${serverJump()}`, "false/false"),
					`client/server after the rebind: ${jump.IsPressed()}/${serverJump()}`,
				);
				real.Press(K.F);
				eventually(() => serverJump() === true, "the server sees F", 5);
				const release = input.SaGameplay.Request(false);
				defer(release);
				eventually(() => serverJump() === false, "the request releases F on the server", 5);
				expectFalse(jump.IsPressed());
				release();
				real.Release(K.F);
			});
		});
	}
}
