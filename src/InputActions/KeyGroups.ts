// KeyCode groups (design spec §3). Defined once as runtime arrays: the types below are derived from
// them, and the same arrays validate bindings at runtime (Set, ImportBindings, SanitizeBindings,
// Capture and adopted bindings).

/** Keys Roblox reserves: never allowed in a binding */
export const RESERVED_KEYS = [
	Enum.KeyCode.Escape,
	Enum.KeyCode.ButtonStart,
	Enum.KeyCode.F9,
	Enum.KeyCode.F11,
	Enum.KeyCode.F12,
	Enum.KeyCode.Print,
] as const;
/** Deprecated keys: never allowed. `None` is the value of an unbound slot */
export const DEPRECATED_KEYS = [
	Enum.KeyCode.None,
	Enum.KeyCode.MouseBackButton,
	Enum.KeyCode.MouseNoButton,
	Enum.KeyCode.MouseX,
	Enum.KeyCode.MouseY,
] as const;
export const MOUSE_BUTTON_KEYS = [
	Enum.KeyCode.MouseLeftButton,
	Enum.KeyCode.MouseRightButton,
	Enum.KeyCode.MouseMiddleButton,
] as const;
/** Single-axis analog: 0..1 */
export const AXIS_KEYS = [
	Enum.KeyCode.ButtonL2,
	Enum.KeyCode.ButtonR2,
	Enum.KeyCode.Thumbstick1Up,
	Enum.KeyCode.Thumbstick1Down,
	Enum.KeyCode.Thumbstick1Left,
	Enum.KeyCode.Thumbstick1Right,
	Enum.KeyCode.Thumbstick2Up,
	Enum.KeyCode.Thumbstick2Down,
	Enum.KeyCode.Thumbstick2Left,
	Enum.KeyCode.Thumbstick2Right,
] as const;
export const STICK_KEYS = [Enum.KeyCode.Thumbstick1, Enum.KeyCode.Thumbstick2] as const;
export const DELTA_1D_KEYS = [
	Enum.KeyCode.MouseWheel,
	Enum.KeyCode.TrackpadPinch,
	Enum.KeyCode.TouchPinch,
] as const;
export const DELTA_2D_KEYS = [
	Enum.KeyCode.MouseDelta,
	Enum.KeyCode.TouchDelta,
	Enum.KeyCode.TrackpadPan,
] as const;
export const POSITION_KEYS = [Enum.KeyCode.MousePosition, Enum.KeyCode.TouchPosition] as const;

export type ReservedKey = (typeof RESERVED_KEYS)[number];
export type DeprecatedKey = (typeof DEPRECATED_KEYS)[number];
export type MouseButtonKey = (typeof MOUSE_BUTTON_KEYS)[number];
export type AxisKey = (typeof AXIS_KEYS)[number];
export type StickKey = (typeof STICK_KEYS)[number];
export type Delta1DKey = (typeof DELTA_1D_KEYS)[number];
export type Delta2DKey = (typeof DELTA_2D_KEYS)[number];
export type PositionKey = (typeof POSITION_KEYS)[number];
/** Keyboard keys, gamepad buttons and TV-remote buttons */
export type ButtonKey = Exclude<
	Enum.KeyCode,
	| ReservedKey
	| DeprecatedKey
	| MouseButtonKey
	| AxisKey
	| StickKey
	| Delta1DKey
	| Delta2DKey
	| PositionKey
>;

export type BoolKey = ButtonKey | MouseButtonKey | AxisKey | Enum.KeyCode.TouchPosition;
export type Direction1DKey = ButtonKey | AxisKey | Delta1DKey;
export type Direction2DKey = StickKey | Delta2DKey;
export type CompositeKey = ButtonKey | AxisKey;
export type ModifierKey = ButtonKey;

// ---- devices (0.7.0): an action's key bindings are named after `Enum.PreferredInput`'s devices,
// and each holds that device's keys only. The TV remote (`MicroGamepad`) has no binding of its own:
// its keys are the Gamepad's.

/** The devices, which name an action's key bindings (as the Input Action Manager names them) */
export const DEVICES = ["KeyboardAndMouse", "Gamepad", "Touch"] as const;
export type Device = (typeof DEVICES)[number];
/** The devices whose keys can be pressed, which captures listen to: touch has no keys */
export type CapturableDevice = Exclude<Device, "Touch">;

/**
 * Gamepad keys: buttons, triggers, the D-pad, sticks and their directions, and the TV remote's
 * buttons. `ButtonStart` is a gamepad key, but reserved: never allowed in a binding.
 */
export const GAMEPAD_KEYS = [
	Enum.KeyCode.ButtonA,
	Enum.KeyCode.ButtonB,
	Enum.KeyCode.ButtonX,
	Enum.KeyCode.ButtonY,
	Enum.KeyCode.ButtonL1,
	Enum.KeyCode.ButtonR1,
	Enum.KeyCode.ButtonL2,
	Enum.KeyCode.ButtonR2,
	Enum.KeyCode.ButtonL3,
	Enum.KeyCode.ButtonR3,
	Enum.KeyCode.ButtonStart,
	Enum.KeyCode.ButtonSelect,
	Enum.KeyCode.DPadLeft,
	Enum.KeyCode.DPadRight,
	Enum.KeyCode.DPadUp,
	Enum.KeyCode.DPadDown,
	Enum.KeyCode.Thumbstick1,
	Enum.KeyCode.Thumbstick2,
	Enum.KeyCode.Thumbstick1Up,
	Enum.KeyCode.Thumbstick1Down,
	Enum.KeyCode.Thumbstick1Left,
	Enum.KeyCode.Thumbstick1Right,
	Enum.KeyCode.Thumbstick2Up,
	Enum.KeyCode.Thumbstick2Down,
	Enum.KeyCode.Thumbstick2Left,
	Enum.KeyCode.Thumbstick2Right,
	Enum.KeyCode.ButtonCenter,
	Enum.KeyCode.ButtonBack,
	Enum.KeyCode.ButtonUp,
	Enum.KeyCode.ButtonDown,
	Enum.KeyCode.ButtonLeft,
	Enum.KeyCode.ButtonRight,
] as const;
/**
 * Touch keys: a tap or a finger's position, a drag, a pinch. `Enum.KeyCode.Touch` is the deprecated
 * name of `TouchPosition`, the same item
 */
export const TOUCH_KEYS = [
	Enum.KeyCode.TouchPosition,
	Enum.KeyCode.TouchDelta,
	Enum.KeyCode.TouchPinch,
] as const;

export type GamepadKey = (typeof GAMEPAD_KEYS)[number];
export type TouchKey = (typeof TOUCH_KEYS)[number];
/** Keyboard keys, mouse buttons, the wheel, mouse movement and position, trackpad gestures */
export type KeyboardAndMouseKey = Exclude<Enum.KeyCode, GamepadKey | TouchKey>;

/**
 * The keys a binding of one device may hold, by what they go in. Derived from the groups above with
 * Exclude/Extract once, here: never per binding (a mapped type over the KeyCode union runs tsc out
 * of memory)
 */
export interface IDeviceKeys {
	/** A Bool binding's `KeyCode` */
	Bool: Enum.KeyCode;
	/** A Direction1D binding's `KeyCode` */
	Direction1D: Enum.KeyCode;
	/** A Direction2D binding's `KeyCode`: a thumbstick */
	Stick: Enum.KeyCode;
	/** A Direction2D binding's `KeyCode`: a movement */
	Delta2D: Enum.KeyCode;
	/** A composite direction (`Up`, `Down`...) */
	Composite: Enum.KeyCode;
	/** `PrimaryModifier`, `SecondaryModifier` */
	Modifier: Enum.KeyCode;
	/** A ViewportPosition binding's `KeyCode` */
	Position: Enum.KeyCode;
}
export interface IKeyboardAndMouseKeys extends IDeviceKeys {
	Bool: Exclude<BoolKey, GamepadKey | TouchKey>;
	Direction1D: Exclude<Direction1DKey, GamepadKey | TouchKey>;
	Stick: never;
	Delta2D: Exclude<Delta2DKey, TouchKey>;
	Composite: Exclude<CompositeKey, GamepadKey>;
	Modifier: Exclude<ModifierKey, GamepadKey>;
	Position: Enum.KeyCode.MousePosition;
}
export interface IGamepadKeys extends IDeviceKeys {
	Bool: Exclude<GamepadKey, ReservedKey | StickKey>;
	Direction1D: Exclude<GamepadKey, ReservedKey | StickKey>;
	Stick: StickKey;
	Delta2D: never;
	Composite: Exclude<GamepadKey, ReservedKey | StickKey>;
	Modifier: Exclude<GamepadKey, ReservedKey | StickKey | AxisKey>;
	Position: never;
}
export interface ITouchKeys extends IDeviceKeys {
	Bool: Enum.KeyCode.TouchPosition;
	Direction1D: Enum.KeyCode.TouchPinch;
	Stick: never;
	Delta2D: Enum.KeyCode.TouchDelta;
	Composite: never;
	Modifier: never;
	Position: Enum.KeyCode.TouchPosition;
}
/** Any device's keys: the rules of the action type alone */
export interface IAnyDeviceKeys extends IDeviceKeys {
	Bool: BoolKey;
	Direction1D: Direction1DKey;
	Stick: StickKey;
	Delta2D: Delta2DKey;
	Composite: CompositeKey;
	Modifier: ModifierKey;
	Position: PositionKey;
}
export interface IDeviceKeyMap {
	KeyboardAndMouse: IKeyboardAndMouseKeys;
	Gamepad: IGamepadKeys;
	Touch: ITouchKeys;
}

export const enum EKeyGroup {
	Reserved,
	Deprecated,
	MouseButton,
	Axis,
	Stick,
	Delta1D,
	Delta2D,
	Position,
	Button,
}

const KEY_GROUPS = new Map<Enum.KeyCode, EKeyGroup>();
const AddGroup = (keys: readonly Enum.KeyCode[], group: EKeyGroup) => {
	for (const key of keys) KEY_GROUPS.set(key, group);
};
AddGroup(RESERVED_KEYS, EKeyGroup.Reserved);
AddGroup(DEPRECATED_KEYS, EKeyGroup.Deprecated);
AddGroup(MOUSE_BUTTON_KEYS, EKeyGroup.MouseButton);
AddGroup(AXIS_KEYS, EKeyGroup.Axis);
AddGroup(STICK_KEYS, EKeyGroup.Stick);
AddGroup(DELTA_1D_KEYS, EKeyGroup.Delta1D);
AddGroup(DELTA_2D_KEYS, EKeyGroup.Delta2D);
AddGroup(POSITION_KEYS, EKeyGroup.Position);

const KEY_DEVICES = new Map<Enum.KeyCode, Device>();
for (const key of GAMEPAD_KEYS) KEY_DEVICES.set(key, "Gamepad");
for (const key of TOUCH_KEYS) KEY_DEVICES.set(key, "Touch");

export function IsKeyCode(value: unknown): value is Enum.KeyCode {
	return typeIs(value, "EnumItem") && value.EnumType === Enum.KeyCode;
}

/** The group of a key; every key not listed in a group is a Button */
export function GetKeyGroup(key: Enum.KeyCode): EKeyGroup {
	return KEY_GROUPS.get(key) ?? EKeyGroup.Button;
}

/**
 * The device a key belongs to, from the key alone: a gamepad's or a touch screen's when listed above,
 * else the keyboard and mouse's. Not from the input that carried it (VirtualInput sends gamepad
 * KeyCodes as keyboard input) nor from `PreferredInput` (which a press switches)
 */
export function GetKeyDevice(key: Enum.KeyCode): Device {
	return KEY_DEVICES.get(key) ?? "KeyboardAndMouse";
}

export function IsDevice(name: unknown): name is Device {
	return (DEVICES as readonly defined[]).includes(name as defined);
}

/**
 * What a device's binding takes, in the messages: the runtime's and the compile errors' (the types
 * read the same words from this interface, so the two can't drift apart)
 */
export interface IDeviceKeysText {
	KeyboardAndMouse: "keyboard and mouse keys";
	Gamepad: "gamepad keys";
	Touch: "touch keys (TouchPosition, TouchDelta, TouchPinch)";
}
/** What a device's binding takes, for messages */
export const DEVICE_KEYS_TEXT: IDeviceKeysText = {
	KeyboardAndMouse: "keyboard and mouse keys",
	Gamepad: "gamepad keys",
	Touch: "touch keys (TouchPosition, TouchDelta, TouchPinch)",
};
