import { RunService } from "@rbxts/services";
import {
	AddingBindings,
	CarryChanges,
	FillPlaceholder,
	ReadBinding,
	SameValues,
	WriteBindings,
} from "../BindingState";
import { CaptureChord, CaptureKey, CapturedKey, CHORD_TYPES, IsValidTimeout } from "../Capture";
import { GestureEdge, IGestureSource, OnDoubleTap, OnHold, OnLongPress, OnTap } from "../Gestures";
import {
	IRuntime,
	IsLive,
	IsServerAuthorityCopy,
	MarkReset,
	NEUTRAL_VALUES,
	NextSequence,
	ResetSince,
} from "../Internal";
import { CapturableDevice, Device, GetKeyDevice, IsDevice } from "../KeyGroups";
import { PreferredDevice } from "../PreferredDevice";
import type {
	ICaptureOptions,
	IChord,
	IChordCaptureOptions,
	IDoubleTapOptions,
	IHoldOptions,
	ILongPressOptions,
	ITapOptions,
} from "../Types";
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
import {
	BindingHandle,
	BindingWatcher,
	HandlesOn,
	ScriptableBindingHandle,
} from "./BindingHandle";

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
	/**
	 * The handles whose bindings now read otherwise: those root handles already on the copy have on
	 * the bindings the move changed (the stand-in's rebinds written onto one adopted, or its schema
	 * filling it; hunt HF3-5), and the stand-in's own on a binding it adopted that reads otherwise
	 * than the stand-in's did (the other root handle's rebinds, its keys for a device the stand-in's
	 * schema left out; hunt HF4-2). Their `BindingsChanged` fires once the swap is done
	 */
	Changed: BindingWatcher[];
}

/**
 * Releases the values the package's Scriptable bindings hold on a stand-in's action, the first step
 * of a Server Authority swap, before anything touches the copy: under Immediate signals the
 * listeners run here, with everything still on the stand-in (hunt HL3-1). The records stay until
 * `TakeHeldValues`, once every action of the stand-in is released: a value a listener fires here
 * replaces the one it fires over, and one it fires at rest drops it (hunt HL4-2).
 */
export function ReleaseHeldValues(source: InputAction) {
	MarkReset(source);
	const neutral = NEUTRAL_VALUES[source.Type.Name];
	for (const binding of source.GetChildren()) {
		if (!binding.IsA("InputBinding") || GetHeldValue(binding) === undefined) continue;
		pcall(() => binding.Fire(neutral));
	}
}

/**
 * The values the package's Scriptable bindings hold on a stand-in's action once `ReleaseHeldValues`
 * ran on every action of the stand-in, oldest first, to carry over to the copy (`MoveBindings`):
 * what they held before, or what a listener fired on them during the releases. Their records go.
 */
export function TakeHeldValues(source: InputAction): Array<[InputBinding, IHeldValue]> {
	const held = new Array<[InputBinding, IHeldValue]>();
	for (const binding of source.GetChildren()) {
		if (!binding.IsA("InputBinding")) continue;
		const value = GetHeldValue(binding);
		if (value === undefined) continue;
		ClearHeldValue(binding);
		// A value no live root handle holds any more is not carried over
		if (value.Holders.size() > 0) held.push([binding, value]);
	}
	held.sort((a, b) => a[1].Order < b[1].Order);
	return held;
}

/**
 * Moves every binding of a stand-in's action under the server's copy of it (Server Authority swap),
 * once `ReleaseHeldValues` released its held values; `RefireHeldValues` fires them again in the
 * order they were fired, so the action ends on the same latest write. A binding another root handle
 * already made there under the same name is adopted rather than doubled, with the stand-in's
 * rebinds written onto it (button bindings are renamed instead); the stand-in's handles read it from
 * then on, and are told when it reads otherwise than theirs did (`Changed`). A binding moved onto a
 * copy's action that is not at rest (another root handle is on the copy) makes IAS reset it, and
 * the package lets go of it then (`AddingBindings`, hunt HL4-4).
 * @param carryEnabled no live root handle uses the copy's action yet: it takes the stand-in's
 * `Enabled` (the server's copy is always enabled; the client owns it)
 * @param held what `TakeHeldValues` returned for `source`
 */
export function MoveBindings(
	source: InputAction,
	target: InputAction,
	carryEnabled: boolean,
	held: Array<[InputBinding, IHeldValue]>,
): IMovedBindings {
	if (carryEnabled) target.Enabled = source.Enabled;

	const moved = new Map<InputBinding, InputBinding>();
	const changed = new Array<BindingWatcher>();
	AddingBindings(target, () => {
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
				// Ours stays in the stand-in and goes with it. What it changed from its defaults
				// (rebinds, an import) is written onto the one that stands for it, whose defaults every
				// handle on it shares: the first handle's snapshot. One that handle made unbound, for a
				// device its schema left out, takes ours first when our schema names the device (a fill
				// changes keys: `AddingBindings` lets go of the action if IAS resets it)
				const entry = GetEntry(binding);
				const defaults = entry?.Defaults;
				if (defaults !== undefined && existing.Type === binding.Type) {
					const filled = entry?.Placeholder !== true && FillPlaceholder(existing, defaults);
					GetEntry(existing)!.Defaults ??= defaults;
					const carry = CarryChanges(ReadBinding(binding), defaults, existing);
					if (WriteBindings([carry]).size() > 0 || filled)
						for (const handle of HandlesOn([existing])) changed.push(handle);
				}
				// Our handles read the adopted binding from now on: where it reads otherwise than ours
				// (the other root handle's rebinds, its keys for a device our schema left out), their
				// root handles are told too (hunt HF4-2)
				if (!SameValues(ReadBinding(binding), ReadBinding(existing)))
					for (const handle of HandlesOn([binding])) changed.push(handle);
				moved.set(binding, existing);
			}
		}
	});
	return {
		Target: target,
		Moved: moved,
		Held: held.map(([binding, value]) => [moved.get(binding) ?? binding, value]),
		Changed: changed,
	};
}

/** Fires again the values `ReleaseHeldValues` released, on the bindings that now live under the copy */
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
	/**
	 * Whether the listeners have `_shownState`: a `StateChanged` was passed on or told, or the swap
	 * took it as theirs. A `StateChanged` repeating it is dropped from then on: on the Join path the
	 * copy's own events can reach a handle the swap already told, or that heard the value from the
	 * stand-in (hunt HL3-3). Until then anything is passed on, as for `_lastEdge`.
	 */
	private _stateKnown = false;
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
	/** The gestures running on this handle (`OnTap`...): `Destroy` stops them */
	private readonly _gestures = new Set<() => void>();
	/** The gestures' signal (`GestureEdges`), made with the first gesture */
	private _gestureEdges?: BindableEvent;
	/**
	 * Where the handle's last release that found the action at rest came in the order of marks and
	 * releases (`NextSequence`), or where it was pointed at its action (`Attach`): a reset marked
	 * after it ends the press the handle hears next, also one still on its way when the mark was
	 * made (see `EmitReleased`)
	 */
	private _releasedAt = 0;
	/** How many presses and releases the handle has passed on: each edge's number (`GestureEdges`) */
	private _edges = 0;

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
		// A reset marked on `action` before is no part of the presses the handle hears from it: one
		// another root handle's press on the server's copy had before the swap ended with it
		this._releasedAt = NextSequence();
		const stateChanged = this._stateChanged;
		// An event still on its way from an instance the handle left is not passed on, nor one
		// repeating what the listeners have
		this._forwards.push(
			action.StateChanged.Connect((value) => {
				if (this.Instance !== action) return;
				if (this._stateKnown && value === this._shownState) return;
				this._shownState = value;
				this._stateKnown = true;
				stateChanged.Fire(value);
			}),
		);
		if (this._pressed !== undefined && this._released !== undefined) {
			this._forwards.push(
				action.Pressed.Connect(() => {
					if (this.Instance !== action || this._lastEdge === "Pressed") return;
					this.EmitPressed();
				}),
			);
			this._forwards.push(
				action.Released.Connect(() => {
					if (this.Instance !== action || this._lastEdge === "Released") return;
					this.EmitReleased();
				}),
			);
		}
	}

	/**
	 * Tells the listeners and the gestures of a press. Counted here, from the IAS signal (or the swap):
	 * a forward would land one deferral later
	 */
	private EmitPressed() {
		const track = this._track;
		if (track !== undefined) track.PressedCount++;
		this._shownPressed = true;
		this._lastEdge = "Pressed";
		const now = os.clock();
		const edge = ++this._edges;
		this._pressed?.Fire();
		this._gestureEdges?.Fire(edge, true, now, false);
	}

	/**
	 * Tells the listeners and the gestures of a release. Whether it is a reset's (no player's) is
	 * worked out once, here, as it arrives, and every gesture gets that answer. One rule: the package
	 * reset the action while IAS showed it pressed, after the handle's previous release (`MarkReset`,
	 * `ResetSince`); every reset the package makes is marked so, its disables included. Whether the
	 * action is live as the release arrives doesn't count (hunt HF3-1, HF3-2: a context turned off
	 * once the action was at rest, by a tap's callback or in the release's frame, made the player's
	 * release a reset's for the handles it reached later). After the previous release, not after this
	 * press arrived: under Deferred signals a press and a reset in one frame mark the reset before the
	 * press reaches the handle (hunt HF2-1). What IAS shows when the reset is made decides, so a reset
	 * made after the player let go, before IAS shows the release (a key's `InputEnded` handler, a
	 * Server Authority copy within the simulation step after the release), takes the player's
	 * release for the reset's (HF3-3, HF3-6), and so does a release of the player's and a new press
	 * both still on their way when the reset comes (all in one frame), the reset's then taken for the
	 * player's: IAS doesn't tell how many edges are on their way. `Enabled` written around the
	 * package marks nothing. A release that arrives with IAS showing the action pressed again leaves
	 * the marks for the next one (IAS's own press after a reset, on the server's copy).
	 * `reset`: the swap's release (`FinishLink`), a reset whatever the marks say
	 */
	private EmitReleased(reset = false) {
		const track = this._track;
		if (track !== undefined) track.ReleasedCount++;
		this._shownPressed = false;
		this._lastEdge = "Released";
		const now = os.clock();
		reset ||= ResetSince(this.Instance, this._releasedAt);
		// Before the listeners run: a reset one of them makes ends the next press, not this one. Only
		// a release that finds the action at rest uses the marks up: one that finds IAS pressing it
		// again (on the server's copy a rebind or an added binding presses the client's state again,
		// until the package's pair releases it on both sides) leaves them for the release of that
		// press, also the reset's (the features hunt's round 3 saw release, press, release there)
		if (this.Instance.GetState() !== true) this._releasedAt = NextSequence();
		const edge = ++this._edges;
		this._released?.Fire();
		this._gestureEdges?.Fire(edge, false, now, reset);
	}

	/**
	 * The gestures' own signal, made with the first gesture: `(edge, pressed, at, reset)` for each
	 * press (`reset` false) and release the listeners hear: its number (`EdgeCount`), when it arrived
	 * (`os.clock`), and whether a release is a reset's (see `EmitReleased`)
	 */
	GestureEdges(): RBXScriptSignal<GestureEdge> {
		let edges = this._gestureEdges;
		if (edges === undefined) {
			edges = new Instance("BindableEvent");
			this._gestureEdges = edges;
		}
		return edges.Event as RBXScriptSignal<GestureEdge>;
	}

	/**
	 * How many presses and releases the handle has passed on so far: a gesture made now ignores
	 * those, also one still being delivered (a gesture made in a `Pressed` listener under Immediate
	 * signals starts with the next press)
	 */
	EdgeCount() {
		return this._edges;
	}

	/**
	 * Points the handle at the server's copy of its action once `MoveBindings` moved the bindings
	 * there (Server Authority swap). The stand-in sends no more events, including those still on
	 * their way. Runs no listener: `FinishLink` tells them, once every handle on the stand-in is on
	 * the copy and linked (hunt HL2-2). From here what the listeners were last told (or the state
	 * when the handle was made) is theirs: the copy's events repeating it are dropped, also those
	 * a `ContextState.Join` causes before `FinishLink` (hunt HL3-3).
	 */
	LinkTo(target: InputAction, moved: ReadonlyMap<InputBinding, InputBinding>) {
		for (const [, handle] of pairs(this.Bindings)) {
			handle.Retarget(moved.get(handle.Instance) ?? handle.Instance);
			// A device's extra bindings (0.7.0) hang off its main binding's handle
			if (!(handle instanceof BindingHandle)) continue;
			for (const [, extra] of pairs(handle.Extras())) {
				extra.Retarget(moved.get(extra.Instance) ?? extra.Instance);
			}
		}
		if (this._scriptBinding !== undefined) {
			this._scriptBinding = moved.get(this._scriptBinding) ?? this._scriptBinding;
		}
		this.Attach(target);
		this._stateKnown = true;
		if (this.Type === Enum.InputActionType.Bool)
			this._lastEdge ??= this._shownPressed ? "Pressed" : "Released";
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
			this._stateKnown = true;
			this._stateChanged.Fire(state);
			if (this._runtime.IsDestroyed()) return;
		}
		const pressed = state === true;
		if (this.Type !== Enum.InputActionType.Bool || pressed === this._shownPressed) return;
		// The swap's release, no player's: it ends a gesture without completing it. Told to this
		// handle alone: a mark on the copy, which shows the action at rest, would reach the other
		// root handles on it
		if (pressed) this.EmitPressed();
		else this.EmitReleased(true);
	}

	/** Destroys the handle's own signals, and stops its gestures */
	Destroy() {
		for (const stop of [...this._gestures]) stop();
		const labels = new Array<InputActionLabel>();
		for (const [label] of this._labels) labels.push(label);
		for (const label of labels) this.DetachLabel(label);
		for (const connection of this._forwards) connection.Disconnect();
		this._forwards.clear();
		this._stateChanged.Destroy();
		this._pressed?.Destroy();
		this._released?.Destroy();
		this._gestureEdges?.Destroy();
	}

	IsTracked() {
		return this._track !== undefined;
	}

	GetState(): unknown {
		return this.Instance.GetState();
	}

	Fire(value: unknown) {
		if (this._runtime.IsDestroyed()) return;
		let binding = this._scriptBinding;
		if (binding === undefined || binding.Parent !== this.Instance) {
			// The first Fire adds <Action>Script: added to a held action, it makes IAS reset it, and
			// on the server's copy the action then stays held after its key comes up, whatever this
			// Fire writes (a value at rest changes nothing on a binding just made): let go of then
			binding = AddingBindings(this.Instance, () => this.GetScriptBinding());
			// Under Immediate signals that ran listeners, and one may have destroyed the root handle
			if (this._runtime.IsDestroyed()) return;
		}
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

	/**
	 * The binding of `device` (by default the one the player uses) as text: its main binding's
	 * `Describe` (see `IActionHandle.Describe`)
	 */
	Describe(device: Device = PreferredDevice()): string {
		if (!IsDevice(device)) {
			error(
				`InputActions: ${this.Name}: Describe takes a device (KeyboardAndMouse, Gamepad, Touch), not ${tostring(device)}`,
				2,
			);
		}
		const binding = this.Bindings[device];
		return binding instanceof BindingHandle ? binding.Describe() : "";
	}

	// ---- gestures (Bool actions; see `Gestures.ts`)

	IsDestroyed() {
		return this._runtime.IsDestroyed();
	}

	AddGesture(stop: () => void) {
		this._gestures.add(stop);
	}

	RemoveGesture(stop: () => void) {
		this._gestures.delete(stop);
	}

	/** The handle as a gesture's source: a Bool action's (the types hide the gestures on the others) */
	private GestureSource(method: string): IGestureSource {
		if (this.Pressed === undefined) {
			error(`InputActions: ${this.Name}: ${method} needs a Bool action, not ${this.Type.Name}`, 3);
		}
		return this as unknown as IGestureSource;
	}

	OnTap(callback: () => void, options?: ITapOptions): () => void {
		return OnTap(this.GestureSource("OnTap"), callback, options);
	}

	OnDoubleTap(callback: () => void, options?: IDoubleTapOptions): () => void {
		return OnDoubleTap(this.GestureSource("OnDoubleTap"), callback, options);
	}

	OnHold(callback: () => void, options: IHoldOptions): () => void {
		return OnHold(this.GestureSource("OnHold"), callback, options);
	}

	OnLongPress(callback: (heldFor: number) => void, options: ILongPressOptions): () => void {
		return OnLongPress(this.GestureSource("OnLongPress"), callback, options);
	}

	/** The handle of a device's binding (every action has the three), when it is one with keys */
	private DeviceBinding(device: CapturableDevice): BindingHandle | undefined {
		const handle = this.Bindings[device];
		return handle instanceof BindingHandle ? handle : undefined;
	}

	/** Bool and Direction1D actions only (the types hide it on the others) */
	private CheckCapture(method: string) {
		if (CHORD_TYPES.has(this.Type.Name)) return;
		error(
			`InputActions: ${this.Name}: ${method} on an action needs a Bool or Direction1D action, not ` +
				`${this.Type.Name}; capture a slot of one of its bindings instead`,
			3,
		);
	}

	/**
	 * Waits for the next key a keyboard-and-mouse or gamepad binding of this action can hold in its
	 * `KeyCode`: the key's device picks the binding, which becomes that key alone, its modifiers
	 * cleared as by a one-key chord (see `IActionCapture.Capture`; hunt HD2-4). Touch input is
	 * ignored, as is a key no binding of its device can take. A `Cancel` key calls back with
	 * `undefined` twice, as `CaptureChord` does.
	 */
	Capture(
		callback: (key: Enum.KeyCode | undefined, device: CapturableDevice | undefined) => void,
		options?: ICaptureOptions,
	): () => void {
		this.CheckCapture("Capture");
		if (this._runtime.IsDestroyed()) return () => {};
		const actionType = this.Type.Name;
		return CaptureKey(
			this._runtime,
			(key) => {
				const device = GetKeyDevice(key);
				if (device === "Touch") return undefined;
				const binding = this.DeviceBinding(device);
				const captured = CapturedKey(actionType, "KeyCode", key, device);
				if (binding === undefined || captured === undefined) return undefined;
				return { Binding: binding, Slot: "KeyCode", Key: captured };
			},
			(target) => {
				target.Binding.ApplyChord({ KeyCode: target.Key });
				callback(target.Key, target.Binding.Name as CapturableDevice);
			},
			// A `Cancel` key: nothing applied
			() => callback(undefined, undefined),
			options?.Cancel ?? [],
		);
	}

	/**
	 * Waits for a chord of the keyboard and mouse or of the gamepad, whichever's key goes down first,
	 * and gives it to that device's binding (see `IActionCapture.CaptureChord`)
	 */
	CaptureChord(
		callback: (chord: IChord | undefined, device: CapturableDevice | undefined) => void,
		options?: IChordCaptureOptions,
	): () => void {
		this.CheckCapture("CaptureChord");
		const timeout = options?.Timeout;
		if (timeout !== undefined && !IsValidTimeout(timeout)) {
			error(
				`InputActions: ${this.Name}: CaptureChord's Timeout must be a positive number of seconds`,
				2,
			);
		}
		if (this._runtime.IsDestroyed()) return () => {};
		const devices = new Array<CapturableDevice>();
		for (const device of ["KeyboardAndMouse", "Gamepad"] as const) {
			if (this.DeviceBinding(device) !== undefined) devices.push(device);
		}
		return CaptureChord(
			this._runtime,
			this.Type.Name,
			devices,
			(chord, device) => {
				if (chord === undefined || device === undefined) return callback(undefined, undefined);
				this.DeviceBinding(device)!.ApplyChord(chord);
				callback(chord, device);
			},
			options?.Cancel ?? [],
			timeout,
		);
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
		this._runtime.TrackCreated(binding);
		this._buttons.add(binding);
		// Added to a held action, it makes IAS reset it: let go of then (hunts HL4-4, HL4-5)
		const action = this.Instance;
		AddingBindings(action, () => {
			binding.Parent = action;
		});
		// Under Immediate signals that ran listeners, and one may have destroyed the root handle
		if (this._runtime.IsDestroyed()) return () => {};

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
		MarkReset(action);
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
	 * held binding that is destroyed leaves the action stuck on (probed): when bindings that go with
	 * this root handle (its buttons, its own slots, a template's bindings it cloned) go while the
	 * action is not at rest and nothing another handle fired holds it, the action is released (hunt
	 * HL3-2). A value another handle fired holds it only while the action shows the latest one they
	 * fired: a key or a button that wrote after it holds the action instead, and would leave it at
	 * its value (hunt HL4-1). IAS doesn't tell which binding holds the action, so that also lets go
	 * of a key held through another handle's. On a copy under the player in a place that runs Server
	 * Authority a same-frame pair on `<Action>Script` releases it, on both sides. Anywhere else IAS
	 * would answer a pair on a binding made then with a release and a press of its own (adding a
	 * binding to a held action resets it, hunt HL4-3), so the caller resets the action (`Enabled`
	 * toggled) once the bindings are gone, as for an action no other handle uses: nothing another
	 * handle fired holds it then.
	 * @returns whether the action is to be reset once this root handle's bindings are gone
	 */
	ReleaseOwn(): boolean {
		const action = this.Instance;
		const live = IsLive(action);
		const state = action.GetState();
		let latest: InputBinding | undefined;
		let latestOrder = 0;
		const own = new Array<[InputBinding, IHeldValue]>();
		/** The latest value another live root handle fired and still holds */
		let others: IHeldValue | undefined;
		for (const child of action.GetChildren()) {
			if (!child.IsA("InputBinding")) continue;
			const held = GetHeldValue(child);
			if (held === undefined) continue;
			if (held.Order > latestOrder) {
				latest = child;
				latestOrder = held.Order;
			}
			if (held.Holders.has(this._runtime)) {
				held.Holders.delete(this._runtime);
				if (held.Holders.size() === 0) {
					own.push([child, held]);
					continue;
				}
			} else if (held.Holders.size() === 0) continue;
			if (others === undefined || held.Order > others.Order) others = held;
		}
		for (const [binding, held] of own) {
			// Left in place otherwise, holding no one's value: IAS keeps it for the binding, and a later
			// Fire of the same value on it changes nothing (a shared `<Action>Script`)
			if (binding !== latest) continue;
			ClearHeldValue(binding);
			if (!live || (state !== held.Value && state !== this._neutral)) continue;
			// A release the package makes: the other root handles' gestures take it for no player's
			if (state !== this._neutral) MarkReset(action);
			pcall(() => binding.Fire(this._neutral));
		}
		if (!live || !this.LosesHoldingBinding()) return false;
		const now = action.GetState();
		if (now === this._neutral || (others !== undefined && others.Value === now)) return false;
		// The caller resets it (`ResetIfHeld`, which notes it too) once the bindings are gone
		if (!IsServerAuthorityCopy(action)) return true;
		// The pair releases it on both sides: no player's release either (hunt HF-1)
		MarkReset(action);
		const binding = this.GetScriptBinding();
		pcall(() => {
			binding.Fire(now);
			binding.Fire(this._neutral);
		});
		return false;
	}

	/**
	 * Whether a binding that a key or a button can hold the action through goes with this root
	 * handle's `Destroy`. A Scriptable one holds only what the package fired, which `ReleaseOwn`
	 * lets go of already.
	 */
	private LosesHoldingBinding(): boolean {
		for (const child of this.Instance.GetChildren()) {
			if (
				child.IsA("InputBinding") &&
				child.Type !== Enum.InputBindingType.Scriptable &&
				this._runtime.GoesWithRoot(child)
			)
				return true;
		}
		return false;
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
