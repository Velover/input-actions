import { OnStart, Provider } from "@flamework-experimental/core";
import { defer, defineTests, eventually, expectEqual, test } from "@flamework-experimental/testing";
import { EMouseLockAction, MouseController } from "@rbxts/input-actions";
import { UserInputService } from "@rbxts/services";
import { createTestInput } from "./helpers";

type LockableAction = Exclude<EMouseLockAction, EMouseLockAction.None>;

/** A mouse lock action switched off after the test */
function lockAction(action: LockableAction, priority?: number) {
	const lock = new MouseController.MouseLockAction(action, priority);
	defer(() => lock.SetActive(false));
	return lock;
}

/** MouseController: the lock stacks, and SetForceUnlockAction (design spec §10) */
@Provider({ activeIn: ["testing"] })
export class MouseControllerTests implements OnStart {
	onStart() {
		defineTests("mouse", () => {
			test("with nothing active the action is None", () => {
				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.None);
			});

			test("the highest priority wins across the stacks", () => {
				const center = lockAction(EMouseLockAction.LockMouseCenter);
				const position = lockAction(EMouseLockAction.LockMouseAtPosition, 500);
				const unlock = lockAction(EMouseLockAction.UnlockMouse, 100);

				center.SetActive(true);
				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.LockMouseCenter);
				unlock.SetActive(true);
				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.LockMouseCenter);
				unlock.AdjustPriority(300);
				// default priorities: unlock 300 >= center 200
				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.UnlockMouse);
				position.SetActive(true);
				expectEqual(
					MouseController.GetCurrentMouseLockAction(),
					EMouseLockAction.LockMouseAtPosition,
				);
				position.SetActive(false);
				unlock.SetActive(false);
				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.LockMouseCenter);
				center.SetActive(false);
				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.None);
			});

			test("SetForceUnlockAction unlocks the mouse while the action is pressed", () => {
				const debug = createTestInput().Gameplay.Actions.Dash;
				const center = lockAction(EMouseLockAction.LockMouseCenter, 1000);
				center.SetActive(true);
				MouseController.SetForceUnlockAction(debug);
				defer(() => MouseController.SetForceUnlockAction());

				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.LockMouseCenter);
				debug.Fire(true);
				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.UnlockMouse);
				debug.Fire(false);
				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.LockMouseCenter);
				MouseController.SetForceUnlockAction();
				debug.Fire(true);
				expectEqual(MouseController.GetCurrentMouseLockAction(), EMouseLockAction.LockMouseCenter);
			});

			test("the controller applies the action to UserInputService every frame", () => {
				MouseController.Initialize();
				const position = lockAction(EMouseLockAction.LockMouseAtPosition, 10000);
				position.SetActive(true);
				eventually(
					() => UserInputService.MouseBehavior === Enum.MouseBehavior.LockCurrentPosition,
					"MouseBehavior LockCurrentPosition",
				);
				position.SetActive(false);
				eventually(
					() => UserInputService.MouseBehavior === Enum.MouseBehavior.Default,
					"MouseBehavior Default",
				);
			});
		});
	}
}
