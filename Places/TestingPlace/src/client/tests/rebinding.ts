import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectFalse,
	expectNoThrow,
	expectThrows,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import {
	DecideCapture,
	ECaptureDecision,
	KeyFromInput,
} from "@rbxts/input-actions/out/InputActions/Handles/BindingHandle";
import { createTestInput, frame, nearlyEqual, newFolder, recordSignal } from "./helpers";

function sortedKeys(record: object) {
	const keys = new Array<string>();
	for (const [key] of pairs(record as Record<string, unknown>)) keys.push(key as string);
	keys.sort();
	return keys;
}

/** Calls Set past the types, to reach the runtime checks */
function untypedSet(handle: object, spec: unknown) {
	(handle as { Set(spec: unknown): void }).Set(spec);
}

/** Rebinding: Get, Set, Reset, Clear, Capture, BindingsChanged (design spec §6) */
@Provider({ activeIn: ["testing"] })
export class RebindingTests implements OnStart {
	onStart() {
		defineTests("rebinding", () => {
			test("Set with a bare key sets KeyCode", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				jump.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.F);
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, Enum.KeyCode.F);
			});

			test("Set with an object merges into the binding", () => {
				const input = createTestInput();
				const look = input.Gameplay.Actions.Look.Bindings.Mouse;
				look.Set({ KeyCode: Enum.KeyCode.TrackpadPan, Scale: 0.5 });
				expectEqual(look.Instance.KeyCode, Enum.KeyCode.TrackpadPan);
				expectEqual(look.Instance.Scale, 0.5);
				expectEqual(look.Instance.Vector2Scale, new Vector2(1, -1));

				const save = input.Gameplay.Actions.QuickSave.Bindings.KeyboardAndMouse;
				save.Set({ KeyCode: Enum.KeyCode.X });
				expectEqual(save.Instance.KeyCode, Enum.KeyCode.X);
				expectEqual(save.Instance.PrimaryModifier, Enum.KeyCode.LeftControl);
			});

			test("composite directions merge; they clear the KeyCode", () => {
				const move = createTestInput().Gameplay.Actions.Move;
				const keys = move.Bindings.KeyboardAndMouse;
				keys.Set({ Up: Enum.KeyCode.Up, Down: Enum.KeyCode.Down });
				expectEqual(keys.Instance.Up, Enum.KeyCode.Up);
				expectEqual(keys.Instance.Down, Enum.KeyCode.Down);
				expectEqual(keys.Instance.Left, Enum.KeyCode.A);
				expectEqual(keys.Instance.Right, Enum.KeyCode.D);

				const pad = move.Bindings.Gamepad;
				pad.Set({ Up: Enum.KeyCode.DPadUp });
				expectEqual(pad.Instance.KeyCode, Enum.KeyCode.None);
				expectEqual(pad.Instance.Up, Enum.KeyCode.DPadUp);
			});

			test("a bare key clears the composite directions", () => {
				const zoom = createTestInput().Gameplay.Actions.Zoom.Bindings.Gamepad;
				zoom.Set(Enum.KeyCode.ButtonR2);
				expectEqual(zoom.Instance.KeyCode, Enum.KeyCode.ButtonR2);
				expectEqual(zoom.Instance.Up, Enum.KeyCode.None);
				expectEqual(zoom.Instance.Down, Enum.KeyCode.None);
			});

			test("Set checks at runtime what the types check, and changes nothing when it throws", () => {
				const actions = createTestInput().Gameplay.Actions;
				const jump = actions.Jump.Bindings.KeyboardAndMouse;
				const message = expectThrows(() => untypedSet(jump, Enum.KeyCode.MouseDelta));
				expectTrue(
					message.find("Gameplay/Jump/KeyboardAndMouse", 1, true)[0] !== undefined,
					message,
				);
				expectThrows(() => untypedSet(jump, Enum.KeyCode.Escape));
				expectThrows(() => untypedSet(jump, { KeyCode: Enum.KeyCode.E, Scale: 2 }));
				expectThrows(() => untypedSet(jump, "E"));
				expectThrows(() =>
					untypedSet(actions.Look.Bindings.Mouse, {
						KeyCode: Enum.KeyCode.MouseDelta,
						ResponseCurve: 2,
					}),
				);
				expectThrows(() =>
					untypedSet(actions.Move.Bindings.KeyboardAndMouse, {
						KeyCode: Enum.KeyCode.Thumbstick1,
						Up: Enum.KeyCode.W,
					}),
				);
				expectThrows(() => untypedSet(actions.Fly.Bindings.Keyboard, Enum.KeyCode.Thumbstick1));
				expectEqual(jump.Instance.KeyCode, Enum.KeyCode.Space);
			});

			test("Reset returns to the binding right after Create", () => {
				const actions = createTestInput().Gameplay.Actions;
				const jump = actions.Jump.Bindings.KeyboardAndMouse;
				jump.Set(Enum.KeyCode.F);
				jump.Reset();
				expectEqual(jump.Instance.KeyCode, Enum.KeyCode.Space);

				const look = actions.Look.Bindings.Mouse;
				look.Set({
					KeyCode: Enum.KeyCode.MouseDelta,
					Scale: 3,
					Vector2Scale: new Vector2(2, 2),
					DisplayName: "Look",
				});
				look.Reset();
				expectTrue(nearlyEqual(look.Instance.Scale, 0.02));
				expectEqual(look.Instance.Vector2Scale, new Vector2(1, -1));
				expectEqual(look.Instance.DisplayName, "");
			});

			test("Reset returns an adopted binding to the designer's value", () => {
				const folder = newFolder();
				const context = new Instance("InputContext");
				context.Name = "Gameplay";
				const jump = new Instance("InputAction");
				jump.Name = "Jump";
				jump.Parent = context;
				const keys = new Instance("InputBinding");
				keys.Name = "JumpKeyboardAndMouse";
				keys.KeyCode = Enum.KeyCode.F;
				keys.PrimaryModifier = Enum.KeyCode.LeftShift;
				keys.Parent = jump;
				context.Parent = folder;

				const binding = createTestInput(folder).Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				binding.Set({ KeyCode: Enum.KeyCode.G, PrimaryModifier: Enum.KeyCode.LeftAlt });
				binding.Reset();
				expectEqual(keys.KeyCode, Enum.KeyCode.F);
				expectEqual(keys.PrimaryModifier, Enum.KeyCode.LeftShift);
			});

			test("Clear unbinds: KeyCode and composites become None", () => {
				const move = createTestInput().Gameplay.Actions.Move;
				move.Bindings.KeyboardAndMouse.Clear();
				move.Bindings.Gamepad.Clear();
				for (const binding of [
					move.Bindings.KeyboardAndMouse.Instance,
					move.Bindings.Gamepad.Instance,
				]) {
					expectEqual(binding.KeyCode, Enum.KeyCode.None);
					expectEqual(binding.Up, Enum.KeyCode.None);
					expectEqual(binding.Down, Enum.KeyCode.None);
					expectEqual(binding.Left, Enum.KeyCode.None);
					expectEqual(binding.Right, Enum.KeyCode.None);
				}
				expectArrayEqual(sortedKeys(move.Bindings.KeyboardAndMouse.Get()), []);
			});

			test("Get returns the binding as plain data in the schema's shape", () => {
				const actions = createTestInput().Gameplay.Actions;
				const jump = actions.Jump.Bindings.KeyboardAndMouse.Get();
				expectArrayEqual(sortedKeys(jump), ["KeyCode"]);
				expectEqual(jump.KeyCode, Enum.KeyCode.Space);

				const fire = actions.Fire.Bindings.Gamepad.Get();
				expectEqual(fire.KeyCode, Enum.KeyCode.ButtonR2);
				expectEqual(fire.PressedThreshold, 0.6);

				const move = actions.Move.Bindings.KeyboardAndMouse.Get();
				expectArrayEqual(sortedKeys(move), ["Down", "Left", "Right", "Up"]);
				expectEqual(move.Up, Enum.KeyCode.W);

				const stick = actions.Move.Bindings.Gamepad.Get();
				expectArrayEqual(sortedKeys(stick), ["KeyCode", "ResponseCurve"]);
				expectEqual(stick.ResponseCurve, 2);

				const look = actions.Look.Bindings.Mouse.Get();
				expectArrayEqual(sortedKeys(look), ["KeyCode", "Scale", "Vector2Scale"]);
				expectEqual(look.Scale, 0.02);
				expectEqual(look.Vector2Scale, new Vector2(1, -1));

				const save = actions.QuickSave.Bindings.KeyboardAndMouse.Get();
				expectEqual(save.PrimaryModifier, Enum.KeyCode.LeftControl);

				// what Get returns can be set back
				actions.Look.Bindings.Mouse.Set({
					KeyCode: Enum.KeyCode.MouseDelta,
					Scale: 0.02,
					Vector2Scale: new Vector2(1, -1),
				});
			});

			test("BindingsChanged fires with the path on Set, Reset and Clear", () => {
				const input = createTestInput();
				const paths = recordSignal(input.BindingsChanged);
				const jump = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				jump.Set(Enum.KeyCode.F);
				jump.Reset();
				input.Gameplay.Actions.Move.Bindings.Gamepad.Clear();
				eventually(() => paths.size() === 3, "three changes");
				expectArrayEqual(paths, [
					"Gameplay/Jump/KeyboardAndMouse",
					"Gameplay/Jump/KeyboardAndMouse",
					"Gameplay/Move/Gamepad",
				]);
			});

			test("Capture checks the slot and returns a cancel function", () => {
				const actions = createTestInput().Gameplay.Actions;
				const jump = actions.Jump.Bindings.KeyboardAndMouse;
				let captured: Enum.KeyCode | undefined;
				const cancel = jump.Capture("KeyCode", (key) => (captured = key), {
					Cancel: [Enum.KeyCode.Backspace],
				});
				expectNoThrow(cancel);
				expectNoThrow(cancel);
				frame();
				expectEqual(captured, undefined);
				expectEqual(jump.Instance.KeyCode, Enum.KeyCode.Space);
				expectThrows(() =>
					(jump as unknown as { Capture(slot: string, callback: () => void): void }).Capture(
						"Up",
						() => {},
					),
				);
				expectNoThrow(() => actions.Fly.Bindings.Keyboard.Capture("Forward", () => {})());
			});

			test("Capture takes only keys legal for the slot; cancel keys stop it", () => {
				expectEqual(DecideCapture("Bool", "KeyCode", Enum.KeyCode.F, []), ECaptureDecision.Accept);
				expectEqual(
					DecideCapture("Bool", "KeyCode", Enum.KeyCode.MouseLeftButton, []),
					ECaptureDecision.Accept,
				);
				expectEqual(
					DecideCapture("Bool", "KeyCode", Enum.KeyCode.Escape, []),
					ECaptureDecision.Ignore,
				);
				expectEqual(
					DecideCapture("Direction2D", "KeyCode", Enum.KeyCode.W, []),
					ECaptureDecision.Ignore,
				);
				expectEqual(
					DecideCapture("Direction2D", "Up", Enum.KeyCode.W, []),
					ECaptureDecision.Accept,
				);
				expectEqual(
					DecideCapture("Bool", "PrimaryModifier", Enum.KeyCode.ButtonR2, []),
					ECaptureDecision.Ignore,
				);
				expectEqual(
					DecideCapture("Bool", "KeyCode", Enum.KeyCode.Backspace, [Enum.KeyCode.Backspace]),
					ECaptureDecision.Cancel,
				);
				// mouse buttons and touch come in as input types
				expectEqual(
					KeyFromInput(Enum.KeyCode.Unknown, Enum.UserInputType.MouseButton1),
					Enum.KeyCode.MouseLeftButton,
				);
				expectEqual(
					KeyFromInput(Enum.KeyCode.Unknown, Enum.UserInputType.MouseButton2),
					Enum.KeyCode.MouseRightButton,
				);
				expectEqual(
					KeyFromInput(Enum.KeyCode.Unknown, Enum.UserInputType.Touch),
					Enum.KeyCode.TouchPosition,
				);
				expectEqual(KeyFromInput(Enum.KeyCode.Q, Enum.UserInputType.Keyboard), Enum.KeyCode.Q);
				expectEqual(
					KeyFromInput(Enum.KeyCode.Unknown, Enum.UserInputType.MouseMovement),
					undefined,
				);
			});

			test("a captured key is applied with the one-source rule and reported", () => {
				const input = createTestInput();
				const paths = recordSignal(input.BindingsChanged);
				const pad = input.Gameplay.Actions.Move.Bindings.Gamepad;
				(
					pad as unknown as { ApplyCapturedKey(slot: string, key: Enum.KeyCode): void }
				).ApplyCapturedKey("Left", Enum.KeyCode.DPadLeft);
				expectEqual(pad.Instance.KeyCode, Enum.KeyCode.None);
				expectEqual(pad.Instance.Left, Enum.KeyCode.DPadLeft);
				eventually(() => paths.size() === 1, "BindingsChanged");
				expectEqual(paths[0], "Gameplay/Move/Gamepad");
				expectFalse(pad.Instance.Up === Enum.KeyCode.DPadLeft);
			});
		});
	}
}
