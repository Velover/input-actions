# InputCatcher

Blocks keyboard, mouse, gamepad and touch input to the game while it is active: during a cutscene, a
loading screen or a modal dialog. GUI still gets its clicks and taps (see below).

```ts
import { InputCatcher } from "@rbxts/input-actions";

const catcher = new InputCatcher(3000); // the ContextActionService priority
catcher.GrabInput(); // start blocking
catcher.IsActive(); // true
catcher.ReleaseInput(); // stop blocking
```

| Member | |
| --- | --- |
| `new InputCatcher(priority)` | higher priorities catch earlier |
| `GrabInput()` | binds one ContextActionService action over every `KeyCode`, `UserInputType` and `PlayerActions` item, returning `Sink` |
| `ReleaseInput()` | unbinds it |
| `IsActive(): boolean` | whether it is blocking |

It is a ContextActionService sink, and since 2026-02 a CAS binding that sinks an input also blocks
IAS bindings for it: an active catcher stops your `InputActions` key, mouse and wheel bindings too.

**GUI is not blocked.** A GuiButton gets a click or a tap before ContextActionService does, so
buttons keep working under an active catcher, and so does an action's
[`AttachButton`](../API.md#action-handle) binding: a click on the attached button still presses the
action (measured with real clicks and taps). A click on the 3D world doesn't reach a
`MouseLeftButton` binding. To keep a button from acting, hide it (`Visible = false`), set
`Interactable = false` on it, or remove its binding (the function `AttachButton` returned).
`Active = false` is not enough: it stops `Activated`, but the button's binding still presses the
action. To block only some actions, disable their contexts instead (`context.Request(false)`).

Release the input when you're done, or it stays blocked.
