// CaptureChord (0.6.1): which binding handles have it, and its types. Checked by plain tsc; each
// rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;

const CHORDS = InputActions.Schema({
	Play: {
		Actions: {
			Jump: InputActions.Bool({ Keys: K.Space, Virtual: InputActions.Scriptable }),
			Throttle: InputActions.Direction1D({ Keys: { Up: K.E, Down: K.Q } }),
			Move: InputActions.Direction2D({ Keys: { Up: K.W, Down: K.S, Left: K.A, Right: K.D } }),
			Fly: InputActions.Direction3D({ Keys: { Up: K.E } }),
			Aim: InputActions.ViewportPosition({ Pointer: K.MousePosition }),
		},
	},
});

export function CaptureChordTypeRules() {
	const { Jump, Throttle, Move, Fly, Aim } = InputActions.Create(CHORDS).Play.Actions;

	// ---- what must compile, with the types it must have
	const stop: () => void = Jump.Bindings.Keys.CaptureChord(
		(chord) => {
			const key: Enum.KeyCode | undefined = chord?.KeyCode;
			const primary: Enum.KeyCode | undefined = chord?.PrimaryModifier;
			const secondary: Enum.KeyCode | undefined = chord?.SecondaryModifier;
			return [key, primary, secondary];
		},
		{ Cancel: [K.Backspace], Timeout: 3 },
	);
	Throttle.Bindings.Keys.CaptureChord(() => {});
	const rebind = (keys: InputActions.BindingHandle<Enum.InputActionType.Bool>) =>
		keys.CaptureChord(() => {});
	rebind(Jump.Bindings.Keys);
	const chord: InputActions.Chord = { KeyCode: K.G, PrimaryModifier: K.LeftControl };
	const options: InputActions.ChordCaptureOptions = { Timeout: 1, Cancel: [K.Backspace] };
	// Capture is still there, as before
	Jump.Bindings.Keys.Capture("PrimaryModifier", () => {});

	// ---- what must not compile
	// @ts-expect-error Direction2D's KeyCode takes sticks and deltas, which a chord can't end on
	Move.Bindings.Keys.CaptureChord(() => {});
	// @ts-expect-error Direction3D bindings have no KeyCode
	Fly.Bindings.Keys.CaptureChord(() => {});
	// @ts-expect-error ViewportPosition bindings have no modifiers
	Aim.Bindings.Pointer.CaptureChord(() => {});
	// @ts-expect-error a Scriptable binding has no CaptureChord
	Jump.Bindings.Virtual.CaptureChord(() => {});
	// @ts-expect-error the callback's chord is undefined when the capture ends with nothing
	Jump.Bindings.Keys.CaptureChord((captured) => captured.KeyCode);
	// @ts-expect-error Timeout is a number of seconds
	Jump.Bindings.Keys.CaptureChord(() => {}, { Timeout: "3" });
	const moveRebind = (keys: InputActions.BindingHandle<Enum.InputActionType.Direction2D>) =>
		// @ts-expect-error the binding handle type of a Direction2D action has no CaptureChord
		keys.CaptureChord(() => {});

	return [stop, chord, options, moveRebind];
}
