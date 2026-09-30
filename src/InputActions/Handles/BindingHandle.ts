import { UserInputService } from "@rbxts/services";
import {
	ActionTypeName,
	CheckBindingSpec,
	IsKeyAllowed,
	IsPropertyOf,
	IsSlotOf,
	SAVED_PROPERTIES,
	SavedProperty,
	SavedValue,
} from "../BindingRules";
import {
	ApplySaved,
	ApplySpec,
	ClearKeys,
	EncodeSavedValue,
	GetBindingData,
	IBindingValues,
	IsSavableValue,
	ReadBinding,
	WriteBinding,
	WriteKey,
} from "../BindingState";
import { IRuntime, IsLive } from "../Internal";
import { EKeyGroup, GetKeyGroup } from "../KeyGroups";
import { ClearHeldValue, GetEntry, SetHeldValue } from "../Registry";
import type { ICaptureOptions } from "../Types";

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
		ApplySpec(this.Instance, spec);
		this._runtime.NotifyBindingChanged(this.Path);
	}

	Reset() {
		if (this._runtime.IsDestroyed()) return;
		this.ResetQuietly();
		this._runtime.NotifyBindingChanged(this.Path);
	}

	/** Unbinds: every key slot becomes `None`, modifiers included; with a slot, only that one */
	Clear(slot?: string) {
		if (slot !== undefined && !IsSlotOf(this.ActionType, slot)) {
			error(`InputActions: ${this.Path}: ${slot} is not a slot of a ${this.ActionType} binding`, 2);
		}
		if (this._runtime.IsDestroyed()) return;
		if (slot === undefined) ClearKeys(this.Instance, true);
		else WriteKey(this.Instance, slot, Enum.KeyCode.None);
		this._runtime.NotifyBindingChanged(this.Path);
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
			if (gameProcessed || connection === undefined) return;
			const key = KeyFromInput(input.KeyCode, input.UserInputType);
			if (key === undefined) return;
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

	/** Writes a captured key into a slot and reports the change (Capture's last step) */
	ApplyCapturedKey(slot: string, key: Enum.KeyCode) {
		WriteKey(this.Instance, slot, key);
		this._runtime.NotifyBindingChanged(this.Path);
	}

	ResetQuietly() {
		WriteBinding(this.Instance, this._defaults);
	}

	ApplySavedQuietly(values: Map<SavedProperty, SavedValue>) {
		ApplySaved(this.Instance, values);
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
