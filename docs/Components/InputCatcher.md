# InputCatcher

Blocks all input while it is active: during a cutscene, a loading screen or a modal dialog.

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
IAS bindings for it: an active catcher stops your `InputActions` too. To block only some actions,
disable their contexts instead (`context.Request(false)`).

Release the input when you're done, or it stays blocked.
