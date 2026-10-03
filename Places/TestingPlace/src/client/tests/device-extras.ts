import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { RESERVED_EXTRA_NAMES } from "@rbxts/input-actions/out/InputActions/BindingRules";
import { HttpService, Players, UserInputService } from "@rbxts/services";
import { EXTRAS_SCHEMA } from "shared/fixtures/extras";
import { countSignal, frames, nearlyEqual, newFolder, recordSignal, recordWarnings } from "./helpers";
import { RealInput, realInput } from "./virtual";

const K = Enum.KeyCode;

/** `Create` in a fresh folder unless given one, destroyed after the test; no focus-loss reset */
function create<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
	options: InputActions.CreateOptions = {},
): InputActions.Handle<S> {
	const input = InputActions.Create(schema, { Folder: newFolder(), ...options, ResetOnFocusLoss: false });
	defer(() => input.Destroy());
	return input;
}

function contains(text: string, part: string) {
	return text.find(part, 1, true)[0] !== undefined;
}

function encode(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

/** A save's entries as sorted lines, `Path: Property=Value ...`, whatever order the JSON has them in */
function canonical(save: string) {
	const decoded = HttpService.JSONDecode(save) as {
		Bindings: Record<string, Record<string, unknown>>;
	};
	const lines = new Array<string>();
	for (const [path, entry] of pairs(decoded.Bindings)) {
		const parts = new Array<string>();
		for (const [name, value] of pairs(entry)) parts.push(`${name}=${tostring(value)}`);
		parts.sort();
		lines.push(`${path}: ${parts.join(" ")}`);
	}
	lines.sort();
	return lines.join("; ");
}

/** The keys of a table, sorted */
function namesOf(record: object) {
	const names = new Array<string>();
	for (const [name] of pairs(record as Record<string, unknown>)) names.push(tostring(name));
	names.sort();
	return names;
}

/** The names of an action's bindings, sorted */
function bindingNames(action: InputAction) {
	const names = action
		.GetChildren()
		.filter((child) => child.IsA("InputBinding"))
		.map((child) => child.Name);
	names.sort();
	return names;
}

/** Calls Set past the types, to reach the runtime checks */
function untypedSet(handle: object, spec: unknown) {
	(handle as { Set(spec: unknown): void }).Set(spec);
}

/** A few frames in which nothing may arrive */
function quiet() {
	frames(6);
}

/** Holds `keys` down in order, each one landed before the next */
function hold(real: RealInput, keys: Enum.KeyCode[]) {
	for (const key of keys) {
		real.Press(key);
		eventually(() => UserInputService.IsKeyDown(key), `${key.Name} is down${real.FocusNote()}`);
		frames(2);
	}
}

/** Releases `key` and waits until the engine has it up */
function lifted(real: RealInput, key: Enum.KeyCode) {
	real.Release(key);
	eventually(() => !UserInputService.IsKeyDown(key), `${key.Name} is up${real.FocusNote()}`);
}

/** The schema of a root handle without extras, beside EXTRAS_SCHEMA on one folder */
const PLAIN_SCHEMA = InputActions.Schema({
	Extras: {
		Priority: 3000,
		Actions: {
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
			}),
			Jump: InputActions.Bool({ KeyboardAndMouse: K.Space }),
		},
	},
});
/** Another schema with Move's Arrows extra, other keys: the first one made wins */
const SAME_EXTRA_SCHEMA = InputActions.Schema({
	Extras: {
		Priority: 3000,
		Actions: {
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
					Arrows: { Up: K.I, Down: K.K, Left: K.J, Right: K.L },
				},
			}),
		},
	},
});

/** Jump without a keyboard-and-mouse binding, then two schemas that name the device */
const KEYS_LEFT_OUT = InputActions.Schema({
	ExtrasFill: { Actions: { Jump: InputActions.Bool({ Gamepad: K.ButtonA }) } },
});
const KEYS_NAMESPACE = InputActions.Schema({
	ExtrasFill: {
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: { Main: K.J, Alt: K.K } }) },
	},
});
const KEYS_UNBOUND_MAIN = InputActions.Schema({
	ExtrasFill: { Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: { Main: {}, Alt: K.K } }) } },
});
const KEYS_DIRECT = InputActions.Schema({
	ExtrasFill: { Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.L }) } },
});

/** A Server Authority context with extras on two devices */
const SA_EXTRAS = InputActions.Schema({
	ExtrasSwap: {
		ServerAuthority: true,
		Priority: 3000,
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: { Main: K.J, Alt: {} },
				Gamepad: { Main: K.ButtonA, Alt: K.ButtonL1 },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
					Arrows: { Up: K.Up, Down: K.Down },
				},
			}),
		},
	},
});
/** The same context without extras, on the copy first; the extras schema waits for Duck */
const SA_PLAIN = InputActions.Schema({
	ExtrasSwap: {
		ServerAuthority: true,
		Priority: 3000,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) },
	},
});
const SA_EXTRAS_DUCK = InputActions.Schema({
	ExtrasSwap: {
		ServerAuthority: true,
		Priority: 3000,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: { Main: K.J, Alt: K.K } }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.C }),
		},
	},
});

let copyCount = 0;

/**
 * A copy of a context built by hand under a player folder no server provides (the server's copy of
 * a Server Authority context, for the swap); gone after the test. Parented to the player when `now`
 */
function handMadeCopy(actions: Array<[string, Enum.InputActionType]>, now: boolean) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `DeviceExtrasCopy${copyCount}`;
	const context = new Instance("InputContext");
	context.Name = "ExtrasSwap";
	const made = new Map<string, InputAction>();
	for (const [name, actionType] of actions) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Type = actionType;
		action.Parent = context;
		made.set(name, action);
	}
	context.Parent = folder;
	if (now) folder.Parent = Players.LocalPlayer;
	defer(() => folder.Destroy());
	return { folder, context, actions: made };
}

/**
 * Extra bindings per device at runtime (0.7.0, design spec §4, §6, §7, §8): the device's handle is
 * the main binding's with the declared extras on it, each a binding handle of the device, made as
 * `<Action><Device><Extra>` and saved at `Context/Action/Device/Extra`; adoption, root handles with
 * other extras, the fill, a held action, and the Server Authority swap
 */
@Provider({ activeIn: ["testing"] })
export class DeviceExtrasTests implements OnStart {
	onStart() {
		defineTests("device-extras", () => {
			// ---- handles

			test("the device's handle is the main binding's; the declared extras hang off it, bindings of their own", () => {
				const actions = create(EXTRAS_SCHEMA).Extras.Actions;
				const move = actions.Move;
				const keys = move.Bindings.KeyboardAndMouse;
				expectEqual(keys.Instance.Name, "MoveKeyboardAndMouse", "Main keeps the device's binding");
				expectEqual(keys.Get().Up, K.W);
				const arrows = keys.Arrows;
				expectEqual(arrows.Instance.Name, "MoveKeyboardAndMouseArrows");
				expectEqual(arrows.Instance.Parent, move.Instance);
				expectEqual(arrows.Instance.Type, Enum.InputBindingType.Automatic);
				expectEqual(arrows.Name, "KeyboardAndMouse", "an extra's Name is its device");
				expectEqual(arrows.Get().Up, K.Up);
				expectEqual(arrows.Get().Right, K.Right);
				expectEqual(move.Bindings.Gamepad.Instance.KeyCode, K.Thumbstick1);
				expectEqual(move.Bindings.Gamepad.DPad.Instance.Name, "MoveGamepadDPad");
				expectEqual(move.Bindings.Gamepad.DPad.Instance.Left, K.DPadLeft);
				expectArrayEqual(bindingNames(move.Instance), [
					"MoveGamepad",
					"MoveGamepadDPad",
					"MoveKeyboardAndMouse",
					"MoveKeyboardAndMouseArrows",
					"MoveTouch",
					"MoveVirtual",
				]);
				// Extras(): the same handles, by name; none on an extra, nor on a device without
				expectArrayEqual(namesOf(keys.Extras()), ["Arrows"]);
				expectEqual(keys.Extras().Arrows, arrows);
				expectArrayEqual(namesOf(arrows.Extras()), []);
				expectArrayEqual(namesOf(move.Bindings.Touch.Extras()), []);
				expectArrayEqual(namesOf(actions.Dash.Bindings.KeyboardAndMouse.Extras()), []);
				// {} is a binding with no keys, Main too
				const jump = actions.Jump;
				expectArrayEqual(namesOf(jump.Bindings.KeyboardAndMouse.Alt.Get()), []);
				expectEqual(jump.Bindings.KeyboardAndMouse.Alt.Instance.KeyCode, K.None);
				expectEqual(jump.Bindings.Gamepad.Alt.Instance.KeyCode, K.ButtonL1);
				expectTrue(nearlyEqual(jump.Bindings.Gamepad.Alt.Instance.PressedThreshold, 0.4));
				expectEqual(jump.Bindings.Touch.Second.Instance.Name, "JumpTouchSecond");
				expectEqual(jump.Bindings.Touch.Second.Name, "Touch");
				expectEqual(jump.Bindings.Touch.Instance.KeyCode, K.TouchPosition);
				const throttle = actions.Throttle;
				expectArrayEqual(namesOf(throttle.Bindings.KeyboardAndMouse.Get()), []);
				expectEqual(throttle.Bindings.KeyboardAndMouse.Instance.Name, "ThrottleKeyboardAndMouse");
				expectEqual(throttle.Bindings.KeyboardAndMouse.Wheel.Instance.KeyCode, K.MouseWheel);
			});

			test("every member of a binding handle is a name an extra can't take", () => {
				// a handle without extras: every key it has is the class's own
				const handle = create(EXTRAS_SCHEMA).Extras.Actions.Dash.Bindings.KeyboardAndMouse;
				const members = new Set<string>();
				for (const [key] of pairs(handle as unknown as Record<string, unknown>)) members.add(key);
				const methods = getmetatable(handle as object) as Record<string, unknown>;
				for (const [key] of pairs(methods)) members.add(key);
				// roblox-ts's class machinery: called before an extra is hung, never through the handle
				for (const machinery of ["__index", "new", "constructor"]) members.delete(machinery);
				expectTrue(members.has("Capture") && members.has("_extras") && members.has("Instance"));
				for (const member of members) {
					expectTrue(
						(RESERVED_EXTRA_NAMES as readonly string[]).includes(member),
						`${member} is a member of BindingHandle: add it to BINDING_HANDLE_MEMBERS`,
					);
				}
			});

			test("an extra is a binding handle of its device: Set, Clear, Reset, its device's keys, BindingsChanged with its path", () => {
				const input = create(EXTRAS_SCHEMA);
				const changes = recordSignal(input.BindingsChanged);
				const move = input.Extras.Actions.Move;
				const arrows = move.Bindings.KeyboardAndMouse.Arrows;
				arrows.Set({ Up: K.I });
				expectEqual(arrows.Instance.Up, K.I);
				expectEqual(arrows.Instance.Down, K.Down, "merged");
				const message = expectThrows(() => untypedSet(arrows, { Up: K.DPadUp }));
				expectTrue(contains(message, "Extras/Move/KeyboardAndMouse/Arrows"), message);
				expectTrue(contains(message, "DPadUp is a Gamepad key"), message);
				const padAlt = input.Extras.Actions.Jump.Bindings.Gamepad.Alt;
				expectThrows(() => untypedSet(padAlt, K.F));
				expectThrows(() => untypedSet(input.Extras.Actions.Jump.Bindings.Touch.Second, K.E));
				input.Extras.Actions.Jump.Bindings.Touch.Second.Set(K.TouchPosition);
				arrows.Clear("Up");
				expectEqual(arrows.Instance.Up, K.None);
				arrows.Reset();
				expectEqual(arrows.Instance.Up, K.Up, "back to the schema's");
				padAlt.Clear();
				expectEqual(padAlt.Instance.KeyCode, K.None);
				padAlt.Reset();
				expectEqual(padAlt.Instance.KeyCode, K.ButtonL1);
				// the main bindings are untouched
				expectEqual(move.Bindings.KeyboardAndMouse.Instance.Up, K.W);
				expectEqual(input.Extras.Actions.Jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA);
				eventually(() => changes.size() === 6, `six BindingsChanged (${changes.join(", ")})`);
				const seen = new Set(changes);
				expectArrayEqual(namesOf(seen), [
					"Extras/Jump/Gamepad/Alt",
					"Extras/Jump/Touch/Second",
					"Extras/Move/KeyboardAndMouse/Arrows",
				]);
			});

			test("the touch binding's extras have no captures: they throw if called anyway", () => {
				const second = create(EXTRAS_SCHEMA).Extras.Actions.Jump.Bindings.Touch
					.Second as unknown as {
					Capture(slot: string, callback: () => void): () => void;
					CaptureChord(callback: () => void): () => void;
				};
				const message = expectThrows(() => second.Capture("KeyCode", () => {}));
				expectTrue(contains(message, "Extras/Jump/Touch/Second"), message);
				expectTrue(contains(message, "touch has no keys to press"), message);
				expectThrows(() => second.CaptureChord(() => {}));
			});

			test("Create refuses what Schema refuses in a namespace, before it makes anything", () => {
				const folder = newFolder();
				const withName = (name: string, key: Enum.KeyCode) => {
					const extras: Record<string, unknown> = { Main: K.E };
					extras[name] = key;
					return {
						Contexts: {
							ExtrasBad: {
								Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: extras } as never) },
							},
						},
					};
				};
				const reserved = expectThrows(() =>
					InputActions.Create(withName("Get", K.F) as never, { Folder: folder }),
				);
				expectTrue(contains(reserved, "InputActions.Create: ExtrasBad/Jump/KeyboardAndMouse/Get"), reserved);
				const wrongKey = expectThrows(() =>
					InputActions.Create(withName("Alt", K.ButtonA) as never, { Folder: folder }),
				);
				expectTrue(contains(wrongKey, "ExtrasBad/Jump/KeyboardAndMouse/Alt"), wrongKey);
				expectTrue(contains(wrongKey, "ButtonA is a Gamepad key"), wrongKey);
				expectEqual(folder.GetChildren().size(), 0, "nothing made");
			});

			// ---- captures (real keys through VirtualInput, whose gamepad KeyCodes the captures classify
			// as the gamepad's)

			test("an extra's Capture takes its device's keys only, and the key presses the action through the extra", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = create(EXTRAS_SCHEMA).Extras.Actions.Jump;
				const alt = jump.Bindings.KeyboardAndMouse.Alt;
				const captured = new Array<Enum.KeyCode>();
				const stop = alt.Capture("KeyCode", (key) => captured.push(key));
				defer(stop);
				real.Tap(K.ButtonX);
				real.Tap(K.ButtonL1);
				quiet();
				expectEqual(captured.size(), 0, `gamepad keys${real.FocusNote()}`);
				real.Tap(K.G);
				eventually(() => captured.size() === 1, `G${real.FocusNote()}`);
				expectEqual(captured[0], K.G);
				expectEqual(alt.Instance.KeyCode, K.G);
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.Space, "Main is untouched");
				// the extra is a binding of the action
				real.Press(K.G);
				eventually(() => jump.IsPressed(), `G presses Jump${real.FocusNote()}`);
				lifted(real, K.G);
				eventually(() => !jump.IsPressed(), "released");
			});

			test("a gamepad extra's Capture and CaptureChord take gamepad keys only", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = create(EXTRAS_SCHEMA);
				const changes = recordSignal(input.BindingsChanged);
				const jump = input.Extras.Actions.Jump;
				const padAlt = jump.Bindings.Gamepad.Alt;
				const captured = new Array<Enum.KeyCode>();
				const stop = padAlt.Capture("KeyCode", (key) => captured.push(key));
				defer(stop);
				real.Tap(K.G);
				quiet();
				expectEqual(captured.size(), 0, `a keyboard key${real.FocusNote()}`);
				real.Tap(K.ButtonX);
				eventually(() => captured.size() === 1, `ButtonX${real.FocusNote()}`);
				expectEqual(padAlt.Instance.KeyCode, K.ButtonX);
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA, "Main is untouched");
				eventually(() => changes.includes("Extras/Jump/Gamepad/Alt"), "BindingsChanged");
				// a chord: a keyboard key among its keys is no part of it
				const chords = new Array<string>();
				padAlt.CaptureChord((chord) =>
					chords.push(chord === undefined ? "none" : `${chord.PrimaryModifier?.Name}+${chord.KeyCode.Name}`),
				);
				hold(real, [K.ButtonL1, K.G, K.ButtonR2]);
				lifted(real, K.G);
				quiet();
				expectEqual(chords.size(), 0, `G's release settles nothing${real.FocusNote()}`);
				lifted(real, K.ButtonR2);
				eventually(() => chords.size() === 1, `the chord${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(chords[0], "ButtonL1+ButtonR2");
				expectEqual(padAlt.Instance.KeyCode, K.ButtonR2);
				expectEqual(padAlt.Instance.PrimaryModifier, K.ButtonL1);
			});

			test("the action's one-field Capture writes the device's main binding, never an extra", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = create(EXTRAS_SCHEMA).Extras.Actions.Jump;
				const captured = new Array<string>();
				const stop = jump.Capture((key, device) => captured.push(`${key.Name} on ${device}`));
				defer(stop);
				real.Tap(K.ButtonX);
				eventually(() => captured.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(captured[0], "ButtonX on Gamepad");
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonX);
				expectEqual(jump.Bindings.Gamepad.Alt.Instance.KeyCode, K.ButtonL1, "the extra is untouched");
				expectEqual(jump.Bindings.KeyboardAndMouse.Alt.Instance.KeyCode, K.None);
			});

			// ---- saves

			test("saves: an extra's path is Context/Action/Device/Extra; export, reset, import", () => {
				const input = create(EXTRAS_SCHEMA);
				const { Move, Jump } = input.Extras.Actions;
				Move.Bindings.KeyboardAndMouse.Arrows.Set({ Up: K.I });
				Jump.Bindings.KeyboardAndMouse.Alt.Set(K.F);
				Jump.Bindings.Gamepad.Alt.Clear();
				Move.Bindings.KeyboardAndMouse.Set({ Up: K.Eight });
				const saved = input.ExportBindings();
				expectEqual(
					canonical(saved),
					[
						"Extras/Jump/Gamepad/Alt: KeyCode=None",
						"Extras/Jump/KeyboardAndMouse/Alt: KeyCode=F",
						"Extras/Move/KeyboardAndMouse/Arrows: Up=I",
						"Extras/Move/KeyboardAndMouse: Up=Eight",
					].join("; "),
				);
				expectEqual(canonical(input.Extras.ExportBindings()), canonical(saved), "the context's too");
				input.ResetBindings();
				expectEqual(Move.Bindings.KeyboardAndMouse.Arrows.Instance.Up, K.Up);
				expectEqual(Jump.Bindings.KeyboardAndMouse.Alt.Instance.KeyCode, K.None);
				expectEqual(Jump.Bindings.Gamepad.Alt.Instance.KeyCode, K.ButtonL1);
				expectEqual(input.ExportBindings(), '{"Version":1,"Bindings":{}}');
				const result = input.ImportBindings(saved);
				expectArrayEqual(result.Applied, [
					"Extras/Jump/Gamepad/Alt",
					"Extras/Jump/KeyboardAndMouse/Alt",
					"Extras/Move/KeyboardAndMouse",
					"Extras/Move/KeyboardAndMouse/Arrows",
				]);
				expectEqual(result.Skipped.size(), 0);
				expectEqual(Move.Bindings.KeyboardAndMouse.Arrows.Instance.Up, K.I);
				expectEqual(Jump.Bindings.KeyboardAndMouse.Alt.Instance.KeyCode, K.F);
				expectEqual(Jump.Bindings.Gamepad.Alt.Instance.KeyCode, K.None);
				expectEqual(canonical(input.ExportBindings()), canonical(saved));
				// the context handle's import too
				input.ResetBindings();
				expectArrayEqual(input.Extras.ImportBindings(saved).Applied, result.Applied);
			});

			test("saves: an extra the schema doesn't declare, Main and another device's key are skipped with a reason", () => {
				const input = create(EXTRAS_SCHEMA);
				const result = input.ImportBindings(
					encode({
						"Extras/Move/KeyboardAndMouse/Numpad": { Up: "KeypadEight" },
						"Extras/Move/KeyboardAndMouse/Main": { Up: "Nine" },
						"Extras/Dash/KeyboardAndMouse/Alt": { KeyCode: "F" },
						"Extras/Jump/Gamepad/Alt": { KeyCode: "G" },
						"Extras/Jump/KeyboardAndMouse/Alt/More": { KeyCode: "F" },
						"Extras/Move/Virtual/Alt": { Up: "U" },
						"Extras/Jump/KeyboardAndMouse/Alt": { KeyCode: "J" },
					}),
				);
				expectArrayEqual(result.Applied, ["Extras/Jump/KeyboardAndMouse/Alt"]);
				const reasons = new Map<string, string>();
				for (const skipped of result.Skipped) reasons.set(skipped.Path, skipped.Reason);
				expectEqual(
					reasons.get("Extras/Move/KeyboardAndMouse/Numpad"),
					"Extras/Move/KeyboardAndMouse has no extra binding Numpad: a device's extras are the ones its schema declares",
				);
				expectEqual(
					reasons.get("Extras/Dash/KeyboardAndMouse/Alt"),
					"Extras/Dash/KeyboardAndMouse has no extra binding Alt: a device's extras are the ones its schema declares",
				);
				expectEqual(
					reasons.get("Extras/Move/KeyboardAndMouse/Main"),
					"Main is the device's own binding, saved as Extras/Move/KeyboardAndMouse, not Extras/Move/KeyboardAndMouse/Main",
				);
				expectEqual(
					reasons.get("Extras/Jump/Gamepad/Alt"),
					"G is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys",
				);
				expectEqual(reasons.get("Extras/Jump/KeyboardAndMouse/Alt/More"), "unknown path");
				expectEqual(
					reasons.get("Extras/Move/Virtual/Alt"),
					"Virtual is not a device: a save holds the KeyboardAndMouse, Gamepad, Touch bindings",
				);
				expectEqual(input.Extras.Actions.Jump.Bindings.KeyboardAndMouse.Alt.Instance.KeyCode, K.J);
				expectEqual(input.Extras.Actions.Jump.Bindings.Gamepad.Alt.Instance.KeyCode, K.ButtonL1, "stays default");
			});

			test("saves: a 0.7.0 save without extras loads as before, the extras at their defaults; SanitizeBindings keeps an export", () => {
				const input = create(EXTRAS_SCHEMA);
				const { Move, Jump } = input.Extras.Actions;
				Move.Bindings.KeyboardAndMouse.Arrows.Set({ Down: K.Comma });
				const result = input.ImportBindings(
					encode({
						"Extras/Move/KeyboardAndMouse": { Up: "Eight" },
						"Extras/Jump/Gamepad": { KeyCode: "ButtonY" },
					}),
				);
				expectArrayEqual(result.Applied, ["Extras/Jump/Gamepad", "Extras/Move/KeyboardAndMouse"]);
				expectEqual(Move.Bindings.KeyboardAndMouse.Instance.Up, K.Eight);
				expectEqual(Jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonY);
				expectEqual(Move.Bindings.KeyboardAndMouse.Arrows.Instance.Down, K.Down, "reset: not in the save");
				expectEqual(Jump.Bindings.Gamepad.Alt.Instance.KeyCode, K.ButtonL1);
				// what the client exports, the server keeps, and the next session loads
				Move.Bindings.KeyboardAndMouse.Arrows.Set({ Up: K.I });
				Jump.Bindings.Touch.Second.Set(K.TouchPosition);
				const saved = input.ExportBindings();
				const clean = InputActions.SanitizeBindings(EXTRAS_SCHEMA, saved);
				expectEqual(canonical(clean), canonical(saved));
				const nextSession = create(EXTRAS_SCHEMA);
				expectEqual(nextSession.ImportBindings(clean).Skipped.size(), 0);
				expectEqual(nextSession.Extras.Actions.Move.Bindings.KeyboardAndMouse.Arrows.Instance.Up, K.I);
				expectEqual(nextSession.Extras.Actions.Jump.Bindings.Touch.Second.Instance.KeyCode, K.TouchPosition);
			});

			// ---- adoption

			test("adoption: a designer's <Action><Device><Extra> or <Device><Extra> binding is the extra's, and its keys the defaults", () => {
				const warnings = recordWarnings();
				const folder = newFolder();
				const context = new Instance("InputContext");
				context.Name = "Extras";
				const move = new Instance("InputAction");
				move.Name = "Move";
				move.Type = Enum.InputActionType.Direction2D;
				move.Parent = context;
				const arrows = new Instance("InputBinding");
				arrows.Name = "MoveKeyboardAndMouseArrows";
				arrows.Up = K.I;
				arrows.Down = K.K;
				arrows.Parent = move;
				const pad = new Instance("InputBinding");
				pad.Name = "GamepadDPad";
				pad.Up = K.ButtonY;
				pad.Parent = move;
				const undeclared = new Instance("InputBinding");
				undeclared.Name = "MoveKeyboardAndMouseNumpad";
				undeclared.Up = K.KeypadEight;
				undeclared.Parent = move;
				const jump = new Instance("InputAction");
				jump.Name = "Jump";
				jump.Parent = context;
				const wrong = new Instance("InputBinding");
				wrong.Name = "JumpKeyboardAndMouseAlt";
				wrong.KeyCode = K.ButtonB;
				wrong.Parent = jump;
				context.Parent = folder;

				const input = create(EXTRAS_SCHEMA, { Folder: folder });
				const keys = input.Extras.Actions.Move.Bindings.KeyboardAndMouse;
				expectEqual(keys.Arrows.Instance, arrows);
				expectEqual(arrows.Up, K.I, "what exists wins");
				expectEqual(keys.Arrows.Get().Left, undefined, "the designer's binding as it is");
				expectEqual(input.Extras.Actions.Move.Bindings.Gamepad.DPad.Instance, pad);
				expectEqual(input.Extras.Actions.Jump.Bindings.KeyboardAndMouse.Alt.Instance, wrong);
				expectEqual(wrong.KeyCode, K.ButtonB, "left as it is");
				keys.Arrows.Set({ Up: K.U });
				keys.Arrows.Reset();
				expectEqual(arrows.Up, K.I, "the designer's keys are the defaults");
				eventually(
					() =>
						warnings.some(
							(message) =>
								contains(message, "Extras/Jump/KeyboardAndMouse/Alt") &&
								contains(message, "ButtonB is a Gamepad key"),
						),
					"a warning naming the extra and the device",
				);
				eventually(
					() =>
						warnings.some(
							(message) =>
								contains(message, "MoveKeyboardAndMouseNumpad") && contains(message, "is not in the schema"),
						),
					"an undeclared extra is unmentioned",
				);
				frames(2);
				for (const name of ["MoveKeyboardAndMouseArrows", "GamepadDPad"]) {
					expectFalse(
						warnings.some((message) => contains(message, `.${name} `)),
						`no warning about ${name}: ${warnings.join(" | ")}`,
					);
				}
				// Destroy leaves adopted bindings, with their defaults back
				keys.Arrows.Set({ Up: K.U });
				input.Destroy();
				expectEqual(arrows.Parent, move);
				expectEqual(arrows.Up, K.I);
			});

			// ---- root handles on one folder (design spec §4)

			test("Create twice: an extra is the root handle's that declares it; the other's handle, saves and Destroy leave it alone", () => {
				const warnings = recordWarnings();
				const folder = newFolder();
				const withExtras = create(EXTRAS_SCHEMA, { Folder: folder });
				const plain = create(PLAIN_SCHEMA, { Folder: folder });
				const keys = withExtras.Extras.Actions.Move.Bindings.KeyboardAndMouse;
				const plainKeys = plain.Extras.Actions.Move.Bindings.KeyboardAndMouse;
				expectEqual(plainKeys.Instance, keys.Instance, "the main binding is shared");
				expectArrayEqual(namesOf(plainKeys.Extras()), []);
				expectEqual((plainKeys as unknown as Record<string, unknown>).Arrows, undefined);
				const arrows = keys.Arrows;
				arrows.Set({ Up: K.I });
				expectEqual(plain.ExportBindings(), '{"Version":1,"Bindings":{}}', "not the plain handle's");
				expectTrue(contains(withExtras.ExportBindings(), "Extras/Move/KeyboardAndMouse/Arrows"));
				const skipped = plain.ImportBindings(encode({ "Extras/Move/KeyboardAndMouse/Arrows": { Up: "U" } }));
				expectEqual(skipped.Skipped.size(), 1);
				expectTrue(contains(skipped.Skipped[0].Reason, "has no extra binding Arrows"), skipped.Skipped[0].Reason);
				plain.ResetBindings();
				expectEqual(arrows.Instance.Up, K.I, "untouched by the plain handle's import and reset");
				frames(2);
				expectFalse(
					warnings.some((message) => contains(message, "MoveKeyboardAndMouseArrows")),
					`no warning about another root handle's extra: ${warnings.join(" | ")}`,
				);
				// the extra goes with the root handle that made it; the other keeps working
				const instance = arrows.Instance;
				withExtras.Destroy();
				expectEqual(instance.Parent, undefined, "destroyed with its last user");
				expectEqual(plainKeys.Instance.Parent, plain.Extras.Actions.Move.Instance);
				plainKeys.Set({ Up: K.U });
				expectEqual(plainKeys.Instance.Up, K.U);

				// the other order: the later schema makes its extras, the earlier handle has none
				const other = newFolder();
				const first = create(PLAIN_SCHEMA, { Folder: other });
				const later = create(EXTRAS_SCHEMA, { Folder: other });
				const laterArrows = later.Extras.Actions.Move.Bindings.KeyboardAndMouse.Arrows;
				expectEqual(laterArrows.Instance.Parent, first.Extras.Actions.Move.Instance);
				expectArrayEqual(namesOf(first.Extras.Actions.Move.Bindings.KeyboardAndMouse.Extras()), []);
			});

			test("Create twice: schemas that declare the same extra share its binding, with the first one's defaults", () => {
				const folder = newFolder();
				const first = create(EXTRAS_SCHEMA, { Folder: folder });
				const second = create(SAME_EXTRA_SCHEMA, { Folder: folder });
				const arrows = first.Extras.Actions.Move.Bindings.KeyboardAndMouse.Arrows;
				const shared = second.Extras.Actions.Move.Bindings.KeyboardAndMouse.Arrows;
				expectEqual(shared.Instance, arrows.Instance);
				expectEqual(shared.Instance.Up, K.Up, "what exists wins");
				shared.Set({ Up: K.U });
				expectTrue(contains(canonical(first.ExportBindings()), "Extras/Move/KeyboardAndMouse/Arrows: Up=U"));
				second.ResetBindings();
				expectEqual(arrows.Instance.Up, K.Up, "the shared defaults");
				const instance = arrows.Instance;
				first.Destroy();
				expectEqual(instance.Parent, second.Extras.Actions.Move.Instance, "the other root handle uses it");
				shared.Set({ Up: K.I });
				expectEqual(instance.Up, K.I);
			});

			test("a later schema's namespace fills a device the first left out: Main fills it, the extras are made", () => {
				const folder = newFolder();
				const first = create(KEYS_LEFT_OUT, { Folder: folder });
				const keys = first.ExtrasFill.Actions.Jump.Bindings.KeyboardAndMouse;
				expectEqual(keys.Instance.KeyCode, K.None);
				const second = create(KEYS_NAMESPACE, { Folder: folder });
				expectEqual(second.ExtrasFill.Actions.Jump.Bindings.KeyboardAndMouse.Instance, keys.Instance);
				expectEqual(keys.Instance.KeyCode, K.J, "Main fills the unbound binding");
				expectEqual(second.ExtrasFill.Actions.Jump.Bindings.KeyboardAndMouse.Alt.Instance.KeyCode, K.K);
				expectArrayEqual(namesOf(keys.Extras()), [], "the first handle has no extras");
				keys.Clear();
				keys.Reset();
				expectEqual(keys.Instance.KeyCode, K.J, "the shared defaults");

				// `Main: {}` is the schema's binding, with no keys: it fills nothing, and a later one
				// that names the device finds it there (what exists wins)
				const other = newFolder();
				const leftOut = create(KEYS_LEFT_OUT, { Folder: other });
				create(KEYS_UNBOUND_MAIN, { Folder: other });
				const direct = create(KEYS_DIRECT, { Folder: other });
				const binding = leftOut.ExtrasFill.Actions.Jump.Bindings.KeyboardAndMouse.Instance;
				expectEqual(direct.ExtrasFill.Actions.Jump.Bindings.KeyboardAndMouse.Instance, binding);
				expectEqual(binding.KeyCode, K.None);
			});

			test("a Create that adds an extra to a held action releases it, as any binding added does", () => {
				const folder = newFolder();
				const first = create(PLAIN_SCHEMA, { Folder: folder });
				const jump = first.Extras.Actions.Jump;
				const released = countSignal(jump.Released);
				jump.Fire(true);
				expectTrue(jump.IsPressed());
				create(EXTRAS_SCHEMA, { Folder: folder });
				eventually(() => !jump.IsPressed(), "released");
				eventually(() => released.count === 1, `one Released (${released.count})`);
				frames(3);
				expectEqual(released.count, 1, "once");
				// the package forgot the value it fired: a Fire(true) presses again
				jump.Fire(true);
				eventually(() => jump.IsPressed(), "pressed again");
				jump.Fire(false);
			});

			// ---- Server Authority (design spec §8), on a copy made by hand under the player

			test("the swap moves the extras onto the server's copy, with their rebinds and defaults", () => {
				const copy = handMadeCopy(
					[
						["Jump", Enum.InputActionType.Bool],
						["Move", Enum.InputActionType.Direction2D],
					],
					false,
				);
				const input = create(SA_EXTRAS, { PlayerFolderName: copy.folder.Name, Timeout: 1000 });
				const context = input.ExtrasSwap;
				expectFalse(context.IsLinkedToServer());
				const jump = context.Actions.Jump;
				const alt = jump.Bindings.KeyboardAndMouse.Alt;
				const arrows = context.Actions.Move.Bindings.KeyboardAndMouse.Arrows;
				alt.Set(K.G);
				arrows.Set({ Up: K.I });
				const standIn = alt.Instance.Parent;
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => context.IsLinkedToServer(), "linked");
				const target = copy.actions.get("Jump")!;
				expectEqual(jump.Instance, target);
				expectTrue(standIn !== target);
				expectEqual(alt.Instance.Parent, target, "the extra is under the copy's action");
				expectEqual(alt.Instance.Name, "JumpKeyboardAndMouseAlt");
				expectEqual(alt.Instance.KeyCode, K.G, "with its rebind");
				expectEqual(jump.Bindings.Gamepad.Alt.Instance.Parent, target);
				expectEqual(jump.Bindings.Gamepad.Alt.Instance.KeyCode, K.ButtonL1);
				expectEqual(arrows.Instance.Parent, copy.actions.get("Move"));
				expectEqual(arrows.Instance.Up, K.I);
				expectEqual(jump.Bindings.KeyboardAndMouse.Extras().Alt, alt);
				expectArrayEqual(bindingNames(target), [
					"JumpGamepad",
					"JumpGamepadAlt",
					"JumpKeyboardAndMouse",
					"JumpKeyboardAndMouseAlt",
					"JumpTouch",
				]);
				expectEqual(
					canonical(input.ExportBindings()),
					"ExtrasSwap/Jump/KeyboardAndMouse/Alt: KeyCode=G; ExtrasSwap/Move/KeyboardAndMouse/Arrows: Up=I",
				);
				alt.Reset();
				expectEqual(alt.Instance.KeyCode, K.None, "the same defaults");
			});

			test("the swap onto a copy another root handle uses: the extras are the waiting handle's own", () => {
				const copy = handMadeCopy([["Jump", Enum.InputActionType.Bool]], true);
				const options = { PlayerFolderName: copy.folder.Name, Timeout: 1000 };
				const onCopy = create(SA_PLAIN, options);
				expectTrue(onCopy.ExtrasSwap.IsLinkedToServer(), "linked at Create");
				const waiting = create(SA_EXTRAS_DUCK, options);
				expectFalse(waiting.ExtrasSwap.IsLinkedToServer(), "the copy lacks Duck");
				const alt = waiting.ExtrasSwap.Actions.Jump.Bindings.KeyboardAndMouse.Alt;
				alt.Set(K.G);
				const duck = new Instance("InputAction");
				duck.Name = "Duck";
				duck.Parent = copy.context;
				eventually(() => waiting.ExtrasSwap.IsLinkedToServer(), "the swap once Duck is there");
				const target = copy.actions.get("Jump")!;
				const keys = onCopy.ExtrasSwap.Actions.Jump.Bindings.KeyboardAndMouse;
				expectEqual(waiting.ExtrasSwap.Actions.Jump.Bindings.KeyboardAndMouse.Instance, keys.Instance);
				expectEqual(alt.Instance.Parent, target);
				expectEqual(alt.Instance.KeyCode, K.G, "its rebind");
				expectArrayEqual(namesOf(keys.Extras()), []);
				expectEqual(onCopy.ExportBindings(), '{"Version":1,"Bindings":{}}');
				expectEqual(canonical(waiting.ExportBindings()), "ExtrasSwap/Jump/KeyboardAndMouse/Alt: KeyCode=G");
				alt.Reset();
				expectEqual(alt.Instance.KeyCode, K.K, "its schema's key");
				// it goes with the waiting root handle
				const instance = alt.Instance;
				waiting.Destroy();
				expectEqual(instance.Parent, undefined);
				expectEqual(keys.Instance.Parent, target);
			});
		});
	}
}
