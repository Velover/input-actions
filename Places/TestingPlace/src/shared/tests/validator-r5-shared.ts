import { OnStart, Provider } from "@flamework-experimental/core";
import { defineTests, expectEqual, expectTrue, test } from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";

// Validator round 5: saves a client could send, cleaned on either realm (design spec section 7).
// The server realm matters most: SanitizeBindings is what a server runs on a client's JSON.

const EMPTY = '{"Version":1,"Bindings":{}}';

function clean(json: string) {
	const [ok, result] = pcall(() => InputActions.SanitizeBindings(TEST_SCHEMA, json));
	expectTrue(ok, `SanitizeBindings threw on ${json.sub(1, 60)}: ${result}`);
	return result as string;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR5SharedTests implements OnStart {
	onStart() {
		defineTests("validator-r5-shared", () => {
			test("saves nested far too deep are refused before decoding, on this realm", () => {
				const depth = 2000;
				const saves = [
					`${string.rep('{"a":', depth)}1${string.rep("}", depth)}`,
					`{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":${string.rep("[", depth)}${string.rep("]", depth)}}}}`,
					`{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"\\\\"},"x":${string.rep("[", depth)}`,
					`["\\"", ${string.rep('[{"k":', depth)}`,
				];
				for (const json of saves) expectEqual(clean(json), EMPTY, json.sub(1, 60));
			});

			test("a save nested exactly as deep as a save can be is still cleaned, not refused", () => {
				// the save, Bindings, an entry, a vector: 4 levels, then 4 more of nothing useful
				const json =
					'{"Version":1,"Bindings":{"Gameplay/Look/Mouse":{"Vector2Scale":[2,-2]},' +
					'"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"F","Extra":[[[[1]]]]},' +
					'"Gameplay/Jump/Gamepad":{"KeyCode":"ButtonB"}}}';
				const result = HttpService.JSONDecode(clean(json)) as {
					Bindings: Record<string, Record<string, unknown>>;
				};
				expectEqual(result.Bindings["Gameplay/Jump/Gamepad"]?.KeyCode, "ButtonB");
				expectEqual(
					(result.Bindings["Gameplay/Look/Mouse"]?.Vector2Scale as number[] | undefined)?.[1],
					-2,
				);
				expectEqual(result.Bindings["Gameplay/Jump/KeyboardAndMouse"], undefined, "the bad entry");
			});

			test("brackets and escaped quotes inside strings don't count as nesting", () => {
				const key = `${string.rep("[", 40)}\\"${string.rep("{", 40)}`;
				const json = `{"Version":1,"Bindings":{"${key}":{"KeyCode":"F"},"Gameplay/Jump/Gamepad":{"KeyCode":"ButtonB"}}}`;
				const result = HttpService.JSONDecode(clean(json)) as {
					Bindings: Record<string, Record<string, unknown>>;
				};
				expectEqual(result.Bindings["Gameplay/Jump/Gamepad"]?.KeyCode, "ButtonB", json);
			});
		});
	}
}
