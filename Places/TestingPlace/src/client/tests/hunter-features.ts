import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectThrows,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players, RunService } from "@rbxts/services";
import { frames, newFolder } from "./helpers";
import { RealInput, emptyPoint, realInput } from "./virtual";

const K = Enum.KeyCode;

// Hunter, features loop round 1 (0.7.0: extras per device, PreferredDeviceChanged, Describe,
// FindConflicts, gestures, readable compile errors). Keys no player script nor other section takes
// (CLAUDE.md), in a context above the PlayerModule's and the template other sections leave enabled.

const GESTURE_SCHEMA = InputActions.Schema({
	HfGestures: {
		Priority: 3100,
		Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.N }) },
	},
});

/** The same context and action, with a keyboard extra only this schema declares */
const GESTURE_SCHEMA_EXTRA = InputActions.Schema({
	HfGestures: {
		Priority: 3100,
		Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: { Main: K.N, Alt: K.J } }) },
	},
});

/** A stick and bindings on its directions, and the other stick's direction */
const STICK_SCHEMA = InputActions.Schema({
	HfPad: {
		Actions: {
			Move: InputActions.Direction2D({ Gamepad: K.Thumbstick1 }),
			Peek: InputActions.Bool({ Gamepad: K.Thumbstick1Up }),
			Lean: InputActions.Direction1D({
				Gamepad: { Up: K.Thumbstick1Right, Down: K.Thumbstick1Left },
			}),
			Zoom: InputActions.Direction1D({ Gamepad: K.Thumbstick2Up }),
		},
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

/**
 * Runs until `deadline` (`os.clock`) without yielding: a frame that runs long (a hitch), in which
 * no timer and no per-frame work can run
 */
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

/** Presses `key` and waits until the handle has told its listeners (Pressed) */
function press(real: RealInput, key: Enum.KeyCode, pressed: { count: number }) {
	const before = pressed.count;
	real.Press(key);
	eventually(() => pressed.count > before, `${key.Name}'s Pressed${real.FocusNote()}`);
}

/** A counter a gesture's callback adds to */
function counter() {
	const count = { count: 0 };
	return [count, () => count.count++] as const;
}

/** The paths of `FindConflicts(binding)`'s answer, sorted */
function conflictPaths(conflicts: readonly InputActions.BindingConflict[]) {
	const paths = conflicts.map((conflict) => conflict.Path);
	paths.sort();
	return paths;
}

@Provider({ activeIn: ["testing"] })
export class HunterFeaturesTests implements OnStart {
	onStart() {
		defineTests("hunter-features", () => {
			// HF-1 (hunter, fixed: MarkReset before every reset the package makes, ResetIfHeld's Enabled toggle, ReleaseOwn's fire at rest and its pair on <Action>Script, ReleaseOnServer's pair included): another root handle's Destroy resets a held shared action unmarked, and under Deferred signals the action is enabled again before the release arrives: A's OnTap and OnLongPress take it for the player's release
			test("HF-1: another root handle's Destroy releasing a held shared action ends the gestures without completing them", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const input = InputActions.Create(GESTURE_SCHEMA, {
					Folder: folder,
					ResetOnFocusLoss: false,
				});
				defer(() => input.Destroy());
				// a second root handle on the same folder, whose schema adds a keyboard extra: that
				// binding goes with it, so its Destroy releases the action a key holds (EdgeCases,
				// "Several root handles on one folder")
				const other = InputActions.Create(GESTURE_SCHEMA_EXTRA, {
					Folder: folder,
					ResetOnFocusLoss: false,
				});
				let otherDestroyed = false;
				defer(() => {
					if (!otherDestroyed) other.Destroy();
				});
				const poke = input.HfGestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const longs = new Array<number>();
				const [holds, onHold] = counter();
				const [cancels, onCancel] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnLongPress((heldFor) => longs.push(heldFor), { Duration: 0.2 });
				poke.OnHold(onHold, { Duration: 5, Cancelled: onCancel });
				press(real, K.N, counts.Pressed);
				waitSeconds(0.4);
				other.Destroy();
				otherDestroyed = true;
				eventually(
					() => counts.Released.count === 1,
					`the other root handle's Destroy released the action${real.FocusNote()}`,
				);
				eventually(() => cancels.count === 1, "the hold in progress is Cancelled");
				frames(3);
				const tapsAtReset = taps.count;
				const longsAtReset = longs.size();
				real.Release(K.N);
				frames(3);
				const promise =
					"a release the package makes (another root handle's Destroy resetting the action a key " +
					"holds) is no player's release: it ends a gesture without completing it (Advanced, " +
					"Gestures; EdgeCases, 'Gestures and releases the player didn't make')";
				expectEqual(
					tapsAtReset,
					0,
					`${promise}; OnTap fired ${tapsAtReset} time(s) on that release${real.FocusNote()}`,
				);
				expectEqual(
					longsAtReset,
					0,
					`${promise}; OnLongPress fired on that release (${longs.join(", ")} s)${real.FocusNote()}`,
				);
				expectEqual(holds.count, 0);
			});

			// HF-1 (hunter, fixed as above): the same on the server's copy, where the release is a pair on <Action>Script
			test("HF-1b: on the server's copy, another root handle's Destroy releasing a held shared action with a pair ends the gestures", () => {
				if (getProject() !== "authority")
					return skip(
						"the authority project only: the pair is fired on a copy under Server Authority",
					);
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				// the server's copy, played on the client (as the gestures section does)
				const playerFolder = new Instance("Folder");
				playerFolder.Name = "InputsHunterFeatures";
				const copy = new Instance("InputContext");
				copy.Name = "HfGestures";
				copy.Priority = 3100;
				const copyAction = new Instance("InputAction");
				copyAction.Name = "Poke";
				copyAction.Type = Enum.InputActionType.Bool;
				copyAction.Parent = copy;
				copy.Parent = playerFolder;
				playerFolder.Parent = Players.LocalPlayer;
				defer(() => playerFolder.Destroy());
				const contexts = (extra: boolean) =>
					extra
						? {
								HfGestures: {
									ServerAuthority: true as const,
									Priority: 3100,
									Actions: {
										Poke: InputActions.Bool({ KeyboardAndMouse: { Main: K.N, Alt: K.J } }),
									},
								},
							}
						: {
								HfGestures: {
									ServerAuthority: true as const,
									Priority: 3100,
									Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.N }) },
								},
							};
				const options = {
					Folder: newFolder(),
					PlayerFolderName: playerFolder.Name,
					Timeout: 1000,
					ResetOnFocusLoss: false,
				};
				const input = InputActions.Create(InputActions.Schema(contexts(false)), options);
				defer(() => input.Destroy());
				const other = InputActions.Create(InputActions.Schema(contexts(true)), options);
				let otherDestroyed = false;
				defer(() => {
					if (!otherDestroyed) other.Destroy();
				});
				expectTrue(input.HfGestures.IsLinkedToServer(), "on the copy at once");
				const poke = input.HfGestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const longs = new Array<number>();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnLongPress((heldFor) => longs.push(heldFor), { Duration: 0.2 });
				press(real, K.N, counts.Pressed);
				waitSeconds(0.4);
				other.Destroy();
				otherDestroyed = true;
				eventually(
					() => counts.Released.count === 1,
					`the other root handle's Destroy released the action${real.FocusNote()}`,
				);
				frames(3);
				const tapsAtReset = taps.count;
				const longsAtReset = longs.size();
				real.Release(K.N);
				frames(3);
				expectTrue(
					tapsAtReset === 0 && longsAtReset === 0,
					"a release the package makes (another root handle's Destroy releasing, with a pair on " +
						"<Action>Script, the copy's action a key holds) ends a gesture without completing it; " +
						`OnTap fired ${tapsAtReset} time(s), OnLongPress ${longsAtReset}${real.FocusNote()}`,
				);
			});

			// HF-2 (hunter, fixed: Conflicts.ts' SharedKey: a stick shares its directions with a binding on it, the direction being the Key; on Touch a drag or a pinch shares with TouchPosition): FindConflicts misses a stick and a binding on one of its directions
			test("HF-2: FindConflicts: a stick and a binding on its direction, which one push presses both", () => {
				const input = InputActions.Create(STICK_SCHEMA, {
					Folder: newFolder(),
					ResetOnFocusLoss: false,
				});
				defer(() => input.Destroy());
				const { Move, Peek, Lean, Zoom } = input.HfPad.Actions;
				// the direction bindings among themselves: the same KeyCode, found
				expectArrayEqual(conflictPaths(input.FindConflicts(Zoom.Bindings.Gamepad)), []);
				const promise =
					"FindConflicts lists the other bindings of the device that share a key: 'Two bindings " +
					"conflict when a key presses both' (spec §6, Conflicts); pushing the left stick up " +
					"presses Peek (Thumbstick1Up) and moves Move (Thumbstick1), and a capture on the pad " +
					"gives a stick's push as Thumbstick1Up";
				expectArrayEqual(
					conflictPaths(input.FindConflicts(Move.Bindings.Gamepad)),
					["HfPad/Lean/Gamepad", "HfPad/Peek/Gamepad"],
					`${promise}; FindConflicts(Move.Gamepad) found ${conflictPaths(
						input.FindConflicts(Move.Bindings.Gamepad),
					).join(", ")}`,
				);
				expectArrayEqual(
					conflictPaths(input.FindConflicts(Peek.Bindings.Gamepad)),
					["HfPad/Move/Gamepad"],
					`${promise}; FindConflicts(Peek.Gamepad) found ${conflictPaths(
						input.FindConflicts(Peek.Bindings.Gamepad),
					).join(", ")}`,
				);
				expectTrue(
					conflictPaths(input.FindConflicts(Lean.Bindings.Gamepad)).includes("HfPad/Move/Gamepad"),
					`${promise}; FindConflicts(Lean.Gamepad) found ${conflictPaths(
						input.FindConflicts(Lean.Bindings.Gamepad),
					).join(", ")}`,
				);
			});

			// HF-3 (hunter, fixed: OnTap's press compares the time since the waiting tap's release with Window, as OnDoubleTap does, and fires the tap first when the window has passed): a second press after OnTap's window, before its timer ran, drops the tap: neither tap nor double tap
			test("HF-3: OnTap with WaitForDoubleTap: a press after the window, in the frame its timer hasn't run yet, keeps the tap", () => {
				const poke = createGestures().HfGestures.Actions.Poke;
				const counts = edges(poke);
				const window = 0.4;
				const [single, onSingle] = counter();
				const [double, onDouble] = counter();
				poke.OnTap(onSingle, { WaitForDoubleTap: true, Window: window, MaxDuration: 0.5 });
				poke.OnDoubleTap(onDouble, { Window: window, MaxDuration: 0.5 });
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1, "the first press");
				poke.Fire(false);
				eventually(() => counts.Released.count === 1, "the first release");
				const since = os.clock() - counts.Released.at;
				if (since > window / 2) return skip(`the test resumed ${since} s after the release`);
				// a frame that runs long (a hitch): the window ends in it, and the second press comes
				// in it, as a player's press comes at the start of the frame after the window ended,
				// before the scheduler resumes the window's timer
				spin(counts.Released.at + window + 0.1);
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 2, "the second press");
				const gap = counts.Pressed.at - counts.Released.at;
				frames(2);
				poke.Fire(false);
				eventually(() => counts.Released.count === 2, "the second release");
				waitSeconds(window + 0.3);
				expectEqual(
					double.count,
					0,
					`the second press came ${gap} s after the first tap: no double tap`,
				);
				expectEqual(
					single.count,
					2,
					"OnTap with WaitForDoubleTap 'waits until Window has passed after the release without a " +
						"second press' (Advanced, Gestures): the first tap's window passed without one (the " +
						`second press came ${gap} s after it, Window ${window}), and the second press was a ` +
						`tap too; OnTap fired ${single.count} time(s), OnDoubleTap ${double.count}: the first ` +
						"tap was dropped as a double tap's first half, though no double tap came of it",
				);
			});

			// HF-4 (hunter, fixed: OnHold's release completes a hold whose press lasted Duration, unless it is a reset's): a press held past OnHold's Duration, released before its timer ran, is Cancelled
			test("HF-4: OnHold: a press released after Duration, before the hold's timer or a frame ran, completes the hold", () => {
				const poke = createGestures().HfGestures.Actions.Poke;
				const counts = edges(poke);
				const duration = 0.5;
				const [holds, onHold] = counter();
				const [cancels, onCancel] = counter();
				const longs = new Array<number>();
				const fractions = new Array<number>();
				poke.OnHold(onHold, {
					Duration: duration,
					Progress: (fraction) => fractions.push(fraction),
					Cancelled: onCancel,
				});
				poke.OnLongPress((heldFor) => longs.push(heldFor), { Duration: duration });
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1, "the press");
				const since = os.clock() - counts.Pressed.at;
				if (since > duration / 2) return skip(`the test resumed ${since} s after the press`);
				// a frame that runs long (a hitch) past Duration: the player lets go in it, as a release
				// comes at the start of a frame, before that frame's timers and render step
				spin(counts.Pressed.at + duration + 0.1);
				poke.Fire(false);
				eventually(() => counts.Released.count === 1, "the release");
				frames(3);
				const held = counts.Released.at - counts.Pressed.at;
				expectEqual(longs.size(), 1, `a long press: held ${held} s, Duration ${duration}`);
				expectTrue(
					holds.count === 1 && cancels.count === 0,
					"OnHold fires 'when it has lasted Duration' and a long press 'is a hold and a long press' " +
						`(Advanced, Gestures): the press lasted ${held} s (Duration ${duration}) and was a long ` +
						`press (${longs.join(", ")} s), but the hold fired ${holds.count} time(s) and was ` +
						`Cancelled ${cancels.count} time(s); Progress: ${fractions.join(", ")}`,
				);
			});

			// HF-5 (hunter, fixed: OnHold checks it is still running after each Progress call, and leaves no per-frame work behind when Progress(0) stops it at the press): a gesture stopped (or the root handle destroyed) in Progress still calls back
			test("HF-5: OnHold: stopped or destroyed from its own Progress, it calls nothing more", () => {
				// stopped as Progress reaches 1: the hold's callback still runs
				const poke = createGestures().HfGestures.Actions.Poke;
				const calls = new Array<string>();
				let stopHold: () => void = () => {};
				stopHold = poke.OnHold(() => calls.push("hold"), {
					Duration: 0.2,
					Progress: (fraction) => {
						if (fraction !== 1) return;
						calls.push("stopped");
						stopHold();
					},
				});
				poke.Fire(true);
				waitSeconds(0.6);
				poke.Fire(false);
				frames(3);
				// the root handle destroyed as Progress goes back to 0 on the release: Cancelled still runs
				const input = InputActions.Create(GESTURE_SCHEMA, {
					Folder: newFolder(),
					ResetOnFocusLoss: false,
				});
				let destroyed = false;
				defer(() => {
					if (!destroyed) input.Destroy();
				});
				const other = input.HfGestures.Actions.Poke;
				const otherCalls = new Array<string>();
				let started = false;
				other.OnHold(() => otherCalls.push("hold"), {
					Duration: 5,
					Progress: (fraction) => {
						if (fraction > 0) started = true;
						else if (started && !destroyed) {
							otherCalls.push("destroyed");
							destroyed = true;
							input.Destroy();
						}
					},
					Cancelled: () => otherCalls.push("cancelled"),
				});
				other.Fire(true);
				waitSeconds(0.4);
				other.Fire(false);
				waitSeconds(0.3);
				expectTrue(started, "Progress ran while held");
				const promise =
					"'The function a gesture returns and Destroy stop it without calling anything, a hold " +
					"in progress included. After Destroy, a new gesture does nothing' (Advanced, Gestures)";
				expectArrayEqual(
					calls,
					["stopped"],
					`${promise}: stopped from Progress(1), it then called: ${calls.join(", ")}`,
				);
				expectArrayEqual(
					otherCalls,
					["destroyed"],
					`${promise}: the root handle destroyed from Progress(0), it then called: ${otherCalls.join(", ")}`,
				);
			});

			test("probe: Schema's words for an unknown property: no namespace hint for a binding property, nor in a namespace", () => {
				const direct = expectThrows(
					() =>
						InputActions.Schema({
							Play: {
								Actions: {
									Jump: InputActions.Bool({
										KeyboardAndMouse: { KeyCode: K.E, Up: K.W },
									} as never),
								},
							},
						}),
					"Up beside the keys",
				);
				expectTrue(
					direct.find("Up is not a property of a Bool binding", 1, true)[0] !== undefined,
					direct,
				);
				expectTrue(direct.find("several bindings", 1, true)[0] === undefined, direct);
				const nested = expectThrows(
					() =>
						InputActions.Schema({
							Play: {
								Actions: {
									Jump: InputActions.Bool({
										KeyboardAndMouse: { Main: K.Space, Alt: { KeyCode: K.E, Second: K.F } },
									} as never),
								},
							},
						}),
					"Second inside an extra",
				);
				expectTrue(
					nested.find("Second is not a property of a Bool binding", 1, true)[0] !== undefined,
					nested,
				);
				expectTrue(nested.find("several bindings", 1, true)[0] === undefined, nested);
				// following the compile error's advice: Up as an extra's name
				const advised = expectThrows(
					() =>
						InputActions.Schema({
							Play: {
								Actions: {
									Jump: InputActions.Bool({
										KeyboardAndMouse: { Main: { KeyCode: K.E }, Up: K.W },
									} as never),
								},
							},
						}),
					"Up as an extra",
				);
				expectTrue(advised.find("binding property", 1, true)[0] !== undefined, advised);
			});

			// HF-7 (hunter, fixed: the handle works out whether a release is a reset's once, as it arrives, and passes that to every gesture through its own signal, GestureEdges): a gesture's callback that turns the context off (a menu on a tap) cancels the others on that release
			test("HF-7: gestures on one action are independent: one whose callback turns the context off leaves the others' release the player's", () => {
				const input = createGestures();
				const poke = input.HfGestures.Actions.Poke;
				const counts = edges(poke);
				const [first, onFirst] = counter();
				const [last, onLast] = counter();
				const longs = new Array<number>();
				let resumeGameplay: (() => void) | undefined;
				defer(() => resumeGameplay?.());
				// registered before and after the one that opens a menu: one of them hears the release
				// after it, whichever order the listeners run in
				poke.OnTap(onFirst, { MaxDuration: 0.5 });
				poke.OnLongPress((heldFor) => longs.push(heldFor), { Duration: 0.01 });
				poke.OnTap(
					() => {
						// a tap opens a menu: gameplay off (Guide, recipe 9)
						resumeGameplay ??= input.HfGestures.Request(false);
					},
					{ MaxDuration: 0.5 },
				);
				poke.OnTap(onLast, { MaxDuration: 0.5 });
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1, "the press");
				frames(3);
				poke.Fire(false);
				eventually(() => counts.Released.count === 1, "the release");
				frames(3);
				expectTrue(resumeGameplay !== undefined, "the menu's tap fired");
				expectTrue(
					first.count === 1 && last.count === 1 && longs.size() === 1,
					"'Several gestures on one action are independent: each sees every press' (Advanced, " +
						"Gestures); the release was the player's (Fire(false), the action live as it arrived), " +
						"but one gesture's callback turned the context off, and the gestures that heard the " +
						`release after it took it for a reset: OnTap before ${first.count}, OnTap after ` +
						`${last.count}, OnLongPress ${longs.size()} (each should be 1)`,
				);
			});

			// worker, HF-7: the gestures hear the handle's own signal since the fix, so one made while a
			// press is being passed on (in a Pressed listener; under Immediate signals that runs inside
			// the handle's forward) must still start with the next press
			test("worker, HF-7: a gesture made in a Pressed listener starts with the next press", () => {
				const poke = createGestures().HfGestures.Actions.Poke;
				const counts = edges(poke);
				const longs = new Array<number>();
				let made = false;
				const connection = poke.Pressed.Connect(() => {
					if (made) return;
					made = true;
					poke.OnLongPress((heldFor) => longs.push(heldFor), { Duration: 0.01 });
				});
				defer(() => connection.Disconnect());
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1 && made, "the press");
				frames(3);
				poke.Fire(false);
				eventually(() => counts.Released.count === 1, "the release");
				frames(3);
				expectEqual(longs.size(), 0, "the press in progress when it was made is no part of it");
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 2, "the second press");
				frames(3);
				poke.Fire(false);
				eventually(() => counts.Released.count === 2, "the second release");
				frames(3);
				expectEqual(longs.size(), 1, "the next press is a long press");
			});

			test("probe: OnTap with WaitForDoubleTap: dropped when the context is off at the window's end, kept when back on", () => {
				const input = createGestures();
				const poke = input.HfGestures.Actions.Poke;
				const counts = edges(poke);
				const [single, onSingle] = counter();
				poke.OnTap(onSingle, { WaitForDoubleTap: true, Window: 0.4 });
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1, "the press");
				poke.Fire(false);
				eventually(() => counts.Released.count === 1, "the release");
				const resume = input.HfGestures.Request(false);
				waitSeconds(0.7);
				resume();
				expectEqual(single.count, 0, "the context was off at the window's end: dropped");
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 2, "the second press");
				poke.Fire(false);
				eventually(() => counts.Released.count === 2, "the second release");
				const off = input.HfGestures.Request(false);
				frames(2);
				off();
				waitSeconds(0.7);
				expectEqual(single.count, 1, "off and back on within the window: the tap stays");
			});

			test("probe: FindConflicts with two root handles on one folder: no duplicates, another root's binding as the subject", () => {
				const folder = newFolder();
				const input = InputActions.Create(GESTURE_SCHEMA, {
					Folder: folder,
					ResetOnFocusLoss: false,
				});
				defer(() => input.Destroy());
				const other = InputActions.Create(GESTURE_SCHEMA_EXTRA, {
					Folder: folder,
					ResetOnFocusLoss: false,
				});
				defer(() => other.Destroy());
				const mine = input.HfGestures.Actions.Poke.Bindings.KeyboardAndMouse;
				const theirs = other.HfGestures.Actions.Poke.Bindings.KeyboardAndMouse;
				// the other root handle's extra on N: mine conflicts with it on the other's root only
				theirs.Alt.Set(K.N);
				expectArrayEqual(conflictPaths(input.FindConflicts(mine)), []);
				expectArrayEqual(
					conflictPaths(input.FindConflicts(theirs)),
					[],
					"the same instance as mine",
				);
				expectArrayEqual(conflictPaths(other.FindConflicts(mine)), [
					"HfGestures/Poke/KeyboardAndMouse/Alt",
				]);
				const found = other.FindConflicts();
				expectEqual(
					found.size(),
					1,
					`one pair: ${found.map((pair) => pair.Paths.join(" & ")).join("; ")}`,
				);
				expectTrue(found[0].Identical, "the same key, no modifiers");
			});

			test("probe: PreferredDeviceChanged: PreferredDevice() inside the handler is the device it passes", () => {
				if (getProject() !== "touch")
					return skip("the touch project only: a key and a tap switch devices");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const seen = new Array<string>();
				const connection = InputActions.PreferredDeviceChanged.Connect((device) => {
					seen.push(`${device}=${InputActions.PreferredDevice()}`);
				});
				defer(() => connection.Disconnect());
				real.Click(emptyPoint());
				real.Tap(K.N);
				real.Click(emptyPoint());
				real.Tap(K.U);
				eventually(() => seen.size() >= 3, `the switches: ${seen.join(", ")}`);
				frames(3);
				for (const entry of seen) {
					const [device, read] = entry.split("=");
					expectEqual(read, device, seen.join(", "));
				}
				for (let index = 1; index < seen.size(); index++) {
					expectTrue(
						seen[index] !== seen[index - 1],
						`never the same device twice: ${seen.join(", ")}`,
					);
				}
			});

			test("probe: Describe: an extra, a modifier on a composite, a Touch binding, an unbound one with a DisplayName", () => {
				const schema = InputActions.Schema({
					HfDescribe: {
						Actions: {
							Move: InputActions.Direction2D({
								KeyboardAndMouse: {
									Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D, PrimaryModifier: K.LeftShift },
									Arrows: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
								},
								Touch: K.TouchDelta,
							}),
							Jump: InputActions.Bool({
								KeyboardAndMouse: {
									Main: K.Space,
									Alt: { KeyCode: K.KeypadZero, DisplayName: "Pad 0" },
								},
								Gamepad: { Main: K.ButtonCenter, Alt: {} },
							}),
						},
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder(), ResetOnFocusLoss: false });
				defer(() => input.Destroy());
				const { Move, Jump } = input.HfDescribe.Actions;
				expectEqual(Move.Bindings.KeyboardAndMouse.Describe(), "Shift + (W / A / S / D)");
				expectEqual(Move.Bindings.KeyboardAndMouse.Arrows.Describe(), "Up / Left / Down / Right");
				expectEqual(Move.Describe("Touch"), "Drag");
				expectEqual(Move.Describe("Gamepad"), "");
				expectEqual(Jump.Bindings.KeyboardAndMouse.Alt.Describe(), "Pad 0");
				expectEqual(Jump.Describe("Gamepad"), "Remote Center");
				expectEqual(Jump.Bindings.Gamepad.Alt.Describe(), "");
				Jump.Bindings.KeyboardAndMouse.Alt.Clear();
				const unbound = Jump.Bindings.KeyboardAndMouse.Alt.Describe();
				expectTrue(
					unbound === "Pad 0" || unbound === "",
					`unbound with a DisplayName: "${unbound}"`,
				);
				expectThrows(() => Jump.Describe("Mouse" as never), "not a device");
			});
		});
	}
}
