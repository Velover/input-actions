// Hunter, features loop round 1: compile-time findings on 0.7.0's readable compile errors, kept as
// regression rules. Checked by plain tsc; each rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";
import type { CheckBindings } from "@rbxts/input-actions/out/InputActions/Types";

type BoolType = Enum.InputActionType.Bool;
type Check<B, T extends Enum.InputActionType = BoolType> = CheckBindings<B, T>;
export const HF_SENTENCES: string[] = [];
const sentence = <S extends string>(value: S) => HF_SENTENCES.push(value);

// HF-6 (fixed): an unknown property's compile error adds "several bindings of one device go in
// { Main: <binding>, <Property>: <binding> }" only where Schema does (the sentences are the
// runtime's, "as Schema says it"): not for a binding property of another action type (Up on a Bool
// binding), whose advice would name an extra Up, a reserved name; not inside a namespace. The
// runtime's words are pinned in the `hunter-features` section's probe ("Schema's words for an
// unknown property").
sentence<Check<{ KeyboardAndMouse: { KeyCode: Enum.KeyCode.E; Up: Enum.KeyCode.W } }>["KeyboardAndMouse"]["Up"]>("Up is not a property of a Bool binding");
sentence<Check<{ KeyboardAndMouse: { Main: Enum.KeyCode.Space; Alt: { KeyCode: Enum.KeyCode.E; Second: Enum.KeyCode.F } } }>["KeyboardAndMouse"]["Alt"]["Second"]>("Second is not a property of a Bool binding");
// a number under an unknown name is no binding: no advice either (Schema: a key or a table only)
export const SCALING: Check<{ KeyboardAndMouse: { KeyCode: Enum.KeyCode.E; Scaling: 2 } }>["KeyboardAndMouse"]["Scaling"] = {} as {
	readonly "Scaling is not a property of a Bool binding": never;
};

// the advice followed: an extra named Up is refused, Up being a binding property
// @ts-expect-error Up is a binding property, not an extra's name
export const ADVISED = InputActions.Bool({ KeyboardAndMouse: { Main: { KeyCode: Enum.KeyCode.E }, Up: Enum.KeyCode.W } });

// HF-8 (fixed): a binding record with a computed (string) name is checked against the action
// type's shapes, any device's (the name is known at runtime only): a value no binding of the action
// type can be is refused again, as at 73f3ce0, in TypeScript's own words.
declare const computedName: string;
export const COMPUTED = [
	// @ts-expect-error no Bool binding takes MouseDelta
	InputActions.Bool({ [computedName]: Enum.KeyCode.MouseDelta }),
	// @ts-expect-error no KeyCode at all
	InputActions.Bool({ [computedName]: Enum.UserInputType.Keyboard }),
	// @ts-expect-error no binding's shape
	InputActions.Bool({ [computedName]: { Typo: 1 } }),
	// @ts-expect-error Direction3D has no KeyCode
	InputActions.Direction3D({ [computedName]: Enum.KeyCode.E }),
	// @ts-expect-error any KeyCode, Escape and None included
	InputActions.Bool({} as Record<string, Enum.KeyCode>),
];
// what a computed name may hold still compiles: a key of any device, a binding, a namespace, Scriptable
export const COMPUTED_OK = [
	InputActions.Bool({ [computedName]: Enum.KeyCode.E }),
	InputActions.Bool({ [computedName]: Enum.KeyCode.ButtonA }),
	InputActions.Bool({ [computedName]: { KeyCode: Enum.KeyCode.E, PrimaryModifier: Enum.KeyCode.LeftControl } }),
	InputActions.Bool({ [computedName]: { Main: Enum.KeyCode.E, Alt: {} } }),
	InputActions.Bool({ [computedName]: InputActions.Scriptable }),
	InputActions.Direction2D({ [computedName]: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S } }),
	InputActions.ViewportPosition({ [computedName]: Enum.KeyCode.TouchPosition }),
	InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.E, [computedName]: InputActions.Scriptable }),
	InputActions.Bool({} as Record<string, Enum.KeyCode.E | Enum.KeyCode.ButtonA>),
];

// still sentences: a property that is no binding's keeps its namespace hint (as Schema says it)
sentence<Check<{ KeyboardAndMouse: { KeyCode: Enum.KeyCode.E; Arrows: Enum.KeyCode.F } }>["KeyboardAndMouse"]["Arrows"]>(
	"Arrows is not a property of a Bool binding; several bindings of one device go in { Main: <binding>, Arrows: <binding> }",
);
sentence<Check<{ KeyboardAndMouse: { KeyCode: Enum.KeyCode.E; Arrows: { Up: Enum.KeyCode.Up } } }>["KeyboardAndMouse"]["Arrows"]>(
	"Arrows is not a property of a Bool binding; several bindings of one device go in { Main: <binding>, Arrows: <binding> }",
);

// small item: a gamepad binding has no key a ViewportPosition action takes, and says so
sentence<Check<{ Gamepad: Enum.KeyCode.MousePosition }, Enum.InputActionType.ViewportPosition>["Gamepad"]>(
	"MousePosition is a KeyboardAndMouse key, and no Gamepad key goes in KeyCode on a ViewportPosition action",
);
// touch has no modifiers nor composite keys
sentence<Check<{ Touch: { KeyCode: Enum.KeyCode.TouchPosition; PrimaryModifier: Enum.KeyCode.LeftShift } }>["Touch"]["PrimaryModifier"]>(
	"LeftShift is a KeyboardAndMouse key, and no Touch key goes in PrimaryModifier on a Bool action",
);
sentence<Check<{ Touch: { Up: Enum.KeyCode.W } }, Enum.InputActionType.Direction3D>["Touch"]["Up"]>(
	"W is a KeyboardAndMouse key, and no Touch key goes in Up on a Direction3D action",
);
// where the device has keys for the slot, the sentence names them, as before
sentence<Check<{ Gamepad: Enum.KeyCode.Space }>["Gamepad"]>("Space is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys");

// small item: a context named after a member of the root handle is a compile error
// @ts-expect-error Destroy is a member of the root handle
export const ROOT_NAME = InputActions.Schema({ Destroy: { Actions: {} } });
// @ts-expect-error FindConflicts is a member of the root handle
export const ROOT_NAME_2 = InputActions.Schema({ FindConflicts: { Actions: {} }, Gameplay: { Actions: {} } });
type Contexts<S> = import("@rbxts/input-actions/out/InputActions/Types").CheckContexts<S>;
sentence<Contexts<{ Destroy: { Actions: {} } }>["Destroy"]>(
	"Destroy is a member of the root handle, which holds the contexts by name: name the context something else",
);
// any other name still takes the option check
export const PRIORTY: Contexts<{ Play: { Actions: {}; Priorty: 1 } }>["Play"]["Priorty"] = {} as {
	readonly "unknown option Priorty; a context has ServerAuthority, Priority, Sink, Enabled and Actions": never;
};
