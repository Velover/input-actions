import type {
	CapturableDevice,
	Device,
	IAnyDeviceKeys,
	IDeviceKeyMap,
	IDeviceKeys,
} from "./KeyGroups";

// ---- binding shapes (one input source per binding, as IAS enforces). Each takes the keys of one
// device (`K`, see KeyGroups' IDeviceKeys); the default takes any device's.

export interface IBindingDisplay {
	/** Stops bare enum items from structurally matching all-optional shapes (e.g. composites) */
	EnumType?: never;
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
/** What the builders' records take before the device checks: any device's keys, or Scriptable */
export type BindingSpec<T extends Enum.InputActionType> = IBindingShapeMap[T["Name"]] | IScriptable;
type PartialEach<U> = U extends unknown ? Partial<U> : never;
/** A binding's current value as plain data in the schema's shape. An unbound binding has no keys */
export type BindingData<
	T extends Enum.InputActionType,
	D extends Device = Device,
> = D extends Device ? PartialEach<IBindingObjectMap<IDeviceKeyMap[D]>[T["Name"]]> : never;

// Generic inference skips excess-property checks, so unknown properties are rejected here. A binding
// named after a device takes that device's keys (`BindingShape<T, D>`), any other name only
// `InputActions.Scriptable` (design spec §3, 0.7.0). Compares a bare key against the device's key
// union with a conditional, never a mapped type over the KeyCode union, which runs tsc out of memory.
type AllKeys<U> = U extends unknown ? keyof U : never;
export type CheckBindings<B, T extends Enum.InputActionType> = {
	// `string`: inference fell back to the constraint (a key the action type can't take), whose
	// error says so; or computed names, which `Schema` checks at runtime
	[K in keyof B]: string extends K
		? unknown
		: K extends Device
			? B[K] extends IScriptable
				? BindingShape<T, K>
				: B[K] extends EnumItem
					? B[K] extends BindingShape<T, K>
						? unknown
						: BindingShape<T, K>
					: IBindingObjectMap<IDeviceKeyMap[K]>[T["Name"]] & {
							[P in Exclude<keyof B[K], AllKeys<IBindingObjectMap[T["Name"]]>>]: never;
						}
			: IScriptable;
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

/** Generic inference skips excess-property checks: a misspelt context option is rejected here */
export type CheckContexts<S> = {
	[C in keyof S]: { [P in Exclude<keyof S[C], keyof IContextSchema>]: never };
};

export interface IInputSchema<S extends Record<string, IContextSchema>> {
	readonly Contexts: S;
}

// ---- client handles

export interface ICaptureOptions {
	/** Keys that cancel the capture */
	Cancel?: Enum.KeyCode[];
}

/**
 * A device's binding of an action (`KeyboardAndMouse`, `Gamepad`, `Touch`): every action has the
 * three, unbound when the schema leaves one out. `D` is the device; a union of devices is a handle
 * any of theirs is assignable to, whose `Set` takes any of their keys (checked at runtime)
 */
export interface IBindingHandle<T extends Enum.InputActionType, D extends Device = Device> {
	readonly Instance: InputBinding;
	/** The device: the binding's name in the schema */
	readonly Name: D;
	/** The current binding as plain data in the schema's shape (`{}` when unbound) */
	Get(): BindingData<T, D>;
	/**
	 * Rebind. Same per-type rules as the schema, and the device's keys only, also checked at runtime.
	 * Objects merge into the binding
	 */
	Set(binding: BindingShape<T, D>): void;
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
	/**
	 * Waits for the next key of this binding's device legal for `slot`, applies it, then calls
	 * `callback`; other devices' keys are ignored (a `Cancel` key counts from any device). On the
	 * gamepad a stick pushed past halfway counts as its direction (`Thumbstick1Up`...), and a
	 * Direction2D `KeyCode` takes the whole stick. Returns a cancel function
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
 * Scriptable ones the schema names
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
	/** Drives the action from code, through a Scriptable binding the package creates on first use */
	Fire(value: ActionValue<T>): void;
	SetEnabled(enabled: boolean): void;
	IsEnabled(): boolean;
	GetPreferredBinding(): InputBinding | undefined;
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
 * picks the device, and goes into that device's binding's `KeyCode`
 */
export interface IActionCapture {
	/**
	 * Waits for the next key a keyboard-and-mouse or gamepad binding of this action can hold in its
	 * `KeyCode`; that key's device picks the binding, which gets it (its composite directions give
	 * way). Then calls `callback` with the key and the device. Touch input is ignored; a `Cancel`
	 * key counts from any device. Returns a cancel function
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
	/** Adds a UIButton binding for this button; the returned function removes it */
	AttachButton(button: GuiButton): () => void;
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

export type ActionHandle<D> =
	D extends IActionDefinition<infer T extends Enum.InputActionType, infer B, infer TP>
		? [T] extends [Enum.InputActionType.Bool]
			? IBoolActionHandle<B> & ([TP] extends [true] ? ITrackedBoolAction : unknown)
			: IActionHandle<T, B> &
					([T] extends [Enum.InputActionType.Direction1D] ? IActionCapture : unknown) &
					([TP] extends [true] ? ITrackedAction<T> : unknown)
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

export interface IBindingsOwner {
	/** The rebinds (what differs from the defaults) as JSON */
	ExportBindings(): string;
	/** Resets to the defaults, then applies the saved rebinds. Never throws */
	ImportBindings(json: string): IImportResult;
	ResetBindings(): void;
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
