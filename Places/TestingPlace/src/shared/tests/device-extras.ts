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
	BINDING_HANDLE_MEMBERS,
	BINDING_PROPERTY_NAMES,
	IsNamespace,
	RESERVED_EXTRA_NAMES,
} from "@rbxts/input-actions/out/InputActions/BindingRules";
import { ActionSlots } from "@rbxts/input-actions/out/InputActions/Tree";
import { HttpService } from "@rbxts/services";
import { EXTRAS_SCHEMA } from "shared/fixtures/extras";

const K = Enum.KeyCode;

/** A schema the types would reject, to reach the runtime checks */
function untypedSchema(contexts: unknown) {
	return (InputActions.Schema as (contexts: unknown) => unknown)(contexts);
}

/** `Schema` with one action whose bindings are `bindings`, past the types */
function oneAction(
	builder: (bindings: never) => unknown,
	bindings: Record<string, unknown>,
	actionName = "Move",
) {
	const actions: Record<string, unknown> = {};
	actions[actionName] = builder(bindings as never);
	return () => untypedSchema({ Play: { Actions: actions } });
}

function contains(text: string, part: string) {
	return text.find(part, 1, true)[0] !== undefined;
}

/** Throws with a message that holds every part */
function refuses(schema: () => unknown, parts: string[]) {
	const message = expectThrows(schema);
	for (const part of parts) expectTrue(contains(message, part), `"${part}" in: ${message}`);
	return message;
}

function sanitize(bindings: Record<string, unknown>) {
	const json = HttpService.JSONEncode({ Version: 1, Bindings: bindings });
	return HttpService.JSONDecode(InputActions.SanitizeBindings(EXTRAS_SCHEMA, json)) as {
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
 * Extra bindings per device (0.7.0, design spec §3, §4, §7): a device takes a binding or a
 * namespace, `{ Main: <binding>, <Extra>: <binding> }`; Schema checks the namespace's bindings
 * against the device's keys and the extras' names against the reserved ones, the extras' binding
 * names against the action's other bindings, and SanitizeBindings keeps the declared extras' paths
 */
@Provider({ activeIn: ["testing"] })
export class DeviceExtrasSharedTests implements OnStart {
	onStart() {
		defineTests("device-extras", () => {
			test("a device takes a binding or a namespace: an object with Main", () => {
				expectTrue(IsNamespace({ Main: K.Space }));
				expectTrue(IsNamespace({ Main: {}, Alt: K.F }));
				expectFalse(IsNamespace(K.Space));
				expectFalse(IsNamespace({ KeyCode: K.Space }));
				expectFalse(IsNamespace({}));
				expectFalse(IsNamespace(InputActions.Scriptable));
				// every action type and device, Main and extras, `{}` for one with no keys
				untypedSchema({
					Play: {
						Actions: {
							Jump: InputActions.Bool({
								KeyboardAndMouse: { Main: K.Space, Alt: {} },
								Gamepad: { Main: {}, Alt: { KeyCode: K.ButtonX, PrimaryModifier: K.ButtonL1 } },
								Touch: { Main: K.TouchPosition, Second: {} },
							}),
							Throttle: InputActions.Direction1D({
								KeyboardAndMouse: { Main: K.MouseWheel, Keys: { Up: K.PageUp, Down: K.PageDown } },
								Gamepad: { Main: K.ButtonR2, Shoulders: { Up: K.ButtonR1, Down: K.ButtonL1 } },
								Touch: { Main: K.TouchPinch, Alt: {} },
							}),
							Look: InputActions.Direction2D({
								KeyboardAndMouse: { Main: K.MouseDelta, Pan: K.TrackpadPan },
								Gamepad: { Main: K.Thumbstick2, Other: K.Thumbstick1 },
								Touch: { Main: K.TouchDelta, Alt: {} },
							}),
							Fly: InputActions.Direction3D({
								KeyboardAndMouse: { Main: { Up: K.E }, Alt: { Up: K.R, Forward: K.T } },
								Gamepad: { Main: { Up: K.DPadUp }, Alt: {} },
							}),
							Aim: InputActions.ViewportPosition({
								KeyboardAndMouse: { Main: K.MousePosition, Alt: {} },
								Touch: { Main: K.TouchPosition, Alt: K.TouchPosition },
							}),
						},
					},
				});
			});

			test("an action's bindings: a device's Main before its extras, named <Device><Extra>, then the devices left out", () => {
				const move = EXTRAS_SCHEMA.Contexts.Extras.Actions.Move;
				const slots = ActionSlots(move.Bindings as Record<string, unknown>);
				const describe = slots.map(
					(slot) =>
						`${slot.Name}:${slot.Device ?? "-"}:${slot.Extra ?? "-"}:${slot.Spec === undefined ? "none" : "spec"}`,
				);
				const sorted = [...describe];
				sorted.sort();
				expectArrayEqual(sorted, [
					"Gamepad:Gamepad:-:spec",
					"GamepadDPad:Gamepad:DPad:spec",
					"KeyboardAndMouse:KeyboardAndMouse:-:spec",
					"KeyboardAndMouseArrows:KeyboardAndMouse:Arrows:spec",
					"Touch:Touch:-:none",
					"Virtual:-:-:spec",
				]);
				// a device's extras come right after its Main (the handles hang them off it)
				for (let index = 0; index < slots.size(); index++) {
					const slot = slots[index];
					if (slot.Extra === undefined) continue;
					expectEqual(slots[index - 1]?.Device, slot.Device, `${slot.Name} after ${slot.Device}`);
				}
				// Main is the namespace's binding, not the namespace
				const keys = slots.find((slot) => slot.Name === "KeyboardAndMouse")!;
				expectEqual((keys.Spec as { Up?: Enum.KeyCode }).Up, K.W);
				expectEqual(slots.find((slot) => slot.Name === "Touch")!.Spec, undefined);
			});

			test("a namespace's bindings take the device's keys, the path naming Main or the extra", () => {
				refuses(
					oneAction(InputActions.Bool, { KeyboardAndMouse: { Main: K.Space, Alt: K.ButtonA } }),
					["Play/Move/KeyboardAndMouse/Alt", "ButtonA is a Gamepad key"],
				);
				refuses(
					oneAction(InputActions.Bool, { Gamepad: { Main: K.Space, Alt: K.ButtonB } }),
					["Play/Move/Gamepad/Main", "Space is a KeyboardAndMouse key"],
				);
				refuses(
					oneAction(InputActions.Direction2D, {
						Gamepad: { Main: K.Thumbstick1, DPad: { Up: K.W } },
					}),
					["Play/Move/Gamepad/DPad", "W is a KeyboardAndMouse key"],
				);
				refuses(
					oneAction(InputActions.Bool, {
						Gamepad: { Main: K.ButtonA, Alt: { KeyCode: K.ButtonB, PrimaryModifier: K.LeftShift } },
					}),
					["Play/Move/Gamepad/Alt", "LeftShift"],
				);
				refuses(oneAction(InputActions.Bool, { Touch: { Main: K.TouchPosition, Alt: K.E } }), [
					"Play/Move/Touch/Alt",
				]);
				// the action type's rules hold in an extra
				refuses(oneAction(InputActions.Bool, { Gamepad: { Main: K.ButtonA, Alt: K.Thumbstick1 } }), [
					"Play/Move/Gamepad/Alt",
					"Thumbstick1 is not allowed in KeyCode on a Bool action",
				]);
				refuses(
					oneAction(InputActions.Bool, { KeyboardAndMouse: { Main: K.E, Alt: { KeyCode: K.F, Scale: 2 } } }),
					["Play/Move/KeyboardAndMouse/Alt", "Scale is not a property of a Bool binding"],
				);
				refuses(
					oneAction(InputActions.Direction2D, {
						KeyboardAndMouse: { Main: { Up: K.W, KeyCode: K.MouseDelta }, Alt: {} },
					}),
					["Play/Move/KeyboardAndMouse/Main", "can't share a binding"],
				);
			});

			test("no binding of a namespace is InputActions.Scriptable: those keep names of their own", () => {
				refuses(
					oneAction(InputActions.Bool, {
						KeyboardAndMouse: { Main: K.E, Virtual: InputActions.Scriptable },
					}),
					["Play/Move/KeyboardAndMouse/Virtual", "not InputActions.Scriptable"],
				);
				refuses(
					oneAction(InputActions.Bool, {
						KeyboardAndMouse: { Main: InputActions.Scriptable, Alt: K.E },
					}),
					["Play/Move/KeyboardAndMouse/Main", "not InputActions.Scriptable"],
				);
			});

			test("an extra can't take a reserved name: Main's, a binding handle's member, a binding property", () => {
				// the list: Main, every member of the handle the extras hang off, every binding property
				for (const name of ["Instance", "Name", "Get", "Set", "Reset", "Clear", "Capture", "CaptureChord", "Extras"])
					expectTrue((BINDING_HANDLE_MEMBERS as readonly string[]).includes(name), name);
				for (const name of ["KeyCode", "Up", "Forward", "PrimaryModifier", "Scale", "ResponseCurve", "PressedThreshold", "ClampMagnitudeToOne", "DisplayName", "DisplayImage", "EnumType"])
					expectTrue((BINDING_PROPERTY_NAMES as readonly string[]).includes(name), name);
				expectEqual(RESERVED_EXTRA_NAMES[0], "Main");
				expectEqual(
					RESERVED_EXTRA_NAMES.size(),
					1 + BINDING_HANDLE_MEMBERS.size() + BINDING_PROPERTY_NAMES.size(),
				);
				for (const name of RESERVED_EXTRA_NAMES) {
					if (name === "Main") continue;
					const extras: Record<string, unknown> = { Main: K.E };
					extras[name] = K.F;
					const message = refuses(
						oneAction(InputActions.Bool, { KeyboardAndMouse: extras }),
						[`Play/Move/KeyboardAndMouse/${name}`, `"${name}"`],
					);
					const member = (BINDING_HANDLE_MEMBERS as readonly string[]).includes(name);
					expectTrue(
						contains(message, member ? "is a member of a binding handle" : "is a binding property"),
						message,
					);
				}
				// a "/" would split the save's path; a name has a character at least, and is a string
				refuses(oneAction(InputActions.Bool, { Gamepad: { Main: K.ButtonA, "Alt/2": K.ButtonB } }), [
					"Play/Move/Gamepad/Alt/2",
					`can't contain "/"`,
				]);
				refuses(oneAction(InputActions.Bool, { Gamepad: { Main: K.ButtonA, "": K.ButtonB } }), [
					"Play/Move/Gamepad/",
					"at least one character",
				]);
				const numbered = new Map<unknown, unknown>([
					["Main", K.ButtonA],
					[1, K.ButtonB],
				]);
				refuses(oneAction(InputActions.Bool, { Gamepad: numbered }), ["must be a string"]);
				// names of your own, a device's or a Scriptable slot's too
				oneAction(InputActions.Bool, {
					KeyboardAndMouse: { Main: K.E, Alt: K.F, Gamepad: K.G, Virtual: K.H, main: K.J },
					Virtual: InputActions.Scriptable,
				})();
			});

			test("an object without Main with names no binding has: the message points to the namespace", () => {
				refuses(
					oneAction(InputActions.Direction2D, { KeyboardAndMouse: { Up: K.W, Arrows: { Up: K.Up } } }),
					[
						"Play/Move/KeyboardAndMouse",
						"Arrows is not a property of a Direction2D binding",
						"{ Main: <binding>, Arrows: <binding> }",
					],
				);
				// a property of another action type: no hint
				const message = refuses(
					oneAction(InputActions.Bool, { KeyboardAndMouse: { KeyCode: K.E, Scale: 2 } }),
					["Scale is not a property of a Bool binding"],
				);
				expectFalse(contains(message, "Main"), message);
			});

			test("an extra's binding name against the action's others: a Scriptable slot of that name, S and <Action>S, the package's names", () => {
				// a Scriptable slot named as the extra's binding is found
				refuses(
					oneAction(InputActions.Direction2D, {
						KeyboardAndMouse: { Main: K.MouseDelta, Arrows: { Up: K.Up } },
						KeyboardAndMouseArrows: InputActions.Scriptable,
					}),
					[
						"Play/Move",
						'the KeyboardAndMouse extra "Arrows"',
						'"KeyboardAndMouseArrows"',
						"would both be the binding MoveKeyboardAndMouseArrows",
					],
				);
				// S and <Action>S: the extra is found as MoveGamepadAlt too
				refuses(
					oneAction(InputActions.Bool, {
						Gamepad: { Main: K.ButtonA, Alt: K.ButtonB },
						MoveGamepadAlt: InputActions.Scriptable,
					}),
					['the Gamepad extra "Alt"', '"MoveGamepadAlt"', "would both match the binding MoveGamepadAlt"],
				);
				// an extra that would be found as the action's Fire binding (<Action>Script)
				refuses(
					oneAction(InputActions.Bool, { Gamepad: { Main: K.ButtonA, Script: K.ButtonB } }, "Gamepad"),
					["Play/Gamepad/Gamepad/Script", "would be found as the binding GamepadScript", "reserved"],
				);
				// on two actions the names are fine
				untypedSchema({
					Play: {
						Actions: {
							Move: InputActions.Bool({ Gamepad: { Main: K.ButtonA, Alt: K.ButtonB } }),
							Jump: InputActions.Bool({ MoveGamepadAlt: InputActions.Scriptable, GamepadAlt2: InputActions.Scriptable }),
						},
					},
				});
			});

			test("SanitizeBindings keeps the extras the schema declares, at Context/Action/Device/Extra", () => {
				const clean = sanitize({
					// declared extras, and the main bindings beside them
					"Extras/Move/KeyboardAndMouse/Arrows": { Up: "I", Down: "K" },
					"Extras/Move/Gamepad/DPad": { Up: "ButtonY" },
					"Extras/Jump/KeyboardAndMouse/Alt": { KeyCode: "F" },
					"Extras/Jump/Touch/Second": { KeyCode: "TouchPosition" },
					"Extras/Move/KeyboardAndMouse": { Up: "Eight" },
					"Extras/Throttle/KeyboardAndMouse": { Up: "PageUp", Down: "PageDown" },
					// an extra the schema doesn't declare, on a device with a namespace and without one
					"Extras/Move/KeyboardAndMouse/Numpad": { Up: "KeypadEight" },
					"Extras/Dash/KeyboardAndMouse/Alt": { KeyCode: "F" },
					"Extras/Move/Touch/Alt": { KeyCode: "TouchDelta" },
					// Main is the device's own path
					"Extras/Move/KeyboardAndMouse/Main": { Up: "Nine" },
					// another device's key in an extra
					"Extras/Jump/Gamepad/Alt": { KeyCode: "G" },
					// a Scriptable slot, a path too long
					"Extras/Move/Virtual/Alt": { Up: "U" },
					"Extras/Jump/KeyboardAndMouse/Alt/More": { KeyCode: "F" },
				});
				expectArrayEqual(paths(clean), [
					"Extras/Jump/KeyboardAndMouse/Alt",
					"Extras/Jump/Touch/Second",
					"Extras/Move/Gamepad/DPad",
					"Extras/Move/KeyboardAndMouse",
					"Extras/Move/KeyboardAndMouse/Arrows",
					"Extras/Throttle/KeyboardAndMouse",
				]);
				expectEqual(clean.Bindings["Extras/Move/KeyboardAndMouse/Arrows"].Down, "K");
				expectEqual(clean.Bindings["Extras/Jump/KeyboardAndMouse/Alt"].KeyCode, "F");
			});
		});
	}
}
