// Extra bindings per device (0.7.0): a device takes a binding or a namespace,
// `{ Main: <binding>, <Extra>: <binding> }`; the device's handle is the main binding's, with the
// declared extras as typed properties, each a binding handle of the device. Checked by plain tsc;
// each rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";
import type {
	BINDING_HANDLE_MEMBERS,
	ReservedExtraName,
} from "@rbxts/input-actions/out/InputActions/BindingRules";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;
type Dir2DType = Enum.InputActionType.Direction2D;

const EXTRAS = InputActions.Schema({
	Extras: {
		Actions: {
			// WASD plus the arrows, the stick plus the D-pad
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
					Arrows: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
				},
				Gamepad: { Main: K.Thumbstick1, DPad: { Up: K.DPadUp, Down: K.DPadDown } },
				Virtual: InputActions.Scriptable,
			}),
			// an Alternate column: unbound until the player fills it
			Jump: InputActions.Bool({
				KeyboardAndMouse: { Main: K.Space, Alt: {} },
				Gamepad: { Main: K.ButtonA, Alt: { KeyCode: K.ButtonL1, PressedThreshold: 0.4 } },
				Touch: { Main: K.TouchPosition, Second: {} },
			}),
			// Main may be unbound too; a namespace with Main alone is the direct form
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Main: {}, Wheel: K.MouseWheel },
				Gamepad: { Main: K.ButtonR2 },
			}),
			Fly: InputActions.Direction3D({ KeyboardAndMouse: { Main: { Up: K.E }, Alt: { Up: K.R } } }),
			Aim: InputActions.ViewportPosition({ KeyboardAndMouse: { Main: K.MousePosition, Alt: {} } }),
			Dash: InputActions.Bool({ KeyboardAndMouse: K.LeftShift }),
		},
	},
});

/** A menu cell a project writes, for any keyboard-and-mouse or gamepad binding, main or extra */
function cell<A extends Enum.InputActionType>(binding: InputActions.BindingHandle<A>) {
	binding.Get();
	return binding.Capture("KeyCode" as InputActions.CaptureSlot<A>, () => {});
}

/** An Alternate column a project writes over any rebinding row: the extra by name, at runtime */
function alternate(action: InputActions.CaptureAction, device: InputActions.CapturableDevice) {
	return action.Bindings[device].Extras().Alt?.CaptureChord(() => {});
}

export function DeviceExtrasTypeRules() {
	const Input = InputActions.Create(EXTRAS);
	const { Move, Jump, Throttle, Fly, Aim, Dash } = Input.Extras.Actions;

	// ---- what must compile, with the types it must have
	// the device's handle is the main binding's: code written for the direct form keeps working
	Move.Bindings.KeyboardAndMouse.Set({ Up: K.I });
	Move.Bindings.KeyboardAndMouse.Capture("Up", (key: Enum.KeyCode | undefined) => key); // undefined on a Cancel key
	// the extras are binding handles of the device: its key rules, its captures
	Move.Bindings.KeyboardAndMouse.Arrows.Set({ Up: K.Eight });
	Move.Bindings.KeyboardAndMouse.Arrows.Capture("Up", () => {});
	Move.Bindings.Gamepad.DPad.Set({ Left: K.DPadLeft, Right: K.Thumbstick2Right });
	Move.Bindings.Gamepad.DPad.Capture("Down", () => {});
	Move.Bindings.Virtual.Fire(new Vector2(0, 1));
	Jump.Bindings.KeyboardAndMouse.Alt.CaptureChord((chord) => chord?.KeyCode);
	Jump.Bindings.Gamepad.Alt.Set({ KeyCode: K.ButtonX, PrimaryModifier: K.ButtonL1 });
	Jump.Bindings.Touch.Second.Set(K.TouchPosition);
	Throttle.Bindings.KeyboardAndMouse.Wheel.Get();
	Fly.Bindings.KeyboardAndMouse.Alt.Set({ Forward: K.T });
	Aim.Bindings.KeyboardAndMouse.Alt.Set(K.MousePosition);
	const alt: InputActions.BindingHandle<BoolType> = Jump.Bindings.KeyboardAndMouse.Alt;
	const arrows: InputActions.BindingHandle<Dir2DType, "KeyboardAndMouse"> =
		Move.Bindings.KeyboardAndMouse.Arrows;
	const touchExtra: InputActions.BindingHandle<BoolType, "Touch"> = Jump.Bindings.Touch.Second;
	const chordAlt: InputActions.ChordBindingHandle<BoolType> = Jump.Bindings.Gamepad.Alt;
	cell(Move.Bindings.KeyboardAndMouse.Arrows);
	cell(Jump.Bindings.Gamepad.Alt);
	cell(Jump.Bindings.KeyboardAndMouse);
	// Get and Set take the same forms on an extra
	Jump.Bindings.Gamepad.Alt.Set(Jump.Bindings.Gamepad.Alt.Get());
	Move.Bindings.KeyboardAndMouse.Arrows.Set(Move.Bindings.KeyboardAndMouse.Arrows.Get());
	// a device picked at runtime: the three handles, those with extras too
	const device: InputActions.Device = InputActions.PreferredDevice();
	Jump.Bindings[device].Reset();
	// the extras listed at runtime, as the device's handles: by name, or all of them with pairs
	for (const [name, extra] of pairs(Move.Bindings.KeyboardAndMouse.Extras())) {
		const handle: InputActions.BindingHandle<Dir2DType, "KeyboardAndMouse"> = extra;
		print(tostring(name), handle.Get().Up);
		handle.Capture("Up", () => {});
	}
	const listed: InputActions.ChordBindingHandle<BoolType, "Gamepad"> | undefined =
		Jump.Bindings.Gamepad.Extras().Alt;
	// a handle picked by a device at runtime too
	for (const column of ["KeyboardAndMouse", "Gamepad"] as const) {
		Jump.Bindings[column].Extras().Alt?.CaptureChord(() => {});
	}
	Jump.Bindings[device].Extras().Alt?.Reset();
	const touchExtras: InputActions.ExtraBindings<InputActions.BindingHandle<BoolType, "Touch">> =
		Jump.Bindings.Touch.Extras();
	alternate(Jump, "KeyboardAndMouse");
	alternate(Throttle, "Gamepad");
	// Advanced.md, "Several bindings per device": a two-column menu on the device the player uses
	const onKey = (key: Enum.KeyCode | undefined) => print(key?.Name ?? "cancelled");
	if (device !== "Touch") {
		const binding = Jump.Bindings[device];
		binding.Capture("KeyCode", onKey);
		binding.Alt.Capture("KeyCode", onKey);
	}
	// the one-field capture writes the main bindings, as before
	Jump.Capture((key, picked) => [key, picked]);
	Throttle.CaptureChord(() => {});
	// an action with extras is still any action, Bool action or capture action for helpers
	const boolAction: InputActions.BoolAction = Jump;
	const anyAction: InputActions.Action = Move;
	const twoD: InputActions.Action<Dir2DType> = Move;
	const captureAction: InputActions.CaptureAction = Throttle;
	const handleType: InputActions.ActionHandle<typeof EXTRAS.Contexts.Extras.Actions.Jump> = Jump;
	handleType.Bindings.Gamepad.Alt.Reset();
	const { KeyboardAndMouse: keysOfMove } = Move.Bindings;
	keysOfMove.Arrows.Reset();
	// a binding typed in a variable, and a union of the direct form and a namespace
	const wasd: InputActions.BindingShape<Dir2DType, "KeyboardAndMouse"> = { Up: K.W, Down: K.S };
	const pad = InputActions.Bool({ Gamepad: { Main: K.ButtonA, Alt: K.ButtonB } }) as InputActions.ActionDefinition<BoolType>;
	InputActions.Direction2D({ KeyboardAndMouse: { Main: wasd, Alt: wasd } });
	const either = (true as boolean) ? K.Space : { Main: K.Space, Alt: K.F };
	InputActions.Bool({ KeyboardAndMouse: either });
	// an extra named after a device or a Scriptable slot: names of your own
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, Gamepad: K.F, Virtual: K.G }, Virtual: InputActions.Scriptable });
	// the reserved names are every member of a binding handle
	const member: ReservedExtraName = "" as keyof InputActions.ChordBindingHandle<BoolType>;
	const internal: ReservedExtraName = "" as (typeof BINDING_HANDLE_MEMBERS)[number];

	// ---- what must not compile
	// @ts-expect-error a namespace's bindings take the device's keys: no gamepad key on the keyboard's
	InputActions.Bool({ KeyboardAndMouse: { Main: K.Space, Alt: K.ButtonA } });
	// @ts-expect-error nor a keyboard key as the gamepad's Main
	InputActions.Bool({ Gamepad: { Main: K.Space, Alt: K.ButtonB } });
	// @ts-expect-error nor in an extra's object form
	InputActions.Direction2D({ Gamepad: { Main: K.Thumbstick1, DPad: { Up: K.W } } });
	// @ts-expect-error nor another device's modifier on an extra
	InputActions.Bool({ Gamepad: { Main: K.ButtonA, Alt: { KeyCode: K.ButtonB, PrimaryModifier: K.LeftShift } } });
	// @ts-expect-error the touch binding's extras take touch keys
	InputActions.Bool({ Touch: { Main: K.TouchPosition, Alt: K.E } });
	// @ts-expect-error the action type's rules hold in an extra: no thumbstick on a Bool action
	InputActions.Bool({ Gamepad: { Main: K.ButtonA, Alt: K.Thumbstick1 } });
	// @ts-expect-error nor an unknown property on an extra
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, Alt: { KeyCode: K.F, Scale: 2 } } });
	// @ts-expect-error an extra is no Scriptable binding: those keep names of their own
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, Virtual: InputActions.Scriptable } });
	// @ts-expect-error nor Main
	InputActions.Bool({ KeyboardAndMouse: { Main: InputActions.Scriptable, Alt: K.E } });
	// @ts-expect-error a namespace needs Main: without it the object is a binding, whose properties these aren't
	InputActions.Direction2D({ KeyboardAndMouse: { Arrows: { Up: K.Up } } });
	// @ts-expect-error an extra named after a member of the binding handle it hangs off
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, Get: K.F } });
	// @ts-expect-error after Capture
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, Capture: K.F } });
	// @ts-expect-error after Extras
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, Extras: K.F } });
	// @ts-expect-error after an internal member
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, Path: K.F } });
	// @ts-expect-error after a binding property
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, KeyCode: K.F } });
	// @ts-expect-error after a composite direction
	InputActions.Direction2D({ KeyboardAndMouse: { Main: K.MouseDelta, Up: K.W } });
	// @ts-expect-error after a tuning property
	InputActions.Bool({ Gamepad: { Main: K.ButtonA, PressedThreshold: K.ButtonB } });
	// @ts-expect-error after EnumType
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, EnumType: K.F } });
	// @ts-expect-error an extra's name with "/" would split its save path
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, "Alt/2": K.F } });
	// @ts-expect-error nor an empty name
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, "": K.F } });
	// @ts-expect-error nor a number
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, 1: K.F } });
	// @ts-expect-error {} is a binding with no keys only in a namespace: the direct form is as before
	InputActions.Bool({ KeyboardAndMouse: {} });
	// @ts-expect-error a binding's Set takes no namespace
	Jump.Bindings.KeyboardAndMouse.Set({ Main: K.F });
	// @ts-expect-error an undeclared extra is no property
	Jump.Bindings.Gamepad.Arrows.Set(K.ButtonX);
	// @ts-expect-error nor on a device without extras
	Dash.Bindings.KeyboardAndMouse.Alt.Get();
	// @ts-expect-error an extra takes its device's keys in Set
	Jump.Bindings.KeyboardAndMouse.Alt.Set(K.ButtonA);
	// @ts-expect-error the gamepad's extra takes no keyboard key
	Move.Bindings.Gamepad.DPad.Set({ Up: K.W });
	// @ts-expect-error a touch extra has no Capture
	Jump.Bindings.Touch.Second.Capture("KeyCode", () => {});
	// @ts-expect-error nor CaptureChord
	Jump.Bindings.Touch.Second.CaptureChord(() => {});
	// @ts-expect-error CaptureChord on Bool and Direction1D bindings only, extras too
	Move.Bindings.KeyboardAndMouse.Arrows.CaptureChord(() => {});
	// @ts-expect-error an extra has no extras of its own
	Move.Bindings.KeyboardAndMouse.Arrows.Arrows.Get();
	// @ts-expect-error a Scriptable slot has no extras
	Move.Bindings.Virtual.Extras();
	// @ts-expect-error a touch extra is no capturable handle
	const noCapture: InputActions.BindingHandle<BoolType> = Jump.Bindings.Touch.Second;
	// @ts-expect-error nor are the touch binding's listed extras
	Jump.Bindings.Touch.Extras().Second?.Capture("KeyCode", () => {});
	// @ts-expect-error a handle picked among the three devices may be the touch one's: no Capture
	Jump.Bindings[device].Extras().Alt?.Capture("KeyCode", () => {});
	// @ts-expect-error a listed extra may be missing
	Jump.Bindings.Gamepad.Extras().Alt.Reset();
	// @ts-expect-error a reserved name is no free one
	const free: ReservedExtraName = "Alt";

	return [
		[alt, arrows, touchExtra, chordAlt, touchExtras, listed, pad, member, internal, noCapture, free],
		[boolAction, anyAction, twoD, captureAction],
	];
}
