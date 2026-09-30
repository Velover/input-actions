import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { DecodeSavedEntry } from "@rbxts/input-actions/out/InputActions/BindingRules";
import { HttpService } from "@rbxts/services";
import { createTestInput, frame, nearlyEqual, recordSignal } from "./helpers";

interface ISave {
	Version: number;
	Bindings: Record<string, Record<string, unknown>>;
}

function decode(json: string) {
	return HttpService.JSONDecode(json) as ISave;
}

function encode(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

function paths(save: ISave) {
	const list = new Array<string>();
	for (const [path] of pairs(save.Bindings)) list.push(path as string);
	list.sort();
	return list;
}

function reasonFor(result: { Skipped: { Path: string; Reason: string }[] }, path: string) {
	return result.Skipped.find((skipped) => skipped.Path === path)?.Reason;
}

/** Saving keybinds as JSON: export, import and every skip reason (design spec §7) */
@Provider({ activeIn: ["testing"] })
export class SaveTests implements OnStart {
	onStart() {
		defineTests("saves", () => {
			test("nothing to export at the defaults", () => {
				const save = decode(createTestInput().ExportBindings());
				expectEqual(save.Version, 1);
				expectArrayEqual(paths(save), []);
			});

			test("exports only what differs: enums by name, vectors as arrays", () => {
				const input = createTestInput();
				const actions = input.Gameplay.Actions;
				actions.Jump.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.F);
				actions.Move.Bindings.KeyboardAndMouse.Set({
					Up: Enum.KeyCode.Up,
					Down: Enum.KeyCode.Down,
				});
				actions.Look.Bindings.Mouse.Set({
					KeyCode: Enum.KeyCode.MouseDelta,
					Scale: 0.5,
					Vector2Scale: new Vector2(2, -2),
				});
				actions.QuickSave.Bindings.KeyboardAndMouse.Set({
					KeyCode: Enum.KeyCode.S,
					PrimaryModifier: Enum.KeyCode.LeftAlt,
				});
				actions.Fire.Bindings.Gamepad.Set({
					KeyCode: Enum.KeyCode.ButtonR2,
					PressedThreshold: 0.9,
				});
				// DisplayName is not a saved property
				actions.Jump.Bindings.Gamepad.Set({ KeyCode: Enum.KeyCode.ButtonA, DisplayName: "JUMP" });

				const save = decode(input.ExportBindings());
				expectArrayEqual(paths(save), [
					"Gameplay/Fire/Gamepad",
					"Gameplay/Jump/KeyboardAndMouse",
					"Gameplay/Look/Mouse",
					"Gameplay/Move/KeyboardAndMouse",
					"Gameplay/QuickSave/KeyboardAndMouse",
				]);
				const jump = save.Bindings["Gameplay/Jump/KeyboardAndMouse"];
				expectEqual(jump.KeyCode, "F");
				const move = save.Bindings["Gameplay/Move/KeyboardAndMouse"];
				expectEqual(move.Up, "Up");
				expectEqual(move.Down, "Down");
				expectEqual(move.Left, undefined);
				const look = save.Bindings["Gameplay/Look/Mouse"];
				expectEqual(look.KeyCode, undefined);
				expectEqual(look.Scale, 0.5);
				expectArrayEqual(look.Vector2Scale as number[], [2, -2]);
				expectEqual(
					save.Bindings["Gameplay/QuickSave/KeyboardAndMouse"].PrimaryModifier,
					"LeftAlt",
				);
				expectEqual(save.Bindings["Gameplay/Fire/Gamepad"].PressedThreshold, 0.9);
			});

			test("a cleared binding saves its keys as None", () => {
				const input = createTestInput();
				input.Gameplay.Actions.Jump.Bindings.Gamepad.Clear();
				input.Gameplay.Actions.Move.Bindings.KeyboardAndMouse.Clear();
				const save = decode(input.ExportBindings());
				expectEqual(save.Bindings["Gameplay/Jump/Gamepad"].KeyCode, "None");
				const move = save.Bindings["Gameplay/Move/KeyboardAndMouse"];
				expectEqual(move.Up, "None");
				expectEqual(move.Right, "None");
				expectEqual(move.KeyCode, undefined);
			});

			test("export and import round trip", () => {
				const input = createTestInput();
				const actions = input.Gameplay.Actions;
				actions.Jump.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.F);
				actions.Move.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.MouseDelta);
				actions.Look.Bindings.Mouse.Set({
					KeyCode: Enum.KeyCode.MouseDelta,
					Scale: 0.25,
					Vector2Scale: new Vector2(1, 1),
				});
				actions.Zoom.Bindings.Gamepad.Clear();
				actions.Fly.Bindings.Keyboard.Set({
					Forward: Enum.KeyCode.Up,
					Vector3Scale: new Vector3(1, 2, 3),
				});
				input.Ui.Actions.Accept.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.Space);
				const json = input.ExportBindings();

				input.ResetBindings();
				expectEqual(actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode, Enum.KeyCode.Space);
				const result = input.ImportBindings(json);
				expectArrayEqual(result.Skipped, []);
				expectEqual(result.Applied.size(), 6);
				expectEqual(actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode, Enum.KeyCode.F);
				const move = actions.Move.Bindings.KeyboardAndMouse.Instance;
				expectEqual(move.KeyCode, Enum.KeyCode.MouseDelta);
				expectEqual(move.Up, Enum.KeyCode.None);
				expectTrue(nearlyEqual(actions.Look.Bindings.Mouse.Instance.Scale, 0.25));
				expectEqual(actions.Look.Bindings.Mouse.Instance.Vector2Scale, new Vector2(1, 1));
				expectEqual(actions.Zoom.Bindings.Gamepad.Instance.Up, Enum.KeyCode.None);
				expectEqual(actions.Fly.Bindings.Keyboard.Instance.Forward, Enum.KeyCode.Up);
				expectEqual(actions.Fly.Bindings.Keyboard.Instance.Vector3Scale, new Vector3(1, 2, 3));
				expectEqual(
					input.Ui.Actions.Accept.Bindings.KeyboardAndMouse.Instance.KeyCode,
					Enum.KeyCode.Space,
				);
				expectEqual(decode(input.ExportBindings()).Bindings["Gameplay/Look/Mouse"].Scale, 0.25);
				expectArrayEqual(paths(decode(input.ExportBindings())), paths(decode(json)));
			});

			test("import starts from the defaults", () => {
				const input = createTestInput();
				const actions = input.Gameplay.Actions;
				actions.Jump.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.F);
				const result = input.ImportBindings(
					encode({ "Gameplay/Move/KeyboardAndMouse": { Up: "Up" } }),
				);
				expectArrayEqual(result.Applied, ["Gameplay/Move/KeyboardAndMouse"]);
				expectEqual(actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode, Enum.KeyCode.Space);
				expectEqual(actions.Move.Bindings.KeyboardAndMouse.Instance.Up, Enum.KeyCode.Up);
				expectEqual(actions.Move.Bindings.KeyboardAndMouse.Instance.Down, Enum.KeyCode.S);
			});

			test("bad JSON, a non-object or an unknown Version applies nothing", () => {
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				for (const json of [
					"{ nope",
					"[]",
					"42",
					'{"Version":2,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"F"}}}',
					'{"Version":1}',
				]) {
					jump.Set(Enum.KeyCode.G);
					const result = input.ImportBindings(json);
					expectArrayEqual(result.Applied, [], json);
					expectEqual(result.Skipped.size(), 1, json);
					expectEqual(jump.Instance.KeyCode, Enum.KeyCode.Space, json);
				}
			});

			test("a save nested deeper than a save can be applies nothing, and is never decoded", () => {
				// HttpService:JSONDecode ends the whole process on a few hundred levels, pcall or not
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				jump.Set(Enum.KeyCode.G);
				const json =
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"F"}},"Deep":' +
					`${string.rep("[", 1000)}${string.rep("]", 1000)}}`;
				const result = input.ImportBindings(json);
				expectArrayEqual(result.Applied, []);
				expectEqual(result.Skipped.size(), 1);
				const reason = result.Skipped[0].Reason;
				expectTrue(reason.find("nests deeper", 1, true)[0] !== undefined, reason);
				expectEqual(jump.Instance.KeyCode, Enum.KeyCode.Space, "back to the default");
				// as deep as a save goes (the save, Bindings, an entry, a vector) still applies
				const look = input.ImportBindings(
					'{"Version":1,"Bindings":{"Gameplay/Look/Mouse":{"Vector2Scale":[2,-2]}}}',
				);
				expectArrayEqual(look.Applied, ["Gameplay/Look/Mouse"]);
			});

			test("every invalid entry is skipped with its reason and stays default", () => {
				const input = createTestInput();
				const actions = input.Gameplay.Actions;
				const result = input.ImportBindings(
					encode({
						"Gameplay/Jump/KeyboardAndMouse": { KeyCode: "F" },
						"Gameplay/Nope/KeyboardAndMouse": { KeyCode: "F" },
						"Gameplay/Move/Virtual": { KeyCode: "Thumbstick1" },
						"Gameplay/Jump/Gamepad": { Foo: 1 },
						"Gameplay/Fire/Mouse": { KeyCode: "Nope" },
						"Gameplay/Fire/Gamepad": { KeyCode: "MouseDelta" },
						"Gameplay/QuickSave/KeyboardAndMouse": { KeyCode: "Escape" },
						"Gameplay/Look/Mouse": { Scale: "big" },
						"Gameplay/Look/Gamepad": { Vector2Scale: [1] },
						"Gameplay/Zoom/Gamepad": { Left: "A" },
						"Gameplay/Crouch/KeyboardAndMouse": "C",
						"Gameplay/Move/Gamepad": { KeyCode: "Thumbstick2", Up: "W" },
						"Gameplay/Steer/Gamepad": { KeyCode: "Unknown" },
					}),
				);
				expectArrayEqual(result.Applied, [
					"Gameplay/Jump/KeyboardAndMouse",
					"Gameplay/Steer/Gamepad",
				]);
				expectEqual(actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode, Enum.KeyCode.F);
				// "Unknown" resolves to None: a cleared binding
				expectEqual(actions.Steer.Bindings.Gamepad.Instance.KeyCode, Enum.KeyCode.None);

				expectEqual(reasonFor(result, "Gameplay/Nope/KeyboardAndMouse"), "unknown path");
				expectEqual(reasonFor(result, "Gameplay/Move/Virtual"), "unknown path");
				expectEqual(reasonFor(result, "Gameplay/Jump/Gamepad"), "unknown property Foo");
				expectEqual(reasonFor(result, "Gameplay/Fire/Mouse"), "unknown key name Nope");
				expectEqual(
					reasonFor(result, "Gameplay/Fire/Gamepad"),
					"MouseDelta is not allowed in KeyCode",
				);
				expectEqual(
					reasonFor(result, "Gameplay/QuickSave/KeyboardAndMouse"),
					"Escape is not allowed in KeyCode",
				);
				expectEqual(reasonFor(result, "Gameplay/Look/Mouse"), "Scale is not a finite number");
				expectEqual(
					reasonFor(result, "Gameplay/Look/Gamepad"),
					"Vector2Scale must be 2 finite numbers",
				);
				expectEqual(reasonFor(result, "Gameplay/Zoom/Gamepad"), "unknown property Left");
				expectEqual(
					reasonFor(result, "Gameplay/Crouch/KeyboardAndMouse"),
					"the entry is not an object",
				);
				expectEqual(
					reasonFor(result, "Gameplay/Move/Gamepad"),
					"KeyCode and composite directions can't share a binding",
				);
				expectEqual(result.Skipped.size(), 11);

				expectEqual(actions.Jump.Bindings.Gamepad.Instance.KeyCode, Enum.KeyCode.ButtonA);
				expectEqual(actions.Fire.Bindings.Gamepad.Instance.KeyCode, Enum.KeyCode.ButtonR2);
				expectEqual(actions.QuickSave.Bindings.KeyboardAndMouse.Instance.KeyCode, Enum.KeyCode.S);
				expectTrue(nearlyEqual(actions.Look.Bindings.Mouse.Instance.Scale, 0.02));
				expectEqual(actions.Move.Bindings.Gamepad.Instance.KeyCode, Enum.KeyCode.Thumbstick1);
			});

			test("a number that is not finite is skipped", () => {
				// Roblox's JSON has no way to write one: such a save does not decode at all
				const input = createTestInput();
				const result = input.ImportBindings(
					'{"Version":1,"Bindings":{"Gameplay/Look/Mouse":{"Scale":1e999}}}',
				);
				expectArrayEqual(result.Applied, []);
				expectTrue(nearlyEqual(input.Gameplay.Actions.Look.Bindings.Mouse.Instance.Scale, 0.02));
				// the entry check itself
				expectEqual(
					DecodeSavedEntry("Direction2D", { Scale: math.huge }),
					"Scale is not a finite number",
				);
				expectEqual(
					DecodeSavedEntry("Direction2D", { Scale: 0 / 0 }),
					"Scale is not a finite number",
				);
				expectEqual(
					DecodeSavedEntry("Bool", { PressedThreshold: -math.huge }),
					"PressedThreshold is not a finite number",
				);
				expectEqual(
					DecodeSavedEntry("Direction2D", { Vector2Scale: [math.huge, 1] }),
					"Vector2Scale must be 2 finite numbers",
				);
			});

			test("a number a float can't hold is skipped; the largest float round-trips", () => {
				expectEqual(DecodeSavedEntry("Direction2D", { Scale: 1e39 }), "Scale is not a finite number");
				expectEqual(
					DecodeSavedEntry("Direction2D", { Vector2Scale: [1, -1e39] }),
					"Vector2Scale must be 2 finite numbers",
				);
				expectEqual(
					DecodeSavedEntry("Bool", { ReleasedThreshold: -1e39 }),
					"ReleasedThreshold is not a finite number",
				);
				const input = createTestInput();
				const result = input.ImportBindings(encode({ "Gameplay/Zoom/Mouse": { Scale: 3.4e38 } }));
				expectArrayEqual(result.Applied, ["Gameplay/Zoom/Mouse"]);
				const again = input.ImportBindings(input.ExportBindings());
				expectEqual(again.Skipped.size(), 0, input.ExportBindings());
				expectArrayEqual(again.Applied, ["Gameplay/Zoom/Mouse"]);
				// Set refuses it too
				const zoom = input.Gameplay.Actions.Zoom.Bindings.Mouse;
				const [ok] = pcall(() => zoom.Set({ KeyCode: Enum.KeyCode.MouseWheel, Scale: 1e39 }));
				expectEqual(ok, false, "Set with a Scale of 1e39");
			});

			test("a value written straight to the instance that no import could write back is not exported", () => {
				const input = createTestInput();
				const zoom = input.Gameplay.Actions.Zoom.Bindings.Mouse;
				zoom.Instance.Scale = math.huge;
				const save = decode(input.ExportBindings());
				expectEqual(save.Bindings["Gameplay/Zoom/Mouse"], undefined, input.ExportBindings());
				expectEqual(input.ImportBindings(input.ExportBindings()).Skipped.size(), 0);
			});

			test("ResponseCurve is saved and imported only with a thumbstick KeyCode", () => {
				const input = createTestInput();
				const actions = input.Gameplay.Actions;
				// the default KeyCode is a thumbstick: an entry with the curve alone applies
				let result = input.ImportBindings(encode({ "Gameplay/Move/Gamepad": { ResponseCurve: 3 } }));
				expectArrayEqual(result.Applied, ["Gameplay/Move/Gamepad"]);
				expectTrue(nearlyEqual(actions.Move.Bindings.Gamepad.Instance.ResponseCurve, 3));
				// a composite clears the KeyCode, so the curve would act on nothing
				result = input.ImportBindings(
					encode({ "Gameplay/Move/Gamepad": { Up: "W", ResponseCurve: 3 } }),
				);
				expectArrayEqual(result.Applied, []);
				const reason = reasonFor(result, "Gameplay/Move/Gamepad") ?? "";
				expectTrue(reason.find("ResponseCurve", 1, true)[0] !== undefined, reason);
				// the entry's own thumbstick KeyCode makes the curve legal on a mouse binding
				result = input.ImportBindings(
					encode({ "Gameplay/Look/Mouse": { KeyCode: "Thumbstick2", ResponseCurve: 3 } }),
				);
				expectArrayEqual(result.Applied, ["Gameplay/Look/Mouse"]);

				// a curve left behind beside a mouse key does nothing, and isn't saved
				const look = actions.Look.Bindings.Mouse;
				look.Set(Enum.KeyCode.MouseDelta);
				expectTrue(nearlyEqual(look.Instance.ResponseCurve, 3));
				const json = input.ExportBindings();
				expectEqual(decode(json).Bindings["Gameplay/Look/Mouse"], undefined);
				expectArrayEqual(input.ImportBindings(json).Skipped, []);
			});

			test("context handles export, import and reset their own bindings", () => {
				const input = createTestInput();
				input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.F);
				input.Ui.Actions.Accept.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.Space);
				expectArrayEqual(paths(decode(input.Gameplay.ExportBindings())), [
					"Gameplay/Jump/KeyboardAndMouse",
				]);
				expectArrayEqual(paths(decode(input.Ui.ExportBindings())), ["Ui/Accept/KeyboardAndMouse"]);

				const everything = input.ExportBindings();
				input.Gameplay.ResetBindings();
				expectEqual(
					input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode,
					Enum.KeyCode.Space,
				);
				expectEqual(
					input.Ui.Actions.Accept.Bindings.KeyboardAndMouse.Instance.KeyCode,
					Enum.KeyCode.Space,
				);

				const result = input.Gameplay.ImportBindings(everything);
				expectArrayEqual(result.Applied, ["Gameplay/Jump/KeyboardAndMouse"]);
				expectEqual(reasonFor(result, "Ui/Accept/KeyboardAndMouse"), "not a binding of Gameplay");
				expectEqual(
					input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode,
					Enum.KeyCode.F,
				);
				// Ui was not touched by the Gameplay import
				expectEqual(
					input.Ui.Actions.Accept.Bindings.KeyboardAndMouse.Instance.KeyCode,
					Enum.KeyCode.Space,
				);
			});

			test("BindingsChanged fires for the bindings an import or reset changed", () => {
				const input = createTestInput();
				input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.F);
				frame();
				const changed = recordSignal(input.BindingsChanged);
				input.ImportBindings(encode({ "Gameplay/Move/Gamepad": { KeyCode: "Thumbstick2" } }));
				eventually(() => changed.size() === 2, "two changes");
				const sorted = [...changed];
				sorted.sort();
				expectArrayEqual(sorted, ["Gameplay/Jump/KeyboardAndMouse", "Gameplay/Move/Gamepad"]);
				input.ResetBindings();
				eventually(() => changed.size() === 3, "the reset");
				expectEqual(changed[2], "Gameplay/Move/Gamepad");
			});
		});
	}
}
