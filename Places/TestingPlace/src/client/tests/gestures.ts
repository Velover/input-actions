import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectFalse,
	expectNoThrow,
	expectThrows,
	expectTrue,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players, RunService, UserInputService } from "@rbxts/services";
import { frames, newFolder } from "./helpers";
import { RealInput, realInput, testGui } from "./virtual";

const K = Enum.KeyCode;
const BOOL = Enum.InputActionType.Bool;

/**
 * Keys no player script nor other section takes (CLAUDE.md: not Left, Right, I, O, LeftShift, F, H),
 * in a context above the PlayerModule's and the template other sections leave enabled
 */
const GESTURES_SCHEMA = InputActions.Schema({
	Gestures: {
		Priority: 3000,
		Actions: {
			Poke: InputActions.Bool({ KeyboardAndMouse: K.N }),
			Move: InputActions.Direction2D({ KeyboardAndMouse: { Up: K.Y, Down: K.V } }),
		},
	},
});

/** The gesture schema in a fresh folder; `ResetOnFocusLoss` off unless a test is about it */
function createGestures(resetOnFocusLoss = false) {
	const input = InputActions.Create(GESTURES_SCHEMA, {
		Folder: newFolder(),
		ResetOnFocusLoss: resetOnFocusLoss,
	});
	defer(() => input.Destroy());
	return input;
}

/** Waits `seconds` of `os.clock` time */
function wait(seconds: number) {
	const deadline = os.clock() + seconds;
	while (os.clock() < deadline) RunService.Heartbeat.Wait();
}

/** Presses `key` and waits until the handle has told its listeners (Pressed) */
function press(real: RealInput, key: Enum.KeyCode, pressed: { count: number }) {
	const before = pressed.count;
	real.Press(key);
	eventually(() => pressed.count > before, `${key.Name}'s Pressed${real.FocusNote()}`);
}

/** Releases `key` and waits until the handle has told its listeners (Released) */
function release(real: RealInput, key: Enum.KeyCode, released: { count: number }) {
	const before = released.count;
	real.Release(key);
	eventually(() => released.count > before, `${key.Name}'s Released${real.FocusNote()}`);
}

/** Counts a handle's Pressed and Released until the test ends */
function edges(action: InputActions.BoolAction) {
	const pressed = { count: 0 };
	const released = { count: 0 };
	const connections = [
		action.Pressed.Connect(() => pressed.count++),
		action.Released.Connect(() => released.count++),
	];
	defer(() => connections.forEach((connection) => connection.Disconnect()));
	return { Pressed: pressed, Released: released };
}

/** A press of `key` held for about `seconds` (from its Pressed), then released */
function holdFor(
	real: RealInput,
	key: Enum.KeyCode,
	seconds: number,
	counts: ReturnType<typeof edges>,
) {
	press(real, key, counts.Pressed);
	wait(seconds);
	release(real, key, counts.Released);
}

/** A quick press: released two frames after its Pressed */
function tap(real: RealInput, key: Enum.KeyCode, counts: ReturnType<typeof edges>) {
	press(real, key, counts.Pressed);
	frames(2);
	release(real, key, counts.Released);
}

/** A counter a gesture's callback adds to */
function counter() {
	const count = { count: 0 };
	return [count, () => count.count++] as const;
}

/** A TextBox in a test GUI */
function newTextBox() {
	const box = new Instance("TextBox");
	box.Size = UDim2.fromOffset(100, 30);
	box.Parent = testGui("InputActionsGestures");
	return box;
}

/**
 * Gestures on Bool actions (0.7.0, F4): tap, double tap, hold, long press, each a function of the
 * handle's own Pressed and Released, timed with os.clock. Real keys through VirtualInput; the
 * durations are the tests' own options, with margins wide enough for a busy machine
 */
@Provider({ activeIn: ["testing"] })
export class GesturesTests implements OnStart {
	onStart() {
		defineTests("gestures", () => {
			test("OnTap: a short press is a tap, a long one isn't; the function stops it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const poke = createGestures().Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const stop = poke.OnTap(onTap, { MaxDuration: 0.5 });
				tap(real, K.N, counts);
				eventually(() => taps.count === 1, `a tap${real.FocusNote()}`);
				holdFor(real, K.N, 0.9, counts);
				frames(3);
				expectEqual(taps.count, 1, `a press held 0.9 s is no tap${real.FocusNote()}`);
				stop();
				tap(real, K.N, counts);
				frames(3);
				expectEqual(taps.count, 1, "stopped");
			});

			test("OnTap with WaitForDoubleTap and OnDoubleTap exclude each other; a plain OnTap hears both taps", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const poke = createGestures().Gestures.Actions.Poke;
				const counts = edges(poke);
				const window = 0.6;
				const [single, onSingle] = counter();
				const [double, onDouble] = counter();
				const [every, onEvery] = counter();
				poke.OnTap(onSingle, { WaitForDoubleTap: true, Window: window, MaxDuration: 0.5 });
				poke.OnDoubleTap(onDouble, { Window: window, MaxDuration: 0.5 });
				poke.OnTap(onEvery, { MaxDuration: 0.5 });
				// one tap: the plain one at once, the waiting one once the window has passed
				tap(real, K.N, counts);
				eventually(() => every.count === 1, `the plain tap${real.FocusNote()}`);
				expectEqual(single.count, 0, "waits for the window");
				wait(window + 0.4);
				expectEqual(single.count, 1, `one tap after the window${real.FocusNote()}`);
				expectEqual(double.count, 0);
				// a double tap: fires at the second press, and is no single tap
				tap(real, K.N, counts);
				press(real, K.N, counts.Pressed);
				expectEqual(double.count, 1, `the double tap, at the second press${real.FocusNote()}`);
				frames(2);
				release(real, K.N, counts.Released);
				wait(window + 0.4);
				expectEqual(double.count, 1);
				expectEqual(single.count, 1, `no single tap for a double tap${real.FocusNote()}`);
				expectEqual(every.count, 3, "the plain OnTap hears both taps of it");
			});

			test("OnDoubleTap: two taps too far apart, or a long first press, are no double tap", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const poke = createGestures().Gestures.Actions.Poke;
				const counts = edges(poke);
				const [double, onDouble] = counter();
				poke.OnDoubleTap(onDouble, { Window: 0.5, MaxDuration: 0.5 });
				tap(real, K.N, counts);
				wait(1.1);
				tap(real, K.N, counts);
				frames(3);
				expectEqual(double.count, 0, `1.1 s apart${real.FocusNote()}`);
				// a long press, then a quick one: the first is no tap
				wait(1.1);
				holdFor(real, K.N, 0.9, counts);
				tap(real, K.N, counts);
				frames(3);
				expectEqual(double.count, 0, `a long first press${real.FocusNote()}`);
				// and a real one still counts
				wait(1.1);
				tap(real, K.N, counts);
				tap(real, K.N, counts);
				eventually(() => double.count === 1, `a double tap${real.FocusNote()}`);
			});

			test("OnHold: fires once while held, Progress each frame from 0 to 1; released early, Cancelled", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const poke = createGestures().Gestures.Actions.Poke;
				const counts = edges(poke);
				const [held, onHeld] = counter();
				const [cancelled, onCancelled] = counter();
				const fractions = new Array<number>();
				let heldWhilePressed = false;
				poke.OnHold(
					() => {
						onHeld();
						heldWhilePressed = poke.IsPressed();
					},
					{
						Duration: 0.6,
						Progress: (fraction) => fractions.push(fraction),
						Cancelled: onCancelled,
					},
				);
				press(real, K.N, counts.Pressed);
				eventually(() => held.count === 1, `the hold${real.FocusNote()}`, 5);
				expectTrue(heldWhilePressed, "fired while still held");
				const atCompletion = fractions.size();
				frames(5);
				expectEqual(fractions.size(), atCompletion, "no Progress once complete");
				release(real, K.N, counts.Released);
				frames(3);
				expectEqual(held.count, 1);
				expectEqual(cancelled.count, 0, "released after the hold: no Cancelled");
				expectEqual(fractions[0], 0, "0 at the press");
				expectEqual(fractions[fractions.size() - 1], 1, "1 as it completes");
				expectTrue(fractions.size() >= 4, `a fraction each frame: ${fractions.size()}`);
				for (let index = 1; index < fractions.size(); index++) {
					const fraction = fractions[index];
					expectTrue(
						fraction >= fractions[index - 1] && fraction <= 1,
						`rising: ${fractions.join(", ")}`,
					);
				}
				// a short press: Cancelled, Progress back to 0
				const [longHeld, onLongHeld] = counter();
				const [longCancelled, onLongCancelled] = counter();
				const longFractions = new Array<number>();
				poke.OnHold(onLongHeld, {
					Duration: 3,
					Progress: (fraction) => longFractions.push(fraction),
					Cancelled: onLongCancelled,
				});
				holdFor(real, K.N, 0.2, counts);
				eventually(() => longCancelled.count === 1, `Cancelled${real.FocusNote()}`);
				expectEqual(longHeld.count, 0);
				expectEqual(longFractions[longFractions.size() - 1], 0, "back to 0");
				const atCancel = longFractions.size();
				frames(5);
				expectEqual(longFractions.size(), atCancel, "no Progress once released");
			});

			test("OnLongPress: fires on release with the time held; a shorter press doesn't", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const poke = createGestures().Gestures.Actions.Poke;
				const counts = edges(poke);
				const heldFor = new Array<number>();
				poke.OnLongPress((seconds) => heldFor.push(seconds), { Duration: 0.8 });
				holdFor(real, K.N, 0.15, counts);
				frames(3);
				expectEqual(heldFor.size(), 0, `0.15 s is no long press${real.FocusNote()}`);
				press(real, K.N, counts.Pressed);
				wait(1.3);
				expectEqual(heldFor.size(), 0, "not while held");
				release(real, K.N, counts.Released);
				eventually(() => heldFor.size() === 1, `the long press${real.FocusNote()}`);
				expectTrue(heldFor[0] >= 0.8 && heldFor[0] < 5, `held ${heldFor[0]} s`);
			});

			test("several gestures on one action: a tap is no hold or long press, a long press is no tap", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const poke = createGestures().Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const [holds, onHold] = counter();
				const [cancels, onCancel] = counter();
				const [longs, onLong] = counter();
				poke.OnTap(onTap, { MaxDuration: 0.4 });
				poke.OnHold(onHold, { Duration: 0.8, Cancelled: onCancel });
				poke.OnLongPress(onLong, { Duration: 0.8 });
				tap(real, K.N, counts);
				eventually(() => taps.count === 1, `the tap${real.FocusNote()}`);
				eventually(() => cancels.count === 1, "the hold it began is cancelled");
				expectEqual(holds.count, 0);
				expectEqual(longs.count, 0);
				holdFor(real, K.N, 1.4, counts);
				eventually(() => longs.count === 1, `the long press${real.FocusNote()}`);
				expectEqual(holds.count, 1, "and the hold, while it was held");
				expectEqual(taps.count, 1, "no tap");
				expectEqual(cancels.count, 1);
			});

			test("a context disabled mid-gesture ends it as a reset: no tap, no long press, Hold's Cancelled", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createGestures();
				const poke = input.Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const [longs, onLong] = counter();
				const [holds, onHold] = counter();
				const [cancels, onCancel] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnLongPress(onLong, { Duration: 0.3 });
				poke.OnHold(onHold, { Duration: 5, Cancelled: onCancel });
				press(real, K.N, counts.Pressed);
				wait(0.5);
				input.Gestures.SetEnabled(false);
				eventually(() => counts.Released.count === 1, `released by the disable${real.FocusNote()}`);
				eventually(() => cancels.count === 1, "Hold's Cancelled");
				frames(3);
				expectEqual(taps.count, 0, "no tap");
				expectEqual(longs.count, 0, "no long press");
				input.Gestures.SetEnabled(true);
				real.Release(K.N);
				frames(3);
				// a Request(false), and the action's own SetEnabled(false): the same
				press(real, K.N, counts.Pressed);
				wait(0.5);
				const stopRequest = input.Gestures.Request(false);
				eventually(() => cancels.count === 2, `the request${real.FocusNote()}`);
				stopRequest();
				real.Release(K.N);
				frames(3);
				press(real, K.N, counts.Pressed);
				wait(0.5);
				poke.SetEnabled(false);
				eventually(() => cancels.count === 3, `the action disabled${real.FocusNote()}`);
				poke.SetEnabled(true);
				real.Release(K.N);
				frames(3);
				expectEqual(taps.count, 0);
				expectEqual(longs.count, 0);
				// a tap afterwards is a tap
				tap(real, K.N, counts);
				eventually(() => taps.count === 1, `a tap after the resets${real.FocusNote()}`);
				expectEqual(holds.count, 0);
			});

			test("a rebind while held ends the gesture as a reset too", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const poke = createGestures().Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const [longs, onLong] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnLongPress(onLong, { Duration: 0.2 });
				press(real, K.N, counts.Pressed);
				wait(0.4);
				poke.Bindings.KeyboardAndMouse.Set(K.Z);
				eventually(() => counts.Released.count === 1, `IAS released it${real.FocusNote()}`);
				real.Release(K.N);
				frames(3);
				expectEqual(taps.count, 0);
				expectEqual(longs.count, 0);
				tap(real, K.Z, counts);
				eventually(() => taps.count === 1, `the new key's tap${real.FocusNote()}`);
			});

			test("the focus-loss reset mid-gesture ends it as a reset", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const poke = createGestures(true).Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const [longs, onLong] = counter();
				const [cancels, onCancel] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnLongPress(onLong, { Duration: 0.2 });
				poke.OnHold(() => {}, { Duration: 5, Cancelled: onCancel });
				press(real, K.N, counts.Pressed);
				wait(0.4);
				const box = newTextBox();
				box.CaptureFocus();
				defer(() => box.ReleaseFocus());
				eventually(() => cancels.count === 1, `the reset${real.FocusNote()}`);
				box.ReleaseFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === undefined, "the focus released");
				real.Release(K.N);
				frames(3);
				expectEqual(taps.count, 0);
				expectEqual(longs.count, 0);
			});

			test("the Server Authority swap mid-gesture: the press the copy doesn't carry ends as a reset", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				// the server's copy, played on the client (as the server-authority section does)
				const folder = new Instance("Folder");
				folder.Name = "InputsGestureCopy";
				const copy = new Instance("InputContext");
				copy.Name = "SaGestures";
				const copyAction = new Instance("InputAction");
				copyAction.Name = "Poke";
				copyAction.Type = BOOL;
				copyAction.Parent = copy;
				defer(() => folder.Destroy());
				const schema = InputActions.Schema({
					SaGestures: {
						ServerAuthority: true,
						Priority: 3000,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.N }) },
					},
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: folder.Name,
					Timeout: 1000,
					ResetOnFocusLoss: false,
				});
				defer(() => input.Destroy());
				const context = input.SaGestures;
				const poke = context.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const [longs, onLong] = counter();
				const [holds, onHold] = counter();
				const [cancels, onCancel] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnLongPress(onLong, { Duration: 0.2 });
				poke.OnHold(onHold, { Duration: 5, Cancelled: onCancel });
				expectFalse(context.IsLinkedToServer());
				press(real, K.N, counts.Pressed);
				wait(0.4);
				copy.Parent = folder;
				folder.Parent = Players.LocalPlayer;
				eventually(() => context.IsLinkedToServer(), "the swap");
				eventually(() => cancels.count === 1, `the swap's release${real.FocusNote()}`);
				real.Release(K.N);
				frames(3);
				expectEqual(taps.count, 0, "no tap");
				expectEqual(longs.count, 0, "no long press");
				expectEqual(holds.count, 0);
				// on the copy, a tap is a tap (its state moves on simulation steps under authority)
				press(real, K.N, counts.Pressed);
				eventually(() => poke.IsPressed(), `pressed on the copy${real.FocusNote()}`);
				frames(2);
				release(real, K.N, counts.Released);
				eventually(() => taps.count === 1, `the tap on the copy${real.FocusNote()}`);
			});

			test("Destroy ends every gesture: a hold in progress calls nothing more", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = InputActions.Create(GESTURES_SCHEMA, {
					Folder: newFolder(),
					ResetOnFocusLoss: false,
				});
				let destroyed = false;
				defer(() => {
					if (!destroyed) input.Destroy();
				});
				const poke = input.Gestures.Actions.Poke;
				const counts = edges(poke);
				const calls = new Array<string>();
				poke.OnTap(() => calls.push("tap"), { MaxDuration: 5 });
				poke.OnLongPress(() => calls.push("long"), { Duration: 0.1 });
				poke.OnHold(() => calls.push("hold"), {
					Duration: 1,
					Progress: () => calls.push("progress"),
					Cancelled: () => calls.push("cancelled"),
				});
				press(real, K.N, counts.Pressed);
				wait(0.3);
				input.Destroy();
				destroyed = true;
				const atDestroy = calls.size();
				wait(1.2);
				real.Release(K.N);
				frames(3);
				expectEqual(calls.size(), atDestroy, `nothing after Destroy: ${calls.join(", ")}`);
				expectFalse(calls.includes("cancelled") || calls.includes("hold") || calls.includes("tap"));
				expectNoThrow(() => poke.OnTap(() => {})(), "OnTap after Destroy");
			});

			test("taps and holds through Fire and Tap, the code's presses", () => {
				const poke = createGestures().Gestures.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				const longs = new Array<number>();
				poke.OnTap(onTap, { MaxDuration: 0.5 });
				poke.OnLongPress((seconds) => longs.push(seconds), { Duration: 0.3 });
				poke.Tap();
				eventually(() => taps.count === 1, "Tap() is a tap");
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 2, "the press");
				wait(0.6);
				poke.Fire(false);
				eventually(() => longs.size() === 1, "a long press");
				expectEqual(taps.count, 1);
			});

			test("bad options throw, and the gestures are a Bool action's", () => {
				const actions = createGestures().Gestures.Actions;
				const poke = actions.Poke;
				const contains = (message: string, part: string) =>
					expectTrue(message.find(part, 1, true)[0] !== undefined, message);
				for (const value of [0, -1, 0 / 0, math.huge, "0.2" as unknown as number]) {
					contains(
						expectThrows(() => poke.OnTap(() => {}, { MaxDuration: value }), tostring(value)),
						"Poke: OnTap's MaxDuration must be a positive number of seconds",
					);
				}
				contains(
					expectThrows(() => poke.OnDoubleTap(() => {}, { Window: 0 }), "Window 0"),
					"OnDoubleTap's Window must be a positive number of seconds",
				);
				contains(
					expectThrows(
						() => poke.OnTap(() => {}, { WaitForDoubleTap: true, Window: -1 }),
						"Window -1",
					),
					"OnTap's Window must be a positive number of seconds",
				);
				contains(
					expectThrows(() => poke.OnHold(() => {}, undefined as never), "no options"),
					"OnHold needs its options, { Duration }",
				);
				contains(
					expectThrows(() => poke.OnHold(() => {}, { Duration: 0 }), "Duration 0"),
					"OnHold's Duration must be a positive number of seconds",
				);
				contains(
					expectThrows(
						() => poke.OnHold(() => {}, { Duration: 1, Progress: 5 as never }),
						"Progress 5",
					),
					"OnHold's Progress must be a function",
				);
				contains(
					expectThrows(() => poke.OnLongPress(() => {}, {} as never), "no Duration"),
					"OnLongPress's Duration must be a positive number of seconds",
				);
				contains(
					expectThrows(() => poke.OnTap(undefined as never), "no callback"),
					"OnTap's callback must be a function",
				);
				const move = actions.Move as unknown as InputActions.BoolAction;
				contains(
					expectThrows(() => move.OnTap(() => {}), "on a Direction2D action"),
					"Move: OnTap needs a Bool action, not Direction2D",
				);
				const stops = [
					poke.OnTap(() => {}),
					poke.OnDoubleTap(() => {}),
					poke.OnHold(() => {}, { Duration: 1 }),
					poke.OnLongPress(() => {}, { Duration: 1 }),
				];
				for (const stop of stops) {
					stop();
					stop();
				}
			});
		});
	}
}
