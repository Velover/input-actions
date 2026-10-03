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
import { NEUTRAL_VALUES, ReleaseOnServer } from "./Internal";
import { EKeyGroup, GetKeyGroup, IsKeyCode } from "./KeyGroups";
import { ClearHeldValue, GetHeldValue, IHeldValue } from "./Registry";

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

/** Every property in `IBindingValues`, keys first */
const BINDING_PROPERTIES: readonly (keyof IBindingValues)[] = [
	...SAVED_PROPERTIES,
	"ClampMagnitudeToOne",
	"DisplayName",
	"DisplayImage",
];

function SameProperty(name: keyof IBindingValues, a: unknown, b: unknown): boolean {
	return name === "DisplayImage" ? (a as Content).Uri === (b as Content).Uri : a === b;
}

/**
 * What a write does with `ReleasedThreshold`. IAS reads it as at most `PressedThreshold` and keeps
 * the value written (probed): a binding can store a value it doesn't show, and a target read back
 * from a binding holds only the reading.
 */
export const enum EReleasedThreshold {
	/**
	 * The target is a reading (`Reset`, imports, `Destroy`): written when the binding, its
	 * `PressedThreshold` written first, would read otherwise. A stored value stays only when the
	 * binding reads the target with it.
	 */
	Read,
	/**
	 * The write doesn't name it (`Set({ PressedThreshold })`, `Clear`, `Capture`): not written. The
	 * stored value comes back into view when `PressedThreshold` is raised, instead of the clamped
	 * reading the target was made from being written over it.
	 */
	Keep,
	/** The write names it (`Set({ ReleasedThreshold })`): written, so the binding stores the target */
	Store,
}

/** What writing a binding spec (`Set`, a schema binding) does with `ReleasedThreshold` */
export function SpecReleasedThreshold(spec: unknown): EReleasedThreshold {
	const named =
		!IsKeyCode(spec) && (spec as { ReleasedThreshold?: unknown }).ReleasedThreshold !== undefined;
	return named ? EReleasedThreshold.Store : EReleasedThreshold.Keep;
}

/**
 * Writes the values that differ from what the binding reads at that point, keys first, and
 * `ReleasedThreshold` as `releasedThreshold` says. Writing a property the value it already has
 * changes nothing in IAS, but a key written away and back in one frame releases a held action
 * (probed), so nothing is written for nothing.
 * @returns whether a key slot (KeyCode, a composite direction, a modifier) changed
 */
export function WriteBinding(
	binding: InputBinding,
	values: IBindingValues,
	releasedThreshold = EReleasedThreshold.Read,
): boolean {
	const instance = binding as unknown as Record<string, unknown>;
	let keysChanged = false;
	for (const name of BINDING_PROPERTIES) {
		const value = values[name];
		if (name === "ReleasedThreshold" && releasedThreshold !== EReleasedThreshold.Read) {
			if (releasedThreshold === EReleasedThreshold.Store) instance[name] = value;
			continue;
		}
		if (SameProperty(name, value, instance[name])) continue;
		instance[name] = value;
		if ((KEY_SLOTS as readonly string[]).includes(name)) keysChanged = true;
	}
	return keysChanged;
}

/** A change to one binding: the values it is to have, and what is done with `ReleasedThreshold` */
export type BindingWrite = [
	binding: InputBinding,
	values: IBindingValues,
	releasedThreshold?: EReleasedThreshold,
];

/** The binding `WriteBindings` makes for a moment, to release an action on the server */
const REBIND_RELEASE_NAME = "InputActionsRebindRelease";
/** The binding `AddingBindings` makes for a moment, to release an action on the server */
const ADD_RELEASE_NAME = "InputActionsAddRelease";

/**
 * The value an action holds before its bindings change: its state, or, while that rests, the latest
 * value the package fired on it (a Server Authority copy shows a Fire one simulation step later)
 */
function HeldState(action: InputAction): unknown {
	const state = action.GetState();
	if (state !== NEUTRAL_VALUES[action.Type.Name]) return state;
	let latest: IHeldValue | undefined;
	for (const child of action.GetChildren()) {
		const held = child.IsA("InputBinding") ? GetHeldValue(child) : undefined;
		if (held !== undefined && (latest === undefined || held.Order > latest.Order)) latest = held;
	}
	return latest !== undefined ? latest.Value : state;
}

/**
 * Writes binding changes (`Set`, `Reset`, `Clear`, `Capture`, imports), each only where it differs
 * from the instance. A change to any binding's keys makes IAS reset every binding of its action
 * (probed). On a local context the action is released at once, and keys still down count again
 * once pressed again. On a context under the player in a place that runs Server Authority the
 * client's state is pressed again instead, and stays held on the client and the server until the
 * new keys are pressed and released. So an action whose keys changed while it was not at rest is
 * released after the writes, as IAS releases a local one: the package forgets the values it held on
 * it, and on such a copy a same-frame pair, the value it held then the value at rest, is the last
 * write on both sides (a release before the writes would be undone by them). Without Server
 * Authority the copy under the player is local, and IAS has released it already: no pair, which
 * would press and release it once more (`ReleaseOnServer`). States are read before any write, so
 * bindings of one action changed together release it once.
 * @returns the bindings whose values changed
 */
export function WriteBindings(writes: readonly BindingWrite[]): Set<InputBinding> {
	const states = new Map<InputAction, unknown>();
	for (const [binding, values] of writes) {
		const action = binding.Parent;
		if (action === undefined || !action.IsA("InputAction") || states.has(action)) continue;
		if (KEY_SLOTS.some((slot) => binding[slot] !== values[slot]))
			states.set(action, HeldState(action));
	}
	const changed = new Set<InputBinding>();
	const rebound = new Set<InputAction>();
	for (const [binding, values, releasedThreshold] of writes) {
		const before = ReadBinding(binding);
		const keysChanged = WriteBinding(binding, values, releasedThreshold);
		if (!SameValues(before, ReadBinding(binding))) changed.add(binding);
		const action = binding.Parent;
		if (keysChanged && action !== undefined && action.IsA("InputAction")) rebound.add(action);
	}
	for (const action of rebound) {
		const state = states.get(action);
		if (state !== undefined) ReleaseAfterReset(action, state, REBIND_RELEASE_NAME);
	}
	return changed;
}

/**
 * Lets go of an action IAS reset while it was not at rest (`state`, read before the change): the
 * package forgets the values it held on it, which IAS reset too, and on a copy under the player in a
 * place that runs Server Authority it fires the pair of `ReleaseOnServer`, through a binding named
 * `name` made for it
 */
function ReleaseAfterReset(action: InputAction, state: unknown, name: string) {
	if (state === NEUTRAL_VALUES[action.Type.Name]) return;
	for (const child of action.GetChildren()) {
		if (child.IsA("InputBinding")) ClearHeldValue(child);
	}
	ReleaseOnServer(action, name, state);
}

/**
 * Runs `add`, which may add bindings to `action`: `AttachButton`, a `Create` that adds a slot or a
 * template's binding the action lacks, the swap moving a stand-in's bindings onto the copy. A binding
 * added to an action makes IAS reset the action's bindings, as a change to their keys does (hunts
 * HL4-4, HL4-5): on a local context the action is released at once, and a key still down holds it
 * again only once pressed again; on a copy under the player in a place that runs Server Authority
 * the client's state is pressed again and stays held, on the client and the server. So an action
 * that was not at rest when `add` gave it a binding is let go of after it, as after a key change
 * (`WriteBindings`), once for all the bindings `add` gave it.
 */
export function AddingBindings<T>(action: InputAction, add: () => T): T {
	const state = HeldState(action);
	if (state === NEUTRAL_VALUES[action.Type.Name]) return add();
	const before = new Set(action.GetChildren());
	const result = add();
	for (const child of action.GetChildren()) {
		if (child.IsA("InputBinding") && !before.has(child)) {
			ReleaseAfterReset(action, state, ADD_RELEASE_NAME);
			break;
		}
	}
	return result;
}

/** Unbinds: the KeyCode and every composite direction become `None`, and the modifiers when asked */
export function ClearKeys(values: IBindingValues, modifiers = false) {
	values.KeyCode = Enum.KeyCode.None;
	for (const slot of COMPOSITE_SLOTS) values[slot] = Enum.KeyCode.None;
	if (modifiers) {
		for (const slot of MODIFIER_SLOTS) values[slot] = Enum.KeyCode.None;
	}
}

/**
 * Writes one key slot, keeping one input source per binding: a KeyCode clears the composite
 * directions, and a composite direction clears the KeyCode.
 */
export function WriteKey(values: IBindingValues, slot: string, key: Enum.KeyCode) {
	if (slot === "KeyCode") {
		if (key !== Enum.KeyCode.None) ClearKeys(values);
		values.KeyCode = key;
	} else if (IsCompositeSlot(slot)) {
		if (key !== Enum.KeyCode.None) values.KeyCode = Enum.KeyCode.None;
		values[slot] = key;
	} else if (slot === "PrimaryModifier" || slot === "SecondaryModifier") {
		values[slot] = key;
	}
}

/**
 * Applies a validated binding spec. A bare key sets KeyCode and clears the composites; an object
 * merges into the binding (a KeyCode in it clears the composites, a composite clears the KeyCode).
 */
export function ApplySpec(values: IBindingValues, spec: unknown) {
	if (IsKeyCode(spec)) {
		WriteKey(values, "KeyCode", spec);
		return;
	}
	const record = spec as Record<string, unknown>;
	if (IsKeyCode(record.KeyCode)) WriteKey(values, "KeyCode", record.KeyCode);
	for (const slot of KEY_SLOTS) {
		if (slot === "KeyCode") continue;
		const key = record[slot];
		if (IsKeyCode(key)) WriteKey(values, slot, key);
	}
	for (const [name, value] of pairs(record)) {
		if ((KEY_SLOTS as readonly string[]).includes(name as string)) continue;
		if (name === "DisplayImage") values.DisplayImage = Content.fromUri(value as string);
		else (values as unknown as Record<string, unknown>)[name as string] = value;
	}
}

/** Applies decoded saved properties (import), with the same one-source rule as `ApplySpec` */
export function ApplySaved(values: IBindingValues, saved: Map<SavedProperty, SavedValue>) {
	const keyCode = saved.get("KeyCode");
	if (keyCode !== undefined) WriteKey(values, "KeyCode", keyCode as Enum.KeyCode);
	for (const [name, value] of saved) {
		if (name === "KeyCode") continue;
		if ((KEY_SLOTS as readonly string[]).includes(name))
			WriteKey(values, name, value as Enum.KeyCode);
		else (values as unknown as Record<string, unknown>)[name] = value;
	}
}

/**
 * Applies onto `target` what `current` changed from `defaults`, as an import of those changes would
 * (one input source per binding), and leaves the rest of `target` as it is: its stored
 * `ReleasedThreshold` too, unless that changed. A Server Authority swap carries a stand-in's rebinds
 * this way onto the binding another root handle made on the copy.
 * @returns the write that does it
 */
export function CarryChanges(
	current: IBindingValues,
	defaults: IBindingValues,
	target: InputBinding,
): BindingWrite {
	const values = ReadBinding(target);
	const saved = new Map<SavedProperty, SavedValue>();
	for (const name of SAVED_PROPERTIES) {
		if (current[name] !== defaults[name]) saved.set(name, current[name]);
	}
	ApplySaved(values, saved);
	if (current.ClampMagnitudeToOne !== defaults.ClampMagnitudeToOne)
		values.ClampMagnitudeToOne = current.ClampMagnitudeToOne;
	if (current.DisplayName !== defaults.DisplayName) values.DisplayName = current.DisplayName;
	if (current.DisplayImage.Uri !== defaults.DisplayImage.Uri)
		values.DisplayImage = current.DisplayImage;
	const releasedThreshold = saved.has("ReleasedThreshold")
		? EReleasedThreshold.Read
		: EReleasedThreshold.Keep;
	return [target, values, releasedThreshold];
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
