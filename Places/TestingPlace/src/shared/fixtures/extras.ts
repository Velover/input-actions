import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;

/**
 * Extra bindings per device (0.7.0): WASD plus the arrows, the stick plus the D-pad, an Alternate
 * column that starts unbound, a touch extra, an unbound Main, and a device without extras. Priority
 * 3000: real keys reach it above the player scripts' contexts and the template other sections leave
 * enabled (CLAUDE.md)
 */
export const EXTRAS_SCHEMA = InputActions.Schema({
	Extras: {
		Priority: 3000,
		Actions: {
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
					Arrows: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
				},
				Gamepad: {
					Main: K.Thumbstick1,
					DPad: { Up: K.DPadUp, Down: K.DPadDown, Left: K.DPadLeft, Right: K.DPadRight },
				},
				Virtual: InputActions.Scriptable,
			}),
			Jump: InputActions.Bool({
				KeyboardAndMouse: { Main: K.Space, Alt: {} },
				Gamepad: { Main: K.ButtonA, Alt: { KeyCode: K.ButtonL1, PressedThreshold: 0.4 } },
				Touch: { Main: K.TouchPosition, Second: {} },
			}),
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Main: {}, Wheel: K.MouseWheel },
				Gamepad: K.ButtonR2,
			}),
			Dash: InputActions.Bool({ KeyboardAndMouse: K.LeftShift }),
		},
	},
});
