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

export function IsKeyCode(value: unknown): value is Enum.KeyCode {
	return typeIs(value, "EnumItem") && value.EnumType === Enum.KeyCode;
}

/** The group of a key; every key not listed in a group is a Button */
export function GetKeyGroup(key: Enum.KeyCode): EKeyGroup {
	return KEY_GROUPS.get(key) ?? EKeyGroup.Button;
}
