import { RunService } from "@rbxts/services";
import type { IRuntime } from "../Internal";
import { BindingHandle, ScriptableBindingHandle } from "./BindingHandle";

/** Suffix of the Scriptable binding `Fire` creates: `<Action>Script` */
export const SCRIPT_BINDING_SUFFIX = "Script";
/** Infix of the bindings `AttachButton` creates: `<Action>UIButton<n>` */
export const BUTTON_BINDING_INFIX = "UIButton";

/** The value of an action at rest, per action type */
const NEUTRAL_VALUES: Record<Enum.InputActionType["Name"], unknown> = {
	Bool: false,
	Direction1D: 0,
	Direction2D: Vector2.zero,
	Direction3D: Vector3.zero,
	ViewportPosition: Vector2.zero,
};

/** Whether a binding under `action` was made by the package (Fire or AttachButton) */
export function IsPackageBindingName(actionName: string, bindingName: string): boolean {
	if (bindingName === actionName + SCRIPT_BINDING_SUFFIX) return true;
	const prefix = actionName + BUTTON_BINDING_INFIX;
	return (
		bindingName.sub(1, prefix.size()) === prefix &&
		bindingName.sub(prefix.size() + 1).match("^%d+$")[0] !== undefined
	);
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
	private _forwards = new Array<RBXScriptConnection>();
	private _scriptBinding?: InputBinding;
	/** The last value `Fire` sent, until something releases it */
	private _scriptValue?: unknown;
	private _buttonCount = 0;
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
	 * giving way to the server's copy) and attaches the handle to it. Scriptable bindings are
	 * released first; pass what this returns to `RefireScriptableValues` once the context is set.
	 */
	MoveTo(target: InputAction): Map<InputBinding, unknown> {
		const source = this.Instance;
		const values = this.GetScriptableValues();
		this.ReleaseScriptableBindings();
		target.Enabled = source.Enabled;
		for (const binding of source.GetChildren()) {
			if (binding.IsA("InputBinding")) binding.Parent = target;
		}
		this.Attach(target);
		return values;
	}

	/** Fires the values `MoveTo` returned, on the bindings that now live under the new action */
	RefireScriptableValues(values: ReadonlyMap<InputBinding, unknown>) {
		for (const [binding, value] of values) {
			if (binding.Parent !== this.Instance) continue;
			pcall(() => binding.Fire(value));
			if (binding === this._scriptBinding) this._scriptValue = value;
			for (const [, handle] of pairs(this.Bindings)) {
				if (handle instanceof ScriptableBindingHandle && handle.Instance === binding) {
					handle.LastValue = value;
				}
			}
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
		this.GetScriptBinding().Fire(value);
		this._scriptValue = value;
	}

	SetEnabled(enabled: boolean) {
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
		this.Fire(true);
		task.spawn(() => {
			RunService.Heartbeat.Wait();
			if (!this._runtime.IsDestroyed()) this.Fire(false);
		});
	}

	AttachButton(button: GuiButton): () => void {
		this._buttonCount++;
		const binding = new Instance("InputBinding");
		binding.Name = `${this.Name}${BUTTON_BINDING_INFIX}${this._buttonCount}`;
		binding.UIButton = button;
		binding.Parent = this.Instance;
		this._runtime.TrackCreated(binding);

		let removed = false;
		let destroying: RBXScriptConnection | undefined;
		const remove = () => {
			if (removed) return;
			removed = true;
			destroying?.Disconnect();
			// A held binding that is destroyed leaves the action stuck on (probed): reset it
			const held = binding.Parent === this.Instance && this.Instance.GetState() === true;
			binding.Destroy();
			if (held) this.ResetState();
		};
		destroying = button.Destroying.Connect(remove);
		this._runtime.TrackConnection(destroying);
		return remove;
	}

	/** The last value sent through each Scriptable binding the package drives, while held */
	private GetScriptableValues(): Map<InputBinding, unknown> {
		const values = new Map<InputBinding, unknown>();
		const scriptBinding = this._scriptBinding;
		if (
			scriptBinding !== undefined &&
			scriptBinding.Parent === this.Instance &&
			this._scriptValue !== undefined
		) {
			values.set(scriptBinding, this._scriptValue);
		}
		for (const [, handle] of pairs(this.Bindings)) {
			if (handle instanceof ScriptableBindingHandle && handle.LastValue !== undefined) {
				values.set(handle.Instance, handle.LastValue);
			}
		}
		return values;
	}

	/**
	 * Fires the value at rest on every Scriptable binding the package drives (Fire's binding and the
	 * schema's Scriptable slots). Under Server Authority a disabled context releases the client's
	 * state only; the server keeps the last fired value until the binding fires again (probed).
	 */
	ReleaseScriptableBindings() {
		const neutral = NEUTRAL_VALUES[this.Type.Name];
		const bindings = new Array<InputBinding>();
		if (this._scriptBinding !== undefined && this._scriptBinding.Parent === this.Instance) {
			bindings.push(this._scriptBinding);
		}
		this._scriptValue = undefined;
		for (const [, handle] of pairs(this.Bindings)) {
			if (!(handle instanceof ScriptableBindingHandle)) continue;
			bindings.push(handle.Instance);
			handle.LastValue = undefined;
		}
		for (const binding of bindings) {
			// Ignored by IAS on a disabled action; pcall for a binding someone else broke or removed
			if (binding.Type === Enum.InputBindingType.Scriptable) pcall(() => binding.Fire(neutral));
		}
	}

	/** Releases the action: IAS resets the state of a disabled action */
	ResetState() {
		if (!this.Instance.Enabled) return;
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
