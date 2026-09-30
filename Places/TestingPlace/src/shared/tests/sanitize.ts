import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectArrayEqual,
	expectEqual,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";

interface ISave {
	Version: number;
	Bindings: Record<string, Record<string, unknown>>;
}

function decode(json: string) {
	return HttpService.JSONDecode(json) as ISave;
}

function paths(save: ISave) {
	const list = new Array<string>();
	for (const [path] of pairs(save.Bindings)) list.push(path as string);
	list.sort();
	return list;
}

/** SanitizeBindings: the import validation against the schema alone (design spec §7) */
@Provider({ activeIn: ["testing"] })
export class SanitizeTests implements OnStart {
	onStart() {
		defineTests("sanitize", () => {
			test("keeps valid entries and drops every invalid one", () => {
				const json = HttpService.JSONEncode({
					Version: 1,
					Bindings: {
						"Gameplay/Jump/KeyboardAndMouse": { KeyCode: "F" },
						"Gameplay/Move/KeyboardAndMouse": { Up: "Up", Down: "Down" },
						"Gameplay/Look/Mouse": { Scale: 0.5, Vector2Scale: [1, -1] },
						"Gameplay/Jump/Gamepad": { KeyCode: "Unknown" },
						"Gameplay/Nope/KeyboardAndMouse": { KeyCode: "F" },
						"Gameplay/Jump/Nope": { KeyCode: "F" },
						"Gameplay/Move/Virtual": { KeyCode: "Thumbstick1" },
						"Gameplay/Fire/Mouse": { Foo: 1 },
						"Gameplay/Zoom/Mouse": { KeyCode: "Nope" },
						"Gameplay/Aim/Pointer": { KeyCode: "MouseDelta" },
						"Gameplay/QuickSave/KeyboardAndMouse": { KeyCode: "Escape" },
						"Gameplay/Fire/Gamepad": { PressedThreshold: "high" },
						"Gameplay/Steer/Gamepad": { Scale: [1] },
						"Menu/Open/KeyboardAndMouse": "M",
						Extra: { KeyCode: "F" },
					},
				});
				const clean = decode(InputActions.SanitizeBindings(TEST_SCHEMA, json));
				expectEqual(clean.Version, 1);
				expectArrayEqual(paths(clean), [
					"Gameplay/Jump/Gamepad",
					"Gameplay/Jump/KeyboardAndMouse",
					"Gameplay/Look/Mouse",
					"Gameplay/Move/KeyboardAndMouse",
				]);
				expectEqual(clean.Bindings["Gameplay/Jump/KeyboardAndMouse"].KeyCode, "F");
				// "Unknown" resolves to None, the name of a cleared slot
				expectEqual(clean.Bindings["Gameplay/Jump/Gamepad"].KeyCode, "None");
				const look = clean.Bindings["Gameplay/Look/Mouse"];
				expectEqual(look.Scale, 0.5);
				expectArrayEqual(look.Vector2Scale as number[], [1, -1]);
			});

			test("a bad save gives an empty clean save", () => {
				for (const json of [
					"not json",
					"[1,2]",
					'"text"',
					'{"Version":2,"Bindings":{}}',
					'{"Version":1}',
				]) {
					const clean = decode(InputActions.SanitizeBindings(TEST_SCHEMA, json));
					expectEqual(clean.Version, 1, json);
					expectArrayEqual(paths(clean), [], json);
				}
			});

			test("an entry with KeyCode and a composite direction is dropped", () => {
				const json = HttpService.JSONEncode({
					Version: 1,
					Bindings: { "Gameplay/Move/KeyboardAndMouse": { KeyCode: "Thumbstick1", Up: "W" } },
				});
				expectArrayEqual(paths(decode(InputActions.SanitizeBindings(TEST_SCHEMA, json))), []);
			});

			test("a ResponseCurve stays only where the binding ends on a thumbstick", () => {
				const json = HttpService.JSONEncode({
					Version: 1,
					Bindings: {
						// the schema's KeyCode is Thumbstick1
						"Gameplay/Move/Gamepad": { ResponseCurve: 3 },
						// the entry's own thumbstick on a mouse slot
						"Gameplay/Look/Mouse": { KeyCode: "Thumbstick2", ResponseCurve: 3 },
						// the composite clears the KeyCode
						"Gameplay/Look/Gamepad": { Up: "W", ResponseCurve: 3 },
					},
				});
				const clean = decode(InputActions.SanitizeBindings(TEST_SCHEMA, json));
				expectArrayEqual(paths(clean), ["Gameplay/Look/Mouse", "Gameplay/Move/Gamepad"]);
				expectEqual(clean.Bindings["Gameplay/Move/Gamepad"].ResponseCurve, 3);
			});

			test("works without instances, so the server can clean a client's save", () => {
				const before = game.GetDescendants().size();
				const clean = InputActions.SanitizeBindings(
					TEST_SCHEMA,
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"G"}}}',
				);
				expectEqual(game.GetDescendants().size(), before);
				expectTrue(clean.find('"G"', 1, true)[0] !== undefined, clean);
			});
		});
	}
}
