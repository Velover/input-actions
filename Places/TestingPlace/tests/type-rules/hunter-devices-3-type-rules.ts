// Hunter round 3 on device bindings (0.7.0): typing probes. Checked by plain tsc; each rule stays on the
// one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;
type Dir1DType = Enum.InputActionType.Direction1D;

/** Known only at run time */
declare const onConsole: boolean;
declare const player: Player;

// ---- a device's binding written in the ways a project writes data

/** A key table: `as const` records and arrays */
const PAD = { jump: K.ButtonA, dash: K.ButtonX } as const;
const PAD_ROWS = [{ KeyCode: K.ButtonR2, PressedThreshold: 0.3 }] as const;
const SPEC = { KeyCode: K.F, PrimaryModifier: K.LeftShift, PressedThreshold: 0.4 } as const;
const THROTTLE = { Up: K.W, Down: K.S, Scale: 2 } as const;
/** `satisfies` the exported shape */
const TRIGGER = { KeyCode: K.ButtonR2, PressedThreshold: 0.4 } satisfies InputActions.BindingShape<
	BoolType,
	"Gamepad"
>;
/** Optional fields */
declare const chord: { KeyCode: Enum.KeyCode.F; PrimaryModifier?: Enum.KeyCode.LeftControl; DisplayName?: string };
declare const composite: { Up?: Enum.KeyCode.W; Down?: Enum.KeyCode.S };
/** A binding object made by a function */
function trigger(threshold: number) {
	return { KeyCode: K.ButtonR2, PressedThreshold: threshold } as const;
}
function spaceBar() {
	return { KeyCode: K.Space } as const;
}
/** A Scriptable from a variable of the exported type */
declare const virtual: InputActions.Scriptable;

const HUNT = InputActions.Schema({
	Hd3Play: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ Gamepad: PAD.jump, KeyboardAndMouse: SPEC }),
			Fire: InputActions.Bool({ Gamepad: PAD_ROWS[0], KeyboardAndMouse: chord, Virtual: virtual }),
			Dash: InputActions.Bool({ Gamepad: trigger(0.3) }),
			Charge: InputActions.Bool({ Gamepad: TRIGGER }),
			Throttle: InputActions.Direction1D({ KeyboardAndMouse: THROTTLE }),
			// a union of an object with composites and one without
			Lean: InputActions.Direction1D({
				Gamepad: onConsole ? { KeyCode: K.ButtonR2 } : { Up: K.DPadUp, Down: K.DPadDown },
				KeyboardAndMouse: composite,
			}),
			Look: InputActions.Direction2D({
				Gamepad: onConsole ? K.Thumbstick2 : { Up: K.DPadUp, Down: K.DPadDown },
			}),
		},
	},
	Ui: InputActions.Presets.UiNavigation({ ServerAuthority: true }),
	Local: { Actions: { Open: InputActions.Bool({ KeyboardAndMouse: K.M }) } },
});

export function HunterDevices3TypeRules() {
	// ---- what must compile
	// the server's handles: Server Authority contexts, the preset's too, typed from the schema
	const server = InputActions.ForPlayer(HUNT, player);
	server.Ui.Actions.Accept.Pressed.Connect(() => {});
	server.Hd3Play.Actions.Dash.Released.Connect(() => {});
	const throttle: number = server.Hd3Play.Actions.Throttle.GetState();
	const navigate: Vector2 = server.Ui.Actions.Navigate.GetState();
	// a device picked at run time indexes the handles
	const input = InputActions.Create(HUNT);
	const device: InputActions.CapturableDevice = onConsole ? "Gamepad" : "KeyboardAndMouse";
	input.Hd3Play.Actions.Fire.Bindings[device].CaptureChord(() => {});
	input.Hd3Play.Actions.Lean.Bindings[device].Capture("Up", () => {});
	input.Hd3Play.Actions.Fire.Bindings.Virtual.Fire(true);

	// ---- what must not compile
	// @ts-expect-error a local context has no server handle
	print(server.Local);
	// @ts-expect-error another device's key, from a function
	InputActions.Bool({ Gamepad: spaceBar() });
	// @ts-expect-error another device's key, from an `as const` table
	InputActions.Bool({ KeyboardAndMouse: PAD.dash });
	// @ts-expect-error a property a Bool binding doesn't have, from an `as const` object
	InputActions.Bool({ KeyboardAndMouse: THROTTLE });

	return [throttle, navigate];
}

/** A helper generic over the two chord types (API.md: ChordBindingHandle) */
export function tuneTrigger<A extends BoolType | Dir1DType>(
	binding: InputActions.ChordBindingHandle<A, "Gamepad">,
) {
	return binding.Instance.PressedThreshold;
}

// ---- Create given contexts without Schema

export function HunterDevices3CreateRules() {
	const actions = { Jump: InputActions.Bool({ KeyboardAndMouse: K.Space }) };
	// HD3-2 (hunter, fixed: Create's parameter is CheckedInputSchema<S>, IInputSchema<S> with Contexts checked by CheckContexts<S>, and InputActions.InputSchema<S> is that type, so a helper generic over it still passes it on; at runtime Create runs Schema's checks, SchemaProblem, options included): design spec §4: a misspelt context option "is a compile error (Schema's parameter is generic, so the type checks excess keys itself ...), and Schema throws on it at runtime ...: a misspelt ServerAuthority would otherwise make the context local without a word"; API.md: Create throws "on the names Schema refuses (a schema made without Schema)". Create's parameter (IInputSchema<S>) checks no option, and its runtime checks names only: this compiles, and Create builds Hd3Opt as a local context without a word (hunter-devices-3: "Create refuses a misspelt context option")
	// @ts-expect-error a misspelt ServerAuthority, as Schema's parameter refuses it
	InputActions.Create({ Contexts: { Hd3Opt: { ServerAuthorty: true, Actions: actions } } });
	// worker, HD3-2: the same in a variable, and through a helper generic over InputActions.InputSchema<S>
	const raw = { Contexts: { Hd3Opt: { ServerAuthorty: true, Actions: actions } } };
	// @ts-expect-error a misspelt option in a schema kept in a variable
	InputActions.Create(raw);
	// @ts-expect-error through a helper over InputActions.InputSchema<S>
	createWith(raw);
	// what still compiles: Schema's result, a preset, a valid schema in a variable, a widened one,
	// and helpers generic over the schema
	const fromSchema = createWith(InputActions.Schema({ Hd3Ok: { Sink: true, Actions: actions } }));
	fromSchema.Hd3Ok.Actions.Jump.Pressed.Connect(() => {});
	const preset = InputActions.Create({ Contexts: { Ui: InputActions.Presets.UiNavigation({ Priority: 5 }) } });
	preset.Ui.Actions.Accept.Pressed.Connect(() => {});
	const valid = { Contexts: { Hd3Ok: { ServerAuthority: true as const, Actions: actions } } };
	createWith(valid).Hd3Ok.IsLinkedToServer();
	InputActions.Create(widened);
	InputActions.SanitizeBindings(valid, "{}");
}

/** A schema typed as wide as it goes */
declare const widened: InputActions.InputSchema<Record<string, InputActions.ContextSchema>>;

/** A helper generic over the schema, as the tests' `create` */
function createWith<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
): InputActions.Handle<S> {
	const input = InputActions.Create(schema, { ResetOnFocusLoss: false });
	InputActions.SanitizeBindings(schema, input.ExportBindings());
	return input;
}

// ---- Set with one tuning property, as the docs write it

export function HunterDevices3SetRules() {
	const input = InputActions.Create(HUNT);
	const pad = input.Hd3Play.Actions.Dash.Bindings.Gamepad;
	// the forms that compile: a key, or an object with the key
	pad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.9 });
	// HD3-3 (hunter, fixed: Set takes BindingShape<A, D> | BindingPart<A, D>, each object form with every property optional, a stick's form only on the gamepad; at runtime a ResponseCurve is checked against the KeyCode after the merge): API.md ("Binding shapes") and design spec §6 write `Set({ PressedThreshold: 0.9 })` and `Set({ ReleasedThreshold: 0.8 })` on a binding ("after Set({ PressedThreshold: 0.9 }) it reads 0.8"; "A write that doesn't name it (Set({ PressedThreshold: 0.9 }), ...)"), and "An object merges into the binding"; the runtime takes them (hunter-devices-3: "Set merges a tuning alone"), but Set's type is the schema's shape, whose Bool object needs KeyCode: TS2345 "Argument of type '{ PressedThreshold: number; }' is not assignable to parameter of type 'ButtonX | ... | IBoolBinding<...>'" (tsc 5.5.3)
	pad.Set({ PressedThreshold: 0.9 });
	pad.Set({ ReleasedThreshold: 0.8 });
	// worker, HD3-3: the other parts that merge, on each action type
	const { Fire, Lean, Look, Throttle } = input.Hd3Play.Actions;
	pad.Set({ PrimaryModifier: K.ButtonL1, DisplayName: "Dash" });
	Look.Bindings.Gamepad.Set({ ResponseCurve: 2 });
	Look.Bindings.Gamepad.Set({ Vector2Scale: new Vector2(1, -1), Scale: 2 });
	Lean.Bindings.Gamepad.Set({ Scale: 0.5 });
	Throttle.Bindings.KeyboardAndMouse.Set({ ClampMagnitudeToOne: false });
	const anyDevice: InputActions.BindingHandle<BoolType, InputActions.Device> = Fire.Bindings.Touch;
	anyDevice.Set({ PressedThreshold: 0.7 });
	input.Ui.Actions.Navigate.Bindings.Touch.Set({ DisplayName: "Drag" });
	// what a part still can't hold
	// @ts-expect-error a ResponseCurve on the keyboard and mouse, which has no thumbstick
	Look.Bindings.KeyboardAndMouse.Set({ ResponseCurve: 2 });
	// @ts-expect-error nor on touch
	Look.Bindings.Touch.Set({ ResponseCurve: 2 });
	// @ts-expect-error a ResponseCurve beside a composite direction
	Look.Bindings.Gamepad.Set({ Up: K.DPadUp, ResponseCurve: 2 });
	// @ts-expect-error a property a Bool binding doesn't have, beside a threshold
	pad.Set({ PressedThreshold: 0.9, Scale: 2 });
	// @ts-expect-error a threshold on a Direction1D binding
	Lean.Bindings.Gamepad.Set({ PressedThreshold: 0.9 });
	// @ts-expect-error another device's modifier, without the key
	pad.Set({ PrimaryModifier: K.LeftShift });
}
