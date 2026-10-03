import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { GetKeyDevice } from "@rbxts/input-actions/out/InputActions/KeyGroups";
import {
	GuiService,
	HttpService,
	Players,
	ReplicatedStorage,
	UserInputService,
} from "@rbxts/services";
import { countSignal, createTestInput, frames, newFolder } from "./helpers";
import { clickProblem, realInput, testButton, testGui } from "./virtual";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;

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

function encode(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

function startsWith(text: string, prefix: string) {
	return text.sub(1, prefix.size()) === prefix;
}

/** A binding's keys as `Primary+Secondary+KeyCode`, the modifiers it lacks left out */
function keysOf(binding: InputBinding) {
	const parts = new Array<string>();
	if (binding.PrimaryModifier !== K.None) parts.push(binding.PrimaryModifier.Name);
	if (binding.SecondaryModifier !== K.None) parts.push(binding.SecondaryModifier.Name);
	parts.push(binding.KeyCode.Name);
	return parts.join("+");
}

/** A few frames in which nothing may arrive */
function quiet() {
	frames(6);
}

// ---- examples/RebindingMenu.ts, as it is written

/** The example's schema, with its two rows that need more than a KeyCode */
const HD2_MENU = InputActions.Schema({
	Hd2Menu: {
		Actions: {
			// a chord: Ctrl+S; no gamepad key in the schema, but a player can give it one
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.S, PrimaryModifier: K.LeftControl },
			}),
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Up: K.W, Down: K.S },
				Gamepad: K.ButtonR2,
			}),
		},
	},
});

/** The example's columns */
const COLUMNS = ["KeyboardAndMouse", "Gamepad"] as const;
/** The example's Cancel keys */
const CANCEL = [K.Backspace, K.ButtonB];

/** The example's `KeyLabel` */
function keyLabel(key: Enum.KeyCode | undefined) {
	return key === undefined ? "(unbound)" : UserInputService.GetStringForKeyCode(key);
}

/** The example's `IRowKeys`: the keys of a Bool or Direction1D binding, as its `Get()` returns them */
interface IRowKeys {
	KeyCode?: Enum.KeyCode;
	Up?: Enum.KeyCode;
	Down?: Enum.KeyCode;
	PrimaryModifier?: Enum.KeyCode;
	SecondaryModifier?: Enum.KeyCode;
}

/** The example's `ChordLabel`: the modifiers, then the key, or a composite's Up and Down (HD2-3) */
function chordLabel(keys: IRowKeys) {
	const parts = new Array<string>();
	if (keys.PrimaryModifier !== undefined) parts.push(keyLabel(keys.PrimaryModifier));
	if (keys.SecondaryModifier !== undefined) parts.push(keyLabel(keys.SecondaryModifier));
	if (keys.KeyCode === undefined && (keys.Up !== undefined || keys.Down !== undefined))
		parts.push(`${keyLabel(keys.Up)} / ${keyLabel(keys.Down)}`);
	else parts.push(keyLabel(keys.KeyCode));
	return parts.join(" + ");
}

// ---- a Create that throws

/** Jump bound on the keyboard; the later schema adds a Scriptable slot to it */
const HD2_HOLD = InputActions.Schema({
	Hd2Hold: { Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) } },
});
/** Gives Jump a binding it lacks, and declares Zap, which the folder holds as a Bool, a Direction1D */
const HD2_HOLD_LATER = InputActions.Schema({
	Hd2Hold: {
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Virtual: InputActions.Scriptable }),
			Zap: InputActions.Direction1D(),
		},
	},
});

/** A root handle waiting on a stand-in: Jump, and Duck, which the hand-made copy lacks at first */
const HD2_WAITING = InputActions.Schema({
	Hd2Sa: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.K }),
		},
	},
});
/** Takes up the copy of Hd2Sa (it has Jump), and declares Zap a Direction1D in a local context */
const HD2_THROWS_ON_COPY = InputActions.Schema({
	Hd2Sa: { ServerAuthority: true, Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) } },
	Hd2Local: { Actions: { Zap: InputActions.Direction1D() } },
});

/** The root handle already on the copy: Jump on the keyboard only (its Gamepad binding unbound) */
const HD2_JOIN_ON_COPY = InputActions.Schema({
	Hd2Join: {
		ServerAuthority: true,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) },
	},
});
/** The root handle waiting on a stand-in: a tuned Gamepad binding, and Duck, which the copy lacks */
const HD2_JOIN_WAITING = InputActions.Schema({
	Hd2Join: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: K.J,
				Gamepad: { KeyCode: K.ButtonR2, PressedThreshold: 0.3 },
			}),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.K }),
		},
	},
});
const EMPTY_SAVE = '{"Version":1,"Bindings":{}}';

let copyCount = 0;

/**
 * A copy of a context built by hand under a player folder no server provides, as the server's would
 * be (enabled), parented to the player; gone after the test
 */
function handMadeCopy(contextName: string, actions: string[]) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `HunterDevices2Copy${copyCount}`;
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

/** A context named `name` in `folder` with a designer's Bool action `Zap` */
function designerZap(folder: Instance, name: string) {
	let context = folder.FindFirstChild(name);
	if (context === undefined) {
		context = new Instance("InputContext");
		context.Name = name;
		context.Parent = folder;
	}
	const zap = new Instance("InputAction");
	zap.Name = "Zap";
	zap.Type = Enum.InputActionType.Bool;
	zap.Parent = context;
	return zap;
}

/**
 * Hunt round 2 on device bindings (0.7.0, design spec §3, §4, §6, §7): keys per device against the
 * engine's own list, saves with numbers out of a property's range, Create's checks before it writes,
 * and the rebinding menu example
 */
@Provider({ activeIn: ["testing"] })
export class HunterDevices2Tests implements OnStart {
	onStart() {
		defineTests("hunter-devices-2", () => {
			// ---- keys per device (§3)

			test("every KeyCode the engine lists for a pad, a TV remote, a touch screen or a mouse is that device's", () => {
				const wrong = new Array<string>();
				let gamepad = 0;
				for (const key of Enum.KeyCode.GetEnumItems()) {
					const name = key.Name;
					let expected: string | undefined;
					if (
						startsWith(name, "Button") ||
						startsWith(name, "DPad") ||
						startsWith(name, "Thumbstick") ||
						startsWith(name, "Gamepad")
					)
						expected = "Gamepad";
					else if (startsWith(name, "Touch")) expected = "Touch";
					else if (startsWith(name, "Mouse") || startsWith(name, "Trackpad"))
						expected = "KeyboardAndMouse";
					if (expected === "Gamepad") gamepad++;
					const device = GetKeyDevice(key);
					if (expected !== undefined && device !== expected)
						wrong.push(`${name} (${key.Value}) is ${device}`);
				}
				expectEqual(
					wrong.join(", "),
					"",
					`design spec §3 "Keys per device": every key belongs to one device; the engine lists ${gamepad} gamepad-named keys`,
				);
			});

			// ---- saves (§7)

			test("ImportBindings never throws on finite numbers out of a property's range, and its export imports again", () => {
				const input = createTestInput();
				const save = encode({
					"Gameplay/Jump/KeyboardAndMouse": { PressedThreshold: 5 },
					"Gameplay/Fire/Gamepad": { PressedThreshold: -1, ReleasedThreshold: 3 },
					"Gameplay/Move/Gamepad": { ResponseCurve: -2 },
					"Gameplay/Look/KeyboardAndMouse": { Scale: 3e38, Vector2Scale: [3e38, -3e38] },
					"Gameplay/Zoom/KeyboardAndMouse": { Scale: -1 },
				});
				const [ok, result] = pcall(() => input.ImportBindings(save));
				expectTrue(ok, `API.md: ImportBindings "never throws"; this save threw: ${result}`);
				const exported = input.ExportBindings();
				const other = createTestInput();
				const [okAgain, again] = pcall(() => other.ImportBindings(exported));
				expectTrue(okAgain, `the export ${exported} threw on import: ${again}`);
				const skipped = (again as InputActions.ImportResult).Skipped.map(
					(entry) => `${entry.Path}: ${entry.Reason}`,
				);
				expectEqual(
					skipped.join("; "),
					"",
					`design spec §7: "every export imports cleanly" (${exported})`,
				);
				expectEqual(other.ExportBindings(), exported, "and reads the same");
				// Set with the same numbers: the rules allow them, so it applies them or throws before a write
				const jump = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				jump.Reset();
				const [setOk, problem] = pcall(() => jump.Set({ KeyCode: K.F, PressedThreshold: 5 }));
				expectTrue(
					setOk || jump.Instance.KeyCode === K.Space,
					`Set threw (${problem}) after it had written part of the binding: KeyCode ${jump.Instance.KeyCode.Name}`,
				);
			});

			// ---- Create checks before it writes (§4, hunt HD-2)

			test("a Create that throws releases no held action it would have given a binding", () => {
				const folder = newFolder();
				const first = create(HD2_HOLD, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hd2Hold.Actions.Jump;
				const released = countSignal(jump.Released);
				jump.Fire(true);
				eventually(() => jump.IsPressed(), "held by Fire");
				designerZap(folder, "Hd2Hold");
				const message = expectThrows(() =>
					InputActions.Create(HD2_HOLD_LATER, { Folder: folder, ResetOnFocusLoss: false }),
				);
				expectTrue(contains(message, "Zap"), message);
				frames(4);
				expectTrue(
					jump.IsPressed(),
					`design spec §4: "a Create that throws leaves the tree as it found it: it ... releases no held action" (${message})`,
				);
				expectEqual(released.count, 0, "no Released");
				expectEqual(jump.Instance.FindFirstChild("JumpVirtual"), undefined, "no binding left");
				jump.Fire(false);
				eventually(() => !jump.IsPressed(), "released by Fire");
			});

			// HD2-5 (hunter, fixed: CheckBuild checks the names with Schema's own checks, ContextNameProblem, ActionNameProblem, SlotNameProblem and SlotCollision, "/" included): CheckBuild says it checks "the names Schema refuses (a schema made without it could still hold them)", and design spec §4 lists "the names Schema refuses" among Create's checks, but a "/" in a context or action name isn't among them: Create builds the context, and SanitizeBindings drops every entry of its save (its path splits into five parts), so the server stores none of those rebinds
			test("Create refuses the names Schema refuses, a '/' too, in a schema made without Schema", () => {
				const actions = { Open: InputActions.Bool({ KeyboardAndMouse: K.M }) };
				const refused = expectThrows(() =>
					InputActions.Schema({ "Hd2/Slash": { Actions: actions } } as never),
				);
				// what Create's types take as they are: { Contexts }, made without Schema
				const raw = { Contexts: { "Hd2/Slash": { Actions: actions } } };
				const [ok, made] = pcall(() =>
					InputActions.Create(raw, { Folder: newFolder(), ResetOnFocusLoss: false }),
				);
				let lost = "";
				if (ok) {
					const input = made as InputActions.Handle<typeof raw.Contexts>;
					defer(() => input.Destroy());
					input["Hd2/Slash"].Actions.Open.Bindings.KeyboardAndMouse.Set(K.N);
					const save = input.ExportBindings();
					lost = `; its save ${save} sanitizes to ${InputActions.SanitizeBindings(raw, save)}`;
				}
				expectFalse(
					ok,
					`CheckBuild (Runtime.ts): "The names Schema refuses (a schema made without it could still hold them)"; Schema refuses it (${refused}), Create built it${lost}`,
				);
				expectTrue(contains(tostring(made), `a context name can't contain "/"`), tostring(made));
			});

			// worker, HD2-5: an action's and a binding's name too, with Schema's messages, and nothing made
			test("Create refuses a '/' in an action's or a binding's name, with Schema's message, and makes nothing", () => {
				const cases: Array<
					[string, InputActions.InputSchema<Record<string, InputActions.ContextSchema>>]
				> = [
					[
						"an action name",
						{ Contexts: { Hd2Names: { Actions: { "Open/Map": InputActions.Bool() } } } },
					],
					[
						"a binding name",
						{
							Contexts: {
								Hd2Names: {
									Actions: { Open: InputActions.Bool({ "Pad/Virtual": InputActions.Scriptable }) },
								},
							},
						},
					],
				];
				for (const [what, schema] of cases) {
					const folder = newFolder();
					const fromSchema = expectThrows(() => InputActions.Schema(schema.Contexts as never));
					const fromCreate = expectThrows(() =>
						InputActions.Create(schema, { Folder: folder, ResetOnFocusLoss: false }),
					);
					const message = `${what} can't contain "/"`;
					expectTrue(contains(fromSchema, message), fromSchema);
					expectTrue(contains(fromCreate, message), `${what}: ${fromCreate}`);
					expectEqual(folder.GetChildren().size(), 0, `${what}: nothing made`);
				}
			});

			// worker, small item: the default folder is made once Create's checks pass
			test("a Create that throws, without a Folder option, makes no ReplicatedStorage.Inputs", () => {
				if (ReplicatedStorage.FindFirstChild("Inputs") !== undefined)
					return skip("ReplicatedStorage.Inputs exists already");
				const raw = { Contexts: { "Hd2/Default": { Actions: { Open: InputActions.Bool() } } } };
				const [ok, made] = pcall(() => InputActions.Create(raw, { ResetOnFocusLoss: false }));
				const left = ReplicatedStorage.FindFirstChild("Inputs");
				if (ok) (made as InputActions.Handle<typeof raw.Contexts>).Destroy();
				if (left !== undefined) left.Destroy();
				expectFalse(ok, "the '/' throws");
				expectEqual(left, undefined, `the default folder, made for a Create that threw (${made})`);
			});

			// worker, small item: a Scriptable named <Action><Device> collides with the device's binding
			test("a Scriptable named JumpTouch: the message says the name is taken by Jump's Touch binding", () => {
				const fromSchema = expectThrows(() =>
					InputActions.Schema({
						Hd2Taken: {
							Actions: { Jump: InputActions.Bool({ JumpTouch: InputActions.Scriptable }) },
						},
					}),
				);
				const raw = {
					Contexts: {
						Hd2Taken: {
							Actions: { Jump: InputActions.Bool({ JumpTouch: InputActions.Scriptable }) },
						},
					},
				};
				const folder = newFolder();
				const fromCreate = expectThrows(() =>
					InputActions.Create(raw, { Folder: folder, ResetOnFocusLoss: false }),
				);
				const taken = `the name "JumpTouch" is taken by the action's Touch binding`;
				expectTrue(contains(fromSchema, taken), fromSchema);
				expectTrue(contains(fromCreate, taken), fromCreate);
				expectFalse(contains(fromSchema, "rename one"), fromSchema);
				expectEqual(folder.GetChildren().size(), 0, "nothing made");
				// two declared slots still say so
				const both = expectThrows(() =>
					InputActions.Schema({
						Hd2Taken: {
							Actions: {
								Jump: InputActions.Bool({
									Gamepad: K.ButtonA,
									JumpGamepad: InputActions.Scriptable,
								}),
							},
						},
					}),
				);
				expectTrue(
					contains(
						both,
						`the slots "Gamepad" and "JumpGamepad" would both match the binding JumpGamepad: rename one`,
					),
					both,
				);
			});

			test("a Create that throws swaps no root handle waiting on a stand-in onto the copy", () => {
				const copy = handMadeCopy("Hd2Sa", ["Jump"]);
				const options: InputActions.CreateOptions = {
					Folder: newFolder(),
					PlayerFolderName: copy.folder.Name,
					Timeout: 1000,
					ResetOnFocusLoss: false,
				};
				const waiting = create(HD2_WAITING, options);
				expectFalse(waiting.Hd2Sa.IsLinkedToServer(), "the copy lacks Duck");
				designerZap(options.Folder!, "Hd2Local");
				// Duck arrives: the waiting root handle swaps on its next Heartbeat; a Create in between
				// would swap it first, then build on the copy
				const duck = new Instance("InputAction");
				duck.Name = "Duck";
				duck.Parent = copy.context;
				const [ok, message] = pcall(() => InputActions.Create(HD2_THROWS_ON_COPY, options));
				const linkedThen = waiting.Hd2Sa.IsLinkedToServer();
				expectFalse(ok, "Zap is a Bool in the folder");
				expectTrue(contains(tostring(message), "Zap"), tostring(message));
				expectFalse(
					linkedThen,
					`design spec §4: "a Create that throws leaves the tree as it found it"; it swapped the waiting root handle (${message})`,
				);
				eventually(() => waiting.Hd2Sa.IsLinkedToServer(), "the swap, on its own");
				expectEqual(waiting.Hd2Sa.Actions.Jump.Instance.Parent, copy.context);
			});

			// ---- the fill rule at the swap (§4: "The same holds at a Server Authority swap")

			test("the swap fills the copy's unbound binding a player rebound: the rebind stays, and after Reset both exports are empty", () => {
				const copy = handMadeCopy("Hd2Join", ["Jump"]);
				const options: InputActions.CreateOptions = {
					Folder: newFolder(),
					PlayerFolderName: copy.folder.Name,
					Timeout: 1000,
					ResetOnFocusLoss: false,
				};
				const onCopy = create(HD2_JOIN_ON_COPY, options);
				expectTrue(onCopy.Hd2Join.IsLinkedToServer(), "linked at Create");
				const pad = onCopy.Hd2Join.Actions.Jump.Bindings.Gamepad;
				expectEqual(pad.Instance.KeyCode, K.None, "unbound: its schema leaves Gamepad out");
				pad.Set(K.ButtonX);
				const waiting = create(HD2_JOIN_WAITING, options);
				expectFalse(waiting.Hd2Join.IsLinkedToServer(), "the copy lacks Duck");
				const duck = new Instance("InputAction");
				duck.Name = "Duck";
				duck.Parent = copy.context;
				eventually(() => waiting.Hd2Join.IsLinkedToServer(), "the swap once Duck is there");
				expectEqual(
					waiting.Hd2Join.Actions.Jump.Bindings.Gamepad.Instance,
					pad.Instance,
					"adopted",
				);
				expectEqual(pad.Instance.KeyCode, K.ButtonX, "the player's rebind stays (§4)");
				pad.Reset();
				expectEqual(pad.Instance.KeyCode, K.ButtonR2, "Reset: the stand-in's schema's key");
				expectEqual(
					`${onCopy.ExportBindings()} ${waiting.ExportBindings()}`,
					`${EMPTY_SAVE} ${EMPTY_SAVE}`,
					`design spec §4: the fill's defaults are a reading (hunt HD-1), at the swap too; PressedThreshold reads ${pad.Instance.PressedThreshold}`,
				);
			});

			// ---- a menu the pad navigates: a GUI object selected (Advanced.md, "IAS behaviours to know")

			test("a gamepad rebind while a GUI object is selected: the Gamepad binding's Capture takes ButtonA", () => {
				if (getProject() === "touch") return skip("the touch project: no gamepad UI navigation");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const button = testButton(testGui("HunterDevices2Select"), "Rebind");
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				defer(() => {
					GuiService.SelectedObject = undefined;
				});
				GuiService.SelectedObject = button;
				frames(3);
				if (GuiService.SelectedObject !== button) return skip("the button can't be selected here");
				const events = new Array<string>();
				const watch = UserInputService.InputBegan.Connect((input, processed) => {
					if (input.KeyCode === K.ButtonA || input.KeyCode === K.ButtonX)
						events.push(`${input.KeyCode.Name} ${input.UserInputType.Name} processed=${processed}`);
				});
				defer(() => watch.Disconnect());
				const activated = countSignal(button.Activated);
				const pad = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.Gamepad;
				pad.Clear();
				const captured = new Array<Enum.KeyCode>();
				const stop = pad.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				defer(stop);
				real.Tap(K.ButtonA);
				quiet();
				const first = captured.map((key) => key.Name).join(",");
				// control: a button the navigation doesn't use
				const stopControl = pad.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				defer(stopControl);
				real.Tap(K.ButtonX);
				quiet();
				expectEqual(
					`${first}; then ${captured.map((key) => key.Name).join(",")}`,
					"ButtonA; then ButtonA,ButtonX",
					`examples/RebindingMenu.ts: "Press a key or a button for Jump"; with the menu's button selected, as gamepad navigation leaves it (InputBegan: ${events.join(", ")}; Activated ${activated.count}; selected ${GuiService.SelectedObject === button}${real.FocusNote()})`,
				);
			});

			// ---- examples/RebindingMenu.ts

			// HD2-3 (hunter, fixed: the example's ChordLabel shows a composite's Up and Down when the binding has no KeyCode, "W / S"): examples/RebindingMenu.ts says "Each row shows its keys on both devices", but its ChordLabel reads only KeyCode and the modifiers: the Throttle row (a W/S composite on the keyboard) prints "(unbound)" in the keyboard's column
			test("examples/RebindingMenu.ts: each row shows its keys, a composite's too (Throttle's W and S)", () => {
				const input = create(HD2_MENU, { Folder: newFolder(), ResetOnFocusLoss: false });
				const throttle = input.Hd2Menu.Actions.Throttle;
				// RefreshLabels, for the Throttle row
				const cells = COLUMNS.map((device) => chordLabel(throttle.Bindings[device].Get()));
				const keys = throttle.Bindings.KeyboardAndMouse.Get();
				expectEqual(`${keys.Up?.Name} ${keys.Down?.Name}`, "W S", "bound on the keyboard");
				expectFalse(
					cells[0] === "(unbound)",
					`examples/RebindingMenu.ts: "Each row shows its keys on both devices", and ROWS has Throttle, bound to Up = W, Down = S on the keyboard; RefreshLabels prints "Throttle: ${cells.join(" | ")}" (ChordLabel reads KeyCode and the modifiers only)`,
				);
				expectEqual(
					cells.join(" | "),
					`${keyLabel(K.W)} / ${keyLabel(K.S)} | ${keyLabel(K.ButtonR2)}`,
					"the composite's two keys, and the pad's trigger",
				);
				// the other rows read as before: a chord, and an unbound binding
				const quickSave = input.Hd2Menu.Actions.QuickSave;
				expectEqual(
					COLUMNS.map((device) => chordLabel(quickSave.Bindings[device].Get())).join(" | "),
					`${keyLabel(K.LeftControl)} + ${keyLabel(K.S)} | (unbound)`,
					"Quick save",
				);
			});

			// HD2-4 (hunter, fixed: the action's one-field Capture makes the binding exactly the captured key, its modifiers cleared as by CaptureChord with one key, ApplyChord; a binding's Capture("KeyCode") keeps them, tested below): the action's one-field Capture writes the KeyCode and keeps the binding's modifiers: Quick save (Ctrl+S) captured with F becomes Ctrl+F, while the example's RebindAction prints "QuickSave is now F", and the action's CaptureChord with F alone gives F
			test("the one-field Capture on Quick save (Ctrl+S) with F: the binding is what the example says, as with CaptureChord", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const quickSave = create(HD2_MENU, { Folder: newFolder(), ResetOnFocusLoss: false }).Hd2Menu
					.Actions.QuickSave;
				// the example's RebindAction
				const messages = new Array<string>();
				const stop = quickSave.Capture(
					(key, device) =>
						messages.push(`${quickSave.Name} is now ${key?.Name ?? "cancelled"} on ${device}`),
					{ Cancel: CANCEL },
				);
				defer(stop);
				real.Tap(K.F);
				eventually(() => messages.size() === 1, `the callback${real.FocusNote()}`);
				const captured = keysOf(quickSave.Bindings.KeyboardAndMouse.Instance);
				// control: the action's CaptureChord, given F alone
				const chordField = create(HD2_MENU, { Folder: newFolder(), ResetOnFocusLoss: false })
					.Hd2Menu.Actions.QuickSave;
				const outcomes = new Array<string>();
				const stopChord = chordField.CaptureChord((chord, device) =>
					outcomes.push(`${chord?.KeyCode.Name} on ${device}`),
				);
				defer(stopChord);
				quiet();
				real.Tap(K.F);
				eventually(() => outcomes.size() === 1, `the chord${real.FocusNote()}`);
				const chorded = keysOf(chordField.Bindings.KeyboardAndMouse.Instance);
				expectEqual(chorded, "F", "CaptureChord: one key alone clears the modifiers");
				expectEqual(
					captured,
					"F",
					`examples/RebindingMenu.ts's RebindAction prints "${messages[0]}" (one field per action: "Press a key or a button"), but the binding is ${captured}, and its label "${chordLabel(quickSave.Bindings.KeyboardAndMouse.Get())}"; the action's CaptureChord, given the same F alone, makes it ${chorded}`,
				);
			});

			// worker, HD2-4: the slot-level capture is unchanged
			test("a binding's Capture('KeyCode') on Quick save (Ctrl+S) with F keeps the modifier: Ctrl+F", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = create(HD2_MENU, { Folder: newFolder(), ResetOnFocusLoss: false }).Hd2Menu
					.Actions.QuickSave.Bindings.KeyboardAndMouse;
				const captured = new Array<Enum.KeyCode>();
				const stop = keys.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown), {
					Cancel: CANCEL,
				});
				defer(stop);
				real.Tap(K.F);
				eventually(() => captured.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(
					keysOf(keys.Instance),
					"LeftControl+F",
					"design spec §6: a binding's Capture fills one slot, and keeps the modifiers",
				);
			});
		});
	}
}
