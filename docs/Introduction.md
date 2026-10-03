# Introduction

`@rbxts/input-actions` is a typed wrapper over Roblox's Input Action System (IAS). IAS has three
instance classes:

```
InputContext             a group of actions: Enabled, Priority, Sink
└─ InputAction           one gameplay intent; its Type fixes the value type
   └─ InputBinding       one input source: a KeyCode, composite directions, a UIButton, or Scriptable
```

The engine does the input work: it reads the devices, applies thresholds, scales and response
curves, sinks inputs across priorities, and fires `Pressed`, `Released` and `StateChanged`. What IAS
lacks is typing (`GetState()` is `unknown`), a way to describe the tree once, rebinding with saves,
and a few safety nets. This package adds those.

## The model

1. **A schema** describes the contexts, their actions and each action's bindings. It is plain data
   made with builders (`InputActions.Bool`, `Direction2D`...), so it can live in a shared module
   and be required on both realms. It creates no instances.
2. **`InputActions.Create(schema)`**, on the client, gets or creates the instances in a folder
   (`ReplicatedStorage.Inputs` by default) and returns the typed handle.
3. **Handles** wrap the instances: `Input.Gameplay` is a context handle, `Input.Gameplay.Actions.Jump`
   an action handle, `Jump.Bindings.KeyboardAndMouse` a binding handle. Each has an `Instance`
   property when you need the raw IAS object.

An action's bindings are its **devices'**: `KeyboardAndMouse`, `Gamepad` and `Touch`, the
`Enum.PreferredInput` names. Each binding holds only its device's keys, and every action has the
three (unbound when the schema leaves one out). A binding driven from code instead of keys is an
`InputActions.Scriptable`, under any other name.

```ts
const Input = InputActions.Create(InputSchema);
Input.Gameplay.Actions.Move.GetState(); // Vector2
Input.Gameplay.Actions.Jump.Pressed.Connect(() => {});
Input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.F);
```

### Value types

| Builder | `GetState()` / `Fire()` value | Typical sources |
| --- | --- | --- |
| `Bool` | `boolean` | keys, gamepad buttons, mouse buttons, triggers (through thresholds) |
| `Direction1D` | `number` | triggers, `Up`/`Down` composites, `MouseWheel`, pinch |
| `Direction2D` | `Vector2` | thumbsticks, `MouseDelta`/`TouchDelta`, `Up`/`Down`/`Left`/`Right` composites |
| `Direction3D` | `Vector3` | six-direction composites |
| `ViewportPosition` | `Vector2` (pixels) | `MousePosition`, `TouchPosition` |

### Get-or-create

`Create` matches existing instances by name, so it works on top of a tree made in Studio with the
Input Action Manager:

- a context is named as its schema key, and an action as its schema key;
- the binding for slot `S` of action `A` is a child named `S` or `A .. S` (the Manager names its
  bindings `<Action><Device>`: `JumpKeyboardAndMouse`, `JumpGamepad`, `JumpTouch`, the package's
  device names); a device the folder has no binding for gets one made, unbound unless the schema
  gives it keys;
- **what exists wins**: an existing context keeps its Priority, Sink and Enabled, an existing action
  its Enabled and DisplayName, an existing binding its keys and tuning. The schema fills only what is
  missing. (The server's copy of a Server Authority context is always enabled on the server, so the
  client gives it the template's or the schema's `Enabled`: see
  [Server Authority](Advanced.md#server-authority).)

## What changed from 0.5

Up to 0.5 the package was its own input system over ContextActionService and UserInputService. It is
now a rewrite on IAS, and most of the old API is gone:

| 0.5 | Now |
| --- | --- |
| `ActionsController`, `InputManagerController` | IAS actions, through typed action handles |
| `InputContextController` | IAS contexts, through context handles (`SetEnabled`, `Request`) |
| `InputConfigController`, thumbstick dead zones | binding properties: `PressedThreshold`, `Scale`, `ResponseCurve` |
| `KeyCombinationController` | `PrimaryModifier` / `SecondaryModifier` on a binding |
| `DeviceTypeHandler`, `EInputType`, `EDeviceType` | `InputActions.PreferredDevice()` (`UserInputService.PreferredInput`), `action.GetPreferredBinding()` |
| `EDefaultInputAction` and the default UI context | `InputActions.Presets.UiNavigation()` |
| `InputEchoController`, `HapticFeedbackController`, `InputKeyCodeHelper` | removed |
| `InputActionsInitializationHelper` | removed: `InputActions.Create` does the setup |
| `MouseController` | kept; `MouseDebugMode` became `MouseController.SetForceUnlockAction(action)` |
| `InputCatcher` | kept, unchanged |
| `RawInputHandler` | kept, same API; it reads the IAS PlayerModule when the place uses it |

Next: [Quick start](QuickStart.md).
