import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectThrows,
	expectTrue,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { KeyText } from "@rbxts/input-actions/out/InputActions/Describe";
import {
	DELTA_1D_KEYS,
	DELTA_2D_KEYS,
	GAMEPAD_KEYS,
	MOUSE_BUTTON_KEYS,
	POSITION_KEYS,
	TOUCH_KEYS,
} from "@rbxts/input-actions/out/InputActions/KeyGroups";
import { newFolder } from "./helpers";
import { realInput } from "./virtual";

const K = Enum.KeyCode;

const DESCRIBE_SCHEMA = InputActions.Schema({
	Describe: {
		Priority: 3000,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.Space, Gamepad: K.ButtonA }),
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.S, PrimaryModifier: K.LeftControl },
			}),
			Interact: InputActions.Bool({ KeyboardAndMouse: { KeyCode: K.E, DisplayName: "Use" } }),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
					Arrows: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
				},
				Gamepad: K.Thumbstick1,
				Virtual: InputActions.Scriptable,
			}),
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Up: K.W, Down: K.S },
				Gamepad: K.ButtonR2,
			}),
			Fly: InputActions.Direction3D({
				KeyboardAndMouse: {
					Up: K.E,
					Down: K.Q,
					Forward: K.W,
					Backward: K.S,
					Left: K.A,
					Right: K.D,
				},
			}),
			Aim: InputActions.ViewportPosition({
				KeyboardAndMouse: K.MousePosition,
				Touch: K.TouchPosition,
			}),
			Extra: InputActions.Bool({ KeyboardAndMouse: { Main: {}, Alt: K.G } }),
		},
	},
});

function createDescribe() {
	const input = InputActions.Create(DESCRIBE_SCHEMA, {
		Folder: newFolder(),
		ResetOnFocusLoss: false,
	});
	defer(() => input.Destroy());
	return input;
}

/**
 * Keybinds as text (0.7.0, F2): `binding.Describe()` and `action.Describe(device?)`. Key names come
 * from `UserInputService:GetStringForKeyCode` (the keyboard layout's character), with readable names
 * where it gives the enum's own name (measured: every key that types no character)
 */
@Provider({ activeIn: ["testing"] })
export class DescribeTests implements OnStart {
	onStart() {
		defineTests("describe", () => {
			test("key names: a character key's character, readable names for the others", () => {
				const cases: Array<[Enum.KeyCode, string]> = [
					[K.Space, "Space"],
					[K.E, "E"],
					[K.Comma, ","],
					[K.Zero, "0"],
					[K.Return, "Enter"],
					[K.LeftControl, "Ctrl"],
					[K.RightShift, "Right Shift"],
					[K.CapsLock, "Caps Lock"],
					[K.KeypadOne, "Num 1"],
					[K.KeypadMinus, "Num -"],
					[K.F5, "F5"],
					[K.Tab, "Tab"],
					[K.Backspace, "Backspace"],
					[K.Up, "Up"],
					[K.MouseLeftButton, "Left Click"],
					[K.MouseWheel, "Mouse Wheel"],
					[K.MouseDelta, "Mouse Movement"],
					[K.TouchPosition, "Touch"],
					[K.ButtonA, "A"],
					[K.ButtonL1, "LB"],
					[K.ButtonR2, "RT"],
					[K.DPadUp, "D-Pad Up"],
					[K.Thumbstick1, "Left Stick"],
					[K.Thumbstick2Left, "Right Stick Left"],
					[K.ButtonCenter, "Remote Center"],
				];
				for (const [key, text] of cases) expectEqual(KeyText(key), text, key.Name);
			});

			test("every key has a name, and no gamepad, mouse or touch key reads as its enum name", () => {
				for (const key of K.GetEnumItems()) {
					const text = KeyText(key);
					expectTrue(text.match("%S")[0] !== undefined, `${key.Name}: "${text}"`);
				}
				const internal = [
					...GAMEPAD_KEYS,
					...TOUCH_KEYS,
					...MOUSE_BUTTON_KEYS,
					...DELTA_1D_KEYS,
					...DELTA_2D_KEYS,
					...POSITION_KEYS,
				];
				for (const key of internal) {
					expectTrue(KeyText(key) !== key.Name, `${key.Name} has a readable name`);
				}
			});

			test("binding.Describe: a key, a chord, a composite in reading order, DisplayName, unbound", () => {
				const actions = createDescribe().Describe.Actions;
				expectEqual(actions.Jump.Bindings.KeyboardAndMouse.Describe(), "Space");
				expectEqual(actions.Jump.Bindings.Gamepad.Describe(), "A");
				expectEqual(actions.Jump.Bindings.Touch.Describe(), "", "unbound");
				expectEqual(actions.QuickSave.Bindings.KeyboardAndMouse.Describe(), "Ctrl + S");
				expectEqual(
					actions.Interact.Bindings.KeyboardAndMouse.Describe(),
					"Use",
					"DisplayName wins",
				);
				expectEqual(actions.Move.Bindings.KeyboardAndMouse.Describe(), "W / A / S / D");
				expectEqual(
					actions.Move.Bindings.KeyboardAndMouse.Arrows.Describe(),
					"Up / Left / Down / Right",
				);
				expectEqual(actions.Move.Bindings.Gamepad.Describe(), "Left Stick");
				expectEqual(actions.Throttle.Bindings.KeyboardAndMouse.Describe(), "W / S");
				expectEqual(actions.Throttle.Bindings.Gamepad.Describe(), "RT");
				expectEqual(actions.Fly.Bindings.KeyboardAndMouse.Describe(), "E / A / Q / D / W / S");
				expectEqual(actions.Aim.Bindings.KeyboardAndMouse.Describe(), "Mouse Position");
				expectEqual(actions.Aim.Bindings.Touch.Describe(), "Touch");
				expectEqual(actions.Aim.Bindings.Gamepad.Describe(), "", "a gamepad has no position");
				expectEqual(actions.Extra.Bindings.KeyboardAndMouse.Describe(), "", "Main: {}");
				expectEqual(actions.Extra.Bindings.KeyboardAndMouse.Alt.Describe(), "G");
			});

			test("binding.Describe follows Set, Clear and Reset: two modifiers, a modifier on a composite", () => {
				const actions = createDescribe().Describe.Actions;
				const save = actions.QuickSave.Bindings.KeyboardAndMouse;
				save.Set({ SecondaryModifier: K.LeftShift });
				expectEqual(save.Describe(), "Ctrl + Shift + S");
				save.Clear("PrimaryModifier");
				expectEqual(save.Describe(), "Shift + S");
				const move = actions.Move.Bindings.KeyboardAndMouse;
				move.Set({ PrimaryModifier: K.LeftAlt });
				expectEqual(move.Describe(), "Alt + (W / A / S / D)");
				move.Clear("PrimaryModifier");
				move.Clear("Left");
				expectEqual(move.Describe(), "W / S / D");
				move.Set(K.MouseDelta);
				expectEqual(move.Describe(), "Mouse Movement");
				move.Set({ DisplayName: "Walk" });
				expectEqual(move.Describe(), "Walk");
				move.Reset();
				expectEqual(move.Describe(), "W / A / S / D");
				move.Clear();
				expectEqual(move.Describe(), "", "unbound");
				const jump = actions.Jump.Bindings.KeyboardAndMouse;
				jump.Set(K.KeypadEnter);
				expectEqual(jump.Describe(), "Num Enter");
				jump.Set({ KeyCode: K.Comma, PrimaryModifier: K.RightControl });
				expectEqual(jump.Describe(), "Right Ctrl + ,");
			});

			test("action.Describe: the device's main binding, by default the one the player uses", () => {
				const actions = createDescribe().Describe.Actions;
				expectEqual(actions.Jump.Describe("KeyboardAndMouse"), "Space");
				expectEqual(actions.Jump.Describe("Gamepad"), "A");
				expectEqual(actions.Jump.Describe("Touch"), "");
				expectEqual(actions.Move.Describe("KeyboardAndMouse"), "W / A / S / D", "the main binding");
				expectEqual(
					actions.Extra.Describe("KeyboardAndMouse"),
					"",
					"the main binding, not the extra",
				);
				const device = InputActions.PreferredDevice();
				for (const [, action] of pairs(actions)) {
					const handle = action as InputActions.Action;
					expectEqual(
						handle.Describe(),
						handle.Bindings[device].Describe(),
						`${handle.Name} on ${device}`,
					);
				}
				const message = expectThrows(
					() => actions.Jump.Describe("Mouse" as InputActions.Device),
					"Describe of a name that isn't a device",
				);
				const expected = "Describe takes a device (KeyboardAndMouse, Gamepad, Touch), not Mouse";
				expectTrue(message.find(expected, 1, true)[0] !== undefined, message);
			});

			test("Describe reads a key captured for real", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createDescribe().Describe.Actions.Jump;
				let captured: Enum.KeyCode | undefined;
				jump.Capture((key) => (captured = key));
				real.Tap(K.KeypadSeven);
				eventually(() => captured !== undefined, `the capture${real.FocusNote()}`);
				expectEqual(jump.Bindings.KeyboardAndMouse.Describe(), "Num 7");
				expectEqual(jump.Describe("KeyboardAndMouse"), "Num 7");
			});
		});
	}
}
