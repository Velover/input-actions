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
	TextChatService,
	UserInputService,
	Workspace,
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

function isTouch() {
	return getProject() === "touch";
}

/** The key a click (a tap on the simulated phone) is */
function clickKey() {
	return isTouch() ? K.TouchPosition : K.MouseLeftButton;
}

/**
 * The key the captures should take from the click on the world just sent: the mouse button. On the
 * phone a tap is never captured (0.7.0: touch has no keys to press), so H, pressed here once the
 * tap has had its chance, ends them instead: "Capture H" then also shows the tap was ignored
 */
function clickCaptureKey(real: RealInput): string {
	if (!isTouch()) return clickKey().Name;
	frames(6);
	hold(real, [K.H]);
	lifted(real, K.H);
	return "H";
}

/** What the engine reports down right now: keys and mouse buttons 1 and 2 */
function downNow() {
	const keys = UserInputService.GetKeysPressed().map((input) => input.KeyCode.Name);
	const mouse1 = UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton1);
	const mouse2 = UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton2);
	return `keys ${keys.size() === 0 ? "none" : keys.join(",")}, MB1 ${mouse1}, MB2 ${mouse2}`;
}

/** The gameProcessed flag of every InputBegan of a click or tap until the test ends */
function watchClicks(): string[] {
	const seen = new Array<string>();
	const connection = UserInputService.InputBegan.Connect((inputObject, processed) => {
		const kind = inputObject.UserInputType;
		if (
			kind === Enum.UserInputType.MouseButton1 ||
			kind === Enum.UserInputType.MouseButton2 ||
			kind === Enum.UserInputType.Touch
		) {
			const since = math.floor((os.clock() - lastFocusRelease) * 1000);
			const focused = UserInputService.GetFocusedTextBox() !== undefined;
			seen.push(
				`${kind.Name}:${processed} (focused ${focused}, ${since} ms after a focus release)`,
			);
		}
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
 * game-processed key or a click is typing
 */
function clearOfTyping() {
	while (os.clock() - lastFocusRelease < 0.15) frames(1);
}

/** Waits 0.15 s from now */
function pause(seconds = 0.15) {
	const deadline = os.clock() + seconds;
	while (os.clock() < deadline) frames(1);
}

/** Every InputBegan ("B") and InputEnded ("E") of `key` until the test ends, with gameProcessed */
function watchKey(key: Enum.KeyCode): string[] {
	const seen = new Array<string>();
	const began = UserInputService.InputBegan.Connect((inputObject, processed) => {
		if (inputObject.KeyCode !== key) return;
		const kind = ClassifyCaptureInput(key, processed, []);
		const box = UserInputService.GetFocusedTextBox();
		const [, boxName] = pcall(() => box?.GetFullName() ?? "none");
		const since = math.floor((os.clock() - lastFocusRelease) * 1000);
		seen.push(`B:${processed} as ${kind} (focused ${boxName}, ${since} ms after a focus release)`);
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

function newTextBox(gui: ScreenGui = testGui("HunterChord4TextBox")) {
	const box = new Instance("TextBox");
	box.Size = UDim2.fromOffset(200, 50);
	box.Position = UDim2.fromScale(0.3, 0.6);
	box.Text = "";
	box.ClearTextOnFocus = false;
	box.Parent = gui;
	defer(() => {
		if (box.Parent !== undefined) box.ReleaseFocus();
	});
	return box;
}

let sinkCount = 0;
/** A ContextActionService action that sinks `keys`, as a game's own CAS bindings do */
function casSink(keys: Enum.KeyCode[]) {
	sinkCount++;
	const name = `HunterChord4Sink${sinkCount}`;
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
 * The two captures a test starts: `Capture("KeyCode")` on Jump's keyboard binding and
 * `CaptureChord` on Crouch's, both Bool, so the same key can be checked against both
 */
function startBoth(
	input: ReturnType<typeof createTestInput>,
	captured: Enum.KeyCode[],
	outcomes: Outcome[],
	cancel: Enum.KeyCode[] = [],
) {
	const stopOne = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Capture(
		"KeyCode",
		(key) => captured.push(key ?? K.Unknown),
		{ Cancel: cancel },
	);
	const stopChord = input.Gameplay.Actions.Crouch.Bindings.KeyboardAndMouse.CaptureChord(
		(chord) => outcomes.push({ chord }),
		{ Cancel: cancel },
	);
	defer(() => {
		stopOne();
		stopChord();
	});
}

function both(captured: Enum.KeyCode[], outcomes: Outcome[]) {
	return `Capture ${names(captured)}; chord ${describeAll(outcomes)}`;
}

/**
 * Fire on H too (its keyboard binding, which no capture here uses): how many times IAS pressed it,
 * until the test ends
 */
function iasOnH(input: ReturnType<typeof createTestInput>) {
	const fire = input.Gameplay.Actions.Fire;
	fire.Bindings.KeyboardAndMouse.Set(K.H);
	const counter = { count: 0 };
	const connection = fire.Pressed.Connect(() => counter.count++);
	defer(() => connection.Disconnect());
	return counter;
}

/** Presses and releases `key`, or the reason VirtualInput refused it */
function tryTap(real: RealInput, key: Enum.KeyCode): string | undefined {
	const [pressed, problem] = pcall(() => real.Press(key));
	if (!pressed) return tostring(problem);
	frames(2);
	const [released, releaseProblem] = pcall(() => real.Release(key));
	frames(2);
	return released ? undefined : tostring(releaseProblem);
}

/**
 * Hunter round 4 on `CaptureChord` and `Capture` after round 3 (`IsTyping` for anything while a
 * TextBox has focus, clicks within TYPING_GRACE, the pointer twin in `KeysDownNow`): TextBoxes that
 * go away while focused, the chat bar, a capture started from a click away, mouse buttons held at
 * the start. Real keys through VirtualInput, clear of what the player scripts sink.
 */
@Provider({ activeIn: ["testing"] })
export class HunterChord4Tests implements OnStart {
	onStart() {
		defineTests("hunter-chord-4", () => {
			// First in the section, so that run alone it is the session's first capture (the
			// TextBoxFocusReleased watch is connected by the first capture, inside FocusLost here)
			test("a capture started from a TextBox's FocusLost (a click away ends it) doesn't take that click", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const box = newTextBox();
				const problem = clickProblem(box);
				if (problem !== undefined) return skip(problem);
				const processed = watchClicks();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const lost = box.FocusLost.Connect((enterPressed) => {
					if (state !== "?") return;
					state = `enterPressed ${enterPressed}, ${downNow()}`;
					startBoth(input, captured, outcomes);
				});
				defer(() => lost.Disconnect());
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(3);
				real.Click(emptyPoint());
				if (!waitFor(() => state !== "?"))
					return skip("a click away doesn't take the TextBox's focus here");
				frames(6);
				const afterStart = both(captured, outcomes);
				clearOfTyping();
				real.Click(emptyPoint());
				const key = clickCaptureKey(real);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterStart}; then ${both(captured, outcomes)}`,
					`Capture nothing; chord nothing; then Capture ${key}; chord -+-+${key}`,
					`in FocusLost: ${state}; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
			});

			// ---- a TextBox that goes away while it has focus

			// What the captures hear should match what IAS hears: a binding on H fires or doesn't
			test("a TextBox destroyed while it has focus: the captures hear H as IAS does", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const fired = iasOnH(input);
				const box = newTextBox();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				startBoth(input, captured, outcomes);
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				box.Destroy();
				frames(4);
				const focusedAfter = UserInputService.GetFocusedTextBox() !== undefined;
				pause();
				const events = watchKey(K.H);
				hold(real, [K.H]);
				frames(3);
				lifted(real, K.H);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1, 1);
				expectEqual(
					both(captured, outcomes),
					fired.count > 0 ? "Capture H; chord -+-+H" : "Capture nothing; chord nothing",
					`IAS pressed on H ${fired.count} time(s); a TextBox focused after the destroy ${focusedAfter}; H's events ${events.join(", ")}${real.FocusNote()}`,
				);
			});

			test("a TextBox whose ScreenGui is disabled while it has focus: the captures hear H as IAS does", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const fired = iasOnH(input);
				const gui = testGui("HunterChord4Hidden");
				const box = newTextBox(gui);
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				startBoth(input, captured, outcomes);
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				gui.Enabled = false;
				frames(4);
				const focusedAfter = UserInputService.GetFocusedTextBox() !== undefined;
				pause();
				const events = watchKey(K.H);
				hold(real, [K.H]);
				frames(3);
				lifted(real, K.H);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1, 1);
				expectEqual(
					both(captured, outcomes),
					fired.count > 0 ? "Capture H; chord -+-+H" : "Capture nothing; chord nothing",
					`IAS pressed on H ${fired.count} time(s); a TextBox focused after hiding ${focusedAfter}; text "${box.Text}"; H's events ${events.join(", ")}${real.FocusNote()}`,
				);
			});

			// ---- the chat bar: a TextBox of Roblox's own

			test("typing in the chat bar (Slash opens it) is no part of a capture, Cancel keys included", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const config = TextChatService.FindFirstChildOfClass("ChatInputBarConfiguration");
				const chatInfo = `ChatVersion ${TextChatService.ChatVersion.Name}, input bar ${config?.Enabled}`;
				if (config === undefined) return skip(`no ChatInputBarConfiguration here (${chatInfo})`);
				const chatFocused = () =>
					config.IsFocused || UserInputService.GetFocusedTextBox() !== undefined;
				defer(() => {
					if (!chatFocused()) return;
					// out of the chat bar, so later tests' keys aren't typed into it
					config.Enabled = false;
					frames(2);
					config.Enabled = true;
					frames(2);
					if (chatFocused()) pcall(() => real.Click(emptyPoint()));
				});
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				startBoth(input, captured, outcomes, [K.Delete]);
				const deleteEvents = watchKey(K.Delete);
				const slashProblem = tryTap(real, K.Slash);
				if (slashProblem !== undefined)
					return skip(`VirtualInput won't send Slash: ${slashProblem}`);
				if (!waitFor(chatFocused))
					return skip(`Slash doesn't open the chat bar here (${chatInfo})`);
				const seen = `${chatInfo}; IsFocused ${config.IsFocused}, GetFocusedTextBox while chatting: ${UserInputService.GetFocusedTextBox() !== undefined}`;
				frames(3);
				const typeProblem =
					tryTap(real, K.G) ?? tryTap(real, K.Delete) ?? tryTap(real, K.Backspace);
				frames(4);
				const typed = both(captured, outcomes);
				// out of the chat bar with Return, its text empty: no message is sent
				const returnProblem = tryTap(real, K.Return);
				const closed = waitFor(() => !chatFocused());
				pause(0.2);
				hold(real, [K.H]);
				lifted(real, K.H);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`typed: ${typed}; then ${both(captured, outcomes)}`,
					"typed: Capture nothing; chord nothing; then Capture H; chord -+-+H",
					`${seen}; typing ${typeProblem ?? "sent"}; Return ${returnProblem ?? "sent"}, chat closed ${closed}; Delete's events ${deleteEvents.join(", ")}${real.FocusNote()}`,
				);
			});

			// ---- clicks within TYPING_GRACE

			// Advanced.md: "nor what ends the typing (Return, Escape, a click or tap away), which
			// arrives just after the focus is gone. Other keys count again at once." A focus released
			// by a script has no click ending it
			// HC4-1 (hunter): a click within TYPING_GRACE (0.1 s) after any focus release is dropped, also
			// when no click ended the typing (a script's ReleaseFocus). Resolved in the docs, worker: a
			// capture can't tell what released the focus, so Advanced.md now says that for 0.1 s after a
			// TextBox loses focus, however it lost it, clicks and game-processed input are typing. This
			// test checks that, and that a click after the window counts
			test("a click within 0.1 s after a script releases a TextBox's focus is typing; a later click counts", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const box = newTextBox();
				const processed = watchClicks();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				startBoth(input, captured, outcomes);
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				const releasedAt = os.clock();
				box.ReleaseFocus();
				// the release is through (TextBoxFocusReleased has run) and stays
				eventually(() => lastFocusRelease >= releasedAt, "TextBoxFocusReleased");
				frames(1);
				if (UserInputService.GetFocusedTextBox() !== undefined)
					return skip("the TextBox took the focus back after ReleaseFocus");
				const beforeClick = `${math.floor((os.clock() - lastFocusRelease) * 1000)} ms after the release`;
				real.Click(emptyPoint());
				frames(4);
				expectEqual(
					both(captured, outcomes),
					"Capture nothing; chord nothing",
					`a click ${beforeClick} is typing; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
				clearOfTyping();
				real.Click(emptyPoint());
				const key = clickCaptureKey(real);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1, 1);
				expectEqual(
					both(captured, outcomes),
					`Capture ${key}; chord -+-+${key}`,
					`a click after the window counts; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
			});

			// Capturing a chord: "A key the game takes while it is held in a chord ... makes the chord
			// one the binding can't hold: Ctrl+Left is ignored, not recorded as LeftControl alone"
			test("Ctrl held, a script releases a TextBox's focus, then a sunk key: the chord is refused", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				casSink([K.K]);
				const box = newTextBox();
				const events = watchKey(K.K);
				let kSawFocus = false;
				const kWatch = UserInputService.InputBegan.Connect((inputObject) => {
					if (inputObject.KeyCode === K.K && UserInputService.GetFocusedTextBox() !== undefined)
						kSawFocus = true;
				});
				defer(() => kWatch.Disconnect());
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl]);
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				const releasedAt = os.clock();
				box.ReleaseFocus();
				// the release is through (TextBoxFocusReleased has run) and stays
				eventually(() => lastFocusRelease >= releasedAt, "TextBoxFocusReleased");
				frames(1);
				if (UserInputService.GetFocusedTextBox() !== undefined)
					return skip("the TextBox took the focus back after ReleaseFocus");
				const beforeK = `focused before K ${UserInputService.GetFocusedTextBox() !== undefined}, ${math.floor((os.clock() - lastFocusRelease) * 1000)} ms after the release`;
				real.Press(K.K);
				landed(real, K.K);
				frames(2);
				lifted(real, K.K);
				frames(3);
				lifted(real, K.LeftControl);
				frames(6);
				// Measured in all six projects: at K's InputBegan Roblox still reports the TextBox focused
				// (a few ms after the release), so K is typing by the documented rule, not by the grace
				if (kSawFocus)
					return skip(
						`Roblox still reports the TextBox focused at K's InputBegan: ${events.join(", ")}`,
					);
				expectEqual(
					`${describeAll(outcomes)}; binding ${keys.Instance.PrimaryModifier.Name}+${keys.Instance.KeyCode.Name}`,
					"nothing; binding None+Space",
					`${beforeK}; text "${box.Text}"; K's events ${events.join(", ")}${real.FocusNote()}`,
				);
			});

			// ---- mouse buttons held at the start (the pointer twin)

			test("a right click held at the start: its release settles nothing, and it counts once pressed again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				if (isTouch()) return skip("a right click is a mouse's");
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const processed = watchClicks();
				real.MouseDown(emptyPoint(), Enum.UserInputType.MouseButton2);
				eventually(
					() => UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton2),
					"the right button is down",
				);
				frames(2);
				const atStart = downNow();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				startBoth(input, captured, outcomes);
				frames(2);
				real.MouseUp(Enum.UserInputType.MouseButton2);
				frames(6);
				const afterRelease = both(captured, outcomes);
				real.MouseDown(emptyPoint(), Enum.UserInputType.MouseButton2);
				frames(3);
				real.MouseUp(Enum.UserInputType.MouseButton2);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterRelease}; then ${both(captured, outcomes)}`,
					"Capture nothing; chord nothing; then Capture MouseRightButton; chord -+-+MouseRightButton",
					`at the start: ${atStart}; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
			});

			test("mouse button 1 held at the start, then a right click while it is held: the right click", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				if (isTouch()) return skip("a right click is a mouse's");
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const processed = watchClicks();
				real.MouseDown(emptyPoint());
				eventually(
					() => UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton1),
					"button 1 is down",
				);
				frames(2);
				const atStart = downNow();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				startBoth(input, captured, outcomes);
				frames(2);
				real.MouseDown(emptyPoint(), Enum.UserInputType.MouseButton2);
				frames(3);
				real.MouseUp(Enum.UserInputType.MouseButton2);
				frames(4);
				real.MouseUp();
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					both(captured, outcomes),
					"Capture MouseRightButton; chord -+-+MouseRightButton",
					`at the start: ${atStart}; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
			});

			test("mouse button 1 (a finger) held at the start, lifted, then Ctrl and a click: Ctrl+click", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const processed = watchClicks();
				real.MouseDown(emptyPoint());
				frames(4);
				const atStart = downNow();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				const chordKeys = input.Gameplay.Actions.Crouch.Bindings.KeyboardAndMouse;
				const stop = chordKeys.CaptureChord((chord) => outcomes.push({ chord }));
				defer(stop);
				frames(2);
				real.MouseUp();
				frames(6);
				const afterRelease = describeAll(outcomes);
				hold(real, [K.LeftControl]);
				real.MouseDown(emptyPoint());
				frames(3);
				real.MouseUp();
				// on the phone the tap is no key of the keyboard's chord (0.7.0): Ctrl alone settles it
				if (isTouch()) {
					frames(6);
					lifted(real, K.LeftControl);
				}
				waitFor(() => outcomes.size() >= 1);
				real.ReleaseAll();
				const chord = isTouch() ? "-+-+LeftControl" : `LeftControl+-+${clickKey().Name}`;
				expectEqual(
					`${afterRelease}; then ${describeAll(outcomes)}`,
					`nothing; then ${chord}`,
					`at the start: ${atStart}; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
			});

			// ---- a rebinding UI: a search box, then a Rebind button

			test("a Rebind button clicked out of a search box: a later click is captured", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const gui = testGui("HunterChord4Rebind");
				const box = newTextBox(gui);
				const button = testButton(gui, "Rebind");
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const processed = watchClicks();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const connection = button.Activated.Connect(() => {
					if (state !== "?") return;
					state = `${downNow()}, focused ${UserInputService.GetFocusedTextBox() !== undefined}`;
					startBoth(input, captured, outcomes);
				});
				defer(() => connection.Disconnect());
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				real.Click(screenCenter(button));
				eventually(() => state !== "?", `the click activates the button${real.FocusNote()}`);
				pause(0.2);
				const afterStart = both(captured, outcomes);
				real.Click(emptyPoint());
				const key = clickCaptureKey(real);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterStart}; then ${both(captured, outcomes)}`,
					`Capture nothing; chord nothing; then Capture ${key}; chord -+-+${key}`,
					`in Activated: ${state}; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
			});

			// ---- captures started from a handler that runs at a click's release (pointer up)

			// A custom button: a GUI object's InputEnded of a click or tap activates it
			test("a capture started from a GUI object's InputEnded of a click (a custom button) takes the next click", () => {
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
				label.Parent = testGui("HunterChord4Label");
				const problem = clickProblem(label);
				if (problem !== undefined) return skip(problem);
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const connection = label.InputEnded.Connect((inputObject) => {
					const kind = inputObject.UserInputType;
					if (kind !== Enum.UserInputType.MouseButton1 && kind !== Enum.UserInputType.Touch) return;
					if (state !== "?") return;
					state = `${kind.Name}, ${downNow()}`;
					startBoth(input, captured, outcomes);
				});
				defer(() => connection.Disconnect());
				real.Click(screenCenter(label));
				eventually(() => state !== "?", `the label's InputEnded${real.FocusNote()}`);
				frames(6);
				const afterStart = both(captured, outcomes);
				real.Click(emptyPoint());
				const key = clickCaptureKey(real);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterStart}; then ${both(captured, outcomes)}`,
					`Capture nothing; chord nothing; then Capture ${key}; chord -+-+${key}`,
					`in InputEnded: ${state}; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
			});

			test("a capture started from UserInputService.InputEnded of a click (tap) takes the next click", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const processed = watchClicks();
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const connection = UserInputService.InputEnded.Connect((inputObject) => {
					const kind = inputObject.UserInputType;
					if (kind !== Enum.UserInputType.MouseButton1 && kind !== Enum.UserInputType.Touch) return;
					if (state !== "?") return;
					state = `${kind.Name}, ${downNow()}`;
					startBoth(input, captured, outcomes);
				});
				defer(() => connection.Disconnect());
				real.Click(emptyPoint());
				eventually(() => state !== "?", `InputEnded of the click${real.FocusNote()}`);
				frames(6);
				const afterStart = both(captured, outcomes);
				real.Click(emptyPoint());
				const key = clickCaptureKey(real);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterStart}; then ${both(captured, outcomes)}`,
					`Capture nothing; chord nothing; then Capture ${key}; chord -+-+${key}`,
					`in InputEnded: ${state}; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
			});

			test("a capture started from a ClickDetector's MouseClick takes the next click", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				clearOfTyping();
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const processed = watchClicks();
				const camera = Workspace.CurrentCamera!;
				const viewport = camera.ViewportSize;
				const ray = camera.ViewportPointToRay(viewport.X * 0.65, viewport.Y * 0.3);
				const part = new Instance("Part");
				part.Anchored = true;
				part.CanCollide = false;
				part.Size = new Vector3(40, 40, 1);
				part.CFrame = CFrame.lookAt(ray.Origin.add(ray.Direction.mul(8)), ray.Origin);
				const detector = new Instance("ClickDetector");
				detector.MaxActivationDistance = 1000;
				detector.Parent = part;
				part.Parent = Workspace;
				defer(() => part.Destroy());
				const captured = new Array<Enum.KeyCode>();
				const outcomes = new Array<Outcome>();
				let state = "?";
				const connection = detector.MouseClick.Connect(() => {
					if (state !== "?") return;
					state = downNow();
					startBoth(input, captured, outcomes);
				});
				defer(() => connection.Disconnect());
				frames(3);
				real.Click(emptyPoint());
				if (!waitFor(() => state !== "?", 1))
					return skip(
						`a click doesn't fire a local ClickDetector here; clicks ${processed.join(", ")}`,
					);
				frames(6);
				const afterStart = both(captured, outcomes);
				part.Destroy();
				frames(2);
				real.Click(emptyPoint());
				const key = clickCaptureKey(real);
				waitFor(() => captured.size() >= 1 && outcomes.size() >= 1);
				expectEqual(
					`${afterStart}; then ${both(captured, outcomes)}`,
					`Capture nothing; chord nothing; then Capture ${key}; chord -+-+${key}`,
					`in MouseClick: ${state}; clicks ${processed.join(", ")}${real.FocusNote()}`,
				);
			});
		});
	}
}
