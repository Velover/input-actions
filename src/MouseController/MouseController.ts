import { UserInputService } from "@rbxts/services";
import { EveryFrame } from "../Internal/EveryFrame";
import type { InputActions } from "../InputActions/InputActions";
import { EMouseLockAction } from "./EMouseLockAction";
import { EMouseLockActionPriority } from "./EMouseLockActionPriority";

/** Inserts `value` into a list kept sorted by `goesFirst(value, item)` */
function SortedInsert(
	list: number[],
	value: number,
	goesFirst: (value: number, item: number) => boolean,
) {
	for (let index = 0; index < list.size(); index++) {
		if (goesFirst(value, list[index])) {
			list.insert(index, value);
			return;
		}
	}
	list.push(value);
}

/** Removes the first `value` from the list */
function RemoveFirst(list: number[], value: number) {
	const index = list.indexOf(value);
	if (index !== -1) list.remove(index);
}

export namespace MouseController {
	//the stacks should be sorted by priority all the time
	const lockedCenterPrioritiesStack: number[] = [];
	const unlockedStack: number[] = [];
	const lockedAtPositionStack: number[] = [];

	const DEFAULT_MOUSE_LOCK_ACTION_PRIORITIES = {
		[EMouseLockAction.UnlockMouse]: EMouseLockActionPriority.UnlockMouse,
		[EMouseLockAction.LockMouseCenter]: EMouseLockActionPriority.LockMouseCenter,
		[EMouseLockAction.LockMouseAtPosition]: EMouseLockActionPriority.LockMouseAtPosition,
		[EMouseLockAction.None]: 0,
	};

	const mouseLockActionStacks = {
		[EMouseLockAction.UnlockMouse]: unlockedStack,
		[EMouseLockAction.LockMouseCenter]: lockedCenterPrioritiesStack,
		[EMouseLockAction.LockMouseAtPosition]: lockedAtPositionStack,
		[EMouseLockAction.None]: [],
	};

	export class MouseLockAction {
		private _active = false;

		constructor(
			private readonly _action: Exclude<EMouseLockAction, EMouseLockAction.None>,
			private _priority: number = DEFAULT_MOUSE_LOCK_ACTION_PRIORITIES[_action],
		) {}

		AdjustPriority(newPriority: number) {
			if (this._priority === newPriority) return;
			const wasActive = this._active;
			if (this._active) this.SetActive(false);
			this._priority = newPriority;
			if (wasActive) this.SetActive(true);
		}

		SetActive(active: boolean) {
			if (this._active === active) return;
			this._active = active;
			const stack = mouseLockActionStacks[this._action];
			if (active) {
				SortedInsert(stack, this._priority, (currentValue, b) => {
					return currentValue >= b;
				});
				return;
			}

			RemoveFirst(stack, this._priority);
		}
	}

	/**during the strict mode the mouse e.g if mouse should be visible and unlocked, it will ensure that it will be unlocked all the time
	 * without it, mouse behaviour and visibility can be changed during the process and action like unlock the mouse will be applied only at change
	 */
	const StrictMode = {
		[EMouseLockAction.LockMouseAtPosition]: true,
		[EMouseLockAction.LockMouseCenter]: true,
		[EMouseLockAction.UnlockMouse]: true,
		[EMouseLockAction.None]: false,
	};

	export function SetMouseLockActionStrictMode(
		action: Exclude<EMouseLockAction, EMouseLockAction.None>,
		value: boolean,
	) {
		StrictMode[action] = value;
	}

	let forceUnlockAction: InputActions.BoolAction | undefined;

	/**
	 * Unlocks the mouse while `action` is pressed, whatever the stacks hold (e.g. a debug key).
	 * Pass nothing to remove it.
	 */
	export function SetForceUnlockAction(action?: InputActions.BoolAction) {
		forceUnlockAction = action;
	}

	/** The mouse lock action the controller applies this frame */
	export function GetCurrentMouseLockAction(): EMouseLockAction {
		if (forceUnlockAction !== undefined && forceUnlockAction.IsPressed())
			return EMouseLockAction.UnlockMouse;

		if (
			unlockedStack.size() === 0 &&
			lockedCenterPrioritiesStack.size() === 0 &&
			lockedAtPositionStack.size() === 0
		) {
			return EMouseLockAction.None;
		}

		//sets unlock mouse on top
		const unlockMouseMaxPriority = unlockedStack[0] ?? 0;
		const lockedCenterMaxPriority = lockedCenterPrioritiesStack[0] ?? -1;
		const lockedAtPositionMaxPriority = lockedAtPositionStack[0] ?? -1;

		if (
			unlockMouseMaxPriority >= lockedAtPositionMaxPriority &&
			unlockMouseMaxPriority >= lockedCenterMaxPriority
		)
			return EMouseLockAction.UnlockMouse;

		if (lockedCenterMaxPriority >= lockedAtPositionMaxPriority)
			return EMouseLockAction.LockMouseCenter;

		return EMouseLockAction.LockMouseAtPosition;
	}

	function ApplyAction(action: EMouseLockAction) {
		if (action === EMouseLockAction.UnlockMouse) {
			UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
			UserInputService.MouseIconEnabled = true;
		} else if (action === EMouseLockAction.LockMouseCenter) {
			UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter;
			UserInputService.MouseIconEnabled = false;
		} else if (action === EMouseLockAction.LockMouseAtPosition) {
			UserInputService.MouseBehavior = Enum.MouseBehavior.LockCurrentPosition;
			UserInputService.MouseIconEnabled = true;
		} else if (action === EMouseLockAction.None) {
			//reset to default behaviour
			UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
			UserInputService.MouseIconEnabled = true;
		}
	}

	let currentAction: EMouseLockAction;
	function SetMouseLockAction(mouseLockAction: EMouseLockAction) {
		const isStrictMode = StrictMode[mouseLockAction];
		//dont apply changes if strict mode is not enabled
		if (!isStrictMode && currentAction === mouseLockAction) return;
		currentAction = mouseLockAction;
		ApplyAction(mouseLockAction);
	}

	let enabled = true;
	function Update() {
		if (!enabled) return;
		SetMouseLockAction(GetCurrentMouseLockAction());
	}

	export function SetEnabled(value: boolean) {
		enabled = value;
	}

	let initialized = false;
	export function Initialize() {
		if (initialized) return;
		initialized = true;

		EveryFrame(Update);
	}
}
