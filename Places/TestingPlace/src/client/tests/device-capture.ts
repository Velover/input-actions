import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { UserInputService } from "@rbxts/services";
import { createTestInput, frames, newFolder, recordSignal } from "./helpers";
import { emptyPoint, RealInput, realInput, testGui } from "./virtual";
import { VirtualPad, virtualPad } from "./virtual-pad";

const K = Enum.KeyCode;

/** What a chord callback received: on a binding, the chord; on an action, the device too */
interface IOutcome {
	chord?: InputActions.Chord;
	device?: InputActions.CapturableDevice;
}

function describe(outcome: IOutcome | undefined) {
	if (outcome === undefined) return "nothing";
	const chord = outcome.chord;
	if (chord === undefined) return "undefined";
	const keys = `${chord.PrimaryModifier?.Name ?? "-"}+${chord.SecondaryModifier?.Name ?? "-"}+${chord.KeyCode.Name}`;
	return outcome.device !== undefined ? `${keys} on ${outcome.device}` : keys;
}

/** Holds `keys` down in order, each one landed before the next */
function hold(real: RealInput, keys: Enum.KeyCode[]) {
	for (const key of keys) {
		real.Press(key);
		eventually(() => UserInputService.IsKeyDown(key), `${key.Name} is down${real.FocusNote()}`);
		frames(2);
	}
}

/** Releases `key` and waits until the engine has it up */
function lifted(real: RealInput, key: Enum.KeyCode) {
	real.Release(key);
	eventually(() => !UserInputService.IsKeyDown(key), `${key.Name} is up${real.FocusNote()}`);
}

/** A few frames in which nothing may arrive */
function quiet() {
	frames(6);
}

/** A schema with a Direction1D action bound on both devices, for the one-field capture */
const THROTTLE_SCHEMA = InputActions.Schema({
	DeviceCapture: {
		Actions: {
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Up: K.PageUp, Down: K.PageDown },
				Gamepad: K.ButtonR2,
			}),
			Steer: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
				Gamepad: { Up: K.DPadUp, Down: K.DPadDown },
			}),
		},
	},
});

function createThrottle() {
	const input = InputActions.Create(THROTTLE_SCHEMA, {
		Folder: newFolder(),
		ResetOnFocusLoss: false,
	});
	defer(() => input.Destroy());
	return input;
}

/** The virtual pad for a test that presses it, plugged in; or why there is none (the test skips) */
function pluggedPad(): VirtualPad | string {
	const pad = virtualPad();
	if (typeIs(pad, "string")) return pad;
	if (pad.Connect() === undefined) return "Roblox never listed the virtual pad";
	frames(3);
	return pad;
}

/**
 * Device-locked captures (0.7.0, design spec §6): a binding's Capture and CaptureChord take its
 * device's keys only, Bool and Direction1D actions have a one-field Capture and CaptureChord where
 * the first key picks the device, and the gamepad's sticks and triggers count. Real keys through
 * VirtualInput, which sends gamepad KeyCodes (ButtonX...) as keys: the captures classify a key by
 * its KeyCode, so they stand for a pad's buttons here. Sticks and triggers need the virtual pad,
 * whose input is opt-in (VIRTUAL_PAD_INPUT=1): those tests skip by default.
 */
@Provider({ activeIn: ["testing"] })
export class DeviceCaptureTests implements OnStart {
	onStart() {
		defineTests("device-capture", () => {
			// ---- a binding's captures take its own device's keys

			test("the keyboard's Capture ignores gamepad keys (not a cancel), then takes a key", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const captured = new Array<Enum.KeyCode>();
				const stop = keys.Capture("KeyCode", (key) => captured.push(key));
				defer(stop);
				real.Tap(K.ButtonX);
				real.Tap(K.ButtonL1);
				quiet();
				expectEqual(captured.size(), 0, `gamepad keys${real.FocusNote()}`);
				real.Tap(K.G);
				eventually(() => captured.size() === 1, `G${real.FocusNote()}`);
				expectEqual(captured[0], K.G);
				expectEqual(keys.Instance.KeyCode, K.G);
			});

			test("the Gamepad binding's Capture ignores keyboard keys and clicks, and takes a gamepad key", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const pad = input.Gameplay.Actions.Jump.Bindings.Gamepad;
				const changes = recordSignal(input.BindingsChanged);
				const captured = new Array<Enum.KeyCode>();
				const stop = pad.Capture("KeyCode", (key) => captured.push(key));
				defer(stop);
				real.Tap(K.G);
				real.Click(emptyPoint());
				quiet();
				expectEqual(captured.size(), 0, `a key and a click${real.FocusNote()}`);
				real.Tap(K.ButtonY);
				eventually(() => captured.size() === 1, `ButtonY${real.FocusNote()}`);
				expectEqual(captured[0], K.ButtonY);
				expectEqual(pad.Instance.KeyCode, K.ButtonY);
				eventually(() => changes.includes("Gameplay/Jump/Gamepad"), "BindingsChanged");
				expectEqual(
					input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode,
					K.Space,
				);
			});

			test("a Cancel key counts from any device", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				// the Gamepad binding, cancelled from the keyboard
				let padCalls = 0;
				jump.Bindings.Gamepad.Capture("KeyCode", () => padCalls++, { Cancel: [K.Backspace] });
				real.Tap(K.Backspace);
				real.Tap(K.ButtonX);
				quiet();
				expectEqual(padCalls, 0, `cancelled${real.FocusNote()}`);
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA);
				// the keyboard's binding, cancelled from the gamepad
				let keyCalls = 0;
				jump.Bindings.KeyboardAndMouse.Capture("KeyCode", () => keyCalls++, {
					Cancel: [K.ButtonB],
				});
				real.Tap(K.ButtonB);
				real.Tap(K.G);
				quiet();
				expectEqual(keyCalls, 0, `cancelled${real.FocusNote()}`);
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.Space);
			});

			test("the Gamepad binding's CaptureChord: gamepad keys held together, a keyboard key among them ignored", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const pad = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.Gamepad;
				const outcomes = new Array<IOutcome>();
				pad.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.ButtonL1, K.G, K.ButtonX]);
				lifted(real, K.G);
				quiet();
				expectEqual(outcomes.size(), 0, `G's release settles nothing${real.FocusNote()}`);
				lifted(real, K.ButtonX);
				eventually(() => outcomes.size() === 1, `the chord${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0]), "ButtonL1+-+ButtonX");
				expectEqual(pad.Instance.KeyCode, K.ButtonX);
				expectEqual(pad.Instance.PrimaryModifier, K.ButtonL1);
			});

			test("the keyboard's CaptureChord ignores gamepad keys among its keys", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const outcomes = new Array<IOutcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.ButtonX, K.G]);
				lifted(real, K.ButtonX);
				quiet();
				expectEqual(outcomes.size(), 0, `ButtonX's release settles nothing${real.FocusNote()}`);
				lifted(real, K.G);
				eventually(() => outcomes.size() === 1, `the chord${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0]), "LeftControl+-+G");
			});

			// ---- the one-field capture on the action: the first key picks the device

			test("action.Capture: a keyboard key goes into the keyboard's binding", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump;
				const changes = recordSignal(input.BindingsChanged);
				const captured = new Array<string>();
				jump.Capture((key, device) => captured.push(`${key.Name} on ${device}`));
				real.Tap(K.G);
				eventually(() => captured.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(captured[0], "G on KeyboardAndMouse");
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.G);
				expectEqual(
					jump.Bindings.Gamepad.Instance.KeyCode,
					K.ButtonA,
					"the other device's binding",
				);
				eventually(() => changes.includes("Gameplay/Jump/KeyboardAndMouse"), "BindingsChanged");
				// the capture is over
				real.Tap(K.H);
				quiet();
				expectEqual(captured.size(), 1);
				// the captured key presses the action
				real.Press(K.G);
				eventually(() => jump.IsPressed(), `G presses Jump${real.FocusNote()}`);
				lifted(real, K.G);
				eventually(() => !jump.IsPressed(), "released");
			});

			test("action.Capture: a gamepad key goes into the Gamepad binding", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const captured = new Array<string>();
				jump.Capture((key, device) => captured.push(`${key.Name} on ${device}`));
				real.Tap(K.ButtonX);
				eventually(() => captured.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(captured[0], "ButtonX on Gamepad");
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonX);
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.Space);
			});

			test("action.Capture on a Direction1D: the key replaces the device's composite; a click it can't take is ignored", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const throttle = createThrottle().DeviceCapture.Actions.Throttle;
				const captured = new Array<string>();
				const stop = throttle.Capture((key, device) => captured.push(`${key.Name} on ${device}`), {
					Cancel: [K.Delete],
				});
				defer(stop);
				// a mouse button is no Direction1D KeyCode (on the phone, a tap is touch's: ignored)
				real.Click(emptyPoint());
				quiet();
				expectEqual(captured.size(), 0, `a click${real.FocusNote()}`);
				real.Tap(K.J);
				eventually(() => captured.size() === 1, `J${real.FocusNote()}`);
				expectEqual(captured[0], "J on KeyboardAndMouse");
				const keys = throttle.Bindings.KeyboardAndMouse.Instance;
				expectEqual(keys.KeyCode, K.J);
				expectEqual(keys.Up, K.None, "the composite gave way");
				expectEqual(keys.Down, K.None);
				expectEqual(throttle.Bindings.Gamepad.Instance.KeyCode, K.ButtonR2);
				real.Press(K.J);
				eventually(() => throttle.GetState() === 1, `J drives Throttle${real.FocusNote()}`);
				lifted(real, K.J);
				eventually(() => throttle.GetState() === 0, "at rest");
			});

			test("action.Capture: a Cancel key from either device ends it with nothing", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				let calls = 0;
				jump.Capture(() => calls++, { Cancel: [K.ButtonB] });
				real.Tap(K.ButtonB);
				real.Tap(K.G);
				quiet();
				expectEqual(calls, 0, `cancelled${real.FocusNote()}`);
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.Space);
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA);
			});

			test("action.Capture: a key typed into a focused TextBox is no part of it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const box = new Instance("TextBox");
				box.Size = UDim2.fromOffset(200, 50);
				box.Text = "";
				box.Parent = testGui("DeviceCaptureBox");
				defer(() => box.ReleaseFocus());
				const captured = new Array<string>();
				jump.Capture((key, device) => captured.push(`${key.Name} on ${device}`));
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				real.Tap(K.G);
				expectEqual(captured.size(), 0, "typed into the TextBox");
				box.ReleaseFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === undefined, "focus released");
				frames(3);
				real.Tap(K.ButtonY);
				eventually(() => captured.size() === 1, `the next key${real.FocusNote()}`);
				expectEqual(captured[0], "ButtonY on Gamepad");
			});

			test("action.Capture on the phone: a tap is ignored, a key counts", () => {
				if (getProject() !== "touch") return skip("the touch project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const captured = new Array<string>();
				jump.Capture((key, device) => captured.push(`${key.Name} on ${device}`));
				real.Click(emptyPoint());
				quiet();
				expectEqual(captured.size(), 0, "a tap");
				expectEqual(jump.Bindings.Touch.Instance.KeyCode, K.None);
				real.Tap(K.G);
				eventually(() => captured.size() === 1, `G${real.FocusNote()}`);
				expectEqual(captured[0], "G on KeyboardAndMouse");
			});

			test("action.CaptureChord: a keyboard chord goes into the keyboard's binding", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const outcomes = new Array<IOutcome>();
				jump.CaptureChord((chord, device) => outcomes.push({ chord, device }));
				hold(real, [K.LeftControl, K.G]);
				lifted(real, K.G);
				eventually(() => outcomes.size() === 1, `the chord${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0]), "LeftControl+-+G on KeyboardAndMouse");
				const keys = jump.Bindings.KeyboardAndMouse.Instance;
				expectEqual(keys.KeyCode, K.G);
				expectEqual(keys.PrimaryModifier, K.LeftControl);
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA);
			});

			test("action.CaptureChord: the first key picks the device; the other device's keys are ignored (no Shift + ButtonA)", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const outcomes = new Array<IOutcome>();
				jump.CaptureChord((chord, device) => outcomes.push({ chord, device }));
				// the gamepad first: LeftControl and its release are no part of it
				hold(real, [K.ButtonL1, K.LeftControl, K.ButtonX]);
				lifted(real, K.LeftControl);
				quiet();
				expectEqual(outcomes.size(), 0, `LeftControl's release settles nothing${real.FocusNote()}`);
				lifted(real, K.ButtonX);
				eventually(() => outcomes.size() === 1, `the chord${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0]), "ButtonL1+-+ButtonX on Gamepad");
				expectEqual(jump.Bindings.Gamepad.Instance.PrimaryModifier, K.ButtonL1);
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.Space, "untouched");
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.PrimaryModifier, K.None);
			});

			test("action.CaptureChord: after a refused chord, once every key is up, the other device can pick", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const outcomes = new Array<IOutcome>();
				jump.CaptureChord((chord, device) => outcomes.push({ chord, device }));
				// four keys: refused
				hold(real, [K.G, K.H, K.J, K.K]);
				real.ReleaseAll();
				quiet();
				expectEqual(outcomes.size(), 0, `four keys${real.FocusNote()}`);
				hold(real, [K.ButtonY]);
				lifted(real, K.ButtonY);
				eventually(() => outcomes.size() === 1, `ButtonY${real.FocusNote()}`);
				expectEqual(describe(outcomes[0]), "-+-+ButtonY on Gamepad");
			});

			test("action.CaptureChord: a Cancel key or a Timeout with nothing held ends it with undefined twice", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const cancelled = new Array<IOutcome>();
				jump.CaptureChord((chord, device) => cancelled.push({ chord, device }), {
					Cancel: [K.ButtonB],
				});
				real.Tap(K.ButtonB);
				eventually(() => cancelled.size() === 1, `the Cancel key${real.FocusNote()}`);
				expectEqual(cancelled[0].chord, undefined);
				expectEqual(cancelled[0].device, undefined);
				const timedOut = new Array<IOutcome>();
				jump.CaptureChord((chord, device) => timedOut.push({ chord, device }), { Timeout: 0.3 });
				eventually(() => timedOut.size() === 1, "the timeout", 3);
				expectEqual(describe(timedOut[0]), "undefined");
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.Space);
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA);
			});

			test("action.CaptureChord: a Timeout settles the keys held then, on their device", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const throttle = createThrottle().DeviceCapture.Actions.Throttle;
				const outcomes = new Array<IOutcome>();
				throttle.CaptureChord((chord, device) => outcomes.push({ chord, device }), {
					Timeout: 0.5,
				});
				hold(real, [K.ButtonL1, K.ButtonY]);
				eventually(() => outcomes.size() === 1, `the timeout${real.FocusNote()}`, 3);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0]), "ButtonL1+-+ButtonY on Gamepad");
				expectEqual(throttle.Bindings.Gamepad.Instance.KeyCode, K.ButtonY);
				expectEqual(throttle.Bindings.KeyboardAndMouse.Instance.Up, K.PageUp, "untouched");
			});

			test("the action's captures stop when the root handle is destroyed", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump;
				let calls = 0;
				jump.Capture(() => calls++);
				jump.CaptureChord(() => calls++, { Timeout: 0.3 });
				input.Destroy();
				real.Tap(K.G);
				task.wait(0.5);
				expectEqual(calls, 0);
				// and do nothing afterwards
				jump.Capture(() => calls++)();
				jump.CaptureChord(() => calls++)();
			});

			// ---- sticks and triggers: the virtual pad (opt-in: VIRTUAL_PAD_INPUT=1)

			test("pad: a stick pushed past halfway is its direction; back under 0.2 it comes up", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump.Bindings.Gamepad;
				const captured = new Array<Enum.KeyCode>();
				jump.Capture("KeyCode", (key) => captured.push(key));
				// under the threshold: nothing
				pad.SetStick(K.Thumbstick2, new Vector2(0, 0.3));
				quiet();
				expectEqual(captured.size(), 0, "a stick at 0.3");
				pad.SetStick(K.Thumbstick2, new Vector2(0, 0.9));
				eventually(() => captured.size() === 1, "the stick up");
				expectEqual(captured[0], K.Thumbstick2Up);
				expectEqual(jump.Instance.KeyCode, K.Thumbstick2Up);
				pad.SetStick(K.Thumbstick2, Vector2.zero);
				frames(3);
				// a composite slot takes a direction too
				const steer = createThrottle().DeviceCapture.Actions.Steer.Bindings.Gamepad;
				const left = new Array<Enum.KeyCode>();
				steer.Capture("Left", (key) => left.push(key));
				pad.SetStick(K.Thumbstick1, new Vector2(-1, 0));
				eventually(() => left.size() === 1, "the stick left");
				expectEqual(left[0], K.Thumbstick1Left);
				expectEqual(steer.Instance.Left, K.Thumbstick1Left);
			});

			test("pad: a Direction2D KeyCode takes the whole stick, from the first one pushed", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const move = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Move;
				const captured = new Array<Enum.KeyCode>();
				move.Bindings.Gamepad.Capture("KeyCode", (key) => captured.push(key));
				pad.SetStick(K.Thumbstick2, new Vector2(0.8, 0.1));
				eventually(() => captured.size() === 1, "the right stick");
				expectEqual(captured[0], K.Thumbstick2);
				// it was Thumbstick1: the stick pushed first is the one taken
				expectEqual(move.Bindings.Gamepad.Instance.KeyCode, K.Thumbstick2);
			});

			test("pad: a chord can end on a stick's direction", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const outcomes = new Array<IOutcome>();
				jump.CaptureChord((chord, device) => outcomes.push({ chord, device }));
				pad.Press(K.ButtonL1);
				frames(3);
				pad.SetStick(K.Thumbstick1, new Vector2(0, -1));
				frames(4);
				expectEqual(outcomes.size(), 0, "nothing while held");
				pad.SetStick(K.Thumbstick1, Vector2.zero);
				eventually(() => outcomes.size() === 1, "the stick's release settles it");
				pad.Release(K.ButtonL1);
				expectEqual(describe(outcomes[0]), "ButtonL1+-+Thumbstick1Down on Gamepad");
			});

			test("pad: a stick already pushed when the capture starts counts once it has come back", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.Gamepad;
				pad.SetStick(K.Thumbstick1, new Vector2(1, 0));
				frames(4);
				const captured = new Array<Enum.KeyCode>();
				keys.Capture("KeyCode", (key) => captured.push(key));
				frames(4);
				pad.SetStick(K.Thumbstick1, new Vector2(0.9, 0));
				quiet();
				expectEqual(captured.size(), 0, "held since the start");
				pad.SetStick(K.Thumbstick1, Vector2.zero);
				quiet();
				expectEqual(captured.size(), 0, "its release is no part of it either");
				pad.SetStick(K.Thumbstick1, new Vector2(1, 0));
				eventually(() => captured.size() === 1, "pushed again");
				expectEqual(captured[0], K.Thumbstick1Right);
			});

			// Unmeasured: whether a trigger raises InputBegan or only InputChanged. The capture takes it
			// either way; the test records which events came, for the design doc
			test("pad: a trigger pulled past halfway is captured (whichever events Roblox sends)", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const events = new Array<string>();
				const watch = [
					UserInputService.InputBegan.Connect((input) => {
						if (input.KeyCode === K.ButtonR2) events.push(`began ${input.Position.Z}`);
					}),
					UserInputService.InputChanged.Connect((input) => {
						if (input.KeyCode === K.ButtonR2)
							events.push(`changed ${math.floor(input.Position.Z * 100) / 100}`);
					}),
					UserInputService.InputEnded.Connect((input) => {
						if (input.KeyCode === K.ButtonR2) events.push("ended");
					}),
				];
				defer(() => watch.forEach((connection) => connection.Disconnect()));
				const throttle = createThrottle().DeviceCapture.Actions.Throttle;
				const captured = new Array<string>();
				throttle.Capture((key, device) => captured.push(`${key.Name} on ${device}`));
				pad.SetTrigger(K.ButtonR2, 1);
				eventually(() => captured.size() === 1, `the trigger (events: ${events.join(", ")})`);
				pad.SetTrigger(K.ButtonR2, 0);
				frames(4);
				expectEqual(captured[0], "ButtonR2 on Gamepad", events.join(", "));
				print(`device-capture: ButtonR2's events: ${events.join(", ")}`);
				const chordKeys = new Array<IOutcome>();
				throttle.CaptureChord((chord, device) => chordKeys.push({ chord, device }));
				pad.Press(K.ButtonL1);
				frames(3);
				pad.SetTrigger(K.ButtonL2, 1);
				frames(4);
				pad.SetTrigger(K.ButtonL2, 0);
				eventually(() => chordKeys.size() === 1, "the trigger's release settles the chord");
				pad.Release(K.ButtonL1);
				expectEqual(describe(chordKeys[0]), "ButtonL1+-+ButtonL2 on Gamepad");
			});

			test("pad: a gamepad button pressed for real is captured by the action's Capture", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const captured = new Array<string>();
				jump.Capture((key, device) => captured.push(`${key.Name} on ${device}`));
				pad.Tap(K.ButtonY);
				eventually(() => captured.size() === 1, "ButtonY");
				expectEqual(captured[0], "ButtonY on Gamepad");
				// and presses the action for real: IAS takes a pad's buttons on the Gamepad binding
				pad.Press(K.ButtonY);
				eventually(() => jump.IsPressed(), "ButtonY presses Jump");
				pad.Release(K.ButtonY);
				eventually(() => !jump.IsPressed(), "released");
			});
		});
	}
}
