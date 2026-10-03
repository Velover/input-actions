/** The default priority of each `EMouseLockAction`: the highest active one wins */
export const enum EMouseLockActionPriority {
	/** `LockMouseAtPosition`'s default priority */
	LockMouseAtPosition = 100,
	/** `LockMouseCenter`'s default priority */
	LockMouseCenter = 200,
	/** `UnlockMouse`'s default priority */
	UnlockMouse = 300,
}
