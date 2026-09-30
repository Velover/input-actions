import { Players, RunService } from "@rbxts/services";
import { IRuntime, IsLive, NEUTRAL_VALUES } from "../Internal";
import { ClearHeldValue, GetHeldValue, IsPackageMade, SetHeldValue } from "../Registry";
import { BindingHandle, ScriptableBindingHandle } from "./BindingHandle";

/** Suffix of the Scriptable binding `Fire` creates: `<Action>Script` */
export const SCRIPT_BINDING_SUFFIX = "Script";
/** Infix of the bindings `AttachButton` creates: `<Action>UIButton<n>` */
export const BUTTON_BINDING_INFIX = "UIButton";
/** Seconds `Tap` waits at most for its press to land on a Server Authority copy */
const TAP_PRESS_TIMEOUT = 0.5;

/** Whether a binding under `action` was made by the package (Fire or AttachButton) */
export function IsPackageBindingName(actionName: string, bindingName: string): boolean {
	if (bindingName === actionName + SCRIPT_BINDING_SUFFIX) return true;
	return IsButtonBindingName(actionName, bindingName);
}

function IsButtonBindingName(actionName: string, bindingName: string): boolean {
	const prefix = actionName + BUTTON_BINDING_INFIX;
	return (
		bindingName.sub(1, prefix.size()) === prefix &&
		bindingName.sub(prefix.size() + 1).match("^%d+$")[0] !== undefined
	);
}

/** `<Action>UIButton<n>` with the lowest `n` no child of `action` has */
function FreeButtonName(action: InputAction, actionName: string): string {
	let index = 1;
	while (action.FindFirstChild(`${actionName}${BUTTON_BINDING_INFIX}${index}`) !== undefined) index++;
	return `${actionName}${BUTTON_BINDING_INFIX}${index}`;
}

/** Per-frame snapshot state of an action defined with TrackPrevious: true */
interface ITrackState {
	Previous: unknown;
	Current: unknown;
	/** Pressed/Released events since the last snapshot */
	PressedCount: number;
	ReleasedCount: number;
	/** Transitions a snapshot saw in the state before their event arrived: the event is not counted twice */
	OwedPressed: number;
	OwedReleased: number;
	JustPressed: boolean;
	JustReleased: boolean;
}

/**
 * The handle of one action; the types expose only what fits the action's type and options. Its
 * signals are its own (BindableEvents) and forward from whichever InputAction it wraps, so they keep
 * working when a Server Authority stand-in is swapped for the server's copy.
 */
export class ActionHandle {
	/** The InputAction the handle wraps now */
	Instance: InputAction;
	readonly Name: string;
	readonly Type: Enum.InputActionType;
	readonly StateChanged: RBXScriptSignal<(value: unknown) => void>;
	/** Bool actions only */
	readonly Pressed?: RBXScriptSignal<() => void>;
	/** Bool actions only */
	readonly Released?: RBXScriptSignal<() => void>;
	readonly Bindings: Record<string, BindingHandle | ScriptableBindingHandle> = {};

	private readonly _stateChanged = new Instance("BindableEvent");
	private readonly _pressed?: BindableEvent;
	private readonly _released?: BindableEvent;
	private readonly _neutral: unknown;
	private _forwards = new Array<RBXScriptConnection>();
	private _scriptBinding?: InputBinding;
	private _track?: ITrackState;

	// A parameter named `Instance` would shadow the global in the field initializers
	constructor(
		private readonly _runtime: IRuntime,
		action: InputAction,
		name: string,
		trackPrevious: boolean,
	) {
		this.Instance = action;
		this.Name = name;
		this.Type = action.Type;
		this._neutral = NEUTRAL_VALUES[action.Type.Name];
		this.StateChanged = this._stateChanged.Event as RBXScriptSignal<(value: unknown) => void>;
		if (this.Type === Enum.InputActionType.Bool) {
			this._pressed = new Instance("BindableEvent");
			this._released = new Instance("BindableEvent");
			this.Pressed = this._pressed.Event as RBXScriptSignal<() => void>;
			this.Released = this._released.Event as RBXScriptSignal<() => void>;
		}
		if (trackPrevious) {
			const state = action.GetState();
			this._track = {
				Previous: state,
				Current: state,
				PressedCount: 0,
				ReleasedCount: 0,
				OwedPressed: 0,
				OwedReleased: 0,
				JustPressed: false,
				JustReleased: false,
			};
		}
		this.Attach(action);
	}

	/** Points the handle at `action`: its signals forward from that instance from now on */
	Attach(action: InputAction) {
		for (const connection of this._forwards) connection.Disconnect();
		this._forwards.clear();
		this.Instance = action;
		const stateChanged = this._stateChanged;
		this._forwards.push(action.StateChanged.Connect((value) => stateChanged.Fire(value)));
		const pressed = this._pressed;
		const released = this._released;
		if (pressed !== undefined && released !== undefined) {
			this._forwards.push(action.Pressed.Connect(() => pressed.Fire()));
			this._forwards.push(action.Released.Connect(() => released.Fire()));
			const track = this._track;
			if (track !== undefined) {
				// Counted from the IAS signals directly: a forward would land one deferral later
				this._forwards.push(action.Pressed.Connect(() => track.PressedCount++));
				this._forwards.push(action.Released.Connect(() => track.ReleasedCount++));
			}
		}
	}

	/**
	 * Moves every binding of the current InputAction under `target` (a Server Authority stand-in
	 * giving way to the server's copy) and attaches the handle to it. Held Scriptable values are
	 * released first; pass what this returns to `RefireHeldValues` once the context is set. A
	 * binding another root handle already moved there under the same name is adopted rather than
	 * doubled (its button bindings are renamed instead).
	 */
	MoveTo(target: InputAction): Array<[InputBinding, unknown]> {
		const source = this.Instance;
		const held = new Array<[InputBinding, unknown]>();
		for (const binding of source.GetChildren()) {
			if (!binding.IsA("InputBinding")) continue;
			const value = GetHeldValue(binding);
			if (value === undefined) continue;
			held.push([binding, value]);
			ClearHeldValue(binding);
			pcall(() => binding.Fire(this._neutral));
		}
		target.Enabled = source.Enabled;

		const moved = new Map<InputBinding, InputBinding>();
		for (const binding of source.GetChildren()) {
			if (!binding.IsA("InputBinding")) continue;
			const existing = target.FindFirstChild(binding.Name);
			if (existing === undefined || !existing.IsA("InputBinding") || !IsPackageMade(existing)) {
				binding.Parent = target;
				moved.set(binding, binding);
			} else if (IsButtonBindingName(this.Name, binding.Name)) {
				binding.Name = FreeButtonName(target, this.Name);
				binding.Parent = target;
				moved.set(binding, binding);
			} else {
				// Ours stays in the stand-in and goes with it
				this._runtime.Use(existing);
				moved.set(binding, existing);
			}
		}
		for (const [, handle] of pairs(this.Bindings)) {
			handle.Instance = moved.get(handle.Instance) ?? handle.Instance;
		}
		if (this._scriptBinding !== undefined) {
			this._scriptBinding = moved.get(this._scriptBinding) ?? this._scriptBinding;
		}
		this.Attach(target);
		return held.map(([binding, value]) => [moved.get(binding) ?? binding, value]);
	}

	/** Fires the values `MoveTo` returned, on the bindings that now live under the new action */
	RefireHeldValues(values: ReadonlyArray<[InputBinding, unknown]>) {
		for (const [binding, value] of values) {
			if (binding.Parent !== this.Instance) continue;
			pcall(() => binding.Fire(value));
			if (IsLive(this.Instance)) SetHeldValue(binding, value, this._neutral);
		}
	}

	/** Destroys the handle's own signals */
	Destroy() {
		for (const connection of this._forwards) connection.Disconnect();
		this._forwards.clear();
		this._stateChanged.Destroy();
		this._pressed?.Destroy();
		this._released?.Destroy();
	}

	IsTracked() {
		return this._track !== undefined;
	}

	GetState(): unknown {
		return this.Instance.GetState();
	}

	Fire(value: unknown) {
		if (this._runtime.IsDestroyed()) return;
		const binding = this.GetScriptBinding();
		binding.Fire(value);
		// IAS ignores a Fire on a disabled action or context: nothing is held then
		if (IsLive(this.Instance)) SetHeldValue(binding, value, this._neutral);
		else ClearHeldValue(binding);
	}

	SetEnabled(enabled: boolean) {
		if (this._runtime.IsDestroyed()) return;
		if (!enabled && this.Instance.Enabled) this.Release();
		this.Instance.Enabled = enabled;
	}

	IsEnabled() {
		return this.Instance.Enabled;
	}

	GetPreferredBinding() {
		return this.Instance.PreferredBinding;
	}

	IsPressed() {
		return this.Instance.GetState() === true;
	}

	Tap() {
		if (this._runtime.IsDestroyed()) return;
		this.Fire(true);
		task.spawn(() => {
			RunService.Heartbeat.Wait();
			// The server's copy takes the press on its next simulation step, which may be frames
			// away: a release before it would land in the same step, and the server would see no press
			const deadline = os.clock() + TAP_PRESS_TIMEOUT;
			while (
				!this.IsPressed() &&
				this.Instance.IsDescendantOf(Players.LocalPlayer) &&
				os.clock() < deadline
			) {
				RunService.Heartbeat.Wait();
			}
			this.Fire(false);
		});
	}

	AttachButton(button: GuiButton): () => void {
		if (this._runtime.IsDestroyed()) return () => {};
		const binding = new Instance("InputBinding");
		binding.Name = FreeButtonName(this.Instance, this.Name);
		binding.UIButton = button;
		binding.Parent = this.Instance;
		this._runtime.TrackCreated(binding);

		let removed = false;
		let destroying: RBXScriptConnection | undefined;
		const remove = () => {
			if (removed) return;
			removed = true;
			if (destroying !== undefined) {
				destroying.Disconnect();
				this._runtime.UntrackConnection(destroying);
			}
			// Destroy already removed the binding and released the action
			if (this._runtime.IsDestroyed()) return;
			// A held binding that is destroyed leaves the action stuck on (probed): reset it
			const held = binding.Parent === this.Instance && this.Instance.GetState() === true;
			binding.Destroy();
			this._runtime.Untrack(binding);
			if (held) this.ResetState();
		};
		destroying = button.Destroying.Connect(remove);
		this._runtime.TrackConnection(destroying);
		return remove;
	}

	/**
	 * Lets go of the action before something resets it: its context or itself disabled, a held
	 * binding removed, `Destroy`. The package's own Scriptable bindings that hold a value fire the
	 * value at rest. Under Server Authority a reset only releases the client's state: the server
	 * keeps the last value it received, and the client's comes back when re-enabled (probed). So an
	 * action on the server's copy still held by anything else (a key, a button, a binding the
	 * package doesn't drive) gets a same-frame pair on `<Action>Script`, its value then the value at
	 * rest: the last write wins, on both sides.
	 */
	Release() {
		const action = this.Instance;
		const held = new Array<InputBinding>();
		for (const child of action.GetChildren()) {
			if (child.IsA("InputBinding") && GetHeldValue(child) !== undefined) {
				held.push(child);
				ClearHeldValue(child);
			}
		}
		if (!IsLive(action)) return;
		if (held.size() > 0) {
			for (const binding of held) pcall(() => binding.Fire(this._neutral));
			return;
		}
		if (!action.IsDescendantOf(Players.LocalPlayer)) return;
		const state = action.GetState();
		if (state === this._neutral) return;
		const binding = this.GetScriptBinding();
		pcall(() => {
			binding.Fire(state);
			binding.Fire(this._neutral);
		});
	}

	/** Releases the action, then resets it: IAS resets the state of a disabled action */
	ResetState() {
		if (!this.Instance.Enabled) return;
		this.Release();
		this.Instance.Enabled = false;
		this.Instance.Enabled = true;
	}

	GetPrevious(): unknown {
		return this.GetTrack().Previous;
	}

	HasChanged(): boolean {
		const track = this.GetTrack();
		return track.Current !== track.Previous || track.JustPressed || track.JustReleased;
	}

	IsJustPressed(): boolean {
		return this.GetTrack().JustPressed;
	}

	IsJustReleased(): boolean {
		return this.GetTrack().JustReleased;
	}

	/** Takes this frame's snapshot; the runtime calls it once per frame for tracked actions */
	Snapshot() {
		const track = this._track;
		if (track === undefined) return;
		track.Previous = track.Current;
		track.Current = this.Instance.GetState();
		if (this.Type !== Enum.InputActionType.Bool) return;

		// Events that pay back a transition the last snapshot already saw don't count again
		const pressed = math.max(0, track.PressedCount - track.OwedPressed);
		const released = math.max(0, track.ReleasedCount - track.OwedReleased);
		track.PressedCount = 0;
		track.ReleasedCount = 0;
		track.OwedPressed = 0;
		track.OwedReleased = 0;

		const rose = track.Current === true && track.Previous !== true;
		const fell = track.Current !== true && track.Previous === true;
		track.JustPressed = pressed > 0 || rose;
		track.JustReleased = released > 0 || fell;
		// Seen in the state before the event arrived: the event lands before the next snapshot
		if (rose && pressed === 0) track.OwedPressed = 1;
		if (fell && released === 0) track.OwedReleased = 1;
	}

	private GetTrack(): ITrackState {
		const track = this._track;
		if (track === undefined) error(`InputActions: ${this.Name} needs TrackPrevious: true`, 3);
		return track;
	}

	private GetScriptBinding(): InputBinding {
		const current = this._scriptBinding;
		if (current !== undefined && current.Parent === this.Instance) return current;
		const name = this.Name + SCRIPT_BINDING_SUFFIX;
		const existing = this.Instance.FindFirstChild(name);
		if (
			existing !== undefined &&
			existing.IsA("InputBinding") &&
			existing.Type === Enum.InputBindingType.Scriptable
		) {
			// Made by another root handle on the same folder, or by the designer
			this._runtime.Use(existing);
			this._scriptBinding = existing;
			return existing;
		}
		const binding = new Instance("InputBinding");
		binding.Name = name;
		binding.Type = Enum.InputBindingType.Scriptable;
		binding.Parent = this.Instance;
		this._runtime.TrackCreated(binding);
		this._scriptBinding = binding;
		return binding;
	}
}
