import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectFalse,
	expectNoThrow,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions, InputCatcher } from "@rbxts/input-actions";
import { Players, ReplicatedStorage, UserInputService } from "@rbxts/services";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { countSignal, createTestInput, frames, newFolder, recordSignal } from "./helpers";
import { emptyPoint, RealInput, realInput, testGui } from "./virtual";

const K = Enum.KeyCode;

/** What a CaptureChord callback received, in order: `chord` is undefined for an end with nothing */
type Outcome = { chord?: InputActions.Chord };

/** Holds `keys` down in order, two frames apart */
function hold(real: RealInput, keys: Enum.KeyCode[]) {
	for (const key of keys) {
		real.Press(key);
		frames(2);
	}
}

/** Waits until the engine has `key` down (VirtualInput keys can land a few frames late) */
function landed(real: RealInput, key: Enum.KeyCode) {
	eventually(() => UserInputService.IsKeyDown(key), `${key.Name} is down${real.FocusNote()}`);
}

/** Waits a few frames and checks the callback stayed silent */
function staysSilent(outcomes: Outcome[], what: string, real: RealInput) {
	frames(6);
	expectEqual(
		outcomes.size(),
		0,
		`${what}: got ${outcomes.map((o) => describe(o.chord)).join(", ")}${real.FocusNote()}`,
	);
}

function describe(chord: InputActions.Chord | undefined) {
	if (chord === undefined) return "undefined";
	return `${chord.PrimaryModifier?.Name ?? "-"}+${chord.SecondaryModifier?.Name ?? "-"}+${chord.KeyCode.Name}`;
}

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(SA_REMOTE, 10),
		SA_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

const serverJump = () => server("state", "sa", "SaGameplay", "Jump");

/** SA_SCHEMA on the server's copy (the template binds Jump to F) */
function createSaInput() {
	expectTrue(server("provide", "sa") === true);
	const input = InputActions.Create(SA_SCHEMA, {
		Folder: server("templates") as Folder,
		ResetOnFocusLoss: false,
	});
	defer(() => input.Destroy());
	return input;
}

/** Leaves the server's Jump at rest after the test (as hunter-r1-sa.ts); call it first */
function settleServerAfter() {
	defer(() => {
		const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
		const { Jump } = input.SaGameplay.Actions;
		Jump.Fire(true);
		pcall(() => eventually(() => serverJump() === true, "the server's Jump held", 3));
		Jump.Fire(false);
		pcall(() => eventually(() => serverJump() === false, "the server's Jump at rest", 5));
		input.Destroy();
		frames(3);
	});
}

/** Checks for `seconds` that `read` keeps reading `value` */
function stays(read: () => unknown, value: unknown, what: string, seconds = 0.5) {
	const deadline = os.clock() + seconds;
	while (os.clock() < deadline) {
		const now = read();
		expectEqual(now, value, what);
		frames(2);
	}
}

let copyCount = 0;
/** The server's copy, played on the client in a player folder no server provides (as server-authority.ts) */
function localCopy(contextName: string, actionNames: string[]) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `InputsChordCopy${copyCount}`;
	const context = new Instance("InputContext");
	context.Name = contextName;
	for (const name of actionNames) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Type = Enum.InputActionType.Bool;
		action.Parent = context;
	}
	return {
		FolderName: folder.Name,
		Context: context,
		Arrive() {
			context.Parent = folder;
			folder.Parent = Players.LocalPlayer;
		},
		Action(name: string) {
			return context.FindFirstChild(name) as InputAction;
		},
		Cleanup: () => folder.Destroy(),
	};
}

/**
 * Hunter round on `CaptureChord` (0.6.1): adversarial tests with real keys through VirtualInput.
 * Keys are picked clear of what the player scripts sink or toggle and of the test schema's bindings.
 */
@Provider({ activeIn: ["testing"] })
export class HunterChordTests implements OnStart {
	onStart() {
		defineTests("hunter-chord", () => {
			// ---- starting a capture from input handlers

			test("a capture started inside InputBegan of a key doesn't take that key", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				let started = false;
				const connection = UserInputService.InputBegan.Connect((input, processed) => {
					if (processed || started || input.KeyCode !== K.R) return;
					started = true;
					keys.CaptureChord((chord) => outcomes.push({ chord }));
				});
				defer(() => connection.Disconnect());
				real.Press(K.R);
				eventually(() => started, `the capture started${real.FocusNote()}`);
				frames(2);
				real.Release(K.R);
				staysSilent(
					outcomes,
					"R was down before the capture began: its release settles nothing",
					real,
				);
				expectEqual(keys.Instance.KeyCode, K.Space, "the binding is untouched");
				real.Tap(K.H);
				eventually(() => outcomes.size() === 1, `H settles it${real.FocusNote()}`);
				expectEqual(describe(outcomes[0].chord), "-+-+H");
			});

			test("a capture started from an action's Pressed doesn't take the key that pressed it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const keys = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				let started = false;
				// Crouch is C: a "rebind" key in a real game
				const connection = input.Gameplay.Actions.Crouch.Pressed.Connect(() => {
					if (started) return;
					started = true;
					keys.CaptureChord((chord) => outcomes.push({ chord }));
				});
				defer(() => connection.Disconnect());
				real.Press(K.C);
				eventually(() => started, `the capture started${real.FocusNote()}`);
				frames(2);
				real.Release(K.C);
				staysSilent(
					outcomes,
					"C was down before the capture began: its release settles nothing",
					real,
				);
				expectEqual(keys.Instance.KeyCode, K.Space, "the binding is untouched");
				real.Tap(K.H);
				eventually(() => outcomes.size() === 1, `H settles it${real.FocusNote()}`);
				expectEqual(describe(outcomes[0].chord), "-+-+H");
			});

			test("a capture started in another's Cancel callback doesn't take the Cancel key", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const first = new Array<Outcome>();
				const second = new Array<Outcome>();
				keys.CaptureChord(
					(chord) => {
						first.push({ chord });
						// start over, as a rebinding UI might
						keys.CaptureChord((again) => second.push({ chord: again }));
					},
					{ Cancel: [K.Delete] },
				);
				real.Press(K.Delete);
				eventually(() => first.size() === 1, `the cancel${real.FocusNote()}`);
				expectEqual(first[0].chord, undefined);
				frames(2);
				real.Release(K.Delete);
				staysSilent(second, "Delete was down before the second capture began", real);
				expectEqual(keys.Instance.KeyCode, K.Space);
				real.Tap(K.J);
				eventually(() => second.size() === 1, `J settles the second${real.FocusNote()}`);
				expectEqual(describe(second[0].chord), "-+-+J");
			});

			test("a capture started in another's callback (timeout, keys still held) ignores those keys", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const actions = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions;
				const jumpKeys = actions.Jump.Bindings.KeyboardAndMouse;
				const crouchKeys = actions.Crouch.Bindings.KeyboardAndMouse;
				const first = new Array<Outcome>();
				const second = new Array<Outcome>();
				jumpKeys.CaptureChord(
					(chord) => {
						first.push({ chord });
						crouchKeys.CaptureChord((later) => second.push({ chord: later }));
					},
					{ Timeout: 0.5 },
				);
				hold(real, [K.LeftControl, K.G]);
				eventually(() => first.size() === 1, `the timeout${real.FocusNote()}`, 3);
				expectEqual(describe(first[0].chord), "LeftControl+-+G");
				real.Release(K.G);
				frames(2);
				real.Release(K.LeftControl);
				staysSilent(second, "the first chord's keys settle nothing in the second", real);
				expectEqual(crouchKeys.Instance.KeyCode, K.C);
				real.Tap(K.J);
				eventually(() => second.size() === 1, `J settles the second${real.FocusNote()}`);
				expectEqual(describe(second[0].chord), "-+-+J");
				expectEqual(crouchKeys.Instance.KeyCode, K.J);
			});

			// ---- callbacks that stop, destroy or raise

			test("stop() and Destroy() inside the callback are fine", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const keys = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				let problem: string | undefined;
				const stop: () => void = keys.CaptureChord((chord) => {
					outcomes.push({ chord });
					const [ok, message] = pcall(() => {
						stop();
						input.Destroy();
						stop();
					});
					if (!ok) problem = tostring(message);
				});
				real.Tap(K.G);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(problem, undefined);
				real.Tap(K.H);
				frames(4);
				expectEqual(outcomes.size(), 1);
			});

			test("a callback that raises: the chord stays applied and the capture is over", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				let calls = 0;
				keys.CaptureChord(() => {
					calls++;
					error("hunter-chord: a callback that raises (expected in the output)");
				});
				real.Tap(K.G);
				eventually(() => calls === 1, `the callback${real.FocusNote()}`);
				expectEqual(keys.Instance.KeyCode, K.G);
				real.Tap(K.H);
				frames(4);
				expectEqual(calls, 1);
				expectEqual(keys.Instance.KeyCode, K.G);
			});

			test("Destroy mid-capture without a Timeout: nothing applied, stop() after is fine", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const keys = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				const stop = keys.CaptureChord((chord) => outcomes.push({ chord }));
				real.Press(K.LeftControl);
				frames(2);
				input.Destroy();
				real.Tap(K.G);
				real.Release(K.LeftControl);
				frames(4);
				expectEqual(outcomes.size(), 0);
				expectNoThrow(stop);
			});

			test("Destroy of one of two root handles on a folder ends only its capture", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const a = createTestInput(folder);
				const b = createTestInput(folder);
				const aKeys = a.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const bKeys = b.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				expectEqual(aKeys.Instance, bKeys.Instance);
				const fromA = new Array<Outcome>();
				const fromB = new Array<Outcome>();
				aKeys.CaptureChord((chord) => fromA.push({ chord }));
				bKeys.CaptureChord((chord) => fromB.push({ chord }));
				a.Destroy();
				hold(real, [K.LeftControl, K.G]);
				real.Release(K.G);
				eventually(() => fromB.size() === 1, `b's callback${real.FocusNote()}`);
				frames(4);
				expectEqual(fromA.size(), 0);
				expectEqual(bKeys.Instance.KeyCode, K.G);
				expectEqual(bKeys.Instance.PrimaryModifier, K.LeftControl);
			});

			// ---- timeouts

			test("Timeout: a huge but finite number is accepted, and stop() ends it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				let stop: (() => void) | undefined;
				expectNoThrow(() => {
					stop = keys.CaptureChord((chord) => outcomes.push({ chord }), { Timeout: 1e300 });
				}, "Timeout 1e300 is positive and finite");
				expectDefined(stop)();
				real.Tap(K.G);
				frames(4);
				expectEqual(outcomes.size(), 0, "stopped");
				expectEqual(keys.Instance.KeyCode, K.Space);
			});

			test("Timeout: a tiny one ends at once with undefined; stop() after it does nothing", () => {
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				const stop = keys.CaptureChord((chord) => outcomes.push({ chord }), { Timeout: 1e-9 });
				eventually(() => outcomes.size() === 1, "the timeout", 2);
				expectEqual(outcomes[0].chord, undefined);
				expectNoThrow(stop);
				frames(3);
				expectEqual(outcomes.size(), 1);
			});

			test("Timeout after a refused chord, with only a leftover held, ends with undefined", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Timeout: 1 });
				hold(real, [K.G, K.H, K.J, K.K]);
				real.Release(K.K);
				real.Release(K.J);
				real.Release(K.H);
				// G, a leftover of the refused chord, is still held when the timeout runs out
				eventually(() => outcomes.size() === 1, `the timeout${real.FocusNote()}`, 3);
				expectEqual(describe(outcomes[0].chord), "undefined");
				expectEqual(keys.Instance.KeyCode, K.Space);
			});

			// ---- several captures

			test("two captures on one binding at once both settle on the same chord", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const keys = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const changes = recordSignal(input.BindingsChanged);
				const first = new Array<Outcome>();
				const second = new Array<Outcome>();
				keys.CaptureChord((chord) => first.push({ chord }));
				keys.CaptureChord((chord) => second.push({ chord }));
				hold(real, [K.LeftControl, K.G]);
				real.Release(K.LeftControl);
				eventually(
					() => first.size() === 1 && second.size() === 1,
					`both callbacks${real.FocusNote()}`,
				);
				expectEqual(describe(first[0].chord), "LeftControl+-+G");
				expectEqual(describe(second[0].chord), "LeftControl+-+G");
				expectEqual(keys.Instance.KeyCode, K.G);
				expectTrue(changes.size() >= 1);
			});

			test("Capture and CaptureChord at once: the chord ends as the binding", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const single = new Array<Enum.KeyCode>();
				const chords = new Array<Outcome>();
				keys.Capture("KeyCode", (key) => single.push(key));
				keys.CaptureChord((chord) => chords.push({ chord }));
				hold(real, [K.LeftControl, K.G]);
				real.Release(K.G);
				eventually(() => chords.size() === 1, `the chord${real.FocusNote()}`);
				expectEqual(single[0], K.LeftControl);
				expectEqual(describe(chords[0].chord), "LeftControl+-+G");
				expectEqual(keys.Instance.KeyCode, K.G);
				expectEqual(keys.Instance.PrimaryModifier, K.LeftControl);
			});

			// ---- the action held while the chord is written

			test("a chord that holds the action's own key: released once, then the chord presses it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				const released = countSignal(jump.Released);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.Space]);
				eventually(() => jump.IsPressed(), `Space presses Jump${real.FocusNote()}`);
				real.Release(K.LeftControl);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(describe(outcomes[0].chord), "LeftControl+-+Space");
				eventually(() => !jump.IsPressed(), "the rebind releases Jump");
				frames(4);
				expectEqual(released.count, 1, "one Released");
				real.Release(K.Space);
				frames(4);
				expectEqual(released.count, 1, "still one Released");
				hold(real, [K.LeftControl, K.Space]);
				eventually(() => jump.IsPressed(), `the chord presses Jump${real.FocusNote()}`);
				real.ReleaseAll();
				eventually(() => !jump.IsPressed(), "released");
			});

			// ---- devices

			test("gamepad KeyCodes (as VirtualInput sends them): a button is a modifier, a trigger isn't", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.Gamepad;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.ButtonL1, K.ButtonX]);
				real.Release(K.ButtonX);
				eventually(() => outcomes.size() === 1, `L1+X${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0].chord), "ButtonL1+-+ButtonX");
				expectEqual(keys.Instance.PrimaryModifier, K.ButtonL1);

				const again = new Array<Outcome>();
				keys.CaptureChord((chord) => again.push({ chord }));
				hold(real, [K.ButtonR2, K.ButtonX]);
				real.Release(K.ButtonX);
				staysSilent(again, "R2 (a trigger) can't be a modifier", real);
				real.Release(K.ButtonR2);
				staysSilent(again, "nor R2 alone after it", real);
				real.Tap(K.ButtonR2);
				eventually(() => again.size() === 1, `R2 alone${real.FocusNote()}`);
				expectEqual(describe(again[0].chord), "-+-+ButtonR2");
				expectEqual(keys.Instance.KeyCode, K.ButtonR2);
				expectEqual(keys.Instance.PrimaryModifier, K.None);
			});

			test("Bool: a key then a click records the click as the KeyCode (a tap on a phone: ignored)", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				real.Press(K.LeftControl);
				landed(real, K.LeftControl);
				frames(2);
				real.MouseDown(emptyPoint());
				frames(3);
				real.MouseUp();
				// a tap is touch's, which a keyboard-and-mouse binding never captures (0.7.0): on the
				// phone Ctrl alone settles the chord once it comes up
				const touch = getProject() === "touch";
				if (touch) {
					staysSilent(outcomes, "a tap is no key of the keyboard's chord", real);
					real.Release(K.LeftControl);
				}
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				real.ReleaseAll();
				const chord = expectDefined(outcomes[0].chord, "a chord");
				expectEqual(chord.KeyCode, touch ? K.LeftControl : K.MouseLeftButton);
				expectEqual(chord.PrimaryModifier, touch ? undefined : K.LeftControl);
			});

			test("Bool: a click alone records one key; a tap on a phone is ignored", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				real.MouseDown(emptyPoint());
				frames(3);
				real.MouseUp();
				if (getProject() === "touch") {
					// touch has no keys to press (0.7.0): the keyboard and mouse's binding ignores it
					staysSilent(outcomes, "a tap", real);
					expectEqual(keys.Instance.KeyCode, K.Space);
					return;
				}
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(describe(outcomes[0].chord), "-+-+MouseLeftButton");
			});

			test("Bool: a captured Ctrl+click is a chord in IAS: a plain click doesn't press it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				if (getProject() === "touch")
					return skip("a tap is never captured (0.7.0): there is no Ctrl+tap chord to press");
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				real.Press(K.LeftControl);
				landed(real, K.LeftControl);
				frames(2);
				real.MouseDown(emptyPoint());
				frames(3);
				real.MouseUp();
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				real.ReleaseAll();
				expectDefined(outcomes[0].chord, "a chord").KeyCode;
				expectEqual(keys.Instance.PrimaryModifier, K.LeftControl);
				const pressed = countSignal(jump.Pressed);
				// a plain click (tap)
				real.MouseDown(emptyPoint());
				frames(6);
				const plain = jump.IsPressed() || pressed.count > 0;
				real.MouseUp();
				frames(4);
				// Ctrl, then a click
				real.Press(K.LeftControl);
				landed(real, K.LeftControl);
				frames(2);
				real.MouseDown(emptyPoint());
				frames(6);
				const withCtrl = jump.IsPressed() || pressed.count > 0;
				real.ReleaseAll();
				expectEqual(
					`plain ${plain}, with Ctrl ${withCtrl}`,
					"plain false, with Ctrl true",
					`the binding ${describe(outcomes[0].chord)}${real.FocusNote()}`,
				);
			});

			test("Direction1D: a click alone is refused; the next key counts once it is up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Zoom.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				real.MouseDown(emptyPoint());
				frames(3);
				real.MouseUp();
				staysSilent(outcomes, "a click can't be a Direction1D KeyCode", real);
				expectEqual(keys.Instance.KeyCode, K.MouseWheel);
				real.Tap(K.G);
				eventually(() => outcomes.size() === 1, `G${real.FocusNote()}`);
				expectEqual(describe(outcomes[0].chord), "-+-+G");
				expectEqual(keys.Instance.KeyCode, K.G);
			});

			// ---- blocking gameplay while the rebinding UI is open

			test("with the gameplay context held off (as the docs advise), the chord is captured and presses nothing", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump;
				const pressed = countSignal(jump.Pressed);
				const release = input.Gameplay.Request(false);
				defer(release);
				const outcomes = new Array<Outcome>();
				jump.Bindings.KeyboardAndMouse.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.Space]);
				real.Release(K.Space);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0].chord), "LeftControl+-+Space");
				frames(3);
				expectEqual(pressed.count, 0, "Jump was never pressed");
			});

			// HC-2 (hunter): a CAS sink (InputCatcher, which its docs offer for "a modal dialog") makes every
			// key's InputBegan gameProcessed, so CaptureChord (and Capture) heard nothing, Cancel keys
			// included: without a Timeout the capture never ended, and the docs didn't say so.
			// Fixed in part: a Cancel key is now heard even when game-processed (ClassifyCaptureInput), and the
			// docs say that keys a CAS binding sinks aren't captured.
			// DISPUTED HC-2 (in part), worker: the chord itself stays uncaptured under the catcher. A
			// game-processed key is one the game took: a CAS Sink blocks IAS for it (docs/Advanced.md,
			// IAS behaviours: "a ContextActionService binding that returns Sink blocks IAS for its keys"),
			// so an IAS binding on it couldn't fire either (the legacy shift lock on Shift is that case);
			// the capture can't tell a dialog's catcher from a permanent sink. Rebinding UIs block
			// gameplay with Request(false), which the test above shows works.
			test("with an InputCatcher grabbing input, keys aren't captured, and a Cancel key still ends it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const catcher = new InputCatcher(5000);
				defer(() => catcher.ReleaseInput());
				catcher.GrabInput();
				const processed = new Array<string>();
				const watch = UserInputService.InputBegan.Connect((inputObject, gameProcessed) => {
					if (inputObject.KeyCode === K.G) processed.push(tostring(gameProcessed));
				});
				defer(() => watch.Disconnect());
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Delete] });
				real.Press(K.G);
				landed(real, K.G);
				frames(3);
				real.Release(K.G);
				frames(4);
				expectEqual(
					outcomes.size(),
					0,
					`G is the catcher's (gameProcessed: ${processed.join(",")})`,
				);
				real.Tap(K.Delete);
				eventually(() => outcomes.size() === 1, `the Cancel key ends it${real.FocusNote()}`, 3);
				expectEqual(describe(outcomes[0].chord), "undefined");
				expectEqual(keys.Instance.KeyCode, K.Space, "the binding is untouched");

				// Capture: the same
				let captured = 0;
				const stop = keys.Capture("KeyCode", () => captured++, { Cancel: [K.Delete] });
				defer(stop);
				real.Tap(K.G);
				expectEqual(captured, 0, "G is the catcher's");
				real.Tap(K.Delete);
				real.Tap(K.H);
				catcher.ReleaseInput();
				frames(3);
				real.Tap(K.J);
				expectEqual(captured, 0, "the Cancel key ended it");
				expectEqual(keys.Instance.KeyCode, K.Space);
			});

			// ---- focus

			test("a chord key released while a TextBox has focus doesn't linger as a modifier", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions.Jump
					.Bindings.KeyboardAndMouse;
				const box = new Instance("TextBox");
				box.Size = UDim2.fromOffset(200, 40);
				box.Position = UDim2.fromScale(0.1, 0.1);
				box.Parent = testGui();
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				real.Press(K.G);
				landed(real, K.G);
				frames(3);
				box.CaptureFocus();
				frames(3);
				real.Release(K.G);
				eventually(() => !UserInputService.IsKeyDown(K.G), "G is up");
				frames(4);
				box.ReleaseFocus();
				frames(3);
				if (outcomes.size() === 0) {
					real.Tap(K.H);
					eventually(() => outcomes.size() === 1, `H${real.FocusNote()}`);
				}
				const chord = outcomes[0].chord;
				// G alone (settled by its release), or H alone: never H with G, which is up
				expectTrue(
					describe(chord) === "-+-+G" || describe(chord) === "-+-+H",
					`got ${describe(chord)}`,
				);
			});

			// ---- Server Authority stand-in swap

			test("the stand-in swap during a capture: the chord lands on the binding the copy holds", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder("ChordTemplates");
				const copy = localCopy("SaChord", ["Poke"]);
				defer(copy.Cleanup);
				const schema = InputActions.Schema({
					SaChord: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const input = InputActions.Create(schema, {
					Folder: folder,
					PlayerFolderName: copy.FolderName,
					Timeout: 1000,
					ResetOnFocusLoss: false,
				});
				defer(() => input.Destroy());
				const context = input.SaChord;
				expectFalse(context.IsLinkedToServer());
				const keys = context.Actions.Poke.Bindings.KeyboardAndMouse;
				const changes = recordSignal(input.BindingsChanged);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.G]);
				copy.Arrive();
				eventually(() => context.IsLinkedToServer(), "the swap");
				real.Release(K.G);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(describe(outcomes[0].chord), "LeftControl+-+G");
				expectEqual(keys.Instance.Parent, copy.Action("Poke"), "the binding is on the copy");
				expectEqual(keys.Instance.KeyCode, K.G);
				expectEqual(keys.Instance.PrimaryModifier, K.LeftControl);
				expectEqual(keys.Get().PrimaryModifier, K.LeftControl);
				expectTrue(changes.includes("SaChord/Poke/KeyboardAndMouse"));
				const save = input.ExportBindings();
				input.ResetBindings();
				expectEqual(keys.Instance.KeyCode, K.P);
				expectEqual(input.ImportBindings(save).Skipped.size(), 0, save);
				expectEqual(keys.Instance.KeyCode, K.G);
				expectEqual(keys.Instance.PrimaryModifier, K.LeftControl);
			});

			test("Server Authority copy: a chord settled while its key holds Jump releases it on the server, and then drives it", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				expectEqual(keys.Instance.KeyCode, K.F, "the template's key");
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.F]);
				eventually(() => serverJump() === true, `the server sees F${real.FocusNote()}`, 5);
				// Ctrl up first: F still holds Jump when Ctrl+F is written
				real.Release(K.LeftControl);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(describe(outcomes[0].chord), "LeftControl+-+F");
				eventually(
					() => serverJump() === false && !jump.IsPressed(),
					`released on both${real.FocusNote()}`,
					5,
				);
				stays(() => `${jump.IsPressed()}/${serverJump()}`, "false/false", "F still down: at rest");
				real.Release(K.F);
				stays(() => `${jump.IsPressed()}/${serverJump()}`, "false/false", "F up: at rest");
				hold(real, [K.LeftControl, K.F]);
				eventually(
					() => serverJump() === true,
					`the chord drives the server${real.FocusNote()}`,
					5,
				);
				real.ReleaseAll();
				eventually(() => serverJump() === false && !jump.IsPressed(), "at rest", 5);
			});

			test("Server Authority copy: a chord settled by its own KeyCode's release leaves nothing stuck", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				settleServerAfter();
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.F]);
				eventually(() => serverJump() === true, `the server sees F${real.FocusNote()}`, 5);
				real.Release(K.F);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(describe(outcomes[0].chord), "LeftControl+-+F");
				eventually(
					() => serverJump() === false && !jump.IsPressed(),
					`released on both${real.FocusNote()}`,
					5,
				);
				stays(
					() => `${jump.IsPressed()}/${serverJump()}`,
					"false/false",
					"Ctrl still down: at rest",
					1,
				);
				real.Release(K.LeftControl);
				stays(() => `${jump.IsPressed()}/${serverJump()}`, "false/false", "all up: at rest");
				hold(real, [K.LeftControl, K.F]);
				eventually(
					() => serverJump() === true,
					`the chord drives the server${real.FocusNote()}`,
					5,
				);
				real.ReleaseAll();
				eventually(() => serverJump() === false && !jump.IsPressed(), "at rest", 5);
			});

			// ---- saves

			test("Direction1D composite → chord → export/import round trip, and clearing modifiers saves", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const zoom = input.Gameplay.Actions.Zoom.Bindings.Gamepad;
				const quick = input.Gameplay.Actions.QuickSave.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				// the Gamepad binding takes gamepad keys (VirtualInput sends their KeyCodes as keys)
				zoom.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.ButtonL1, K.ButtonX]);
				real.Release(K.ButtonX);
				eventually(() => outcomes.size() === 1, `zoom's chord${real.FocusNote()}`);
				real.ReleaseAll();
				quick.CaptureChord((chord) => outcomes.push({ chord }));
				real.Tap(K.J);
				eventually(() => outcomes.size() === 2, `QuickSave's key${real.FocusNote()}`);
				const save = input.ExportBindings();
				input.ResetBindings();
				expectEqual(zoom.Instance.Up, K.DPadUp);
				expectEqual(quick.Instance.PrimaryModifier, K.LeftControl);
				const result = input.ImportBindings(save);
				expectEqual(result.Skipped.size(), 0, save);
				expectEqual(zoom.Instance.KeyCode, K.ButtonX);
				expectEqual(zoom.Instance.PrimaryModifier, K.ButtonL1);
				expectEqual(zoom.Instance.Up, K.None);
				expectEqual(zoom.Instance.Down, K.None);
				expectEqual(quick.Instance.KeyCode, K.J);
				expectEqual(quick.Instance.PrimaryModifier, K.None, save);
			});
		});
	}
}
