// Device bindings (0.7.0): binding names are devices, each binding takes its device's keys, every
// action has the three, the Touch binding has no captures, and Bool and Direction1D actions have a
// one-field Capture and CaptureChord. Checked by plain tsc; each rule stays on the one line after
// its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;

const DEVICES = InputActions.Schema({
	Play: {
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.Space, Gamepad: K.ButtonA }),
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Up: K.W, Down: K.S },
				Gamepad: K.ButtonR2,
				Touch: K.TouchPinch,
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
				Gamepad: { KeyCode: K.Thumbstick1, ResponseCurve: 2 },
				Touch: K.TouchDelta,
				Virtual: InputActions.Scriptable,
			}),
			Fly: InputActions.Direction3D({
				KeyboardAndMouse: { Up: K.E, Down: K.Q },
				Gamepad: { Up: K.DPadUp, Down: K.DPadDown, Forward: K.Thumbstick1Up },
			}),
			Aim: InputActions.ViewportPosition({ KeyboardAndMouse: K.MousePosition, Touch: K.TouchPosition }),
			Tap: InputActions.Bool({ Touch: K.TouchPosition }),
			Dash: InputActions.Bool(),
		},
	},
});

/** A menu row a project writes: shows the device's keys and resets them */
function row<A extends Enum.InputActionType>(binding: InputActions.BindingHandle<A, InputActions.Device>) {
	binding.Get();
	binding.Reset();
	binding.Clear();
}

/** A one-field rebind a project writes, for any Bool or Direction1D action */
function rebind(action: InputActions.CaptureAction) {
	return action.Capture((key, device) => print(key === undefined ? "cancelled" : `${key.Name} on ${device}`), {
		Cancel: [K.Backspace],
	});
}

export function DevicesTypeRules() {
	const Input = InputActions.Create(DEVICES);
	const { Jump, Throttle, Move, Fly, Aim, Tap, Dash } = Input.Play.Actions;

	// ---- what must compile, with the types it must have
	// every action has the three device bindings, also those its schema leaves out
	Dash.Bindings.KeyboardAndMouse.Set(K.F);
	Dash.Bindings.Gamepad.Set({ KeyCode: K.ButtonL2, PressedThreshold: 0.3 });
	Dash.Bindings.Touch.Set(K.TouchPosition);
	Tap.Bindings.KeyboardAndMouse.Set(K.MouseLeftButton);
	Jump.Bindings.Touch.Set(K.TouchPosition);
	Move.Bindings.Gamepad.Set({ Up: K.Thumbstick2Up, Down: K.DPadDown, PrimaryModifier: K.ButtonL1 });
	Throttle.Bindings.Gamepad.Set({ KeyCode: K.ButtonCenter, PrimaryModifier: K.ButtonUp });
	Aim.Bindings.Touch.Set(K.TouchPosition);
	Move.Bindings.Virtual.Fire(new Vector2(1, 0));
	// the device's binding, picked at runtime: its keys depend on the device, so Set is checked then
	const device: InputActions.Device = InputActions.PreferredDevice();
	const picked = Jump.Bindings[device];
	picked.Get();
	picked.Reset();
	row(Jump.Bindings.Touch);
	row(Jump.Bindings.Gamepad);
	row(Move.Bindings.KeyboardAndMouse);
	const touchHandle: InputActions.BindingHandle<BoolType, "Touch"> = Jump.Bindings.Touch;
	touchHandle.Set(K.TouchPosition);
	const padKeys = Jump.Bindings.Gamepad.Get().KeyCode;
	const padKey: InputActions.GamepadKey | undefined = padKeys;
	// captures on the keyboard-and-mouse and gamepad bindings
	Jump.Bindings.Gamepad.Capture("KeyCode", (key: Enum.KeyCode | undefined) => key);
	Jump.Bindings.Gamepad.CaptureChord((chord) => chord?.KeyCode);
	Move.Bindings.Gamepad.Capture("KeyCode", () => {});
	const capturable: InputActions.BindingHandle<BoolType> = Jump.Bindings.Gamepad;
	// the one-field capture on Bool and Direction1D actions
	const stop: () => void = Jump.Capture((key, picked: InputActions.CapturableDevice | undefined) => [key, picked]);
	// a Cancel key calls back with undefined, so a callback typed for a key alone is refused
	// @ts-expect-error the key is undefined on a Cancel key
	Jump.Capture((key: Enum.KeyCode, picked: InputActions.CapturableDevice) => [key, picked]);
	// @ts-expect-error the key is undefined on a Cancel key
	Jump.Bindings.Gamepad.Capture("KeyCode", (key: Enum.KeyCode) => key);
	Throttle.Capture(() => {}, { Cancel: [K.Backspace, K.ButtonB] });
	Jump.CaptureChord(
		(chord, chordDevice) => {
			const key: Enum.KeyCode | undefined = chord?.KeyCode;
			const on: "KeyboardAndMouse" | "Gamepad" | undefined = chordDevice;
			return [key, on];
		},
		{ Timeout: 5, Cancel: [K.Backspace] },
	);
	Throttle.CaptureChord(() => {});
	rebind(Jump);
	rebind(Throttle);
	rebind(Input.Play.Actions.Dash);

	// ---- what must not compile
	// @ts-expect-error a key binding must be named after a device
	InputActions.Bool({ Keys: K.Space });
	// @ts-expect-error an object binding too
	InputActions.Bool({ Pad: { KeyCode: K.ButtonA } });
	// @ts-expect-error a device's binding takes keys, not Scriptable
	InputActions.Bool({ Gamepad: InputActions.Scriptable });
	// @ts-expect-error a keyboard key in the Gamepad binding
	InputActions.Bool({ Gamepad: K.Space });
	// @ts-expect-error a gamepad key in the KeyboardAndMouse binding
	InputActions.Bool({ KeyboardAndMouse: K.ButtonA });
	// @ts-expect-error a touch key in the KeyboardAndMouse binding
	InputActions.Bool({ KeyboardAndMouse: K.TouchPosition });
	// @ts-expect-error a keyboard key in the Touch binding
	InputActions.Bool({ Touch: K.E });
	// @ts-expect-error a mouse button in the Touch binding
	InputActions.Bool({ Touch: { KeyCode: K.MouseLeftButton } });
	// @ts-expect-error a keyboard modifier on the Gamepad binding
	InputActions.Bool({ Gamepad: { KeyCode: K.ButtonA, PrimaryModifier: K.LeftShift } });
	// @ts-expect-error a gamepad modifier on the KeyboardAndMouse binding
	InputActions.Bool({ KeyboardAndMouse: { KeyCode: K.E, SecondaryModifier: K.ButtonL1 } });
	// @ts-expect-error the Touch binding has no modifiers
	InputActions.Bool({ Touch: { KeyCode: K.TouchPosition, PrimaryModifier: K.E } });
	// @ts-expect-error a keyboard key as a gamepad composite direction
	InputActions.Direction2D({ Gamepad: { Up: K.W } });
	// @ts-expect-error a gamepad key as a keyboard composite direction
	InputActions.Direction2D({ KeyboardAndMouse: { Up: K.DPadUp } });
	// @ts-expect-error the Touch binding has no composite keys
	InputActions.Direction3D({ Touch: { Up: K.E } });
	// @ts-expect-error a thumbstick is the Gamepad's
	InputActions.Direction2D({ KeyboardAndMouse: K.Thumbstick1 });
	// @ts-expect-error a mouse movement is the KeyboardAndMouse's
	InputActions.Direction2D({ Gamepad: K.MouseDelta });
	// @ts-expect-error a touch drag is the Touch binding's
	InputActions.Direction2D({ KeyboardAndMouse: K.TouchDelta });
	// @ts-expect-error a gamepad has no position
	InputActions.ViewportPosition({ Gamepad: K.MousePosition });
	// @ts-expect-error Set takes the device's keys: not a keyboard key on the Gamepad binding
	Jump.Bindings.Gamepad.Set(K.Space);
	// @ts-expect-error nor a gamepad key on the KeyboardAndMouse one
	Jump.Bindings.KeyboardAndMouse.Set(K.ButtonA);
	// @ts-expect-error nor a keyboard key on the Touch one
	Jump.Bindings.Touch.Set(K.E);
	// @ts-expect-error nor another device's modifier
	Jump.Bindings.Gamepad.Set({ KeyCode: K.ButtonA, PrimaryModifier: K.LeftControl });
	// @ts-expect-error the Touch binding has no Capture: touch has no keys to press
	Jump.Bindings.Touch.Capture("KeyCode", () => {});
	// @ts-expect-error nor CaptureChord
	Jump.Bindings.Touch.CaptureChord(() => {});
	// @ts-expect-error a Touch handle is no capturable binding handle
	const noCapture: InputActions.BindingHandle<BoolType> = Jump.Bindings.Touch;
	// @ts-expect-error the device type picks a handle without Capture
	touchHandle.Capture("KeyCode", () => {});
	// @ts-expect-error unknown binding names are compile errors (0.6's Mouse slot is gone)
	Jump.Bindings.Mouse.Set(K.MouseLeftButton);
	// @ts-expect-error a Scriptable slot stays Scriptable
	Move.Bindings.Virtual.Set(K.Thumbstick1);
	// @ts-expect-error the one-field Capture is on Bool and Direction1D actions only
	Move.Capture(() => {});
	// @ts-expect-error nor CaptureChord on a Direction3D action
	Fly.CaptureChord(() => {});
	// @ts-expect-error nor on a ViewportPosition action
	Aim.Capture(() => {});
	// @ts-expect-error the device a capture picks is never Touch
	Jump.Capture((key, picked: "Touch") => [key, picked]);
	// @ts-expect-error the chord is undefined when the capture ends with nothing
	Jump.CaptureChord((chord) => chord.KeyCode);
	// @ts-expect-error PreferredDevice names the binding: never MicroGamepad
	const micro: "MicroGamepad" = InputActions.PreferredDevice();
	// @ts-expect-error a Direction2D action is no CaptureAction
	rebind(Move);

	return [stop, padKey, capturable, noCapture, micro];
}
