import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { UserInputService } from "@rbxts/services";
import { createTestInput, frames, recordSignal } from "./helpers";
import { emptyPoint, RealInput, realInput } from "./virtual";

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

/** Waits a few frames and checks the callback stayed silent */
function staysSilent(outcomes: Outcome[], what: string, real: RealInput) {
	frames(6);
	expectEqual(outcomes.size(), 0, `${what}${real.FocusNote()}`);
}

/**
 * `BindingHandle.CaptureChord` (0.6.1) with real keys through VirtualInput. Keys are picked clear of
 * what the player scripts sink or toggle (no Shift, I, O, arrows) and of the test schema's bindings.
 */
@Provider({ activeIn: ["testing"] })
export class CaptureChordTests implements OnStart {
	onStart() {
		defineTests("capture-chord", () => {
			test("the first key up settles the chord: the last key down is KeyCode, the ones before the modifiers", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				const changes = recordSignal(input.BindingsChanged);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.G, K.H]);
				staysSilent(outcomes, "nothing while every key is down", real);
				real.Release(K.H);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				const chord = expectDefined(outcomes[0].chord, "a chord");
				expectEqual(chord.KeyCode, K.H);
				expectEqual(chord.PrimaryModifier, K.LeftControl);
				expectEqual(chord.SecondaryModifier, K.G);
				expectEqual(keys.Instance.KeyCode, K.H);
				expectEqual(keys.Instance.PrimaryModifier, K.LeftControl);
				expectEqual(keys.Instance.SecondaryModifier, K.G);
				const data = keys.Get();
				expectEqual(data.PrimaryModifier, K.LeftControl);
				expectEqual(data.SecondaryModifier, K.G);
				expectEqual(
					changes.filter((path) => path === "Gameplay/Jump/KeyboardAndMouse").size(),
					1,
					"one BindingsChanged",
				);
				real.ReleaseAll();
				frames(2);
				expectEqual(outcomes.size(), 1, "the capture is over");
				// the chord presses Jump; Space no longer does
				hold(real, [K.LeftControl, K.G, K.H]);
				eventually(() => jump.IsPressed(), `the chord presses Jump${real.FocusNote()}`);
				real.ReleaseAll();
				eventually(() => !jump.IsPressed(), "released");
				real.Press(K.Space);
				frames(4);
				expectFalse(jump.IsPressed(), "Space is no longer Jump's");
				real.Release(K.Space);
			});

			test("a modifier coming up first settles the same chord", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.G]);
				real.Release(K.LeftControl);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				const chord = expectDefined(outcomes[0].chord, "a chord");
				expectEqual(chord.KeyCode, K.G);
				expectEqual(chord.PrimaryModifier, K.LeftControl);
				expectEqual(chord.SecondaryModifier, undefined);
				expectEqual(keys.Instance.SecondaryModifier, K.None);
			});

			test("one key alone clears the binding's modifiers", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				// QuickSave is Ctrl+S
				const keys = createTestInput().Gameplay.Actions.QuickSave.Bindings.KeyboardAndMouse;
				expectEqual(keys.Instance.PrimaryModifier, K.LeftControl);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				real.Tap(K.J);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				const chord = expectDefined(outcomes[0].chord, "a chord");
				expectEqual(chord.KeyCode, K.J);
				expectEqual(chord.PrimaryModifier, undefined);
				expectEqual(keys.Instance.KeyCode, K.J);
				expectEqual(keys.Instance.PrimaryModifier, K.None);
				expectEqual(keys.Instance.SecondaryModifier, K.None);
			});

			test("four keys are ignored; the next chord counts once all of them are up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.G, K.H, K.J, K.K]);
				real.Release(K.K);
				staysSilent(outcomes, "four keys settle nothing", real);
				// the leftovers coming up settle nothing, even the last one alone
				real.Release(K.J);
				real.Release(K.H);
				staysSilent(outcomes, "leftovers settle nothing", real);
				// a key pressed while a leftover is still down doesn't count either
				real.Tap(K.U);
				staysSilent(outcomes, "a key pressed among the leftovers", real);
				real.Release(K.G);
				staysSilent(outcomes, "the last leftover", real);
				expectEqual(keys.Instance.KeyCode, K.Space, "the binding is untouched");
				real.Tap(K.Y);
				eventually(() => outcomes.size() === 1, `the next chord counts${real.FocusNote()}`);
				expectEqual(expectDefined(outcomes[0].chord, "a chord").KeyCode, K.Y);
				expectEqual(keys.Instance.KeyCode, K.Y);
			});

			test("a mouse button can't be a modifier: that chord is ignored", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				real.MouseDown(emptyPoint());
				frames(2);
				real.Tap(K.G);
				staysSilent(outcomes, "a mouse button (a touch on a phone) and G settle nothing", real);
				real.MouseUp();
				staysSilent(outcomes, "the mouse button coming up after settles nothing", real);
				expectEqual(keys.Instance.KeyCode, K.Space);
				real.Tap(K.H);
				eventually(() => outcomes.size() === 1, `the next chord counts${real.FocusNote()}`);
				expectEqual(keys.Instance.KeyCode, K.H);
			});

			test("a key down before the capture began is no part of a chord", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				real.Press(K.G);
				// VirtualInput's key can land a few frames later (42 ms in, under `immediate`, it
				// had not): wait until the engine has it, and its InputBegan has gone out
				eventually(() => UserInputService.IsKeyDown(K.G), "G is down");
				frames(3);
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				real.Tap(K.H);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				const chord = expectDefined(outcomes[0].chord, "a chord");
				expectEqual(chord.KeyCode, K.H);
				expectEqual(chord.PrimaryModifier, undefined, "G was down before the capture");
				real.Release(K.G);
				frames(4);
				expectEqual(outcomes.size(), 1);
			});

			test("a Cancel key ends it with undefined and no change; the returned function ends it silently", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Cancel: [K.Delete] });
				real.Press(K.G);
				frames(2);
				real.Tap(K.Delete);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				expectEqual(outcomes[0].chord, undefined);
				real.Release(K.G);
				real.Tap(K.H);
				expectEqual(outcomes.size(), 1, "the capture is over");
				expectEqual(keys.Instance.KeyCode, K.Space);

				const later = new Array<Outcome>();
				const stop = keys.CaptureChord((chord) => later.push({ chord }));
				stop();
				stop(); // twice is fine
				real.Tap(K.J);
				expectEqual(later.size(), 0);
				expectEqual(keys.Instance.KeyCode, K.Space);
			});

			test("Timeout: the keys held when it runs out settle the chord, while still held", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				const started = os.clock();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Timeout: 0.5 });
				hold(real, [K.LeftControl, K.G]);
				eventually(() => outcomes.size() === 1, `the timeout settles it${real.FocusNote()}`, 3);
				expectTrue(os.clock() - started >= 0.45, "not before the timeout");
				const chord = expectDefined(outcomes[0].chord, "a chord");
				expectEqual(chord.KeyCode, K.G);
				expectEqual(chord.PrimaryModifier, K.LeftControl);
				expectEqual(keys.Instance.KeyCode, K.G);
				real.ReleaseAll();
				frames(4);
				expectEqual(outcomes.size(), 1, "the releases after settle nothing more");
			});

			test("Timeout: nothing held, or a chord the binding can't hold, ends with undefined", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const empty = new Array<Outcome>();
				keys.CaptureChord((chord) => empty.push({ chord }), { Timeout: 0.3 });
				eventually(() => empty.size() === 1, "the timeout ends it", 3);
				expectEqual(empty[0].chord, undefined);

				const tooMany = new Array<Outcome>();
				keys.CaptureChord((chord) => tooMany.push({ chord }), { Timeout: 0.5 });
				hold(real, [K.G, K.H, K.J, K.K]);
				eventually(() => tooMany.size() === 1, `the timeout ends it${real.FocusNote()}`, 3);
				expectEqual(tooMany[0].chord, undefined);
				expectEqual(keys.Instance.KeyCode, K.Space, "the binding is untouched");
			});

			test("Timeout: a release before it settles at once, and the timeout then does nothing", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Timeout: 0.4 });
				real.Tap(K.J);
				eventually(() => outcomes.size() === 1, `the release settles it${real.FocusNote()}`);
				task.wait(0.6);
				expectEqual(outcomes.size(), 1, "one callback");
				expectEqual(keys.Instance.KeyCode, K.J);
			});

			test("Timeout must be a positive number of seconds", () => {
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				for (const timeout of [0, -1, math.huge, 0 / 0]) {
					expectThrows(
						() => keys.CaptureChord(() => {}, { Timeout: timeout }),
						`Timeout ${timeout}`,
					);
				}
				expectEqual(keys.Instance.KeyCode, K.Space);
			});

			test("Direction1D: the chord replaces a composite binding, and drives the action", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const zoom = createTestInput().Gameplay.Actions.Zoom;
				// PageUp/PageDown, a composite on the keyboard (the gamepad's DPadUp/DPadDown composite
				// takes gamepad keys only)
				const keys = zoom.Bindings.KeyboardAndMouse;
				keys.Set({ Up: K.PageUp, Down: K.PageDown });
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.K]);
				real.Release(K.K);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				real.ReleaseAll();
				expectEqual(keys.Instance.KeyCode, K.K);
				expectEqual(keys.Instance.PrimaryModifier, K.LeftControl);
				expectEqual(keys.Instance.Up, K.None, "the composite is gone");
				expectEqual(keys.Instance.Down, K.None);
				frames(2);
				hold(real, [K.LeftControl, K.K]);
				eventually(() => zoom.GetState() === 1, `the chord drives Zoom${real.FocusNote()}`);
				real.ReleaseAll();
				eventually(() => zoom.GetState() === 0, "at rest");
			});

			test("other action types throw at runtime too", () => {
				const actions = createTestInput().Gameplay.Actions;
				const bindings: unknown[] = [
					actions.Move.Bindings.KeyboardAndMouse,
					actions.Fly.Bindings.KeyboardAndMouse,
					actions.Aim.Bindings.KeyboardAndMouse,
				];
				for (const binding of bindings) {
					const untyped = binding as { CaptureChord: (callback: () => void) => () => void };
					expectThrows(() => untyped.CaptureChord(() => {}));
				}
			});

			test("a captured chord is saved, and comes back from the save", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const keys = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }));
				hold(real, [K.LeftControl, K.G, K.H]);
				real.Release(K.H);
				eventually(() => outcomes.size() === 1, `the callback${real.FocusNote()}`);
				real.ReleaseAll();
				const save = input.ExportBindings();
				input.ResetBindings();
				expectEqual(keys.Instance.KeyCode, K.Space);
				expectEqual(keys.Instance.PrimaryModifier, K.None);
				const result = input.ImportBindings(save);
				expectEqual(result.Skipped.size(), 0, save);
				expectEqual(keys.Instance.KeyCode, K.H);
				expectEqual(keys.Instance.PrimaryModifier, K.LeftControl);
				expectEqual(keys.Instance.SecondaryModifier, K.G);
			});

			test("the callback isn't called after the handle is destroyed", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const keys = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const outcomes = new Array<Outcome>();
				keys.CaptureChord((chord) => outcomes.push({ chord }), { Timeout: 0.3 });
				input.Destroy();
				real.Tap(K.G);
				task.wait(0.5);
				expectEqual(outcomes.size(), 0);
			});
		});
	}
}
