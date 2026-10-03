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
import { usesLegacyPlayerScripts } from "shared/fixtures/projects";
import { PadStick, VirtualPad, virtualPad } from "./virtual-pad";

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

/**
 * IAS bindings on a stick's direction and a trigger, beside a binding to capture into, in a context
 * above the player scripts' and the template other sections leave enabled (CLAUDE.md)
 */
const PAD_PRESS_SCHEMA = InputActions.Schema({
	DevicePadPress: {
		Priority: 3000,
		Actions: {
			Up: InputActions.Bool({ Gamepad: K.Thumbstick2Up }),
			Pull: InputActions.Bool({ Gamepad: K.ButtonR2 }),
			Field: InputActions.Bool({ Gamepad: K.ButtonY }),
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

/** A stick and its four directions */
interface IStick {
	Stick: PadStick;
	Up: Enum.KeyCode;
	Down: Enum.KeyCode;
	Left: Enum.KeyCode;
	Right: Enum.KeyCode;
}

const LEFT_STICK: IStick = {
	Stick: K.Thumbstick1,
	Up: K.Thumbstick1Up,
	Down: K.Thumbstick1Down,
	Left: K.Thumbstick1Left,
	Right: K.Thumbstick1Right,
};
const RIGHT_STICK: IStick = {
	Stick: K.Thumbstick2,
	Up: K.Thumbstick2Up,
	Down: K.Thumbstick2Down,
	Left: K.Thumbstick2Left,
	Right: K.Thumbstick2Right,
};

/**
 * A stick no player script takes: the left one, unless the legacy player scripts run. Their
 * ControlModule binds the left stick (and ButtonA) through ContextActionService and sinks it: every
 * InputChanged of it arrives game-processed, which captures ignore, and an IAS binding on it stays
 * at rest past 0.3 (measured with the virtual pad under `default`, 2026-10-03). The legacy camera
 * leaves the right stick unprocessed.
 */
function freeStick(): IStick {
	return usesLegacyPlayerScripts() ? RIGHT_STICK : LEFT_STICK;
}

function round(value: number) {
	return math.floor(value * 100 + 0.5) / 100;
}

/**
 * What UserInputService saw of `keys` until the test ends, for failure messages: each event's
 * kind (B, C, E), Position and whether it was game-processed; the last 16
 */
function padEvents(keys: Enum.KeyCode[]): () => string {
	const events = new Array<string>();
	const record = (kind: string) => (input: InputObject, gameProcessed: boolean) => {
		if (!keys.includes(input.KeyCode)) return;
		const position = input.Position;
		events.push(
			`${kind} ${input.KeyCode.Name} (${round(position.X)},${round(position.Y)},${round(position.Z)})${gameProcessed ? " gp" : ""}`,
		);
	};
	const connections = [
		UserInputService.InputBegan.Connect(record("B")),
		UserInputService.InputChanged.Connect(record("C")),
		UserInputService.InputEnded.Connect(record("E")),
	];
	defer(() => connections.forEach((connection) => connection.Disconnect()));
	return () => {
		const last = new Array<string>();
		for (let index = math.max(0, events.size() - 16); index < events.size(); index++)
			last.push(events[index]);
		return `events: ${last.join(", ")}`;
	};
}

/**
 * As `eventually`, with the message read when it gives up, so that it holds the pad's events up to
 * then (`eventually` takes a string, made before it waits)
 */
function eventuallyPad(predicate: () => boolean, what: () => string, timeout = 5) {
	const deadline = os.clock() + timeout;
	while (!predicate()) {
		if (os.clock() >= deadline) error(`expected ${what()} within ${timeout} seconds`, 2);
		task.wait();
	}
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
				const stop = keys.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
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
				const stop = pad.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				defer(stop);
				real.Tap(K.G);
				real.Click(emptyPoint());
				quiet();
				expectEqual(captured.size(), 0, `a key and a click${real.FocusNote()}`);
				real.Tap(K.ButtonX);
				eventually(() => captured.size() === 1, `ButtonX${real.FocusNote()}`);
				expectEqual(captured[0], K.ButtonX);
				expectEqual(pad.Instance.KeyCode, K.ButtonX);
				eventually(() => changes.includes("Gameplay/Jump/Gamepad"), "BindingsChanged");
				expectEqual(
					input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode,
					K.Space,
				);
			});

			test("a Cancel key counts from any device, and calls back with undefined", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				// the Gamepad binding, cancelled from the keyboard
				const padCalls = new Array<string>();
				jump.Bindings.Gamepad.Capture("KeyCode", (key) => padCalls.push(key?.Name ?? "undefined"), {
					Cancel: [K.Backspace],
				});
				real.Tap(K.Backspace);
				eventually(() => padCalls.size() === 1, `the cancel${real.FocusNote()}`);
				real.Tap(K.ButtonX);
				quiet();
				expectEqual(padCalls.join(","), "undefined", `cancelled, then nothing${real.FocusNote()}`);
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA);
				// the keyboard's binding, cancelled from the gamepad
				const keyCalls = new Array<string>();
				jump.Bindings.KeyboardAndMouse.Capture("KeyCode", (key) => keyCalls.push(key?.Name ?? "undefined"), {
					Cancel: [K.ButtonL1],
				});
				real.Tap(K.ButtonL1);
				eventually(() => keyCalls.size() === 1, `the cancel${real.FocusNote()}`);
				real.Tap(K.G);
				quiet();
				expectEqual(keyCalls.join(","), "undefined", `cancelled, then nothing${real.FocusNote()}`);
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
				jump.Capture((key, device) => captured.push(`${key?.Name ?? "cancelled"} on ${device}`));
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
				jump.Capture((key, device) => captured.push(`${key?.Name ?? "cancelled"} on ${device}`));
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
				const stop = throttle.Capture((key, device) => captured.push(`${key?.Name ?? "cancelled"} on ${device}`), {
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

			test("action.Capture: a Cancel key from either device ends it with nothing, calling back with undefined twice", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const calls = new Array<string>();
				jump.Capture((key, device) => calls.push(`${key?.Name ?? "undefined"} on ${device ?? "undefined"}`), {
					Cancel: [K.ButtonL1],
				});
				real.Tap(K.ButtonL1);
				eventually(() => calls.size() === 1, `the cancel${real.FocusNote()}`);
				real.Tap(K.G);
				quiet();
				expectEqual(calls.join(","), "undefined on undefined", `cancelled, then nothing${real.FocusNote()}`);
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
				jump.Capture((key, device) => captured.push(`${key?.Name ?? "cancelled"} on ${device}`));
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				real.Tap(K.G);
				expectEqual(captured.size(), 0, "typed into the TextBox");
				box.ReleaseFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === undefined, "focus released");
				frames(3);
				real.Tap(K.ButtonX);
				eventually(() => captured.size() === 1, `the next key${real.FocusNote()}`);
				expectEqual(captured[0], "ButtonX on Gamepad");
			});

			test("action.Capture on the phone: a tap is ignored, a key counts", () => {
				if (getProject() !== "touch") return skip("the touch project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const captured = new Array<string>();
				jump.Capture((key, device) => captured.push(`${key?.Name ?? "cancelled"} on ${device}`));
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
				hold(real, [K.ButtonX]);
				lifted(real, K.ButtonX);
				eventually(() => outcomes.size() === 1, `ButtonX${real.FocusNote()}`);
				expectEqual(describe(outcomes[0]), "-+-+ButtonX on Gamepad");
			});

			test("action.CaptureChord: a Cancel key or a Timeout with nothing held ends it with undefined twice", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const cancelled = new Array<IOutcome>();
				jump.CaptureChord((chord, device) => cancelled.push({ chord, device }), {
					Cancel: [K.ButtonL1],
				});
				real.Tap(K.ButtonL1);
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
				hold(real, [K.ButtonL1, K.ButtonX]);
				eventually(() => outcomes.size() === 1, `the timeout${real.FocusNote()}`, 3);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0]), "ButtonL1+-+ButtonX on Gamepad");
				expectEqual(throttle.Bindings.Gamepad.Instance.KeyCode, K.ButtonX);
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
				const events = padEvents([K.Thumbstick1, K.Thumbstick2]);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump.Bindings.Gamepad;
				const captured = new Array<Enum.KeyCode>();
				jump.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				// under the threshold: nothing
				pad.SetStick(K.Thumbstick2, new Vector2(0, 0.3));
				quiet();
				expectEqual(captured.size(), 0, `a stick at 0.3 (${events()})`);
				pad.SetStick(K.Thumbstick2, new Vector2(0, 0.9));
				eventuallyPad(
					() => captured.size() === 1,
					() => `the stick up (${events()})`,
				);
				expectEqual(captured[0], K.Thumbstick2Up);
				expectEqual(jump.Instance.KeyCode, K.Thumbstick2Up);
				pad.SetStick(K.Thumbstick2, Vector2.zero);
				frames(3);
				// a composite slot takes a direction too
				const steer = createThrottle().DeviceCapture.Actions.Steer.Bindings.Gamepad;
				const left = new Array<Enum.KeyCode>();
				steer.Capture("Left", (key) => left.push(key ?? K.Unknown));
				if (usesLegacyPlayerScripts()) {
					// the legacy ControlModule sinks the left stick: game-processed, ignored
					pad.SetStick(K.Thumbstick1, new Vector2(-1, 0));
					quiet();
					expectEqual(left.size(), 0, `the left stick, game-processed (${events()})`);
					pad.SetStick(K.Thumbstick1, Vector2.zero);
					frames(3);
				}
				const stick = freeStick();
				pad.SetStick(stick.Stick, new Vector2(-1, 0));
				eventuallyPad(
					() => left.size() === 1,
					() => `the stick left (${events()})`,
				);
				expectEqual(left[0], stick.Left);
				expectEqual(steer.Instance.Left, stick.Left);
			});

			test("pad: a Direction2D KeyCode takes the whole stick, from the first one pushed", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const move = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Move;
				const captured = new Array<Enum.KeyCode>();
				move.Bindings.Gamepad.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
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
				const stick = freeStick();
				const events = padEvents([K.ButtonL1, stick.Stick]);
				const outcomes = new Array<IOutcome>();
				jump.CaptureChord((chord, device) => outcomes.push({ chord, device }));
				pad.Press(K.ButtonL1);
				frames(3);
				pad.SetStick(stick.Stick, new Vector2(0, -1));
				frames(4);
				expectEqual(outcomes.size(), 0, `nothing while held (${events()})`);
				pad.SetStick(stick.Stick, Vector2.zero);
				eventuallyPad(
					() => outcomes.size() === 1,
					() => `the stick's release settles it (${events()})`,
				);
				pad.Release(K.ButtonL1);
				expectEqual(describe(outcomes[0]), `ButtonL1+-+${stick.Down.Name} on Gamepad`);
			});

			test("pad: a stick already pushed when the capture starts counts once it has come back", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.Gamepad;
				const stick = freeStick();
				const events = padEvents([stick.Stick]);
				pad.SetStick(stick.Stick, new Vector2(1, 0));
				frames(4);
				const captured = new Array<Enum.KeyCode>();
				keys.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				frames(4);
				pad.SetStick(stick.Stick, new Vector2(0.9, 0));
				quiet();
				expectEqual(captured.size(), 0, `held since the start (${events()})`);
				pad.SetStick(stick.Stick, Vector2.zero);
				quiet();
				expectEqual(captured.size(), 0, `its release is no part of it either (${events()})`);
				pad.SetStick(stick.Stick, new Vector2(1, 0));
				eventuallyPad(
					() => captured.size() === 1,
					() => `pushed again (${events()})`,
				);
				expectEqual(captured[0], stick.Right);
			});

			// Measured with the virtual pad (2026-10-03): a trigger raises InputChanged at every change
			// (Position.Z, raw: no deadzone), InputBegan only once all the way down (Z = 1, none at
			// 0.98) and InputEnded only once all the way up (Z = 0, none at 0.02). So the capture takes
			// it at the InputChanged past halfway; the messages carry the events that came. Pulled to
			// 0.8, short of the InputBegan, and released to 0.1, short of the InputEnded, so that the
			// InputChanged path does it all
			test("pad: a trigger pulled past halfway is captured (whichever events Roblox sends)", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const events = padEvents([K.ButtonR2, K.ButtonL2, K.ButtonL1]);
				const throttle = createThrottle().DeviceCapture.Actions.Throttle;
				const captured = new Array<string>();
				throttle.Capture((key, device) => captured.push(`${key?.Name ?? "cancelled"} on ${device}`));
				pad.SetTrigger(K.ButtonR2, 0.8);
				eventuallyPad(
					() => captured.size() === 1,
					() => `the trigger (${events()})`,
				);
				pad.SetTrigger(K.ButtonR2, 0);
				frames(4);
				expectEqual(captured[0], "ButtonR2 on Gamepad", events());
				const chordKeys = new Array<IOutcome>();
				throttle.CaptureChord((chord, device) => chordKeys.push({ chord, device }));
				pad.Press(K.ButtonL1);
				frames(3);
				pad.SetTrigger(K.ButtonL2, 0.8);
				frames(4);
				expectEqual(chordKeys.size(), 0, `nothing while held (${events()})`);
				pad.SetTrigger(K.ButtonL2, 0.1);
				eventuallyPad(
					() => chordKeys.size() === 1,
					() => `the trigger's release settles the chord (${events()})`,
				);
				pad.Release(K.ButtonL1);
				expectEqual(describe(chordKeys[0]), "ButtonL1+-+ButtonL2 on Gamepad", events());
			});

			// PAD-1 (pad test, fixed: the captures read a stick's distance and a trigger past IAS's
			// deadzone of 0.1, rescaled, before the 0.5 and 0.2 thresholds, as IAS does): they compared
			// the raw Position, so a push from raw 0.5 to 0.55 was captured but never pressed a binding
			// on it (IAS pressed past raw 0.55, released under about 0.28; measured with the virtual pad)
			test("pad: a capture counts a stick's direction and a trigger exactly where IAS presses a binding on it", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const events = padEvents([K.Thumbstick2, K.ButtonR2, K.ButtonL1]);
				// above the player scripts' contexts and the template other sections leave enabled
				const input = InputActions.Create(PAD_PRESS_SCHEMA, {
					Folder: newFolder(),
					ResetOnFocusLoss: false,
				});
				defer(() => input.Destroy());
				const { Up, Pull, Field } = input.DevicePadPress.Actions;
				const captured = new Array<Enum.KeyCode>();
				Field.Bindings.Gamepad.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				const state = () =>
					`captured ${captured.map((key) => key.Name).join("+")}, Up ${Up.IsPressed()}, Pull ${Pull.IsPressed()} (${events()})`;
				// raw 0.52 is 0.467 past the deadzone: neither presses
				pad.SetStick(K.Thumbstick2, new Vector2(0, 0.52));
				quiet();
				expectEqual(`${captured.size()} ${Up.IsPressed()}`, "0 false", `a stick at raw 0.52: ${state()}`);
				// raw 0.6 is 0.556: both
				pad.SetStick(K.Thumbstick2, new Vector2(0, 0.6));
				eventuallyPad(() => captured.size() === 1 && Up.IsPressed(), () => `a stick at raw 0.6: ${state()}`);
				expectEqual(captured[0], K.Thumbstick2Up);
				pad.SetStick(K.Thumbstick2, Vector2.zero);
				eventuallyPad(() => !Up.IsPressed(), () => `the stick back: ${state()}`);
				// a trigger's first move after plugging in, to about 0.45 to 0.6, raises nothing
				// (measured): it starts at 0.3
				Field.Bindings.Gamepad.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				pad.SetTrigger(K.ButtonR2, 0.3);
				frames(3);
				pad.SetTrigger(K.ButtonR2, 0.52);
				quiet();
				expectEqual(`${captured.size()} ${Pull.IsPressed()}`, "1 false", `a trigger at raw 0.52: ${state()}`);
				pad.SetTrigger(K.ButtonR2, 0.6);
				eventuallyPad(() => captured.size() === 2 && Pull.IsPressed(), () => `a trigger at raw 0.6: ${state()}`);
				expectEqual(captured[1], K.ButtonR2);
				pad.SetTrigger(K.ButtonR2, 0);
				eventuallyPad(() => !Pull.IsPressed(), () => `the trigger back: ${state()}`);
				// coming up: a chord settles when IAS lets go (under raw 0.28), not before
				const chords = new Array<string>();
				Field.Bindings.Gamepad.CaptureChord((chord) => chords.push(describe({ chord })));
				pad.Press(K.ButtonL1);
				frames(3);
				pad.SetTrigger(K.ButtonR2, 0.8);
				eventuallyPad(() => Pull.IsPressed(), () => `pulled again: ${state()}`);
				// raw 0.32 is 0.244 past the deadzone: still down for both
				pad.SetTrigger(K.ButtonR2, 0.32);
				quiet();
				expectEqual(`${chords.join(", ")} ${Pull.IsPressed()}`, " true", `a trigger back at raw 0.32: ${state()}`);
				// raw 0.2 is 0.111: up for both
				pad.SetTrigger(K.ButtonR2, 0.2);
				eventuallyPad(() => chords.size() === 1 && !Pull.IsPressed(), () => `a trigger back at raw 0.2: ${chords.join(", ")} ${state()}`);
				pad.Release(K.ButtonL1);
				expectEqual(chords[0], "ButtonL1+-+ButtonR2");
			});

			test("pad: a gamepad button pressed for real is captured by the action's Capture", () => {
				const pad = pluggedPad();
				if (typeIs(pad, "string")) return skip(pad);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				const captured = new Array<string>();
				jump.Capture((key, device) => captured.push(`${key?.Name ?? "cancelled"} on ${device}`));
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
