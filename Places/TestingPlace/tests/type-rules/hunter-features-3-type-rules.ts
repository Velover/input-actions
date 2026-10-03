// Hunter, features loop round 3: compile-time findings on AnyNameBindingSpec (bindings under a
// computed name). Checked by plain tsc; each rule stays on the one line after its directive.
//
// HF3-4 (hunter, fixed: under a computed name `CheckBindings` checks an object binding's properties
// against every property a binding of the action type has, any device's, and a namespace's extra
// names against the reserved ones, "/" and the empty name, each refused in the runtime's sentence
// as under a device's name; the escape for the builders' constraint and `any` is `IScriptable |
// IAnyObject extends B[K]`, which a union of Scriptable and a key no longer passes): under a
// computed name an object binding with a property no binding of the action type has compiled, as
// long as its keys fit one device; so did a namespace extra holding such a binding, an extra named
// with "/" or "", and a union of a key no binding takes with InputActions.Scriptable. Under a
// device's name each is refused with a sentence (the controls below), and Schema refuses each under
// every name at runtime (the `hunter-features-3` section's "HF3-4 evidence" test). Types.ts,
// AnyNameBindingSpec: "a key or a shape no binding of the action type can take is refused (hunts
// HF-8, HF2-2)"; API.md: "checked against what a binding of the action type can be under some name:
// a shape with the keys of one device ..., a namespace of one device's bindings whose extras take no
// reserved name". Round 2 pinned `{} as { Typo?: number }` refused under a computed name (HF2-3);
// with a key beside it, the same typo compiled: TypeScript makes no excess-property check on an
// inferred type parameter, and `CheckBindings` made its own (`Exclude<keyof V, AllKeys<...>>`) only
// under a device's name.
import { InputActions } from "@rbxts/input-actions";
import type { CheckBindings } from "@rbxts/input-actions/out/InputActions/Types";

const K = Enum.KeyCode;
declare const computedName: string;
declare const flag: boolean;

export const HF3_4 = [
	// @ts-expect-error a property no binding has, beside a key
	InputActions.Bool({ [computedName]: { KeyCode: K.E, Typo: 1 } }),
	// @ts-expect-error Scale, which no Bool binding has (Direction1D's)
	InputActions.Bool({ [computedName]: { KeyCode: K.E, Scale: 2 } }),
	// @ts-expect-error a composite direction on a Bool binding
	InputActions.Bool({ [computedName]: { KeyCode: K.E, Up: K.W } }),
	// @ts-expect-error ResponseCurve on a Direction1D binding
	InputActions.Direction1D({ [computedName]: { KeyCode: K.ButtonR2, ResponseCurve: 2 } }),
	// @ts-expect-error PressedThreshold on a Direction2D composite
	InputActions.Direction2D({ [computedName]: { Up: K.W, Down: K.S, PressedThreshold: 0.5 } }),
	// @ts-expect-error the same typo in a namespace's extra
	InputActions.Bool({ [computedName]: { Main: K.E, Alt: { KeyCode: K.Q, Typo: 1 } } }),
	// @ts-expect-error an extra named with "/" (it would split the save's path)
	InputActions.Bool({ [computedName]: { Main: K.E, "a/b": K.Q } }),
	// @ts-expect-error an extra with the empty name
	InputActions.Bool({ [computedName]: { Main: K.E, "": K.Q } }),
	// @ts-expect-error a key no Bool binding takes, in a union with Scriptable (the escape)
	InputActions.Bool({ [computedName]: flag ? InputActions.Scriptable : K.MouseDelta }),
];

// the controls: under a device's name (or another name, for the union) each is refused
export const HF3_4_NAMED = [
	// @ts-expect-error a property no binding has
	InputActions.Bool({ KeyboardAndMouse: { KeyCode: K.E, Typo: 1 } }),
	// @ts-expect-error Scale on a Bool binding
	InputActions.Bool({ KeyboardAndMouse: { KeyCode: K.E, Scale: 2 } }),
	// @ts-expect-error ResponseCurve on a Direction1D binding
	InputActions.Direction1D({ Gamepad: { KeyCode: K.ButtonR2, ResponseCurve: 2 } }),
	// @ts-expect-error PressedThreshold on a Direction2D composite
	InputActions.Direction2D({ KeyboardAndMouse: { Up: K.W, Down: K.S, PressedThreshold: 0.5 } }),
	// @ts-expect-error an extra named with "/"
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, "a/b": K.Q } }),
	// @ts-expect-error an extra with the empty name
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, "": K.Q } }),
	// @ts-expect-error MouseDelta or Scriptable under a name that isn't a device's
	InputActions.Bool({ Spare: flag ? InputActions.Scriptable : K.MouseDelta }),
];

// valid code under a computed name still compiles (no finding): a computed extra name beside a
// computed device name, and a computed name beside device names
declare const extraName: string;
export const HF3_OK = [
	InputActions.Bool({ [computedName]: { Main: K.E, [extraName]: K.Q } }),
	InputActions.Bool({ KeyboardAndMouse: K.E, [computedName]: InputActions.Scriptable }),
	InputActions.Direction2D({
		[computedName]: {
			Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D, PrimaryModifier: K.LeftShift },
			Arrows: { Up: K.Up },
		},
	}),
	// worker, HF3-4: Scriptable in a union with a key a binding takes, and keys of two devices in a
	// union (each a binding of its own device) still compile; a value typed any too
	InputActions.Bool({ [computedName]: flag ? InputActions.Scriptable : K.E }),
	InputActions.Bool({ [computedName]: flag ? K.E : K.ButtonA }),
	InputActions.Bool({ [computedName]: flag ? K.E : { KeyCode: K.ButtonA, PressedThreshold: 0.6 } }),
	InputActions.Bool({ [computedName]: {} as any }),
];

// worker, HF3-4: under a computed name the refusals are the runtime's sentences, as under a device's
// name. Each line reads the type a binding is checked against
type Check<B, T extends Enum.InputActionType = Enum.InputActionType.Bool> = CheckBindings<B, T>;
export const HF3_SENTENCES: string[] = [];
const sentence = <S extends string>(value: S) => HF3_SENTENCES.push(value);
sentence<Check<Record<string, { KeyCode: Enum.KeyCode.E; Up: Enum.KeyCode.W }>>[string]["Up"]>("Up is not a property of a Bool binding");
sentence<Check<Record<string, { Main: Enum.KeyCode.E; "a/b": Enum.KeyCode.Q }>>[string]["a/b"]>("a/b: an extra binding's name can't contain /");
sentence<Check<Record<string, { Main: Enum.KeyCode.E; Alt: { KeyCode: Enum.KeyCode.Q; Second: Enum.KeyCode.F } }>>[string]["Alt"]["Second"]>("Second is not a property of a Bool binding");
// a key or a table under a name no binding has, beside a key: the advice of a namespace, as Schema gives it
sentence<Check<Record<string, { KeyCode: Enum.KeyCode.E; Alt: Enum.KeyCode.F }>>[string]["Alt"]>(
	"Alt is not a property of a Bool binding; several bindings of one device go in { Main: <binding>, Alt: <binding> }",
);
