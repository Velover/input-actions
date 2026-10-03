import type { BindingHandleMember, BindingPropertyName } from "./BindingRules";
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

export interface IBindingDisplay {
	/** Stops bare enum items from structurally matching all-optional shapes (e.g. composites) */
	EnumType?: never;
	/** Tells a binding from a device's namespace, `{ Main: <binding>, <Extra>: <binding> }` */
	Main?: never;
	DisplayName?: string;
	/** An image URI, e.g. `rbxassetid://...` */
	DisplayImage?: string;
}
export interface IBindingModifiers<K extends IDeviceKeys = IAnyDeviceKeys> extends IBindingDisplay {
	PrimaryModifier?: K["Modifier"];
	SecondaryModifier?: K["Modifier"];
}
export interface IAxisShaping {
	Scale?: number;
	ClampMagnitudeToOne?: boolean;
}

export interface IBoolBinding<K extends IDeviceKeys = IAnyDeviceKeys> extends IBindingModifiers<K> {
	KeyCode: K["Bool"];
	PressedThreshold?: number;
	ReleasedThreshold?: number;
}

export interface IDirection1DKeyBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	KeyCode: K["Direction1D"];
	Up?: never;
	Down?: never;
}
export interface IDirection1DCompositeBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	KeyCode?: never;
	Up?: K["Composite"];
	Down?: K["Composite"];
}

export interface IDirection2DStickBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	KeyCode: K["Stick"];
	ResponseCurve?: number;
	Vector2Scale?: Vector2;
	Up?: never;
	Down?: never;
	Left?: never;
	Right?: never;
}
export interface IDirection2DDeltaBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	KeyCode: K["Delta2D"];
	ResponseCurve?: never;
	Vector2Scale?: Vector2;
	Up?: never;
	Down?: never;
	Left?: never;
	Right?: never;
}
export interface IDirection2DCompositeBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	KeyCode?: never;
	ResponseCurve?: never;
	Vector2Scale?: Vector2;
	Up?: K["Composite"];
	Down?: K["Composite"];
	Left?: K["Composite"];
	Right?: K["Composite"];
}

export interface IDirection3DCompositeBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingModifiers<K>,
		IAxisShaping {
	Up?: K["Composite"];
	Down?: K["Composite"];
	Left?: K["Composite"];
	Right?: K["Composite"];
	Forward?: K["Composite"];
	Backward?: K["Composite"];
	Vector3Scale?: Vector3;
}

export interface IViewportPositionBinding<K extends IDeviceKeys = IAnyDeviceKeys>
	extends IBindingDisplay {
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
	readonly Main: NamespaceBindingSpec<T>;
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
 * keys. The same forms as `BindingPart`, so `Set(binding.Get())` takes it back (hunt HD4-6)
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
 * says it at runtime: another device's key the slot takes, or a key the slot never takes
 */
type KeyProblem<X, T extends Enum.InputActionType, D extends Device, P extends string> =
	X extends Enum.KeyCode
		? FitsSlot<X, T, P> extends true
			? `${X["Name"]} is a ${KeyDeviceOf<X>} key: a ${D} binding takes ${IDeviceKeysText[D]}`
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
 * Why property `P` (holding `X`) isn't one of the action type's bindings', as the runtime says it;
 * written beside the keys of a schema's binding (`whole`), a key or an object is likely another
 * binding of the device, which goes in its namespace
 */
type UnknownProperty<P, T extends Enum.InputActionType, X, Whole extends boolean> = [Whole, X] extends [
	true,
	object,
]
	? `${P & string} is not a property of a ${T["Name"]} binding; several bindings of one device go in { Main: <binding>, ${P & string}: <binding> }`
	: `${P & string} is not a property of a ${T["Name"]} binding`;
/** Whether a property holds something: not when left out (undefined), nor a shape's `?: never` */
type Holds<X> = [Exclude<X, undefined>] extends [never] ? false : true;
/** Whether object binding `V` has a key in its `KeyCode` */
type HasKeyCode<V> = V extends { KeyCode: Enum.KeyCode } ? true : false;
/**
 * What is wrong with property `P` of object binding `V` of device `D`, in words; never when nothing
 * is. `Whole`: the object is the whole binding (a schema's), not a part `Set` merges in, so a
 * `ResponseCurve` needs its `KeyCode` to be a thumbstick there
 */
type PropertyProblem<V, P extends keyof V, T extends Enum.InputActionType, D extends Device, Whole extends boolean> =
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
						: [Whole, V] extends [true, { KeyCode: StickKey }] | [false, unknown]
							? never
							: "ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode"
					: never
			: UnknownProperty<P, T, V[P], Whole>;
/** Every problem of object binding `V`, in words; never when there is none */
type ObjectProblems<V, T extends Enum.InputActionType, D extends Device, Whole extends boolean> = {
	[P in keyof V]-?: PropertyProblem<V, P, T, D, Whole>;
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
type ObjectSentences<V, T extends Enum.InputActionType, D extends Device, Whole extends boolean> = {
	[P in keyof V]: [PropertyProblem<V, P, T, D, Whole>] extends [never]
		? unknown
		: Sentence<PropertyProblem<V, P, T, D, Whole>, V[P]>;
};
/**
 * What one form `V` of device `D`'s binding is checked against. It distributes over a union (a
 * value of `BindingShape<T, D>`, or a conditional between a bare key and an object), so each member
 * is checked as it is (hunt HD2-1). A key that fits gives back itself, never `unknown`, which would
 * swallow the other members' checks. An object that fits one of the device's forms and has no
 * property they lack gives back itself too; one that doesn't is checked property by property, each
 * refused property against its sentence, and with none refused, against the device's forms (a
 * `KeyCode` a form requires). The forms first: the sentences cost more, and most bindings fit
 */
type CheckDeviceBinding<V, T extends Enum.InputActionType, D extends Device> = V extends IScriptable
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
					: ObjectSentences<V, T, D, true>
				: [ObjectProblems<V, T, D, true>] extends [never]
					? IBindingObjectMap<IDeviceKeyMap[D]>[T["Name"]]
					: ObjectSentences<V, T, D, true>
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
 * One binding of a device's namespace: as the device's binding (`CheckDeviceBinding`), or `{}`,
 * one with no keys
 */
type CheckNamespaceBinding<V, T extends Enum.InputActionType, D extends Device> = V extends object
	? [keyof V] extends [never]
		? V
		: CheckDeviceBinding<V, T, D>
	: CheckDeviceBinding<V, T, D>;
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
export type CheckBindings<B, T extends Enum.InputActionType> = {
	// `string`: computed names, which `Schema` checks at runtime
	[K in keyof B]: string extends K
		? unknown
		: K extends Device
			? CheckDeviceValue<B[K], T, K>
			: B[K] extends IScriptable
				? unknown
				: NotADevice<K>;
};

// ---- values

export interface IActionValueMap {
	Bool: boolean;
	Direction1D: number;
	Direction2D: Vector2;
	Direction3D: Vector3;
	ViewportPosition: Vector2;
}
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
export type CaptureSlot<T extends Enum.InputActionType> = ICaptureSlotMap[T["Name"]];
export type BindingSlot = ICaptureSlotMap[keyof ICaptureSlotMap];

// ---- schema

export interface IActionDefinition<
	T extends Enum.InputActionType,
	B,
	TP extends boolean = boolean,
> {
	readonly Type: T;
	readonly Bindings: B;
	readonly TrackPrevious: TP;
	readonly DisplayName?: string;
	readonly Enabled?: boolean;
}

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

export interface IContextSchema {
	/** The server creates this context and its actions under each Player; the bindings stay on the client */
	ServerAuthority?: boolean;
	Priority?: number;
	Sink?: boolean;
	Enabled?: boolean;
	Actions: { [name: string]: IActionDefinition<Enum.InputActionType, unknown, boolean> };
}

/**
 * Generic inference skips excess-property checks: a misspelt context option is rejected here, with
 * the runtime's sentence
 */
export type CheckContexts<S> = {
	[C in keyof S]: {
		[P in Exclude<keyof S[C], keyof IContextSchema>]: Sentence<
			`unknown option ${P & string}; a context has ServerAuthority, Priority, Sink, Enabled and Actions`,
			S[C][P]
		>;
	};
};

export interface IInputSchema<S extends Record<string, IContextSchema>> {
	readonly Contexts: S;
}
/**
 * A schema as `Create`, `ForPlayer`, `ProvideToPlayers` and `SanitizeBindings` take it: what
 * `Schema` returns, or `{ Contexts }` written without it, whose misspelt context options are refused
 * here, as `Schema`'s parameter refuses them (hunt HD3-2). A generic `S` passes on as it is, so a
 * helper over `InputActions.InputSchema<S>` can call them. An interface, not an intersection: from
 * one instantiation of it to another `S` is inferred as it is, where from an intersection it was
 * inferred as `S & CheckContexts<S>`, which `ServerHandle<S>` doesn't take (hunt HD4-2)
 */
export interface ICheckedInputSchema<S extends Record<string, IContextSchema>>
	extends IInputSchema<S> {
	readonly Contexts: S & CheckContexts<S>;
}
/**
 * What `Schema` returns: a schema it checked. The functions that take a schema take this first, as
 * it is, then `ICheckedInputSchema<S>`: checked again, its type would be the context a `Schema` call
 * written inside them infers from, and a preset with no options there would infer its options from
 * that check instead of from its argument (hunt HD4-3)
 */
export interface ISchema<S extends Record<string, IContextSchema>> extends IInputSchema<S> {
	readonly _nominal_InputActionsSchema: unique symbol;
}

// ---- client handles

export interface ICaptureOptions {
	/** Keys that cancel the capture */
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
	Extras(): IExtraBindings<ICaptureBindingHandle<T, D>>;
	/**
	 * Waits for the next key of this binding's device legal for `slot`, applies it, then calls
	 * `callback`; other devices' keys are ignored (a `Cancel` key counts from any device). On the
	 * gamepad a stick pushed past halfway counts as its direction (`Thumbstick1Up`...), and a
	 * Direction2D `KeyCode` takes the whole stick; a trigger counts once pulled past halfway.
	 * Returns a cancel function
	 */
	Capture(
		slot: CaptureSlot<T>,
		callback: (key: Enum.KeyCode) => void,
		options?: ICaptureOptions,
	): () => void;
}
/** What `CaptureChord` applied: the key, and the modifiers held before it, in the order they went down */
export interface IChord {
	readonly KeyCode: Enum.KeyCode;
	readonly PrimaryModifier?: Enum.KeyCode;
	readonly SecondaryModifier?: Enum.KeyCode;
}

/** The action types whose `KeyCode` takes keys that can be pressed, so that a chord can end on one */
export type ChordActionName = "Bool" | "Direction1D";

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

export interface IScriptableBindingHandle<T extends Enum.InputActionType> {
	readonly Instance: InputBinding;
	readonly Name: string;
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

export interface IActionHandle<T extends Enum.InputActionType, B> {
	/** The InputAction the handle wraps now (a Server Authority stand-in's, then the server's copy's) */
	readonly Instance: InputAction;
	readonly Name: string;
	readonly Type: T;
	/**
	 * Forwards the action's `StateChanged`, from whichever instance the handle wraps; it never
	 * repeats the value it passed on last (the Server Authority swap can bring such a repeat)
	 */
	readonly StateChanged: RBXScriptSignal<(value: ActionValue<T>) => void>;
	readonly Bindings: BindingHandles<T, B>;
	GetState(): ActionValue<T>;
	/**
	 * Drives the action from code, through a Scriptable binding the package creates on first use.
	 * Created while the action is held, that binding releases it before the value lands (IAS resets
	 * an action's bindings when one is added, as for `AttachButton`)
	 */
	Fire(value: ActionValue<T>): void;
	SetEnabled(enabled: boolean): void;
	IsEnabled(): boolean;
	GetPreferredBinding(): InputBinding | undefined;
	/**
	 * The keybind of `device` as text (`"Space"`, `"Ctrl + S"`, `"W / A / S / D"`): its main
	 * binding's `Describe()`, `""` when that has no key. By default the device the player uses
	 * (`InputActions.PreferredDevice()`)
	 */
	Describe(device?: Device): string;
	/**
	 * Points an InputActionLabel at this action, which then shows its keybind; at the swap to the
	 * server's copy of a Server Authority context the label follows, while it still shows the
	 * stand-in's action. A label is on one action at a time: the last `AttachLabel`, from any handle,
	 * takes it over. The returned function, the label's destruction or the root handle's `Destroy`
	 * let go of it, which clears its `InputAction` unless it was pointed elsewhere meanwhile. Once
	 * another `AttachLabel` took the label over, the function and `Destroy` leave it alone
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
	 * with the key and the device. Touch input is ignored; a `Cancel` key counts from any device.
	 * Returns a cancel function
	 */
	Capture(
		callback: (key: Enum.KeyCode, device: CapturableDevice) => void,
		options?: ICaptureOptions,
	): () => void;
	/**
	 * Waits for keys held together, as a binding's `CaptureChord` does: the first key that goes
	 * down picks the device, and the other device's keys are ignored while any key of the chord is
	 * held (no Shift + ButtonA). The chord goes into that device's binding. `callback` gets the
	 * chord and the device, or `undefined` twice when the capture ends with nothing applied
	 */
	CaptureChord(
		callback: (chord: IChord | undefined, device: CapturableDevice | undefined) => void,
		options?: IChordCaptureOptions,
	): () => void;
}

export interface IBoolActionHandle<B>
	extends IActionHandle<Enum.InputActionType.Bool, B>,
		IActionCapture {
	readonly Pressed: RBXScriptSignal<() => void>;
	readonly Released: RBXScriptSignal<() => void>;
	IsPressed(): boolean;
	/**
	 * Fires `true`, then `false` on the next frame. On the server's copy of a Server Authority
	 * context, `false` waits until the press shows in the state, so the server sees it
	 */
	Tap(): void;
	/**
	 * Adds a UIButton binding for this button; the returned function removes it. Adding it releases
	 * the action if it is held: IAS resets an action's bindings when one is added, and a key still
	 * down holds it again only once pressed again
	 */
	AttachButton(button: GuiButton): () => void;
	/**
	 * Calls `callback` on a tap: a press released within `MaxDuration` (0.25 s). With
	 * `WaitForDoubleTap`, only once `Window` (0.3 s) has passed after the release without a second
	 * press, so a tap and an `OnDoubleTap` with the same `Window` exclude each other. Returns a
	 * function that stops it; `Destroy` stops it too
	 */
	OnTap(callback: () => void, options?: ITapOptions): () => void;
	/**
	 * Calls `callback` on a double tap, at its second press: a press within `Window` (0.3 s) after
	 * a tap (a press released within `MaxDuration`, 0.25 s). Returns a function that stops it
	 */
	OnDoubleTap(callback: () => void, options?: IDoubleTapOptions): () => void;
	/**
	 * Calls `callback` once a press has been held for `Duration`, while it is still held
	 * (hold-to-interact, a charge). `Progress` gets 0 at the press, then the fraction held each
	 * frame, and 1 as it completes; `Cancelled` runs, after `Progress(0)`, when the press ends
	 * first. Returns a function that stops it
	 */
	OnHold(callback: () => void, options: IHoldOptions): () => void;
	/**
	 * Calls `callback` with the seconds held when a press held for at least `Duration` is released
	 * (charge and release). Returns a function that stops it
	 */
	OnLongPress(callback: (heldFor: number) => void, options: ILongPressOptions): () => void;
}

/**
 * The gestures' options: durations in seconds, positive and finite (anything else throws). A
 * gesture starts with the next press, and a release that a reset makes (the context or the action
 * disabled, the focus-loss reset, a rebind or a binding added while held, the Server Authority
 * swap) ends it without completing it
 */
export interface ITapOptions {
	/** The longest press that is a tap. Default 0.25 */
	MaxDuration?: number;
	/** Call back only once `Window` has passed after the tap without another press */
	WaitForDoubleTap?: boolean;
	/** With `WaitForDoubleTap`: the double-tap window, as `OnDoubleTap`'s. Default 0.3 */
	Window?: number;
}
export interface IDoubleTapOptions {
	/** Seconds from the first tap's release within which the second press counts. Default 0.3 */
	Window?: number;
	/** The longest press the first tap may be. Default 0.25 */
	MaxDuration?: number;
}
export interface IHoldOptions {
	/** Seconds held */
	Duration: number;
	/** Each frame while held, the fraction of `Duration` held (0 at the press, 1 as it completes) */
	Progress?: (fraction: number) => void;
	/** The press ended (or was reset) before `Duration` */
	Cancelled?: () => void;
}
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
export interface ITrackedBoolAction extends ITrackedAction<Enum.InputActionType.Bool> {
	/** Also true for a press and release within one frame */
	IsJustPressed(): boolean;
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

export type ActionHandle<D> =
	D extends IActionDefinition<infer T extends Enum.InputActionType, infer B, infer TP>
		? ([T] extends [Enum.InputActionType.Bool]
				? IBoolActionHandle<B> & ([TP] extends [true] ? ITrackedBoolAction : unknown)
				: IActionHandle<T, B> &
						([T] extends [Enum.InputActionType.Direction1D] ? IActionCapture : unknown) &
						([TP] extends [true] ? ITrackedAction<T> : unknown)) &
				WithExtras<T, B>
		: never;

export interface IImportResult {
	/** Paths (`Context/Action/Slot`) whose saved values were applied */
	Applied: string[];
	/** Entries that were not applied; those bindings stay at their defaults */
	Skipped: ISkippedBinding[];
}
export interface ISkippedBinding {
	Path: string;
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
	/** The first key they share, in the given binding's order (its key or directions, then modifiers) */
	readonly Key: Enum.KeyCode;
	/** Every key they share */
	readonly Keys: readonly Enum.KeyCode[];
	/**
	 * A key presses both with the same modifiers: every press of it presses both. Otherwise they
	 * only overlap: a chord and its plain key (IAS presses both when the chord is pressed: a chord
	 * doesn't block its plain key), two chords on one key, or a key that is the other's modifier
	 */
	readonly Identical: boolean;
}
/** Two bindings of one device that share a key: what `FindConflicts()` lists, each pair once */
export interface IConflictPair {
	readonly Bindings: readonly [AnyBindingHandle, AnyBindingHandle];
	/** Their paths, the first before the second in sorted order */
	readonly Paths: readonly [string, string];
	/** The first key they share, in the first binding's order */
	readonly Key: Enum.KeyCode;
	readonly Keys: readonly Enum.KeyCode[];
	readonly Identical: boolean;
}

export interface IBindingsOwner {
	/** The rebinds (what differs from the defaults) as JSON */
	ExportBindings(): string;
	/** Resets to the defaults, then applies the saved rebinds. Never throws */
	ImportBindings(json: string): IImportResult;
	ResetBindings(): void;
	/**
	 * The other bindings of `binding`'s device (on the root handle, in every context; on a context
	 * handle, in its own) that share a key with it, in any of their key slots, by path. A rebinding
	 * menu calls it after a capture to warn, swap or clear the other. Unbound bindings conflict with
	 * nothing; which contexts are enabled or sink plays no part
	 */
	FindConflicts(binding: AnyBindingHandle): IBindingConflict[];
	/** Every pair of bindings of one device that share a key, each pair once, by path */
	FindConflicts(): IConflictPair[];
}

export interface IContextHandle<C extends IContextSchema> extends IBindingsOwner {
	/** The InputContext the handle wraps now: set Priority or Sink on it directly */
	readonly Instance: InputContext;
	readonly Name: string;
	readonly Actions: { readonly [A in keyof C["Actions"]]: ActionHandle<C["Actions"][A]> };
	readonly EnabledChanged: RBXScriptSignal<(enabled: boolean) => void>;
	/** Sets the base state */
	SetEnabled(enabled: boolean): void;
	/** The effective state: base state overridden by requests (any `false` request wins) */
	IsEnabled(): boolean;
	/** Holds the context enabled or disabled until the returned function is called */
	Request(enabled: boolean): () => void;
}

export interface IInputRoot extends IBindingsOwner {
	/** Fires with the path `Context/Action/Slot` of a binding changed by Set/Reset/Clear/Capture/import */
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

export type InputHandle<S extends Record<string, IContextSchema>> = {
	readonly [C in keyof S]: ContextHandle<S[C]>;
} & IInputRoot;

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

export interface IProvideOptions {
	/** Where the templates are. Default: `ReplicatedStorage.Inputs` */
	Folder?: Instance;
	/** Default: `"Inputs"` */
	PlayerFolderName?: string;
}
export interface IForPlayerOptions {
	/** Default: `"Inputs"` */
	PlayerFolderName?: string;
	/** Seconds to wait for the player's contexts. Default: 10 */
	Timeout?: number;
}

export interface IServerActionHandle<T extends Enum.InputActionType> {
	readonly Instance: InputAction;
	readonly Name: string;
	readonly StateChanged: RBXScriptSignal<(value: ActionValue<T>) => void>;
	GetState(): ActionValue<T>;
}
export interface IServerBoolActionHandle extends IServerActionHandle<Enum.InputActionType.Bool> {
	readonly Pressed: RBXScriptSignal<() => void>;
	readonly Released: RBXScriptSignal<() => void>;
}
export type ServerActionHandle<D> =
	D extends IActionDefinition<infer T extends Enum.InputActionType, unknown, boolean>
		? [T] extends [Enum.InputActionType.Bool]
			? IServerBoolActionHandle
			: IServerActionHandle<T>
		: never;
export interface IServerContextHandle<C extends IContextSchema> {
	readonly Instance: InputContext;
	readonly Name: string;
	readonly Actions: { readonly [A in keyof C["Actions"]]: ServerActionHandle<C["Actions"][A]> };
}
export type ServerInputHandle<S extends Record<string, IContextSchema>> = {
	readonly [C in keyof S as S[C] extends { ServerAuthority: true }
		? C
		: never]: IServerContextHandle<S[C]>;
};
