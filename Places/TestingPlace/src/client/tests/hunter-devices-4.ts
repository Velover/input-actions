import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectTrue,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService, Players, UserInputService } from "@rbxts/services";
import { frames, newFolder, recordSignal } from "./helpers";
import { realInput } from "./virtual";

const K = Enum.KeyCode;
type AnySchema = InputActions.InputSchema<Record<string, InputActions.ContextSchema>>;

/** `Create`, destroyed after the test; it holds keys, so no focus-loss reset */
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
		for (const [name, value] of pairs(entry)) {
			parts.push(
				`${name}=${typeIs(value, "table") ? HttpService.JSONEncode(value) : tostring(value)}`,
			);
		}
		parts.sort();
		lines.push(`${path}: ${parts.join(" ")}`);
	}
	lines.sort();
	return lines.join("; ");
}

/** The paths of a save, sorted */
function pathsOf(save: string) {
	const decoded = HttpService.JSONDecode(save) as { Bindings: Record<string, unknown> };
	const paths = new Array<string>();
	for (const [path] of pairs(decoded.Bindings)) paths.push(path as string);
	paths.sort();
	return paths.join(", ");
}

/** A binding's keys, every slot that holds one, as `Slot=Key` */
function keysOf(binding: InputBinding) {
	const parts = new Array<string>();
	for (const slot of [
		"PrimaryModifier",
		"SecondaryModifier",
		"KeyCode",
		"Up",
		"Down",
		"Left",
		"Right",
		"Forward",
		"Backward",
	] as const) {
		const key = binding[slot];
		if (key !== K.None) parts.push(`${slot}=${key.Name}`);
	}
	return parts.size() === 0 ? "(unbound)" : parts.join(" ");
}

/** A float as written: 7 significant digits */
function round(value: number) {
	return tonumber(string.format("%.7g", value)) ?? value;
}

/** Keys and every saved tuning of a binding, for comparing two bindings */
function stateOf(binding: InputBinding) {
	return (
		`${keysOf(binding)} P${round(binding.PressedThreshold)} R${round(binding.ReleasedThreshold)} ` +
		`S${round(binding.Scale)} V2${binding.Vector2Scale} V3${binding.Vector3Scale} ` +
		`C${round(binding.ResponseCurve)}`
	);
}

// ---- the fill rule and a tuning (design spec §4; Advanced.md, "Get-or-create in detail")

/** The first root handle's schema: Jump and Look on the keyboard and mouse only */
const HD4_FILL_KEYS = InputActions.Schema({
	Hd4Fill: {
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.Space }),
			Look: InputActions.Direction2D({ KeyboardAndMouse: K.MouseDelta }),
		},
	},
});
/** A later root handle's schema on the same folder: the gamepad's keys for both */
const HD4_FILL_PAD = InputActions.Schema({
	Hd4Fill: {
		Actions: {
			Jump: InputActions.Bool({ Gamepad: K.ButtonA }),
			Look: InputActions.Direction2D({ Gamepad: K.Thumbstick2 }),
		},
	},
});
/** A save with a tuning of each gamepad binding, made where both schemas had filled them */
const HD4_TUNING_SAVE = encode({
	"Hd4Fill/Jump/Gamepad": { PressedThreshold: 0.25 },
	"Hd4Fill/Look/Gamepad": { Scale: 2 },
});

/** The same pair on a Server Authority context: the copy's root handle leaves the gamepad out */
const HD4_SWAPFILL_KEYS = InputActions.Schema({
	Hd4SwapFill: {
		ServerAuthority: true,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.Space }) },
	},
});
/** The waiting root handle: the gamepad's key, and Duck, which the copy lacks until the test adds it */
const HD4_SWAPFILL_PAD = InputActions.Schema({
	Hd4SwapFill: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ Gamepad: K.ButtonA }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.K }),
		},
	},
});

// ---- saves on every device and action type (design spec §7)

const HD4_SAVE = InputActions.Schema({
	Hd4Save: {
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.Space }),
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Up: K.W, Down: K.S },
				Gamepad: K.ButtonR2,
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
				Gamepad: K.Thumbstick1,
				Virtual: InputActions.Scriptable,
			}),
			Look: InputActions.Direction2D({
				KeyboardAndMouse: K.MouseDelta,
				Gamepad: { KeyCode: K.Thumbstick2, ResponseCurve: 2 },
			}),
			Fly: InputActions.Direction3D({ KeyboardAndMouse: { Up: K.E, Down: K.Q } }),
			Point: InputActions.ViewportPosition({ KeyboardAndMouse: K.MousePosition }),
		},
	},
});
type SaveActions = InputActions.Handle<typeof HD4_SAVE.Contexts>["Hd4Save"]["Actions"];

/** Every device binding of HD4_SAVE's actions, by path */
function deviceBindings(actions: SaveActions) {
	const list = new Array<[string, InputBinding]>();
	for (const name of ["Jump", "Throttle", "Move", "Look", "Fly", "Point"] as const) {
		for (const device of ["KeyboardAndMouse", "Gamepad", "Touch"] as const) {
			list.push([`${name}/${device}`, actions[name].Bindings[device].Instance]);
		}
	}
	return list;
}

// ---- a capture across the Server Authority swap (design spec §6, §8)

const HD4_SWAP = InputActions.Schema({
	Hd4Swap: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Gamepad: K.ButtonA }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.K }),
		},
	},
});

let copyCount = 0;

/** A copy of a context built by hand under a player folder no server provides; gone after the test */
function handMadeCopy(contextName: string, actions: string[]) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `HunterDevices4Copy${copyCount}`;
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

/**
 * A contexts table with `first` iterated before a context named `Hd4Late<n>` holding `late`, as
 * `pairs` goes (the order Create builds them in); undefined when no name of the forty tried does
 */
function contextsWithLate(
	firstName: string,
	first: InputActions.ContextSchema,
	late: unknown,
): Record<string, unknown> | undefined {
	for (let index = 1; index <= 40; index++) {
		const contexts: Record<string, unknown> = {};
		contexts[firstName] = first;
		contexts[`Hd4Late${index}`] = late;
		for (const [name] of pairs(contexts)) {
			if (name === firstName) return contexts;
			break;
		}
	}
	return undefined;
}

/**
 * Hunt round 4 on device bindings (0.7.0): the fill rule against a tuning, Create's checks against
 * what IAS refuses, saves on every device and action type, Set's merges, and a capture across the
 * Server Authority swap
 */
@Provider({ activeIn: ["testing"] })
export class HunterDevices4Tests implements OnStart {
	onStart() {
		defineTests("hunter-devices-4", () => {
			// ---- the fill rule against a tuning

			// HD4-1 (hunter, fixed: FillPlaceholder decides on the key slots alone; a binding whose keys are as they were made gets the later schema's values with what the player changed from the old defaults on top, as CarryChanges carries them, and one the player rebound keeps everything): a tuning on an unbound device binding (a save's entry loaded before the later Create, or Set with a part) keeps the later schema's keys out of it: the binding stays unbound, and the export pins KeyCode None
			test("a later schema fills an unbound binding whose tuning a save loaded first, as when the save loads after it", () => {
				/** Both root handles on one folder, the save loaded through the first, before or after the second */
				const run = (loadFirst: boolean) => {
					const folder = newFolder();
					const keys = create(HD4_FILL_KEYS, { Folder: folder });
					if (loadFirst) keys.ImportBindings(HD4_TUNING_SAVE);
					const pad = create(HD4_FILL_PAD, { Folder: folder });
					if (!loadFirst) keys.ImportBindings(HD4_TUNING_SAVE);
					const actions = pad.Hd4Fill.Actions;
					return {
						state: `${stateOf(actions.Jump.Bindings.Gamepad.Instance)} | ${stateOf(actions.Look.Bindings.Gamepad.Instance)}`,
						save: keys.ExportBindings(),
					};
				};
				const after = run(false);
				const before = run(true);
				expectTrue(
					contains(after.state, "KeyCode=ButtonA") && contains(after.state, "KeyCode=Thumbstick2"),
					`control: loaded after the second Create, the save tunes the filled keys: ${after.state}`,
				);
				expectEqual(
					`${before.state} / ${canonical(before.save)}`,
					`${after.state} / ${canonical(after.save)}`,
					`Advanced.md, "Get-or-create in detail": "When a later schema names a device an earlier one left out, it fills that device's unbound binding: its keys become the defaults of every handle on it (a player's rebind made meanwhile stays)"; API.md: "At runtime an unbound binding (no key at all) is legal". The save ${HD4_TUNING_SAVE} (a threshold and a scale, no key) loaded through the first root handle before the second Create left both gamepad bindings unbound (left of "/"), and the export now saves their keys as None, which unbinds them in every later session; loaded after it, the same save tunes ButtonA and Thumbstick2 (right)`,
				);
			});

			// HD4-1 (hunter, fixed as above; same cause, through Set): Set({ PressedThreshold }) and Set({ DisplayName }) with a part (round 3) on an unbound binding
			test("a later schema fills an unbound binding the player only tuned or named with Set", () => {
				const outcomes = new Array<string>();
				const tunings: Array<[string, (actions: InputActions.Handle<typeof HD4_FILL_KEYS.Contexts>["Hd4Fill"]["Actions"]) => void]> = [
					["nothing", () => {}],
					[
						"Set({ PressedThreshold: 0.25 }), Set({ Scale: 2 })",
						(actions) => {
							actions.Jump.Bindings.Gamepad.Set({ PressedThreshold: 0.25 });
							actions.Look.Bindings.Gamepad.Set({ Scale: 2 });
						},
					],
					[
						"Set({ DisplayName })",
						(actions) => {
							actions.Jump.Bindings.Gamepad.Set({ DisplayName: "Jump" });
							actions.Look.Bindings.Gamepad.Set({ DisplayName: "Look" });
						},
					],
				];
				for (const [what, tune] of tunings) {
					const folder = newFolder();
					const keys = create(HD4_FILL_KEYS, { Folder: folder });
					tune(keys.Hd4Fill.Actions);
					const pad = create(HD4_FILL_PAD, { Folder: folder });
					const actions = pad.Hd4Fill.Actions;
					outcomes.push(
						`${what}: ${keysOf(actions.Jump.Bindings.Gamepad.Instance)}, ${keysOf(actions.Look.Bindings.Gamepad.Instance)}; export ${keys.ExportBindings()}`,
					);
				}
				const unbound = outcomes.filter((line) => contains(line, "(unbound)"));
				expectEqual(
					unbound.join("\n"),
					"",
					`Advanced.md: the later schema "fills that device's unbound binding" (a player's rebind stays); "An object may leave the key out: Set({ PressedThreshold: 0.9 }) tunes the key the binding has". A tuning or a name, no key, kept ButtonA and Thumbstick2 out:\n${outcomes.join("\n")}`,
				);
			});

			// HD4-1 (hunter, fixed as above; same cause, at the Server Authority swap, which fills through FillPlaceholder too): a stand-in whose schema names the gamepad swaps onto the copy's binding another root handle made unbound and loaded a tuning into: the binding stays unbound
			test("the swap fills the copy's unbound binding a save tuned, as it fills an untouched one", () => {
				const run = (tuned: boolean) => {
					const copy = handMadeCopy("Hd4SwapFill", ["Jump"]);
					const options = { PlayerFolderName: copy.folder.Name, Timeout: 1000 };
					const onCopy = create(HD4_SWAPFILL_KEYS, options);
					expectTrue(onCopy.Hd4SwapFill.IsLinkedToServer(), "linked at Create");
					if (tuned) onCopy.ImportBindings(encode({ "Hd4SwapFill/Jump/Gamepad": { PressedThreshold: 0.25 } }));
					const waiting = create(HD4_SWAPFILL_PAD, options);
					expectTrue(!waiting.Hd4SwapFill.IsLinkedToServer(), "the copy lacks Duck");
					const duck = new Instance("InputAction");
					duck.Name = "Duck";
					duck.Parent = copy.context;
					eventually(() => waiting.Hd4SwapFill.IsLinkedToServer(), "the swap once Duck is there");
					const pad = waiting.Hd4SwapFill.Actions.Jump.Bindings.Gamepad;
					return `${keysOf(pad.Instance)}; export ${waiting.ExportBindings()}`;
				};
				const untouched = run(false);
				expectTrue(contains(untouched, "KeyCode=ButtonA"), `control: an untouched one is filled: ${untouched}`);
				const tuned = run(true);
				expectTrue(
					contains(tuned, "KeyCode=ButtonA"),
					`design spec §4: the fill "holds at a Server Authority swap onto bindings another root handle made on the copy"; Advanced.md: the later schema "fills that device's unbound binding". The other root handle loaded {"PressedThreshold":0.25} into its unbound Jump/Gamepad binding (no key); after the swap the waiting handle's Jump/Gamepad, whose schema says ButtonA, reads ${tuned}`,
				);
			});

			test("worker, HD4-1: a filled binding keeps the player's tuning and name, takes the schema's other values, and Reset gives the schema's binding", () => {
				const folder = newFolder();
				const keys = create(HD4_FILL_KEYS, { Folder: folder });
				const early = keys.Hd4Fill.Actions.Jump.Bindings.Gamepad;
				early.Set({ ReleasedThreshold: 0.1, DisplayName: "Hop" });
				const pad = create(
					InputActions.Schema({
						Hd4Fill: {
							Actions: {
								Jump: InputActions.Bool({ Gamepad: { KeyCode: K.ButtonR2, PressedThreshold: 0.7 } }),
								Look: InputActions.Direction2D({ Gamepad: K.Thumbstick2 }),
							},
						},
					}),
					{ Folder: folder },
				);
				const binding = pad.Hd4Fill.Actions.Jump.Bindings.Gamepad.Instance;
				expectEqual(
					`${stateOf(binding)} ${binding.DisplayName}`,
					"KeyCode=ButtonR2 P0.7 R0.1 S1 V21, 1 V31, 1, 1 C1 Hop",
					"the schema's key and PressedThreshold, the player's ReleasedThreshold and name",
				);
				expectEqual(
					canonical(keys.ExportBindings()),
					"Hd4Fill/Jump/Gamepad: ReleasedThreshold=0.1",
					"the export saves what the player changed, through either root handle",
				);
				expectEqual(canonical(pad.ExportBindings()), canonical(keys.ExportBindings()), "the same from the later one");
				early.Reset();
				expectEqual(
					`${stateOf(binding)} "${binding.DisplayName}"`,
					'KeyCode=ButtonR2 P0.7 R0.2 S1 V21, 1 V31, 1, 1 C1 ""',
					"Reset gives the later schema's binding",
				);
				expectEqual(keys.ExportBindings(), '{"Version":1,"Bindings":{}}', "nothing to save after Reset");
				// a rebind with a tuning keeps both: the keys decide
				const folder2 = newFolder();
				const keys2 = create(HD4_FILL_KEYS, { Folder: folder2 });
				keys2.Hd4Fill.Actions.Jump.Bindings.Gamepad.Set({ KeyCode: K.ButtonX, PressedThreshold: 0.25 });
				const pad2 = create(HD4_FILL_PAD, { Folder: folder2 });
				expectEqual(
					stateOf(pad2.Hd4Fill.Actions.Jump.Bindings.Gamepad.Instance),
					"KeyCode=ButtonX P0.25 R0.2 S1 V21, 1 V31, 1, 1 C1",
					"a player's rebind stays as it is, its tuning too",
				);
				expectEqual(
					canonical(keys2.ExportBindings()),
					"Hd4Fill/Jump/Gamepad: KeyCode=ButtonX PressedThreshold=0.25",
					"saved against the later schema's defaults",
				);
			});

			// ---- Create's checks against what the instances refuse

			// HD4-5 (hunter, fixed: SchemaProblem, which Schema and Create run, refuses a Priority that isn't a whole number from -2147483648 to 2147483647, 2.5 included, since IAS reads it as 2): Schema and Create take any number as a context's Priority, but an InputContext holds an int32: math.huge, 1e12, 2^31 and NaN all land on -2147483648, the lowest priority there is, without a word (probed: 2.5 reads 2, -5 reads -5)
			test("a Priority Schema takes puts the context where the number says: a huge one on top, never at the bottom", () => {
				const wrong = new Array<string>();
				for (const value of [math.huge, 1e12, 2 ** 31, 0 / 0]) {
					const [schemaOk, schema] = pcall(() =>
						InputActions.Schema({
							Hd4Top: { Priority: value, Sink: true, Actions: { Tap: InputActions.Bool() } },
						}),
					);
					// refused, as a binding number a float can't hold is: fine
					if (!schemaOk) continue;
					const input = create(schema as unknown as AnySchema);
					const priority = input.Hd4Top.Instance.Priority;
					if (priority < 1000) wrong.push(`Priority ${value} -> the context's Priority reads ${priority}`);
				}
				expectEqual(
					wrong.join("; "),
					"",
					`API.md, Schema: "Schema throws on it at runtime too ..., as on an option of the wrong type"; Advanced.md, "Saving keybinds": a number a float property can't hold counts as not finite, "for Set too". Schema and Create took these Priorities, and the context, made with Sink: true to be on top, landed below every other (the IAS default is 1000)`,
				);
			});

			// HD4-4 (hunter, fixed: SchemaProblem, which Schema and Create run, checks an action's options: DisplayName a string, Enabled and TrackPrevious booleans, each may be left out): an action's DisplayName of the wrong type in a schema made without the builders passes Schema's and Create's checks (SchemaProblem checks no action option), and throws in the middle of Build, after Create filled another root handle's unbound binding (probed: Enabled = "no" doesn't throw, it reads true)
			test("an action option of the wrong type in a schema made without the builders: Create throws before changing anything", () => {
				const cases: Array<[string, unknown]> = [
					["DisplayName = {}", { Type: Enum.InputActionType.Bool, Bindings: {}, TrackPrevious: false, DisplayName: {} }],
				];
				const broken = new Array<string>();
				const seen = new Array<string>();
				for (const [what, action] of cases) {
					const contexts = contextsWithLate("Hd4Fill", HD4_FILL_PAD.Contexts.Hd4Fill, {
						Actions: { Tap: action },
					});
					if (contexts === undefined) {
						seen.push(`${what}: no order found`);
						continue;
					}
					const [schemaOk, schemaProblem] = pcall(() => InputActions.Schema(contexts as never));
					const folder = newFolder();
					const keys = create(HD4_FILL_KEYS, { Folder: folder });
					const padBinding = keys.Hd4Fill.Actions.Jump.Bindings.Gamepad;
					const [ok, made] = pcall(() =>
						InputActions.Create({ Contexts: contexts } as never, { Folder: folder, ResetOnFocusLoss: false }),
					);
					if (ok) (made as InputActions.Handle<{}>).Destroy();
					seen.push(`${what}: Schema ${schemaOk ? "takes it" : `throws ${schemaProblem}`}; Create ${ok ? "builds" : `throws ${made}`}; Jump's gamepad binding ${padBinding.Instance.KeyCode.Name}`);
					if (!ok && padBinding.Instance.KeyCode !== K.None)
						broken.push(`${what}: Create threw (${made}) after filling Jump's gamepad binding with ${padBinding.Instance.KeyCode.Name}`);
				}
				expectEqual(
					broken.join("\n"),
					"",
					`design spec §4: "Create makes every check that can throw before it changes anything ... so a Create that throws leaves the tree as it found it: it fills no other root handle's unbound binding". ${seen.join("; ")}`,
				);
			});

			test("worker, HD4-4, HD4-5: Schema and Create refuse an action option of the wrong type and a Priority a context can't hold, with the path", () => {
				const go = { Type: Enum.InputActionType.Bool, Bindings: {}, TrackPrevious: false };
				const cases: Array<[string, Record<string, unknown>, string]> = [
					["DisplayName = {}", { Actions: { Go: { ...go, DisplayName: {} } } }, "Hd4Bad/Go: DisplayName must be a string, not table"],
					["Enabled = \"no\"", { Actions: { Go: { ...go, Enabled: "no" } } }, "Hd4Bad/Go: Enabled must be a boolean, not string"],
					["TrackPrevious = 1", { Actions: { Go: { ...go, TrackPrevious: 1 } } }, "Hd4Bad/Go: TrackPrevious must be a boolean, not number"],
					["a builder given DisplayName = 5", { Actions: { Go: InputActions.Bool({}, { DisplayName: 5 as never }) } }, "Hd4Bad/Go: DisplayName must be a string, not number"],
					["Priority = 2.5", { Priority: 2.5, Actions: {} }, "Hd4Bad: Priority must be a whole number from -2147483648 to 2147483647, not 2.5"],
					["Priority = math.huge", { Priority: math.huge, Actions: {} }, "Hd4Bad: Priority must be a whole number"],
					["Priority = NaN", { Priority: 0 / 0, Actions: {} }, "Hd4Bad: Priority must be a whole number"],
					["Priority = 2^31", { Priority: 2 ** 31, Actions: {} }, "Hd4Bad: Priority must be a whole number"],
					["Priority = -2^31 - 1", { Priority: -(2 ** 31) - 1, Actions: {} }, "Hd4Bad: Priority must be a whole number"],
				];
				const wrong = new Array<string>();
				for (const [what, context, message] of cases) {
					const [schemaOk, schemaProblem] = pcall(() => InputActions.Schema({ Hd4Bad: context } as never));
					if (schemaOk || !contains(tostring(schemaProblem), `InputActions.Schema: ${message}`))
						wrong.push(`${what}: Schema ${schemaOk ? "took it" : `threw ${schemaProblem}`}`);
					const folder = newFolder();
					const [ok, made] = pcall(() =>
						InputActions.Create({ Contexts: { Hd4Bad: context } } as never, { Folder: folder, ResetOnFocusLoss: false }),
					);
					if (ok) (made as InputActions.Handle<{}>).Destroy();
					if (ok || !contains(tostring(made), `InputActions.Create: ${message}`))
						wrong.push(`${what}: Create ${ok ? "built it" : `threw ${made}`}`);
					if (folder.GetChildren().size() > 0) wrong.push(`${what}: Create left ${folder.GetChildren().size()} instances`);
				}
				expectEqual(wrong.join("\n"), "", "each is refused, before anything is made");
				// what a context holds is taken: the ends of the range, and the options left out
				for (const priority of [-(2 ** 31), 2 ** 31 - 1, -5, 0]) {
					const input = create(
						InputActions.Schema({ Hd4Edge: { Priority: priority, Actions: { Go: InputActions.Bool({}, { DisplayName: "Go", Enabled: false }) } } }),
					);
					expectEqual(input.Hd4Edge.Instance.Priority, priority, `Priority ${priority}`);
					expectEqual(input.Hd4Edge.Actions.Go.Instance.DisplayName, "Go", "DisplayName");
					expectEqual(input.Hd4Edge.Actions.Go.IsEnabled(), false, "Enabled");
				}
				const raw = create({
					Contexts: { Hd4Raw: { Actions: { Go: { Type: Enum.InputActionType.Bool, Bindings: {} } } } },
				} as never as AnySchema);
				expectTrue(raw.Hd4Raw !== undefined, "a raw action without TrackPrevious, DisplayName or Enabled");
			});

			// ---- saves on every device and action type

			test("a rebind of every device binding of every action type: the export sanitizes to itself and loads into the same bindings", () => {
				const input = create(HD4_SAVE);
				const actions = input.Hd4Save.Actions;
				actions.Jump.Bindings.KeyboardAndMouse.Set({ PrimaryModifier: K.LeftShift, PressedThreshold: 0.25 });
				actions.Jump.Bindings.Gamepad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.7, ReleasedThreshold: 0.6 });
				actions.Jump.Bindings.Touch.Set(K.TouchPosition);
				actions.Throttle.Bindings.KeyboardAndMouse.Set({ KeyCode: K.E });
				actions.Throttle.Bindings.Gamepad.Set({ Up: K.ButtonY, Down: K.ButtonA, Scale: 0.5 });
				actions.Throttle.Bindings.Touch.Set(K.TouchPinch);
				actions.Move.Bindings.KeyboardAndMouse.Set({ KeyCode: K.MouseDelta });
				actions.Move.Bindings.Gamepad.Set({ Up: K.DPadUp, Down: K.DPadDown });
				actions.Move.Bindings.Touch.Set({ KeyCode: K.TouchDelta, Vector2Scale: new Vector2(2, 2) });
				actions.Look.Bindings.KeyboardAndMouse.Set({ Vector2Scale: new Vector2(1, -1) });
				actions.Look.Bindings.Gamepad.Set({ ResponseCurve: 3 });
				actions.Fly.Bindings.KeyboardAndMouse.Set({ Forward: K.T, Vector3Scale: new Vector3(1, 2, 3) });
				actions.Fly.Bindings.Gamepad.Set({ Up: K.DPadUp, Down: K.DPadDown });
				actions.Fly.Bindings.Touch.Set({ Scale: 2 });
				actions.Point.Bindings.Touch.Set(K.TouchPosition);
				const save = input.ExportBindings();
				const clean = InputActions.SanitizeBindings(HD4_SAVE, save);
				expectEqual(canonical(clean), canonical(save), "SanitizeBindings keeps every entry of an export");
				for (const [what, json] of [["the export", save], ["the sanitized save", clean]] as const) {
					const other = create(HD4_SAVE);
					const result = other.ImportBindings(json);
					expectEqual(
						result.Skipped.map((entry) => `${entry.Path}: ${entry.Reason}`).join("; "),
						"",
						`design spec §7: "every export imports cleanly": ${what} ${json}`,
					);
					const mine = deviceBindings(actions).map(([path, binding]) => `${path} ${stateOf(binding)}`);
					const theirs = deviceBindings(other.Hd4Save.Actions).map(
						([path, binding]) => `${path} ${stateOf(binding)}`,
					);
					const differ = new Array<string>();
					mine.forEach((line, index) => {
						if (line !== theirs[index]) differ.push(`${line} -> ${theirs[index]}`);
					});
					expectEqual(differ.join("\n"), "", `${what} loads into the same bindings (${json})`);
					expectEqual(canonical(other.ExportBindings()), canonical(save), `${what}: exports the same`);
				}
			});

			// control for HD4-6 (hunter-devices-4-type-rules.ts): the runtime takes Set(Get()) on every binding
			test("Set given back what Get returned changes nothing and throws nothing, on every device binding of every action type", () => {
				const input = create(HD4_SAVE);
				const actions = input.Hd4Save.Actions;
				actions.Look.Bindings.KeyboardAndMouse.Set({ Vector2Scale: new Vector2(1, -1), DisplayName: "Look" });
				actions.Look.Bindings.Touch.Set({ KeyCode: K.TouchDelta, Scale: 2 });
				actions.Look.Bindings.Gamepad.Set({ ResponseCurve: 3 });
				actions.Point.Bindings.Gamepad.Set({ DisplayName: "Aim" } as never);
				actions.Jump.Bindings.Gamepad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.7 });
				const wrong = new Array<string>();
				for (const name of ["Jump", "Throttle", "Move", "Look", "Fly", "Point"] as const) {
					for (const device of ["KeyboardAndMouse", "Gamepad", "Touch"] as const) {
						const binding = actions[name].Bindings[device] as unknown as {
							Instance: InputBinding;
							Get(): unknown;
							Set(value: unknown): void;
						};
						const before = `${stateOf(binding.Instance)} ${binding.Instance.DisplayName}`;
						const [ok, problem] = pcall(() => binding.Set(binding.Get()));
						const after = `${stateOf(binding.Instance)} ${binding.Instance.DisplayName}`;
						if (!ok || before !== after)
							wrong.push(`${name}/${device}: ${ok ? `${before} -> ${after}` : `threw ${problem}`}`);
					}
				}
				expectEqual(wrong.join("\n"), "", "Set(Get()) at runtime");
				expectEqual(actions.Point.Bindings.Gamepad.Instance.DisplayName, "Aim", "a gamepad ViewportPosition binding takes a DisplayName at runtime");
			});

			test("a 0.6 save: SanitizeBindings keeps exactly the entries ImportBindings applies", () => {
				const old = encode({
					"Hd4Save/Jump/Keyboard": { KeyCode: "G" },
					"Hd4Save/Look/Mouse": { Scale: 0.05 },
					"Hd4Save/Jump/Gamepad": { KeyCode: "F" },
					"Hd4Save/Jump/Touch": { KeyCode: "ButtonA" },
					"Hd4Save/Move/Gamepad": { Up: "W", Down: "S" },
					"Hd4Save/Move/Virtual": { KeyCode: "Thumbstick1" },
					"Hd4Save/Throttle/KeyboardAndMouse": { KeyCode: "E", PrimaryModifier: "ButtonL1" },
					"Hd4Save/Jump/KeyboardAndMouse": { KeyCode: "H" },
					"Hd4Save/Look/Gamepad": { ResponseCurve: 2.5 },
					"Hd4Save/Look/KeyboardAndMouse": { ResponseCurve: 2 },
					"Hd4Save/Fly/Touch": { Up: "TouchPosition" },
					"Hd4Save/Point/Gamepad": { KeyCode: "MousePosition" },
					"Hd4Save/Move/Touch": { KeyCode: "TouchDelta", Scale: 3 },
				});
				const clean = InputActions.SanitizeBindings(HD4_SAVE, old);
				const input = create(HD4_SAVE);
				const result = input.ImportBindings(old);
				const applied = [...result.Applied];
				applied.sort();
				expectEqual(
					pathsOf(clean),
					applied.map((path) => path).join(", "),
					`design spec §7: SanitizeBindings "drops the same entries" (skipped: ${result.Skipped.map((entry) => `${entry.Path}: ${entry.Reason}`).join("; ")})`,
				);
				const reasons = result.Skipped.map((entry) => `${entry.Path}: ${entry.Reason}`).join("; ");
				expectTrue(contains(reasons, "Hd4Save/Look/Mouse: Mouse is not a device"), reasons);
				expectTrue(contains(reasons, "Hd4Save/Jump/Gamepad: F is a KeyboardAndMouse key"), reasons);
			});

			// ---- Set's merges

			test("Set with a part that leaves the keys as they are leaves a held action held, on every device", () => {
				const input = create(HD4_SAVE);
				const jump = input.Hd4Save.Actions.Jump;
				const changed = new Array<string>();
				for (const [what, set] of [
					["PressedThreshold on the keyboard's", () => jump.Bindings.KeyboardAndMouse.Set({ PressedThreshold: 0.9 })],
					["DisplayName on the gamepad's (unbound)", () => jump.Bindings.Gamepad.Set({ DisplayName: "Jump" })],
					["DisplayImage on the touch binding (unbound)", () => jump.Bindings.Touch.Set({ DisplayImage: "rbxassetid://1" })],
					["ReleasedThreshold on the gamepad's (unbound)", () => jump.Bindings.Gamepad.Set({ ReleasedThreshold: 0.1 })],
				] as const) {
					jump.Fire(true);
					frames(1);
					set();
					frames(2);
					if (!jump.IsPressed()) changed.push(what);
					jump.Fire(false);
					frames(1);
				}
				expectEqual(
					changed.join(", "),
					"",
					`API.md: "a change that leaves the keys as they are (a threshold, the same key) leaves it held"`,
				);
				// control: a key change releases it
				jump.Fire(true);
				frames(1);
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				eventually(() => !jump.IsPressed(), "a key change releases it");
			});

			test("Set with parts switches forms on each device: a KeyCode clears the composites, a composite the KeyCode, the tuning stays", () => {
				const input = create(HD4_SAVE);
				const { Throttle, Move, Look } = input.Hd4Save.Actions;
				const steps = new Array<string>();
				Throttle.Bindings.Gamepad.Set({ Scale: 2 });
				Throttle.Bindings.Gamepad.Set({ Up: K.ButtonY });
				steps.push(stateOf(Throttle.Bindings.Gamepad.Instance));
				Throttle.Bindings.Gamepad.Set({ KeyCode: K.ButtonL2 });
				steps.push(stateOf(Throttle.Bindings.Gamepad.Instance));
				Move.Bindings.KeyboardAndMouse.Set({ KeyCode: K.TrackpadPan, Scale: 3 });
				Move.Bindings.KeyboardAndMouse.Set({ Left: K.J });
				steps.push(stateOf(Move.Bindings.KeyboardAndMouse.Instance));
				Look.Bindings.Gamepad.Set({ Up: K.DPadUp });
				const curveOnComposite = Look.Bindings.Gamepad.Get().ResponseCurve;
				Look.Bindings.Gamepad.Set({ KeyCode: K.Thumbstick1 });
				steps.push(stateOf(Look.Bindings.Gamepad.Instance));
				expectEqual(
					steps.join(" | "),
					[
						"Up=ButtonY P0.5 R0.2 S2 V21, 1 V31, 1, 1 C1",
						"KeyCode=ButtonL2 P0.5 R0.2 S2 V21, 1 V31, 1, 1 C1",
						"Left=J P0.5 R0.2 S3 V21, 1 V31, 1, 1 C1",
						"KeyCode=Thumbstick1 P0.5 R0.2 S1 V21, 1 V31, 1, 1 C2",
					].join(" | "),
					"Advanced.md: an object merges; a KeyCode in it clears the composite directions, a composite direction clears the KeyCode",
				);
				expectEqual(curveOnComposite, undefined, "Get shows no ResponseCurve on composites");
			});

			test("ReleasedThreshold through parts: stored above PressedThreshold, read clamped, saved as read, sanitized and loaded the same", () => {
				const input = create(HD4_SAVE);
				const pad = input.Hd4Save.Actions.Jump.Bindings.Gamepad;
				pad.Set(K.ButtonR2);
				pad.Set({ ReleasedThreshold: 0.8 });
				const clamped = pad.Get().ReleasedThreshold;
				pad.Set({ PressedThreshold: 0.9 });
				const raised = pad.Get().ReleasedThreshold;
				expectEqual(`${clamped} ${raised}`, "0.5 0.8", 'API.md: "Set({ ReleasedThreshold: 0.8 }) on a binding whose PressedThreshold is 0.5 reads (and Get() returns) 0.5 ...; after Set({ PressedThreshold: 0.9 }) it reads 0.8"');
				const save = input.ExportBindings();
				const clean = InputActions.SanitizeBindings(HD4_SAVE, save);
				expectEqual(canonical(clean), canonical(save), "sanitized");
				const other = create(HD4_SAVE);
				other.ImportBindings(clean);
				expectEqual(
					stateOf(other.Hd4Save.Actions.Jump.Bindings.Gamepad.Instance),
					stateOf(pad.Instance),
					`loaded (${save})`,
				);
			});

			// ---- a capture across the Server Authority swap

			test("a binding's Capture and CaptureChord running across the swap land on the server's copy", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const copy = handMadeCopy("Hd4Swap", ["Jump"]);
				const input = create(HD4_SWAP, { PlayerFolderName: copy.folder.Name, Timeout: 1000 });
				const context = input.Hd4Swap;
				expectTrue(!context.IsLinkedToServer(), "on the stand-in: the copy lacks Duck");
				const jump = context.Actions.Jump;
				const changed = recordSignal(input.BindingsChanged);
				let captured: Enum.KeyCode | undefined;
				const stopCapture = jump.Bindings.Gamepad.Capture("KeyCode", (key) => {
					captured = key;
				});
				defer(stopCapture);
				let chord: InputActions.Chord | undefined;
				let chordDone = false;
				const stopChord = context.Actions.Duck.Bindings.KeyboardAndMouse.CaptureChord((got) => {
					chord = got;
					chordDone = true;
				});
				defer(stopChord);
				// the chord's modifier goes down on the stand-in
				real.Press(K.LeftControl);
				eventually(() => UserInputService.IsKeyDown(K.LeftControl), `Ctrl down${real.FocusNote()}`);
				frames(2);
				const duck = new Instance("InputAction");
				duck.Name = "Duck";
				duck.Parent = copy.context;
				eventually(() => context.IsLinkedToServer(), "the swap once Duck is there");
				real.Tap(K.ButtonX);
				eventually(() => captured !== undefined, `the capture${real.FocusNote()}`);
				real.Press(K.G);
				frames(2);
				real.Release(K.G);
				real.Release(K.LeftControl);
				eventually(() => chordDone, `the chord${real.FocusNote()}`);
				frames(2);
				const padBinding = jump.Bindings.Gamepad.Instance;
				const duckBinding = context.Actions.Duck.Bindings.KeyboardAndMouse.Instance;
				expectEqual(
					`${captured?.Name} ${keysOf(padBinding)} on the copy: ${padBinding.IsDescendantOf(copy.context)}; ${chord?.PrimaryModifier?.Name}+${chord?.KeyCode.Name} ${keysOf(duckBinding)} on the copy: ${duckBinding.IsDescendantOf(copy.context)}`,
					"ButtonX KeyCode=ButtonX on the copy: true; LeftControl+G PrimaryModifier=LeftControl KeyCode=G on the copy: true",
					"design spec §8: the handles point at the copy; §6: a capture applies the key to its binding",
				);
				expectTrue(
					changed.includes("Hd4Swap/Jump/Gamepad") && changed.includes("Hd4Swap/Duck/KeyboardAndMouse"),
					`BindingsChanged: ${changed.join(", ")}`,
				);
				const save = input.ExportBindings();
				expectTrue(
					contains(save, '"Hd4Swap/Jump/Gamepad":{"KeyCode":"ButtonX"}') &&
						contains(save, "Hd4Swap/Duck/KeyboardAndMouse"),
					save,
				);
			});
		});
	}
}
