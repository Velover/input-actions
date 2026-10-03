import { IsSlotOf, MODIFIER_SLOTS } from "./BindingRules";
import { BindingHandle } from "./Handles/BindingHandle";
import type { IBindingConflict, IConflictPair } from "./Types";

// Conflicts for a rebinding menu (design spec §6, F3): the bindings of one device that share a key.
// IAS presses every binding a key holds, a chord included: Ctrl then S presses Ctrl+S and plain S
// both (a chord doesn't block its plain key), and Ctrl alone presses a binding on Ctrl.

const K = Enum.KeyCode;
/** The composite directions, in the order `Describe` reads them */
const DIRECTIONS = ["Up", "Left", "Down", "Right", "Forward", "Backward"] as const;

/** What presses a binding */
interface IPressKeys {
	/** The keys that press it: its `KeyCode`, else its composite directions (IAS ignores those beside a `KeyCode`) */
	readonly Keys: Enum.KeyCode[];
	/** Its modifiers, held before the key */
	readonly Modifiers: Enum.KeyCode[];
	readonly Primary: Enum.KeyCode;
	readonly Secondary: Enum.KeyCode;
}

/** A binding's keys, in the slots its action type uses */
function PressKeysOf(handle: BindingHandle): IPressKeys {
	const binding = handle.Instance;
	const actionType = handle.ActionType;
	const keys = new Array<Enum.KeyCode>();
	if (binding.KeyCode !== K.None && IsSlotOf(actionType, "KeyCode")) keys.push(binding.KeyCode);
	else {
		for (const slot of DIRECTIONS) {
			const key = binding[slot];
			if (key !== K.None && IsSlotOf(actionType, slot) && !keys.includes(key)) keys.push(key);
		}
	}
	const modifier = (slot: (typeof MODIFIER_SLOTS)[number]) =>
		IsSlotOf(actionType, slot) ? binding[slot] : K.None;
	const primary = modifier("PrimaryModifier");
	const secondary = modifier("SecondaryModifier");
	const modifiers = [primary, secondary].filter((key) => key !== K.None);
	return { Keys: keys, Modifiers: modifiers, Primary: primary, Secondary: secondary };
}

/** What two bindings share, from the first's side */
interface IShared {
	readonly Keys: Enum.KeyCode[];
	readonly Identical: boolean;
}

/**
 * The keys two bindings share, in the first's order: a key that presses both, and a key that presses
 * one and is the other's modifier (pressing the chord presses the plain binding on its modifier).
 * Two chords that only share a modifier (Ctrl+S, Ctrl+D) share nothing: neither presses the other.
 * `Identical` when a key presses both with the same modifiers: each press of it presses both. A
 * binding without a key (unbound, or modifiers alone) shares nothing
 */
function SharedKeys(a: IPressKeys, b: IPressKeys): IShared | undefined {
	if (a.Keys.isEmpty() || b.Keys.isEmpty()) return undefined;
	const keys = new Array<Enum.KeyCode>();
	let pressesBoth = false;
	for (const key of a.Keys) {
		if (b.Keys.includes(key)) pressesBoth = true;
		else if (!b.Modifiers.includes(key)) continue;
		keys.push(key);
	}
	for (const key of a.Modifiers) {
		if (b.Keys.includes(key) && !keys.includes(key)) keys.push(key);
	}
	if (keys.isEmpty()) return undefined;
	return {
		Keys: keys,
		Identical: pressesBoth && a.Primary === b.Primary && a.Secondary === b.Secondary,
	};
}

/**
 * The binding handle `FindConflicts` was given, or why it can't take it
 * @param context the context handle's name; undefined on the root handle
 * @param level the caller's level for `error`
 */
export function ConflictSubject(
	binding: unknown,
	context: string | undefined,
	level: number,
): BindingHandle {
	if (binding instanceof BindingHandle) return binding;
	error(
		`InputActions: ${context !== undefined ? `${context}: ` : ""}FindConflicts takes a device's binding ` +
			"handle (Bindings.KeyboardAndMouse, Bindings.Gamepad, Bindings.Touch, or one of their extras)",
		level,
	);
}

/**
 * The other bindings of `binding`'s device among `handles` that share a key with it (see
 * `SharedKeys`), by path. Not `binding` itself, nor a handle on the same instance (another root
 * handle's)
 */
export function FindConflicts(
	handles: readonly BindingHandle[],
	binding: BindingHandle,
): IBindingConflict[] {
	const own = PressKeysOf(binding);
	const found = new Array<IBindingConflict>();
	for (const other of handles) {
		if (other.Instance === binding.Instance || other.Name !== binding.Name) continue;
		const shared = SharedKeys(own, PressKeysOf(other));
		if (shared === undefined) continue;
		found.push({
			Binding: other as never,
			Path: other.Path,
			Key: shared.Keys[0],
			Keys: shared.Keys,
			Identical: shared.Identical,
		});
	}
	found.sort((a, b) => a.Path < b.Path);
	return found;
}

/** Every pair of `handles` of one device that share a key, each once, by their paths */
export function FindAllConflicts(handles: readonly BindingHandle[]): IConflictPair[] {
	const sorted = [...handles];
	sorted.sort((a, b) => a.Path < b.Path);
	const keys = sorted.map(PressKeysOf);
	const found = new Array<IConflictPair>();
	for (let first = 0; first < sorted.size(); first++) {
		for (let second = first + 1; second < sorted.size(); second++) {
			const a = sorted[first];
			const b = sorted[second];
			if (a.Instance === b.Instance || a.Name !== b.Name) continue;
			const shared = SharedKeys(keys[first], keys[second]);
			if (shared === undefined) continue;
			found.push({
				Bindings: [a as never, b as never],
				Paths: [a.Path, b.Path],
				Key: shared.Keys[0],
				Keys: shared.Keys,
				Identical: shared.Identical,
			});
		}
	}
	return found;
}
