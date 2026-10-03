// 0.7.0's usability features: PreferredDeviceChanged (F1), Describe (F2), FindConflicts (F3), the
// gestures on Bool actions (F4), and the compile errors that say why in words (F5). Checked by plain
// tsc; each rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";
import type { CheckBindings, CheckContexts } from "@rbxts/input-actions/out/InputActions/Types";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;

const FEATURES = InputActions.Schema({
	Play: {
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: { Main: K.Space, Alt: {} },
				Gamepad: K.ButtonA,
			}),
			Crouch: InputActions.Bool({ KeyboardAndMouse: K.C }, { TrackPrevious: true }),
			Throttle: InputActions.Direction1D({ KeyboardAndMouse: { Up: K.W, Down: K.S } }),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
				Gamepad: K.Thumbstick1,
				Virtual: InputActions.Scriptable,
			}),
			Aim: InputActions.ViewportPosition({ KeyboardAndMouse: K.MousePosition }),
		},
	},
	Net: {
		ServerAuthority: true,
		Actions: { Use: InputActions.Bool({ KeyboardAndMouse: K.E }) },
	},
});

/** A helper a project writes over any Bool action: the gestures are on InputActions.BoolAction */
function chargeBar(action: InputActions.BoolAction, bar: Frame) {
	return action.OnHold(() => print("charged"), {
		Duration: 1,
		Progress: (fraction: number) => (bar.Size = UDim2.fromScale(fraction, 1)),
		Cancelled: () => print("let go too soon"),
	});
}

/** A menu cell a project writes: any device's binding, of any action type */
function cell(binding: InputActions.BindingHandle<Enum.InputActionType, InputActions.Device>) {
	return binding.Describe();
}

export function FeaturesTypeRules(bar: Frame, player: Player) {
	const Input = InputActions.Create(FEATURES);
	const { Jump, Crouch, Throttle, Move, Aim } = Input.Play.Actions;

	// ---- F1: PreferredDeviceChanged
	const signal: RBXScriptSignal<(device: InputActions.Device) => void> = InputActions.PreferredDeviceChanged;
	InputActions.PreferredDeviceChanged.Connect((device) => {
		const shown: InputActions.Device = device;
		return shown;
	});
	const waited: InputActions.Device = InputActions.PreferredDeviceChanged.Wait()[0];
	// @ts-expect-error the device is the binding's name: never MicroGamepad
	InputActions.PreferredDeviceChanged.Connect((device: "MicroGamepad") => device);
	// @ts-expect-error a signal: it can't be fired from outside
	InputActions.PreferredDeviceChanged.Fire("Gamepad");

	// ---- F2: Describe
	const texts: string[] = [
		Jump.Bindings.KeyboardAndMouse.Describe(),
		Jump.Bindings.KeyboardAndMouse.Alt.Describe(),
		Jump.Bindings.Gamepad.Describe(),
		Jump.Bindings.Touch.Describe(),
		Move.Bindings.KeyboardAndMouse.Describe(),
		Aim.Bindings.Gamepad.Describe(),
		Jump.Describe(),
		Jump.Describe("Gamepad"),
		Move.Describe("Touch"),
		Aim.Describe(InputActions.PreferredDevice()),
		Jump.Bindings[InputActions.PreferredDevice()].Describe(),
		Jump.Bindings.KeyboardAndMouse.Extras().Alt?.Describe() ?? "",
		cell(Jump.Bindings.Gamepad),
		cell(Move.Bindings.Touch),
	];
	// @ts-expect-error Describe takes a device's name
	Jump.Describe("Mouse");
	// @ts-expect-error a Scriptable binding has no keys to describe
	Move.Bindings.Virtual.Describe();
	// @ts-expect-error Describe is a member of a binding handle: no extra can take its name
	InputActions.Bool({ KeyboardAndMouse: { Main: K.Space, Describe: K.F } });

	// ---- F3: FindConflicts, on the root handle and on a context handle
	const conflicts: InputActions.BindingConflict[] = Input.FindConflicts(Jump.Bindings.KeyboardAndMouse);
	Input.FindConflicts(Jump.Bindings.KeyboardAndMouse.Alt);
	Input.FindConflicts(Jump.Bindings.Gamepad);
	Input.FindConflicts(Jump.Bindings.Touch);
	Input.FindConflicts(Move.Bindings.KeyboardAndMouse);
	Input.FindConflicts(Throttle.Bindings.Gamepad);
	Input.FindConflicts(Jump.Bindings[InputActions.PreferredDevice()]);
	const within: InputActions.BindingConflict[] = Input.Play.FindConflicts(Crouch.Bindings.KeyboardAndMouse);
	for (const conflict of conflicts) {
		const path: string = conflict.Path;
		const key: Enum.KeyCode = conflict.Key;
		const keys: readonly Enum.KeyCode[] = conflict.Keys;
		const identical: boolean = conflict.Identical;
		conflict.Binding.Clear();
		print(path, key, keys, identical, conflict.Binding.Describe(), conflict.Binding.Name);
	}
	const pairs: InputActions.ConflictPair[] = Input.FindConflicts();
	for (const pair of Input.Play.FindConflicts()) {
		const [first, second] = pair.Paths;
		pair.Bindings[1].Reset();
		print(`${first} and ${second} share ${pair.Key.Name}`, pair.Identical);
	}
	// @ts-expect-error a Scriptable binding has no keys
	Input.FindConflicts(Move.Bindings.Virtual);
	// @ts-expect-error an action handle is no binding handle
	Input.FindConflicts(Jump);
	// @ts-expect-error the other binding's handle has no captures without knowing its device
	conflicts[0].Binding.Capture("KeyCode", () => {});

	// ---- F4: gestures, on Bool actions
	const stops: Array<() => void> = [
		Jump.OnTap(() => {}),
		Jump.OnTap(() => {}, { MaxDuration: 0.2, WaitForDoubleTap: true, Window: 0.35 }),
		Jump.OnDoubleTap(() => {}, { Window: 0.3, MaxDuration: 0.25 }),
		Jump.OnHold(() => {}, { Duration: 1 }),
		Jump.OnLongPress((heldFor: number) => print(heldFor), { Duration: 0.5 }),
		Crouch.OnTap(() => {}),
		chargeBar(Jump, bar),
		chargeBar(Crouch, bar),
		chargeBar(Input.Net.Actions.Use, bar),
	];
	const tap: InputActions.TapOptions = { WaitForDoubleTap: true };
	const double: InputActions.DoubleTapOptions = {};
	const hold: InputActions.HoldOptions = { Duration: 2 };
	const long: InputActions.LongPressOptions = { Duration: 1 };
	// @ts-expect-error gestures are on Bool actions only
	Move.OnTap(() => {});
	// @ts-expect-error nor on a Direction1D action
	Throttle.OnHold(() => {}, { Duration: 1 });
	// @ts-expect-error nor on a ViewportPosition action
	Aim.OnLongPress(() => {}, { Duration: 1 });
	// @ts-expect-error OnHold needs its options
	Jump.OnHold(() => {});
	// @ts-expect-error and their Duration
	Jump.OnHold(() => {}, {});
	// @ts-expect-error OnLongPress too
	Jump.OnLongPress(() => {}, {});
	// @ts-expect-error an unknown option
	Jump.OnTap(() => {}, { MaxDurationn: 0.2 });
	// @ts-expect-error Progress gets a number
	Jump.OnHold(() => {}, { Duration: 1, Progress: (fraction: string) => fraction });
	// @ts-expect-error a duration is a number
	Jump.OnDoubleTap(() => {}, { Window: "0.3" });
	// @ts-expect-error the server's handles have no gestures
	InputActions.ForPlayer(FEATURES, player).Net.Actions.Use.OnTap(() => {});

	return [signal, waited, texts, within, pairs, stops, tap, double, hold, long];
}

// ---- F5: what the checks refuse is a sentence, in the runtime's words. Each line reads the type a
// binding is checked against, and must be that sentence exactly

type Check<B, T extends Enum.InputActionType = BoolType> = CheckBindings<B, T>;
export const SENTENCES: string[] = [];
const sentence = <S extends string>(value: S) => SENTENCES.push(value);
sentence<Check<{ Gamepad: Enum.KeyCode.Space }>["Gamepad"]>(
	"Space is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys",
);
sentence<Check<{ KeyboardAndMouse: Enum.KeyCode.ButtonA }>["KeyboardAndMouse"]>(
	"ButtonA is a Gamepad key: a KeyboardAndMouse binding takes keyboard and mouse keys",
);
sentence<Check<{ Touch: Enum.KeyCode.E }>["Touch"]>(
	"E is a KeyboardAndMouse key: a Touch binding takes touch keys (TouchPosition, TouchDelta, TouchPinch)",
);
sentence<Check<{ KeyboardAndMouse: Enum.KeyCode.MouseDelta }>["KeyboardAndMouse"]>(
	"MouseDelta is not allowed in KeyCode on a Bool action",
);
sentence<Check<{ KeyboardAndMouse: Enum.KeyCode.E }, Enum.InputActionType.Direction3D>["KeyboardAndMouse"]>(
	"E is not allowed in KeyCode on a Direction3D action",
);
sentence<Check<{ Keys: Enum.KeyCode.Space }>["Keys"]>(
	"Keys is not a device: bindings with keys are named KeyboardAndMouse, Gamepad, Touch; any other binding must be InputActions.Scriptable",
);
sentence<Check<{ Gamepad: InputActions.Scriptable }>["Gamepad"]>(
	"Gamepad is a device: its bindings hold keys, not InputActions.Scriptable; name a Scriptable binding beside the devices",
);
sentence<Check<{ KeyboardAndMouse: { Main: Enum.KeyCode.Space; Get: Enum.KeyCode.F } }>["KeyboardAndMouse"]["Get"]>(
	"Get is a member of a binding handle, which the device's extras hang off (Bindings.<Device>.<Extra>): name the extra something else",
);
sentence<Check<{ KeyboardAndMouse: { Main: Enum.KeyCode.Space; KeyCode: Enum.KeyCode.F } }>["KeyboardAndMouse"]["KeyCode"]>(
	"KeyCode is a binding property, not an extra binding: { Main: <binding>, <Name>: <binding> } holds the device's bindings by names of your own",
);
sentence<Check<{ KeyboardAndMouse: { Main: Enum.KeyCode.Space; "a/b": Enum.KeyCode.F } }>["KeyboardAndMouse"]["a/b"]>(
	"a/b: an extra binding's name can't contain /",
);
sentence<Check<{ Gamepad: { KeyCode: Enum.KeyCode.ButtonA; PrimaryModifier: Enum.KeyCode.LeftShift } }>["Gamepad"]["PrimaryModifier"]>(
	"LeftShift is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys",
);
sentence<Check<{ Gamepad: { KeyCode: Enum.KeyCode.Thumbstick1; Up: Enum.KeyCode.DPadUp } }, Enum.InputActionType.Direction2D>["Gamepad"]["Up"]>(
	"KeyCode and composite directions can't share a binding",
);
sentence<Check<{ KeyboardAndMouse: { KeyCode: Enum.KeyCode.E; Alt: Enum.KeyCode.F } }>["KeyboardAndMouse"]["Alt"]>(
	"Alt is not a property of a Bool binding; several bindings of one device go in { Main: <binding>, Alt: <binding> }",
);
sentence<Check<{ KeyboardAndMouse: Enum.UserInputType.Touch }>["KeyboardAndMouse"]>(
	"a binding must be an Enum.KeyCode, an object or InputActions.Scriptable",
);
// a number, a boolean or a string is checked against an object named by the sentence (intersected
// with a string it would be never)
const typo: Check<{ KeyboardAndMouse: { KeyCode: Enum.KeyCode.E; Typo: 1 } }>["KeyboardAndMouse"]["Typo"] = {} as {
	readonly "Typo is not a property of a Bool binding": never;
};
const curve: Check<
	{ KeyboardAndMouse: { KeyCode: Enum.KeyCode.MouseDelta; ResponseCurve: 2 } },
	Enum.InputActionType.Direction2D
>["KeyboardAndMouse"]["ResponseCurve"] = {} as {
	readonly "ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode, which a KeyboardAndMouse binding can't hold": never;
};
const option: CheckContexts<{ Play: { ServerAuthorty: true; Actions: {} } }>["Play"]["ServerAuthorty"] = {} as {
	readonly "unknown option ServerAuthorty; a context has ServerAuthority, Priority, Sink, Enabled and Actions": never;
};
// what fits is checked against itself: no sentence
const fits: Check<{ Gamepad: Enum.KeyCode.ButtonA }>["Gamepad"] = Enum.KeyCode.ButtonA;
// @ts-expect-error a sentence is that sentence, no other
sentence<Check<{ Gamepad: Enum.KeyCode.Space }>["Gamepad"]>("Space is not allowed");
export const KEPT = [typo, curve, option, fits];
