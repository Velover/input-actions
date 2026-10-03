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
 * When something last reset each action (`os.clock()`): its context or itself disabled, a held
 * binding removed, a key change or a binding added while it was held, the Server Authority swap
 * telling the listeners a release. Gestures (`OnTap`...) read it: a `Released` that ends a press
 * begun before a reset is the reset's, no player's release, and ends the gesture without it
 */
const lastResets = setmetatable(new Map<InputAction, number>(), { __mode: "k" });

/**
 * Notes that the package is about to reset `action`. Called before the change, since under
 * Immediate signals IAS's `Released` runs inside it. Returns a function that takes the note back,
 * for a change that turns out to reset nothing (`AddingBindings` adding no binding)
 */
export function MarkReset(action: InputAction): () => void {
	const before = lastResets.get(action);
	const now = os.clock();
	lastResets.set(action, now);
	return () => {
		if (lastResets.get(action) !== now) return;
		if (before === undefined) lastResets.delete(action);
		else lastResets.set(action, before);
	};
}

/** Whether the package reset `action` at or after `since` (an `os.clock()` time) */
export function ResetSince(action: InputAction, since: number): boolean {
	const last = lastResets.get(action);
	return last !== undefined && last >= since;
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
