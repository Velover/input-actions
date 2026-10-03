import { IsSlotOf, MODIFIER_SLOTS } from "./BindingRules";
import { BindingHandle } from "./Handles/BindingHandle";
import type { BindingSlot, IBindingConflict, IConflictPair } from "./Types";

// Conflicts for a rebinding menu (design spec §6, F3): the bindings of one device that share a key.
// IAS presses every binding a key holds, a chord included: Ctrl then S presses Ctrl+S and plain S
// both (a chord doesn't block its plain key), and Ctrl alone presses a binding on Ctrl. A stick
// pushed one way presses a binding on that direction and moves one on the whole stick, and a drag or
// a pinch holds fingers on the screen, which press a binding on `TouchPosition`.

const K = Enum.KeyCode;
/** The composite directions, in the order `Describe` reads them */
const DIRECTIONS = ["Up", "Left", "Down", "Right", "Forward", "Backward"] as const;

/**
 * Keys that one push or touch presses together with a wider key: a stick's direction with the
 * whole stick, a drag or a pinch with the fingers on the screen (`TouchPosition`, held for each).
 * The narrower key (the direction, the drag, the pinch) is the key they share (hunt HF-2), and a
 * conflict tells that the other binding holds the wider one (`Wider`, hunt HF4-1)
 */
const PART_OF = new Map<Enum.KeyCode, Enum.KeyCode>([
	[K.Thumbstick1Up, K.Thumbstick1],
	[K.Thumbstick1Down, K.Thumbstick1],
	[K.Thumbstick1Left, K.Thumbstick1],
	[K.Thumbstick1Right, K.Thumbstick1],
	[K.Thumbstick2Up, K.Thumbstick2],
	[K.Thumbstick2Down, K.Thumbstick2],
	[K.Thumbstick2Left, K.Thumbstick2],
	[K.Thumbstick2Right, K.Thumbstick2],
	[K.TouchDelta, K.TouchPosition],
	[K.TouchPinch, K.TouchPosition],
]);

/**
 * The key that presses both `a` and `b`, if one does: the key itself, or the narrower of a key and
 * the wider one it presses with (`PART_OF`)
 */
function SharedKey(a: Enum.KeyCode, b: Enum.KeyCode): Enum.KeyCode | undefined {
	if (a === b) return a;
	if (PART_OF.get(a) === b) return a;
	if (PART_OF.get(b) === a) return b;
	return undefined;
}

/** A key in one of a binding's slots */
interface IKeyInSlot {
	readonly Key: Enum.KeyCode;
	readonly Slot: BindingSlot;
}

/** What presses a binding */
interface IPressKeys {
	/** The keys that press it: its `KeyCode`, else its composite directions (IAS ignores those beside a `KeyCode`) */
	readonly Keys: IKeyInSlot[];
	/** Its modifiers, held before the key */
	readonly Modifiers: IKeyInSlot[];
	readonly Primary: Enum.KeyCode;
	readonly Secondary: Enum.KeyCode;
}

/** A binding's keys, in the slots its action type uses */
function PressKeysOf(handle: BindingHandle): IPressKeys {
	const binding = handle.Instance;
	const actionType = handle.ActionType;
	const keys = new Array<IKeyInSlot>();
	if (binding.KeyCode !== K.None && IsSlotOf(actionType, "KeyCode"))
		keys.push({ Key: binding.KeyCode, Slot: "KeyCode" });
	else {
		for (const slot of DIRECTIONS) {
			const key = binding[slot];
			if (key !== K.None && IsSlotOf(actionType, slot)) keys.push({ Key: key, Slot: slot });
		}
	}
	const modifiers = new Array<IKeyInSlot>();
	const modifier = (slot: (typeof MODIFIER_SLOTS)[number]) => {
		const key = IsSlotOf(actionType, slot) ? binding[slot] : K.None;
		if (key !== K.None) modifiers.push({ Key: key, Slot: slot });
		return key;
	};
	const primary = modifier("PrimaryModifier");
	const secondary = modifier("SecondaryModifier");
	return { Keys: keys, Modifiers: modifiers, Primary: primary, Secondary: secondary };
}

/** What two bindings share */
interface IShared {
	/** The keys they share, in the first's order */
	readonly Keys: Enum.KeyCode[];
	/** The first binding's slots that hold a shared key, in its order */
	readonly SlotsA: BindingSlot[];
	/** The second binding's slots that hold a shared key: those holding `Keys[0]` first */
	readonly SlotsB: BindingSlot[];
	readonly Identical: boolean;
	/** One of the first binding's slots holds a wider key that a shared key is part of (`PART_OF`) */
	readonly WiderA: boolean;
	/** One of the second binding's slots does */
	readonly WiderB: boolean;
}

/**
 * The keys two bindings share, in the first's order, with the slots that hold them on each side: a
 * key that presses both (the same key, or a stick's direction and the stick, a drag or a pinch and
 * `TouchPosition`: see `SharedKey`), and a key that presses one and is the other's modifier
 * (pressing the chord presses the plain binding on its modifier). Two chords that only share a
 * modifier (Ctrl+S, Ctrl+D) share nothing: neither presses the other. `Identical` when one key is in
 * both with the same modifiers: each press of it presses both. `WiderA`, `WiderB` when that side
 * holds the wider key of a pair that presses together, all of which clearing its slot frees (the
 * whole stick, not only the direction the other holds: hunt HF4-1). A binding without a key
 * (unbound, or modifiers alone) shares nothing
 */
function SharedKeys(a: IPressKeys, b: IPressKeys): IShared | undefined {
	if (a.Keys.isEmpty() || b.Keys.isEmpty()) return undefined;
	const keys = new Array<Enum.KeyCode>();
	const slotsA = new Array<BindingSlot>();
	/** The second binding's slots, by the shared key they hold */
	const slotsOfKey = new Map<Enum.KeyCode, BindingSlot[]>();
	let pressesBoth = false;
	let widerA = false;
	let widerB = false;
	const add = (key: Enum.KeyCode, slotA: BindingSlot, slotB: BindingSlot) => {
		if (!keys.includes(key)) keys.push(key);
		if (!slotsA.includes(slotA)) slotsA.push(slotA);
		const slots = slotsOfKey.get(key) ?? [];
		if (!slots.includes(slotB)) slots.push(slotB);
		slotsOfKey.set(key, slots);
	};
	for (const own of a.Keys) {
		for (const other of b.Keys) {
			const key = SharedKey(own.Key, other.Key);
			if (key === undefined) continue;
			if (own.Key === other.Key) pressesBoth = true;
			else if (key === own.Key) widerB = true;
			else widerA = true;
			add(key, own.Slot, other.Slot);
		}
		for (const other of b.Modifiers) if (own.Key === other.Key) add(own.Key, own.Slot, other.Slot);
	}
	for (const own of a.Modifiers) {
		for (const other of b.Keys) if (own.Key === other.Key) add(own.Key, own.Slot, other.Slot);
	}
	if (keys.isEmpty()) return undefined;
	const slotsB = new Array<BindingSlot>();
	for (const key of keys) {
		for (const slot of slotsOfKey.get(key)!) if (!slotsB.includes(slot)) slotsB.push(slot);
	}
	return {
		Keys: keys,
		SlotsA: slotsA,
		SlotsB: slotsB,
		Identical: pressesBoth && a.Primary === b.Primary && a.Secondary === b.Secondary,
		WiderA: widerA,
		WiderB: widerB,
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
 * `SharedKeys`), by path, each with its slots that hold a shared key. Not `binding` itself, nor a
 * handle on the same instance (another root handle's)
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
			Slot: shared.SlotsB[0],
			Slots: shared.SlotsB,
			Identical: shared.Identical,
			Wider: shared.WiderB,
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
				Slots: [shared.SlotsA, shared.SlotsB],
				Identical: shared.Identical,
				Wider: [shared.WiderA, shared.WiderB],
			});
		}
	}
	return found;
}
