import { EKeyGroup, GetKeyGroup, IsKeyCode } from "./KeyGroups";
import type { BindingSlot } from "./Types";

// The per-action-type binding rules of design spec §3, checked at runtime: schema bindings, Set,
// Capture, ImportBindings, SanitizeBindings and adopted bindings all go through here.

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

/** Whether `key` may go in `slot` of a binding on this action type. `None` is never allowed here */
export function IsKeyAllowed(actionType: ActionTypeName, slot: string, key: Enum.KeyCode): boolean {
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

function KeyProblem(actionType: ActionTypeName, slot: string, value: unknown): string | undefined {
	if (!IsKeyCode(value)) return `${slot} must be an Enum.KeyCode`;
	if (!IsKeyAllowed(actionType, slot, value))
		return `${value.Name} is not allowed in ${slot} on a ${actionType} action`;
	return undefined;
}

/**
 * Checks a binding written by the user (a bare key or an object shape, as in the schema or `Set`).
 * Returns the problem, or undefined when the binding is valid.
 */
export function CheckBindingSpec(actionType: ActionTypeName, spec: unknown): string | undefined {
	if (IsKeyCode(spec)) return KeyProblem(actionType, "KeyCode", spec);
	if (!typeIs(spec, "table"))
		return `a binding must be an Enum.KeyCode, an object or InputActions.Scriptable`;

	let hasKeyCode = false;
	let hasComposite = false;
	for (const [name, value] of pairs(spec as Record<string, unknown>)) {
		if (!typeIs(name, "string") || !IsPropertyOf(actionType, name)) {
			return `${tostring(name)} is not a property of a ${actionType} binding`;
		}
		if (IsSlotOf(actionType, name)) {
			const problem = KeyProblem(actionType, name, value);
			if (problem !== undefined) return problem;
			if (name === "KeyCode") hasKeyCode = true;
			else if (IsCompositeSlot(name)) hasComposite = true;
			continue;
		}
		const problem = CheckPropertyValue(name, value);
		if (problem !== undefined) return problem;
	}
	if (hasKeyCode && hasComposite) return "KeyCode and composite directions can't share a binding";
	const responseCurve = (spec as { ResponseCurve?: unknown }).ResponseCurve;
	const keyCode = (spec as { KeyCode?: unknown }).KeyCode;
	if (
		responseCurve !== undefined &&
		!(IsKeyCode(keyCode) && GetKeyGroup(keyCode) === EKeyGroup.Stick)
	) {
		return "ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode";
	}
	return undefined;
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
 */
export function CheckBindingKeys(
	actionType: ActionTypeName,
	binding: InputBinding,
): string | undefined {
	if (binding.Type === Enum.InputBindingType.Scriptable) return undefined;
	let hasComposite = false;
	for (const slot of KEY_SLOTS) {
		const key = binding[slot];
		if (key === Enum.KeyCode.None) continue;
		if (!IsSlotOf(actionType, slot))
			return `${slot} = ${key.Name} is not used by a ${actionType} action`;
		if (!IsKeyAllowed(actionType, slot, key))
			return `${key.Name} is not allowed in ${slot} on a ${actionType} action`;
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
 * import starts from the defaults
 */
export function DecodeSavedEntry(
	actionType: ActionTypeName,
	entry: unknown,
	defaultKeyCode: Enum.KeyCode = Enum.KeyCode.None,
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
		// The KeyCode the binding ends up with: a composite direction clears it
		const keyCode = (decoded.get("KeyCode") as Enum.KeyCode | undefined) ??
			(hasComposite ? Enum.KeyCode.None : defaultKeyCode);
		if (GetKeyGroup(keyCode) !== EKeyGroup.Stick)
			return "ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode";
	}
	return decoded;
}
