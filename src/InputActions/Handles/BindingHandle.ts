import { UserInputService } from "@rbxts/services";
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
 * Whether a capture hears a key that began. Input the game took (a GUI click, typing, a key a
 * ContextActionService binding sinks, such as an InputCatcher's) is left to the game: an IAS binding
 * couldn't use such a key either. A Cancel key is heard all the same, so the player can always back
 * out, except while a TextBox has focus, where it is typing.
 */
export function CaptureHears(
	key: Enum.KeyCode,
	gameProcessed: boolean,
	cancelKeys: readonly Enum.KeyCode[],
): boolean {
	if (!gameProcessed) return true;
	return cancelKeys.includes(key) && UserInputService.GetFocusedTextBox() === undefined;
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
		const cancelKeys = options?.Cancel ?? [];
		let connection: RBXScriptConnection | undefined;
		const stop = () => {
			if (connection === undefined) return;
			connection.Disconnect();
			this._runtime.UntrackConnection(connection);
			connection = undefined;
		};
		connection = UserInputService.InputBegan.Connect((input, gameProcessed) => {
			if (connection === undefined) return;
			const key = KeyFromInput(input.KeyCode, input.UserInputType);
			if (key === undefined || !CaptureHears(key, gameProcessed, cancelKeys)) return;
			const decision = DecideCapture(this.ActionType, slot, key, cancelKeys);
			if (decision === ECaptureDecision.Ignore) return;
			stop();
			if (decision === ECaptureDecision.Cancel) return;
			this.ApplyCapturedKey(slot, key);
			callback(key);
		});
		this._runtime.TrackConnection(connection);
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
		const cancelKeys = options?.Cancel ?? [];
		const held = new Array<Enum.KeyCode>();
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
				if (key === undefined || !CaptureHears(key, gameProcessed, cancelKeys)) return;
				if (cancelKeys.includes(key)) return settle(undefined);
				if (!held.includes(key)) held.push(key);
			}),
			UserInputService.InputEnded.Connect((input) => {
				if (!live) return;
				const key = KeyFromInput(input.KeyCode, input.UserInputType);
				if (key === undefined) return;
				const index = held.indexOf(key);
				if (index === -1) return;
				if (armed) {
					const chord = ChordFromKeys(this.ActionType, held);
					if (chord !== undefined) return settle(chord);
					armed = false;
				}
				held.remove(index);
				if (held.size() === 0) armed = true;
			}),
		);
		for (const connection of connections) this._runtime.TrackConnection(connection);
		if (timeout !== undefined) {
			timer = task.delay(timeout, () => {
				if (!live) return;
				settle(armed ? ChordFromKeys(this.ActionType, held) : undefined);
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
