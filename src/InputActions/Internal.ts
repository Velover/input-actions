import { Players } from "@rbxts/services";
import { IsServerAuthority } from "./AuthorityMode";

/** What the handles need from the root handle that owns them */
export interface IRuntime {
	/** Fires BindingsChanged with the binding's path (`Context/Action/Slot`) */
	NotifyBindingChanged(path: string): void;
	/** An instance the package created: destroyed by `Destroy` once no other root handle uses it */
	TrackCreated(instance: Instance): void;
	/** An existing instance the handles use (another root handle may have made it) */
	Use(instance: Instance): void;
	/** Drops an instance the handles no longer use (a removed button binding) */
	Untrack(instance: Instance): void;
	/** A connection disconnected by `Destroy` */
	TrackConnection(connection: RBXScriptConnection): void;
	/** Drops a connection already disconnected */
	UntrackConnection(connection: RBXScriptConnection): void;
	/** Whether `Destroy` destroys the instance: the package made it, and no other root handle uses it */
	GoesWithRoot(instance: Instance): boolean;
	IsDestroyed(): boolean;
}

/** The value of an action at rest, per action type */
export const NEUTRAL_VALUES: Record<Enum.InputActionType["Name"], unknown> = {
	Bool: false,
	Direction1D: 0,
	Direction2D: Vector2.zero,
	Direction3D: Vector3.zero,
	ViewportPosition: Vector2.zero,
};

/** Whether IAS processes a Fire on this action now: it ignores one on a disabled action or context */
export function IsLive(action: InputAction): boolean {
	if (!action.Enabled) return false;
	const context = action.Parent;
	return context === undefined || !context.IsA("InputContext") || context.Enabled;
}

/**
 * Whether the server keeps a state of its own for this action, which a reset on the client doesn't
 * release: the action is under the player (the server's copy of a Server Authority context, or the
 * PlayerModule's `player.InputContexts`) in a place that runs Server Authority. Without Server
 * Authority a copy under the player is an ordinary local context (probed): IAS releases it as any
 * other, and a pair fired for the server would press and release it once more. While the mode is
 * unknown (`IsServerAuthority()` is `undefined`) it counts as on.
 */
export function IsServerAuthorityCopy(action: Instance): boolean {
	return action.IsDescendantOf(Players.LocalPlayer) && IsServerAuthority() !== false;
}

/** The binding `ReleaseOnServer` makes for a moment */
const RELEASE_BINDING_NAME = "InputActionsRelease";

/**
 * Under Server Authority a reset (the context or the action disabled, a held binding destroyed)
 * releases only the client's state of an action on the server's copy: the server keeps the last
 * value it received (probed). A same-frame pair on a Scriptable binding, the held value then the
 * value at rest, releases both sides, even on a binding made and destroyed in that frame. For
 * actions the package drives no binding of: a binding named `name` is made for the pair and goes at
 * once. Nothing is fired for an action that isn't on such a copy (`IsServerAuthorityCopy`).
 * @param state the value to release: the action's state unless it was read before a change that
 * reset the action (see `WriteBindings`)
 */
export function ReleaseOnServer(
	action: InputAction,
	name = RELEASE_BINDING_NAME,
	state: unknown = action.GetState(),
) {
	if (!IsLive(action) || !IsServerAuthorityCopy(action)) return;
	const neutral = NEUTRAL_VALUES[action.Type.Name];
	if (state === neutral) return;
	// A release the package makes: a gesture takes it for no player's (hunt HF-1)
	MarkReset(action);
	const binding = new Instance("InputBinding");
	binding.Name = name;
	binding.Type = Enum.InputBindingType.Scriptable;
	binding.Parent = action;
	pcall(() => {
		binding.Fire(state);
		binding.Fire(neutral);
	});
	binding.Destroy();
}

/**
 * Numbers the resets the package marks and the releases the action handles hear, in the order they
 * happen: a counter, so no two tie (two `os.clock()` reads can)
 */
let sequence = 0;

/** The next number in the order of marks and releases (`MarkReset`, `ResetSince`) */
export function NextSequence(): number {
	sequence += 1;
	return sequence;
}

/**
 * When the package last reset each action while it was not at rest (a `NextSequence` number): its
 * context or itself disabled, a held binding removed, a key change or a binding added while it was
 * held, another root handle's `Destroy` letting go of it. Gestures (`OnTap`...) read it, and only
 * it: the `Released` such a reset makes is no player's release, and ends the gesture without
 * completing it. Every reset the package makes is noted, so a disabled action or context needs no
 * check of its own as the release arrives (hunt HF3-1, HF3-2)
 */
const lastResets = setmetatable(new Map<InputAction, number>(), { __mode: "k" });

/**
 * Notes that the package is about to reset `action`. Called before the change, since under
 * Immediate signals IAS's `Released` runs inside it. Only while IAS shows the action not at rest:
 * a reset of an action at rest releases nothing, and a release of the player's still on its way
 * to the handles (Deferred signals) would be taken for the reset's (hunt HF2-1). What IAS shows
 * decides, both ways: a value the package fired that IAS doesn't show yet (a Server Authority copy
 * shows it one simulation step later) doesn't count, since no release may follow and the mark
 * would take the player's next one; and a release IAS doesn't show yet (that step, or a key's
 * `UserInputService.InputEnded` handler, which runs before IAS lets go) doesn't either: the reset is
 * noted, and that release of the player's counts as the reset's (hunts HF3-3, HF3-6, documented).
 * Returns a function that takes the note back, for a change that turns out to reset nothing
 * (`AddingBindings` adding no binding)
 */
export function MarkReset(action: InputAction): () => void {
	if (action.GetState() === NEUTRAL_VALUES[action.Type.Name]) return () => {};
	const before = lastResets.get(action);
	const mark = NextSequence();
	lastResets.set(action, mark);
	return () => {
		if (lastResets.get(action) !== mark) return;
		if (before === undefined) lastResets.delete(action);
		else lastResets.set(action, before);
	};
}

/**
 * Whether the package marked a reset of `action` after `since` (a `NextSequence` number): an
 * action handle asks with the number its previous release got, so a reset of a press still on its
 * way to the handle (Deferred signals: pressed and reset in one frame) counts too (hunt HF2-1)
 */
export function ResetSince(action: InputAction, since: number): boolean {
	const last = lastResets.get(action);
	return last !== undefined && last > since;
}

/** `Context/Action/Slot` */
export function JoinPath(...parts: string[]): string {
	return parts.join("/");
}

/** The entries of a record keyed by names */
export function Entries<V>(record: { readonly [name: string]: V }): Array<[string, V]> {
	const list = new Array<[string, V]>();
	for (const [key, value] of pairs(record)) list.push([key as string, value as V]);
	return list;
}
