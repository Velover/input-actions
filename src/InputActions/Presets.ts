import { Bool, Direction1D, Direction2D } from "./Builders";

export interface IUiNavigationOptions {
	ServerAuthority?: boolean;
	Priority?: number;
	Sink?: boolean;
	Enabled?: boolean;
}

function UiNavigationActions() {
	return {
		Navigate: Direction2D({
			KeyboardAndMouse: {
				Up: Enum.KeyCode.Up,
				Down: Enum.KeyCode.Down,
				Left: Enum.KeyCode.Left,
				Right: Enum.KeyCode.Right,
			},
			Gamepad: {
				Up: Enum.KeyCode.DPadUp,
				Down: Enum.KeyCode.DPadDown,
				Left: Enum.KeyCode.DPadLeft,
				Right: Enum.KeyCode.DPadRight,
			},
		}),
		Accept: Bool({ KeyboardAndMouse: Enum.KeyCode.Return, Gamepad: Enum.KeyCode.ButtonA }),
		// Escape is reserved, and Backspace belongs to CoreGui
		Cancel: Bool({ KeyboardAndMouse: Enum.KeyCode.B, Gamepad: Enum.KeyCode.ButtonB }),
		NextPage: Bool({ KeyboardAndMouse: Enum.KeyCode.E, Gamepad: Enum.KeyCode.ButtonR1 }),
		PreviousPage: Bool({ KeyboardAndMouse: Enum.KeyCode.Q, Gamepad: Enum.KeyCode.ButtonL1 }),
		Scroll: Direction1D({
			Mouse: Enum.KeyCode.MouseWheel,
			KeyboardAndMouse: { Up: Enum.KeyCode.PageUp, Down: Enum.KeyCode.PageDown },
			Gamepad: { Up: Enum.KeyCode.Thumbstick2Up, Down: Enum.KeyCode.Thumbstick2Down },
		}),
	};
}

export type UiNavigationActions = ReturnType<typeof UiNavigationActions>;

/** A context schema for menu navigation: Navigate, Accept, Cancel, NextPage, PreviousPage, Scroll */
export function UiNavigation<const O extends IUiNavigationOptions = {}>(
	// Generic inference skips excess-property checks: a misspelt option is rejected here
	options?: O & { [K in Exclude<keyof O, keyof IUiNavigationOptions>]: never },
): O & { Actions: UiNavigationActions } {
	const context: Record<string, unknown> = {};
	if (options !== undefined) {
		for (const [name, value] of pairs(options as Record<string, unknown>)) context[name] = value;
	}
	context.Actions = UiNavigationActions();
	return context as never;
}
