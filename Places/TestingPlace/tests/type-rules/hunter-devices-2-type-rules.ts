// Hunter round 2 on device bindings (0.7.0): typing probes. Checked by plain tsc; each rule stays on the
// one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;
type Dir2DType = Enum.InputActionType.Direction2D;

/** Known only at run time: a game that binds the pad differently on consoles */
declare const onConsole: boolean;
/** A binding of the exported type, as a helper or a config table would give it */
declare const padJump: InputActions.BindingShape<BoolType, "Gamepad">;
declare const padLook: InputActions.BindingShape<Dir2DType, "Gamepad">;

const HUNT = InputActions.Schema({
	Play: { Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.Space, Gamepad: K.ButtonA }) } },
});

export function HunterDevices2TypeRules() {
	// ---- what must compile
	// Set takes a value of the exported shape type, as its signature says
	InputActions.Create(HUNT).Play.Actions.Jump.Bindings.Gamepad.Set(padJump);
	// HD2-1 (hunter, fixed: CheckBindings checks a device's binding through CheckDeviceBinding, which distributes over a union and checks each member as it is): a device's binding whose type is a union of a bare key and an object shape is refused, every member of it valid: a value of the exported InputActions.BindingShape<A, D> (API.md: "Every form a binding of this action type and device may take"), or a conditional between a bare key and an object. CheckBindings sends any B[K] that isn't all EnumItem to the object branch, which a bare key can't satisfy; 0.6's CheckBindings (excess properties only) accepted both. Measured with tsc 5.5.3: TS2322 "Type 'ButtonA' is not assignable to type ... IBoolBinding<IGamepadKeys>"
	const fromType = InputActions.Bool({ Gamepad: padJump });
	const conditional = InputActions.Bool({ Gamepad: onConsole ? K.ButtonA : { KeyCode: K.ButtonR2, PressedThreshold: 0.3 } });
	const look = InputActions.Direction2D({ Gamepad: padLook, KeyboardAndMouse: K.MouseDelta });
	// the same, without the union: these compile today
	const keys = InputActions.Bool({ Gamepad: onConsole ? K.ButtonA : K.ButtonB });
	const shapes = InputActions.Bool({ Gamepad: onConsole ? { KeyCode: K.ButtonA } : { KeyCode: K.ButtonR2, PressedThreshold: 0.3 } });

	// ---- what must not compile, union or not
	// @ts-expect-error another device's key among the members
	InputActions.Bool({ Gamepad: onConsole ? K.ButtonA : { KeyCode: K.Space } });
	// @ts-expect-error a property a Bool binding doesn't have, on the object member
	InputActions.Bool({ Gamepad: onConsole ? K.ButtonA : { KeyCode: K.ButtonR2, Scale: 2 } });
	// @ts-expect-error the same on one of two objects (worker: each member is checked for excess properties)
	InputActions.Bool({ Gamepad: onConsole ? { KeyCode: K.ButtonA } : { KeyCode: K.ButtonR2, Scale: 2 } });
	// @ts-expect-error a Scriptable among the members of a device's binding
	InputActions.Bool({ Gamepad: onConsole ? K.ButtonA : InputActions.Scriptable });
	// @ts-expect-error a key binding under another name, in a union too
	InputActions.Bool({ Pad: onConsole ? K.ButtonA : { KeyCode: K.ButtonR2 } });

	return [fromType, conditional, look, keys, shapes];
}
