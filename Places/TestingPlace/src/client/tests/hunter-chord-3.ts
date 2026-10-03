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
import {
	ContextActionService,
	GuiService,
	RunService,
	TextChatService,
	UserInputService,
} from "@rbxts/services";
import { ClassifyCaptureInput } from "@rbxts/input-actions/out/InputActions/Capture";
import { createTestInput, frames, newFolder } from "./helpers";
import {
	clickProblem,
	emptyPoint,
	RealInput,
	realInput,
	screenCenter,
	testButton,
	testGui,
} from "./virtual";

const K = Enum.KeyCode;

/** What a CaptureChord callback received, in order: `chord` is undefined for an end with nothing */
type Outcome = { chord?: InputActions.Chord };

function describe(chord: InputActions.Chord | undefined) {
	if (chord === undefined) return "undefined";
	return `${chord.PrimaryModifier?.Name ?? "-"}+${chord.SecondaryModifier?.Name ?? "-"}+${chord.KeyCode.Name}`;
}

function describeAll(outcomes: Outcome[]) {
	return outcomes.size() === 0 ? "nothing" : outcomes.map((o) => describe(o.chord)).join(", ");
}

function names(keys: Enum.KeyCode[]) {
	return keys.size() === 0 ? "nothing" : keys.map((key) => key.Name).join(",");
}

/** Holds `keys` down in order, two frames apart, each one landed before the next */
function hold(real: RealInput, keys: Enum.KeyCode[]) {
	for (const key of keys) {
		real.Press(key);
		landed(real, key);
		frames(2);
	}
}

/** Waits until the engine has `key` down (VirtualInput keys can land a few frames late) */
function landed(real: RealInput, key: Enum.KeyCode) {
	eventually(() => UserInputService.IsKeyDown(key), `${key.Name} is down${real.FocusNote()}`);
}

/** Waits until the engine has `key` up */
function lifted(real: RealInput, key: Enum.KeyCode) {
	real.Release(key);
	eventually(() => !UserInputService.IsKeyDown(key), `${key.Name} is up${real.FocusNote()}`);
}

/** Waits up to `seconds` for `predicate`; whether it came true (the caller asserts, with what it measured) */
function waitFor(predicate: () => boolean, seconds = 2): boolean {
	const deadline = os.clock() + seconds;
	while (!predicate()) {
		if (os.clock() > deadline) return false;
		frames(1);
	}
	return true;
}

/**
 * Whether Studio simulates a phone, where VirtualInput's mouse events arrive as touch. Not
 * `PreferredInput`: on the phone it follows the last input, and a key makes it KeyboardAndMouse
 */
function isTouch() {
	return getProject() === "touch";
}

/** The key a click (a tap on the simulated phone) is captured as */
function clickKey() {
	return isTouch() ? K.TouchPosition : K.MouseLeftButton;
}

/** What the engine reports down right now: keys and mouse button 1 */
function downNow() {
	const keys = UserInputService.GetKeysPressed().map((input) => input.KeyCode.Name);
	const mouse = UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton1);
	return `keys ${keys.size() === 0 ? "none" : keys.join(",")}, MB1 ${mouse}`;
}

let actionCount = 0;
/** A ContextActionService action on `inputs` that returns `result`; unbound after the test */
function casAction(
	inputs: (Enum.KeyCode | Enum.UserInputType)[],
	result: Enum.ContextActionResult,
	onBegin?: () => void,
) {
	actionCount++;
	const name = `HunterChord3Action${actionCount}`;
	ContextActionService.BindActionAtPriority(
		name,
		(_, state) => {
			if (state === Enum.UserInputState.Begin && onBegin !== undefined) onBegin();
			return result;
		},
		false,
		4000,
		...inputs,
	);
	defer(() => ContextActionService.UnbindAction(name));
}

/** The gameProcessed flag of every InputBegan of a click or tap until the test ends */
function watchClicks(): string[] {
	const seen = new Array<string>();
	const connection = UserInputService.InputBegan.Connect((inputObject, processed) => {
		const kind = inputObject.UserInputType;
		if (kind === Enum.UserInputType.MouseButton1 || kind === Enum.UserInputType.Touch)
			seen.push(tostring(processed));
	});
	defer(() => connection.Disconnect());
	return seen;
}

let lastFocusRelease = -math.huge;
UserInputService.TextBoxFocusReleased.Connect(() => {
	lastFocusRelease = os.clock();
});

/**
 * Waits until no TextBox has lost focus for 0.15 s: within 0.1 s of a release (TYPING_GRACE) a
 * game-processed key is typing, and an earlier test's TextBox would make this one's keys typing
 */
function clearOfTyping() {
	while (os.clock() - lastFocusRelease < 0.15) frames(1);
}

/** Every InputBegan ("B") and InputEnded ("E") of `key` until the test ends, with gameProcessed */
function watchKey(key: Enum.KeyCode): string[] {
	const seen = new Array<string>();
	const began = UserInputService.InputBegan.Connect((inputObject, processed) => {
		if (inputObject.KeyCode !== key) return;
		const kind = ClassifyCaptureInput(key, processed, []);
		const box = UserInputService.GetFocusedTextBox();
		const since = math.floor((os.clock() - lastFocusRelease) * 1000);
		seen.push(
			`B:${processed} as ${kind} (focused ${box?.GetFullName() ?? "none"}, ${since} ms after a focus release)`,
		);
	});
	const ended = UserInputService.InputEnded.Connect((inputObject, processed) => {
		if (inputObject.KeyCode === key) seen.push(`E:${processed}`);
	});
	defer(() => {
		began.Disconnect();
		ended.Disconnect();
	});
	return seen;
}

function newTextBox() {
	const box = new Instance("TextBox");
	box.Size = UDim2.fromOffset(200, 50);
	box.Position = UDim2.fromScale(0.3, 0.6);
	box.Text = "";
	box.ClearTextOnFocus = false;
	box.Parent = testGui("HunterChord3TextBox");
	defer(() => box.ReleaseFocus());
	return box;
}

let sinkCount = 0;
/** A ContextActionService action that sinks `keys`, as a game's own CAS bindings do */
function casSink(keys: Enum.KeyCode[]) {
	sinkCount++;
	const name = `HunterChord3Sink${sinkCount}`;
	ContextActionService.BindActionAtPriority(
		name,
		() => Enum.ContextActionResult.Sink,
		false,
		4000,
		...keys,
	);
	defer(() => ContextActionService.UnbindAction(name));
}

/**
 * The two captures a test starts from a handler: `Capture("KeyCode")` on Jump's keyboard binding
 * and `CaptureChord` on Crouch's, both Bool, so the same key can be checked against both
 */
function startBoth(
	input: ReturnType<typeof createTestInput>,
	captured: Enum.KeyCode[],
	outcomes: Outcome[],
) {
	const stopOne = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Capture("KeyCode", (key) =>
		captured.push(key),
	);
	const stopChord = input.Gameplay.Actions.Crouch.Bindings.KeyboardAndMouse.CaptureChord((chord) =>
		outcomes.push({ chord }),
	);
	defer(() => {
		stopOne();
		stopChord();
	});
}

/**
 * Hunter round 3 on `CaptureChord` and `Capture` after round 2 (`KeysDownNow`, `TYPING_GRACE`, taken
 * keys in a chord): captures started from handlers that run at a release or before `InputBegan`,
 * touch, TextBox focus. Real keys through VirtualInput, clear of what the player scripts sink.
 */
@Provider({ activeIn: ["testing"] })
export class HunterChord3Tests implements OnStart {
	onStart() {
		defineTests("hunter-chord-3", () => {
			// First in the section, so that run alone it is the session's first capture (the
			// TextBoxFocusReleased watch is connected by the first capture)
			test("a capture started from a TextBox's FocusLost (Return submits it) isn't cancelled by that Return", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const keys = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const box = newTextBox();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const lost = box.FocusLost.Connect((enterPressed) => {
					if (state !== "?") return;
					state = `enterPressed ${enterPressed}, Return down ${UserInputService.IsKeyDown(K.Return)}, ${downNow()}`;
					keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Return] });
				});
				defer(() => lost.Disconnect());
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				real.Tap(K.Return);
				eventually(() => state !== "?", `Return submits the TextBox${real.FocusNote()}`);
				frames(4);
				const afterStart = describeAll(outcomes);
				real.Tap(K.H);
				waitFor(() => outcomes.size() >= 1);
				expectEqual(
					`${afterStart}; then ${describeAll(outcomes)}`,
					"nothing; then -+-+H",
					`in FocusLost: ${state}${real.FocusNote()}`,
				);
			});

			// TYPING_GRACE is 0.1 s of wall-clock time: in a game running at under 10 fps, is the Return
			// that submits a TextBox still typing?
			test("Return submitting a TextBox at 6 fps (a heavy game) doesn't cancel, as a Cancel key", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const box = newTextBox();
				const events = watchKey(K.Return);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Return] });
				const captured = new Array<Enum.KeyCode>();
				const stop = keys.Capture("PrimaryModifier", (key) => captured.push(key), {
					Cancel: [K.Return],
				});
				defer(stop);
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				let slow = true;
				const lag = RunService.Heartbeat.Connect(() => {
					if (!slow) return;
					const deadline = os.clock() + 0.15;
					while (os.clock() < deadline) {
						// a frame that takes 150 ms
					}
				});
				defer(() => lag.Disconnect());
				frames(2);
				real.Tap(K.Return);
				frames(3);
				slow = false;
				lag.Disconnect();
				frames(3);
				const afterReturn = `chord ${describeAll(outcomes)}; Capture ${names(captured)}`;
				hold(real, [K.H]);
				lifted(real, K.H);
				waitFor(() => outcomes.size() >= 1 && captured.size() >= 1);
				expectEqual(
					`${afterReturn}; then chord ${describeAll(outcomes)}; Capture ${names(captured)}`,
					"chord nothing; Capture nothing; then chord -+-+H; Capture H",
					`Return's events ${events.join(",")}${real.FocusNote()}`,
				);
			});

			// ---- captures started from a handler that runs at a release

			test("a chord capture started in another's callback (settled by G's release) takes G when pressed again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const first = new Array<Outcome>();
				const second = new Array<Outcome>();
				let state = "?";
				keys.CaptureChord((chord) => {
					first.push({ chord });
					state = `G down ${UserInputService.IsKeyDown(K.G)}, ${downNow()}`;
					keys.CaptureChord((later) => second.push({ chord: later }));
				});
				hold(real, [K.G]);
				lifted(real, K.G);
				eventually(() => first.size() === 1, `G settles the first${real.FocusNote()}`);
				frames(4);
				hold(real, [K.G]);
				lifted(real, K.G);
				waitFor(() => second.size() >= 1);
				expectEqual(
					`${describeAll(first)}; then ${describeAll(second)}`,
					"-+-+G; then -+-+G",
					`in the first's callback: ${state}${real.FocusNote()}`,
				);
			});

			test("Capture started in another Capture's callback (a rebind wizard) takes the same key next", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const crouch = input.Gameplay.Actions.Crouch.Bindings.KeyboardAndMouse;
				const captured = new Array<string>();
				let state = "?";
				let stopSecond: (() => void) | undefined;
				defer(() => stopSecond?.());
				const stopFirst = jump.Capture("KeyCode", (key) => {
					captured.push(`Jump ${key.Name}`);
					state = `G down ${UserInputService.IsKeyDown(K.G)}, ${downNow()}`;
					stopSecond = crouch.Capture("KeyCode", (later) => captured.push(`Crouch ${later.Name}`));
				});
				defer(stopFirst);
				hold(real, [K.G]);
				lifted(real, K.G);
				frames(4);
				hold(real, [K.G]);
				lifted(real, K.G);
				waitFor(() => captured.size() >= 2);
				expectEqual(
					captured.join("; "),
					"Jump G; Crouch G",
					`in the first's callback: ${state}${real.FocusNote()}`,
				);
			});

			test("a capture started from UserInputService.InputEnded of G takes G when pressed again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const connection = UserInputService.InputEnded.Connect((inputObject) => {
					if (inputObject.KeyCode !== K.G || state !== "?") return;
					state = `G down ${UserInputService.IsKeyDown(K.G)}, ${downNow()}`;
					startBoth(input, captured, outcomes);
				});
				defer(() => connection.Disconnect());
				hold(real, [K.G]);
				lifted(real, K.G);
				eventually(() => state !== "?", "InputEnded");
				frames(4);
				hold(real, [K.G]);
				lifted(real, K.G);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`Capture ${names(captured)}; chord ${describeAll(outcomes)}`,
					"Capture G; chord -+-+G",
					`in InputEnded: ${state}${real.FocusNote()}`,
				);
			});

			test("a capture started from an action's Released takes that key when pressed again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				// Fire on G: "let go of G to rebind" (Jump's keyboard binding is the one captured, and a
				// binding holds one device's keys: the Gamepad one can't take G)
				const fire = input.Gameplay.Actions.Fire;
				fire.Bindings.KeyboardAndMouse.Set(K.G);
				const connection = fire.Released.Connect(() => {
					if (state !== "?") return;
					state = `G down ${UserInputService.IsKeyDown(K.G)}, ${downNow()}`;
					// Capture on Jump's keyboard slot, CaptureChord on Crouch
					startBoth(input, captured, outcomes);
				});
				defer(() => connection.Disconnect());
				hold(real, [K.G]);
				lifted(real, K.G);
				eventually(() => state !== "?", `Released${real.FocusNote()}`);
				frames(4);
				hold(real, [K.G]);
				lifted(real, K.G);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`Capture ${names(captured)}; chord ${describeAll(outcomes)}`,
					"Capture G; chord -+-+G",
					`in Released: ${state}${real.FocusNote()}`,
				);
			});

			test("a capture started from a GUI button's Activated (a click, a tap) takes a click after", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const button = testButton(testGui("HunterChord3Rebind"), "Rebind");
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const connection = button.Activated.Connect(() => {
					if (state !== "?") return;
					state = downNow();
					startBoth(input, captured, outcomes);
				});
				defer(() => connection.Disconnect());
				real.Click(screenCenter(button));
				eventually(() => state !== "?", `the click activates the button${real.FocusNote()}`);
				frames(4);
				const afterStart = `Capture ${names(captured)}; chord ${describeAll(outcomes)}`;
				real.Click(emptyPoint());
				// a tap is never captured (0.7.0: touch has no keys), so on the phone H ends them
				if (isTouch()) {
					frames(6);
					hold(real, [K.H]);
					lifted(real, K.H);
				}
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				const key = isTouch() ? "H" : clickKey().Name;
				expectEqual(
					`${afterStart}; then Capture ${names(captured)}; chord ${describeAll(outcomes)}`,
					`Capture nothing; chord nothing; then Capture ${key}; chord -+-+${key}`,
					`in Activated: ${state}${real.FocusNote()}`,
				);
			});

			// ---- captures started from a handler that runs before InputBegan: a click or a tap

			// HC3-2 (hunter, fixed: mouse button 1 down at the start stands for a finger too): under touch, the tap whose CAS action (Pass) starts Capture/CaptureChord is captured as TouchPosition (KeysDownNow leaves touches out)
			test("the click (tap) that runs a CAS action (Pass) starting the captures is no part of them", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const processed = watchClicks();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const inputType = isTouch() ? Enum.UserInputType.Touch : Enum.UserInputType.MouseButton1;
				casAction([inputType], Enum.ContextActionResult.Pass, () => {
					if (state !== "?") return;
					state = downNow();
					startBoth(input, captured, outcomes);
				});
				real.MouseDown(emptyPoint());
				eventually(() => state !== "?", `the CAS action ran${real.FocusNote()}`);
				frames(4);
				real.MouseUp();
				frames(6);
				const afterStart = `Capture ${names(captured)}; chord ${describeAll(outcomes)}`;
				hold(real, [K.H]);
				lifted(real, K.H);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterStart}; then Capture ${names(captured)}; chord ${describeAll(outcomes)}`,
					"Capture nothing; chord nothing; then Capture H; chord -+-+H",
					`${inputType.Name}; in the CAS action: ${state}; the click's gameProcessed ${processed.join(",")}${real.FocusNote()}`,
				);
			});

			test("the click (tap) whose IAS action's Pressed starts the captures is no part of them", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const processed = watchClicks();
				const fire = input.Gameplay.Actions.Fire;
				// a tap is the Touch binding's key (0.7.0)
				if (isTouch()) fire.Bindings.Touch.Set(K.TouchPosition);
				else fire.Bindings.KeyboardAndMouse.Set(K.MouseLeftButton);
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const connection = fire.Pressed.Connect(() => {
					if (state !== "?") return;
					state = downNow();
					startBoth(input, captured, outcomes);
				});
				defer(() => connection.Disconnect());
				real.MouseDown(emptyPoint());
				if (!waitFor(() => state !== "?", 2))
					return skip(
						`a ${clickKey().Name} binding isn't pressed by a ${isTouch() ? "tap" : "click"} here`,
					);
				frames(4);
				real.MouseUp();
				frames(6);
				const afterStart = `Capture ${names(captured)}; chord ${describeAll(outcomes)}`;
				hold(real, [K.H]);
				lifted(real, K.H);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterStart}; then Capture ${names(captured)}; chord ${describeAll(outcomes)}`,
					"Capture nothing; chord nothing; then Capture H; chord -+-+H",
					`in Pressed: ${state}; the click's gameProcessed ${processed.join(",")}${real.FocusNote()}`,
				);
			});

			// HC3-2 (hunter, fixed; a second path): under touch, the tap whose GuiObject.InputBegan starts the captures is captured as TouchPosition
			test("the click (tap) whose GUI InputBegan (an inactive label) starts the captures is no part of them", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const processed = watchClicks();
				const label = new Instance("TextLabel");
				label.Active = false;
				label.AnchorPoint = new Vector2(0.5, 0.5);
				label.Position = UDim2.fromScale(0.45, 0.45);
				label.Size = UDim2.fromOffset(160, 90);
				label.Text = "Rebind";
				label.Parent = testGui("HunterChord3Label");
				const problem = clickProblem(label);
				if (problem !== undefined) return skip(problem);
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const connection = label.InputBegan.Connect((inputObject) => {
					const kind = inputObject.UserInputType;
					if (kind !== Enum.UserInputType.MouseButton1 && kind !== Enum.UserInputType.Touch) return;
					if (state !== "?") return;
					state = `${kind.Name}, ${downNow()}`;
					startBoth(input, captured, outcomes);
				});
				defer(() => connection.Disconnect());
				real.MouseDown(screenCenter(label));
				eventually(() => state !== "?", `the label's InputBegan${real.FocusNote()}`);
				frames(4);
				real.MouseUp();
				frames(6);
				const afterStart = `Capture ${names(captured)}; chord ${describeAll(outcomes)}`;
				hold(real, [K.H]);
				lifted(real, K.H);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterStart}; then Capture ${names(captured)}; chord ${describeAll(outcomes)}`,
					"Capture nothing; chord nothing; then Capture H; chord -+-+H",
					`in InputBegan: ${state}; the click's gameProcessed ${processed.join(",")}${real.FocusNote()}`,
				);
			});

			// ---- keys down at the start whose InputEnded comes in odd places

			test("a key held at the start, released while a TextBox has focus, counts when pressed again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const box = newTextBox();
				hold(real, [K.G]);
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				startBoth(input, captured, outcomes);
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				lifted(real, K.G);
				frames(3);
				box.ReleaseFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === undefined, "focus released");
				frames(4);
				const afterFocus = `Capture ${names(captured)}; chord ${describeAll(outcomes)}`;
				hold(real, [K.G]);
				lifted(real, K.G);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterFocus}; then Capture ${names(captured)}; chord ${describeAll(outcomes)}`,
					"Capture nothing; chord nothing; then Capture G; chord -+-+G",
					real.FocusNote(),
				);
			});

			test("a key held at the start sends repeated key-downs (Delete): none of them counts", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				let begins = 0;
				const watch = UserInputService.InputBegan.Connect((inputObject) => {
					if (inputObject.KeyCode === K.Delete) begins++;
				});
				defer(() => watch.Disconnect());
				hold(real, [K.Delete]);
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				startBoth(input, captured, outcomes);
				for (let index = 0; index < 3; index++) {
					real.Device.SendKey(true, K.Delete, true);
					frames(2);
				}
				frames(4);
				const repeats = `Capture ${names(captured)}; chord ${describeAll(outcomes)}`;
				lifted(real, K.Delete);
				frames(4);
				hold(real, [K.H]);
				lifted(real, K.H);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${repeats}; then Capture ${names(captured)}; chord ${describeAll(outcomes)}`,
					"Capture nothing; chord nothing; then Capture H; chord -+-+H",
					`InputBegan of Delete: ${begins}${real.FocusNote()}`,
				);
			});

			test("repeated key-downs of a chord's modifier (Delete, OS auto-repeat) don't change the chord", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.Delete, K.G]);
				for (let index = 0; index < 3; index++) {
					real.Device.SendKey(true, K.Delete, true);
					frames(2);
				}
				lifted(real, K.G);
				waitFor(() => outcomes.size() >= 1);
				real.ReleaseAll();
				expectEqual(describeAll(outcomes), "Delete+-+G", real.FocusNote());
			});

			// ---- taken keys in a chord (HC2-1)

			test("a chord with a sunk key, released modifier first: refused, then the next chord counts", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				casSink([K.K]);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.K]);
				lifted(real, K.LeftControl);
				frames(3);
				lifted(real, K.K);
				frames(6);
				const refused = describeAll(outcomes);
				hold(real, [K.LeftControl, K.G]);
				lifted(real, K.G);
				waitFor(() => outcomes.size() >= 1);
				real.ReleaseAll();
				expectEqual(`${refused}; then ${describeAll(outcomes)}`, "nothing; then LeftControl+-+G");
			});

			test("Timeout with a sunk key held in the chord ends with undefined and no change", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				casSink([K.K]);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Timeout: 1 });
				hold(real, [K.G, K.K]);
				waitFor(() => outcomes.size() >= 1, 3);
				real.ReleaseAll();
				expectEqual(
					`${describeAll(outcomes)}; binding ${keys.Instance.PrimaryModifier.Name}+${keys.Instance.KeyCode.Name}`,
					"undefined; binding None+Space",
				);
			});

			test("a GUI click while Ctrl is held spoils that chord; once all is up, Ctrl+G counts", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const button = testButton(testGui("HunterChord3Dialog"), "Dialog");
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const processed = watchClicks();
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl]);
				real.Click(screenCenter(button));
				frames(4);
				const afterClick = describeAll(outcomes);
				hold(real, [K.G]);
				lifted(real, K.G);
				frames(4);
				const afterG = describeAll(outcomes);
				lifted(real, K.LeftControl);
				frames(4);
				hold(real, [K.LeftControl, K.G]);
				lifted(real, K.G);
				waitFor(() => outcomes.size() >= 1);
				real.ReleaseAll();
				// on the phone the tap is no key of the keyboard's chord (0.7.0: touch is another
				// device, ignored), so Ctrl+G settles at once
				expectEqual(
					`${afterClick}; ${afterG}; then ${describeAll(outcomes)}`,
					isTouch()
						? "nothing; LeftControl+-+G; then LeftControl+-+G"
						: "nothing; nothing; then LeftControl+-+G",
					`the click's gameProcessed ${processed.join(",")}${real.FocusNote()}`,
				);
			});

			// ---- TextBox focus and TYPING_GRACE

			// A click is the other way to end typing (HC2-3 covers Return and Escape): it isn't
			// game-processed, so both captures take it
			// HC3-1 (hunter, fixed: what ends the typing is typing too): the click that takes a TextBox's focus away (ending the typing) is captured as MouseLeftButton by Capture and CaptureChord
			test("a click on the world that takes a TextBox's focus away isn't captured", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const box = newTextBox();
				const problem = clickProblem(box);
				if (problem !== undefined) return skip(problem);
				const processed = watchClicks();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				startBoth(input, captured, outcomes);
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(3);
				real.Click(emptyPoint());
				frames(6);
				const focused = UserInputService.GetFocusedTextBox() !== undefined;
				expectEqual(
					`Capture ${names(captured)}; chord ${describeAll(outcomes)}`,
					"Capture nothing; chord nothing",
					`still focused after the click ${focused}; the click's gameProcessed ${processed.join(",")}${real.FocusNote()}`,
				);
			});

			// ---- a GUI object selected: Return is the game's

			test("Ctrl, then Return that a selected GUI object takes: refused, not recorded as plain LeftControl", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const button = testButton(testGui("HunterChord3Select"), "Select");
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				defer(() => {
					GuiService.SelectedObject = undefined;
				});
				GuiService.SelectedObject = button;
				frames(3);
				if (GuiService.SelectedObject !== button) return skip("the button can't be selected here");
				const events = watchKey(K.Return);
				let activated = 0;
				const activation = button.Activated.Connect(() => activated++);
				defer(() => activation.Disconnect());
				const atStart = downNow();
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.Return]);
				lifted(real, K.Return);
				frames(3);
				lifted(real, K.LeftControl);
				frames(6);
				expectEqual(
					`${describeAll(outcomes)}; binding ${keys.Instance.PrimaryModifier.Name}+${keys.Instance.KeyCode.Name}`,
					"nothing; binding None+Space",
					`down at the start: ${atStart}; Return's events ${events.join(",")}; Activated ${activated}; selected ${GuiService.SelectedObject === button}${real.FocusNote()}`,
				);
			});

			test("Return that a selected GUI object takes, then Ctrl+G once it is up: Ctrl+G", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const button = testButton(testGui("HunterChord3Select2"), "Select");
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				defer(() => {
					GuiService.SelectedObject = undefined;
				});
				GuiService.SelectedObject = button;
				frames(3);
				if (GuiService.SelectedObject !== button) return skip("the button can't be selected here");
				const events = watchKey(K.Return);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.Return]);
				lifted(real, K.Return);
				frames(4);
				const afterReturn = describeAll(outcomes);
				hold(real, [K.LeftControl, K.G]);
				lifted(real, K.G);
				waitFor(() => outcomes.size() >= 1);
				real.ReleaseAll();
				expectEqual(
					`${afterReturn}; then ${describeAll(outcomes)}`,
					"nothing; then LeftControl+-+G",
					`Return's events ${events.join(",")}${real.FocusNote()}`,
				);
			});
		});
	}
}
