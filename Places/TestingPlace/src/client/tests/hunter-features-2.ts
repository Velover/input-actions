import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectThrows,
	expectTrue,
	fail,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService, LogService, RunService, UserInputService } from "@rbxts/services";
import { expectedSignalBehavior } from "shared/fixtures/projects";
import { frames, newFolder } from "./helpers";
import { isRendering, realInput } from "./virtual";

const K = Enum.KeyCode;

// Hunter, features loop round 2 (0.7.0's usability features after round 1's fixes: MarkReset,
// GestureEdges and edge numbers, OnTap's late press, OnHold's late release, conflict slots,
// AnyNameBindingSpec, Capture's cancel, the docs). Keys no player script nor other section takes
// (CLAUDE.md), in a context above the PlayerModule's and the template other sections leave enabled.

const GESTURE_SCHEMA = InputActions.Schema({
	Hf2Gestures: {
		Priority: 3200,
		Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.N }) },
	},
});

/** The gesture schema in a fresh folder, `ResetOnFocusLoss` off; destroyed after the test */
function createGestures() {
	const input = InputActions.Create(GESTURE_SCHEMA, {
		Folder: newFolder(),
		ResetOnFocusLoss: false,
	});
	defer(() => input.Destroy());
	return input;
}

/** Waits `seconds` of `os.clock` time, yielding */
function waitSeconds(seconds: number) {
	const deadline = os.clock() + seconds;
	while (os.clock() < deadline) RunService.Heartbeat.Wait();
}

/** Runs until `deadline` (`os.clock`) without yielding: a frame that runs long (a hitch) */
function spin(deadline: number) {
	let turns = 0;
	while (os.clock() < deadline) turns++;
	return turns;
}

/** Counts a handle's Pressed and Released until the test ends, with when the last of each came */
function edges(action: InputActions.BoolAction) {
	const pressed = { count: 0, at: 0 };
	const released = { count: 0, at: 0 };
	const connections = [
		action.Pressed.Connect(() => {
			pressed.count++;
			pressed.at = os.clock();
		}),
		action.Released.Connect(() => {
			released.count++;
			released.at = os.clock();
		}),
	];
	defer(() => connections.forEach((connection) => connection.Disconnect()));
	return { Pressed: pressed, Released: released };
}

/** A counter a gesture's callback adds to */
function counter() {
	const count = { count: 0 };
	return [count, () => count.count++] as const;
}

/** Records the errors the output gets until the test ends */
function recordErrors() {
	const messages = new Array<string>();
	const connection = LogService.MessageOut.Connect((message, messageType) => {
		if (messageType === Enum.MessageType.MessageError) messages.push(message);
	});
	defer(() => connection.Disconnect());
	return messages;
}

/**
 * For a failure message when a real key never arrived: a window that renders nothing (the display
 * off) processes no VirtualInput input at all (the hunter's runs and the worker's first run of
 * round 2: every real-input test failed so, with no focus loss)
 */
function renderNote(): string {
	return isRendering() ? "" : " (the window renders nothing: is the display off?)";
}

/** Waits up to 5 s for what a real key does; fails saying `what` never came, and why it may not have */
function arrives(predicate: () => boolean, what: string) {
	const deadline = os.clock() + 5;
	while (!predicate() && os.clock() < deadline) RunService.Heartbeat.Wait();
	if (!predicate()) fail(`${what} never came${renderNote()}`);
}

/** The signal mode, for a failure message */
function signalMode() {
	return `${expectedSignalBehavior() ?? "unknown"} signals`;
}

/**
 * README, "Upgrading from 0.6": the 0.6 schema of its example, and the 0.7 one it becomes
 * (`Move: { Keyboard, Arrows, Pad }`, `Jump: { Keyboard, Alternate }`)
 */
const README_SCHEMA = InputActions.Schema({
	Gameplay: {
		Actions: {
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
					Arrows: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
				},
				Gamepad: K.Thumbstick1,
			}),
			Jump: InputActions.Bool({ KeyboardAndMouse: { Main: K.Space, Alternate: K.F } }),
		},
	},
});

/** The README's migration of a 0.6 save, as written there */
function MigrateAsReadme(json: string): string {
	const [renamed] = json.gsub('"([^"/]+/[^"/]+)/Keyboard":', '"%1/KeyboardAndMouse":');
	const [padded] = renamed.gsub('"([^"/]+/[^"/]+)/Pad":', '"%1/Gamepad":');
	const [arrows] = padded.gsub('"([^"/]+/[^"/]+)/Arrows":', '"%1/KeyboardAndMouse/Arrows":');
	const [migrated] = arrows.gsub(
		'"([^"/]+/[^"/]+)/Alternate":',
		'"%1/KeyboardAndMouse/Alternate":',
	);
	return migrated;
}

@Provider({ activeIn: ["testing"] })
export class HunterFeatures2Tests implements OnStart {
	onStart() {
		defineTests("hunter-features-2", () => {
			// HF2-1 (hunter, fixed: a release is a reset's when the package marked a reset after the handle's previous release, not after the press arrived; MarkReset notes only an action IAS shows held; FinishLink passes its reset to its own handle): under Deferred signals a press that reaches the handle after the package's reset mark (pressed and reset in one frame) had its reset's release taken for the player's: OnTap fired
			test("HF2-1: a rebind in the press's own frame: IAS's reset is no player's release, no tap", () => {
				const poke = createGestures().Hf2Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const [doubles, onDouble] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnDoubleTap(onDouble, { Window: 5, MaxDuration: 5 });
				// <Action>Script made first, at rest: the press below adds no binding
				poke.Fire(false);
				frames(2);
				// a press, and in the same frame a rebind while it is held (IAS resets the action)
				poke.Fire(true);
				poke.Bindings.KeyboardAndMouse.Set(K.Z);
				eventually(
					() => counts.Pressed.count === 1 && counts.Released.count === 1,
					`the press and the reset's release (Pressed ${counts.Pressed.count}, Released ${counts.Released.count})`,
				);
				frames(3);
				const tapsAfterReset = taps.count;
				// a second quick press, within the double-tap window of that "tap" (the Scriptable value
				// back at rest first, whether or not IAS's reset cleared it)
				poke.Fire(false);
				frames(2);
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 2, "the second press");
				frames(2);
				poke.Fire(false);
				eventually(() => counts.Released.count === 2, "the second release");
				frames(3);
				const promise =
					"'A release the player didn't make ends a gesture without completing it: ... a rebind " +
					"or a binding added while it is held (IAS resets the action) ... No tap, double tap or " +
					"long press comes of it' (Advanced, Gestures)";
				expectTrue(
					tapsAfterReset === 0 && doubles.count === 0,
					`${promise}; Fire(true) then Set(Z) in one frame: the release came from IAS's reset of the ` +
						`held action, but OnTap fired ${tapsAfterReset} time(s) on it, and the next quick ` +
						`press made ${doubles.count} double tap(s) with it (${signalMode()}: the press reached ` +
						"the handle after the reset was marked)",
				);
				// the next press is the player's: a tap
				expectEqual(taps.count, 1, `the quick press after the reset is a tap (${signalMode()})`);
			});

			// HF2-1 (hunter, fixed as above): the same, with the context turned off and on again in the press's frame (Request(false) let go at once)
			test("HF2-1, also: the context off and on in the press's own frame: no tap", () => {
				const input = createGestures();
				const poke = input.Hf2Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const longs = new Array<number>();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnLongPress((heldFor) => longs.push(heldFor), { Duration: 0.0001 });
				poke.Fire(false);
				frames(2);
				poke.Fire(true);
				// the package releases the held action and turns the context off, then back on
				input.Hf2Gestures.Request(false)();
				eventually(
					() => counts.Pressed.count === 1 && counts.Released.count === 1,
					`the press and the reset's release (Pressed ${counts.Pressed.count}, Released ${counts.Released.count})`,
				);
				frames(3);
				expectTrue(
					taps.count === 0 && longs.size() === 0,
					"'A release the player didn't make ends a gesture without completing it: the context " +
						"disabled (SetEnabled, Request ...)' (Advanced, Gestures); Fire(true), then Request(false) " +
						"let go at once, in one frame: the package released the action and disabled the context, " +
						`but OnTap fired ${taps.count} time(s) and OnLongPress ${longs.size()} on that release ` +
						`(${signalMode()})`,
				);
			});

			// worker, round 2 (HF2-1's rule): a release of the player's, then the package's reset of the action at rest in the same frame: under Immediate signals the release arrives first, and under Deferred it is still the player's (no mark for an action at rest)
			test("HF2-1, the other order: the player's release, then the context off and on in its frame: a tap", () => {
				const input = createGestures();
				const poke = input.Hf2Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const longs = new Array<number>();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnLongPress((heldFor) => longs.push(heldFor), { Duration: 0.0001 });
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1, "the press");
				frames(2);
				// let go, and in the same frame the context off and on (the action at rest by then)
				poke.Fire(false);
				input.Hf2Gestures.Request(false)();
				eventually(() => counts.Released.count === 1, "the release");
				frames(3);
				expectTrue(
					taps.count === 1 && longs.size() === 1,
					"the player let go before the reset, which found the action at rest and released " +
						`nothing: a tap and a long press, as under Immediate signals; got OnTap ${taps.count}, ` +
						`OnLongPress ${longs.size()} (${signalMode()})`,
				);
			});

			// worker, round 2 (HF2-1's rule): a reset's mark is used up by the release it ends: the player's presses right after it complete their gestures, a double tap included
			test("HF2-1: after a reset in the press's frame, the next quick presses are taps and a double tap", () => {
				const input = createGestures();
				const poke = input.Hf2Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const [doubles, onDouble] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnDoubleTap(onDouble, { Window: 5, MaxDuration: 5 });
				poke.Fire(false);
				frames(2);
				poke.Fire(true);
				input.Hf2Gestures.Request(false)();
				eventually(
					() => counts.Pressed.count === 1 && counts.Released.count === 1,
					`the press and the reset's release (Pressed ${counts.Pressed.count}, Released ${counts.Released.count})`,
				);
				frames(3);
				expectTrue(
					taps.count === 0 && doubles.count === 0,
					`the reset's release: no tap (${taps.count}), no double tap (${doubles.count}) (${signalMode()})`,
				);
				// two quick presses of the player's, each edge waited for
				for (const press of [2, 3]) {
					poke.Fire(true);
					eventually(() => counts.Pressed.count === press, `press ${press}`);
					poke.Fire(false);
					eventually(() => counts.Released.count === press, `release ${press}`);
				}
				frames(3);
				expectTrue(
					taps.count === 2 && doubles.count === 1,
					`two quick presses after the reset's release: 2 taps and a double tap; got ${taps.count} ` +
						`tap(s) and ${doubles.count} double tap(s) (${signalMode()})`,
				);
			});

			// worker, round 2 (HF2-1's rule): a reset still cancels, in the press's own frame and frames after it; AttachButton in the press's frame (IAS resets a held action given a binding) too
			test("HF2-1: a reset cancels a hold and completes nothing: in the press's frame, after it, AttachButton", () => {
				const input = createGestures();
				const poke = input.Hf2Gestures.Actions.Poke;
				const counts = edges(poke);
				const calls = new Array<string>();
				poke.OnTap(() => calls.push("tap"), { MaxDuration: 5 });
				poke.OnLongPress(() => calls.push("long"), { Duration: 0.0001 });
				poke.OnHold(() => calls.push("hold"), {
					Duration: 5,
					Cancelled: () => calls.push("cancelled"),
				});
				poke.Fire(false);
				frames(2);
				const resets: Array<[string, () => void]> = [
					["Request(false)() in the press's frame", () => input.Hf2Gestures.Request(false)()],
					[
						"AttachButton in the press's frame",
						() => {
							const button = new Instance("TextButton");
							defer(() => button.Destroy());
							poke.AttachButton(button);
						},
					],
				];
				let released = 0;
				for (const [what, reset] of resets) {
					calls.clear();
					poke.Fire(true);
					reset();
					released++;
					eventually(() => counts.Released.count === released, `${what}: the reset's release`);
					frames(3);
					expectArrayEqual(calls, ["cancelled"], `${what}: only Cancelled (${signalMode()})`);
					poke.Fire(false);
					frames(2);
				}
				// frames after the press
				calls.clear();
				poke.Fire(true);
				eventually(() => counts.Pressed.count === released + 1, "the last press");
				frames(3);
				input.Hf2Gestures.SetEnabled(false);
				input.Hf2Gestures.SetEnabled(true);
				eventually(() => counts.Released.count === released + 1, "the last reset's release");
				frames(3);
				expectArrayEqual(calls, ["cancelled"], `SetEnabled off and on, frames after the press (${signalMode()})`);
			});

			// HF2-1 with a real key (hunter's probe; it skipped in the hunter's runs, where the window rendered nothing and no VirtualInput input arrived): a UserInputService.InputBegan handler rebinds the key's action as the key goes down
			test("HF2-1: a real key whose InputBegan handler rebinds its action: no tap", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const poke = createGestures().Hf2Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				let stateAtBegan: boolean | undefined;
				const connection = UserInputService.InputBegan.Connect((input) => {
					if (input.KeyCode !== K.N || stateAtBegan !== undefined) return;
					stateAtBegan = poke.IsPressed();
					poke.Bindings.KeyboardAndMouse.Set(K.Z);
				});
				defer(() => connection.Disconnect());
				real.Press(K.N);
				arrives(() => stateAtBegan !== undefined, `N's InputBegan${real.FocusNote()}`);
				frames(5);
				real.Release(K.N);
				frames(3);
				expectEqual(
					taps.count,
					0,
					`no tap: the action ${stateAtBegan ? "was" : "was not"} pressed when the handler ran ` +
						`(Pressed ${counts.Pressed.count}, Released ${counts.Released.count}, ${signalMode()})${real.FocusNote()}`,
				);
			});

			// HF2-1 with a real key, no UserInputService (hunter's probe; it skipped in the hunter's runs, as above): per-frame code that sees IAS's state pressed before the handle's listeners heard it turns the context off and on
			test("HF2-1: a real key, and the context off and on in a frame step that sees the press first: no tap", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createGestures();
				const poke = input.Hf2Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				let where: string | undefined;
				const steps: Array<[string, RBXScriptSignal]> = [
					["RenderStepped", RunService.RenderStepped],
					["PreAnimation", RunService.PreAnimation],
					["PreSimulation", RunService.PreSimulation],
					["PostSimulation", RunService.PostSimulation],
					["Heartbeat", RunService.Heartbeat],
				];
				const connections = steps.map(([name, signal]) =>
					signal.Connect(() => {
						if (where !== undefined || !poke.IsPressed() || counts.Pressed.count > 0) return;
						where = name;
						input.Hf2Gestures.Request(false)();
					}),
				);
				defer(() => connections.forEach((connection) => connection.Disconnect()));
				real.Press(K.N);
				arrives(
					() => where !== undefined || counts.Pressed.count > 0,
					`N's press, at a frame step or the handle${real.FocusNote()}`,
				);
				frames(3);
				real.Release(K.N);
				frames(3);
				// No frame step saw the press before the listeners heard it: nothing to reset in between.
				// Measured on 2026-10-03 in all six projects: none does, under either signal mode (IAS's
				// deferred events go out before the next frame step), so this skips; it tests HF2-1
				// should that change
				if (where === undefined)
					return skip(`no frame step saw N pressed before the listeners (${signalMode()})`);
				expectEqual(
					taps.count,
					0,
					`a real press of N, seen pressed at ${where} before the handle's Pressed listeners ran, ` +
						"where the context was turned off and on (the package released the action): that " +
						`release is no player's, but OnTap fired ${taps.count} time(s) (Pressed ` +
						`${counts.Pressed.count}, Released ${counts.Released.count}, ${signalMode()})${real.FocusNote()}`,
				);
			});

			// HF2-4 (hunter, fixed: the README renames Alternate too, and says every former binding name needs its own rename): README "Upgrading from 0.6": its migration renamed Keyboard, Pad and Arrows, but its own example's Jump has an Alternate binding, whose rebind was then skipped
			test("HF2-4: README's 0.6 save migration keeps every rebind of its own example", () => {
				const input = InputActions.Create(README_SCHEMA, {
					Folder: newFolder(),
					ResetOnFocusLoss: false,
				});
				defer(() => input.Destroy());
				// a 0.6 save of the README's 0.6 schema: every binding rebound
				const save06 = HttpService.JSONEncode({
					Version: 1,
					Bindings: {
						"Gameplay/Move/Keyboard": { Up: "T" },
						"Gameplay/Move/Arrows": { Up: "KeypadEight" },
						"Gameplay/Move/Pad": { KeyCode: "Thumbstick2" },
						"Gameplay/Jump/Keyboard": { KeyCode: "G" },
						"Gameplay/Jump/Alternate": { KeyCode: "U" },
					},
				});
				const result = input.ImportBindings(MigrateAsReadme(save06));
				const { Move, Jump } = input.Gameplay.Actions;
				expectEqual(Move.Bindings.KeyboardAndMouse.Instance.Up, K.T, "Keyboard became KeyboardAndMouse");
				expectEqual(Move.Bindings.KeyboardAndMouse.Arrows.Instance.Up, K.KeypadEight, "Arrows");
				expectEqual(Move.Bindings.Gamepad.Instance.KeyCode, K.Thumbstick2, "Pad became Gamepad");
				expectEqual(Jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.G);
				expectEqual(Jump.Bindings.KeyboardAndMouse.Alternate.Instance.KeyCode, K.U, "Alternate");
				expectArrayEqual(
					result.Skipped.map((entry) => `${entry.Path}: ${entry.Reason}`),
					[],
					"README, 'Upgrading from 0.6': 'To keep a 0.6 save's rebinds, rename its paths on the " +
						"JSON string before importing it', with its example's 0.6 Jump { Keyboard, Alternate } " +
						"becoming KeyboardAndMouse: { Main, Alternate }: the README's renames must leave no " +
						"path skipped, Gameplay/Jump/Alternate included " +
						`(Jump's Alternate reads ${Jump.Bindings.KeyboardAndMouse.Alternate.Instance.KeyCode.Name})`,
				);
			});

			// evidence for HF2-2 and HF2-3 (compile time, hunter-features-2-type-rules.ts): Schema refuses each value the computed-name types accept, under every name it could have
			test("HF2-2, HF2-3 evidence: Schema refuses, under every name, the computed-name bindings the types accept", () => {
				const values: Array<[string, unknown]> = [
					["a gamepad key with a keyboard modifier", { KeyCode: K.ButtonA, PrimaryModifier: K.LeftControl }],
					["a namespace mixing devices", { Main: K.E, Alt: K.ButtonA }],
					["a namespace with a reserved extra name", { Main: K.E, Set: K.F }],
					["a key no Bool binding takes, in an object", { KeyCode: K.MouseDelta }],
				];
				for (const [what, value] of values) {
					for (const name of ["KeyboardAndMouse", "Gamepad", "Touch", "Other"]) {
						expectThrows(
							() =>
								InputActions.Schema({
									Play: {
										Actions: { Jump: InputActions.Bool({ [name]: value } as never) },
									},
								}),
							`${what} under ${name}: Schema should refuse it`,
						);
					}
				}
			});

			test("probe: a gesture made in another gesture's callback starts with the next press", () => {
				const poke = createGestures().Hf2Gestures.Actions.Poke;
				const counts = edges(poke);
				const longs = new Array<number>();
				let made = false;
				poke.OnTap(
					() => {
						if (made) return;
						made = true;
						poke.OnLongPress((heldFor) => longs.push(heldFor), { Duration: 0.0001 });
					},
					{ MaxDuration: 5 },
				);
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1, "the press");
				frames(2);
				poke.Fire(false);
				eventually(() => made, "the tap");
				frames(2);
				expectEqual(longs.size(), 0, "the press that made it is no part of it");
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 2, "the second press");
				frames(2);
				poke.Fire(false);
				eventually(() => counts.Released.count === 2, "the second release");
				frames(3);
				expectEqual(longs.size(), 1, `the next press is a long press (${signalMode()})`);
			});

			test("probe: Destroy from a Pressed listener: no error, and no gesture calls back", () => {
				const errors = recordErrors();
				const input = InputActions.Create(GESTURE_SCHEMA, {
					Folder: newFolder(),
					ResetOnFocusLoss: false,
				});
				let destroyed = false;
				defer(() => {
					if (!destroyed) input.Destroy();
				});
				const poke = input.Hf2Gestures.Actions.Poke;
				const calls = new Array<string>();
				poke.OnHold(() => calls.push("hold"), {
					Duration: 0.2,
					Progress: (fraction) => calls.push(`progress ${fraction}`),
					Cancelled: () => calls.push("cancelled"),
				});
				poke.OnLongPress(() => calls.push("long"), { Duration: 0.0001 });
				const connection = poke.Pressed.Connect(() => {
					if (destroyed) return;
					destroyed = true;
					input.Destroy();
				});
				defer(() => connection.Disconnect());
				poke.Fire(true);
				eventually(() => destroyed, "the press");
				waitSeconds(0.4);
				poke.Fire(false);
				frames(3);
				const ours = errors.filter(
					(message) =>
						message.find("InputActions", 1, true)[0] !== undefined ||
						message.find("input-actions", 1, true)[0] !== undefined,
				);
				expectArrayEqual(ours, [], `errors in the output: ${ours.join(" | ")} (${signalMode()})`);
				expectArrayEqual(calls, [], `nothing after Destroy: ${calls.join(", ")} (${signalMode()})`);
			});

			test("probe: OnHold without Progress completes on a release that arrives after Duration (a hitch)", () => {
				const poke = createGestures().Hf2Gestures.Actions.Poke;
				const counts = edges(poke);
				const duration = 0.5;
				const [holds, onHold] = counter();
				const [cancels, onCancel] = counter();
				poke.OnHold(onHold, { Duration: duration, Cancelled: onCancel });
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1, "the press");
				const since = os.clock() - counts.Pressed.at;
				if (since > duration / 2) return skip(`the test resumed ${since} s after the press`);
				spin(counts.Pressed.at + duration + 0.1);
				poke.Fire(false);
				eventually(() => counts.Released.count === 1, "the release");
				frames(3);
				expectTrue(
					holds.count === 1 && cancels.count === 0,
					`a press held ${counts.Released.at - counts.Pressed.at} s (Duration ${duration}): hold ` +
						`${holds.count}, Cancelled ${cancels.count}`,
				);
			});

			test("probe: the action's Capture: a Cancel key its Gamepad binding could take cancels; after Destroy or stop, nothing", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const schema = InputActions.Schema({
					Hf2Capture: {
						Priority: 3200,
						Enabled: false,
						Actions: {
							Jump: InputActions.Bool({ KeyboardAndMouse: K.Space, Gamepad: K.ButtonA }),
						},
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder(), ResetOnFocusLoss: false });
				let destroyed = false;
				defer(() => {
					if (!destroyed) input.Destroy();
				});
				const jump = input.Hf2Capture.Actions.Jump;
				// ButtonY: a gamepad key the Gamepad binding of a Bool action can hold, listed as Cancel
				const calls = new Array<string>();
				jump.Capture((key, device) => calls.push(`${key?.Name ?? "undefined"}/${device ?? "undefined"}`), {
					Cancel: [K.ButtonY],
				});
				real.Tap(K.ButtonY);
				arrives(() => calls.size() === 1, `the cancel${real.FocusNote()}`);
				real.Tap(K.ButtonX);
				frames(3);
				expectArrayEqual(calls, ["undefined/undefined"], `cancelled, then nothing${real.FocusNote()}`);
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA, "the Gamepad binding unchanged");
				// stopped by its function: nothing on the Cancel key
				const stopped = new Array<string>();
				const stop = jump.Capture((key) => stopped.push(key?.Name ?? "undefined"), {
					Cancel: [K.Backspace],
				});
				stop();
				real.Tap(K.Backspace);
				frames(3);
				expectArrayEqual(stopped, [], `the stop function: nothing${real.FocusNote()}`);
				// the root handle destroyed while a capture waits: nothing on the Cancel key
				const after = new Array<string>();
				jump.Capture((key) => after.push(key?.Name ?? "undefined"), { Cancel: [K.Backspace] });
				input.Destroy();
				destroyed = true;
				real.Tap(K.Backspace);
				real.Tap(K.G);
				frames(3);
				expectArrayEqual(after, [], `after Destroy: nothing${real.FocusNote()}`);
			});

			test("probe: FindConflicts() pairs: Slots on each side with a modifier on either side (the Guide's schema)", () => {
				const schema = InputActions.Schema({
					Gameplay: {
						Actions: {
							Move: InputActions.Direction2D({
								KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
							}),
							Crouch: InputActions.Bool({ KeyboardAndMouse: K.LeftControl }),
							QuickSave: InputActions.Bool({
								KeyboardAndMouse: { KeyCode: K.S, PrimaryModifier: K.LeftControl },
							}),
						},
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder(), ResetOnFocusLoss: false });
				defer(() => input.Destroy());
				const allPairs = input.FindConflicts().map(
					(pair) =>
						`${pair.Paths.join(" & ")}: ${pair.Keys.map((key) => key.Name).join(",")} ` +
						`[${pair.Slots[0].join(",")}] [${pair.Slots[1].join(",")}] ${pair.Identical}`,
				);
				expectArrayEqual(allPairs, [
					"Gameplay/Crouch/KeyboardAndMouse & Gameplay/QuickSave/KeyboardAndMouse: LeftControl [KeyCode] [PrimaryModifier] false",
					"Gameplay/Move/KeyboardAndMouse & Gameplay/QuickSave/KeyboardAndMouse: S [Down] [KeyCode] false",
				]);
				const { QuickSave } = input.Gameplay.Actions;
				const found = input
					.FindConflicts(QuickSave.Bindings.KeyboardAndMouse)
					.map((conflict) => `${conflict.Path}: ${conflict.Key.Name} ${conflict.Slot} [${conflict.Slots.join(",")}]`);
				expectArrayEqual(found, [
					"Gameplay/Crouch/KeyboardAndMouse: LeftControl KeyCode [KeyCode]",
					"Gameplay/Move/KeyboardAndMouse: S Down [Down]",
				]);
			});
		});
	}
}
