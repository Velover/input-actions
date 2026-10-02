import { RunService } from "@rbxts/services";
import { CarryChanges, ReadBinding, WriteBindings } from "../BindingState";
import { IRuntime, IsLive, IsServerAuthorityCopy, NEUTRAL_VALUES } from "../Internal";
import {
	ClearHeldValue,
	GetEntry,
	GetHeldValue,
	IHeldValue,
	IsPackageMade,
	RestoreHeldValue,
	SetHeldValue,
} from "../Registry";
import { BUTTON_BINDING_INFIX, IsButtonBindingName, SCRIPT_BINDING_SUFFIX } from "../Tree";
import { BindingHandle, ScriptableBindingHandle } from "./BindingHandle";

/** Seconds `Tap` waits at most for its press to land on a Server Authority copy */
const TAP_PRESS_TIMEOUT = 0.5;

/** `<Action>UIButton<n>` with the lowest `n` no child of `action` has */
function FreeButtonName(action: InputAction, actionName: string): string {
	let index = 1;
	while (action.FindFirstChild(`${actionName}${BUTTON_BINDING_INFIX}${index}`) !== undefined)
		index++;
	return `${actionName}${BUTTON_BINDING_INFIX}${index}`;
}

/**
 * Whether `instance` was destroyed: its Parent is locked, which only a write shows (probed). Writing
 * `nil` again succeeds either way, and making it its own parent fails either way, changing nothing:
 * the message tells "The Parent property of <Name> is locked" from "Attempt to set <Name> as its
 * own parent". Both hold the name, which can hold anything, so the whole phrase is looked for.
 */
function IsDestroyed(instance: Instance): boolean {
	if (instance.Parent !== undefined) return false;
	const [ok, message] = pcall(() => {
		instance.Parent = instance;
	});
	if (ok) return false;
	const locked = `The Parent property of ${instance.Name} is locked`;
	return tostring(message).find(locked, 1, true)[0] !== undefined;
}

/**
 * The handle each label is attached to: a label is on one action at a time, and the last
 * `AttachLabel`, from whichever handle, takes it over (hunt HL-1, HL-2)
 */
const LABEL_OWNERS = new Map<InputActionLabel, ActionHandle>();

/** A label `AttachLabel` points at the handle's action */
interface ILabelAttachment {
	/** Lets go of the label when it is destroyed */
	readonly Destroying: RBXScriptConnection;
	/** The action the package last pointed it at; letting go clears the label only while it shows it */
	Shows: InputAction;
}

/** What `MoveBindings` did to one action of a stand-in */
export interface IMovedBindings {
	/** The server's action the bindings moved under */
	Target: InputAction;
	/** Each binding of the stand-in's action, and the instance that stands for it under `Target` */
	Moved: Map<InputBinding, InputBinding>;
	/** The values the Scriptable bindings held, oldest first, to fire again once the context is set */
	Held: Array<[InputBinding, IHeldValue]>;
}

/**
 * Moves every binding of a stand-in's action under the server's copy of it (Server Authority swap).
 * Held Scriptable values are released first; `RefireHeldValues` fires them again in the order they
 * were fired, so the action ends on the same latest write. A binding another root handle already
 * made there under the same name is adopted rather than doubled, with the stand-in's rebinds
 * written onto it (button bindings are renamed instead).
 * @param carryEnabled no live root handle uses the copy's action yet: it takes the stand-in's
 * `Enabled` (the server's copy is always enabled; the client owns it)
 */
export function MoveBindings(
	source: InputAction,
	target: InputAction,
	carryEnabled: boolean,
): IMovedBindings {
	const neutral = NEUTRAL_VALUES[source.Type.Name];
	const held = new Array<[InputBinding, IHeldValue]>();
	for (const binding of source.GetChildren()) {
		if (!binding.IsA("InputBinding")) continue;
		const value = GetHeldValue(binding);
		if (value === undefined) continue;
		ClearHeldValue(binding);
		pcall(() => binding.Fire(neutral));
		// A value no live root handle holds any more is not carried over
		if (value.Holders.size() > 0) held.push([binding, value]);
	}
	held.sort((a, b) => a[1].Order < b[1].Order);
	if (carryEnabled) target.Enabled = source.Enabled;

	const moved = new Map<InputBinding, InputBinding>();
	for (const binding of source.GetChildren()) {
		if (!binding.IsA("InputBinding")) continue;
		const existing = target.FindFirstChild(binding.Name);
		if (existing === undefined || !existing.IsA("InputBinding") || !IsPackageMade(existing)) {
			binding.Parent = target;
			moved.set(binding, binding);
		} else if (IsButtonBindingName(source.Name, binding.Name)) {
			binding.Name = FreeButtonName(target, source.Name);
			binding.Parent = target;
			moved.set(binding, binding);
		} else {
			// Ours stays in the stand-in and goes with it. What it changed from its defaults (rebinds,
			// an import) is written onto the one that stands for it, whose defaults every handle on it
			// shares: the first handle's snapshot
			const defaults = GetEntry(binding)?.Defaults;
			if (defaults !== undefined && existing.Type === binding.Type) {
				GetEntry(existing)!.Defaults ??= defaults;
				WriteBindings([CarryChanges(ReadBinding(binding), defaults, existing)]);
			}
			moved.set(binding, existing);
		}
	}
	return {
		Target: target,
		Moved: moved,
		Held: held.map(([binding, value]) => [moved.get(binding) ?? binding, value]),
	};
}

/** Fires again the values `MoveBindings` released, on the bindings that now live under the copy */
export function RefireHeldValues(moved: IMovedBindings) {
	const target = moved.Target;
	for (const [binding, held] of moved.Held) {
		if (binding.Parent !== target) continue;
		// A root handle a listener destroyed during the swap holds nothing any more (Immediate
		// signals run listeners inside it): a value only such handles held stays at rest (hunt HL2-3)
		for (const holder of [...held.Holders]) {
			if (holder.IsDestroyed()) held.Holders.delete(holder);
		}
		if (held.Holders.size() === 0) continue;
		pcall(() => binding.Fire(held.Value));
		if (IsLive(target)) RestoreHeldValue(binding, held);
	}
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
	/** What the listeners were last told (or the state when the handle was made) */
	private _shownState: unknown;
	private _shownPressed: boolean;
	/**
	 * The last of `Pressed` and `Released` the listeners were sent. IAS can send the same one twice in
	 * a row (a Server Authority copy, after the stand-in swap, sent `Released` twice: 2026-10-02), and
	 * the handle passes it on once, so the two always alternate. Unset until the first one, so a handle
	 * made while its action is held still passes on that press's `Pressed` if it is on its way.
	 */
	private _lastEdge?: "Pressed" | "Released";
	private _forwards = new Array<RBXScriptConnection>();
	private _scriptBinding?: InputBinding;
	/** The bindings this handle's `AttachButton` made that are still there */
	private readonly _buttons = new Set<InputBinding>();
	/** The labels `AttachLabel` points at this action, until let go of or taken over */
	private readonly _labels = new Map<InputActionLabel, ILabelAttachment>();
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
		this._shownState = action.GetState();
		this._shownPressed = this._shownState === true;
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
		// An event still on its way from an instance the handle left is not passed on
		this._forwards.push(
			action.StateChanged.Connect((value) => {
				if (this.Instance !== action) return;
				this._shownState = value;
				stateChanged.Fire(value);
			}),
		);
		const pressed = this._pressed;
		const released = this._released;
		if (pressed !== undefined && released !== undefined) {
			const track = this._track;
			this._forwards.push(
				action.Pressed.Connect(() => {
					if (this.Instance !== action || this._lastEdge === "Pressed") return;
					// Counted here, from the IAS signal: a forward would land one deferral later
					if (track !== undefined) track.PressedCount++;
					this._shownPressed = true;
					this._lastEdge = "Pressed";
					pressed.Fire();
				}),
			);
			this._forwards.push(
				action.Released.Connect(() => {
					if (this.Instance !== action || this._lastEdge === "Released") return;
					if (track !== undefined) track.ReleasedCount++;
					this._shownPressed = false;
					this._lastEdge = "Released";
					released.Fire();
				}),
			);
		}
	}

	/**
	 * Points the handle at the server's copy of its action once `MoveBindings` moved the bindings
	 * there (Server Authority swap). The stand-in sends no more events, including those still on
	 * their way. Runs no listener: `FinishLink` tells them, once every handle on the stand-in is on
	 * the copy and linked (hunt HL2-2).
	 */
	LinkTo(target: InputAction, moved: ReadonlyMap<InputBinding, InputBinding>) {
		for (const [, handle] of pairs(this.Bindings)) {
			handle.Retarget(moved.get(handle.Instance) ?? handle.Instance);
		}
		if (this._scriptBinding !== undefined) {
			this._scriptBinding = moved.get(this._scriptBinding) ?? this._scriptBinding;
		}
		this.Attach(target);
	}

	/**
	 * Ends the swap `LinkTo` began. The labels still on the stand-in's action follow onto the copy
	 * (one pointed elsewhere meanwhile stays there: hunt HL-2), and the listeners are told the copy's
	 * state, so a press they heard from the stand-in ends with a `Released` before the copy's own
	 * events. Under Immediate signals both run listeners, which may destroy the root handle.
	 */
	FinishLink() {
		for (const [label, attachment] of [...this._labels]) {
			if (this._runtime.IsDestroyed()) return;
			if (this._labels.get(label) !== attachment || label.InputAction !== attachment.Shows)
				continue;
			attachment.Shows = this.Instance;
			label.InputAction = this.Instance;
		}
		if (this._runtime.IsDestroyed()) return;
		const state = this.Instance.GetState();
		if (state !== this._shownState) {
			this._shownState = state;
			this._stateChanged.Fire(state);
			if (this._runtime.IsDestroyed()) return;
		}
		const pressed = state === true;
		if (this.Type !== Enum.InputActionType.Bool || pressed === this._shownPressed) return;
		this._shownPressed = pressed;
		const track = this._track;
		if (pressed) {
			if (track !== undefined) track.PressedCount++;
			this._lastEdge = "Pressed";
			this._pressed?.Fire();
		} else {
			if (track !== undefined) track.ReleasedCount++;
			this._lastEdge = "Released";
			this._released?.Fire();
		}
	}

	/** Destroys the handle's own signals */
	Destroy() {
		const labels = new Array<InputActionLabel>();
		for (const [label] of this._labels) labels.push(label);
		for (const label of labels) this.DetachLabel(label);
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
		if (IsLive(this.Instance)) SetHeldValue(binding, value, this._neutral, this._runtime);
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
			while (!this.IsPressed() && IsServerAuthorityCopy(this.Instance) && os.clock() < deadline) {
				RunService.Heartbeat.Wait();
			}
			this.Fire(false);
		});
	}

	/**
	 * Points an InputActionLabel at this action, which then shows its keybind; the label follows the
	 * handle onto the server's copy at the Server Authority swap. The returned function, the label's
	 * destruction and `Destroy` let go of it, and letting go clears its `InputAction` unless something
	 * else pointed it elsewhere meanwhile. Attaching a label twice keeps one attachment; the function
	 * lets go of its own attachment only, so it does nothing once another one took the label over.
	 */
	AttachLabel(label: InputActionLabel): () => void {
		if (!(typeIs(label, "Instance") && label.IsA("InputActionLabel"))) {
			error(`InputActions: ${this.Name}: AttachLabel takes an InputActionLabel`, 2);
		}
		// A label destroyed already fires no Destroying that would let go of it
		if (this._runtime.IsDestroyed() || IsDestroyed(label)) return () => {};
		// the last attachment wins: another handle's (another root handle's, or another action's)
		// lets go of it without touching what it shows
		const owner = LABEL_OWNERS.get(label);
		if (owner !== undefined && owner !== this) owner.ReleaseLabel(label);
		LABEL_OWNERS.set(label, this);
		let attachment = this._labels.get(label);
		if (attachment === undefined) {
			const destroying = label.Destroying.Connect(() => this.DetachLabel(label));
			this._runtime.TrackConnection(destroying);
			attachment = { Destroying: destroying, Shows: this.Instance };
			this._labels.set(label, attachment);
		}
		attachment.Shows = this.Instance;
		// Written once attached: under Immediate signals the label's listeners run inside the write,
		// and one that takes the label over or destroys this root handle lets go of it (hunt HL2-1)
		label.InputAction = this.Instance;
		const attached = attachment;
		return () => this.DetachLabel(label, attached);
	}

	/**
	 * Lets go of a label attached by `AttachLabel`: it shows nothing more for this action. With
	 * `attachment`, only that one: nothing once another attachment took the label over, even when
	 * the label came back to this handle since (hunt HL-1)
	 */
	private DetachLabel(label: InputActionLabel, attachment?: ILabelAttachment) {
		const current = this._labels.get(label);
		if (current === undefined || (attachment !== undefined && attachment !== current)) return;
		this.ReleaseLabel(label);
		const shown = label.InputAction;
		if (shown === current.Shows || shown === this.Instance) label.InputAction = undefined;
	}

	/** Forgets a label without touching what it shows: another attachment takes it over, or it goes */
	ReleaseLabel(label: InputActionLabel) {
		const attachment = this._labels.get(label);
		if (attachment === undefined) return;
		this._labels.delete(label);
		attachment.Destroying.Disconnect();
		this._runtime.UntrackConnection(attachment.Destroying);
		if (LABEL_OWNERS.get(label) === this) LABEL_OWNERS.delete(label);
	}

	AttachButton(button: GuiButton): () => void {
		// A button destroyed already fires no Destroying that would remove its binding
		if (this._runtime.IsDestroyed() || IsDestroyed(button)) return () => {};
		const binding = new Instance("InputBinding");
		binding.Name = FreeButtonName(this.Instance, this.Name);
		binding.UIButton = button;
		binding.Parent = this.Instance;
		this._runtime.TrackCreated(binding);
		this._buttons.add(binding);

		let removed = false;
		let destroying: RBXScriptConnection | undefined;
		const remove = () => {
			if (removed) return;
			removed = true;
			this._buttons.delete(binding);
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
	 * rest: the last write wins, on both sides. Not in a place without Server Authority, where the
	 * copy is a local context (see `IsServerAuthorityCopy`).
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
		if (!IsServerAuthorityCopy(action)) return;
		const state = action.GetState();
		if (state === this._neutral) return;
		const binding = this.GetScriptBinding();
		pcall(() => {
			binding.Fire(state);
			binding.Fire(this._neutral);
		});
	}

	/**
	 * Lets go of what this root handle holds on an action another live root handle still uses,
	 * before its `Destroy`; the rest is the other handles'. IAS shows the last write, so a value
	 * this handle alone fired goes back to rest only when no value the package fired after it is
	 * held, and the action shows it or still rests (a Server Authority copy shows a Fire one
	 * simulation step later). A value another handle fired too, on the same binding, stays theirs. A
	 * held binding that is destroyed leaves the action stuck on (probed): when this handle's buttons
	 * go while the action is pressed and nothing another handle fired holds it, a same-frame pair on
	 * `<Action>Script` releases it, as removing a held button does.
	 */
	ReleaseOwn() {
		const action = this.Instance;
		const live = IsLive(action);
		const state = action.GetState();
		let latest: InputBinding | undefined;
		let latestOrder = 0;
		const own = new Array<[InputBinding, IHeldValue]>();
		let heldByOthers = false;
		for (const child of action.GetChildren()) {
			if (!child.IsA("InputBinding")) continue;
			const held = GetHeldValue(child);
			if (held === undefined) continue;
			if (held.Order > latestOrder) {
				latest = child;
				latestOrder = held.Order;
			}
			if (!held.Holders.has(this._runtime)) {
				if (held.Holders.size() > 0) heldByOthers = true;
				continue;
			}
			held.Holders.delete(this._runtime);
			if (held.Holders.size() > 0) heldByOthers = true;
			else own.push([child, held]);
		}
		for (const [binding, held] of own) {
			// Left in place otherwise, holding no one's value: IAS keeps it for the binding, and a later
			// Fire of the same value on it changes nothing (a shared `<Action>Script`)
			if (binding !== latest) continue;
			ClearHeldValue(binding);
			if (live && (state === held.Value || state === this._neutral))
				pcall(() => binding.Fire(this._neutral));
		}
		if (!live || heldByOthers || this._buttons.size() === 0 || !this.IsPressed()) return;
		const binding = this.GetScriptBinding();
		pcall(() => {
			binding.Fire(true);
			binding.Fire(false);
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
