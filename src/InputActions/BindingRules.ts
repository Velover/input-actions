import {
	DEVICE_KEYS_TEXT,
	DEVICES,
	Device,
	EKeyGroup,
	GetKeyDevice,
	GetKeyGroup,
	IsDevice,
	IsKeyCode,
} from "./KeyGroups";
import type { BindingSlot } from "./Types";

// The per-action-type binding rules of design spec §3, checked at runtime: schema bindings, Set,
// Capture, ImportBindings, SanitizeBindings and adopted bindings all go through here. Since 0.7.0 a
// binding is a device's (its name), and holds only that device's keys.

export type ActionTypeName = Enum.InputActionType["Name"];

export const COMPOSITE_SLOTS = ["Up", "Down", "Left", "Right", "Forward", "Backward"] as const;
export type CompositeSlot = (typeof COMPOSITE_SLOTS)[number];
export const MODIFIER_SLOTS = ["PrimaryModifier", "SecondaryModifier"] as const;
export const KEY_SLOTS = ["KeyCode", ...COMPOSITE_SLOTS, ...MODIFIER_SLOTS] as const;

/** The properties `ExportBindings` saves, in a stable order */
export const SAVED_PROPERTIES = [
	...KEY_SLOTS,
	"Scale",
	"Vector2Scale",
	"Vector3Scale",
	"ResponseCurve",
	"PressedThreshold",
	"ReleasedThreshold",
] as const;
export type SavedProperty = (typeof SAVED_PROPERTIES)[number];

/** Every property a binding may have in a schema, and `EnumType`, which keeps enum items out of the shapes */
export const BINDING_PROPERTY_NAMES = [
	...SAVED_PROPERTIES,
	"ClampMagnitudeToOne",
	"DisplayName",
	"DisplayImage",
	"EnumType",
] as const;

/**
 * The members of a device's binding handle (`BindingHandle`, the internal ones too). A device's extra
 * bindings hang off its main binding's handle by their names, so an extra can't take one of these;
 * the `device-extras` section checks the list against a live handle
 */
export const BINDING_HANDLE_MEMBERS = [
	"Instance",
	"Name",
	"Path",
	"ActionType",
	"Get",
	"Set",
	"Reset",
	"Clear",
	"Capture",
	"CaptureChord",
	"Extras",
	"AddExtra",
	"Retarget",
	"GetDefaults",
	"ApplyChord",
	"ApplyCapturedKey",
	"ExportChanges",
	"CapturableDevice",
	"Write",
	"_runtime",
	"_defaults",
	"_extras",
] as const;

/**
 * The names a device's extra binding can't take (0.7.0): `Main`, the main binding's own; a member
 * of the binding handle the extras hang off; a binding's property, which would make the namespace
 * read as a binding
 */
export const RESERVED_EXTRA_NAMES = [
	"Main",
	...BINDING_HANDLE_MEMBERS,
	...BINDING_PROPERTY_NAMES,
] as const;
export type ReservedExtraName = (typeof RESERVED_EXTRA_NAMES)[number];

/**
 * Whether a device's binding in a schema is a namespace, `{ Main: <binding>, <Extra>: <binding> }`:
 * an object with a `Main` key (a binding has no such property)
 */
export function IsNamespace(spec: unknown): spec is Readonly<Record<string, unknown>> {
	return typeIs(spec, "table") && (spec as { Main?: unknown }).Main !== undefined;
}

/** Why a device's extra binding can't have this name, if it can't (`Main` is the main binding) */
export function ExtraNameProblem(name: unknown): string | undefined {
	if (!typeIs(name, "string") || name === "")
		return `an extra binding's name must be a string of at least one character, not ${tostring(name)}`;
	if (name.find("/", 1, true)[0] !== undefined) return `an extra binding's name can't contain "/"`;
	if ((BINDING_HANDLE_MEMBERS as readonly string[]).includes(name)) {
		return (
			`"${name}" is a member of a binding handle, which the device's extras hang off ` +
			`(Bindings.<Device>.<Extra>): name the extra something else`
		);
	}
	if ((BINDING_PROPERTY_NAMES as readonly string[]).includes(name)) {
		return (
			`"${name}" is a binding property, not an extra binding: { Main: <binding>, <Name>: <binding> } ` +
			"holds the device's bindings by names of your own"
		);
	}
	return undefined;
}

const COMPOSITES_OF: Record<ActionTypeName, readonly CompositeSlot[]> = {
	Bool: [],
	Direction1D: ["Up", "Down"],
	Direction2D: ["Up", "Down", "Left", "Right"],
	Direction3D: COMPOSITE_SLOTS,
	ViewportPosition: [],
};
/** Tuning properties besides keys and display, per action type */
const TUNING_OF: Record<ActionTypeName, readonly string[]> = {
	Bool: ["PressedThreshold", "ReleasedThreshold"],
	Direction1D: ["Scale", "ClampMagnitudeToOne"],
	Direction2D: ["Scale", "ClampMagnitudeToOne", "Vector2Scale", "ResponseCurve"],
	Direction3D: ["Scale", "ClampMagnitudeToOne", "Vector3Scale"],
	ViewportPosition: [],
};
const DISPLAY_PROPERTIES = ["DisplayName", "DisplayImage"];

export function IsCompositeSlot(name: string): name is CompositeSlot {
	return (COMPOSITE_SLOTS as readonly string[]).includes(name);
}

/** Whether `slot` is a key slot a binding on this action type may use */
export function IsSlotOf(actionType: ActionTypeName, slot: string): slot is BindingSlot {
	if (slot === "KeyCode") return actionType !== "Direction3D";
	if (slot === "PrimaryModifier" || slot === "SecondaryModifier")
		return actionType !== "ViewportPosition";
	return IsCompositeSlot(slot) && COMPOSITES_OF[actionType].includes(slot);
}

/**
 * Whether `key` may go in `slot` of a binding on this action type. `None` is never allowed here.
 * With `device`, the key must also be that device's (the binding's own)
 */
export function IsKeyAllowed(
	actionType: ActionTypeName,
	slot: string,
	key: Enum.KeyCode,
	device?: Device,
): boolean {
	if (device !== undefined && GetKeyDevice(key) !== device) return false;
	if (!IsSlotOf(actionType, slot)) return false;
	const group = GetKeyGroup(key);
	if (group === EKeyGroup.Reserved || group === EKeyGroup.Deprecated) return false;
	if (slot === "PrimaryModifier" || slot === "SecondaryModifier") return group === EKeyGroup.Button;
	if (slot !== "KeyCode") return group === EKeyGroup.Button || group === EKeyGroup.Axis;
	switch (actionType) {
		case "Bool":
			return (
				group === EKeyGroup.Button ||
				group === EKeyGroup.MouseButton ||
				group === EKeyGroup.Axis ||
				key === Enum.KeyCode.TouchPosition
			);
		case "Direction1D":
			return group === EKeyGroup.Button || group === EKeyGroup.Axis || group === EKeyGroup.Delta1D;
		case "Direction2D":
			return group === EKeyGroup.Stick || group === EKeyGroup.Delta2D;
		case "ViewportPosition":
			return group === EKeyGroup.Position;
		default:
			return false;
	}
}

/** Whether a (non-key) property may be set on a binding of this action type */
export function IsPropertyOf(actionType: ActionTypeName, name: string): boolean {
	return (
		IsSlotOf(actionType, name) ||
		TUNING_OF[actionType].includes(name) ||
		DISPLAY_PROPERTIES.includes(name)
	);
}

/** The largest float: the binding properties are floats, and a larger number becomes `inf` there */
const FLOAT_MAX = 3.4028234663852886e38;

/** Whether a number stays finite in a float property (so it exports, and the export imports) */
export function IsFiniteNumber(value: unknown): value is number {
	return typeIs(value, "number") && value === value && math.abs(value) <= FLOAT_MAX;
}

/** Why a key that the action type allows in a slot can't go in a binding of `device`, if it can't */
function DeviceProblem(key: Enum.KeyCode, device: Device | undefined): string | undefined {
	if (device === undefined) return undefined;
	const owner = GetKeyDevice(key);
	if (owner === device) return undefined;
	return `${key.Name} is a ${owner} key: a ${device} binding takes ${DEVICE_KEYS_TEXT[device]}`;
}

/** Why `key` can't go in `slot` of a binding of `device` on this action type, if it can't */
export function KeyRuleProblem(
	actionType: ActionTypeName,
	slot: string,
	key: Enum.KeyCode,
	device?: Device,
): string | undefined {
	if (!IsKeyAllowed(actionType, slot, key))
		return `${key.Name} is not allowed in ${slot} on a ${actionType} action`;
	return DeviceProblem(key, device);
}

function KeyProblem(
	actionType: ActionTypeName,
	slot: string,
	value: unknown,
	device: Device | undefined,
): string | undefined {
	if (!IsKeyCode(value)) return `${slot} must be an Enum.KeyCode`;
	return KeyRuleProblem(actionType, slot, value, device);
}

/**
 * Why a binding of an action can't have this name, if it can't: a binding with keys is a device's
 * (`KeyboardAndMouse`, `Gamepad`, `Touch`, the names the Input Action Manager gives them too), and
 * any other binding must be `InputActions.Scriptable`
 */
export function BindingNameProblem(slot: string, scriptable: boolean): string | undefined {
	const devices = DEVICES.join(", ");
	if (scriptable && IsDevice(slot)) {
		return (
			`${slot} is a device: its binding holds keys, not InputActions.Scriptable. Name a ` +
			`Scriptable binding something else (the devices are ${devices})`
		);
	}
	if (!scriptable && !IsDevice(slot)) {
		return (
			`"${slot}" is not a device: bindings with keys are named ${devices}; any other binding ` +
			"must be InputActions.Scriptable"
		);
	}
	return undefined;
}

const RESPONSE_CURVE_PROBLEM = "ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode";

/** Why a binding that ends on `keyCode` can't have a ResponseCurve, if it can't */
function ResponseCurveProblem(keyCode: Enum.KeyCode): string | undefined {
	return GetKeyGroup(keyCode) === EKeyGroup.Stick ? undefined : RESPONSE_CURVE_PROBLEM;
}

/**
 * Checks a binding written by the user (a bare key or an object shape, as in the schema or `Set`).
 * Returns the problem, or undefined when the binding is valid.
 * @param device the binding's device: its keys must be that device's
 * @param keyCode the KeyCode the binding has, which `Set` merges the object into: a ResponseCurve
 * is checked against the KeyCode after the merge (hunt HD3-3). None for a schema binding, which is
 * the whole binding
 */
export function CheckBindingSpec(
	actionType: ActionTypeName,
	spec: unknown,
	device?: Device,
	keyCode: Enum.KeyCode = Enum.KeyCode.None,
): string | undefined {
	if (IsKeyCode(spec)) return KeyProblem(actionType, "KeyCode", spec, device);
	if (!typeIs(spec, "table"))
		return `a binding must be an Enum.KeyCode, an object or InputActions.Scriptable`;

	let hasKeyCode = false;
	let hasComposite = false;
	for (const [name, value] of pairs(spec as Record<string, unknown>)) {
		if (!typeIs(name, "string") || !IsPropertyOf(actionType, name)) {
			return `${tostring(name)} is not a property of a ${actionType} binding`;
		}
		if (IsSlotOf(actionType, name)) {
			const problem = KeyProblem(actionType, name, value, device);
			if (problem !== undefined) return problem;
			if (name === "KeyCode") hasKeyCode = true;
			else if (IsCompositeSlot(name)) hasComposite = true;
			continue;
		}
		const problem = CheckPropertyValue(name, value);
		if (problem !== undefined) return problem;
	}
	if (hasKeyCode && hasComposite) return "KeyCode and composite directions can't share a binding";
	const record = spec as { KeyCode?: Enum.KeyCode; ResponseCurve?: unknown };
	if (record.ResponseCurve === undefined) return undefined;
	// The KeyCode the binding ends up with: the object's, else none after a composite direction,
	// else the one it has
	return ResponseCurveProblem(record.KeyCode ?? (hasComposite ? Enum.KeyCode.None : keyCode));
}

function CheckPropertyValue(name: string, value: unknown): string | undefined {
	switch (name) {
		case "DisplayName":
		case "DisplayImage":
			return typeIs(value, "string") ? undefined : `${name} must be a string`;
		case "ClampMagnitudeToOne":
			return typeIs(value, "boolean") ? undefined : `${name} must be a boolean`;
		case "Vector2Scale":
			return typeIs(value, "Vector2") && IsFiniteNumber(value.X) && IsFiniteNumber(value.Y)
				? undefined
				: `${name} must be a finite Vector2`;
		case "Vector3Scale":
			return typeIs(value, "Vector3") &&
				IsFiniteNumber(value.X) &&
				IsFiniteNumber(value.Y) &&
				IsFiniteNumber(value.Z)
				? undefined
				: `${name} must be a finite Vector3`;
		default:
			return IsFiniteNumber(value)
				? undefined
				: `${name} must be a finite number (a float: at most 3.4e38 either way)`;
	}
}

/**
 * Checks the keys of an existing (adopted) binding. `None` slots are fine: an unbound binding is
 * legal at runtime. Returns the problem, or undefined.
 * @param device the device the binding stands for: its keys must be that device's
 */
export function CheckBindingKeys(
	actionType: ActionTypeName,
	binding: InputBinding,
	device?: Device,
): string | undefined {
	if (binding.Type === Enum.InputBindingType.Scriptable) return undefined;
	let hasComposite = false;
	for (const slot of KEY_SLOTS) {
		const key = binding[slot];
		if (key === Enum.KeyCode.None) continue;
		if (!IsSlotOf(actionType, slot))
			return `${slot} = ${key.Name} is not used by a ${actionType} action`;
		const problem = KeyRuleProblem(actionType, slot, key, device);
		if (problem !== undefined) return problem;
		if (IsCompositeSlot(slot)) hasComposite = true;
	}
	if (binding.KeyCode !== Enum.KeyCode.None && hasComposite) {
		return "KeyCode and composite directions are both set (IAS ignores the composites)";
	}
	return undefined;
}

/** A saved property decoded from JSON */
export type SavedValue = Enum.KeyCode | number | Vector2 | Vector3;

/** Resolves a saved key name. `"Unknown"` resolves to `None`; an unknown name to undefined */
export function KeyFromName(name: string): Enum.KeyCode | undefined {
	const [ok, key] = pcall(() => Enum.KeyCode.FromName(name));
	return ok ? key : undefined;
}

function DecodeNumbers(value: unknown, count: number): number[] | undefined {
	if (!typeIs(value, "table")) return undefined;
	const list = value as unknown[];
	if (list.size() !== count) return undefined;
	const numbers = new Array<number>();
	for (let index = 0; index < count; index++) {
		const item = list[index];
		if (!IsFiniteNumber(item)) return undefined;
		numbers.push(item);
	}
	return numbers;
}

/**
 * Decodes one saved entry (`{ "KeyCode": "F", "Scale": 2 }`) for a binding on an action of this
 * type. Returns the decoded properties, or the reason (a string) the entry must be skipped.
 * @param defaultKeyCode the binding's default KeyCode, which an entry without one keeps: the
 * import starts from the defaults. Undefined when it is unknown: `SanitizeBindings` has the schema
 * alone, and a binding the client's folder or template holds wins over the schema's (a Manager's
 * stick on a device the schema leaves out, hunt HD3-1). A ResponseCurve the entry doesn't settle
 * itself is then kept on a device with thumbsticks, and left to the import
 * @param device the binding's device: its keys must be that device's
 */
export function DecodeSavedEntry(
	actionType: ActionTypeName,
	entry: unknown,
	defaultKeyCode?: Enum.KeyCode,
	device?: Device,
): Map<SavedProperty, SavedValue> | string {
	if (!typeIs(entry, "table")) return "the entry is not an object";
	const decoded = new Map<SavedProperty, SavedValue>();
	let hasKeyCode = false;
	let hasComposite = false;
	for (const [name, value] of pairs(entry as Record<string, unknown>)) {
		if (
			!typeIs(name, "string") ||
			!(SAVED_PROPERTIES as readonly string[]).includes(name) ||
			!IsPropertyOf(actionType, name)
		) {
			return `unknown property ${tostring(name)}`;
		}
		const property = name as SavedProperty;
		if (IsSlotOf(actionType, property)) {
			if (!typeIs(value, "string")) return `${property} must be a key name`;
			const key = KeyFromName(value);
			if (key === undefined) return `unknown key name ${value}`;
			if (key !== Enum.KeyCode.None) {
				if (!IsKeyAllowed(actionType, property, key)) {
					return `${key.Name} is not allowed in ${property}`;
				}
				const problem = DeviceProblem(key, device);
				if (problem !== undefined) return problem;
				if (property === "KeyCode") hasKeyCode = true;
				else if (IsCompositeSlot(property)) hasComposite = true;
			}
			decoded.set(property, key);
		} else if (property === "Vector2Scale" || property === "Vector3Scale") {
			const count = property === "Vector2Scale" ? 2 : 3;
			const numbers = DecodeNumbers(value, count);
			if (numbers === undefined) return `${property} must be ${count} finite numbers`;
			decoded.set(
				property,
				count === 2
					? new Vector2(numbers[0], numbers[1])
					: new Vector3(numbers[0], numbers[1], numbers[2]),
			);
		} else {
			if (!IsFiniteNumber(value)) return `${property} is not a finite number`;
			decoded.set(property, value);
		}
	}
	if (hasKeyCode && hasComposite) return "KeyCode and composite directions can't share a binding";
	if (decoded.has("ResponseCurve")) {
		// The KeyCode the binding ends up with: the entry's, else none after a composite direction,
		// else the default one
		const keyCode =
			(decoded.get("KeyCode") as Enum.KeyCode | undefined) ??
			(hasComposite ? Enum.KeyCode.None : defaultKeyCode);
		// Unknown: only a device without thumbsticks rules it out
		const problem =
			keyCode !== undefined
				? ResponseCurveProblem(keyCode)
				: device !== undefined && GetKeyDevice(Enum.KeyCode.Thumbstick1) !== device
					? `${RESPONSE_CURVE_PROBLEM}, which a ${device} binding can't hold`
					: undefined;
		if (problem !== undefined) return problem;
	}
	return decoded;
}
