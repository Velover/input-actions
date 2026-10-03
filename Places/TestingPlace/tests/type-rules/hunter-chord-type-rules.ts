// Hunter round on CaptureChord: typing probes. Checked by plain tsc; each rule stays on the one line
// after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;
type Dir1DType = Enum.InputActionType.Direction1D;
type Dir2DType = Enum.InputActionType.Direction2D;

const HUNT = InputActions.Schema({
	Play: {
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.Space, Virtual: InputActions.Scriptable }),
			Throttle: InputActions.Direction1D({ KeyboardAndMouse: { Up: K.E, Down: K.Q } }),
			Move: InputActions.Direction2D({ KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D } }),
		},
	},
});

// a helper over any binding handle, written against the type before CaptureChord
function resetAll<A extends Enum.InputActionType>(handles: InputActions.BindingHandle<A>[]) {
	for (const handle of handles) {
		handle.Reset();
		handle.Clear();
		handle.Get();
	}
}

// a generic handle widened to any binding handle, as before CaptureChord
function widen<A extends Enum.InputActionType>(
	keys: InputActions.BindingHandle<A>,
): InputActions.BindingHandle<Enum.InputActionType> {
	return keys;
}
function captureKey<A extends BoolType>(keys: InputActions.BindingHandle<A>) {
	return keys.Capture("KeyCode", () => {});
}

// a helper for the chord types, generic over which one
function rebindChord<A extends BoolType | Dir1DType>(keys: InputActions.BindingHandle<A>) {
	// HC-1 (hunter): BindingHandle<A> for a generic A (even one constrained to Bool | Direction1D) is
	// a deferred conditional type, whose members are those of both branches: no CaptureChord, and
	// there was no chord handle type to name instead. Fixed by exporting ChordBindingHandle<A> (below);
	// BindingHandle<A> itself can't resolve for an unresolved A, so this stays an error.
	// @ts-expect-error TS2339 'CaptureChord' does not exist on 'IChordBindingHandle<A> | IBindingHandle<A>'
	return keys.CaptureChord(() => {});
}
// the generic helper names ChordBindingHandle<A>, and takes a Bool's or a Direction1D's handle
function rebindChordTyped<A extends BoolType | Dir1DType>(
	keys: InputActions.ChordBindingHandle<A>,
) {
	return keys.CaptureChord(() => {}, { Timeout: 2 });
}

export function HunterChordTypeRules() {
	const { Jump, Throttle, Move } = InputActions.Create(HUNT).Play.Actions;

	resetAll([Jump.Bindings.KeyboardAndMouse]);
	resetAll([Move.Bindings.KeyboardAndMouse]);
	rebindChord(Jump.Bindings.KeyboardAndMouse);
	rebindChord(Throttle.Bindings.KeyboardAndMouse);
	rebindChordTyped(Jump.Bindings.KeyboardAndMouse);
	rebindChordTyped(Throttle.Bindings.KeyboardAndMouse);
	// @ts-expect-error a Direction2D handle is no ChordBindingHandle
	rebindChordTyped(Move.Bindings.KeyboardAndMouse);

	// a union of the chord types keeps CaptureChord
	const either: InputActions.BindingHandle<BoolType | Dir1DType> = Jump.Bindings.KeyboardAndMouse;
	either.CaptureChord(() => {});
	// any binding handle: a list of mixed ones
	const all: InputActions.BindingHandle<Enum.InputActionType>[] = [
		Jump.Bindings.KeyboardAndMouse,
		Throttle.Bindings.KeyboardAndMouse,
		Move.Bindings.KeyboardAndMouse,
	];
	// a union with a type that has no chord: no CaptureChord
	const mixed: InputActions.BindingHandle<BoolType | Dir2DType> = Jump.Bindings.KeyboardAndMouse;
	// @ts-expect-error Direction2D is among the types: no CaptureChord
	mixed.CaptureChord(() => {});
	// Cancel keys from a readonly list
	const cancel = [K.Backspace] as const;
	Jump.Bindings.KeyboardAndMouse.CaptureChord(() => {}, { Cancel: [...cancel], Timeout: 2 });

	return [all, widen, captureKey];
}
