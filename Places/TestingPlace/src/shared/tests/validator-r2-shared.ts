import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectEqual,
	expectNoThrow,
	expectThrows,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";

// Validator round 2: SanitizeBindings and Schema edge cases, on both realms.

interface ISave {
	Version: number;
	Bindings: Record<string, Record<string, unknown>>;
}

function save(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

function sanitize(json: string) {
	return HttpService.JSONDecode(InputActions.SanitizeBindings(TEST_SCHEMA, json)) as ISave;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR2SharedTests implements OnStart {
	onStart() {
		defineTests("validator-r2-shared", () => {
			test("SanitizeBindings is idempotent", () => {
				const json = save({
					"Gameplay/Jump/KeyboardAndMouse": { KeyCode: "F", PrimaryModifier: "LeftShift" },
					"Gameplay/Move/Gamepad": { KeyCode: "Thumbstick1", ResponseCurve: 3 },
					"Gameplay/Look/KeyboardAndMouse": { Scale: 0.05, Vector2Scale: [1, 1] },
					"Gameplay/Zoom/Gamepad": { Up: "Unknown" },
					"Gameplay/Jump/Nope": { KeyCode: "F" },
				});
				const once = sanitize(json);
				const twice = sanitize(HttpService.JSONEncode(once));
				// JSONEncode's key order isn't stable: compare entry by entry
				let count = 0;
				for (const [path, entry] of pairs(once.Bindings)) {
					count++;
					const other = twice.Bindings[path as string];
					for (const [name, value] of pairs(entry)) {
						expectEqual(
							HttpService.JSONEncode(other?.[name as string]),
							HttpService.JSONEncode(value),
							`${path}.${name}`,
						);
					}
				}
				for (const _ of pairs(twice.Bindings)) count--;
				expectEqual(count, 0, "the same paths");
			});

			test("SanitizeBindings writes Unknown as None", () => {
				const clean = sanitize(save({ "Gameplay/Zoom/Gamepad": { Up: "Unknown" } }));
				expectEqual(clean.Bindings["Gameplay/Zoom/Gamepad"]?.Up, "None");
			});

			test("SanitizeBindings drops entries with odd values", () => {
				const clean = sanitize(
					save({
						"Gameplay/Jump/KeyboardAndMouse": { KeyCode: 32 },
						"Gameplay/Look/KeyboardAndMouse": { Scale: "2" },
						"Gameplay/Look/Gamepad": { Vector2Scale: [1] },
						"Gameplay/Fly/KeyboardAndMouse": { Vector3Scale: [1, 2, "3"] },
						"Gameplay/Zoom/KeyboardAndMouse": { PressedThreshold: 0.5 },
						"Gameplay/Fire/KeyboardAndMouse": ["KeyCode", "F"],
					}),
				);
				const kept = new Array<string>();
				for (const [path] of pairs(clean.Bindings)) kept.push(path as string);
				expectEqual(kept.size(), 0, `kept: ${kept.join(", ")}`);
			});

			test("SanitizeBindings of an array of bindings gives an empty save", () => {
				const clean = InputActions.SanitizeBindings(
					TEST_SCHEMA,
					'{"Version":1,"Bindings":[{"KeyCode":"F"}]}',
				);
				expectEqual(clean, '{"Version":1,"Bindings":{}}');
			});

			test("SanitizeBindings never throws on non-string input", () => {
				expectNoThrow(() =>
					InputActions.SanitizeBindings(TEST_SCHEMA, undefined as unknown as string),
				);
				expectNoThrow(() => InputActions.SanitizeBindings(TEST_SCHEMA, 5 as unknown as string));
			});

			test("Schema refuses a binding that is not a key, an object or Scriptable", () => {
				expectThrows(() =>
					InputActions.Schema({
						Bad: {
							Actions: {
								Jump: InputActions.Bool({
									KeyboardAndMouse: "Space" as unknown as Enum.KeyCode.Space,
								}),
							},
						},
					}),
				);
			});
		});
	}
}
