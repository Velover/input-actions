import type { IBindingValues } from "./BindingState";
import type { ContextState } from "./Handles/ContextHandle";

// What every live root handle shares about one instance. `Create` twice on one folder adopts the
// same instances (design spec §4), so ownership, defaults and the enabled state of a context can't
// belong to one handle: an instance the package made goes with its last user, `Reset` returns to
// the same defaults whichever handle calls it, and a context has one enabled state.

export interface ISharedEntry {
	/** Live root handles that use the instance */
	Users: number;
	/** Made by the package: destroyed when its last user goes */
	Created: boolean;
	/** Bindings: the defaults `Reset` returns to, taken by the first user */
	Defaults?: IBindingValues;
	/** Server Authority templates disabled locally: the `Enabled` given back when the last user goes */
	TemplateEnabled?: boolean;
	/** Contexts: the enabled state every handle on it shares */
	Context?: ContextState;
}

const entries = new Map<Instance, ISharedEntry>();

/** Adds a user to the instance's entry (made on first use) */
export function AddUser(instance: Instance, created: boolean): ISharedEntry {
	let entry = entries.get(instance);
	if (entry === undefined) {
		entry = { Users: 0, Created: created };
		entries.set(instance, entry);
	}
	entry.Users++;
	if (created) entry.Created = true;
	return entry;
}

/** Removes a user; returns the entry when that was the last one, for the caller to clean up */
export function RemoveUser(instance: Instance): ISharedEntry | undefined {
	const entry = entries.get(instance);
	if (entry === undefined) return undefined;
	entry.Users--;
	if (entry.Users > 0) return undefined;
	entries.delete(instance);
	return entry;
}

export function GetEntry(instance: Instance): ISharedEntry | undefined {
	return entries.get(instance);
}

/** Whether a live root handle made this instance */
export function IsPackageMade(instance: Instance): boolean {
	return entries.get(instance)?.Created === true;
}

/** Whether more than one live root handle uses this instance */
export function IsShared(instance: Instance): boolean {
	return (entries.get(instance)?.Users ?? 0) > 1;
}

/**
 * Instances of a server's copy (Server Authority) whose `Enabled` the client has taken over. The
 * server makes its copy enabled; the first time the package takes up one of its contexts or actions,
 * the client gives it the template's or the schema's `Enabled`. From then on the instance's own value
 * is the client's state, as for any adopted instance.
 */
const claimedCopies = setmetatable(new Map<Instance, true>(), { __mode: "k" });

/** Marks an instance of a server's copy as the client's; returns whether it was not yet */
export function ClaimCopy(instance: Instance): boolean {
	if (claimedCopies.has(instance)) return false;
	claimedCopies.set(instance, true);
	return true;
}

/** A value the package fired on a Scriptable binding, and the root handles that fired it */
export interface IHeldValue {
	Value: unknown;
	/**
	 * The runtimes of the root handles whose `Fire` it was: the value goes back to rest when the
	 * last of them is destroyed. A handle firing the value the binding already holds joins them (IAS
	 * ignores that Fire, but it holds the value as much as the first one does).
	 */
	Holders: Set<object>;
	/** When IAS took the value, in the order of every package Fire: the action shows the latest write */
	Order: number;
}

/**
 * The last value the package fired on each Scriptable binding, while it holds the action. Shared,
 * so any handle can release it, and a Server Authority swap carries it over.
 */
const heldValues = setmetatable(new Map<InputBinding, IHeldValue>(), { __mode: "k" });
let fireCount = 0;

export function SetHeldValue(binding: InputBinding, value: unknown, neutral: unknown, holder: object) {
	if (value === neutral) {
		heldValues.delete(binding);
		return;
	}
	const held = heldValues.get(binding);
	// A binding firing the value it already holds changes nothing in IAS (probed)
	if (held !== undefined && held.Value === value) {
		held.Holders.add(holder);
		return;
	}
	fireCount++;
	heldValues.set(binding, { Value: value, Holders: new Set([holder]), Order: fireCount });
}

/** Puts back a held value carried over a Server Authority swap, fired again as the latest write */
export function RestoreHeldValue(binding: InputBinding, held: IHeldValue) {
	fireCount++;
	heldValues.set(binding, { Value: held.Value, Holders: held.Holders, Order: fireCount });
}

export function GetHeldValue(binding: InputBinding): IHeldValue | undefined {
	return heldValues.get(binding);
}

export function ClearHeldValue(binding: InputBinding) {
	heldValues.delete(binding);
}
