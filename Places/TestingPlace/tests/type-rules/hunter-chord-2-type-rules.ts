// Hunter round 2 on CaptureChord: typing probes for ChordBindingHandle<A> (HC-1's fix). Checked by
// plain tsc; each rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;
type Dir1DType = Enum.InputActionType.Direction1D;
type Dir2DType = Enum.InputActionType.Direction2D;

const HUNT2 = InputActions.Schema({
	Play: {
		Actions: {
			Jump: InputActions.Bool({ Keys: K.Space, Virtual: InputActions.Scriptable }),
			Throttle: InputActions.Direction1D({ Keys: { Up: K.E, Down: K.Q } }),
			Move: InputActions.Direction2D({ Keys: { Up: K.W, Down: K.S, Left: K.A, Right: K.D } }),
		},
	},
});

// a rebinding panel generic over the chord types uses the whole handle, not only CaptureChord
function rebindPanel<A extends BoolType | Dir1DType>(keys: InputActions.ChordBindingHandle<A>) {
	keys.Capture("KeyCode", () => {});
	keys.Capture("PrimaryModifier", () => {}, { Cancel: [K.Delete] });
	keys.Clear("SecondaryModifier");
	keys.Clear();
	keys.Reset();
	keys.Get();
	return keys.CaptureChord(
		(chord) => {
			if (chord !== undefined) print(chord.KeyCode, chord.PrimaryModifier);
		},
		{ Cancel: [K.Delete], Timeout: 3 },
	);
}

// a generic chord handle handed on to helpers written against BindingHandle
function resetOne<A extends Enum.InputActionType>(keys: InputActions.BindingHandle<A>) {
	keys.Reset();
}
function resetAny(keys: InputActions.BindingHandle<Enum.InputActionType>) {
	keys.Reset();
}
function handOn<A extends BoolType | Dir1DType>(keys: InputActions.ChordBindingHandle<A>) {
	resetOne(keys);
	resetAny(keys);
}

// @ts-expect-error a Direction2D binding has no chord handle
type NoChord2D = InputActions.ChordBindingHandle<Dir2DType>;
// @ts-expect-error nor does any action type at all
type NoChordAny = InputActions.ChordBindingHandle<Enum.InputActionType>;

export function HunterChord2TypeRules() {
	const { Jump, Throttle, Move } = InputActions.Create(HUNT2).Play.Actions;

	rebindPanel(Jump.Bindings.Keys);
	rebindPanel(Throttle.Bindings.Keys);
	handOn(Jump.Bindings.Keys);
	handOn(Throttle.Bindings.Keys);
	// @ts-expect-error a Scriptable binding is no chord handle
	rebindPanel(Jump.Bindings.Virtual);
	// @ts-expect-error nor is a Direction2D one
	rebindPanel(Move.Bindings.Keys);

	// a concrete handle is the chord handle of its type, both ways
	const jumpKeys: InputActions.ChordBindingHandle<BoolType> = Jump.Bindings.Keys;
	const backAgain: InputActions.BindingHandle<BoolType> = jumpKeys;
	const throttleKeys: InputActions.ChordBindingHandle<Dir1DType> = Throttle.Bindings.Keys;
	// a list over both chord types
	const panel: InputActions.ChordBindingHandle<BoolType | Dir1DType>[] = [jumpKeys, throttleKeys];
	for (const keys of panel) keys.CaptureChord(() => {}, { Timeout: 2 });
	// Capture's slots on the union: the ones both types have
	panel[0].Capture("KeyCode", () => {});
	// the chord a callback gets
	const chord: InputActions.Chord = { KeyCode: K.G, PrimaryModifier: K.LeftControl };

	return [backAgain, chord] as const;
}
