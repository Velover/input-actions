import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectArrayEqual,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import {
	BindingNameProblem,
	CheckBindingSpec,
	DecodeSavedEntry,
	IsKeyAllowed,
} from "@rbxts/input-actions/out/InputActions/BindingRules";
import {
	DEVICES,
	GAMEPAD_KEYS,
	GetKeyDevice,
	IsDevice,
	TOUCH_KEYS,
} from "@rbxts/input-actions/out/InputActions/KeyGroups";
import { HttpService } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";

const K = Enum.KeyCode;

/** A schema the types would reject, to reach the runtime checks */
function untypedSchema(contexts: unknown) {
	return (InputActions.Schema as (contexts: unknown) => unknown)(contexts);
}

/** `Schema` with one action of one binding, past the types */
function oneBinding(builder: (bindings: never) => unknown, slot: string, spec: unknown) {
	const bindings: Record<string, unknown> = {};
	bindings[slot] = spec;
	return () => untypedSchema({ Play: { Actions: { Jump: builder(bindings as never) } } });
}

function contains(text: string, part: string) {
	return text.find(part, 1, true)[0] !== undefined;
}

function sanitize(bindings: Record<string, unknown>) {
	const json = HttpService.JSONEncode({ Version: 1, Bindings: bindings });
	return HttpService.JSONDecode(InputActions.SanitizeBindings(TEST_SCHEMA, json)) as {
		Bindings: Record<string, Record<string, unknown>>;
	};
}

function paths(save: { Bindings: Record<string, unknown> }) {
	const list = new Array<string>();
	for (const [path] of pairs(save.Bindings)) list.push(path as string);
	list.sort();
	return list;
}

/**
 * Device bindings (0.7.0, design spec §3, §4): binding names are devices, each binding holds its
 * device's keys, checked by Schema, the rules and SanitizeBindings on both realms
 */
@Provider({ activeIn: ["testing"] })
export class DevicesSharedTests implements OnStart {
	onStart() {
		defineTests("devices", () => {
			test("the devices are Enum.PreferredInput's names, without MicroGamepad", () => {
				expectArrayEqual([...DEVICES], ["KeyboardAndMouse", "Gamepad", "Touch"]);
				for (const device of DEVICES) {
					expectTrue(
						Enum.PreferredInput.GetEnumItems().some((item) => item.Name === device),
						device,
					);
				}
				expectTrue(IsDevice("Gamepad"));
				expectFalse(IsDevice("MicroGamepad"));
				expectFalse(IsDevice("Mouse"));
			});

			test("every key belongs to one device, by the key alone", () => {
				for (const key of [K.ButtonA, K.ButtonL2, K.DPadUp, K.Thumbstick1, K.Thumbstick2Left]) {
					expectEqual(GetKeyDevice(key), "Gamepad", key.Name);
				}
				// the TV remote's keys are the Gamepad's
				for (const key of [
					K.ButtonCenter,
					K.ButtonBack,
					K.ButtonUp,
					K.ButtonDown,
					K.ButtonLeft,
					K.ButtonRight,
				]) {
					expectEqual(GetKeyDevice(key), "Gamepad", key.Name);
				}
				for (const key of [K.TouchPosition, K.TouchDelta, K.TouchPinch]) {
					expectEqual(GetKeyDevice(key), "Touch", key.Name);
				}
				for (const key of [
					K.E,
					K.Space,
					K.LeftControl,
					K.MouseLeftButton,
					K.MouseWheel,
					K.MouseDelta,
					K.MousePosition,
					K.TrackpadPan,
					K.TrackpadPinch,
				]) {
					expectEqual(GetKeyDevice(key), "KeyboardAndMouse", key.Name);
				}
				// Enum.KeyCode.Touch is TouchPosition's deprecated name: the same item, a touch key
				expectEqual(Enum.KeyCode.Touch, K.TouchPosition);
				expectEqual(GetKeyDevice(Enum.KeyCode.Touch), "Touch");
				expectEqual(GAMEPAD_KEYS.size(), 32);
				expectEqual(TOUCH_KEYS.size(), 3);
				// each key in one list only
				for (const key of GAMEPAD_KEYS)
					expectFalse((TOUCH_KEYS as readonly Enum.KeyCode[]).includes(key));
			});

			test("IsKeyAllowed with a device: the type's rules and the device's keys", () => {
				expectTrue(IsKeyAllowed("Bool", "KeyCode", K.ButtonA, "Gamepad"));
				expectFalse(IsKeyAllowed("Bool", "KeyCode", K.ButtonA, "KeyboardAndMouse"));
				expectTrue(IsKeyAllowed("Bool", "KeyCode", K.MouseLeftButton, "KeyboardAndMouse"));
				expectTrue(IsKeyAllowed("Bool", "KeyCode", K.TouchPosition, "Touch"));
				expectFalse(IsKeyAllowed("Bool", "KeyCode", K.TouchPosition, "KeyboardAndMouse"));
				expectTrue(IsKeyAllowed("Direction1D", "KeyCode", K.TouchPinch, "Touch"));
				expectTrue(IsKeyAllowed("Direction2D", "KeyCode", K.TouchDelta, "Touch"));
				expectFalse(IsKeyAllowed("Direction2D", "KeyCode", K.Thumbstick1, "KeyboardAndMouse"));
				expectTrue(IsKeyAllowed("Direction2D", "Up", K.Thumbstick1Up, "Gamepad"));
				expectFalse(IsKeyAllowed("Direction2D", "Up", K.W, "Gamepad"));
				// modifiers come from the binding's own device
				expectTrue(IsKeyAllowed("Bool", "PrimaryModifier", K.ButtonL1, "Gamepad"));
				expectFalse(IsKeyAllowed("Bool", "PrimaryModifier", K.LeftShift, "Gamepad"));
				expectFalse(IsKeyAllowed("Bool", "PrimaryModifier", K.ButtonL1, "KeyboardAndMouse"));
				// touch has no Button keys: no modifiers and no composite directions
				expectFalse(IsKeyAllowed("Direction3D", "Up", K.TouchPosition, "Touch"));
				expectFalse(IsKeyAllowed("ViewportPosition", "KeyCode", K.MousePosition, "Gamepad"));
				// ButtonStart is the Gamepad's, and reserved
				expectEqual(GetKeyDevice(K.ButtonStart), "Gamepad");
				expectFalse(IsKeyAllowed("Bool", "KeyCode", K.ButtonStart, "Gamepad"));
			});

			test("a key binding must be named after a device; any other binding is Scriptable", () => {
				const message = expectThrows(oneBinding(InputActions.Bool, "Alternate", K.F));
				expectTrue(contains(message, "Play/Jump/Alternate"), message);
				expectTrue(contains(message, "not a device"), message);
				expectTrue(contains(message, "KeyboardAndMouse, Gamepad, Touch"), message);
				// an object binding too, and 0.6's usual names
				expectThrows(oneBinding(InputActions.Bool, "Pad", { KeyCode: K.ButtonA }));
				expectThrows(oneBinding(InputActions.Direction2D, "Mouse", K.MouseDelta));
				// a Scriptable under another name is fine; under a device's, refused
				oneBinding(InputActions.Bool, "Virtual", InputActions.Scriptable)();
				const scriptable = expectThrows(
					oneBinding(InputActions.Bool, "Gamepad", InputActions.Scriptable),
				);
				expectTrue(contains(scriptable, "Play/Jump/Gamepad"), scriptable);
				expectTrue(contains(scriptable, "Scriptable"), scriptable);
				expectEqual(BindingNameProblem("Touch", false), undefined);
				expectEqual(BindingNameProblem("Virtual", true), undefined);
			});

			test("Schema refuses another device's key, naming the device", () => {
				const message = expectThrows(oneBinding(InputActions.Bool, "KeyboardAndMouse", K.ButtonA));
				expectTrue(contains(message, "Play/Jump/KeyboardAndMouse"), message);
				expectTrue(contains(message, "ButtonA is a Gamepad key"), message);
				expectThrows(oneBinding(InputActions.Bool, "Gamepad", K.Space));
				expectThrows(oneBinding(InputActions.Bool, "Touch", K.MouseLeftButton));
				expectThrows(oneBinding(InputActions.Bool, "KeyboardAndMouse", K.TouchPosition));
				// a modifier from another device
				expectThrows(
					oneBinding(InputActions.Bool, "Gamepad", {
						KeyCode: K.ButtonA,
						PrimaryModifier: K.LeftShift,
					}),
				);
				// a composite direction from another device
				expectThrows(oneBinding(InputActions.Direction2D, "KeyboardAndMouse", { Up: K.DPadUp }));
				// what touch has nothing for
				expectThrows(oneBinding(InputActions.Direction3D, "Touch", { Up: K.TouchPosition }));
				expectThrows(oneBinding(InputActions.ViewportPosition, "Gamepad", K.MousePosition));
				// each device's own keys pass
				oneBinding(InputActions.Bool, "Gamepad", {
					KeyCode: K.ButtonA,
					PrimaryModifier: K.ButtonL1,
				})();
				oneBinding(InputActions.Direction1D, "Touch", K.TouchPinch)();
				oneBinding(InputActions.Direction2D, "Touch", K.TouchDelta)();
				oneBinding(InputActions.ViewportPosition, "Touch", K.TouchPosition)();
				oneBinding(InputActions.Direction3D, "Gamepad", { Up: K.DPadUp, Forward: K.ButtonY })();
			});

			test("CheckBindingSpec and DecodeSavedEntry take the device", () => {
				expectEqual(CheckBindingSpec("Bool", K.ButtonA, "Gamepad"), undefined);
				const problem = CheckBindingSpec("Bool", K.ButtonA, "KeyboardAndMouse") ?? "";
				expectTrue(
					contains(problem, "a KeyboardAndMouse binding takes keyboard and mouse keys"),
					problem,
				);
				expectEqual(
					CheckBindingSpec("Bool", K.ButtonA),
					undefined,
					"without a device: any device's",
				);
				const saved = DecodeSavedEntry("Bool", { KeyCode: "F" }, K.None, "Gamepad");
				expectTrue(
					typeIs(saved, "string") && contains(saved, "F is a KeyboardAndMouse key"),
					tostring(saved),
				);
				expectFalse(
					typeIs(DecodeSavedEntry("Bool", { KeyCode: "ButtonX" }, K.None, "Gamepad"), "string"),
				);
				// "None" clears a slot whatever the device
				expectFalse(
					typeIs(DecodeSavedEntry("Bool", { KeyCode: "None" }, K.None, "Touch"), "string"),
				);
			});

			test("SanitizeBindings keeps every device binding, also those the schema leaves out", () => {
				const clean = sanitize({
					// Fly declares only the keyboard: its Gamepad binding exists, unbound
					"Gameplay/Fly/Gamepad": { Forward: "ButtonY", Backward: "ButtonA" },
					// Jump has no Touch binding in the schema
					"Gameplay/Jump/Touch": { KeyCode: "TouchPosition" },
					// another device's key
					"Gameplay/Jump/Gamepad": { KeyCode: "F" },
					"Gameplay/Jump/KeyboardAndMouse": { PrimaryModifier: "ButtonL1" },
					// a 0.6 name and a Scriptable slot
					"Gameplay/Look/Mouse": { Scale: 0.5 },
					"Gameplay/Move/Virtual": { KeyCode: "Thumbstick1" },
				});
				expectArrayEqual(paths(clean), ["Gameplay/Fly/Gamepad", "Gameplay/Jump/Touch"]);
				expectEqual(clean.Bindings["Gameplay/Jump/Touch"].KeyCode, "TouchPosition");
			});
		});
	}
}
