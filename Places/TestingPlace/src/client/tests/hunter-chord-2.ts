import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectFalse,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions, InputCatcher } from "@rbxts/input-actions";
import { ContextActionService, GuiService, UserInputService } from "@rbxts/services";
import { countSignal, createTestInput, frames, newFolder } from "./helpers";
import { clickProblem, RealInput, realInput, testButton, testGui } from "./virtual";

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

let sinkCount = 0;
/**
 * A ContextActionService action that sinks `keys`, as a game's own CAS bindings do (a sprint on
 * Shift, the legacy shift lock, the legacy camera's I/O/Left/Right). Unbound after the test.
 */
function casSink(keys: Enum.KeyCode[], onBegin?: (key: Enum.KeyCode) => void) {
	sinkCount++;
	const name = `HunterChord2Sink${sinkCount}`;
	ContextActionService.BindActionAtPriority(
		name,
		(_, state, inputObject) => {
			if (state === Enum.UserInputState.Begin && onBegin !== undefined)
				onBegin(inputObject.KeyCode);
			return Enum.ContextActionResult.Sink;
		},
		false,
		4000,
		...keys,
	);
	defer(() => ContextActionService.UnbindAction(name));
}

/** The gameProcessed flag of every InputBegan of `key` until the test ends */
function watchProcessed(key: Enum.KeyCode): string[] {
	const seen = new Array<string>();
	const connection = UserInputService.InputBegan.Connect((inputObject, processed) => {
		if (inputObject.KeyCode === key) seen.push(tostring(processed));
	});
	defer(() => connection.Disconnect());
	return seen;
}

function newTextBox() {
	const box = new Instance("TextBox");
	box.Size = UDim2.fromOffset(200, 50);
	box.Position = UDim2.fromScale(0.3, 0.6);
	box.Text = "";
	box.ClearTextOnFocus = false;
	box.Parent = testGui("HunterChord2TextBox");
	defer(() => box.ReleaseFocus());
	return box;
}

/** Selects a fresh button (Roblox's keyboard/gamepad UI navigation); the reason when it can't */
function selectButton(): TextButton | string {
	const button = testButton(testGui("HunterChord2Select"));
	const problem = clickProblem(button);
	if (problem !== undefined) return problem;
	defer(() => {
		GuiService.SelectedObject = undefined;
	});
	GuiService.SelectedObject = button;
	frames(3);
	if (GuiService.SelectedObject !== button) return "the button can't be selected here";
	return button;
}

/**
 * Hunter round 2 on `CaptureChord` and the changed `Capture` path (0.6.1, after HC-2's
 * `ClassifyCaptureInput`): game-processed keys, Cancel keys, TextBox focus and GUI selection. Real keys
 * through VirtualInput, picked clear of what the player scripts sink or toggle.
 */
@Provider({ activeIn: ["testing"] })
export class HunterChord2Tests implements OnStart {
	onStart() {
		defineTests("hunter-chord-2", () => {
			// ---- the HC-2 dispute: does a CAS sink block IAS for its keys?

			test("premise: with an InputCatcher grabbing, an IAS binding on the key doesn't fire", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump;
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				const pressed = countSignal(jump.Pressed);
				const processed = watchProcessed(K.G);
				const catcher = new InputCatcher(5000);
				defer(() => catcher.ReleaseInput());
				catcher.GrabInput();
				frames(2);
				hold(real, [K.G]);
				frames(6);
				const blocked = `${jump.IsPressed()}/${pressed.count}`;
				lifted(real, K.G);
				catcher.ReleaseInput();
				frames(3);
				hold(real, [K.G]);
				eventually(
					() => jump.IsPressed(),
					`G presses Jump once the catcher lets go${real.FocusNote()}`,
				);
				lifted(real, K.G);
				expectEqual(blocked, "false/0", `the catcher's G (gameProcessed ${processed.join(",")})`);
			});

			// The worker's reason for keeping CAS-sunk keys out of a capture: "a CAS Sink blocks IAS for
			// that key, so a binding on it couldn't fire either". A modifier is read differently from the
			// key it modifies: does an IAS chord fire when only its modifier is sunk?
			test("premise for a modifier: an IAS chord whose modifier a CAS action sinks doesn't fire", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump;
				jump.Bindings.KeyboardAndMouse.Set({ KeyCode: K.G, PrimaryModifier: K.LeftControl });
				const pressed = countSignal(jump.Pressed);
				const processed = watchProcessed(K.LeftControl);
				// control: without the sink the chord fires
				hold(real, [K.LeftControl, K.G]);
				eventually(() => jump.IsPressed(), `Ctrl+G presses Jump${real.FocusNote()}`);
				real.ReleaseAll();
				eventually(() => !jump.IsPressed(), "released");
				frames(4);
				const before = pressed.count;
				casSink([K.LeftControl]);
				frames(2);
				hold(real, [K.LeftControl, K.G]);
				frames(6);
				const fired = jump.IsPressed() || pressed.count > before;
				real.ReleaseAll();
				frames(4);
				expectFalse(
					fired,
					`Ctrl+G fired Jump with Ctrl sunk (gameProcessed ${processed.join(",")})`,
				);
			});

			// HC2-1 (hunter, fixed: a chord with a key the game took is refused): a key a CAS action sinks, pressed in a chord, is dropped, and the keys left make a chord the player didn't press (plain LeftControl for Ctrl+K)
			test("a sunk key pressed in a chord doesn't leave the other keys to make a chord of their own", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Crouch.Bindings.KeyboardAndMouse;
				casSink([K.K]);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.K]);
				lifted(real, K.K);
				frames(3);
				lifted(real, K.LeftControl);
				frames(6);
				const recorded = describeAll(outcomes);
				expectFalse(
					recorded === "-+-+LeftControl",
					`Ctrl then K (sunk) recorded ${recorded}; the binding is ${keys.Instance.KeyCode.Name}+${keys.Instance.PrimaryModifier.Name}`,
				);
			});

			// HC2-1 (hunter, fixed; a sunk modifier): Ctrl (sunk) then G records plain G, the modifiers cleared
			test("a sunk modifier pressed in a chord doesn't leave its key to be recorded alone", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Crouch.Bindings.KeyboardAndMouse;
				casSink([K.LeftControl]);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Timeout: 3 });
				hold(real, [K.LeftControl, K.G]);
				lifted(real, K.G);
				eventually(() => outcomes.size() >= 1, `the capture settles${real.FocusNote()}`, 4);
				real.ReleaseAll();
				const recorded = describeAll(outcomes);
				const shiftActions = new Array<string>();
				for (const [name, info] of pairs(ContextActionService.GetAllBoundActionInfo())) {
					const inputs = (info as { inputTypes?: defined[] }).inputTypes;
					if (inputs !== undefined && inputs.includes(K.LeftShift))
						shiftActions.push(tostring(name));
				}
				expectFalse(
					recorded === "-+-+G",
					`Ctrl (sunk) then G recorded ${recorded}; the binding is ${keys.Instance.PrimaryModifier.Name}+${keys.Instance.KeyCode.Name}; CAS actions on LeftShift here: ${shiftActions.size() === 0 ? "none" : shiftActions.join(",")}`,
				);
			});

			test("a capture started from an IAS action's Pressed, its key a Cancel key, isn't cancelled by that press", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const keys = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				let starts = 0;
				const connection = input.Gameplay.Actions.Crouch.Pressed.Connect(() => {
					starts++;
					if (starts === 1)
						keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.C] });
				});
				defer(() => connection.Disconnect());
				real.Press(K.C);
				eventually(() => starts === 1, `Crouch pressed${real.FocusNote()}`);
				frames(4);
				lifted(real, K.C);
				frames(4);
				const afterStart = describeAll(outcomes);
				real.Tap(K.H);
				eventually(() => outcomes.size() >= 1, `H settles it${real.FocusNote()}`);
				expectEqual(`${afterStart}; then ${describeAll(outcomes)}`, "nothing; then -+-+H");
			});

			// ---- Cancel keys

			test("the docs' example: Backspace as the Cancel key ends CaptureChord and Capture", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const processed = watchProcessed(K.Backspace);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), {
					Cancel: [K.Backspace],
					Timeout: 5,
				});
				real.Tap(K.Backspace);
				eventually(
					() => outcomes.size() === 1,
					`Backspace ends it (gameProcessed: ${processed.join(",")})${real.FocusNote()}`,
				);
				expectEqual(describe(outcomes[0].chord), "undefined");
				// Capture calls back with undefined on a Cancel key, as CaptureChord does
				const captured = new Array<string>();
				const stop = keys.Capture("KeyCode", (key) => captured.push(key?.Name ?? "undefined"), {
					Cancel: [K.Backspace],
				});
				defer(stop);
				real.Tap(K.Backspace);
				frames(3);
				real.Tap(K.G);
				frames(3);
				expectEqual(
					captured.join(","),
					"undefined",
					`Backspace ended Capture (gameProcessed: ${processed.join(",")})`,
				);
				expectEqual(keys.Instance.KeyCode, K.Space);
			});

			test("a Cancel key pressed inside a chord ends it with nothing applied", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Delete] });
				hold(real, [K.LeftControl, K.Delete]);
				eventually(() => outcomes.size() === 1, `Delete ends it${real.FocusNote()}`);
				real.ReleaseAll();
				frames(4);
				expectEqual(describeAll(outcomes), "undefined");
				expectEqual(keys.Instance.KeyCode, K.Space);
				expectEqual(keys.Instance.PrimaryModifier, K.None);
			});

			test("a Cancel key a CAS action sinks, pressed while chord keys are held, ends it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				casSink([K.Delete]);
				const processed = watchProcessed(K.Delete);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Delete] });
				hold(real, [K.LeftControl, K.G]);
				real.Tap(K.Delete);
				eventually(
					() => outcomes.size() === 1,
					`Delete (gameProcessed ${processed.join(",")}) ends it${real.FocusNote()}`,
				);
				real.ReleaseAll();
				frames(4);
				expectEqual(describeAll(outcomes), "undefined");
				expectEqual(keys.Instance.KeyCode, K.Space);
			});

			// The HC-2 fix hears a game-processed Cancel key. A capture started from a CAS action's
			// handler (a game's "rebind" key) is connected before UserInputService fires InputBegan for
			// the key that started it.
			test("a capture started from a CAS action on its own Cancel key isn't cancelled by that press", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				let starts = 0;
				casSink([K.Delete], () => {
					starts++;
					if (starts === 1)
						keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Delete] });
				});
				real.Press(K.Delete);
				eventually(() => starts === 1, `the CAS action ran${real.FocusNote()}`);
				frames(4);
				lifted(real, K.Delete);
				frames(4);
				const afterStart = describeAll(outcomes);
				real.Tap(K.G);
				eventually(() => outcomes.size() >= 1, `G settles it${real.FocusNote()}`);
				// HC2-2 (hunter, fixed: keys down when a capture starts count only once they have come up): the CAS-sunk press that started the capture cancels it at once (since HC-2's fix)
				expectEqual(
					`${afterStart}; then ${describeAll(outcomes)}`,
					"nothing; then -+-+G",
					"the starting press is no part of the capture",
				);
			});

			test("Capture started from a CAS action on its own Cancel key isn't cancelled by that press", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const captured = new Array<Enum.KeyCode>();
				let starts = 0;
				let stop: (() => void) | undefined;
				defer(() => stop?.());
				casSink([K.Delete], () => {
					starts++;
					if (starts === 1)
						stop = keys.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown), {
							Cancel: [K.Delete],
						});
				});
				real.Press(K.Delete);
				eventually(() => starts === 1, `the CAS action ran${real.FocusNote()}`);
				frames(4);
				lifted(real, K.Delete);
				frames(4);
				real.Tap(K.G);
				frames(4);
				// HC2-2 (hunter, fixed; Capture): the same
				expectEqual(
					captured.size() === 0 ? "nothing" : captured.map((key) => key.Name).join(","),
					"G",
					`the starting press is no part of the capture; the binding is ${keys.Instance.KeyCode.Name}`,
				);
			});

			// ---- TextBox focus

			test("while a TextBox has focus a Cancel key is typing; once it lets go, keys count again", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const box = newTextBox();
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Delete] });
				let captured = 0;
				const stop = keys.Capture("PrimaryModifier", () => captured++, { Cancel: [K.Delete] });
				defer(stop);
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				real.Tap(K.Delete);
				real.Tap(K.G);
				frames(4);
				expectEqual(describeAll(outcomes), "nothing", "typed: Delete and G go to the TextBox");
				expectEqual(captured, 0, "Capture: the same");
				box.ReleaseFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === undefined, "focus released");
				frames(3);
				real.Tap(K.H);
				eventually(() => outcomes.size() === 1 && captured === 1, `H counts${real.FocusNote()}`);
				expectEqual(describe(outcomes[0].chord), "-+-+H");
			});

			test("focus taken mid-chord: a Cancel key typed then doesn't end it, and the chord goes on after", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const box = newTextBox();
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Delete] });
				hold(real, [K.LeftControl]);
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				real.Tap(K.Delete);
				frames(3);
				const typed = describeAll(outcomes);
				box.ReleaseFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === undefined, "focus released");
				frames(3);
				hold(real, [K.G]);
				lifted(real, K.G);
				eventually(() => outcomes.size() >= 1, `G settles it${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(`${typed}; then ${describeAll(outcomes)}`, "nothing; then LeftControl+-+G");
			});

			// Return in a TextBox submits it and takes its focus away: the press is typing
			test("Return typed into a focused TextBox (it submits) doesn't cancel, as a Cancel key", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const box = newTextBox();
				const processed = watchProcessed(K.Return);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Return] });
				const captured = new Array<string>();
				const stop = keys.Capture(
					"PrimaryModifier",
					(key) => captured.push(key?.Name ?? "cancelled"),
					{
						Cancel: [K.Return],
					},
				);
				defer(stop);
				let enter: boolean | undefined;
				const lost = box.FocusLost.Connect((enterPressed) => (enter = enterPressed));
				defer(() => lost.Disconnect());
				box.CaptureFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === box, "the TextBox has focus");
				frames(2);
				real.Tap(K.Return);
				eventually(() => enter !== undefined, `Return submits the TextBox${real.FocusNote()}`);
				frames(4);
				const afterReturn = describeAll(outcomes);
				real.Tap(K.H);
				frames(4);
				// HC2-3 (hunter, fixed: a key just after a TextBox loses focus is typing): Return typed into a focused TextBox (it submits) cancels both captures
				expectEqual(
					`chord ${afterReturn}; then ${describeAll(outcomes)}; Capture ${captured.size() === 0 ? "nothing" : captured.join(",")}`,
					"chord nothing; then -+-+H; Capture H",
					`enterPressed ${enter}, Return gameProcessed ${processed.join(",")}`,
				);
			});

			// ---- a GUI object selected (keyboard/gamepad UI navigation)

			test("with a GUI object selected: other keys are captured, Return isn't, and a Return Cancel ends both", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const selected = selectButton();
				if (typeIs(selected, "string")) return skip(selected);
				const processed = watchProcessed(K.Return);
				// keys other than navigation still count
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.G]);
				lifted(real, K.G);
				eventually(() => outcomes.size() === 1, `Ctrl+G while selected${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0].chord), "LeftControl+-+G");
				// Return activates the selected button: it isn't captured
				const plain = new Array<Outcome>();
				const stopPlain = keys.CaptureChord((chord) => plain.push({ chord }));
				defer(stopPlain);
				GuiService.SelectedObject = selected;
				frames(2);
				real.Tap(K.Return);
				frames(4);
				expectEqual(describeAll(plain), "nothing", `Return (gameProcessed ${processed.join(",")})`);
				stopPlain();
				// a Return Cancel ends both captures
				GuiService.SelectedObject = selected;
				frames(2);
				const cancelled = new Array<Outcome>();
				keys.CaptureChord((chord) => cancelled.push({ chord }), { Cancel: [K.Return] });
				const captured = new Array<string>();
				const stop = keys.Capture("KeyCode", (key) => captured.push(key?.Name ?? "undefined"), {
					Cancel: [K.Return],
				});
				defer(stop);
				real.Tap(K.Return);
				eventually(() => cancelled.size() === 1, `Return cancels${real.FocusNote()}`);
				expectEqual(describe(cancelled[0].chord), "undefined");
				real.Tap(K.H);
				frames(4);
				expectEqual(
					captured.join(","),
					"undefined",
					"Return ended Capture too, calling back with undefined",
				);
				expectEqual(keys.Instance.KeyCode, K.G);
			});

			test("a capture started from the selected button's Activated (Return) isn't cancelled by that Return", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const selected = selectButton();
				if (typeIs(selected, "string")) return skip(selected);
				const outcomes = new Array<Outcome>();
				let starts = 0;
				const connection = selected.Activated.Connect(() => {
					starts++;
					if (starts === 1)
						keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Return] });
				});
				defer(() => connection.Disconnect());
				real.Press(K.Return);
				frames(4);
				lifted(real, K.Return);
				eventually(() => starts >= 1, `Return activates the button${real.FocusNote()}`);
				frames(4);
				const afterStart = describeAll(outcomes);
				GuiService.SelectedObject = undefined;
				frames(2);
				real.Tap(K.H);
				eventually(() => outcomes.size() >= 1, `H settles it${real.FocusNote()}`);
				expectEqual(`${afterStart}; then ${describeAll(outcomes)}`, "nothing; then -+-+H");
			});
		});
	}
}
