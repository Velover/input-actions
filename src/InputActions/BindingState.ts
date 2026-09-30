import {
	ActionTypeName,
	COMPOSITE_SLOTS,
	IsCompositeSlot,
	IsFiniteNumber,
	IsSlotOf,
	KEY_SLOTS,
	MODIFIER_SLOTS,
	SAVED_PROPERTIES,
	SavedProperty,
	SavedValue,
} from "./BindingRules";
import { EKeyGroup, GetKeyGroup, IsKeyCode } from "./KeyGroups";

/** Everything `Set` can change on a binding, and so everything `Reset` restores */
export interface IBindingValues {
	KeyCode: Enum.KeyCode;
	Up: Enum.KeyCode;
	Down: Enum.KeyCode;
	Left: Enum.KeyCode;
	Right: Enum.KeyCode;
	Forward: Enum.KeyCode;
	Backward: Enum.KeyCode;
	PrimaryModifier: Enum.KeyCode;
	SecondaryModifier: Enum.KeyCode;
	Scale: number;
	Vector2Scale: Vector2;
	Vector3Scale: Vector3;
	ResponseCurve: number;
	PressedThreshold: number;
	ReleasedThreshold: number;
	ClampMagnitudeToOne: boolean;
	DisplayName: string;
	DisplayImage: Content;
}

export function ReadBinding(binding: InputBinding): IBindingValues {
	return {
		KeyCode: binding.KeyCode,
		Up: binding.Up,
		Down: binding.Down,
		Left: binding.Left,
		Right: binding.Right,
		Forward: binding.Forward,
		Backward: binding.Backward,
		PrimaryModifier: binding.PrimaryModifier,
		SecondaryModifier: binding.SecondaryModifier,
		Scale: binding.Scale,
		Vector2Scale: binding.Vector2Scale,
		Vector3Scale: binding.Vector3Scale,
		ResponseCurve: binding.ResponseCurve,
		PressedThreshold: binding.PressedThreshold,
		ReleasedThreshold: binding.ReleasedThreshold,
		ClampMagnitudeToOne: binding.ClampMagnitudeToOne,
		DisplayName: binding.DisplayName,
		DisplayImage: binding.DisplayImage,
	};
}

export function WriteBinding(binding: InputBinding, values: Partial<IBindingValues>) {
	for (const [name, value] of pairs(values)) {
		(binding as unknown as Record<string, unknown>)[name] = value;
	}
}

/** Whether the saved properties of two binding states are equal */
export function SameSavedValues(a: IBindingValues, b: IBindingValues): boolean {
	for (const name of SAVED_PROPERTIES) {
		if (a[name] !== b[name]) return false;
	}
	return true;
}

/** Whether every value `Reset` restores is equal */
export function SameValues(a: IBindingValues, b: IBindingValues): boolean {
	if (!SameSavedValues(a, b)) return false;
	return (
		a.ClampMagnitudeToOne === b.ClampMagnitudeToOne &&
		a.DisplayName === b.DisplayName &&
		a.DisplayImage.Uri === b.DisplayImage.Uri
	);
}

/** Unbinds: the KeyCode and every composite direction become `None`, and the modifiers when asked */
export function ClearKeys(binding: InputBinding, modifiers = false) {
	binding.KeyCode = Enum.KeyCode.None;
	for (const slot of COMPOSITE_SLOTS) binding[slot] = Enum.KeyCode.None;
	if (modifiers) {
		for (const slot of MODIFIER_SLOTS) binding[slot] = Enum.KeyCode.None;
	}
}

/**
 * Writes one key slot, keeping one input source per binding: a KeyCode clears the composite
 * directions, and a composite direction clears the KeyCode.
 */
export function WriteKey(binding: InputBinding, slot: string, key: Enum.KeyCode) {
	if (slot === "KeyCode") {
		if (key !== Enum.KeyCode.None) ClearKeys(binding);
		binding.KeyCode = key;
	} else if (IsCompositeSlot(slot)) {
		if (key !== Enum.KeyCode.None) binding.KeyCode = Enum.KeyCode.None;
		binding[slot] = key;
	} else if (slot === "PrimaryModifier" || slot === "SecondaryModifier") {
		binding[slot] = key;
	}
}

/**
 * Applies a validated binding spec. A bare key sets KeyCode and clears the composites; an object
 * merges into the binding (a KeyCode in it clears the composites, a composite clears the KeyCode).
 */
export function ApplySpec(binding: InputBinding, spec: unknown) {
	if (IsKeyCode(spec)) {
		WriteKey(binding, "KeyCode", spec);
		return;
	}
	const record = spec as Record<string, unknown>;
	if (IsKeyCode(record.KeyCode)) WriteKey(binding, "KeyCode", record.KeyCode);
	for (const slot of KEY_SLOTS) {
		if (slot === "KeyCode") continue;
		const key = record[slot];
		if (IsKeyCode(key)) WriteKey(binding, slot, key);
	}
	for (const [name, value] of pairs(record)) {
		if ((KEY_SLOTS as readonly string[]).includes(name as string)) continue;
		if (name === "DisplayImage") binding.DisplayImage = Content.fromUri(value as string);
		else (binding as unknown as Record<string, unknown>)[name as string] = value;
	}
}

/** Applies decoded saved properties (import), with the same one-source rule as `ApplySpec` */
export function ApplySaved(binding: InputBinding, values: Map<SavedProperty, SavedValue>) {
	const keyCode = values.get("KeyCode");
	if (keyCode !== undefined) WriteKey(binding, "KeyCode", keyCode as Enum.KeyCode);
	for (const [name, value] of values) {
		if (name === "KeyCode") continue;
		if ((KEY_SLOTS as readonly string[]).includes(name))
			WriteKey(binding, name, value as Enum.KeyCode);
		else (binding as unknown as Record<string, unknown>)[name] = value;
	}
}

const DEFAULT_SCALE = 1;
const DEFAULT_RESPONSE_CURVE = 1;
const DEFAULT_PRESSED_THRESHOLD = 0.5;
const DEFAULT_RELEASED_THRESHOLD = 0.2;

/** Rounds a value read back from a float property to what was written (7 significant digits) */
export function RoundFloat(value: number): number {
	return tonumber(string.format("%.7g", value)) ?? value;
}

/** The current binding as plain data in the schema's shape (see `IBindingHandle.Get`) */
export function GetBindingData(
	actionType: ActionTypeName,
	binding: InputBinding,
): Record<string, unknown> {
	const data: Record<string, unknown> = {};
	for (const slot of KEY_SLOTS) {
		const key = binding[slot];
		if (key !== Enum.KeyCode.None && IsSlotOf(actionType, slot)) data[slot] = key;
	}
	if (binding.DisplayName !== "") data.DisplayName = binding.DisplayName;
	const image = binding.DisplayImage.Uri;
	if (image !== undefined && image !== "") data.DisplayImage = image;

	const keyCode = binding.KeyCode;
	switch (actionType) {
		case "Bool":
			if (math.abs(binding.PressedThreshold - DEFAULT_PRESSED_THRESHOLD) > 1e-6) {
				data.PressedThreshold = RoundFloat(binding.PressedThreshold);
			}
			if (math.abs(binding.ReleasedThreshold - DEFAULT_RELEASED_THRESHOLD) > 1e-6) {
				data.ReleasedThreshold = RoundFloat(binding.ReleasedThreshold);
			}
			break;
		case "Direction1D":
		case "Direction2D":
		case "Direction3D":
			if (binding.Scale !== DEFAULT_SCALE) data.Scale = RoundFloat(binding.Scale);
			if (!binding.ClampMagnitudeToOne) data.ClampMagnitudeToOne = false;
			if (actionType === "Direction2D") {
				if (binding.Vector2Scale !== Vector2.one) data.Vector2Scale = binding.Vector2Scale;
				if (
					GetKeyGroup(keyCode) === EKeyGroup.Stick &&
					binding.ResponseCurve !== DEFAULT_RESPONSE_CURVE
				) {
					data.ResponseCurve = RoundFloat(binding.ResponseCurve);
				}
			} else if (actionType === "Direction3D" && binding.Vector3Scale !== Vector3.one) {
				data.Vector3Scale = binding.Vector3Scale;
			}
			break;
	}
	return data;
}

/** Whether an import can write the value back: numbers finite (inf is only written to the instance directly) */
export function IsSavableValue(value: IBindingValues[SavedProperty]): boolean {
	if (typeIs(value, "EnumItem")) return true;
	if (typeIs(value, "Vector2")) return IsFiniteNumber(value.X) && IsFiniteNumber(value.Y);
	if (typeIs(value, "Vector3"))
		return IsFiniteNumber(value.X) && IsFiniteNumber(value.Y) && IsFiniteNumber(value.Z);
	return IsFiniteNumber(value);
}

/** A saved property as JSON: enums by name, vectors as arrays, floats rounded */
export function EncodeSavedValue(value: IBindingValues[SavedProperty]): unknown {
	if (typeIs(value, "EnumItem")) return value.Name;
	if (typeIs(value, "Vector2")) return [RoundFloat(value.X), RoundFloat(value.Y)];
	if (typeIs(value, "Vector3"))
		return [RoundFloat(value.X), RoundFloat(value.Y), RoundFloat(value.Z)];
	return RoundFloat(value);
}
