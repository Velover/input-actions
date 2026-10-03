import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectEqual,
	expectThrows,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { CheckBindingSpec } from "@rbxts/input-actions/out/InputActions/BindingRules";

const K = Enum.KeyCode;

/**
 * The compile errors say why in words (0.7.0, F5): the sentences the types check a refused binding
 * against (`tests/type-rules/features-type-rules.ts` pins them) are the runtime's, so a schema made
 * through a cast reads the same at runtime
 */
@Provider({ activeIn: ["testing"] })
export class ReadableErrorsTests implements OnStart {
	onStart() {
		defineTests("readable-errors", () => {
			test("the runtime refuses a binding in the compile errors' words", () => {
				const cases: Array<[Enum.InputActionType["Name"], unknown, InputActions.Device, string]> = [
					[
						"Bool",
						K.Space,
						"Gamepad",
						"Space is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys",
					],
					[
						"Bool",
						K.ButtonA,
						"KeyboardAndMouse",
						"ButtonA is a Gamepad key: a KeyboardAndMouse binding takes keyboard and mouse keys",
					],
					[
						"Bool",
						K.E,
						"Touch",
						"E is a KeyboardAndMouse key: a Touch binding takes touch keys (TouchPosition, TouchDelta, TouchPinch)",
					],
					[
						"Bool",
						K.MouseDelta,
						"KeyboardAndMouse",
						"MouseDelta is not allowed in KeyCode on a Bool action",
					],
					[
						"Direction3D",
						K.E,
						"KeyboardAndMouse",
						"E is not allowed in KeyCode on a Direction3D action",
					],
					[
						"Bool",
						{ KeyCode: K.ButtonA, PrimaryModifier: K.LeftShift },
						"Gamepad",
						"LeftShift is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys",
					],
					[
						"Direction2D",
						{ KeyCode: K.Thumbstick1, Up: K.DPadUp },
						"Gamepad",
						"KeyCode and composite directions can't share a binding",
					],
					[
						"Bool",
						{ KeyCode: K.E, Typo: 1 },
						"KeyboardAndMouse",
						"Typo is not a property of a Bool binding",
					],
					[
						"Bool",
						Enum.UserInputType.Touch,
						"KeyboardAndMouse",
						"a binding must be an Enum.KeyCode, an object or InputActions.Scriptable",
					],
				];
				for (const [actionType, spec, device, sentence] of cases) {
					expectEqual(CheckBindingSpec(actionType, spec, device), sentence, sentence);
				}
			});

			test("Schema's message for a second binding written beside the keys is the compile error's", () => {
				const message = expectThrows(
					() =>
						InputActions.Schema({
							Play: {
								Actions: {
									Jump: InputActions.Bool({
										KeyboardAndMouse: { KeyCode: K.E, Alt: K.F },
									} as never),
								},
							},
						}),
					"a key beside the keys",
				);
				const sentence =
					"Alt is not a property of a Bool binding; several bindings of one device go in { Main: <binding>, Alt: <binding> }";
				expectTrue(message.find(sentence, 1, true)[0] !== undefined, message);
			});
		});
	}
}
