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
	ReadBinding,
	WriteBinding,
	WriteKey,
} from "../BindingState";
import type { IRuntime } from "../Internal";
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
	readonly Instance: InputBinding;
	readonly Name: string;
	private _defaults: IBindingValues;

	constructor(
		private readonly _runtime: IRuntime,
		binding: InputBinding,
		readonly Path: string,
		readonly ActionType: ActionTypeName,
		name: string,
	) {
		this.Instance = binding;
		this.Name = name;
		this._defaults = ReadBinding(binding);
	}

	/** Takes the current state as the defaults `Reset` returns to */
	TakeDefaults() {
		this._defaults = ReadBinding(this.Instance);
	}

	Get() {
		return GetBindingData(this.ActionType, this.Instance);
	}

	Set(spec: unknown) {
		const problem = CheckBindingSpec(this.ActionType, spec);
		if (problem !== undefined) error(`InputActions: ${this.Path}: ${problem}`, 2);
		ApplySpec(this.Instance, spec);
		this._runtime.NotifyBindingChanged(this.Path);
	}

	Reset() {
		this.ResetQuietly();
		this._runtime.NotifyBindingChanged(this.Path);
	}

	Clear() {
		ClearKeys(this.Instance);
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
		const cancelKeys = options?.Cancel ?? [];
		let connection: RBXScriptConnection | undefined;
		const stop = () => {
			connection?.Disconnect();
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
		let changes: Record<string, unknown> | undefined;
		for (const name of SAVED_PROPERTIES) {
			if (!IsPropertyOf(this.ActionType, name)) continue;
			if (current[name] !== this._defaults[name]) {
				changes ??= {};
				changes[name] = EncodeSavedValue(current[name]);
			}
		}
		return changes;
	}
}

/** A binding declared `InputActions.Scriptable`: driven only by `Fire` */
export class ScriptableBindingHandle {
	readonly Instance: InputBinding;
	readonly Name: string;
	/** The last value `Fire` sent, until something releases it (a stand-in swap carries it over) */
	LastValue?: unknown;

	constructor(binding: InputBinding, name: string) {
		this.Instance = binding;
		this.Name = name;
	}

	Fire(value: unknown) {
		this.Instance.Fire(value);
		this.LastValue = value;
	}
}
