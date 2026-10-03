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
import { expectedSignalBehavior } from "shared/fixtures/projects";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { countSignal, frame, frames, newFolder, recordSignal } from "./helpers";
import { realInput, testButton, testGui } from "./virtual";

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
const serverPressed = () => server("pressed", "sa") as number;

/**
 * Leaves the server's Jump at rest after the test, whatever a failure left there: a fresh root
 * handle fires a held value then the value at rest. Call it first, so it runs after the rest of the
 * test's cleanup.
 */
function settleServerAfter() {
	defer(() => {
		const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
		const jump = input.SaGameplay.Actions.Jump;
		jump.Fire(true);
		pcall(() => eventually(() => serverJump() === true, "the server's Jump held", 3));
		jump.Fire(false);
		pcall(() => eventually(() => serverJump() === false, "the server's Jump at rest", 5));
		input.Destroy();
		frames(3);
	});
}

/** `Create`, destroyed after the test */
function create<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
	options: InputActions.CreateOptions,
): InputActions.Handle<S> {
	const input = InputActions.Create(schema, options);
	defer(() => input.Destroy());
	return input;
}

/** Options for a root handle waiting on a hand-made copy under that player folder */
function swapOptions(folderName: string): InputActions.CreateOptions {
	return {
		Folder: newFolder(),
		PlayerFolderName: folderName,
		Timeout: 1000,
		ResetOnFocusLoss: false,
	};
}

let copyCount = 0;

/**
 * A copy of a context built by hand under a player folder no server provides, as the server's would
 * be (enabled, as the server makes it), not parented to the player yet
 */
function handMadeCopy(contextName: string, actions: Array<[string, Enum.InputActionType]>) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `HunterLabel4Copy${copyCount}`;
	const context = new Instance("InputContext");
	context.Name = contextName;
	const made = new Map<string, InputAction>();
	for (const [name, actionType] of actions) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Type = actionType;
		action.Parent = context;
		made.set(name, action);
	}
	context.Parent = folder;
	defer(() => folder.Destroy());
	return { folder, context, actions: made };
}

/** Waits up to `seconds` for `read` to give `value` (a copy under the player moves on simulation steps) */
function settle(read: () => unknown, value: unknown, seconds = 1) {
	const deadline = os.clock() + seconds;
	while (os.clock() < deadline && read() !== value) frame();
	frames(2);
}

/**
 * IAS's own Pressed/Released of an action and the bindings added to or removed from it, each with
 * the state then, until the test ends: under Immediate signals in the order they happened
 */
function eventLog(action: InputAction): string[] {
	const log = new Array<string>();
	const connections = [
		action.Pressed.Connect(() => log.push("P")),
		action.Released.Connect(() => log.push("R")),
		action.ChildAdded.Connect((child) => log.push(`+${child.Name}:${action.GetState()}`)),
		action.ChildRemoved.Connect((child) => log.push(`-${child.Name}:${action.GetState()}`)),
	];
	defer(() => connections.forEach((connection) => connection.Disconnect()));
	return log;
}

/** A handle's Pressed (P) and Released (R), in order, until the test ends */
function recordEdges(handle: { Pressed: RBXScriptSignal; Released: RBXScriptSignal }): string[] {
	const edges = new Array<string>();
	const connections = [
		handle.Pressed.Connect(() => edges.push("P")),
		handle.Released.Connect(() => edges.push("R")),
	];
	defer(() => connections.forEach((connection) => connection.Disconnect()));
	return edges;
}

// Since 0.7.0 every action has the three device bindings, made by the first root handle on it (one
// it leaves out unbound), and one binding per device: a later root handle adopts them all. The only
// bindings that go with one root handle alone are its own Scriptable slots, its buttons and the
// template bindings it cloned, and of those only a button can hold the action for a player (a
// Scriptable one holds what the package fired, which `ReleaseOwn` lets go of). So where the later
// root handle had a second key binding (`Alternate`, `Keys`) a key held, a key now holds the shared
// action through a device binding both root handles use, and the binding that goes with the later
// root handle is a button it attached (Bool), or a Scriptable slot of its own (`Own`), which makes
// `Destroy` release nothing.

/**
 * Two schemas on one Move: the second names KeyboardAndMouse (T/G/V/N), which fills the first's
 * unbound binding, and has a Scriptable slot of its own
 */
const HL4_MOVE_SMALL = InputActions.Schema({
	Hl4Move: {
		Priority: 2000,
		Actions: { Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }) },
	},
});
const HL4_MOVE_BIG = InputActions.Schema({
	Hl4Move: {
		Priority: 2000,
		Actions: {
			Move: InputActions.Direction2D({
				Virtual: InputActions.Scriptable,
				Own: InputActions.Scriptable,
				KeyboardAndMouse: { Up: K.T, Down: K.G, Left: K.V, Right: K.N },
			}),
		},
	},
});

/** The same with a Direction1D action (T/G) */
const HL4_THROTTLE_SMALL = InputActions.Schema({
	Hl4Throttle: {
		Priority: 2000,
		Actions: { Throttle: InputActions.Direction1D({ Virtual: InputActions.Scriptable }) },
	},
});
const HL4_THROTTLE_BIG = InputActions.Schema({
	Hl4Throttle: {
		Priority: 2000,
		Actions: {
			Throttle: InputActions.Direction1D({
				Virtual: InputActions.Scriptable,
				Own: InputActions.Scriptable,
				KeyboardAndMouse: { Up: K.T, Down: K.G },
			}),
		},
	},
});

/** Two schemas sharing one Bool action: the second gives it a binding (a Scriptable slot) the first lacks */
const HL4_KEYS_SMALL = InputActions.Schema({
	Hl4Keys: { Priority: 2000, Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) } },
});
const HL4_KEYS_BIG = InputActions.Schema({
	Hl4Keys: {
		Priority: 2000,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Own: InputActions.Scriptable }),
		},
	},
});
/** A second schema on HL4_KEYS_SMALL's Jump that names Gamepad: it fills the first's unbound binding */
const HL4_KEYS_FILL = InputActions.Schema({
	Hl4Keys: {
		Priority: 2000,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Gamepad: K.ButtonL1 }) },
	},
});

/** The same, the first tracking Jump's previous value */
const HL4_TRACKED_SMALL = InputActions.Schema({
	Hl4Tracked: {
		Priority: 2000,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }, { TrackPrevious: true }) },
	},
});
const HL4_TRACKED_BIG = InputActions.Schema({
	Hl4Tracked: {
		Priority: 2000,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Own: InputActions.Scriptable }),
		},
	},
});

/** A second schema on the server's copy (SA_SCHEMA's SaGameplay): Jump gets a binding of its own */
const HL4_SA_ALT = InputActions.Schema({
	SaGameplay: {
		ServerAuthority: true,
		Priority: 1500,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.Space, Own: InputActions.Scriptable }),
		},
	},
});
/** The same naming Touch, which SA_SCHEMA leaves out: it fills Jump's unbound Touch binding */
const HL4_SA_FILL = InputActions.Schema({
	SaGameplay: {
		ServerAuthority: true,
		Priority: 1500,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.Space, Touch: K.TouchPosition }),
		},
	},
});
/** Both at once: a binding of its own and the fill, in one `Create` */
const HL4_SA_BOTH = InputActions.Schema({
	SaGameplay: {
		ServerAuthority: true,
		Priority: 1500,
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: K.Space,
				Touch: K.TouchPosition,
				Own: InputActions.Scriptable,
			}),
		},
	},
});

/** Server Authority contexts for a hand-made copy */
const HL4_THROTTLE_SWAP = InputActions.Schema({
	Hl4Swap: {
		ServerAuthority: true,
		Actions: { Throttle: InputActions.Direction1D({ Virtual: InputActions.Scriptable }) },
	},
});
const HL4_PAIR_SWAP = InputActions.Schema({
	Hl4Pair: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.H }),
		},
	},
});

/** A copy's Jump (the first root handle) and a stand-in waiting for Duck with a binding Jump lacks there */
const HL4_JOIN_SMALL = InputActions.Schema({
	Hl4Join: {
		ServerAuthority: true,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) },
	},
});
const HL4_JOIN_BIG = InputActions.Schema({
	Hl4Join: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Own: InputActions.Scriptable }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.H }),
		},
	},
});
/** The same with a stand-in that names Gamepad: at the swap it fills the copy's unbound binding */
const HL4_JOIN_FILL = InputActions.Schema({
	Hl4Join: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Gamepad: K.ButtonL1 }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.H }),
		},
	},
});

const HL4_STICK = InputActions.Schema({
	Hl4Stick: {
		Priority: 2000,
		Actions: {
			Stick: InputActions.Direction2D({
				Virtual: InputActions.Scriptable,
				KeyboardAndMouse: { Up: K.T, Down: K.G, Left: K.V, Right: K.N },
			}),
		},
	},
});

/**
 * A button attached through `action` (a root handle's): a binding that root handle alone has, which
 * a player could hold the action through, and which goes with it. Attached while the action is at
 * rest: adding a binding to a held action releases it.
 */
function attachOwnButton(action: InputActions.BoolAction): InputBinding {
	const before = new Set(action.Instance.GetChildren());
	action.AttachButton(testButton(testGui("HunterLabel4Own")));
	const binding = action.Instance.GetChildren().find((child) => !before.has(child));
	return expectDefined(binding, "the button's binding") as InputBinding;
}

/** How many of the package's release bindings (`ReleaseOnServer`'s pairs) an `eventLog` saw added */
function releasePairs(log: string[], name: string): number {
	const added = `+${name}:`;
	return log.filter((entry) => entry.sub(1, added.size()) === added).size();
}

/** Hunt round 4 (the last): round 3's fixes (e932fd9), adversarial */
@Provider({ activeIn: ["testing"] })
export class HunterLabel4Tests implements OnStart {
	onStart() {
		defineTests("hunter-label-4", () => {
			// ---- a shared action held while bindings only the destroyed root handle has go (HL3-2's fix)

			// HL4-1 (hunter, fixed: a value the other root handles fired holds the action only while the action shows the latest one they fired, so ReleaseOwn releases it otherwise, by an Enabled toggle once the bindings are gone off the server's copy): a root handle destroyed while a key holds a shared Direction2D action through a binding only it has left the action at that key's value once the key was up, when the other root handle had fired a value before the key (ReleaseOwn counted that older value as "held by others" and fired no release, though the action showed the key's later value)
			// REWRITTEN for 0.7.0, as HL3-2: the scenario can't happen any more. No key binding goes with
			// one root handle alone (both use the KeyboardAndMouse binding the second's schema filled),
			// and a Direction2D action takes no button. What stays to check: the second's Destroy (its
			// own Scriptable slot going) leaves the binding T holds Move through, releases nothing, and
			// Move isn't left at T's value once T is up
			test("a shared Direction2D action a key holds, over a value the other root handle fired before: Destroy of the other root handle keeps the key's binding, and Move isn't stuck once the key is up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL4_MOVE_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL4_MOVE_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const move = first.Hl4Move.Actions.Move;
				expectEqual(second.Hl4Move.Actions.Move.Instance, move.Instance, "one shared Move");
				const own = second.Hl4Move.Actions.Move.Bindings.Own.Instance;
				const keys = move.Bindings.KeyboardAndMouse.Instance;
				expectEqual(keys.Up, K.T, "the second schema filled the shared KeyboardAndMouse binding");
				defer(() => move.Bindings.Virtual.Fire(Vector2.zero));
				move.Bindings.Virtual.Fire(new Vector2(1, 0));
				eventually(() => move.GetState() === new Vector2(1, 0), "the first root handle's value");
				real.Press(K.T);
				eventually(
					() => move.GetState() === new Vector2(0, 1),
					`T moves Move up (the last write wins)${real.FocusNote()}`,
				);
				second.Destroy();
				frames(2);
				const afterDestroy = move.GetState();
				const bindings = `its own slot gone: ${own.Parent === undefined}, the shared binding kept: ${keys.Parent === move.Instance}, keys ${keys.Up.Name}`;
				real.Release(K.T);
				frames(6);
				const afterRelease = move.GetState();
				expectEqual(
					`${bindings}; ${afterDestroy}`,
					`its own slot gone: true, the shared binding kept: true, keys T; ${new Vector2(0, 1)}`,
					`signals ${expectedSignalBehavior()}: the bindings after the second root handle's Destroy, and Move then (T still down)${real.FocusNote()}`,
				);
				expectTrue(
					afterRelease !== new Vector2(0, 1),
					`signals ${expectedSignalBehavior()}: Move reads ${afterRelease} once T came up: T's value${real.FocusNote()}`,
				);
			});

			// HL4-1 (hunter, fixed as above; the same, Direction1D). REWRITTEN for 0.7.0 as above
			test("a shared Direction1D action a key holds, over a value the other root handle fired before: Destroy of the other root handle keeps the key's binding, and Throttle isn't stuck once the key is up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL4_THROTTLE_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL4_THROTTLE_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const throttle = first.Hl4Throttle.Actions.Throttle;
				expectEqual(
					second.Hl4Throttle.Actions.Throttle.Instance,
					throttle.Instance,
					"one shared Throttle",
				);
				defer(() => throttle.Bindings.Virtual.Fire(0));
				throttle.Bindings.Virtual.Fire(0.5);
				eventually(() => throttle.GetState() === 0.5, "the first root handle's value");
				real.Press(K.T);
				eventually(() => throttle.GetState() === 1, `T pushes Throttle up${real.FocusNote()}`);
				second.Destroy();
				frames(2);
				const afterDestroy = throttle.GetState();
				real.Release(K.T);
				frames(6);
				const afterRelease = throttle.GetState();
				expectEqual(afterDestroy, 1, `T still holds Throttle after the Destroy${real.FocusNote()}`);
				expectTrue(
					afterRelease !== 1,
					`signals ${expectedSignalBehavior()}: Throttle reads ${afterRelease} once T came up: T's value${real.FocusNote()}`,
				);
			});

			// Control for HL4-1 (passes): with no older fired value, Move at rest once T is up
			test("control: the same Destroy with no value the other root handle fired: Move at rest once T is up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL4_MOVE_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL4_MOVE_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const move = first.Hl4Move.Actions.Move;
				real.Press(K.T);
				eventually(() => move.GetState() === new Vector2(0, 1), `T${real.FocusNote()}`);
				second.Destroy();
				real.Release(K.T);
				frames(6);
				expectEqual(move.GetState(), Vector2.zero, `Move after T came up${real.FocusNote()}`);
			});

			// HL4-3 (hunter, fixed: off the server's copy ReleaseOwn makes no binding and fires no pair; Destroy toggles the action's Enabled once the bindings are gone, as for an action no other root handle uses; the pair stays on the server's copy, where it is clean): Destroy of a root handle on a shared action held through a binding only it has (HL3-2's fix) fired its release pair on an <Action>Script it made in that moment when no handle ever fired the action; on a local context (and the copy in a place without Server Authority) adding that binding released the held action (HL4-5) and the pair's Fire(true) pressed it again, so the other root handle heard Released, Pressed, Released: a press that never happened (measured: "+JumpScript:true R P R -JumpScript -JumpAlternate" under Immediate)
			// REWRITTEN for 0.7.0: J holds Jump through the KeyboardAndMouse binding both root handles
			// use, and the binding that goes with the second is a button it attached (the same release
			// decision: a binding a player could hold the action through goes while it is held)
			test("a key holding a shared Bool action, no handle having fired it, when the root handle whose button goes is destroyed: the other root handle hears one Released and no Pressed", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL4_KEYS_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL4_KEYS_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl4Keys.Actions.Jump;
				attachOwnButton(second.Hl4Keys.Actions.Jump);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J${real.FocusNote()}`);
				frames(3);
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				second.Destroy();
				log.push(`end:${jump.Instance.GetState()}`);
				frames(4);
				real.Release(K.J);
				frames(4);
				expectEqual(
					`${edges.join("")}, pressed ${jump.IsPressed()}`,
					"R, pressed false",
					`signals ${expectedSignalBehavior()}: the first root handle's Pressed/Released after the second's Destroy and J's release; IAS's own events and the bindings added and removed meanwhile, with the state: ${log.join(" ")}. Advanced.md: "the action is released if it is not at rest" (one release; "that also lets go of a key held through a binding the other handles keep, until the key is pressed again"), and Pressed and Released pass on presses that happened${real.FocusNote()}`,
				);
			});

			// HL4-3 (hunter, fixed as above; the same, without real input: a Scriptable binding the package doesn't drive holds Jump, and the second root handle's own binding isn't held). Since 0.7.0 that binding is a button it attached (its Alternate key binding before)
			test("a binding the package doesn't drive holding a shared Bool action, the destroyed root handle having a binding of its own: the other root handle hears one Released and no Pressed", () => {
				const folder = newFolder();
				const first = create(HL4_KEYS_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL4_KEYS_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl4Keys.Actions.Jump;
				attachOwnButton(second.Hl4Keys.Actions.Jump);
				const hold = new Instance("InputBinding");
				hold.Name = "HoldStandIn";
				hold.Type = Enum.InputBindingType.Scriptable;
				hold.Parent = jump.Instance;
				defer(() => hold.Destroy());
				hold.Fire(true);
				eventually(() => jump.IsPressed(), "held by the binding the package doesn't drive");
				frames(3);
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				second.Destroy();
				log.push(`end:${jump.Instance.GetState()}`);
				frames(4);
				expectEqual(
					`${edges.join("")}, pressed ${jump.IsPressed()}`,
					"R, pressed false",
					`signals ${expectedSignalBehavior()}: ${log.join(" ")}. The release is documented ("IAS doesn't tell which binding holds an action, so that also lets go of a key held through a binding the other handles keep", Advanced.md); the Pressed between two Released is not`,
				);
			});

			// Control for HL4-3: the same with <Action>Script made in an earlier frame (the first root handle fired Jump once): one Released
			test("control: the same with <Action>Script there already: one Released, no Pressed", () => {
				const folder = newFolder();
				const first = create(HL4_KEYS_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL4_KEYS_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl4Keys.Actions.Jump;
				attachOwnButton(second.Hl4Keys.Actions.Jump);
				jump.Fire(true);
				frames(2);
				jump.Fire(false);
				frames(2);
				const hold = new Instance("InputBinding");
				hold.Name = "HoldStandIn";
				hold.Type = Enum.InputBindingType.Scriptable;
				hold.Parent = jump.Instance;
				defer(() => hold.Destroy());
				hold.Fire(true);
				eventually(() => jump.IsPressed(), "held by the binding the package doesn't drive");
				frames(3);
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				second.Destroy();
				log.push(`end:${jump.Instance.GetState()}`);
				frames(4);
				expectEqual(
					`${edges.join("")}, pressed ${jump.IsPressed()}`,
					"R, pressed false",
					`signals ${expectedSignalBehavior()}: ${log.join(" ")}`,
				);
			});

			// HL4-3 (hunter, fixed as above; TrackPrevious): the extra press showed as IsJustPressed on the other root handle. REWRITTEN for 0.7.0 as above
			test("a key holding a shared tracked action when the root handle whose button goes is destroyed: one Released, one JustReleased frame, no JustPressed", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL4_TRACKED_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL4_TRACKED_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl4Tracked.Actions.Jump;
				attachOwnButton(second.Hl4Tracked.Actions.Jump);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J${real.FocusNote()}`);
				eventually(() => !jump.IsJustPressed(), "past the press's frame");
				frames(2);
				const edges = recordEdges(jump);
				const seen = new Array<string>();
				const look = (count: number) => {
					for (let index = 0; index < count; index++) {
						frame();
						if (jump.IsJustReleased()) seen.push("JR");
						if (jump.IsJustPressed()) seen.push("JP");
					}
				};
				second.Destroy();
				look(5);
				real.Release(K.J);
				look(6);
				expectEqual(
					`${seen.join(",")}; ${edges.join("")}; pressed ${jump.IsPressed()}`,
					"JR; R; pressed false",
					`signals ${expectedSignalBehavior()}: IsJustReleased/IsJustPressed per frame; Pressed/Released after the second root handle's Destroy${real.FocusNote()}`,
				);
			});

			// HL4-3 (hunter, fixed as above; Direction2D): the other root handle's StateChanged after the Destroy. REWRITTEN for 0.7.0 as HL4-1 (no button on a Direction2D action): the Destroy releases nothing, and T's release brings Move to rest once
			test("a key holding a shared Direction2D action when the other root handle is destroyed: the remaining root handle's StateChanged goes to rest once", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL4_MOVE_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL4_MOVE_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const move = first.Hl4Move.Actions.Move;
				real.Press(K.T);
				eventually(() => move.GetState() === new Vector2(0, 1), `T${real.FocusNote()}`);
				frames(3);
				const heard = recordSignal(move.StateChanged);
				second.Destroy();
				frames(4);
				real.Release(K.T);
				frames(4);
				expectEqual(
					heard.map((value) => `(${value.X},${value.Y})`).join(" "),
					"(0,0)",
					`signals ${expectedSignalBehavior()}: the first root handle's StateChanged after the second's Destroy and T's release${real.FocusNote()}`,
				);
			});

			// ---- a binding added to an action a key holds (HL4-3's cause)

			// HL4-4 (hunter, fixed: every path that adds a binding to an action, AttachButton, a Create's slots and template bindings, the swap's moves, goes through AddingBindings, which reads the held value first and, when it was not at rest, forgets the package's held values and fires the release pair after the add, as WriteBindings does after a rebind): on the server's copy (Server Authority), a binding the package adds to an action a key holds (AttachButton here) makes IAS release and press it again, as a rebind does (measured: "P attached +JumpUIButton1 R P"), and the action then stayed held on the client and the server after the key came up; the package fired no release pair after the add
			test("the server's copy: AttachButton while a key holds Jump: at rest on the client and the server once the key is up", () => {
				const authority = getProject() === "authority";
				if (authority) settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(server("provide", "sa") === true, "the server provides SA_SCHEMA");
				const input = create(SA_SCHEMA, {
					Folder: server("templates") as Folder,
					ResetOnFocusLoss: false,
				});
				eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy", 10);
				const jump = input.SaGameplay.Actions.Jump;
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), `F${real.FocusNote()}`);
				if (authority) eventually(() => serverJump() === true, "the server sees F", 10);
				const button = testButton(testGui());
				jump.AttachButton(button);
				log.push("attached");
				frames(10);
				const during = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				real.Release(K.F);
				frames(15);
				const after = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				expectEqual(
					after,
					`false/${authority ? "false" : "-"}`,
					`signals ${expectedSignalBehavior()}, IsServerAuthority ${InputActions.IsServerAuthority()}: client/server Jump once F came up (${during} after AttachButton with F still down; the handle's edges ${edges.join("")}; IAS: ${log.join(" ")}). F is up and the button was never pressed. Advanced.md (Releasing on the server): on the server's copy "a change to a binding's keys while the action is held ... leaves it held, on the client and the server", so the package fires a release pair after a rebind; nothing covers a binding it adds${real.FocusNote()}`,
				);
			});

			// HL4-4 (hunter, fixed as above; a second Create on the server's copy adds a binding to Jump while F holds Jump: its Alternate then, its own Scriptable slot since 0.7.0)
			test("the server's copy: a second Create adding a binding to Jump while a key holds it: at rest on the client and the server once the key is up", () => {
				const authority = getProject() === "authority";
				if (authority) settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(server("provide", "sa") === true, "the server provides SA_SCHEMA");
				const templates = server("templates") as Folder;
				const input = create(SA_SCHEMA, { Folder: templates, ResetOnFocusLoss: false });
				eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy", 10);
				const jump = input.SaGameplay.Actions.Jump;
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), `F${real.FocusNote()}`);
				if (authority) eventually(() => serverJump() === true, "the server sees F", 10);
				create(HL4_SA_ALT, { Folder: templates, ResetOnFocusLoss: false });
				log.push("created");
				frames(10);
				const during = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				real.Release(K.F);
				frames(15);
				const after = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				expectEqual(
					after,
					`false/${authority ? "false" : "-"}`,
					`signals ${expectedSignalBehavior()}, IsServerAuthority ${InputActions.IsServerAuthority()}: client/server Jump once F came up (${during} after the second Create with F still down; the handle's edges ${edges.join("")}; IAS: ${log.join(" ")}). Advanced.md: "Create twice on the same folder adopts the same instances ... destroying one handle leaves what another still uses (instances, held input, requests)"; nothing says a Create keeps a key's press after the key is up${real.FocusNote()}`,
				);
			});

			// HL4-4's last path (measured after the round, fixed: Fire makes <Action>Script through AddingBindings): the first Fire on an action makes its <Action>Script binding, a binding added to the action. On the server's copy, a first Fire(false) while F held Jump left it held on the client and the server once F was up (measured: "P fired +JumpScript:false R P", true/true): IAS pressed it again as the binding was added, and a value at rest fired on a binding just made changes nothing
			test("the server's copy: the first Fire of Jump, at rest, while a key holds it: at rest on the client and the server once the key is up", () => {
				const authority = getProject() === "authority";
				if (authority) settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(server("provide", "sa") === true, "the server provides SA_SCHEMA");
				const input = create(SA_SCHEMA, {
					Folder: server("templates") as Folder,
					ResetOnFocusLoss: false,
				});
				eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy", 10);
				const jump = input.SaGameplay.Actions.Jump;
				expectEqual(jump.Instance.FindFirstChild("JumpScript"), undefined, "no Fire on Jump yet");
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), `F${real.FocusNote()}`);
				if (authority) eventually(() => serverJump() === true, "the server sees F", 10);
				jump.Fire(false);
				log.push("fired");
				frames(10);
				const during = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				real.Release(K.F);
				settle(() => jump.IsPressed(), false, 2);
				if (authority) settle(serverJump, false, 2);
				frames(10);
				const after = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				expectEqual(
					after,
					`false/${authority ? "false" : "-"}`,
					`signals ${expectedSignalBehavior()}, IsServerAuthority ${InputActions.IsServerAuthority()}: client/server Jump once F came up (${during} after Fire(false) with F still down; the handle's edges ${edges.join("")}; IAS: ${log.join(" ")})${real.FocusNote()}`,
				);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), `F again${real.FocusNote()}`);
				if (authority) eventually(() => serverJump() === true, "the server sees F again", 10);
				real.Release(K.F);
				eventually(() => !jump.IsPressed(), "F released");
				if (authority) eventually(() => serverJump() === false, "the server sees F up", 10);
			});

			// The same with a first Fire of a press (passed before the fix too): the action is the Fire's until it fires the value at rest
			test("the server's copy: the first Fire of Jump, pressed, while a key holds it, then at rest once the key is up: at rest on the client and the server", () => {
				const authority = getProject() === "authority";
				if (authority) settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(server("provide", "sa") === true, "the server provides SA_SCHEMA");
				const input = create(SA_SCHEMA, {
					Folder: server("templates") as Folder,
					ResetOnFocusLoss: false,
				});
				eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy", 10);
				const jump = input.SaGameplay.Actions.Jump;
				expectEqual(jump.Instance.FindFirstChild("JumpScript"), undefined, "no Fire on Jump yet");
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), `F${real.FocusNote()}`);
				if (authority) eventually(() => serverJump() === true, "the server sees F", 10);
				jump.Fire(true);
				log.push("fired");
				frames(10);
				real.Release(K.F);
				frames(10);
				const held = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				jump.Fire(false);
				log.push("at rest");
				settle(() => jump.IsPressed(), false, 2);
				if (authority) settle(serverJump, false, 2);
				frames(10);
				const after = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				expectEqual(
					`${held} -> ${after}`,
					`true/${authority ? "true" : "-"} -> false/${authority ? "false" : "-"}`,
					`signals ${expectedSignalBehavior()}, IsServerAuthority ${InputActions.IsServerAuthority()}: client/server Jump held by the Fire after F came up, then after Fire(false) (the handle's edges ${edges.join("")}; IAS: ${log.join(" ")})${real.FocusNote()}`,
				);
			});

			// 0.7.0 (worker, the merge of HL4-4's fix): a later schema that names a device an earlier one left out fills that device's unbound binding, which changes its keys, so IAS resets the action as for a binding added: the fill runs inside AddingBindings, and the action is let go of the same way
			test("the server's copy: a second Create filling Jump's unbound Touch binding while a key holds it: at rest on the client and the server once the key is up", () => {
				const authority = getProject() === "authority";
				if (authority) settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(server("provide", "sa") === true, "the server provides SA_SCHEMA");
				const templates = server("templates") as Folder;
				const input = create(SA_SCHEMA, { Folder: templates, ResetOnFocusLoss: false });
				eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy", 10);
				const jump = input.SaGameplay.Actions.Jump;
				const touch = jump.Bindings.Touch.Instance;
				expectEqual(touch.KeyCode, K.None, "SA_SCHEMA leaves Touch out: unbound");
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), `F${real.FocusNote()}`);
				if (authority) eventually(() => serverJump() === true, "the server sees F", 10);
				create(HL4_SA_FILL, { Folder: templates, ResetOnFocusLoss: false });
				log.push("created");
				expectEqual(touch.KeyCode, K.TouchPosition, "the second schema filled it");
				frames(10);
				const during = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				real.Release(K.F);
				frames(15);
				const after = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				expectEqual(
					after,
					`false/${authority ? "false" : "-"}`,
					`signals ${expectedSignalBehavior()}, IsServerAuthority ${InputActions.IsServerAuthority()}: client/server Jump once F came up (${during} after the second Create with F still down; the handle's edges ${edges.join("")}; IAS: ${log.join(" ")}). Advanced.md (Releasing on the server): a Create that "fills a device's unbound binding" fires the pair${real.FocusNote()}`,
				);
			});

			// 0.7.0 (worker): one Create that both adds a binding and fills one lets go of the action once: one release pair on a Server Authority copy (two would press and release it once more), none for the key change on its own
			test("the server's copy: a second Create adding a binding and filling one while a key holds Jump: one release pair, at rest once the key is up", () => {
				const authority = getProject() === "authority";
				if (authority) settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(server("provide", "sa") === true, "the server provides SA_SCHEMA");
				const templates = server("templates") as Folder;
				const input = create(SA_SCHEMA, { Folder: templates, ResetOnFocusLoss: false });
				eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy", 10);
				const jump = input.SaGameplay.Actions.Jump;
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), `F${real.FocusNote()}`);
				if (authority) eventually(() => serverJump() === true, "the server sees F", 10);
				const second = create(HL4_SA_BOTH, { Folder: templates, ResetOnFocusLoss: false });
				log.push("created");
				expectEqual(jump.Bindings.Touch.Instance.KeyCode, K.TouchPosition, "filled");
				expectEqual(second.SaGameplay.Actions.Jump.Bindings.Own.Instance.Parent, jump.Instance);
				frames(10);
				const during = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				real.Release(K.F);
				frames(15);
				const after = `${jump.IsPressed()}/${authority ? serverJump() : "-"}`;
				const expectedPairs = InputActions.IsServerAuthority() !== false ? 1 : 0;
				expectEqual(
					`add pairs ${releasePairs(log, "InputActionsAddRelease")}, rebind pairs ${releasePairs(log, "InputActionsRebindRelease")}; ${after}`,
					`add pairs ${expectedPairs}, rebind pairs 0; false/${authority ? "false" : "-"}`,
					`signals ${expectedSignalBehavior()}, IsServerAuthority ${InputActions.IsServerAuthority()}: the release pairs the package fired (one per add, on the server's copy only), and client/server Jump once F came up (${during} after the second Create with F still down; the handle's edges ${edges.join("")}; IAS: ${log.join(" ")})${real.FocusNote()}`,
				);
			});

			// HL4-4 (hunter, fixed as above; the swap's Join path: a stand-in binding the copy lacks moves onto the copy's Jump while J holds it)
			test("a stand-in's binding moved at the swap onto a copy's action a key holds: at rest once the key is up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const copy = handMadeCopy("Hl4Join", [["Jump", Enum.InputActionType.Bool]]);
				copy.folder.Parent = Players.LocalPlayer;
				const onCopy = create(HL4_JOIN_SMALL, swapOptions(copy.folder.Name));
				expectTrue(onCopy.Hl4Join.IsLinkedToServer(), "linked at Create");
				const waiting = create(HL4_JOIN_BIG, swapOptions(copy.folder.Name));
				expectFalse(waiting.Hl4Join.IsLinkedToServer(), "the copy lacks Duck");
				const jump = onCopy.Hl4Join.Actions.Jump;
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J holds the copy's Jump${real.FocusNote()}`);
				frames(3);
				const duck = new Instance("InputAction");
				duck.Name = "Duck";
				duck.Parent = copy.context;
				eventually(() => waiting.Hl4Join.IsLinkedToServer(), "the swap once Duck is there");
				log.push("swapped");
				frames(10);
				const during = jump.IsPressed();
				real.Release(K.J);
				frames(15);
				expectFalse(
					jump.IsPressed(),
					`signals ${expectedSignalBehavior()}, IsServerAuthority ${InputActions.IsServerAuthority()}: Jump once J came up (${during} after the swap with J still down; the handle's edges ${edges.join("")}; IAS: ${log.join(" ")}). The swap moved the stand-in's JumpOwn onto the copy's Jump`,
				);
			});

			// 0.7.0 (worker, the merge of HL4-4's fix): the swap's Join path with a stand-in that names a device the copy's root handle left out: the stand-in's binding is adopted, and fills the copy's unbound one while J holds Jump (a key change, no binding added)
			test("a stand-in that fills at the swap a copy's unbound binding of an action a key holds: one release, at rest once the key is up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const copy = handMadeCopy("Hl4Join", [["Jump", Enum.InputActionType.Bool]]);
				copy.folder.Parent = Players.LocalPlayer;
				const onCopy = create(HL4_JOIN_SMALL, swapOptions(copy.folder.Name));
				expectTrue(onCopy.Hl4Join.IsLinkedToServer(), "linked at Create");
				const waiting = create(HL4_JOIN_FILL, swapOptions(copy.folder.Name));
				expectFalse(waiting.Hl4Join.IsLinkedToServer(), "the copy lacks Duck");
				const jump = onCopy.Hl4Join.Actions.Jump;
				const pad = jump.Bindings.Gamepad.Instance;
				expectEqual(pad.KeyCode, K.None, "the copy's root handle left Gamepad out: unbound");
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J holds the copy's Jump${real.FocusNote()}`);
				frames(3);
				const duck = new Instance("InputAction");
				duck.Name = "Duck";
				duck.Parent = copy.context;
				eventually(() => waiting.Hl4Join.IsLinkedToServer(), "the swap once Duck is there");
				log.push("swapped");
				expectEqual(waiting.Hl4Join.Actions.Jump.Bindings.Gamepad.Instance, pad, "adopted");
				expectEqual(pad.KeyCode, K.ButtonL1, "filled by the stand-in's schema");
				frames(10);
				const during = jump.IsPressed();
				real.Release(K.J);
				frames(15);
				const expectedPairs = InputActions.IsServerAuthority() !== false ? 1 : 0;
				expectEqual(
					`add pairs ${releasePairs(log, "InputActionsAddRelease")}, rebind pairs ${releasePairs(log, "InputActionsRebindRelease")}; pressed ${jump.IsPressed()}`,
					`add pairs ${expectedPairs}, rebind pairs 0; pressed false`,
					`signals ${expectedSignalBehavior()}, IsServerAuthority ${InputActions.IsServerAuthority()}: the release pairs the package fired, and Jump once J came up (${during} after the swap with J still down; the handle's edges ${edges.join("")}; IAS: ${log.join(" ")})`,
				);
			});

			// HL4-5 (hunter): on a local context (and the server's copy without Server Authority) a binding the package adds to an action a key holds releases the action at once (measured: IAS fires Released as the binding is parented), and the key, still down, doesn't hold it again until pressed again: AttachButton, or a second Create adding a slot, drops a held key's press. Nowhere in the docs then.
			// DOCUMENTED HL4-5, worker: IAS resets an action's bindings when one is added, as for a key change; the package can't keep the press (a value fired in its place would hold the action after the key comes up). Advanced.md (IAS behaviours to know, On-screen buttons, Get-or-create), API.md, the AttachButton JSDoc and the design doc (§4, §6, probed list) now say so; the tests assert the measured release, and that the key holds the action again once pressed again. On the server's copy the package lets go of the action instead (HL4-4).
			test("AttachButton while a key holds the action: released at once, as documented; the key holds it again once pressed again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = create(HL4_KEYS_SMALL, { Folder: newFolder(), ResetOnFocusLoss: false });
				const jump = input.Hl4Keys.Actions.Jump;
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J${real.FocusNote()}`);
				frames(2);
				const button = testButton(testGui());
				jump.AttachButton(button);
				log.push("attached");
				frames(4);
				const during = jump.IsPressed();
				real.Release(K.J);
				frames(4);
				expectEqual(
					`${during}; ${edges.join("")}; ${jump.IsPressed()}`,
					"false; PR; false",
					`signals ${expectedSignalBehavior()}: Jump pressed after AttachButton, with J still down; Pressed/Released; pressed after J came up. IAS's own events and the bindings added: ${log.join(" ")}. Advanced.md (IAS behaviours to know): "Adding a binding to a held action releases it ... a key still down holds it again only once it is pressed again"${real.FocusNote()}`,
				);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J pressed again holds Jump${real.FocusNote()}`);
				real.Release(K.J);
				eventually(() => !jump.IsPressed(), "J up");
			});

			// HL4-5 (hunter; DOCUMENTED, see above): a second Create's own binding on a shared action, added while a key holds that action through the first root handle's binding, releases it
			test("a second Create adding a binding to a shared action a key holds: released at once, as documented; the key holds it again once pressed again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL4_KEYS_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl4Keys.Actions.Jump;
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J${real.FocusNote()}`);
				frames(2);
				create(HL4_KEYS_BIG, { Folder: folder, ResetOnFocusLoss: false });
				log.push("created");
				frames(4);
				const during = jump.IsPressed();
				real.Release(K.J);
				frames(4);
				expectEqual(
					`${during}; ${edges.join("")}; ${jump.IsPressed()}`,
					"false; PR; false",
					`signals ${expectedSignalBehavior()}: Jump pressed after the second Create, with J still down; Pressed/Released; pressed after J came up. IAS: ${log.join(" ")}. Advanced.md (Get-or-create): "A Create that gives an action a binding it didn't have ... releases the action if it is held"${real.FocusNote()}`,
				);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J pressed again holds Jump${real.FocusNote()}`);
				real.Release(K.J);
				eventually(() => !jump.IsPressed(), "J up");
			});

			// 0.7.0 (worker): the same with a second Create that fills the first's unbound Gamepad binding (a key change, no binding added)
			test("a second Create filling a device's unbound binding of a shared action a key holds: released at once, as documented; the key holds it again once pressed again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL4_KEYS_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl4Keys.Actions.Jump;
				const pad = jump.Bindings.Gamepad;
				expectEqual(pad.Instance.KeyCode, K.None, "the first schema leaves Gamepad out: unbound");
				const log = eventLog(jump.Instance);
				const edges = recordEdges(jump);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J${real.FocusNote()}`);
				frames(2);
				create(HL4_KEYS_FILL, { Folder: folder, ResetOnFocusLoss: false });
				log.push("created");
				expectEqual(pad.Instance.KeyCode, K.ButtonL1, "the second schema filled it");
				expectEqual(
					pad.Get().KeyCode,
					K.ButtonL1,
					"the first root handle's binding handle reads it",
				);
				frames(4);
				const during = jump.IsPressed();
				real.Release(K.J);
				frames(4);
				expectEqual(
					`${during}; ${edges.join("")}; ${jump.IsPressed()}`,
					"false; PR; false",
					`signals ${expectedSignalBehavior()}: Jump pressed after the second Create, with J still down; Pressed/Released; pressed after J came up. IAS: ${log.join(" ")}. Advanced.md (Get-or-create): "A Create that ... fills one releases the action if it is held"${real.FocusNote()}`,
				);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J pressed again holds Jump${real.FocusNote()}`);
				real.Release(K.J);
				eventually(() => !jump.IsPressed(), "J up");
			});

			// Probe (passes): a root handle that holds the shared context off when destroyed (the context comes
			// back on in its Destroy, after ReleaseOwn skipped the disabled action). REWRITTEN for 0.7.0
			// as above: J is down on the binding both root handles use, and the second's button goes
			test("a root handle holding a shared context off, destroyed while a key is down and its button goes: the action is at rest once the key is up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL4_KEYS_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL4_KEYS_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl4Keys.Actions.Jump;
				attachOwnButton(second.Hl4Keys.Actions.Jump);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), `J${real.FocusNote()}`);
				second.Hl4Keys.Request(false);
				eventually(() => !jump.IsPressed(), "released by the disable");
				frames(2);
				second.Destroy();
				frames(4);
				const afterDestroy = `on ${first.Hl4Keys.IsEnabled()}, pressed ${jump.IsPressed()}`;
				real.Release(K.J);
				frames(6);
				expectFalse(
					jump.IsPressed(),
					`signals ${expectedSignalBehavior()}: after the Destroy: ${afterDestroy}${real.FocusNote()}`,
				);
				real.Press(K.J);
				eventually(() => jump.IsPressed(), "J, the first root handle's key, still works");
				real.Release(K.J);
				eventually(() => !jump.IsPressed(), "released");
			});

			// HL3-2's fix on the server's copy: the pair reaches the server once (passed under authority). HL4-3 (hunter, fixed as above) in the other projects, where the copy is a local context: the other root handle heard Pressed 2, Released 2
			// REWRITTEN for 0.7.0 as above: F (the template's key) holds Jump through the binding both
			// root handles use, and the binding that goes with the second is a button it attached
			test("the server's copy shared by two root handles: Destroy of the one whose button goes while a key holds Jump releases it on the client and the server, once", () => {
				const authority = getProject() === "authority";
				if (authority) settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(server("provide", "sa") === true, "the server provides SA_SCHEMA");
				const templates = server("templates") as Folder;
				const first = create(SA_SCHEMA, { Folder: templates, ResetOnFocusLoss: false });
				const second = create(HL4_SA_ALT, { Folder: templates, ResetOnFocusLoss: false });
				eventually(
					() => first.SaGameplay.IsLinkedToServer() && second.SaGameplay.IsLinkedToServer(),
					"both on the server's copy",
					10,
				);
				const jump = first.SaGameplay.Actions.Jump;
				expectEqual(second.SaGameplay.Actions.Jump.Instance, jump.Instance, "one Jump");
				const own = attachOwnButton(second.SaGameplay.Actions.Jump);
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), `F holds Jump${real.FocusNote()}`);
				let before = 0;
				if (authority) {
					eventually(() => serverJump() === true, "the server sees F", 10);
					before = serverPressed();
				}
				second.Destroy();
				expectEqual(own.Parent, undefined, "the binding only the second had went");
				eventually(() => !jump.IsPressed(), `the client's Jump released${real.FocusNote()}`, 5);
				if (authority) eventually(() => serverJump() === false, "the server's Jump released", 10);
				real.Release(K.F);
				frames(15);
				const server_ = authority ? `${serverJump()}, ${serverPressed() - before} presses` : "-";
				expectEqual(
					`client ${jump.IsPressed()}, server ${server_}; Pressed ${pressed.count}, Released ${released.count}`,
					`client false, server ${authority ? "false, 0 presses" : "-"}; Pressed 1, Released 1`,
					`signals ${expectedSignalBehavior()}: "The server sees one Released" (Advanced.md, Releasing on the server)${real.FocusNote()}`,
				);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), "F, the template's key, pressed again");
				if (authority) eventually(() => serverJump() === true, "the server sees F", 10);
				real.Release(K.F);
				eventually(() => !jump.IsPressed(), "F released");
				if (authority) eventually(() => serverJump() === false, "the server sees F up", 10);
			});

			// Probe (passes): the same with a value the destroyed root handle fired, the latest write.
			// REWRITTEN for 0.7.0 as above: F holds Jump through the binding both root handles use, and
			// the second has a button of its own
			test("the server's copy shared by two root handles: Destroy of one that fired Jump while a key holds it too: released once on both sides", () => {
				const authority = getProject() === "authority";
				if (authority) settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(server("provide", "sa") === true, "the server provides SA_SCHEMA");
				const templates = server("templates") as Folder;
				const first = create(SA_SCHEMA, { Folder: templates, ResetOnFocusLoss: false });
				const second = create(HL4_SA_ALT, { Folder: templates, ResetOnFocusLoss: false });
				eventually(
					() => first.SaGameplay.IsLinkedToServer() && second.SaGameplay.IsLinkedToServer(),
					"both on the server's copy",
					10,
				);
				const jump = first.SaGameplay.Actions.Jump;
				attachOwnButton(second.SaGameplay.Actions.Jump);
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				let before = 0;
				if (authority) {
					eventually(() => serverJump() === false, "the server's Jump at rest", 10);
					before = serverPressed();
				}
				second.SaGameplay.Actions.Jump.Fire(true);
				eventually(() => jump.IsPressed(), "the second's Fire");
				real.Press(K.F);
				frames(3);
				if (authority) eventually(() => serverJump() === true, "the server sees Jump held", 10);
				second.Destroy();
				eventually(() => !jump.IsPressed(), `the client's Jump released${real.FocusNote()}`, 5);
				if (authority) eventually(() => serverJump() === false, "the server's Jump released", 10);
				real.Release(K.F);
				frames(15);
				const server_ = authority ? `${serverJump()}, ${serverPressed() - before} presses` : "-";
				expectEqual(
					`client ${jump.IsPressed()}, server ${server_}; Pressed ${pressed.count}, Released ${released.count}`,
					`client false, server ${authority ? "false, 1 presses" : "-"}; Pressed 1, Released 1`,
					`signals ${expectedSignalBehavior()}${real.FocusNote()}`,
				);
			});

			// ---- a listener that fires during the swap's releases (Immediate signals run it there)

			// HL4-2 (hunter, fixed: the package's records of the held values stay through the swap's releases, and the swap carries over what they hold once every release ran, so a value a listener fires there replaces the one it fires over, and one it fires at rest drops it): under Immediate signals a listener that fires a Scriptable slot while the swap releases it (the swap's first step, on the stand-in) was overwritten: the swap fired the older value again on the copy afterwards, so the action ended on the value the listener replaced (under Deferred the listener runs after the swap, and its value stays)
			test("a listener that fires a Scriptable slot when the swap releases it: the action ends on the listener's value", () => {
				const copy = handMadeCopy("Hl4Swap", [["Throttle", Enum.InputActionType.Direction1D]]);
				const input = create(HL4_THROTTLE_SWAP, swapOptions(copy.folder.Name));
				const throttle = input.Hl4Swap.Actions.Throttle;
				const copyThrottle = copy.actions.get("Throttle")!;
				throttle.Bindings.Virtual.Fire(1);
				eventually(() => throttle.GetState() === 1, "held at 1 on the stand-in");
				frames(2);
				let heardOn = "";
				const connection = throttle.StateChanged.Connect((value) => {
					if (heardOn !== "" || value !== 0) return;
					heardOn = throttle.Instance === copyThrottle ? "the copy" : "the stand-in";
					throttle.Bindings.Virtual.Fire(0.5);
				});
				defer(() => connection.Disconnect());
				defer(() => throttle.Bindings.Virtual.Fire(0));
				const heard = recordSignal(throttle.StateChanged);
				copy.folder.Parent = Players.LocalPlayer;
				eventually(
					() => input.Hl4Swap.IsLinkedToServer() && heardOn !== "",
					"the swap, and the listener",
				);
				settle(() => copyThrottle.GetState(), 0.5);
				expectEqual(
					copyThrottle.GetState(),
					0.5,
					`signals ${expectedSignalBehavior()}: the listener heard Throttle at rest on ${heardOn} and fired 0.5, the last value fired on the slot; StateChanged then: ${heard.map((value) => tostring(value)).join(", ")}. At the swap "each Scriptable binding fires its last value again" (Advanced.md, Server Authority); under Deferred signals the same listener's 0.5 stays`,
				);
			});

			// HL4-2 (hunter, fixed as above; the same, on another action): the value a listener fires on an action whose release already ran in the swap stayed on the stand-in's binding, which moved to the copy without it: the copy's action stayed at rest
			test("a listener that fires another action when the swap releases one: that action is held on the copy", () => {
				const copy = handMadeCopy("Hl4Pair", [
					["Jump", Enum.InputActionType.Bool],
					["Duck", Enum.InputActionType.Bool],
				]);
				const input = create(HL4_PAIR_SWAP, swapOptions(copy.folder.Name));
				const { Jump: jump, Duck: duck } = input.Hl4Pair.Actions;
				// the swap releases the stand-in's actions in their order: the listener fires the one
				// whose release ran first
				const order = jump.Instance.Parent!.GetChildren();
				const jumpFirst = order.indexOf(jump.Instance) < order.indexOf(duck.Instance);
				const later = jumpFirst ? duck : jump;
				const earlier = jumpFirst ? jump : duck;
				const earlierCopy = copy.actions.get(earlier.Name)!;
				defer(() => {
					earlier.Fire(false);
					later.Fire(false);
				});
				later.Fire(true);
				eventually(() => later.IsPressed(), "held on the stand-in");
				frames(2);
				let firedOn = "";
				const connection = later.Released.Connect(() => {
					if (firedOn !== "") return;
					firedOn = later.Instance.IsDescendantOf(Players.LocalPlayer)
						? "the copy"
						: "the stand-in";
					earlier.Fire(true);
				});
				defer(() => connection.Disconnect());
				copy.folder.Parent = Players.LocalPlayer;
				eventually(
					() => input.Hl4Pair.IsLinkedToServer() && firedOn !== "",
					"the swap, and the listener",
				);
				settle(() => earlierCopy.GetState(), true);
				const onCopy = earlierCopy.GetState();
				const handle = earlier.IsPressed();
				// does a later Fire(true) press it (IAS ignores a repeated value on a binding)?
				earlier.Fire(true);
				settle(() => earlierCopy.GetState(), true);
				const firedAgain = earlierCopy.GetState();
				expectTrue(
					onCopy === true,
					`signals ${expectedSignalBehavior()}: the listener heard ${later.Name} released on ${firedOn} and fired ${earlier.Name} true; after the swap ${earlier.Name} on the copy reads ${onCopy} (handle IsPressed ${handle}), and ${firedAgain} after another Fire(true). Nothing fired false. At the swap "each Scriptable binding fires its last value again, so a held virtual stick stays held" (Advanced.md); under Deferred signals the same listener runs after the swap and the value stays`,
				);
			});

			// HL4-2 (worker, the other half of the fix): a listener that fires the slot at rest when the swap releases it: nothing is fired again on the copy
			test("a listener that fires a Scriptable slot at rest when the swap releases it: the action stays at rest on the copy", () => {
				const copy = handMadeCopy("Hl4Swap", [["Throttle", Enum.InputActionType.Direction1D]]);
				const input = create(HL4_THROTTLE_SWAP, swapOptions(copy.folder.Name));
				const throttle = input.Hl4Swap.Actions.Throttle;
				const copyThrottle = copy.actions.get("Throttle")!;
				throttle.Bindings.Virtual.Fire(1);
				eventually(() => throttle.GetState() === 1, "held at 1 on the stand-in");
				frames(2);
				let heardOn = "";
				const connection = throttle.StateChanged.Connect((value) => {
					if (heardOn !== "" || value !== 0) return;
					heardOn = throttle.Instance === copyThrottle ? "the copy" : "the stand-in";
					throttle.Bindings.Virtual.Fire(0);
				});
				defer(() => connection.Disconnect());
				defer(() => throttle.Bindings.Virtual.Fire(0));
				const heard = recordSignal(throttle.StateChanged);
				copy.folder.Parent = Players.LocalPlayer;
				eventually(
					() => input.Hl4Swap.IsLinkedToServer() && heardOn !== "",
					"the swap, and the listener",
				);
				// a copy under the player moves on simulation steps: long enough for a value fired
				// again to show
				frames(20);
				expectEqual(
					copyThrottle.GetState(),
					0,
					`signals ${expectedSignalBehavior()}: the listener heard Throttle at rest on ${heardOn} and fired 0 on the slot; StateChanged then: ${heard.map((value) => tostring(value)).join(", ")}. Advanced.md: a value a listener fires during the swap's releases "at rest stays at rest"`,
				);
			});

			// ---- StateChanged's dedupe (round 3): nothing legitimate lost

			test("a handle made while its action is held passes on the release and the next press", () => {
				const folder = newFolder();
				const first = create(HL4_KEYS_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl4Keys.Actions.Jump;
				jump.Fire(true);
				eventually(() => jump.IsPressed(), "held");
				frames(2);
				const second = create(HL4_KEYS_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const late = second.Hl4Keys.Actions.Jump;
				const states = recordSignal(late.StateChanged);
				const edges = new Array<string>();
				const connections = [
					late.Pressed.Connect(() => edges.push("P")),
					late.Released.Connect(() => edges.push("R")),
				];
				defer(() => connections.forEach((connection) => connection.Disconnect()));
				jump.Fire(false);
				frames(3);
				jump.Fire(true);
				frames(3);
				jump.Fire(false);
				frames(3);
				expectEqual(
					`${states.map((value) => tostring(value)).join(",")}; ${edges.join("")}`,
					"false,true,false; RPR",
					`signals ${expectedSignalBehavior()}`,
				);
			});

			test("a Direction2D value that comes back in one frame, and across frames: every change passed on", () => {
				const input = create(HL4_STICK, { Folder: newFolder(), ResetOnFocusLoss: false });
				const stick = input.Hl4Stick.Actions.Stick;
				const virtual = stick.Bindings.Virtual;
				const heard = recordSignal(stick.StateChanged);
				const a = new Vector2(1, 0);
				const b = new Vector2(0, 1);
				virtual.Fire(a);
				virtual.Fire(b);
				virtual.Fire(a);
				frames(3);
				virtual.Fire(b);
				frames(2);
				virtual.Fire(a);
				frames(2);
				virtual.Fire(Vector2.zero);
				frames(3);
				expectEqual(
					heard.map((value) => `(${value.X},${value.Y})`).join(" "),
					"(1,0) (0,1) (1,0) (0,1) (1,0) (0,0)",
					`signals ${expectedSignalBehavior()}`,
				);
			});

			test("a rebind that releases a held Direction2D action, then the new key: every change passed on", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = create(HL4_STICK, { Folder: newFolder(), ResetOnFocusLoss: false });
				const stick = input.Hl4Stick.Actions.Stick;
				const heard = recordSignal(stick.StateChanged);
				real.Press(K.T);
				eventually(() => stick.GetState() === new Vector2(0, 1), `T${real.FocusNote()}`);
				stick.Bindings.KeyboardAndMouse.Set({ Up: K.U });
				eventually(() => stick.GetState() === Vector2.zero, "released by the rebind");
				real.Release(K.T);
				frames(3);
				real.Press(K.U);
				eventually(() => stick.GetState() === new Vector2(0, 1), `U${real.FocusNote()}`);
				real.Release(K.U);
				eventually(() => stick.GetState() === Vector2.zero, "U up");
				frames(3);
				expectEqual(
					heard.map((value) => `(${value.X},${value.Y})`).join(" "),
					"(0,1) (0,0) (0,1) (0,0)",
					`signals ${expectedSignalBehavior()}${real.FocusNote()}`,
				);
			});
		});
	}
}
