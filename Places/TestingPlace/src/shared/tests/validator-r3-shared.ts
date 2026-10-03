import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectArrayEqual,
	expectEqual,
	expectThrows,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService, RunService } from "@rbxts/services";
import { SA_SCHEMA, TEST_SCHEMA } from "shared/fixtures/schemas";

// Validator round 3: SanitizeBindings and realm checks, on both realms (expected to pass).

interface ISave {
	Version: number;
	Bindings: Record<string, Record<string, unknown>>;
}

function save(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

function sanitize(
	schema: InputActions.InputSchema<Record<string, InputActions.ContextSchema>>,
	json: string,
) {
	return HttpService.JSONDecode(InputActions.SanitizeBindings(schema, json)) as ISave;
}

function keysOf(record: object | undefined) {
	const keys = new Array<string>();
	if (record === undefined) return keys;
	for (const [key] of pairs(record as Record<string, unknown>)) keys.push(key as string);
	keys.sort();
	return keys;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR3SharedTests implements OnStart {
	onStart() {
		defineTests("validator-r3-shared", () => {
			test("SanitizeBindings keeps cleared composites and modifiers as None", () => {
				const clean = sanitize(
					TEST_SCHEMA as never,
					save({
						"Gameplay/Move/KeyboardAndMouse": { Up: "None", Down: "S", PrimaryModifier: "None" },
					}),
				);
				const entry = clean.Bindings["Gameplay/Move/KeyboardAndMouse"];
				expectArrayEqual(keysOf(entry), ["Down", "PrimaryModifier", "Up"]);
				expectEqual(entry?.Up, "None");
			});

			test("SanitizeBindings drops properties the action type doesn't have", () => {
				const clean = sanitize(
					TEST_SCHEMA as never,
					save({
						"Gameplay/Zoom/KeyboardAndMouse": { ResponseCurve: 2 },
						"Gameplay/Aim/KeyboardAndMouse": { PrimaryModifier: "LeftShift" },
						"Gameplay/Fly/KeyboardAndMouse": { KeyCode: "W" },
						"Gameplay/Jump/KeyboardAndMouse": { Scale: 2 },
						"Gameplay/Move/KeyboardAndMouse": { Forward: "W" },
					}),
				);
				expectArrayEqual(keysOf(clean.Bindings), []);
			});

			test("SanitizeBindings works on Server Authority contexts", () => {
				const clean = sanitize(
					SA_SCHEMA as never,
					save({
						"SaGameplay/Jump/KeyboardAndMouse": { KeyCode: "F" },
						"SaGameplay/Move/Virtual": { Up: "W" },
						"SaLocal/Wave/KeyboardAndMouse": { KeyCode: "H" },
					}),
				);
				expectArrayEqual(keysOf(clean.Bindings), [
					"SaGameplay/Jump/KeyboardAndMouse",
					"SaLocal/Wave/KeyboardAndMouse",
				]);
			});

			test("each realm refuses the other realm's entry points", () => {
				if (RunService.IsClient()) {
					expectThrows(() => InputActions.ProvideToPlayers(SA_SCHEMA));
				} else {
					expectThrows(() => InputActions.Create(TEST_SCHEMA));
				}
			});
		});
	}
}
