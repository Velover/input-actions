import { RunService, UserInputService } from "@rbxts/services";
import {
	ActionTypeName,
	CheckBindingSpec,
	IsKeyAllowed,
	IsPropertyOf,
	IsSlotOf,
	SAVED_PROPERTIES,
} from "../BindingRules";
import {
	ApplySpec,
	ClearKeys,
	EReleasedThreshold,
	EncodeSavedValue,
	GetBindingData,
	IBindingValues,
	IsSavableValue,
	ReadBinding,
	SpecReleasedThreshold,
	WriteBindings,
	WriteKey,
} from "../BindingState";
import { IRuntime, IsLive } from "../Internal";
import { EKeyGroup, GetKeyGroup } from "../KeyGroups";
import { ClearHeldValue, GetEntry, SetHeldValue } from "../Registry";
import type { ICaptureOptions, IChord, IChordCaptureOptions } from "../Types";

const MOUSE_BUTTON_KEYS = new Map<Enum.UserInputType, Enum.KeyCode>([
	[Enum.UserInputType.MouseButton1, Enum.KeyCode.MouseLeftButton],
	[Enum.UserInputType.MouseButton2, Enum.KeyCode.MouseRightButton],
	[Enum.UserInputType.MouseButton3, Enum.KeyCode.MouseMiddleButton],
	[Enum.UserInputType.Touch, Enum.KeyCode.TouchPosition],
]);

/** The IAS key an InputBegan input stands for: its KeyCode, or the mouse button / touch key */
export function KeyFromInput(
	keyCode: Enum.KeyCode,
	inputType: Enum.UserInputType,
): Enum.KeyCode | undefined {
	if (keyCode !== Enum.KeyCode.None) return keyCode;
	return MOUSE_BUTTON_KEYS.get(inputType);
}

export const enum ECaptureDecision {
	Ignore,
	Accept,
	Cancel,
}

/** What a capture does with one pressed key */
export function DecideCapture(
	actionType: ActionTypeName,
	slot: string,
	key: Enum.KeyCode,
	cancelKeys: readonly Enum.KeyCode[],
): ECaptureDecision {
	if (cancelKeys.includes(key)) return ECaptureDecision.Cancel;
	return IsKeyAllowed(actionType, slot, key) ? ECaptureDecision.Accept : ECaptureDecision.Ignore;
}

/**
 * How long after a TextBox loses focus input still counts as typing: what ends the typing (Return,
 * Escape, a click away) comes once the focus is gone (hunts HC2-3, HC3-1)
 */
const TYPING_GRACE = 0.1;
let focusWatch: RBXScriptConnection | undefined;
let focusReleasedAt = -math.huge;

/** Follows TextBox focus releases for `IsTyping`, from the first capture on */
function WatchTextBoxFocus() {
	focusWatch ??= UserInputService.TextBoxFocusReleased.Connect(() => {
		focusReleasedAt = os.clock();
	});
}

/** The keys of mouse buttons and touch: a click or tap */
const POINTER_BUTTON_KEYS = new ReadonlySet<Enum.KeyCode>([
	Enum.KeyCode.MouseLeftButton,
	Enum.KeyCode.MouseRightButton,
	Enum.KeyCode.MouseMiddleButton,
	Enum.KeyCode.TouchPosition,
]);

/**
 * Whether an input that began is typing, or what ends it: anything while a TextBox has focus; in the
 * moment after it lets go, what the game processed (Return, Escape) and a click or tap (a click
 * away). Other keys count again at once, so a key pressed right after a submit isn't lost
 */
function IsTyping(key: Enum.KeyCode, gameProcessed: boolean): boolean {
	if (UserInputService.GetFocusedTextBox() !== undefined) return true;
	if (os.clock() - focusReleasedAt >= TYPING_GRACE) return false;
	return gameProcessed || POINTER_BUTTON_KEYS.has(key);
}

/** What a capture makes of a key that began */
export const enum ECaptureInput {
	/** Typing in a TextBox, and what ends it: no part of the capture */
	Ignore,
	/** A Cancel key: ends the capture */
	Cancel,
	/**
	 * A key the game took (a GUI click, a key a ContextActionService binding sinks, such as an
	 * InputCatcher's): a CAS sink blocks IAS for it, so a binding couldn't use it, nor a chord with it
	 */
	Taken,
	/** A key the capture counts */
	Count,
}

/**
 * What a capture makes of a key that began: typing, and the key or click that ends it (which the
 * game may not have processed: a click away from the TextBox), is no part of it; a Cancel key ends
 * it, also when the game took it (an InputCatcher, any CAS sink), so the player can always back out;
 * any other key the game took is the game's
 */
export function ClassifyCaptureInput(
	key: Enum.KeyCode,
	gameProcessed: boolean,
	cancelKeys: readonly Enum.KeyCode[],
): ECaptureInput {
	if (IsTyping(key, gameProcessed)) return ECaptureInput.Ignore;
	if (cancelKeys.includes(key)) return ECaptureInput.Cancel;
	return gameProcessed ? ECaptureInput.Taken : ECaptureInput.Count;
}

/**
 * The keys down as a capture starts: keyboard keys (VirtualInput's gamepad KeyCodes among them),
 * mouse buttons and gamepad buttons. Their InputBegan may still be on its way (a ContextActionService
 * action that starts a capture runs before InputBegan fires; deferred signals), and must not count:
 * the press that started a capture is no part of it (hunt HC2-2). A finger down reads as mouse button
 * 1 and arrives as `TouchPosition`, so mouse button 1 stands for both (hunt HC3-2)
 */
function KeysDownNow(): Set<Enum.KeyCode> {
	const keys = new Set<Enum.KeyCode>();
	for (const input of UserInputService.GetKeysPressed()) keys.add(input.KeyCode);
	for (const [inputType, key] of MOUSE_BUTTON_KEYS) {
		if (inputType !== Enum.UserInputType.Touch && UserInputService.IsMouseButtonPressed(inputType))
			keys.add(key);
	}
	if (keys.has(Enum.KeyCode.MouseLeftButton)) keys.add(Enum.KeyCode.TouchPosition);
	for (const gamepad of UserInputService.GetConnectedGamepads()) {
		for (const input of UserInputService.GetGamepadState(gamepad)) {
			if (input.UserInputState === Enum.UserInputState.Begin) keys.add(input.KeyCode);
		}
	}
	return keys;
}

/** The two keys one pointer stands for: a mouse's button 1, or a finger, which reads as it */
const POINTER_KEYS: readonly Enum.KeyCode[] = [
	Enum.KeyCode.MouseLeftButton,
	Enum.KeyCode.TouchPosition,
];

/**
 * Forgets a key among those down when a capture started, once it has come up (a pointer's two keys
 * together). True when it was one of them: its release is no part of the capture either
 */
function ReleaseDownAtStart(down: Set<Enum.KeyCode>, key: Enum.KeyCode): boolean {
	if (!POINTER_KEYS.includes(key)) return down.delete(key);
	let was = false;
	for (const pointer of POINTER_KEYS) if (down.delete(pointer)) was = true;
	return was;
}

/**
 * The keys down as a capture starts, which it leaves alone until they come up. A pointer key among
 * them stands only for a press whose InputBegan arrives before the next Heartbeat (the press that
 * started the capture, still on its way): mouse button 1, which also stands for a finger, still
 * reads pressed a frame after a finger lifts (measured on the simulated phone, 2026-10-02), so a
 * pointer press after that is a new click or tap
 */
class DownAtStart {
	private readonly _keys = KeysDownNow();
	private _startFrame = true;

	constructor() {
		RunService.Heartbeat.Once(() => (this._startFrame = false));
	}

	/** Whether an InputBegan of `key` is a press that was down already when the capture started */
	Began(key: Enum.KeyCode): boolean {
		if (!this._keys.has(key)) return false;
		if (this._startFrame || !POINTER_KEYS.includes(key)) return true;
		ReleaseDownAtStart(this._keys, key);
		return false;
	}

	/** Forgets `key` once it is up; true when it was down already when the capture started */
	Ended(key: Enum.KeyCode): boolean {
		return ReleaseDownAtStart(this._keys, key);
	}
}

/** The action types `CaptureChord` works on: their `KeyCode` takes keys that can be pressed */
const CHORD_TYPES = new ReadonlySet<ActionTypeName>(["Bool", "Direction1D"]);

/**
 * The chord keys held together make, in the order they went down: the last is the `KeyCode`, the
 * ones before it the modifiers. Undefined when a binding of this action type can't hold it: more
 * than three keys, a `KeyCode` the type can't use, or a modifier that isn't a Button key
 */
export function ChordFromKeys(
	actionType: ActionTypeName,
	keys: readonly Enum.KeyCode[],
): IChord | undefined {
	const count = keys.size();
	if (count === 0 || count > 3) return undefined;
	const key = keys[count - 1];
	if (!IsKeyAllowed(actionType, "KeyCode", key)) return undefined;
	const primary = count >= 2 ? keys[0] : undefined;
	const secondary = count === 3 ? keys[1] : undefined;
	if (primary !== undefined && !IsKeyAllowed(actionType, "PrimaryModifier", primary))
		return undefined;
	if (secondary !== undefined && !IsKeyAllowed(actionType, "SecondaryModifier", secondary))
		return undefined;
	return { KeyCode: key, PrimaryModifier: primary, SecondaryModifier: secondary };
}

/** A binding that holds keys: rebindable, saved by ExportBindings */
export class BindingHandle {
	/** The InputBinding the handle wraps now (a Server Authority swap may point it at another) */
	Instance: InputBinding;
	readonly Name: string;

	constructor(
		private readonly _runtime: IRuntime,
		binding: InputBinding,
		readonly Path: string,
		readonly ActionType: ActionTypeName,
		name: string,
		/** The binding right after `Create`, shared by every root handle on the same instance */
		private _defaults: IBindingValues,
	) {
		this.Instance = binding;
		this.Name = name;
	}

	/**
	 * Points the handle at the binding that stands for its own on the server's copy (Server
	 * Authority swap). One another root handle made there has that handle's defaults, which every
	 * handle on it shares.
	 */
	Retarget(binding: InputBinding) {
		if (binding === this.Instance) return;
		this.Instance = binding;
		this._defaults = GetEntry(binding)?.Defaults ?? this._defaults;
	}

	GetDefaults(): IBindingValues {
		return this._defaults;
	}

	Get() {
		return GetBindingData(this.ActionType, this.Instance);
	}

	Set(spec: unknown) {
		const problem = CheckBindingSpec(this.ActionType, spec);
		if (problem !== undefined) error(`InputActions: ${this.Path}: ${problem}`, 2);
		if (this._runtime.IsDestroyed()) return;
		const values = ReadBinding(this.Instance);
		ApplySpec(values, spec);
		this.Write(values, SpecReleasedThreshold(spec));
	}

	Reset() {
		if (this._runtime.IsDestroyed()) return;
		this.Write(this._defaults);
	}

	/** Unbinds: every key slot becomes `None`, modifiers included; with a slot, only that one */
	Clear(slot?: string) {
		if (slot !== undefined && !IsSlotOf(this.ActionType, slot)) {
			error(`InputActions: ${this.Path}: ${slot} is not a slot of a ${this.ActionType} binding`, 2);
		}
		if (this._runtime.IsDestroyed()) return;
		const values = ReadBinding(this.Instance);
		if (slot === undefined) ClearKeys(values, true);
		else WriteKey(values, slot, Enum.KeyCode.None);
		this.Write(values, EReleasedThreshold.Keep);
	}

	Capture(
		slot: string,
		callback: (key: Enum.KeyCode) => void,
		options?: ICaptureOptions,
	): () => void {
		if (!IsSlotOf(this.ActionType, slot)) {
			error(`InputActions: ${this.Path}: ${slot} is not a slot of a ${this.ActionType} binding`, 2);
		}
		if (this._runtime.IsDestroyed()) return () => {};
		WatchTextBoxFocus();
		const cancelKeys = options?.Cancel ?? [];
		// keys down already: their InputBegan, even one still on its way, is no part of the capture
		const downAtStart = new DownAtStart();
		let live = true;
		const connections = new Array<RBXScriptConnection>();
		const stop = () => {
			if (!live) return;
			live = false;
			for (const connection of connections) {
				connection.Disconnect();
				this._runtime.UntrackConnection(connection);
			}
		};
		connections.push(
			UserInputService.InputBegan.Connect((input, gameProcessed) => {
				if (!live) return;
				const key = KeyFromInput(input.KeyCode, input.UserInputType);
				if (key === undefined || downAtStart.Began(key)) return;
				const kind = ClassifyCaptureInput(key, gameProcessed, cancelKeys);
				if (kind === ECaptureInput.Cancel) return stop();
				if (kind !== ECaptureInput.Count) return;
				if (DecideCapture(this.ActionType, slot, key, []) !== ECaptureDecision.Accept) return;
				stop();
				this.ApplyCapturedKey(slot, key);
				callback(key);
			}),
			UserInputService.InputEnded.Connect((input) => {
				const key = KeyFromInput(input.KeyCode, input.UserInputType);
				if (key !== undefined) downAtStart.Ended(key);
			}),
		);
		for (const connection of connections) this._runtime.TrackConnection(connection);
		return stop;
	}

	/**
	 * Waits for a chord (see `IChordBindingHandle.CaptureChord`). It follows the keys that go down
	 * while it waits, in order; a key already down when it started is not among them, and its release
	 * settles nothing. The first of them to come up settles the chord: applied when the binding can
	 * hold it, else ignored, and then the next chord counts once every key of this one is up (so the
	 * release of the last leftover key of a refused chord can't settle a chord of its own). With a
	 * `Timeout`, the keys held when it runs out settle the chord the same way; when they make none the
	 * binding can hold, or none are held, the capture ends with nothing applied.
	 */
	CaptureChord(
		callback: (chord: IChord | undefined) => void,
		options?: IChordCaptureOptions,
	): () => void {
		if (!CHORD_TYPES.has(this.ActionType)) {
			error(
				`InputActions: ${this.Path}: CaptureChord needs a Bool or Direction1D binding, not ${this.ActionType}`,
				2,
			);
		}
		const timeout = options?.Timeout;
		if (
			timeout !== undefined &&
			!(typeIs(timeout, "number") && timeout > 0 && timeout < math.huge)
		) {
			error(
				`InputActions: ${this.Path}: CaptureChord's Timeout must be a positive number of seconds`,
				2,
			);
		}
		if (this._runtime.IsDestroyed()) return () => {};
		WatchTextBoxFocus();
		const cancelKeys = options?.Cancel ?? [];
		// keys down already: their InputBegan, even one still on its way, is no part of a chord
		const downAtStart = new DownAtStart();
		const held = new Array<Enum.KeyCode>();
		// the keys among `held` the game took: a chord with one can't be bound as pressed (hunt HC2-1)
		const taken = new Set<Enum.KeyCode>();
		const heldChord = () => (taken.isEmpty() ? ChordFromKeys(this.ActionType, held) : undefined);
		// false after a refused chord, until every key of it is up
		let armed = true;
		let live = true;
		const connections = new Array<RBXScriptConnection>();
		let timer: thread | undefined;
		const stop = () => {
			if (!live) return;
			live = false;
			for (const connection of connections) {
				connection.Disconnect();
				this._runtime.UntrackConnection(connection);
			}
			if (timer !== undefined && timer !== coroutine.running()) task.cancel(timer);
		};
		// Ends the capture: applies the chord the held keys make, when there is one and it may be
		// applied, and tells the callback either way
		const settle = (chord: IChord | undefined) => {
			stop();
			if (this._runtime.IsDestroyed()) return;
			if (chord !== undefined) this.ApplyChord(chord);
			callback(chord);
		};
		connections.push(
			UserInputService.InputBegan.Connect((input, gameProcessed) => {
				if (!live) return;
				const key = KeyFromInput(input.KeyCode, input.UserInputType);
				if (key === undefined || downAtStart.Began(key)) return;
				const kind = ClassifyCaptureInput(key, gameProcessed, cancelKeys);
				if (kind === ECaptureInput.Ignore) return;
				if (kind === ECaptureInput.Cancel) return settle(undefined);
				if (kind === ECaptureInput.Taken) taken.add(key);
				if (!held.includes(key)) held.push(key);
			}),
			UserInputService.InputEnded.Connect((input) => {
				if (!live) return;
				const key = KeyFromInput(input.KeyCode, input.UserInputType);
				if (key === undefined || downAtStart.Ended(key)) return;
				const index = held.indexOf(key);
				if (index === -1) return;
				if (armed) {
					const chord = heldChord();
					if (chord !== undefined) return settle(chord);
					armed = false;
				}
				held.remove(index);
				taken.delete(key);
				if (held.size() === 0) armed = true;
			}),
		);
		for (const connection of connections) this._runtime.TrackConnection(connection);
		if (timeout !== undefined) {
			timer = task.delay(timeout, () => {
				if (!live) return;
				settle(armed ? heldChord() : undefined);
			});
		}
		return stop;
	}

	/** Writes a captured chord, the modifiers it lacks as `None`, in one write (CaptureChord's last step) */
	ApplyChord(chord: IChord) {
		const values = ReadBinding(this.Instance);
		WriteKey(values, "KeyCode", chord.KeyCode);
		values.PrimaryModifier = chord.PrimaryModifier ?? Enum.KeyCode.None;
		values.SecondaryModifier = chord.SecondaryModifier ?? Enum.KeyCode.None;
		this.Write(values, EReleasedThreshold.Keep);
	}

	/** Writes a captured key into a slot and reports the change (Capture's last step) */
	ApplyCapturedKey(slot: string, key: Enum.KeyCode) {
		const values = ReadBinding(this.Instance);
		WriteKey(values, slot, key);
		this.Write(values, EReleasedThreshold.Keep);
	}

	/**
	 * Gives the binding these values and reports it. Only what differs is written, and an action
	 * held when its keys change is released (see `WriteBindings`)
	 * @param releasedThreshold what is done with `ReleasedThreshold` (see `EReleasedThreshold`):
	 * `Reset` gives the binding the defaults' reading
	 */
	private Write(values: IBindingValues, releasedThreshold = EReleasedThreshold.Read) {
		WriteBindings([[this.Instance, values, releasedThreshold]]);
		this._runtime.NotifyBindingChanged(this.Path);
	}

	/** The saved properties that differ from the defaults, as JSON values; undefined when none do */
	ExportChanges(): Record<string, unknown> | undefined {
		const current = ReadBinding(this.Instance);
		// ResponseCurve only acts on a thumbstick; saved beside another key, the import would refuse it
		const stick = GetKeyGroup(current.KeyCode) === EKeyGroup.Stick;
		let changes: Record<string, unknown> | undefined;
		for (const name of SAVED_PROPERTIES) {
			if (!IsPropertyOf(this.ActionType, name)) continue;
			if (name === "ResponseCurve" && !stick) continue;
			if (current[name] !== this._defaults[name] && IsSavableValue(current[name])) {
				changes ??= {};
				changes[name] = EncodeSavedValue(current[name]);
			}
		}
		return changes;
	}
}

/** A binding declared `InputActions.Scriptable`: driven only by `Fire` */
export class ScriptableBindingHandle {
	/** The InputBinding the handle wraps now (a Server Authority swap may point it at another) */
	Instance: InputBinding;
	readonly Name: string;

	constructor(
		private readonly _runtime: IRuntime,
		binding: InputBinding,
		name: string,
		private readonly _neutral: unknown,
	) {
		this.Instance = binding;
		this.Name = name;
	}

	/** Points the handle at the binding that stands for its own on the server's copy */
	Retarget(binding: InputBinding) {
		this.Instance = binding;
	}

	Fire(value: unknown) {
		if (this._runtime.IsDestroyed()) return;
		const binding = this.Instance;
		binding.Fire(value);
		const action = binding.Parent;
		// IAS ignores a Fire on a disabled action or context: nothing is held then
		if (action !== undefined && action.IsA("InputAction") && IsLive(action))
			SetHeldValue(binding, value, this._neutral, this._runtime);
		else ClearHeldValue(binding);
	}
}
