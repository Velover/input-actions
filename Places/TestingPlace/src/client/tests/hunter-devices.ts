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
import { HttpService, Players, UserInputService } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";
import { createTestInput, frames, newFolder, recordSignal, recordWarnings } from "./helpers";
import { emptyPoint, RealInput, realInput } from "./virtual";
import { VirtualPad, virtualPad } from "./virtual-pad";

const K = Enum.KeyCode;
const EMPTY_SAVE = '{"Version":1,"Bindings":{}}';

/** `Create`, destroyed after the test */
function create<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
	options: InputActions.CreateOptions,
): InputActions.Handle<S> {
	const input = InputActions.Create(schema, options);
	defer(() => input.Destroy());
	return input;
}

function contains(text: string, part: string) {
	return text.find(part, 1, true)[0] !== undefined;
}

function keysOf(record: object) {
	const keys = new Array<string>();
	for (const [key] of pairs(record as Record<string, unknown>)) keys.push(key as string);
	keys.sort();
	return keys;
}

/** Calls Set past the types, to reach the runtime checks */
function untypedSet(handle: object, spec: unknown) {
	(handle as { Set(spec: unknown): void }).Set(spec);
}

function encode(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

function reasonsOf(result: InputActions.ImportResult) {
	const reasons = new Map<string, string>();
	for (const skipped of result.Skipped) reasons.set(skipped.Path, skipped.Reason);
	return reasons;
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

/** A few frames in which nothing may arrive */
function quiet() {
	frames(6);
}

/**
 * Whether VirtualInput can send `key` here and UserInputService sees it down: the reason it can't,
 * or undefined. Some KeyCodes throw (reserved by CoreGui), others may never arrive
 */
function sendable(real: RealInput, key: Enum.KeyCode): string | undefined {
	const [ok, problem] = pcall(() => real.Press(key));
	if (!ok) return `VirtualInput can't send ${key.Name}: ${problem}`;
	const deadline = os.clock() + 1;
	while (!UserInputService.IsKeyDown(key) && os.clock() < deadline) frames(1);
	const down = UserInputService.IsKeyDown(key);
	real.Release(key);
	frames(3);
	return down ? undefined : `VirtualInput's ${key.Name} never shows as down`;
}

// ---- fixtures

/** Fire bound on the keyboard only: its Gamepad binding is made unbound */
const HD_FILL_LEFT_OUT = InputActions.Schema({
	HdFill: { Actions: { Fire: InputActions.Bool({ KeyboardAndMouse: K.J }) } },
});
/** The same action with a tuned Gamepad binding: a later Create with it fills the unbound one */
const HD_FILL_TUNED = InputActions.Schema({
	HdFill: {
		Actions: {
			Fire: InputActions.Bool({
				KeyboardAndMouse: K.J,
				Gamepad: { KeyCode: K.ButtonR2, PressedThreshold: 0.3 },
			}),
		},
	},
});
/** Jump on the keyboard only, and Touch too in the second schema */
const HD_TOUCH_LEFT_OUT = InputActions.Schema({
	HdTouch: { Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) } },
});
const HD_TOUCH_NAMED = InputActions.Schema({
	HdTouch: {
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: K.J,
				Gamepad: K.ButtonA,
				Touch: K.TouchPosition,
			}),
		},
	},
});
type AnySchema = InputActions.InputSchema<Record<string, InputActions.ContextSchema>>;

/** The action `Zap` the failed-Create test's folder holds as a Bool, and its schema as a Direction1D */
const HD_CONFLICT = "Zap";

/**
 * The failed-Create test's two schemas, on an action named `fill`. The first binds it on the keyboard
 * only (its Gamepad binding is made unbound); the second names its Gamepad binding (a fill of that
 * unbound one) and an action `Zap` that the folder holds with another Type, so its `Create` throws.
 * The name is picked so that `Create` builds `fill` first: it builds the actions in `pairs` order,
 * the order of the frozen table, read here the same way (with two keys, Luau puts one of them first
 * by its hash alone)
 */
function failingSchemas(): [AnySchema, AnySchema, string] | undefined {
	for (let index = 1; index <= 60; index++) {
		const fill = `Hop${index}`;
		const actions: Record<string, unknown> = {};
		actions[fill] = InputActions.Bool({ KeyboardAndMouse: K.J, Gamepad: K.ButtonA });
		actions[HD_CONFLICT] = InputActions.Direction1D();
		const second = InputActions.Schema({
			HdFail: { Actions: actions },
		} as never) as unknown as AnySchema;
		let first: string | undefined;
		for (const [name] of pairs(second.Contexts.HdFail.Actions)) {
			first = name as string;
			break;
		}
		if (first !== fill) continue;
		const firstActions: Record<string, unknown> = {};
		firstActions[fill] = InputActions.Bool({ KeyboardAndMouse: K.J });
		const firstSchema = InputActions.Schema({
			HdFail: { Actions: firstActions },
		} as never) as unknown as AnySchema;
		return [firstSchema, second, fill];
	}
	return undefined;
}

/** The root handle already on the copy: Jump on both devices */
const HD_JOIN_ON_COPY = InputActions.Schema({
	HdJoin: {
		ServerAuthority: true,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Gamepad: K.ButtonA }) },
	},
});
/** The root handle waiting on a stand-in: Jump on the keyboard only, and Duck, which the copy lacks */
const HD_JOIN_WAITING = InputActions.Schema({
	HdJoin: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.K }),
		},
	},
});

let copyCount = 0;

/**
 * A copy of a context built by hand under a player folder no server provides, as the server's would
 * be (enabled), parented to the player; gone after the test
 */
function handMadeCopy(contextName: string, actions: string[]) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `HunterDevicesCopy${copyCount}`;
	const context = new Instance("InputContext");
	context.Name = contextName;
	for (const name of actions) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Type = Enum.InputActionType.Bool;
		action.Parent = context;
	}
	context.Parent = folder;
	folder.Parent = Players.LocalPlayer;
	defer(() => folder.Destroy());
	return { folder, context };
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

/** A Manager-shaped folder: Gameplay/Jump with a binding per device, and one named after MicroGamepad */
function managerFolder() {
	const folder = newFolder();
	const context = new Instance("InputContext");
	context.Name = "Gameplay";
	const jump = new Instance("InputAction");
	jump.Name = "Jump";
	jump.Parent = context;
	const made = new Map<string, InputBinding>();
	for (const [name, key] of [
		["JumpKeyboardAndMouse", K.Space],
		["JumpGamepad", K.ButtonA],
		["JumpTouch", K.TouchPosition],
		["JumpMicroGamepad", K.ButtonCenter],
	] as const) {
		const binding = new Instance("InputBinding");
		binding.Name = name;
		binding.KeyCode = key;
		binding.Parent = jump;
		made.set(name, binding);
	}
	context.Parent = folder;
	return { folder, made };
}

/** The virtual pad for a test that presses it, plugged in; or why there is none (the test skips) */
function pluggedPad(): VirtualPad | string {
	const pad = virtualPad();
	if (typeIs(pad, "string")) return pad;
	if (pad.Connect() === undefined) return "Roblox never listed the virtual pad";
	frames(3);
	return pad;
}

/**
 * Hunt on device bindings (0.7.0, design spec §3, §4, §6, §7): device keys at runtime, the fill rule,
 * saves by device, device-locked captures with VirtualInput's gamepad KeyCodes
 */
@Provider({ activeIn: ["testing"] })
export class HunterDevicesTests implements OnStart {
	onStart() {
		defineTests("hunter-devices", () => {
			// ---- the fill rule (§4)

			// HD-1 (hunter, fixed: FillPlaceholder stores what the binding as it was made would read with the later schema's values, written onto a scratch binding): a later schema that filled an unbound binding the player rebound meanwhile stored its own spec, unread, as the shared defaults: a float the binding can't hold exactly (PressedThreshold 0.3) then differed from what the binding reads after Reset, and ExportBindings saved it
			test("a later schema fills an unbound binding the player rebound: after Reset the export is empty", () => {
				// control: the unbound binding untouched, the fill writes it and reads the defaults back
				const control = newFolder();
				const untouched = create(HD_FILL_LEFT_OUT, { Folder: control });
				create(HD_FILL_TUNED, { Folder: control });
				const controlPad = untouched.HdFill.Actions.Fire.Bindings.Gamepad;
				expectEqual(controlPad.Instance.KeyCode, K.ButtonR2, "control: filled");
				controlPad.Reset();
				expectEqual(untouched.ExportBindings(), EMPTY_SAVE, "control: filled, then Reset");

				const folder = newFolder();
				const first = create(HD_FILL_LEFT_OUT, { Folder: folder });
				const pad = first.HdFill.Actions.Fire.Bindings.Gamepad;
				pad.Set(K.ButtonX);
				const second = create(HD_FILL_TUNED, { Folder: folder });
				expectEqual(pad.Instance.KeyCode, K.ButtonX, "the player's rebind stays (§4)");
				pad.Reset();
				expectEqual(pad.Instance.KeyCode, K.ButtonR2, "Reset gives the later schema's key");
				expectEqual(
					first.ExportBindings(),
					EMPTY_SAVE,
					`design spec §4: the later schema's binding becomes the shared defaults, "so the earlier handle's Reset and export follow"; §7: "ExportBindings() returns only what differs from the defaults snapshot". Right after Reset the binding is its defaults, yet the first root handle exports ${first.ExportBindings()} and the second ${second.ExportBindings()} (PressedThreshold reads ${pad.Instance.PressedThreshold}; the same steps without the rebind export nothing)`,
				);
				second.ResetBindings();
				expectEqual(
					second.ExportBindings(),
					EMPTY_SAVE,
					"the second root handle after ResetBindings",
				);
			});

			// HD-2 (hunter, fixed: Create checks every name and every existing action's Type before it changes anything, `CheckBuild`): a Create that threw (an action of another Type, after it had filled an earlier root handle's unbound binding) left the fill behind: the earlier handle's binding kept the failed schema's key, and its Reset returned to it
			test("a Create that throws leaves nothing behind: not the unbound binding it filled", () => {
				const found = failingSchemas();
				if (found === undefined) return skip("no action name comes before Zap in pairs order");
				const [firstSchema, schema, fill] = found;
				const folder = newFolder();
				const first = create(firstSchema, { Folder: folder });
				const designer = new Instance("InputAction");
				designer.Name = HD_CONFLICT;
				designer.Type = Enum.InputActionType.Bool;
				designer.Parent = folder.FindFirstChild("HdFail");
				const pad = (
					first.HdFail.Actions as unknown as Record<
						string,
						{ Bindings: { Gamepad: { Instance: InputBinding; Reset(): void } } }
					>
				)[fill].Bindings.Gamepad;
				expectEqual(pad.Instance.KeyCode, K.None, "unbound: the first schema leaves Gamepad out");
				const message = expectThrows(() => InputActions.Create(schema, { Folder: folder }));
				expectTrue(contains(message, HD_CONFLICT), message);
				const after = pad.Instance.KeyCode;
				pad.Reset();
				expectEqual(
					`${after.Name}; after Reset ${pad.Instance.KeyCode.Name}; export ${first.ExportBindings()}`,
					`None; after Reset None; export ${EMPTY_SAVE}`,
					`Advanced.md (Get-or-create in detail): "a Create that throws leaves the folder as it was: it fills no unbound binding and releases no held action". The failed Create (${message}) filled the first root handle's unbound Gamepad binding on its way, and the fill stays: the key after the throw, after the first handle's Reset, and its export`,
				);
				// the binding is still unbound for a device its schema left out: a Create that succeeds fills it
				designer.Destroy();
				create(schema, { Folder: folder });
				expectEqual(pad.Instance.KeyCode, K.ButtonA, "filled by the Create that succeeds");
				expectEqual(first.ExportBindings(), EMPTY_SAVE, "the filled key is a default");
			});

			// HD-5 (hunter): a stand-in's unbound device binding (its schema left the device out) that the player rebound adopts at the swap the binding another root handle made on the copy, and its defaults: a rebind equal to them drops out of the stand-in handle's export, and a later session without the other schema loads Jump with no gamepad key.
			// DISPUTED HD-5, worker: every handle on a binding shares one defaults table, the first handle's snapshot (design spec §4), and the swap's adopted binding keeps it (§8). A stand-in's change to a value those defaults hold already is then a default, as when a later schema fills an unbound binding the player rebound (§4: "the earlier handle's Reset and export follow"; that loses the same key in a session without the later schema). An export base of its own per root handle would have Reset then ExportBindings save the key again (what HD-1 fixed) and give two root handles on one binding two answers. Documented as a limit (§8, Advanced.md, Server Authority); the test checks it, and that any other rebind reads the same after the swap
			test("the swap onto a copy's binding: a rebind to the adopted defaults becomes a default, any other reads the same", () => {
				/** A stand-in whose schema leaves Gamepad out, given `key` there, then swapped onto a copy another root handle is on */
				const swapped = (key: Enum.KeyCode.ButtonA | Enum.KeyCode.ButtonX) => {
					const copy = handMadeCopy("HdJoin", ["Jump"]);
					const onCopy = create(HD_JOIN_ON_COPY, swapOptions(copy.folder.Name));
					expectTrue(onCopy.HdJoin.IsLinkedToServer(), "linked at Create");
					const waiting = create(HD_JOIN_WAITING, swapOptions(copy.folder.Name));
					expectFalse(waiting.HdJoin.IsLinkedToServer(), "the copy lacks Duck");
					const pad = waiting.HdJoin.Actions.Jump.Bindings.Gamepad;
					expectEqual(pad.Instance.KeyCode, K.None, "the waiting schema leaves Gamepad out");
					// the player gives the stand-in's Jump a gamepad key (by Set, a capture or an import)
					pad.Set(key);
					const before = waiting.ExportBindings();
					expectTrue(contains(before, "HdJoin/Jump/Gamepad"), before);
					const duck = new Instance("InputAction");
					duck.Name = "Duck";
					duck.Parent = copy.context;
					eventually(() => waiting.HdJoin.IsLinkedToServer(), "the swap once Duck is there");
					expectEqual(
						pad.Instance,
						onCopy.HdJoin.Actions.Jump.Bindings.Gamepad.Instance,
						"adopted",
					);
					expectEqual(pad.Instance.KeyCode, key, "the rebind is carried over");
					return { waiting, onCopy, pad, before };
				};

				const same = swapped(K.ButtonA);
				expectEqual(
					same.waiting.ExportBindings(),
					EMPTY_SAVE,
					`ButtonA is the adopted binding's default now (exported ${same.before} before the swap)`,
				);
				same.pad.Reset();
				expectEqual(same.pad.Instance.KeyCode, K.ButtonA, "Reset: the shared defaults");

				const other = swapped(K.ButtonX);
				expectEqual(
					other.waiting.ExportBindings(),
					other.before,
					"any other rebind reads the same",
				);
				expectEqual(
					other.onCopy.ExportBindings(),
					other.before,
					"and the other root handle shares it",
				);
				other.pad.Reset();
				expectEqual(other.pad.Instance.KeyCode, K.ButtonA, "Reset: the shared defaults");
				expectEqual(other.waiting.ExportBindings(), EMPTY_SAVE);
			});

			// worker, features hunt round 3 (HF3-5): the earlier root handle's BindingsChanged fires for the fill now, with its own path (it didn't, and a hint refreshed on it stayed stale); the later one's still doesn't
			test("the fill: the earlier root handle hears BindingsChanged for each binding filled, and its handles show the keys", () => {
				const folder = newFolder();
				const first = create(HD_TOUCH_LEFT_OUT, { Folder: folder });
				const changes = recordSignal(first.BindingsChanged);
				const jump = first.HdTouch.Actions.Jump;
				expectArrayEqual(keysOf(jump.Bindings.Touch.Get()), []);
				const second = create(HD_TOUCH_NAMED, { Folder: folder });
				const secondChanges = recordSignal(second.BindingsChanged);
				expectEqual(jump.Bindings.Touch.Get().KeyCode, K.TouchPosition, "the Touch binding filled");
				expectEqual(jump.Bindings.Gamepad.Get().KeyCode, K.ButtonA, "the Gamepad binding filled");
				frames(4);
				const heard = [...changes];
				heard.sort();
				expectArrayEqual(
					heard,
					["HdTouch/Jump/Gamepad", "HdTouch/Jump/Touch"],
					'design spec §4: "The earlier root handle\'s BindingsChanged fires for it, with its own path, once the later Create\'s build is over"',
				);
				expectEqual(secondChanges.size(), 0, "not the later one's");
				expectEqual(first.ExportBindings(), EMPTY_SAVE);
				jump.Bindings.Touch.Clear();
				jump.Bindings.Touch.Reset();
				expectEqual(
					jump.Bindings.Touch.Instance.KeyCode,
					K.TouchPosition,
					"Reset: the filled defaults",
				);
			});

			// ---- keys per device at runtime (§3)

			test("Set takes every device's keys from the tables: TV remote, trackpad, touch, Enum.KeyCode.Touch", () => {
				const actions = createTestInput().Gameplay.Actions;
				const pad = actions.Jump.Bindings.Gamepad;
				for (const key of [
					K.ButtonCenter,
					K.ButtonBack,
					K.ButtonUp,
					K.ButtonDown,
					K.ButtonLeft,
					K.ButtonRight,
					K.ButtonSelect,
					K.DPadLeft,
					K.ButtonL2,
					K.ButtonL3,
					K.Thumbstick2Left,
				]) {
					pad.Set(key);
					expectEqual(pad.Instance.KeyCode, key);
				}
				pad.Set({
					KeyCode: K.ButtonRight,
					PrimaryModifier: K.ButtonBack,
					SecondaryModifier: K.DPadUp,
				});
				expectEqual(pad.Instance.SecondaryModifier, K.DPadUp);
				actions.Jump.Bindings.KeyboardAndMouse.Set(K.MouseRightButton);
				actions.Jump.Bindings.KeyboardAndMouse.Set({
					KeyCode: K.KeypadEnter,
					PrimaryModifier: K.RightAlt,
				});
				actions.Jump.Bindings.Touch.Set(Enum.KeyCode.Touch);
				expectEqual(actions.Jump.Bindings.Touch.Instance.KeyCode, K.TouchPosition);
				actions.Zoom.Bindings.KeyboardAndMouse.Set(K.TrackpadPinch);
				actions.Zoom.Bindings.Touch.Set(K.TouchPinch);
				actions.Zoom.Bindings.Gamepad.Set({ Up: K.ButtonR2, Down: K.Thumbstick1Down });
				actions.Look.Bindings.KeyboardAndMouse.Set(K.TrackpadPan);
				actions.Look.Bindings.Touch.Set({
					KeyCode: K.TouchDelta,
					Vector2Scale: new Vector2(1, -1),
				});
				actions.Aim.Bindings.Touch.Set(K.TouchPosition);
				actions.Fly.Bindings.Gamepad.Set({ Forward: K.ButtonCenter, Backward: K.ButtonBack });
				expectEqual(actions.Fly.Bindings.Gamepad.Instance.Forward, K.ButtonCenter);
			});

			test("Set refuses: a reserved gamepad key, axis and mouse-button modifiers, another device's modifier", () => {
				const actions = createTestInput().Gameplay.Actions;
				const start = expectThrows(() => untypedSet(actions.Jump.Bindings.Gamepad, K.ButtonStart));
				expectTrue(contains(start, "ButtonStart"), start);
				const trigger = expectThrows(() =>
					untypedSet(actions.Zoom.Bindings.Gamepad, { Up: K.ButtonA, PrimaryModifier: K.ButtonR2 }),
				);
				expectTrue(contains(trigger, "ButtonR2 is not allowed in PrimaryModifier"), trigger);
				expectThrows(() =>
					untypedSet(actions.Jump.Bindings.KeyboardAndMouse, {
						KeyCode: K.E,
						PrimaryModifier: K.MouseRightButton,
					}),
				);
				const touch = expectThrows(() =>
					untypedSet(actions.Jump.Bindings.Touch, {
						KeyCode: K.TouchPosition,
						PrimaryModifier: K.E,
					}),
				);
				// touch has no key a modifier takes: said so (features loop, round 1), not which keys it takes
				expectTrue(
					contains(
						touch,
						"E is a KeyboardAndMouse key, and no Touch key goes in PrimaryModifier on a Bool action",
					),
					touch,
				);
				const remote = expectThrows(() =>
					untypedSet(actions.Jump.Bindings.KeyboardAndMouse, K.ButtonCenter),
				);
				expectTrue(contains(remote, "ButtonCenter is a Gamepad key"), remote);
				expectThrows(() => untypedSet(actions.Fly.Bindings.Touch, { Up: K.TouchPosition }));
				expectThrows(() => untypedSet(actions.Look.Bindings.Gamepad, K.TrackpadPan));
				expectEqual(actions.Jump.Bindings.Touch.Instance.KeyCode, K.None, "unchanged");
			});

			test("every unbound device binding reads {} whatever the action type", () => {
				const actions = createTestInput().Gameplay.Actions;
				const unbound: Array<
					[string, InputActions.BindingHandle<Enum.InputActionType, InputActions.Device>]
				> = [
					["Zoom/Touch", actions.Zoom.Bindings.Touch],
					["Look/Touch", actions.Look.Bindings.Touch],
					["Move/Touch", actions.Move.Bindings.Touch],
					["Aim/Gamepad", actions.Aim.Bindings.Gamepad],
					["Aim/Touch", actions.Aim.Bindings.Touch],
					["Fly/Gamepad", actions.Fly.Bindings.Gamepad],
					["Fly/Touch", actions.Fly.Bindings.Touch],
					["Steer/KeyboardAndMouse", actions.Steer.Bindings.KeyboardAndMouse],
				];
				for (const [name, binding] of unbound) {
					expectArrayEqual(keysOf(binding.Get()), [], `${name}: Get() of an unbound binding`);
				}
			});

			// ---- saves by device (§7)

			test("import reasons by device: a Scriptable slot, another device's modifier, a position on the gamepad", () => {
				const input = createTestInput();
				const result = input.ImportBindings(
					encode({
						"Gameplay/Move/Virtual": { KeyCode: "Thumbstick1" },
						"Gameplay/Jump/Touch": { KeyCode: "TouchPosition" },
						"Gameplay/Zoom/Touch": { KeyCode: "TouchPinch", PrimaryModifier: "E" },
						"Gameplay/Aim/Gamepad": { KeyCode: "MousePosition" },
						"Gameplay/Fly/Touch": { Scale: 2 },
					}),
				);
				expectArrayEqual(result.Applied, ["Gameplay/Fly/Touch", "Gameplay/Jump/Touch"]);
				const reasons = reasonsOf(result);
				expectEqual(
					reasons.get("Gameplay/Move/Virtual"),
					"Virtual is not a device: a save holds the KeyboardAndMouse, Gamepad, Touch bindings",
				);
				// a device with no key for the slot says so (features loop, round 1), not which keys it takes
				expectEqual(
					reasons.get("Gameplay/Zoom/Touch"),
					"E is a KeyboardAndMouse key, and no Touch key goes in PrimaryModifier on a Direction1D action",
				);
				expectEqual(
					reasons.get("Gameplay/Aim/Gamepad"),
					"MousePosition is a KeyboardAndMouse key, and no Gamepad key goes in KeyCode on a ViewportPosition action",
				);
				expectEqual(input.Gameplay.Actions.Jump.Bindings.Touch.Instance.KeyCode, K.TouchPosition);
				// a context handle's import names the other context's paths so
				const own = input.Gameplay.ImportBindings(
					encode({ "Menu/Open/Gamepad": { KeyCode: "ButtonX" } }),
				);
				expectEqual(reasonsOf(own).get("Menu/Open/Gamepad"), "not a binding of Gameplay");
			});

			test("SanitizeBindings keeps the device bindings the schema leaves out, and drops other devices' keys", () => {
				const clean = HttpService.JSONDecode(
					InputActions.SanitizeBindings(
						TEST_SCHEMA,
						encode({
							"Gameplay/Dash/Gamepad": { KeyCode: "ButtonX" },
							"Gameplay/Aim/Touch": { KeyCode: "TouchPosition" },
							"Gameplay/Fly/Touch": { Scale: 2 },
							"Gameplay/Aim/Gamepad": { KeyCode: "MousePosition" },
							"Gameplay/Dash/Touch": { KeyCode: "MouseLeftButton" },
							"Gameplay/Move/Virtual": { KeyCode: "Thumbstick1" },
							"Gameplay/Look/Mouse": { Scale: 0.5 },
							"Gameplay/Dash/MicroGamepad": { KeyCode: "ButtonCenter" },
						}),
					),
				) as { Bindings: Record<string, unknown> };
				expectArrayEqual(keysOf(clean.Bindings), [
					"Gameplay/Aim/Touch",
					"Gameplay/Dash/Gamepad",
					"Gameplay/Fly/Touch",
				]);
			});

			// ---- adopted Manager trees (§4)

			test("a Manager tree: every device's binding adopted, a binding named after MicroGamepad warned as an extra", () => {
				const warnings = recordWarnings();
				const { folder, made } = managerFolder();
				const input = createTestInput(folder);
				const jump = input.Gameplay.Actions.Jump;
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance, made.get("JumpKeyboardAndMouse"));
				expectEqual(jump.Bindings.Gamepad.Instance, made.get("JumpGamepad"));
				expectEqual(jump.Bindings.Touch.Instance, made.get("JumpTouch"));
				eventually(
					() => warnings.some((message) => contains(message, "JumpMicroGamepad")),
					"a warning naming JumpMicroGamepad",
				);
				const about = (name: string) => warnings.filter((message) => contains(message, `.${name}`));
				for (const name of ["JumpKeyboardAndMouse", "JumpGamepad", "JumpTouch"]) {
					expectEqual(about(name).size(), 0, `${name}: ${about(name).join(" | ")}`);
				}
				expectEqual(input.ExportBindings(), EMPTY_SAVE);
			});

			test("the UiNavigation preset: valid keys per device, no warnings, its Touch bindings unbound", () => {
				const warnings = recordWarnings();
				const input = create(
					InputActions.Schema({ HdUi: InputActions.Presets.UiNavigation({ Enabled: false }) }),
					{ Folder: newFolder() },
				);
				const actions = input.HdUi.Actions;
				frames(2);
				const mine = warnings.filter((message) => contains(message, "HdUi"));
				expectEqual(mine.size(), 0, mine.join(" | "));
				expectEqual(actions.Scroll.Bindings.KeyboardAndMouse.Get().KeyCode, K.MouseWheel);
				expectEqual(actions.Scroll.Bindings.Gamepad.Get().Up, K.Thumbstick2Up);
				expectEqual(actions.Navigate.Bindings.Gamepad.Get().Left, K.DPadLeft);
				expectEqual(actions.Accept.Bindings.Gamepad.Get().KeyCode, K.ButtonA);
				for (const [name, action] of pairs(
					actions as unknown as Record<string, { Bindings: { Touch: { Get(): object } } }>,
				)) {
					expectArrayEqual(keysOf(action.Bindings.Touch.Get()), [], `${name}/Touch`);
				}
				expectEqual(input.ExportBindings(), EMPTY_SAVE);
			});

			// ---- device-locked captures with VirtualInput's gamepad KeyCodes (§6)

			test("the Gamepad binding's modifier Capture: a trigger and a keyboard key ignored, ButtonL1 taken", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const pad = input.Gameplay.Actions.Jump.Bindings.Gamepad;
				const captured = new Array<Enum.KeyCode>();
				const stop = pad.Capture("PrimaryModifier", (key) => captured.push(key ?? K.Unknown));
				defer(stop);
				real.Tap(K.ButtonL2);
				real.Tap(K.G);
				quiet();
				expectEqual(captured.size(), 0, `a trigger and a keyboard key${real.FocusNote()}`);
				real.Tap(K.ButtonL1);
				eventually(() => captured.size() === 1, `ButtonL1${real.FocusNote()}`);
				expectEqual(captured[0], K.ButtonL1);
				expectEqual(pad.Instance.PrimaryModifier, K.ButtonL1);
				expectEqual(pad.Instance.KeyCode, K.ButtonA, "the key stays");
			});

			test("the keyboard's modifier Capture: a gamepad button and a click ignored, RightControl taken", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const keys = input.Gameplay.Actions.QuickSave.Bindings.KeyboardAndMouse;
				const captured = new Array<Enum.KeyCode>();
				const stop = keys.Capture("SecondaryModifier", (key) => captured.push(key ?? K.Unknown));
				defer(stop);
				real.Tap(K.ButtonL1);
				real.Click(emptyPoint());
				quiet();
				expectEqual(captured.size(), 0, `a gamepad button and a click${real.FocusNote()}`);
				real.Tap(K.RightControl);
				eventually(() => captured.size() === 1, `RightControl${real.FocusNote()}`);
				expectEqual(keys.Instance.SecondaryModifier, K.RightControl);
				expectEqual(keys.Instance.PrimaryModifier, K.LeftControl, "the other modifier stays");
			});

			test("a stick's direction sent as a key: a Gamepad Direction2D KeyCode takes the whole stick", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const problem = sendable(real, K.Thumbstick2Left);
				if (problem !== undefined) return skip(problem);
				const move = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Move;
				const captured = new Array<Enum.KeyCode>();
				const stop = move.Bindings.Gamepad.Capture("KeyCode", (key) =>
					captured.push(key ?? K.Unknown),
				);
				defer(stop);
				real.Tap(K.ButtonX);
				quiet();
				expectEqual(captured.size(), 0, `a button is no stick${real.FocusNote()}`);
				real.Tap(K.Thumbstick2Left);
				eventually(() => captured.size() === 1, `Thumbstick2Left${real.FocusNote()}`);
				expectEqual(captured[0], K.Thumbstick2);
				expectEqual(move.Bindings.Gamepad.Instance.KeyCode, K.Thumbstick2, "it was Thumbstick1");
			});

			test("action.Capture on a Direction1D whose Gamepad binding is a composite: a gamepad button replaces it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const zoom = input.Gameplay.Actions.Zoom;
				const changes = recordSignal(input.BindingsChanged);
				const captured = new Array<string>();
				const stop = zoom.Capture((key, device) =>
					captured.push(`${key?.Name ?? "cancelled"} on ${device}`),
				);
				defer(stop);
				real.Tap(K.ButtonX);
				eventually(() => captured.size() === 1, `ButtonX${real.FocusNote()}`);
				expectEqual(captured[0], "ButtonX on Gamepad");
				const pad = zoom.Bindings.Gamepad.Instance;
				expectEqual(`${pad.KeyCode.Name} ${pad.Up.Name} ${pad.Down.Name}`, "ButtonX None None");
				expectEqual(zoom.Bindings.KeyboardAndMouse.Instance.KeyCode, K.MouseWheel, "untouched");
				eventually(() => changes.size() === 1, "one BindingsChanged");
				expectEqual(changes[0], "Gameplay/Zoom/Gamepad");
			});

			test("action.CaptureChord: ButtonL1 then the trigger ButtonR2, settled by the trigger's release", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const outcomes = new Array<string>();
				const stop = jump.CaptureChord((chord, device) =>
					outcomes.push(
						chord === undefined
							? "undefined"
							: `${chord.PrimaryModifier?.Name ?? "-"}+${chord.KeyCode.Name} on ${device}`,
					),
				);
				defer(stop);
				hold(real, [K.ButtonL1, K.ButtonR2]);
				quiet();
				expectEqual(outcomes.size(), 0, `nothing while held${real.FocusNote()}`);
				lifted(real, K.ButtonR2);
				eventually(() => outcomes.size() === 1, `the trigger's release${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(outcomes[0], "ButtonL1+ButtonR2 on Gamepad");
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonR2);
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.Space, "untouched");
			});

			test("action.CaptureChord: a gamepad key held at the start picks no device; a keyboard chord after it counts", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				hold(real, [K.ButtonX]);
				const outcomes = new Array<string>();
				const stop = jump.CaptureChord((chord, device) =>
					outcomes.push(
						chord === undefined
							? "undefined"
							: `${chord.PrimaryModifier?.Name ?? "-"}+${chord.KeyCode.Name} on ${device}`,
					),
				);
				defer(stop);
				quiet();
				hold(real, [K.RightControl, K.G]);
				lifted(real, K.ButtonX);
				quiet();
				expectEqual(
					outcomes.size(),
					0,
					`ButtonX, down at the start, settles nothing${real.FocusNote()}`,
				);
				lifted(real, K.G);
				eventually(() => outcomes.size() === 1, `the chord${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(outcomes[0], "RightControl+G on KeyboardAndMouse");
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA, "untouched");
			});

			test("a trigger held when a capture starts counts only once it has come up and gone down again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const pad = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.Gamepad;
				hold(real, [K.ButtonR2]);
				const captured = new Array<Enum.KeyCode>();
				const stop = pad.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				defer(stop);
				quiet();
				lifted(real, K.ButtonR2);
				quiet();
				expectEqual(captured.size(), 0, `held at the start, then released${real.FocusNote()}`);
				real.Tap(K.ButtonR2);
				eventually(() => captured.size() === 1, `pressed again${real.FocusNote()}`);
				expectEqual(captured[0], K.ButtonR2);
			});

			test("the TV remote's ButtonCenter: the Gamepad binding takes it, the keyboard's ignores it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const problem = sendable(real, K.ButtonCenter);
				if (problem !== undefined) return skip(problem);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const keys = new Array<Enum.KeyCode>();
				const stopKeys = jump.Bindings.KeyboardAndMouse.Capture("KeyCode", (key) =>
					keys.push(key ?? K.Unknown),
				);
				defer(stopKeys);
				const captured = new Array<string>();
				const stop = jump.Capture((key, device) =>
					captured.push(`${key?.Name ?? "cancelled"} on ${device}`),
				);
				defer(stop);
				real.Tap(K.ButtonCenter);
				eventually(() => captured.size() === 1, `ButtonCenter${real.FocusNote()}`);
				expectEqual(captured[0], "ButtonCenter on Gamepad");
				quiet();
				expectEqual(keys.size(), 0, "the keyboard's binding ignores it");
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.Space);
			});

			// ---- triggers through a real pad (opt-in: VIRTUAL_PAD_INPUT=1)

			// HD-4 (hunter, fixed without the pad: a pad's trigger counts as down at its InputBegan only past halfway, else at the InputChanged that takes it there; KeysDownNow counts a trigger down past halfway only; unconfirmed until pad input runs): Advanced.md says "The triggers (ButtonL2, ButtonR2) count as they go down past halfway", but CaptureInput took a trigger's InputBegan as it going down whatever its Position.Z, and then a later InputChanged under 0.2 as it coming up. If Roblox sends a pad trigger's InputBegan below halfway (unmeasured), a light pull was captured, and one under 0.2 also came up at once, settling a chord early
			test("pad: a trigger pulled lightly (under halfway) is no key yet", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const events = new Array<string>();
				const watch = [
					UserInputService.InputBegan.Connect((input) => {
						if (input.KeyCode === K.ButtonR2)
							events.push(`began ${math.floor(input.Position.Z * 100) / 100}`);
					}),
					UserInputService.InputChanged.Connect((input) => {
						if (input.KeyCode === K.ButtonR2)
							events.push(`changed ${math.floor(input.Position.Z * 100) / 100}`);
					}),
					UserInputService.InputEnded.Connect((input) => {
						if (input.KeyCode === K.ButtonR2) events.push("ended");
					}),
				];
				defer(() => watch.forEach((connection) => connection.Disconnect()));
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const captured = new Array<Enum.KeyCode>();
				const stop = jump.Bindings.Gamepad.Capture("KeyCode", (key) =>
					captured.push(key ?? K.Unknown),
				);
				defer(stop);
				pad.SetTrigger(K.ButtonR2, 0.3);
				quiet();
				pad.SetTrigger(K.ButtonR2, 0.4);
				quiet();
				expectEqual(
					captured.size(),
					0,
					`Advanced.md: "The triggers ... count as they go down past halfway": R2 at 0.3, then 0.4 (events: ${events.join(", ")})`,
				);
				pad.SetTrigger(K.ButtonR2, 0);
				frames(4);
				// a chord: ButtonL1 held, R2 touched lightly (0.1, then 0.15) must settle nothing
				const outcomes = new Array<string>();
				const stopChord = jump.CaptureChord((chord, device) =>
					outcomes.push(
						chord === undefined
							? "undefined"
							: `${chord.PrimaryModifier?.Name ?? "-"}+${chord.KeyCode.Name} on ${device}`,
					),
				);
				defer(stopChord);
				pad.Press(K.ButtonL1);
				frames(3);
				pad.SetTrigger(K.ButtonR2, 0.1);
				frames(3);
				pad.SetTrigger(K.ButtonR2, 0.15);
				quiet();
				expectEqual(
					outcomes.size(),
					0,
					`R2 at 0.1 then 0.15 with ButtonL1 held: no key down, nothing to settle (got ${outcomes.join(", ")}; events: ${events.join(", ")})`,
				);
				pad.SetTrigger(K.ButtonR2, 0.9);
				frames(3);
				pad.SetTrigger(K.ButtonR2, 0);
				eventually(
					() => outcomes.size() === 1,
					`the trigger's release (events: ${events.join(", ")})`,
				);
				pad.Release(K.ButtonL1);
				expectEqual(outcomes[0], "ButtonL1+ButtonR2 on Gamepad");
			});
		});
	}
}
