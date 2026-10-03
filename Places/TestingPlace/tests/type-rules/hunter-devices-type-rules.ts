// Hunter round on device bindings (0.7.0): typing probes. Checked by plain tsc; each rule stays on the
// one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;
type Dir1DType = Enum.InputActionType.Direction1D;

const HUNT = InputActions.Schema({
	Play: {
		Actions: {
			// the TV remote's keys are the Gamepad's; the trackpad's are the keyboard and mouse's
			Select: InputActions.Bool({ Gamepad: K.ButtonCenter, Touch: K.TouchPosition }),
			Back: InputActions.Bool({ Gamepad: { KeyCode: K.ButtonBack, PrimaryModifier: K.ButtonUp } }),
			Zoom: InputActions.Direction1D({
				KeyboardAndMouse: K.TrackpadPinch,
				Gamepad: { Up: K.ButtonR2, Down: K.ButtonL2 },
				Touch: K.TouchPinch,
			}),
			Pan: InputActions.Direction2D({
				KeyboardAndMouse: { KeyCode: K.TrackpadPan, Vector2Scale: new Vector2(1, -1) },
				Gamepad: { Up: K.Thumbstick2Up, Down: K.Thumbstick2Down, Left: K.DPadLeft, Right: K.DPadRight },
				Touch: K.TouchDelta,
			}),
			// Enum.KeyCode.Touch is TouchPosition's old name: the same item, a touch key
			Point: InputActions.ViewportPosition({ Touch: K.Touch, KeyboardAndMouse: K.MousePosition }),
			Shoot: InputActions.Bool({ Gamepad: { KeyCode: K.Thumbstick1Up, PressedThreshold: 0.7 } }),
		},
	},
	Ui: InputActions.Presets.UiNavigation(),
});

export function HunterDevicesTypeRules() {
	const Input = InputActions.Create(HUNT);
	const { Select, Back, Zoom, Pan, Point, Shoot } = Input.Play.Actions;

	// ---- what must compile
	// the docs' column menu (Advanced.md, "A menu with a column per device")
	for (const device of ["KeyboardAndMouse", "Gamepad"] as const) {
		const binding = Select.Bindings[device];
		const key: Enum.KeyCode | undefined = binding.Get().KeyCode;
		binding.Capture("KeyCode", () => {});
		binding.CaptureChord(() => {});
		print(device, key);
	}
	// QuickStart.md: the binding of the device the player uses
	print(Select.Bindings[InputActions.PreferredDevice()].Get());
	// API.md: BindingHandle<A, Device> is what any of the three is assignable to, its Set taking any
	// device's keys (checked at runtime)
	const any: InputActions.BindingHandle<BoolType, InputActions.Device> =
		Select.Bindings[InputActions.PreferredDevice()];
	any.Set(K.Space);
	any.Set(K.ButtonA);
	any.Set(K.TouchPosition);
	// the preset's actions have the three device bindings too
	Input.Ui.Actions.Scroll.Bindings.Touch.Set(K.TouchPinch);
	Input.Ui.Actions.Accept.Bindings.Touch.Set(K.TouchPosition);
	Input.Ui.Actions.Navigate.Bindings.Gamepad.Capture("Up", () => {});
	// a stick's direction on the gamepad's Bool binding, a trigger as a composite direction
	Shoot.Bindings.Gamepad.Set({ KeyCode: K.Thumbstick2Left, PressedThreshold: 0.4 });
	Zoom.Bindings.Gamepad.Set({ Up: K.Thumbstick1Up });
	Pan.Bindings.Gamepad.Set(K.Thumbstick1);
	Pan.Bindings.KeyboardAndMouse.Set(K.MouseDelta);
	Pan.Bindings.Touch.Set({ KeyCode: K.TouchDelta, Scale: 2 });
	Point.Bindings.Touch.Set(K.TouchPosition);
	Back.Bindings.Gamepad.Set({ KeyCode: K.ButtonRight, SecondaryModifier: K.ButtonLeft });
	// the one-field captures, on a helper typed CaptureAction
	const fields: InputActions.CaptureAction[] = [Select, Back, Zoom, Shoot];
	for (const field of fields) field.CaptureChord((chord, device) => [chord, device]);

	// ---- what must not compile
	// @ts-expect-error ButtonStart is the Gamepad's, but reserved
	InputActions.Bool({ Gamepad: K.ButtonStart });
	// @ts-expect-error a whole stick doesn't drive a Bool
	InputActions.Bool({ Gamepad: K.Thumbstick1 });
	// @ts-expect-error a trigger is no modifier (an axis), on the gamepad either
	InputActions.Direction1D({ Gamepad: { Up: K.ButtonA, PrimaryModifier: K.ButtonR2 } });
	// @ts-expect-error a stick's direction is no modifier
	InputActions.Bool({ Gamepad: { KeyCode: K.ButtonA, PrimaryModifier: K.Thumbstick1Up } });
	// @ts-expect-error a mouse button is no modifier
	InputActions.Bool({ KeyboardAndMouse: { KeyCode: K.E, PrimaryModifier: K.MouseRightButton } });
	// @ts-expect-error ResponseCurve is for a stick only, not a touch drag
	InputActions.Direction2D({ Touch: { KeyCode: K.TouchDelta, ResponseCurve: 2 } });
	// @ts-expect-error a mouse position is the keyboard and mouse's
	InputActions.ViewportPosition({ Touch: K.MousePosition });
	// @ts-expect-error the wheel is the keyboard and mouse's
	InputActions.Direction1D({ Touch: K.MouseWheel });
	// @ts-expect-error a pinch is the touch screen's
	InputActions.Direction1D({ KeyboardAndMouse: K.TouchPinch });
	// @ts-expect-error a trackpad's pan is the keyboard and mouse's
	InputActions.Direction2D({ Gamepad: K.TrackpadPan });
	// @ts-expect-error MicroGamepad names no binding: the TV remote's keys are the Gamepad's
	InputActions.Bool({ MicroGamepad: K.ButtonCenter });
	// @ts-expect-error the TV remote's keys are the Gamepad's, not the keyboard's
	InputActions.Bool({ KeyboardAndMouse: K.ButtonCenter });
	// a Scriptable under a device's name: refused on Bool and ViewportPosition actions, as the docs say
	// @ts-expect-error a device's binding takes keys, not Scriptable (Bool)
	InputActions.Bool({ Touch: InputActions.Scriptable });
	// @ts-expect-error a device's binding takes keys, not Scriptable (ViewportPosition)
	InputActions.ViewportPosition({ Touch: InputActions.Scriptable });
	// HD-3 (hunter, fixed: `CheckBindings` checks a device's Scriptable against `NotScriptable`, the
	// device's shapes and a property the marker lacks): on Direction1D, Direction2D and Direction3D
	// actions a Scriptable under a device's name compiled. Design spec §3: "A key binding under
	// another name, or a Scriptable under a device's name, is a compile error". `CheckBindings`
	// mapped it to `BindingShape<T, K>`, and the parameter's intersection with `B`'s IScriptable
	// made those types' all-optional composite shapes ones the marker satisfies; only `Schema`
	// refused it, at runtime. All three devices, all three types (measured with tsc 5.5.3)
	// @ts-expect-error a device's binding takes keys, not Scriptable (Direction1D)
	InputActions.Direction1D({ Gamepad: InputActions.Scriptable });
	// @ts-expect-error a device's binding takes keys, not Scriptable (Direction2D)
	InputActions.Direction2D({ Touch: InputActions.Scriptable });
	// @ts-expect-error a device's binding takes keys, not Scriptable (Direction3D)
	InputActions.Direction3D({ KeyboardAndMouse: InputActions.Scriptable });
	// @ts-expect-error beside a valid binding and a Scriptable slot too
	InputActions.Direction2D({ Gamepad: { Up: K.DPadUp }, Touch: InputActions.Scriptable, Virtual: InputActions.Scriptable });
	// @ts-expect-error Set takes the device's keys: not the TV remote's on the keyboard's binding
	Select.Bindings.KeyboardAndMouse.Set(K.ButtonCenter);
	// @ts-expect-error nor a touch drag on the gamepad's
	Pan.Bindings.Gamepad.Set(K.TouchDelta);
	// @ts-expect-error nor a stick on the Touch binding
	Pan.Bindings.Touch.Set(K.Thumbstick2);
	// @ts-expect-error a gamepad has no position: nothing for its ViewportPosition binding
	Point.Bindings.Gamepad.Set(K.MousePosition);
	// @ts-expect-error nor a gamepad modifier on the TV remote's Back... on the keyboard's binding
	Back.Bindings.KeyboardAndMouse.Set({ KeyCode: K.E, PrimaryModifier: K.ButtonUp });
	// @ts-expect-error the preset's Touch binding has no Capture
	Input.Ui.Actions.Accept.Bindings.Touch.Capture("KeyCode", () => {});
	// @ts-expect-error a Direction2D action has no one-field Capture, preset or not
	Input.Ui.Actions.Navigate.Capture(() => {});
	// @ts-expect-error the device a capture callback gets is never Touch
	Zoom.CaptureChord((chord, device: "Touch" | undefined) => [chord, device]);

	return [any, fields];
}

/** A helper generic over the two chord types, on any capturable device's binding */
export function chordCell<A extends BoolType | Dir1DType>(
	binding: InputActions.ChordBindingHandle<A, InputActions.CapturableDevice>,
) {
	return binding.CaptureChord((chord) => chord?.KeyCode);
}
chordCell(InputActions.Create(HUNT).Play.Actions.Zoom.Bindings.Gamepad);
