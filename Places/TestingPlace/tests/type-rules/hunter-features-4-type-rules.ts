// Hunter, features loop round 4: compile-time findings on bindings under a computed name (after
// round 3's HF3-4). Checked by plain tsc; each rule stays on the one line after its directive.
//
// HF4-3 (hunter, fixed: `AnyNameNamespaceProblems` asks whether any binding of the union has such a
// property, `true extends MemberHasUnknownProperty<...>`, and `AnyNameMemberSentences` distributes
// over the union, giving back each binding that has none and the sentences of each that has one;
// the hunter's first half alone left the union's sentences `unknown`, and every line still
// compiled): under a computed binding name, a namespace whose `Main` is a bare key and whose extra
// is under a computed name too skipped the property check that HF3-4 added. A property no binding
// of the action type has (a typo, `Up` or `Scale` or `ResponseCurve` on a Bool binding,
// `Vector2Scale` on a Direction1D one) compiled there. The same value is refused under a device's
// name, also with the computed extra name (the controls below), and under a computed name with a
// literal extra name (hunter-features-3-type-rules.ts); `Schema` refuses each under every name at
// runtime (the `hunter-features-4` section's "HF4-3 evidence" test). Why: with a computed extra name
// the namespace's type is `{ [x: string]: Main's key | the extra; Main: key }`, so
// `MemberHasUnknownProperty` over the index signature's union read `false | true` (`boolean`), which
// `extends true` doesn't take, and the shapes' structural check let the extra property by. API.md
// (Readable compile errors): under a computed name "A property no binding of the action type has,
// any device's, gets its sentence there too (`Typo is not a property of a Bool binding`)".
import { InputActions } from "@rbxts/input-actions";
import type { CheckBindings } from "@rbxts/input-actions/out/InputActions/Types";

const K = Enum.KeyCode;
declare const computedName: string;
declare const extraName: string;

export const HF4_3 = [
	// @ts-expect-error a typo in an extra under a computed name, beside Main's key
	InputActions.Bool({ [computedName]: { Main: K.E, [extraName]: { KeyCode: K.Q, Typo: 1 } } }),
	// @ts-expect-error a composite direction on a Bool binding
	InputActions.Bool({ [computedName]: { Main: K.E, [extraName]: { KeyCode: K.Q, Up: K.W } } }),
	// @ts-expect-error ResponseCurve on a Bool binding
	InputActions.Bool({ [computedName]: { Main: K.E, [extraName]: { KeyCode: K.Q, ResponseCurve: 2 } } }),
	// @ts-expect-error Scale on a Bool binding
	InputActions.Bool({ [computedName]: { Main: K.E, [extraName]: { KeyCode: K.Q, Scale: 2 } } }),
	// @ts-expect-error the gamepad's keys, a typo beside them
	InputActions.Bool({ [computedName]: { Main: K.ButtonA, [extraName]: { KeyCode: K.ButtonB, Typo: true } } }),
	// @ts-expect-error Vector2Scale on a Direction1D binding
	InputActions.Direction1D({ [computedName]: { Main: K.E, [extraName]: { KeyCode: K.Q, Vector2Scale: new Vector2(1, 1) } } }),
];

// the controls: under a device's name, with the same computed extra name, each is refused
export const HF4_3_NAMED = [
	// @ts-expect-error a typo in an extra under a computed name
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, [extraName]: { KeyCode: K.Q, Typo: 1 } } }),
	// @ts-expect-error a composite direction on a Bool binding
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, [extraName]: { KeyCode: K.Q, Up: K.W } } }),
	// @ts-expect-error ResponseCurve on a Bool binding
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, [extraName]: { KeyCode: K.Q, ResponseCurve: 2 } } }),
	// @ts-expect-error Scale on a Bool binding
	InputActions.Bool({ KeyboardAndMouse: { Main: K.E, [extraName]: { KeyCode: K.Q, Scale: 2 } } }),
	// @ts-expect-error a typo beside the gamepad's keys
	InputActions.Bool({ Gamepad: { Main: K.ButtonA, [extraName]: { KeyCode: K.ButtonB, Typo: true } } }),
	// @ts-expect-error Vector2Scale on a Direction1D binding
	InputActions.Direction1D({ KeyboardAndMouse: { Main: K.E, [extraName]: { KeyCode: K.Q, Vector2Scale: new Vector2(1, 1) } } }),
];

// and under a computed name, refused where Main is an object or `{}` (no finding: the index
// signature's union then reads true), and with a literal extra name (HF3-4's fix)
export const HF4_3_COMPUTED_REFUSED = [
	// @ts-expect-error Main an object beside the computed extra's typo
	InputActions.Bool({ [computedName]: { Main: { KeyCode: K.E }, [extraName]: { KeyCode: K.Q, Typo: 1 } } }),
	// @ts-expect-error Main {} beside the computed extra's typo
	InputActions.Bool({ [computedName]: { Main: {}, [extraName]: { KeyCode: K.Q, Typo: 1 } } }),
	// @ts-expect-error a literal extra name with the typo
	InputActions.Bool({ [computedName]: { Main: K.E, Alt: { KeyCode: K.Q, Typo: 1 } } }),
];

// valid code under computed names still compiles (no finding)
export const HF4_OK = [
	InputActions.Bool({ [computedName]: { Main: K.E, [extraName]: { KeyCode: K.Q, PressedThreshold: 0.6 } } }),
	InputActions.Bool({ [computedName]: { Main: {}, Alt: {} } }),
	InputActions.Direction3D({ [computedName]: {} }),
	InputActions.ViewportPosition({ [computedName]: { Main: K.TouchPosition, Alt: {} } }),
	InputActions.Direction2D({ [computedName]: { Main: K.Thumbstick1, Alt: { KeyCode: K.Thumbstick2, ResponseCurve: 2 } } }),
	InputActions.Bool({ [computedName]: { Main: K.ButtonA, Alt: { KeyCode: K.ButtonB, PrimaryModifier: K.ButtonL1 } } }),
];

// worker, HF4-3: an extra under a computed name, beside Main's key, gets the runtime's sentence, as
// under a literal extra name. Each line reads the type the extra is checked against
type Check<B, T extends Enum.InputActionType = Enum.InputActionType.Bool> = CheckBindings<B, T>;
type WithExtra<X> = { [extra: string]: Enum.KeyCode.E | X; Main: Enum.KeyCode.E };
type ExtraCheck<X, T extends Enum.InputActionType = Enum.InputActionType.Bool> = Exclude<
	Check<Record<string, WithExtra<X>>, T>[string][string],
	Enum.KeyCode.E
>;
export const HF4_SENTENCES: string[] = [];
const sentence = <S extends string>(value: S) => HF4_SENTENCES.push(value);
sentence<ExtraCheck<{ KeyCode: Enum.KeyCode.Q; Up: Enum.KeyCode.W }>["Up"]>("Up is not a property of a Bool binding");
sentence<ExtraCheck<{ KeyCode: Enum.KeyCode.Q; Vector2Scale: Vector2 }, Enum.InputActionType.Direction1D>["Vector2Scale"]>(
	"Vector2Scale is not a property of a Direction1D binding",
);
// and a valid extra beside it is given back as it is: nothing to say
export const HF4_FITS: ExtraCheck<{ KeyCode: Enum.KeyCode.Q; PressedThreshold: 0.6 }> = { KeyCode: Enum.KeyCode.Q, PressedThreshold: 0.6 };
