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
import { HttpService, UserInputService } from "@rbxts/services";
import { frames, newFolder, recordSignal } from "./helpers";
import { emptyPoint, RealInput, realInput } from "./virtual";

const K = Enum.KeyCode;

/** `Create`, destroyed after the test; it holds keys, so no focus-loss reset */
function create<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
	folder: Instance = newFolder(),
): InputActions.Handle<S> {
	const input = InputActions.Create(schema, { Folder: folder, ResetOnFocusLoss: false });
	defer(() => input.Destroy());
	return input;
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

function contains(text: string, part: string) {
	return text.find(part, 1, true)[0] !== undefined;
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

/** What a slot-level capture needs of a binding handle, whatever the action type */
interface ISlotCapture {
	readonly Name: string;
	readonly Instance: InputBinding;
	Capture(slot: never, callback: (key: Enum.KeyCode | undefined) => void): () => void;
}

/** A few frames in which nothing may arrive */
function quiet() {
	frames(6);
}

/** Taps `key` for a capture and waits until `done` holds */
function tapFor(real: RealInput, key: Enum.KeyCode, done: () => boolean, what: string) {
	real.Tap(key);
	eventually(done, `${what}${real.FocusNote()}`);
}

// ---- placeholders in a sinking context (design spec §4, §6: "A sinking context blocks only the keys it binds")

const HD3_SINK = InputActions.Schema({
	Hd3SinkLow: {
		// worker: above the contexts the other sections leave running. Priority 10 lost H whenever the
		// server-authority section ran first: Destroy gives its template back its Enabled, and
		// ReplicatedStorage.InputActionsTestTemplates.SaGameplay (Priority 1700, Sink, Emote on H)
		// then sinks H below it (probed, round 3)
		Priority: 4000,
		Actions: {
			Key: InputActions.Bool({ KeyboardAndMouse: K.H }),
			Click: InputActions.Bool({ KeyboardAndMouse: K.MouseLeftButton, Touch: K.TouchPosition }),
			Wheel: InputActions.Direction1D({ KeyboardAndMouse: K.MouseWheel }),
		},
	},
	Hd3SinkHigh: {
		Priority: 5000,
		Sink: true,
		Actions: {
			// every device's binding unbound: three placeholders each
			Empty: InputActions.Bool(),
			EmptyAxis: InputActions.Direction1D(),
			EmptyMove: InputActions.Direction2D(),
			EmptyPoint: InputActions.ViewportPosition(),
			// bound on the pad only: its KeyboardAndMouse and Touch bindings are placeholders
			PadOnly: InputActions.Bool({ Gamepad: K.ButtonY }),
		},
	},
});

// ---- a Manager-made binding for a device the schema leaves out (design spec §4, §7)

const HD3_MANAGER = InputActions.Schema({
	Hd3Mgr: { Actions: { Look: InputActions.Direction2D({ KeyboardAndMouse: K.MouseDelta }) } },
});
/** The same as a Server Authority context, whose bindings come from the template in the folder */
const HD3_SA_MANAGER = InputActions.Schema({
	Hd3SaMgr: {
		ServerAuthority: true,
		Actions: { Look: InputActions.Direction2D({ KeyboardAndMouse: K.MouseDelta }) },
	},
});

/** The Input Action Manager's Hd3Mgr context: Look with a `LookGamepad` binding on the right stick */
function managerLook(folder: Instance, name = "Hd3Mgr") {
	const context = new Instance("InputContext");
	context.Name = name;
	const look = new Instance("InputAction");
	look.Name = "Look";
	look.Type = Enum.InputActionType.Direction2D;
	look.Parent = context;
	const pad = new Instance("InputBinding");
	pad.Name = "LookGamepad";
	pad.KeyCode = K.Thumbstick2;
	pad.Parent = look;
	context.Parent = folder;
	return folder;
}

// ---- one-field captures and saves (design spec §6, §7)

const HD3_FIELDS = InputActions.Schema({
	Hd3Fields: {
		Actions: {
			// a chord on the keyboard, no gamepad key
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.S, PrimaryModifier: K.LeftControl },
			}),
			// composites on both devices, a modifier on the pad's
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Up: K.W, Down: K.S },
				Gamepad: { Up: K.ButtonY, Down: K.ButtonA, PrimaryModifier: K.ButtonL1 },
			}),
			// the keyboard only: the Gamepad binding is a placeholder
			Duck: InputActions.Bool({ KeyboardAndMouse: K.C }),
			// a chord for CaptureChord to replace
			Build: InputActions.Bool({ KeyboardAndMouse: K.B }),
		},
	},
});

// ---- a binding's Capture on every kind of slot (design spec §6)

const HD3_SLOTS = InputActions.Schema({
	Hd3Slots: {
		Actions: {
			Lean: InputActions.Direction1D({
				Gamepad: { KeyCode: K.ButtonL2, PrimaryModifier: K.ButtonL1 },
			}),
			Fly: InputActions.Direction3D({ KeyboardAndMouse: { Forward: K.T, Backward: K.G } }),
			Look: InputActions.Direction2D({ KeyboardAndMouse: K.MouseDelta }),
			Point: InputActions.ViewportPosition({ KeyboardAndMouse: K.MousePosition }),
		},
	},
});

// ---- Set with a tuning alone (API.md, "Binding shapes": `Set({ PressedThreshold: 0.9 })`)

const HD3_TUNE = InputActions.Schema({
	Hd3Tune: {
		Actions: {
			Jump: InputActions.Bool({ Gamepad: K.ButtonR2 }),
			Look: InputActions.Direction2D({ Gamepad: K.Thumbstick2 }),
		},
	},
});

const EMPTY_SAVE = '{"Version":1,"Bindings":{}}';

/**
 * Hunt round 3 on device bindings (0.7.0): the placeholders every action now has in a sinking
 * context, a save of a Manager binding the schema leaves out through SanitizeBindings, the one-field
 * captures through a save, and a binding's Capture on every kind of slot
 */
@Provider({ activeIn: ["testing"] })
export class HunterDevices3Tests implements OnStart {
	onStart() {
		defineTests("hunter-devices-3", () => {
			// ---- placeholders sink nothing

			test("a sinking context's unbound device bindings sink no key, click, tap or wheel", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = create(HD3_SINK);
				const low = input.Hd3SinkLow.Actions;
				const missed = new Array<string>();

				real.Press(K.H);
				const keyHeld = pcall(() => eventually(() => low.Key.IsPressed(), "H"))[0];
				real.Release(K.H);
				if (!keyHeld) missed.push("the key H");
				frames(3);

				const point = emptyPoint();
				real.MouseDown(point);
				const clickHeld = pcall(() => eventually(() => low.Click.IsPressed(), "click"))[0];
				real.MouseUp();
				if (!clickHeld) missed.push(getProject() === "touch" ? "a tap" : "a click");
				frames(3);

				if (getProject() !== "touch") {
					const wheel = recordSignal(low.Wheel.StateChanged);
					real.Wheel(1, point);
					const moved = pcall(() =>
						eventually(() => wheel.some((value) => value !== 0), "wheel"),
					)[0];
					if (!moved) missed.push("a wheel notch");
				}

				// control: once the sinking context binds H, H no longer reaches the low context
				input.Hd3SinkHigh.Actions.Empty.Bindings.KeyboardAndMouse.Set(K.H);
				frames(2);
				real.Press(K.H);
				frames(6);
				const sunk = !low.Key.IsPressed() && input.Hd3SinkHigh.Actions.Empty.IsPressed();
				real.Release(K.H);
				expectEqual(
					missed.join(", "),
					"",
					`design spec §6 "A sinking context blocks only the keys it binds"; §4: every action has the three device bindings, a device the schema leaves out unbound: a Priority 5000 sinking context whose actions have only unbound bindings (and ButtonY) kept these from a Priority 4000 context's actions${real.FocusNote()}`,
				);
				expectTrue(
					sunk,
					`control: the sinking context sinks H once it binds it${real.FocusNote()}`,
				);
			});

			// ---- SanitizeBindings and a Manager binding the schema leaves out

			// HD3-1 (hunter, fixed: SanitizeBindings doesn't take the binding's default KeyCode from the schema, which a binding in the folder or the template overrides: a ResponseCurve an entry doesn't settle with its own KeyCode or a composite direction stays on a Gamepad binding, for the import to check against the binding it finds; on a KeyboardAndMouse or Touch binding, which can't hold a thumbstick, it is still dropped): SanitizeBindings checks a saved ResponseCurve against the schema's KeyCode (None for a device the schema leaves out), ImportBindings against the binding's default (the Manager's or the template's stick): the server drops a tuning the client exports and loads
			test("SanitizeBindings keeps a tuning of a Manager binding the schema leaves out, as ImportBindings does", () => {
				const input = create(HD3_MANAGER, managerLook(newFolder()));
				const pad = input.Hd3Mgr.Actions.Look.Bindings.Gamepad;
				expectEqual(pad.Instance.KeyCode, K.Thumbstick2, "the Manager's LookGamepad, adopted");
				// a player's tuning of the right stick
				pad.Set({ KeyCode: K.Thumbstick2, ResponseCurve: 2 });
				const save = input.ExportBindings();
				expectTrue(contains(save, '"Hd3Mgr/Look/Gamepad":{"ResponseCurve":2}'), save);

				// the client's own load of that save applies it
				const other = create(HD3_MANAGER, managerLook(newFolder()));
				const loaded = other.ImportBindings(save);
				const otherCurve = other.Hd3Mgr.Actions.Look.Bindings.Gamepad.Instance.ResponseCurve;
				expectEqual(
					`${loaded.Applied.join(",")} ${otherCurve}`,
					"Hd3Mgr/Look/Gamepad 2",
					"control: ImportBindings applies the export",
				);

				// what the server stores, and what the next session loads from it
				const clean = InputActions.SanitizeBindings(HD3_MANAGER, save);
				const later = create(HD3_MANAGER, managerLook(newFolder()));
				later.ImportBindings(clean);
				const nextCurve = later.Hd3Mgr.Actions.Look.Bindings.Gamepad.Instance.ResponseCurve;

				// the same with a Server Authority template (design spec §8: "defaults from the template
				// ReplicatedStorage.Inputs.<Context>.<Action> bindings when present"): a stand-in here
				const sa = InputActions.Create(HD3_SA_MANAGER, {
					Folder: managerLook(newFolder(), "Hd3SaMgr"),
					PlayerFolderName: "Hd3NoServer",
					Timeout: 1000,
					ResetOnFocusLoss: false,
				});
				defer(() => sa.Destroy());
				const saPad = sa.Hd3SaMgr.Actions.Look.Bindings.Gamepad;
				saPad.Set({ KeyCode: K.Thumbstick2, ResponseCurve: 2 });
				const saSave = sa.ExportBindings();
				const saClean = InputActions.SanitizeBindings(HD3_SA_MANAGER, saSave);
				expectEqual(
					`${clean} | ${saClean}`,
					`${save} | ${saSave}`,
					`API.md: SanitizeBindings "Runs the ImportBindings checks against the schema alone and returns a save with only the valid entries. ... It keeps the device paths of every action, also those the schema leaves out"; Advanced.md: "On the server, clean what a client sends before storing it". The client's ImportBindings applies "Hd3Mgr/Look/Gamepad" (its default KeyCode is the Manager's Thumbstick2), SanitizeBindings drops it (it reads the schema's KeyCode for a device the schema leaves out: None), and the next session loads ResponseCurve ${nextCurve}, not 2; a Server Authority context's template binding the same (after the "|")`,
				);
				// worker, HD3-1: the next session loads it; without the Manager's stick, the import skips it
				expectEqual(nextCurve, 2, "the next session's ResponseCurve");
				const bare = create(HD3_MANAGER);
				const result = bare.ImportBindings(clean);
				expectEqual(
					result.Skipped.map((entry) => `${entry.Path}: ${entry.Reason}`).join("; "),
					"Hd3Mgr/Look/Gamepad: ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode",
					"the import checks the binding it finds: unbound here",
				);
			});

			// ---- the Touch binding through a save

			test("the Touch bindings' keys through a save: export, SanitizeBindings, import", () => {
				const input = create(HD3_SINK);
				const actions = input.Hd3SinkHigh.Actions;
				actions.Empty.Bindings.Touch.Set(K.TouchPosition);
				actions.EmptyAxis.Bindings.Touch.Set(K.TouchPinch);
				actions.EmptyMove.Bindings.Touch.Set({ KeyCode: K.TouchDelta, Scale: 2 });
				actions.EmptyPoint.Bindings.Touch.Set(K.Touch);
				const save = input.ExportBindings();
				const clean = InputActions.SanitizeBindings(HD3_SINK, save);
				const other = create(HD3_SINK);
				const result = other.ImportBindings(save);
				const otherActions = other.Hd3SinkHigh.Actions;
				expectEqual(
					result.Skipped.map((entry) => `${entry.Path}: ${entry.Reason}`).join("; "),
					"",
					`design spec §7: "every export imports cleanly" (${save})`,
				);
				expectEqual(canonical(clean), canonical(save), "SanitizeBindings keeps every entry");
				expectEqual(
					[
						otherActions.Empty.Bindings.Touch,
						otherActions.EmptyAxis.Bindings.Touch,
						otherActions.EmptyMove.Bindings.Touch,
						otherActions.EmptyPoint.Bindings.Touch,
					]
						.map((binding) => keysOf(binding.Instance))
						.join("; "),
					"KeyCode=TouchPosition; KeyCode=TouchPinch; KeyCode=TouchDelta; KeyCode=TouchPosition",
					`the keys load (${save})`,
				);
			});

			// ---- Create and the options Schema refuses

			// HD3-2 (hunter, fixed: CheckBuild runs Schema's checks, SchemaProblem, shared with Schema, options included; Create's parameter refuses the option at compile time, hunter-devices-3-type-rules.ts): Create checks the names Schema refuses (HD2-5) but not its options: a schema made without Schema with a misspelt ServerAuthority compiles and builds a local context without a word, the case design spec §4 gives for the check
			test("Create refuses a misspelt context option in a schema made without Schema, as Schema does", () => {
				const actions = { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) };
				const fromSchema = expectThrows(() =>
					InputActions.Schema({ Hd3Opt: { ServerAuthorty: true, Actions: actions } } as never),
				);
				// the types refuse it now (CheckContexts on Create's parameter): a cast, as for contexts
				// put together at run time
				const raw = { Contexts: { Hd3Opt: { ServerAuthorty: true, Actions: actions } } };
				const folder = newFolder();
				const [ok, made] = pcall(() =>
					InputActions.Create(raw as never, { Folder: folder, ResetOnFocusLoss: false }),
				);
				let built = "";
				if (ok) {
					const input = made as unknown as InputActions.Handle<typeof raw.Contexts>;
					defer(() => input.Destroy());
					built = input.Hd3Opt.Instance.GetFullName();
				}
				expectFalse(
					ok,
					`design spec §4: a misspelt option "is a compile error ..., and Schema throws on it at runtime, naming it ...: a misspelt ServerAuthority would otherwise make the context local without a word"; API.md: Create throws "on the names Schema refuses (a schema made without Schema)". Schema refuses it (${fromSchema}); Create, given the same contexts without Schema, built Hd3Opt as a local context, ${built}, and said nothing`,
				);
				// worker, HD3-2: with Schema's message, and nothing made
				const option = `Hd3Opt: unknown option "ServerAuthorty"`;
				expectTrue(contains(fromSchema, option), fromSchema);
				expectTrue(contains(tostring(made), `InputActions.Create: ${option}`), tostring(made));
				expectEqual(folder.GetChildren().size(), 0, "nothing made");
			});

			// worker, HD3-2: every other check of Schema too, on a schema made without it
			test("Create refuses what Schema refuses, with its message: an option's type, a binding, a missing Actions", () => {
				const actions = { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) };
				const cases: Array<[string, unknown, string]> = [
					[
						"an option of the wrong type",
						{ Hd3Bad: { Priority: "high", Actions: actions } },
						"Hd3Bad: Priority must be a number, not string",
					],
					["no Actions", { Hd3Bad: { Sink: true } }, "Hd3Bad: missing Actions"],
					[
						"another device's key, in an action made without a builder",
						{
							Hd3Bad: {
								Actions: {
									Jump: {
										Type: Enum.InputActionType.Bool,
										Bindings: { Gamepad: K.Space },
										TrackPrevious: false,
									},
								},
							},
						},
						"Hd3Bad/Jump/Gamepad: Space is a KeyboardAndMouse key",
					],
					[
						"a ResponseCurve on a binding that doesn't end on a thumbstick",
						{
							Hd3Bad: {
								Actions: {
									Look: {
										Type: Enum.InputActionType.Direction2D,
										Bindings: { Gamepad: { Up: K.DPadUp, ResponseCurve: 2 } },
										TrackPrevious: false,
									},
								},
							},
						},
						"Hd3Bad/Look/Gamepad: ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode",
					],
					[
						"something that isn't an action",
						{ Hd3Bad: { Actions: { Jump: true } } },
						"Hd3Bad/Jump: not an action",
					],
				];
				const wrong = new Array<string>();
				for (const [what, contexts, message] of cases) {
					const folder = newFolder();
					const [schemaOk, fromSchema] = pcall(() => InputActions.Schema(contexts as never));
					const [ok, made] = pcall(() =>
						InputActions.Create({ Contexts: contexts } as never, {
							Folder: folder,
							ResetOnFocusLoss: false,
						}),
					);
					if (ok) (made as InputActions.Handle<{}>).Destroy();
					const fromCreate = tostring(made);
					if (
						schemaOk ||
						ok ||
						!contains(tostring(fromSchema), `InputActions.Schema: ${message}`) ||
						!contains(fromCreate, `InputActions.Create: ${message}`) ||
						folder.GetChildren().size() !== 0
					) {
						wrong.push(
							`${what}: Schema ${tostring(fromSchema)}; Create ${fromCreate}; ${folder.GetChildren().size()} made`,
						);
					}
				}
				expectEqual(wrong.join("\n"), "", "Schema's checks, in Create");
			});

			// ---- Set merges one tuning property

			// HD3-3 (hunter, fixed: Set checks a ResponseCurve against the KeyCode the binding has after the merge, as the import does; its type takes part of an object form, BindingPart, hunter-devices-3-type-rules.ts): Set({ ResponseCurve: 3 }) throws on a binding that holds a thumbstick, though objects merge into the binding, the import applies the same entry there, and Advanced.md says Set refuses it on a binding that doesn't end on one (the type side, Set({ PressedThreshold: 0.9 }) as API.md writes it, is in hunter-devices-3-type-rules.ts)
			test("Set merges a tuning alone: PressedThreshold on a trigger, ResponseCurve on a stick, as an import does", () => {
				const input = create(HD3_TUNE);
				const jump = input.Hd3Tune.Actions.Jump.Bindings.Gamepad;
				const look = input.Hd3Tune.Actions.Look.Bindings.Gamepad;
				// as API.md writes it; the types take both now
				const [thresholdOk, thresholdProblem] = pcall(() => jump.Set({ PressedThreshold: 0.9 }));
				expectTrue(
					thresholdOk && math.abs(jump.Instance.PressedThreshold - 0.9) < 1e-6,
					`API.md: "after Set({ PressedThreshold: 0.9 }) it reads 0.8": ${thresholdProblem}`,
				);
				const [curveOk, curveProblem] = pcall(() => look.Set({ ResponseCurve: 3 }));
				// control: the same entry through a save applies onto the stick the binding holds
				const other = create(HD3_TUNE);
				const loaded = other.ImportBindings(
					'{"Version":1,"Bindings":{"Hd3Tune/Look/Gamepad":{"ResponseCurve":3}}}',
				);
				expectEqual(
					loaded.Applied.join(","),
					"Hd3Tune/Look/Gamepad",
					"control: the import applies it",
				);
				expectTrue(
					curveOk && look.Instance.ResponseCurve === 3,
					`Advanced.md, "Saving keybinds": an import skips "a ResponseCurve on a binding that doesn't end on a thumbstick KeyCode (as Set refuses it)", and "An object merges into the binding"; this binding ends on ${look.Instance.KeyCode.Name}, and the import applies { ResponseCurve: 3 } there, but Set threw: ${curveProblem}`,
				);
			});

			// worker, HD3-3: Set still refuses a ResponseCurve on a binding that doesn't end on a thumbstick after the merge
			test("Set refuses a ResponseCurve where the merge doesn't end on a thumbstick, and writes nothing", () => {
				const input = create(HD3_TUNE);
				const look = input.Hd3Tune.Actions.Look.Bindings.Gamepad;
				const changed = recordSignal(input.BindingsChanged);
				const refused = new Array<string>();
				const refuse = (what: string, set: () => void) => {
					const [ok, problem] = pcall(set);
					if (
						ok ||
						!contains(
							tostring(problem),
							"ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode",
						)
					)
						refused.push(`${what}: ${ok ? "applied" : tostring(problem)}`);
				};
				// a composite direction in the same object clears the stick
				refuse("a composite beside it", () =>
					look.Set({ Up: K.DPadUp, ResponseCurve: 2 } as never),
				);
				// the keyboard's binding of the action is unbound: no thumbstick there
				refuse("on the unbound keyboard binding", () =>
					input.Hd3Tune.Actions.Look.Bindings.KeyboardAndMouse.Set({ ResponseCurve: 2 } as never),
				);
				expectEqual(refused.join("; "), "", "the merges that don't end on a thumbstick throw");
				frames(2); // a BindingsChanged would have arrived under Deferred signals
				expectEqual(
					`${keysOf(look.Instance)} ${look.Instance.ResponseCurve} ${changed.size()}`,
					"KeyCode=Thumbstick2 1 0",
					"nothing written, no BindingsChanged",
				);
				// on D-pad composites, a ResponseCurve alone throws; with the stick's KeyCode it applies
				look.Set({ Up: K.DPadUp, Down: K.DPadDown });
				refuse("alone on composites", () => look.Set({ ResponseCurve: 2 }));
				expectEqual(refused.join("; "), "", "alone on composites");
				look.Set({ KeyCode: K.Thumbstick1, ResponseCurve: 2 });
				expectEqual(
					`${keysOf(look.Instance)} ${look.Instance.ResponseCurve}`,
					"KeyCode=Thumbstick1 2",
				);
			});

			// ---- one-field captures through a save

			test("one-field captures on both devices: the export sanitizes to itself and loads into the same keys", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = create(HD3_FIELDS);
				const actions = input.Hd3Fields.Actions;
				const captured = new Array<string>();
				const field = (action: InputActions.CaptureAction, key: Enum.KeyCode) => {
					const before = captured.size();
					const stop = action.Capture((got, device) =>
						captured.push(`${action.Name} ${got?.Name ?? "cancelled"} ${device}`),
					);
					defer(stop);
					tapFor(real, key, () => captured.size() > before, `${action.Name} captures ${key.Name}`);
					quiet();
				};
				field(actions.QuickSave, K.F); // Ctrl+S becomes F
				field(actions.Throttle, K.ButtonX); // the pad's composite with ButtonL1 becomes ButtonX
				field(actions.Throttle, K.E); // the keyboard's W/S composite becomes E
				field(actions.Duck, K.ButtonY); // the pad's placeholder becomes ButtonY
				// a chord on the keyboard: Ctrl, then Z, then K
				let chorded: string | undefined;
				const stopChord = actions.Build.CaptureChord((chord, device) => {
					chorded = `${chord?.PrimaryModifier?.Name}+${chord?.SecondaryModifier?.Name}+${chord?.KeyCode.Name} ${device}`;
				});
				defer(stopChord);
				for (const key of [K.LeftControl, K.Z, K.K]) {
					real.Press(key);
					eventually(() => UserInputService.IsKeyDown(key), `${key.Name} down${real.FocusNote()}`);
					frames(2);
				}
				real.Release(K.K);
				real.Release(K.Z);
				real.Release(K.LeftControl);
				eventually(() => chorded !== undefined, `the chord${real.FocusNote()}`);
				quiet();
				expectEqual(
					captured.join(", "),
					"QuickSave F KeyboardAndMouse, Throttle ButtonX Gamepad, Throttle E KeyboardAndMouse, Duck ButtonY Gamepad",
					"the callbacks",
				);
				expectEqual(chorded, "LeftControl+Z+K KeyboardAndMouse", "the chord");

				const bindings = [
					actions.QuickSave.Bindings.KeyboardAndMouse,
					actions.Throttle.Bindings.KeyboardAndMouse,
					actions.Throttle.Bindings.Gamepad,
					actions.Duck.Bindings.Gamepad,
					actions.Build.Bindings.KeyboardAndMouse,
				];
				const keys = bindings.map((binding) => `${binding.Name}: ${keysOf(binding.Instance)}`);
				expectEqual(
					keys.join("; "),
					"KeyboardAndMouse: KeyCode=F; KeyboardAndMouse: KeyCode=E; Gamepad: KeyCode=ButtonX; Gamepad: KeyCode=ButtonY; KeyboardAndMouse: PrimaryModifier=LeftControl SecondaryModifier=Z KeyCode=K",
					"design spec §6: the one-field Capture makes the binding that key alone",
				);

				const save = input.ExportBindings();
				const clean = InputActions.SanitizeBindings(HD3_FIELDS, save);
				expectEqual(
					canonical(clean),
					canonical(save),
					"every entry of the export is valid: SanitizeBindings keeps it as it is",
				);
				const other = create(HD3_FIELDS);
				const result = other.ImportBindings(save);
				expectEqual(
					result.Skipped.map((entry) => `${entry.Path}: ${entry.Reason}`).join("; "),
					"",
					`design spec §7: "every export imports cleanly" (${save})`,
				);
				const otherActions = other.Hd3Fields.Actions;
				const otherBindings = [
					otherActions.QuickSave.Bindings.KeyboardAndMouse,
					otherActions.Throttle.Bindings.KeyboardAndMouse,
					otherActions.Throttle.Bindings.Gamepad,
					otherActions.Duck.Bindings.Gamepad,
					otherActions.Build.Bindings.KeyboardAndMouse,
				];
				expectEqual(
					otherBindings.map((binding) => `${binding.Name}: ${keysOf(binding.Instance)}`).join("; "),
					keys.join("; "),
					`the save loads into the same keys (${save})`,
				);
				expectEqual(canonical(other.ExportBindings()), canonical(save), "and exports the same");
				other.ResetBindings();
				expectEqual(other.ExportBindings(), EMPTY_SAVE, "ResetBindings: back to the defaults");
			});

			// ---- a binding's Capture on every kind of slot

			test("a binding's Capture on each slot: a composite clears the KeyCode, a KeyCode the composites, modifiers stay", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = create(HD3_SLOTS);
				const actions = input.Hd3Slots.Actions;
				const slot = (binding: ISlotCapture, name: string, key: Enum.KeyCode) => {
					let got: Enum.KeyCode | undefined;
					const stop = binding.Capture(name as never, (captured) => {
						got = captured;
					});
					defer(stop);
					tapFor(
						real,
						key,
						() => got !== undefined,
						`${binding.Name} ${name} captures ${key.Name}`,
					);
					quiet();
					return keysOf(binding.Instance);
				};
				const lean: ISlotCapture = actions.Lean.Bindings.Gamepad;
				const steps = [
					slot(lean, "Up", K.ButtonX),
					slot(lean, "Down", K.ButtonY),
					slot(lean, "SecondaryModifier", K.ButtonA),
					slot(lean, "KeyCode", K.ButtonR2),
				];
				expectEqual(
					steps.join(" | "),
					[
						"PrimaryModifier=ButtonL1 Up=ButtonX",
						"PrimaryModifier=ButtonL1 Up=ButtonX Down=ButtonY",
						"PrimaryModifier=ButtonL1 SecondaryModifier=ButtonA Up=ButtonX Down=ButtonY",
						"PrimaryModifier=ButtonL1 SecondaryModifier=ButtonA KeyCode=ButtonR2",
					].join(" | "),
					"design spec §6: a binding's Capture fills one slot: a composite direction clears the KeyCode, a KeyCode the composites, and the modifiers stay",
				);
				const fly: ISlotCapture = actions.Fly.Bindings.KeyboardAndMouse;
				expectEqual(
					slot(fly, "Up", K.Y),
					"Up=Y Forward=T Backward=G",
					"Direction3D: Up beside Forward and Backward",
				);

				// Direction2D and ViewportPosition KeyCode slots: no key that goes down fits them
				const nothing = new Array<string>();
				const look = actions.Look.Bindings.KeyboardAndMouse;
				const point = actions.Point.Bindings.Gamepad;
				const stopLook = look.Capture("KeyCode", (key) =>
					nothing.push(`Look ${key?.Name ?? "cancelled"}`),
				);
				const stopPoint = point.Capture("KeyCode", (key) =>
					nothing.push(`Point ${key?.Name ?? "cancelled"}`),
				);
				defer(stopLook);
				defer(stopPoint);
				real.Tap(K.H);
				real.Tap(K.ButtonA);
				quiet();
				expectEqual(nothing.join(", "), "", "nothing captured");
				expectEqual(
					`${keysOf(look.Instance)}; ${keysOf(point.Instance)}`,
					"KeyCode=MouseDelta; (unbound)",
				);
			});
		});
	}
}
