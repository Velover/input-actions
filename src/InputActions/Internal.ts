import { Players } from "@rbxts/services";

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

/** The binding `ReleaseOnServer` makes for a moment */
const RELEASE_BINDING_NAME = "InputActionsRelease";

/**
 * Under Server Authority a reset (the context or the action disabled, a held binding destroyed)
 * releases only the client's state of an action on the server's copy: the server keeps the last
 * value it received (probed). A same-frame pair on a Scriptable binding, the held value then the
 * value at rest, releases both sides, even on a binding made and destroyed in that frame. For
 * actions the package drives no binding of: a binding named `name` is made for the pair and goes at
 * once.
 * @param state the value to release: the action's state unless it was read before a change that
 * reset the action (see `WriteBindings`)
 */
export function ReleaseOnServer(
	action: InputAction,
	name = RELEASE_BINDING_NAME,
	state: unknown = action.GetState(),
) {
	if (!IsLive(action) || !action.IsDescendantOf(Players.LocalPlayer)) return;
	const neutral = NEUTRAL_VALUES[action.Type.Name];
	if (state === neutral) return;
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
