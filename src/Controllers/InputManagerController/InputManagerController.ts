//!native
//!optimize 2
import { ContextActionService } from "@rbxts/services";
import { EInputEventSubscribtionType } from "../../Models";
import { ECustomKey } from "../../Models/ECustomKey";
import { ActionResources } from "../../Resources/ActionResources";
import { ActionsController } from "../ActionsController";
import InputEvent from "./InputEvent";
import InputEventData from "./InputEventData";
import InputSignal, { InputCallback } from "./InputSignal";

export namespace InputManagerController {
	const input_signal = new InputSignal();
	interface ISubscribtionConfig {
		Priority?: number;
		SubscriptionType?: EInputEventSubscribtionType;
	}

	export function Subscribe(callback: InputCallback, config?: ISubscribtionConfig) {
		return input_signal.Subscribe(callback, config?.Priority, config?.SubscriptionType);
	}

	function GetInputKeyCode(input: InputObject) {
		return input.KeyCode === Enum.KeyCode.Unknown ? input.UserInputType : input.KeyCode;
	}

	function PressActionsFromInputEvent(input_event: InputEvent) {
		for (const action_name of input_event.Actions) {
			ActionsController.Press(action_name, input_event.PressStrength);
		}
	}

	export function ParseInputEvent(input_event_data: InputEventData) {
		const input_event = new InputEvent(input_event_data);
		PressActionsFromInputEvent(input_event);
		return input_signal.Fire(input_event);
	}

	function SetCustomKeyStrength(
		input: InputObject,
		custom_key: ECustomKey,
		strength: number,
		force: boolean = false,
	) {
		if (!force && saved_custom_key_press_strengths[custom_key] === strength) return;

		const input_event_data = InputEventData.FromInputKeyCode(custom_key, input.UserInputType);
		input_event_data.Position = input.Position;
		input_event_data.Delta = input.Delta;
		input_event_data.PressStrength = strength;
		input_event_data.Changed = true;
		ParseInputEvent(input_event_data);
	}

	function ExtractPressStrength(value: number, min: number, max: number) {
		return math.abs(math.clamp(value, min, max));
	}

	function ExtractThumbstickPressStrength(value: number, min: number, max: number) {
		return math.abs(value) < ActionResources.DEFAULT_THUMBSTICK_DEAD_ZONE
			? 0
			: math.abs(math.clamp(value, min, max));
	}

	const saved_custom_key_press_strengths = identity<Record<ECustomKey, number>>({
		[ECustomKey.Thumbstick1Left]: 0,
		[ECustomKey.Thumbstick1Right]: 0,
		[ECustomKey.Thumbstick1Up]: 0,
		[ECustomKey.Thumbstick1Down]: 0,

		[ECustomKey.Thumbstick2Left]: 0,
		[ECustomKey.Thumbstick2Right]: 0,
		[ECustomKey.Thumbstick2Up]: 0,
		[ECustomKey.Thumbstick2Down]: 0,

		[ECustomKey.MouseWheelUp]: 0,
		[ECustomKey.MouseWheelDown]: 0,

		[ECustomKey.MouseLeft]: 0,
		[ECustomKey.MouseRight]: 0,
		[ECustomKey.MouseDown]: 0,
		[ECustomKey.MouseUp]: 0,
	});

	let saved_mouse_position = Vector3.zero;
	type CustomKeyStrategy = (input: InputObject) => void;
	const custom_key_strategies = {
		[Enum.KeyCode.Thumbstick1 as never]: (input: InputObject) => {
			const left_strength = ExtractThumbstickPressStrength(input.Position.X, -1, 0);
			const right_strength = ExtractThumbstickPressStrength(input.Position.X, 0, 1);
			const up_strength = ExtractThumbstickPressStrength(input.Position.Y, 0, 1);
			const down_strength = ExtractThumbstickPressStrength(input.Position.Y, -1, 0);

			SetCustomKeyStrength(input, ECustomKey.Thumbstick1Left, left_strength);
			SetCustomKeyStrength(input, ECustomKey.Thumbstick1Right, right_strength);
			SetCustomKeyStrength(input, ECustomKey.Thumbstick1Up, up_strength);
			SetCustomKeyStrength(input, ECustomKey.Thumbstick1Down, down_strength);
		},
		[Enum.KeyCode.Thumbstick2 as never]: (input: InputObject) => {
			const left_strength = ExtractThumbstickPressStrength(input.Position.X, -1, 0);
			const right_strength = ExtractThumbstickPressStrength(input.Position.X, 0, 1);
			const up_strength = ExtractThumbstickPressStrength(input.Position.Y, 0, 1);
			const down_strength = ExtractThumbstickPressStrength(input.Position.Y, -1, 0);

			SetCustomKeyStrength(input, ECustomKey.Thumbstick2Left, left_strength);
			SetCustomKeyStrength(input, ECustomKey.Thumbstick2Right, right_strength);
			SetCustomKeyStrength(input, ECustomKey.Thumbstick2Up, up_strength);
			SetCustomKeyStrength(input, ECustomKey.Thumbstick2Down, down_strength);
		},
		[Enum.UserInputType.MouseWheel as never]: (input: InputObject) => {
			const down_strength = ExtractPressStrength(input.Position.Z, -1, 0);
			const up_strength = ExtractPressStrength(input.Position.Z, 0, 1);
			if (down_strength !== 0)
				SetCustomKeyStrength(input, ECustomKey.MouseWheelDown, down_strength, true);

			if (up_strength !== 0)
				SetCustomKeyStrength(input, ECustomKey.MouseWheelUp, up_strength, true);
		},
		[Enum.UserInputType.MouseMovement as never]: (input: InputObject) => {
			const position_delta = input.Position.sub(saved_mouse_position);
			saved_mouse_position = input.Position;

			const total_delta = position_delta.add(input.Delta);

			const left_strength = math.abs(math.min(total_delta.X, 0));
			const right_strength = math.abs(math.max(total_delta.X, 0));
			const up_strength = math.abs(math.min(total_delta.Y, 0));
			const down_strength = math.abs(math.max(total_delta.Y, 0));

			SetCustomKeyStrength(input, ECustomKey.MouseLeft, left_strength);
			SetCustomKeyStrength(input, ECustomKey.MouseRight, right_strength);
			SetCustomKeyStrength(input, ECustomKey.MouseDown, down_strength);
			SetCustomKeyStrength(input, ECustomKey.MouseUp, up_strength);
		},
	};

	function CheckAndParseIfCustomInputKeyCode(input: InputObject) {
		if (input.UserInputState !== Enum.UserInputState.Change) return;
		const input_key_code = GetInputKeyCode(input);
		const strategy = custom_key_strategies[input_key_code as never] as
			| CustomKeyStrategy
			| undefined;
		strategy?.(input);
	}

	function OnInput(_: string, state: Enum.UserInputState, input: InputObject) {
		if (state === Enum.UserInputState.None) return;
		if (state === Enum.UserInputState.Cancel) return;

		const press_strength = state === Enum.UserInputState.Begin ? 1 : 0;
		const input_key_code = GetInputKeyCode(input);
		const input_event_action = InputEventData.FromInputKeyCode(input_key_code, input.UserInputType);
		input_event_action.Position = input.Position;
		input_event_action.Changed = state === Enum.UserInputState.Change;
		input_event_action.Delta = input.Delta;
		input_event_action.PressStrength = press_strength;

		CheckAndParseIfCustomInputKeyCode(input);
		return ParseInputEvent(input_event_action);
	}

	let initialized = false;
	export function Initialize() {
		if (initialized) return;
		initialized = true;
		ContextActionService.BindActionAtPriority(
			"ActionsReader",
			OnInput,
			false,
			99999,
			...ActionResources.ALL_KEYCODES,
		);
	}
}
