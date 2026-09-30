/** Every input InputCatcher sinks through ContextActionService */
export const CATCHABLE_INPUTS = [
	...Enum.KeyCode.GetEnumItems(),
	...Enum.UserInputType.GetEnumItems(),
	...Enum.PlayerActions.GetEnumItems(),
];
