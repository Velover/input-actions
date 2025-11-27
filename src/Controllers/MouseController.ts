import { RunService, UserInputService } from "@rbxts/services";
import { ArrayTools } from "@rbxts/tool_pack";
import { EDefaultInputAction } from "../Models/EDefaultInputAction";
import { EMouseLockAction } from "../Models/EMouseLockAction";
import { EMouseLockActionPriority } from "../Models/EMouseLockActionPriority";
import { ActionsController } from "./ActionsController";

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
		private active_ = false;

		constructor(
			private readonly action_: Exclude<EMouseLockAction, EMouseLockAction.None>,
			private priority_: number = DEFAULT_MOUSE_LOCK_ACTION_PRIORITIES[action_],
		) {}

		AdjustPriority(new_priority: number) {
			if (this.priority_ === new_priority) return;
			const was_active = this.active_;
			if (this.active_) this.SetActive(false);
			this.priority_ = new_priority;
			if (was_active) this.SetActive(true);
		}

		SetActive(active: boolean) {
			if (this.active_ === active) return;
			this.active_ = active;
			const stack = mouseLockActionStacks[this.action_];
			if (active) {
				ArrayTools.SortedInsert(stack, this.priority_, (currentValue, b) => {
					return currentValue >= b;
				});
				return;
			}

			ArrayTools.RemoveElementFromArray(stack, this.priority_);
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

	function GetCurrentMouseLockAction() {
		const is_debug_mode =
			ActionsController.IsExisting(EDefaultInputAction.MouseDebugMode) &&
			ActionsController.IsPressed(EDefaultInputAction.MouseDebugMode);
		if (is_debug_mode) return EMouseLockAction.UnlockMouse;

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

		RunService.RenderStepped.Connect(Update);
	}
}
