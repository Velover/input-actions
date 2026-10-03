import type { BindingHandleMember, BindingPropertyName, ReservedExtraName } from "./BindingRules";
import type {
	CapturableDevice,
	Device,
	GamepadKey,
	IAnyDeviceKeys,
	IDeviceKeyMap,
	IDeviceKeys,
	IDeviceKeysText,
	StickKey,
	TouchKey,
} from "./KeyGroups";

// ---- binding shapes (one input source per binding, as IAS enforces). Each takes the keys of one
// device (`K`, see KeyGroups' IDeviceKeys); the default takes any device's.

/** What every binding may set: how a keybind label or `Describe()` shows it */
export interface IBindingDisplay {
	/** Stops bare enum items from structurally matching all-optional shapes (e.g. composites) */
	EnumType?: never;
	/** Tells a binding from a device's namespace, `{ Main: <binding>, <Extra>: <binding> }` */
	Main?: never;
	/** The keybind's text: `Describe()` and an InputActionLabel show it instead of the keys */
	DisplayName?: string;
	/** An image URI, e.g. `rbxassetid://...` */
	DisplayImage?: string;
}
/** A chord's modifiers: Button keys held before the key, in this order (Ctrl+S) */
export interface IBindingModifiers<K extends IDeviceKeys = IAnyDeviceKeys> extends IBindingDisplay {
	/** The first key held before the key (`LeftControl` for Ctrl+S) */
	PrimaryModifier?: K["Modifier"];
	/** The second key held before the key (`LeftShift` for Ctrl+Shift+S) */
	SecondaryModifier?: K["Modifier"];
}
/** How an axis binding's value is scaled */
export interface IAxisShaping {
	/** Multiplies the value (1 by default) */
	Scale?: number;
	/** Keeps a composite's value at most 1 long, so diagonals aren't faster (default true); not the wheel or mouse movement */
	ClampMagnitudeToOne?: boolean;
}

/** A Bool action's binding: a key, pressed past a threshold */
export interface IBoolBinding<K extends IDeviceKeys = IAnyDeviceKeys> extends IBindingModifiers<K> {
	/** The key, button, mouse button, trigger, stick direction or tap that presses the action */
	KeyCode: K["Bool"];
	/** How far an analog key must go to press the action (0..1, 0.5 by default) */
	PressedThreshold?: number;
	/** How far back it must come to release it (0.2 by default; IAS reads it as at most `PressedThreshold`) */
	ReleasedThreshold?: number;
}

/** A Direction1D action's binding on one key: a trigger, a stick direction, the wheel, pinch */
export interface IDirection1DKeyBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	/** The key that drives the value */
	KeyCode: K["Direction1D"];
	/** Not beside a `KeyCode`: one input source per binding */
	Up?: never;
	/** Not beside a `KeyCode`: one input source per binding */
	Down?: never;
}
/** A Direction1D action's composite binding: a key for each direction (W / S) */
export interface IDirection1DCompositeBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	/** Not beside composite directions: one input source per binding */
	KeyCode?: never;
	/** The key for +1 */
	Up?: K["Composite"];
	/** The key for -1 */
	Down?: K["Composite"];
}

/** A Direction2D action's binding on a thumbstick */
export interface IDirection2DStickBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	/** `Thumbstick1` or `Thumbstick2` */
	KeyCode: K["Stick"];
	/** Bends the stick's response, from 1 (unchanged, the default) to 10: finer control near the centre */
	ResponseCurve?: number;
	/** Multiplies each axis (`new Vector2(1, -1)` inverts Y) */
	Vector2Scale?: Vector2;
	/** Not beside a `KeyCode`: one input source per binding */
	Up?: never;
	/** Not beside a `KeyCode`: one input source per binding */
	Down?: never;
	/** Not beside a `KeyCode`: one input source per binding */
	Left?: never;
	/** Not beside a `KeyCode`: one input source per binding */
	Right?: never;
}
/** A Direction2D action's binding on a delta: mouse movement, a touch drag, trackpad pan (rates) */
export interface IDirection2DDeltaBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	/** `MouseDelta`, `TouchDelta` or `TrackpadPan` */
	KeyCode: K["Delta2D"];
	/** Thumbsticks only */
	ResponseCurve?: never;
	/** Multiplies each axis (`new Vector2(1, -1)` inverts Y) */
	Vector2Scale?: Vector2;
	/** Not beside a `KeyCode`: one input source per binding */
	Up?: never;
	/** Not beside a `KeyCode`: one input source per binding */
	Down?: never;
	/** Not beside a `KeyCode`: one input source per binding */
	Left?: never;
	/** Not beside a `KeyCode`: one input source per binding */
	Right?: never;
}
/** A Direction2D action's composite binding: a key for each direction (W / A / S / D) */
export interface IDirection2DCompositeBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	/** Not beside composite directions: one input source per binding */
	KeyCode?: never;
	/** Thumbsticks only */
	ResponseCurve?: never;
	/** Multiplies each axis (`new Vector2(1, -1)` inverts Y) */
	Vector2Scale?: Vector2;
	/** The key for +Y */
	Up?: K["Composite"];
	/** The key for -Y */
	Down?: K["Composite"];
	/** The key for -X */
	Left?: K["Composite"];
	/** The key for +X */
	Right?: K["Composite"];
}

/** A Direction3D action's binding: a key for each of the six directions */
export interface IDirection3DCompositeBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	/** The key for +Y */
	Up?: K["Composite"];
	/** The key for -Y */
	Down?: K["Composite"];
	/** The key for -X */
	Left?: K["Composite"];
	/** The key for +X */
	Right?: K["Composite"];
	/** The key for -Z (forward, in Roblox coordinates) */
	Forward?: K["Composite"];
	/** The key for +Z */
	Backward?: K["Composite"];
	/** Multiplies each axis */
	Vector3Scale?: Vector3;
}

/** A ViewportPosition action's binding: where the pointer is, in pixels */
export interface IViewportPositionBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingDisplay {
	/** `MousePosition` or `TouchPosition` */
	KeyCode: K["Position"];
}

/** The object forms of a binding, per action type */
export interface IBindingObjectMap<K extends IDeviceKeys = IAnyDeviceKeys> {
	Bool: IBoolBinding<K>;
	Direction1D: IDirection1DKeyBinding<K> | IDirection1DCompositeBinding<K>;
	Direction2D:
		| IDirection2DStickBinding<K>
		| IDirection2DDeltaBinding<K>
		| IDirection2DCompositeBinding<K>;
	Direction3D: IDirection3DCompositeBinding<K>;
	ViewportPosition: IViewportPositionBinding<K>;
}
/** Every form a binding may take in a schema or in `Set`, per action type (a bare key is `{ KeyCode }`) */
export interface IBindingShapeMap<K extends IDeviceKeys = IAnyDeviceKeys> {
	Bool: K["Bool"] | IBoolBinding<K>;
	Direction1D: K["Direction1D"] | IDirection1DKeyBinding<K> | IDirection1DCompositeBinding<K>;
	Direction2D:
		| K["Stick"]
		| K["Delta2D"]
		| IDirection2DStickBinding<K>
		| IDirection2DDeltaBinding<K>
		| IDirection2DCompositeBinding<K>;
	Direction3D: IDirection3DCompositeBinding<K>;
	ViewportPosition: K["Position"] | IViewportPositionBinding<K>;
}

/** The marker of a binding driven only from code: `InputActions.Scriptable` */
export interface IScriptable {
	/** Only `InputActions.Scriptable` is one */
	readonly _nominal_InputActionsScriptable: unique symbol;
}

/**
 * The forms a binding of device `D` may take (a union of devices: any of theirs, each binding with
 * one device's keys)
 */
export type BindingShape<
	T extends Enum.InputActionType,
	D extends Device = Device,
> = D extends Device ? IBindingShapeMap<IDeviceKeyMap[D]>[T["Name"]] : never;
/** A binding with no keys, which a player can fill: `{}`, in a device's namespace */
export interface IUnboundBinding {
	readonly [property: string]: never;
}
/**
 * Any object, for inference only: an object binding with a key the action type or the device can't
 * take, or a property it doesn't have, is still inferred as written, and `CheckBindings` says in
 * words what is wrong (0.7.0). Without it inference fell back to the constraint, whose error listed
 * every key the action type takes
 */
interface IAnyObject {
	readonly [property: string]: unknown;
}
/**
 * What each binding of a device's namespace takes before the device checks. Any enum item, as any
 * object, so that a key the binding can't take is inferred as written and refused in words
 */
type NamespaceBindingSpec<T extends Enum.InputActionType> =
	| IBindingShapeMap[T["Name"]]
	| EnumItem
	| IScriptable
	| IUnboundBinding
	| IAnyObject;
/**
 * A device's bindings (0.7.0): its main binding, and extra bindings by names of your own, each with
 * the device's keys, or `{}` for one with no keys (a player fills it, e.g. an Alternate column)
 */
export interface IBindingNamespace<T extends Enum.InputActionType> {
	/** The device's main binding: `Bindings.<Device>` is its handle */
	readonly Main: NamespaceBindingSpec<T>;
	/** An extra binding of the device, by a name of your own: `Bindings.<Device>.<Extra>` is its handle */
	readonly [extra: string]: NamespaceBindingSpec<T>;
}
/**
 * What the builders' records take before the checks: a binding (the action type's shapes, for the
 * editor's completions; any enum item or object, so that what the checks refuse is inferred as
 * written and refused in words), a device's namespace, or Scriptable
 */
export type BindingSpec<T extends Enum.InputActionType> =
	| IBindingShapeMap[T["Name"]]
	| EnumItem
	| IScriptable
	| IBindingNamespace<T>
	| IAnyObject;
type PartialEach<U> = U extends unknown ? Partial<U> : never;
/**
 * Each object form with every property optional, but only the forms whose `KeyCode` the device
 * has: a stick's form (`ResponseCurve`) only on the gamepad (hunt HD3-3)
 */
type PartialForm<F> = F extends { KeyCode: infer Key }
	? [Key] extends [never]
		? never
		: Partial<F>
	: Partial<F>;
/**
 * Device `D`'s object forms of an action type, every property optional, as `PartialForm` keeps them.
 * Where the device has a key for none of them (a ViewportPosition binding on the gamepad), the forms
 * as they are, which hold only the display: every binding may take a `DisplayName` (hunt HD4-6)
 */
type DeviceParts<F> = [PartialForm<F>] extends [never] ? PartialEach<F> : PartialForm<F>;
/**
 * A binding's current value as plain data in the schema's shape (`Get`). An unbound binding has no
 * keys. The same forms as `BindingPart`, so `Set(binding.Get())` takes it back
 */
export type BindingData<
	T extends Enum.InputActionType,
	D extends Device = Device,
> = D extends Device ? DeviceParts<IBindingObjectMap<IDeviceKeyMap[D]>[T["Name"]]> : never;
/**
 * Part of an object form of device `D`'s binding, without the keys it doesn't name: `Set` merges it
 * into the binding (`{ PressedThreshold: 0.9 }`, `{ ResponseCurve: 2 }` on a stick). Its properties
 * are still the action type's
 */
export type BindingPart<
	T extends Enum.InputActionType,
	D extends Device = Device,
> = D extends Device ? DeviceParts<IBindingObjectMap<IDeviceKeyMap[D]>[T["Name"]]> : never;

// Generic inference skips excess-property checks, so the builders' records are checked here, binding
// by binding: a binding named after a device takes that device's keys (`BindingShape<T, D>`), any
// other name only `InputActions.Scriptable` (design spec §3, 0.7.0). A key is compared with a
// conditional against the union of keys a slot takes, never through a mapped type over the KeyCode
// union, which runs tsc out of memory: the mapped types here go over a binding's own properties or a
// namespace's names. Where a check refuses something, what the value is checked against is a
// sentence saying why, in the runtime's words (`Space is a KeyboardAndMouse key: a Gamepad binding
// takes gamepad keys`): a string type, which no binding is, so the error ends on it (F5).
type AllKeys<U> = U extends unknown ? keyof U : never;
type CompositeSlotName = "Up" | "Down" | "Left" | "Right" | "Forward" | "Backward";
type KeySlotName = "KeyCode" | CompositeSlotName | "PrimaryModifier" | "SecondaryModifier";

/** The device a key belongs to, as `GetKeyDevice` tells it at runtime */
type KeyDeviceOf<K> = K extends GamepadKey ? "Gamepad" : K extends TouchKey ? "Touch" : "KeyboardAndMouse";
/** The key slots of a binding of each action type, and the keys each takes (`K`: a device's) */
interface ISlotKeyMap<K extends IDeviceKeys> {
	Bool: { KeyCode: K["Bool"]; PrimaryModifier: K["Modifier"]; SecondaryModifier: K["Modifier"] };
	Direction1D: {
		KeyCode: K["Direction1D"];
		Up: K["Composite"];
		Down: K["Composite"];
		PrimaryModifier: K["Modifier"];
		SecondaryModifier: K["Modifier"];
	};
	Direction2D: {
		KeyCode: K["Stick"] | K["Delta2D"];
		Up: K["Composite"];
		Down: K["Composite"];
		Left: K["Composite"];
		Right: K["Composite"];
		PrimaryModifier: K["Modifier"];
		SecondaryModifier: K["Modifier"];
	};
	Direction3D: {
		Up: K["Composite"];
		Down: K["Composite"];
		Left: K["Composite"];
		Right: K["Composite"];
		Forward: K["Composite"];
		Backward: K["Composite"];
		PrimaryModifier: K["Modifier"];
		SecondaryModifier: K["Modifier"];
	};
	ViewportPosition: { KeyCode: K["Position"] };
}
/** The keys slot `P` of a binding takes on action type `T`, with the keys `K` (none: no such slot) */
type SlotKeys<T extends Enum.InputActionType, K extends IDeviceKeys, P> =
	P extends keyof ISlotKeyMap<K>[T["Name"]] ? ISlotKeyMap<K>[T["Name"]][P] : never;
/**
 * Whether key `X` fits slot `P` on action type `T` on some device. Its own alias: in the true
 * branch of `X extends <the slot's keys>`, X stands for `X & <the slot's keys>`, and a message
 * built from it there took tsc 0.8 s per refused key
 */
type FitsSlot<X, T extends Enum.InputActionType, P> =
	X extends SlotKeys<T, IAnyDeviceKeys, P> ? true : false;
/**
 * Why key `X` can't go in slot `P` of device `D`'s binding on action type `T`, as `KeyRuleProblem`
 * says it at runtime: another device's key the slot takes (where the device has none for the slot,
 * a ViewportPosition binding on the gamepad, it says so), or a key the slot never takes
 */
type KeyProblem<X, T extends Enum.InputActionType, D extends Device, P extends string> =
	X extends Enum.KeyCode
		? FitsSlot<X, T, P> extends true
			? [SlotKeys<T, IDeviceKeyMap[D], P>] extends [never]
				? `${X["Name"]} is a ${KeyDeviceOf<X>} key, and no ${D} key goes in ${P} on a ${T["Name"]} action`
				: `${X["Name"]} is a ${KeyDeviceOf<X>} key: a ${D} binding takes ${IDeviceKeysText[D]}`
			: `${X["Name"]} is not allowed in ${P} on a ${T["Name"]} action`
		: `${P} must be an Enum.KeyCode`;
/** What is wrong with key `X` in slot `P` of device `D`'s binding, in words; never when nothing is */
type KeySlotProblem<X, T extends Enum.InputActionType, D extends Device, P extends string> =
	X extends undefined
		? never
		: X extends SlotKeys<T, IDeviceKeyMap[D], P>
			? never
			: KeyProblem<X, T, D, P>;
/** A bare key or an object that isn't a binding */
type NOT_A_BINDING = "a binding must be an Enum.KeyCode, an object or InputActions.Scriptable";
/**
 * What a Scriptable under a device's name is checked against: a sentence, which the marker is not.
 * The parameter is `B & CheckBindings<B, T>`, and the device's shapes intersected with `B`'s
 * `IScriptable` made the all-optional ones (a composite) shapes the marker satisfies (hunt HD-3)
 */
type NotScriptable<D extends Device> =
	`${D} is a device: its bindings hold keys, not InputActions.Scriptable; name a Scriptable binding beside the devices`;
/** The properties of the action type's bindings, any device's, `EnumType` and `Main` aside */
type PropertyOf<T extends Enum.InputActionType> = Exclude<
	AllKeys<IBindingObjectMap[T["Name"]]>,
	"EnumType" | "Main"
>;
/**
 * Whether a value under an unknown property is likely a second binding of the device, as `Schema`
 * tells it: a KeyCode or a table (an object that is no other enum item, Vector or function)
 */
type BindingLike<X> = X extends Enum.KeyCode
	? true
	: X extends EnumItem | Vector2 | Vector3 | Callback
		? false
		: X extends object
			? true
			: false;
/**
 * Why property `P` (holding `X`) isn't one of the action type's bindings', as `Schema` says it.
 * `Hint`: written beside the keys of a device's binding (not inside a namespace, where the extras
 * already are), a key or a table under a name no binding of any action type has is likely another
 * binding of the device, which goes in its namespace; a binding property of another action type
 * (`Up` on a Bool binding) gets no such advice, since an extra can't take its name (hunt HF-6)
 */
type UnknownProperty<P, T extends Enum.InputActionType, X, Hint extends boolean> = [
	Hint,
	P extends BindingPropertyName ? false : true,
	BindingLike<X>,
] extends [true, true, true]
	? `${P & string} is not a property of a ${T["Name"]} binding; several bindings of one device go in { Main: <binding>, ${P & string}: <binding> }`
	: `${P & string} is not a property of a ${T["Name"]} binding`;
/** Whether a property holds something: not when left out (undefined), nor a shape's `?: never` */
type Holds<X> = [Exclude<X, undefined>] extends [never] ? false : true;
/** Whether object binding `V` has a key in its `KeyCode` */
type HasKeyCode<V> = V extends { KeyCode: Enum.KeyCode } ? true : false;
/**
 * What is wrong with property `P` of object binding `V` of device `D`, a schema's whole binding, in
 * words; never when nothing is. A `ResponseCurve` needs its `KeyCode` to be a thumbstick. `Hint`:
 * see `UnknownProperty`
 */
type PropertyProblem<V, P extends keyof V, T extends Enum.InputActionType, D extends Device, Hint extends boolean> =
	P extends "EnumType" | "Main"
		? Holds<V[P]> extends true
			? UnknownProperty<P, T, V[P], false>
			: never
		: P extends PropertyOf<T>
			? P extends KeySlotName
				?
						| KeySlotProblem<V[P], T, D, P>
						| (P extends CompositeSlotName
								? [HasKeyCode<V>, Holds<V[P]>] extends [true, true]
									? "KeyCode and composite directions can't share a binding"
									: never
								: never)
				: P extends "ResponseCurve"
					? [IDeviceKeyMap[D]["Stick"]] extends [never]
						? `ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode, which a ${D} binding can't hold`
						: [V] extends [{ KeyCode: StickKey }]
							? never
							: "ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode"
					: never
			: UnknownProperty<P, T, V[P], Hint>;
/** Every problem of object binding `V`, in words; never when there is none */
type ObjectProblems<V, T extends Enum.InputActionType, D extends Device, Hint extends boolean> = {
	[P in keyof V]-?: PropertyProblem<V, P, T, D, Hint>;
}[keyof V];
/**
 * What a value `X` that is refused is checked against: the sentence `M`. A number, a boolean or a
 * string intersected with it would be `never` (two primitives), and take the whole binding with
 * it: those are checked against an object with the sentence as its property's name
 */
type Sentence<M extends string, X> = X extends object ? M : { readonly [S in M]: never };
/**
 * An object binding with a problem: each property that has one checked against its sentence, the
 * others against anything
 */
type ObjectSentences<V, T extends Enum.InputActionType, D extends Device, Hint extends boolean> = {
	[P in keyof V]: [PropertyProblem<V, P, T, D, Hint>] extends [never]
		? unknown
		: Sentence<PropertyProblem<V, P, T, D, Hint>, V[P]>;
};
/**
 * What one form `V` of device `D`'s binding is checked against. It distributes over a union (a
 * value of `BindingShape<T, D>`, or a conditional between a bare key and an object), so each member
 * is checked as it is (hunt HD2-1). A key that fits gives back itself, never `unknown`, which would
 * swallow the other members' checks. An object that fits one of the device's forms and has no
 * property they lack gives back itself too; one that doesn't is checked property by property, each
 * refused property against its sentence, and with none refused, against the device's forms (a
 * `KeyCode` a form requires). The forms first: the sentences cost more, and most bindings fit.
 * `Hint`: false inside a namespace (see `UnknownProperty`)
 */
type CheckDeviceBinding<
	V,
	T extends Enum.InputActionType,
	D extends Device,
	Hint extends boolean = true,
> = V extends IScriptable
	? NotScriptable<D>
	: V extends EnumItem
		? V extends BindingShape<T, D>
			? V
			: V extends Enum.KeyCode
				? KeyProblem<V, T, D, "KeyCode">
				: NOT_A_BINDING
		: V extends object
			? V extends IBindingObjectMap<IDeviceKeyMap[D]>[T["Name"]]
				? [Exclude<keyof V, AllKeys<IBindingObjectMap[T["Name"]]>>] extends [never]
					? V
					: ObjectSentences<V, T, D, Hint>
				: [ObjectProblems<V, T, D, Hint>] extends [never]
					? IBindingObjectMap<IDeviceKeyMap[D]>[T["Name"]]
					: ObjectSentences<V, T, D, Hint>
			: NOT_A_BINDING;
/**
 * Why a device's extra can't have name `E`, as `ExtraNameProblem` says it at runtime: a member of
 * the binding handle the extras hang off, a binding's property (the namespace would read as a
 * binding), the empty name or a "/" (it would split the save's path); never when it can
 */
type ExtraNameProblem<E> = E extends BindingHandleMember
	? `${E} is a member of a binding handle, which the device's extras hang off (Bindings.<Device>.<Extra>): name the extra something else`
	: E extends BindingPropertyName
		? `${E} is a binding property, not an extra binding: { Main: <binding>, <Name>: <binding> } holds the device's bindings by names of your own`
		: E extends ""
			? "an extra binding's name must be a string of at least one character"
			: E extends `${string}/${string}`
				? `${E}: an extra binding's name can't contain /`
				: never;
/**
 * One binding of a device's namespace: as the device's binding (`CheckDeviceBinding`, without the
 * advice to use a namespace, as `Schema` says it), or `{}`, one with no keys
 */
type CheckNamespaceBinding<V, T extends Enum.InputActionType, D extends Device> = V extends object
	? [keyof V] extends [never]
		? V
		: CheckDeviceBinding<V, T, D, false>
	: CheckDeviceBinding<V, T, D, false>;
/**
 * A device's namespace (0.7.0): `Main` and each extra checked as the device's bindings, and the
 * extras' names against the reserved ones (`RESERVED_EXTRA_NAMES`: the main binding's handle they
 * hang off, and a binding's properties), "/" and the empty name. Maps over the namespace's keys only
 */
type CheckNamespace<V, T extends Enum.InputActionType, D extends Device> = {
	[E in keyof V]: E extends "Main"
		? CheckNamespaceBinding<V[E], T, D>
		: E extends string
			? [ExtraNameProblem<E>] extends [never]
				? CheckNamespaceBinding<V[E], T, D>
				: ExtraNameProblem<E>
			: "an extra binding's name must be a string of at least one character";
};
/**
 * A device's value: a namespace (an object with `Main`, which no binding has: the shapes say
 * `Main?: never`) or a binding. Distributes over a union, as `CheckDeviceBinding` does
 */
type CheckDeviceValue<V, T extends Enum.InputActionType, D extends Device> = V extends {
	Main: unknown;
}
	? CheckNamespace<V, T, D>
	: CheckDeviceBinding<V, T, D>;
/** Why a binding with keys can't have name `K`, as `BindingNameProblem` says it at runtime */
type NotADevice<K> =
	`${K & string} is not a device: bindings with keys are named KeyboardAndMouse, Gamepad, Touch; any other binding must be InputActions.Scriptable`;
/** A binding of device `D`'s namespace under a computed name: its shapes, or `{}` */
type AnyNameNamespaceBinding<T extends Enum.InputActionType, D extends Device> =
	| BindingShape<T, D>
	| IUnboundBinding;
/**
 * Device `D`'s namespace under a computed name: `Main` and the extras with the device's keys, and
 * no extra under a reserved name (`RESERVED_EXTRA_NAMES`, as `Schema` refuses it: a binding handle's
 * member, a binding's property). A union over the devices, so one namespace holds one device's keys
 */
type AnyNameNamespace<T extends Enum.InputActionType, D extends Device = Device> = D extends Device
	? { readonly [N in Exclude<ReservedExtraName, "Main">]?: never } & {
			readonly Main: AnyNameNamespaceBinding<T, D>;
			readonly [extra: string]: AnyNameNamespaceBinding<T, D>;
		}
	: never;
/**
 * What a binding under a computed (string) name is checked against: the name, and so the device,
 * is known only at runtime, where `Schema` checks the rest. So a shape of the action type with one
 * device's keys (`BindingShape<T>`, a union over the devices: no binding mixes them), a namespace of
 * one device's bindings with no reserved extra name, or `InputActions.Scriptable`: a key or a shape
 * no binding of the action type can take under any name is refused (hunts HF-8, HF2-2), in
 * TypeScript's own words. What it can't say, a property no binding has or an extra's name, is
 * refused in words before it (`CheckAnyNameValue`)
 */
type AnyNameBindingSpec<T extends Enum.InputActionType> =
	| BindingShape<T>
	| IScriptable
	| AnyNameNamespace<T>;
/** Whether object binding `V` has a property no binding of the action type has, any device's */
type HasUnknownProperty<V, T extends Enum.InputActionType> = [
	Exclude<keyof V, PropertyOf<T>>,
] extends [never]
	? false
	: true;
/** Whether a binding of a namespace (a key, `{}`, an object) has such a property */
type MemberHasUnknownProperty<X, T extends Enum.InputActionType> = X extends EnumItem
	? false
	: X extends object
		? HasUnknownProperty<X, T>
		: false;
/**
 * An object binding under a computed name with a property no binding of the action type has: each
 * such property against its sentence, as under a device's name, the others against anything.
 * `Hint`: see `UnknownProperty`
 */
type AnyNameObjectSentences<V, T extends Enum.InputActionType, Hint extends boolean> = {
	[P in keyof V]: P extends PropertyOf<T>
		? unknown
		: Sentence<UnknownProperty<P, T, V[P], Hint>, V[P]>;
};
/** A binding of a namespace under a computed name with such a property: its sentences; else anything */
type AnyNameMemberSentences<X, T extends Enum.InputActionType> =
	MemberHasUnknownProperty<X, T> extends true ? AnyNameObjectSentences<X, T, false> : unknown;
/**
 * What is wrong with a namespace under a computed name that its devices' keys don't tell: an extra's
 * name `Schema` refuses under every device (a reserved one, "/", the empty name), or a property no
 * binding of the action type has in one of its bindings; never when nothing is
 */
type AnyNameNamespaceProblems<V, T extends Enum.InputActionType> = {
	[E in keyof V]-?:
		| (E extends "Main" ? never : E extends string ? ExtraNameProblem<E> : "a name")
		| (MemberHasUnknownProperty<V[E], T> extends true ? "a property" : never);
}[keyof V];
/**
 * A namespace under a computed name: with no problem `AnyNameNamespaceProblems` sees, itself when
 * it fits one device's namespace, else the devices' namespaces (TypeScript's own words); with one,
 * each name and binding against its sentence, as under a device's name (`CheckNamespace`)
 */
type CheckAnyNameNamespace<V, T extends Enum.InputActionType> = [
	AnyNameNamespaceProblems<V, T>,
] extends [never]
	? V extends AnyNameNamespace<T>
		? V
		: AnyNameNamespace<T>
	: {
			[E in keyof V]: E extends "Main"
				? AnyNameMemberSentences<V[E], T>
				: E extends string
					? [ExtraNameProblem<E>] extends [never]
						? AnyNameMemberSentences<V[E], T>
						: ExtraNameProblem<E>
					: "an extra binding's name must be a string of at least one character";
		};
/**
 * One member of a value under a computed name (it distributes over a union): Scriptable, a namespace
 * (`CheckAnyNameNamespace`), or a binding. A binding with a property no binding of the action type
 * has is refused in words, as under a device's name (hunt HF3-4: an excess property beside a key
 * compiled, TypeScript making no excess-property check on an inferred type). A member that fits gives
 * back itself, so it swallows no other member's check; one that doesn't is checked against
 * `AnyNameBindingSpec<T>`, in TypeScript's own words
 */
type CheckAnyNameMember<V, T extends Enum.InputActionType> = V extends IScriptable
	? V
	: V extends EnumItem
		? V extends BindingShape<T>
			? V
			: AnyNameBindingSpec<T>
		: V extends { Main: unknown }
			? CheckAnyNameNamespace<V, T>
			: V extends object
				? HasUnknownProperty<V, T> extends true
					? AnyNameObjectSentences<V, T, true>
					: V extends BindingShape<T>
						? V
						: AnyNameBindingSpec<T>
				: AnyNameBindingSpec<T>;
/**
 * What a value under a computed name is checked against. Keys alone (a union of KeyCodes, a
 * `Record<string, Enum.KeyCode>`) are checked at once, not one by one: hundreds of KeyCodes
 */
type CheckAnyNameValue<V, T extends Enum.InputActionType> = [V] extends [EnumItem]
	? [V] extends [BindingShape<T>]
		? V
		: AnyNameBindingSpec<T>
	: CheckAnyNameMember<V, T>;
/**
 * What a builder's bindings `B` are checked against: each binding named after a device against that
 * device's keys (a namespace binding by binding), any other against `InputActions.Scriptable`; what
 * is refused is checked against a sentence saying why
 */
export type CheckBindings<B, T extends Enum.InputActionType> = {
	// `string`: computed names, which `Schema` checks at runtime, against the action type's shapes.
	// Not where the value is the builders' constraint, which TypeScript reads here for the object
	// literal's contextual type (intersected with `BindingSpec<T>`, the shapes' unions multiplied
	// out took tsc from 2 s to 20 s on the type rules, and to 245 s with `unknown extends B[K]`
	// here), nor `any`: both take the Scriptable marker and any object. Not any object alone (hunt
	// HF2-3: `IAnyObject extends B[K]` let through every type whose properties are all optional):
	// the marker's one property, which no binding has, fails TypeScript's check against such a type.
	// Nor the marker alone (hunt HF3-4: a union of Scriptable and a key no binding takes compiled).
	// One test: a second one nested in the first took the type rules from 3.5 s to 9.6 s
	[K in keyof B]: string extends K
		? IScriptable | IAnyObject extends B[K]
			? unknown
			: CheckAnyNameValue<B[K], T>
		: K extends Device
			? CheckDeviceValue<B[K], T, K>
			: B[K] extends IScriptable
				? unknown
				: NotADevice<K>;
};

// ---- values

/** The value of each action type: what `GetState()` returns and `Fire` takes */
export interface IActionValueMap {
	Bool: boolean;
	Direction1D: number;
	Direction2D: Vector2;
	Direction3D: Vector3;
	ViewportPosition: Vector2;
}
/** The value of an action type: boolean, number, Vector2, Vector3, or Vector2 (pixels) */
export type ActionValue<T extends Enum.InputActionType> = IActionValueMap[T["Name"]];

/** The slots `Capture` can fill, per action type */
export interface ICaptureSlotMap {
	Bool: "KeyCode" | "PrimaryModifier" | "SecondaryModifier";
	Direction1D: "KeyCode" | "Up" | "Down" | "PrimaryModifier" | "SecondaryModifier";
	Direction2D:
		| "KeyCode"
		| "Up"
		| "Down"
		| "Left"
		| "Right"
		| "PrimaryModifier"
		| "SecondaryModifier";
	Direction3D:
		| "Up"
		| "Down"
		| "Left"
		| "Right"
		| "Forward"
		| "Backward"
		| "PrimaryModifier"
		| "SecondaryModifier";
	ViewportPosition: "KeyCode";
}
/** The key slots of a binding of action type `T`: what `Capture` and `Clear` take */
export type CaptureSlot<T extends Enum.InputActionType> = ICaptureSlotMap[T["Name"]];
/** Every key slot of any action type */
export type BindingSlot = ICaptureSlotMap[keyof ICaptureSlotMap];

// ---- schema

/** An action in a schema, as a builder (`InputActions.Bool`...) returns it: plain, frozen data */
export interface IActionDefinition<
	T extends Enum.InputActionType,
	B,
	TP extends boolean = boolean,
> {
	/** The action type, which fixes the value type */
	readonly Type: T;
	/** The bindings, by name: the devices' (a binding or a namespace) and the Scriptable ones */
	readonly Bindings: B;
	/** Whether the handle tracks the previous frame's value */
	readonly TrackPrevious: TP;
	/** The `InputAction.DisplayName` of an action `Create` makes */
	readonly DisplayName?: string;
	/** The `InputAction.Enabled` of an action `Create` makes */
	readonly Enabled?: boolean;
}

/** A builder's options: `InputActions.Bool(bindings, { TrackPrevious: true })` */
export interface IActionOptions<TP extends boolean> {
	/** Snapshot the value once per frame so GetPrevious/HasChanged (and IsJustPressed/IsJustReleased) exist */
	TrackPrevious?: TP;
	/** Used when the action is created; an existing action keeps its own */
	DisplayName?: string;
	/**
	 * Used when the action is created; an existing action keeps its own. The server's copy of a
	 * Server Authority context is always enabled on the server: the client gives it this value (or
	 * the template's) the first time
	 */
	Enabled?: boolean;
}

/** A context in a schema: its options and its actions */
export interface IContextSchema {
	/** The server creates this context and its actions under each Player; the bindings stay on the client */
	ServerAuthority?: boolean;
	/** Orders the context against the others: higher goes first (IAS default 1000; a whole number) */
	Priority?: number;
	/** Keeps lower-priority contexts from the keys this context binds (default false) */
	Sink?: boolean;
	/** The base state of a context `Create` makes (default true) */
	Enabled?: boolean;
	/** The actions, by name, made with the builders */
	Actions: { [name: string]: IActionDefinition<Enum.InputActionType, unknown, boolean> };
}

/** The root handle's own members: no context can take their names (`ROOT_MEMBERS`) */
export type RootMember =
	| "BindingsChanged"
	| "ExportBindings"
	| "ImportBindings"
	| "ResetBindings"
	| "FindConflicts"
	| "Destroy";
/**
 * Generic inference skips excess-property checks: a misspelt context option is rejected here, with
 * the runtime's sentence, and so is a context named after a member of the root handle, which holds
 * the contexts by name
 */
export type CheckContexts<S> = {
	[C in keyof S]: C extends RootMember
		? Sentence<
				`${C} is a member of the root handle, which holds the contexts by name: name the context something else`,
				S[C]
			>
		: {
				[P in Exclude<keyof S[C], keyof IContextSchema>]: Sentence<
					`unknown option ${P & string}; a context has ServerAuthority, Priority, Sink, Enabled and Actions`,
					S[C][P]
				>;
			};
};

/** A schema's data: the contexts by name */
export interface IInputSchema<S extends Record<string, IContextSchema>> {
	/** The contexts, by name */
	readonly Contexts: S;
}
/**
 * A schema as `Create`, `ForPlayer`, `ProvideToPlayers` and `SanitizeBindings` take it: what
 * `Schema` returns, or `{ Contexts }` written without it, whose misspelt context options are refused
 * here, as `Schema`'s parameter refuses them. A generic `S` passes on as it is, so a helper over
 * `InputActions.InputSchema<S>` can call them. An interface, not an intersection: from one
 * instantiation of it to another `S` is inferred as it is, where from an intersection it was
 * inferred as `S & CheckContexts<S>`, which `ServerHandle<S>` doesn't take
 */
export interface ICheckedInputSchema<S extends Record<string, IContextSchema>>
	extends IInputSchema<S> {
	readonly Contexts: S & CheckContexts<S>;
}
/**
 * What `Schema` returns: a schema it checked. The functions that take a schema take this first, as
 * it is, then `ICheckedInputSchema<S>`: checked again, its type would be the context a `Schema` call
 * written inside them infers from, and a preset with no options there would infer its options from
 * that check instead of from its argument
 */
export interface ISchema<S extends Record<string, IContextSchema>> extends IInputSchema<S> {
	/** Only `Schema` makes one */
	readonly _nominal_InputActionsSchema: unique symbol;
}

// ---- client handles

/** `Capture`'s options */
export interface ICaptureOptions {
	/** Keys that end the capture without a change, from any device: the callback gets `undefined` */
	Cancel?: Enum.KeyCode[];
}

/** A device's extra bindings by name, as `Extras()` gives them (`H`: their handles' type) */
export interface IExtraBindings<H> {
	readonly [name: string]: H | undefined;
}

/**
 * A device's binding of an action (`KeyboardAndMouse`, `Gamepad`, `Touch`): every action has the
 * three, unbound when the schema leaves one out. `D` is the device; a union of devices is a handle
 * any of theirs is assignable to, whose `Set` takes any of their keys (checked at runtime). A
 * device's extra bindings (0.7.0) are handles of this type too, hung off its main binding's handle
 */
export interface IBindingHandle<T extends Enum.InputActionType, D extends Device = Device> {
	/** The InputBinding the handle wraps now (the Server Authority swap may point it at another) */
	readonly Instance: InputBinding;
	/** The device: the binding's name in the schema (an extra's device too) */
	readonly Name: D;
	/**
	 * The device's extra bindings its schema declares, by name: the same handles as the properties
	 * named after them; none on an extra, nor on a device without extras. A table, so a handle picked
	 * by a device at runtime can be asked for one by name (`Extras().Alt`); go through them with
	 * `pairs`, in no order: sort the names for a menu
	 */
	Extras(): IExtraBindings<IBindingHandle<T, D>>;
	/** The current binding as plain data in the schema's shape (`{}` when unbound) */
	Get(): BindingData<T, D>;
	/**
	 * The binding as text, for a menu or a hint: its `DisplayName` when it has one; else its
	 * modifiers then its key, `"Ctrl + S"`, or its composite directions in reading order (Up, Left,
	 * Down, Right, Forward, Backward), `"W / A / S / D"`; `""` when it has no key. A character key
	 * reads as on the player's keyboard layout (`UserInputService:GetStringForKeyCode`), the others
	 * by readable names (`"Enter"`, `"Left Click"`, `"Left Stick"`, `"A"` for ButtonA). For gamepad
	 * icons, pass the keys of `Get()` to `UserInputService:GetImageForKeyCode`
	 */
	Describe(): string;
	/**
	 * Rebind. Same per-type rules as the schema, and the device's keys only, also checked at runtime.
	 * Objects merge into the binding, so one may leave the key out (`{ PressedThreshold: 0.9 }`); a
	 * `ResponseCurve` needs the binding to end on a thumbstick
	 */
	Set(binding: BindingShape<T, D> | BindingPart<T, D>): void;
	/** Back to the binding right after `Create` (unbound when the schema left the device out) */
	Reset(): void;
	/**
	 * Unbinds: KeyCode, composite directions and modifiers become `None`. With a slot, clears only
	 * that one (e.g. `"PrimaryModifier"` turns Ctrl+S into S)
	 */
	Clear(slot?: CaptureSlot<T>): void;
}
/** A keyboard-and-mouse or gamepad binding, which can capture the device's next key */
export interface ICaptureBindingHandle<
	T extends Enum.InputActionType,
	D extends CapturableDevice = CapturableDevice,
> extends IBindingHandle<T, D> {
	/** The device's extra bindings its schema declares, by name (see `IBindingHandle.Extras`) */
	Extras(): IExtraBindings<ICaptureBindingHandle<T, D>>;
	/**
	 * Waits for the next key of this binding's device legal for `slot`, applies it, then calls
	 * `callback` with it; other devices' keys are ignored. A `Cancel` key counts from any device, and
	 * ends the capture with nothing applied: `callback` gets `undefined`. On the gamepad a stick
	 * pushed past halfway counts as its direction (`Thumbstick1Up`...), and a Direction2D `KeyCode`
	 * takes the whole stick; a trigger counts once pulled past halfway. Returns a function that stops
	 * it (then `callback` isn't called)
	 * @example
	 * Move.Bindings.KeyboardAndMouse.Capture(
	 * 	"Up",
	 * 	(key) => print(key === undefined ? "unchanged" : `Forward is now ${key.Name}`),
	 * 	{ Cancel: [Enum.KeyCode.Backspace] },
	 * );
	 */
	Capture(
		slot: CaptureSlot<T>,
		callback: (key: Enum.KeyCode | undefined) => void,
		options?: ICaptureOptions,
	): () => void;
}
/** What `CaptureChord` applied: the key, and the modifiers held before it, in the order they went down */
export interface IChord {
	/** The last key that went down */
	readonly KeyCode: Enum.KeyCode;
	/** The first key held before it, if any */
	readonly PrimaryModifier?: Enum.KeyCode;
	/** The second key held before it, if any */
	readonly SecondaryModifier?: Enum.KeyCode;
}

/** The action types whose `KeyCode` takes keys that can be pressed, so that a chord can end on one */
export type ChordActionName = "Bool" | "Direction1D";

/** `CaptureChord`'s options */
export interface IChordCaptureOptions extends ICaptureOptions {
	/**
	 * Seconds from the start of the capture. When they run out, the keys held then settle the chord,
	 * as if one had come up; with none held, or none the binding can hold, the capture ends with
	 * nothing applied. Without it the capture waits for a release
	 */
	Timeout?: number;
}

/**
 * A keyboard-and-mouse or gamepad binding of a Bool or Direction1D action, which can capture a chord
 * as well as one key
 */
export interface IChordBindingHandle<
	T extends Enum.InputActionType,
	D extends CapturableDevice = CapturableDevice,
> extends ICaptureBindingHandle<T, D> {
	/** The device's extra bindings its schema declares, by name (see `IBindingHandle.Extras`) */
	Extras(): IExtraBindings<IChordBindingHandle<T, D>>;
	/**
	 * Waits for keys of this binding's device held together (up to three), and settles when the
	 * first of them comes up: the last key down becomes `KeyCode`, the ones held before it
	 * `PrimaryModifier` and `SecondaryModifier`, in the order they went down (one key alone clears
	 * the modifiers). Other devices' keys are ignored. Applies it, then calls `callback` with it. A
	 * chord the binding can't hold is ignored, and the capture waits for every key of it to come up
	 * before the next one counts. `callback` gets `undefined` when the capture ends with nothing
	 * applied: a `Cancel` key, or a `Timeout` with no chord held. Returns a function that stops the
	 * capture (then `callback` isn't called)
	 */
	CaptureChord(
		callback: (chord: IChord | undefined) => void,
		options?: IChordCaptureOptions,
	): () => void;
}

/**
 * The handle of device `D`'s binding: the Touch one has no captures (touch has no keys to press),
 * the others capture a key, and on Bool and Direction1D actions a chord. For a union of devices
 * that includes Touch, the part they share. By default the keyboard-and-mouse or gamepad one
 */
export type BindingHandleOf<
	T extends Enum.InputActionType,
	D extends Device = CapturableDevice,
> = "Touch" extends D
	? IBindingHandle<T, D>
	: T["Name"] extends ChordActionName
		? IChordBindingHandle<T, Exclude<D, "Touch">>
		: ICaptureBindingHandle<T, Exclude<D, "Touch">>;

/** A binding declared `InputActions.Scriptable`: driven only from code */
export interface IScriptableBindingHandle<T extends Enum.InputActionType> {
	/** The InputBinding the handle wraps now (the Server Authority swap may point it at another) */
	readonly Instance: InputBinding;
	/** The binding's name in the schema */
	readonly Name: string;
	/**
	 * Sets the action's state through this binding. The value stays until something changes it: fire
	 * the value at rest when your control lets go
	 */
	Fire(value: ActionValue<T>): void;
}
/**
 * An action's bindings: the three devices' always (unbound when the schema leaves one out), and the
 * Scriptable ones the schema names. The devices' extras are added by `ActionHandle` (`WithExtras`)
 */
export type BindingHandles<T extends Enum.InputActionType, B> = {
	readonly [K in Device]: BindingHandleOf<T, K>;
} & {
	readonly [K in Exclude<keyof B, Device>]: IScriptableBindingHandle<T>;
};

/** The handle of an action: its state, events and bindings (`Input.Gameplay.Actions.Jump`) */
export interface IActionHandle<T extends Enum.InputActionType, B> {
	/** The InputAction the handle wraps now (a Server Authority stand-in's, then the server's copy's) */
	readonly Instance: InputAction;
	/** The action's name in the schema */
	readonly Name: string;
	/** The action type, which fixes the value type */
	readonly Type: T;
	/**
	 * Forwards the action's `StateChanged`, from whichever instance the handle wraps; it never
	 * repeats the value it passed on last (the Server Authority swap can bring such a repeat)
	 */
	readonly StateChanged: RBXScriptSignal<(value: ActionValue<T>) => void>;
	/**
	 * The binding handles: `KeyboardAndMouse`, `Gamepad` and `Touch` always (each its device's main
	 * binding, with the extras its schema declares as properties), and the Scriptable ones by name
	 */
	readonly Bindings: BindingHandles<T, B>;
	/** The value now: boolean, number, Vector2 or Vector3, by the action type */
	GetState(): ActionValue<T>;
	/**
	 * Drives the action from code, through a Scriptable binding the package creates on first use.
	 * Created while the action is held, that binding releases it before the value lands (IAS resets
	 * an action's bindings when one is added, as for `AttachButton`)
	 */
	Fire(value: ActionValue<T>): void;
	/** Enables or disables the action (`InputAction.Enabled`); disabling releases it, on the server too */
	SetEnabled(enabled: boolean): void;
	/** Whether the action is enabled (its context may still be off) */
	IsEnabled(): boolean;
	/** The binding IAS prefers for the device in use (`InputAction.PreferredBinding`); never an unbound one */
	GetPreferredBinding(): InputBinding | undefined;
	/**
	 * The keybind of `device` as text (`"Space"`, `"Ctrl + S"`, `"W / A / S / D"`): its main
	 * binding's `Describe()`, `""` when that has no key. By default the device the player uses
	 * (`InputActions.PreferredDevice()`): refresh a hint on `InputActions.PreferredDeviceChanged` and
	 * the root handle's `BindingsChanged` (which a rebind through another root handle on the same
	 * folder fires too)
	 * @example
	 * hint.Text = `Jump: ${Jump.Describe()}`; // "Jump: Space", or "Jump: A" on a gamepad
	 * Jump.Describe("Gamepad"); // "A"
	 */
	Describe(device?: Device): string;
	/**
	 * Points an InputActionLabel at this action, which then shows its keybind; at the swap to the
	 * server's copy of a Server Authority context the label follows, while it still shows the
	 * stand-in's action. A label is on one action at a time: the last `AttachLabel`, from any handle,
	 * takes it over. The returned function, the label's destruction or the root handle's `Destroy`
	 * let go of it, which clears its `InputAction` unless it was pointed elsewhere meanwhile. Once
	 * another `AttachLabel` took the label over, the function and `Destroy` leave it alone
	 * @example
	 * const label = new Instance("InputActionLabel");
	 * label.Size = UDim2.fromOffset(120, 40);
	 * label.Parent = hud;
	 * const detach = Jump.AttachLabel(label);
	 */
	AttachLabel(label: InputActionLabel): () => void;
}
/**
 * Bool and Direction1D actions: a rebinding menu's one field per action. The first key pressed
 * picks the device, and that device's binding becomes the key (or the chord)
 */
export interface IActionCapture {
	/**
	 * Waits for the next key a keyboard-and-mouse or gamepad binding of this action can hold in its
	 * `KeyCode`; that key's device picks the binding, which becomes that key alone: its composite
	 * directions and its modifiers give way, as with `CaptureChord` given one key (Ctrl+S captured
	 * with F is F; a binding's `Capture("KeyCode", ...)` keeps the modifiers). Then calls `callback`
	 * with the key and the device. Touch input is ignored; a `Cancel` key counts from any device, and
	 * ends the capture with nothing applied: `callback` gets `undefined` twice, as with
	 * `CaptureChord`. Returns a function that stops it (then `callback` isn't called)
	 * @example
	 * const stop = Jump.Capture(
	 * 	(key, device) => print(key === undefined ? "unchanged" : `Jump is now ${key.Name} on ${device}`),
	 * 	{ Cancel: [Enum.KeyCode.Backspace, Enum.KeyCode.ButtonB] },
	 * );
	 */
	Capture(
		callback: (key: Enum.KeyCode | undefined, device: CapturableDevice | undefined) => void,
		options?: ICaptureOptions,
	): () => void;
	/**
	 * Waits for keys held together, as a binding's `CaptureChord` does: the first key that goes
	 * down picks the device, and the other device's keys are ignored while any key of the chord is
	 * held (no Shift + ButtonA). The chord goes into that device's binding. `callback` gets the
	 * chord and the device, or `undefined` twice when the capture ends with nothing applied (a
	 * `Cancel` key, or the `Timeout` with no keys held). One key pressed alone is a chord of that key
	 * @example
	 * QuickSave.CaptureChord(
	 * 	(chord, device) => print(chord === undefined ? "unchanged" : `${QuickSave.Describe(device)} on ${device}`),
	 * 	{ Cancel: [Enum.KeyCode.Backspace, Enum.KeyCode.ButtonB], Timeout: 5 },
	 * );
	 */
	CaptureChord(
		callback: (chord: IChord | undefined, device: CapturableDevice | undefined) => void,
		options?: IChordCaptureOptions,
	): () => void;
}

/** The handle of a Bool action: presses, releases, on-screen buttons and gestures */
export interface IBoolActionHandle<B>
	extends IActionHandle<Enum.InputActionType.Bool, B>,
		IActionCapture {
	/** Fires when the action is pressed; `Pressed` and `Released` always alternate */
	readonly Pressed: RBXScriptSignal<() => void>;
	/** Fires when the action is released, also by a reset (a context disabled, a rebind while held) */
	readonly Released: RBXScriptSignal<() => void>;
	/** Whether the action is pressed now */
	IsPressed(): boolean;
	/**
	 * Fires `true`, then `false` on the next frame. On the server's copy of a Server Authority
	 * context, `false` waits until the press shows in the state, so the server sees it
	 */
	Tap(): void;
	/**
	 * Adds a UIButton binding for this button; the returned function removes it. Adding it releases
	 * the action if it is held: IAS resets an action's bindings when one is added, and a key still
	 * down holds it again only once pressed again. The button presses the action while a finger or
	 * the mouse is down on it; hide it, or set `Interactable = false`, to pause it
	 * @example
	 * const detach = Jump.AttachButton(jumpButton); // detach(), or destroying the button, removes it
	 */
	AttachButton(button: GuiButton): () => void;
	/**
	 * Calls `callback` on a tap: a press released within `MaxDuration` (0.25 s). With
	 * `WaitForDoubleTap`, only once `Window` (0.3 s) has passed after the release without a second
	 * press, so a tap and an `OnDoubleTap` with the same `Window` exclude each other (a second press
	 * counts as within the window by when it arrives). Returns a function that stops it; `Destroy`
	 * stops it too
	 * @example
	 * Interact.OnTap(() => print("look at it"));
	 * Jump.OnTap(() => print("hop"), { WaitForDoubleTap: true }); // never half of a double tap
	 */
	OnTap(callback: () => void, options?: ITapOptions): () => void;
	/**
	 * Calls `callback` on a double tap, at its second press: a press within `Window` (0.3 s) after
	 * a tap (a press released within `MaxDuration`, 0.25 s). Returns a function that stops it
	 * @example
	 * const stop = Jump.OnDoubleTap(() => print("double jump"));
	 */
	OnDoubleTap(callback: () => void, options?: IDoubleTapOptions): () => void;
	/**
	 * Calls `callback` once a press has been held for `Duration`, while it is still held
	 * (hold-to-interact, a charge), or at its release when that arrives after `Duration` before
	 * the hold could fire (a frame that ran long). `Progress` gets 0 at the press, then the fraction
	 * held each frame, and 1 as it completes; `Cancelled` runs, after `Progress(0)`, when the press
	 * ends first. Returns a function that stops it, also from inside `Progress`: nothing is called
	 * after that
	 * @example
	 * Interact.OnHold(() => print("door opened"), {
	 * 	Duration: 0.8,
	 * 	Progress: (fraction) => (bar.Size = UDim2.fromScale(fraction, 1)),
	 * 	Cancelled: () => print("let go too soon"),
	 * });
	 */
	OnHold(callback: () => void, options: IHoldOptions): () => void;
	/**
	 * Calls `callback` with the seconds held when a press held for at least `Duration` is released
	 * (charge and release). Returns a function that stops it
	 * @example
	 * Shoot.OnLongPress((heldFor) => print(`charged shot: ${math.min(heldFor, 2)} s`), { Duration: 0.5 });
	 */
	OnLongPress(callback: (heldFor: number) => void, options: ILongPressOptions): () => void;
}

/**
 * The gestures' options: durations in seconds, positive and finite (anything else throws). A
 * gesture starts with the next press, and a release that a reset of the package's makes while the
 * action is held (the context or the action disabled through its handle, the focus-loss reset, a
 * rebind or a binding added while held, another root handle's `Destroy` letting go of a shared
 * action, the Server Authority swap) ends it without completing it. A reset once the action is at
 * rest (the player let go first) changes nothing. Gestures on one action, through any root handle,
 * are independent: each sees every press and release alike
 */
export interface ITapOptions {
	/** The longest press that is a tap. Default 0.25 */
	MaxDuration?: number;
	/** Call back only once `Window` has passed after the tap without another press */
	WaitForDoubleTap?: boolean;
	/** With `WaitForDoubleTap`: the double-tap window, as `OnDoubleTap`'s. Default 0.3 */
	Window?: number;
}
/** `OnDoubleTap`'s options, in seconds */
export interface IDoubleTapOptions {
	/** Seconds from the first tap's release within which the second press counts. Default 0.3 */
	Window?: number;
	/** The longest press the first tap may be. Default 0.25 */
	MaxDuration?: number;
}
/** `OnHold`'s options */
export interface IHoldOptions {
	/** Seconds held */
	Duration: number;
	/** Each frame while held, the fraction of `Duration` held (0 at the press, 1 as it completes) */
	Progress?: (fraction: number) => void;
	/** The press ended (or was reset) before `Duration` */
	Cancelled?: () => void;
}
/** `OnLongPress`'s options */
export interface ILongPressOptions {
	/** The shortest press that is a long press, in seconds */
	Duration: number;
}

/** Only on actions defined with TrackPrevious: true */
export interface ITrackedAction<T extends Enum.InputActionType> {
	/** The value at the previous frame's snapshot */
	GetPrevious(): ActionValue<T>;
	/** Whether the value changed between the last two snapshots */
	HasChanged(): boolean;
}
/** Only on Bool actions defined with TrackPrevious: true */
export interface ITrackedBoolAction extends ITrackedAction<Enum.InputActionType.Bool> {
	/** Whether the action was pressed since the last frame; also true for a press and release within one frame */
	IsJustPressed(): boolean;
	/** Whether the action was released since the last frame; also true for a press and release within one frame */
	IsJustReleased(): boolean;
}

/** A device's extra bindings in a schema: the names beside `Main` in its namespace */
type ExtraNames<V> = V extends { Main: unknown } ? Exclude<keyof V, "Main" | number | symbol> : never;
/** Whether a device of the bindings `B` declares extras: their names, or never */
type AnyExtraNames<B> = { [K in Device & keyof B]: ExtraNames<B[K]> }[Device & keyof B];
/**
 * The devices' extra bindings (0.7.0) as properties of their main binding's handle, each a handle of
 * the device's binding. Added beside `IActionHandle<T, B>` rather than inside it: there `B` would be
 * read through conditional types, which made `IBoolActionHandle<B>` no longer assignable to
 * `IBoolActionHandle<unknown>` (`InputActions.BoolAction`)
 */
type WithExtras<T extends Enum.InputActionType, B> = [AnyExtraNames<B>] extends [never]
	? unknown
	: {
			readonly Bindings: {
				readonly [K in Device & keyof B]: {
					readonly [E in ExtraNames<B[K]>]: BindingHandleOf<T, K>;
				};
			};
		};

/**
 * The handle of action definition `D`: the members its type and options give it (`Pressed` and the
 * gestures on Bool actions, the one-field captures on Bool and Direction1D, `IsJustPressed` with
 * `TrackPrevious`), and its devices' extras on `Bindings`
 */
export type ActionHandle<D> =
	D extends IActionDefinition<infer T extends Enum.InputActionType, infer B, infer TP>
		? ([T] extends [Enum.InputActionType.Bool]
				? IBoolActionHandle<B> & ([TP] extends [true] ? ITrackedBoolAction : unknown)
				: IActionHandle<T, B> &
						([T] extends [Enum.InputActionType.Direction1D] ? IActionCapture : unknown) &
						([TP] extends [true] ? ITrackedAction<T> : unknown)) &
				WithExtras<T, B>
		: never;

/** What `ImportBindings` did with a save */
export interface IImportResult {
	/** Paths (`Context/Action/Slot`) whose saved values were applied */
	Applied: string[];
	/** Entries that were not applied; those bindings stay at their defaults */
	Skipped: ISkippedBinding[];
}
/** A save's entry that `ImportBindings` skipped */
export interface ISkippedBinding {
	/** The entry's path in the save, as written there */
	Path: string;
	/** Why it was skipped (`Mouse is not a device: ...`) */
	Reason: string;
}

/** A device's binding handle of any action type: what `FindConflicts` takes and finds */
export type AnyBindingHandle = IBindingHandle<Enum.InputActionType, Device>;

/** A binding that shares a key with the one `FindConflicts` was given */
export interface IBindingConflict {
	/** The other binding's handle */
	readonly Binding: AnyBindingHandle;
	/** Its path: `Context/Action/Device`, or `Context/Action/Device/Extra` for an extra */
	readonly Path: string;
	/**
	 * The first key they share, in the given binding's order (its key or directions, then
	 * modifiers). A stick's direction and the whole stick share the direction (`Thumbstick1Up`), a
	 * drag or a pinch and `TouchPosition` the drag or the pinch
	 */
	readonly Key: Enum.KeyCode;
	/** Every key they share */
	readonly Keys: readonly Enum.KeyCode[];
	/**
	 * The other binding's slot that holds `Key` (its `KeyCode`, a direction, or a modifier):
	 * `conflict.Binding.Clear(conflict.Slot)` frees that key and leaves the binding's other keys. A
	 * modifier cleared leaves the chord's plain key (Ctrl+S becomes S), which may clash anew: show
	 * that one instead, or unbind the chord with `Clear()`
	 */
	readonly Slot: BindingSlot;
	/** Every slot of the other binding that holds one of `Keys`, `Slot` first */
	readonly Slots: readonly BindingSlot[];
	/**
	 * One key is in both with the same modifiers: every press of it presses both. Otherwise they
	 * only overlap: a chord and its plain key (IAS presses both when the chord is pressed: a chord
	 * doesn't block its plain key), two chords on one key, a key that is the other's modifier, or a
	 * stick's direction and the stick (a drag or a pinch and `TouchPosition`)
	 */
	readonly Identical: boolean;
}
/** Two bindings of one device that share a key: what `FindConflicts()` lists, each pair once */
export interface IConflictPair {
	/** The two bindings' handles, in the order of `Paths` */
	readonly Bindings: readonly [AnyBindingHandle, AnyBindingHandle];
	/** Their paths, the first before the second in sorted order */
	readonly Paths: readonly [string, string];
	/** The first key they share, in the first binding's order */
	readonly Key: Enum.KeyCode;
	/** Every key they share */
	readonly Keys: readonly Enum.KeyCode[];
	/**
	 * Each binding's slots that hold a shared key, in the order of `Paths` (the second's holding
	 * `Key` first): `pair.Bindings[1].Clear(pair.Slots[1][0])` frees `Key` in the second
	 */
	readonly Slots: readonly [readonly BindingSlot[], readonly BindingSlot[]];
	/** A key presses both with the same modifiers; otherwise they only overlap (see `IBindingConflict`) */
	readonly Identical: boolean;
}

/** The root handle's and the context handles' bindings: saves, resets and conflicts */
export interface IBindingsOwner {
	/**
	 * The rebinds (what differs from the defaults) as JSON, by path
	 * (`{"Version":1,"Bindings":{}}` when nothing changed)
	 * @example
	 * saveRemote.FireServer(Input.ExportBindings()); // the server cleans it with SanitizeBindings
	 */
	ExportBindings(): string;
	/**
	 * Resets to the defaults, then applies the saved rebinds. Never throws: a bad entry is skipped
	 * with a reason, and its binding stays at its default
	 * @example
	 * const result = Input.ImportBindings(save);
	 * for (const skipped of result.Skipped) warn(`${skipped.Path} not loaded: ${skipped.Reason}`);
	 */
	ImportBindings(json: string): IImportResult;
	/** Every binding back to its defaults: the tree right after `Create` */
	ResetBindings(): void;
	/**
	 * The other bindings of `binding`'s device (on the root handle, in every context; on a context
	 * handle, in its own) that share a key with it, in any of their key slots, by path. A rebinding
	 * menu calls it after a capture to warn, swap or free the key in the other. Unbound bindings
	 * conflict with nothing; which contexts are enabled or sink plays no part
	 * @example
	 * for (const conflict of Input.Gameplay.FindConflicts(Jump.Bindings.KeyboardAndMouse)) {
	 * 	warn(`${conflict.Key.Name} is also ${conflict.Path}`);
	 * 	if (conflict.Slot === "PrimaryModifier" || conflict.Slot === "SecondaryModifier") continue; // a chord's
	 * 	conflict.Binding.Clear(conflict.Slot); // frees the key: Move's WASD loses S alone
	 * }
	 */
	FindConflicts(binding: AnyBindingHandle): IBindingConflict[];
	/**
	 * Every pair of bindings of one device that share a key, each pair once, by path
	 * @example
	 * for (const pair of Input.FindConflicts()) warn(`${pair.Paths[0]} and ${pair.Paths[1]} share ${pair.Key.Name}`);
	 */
	FindConflicts(): IConflictPair[];
}

/** The handle of a context: its enabled state, its actions, and its bindings' saves */
export interface IContextHandle<C extends IContextSchema> extends IBindingsOwner {
	/** The InputContext the handle wraps now: set Priority or Sink on it directly */
	readonly Instance: InputContext;
	/** The context's name in the schema */
	readonly Name: string;
	/** The action handles, by name */
	readonly Actions: { readonly [A in keyof C["Actions"]]: ActionHandle<C["Actions"][A]> };
	/** Fires with the effective state when it changes */
	readonly EnabledChanged: RBXScriptSignal<(enabled: boolean) => void>;
	/** Sets the base state */
	SetEnabled(enabled: boolean): void;
	/** The effective state: base state overridden by requests (any `false` request wins) */
	IsEnabled(): boolean;
	/**
	 * Holds the context enabled or disabled until the returned function is called (a second call
	 * does nothing). A `false` request wins over `true` ones and the base state; disabling releases
	 * the context's held actions
	 * @example
	 * const resumeGameplay = Input.Gameplay.Request(false); // while a menu is open
	 * resumeGameplay();
	 */
	Request(enabled: boolean): () => void;
}

export interface IInputRoot extends IBindingsOwner {
	/**
	 * Fires with the path `Context/Action/Slot` of a binding changed by Set/Reset/Clear/Capture/import.
	 * Root handles on one folder share the bindings: it fires on each one that has the binding, with
	 * its own path, also for a change made through another, or a later `Create` filling the binding
	 */
	readonly BindingsChanged: RBXScriptSignal<(path: string) => void>;
	/**
	 * Disconnects everything and destroys what the package created; adopted instances stay. Under
	 * Deferred signals, an event a handle fired before it and Roblox had not delivered yet still
	 * reaches the listeners connected then
	 */
	Destroy(): void;
}

/** Only on contexts marked `ServerAuthority: true` */
export interface IServerAuthorityContextHandle {
	/** Whether the handle wraps the server's copy (true) or, until it arrives, a local stand-in */
	IsLinkedToServer(): boolean;
	/** Fires once, when the stand-in gives way to the server's copy; never when the copy was there at `Create` */
	readonly LinkedToServer: RBXScriptSignal<() => void>;
	/**
	 * Calls `callback` with the server's copy once the handle wraps it: at once (in the caller's
	 * thread) when it does already, else when the stand-in gives way, as `LinkedToServer` fires.
	 * Returns a function that cancels a call still to come
	 */
	WhenLinkedToServer(callback: (context: InputContext) => void): () => void;
}

/** The handle of a context: Server Authority contexts add the link to the server's copy */
export type ContextHandle<C extends IContextSchema> = IContextHandle<C> &
	(C extends { ServerAuthority: true } ? IServerAuthorityContextHandle : unknown);

/** The root handle `Create` returns: a context handle per context, by name, and the root's members */
export type InputHandle<S extends Record<string, IContextSchema>> = {
	readonly [C in keyof S]: ContextHandle<S[C]>;
} & IInputRoot;

/** `Create`'s options */
export interface ICreateOptions {
	/** Where contexts are found or created. Default: `ReplicatedStorage.Inputs` */
	Folder?: Instance;
	/** The folder under the player that holds Server Authority contexts. Default: `"Inputs"` */
	PlayerFolderName?: string;
	/**
	 * Seconds before `Create` warns that the server's copy of a Server Authority context hasn't
	 * arrived (the context runs on a local stand-in meanwhile). Never throws, never blocks. Default: 10
	 */
	Timeout?: number;
	/** Resets every context when a TextBox gains focus, the window loses focus or the menu opens. Default: true */
	ResetOnFocusLoss?: boolean;
}

// ---- server

/** `ProvideToPlayers`' options */
export interface IProvideOptions {
	/** Where the templates are. Default: `ReplicatedStorage.Inputs` */
	Folder?: Instance;
	/** The folder under each player that gets the Server Authority contexts. Default: `"Inputs"` */
	PlayerFolderName?: string;
}
/** `ForPlayer`'s options */
export interface IForPlayerOptions {
	/** The folder under the player that holds the Server Authority contexts. Default: `"Inputs"` */
	PlayerFolderName?: string;
	/** Seconds to wait for the player's contexts, then throw. Default: 10 */
	Timeout?: number;
}

/** A server handle on one action of a player's Server Authority context: read only */
export interface IServerActionHandle<T extends Enum.InputActionType> {
	/** The player's InputAction */
	readonly Instance: InputAction;
	/** The action's name */
	readonly Name: string;
	/** The action's `StateChanged`, as the client's state arrives */
	readonly StateChanged: RBXScriptSignal<(value: ActionValue<T>) => void>;
	/** The state the client sent: read it in `RunService.BindToSimulation` */
	GetState(): ActionValue<T>;
}
/** A server handle on a Bool action: adds `Pressed` and `Released` */
export interface IServerBoolActionHandle extends IServerActionHandle<Enum.InputActionType.Bool> {
	/** The action's `Pressed` */
	readonly Pressed: RBXScriptSignal<() => void>;
	/** The action's `Released` */
	readonly Released: RBXScriptSignal<() => void>;
}
/** The server handle of action definition `D` */
export type ServerActionHandle<D> =
	D extends IActionDefinition<infer T extends Enum.InputActionType, unknown, boolean>
		? [T] extends [Enum.InputActionType.Bool]
			? IServerBoolActionHandle
			: IServerActionHandle<T>
		: never;
/** A server handle on one of a player's Server Authority contexts */
export interface IServerContextHandle<C extends IContextSchema> {
	/** The player's InputContext */
	readonly Instance: InputContext;
	/** The context's name */
	readonly Name: string;
	/** The action handles, by name */
	readonly Actions: { readonly [A in keyof C["Actions"]]: ServerActionHandle<C["Actions"][A]> };
}
/** What `ForPlayer` returns: a handle per context marked `ServerAuthority: true` */
export type ServerInputHandle<S extends Record<string, IContextSchema>> = {
	readonly [C in keyof S as S[C] extends { ServerAuthority: true }
		? C
		: never]: IServerContextHandle<S[C]>;
};
