import {
	ActionTypeName,
	CheckBindingSpec,
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
import { CaptureChord, CaptureKey, CapturedKey, CHORD_TYPES, IsValidTimeout } from "../Capture";
import { DescribeBinding } from "../Describe";
import { IRuntime, IsLive } from "../Internal";
import { CapturableDevice, Device, EKeyGroup, GetKeyGroup } from "../KeyGroups";
import { ClearHeldValue, GetEntry, SetHeldValue } from "../Registry";
import type { ICaptureOptions, IChord, IChordCaptureOptions } from "../Types";

/**
 * A device's binding of an action (`KeyboardAndMouse`, `Gamepad`, `Touch`): rebindable, saved by
 * ExportBindings, and holding only that device's keys. A device's main binding carries its extra
 * bindings (0.7.0), each a handle of its own, as properties named after them: every member here is
 * a name an extra can't take (`BINDING_HANDLE_MEMBERS`)
 */
export class BindingHandle {
	/** The InputBinding the handle wraps now (a Server Authority swap may point it at another) */
	Instance: InputBinding;
	/** The device, which is the binding's name in the schema; an extra's device too */
	readonly Name: Device;

	/** The device's extra bindings, by name, on its main binding's handle */
	private readonly _extras: Record<string, BindingHandle> = {};

	constructor(
		private readonly _runtime: IRuntime,
		binding: InputBinding,
		readonly Path: string,
		readonly ActionType: ActionTypeName,
		device: Device,
		/** The binding right after `Create`, shared by every root handle on the same instance */
		private _defaults: IBindingValues,
	) {
		this.Instance = binding;
		this.Name = device;
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

	/** The device's extra bindings the schema declares, by name; none on an extra */
	Extras(): Readonly<Record<string, BindingHandle>> {
		return this._extras;
	}

	/**
	 * Hangs an extra binding of the device off this, its main binding's handle, by its name (which
	 * `Schema` checked: no member of this class)
	 */
	AddExtra(name: string, extra: BindingHandle) {
		this._extras[name] = extra;
		(this as unknown as Record<string, unknown>)[name] = extra;
	}

	Get() {
		return GetBindingData(this.ActionType, this.Instance);
	}

	/** The binding as text (see `IBindingHandle.Describe`) */
	Describe(): string {
		return DescribeBinding(this.ActionType, this.Instance);
	}

	Set(spec: unknown) {
		// An object merges into the binding: a ResponseCurve is checked against the KeyCode after it
		const problem = CheckBindingSpec(this.ActionType, spec, this.Name, this.Instance.KeyCode);
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

	/** The device of a binding that can capture: touch has no keys to press (the types hide them) */
	private CapturableDevice(method: string): CapturableDevice {
		const device = this.Name;
		if (device === "Touch") {
			error(
				`InputActions: ${this.Path}: a Touch binding has nothing to ${method}: touch has no keys ` +
					"to press. Give it a touch key with Set",
				3,
			);
		}
		return device;
	}

	/**
	 * Waits for the next key of this binding's device that `slot` can take (see
	 * `ICaptureBindingHandle.Capture`); other devices' keys are ignored, and a `Cancel` key counts
	 * from any device
	 */
	Capture(
		slot: string,
		callback: (key: Enum.KeyCode | undefined) => void,
		options?: ICaptureOptions,
	): () => void {
		const device = this.CapturableDevice("Capture");
		if (!IsSlotOf(this.ActionType, slot)) {
			error(`InputActions: ${this.Path}: ${slot} is not a slot of a ${this.ActionType} binding`, 2);
		}
		if (this._runtime.IsDestroyed()) return () => {};
		return CaptureKey(
			this._runtime,
			(key) => {
				const captured = CapturedKey(this.ActionType, slot, key, device);
				return captured !== undefined ? { Binding: this, Slot: slot, Key: captured } : undefined;
			},
			(target) => {
				this.ApplyCapturedKey(target.Slot, target.Key);
				callback(target.Key);
			},
			// A `Cancel` key: nothing applied
			() => callback(undefined),
			options?.Cancel ?? [],
		);
	}

	/**
	 * Waits for a chord of this binding's device (see `IChordBindingHandle.CaptureChord` and
	 * `Capture.ts`'s `CaptureChord`); other devices' keys are ignored
	 */
	CaptureChord(
		callback: (chord: IChord | undefined) => void,
		options?: IChordCaptureOptions,
	): () => void {
		const device = this.CapturableDevice("CaptureChord");
		if (!CHORD_TYPES.has(this.ActionType)) {
			error(
				`InputActions: ${this.Path}: CaptureChord needs a Bool or Direction1D binding, not ${this.ActionType}`,
				2,
			);
		}
		const timeout = options?.Timeout;
		if (timeout !== undefined && !IsValidTimeout(timeout)) {
			error(
				`InputActions: ${this.Path}: CaptureChord's Timeout must be a positive number of seconds`,
				2,
			);
		}
		if (this._runtime.IsDestroyed()) return () => {};
		return CaptureChord(
			this._runtime,
			this.ActionType,
			[device],
			(chord) => {
				if (chord !== undefined) this.ApplyChord(chord);
				callback(chord);
			},
			options?.Cancel ?? [],
			timeout,
		);
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
