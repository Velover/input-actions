import { OnStart, Provider } from "@flamework-experimental/core";
import { defineTests, expectEqual, expectTrue, test } from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";

// Validator round 1: adversarial checks of the schema-only paths, on both realms.

interface ISave {
	Version: number;
	Bindings: Record<string, Record<string, unknown>>;
}

function sanitize(bindings: Record<string, unknown>) {
	const json = HttpService.JSONEncode({ Version: 1, Bindings: bindings });
	return HttpService.JSONDecode(InputActions.SanitizeBindings(TEST_SCHEMA, json)) as ISave;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR1SharedTests implements OnStart {
	onStart() {
		defineTests("validator-r1-shared", () => {
			test("SanitizeBindings drops a ResponseCurve on a binding that is not a thumbstick", () => {
				// Set refuses it (ResponseCurve is Stick only, spec section 3); a clean save must not carry it
				const clean = sanitize({ "Gameplay/Look/KeyboardAndMouse": { ResponseCurve: 2 } });
				expectEqual(clean.Bindings["Gameplay/Look/KeyboardAndMouse"], undefined);
			});

			test("SanitizeBindings keeps a cleared modifier", () => {
				const clean = sanitize({
					"Gameplay/QuickSave/KeyboardAndMouse": { KeyCode: "S", PrimaryModifier: "None" },
				});
				const entry = clean.Bindings["Gameplay/QuickSave/KeyboardAndMouse"];
				expectTrue(entry !== undefined, "the entry is kept");
				expectEqual(entry.PrimaryModifier, "None");
			});

			test("SanitizeBindings never throws on odd paths", () => {
				const clean = sanitize({
					"": { KeyCode: "F" },
					"/": { KeyCode: "F" },
					"Gameplay//KeyboardAndMouse": { KeyCode: "F" },
					"Gameplay/Jump/": { KeyCode: "F" },
					"Nope/Jump/KeyboardAndMouse": { KeyCode: "F" },
					"Gameplay/Jump/KeyboardAndMouse/Extra": { KeyCode: "F" },
				});
				let count = 0;
				for (const _ of pairs(clean.Bindings)) count++;
				expectEqual(count, 0);
			});

			test("UiNavigation returns fresh definitions and keeps its options", () => {
				const a = InputActions.Presets.UiNavigation({ Priority: 5 });
				const b = InputActions.Presets.UiNavigation();
				expectEqual(a.Priority, 5);
				expectEqual((b as { Priority?: number }).Priority, undefined);
				expectTrue(a.Actions !== b.Actions);
			});
		});
	}
}
