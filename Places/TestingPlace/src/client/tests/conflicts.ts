import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectThrows,
	expectTrue,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { newFolder } from "./helpers";
import { realInput } from "./virtual";

const K = Enum.KeyCode;

const CONFLICTS_SCHEMA = InputActions.Schema({
	Play: {
		Priority: 3000,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.Space, Gamepad: K.ButtonA }),
			Interact: InputActions.Bool({ KeyboardAndMouse: K.E, Gamepad: K.ButtonX }),
			Sprint: InputActions.Bool({ KeyboardAndMouse: K.LeftControl }),
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.S, PrimaryModifier: K.LeftControl },
			}),
			QuickLoad: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.L, PrimaryModifier: K.LeftControl },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
					Arrows: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
				},
				Gamepad: K.Thumbstick1,
				Virtual: InputActions.Scriptable,
			}),
			Throttle: InputActions.Direction1D({ KeyboardAndMouse: { Up: K.W, Down: K.S } }),
		},
	},
	Menu: {
		Priority: 3100,
		Enabled: false,
		Actions: {
			Accept: InputActions.Bool({ KeyboardAndMouse: K.Space, Gamepad: K.ButtonA }),
		},
	},
});

function createConflicts() {
	const input = InputActions.Create(CONFLICTS_SCHEMA, {
		Folder: newFolder(),
		ResetOnFocusLoss: false,
	});
	defer(() => input.Destroy());
	return input;
}

/** A conflict as `path key identical`, for comparing lists */
function show(conflict: InputActions.BindingConflict) {
	return `${conflict.Path} ${conflict.Key.Name}${conflict.Identical ? " identical" : ""}`;
}

/** A pair as `path & path key identical` */
function showPair(pair: InputActions.ConflictPair) {
	return `${pair.Paths[0]} & ${pair.Paths[1]} ${pair.Key.Name}${pair.Identical ? " identical" : ""}`;
}

/**
 * Conflicts for a rebinding menu (0.7.0, F3): `FindConflicts(binding)` on the root handle (every
 * context) and on a context handle (its own), and `FindConflicts()` for every pair
 */
@Provider({ activeIn: ["testing"] })
export class ConflictsTests implements OnStart {
	onStart() {
		defineTests("conflicts", () => {
			test("the same key in another context: on the root handle, not on the context's", () => {
				const input = createConflicts();
				const jump = input.Play.Actions.Jump.Bindings.KeyboardAndMouse;
				expectArrayEqual(input.FindConflicts(jump).map(show), [
					"Menu/Accept/KeyboardAndMouse Space identical",
				]);
				expectArrayEqual(input.Play.FindConflicts(jump).map(show), []);
				const accept = input.Menu.Actions.Accept.Bindings.Gamepad;
				expectArrayEqual(input.Menu.FindConflicts(accept).map(show), []);
				expectArrayEqual(input.FindConflicts(accept).map(show), [
					"Play/Jump/Gamepad ButtonA identical",
				]);
				const conflict = input.FindConflicts(jump)[0];
				expectEqual(conflict.Binding, input.Menu.Actions.Accept.Bindings.KeyboardAndMouse);
				expectArrayEqual(conflict.Keys, [K.Space]);
			});

			test("a chord overlaps its plain key and the binding on its modifier; two chords sharing a modifier don't", () => {
				const input = createConflicts();
				const save = input.Play.Actions.QuickSave.Bindings.KeyboardAndMouse;
				expectArrayEqual(input.FindConflicts(save).map(show), [
					"Play/Move/KeyboardAndMouse S",
					"Play/Sprint/KeyboardAndMouse LeftControl",
					"Play/Throttle/KeyboardAndMouse S",
				]);
				const sprint = input.Play.Actions.Sprint.Bindings.KeyboardAndMouse;
				expectArrayEqual(input.FindConflicts(sprint).map(show), [
					"Play/QuickLoad/KeyboardAndMouse LeftControl",
					"Play/QuickSave/KeyboardAndMouse LeftControl",
				]);
				// the same chord is identical
				input.Play.Actions.QuickLoad.Bindings.KeyboardAndMouse.Set(K.S);
				expectArrayEqual(input.Play.FindConflicts(save).map(show), [
					"Play/Move/KeyboardAndMouse S",
					"Play/QuickLoad/KeyboardAndMouse S identical",
					"Play/Sprint/KeyboardAndMouse LeftControl",
					"Play/Throttle/KeyboardAndMouse S",
				]);
				// the modifiers in another order: IAS needs them pressed in order, so they only overlap
				const load = input.Play.Actions.QuickLoad.Bindings.KeyboardAndMouse;
				save.Set({ SecondaryModifier: K.LeftAlt });
				load.Set({ PrimaryModifier: K.LeftAlt, SecondaryModifier: K.LeftControl });
				expectEqual(input.FindConflicts(save).map(show)[1], "Play/QuickLoad/KeyboardAndMouse S");
			});

			test("composite directions share keys with a key and with other composites; an extra counts", () => {
				const input = createConflicts();
				const actions = input.Play.Actions;
				const interact = actions.Interact.Bindings.KeyboardAndMouse;
				interact.Set(K.W);
				expectArrayEqual(input.FindConflicts(interact).map(show), [
					"Play/Move/KeyboardAndMouse W identical",
					"Play/Throttle/KeyboardAndMouse W identical",
				]);
				const move = actions.Move.Bindings.KeyboardAndMouse;
				const conflicts = input.FindConflicts(move);
				expectArrayEqual(conflicts.map(show), [
					"Play/Interact/KeyboardAndMouse W identical",
					"Play/QuickSave/KeyboardAndMouse S",
					"Play/Throttle/KeyboardAndMouse W identical",
				]);
				expectArrayEqual(
					conflicts[2].Keys,
					[K.W, K.S],
					"in the order Move reads: Up, Left, Down, Right",
				);
				// the action's own extra
				move.Arrows.Set({ Up: K.D });
				expectEqual(
					input.FindConflicts(move.Arrows).map(show)[0],
					"Play/Move/KeyboardAndMouse D identical",
				);
				expectTrue(
					input
						.FindConflicts(move)
						.map(show)
						.includes("Play/Move/KeyboardAndMouse/Arrows D identical"),
				);
			});

			test("only the binding's device; unbound bindings and the binding itself are never listed", () => {
				const input = createConflicts();
				const actions = input.Play.Actions;
				const jumpPad = actions.Jump.Bindings.Gamepad;
				expectArrayEqual(input.Play.FindConflicts(jumpPad).map(show), []);
				actions.Interact.Bindings.Gamepad.Set(K.ButtonA);
				expectArrayEqual(input.Play.FindConflicts(jumpPad).map(show), [
					"Play/Interact/Gamepad ButtonA identical",
				]);
				// every action has a Touch binding: unbound, they conflict with nothing
				expectArrayEqual(input.FindConflicts(actions.Jump.Bindings.Touch).map(show), []);
				actions.Jump.Bindings.Touch.Set(K.TouchPosition);
				actions.Interact.Bindings.Touch.Set(K.TouchPosition);
				expectArrayEqual(input.FindConflicts(actions.Jump.Bindings.Touch).map(show), [
					"Play/Interact/Touch TouchPosition identical",
				]);
				actions.Jump.Bindings.KeyboardAndMouse.Clear();
				expectArrayEqual(input.FindConflicts(actions.Jump.Bindings.KeyboardAndMouse).map(show), []);
				expectArrayEqual(
					input.FindConflicts(input.Menu.Actions.Accept.Bindings.KeyboardAndMouse).map(show),
					[],
				);
			});

			test("FindConflicts(): every pair once, by path", () => {
				const input = createConflicts();
				expectArrayEqual(input.Play.FindConflicts().map(showPair), [
					"Play/Move/KeyboardAndMouse & Play/QuickSave/KeyboardAndMouse S",
					"Play/Move/KeyboardAndMouse & Play/Throttle/KeyboardAndMouse W identical",
					"Play/QuickLoad/KeyboardAndMouse & Play/Sprint/KeyboardAndMouse LeftControl",
					"Play/QuickSave/KeyboardAndMouse & Play/Sprint/KeyboardAndMouse LeftControl",
					"Play/QuickSave/KeyboardAndMouse & Play/Throttle/KeyboardAndMouse S",
				]);
				const all = input.FindConflicts();
				expectEqual(all.size(), 7, all.map(showPair).join("; "));
				expectEqual(showPair(all[0]), "Menu/Accept/Gamepad & Play/Jump/Gamepad ButtonA identical");
				expectEqual(
					showPair(all[1]),
					"Menu/Accept/KeyboardAndMouse & Play/Jump/KeyboardAndMouse Space identical",
				);
				expectEqual(all[0].Bindings[1], input.Play.Actions.Jump.Bindings.Gamepad);
			});

			test("throws on what isn't a device's binding handle", () => {
				const input = createConflicts();
				const virtual = input.Play.Actions.Move.Bindings
					.Virtual as unknown as InputActions.BindingHandle<
					Enum.InputActionType,
					InputActions.Device
				>;
				const message = expectThrows(() => input.FindConflicts(virtual), "a Scriptable binding");
				expectTrue(
					message.find("FindConflicts takes a device's binding handle", 1, true)[0] !== undefined,
					message,
				);
				const action = input.Play.Actions.Jump as unknown as typeof virtual;
				const fromContext = expectThrows(
					() => input.Play.FindConflicts(action),
					"an action handle",
				);
				expectTrue(
					fromContext.find("Play: FindConflicts takes", 1, true)[0] !== undefined,
					fromContext,
				);
			});

			test("the menu's flow: capture a key, find what else holds it, clear it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createConflicts();
				const jump = input.Play.Actions.Jump;
				let captured: Enum.KeyCode | undefined;
				jump.Capture((key) => (captured = key));
				real.Tap(K.E);
				eventually(() => captured !== undefined, `the capture${real.FocusNote()}`);
				const conflicts = input.FindConflicts(jump.Bindings.KeyboardAndMouse);
				expectArrayEqual(conflicts.map(show), ["Play/Interact/KeyboardAndMouse E identical"]);
				// the menu offers a swap: the other binding takes the key this one had
				conflicts[0].Binding.Set(K.Space);
				expectEqual(
					input.Play.Actions.Interact.Bindings.KeyboardAndMouse.Instance.KeyCode,
					K.Space,
				);
				expectArrayEqual(input.Play.FindConflicts(jump.Bindings.KeyboardAndMouse).map(show), []);
				// or clears it
				conflicts[0].Binding.Clear();
				expectEqual(conflicts[0].Binding.Describe(), "");
			});

			test("Slot and Slots: the other binding's slots that hold the key; Clear(Slot) frees that key alone", () => {
				const input = createConflicts();
				const { Jump, Move, QuickSave, Sprint, QuickLoad, Throttle } = input.Play.Actions;
				const slots = (conflict: InputActions.BindingConflict) =>
					`${conflict.Path} ${conflict.Slot} ${conflict.Slots.join("+")}`;
				// S captured for Jump: Move's Down, QuickSave's KeyCode, Throttle's Down
				Jump.Bindings.KeyboardAndMouse.Set(K.S);
				const conflicts = input.Play.FindConflicts(Jump.Bindings.KeyboardAndMouse);
				expectArrayEqual(conflicts.map(slots), [
					"Play/Move/KeyboardAndMouse Down Down",
					"Play/QuickSave/KeyboardAndMouse KeyCode KeyCode",
					"Play/Throttle/KeyboardAndMouse Down Down",
				]);
				// the pair form: each side's slots, in the order of Paths
				const pair = input.Play.FindConflicts().find(
					(found) =>
						found.Paths[0] === "Play/Jump/KeyboardAndMouse" &&
						found.Paths[1] === "Play/Move/KeyboardAndMouse",
				);
				expectTrue(pair !== undefined, "the Jump & Move pair");
				expectArrayEqual(pair!.Slots[0], ["KeyCode"]);
				expectArrayEqual(pair!.Slots[1], ["Down"]);
				// the menu frees the key: the rest of each binding stays
				for (const conflict of conflicts) conflict.Binding.Clear(conflict.Slot);
				const move = Move.Bindings.KeyboardAndMouse.Instance;
				expectEqual(move.Down, K.None, "S is free");
				expectEqual(move.Up, K.W, "the other directions stay");
				expectEqual(move.Left, K.A);
				expectEqual(move.Right, K.D);
				expectEqual(Throttle.Bindings.KeyboardAndMouse.Instance.Up, K.W);
				expectEqual(QuickSave.Bindings.KeyboardAndMouse.Instance.PrimaryModifier, K.LeftControl);
				expectArrayEqual(input.Play.FindConflicts(Jump.Bindings.KeyboardAndMouse).map(show), []);
				// a key that is the other's modifier: its modifier slot
				const onCtrl = input.Play.FindConflicts(Sprint.Bindings.KeyboardAndMouse);
				expectArrayEqual(onCtrl.map(slots), [
					"Play/QuickLoad/KeyboardAndMouse PrimaryModifier PrimaryModifier",
				]);
				onCtrl[0].Binding.Clear(onCtrl[0].Slot);
				expectEqual(QuickLoad.Bindings.KeyboardAndMouse.Describe(), "L", "Ctrl+L became L");
				// one key in several slots: every one of them, the first first
				Move.Bindings.KeyboardAndMouse.Set({ Down: K.W });
				const both = input.Play.FindConflicts(Throttle.Bindings.KeyboardAndMouse);
				expectArrayEqual(both.map(slots), ["Play/Move/KeyboardAndMouse Up Up+Down"]);
			});

			test("a stick and a binding on one of its directions share the direction; a drag or a pinch and TouchPosition the drag or the pinch", () => {
				const input = InputActions.Create(
					InputActions.Schema({
						Sticks: {
							Actions: {
								Move: InputActions.Direction2D({ Gamepad: K.Thumbstick1, Touch: K.TouchDelta }),
								Peek: InputActions.Bool({ Gamepad: K.Thumbstick1Up, Touch: K.TouchPosition }),
								Lean: InputActions.Direction1D({
									Gamepad: { Up: K.Thumbstick1Right, Down: K.Thumbstick1Left },
									Touch: K.TouchPinch,
								}),
								Look: InputActions.Direction2D({ Gamepad: K.Thumbstick2 }),
								Point: InputActions.ViewportPosition({ Touch: K.TouchPosition }),
							},
						},
					}),
					{ Folder: newFolder(), ResetOnFocusLoss: false },
				);
				defer(() => input.Destroy());
				const { Move, Peek, Lean, Point } = input.Sticks.Actions;
				const keys = (conflict: InputActions.BindingConflict) =>
					`${conflict.Path} ${conflict.Keys.map((key) => key.Name).join("+")} ${conflict.Slot}${conflict.Identical ? " identical" : ""}`;
				expectArrayEqual(input.FindConflicts(Move.Bindings.Gamepad).map(keys), [
					"Sticks/Lean/Gamepad Thumbstick1Right+Thumbstick1Left Up",
					"Sticks/Peek/Gamepad Thumbstick1Up KeyCode",
				]);
				expectArrayEqual(input.FindConflicts(Peek.Bindings.Gamepad).map(keys), [
					"Sticks/Move/Gamepad Thumbstick1Up KeyCode",
				]);
				// a drag holds a finger on the screen, as a pinch holds two
				expectArrayEqual(input.FindConflicts(Peek.Bindings.Touch).map(keys), [
					"Sticks/Lean/Touch TouchPinch KeyCode",
					"Sticks/Move/Touch TouchDelta KeyCode",
					"Sticks/Point/Touch TouchPosition KeyCode identical",
				]);
				expectArrayEqual(input.FindConflicts(Move.Bindings.Touch).map(keys), [
					"Sticks/Peek/Touch TouchDelta KeyCode",
					"Sticks/Point/Touch TouchDelta KeyCode",
				]);
				expectArrayEqual(input.FindConflicts(Point.Bindings.Touch).map(keys), [
					"Sticks/Lean/Touch TouchPinch KeyCode",
					"Sticks/Move/Touch TouchDelta KeyCode",
					"Sticks/Peek/Touch TouchPosition KeyCode identical",
				]);
				// the other stick's, and a drag and a pinch, share nothing
				expectArrayEqual(
					input.FindConflicts(input.Sticks.Actions.Look.Bindings.Gamepad).map(keys),
					[],
				);
				expectEqual(
					input.FindConflicts(Lean.Bindings.Touch).map(keys).join("; "),
					"Sticks/Peek/Touch TouchPinch KeyCode; Sticks/Point/Touch TouchPinch KeyCode",
				);
			});
		});
	}
}
