import { ContextActionService, HttpService } from "@rbxts/services";
import { CATCHABLE_INPUTS } from "./CatchableInputs";

function SinkKey() {
	return Enum.ContextActionResult.Sink;
}

/**
 * Blocks keyboard, mouse, gamepad and touch input to the game while it is active, through one
 * ContextActionService sink (which blocks IAS bindings too); GUI still gets clicks and taps
 */
export class InputCatcher {
	private _priority: number;
	private _uuid = HttpService.GenerateGUID();
	private _isActive = false;

	/**
	 * Creates a new InputCatcher, which blocks input to the game; GUI still gets clicks and taps
	 * (a GuiButton, and an action's AttachButton binding on it, keep working)
	 * @param priority Priority level for the input catch (higher catches earlier)
	 */
	constructor(priority: number) {
		this._priority = priority;
	}

	/**
	 * Start capturing and blocking all user input
	 */
	GrabInput() {
		ContextActionService.BindActionAtPriority(
			this._uuid,
			SinkKey,
			false,
			this._priority,
			...CATCHABLE_INPUTS,
		);
		this._isActive = true;
	}

	/**
	 * Stop capturing input and restore normal input handling
	 */
	ReleaseInput() {
		ContextActionService.UnbindAction(this._uuid);
		this._isActive = false;
	}

	/**
	 * Check if this InputCatcher is currently active
	 */
	IsActive(): boolean {
		return this._isActive;
	}
}
