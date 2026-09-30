# MouseController

Controls the mouse lock (`UserInputService.MouseBehavior` and `MouseIconEnabled`) through priority
stacks, so several systems can ask for different behaviours and the highest priority wins.

```ts
import { EMouseLockAction, MouseController } from "@rbxts/input-actions";

MouseController.Initialize(); // once, on the client

const freeLook = new MouseController.MouseLockAction(EMouseLockAction.LockMouseCenter);
const menu = new MouseController.MouseLockAction(EMouseLockAction.UnlockMouse, 1000);

freeLook.SetActive(true); // mouse locked at the centre, icon hidden
menu.SetActive(true); // the menu wins while it's open
menu.SetActive(false); // back to free look
```

## Lock actions

| `EMouseLockAction` | Applies | Default priority (`EMouseLockActionPriority`) |
| --- | --- | --- |
| `LockMouseAtPosition` | `LockCurrentPosition`, icon shown | 100 |
| `LockMouseCenter` | `LockCenter`, icon hidden | 200 |
| `UnlockMouse` | `Default`, icon shown | 300 |

With nothing active, the controller applies `Default` with the icon shown. Each kind keeps a stack
sorted by priority. The highest entry of each stack is compared, and on a tie `UnlockMouse` wins,
then `LockMouseCenter`.

## API

| Member | |
| --- | --- |
| `Initialize()` | starts applying the current action every frame; calling it again does nothing |
| `new MouseLockAction(action, priority?)` | a lock request; `priority` defaults per action (table above) |
| `MouseLockAction.SetActive(active)` | pushes or removes the request |
| `MouseLockAction.AdjustPriority(priority)` | moves an active request to the new priority |
| `SetMouseLockActionStrictMode(action, value)` | strict (the default for every action): the behaviour is written every frame, overriding other scripts; not strict: only when the action changes |
| `SetForceUnlockAction(action?: InputActions.BoolAction)` | unlocks the mouse while `action` is pressed, whatever the stacks hold (a debug key, say); no argument removes it |
| `GetCurrentMouseLockAction(): EMouseLockAction` | the action applied this frame |
| `SetEnabled(enabled)` | pauses or resumes applying |

`SetForceUnlockAction` replaces 0.5's `MouseDebugMode` default action:

```ts
const Input = InputActions.Create(
	InputActions.Schema({ Debug: { Actions: { FreeMouse: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.F2 }) } } }),
);
MouseController.SetForceUnlockAction(Input.Debug.Actions.FreeMouse);
```

The update runs on `RenderStepped`. In frames where the client renders nothing (a Studio window
that isn't drawn), it runs on Heartbeat instead.
