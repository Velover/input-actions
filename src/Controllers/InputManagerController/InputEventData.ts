//!native
//!optimize 2
import { InputKeyCode } from "../../Models/InputKeyCode";
import { ActionResources } from "../../Resources/ActionResources";

export default class InputEventData {
	static FromInputKeyCode(inputKeyCode: InputKeyCode, userInputType?: Enum.UserInputType) {
		return new this(inputKeyCode, undefined, userInputType);
	}
	static FromAction(actionName: string) {
		return new this(undefined, actionName);
	}

	readonly InputKeyCode: InputKeyCode = Enum.UserInputType.None;
	readonly UserInputType: Enum.UserInputType = Enum.UserInputType.None;
	readonly Action: string = ActionResources.NONE_ACTION;

	/**if the event is Enum.UserInputState.Changed */
	Changed: boolean = false;

	PressStrength: number = 0;
	Position: Vector3 = Vector3.zero;
	Delta: Vector3 = Vector3.zero;

	private constructor(keycode?: InputKeyCode, action?: string, userInputType?: Enum.UserInputType) {
		this.InputKeyCode = keycode ?? this.InputKeyCode;
		this.Action = action ?? this.Action;
		this.UserInputType = userInputType ?? this.UserInputType;
	}
}
