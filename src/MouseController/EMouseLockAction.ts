/** What a `MouseController.MouseLockAction` asks of the mouse */
export const enum EMouseLockAction {
	/** `MouseBehavior.LockCurrentPosition`, icon shown */
	LockMouseAtPosition,
	/** `MouseBehavior.LockCenter`, icon hidden */
	LockMouseCenter,
	/** `MouseBehavior.Default`, icon shown */
	UnlockMouse,
	/**Internal */
	None,
}
